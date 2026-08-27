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
// generation

const SHAPES = ['rect', 'rect', 'deep-narrow', 'wide-shallow', 'corner', 'L', 'trapezoid', 'chamfer'];

function shapePolygon(kind, W, D) {
  switch (kind) {
    case 'L':
      return [[0, 0], [W, 0], [W, D * 0.55], [W * 0.55, D * 0.55], [W * 0.55, D], [0, D]];
    case 'trapezoid':
      return [[0, 0], [W, 0], [W * 0.80, D], [W * 0.14, D]];
    case 'chamfer':
      return [[0, 0], [W, 0], [W, D - W * 0.28], [W - W * 0.28, D], [0, D]];
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
 * generatePlot(rng, { difficulty, targetFootprint, typeKey })
 * `targetFootprint` is the gross footprint the building needs on one storey;
 * the plot is sized so the buildable area comfortably exceeds it, tightening
 * as difficulty rises.
 */
export function generatePlot(rng, opts = {}) {
  const difficulty = Math.min(1, Math.max(0, opts.difficulty ?? 0.5));
  const targetFootprint = Math.max(40, opts.targetFootprint ?? 120);
  // The plot must also be legally feasible: big enough for the coverage limit,
  // the planted-area limit and (for a kindergarten) the outdoor play area.
  const minPlotArea = Math.max(0, opts.minPlotArea ?? 0);

  // ---- shape ------------------------------------------------------------
  const awkwardBias = 0.25 + 0.55 * difficulty;
  const kind = rng() < awkwardBias
    ? SHAPES[2 + Math.floor(rng() * (SHAPES.length - 2))]
    : 'rect';

  const coverage = lerp(2.40, 1.35, difficulty);   // buildable / footprint target
  const needBuildable = targetFootprint * coverage;

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
  const streetSide0 = 'north';

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
    if (got >= needBuildable && gross >= minPlotArea) break;
    const grow = Math.min(1.6, Math.max(1.04, Math.sqrt(Math.max(
      needBuildable / Math.max(got, 1),
      minPlotArea / Math.max(gross, 1),
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
    // anchor just outside the boundary bbox on that side
    const ax = nx === 0 ? R(lerp(bounds.minX, bounds.maxX, rng()) - long / 2)
      : (nx > 0 ? bounds.maxX + gap : bounds.minX - gap - deep);
    const az = nz === 0 ? R(lerp(bounds.minZ, bounds.maxZ, rng()) - long / 2)
      : (nz > 0 ? bounds.maxZ + gap : bounds.minZ - gap - deep);
    const w = nx === 0 ? long : deep;
    const d = nz === 0 ? long : deep;
    neighbours.push({
      name: tall ? `${storeys}-storey block to the ${dir}` : `house to the ${dir}`,
      height,
      storeys,
      polygon: [[R(ax), R(az)], [R(ax + w), R(az)], [R(ax + w), R(az + d)], [R(ax), R(az + d)]],
    });
  }

  // ---- trees ------------------------------------------------------------
  const buildableTest = insetPolygon(poly, (a, b) => {
    const f = edgeFacing(a, b);
    if (streetSides.includes(f)) return setbacks.front;
    if (streetSides.map(s => OPPOSITE[s]).includes(f)) return setbacks.rear;
    return setbacks.side;
  });
  const treeCount = Math.round(lerp(1, 6, difficulty * 0.7 + rng() * 0.5));
  const protectedTarget = Math.min(treeCount, Math.round(difficulty * 3));
  const trees = [];
  for (let i = 0; i < treeCount * 14 && trees.length < treeCount; i++) {
    const x = R(lerp(bounds.minX, bounds.maxX, rng()));
    const z = R(lerp(bounds.minZ, bounds.maxZ, rng()));
    if (!pointInPolygon(poly, x, z)) continue;
    if (distanceToPolygon(poly, x, z) < 2.0) continue;
    const radius = R(lerp(2.4, 6.0, rng()), 1);
    if (trees.some(t => Math.hypot(t.x - x, t.z - z) < t.radius + radius + 1.5)) continue;
    const wantProtected = trees.filter(t => t.protected).length < protectedTarget;
    const inBuildable = pointInPolygon(buildableTest, x, z);
    // a protected tree only bites if it stands where you would want to build
    if (wantProtected && !inBuildable && i < treeCount * 10) continue;
    trees.push({
      x, z, radius,
      height: R(lerp(7, 19, rng()), 1),
      species: ['oak', 'lime', 'birch', 'maple', 'pine'][Math.floor(rng() * 5) % 5],
      protected: wantProtected,
    });
  }

  // ---- terrain ----------------------------------------------------------
  const sloped = rng() < 0.22 + 0.48 * difficulty;
  const slopePercent = sloped ? R(lerp(3.5, 12.0, difficulty * 0.6 + rng() * 0.6), 1) : 0;
  const slopeAngle = sloped ? R(Math.floor(rng() * 8) * (Math.PI / 4), 4) : 0;
  const [ccx, ccz] = polygonCentroid(poly);
  const fx = Math.cos(slopeAngle), fz = Math.sin(slopeAngle);
  const terrain = {
    kind: sloped ? 'slope' : 'flat',
    slopeDir: slopeAngle,                       // radians in the xz plane, ground FALLS this way
    slopeDirName: sloped ? compassOf(fx, fz) : null,
    slopePercent,
    origin: [R(ccx), R(ccz)],
    heightAt(x, z) {
      if (!sloped) return 0;
      return R(-((x - ccx) * fx + (z - ccz) * fz) * (slopePercent / 100), 3);
    },
  };

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
    ? R(Math.max(bounds.width, bounds.depth) * (slopePercent / 100), 1)
    : 0;
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
