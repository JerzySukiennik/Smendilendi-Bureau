// furniture.js — every catalogue object in the model, instanced.
//
// ARCHITECTURE.md rule 5: repeated props go through src/core/instancing.js and
// nothing is ever clone()d in a loop. A catalogue entry's procedural parts are
// merged ONCE per material slot into a single BufferGeometry, so a chair costs
// two pool kinds no matter how many chairs are in the building, and twelve
// chairs cost twelve instances and zero extra draw calls.
//
// Free scale on any axis and free rotation live in the instance matrix; the
// player's colour is the instance colour, which multiplies a white base
// material — that is why SLOT_MATERIALS maps 'primary' to the neutral 'flat'.

import {
  Group, Matrix4, Vector3, Euler, Quaternion, Box3,
  BoxGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
} from 'three';
import { InstancePool } from '../core/instancing.js';
import { materialFor, tint } from '../core/palette.js';
import { SLOT_MATERIALS } from '../core/assets.js';
import { tryEntry, procShape, DEFAULT_CEILING } from '../model/catalog.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export class FurnitureRenderer {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'furniture';
    scene.add(this.group);
    this.pool = new InstancePool(this.group);
    this.kinds = new Map();          // catalogId -> [slotKey]
    this.bounds = new Map();         // catalogId -> Box3 of the local geometry
    this.instanceIds = new Map();    // pool key -> [furnitureId] in instance order
    this.version = -1;
  }

  /** Build (once) the merged geometry of one catalogue entry, per material slot. */
  ensure(catalogId) {
    if (this.kinds.has(catalogId)) return this.kinds.get(catalogId);
    const entry = tryEntry(catalogId);
    if (!entry) { this.kinds.set(catalogId, []); return []; }
    let shape;
    try { shape = procShape(catalogId); } catch (_) { shape = null; }
    const bySlot = new Map();
    const box = new Box3();
    box.makeEmpty();
    for (const part of shape?.parts ?? []) {
      const geo = geometryFor(part);
      if (!geo) continue;
      _e.set(part.rot?.[0] || 0, part.rot?.[1] || 0, part.rot?.[2] || 0);
      _q.setFromEuler(_e);
      _p.set(part.pos?.[0] || 0, part.pos?.[1] || 0, part.pos?.[2] || 0);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      geo.applyMatrix4(_m);
      geo.computeBoundingBox();
      box.union(geo.boundingBox);
      const slot = part.slot || 'primary';
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(geo);
    }
    const keys = [];
    for (const [slot, geos] of bySlot) {
      const merged = concat(geos);
      for (const g of geos) g.dispose();
      const key = `${catalogId}|${slot}`;
      const matId = SLOT_MATERIALS[slot] || 'flat';
      // Only the 'primary' slot takes the player's colour; the rest are palette
      // materials and get a white instance colour so they render as authored.
      this.pool.register(key, merged, materialFor(matId, { flatShading: true }), { castShadow: true, receiveShadow: true });
      keys.push({ key, slot });
    }
    this.kinds.set(catalogId, keys);
    this.bounds.set(catalogId, box);
    return keys;
  }

  /** Local (unrotated, unscaled) bounding box of a catalogue entry. */
  boundsOf(catalogId) {
    this.ensure(catalogId);
    return this.bounds.get(catalogId) || null;
  }

  /**
   * Re-place every instance. O(furniture), no allocation, no geometry work —
   * this is what makes moving one chair cost nothing.
   * `skip` is a Set of ids currently being dragged (drawn as ghosts instead).
   */
  rebuild(model, levelId, { skip = null, ceiling = DEFAULT_CEILING } = {}) {
    this.pool.begin();
    for (const list of this.instanceIds.values()) list.length = 0;
    let n = 0;
    for (const id in model.furniture) {
      const f = model.furniture[id];
      if (f.levelId !== levelId) continue;
      if (skip && skip.has(id)) continue;
      const entry = tryEntry(f.catalogId);
      if (!entry) continue;
      const keys = this.ensure(f.catalogId);
      if (!keys.length) continue;
      const base = baseHeight(entry, f, ceiling);
      _p.set(f.x, base, f.z);
      _e.set(0, f.rot || 0, 0);
      _q.setFromEuler(_e);
      _s.set(f.sx ?? 1, f.sy ?? 1, f.sz ?? 1);
      _m.compose(_p, _q, _s);
      const col = f.color != null ? f.color : (entry.colorable ? tint(hash(f.catalogId)) : 0xffffff);
      for (const k of keys) {
        this.pool.place(k.key, _m, k.slot === 'primary' ? col : 0xffffff);
        let list = this.instanceIds.get(k.key);
        if (!list) { list = []; this.instanceIds.set(k.key, list); }
        list.push(id);
      }
      n++;
    }
    this.pool.flush();
    this.count = n;
    this.version = model.version;
    return n;
  }

  get drawCalls() { return this.pool.drawCalls; }

  /** Every InstancedMesh in the pool, for raycasting. */
  pickables() {
    const out = [];
    for (const e of this.pool.entries.values()) if (e.mesh && e.count > 0) out.push(e.mesh);
    return out;
  }

  /**
   * Map a raycast hit on a pooled mesh back to a furniture id.
   * InstancePool names its meshes "inst:<key>" (see core/instancing.js), so the
   * prefix is stripped rather than assumed away.
   */
  idFromHit(hit) {
    if (!hit || hit.instanceId == null) return null;
    const name = String(hit.object?.name || '').replace(/^inst:/, '');
    const list = this.instanceIds.get(name);
    return list ? (list[hit.instanceId] ?? null) : null;
  }

  dispose() {
    this.pool.dispose();
    this.group.parent?.remove(this.group);
    this.kinds.clear();
    this.bounds.clear();
  }
}

/**
 * The height of an item's own base above the finished floor.
 *   floor   : mount (0 for anything standing on the floor)
 *   wall    : mount = the underside above the floor
 *   ceiling : mount = the drop of the base below the soffit
 */
export function baseHeight(entry, f, ceiling = DEFAULT_CEILING) {
  const mount = entry.mount || 0;
  if (entry.anchor === 'ceiling') return (f.y ?? 0) + ceiling - mount;
  return (f.y ?? 0) + mount;
}

function geometryFor(part) {
  switch (part.type) {
    case 'box': {
      const s = part.size || [0.2, 0.2, 0.2];
      return new BoxGeometry(Math.max(s[0], 1e-3), Math.max(s[1], 1e-3), Math.max(s[2], 1e-3));
    }
    case 'cyl':
      return new CylinderGeometry(
        Math.max(part.rTop ?? 0.05, 1e-4),
        Math.max(part.rBottom ?? 0.05, 1e-4),
        Math.max(part.h ?? 0.1, 1e-3),
        Math.max(3, part.seg ?? 12),
      );
    case 'plane': {
      const s = part.size || [0.5, 0.5];
      return new PlaneGeometry(s[0], s[1]);
    }
    default:
      return null;
  }
}

/**
 * Concatenate geometries that share position/normal/uv. Written here rather than
 * pulled from BufferGeometryUtils so the editor keeps the same "no surprises"
 * property as the model layer: one function, no index buffers, no groups.
 */
function concat(geos) {
  const names = ['position', 'normal', 'uv'];
  const sizes = { position: 3, normal: 3, uv: 2 };
  const flat = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const n of names) {
    const arr = new Float32Array(total * sizes[n]);
    let at = 0;
    for (const g of flat) {
      const src = g.getAttribute(n);
      const count = g.getAttribute('position').count;
      if (src) arr.set(src.array.subarray(0, count * sizes[n]), at * sizes[n]);
      at += count;
    }
    out.setAttribute(n, new BufferAttribute(arr, sizes[n]));
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== geos[i]) flat[i].dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
