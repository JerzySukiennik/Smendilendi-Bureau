// Procedural placeholder solids for catalogue items that have no GLB yet.
//
// VIEW-FREE. Zero imports. Every function returns plain data; a renderer agent
// turns the parts into three.js meshes (BoxGeometry / CylinderGeometry / PlaneGeometry).
//
// Conventions — identical to the catalogue and to BuildingModel.furniture:
//   * Units: metres, radians.
//   * Local axes: +x = width (right), +y = up, +z = depth towards the FRONT of
//     the item, i.e. the side it is used from. A chair faces +z, a wardrobe's
//     doors open towards +z, a WC is approached from +z.
//   * Local origin: centre of the footprint, ON THE FLOOR (y = 0 at the base).
//     Wall- and ceiling-anchored items keep y = 0 at their own base too; the
//     catalogue's `mount` field says how high above the floor that base sits.
//     For a CEILING item `mount` is the drop of that same base below the soffit,
//     so a surface-mounted luminaire has mount = its own height and a pendant
//     has mount = cord + shade. NO function in this file emits negative y.
//   * Returned shape: { origin, parts: [ Part ] }
//       Part = { type:'box',   size:[w,h,d], pos:[x,y,z], rot:[rx,ry,rz], slot }
//            | { type:'cyl',   rTop, rBottom, h, seg, pos, rot, slot }
//            | { type:'plane', size:[w,d], pos, rot, slot }
//     `pos` is the CENTRE of the part (three.js geometry convention).
//   * `slot` names the material slot: 'primary' takes the user tint on colorable
//     items, the others are fixed palette entries.

export const SLOTS = ['primary', 'secondary', 'accent', 'metal', 'glass', 'fabric', 'ceramic', 'foliage'];

const box = (size, pos, slot = 'primary', rot = [0, 0, 0]) => ({ type: 'box', size, pos, rot, slot });
const cyl = (rBottom, rTop, h, pos, slot = 'primary', seg = 16, rot = [0, 0, 0]) =>
  ({ type: 'cyl', rBottom, rTop, h, seg, pos, rot, slot });
const plane = (size, pos, slot = 'primary', rot = [-Math.PI / 2, 0, 0]) =>
  ({ type: 'plane', size, pos, rot, slot });

const shape = (parts) => ({ origin: 'footprint-centre-floor', parts });

/** Four square legs inset from the corners of a w x d footprint. */
function legs(w, d, h, t = 0.05, slot = 'secondary', inset = 0.02) {
  const x = w / 2 - t / 2 - inset;
  const z = d / 2 - t / 2 - inset;
  return [
    box([t, h, t], [-x, h / 2, -z], slot),
    box([t, h, t], [x, h / 2, -z], slot),
    box([t, h, t], [-x, h / 2, z], slot),
    box([t, h, t], [x, h / 2, z], slot),
  ];
}

// ---------------------------------------------------------------------------
// seating

/** Chair with a seat pad and a back. seatH default 0.45 (dining). */
export function procChair(w = 0.45, d = 0.52, h = 0.86, seatH = 0.45) {
  const pad = 0.05;
  const backH = h - seatH;
  return shape([
    ...legs(w, d, seatH - pad, 0.04),
    box([w, pad, d], [0, seatH - pad / 2, 0], 'primary'),
    box([w, backH, 0.05], [0, seatH + backH / 2, -d / 2 + 0.04], 'primary'),
  ]);
}

/** Cantilever / stacking chair — sled base instead of four legs. */
export function procStackChair(w = 0.44, d = 0.50, h = 0.80, seatH = 0.45) {
  const pad = 0.04;
  return shape([
    box([0.04, seatH, d - 0.06], [-w / 2 + 0.04, seatH / 2, 0], 'metal'),
    box([0.04, seatH, d - 0.06], [w / 2 - 0.04, seatH / 2, 0], 'metal'),
    box([w, pad, d], [0, seatH - pad / 2, 0], 'primary'),
    box([w - 0.04, h - seatH, 0.04], [0, seatH + (h - seatH) / 2, -d / 2 + 0.03], 'primary'),
  ]);
}

/** Height-adjustable task chair: five-star base, gas lift, seat, back, arms. */
export function procTaskChair(w = 0.65, d = 0.65, h = 1.10, seatH = 0.46) {
  const parts = [cyl(0.035, 0.035, seatH - 0.06, [0, (seatH - 0.06) / 2, 0], 'metal', 12)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(box([0.30, 0.03, 0.05], [Math.sin(a) * 0.15, 0.045, Math.cos(a) * 0.15], 'secondary', [0, -a, 0]));
    parts.push(cyl(0.025, 0.025, 0.05, [Math.sin(a) * 0.29, 0.025, Math.cos(a) * 0.29], 'metal', 10));
  }
  parts.push(box([w - 0.16, 0.08, d - 0.16], [0, seatH - 0.04, 0.02], 'fabric'));
  parts.push(box([w - 0.20, h - seatH - 0.10, 0.07], [0, seatH + (h - seatH) / 2, -d / 2 + 0.10], 'fabric'));
  parts.push(box([0.06, 0.05, 0.28], [-(w / 2 - 0.04), seatH + 0.21, -0.02], 'secondary'));
  parts.push(box([0.06, 0.05, 0.28], [w / 2 - 0.04, seatH + 0.21, -0.02], 'secondary'));
  return shape(parts);
}

/** Bar / counter stool. */
export function procStool(w = 0.38, d = 0.38, seatH = 0.76, footRail = 0.22) {
  const r = w / 2;
  return shape([
    ...legs(w, d, seatH - 0.05, 0.035, 'metal', 0.0),
    box([w - 0.02, 0.03, d - 0.02], [0, footRail, 0], 'metal'),
    cyl(r, r, 0.05, [0, seatH - 0.025, 0], 'primary', 20),
  ]);
}

/** Sofa / bench seating. seats drives the cushion split only. */
export function procSofa(w = 2.10, d = 0.92, h = 0.82, seats = 3, seatH = 0.42) {
  const armW = 0.18;
  const backT = 0.16;
  const inner = w - armW * 2;
  const parts = [
    box([w, 0.12, d], [0, 0.06, 0], 'secondary'),
    box([armW, h - 0.20, d], [-w / 2 + armW / 2, 0.12 + (h - 0.32) / 2, 0], 'fabric'),
    box([armW, h - 0.20, d], [w / 2 - armW / 2, 0.12 + (h - 0.32) / 2, 0], 'fabric'),
    box([inner, h - seatH, backT], [0, seatH + (h - seatH) / 2, -d / 2 + backT / 2], 'fabric'),
  ];
  const cw = inner / Math.max(1, seats);
  for (let i = 0; i < seats; i++) {
    parts.push(box([cw - 0.02, seatH - 0.12, d - backT - 0.04],
      [-inner / 2 + cw * (i + 0.5), 0.12 + (seatH - 0.12) / 2, backT / 2 - 0.02], 'primary'));
  }
  return shape(parts);
}

// ---------------------------------------------------------------------------
// tables and desks

/** Rectangular table / dining table. Top thickness 0.04. */
export function procTable(w = 1.40, d = 0.80, h = 0.75) {
  return shape([
    ...legs(w, d, h - 0.04, 0.06, 'secondary', 0.06),
    box([w, 0.04, d], [0, h - 0.02, 0], 'primary'),
  ]);
}

/** Round table on a central column and disc foot. */
export function procRoundTable(dia = 1.20, h = 0.75) {
  const r = dia / 2;
  return shape([
    cyl(r * 0.45, r * 0.45, 0.03, [0, 0.015, 0], 'metal', 24),
    cyl(0.06, 0.06, h - 0.04, [0, (h - 0.04) / 2, 0], 'metal', 16),
    cyl(r, r, 0.04, [0, h - 0.02, 0], 'primary', 32),
  ]);
}

/** Desk with a modesty panel at the back and a cable tray. */
export function procDesk(w = 1.60, d = 0.80, h = 0.74) {
  return shape([
    box([0.06, h - 0.03, d - 0.10], [-w / 2 + 0.06, (h - 0.03) / 2, 0], 'metal'),
    box([0.06, h - 0.03, d - 0.10], [w / 2 - 0.06, (h - 0.03) / 2, 0], 'metal'),
    box([w - 0.20, 0.35, 0.02], [0, h - 0.28, -d / 2 + 0.08], 'secondary'),
    box([w, 0.03, d], [0, h - 0.015, 0], 'primary'),
  ]);
}

/** Counter: a worktop at `h` with an optional lower customer ledge at 0.75. */
export function procCounter(w = 2.20, d = 0.80, h = 1.10, ledge = 0.75) {
  const parts = [
    box([w, h - 0.04, d - 0.20], [0, (h - 0.04) / 2, -0.10], 'primary'),
    box([w, 0.04, d - 0.20], [0, h - 0.02, -0.10], 'accent'),
  ];
  if (ledge > 0) parts.push(box([w, 0.04, 0.24], [0, ledge - 0.02, d / 2 - 0.12], 'accent'));
  return shape(parts);
}

// ---------------------------------------------------------------------------
// storage

/** Carcase with door leaves on the +z face. doors = 0 leaves it open. */
export function procCabinet(w = 1.00, h = 2.10, d = 0.60, doors = 2, plinth = 0.10) {
  const carD = d - 0.05;                    // 0.03 door + 0.02 handle live in front
  const parts = [
    box([w - 0.06, plinth, carD - 0.04], [0, plinth / 2, -0.025], 'secondary'),
    box([w, h - plinth, carD], [0, plinth + (h - plinth) / 2, -0.025], 'primary'),
  ];
  const lw = w / Math.max(1, doors);
  for (let i = 0; i < doors; i++) {
    parts.push(box([lw - 0.006, h - plinth - 0.02, 0.02],
      [-w / 2 + lw * (i + 0.5), plinth + (h - plinth) / 2, d / 2 - 0.026], 'accent'));
    parts.push(cyl(0.008, 0.008, 0.12,
      [-w / 2 + lw * (i + (i % 2 ? 0.12 : 0.88)), plinth + (h - plinth) * 0.55, d / 2 - 0.008], 'metal', 8));
  }
  return shape(parts);
}

/** Chest of drawers — fronts with handles, no doors. */
export function procDrawers(w = 0.80, h = 0.85, d = 0.45, drawers = 4, plinth = 0.08) {
  const carD = d - 0.05;
  const parts = [
    box([w - 0.06, plinth, carD - 0.02], [0, plinth / 2, -0.025], 'secondary'),
    box([w, h - plinth, carD], [0, plinth + (h - plinth) / 2, -0.025], 'primary'),
  ];
  const dh = (h - plinth) / Math.max(1, drawers);
  for (let i = 0; i < drawers; i++) {
    const y = plinth + dh * (i + 0.5);
    parts.push(box([w - 0.04, dh - 0.012, 0.02], [0, y, d / 2 - 0.035], 'accent'));
    parts.push(box([w * 0.45, 0.015, 0.03], [0, y, d / 2 - 0.015], 'metal'));
  }
  return shape(parts);
}

/** Open shelving unit. */
export function procShelf(w = 0.80, h = 1.90, d = 0.32, shelves = 5) {
  const parts = [
    box([0.02, h, d], [-w / 2 + 0.01, h / 2, 0], 'primary'),
    box([0.02, h, d], [w / 2 - 0.01, h / 2, 0], 'primary'),
    box([w, 0.02, d], [0, h - 0.01, 0], 'primary'),
    box([w - 0.04, 0.01, d - 0.01], [0, 0.005, 0], 'primary'),
  ];
  for (let i = 1; i < shelves; i++) {
    parts.push(box([w - 0.04, 0.02, d - 0.01], [0, (h / shelves) * i, 0], 'primary'));
  }
  return shape(parts);
}

// ---------------------------------------------------------------------------
// beds

/** Bed. w x d is the mattress footprint; headboard sits at -z. */
export function procBed(w = 1.60, d = 2.00, mattressH = 0.55, headboardH = 0.95) {
  const frameH = mattressH - 0.20;
  return shape([
    box([w, frameH, d], [0, frameH / 2, 0], 'secondary'),
    box([w - 0.06, 0.20, d - 0.06], [0, frameH + 0.10, 0], 'fabric'),
    box([w, headboardH, 0.05], [0, headboardH / 2, -d / 2 + 0.025], 'primary'),
    box([w * 0.42, 0.09, 0.40], [-w * 0.24, mattressH + 0.045, -d / 2 + 0.28], 'accent'),
    box([w * 0.42, 0.09, 0.40], [w * 0.24, mattressH + 0.045, -d / 2 + 0.28], 'accent'),
  ]);
}

/** Cot / bunk-style frame with slatted sides. */
export function procCot(w = 0.70, d = 1.40, h = 0.95, mattressH = 0.42) {
  const parts = [
    box([w, 0.06, d], [0, mattressH - 0.03, 0], 'secondary'),
    box([w, 0.10, d - 0.04], [0, mattressH + 0.05, 0], 'fabric'),
  ];
  for (const sx of [-1, 1]) parts.push(box([0.05, h, 0.05], [sx * (w / 2 - 0.025), h / 2, -d / 2 + 0.025], 'primary'));
  for (const sx of [-1, 1]) parts.push(box([0.05, h, 0.05], [sx * (w / 2 - 0.025), h / 2, d / 2 - 0.025], 'primary'));
  const bars = 9;
  for (let i = 0; i < bars; i++) {
    const z = -d / 2 + 0.08 + (d - 0.16) * (i / (bars - 1));
    parts.push(box([0.025, h - 0.10, 0.025], [-w / 2 + 0.02, h / 2, z], 'primary'));
    parts.push(box([0.025, h - 0.10, 0.025], [w / 2 - 0.02, h / 2, z], 'primary'));
  }
  return shape(parts);
}

// ---------------------------------------------------------------------------
// sanitary

/** Close-coupled floor-standing WC. Pan projection = d, cistern at -z. */
export function procWC(w = 0.38, d = 0.70, h = 0.79, seatH = 0.42) {
  return shape([
    box([w * 0.55, seatH - 0.12, d * 0.55], [0, (seatH - 0.12) / 2, -d * 0.10], 'ceramic'),
    cyl(w / 2, w / 2 * 0.92, 0.12, [0, seatH - 0.07, d * 0.12], 'ceramic', 20),
    cyl(w / 2 * 0.95, w / 2 * 0.95, 0.04, [0, seatH - 0.005, d * 0.12], 'accent', 20),
    box([w, h - seatH + 0.02, 0.20], [0, seatH - 0.02 + (h - seatH) / 2, -d / 2 + 0.10], 'ceramic'),
  ]);
}

/** Wall-hung WC — same pan, no cistern volume (concealed in the wall). */
export function procWCWallHung(w = 0.36, d = 0.54, seatH = 0.40) {
  return shape([
    box([w * 0.5, 0.18, d * 0.5], [0, seatH - 0.11, -d * 0.22], 'ceramic'),
    cyl(w / 2, w / 2 * 0.9, 0.14, [0, seatH - 0.07, d * 0.10], 'ceramic', 20),
    cyl(w / 2 * 0.95, w / 2 * 0.95, 0.04, [0, seatH - 0.005, d * 0.10], 'accent', 20),
  ]);
}

/** Washbasin on a pedestal or bracket. rimH is the top of the bowl. */
export function procBasin(w = 0.56, d = 0.46, rimH = 0.85, pedestal = true) {
  const parts = [
    box([w, 0.09, d], [0, rimH - 0.045, 0], 'ceramic'),
    box([w - 0.12, 0.05, d - 0.12], [0, rimH - 0.075, 0.02], 'accent'),
    cyl(0.018, 0.018, 0.16, [0, rimH + 0.08, -d / 2 + 0.07], 'metal', 10),
    box([0.10, 0.02, 0.05], [0, rimH + 0.15, -d / 2 + 0.11], 'metal'),
  ];
  if (pedestal) parts.push(cyl(0.11, 0.09, rimH - 0.09, [0, (rimH - 0.09) / 2, -0.02], 'ceramic', 16));
  return shape(parts);
}

/** Bathtub — rim height h, inner well recessed. */
export function procBath(w = 1.70, d = 0.75, h = 0.58) {
  return shape([
    box([w, h, d], [0, h / 2, 0], 'ceramic'),
    box([w - 0.16, 0.06, d - 0.14], [0, h - 0.02, 0], 'accent'),
    cyl(0.02, 0.02, 0.18, [-w / 2 + 0.10, h + 0.09, 0], 'metal', 10),
  ]);
}

/** Shower: tray, glass screen on two sides, riser rail. */
export function procShower(w = 0.90, d = 0.90, h = 2.00) {
  return shape([
    box([w, 0.06, d], [0, 0.03, 0], 'ceramic'),
    plane([w, h], [0, h / 2, d / 2], 'glass', [0, 0, 0]),
    plane([d, h], [w / 2, h / 2, 0], 'glass', [0, -Math.PI / 2, 0]),
    cyl(0.015, 0.015, 1.00, [-w / 2 + 0.08, h - 0.65, -d / 2 + 0.08], 'metal', 10),
    cyl(0.09, 0.09, 0.02, [-w / 2 + 0.08, h - 0.06, -d / 2 + 0.16], 'metal', 16),
  ]);
}

/** Wall-hung urinal bowl. rimH is the front lip height. */
export function procUrinal(w = 0.36, d = 0.34, h = 0.65, rimH = 0.60) {
  return shape([
    box([w, h, d * 0.6], [0, h / 2, -d * 0.2], 'ceramic'),
    cyl(Math.min(w, d) * 0.47, Math.min(w, d) * 0.47, 0.30, [0, rimH - 0.15, 0], 'ceramic', 18),
  ]);
}

// ---------------------------------------------------------------------------
// kitchen

/** Base unit: plinth, carcase, doors, worktop overhanging at +z. */
export function procKitchenBase(w = 0.60, d = 0.60, h = 0.90, doors = 1, drawersTop = false) {
  const plinth = 0.15, top = 0.04;
  const carH = h - plinth - top;
  const parts = [
    box([w, plinth, d - 0.10], [0, plinth / 2, -0.05], 'secondary'),
    box([w, carH, d - 0.05], [0, plinth + carH / 2, -0.025], 'primary'),
    box([w, top, d], [0, h - top / 2, 0], 'accent'),
  ];
  const frontH = drawersTop ? carH - 0.16 : carH;
  const fz = d / 2 - 0.036;                 // door face; the handle fills the last 0.03
  if (drawersTop) parts.push(box([w - 0.006, 0.14, 0.02], [0, plinth + carH - 0.08, fz], 'primary'));
  const lw = w / Math.max(1, doors);
  for (let i = 0; i < doors; i++) {
    parts.push(box([lw - 0.006, frontH - 0.01, 0.02],
      [-w / 2 + lw * (i + 0.5), plinth + frontH / 2, fz], 'primary'));
  }
  parts.push(box([w * 0.6, 0.014, 0.03], [0, plinth + frontH - 0.05, d / 2 - 0.015], 'metal'));
  return shape(parts);
}

/** Wall unit — anchored at its own base; the catalogue `mount` puts it at 1.45. */
export function procKitchenWall(w = 0.60, d = 0.35, h = 0.72, doors = 1) {
  const parts = [box([w, h, d - 0.05], [0, h / 2, -0.025], 'primary')];
  const lw = w / Math.max(1, doors);
  for (let i = 0; i < doors; i++) {
    parts.push(box([lw - 0.006, h - 0.01, 0.02], [-w / 2 + lw * (i + 0.5), h / 2, d / 2 - 0.026], 'primary'));
  }
  parts.push(box([w * 0.6, 0.014, 0.03], [0, 0.06, d / 2 - 0.015], 'metal'));
  return shape(parts);
}

/** Tall appliance / housing unit (fridge, oven tower). */
export function procTallUnit(w = 0.60, d = 0.65, h = 2.00, splitAt = 0.0) {
  const carD = d - 0.05;
  const parts = [box([w, h, carD], [0, h / 2, -0.025], 'primary')];
  const fz = d / 2 - 0.036;
  if (splitAt > 0) {
    parts.push(box([w - 0.006, splitAt - 0.006, 0.02], [0, splitAt / 2, fz], 'metal'));
    parts.push(box([w - 0.006, h - splitAt - 0.006, 0.02], [0, splitAt + (h - splitAt) / 2, fz], 'metal'));
  } else {
    parts.push(box([w - 0.006, h - 0.01, 0.02], [0, h / 2, fz], 'metal'));
  }
  parts.push(box([0.02, h * 0.5, 0.03], [w / 2 - 0.06, h * 0.62, d / 2 - 0.015], 'metal'));
  return shape(parts);
}

/** Hob: a glass plate with burner rings, sits on the worktop (catalogue mount 0.90). */
export function procHob(w = 0.60, d = 0.52, zones = 4) {
  const parts = [box([w, 0.04, d], [0, 0.02, 0], 'glass')];
  const r = Math.min(w, d) * 0.17;
  const gx = w * 0.24, gz = d * 0.24;
  const grid = zones === 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0]];
  for (const [ix, iz] of grid) parts.push(cyl(r, r, 0.005, [ix * gx, 0.043, iz * gz], 'accent', 20));
  return shape(parts);
}

/** Sink bowl + mixer, to be dropped onto a worktop. */
export function procSink(w = 0.50, d = 0.40, depth = 0.18) {
  return shape([
    box([w, 0.02, d], [0, -0.01, 0], 'metal'),
    box([w - 0.08, depth, d - 0.08], [0, -depth / 2 - 0.02, 0], 'metal'),
    cyl(0.02, 0.02, 0.30, [0, 0.15, -d / 2 - 0.04], 'metal', 10),
    box([0.03, 0.03, 0.18], [0, 0.29, -d / 2 + 0.04], 'metal'),
  ]);
}

// ---------------------------------------------------------------------------
// openings

/**
 * Door leaf, hinged on -x, hung in a frame. `w` and `h` are the CLEAR opening
 * (leaf) dimensions; the frame adds ~0.06 all round. `open` in radians rotates
 * the leaf about its hinge for swing previews.
 */
export function procDoorLeaf(w = 0.90, h = 2.05, thickness = 0.04, open = 0, glazed = false) {
  const f = 0.06;
  const parts = [
    box([f, h + f, 0.12], [-w / 2 - f / 2, (h + f) / 2, 0], 'secondary'),
    box([f, h + f, 0.12], [w / 2 + f / 2, (h + f) / 2, 0], 'secondary'),
    box([w + f * 2, f, 0.12], [0, h + f / 2, 0], 'secondary'),
  ];
  const hinge = -w / 2;
  const cx = hinge + Math.cos(open) * (w / 2);
  const cz = Math.sin(open) * (w / 2);
  parts.push(box([w, h, thickness], [cx, h / 2, cz], 'primary', [0, open, 0]));
  if (glazed) parts.push(box([w - 0.20, h - 0.50, thickness + 0.005], [cx, h * 0.56, cz], 'glass', [0, open, 0]));
  parts.push(box([0.11, 0.03, 0.05], [cx + Math.cos(open) * (w / 2 - 0.07), 1.05, cz + Math.sin(open) * (w / 2 - 0.07)], 'metal', [0, open, 0]));
  return shape(parts);
}

/**
 * Window frame with sash divisions. `mullions` = vertical divisions - 1,
 * `transoms` = horizontal divisions - 1. Origin at the bottom of the opening.
 */
export function procWindowFrame(w = 1.20, h = 1.40, mullions = 1, transoms = 0, frame = 0.06) {
  const parts = [
    box([w, frame, 0.10], [0, frame / 2, 0], 'secondary'),
    box([w, frame, 0.10], [0, h - frame / 2, 0], 'secondary'),
    box([frame, h, 0.10], [-w / 2 + frame / 2, h / 2, 0], 'secondary'),
    box([frame, h, 0.10], [w / 2 - frame / 2, h / 2, 0], 'secondary'),
    box([w - frame * 2, h - frame * 2, 0.012], [0, h / 2, 0], 'glass'),
  ];
  for (let i = 1; i <= mullions; i++) {
    parts.push(box([frame * 0.8, h - frame * 2, 0.10], [-w / 2 + (w / (mullions + 1)) * i, h / 2, 0], 'secondary'));
  }
  for (let j = 1; j <= transoms; j++) {
    parts.push(box([w - frame * 2, frame * 0.8, 0.10], [0, (h / (transoms + 1)) * j, 0], 'secondary'));
  }
  parts.push(box([w + 0.10, 0.03, 0.22], [0, -0.015, 0.06], 'accent'));   // external sill
  return shape(parts);
}

// ---------------------------------------------------------------------------
// lighting, plants, props

/** Pendant: a cord of length `drop` and a conical shade. Origin at the ceiling. */
export function procPendant(shadeR = 0.20, shadeH = 0.24, drop = 1.20) {
  return shape([
    cyl(0.004, 0.004, drop, [0, -drop / 2, 0], 'metal', 6),
    cyl(shadeR, shadeR * 0.35, shadeH, [0, -drop - shadeH / 2, 0], 'primary', 24),
    cyl(0.03, 0.03, 0.06, [0, -drop - shadeH + 0.02, 0], 'glass', 10),
  ]);
}

/** Floor lamp: disc base, stem, drum shade. */
export function procFloorLamp(h = 1.60, shadeR = 0.20, shadeH = 0.26) {
  return shape([
    cyl(0.16, 0.16, 0.02, [0, 0.01, 0], 'metal', 20),
    cyl(0.012, 0.012, h - shadeH, [0, (h - shadeH) / 2, 0], 'metal', 8),
    cyl(shadeR, shadeR * 0.85, shadeH, [0, h - shadeH / 2, 0], 'primary', 24),
  ]);
}

/** Desk lamp: small weighted base, jointed arm, small shade. */
export function procDeskLamp(h = 0.55, baseR = 0.09, shadeR = 0.08) {
  const armH = h - 0.16;
  return shape([
    cyl(baseR, baseR, 0.025, [0, 0.012, 0], 'metal', 18),
    cyl(0.012, 0.012, armH, [0, 0.025 + armH / 2, 0], 'metal', 8),
    cyl(shadeR, shadeR * 0.55, 0.12, [0, h - 0.06, 0.02], 'primary', 16),
  ]);
}

/** Linear luminaire — a bar. Origin at its own base (ceiling-mounted). */
export function procLinearLight(len = 1.20, w = 0.08, h = 0.07) {
  return shape([
    box([len, h, w], [0, h / 2, 0], 'metal'),
    box([len - 0.04, 0.012, w - 0.02], [0, 0.006, 0], 'glass'),
  ]);
}

/** Potted plant: pot + a few foliage blobs. Deterministic, no randomness. */
export function procPlant(spread = 0.80, h = 1.80, potR = 0.20) {
  const potH = Math.min(0.45, h * 0.22);
  const parts = [
    cyl(potR * 0.75, potR, potH, [0, potH / 2, 0], 'accent', 18),
    cyl(0.03, 0.025, h - potH, [0, potH + (h - potH) / 2, 0], 'secondary', 8),
  ];
  const blobs = 5;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const t = 0.55 + 0.35 * (i % 2);
    parts.push(cyl(spread * 0.22, spread * 0.22, spread * 0.16,
      [Math.sin(a) * spread * 0.28, potH + (h - potH) * t, Math.cos(a) * spread * 0.28], 'foliage', 10));
  }
  parts.push(cyl(spread * 0.3, spread * 0.05, spread * 0.32, [0, h - spread * 0.16, 0], 'foliage', 12));
  return shape(parts);
}

/** Generic rectangular prop (appliance, screen, board, mat). */
export function procBlock(w, h, d, slot = 'primary') {
  return shape([box([w, h, d], [0, h / 2, 0], slot)]);
}

/** Flat panel prop mounted on a wall (whiteboard, TV, radiator). */
export function procPanel(w, h, d = 0.06, slot = 'primary', faceSlot = null) {
  const parts = [box([w, h, d], [0, h / 2, 0], slot)];
  if (faceSlot) parts.push(box([w - 0.06, h - 0.06, 0.006], [0, h / 2, d / 2 - 0.004], faceSlot));
  return shape(parts);
}

/** Monitor on a stand. */
export function procMonitor(w = 0.55, h = 0.45, d = 0.20) {
  const screenH = h - 0.13;
  return shape([
    box([d * 0.9, 0.02, d], [0, 0.01, 0], 'metal'),
    box([0.05, 0.11, 0.05], [0, 0.065, 0], 'metal'),
    box([w, screenH, 0.03], [0, 0.12 + screenH / 2, -0.01], 'secondary'),
    box([w - 0.02, screenH - 0.03, 0.006], [0, 0.13 + screenH / 2, 0.008], 'glass'),
  ]);
}

// ---------------------------------------------------------------------------
// circulation

/**
 * Straight stair flight. Origin at the bottom of the flight, footprint centred
 * on x, running towards +z. Total rise = risers * riser; total going =
 * (risers - 1) * going, plus the landing nosing.
 */
export function procStairFlight(width = 1.00, risers = 16, riser = 0.175, going = 0.28) {
  const parts = [];
  const run = risers * going;
  for (let i = 0; i < risers; i++) {
    parts.push(box([width, riser, going],
      [0, riser * (i + 0.5), -run / 2 + going * (i + 0.5)], 'primary'));
  }
  for (const sx of [-1, 1]) {
    parts.push(box([0.05, 1.00, 0.05], [sx * (width / 2 - 0.03), riser + 0.50, -run / 2 + 0.05], 'metal'));
    parts.push(box([0.05, 1.00, 0.05], [sx * (width / 2 - 0.03), riser * risers + 0.50, run / 2 - 0.05], 'metal'));
    parts.push(box([0.05, 0.05, run],
      [sx * (width / 2 - 0.03), riser + 1.00 + (riser * risers) / 2, 0], 'metal',
      [-Math.atan2(riser * risers - riser, run), 0, 0]));
  }
  return shape(parts);
}

/**
 * U-return stair: two flights of `risers/2` steps either side of a half-landing.
 * Up on the -x flight towards +z, landing at the far end, down-side flight on +x
 * running back towards -z. Footprint = (2*width + gap) x (flightRun + landing).
 */
export function procStairUReturn(width = 1.10, risers = 16, riser = 0.175, going = 0.28, gap = 0.10) {
  const half = Math.round(risers / 2);
  const run = half * going;
  const landing = 1.10;
  const depth = run + landing;
  const xa = -(width + gap) / 2;
  const xb = (width + gap) / 2;
  const parts = [];
  for (let i = 0; i < half; i++) {
    parts.push(box([width, riser, going], [xa, riser * (i + 0.5), -depth / 2 + going * (i + 0.5)], 'primary'));
    parts.push(box([width, riser, going],
      [xb, riser * (half + i + 0.5), depth / 2 - landing - going * (i + 0.5)], 'primary'));
  }
  parts.push(box([width * 2 + gap, 0.20, landing],
    [0, riser * half - 0.10, depth / 2 - landing / 2], 'primary'));
  for (const [x, y0] of [[xa - width / 2 + 0.03, riser], [xb + width / 2 - 0.03, riser * half]]) {
    parts.push(box([0.05, 1.00, 0.05], [x, y0 + 0.50, -depth / 2 + 0.05], 'metal'));
  }
  return shape(parts);
}

/** Lift shaft with a car-door opening on +z. w x d is the SHAFT footprint. */
export function procLiftShaft(w = 1.60, d = 2.00, h = 2.60, doorW = 0.90, doorH = 2.10) {
  const t = 0.20;
  const side = (w - doorW) / 2;
  return shape([
    box([w, h, t], [0, h / 2, -d / 2 + t / 2], 'secondary'),
    box([t, h, d - t * 2], [-w / 2 + t / 2, h / 2, 0], 'secondary'),
    box([t, h, d - t * 2], [w / 2 - t / 2, h / 2, 0], 'secondary'),
    box([side, h, t], [-(w - side) / 2, h / 2, d / 2 - t / 2], 'secondary'),
    box([side, h, t], [(w - side) / 2, h / 2, d / 2 - t / 2], 'secondary'),
    box([doorW, h - doorH, t], [0, doorH + (h - doorH) / 2, d / 2 - t / 2], 'secondary'),
    box([doorW / 2 - 0.005, doorH, 0.05], [-doorW / 4, doorH / 2, d / 2 - 0.03], 'metal'),
    box([doorW / 2 - 0.005, doorH, 0.05], [doorW / 4, doorH / 2, d / 2 - 0.03], 'metal'),
  ]);
}

/** Accessible ramp: a sloped slab plus handrails. rise/run set the gradient. */
export function procRamp(width = 1.20, rise = 0.40, run = 4.80) {
  const angle = Math.atan2(rise, run);
  const len = Math.hypot(rise, run);
  const parts = [box([width, 0.12, len], [0, rise / 2, 0], 'primary', [-angle, 0, 0])];
  for (const sx of [-1, 1]) {
    parts.push(box([0.05, 0.05, len], [sx * (width / 2 - 0.03), rise / 2 + 0.95, 0], 'metal', [-angle, 0, 0]));
    parts.push(box([0.05, 0.95, 0.05], [sx * (width / 2 - 0.03), 0.475, -run / 2 + 0.06], 'metal'));
    parts.push(box([0.05, 0.95, 0.05], [sx * (width / 2 - 0.03), rise + 0.475, run / 2 - 0.06], 'metal'));
  }
  return shape(parts);
}

/** Flat floor-laid element: rug, mat, nap mattress, parking bay marking. */
export function procMat(w, d, h = 0.02, slot = 'primary') {
  return shape([box([w, h, d], [0, h / 2, 0], slot)]);
}

/**
 * Look up the placeholder shape for a catalogue entry. `entry.proc` is
 * [functionName, ...args]; unknown names fall back to a plain block.
 */
export const PROC = {
  procChair, procStackChair, procTaskChair, procStool, procSofa,
  procTable, procRoundTable, procDesk, procCounter,
  procCabinet, procDrawers, procShelf,
  procBed, procCot,
  procWC, procWCWallHung, procBasin, procBath, procShower, procUrinal,
  procKitchenBase, procKitchenWall, procTallUnit, procHob, procSink,
  procDoorLeaf, procWindowFrame,
  procPendant, procFloorLamp, procDeskLamp, procLinearLight, procPlant,
  procBlock, procPanel, procMonitor,
  procStairFlight, procStairUReturn, procLiftShaft, procRamp, procMat,
};

export function buildProcShape(entry) {
  const spec = entry && entry.proc;
  if (!spec) {
    const [w, h, d] = (entry && entry.size) || [0.5, 0.5, 0.5];
    return procBlock(w, h, d);
  }
  const [name, ...args] = spec;
  const fn = PROC[name];
  if (!fn) {
    const [w, h, d] = entry.size;
    return procBlock(w, h, d);
  }
  return fn(...args);
}

/** Axis-aligned local bounds of a shape — used to sanity-check against size. */
export function shapeBounds(sh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of sh.parts) {
    let hx, hy, hz;
    if (p.type === 'box') { [hx, hy, hz] = p.size.map(v => v / 2); }
    else if (p.type === 'cyl') { const r = Math.max(p.rBottom, p.rTop); hx = r; hy = p.h / 2; hz = r; }
    else { hx = p.size[0] / 2; hy = p.size[1] / 2; hz = 0.005; }
    for (let i = 0; i < 3; i++) {
      const half = [hx, hy, hz][i];
      min[i] = Math.min(min[i], p.pos[i] - half);
      max[i] = Math.max(max[i], p.pos[i] + half);
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
