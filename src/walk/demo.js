// demo.js — a building to walk through when nobody handed us one.
//
// Two purposes. First, it lets the walkthrough boot on its own while the
// office, the editor and the commission generator are still being written by
// other agents: `WalkthroughMode.enter()` with no model falls back to this.
// Second, it is the FIXTURE the annoyed-NPC behaviour is proved against —
// `demoModel({ broken: true })` returns the same house with one bedroom that
// has no door and a bookcase left standing in the corridor, so the failure is
// reproducible and not a matter of waiting for one to happen.
//
// Every dimension here is one an architect would draw. The house is 12.00 x
// 9.00 m over the exterior face, 240 mm exterior wall, 120 mm partitions, a
// 2.70 m floor-to-ceiling, and a corridor at exactly 1.20 m clear — which is
// the accessible minimum, and is why the bookcase in the broken variant is
// interesting: it takes the corridor to 880 mm.

import { createModel, applyOp, rectOps } from '../model/building.js';
import { computeRooms, pointInPolygon } from '../model/rooms.js';

// Wall centrelines, in metres. The two long partitions form the corridor:
// 5.52 - 4.20 = 1.32 m between centrelines, minus 2 x 60 mm of plaster = 1.20 m
// clear, which is the figure the report will print.
const EXT = { x0: 0, z0: 0, x1: 12.0, z1: 9.0 };
const CORR_N = 4.20;
const CORR_S = 5.52;

export function demoModel({ broken = false, seed = 'demo' } = {}) {
  let model = createModel({ height: 2.70 });
  const op = (o) => { model = applyOp(model, o).model; };

  // ---- shell ------------------------------------------------------------
  for (const o of rectOps(EXT.x0, EXT.z0, EXT.x1, EXT.z1, { wallType: 'exterior', matOuter: 'render', matInner: 'plaster' })) op(o);

  // ---- the corridor ------------------------------------------------------
  op({ t: 'wall.add', ax: EXT.x0, az: CORR_N, bx: EXT.x1, bz: CORR_N, wallType: 'interior' });
  op({ t: 'wall.add', ax: EXT.x0, az: CORR_S, bx: EXT.x1, bz: CORR_S, wallType: 'interior' });

  // ---- north zone: living, kitchen/dining, main bedroom -------------------
  op({ t: 'wall.add', ax: 4.50, az: EXT.z0, bx: 4.50, bz: CORR_N, wallType: 'interior' });
  op({ t: 'wall.add', ax: 8.20, az: EXT.z0, bx: 8.20, bz: CORR_N, wallType: 'interior' });

  // ---- south zone: two bedrooms, entrance hall, bathroom -----------------
  op({ t: 'wall.add', ax: 3.60, az: CORR_S, bx: 3.60, bz: EXT.z1, wallType: 'interior' });
  op({ t: 'wall.add', ax: 7.00, az: CORR_S, bx: 7.00, bz: EXT.z1, wallType: 'interior' });
  op({ t: 'wall.add', ax: 9.20, az: CORR_S, bx: 9.20, bz: EXT.z1, wallType: 'interior' });

  // ---- openings ----------------------------------------------------------
  // Wall ids are not stable across edits, so every opening is placed by finding
  // the wall that actually contains the point — the same way the editor will.
  const cut = (x, z, spec) => {
    const w = wallAt(model, x, z);
    if (!w) { console.warn('[walk/demo] no wall at', x, z); return null; }
    const a = model.nodes[w.a], b = model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const offset = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (len || 1);
    const r = applyOp(model, { t: 'opening.add', wallId: w.id, offset, ...spec });
    model = r.model;
    return r.inverse?.id ?? null;
  };

  // Which way a door swings is not decoration. buildWalkGrid subtracts the
  // quarter disc of any leaf that opens into CIRCULATION, so a 0.90 m leaf
  // swinging into a 1.20 m corridor would leave 0.30 m and the corridor would
  // stop being a corridor. Both long partitions were drawn west to east, so
  // their normal is +z: 'in-*' swings south, 'out-*' swings north. Every room
  // door therefore opens INTO ITS ROOM, and both external doors open outwards,
  // which is what an escape route needs anyway.
  //   H1 (z = 4.20), rooms to the north -> 'out-*'
  //   H2 (z = 5.52), rooms to the south -> 'in-*'

  // front door, 1.00 x 2.10, into the entrance hall from the street side
  cut(8.10, EXT.z1, { kind: 'door', width: 1.00, height: 2.10, swing: 'out-left', catalogId: 'door-entrance-1000' });
  // back door out of the kitchen
  cut(6.30, EXT.z0, { kind: 'door', width: 0.90, height: 2.05, swing: 'out-left', catalogId: 'door-internal-900' });

  // hall -> corridor
  cut(8.10, CORR_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-right' });
  // living -> corridor
  cut(2.20, CORR_N, { kind: 'door', width: 0.90, height: 2.05, swing: 'out-left' });
  // kitchen/dining -> corridor, a doorless 1.10 m opening
  cut(6.30, CORR_N, { kind: 'opening', width: 1.10, height: 2.10 });
  // main bedroom -> corridor
  cut(10.20, CORR_N, { kind: 'door', width: 0.90, height: 2.05, swing: 'out-right' });
  // bedroom 1 -> corridor
  cut(1.80, CORR_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-left' });
  // bedroom 2 -> corridor. THE BROKEN VARIANT LEAVES THIS OUT.
  if (!broken) cut(5.30, CORR_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-left' });
  // bathroom -> corridor
  cut(10.60, CORR_S, { kind: 'door', width: 0.80, height: 2.05, swing: 'in-right' });

  // windows — 1.50 x 1.40 with an 0.85 m sill, the domestic default
  const win = (x, z, w = 1.50) => cut(x, z, { kind: 'window', width: w, height: 1.40, sill: 0.85, glazingRatio: 0.82 });
  win(1.60, EXT.z0); win(3.40, EXT.z0);
  win(9.40, EXT.z0); win(11.00, EXT.z0);
  win(1.60, EXT.z1); win(5.30, EXT.z1); win(10.40, EXT.z1, 0.90);
  win(EXT.x0, 2.10); win(EXT.x0, 7.20);
  win(EXT.x1, 2.10); win(EXT.x1, 7.20, 0.90);

  // ---- slabs -------------------------------------------------------------
  const shell = [[EXT.x0, EXT.z0], [EXT.x1, EXT.z0], [EXT.x1, EXT.z1], [EXT.x0, EXT.z1]];
  op({ t: 'slab.add', polygon: shell, kind: 'floor', mat: 'timberFloor' });
  op({ t: 'slab.add', polygon: shell, kind: 'roof', mat: 'concrete' });

  // ---- furniture ---------------------------------------------------------
  const put = (catalogId, x, z, rot = 0, extra = {}) =>
    op({ t: 'furniture.add', catalogId, x, z, rot, ...extra });
  const D = Math.PI / 2;

  // Every piece below is placed so that the 0.90 m route from its room's door
  // to the middle of the room stays open. That is not a detail: the analysis
  // grid subtracts furniture footprints, so a sofa with its back against the
  // wall the door is in makes the room unreachable, and the walkthrough would
  // be quite right to say so.

  // living room — clear 0.06-4.44 x 0.06-4.14, door at x 1.75-2.65
  put('sofa-3seat', 2.00, 0.52, 0);                 // back to the north wall
  put('table-coffee', 2.00, 1.60, 0);
  put('armchair-lounge', 0.60, 1.90, D);
  put('bookshelf-800', 4.26, 1.20, -D);
  put('plant-ficus-large', 0.55, 0.55, 0);
  put('lamp-floor', 4.15, 3.85, 0);
  put('tv-wall-55', 3.60, 4.08, Math.PI);

  // kitchen / dining — clear 4.56-8.14 x 0.06-4.14, 1.10 m opening at x 5.75-6.85
  // The run is on the east wall so the back door and the corridor opening both
  // stay clear; 4.56 to 7.54 leaves 2.98 m of floor in front of a 0.60 m run.
  put('kitchen-base-sink-800', 7.84, 0.70, -D);
  put('kitchen-base-600', 7.84, 1.50, -D);
  put('kitchen-base-600', 7.84, 2.10, -D);
  put('kitchen-tall-oven', 7.84, 2.70, -D);
  put('fridge-freezer-tall', 7.82, 3.45, -D);
  put('table-dining-6', 5.70, 2.20, 0);
  put('chair-dining', 5.10, 1.55, Math.PI);
  put('chair-dining', 5.70, 1.55, Math.PI);
  put('chair-dining', 6.30, 1.55, Math.PI);
  put('chair-dining', 5.10, 2.85, 0);
  put('chair-dining', 5.70, 2.85, 0);
  put('chair-dining', 6.30, 2.85, 0);

  // main bedroom — clear 8.26-11.94 x 0.06-4.14, door at x 9.75-10.65
  put('bed-double-1600', 9.30, 1.20, 0);
  put('bedside-table', 8.48, 0.30, 0);
  put('bedside-table', 10.35, 0.30, 0);
  put('wardrobe-hinged-1000', 11.64, 1.20, -D);

  // bedroom 1 — clear 0.06-3.54 x 5.58-8.94, door at x 1.35-2.25
  put('bed-single-900', 0.55, 7.80, 0);
  put('wardrobe-hinged-1000', 3.24, 6.30, -D);
  put('chest-drawers-800', 2.60, 8.60, Math.PI);

  // study (bedroom 2) — clear 3.66-6.94 x 5.58-8.94, door at x 4.85-5.75
  put('bed-single-900', 4.15, 7.80, 0);
  put('desk-1600', 6.50, 7.20, D);
  put('chair-task', 5.85, 7.20, -D);
  put('bookshelf-800', 4.30, 6.10, Math.PI);

  // entrance hall — clear 7.06-9.14 x 5.58-8.94
  put('wardrobe-hinged-1000', 7.36, 6.30, D);
  put('plant-monstera', 8.78, 8.20, 0);

  // bathroom — clear 9.26-11.94 x 5.58-8.94, door at x 10.20-11.00
  put('bath-1700', 10.20, 8.55, 0);
  put('basin-560', 9.60, 5.85, Math.PI);
  put('wc-floor', 11.60, 6.50, -D);
  put('washing-machine', 11.60, 7.60, -D);

  // ---- the deliberate obstruction ---------------------------------------
  if (broken) {
    // A bookcase 320 mm deep, left standing against the corridor wall by
    // somebody who ran out of room. The corridor was 1.20 m; it is now 880 mm.
    put('bookshelf-800', 3.20, 4.42, Math.PI);
  }

  // ---- names, so the classifier is not guessing --------------------------
  nameRooms(model, {
    'Living room': [2.20, 2.10],
    'Kitchen': [6.30, 2.10],
    'Main bedroom': [10.10, 2.10],
    'Corridor': [6.00, 4.86],
    'Bedroom': [1.60, 7.30],
    'Study': [5.30, 7.30],
    'Entrance hall': [8.10, 7.30],
    'Bathroom': [10.60, 7.30],
  });

  return model;
}

// ---------------------------------------------------------------------------
// A second plan, because a house cannot demonstrate what the roles system is
// for. This one is a two-group nursery: it has group rooms, a children's WC
// range, a staff room, an issuing kitchen and a store, so a kindergarten roster
// — eighteen children, two teachers, a cook and the parents at the door — has
// somewhere to be all day. It is also the load case: twenty-five people in one
// building is what the frame budget is measured against.
//
// 18.00 x 11.00 m over the exterior face. The corridor is 1.48 m clear, not
// 1.20: a nursery corridor carries eighteen children at once and doubles as the
// cloakroom, and 1.20 m is the wheelchair minimum, not a design target.

const KG = { x0: 0, z0: 0, x1: 18.0, z1: 11.0 };
const KG_N = 5.00;
const KG_S = 6.60;

export function demoKindergarten({ broken = false } = {}) {
  let model = createModel({ height: 3.00 });   // 3.00 m clear in a group room
  const op = (o) => { model = applyOp(model, o).model; };
  const cut = (x, z, spec) => {
    const w = wallAt(model, x, z);
    if (!w) { console.warn('[walk/demo] no wall at', x, z); return null; }
    const a = model.nodes[w.a], b = model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const offset = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (len || 1);
    const r = applyOp(model, { t: 'opening.add', wallId: w.id, offset, ...spec });
    model = r.model;
    return r.inverse?.id ?? null;
  };

  for (const o of rectOps(KG.x0, KG.z0, KG.x1, KG.z1, { wallType: 'exterior', matOuter: 'render', matInner: 'plaster' })) op(o);
  op({ t: 'wall.add', ax: KG.x0, az: KG_N, bx: KG.x1, bz: KG_N, wallType: 'interior' });
  op({ t: 'wall.add', ax: KG.x0, az: KG_S, bx: KG.x1, bz: KG_S, wallType: 'interior' });
  // north: two group rooms and a playroom
  op({ t: 'wall.add', ax: 6.00, az: KG.z0, bx: 6.00, bz: KG_N, wallType: 'interior' });
  op({ t: 'wall.add', ax: 12.00, az: KG.z0, bx: 12.00, bz: KG_N, wallType: 'interior' });
  // south: staff, children's WC, entrance, kitchen, store
  op({ t: 'wall.add', ax: 3.20, az: KG_S, bx: 3.20, bz: KG.z1, wallType: 'interior' });
  op({ t: 'wall.add', ax: 6.40, az: KG_S, bx: 6.40, bz: KG.z1, wallType: 'interior' });
  op({ t: 'wall.add', ax: 9.20, az: KG_S, bx: 9.20, bz: KG.z1, wallType: 'interior' });
  op({ t: 'wall.add', ax: 13.40, az: KG_S, bx: 13.40, bz: KG.z1, wallType: 'interior' });

  // Same swing logic as the house: both partitions run west to east, so their
  // normal is +z. Rooms to the north take 'out-*', rooms to the south 'in-*'.
  cut(7.80, KG.z1, { kind: 'door', width: 1.20, height: 2.10, swing: 'out-left', catalogId: 'door-double-1600' });
  cut(11.30, KG.z1, { kind: 'door', width: 0.90, height: 2.05, swing: 'out-left' });   // deliveries into the kitchen
  cut(7.80, KG_S, { kind: 'door', width: 1.00, height: 2.10, swing: 'in-right' });     // hall -> corridor
  cut(1.60, KG_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-left' });      // staff room
  cut(4.80, KG_S, { kind: 'opening', width: 1.20, height: 2.10 });                     // children's WC, no leaf
  cut(11.30, KG_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-right' });    // kitchen
  cut(15.60, KG_S, { kind: 'door', width: 0.90, height: 2.05, swing: 'in-left' });     // store
  cut(3.00, KG_N, { kind: 'door', width: 1.00, height: 2.10, swing: 'out-left' });     // group room 1
  cut(9.00, KG_N, { kind: 'door', width: 1.00, height: 2.10, swing: 'out-left' });     // group room 2
  // playroom -> corridor. THE BROKEN VARIANT LEAVES THIS OUT.
  if (!broken) cut(15.00, KG_N, { kind: 'opening', width: 1.40, height: 2.10 });

  const win = (x, z, w = 1.80, sill = 0.60) =>
    cut(x, z, { kind: 'window', width: w, height: 1.70, sill, glazingRatio: 0.84 });
  win(1.80, KG.z0); win(4.20, KG.z0);
  win(7.80, KG.z0); win(10.20, KG.z0);
  win(13.80, KG.z0); win(16.20, KG.z0);
  win(1.60, KG.z1, 1.20, 0.90); win(4.80, KG.z1, 1.20, 1.40);
  win(11.30, KG.z1, 1.20, 0.90);
  win(KG.x0, 2.40, 1.20, 0.90); win(KG.x1, 2.40, 1.20, 0.90);

  const shell = [[KG.x0, KG.z0], [KG.x1, KG.z0], [KG.x1, KG.z1], [KG.x0, KG.z1]];
  op({ t: 'slab.add', polygon: shell, kind: 'floor', mat: 'vinyl' });
  op({ t: 'slab.add', polygon: shell, kind: 'roof', mat: 'concrete' });

  const put = (catalogId, x, z, rot = 0, extra = {}) =>
    op({ t: 'furniture.add', catalogId, x, z, rot, ...extra });
  const D = Math.PI / 2;

  // group rooms 1 and 2 — tables at 0.46/0.53 m, chairs at 0.30/0.32 m seat
  for (const ox of [0, 6.00]) {
    put('kids-table-round-sm1', ox + 1.90, 1.40, 0);
    put('kids-chair-sm1', ox + 1.90, 0.55, Math.PI);
    put('kids-chair-sm1', ox + 1.10, 1.40, D);
    put('kids-chair-sm1', ox + 2.70, 1.40, -D);
    put('kids-chair-sm1', ox + 1.90, 2.25, 0);
    put('kids-table-rect-sm2', ox + 4.40, 1.20, 0);
    put('kids-chair-sm2', ox + 3.90, 0.65, Math.PI);
    put('kids-chair-sm2', ox + 4.90, 0.65, Math.PI);
    put('kids-chair-sm2', ox + 3.90, 1.75, 0);
    put('kids-chair-sm2', ox + 4.90, 1.75, 0);
    put('toy-storage-unit', ox + 5.30, 4.60, Math.PI);
    put('play-rug', ox + 1.80, 3.60, 0);
    put('nap-mat', ox + 3.40, 3.30, D);
    put('nap-mat', ox + 3.40, 4.10, D);
    put('bookshelf-800', ox + 0.30, 3.20, -D);
  }

  // playroom
  put('play-rug', 14.60, 2.20, 0);
  put('toy-storage-unit', 16.90, 1.20, -D);
  put('toy-storage-unit', 16.90, 3.20, -D);
  put('kids-table-rect-sm2', 13.40, 3.80, 0);
  put('kids-chair-sm2', 12.90, 3.20, Math.PI);
  put('kids-chair-sm2', 13.90, 3.20, Math.PI);
  put('plant-ficus-large', 12.50, 0.60, 0);

  // staff room — clear 0.06-3.14 x 6.66-10.88, door at x 1.15-2.05.
  // Nothing may stand in the 0.90 m band in front of that door: the sofa was
  // there in the first draft and the analysis grid correctly reported the staff
  // room as unreachable, which is the same defect the walkthrough is built to
  // catch in the player's own drawing.
  put('sofa-2seat', 1.60, 10.30, Math.PI);
  put('table-coffee', 1.60, 9.20, 0);
  put('chair-visitor', 0.50, 8.60, D);
  put('lockers-4', 2.85, 8.60, -D);
  put('water-cooler', 0.40, 7.10, D);

  // children's WC — 0.34 m pans and a 1.20 m basin trough, the real nursery sizes
  put('kids-wc', 3.60, 10.55, Math.PI);
  put('kids-wc', 4.30, 10.55, Math.PI);
  put('kids-wc', 5.00, 10.55, Math.PI);
  put('kids-basin-row', 5.90, 7.00, D);

  // entrance hall
  put('lockers-4', 6.85, 7.10, D);
  put('bench-waiting-3', 8.80, 7.20, -D);
  put('plant-monstera', 6.90, 10.40, 0);

  // issuing kitchen
  put('kitchen-base-sink-800', 9.80, 10.55, Math.PI);
  put('kitchen-base-600', 10.55, 10.55, Math.PI);
  put('kitchen-tall-oven', 11.25, 10.55, Math.PI);
  put('fridge-freezer-tall', 12.00, 10.53, Math.PI);
  put('dishwasher-600', 12.70, 10.55, Math.PI);
  put('table-dining-4', 10.60, 8.20, 0);

  // store
  put('shelving-gondola', 14.10, 7.20, D);
  put('shelving-gondola', 14.10, 8.80, D);
  put('printer-mfp', 17.40, 7.30, -D);

  if (broken) {
    // Somebody put the cloakroom lockers in the corridor outside the group
    // rooms, which is what always happens when the cloakroom is undersized.
    // The corridor was 1.48 m clear; the measured pinch is in the report.
    put('lockers-4', 8.20, 5.31, Math.PI);
  }

  nameRooms(model, {
    'Group room 1': [3.00, 2.40],
    'Group room 2': [9.00, 2.40],
    'Playroom': [15.00, 2.40],
    'Corridor': [9.00, 5.80],
    'Staff room': [1.60, 8.80],
    "Children's WC": [4.80, 8.80],
    'Entrance hall': [7.80, 8.80],
    'Kitchen': [11.30, 8.80],
    'Store': [15.60, 8.80],
  });
  return model;
}

export function kindergartenCommission(broken = false) {
  return {
    id: 'C-DEMOKG',
    type: 'kindergarten',
    typeName: 'two-group kindergarten',
    title: broken ? 'Nursery in Gzowo — revision B' : 'Nursery in Gzowo',
    client: { name: 'Gmina Gzowo', company: 'Gzowo Council', tone: 'formal', quirk: null },
    address: 'ul. Polna 4, Gzowo',
    budget: 2_150_000,
    fee: 148_000,
    deadlineDays: 18,
    params: { children: 24, staff: 5, storeys: 1 },
    storeys: 1,
    areas: { net: 172, gross: 198, footprint: 198 },
    program: [],
    constraints: [],
    plot: kgPlot(),
  };
}

function kgPlot() {
  const x0 = -9.0, z0 = -9.0, x1 = 27.0, z1 = 24.0;
  return {
    kind: 'rect',
    boundary: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
    setbacks: { front: 8, side: 5, rear: 8 },
    street: { side: 'south' },
    streetSides: ['south'],
    entranceFacing: 'south',
    neighbours: [],
    trees: [
      { x: -5.0, z: 1.0, radius: 4.6, height: 14.0, species: 'lime', protected: true },
      { x: 23.0, z: 2.0, radius: 3.8, height: 11.0, species: 'maple', protected: false },
      { x: 22.0, z: 19.0, radius: 3.2, height: 9.0, species: 'birch', protected: false },
      { x: -5.6, z: 18.0, radius: 3.6, height: 10.5, species: 'oak', protected: false },
      { x: 8.0, z: -6.0, radius: 3.0, height: 8.5, species: 'birch', protected: false },
    ],
    terrain: { kind: 'flat', slopePercent: 0 },
    north: 0,
    area: (x1 - x0) * (z1 - z0),
    bounds: { minX: x0, maxX: x1, minZ: z0, maxZ: z1, width: x1 - x0, depth: z1 - z0 },
  };
}

/** The commission that goes with the demo house, so the HUD has something to say. */
export function demoCommission(broken = false) {
  return {
    id: 'C-DEMO',
    type: 'house',
    typeName: 'detached house',
    title: broken ? 'House on Tyniecka — revision B' : 'House on Tyniecka',
    client: { name: 'Mr and Mrs Sukiennik', company: null, tone: 'plain', quirk: null },
    address: 'ul. Tyniecka 12, Warszawa',
    budget: 980000,
    fee: 78000,
    deadlineDays: 13,
    params: { bedrooms: 3, occupants: 4, storeys: 1 },
    storeys: 1,
    areas: { net: 92, gross: 108, footprint: 108 },
    program: [],
    constraints: [],
    plot: demoPlot(),
  };
}

function demoPlot() {
  // 26 x 22 m plot with the house set back from a street on the +z side.
  const x0 = -7.0, z0 = -6.5, x1 = 19.0, z1 = 15.5;
  return {
    kind: 'rect',
    boundary: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
    setbacks: { front: 6, side: 4, rear: 6 },
    street: { side: 'south' },
    streetSides: ['south'],
    entranceFacing: 'south',
    neighbours: [],
    trees: [
      { x: -3.4, z: -2.0, radius: 4.2, height: 12.5, species: 'lime', protected: true },
      { x: 16.0, z: -3.2, radius: 3.4, height: 9.5, species: 'birch', protected: false },
      { x: 15.6, z: 12.4, radius: 3.0, height: 8.0, species: 'maple', protected: false },
      { x: -4.2, z: 11.8, radius: 2.6, height: 7.5, species: 'oak', protected: false },
    ],
    terrain: { kind: 'flat', slopePercent: 0 },
    north: 0,
    area: (x1 - x0) * (z1 - z0),
    bounds: { minX: x0, maxX: x1, minZ: z0, maxZ: z1, width: x1 - x0, depth: z1 - z0 },
  };
}

// ---------------------------------------------------------------------------

/** The wall whose centreline passes through (x, z), within 1 mm. */
function wallAt(model, x, z) {
  let best = null, bestD = 0.02;
  for (const id in model.walls) {
    const w = model.walls[id];
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) continue;
    let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    // and the opening must fit inside the wall segment
    const len = Math.sqrt(len2);
    if (t * len < 0.45 || (1 - t) * len < 0.45) continue;
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

/** Give every room its real name, matched by a probe point inside it. */
function nameRooms(model, byName) {
  const res = computeRooms(model, model.levels[0].id);
  const names = {};
  for (const [name, [x, z]] of Object.entries(byName)) {
    for (const id of res.order) {
      const r = res.rooms[id];
      if (!pointInPolygon(r.polygon, x, z)) continue;
      if ((r.holes ?? []).some((h) => pointInPolygon(h, x, z))) continue;
      names[id] = name;
      break;
    }
  }
  model.siteMods = { ...model.siteMods, roomNames: { ...(model.siteMods.roomNames ?? {}), ...names } };
  // The names are a model change like any other; bump the version so the
  // room cache in rooms.js recomputes instead of handing back unnamed rooms.
  model.version += 1;
  return model;
}
