// grade.js — the menu's local colour grade and its ambient-occlusion bake.
//
// TWO jobs, both of them scene-grade rather than palette edits. src/core/palette.js
// is not ours to change (ARCHITECTURE.md rule 8), so everything here CLONES a
// palette material and adjusts it for this one scene. Nothing leaks into the
// office, the editor or the walkthrough.
//
// 1. THE GRADE. reference/architect-life/ANALYSIS.md item 10 asks for one
//    saturated accent against a field at 25 % saturation or less. The palette is
//    tuned for interiors, where brick and grass are small; outdoors they are the
//    whole picture, and the round-1 frame measured 67 % of pixels above 25 %
//    saturation in TWO competing hue masses (warm 31 %, green 19 %). We pull the
//    field down and leave the studio orange alone, so the accent is unambiguous.
//
// 2. THE AO BAKE. The same analysis asks for visible darkening in every wall
//    junction; round 1 measured 0.1/255 over a 90 px run, i.e. mathematically
//    flat. There is no GI and no SSAO in the budget, so we bake occlusion into a
//    vertex-colour attribute once, at load, against a voxel occupancy grid built
//    from the very boxes the building is made of. It costs one attribute and
//    nothing per frame.
//
//    ROUND 2 REBUILT ALL OF IT, because round 2's critic measured the result and
//    it failed: 3.2 luma over 20 px at the sign wall / parapet junction against a
//    required 12, one dark pixel and then flat under the colonnade beam, and
//    nothing at all above the plinth — while the same bake put mould-like
//    blotches on the brick and cut the underside of every concrete band into a
//    row of teeth. Three separate causes, all fixed here:
//
//      a. VERTICES IN THE WRONG PLACES. A uniform 0.45 m grid puts the nearest
//         vertex ring up to 225 mm from a soffit, so the dark sample is averaged
//         away across the quad before it ever reaches the corner. gradedBox()
//         below rakes the subdivision instead: rings at 50, 120, 240, 450 and
//         800 mm from every edge, coarse in the middle. Same triangle budget,
//         the resolution moved to where occlusion actually varies.
//      b. THE SURFACE OCCLUDING ITSELF. The march started 20 mm off the face,
//         which at a 0.25 m voxel is still inside the face's own cell, so a flat
//         wall randomly reported itself solid. That is the blotching, and the
//         teeth are the same error sampled on alternate vertices. The ray now
//         starts a full cell clear of the surface and the grid is 0.10 m.
//      c. ALL THE SAMPLES IN THE FAR FIELD. Six linear steps out to 1.5 m put the
//         first sample at 200 mm and only two inside half a metre. Spacing is
//         geometric now, so half the samples land in the first 300 mm, which is
//         the band the checklist measures.

import { Box3, Vector3, BufferAttribute, BufferGeometry, MeshStandardMaterial, Color } from 'three';
import { materialFor } from '../core/palette.js';

// ---------------------------------------------------------------------------
// colour helpers

/** Scale a hex colour's HSV saturation to `s` and its value by `v`. */
export function desat(hex, s, v = 1) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx <= 0) return hex;
  const lo = mx * (1 - s);
  const span = mx - mn;
  const f = (c) => (span < 1e-6 ? lo : lo + ((c - mn) / span) * (mx - lo));
  const nv = Math.min(1, mx * v) / (mx || 1);
  const to = (c) => Math.max(0, Math.min(255, Math.round(f(c) * nv * 255)));
  return (to(r) << 16) | (to(g) << 8) | to(b);
}

/**
 * The menu's grade table.
 *
 * `sat` is the HSV saturation the class is pulled down to, `val` a brightness
 * multiplier, `metalness`/`roughness` an override.
 *
 * METAL is the important one and it is not a taste call: the palette gives metal
 * metalness 0.85, and a metalness-0.85 material with no environment map has
 * nothing to reflect, so it renders black. This scene has no envMap (a PMREM of
 * the sky dome is more memory than the menu is worth), so the balcony balustrade
 * measured rgb(4,4,4) — a black slab over the blank wall that IS crime 6. Metal
 * that is lit rather than reflective needs a low metalness and a real base
 * colour; that is what a low-poly renderer without IBL can actually draw.
 */
const GRADE = {
  'metal':         { sat: 0.10, val: 1.24, metalness: 0.20, roughness: 0.52 },
  'metal-warm':    { sat: 0.30, val: 1.10, metalness: 0.26, roughness: 0.46 },
  // BRICK, round 2. It was at 0.36 saturation, which is a Victorian red, and the
  // critic's reading of the frame was "a converted Victorian brick block". That
  // costs us crime 10 outright: a chimney is only a joke on a building that is
  // obviously NEW, and it was reading as the one honest thing on an old one. A
  // grey-buff engineering brick reads as 2010s commercial, keeps the elevation a
  // different mass from the warm render bay, and takes the largest saturated
  // area in the frame down with it (checklist item 10). The chimney keeps the
  // old red — see 'brick-stack' in SYNTH, which is where the joke went.
  'brick':         { sat: 0.16, val: 1.10 },
  'brick-pale':    { sat: 0.28, val: 1.00 },
  'grass':         { sat: 0.22, val: 0.98 },
  'wood-mid':      { sat: 0.34, val: 1.00 },
  'wood-dark':     { sat: 0.30, val: 1.02 },
  'wood-light':    { sat: 0.28, val: 1.00 },
  'soil':          { sat: 0.24, val: 1.00 },
  // untouched on purpose: accent, ink, paper, plaster*, concrete*, paving,
  // asphalt, stone, glass — they are already at or below the bar.
};

/** Instance colours (trees, hedges, vehicles) run through the same grade. */
export function gradeTint(hex, kind = 'green') {
  if (kind === 'green') return desat(hex, 0.26, 0.94);
  if (kind === 'vehicle') return desat(hex, 0.30, 1.0);
  if (kind === 'prop') return desat(hex, 0.34, 1.0);
  return hex;
}

/**
 * Ids that do NOT exist in the palette because they are lighting, not finishes.
 *
 * Round 1 lit the lobby wall and the first-floor ceiling with two dedicated
 * PointLights. Profiling put the three point lights in this scene at 19 ms of a
 * 100 ms frame — a fifth of the budget to brighten about four square metres seen
 * through glass from 27 m away. An emissive surface is the same picture for free,
 * so these two ids are emissive plaster and the lights are gone.
 */
const SYNTH = {
  'lobby-glow': { color: 0xf0e2cc, emissive: 0xffc98a, emissiveIntensity: 0.55, roughness: 0.95 },
  // The chimney, and only the chimney. It is the old warm red the whole building
  // used to be, so on the grey-buff elevation it reads as a piece of somebody
  // else's building left standing on this one's roof — which is crime 10 told by
  // the model instead of by its tag.
  'brick-stack': { color: desat(0xa9573f, 0.44, 0.96), emissive: 0x000000, emissiveIntensity: 0, roughness: 0.9 },
};

const _mats = new Map();

/**
 * A palette material, graded for this scene. Cached per (id, options), never
 * mutating the shared palette instance.
 */
export function menuMaterial(id, opts = {}) {
  const key = `${id}|${opts.vertexColors ? 'vc' : ''}|${opts.flatShading ? 'fs' : ''}|${opts.side || ''}`;
  const hit = _mats.get(key);
  if (hit) return hit;
  const s = SYNTH[id];
  if (s) {
    const sm = new MeshStandardMaterial({
      color: new Color(s.color),
      emissive: new Color(s.emissive),
      emissiveIntensity: s.emissiveIntensity,
      roughness: s.roughness,
      metalness: 0,
      vertexColors: !!opts.vertexColors,
    });
    sm.name = `menu:${id}`;
    applyDepthBias(sm, id);
    _mats.set(key, sm);
    return sm;
  }
  const m = materialFor(id, opts).clone();
  const g = GRADE[id];
  if (g) {
    if (g.sat != null) m.color.setHex(desat(m.color.getHex(), g.sat, g.val ?? 1));
    if (g.metalness != null) m.metalness = g.metalness;
    if (g.roughness != null) m.roughness = g.roughness;
  }
  m.name = `menu:${id}`;
  applyDepthBias(m, id);
  _mats.set(key, m);
  return m;
}

/**
 * THE BACKGROUND SURFACES LOSE THE DEPTH TEST, as a backstop.
 *
 * This was tried FIRST as the answer to Jurek's item 4 and it was not the
 * answer: the big fights were three pairs of surfaces genuinely occupying the
 * same millimetres, and those are fixed in bad-building.js, where the geometry
 * is. Measured with a depth-function flip — the same camera and the same frame
 * rendered once with LessEqual and once with Less, so only surfaces that
 * actually tie can differ — the journey was 6 454 -> 2 164 -> 823 coplanar
 * pixels, all of it geometry.
 *
 * It stays because it earns its place on the remainder: removing it takes the
 * count from 788 back up to 1 495. The rule is structural — the five surfaces
 * other things are APPLIED to lose ties, so trim added later is right without
 * anybody remembering this file — but it is a backstop for the specks, not a
 * licence to stop separating layers.
 */
const BACKGROUND = new Set(['plaster-warm', 'brick', 'concrete', 'paving', 'concrete-dark']);

function applyDepthBias(m, id) {
  if (!BACKGROUND.has(id)) return;
  m.polygonOffset = true;
  m.polygonOffsetFactor = 2;
  m.polygonOffsetUnits = 6;
}


export function disposeGrades() {
  for (const m of _mats.values()) m.dispose();
  _mats.clear();
}

// ---------------------------------------------------------------------------
// occupancy + AO

/**
 * A voxel occupancy grid. Every box the Builder emits is stamped into it, so the
 * AO sweep asks "is there building here?" in one array lookup instead of testing
 * two hundred AABBs per ray step.
 */
export class Occupancy {
  constructor(min, max, cell = 0.24) {
    this.cell = cell;
    this.min = min.clone().addScalar(-cell);
    this.max = max.clone().addScalar(cell);
    this.nx = Math.max(1, Math.ceil((this.max.x - this.min.x) / cell));
    this.ny = Math.max(1, Math.ceil((this.max.y - this.min.y) / cell));
    this.nz = Math.max(1, Math.ceil((this.max.z - this.min.z) / cell));
    this.grid = new Uint8Array(this.nx * this.ny * this.nz);
    this.groundY = null;     // if set, everything below it counts as solid
    this.count = 0;
  }

  addBox(box) {
    const c = this.cell, m = this.min;
    const i0 = Math.max(0, Math.floor((box.min.x - m.x) / c));
    const i1 = Math.min(this.nx - 1, Math.floor((box.max.x - m.x) / c));
    const j0 = Math.max(0, Math.floor((box.min.y - m.y) / c));
    const j1 = Math.min(this.ny - 1, Math.floor((box.max.y - m.y) / c));
    const k0 = Math.max(0, Math.floor((box.min.z - m.z) / c));
    const k1 = Math.min(this.nz - 1, Math.floor((box.max.z - m.z) / c));
    for (let j = j0; j <= j1; j++) {
      for (let k = k0; k <= k1; k++) {
        const base = (j * this.nz + k) * this.nx;
        for (let i = i0; i <= i1; i++) { this.grid[base + i] = 1; this.count++; }
      }
    }
  }

  solid(x, y, z) {
    if (this.groundY !== null && y < this.groundY) return true;
    const c = this.cell, m = this.min;
    const i = ((x - m.x) / c) | 0;
    if (i < 0 || i >= this.nx) return false;
    const j = ((y - m.y) / c) | 0;
    if (j < 0 || j >= this.ny) return false;
    const k = ((z - m.z) / c) | 0;
    if (k < 0 || k >= this.nz) return false;
    return this.grid[(j * this.nz + k) * this.nx + i] === 1;
  }
}

/**
 * 25 directions: the 6 axes, the 8 corners and the 12 edge midpoints, all
 * normalised. Thirteen was too few — with only three usable directions per
 * hemisphere face the estimate quantises into visible steps along a wall, which
 * is the second half of the blotching. Deterministic, and still nothing per frame.
 */
const DIRS = (() => {
  const d = [];
  const k2 = 1 / Math.sqrt(2), k3 = 1 / Math.sqrt(3);
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      for (const c of [-1, 0, 1]) {
        const n = Math.abs(a) + Math.abs(b) + Math.abs(c);
        if (n === 0) continue;
        const k = n === 1 ? 1 : n === 2 ? k2 : k3;
        d.push([a * k, b * k, c * k]);
      }
    }
  }
  return d;    // 26 axes/edges/corners
})();

/**
 * Bake ambient occlusion into `geometry`'s colour attribute.
 *
 * For every vertex: march `steps` samples along each direction in the vertex's
 * own hemisphere, weight a hit by how close it is, and write the result as a
 * grey vertex colour that MULTIPLIES the material colour. A wall darkens where
 * it meets the floor, the ground darkens where it meets the plinth, and a
 * balcony soffit darkens under the slab — which is checklist items 5 and 6.
 *
 * Sample spacing is GEOMETRIC, not linear: with a 0.10 m grid and a 1.6 m reach
 * that puts samples at 100, 152, 231, 351, 533, 810, 1231 and 1600 mm, so four of
 * the eight land inside the 350 mm the checklist actually measures. Linear
 * spacing spent five of six samples past half a metre, where nothing is.
 *
 * Returns the mean AO, so the caller can log a number rather than a hope.
 */
export function bakeVertexAO(geometry, occ, opts = {}) {
  const strength = opts.strength ?? 0.78;
  const floor = opts.floor ?? 0.34;
  const steps = opts.steps ?? 8;
  const reach = opts.reach ?? 1.6;
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  if (!pos || !nor) return 1;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  // Start a whole cell clear of the surface. At 0.02 m the sample was still
  // inside the vertex's own voxel and every flat wall occluded itself in
  // patches — the mould the critic measured on the brick.
  const start = occ.cell * 1.05;
  const ratio = Math.pow(reach / start, 1 / (steps - 1));
  const ts = [];
  for (let s = 0, t = start; s < steps; s++, t *= ratio) ts.push(t);
  const lift = occ.cell * 1.05;
  let sum = 0;
  for (let v = 0; v < n; v++) {
    const px = pos.getX(v) + nor.getX(v) * lift;
    const py = pos.getY(v) + nor.getY(v) * lift;
    const pz = pos.getZ(v) + nor.getZ(v) * lift;
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    let occl = 0, wsum = 0;
    for (let d = 0; d < DIRS.length; d++) {
      const dir = DIRS[d];
      const w = nx * dir[0] + ny * dir[1] + nz * dir[2];
      if (w <= 0.08) continue;
      wsum += w;
      // walk outward; the first hit closes the ray, near hits count for more
      for (let s = 0; s < steps; s++) {
        const t = ts[s];
        if (occ.solid(px + dir[0] * t, py + dir[1] * t, pz + dir[2] * t)) {
          occl += w * (1 - t / reach);
          break;
        }
      }
    }
    const ao = wsum > 0 ? Math.max(floor, 1 - strength * (occl / wsum)) : 1;
    col[v * 3] = ao; col[v * 3 + 1] = ao; col[v * 3 + 2] = ao;
  }
  // One relaxation pass over the index graph. It only ever averages vertices
  // that share a triangle, and a merged box's faces do not share vertices, so
  // this smooths ALONG a face — killing the last of the voxel stair-stepping —
  // without bleeding light around a corner and softening the band itself.
  smoothAlongFaces(geometry, col);
  for (let v = 0; v < n; v++) sum += col[v * 3];
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  return sum / n;
}

function smoothAlongFaces(geometry, col, keep = 0.55) {
  const index = geometry.getIndex();
  if (!index) return;
  const n = col.length / 3;
  const acc = new Float32Array(n);
  const cnt = new Uint16Array(n);
  const ix = index.array;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i], b = ix[i + 1], c = ix[i + 2];
    acc[a] += col[b * 3] + col[c * 3]; cnt[a] += 2;
    acc[b] += col[a * 3] + col[c * 3]; cnt[b] += 2;
    acc[c] += col[a * 3] + col[b * 3]; cnt[c] += 2;
  }
  for (let v = 0; v < n; v++) {
    if (!cnt[v]) continue;
    const s = keep * col[v * 3] + (1 - keep) * (acc[v] / cnt[v]);
    col[v * 3] = s; col[v * 3 + 1] = s; col[v * 3 + 2] = s;
  }
}

// ---------------------------------------------------------------------------
// graded tessellation
//
// A box or a slab subdivided so that vertices cluster where occlusion changes —
// against the edges — and thin out across the middle, where it does not. This is
// the geometric half of the AO fix, and it is why a 14.4 m elevation can hold a
// 350 mm contact band without being cut into a 32 x 32 grid.

const NEAR = [0.05, 0.12, 0.24, 0.45, 0.80];

/**
 * Ascending parameter list from 0 to `len`: the NEAR rake in from each end, a
 * coarse uniform run between them. Never fewer than the two ends.
 */
export function rake(len, step = 1.25) {
  if (!(len > 0)) return [0, 0];
  if (len <= 0.11) return [0, len];
  const half = len * 0.5 - 1e-6;
  const head = NEAR.filter((d) => d < half);
  const out = [0, ...head];
  const a = out[out.length - 1];
  const b = len - a;
  const nMid = Math.max(1, Math.min(20, Math.round((b - a) / step)));
  for (let i = 1; i < nMid; i++) out.push(a + (b - a) * (i / nMid));
  for (let i = head.length - 1; i >= 0; i--) out.push(len - head[i]);
  out.push(len);
  return out;
}

/** One planar grid of an axis-aligned face, appended to the running buffers. */
function pushFace(buf, as, bs, o, u, v, nrm) {
  const base = buf.pos.length / 3;
  const na = as.length, nb = bs.length;
  const la = as[na - 1] || 1, lb = bs[nb - 1] || 1;
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < na; i++) {
      const s = as[i], t = bs[j];
      buf.pos.push(o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t);
      buf.nor.push(nrm[0], nrm[1], nrm[2]);
      buf.uv.push(s / la, t / lb);
    }
  }
  // u x v tells us which way this grid winds; flip when it faces inward
  const cx = u[1] * v[2] - u[2] * v[1];
  const cy = u[2] * v[0] - u[0] * v[2];
  const cz = u[0] * v[1] - u[1] * v[0];
  const rev = (cx * nrm[0] + cy * nrm[1] + cz * nrm[2]) < 0;
  for (let j = 0; j < nb - 1; j++) {
    for (let i = 0; i < na - 1; i++) {
      const a = base + j * na + i, b = a + 1, c = a + na, e = c + 1;
      if (rev) buf.idx.push(a, c, b, b, c, e);
      else buf.idx.push(a, b, c, b, e, c);
    }
  }
}

/**
 * A box centred on the origin, like BoxGeometry, but raked. Indexed, with
 * position / normal / uv, so it merges with everything else in the scene.
 */
export function gradedBox(w, h, d, step = 1.25) {
  const xs = rake(w, step), ys = rake(h, step), zs = rake(d, step);
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const buf = { pos: [], nor: [], uv: [], idx: [] };
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  pushFace(buf, zs, ys, [hw, -hh, -hd], Z, Y, [1, 0, 0]);
  pushFace(buf, zs, ys, [-hw, -hh, -hd], Z, Y, [-1, 0, 0]);
  pushFace(buf, xs, zs, [-hw, hh, -hd], X, Z, [0, 1, 0]);
  pushFace(buf, xs, zs, [-hw, -hh, -hd], X, Z, [0, -1, 0]);
  pushFace(buf, xs, ys, [-hw, -hh, hd], X, Y, [0, 0, 1]);
  pushFace(buf, xs, ys, [-hw, -hh, -hd], X, Y, [0, 0, -1]);
  return finish(buf);
}

/** A horizontal, upward-facing slab of ground, raked toward its own edges. */
export function gradedSlab(w, d, step = 1.25) {
  const xs = rake(w, step), zs = rake(d, step);
  const buf = { pos: [], nor: [], uv: [], idx: [] };
  pushFace(buf, xs, zs, [-w / 2, 0, -d / 2], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  return finish(buf);
}

function finish(buf) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(buf.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(buf.nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(buf.uv), 2));
  g.setIndex(buf.idx);
  return g;
}

/** Convenience: the AABB of a geometry, in the geometry's own (already baked) space. */
export function boundsOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox || new Box3(new Vector3(), new Vector3());
}
