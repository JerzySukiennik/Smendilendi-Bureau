// plan.js — a real PLAN, not a top view.
//
// Switching to the plan camera and looking at the tops of the walls is not a
// plan; it is a photograph taken from a ladder. This module draws the drawing:
// a horizontal section with the walls POCHÉ'D solid, doors shown as a gap with
// their leaf and swing arc, windows as a break with the glazing line, every room
// labelled with the name the engine knows it by and its clear area, a running
// dimension chain AND an overall dimension off all four sides built from the
// real wall nodes, a graphic scale bar and a north point.
//
// It costs three draw calls: one filled mesh for the poché, one LineSegments for
// everything drawn as a line, and the label planes (which are batched into a
// single canvas atlas per rebuild).

import {
  Group, Mesh, BufferGeometry, BufferAttribute, MeshBasicMaterial, PlaneGeometry,
  LineSegments, LineBasicMaterial, CanvasTexture, SRGBColorSpace, DoubleSide, Vector2,
} from 'three';
import { getRooms, roomCentroid } from '../model/rooms.js';

const INK = 0x2b2825;
const PAPER = 0xf3ece1;
const DIM = 0x6f6a63;
const GLASS = 0x4d7f96;

// Heights above the floor. The paper and the poché sit on the floor; the
// linework and the labels are lifted to just under the 1.20 m cut so a door
// swing arc and a room's area are drawn OVER the furniture, the way they are on
// a real drawing — a sofa does not hide the number an architect is reading.
const PLAN_Y = 0.010;          // the paper
const POCHE_Y = 0.014;         // filled walls
const LINE_Y = 1.180;          // linework: outlines, swing arcs, dimension strings
const LABEL_Y = 1.190;         // room names, areas, dimension figures, the north point

export class PlanDrawing {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'plan-drawing';
    this.group.visible = false;
    scene.add(this.group);

    this.paper = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: PAPER, side: DoubleSide }),
    );
    this.paper.rotation.x = -Math.PI / 2;
    this.paper.position.y = PLAN_Y;
    this.paper.renderOrder = 1;
    this.group.add(this.paper);

    this.poche = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: INK, side: DoubleSide }));
    this.poche.position.y = POCHE_Y;
    this.poche.renderOrder = 2;
    this.group.add(this.poche);

    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true }));
    this.lines.position.y = LINE_Y;
    this.lines.renderOrder = 3;
    this.group.add(this.lines);

    this.labels = new Group();
    this.group.add(this.labels);

    this.version = -1;
    this.levelId = null;
  }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  /**
   * Rebuild from the model. Cheap enough to call on every model version bump.
   * `labels` is the editor's room naming (classification first, hash never).
   */
  build(model, levelId, roomNames = null) {
    if (this.version === model.version && this.levelId === levelId) return;
    this.version = model.version;
    this.levelId = levelId;

    const tris = [];
    const segs = [];       // { a:[x,z], b:[x,z], color }
    const labels = [];     // { text, sub, x, z, size }

    const walls = Object.values(model.walls).filter(w => w.levelId === levelId);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const xs = new Set(), zs = new Set();

    for (const w of walls) {
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-4) continue;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const nx = -dz, nz = dx;                 // left normal
      const h = w.thickness / 2;

      for (const p of [a, b]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      if (w.type === 'exterior' || w.type === 'party') {
        xs.add(round(a.x)); xs.add(round(b.x));
        zs.add(round(a.z)); zs.add(round(b.z));
      }

      // the solid runs, i.e. the wall minus its openings
      const holes = w.openings
        .map(id => model.openings[id])
        .filter(Boolean)
        .map(o => ({ from: clamp(o.offset - o.width / 2, 0, len), to: clamp(o.offset + o.width / 2, 0, len), o }))
        .sort((p, q) => p.from - q.from);

      let at = 0;
      for (const hole of holes) {
        if (hole.from > at) pushRun(tris, a, dx, dz, nx, nz, h, at, hole.from);
        at = Math.max(at, hole.to);
      }
      if (at < len) pushRun(tris, a, dx, dz, nx, nz, h, at, len);

      // the outline of the whole wall, so a run that ends at an opening still reads
      const A = [a.x + nx * h, a.z + nz * h], B = [b.x + nx * h, b.z + nz * h];
      const C = [b.x - nx * h, b.z - nz * h], D = [a.x - nx * h, a.z - nz * h];
      segs.push({ a: A, b: B, color: INK }, { a: C, b: D, color: INK });

      // openings drawn in the architectural way
      for (const hole of holes) {
        const o = hole.o;
        const cx = a.x + dx * o.offset, cz = a.z + dz * o.offset;
        const halfW = o.width / 2;
        // reveals: close the poché at both jambs
        for (const s of [-1, 1]) {
          const jx = cx + dx * halfW * s, jz = cz + dz * halfW * s;
          segs.push({ a: [jx + nx * h, jz + nz * h], b: [jx - nx * h, jz - nz * h], color: INK });
        }
        if (o.kind === 'window') {
          // three lines across the opening = the glazed unit in plan
          for (const t of [-0.35, 0, 0.35]) {
            const off = h * 2 * t;
            segs.push({
              a: [cx - dx * halfW + nx * off, cz - dz * halfW + nz * off],
              b: [cx + dx * halfW + nx * off, cz + dz * halfW + nz * off],
              color: GLASS,
            });
          }
        } else {
          // door: leaf drawn open at 90 deg, plus the swing arc
          const side = (o.swing || 'in-left').includes('left') ? 1 : -1;
          const inward = (o.swing || 'in-left').startsWith('out') ? -1 : 1;
          const hingeX = cx - dx * halfW * side, hingeZ = cz - dz * halfW * side;
          const leafX = hingeX + nx * o.width * inward, leafZ = hingeZ + nz * o.width * inward;
          segs.push({ a: [hingeX, hingeZ], b: [leafX, leafZ], color: INK });
          arc(segs, hingeX, hingeZ, o.width,
            Math.atan2(dz * side, dx * side), Math.atan2(nz * inward, nx * inward), INK);
        }
      }
    }

    // rooms: name and clear area at the centroid
    const rooms = getRooms(model, levelId);
    for (const id of rooms.order) {
      const r = rooms.rooms[id];
      const c = roomCentroid(r);
      labels.push({
        text: (roomNames && roomNames.get(id)) || r.name,
        sub: `${r.area.toFixed(2)} m²`, x: c.x, z: c.z, size: 0.34,
      });
    }

    // Dimensions. A drawing an architect can build from carries the running
    // chain AND the overall on every side — not two sides, and never without
    // the overall, which is the figure a setting-out engineer measures first.
    if (Number.isFinite(minX)) {
      const pad = 1.4;
      const outer = pad + 1.15;
      const X = [...xs].sort((p, q) => p - q);
      const Z = [...zs].sort((p, q) => p - q);
      const ends = (a) => (a.length >= 2 ? [a[0], a[a.length - 1]] : a);

      dimChain(segs, labels, X, maxZ + pad, 'x', maxZ, -0.30);        // south
      dimChain(segs, labels, X, minZ - pad, 'x', minZ, +0.30);        // north
      dimChain(segs, labels, Z, minX - pad, 'z', minX, -0.30);        // west
      dimChain(segs, labels, Z, maxX + pad, 'z', maxX, +0.30);        // east
      dimChain(segs, labels, ends(X), maxZ + outer, 'x', maxZ, -0.30);
      dimChain(segs, labels, ends(X), minZ - outer, 'x', minZ, +0.30);
      dimChain(segs, labels, ends(Z), minX - outer, 'z', minX, -0.30);
      dimChain(segs, labels, ends(Z), maxX + outer, 'z', maxX, +0.30);

      northPoint(segs, labels, maxX + outer + 2.3, minZ - outer - 0.9);
      scaleBar(tris, segs, labels, minX, maxZ + outer + 2.2);

      // What the sheet covers: the building plus its dimensioning, the north
      // point and the scale bar. The camera frames THIS, so nothing a drawing
      // needs ends up under a panel or off the edge.
      this.sheet = {
        minX: minX - outer - 1.2,
        maxX: maxX + outer + 3.6,
        minZ: minZ - outer - 2.4,
        maxZ: maxZ + outer + 3.4,
      };
      const w = (this.sheet.maxX - this.sheet.minX) + 6;
      const d = (this.sheet.maxZ - this.sheet.minZ) + 6;
      this.paper.scale.set(w, d, 1);
      this.paper.position.set(
        (this.sheet.minX + this.sheet.maxX) / 2, PLAN_Y,
        (this.sheet.minZ + this.sheet.maxZ) / 2,
      );
    } else {
      this.sheet = null;
    }

    this._uploadTris(tris);
    this._uploadSegs(segs);
    this._uploadLabels(labels);
  }

  _uploadTris(tris) {
    const arr = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      arr[i * 3] = tris[i][0]; arr[i * 3 + 1] = 0; arr[i * 3 + 2] = tris[i][1];
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    this.poche.geometry.dispose();
    this.poche.geometry = g;
  }

  _uploadSegs(segs) {
    const n = segs.length;
    const pos = new Float32Array(n * 6);
    const col = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      pos[i * 6] = s.a[0]; pos[i * 6 + 1] = 0; pos[i * 6 + 2] = s.a[1];
      pos[i * 6 + 3] = s.b[0]; pos[i * 6 + 4] = 0; pos[i * 6 + 5] = s.b[1];
      const c = colorTriplet(s.color);
      for (let k = 0; k < 3; k++) { col[i * 6 + k] = c[k]; col[i * 6 + 3 + k] = c[k]; }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.lines.geometry.dispose();
    this.lines.geometry = g;
  }

  _uploadLabels(labels) {
    for (const c of [...this.labels.children]) {
      this.labels.remove(c);
      c.geometry.dispose();
      c.material.map?.dispose();
      c.material.dispose();
    }
    for (const l of labels) {
      const m = planLabel(l.text, l.sub, l.size, l.color);
      m.position.set(l.x, LABEL_Y, l.z);
      m.rotation.x = -Math.PI / 2;
      if (l.rot) m.rotation.z = l.rot;
      m.renderOrder = 4;
      this.labels.add(m);
    }
  }

  dispose() {
    this._uploadLabels([]);
    this.poche.geometry.dispose();
    this.poche.material.dispose();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.paper.geometry.dispose();
    this.paper.material.dispose();
    this.group.parent?.remove(this.group);
  }
}

// ---------------------------------------------------------------------------

function pushRun(tris, a, dx, dz, nx, nz, h, from, to) {
  if (to - from < 1e-4) return;
  const p0 = [a.x + dx * from + nx * h, a.z + dz * from + nz * h];
  const p1 = [a.x + dx * to + nx * h, a.z + dz * to + nz * h];
  const p2 = [a.x + dx * to - nx * h, a.z + dz * to - nz * h];
  const p3 = [a.x + dx * from - nx * h, a.z + dz * from - nz * h];
  tris.push(p0, p1, p2, p0, p2, p3);
}

function arc(segs, cx, cz, r, a0, a1, color) {
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + (d * i) / steps;
    const t1 = a0 + (d * (i + 1)) / steps;
    segs.push({
      a: [cx + Math.cos(t0) * r, cz + Math.sin(t0) * r],
      b: [cx + Math.cos(t1) * r, cz + Math.sin(t1) * r],
      color,
    });
  }
}

/**
 * A dimension string: witness lines down from every node coordinate, one running
 * dimension line, 45-degree architectural ticks and the figure over each bay.
 */
function dimChain(segs, labels, coords, at, axis, near, textOffset) {
  const pts = coords.filter((v, i, arr) => i === 0 || v - arr[i - 1] > 0.05);
  if (pts.length < 2) return;
  const tick = 0.16;
  // The witness line starts just clear of the building and overshoots the
  // dimension line a little, the way it is drawn by hand.
  const dir = at >= near ? 1 : -1;
  const w0 = near + dir * 0.10;
  const w1 = at + dir * 0.22;
  for (const c of pts) {
    segs.push({ a: axis === 'x' ? [c, w0] : [w0, c], b: axis === 'x' ? [c, w1] : [w1, c], color: DIM });
    const t0 = axis === 'x' ? [c - tick, at - tick] : [at - tick, c - tick];
    const t1 = axis === 'x' ? [c + tick, at + tick] : [at + tick, c + tick];
    segs.push({ a: t0, b: t1, color: DIM });
  }
  const a0 = axis === 'x' ? [pts[0], at] : [at, pts[0]];
  const a1 = axis === 'x' ? [pts[pts.length - 1], at] : [at, pts[pts.length - 1]];
  segs.push({ a: a0, b: a1, color: DIM });
  for (let i = 0; i < pts.length - 1; i++) {
    const mid = (pts[i] + pts[i + 1]) / 2;
    const span = pts[i + 1] - pts[i];
    if (span < 0.25) continue;
    labels.push({
      text: `${Math.round(span * 1000)}`,
      sub: '',
      x: axis === 'x' ? mid : at + textOffset,
      z: axis === 'x' ? at + textOffset : mid,
      size: 0.24,
      rot: axis === 'x' ? 0 : Math.PI / 2,
      color: '#6f6a63',
    });
  }
}

/**
 * A graphic scale — 0, 1, 2, 5 m in alternating filled and open metres.
 * A drawing without one is a picture: it cannot be measured off a screenshot,
 * a print at the wrong percentage, or a photograph of a screen.
 */
function scaleBar(tris, segs, labels, x, z) {
  const h = 0.22;
  for (let i = 0; i < 5; i++) {
    const x0 = x + i, x1 = x + i + 1;
    if (i % 2 === 0) {
      tris.push([x0, z], [x1, z], [x1, z + h], [x0, z], [x1, z + h], [x0, z + h]);
    } else {
      segs.push({ a: [x0, z], b: [x1, z], color: INK }, { a: [x0, z + h], b: [x1, z + h], color: INK });
      segs.push({ a: [x0, z], b: [x0, z + h], color: INK }, { a: [x1, z], b: [x1, z + h], color: INK });
    }
  }
  segs.push({ a: [x, z], b: [x, z + h], color: INK }, { a: [x + 5, z], b: [x + 5, z + h], color: INK });
  for (const m of [0, 1, 2, 5]) {
    labels.push({ text: `${m}`, sub: '', x: x + m, z: z + h + 0.34, size: 0.22, color: '#2b2825' });
  }
  labels.push({ text: 'metres', sub: '', x: x + 6.2, z: z + h / 2, size: 0.22, color: '#6f6a63' });
}

/** North is -Z. The arrow points up the sheet, because the plan camera puts -Z up. */
function northPoint(segs, labels, x, z) {
  const r = 0.85;
  arc(segs, x, z, r, 0, Math.PI, INK);
  arc(segs, x, z, r, Math.PI, Math.PI * 2, INK);
  segs.push({ a: [x, z + r * 0.75], b: [x, z - r * 0.95], color: INK });
  segs.push({ a: [x - 0.22, z - 0.45], b: [x, z - 0.95], color: INK });
  segs.push({ a: [x + 0.22, z - 0.45], b: [x, z - 0.95], color: INK });
  labels.push({ text: 'N', sub: '', x, z: z + 1.35, size: 0.34, color: '#2b2825' });
}

function planLabel(text, sub, size, color = '#2b2825') {
  const scale = 128;                     // px per metre of label height
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const f1 = `600 ${Math.round(scale * 0.62)}px Inter, Helvetica, Arial, sans-serif`;
  const f2 = `400 ${Math.round(scale * 0.5)}px Inter, Helvetica, Arial, sans-serif`;
  ctx.font = f1;
  const w1 = ctx.measureText(text).width;
  ctx.font = f2;
  const w2 = sub ? ctx.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(w1, w2)) + 16;
  c.height = sub ? Math.round(scale * 1.35) : Math.round(scale * 0.8);
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.font = f1;
  g.fillText(text, c.width / 2, sub ? scale * 0.42 : c.height / 2);
  if (sub) {
    g.font = f2;
    g.fillStyle = '#6f6a63';
    g.fillText(sub, c.width / 2, scale * 0.98);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const hM = (c.height / scale) * size / 0.62;
  const wM = hM * (c.width / c.height);
  const m = new Mesh(
    new PlaneGeometry(wM, hM),
    new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false }),
  );
  return m;
}

function colorTriplet(hex) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const s = (v) => (v < 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [s(r), s(g), s(b)];
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = (v) => Math.round(v * 1000) / 1000;
export { Vector2 };
