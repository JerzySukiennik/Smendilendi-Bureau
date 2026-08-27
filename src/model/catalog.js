// The component catalogue — furniture, fittings, openings, finishes and prices.
//
// VIEW-FREE. Zero imports except the local proc-shapes module (which is itself
// import-free). Must import cleanly in bare node.
//
// EVERY DIMENSION IN THIS FILE IS A REAL PRODUCT OR STANDARD DIMENSION.
// The target player is a practising architect; a wrong number here is a bug.
// Sources used while authoring, quoted in the `note` fields where relevant:
//   * internal door leaf 0.90 x 2.05 m, frame adds ~0.06 m per side (PN-EN 14351 /
//     common European leaf sizes 0.60/0.70/0.80/0.90/1.00).
//   * kitchen: base unit 0.60 deep, worktop 0.90 high, wall unit 0.35 deep with its
//     underside at 1.45; a single galley run needs 1.20 m clear, two facing runs
//     1.20-1.50 m between worktop fronts.
//   * WC pan projection 0.68-0.76 m, 0.60 m clear in front, 0.20 m each side of the
//     centre line (0.40 m from centre to any obstruction).
//   * basin 0.55-0.60 m wide, rim at 0.85 m.
//   * dining: seat 0.45 m, table top 0.74-0.76 m, 0.60 m of table edge per diner,
//     0.80 m behind a chair to pull it out and stand up.
//   * beds: single 0.90 x 2.00, double 1.60 x 2.00, king 1.80 x 2.00; 0.70 m of
//     access on at least one long side.
//   * wardrobe 0.60 deep, hinged doors need 0.60 m of swing clearance.
//   * office desk 1.60 x 0.80, 1.00 m of clear space behind a task chair.
//   * windows: typical sill 0.85, head 2.10-2.20; a bedroom escape window has its
//     sill at 0.30 so it can be climbed through.
//   * EN 1729 school furniture: size mark 1 = seat 260 mm / table 460 mm (3-4 yrs),
//     size mark 2 = seat 310 mm / table 530 mm (5-6 yrs).
//     https://www.kirkhouse.co.uk/news/en-1729-recommended-seat-table-heights.html
//   * EN 81-70 accessible lift: car 1100 x 1400 mm, 630 kg, clear door 900 mm.
//     https://www.ikoniclifts.co.uk/blog/en-81-70-lift-car-dimensions-requirements/
//   * examination couch 1900 x 620 mm, working height ~0.70 m.
//     https://examtables.com/product/couch-200-exam-table/
//   * stairs: riser 0.175, going 0.28 (2R + G = 0.63, within the 0.60-0.65 rule),
//     minimum flight width 1.00 m in a dwelling, 1.20 m in public use.
//
// Local axes, shared with proc-shapes.js and BuildingModel.furniture:
//   +x = width, +y = up, +z = depth towards the FRONT (the side the item is used
//   from). `rot` in the model rotates the item about +Y.

import { buildProcShape } from './proc-shapes.js';

export const CATEGORIES = [
  'seating', 'tables', 'storage', 'beds', 'sanitary', 'kitchen',
  'doors', 'windows', 'lighting', 'plants', 'office', 'retail',
  'education', 'clinic', 'misc',
];

const NO_CLEARANCE = { front: 0, back: 0, left: 0, right: 0 };

/** Entry builder: fills defaults and freezes the result. */
function E(o) {
  const entry = {
    id: o.id,
    name: o.name,
    category: o.category,
    file: o.file ?? null,
    size: o.size,                                  // [w, h, d] metres
    price: o.price,                                // integer, abstract units
    anchor: o.anchor ?? 'floor',                   // floor | wall | ceiling
    mount: o.mount ?? 0,                           // m: base height for wall items,
                                                   //    drop below ceiling for ceiling items
    clearance: { ...NO_CLEARANCE, ...(o.clearance ?? {}) },
    tags: o.tags ?? [],
    colorable: o.colorable ?? true,
    proc: o.proc ?? null,                          // [procFnName, ...args]
    seatHeight: o.seatHeight ?? null,
    workHeight: o.workHeight ?? null,
    opening: o.opening ?? null,                    // doors/windows only
    capacity: o.capacity ?? null,                  // people served (program analysis)
    note: o.note ?? '',
  };
  return entry;
}

// ---------------------------------------------------------------------------
// SEATING
// ---------------------------------------------------------------------------

const SEATING = [
  E({
    id: 'chair-dining', name: 'Dining chair', category: 'seating',
    file: null, size: [0.45, 0.86, 0.52], price: 320, seatHeight: 0.45,
    clearance: { front: 0.30, back: 0.80, left: 0.03, right: 0.03 },
    tags: ['seat', 'dining'], proc: ['procChair', 0.45, 0.52, 0.86, 0.45],
    note: 'Seat 0.45 m. 0.80 m behind to push the chair back and stand up.',
  }),
  E({
    id: 'chair-stacking', name: 'Stacking chair', category: 'seating',
    file: null, size: [0.44, 0.80, 0.50], price: 240, seatHeight: 0.45,
    clearance: { front: 0.25, back: 0.75, left: 0.03, right: 0.03 },
    tags: ['seat', 'dining', 'cafe'], proc: ['procStackChair', 0.44, 0.50, 0.80, 0.45],
    note: 'Cantilever cafe/canteen chair.',
  }),
  E({
    id: 'chair-task', name: 'Task chair', category: 'seating',
    file: 'assets/models/chair-task.glb', size: [0.65, 1.10, 0.65], price: 1400, seatHeight: 0.46,
    clearance: { front: 0.10, back: 1.00, left: 0.15, right: 0.15 },
    tags: ['seat', 'workstation', 'office'], proc: ['procTaskChair', 0.65, 0.65, 1.10, 0.46],
    note: 'Seat adjusts 0.42-0.53. Needs 1.00 m clear behind the desk edge to roll back.',
  }),
  E({
    id: 'chair-visitor', name: 'Visitor chair', category: 'seating',
    file: null, size: [0.55, 0.82, 0.58], price: 680, seatHeight: 0.45,
    clearance: { front: 0.25, back: 0.75, left: 0.05, right: 0.05 },
    tags: ['seat', 'office', 'waiting'], proc: ['procStackChair', 0.55, 0.58, 0.82, 0.45],
  }),
  E({
    id: 'armchair-lounge', name: 'Lounge armchair', category: 'seating',
    file: null, size: [0.80, 0.78, 0.82], price: 2400, seatHeight: 0.42,
    clearance: { front: 0.45, back: 0.10, left: 0.10, right: 0.10 },
    tags: ['seat', 'lounge'], proc: ['procSofa', 0.80, 0.82, 0.78, 1, 0.42],
  }),
  E({
    id: 'sofa-2seat', name: 'Sofa, 2 seats', category: 'seating',
    file: null, size: [1.60, 0.82, 0.90], price: 3200, seatHeight: 0.42, capacity: 2,
    clearance: { front: 0.45, back: 0.05, left: 0.10, right: 0.10 },
    tags: ['seat', 'lounge'], proc: ['procSofa', 1.60, 0.90, 0.82, 2, 0.42],
    note: '0.45 m to the coffee table is the comfortable shin gap.',
  }),
  E({
    id: 'sofa-3seat', name: 'Sofa, 3 seats', category: 'seating',
    file: 'assets/models/sofa-3seat.glb', size: [2.10, 0.82, 0.92], price: 3800, seatHeight: 0.42, capacity: 3,
    clearance: { front: 0.45, back: 0.05, left: 0.10, right: 0.10 },
    tags: ['seat', 'lounge'], proc: ['procSofa', 2.10, 0.92, 0.82, 3, 0.42],
  }),
  E({
    id: 'sofa-corner', name: 'Corner sofa', category: 'seating',
    file: null, size: [2.60, 0.82, 1.90], price: 6200, seatHeight: 0.42, capacity: 5,
    clearance: { front: 0.45, back: 0.05, left: 0.10, right: 0.10 },
    tags: ['seat', 'lounge'], proc: ['procSofa', 2.60, 0.95, 0.82, 3, 0.42],
    note: 'L-shape; the return arm runs 1.90 m along -x.',
  }),
  E({
    id: 'stool-bar', name: 'Bar stool', category: 'seating',
    file: null, size: [0.38, 0.78, 0.38], price: 520, seatHeight: 0.76,
    clearance: { front: 0.20, back: 0.60, left: 0.06, right: 0.06 },
    tags: ['seat', 'bar'], proc: ['procStool', 0.38, 0.38, 0.76, 0.22],
    note: 'Seat 0.76 for a 1.05 m bar. Counter stools are 0.65 for a 0.90 worktop.',
  }),
  E({
    id: 'bench-waiting-3', name: 'Waiting bench, 3 seats', category: 'seating',
    file: null, size: [1.80, 0.82, 0.60], price: 2200, seatHeight: 0.45, capacity: 3,
    clearance: { front: 0.60, back: 0.05, left: 0.05, right: 0.05 },
    tags: ['seat', 'waiting'], proc: ['procSofa', 1.80, 0.60, 0.82, 3, 0.45],
    note: '0.60 m per seat. 0.60 m in front so a corridor past it still measures 1.20.',
  }),
];

// ---------------------------------------------------------------------------
// TABLES AND DESKS
// ---------------------------------------------------------------------------

const TABLES = [
  E({
    id: 'table-dining-4', name: 'Dining table, 4', category: 'tables',
    file: 'assets/models/table-dining-4.glb', size: [1.40, 0.75, 0.80], price: 1900, workHeight: 0.75, capacity: 4,
    clearance: { front: 0.80, back: 0.80, left: 0.80, right: 0.80 },
    tags: ['table', 'dining'], proc: ['procTable', 1.40, 0.80, 0.75],
    note: 'Top at 0.75. 0.60 m of edge per diner; 0.80 m all round to seat and pass.',
  }),
  E({
    id: 'table-dining-6', name: 'Dining table, 6', category: 'tables',
    file: null, size: [1.80, 0.75, 0.90], price: 2400, workHeight: 0.75, capacity: 6,
    clearance: { front: 0.80, back: 0.80, left: 0.80, right: 0.80 },
    tags: ['table', 'dining'], proc: ['procTable', 1.80, 0.90, 0.75],
  }),
  E({
    id: 'table-dining-round-4', name: 'Round table, 4', category: 'tables',
    file: null, size: [1.20, 0.75, 1.20], price: 2100, workHeight: 0.75, capacity: 4,
    clearance: { front: 0.80, back: 0.80, left: 0.80, right: 0.80 },
    tags: ['table', 'dining'], proc: ['procRoundTable', 1.20, 0.75],
    note: 'D 1.20 gives 3.77 m of edge, 0.94 m per diner.',
  }),
  E({
    id: 'table-cafe-2', name: 'Cafe table, 2', category: 'tables',
    file: null, size: [0.70, 0.75, 0.70], price: 900, workHeight: 0.75, capacity: 2,
    clearance: { front: 0.75, back: 0.75, left: 0.30, right: 0.30 },
    tags: ['table', 'cafe', 'dining'], proc: ['procRoundTable', 0.70, 0.75],
  }),
  E({
    id: 'table-coffee', name: 'Coffee table', category: 'tables',
    file: null, size: [1.10, 0.40, 0.60], price: 850, workHeight: 0.40,
    clearance: { front: 0.40, back: 0.40, left: 0.30, right: 0.30 },
    tags: ['table', 'lounge'], proc: ['procTable', 1.10, 0.60, 0.40],
  }),
  E({
    id: 'table-bar-high', name: 'High bar table', category: 'tables',
    file: null, size: [1.20, 1.05, 0.70], price: 1500, workHeight: 1.05, capacity: 4,
    clearance: { front: 0.70, back: 0.70, left: 0.40, right: 0.40 },
    tags: ['table', 'bar'], proc: ['procTable', 1.20, 0.70, 1.05],
  }),
  E({
    id: 'desk-1600', name: 'Office desk 1600', category: 'tables',
    file: null, size: [1.60, 0.74, 0.80], price: 2200, workHeight: 0.74,
    clearance: { front: 1.00, back: 0.10, left: 0.10, right: 0.10 },
    tags: ['table', 'workstation', 'office'], proc: ['procDesk', 1.60, 0.80, 0.74],
    note: 'Top 0.74. The user sits on the +z side; 1.00 m clear for the task chair.',
  }),
  E({
    id: 'desk-corner', name: 'Corner desk', category: 'tables',
    file: null, size: [1.80, 0.74, 1.60], price: 3100, workHeight: 0.74,
    clearance: { front: 1.00, back: 0.10, left: 0.10, right: 0.10 },
    tags: ['table', 'workstation', 'office'], proc: ['procDesk', 1.80, 1.60, 0.74],
  }),
  E({
    id: 'table-meeting-8', name: 'Meeting table, 8', category: 'tables',
    file: null, size: [2.40, 0.74, 1.20], price: 4600, workHeight: 0.74, capacity: 8,
    clearance: { front: 0.90, back: 0.90, left: 0.90, right: 0.90 },
    tags: ['table', 'meeting', 'office'], proc: ['procTable', 2.40, 1.20, 0.74],
    note: '0.90 m all round: chair pull-out 0.80 plus a passing margin.',
  }),
];

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

const STORAGE = [
  E({
    id: 'wardrobe-hinged-1000', name: 'Wardrobe, hinged, 1.0 m', category: 'storage',
    file: null, size: [1.00, 2.10, 0.60], price: 3200,
    clearance: { front: 0.60, back: 0, left: 0, right: 0 },
    tags: ['storage', 'wardrobe'], proc: ['procCabinet', 1.00, 2.10, 0.60, 2, 0.10],
    note: '0.60 deep so a hanger (0.55) fits across. Hinged doors need 0.60 m of swing.',
  }),
  E({
    id: 'wardrobe-sliding-1800', name: 'Wardrobe, sliding, 1.8 m', category: 'storage',
    file: null, size: [1.80, 2.40, 0.65], price: 5400,
    clearance: { front: 0.75, back: 0, left: 0, right: 0 },
    tags: ['storage', 'wardrobe'], proc: ['procCabinet', 1.80, 2.40, 0.65, 3, 0.06],
    note: 'Sliding doors need no swing, but 0.75 m to stand and reach in.',
  }),
  E({
    id: 'chest-drawers-800', name: 'Chest of drawers', category: 'storage',
    file: null, size: [0.80, 0.85, 0.45], price: 1400,
    clearance: { front: 0.85, back: 0, left: 0, right: 0 },
    tags: ['storage'], proc: ['procDrawers', 0.80, 0.85, 0.45, 4, 0.08],
    note: 'Drawer extends 0.42 plus 0.45 m to stand: 0.85 m clear in front.',
  }),
  E({
    id: 'bookshelf-800', name: 'Bookshelf', category: 'storage',
    file: null, size: [0.80, 1.90, 0.32], price: 900,
    clearance: { front: 0.60, back: 0, left: 0, right: 0 },
    tags: ['storage', 'shelving'], proc: ['procShelf', 0.80, 1.90, 0.32, 5],
    note: '0.32 deep takes an A4 book upright.',
  }),
  E({
    id: 'sideboard-1600', name: 'Sideboard', category: 'storage',
    file: null, size: [1.60, 0.80, 0.45], price: 2100, workHeight: 0.80,
    clearance: { front: 0.75, back: 0, left: 0, right: 0 },
    tags: ['storage'], proc: ['procCabinet', 1.60, 0.80, 0.45, 3, 0.08],
  }),
  E({
    id: 'filing-cabinet-4', name: 'Filing cabinet, 4 drawer', category: 'storage',
    file: null, size: [0.47, 1.32, 0.62], price: 1250,
    clearance: { front: 1.05, back: 0, left: 0, right: 0 },
    tags: ['storage', 'office'], proc: ['procDrawers', 0.47, 1.32, 0.62, 4, 0.06],
    note: 'A4 suspension drawer extends 0.60; 1.05 m clear to open it and stand.',
  }),
  E({
    id: 'lockers-4', name: 'Lockers, 4 bay', category: 'storage',
    file: null, size: [0.90, 1.80, 0.50], price: 1600,
    clearance: { front: 0.75, back: 0, left: 0, right: 0 },
    tags: ['storage', 'cloakroom'], proc: ['procCabinet', 0.90, 1.80, 0.50, 4, 0.10],
  }),
];

// ---------------------------------------------------------------------------
// BEDS
// ---------------------------------------------------------------------------

const BEDS = [
  E({
    id: 'bed-single-900', name: 'Single bed 90 x 200', category: 'beds',
    file: null, size: [0.90, 0.55, 2.00], price: 1400, capacity: 1,
    clearance: { front: 0.40, back: 0.02, left: 0.70, right: 0.10 },
    tags: ['bed'], proc: ['procBed', 0.90, 2.00, 0.55, 0.95],
    note: 'Headboard at -z against the wall. One long side gets the 0.70 m access.',
  }),
  E({
    id: 'bed-double-1600', name: 'Double bed 160 x 200', category: 'beds',
    file: 'assets/models/bed-double-1600.glb', size: [1.60, 0.55, 2.00], price: 2600, capacity: 2,
    clearance: { front: 0.55, back: 0.02, left: 0.70, right: 0.70 },
    tags: ['bed'], proc: ['procBed', 1.60, 2.00, 0.55, 0.95],
    note: 'Both sides need 0.70 m when two people sleep in it.',
  }),
  E({
    id: 'bed-king-1800', name: 'King bed 180 x 200', category: 'beds',
    file: null, size: [1.80, 0.55, 2.00], price: 3400, capacity: 2,
    clearance: { front: 0.55, back: 0.02, left: 0.70, right: 0.70 },
    tags: ['bed'], proc: ['procBed', 1.80, 2.00, 0.55, 0.95],
  }),
  E({
    id: 'bed-bunk-900', name: 'Bunk bed 90 x 200', category: 'beds',
    file: null, size: [0.90, 1.65, 2.00], price: 2400, capacity: 2,
    clearance: { front: 0.55, back: 0.02, left: 0.75, right: 0.10 },
    tags: ['bed'], proc: ['procBed', 0.90, 2.00, 1.65, 1.65],
    note: 'Needs 2.30 m floor-to-ceiling minimum for headroom over the top bunk.',
  }),
  E({
    id: 'cot-child', name: 'Child cot 70 x 140', category: 'beds',
    file: null, size: [0.70, 0.95, 1.40], price: 900, capacity: 1,
    clearance: { front: 0.55, back: 0.02, left: 0.60, right: 0.10 },
    tags: ['bed', 'child'], proc: ['procCot', 0.70, 1.40, 0.95, 0.42],
  }),
  E({
    id: 'bedside-table', name: 'Bedside table', category: 'beds',
    file: null, size: [0.45, 0.55, 0.40], price: 420, workHeight: 0.55,
    clearance: { front: 0.55, back: 0, left: 0, right: 0 },
    tags: ['storage'], proc: ['procDrawers', 0.45, 0.55, 0.40, 2, 0.06],
    note: 'Top at 0.55, level with a 0.55 m mattress.',
  }),
];

// ---------------------------------------------------------------------------
// SANITARY
// ---------------------------------------------------------------------------

const SANITARY = [
  E({
    id: 'wc-floor', name: 'WC, close-coupled', category: 'sanitary',
    file: 'assets/models/wc-floor.glb', size: [0.38, 0.79, 0.70], price: 1300, seatHeight: 0.42,
    clearance: { front: 0.60, back: 0, left: 0.20, right: 0.20 },
    tags: ['wc', 'sanitary'], proc: ['procWC', 0.38, 0.70, 0.79, 0.42], colorable: false,
    note: 'Pan projection 0.70, cistern against the wall. 0.60 m clear in front, 0.20 m each side of the centre line.',
  }),
  E({
    id: 'wc-wall-hung', name: 'WC, wall-hung', category: 'sanitary',
    file: null, size: [0.36, 0.40, 0.54], price: 2100, seatHeight: 0.40, anchor: 'floor',
    clearance: { front: 0.60, back: 0, left: 0.20, right: 0.20 },
    tags: ['wc', 'sanitary'], proc: ['procWCWallHung', 0.36, 0.54, 0.40], colorable: false,
    note: 'Concealed frame occupies 0.15 m inside the wall; projection 0.54 from the finished face.',
  }),
  E({
    id: 'wc-accessible', name: 'WC, accessible', category: 'sanitary',
    file: null, size: [0.38, 0.82, 0.75], price: 2600, seatHeight: 0.48,
    clearance: { front: 0.75, back: 0, left: 0.90, right: 0.20 },
    tags: ['wc', 'sanitary', 'accessible'], proc: ['procWC', 0.38, 0.74, 0.82, 0.48], colorable: false,
    note: 'Seat 0.48. 0.90 m of lateral transfer space on one side, 0.75 m in front.',
  }),
  E({
    id: 'basin-560', name: 'Washbasin 560', category: 'sanitary',
    file: 'assets/models/basin-560.glb', size: [0.56, 0.85, 0.46], price: 900, workHeight: 0.85,
    clearance: { front: 0.70, back: 0, left: 0.10, right: 0.10 },
    tags: ['basin', 'sanitary'], proc: ['procBasin', 0.56, 0.46, 0.85, true], colorable: false,
    note: 'Rim at 0.85. 0.70 m of activity space in front (0.60 is the absolute minimum).',
  }),
  E({
    id: 'basin-vanity-800', name: 'Vanity basin 800', category: 'sanitary',
    file: null, size: [0.80, 0.85, 0.48], price: 2400, workHeight: 0.85,
    clearance: { front: 0.70, back: 0, left: 0, right: 0 },
    tags: ['basin', 'sanitary', 'storage'], proc: ['procKitchenBase', 0.80, 0.48, 0.85, 2, false],
  }),
  E({
    id: 'basin-cloak-400', name: 'Cloakroom basin 400', category: 'sanitary',
    file: null, size: [0.40, 0.85, 0.30], price: 600, workHeight: 0.85,
    clearance: { front: 0.60, back: 0, left: 0.05, right: 0.05 },
    tags: ['basin', 'sanitary'], proc: ['procBasin', 0.40, 0.30, 0.85, false], colorable: false,
  }),
  E({
    id: 'shower-900', name: 'Shower, 900 tray', category: 'sanitary',
    file: null, size: [0.90, 2.00, 0.90], price: 2800,
    clearance: { front: 0.75, back: 0, left: 0, right: 0 },
    tags: ['shower', 'sanitary'], proc: ['procShower', 0.90, 0.90, 2.00], colorable: false,
    note: '0.90 x 0.90 is the smallest comfortable tray; 0.75 m to dry off in front of it.',
  }),
  E({
    id: 'shower-walkin-1200', name: 'Walk-in shower 1200', category: 'sanitary',
    file: null, size: [1.20, 2.00, 0.90], price: 4200,
    clearance: { front: 0.75, back: 0, left: 0, right: 0 },
    tags: ['shower', 'sanitary', 'accessible'], proc: ['procShower', 1.20, 0.90, 2.00], colorable: false,
  }),
  E({
    id: 'bath-1700', name: 'Bathtub 1700', category: 'sanitary',
    file: null, size: [1.70, 0.58, 0.75], price: 2600,
    clearance: { front: 0.70, back: 0, left: 0, right: 0 },
    tags: ['bath', 'sanitary'], proc: ['procBath', 1.70, 0.75, 0.58], colorable: false,
    note: 'Rim at 0.58. 0.70 m alongside to step in and out.',
  }),
  E({
    id: 'urinal', name: 'Urinal', category: 'sanitary',
    file: null, size: [0.36, 0.65, 0.34], price: 950, anchor: 'wall', mount: 0.55,
    clearance: { front: 0.60, back: 0, left: 0.17, right: 0.17 },
    tags: ['urinal', 'sanitary'], proc: ['procUrinal', 0.36, 0.34, 0.65, 0.60], colorable: false,
    note: 'Lip at 0.60 (0.50 for children). 0.70 m centre to centre in a row.',
  }),
  E({
    id: 'washing-machine', name: 'Washing machine', category: 'sanitary',
    file: null, size: [0.60, 0.85, 0.60], price: 2400,
    clearance: { front: 0.90, back: 0.05, left: 0, right: 0 },
    tags: ['appliance', 'utility'], proc: ['procTallUnit', 0.60, 0.60, 0.85, 0],
    note: 'Standard 0.60 x 0.60 x 0.85. Front-loading door needs 0.90 m to open and load.',
  }),
  E({
    id: 'radiator-towel', name: 'Towel radiator', category: 'sanitary',
    file: null, size: [0.50, 1.20, 0.10], price: 780, anchor: 'wall', mount: 0.60,
    clearance: { front: 0.30, back: 0, left: 0, right: 0 },
    tags: ['heating'], proc: ['procPanel', 0.50, 1.20, 0.10, 'metal'],
  }),
];

// ---------------------------------------------------------------------------
// KITCHEN
// ---------------------------------------------------------------------------

const KITCHEN = [
  E({
    id: 'kitchen-base-600', name: 'Kitchen base unit 600', category: 'kitchen',
    file: null, size: [0.60, 0.90, 0.60], price: 1100, workHeight: 0.90,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['worktop', 'storage', 'kitchen'], proc: ['procKitchenBase', 0.60, 0.60, 0.90, 1, true],
    note: 'Carcase 0.60 deep, worktop at 0.90. A kitchen run needs 1.20 m clear in front.',
  }),
  E({
    id: 'kitchen-base-sink-800', name: 'Kitchen sink unit 800', category: 'kitchen',
    file: 'assets/models/kitchen-base-sink-800.glb', size: [0.80, 0.90, 0.60], price: 2300, workHeight: 0.90,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['sink', 'worktop', 'storage', 'kitchen'], proc: ['procKitchenBase', 0.80, 0.60, 0.90, 2, false],
    note: 'Single bowl 0.50 x 0.40 x 0.18 deep, mixer to the rear.',
  }),
  E({
    id: 'kitchen-base-corner', name: 'Kitchen corner unit', category: 'kitchen',
    file: null, size: [0.90, 0.90, 0.90], price: 1900, workHeight: 0.90,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['worktop', 'storage', 'kitchen'], proc: ['procKitchenBase', 0.90, 0.90, 0.90, 1, false],
  }),
  E({
    id: 'kitchen-wall-600', name: 'Kitchen wall unit 600', category: 'kitchen',
    file: null, size: [0.60, 0.72, 0.35], price: 850, anchor: 'wall', mount: 1.45,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['storage', 'kitchen'], proc: ['procKitchenWall', 0.60, 0.35, 0.72, 1],
    note: '0.35 deep, underside at 1.45 — 0.55 m of clear worktop under it.',
  }),
  E({
    id: 'kitchen-tall-oven', name: 'Oven housing unit', category: 'kitchen',
    file: null, size: [0.60, 2.15, 0.60], price: 3600,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['storage', 'kitchen', 'appliance'], proc: ['procTallUnit', 0.60, 0.60, 2.15, 1.00],
    note: 'Built-in oven at 0.90 so the shelf is at worktop height.',
  }),
  E({
    id: 'hob-induction-600', name: 'Induction hob 600', category: 'kitchen',
    file: null, size: [0.60, 0.05, 0.52], price: 2200, anchor: 'floor', mount: 0.90,
    clearance: { front: 1.20, back: 0, left: 0.05, right: 0.05 },
    tags: ['hob', 'kitchen', 'appliance'], proc: ['procHob', 0.60, 0.52, 4], colorable: false,
    note: 'Drops into the worktop at 0.90. Never place directly beside a tall unit door.',
  }),
  E({
    id: 'extractor-hood-600', name: 'Extractor hood 600', category: 'kitchen',
    file: null, size: [0.60, 0.55, 0.50], price: 1600, anchor: 'wall', mount: 1.50,
    clearance: { front: 0, back: 0, left: 0, right: 0 },
    tags: ['kitchen', 'appliance'], proc: ['procBlock', 0.60, 0.55, 0.50, 'metal'], colorable: false,
    note: 'Underside 0.60-0.70 above an induction hob, so 1.50-1.60 above the floor.',
  }),
  E({
    id: 'fridge-freezer-tall', name: 'Fridge-freezer, tall', category: 'kitchen',
    file: 'assets/models/fridge-freezer-tall.glb', size: [0.60, 2.00, 0.65], price: 3200,
    clearance: { front: 1.20, back: 0.05, left: 0, right: 0 },
    tags: ['kitchen', 'appliance', 'storage'], proc: ['procTallUnit', 0.60, 0.65, 2.00, 1.30],
    note: 'The door sweeps 0.65 m; 1.20 m keeps the run usable with the door open.',
  }),
  E({
    id: 'dishwasher-600', name: 'Dishwasher 600', category: 'kitchen',
    file: null, size: [0.60, 0.82, 0.57], price: 2100,
    clearance: { front: 1.20, back: 0, left: 0, right: 0 },
    tags: ['kitchen', 'appliance'], proc: ['procTallUnit', 0.60, 0.57, 0.82, 0],
    note: 'Integrated under a 0.90 worktop. The open door plus basket needs 1.10 m.',
  }),
  E({
    id: 'kitchen-island-1800', name: 'Kitchen island 1800', category: 'kitchen',
    file: null, size: [1.80, 0.90, 0.90], price: 5200, workHeight: 0.90,
    clearance: { front: 1.20, back: 1.20, left: 0.90, right: 0.90 },
    tags: ['worktop', 'storage', 'kitchen'], proc: ['procKitchenBase', 1.80, 0.90, 0.90, 3, true],
    note: 'Two facing runs need 1.20-1.50 m between worktop fronts. Below 1.00 two people cannot pass.',
  }),
];

// ---------------------------------------------------------------------------
// DOORS  — size is the CLEAR STRUCTURAL OPENING [w, h, wallDepthAllowance]
// ---------------------------------------------------------------------------

function door(o) {
  return E({
    ...o, category: 'doors', anchor: 'wall',
    opening: { kind: 'door', width: o.size[0], height: o.size[1], sill: 0, frame: o.frame ?? 0.06, swing: o.swing ?? 'in-left' },
    tags: o.tags ?? ['door'],
  });
}

const DOORS = [
  door({
    id: 'door-internal-800', name: 'Internal door 800', size: [0.80, 2.05, 0.06], price: 1250,
    clearance: { front: 0.80, back: 0.30 }, proc: ['procDoorLeaf', 0.80, 2.05, 0.04, 0, false],
    note: 'Leaf 0.80 x 2.05. Structural opening 0.90 x 2.11 with the frame.',
  }),
  door({
    id: 'door-internal-900', name: 'Internal door 900', file: 'assets/models/door-internal-900.glb',
    size: [0.90, 2.05, 0.06], price: 1400,
    clearance: { front: 0.90, back: 0.30 }, proc: ['procDoorLeaf', 0.90, 2.05, 0.04, 0, false],
    note: 'The default. Leaf 0.90 x 2.05; 0.90 m clear width satisfies wheelchair access.',
  }),
  door({
    id: 'door-internal-1000', name: 'Internal door 1000', size: [1.00, 2.05, 0.06], price: 1600,
    clearance: { front: 1.00, back: 0.30 }, proc: ['procDoorLeaf', 1.00, 2.05, 0.04, 0, false],
  }),
  door({
    id: 'door-glazed-900', name: 'Glazed internal door 900', size: [0.90, 2.05, 0.06], price: 2000,
    clearance: { front: 0.90, back: 0.30 }, proc: ['procDoorLeaf', 0.90, 2.05, 0.04, 0, true],
    tags: ['door', 'glazed'],
  }),
  door({
    id: 'door-double-1600', name: 'Double door 1600', size: [1.60, 2.10, 0.06], price: 2900,
    clearance: { front: 0.80, back: 0.40 }, proc: ['procDoorLeaf', 1.60, 2.10, 0.04, 0, false],
    note: 'Two 0.80 leaves. Swing radius is one leaf, so 0.80 in front.',
  }),
  door({
    id: 'door-sliding-900', name: 'Pocket sliding door 900', size: [0.90, 2.05, 0.10], price: 2400,
    clearance: { front: 0.30, back: 0.30 }, proc: ['procDoorLeaf', 0.90, 2.05, 0.04, 0, false],
    tags: ['door', 'sliding'],
    note: 'No swing at all — the reason to spend the money in a tight bathroom.',
  }),
  door({
    id: 'door-fire-ei30-900', name: 'Fire door EI30 900', size: [0.90, 2.05, 0.08], price: 2600,
    clearance: { front: 0.90, back: 0.40 }, proc: ['procDoorLeaf', 0.90, 2.05, 0.06, 0, false],
    tags: ['door', 'fire', 'escape'],
    note: 'Self-closing, 30 minute integrity. Required on escape routes and to garages.',
  }),
  door({
    id: 'door-entrance-1000', name: 'Entrance door 1000', size: [1.00, 2.10, 0.10], price: 4200,
    clearance: { front: 1.00, back: 1.20 }, proc: ['procDoorLeaf', 1.00, 2.10, 0.07, 0, false],
    tags: ['door', 'entrance', 'external', 'escape'],
    note: 'Insulated external leaf 1.00 x 2.10. 1.20 m of level landing outside.',
  }),
];

// ---------------------------------------------------------------------------
// WINDOWS — size is the STRUCTURAL OPENING [w, h, depth]; `mount` is the sill
// ---------------------------------------------------------------------------

function win(o) {
  return E({
    ...o, category: 'windows', anchor: 'wall', mount: o.sill,
    opening: { kind: 'window', width: o.size[0], height: o.size[1], sill: o.sill, frame: 0.06, glazingRatio: o.glazingRatio ?? 0.78 },
    tags: o.tags ?? ['window', 'glazing'],
    clearance: o.clearance ?? { front: 0, back: 0, left: 0, right: 0 },
    colorable: o.colorable ?? true,
  });
}

const WINDOWS = [
  win({
    id: 'window-600x600', name: 'Window 600 x 600', size: [0.60, 0.60, 0.12], sill: 1.50, price: 700,
    glazingRatio: 0.62, proc: ['procWindowFrame', 0.60, 0.60, 0, 0, 0.06],
    note: 'Bathroom/WC light. Head at 2.10.',
  }),
  win({
    id: 'window-900x1400', name: 'Window 900 x 1400', size: [0.90, 1.40, 0.12], sill: 0.85, price: 2200,
    glazingRatio: 0.74, proc: ['procWindowFrame', 0.90, 1.40, 0, 0, 0.06],
    note: 'Sill 0.85, head 2.25. Single casement.',
  }),
  win({
    id: 'window-1200x1400', name: 'Window 1200 x 1400', file: 'assets/models/window-1200x1400.glb',
    size: [1.20, 1.40, 0.12], sill: 0.85, price: 2600,
    glazingRatio: 0.77, proc: ['procWindowFrame', 1.20, 1.40, 1, 0, 0.06],
    note: 'The workhorse. 1.68 m2 of opening; 0.86 m2 of glass per 1.00 m2 of hole.',
  }),
  win({
    id: 'window-1500x1400', name: 'Window 1500 x 1400', size: [1.50, 1.40, 0.12], sill: 0.85, price: 3200,
    glazingRatio: 0.78, proc: ['procWindowFrame', 1.50, 1.40, 1, 0, 0.06],
  }),
  win({
    id: 'window-escape-1000x1200', name: 'Escape window 1000 x 1200', size: [1.00, 1.20, 0.12], sill: 0.30, price: 2500,
    glazingRatio: 0.74, tags: ['window', 'glazing', 'escape'],
    proc: ['procWindowFrame', 1.00, 1.20, 0, 0, 0.06],
    note: 'Bedroom escape: sill dropped to 0.30 so it can be climbed through.',
  }),
  win({
    id: 'window-full-height-1200', name: 'Full-height window 1200 x 2100', size: [1.20, 2.10, 0.12], sill: 0.05, price: 4200,
    glazingRatio: 0.82, proc: ['procWindowFrame', 1.20, 2.10, 1, 1, 0.06],
  }),
  win({
    id: 'window-patio-2400', name: 'Sliding patio door 2400 x 2100', size: [2.40, 2.10, 0.16], sill: 0.00, price: 7800,
    glazingRatio: 0.84, tags: ['window', 'glazing', 'door', 'external'],
    proc: ['procWindowFrame', 2.40, 2.10, 1, 0, 0.08],
    note: 'Also a door: 1.20 m clear leaf when open.',
  }),
  win({
    id: 'window-strip-3000x900', name: 'Strip window 3000 x 900', size: [3.00, 0.90, 0.14], sill: 1.10, price: 6400,
    glazingRatio: 0.76, proc: ['procWindowFrame', 3.00, 0.90, 3, 0, 0.06],
  }),
  win({
    id: 'rooflight-1000', name: 'Rooflight 1000 x 1000', size: [1.00, 1.00, 0.20], sill: 0, price: 3600,
    glazingRatio: 0.80, anchor: 'ceiling', tags: ['window', 'glazing', 'rooflight'],
    proc: ['procWindowFrame', 1.00, 1.00, 0, 0, 0.08],
    note: 'A rooflight delivers roughly 2-3x the daylight of the same area in a wall.',
  }),
  win({
    id: 'window-shopfront-3000', name: 'Shopfront glazing 3000 x 2400', size: [3.00, 2.40, 0.16], sill: 0.10, price: 11000,
    glazingRatio: 0.88, tags: ['window', 'glazing', 'shopfront'],
    proc: ['procWindowFrame', 3.00, 2.40, 2, 0, 0.08],
  }),
];

// ---------------------------------------------------------------------------
// LIGHTING
// ---------------------------------------------------------------------------

const LIGHTING = [
  E({
    id: 'pendant-lamp', name: 'Pendant lamp', category: 'lighting',
    file: 'assets/models/pendant-lamp.glb', size: [0.40, 0.24, 0.40], price: 460,
    anchor: 'ceiling', mount: 1.20, tags: ['light'], proc: ['procPendant', 0.20, 0.24, 1.20],
    note: 'Hung 1.20 below the ceiling — 1.50 m above a dining table top.',
  }),
  E({
    id: 'downlight', name: 'Recessed downlight', category: 'lighting',
    file: null, size: [0.09, 0.02, 0.09], price: 120, anchor: 'ceiling', mount: 0,
    tags: ['light'], proc: ['procBlock', 0.09, 0.02, 0.09, 'metal'], colorable: false,
  }),
  E({
    id: 'luminaire-linear-1200', name: 'Linear luminaire 1200', category: 'lighting',
    file: null, size: [1.20, 0.07, 0.08], price: 640, anchor: 'ceiling', mount: 0,
    tags: ['light', 'office'], proc: ['procLinearLight', 1.20, 0.08, 0.07], colorable: false,
    note: '500 lux at desk level from a 1.20 m unit per 6 m2 of open-plan office.',
  }),
  E({
    id: 'lamp-floor', name: 'Floor lamp', category: 'lighting',
    file: null, size: [0.40, 1.60, 0.40], price: 780,
    clearance: { front: 0.10, back: 0.10, left: 0.10, right: 0.10 },
    tags: ['light'], proc: ['procFloorLamp', 1.60, 0.20, 0.26],
  }),
  E({
    id: 'lamp-desk', name: 'Desk lamp', category: 'lighting',
    file: null, size: [0.20, 0.55, 0.20], price: 420, mount: 0.74,
    tags: ['light', 'office'], proc: ['procDeskLamp', 0.55, 0.09, 0.08],
  }),
  E({
    id: 'sconce-wall', name: 'Wall sconce', category: 'lighting',
    file: null, size: [0.20, 0.30, 0.12], price: 380, anchor: 'wall', mount: 1.80,
    tags: ['light'], proc: ['procPanel', 0.20, 0.30, 0.12, 'primary'],
  }),
  E({
    id: 'track-light-2000', name: 'Lighting track 2000', category: 'lighting',
    file: null, size: [2.00, 0.10, 0.06], price: 1400, anchor: 'ceiling', mount: 0,
    tags: ['light', 'retail'], proc: ['procLinearLight', 2.00, 0.06, 0.10], colorable: false,
  }),
];

// ---------------------------------------------------------------------------
// PLANTS
// ---------------------------------------------------------------------------

const PLANTS = [
  E({
    id: 'plant-ficus-large', name: 'Large ficus', category: 'plants',
    file: 'assets/models/plant-ficus-large.glb', size: [0.80, 1.80, 0.80], price: 900,
    clearance: { front: 0.05, back: 0.05, left: 0.05, right: 0.05 },
    tags: ['plant'], proc: ['procPlant', 0.80, 1.80, 0.22],
  }),
  E({
    id: 'plant-monstera', name: 'Monstera', category: 'plants',
    file: null, size: [0.70, 1.20, 0.70], price: 520,
    tags: ['plant'], proc: ['procPlant', 0.70, 1.20, 0.19],
  }),
  E({
    id: 'plant-pot-small', name: 'Small potted plant', category: 'plants',
    file: null, size: [0.25, 0.40, 0.25], price: 140,
    tags: ['plant'], proc: ['procPlant', 0.25, 0.40, 0.10],
  }),
  E({
    id: 'planter-trough-1200', name: 'Planter trough 1200', category: 'plants',
    file: null, size: [1.20, 0.60, 0.40], price: 680,
    tags: ['plant'], proc: ['procBlock', 1.20, 0.60, 0.40, 'accent'],
  }),
];

// ---------------------------------------------------------------------------
// OFFICE
// ---------------------------------------------------------------------------

const OFFICE = [
  E({
    id: 'workstation-bench-2', name: 'Bench desk, 2 person', category: 'office',
    file: null, size: [3.20, 0.74, 1.60], price: 4800, workHeight: 0.74, capacity: 2,
    clearance: { front: 1.00, back: 1.00, left: 0.10, right: 0.10 },
    tags: ['workstation', 'table', 'office'], proc: ['procDesk', 3.20, 1.60, 0.74],
    note: 'Two 1.60 x 0.80 desks back to back. 1.00 m of chair space on each side.',
  }),
  E({
    id: 'desk-reception', name: 'Reception desk', category: 'office',
    file: 'assets/models/desk-reception.glb', size: [2.20, 1.10, 0.80], price: 6800, workHeight: 0.74, capacity: 1,
    clearance: { front: 1.20, back: 1.00, left: 0.10, right: 0.10 },
    tags: ['workstation', 'reception', 'till'], proc: ['procCounter', 2.20, 0.80, 1.10, 0.75],
    note: 'Counter at 1.10 with a 0.75 m accessible ledge. 1.20 m of queuing space in front.',
  }),
  E({
    id: 'monitor-24', name: 'Monitor 24"', category: 'office',
    file: null, size: [0.55, 0.45, 0.20], price: 1100, mount: 0.74,
    tags: ['office', 'equipment'], proc: ['procMonitor', 0.55, 0.45, 0.20], colorable: false,
  }),
  E({
    id: 'whiteboard-2000', name: 'Whiteboard 2000', category: 'office',
    file: null, size: [2.00, 1.20, 0.05], price: 900, anchor: 'wall', mount: 0.95,
    clearance: { front: 1.00, back: 0, left: 0, right: 0 },
    tags: ['office', 'meeting'], proc: ['procPanel', 2.00, 1.20, 0.05, 'secondary', 'accent'],
  }),
  E({
    id: 'screen-meeting-65', name: 'Meeting screen 65"', category: 'office',
    file: null, size: [1.45, 0.85, 0.08], price: 4600, anchor: 'wall', mount: 1.00,
    clearance: { front: 1.60, back: 0, left: 0, right: 0 },
    tags: ['office', 'meeting', 'equipment'], proc: ['procPanel', 1.45, 0.85, 0.08, 'secondary', 'glass'],
    note: 'Nearest viewer at 1.6 x the screen height; furthest at 6 x.',
  }),
  E({
    id: 'printer-mfp', name: 'Multifunction printer', category: 'office',
    file: null, size: [0.60, 1.10, 0.65], price: 5200,
    clearance: { front: 0.90, back: 0.15, left: 0.30, right: 0.30 },
    tags: ['office', 'equipment'], proc: ['procTallUnit', 0.60, 0.65, 1.10, 0.70], colorable: false,
    note: 'Paper trays pull out 0.45; side access for jams.',
  }),
  E({
    id: 'water-cooler', name: 'Water cooler', category: 'office',
    file: null, size: [0.35, 1.30, 0.35], price: 1600,
    clearance: { front: 0.80, back: 0, left: 0.10, right: 0.10 },
    tags: ['office', 'amenity'], proc: ['procTallUnit', 0.35, 0.35, 1.30, 0.90],
  }),
];

// ---------------------------------------------------------------------------
// RETAIL AND CAFE
// ---------------------------------------------------------------------------

const RETAIL = [
  E({
    id: 'counter-till', name: 'Till counter', category: 'retail',
    file: null, size: [1.60, 1.05, 0.70], price: 4200, workHeight: 0.95, capacity: 1,
    clearance: { front: 1.20, back: 0.90, left: 0.10, right: 0.10 },
    tags: ['till', 'retail'], proc: ['procCounter', 1.60, 0.70, 1.05, 0.75],
    note: 'Counter 0.95-1.05. 0.90 m of staff space behind, 1.20 m of queue in front.',
  }),
  E({
    id: 'counter-cafe-3000', name: 'Cafe counter 3000', category: 'retail',
    file: null, size: [3.00, 1.10, 0.80], price: 9800, workHeight: 0.95, capacity: 2,
    clearance: { front: 1.50, back: 1.00, left: 0.10, right: 0.10 },
    tags: ['till', 'retail', 'cafe', 'worktop'], proc: ['procCounter', 3.00, 0.80, 1.10, 0.75],
  }),
  E({
    id: 'espresso-machine', name: 'Espresso machine', category: 'retail',
    file: 'assets/models/espresso-machine.glb', size: [0.75, 0.55, 0.55], price: 12000, mount: 0.95,
    clearance: { front: 0.60, back: 0.10, left: 0.10, right: 0.10 },
    tags: ['cafe', 'equipment'], proc: ['procBlock', 0.75, 0.55, 0.55, 'metal'], colorable: false,
    note: 'Two-group commercial machine, sits on the 0.95 m bar top.',
  }),
  E({
    id: 'display-fridge-glass', name: 'Glass display fridge', category: 'retail',
    file: null, size: [0.90, 2.00, 0.70], price: 9500,
    clearance: { front: 1.00, back: 0.10, left: 0, right: 0 },
    tags: ['retail', 'appliance'], proc: ['procTallUnit', 0.90, 0.70, 2.00, 0], colorable: false,
  }),
  E({
    id: 'shelving-gondola', name: 'Gondola shelving', category: 'retail',
    file: null, size: [1.25, 1.65, 0.90], price: 2400,
    clearance: { front: 1.20, back: 1.20, left: 0, right: 0 },
    tags: ['shelving', 'retail'], proc: ['procShelf', 1.25, 1.65, 0.90, 5],
    note: 'Double-sided. Aisles between gondolas must be at least 1.20 m.',
  }),
  E({
    id: 'display-table-retail', name: 'Retail display table', category: 'retail',
    file: null, size: [1.20, 0.85, 0.80], price: 1300, workHeight: 0.85,
    clearance: { front: 0.90, back: 0.90, left: 0.60, right: 0.60 },
    tags: ['table', 'retail'], proc: ['procTable', 1.20, 0.80, 0.85],
  }),
  E({
    id: 'fitting-room-cubicle', name: 'Fitting room cubicle', category: 'retail',
    file: null, size: [1.00, 2.20, 1.20], price: 3400,
    clearance: { front: 1.00, back: 0, left: 0, right: 0 },
    tags: ['retail', 'cubicle'], proc: ['procCabinet', 1.00, 2.20, 1.20, 1, 0.0],
    note: 'Internal 1.00 x 1.20. An accessible cubicle is 1.50 x 1.50 with an outward door.',
  }),
];

// ---------------------------------------------------------------------------
// EDUCATION (kindergarten) — EN 1729 size marks 1 and 2
// ---------------------------------------------------------------------------

const EDUCATION = [
  E({
    id: 'kids-chair-sm1', name: 'Child chair, size 1', category: 'education',
    file: null, size: [0.30, 0.55, 0.30], price: 180, seatHeight: 0.26,
    clearance: { front: 0.25, back: 0.55, left: 0.03, right: 0.03 },
    tags: ['seat', 'play', 'child'], proc: ['procChair', 0.30, 0.30, 0.55, 0.26],
    note: 'EN 1729 size mark 1: seat 260 mm, for children about 3-4 years old.',
  }),
  E({
    id: 'kids-chair-sm2', name: 'Child chair, size 2', category: 'education',
    file: null, size: [0.32, 0.62, 0.32], price: 190, seatHeight: 0.31,
    clearance: { front: 0.25, back: 0.60, left: 0.03, right: 0.03 },
    tags: ['seat', 'play', 'child'], proc: ['procChair', 0.32, 0.32, 0.62, 0.31],
    note: 'EN 1729 size mark 2: seat 310 mm, for children about 5-6 years old.',
  }),
  E({
    id: 'kids-table-round-sm1', name: 'Child table, round, size 1', category: 'education',
    file: null, size: [1.20, 0.46, 1.20], price: 1100, workHeight: 0.46, capacity: 6,
    clearance: { front: 0.60, back: 0.60, left: 0.60, right: 0.60 },
    tags: ['table', 'play', 'child'], proc: ['procRoundTable', 1.20, 0.46],
    note: 'EN 1729 size mark 1 table height 460 mm. Six size-1 chairs fit round it.',
  }),
  E({
    id: 'kids-table-rect-sm2', name: 'Child table, rect, size 2', category: 'education',
    file: null, size: [1.20, 0.53, 0.60], price: 950, workHeight: 0.53, capacity: 4,
    clearance: { front: 0.60, back: 0.60, left: 0.40, right: 0.40 },
    tags: ['table', 'play', 'child'], proc: ['procTable', 1.20, 0.60, 0.53],
    note: 'EN 1729 size mark 2 table height 530 mm.',
  }),
  E({
    id: 'nap-mat', name: 'Nap mattress', category: 'education',
    file: null, size: [0.60, 0.08, 1.30], price: 180, capacity: 1,
    clearance: { front: 0.10, back: 0.10, left: 0.30, right: 0.30 },
    tags: ['bed', 'child'], proc: ['procMat', 0.60, 1.30, 0.08, 'fabric'],
    note: '0.30 m between mattresses so a carer can walk the row.',
  }),
  E({
    id: 'toy-storage-unit', name: 'Toy storage unit', category: 'education',
    file: null, size: [1.00, 0.80, 0.40], price: 1200,
    clearance: { front: 0.70, back: 0, left: 0, right: 0 },
    tags: ['storage', 'play', 'child'], proc: ['procShelf', 1.00, 0.80, 0.40, 2],
    note: 'Top at 0.80 so a five-year-old can reach every tray.',
  }),
  E({
    id: 'play-rug', name: 'Play rug 2000', category: 'education',
    file: null, size: [2.00, 0.02, 2.00], price: 600, capacity: 8,
    tags: ['play', 'child'], proc: ['procMat', 2.00, 2.00, 0.02, 'fabric'],
  }),
  E({
    id: 'kids-wc', name: 'Child WC', category: 'education',
    file: null, size: [0.34, 0.60, 0.58], price: 1100, seatHeight: 0.33,
    clearance: { front: 0.55, back: 0, left: 0.20, right: 0.20 },
    tags: ['wc', 'sanitary', 'child'], proc: ['procWC', 0.34, 0.58, 0.60, 0.33], colorable: false,
    note: 'Seat at 0.33 for nursery age.',
  }),
  E({
    id: 'kids-basin-row', name: 'Child basin row', category: 'education',
    file: null, size: [1.20, 0.55, 0.40], price: 1900, workHeight: 0.55, capacity: 2,
    clearance: { front: 0.70, back: 0, left: 0, right: 0 },
    tags: ['basin', 'sanitary', 'child'], proc: ['procKitchenBase', 1.20, 0.40, 0.55, 2, false], colorable: false,
    note: 'Rim at 0.55 for nursery age (0.60-0.65 for primary school).',
  }),
];

// ---------------------------------------------------------------------------
// CLINIC
// ---------------------------------------------------------------------------

const CLINIC = [
  E({
    id: 'exam-couch', name: 'Examination couch', category: 'clinic',
    file: 'assets/models/exam-couch.glb', size: [0.62, 0.70, 1.90], price: 4800, capacity: 1,
    clearance: { front: 0.75, back: 0.30, left: 0.90, right: 0.75 },
    tags: ['exam-couch', 'clinic'], proc: ['procBed', 0.62, 1.90, 0.70, 0.30],
    note: '1900 x 620 mm at 0.70 m. Clinicians need 0.90 m on the examination side.',
  }),
  E({
    id: 'exam-stool', name: 'Clinician stool', category: 'clinic',
    file: null, size: [0.45, 0.60, 0.45], price: 620, seatHeight: 0.55,
    clearance: { front: 0.30, back: 0.60, left: 0.10, right: 0.10 },
    tags: ['seat', 'clinic'], proc: ['procStool', 0.45, 0.45, 0.55, 0.18],
    note: 'Gas-lift stool, seat 0.45-0.60.',
  }),
  E({
    id: 'medicine-cabinet', name: 'Medicine cabinet', category: 'clinic',
    file: null, size: [0.60, 0.90, 0.30], price: 1400, anchor: 'wall', mount: 1.20,
    clearance: { front: 0.60, back: 0, left: 0, right: 0 },
    tags: ['storage', 'clinic'], proc: ['procCabinet', 0.60, 0.90, 0.30, 1, 0.0],
    note: 'Lockable, mounted at 1.20 so the top shelf is out of a child\'s reach.',
  }),
  E({
    id: 'treatment-trolley', name: 'Treatment trolley', category: 'clinic',
    file: null, size: [0.60, 0.90, 0.45], price: 1500, workHeight: 0.90,
    clearance: { front: 0.60, back: 0.30, left: 0.30, right: 0.30 },
    tags: ['clinic', 'equipment'], proc: ['procDrawers', 0.60, 0.90, 0.45, 3, 0.10], colorable: false,
  }),
  E({
    id: 'basin-clinical', name: 'Clinical wash basin', category: 'clinic',
    file: null, size: [0.60, 0.90, 0.50], price: 1600, workHeight: 0.90,
    clearance: { front: 0.80, back: 0, left: 0.15, right: 0.15 },
    tags: ['basin', 'sanitary', 'clinic'], proc: ['procBasin', 0.60, 0.50, 0.90, false], colorable: false,
    note: 'Elbow-operated mixer, rim raised to 0.90. Must be within 3 m of the couch.',
  }),
  E({
    id: 'scales-column', name: 'Column scales', category: 'clinic',
    file: null, size: [0.40, 1.40, 0.55], price: 1800,
    clearance: { front: 0.60, back: 0, left: 0.30, right: 0.30 },
    tags: ['clinic', 'equipment'], proc: ['procTallUnit', 0.40, 0.55, 1.40, 0], colorable: false,
  }),
];

// ---------------------------------------------------------------------------
// MISC — circulation, heating, site
// ---------------------------------------------------------------------------

const MISC = [
  E({
    id: 'stair-straight', name: 'Straight stair flight', category: 'misc',
    file: null, size: [1.00, 2.80, 4.48], price: 12000,
    clearance: { front: 1.00, back: 1.00, left: 0, right: 0 },
    tags: ['stair', 'circulation'], proc: ['procStairFlight', 1.00, 16, 0.175, 0.28],
    note: '16 risers at 0.175 = 2.80 m rise; going 0.28, so 2R+G = 0.63. Flight 1.00 m wide, 4.48 m long. Landings 1.00 m at both ends.',
  }),
  E({
    id: 'stair-u-return', name: 'U-return stair', category: 'misc',
    file: null, size: [2.30, 2.80, 2.80], price: 16000,
    clearance: { front: 1.10, back: 0, left: 0, right: 0 },
    tags: ['stair', 'circulation'], proc: ['procStairUReturn', 1.10, 16, 0.175, 0.28, 0.10],
    note: 'Two 8-riser flights around a 1.10 x 2.30 half-landing. Fits a 2.30 x 2.80 well.',
  }),
  E({
    id: 'lift-passenger-630', name: 'Passenger lift 630 kg', category: 'misc',
    file: null, size: [1.60, 2.60, 2.00], price: 95000,
    clearance: { front: 1.50, back: 0, left: 0, right: 0 },
    tags: ['lift', 'circulation', 'accessible'], proc: ['procLiftShaft', 1.60, 2.00, 2.60, 0.90, 2.10],
    note: 'EN 81-70 type 2: car 1100 x 1400 mm, 630 kg, 900 mm clear door. Shaft 1.60 x 2.00. Landing 1.50 x 1.50 in front.',
  }),
  E({
    id: 'ramp-accessible', name: 'Accessible ramp 1:12', category: 'misc',
    file: null, size: [1.20, 0.40, 4.80], price: 6800,
    clearance: { front: 1.50, back: 1.50, left: 0, right: 0 },
    tags: ['ramp', 'circulation', 'accessible'], proc: ['procRamp', 1.20, 0.40, 4.80],
    note: '1:12 over 0.40 m rise. 1.50 x 1.50 level landings top and bottom; handrails at 0.90.',
  }),
  E({
    id: 'balustrade-1100', name: 'Balustrade, 1 m run', category: 'misc',
    file: null, size: [1.00, 1.10, 0.06], price: 620,
    tags: ['balustrade', 'circulation'], proc: ['procPanel', 1.00, 1.10, 0.06, 'metal'],
    note: 'Guarding at 1.10 m for a level above 1.00 m; 0.90 m on the flight itself.',
  }),
  E({
    id: 'radiator-panel-1000', name: 'Radiator 1000', category: 'misc',
    file: null, size: [1.00, 0.60, 0.11], price: 700, anchor: 'wall', mount: 0.15,
    clearance: { front: 0.20, back: 0, left: 0, right: 0 },
    tags: ['heating'], proc: ['procPanel', 1.00, 0.60, 0.11, 'primary'],
    note: 'Under a window, 0.15 above the floor, 0.10 below the sill.',
  }),
  E({
    id: 'stove-wood', name: 'Wood burning stove', category: 'misc',
    file: null, size: [0.60, 1.20, 0.50], price: 6500,
    clearance: { front: 0.80, back: 0.20, left: 0.30, right: 0.30 },
    tags: ['heating', 'fireplace'], proc: ['procTallUnit', 0.60, 0.50, 1.20, 0.70], colorable: false,
    note: 'Non-combustible hearth extending 0.30 to the sides and 0.80 in front.',
  }),
  E({
    id: 'tv-wall-55', name: 'Wall TV 55"', category: 'misc',
    file: null, size: [1.25, 0.72, 0.07], price: 3200, anchor: 'wall', mount: 1.00,
    clearance: { front: 2.00, back: 0, left: 0, right: 0 },
    tags: ['equipment'], proc: ['procPanel', 1.25, 0.72, 0.07, 'secondary', 'glass'],
    note: 'Comfortable viewing distance 1.8-2.5 m for a 55".',
  }),
  E({
    id: 'piano-upright', name: 'Upright piano', category: 'misc',
    file: null, size: [1.50, 1.25, 0.62], price: 14000,
    clearance: { front: 1.00, back: 0.05, left: 0.20, right: 0.20 },
    tags: ['instrument'], proc: ['procTallUnit', 1.50, 0.62, 1.25, 0.70],
    note: '1.50 wide, 0.62 deep. 1.00 m in front for the stool and the player.',
  }),
  E({
    id: 'bin-office', name: 'Waste bin', category: 'misc',
    file: null, size: [0.30, 0.40, 0.30], price: 90,
    tags: ['equipment'], proc: ['procBlock', 0.30, 0.40, 0.30, 'metal'],
  }),
];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const ALL = [
  ...SEATING, ...TABLES, ...STORAGE, ...BEDS, ...SANITARY, ...KITCHEN,
  ...DOORS, ...WINDOWS, ...LIGHTING, ...PLANTS, ...OFFICE, ...RETAIL,
  ...EDUCATION, ...CLINIC, ...MISC,
];

export const CATALOG = {};
for (const e of ALL) {
  if (CATALOG[e.id]) throw new Error(`catalog: duplicate id "${e.id}"`);
  CATALOG[e.id] = Object.freeze(e);
}
Object.freeze(CATALOG);

export const CATALOG_IDS = Object.keys(CATALOG);

/** All entries in a category, in catalogue order. */
export function byCategory(cat) {
  return ALL.filter(e => e.category === cat);
}

/** All entries carrying a tag. */
export function byTag(tag) {
  return ALL.filter(e => e.tags.includes(tag));
}

/** Look up one entry. Throws on an unknown id — a silent null hides bugs. */
export function entry(id) {
  const e = CATALOG[id];
  if (!e) throw new Error(`catalog: unknown id "${id}"`);
  return e;
}

/** Non-throwing lookup for tolerant call sites (deserialising old models). */
export function tryEntry(id) {
  return CATALOG[id] ?? null;
}

/** Every entry, frozen order. */
export function allEntries() {
  return ALL.slice();
}

/** The placeholder solid for an entry that has no GLB (or as a loading proxy). */
export function procShape(id) {
  return buildProcShape(entry(id));
}

// ---------------------------------------------------------------------------
// Prices for surfaces and structure
// ---------------------------------------------------------------------------

/**
 * MATERIAL_PRICES — cost of ONE SQUARE METRE of finished surface, applied to
 * wall faces, floors, ceilings, facades and external ground. These are the
 * materials the player paints with; `structure` below is what the element
 * itself costs before any finish.
 */
export const MATERIAL_PRICES = {
  // interior wall / ceiling finishes
  plaster: 85,          // two-coat gypsum plaster + emulsion
  paint: 45,            // repaint over existing plaster
  tile: 190,            // ceramic wall tiling incl. adhesive and grout
  wood: 240,            // timber boarding / panelling
  concrete: 130,        // fair-faced concrete, sealed
  brick: 260,           // exposed brick face, pointed
  stone: 480,           // stone cladding
  render: 150,          // external render on insulation
  metal: 320,           // profiled metal cladding
  glass: 720,           // glazed partition / curtain wall infill
  // floor finishes
  screed: 95,
  timberFloor: 260,     // engineered oak on battens
  tileFloor: 210,
  vinyl: 120,
  carpet: 140,
  terrazzo: 430,
  polishedConcrete: 165,
  // external ground
  grass: 35,
  paving: 145,
  gravel: 55,
  asphalt: 110,
  decking: 280,
};

/**
 * STRUCTURE_PRICES — the element itself, before finishes.
 * Walls are priced per m2 of ELEVATION (length x storey height), slabs and roofs
 * per m2 on plan, excavation per m3.
 */
export const STRUCTURE_PRICES = {
  wallExterior: 820,     // 240 mm masonry + insulation + weatherproofing, per m2 elevation
  wallInterior: 280,     // 120 mm partition, per m2 elevation
  wallParty: 880,        // 250 mm acoustic separating wall, per m2 elevation
  slabFloor: 620,        // ground/intermediate slab incl. insulation, per m2 plan
  slabRoof: 560,         // roof structure + covering + insulation, per m2 plan
  foundation: 220,       // strip/raft allowance, per m2 of building footprint
  excavation: 95,        // per m3
  // Calibration: a bare 90 m2 shell (38.5 m perimeter, 2.70 storey, 32 m of
  // partition) costs ~235k of the ~437k fully fitted total. See the note on
  // MATERIAL_PRICES: budgets in the brief generator live in the 200-600k band.
};

/** Price per m2 for a finish id; unknown ids fall back to plaster. */
export function materialPrice(id) {
  return MATERIAL_PRICES[id] ?? MATERIAL_PRICES.plaster;
}

/** Price per m2 for a wall type as used by BuildingModel.walls[].type. */
export function wallStructurePrice(type) {
  if (type === 'exterior') return STRUCTURE_PRICES.wallExterior;
  if (type === 'party') return STRUCTURE_PRICES.wallParty;
  return STRUCTURE_PRICES.wallInterior;
}

// ---------------------------------------------------------------------------
// Clearance geometry
// ---------------------------------------------------------------------------

/**
 * World-space usable-space rectangle for a placed item.
 *
 * The rectangle is the item footprint grown by its clearance on each local
 * side (front = local +z, back = -z, left = -x, right = +x), then rotated by
 * `placement.rot` about +Y and translated to `placement.x / placement.z`.
 * Because the ergonomics module works with axis-aligned rectangles, the result
 * is the AABB of the rotated rectangle — for the 0/90/180/270 degree rotations
 * furniture normally uses, that is exact.
 *
 * @param {object} entry     a CatalogEntry
 * @param {object} placement { x, z, rot, sx, sz } as stored on model.furniture
 * @returns {{min:{x:number,z:number}, max:{x:number,z:number},
 *            corners:Array<{x:number,z:number}>, rot:number,
 *            local:{minX:number,maxX:number,minZ:number,maxZ:number}}}
 */
export function clearanceBox(entry, placement = {}) {
  if (!entry) throw new Error('clearanceBox: entry required');
  const rot = placement.rot ?? 0;
  const ox = placement.x ?? 0;
  const oz = placement.z ?? 0;
  const sx = placement.sx ?? 1;
  const sz = placement.sz ?? 1;
  const w = entry.size[0] * Math.abs(sx);
  const d = entry.size[2] * Math.abs(sz);
  const c = entry.clearance;

  const local = {
    minX: -w / 2 - c.left,
    maxX: w / 2 + c.right,
    minZ: -d / 2 - c.back,
    maxZ: d / 2 + c.front,
  };

  const cos = Math.cos(rot), sin = Math.sin(rot);
  const corners = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [lx, lz] of [
    [local.minX, local.minZ], [local.maxX, local.minZ],
    [local.maxX, local.maxZ], [local.minX, local.maxZ],
  ]) {
    // three.js Object3D rotation about +Y
    const x = ox + lx * cos + lz * sin;
    const z = oz - lx * sin + lz * cos;
    corners.push({ x, z });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ }, corners, rot, local };
}

/** Footprint-only box (no clearance) — same conventions as clearanceBox. */
export function footprintBox(entry, placement = {}) {
  return clearanceBox({ ...entry, clearance: NO_CLEARANCE }, placement);
}

/** Do two axis-aligned boxes from clearanceBox overlap by more than `eps`? */
export function boxesOverlap(a, b, eps = 0.001) {
  return (a.min.x < b.max.x - eps && a.max.x > b.min.x + eps &&
          a.min.z < b.max.z - eps && a.max.z > b.min.z + eps);
}

/** Area of the clearance rectangle, m2. */
export function clearanceArea(entry, placement = {}) {
  const b = clearanceBox(entry, placement);
  return (b.max.x - b.min.x) * (b.max.z - b.min.z);
}

// ---------------------------------------------------------------------------
// Self-check — cheap, runs on import in node, catches authoring slips
// ---------------------------------------------------------------------------

/** Returns a list of problem strings; empty means the catalogue is well-formed. */
export function validateCatalog() {
  const problems = [];
  const seen = new Set();
  for (const e of ALL) {
    if (seen.has(e.id)) problems.push(`duplicate id ${e.id}`);
    seen.add(e.id);
    if (!CATEGORIES.includes(e.category)) problems.push(`${e.id}: unknown category ${e.category}`);
    if (!Array.isArray(e.size) || e.size.length !== 3) problems.push(`${e.id}: bad size`);
    else for (const v of e.size) if (!(v > 0) || v > 12) problems.push(`${e.id}: implausible dimension ${v}`);
    if (!Number.isInteger(e.price) || e.price < 0) problems.push(`${e.id}: bad price ${e.price}`);
    if (!['floor', 'wall', 'ceiling'].includes(e.anchor)) problems.push(`${e.id}: bad anchor ${e.anchor}`);
    for (const k of ['front', 'back', 'left', 'right']) {
      const v = e.clearance[k];
      if (typeof v !== 'number' || !(v >= 0)) problems.push(`${e.id}: clearance.${k} = ${v}`);
    }
    if (!Array.isArray(e.tags)) problems.push(`${e.id}: tags must be an array`);
    if (e.file !== null && !/^assets\/models\/.+\.glb$/.test(e.file)) problems.push(`${e.id}: bad file ${e.file}`);
  }
  return problems;
}

const _problems = validateCatalog();
if (_problems.length) throw new Error('catalog invalid:\n  ' + _problems.join('\n  '));
