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
  b.boxUp(w, 0.025, d, { y: h - 0.025, color: top, mat: 'wood-light' });
  b.boxUp(w - 0.10, 0.04, d - 0.10, { y: h - 0.065, color: 0xd8d4cd, mat: 'metal' });  // sub-frame
  // 50 x 50 legs, inset 60 mm
  const lx = w / 2 - 0.055, lz = d / 2 - 0.055;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.boxUp(0.05, h - 0.065, 0.05, { x: sx * lx, z: sz * lz, color: 0xe4e0d8, mat: 'metal' });
  }
  // cable tray under the back edge + a modesty return
  b.boxUp(w - 0.30, 0.06, 0.12, { y: 0.60, z: -d / 2 + 0.10, color: 0xcac6c0, mat: 'metal' });
  // 80 mm cable grommet
  b.cylUp(0.04, 0.04, 0.012, 12, { y: h - 0.026, x: w / 2 - 0.28, z: -d / 2 + 0.13, color: OFFICE.nearBlack, mat: 'ink' });
}

/** Mobile pedestal, 420 x 600 x 600, three drawers. Rolls under the desk. */
export function propPedestal(b, o = {}) {
  const w = 0.42, d = 0.60, h = 0.60;
  const col = o.color ?? OFFICE.charcoal;
  b.boxUp(w, h - 0.06, d, { y: 0.06, color: col });
  for (let i = 0; i < 3; i++) {
    const y = 0.10 + i * 0.175;
    b.boxUp(w - 0.02, 0.16, 0.012, { y, z: d / 2, color: col, shade: 1.12 });
    b.boxUp(0.14, 0.014, 0.02, { y: y + 0.11, z: d / 2 + 0.012, color: 0xd9d5ce, mat: 'metal' });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cylUp(0.022, 0.022, 0.055, 8, { x: sx * (w / 2 - 0.05), z: sz * (d / 2 - 0.06), color: OFFICE.nearBlack, mat: 'ink' });
  }
}

/** Task chair: seat 460, back to 1120, 5-star base on castors. */
export function propTaskChair(b, o = {}) {
  const seatH = 0.46;
  const fabric = o.color ?? 0xffffff;   // tinted per instance
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
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cylUp(0.014, 0.014, seatH - 0.02, 6, { x: sx * 0.185, z: sz * 0.20, color: 0xe2ded7, mat: 'metal' });
  }
  b.boxUp(0.44, 0.035, 0.46, { y: seatH - 0.035, color: c });
  b.at({ y: seatH, z: -0.21, rx: -0.14 }, (q) => {
    q.boxUp(0.40, 0.32, 0.03, { y: 0.06, color: c });
  });
}

/** 24" monitor: panel 545 x 325, 8 mm bezel, 220 mm stand. Screen faces +z. */
export function propMonitor(b, o = {}) {
  const pw = o.w ?? 0.545, ph = o.h ?? 0.325;
  const stand = o.stand ?? 0.22;
  b.cylUp(0.11, 0.11, 0.018, 14, { color: OFFICE.nearBlack, mat: 'ink' });          // foot
  b.boxUp(0.055, stand, 0.045, { y: 0.018, color: OFFICE.nearBlack, mat: 'ink' });   // neck
  b.boxUp(pw + 0.016, ph + 0.016, 0.022, { y: stand + 0.02, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.boxUp(pw + 0.016, 0.026, 0.03, { y: stand + 0.02, z: -0.012, color: OFFICE.nearBlack, mat: 'ink', ao: false });
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

export function propKeyboard(b, o = {}) {
  b.boxUp(0.44, 0.016, 0.135, { color: OFFICE.charcoal, ao: false });
  b.boxUp(0.41, 0.006, 0.11, { y: 0.016, color: 0x4c4945, ao: false });
}

export function propMouse(b) {
  b.boxUp(0.062, 0.026, 0.108, { color: OFFICE.charcoal, ao: false });
  b.at({ y: 0.026 }, (q) => q.sphere(0.045, 8, { y: -0.012, s: [0.7, 0.35, 1.2], color: OFFICE.charcoal, ao: false }));
}

/** Architect's lamp: 550 mm reach, head at 620 mm. */
export function propDeskLamp(b, o = {}) {
  const c = o.color ?? 0xffffff;       // tinted per instance
  b.cylUp(0.075, 0.075, 0.018, 14, { color: c, ao: false });
  b.at({ y: 0.018 }, (q) => {
    q.boxUp(0.022, 0.40, 0.022, { rz: -0.42, x: 0.07, color: c, ao: false });
    q.at({ x: 0.235, y: 0.365 }, (r) => {
      r.boxUp(0.02, 0.32, 0.02, { rz: 1.02, x: 0.12, color: c, ao: false });
      r.at({ x: 0.28, y: 0.14, rz: -0.55 }, (s) => {
        s.cylUp(0.085, 0.045, 0.11, 12, { rx: Math.PI, y: 0.11, color: c, ao: false });
      });
    });
  });
}

/** Ceramic mug, 82 mm across, 95 tall, with a handle. */
export function propMug(b, o = {}) {
  const c = o.color ?? 0xffffff;       // tinted per instance
  b.cylUp(0.040, 0.041, 0.095, 14, { color: c, mat: 'tile', ao: false });
  if (o.full) b.cylUp(0.033, 0.033, 0.008, 12, { y: 0.082, color: 0x4a3527, ao: false });
  else b.cylUp(0.033, 0.033, 0.008, 12, { y: 0.082, color: c, mat: 'tile', ao: false });
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + (i / 4) * 1.8;
    b.cylUp(0.006, 0.006, 0.016, 5, { x: 0.041 + Math.cos(a) * 0.018, y: 0.045 + Math.sin(a) * 0.026,
      rz: Math.PI / 2, color: c, mat: 'tile', ao: false });
  }
}

export function propPenCup(b, o = {}) {
  b.cylUp(0.043, 0.043, 0.10, 12, { color: OFFICE.steelDark, mat: 'metal', ao: false });
  const cols = [ACCENT, OFFICE.charcoal, OFFICE.steel, 0xd8d2c6, OFFICE.charcoal, ACCENT];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cylUp(0.004, 0.004, 0.175, 5, { x: Math.cos(a) * 0.022, z: Math.sin(a) * 0.022, y: 0.03,
      rz: Math.cos(a) * 0.12, rx: Math.sin(a) * 0.12, color: cols[i], ao: false });
  }
}

/** A stack of A4 (297 x 210). */
export function propPaperStack(b, o = {}) {
  const h = o.h ?? 0.03;
  b.boxUp(0.297, h, 0.21, { color: OFFICE.paper, mat: 'paper', ao: false, ry: o.ry || 0 });
  b.boxUp(0.297, 0.002, 0.21, { y: h, ry: (o.ry || 0) + 0.06, color: OFFICE.paper, mat: 'paper', ao: false });
}

/** An A1 drawing rolled up: 75 mm across, 900 long. */
export function propRoll(b, o = {}) {
  b.cyl(0.037, 0.037, 0.90, 10, { color: o.color ?? 0xffffff, mat: 'paper', ao: false });
}

/** A5 hardback, 160 x 235 x 30. */
export function propBook(b, o = {}) {
  const t = o.t ?? 0.032, hh = o.hh ?? 0.235;
  b.boxUp(t, hh, 0.16, { color: o.color ?? 0xffffff, ao: false });
  b.boxUp(t * 0.72, hh - 0.014, 0.155, { y: 0.007, z: 0.006, color: OFFICE.paper, mat: 'paper', ao: false });
}

/** A0 plan chest: 1370 x 960 x 900, ten shallow drawers. The one piece of
 *  furniture every architect in the world recognises instantly. */
export function propPlanChest(b) {
  const w = 1.37, d = 0.96, h = 0.90;
  b.boxUp(w, 0.09, d, { color: OFFICE.walnutSoft, mat: 'wood-dark', shade: 0.75 });   // plinth
  b.boxUp(w, h - 0.09, d, { y: 0.09, color: OFFICE.walnutSoft, mat: 'wood-dark' });
  for (let i = 0; i < 10; i++) {
    const y = 0.115 + i * 0.0765;
    b.boxUp(w - 0.03, 0.062, 0.012, { y, z: d / 2, color: OFFICE.walnutSoft, mat: 'wood-dark', shade: 1.16 });
    // 120 mm brass pull, one per drawer, centred
    b.boxUp(0.12, 0.016, 0.022, { y: y + 0.032, z: d / 2 + 0.014, color: 0xd8cbb2, mat: 'metal-warm', ao: false });
  }
  b.boxUp(w + 0.03, 0.025, d + 0.03, { y: h - 0.025, color: OFFICE.walnutSoft, mat: 'wood-dark', shade: 1.1 });
}

/** Open shelving, 900 x 320 x 2100, five shelves. */
export function propBookshelf(b, o = {}) {
  const w = o.w ?? 0.90, d = 0.32, h = o.h ?? 2.10, n = o.shelves ?? 5;
  for (const sx of [-1, 1]) b.boxUp(0.025, h, d, { x: sx * (w / 2 - 0.012), color: OFFICE.charcoal, mat: 'ink' });
  b.boxUp(w, 0.02, d, { y: h - 0.02, color: OFFICE.charcoal, mat: 'ink' });
  b.boxUp(w - 0.05, 0.012, d, { y: 0, color: OFFICE.charcoal, mat: 'ink' });
  for (let i = 1; i <= n; i++) {
    b.boxUp(w - 0.05, 0.018, d, { y: (h - 0.05) * (i / (n + 1)), color: OFFICE.charcoal, mat: 'ink' });
  }
  b.boxUp(w - 0.05, h - 0.04, 0.012, { y: 0.02, z: -d / 2 + 0.006, color: OFFICE.charcoal, mat: 'ink', shade: 0.7 });
}

/** A0 roll plotter on its stand: 1380 x 600 x 930 (HP DesignJet class). */
export function propPlotter(b) {
  const w = 1.38, d = 0.60, h = 0.93;
  for (const sx of [-1, 1]) {
    b.boxUp(0.05, h - 0.28, 0.05, { x: sx * (w / 2 - 0.14), z: -0.18, color: OFFICE.steelDark, mat: 'metal' });
    b.boxUp(0.05, h - 0.28, 0.05, { x: sx * (w / 2 - 0.14), z: 0.18, color: OFFICE.steelDark, mat: 'metal' });
    b.cylUp(0.035, 0.035, 0.05, 8, { x: sx * (w / 2 - 0.14), z: -0.18, color: OFFICE.nearBlack, mat: 'ink' });
    b.cylUp(0.035, 0.035, 0.05, 8, { x: sx * (w / 2 - 0.14), z: 0.18, color: OFFICE.nearBlack, mat: 'ink' });
  }
  // output basket — two rails and a slung fabric sheet
  b.boxUp(w - 0.20, 0.012, 0.40, { y: 0.30, z: 0.14, rx: 0.22, color: OFFICE.woolDk });
  // body
  b.boxUp(w, 0.28, d, { y: h - 0.28, color: OFFICE.ceramic, shade: 0.96 });
  b.boxUp(w - 0.04, 0.10, d - 0.03, { y: h - 0.12, color: OFFICE.nearBlack, mat: 'ink', shade: 1.0 });
  b.boxUp(0.19, 0.09, 0.03, { x: w / 2 - 0.20, y: h - 0.115, z: d / 2 - 0.012, color: 0x2a3a44, mat: 'ink', ao: false });
  b.boxUp(w - 0.30, 0.008, 0.16, { y: h - 0.30, z: d / 2 + 0.02, rx: 0.5, color: OFFICE.paper, mat: 'paper', ao: false });
  // paper roll on the back
  b.cyl(0.06, 0.06, w - 0.24, 12, { y: h - 0.20, z: -d / 2 - 0.03, rz: Math.PI / 2, color: OFFICE.paperWarm, mat: 'paper' });
}

/** Meeting table 2400 x 1000 x 740, solid timber on a trestle frame. */
export function propMeetingTable(b) {
  const w = 2.40, d = 1.00, h = 0.74;
  b.boxUp(w, 0.04, d, { y: h - 0.04, color: OFFICE.walnutSoft, mat: 'wood-dark' });
  b.boxUp(w - 0.60, 0.09, 0.09, { y: h - 0.16, color: OFFICE.steelDark, mat: 'metal' });
  for (const sx of [-1, 1]) {
    b.at({ x: sx * (w / 2 - 0.32) }, (q) => {
      q.boxUp(0.06, h - 0.05, 0.06, { x: -0.14, rz: 0.10, color: OFFICE.steelDark, mat: 'metal' });
      q.boxUp(0.06, h - 0.05, 0.06, { x: 0.14, rz: -0.10, color: OFFICE.steelDark, mat: 'metal' });
      q.boxUp(0.06, h - 0.05, 0.06, { z: -0.32, rx: -0.10, color: OFFICE.steelDark, mat: 'metal' });
      q.boxUp(0.06, h - 0.05, 0.06, { z: 0.32, rx: 0.10, color: OFFICE.steelDark, mat: 'metal' });
    });
  }
}

/** Ficus in a pot: pot 360 across, 1750 overall. Muted foliage on purpose. */
export function propPlantLarge(b, o = {}) {
  const H = o.h ?? 1.75;
  b.cylUp(0.16, 0.19, 0.34, 12, { color: OFFICE.ceramic, mat: 'tile', shade: 0.95 });
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

export function propPlantSmall(b, o = {}) {
  b.cylUp(0.075, 0.085, 0.14, 10, { color: o.pot ?? OFFICE.ceramic, mat: 'tile', ao: false });
  b.cylUp(0.075, 0.075, 0.015, 10, { y: 0.128, color: OFFICE.soil, ao: false });
  let seed = o.seed ?? 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    b.at({ y: 0.14, ry: a, rz: 0.5 + rnd() * 0.6 }, (q) => {
      q.boxUp(0.012, 0.16 + rnd() * 0.10, 0.055, { color: i % 2 ? OFFICE.leaf : OFFICE.leafDark, ao: false });
    });
  }
}

/** Bean-to-cup machine, 300 x 420 x 400. THE accent object #1. */
export function propCoffeeMachine(b) {
  b.boxUp(0.30, 0.34, 0.42, { color: ACCENT, ao: false });
  b.boxUp(0.26, 0.06, 0.02, { y: 0.36, z: 0.20, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.boxUp(0.30, 0.06, 0.42, { y: 0.34, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.cylUp(0.075, 0.075, 0.10, 12, { y: 0.40, z: -0.06, color: 0x3a3430, mat: 'glass', ao: false });  // bean hopper
  b.boxUp(0.20, 0.012, 0.15, { y: 0.085, z: 0.135, color: OFFICE.steel, mat: 'metal', ao: false });  // drip tray
  b.boxUp(0.05, 0.09, 0.05, { y: 0.16, z: 0.09, color: OFFICE.steel, mat: 'metal', ao: false });     // group head
  b.boxUp(0.11, 0.055, 0.006, { y: 0.235, z: 0.212, color: 0x243038, mat: 'ink', ao: false });        // display
}

export function propKettle(b) {
  b.cylUp(0.078, 0.070, 0.20, 12, { color: OFFICE.steel, mat: 'metal', ao: false });
  b.cylUp(0.055, 0.055, 0.02, 12, { y: 0.20, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.boxUp(0.016, 0.12, 0.06, { x: -0.086, y: 0.05, rz: -0.12, color: OFFICE.nearBlack, mat: 'ink', ao: false });
}

/** Wire bin, 300 across, 360 tall. */
export function propBin(b) {
  const R = 0.15;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.cylUp(0.005, 0.005, 0.36, 4, { x: Math.cos(a) * R, z: Math.sin(a) * R, color: OFFICE.charcoal, mat: 'metal' });
  }
  for (const y of [0.05, 0.20, 0.345]) {
    b.cyl(R, R, 0.008, 20, { y, rx: Math.PI / 2, color: OFFICE.charcoal, mat: 'metal', open: true });
  }
  b.cylUp(R - 0.01, R - 0.01, 0.008, 16, { y: 0.01, color: OFFICE.charcoal, mat: 'metal' });
}

export function propCrumpledPaper(b, o = {}) {
  let seed = o.seed ?? 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 5; i++) {
    b.add(new BoxGeometry(0.05 + rnd() * 0.03, 0.05 + rnd() * 0.03, 0.05 + rnd() * 0.03), {
      x: (rnd() - 0.5) * 0.03, y: 0.032 + (rnd() - 0.5) * 0.02, z: (rnd() - 0.5) * 0.03,
      ry: rnd() * 3, rx: rnd() * 3, rz: rnd() * 3,
      color: OFFICE.paper, mat: 'paper', ao: false,
    });
  }
}

/** Corkboard, 1600 x 1100, wall-hung. Origin at the WALL, facing +z. */
export function propCorkboard(b, o = {}) {
  const w = o.w ?? 1.60, h = o.h ?? 1.10;
  b.box(w, h, 0.035, { z: 0.017, color: OFFICE.walnutSoft, mat: 'wood-dark', ao: false });
  b.box(w - 0.07, h - 0.07, 0.012, { z: 0.040, color: 0xc0a883, mat: 'paper', ao: false, shade: 0.92 });
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
  b.cylUp(0.026, 0.026, 0.02, 10, { y: -0.02, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.cyl(0.005, 0.005, drop, 5, { y: -drop / 2, color: OFFICE.nearBlack, mat: 'ink', ao: false });
  b.add(new SphereGeometry(R, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), {
    y: -drop, rx: Math.PI, color: OFFICE.nearBlack, mat: 'ink', ao: false,
  });
  b.cylUp(R * 0.62, R * 0.62, 0.006, 12, { y: -drop - 0.005, color: 0xfff0d8, mat: 'paper', ao: false, shade: 1.4 });
}

/** Floor lamp, 1550 tall, drum shade 340. */
export function propFloorLamp(b) {
  b.cylUp(0.14, 0.15, 0.02, 14, { color: OFFICE.charcoal, mat: 'metal' });
  b.cylUp(0.014, 0.014, 1.42, 8, { y: 0.02, color: OFFICE.charcoal, mat: 'metal' });
  b.cylUp(0.17, 0.15, 0.26, 16, { y: 1.36, color: OFFICE.paper, mat: 'paper', ao: false, open: true });
}

/** A small DAB radio, 280 x 160 x 140. */
export function propRadio(b) {
  b.boxUp(0.28, 0.15, 0.14, { color: OFFICE.walnutSoft, mat: 'wood-dark', ao: false });
  b.cylUp(0.052, 0.052, 0.012, 14, { x: -0.06, y: 0.075, z: 0.07, rx: Math.PI / 2, color: 0x35322d, mat: 'ink', ao: false });
  b.cylUp(0.018, 0.018, 0.014, 10, { x: 0.075, y: 0.095, z: 0.07, rx: Math.PI / 2, color: 0xd6d1c7, mat: 'metal', ao: false });
  b.cylUp(0.018, 0.018, 0.014, 10, { x: 0.075, y: 0.045, z: 0.07, rx: Math.PI / 2, color: 0xd6d1c7, mat: 'metal', ao: false });
  b.cylUp(0.003, 0.003, 0.30, 5, { x: 0.11, y: 0.15, rz: -0.25, color: OFFICE.steel, mat: 'metal', ao: false });
}

/** Flat-woven rug. Big enough to break the floor up (finish bar item 13). */
export function propRug(b, o = {}) {
  const w = o.w ?? 3.00, d = o.d ?? 2.10;
  b.boxUp(w, 0.014, d, { color: o.color ?? OFFICE.wool, ao: false });
  b.boxUp(w - 0.16, 0.002, d - 0.16, { y: 0.014, color: o.color2 ?? OFFICE.woolDk, ao: false });
  b.boxUp(w - 0.30, 0.002, d - 0.30, { y: 0.0155, color: o.color ?? OFFICE.wool, ao: false });
}

export function propCardboardBox(b, o = {}) {
  const w = o.w ?? 0.40, h = o.h ?? 0.30, d = o.d ?? 0.40;
  b.boxUp(w, h, d, { color: OFFICE.ply, shade: 0.94 });
  b.boxUp(w * 0.55, 0.002, 0.05, { y: h + 0.001, color: OFFICE.paper, mat: 'paper', ao: false });
}

/** Cubicle screen: 1200 x 1350, felt on a steel foot. */
export function propPartition(b, o = {}) {
  const w = o.w ?? 1.20, h = o.h ?? 1.35;
  b.boxUp(w, h - 0.06, 0.042, { y: 0.06, color: o.color ?? 0xffffff });
  b.boxUp(w, 0.03, 0.05, { y: h - 0.03, color: OFFICE.steelDark, mat: 'metal' });
  for (const sx of [-1, 1]) b.boxUp(0.05, 0.06, 0.30, { x: sx * (w / 2 - 0.06), color: OFFICE.steelDark, mat: 'metal' });
}

/** Kitchenette run: 1800 x 600 x 900, sink + splashback. Faces +z. */
export function propCoffeeCounter(b, o = {}) {
  const w = o.w ?? 1.80, d = 0.60, h = 0.90;
  b.boxUp(w, 0.10, d - 0.06, { z: 0.03, color: OFFICE.charcoal, mat: 'ink', shade: 0.6 });
  b.boxUp(w, h - 0.14, d, { y: 0.10, color: OFFICE.wallShade });
  for (let i = 0; i < 3; i++) {
    b.boxUp(w / 3 - 0.02, h - 0.20, 0.012, { x: -w / 3 + i * (w / 3), y: 0.13, z: d / 2, color: OFFICE.wallShade, shade: 1.1 });
    b.boxUp(0.012, 0.012, 0.024, { x: -w / 3 + i * (w / 3) + w / 6 - 0.06, y: h - 0.16, z: d / 2 + 0.014, color: OFFICE.steel, mat: 'metal', ao: false });
  }
  b.boxUp(w + 0.02, 0.04, d + 0.02, { y: h - 0.04, color: 0xdedad1, mat: 'polishedConcrete' });
  // 400 x 340 sink + mixer
  b.boxUp(0.40, 0.012, 0.34, { x: w / 2 - 0.34, y: h - 0.05, color: OFFICE.steel, mat: 'metal', ao: false });
  b.boxUp(0.42, 0.05, 0.36, { x: w / 2 - 0.34, y: h - 0.09, color: OFFICE.steelDark, mat: 'metal', ao: false });
  b.cylUp(0.018, 0.016, 0.24, 10, { x: w / 2 - 0.34, y: h, z: -0.19, color: OFFICE.steel, mat: 'metal', ao: false });
  b.cylUp(0.012, 0.012, 0.16, 8, { x: w / 2 - 0.34, y: h + 0.235, z: -0.11, rx: Math.PI / 2, color: OFFICE.steel, mat: 'metal', ao: false });
}

/** A wall shelf on two brackets, 1200 x 250. Origin AT THE WALL, facing +z. */
export function propWallShelf(b, o = {}) {
  const w = o.w ?? 1.20, d = o.d ?? 0.25;
  b.box(w, 0.03, d, { z: d / 2, color: OFFICE.oakPale, mat: 'wood-light', ao: false });
  for (const sx of [-1, 1]) {
    b.box(0.02, 0.16, 0.02, { x: sx * (w / 2 - 0.14), y: -0.09, z: 0.02, color: OFFICE.steelDark, mat: 'metal', ao: false });
    b.box(0.02, 0.02, d - 0.06, { x: sx * (w / 2 - 0.14), y: -0.025, z: d / 2 - 0.02, color: OFFICE.steelDark, mat: 'metal', ao: false });
  }
}

/** Triangular scale rule, 300 mm. Tiny, but an architect will notice it. */
export function propScaleRule(b) {
  b.add(new CylinderGeometry(0.016, 0.016, 0.30, 3), { rz: Math.PI / 2, y: 0.009, color: OFFICE.paper, mat: 'paper', ao: false });
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
    b.boxUp(w, h, d, { x, z, y: 0.015, color: 0xf0eade, mat: 'paper', ao: false });
    b.boxUp(w + 0.004, 0.002, d + 0.004, { x, z, y: 0.015 + h, color: 0xd8d2c4, mat: 'paper', ao: false });
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
  b.boxUp(0.22, 0.010, 0.16, { color: OFFICE.ply, ao: false });
  b.boxUp(0.09, 0.055, 0.07, { x: -0.04, y: 0.010, ry: 0.2, color: 0xeee7d9, mat: 'paper', ao: false });
  b.boxUp(0.06, 0.030, 0.06, { x: 0.05, z: 0.02, y: 0.010, ry: -0.3, color: 0xeee7d9, mat: 'paper', ao: false });
  b.boxUp(0.20, 0.008, 0.14, { y: 0.075, ry: 0.12, color: OFFICE.ply, ao: false });
  b.boxUp(0.05, 0.05, 0.05, { y: 0.083, x: 0.02, ry: 0.6, color: 0xe6dfd0, mat: 'paper', ao: false });
}


/**
 * Low samples credenza, 0.72 m high, along the pin-up wall. Every studio has
 * one and it is where the material samples, the boxed models and the half-empty
 * box of the last competition live. 1800 x 450 x 720.
 */
export function propCredenza(b, o = {}) {
  const w = o.w ?? 1.80, d = 0.45, h = 0.72;
  b.boxUp(w, 0.09, d - 0.06, { y: 0, z: 0.03, color: OFFICE.charcoal, mat: 'ink' });
  b.boxUp(w, h - 0.13, d, { y: 0.09, color: o.color ?? OFFICE.wallShade });
  const bays = Math.max(2, Math.round(w / 0.60));
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + (i + 0.5) * (w / bays);
    b.boxUp(w / bays - 0.02, h - 0.20, 0.012, { x, y: 0.12, z: d / 2, color: o.color ?? OFFICE.wallShade, shade: 1.08 });
    b.boxUp(0.10, 0.012, 0.022, { x, y: h - 0.20, z: d / 2 + 0.014, color: 0xd6d1c7, mat: 'metal', ao: false });
  }
  b.boxUp(w + 0.02, 0.04, d + 0.02, { y: h - 0.04, color: OFFICE.oakPale, mat: 'wood-light' });
}

/** A tray of material samples: nine 100 mm tiles of nine different finishes. */
export function propSampleTray(b) {
  b.boxUp(0.34, 0.02, 0.26, { color: OFFICE.ply, ao: false });
  const mats = [
    ['tile', 0xe9e6df], ['flat', OFFICE.limewash], ['wood-light', OFFICE.oakPale],
    ['flat', 0x8f877b], ['polishedConcrete', OFFICE.concreteFloor], ['flat', 0x6c655c],
    ['metal', 0xc9c6bf], ['flat', OFFICE.walnutSoft], ['tile', 0xd6d2c8],
  ];
  for (let i = 0; i < 9; i++) {
    const [mat, c] = mats[i];
    b.boxUp(0.092, 0.008, 0.072, {
      x: -0.105 + (i % 3) * 0.105, z: -0.08 + Math.floor(i / 3) * 0.08, y: 0.02,
      color: c, mat, ao: false,
    });
  }
}

/** A tall stack of A1 prints lying flat, the way they actually pile up. */
export function propPrintPile(b, o = {}) {
  const n = o.n ?? 14;
  for (let i = 0; i < n; i++) {
    b.boxUp(0.594, 0.0022, 0.841, {
      y: i * 0.0022, ry: (i % 5 - 2) * 0.012, x: (i % 3 - 1) * 0.004,
      color: i % 4 === 0 ? OFFICE.paperWarm : OFFICE.paper, mat: 'paper', ao: false,
    });
  }
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
  floorLamp: propFloorLamp, radio: propRadio, rug: propRug,
  cardboardBox: propCardboardBox, partition: propPartition,
  coffeeCounter: propCoffeeCounter, wallShelf: propWallShelf,
  scaleRule: propScaleRule, massingModel: propMassingModel,
  studyModels: propStudyModels, credenza: propCredenza,
  sampleTray: propSampleTray, printPile: propPrintPile,
};
