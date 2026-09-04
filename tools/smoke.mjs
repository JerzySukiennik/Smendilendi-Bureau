#!/usr/bin/env node
// End-to-end proof that the phase-1 core works as one machine.
//
//   commission -> model (ops) -> rooms -> meshes -> analysis -> client e-mail
//   -> fixes -> analysis again -> acceptance e-mail
//
// Run it twice in one process and assert the two transcripts are byte-identical:
// determinism is a contract requirement (ARCHITECTURE.md, "Analysis"), so the
// same model in has to produce the same e-mail out, every time.
//
//   node tools/smoke.mjs           full transcript
//   node tools/smoke.mjs --quiet   determinism check only
//
// Exits non-zero on any throw, on a failed assertion, and on a second run that
// does not match the first byte for byte.

import { generateCommission, TYPE_KEYS } from '../src/commission/index.js';
import { buildableArea, generatePlot } from '../src/commission/plot.js';
import { createModel, applyOps, rectOps, serialize, deserialize, wallLength } from '../src/model/building.js';
import { computeRooms, roomGraph, roomCentroid } from '../src/model/rooms.js';
import { buildMeshes, disposeBuilt } from '../src/model/geometry.js';
import { runAnalysis, revisionMail, acceptanceMail, clientMail, solarPosition } from '../src/analysis/index.js';
import { createLocalTransport, resetLocalHubs } from '../src/net/local.js';

// THE PLOT IS ASKED FOR, NOT ASSUMED. The house below is drawn by hand at fixed
// coordinates (18.24 x 9.64 m outer). Plots now come in six outline families,
// and a stepped, flag or wedge plot sized for the brief's 84-126 m2 footprint
// will not hold a 176 m2 rectangle — measured across 20 seeds at three
// difficulties: not one did. That is the fixture's shape problem, not the
// generator's, so the smoke replaces the commission's plot with one generated
// FOR this house: same seeded rng, difficulty as the brief, shape 'rect',
// target footprint the house's own. Everything downstream — setbacks, the
// buildable line, the protected tree, the street side, the negative controls —
// still comes from the real generator.
const HOUSE_FOOTPRINT = 18.24 * 9.64;
const HOUSE_CORNERS = [[-9.12, -7.52], [9.12, -7.52], [9.12, 2.12], [-9.12, 2.12]];   // outer faces
function pointInPolygonLocal(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function mulberry32(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SEED = 'a';
const DIFFICULTY = 0.3;
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// transcript

function makeOut() {
  const lines = [];
  const say = (s = '') => { for (const l of String(s).split('\n')) lines.push(l); };
  say.rule = (t) => { say(''); say(`== ${t} ${'='.repeat(Math.max(0, 74 - t.length))}`); say(''); };
  say.text = () => lines.join('\n');
  return say;
}

class SmokeError extends Error {}
function assert(cond, msg) { if (!cond) throw new SmokeError(`ASSERTION FAILED: ${msg}`); }

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const money = (v) => Math.round(v).toLocaleString('en-GB').replace(/,/g, ' ');
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

// ---------------------------------------------------------------------------
// the house
//
// A single-storey house for the seed-'a' commission. Every dimension is a wall
// CENTRELINE in metres; the plan is set out on the plot so that it clears the
// buildable line, the protected pine and the coverage limit.
//
//   x runs west(-) to east(+), z runs north(-) to south(+); the street is south.
//
//   north band  z -7.40 .. -5.00   services (no daylight duty)
//   corridors   z -5.00 .. -3.60   two spurs off the central hall
//   south band  z -3.60 ..  2.00   every habitable room, all on the sun

const EXT = { x0: -9.0, z0: -7.4, x1: 9.0, z1: 2.0 };
const Z_SERVICE = -5.0;      // north band / corridor
const Z_SPINE = -3.6;        // corridor / south band

// interior partitions, as centreline segments
const PARTITIONS = [
  // the south spine stops either side of the hall, which runs the full depth
  { ax: EXT.x0, az: Z_SPINE, bx: 1.8, bz: Z_SPINE },
  { ax: 3.8, az: Z_SPINE, bx: EXT.x1, bz: Z_SPINE },
  // the north spine starts at the utility, which runs from the north wall down
  // to the kitchen so that the two share a door, as the brief asks
  { ax: -6.1, az: Z_SERVICE, bx: EXT.x1, bz: Z_SERVICE },
  // full-depth cross walls: the utility/kitchen line and the two hall walls
  ...[-6.1, 1.8, 3.8].map(x => ({ ax: x, az: EXT.z0, bx: x, bz: EXT.z1 })),
  // south band cross walls
  ...[-3.2, 6.7].map(x => ({ ax: x, az: Z_SPINE, bx: x, bz: EXT.z1 })),
  // north band cross walls
  ...[-3.2, 0.0, 6.7].map(x => ({ ax: x, az: EXT.z0, bx: x, bz: Z_SERVICE })),
];

// A point inside each room, and the programme it is drawn for.
const ROOM_PLAN = [
  { at: [-7.5, -1.0], program: 'kitchen' },
  { at: [-4.65, -1.0], program: 'dining' },
  { at: [-0.7, -1.0], program: 'living' },
  { at: [2.8, -1.0], program: 'hall' },
  { at: [5.2, -1.0], program: 'bedroom_main' },
  { at: [7.8, -1.0], program: 'bedroom' },
  { at: [-7.5, -6.2], program: 'utility' },
  { at: [-4.65, -6.2], program: 'store' },
  { at: [-1.6, -6.2], program: 'bathroom' },
  { at: [0.9, -6.2], program: 'store' },
  { at: [2.8, -6.2], program: 'wc' },
  { at: [5.2, -6.2], program: 'bathroom' },
  { at: [7.8, -6.2], program: 'store' },
  { at: [-3.0, -4.3], program: 'corridor' },
  { at: [6.0, -4.3], program: 'corridor' },
];

// doors: [x, z] on the wall centreline
const DOORS = [
  { at: [2.8, 2.0], w: 1.0, h: 2.10, catalogId: 'door-entrance-1000', swing: 'in-left', note: 'front door, faces the street' },
  { at: [1.8, 0.0], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'hall to living' },
  { at: [-3.2, -2.9], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'living to dining' },
  { at: [-6.1, -2.9], w: 0.9, catalogId: 'door-internal-900', swing: 'in-right', note: 'dining to kitchen' },
  { at: [-7.5, -3.6], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'kitchen to utility' },
  { at: [-6.1, -4.3], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'utility to west corridor' },
  { at: [1.8, -4.3], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'hall to west corridor' },
  { at: [3.8, -4.3], w: 0.9, catalogId: 'door-internal-900', swing: 'in-right', note: 'hall to east corridor' },
  { at: [2.8, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'hall to guest WC' },
  { at: [-4.6, -3.6], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'west corridor to dining' },
  { at: [-0.7, -3.6], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'west corridor to living' },
  { at: [-4.6, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'west corridor to store' },
  { at: [-1.6, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'west corridor to bathroom' },
  { at: [0.9, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'west corridor to boot store' },
  { at: [5.2, -3.6], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'east corridor to main bedroom' },
  { at: [7.8, -3.6], w: 0.9, catalogId: 'door-internal-900', swing: 'in-left', note: 'east corridor to second bedroom' },
  { at: [5.2, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-left', note: 'east corridor to shower room' },
  { at: [7.8, -5.0], w: 0.8, catalogId: 'door-internal-800', swing: 'in-right', note: 'east corridor to store' },
];

// windows: [x, z] on the wall centreline, plus size and sill.
//
// These are the FIRST SUBMISSION's windows, and they are deliberately mean —
// a first set of drawings usually is. The client measures them against 1/8 of
// the floor area (1/12 in a kitchen) and sends them back; step (g) enlarges
// them, which is exactly the revision an architect would draw.
const WINDOWS = [
  { at: [-9.0, -1.6], w: 0.9, h: 0.8, sill: 1.00, catalogId: 'window-900x1400', note: 'kitchen, west, over the worktop' },
  { at: [-7.5, 2.0], w: 0.6, h: 0.8, sill: 0.85, catalogId: 'window-600x600', note: 'kitchen, south' },
  { at: [-4.65, 2.0], w: 1.2, h: 1.0, sill: 0.85, catalogId: 'window-1200x1400', note: 'dining, south' },
  { at: [-2.0, 2.0], w: 1.2, h: 1.0, sill: 0.85, catalogId: 'window-1200x1400', note: 'living, south' },
  { at: [0.6, 2.0], w: 1.2, h: 1.0, sill: 0.85, catalogId: 'window-1200x1400', note: 'living, south' },
  { at: [5.2, 2.0], w: 1.2, h: 1.0, sill: 0.85, catalogId: 'window-1200x1400', note: 'main bedroom, south' },
  { at: [7.4, 2.0], w: 0.6, h: 1.0, sill: 0.85, catalogId: 'window-600x600', note: 'second bedroom, south' },
  { at: [9.0, -1.0], w: 0.6, h: 1.0, sill: 0.85, catalogId: 'window-600x600', note: 'second bedroom, east' },
  { at: [-9.0, -6.2], w: 0.6, h: 0.6, sill: 1.60, catalogId: 'window-600x600', note: 'utility, west' },
  { at: [-1.6, -7.4], w: 0.6, h: 0.6, sill: 1.60, catalogId: 'window-600x600', note: 'bathroom, north' },
  { at: [5.2, -7.4], w: 0.6, h: 0.6, sill: 1.60, catalogId: 'window-600x600', note: 'shower room, north' },
];

// furniture: [catalogId, x, z, rotation in degrees]
// rot 0 faces south (+Z), 90 faces east (+X), 180 north, 270 west.
// Every piece is set out from the room's CLEAR face, with its required
// clearance measured into the room, not guessed.
const FURNITURE = [
  // kitchen — fridge on the north wall, the run along the west wall,
  // sink / hob / fridge on a 7.3 m work triangle
  ['fridge-freezer-tall', -8.55, -3.215, 0],
  ['kitchen-base-sink-800', -8.58, -1.00, 90],
  ['kitchen-base-600', -8.58, -0.30, 90],
  ['hob-induction-600', -8.62, 0.45, 90],
  ['kitchen-tall-oven', -8.58, 1.15, 90],
  // dining — the table runs north-south so its 0.80 m pull-out zones fall
  // along the long dimension of the room
  ['table-dining-4', -4.65, -0.60, 90],
  ['chair-dining', -4.65, -1.45, 0],
  ['chair-dining', -4.65, 0.25, 180],
  // living
  ['sofa-3seat', -0.70, 1.43, 180],
  ['table-coffee', -1.10, 0.10, 0],
  ['armchair-lounge', -2.55, 0.10, 90],
  ['armchair-lounge', 0.35, 0.10, 270],
  ['bookshelf-800', 1.58, -2.50, 270],
  ['sideboard-1600', 0.70, -3.315, 0],
  ['plant-ficus-large', 1.30, 1.40, 0],
  // hall — the wardrobe leaves 1.28 m of the 1.88 m hall clear
  ['wardrobe-hinged-1000', 3.44, -2.50, 270],
  // main bedroom
  ['bed-double-1600', 4.95, -1.00, 90],
  ['wardrobe-sliding-1800', 6.315, 0.90, 270],
  ['bedside-table', 4.15, -3.34, 0],
  // second bedroom
  ['bed-single-900', 8.10, -1.60, 0],
  ['wardrobe-hinged-1000', 8.58, 1.00, 270],
  // bathroom
  ['bath-1700', -2.20, -6.905, 0],
  ['basin-560', -2.75, -5.29, 180],
  ['wc-floor', -0.50, -5.41, 180],
  // shower room
  ['shower-900', 4.35, -6.83, 0],
  ['basin-560', 4.30, -5.29, 180],
  ['wc-floor', 6.29, -6.00, 270],
  // guest WC
  ['wc-floor', 2.30, -6.93, 0],
  ['basin-cloak-400', 3.30, -7.13, 0],
  // utility
  ['washing-machine', -8.55, -6.98, 0],
  ['kitchen-base-sink-800', -7.70, -6.98, 0],
  // stores
  // ... and the ficus the client will not be able to walk past: it is standing
  // in the boot-store doorway. A first submission usually has one of these.
  ['plant-ficus-large', 0.90, -5.00, 0],
  ['bookshelf-800', -5.50, -7.12, 0],
  ['bookshelf-800', 0.60, -7.12, 0],
  ['bookshelf-800', 7.40, -7.12, 0],
];

// ---------------------------------------------------------------------------
// model helpers

/** The wall whose centreline passes through (x, z), and the offset along it. */
function wallAt(model, x, z, levelId = model.levels[0].id) {
  let best = null;
  for (const id of Object.keys(model.walls).sort()) {
    const w = model.walls[id];
    if (w.levelId !== levelId) continue;
    const a = model.nodes[w.a], b = model.nodes[w.b];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) continue;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    if (t < 0 || t > 1) continue;
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d > 1e-6) continue;
    const len = Math.sqrt(len2);
    const cand = { id, offset: t * len, length: len, margin: Math.min(t, 1 - t) * len };
    if (!best || cand.margin > best.margin) best = cand;
  }
  return best;
}

function openingOps(model, list, kind) {
  const ops = [];
  for (const o of list) {
    const hit = wallAt(model, o.at[0], o.at[1]);
    assert(hit, `${kind} "${o.note}" at (${o.at}) is not on any wall`);
    assert(hit.margin >= o.w / 2 + 0.05,
      `${kind} "${o.note}" (${o.w} m) does not fit in its ${f2(hit.length)} m wall`);
    ops.push({
      t: 'opening.add', wallId: hit.id, kind,
      catalogId: o.catalogId ?? null,
      offset: Number(hit.offset.toFixed(6)),
      width: o.w, height: o.h ?? (kind === 'door' ? 2.05 : 1.40),
      sill: kind === 'door' ? 0 : o.sill,
      swing: kind === 'door' ? (o.swing ?? 'in-left') : null,
      glazingRatio: kind === 'window' ? 0.82 : 0,
    });
  }
  return ops;
}

export function buildHouse() {
  let model = createModel({ id: 'smoke-house' });
  const ops = [
    ...rectOps(EXT.x0, EXT.z0, EXT.x1, EXT.z1, { wallType: 'exterior', matInner: 'plaster', matOuter: 'render' }),
    ...PARTITIONS.map(p => ({ t: 'wall.add', ...p, wallType: 'interior', matInner: 'plaster', matOuter: 'plaster' })),
    { t: 'slab.add', polygon: [[EXT.x0, EXT.z0], [EXT.x1, EXT.z0], [EXT.x1, EXT.z1], [EXT.x0, EXT.z1]], kind: 'floor', mat: 'timberFloor' },
    { t: 'slab.add', polygon: [[EXT.x0, EXT.z0], [EXT.x1, EXT.z0], [EXT.x1, EXT.z1], [EXT.x0, EXT.z1]], kind: 'roof', mat: 'concrete' },
  ];
  model = applyOps(model, ops).model;
  model = applyOps(model, openingOps(model, DOORS, 'door')).model;
  model = applyOps(model, openingOps(model, WINDOWS, 'window')).model;
  model = applyOps(model, FURNITURE.map(([catalogId, x, z, deg]) => ({
    t: 'furniture.add', catalogId, x, z, rot: Number((deg * Math.PI / 180).toFixed(6)),
  }))).model;
  return model;
}

/** Name every room by the programme it was drawn for. */
export function nameRooms(model) {
  const res = computeRooms(model);
  const ops = [];
  const used = new Set();
  for (const spec of ROOM_PLAN) {
    let hit = null;
    for (const id of res.order) {
      const r = res.rooms[id];
      if (used.has(id)) continue;
      if (pointInside(r, spec.at[0], spec.at[1])) { hit = r; break; }
    }
    assert(hit, `no room found at (${spec.at}) for programme "${spec.program}"`);
    used.add(hit.id);
    ops.push({ t: 'room.setProgram', key: hit.id, program: spec.program });
  }
  assert(used.size === res.order.length,
    `the plan has ${res.order.length} rooms but only ${used.size} were given a programme`);
  return applyOps(model, ops).model;
}

function pointInside(room, x, z) {
  if (!ringContains(room.polygon, x, z)) return false;
  for (const h of room.holes ?? []) if (ringContains(h, x, z)) return false;
  return true;
}

function ringContains(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// the run

function report(say, rep, brief) {
  say(`score ${rep.score}/100   accepted: ${rep.accepted}   ` +
      `blockers ${rep.metrics.counts.blockers}, majors ${rep.metrics.counts.majors}, minors ${rep.metrics.counts.minors}`);
  say('');
  for (const i of rep.issues) {
    say(`  [${pad(i.severity, 7)}] ${pad(i.code, 26)} ${i.roomId ?? i.furnitureId ?? i.wallId ?? i.openingId ?? ''}`);
    say(`            ${i.clientText}`);
  }
  if (!rep.issues.length) say('  (no issues)');
  const c = rep.metrics.cost;
  say('');
  say(`cost ${money(c.total)} of ${money(c.budget)} budget  (${f1(c.costPerM2)} per m2 of floor)`);
  void brief;
}


/**
 * Two players in one office over the LocalTransport. `applyOps` on either
 * side of the wire has to land on the same bytes.
 */
async function netRoundTrip(say, model) {
  resetLocalHubs();
  const seenA = [], seenB = [];
  const a = createLocalTransport({ code: 'SMOKETEST', playerId: 'pA', nick: 'Ada', color: '#c8a06a' });
  const b = createLocalTransport({ code: 'SMOKETEST', playerId: 'pB', nick: 'Bo', color: '#6a8fc8' });
  const openA = await a.connect({ onOp: (op) => seenA.push(op) });
  const openB = await b.connect({ onOp: (op) => seenB.push(op) });
  say(`net: office ${openA.code} — ${a.nick} (host ${openA.isHost}) and ${b.nick} (host ${openB.isHost})`);

  a.sendOp({ t: 'furniture.add', catalogId: 'chair-visitor', x: 2.8, z: -1.0, rot: 0, by: 'pA', seq: 1 });
  b.sendOp({ t: 'furniture.add', catalogId: 'plant-monstera', x: 3.2, z: -0.4, rot: 0, by: 'pB', seq: 2 });
  await new Promise(r => setTimeout(r, 30));

  const mA = applyOps(model, seenA).model;
  const mB = applyOps(model, seenB).model;
  const same = serialize(mA) === serialize(mB);
  say(`net: ${a.nick} received ${seenA.length} ops, ${b.nick} received ${seenB.length}; ` +
      `the two models are ${same ? 'byte-identical' : 'DIVERGED'}`);
  a.leave(); b.leave();
  assert(seenA.length === 2 && seenB.length === 2, 'the transport did not fan both ops out to both players');
  assert(same, 'two players applying the same ops produced different models');
}

/**
 * Slide a generated plot so its buildable area is centred on the fixture house.
 * The generator centres the BOUNDARY on the origin and then insets it by an
 * asymmetric front/rear setback, so the buildable rectangle sits a few metres
 * off the origin — while the house is drawn at a fixed spot. Every absolute
 * coordinate the plot carries moves by the same vector, so the setbacks, the
 * protected tree, the neighbours and the street stay exactly as generated,
 * just relative to the house. If the buildable rectangle is smaller than the
 * house in either axis that is a real generator-sizing finding, and the assert
 * after this says so.
 */
function plotAroundHouse(plot) {
  const bb = (poly) => poly.reduce((a, [x, z]) => [Math.min(a[0], x), Math.min(a[1], z), Math.max(a[2], x), Math.max(a[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const U = bb(buildableArea(plot));
  const dx = 0.0 - (U[0] + U[2]) / 2;
  const dz = -2.70 - (U[1] + U[3]) / 2;
  const mv = ([x, z]) => [Number((x + dx).toFixed(2)), Number((z + dz).toFixed(2))];
  const out = { ...plot };
  out.boundary = plot.boundary.map(mv);
  out.trees = (plot.trees || []).map((t) => ({ ...t, x: Number((t.x + dx).toFixed(2)), z: Number((t.z + dz).toFixed(2)) }));
  out.neighbours = (plot.neighbours || []).map((n) => ({ ...n, polygon: n.polygon.map(mv) }));
  out.street = { ...plot.street, centreline: plot.street.centreline.map(mv) };
  delete out.buildable; delete out.bounds;                 // recomputed from the new boundary
  if (plot.terrain?.heightAt) {
    const h = plot.terrain.heightAt;
    out.terrain = { ...plot.terrain, heightAt: (x, z) => h(x - dx, z - dz) };
  }
  out.buildable = buildableArea(out);
  return out;
}

async function runOnce(say) {
  // -- a. the commission ---------------------------------------------------
  say.rule('a. COMMISSION');
  const commission = generateCommission(SEED, DIFFICULTY, []);
  commission.plot = plotAroundHouse(generatePlot(mulberry32(SEED + ':smoke-plot'), {
    difficulty: DIFFICULTY, targetFootprint: HOUSE_FOOTPRINT, shape: 'rect',
    aspect: 18.24 / 9.64, turn: 0,          // wide and shallow, street to the south, like the house
  }));
  {
    const poly = buildableArea(commission.plot);
    const inside = HOUSE_CORNERS.filter(([x, z]) => pointInPolygonLocal(poly, x, z)).length;
    assert(inside === 4, `the generated rectangular plot does not hold the fixture house (${inside}/4 corners inside)`);
  }
  say(`seed "${SEED}" difficulty ${DIFFICULTY} -> ${commission.id}`);
  say(`${commission.title}`);
  say(`client ${commission.client.name}${commission.client.company ? `, ${commission.client.company}` : ''} (tone: ${commission.client.tone}, quirk: ${commission.client.quirk})`);
  say(`type ${commission.type} | budget ${money(commission.budget)} | fee ${money(commission.fee)} | ${commission.deadlineDays} days | ${commission.storeys} storey(s)`);
  say(`areas net ${commission.areas.net} m2, gross ${commission.areas.gross} m2, footprint ${commission.areas.footprint} m2`);
  say(`plot ${f1(commission.plot.area)} m2, buildable ${f1(commission.plot.buildableArea)} m2, street to the ${commission.plot.street.side}`);
  say(`programme: ${commission.program.map(p => `${p.count}x ${p.name} >= ${p.minArea} m2`).join('; ')}`);
  say('');
  say('--- the brief, verbatim ---');
  say(commission.briefText);

  // the brief the analysis reads
  const brief = {
    buildingType: commission.type,
    title: commission.title,
    client: commission.client,
    budget: commission.budget,
    program: commission.program,
    constraints: commission.constraints,
    plot: commission.plot,
  };

  // -- b. the model --------------------------------------------------------
  say.rule('b. MODEL — walls, openings, furniture through applyOp');
  let model = buildHouse();
  say(`nodes ${Object.keys(model.nodes).length}  walls ${Object.keys(model.walls).length}  ` +
      `openings ${Object.keys(model.openings).length}  slabs ${Object.keys(model.slabs).length}  ` +
      `furniture ${Object.keys(model.furniture).length}  version ${model.version}`);
  model = nameRooms(model);
  say(`after naming: version ${model.version}`);
  const json = serialize(model);
  const roundTrip = deserialize(json);
  assert(serialize(roundTrip) === json, 'serialize/deserialize is not a round trip');
  say(`serialised ${json.length} bytes, round-trips clean`);

  // The transport carries the same ops the editor will: single player and
  // multiplayer are one mechanism, so this is the only place the contract can
  // be checked before the editor exists. Two players in one office send an op
  // each; both must end up with byte-identical models.
  await netRoundTrip(say, model);

  // -- c. the rooms --------------------------------------------------------
  say.rule('c. ROOMS — clear internal areas off the wall graph');
  const rooms = computeRooms(model);
  const graph = roomGraph(model, rooms);
  let clearTotal = 0;
  say(`${pad('id', 12)}${pad('programme', 14)}${padl('clear m2', 10)}${padl('perim m', 9)}${padl('doors', 7)}${padl('windows', 9)}  centroid`);
  for (const id of rooms.order) {
    const r = rooms.rooms[id];
    const c = roomCentroid(r);
    clearTotal += r.area;
    say(`${pad(id, 12)}${pad(r.program ?? '-', 14)}${padl(f2(r.area), 10)}${padl(f2(r.perimeter), 9)}` +
        `${padl(r.doors.length, 7)}${padl(r.windows.length, 9)}  (${f2(c.x)}, ${f2(c.z)})`);
  }
  const footprint = (EXT.x1 - EXT.x0) * (EXT.z1 - EXT.z0);
  say('');
  say(`${rooms.order.length} rooms, ${f2(clearTotal)} m2 clear internal, ` +
      `${f2(footprint)} m2 gross footprint (walls take ${f2(footprint - clearTotal)} m2)`);
  say(`room graph: ${graph.nodes.length} nodes, ${graph.edges.length} door edges`);
  assert(rooms.order.length === ROOM_PLAN.length, `expected ${ROOM_PLAN.length} rooms, found ${rooms.order.length}`);
  assert(clearTotal > 0.85 * footprint, 'clear area is implausibly small against the footprint');

  // -- d. the meshes -------------------------------------------------------
  say.rule('d. GEOMETRY — buildMeshes');
  const built = buildMeshes(model, {});
  let tris = 0, meshes = 0;
  built.group.traverse((o) => {
    if (!o.geometry) return;
    meshes++;
    const g = o.geometry;
    tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  });
  const bb = built.bounds;
  say(`meshes ${meshes}  triangles ${tris}  colliders ${built.colliders.length}  materials ${built.materials.size}`);
  say(`stats from the builder: ${JSON.stringify(built.stats)}`);
  say(`bounds x ${f2(bb.min.x)}..${f2(bb.max.x)}  y ${f2(bb.min.y)}..${f2(bb.max.y)}  z ${f2(bb.min.z)}..${f2(bb.max.z)}`);
  if (built.diagnostics.length) {
    say(`diagnostics (${built.diagnostics.length}):`);
    for (const d of built.diagnostics.slice(0, 12)) say(`  ${JSON.stringify(d)}`);
  } else {
    say('diagnostics: none');
  }
  assert(tris > 0, 'buildMeshes produced no triangles');
  assert(meshes > 0 && meshes < 200, `implausible mesh count ${meshes} — one draw call per wall would be a bug`);
  assert(Math.abs(bb.min.x - (EXT.x0 - 0.12)) < 0.02, `west face at ${f2(bb.min.x)}, expected ${f2(EXT.x0 - 0.12)}`);
  assert(Math.abs(bb.max.z - (EXT.z1 + 0.12)) < 0.02, `south face at ${f2(bb.max.z)}, expected ${f2(EXT.z1 + 0.12)}`);
  disposeBuilt(built);

  // -- e. the analysis -----------------------------------------------------
  say.rule('e. ANALYSIS — first submission');
  const rep1 = runAnalysis(model, brief);
  report(say, rep1, brief);
  say('');
  say('daylight, per room:');
  say(`  sun: ${rep1.metrics.daylight.sun.map(s => `${s.date} ${padl(s.hour, 2)}:00 alt ${f1(s.altitudeDeg)} az ${f1(s.azimuthDeg)}`).join(' | ')}`);
  say(`  ${pad('room', 20)}${padl('m2', 8)}${padl('glass', 8)}${pad('  ratio', 10)}${pad('need', 7)}${padl('best sun', 10)}${padl('21 Dec 12h', 12)}`);
  for (const id of Object.keys(rep1.metrics.daylight.rooms)) {
    const d = rep1.metrics.daylight.rooms[id];
    say(`  ${pad(d.name, 20)}${padl(f2(d.area), 8)}${padl(f2(d.glazedArea), 8)}${pad('  ' + d.ratio, 10)}${pad(d.required ?? '-', 7)}${padl(f1(d.bestSunPercent) + '%', 10)}${padl(f1(d.decemberNoonPercent) + '%', 12)}`);
  }
  say('');
  say('bill of quantities:');
  for (const l of rep1.metrics.cost.bill) {
    say(`  ${pad(l.trade, 13)}${pad(l.item, 40)}${padl(f2(l.qty), 10)} ${pad(l.unit, 9)}${padl(money(l.rate), 8)}${padl(money(l.total), 11)}`);
  }
  say(`  ${pad('', 13)}${pad('TOTAL', 40)}${padl('', 10)} ${pad('', 9)}${padl('', 8)}${padl(money(rep1.metrics.cost.total), 11)}`);
  say('');
  say(`site: ${JSON.stringify(rep1.metrics.site)}`);
  say(`access: entrances ${rep1.metrics.access.entranceCount}, required clear width ${rep1.metrics.access.requiredWidth} m, ` +
      `escape limit ${rep1.metrics.access.escapeLimit} m, wheelchair ${rep1.metrics.access.accessible}`);
  say(`programme match: ${rep1.metrics.program.program.map(p => `${p.name} ${p.matched}/${p.required}`).join(', ')}`);
  if (rep1.metrics.program.unstocked.length) {
    say(`asked for but not in the catalogue (never a complaint): ` +
      `${[...new Set(rep1.metrics.program.unstocked.map(u => u.tag))].sort().join(', ')}`);
  }

  // -- f. the revision e-mail ----------------------------------------------
  say.rule('f. THE CLIENT WRITES BACK — verbatim');
  const mail1 = revisionMail(rep1, brief);
  say(`From: ${mail1.from}`);
  say(`Subject: ${mail1.subject}`);
  say('');
  say(mail1.body);

  // -- g. the fixes --------------------------------------------------------
  say.rule('g. THE REVISION');
  const { model: fixed, notes } = applyFixes(model, rep1);
  for (const n of notes) say(`  - ${n}`);
  if (!notes.length) say('  (nothing to fix)');
  const rep2 = runAnalysis(fixed, brief);
  say('');
  report(say, rep2, brief);

  // -- h. the acceptance ---------------------------------------------------
  say.rule('h. THE CLIENT SIGNS IT OFF — verbatim');
  const mail2 = clientMail(rep2, brief);
  say(`From: ${mail2.from}`);
  say(`Subject: ${mail2.subject}`);
  say('');
  say(mail2.body);
  assert(mail2.subject === acceptanceMail(rep2, brief).subject || !rep2.accepted,
    'clientMail did not pick the acceptance letter for an accepted report');

  // -- i. negative control --------------------------------------------------
  // A module that never fires is indistinguishable from a module that is not
  // wired in — and the site module was exactly that until this run. Push the
  // same house 16 m south, over the boundary and through the protected pine,
  // and check that the engine says so in the client's own words.
  say.rule('i. NEGATIVE CONTROL — the same house, shoved 16 m into the street');
  const shoved = applyOps(fixed, Object.keys(fixed.nodes).sort().map(id => ({
    t: 'node.move', id, x: fixed.nodes[id].x, z: fixed.nodes[id].z + 16.0,
  }))).model;
  const repBad = runAnalysis(shoved, brief);
  const siteIssues = repBad.issues.filter(i => String(i.code).startsWith('SITE_'));
  say(`score ${repBad.score}/100  accepted: ${repBad.accepted}  ` +
      `blockers ${repBad.metrics.counts.blockers}, majors ${repBad.metrics.counts.majors}`);
  for (const i of siteIssues) say(`  [${pad(i.severity, 7)}] ${pad(i.code, 24)} ${i.clientText}`);
  say(`breaches: ${JSON.stringify(repBad.metrics.site.breaches)}  ` +
      `coverage ${repBad.metrics.site.coverage}%  ` +
      `nearest protected tree clearance ${JSON.stringify(repBad.metrics.site.trees.filter(t => t.protected).map(t => t.clearance))}`);
  assert(siteIssues.some(i => i.code === 'SITE_OUTSIDE_BOUNDARY'),
    'the site module did not notice a building standing in the street');
  // The protected-tree check needs its own setup now. It used to come for free,
  // because the generator deliberately planted protected trees INSIDE the
  // buildable area — "a protected tree only bites if it stands where you would
  // want to build" — so shoving the house sideways was bound to hit one. That
  // rule is gone (DESIGN-DECISIONS.md, "The plot in the editor"): a site you are
  // handed and then quietly forbidden from using is a trick, not a constraint.
  //
  // The capability still matters, though. Trees now stand in the garden, and a
  // player can absolutely extend a wall into one — so the module must still say
  // so. Test it the honest way: put a wall across a protected crown on purpose.
  const tree = (commission.plot.trees || []).find(t => t.protected);
  if (tree) {
    const onTree = applyOps(fixed, Object.keys(fixed.nodes).sort().map((id) => ({
      t: 'node.move', id,
      x: fixed.nodes[id].x + (tree.x - fixed.nodes[Object.keys(fixed.nodes).sort()[0]].x),
      z: fixed.nodes[id].z + (tree.z - fixed.nodes[Object.keys(fixed.nodes).sort()[0]].z),
    }))).model;
    const repTree = runAnalysis(onTree, brief);
    const treeIssues = repTree.issues.filter(i => i.code === 'SITE_PROTECTED_TREE');
    say(`wall walked onto the protected ${tree.species} at (${tree.x}, ${tree.z}), ` +
        `crown radius ${tree.radius} m -> ${treeIssues.length} issue(s)`);
    assert(treeIssues.length > 0,
      'the site module did not notice a wall driven through a protected tree');
  } else {
    say('no protected tree on this plot — tree check skipped');
  }
  assert(repBad.accepted === false, 'a building in the street was accepted');

  // -- j. every building type ----------------------------------------------
  // Eight building types, eight programmes, eight sets of constraints. The
  // house is the only one this test draws, but every one of them has to run
  // the five modules without throwing — including the apartment briefs, which
  // ask for flats rather than rooms.
  say.rule('j. ALL EIGHT BUILDING TYPES RUN AGAINST THIS MODEL');
  say(`${pad('type', 14)}${pad('title', 46)}${padl('score', 7)}${padl('blockers', 10)}${padl('majors', 8)}${padl('minors', 8)}`);
  const seen = new Set();
  for (let i = 0; i < 40 && seen.size < TYPE_KEYS.length; i++) {
    const c = generateCommission(`sweep-${i}`, 0.5, []);
    if (seen.has(c.type)) continue;
    seen.add(c.type);
    const b = {
      buildingType: c.type, title: c.title, client: c.client, budget: c.budget,
      program: c.program, constraints: c.constraints, plot: c.plot,
    };
    const r = runAnalysis(fixed, b);
    const mail = clientMail(r, b);
    say(`${pad(c.type, 14)}${pad(c.title.slice(0, 44), 46)}${padl(r.score, 7)}` +
        `${padl(r.metrics.counts.blockers, 10)}${padl(r.metrics.counts.majors, 8)}${padl(r.metrics.counts.minors, 8)}`);
    assert(mail.body.length > 100, `${c.type}: the client wrote nothing`);
    assert(mail.tone && mail.body.includes(c.client.name), `${c.type}: the letter is not signed`);
  }
  assert(seen.size === TYPE_KEYS.length,
    `only ${seen.size} of ${TYPE_KEYS.length} building types were exercised`);

  // -- the architect's own sanity check ------------------------------------
  say.rule('SANITY — the numbers an architect would check first');
  const decNoon = solarPosition(355, 12 - (4 * 21.0122 - 60) / 60);
  say(`solar noon, Warsaw, 21 December: ${f2(decNoon.altitude * DEG)} deg above the horizon ` +
      `(hand check 90 - 52.23 - 23.44 = 14.33)`);
  const march = solarPosition(80, 12 - (4 * 21.0122 - 60) / 60);
  say(`solar noon, Warsaw, 21 March:    ${f2(march.altitude * DEG)} deg (hand check 90 - 52.23 = 37.77)`);
  const c2 = rep2.metrics.cost;
  say(`floor area ${f2(c2.quantities.floorArea)} m2, build cost ${money(c2.total)} = ${money(c2.costPerM2)} per m2`);
  say(`budget ${money(c2.budget)}; the brief priced the job at ${money(commission.areas.gross)} m2 gross x 5 500 = ${money(commission.areas.gross * 5500)} plus site works`);
  const areas = rooms.order.map(id => rooms.rooms[id].area).sort((a, b) => a - b);
  say(`smallest room ${f2(areas[0])} m2, largest ${f2(areas[areas.length - 1])} m2`);
  assert(decNoon.altitude * DEG > 13.8 && decNoon.altitude * DEG < 14.8,
    `December solar noon altitude ${f2(decNoon.altitude * DEG)} deg is wrong for Warsaw`);
  assert(c2.costPerM2 > 2000 && c2.costPerM2 < 15000,
    `${money(c2.costPerM2)} per m2 is not a defensible build cost`);
  assert(areas[0] > 1.5, `a ${f2(areas[0])} m2 room is not a room`);

  return { commission, model, fixed, rep1, rep2, mail1, mail2 };
}

// ---------------------------------------------------------------------------
// the revision: fix what the client refuses to live with

function applyFixes(model, rep) {
  const notes = [];
  const ops = [];
  const removed = new Set();
  const resized = new Set();
  const hard = rep.issues.filter(i => i.severity === 'blocker' || i.severity === 'major');
  const rooms = computeRooms(model);

  for (const issue of hard) {
    switch (issue.code) {
      case 'DAYLIGHT_NO_GLAZING':
      case 'DAYLIGHT_RATIO_LOW': {
        // Enlarge the room's own windows until the ratio is met with margin.
        // Height is capped at a 2.10 m head — you cannot cure a dark room by
        // drawing a window through the ring beam — and width at 70 % of the
        // wall it sits in.
        const room = rooms.rooms[issue.roomId];
        if (!room || resized.has(issue.roomId)) break;
        resized.add(issue.roomId);
        const wins = room.windows.map(id => model.openings[id]).filter(Boolean);
        if (!wins.length) break;
        const need = issue.required;                       // m2 of glass wanted
        const have = wins.reduce((s, o) => s + o.width * o.height * (o.glazingRatio ?? 1), 0);
        const scale = Math.sqrt((need * 1.25) / Math.max(have, 1e-6));
        for (const o of wins) {
          const wall = model.walls[o.wallId];
          const maxW = wall ? 0.70 * wallLength(model, wall) : o.width * scale;
          ops.push({
            t: 'opening.resize', id: o.id,
            width: r3(Math.min(o.width * scale, maxW)),
            height: r3(Math.min(o.height * scale, 2.10 - (o.sill ?? 0))),
          });
        }
        const label = rep.metrics.rooms.find(r => r.id === issue.roomId)?.name ?? issue.roomId;
        notes.push(`${label}: ${wins.length} window(s) enlarged x${f2(scale)} to carry ${f2(need)} m2 of glass`);
        break;
      }
      case 'ACCESS_ROUTE_BLOCKED':
      case 'ACCESS_DOOR_SWING_BLOCKED':
      case 'ERGO_CLEARANCE_BLOCKED': {
        const f = model.furniture[issue.furnitureId];
        if (!f || removed.has(issue.furnitureId)) break;
        removed.add(issue.furnitureId);
        ops.push({ t: 'furniture.delete', id: issue.furnitureId });
        notes.push(`removed the ${f.catalogId} — ${f2(issue.measured)} m clear where it needs ${f2(issue.required)} m`);
        break;
      }
      case 'ACCESS_CLEAR_WIDTH':
        // Nothing to do on its own: every one of these is downstream of a piece
        // of furniture that is already on the list above.
        break;
      default:
        notes.push(`no automatic fix for ${issue.code} — left for the architect`);
        break;
    }
  }

  if (!ops.length) return { model, notes };
  return { model: applyOps(model, ops).model, notes };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

async function main() {
  const quiet = process.argv.includes('--quiet');
  const a = makeOut();
  await runOnce(a);
  const first = a.text();

  const b = makeOut();
  await runOnce(b);
  const second = b.text();

  if (!quiet) console.log(first);

  if (first !== second) {
    const la = first.split('\n'), lb = second.split('\n');
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.error(`\nDETERMINISM FAILED at line ${i + 1}:`);
        console.error(`  run 1: ${la[i]}`);
        console.error(`  run 2: ${lb[i]}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log('');
  console.log(`== DETERMINISM ${'='.repeat(63)}`);
  console.log('');
  console.log(`two independent runs, ${first.length} bytes each, byte-identical: PASS`);
  console.log('');
  console.log('SMOKE TEST PASSED');
}

/**
 * The audio sign-off, checked here so it cannot rot unnoticed.
 *
 * assets/audio/build/verify-signoff.mjs is what keeps "what Jurek hears is what
 * ships" true: it reads every play/music/loop call in src/ and fails if any of
 * them can produce a level other than the reviewed one. Until now the whole
 * guarantee depended on somebody remembering to type the command, and nothing
 * automated ever ran it. --fast skips the two ffmpeg passes (decode/clipping and
 * durations, ~90 s); run the script directly for those, or `npm run verify:audio`.
 *
 * Deliberately spawned rather than imported: this file is also loaded in the
 * browser (the core it exercises is view-free), and the verifier is a node-only
 * script with fs and child_process at its top level.
 */
async function verifyAudioSignoff() {
  if (process.argv.includes('--no-audio')) return;
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../assets/audio/build/verify-signoff.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--fast'], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const lines = out.split('\n');
  const failed = lines.filter((l) => l.startsWith('FAIL'));
  const passed = lines.filter((l) => l.startsWith('PASS')).length;
  console.log('');
  console.log(`== AUDIO SIGN-OFF ${'='.repeat(60)}`);
  console.log('');
  if (r.status === 0) {
    console.log(`${passed} checks passed — every call site in src/ lands on its reviewed level`);
    console.log('(ffmpeg decode/clipping and duration checks skipped; `npm run verify:audio` runs them)');
    return;
  }
  for (const l of failed) console.error(l);
  console.error('\nAUDIO SIGN-OFF FAILED — run: node assets/audio/build/verify-signoff.mjs');
  process.exit(1);
}

// Importable from a browser as well as runnable from node: the browser has no
// `process`, and the whole point of this file is that the core it exercises is
// view-free and runs in both.
const invokedDirectly = typeof process !== 'undefined' && Array.isArray(process.argv)
  && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main()
    .then(() => verifyAudioSignoff())
    .catch((err) => {
      console.error('\nSMOKE TEST FAILED');
      console.error(err && err.stack ? err.stack : String(err));
      process.exit(1);
    });
}
