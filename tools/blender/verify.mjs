// verify.mjs -- audit every exported GLB against the catalogue and the contract.
//
//   node tools/blender/verify.mjs [--json] [id ...]
//
// This parses the GLB by hand rather than through three.js on purpose: the point
// is to check what is IN THE FILE, not what a loader is willing to make of it.
//
// Six checks per model:
//   bbox      measured against src/model/catalog.js, tolerance 2 % (ARCHITECTURE.md)
//   origin    footprint-centred on the floor plane (anchor rules from lib/units.py)
//   parts     THE ONE THAT MATTERS. Loose shells are found by walking the index
//             buffer into connected islands, then islands are joined only when
//             their TRIANGLES ACTUALLY INTERSECT (Moller's triangle-triangle
//             test, coplanar case included, 0.2 mm tolerance). More than one
//             component = the model is a pile of primitives, which is exactly
//             what the reviewer rejected twice ("elementy nie sa polaczone").
//
//             This used to union islands whose axis-aligned BOXES overlapped
//             within 2 mm, which is not a solidity test at all: a tap floating
//             6 mm above a basin, a waste buried under a bowl floor and a pane
//             sealed inside a sash all have overlapping boxes and no shared
//             surface. A critic reproduced exactly that and found five models
//             that passed here but were in pieces when tested face against
//             face. Nothing is reported as touching now unless triangles meet.
//   tris      triangle budget
//   mats      one material slot per colour region; the tintable one named "tint"
//   clean     no cameras, no lights, no Draco, transforms applied
//
// EXPECTED_DRIFT records the models whose bounding box deliberately differs from
// the catalogue, with the reason and the value the catalogue should carry. They
// are printed as `drift` rather than `FAIL`, and they are listed in the handoff
// so the catalogue's owner can act on them. Nothing is silently forgiven.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CATALOG } from '../../src/model/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MODELS = path.join(ROOT, 'assets/models');

const TOL_PCT = 0.02;
const TOUCH_TOL = 0.002;      // AABB prefilter only, never a proof of contact
const SOLID_EPS = 0.0002;     // 0.2 mm: how close two FACES must come to touch
const TRI_BUDGET = 1400;

// The fifteen items where a real fitting stands outside its catalogue box, with
// the value src/model/catalog.js should carry. Everything else -- all 107 of the
// rest -- is built to the size its own catalogue row declares and measures
// inside 2 % of it.
//
// The five drifts this table used to carry were different in kind: a dining
// table resized in the mesh but not the catalogue, a bed 73 % over its declared
// height, a pendant carrying its own 1.20 m drop, doors and basins measured over
// their ironmongery. Four of those were fixed in the GEOMETRY, because a drift
// the catalogue owner never actions is a model the game costs and clearance-
// checks wrongly. What is left cannot be fixed in geometry: a basin's catalogue
// height IS its rim height (the entry carries the same number as `workHeight`,
// which the ergonomics module reads) and a mixer stands above the rim; a door's
// catalogue thickness is the leaf, and a lever projects either side of it.
//
// Keep in step with ENVELOPE in families.py; a mismatch fails this audit.
const TAP = 'The catalogue height is the RIM height -- the same number the entry '
  + 'carries as workHeight, which the ergonomics module reads. The deck mixer the '
  + 'catalogue note promises stands above it, so the real bounding box is taller. '
  + 'Clearance, cost and placement still key off the rim.';
const LEVER = 'The catalogue thickness is the LEAF. A lever handle projects about '
  + '0.05 m each side of it. The wall opening is unaffected: geometry.js cuts that '
  + 'from the opening record, not from this size.';

export const EXPECTED_DRIFT = {
  'basin-560': { axes: 'y', should: [0.56, 1.03, 0.46], why: TAP },
  'basin-cloak-400': { axes: 'y', should: [0.40, 1.03, 0.30], why: TAP },
  'basin-clinical': { axes: 'y', should: [0.60, 1.08, 0.50], why: TAP },
  'basin-vanity-800': { axes: 'y', should: [0.80, 1.07, 0.48], why: TAP },
  'kitchen-base-sink-800': { axes: 'y', should: [0.80, 1.12, 0.60], why: TAP },
  'kids-basin-row': { axes: 'y', should: [1.20, 0.77, 0.40], why: TAP },
  'bath-1700': { axes: 'y', should: [1.70, 0.74, 0.75], why: TAP },
  'door-internal-800': { axes: 'z', should: [0.80, 2.05, 0.15], why: LEVER },
  'door-internal-900': { axes: 'z', should: [0.90, 2.05, 0.15], why: LEVER },
  'door-internal-1000': { axes: 'z', should: [1.00, 2.05, 0.15], why: LEVER },
  'door-glazed-900': { axes: 'z', should: [0.90, 2.05, 0.15], why: LEVER },
  'door-double-1600': { axes: 'z', should: [1.60, 2.10, 0.15], why: LEVER },
  'door-fire-ei30-900': { axes: 'z', should: [0.90, 2.05, 0.17], why: LEVER },
  'door-entrance-1000': { axes: 'z', should: [1.00, 2.10, 0.18], why: LEVER },
};

// ---------------------------------------------------------------------------
// GLB

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array,
  5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;
    off += (4 - (len % 4)) % 4;
  }
  return { json, bin };
}

function readAccessor(g, i) {
  const a = g.json.accessors[i];
  const n = NUM[a.type];
  const T = COMP[a.componentType];
  const out = new (a.componentType === 5126 ? Float32Array : Float64Array)(a.count * n);
  const bv = g.json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * n;
  for (let e = 0; e < a.count; e++) {
    const view = new T(g.bin.buffer, g.bin.byteOffset + base + e * stride, n);
    for (let k = 0; k < n; k++) out[e * n + k] = view[k];
  }
  return { data: out, n, count: a.count, min: a.min, max: a.max };
}

class DSU {
  constructor(n) { this.p = new Int32Array(n).map((_, i) => i); }
  find(a) { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; }
  union(a, b) { const x = this.find(a); const y = this.find(b); if (x !== y) this.p[x] = y; }
}

// ---------------------------------------------------------------------------
// Triangle-triangle intersection (Moller 1997), with the coplanar case.
// Two surfaces that meet within SOLID_EPS count as touching; two surfaces that
// merely have overlapping bounding boxes do not.

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function coplanarTriTri(n, t0, t1, t2, u0, u1, u2) {
  // drop the largest component of the normal and do it in 2D
  const A = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  let i0 = 0; let i1 = 1;
  if (A[0] > A[1]) { if (A[0] > A[2]) { i0 = 1; i1 = 2; } else { i0 = 0; i1 = 1; } }
  else if (A[2] > A[1]) { i0 = 0; i1 = 1; } else { i0 = 0; i1 = 2; }
  const T = [t0, t1, t2].map((p) => [p[i0], p[i1]]);
  const U = [u0, u1, u2].map((p) => [p[i0], p[i1]]);
  const seg = (p, q, r, s) => {
    const d1 = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d2 = (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
    const d3 = (s[0] - r[0]) * (p[1] - r[1]) - (s[1] - r[1]) * (p[0] - r[0]);
    const d4 = (s[0] - r[0]) * (q[1] - r[1]) - (s[1] - r[1]) * (q[0] - r[0]);
    return d1 * d2 <= 0 && d3 * d4 <= 0;
  };
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      if (seg(T[a], T[(a + 1) % 3], U[b], U[(b + 1) % 3])) return true;
    }
  }
  const inside = (p, V) => {
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const a = V[k]; const b = V[(k + 1) % 3];
      const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (c > 0) s++; else if (c < 0) s--;
    }
    return Math.abs(s) === 3;
  };
  return inside(T[0], U) || inside(U[0], T);
}

function triTri(v0, v1, v2, u0, u1, u2, eps = SOLID_EPS) {
  const n2 = cross3(sub3(u1, u0), sub3(u2, u0));
  const d2 = -dot3(n2, u0);
  const nl2 = Math.hypot(n2[0], n2[1], n2[2]) || 1;
  let dv = [dot3(n2, v0) + d2, dot3(n2, v1) + d2, dot3(n2, v2) + d2]
    .map((v) => (Math.abs(v) / nl2 < eps ? 0 : v));
  if (dv[0] * dv[1] > 0 && dv[0] * dv[2] > 0) return false;

  const n1 = cross3(sub3(v1, v0), sub3(v2, v0));
  const d1 = -dot3(n1, v0);
  const nl1 = Math.hypot(n1[0], n1[1], n1[2]) || 1;
  let du = [dot3(n1, u0) + d1, dot3(n1, u1) + d1, dot3(n1, u2) + d1]
    .map((v) => (Math.abs(v) / nl1 < eps ? 0 : v));
  if (du[0] * du[1] > 0 && du[0] * du[2] > 0) return false;

  if (dv[0] === 0 && dv[1] === 0 && dv[2] === 0) {
    return coplanarTriTri(n1, v0, v1, v2, u0, u1, u2);
  }
  const D = cross3(n1, n2);
  let ax = 0;
  if (Math.abs(D[1]) > Math.abs(D[ax])) ax = 1;
  if (Math.abs(D[2]) > Math.abs(D[ax])) ax = 2;

  const interval = (p0, p1, p2, dd) => {
    // reorder so the odd-one-out vertex is in the middle
    let a = p0; let b = p1; let c = p2; let da = dd[0]; let db = dd[1]; let dc = dd[2];
    if (da * db > 0) { [a, c] = [c, a]; [da, dc] = [dc, da]; }
    else if (da * dc > 0) { [a, b] = [b, a]; [da, db] = [db, da]; }
    else if (db * dc > 0 || da === 0) {
      if (db !== 0) { [a, b] = [b, a]; [da, db] = [db, da]; }
      else if (dc !== 0) { [a, c] = [c, a]; [da, dc] = [dc, da]; }
      else return null;                       // handled by the coplanar branch
    }
    const pa = a[ax]; const pb = b[ax]; const pc = c[ax];
    const t1 = pa + (pb - pa) * (da / (da - db));
    const t2 = pa + (pc - pa) * (da / (da - dc));
    return [Math.min(t1, t2), Math.max(t1, t2)];
  };
  const iv = interval(v0, v1, v2, dv);
  const iu = interval(u0, u1, u2, du);
  if (!iv || !iu) return false;
  return iv[0] <= iu[1] + eps && iu[0] <= iv[1] + eps;
}

/** Every loose shell in the file, with its own bounding box. */
function islandsOf(g) {
  const out = [];
  for (const mesh of g.json.meshes || []) {
    for (const prim of mesh.primitives) {
      const pos = readAccessor(g, prim.attributes.POSITION);
      const idx = readAccessor(g, prim.indices);
      const dsu = new DSU(pos.count);
      // The exporter splits vertices per face for flat shading, so raw index
      // connectivity would call every FACE a loose part. Weld by position first
      // (0.01 mm) and the islands become the real shells again.
      const weld = new Map();
      for (let v = 0; v < pos.count; v++) {
        const k = `${Math.round(pos.data[v * 3] * 1e5)},`
          + `${Math.round(pos.data[v * 3 + 1] * 1e5)},`
          + `${Math.round(pos.data[v * 3 + 2] * 1e5)}`;
        if (weld.has(k)) dsu.union(v, weld.get(k)); else weld.set(k, v);
      }
      for (let t = 0; t < idx.count; t += 3) {
        dsu.union(idx.data[t], idx.data[t + 1]);
        dsu.union(idx.data[t + 1], idx.data[t + 2]);
      }
      const boxes = new Map();
      for (let v = 0; v < pos.count; v++) {
        const r = dsu.find(v);
        const x = pos.data[v * 3];
        const y = pos.data[v * 3 + 1];
        const z = pos.data[v * 3 + 2];
        const b = boxes.get(r);
        if (!b) boxes.set(r, { lo: [x, y, z], hi: [x, y, z], n: 1, mesh: mesh.name, tris: [] });
        else {
          b.n++;
          b.lo[0] = Math.min(b.lo[0], x); b.hi[0] = Math.max(b.hi[0], x);
          b.lo[1] = Math.min(b.lo[1], y); b.hi[1] = Math.max(b.hi[1], y);
          b.lo[2] = Math.min(b.lo[2], z); b.hi[2] = Math.max(b.hi[2], z);
        }
      }
      const at = (v) => [pos.data[v * 3], pos.data[v * 3 + 1], pos.data[v * 3 + 2]];
      for (let t = 0; t < idx.count; t += 3) {
        const b = boxes.get(dsu.find(idx.data[t]));
        if (b) b.tris.push([at(idx.data[t]), at(idx.data[t + 1]), at(idx.data[t + 2])]);
      }
      for (const b of boxes.values()) if (b.n >= 3) out.push(b);
    }
  }
  return out;
}

const boxHit = (a, b, tol) => {
  for (let k = 0; k < 3; k++) {
    if (a.lo[k] - tol > b.hi[k] || b.lo[k] - tol > a.hi[k]) return false;
  }
  return true;
};

const triBox = (t) => ({
  lo: [Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1]),
    Math.min(t[0][2], t[1][2], t[2][2])],
  hi: [Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1]),
    Math.max(t[0][2], t[1][2], t[2][2])],
});

/** Do two islands share surface? Boxes are only the prefilter. */
function islandsTouch(a, b) {
  if (!boxHit(a, b, SOLID_EPS * 2)) return false;
  const ba = a.tris.map(triBox);
  const bb = b.tris.map(triBox);
  for (let i = 0; i < a.tris.length; i++) {
    if (!boxHit(ba[i], b, SOLID_EPS * 2)) continue;
    for (let j = 0; j < b.tris.length; j++) {
      if (!boxHit(ba[i], bb[j], SOLID_EPS * 2)) continue;
      const t = a.tris[i]; const u = b.tris[j];
      if (triTri(t[0], t[1], t[2], u[0], u[1], u[2])) return true;
    }
  }
  return false;
}

function componentsOf(islands, tol = TOUCH_TOL) {
  const dsu = new DSU(islands.length);
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      if (dsu.find(i) === dsu.find(j)) continue;
      if (!boxHit(islands[i], islands[j], tol)) continue;
      if (islandsTouch(islands[i], islands[j])) dsu.union(i, j);
    }
  }
  const groups = new Map();
  islands.forEach((_, i) => {
    const r = dsu.find(i);
    groups.set(r, (groups.get(r) || []).concat([i]));
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function inspect(file) {
  const g = parseGlb(readFileSync(file));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const mesh of g.json.meshes || []) {
    for (const prim of mesh.primitives) {
      const a = g.json.accessors[prim.attributes.POSITION];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], a.min[k]);
        hi[k] = Math.max(hi[k], a.max[k]);
      }
      tris += g.json.accessors[prim.indices].count / 3;
    }
  }
  const islands = islandsOf(g);
  const comps = componentsOf(islands);
  const nonIdentity = (g.json.nodes || []).filter(
    (n) => (n.matrix && n.matrix.some((v, i) => Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) > 1e-6))
      || (n.translation && n.translation.some((v) => Math.abs(v) > 1e-6))
      || (n.rotation && n.rotation.some((v, i) => Math.abs(v - [0, 0, 0, 1][i]) > 1e-6))
      || (n.scale && n.scale.some((v) => Math.abs(v - 1) > 1e-6)),
  ).length;
  return {
    bbox: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    lo, hi, tris,
    materials: (g.json.materials || []).map((m) => m.name),
    meshes: (g.json.meshes || []).length,
    islands: islands.length,
    components: comps,
    islandBoxes: islands.map((b) => ({ lo: b.lo, hi: b.hi, mesh: b.mesh })),
    cameras: (g.json.cameras || []).length,
    lights: ((g.json.extensions || {}).KHR_lights_punctual || { lights: [] }).lights.length,
    draco: JSON.stringify(g.json.extensionsUsed || []).includes('draco'),
    nonIdentity,
    kb: readFileSync(file).length / 1024,
  };
}

// ---------------------------------------------------------------------------

function originCheck(e, r) {
  const eps = 0.004;
  const bad = [];
  const cx = (r.lo[0] + r.hi[0]) / 2;
  const cz = (r.lo[2] + r.hi[2]) / 2;
  if (Math.abs(cx) > eps) bad.push(`x centre ${cx.toFixed(3)}`);
  if (e.anchor === 'ceiling') {
    if (Math.abs(r.hi[1]) > eps) bad.push(`top ${r.hi[1].toFixed(3)} (should be 0)`);
    if (Math.abs(cz) > eps) bad.push(`z centre ${cz.toFixed(3)}`);
  } else {
    if (Math.abs(r.lo[1]) > eps) bad.push(`base ${r.lo[1].toFixed(3)} (should be 0)`);
    if (e.anchor === 'wall') {
      if (Math.abs(r.lo[2]) > eps) bad.push(`wall face ${r.lo[2].toFixed(3)} (should be 0)`);
    } else if (Math.abs(cz) > eps) bad.push(`z centre ${cz.toFixed(3)}`);
  }
  return bad;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const writeManifest = args.includes('--manifest');
const only = args.filter((a) => !a.startsWith('--'));
// Audit every catalogue entry that HAS a built GLB, whether or not the
// catalogue has been given its `file:` line yet: src/model/catalog.js belongs to
// another agent, and a model that exists but is not wired up is a handoff item,
// not a reason to leave 107 of 122 entries unaudited (which is how the raw
// unbevelled fallback shapes went a whole round without anyone measuring them).
const relOf = (id) => (CATALOG[id] && CATALOG[id].file) || `assets/models/${id}.glb`;
const ids = (only.length ? only : Object.keys(CATALOG))
  .filter((id) => CATALOG[id] && existsSync(path.join(ROOT, relOf(id))));
const unbuilt = Object.keys(CATALOG)
  .filter((id) => !existsSync(path.join(ROOT, relOf(id))));
const unwired = ids.filter((id) => !CATALOG[id].file);

const rows = [];
let fails = 0;
for (const id of ids) {
  const e = CATALOG[id];
  const file = path.join(ROOT, relOf(id));
  if (!existsSync(file)) { rows.push({ id, status: 'MISSING' }); fails++; continue; }
  const r = inspect(file);
  r.sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  const drift = EXPECTED_DRIFT[id];
  const problems = [];
  const notes = [];

  const axes = 'xyz';
  for (let k = 0; k < 3; k++) {
    const dec = drift && drift.axes.includes(axes[k]) ? drift.should[k] : e.size[k];
    const pct = Math.abs(r.bbox[k] - dec) / dec;
    if (pct > TOL_PCT) {
      const msg = `${axes[k]} ${r.bbox[k].toFixed(3)} vs ${dec} (${(pct * 100).toFixed(1)} %)`;
      if (drift && drift.axes.includes(axes[k])) notes.push(msg);
      else problems.push(msg);
    }
  }
  if (drift) notes.push('catalogue should read ' + drift.should.join(' x '));

  problems.push(...originCheck(e, r));
  if (r.components.length > 1) {
    const where = r.components.slice(1).flat().map((i) => {
      const b = r.islandBoxes[i];
      return `${b.mesh} at (${((b.lo[0] + b.hi[0]) / 2).toFixed(3)}, `
        + `${((b.lo[1] + b.hi[1]) / 2).toFixed(3)}, `
        + `${((b.lo[2] + b.hi[2]) / 2).toFixed(3)})`;
    });
    problems.push(`${r.islands} loose parts in ${r.components.length} disconnected `
      + `bodies; floating: ${where.slice(0, 6).join('; ')}`);
  }
  if (r.tris > TRI_BUDGET) problems.push(`${r.tris} tris over budget ${TRI_BUDGET}`);
  if (r.cameras || r.lights) problems.push('contains cameras/lights');
  if (r.draco) problems.push('Draco compressed');
  if (r.nonIdentity) problems.push(`${r.nonIdentity} node transforms not applied`);
  if (e.colorable !== false && !r.materials.includes('tint')) {
    problems.push('colorable but no "tint" slot');
  }
  if (e.colorable === false && r.materials.includes('tint')) {
    problems.push('catalogue says colorable: false but the mesh carries a "tint" slot, '
      + 'which the runtime will multiply the player colour into');
  }
  if (r.materials.length !== r.meshes) problems.push('material/mesh split mismatch');

  if (problems.length) fails++;
  rows.push({
    id, ...r,
    status: problems.length ? 'FAIL' : (notes.length ? 'drift' : 'pass'),
    problems, notes,
    catalog: e.size, anchor: e.anchor, colorable: e.colorable,
  });
}

// ---------------------------------------------------------------------------
// THE MANIFEST. A critic asked for the fifteen approved models by hash and found
// there were none: every GLB entered version control in one rework commit, so no
// pre-approval blob existed to compare against and "these are the models you
// signed off" could not be checked at all. assets/models/MANIFEST.json records a
// sha256 per file with the measurements taken at the same moment, so an approval
// can name a hash. A plain run COMPARES against it and says what has moved since;
// `--manifest` rewrites it, which is what you do when a batch has been reviewed.
const MANIFEST = path.join(MODELS, 'MANIFEST.json');
const manifest = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { models: {} };
const now = {};
for (const r of rows) {
  if (!r.sha256) continue;
  const was = manifest.models[r.id];
  now[r.id] = {
    sha256: r.sha256,
    bbox: r.bbox.map((v) => Number(v.toFixed(4))),
    tris: r.tris,
    parts: r.islands,
    bodies: r.components.length,
    materials: r.materials,
    approved: (was && was.approved) || null,
  };
  r.changed = !!(was && was.sha256 !== r.sha256);
  r.wasApproved = !!(was && was.approved);
}
if (writeManifest) {
  writeFileSync(MANIFEST, JSON.stringify(
    { note: 'sha256 per exported GLB, with the measurements taken at the same '
          + 'moment. `approved` is set by hand when a model has been signed off, '
          + 'and pins that approval to THIS hash. Rewrite with '
          + '`node tools/blender/verify.mjs --manifest`.',
      written: new Date().toISOString().slice(0, 10),
      models: now }, null, 1) + '\n');
}
const moved = rows.filter((r) => r.changed);
const brokenApprovals = rows.filter((r) => r.changed && r.wasApproved);

if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n, d = 2) => String(typeof v === 'number' ? v.toFixed(d) : v).padStart(n);
  console.log(pad('id', 23) + pad('status', 8) + pad('bbox measured (m)', 24)
    + pad('catalogue (m)', 22) + num('tris', 6) + num('parts', 7) + num('bodies', 7)
    + '  materials');
  console.log('-'.repeat(126));
  for (const r of rows) {
    if (r.status === 'MISSING') { console.log(pad(r.id, 23) + 'MISSING'); continue; }
    console.log(
      pad(r.id, 23) + pad(r.status, 8)
      + pad(r.bbox.map((v) => v.toFixed(3)).join(' x '), 24)
      + pad(r.catalog.map((v) => v.toFixed(2)).join(' x '), 22)
      + num(r.tris, 6, 0) + num(r.islands, 7, 0) + num(r.components.length, 7, 0)
      + '  ' + r.materials.join(','),
    );
    for (const p of r.problems) console.log(' '.repeat(8) + 'FAIL  ' + p);
    for (const n of r.notes) console.log(' '.repeat(8) + 'note  ' + n);
  }
  const bad = rows.filter((r) => r.status === 'FAIL' || r.status === 'MISSING').length;
  console.log('-'.repeat(126));
  console.log(`${rows.length} models, ${rows.filter((r) => r.status === 'pass').length} clean, `
    + `${rows.filter((r) => r.status === 'drift').length} with documented catalogue drift, ${bad} failing`);
  console.log(`total ${rows.reduce((a, r) => a + (r.tris || 0), 0)} triangles, `
    + `${rows.reduce((a, r) => a + (r.kb || 0), 0).toFixed(0)} kB`);
  console.log(`catalogue: ${Object.keys(CATALOG).length} entries, ${ids.length} built, `
    + `${unbuilt.length} with no GLB`);
  if (unbuilt.length) console.log('  no GLB: ' + unbuilt.join(' '));
  if (!existsSync(MANIFEST) && !writeManifest) {
    console.log('MANIFEST: assets/models/MANIFEST.json does not exist, so no '
      + 'approval can be pinned to a hash. Write it with `--manifest`.');
  } else if (moved.length) {
    console.log(`MANIFEST: ${moved.length} model(s) differ from the recorded hash`
      + (brokenApprovals.length
        ? `, and ${brokenApprovals.length} of them were APPROVED: `
          + `${brokenApprovals.map((r) => r.id).join(' ')} -- re-present those before `
          + 'the approval is claimed again'
        : ' (none of them was an approved model)'));
  } else {
    console.log('MANIFEST: every model matches its recorded hash'
      + (rows.some((r) => r.wasApproved)
        ? `; ${rows.filter((r) => r.wasApproved).length} carry an approval`
        : '; no approvals recorded yet'));
  }
  if (unwired.length) {
    console.log(`HANDOFF: ${unwired.length} entries have a GLB but no \`file:\` line in `
      + 'src/model/catalog.js, so the game still draws them with the procedural '
      + 'fallback. That file belongs to another agent; the exact lines to add are '
      + 'in tools/blender/_tmp/catalog-handoff.json.');
  }
}
process.exit(fails ? 1 : 0);
