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
import { tryEntry, verticalExtent } from '../model/catalog.js';

const INK = 0x2b2825;
const PAPER = 0xf3ece1;
const DIM = 0x6f6a63;
const GLASS = 0x4d7f96;
const FURN = 0x5d574f;         // furniture is drawn a weight lighter than the fabric
const CUT_HEIGHT = 1.20;       // the horizontal section this drawing is taken at

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
    const ceiling = model.levels?.find(l => l.id === levelId)?.height ?? 2.70;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const xs = new Set(), zs = new Set();
    // A second, finer chain: the jambs of every opening in an exterior wall.
    // A setting-out drawing that dimensions the walls but not the holes in them
    // cannot be built from, so this one runs closest to the building. Each jamb
    // is remembered with the wall it belongs to, because a chain drawn along the
    // south edge may only carry the south wall's openings — putting every x-jamb
    // in the building on both the north and the south chain would print two
    // chains that are neither of them a wall.
    const jambs = [];      // { axis:'x'|'z', at, cross }

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
          if (w.type === 'exterior' || w.type === 'party') {
            // A jamb is dimensioned on the axis the wall RUNS along, never across
            // its thickness: a door in a north wall is set out from the west.
            if (Math.abs(dx) > Math.abs(dz)) jambs.push({ axis: 'x', at: round(jx), cross: (a.z + b.z) / 2 });
            else jambs.push({ axis: 'z', at: round(jz), cross: (a.x + b.x) / 2 });
          }
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

    // FURNITURE AS PLAN SYMBOLS, not as a photograph of the model.
    //
    // A shaded 3D top view with a drop shadow sitting inside a line drawing is
    // the one thing on this sheet that would tell an architect a programmer drew
    // it. Everything above the 1.20 m cut is left out, as it is on a real plan.
    const footprints = [];
    for (const id in model.furniture) {
      const f = model.furniture[id];
      if (f.levelId !== levelId) continue;
      const entry = tryEntry(f.catalogId);
      if (!entry) continue;
      const band = verticalExtent(entry, f, ceiling);
      if (band.zMin >= CUT_HEIGHT) continue;              // above the cut: not drawn
      const fp = furnitureSymbol(segs, entry, f);
      if (fp) footprints.push(fp);
    }

    // rooms: name and clear area, placed clear of the furniture under it
    const rooms = getRooms(model, levelId);
    for (const id of rooms.order) {
      const r = rooms.rooms[id];
      const c = roomCentroid(r);
      const text = (roomNames && roomNames.get(id)) || r.name;
      const at = labelSpot(c, r, footprints, text);
      labels.push({ text, sub: `${r.area.toFixed(2)} m²`, x: at.x, z: at.z, size: 0.34 });
    }

    // Dimensions. A drawing an architect can build from carries the running
    // chain AND the overall on every side — not two sides, and never without
    // the overall, which is the figure a setting-out engineer measures first.
    if (Number.isFinite(minX)) {
      const pad = 1.4;
      const outer = pad + 1.15;
      const inner = 0.62;                                             // the openings chain
      const X = [...xs].sort((p, q) => p - q);
      const Z = [...zs].sort((p, q) => p - q);
      const ends = (a) => (a.length >= 2 ? [a[0], a[a.length - 1]] : a);

      // Innermost: where the holes are, ONE CHAIN PER SIDE. A jamb belongs to
      // the edge of the sheet its own wall stands on, and the two corners of
      // that edge close the chain, so every figure in it is a real setting-out
      // distance and the whole chain adds up to the overall.
      const side = (axis, lo, hi, want) => {
        const ends2 = axis === 'x' ? [X[0], X[X.length - 1]] : [Z[0], Z[Z.length - 1]];
        const mid = (lo + hi) / 2;
        const here = jambs.filter(j => j.axis === axis
          && (want === 'lo' ? j.cross <= mid : j.cross > mid));
        if (!here.length) return null;
        return [...new Set([...here.map(j => j.at), ...ends2.filter(Number.isFinite)])].sort((p, q) => p - q);
      };
      const north = side('x', minZ, maxZ, 'lo');    // walls near minZ
      const south = side('x', minZ, maxZ, 'hi');
      const west = side('z', minX, maxX, 'lo');
      const east = side('z', minX, maxX, 'hi');
      if (south) dimChain(segs, labels, south, maxZ + inner, 'x', maxZ, -0.26, 0.20);
      if (north) dimChain(segs, labels, north, minZ - inner, 'x', minZ, +0.26, 0.20);
      if (west) dimChain(segs, labels, west, minX - inner, 'z', minX, -0.26, 0.20);
      if (east) dimChain(segs, labels, east, maxX + inner, 'z', maxX, +0.26, 0.20);

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
function dimChain(segs, labels, coords, at, axis, near, textOffset, size = 0.24) {
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
    if (span < 0.02) continue;
    // A bay too narrow to hold its own figure gets it STAGGERED outwards rather
    // than dropped. A chain that silently omits a 150 mm pier does not add up to
    // its own overall, and an architect adds a chain up.
    const tight = span < size * 3.6;
    labels.push({
      text: `${Math.round(span * 1000)}`,
      sub: '',
      x: axis === 'x' ? mid : at + textOffset * (tight ? 2.1 : 1),
      z: axis === 'x' ? at + textOffset * (tight ? 2.1 : 1) : mid,
      size,
      rot: axis === 'x' ? 0 : Math.PI / 2,
      color: '#6f6a63',
    });
  }
}

/**
 * ONE PIECE OF FURNITURE, AS A PLAN SYMBOL.
 *
 * Drawn from the catalogue envelope in the object's own axes, so it turns with
 * the object: outline first, then the two or three interior lines that make the
 * symbol readable as what it is — the back of a sofa, the pillow end of a bed,
 * the bowl of a basin, the door swing of a wardrobe. Everything is a line at
 * furniture weight; there is no fill, no shade and no shadow anywhere in it.
 *
 * @returns {{x:number,z:number,rx:number,rz:number}} the footprint, for label placement
 */
function furnitureSymbol(segs, entry, f) {
  const w = Math.abs((entry.size?.[0] ?? 0.4) * (f.sx ?? 1));
  const d = Math.abs((entry.size?.[2] ?? 0.4) * (f.sz ?? 1));
  if (!(w > 0.02) || !(d > 0.02)) return null;
  const rot = f.rot || 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  // local (u along the item's width, v along its depth) -> world (x, z)
  const P = (u, v) => [f.x + u * c + v * s, f.z - u * s + v * c];
  const line = (u0, v0, u1, v1) => segs.push({ a: P(u0, v0), b: P(u1, v1), color: FURN });
  const box = (hu, hv) => {
    line(-hu, -hv, hu, -hv); line(hu, -hv, hu, hv);
    line(hu, hv, -hu, hv); line(-hu, hv, -hu, -hv);
  };
  const ellipse = (cu, cv, ru, rv, steps = 20) => {
    for (let i = 0; i < steps; i++) {
      const t0 = (i / steps) * Math.PI * 2, t1 = ((i + 1) / steps) * Math.PI * 2;
      segs.push({
        a: P(cu + Math.cos(t0) * ru, cv + Math.sin(t0) * rv),
        b: P(cu + Math.cos(t1) * ru, cv + Math.sin(t1) * rv),
        color: FURN,
      });
    }
  };

  const hu = w / 2, hv = d / 2;
  const cat = entry.category;
  const tags = entry.tags || [];
  const isRound = tags.includes('round') || /round|circ/.test(entry.id);

  if (cat === 'plants' || (cat === 'lighting' && entry.anchor === 'floor')) {
    ellipse(0, 0, hu, hv);
    if (cat === 'plants') ellipse(0, 0, hu * 0.35, hv * 0.35, 12);
    else { line(-hu, 0, hu, 0); line(0, -hv, 0, hv); }
  } else if (isRound) {
    ellipse(0, 0, hu, hv);
    ellipse(0, 0, hu * 0.72, hv * 0.72);
  } else if (cat === 'seating' && (tags.includes('lounge') || w > 1.2)) {
    box(hu, hv);                                   // sofa: back, arms, cushions
    line(-hu, -hv + d * 0.26, hu, -hv + d * 0.26);
    line(-hu + w * 0.14, -hv + d * 0.26, -hu + w * 0.14, hv);
    line(hu - w * 0.14, -hv + d * 0.26, hu - w * 0.14, hv);
  } else if (cat === 'seating') {
    box(hu, hv);                                   // chair: seat, plus the back
    line(-hu, -hv + d * 0.22, hu, -hv + d * 0.22);
  } else if (cat === 'beds') {
    box(hu, hv);                                   // bed: pillows and the turn-down
    line(-hu, -hv + d * 0.22, hu, -hv + d * 0.22);
    line(-hu, -hv + d * 0.42, hu, -hv + d * 0.42);
    line(0, -hv, 0, -hv + d * 0.22);
  } else if (cat === 'sanitary') {
    box(hu, hv);
    if (/wc|toilet/.test(entry.id)) ellipse(0, hv * 0.15, hu * 0.62, hv * 0.5, 16);
    else ellipse(0, 0, hu * 0.72, hv * 0.62, 16);  // basin or bath bowl
  } else if (cat === 'storage' || cat === 'kitchen') {
    box(hu, hv);                                   // carcass, doors and their opening
    line(-hu, hv - Math.min(d * 0.35, 0.10), hu, hv - Math.min(d * 0.35, 0.10));
    line(0, hv - Math.min(d * 0.35, 0.10), 0, hv);
  } else if (cat === 'tables' || cat === 'office') {
    box(hu, hv);
    line(-hu + w * 0.08, -hv + d * 0.08, hu - w * 0.08, -hv + d * 0.08);
    line(-hu + w * 0.08, hv - d * 0.08, hu - w * 0.08, hv - d * 0.08);
  } else {
    box(hu, hv);
  }
  return { x: f.x, z: f.z, rx: Math.max(Math.abs(hu * c) + Math.abs(hv * s), 0.05),
    rz: Math.max(Math.abs(hu * s) + Math.abs(hv * c), 0.05) };
}

/**
 * Where a room's name goes. The centroid, unless something is standing on it —
 * a room label printed over the dining table is the drawing contradicting
 * itself. Candidates walk outwards from the centroid and the first one clear of
 * every footprint AND still inside the room wins.
 */
function labelSpot(c, room, footprints, text) {
  const halfW = Math.max(0.9, text.length * 0.11);
  const halfH = 0.30;
  const clash = (x, z) => footprints.some(f =>
    Math.abs(f.x - x) < f.rx + halfW * 0.55 && Math.abs(f.z - z) < f.rz + halfH * 1.6);
  if (!clash(c.x, c.z)) return c;
  for (const step of [0.7, 1.3, 2.0, 2.8]) {
    for (const [ux, uz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      const x = c.x + ux * step, z = c.z + uz * step;
      if (!pointInPolygon(room.polygon, x, z)) continue;
      if (!clash(x, z)) return { x, z };
    }
  }
  return c;
}

function pointInPolygon(poly, x, z) {
  if (!poly || poly.length < 3) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
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
