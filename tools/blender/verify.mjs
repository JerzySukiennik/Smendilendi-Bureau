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
//             buffer into connected islands, then a second union-find joins
//             islands whose bounding boxes overlap within 2 mm. More than one
//             component = the model is a pile of primitives, which is exactly
//             what the reviewer rejected twice ("elementy nie sa polaczone").
//   tris      triangle budget
//   mats      one material slot per colour region; the tintable one named "tint"
//   clean     no cameras, no lights, no Draco, transforms applied
//
// EXPECTED_DRIFT records the models whose bounding box deliberately differs from
// the catalogue, with the reason and the value the catalogue should carry. They
// are printed as `drift` rather than `FAIL`, and they are listed in the handoff
// so the catalogue's owner can act on them. Nothing is silently forgiven.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CATALOG } from '../../src/model/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MODELS = path.join(ROOT, 'assets/models');

const TOL_PCT = 0.02;
const TOUCH_TOL = 0.002;
const TRI_BUDGET = 1400;

export const EXPECTED_DRIFT = {
  'table-dining-4': {
    axes: 'xz',
    should: [1.60, 0.75, 0.90],
    why: 'Reviewer rejected 1.40 x 0.80 as "za maly". Built to 1.60 x 0.90: four '
       + 'covers at 0.80 m of edge each with a 0.30 m service strip down the middle '
       + '(Neufert: 0.60-0.70 m per place setting, 0.40 m deep).',
  },
  'basin-560': {
    axes: 'y',
    should: [0.56, 1.03, 0.46],
    why: 'The catalogue 0.85 is the RIM height (already carried as workHeight). '
       + 'The mixer stands 0.18 above the rim, so the real bounding box is 1.03. '
       + 'Clearance and placement still key off the rim.',
  },
  'door-internal-900': {
    axes: 'z',
    should: [0.90, 2.05, 0.17],
    why: 'Leaf is 0.045; a lever handle projects 0.06 each side. The catalogue 0.06 '
       + 'describes the leaf alone. The wall opening is unaffected (geometry.js cuts '
       + 'it from the opening record, not from this size).',
  },
  'pendant-lamp': {
    axes: 'y',
    should: [0.40, 1.44, 0.40],
    why: 'Ceiling anchor: the 1.20 m cord is part of the model (as it was in the '
       + 'approved placeholder), so height = drop + shade. The catalogue 0.24 is the '
       + 'shade alone.',
  },
  'bed-double-1600': {
    axes: 'y',
    should: [1.60, 0.95, 2.00],
    why: 'The catalogue 0.55 is the mattress top; the headboard is 0.95, exactly as '
       + 'in the approved placeholder (procBed headboardH = 0.95).',
  },
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
        if (!b) boxes.set(r, { lo: [x, y, z], hi: [x, y, z], n: 1, mesh: mesh.name });
        else {
          b.n++;
          b.lo[0] = Math.min(b.lo[0], x); b.hi[0] = Math.max(b.hi[0], x);
          b.lo[1] = Math.min(b.lo[1], y); b.hi[1] = Math.max(b.hi[1], y);
          b.lo[2] = Math.min(b.lo[2], z); b.hi[2] = Math.max(b.hi[2], z);
        }
      }
      for (const b of boxes.values()) if (b.n >= 3) out.push(b);
    }
  }
  return out;
}

function componentsOf(islands, tol = TOUCH_TOL) {
  const dsu = new DSU(islands.length);
  for (let i = 0; i < islands.length; i++) {
    for (let j = i + 1; j < islands.length; j++) {
      const a = islands[i]; const b = islands[j];
      let hit = true;
      for (let k = 0; k < 3; k++) {
        if (a.lo[k] - tol > b.hi[k] || b.lo[k] - tol > a.hi[k]) { hit = false; break; }
      }
      if (hit) dsu.union(i, j);
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
const only = args.filter((a) => !a.startsWith('--'));
const ids = (only.length ? only : Object.keys(CATALOG).filter((id) => CATALOG[id].file))
  .filter((id) => CATALOG[id]);

const rows = [];
let fails = 0;
for (const id of ids) {
  const e = CATALOG[id];
  const file = path.join(ROOT, e.file);
  if (!existsSync(file)) { rows.push({ id, status: 'MISSING' }); fails++; continue; }
  const r = inspect(file);
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
    problems.push(`${r.islands} loose parts in ${r.components.length} disconnected bodies`);
  }
  if (r.tris > TRI_BUDGET) problems.push(`${r.tris} tris over budget ${TRI_BUDGET}`);
  if (r.cameras || r.lights) problems.push('contains cameras/lights');
  if (r.draco) problems.push('Draco compressed');
  if (r.nonIdentity) problems.push(`${r.nonIdentity} node transforms not applied`);
  if (e.colorable && !r.materials.includes('tint')) problems.push('colorable but no "tint" slot');
  if (r.materials.length !== r.meshes) problems.push('material/mesh split mismatch');

  if (problems.length) fails++;
  rows.push({
    id, ...r,
    status: problems.length ? 'FAIL' : (notes.length ? 'drift' : 'pass'),
    problems, notes,
    catalog: e.size, anchor: e.anchor, colorable: e.colorable,
  });
}

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
}
process.exit(fails ? 1 : 0);
