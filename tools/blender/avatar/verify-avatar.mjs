/**
 * verify-avatar.mjs -- the independent audit of an exported avatar GLB.
 *
 *   node tools/blender/avatar/verify-avatar.mjs [assets/avatars/*.glb]
 *
 * It parses the container by hand -- no glTF loader, no Blender -- so a build
 * cannot pass because the tool that wrote it also read it back. It reports:
 *
 *   * stature: the skinned bounding box of a dressed avatar in the rest pose
 *   * triangles: per piece, and for the heaviest and lightest wearable outfit
 *   * clips: name and duration, taken from the sampler inputs
 *   * foot slide: the walk clip is authored in place, so a planted foot must
 *     travel backwards at exactly one constant speed. We skin the shoe, take
 *     the vertices that touch the floor, fit the ideal constant velocity over
 *     the stance and report the RESIDUAL -- that residual is the slide a
 *     player would see once the group is driven forward at that speed.
 *   * hem swing: every vertex is skinned twice, once with the cloth bones
 *     animated and once with their local rotation held at rest. The distance
 *     between the two is how far the fabric moves that the leg does not.
 */
import fs from 'node:fs';
import path from 'node:path';

// --- glTF container ---------------------------------------------------------

function loadGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;
  }
  return { g: json, bin, bytes: buf.length };
}

const COMP = {
  5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
  5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4],
};
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function read(gltf, bin, i) {
  const a = gltf.accessors[i];
  const n = NCOMP[a.type];
  const [Arr, sz] = COMP[a.componentType];
  const out = new Float32Array(a.count * n);
  if (a.bufferView === undefined) return out;
  const bv = gltf.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || n * sz;
  for (let e = 0; e < a.count; e++) {
    const o = base + e * stride;
    for (let c = 0; c < n; c++) {
      const p = o + c * sz;
      let v;
      switch (a.componentType) {
        case 5126: v = bin.readFloatLE(p); break;
        case 5125: v = bin.readUInt32LE(p); break;
        case 5123: v = bin.readUInt16LE(p); break;
        case 5121: v = bin.readUInt8(p); break;
        case 5122: v = bin.readInt16LE(p); break;
        default: v = bin.readInt8(p);
      }
      out[e * n + c] = v;
    }
  }
  return out;
}

// --- little matrix library --------------------------------------------------

const I4 = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function mul(a, b) {              // column-major, a then b applied as b*a? -> returns a*b
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function trs(t, q, s) {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let c = b;
  if (d < 0) { c = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    const o = a.map((v, i) => v + (c[i] - v) * t);
    const l = Math.hypot(...o) || 1;
    return o.map((v) => v / l);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + c[i] * wb);
}

// --- posing -----------------------------------------------------------------

class Avatar {
  constructor(file) {
    const { g, bin, bytes } = loadGLB(file);
    this.file = file; this.g = g; this.bin = bin; this.bytes = bytes;
    this.parent = new Int32Array(g.nodes.length).fill(-1);
    g.nodes.forEach((n, i) => (n.children || []).forEach((c) => (this.parent[c] = i)));
    this.skin = g.skins[0];
    this.ibm = read(g, bin, this.skin.inverseBindMatrices);
    this.jointOf = new Map(this.skin.joints.map((n, i) => [n, i]));
    this.boneName = this.skin.joints.map((n) => g.nodes[n].name);
    this.clips = {};
    for (const a of g.animations || []) {
      const tracks = [];
      let dur = 0;
      for (const ch of a.channels) {
        const s = a.samplers[ch.sampler];
        const t = read(g, bin, s.input);
        const v = read(g, bin, s.output);
        dur = Math.max(dur, t[t.length - 1]);
        tracks.push({ node: ch.target.node, path: ch.target.path, t, v, interp: s.interpolation || 'LINEAR' });
      }
      this.clips[a.name] = { tracks, dur };
    }
  }

  /** local TRS of every node at time `time` of `clip`; `freeze` = bone names held at rest. */
  locals(clip, time, freeze = new Set()) {
    const out = this.g.nodes.map((n) => ({
      t: (n.translation || [0, 0, 0]).slice(),
      r: (n.rotation || [0, 0, 0, 1]).slice(),
      s: (n.scale || [1, 1, 1]).slice(),
    }));
    if (!clip) return out;
    for (const tr of clip.tracks) {
      if (freeze.has(this.g.nodes[tr.node].name)) continue;
      const n = tr.t.length;
      let i = 0;
      while (i < n - 2 && tr.t[i + 1] <= time) i++;
      const t0 = tr.t[i], t1 = tr.t[Math.min(i + 1, n - 1)];
      const u = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0;
      const dim = tr.path === 'rotation' ? 4 : 3;
      const a = Array.from(tr.v.slice(i * dim, i * dim + dim));
      const b = Array.from(tr.v.slice(Math.min(i + 1, n - 1) * dim, Math.min(i + 1, n - 1) * dim + dim));
      const key = tr.path === 'rotation' ? 'r' : tr.path === 'translation' ? 't' : 's';
      out[tr.node][key] = tr.path === 'rotation' ? slerp(a, b, u) : a.map((v, k) => v + (b[k] - v) * u);
    }
    return out;
  }

  /** skinning matrices (one per joint) for a set of locals */
  matrices(loc) {
    const world = new Array(this.g.nodes.length).fill(null);
    const solve = (i) => {
      if (world[i]) return world[i];
      const l = trs(loc[i].t, loc[i].r, loc[i].s);
      world[i] = this.parent[i] < 0 ? l : mul(solve(this.parent[i]), l);
      return world[i];
    };
    return this.skin.joints.map((n, j) => {
      const ib = new Float64Array(this.ibm.slice(j * 16, j * 16 + 16));
      return mul(solve(n), ib);
    });
  }

  pieces() {
    const out = new Map();
    for (const n of this.g.nodes) {
      if (n.mesh === undefined) continue;
      const m = this.g.meshes[n.mesh];
      const prims = m.primitives.map((p) => ({
        pos: read(this.g, this.bin, p.attributes.POSITION),
        joints: read(this.g, this.bin, p.attributes.JOINTS_0),
        weights: read(this.g, this.bin, p.attributes.WEIGHTS_0),
        tris: p.indices !== undefined ? this.g.accessors[p.indices].count / 3
          : this.g.accessors[p.attributes.POSITION].count / 3,
        mat: this.g.materials[p.material].name,
      }));
      out.set(n.name, prims);
    }
    return out;
  }
}

function skinPoint(prim, i, mats) {
  const p = [prim.pos[i * 3], prim.pos[i * 3 + 1], prim.pos[i * 3 + 2]];
  const o = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const w = prim.weights[i * 4 + k];
    if (w <= 0) continue;
    const q = xform(mats[prim.joints[i * 4 + k]], p);
    o[0] += q[0] * w; o[1] += q[1] * w; o[2] += q[2] * w;
  }
  return o;
}

// --- the audit --------------------------------------------------------------

const OUTFIT = ['body', 'face', 'top_hoodie', 'bottom_tracksuit', 'shoes_trainers', 'hair_short'];
const CLOTH_BONES = new Set(['pant_lo_L', 'pant_up_L', 'pant_lo_R', 'pant_up_R',
  'hem_F', 'hem_B', 'skirt_F', 'skirt_B', 'skirt_L', 'skirt_R']);

function audit(file) {
  const av = new Avatar(file);
  const pieces = av.pieces();
  console.log(`\n=== ${path.basename(file)}  ${(av.bytes / 1024).toFixed(0)} kB`);

  // -- triangles
  const tri = new Map();
  for (const [name, prims] of pieces) tri.set(name, prims.reduce((s, p) => s + p.tris, 0));
  // enumerate what the runtime can actually put on screen at once, using its own
  // rules: bare arms only under a t-shirt, bare legs only under a skirt.
  const opts = (pre) => [...tri.keys()].filter((n) => n.startsWith(pre));
  let heavy = 0, light = Infinity, heavySpec = '', lightSpec = '';
  for (const top of opts('top_')) for (const bot of opts('bottom_'))
    for (const sh of opts('shoes_')) for (const hair of opts('hair_'))
      for (const cap of [0, 1]) for (const gl of [0, 1]) {
        if (cap && hair !== 'hair_buzz' && hair !== 'hair_short') continue;   // a cap goes over short hair only
        const worn = ['body', 'face', top, bot, sh, hair];
        if (top === 'top_tshirt') worn.push('body_arms');
        if (bot === 'bottom_skirt') worn.push('body_legs');
        if (cap) worn.push('extra_cap');
        if (gl) worn.push('extra_glasses');
        const t = worn.reduce((s, n) => s + tri.get(n), 0);
        if (t > heavy) { heavy = t; heavySpec = worn.join('+'); }
        if (t < light) { light = t; lightSpec = worn.join('+'); }
      }
  const all = [...tri.values()].reduce((a, b) => a + b, 0);
  console.log(`  triangles: worn ${light}..${heavy} (typical outfit `
    + `${OUTFIT.reduce((s, n) => s + tri.get(n), 0)}), all ${all} pieces in the file`);
  console.log(`    heaviest = ${heavySpec}`);
  console.log('    ' + [...tri].map(([n, t]) => `${n}=${t}`).join(' '));

  // -- stature, rest pose, dressed. Measured once per HAIRSTYLE and once with the
  //    cap, because a hat is the part of an outfit that decides how tall a player is.
  const rest = av.matrices(av.locals(null, 0));
  const bboxOf = (names) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const n of names) for (const prim of pieces.get(n)) {
      for (let i = 0; i < prim.pos.length / 3; i++) {
        const p = skinPoint(prim, i, rest);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
    }
    return { lo, size: hi.map((v, k) => v - lo[k]) };
  };
  const base = OUTFIT.filter((n) => !n.startsWith('hair_'));
  const heads = [...tri.keys()].filter((n) => n.startsWith('hair_')).map((h) => [h, bboxOf([...base, h]).size[1]]);
  heads.push(['short+cap', bboxOf([...base, 'hair_short', 'extra_cap']).size[1]]);
  const { lo, size } = bboxOf(OUTFIT);
  console.log(`  bbox (dressed, rest): ${size[0].toFixed(3)} x ${size[1].toFixed(3)} x ${size[2].toFixed(3)} m`
    + `   feet at y=${lo[1].toFixed(4)}`);
  console.log('  stature by head: ' + heads.map(([h, y]) => `${h.replace('hair_', '')} ${y.toFixed(3)}`).join('  '));
  const tallest = Math.max(...heads.map((h) => h[1]));

  // -- clips
  console.log('  clips: ' + Object.entries(av.clips)
    .map(([n, c]) => `${n} ${c.dur.toFixed(2)}s`).join(', '));

  // -- foot slide over the walk stance
  const walk = av.clips.walk;
  const N = 40;
  const shoe = pieces.get('shoes_trainers')[0];
  const mats0 = av.matrices(av.locals(walk, 0));
  // contact patch = the vertices of the left shoe within 6 mm of the floor at rest
  const contact = [];
  for (let i = 0; i < shoe.pos.length / 3; i++) {
    const p = skinPoint(shoe, i, rest);
    if (p[1] < lo[1] + 0.006 && p[0] < 0) contact.push(i);
  }
  const trail = [];      // [t, mean contact position]
  for (let f = 0; f <= N; f++) {
    const t = (f / N) * walk.dur;
    const m = av.matrices(av.locals(walk, t));
    const c = [0, 0, 0];
    for (const i of contact) {
      const p = skinPoint(shoe, i, m);
      c[0] += p[0] / contact.length; c[1] += p[1] / contact.length; c[2] += p[2] / contact.length;
    }
    trail.push([t, c]);
  }
  const floor = Math.min(...trail.map((s) => s[1][1]));
  const planted = trail.filter((s) => s[1][1] < floor + 0.004);
  // glTF is y-up, -z forward for our export; fit position = v0 + speed * t on both ground axes
  const fit = (axis) => {
    const n = planted.length;
    const mt = planted.reduce((s, p) => s + p[0], 0) / n;
    const mv = planted.reduce((s, p) => s + p[1][axis], 0) / n;
    let num = 0, den = 0;
    for (const [t, c] of planted) { num += (t - mt) * (c[axis] - mv); den += (t - mt) ** 2; }
    const k = den ? num / den : 0;
    const res = planted.map(([t, c]) => c[axis] - (mv + k * (t - mt)));
    return { k, drift: Math.max(...res) - Math.min(...res) };
  };
  const fz = fit(2), fx = fit(0);
  console.log(`  walk: stance ${planted.length}/${N + 1} samples on the floor`
    + `  speed ${Math.hypot(fz.k, fx.k).toFixed(3)} m/s`);
  console.log(`  FOOT SLIDE (residual after the authored speed):`
    + ` along travel ${(fz.drift * 1000).toFixed(1)} mm, sideways ${(fx.drift * 1000).toFixed(1)} mm`);

  // -- hem swing: the same vertices with the cloth bones held at rest
  for (const [piece, primIdx, label] of [['bottom_tracksuit', 0, 'trouser hem'], ['top_hoodie', 0, 'hoodie hem']]) {
    const prims = pieces.get(piece);
    let best = 0, bestPeak = 0;
    for (const prim of prims) {
      const clothVerts = [];
      for (let i = 0; i < prim.pos.length / 3; i++) {
        for (let k = 0; k < 4; k++) {
          if (prim.weights[i * 4 + k] > 0.25 && CLOTH_BONES.has(av.boneName[prim.joints[i * 4 + k]])) {
            clothVerts.push(i); break;
          }
        }
      }
      if (!clothVerts.length) continue;
      // deviation = animated cloth minus the same vertex with the cloth bones held at
      // their bind rotation, i.e. exactly the motion the limb does not account for.
      const dev = clothVerts.map(() => []);
      for (let f = 0; f < N; f++) {
        const t = (f / N) * walk.dur;
        const m = av.matrices(av.locals(walk, t));
        const mRest = av.matrices(av.locals(walk, t, CLOTH_BONES));
        clothVerts.forEach((i, k) => {
          const a = skinPoint(prim, i, m), b = skinPoint(prim, i, mRest);
          dev[k].push([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
        });
      }
      // swing = the widest separation between two frames of that deviation: the
      // peak-to-peak travel of the fabric, with any constant offset removed.
      const swing = dev.map((series) => {
        let mx = 0;
        for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++)
          mx = Math.max(mx, Math.hypot(series[i][0] - series[j][0],
            series[i][1] - series[j][1], series[i][2] - series[j][2]));
        return mx;
      }).sort((a, b) => b - a);
      const peak = swing[0];
      const mean8 = swing.slice(0, 8).reduce((a, b) => a + b, 0) / Math.min(8, swing.length);
      if (peak > bestPeak) { bestPeak = peak; best = mean8; }
    }
    console.log(`  ${label.toUpperCase()} SWING (peak-to-peak over the walk):`
      + ` widest vertex ${(bestPeak * 1000).toFixed(1)} mm, top-8 mean ${(best * 1000).toFixed(1)} mm`);
  }
  return { bytes: av.bytes, height: size[1], tallest, heavy, light };
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync('assets/avatars').filter((f) => f.endsWith('.glb')).map((f) => `assets/avatars/${f}`);
let total = 0, fail = 0;
for (const f of files) {
  const r = audit(f);
  total += r.bytes;
  if (r.height < 1.70 || r.tallest > 1.80) { console.log(`  !! stature out of the 1.70-1.80 band (tallest head ${r.tallest.toFixed(3)})`); fail++; }
  if (r.heavy > 3200) { console.log(`  !! heaviest outfit ${r.heavy} tris`); fail++; }
}
for (const f of fs.readdirSync('assets/avatars')) total += 0;
const payload = fs.readdirSync('assets/avatars')
  .reduce((s, f) => s + fs.statSync(`assets/avatars/${f}`).size, 0);
console.log(`\npayload assets/avatars/ = ${(payload / 1024 / 1024).toFixed(2)} MB`);
process.exit(fail ? 1 : 0);
