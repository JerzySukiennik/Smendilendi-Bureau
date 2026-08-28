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

import { Box3, Vector3, BufferAttribute, MeshStandardMaterial, Color } from 'three';
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
  'brick':         { sat: 0.36, val: 1.02 },
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
  _mats.set(key, m);
  return m;
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

// 13 directions on the unit sphere: the 6 axes plus the 8 corners, normalised.
// Cheap, deterministic, and enough for a low-poly scene where every junction is
// a right angle.
const DIRS = (() => {
  const d = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const k = 1 / Math.sqrt(3);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) d.push([sx * k, sy * k, sz * k]);
  return d;
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
 * Returns the mean AO, so the caller can log a number rather than a hope.
 */
export function bakeVertexAO(geometry, occ, opts = {}) {
  const strength = opts.strength ?? 0.72;
  const floor = opts.floor ?? 0.38;
  const steps = opts.steps ?? 6;
  const reach = opts.reach ?? 1.5;
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  if (!pos || !nor) return 1;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const start = occ.cell * 0.8;
  const dt = (reach - start) / (steps - 1);
  let sum = 0;
  for (let v = 0; v < n; v++) {
    const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    let occl = 0, wsum = 0;
    for (let d = 0; d < DIRS.length; d++) {
      const [dx, dy, dz] = DIRS[d];
      const w = nx * dx + ny * dy + nz * dz;
      if (w <= 0.08) continue;
      wsum += w;
      // walk outward; the first hit closes the ray, near hits count for more
      for (let s = 0; s < steps; s++) {
        const t = start + s * dt;
        if (occ.solid(px + dx * t + nx * 0.02, py + dy * t + ny * 0.02, pz + dz * t + nz * 0.02)) {
          occl += w * (1 - t / reach);
          break;
        }
      }
    }
    const ao = wsum > 0 ? Math.max(floor, 1 - strength * (occl / wsum)) : 1;
    sum += ao;
    col[v * 3] = ao; col[v * 3 + 1] = ao; col[v * 3 + 2] = ao;
  }
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  return sum / n;
}

/** Convenience: the AABB of a geometry, in the geometry's own (already baked) space. */
export function boundsOf(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox || new Box3(new Vector3(), new Vector3());
}
