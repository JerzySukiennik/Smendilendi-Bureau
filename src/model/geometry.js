// geometry.js — turns a BuildingModel into meshes and colliders.
//
// This is the only file under src/model/ allowed to import three in full,
// because it produces BufferGeometry / Mesh / Group. It still touches no DOM,
// no renderer, no three/addons, and imports cleanly in bare node.
//
// Principles
//  * Openings are GAPS IN THE EXTRUSION. Never CSG. A wall is emitted as a run of
//    quad prisms: solid, under-window pier, lintel, solid, ... plus explicit reveal
//    faces so a door shows 0.24 m of wall thickness in the jamb.
//  * Wall ends MITRE. Every incident wall end at a node is paired with its angular
//    neighbour and their facing side-lines are intersected. Degree 2 gives a clean
//    mitre; degree >= 3 gives a butt join onto the through-wall's face for free.
//  * All walls of one level sharing one material land in ONE BufferGeometry. The
//    merge is written here (see Sink / finishSink) — no BufferGeometryUtils.
//  * A per-vertex `aoValue` float bakes contact darkening at floor and ceiling
//    junctions, inside corners, reveals and lintel soffits. It is wired into the
//    standard material with onBeforeCompile.
//
// Units: metres everywhere. Plan is (x, z); y is up.

import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  Group,
  MeshStandardMaterial,
  Box3,
  Color,
  FrontSide,
  DoubleSide,
} from 'three';

// ---------------------------------------------------------------------------
// palette — owned by another agent (src/core/palette.js). Tolerate its absence.
// Equivalent to: import { MATERIALS, materialFor } from '../core/palette.js'
// but done dynamically so this module still loads before that file exists.

let MATERIALS = null;
let materialFor = null;
try {
  // Equivalent to: import { MATERIALS, materialFor } from '../core/palette.js'
  // Done dynamically so this module still loads if palette.js is not there yet.
  const pal = await import('../core/palette.js');
  MATERIALS = pal.MATERIALS ?? pal.MATERIAL_CLASSES ?? null;
  materialFor = typeof pal.materialFor === 'function' ? pal.materialFor : null;
} catch {
  MATERIALS = null;
  materialFor = null;
}

/**
 * The model stores its own material vocabulary ('render', 'screed', ...). Map it
 * onto the palette's ids so nothing falls back to plaster by accident.
 */
export const MATERIAL_ALIAS = {
  render: 'plaster-warm',
  screed: 'concrete',
  wood: 'wood-mid',
  stone: 'concrete',
  timber: 'wood-mid',
};

/** Local fallback table, used until palette.js lands. Warm, low-poly, flat. */
export const FALLBACK_MATERIALS = {
  plaster:  { color: 0xece6dc, roughness: 0.94, metalness: 0.0 },
  render:   { color: 0xd9d2c4, roughness: 0.92, metalness: 0.0 },
  brick:    { color: 0xa8624a, roughness: 0.95, metalness: 0.0 },
  concrete: { color: 0xb9b6b0, roughness: 0.88, metalness: 0.0 },
  wood:     { color: 0xb98a56, roughness: 0.72, metalness: 0.0 },
  tile:     { color: 0xd7dcd8, roughness: 0.45, metalness: 0.0 },
  screed:   { color: 0xc6c2ba, roughness: 0.90, metalness: 0.0 },
  paving:   { color: 0xa9a7a2, roughness: 0.95, metalness: 0.0 },
  grass:    { color: 0x7d9b5a, roughness: 1.00, metalness: 0.0 },
  glass:    { color: 0xbcd6e0, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.32 },
};

const DEFAULT_MAT_KEY = 'plaster';

// ---------------------------------------------------------------------------
// constants

export const SLAB_THICKNESS = 0.30;   // structural slab + build-up, matches building.js
const MIN_WALL_LENGTH = 0.05;         // shorter than 50 mm is a modelling artefact
const MIN_PIER = 0.06;                // keep 60 mm of wall beside an opening
const MITRE_CLAMP = 0.45;             // never trim/extend more than 45 % of a wall
const EPSU = 1e-4;

// AO tuning (all in metres)
const AO_FLOOR_BAND = 0.40;
const AO_CEIL_BAND = 0.30;
const AO_CORNER_BAND = 0.35;
const AO_FLOOR_MIN = 0.55;
const AO_CEIL_MIN = 0.80;
const AO_CORNER_MIN = 0.70;
const AO_SOFFIT = 0.55;               // under a lintel
const AO_REVEAL = 0.78;               // inside a jamb
const AO_SLAB_EDGE = 0.62;            // slab within AO_SLAB_BAND of a wall line
const AO_SLAB_BAND = 0.45;

// ---------------------------------------------------------------------------
// tiny math

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;

function leftNormal(d) { return { x: -d.z, z: d.x }; }

// ---------------------------------------------------------------------------
// Sink — the merge. One sink per material key; walls append into it and we
// remember the vertex range each entity occupies so the editor can highlight a
// single wall inside the merged mesh.

class Sink {
  constructor(matKey) {
    this.matKey = matKey;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.ao = [];
  }
  get vertexCount() { return this.pos.length / 3; }

  /** One quad p0-p1-p2-p3, wound so its normal matches `want`. */
  quad(p0, p1, p2, p3, want, uvs, aos) {
    // geometric normal of (p0,p1,p2)
    const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
    const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;                       // degenerate quad, drop it
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (want && (nx * want.x + ny * want.y + nz * want.z) < 0) {
      flip = true; nx = -nx; ny = -ny; nz = -nz;
    }
    const A = flip ? [p0, p2, p1, p0, p3, p2] : [p0, p1, p2, p0, p2, p3];
    const U = flip ? [uvs[0], uvs[2], uvs[1], uvs[0], uvs[3], uvs[2]]
                   : [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]];
    const O = flip ? [aos[0], aos[2], aos[1], aos[0], aos[3], aos[2]]
                   : [aos[0], aos[1], aos[2], aos[0], aos[2], aos[3]];
    for (let i = 0; i < 6; i++) {
      this.pos.push(A[i].x, A[i].y, A[i].z);
      this.nrm.push(nx, ny, nz);
      this.uv.push(U[i][0], U[i][1]);
      this.ao.push(O[i]);
    }
  }

  /** One triangle with an explicit normal (used by the slab triangulator). */
  tri(p0, p1, p2, want, uvs, aos) {
    const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
    const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return;
    nx /= len; ny /= len; nz /= len;
    let flip = false;
    if (want && (nx * want.x + ny * want.y + nz * want.z) < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const A = flip ? [p0, p2, p1] : [p0, p1, p2];
    const U = flip ? [uvs[0], uvs[2], uvs[1]] : [uvs[0], uvs[1], uvs[2]];
    const O = flip ? [aos[0], aos[2], aos[1]] : [aos[0], aos[1], aos[2]];
    for (let i = 0; i < 3; i++) {
      this.pos.push(A[i].x, A[i].y, A[i].z);
      this.nrm.push(nx, ny, nz);
      this.uv.push(U[i][0], U[i][1]);
      this.ao.push(O[i]);
    }
  }
}

function sinkToGeometry(sink) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(sink.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(sink.nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(sink.uv), 2));
  g.setAttribute('aoValue', new BufferAttribute(new Float32Array(sink.ao), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Concatenate several BufferGeometries that share the same attribute layout.
 * Hand-written on purpose — BufferGeometryUtils lives in three/addons, which is
 * off limits here. Returns { geometry, ranges: [{start, count}] }.
 */
export function mergeGeometries(geoms) {
  const names = ['position', 'normal', 'uv', 'aoValue'];
  const sizes = { position: 3, normal: 3, uv: 2, aoValue: 1 };
  let total = 0;
  for (const g of geoms) total += g.getAttribute('position').count;
  const out = new BufferGeometry();
  const arrays = {};
  for (const n of names) arrays[n] = new Float32Array(total * sizes[n]);
  const ranges = [];
  let at = 0;
  for (const g of geoms) {
    const count = g.getAttribute('position').count;
    for (const n of names) {
      const src = g.getAttribute(n);
      if (!src) continue;
      arrays[n].set(src.array.subarray(0, count * sizes[n]), at * sizes[n]);
    }
    ranges.push({ start: at, count });
    at += count;
  }
  for (const n of names) out.setAttribute(n, new BufferAttribute(arrays[n], sizes[n]));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { geometry: out, ranges };
}

// ---------------------------------------------------------------------------
// materials

const AO_CHUNK_V = `
attribute float aoValue;
varying float vBakedAO;
`;
const AO_CHUNK_F = `
varying float vBakedAO;
`;

// The hook is a module singleton so idempotence can be keyed off the function
// ACTUALLY BEING INSTALLED. Material.copy() clones userData but does NOT clone
// onBeforeCompile, so a userData flag survives a clone that has lost the hook —
// which would leave the clone unpatched while claiming otherwise.
function aoHook(shader) {
  shader.vertexShader = AO_CHUNK_V + shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\n  vBakedAO = aoValue;'
  );
  shader.fragmentShader = AO_CHUNK_F + shader.fragmentShader.replace(
    '#include <color_fragment>',
    '#include <color_fragment>\n  diffuseColor.rgb *= vBakedAO;'
  );
}
function aoCacheKey() { return 'smendilendi-vertex-ao'; }

/** Wire the aoValue attribute into a standard material. Idempotent. */
export function applyVertexAO(material) {
  if (!material) return material;
  if (material.onBeforeCompile === aoHook) return material;
  material.onBeforeCompile = aoHook;
  material.customProgramCacheKey = aoCacheKey;
  material.needsUpdate = true;
  material.userData = material.userData || {};
  material.userData.__aoPatched = true;   // informational only, never gating
  return material;
}

/** True when `material` really carries the vertex-AO hook (test helper). */
export function hasVertexAO(material) {
  return !!material && material.onBeforeCompile === aoHook;
}

function makeMaterial(key) {
  const id = MATERIAL_ALIAS[key] || key;
  // palette.js hands out CACHED SINGLETONS shared with furniture and props. Those
  // meshes have no aoValue attribute, and a missing attribute reads as 0 in GLSL —
  // patching the shared instance would turn every prop black. So always clone.
  if (materialFor && MATERIALS && MATERIALS[id]) {
    const m = materialFor(id).clone();
    m.name = `mat:${key}`;
    return applyVertexAO(m);
  }
  let spec = (MATERIALS && MATERIALS[id]) || FALLBACK_MATERIALS[id] || FALLBACK_MATERIALS[key] || FALLBACK_MATERIALS[DEFAULT_MAT_KEY];
  const m = new MeshStandardMaterial({
    color: new Color(spec.color ?? 0xcccccc),
    roughness: spec.roughness ?? 0.9,
    metalness: spec.metalness ?? 0.0,
    transparent: !!(spec.transparent || spec.glass),
    opacity: spec.opacity ?? (spec.glass ? 0.28 : 1),
    side: (spec.transparent || spec.glass) ? DoubleSide : FrontSide,
  });
  m.name = `mat:${key}`;
  return applyVertexAO(m);
}

// ---------------------------------------------------------------------------
// junction solver — the mitre

/**
 * For every wall end at every node, resolve the two plan corner points where the
 * wall's side faces stop. Ends are sorted by angle around the node; the sector
 * between end i and end i+1 is bounded by i's LEFT side and (i+1)'s RIGHT side,
 * so intersecting those two lines mitres both at once.
 *
 * degree 1  -> the pair is the end with itself: parallel lines, flat cap.
 * degree 2  -> a true mitre (or a flat cut when the walls are collinear).
 * degree >=3 -> each pair mitres with its angular neighbour, which for a T is
 *               exactly a butt join onto the through-wall's face.
 */
function solveJunctions(model, walls) {
  const ends = new Map();          // wallId -> { a: End, b: End }
  const byNode = new Map();        // nodeId -> End[]

  for (const w of walls) {
    const na = model.nodes[w.a], nb = model.nodes[w.b];
    if (!na || !nb) continue;
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    if (len < MIN_WALL_LENGTH) continue;
    const d = { x: dx / len, z: dz / len };
    const half = Math.max(w.thickness, 0.02) / 2;
    const eA = { wallId: w.id, node: w.a, dir: d, half, len, left: null, right: null };
    const eB = { wallId: w.id, node: w.b, dir: { x: -d.x, z: -d.z }, half, len, left: null, right: null };
    ends.set(w.id, { a: eA, b: eB });
    if (!byNode.has(w.a)) byNode.set(w.a, []);
    if (!byNode.has(w.b)) byNode.set(w.b, []);
    byNode.get(w.a).push(eA);
    byNode.get(w.b).push(eB);
  }

  for (const [nodeId, list] of byNode) {
    const n = model.nodes[nodeId];
    list.sort((p, q) => Math.atan2(p.dir.z, p.dir.x) - Math.atan2(q.dir.z, q.dir.x));
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const e = list[i];
      const nx = list[(i + 1) % count];
      const ln = leftNormal(e.dir);
      const rn = leftNormal(nx.dir);
      // e's LEFT line and nx's RIGHT line
      const P1 = { x: n.x + ln.x * e.half, z: n.z + ln.z * e.half };
      const P2 = { x: n.x - rn.x * nx.half, z: n.z - rn.z * nx.half };
      const den = cross2(e.dir.x, e.dir.z, nx.dir.x, nx.dir.z);
      let t = 0, s = 0;
      if (Math.abs(den) > 1e-9) {
        const wx = P2.x - P1.x, wz = P2.z - P1.z;
        t = cross2(wx, wz, nx.dir.x, nx.dir.z) / den;
        s = cross2(wx, wz, e.dir.x, e.dir.z) / den;
        const lim = MITRE_CLAMP * Math.min(e.len, nx.len);
        if (t > lim) t = lim; else if (t < -lim) t = -lim;
        if (s > lim) s = lim; else if (s < -lim) s = -lim;
      }
      e.left = { x: P1.x + e.dir.x * t, z: P1.z + e.dir.z * t };
      nx.right = { x: P2.x + nx.dir.x * s, z: P2.z + nx.dir.z * s };
    }
    // degree-1 safety: the self-pair produced parallel lines, both flat at the node
    for (const e of list) {
      const ln = leftNormal(e.dir);
      if (!e.left) e.left = { x: n.x + ln.x * e.half, z: n.z + ln.z * e.half };
      if (!e.right) e.right = { x: n.x - ln.x * e.half, z: n.z - ln.z * e.half };
    }
  }

  const degree = new Map();
  const caps = new Map();
  for (const [nodeId, list] of byNode) {
    degree.set(nodeId, list.length);
    // The mitre pairing covers the SIDE faces of a junction but leaves the middle
    // of a crossing open: at a 0.24 m X junction the square [-0.12, 0.12]^2 of the
    // wall top is simply missing, and you look straight down through it in the
    // top-down editor view (and it leaks the shadow map). Walk the ends in angular
    // order emitting right-then-left corner; consecutive ends share a corner when
    // the mitre solved cleanly, so the result is the node's own convex plan
    // polygon: a square at an X, a triangle at a T, nothing at a degree-1 or -2 end.
    if (list.length < 3) continue;
    const poly = [];
    const push = (p) => {
      if (!p) return;
      const last = poly[poly.length - 1];
      if (last && Math.abs(last[0] - p.x) < 1e-7 && Math.abs(last[1] - p.z) < 1e-7) return;
      poly.push([p.x, p.z]);
    };
    for (const e of list) { push(e.right); push(e.left); }
    while (poly.length > 1) {
      const f = poly[0], l = poly[poly.length - 1];
      if (Math.abs(f[0] - l[0]) < 1e-7 && Math.abs(f[1] - l[1]) < 1e-7) poly.pop();
      else break;
    }
    if (poly.length < 3) continue;
    if (Math.abs(polygonArea(poly)) < 1e-9) continue;
    // One owner emits it, so the cap exists exactly once in a merged build and a
    // single-wall build stays self-consistent.
    let owner = list[0];
    for (const e of list) if (e.half > owner.half) owner = e;
    caps.set(nodeId, { poly, owner: owner.wallId });
  }
  return { ends, degree, caps };
}

// ---------------------------------------------------------------------------
// openings

/**
 * Sorted, clamped, non-overlapping list of openings for one wall.
 *
 * Diagnostics are DATA. Pass `diag` (an array) and every complaint is pushed onto
 * it as { wallId, openingId, code, message, ... }; the builder hands that array
 * back on the build result. Only a standalone call with no `diag` falls back to
 * console.warn — the geometry hot path must never format strings per frame.
 *
 * A door flush with the end of its wall is legal architecture (a door in the
 * corner of a room), so MIN_PIER is enforced only BETWEEN openings, never against
 * the wall ends. The rendered hole therefore lands exactly where the model says
 * it does; gizmos, dimension strings and hit-tests all agree.
 */
export function resolveOpenings(model, wall, length, wallHeight, diag = null) {
  const note = (openingId, code, message, extra) => {
    const rec = { wallId: wall.id, openingId, code, message, ...(extra || {}) };
    if (diag) diag.push(rec);
    else console.warn(`geometry: wall ${wall.id}: ${message}`);
    return rec;
  };

  const raw = (wall.openings || [])
    .map((id) => model.openings[id])
    .filter(Boolean)
    .slice()
    .sort((a, b) => a.offset - b.offset);

  const out = [];
  let cursor = 0;                       // wall start: flush is allowed
  for (const o of raw) {
    let width = Math.max(0.05, o.width || 0);
    if (width > length + EPSU) {
      note(o.id, 'too-wide',
        `opening ${o.id} (${width.toFixed(2)} m) does not fit in a ${length.toFixed(2)} m wall — skipped`,
        { width, length });
      continue;
    }
    const centre = o.offset;
    let from = centre - width / 2;
    let to = centre + width / 2;

    if (out.length > 0 && from < out[out.length - 1].to - EPSU) {
      note(o.id, 'overlap',
        `opening ${o.id} overlaps ${out[out.length - 1].id} — skipped`,
        { previousId: out[out.length - 1].id });
      continue;
    }
    if (from < cursor - EPSU) {
      const shift = cursor - from;
      if (to + shift > length + EPSU) {
        note(o.id, 'no-room',
          `opening ${o.id} cannot be placed clear of its neighbours — skipped`, { shift });
        continue;
      }
      from += shift; to += shift;
      note(o.id, 'moved',
        `opening ${o.id} moved ${shift.toFixed(3)} m to clear its neighbour — model offset ${centre.toFixed(3)} m now reads ${(from + width / 2).toFixed(3)} m`,
        { shift, modelOffset: centre, builtOffset: from + width / 2 });
    }
    if (to > length + EPSU) {
      const shift = to - length;
      from -= shift; to -= shift;
      if (from < cursor - EPSU) {
        note(o.id, 'no-room',
          `opening ${o.id} cannot be placed clear of its neighbours — skipped`, { shift });
        continue;
      }
      note(o.id, 'moved',
        `opening ${o.id} moved ${shift.toFixed(3)} m off the wall end — model offset ${centre.toFixed(3)} m now reads ${(from + width / 2).toFixed(3)} m`,
        { shift, modelOffset: centre, builtOffset: from + width / 2 });
    }

    const isDoor = o.kind === 'door';
    let sill = isDoor ? 0 : Math.max(0, o.sill ?? 0.85);
    let head = sill + Math.max(0.10, o.height || 0);
    if (head > wallHeight - 0.02) {
      const over = head - (wallHeight - 0.02);
      if (sill - over >= 0) { sill -= over; head -= over; }
      else { head = wallHeight; sill = Math.max(0, Math.min(sill, head - 0.10)); }
      note(o.id, 'head-lowered',
        `opening ${o.id} taller than the ${wallHeight.toFixed(2)} m storey — head lowered to ${head.toFixed(2)} m`,
        { head, sill });
    }

    out.push({ id: o.id, kind: o.kind, from, to, sill, head, width: to - from, ref: o });
    cursor = to + MIN_PIER;
  }
  return out;
}

// ---------------------------------------------------------------------------
// one wall

function wallContext(model, wall, junc, opts) {
  const na = model.nodes[wall.a], nb = model.nodes[wall.b];
  if (!na || !nb) return null;
  const dx = nb.x - na.x, dz = nb.z - na.z;
  const length = Math.hypot(dx, dz);
  if (length < MIN_WALL_LENGTH) return null;
  const dir = { x: dx / length, z: dz / length };
  const e = junc.ends.get(wall.id);
  if (!e) return null;

  // wall-left face passes through endA.left and endB.right (endB's frame is reversed)
  const leftA = e.a.left, leftB = e.b.right;
  const rightA = e.a.right, rightB = e.b.left;

  const uOf = (p) => (p.x - na.x) * dir.x + (p.z - na.z) * dir.z;
  const uLA = uOf(leftA), uRA = uOf(rightA);
  const uLB = uOf(leftB), uRB = uOf(rightB);

  const level = model.levels.find((l) => l.id === wall.levelId) || model.levels[0];
  const base = level ? level.elevation : 0;
  const height = opts.wallHeight ?? (level ? level.height : 2.70);

  const cornerA = (junc.degree.get(wall.a) ?? 1) >= 2;
  const cornerB = (junc.degree.get(wall.b) ?? 1) >= 2;

  return {
    id: wall.id, wall, na, nb, dir, length, base, height,
    leftA, leftB, rightA, rightB, uLA, uLB, uRA, uRB,
    cornerA, cornerB,
    matInner: wall.matInner || DEFAULT_MAT_KEY,
    matOuter: wall.matOuter || 'render',
    aoStrength: opts.ao ?? 1,
    // face point at centreline parameter u; the mitred plan corners are used at
    // the extremities so the junction stays watertight.
    leftAt(u) {
      if (u <= EPSU) return { x: leftA.x, z: leftA.z };
      if (u >= this.length - EPSU) return { x: leftB.x, z: leftB.z };
      return { x: leftA.x + dir.x * (u - uLA), z: leftA.z + dir.z * (u - uLA) };
    },
    rightAt(u) {
      if (u <= EPSU) return { x: rightA.x, z: rightA.z };
      if (u >= this.length - EPSU) return { x: rightB.x, z: rightB.z };
      return { x: rightA.x + dir.x * (u - uRA), z: rightA.z + dir.z * (u - uRA) };
    },
    uAtLeft(u) { return u <= EPSU ? uLA : (u >= this.length - EPSU ? uLB : u); },
    uAtRight(u) { return u <= EPSU ? uRA : (u >= this.length - EPSU ? uRB : u); },
    // Point on a side face at that face's OWN parameter p (metres along the
    // centreline direction from node a). Unlike leftAt(u) this does not snap to
    // the mitre corner, so a face can be subdivided between its two mitred ends
    // without any sub-quad running backwards past one of them.
    leftAtParam(p) { return { x: leftA.x + dir.x * (p - uLA), z: leftA.z + dir.z * (p - uLA) }; },
    rightAtParam(p) { return { x: rightA.x + dir.x * (p - uRA), z: rightA.z + dir.z * (p - uRA) }; },
  };
}

/** Baked AO for a point on a wall face. 1 = open, < 1 = occluded. */
function wallAO(ctx, u, y, mul = 1) {
  let a = AO_FLOOR_MIN + (1 - AO_FLOOR_MIN) * smooth01((y - ctx.base) / AO_FLOOR_BAND);
  a *= AO_CEIL_MIN + (1 - AO_CEIL_MIN) * smooth01((ctx.base + ctx.height - y) / AO_CEIL_BAND);
  if (ctx.cornerA) a *= AO_CORNER_MIN + (1 - AO_CORNER_MIN) * smooth01(u / AO_CORNER_BAND);
  if (ctx.cornerB) a *= AO_CORNER_MIN + (1 - AO_CORNER_MIN) * smooth01((ctx.length - u) / AO_CORNER_BAND);
  a *= mul;
  const k = clamp01(ctx.aoStrength);
  return 1 + (a - 1) * k;
}

const P = (p, y) => ({ x: p.x, y, z: p.z });

/** [a, ...interior cuts strictly inside (a,b)..., b], sorted and deduplicated. */
function cutList(a, b, cuts) {
  const out = [a];
  for (const c of cuts) {
    if (c == null) continue;
    if (c > a + 0.02 && c < b - 0.02) out.push(c);
  }
  out.push(b);
  out.sort((p, q) => p - q);
  return out;
}

/**
 * Emit one prism of wall between centreline parameters u0..u1 and heights y0..y1.
 * `faces` selects which of the six sides are written.
 */
function emitPrism(ctx, sinkFor, u0, u1, y0, y1, faces) {
  if (y1 - y0 < EPSU) return;
  // A zero-length "prism" is a reveal: only its cap quad is wanted.
  if (u1 - u0 < EPSU && !faces.capStart && !faces.capEnd) return;
  const L0 = ctx.leftAt(u0), L1 = ctx.leftAt(u1);
  const R0 = ctx.rightAt(u0), R1 = ctx.rightAt(u1);
  const uL0 = ctx.uAtLeft(u0), uL1 = ctx.uAtLeft(u1);
  const uR0 = ctx.uAtRight(u0), uR1 = ctx.uAtRight(u1);
  const nL = leftNormal(ctx.dir);
  const t = Math.hypot(R0.x - L0.x, R0.z - L0.z);
  const aoMul = faces.aoMul ?? 1;

  // Left and right faces are subdivided on the AO band boundaries. Without this
  // a 2.70 m wall face would have four corners and the floor-contact darkening
  // would smear linearly over the whole storey instead of hugging the skirting.
  //
  // The subdivision runs in EACH FACE'S OWN parameter space, from that face's
  // start mitre to its end mitre. Cutting in centreline u instead lets a sub-quad
  // run backwards whenever the mitre setback (t/2)/tan(theta/2) exceeds a cut
  // position — an acute or thick corner then overshoots the mitre and coplanar
  // quads double-cover each other, which z-fights.
  const yCuts = cutList(y0, y1, [
    ctx.base + AO_FLOOR_BAND,
    ctx.base + ctx.height - AO_CEIL_BAND,
  ]);
  const bandCuts = [
    ctx.cornerA ? AO_CORNER_BAND : null,
    ctx.cornerB ? ctx.length - AO_CORNER_BAND : null,
  ];

  const emitSide = (which) => {
    const isLeft = which === 'left';
    const sink = sinkFor(isLeft ? ctx.matInner : ctx.matOuter);
    const want = isLeft ? { x: nL.x, y: 0, z: nL.z } : { x: -nL.x, y: 0, z: -nL.z };
    const pa = isLeft ? ctx.uAtLeft(u0) : ctx.uAtRight(u0);
    const pb = isLeft ? ctx.uAtLeft(u1) : ctx.uAtRight(u1);
    if (pb - pa < EPSU) return;                    // face swallowed by its mitres
    const pCuts = cutList(pa, pb, bandCuts);
    const at = isLeft ? (p) => ctx.leftAtParam(p) : (p) => ctx.rightAtParam(p);
    for (let i = 0; i < pCuts.length - 1; i++) {
      const ta = pCuts[i], tb = pCuts[i + 1];
      const A = at(ta), B = at(tb);
      for (let j = 0; j < yCuts.length - 1; j++) {
        const ya = yCuts[j], yb = yCuts[j + 1];
        sink.quad(
          P(A, ya), P(B, ya), P(B, yb), P(A, yb),
          want,
          [[ta, ya - ctx.base], [tb, ya - ctx.base], [tb, yb - ctx.base], [ta, yb - ctx.base]],
          [wallAO(ctx, ta, ya, aoMul), wallAO(ctx, tb, ya, aoMul), wallAO(ctx, tb, yb, aoMul), wallAO(ctx, ta, yb, aoMul)]
        );
      }
    }
  };
  if (faces.left !== false) emitSide('left');
  if (faces.right !== false) emitSide('right');
  // top
  if (faces.top) {
    sinkFor(faces.topMat ?? ctx.matOuter).quad(
      P(L0, y1), P(R0, y1), P(R1, y1), P(L1, y1),
      { x: 0, y: 1, z: 0 },
      [[uL0, 0], [uR0, t], [uR1, t], [uL1, 0]],
      [wallAO(ctx, u0, y1, aoMul), wallAO(ctx, u0, y1, aoMul), wallAO(ctx, u1, y1, aoMul), wallAO(ctx, u1, y1, aoMul)]
    );
  }
  // bottom (only when it floats — a sill soffit; the ground face is never seen)
  if (faces.bottom) {
    const m = faces.bottomAo ?? aoMul;
    sinkFor(faces.bottomMat ?? ctx.matInner).quad(
      P(L0, y0), P(L1, y0), P(R1, y0), P(R0, y0),
      { x: 0, y: -1, z: 0 },
      [[uL0, 0], [uL1, 0], [uR1, t], [uR0, t]],
      [wallAO(ctx, u0, y0, m), wallAO(ctx, u1, y0, m), wallAO(ctx, u1, y0, m), wallAO(ctx, u0, y0, m)]
    );
  }
  // caps / reveals, perpendicular to the wall
  if (faces.capStart) {
    const m = faces.capAo ?? aoMul;
    sinkFor(faces.capMat ?? ctx.matInner).quad(
      P(L0, y0), P(R0, y0), P(R0, y1), P(L0, y1),
      { x: -ctx.dir.x * (faces.capStartOut ?? 1), y: 0, z: -ctx.dir.z * (faces.capStartOut ?? 1) },
      [[0, y0 - ctx.base], [t, y0 - ctx.base], [t, y1 - ctx.base], [0, y1 - ctx.base]],
      [wallAO(ctx, u0, y0, m), wallAO(ctx, u0, y0, m), wallAO(ctx, u0, y1, m), wallAO(ctx, u0, y1, m)]
    );
  }
  if (faces.capEnd) {
    const m = faces.capAo ?? aoMul;
    sinkFor(faces.capMat ?? ctx.matInner).quad(
      P(L1, y0), P(R1, y0), P(R1, y1), P(L1, y1),
      { x: ctx.dir.x * (faces.capEndOut ?? 1), y: 0, z: ctx.dir.z * (faces.capEndOut ?? 1) },
      [[0, y0 - ctx.base], [t, y0 - ctx.base], [t, y1 - ctx.base], [0, y1 - ctx.base]],
      [wallAO(ctx, u1, y0, m), wallAO(ctx, u1, y0, m), wallAO(ctx, u1, y1, m), wallAO(ctx, u1, y1, m)]
    );
  }
}

/** Write one whole wall (with its openings as gaps) into the sinks. */
function emitWall(model, wall, junc, sinkFor, opts) {
  const ctx = wallContext(model, wall, junc, opts);
  if (!ctx) return null;
  const y0 = ctx.base;
  const yTop = ctx.base + ctx.height;
  // Openings are resolved ONCE per wall per build. The caller may hand in the
  // cached list so the collider path does not redo the work (and re-report every
  // diagnostic a second time).
  const holes = opts.openings
    || resolveOpenings(model, wall, ctx.length, ctx.height, opts.diagnostics || null);

  // free ends get a real end cap; mitred ends are closed by the neighbour
  const capA = !ctx.cornerA;
  const capB = !ctx.cornerB;

  let u = 0;
  for (const h of holes) {
    // An opening flush with a free wall end still needs the sill band and the
    // lintel band capped, because the solid run that would normally carry the
    // end cap has zero length there.
    const flushA = capA && h.from <= EPSU;
    const flushB = capB && h.to >= ctx.length - EPSU;
    // solid run before the opening. Its end at h.from is NOT capped: the exposed
    // part of that plane is exactly the reveal, emitted once below, and the rest
    // is buried behind the pier and the lintel.
    if (h.from - u > EPSU) {
      emitPrism(ctx, sinkFor, u, h.from, y0, yTop, {
        top: true,
        capStart: u <= EPSU ? capA : false,
        capEnd: false,
      });
    }
    // under-window pier (sill 0 for a door, so this is skipped there)
    if (h.sill > EPSU) {
      emitPrism(ctx, sinkFor, h.from, h.to, y0, y0 + h.sill, {
        top: true, topMat: ctx.matInner,
        capStart: flushA, capEnd: flushB,
      });
    }
    // lintel over the head
    if (y0 + h.head < yTop - EPSU) {
      emitPrism(ctx, sinkFor, h.from, h.to, y0 + h.head, yTop, {
        top: true,
        bottom: true, bottomAo: AO_SOFFIT,
        capStart: flushA, capEnd: flushB,
      });
    }
    // jamb reveals — the sides of the hole. These are what make a door read as
    // a 0.24 m thick wall rather than a decal.
    emitPrism(ctx, sinkFor, h.from, h.from, y0 + h.sill, y0 + h.head, {
      left: false, right: false,
      capStart: true, capStartOut: -1,
      capAo: AO_REVEAL, capMat: ctx.matInner,
    });
    emitPrism(ctx, sinkFor, h.to, h.to, y0 + h.sill, y0 + h.head, {
      left: false, right: false,
      capEnd: true, capEndOut: -1,
      capAo: AO_REVEAL, capMat: ctx.matInner,
    });
    u = h.to;
  }
  if (ctx.length - u > EPSU) {
    emitPrism(ctx, sinkFor, u, ctx.length, y0, yTop, {
      top: true,
      capStart: u <= EPSU ? capA : false,
      capEnd: capB,
    });
  }
  emitNodeCap(ctx, junc, wall.a, sinkFor);
  emitNodeCap(ctx, junc, wall.b, sinkFor);
  return ctx;
}

/**
 * Close the middle of a degree >= 3 junction at wall-top level. Only the node's
 * owner wall emits it, so it appears exactly once however many walls meet there.
 */
function emitNodeCap(ctx, junc, nodeId, sinkFor) {
  const cap = junc.caps && junc.caps.get(nodeId);
  if (!cap || cap.owner !== ctx.id) return;
  const yTop = ctx.base + ctx.height;
  // Same AO the neighbouring wall tops carry at their node ends, so the cap does
  // not read as a lighter patch dropped into the crossing.
  const a = wallAO(ctx, 0, yTop);
  const up = { x: 0, y: 1, z: 0 };
  const sink = sinkFor(ctx.matOuter);
  const tris = triangulate(cap.poly);
  for (const t of tris) {
    const p = cap.poly[t[0]], q = cap.poly[t[1]], r = cap.poly[t[2]];
    sink.tri(
      { x: p[0], y: yTop, z: p[1] }, { x: q[0], y: yTop, z: q[1] }, { x: r[0], y: yTop, z: r[1] },
      up,
      [[p[0], p[1]], [q[0], q[1]], [r[0], r[1]]],
      [a, a, a]
    );
  }
}

// ---------------------------------------------------------------------------
// public: one wall geometry

/**
 * BufferGeometry for a single wall, all its materials merged into one geometry
 * with one draw group per material. `geometry.userData.materialKeys` lists them
 * in group order.
 */
export function buildWallGeometry(model, wall, opts = {}) {
  const junc = solveJunctions(model, wallsOfLevel(model, wall.levelId));
  const sinks = new Map();
  const sinkFor = (key) => {
    const k = key || DEFAULT_MAT_KEY;
    if (!sinks.has(k)) sinks.set(k, new Sink(k));
    return sinks.get(k);
  };
  emitWall(model, wall, junc, sinkFor, opts);
  const geoms = [];
  const keys = [];
  for (const [k, s] of sinks) { if (s.vertexCount) { geoms.push(sinkToGeometry(s)); keys.push(k); } }
  if (!geoms.length) return new BufferGeometry();
  const { geometry, ranges } = mergeGeometries(geoms);
  geoms.forEach((g) => g.dispose());
  ranges.forEach((r, i) => geometry.addGroup(r.start, r.count, i));
  geometry.userData.materialKeys = keys;
  return geometry;
}

// ---------------------------------------------------------------------------
// slabs

function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Inside or on the boundary of the triangle. */
function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const e = 1e-9;
  const neg = (d1 < -e) || (d2 < -e) || (d3 < -e);
  const pos = (d1 > e) || (d2 > e) || (d3 > e);
  return !(neg && pos);
}

/** True when two plan points are the same vertex within tolerance. */
function samePlanPoint(px, py, q) {
  return Math.abs(px - q[0]) < 1e-7 && Math.abs(py - q[1]) < 1e-7;
}

/**
 * Winding number of `poly` around (x, z), i.e. the NONZERO fill rule.
 *
 * This is the rule bridged rings are built for. A slab with a courtyard has no
 * separate hole list — the ring is cut open and stitched to the hole, so the two
 * bridge edges lie on top of each other and cancel. Under nonzero the courtyard
 * comes out 0 (outside) however many courtyards there are; under the even-odd
 * rule two courtyards start reporting each other's interiors as solid.
 */
function windingNumber(poly, x, z) {
  let w = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (a[1] <= z) {
      if (b[1] > z && (b[0] - a[0]) * (z - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) w++;
    } else if (b[1] <= z && (b[0] - a[0]) * (z - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) w--;
  }
  return w;
}

/** Do ab and cd cross at an interior point of both? Shared endpoints do not count. */
function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => {
    const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
  };
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** Does the ring repeat a vertex position? That is the signature of a bridge. */
function isBridgedRing(poly) {
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      if (samePlanPoint(poly[i][0], poly[i][1], poly[j])) return true;
    }
  }
  return false;
}

/**
 * Ear clipping. `poly` is [[x,z], ...] in either winding — the traversal order
 * is normalised here, so callers never have to pre-wind. Returns index triples.
 *
 * Two ear tests. Simple rings use the cheap one: no other vertex inside the ear.
 * BRIDGED rings (a slab with one or more courtyards) use the exact one: the
 * diagonal must not cross an edge and must run through solid material by the
 * nonzero rule. The cheap test cannot see a bridge at all — a repeated vertex
 * sits on every candidate ear, so every ear is vetoed, the loop bails on its
 * first pass and the slab is emitted with ZERO triangles. That is what removed
 * 100 % of the soffit on a courtyard slab, and the top face too whenever
 * insetPolygon() declined.
 */
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (polygonArea(poly) < 0) idx.reverse();
  const tris = [];
  earClip(poly, idx, isBridgedRing(poly), tris, 0);
  return tris;
}

/** Ear-clip one ring, given as indices into `poly`. Appends triples to `out`. */
function earClip(poly, idx, exact, out, depth) {
  const budget = idx.length * idx.length + 16;
  let guard = 0;
  while (idx.length > 3 && guard++ < budget) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr <= 1e-12) continue;                    // reflex or degenerate
      if (!earClear(poly, idx, i0, i1, i2, a, b, c)) continue;
      // A bridged ring can also present an ear that is clear of vertices yet
      // still swallows a courtyard, because the ear only TOUCHES the hole at a
      // corner. The diagonal test catches that; it is skipped on simple rings,
      // where it is redundant and O(n) more expensive per candidate.
      if (exact && !diagonalOk(poly, idx, a, c, b)) continue;
      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (clipped) continue;
    // Stalled. A bridged ring can genuinely have NO ear: bridge the courtyard of
    // a square building to a far outer corner and every convex vertex's diagonal
    // runs through the courtyard. Cut the ring in two along any valid diagonal
    // and clip the halves — each of them does have ears. Without this the slab
    // came out with zero triangles, i.e. invisible, and said nothing about it.
    if (exact && depth < 32 && splitClip(poly, idx, out, depth)) return;
    break;                                          // self-intersecting input
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
}

/** Split a stalled ring along the first valid interior diagonal and recurse. */
function splitClip(poly, idx, out, depth) {
  const m = idx.length;
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;          // adjacent in the ring
      const a = poly[idx[i]], b = poly[idx[j]];
      if (samePlanPoint(a[0], a[1], b)) continue;
      if (!diagonalValid(poly, idx, a, b)) continue;
      earClip(poly, idx.slice(i, j + 1), true, out, depth + 1);
      earClip(poly, idx.slice(j).concat(idx.slice(0, i + 1)), true, out, depth + 1);
      return true;
    }
  }
  return false;
}

/** Cheap ear test for a simple ring: no remaining vertex inside it. */
function earClear(poly, idx, i0, i1, i2, a, b, c) {
  for (const j of idx) {
    if (j === i0 || j === i1 || j === i2) continue;
    const px = poly[j][0], py = poly[j][1];
    // A bridge repeats a vertex POSITION under a different index; that copy is
    // the same point of the plan, not an intruder into the ear.
    if (samePlanPoint(px, py, a) || samePlanPoint(px, py, b) || samePlanPoint(px, py, c)) continue;
    if (pointInTriangle(px, py, a[0], a[1], b[0], b[1], c[0], c[1])) return false;
  }
  return true;
}

/**
 * Exact ear test: the diagonal a-c may not cross an edge of the ring being
 * clipped, and its midpoint (nudged off b, so a sliver ear still samples inside)
 * must be solid under the nonzero rule of the WHOLE plan — a courtyard is solid
 * nowhere, however the ring that describes it has been cut open.
 */
function diagonalOk(ring, idx, a, c, b) {
  for (let k = 0, m = idx.length; k < m; k++) {
    const p = ring[idx[k]], q = ring[idx[(k + 1) % m]];
    if (segmentsCross(a, c, p, q)) return false;
  }
  const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
  const gx = mx + (b[0] - mx) * 1e-4, gz = mz + (b[1] - mz) * 1e-4;
  return windingNumber(ring, gx, gz) !== 0;
}

/** Diagonal a-b for the split: crosses nothing, runs through solid material. */
function diagonalValid(ring, idx, a, b) {
  for (let k = 0, m = idx.length; k < m; k++) {
    const p = ring[idx[k]], q = ring[idx[(k + 1) % m]];
    if (segmentsCross(a, b, p, q)) return false;
  }
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  for (const v of ring) if (samePlanPoint(mx, mz, v)) return false;
  return windingNumber(ring, mx, mz) !== 0;
}

/** Distance from (x,z) to the nearest polygon edge. */
function distToBoundary(poly, x, z) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 1e-12 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
    t = clamp01(t);
    const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * A slab: top face, soffit, and edge band. Thickness hangs BELOW the level
 * elevation for a floor, and sits above the storey head for a roof.
 */
export function buildSlabGeometry(model, slab, opts = {}) {
  const sink = new Sink(slab.mat || 'screed');
  emitSlab(model, slab, () => sink, opts);
  return sinkToGeometry(sink);
}

function emitSlab(model, slab, sinkFor, opts = {}) {
  const poly = slab.polygon.map((p) => [p[0], p[1]]);
  if (poly.length < 3) return null;
  if (polygonArea(poly) < 0) poly.reverse();
  const level = model.levels.find((l) => l.id === slab.levelId) || model.levels[0];
  const base = level ? level.elevation : 0;
  const th = opts.slabThickness ?? SLAB_THICKNESS;
  const isRoof = slab.kind === 'roof';
  const yTop = isRoof ? base + (level ? level.height : 2.7) + th : base;
  const yBot = yTop - th;
  const key = slab.mat || (isRoof ? 'concrete' : 'screed');
  const sink = sinkFor(key);
  const aoK = clamp01(opts.ao ?? 1);
  const ao = (x, z) => {
    const d = distToBoundary(poly, x, z);
    const a = AO_SLAB_EDGE + (1 - AO_SLAB_EDGE) * smooth01(d / AO_SLAB_BAND);
    return 1 + (a - 1) * aoK;
  };

  // top face — subdivided against an inward-offset ring so the edge darkening
  // has vertices to interpolate over. Falls back to a flat fan if the inset
  // self-intersects (thin or awkward polygons).
  // A slab narrower than 2 x AO_SLAB_BAND (a corridor, a balcony, a 0.5 m strip)
  // cannot take the full offset — the ring would turn itself inside out and the
  // whole strip would flatten to the darkest AO value, reading as a black band.
  // Back the offset off until it survives, so narrow slabs keep a gradient.
  let inset = null;
  for (let d = Math.min(AO_SLAB_BAND, 0.45); d > 0.02 && !inset; d *= 0.6) {
    inset = insetPolygon(poly, d);
  }
  const upN = { x: 0, y: isRoof ? 1 : 1, z: 0 };
  if (inset) {
    // ring between outer and inset
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const ia = inset[i], ib = inset[(i + 1) % n];
      sink.quad(
        { x: a[0], y: yTop, z: a[1] }, { x: b[0], y: yTop, z: b[1] },
        { x: ib[0], y: yTop, z: ib[1] }, { x: ia[0], y: yTop, z: ia[1] },
        upN,
        [[a[0], a[1]], [b[0], b[1]], [ib[0], ib[1]], [ia[0], ia[1]]],
        [ao(a[0], a[1]), ao(b[0], b[1]), ao(ib[0], ib[1]), ao(ia[0], ia[1])]
      );
    }
    for (const t of triangulate(inset)) {
      const a = inset[t[0]], b = inset[t[1]], c = inset[t[2]];
      sink.tri(
        { x: a[0], y: yTop, z: a[1] }, { x: b[0], y: yTop, z: b[1] }, { x: c[0], y: yTop, z: c[1] },
        upN,
        [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]]],
        [ao(a[0], a[1]), ao(b[0], b[1]), ao(c[0], c[1])]
      );
    }
  } else {
    for (const t of triangulate(poly)) {
      const a = poly[t[0]], b = poly[t[1]], c = poly[t[2]];
      sink.tri(
        { x: a[0], y: yTop, z: a[1] }, { x: b[0], y: yTop, z: b[1] }, { x: c[0], y: yTop, z: c[1] },
        upN,
        [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]]],
        [ao(a[0], a[1]), ao(b[0], b[1]), ao(c[0], c[1])]
      );
    }
  }

  // soffit
  for (const t of triangulate(poly)) {
    const a = poly[t[0]], b = poly[t[1]], c = poly[t[2]];
    sink.tri(
      { x: a[0], y: yBot, z: a[1] }, { x: b[0], y: yBot, z: b[1] }, { x: c[0], y: yBot, z: c[1] },
      { x: 0, y: -1, z: 0 },
      [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]]],
      [0.72, 0.72, 0.72]
    );
  }

  // edge band
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l = Math.hypot(ex, ez) || 1;
    const out = { x: ez / l, y: 0, z: -ex / l };
    sink.quad(
      { x: a[0], y: yBot, z: a[1] }, { x: b[0], y: yBot, z: b[1] },
      { x: b[0], y: yTop, z: b[1] }, { x: a[0], y: yTop, z: a[1] },
      out,
      [[0, 0], [l, 0], [l, th], [0, th]],
      [0.8, 0.8, 1, 1]
    );
  }
  return key;
}

/** Offset every vertex inward along its angle bisector; null if it degenerates. */
function insetPolygon(poly, d) {
  const n = poly.length;
  if (n < 3 || d <= 0) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
    const e0 = norm2(p[0] - prev[0], p[1] - prev[1]);
    const e1 = norm2(next[0] - p[0], next[1] - p[1]);
    // Inward normals for the POSITIVE-shoelace winding emitSlab normalises to.
    // For edge e the inward side is e rotated by +90 in the (x, z) plane treated
    // as (x, y): (-e.z, e.x). Getting this backwards grows the polygon instead of
    // shrinking it, which trips the `a1 > a0` guard below and silently kills the
    // whole slab-top AO gradient — it did exactly that until 2026-08-27.
    const n0 = { x: -e0.z, z: e0.x };
    const n1 = { x: -e1.z, z: e1.x };
    let bx = n0.x + n1.x, bz = n0.z + n1.z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) return null;
    bx /= bl; bz /= bl;
    const cosHalf = Math.max(0.25, (bx * n1.x + bz * n1.z));
    out.push([p[0] + bx * (d / cosHalf), p[1] + bz * (d / cosHalf)]);
  }
  const a0 = polygonArea(poly), a1 = polygonArea(out);
  if (a1 <= 0 || a1 / a0 < 0.05 || a1 > a0) return null;
  return out;
}
function norm2(x, z) { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; }

// ---------------------------------------------------------------------------
// colliders

/**
 * Wall segments for the hand-written capsule-vs-segment collision.
 * `gaps` are the walkable holes — doors and floor-level openings only; a window
 * with a sill is not a gap, you cannot walk through it.
 */
export function buildColliders(model, walls, opts = {}) {
  const out = [];
  for (const w of walls) {
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (!a || !b) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < MIN_WALL_LENGTH) continue;
    const level = model.levels.find((l) => l.id === w.levelId) || model.levels[0];
    const height = opts.wallHeight ?? (level ? level.height : 2.70);
    // Reuse the mesh path's resolution when the caller has one; resolving twice
    // costs work and, before diagnostics became data, printed every warning twice.
    const holes = (opts.openingsByWall && opts.openingsByWall.get(w.id))
      || resolveOpenings(model, w, length, height, opts.diagnostics || null);
    const gaps = holes
      .filter((h) => h.sill <= 0.01)
      .map((h) => ({ from: h.from, to: h.to, head: h.head }));
    out.push({
      id: w.id,
      levelId: w.levelId,
      a: { x: a.x, z: a.z },
      b: { x: b.x, z: b.z },
      thickness: w.thickness,
      height,
      base: level ? level.elevation : 0,
      gaps,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// public: the whole building

function wallsOfLevel(model, levelId) {
  const out = [];
  for (const id in model.walls) {
    const w = model.walls[id];
    if (levelId == null || w.levelId === levelId) out.push(w);
  }
  return out;
}

/**
 * buildMeshes(model, opts) -> { group, colliders, byId, stats, materials }
 *
 * opts:
 *   levelId       build one level only (default: every level)
 *   ao            0..1 strength of the baked vertex AO (default 1)
 *   slabs         include floor/roof slabs (default true)
 *   wallHeight    override the storey height (metres)
 *   materialCache Map reused across rebuilds so materials are not re-created
 */
export function buildMeshes(model, opts = {}) {
  const group = new Group();
  group.name = 'building';
  const byId = new Map();
  const matCache = opts.materialCache instanceof Map ? opts.materialCache : new Map();
  const ownedMaterials = !(opts.materialCache instanceof Map);

  const levels = opts.levelId
    ? model.levels.filter((l) => l.id === opts.levelId)
    : model.levels;

  const colliders = [];
  const diagnostics = [];
  const stats = { triangles: 0, meshes: 0, walls: 0, slabs: 0 };

  for (const level of levels) {
    const walls = wallsOfLevel(model, level.id);
    const junc = solveJunctions(model, walls);
    // Resolve every wall's openings ONCE for this build; both the mesh path and
    // the collider path read this map, so the two can never disagree and no
    // diagnostic is produced twice.
    const openingsByWall = new Map();
    for (const w of walls) {
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < MIN_WALL_LENGTH) continue;
      const height = opts.wallHeight ?? (level ? level.height : 2.70);
      openingsByWall.set(w.id, resolveOpenings(model, w, length, height, diagnostics));
    }
    const sinks = new Map();
    const sinkFor = (key) => {
      const k = key || DEFAULT_MAT_KEY;
      if (!sinks.has(k)) sinks.set(k, new Sink(k));
      return sinks.get(k);
    };
    // wallId -> [{ matKey, start, count }]
    const pending = new Map();

    for (const w of walls) {
      const before = new Map();
      for (const [k, s] of sinks) before.set(k, s.vertexCount);
      const ctx = emitWall(model, w, junc, sinkFor, {
        ...opts, ao: opts.ao ?? 1, openings: openingsByWall.get(w.id), diagnostics,
      });
      if (!ctx) continue;
      stats.walls++;
      const ranges = [];
      for (const [k, s] of sinks) {
        const start = before.get(k) ?? 0;
        const count = s.vertexCount - start;
        if (count > 0) ranges.push({ matKey: k, start, count });
      }
      pending.set(w.id, ranges);
    }

    if (opts.slabs !== false) {
      for (const id in model.slabs) {
        const slab = model.slabs[id];
        if (slab.levelId !== level.id) continue;
        const before = new Map();
        for (const [k, s] of sinks) before.set(k, s.vertexCount);
        const key = emitSlab(model, slab, sinkFor, opts);
        if (!key) continue;
        stats.slabs++;
        const ranges = [];
        for (const [k, s] of sinks) {
          const start = before.get(k) ?? 0;
          const count = s.vertexCount - start;
          if (count > 0) ranges.push({ matKey: k, start, count });
        }
        pending.set(slab.id, ranges);
      }
    }

    const meshByMat = new Map();
    for (const [k, s] of sinks) {
      if (!s.vertexCount) continue;
      const geometry = sinkToGeometry(s);
      let material = matCache.get(k);
      if (!material) { material = makeMaterial(k); matCache.set(k, material); }
      const mesh = new Mesh(geometry, material);
      mesh.name = `${level.id}:${k}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.materialKey = k;
      mesh.userData.levelId = level.id;
      group.add(mesh);
      meshByMat.set(k, mesh);
      stats.meshes++;
      stats.triangles += geometry.getAttribute('position').count / 3;
    }

    for (const [entityId, ranges] of pending) {
      const entries = ranges
        .filter((r) => meshByMat.has(r.matKey))
        .map((r) => ({
          mesh: meshByMat.get(r.matKey),
          materialKey: r.matKey,
          vertexStart: r.start,
          vertexCount: r.count,
          triStart: r.start / 3,
          triCount: r.count / 3,
        }));
      byId.set(entityId, { id: entityId, levelId: level.id, entries });
    }

    for (const c of buildColliders(model, walls, { ...opts, openingsByWall, diagnostics })) colliders.push(c);
  }

  const bounds = new Box3();
  bounds.makeEmpty();
  for (const child of group.children) {
    if (child.geometry && child.geometry.boundingBox) {
      bounds.union(child.geometry.boundingBox);
    }
  }

  return {
    group,
    colliders,
    byId,
    stats,
    bounds,
    diagnostics,
    materials: matCache,
    _ownedMaterials: ownedMaterials,
  };
}

// ---------------------------------------------------------------------------
// teardown

/** Free every geometry and (unless the caller owns the cache) every material. */
export function disposeBuilt(built) {
  if (!built) return;
  const group = built.group ?? built;
  group.traverse?.((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  if (built._ownedMaterials !== false && built.materials instanceof Map) {
    for (const m of built.materials.values()) m.dispose();
    built.materials.clear();
  }
  if (group.parent) group.parent.remove(group);
  group.clear?.();
  if (built.byId instanceof Map) built.byId.clear();
  if (Array.isArray(built.colliders)) built.colliders.length = 0;
}
