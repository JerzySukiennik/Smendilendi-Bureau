// gizmo.js — everything the editor draws that is not the building itself.
//
// One dynamic LineSegments buffer carries the drawing axes, the rubber band,
// every dotted inference guide, the selection outline and the ghost of whatever
// is being drawn — so the whole feedback layer costs ONE draw call plus a
// handful of small markers. Colours follow the axis grammar in constants.js.

import {
  BufferGeometry, BufferAttribute, LineSegments, LineBasicMaterial, Group,
  Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, BoxGeometry, Vector3,
  Color, DoubleSide, CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial,
} from 'three';
import { AXIS, COLOR } from './constants.js';

const MAX_SEGMENTS = 6000;

export class Gizmos {
  constructor(scene, cameras) {
    this.cameras = cameras;
    this.group = new Group();
    this.group.name = 'editor-gizmos';
    this.group.renderOrder = 10;
    scene.add(this.group);

    const geo = new BufferGeometry();
    this._pos = new Float32Array(MAX_SEGMENTS * 6);
    this._col = new Float32Array(MAX_SEGMENTS * 6);
    geo.setAttribute('position', new BufferAttribute(this._pos, 3));
    geo.setAttribute('color', new BufferAttribute(this._col, 3));
    geo.setDrawRange(0, 0);
    this.lines = new LineSegments(geo, new LineBasicMaterial({
      vertexColors: true, depthTest: false, transparent: true, opacity: 0.98,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 11;
    this.group.add(this.lines);

    // the snap marker — one small quad, recoloured and rescaled every frame
    this.marker = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, side: DoubleSide }),
    );
    this.marker.renderOrder = 14;
    this.marker.visible = false;
    this.group.add(this.marker);

    this.ring = new Mesh(
      new RingGeometry(0.36, 0.5, 20),
      new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, side: DoubleSide }),
    );
    this.ring.renderOrder = 14;
    this.ring.visible = false;
    this.group.add(this.ring);

    // ghost solid for the element being drawn / placed
    this.ghost = new Group();
    this.ghost.renderOrder = 12;
    this.group.add(this.ghost);
    this._ghostMat = new MeshBasicMaterial({
      color: COLOR.ghost, transparent: true, opacity: 0.34, depthWrite: false, side: DoubleSide,
    });

    this.cursors = new Group();
    this.group.add(this.cursors);
    this._cursorMeshes = new Map();

    this._n = 0;
    this._c = new Color();
    this._showAxes = true;
  }

  set axesVisible(v) { this._showAxes = v; }

  // -- the segment buffer ----------------------------------------------------

  begin() { this._n = 0; }

  line(a, b, color = 0xffffff) {
    if (this._n >= MAX_SEGMENTS) return;
    const i = this._n * 6;
    this._pos[i] = a.x; this._pos[i + 1] = a.y; this._pos[i + 2] = a.z;
    this._pos[i + 3] = b.x; this._pos[i + 4] = b.y; this._pos[i + 5] = b.z;
    this._c.setHex(color).convertSRGBToLinear();
    this._col[i] = this._c.r; this._col[i + 1] = this._c.g; this._col[i + 2] = this._c.b;
    this._col[i + 3] = this._c.r; this._col[i + 4] = this._c.g; this._col[i + 5] = this._c.b;
    this._n++;
  }

  /** A dashed line, dash length in metres-per-pixel units so it reads at any zoom. */
  dotted(a, b, color, dash = null) {
    const d = dash ?? this.cameras.metresPerPixel(a) * 6;
    const len = a.distanceTo(b);
    if (len < 1e-6) return;
    const dir = new Vector3().subVectors(b, a).divideScalar(len);
    const step = Math.max(d * 2, len / 400);
    for (let t = 0; t < len; t += step * 2) {
      const p0 = new Vector3().copy(a).addScaledVector(dir, t);
      const p1 = new Vector3().copy(a).addScaledVector(dir, Math.min(t + step, len));
      this.line(p0, p1, color);
    }
  }

  rect(cx, cz, w, d, y, color, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([x, z]) => new Vector3(cx + x * c - z * s, y, cz + x * s + z * c));
    for (let i = 0; i < 4; i++) this.line(pts[i], pts[(i + 1) % 4], color);
  }

  box(min, max, color) {
    const p = [
      new Vector3(min.x, min.y, min.z), new Vector3(max.x, min.y, min.z),
      new Vector3(max.x, min.y, max.z), new Vector3(min.x, min.y, max.z),
      new Vector3(min.x, max.y, min.z), new Vector3(max.x, max.y, min.z),
      new Vector3(max.x, max.y, max.z), new Vector3(min.x, max.y, max.z),
    ];
    for (let i = 0; i < 4; i++) {
      this.line(p[i], p[(i + 1) % 4], color);
      this.line(p[i + 4], p[((i + 1) % 4) + 4], color);
      this.line(p[i], p[i + 4], color);
    }
  }

  /** The drawing axes through the origin — red X, green Y, blue Z (up). */
  drawAxes(centre = new Vector3()) {
    if (!this._showAxes) return;
    const L = 40;
    for (const key of ['x', 'y', 'z']) {
      const ax = AXIS[key];
      const a = new Vector3().copy(centre).addScaledVector(ax.dir, L);
      const b = new Vector3().copy(centre).addScaledVector(ax.dir, -L);
      this.line(centre, a, ax.color);
      this.dotted(centre, b, ax.color);
    }
  }

  end() {
    const geo = this.lines.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
    geo.setDrawRange(0, this._n * 2);
    this.lines.visible = this._n > 0;
  }

  // -- snap marker -----------------------------------------------------------

  showMarker(snap) {
    if (!snap) { this.marker.visible = false; this.ring.visible = false; return; }
    const mpp = this.cameras.metresPerPixel(snap.point);
    const size = mpp * 9;
    const cam = this.cameras.camera;
    if (snap.marker === 'ring') {
      this.ring.visible = true;
      this.marker.visible = false;
      this.ring.position.copy(snap.point);
      this.ring.scale.setScalar(size * 1.5);
      this.ring.quaternion.copy(cam.quaternion);
      this.ring.material.color.setHex(snap.color);
    } else {
      this.ring.visible = false;
      this.marker.visible = true;
      this.marker.position.copy(snap.point);
      this.marker.scale.setScalar(snap.marker === 'square' ? size : size * 0.75);
      this.marker.quaternion.copy(cam.quaternion);
      this.marker.material.color.setHex(snap.color);
    }
    if (snap.marker === 'cross') {
      const s = size;
      const c = this.cameras.camera;
      const right = new Vector3(1, 0, 0).applyQuaternion(c.quaternion).multiplyScalar(s);
      const up = new Vector3(0, 1, 0).applyQuaternion(c.quaternion).multiplyScalar(s);
      const p = snap.point;
      this.line(new Vector3().copy(p).sub(right).sub(up), new Vector3().copy(p).add(right).add(up), snap.color);
      this.line(new Vector3().copy(p).sub(right).add(up), new Vector3().copy(p).add(right).sub(up), snap.color);
      this.marker.visible = false;
    }
  }

  // -- ghost -----------------------------------------------------------------

  clearGhost() {
    for (const c of [...this.ghost.children]) {
      this.ghost.remove(c);
      c.geometry?.dispose?.();
    }
  }

  /** A translucent block, given a centre, size and rotation about Y. */
  ghostBox(cx, cy, cz, w, h, d, rot = 0, color = COLOR.ghost) {
    const m = new Mesh(new BoxGeometry(w, h, d), this._ghostMat);
    if (color !== COLOR.ghost) {
      m.material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.34, depthWrite: false, side: DoubleSide });
    }
    m.position.set(cx, cy, cz);
    m.rotation.y = rot;
    m.renderOrder = 12;
    this.ghost.add(m);
    return m;
  }

  ghostGroup(obj) {
    this.ghost.add(obj);
    return obj;
  }

  // -- other players ---------------------------------------------------------

  /** players: [{ id, nick, color, cursor:{x,y,z} }] excluding ourselves. */
  updateCursors(players) {
    const seen = new Set();
    for (const p of players) {
      if (!p.cursor || p.cursor.x == null) continue;
      seen.add(p.id);
      let m = this._cursorMeshes.get(p.id);
      if (!m) {
        m = makePlayerCursor(p.nick, p.color);
        this.cursors.add(m);
        this._cursorMeshes.set(p.id, m);
      }
      m.position.set(p.cursor.x, (p.cursor.y ?? 0) + 0.02, p.cursor.z);
      const mpp = this.cameras.metresPerPixel(m.position);
      m.scale.setScalar(Math.max(0.4, mpp * 26));
      m.visible = true;
    }
    for (const [id, m] of this._cursorMeshes) {
      if (!seen.has(id)) { m.visible = false; }
    }
  }

  dispose() {
    this.clearGhost();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    for (const m of this._cursorMeshes.values()) {
      m.traverse?.((o) => { o.material?.map?.dispose?.(); o.material?.dispose?.(); o.geometry?.dispose?.(); });
    }
    this._cursorMeshes.clear();
    this.group.parent?.remove(this.group);
  }
}

// ---------------------------------------------------------------------------

function makePlayerCursor(nick, color) {
  const g = new Group();
  const dot = new Mesh(
    new PlaneGeometry(0.18, 0.18),
    new MeshBasicMaterial({ color: color || '#d4763a', depthTest: false, transparent: true, side: DoubleSide }),
  );
  dot.rotation.x = -Math.PI / 2;
  dot.renderOrder = 15;
  g.add(dot);
  const label = makeLabelSprite(nick || 'player', color || '#d4763a');
  label.position.set(0.16, 0.02, -0.14);
  g.add(label);
  return g;
}

/** A small canvas-textured sprite; used for player nicks. */
export function makeLabelSprite(text, color = '#f3ece1', bg = 'rgba(24,22,20,0.86)') {
  const pad = 8;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '600 26px Inter, Helvetica, Arial, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w; c.height = 40;
  const g = c.getContext('2d');
  g.font = '600 26px Inter, Helvetica, Arial, sans-serif';
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.fillRect(0, 0, 3, c.height);
  g.fillStyle = '#f3ece1';
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 1);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sp = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((c.width / c.height) * 0.5, 0.5, 1);
  sp.renderOrder = 16;
  return sp;
}
