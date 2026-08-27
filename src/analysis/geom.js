// Shared 2D/3D geometry helpers for the analysis engine.
// View-free: no three.js, no DOM. Must import in bare node.
//
// Plan coordinates are [x, z] pairs in metres. y is up.
// World orientation convention used by the whole analysis engine:
//   +X = East, -Z = North, +Z = South, +Y = up.
// Rotation `rot` is radians about +Y, matching three.js:
//   x' =  x*cos(r) + z*sin(r)
//   z' = -x*sin(r) + z*cos(r)

export const TAU = Math.PI * 2;

export function rotY(x, z, r) {
  const c = Math.cos(r), s = Math.sin(r);
  return [x * c + z * s, -x * s + z * c];
}

// --------------------------------------------------------------------------
// polygons

export function polygonSignedArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polygonArea(poly) {
  return Math.abs(polygonSignedArea(poly));
}

export function polygonPerimeter(poly) {
  let p = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

export function polygonCentroid(poly) {
  const a = polygonSignedArea(poly);
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of poly) { sx += p[0]; sz += p[1]; }
    return [sx / poly.length, sz / poly.length];
  }
  let cx = 0, cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function polygonBBox(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, minZ, maxX, maxZ };
}

/** Ray-crossing test. Points exactly on the edge count as inside. */
export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if (distPointSeg(x, z, xi, zi, xj, zj) < 1e-9) return true;
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Longest inscribed span of the polygon through its bbox — cheap size proxy. */
export function polygonAspect(poly) {
  const b = polygonBBox(poly);
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const long = Math.max(w, d), short = Math.min(w, d);
  return { long, short, ratio: short > 1e-6 ? long / short : Infinity };
}

// --------------------------------------------------------------------------
// distances

export function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 < 1e-12 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function segSegDist(a, b, c, d) {
  if (segSegIntersect(a, b, c, d)) return 0;
  return Math.min(
    distPointSeg(a[0], a[1], c[0], c[1], d[0], d[1]),
    distPointSeg(b[0], b[1], c[0], c[1], d[0], d[1]),
    distPointSeg(c[0], c[1], a[0], a[1], b[0], b[1]),
    distPointSeg(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

export function segSegIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

/** Minimum distance between two simple polygons. 0 if they touch or overlap. */
export function polygonDistance(pa, pb) {
  if (polygonsOverlap(pa, pb)) return 0;
  let best = Infinity;
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i], b = pa[(i + 1) % pa.length];
    for (let j = 0; j < pb.length; j++) {
      const c = pb[j], d = pb[(j + 1) % pb.length];
      const s = segSegDist(a, b, c, d);
      if (s < best) best = s;
    }
  }
  return best;
}

/** True if the polygons share any area, or one contains the other. */
export function polygonsOverlap(pa, pb) {
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i], b = pa[(i + 1) % pa.length];
    for (let j = 0; j < pb.length; j++) {
      const c = pb[j], d = pb[(j + 1) % pb.length];
      if (segSegIntersect(a, b, c, d)) return true;
    }
  }
  if (pointInPolygon(pa[0][0], pa[0][1], pb)) return true;
  if (pointInPolygon(pb[0][0], pb[0][1], pa)) return true;
  return false;
}

// --------------------------------------------------------------------------
// oriented boxes (furniture footprints)

/**
 * Footprint of an object of plan size w x d, centred at (cx, cz), rotated by
 * `rot` radians about +Y. Returned CCW in the local frame.
 */
export function obbPolygon(cx, cz, w, d, rot) {
  const hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => {
    const [rx, rz] = rotY(x, z, rot);
    return [cx + rx, cz + rz];
  });
}

/** Unit vector pointing out of the object's front face (+Z local). */
export function frontVector(rot) {
  return rotY(0, 1, rot);
}

export function offsetRect(cx, cz, w, d, rot, dz) {
  // A rect of size w x d whose centre sits `dz` in front of (cx, cz).
  const [fx, fz] = frontVector(rot);
  return obbPolygon(cx + fx * dz, cz + fz * dz, w, d, rot);
}

// --------------------------------------------------------------------------
// exact euclidean distance transform (Felzenszwalb & Huttenlocher 2012)
// Input: Float64Array of 0 (seed) or Infinity (free). Output: squared distance.

function edt1d(f, n, out, v, zz) {
  let k = 0;
  v[0] = 0;
  zz[0] = -Infinity;
  zz[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= zz[k] && k > 0) { k--; continue; }
      break;
    }
    k++;
    v[k] = q;
    zz[k] = s;
    zz[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++;
    const p = v[k];
    out[q] = (q - p) * (q - p) + f[p];
  }
}

/**
 * Squared euclidean distance (in cells) from every cell to the nearest cell
 * where `seed` is true.
 */
export function distanceTransform(seed, w, h) {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const out = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const zz = new Float64Array(Math.max(w, h) + 1);
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = seed[i] ? 0 : INF;

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    edt1d(f, h, out, v, zz);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    edt1d(f, w, out, v, zz);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

// --------------------------------------------------------------------------
// rounding helpers — every reported number goes through one of these so the
// same model always produces byte-identical text.

export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const r0 = (v) => Math.round(v);
