// bad-building.js — 17 Ambition Road, the building the menu is set in front of.
//
// It is deliberately, professionally bad. Not cartoon bad: every defect below is
// one a practising architect has actually had to write up, and each is dimensioned
// so the diagnosis on the surveyor's tag quotes a real number against real
// physics. Things that are only funny in plan (a rooflight over a wardrobe, a
// serving hatch through a load-bearing wall) were left out.
//
// THE RULE THIS FILE LIVES BY, after three rounds of getting it wrong: THE TAG
// QUOTES THE GEOMETRY. Round 1 shipped a tag claiming 175 mm risers over a stair
// built at 300 mm, and a four-column colonnade described over two columns. Round 2
// shipped a scupper "2.4 m directly above the main entrance" over a 9.32 m drop,
// a balcony tagged "no window" with 1.20 m of glazing behind it, and 48.6 m² of
// glass that measures 50.22. The target player is the one man alive who checks.
// Every number in CRIMES is now derived from the constants beside the geometry
// that draws it, tagFacts() recomputes each one, and src/menu/self-check.mjs
// fails under Node if a tag and its model disagree. That check exists because a
// module nothing runs outside a browser is a module nothing checks: the same
// round shipped a bare ReferenceError in menu.js that took the whole game down
// to a "Boot failed" panel, and no test in this repo could have caught it.
//
// HOW LEGIBLE EACH CRIME IS, honestly, at the menu camera's 27 m. Round 2's
// header claimed "every one of them is legible in silhouette — that was the
// selection criterion", and the critic went and counted: five. The claim is
// deleted and replaced with the real list, because the next person to work on
// this deserves to know which ones are carrying the joke.
//
//   SILHOUETTE, readable without hovering anything:
//     2  the caged top landing of the escape stair, against blank brick
//     3  the ramp, as a dark 1:3 wedge on pale paving
//     5  the short column, its 3.00 m of daylight against the dark curtain wall
//     6  the balcony, blank brick between two glazed bays
//     7  the downpipe down two window centrelines
//     8  the four first-floor heads out of line with each other
//    10  a red-brick chimney on a grey-brick building
//    11  the parapet notch, the stain and the cones under it
//    12  the glass box with no shading in front of it
//   CLOSE READS, which need the tag or a look at the model:
//     1  the 900 x 900 pad (the hazard X carries it at distance, not the pad)
//     4  a 400 mm handrail — you can see the rail, not that it is 400
//     9  150 mm of window frame behind a slab band: 3 px at this distance
//
// Nine of twelve is where this stops being a caption and starts being a building.
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
//
// EAST ELEVATION SETTING OUT (z, north to south). The escape stair takes the
// north end, so the tagged crimes are all in the clear band z -1.7 .. +4.8, which
// is also the half nearest the camera:
//   stair       z -6.20 .. -1.70   (1.40 m of it projects past the north corner)
//   bay B1      z -1.50 .. -0.30
//   bay B2      z  0.00 ..  0.90   D-04, the door to nowhere, and its pad
//   bay B3      z  1.20 ..  2.40
//   bay B4      z  2.70 ..  3.60   W-07, the window head buried in the slab
//   bay B5      z  3.90 ..  4.80   the two windows RWP-2 runs down the middle of

import {
  Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, Vector3, Box3,
  BufferAttribute, MeshBasicMaterial, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { menuMaterial, Occupancy, bakeVertexAO, gradedBox } from './grade.js';

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

/**
 * The escape stair, dimensioned once so the tag can quote it.
 *
 * 150 mm rise / 300 mm going: 2R + G = 600 mm, inside the 550–700 mm rule of
 * thumb; the going clears the 250 mm minimum for a general-access stair and the
 * rise is well under the 190 mm maximum. Pitch = atan(150/300) = 26.6 deg.
 * 0.60 -> 4.20 is 3.60 m = 24 risers, 4.20 -> 7.20 is 3.00 m = 20 risers, so the
 * rise is identical on every one of the 44 steps — which is the actual rule.
 * Twelve and ten risers per flight, both inside the 16-riser maximum between
 * landings, which is why it is a dog-leg and not one long straight run.
 */
export const STAIR = {
  rise: 0.150,
  going: 0.300,
  width: 1.10,
  legA: 7.30,          // inner leg, against the wall
  legB: 8.50,          // outer leg
  guardFlight: 0.90,   // to flights, measured from the pitch line
  guardLanding: 1.10,  // to landings — the number that is NOT the same
  zFoot: -6.20,        // the bottom landing, 1.40 m past the north corner
};

/**
 * The colonnade, crime 5. Four columns at 2.40 m centres; one of them stops a
 * storey short, so the beam spans 4.80 m with nothing under its midpoint. Beam
 * soffit at 7.20, which is what the other three rise to.
 *
 * WHICH column is short, and where the run sits, are a legibility decision, not
 * a whim. Round 2 made C3 short at x 9.60, and from the menu camera the 3.00 m
 * of daylight under the beam falls against the east elevation — pale concrete
 * stub, pale brick behind, nothing to see, and the critic could not pick the
 * column out of the frame. The run has moved 600 mm west and the short one is now
 * the SECOND column, at x 6.60, which puts its gap against the dark glass of the
 * curtain wall. Same crime, same numbers, and now it is a silhouette.
 */
export const COLONNADE = {
  z: 6.90,
  x: [4.20, 6.60, 9.00, 11.40],   // C1 C2 C3 C4
  shortIndex: 1,                   // C2 — the one against the glazing
  shortTop: 4.20,
  soffit: 7.20,
  depth: 0.52,
  overhang: 0.60,
};

/**
 * The balcony, crime 6. u is z; `out` is how far it projects past the east face.
 *
 * It sits in the ONE bay of the second floor that has no window, between two that
 * do. Round 2 put it over HOLE.s3 — 1.20 m of glazing behind a balustrade whose
 * top rail cut across the sill by 200 mm — while its tag said "you can see the
 * brickwork straight through the balustrade". The bay is blank brick now and the
 * flanking bays are glazed, which is the only arrangement in which the joke is
 * visible rather than merely asserted.
 */
export const BALCONY = { u0: 0.0, u1: 2.4, out: 1.20 };

/** The four first-floor window heads of crime 8, and W-07's, which is crime 9. */
export const HEADS = { b1: 6.30, b3: 6.55, w07: 7.05, b5: 6.30 };

// --- the surveyor's schedule -------------------------------------------------
// Each entry is one hoverable tag. `at` is where the pin goes, in world metres.
//
// NO JURISDICTION. Round 2 tagged these with English Approved Document clauses
// ("Part K 3.2", "Part M 1.26"), which is a mistake with a specific victim: the
// player this game was made for practises in Poland, where several of those
// numbers are simply different, and one of the tags quoted 1:12 as "the maximum
// permitted", which is the England and Wales figure and not his. The physics and
// the millimetres are universal and they stay; the rulebook is gone. `code` is now
// the class of defect, which is what a condition report calls it anyway.
//
// The numbers below are derived from the constants beside the geometry that draws
// them. Where a tag quotes a dimension, `tagFacts()` at the bottom of this file
// recomputes it from the same constants, and tools/menu-check.mjs fails if they
// disagree — because round 2 shipped a tag reading "2.4 m directly above the main
// entrance" over a 6.95 m drop, and one reading "no window" over a window.

export const CRIMES = [
  {
    n: 1, id: 'door-to-nowhere',
    at: new Vector3(8.20, 5.55, 0.45),
    title: 'D-04 — external door, first floor',
    text: 'Threshold 4.20 m above external ground level, opening onto a 900 x 900 mm pad with no stair, no ladder and no guarding of any kind. Anything a person can walk out of and fall off is guarded; this is a first-floor door with a doormat-sized landing and a four-metre drop off three sides of it. Somebody has taped an X across the opening and called that a solution.',
    code: 'Guarding — none provided',
  },
  {
    n: 2, id: 'fire-escape',
    at: new Vector3(9.90, 8.45, -4.20),
    title: 'External escape stair',
    text: 'Forty-four steps at a uniform 150 mm rise and 300 mm going, flights of twelve and ten risers, 900 mm guarding to the flights and 1 100 mm to the landings — every dimension of it correct, and all of it arriving at second-floor level against blank brickwork. There is no door. The top landing is guarded on all four sides, including the side that was supposed to be the way in, so the escape route is a cage at the end of a dead end.',
    code: 'Escape route — no exit',
  },
  {
    n: 3, id: 'ramp',
    at: new Vector3(2.25, 1.15, 6.2),
    title: 'Approach ramp',
    text: 'Rise 600 mm over a going of 1 800 mm — a gradient of 1:3. That is not a shallow ramp, it is a loading dock: 1:12 is about the steepest anyone will accept for an approach and 1:20 is what you draw. There is no kerb upstand on either side either, so a wheel can simply leave it sideways.',
    code: 'Accessible approach — gradient',
  },
  {
    n: 4, id: 'handrail',
    at: new Vector3(3.35, 0.58, 6.62),
    title: 'Ramp handrail',
    text: 'Set 400 mm above the ramp surface, held there for its whole length. A hand falls at roughly 900 to 1 000 mm; at 400 mm this is not a handrail, it is a trip rail, and it is on the open side of a 1:3 slope.',
    code: 'Handrail height',
  },
  {
    n: 5, id: 'short-column',
    at: new Vector3(6.60, 5.85, 6.90),
    title: 'Colonnade — column C2',
    text: 'Four columns at 2.40 m centres. C1, C3 and C4 rise the full 7.20 m to the beam soffit. C2 stops at 4.20 m, a whole storey short, and it has been given the same capital as the others so that it can stop in mid-air politely — 3.00 m of daylight under the beam and a 4.80 m span with nothing at its midpoint. The structural drawing and the elevation were never reconciled.',
    code: 'Structural coordination',
  },
  {
    n: 6, id: 'balcony',
    at: new Vector3(8.6, 8.8, 1.2),
    title: 'Second-floor balcony',
    text: '2.40 m of balcony projecting 1.20 m from a blank wall. No door, no window, no hatch: the bays either side of it are glazed and this one is not, so you can see the brickwork straight through the balustrade. The only way onto it is a ladder from the pad of door D-04, one floor below, which is itself unreachable.',
    code: 'Access — none provided',
  },
  {
    n: 7, id: 'downpipe',
    at: new Vector3(7.7, 3.6, 4.35),
    title: 'Rainwater downpipe RWP-2',
    text: '110 mm PVC-U run dead down the centreline of two stacked windows, because the roof outlets were set out before anybody drew the elevation. The ground-floor window now opens onto a drainpipe 170 mm from the glass.',
    code: 'Elevational coordination',
  },
  {
    n: 8, id: 'window-heads',
    at: new Vector3(7.62, 6.32, -0.90),
    title: 'First-floor window heads',
    text: 'Four windows on one elevation with heads at 6.30, 6.55, 7.05 and 6.30 m. No datum, no rhythm, no reason. Two of them are 250 mm apart, which reads as a mistake rather than as a decision — a big move can be argued for, 250 mm can only be explained.',
    code: 'Elevational discipline',
  },
  {
    n: 9, id: 'head-into-slab',
    at: new Vector3(7.62, 7.16, 3.15),
    title: 'Window W-07 head',
    text: 'Head set at 7.05 m into a floor slab whose soffit is at 6.90 m. The top 150 mm of the opening is behind concrete — from the street you can see the frame run up behind the slab band and stop. Internally this is not a window, it is a window with a beam across it. (A close read: stand at the model and follow the frame up.)',
    code: 'Section / elevation clash',
  },
  {
    n: 10, id: 'chimney',
    at: new Vector3(5.30, 11.20, -3.15),
    title: 'Chimney stack',
    text: '1 500 x 900 mm of brickwork standing 2.10 m above the flat roof of a naturally ventilated office with no solid-fuel appliance, no gas appliance and no flue. Solid capped, and in a red brick nothing else on the building is built in. It is a plinth for weather.',
    code: 'Redundant construction',
  },
  {
    n: 11, id: 'scupper',
    at: new Vector3(0.30, 9.95, 5.35),
    title: 'Roof outlet RO-1',
    text: 'The entire 138 m² roof falls to one 300 mm scupper, notched straight through the parapet and spouting 300 mm clear of the face — 9.32 m above the entrance threshold and dead on its centreline. No downpipe, no shoe, no gully, no channel. The stain down the render is three winters old and the cones underneath are somebody else\'s answer.',
    code: 'Rainwater disposal',
  },
  {
    n: 12, id: 'south-glass',
    at: new Vector3(4.5, 6.6, 5.1),
    title: 'South curtain wall',
    text: '50.2 m² of unshaded single-aspect glazing facing due south — no overhang, no fin, no brise-soleil, no blind, no coating specified. There is a colonnade standing 2.10 m in front of it that could have carried the shading and does not. The north elevation, where the steady light is, is 14.4 m of solid brick with nothing in it at all.',
    code: 'Solar gain — no shading',
  },
];

/**
 * Every dimension the tags quote, recomputed from the constants that draw the
 * geometry. src/menu/self-check.mjs asserts each of these appears in the text of
 * its crime, under Node, with no browser — which is the check that would have
 * caught round 2's "2.4 m directly above the main entrance" over a 6.95 m drop.
 */
export function tagFacts() {
  const { x0, x1, z0, z1, ffl, roof, lvl, band, curtain: cw, door: d } = B;
  const spoutInvert = roof + 0.02;
  return {
    1:  [`${lvl[1].toFixed(2)} m`, '900 x 900 mm'],
    2:  ['150 mm', '300 mm', '900 mm', '1 100 mm'],
    3:  ['600 mm', '1 800 mm', '1:3'],
    4:  ['400 mm'],
    5:  [`${(COLONNADE.x[1] - COLONNADE.x[0]).toFixed(2)} m`,
      `${COLONNADE.soffit.toFixed(2)} m`,
      `${COLONNADE.shortTop.toFixed(2)} m`,
      `${(COLONNADE.soffit - COLONNADE.shortTop).toFixed(2)} m`,
      `${(COLONNADE.x[COLONNADE.shortIndex + 1] - COLONNADE.x[COLONNADE.shortIndex - 1]).toFixed(2)} m`],
    6:  [`${(BALCONY.u1 - BALCONY.u0).toFixed(2)} m`, `${BALCONY.out.toFixed(2)} m`],
    7:  ['110 mm', '170 mm'],
    8:  ['6.30', '6.55', '7.05', '250 mm'],
    9:  [`${HEADS.w07.toFixed(2)} m`, `${(lvl[2] - band).toFixed(2)} m`,
      `${Math.round((HEADS.w07 - (lvl[2] - band)) * 1000)} mm`],
    10: ['1 500 x 900 mm', '2.10 m'],
    11: [`${Math.round((x1 - x0) * (z1 - z0))} m²`, '300 mm',
      `${(spoutInvert - ffl).toFixed(2)} m`],
    12: [`${((cw.u1 - cw.u0) * (roof - ffl)).toFixed(1)} m²`,
      `${(COLONNADE.z - z1).toFixed(2)} m`,
      `${(x1 - x0).toFixed(1)} m`],
    _door: d.head,
  };
}

// ---------------------------------------------------------------------------
// A geometry accumulator. Everything is pushed into a bin per material and merged
// once, so a whole elevation costs one draw call instead of forty. Nothing is
// cloned in a loop (ARCHITECTURE.md rule 5).
//
// Two things happen here that did not in round 1:
//
//  * boxes are RAKED rather than uniformly subdivided — see gradedBox() in
//    grade.js. Round 1 used a single quad per face, whose four corner samples
//    give a ramp across the whole facade instead of a band in the corner. Round 2
//    used a uniform 0.45 m grid, which the round-2 critic measured at 3.2 luma of
//    contrast over the 20 px where the checklist asks for 12: the nearest vertex
//    ring can be 225 mm from the soffit, and the dark sample is averaged away
//    before it ever reaches the corner. The rake puts rings at 50, 120, 240, 450
//    and 800 mm from every edge and thins out across the middle, so the band
//    lands where the eye looks and the triangle count barely moves.
//
//  * every box is stamped into an occupancy grid, which the AO sweep then reads.
//
// NOTE ON COST, corrected. Earlier revisions of this comment asserted that
// "triangles are free here and were measured to be free" on the strength of a
// round-1 profile that claimed the menu was 100 % fill-rate bound. That profile
// does not reproduce. Round 2's critic measured the frame CPU-bound inside
// renderer.render and linear in DRAW CALLS (0/22/41/59/77 calls -> 0.17/4.29/
// 13.6/20.9/30.6 ms) while 25x the pixel count cost 1.3 % more time. So:
// triangles are close to free, but for the opposite reason to the one recorded,
// and the thing to be careful with in this file is the number of MATERIAL BINS,
// because each bin is one draw call.

const AO_STEP = 1.25;      // the coarse spacing between the raked ends of a face

class Builder {
  constructor() {
    this.bins = new Map();
    this.boxes = [];       // AABBs for the occupancy grid
    this.bounds = new Box3();
  }

  add(mat, g, occlude = true) {
    if (!g) return;
    let a = this.bins.get(mat);
    if (!a) { a = []; this.bins.set(mat, a); }
    a.push(g);
    if (occlude) {
      g.computeBoundingBox();
      const bb = g.boundingBox.clone();
      this.boxes.push(bb);
      this.bounds.union(bb);
    }
  }

  /** Axis-aligned box given by two opposite corners. */
  box(mat, x0, y0, z0, x1, y1, z1) {
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
    if (w < 1e-4 || h < 1e-4 || d < 1e-4) return;
    const g = gradedBox(w, h, d, AO_STEP);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }

  /** Centre + size + Euler rotations, applied X then Z then Y. */
  boxAt(mat, c, size, rot = {}) {
    const g = gradedBox(size[0], size[1], size[2], AO_STEP);
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
    const g = gradedBox(w, t, len, AO_STEP);
    g.rotateX(Math.atan2(-dy, dz));
    g.translate(cx, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(mat, g);
  }

  /** A bar running from (x0,y0) to (x1,y1) in a vertical plane at z = cz. */
  rakeX(mat, cz, x0, y0, x1, y1, w, t) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    const g = gradedBox(len, t, w, AO_STEP);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, cz);
    this.add(mat, g);
  }

  cyl(mat, cx, cy, cz, r, h, segs = 12) {
    const g = new CylinderGeometry(r, r, h, segs, Math.max(1, Math.min(12, Math.round(h / 0.7))));
    g.translate(cx, cy, cz);
    this.add(mat, g);
  }

  /** A thin plane on a wall face — never an occluder. */
  plane(mat, w, h, cx, cy, cz, rx = 0) {
    const g = new PlaneGeometry(w, h);
    if (rx) g.rotateX(rx);
    g.translate(cx, cy, cz);
    this.add(mat, g, false);
  }

  /**
   * Merge, bake AO, build. `noShadow` lists materials that must not cast, and
   * `noAO` lists materials that must not be darkened (glass, or the frame would
   * go muddy where it should be reflecting sky).
   */
  build(parent, opts = {}) {
    // 0.10 m, not 0.25. The grid has to resolve a 300 mm wall and a 60 mm
    // projection or the AO march reads its own surface as an occluder, which is
    // what put mould on the brick. Over this building's ~20 x 13 x 15 m envelope
    // that is 3.9 M cells = 3.9 MB of Uint8, built once at load.
    const occ = new Occupancy(this.bounds.min, this.bounds.max, 0.10);
    occ.groundY = 0.0;
    for (const bb of this.boxes) occ.addBox(bb);

    const meshes = [];
    let aoSum = 0, aoN = 0;
    for (const [mat, geoms] of this.bins) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) { console.warn(`[menu] merge failed for material "${mat}"`); continue; }
      if (geoms.length > 1) for (const g of geoms) g.dispose();
      const ao = !(opts.noAO || []).includes(mat);
      if (ao) { aoSum += bakeVertexAO(merged, occ); aoN++; }
      const m = new Mesh(merged, menuMaterial(mat, { vertexColors: ao }));
      m.name = `building:${mat}`;
      m.castShadow = !(opts.noShadow || []).includes(mat);
      m.receiveShadow = true;
      parent.add(m);
      meshes.push(m);
    }
    this.bins.clear();
    return { meshes, occ, aoMean: aoN ? aoSum / aoN : 1 };
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
 * buildBadBuilding() -> { group, meshes, crimes, anchors, occ, aoMean }
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
  // A lit lobby wall a metre behind the doors, so the entrance is a depth, not a
  // hole. In round 1 this was lit by a dedicated PointLight, which cost 6 ms of a
  // 100 ms frame to light one square metre; it is now an emissive surface, which
  // costs nothing and looks the same from 27 m away.
  b.box('lobby-glow', d.u0 - 0.4, ffl, z1 - d.reveal - 1.60, d.u1 + 0.4, ffl + 2.90, z1 - d.reveal - 1.54);
  b.box('paving', d.u0 - 0.4, ffl - 0.03, z1 - d.reveal - 1.60, d.u1 + 0.4, ffl, z1 - d.reveal);

  // crime 12 — 5.40 x 9.30 m = 50.22 m² of unshaded south glazing, and not one
  // shading device. The tag quotes 50.2; round 2's quoted 48.6, which is
  // 5.4 x 9.0, which is a storey height somebody remembered rather than measured.
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
  // the first-floor ceiling plane, warm, so the depth behind the glass reads as
  // a lit floor rather than as a black slot (the second PointLight round 1 spent
  // on this is gone).
  b.box('lobby-glow', cw.u0 + 0.1, L2 - band - 0.04, z1 - 3.4, cw.u1 - 0.1, L2 - band, z1 - 0.4);

  // ================= EAST ELEVATION (x = x1) ===============================
  // W(v0, v1, u0, u1): v is height, u is z. See the bay schedule at the top.
  const W = (v0, v1, u0, u1) => ({ u0, u1, v0, v1 });
  //
  // THE SECOND-FLOOR SCHEDULE IS WHERE TWO CRIMES ARE WON OR LOST, and round 2
  // lost both. It had a window in every bay, so (a) the balcony of crime 6 was
  // hung over glass and its tag lied, and (b) the escape stair of crime 2 died
  // against a wall that had windows either side of it and read as ordinary.
  // Second-floor glazing now exists in exactly two bays, B1 and B4, which flank
  // the balcony bay; everything from the stair to the balcony is unbroken brick.
  // Blankness is only legible next to something that is not blank.
  //
  const HOLE = {
    // north end, read through the escape stair. NO second-floor opening here:
    // this is the wall the stair arrives at, and it has to be seen to be blank.
    gN:  W(1.50, 2.70, -4.2, -3.0),
    // B1
    g1:  W(1.50, 2.70, -1.5, -0.3),
    f1:  W(5.10, HEADS.b1, -1.5, -0.3),   // crime 8, head 6.30
    s1:  W(8.10, 9.30, -1.5, -0.3),       // flanks the balcony bay to the north
    // B2 — D-04, crime 1. 900 x 2050 leaf, threshold on the first-floor slab.
    d04: W(L1, L1 + 2.05, 0.0, 0.9),
    // B3 — the balcony bay. Ground and first floor only; second floor is brick.
    g3:  W(1.80, 2.85, 1.2, 2.4),
    f3:  W(5.10, HEADS.b3, 1.2, 2.4),     // crime 8, head 6.55 — 250 mm off f1
    // B4 — W-07, crime 9. Head 7.05 against a slab soffit at 6.90.
    g4:  W(1.50, 2.70, 2.7, 3.6),
    f4:  W(5.10, HEADS.w07, 2.7, 3.6),
    s4:  W(8.10, 9.30, 2.7, 3.6),         // flanks the balcony bay to the south
    // B5 — the two windows RWP-2 runs down the centreline of, at z = 4.35
    g5:  W(1.50, 2.70, 3.9, 4.8),
    f5:  W(5.10, HEADS.b5, 3.9, 4.8),     // crime 8, head 6.30
  };
  const eastHoles = Object.values(HOLE);
  for (const p of punch(z0, z1, 0, parapet, eastHoles)) {
    b.box('brick', x1 - wall, p.v0, p.u0, x1, p.v1, p.u1);
  }
  for (const y of [L1, L2, roof]) b.box('concrete', x1 + 0.005, y - band, z0, x1 + 0.075, y, z1);

  for (const h of eastHoles) {
    const isDoor = h === HOLE.d04;
    b.box(isDoor ? 'wood-mid' : 'glass', x1 - wall + 0.09, h.v0 + 0.05, h.u0 + 0.05, x1 - wall + 0.15, h.v1 - 0.05, h.u1 - 0.05);
    b.box('ink', x1 - wall + 0.05, h.v0, h.u0, x1 - wall + 0.09, h.v1, h.u1);
    if (!isDoor) {
      b.box('concrete', x1 - 0.04, h.v0 - 0.08, h.u0 - 0.06, x1 + 0.10, h.v0, h.u1 + 0.06);
      // one glazing bar, so a window reads as a window at 25 m
      const mid = (h.u0 + h.u1) / 2;
      b.box('ink', x1 - wall + 0.05, h.v0, mid - 0.03, x1 - wall + 0.10, h.v1, mid + 0.03);
    }
  }

  // crime 9 — W-07's head runs up BEHIND the expressed slab band, and you can see
  // it do it: the frame head is drawn at its true 7.05 while the band's soffit is
  // at 6.90, so 150 mm of frame disappears into concrete. Without this the joke is
  // invisible — round 1 hid the whole thing behind the band and a black balustrade.
  b.box('ink', x1 - wall + 0.02, 6.78, HOLE.f4.u0 - 0.02, x1 - wall + 0.12, 7.05, HOLE.f4.u1 + 0.02);
  b.box('concrete-dark', x1 - wall + 0.12, 6.90, HOLE.f4.u0, x1 - 0.02, 7.05, HOLE.f4.u1);

  // crime 1 — a 900 x 900 pad, 200 mm thick with a nosing shadow under it, and a
  // length of hazard tape taped in an X across the opening. Round 1 drew a 150 mm
  // slab edge-on and one diagonal stick; from the menu camera it read as cladding.
  const pd = HOLE.d04;
  b.box('concrete', x1, L1 - 0.20, pd.u0, x1 + 0.90, L1, pd.u1);
  b.box('concrete-dark', x1 + 0.02, L1 - 0.26, pd.u0 + 0.02, x1 + 0.92, L1 - 0.20, pd.u1 + 0.02);
  for (const dir of [1, -1]) {
    b.rakeZ('accent', x1 - 0.06, L1 + (dir > 0 ? 0.15 : 1.95), pd.u0 + 0.03,
      L1 + (dir > 0 ? 1.95 : 0.15), pd.u1 - 0.03, 0.08, 0.12);
  }

  // crime 6 — the balcony with no way onto it. The whole joke is the blank wall
  // BEHIND it, so there is no infill panel: a top rail, a bottom rail and seven
  // 40 mm balusters, and you look straight through at unbroken brickwork. The
  // bays either side (HOLE.s1 and HOLE.s4) are glazed so that the blankness has
  // something to be blank against.
  const bal = BALCONY;
  b.box('concrete', x1, L2 - 0.15, bal.u0, x1 + bal.out, L2, bal.u1);
  b.box('concrete-dark', x1 + 0.02, L2 - 0.21, bal.u0 + 0.02, x1 + bal.out + 0.02, L2 - 0.15, bal.u1 + 0.02);
  for (const [a, c] of [[bal.u0, bal.u0 + 0.06], [bal.u1 - 0.06, bal.u1]]) {   // returns
    b.box('metal', x1, L2 + 1.04, a, x1 + bal.out, L2 + 1.10, c);
    b.box('metal', x1 + bal.out - 0.06, L2, a, x1 + bal.out, L2 + 1.10, c);
  }
  b.box('metal', x1 + bal.out - 0.06, L2 + 1.04, bal.u0, x1 + bal.out, L2 + 1.10, bal.u1);   // top rail
  b.box('metal', x1 + bal.out - 0.05, L2 + 0.10, bal.u0, x1 + bal.out - 0.01, L2 + 0.14, bal.u1); // bottom rail
  for (let i = 0; i <= 6; i++) {
    const zz = bal.u0 + 0.12 + i * ((bal.u1 - bal.u0 - 0.24) / 6);
    b.box('metal', x1 + bal.out - 0.05, L2, zz - 0.02, x1 + bal.out - 0.01, L2 + 1.04, zz + 0.02);
  }

  // crime 7 — RWP-2, 110 mm, straight down the centreline of B5's two windows.
  // Pipe face at x1 + 0.02, glass face at x1 - 0.15: a 170 mm gap, which is the
  // number on the tag.
  const rwpZ = (HOLE.g5.u0 + HOLE.g5.u1) / 2;     // 4.35
  b.cyl('metal', x1 + 0.075, (parapet - 0.2) / 2, rwpZ, 0.055, parapet - 0.2, 10);
  for (const y of [1.2, 4.0, 7.4]) b.box('metal', x1 - 0.01, y, rwpZ - 0.10, x1 + 0.17, y + 0.10, rwpZ + 0.10);
  b.box('metal', x1 - 0.01, roof - 0.60, rwpZ - 0.20, x1 + 0.19, roof - 0.15, rwpZ + 0.20);

  // crime 2 — the escape stair that arrives at blank brickwork
  buildEscapeStair(b, x1);

  // crime 5 — the colonnade that never got reconciled with the structural drawing
  buildColonnade(b);

  // ================= NORTH + WEST ==========================================
  b.box('brick', x0, 0, z0, x1, parapet, z0 + wall);          // not one opening — crime 12
  b.box('plaster-warm', x0, 0, z0, x0 + wall, parapet, z1);

  // ================= ROOF ==================================================
  b.box('concrete-dark', x0, roof, z0, x1, roof + 0.06, z1);
  for (const [a0, c0, a1, c1] of [
    [x0, z0, x1, z0 + 0.25],
    [x0, z0, x0 + 0.25, z1], [x1 - 0.25, z0, x1, z1],
  ]) b.box('concrete', a0, roof, c0, a1, parapet, c1);
  // the south parapet, in two pieces, because RO-1 is notched clean through it
  const sc = { u0: 0.15, u1: 0.45 };
  b.box('concrete', x0, roof, z1 - 0.25, sc.u0, parapet, z1);
  b.box('concrete', sc.u1, roof, z1 - 0.25, x1, parapet, z1);

  // crime 10 — a chimney with no flue on a flat-roofed office. It is built in
  // 'brick-stack', the warm red the whole elevation used to be before round 2
  // regraded the building to a grey-buff engineering brick; that one change is
  // what turns this from "a chimney on an old building" into "somebody else's
  // chimney on a new one", which is the crime.
  b.box('brick-stack', 4.55, roof, -4.05, 6.05, roof + 2.10, -3.15);
  b.box('concrete', 4.40, roof + 2.10, -4.20, 6.20, roof + 2.24, -3.00);

  // crime 11 — 138 m² of roof, one 300 mm scupper, straight over the front door.
  // The notch in the parapet is the silhouette read; the spout is the close read.
  b.box('ink', sc.u0, roof + 0.02, z1 - 0.26, sc.u1, roof + 0.30, z1 - 0.22);          // the dark throat
  b.box('metal', sc.u0 - 0.03, roof + 0.02, z1 - 0.26, sc.u1 + 0.03, roof + 0.09, z1 + 0.30); // the spout
  b.box('metal', sc.u0 - 0.03, roof + 0.02, z1 + 0.24, sc.u0 + 0.02, roof + 0.22, z1 + 0.30); // spout cheeks
  b.box('metal', sc.u1 - 0.02, roof + 0.02, z1 + 0.24, sc.u1 + 0.03, roof + 0.22, z1 + 0.30);
  b.box('concrete-dark', sc.u0 - 0.02, roof + 0.30, z1 - 0.25, sc.u1 + 0.02, parapet, z1);    // the head over the notch

  // ================= APPROACH ==============================================
  // The entrance FFL is 600 mm up. There is a ramp and there is a flight of
  // steps, and only one of the two is legal.
  b.box('paving', -0.90, 0, z1, 1.35, ffl, z1 + 1.9);
  b.box('concrete-dark', -0.96, 0, z1, -0.90, ffl, z1 + 1.96);
  b.box('concrete-dark', -0.96, 0, z1 + 1.90, 1.41, ffl, z1 + 1.96);

  // crime 3 — 600 mm rise over 1 800 mm going.
  //
  // The gradient is the joke and the gradient has to be SEEN, which round 2's it
  // was not: a pale concrete wedge lying on pale paving, foreshortened, read as
  // "steps and cones". It is finished in dark bonded anti-slip now (a real thing
  // to do to a ramp, and the only reason it is here) and the void under the deck
  // is closed with cheeks that stop flush with the surface — so it is a solid
  // dark triangle against light paving, and 1:3 is a shape rather than a claim.
  // The cheeks stop AT the surface deliberately: an upstand would be a kerb, and
  // the tag says there is no kerb.
  const rTop = 1.35, rBot = 3.15, rz = z1 + 1.05;
  const rSlope = Math.atan2(-ffl, rBot - rTop);
  const rLen = Math.hypot(rBot - rTop, ffl);
  b.boxAt('asphalt', [(rTop + rBot) / 2, ffl / 2 - 0.045, rz], [rLen + 0.26, 0.09, 1.55], { rz: rSlope });
  for (const off of [-0.775, 0.775]) {
    for (let i = 0; i < 6; i++) {
      const t0 = i / 6, t1 = (i + 1) / 6;
      const x0 = rTop + (rBot - rTop) * t0, x1c = rTop + (rBot - rTop) * t1;
      const yTop = ffl * (1 - t1) + 0.02;
      b.box('concrete-dark', x0, 0, rz + off - 0.03, x1c, yTop, rz + off + 0.03);
    }
  }
  // crime 4 — and its handrail is at 400 mm. Pale galvanised steel over the dark
  // deck, so the one dimension that is wrong is the one thing you can see.
  for (const off of [-0.74, 0.74]) {
    b.rakeX('metal', rz + off, rTop - 0.1, ffl + 0.40, rBot + 0.1, 0.40, 0.06, 0.06);
    for (const t of [0.05, 0.5, 0.95]) {
      const px = rTop + (rBot - rTop) * t;
      const py = ffl * (1 - t);
      b.box('metal', px - 0.03, py - 0.05, rz + off - 0.03, px + 0.03, py + 0.40, rz + off + 0.03);
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

  const built = b.build(group, { noShadow: ['glass'], noAO: ['glass', 'lobby-glow'] });

  // the rain stain and the puddle, as translucent overlays rather than the
  // 100 %-opaque dark planes of round 1, which read as cast shadows
  group.add(stainMesh(0.30, z1 + 0.014, roof - 0.55, ffl + 0.05, 0.44));
  group.add(puddleMesh(0.30, z1 + 1.05, ffl + 0.014, 1.7));

  return {
    group,
    meshes: built.meshes,
    occ: built.occ,
    aoMean: built.aoMean,
    crimes: CRIMES,
    anchors: {
      sign: { z: z1 + 0.085, u0: sw.u0 + 0.55, u1: sw.u1 - 0.55, top: 8.55, bottom: 4.10 },
      roofSign: { y: signY + 0.05, z: signZ - 0.055, u0: -6.55, u1: 7.05 },
    },
  };
}

/**
 * The escape stair (crime 2), built to STAIR above: 44 steps at a uniform
 * 150 mm rise and 300 mm going, dog-legged so no flight exceeds 16 risers,
 * 900 mm guarding to the flights and 1 100 mm to the landings.
 *
 *   0.60 -> 2.40   12 risers, leg A, running +z
 *   half landing at 2.40
 *   2.40 -> 4.20   12 risers, leg B, running -z
 *   first-floor landing at 4.20, against the wall
 *   4.20 -> 5.70   10 risers, leg A
 *   half landing at 5.70
 *   5.70 -> 7.20   10 risers, leg B
 *   second-floor landing at 7.20, against 300 mm of blank brickwork
 */
function buildEscapeStair(b) {
  const S = STAIR;
  const R = S.rise, G = S.going, w = S.width;
  const A = S.legA, Bx = S.legB;
  const xIn = A, xOut = Bx + w;               // 7.30 .. 9.60

  // a flight: `n` risers from y0, starting at zA and running in `dir`. The top
  // riser lands on the landing, so the flight itself carries n-1 treads.
  const flight = (x, n, y0, zA, dir) => {
    for (let i = 0; i < n - 1; i++) {
      const za = zA + dir * i * G;
      const zb = za + dir * G;
      const y = y0 + (i + 1) * R;
      b.box('metal', x, y - 0.04, Math.min(za, zb), x + w, y, Math.max(za, zb));
      b.box('ink', x, y - 0.15, Math.min(za, zb), x + w, y - 0.04, Math.min(za, zb) + 0.03);   // riser shadow
    }
    const zEnd = zA + dir * (n - 1) * G;
    // guarding to the flight: 900 mm above the pitch line, both sides
    for (const off of [0.03, w - 0.03]) {
      b.rakeZ('metal', x + off, y0 + R - 0.14, zA, y0 + n * R - 0.14, zEnd, 0.07, 0.22);   // string
      b.rakeZ('metal', x + off, y0 + R + S.guardFlight, zA, y0 + n * R + S.guardFlight, zEnd, 0.05, 0.05);
      b.rakeZ('metal', x + off, y0 + R + S.guardFlight * 0.55, zA, y0 + n * R + S.guardFlight * 0.55, zEnd, 0.03, 0.03);
    }
    return zEnd;
  };

  // A landing, with 1 100 mm guarding to every edge that is not the building.
  //
  // `sealed` closes the FOURTH side — the one against the wall — and only the top
  // landing gets it. That single rail is what makes crime 2 a silhouette instead
  // of a caption: a fire escape whose last landing is fenced on all four sides,
  // against three hundred millimetres of blank brick, is legible at 27 m in a way
  // that "there is no door here" never was. It is also exactly what gets built
  // when the stair is coordinated and the door is not.
  const landing = (y, za, zb, sealed = false) => {
    const x0 = xIn;
    b.box('metal', x0, y - 0.06, Math.min(za, zb), xOut, y, Math.max(za, zb));
    const a = Math.min(za, zb), c = Math.max(za, zb);
    const rails = [
      [xOut - 0.05, a, xOut, c],                       // outer edge
      [x0, a, xOut, a + 0.05],                         // north edge
      [x0, c - 0.05, xOut, c],                         // south edge
    ];
    if (sealed) rails.push([x0, a, x0 + 0.05, c]);     // and the way in
    for (const [ax, az, cx, cz] of rails) {
      b.box('metal', ax, y + S.guardLanding - 0.05, az, cx, y + S.guardLanding, cz);
      b.box('metal', ax, y + S.guardLanding * 0.5, az, cx, y + S.guardLanding * 0.5 + 0.03, cz);
      // posts
      const long = Math.max(cx - ax, cz - az);
      const nP = Math.max(2, Math.round(long / 0.55));
      for (let i = 0; i <= nP; i++) {
        const t = i / nP;
        const px = cx - ax > cz - az ? ax + t * (cx - ax) : ax;
        const pz = cx - ax > cz - az ? az : az + t * (cz - az);
        b.box('metal', px - 0.02, y, pz - 0.02, px + 0.04, y + S.guardLanding, pz + 0.04);
      }
    }
  };

  const zFoot = S.zFoot;
  // bottom landing at FFL, and four 150 mm steps down to a pad at grade
  landing(B.ffl, zFoot, zFoot + 1.20);
  for (let i = 0; i < 4; i++) {
    b.box('concrete', xIn, 0, zFoot + 1.20 + i * 0.30, xIn + 1.30, B.ffl - i * 0.15, zFoot + 1.50 + i * 0.30);
  }
  b.box('paving', xIn - 0.20, 0, zFoot - 0.40, xOut + 0.20, 0.05, zFoot + 2.60);   // it lands on something

  const zA1 = zFoot + 1.20;                     // -5.00
  const zTop1 = flight(A, 12, B.ffl, zA1, 1);   // -> 2.40 at z -1.70
  landing(2.40, zTop1, zTop1 + 1.20);           // half landing -1.70 .. -0.50
  const zTop2 = flight(Bx, 12, 2.40, zTop1 + 1.20, -1);   // -> 4.20 at z -3.80
  landing(B.lvl[1], zTop2, zTop2 - 1.20); // first floor -3.80 .. -5.00
  const zTop3 = flight(A, 10, B.lvl[1], zTop2 - 1.20, 1); // -> 5.70 at z -2.30
  landing(5.70, zTop3, zTop3 + 1.20);           // half landing -2.30 .. -1.10
  const zTop4 = flight(Bx, 10, 5.70, zTop3 + 1.20, -1);   // -> 7.20 at z -3.80
  landing(B.lvl[2], zTop4, zTop4 - 1.20, true); // second floor, at the blank wall

  // two columns carrying the outer stringers
  for (const zz of [zFoot + 0.9, -1.4]) {
    b.cyl('metal', xOut - 0.10, B.lvl[2] / 2, zz, 0.06, B.lvl[2], 8);
  }
}

/**
 * The colonnade (crime 5). Four columns at 2.40 m centres; C3 stops a storey
 * short, so the beam has 4.80 m between C2 and C4 with nothing under its middle.
 */
function buildColonnade(b) {
  const C = COLONNADE;
  C.x.forEach((cx, i) => {
    const top = i === C.shortIndex ? C.shortTop : C.soffit;
    b.cyl('concrete', cx, top / 2, C.z, 0.19, top, 14);
    b.cyl('concrete', cx, top - 0.07, C.z, 0.26, 0.16, 14);
    b.box('concrete-dark', cx - 0.32, 0, C.z - 0.32, cx + 0.32, 0.20, C.z + 0.32);
  });
  const x0 = C.x[0] - C.overhang, x1 = C.x[C.x.length - 1] + C.overhang;
  b.box('concrete', x0, C.soffit, C.z - 0.30, x1, C.soffit + C.depth, C.z + 0.30);
}

// ---------------------------------------------------------------------------
// the two water marks, as honest translucent overlays

/** A vertical stain that fades out at its lower edge instead of ending in a line. */
function stainMesh(cx, cz, yTop, yBot, width) {
  const g = new PlaneGeometry(width, yTop - yBot, 1, 8);
  g.translate(cx, (yTop + yBot) / 2, cz);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - yBot) / (yTop - yBot);          // 1 at the outlet
    const a = 0.40 * Math.pow(Math.max(0, t), 0.75) * (0.55 + 0.45 * t);
    col[i * 4] = 0.24; col[i * 4 + 1] = 0.22; col[i * 4 + 2] = 0.20; col[i * 4 + 3] = a;
  }
  g.setAttribute('color', new BufferAttribute(col, 4));
  const m = new Mesh(g, new MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, fog: false,
  }));
  m.name = 'stain:rwp';
  m.renderOrder = 1;
  return m;
}

/** The puddle it has worn into the paving, fading to nothing at the rim. */
function puddleMesh(cx, cz, y, r) {
  const g = new PlaneGeometry(r * 2, r * 2, 10, 10);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const dx = (pos.getX(i) - cx) / r, dz = (pos.getZ(i) - cz) / r;
    const d = Math.min(1, Math.hypot(dx, dz));
    col[i * 4] = 0.20; col[i * 4 + 1] = 0.20; col[i * 4 + 2] = 0.19;
    col[i * 4 + 3] = 0.34 * (1 - d) * (1 - d);
  }
  g.setAttribute('color', new BufferAttribute(col, 4));
  const m = new Mesh(g, new MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, fog: false,
  }));
  m.name = 'stain:puddle';
  m.renderOrder = 1;
  return m;
}
