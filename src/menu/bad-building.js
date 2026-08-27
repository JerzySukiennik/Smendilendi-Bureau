// bad-building.js — 17 Ambition Road, the building the menu is set in front of.
//
// It is deliberately, professionally bad. Not cartoon bad: every defect below is
// one a practising architect has actually had to write up, and each is dimensioned
// so the diagnosis on the surveyor's tag quotes a real number against a real rule.
// Every one of them is legible in silhouette from the menu camera — that was the
// selection criterion. Things that are only funny in plan (a rooflight over a
// wardrobe, a serving hatch through a load-bearing wall) were left out.
//
// SETTING OUT (metres; the whole game is metric)
//   footprint          14.40 (E-W) x 9.60 (N-S), external face to external face
//   external walls     0.30
//   FFL                +0.60 (the building sits on a 600 mm plinth)
//   ground storey      0.60 -> 4.20   (3.60 floor to floor)
//   first storey       4.20 -> 7.20   (3.00)
//   second storey      7.20 -> 9.90   (2.70)
//   parapet            9.90 -> 10.50
//   slab edge bands    0.30 deep, expressed at 4.20, 7.20 and 9.90
//
// COMPASS. The project convention (src/commission/plot.js, src/analysis/daylight.js)
// is north = -Z, south = +Z, east = +X, west = -X. The menu camera stands to the
// south-east, so the SOUTH elevation is the left half of the frame — the render
// bay that carries the signage — and the EAST elevation is the right half, which
// carries most of the crimes.

import {
  Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materialFor } from '../core/palette.js';

// --- setting out ------------------------------------------------------------

export const B = {
  x0: -7.2, x1: 7.2,
  z0: -4.8, z1: 4.8,
  wall: 0.30,
  ffl: 0.60,
  lvl: [0.60, 4.20, 7.20],
  roof: 9.90,
  parapet: 10.50,
  band: 0.30,
  signWall: { u0: -7.2, u1: 1.8 },
  curtain: { u0: 1.8, u1: 7.2 },
  door: { u0: -0.6, u1: 1.2, head: 3.00, reveal: 0.90 },
};

// --- the surveyor's schedule -------------------------------------------------
// Each entry is one hoverable tag. `at` is where the pin goes, in world metres.

export const CRIMES = [
  {
    n: 1, id: 'door-to-nowhere',
    at: new Vector3(8.15, 5.6, 4.35),
    title: 'D-04 — external door, first floor',
    text: 'Threshold 4.20 m above external ground level, opening onto a 900 x 900 mm pad with no stair, no ladder and no guarding of any kind. Guarding is required at any level change over 600 mm. Somebody has tied a length of hazard tape across it and called that a solution.',
    code: 'Part K 3.2',
  },
  {
    n: 2, id: 'fire-escape',
    at: new Vector3(8.9, 7.9, -3.4),
    title: 'External escape stair',
    text: 'Two flights, 175 mm risers, 1 100 mm balustrade — all of it correctly built, and all of it terminating at second floor against 215 mm of solid brickwork. There is no door. The escape route is itself a dead end.',
    code: 'Part B1 2.23',
  },
  {
    n: 3, id: 'ramp',
    at: new Vector3(2.25, 1.15, 6.2),
    title: 'Approach ramp',
    text: 'Rise 600 mm over a going of 1 800 mm — a gradient of 1:3. The maximum permitted on an accessible approach is 1:12, and 1:20 is preferred. There is no kerb upstand on either side, so a wheel can simply leave it.',
    code: 'Part M 1.26, Table 1',
  },
  {
    n: 4, id: 'handrail',
    at: new Vector3(3.3, 0.62, 5.05),
    title: 'Ramp handrail',
    text: 'Set 400 mm above the ramp surface. The required range is 900–1 000 mm. At 400 mm it is not a handrail, it is a trip rail, and it is on the side of a 1:3 slope.',
    code: 'Part M 1.37',
  },
  {
    n: 5, id: 'short-column',
    at: new Vector3(4.65, 5.85, 6.9),
    title: 'Colonnade — column C3',
    text: 'C1, C2 and C4 rise 7.20 m to the beam soffit. C3 stops at 4.20 m, a full storey short, leaving a 3.00 m gap and a 7.2 m span of beam unsupported at its midpoint. The structural drawing and the elevation were never reconciled.',
    code: 'Structural coordination',
  },
  {
    n: 6, id: 'balcony',
    at: new Vector3(8.6, 8.75, 3.6),
    title: 'Second-floor balcony',
    text: '2.40 m of balcony projecting 1.20 m from a blank wall. No door, no window, no hatch. The only way onto it is a ladder from the pad of door D-04, one floor below, which is itself unreachable.',
    code: 'Access — none provided',
  },
  {
    n: 7, id: 'downpipe',
    at: new Vector3(7.65, 3.6, 3.0),
    title: 'Rainwater downpipe RWP-2',
    text: '110 mm PVC-U run dead down the centreline of two windows, because the roof outlets were set out before anybody drew the elevation. The ground-floor window now opens onto a drainpipe 90 mm from the glass.',
    code: 'Elevational coordination',
  },
  {
    n: 8, id: 'window-heads',
    at: new Vector3(7.5, 6.85, -1.6),
    title: 'First-floor window heads',
    text: 'Four windows on one elevation with heads at 6.30, 6.55, 6.30 and 7.05 m. No datum, no rhythm, no reason. Two of them are 250 mm apart, which reads as a mistake rather than as a decision.',
    code: 'Elevational discipline',
  },
  {
    n: 9, id: 'head-into-slab',
    at: new Vector3(7.5, 7.2, 2.9),
    title: 'Window W-07 head',
    text: 'Head set at 7.05 m into a floor slab whose soffit is at 6.90 m. The top 150 mm of the opening is behind concrete. Internally this is not a window, it is a window with a beam across it.',
    code: 'Section / elevation clash',
  },
  {
    n: 10, id: 'chimney',
    at: new Vector3(5.3, 12.65, -3.6),
    title: 'Chimney stack',
    text: '1 500 x 900 mm of brickwork standing 2.10 m above the flat roof of a naturally ventilated office with no solid-fuel appliance, no gas appliance and no flue. Solid capped. It is a plinth for weather.',
    code: 'Part J — not applicable, which is the point',
  },
  {
    n: 11, id: 'scupper',
    at: new Vector3(0.3, 9.55, 5.5),
    title: 'Roof outlet RO-1',
    text: 'The entire 138 m² roof falls to one 300 mm scupper, which discharges over the parapet 2.4 m directly above the main entrance. No downpipe, no shoe, no gully, no channel. The stain down the render is three winters old.',
    code: 'Part H3 / BS EN 12056-3',
  },
  {
    n: 12, id: 'south-glass',
    at: new Vector3(4.5, 6.6, 5.1),
    title: 'South curtain wall',
    text: '48.6 m² of unshaded single-aspect glazing facing due south — no overhang, no fin, no brise-soleil, no blind, no coating specified. The north elevation, where the steady light is, is solid brick with two windows in it.',
    code: 'Part L / overheating, TM59',
  },
];

// ---------------------------------------------------------------------------
// A geometry accumulator. Everything is pushed into a bin per material and merged
// once, so a whole elevation costs one draw call instead of forty. Nothing is
// cloned in a loop (ARCHITECTURE.md rule 5).

class Builder {
  constructor() { this.bins = new Map(); }

  add(mat, g) {
    if (!g) return;
    let a = this.bins.get(mat);
    if (!a) { a = []; this.bins.set(mat, a); }
    a.push(g);
  }

  /** Axis-aligned box given by two opposite corners. */
  box(mat, x0, y0, z0, x1, y1, z1) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = new BoxGeometry(w, h, d);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }

  /** Centre + size + Euler rotations, applied X then Z then Y. */
  boxAt(mat, c, size, rot = {}) {
    const g = new BoxGeometry(size[0], size[1], size[2]);
    if (rot.rx) g.rotateX(rot.rx);
    if (rot.rz) g.rotateZ(rot.rz);
    if (rot.ry) g.rotateY(rot.ry);
    g.translate(c[0], c[1], c[2]);
    this.add(mat, g);
  }

  /** A bar running from (y0,z0) to (y1,z1) in a vertical plane at x = cx. */
  rakeZ(mat, cx, y0, z0, y1, z1, w, t) {
    const dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dy, dz);
    if (len < 1e-4) return;
    const g = new BoxGeometry(w, t, len);
    g.rotateX(Math.atan2(-dy, dz));
    g.translate(cx, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }

  /** A bar running from (x0,y0) to (x1,y1) in a vertical plane at z = cz. */
  rakeX(mat, cz, x0, y0, x1, y1, w, t) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const g = new BoxGeometry(len, t, w);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, cz);
    this.add(mat, g);
  }

  cyl(mat, cx, cy, cz, r, h, seg = 12) {
    const g = new CylinderGeometry(r, r, h, seg);
    g.translate(cx, cy, cz);
    this.add(mat, g);
  }

  /** A thin plane on a wall face — stains, damp patches, puddles. */
  plane(mat, w, h, cx, cy, cz, rx = 0) {
    const g = new PlaneGeometry(w, h);
    if (rx) g.rotateX(rx);
    g.translate(cx, cy, cz);
    this.add(mat, g);
  }

  build(parent, opts = {}) {
    const meshes = [];
    for (const [mat, geoms] of this.bins) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) { console.warn(`[menu] merge failed for material "${mat}"`); continue; }
      if (geoms.length > 1) for (const g of geoms) g.dispose();
      const m = new Mesh(merged, materialFor(mat));
      m.name = `building:${mat}`;
      m.castShadow = !(opts.noShadow || []).includes(mat);
      m.receiveShadow = true;
      parent.add(m);
      meshes.push(m);
    }
    this.bins.clear();
    return meshes;
  }
}

/**
 * Cut rectangular holes out of a rectangle and return the solid pieces.
 * A horizontal band sweep: split at every hole edge in v, then walk each band in
 * u, emitting the gaps between the holes that cross it. Exact, and it produces a
 * handful of boxes rather than a CSG mess — which is also how src/model/geometry.js
 * builds the player's own walls (openings are gaps in the extrusion, never booleans).
 */
export function punch(u0, u1, v0, v1, holes) {
  const eps = 1e-4;
  const cuts = new Set([v0, v1]);
  for (const h of holes) {
    if (h.v0 > v0 + eps && h.v0 < v1 - eps) cuts.add(h.v0);
    if (h.v1 > v0 + eps && h.v1 < v1 - eps) cuts.add(h.v1);
  }
  const vs = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < vs.length - 1; i++) {
    const va = vs[i], vb = vs[i + 1];
    if (vb - va < eps) continue;
    const act = holes
      .filter((h) => h.v0 < vb - eps && h.v1 > va + eps && h.u1 > u0 && h.u0 < u1)
      .sort((a, b) => a.u0 - b.u0);
    let cur = u0;
    for (const h of act) {
      const hu0 = Math.max(u0, h.u0), hu1 = Math.min(u1, h.u1);
      if (hu0 > cur + eps) out.push({ u0: cur, u1: hu0, v0: va, v1: vb });
      cur = Math.max(cur, hu1);
    }
    if (u1 > cur + eps) out.push({ u0: cur, u1, v0: va, v1: vb });
  }
  return out;
}

// ---------------------------------------------------------------------------

/**
 * buildBadBuilding() -> { group, meshes, crimes, anchors }
 *
 * `anchors` are the frames the menu hangs lettering on:
 *   sign      the render bay (four menu lines)
 *   roofSign  the rooftop frame (the game title)
 */
export function buildBadBuilding() {
  const group = new Group();
  group.name = 'bad-building';
  const b = new Builder();

  const { x0, x1, z0, z1, wall, ffl, roof, parapet, band } = B;
  const L1 = B.lvl[1], L2 = B.lvl[2];
  const sw = B.signWall, cw = B.curtain, d = B.door;

  // --- plinth, 600 mm, projecting 60 mm all round --------------------------
  b.box('concrete-dark', x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, ffl, z1 + 0.06);

  // --- interior: floor plates and a back wall, seen through the glazing ----
  for (const y of [ffl, L1, L2]) {
    b.box('concrete', x0 + wall, y - band, z0 + wall, x1 - wall, y, z1 - wall);
  }
  b.box('plaster', x0 + wall, ffl, z0 + wall, x1 - wall, roof, z0 + wall + 0.03);
  b.box('concrete', x0 + wall, roof - band, z0 + wall, x1 - wall, roof, z1 - wall);

  // ================= SOUTH ELEVATION (z = z1) ==============================
  for (const p of punch(sw.u0, sw.u1, 0, parapet, [
    { u0: d.u0, u1: d.u1, v0: ffl, v1: d.head },
  ])) {
    b.box('plaster-warm', p.u0, p.v0, z1 - wall, p.u1, p.v1, z1);
  }
  for (const y of [L1, L2, roof]) b.box('concrete', sw.u0, y - band, z1 + 0.005, sw.u1, y, z1 + 0.075);

  // entrance: a 900 mm reveal with the doors at the back of it
  b.box('concrete', d.u0 - 0.02, ffl, z1 - d.reveal - wall, d.u0 + 0.14, d.head, z1 - wall);
  b.box('concrete', d.u1 - 0.14, ffl, z1 - d.reveal - wall, d.u1 + 0.02, d.head, z1 - wall);
  b.box('concrete', d.u0, d.head - 0.14, z1 - d.reveal - wall, d.u1, d.head, z1 - wall);
  b.box('paving', d.u0, ffl - 0.02, z1 - d.reveal - wall, d.u1, ffl, z1);
  b.box('concrete-dark', d.u0 + 0.02, ffl, z1 - d.reveal - 0.07, d.u1 - 0.02, ffl + 2.05, z1 - d.reveal);
  b.box('glass', d.u0 + 0.08, ffl + 0.07, z1 - d.reveal - 0.055, d.u1 - 0.08, ffl + 1.99, z1 - d.reveal - 0.025);
  b.box('concrete-dark', d.u0 + 0.86, ffl, z1 - d.reveal - 0.07, d.u0 + 0.94, ffl + 2.05, z1 - d.reveal); // meeting stile
  b.box('metal-warm', d.u0 + 0.80, ffl + 0.95, z1 - d.reveal - 0.14, d.u0 + 0.84, ffl + 1.30, z1 - d.reveal - 0.08);
  b.box('metal-warm', d.u0 + 0.96, ffl + 0.95, z1 - d.reveal - 0.14, d.u1 - 0.60, ffl + 1.30, z1 - d.reveal - 0.08);
  // a lit lobby wall a metre behind the doors, so the entrance is a depth, not a hole
  b.box('plaster', d.u0 - 0.4, ffl, z1 - d.reveal - 1.60, d.u1 + 0.4, ffl + 2.90, z1 - d.reveal - 1.54);
  b.box('paving', d.u0 - 0.4, ffl - 0.03, z1 - d.reveal - 1.60, d.u1 + 0.4, ffl, z1 - d.reveal);

  // crime 12 — 5.4 x 9.0 m of unshaded south glazing, and not one shading device
  b.box('glass', cw.u0, ffl, z1 - 0.11, cw.u1, roof, z1 - 0.05);
  b.box('metal', cw.u0, ffl - 0.10, z1 - 0.15, cw.u0 + 0.12, roof, z1);
  b.box('metal', cw.u1 - 0.12, ffl - 0.10, z1 - 0.15, cw.u1, roof, z1);
  for (let i = 1; i < 5; i++) {
    const u = cw.u0 + (cw.u1 - cw.u0) * (i / 5);
    b.box('metal', u - 0.05, ffl, z1 - 0.15, u + 0.05, roof, z1 - 0.03);
  }
  for (const y of [ffl, L1, L2, roof]) {
    b.box('metal', cw.u0, y - 0.10, z1 - 0.15, cw.u1, y + 0.02, z1 - 0.03);
  }
  // a desk row behind the glass, so the building reads as occupied
  for (let i = 0; i < 3; i++) {
    const u = cw.u0 + 0.8 + i * 1.5;
    b.box('wood-light', u, L1 + 0.72, z1 - 2.1, u + 1.20, L1 + 0.76, z1 - 1.4);
    b.box('metal', u + 0.06, L1, z1 - 2.05, u + 0.13, L1 + 0.72, z1 - 1.5);
    b.box('metal', u + 1.07, L1, z1 - 2.05, u + 1.14, L1 + 0.72, z1 - 1.5);
    b.box('ink', u + 0.36, L1 + 0.76, z1 - 1.95, u + 0.86, L1 + 1.08, z1 - 1.92);
    b.box('paper', u + 0.15, L1 + 0.76, z1 - 1.75, u + 0.45, L1 + 0.77, z1 - 1.52);
  }

  // ================= EAST ELEVATION (x = x1) ===============================
  const W = (v0, v1, u0, u1) => ({ u0, u1, v0, v1 });
  const eastHoles = [
    W(1.50, 2.70, -3.0, -1.8),
    W(1.50, 3.00, -1.2, 0.3),
    W(1.80, 2.85, 2.4, 3.6),
    W(5.10, 6.30, -3.0, -1.8),
    W(5.10, 6.55, -1.2, 0.0),
    W(5.10, 6.30, 0.6, 1.8),
    W(5.10, 7.05, 2.4, 3.6),          // crimes 8 and 9
    W(L1, L1 + 2.05, 3.9, 4.8),       // crime 1 — D-04
    W(8.10, 9.30, -3.0, -1.8),
    W(8.10, 9.05, -1.0, 0.2),
  ];
  for (const p of punch(z0, z1, 0, parapet, eastHoles)) {
    b.box('brick', x1 - wall, p.v0, p.u0, x1, p.v1, p.u1);
  }
  for (const y of [L1, L2, roof]) b.box('concrete', x1 + 0.005, y - band, z0, x1 + 0.075, y, z1);

  for (const h of eastHoles) {
    const isDoor = Math.abs(h.v0 - L1) < 1e-6;
    b.box(isDoor ? 'wood-mid' : 'glass', x1 - wall + 0.09, h.v0 + 0.05, h.u0 + 0.05, x1 - wall + 0.15, h.v1 - 0.05, h.u1 - 0.05);
    b.box('ink', x1 - wall + 0.05, h.v0, h.u0, x1 - wall + 0.09, h.v1, h.u1);
    if (!isDoor) {
      b.box('concrete', x1 - 0.04, h.v0 - 0.08, h.u0 - 0.06, x1 + 0.10, h.v0, h.u1 + 0.06);
      // one glazing bar, so a window reads as a window at 25 m
      const mid = (h.u0 + h.u1) / 2;
      b.box('ink', x1 - wall + 0.05, h.v0, mid - 0.03, x1 - wall + 0.10, h.v1, mid + 0.03);
    }
  }

  // crime 1 — a 900 x 900 pad and a length of hazard tape
  b.box('concrete', x1, L1 - 0.15, 3.9, x1 + 0.90, L1, 4.80);
  b.rakeZ('accent', x1 + 0.46, L1 + 1.35, 3.92, L1 + 0.70, 4.78, 0.03, 0.10);

  // crime 6 — the balcony with no way onto it
  b.box('concrete', x1, L2 - 0.15, 2.4, x1 + 1.20, L2, 4.80);
  b.box('metal', x1 + 1.14, L2, 2.40, x1 + 1.20, L2 + 1.10, 4.80);
  b.box('metal', x1, L2 + 1.04, 2.40, x1 + 1.20, L2 + 1.10, 2.46);
  b.box('metal', x1, L2 + 1.04, 4.74, x1 + 1.20, L2 + 1.10, 4.80);
  for (let i = 0; i <= 6; i++) {
    const zz = 2.52 + i * 0.36;
    b.box('metal', x1 + 1.15, L2, zz - 0.02, x1 + 1.19, L2 + 1.04, zz + 0.02);
  }

  // crime 7 — RWP-2, 110 mm, straight down the centreline of two windows
  b.cyl('metal', x1 + 0.10, (parapet - 0.2) / 2, 3.0, 0.055, parapet - 0.2, 10);
  for (const y of [1.2, 4.0, 7.4]) b.box('metal', x1 - 0.01, y, 2.90, x1 + 0.19, y + 0.10, 3.10);
  b.box('metal', x1 - 0.01, roof - 0.60, 2.80, x1 + 0.21, roof - 0.15, 3.20);

  // crime 2 — the escape stair that arrives at solid brickwork
  buildEscapeStair(b, x1, -4.55, ffl, L1, L2);


  // crime 5 — two columns of a colonnade that never got finished. C1 rises the
  // full 7.20 m to the beam soffit; C2, 2.10 m away from it, stops at 4.20 m.
  // Standing clear of the glazing so both read against the sky in one glance.
  const colZ = z1 + 2.10;
  for (const cx of [3.60, 5.70]) {
    const top = cx === 3.60 ? L1 : L2;
    b.cyl('concrete', cx, top / 2, colZ, 0.19, top, 14);
    b.cyl('concrete', cx, top - 0.07, colZ, 0.26, 0.16, 14);
    b.box('concrete-dark', cx - 0.32, 0, colZ - 0.32, cx + 0.32, 0.20, colZ + 0.32);
  }
  b.box('concrete', 2.70, L2, colZ - 0.30, 6.60, L2 + 0.52, colZ + 0.30);

  // ================= NORTH + WEST ==========================================
  b.box('brick', x0, 0, z0, x1, parapet, z0 + wall);
  b.box('plaster-warm', x0, 0, z0, x0 + wall, parapet, z1);

  // ================= ROOF ==================================================
  b.box('concrete-dark', x0, roof, z0, x1, roof + 0.06, z1);
  for (const [a0, c0, a1, c1] of [
    [x0, z0, x1, z0 + 0.25], [x0, z1 - 0.25, x1, z1],
    [x0, z0, x0 + 0.25, z1], [x1 - 0.25, z0, x1, z1],
  ]) b.box('concrete', a0, roof, c0, a1, parapet, c1);

  // crime 10 — a chimney with no flue on a flat-roofed office
  b.box('brick', 4.55, roof, -4.05, 6.05, roof + 2.10, -3.15);
  b.box('concrete', 4.40, roof + 2.10, -4.20, 6.20, roof + 2.24, -3.00);

  // crime 11 — the whole roof drains over the front door
  b.box('concrete', 0.15, roof + 0.06, z1 - 0.30, 0.45, roof + 0.32, z1 + 0.42);
  b.box('ink', 0.13, roof + 0.02, z1 - 0.30, 0.47, roof + 0.14, z1 + 0.44);
  b.plane('concrete-dark', 0.36, 6.3, 0.30, 6.3, z1 + 0.012);          // the stain
  b.plane('concrete-dark', 1.5, 1.5, 0.30, ffl + 0.012, z1 + 1.0, -Math.PI / 2);  // the puddle

  // ================= APPROACH ==============================================
  // The entrance FFL is 600 mm up. There is a ramp and there is a flight of
  // steps, and only one of the two is legal.
  b.box('paving', -0.90, 0, z1, 1.35, ffl, z1 + 1.9);
  b.box('concrete-dark', -0.96, 0, z1, -0.90, ffl, z1 + 1.96);
  b.box('concrete-dark', -0.96, 0, z1 + 1.90, 1.41, ffl, z1 + 1.96);

  // crime 3 — 600 mm rise over 1 800 mm going
  const rTop = 1.35, rBot = 3.15, rz = z1 + 1.05;
  const rSlope = Math.atan2(-ffl, rBot - rTop);
  const rLen = Math.hypot(rBot - rTop, ffl);
  b.boxAt('concrete', [(rTop + rBot) / 2, ffl / 2 - 0.09, rz], [rLen + 0.26, 0.18, 1.55], { rz: rSlope });
  // crime 4 — and its handrail is at 400 mm
  for (const off of [-0.74, 0.74]) {
    b.rakeX('metal', rz + off, rTop - 0.1, ffl + 0.40, rBot + 0.1, 0.40, 0.05, 0.05);
    for (const t of [0.05, 0.5, 0.95]) {
      const px = rTop + (rBot - rTop) * t;
      const py = ffl * (1 - t);
      b.box('metal', px - 0.025, py - 0.05, rz + off - 0.025, px + 0.025, py + 0.40, rz + off + 0.025);
    }
  }
  // four 150 mm risers on the other side of the door, which are fine
  for (let i = 0; i < 4; i++) {
    b.box('paving', -0.90 - (4 - i) * 0.30, 0, z1, -0.90, 0.15 * (i + 1), z1 + 1.6);
  }

  // ================= ROOFTOP SIGN FRAME ====================================
  // The sign is set 750 mm behind the parapet so it reads as a mounted object
  // rather than as lettering painted on the sky, and it gets a dark backing panel
  // so pale letters have something to be pale against.
  const signY = parapet + 0.30;
  const signZ = z1 - 0.75;
  for (const sx of [-6.4, -2.0, 2.6, 6.9]) {
    b.box('metal', sx - 0.07, parapet - 0.45, signZ - 0.20, sx + 0.07, signY + 1.16, signZ - 0.08);
    b.rakeZ('metal', sx, signY + 0.60, signZ - 0.14, parapet - 0.05, signZ - 1.30, 0.06, 0.06);
    b.box('metal', sx - 0.05, parapet - 0.10, signZ - 1.40, sx + 0.05, parapet - 0.02, signZ - 0.06);
  }
  b.box('ink', -6.9, signY - 0.22, signZ - 0.14, 7.4, signY + 1.14, signZ - 0.06);
  b.box('metal', -7.0, signY - 0.30, signZ - 0.16, 7.5, signY - 0.20, signZ - 0.02);
  b.box('metal', -7.0, signY + 1.14, signZ - 0.16, 7.5, signY + 1.24, signZ - 0.02);

  const meshes = b.build(group, { noShadow: ['glass'] });

  return {
    group,
    meshes,
    crimes: CRIMES,
    anchors: {
      sign: { z: z1 + 0.085, u0: sw.u0 + 0.55, u1: sw.u1 - 0.55, top: 8.55, bottom: 4.10 },
      roofSign: { y: signY + 0.05, z: signZ - 0.055, u0: -6.55, u1: 7.05 },
    },
  };
}

/**
 * The escape stair (crime 2). 175 mm risers, 260 mm goings, 1 100 mm balustrade,
 * two 1 200 mm landings — all correct, arriving at a blank wall.
 */
function buildEscapeStair(b, xFace, zStart, ffl, L1, L2) {
  const w = 1.10;
  const x = xFace + 0.10;

  const flight = (y0, y1, zA, dir) => {
    const n = 12;
    const rise = (y1 - y0) / n;
    const going = 0.26;
    for (let i = 0; i < n; i++) {
      const za = zA + dir * i * going;
      const zb = za + dir * going;
      b.box('metal', x, y0 + i * rise, Math.min(za, zb), x + w, y0 + i * rise + 0.04, Math.max(za, zb));
    }
    const zB = zA + dir * n * going;
    for (const off of [0.02, w - 0.02]) {
      b.rakeZ('metal', x + off, y0 - 0.12, zA, y1 - 0.12, zB, 0.06, 0.24);
      b.rakeZ('metal', x + off, y0 + 0.98, zA, y1 + 0.98, zB, 0.05, 0.05);
    }
    return zB;
  };

  const z1st = flight(ffl, L1, zStart, 1);
  b.box('metal', xFace + 0.06, L1 - 0.05, z1st, xFace + 1.30, L1, z1st + 1.20);
  const z2nd = flight(L1, L2, z1st + 1.20, -1);
  b.box('metal', xFace + 0.06, L2 - 0.05, z2nd - 1.20, xFace + 1.30, L2, z2nd);

  for (const [y, za, zb] of [[L1, z1st, z1st + 1.20], [L2, z2nd - 1.20, z2nd]]) {
    b.box('metal', xFace + 1.26, y, za, xFace + 1.30, y + 1.10, zb);
    for (let i = 0; i <= 4; i++) {
      const zz = za + (zb - za) * (i / 4);
      b.box('metal', xFace + 1.24, y, zz - 0.02, xFace + 1.30, y + 1.06, zz + 0.02);
    }
  }
  for (const zz of [zStart + 0.1, z1st + 0.6]) {
    b.cyl('metal', xFace + 1.28, L2 / 2, zz, 0.05, L2, 8);
  }
}
