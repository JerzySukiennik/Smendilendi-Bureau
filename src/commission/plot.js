// Procedural plots: boundary, setbacks, street, neighbours, trees, terrain.
// View-free: no imports at all. Pure functions, deterministic given an rng.
//
// Coordinate convention (shared with BuildingModel): metres, x to the east,
// z to the SOUTH, y up. So north is -z, south is +z, east is +x, west is -x.
// Boundaries are closed CCW polygons in the (x, z) plane, first point not
// repeated at the end.

export const DIRS = ['north', 'east', 'south', 'west'];
export const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

const R = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// polygon maths

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    s += ax * bz - bx * az;
  }
  return Math.abs(s) / 2;
}

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    s += ax * bz - bx * az;
  }
  return s / 2;
}

export function ensureCCW(poly) {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

export function polygonCentroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return [0, 0];
  return [cx / (6 * a), cz / (6 * a)];
}

export function polygonBounds(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

export function pointInPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersects = (zi > z) !== (zj > z)
      && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

export function distanceToPolygon(poly, x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    best = Math.min(best, distToSegment(x, z, ax, az, bx, bz));
  }
  return best;
}

/** Outward compass direction of the edge a -> b of a CCW polygon. */
export function edgeFacing(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  // inward normal of a CCW polygon edge is the left normal (-dz, dx)
  const ox = dz, oz = -dx;               // outward = -inward
  if (Math.abs(ox) >= Math.abs(oz)) return ox > 0 ? 'east' : 'west';
  return oz > 0 ? 'south' : 'north';
}

/**
 * Inset a simple polygon by a per-edge distance. Each edge is pushed along its
 * inward normal, then consecutive offset lines are intersected. Exact for the
 * convex plots and correct for the single reflex corner of an L-shaped one.
 */
export function insetPolygon(poly, distFor) {
  const n = poly.length;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-9;
    const inx = -dz / len, inz = dx / len;         // inward normal, CCW polygon
    const d = distFor(a, b, i);
    lines.push({ px: a[0] + inx * d, pz: a[1] + inz * d, dx: dx / len, dz: dz / len });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const denom = l1.dx * l2.dz - l1.dz * l2.dx;
    if (Math.abs(denom) < 1e-9) {
      out.push([l2.px, l2.pz]);                     // parallel: keep the corner
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dz - (l2.pz - l1.pz) * l2.dx) / denom;
    out.push([R(l1.px + l1.dx * t, 3), R(l1.pz + l1.dz * t, 3)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// public API over a generated plot

const buildableCache = new WeakMap();

/** The polygon inside which walls are allowed: boundary inset by the setbacks. */
export function buildableArea(plot) {
  const hit = buildableCache.get(plot);
  if (hit) return hit;
  const streets = plot.streetSides || [plot.street.side];
  const rears = streets.map(s => OPPOSITE[s]);
  const poly = insetPolygon(plot.boundary, (a, b) => {
    const facing = edgeFacing(a, b);
    if (streets.includes(facing)) return plot.setbacks.front;
    if (rears.includes(facing)) return plot.setbacks.rear;
    return plot.setbacks.side;
  });
  const clean = polygonArea(poly) > 1 ? poly : plot.boundary;
  buildableCache.set(plot, clean);
  return clean;
}

/** True when (x, z) is inside the setback line and clear of protected trees. */
export function insideBuildableArea(plot, x, z) {
  if (!pointInPolygon(buildableArea(plot), x, z)) return false;
  for (const t of plot.trees) {
    if (!t.protected) continue;
    if (Math.hypot(x - t.x, z - t.z) < t.radius) return false;
  }
  return true;
}

/** Distance in metres to the legal site limit. Positive inside, negative outside. */
export function distanceToBoundary(plot, x, z) {
  const d = distanceToPolygon(plot.boundary, x, z);
  return pointInPolygon(plot.boundary, x, z) ? d : -d;
}

export function buildableAreaSize(plot) {
  return R(polygonArea(buildableArea(plot)), 1);
}

// ---------------------------------------------------------------------------
// solvability
//
// Sizing the plot from the footprint is not enough: setbacks, protected trees
// and the slope all eat into the site AFTER it has been sized, and a brief that
// cannot be built is a bug, not a challenge. Everything below re-measures the
// site once every obstruction is on it, and generatePlot() refuses to return a
// plot that fails.
//
// The measurement rasterises the buildable polygon, subtracts protected tree
// crowns, and looks for one connected obstruction-free region that
//   - holds the required footprint (plus slack for walls),
//   - is at least minSide wide somewhere, so rooms actually fit,
//   - has clear frontage towards the street the entrance must face,
//   - and is flat enough for one floor plate.

export const SOLVABILITY = {
  cell: 0.5,          // raster resolution, metres
  areaMargin: 1.10,   // footprint plus slack for wall thickness and setting out
  minSide: 4.0,       // narrowest bay habitable rooms fit in
  minFrontage: 3.0,   // clear street frontage for an entrance bay
  maxFall: 2.40,      // 1.20 m of cut plus 1.20 m of fill under one floor plate
  // The generator holds itself strictly INSIDE those limits, so a site that
  // only just scrapes past a raster tie is regenerated rather than shipped.
  slack: 2.0,         // extra square metres over the footprint requirement
  fallSlack: 0.05,    // metres kept in hand under maxFall
};

function crownBlocks(trees, x, z) {
  for (const t of trees) {
    if (!t.protected) continue;
    if (Math.hypot(x - t.x, z - t.z) < t.radius) return true;
  }
  return false;
}

/** Largest axis-aligned all-true rectangle in a mask (histogram sweep). */
function maxRectangle(mask, W, H) {
  const heights = new Int32Array(W);
  let best = { w: 0, h: 0, area: 0 };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) heights[i] = mask[j * W + i] ? heights[i] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= W; i++) {
      const cur = i === W ? 0 : heights[i];
      let start = i;
      while (stack.length && stack[stack.length - 1].h >= cur) {
        const top = stack.pop();
        const w = i - top.i;
        if (w * top.h > best.area) best = { w, h: top.h, area: w * top.h };
        start = top.i;
      }
      stack.push({ i: start, h: cur });
    }
  }
  return best;
}

/**
 * assessSolvability(plot, footprint) -> report
 * `footprint` is the gross area the building needs on ONE storey at the storey
 * count the brief allows. The report is attached to the plot as plot.solvable.
 */
export function assessSolvability(plot, footprint) {
  const need = Math.max(1, footprint);
  const S = SOLVABILITY;
  const build = plot.buildable || buildableArea(plot);
  const trees = plot.trees || [];
  const bb = polygonBounds(build);
  const W = Math.max(1, Math.ceil(bb.width / S.cell));
  const H = Math.max(1, Math.ceil(bb.depth / S.cell));
  const cellArea = S.cell * S.cell;
  const cx = i => bb.minX + (i + 0.5) * S.cell;
  const cz = j => bb.minZ + (j + 0.5) * S.cell;
  const heightAt = (plot.terrain && plot.terrain.heightAt) || (() => 0);

  const free = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = cx(i), z = cz(j);
      if (!pointInPolygon(build, x, z)) continue;
      if (crownBlocks(trees, x, z)) continue;
      free[j * W + i] = 1;
    }
  }

  // connected regions, 4-neighbour
  const label = new Int32Array(W * H).fill(-1);
  const regions = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!free[s] || label[s] >= 0) continue;
    const id = regions.length;
    regions.push([]);
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      regions[id].push(p);
      const i = p % W, j = (p / W) | 0;
      if (i > 0 && free[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack.push(p - 1); }
      if (i < W - 1 && free[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack.push(p + 1); }
      if (j > 0 && free[p - W] && label[p - W] < 0) { label[p - W] = id; stack.push(p - W); }
      if (j < H - 1 && free[p + W] && label[p + W] < 0) { label[p + W] = id; stack.push(p + W); }
    }
  }

  const facing = plot.entranceFacing || (plot.streetSides || [])[0] || 'north';
  const [ox, oz] = outwardVector(facing);
  let best = null;

  for (const cells of regions) {
    const area = R(cells.length * cellArea, 1);
    const mask = new Uint8Array(W * H);
    for (const p of cells) mask[p] = 1;
    const rect = maxRectangle(mask, W, H);
    const minSide = R(Math.min(rect.w, rect.h) * S.cell, 2);

    // frontage: cells that can see the street they must face, walking straight
    // out without passing through a protected crown
    const lanes = new Set();
    for (const p of cells) {
      const i = p % W, j = (p / W) | 0;
      let x = cx(i), z = cz(j), clear = true;
      for (let step = 0; step < 600; step++) {
        x += ox * S.cell; z += oz * S.cell;
        if (crownBlocks(trees, x, z)) { clear = false; break; }
        if (!pointInPolygon(plot.boundary, x, z)) break;
      }
      if (clear) lanes.add(ox === 0 ? i : j);
    }
    const frontage = R(lanes.size * S.cell, 2);

    // fall across the flattest footprint-sized band: on a planar slope that is
    // the strip the building would actually sit on
    const hs = cells.map(p => heightAt(cx(p % W), cz((p / W) | 0))).sort((a, b) => a - b);
    const band = Math.min(hs.length, Math.max(1, Math.ceil(need * S.areaMargin / cellArea)));
    let fall = Infinity;
    for (let s0 = 0; s0 + band <= hs.length; s0++) {
      const f = hs[s0 + band - 1] - hs[s0];
      if (f < fall) fall = f;
    }
    if (!Number.isFinite(fall)) fall = hs.length ? hs[hs.length - 1] - hs[0] : 0;
    const rawFall = fall;
    fall = R(fall, 2);

    const reasons = [];
    // compare on the raw measurements, never on the rounded report values
    if (cells.length * cellArea < need * S.areaMargin + S.slack) reasons.push('area');
    if (Math.min(rect.w, rect.h) * S.cell < S.minSide) reasons.push('narrow');
    if (lanes.size * S.cell < S.minFrontage) reasons.push('frontage');
    if (rawFall > S.maxFall - S.fallSlack) reasons.push('slope');
    const cand = { area, minSide, frontage, fall, reasons, ok: reasons.length === 0 };
    if (!best || (cand.ok && !best.ok) || (cand.ok === best.ok && cand.area > best.area)) best = cand;
  }

  const b = best || { area: 0, minSide: 0, frontage: 0, fall: 0, reasons: ['empty'], ok: false };
  return {
    ok: b.ok,
    need: R(need, 1),
    freeArea: b.area,
    minSide: b.minSide,
    frontage: b.frontage,
    fall: b.fall,
    regions: regions.length,
    reasons: b.reasons,
  };
}

// ---------------------------------------------------------------------------
// generation

// Six of the eight entries here used to come out as a plain quadrilateral:
// 'deep-narrow', 'wide-shallow' and 'corner' all fell through to the rectangle
// case, differing only in aspect ratio or in which side the street is on, and
// 'trapezoid' has four corners too. Measured across 24 commissions that gave 20
// quadrilaterals, which is exactly why Jurek said the plots "are laid out oddly,
// very similarly". The three genuinely different outlines below carry their
// weight: a flag plot (the narrow access strip to a wide rear garden that is
// everywhere in Polish suburbs), a wedge, and a stepped boundary.
const SHAPES = [
  'rect', 'deep-narrow', 'wide-shallow', 'corner',
  'L', 'trapezoid', 'chamfer', 'flag', 'wedge', 'stepped',
];

function shapePolygon(kind, W, D) {
  switch (kind) {
    case 'L':
      return [[0, 0], [W, 0], [W, D * 0.55], [W * 0.55, D * 0.55], [W * 0.55, D], [0, D]];
    case 'trapezoid':
      return [[0, 0], [W, 0], [W * 0.80, D], [W * 0.14, D]];
    case 'chamfer':
      return [[0, 0], [W, 0], [W, D - W * 0.28], [W - W * 0.28, D], [0, D]];
    case 'flag':
      // a narrow drive off the street opening into a wide garden behind
      return [[W * 0.34, 0], [W * 0.66, 0], [W * 0.66, D * 0.34],
              [W, D * 0.34], [W, D], [0, D], [0, D * 0.34], [W * 0.34, D * 0.34]];
    case 'wedge':
      // one boundary running away at an angle, so nothing sits square to it
      return [[0, 0], [W, 0], [W * 0.62, D], [0, D]];
    case 'stepped':
      // a neighbour's garden bitten out of one corner
      return [[0, 0], [W, 0], [W, D * 0.62], [W * 0.72, D * 0.62],
              [W * 0.72, D], [0, D]];
    default:
      return [[0, 0], [W, 0], [W, D], [0, D]];
  }
}

function rot90(poly, k) {
  let out = poly.map(([x, z]) => [x, z]);
  for (let i = 0; i < k; i++) out = out.map(([x, z]) => [-z, x]);
  return out;
}

function rotDir(dir, k) {
  return DIRS[(DIRS.indexOf(dir) + k) % 4];
}

function outwardVector(dir) {
  switch (dir) {
    case 'north': return [0, -1];
    case 'south': return [0, 1];
    case 'east': return [1, 0];
    default: return [-1, 0];
  }
}

/**
 * generatePlot(rng, { difficulty, targetFootprint, minPlotArea, typeKey })
 * `targetFootprint` is the gross footprint the building needs on one storey;
 * the plot is sized so the buildable area comfortably exceeds it, tightening
 * as difficulty rises.
 *
 * The returned plot is GUARANTEED solvable: after the setbacks, the protected
 * trees, the slope and the neighbours are all on the site, the remaining
 * obstruction-free area is re-measured (assessSolvability) and the site is
 * regenerated, larger and gentler, until the building fits with its entrance
 * able to face the street. The report is attached as plot.solvable.
 */
export function generatePlot(rng, opts = {}) {
  const difficulty = Math.min(1, Math.max(0, opts.difficulty ?? 0.5));
  const targetFootprint = Math.max(40, opts.targetFootprint ?? 120);
  // The plot must also be legally feasible: big enough for the coverage limit,
  // the planted-area limit and (for a kindergarten) the outdoor play area.
  const minPlotArea = Math.max(0, opts.minPlotArea ?? 0);

  let plot = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    plot = buildPlot(rng, { difficulty, targetFootprint, minPlotArea, attempt });
    if (plot.solvable.ok) return plot;
  }
  // Last resort: a site the brief cannot be built on is a bug, so strip its
  // teeth rather than ship it. Never reached in the seeded sweep, kept so the
  // guarantee holds for every possible seed.
  plot = disarmPlot(plot, targetFootprint);
  if (!plot.solvable.ok) {
    const s = plot.solvable;
    throw new Error(`generatePlot: unsolvable site [${s.reasons.join('+')}] `
      + `need ${s.need} m2, free ${s.freeArea} m2, min side ${s.minSide} m, `
      + `frontage ${s.frontage} m, fall ${s.fall} m`);
  }
  return plot;
}

/** Drop every obstruction that can be dropped, then re-measure. */
function disarmPlot(plot, targetFootprint) {
  for (const t of plot.trees) t.protected = false;
  if (plot.terrain.kind === 'slope') {
    plot.terrain = {
      kind: 'flat', slopeDir: 0, slopeDirName: null, slopePercent: 0,
      origin: plot.terrain.origin, heightAt: () => 0,
    };
    plot.fallAcrossSite = 0;
  }
  plot.solvable = assessSolvability(plot, targetFootprint);
  return plot;
}

/** One attempt at a site. `attempt` > 0 means the previous one was unbuildable. */
function buildPlot(rng, { difficulty, targetFootprint, minPlotArea, attempt }) {
  // ---- shape ------------------------------------------------------------
  // Even an easy commission deserves a site with a bit of character; a plain
  // rectangle every other time is what made them blur together. Difficulty now
  // shifts HOW awkward the outline is, not whether there is one at all.
  const awkwardBias = 0.55 + 0.35 * difficulty;
  const kind = rng() < awkwardBias
    ? SHAPES[1 + Math.floor(rng() * (SHAPES.length - 1))]
    : 'rect';

  // each retry buys the building more room
  const roomier = 1 + 0.18 * attempt;
  const coverage = lerp(2.40, 1.35, difficulty) * roomier;   // buildable / footprint
  const needBuildable = targetFootprint * coverage;
  const needGross = minPlotArea * roomier;

  let aspect;
  if (kind === 'deep-narrow') aspect = lerp(0.34, 0.26, rng());
  else if (kind === 'wide-shallow') aspect = lerp(2.2, 3.0, rng());
  else aspect = lerp(0.72, 1.45, rng());

  const setbacks = {
    front: R(lerp(4.0, 6.5, difficulty) + rng() * 1.0),
    side: R(rng() < 0.5 ? 3.0 : 4.0),              // 4.0 m where the wall has windows
    rear: R(lerp(6.0, 8.5, difficulty) + rng() * 1.0),
  };

  // Solve the plot size iteratively: grow until the buildable polygon is big
  // enough. Deterministic — no rng inside the loop.
  let W = Math.sqrt(needBuildable * aspect) + setbacks.side * 2 + 4;
  let D = W / aspect;
  let poly = null, k = 0;
  const cornerPlot = kind === 'corner';

  for (let i = 0; i < 14; i++) {
    poly = shapePolygon(cornerPlot ? 'rect' : kind, W, D);
    const streets = cornerPlot ? ['north', 'east'] : ['north'];
    const rears = streets.map(s => OPPOSITE[s]);
    const test = insetPolygon(poly, (a, b) => {
      const f = edgeFacing(a, b);
      if (streets.includes(f)) return setbacks.front;
      if (rears.includes(f)) return setbacks.rear;
      return setbacks.side;
    });
    const got = polygonArea(test) > 1 ? polygonArea(test) : 0;
    const gross = polygonArea(poly);
    if (got >= needBuildable && gross >= needGross) break;
    const grow = Math.min(1.6, Math.max(1.04, Math.sqrt(Math.max(
      needBuildable / Math.max(got, 1),
      needGross / Math.max(gross, 1),
    )) * 1.02));
    W *= grow; D *= grow;
  }

  W = R(W); D = R(D);
  poly = shapePolygon(cornerPlot ? 'rect' : kind, W, D);

  // centre on the origin, then rotate by a whole number of quarter turns
  const b0 = polygonBounds(poly);
  const cx = (b0.minX + b0.maxX) / 2, cz = (b0.minZ + b0.maxZ) / 2;
  poly = poly.map(([x, z]) => [R(x - cx), R(z - cz)]);
  k = Math.floor(rng() * 4) % 4;
  poly = ensureCCW(rot90(poly, k).map(([x, z]) => [R(x), R(z)]));

  const streetSides = (cornerPlot ? ['north', 'east'] : ['north']).map(s => rotDir(s, k));
  const streetSide = streetSides[0];
  const bounds = polygonBounds(poly);

  // ---- street -----------------------------------------------------------
  const streetWidth = R(cornerPlot ? 9.0 : lerp(6.0, 12.0, rng()));
  const [ox, oz] = outwardVector(streetSide);
  const half = { x: bounds.width / 2 + 30, z: bounds.depth / 2 + 30 };
  const edgeX = ox > 0 ? bounds.maxX : ox < 0 ? bounds.minX : 0;
  const edgeZ = oz > 0 ? bounds.maxZ : oz < 0 ? bounds.minZ : 0;
  const off = streetWidth / 2 + 1.5;
  const centreline = (ox === 0)
    ? [[-half.x, R(edgeZ + oz * off)], [half.x, R(edgeZ + oz * off)]]
    : [[R(edgeX + ox * off), -half.z], [R(edgeX + ox * off), half.z]];

  const street = { side: streetSide, centreline, width: streetWidth };
  const entranceFacing = (cornerPlot && rng() < 0.4) ? streetSides[1] : streetSide;

  // ---- neighbours -------------------------------------------------------
  const neighbours = [];
  const free = DIRS.filter(d => !streetSides.includes(d));
  const wantTallSouth = !streetSides.includes('south') && (difficulty >= 0.45 || rng() < 0.35);
  const boxOf = p => polygonBounds(p);
  const clashes = (box) => neighbours.some(n => {
    const o = boxOf(n.polygon);
    return box.minX < o.maxX + 1 && box.maxX + 1 > o.minX
      && box.minZ < o.maxZ + 1 && box.maxZ + 1 > o.minZ;
  });
  for (let fi = 0; fi < free.length; fi++) {
    const dir = free[fi];
    const isSouth = dir === 'south';
    const chance = isSouth ? 0.95 : 0.62;
    const lastChance = fi === free.length - 1 && neighbours.length === 0;   // never an empty street
    if (!lastChance && !(isSouth && wantTallSouth) && rng() > chance) continue;
    const tall = (isSouth && wantTallSouth) || rng() < 0.18 + 0.30 * difficulty;
    const storeys = tall ? 3 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 2);
    const height = R(storeys * 3.1 + 1.2);
    const [nx, nz] = outwardVector(dir);
    const gap = R(lerp(2.5, 7.0, rng()));
    const long = R(lerp(11, 26, rng()));
    const deep = R(lerp(9, 16, rng()));
    // anchor just outside the boundary bbox on that side; retry the slide along
    // the edge so two neighbours never end up inside each other at a corner
    let chosen = null, fallback = null;
    for (let tryI = 0; tryI < 8; tryI++) {
      const ax = nx === 0 ? R(lerp(bounds.minX, bounds.maxX, rng()) - long / 2)
        : (nx > 0 ? R(bounds.maxX + gap) : R(bounds.minX - gap - deep));
      const az = nz === 0 ? R(lerp(bounds.minZ, bounds.maxZ, rng()) - long / 2)
        : (nz > 0 ? R(bounds.maxZ + gap) : R(bounds.minZ - gap - deep));
      const w = nx === 0 ? long : deep;
      const d = nz === 0 ? long : deep;
      const box = { minX: ax, maxX: ax + w, minZ: az, maxZ: az + d };
      fallback = { ax, az, w, d };
      if (!clashes(box)) { chosen = fallback; break; }
      if (nx !== 0 && nz !== 0) break;                 // nothing to slide, give up
    }
    const spot = chosen || (lastChance ? fallback : null);
    if (!spot) continue;
    const { ax, az, w, d } = spot;
    neighbours.push({
      name: tall ? `${storeys}-storey block to the ${dir}` : `house to the ${dir}`,
      height,
      storeys,
      polygon: [[R(ax), R(az)], [R(ax + w), R(az)], [R(ax + w), R(az + d)], [R(ax), R(az + d)]],
    });
  }

  // ---- trees ------------------------------------------------------------
  const inset = insetPolygon(poly, (a, b) => {
    const f = edgeFacing(a, b);
    if (streetSides.includes(f)) return setbacks.front;
    if (streetSides.map(s => OPPOSITE[s]).includes(f)) return setbacks.rear;
    return setbacks.side;
  });
  const buildableTest = polygonArea(inset) > 1 ? inset : poly;
  const treeCount = Math.round(lerp(1, 6, difficulty * 0.7 + rng() * 0.5));
  const protectedTarget = Math.max(0, Math.min(treeCount, Math.round(difficulty * 3)) - attempt);
  const trees = [];
  // probe used to re-measure the site as each protected tree lands on it
  const probe = {
    boundary: poly, buildable: buildableTest, trees,
    entranceFacing, streetSides, terrain: null,
  };
  for (let i = 0; i < treeCount * 14 && trees.length < treeCount; i++) {
    const x = R(lerp(bounds.minX, bounds.maxX, rng()));
    const z = R(lerp(bounds.minZ, bounds.maxZ, rng()));
    if (!pointInPolygon(poly, x, z)) continue;
    if (distanceToPolygon(poly, x, z) < 2.0) continue;
    const radius = R(lerp(2.4, 6.0, rng()), 1);
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < t.radius + radius + 1.5)) continue;
    const wantProtected = trees.filter(t => t.protected).length < protectedTarget;
    const inBuildable = pointInPolygon(buildableTest, x, z);
    // A protected tree must NOT stand on the ground the player is told to build
    // on. This used to be the exact opposite — the rule was "a protected tree
    // only bites if it stands where you would want to build", which put one
    // inside the buildable area on 19 of 24 generated plots. Jurek hit it
    // immediately: "sometimes there are trees in that square". A site you are
    // handed and then quietly forbidden from using is not a constraint, it is a
    // trick, and DESIGN-DECISIONS.md "The plot in the editor" now forbids it.
    //
    // Protected trees still matter: they sit in the garden, they shade the plot,
    // the daylight module still tests against their crowns, and they still stop
    // the building sprawling to the boundary. They just no longer stand in the
    // middle of the footprint.
    if (wantProtected && inBuildable) continue;
    const tree = {
      x, z, radius,
      height: R(lerp(7, 19, rng()), 1),
      species: ['oak', 'lime', 'birch', 'maple', 'pine'][Math.floor(rng() * 5) % 5],
      protected: wantProtected,
    };
    trees.push(tree);
    // ...but a protected tree that leaves nowhere to put the building would make
    // the brief impossible, so that one keeps growing as an ordinary tree
    if (tree.protected && !assessSolvability(probe, targetFootprint).ok) tree.protected = false;
  }

  // ---- terrain ----------------------------------------------------------
  const [ccx, ccz] = polygonCentroid(poly);
  const slopeAngle = R(Math.floor(rng() * 8) * (Math.PI / 4), 4);
  const fx = Math.cos(slopeAngle), fz = Math.sin(slopeAngle);
  const makeTerrain = (percent) => ({
    kind: percent > 0 ? 'slope' : 'flat',
    slopeDir: percent > 0 ? slopeAngle : 0,     // radians in xz, ground FALLS this way
    slopeDirName: percent > 0 ? compassOf(fx, fz) : null,
    slopePercent: percent,
    origin: [R(ccx), R(ccz)],
    heightAt(x, z) {
      if (percent <= 0) return 0;
      return R(-((x - ccx) * fx + (z - ccz) * fz) * (percent / 100), 3);
    },
  });
  let slopePercent = rng() < 0.22 + 0.48 * difficulty
    ? R(lerp(3.5, 12.0, difficulty * 0.6 + rng() * 0.6), 1)
    : 0;
  let terrain = makeTerrain(slopePercent);
  // ease the slope until one floor plate can sit on the flattest band of the
  // buildable area within the cut-and-fill the brief allows
  for (let guard = 0; guard < 14 && slopePercent > 0; guard++) {
    probe.terrain = terrain;
    if (!assessSolvability(probe, targetFootprint).reasons.includes('slope')) break;
    slopePercent = slopePercent > 2.0 ? R(slopePercent * 0.75, 1) : 0;
    terrain = makeTerrain(slopePercent);
  }

  const plot = {
    kind,
    boundary: poly,
    setbacks,
    street,
    streetSides,
    entranceFacing,
    neighbours,
    trees,
    terrain,
    north: 0,
    area: R(polygonArea(poly), 1),
    bounds,
  };
  plot.buildable = buildableArea(plot);
  plot.buildableArea = R(polygonArea(plot.buildable), 1);
  plot.fallAcrossSite = terrain.kind === 'slope'
    ? R(Math.max(bounds.width, bounds.depth) * (terrain.slopePercent / 100), 1)
    : 0;
  plot.solvable = assessSolvability(plot, targetFootprint);
  return plot;
}

function compassOf(x, z) {
  if (Math.abs(x) >= Math.abs(z)) return x > 0 ? 'east' : 'west';
  return z > 0 ? 'south' : 'north';
}

/** Shape of the site in words, used by the brief writer. */
export function describePlot(plot) {
  switch (plot.kind) {
    case 'deep-narrow': return 'deep and narrow';
    case 'wide-shallow': return 'wide and shallow';
    case 'L': return 'L-shaped';
    case 'corner': return 'on a corner';
    case 'trapezoid': return 'slightly wedge-shaped';
    case 'chamfer': return 'with one corner cut off';
    default: return 'a plain rectangle';
  }
}
