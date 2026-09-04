// interact.js — everything you can point at in the office.
//
// One registry, one raycast per frame from the centre of the screen, one white
// outline, one prompt. Registering a thing is three lines:
//
//   interaction.register({ id:'lamp-1', mesh, label:'Desk lamp', verb:'Switch on',
//                          onUse: () => toggle() });
//
// The signature moment (DESIGN-DECISIONS.md, "The in-game computer"):
// "Hovering the monitor in the world draws a white outline; clicking flies the
// camera to the screen, frees the mouse and hands control to a custom in-OS
// cursor. Escape pulls back." That is focusScreen()/releaseScreen() below. The
// flight is a 0.85 s cubic ease with a simultaneous 55 deg -> 38 deg FOV push,
// which is what makes it read as leaning in rather than teleporting.

import {
  Vector3, Vector2, Quaternion, Raycaster, LineSegments, EdgesGeometry,
  LineBasicMaterial, Group, Mesh, BoxGeometry, MeshBasicMaterial,
  MathUtils, CanvasTexture, PlaneGeometry, SRGBColorSpace, BufferGeometry,
  BackSide
} from 'three';
import { MeshBuilder, builderMaterial, propMug, propCrumpledPaper, OFFICE } from './props.js';

const EASE = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export /** Target rim thickness in CSS pixels, so it reads at any distance. */
const OUTLINE_PX = 3.5;

const REACH = 2.6;          // m — you must walk up to things

export class Interaction {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.player = opts.player;
    this.audio = ctx?.audio || null;
    this.items = [];
    this.hover = null;
    this.ray = new Raycaster();
    this.ray.far = REACH + 0.4;
    this._targets = [];
    this._ndc = new Vector2(0, 0);
    this._v = new Vector3();
    this._q = new Quaternion();

    // White hover outline, one object reused for everything.
    //
    // depthTest stays ON. With it off the outline drew through walls, desks and
    // partitions, so it advertised things the player could not see — and with
    // the occlusion test below in place, a hover that survives to be drawn is by
    // definition unoccluded, which means the outline never needs to cheat.
    // THE OUTLINE FOLLOWS THE OBJECT'S OWN SHAPE. It used to be one wireframe
    // BOX scaled to the bounding box, so a task chair, a kettle and a plant all
    // advertised themselves as the same rectangle — and at 1 px it was a
    // hairline you had to hunt for across the room. Now the edges come from the
    // hovered mesh's own geometry (cached per geometry, built once), and it is
    // drawn as a thick shell: the mesh again, slightly inflated along its
    // normals, in BackSide, which gives an even outline at any distance without
    // needing line-width support the platform does not have.
    this.outline = new Group();
    this.outlineEdges = new LineSegments(new BufferGeometry(),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.98, depthTest: true, toneMapped: false }));
    this.outlineShell = new Mesh(new BufferGeometry(), new MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.34, side: BackSide,
      depthTest: true, depthWrite: false, toneMapped: false,
    }));
    this.outline.add(this.outlineShell, this.outlineEdges);
    this.outlineEdges.renderOrder = 11;
    this.outlineShell.renderOrder = 10;
    this.outline.visible = false;
    this._edgeCache = new Map();          // geometry.uuid -> EdgesGeometry
    this.scene.add(this.outline);

    this.focus = null;              // { workstation, t, dir, from:{pos,quat,fov}, to:{...} }
    this.onFocusChange = opts.onFocusChange || null;
    this.hud = opts.hud || null;    // { setPrompt(text|null), setCursor(x,y|null) }
    this.carry = null;              // { mesh, kind, temp, sips }
    this.projectiles = [];
    this.litter = null;             // Group of thrown paper on the floor
    this.onSip = opts.onSip || null;
    this._occluders = [];           // solid geometry that blocks the hover ray
    this._occRay = new Raycaster();
  }

  /**
   * The solid world: the room shell, the merged prop batch and the instanced
   * pools. The hover raycast tests only the ~19 registered interactable meshes,
   * so without this NOTHING blocks it — a player seated at workstation 1 could
   * hover and click the screens of workstations 0 and 2 straight through two
   * desks and a partition, picking a different desk depending on pitch.
   */
  setOccluders(list) {
    this._occluders = (list || []).filter((m) => m && m.isObject3D);
    return this._occluders;
  }

  /** True if solid geometry stands between the camera and `distance` along the ray. */
  _occluded(distance) {
    if (!this._occluders.length) return false;
    this._occRay.set(this.ray.ray.origin, this.ray.ray.direction);
    this._occRay.near = 0.02;
    this._occRay.far = Math.max(0.03, distance - 0.03);
    const hit = this._occRay.intersectObjects(this._occluders, true)[0];
    return !!hit;
  }

  register(item) {
    const it = {
      id: item.id, mesh: item.mesh, label: item.label, verb: item.verb || 'Use',
      kind: item.kind || 'thing', onUse: item.onUse, enabled: item.enabled !== false,
      outlineFrom: item.outlineFrom || item.mesh, workstation: item.workstation || null,
      range: item.range ?? REACH,
    };
    it.mesh.userData.interact = it;
    this.items.push(it);
    this._targets.push(it.mesh);
    return it;
  }

  clear() {
    this.items.length = 0;
    this._targets.length = 0;
    this.hover = null;
    this.outline.visible = false;
  }

  // -- per frame -------------------------------------------------------------

  update(dt, input) {
    if (this.focus) { this._updateFocus(dt, input); return; }

    // hover
    this.ray.setFromCamera(this._ndc, this.camera);
    const hits = this.ray.intersectObjects(this._targets, false);
    let found = null;
    for (const h of hits) {
      const it = h.object.userData.interact;
      if (!it || !it.enabled || h.distance > it.range) continue;
      if (this._occluded(h.distance)) continue;
      found = it;
      break;
    }
    if (found !== this.hover) {
      this.hover = found;
      if (found) {
        this._fitOutline(found.outlineFrom);
        this.outline.visible = true;
        this.hud?.setPrompt(`${found.verb} — ${found.label}`);
      } else {
        this.outline.visible = false;
        this.hud?.setPrompt(null);
      }
    } else if (found) {
      this._fitOutline(found.outlineFrom);
    }

    if (found && (input?.pressed('interact') || input?.mousePressed(0))) {
      this.audio?.play('ui.click-soft');
      found.onUse?.(found, this);
    }

    // carried mug cools and can be sipped or set down
    if (this.carry) this._updateCarry(dt, input);
    this._updateProjectiles(dt);
  }

  _fitOutline(obj) {
    obj.updateWorldMatrix(true, false);
    const g = obj.geometry;
    if (!g) return;
    // Edges of THIS shape, computed once per geometry. 24 degrees keeps a
    // low-poly silhouette (a mug's barrel, a chair's five-star base) without
    // drawing every triangle of a bevel.
    // Prefer the real prop's silhouette when the office attached one: the
    // pickable mesh is a cheap invisible box (a plant is a miserable thing to
    // raycast), so outlining IT would be outlining the box again.
    const shape = obj.userData?.outlineGeometry || g;
    let edges = this._edgeCache.get(shape.uuid);
    if (!edges) { edges = new EdgesGeometry(shape, 24); this._edgeCache.set(shape.uuid, edges); }
    if (this.outlineEdges.geometry !== edges) this.outlineEdges.geometry = edges;
    if (this.outlineShell.geometry !== shape) this.outlineShell.geometry = shape;

    // THICKNESS IS A SCREEN MEASUREMENT, NOT A WORLD ONE. The first version grew
    // the shell by a fraction of the object's own size, which is 1.2 % on
    // anything large — a critic measured the result at ONE PIXEL on a 1600 px
    // canvas, i.e. exactly the hairline this was meant to replace. What the
    // player perceives is pixels, so the rim is sized in pixels: convert a
    // target width into metres at THIS object's distance from the camera, and
    // grow the shell by that. A mug at arm's length and a plan chest across the
    // room then carry the same visible rim.
    if (!shape.boundingSphere) shape.computeBoundingSphere();
    const r = shape.boundingSphere?.radius || 0.2;
    const cam = this.camera;
    const dist = cam ? cam.position.distanceTo(obj.getWorldPosition(this._v)) : 3;
    const vh = this.ctx?.engine?.height || 900;
    const mPerPx = (2 * Math.tan((cam?.fov ?? 55) * Math.PI / 360) * dist) / vh;
    const wanted = OUTLINE_PX * mPerPx;                       // metres of rim
    // Cap the growth so a small object is not swallowed by its own outline.
    const grow = 1 + Math.min(0.09, wanted / Math.max(0.05, r));
    this.outlineShell.scale.setScalar(grow);

    // Match the hovered mesh exactly: same world position, rotation and scale.
    obj.matrixWorld.decompose(this._v, this._q, this._s || (this._s = new Vector3(1, 1, 1)));
    this.outline.position.copy(this._v);
    this.outline.quaternion.copy(this._q);
    this.outline.scale.copy(this._s);
  }

  // -- the monitor transition -----------------------------------------------

  /**
   * Fly the camera to a workstation's screen. Frees the mouse; the in-OS cursor
   * takes over. Escape (or clicking outside the screen) pulls back.
   */
  focusScreen(workstation, opts = {}) {
    if (this.focus) { if (!(opts.fill && !this.focus.fill && this.focus.dir > 0)) return; }
    const screen = workstation.screen;
    screen.updateWorldMatrix(true, false);
    const normal = new Vector3(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new Quaternion()));
    const centre = screen.getWorldPosition(new Vector3());
    // 0.656 m puts a 0.325 m panel across 72 % of a 38 deg frame — the OS
    // view, where you still see the desk around the monitor. `fill` is the
    // editor: the panel's HEIGHT fills the frame exactly, so the design screen
    // is the whole real screen and nothing of the drawing is cropped
    // (d = (h/2) / tan(fov/2) = 0.1625 / tan(19 deg) = 0.472 m).
    const fill = !!opts.fill;
    const dist = fill ? (0.325 / 2) / Math.tan((38 / 2) * Math.PI / 180) : 0.656;
    const to = centre.clone().addScaledVector(normal, dist);

    const camFrom = this.camera.position.clone();
    const quatFrom = this.camera.quaternion.clone();
    const look = this.camera.clone();
    look.position.copy(to);
    look.lookAt(centre);

    this.focus = {
      workstation, t: 0, dir: 1, duration: fill && this.focus ? 0.55 : 0.85, fill,
      from: { pos: camFrom, quat: quatFrom, fov: this.camera.fov },
      to: { pos: to, quat: look.quaternion.clone(), fov: 38 },
    };
    this.player.enabled = false;
    this.outline.visible = false;
    this.hud?.setPrompt(null);
    this.ctx?.input?.exitLock();
    this.audio?.play('ui.window-open');
    this.onFocusChange?.(workstation, true);
  }

  releaseScreen() {
    if (!this.focus || this.focus.dir < 0) return;
    this.focus.dir = -1;
    this.focus.t = 1 - this.focus.t;
    const tmp = this.focus.from; this.focus.from = this.focus.to; this.focus.to = tmp;
    this.focus.workstation.os?.focus?.(false);
    this.hud?.setCursor(null);
    this.audio?.play('ui.window-close');
    this.onFocusChange?.(this.focus.workstation, false);
  }

  _updateFocus(dt, input) {
    const f = this.focus;
    // Escape reverses the flight AT ANY POINT. This test used to live inside
    // the `f.t >= 1` branch, so for the whole 0.85 s approach the player had no
    // way out of a transition they had just triggered by accident.
    if (f.dir > 0 && input?.pressed('cancel')) { this.releaseScreen(); return; }
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = EASE(f.t);
    this.camera.position.lerpVectors(f.from.pos, f.to.pos, k);
    this.camera.quaternion.slerpQuaternions(f.from.quat, f.to.quat, k);
    this.camera.fov = MathUtils.lerp(f.from.fov, f.to.fov, k);
    this.camera.updateProjectionMatrix();

    if (f.t >= 1) {
      if (f.dir < 0) {
        this.focus = null;
        this.player.enabled = true;
        this.camera.fov = 55;
        this.camera.updateProjectionMatrix();
        this.ctx?.input?.requestLock();
        return;
      }
      f.workstation.os?.focus?.(true);
      // While the EDITOR is on this screen the OS gets no pointer — the
      // editor's own listeners on the canvas own the mouse, re-based onto the
      // screen rectangle (see office.screenRect / camera.setViewportRect).
      if (this.editorOnScreen) { this.hud?.setCursor(null); if (input?.pressed('cancel')) this.releaseScreen(); return; }
      // hand the mouse to the in-OS cursor
      const hit = this._screenPoint(input, f.workstation);
      if (hit) {
        // ONE CURSOR, and it is the machine's own. The OS paints a per-tier
        // pointer inside its canvas (chunky on the Pentagram, thin on the
        // Melon), and the office used to lay a second DOM cursor on top of it.
        // The two tracked slightly differently — the DOM one in canvas pixels,
        // the painted one in OS pixels — so after an upgrade you saw the older,
        // smaller pointer sitting under the new one, and leaving a window left
        // one behind. The painted one is the authentic one; the overlay goes.
        f.workstation.os?.pointer?.(hit.u, hit.v, input.mouseDown(0) ? 1 : 0);
      }
      this.hud?.setCursor(null);
      if (input?.pressed('cancel')) this.releaseScreen();
    }
  }

  /** Mouse -> screen uv, by raycasting the actual screen quad. */
  _screenPoint(input, ws) {
    if (!input) return null;
    this.ray.far = 4;
    this.ray.setFromCamera(input.ndc, this.camera);
    const hit = this.ray.intersectObject(ws.screen, false)[0];
    this.ray.far = REACH + 0.4;
    if (!hit || !hit.uv) return null;
    return { u: hit.uv.x, v: 1 - hit.uv.y, sx: input.mouse.x, sy: input.mouse.y };
  }

  // -- the mug ---------------------------------------------------------------

  /** Hand the player a fresh mug. Temperature in Celsius, because of course. */
  giveMug(colorHex) {
    if (this.carry) return false;
    const b = new MeshBuilder();
    b._ao = false;
    propMug(b, { color: colorHex, full: true });
    const g = new Group();
    for (const { mat, geometry } of b.build()) {
      const m = new Mesh(geometry, builderMaterial(mat));
      m.castShadow = false;
      g.add(m);
    }
    g.position.set(0.26, -0.24, -0.46);
    g.rotation.set(0.12, -0.5, 0.06);
    g.scale.setScalar(1.0);
    this.camera.add(g);
    if (!this.camera.parent) this.scene.add(this.camera);
    this.carry = { mesh: g, kind: 'mug', temp: 78, sips: 3, color: colorHex, bob: 0 };
    this.audio?.play('sfx.coffee-pour');
    return true;
  }

  /**
   * Crumple a sheet and hold it. You then AIM and throw.
   *
   * E used to throw the instant you pressed it, from wherever the camera
   * happened to point — "you have to hover the paper and press E, so you cannot
   * even hit the bin". Aiming is the whole game of throwing something at a bin,
   * so the two halves are now separate: E fills your hand, the left button
   * lets go.
   */
  takePaper() {
    if (this.carry) return false;
    const b = new MeshBuilder();
    b._ao = false;
    propCrumpledPaper(b, { seed: (Math.random() * 1e6) | 0 });
    const g = new Group();
    for (const { mat, geometry } of b.build()) g.add(new Mesh(geometry, builderMaterial(mat)));
    g.scale.setScalar(0.55);
    this.camera.add(g);
    this.carry = { mesh: g, kind: 'paper', bob: 0, temp: 21, sips: 0 };
    this.audio?.play('sfx.paper-crumple');
    return true;
  }

  _updateCarry(dt, input) {
    const c = this.carry;
    if (c.kind === 'paper') {
      c.bob += dt;
      const spd = Math.hypot(this.player.vel.x, this.player.vel.z);
      c.mesh.position.set(
        0.24 + Math.sin(c.bob * 6) * 0.004 * spd,
        -0.22 + Math.sin(c.bob * 12) * 0.005 * spd,
        -0.42,
      );
      if (input?.mousePressed?.(0)) this.releasePaper();
      else if (input?.pressed('office.drop')) { this.camera.remove(c.mesh); this.carry = null; }
      return;
    }
    // Newton's law of cooling towards a 21 C studio, tau ~ 260 s.
    c.temp = 21 + (c.temp - 21) * Math.exp(-dt / 260);
    c.bob += dt;
    const sp = Math.hypot(this.player.vel.x, this.player.vel.z);
    c.mesh.position.set(
      0.26 + Math.sin(c.bob * 6) * 0.004 * sp,
      -0.24 + Math.sin(c.bob * 12) * 0.005 * sp,
      -0.46,
    );
    if (input?.pressed('confirm')) this.sip();
  }

  /** A sip. Hot coffee focuses; a cold one is just a sad cold coffee. */
  sip() {
    const c = this.carry;
    if (!c || c.sips <= 0) return null;
    c.sips--;
    const boost = MathUtils.clamp((c.temp - 21) / 57, 0, 1);
    this.audio?.play('ui.click-soft');
    if (c.sips <= 0) {
      this.camera.remove(c.mesh);
      this.carry = null;
    }
    // The office consumes this. It used to be returned into a discarded value,
    // which made "sip for a focus boost" in DESIGN-DECISIONS.md a lie.
    this.onSip?.(boost, c.temp);
    return { boost, temp: c.temp };
  }

  /**
   * Put the mug down ON SOMETHING. A downward raycast against the real world
   * picks the surface; there is no fixed height any more, because passing one
   * meant that standing in open floor and pressing G left a mug floating at
   * desk height over nothing.
   */
  setDownMug(scene, y = null) {
    const c = this.carry;
    if (!c) return false;
    const p = this.camera.getWorldPosition(new Vector3());
    const d = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    d.y = 0; d.normalize();
    const at = p.clone().addScaledVector(d, 0.65);

    let surfaceY = y;
    if (surfaceY == null) {
      this._occRay.set(new Vector3(at.x, Math.max(p.y, 1.6), at.z), new Vector3(0, -1, 0));
      this._occRay.near = 0;
      this._occRay.far = 3.2;
      const hit = this._occRay.intersectObjects(this._occluders, true)[0];
      surfaceY = hit ? hit.point.y : 0;
      // A mug goes on a desk, a counter or a plan chest — not on the floor and
      // not on top of a bookcase you cannot reach over.
      if (surfaceY < 0.30 || surfaceY > 1.25) return false;
    }
    this.camera.remove(c.mesh);
    c.mesh.position.set(at.x, surfaceY + 0.002, at.z);
    c.mesh.rotation.set(0, Math.random() * 6.28, 0);
    c.mesh.scale.setScalar(1);
    scene.add(c.mesh);
    this.audio?.play('sfx.mug-set-down', { position: { x: at.x, y: surfaceY, z: at.z } });
    this.carry = null;
    return true;
  }

  // -- the bin ---------------------------------------------------------------

  /** Let go of the held ball, along the line you are looking. */
  releasePaper() {
    const c = this.carry;
    if (!c || c.kind !== 'paper') return false;
    this.camera.remove(c.mesh);
    this.carry = null;
    this.throwPaper(this.scene, this.binPos ?? this._binPos);
    return true;
  }

  /** Throw a crumpled sheet. Plain ballistics, no physics engine. */
  throwPaper(scene, bin) {
    if (this.projectiles.length > 10) return;
    const b = new MeshBuilder();
    b._ao = false;
    propCrumpledPaper(b, { seed: (Math.random() * 1e6) | 0 });
    const g = new Group();
    for (const { mat, geometry } of b.build()) g.add(new Mesh(geometry, builderMaterial(mat)));
    const p = this.camera.getWorldPosition(new Vector3());
    const d = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    g.position.copy(p).addScaledVector(d, 0.4);
    scene.add(g);
    this.projectiles.push({
      mesh: g, vel: d.clone().multiplyScalar(6.2).add(new Vector3(0, 1.6, 0)),
      spin: new Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      bin, scored: false, life: 0,
    });
    this.audio?.play('sfx.paper-crumple');
  }

  _updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life += dt;
      p.vel.y -= 9.81 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (p.bin && !p.scored) {
        const dx = p.mesh.position.x - p.bin.x, dz = p.mesh.position.z - p.bin.z;
        if (dx * dx + dz * dz < 0.15 * 0.15 && p.mesh.position.y < 0.36 && p.mesh.position.y > 0.05) {
          p.scored = true;
          this.audio?.play('sfx.bin-hit', { position: { x: p.bin.x, y: 0.3, z: p.bin.z } });
          p.mesh.position.set(p.bin.x + dx * 0.3, 0.10 + Math.random() * 0.06, p.bin.z + dz * 0.3);
          p.vel.set(0, 0, 0); p.spin.set(0, 0, 0);
          this.projectiles.splice(i, 1);
          this.onScore?.(true);
          continue;
        }
      }
      if (p.mesh.position.y <= 0.035) {
        p.mesh.position.y = 0.035;
        p.vel.set(0, 0, 0); p.spin.set(0, 0, 0);
        this.audio?.play('sfx.paper-toss');
        this.projectiles.splice(i, 1);
        this.onScore?.(false);
      }
      if (p.life > 8) { this.projectiles.splice(i, 1); }
    }
  }

  dispose() {
    this.scene.remove(this.outline);
    this.outline.geometry.dispose();
    this.outline.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// The corkboard's pinned brief. A canvas, because a brief is text and text on a
// wall is what a corkboard is for.

export function briefTexture(brief) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 352;
  const g = c.getContext('2d');
  g.fillStyle = '#efe9dc'; g.fillRect(0, 0, 512, 352);
  g.strokeStyle = '#c8bfae'; g.lineWidth = 2; g.strokeRect(14, 14, 484, 324);

  g.fillStyle = '#2b2825';
  g.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
  g.fillText((brief?.title || 'DETACHED HOUSE').toUpperCase().slice(0, 26), 34, 62);
  g.fillStyle = '#d4763a';
  g.fillRect(34, 74, 120, 4);

  g.font = '16px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = '#55504a';
  const rows = brief?.rows || [
    ['Client', 'Kowalski family'],
    ['Plot', '620 m2, south-facing, sloping'],
    ['Programme', '4 bed, 2 bath, study, garage'],
    ['Budget', '480 000'],
    ['Deadline', '12 days'],
  ];
  rows.forEach((r, i) => {
    const y = 118 + i * 34;
    g.fillStyle = '#8a8278'; g.fillText(r[0], 34, y);
    g.fillStyle = '#2b2825'; g.fillText(r[1], 190, y);
    g.fillStyle = '#e0d8c8'; g.fillRect(34, y + 10, 444, 1);
  });

  g.fillStyle = '#8a8278';
  g.font = 'italic 14px "Helvetica Neue", Arial, sans-serif';
  g.fillText('Pinned by the office. Do not remove.', 34, 322);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function briefSheet(brief, w = 1.34, h = 0.92) {
  const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({
    map: briefTexture(brief), toneMapped: false,
  }));
  m.material.color.setScalar(0.86);   // it is paper in a room, not a lightbox
  return m;
}
