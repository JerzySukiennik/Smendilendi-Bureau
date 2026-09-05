// props.js — the office prop library.
//
// Two jobs:
//
//  1. MeshBuilder — accumulate primitives into ONE merged BufferGeometry per
//     material class, with baked vertex colour and baked contact/ambient
//     occlusion. Draw calls are the budget (ARCHITECTURE.md rule 5): a hundred
//     unique one-off props merged this way cost six draw calls, not a hundred.
//
//  2. A catalogue of prop builders at real metric sizes. Every number in this
//     file is one a practising architect can check: a task-chair seat is 0.46 m,
//     an A0 plan chest is 1.37 x 0.96 x 0.90 m, a 24" monitor panel is
//     0.545 x 0.325 m, an A1 sheet is 0.594 x 0.841 m, a mug is 82 mm across.
//
// Prop convention (identical to src/model/proc-shapes.js so the two are
// interchangeable): metres, radians, +x width, +y up, +z towards the FRONT of
// the item (the side it is used from), origin at the centre of the footprint ON
// THE FLOOR.
//
// Colour rule. `color` is always the EXACT final surface colour, whatever
// material class it is drawn on. The builder divides by the palette class's own
// base colour before writing the vertex attribute, so 'ink' and 'wood-light'
// and 'flat' all honour the same number. (Round 1 multiplied instead of
// compensating, and the whole studio rendered two stops too dark and too brown
// because every surface was base x tint.) `shade` is a separate scalar and MAY
// exceed 1.
// No hex value is invented here that is not either from src/core/palette.js or
// a deliberately desaturated variant of one; see SAT note in office.js.

import {
  BufferGeometry, BufferAttribute, BoxGeometry, CylinderGeometry, PlaneGeometry,
  SphereGeometry, Matrix4, Euler, Vector3, Color, CanvasTexture,
  MeshBasicMaterial, DoubleSide, SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materialFor, MATERIAL_CLASSES } from '../core/palette.js';
import { modelParts } from './models.js';

// ---------------------------------------------------------------------------
// Palette additions used only by the office. Everything here is a DESATURATED
// derivative — HSV saturation is given after each, because the finish bar
// (reference/architect-life/ANALYSIS.md item 10) allows exactly one saturated
// accent hue in a frame and everything else at 25 % or less.

export const OFFICE = {
  // neutrals
  concreteFloor: 0xb0aaa1,   // s 0.081  polished concrete slab
  wallPaint:     0xe6dccd,   // s 0.113  studio plaster
  wallShade:     0xd6cbba,   // s 0.128
  limewash:      0xbcb3a8,   // s 0.117  painted brick feature wall
  limewashDk:    0xa79e93,   // s 0.117
  skirting:      0x35322e,   // s 0.132
  ceiling:       0xefe8dc,   // s 0.079

  // timber
  oak:           0xd3bE9c,   // s 0.265 -> used only on small desk tops
  oakPale:       0xd8c9b1,   // s 0.196  desk tops
  walnut:        0x8a7157,   // s 0.369 -> shaded down in use
  walnutSoft:    0x9c8f7c,   // s 0.199  plan chest / meeting table
  ply:           0xcbb99b,   // s 0.235  model baseboards, boxes

  // greys / blacks
  charcoal:      0x3a3835,   // s 0.081
  nearBlack:     0x1d1c1a,   // s 0.100  pendant shades, monitor bezels
  steel:         0x9c9a95,   // s 0.045
  steelDark:     0x6e6c68,   // s 0.045

  // paper / ceramics
  paper:         0xf1ece2,   // s 0.059
  paperWarm:     0xe6dfd2,   // s 0.098
  blueprint:     0x4c5b66,   // s 0.255 -> only on tiny sheets
  ceramic:       0xe9e6df,   // s 0.043

  // muted foliage — deliberately NOT palette.grass (s 0.47), which would be a
  // second saturated accent competing with the studio orange.
  leaf:          0x76806a,   // s 0.172
  leafDark:      0x5b6553,   // s 0.184
  soil:          0x4c443b,   // s 0.245

  // fabrics
  wool:          0x8f877b,   // s 0.084  rug / upholstery
  woolDk:        0x6c655c,   // s 0.078
};

// THE one saturated accent (palette.COLORS.accent, 0xd4763a, HSV s 0.727).
// Used on exactly three objects in the room — see office.js ACCENT_USES.
export const ACCENT = 0xd4763a;

// ---------------------------------------------------------------------------
// MeshBuilder

const _m4 = new Matrix4();
const _e = new Euler();
const _v = new Vector3();
const _c = new Color();
const _base = new Color();
const _baseCache = new Map();

/**
 * Exact-colour compensation. Vertex colours multiply the material's own base
 * colour, so to make a surface come out at exactly `hex` on material `mat` the
 * attribute has to carry hex / base. Values above 1 are legal in a float colour
 * attribute and are exactly what a dark base like 'ink' needs.
 */
export function compensate(mat, hex, target = new Color()) {
  let base = _baseCache.get(mat);
  if (!base) {
    const spec = MATERIAL_CLASSES[mat];
    base = new Color(spec ? spec.color : 0xffffff);
    _baseCache.set(mat, base);
  }
  target.set(hex === undefined || hex === null ? 0xffffff : hex);
  target.r /= Math.max(1e-4, base.r);
  target.g /= Math.max(1e-4, base.g);
  target.b /= Math.max(1e-4, base.b);
  return target;
}

/**
 * Ambient-occlusion bake. Every vertex is darkened by how close it is to the
 * floor and to the wall behind it. This is the cheap, honest version of the
 * "visible AO band at every wall/floor junction" the finish bar demands: it is
 * baked into vertex colour, costs nothing at runtime and cannot be turned off
 * by a driver.
 */
export const AO = {
  floorReach: 0.42,     // m over which floor contact darkens a prop
  floorDepth: 0.42,     // how dark at contact (1 = no darkening)
  wallReach: 0.55,
  wallDepth: 0.55,
};

// ---------------------------------------------------------------------------
// The bevel.
//
// DESIGN-DECISIONS.md "Look" asks for "simple volumes, softly bevelled edges".
// Round 1 had the simple volumes and NO bevels, and that single omission is
// most of the difference between "clean low poly" and "programmer boxes": a
// sharp 90 degree arris either catches the key light or it does not, so an
// object reads as two or three flat fields with a hard black line between them.
// A 5-6 mm chamfer adds a third facet at 45 degrees along every edge, which
// always catches SOME light, and that thin bright line is what draws the
// silhouette of every object in the reference shots.
//
// It costs 44 triangles against a box's 12. The office renders at 0.6 ms on the
// target GPU, so the budget is not the constraint; the look is.

export const BEVEL = 0.006;          // 6 mm, the default chamfer on office props

const _CHAMFER_AXES = [[1, 2], [0, 2], [0, 1]];   // the two axes each face spans

/**
 * A box with every edge chamfered: 6 face quads, 12 edge quads, 8 corner
 * triangles, flat-normalled so each facet shades separately.
 *
 * Indexed with an identity index on purpose — mergeGeometries refuses a set
 * whose members disagree about being indexed, and everything else the office
 * draws (BoxGeometry, CylinderGeometry, the catalogue GLBs) is indexed.
 */
export function chamferBoxGeometry(w, h, d, c = BEVEL) {
  const half = [w / 2, h / 2, d / 2];
  const cc = Math.min(c, half[0] * 0.48, half[1] * 0.48, half[2] * 0.48);
  if (!(cc > 1e-5)) return new BoxGeometry(w, h, d);
  const inner = [half[0] - cc, half[1] - cc, half[2] - cc];

  // The vertex on corner `s` that belongs to the face of axis `a`.
  const V = (s, a) => {
    const p = [s[0] * inner[0], s[1] * inner[1], s[2] * inner[2]];
    p[a] = s[a] * half[a];
    return p;
  };

  const pos = [];
  const nor = [];
  const tri = (A, B, C) => {
    let ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    let vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // Convex and centred on the origin, so the outward direction is the
    // centroid direction. Flip the winding rather than trusting the ring order.
    const gx = (A[0] + B[0] + C[0]) / 3, gy = (A[1] + B[1] + C[1]) / 3, gz = (A[2] + B[2] + C[2]) / 3;
    if (nx * gx + ny * gy + nz * gz < 0) {
      const t = B; B = C; C = t;
      nx = -nx; ny = -ny; nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    pos.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    for (let i = 0; i < 3; i++) nor.push(nx, ny, nz);
  };
  const quad = (A, B, C, D) => { tri(A, B, C); tri(A, C, D); };

  // 6 face quads
  for (let a = 0; a < 3; a++) {
    const [u, v] = _CHAMFER_AXES[a];
    for (const sa of [-1, 1]) {
      const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([su, sv]) => {
        const s = [0, 0, 0];
        s[a] = sa; s[u] = su; s[v] = sv;
        return V(s, a);
      });
      quad(ring[0], ring[1], ring[2], ring[3]);
    }
  }
  // 12 edge quads
  for (let a = 0; a < 3; a++) {
    for (let bAx = a + 1; bAx < 3; bAx++) {
      const e = 3 - a - bAx;                       // the axis the edge runs along
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const s0 = [0, 0, 0]; s0[a] = sa; s0[bAx] = sb; s0[e] = -1;
        const s1 = [0, 0, 0]; s1[a] = sa; s1[bAx] = sb; s1[e] = 1;
        quad(V(s0, a), V(s0, bAx), V(s1, bAx), V(s1, a));
      }
    }
  }
  // 8 corner triangles
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const s = [sx, sy, sz];
    tri(V(s, 0), V(s, 1), V(s, 2));
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  const n = pos.length / 3;
  const idx = new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export class MeshBuilder {
  constructor() {
    this.parts = new Map();          // matId -> BufferGeometry[]
    this._stack = [new Matrix4()];
    this._ao = true;
    this.count = 0;
  }

  get matrix() { return this._stack[this._stack.length - 1]; }

  /** Push a local frame. t = { x,y,z, ry, rx, rz, s } */
  push(t = {}) {
    const m = new Matrix4();
    _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ');
    m.makeRotationFromEuler(_e);
    m.setPosition(t.x || 0, t.y || 0, t.z || 0);
    if (t.s !== undefined) {
      const s = typeof t.s === 'number' ? [t.s, t.s, t.s] : t.s;
      m.scale(_v.set(s[0], s[1], s[2]));
    }
    this._stack.push(new Matrix4().multiplyMatrices(this.matrix, m));
    return this;
  }

  pop() { if (this._stack.length > 1) this._stack.pop(); return this; }

  /** Run fn inside a local frame. */
  at(t, fn) { this.push(t); fn(this); this.pop(); return this; }

  /** Disable/enable the AO bake for a run of parts (e.g. things on a shelf). */
  noAO(fn) { const p = this._ao; this._ao = false; fn(this); this._ao = p; return this; }

  add(geo, opts = {}) {
    const mat = opts.mat || 'flat';
    const m = _m4.identity();
    if (opts.x || opts.y || opts.z || opts.ry || opts.rx || opts.rz || opts.s !== undefined) {
      _e.set(opts.rx || 0, opts.ry || 0, opts.rz || 0, 'YXZ');
      m.makeRotationFromEuler(_e);
      m.setPosition(opts.x || 0, opts.y || 0, opts.z || 0);
      if (opts.s !== undefined) {
        const s = typeof opts.s === 'number' ? [opts.s, opts.s, opts.s] : opts.s;
        m.scale(_v.set(s[0], s[1], s[2]));
      }
    }
    const world = new Matrix4().multiplyMatrices(this.matrix, m);
    geo.applyMatrix4(world);

    // vertex colour = tint * AO
    const pos = geo.attributes.position;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    compensate(mat, opts.color, _c);
    const cr = _c.r, cg = _c.g, cb = _c.b;
    const useAO = this._ao && opts.ao !== false;
    const wall = opts.wall;                 // { axis:'x'|'z', at:number, dir:1|-1 }
    for (let i = 0; i < n; i++) {
      let k = 1;
      if (useAO) {
        const y = pos.getY(i);
        if (y < AO.floorReach) {
          const t = Math.max(0, y) / AO.floorReach;
          k *= AO.floorDepth + (1 - AO.floorDepth) * (t * t * (3 - 2 * t));
        }
        if (wall) {
          const d = Math.abs((wall.axis === 'x' ? pos.getX(i) : pos.getZ(i)) - wall.at);
          if (d < AO.wallReach) {
            const t = d / AO.wallReach;
            k *= AO.wallDepth + (1 - AO.wallDepth) * (t * t * (3 - 2 * t));
          }
        }
      }
      if (opts.shade !== undefined) k *= opts.shade;
      // A caller-supplied ramp, in prop space (the geometry has already had its
      // matrix applied by the time we get here). This exists because the built-in
      // AO only ever darkens the bottom `AO.floorReach` metres of a prop: anything
      // taller than that — a 1.35 m felt partition — renders as one dead uniform
      // slab above the first 0.42 m, and a critic picked our frame out of a blind
      // A/B by that slab alone. `grad` lets a prop shade its own height.
      if (opts.grad) k *= opts.grad(pos.getX(i), pos.getY(i), pos.getZ(i));
      col[i * 3] = cr * k; col[i * 3 + 1] = cg * k; col[i * 3 + 2] = cb * k;
    }
    geo.setAttribute('color', new BufferAttribute(col, 3));
    // uv is dropped: nothing in the office is textured, and keeping it forces
    // mergeGeometries to carry 2 floats per vertex for nothing.
    geo.deleteAttribute('uv');
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
    this.count++;
    return this;
  }

  box(w, h, d, opts = {}) { return this.add(new BoxGeometry(w, h, d), opts); }

  /** A box whose ORIGIN is its bottom face centre — how furniture is authored. */
  boxUp(w, h, d, opts = {}) {
    return this.add(new BoxGeometry(w, h, d), { ...opts, y: (opts.y || 0) + h / 2 });
  }

  cyl(rb, rt, h, seg, opts = {}) {
    return this.add(new CylinderGeometry(rt, rb, h, seg, 1, !!opts.open), opts);
  }

  cylUp(rb, rt, h, seg, opts = {}) {
    return this.cyl(rb, rt, h, seg, { ...opts, y: (opts.y || 0) + h / 2 });
  }

  sphere(r, seg, opts = {}) { return this.add(new SphereGeometry(r, seg, Math.max(3, seg >> 1)), opts); }

  /** A chamfered box. `opts.c` overrides the 6 mm default. */
  cbox(w, h, d, opts = {}) {
    return this.add(chamferBoxGeometry(w, h, d, opts.c ?? BEVEL), opts);
  }

  /** A chamfered box whose origin is its bottom face centre. */
  cboxUp(w, h, d, opts = {}) {
    return this.add(chamferBoxGeometry(w, h, d, opts.c ?? BEVEL), { ...opts, y: (opts.y || 0) + h / 2 });
  }

  /**
   * A cylinder with its two rim edges chamfered — the round-object equivalent
   * of cbox. Three frusta: a bottom shoulder, the barrel, a top shoulder.
   * Origin at the bottom face centre.
   */
  ccylUp(rb, rt, h, seg, opts = {}) {
    const c = Math.min(opts.c ?? BEVEL, h * 0.32, Math.min(rb, rt) * 0.45);
    const y = opts.y || 0;
    if (!(c > 1e-5)) return this.cylUp(rb, rt, h, seg, opts);
    const mb = rb + (rt - rb) * (c / h);            // radius where the barrel starts
    const mt = rb + (rt - rb) * ((h - c) / h);
    this.cyl(rb - c, mb, c, seg, { ...opts, y: y + c / 2 });
    this.cyl(mb, mt, h - 2 * c, seg, { ...opts, y: y + h / 2 });
    this.cyl(mt, rt - c, c, seg, { ...opts, y: y + h - c / 2 });
    return this;
  }

  /**
   * Draw a catalogue model — the baked parts from models.js — at the current
   * frame. Returns false when the model is not loaded, which is the signal for
   * a prop to draw its procedural body instead.
   *
   * `tint` replaces the colour of the model's white `tint` slot, so a call site
   * can colour a desk top or a chair's upholstery exactly as it does for a
   * procedural prop. Everything else keeps the studio colour models.js assigned.
   */
  model(parts, o = {}) {
    if (!parts || !parts.length) return false;
    for (const p of parts) {
      const useTint = p.slot === 'tint' && o.tint !== undefined && o.tint !== null;
      const color = useTint ? o.tint : p.color;
      this.add(p.geometry.clone(), {
        x: o.x, y: o.y, z: o.z, rx: o.rx, ry: o.ry, rz: o.rz, s: o.s,
        shade: o.shade, ao: o.ao, wall: o.wall,
        mat: p.mat, color: color === null ? undefined : color,
      });
    }
    return true;
  }

  /**
   * model(), but scaled so the model's own measured size becomes `want`.
   * Only axes given in `want` are scaled. Kept small on purpose: a desk
   * stretched from 1.60 to 1.80 m is invisible, a chair stretched 40 % is not.
   */
  modelSized(key, want = {}, o = {}) {
    const parts = modelParts(key);
    if (!parts) return false;
    const have = parts.size;
    const s = [
      want.w ? want.w / have[0] : 1,
      want.h ? want.h / have[1] : 1,
      want.d ? want.d / have[2] : 1,
    ];
    const unit = Math.abs(s[0] - 1) < 1e-4 && Math.abs(s[1] - 1) < 1e-4 && Math.abs(s[2] - 1) < 1e-4;
    return this.model(parts, { ...o, s: unit ? undefined : s });
  }

  /** A flat quad in the XZ plane (facing +y) unless rotated. */
  quad(w, d, opts = {}) {
    return this.add(new PlaneGeometry(w, d), { rx: -Math.PI / 2, ...opts });
  }

  /** A flat quad standing up, facing +z. */
  panel(w, h, opts = {}) { return this.add(new PlaneGeometry(w, h), opts); }

  /** Merge into [{ mat, geometry }]. Destroys the builder's part list. */
  build() {
    const out = [];
    for (const [mat, geos] of this.parts) {
      if (!geos.length) continue;
      const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!g) { console.warn(`[props] merge failed for material "${mat}"`); continue; }
      if (geos.length > 1) for (const x of geos) x.dispose();
      g.computeBoundingSphere();
      out.push({ mat, geometry: g });
    }
    this.parts.clear();
    return out;
  }
}

/** Materials the builder can name. Vertex colour multiplies each one. */
export function builderMaterial(mat) {
  if (mat === 'glass') return materialFor('glass');
  return materialFor(mat, { vertexColors: true, flatShading: mat === 'flat' });
}

/** Build one prop in isolation -> [{ mat, geometry }] for an InstancePool. */
export function bakeProp(fn, opts = {}) {
  const b = new MeshBuilder();
  fn(b, opts);
  return b.build();
}

// ---------------------------------------------------------------------------
// Contact shadow decal
//
// Finish bar item 4: "every floor-standing object has a visible contact
// shadow — count objects, count shadows, the numbers must be equal, zero
// exceptions". A shadow map cannot deliver that for a mug or a pen cup, so
// every floor- and desk-standing object also gets a multiply-blended blob.
// One texture, one material, one InstancedMesh: the whole room's contact
// shadows are ONE draw call.

let _blobTex = null;
export function contactShadowTexture() {
  if (_blobTex) return _blobTex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  // Transparent field, dark soft core. Straight alpha, drawn with normal
  // blending: multiply blending looked right on paper and rendered as white
  // squares on the actual floor, which is exactly the sort of thing that has to
  // be looked at rather than reasoned about.
  //
  // The gradient shape matters more than its peak. A blob that fades from the
  // centre outwards puts its darkest pixel UNDER the object, where nobody can
  // see it, and leaves the visible ring — the only part that reads as a contact
  // shadow — at the faint tail. Measured on the cardboard boxes in round 1:
  // 37/255 and 17/255 of floor darkening against 60-115 under the desks, i.e. a
  // fail of finish bar item 4 caused purely by the falloff curve.
  // So the core is a PLATEAU that covers the whole footprint at full strength
  // and the falloff is a short shoulder in the outer third.
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0.00, 'rgba(12,10,9,0.82)');
  grad.addColorStop(0.46, 'rgba(13,11,10,0.78)');
  grad.addColorStop(0.62, 'rgba(15,13,11,0.62)');
  grad.addColorStop(0.80, 'rgba(18,16,13,0.28)');
  grad.addColorStop(1.00, 'rgba(24,20,17,0.00)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  _blobTex = new CanvasTexture(c);
  _blobTex.colorSpace = SRGBColorSpace;
  _blobTex.needsUpdate = true;
  return _blobTex;
}

/**
 * The contact-shadow material, with ONE addition: a per-instance strength.
 *
 * Every shadow point already carried a `strength` (a mug on a desk should not
 * sit in the same pool of dark as a plan chest on the floor) and nothing read
 * it, so every blob rendered at full weight. InstancedMesh's built-in
 * instanceColor cannot express it — it multiplies rgb, and these blobs are
 * almost black already, so scaling their colour changes nothing visible. What
 * has to vary is ALPHA, which means one extra instanced attribute and four
 * lines of shader patch. Instances whose `aStrength` is never written render
 * invisible, so office.js sets the attribute for every instance it allocates.
 */
export function contactShadowMaterial() {
  const m = new MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStrength;\nvarying float vStrength;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvStrength = aStrength;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStrength;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.a *= vStrength;');
  };
  m.customProgramCacheKey = () => 'office-contact-shadow-strength';
  return m;
}

/** A unit quad in the XZ plane, for the contact-shadow instanced mesh. */
export function contactShadowGeometry() {
  const g = new PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// PROPS. Each takes (b, o) and draws at the origin, footprint centre, on the
// floor, facing +z.

/** 1600 x 800 mm desk, 740 mm to the top. Steel legs, 25 mm oak top. */
export function propDesk(b, o = {}) {
  const w = o.w ?? 1.60, d = o.d ?? 0.80, h = o.h ?? 0.74;
  const top = o.top ?? 0xffffff;      // white: the tier tint is the instance colour
  if (b.modelSized('desk', { w, h, d }, { tint: top })) return;
  b.cboxUp(w, 0.025, d, { y: h - 0.025, color: top, mat: 'wood-light', c: 0.004 });
  b.cboxUp(w - 0.10, 0.04, d - 0.10, { y: h - 0.065, color: 0xd8d4cd, mat: 'metal' });  // sub-frame
  // 50 x 50 legs, inset 60 mm
  const lx = w / 2 - 0.055, lz = d / 2 - 0.055;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cboxUp(0.05, h - 0.065, 0.05, { x: sx * lx, z: sz * lz, color: 0xe4e0d8, mat: 'metal', c: 0.004 });
  }
  // cable tray under the back edge + a modesty return
  b.cboxUp(w - 0.30, 0.06, 0.12, { y: 0.60, z: -d / 2 + 0.10, color: 0xcac6c0, mat: 'metal' });
  // 80 mm cable grommet
  b.cylUp(0.04, 0.04, 0.012, 12, { y: h - 0.026, x: w / 2 - 0.28, z: -d / 2 + 0.13, color: OFFICE.nearBlack, mat: 'ink' });
}

/**
 * Mobile pedestal, 420 x 600 x 600, three drawers. Rolls under the desk.
 *
 * The catalogue has no pedestal — filing-cabinet-4 is 470 x 1320 and
 * chest-drawers-800 is domestic — so this one is drawn here, to the same
 * standard: a plinth-free castored carcass, drawer fronts PROUD of the case
 * with a shadow reveal between them, and a real D-pull rather than a flat tab.
 */
export function propPedestal(b, o = {}) {
  const w = 0.42, d = 0.60, h = 0.60;
  const col = o.color ?? OFFICE.charcoal;
  b.cboxUp(w, h - 0.075, d, { y: 0.075, color: col });
  // 3 drawers: 155 mm faces on a 5 mm reveal, standing 14 mm off the carcass
  for (let i = 0; i < 3; i++) {
    const y = 0.095 + i * 0.163;
    b.cboxUp(w - 0.012, 0.155, 0.016, { y, z: d / 2 - 0.002, color: col, shade: 1.14, c: 0.004 });
    // 140 mm D-pull: a bar on two stand-offs, so it casts its own shadow
    for (const sx of [-1, 1]) {
      b.cboxUp(0.014, 0.014, 0.026, { x: sx * 0.06, y: y + 0.098, z: d / 2 + 0.014,
        color: 0xd9d5ce, mat: 'metal', c: 0.003 });
    }
    b.cboxUp(0.148, 0.014, 0.014, { x: 0, y: y + 0.098, z: d / 2 + 0.033,
      color: 0xd9d5ce, mat: 'metal', c: 0.004 });
    // the little card holder every pedestal in every office has
    if (i === 0) b.cboxUp(0.06, 0.022, 0.004, { y: y + 0.03, z: d / 2 + 0.017, color: OFFICE.paper, mat: 'paper', c: 0.002 });
  }
  // top lip, 8 mm proud all round — the thing that stops it reading as a box
  b.cboxUp(w + 0.014, 0.018, d + 0.014, { y: h - 0.018, color: col, shade: 1.05, c: 0.005 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cylUp(0.024, 0.020, 0.048, 10, { x: sx * (w / 2 - 0.05), z: sz * (d / 2 - 0.06), color: OFFICE.nearBlack, mat: 'ink' });
    b.cyl(0.026, 0.026, 0.014, 8, { x: sx * (w / 2 - 0.05), z: sz * (d / 2 - 0.06), y: 0.026,
      rz: Math.PI / 2, color: 0x2a2825, mat: 'ink' });
  }
}

/** Task chair: seat 460, back to 1120, 5-star base on castors. */
export function propTaskChair(b, o = {}) {
  const seatH = 0.46;
  const fabric = o.color ?? 0xffffff;   // tinted per instance
  if (b.model(modelParts('taskChair'), { tint: fabric })) return;
  // 5-star base, 320 mm arms
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.at({ ry: a }, (q) => {
      q.boxUp(0.045, 0.035, 0.30, { z: 0.16, y: 0.055, color: 0xf0ece6, mat: 'metal' });
      q.cylUp(0.028, 0.028, 0.05, 8, { z: 0.30, y: 0.005, rx: Math.PI / 2, color: OFFICE.nearBlack, mat: 'ink' });
    });
  }
  b.cylUp(0.055, 0.045, seatH - 0.14, 10, { y: 0.09, color: 0xdedad3, mat: 'metal' });
  b.boxUp(0.28, 0.05, 0.30, { y: seatH - 0.10, color: OFFICE.charcoal, mat: 'ink' });   // mechanism
  b.boxUp(0.47, 0.075, 0.48, { y: seatH - 0.075, color: fabric });                  // seat pad
  b.boxUp(0.44, 0.06, 0.44, { y: seatH - 0.085, color: fabric, shade: 0.8 });
  // back: 430 wide, top at 1.12, raked 10 deg
  b.at({ y: seatH, z: -0.21, rx: -0.17 }, (q) => {
    q.boxUp(0.06, 0.30, 0.05, { color: OFFICE.charcoal, mat: 'ink' });
    q.boxUp(0.43, 0.40, 0.055, { y: 0.26, color: fabric });
    q.boxUp(0.40, 0.05, 0.07, { y: 0.62, color: fabric, shade: 1.1 });              // lumbar/head rail
  });
  // arms
  for (const sx of [-1, 1]) {
    b.at({ x: sx * 0.255, y: seatH - 0.04 }, (q) => {
      q.boxUp(0.035, 0.20, 0.05, { z: -0.05, color: OFFICE.charcoal, mat: 'ink' });
      q.boxUp(0.055, 0.025, 0.22, { y: 0.20, z: 0.01, color: OFFICE.nearBlack, mat: 'ink' });
    });
  }
}

/** Stacking meeting chair: 440 x 500, seat 450, back to 800. */
export function propStackChair(b, o = {}) {
  const c = o.color ?? 0xffffff;       // tinted per instance
  const seatH = 0.45;
  if (b.model(modelParts('stackChair'), { tint: c })) return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cylUp(0.014, 0.014, seatH - 0.02, 6, { x: sx * 0.185, z: sz * 0.20, color: 0xe2ded7, mat: 'metal' });
  }
  b.cboxUp(0.44, 0.035, 0.46, { y: seatH - 0.035, color: c, c: 0.005 });
  b.at({ y: seatH, z: -0.21, rx: -0.14 }, (q) => {
    q.cboxUp(0.40, 0.32, 0.03, { y: 0.06, color: c, c: 0.005 });
  });
}

/**
 * 24" monitor: panel 545 x 325, 8 mm bezel, 220 mm stand. Screen faces +z.
 *
 * This is the ONE object in the office that is deliberately NOT routed through
 * the catalogue even though monitor-24.glb exists and is good. desks.js hangs
 * the live in-game OS quad off MONITOR_SCREEN / MONITOR_ANCHOR below, and those
 * two constants encode where the bezel's aperture is. Swapping the bezel for a
 * mesh whose aperture sits somewhere else, without re-deriving both constants
 * from that mesh, is precisely the drift that put the whole OS under the desk
 * for three rounds (see the MONITOR_ANCHOR note). The numbers below are
 * therefore load-bearing: the bezel's front face stays at z = +0.011 so the
 * screen quad at z = 0.013 clears it, and its aperture stays centred on
 * MONITOR_SCREEN.y.
 */
export function propMonitor(b, o = {}) {
  const pw = o.w ?? 0.545, ph = o.h ?? 0.325;
  const stand = o.stand ?? 0.22;
  // oval foot, 220 x 160, 18 mm — flat-shaded 14-gon reads as a cast base
  b.at({ s: [1, 1, 0.72] }, (q) => q.ccylUp(0.11, 0.105, 0.018, 14, { color: OFFICE.nearBlack, mat: 'ink', c: 0.004 }));
  b.cboxUp(0.055, stand, 0.045, { y: 0.018, color: OFFICE.nearBlack, mat: 'ink', c: 0.005 });   // neck
  b.cboxUp(0.075, 0.03, 0.055, { y: stand - 0.01, color: OFFICE.charcoal, mat: 'ink', c: 0.004 }); // tilt hinge
  // Bezel: front face must stay at z = +0.011 (see the note above).
  b.cboxUp(pw + 0.016, ph + 0.016, 0.022, { y: stand + 0.02, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.004 });
  // chin behind the aperture
  b.cboxUp(pw + 0.016, 0.026, 0.030, { y: stand + 0.02, z: -0.012, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.004 });
  // No power LED on the front. MONITOR_SCREEN's aperture runs from the very
  // bottom of the bezel (y = stand + 0.02) to 16 mm below its top, so there is
  // no bottom border to put one in — anything placed there lands ON the live OS
  // quad at z = 0.013 and z-fights with it.
  // rear housing: a monitor is 55 mm deep at the middle and 22 at the edge
  b.cboxUp(pw * 0.62, ph * 0.60, 0.034, { y: stand + 0.02 + ph * 0.20, z: -0.028,
    color: OFFICE.charcoal, mat: 'ink', ao: false, c: 0.006 });
  // display cable, dropping behind the stand
  b.cyl(0.006, 0.006, 0.20, 6, { y: stand - 0.06, z: -0.046, rx: 0.35, color: OFFICE.nearBlack, mat: 'ink', ao: false });
}

/** The screen quad of a monitor, in MONITOR-LOCAL space (origin at the foot of
 *  the stand). Handled separately because it carries a live texture and must
 *  not be merged. Add MONITOR_ANCHOR to get workstation-local space. */
export const MONITOR_SCREEN = { w: 0.545, h: 0.325, y: 0.22 + 0.02 + 0.325 / 2, z: 0.013 };

/**
 * Where a monitor STANDS, relative to a workstation's floor origin: on the
 * 740 mm desk top, 280 mm back from the desk centre.
 *
 * This constant exists because the screen went missing for three rounds. The
 * monitor prop was placed by office.js at (0, 0.74, -0.28); the live screen
 * quad was parented to the workstation group at MONITOR_SCREEN.y alone, i.e.
 * 0.402 m above the FLOOR — 0.74 m too low and 0.28 m too far forward. The
 * whole in-game OS rendered under the desk and the click-to-focus flight landed
 * on the slab. Both placements now read this one object, so they cannot drift
 * apart again: office.js positions the bezel with it, desks.js hangs the screen
 * and its glow off it.
 */
export const MONITOR_ANCHOR = { y: 0.74, z: -0.28 };

/** The same, for the shallower 1.40 x 0.70 m cubicle desks. */
export const CUBICLE_MONITOR_ANCHOR = { y: 0.74, z: -0.24 };

/** Full-size keyboard, 440 x 135, on a 6 mm wedge. Keys, not a painted slab. */
export function propKeyboard(b, o = {}) {
  const W = 0.44, D = 0.135;
  b.cboxUp(W, 0.014, D, { color: OFFICE.charcoal, ao: false, c: 0.003 });
  b.cboxUp(W - 0.006, 0.008, D - 0.006, { y: 0.014, color: 0x2e2c29, ao: false, c: 0.002 });   // key well
  // Six key rows: function row, four alpha rows, space bar. Each row is drawn as
  // key blocks rather than a painted rectangle — at 0.6 m (the distance a seated
  // player sees it from) the gaps between keys are what makes it a keyboard.
  const rows = [
    { y: 0.0225, z: -0.049, h: 0.006, n: 13, kw: 0.0245, kd: 0.0085 },
    { y: 0.0235, z: -0.033, h: 0.008, n: 14, kw: 0.0228, kd: 0.0125 },
    { y: 0.0238, z: -0.018, h: 0.008, n: 13, kw: 0.0246, kd: 0.0125 },
    { y: 0.0240, z: -0.003, h: 0.008, n: 13, kw: 0.0246, kd: 0.0125 },
    { y: 0.0242, z: 0.012, h: 0.008, n: 12, kw: 0.0266, kd: 0.0125 },
  ];
  for (const r of rows) {
    const span = r.n * (r.kw + 0.0022);
    for (let i = 0; i < r.n; i++) {
      b.cboxUp(r.kw, r.h, r.kd, {
        x: -span / 2 + r.kw / 2 + i * (r.kw + 0.0022), y: r.y - r.h, z: r.z,
        color: 0x565350, ao: false, c: 0.0012,
      });
    }
  }
  b.cboxUp(0.135, 0.008, 0.0125, { y: 0.0166, z: 0.0295, color: 0x565350, ao: false, c: 0.0012 });  // space
  for (const x of [-0.115, 0.115]) {
    b.cboxUp(0.030, 0.008, 0.0125, { x, y: 0.0166, z: 0.0295, color: 0x4b4845, ao: false, c: 0.0012 });
  }
}

/** Optical mouse, 62 x 108 x 34. */
export function propMouse(b) {
  b.cboxUp(0.062, 0.020, 0.104, { color: OFFICE.charcoal, ao: false, c: 0.006 });
  // the shell: a domed top, tapered to the front, with the button split showing
  b.at({ y: 0.020 }, (q) => {
    q.sphere(0.045, 10, { y: -0.014, s: [0.68, 0.40, 1.16], color: OFFICE.charcoal, ao: false });
    q.cboxUp(0.0022, 0.010, 0.036, { y: 0.006, z: -0.030, color: 0x1a1917, ao: false, c: 0.0008 });  // split
    q.cboxUp(0.006, 0.008, 0.012, { y: 0.010, z: -0.034, color: 0x4a4744, ao: false, c: 0.002 });    // wheel
  });
}

/**
 * Architect's lamp: 550 mm reach, head at 620 mm. A real anglepoise — two
 * arms, three visible joints, a weighted base and a conical shade with a
 * bright inner face, so it reads as a lamp from any angle rather than as a
 * stick with a lump on it.
 */
export function propDeskLamp(b, o = {}) {
  const c = o.color ?? 0xffffff;       // tinted per instance
  if (b.model(modelParts('deskLamp'), { tint: c, ao: false })) return;
  b.ccylUp(0.078, 0.072, 0.022, 16, { color: c, ao: false, c: 0.004 });                 // weighted base
  b.cylUp(0.020, 0.020, 0.016, 10, { y: 0.022, color: OFFICE.steelDark, mat: 'metal', ao: false });  // pivot
  b.at({ y: 0.038 }, (q) => {
    q.cboxUp(0.020, 0.40, 0.020, { rz: -0.42, x: 0.07, color: c, ao: false, c: 0.004 });
    q.at({ x: 0.235, y: 0.365 }, (r) => {
      r.cylUp(0.017, 0.017, 0.020, 10, { y: -0.01, rz: Math.PI / 2, color: OFFICE.steelDark, mat: 'metal', ao: false });
      r.cboxUp(0.018, 0.32, 0.018, { rz: 1.02, x: 0.12, color: c, ao: false, c: 0.004 });
      r.at({ x: 0.28, y: 0.14, rz: -0.55 }, (s) => {
        s.cylUp(0.015, 0.015, 0.018, 10, { rz: Math.PI / 2, color: OFFICE.steelDark, mat: 'metal', ao: false });
        s.cyl(0.088, 0.046, 0.115, 14, { y: 0.058, color: c, ao: false, open: true });   // shade
        s.cyl(0.084, 0.044, 0.108, 14, { y: 0.058, color: 0xfff3de, mat: 'paper', ao: false, open: true, shade: 1.25 });
        s.cylUp(0.036, 0.036, 0.010, 10, { y: 0.006, color: 0xfff0d2, mat: 'paper', ao: false, shade: 1.5 });  // bulb
      });
    });
  });
}

/** Ceramic mug, 82 mm across, 95 tall, with a handle. */
export function propMug(b, o = {}) {
  const c = o.color ?? 0xffffff;       // tinted per instance
  // A MUG IS HOLLOW, AND THAT IS WHY YOU COULD NOT SEE THE COFFEE.
  //
  // "you cannot see the mug with the fill in it." The body was one SOLID
  // cylinder with a closed top, so the inside base and the coffee disc were
  // buried inside the geometry — the mug was a lump with a lid and there was
  // nothing to see into. It is now a wall you can look down: an open outer
  // tube, an open inner tube one wall-thickness in, a floor, and a rim ring
  // closing the gap between the two at the top.
  const RO = 0.041, RI = 0.0355, HT = 0.095;
  b.cyl(RO, 0.038, HT, 18, { y: HT / 2, color: c, mat: 'tile', ao: false, open: true });
  // ONE wall, not two. The open tube already renders both faces, so the far
  // side of it IS the inside of the mug; adding a second tube 5 mm inside it
  // only gave two rims at slightly different heights, which scalloped the top
  // edge into a row of teeth. The floor closes the bottom and that is all a
  // mug needs.
  b.cylUp(RI + 0.002, RI + 0.002, 0.010, 18, { y: 0.005, color: c, mat: 'tile', ao: false, shade: 0.88 });
  // The coffee sits 12 mm below the rim: near enough the top to read as a full
  // mug, far enough down to cast the inside into shadow the way a real one does.
  if (o.full) b.cylUp(RI - 0.002, RI - 0.002, 0.005, 16, { y: HT - 0.017, color: 0x3a2416, ao: false });
  // THE HANDLE IS A HALF-RING, and it has to be built like one.
  //
  // "the handle is made of cylinders and not a half-ring." It was already seven
  // links of an arc, but each link was rotated by `PI/2 - a*0.55`, which is not
  // the tangent of anything — so the links sat across the curve instead of
  // along it and the whole thing read as a lump stuck to the side. A cylinder
  // built along +Y is tangent to a circle at angle `a` when it is rotated about
  // Z by exactly `a`; that is the whole correction. Thirteen links on a true
  // circle, overlapping slightly so the arc is continuous, with a ball at each
  // end where it meets the wall.
  const HR = 0.024, HX = 0.0395, HY = 0.0475;   // arc radius and centre
  const A0 = -1.28, A1 = 1.28, N = 13;
  const seg = (HR * (A1 - A0)) / (N - 1) * 1.35;
  for (let i = 0; i < N; i++) {
    const a = A0 + (i / (N - 1)) * (A1 - A0);
    b.cylUp(0.0058, 0.0058, seg, 6, {
      x: HX + Math.cos(a) * HR, y: HY + Math.sin(a) * HR,
      rz: a, color: c, mat: 'tile', ao: false,
    });
  }
  for (const a of [A0, A1]) {
    b.add(new SphereGeometry(0.0062, 8, 6), {
      x: HX + Math.cos(a) * HR, y: HY + Math.sin(a) * HR, color: c, mat: 'tile', ao: false,
    });
  }
}

/** Pen cup: a 90 mm steel tube of pencils, scale rules and a rolled tracing pen. */
export function propPenCup(b, o = {}) {
  b.ccylUp(0.042, 0.044, 0.098, 14, { color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.004 });
  b.cylUp(0.036, 0.036, 0.004, 12, { y: 0.006, color: 0x54514c, mat: 'metal', ao: false });
  const cols = [ACCENT, OFFICE.charcoal, OFFICE.steel, 0xd8d2c6, OFFICE.charcoal, ACCENT, 0xb9ad96];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const len = 0.155 + (i % 3) * 0.016;
    b.at({ x: Math.cos(a) * 0.023, z: Math.sin(a) * 0.023, y: 0.03,
      rz: Math.cos(a) * 0.13, rx: Math.sin(a) * 0.13 }, (q) => {
      // hexagonal pencils, not round sticks — 6 sides is what a pencil has
      q.cylUp(0.0042, 0.0042, len, 6, { color: cols[i], ao: false });
      q.cylUp(0.0042, 0.0009, 0.011, 6, { y: len, color: 0xd9caa8, ao: false });   // sharpened tip
    });
  }
}

/** A stack of A4 (297 x 210). */
/**
 * A4 landscape, a stack of it. Round 2 was one box with three loose sheets on
 * top, and it read as paper only because of its proportions. A real stack is
 * NOT a solid: every edge of it is a stepped, ragged, slightly fanned profile,
 * and that profile is the whole reason you know what it is. So this is built as
 * six sub-blocks, each rotated a fraction of a degree off the one below, with
 * alternating warm/cool paper — plus the loose top sheets and one sheet that
 * has worked its way half out of the side.
 */
export function propPaperStack(b, o = {}) {
  const h = o.h ?? 0.03, ry0 = o.ry || 0;
  const layers = 6;
  const body = h - 0.006;
  for (let i = 0; i < layers; i++) {
    const t = body / layers;
    b.boxUp(0.297, t, 0.21, {
      y: i * t,
      ry: ry0 + (i - layers / 2) * 0.010,
      x: (i % 2 ? 0.0016 : -0.0012),
      z: (i % 3 === 0 ? 0.0014 : -0.0010),
      color: i % 2 ? OFFICE.paper : OFFICE.paperWarm,
      mat: 'paper', ao: false, shade: i % 2 ? 1.0 : 0.985,
    });
  }
  // one sheet worked half out of the side of the stack
  b.boxUp(0.297, 0.0016, 0.21, { y: body * 0.42, x: 0.026, z: 0.010, ry: ry0 + 0.075,
    color: OFFICE.paper, mat: 'paper', ao: false, shade: 1.04 });
  // three loose top sheets, each a hair out of square
  b.boxUp(0.297, 0.0022, 0.21, { y: body, ry: ry0 + 0.035, x: 0.004,
    color: OFFICE.paperWarm, mat: 'paper', ao: false });
  b.boxUp(0.297, 0.0022, 0.21, { y: body + 0.0022, ry: ry0 - 0.028, z: -0.005,
    color: OFFICE.paper, mat: 'paper', ao: false });
  b.boxUp(0.297, 0.0022, 0.21, { y: body + 0.0044, ry: ry0 + 0.06, x: -0.003,
    color: OFFICE.paper, mat: 'paper', ao: false, shade: 1.03 });
}

/** An A1 drawing rolled up: 75 mm across, 900 long. */
export function propRoll(b, o = {}) {
  const c = o.color ?? 0xffffff;
  b.cyl(0.037, 0.037, 0.90, 12, { color: c, mat: 'paper', ao: false });
  // the loose outer edge of the roll, and the elastic band round it
  b.cyl(0.0395, 0.0395, 0.86, 12, { color: c, mat: 'paper', ao: false, open: true, shade: 0.94 });
  b.cyl(0.0405, 0.0405, 0.016, 12, { y: 0.16, color: OFFICE.charcoal, mat: 'ink', ao: false, open: true });
}

/**
 * A5 hardback, 160 x 235 x 30, built the way a case-bound book is built.
 *
 * Round 2 drew this as one chamfered slab with a scored line down it, and a
 * critic called it the only prop in the office that genuinely still read as a
 * box. He was right. A shelved book is seen SPINE ON and almost nothing about
 * that view is flat: the spine is ROUNDED, the two cover boards stand proud of
 * the text block on all three free edges (the binder's "square"), there are
 * raised bands across the spine, a title panel in a different colour, and a
 * headband at the top. All seven of those are here now, and the whole thing is
 * still 500 triangles, which matters because 34 of them stand on the shelves.
 */
export function propBook(b, o = {}) {
  const t = o.t ?? 0.032, hh = o.hh ?? 0.235, d = 0.16;
  const cover = o.color ?? 0xffffff;
  const R = t / 2;
  // text block: 4 mm narrower and 8 mm shorter than the case on every free edge
  b.cboxUp(t - 0.005, hh - 0.009, d - 0.016, { y: 0.0045, z: 0.008,
    color: OFFICE.paper, mat: 'paper', ao: false, c: 0.0015 });
  // the fore-edge groove — one dark line is what makes a block read as pages
  b.boxUp(t - 0.007, hh - 0.014, 0.0016, { y: 0.007, z: d / 2 - 0.009,
    color: 0xb9b2a5, mat: 'paper', ao: false });
  // two cover boards
  for (const sx of [-1, 1]) {
    b.cboxUp(0.0026, hh, d, { x: sx * (R - 0.0013), color: cover, ao: false, c: 0.0012 });
  }
  // rounded spine, and the joint groove where the board hinges off it
  b.cylUp(R, R, hh, 10, { z: -d / 2 + R, color: cover, ao: false });
  for (const sx of [-1, 1]) {
    b.boxUp(0.0016, hh, 0.004, { x: sx * (R - 0.0035), z: -d / 2 + R + 0.010,
      color: cover, ao: false, shade: 0.72 });
  }
  // raised bands across the spine — the detail that says hardback, not paperback
  for (const y of [hh * 0.20, hh * 0.78]) {
    b.cylUp(R + 0.0013, R + 0.0013, 0.0055, 10, { y, z: -d / 2 + R, color: cover, ao: false, shade: 0.88 });
  }
  // title panel and two lines of lettering on it
  b.boxUp(t * 0.66, hh * 0.30, 0.0022, { y: hh * 0.40, z: -d / 2 + 0.0012,
    color: 0xe8e0cd, mat: 'paper', ao: false });
  for (const y of [hh * 0.48, hh * 0.56]) {
    b.boxUp(t * 0.42, 0.0045, 0.0012, { y, z: -d / 2 - 0.0004, color: 0x4a453d, mat: 'ink', ao: false });
  }
  // headband and tailband
  for (const y of [0.0015, hh - 0.006]) {
    b.cylUp(R - 0.0025, R - 0.0025, 0.0045, 8, { y, z: -d / 2 + R + 0.002,
      color: 0xb08a6a, mat: 'flat', ao: false });
  }
}

/**
 * A0 plan chest: 1370 x 960 x 900, ten shallow drawers. The one piece of
 * furniture every architect in the world recognises instantly, which is why it
 * is the object the target player will look at first and the one that has to be
 * right.
 *
 * The numbers are a real chest. A0 is 841 x 1189 mm, so a drawer has to take
 * 1189 in the x direction with a margin: internal width 1290 mm inside a 1370
 * carcass. Depth 960 takes the 841 dimension plus the runner. Ten drawers at a
 * 76.5 mm pitch gives a 55 mm clear internal drawer, which is the standard
 * shallow plan drawer — deep enough for a set of prints, shallow enough that
 * they lie flat.
 *
 * Round 1 drew this as a grey box with the entire drawer stack collapsed into
 * one black rectangle and NO handles: an architect looking at it sees a filing
 * block with no way to open it. What makes it read now is that the drawer
 * fronts stand 16 mm PROUD of the carcass, so each one throws its own shadow
 * line, and every drawer carries the two pulls and the card holder a plan chest
 * actually has.
 */
export const PLAN_CHEST = { w: 1.37, d: 0.96, h: 0.90, drawers: 10, pitch: 0.0765, first: 0.115 };

export function propPlanChest(b) {
  const { w, d, h, drawers, pitch, first } = PLAN_CHEST;
  const wood = OFFICE.walnutSoft;
  const brass = 0xc9b894;
  // plinth, recessed 30 mm so the case appears to float and catches a dark line
  b.cboxUp(w - 0.06, 0.10, d - 0.06, { color: wood, mat: 'wood-dark', shade: 0.62, c: 0.004 });
  // carcass
  b.cboxUp(w, h - 0.125, d, { y: 0.10, color: wood, mat: 'wood-dark', c: 0.005 });
  for (let i = 0; i < drawers; i++) {
    const y = first + i * pitch;
    // Drawer face: proud of the carcass, with a 10 mm reveal above and below.
    b.cboxUp(w - 0.028, pitch - 0.010, 0.016, { y, z: d / 2 - 0.002, color: wood, mat: 'wood-dark',
      shade: 1.12, c: 0.004 });
    // Two 130 mm brass D-pulls, on stand-offs, 600 mm apart — a 1.29 m drawer
    // is pulled with two hands and one central knob would rack it.
    for (const sx of [-1, 1]) {
      for (const dx of [-0.058, 0.058]) {
        b.cboxUp(0.013, 0.013, 0.024, { x: sx * 0.30 + dx, y: y + pitch / 2 - 0.008, z: d / 2 + 0.013,
          color: brass, mat: 'metal-warm', ao: false, c: 0.003 });
      }
      b.cboxUp(0.132, 0.013, 0.013, { x: sx * 0.30, y: y + pitch / 2 - 0.008, z: d / 2 + 0.031,
        color: brass, mat: 'metal-warm', ao: false, c: 0.004 });
    }
    // brass card holder in the middle, with a written label in it
    b.cboxUp(0.086, 0.030, 0.006, { y: y + pitch / 2 - 0.008, z: d / 2 + 0.015,
      color: brass, mat: 'metal-warm', ao: false, c: 0.002 });
    b.boxUp(0.074, 0.020, 0.002, { y: y + pitch / 2 - 0.003, z: d / 2 + 0.019,
      color: OFFICE.paper, mat: 'paper', ao: false });
    b.boxUp(0.044, 0.003, 0.001, { y: y + pitch / 2 + 0.001, z: d / 2 + 0.0205,
      color: 0x8b8478, mat: 'paper', ao: false });
  }
  // 25 mm top, overhanging 15 mm all round, in a paler board
  b.cboxUp(w + 0.030, 0.025, d + 0.030, { y: h - 0.025, color: wood, mat: 'wood-dark', shade: 1.14, c: 0.006 });
}

/**
 * Open shelving, 900 x 320 x 2100, five shelves.
 *
 * This is the ONE storage piece that is not routed to bookshelf-800.glb, and
 * the reason is numerical rather than aesthetic: office.js places 34 instanced
 * books ON these shelves, so the office needs the shelf heights, and taking
 * them from a mesh means inferring them from geometry. BOOKSHELF_SHELVES below
 * is exported so the two can never drift — office.js reads it instead of
 * repeating the five numbers.
 */
export const BOOKSHELF = { w: 0.90, d: 0.32, h: 2.10, shelves: 5, side: 0.022 };

// A dark WARM grey, not the near-black charcoal round 1 used. Two 2.1 m units of
// 0x3a3835 against a pale limewash wall read as two black rectangles whatever
// geometry is inside them, because nothing on the carcass was more than 8/255
// away from anything else on it. At 0x514c46 with the shelf noses at shade 1.45
// the shelves separate from the back and the unit still holds the dark end of
// the luminance range (finish bar item 8).
const SHELF_CARCASS = 0x514c46;

/** The y of each shelf's TOP face, in prop-local metres. office.js stands books on these. */
export function bookshelfShelves(o = {}) {
  const h = o.h ?? BOOKSHELF.h, n = o.shelves ?? BOOKSHELF.shelves;
  const out = [];
  for (let i = 1; i <= n; i++) out.push((h - 0.05) * (i / (n + 1)));
  return out;
}

export function propBookshelf(b, o = {}) {
  const w = o.w ?? BOOKSHELF.w, d = BOOKSHELF.d, h = o.h ?? BOOKSHELF.h;
  const side = BOOKSHELF.side;
  const carc = o.color ?? SHELF_CARCASS;
  // plinth, so it does not sit flush on the slab
  b.cboxUp(w - 0.05, 0.055, d - 0.04, { color: carc, mat: 'ink', shade: 0.6, c: 0.004 });
  // sides, full height, with the front edge chamfered
  for (const sx of [-1, 1]) {
    b.cboxUp(side, h - 0.055, d, { x: sx * (w / 2 - side / 2), y: 0.055, color: carc, mat: 'ink', c: 0.004 });
  }
  // back panel, set into a rebate and shaded — this is the surface that stops a
  // bookcase reading as a black slab with lines in it
  b.cboxUp(w - 2 * side, h - 0.10, 0.010, { y: 0.055, z: -d / 2 + 0.008,
    color: carc, mat: 'ink', shade: 0.62, c: 0.003 });
  // top, overhanging 8 mm
  b.cboxUp(w + 0.008, 0.028, d + 0.008, { y: h - 0.028, color: carc, mat: 'ink', shade: 1.12, c: 0.005 });
  // bottom board
  b.cboxUp(w - 2 * side, 0.020, d - 0.014, { y: 0.055, z: 0.006, color: carc, mat: 'ink', shade: 0.86, c: 0.004 });
  for (const y of bookshelfShelves(o)) {
    b.cboxUp(w - 2 * side, 0.022, d - 0.014, { y: y - 0.022, z: 0.006, color: carc, mat: 'ink', shade: 1.18, c: 0.004 });
    // 3 mm nose lip on the front edge, the detail that catches the key light
    b.cboxUp(w - 2 * side, 0.026, 0.006, { y: y - 0.024, z: d / 2 - 0.003, color: carc, mat: 'ink', shade: 1.45, c: 0.002 });
  }
}

/**
 * A0 roll plotter on its stand: 1380 x 600 x 930 (HP DesignJet class).
 *
 * The catalogue's printer-mfp is an A4 office multifunction, a completely
 * different machine, so this stays procedural. What makes it a plotter and not
 * a white box on sticks: the paper OUTPUT SLOT across the front, the roll on
 * its spindle behind, the control panel at the right-hand end, the ink-cartridge
 * door at the left, and the fabric catch basket slung under it.
 */
export function propPlotter(b) {
  const w = 1.38, d = 0.60, h = 0.93;
  const body = 0xe2ded6;
  // stand: four legs, a cross brace and castors
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cboxUp(0.042, h - 0.30, 0.042, { x: sx * (w / 2 - 0.14), z: sz * 0.18, y: 0.05,
        color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
      b.cylUp(0.030, 0.026, 0.05, 10, { x: sx * (w / 2 - 0.14), z: sz * 0.18, color: OFFICE.nearBlack, mat: 'ink' });
    }
    b.cboxUp(0.036, 0.036, 0.40, { x: sx * (w / 2 - 0.14), y: 0.16, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
  }
  b.cboxUp(w - 0.24, 0.030, 0.030, { y: 0.20, z: -0.18, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
  // catch basket: two rails and a slung sheet of fabric
  for (const sz of [-0.02, 0.30]) {
    b.cyl(0.010, 0.010, w - 0.26, 8, { y: 0.30 + (sz > 0 ? 0.04 : 0), z: sz, rz: Math.PI / 2,
      color: OFFICE.steelDark, mat: 'metal' });
  }
  b.boxUp(w - 0.26, 0.010, 0.34, { y: 0.275, z: 0.14, rx: 0.16, color: OFFICE.woolDk });
  // Round 3: three finished prints lying in the basket, and a consumables shelf
  // between the legs. At gameplay distance the round-2 plotter read as "a white
  // box on four thin legs" — the close-up detail was all there and none of it
  // was doing anything for the silhouette. What it needed was a DARK MASS under
  // the pale body, which is what a basket with work in it and a low shelf give.
  for (let i = 0; i < 3; i++) {
    b.cyl(0.034, 0.034, w - 0.42 - i * 0.08, 10, {
      x: (i - 1) * 0.03, y: 0.305 + (i === 1 ? 0.030 : 0), z: 0.10 + i * 0.075, rz: Math.PI / 2, rx: 0.16,
      color: i === 1 ? OFFICE.paperWarm : OFFICE.paper, mat: 'paper', ao: false,
    });
  }
  b.cboxUp(w - 0.30, 0.018, 0.34, { y: 0.10, z: 0.02, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
  for (const [sx, bw] of [[-0.28, 0.30], [0.16, 0.36]]) {
    b.cboxUp(bw, 0.085, 0.26, { x: sx, y: 0.118, z: 0.02, color: 0xbca88c, c: 0.005 });   // media boxes
    b.cboxUp(bw * 0.5, 0.030, 0.002, { x: sx, y: 0.152, z: 0.151, color: OFFICE.paper, mat: 'paper', ao: false, c: 0.002 });
  }
  // power lead, down the back leg and away along the skirting
  b.cyl(0.006, 0.006, 0.52, 6, { x: w / 2 - 0.12, y: 0.34, z: -d / 2 - 0.02, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.cyl(0.006, 0.006, 0.30, 6, { x: w / 2 - 0.02, y: 0.010, z: -d / 2 - 0.02, rz: Math.PI / 2, rx: 0.2,
    color: OFFICE.nearBlack, mat: 'ink', ao: false });
  // body: 260 mm deep shell with a lid, on the classic plotter proportions
  b.cboxUp(w, 0.24, d, { y: h - 0.27, color: body, c: 0.010 });
  // Chassis band and the two moulded end covers.
  //
  // Round 3 gave this machine a slot, a roll, a panel, a basket and a shelf,
  // and at gameplay distance a critic still called it "a white box on four thin
  // legs". He was reading the SILHOUETTE, and the silhouette was one pale
  // rectangle 1.38 m long, because every detail on it was a seam or a recess
  // in the same colour. Detail that is the same value as its background does
  // nothing beyond about three metres. What a large-format plotter actually has
  // — and what breaks the rectangle into three masses at any distance — is dark
  // moulded end covers and a dark chassis band under the pale shell.
  b.cboxUp(w - 0.03, 0.036, d - 0.02, { y: h - 0.303, color: OFFICE.steelDark, mat: 'metal', c: 0.006 });
  for (const sx of [-1, 1]) {
    b.cboxUp(0.115, 0.250, d + 0.008, { x: sx * (w / 2 - 0.055), y: h - 0.275,
      color: OFFICE.steelDark, mat: 'metal', c: 0.008 });
  }
  b.cboxUp(w - 0.012, 0.045, d - 0.012, { y: h - 0.045, color: body, shade: 1.06, c: 0.008 });  // lid
  b.boxUp(w - 0.012, 0.003, 0.004, { y: h - 0.047, z: d / 2 - 0.05, color: 0x9a968f, ao: false }); // lid seam
  // THE detail: a full-width paper output slot, recessed and dark
  b.cboxUp(w - 0.30, 0.045, 0.020, { y: h - 0.145, z: d / 2 - 0.004,
    color: 0x1a1816, mat: 'ink', ao: false, c: 0.004 });
  b.cboxUp(w - 0.28, 0.014, 0.014, { y: h - 0.108, z: d / 2 + 0.002,
    color: 0x6f6b64, mat: 'metal', ao: false, c: 0.003 });                                       // cutter rail
  // A sheet leaving the slot: a short lip, then a drape that HANGS.
  //
  // It used to be a single 0.26 m plate at rx 0.42 — 24 degrees off horizontal,
  // i.e. a flat white shelf sticking 0.11 m straight out of the front of the
  // machine at the exact height of the slot. In the shipped teapoint frame it
  // covered the slot it was supposed to be coming out of and read as a broken
  // panel. A1 paper leaving a plotter falls; it does not cantilever.
  b.boxUp(0.60, 0.0016, 0.075, { x: -0.10, y: h - 0.150, z: d / 2 + 0.036, rx: 0.30,
    color: OFFICE.paper, mat: 'paper', ao: false, shade: 1.04 });
  b.boxUp(0.60, 0.0016, 0.235, { x: -0.10, y: h - 0.278, z: d / 2 + 0.090, rx: 1.24,
    color: OFFICE.paper, mat: 'paper', ao: false, shade: 1.02 });
  b.boxUp(0.44, 0.0012, 0.012, { y: h - 0.388, x: -0.10, z: d / 2 + 0.128, rx: 1.24,
    color: 0x8b8478, mat: 'paper', ao: false });
  // Control panel, ON the lid at the right-hand end.
  //
  // It was authored at y = h - 0.055 = 0.875 and is 16 mm thick, while the lid
  // spans 0.885 to 0.930 over the same footprint — so the whole panel, screen,
  // buttons and the one ACCENT-coloured key were sealed INSIDE the machine and
  // had never once been drawn. That is why the close-up reads as a blank shell.
  b.at({ x: w / 2 - 0.21, y: h + 0.001, z: d / 2 - 0.16, rx: -0.55 }, (q) => {
    // A moulded pod in the machine's own grey with a dark screen inset — not a
    // black plate. Authored dark all over, the first version read from across
    // the room as a rectangular HOLE punched in the lid.
    q.cboxUp(0.24, 0.018, 0.14, { color: 0x8d8981, mat: 'metal', ao: false, c: 0.005 });
    q.cboxUp(0.145, 0.008, 0.082, { y: 0.017, z: -0.016, color: 0x2b3b46, mat: 'ink', ao: false, c: 0.003 });
    q.cboxUp(0.115, 0.004, 0.056, { y: 0.024, z: -0.016, color: 0x6f97a8, mat: 'ink', ao: false, c: 0.002 });
    for (let i = 0; i < 4; i++) {
      q.cboxUp(0.016, 0.006, 0.016, { x: -0.075 + (i % 2) * 0.028, z: 0.042 - Math.floor(i / 2) * 0.026,
        y: 0.016, color: i === 0 ? ACCENT : 0x8d8981, mat: 'ink', ao: false, c: 0.002 });
    }
  });
  // ink-cartridge door at the left, with its seam and finger pull
  b.cboxUp(0.30, 0.17, 0.014, { x: -w / 2 + 0.20, y: h - 0.245, z: d / 2 - 0.001,
    color: body, shade: 1.05, c: 0.004 });
  b.cboxUp(0.07, 0.012, 0.010, { x: -w / 2 + 0.20, y: h - 0.115, z: d / 2 + 0.010,
    color: 0x8d8981, mat: 'metal', ao: false, c: 0.003 });
  // paper roll on its spindle behind, with the end caps
  b.cyl(0.072, 0.072, w - 0.30, 14, { y: h - 0.20, z: -d / 2 - 0.045, rz: Math.PI / 2,
    color: OFFICE.paperWarm, mat: 'paper' });
  for (const sx of [-1, 1]) {
    b.cyl(0.052, 0.052, 0.05, 10, { x: sx * (w / 2 - 0.125), y: h - 0.20, z: -d / 2 - 0.045,
      rz: Math.PI / 2, color: OFFICE.charcoal, mat: 'ink' });
  }
}

/**
 * Meeting table 2400 x 1000 x 740, solid timber on a trestle frame.
 *
 * table-meeting-8.glb loads cleanly and was rendered side by side with this —
 * and lost. The catalogue table is a pale top on four plain square legs; this
 * one is a warm walnut top on splayed steel trestles, which has a silhouette
 * and gives the meeting corner its one piece of dark timber. Routing to the
 * catalogue is worth doing where the catalogue is better, not on principle.
 */
export function propMeetingTable(b, o = {}) {
  const w = 2.40, d = 1.00, h = 0.74;
  b.cboxUp(w, 0.04, d, { y: h - 0.04, color: OFFICE.walnutSoft, mat: 'wood-dark', c: 0.005 });
  b.cboxUp(w - 0.60, 0.09, 0.09, { y: h - 0.16, color: OFFICE.steelDark, mat: 'metal', c: 0.005 });
  for (const sx of [-1, 1]) {
    b.at({ x: sx * (w / 2 - 0.32) }, (q) => {
      q.cboxUp(0.06, h - 0.05, 0.06, { x: -0.14, rz: 0.10, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
      q.cboxUp(0.06, h - 0.05, 0.06, { x: 0.14, rz: -0.10, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
      q.cboxUp(0.06, h - 0.05, 0.06, { z: -0.32, rx: -0.10, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
      q.cboxUp(0.06, h - 0.05, 0.06, { z: 0.32, rx: 0.10, color: OFFICE.steelDark, mat: 'metal', c: 0.004 });
    });
  }
}

/** Ficus in a pot: pot 360 across, 1750 overall. Muted foliage on purpose. */
export function propPlantLarge(b, o = {}) {
  const H = o.h ?? 1.75;
  // Two catalogue species, so the room's two large plants are not clones.
  // models.js re-colours the GLB foliage to the studio greens (s 0.17) on the
  // way in — the catalogue's own s 0.44 green would be a second saturated hue.
  const key = (o.variant ?? ((o.seed ?? 3) % 2)) ? 'plantMonstera' : 'plantFicus';
  if (b.modelSized(key, { h: H })) return;
  b.ccylUp(0.16, 0.19, 0.34, 14, { color: OFFICE.ceramic, mat: 'tile', shade: 0.95, c: 0.008 });
  b.cylUp(0.175, 0.175, 0.03, 12, { y: 0.31, color: OFFICE.soil });
  b.cylUp(0.030, 0.022, H - 0.60, 6, { y: 0.32, color: 0x6b5f4e });
  let seed = o.seed ?? 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 13; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.16 + rnd() * 0.30;
    const y = H - 0.95 + rnd() * 0.88;
    b.at({ x: Math.cos(a) * r, z: Math.sin(a) * r, y, ry: a, rz: (rnd() - 0.5) * 0.7 }, (q) => {
      q.add(new BoxGeometry(0.30, 0.012, 0.17), {
        color: i % 3 === 0 ? OFFICE.leafDark : OFFICE.leaf, rx: (rnd() - 0.5) * 0.6, ao: false,
      });
    });
  }
}

/**
 * Small potted plant, 320 mm overall. Procedural on purpose.
 *
 * plant-pot-small.glb is the ONE catalogue model this pass rejected on
 * inspection rather than on paper: rendered close up it has four dark holes
 * punched through the wall of the pot (missing or inverted faces, not a
 * pattern), a crumpled self-intersecting rim, and foliage that is a bundle of
 * square brown sticks with a handful of near-black quads on top. It is reported
 * for the catalogue to fix; assets/models is not this agent's to edit. Its two
 * big siblings, plant-ficus-large and plant-monstera, are clean and ARE used.
 *
 * So this is drawn here, properly: a tapered chamfered pot with a rim, a soil
 * surface below it, and a rosette of real leaves — each a two-segment tapered
 * blade that bends over, with a midrib, so the plant has a silhouette instead
 * of a spray of flat blades.
 */
export function propPlantSmall(b, o = {}) {
  const potH = 0.135;
  b.ccylUp(0.068, 0.082, potH, 14, { color: o.pot ?? OFFICE.ceramic, mat: 'tile', ao: false, c: 0.006 });
  b.cyl(0.088, 0.088, 0.016, 14, { y: potH - 0.008, color: o.pot ?? OFFICE.ceramic, mat: 'tile', ao: false, shade: 1.06 });
  b.cylUp(0.076, 0.076, 0.012, 14, { y: potH - 0.020, color: OFFICE.soil, ao: false });
  let seed = o.seed ?? 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
    const lean = 0.32 + rnd() * 0.42;
    const L = 0.085 + rnd() * 0.032;
    const green = i % 3 === 0 ? OFFICE.leafDark : (i % 3 === 1 ? OFFICE.leaf : 0x87907a);
    b.at({ y: potH - 0.012, ry: a, rz: lean }, (q) => {
      // stalk
      q.cylUp(0.0035, 0.0028, L * 0.7, 5, { color: 0x6f6a53, ao: false });
      // blade, in two segments so it arches over instead of standing rigid
      q.at({ y: L * 0.7 }, (r) => {
        r.cboxUp(0.030, L, 0.006, { color: green, ao: false, c: 0.002 });
        r.cboxUp(0.0035, L * 0.94, 0.008, { y: 0.002, color: green, ao: false, shade: 1.18, c: 0.0012 });  // midrib
        r.at({ y: L, rz: 0.62 }, (s) => {
          s.cboxUp(0.024, L * 0.72, 0.005, { color: green, ao: false, shade: 0.92, c: 0.002 });
        });
      });
    });
  }
}

/**
 * Bean-to-cup machine, 300 x 420 x 400. THE accent object #1.
 *
 * Not routed to espresso-machine.glb: that is a 750 mm two-group café machine
 * in chrome and graphite, and swapping it in would both overrun the 600 mm
 * counter and delete one of the room's four accent uses, which finish bar item
 * 10 counts. Drawn here instead, with the parts that make it a machine: a bean
 * hopper, a brew group with a spout, a cup tray, a drip grid and a display.
 */
export function propCoffeeMachine(b) {
  b.cboxUp(0.30, 0.34, 0.42, { color: ACCENT, ao: false, c: 0.008 });
  b.cboxUp(0.30, 0.06, 0.42, { y: 0.34, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.006 });
  b.cboxUp(0.26, 0.02, 0.02, { y: 0.36, z: 0.20, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.004 });
  b.ccylUp(0.072, 0.078, 0.10, 14, { y: 0.40, z: -0.06, color: 0x3a3430, mat: 'glass', ao: false, c: 0.005 }); // hopper
  b.cylUp(0.052, 0.052, 0.012, 12, { y: 0.50, z: -0.06, color: OFFICE.nearBlack, mat: 'ink', ao: false });     // hopper lid
  // cup recess: the machine's whole front is a dark void with the group above it
  b.cboxUp(0.19, 0.145, 0.10, { y: 0.085, z: 0.176, color: 0x8a4a24, mat: 'ink', ao: false, shade: 0.55, c: 0.004 });
  b.cboxUp(0.185, 0.010, 0.095, { y: 0.085, z: 0.178, color: OFFICE.steel, mat: 'metal', ao: false, c: 0.002 }); // drip grid
  for (let i = 0; i < 5; i++) {
    b.boxUp(0.175, 0.003, 0.006, { y: 0.096, z: 0.145 + i * 0.018, color: 0x4a4744, mat: 'metal', ao: false });
  }
  b.cboxUp(0.075, 0.055, 0.045, { y: 0.185, z: 0.185, color: OFFICE.steel, mat: 'metal', ao: false, c: 0.004 }); // brew group
  for (const sx of [-1, 1]) {
    b.cylUp(0.008, 0.006, 0.026, 8, { x: sx * 0.018, y: 0.163, z: 0.196, color: OFFICE.steelDark, mat: 'metal', ao: false });
  }
  b.cboxUp(0.115, 0.058, 0.008, { y: 0.245, z: 0.208, color: 0x243038, mat: 'ink', ao: false, c: 0.003 });   // display
  b.cboxUp(0.095, 0.040, 0.002, { y: 0.254, z: 0.213, color: 0x4e6f7d, mat: 'ink', ao: false, shade: 1.3, c: 0.001 });
  for (let i = 0; i < 3; i++) {
    b.cylUp(0.010, 0.010, 0.008, 10, { x: -0.085 + i * 0.085, y: 0.29, z: 0.212, rx: Math.PI / 2,
      color: 0xe6e2da, mat: 'metal', ao: false });
  }
}

/** 1.7 l kettle, 180 x 220 over the spout. Steel body, black lid and handle. */
export function propKettle(b) {
  b.ccylUp(0.085, 0.076, 0.014, 14, { color: OFFICE.charcoal, mat: 'ink', ao: false, c: 0.004 });  // power base
  // Brushed steel reads as CHARCOAL at OFFICE.steel: a metalness-0.85 surface
  // has no diffuse term, so its brightness is entirely the environment map at
  // 0.22 intensity. Steel objects therefore have to be authored near-white to
  // land on the grey a kettle actually is.
  b.ccylUp(0.076, 0.068, 0.185, 14, { y: 0.014, color: 0xe4e0d9, mat: 'metal', ao: false, c: 0.006 });
  // water gauge: a dark slot down one side, which is the detail that says kettle
  b.cboxUp(0.020, 0.115, 0.012, { x: 0.066, y: 0.042, color: 0x3e4a4c, mat: 'glass', ao: false, c: 0.003 });
  // lid with a hinge and a lift knob
  b.ccylUp(0.070, 0.062, 0.020, 14, { y: 0.199, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.005 });
  b.ccylUp(0.020, 0.016, 0.016, 10, { y: 0.219, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.004 });
  // spout: a tapered pour lip on the +z side, angled up
  b.at({ z: 0.062, y: 0.150, rx: -0.55 }, (q) => {
    q.cylUp(0.026, 0.014, 0.070, 10, { color: 0xe4e0d9, mat: 'metal', ao: false });
    q.cylUp(0.015, 0.012, 0.010, 10, { y: 0.068, color: 0xe4e0d9, mat: 'metal', ao: false, shade: 1.1 });
  });
  // Handle: a real C standing 55 mm clear of the body on the -z side — a lower
  // arm, an upright you could get four fingers through, and an upper arm into
  // the lid collar, with the on/off switch on the top of it.
  b.cboxUp(0.026, 0.020, 0.062, { z: -0.098, y: 0.050, rx: -0.35, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.005 });
  b.cboxUp(0.026, 0.120, 0.022, { z: -0.126, y: 0.062, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.005 });
  b.cboxUp(0.026, 0.022, 0.070, { z: -0.096, y: 0.176, rx: 0.28, color: OFFICE.nearBlack, mat: 'ink', ao: false, c: 0.005 });
  b.cboxUp(0.020, 0.012, 0.028, { z: -0.126, y: 0.182, color: 0x55524d, mat: 'ink', ao: false, c: 0.003 });
}

/** Waste bin, 300 across, 400 tall. */
export function propBin(b) {
  if (b.model(modelParts('bin'), { tint: 0x8b877f })) return;
  const R = 0.15;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.cylUp(0.005, 0.005, 0.36, 4, { x: Math.cos(a) * R, z: Math.sin(a) * R, color: OFFICE.charcoal, mat: 'metal' });
  }
  // Horizontal hoops. The rx: PI/2 that used to be here stood each hoop on its
  // EDGE, so a 300 mm bin measured 600 mm tall and 100 mm of it was below the
  // floor — visible in the prop sheet's bbox check as "off the floor".
  for (const y of [0.05, 0.20, 0.345]) {
    b.cyl(R, R, 0.008, 20, { y, color: OFFICE.charcoal, mat: 'metal', open: true });
  }
  b.cylUp(R - 0.01, R - 0.01, 0.008, 16, { y: 0.01, color: OFFICE.charcoal, mat: 'metal' });
}

/**
 * A ball of A4 that missed the bin. Round 1 scattered five axis-aligned boxes
 * and rendered as white specks; a crumpled sheet is a faceted BALL, so this is
 * a small sphere of flat panels at random attitudes, plus two sheet corners
 * still sticking out — which is what tells the eye it is paper and not a stone.
 */
export function propCrumpledPaper(b, o = {}) {
  let seed = o.seed ?? 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const R = o.r ?? 0.048;
  for (let i = 0; i < 13; i++) {
    // Fibonacci sphere: even coverage, so the silhouette is round from any angle
    const y = 1 - (i / 12) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.39996;
    const j = 0.78 + rnd() * 0.34;
    b.add(new BoxGeometry(R * 1.15, R * 0.24, R * 1.15), {
      x: Math.cos(th) * rad * R * 0.52, y: R + y * R * 0.52, z: Math.sin(th) * rad * R * 0.52,
      rx: Math.acos(Math.max(-1, Math.min(1, y))) + (rnd() - 0.5) * 0.5, ry: th, rz: (rnd() - 0.5) * 0.8,
      s: [j, 1, j], color: rnd() > 0.7 ? OFFICE.paperWarm : OFFICE.paper, mat: 'paper', ao: false,
    });
  }
  for (const [ry, rz] of [[0.6, 0.9], [2.4, -0.7]]) {
    b.boxUp(R * 1.1, 0.0016, R * 0.8, { x: Math.cos(ry) * R * 0.5, z: Math.sin(ry) * R * 0.5,
      y: R * 0.8, ry, rz, color: OFFICE.paper, mat: 'paper', ao: false });
  }
}

/**
 * Whiteboard, 2000 x 1200 in an anodised aluminium frame with a full-width pen
 * tray. Origin at the WALL, facing +z, like the corkboard.
 *
 * Added in round 3 for finish bar items 1 and 13. The east wall carried the
 * plotter, two bookcases and the tea point and NOTHING between them, so
 * POSES.teapoint was half featureless plaster and counted 9 prop types against
 * a floor of 16. A whiteboard is what is actually on that wall in a studio, it
 * is the largest single object you can hang without competing with the pin-up
 * wall, and its white field is a light mass that balances the dark bookcases.
 */
export function propWhiteboard(b, o = {}) {
  const w = o.w ?? 2.00, h = o.h ?? 1.20;
  const alu = 0xc8c5bf;
  // frame: four rails, mitred, 26 mm face
  for (const sy of [-1, 1]) {
    b.cbox(w, 0.026, 0.030, { y: sy * (h / 2 - 0.013), z: 0.015, color: alu, mat: 'metal', ao: false, c: 0.003 });
  }
  for (const sx of [-1, 1]) {
    b.cbox(0.026, h - 0.052, 0.030, { x: sx * (w / 2 - 0.013), z: 0.015, color: alu, mat: 'metal', ao: false, c: 0.003 });
  }
  // the board itself, set 4 mm back so the frame casts a line onto it
  b.box(w - 0.052, h - 0.052, 0.008, { z: 0.022, color: 0xf4f2ee, mat: 'tile', ao: false });
  // What is on it. A studio whiteboard is never clean: a boxed programme
  // diagram, a section sketch, a column of dates and a half-erased smear.
  const ink = 0x54504a, red = 0x9c6a4c;
  const L = (x, y, lw, lh, c = ink) =>
    b.box(lw, lh, 0.0008, { x, y, z: 0.0265, color: c, mat: 'ink', ao: false, shade: 1.6 });
  L(-w * 0.26, h * 0.30, w * 0.30, 0.007);                 // a boxed diagram
  L(-w * 0.26, h * 0.02, w * 0.30, 0.007);
  L(-w * 0.41, h * 0.16, 0.007, h * 0.28);
  L(-w * 0.11, h * 0.16, 0.007, h * 0.28);
  L(-w * 0.26, h * 0.16, w * 0.30, 0.006);
  L(-w * 0.33, h * 0.24, w * 0.10, 0.005, red);
  for (let i = 0; i < 4; i++) L(w * 0.10, h * 0.30 - i * 0.075, w * 0.20 - i * 0.018, 0.005);
  L(w * 0.30, -h * 0.06, w * 0.22, 0.006, red);            // a section line
  L(w * 0.30, -h * 0.13, w * 0.16, 0.005);
  b.box(w * 0.26, h * 0.20, 0.0006, { x: -w * 0.02, y: -h * 0.26, z: 0.0262,
    color: 0xe4e1db, mat: 'tile', ao: false });            // a rubbed-out patch
  // pen tray, then three markers and an eraser standing in it
  b.cbox(w * 0.86, 0.020, 0.055, { y: -h / 2 - 0.010, z: 0.040, color: alu, mat: 'metal', ao: false, c: 0.004 });
  b.cbox(w * 0.86, 0.030, 0.008, { y: -h / 2 - 0.004, z: 0.066, color: alu, mat: 'metal', ao: false, c: 0.003 });
  const pens = [[-0.34, 0x3c3936], [-0.26, red], [-0.18, 0x4e6a6a]];
  for (const [px, pc] of pens) {
    b.cyl(0.008, 0.008, 0.125, 8, { x: px, y: -h / 2 + 0.005, z: 0.048, rz: Math.PI / 2,
      color: pc, mat: 'ink', ao: false });
  }
  b.cboxUp(0.11, 0.032, 0.045, { x: 0.30, y: -h / 2 + 0.002, z: 0.040,
    color: 0x6d6a64, mat: 'flat', ao: false, c: 0.004 });  // eraser
  // two magnets holding a print on the board
  b.box(0.21, 0.297, 0.0012, { x: w * 0.36, y: h * 0.22, z: 0.0272, color: OFFICE.paper, mat: 'paper', ao: false });
  for (const mx of [-0.07, 0.07]) {
    b.cylUp(0.011, 0.011, 0.006, 10, { x: w * 0.36 + mx, y: h * 0.36, z: 0.0278,
      rx: Math.PI / 2, color: ACCENT, mat: 'ink', ao: false });
  }
}

/**
 * Coat rail: an oak batten with five steel hooks and two coats on it.
 * Origin at the WALL, at the height of the batten, facing +z.
 *
 * Item 2 counts "lived-in clutter, objects with no structural function".
 * Nothing says a room is used by people like their coats being in it.
 */
export function propCoatRail(b, o = {}) {
  const w = o.w ?? 1.10;
  b.cbox(w, 0.090, 0.022, { z: 0.011, color: OFFICE.oakPale, mat: 'wood-light', ao: false, c: 0.004 });
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 0.14 + i * (w - 0.28) / 4;
    b.cbox(0.014, 0.016, 0.070, { x, y: -0.004, z: 0.055, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
    b.cbox(0.014, 0.040, 0.014, { x, y: -0.030, z: 0.083, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
  }
  // Two coats, hung on a hanger each. The silhouette is the whole job: narrow
  // collar, a shoulder line twice as wide, sleeves that hang OUTSIDE the body
  // and a hem. Six volumes each, and at 4 m it reads as a coat rather than as
  // a dark slab — which is what the first attempt at this looked like.
  const coats = [[-w * 0.26, 0x74786f, 0.84], [w * 0.16, 0x836f5e, 0.70]];
  for (const [cx, cc, len] of coats) {
    b.at({ x: cx, y: -0.030, z: 0.086 }, (q) => {
      q.cbox(0.030, 0.055, 0.030, { y: -0.020, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.004 }); // hanger hook
      q.cbox(0.090, 0.070, 0.070, { y: -0.078, color: cc, shade: 1.06, c: 0.008 });        // collar
      q.cbox(0.315, 0.080, 0.100, { y: -0.150, color: cc, shade: 1.02, c: 0.012 });        // shoulders
      q.cbox(0.285, len, 0.092, { y: -0.190 - len / 2, color: cc, c: 0.012 });             // body
      for (const sx of [-1, 1]) {
        q.cbox(0.072, len * 0.72, 0.082, { x: sx * 0.170, y: -0.200 - len * 0.36,
          rz: sx * 0.035, color: cc, shade: 0.92, c: 0.008 });                             // sleeves
      }
      q.cbox(0.285, 0.016, 0.098, { y: -0.190 - len, color: cc, shade: 0.80, c: 0.005 });  // hem
      q.cbox(0.075, 0.012, 0.006, { x: 0.070, y: -0.190 - len * 0.55, z: 0.047,
        color: cc, shade: 0.86, c: 0.003 });                                               // pocket welt
      q.cbox(0.075, 0.012, 0.006, { x: -0.070, y: -0.190 - len * 0.55, z: 0.047,
        color: cc, shade: 0.86, c: 0.003 });
    });
  }
}

/**
 * Wall clock, 300 mm. Steel rim, cream face, black hands, one accent second
 * hand. Reads at 6 m as a clock and at 1 m as a real one — the ticks are on the
 * face, not printed on a texture, because nothing in this office is textured.
 */
export function propWallClock(b, o = {}) {
  const R = o.r ?? 0.150;
  b.cylUp(R, R, 0.040, 24, { y: -0.020, rx: Math.PI / 2, z: 0.020, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cylUp(R - 0.012, R - 0.012, 0.006, 24, { rx: Math.PI / 2, z: 0.044, y: 0.003,
    color: 0xf3efe6, mat: 'flat', ao: false });
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, big = i % 3 === 0;
    b.box(big ? 0.014 : 0.007, big ? 0.030 : 0.018, 0.002, {
      x: Math.sin(a) * (R - 0.032), y: Math.cos(a) * (R - 0.032), z: 0.0475, rz: -a,
      color: OFFICE.charcoal, mat: 'ink', ao: false,
    });
  }
  // 10:09, the angle every clock in every advertisement is set to, and the one
  // that leaves both hands clearly separate at a glance.
  b.box(0.011, R * 0.56, 0.002, { x: -0.026, y: 0.026, z: 0.0485, rz: 0.95, color: OFFICE.charcoal, mat: 'ink', ao: false });
  b.box(0.008, R * 0.82, 0.002, { x: 0.020, y: 0.048, z: 0.0490, rz: -0.36, color: OFFICE.charcoal, mat: 'ink', ao: false });
  b.box(0.003, R * 0.86, 0.0015, { x: -0.030, y: -0.038, z: 0.0495, rz: -2.5, color: ACCENT, mat: 'ink', ao: false });
  b.cylUp(0.010, 0.010, 0.006, 10, { rx: Math.PI / 2, z: 0.050, color: OFFICE.charcoal, mat: 'ink', ao: false });
}

/** Corkboard, 1600 x 1100, wall-hung. Origin at the WALL, facing +z. */
export function propCorkboard(b, o = {}) {
  const w = o.w ?? 1.60, h = o.h ?? 1.10;
  // a real frame: four rails with a mitred face, not one slab behind another
  for (const sy of [-1, 1]) {
    b.cbox(w, 0.045, 0.036, { y: sy * (h / 2 - 0.0225), z: 0.018, color: OFFICE.walnutSoft, mat: 'wood-dark', ao: false, c: 0.004 });
  }
  for (const sx of [-1, 1]) {
    b.cbox(0.045, h - 0.09, 0.036, { x: sx * (w / 2 - 0.0225), z: 0.018, color: OFFICE.walnutSoft, mat: 'wood-dark', ao: false, c: 0.004 });
  }
  // cork, set back 8 mm inside the frame so the frame casts a line onto it
  b.box(w - 0.09, h - 0.09, 0.010, { z: 0.026, color: 0xc0a883, mat: 'paper', ao: false, shade: 0.90 });
  // pins, so it reads as a working board even before office.js pins anything up
  let s = 5;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 7; i++) {
    b.cylUp(0.006, 0.006, 0.008, 8, {
      x: (rnd() - 0.5) * (w - 0.24), y: (rnd() - 0.5) * (h - 0.24), z: 0.031,
      rx: Math.PI / 2, color: i % 3 === 0 ? ACCENT : 0xd8d2c6, mat: 'ink', ao: false,
    });
  }
}

/** An A1 sheet (594 x 841) pinned flat to a wall, facing +z. */
export function propSheet(b, o = {}) {
  const w = o.w ?? 0.594, h = o.h ?? 0.841;
  b.box(w, h, 0.0016, { color: o.color ?? 0xffffff, mat: 'paper', ao: false });
  // a few drawn lines, so it reads as a drawing and not a blank rectangle
  const ink = o.ink ?? 0x8b8478;
  b.box(w * 0.72, h * 0.012, 0.0006, { y: h * 0.30, z: 0.0012, color: ink, ao: false });
  b.box(w * 0.012, h * 0.44, 0.0006, { x: -w * 0.22, y: h * 0.06, z: 0.0012, color: ink, ao: false });
  b.box(w * 0.44, h * 0.010, 0.0006, { x: w * 0.10, y: -h * 0.14, z: 0.0012, color: ink, ao: false });
  b.box(w * 0.30, h * 0.055, 0.0006, { x: w * 0.28, y: -h * 0.42, z: 0.0012, color: ink, ao: false });
  b.box(w * 0.26, h * 0.035, 0.0006, { x: w * 0.28, y: -h * 0.36, z: 0.0012, color: ink, ao: false });
}

/** Black dome pendant on a visible cable. Origin AT THE CEILING, hanging down. */
export function propPendant(b, o = {}) {
  const drop = o.drop ?? 1.25, R = o.r ?? 0.16;
  b.cylUp(0.030, 0.026, 0.024, 12, { y: -0.024, color: OFFICE.nearBlack, mat: 'ink', ao: false });   // ceiling rose
  b.cyl(0.005, 0.005, drop - 0.024, 6, { y: -0.024 - (drop - 0.024) / 2, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  // The catalogue's shade, hung at the bottom of our own cord: pendant-lamp.glb
  // is a shade only (y = 0 down to -0.24) and the office needs a visible drop.
  if (!b.model(modelParts('pendantShade'), { y: -drop + 0.24, ao: false, tint: OFFICE.nearBlack })) {
    b.add(new SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), {
      y: -drop, rx: Math.PI, color: OFFICE.nearBlack, mat: 'ink', ao: false,
    });
    b.add(new SphereGeometry(R - 0.008, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), {
      y: -drop, rx: Math.PI, color: 0xd9cfbc, mat: 'paper', ao: false, shade: 1.15,
    });
  }
  b.cylUp(R * 0.60, R * 0.52, 0.010, 12, { y: -drop - 0.008, color: 0xfff0d8, mat: 'paper', ao: false, shade: 1.4 });
}

/** Floor lamp, 1600 tall, drum shade 400. */
export function propFloorLamp(b, o = {}) {
  if (b.model(modelParts('floorLamp'), { tint: o.color ?? OFFICE.paper })) return;
  b.ccylUp(0.15, 0.14, 0.024, 16, { color: OFFICE.charcoal, mat: 'metal', c: 0.005 });
  b.cylUp(0.014, 0.014, 1.40, 10, { y: 0.024, color: OFFICE.charcoal, mat: 'metal' });
  // A DRUM: an open cylinder with a visible rim top and bottom. Round 1 was one
  // bent plane, which is why it read as a broken object rather than a lamp.
  b.cyl(0.20, 0.185, 0.28, 18, { y: 1.44, color: OFFICE.paper, mat: 'paper', ao: false, open: true });
  b.cyl(0.198, 0.183, 0.276, 18, { y: 1.44, color: 0xfff4e2, mat: 'paper', ao: false, open: true, shade: 1.3 });
  for (const [y, r] of [[1.30, 0.20], [1.58, 0.185]]) {
    b.cyl(r, r, 0.010, 18, { y, color: OFFICE.steel, mat: 'metal', ao: false, open: true });
  }
  b.cylUp(0.05, 0.05, 0.010, 12, { y: 1.42, color: 0xfff0d2, mat: 'paper', ao: false, shade: 1.5 });
}

/** A small DAB radio, 280 x 160 x 140. */
export function propRadio(b) {
  b.cboxUp(0.28, 0.15, 0.14, { color: OFFICE.walnutSoft, mat: 'wood-dark', ao: false, c: 0.006 });
  // speaker grille: a recessed panel with real bars, not a painted disc
  b.cboxUp(0.115, 0.105, 0.012, { x: -0.062, y: 0.022, z: 0.066, color: 0x35322d, mat: 'ink', ao: false, c: 0.003 });
  for (let i = 0; i < 7; i++) {
    b.boxUp(0.104, 0.006, 0.004, { x: -0.062, y: 0.030 + i * 0.0135, z: 0.073, color: 0x4e4a44, mat: 'ink', ao: false });
  }
  // tuning dial with a needle, and a volume knob below it
  b.cylUp(0.030, 0.030, 0.008, 14, { x: 0.070, y: 0.098, z: 0.068, rx: Math.PI / 2, color: 0xe4dfd4, mat: 'paper', ao: false });
  b.boxUp(0.003, 0.024, 0.004, { x: 0.070, y: 0.086, z: 0.074, rz: 0.5, color: ACCENT, mat: 'ink', ao: false });
  b.cylUp(0.017, 0.015, 0.016, 12, { x: 0.070, y: 0.040, z: 0.068, rx: Math.PI / 2, color: 0xd6d1c7, mat: 'metal', ao: false });
  b.cboxUp(0.036, 0.010, 0.010, { x: 0.070, y: 0.132, z: 0.068, color: 0x4e4a44, mat: 'ink', ao: false, c: 0.002 });
  // carry handle and telescopic aerial
  for (const sx of [-1, 1]) {
    b.cboxUp(0.010, 0.030, 0.012, { x: sx * 0.075, y: 0.150, color: OFFICE.charcoal, mat: 'ink', ao: false, c: 0.003 });
  }
  b.cboxUp(0.160, 0.010, 0.012, { y: 0.176, color: OFFICE.charcoal, mat: 'ink', ao: false, c: 0.004 });
  b.cylUp(0.003, 0.002, 0.30, 6, { x: 0.116, y: 0.15, rz: -0.25, color: OFFICE.steel, mat: 'metal', ao: false });
}

/**
 * Flat-woven wool rug. Big enough to break the floor up (finish bar item 13).
 *
 * NOT play-rug.glb: that is a 2 x 2 m kindergarten mat in saturated orange, and
 * a 3.4 x 2.6 m field of the accent hue would be the largest object in the room
 * AND a second competing accent — an instant fail of finish bar item 10.
 */
/**
 * A flat-woven kilim, 3000 x 2100, 14 mm pile with a bound edge and a knotted
 * fringe at both ends.
 *
 * Round 2 was "a chamfered plane with two printed stripes; no pile, no fringe,
 * no weave" — a rug by context only. The three things that make a textile read
 * as a textile in flat-shaded low poly are all geometry, not colour: the pile
 * has to have visible THICKNESS at the edge, the ends have to have FRINGE that
 * breaks the outline, and the field has to have a WEAVE that changes direction
 * at the border. All three are below, and it is still one merged batch.
 */
export function propRug(b, o = {}) {
  const w = o.w ?? 3.00, d = o.d ?? 2.10;
  const c1 = o.color ?? OFFICE.wool, c2 = o.color2 ?? OFFICE.woolDk;
  // pile, thick enough to catch a highlight on the chamfer
  b.cboxUp(w, 0.014, d, { color: c1, ao: false, c: 0.005 });
  // bound edge, standing 4 mm proud — the detail that stops it being a decal
  for (const sz of [-1, 1]) {
    b.cboxUp(w, 0.018, 0.05, { z: sz * (d / 2 - 0.025), color: c2, ao: false, c: 0.005 });
  }
  for (const sx of [-1, 1]) {
    b.cboxUp(0.05, 0.018, d - 0.10, { x: sx * (w / 2 - 0.025), color: c2, ao: false, c: 0.005 });
  }
  // Weave. The field runs one way and the border the other, which is how a flat
  // weave actually behaves and what stops a rug reading as painted lino: 3 mm
  // ribs the long way in the middle, 3 mm ribs the short way in the two borders.
  const ribs = Math.floor((d - 0.30) / 0.055);
  for (let i = 0; i < ribs; i++) {
    const z = -(d - 0.30) / 2 + i * 0.055;
    b.boxUp(w - 0.30, 0.0026, 0.030, { y: 0.014, z, color: c1, ao: false, shade: i % 2 ? 1.05 : 0.95 });
  }
  for (const sx of [-1, 1]) {
    const bx = sx * (w / 2 - 0.16);
    const n = Math.floor((d - 0.14) / 0.052);
    for (let i = 0; i < n; i++) {
      const z = -(d - 0.14) / 2 + i * 0.052;
      b.boxUp(0.19, 0.0030, 0.030, { x: bx, y: 0.014, z, color: c2, ao: false, shade: i % 2 ? 1.10 : 0.92 });
    }
  }
  // a stepped kilim motif down the two field bands
  for (const [z, t] of [[-d * 0.24, 0.085], [d * 0.24, 0.085]]) {
    b.boxUp(w - 0.44, 0.0034, t, { y: 0.015, z, color: c2, ao: false, shade: 1.04 });
    for (let i = 0; i < 9; i++) {
      b.boxUp(0.075, 0.0038, 0.075, { x: -(w - 0.60) / 2 + i * (w - 0.60) / 8, y: 0.015, z,
        ry: Math.PI / 4, color: c1, ao: false, shade: 1.12 });
    }
  }
  // Fringe: 27 knotted tassels off each short end, alternating length so the
  // outline is ragged. Plain boxes — a 4 mm chamfer on a 4 mm tassel is noise.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 27; i++) {
      const z = -(d - 0.10) / 2 + i * (d - 0.10) / 26;
      const len = 0.055 + (i % 3) * 0.012;
      b.boxUp(len, 0.006, 0.0075, { x: sx * (w / 2 + len / 2 - 0.004), y: 0.001, z,
        ry: (i % 2 ? 0.05 : -0.04), color: c1, ao: false, shade: 1.14 });
    }
  }
}

/**
 * A moving box of models, 400 x 300 x 400.
 *
 * Round 1 was a grey-white cube. Cardboard is a warm kraft brown, and a box
 * that has been packed has FLAPS: two long ones folded down and taped, two
 * short ones under them, a tape seam up the middle, and a printed label.
 */
export function propCardboardBox(b, o = {}) {
  const w = o.w ?? 0.40, h = o.h ?? 0.30, d = o.d ?? 0.40;
  const kraft = 0xbca88c;             // s 0.25 — right at the palette ceiling
  b.cboxUp(w, h - 0.010, d, { color: kraft, c: 0.005 });
  // horizontal score line where the side panels fold
  b.boxUp(w + 0.002, 0.0025, d + 0.002, { y: h * 0.30, color: kraft, ao: false, shade: 0.88 });
  // the two short flaps, folded in first, sitting slightly below the long ones
  for (const sx of [-1, 1]) {
    b.cboxUp(w * 0.47, 0.006, d - 0.012, { x: sx * w * 0.253, y: h - 0.016, color: kraft, shade: 0.94, c: 0.002 });
  }
  // the two long flaps on top, meeting at the middle with a 6 mm gap
  for (const sz of [-1, 1]) {
    b.cboxUp(w - 0.010, 0.006, d * 0.485, { z: sz * d * 0.252, y: h - 0.010, color: kraft, shade: 1.06, c: 0.002 });
  }
  // parcel tape up the seam and round the corners
  b.boxUp(0.055, 0.0022, d - 0.006, { y: h - 0.004, color: 0xd6c9ae, mat: 'paper', ao: false, shade: 1.08 });
  for (const sz of [-1, 1]) {
    b.boxUp(0.055, 0.055, 0.0022, { y: h - 0.032, z: sz * (d / 2 + 0.0012), color: 0xd6c9ae, mat: 'paper', ao: false, shade: 1.08 });
  }
  // shipping label, and a hand-written sharpie line on it
  b.boxUp(w * 0.42, 0.0022, h * 0.36, { y: h * 0.42, z: d / 2 + 0.0014, rx: Math.PI / 2,
    color: OFFICE.paper, mat: 'paper', ao: false });
  b.boxUp(w * 0.26, 0.0016, 0.010, { y: h * 0.46, z: d / 2 + 0.0026, rx: Math.PI / 2,
    color: 0x6f6a62, mat: 'paper', ao: false });
  b.boxUp(w * 0.18, 0.0016, 0.008, { x: -w * 0.05, y: h * 0.38, z: d / 2 + 0.0026, rx: Math.PI / 2,
    color: 0x6f6a62, mat: 'paper', ao: false });
}

/**
 * Cubicle screen: 1200 x 1350, acoustic felt in an aluminium frame on cast feet.
 *
 * These are the largest masses in the hero frame, and round 1 drew them as one
 * featureless slab on two sticks. A real screen is a FRAME with a panel set
 * into it: four extruded rails, the felt recessed 6 mm inside them so the frame
 * throws a line across it, a top cap, and a cast foot at each end.
 */
export function propPartition(b, o = {}) {
  const w = o.w ?? 1.20, h = o.h ?? 1.35;
  const felt = o.color ?? 0xffffff;
  const frame = OFFICE.steelDark;
  const y0 = 0.10;                     // the panel starts above the feet
  const rail = 0.032;
  // felt panel, recessed inside the frame on both faces
  // The felt panel used to be one uniform rectangle from 0.12 m to 1.33 m — the
  // single loudest tell in the office's blind A/B against the finish bar. Felt
  // in a real room is never that even: it sits in the desk's shadow at the
  // bottom, catches the pendants at the top, and its 30 mm side returns face
  // away from the light. So: darker at the base easing to full at the top edge,
  // and the stile-side returns pulled down a step.
  const panelBottom = y0 + rail / 2, panelTop = h - rail / 2;
  const halfW = (w - 2 * rail) / 2;
  b.cboxUp(w - 2 * rail, h - y0 - rail, 0.030, {
    y: y0 + rail / 2, color: felt, c: 0.004,
    grad: (x, y) => {
      const t = Math.min(1, Math.max(0, (y - panelBottom) / (panelTop - panelBottom)));
      const vertical = 0.74 + 0.26 * (t * t * (3 - 2 * t));
      const side = Math.abs(x) > halfW - 0.012 ? 0.84 : 1;
      return vertical * side;
    },
  });
  // frame: two stiles, a head and a sill, 32 mm aluminium
  for (const sx of [-1, 1]) {
    b.cboxUp(rail, h - y0, 0.044, { x: sx * (w / 2 - rail / 2), y: y0, color: frame, mat: 'metal', c: 0.004 });
  }
  b.cboxUp(w, rail, 0.044, { y: h - rail, color: frame, mat: 'metal', c: 0.004 });
  b.cboxUp(w - 2 * rail, rail * 0.8, 0.044, { y: y0, color: frame, mat: 'metal', c: 0.004 });
  // cast feet: a wedge and a chromed upright each end
  for (const sx of [-1, 1]) {
    b.cboxUp(0.062, 0.030, 0.34, { x: sx * (w / 2 - 0.05), color: frame, mat: 'metal', c: 0.006 });
    b.cboxUp(0.030, y0 - 0.030, 0.044, { x: sx * (w / 2 - 0.05), y: 0.030, color: frame, mat: 'metal', c: 0.004 });
    for (const sz of [-1, 1]) {
      b.cylUp(0.012, 0.012, 0.006, 8, { x: sx * (w / 2 - 0.05), z: sz * 0.15, color: OFFICE.nearBlack, mat: 'ink' });
    }
  }
}

/** Kitchenette run: 1800 x 600 x 900, sink + splashback. Faces +z. */
export function propCoffeeCounter(b, o = {}) {
  const w = o.w ?? 1.80, d = 0.60, h = 0.90;
  b.cboxUp(w - 0.04, 0.10, d - 0.08, { z: 0.03, color: OFFICE.charcoal, mat: 'ink', shade: 0.6, c: 0.004 });
  b.cboxUp(w, h - 0.14, d, { y: 0.10, color: OFFICE.wallShade, c: 0.005 });
  // three doors, proud of the carcass with a 6 mm reveal, each with a bar pull
  for (let i = 0; i < 3; i++) {
    const x = -w / 3 + i * (w / 3);
    b.cboxUp(w / 3 - 0.012, h - 0.22, 0.016, { x, y: 0.135, z: d / 2 - 0.002,
      color: OFFICE.wallShade, shade: 1.08, c: 0.004 });
    b.cboxUp(0.012, 0.100, 0.012, { x: x + w / 6 - 0.055, y: h - 0.30, z: d / 2 + 0.020,
      color: OFFICE.steel, mat: 'metal', ao: false, c: 0.003 });
    for (const y of [h - 0.305, h - 0.215]) {
      b.cboxUp(0.011, 0.011, 0.022, { x: x + w / 6 - 0.055, y, z: d / 2 + 0.008,
        color: OFFICE.steel, mat: 'metal', ao: false, c: 0.002 });
    }
  }
  // 40 mm worktop with a drip edge
  b.cboxUp(w + 0.024, 0.040, d + 0.024, { y: h - 0.04, color: 0xdedad1, mat: 'polishedConcrete', c: 0.006 });
  // 400 x 340 undermount sink: a real recess with sloped sides and a waste
  const sx0 = w / 2 - 0.34;
  b.cboxUp(0.42, 0.005, 0.36, { x: sx0, y: h - 0.006, color: 0x6f6b64, mat: 'metal', ao: false, c: 0.003 });
  b.cyl(0.20, 0.17, 0.115, 4, { x: sx0, y: h - 0.062, ry: Math.PI / 4, s: [1.05, 1, 0.90],
    color: OFFICE.steelDark, mat: 'metal', ao: false, open: true });
  b.cboxUp(0.30, 0.006, 0.26, { x: sx0, y: h - 0.122, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
  b.cylUp(0.028, 0.028, 0.006, 10, { x: sx0, y: h - 0.122, color: 0x55524d, mat: 'metal', ao: false });
  // mixer: a column with a curved gooseneck and a lever
  b.ccylUp(0.026, 0.020, 0.026, 12, { x: sx0, y: h, z: -0.20, color: OFFICE.steel, mat: 'metal', ao: false, c: 0.004 });
  b.cylUp(0.016, 0.015, 0.20, 12, { x: sx0, y: h + 0.020, z: -0.20, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cyl(0.015, 0.015, 0.075, 10, { x: sx0, y: h + 0.238, z: -0.176, rx: 0.75, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cyl(0.014, 0.014, 0.115, 10, { x: sx0, y: h + 0.255, z: -0.115, rx: Math.PI / 2, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cylUp(0.012, 0.010, 0.032, 8, { x: sx0, y: h + 0.216, z: -0.058, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cboxUp(0.014, 0.014, 0.075, { x: sx0 + 0.030, y: h + 0.050, z: -0.20, rx: -0.35,
    color: OFFICE.steel, mat: 'metal', ao: false, c: 0.003 });
}

/** A wall shelf on two brackets, 1200 x 250. Origin AT THE WALL, facing +z. */
export function propWallShelf(b, o = {}) {
  const w = o.w ?? 1.20, d = o.d ?? 0.25;
  b.cbox(w, 0.032, d, { z: d / 2, color: OFFICE.oakPale, mat: 'wood-light', ao: false, c: 0.004 });
  // proper L brackets: an upstand, an arm and a diagonal strut
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.14);
    b.cbox(0.022, 0.17, 0.024, { x, y: -0.085, z: 0.014, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
    b.cbox(0.022, 0.022, d - 0.05, { x, y: -0.027, z: d / 2 - 0.018, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
    b.cbox(0.016, 0.016, 0.19, { x, y: -0.085, z: 0.095, rx: -0.72, color: OFFICE.steelDark, mat: 'metal', ao: false, c: 0.003 });
    for (const y of [-0.02, -0.145]) {
      b.cylUp(0.006, 0.006, 0.008, 8, { x, y, z: 0.008, rx: Math.PI / 2, color: 0xb8b4ad, mat: 'metal', ao: false });
    }
  }
}

/**
 * Triangular scale rule, 300 mm. Tiny, but an architect will notice it — and
 * round 1 drew it as a single 12-triangle box, which is the one thing on this
 * desk he would have recognised as fake at a glance.
 */
export function propScaleRule(b) {
  const L = 0.30;
  b.add(new CylinderGeometry(0.017, 0.017, L, 3), { rz: Math.PI / 2, ry: 0.5, y: 0.009,
    color: OFFICE.paper, mat: 'paper', ao: false });
  // the three printed scale faces: a coloured stripe and its graduations
  for (let f = 0; f < 3; f++) {
    const a = 0.5 + f * (Math.PI * 2 / 3);
    const r = 0.0079;
    b.at({ y: 0.009 + Math.sin(a) * r, z: Math.cos(a) * r, rx: -a }, (q) => {
      q.boxUp(L - 0.02, 0.0012, 0.010, { color: [ACCENT, 0x4c5b66, 0x55504a][f], mat: 'paper', ao: false });
      for (let i = 0; i < 15; i++) {
        q.boxUp(0.0012, 0.0014, 0.005, { x: -L / 2 + 0.014 + i * 0.0195, z: -0.006,
          color: 0x55504a, mat: 'paper', ao: false });
      }
    });
  }
  // the moulded end caps
  for (const sx of [-1, 1]) {
    b.add(new CylinderGeometry(0.0175, 0.0175, 0.008, 3), { rz: Math.PI / 2, ry: 0.5,
      x: sx * (L / 2 - 0.004), y: 0.009, color: OFFICE.charcoal, mat: 'ink', ao: false });
  }
}

/**
 * THE HERO PROP — a physical massing model on a plywood base board.
 * 600 x 450 board, 1:200 blocks, a road, six trees and a car. This is the
 * object that says "architects work here" louder than anything else in the room.
 */
export function propMassingModel(b, o = {}) {
  const W = o.w ?? 0.60, D = o.d ?? 0.45;
  b.boxUp(W, 0.012, D, { color: OFFICE.ply, ao: false });
  b.boxUp(W - 0.03, 0.003, D - 0.03, { y: 0.012, color: 0xe4dccc, mat: 'paper', ao: false });
  // site road, 1:200 => a 7 m road is 35 mm
  b.boxUp(W - 0.05, 0.0015, 0.035, { y: 0.0155, z: D / 2 - 0.075, color: 0xa9a49b, mat: 'polishedConcrete', ao: false });
  // massing: four blocks, 1:200. 12 m tall block = 60 mm.
  const blocks = [
    [-0.16, -0.05, 0.13, 0.060, 0.10],
    [-0.02, -0.03, 0.10, 0.045, 0.13],
    [0.115, -0.055, 0.11, 0.075, 0.09],
    [0.115, 0.075, 0.07, 0.030, 0.08],
  ];
  for (const [x, z, w, h, d] of blocks) {
    // The blocks are the whole point of a massing model: chamfered at 1.5 mm,
    // which at 1:200 is a 300 mm arris and reads as cut card, not as a pixel.
    b.cboxUp(w, h, d, { x, z, y: 0.015, color: 0xf0eade, mat: 'paper', ao: false, c: 0.0015 });
    b.cboxUp(w + 0.004, 0.002, d + 0.004, { x, z, y: 0.015 + h, color: 0xd8d2c4, mat: 'paper', ao: false, c: 0.0008 });
  }
  // model trees: 20 mm dowels with foam balls
  let seed = o.seed ?? 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 7; i++) {
    const x = -W / 2 + 0.05 + rnd() * (W - 0.10);
    const z = D / 2 - 0.14 - rnd() * 0.05;
    b.cylUp(0.0025, 0.0025, 0.018, 5, { x, z, y: 0.015, color: 0x8a7a63, ao: false });
    b.sphere(0.011, 6, { x, z, y: 0.040, color: i % 2 ? OFFICE.leaf : OFFICE.leafDark, ao: false });
  }
  // one 1:200 car, 22 mm
  b.boxUp(0.022, 0.006, 0.010, { x: 0.05, z: D / 2 - 0.075, y: 0.017, color: OFFICE.steelDark, mat: 'metal', ao: false });
  // north arrow etched on the board
  b.boxUp(0.004, 0.001, 0.035, { x: -W / 2 + 0.045, z: -D / 2 + 0.045, y: 0.0155, color: OFFICE.charcoal, mat: 'paper', ao: false });
}

/** A stack of study models beside the big one. */
export function propStudyModels(b) {
  b.cboxUp(0.22, 0.010, 0.16, { color: OFFICE.ply, ao: false, c: 0.0015 });
  b.cboxUp(0.09, 0.055, 0.07, { x: -0.04, y: 0.010, ry: 0.2, color: 0xeee7d9, mat: 'paper', ao: false, c: 0.0018 });
  b.cboxUp(0.06, 0.030, 0.06, { x: 0.05, z: 0.02, y: 0.010, ry: -0.3, color: 0xeee7d9, mat: 'paper', ao: false, c: 0.0018 });
  // a pitched roof on the tall one — three white boxes read as three white
  // boxes; one of them being a HOUSE is what says these are study models
  b.at({ x: -0.04, y: 0.065, ry: 0.2 }, (q) => {
    for (const sz of [-1, 1]) {
      q.cboxUp(0.092, 0.0035, 0.045, { z: sz * 0.018, rx: sz * 0.62, color: 0xe0d8c8, mat: 'paper', ao: false, c: 0.0012 });
    }
  });
  b.cboxUp(0.20, 0.008, 0.14, { y: 0.075, ry: 0.12, color: OFFICE.ply, ao: false, c: 0.0015 });
  b.cboxUp(0.05, 0.05, 0.05, { y: 0.083, x: 0.02, ry: 0.6, color: 0xe6dfd0, mat: 'paper', ao: false, c: 0.0018 });
  // a fold of trace paper hanging off the edge of the top board
  b.boxUp(0.075, 0.0012, 0.09, { x: -0.075, y: 0.079, ry: -0.25, rz: 0.28, color: 0xe4dccc, mat: 'paper', ao: false });
}


/**
 * Low samples credenza, 0.72 m high, along the pin-up wall. Every studio has
 * one and it is where the material samples, the boxed models and the half-empty
 * box of the last competition live. 1800 x 450 x 720.
 */
export function propCredenza(b, o = {}) {
  const w = o.w ?? 1.80, d = 0.45, h = 0.72;
  // sideboard-1600 squashed 10 % in height to the 720 mm the office costs,
  // collides against and stands its sample trays on. 720 is a normal low
  // credenza; 800 would put every object on top of it 80 mm into the air.
  if (b.modelSized('credenza', { w, h, d }, { tint: o.color ?? OFFICE.wallShade })) return;
  b.cboxUp(w - 0.05, 0.09, d - 0.06, { y: 0, z: 0.03, color: OFFICE.charcoal, mat: 'ink', c: 0.004 });
  b.cboxUp(w, h - 0.13, d, { y: 0.09, color: o.color ?? OFFICE.wallShade, c: 0.005 });
  const bays = Math.max(2, Math.round(w / 0.60));
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + (i + 0.5) * (w / bays);
    b.cboxUp(w / bays - 0.016, h - 0.21, 0.016, { x, y: 0.125, z: d / 2 - 0.002,
      color: o.color ?? OFFICE.wallShade, shade: 1.08, c: 0.004 });
    b.cboxUp(0.10, 0.012, 0.012, { x, y: h - 0.20, z: d / 2 + 0.030, color: 0xd6d1c7, mat: 'metal', ao: false, c: 0.003 });
    for (const dx of [-0.042, 0.042]) {
      b.cboxUp(0.012, 0.012, 0.022, { x: x + dx, y: h - 0.20, z: d / 2 + 0.013, color: 0xd6d1c7, mat: 'metal', ao: false, c: 0.002 });
    }
  }
  b.cboxUp(w + 0.024, 0.04, d + 0.024, { y: h - 0.04, color: OFFICE.oakPale, mat: 'wood-light', c: 0.006 });
}

/** A tray of material samples: nine 100 mm tiles of nine different finishes. */
export function propSampleTray(b) {
  // a tray with a rim, not a board: the rim is what holds the samples in
  b.cboxUp(0.34, 0.014, 0.26, { color: OFFICE.ply, ao: false, c: 0.002 });
  for (const sz of [-1, 1]) b.cboxUp(0.34, 0.020, 0.012, { z: sz * 0.124, color: OFFICE.ply, ao: false, shade: 1.06, c: 0.002 });
  for (const sx of [-1, 1]) b.cboxUp(0.012, 0.020, 0.236, { x: sx * 0.164, color: OFFICE.ply, ao: false, shade: 1.06, c: 0.002 });
  const mats = [
    ['tile', 0xe9e6df], ['flat', OFFICE.limewash], ['wood-light', OFFICE.oakPale],
    ['flat', 0x8f877b], ['polishedConcrete', OFFICE.concreteFloor], ['flat', 0x6c655c],
    ['metal', 0xc9c6bf], ['flat', OFFICE.walnutSoft], ['tile', 0xd6d2c8],
  ];
  for (let i = 0; i < 9; i++) {
    const [mat, c] = mats[i];
    const x = -0.105 + (i % 3) * 0.105, z = -0.078 + Math.floor(i / 3) * 0.078;
    b.cboxUp(0.092, 0.008, 0.066, { x, z, y: 0.014, color: c, mat, ao: false, c: 0.0018 });
    // the little numbered label stuck on the corner of every sample
    b.boxUp(0.026, 0.0012, 0.014, { x: x - 0.028, z: z + 0.022, y: 0.022, color: OFFICE.paper, mat: 'paper', ao: false });
  }
}

/**
 * A stack of prints lying flat, the way they actually pile up.
 *
 * `size` is a real paper size, because the pile has to FIT what it is standing
 * on: an A1 sheet is 594 x 841 and a samples credenza is 450 deep, so an A1
 * pile on the credenza overhangs 200 mm front and back and reads as a sheet
 * floating in the air. On the floor A1 is exactly right.
 */
export const PAPER = { A1: [0.594, 0.841], A2: [0.420, 0.594], A3: [0.297, 0.420] };

export function propPrintPile(b, o = {}) {
  const n = o.n ?? 14;
  const [w, d] = o.size || PAPER.A1;
  for (let i = 0; i < n; i++) {
    b.boxUp(w, 0.0022, d, {
      y: i * 0.0022, ry: (i % 5 - 2) * 0.012, x: (i % 3 - 1) * 0.004,
      color: i % 4 === 0 ? OFFICE.paperWarm : OFFICE.paper, mat: 'paper', ao: false,
    });
  }
  // the top sheet, folded back at one corner, and a red pen mark on it
  b.boxUp(w, 0.0022, d, { y: n * 0.0022, ry: 0.02, color: OFFICE.paper, mat: 'paper', ao: false });
  b.boxUp(w * 0.24, 0.0016, d * 0.17, { x: w * 0.33, z: d * 0.36, y: n * 0.0022 + 0.004, ry: 0.02, rx: 0.30,
    color: OFFICE.paperWarm, mat: 'paper', ao: false, shade: 0.92 });
  b.boxUp(w * 0.27, 0.0014, 0.008, { x: -w * 0.10, z: -d * 0.14, y: n * 0.0022 + 0.0016, ry: 0.34,
    color: ACCENT, mat: 'paper', ao: false });
}

export const PROP_TYPES = [
  'desk', 'pedestal', 'taskChair', 'stackChair', 'monitor', 'keyboard', 'mouse',
  'deskLamp', 'mug', 'penCup', 'paperStack', 'roll', 'book', 'planChest',
  'bookshelf', 'plotter', 'meetingTable', 'plantLarge', 'plantSmall',
  'coffeeMachine', 'kettle', 'bin', 'crumpledPaper', 'corkboard', 'sheet',
  'pendant', 'floorLamp', 'radio', 'rug', 'cardboardBox', 'partition',
  'coffeeCounter', 'wallShelf', 'scaleRule', 'massingModel', 'studyModels',
  'credenza', 'sampleTray', 'printPile',
];

export const PROPS = {
  desk: propDesk, pedestal: propPedestal, taskChair: propTaskChair,
  stackChair: propStackChair, monitor: propMonitor, keyboard: propKeyboard,
  mouse: propMouse, deskLamp: propDeskLamp, mug: propMug, penCup: propPenCup,
  paperStack: propPaperStack, roll: propRoll, book: propBook,
  planChest: propPlanChest, bookshelf: propBookshelf, plotter: propPlotter,
  meetingTable: propMeetingTable, plantLarge: propPlantLarge,
  plantSmall: propPlantSmall, coffeeMachine: propCoffeeMachine,
  kettle: propKettle, bin: propBin, crumpledPaper: propCrumpledPaper,
  corkboard: propCorkboard, sheet: propSheet, pendant: propPendant,
  whiteboard: propWhiteboard, coatRail: propCoatRail, wallClock: propWallClock,
  floorLamp: propFloorLamp, radio: propRadio, rug: propRug,
  cardboardBox: propCardboardBox, partition: propPartition,
  coffeeCounter: propCoffeeCounter, wallShelf: propWallShelf,
  scaleRule: propScaleRule, massingModel: propMassingModel,
  studyModels: propStudyModels, credenza: propCredenza,
  sampleTray: propSampleTray, printPile: propPrintPile,
};
