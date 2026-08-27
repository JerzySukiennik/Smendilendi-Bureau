// aging.js — the building is thirty years older, and it shows.
//
// The rule this file follows: the player must still recognise his own building.
// Nothing here changes a dimension, moves a wall or adds a volume. What it
// changes is what thirty years actually change — the colour of a rendered
// facade, the moss on the shaded side, the streak under a sill, the trees that
// were saplings on the site plan and are now over the roof, the sign somebody
// screwed on beside the door, the one wall that was repainted in a colour the
// architect would not have chosen, and the floor.
//
// THE FLOOR IS THE ONE THAT MATTERS.
// The worn tracks are not a texture placed by hand. They are the heat map — the
// same person-seconds the post-occupancy report is written from — rendered as a
// decal at floor level. The finish is worn where these thirty people walked and
// nowhere else, so the track goes round the wrong side of the reception desk if
// that is where the route really goes. An architect notices that.
//
// All ageing is parameterised by `age` 0..1 so the transition can run it as a
// time lapse: at 0 the building is on the day of handover.

import {
  Group, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry, Color,
  MeshBasicMaterial, MeshStandardMaterial, CanvasTexture, DoubleSide,
  Matrix4, Quaternion, Vector3, Shape, ShapeGeometry,
} from 'three';
import { materialFor, tintedMaterial, COLORS } from '../core/palette.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

/** How much a rendered surface loses in thirty years of Polish weather. */
const WEATHER_DARKEN = 0.86;      // multiplier on value
const WEATHER_DESAT = 0.78;       // multiplier on saturation
/** Thirty years of growth on a tree that was already established. */
const TREE_GROWTH = 1.42;

function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------

export class Aging {
  /**
   * @param {object} o
   *   scene       THREE.Scene to add the static pieces to
   *   nav         Navmesh (for levels, walls, entrance)
   *   model       BuildingModel
   *   commission  the brief, for the sign and the trees
   *   heat        Heatmap — the source of the worn floor
   *   built       the result of buildMeshes(), whose materials we own
   *   rng         () => 0..1
   */
  constructor({ scene, nav, model, commission = null, heat, built, rng = Math.random }) {
    this.scene = scene;
    this.nav = nav;
    this.model = model;
    this.commission = commission;
    this.heat = heat;
    this.built = built;
    this.rng = rng;
    this.age = 0;
    this.group = new Group();
    this.group.name = 'aging';
    scene.add(this.group);

    this.trees = [];
    this.moss = [];
    this.streaks = [];
    this.shrubs = [];
    this._wearTex = [];
    this._wearMesh = [];
    this._wearAt = -1;
    this._matBase = new Map();
    this._matWeathered = new Map();
    this._disposables = [];
  }

  // -- construction --------------------------------------------------------

  build() {
    this._captureMaterials();
    this._makeGround();
    this._plantTrees();
    this._growMoss();
    this._streakWindows();
    this._repaintOneWall();
    this._makeSign();
    this._makeWearDecals();
    return this;
  }

  /** Remember every building material as-built, and its weathered twin. */
  _captureMaterials() {
    const mats = this.built?.materials;
    if (!(mats instanceof Map)) return;
    for (const [key, m] of mats) {
      if (!m?.color) continue;
      const base = m.color.clone();
      const hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl);
      const weathered = new Color().setHSL(
        hsl.h,
        hsl.s * WEATHER_DESAT,
        Math.max(0.04, hsl.l * WEATHER_DARKEN),
      );
      this._matBase.set(m, base);
      this._matWeathered.set(m, weathered);
    }
  }

  /**
   * The site. The plot boundary as it was drawn in the brief, the grass inside
   * it, the pavement on the street side, and the approach to the front door.
   */
  _makeGround() {
    const plot = this.commission?.plot ?? null;
    const b = this.nav.levels[0];
    const cx = b.minX + (b.w * this.nav.cell) / 2;
    const cz = b.minZ + (b.h * this.nav.cell) / 2;

    const ground = new Mesh(new PlaneGeometry(220, 220), materialFor('grass'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, cz);
    ground.receiveShadow = true;
    this.group.add(ground);
    this._disposables.push(ground.geometry);

    if (plot?.boundary?.length >= 3) {
      // the plot itself, in a drier grass so the boundary reads on the ground
      const shape = new Shape();
      plot.boundary.forEach((p, i) => (i ? shape.lineTo(p[0], p[1]) : shape.moveTo(p[0], p[1])));
      shape.closePath();
      // ShapeGeometry is authored in XY. rotateX(+90) maps shape-Y onto world
      // +Z, which is the mapping the plot polygon's [x, z] pairs need — but it
      // also turns the face normal downwards, so the material is double-sided.
      const geo = new ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2);
      const mesh = new Mesh(geo, materialFor('grass', { side: 'double' }));
      mesh.position.y = -0.008;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this._disposables.push(geo);
    }

    // The approach: a 1.50 m paved path from the standoff point to the door.
    const e = this.nav.mainEntrance;
    if (e) {
      const len = Math.hypot(e.outX - e.x, e.outZ - e.z) + 1.0;
      const geo = new PlaneGeometry(1.5, len);
      const path = new Mesh(geo, materialFor('paving'));
      path.rotation.x = -Math.PI / 2;
      path.rotation.z = -Math.atan2(e.nx, e.nz);
      path.position.set((e.x + e.outX) / 2, this.nav.levels[e.levelIdx].elevation + 0.005, (e.z + e.outZ) / 2);
      path.receiveShadow = true;
      this.group.add(path);
      this._disposables.push(geo);
    }
  }

  /**
   * Trees. The ones the brief put on the site, thirty years bigger, plus a
   * handful that seeded themselves along the boundary since — which is what
   * actually happens to a site nobody weeds for three decades.
   */
  _plantTrees() {
    const plot = this.commission?.plot ?? null;
    const rng = this.rng;
    const src = plot?.trees ?? [];
    for (const t of src) {
      this.trees.push({
        x: t.x, z: t.z,
        h0: t.height, h1: t.height * TREE_GROWTH,
        r0: t.radius * 0.9, r1: t.radius * TREE_GROWTH,
        crownColour: t.species === 'pine' ? 0x476b4a : (t.species === 'birch' ? 0x86a659 : 0x6f8f4a),
        crownShade: t.species === 'pine' ? 0x3c5c40 : (t.species === 'birch' ? 0x74914c : 0x5f7c40),
        trunkColour: t.species === 'birch' ? COLORS.paper : COLORS.woodDark,
        seeded: false, seedAt: 0,
        lean: (rng() - 0.5) * 0.10,
      });
    }
    // self-seeded, along the boundary, appearing between year 5 and year 25
    const poly = plot?.boundary;
    const b = this.nav.levels[0];
    const count = 9;
    for (let i = 0; i < count; i++) {
      let x, z;
      if (poly && poly.length >= 3) {
        const k = Math.floor(rng() * poly.length);
        const a = poly[k], c = poly[(k + 1) % poly.length];
        const t = 0.15 + rng() * 0.7;
        const inward = 1.6 + rng() * 2.4;
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        x = a[0] + dx * t + (dz / len) * inward * (rng() < 0.5 ? 1 : -1);
        z = a[1] + dz * t - (dx / len) * inward * (rng() < 0.5 ? 1 : -1);
      } else {
        const ang = (i / count) * Math.PI * 2 + rng();
        const r = 26 + rng() * 14;
        x = b.minX + (b.w * this.nav.cell) / 2 + Math.cos(ang) * r;
        z = b.minZ + (b.h * this.nav.cell) / 2 + Math.sin(ang) * r;
      }
      // never inside the building
      if (this.nav.indexAt(x, z, 0) >= 0 && this.nav.roomAt(x, z, 0)) continue;
      this.trees.push({
        x, z,
        h0: 0, h1: 5 + rng() * 5,
        r0: 0, r1: 1.6 + rng() * 1.4,
        crownColour: rng() < 0.4 ? 0x86a659 : 0x6f8f4a,
        crownShade: rng() < 0.4 ? 0x74914c : 0x5f7c40,
        trunkColour: COLORS.woodDark,
        seeded: true, seedAt: 0.15 + rng() * 0.5,
        lean: (rng() - 0.5) * 0.16,
      });
    }
  }

  /**
   * Moss and algae, at the foot of exterior walls and only where the sun does
   * not reach. The compass convention is the game's own: north is -z, so a wall
   * face whose outward normal points north stays damp.
   */
  _growMoss() {
    const rng = this.rng;
    for (const id in this.model.walls) {
      const w = this.model.walls[id];
      if (w.type !== 'exterior' && w.type !== 'party') continue;
      const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
      if (!a || !b) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.6) continue;
      const ux = dx / len, uz = dz / len;
      const level = this.model.levels.find((l) => l.id === w.levelId) ?? this.model.levels[0];
      const y = level?.elevation ?? 0;
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = ux * side;
        // north-facing (-z) and east-facing (+x is drier) — northness decides
        const northness = -nz;
        if (northness < 0.25) continue;
        const patches = Math.max(1, Math.round(len / 1.6));
        for (let i = 0; i < patches; i++) {
          if (rng() > 0.55 * northness + 0.15) continue;
          const t = ((i + 0.5) / patches) * len + (rng() - 0.5) * 0.5;
          const off = w.thickness / 2 + 0.012;
          this.moss.push({
            x: a.x + ux * t + nx * off,
            z: a.z + uz * t + nz * off,
            y: y + 0.02 + rng() * 0.10,
            yaw: Math.atan2(nx, nz),
            w: 0.5 + rng() * 0.9,
            h: 0.25 + rng() * 0.55 * northness,
            colour: rng() < 0.5 ? 0x5c6f43 : 0x6f7d5a,
            start: 0.25 + rng() * 0.4,
          });
        }
      }
    }
  }

  /** A dirt streak under every window sill. Thirty years of rain runs off. */
  _streakWindows() {
    const rng = this.rng;
    for (const oid in this.model.openings) {
      const o = this.model.openings[oid];
      if (o.kind !== 'window') continue;
      const w = this.model.walls[o.wallId];
      if (!w || (w.type !== 'exterior' && w.type !== 'party')) continue;
      const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const level = this.model.levels.find((l) => l.id === w.levelId) ?? this.model.levels[0];
      const y = (level?.elevation ?? 0) + (o.sill ?? 0.85);
      for (const side of [1, -1]) {
        const nx = -uz * side, nz = ux * side;
        const off = w.thickness / 2 + 0.010;
        // two streaks, at the ends of the sill where the water actually runs
        for (const f of [-0.36, 0.36]) {
          this.streaks.push({
            x: a.x + ux * (o.offset + f * o.width) + nx * off,
            z: a.z + uz * (o.offset + f * o.width) + nz * off,
            y: y - 0.30,
            yaw: Math.atan2(nx, nz),
            w: 0.10 + rng() * 0.06,
            h: 0.45 + rng() * 0.45,
            start: 0.3 + rng() * 0.3,
          });
        }
      }
    }
  }

  /**
   * One elevation was repainted, at some point, by somebody who had a tin of
   * something else. Drawn as a 6 mm overlay on the existing face so the wall
   * itself is untouched — the player's geometry is his.
   */
  _repaintOneWall() {
    const walls = Object.values(this.model.walls)
      .filter((w) => w.type === 'exterior')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!walls.length) return;
    // deterministic: the longest exterior wall that has no door in it
    let pick = null, bestLen = 0;
    for (const w of walls) {
      const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const hasDoor = (w.openings ?? []).some((oid) => this.model.openings[oid]?.kind === 'door');
      if (hasDoor || len < 2.5) continue;
      if (len > bestLen) { bestLen = len; pick = w; }
    }
    if (!pick) return;
    const a = this.model.nodes[pick.a], b = this.model.nodes[pick.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const level = this.model.levels.find((l) => l.id === pick.levelId) ?? this.model.levels[0];
    const h = Math.min(level?.height ?? 2.7, 2.4);
    const nx = -uz, nz = ux;
    const geo = new PlaneGeometry(len - 0.2, h);
    const mat = new MeshStandardMaterial({
      color: new Color(0xb08a63), roughness: 0.95, metalness: 0,
      transparent: true, opacity: 0,
    });
    const mesh = new Mesh(geo, mat);
    mesh.position.set(
      (a.x + b.x) / 2 + nx * (pick.thickness / 2 + 0.006),
      (level?.elevation ?? 0) + h / 2,
      (a.z + b.z) / 2 + nz * (pick.thickness / 2 + 0.006),
    );
    mesh.rotation.y = Math.atan2(nx, nz);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.repaint = mesh;
    this._disposables.push(geo, mat);
  }

  /**
   * The sign. Every building acquires one; nobody asks the architect. It goes
   * beside the entrance at 1.60 m to the centre, which is where they always go.
   */
  _makeSign() {
    const e = this.nav.mainEntrance;
    if (!e) return;
    const title = this.commission?.client?.company
      || this.commission?.client?.name
      || (this.commission?.typeName ? this.commission.typeName.replace(/^./, (c) => c.toUpperCase()) : 'The Building');
    const sub = this.commission?.address ?? '';

    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 160;
    const g = cv.getContext('2d');
    g.fillStyle = '#2b2825';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#d4763a';
    g.fillRect(0, 0, cv.width, 6);
    g.fillStyle = '#f3ece1';
    g.textAlign = 'center';
    g.font = '600 46px "Inter", Helvetica, Arial, sans-serif';
    g.fillText(String(title).slice(0, 26), cv.width / 2, 78);
    g.fillStyle = '#a89f92';
    g.font = '24px ui-monospace, Menlo, monospace';
    g.fillText(String(sub).slice(0, 40), cv.width / 2, 116);
    const tex = new CanvasTexture(cv);
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, toneMapped: false });
    const geo = new PlaneGeometry(1.10, 0.34);
    const sign = new Mesh(geo, mat);
    const side = 1.05;          // to the right of the door as you face it
    sign.position.set(
      e.x + e.nx * (0.14) - e.nz * side,
      this.nav.levels[e.levelIdx].elevation + 1.60,
      e.z + e.nz * (0.14) + e.nx * side,
    );
    sign.rotation.y = Math.atan2(e.nx, e.nz);
    this.group.add(sign);
    this.sign = sign;
    this._disposables.push(geo, mat, tex);
  }

  /**
   * The worn floor. One decal plane per level, textured with the heat map, sat
   * 12 mm over the slab so it never z-fights with the finish underneath.
   */
  _makeWearDecals() {
    for (let li = 0; li < this.nav.levels.length; li++) {
      const L = this.nav.levels[li];
      const bw = L.w * this.nav.cell, bh = L.h * this.nav.cell;
      const cv = this.heat.toCanvas(li, { px: 1, mode: 'wear' });
      const tex = new CanvasTexture(cv);
      tex.anisotropy = 4;
      const mat = new MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      });
      const geo = new PlaneGeometry(bw, bh);
      const mesh = new Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(L.minX + bw / 2, L.elevation + 0.012, L.minZ + bh / 2);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this._wearTex.push({ tex, canvas: cv, level: li });
      this._wearMesh.push(mesh);
      this._disposables.push(geo, mat, tex);
    }
  }

  // -- animation -----------------------------------------------------------

  /** 0 = handover day, 1 = thirty years on. */
  setAge(t) {
    this.age = Math.max(0, Math.min(1, t));
    const a = this.age;
    for (const [mat, base] of this._matBase) {
      const w = this._matWeathered.get(mat);
      mat.color.setRGB(
        lerp(base.r, w.r, a),
        lerp(base.g, w.g, a),
        lerp(base.b, w.b, a),
      );
    }
    if (this.repaint) {
      // the repaint happened somewhere around year 15
      this.repaint.material.opacity = Math.max(0, Math.min(1, (a - 0.45) / 0.25));
      this.repaint.visible = this.repaint.material.opacity > 0.01;
    }
    if (this.sign) {
      this.sign.material.opacity = Math.max(0, Math.min(1, (a - 0.12) / 0.2));
      this.sign.visible = this.sign.material.opacity > 0.01;
    }
    for (const m of this._wearMesh) {
      m.material.opacity = Math.max(0, Math.min(1, (a - 0.25) / 0.5)) * 0.9;
      m.visible = m.material.opacity > 0.02;
    }
  }

  /** Refresh the worn-floor texture from the live heat map, at most every 2 s. */
  update(dt, now) {
    if (now - this._wearAt < 2.0) return;
    this._wearAt = now;
    // Written straight back into the canvas the texture already points at:
    // allocating a second canvas and blitting it every two seconds is a
    // visible hitch on a machine that is otherwise holding sixty frames.
    for (const entry of this._wearTex) {
      this.heat.toCanvas(entry.level, { px: 1, mode: 'wear', into: entry.canvas });
      entry.tex.needsUpdate = true;
    }
  }

  // -- instanced scenery ---------------------------------------------------

  registerPools(pool) {
    if (pool.has('age.trunk')) return;
    pool.register('age.trunk', new CylinderGeometry(0.6, 1.0, 1, 7), tintedMaterial({ flatShading: true }));
    pool.register('age.crown', new BoxGeometry(1, 1, 1), tintedMaterial({ flatShading: true }));
    pool.register('age.moss', new PlaneGeometry(1, 1), materialFor('flat', { side: 'double' }),
      { castShadow: false, receiveShadow: false });
    pool.register('age.streak', new PlaneGeometry(1, 1), materialFor('flat', { side: 'double' }),
      { castShadow: false, receiveShadow: false });
  }

  render(pool) {
    const a = this.age;
    for (const t of this.trees) {
      if (t.seeded && a < t.seedAt) continue;
      const k = t.seeded ? Math.min(1, (a - t.seedAt) / Math.max(0.05, 1 - t.seedAt)) : a;
      const h = lerp(t.h0, t.h1, k);
      const r = lerp(t.r0, t.r1, k);
      if (h < 0.6) continue;
      const trunkH = h * 0.46;
      _q.setFromAxisAngle(_up, t.x * 0.7 + t.z);
      _p.set(t.x, trunkH / 2, t.z);
      _s.set(h * 0.022, trunkH, h * 0.022);
      _m.compose(_p, _q, _s);
      pool.place('age.trunk', _m, t.trunkColour);

      // Three offset boxes read as a crown at this scale and cost one draw call.
      // A crown is about as tall as it is wide on a lime or an oak, so the box
      // is sized off the canopy DIAMETER rather than stretched across it — a
      // 6 m radius crown drawn 12 m wide and 5 m tall looks like a billboard,
      // and this is a game an architect is going to look at closely.
      const canopy = (h - trunkH);
      for (let i = 0; i < 3; i++) {
        const sc = [1.0, 0.78, 0.62][i];
        _q.setFromAxisAngle(_up, t.x + i * 1.1 + t.lean * 3);
        _p.set(
          t.x + Math.cos(i * 2.1 + t.x) * r * 0.20 + t.lean * h * 0.1,
          trunkH + canopy * (0.28 + i * 0.22),
          t.z + Math.sin(i * 2.1 + t.z) * r * 0.20,
        );
        const cw = Math.min(r * 1.5, canopy * 1.05) * sc;
        _s.set(cw, canopy * 0.80 * sc, cw);
        _m.compose(_p, _q, _s);
        pool.place('age.crown', _m, i === 1 ? t.crownColour : t.crownShade);
      }
    }

    for (const m of this.moss) {
      const k = Math.max(0, Math.min(1, (a - m.start) / Math.max(0.05, 1 - m.start)));
      if (k <= 0.02) continue;
      _q.setFromAxisAngle(_up, m.yaw);
      _p.set(m.x, m.y + (m.h * k) / 2, m.z);
      _s.set(m.w, m.h * k, 1);
      _m.compose(_p, _q, _s);
      pool.place('age.moss', _m, m.colour);
    }

    for (const s of this.streaks) {
      const k = Math.max(0, Math.min(1, (a - s.start) / Math.max(0.05, 1 - s.start)));
      if (k <= 0.02) continue;
      _q.setFromAxisAngle(_up, s.yaw);
      _p.set(s.x, s.y - (s.h * k) / 2, s.z);
      _s.set(s.w, s.h * k, 1);
      _m.compose(_p, _q, _s);
      pool.place('age.streak', _m, 0x8d8272);
    }
  }

  dispose() {
    for (const [mat, base] of this._matBase) mat.color.copy(base);
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
    this.group.parent?.remove(this.group);
    this.group.clear();
  }
}
