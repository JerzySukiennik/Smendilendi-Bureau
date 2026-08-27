// instancing.js — draw calls are the budget (ARCHITECTURE.md rule 5).
//
// Everything that repeats in the game (chairs, desks, trees, paving slabs, NPCs,
// window frames) goes through an InstancePool. Never clone() a mesh in a loop.
//
// Usage per frame:
//   pool.begin();
//   for (const f of furniture) pool.place(f.catalogId, matrix, colorHex);
//   pool.flush();
//
// Static content (a building that only changes when model.version changes) should
// call begin/place/flush once on rebuild, not every frame — the pool does not care.

import { InstancedMesh, Object3D, Color, DynamicDrawUsage, Matrix4, Box3, Sphere } from 'three';

const MAX_PER_MESH = 4096;      // hard cap per pool entry; beyond this, split the pool
const START_CAPACITY = 16;

function nextPow2(n) {
  let p = START_CAPACITY;
  while (p < n) p *= 2;
  return p;
}

class Entry {
  constructor(name, geometry, material, opts) {
    this.name = name;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = opts.castShadow !== false;
    this.receiveShadow = opts.receiveShadow !== false;
    this.capacity = 0;
    this.count = 0;
    this.mesh = null;
    this.dirty = false;
  }

  grow(needed, parent) {
    const cap = Math.min(nextPow2(needed), MAX_PER_MESH);
    if (cap <= this.capacity) return;
    const old = this.mesh;
    const mesh = new InstancedMesh(this.geometry, this.material, cap);
    mesh.name = `inst:${this.name}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.frustumCulled = false;   // we own the bounds; per-pool culling would be wrong
    mesh.count = 0;
    // three creates instanceColor lazily on the first setColorAt; do it eagerly so
    // the buffer exists before any place() call and never reallocates mid-frame.
    const c = new Color(0xffffff);
    for (let i = 0; i < cap; i++) mesh.setColorAt(i, c);
    mesh.instanceColor.setUsage(DynamicDrawUsage);

    if (old) {
      // copy live instances across
      const m = new Matrix4();
      const col = new Color();
      for (let i = 0; i < this.count; i++) {
        old.getMatrixAt(i, m); mesh.setMatrixAt(i, m);
        old.getColorAt(i, col); mesh.setColorAt(i, col);
      }
      mesh.count = this.count;
      parent.remove(old);
      old.dispose();
    }
    parent.add(mesh);
    this.mesh = mesh;
    this.capacity = cap;
  }
}

export class InstancePool {
  /**
   * @param {THREE.Object3D} parent  group the instanced meshes are added to
   */
  constructor(parent) {
    this.parent = parent;
    this.entries = new Map();      // name -> Entry
    this._obj = new Object3D();
    this._color = new Color();
    this._pending = new Map();     // name -> count during a begin/flush pass
    this.overflow = 0;
  }

  /**
   * Register a kind. name is the key everything else uses.
   * Geometry and material are shared, never cloned.
   */
  register(name, geometry, material, opts = {}) {
    if (this.entries.has(name)) return this.entries.get(name);
    const e = new Entry(name, geometry, material, opts);
    this.entries.set(name, e);
    return e;
  }

  has(name) { return this.entries.has(name); }

  begin() {
    this._pending.clear();
    this.overflow = 0;
  }

  /**
   * place(name, matrixOrTransform, color)
   *   matrix : THREE.Matrix4, OR { position:{x,y,z}, rotationY, scale }
   *   color  : hex number | THREE.Color | null (null = white = material colour)
   * Returns the instance index, or -1 if the pool is full.
   */
  place(name, transform, color = null) {
    const e = this.entries.get(name);
    if (!e) {
      if (!this._warned) this._warned = new Set();
      if (!this._warned.has(name)) {
        this._warned.add(name);
        console.warn(`[instancing] place() on unregistered kind "${name}"`);
      }
      return -1;
    }
    const i = this._pending.get(name) ?? 0;
    if (i >= MAX_PER_MESH) { this.overflow++; return -1; }
    if (i >= e.capacity) e.grow(i + 1, this.parent);

    let m;
    if (transform && transform.isMatrix4) {
      m = transform;
    } else {
      const o = this._obj;
      const p = transform.position || transform;
      o.position.set(p.x || 0, p.y || 0, p.z || 0);
      o.rotation.set(0, transform.rotationY || transform.rot || 0, 0);
      const s = transform.scale;
      if (typeof s === 'number') o.scale.setScalar(s);
      else if (s) o.scale.set(s.x ?? 1, s.y ?? 1, s.z ?? 1);
      else o.scale.set(transform.sx ?? 1, transform.sy ?? 1, transform.sz ?? 1);
      o.updateMatrix();
      m = o.matrix;
    }
    e.mesh.setMatrixAt(i, m);

    if (color === null || color === undefined) this._color.setHex(0xffffff);
    else if (color.isColor) this._color.copy(color);
    else this._color.setHex(color);
    e.mesh.setColorAt(i, this._color);

    this._pending.set(name, i + 1);
    e.dirty = true;
    return i;
  }

  /** Commit the frame: set counts, mark buffers for upload, hide empty pools. */
  flush() {
    for (const e of this.entries.values()) {
      const n = this._pending.get(e.name) ?? 0;
      if (!e.mesh) continue;
      const changed = e.mesh.count !== n || e.dirty;
      e.mesh.count = n;
      e.count = n;
      e.mesh.visible = n > 0;
      if (changed) {
        e.mesh.instanceMatrix.needsUpdate = true;
        if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true;
        e.mesh.computeBoundingSphere?.();
      }
      e.dirty = false;
    }
    if (this.overflow > 0) {
      console.warn(`[instancing] ${this.overflow} instances dropped (cap ${MAX_PER_MESH} per kind)`);
    }
  }

  /** Live instance count across all kinds. */
  get instanceCount() {
    let n = 0;
    for (const e of this.entries.values()) n += e.count;
    return n;
  }

  /** How many draw calls this pool costs (kinds with at least one instance). */
  get drawCalls() {
    let n = 0;
    for (const e of this.entries.values()) if (e.count > 0) n++;
    return n;
  }

  stats() {
    const out = [];
    for (const e of this.entries.values()) out.push({ name: e.name, count: e.count, capacity: e.capacity });
    return out;
  }

  dispose() {
    for (const e of this.entries.values()) {
      if (e.mesh) { this.parent.remove(e.mesh); e.mesh.dispose(); }
    }
    this.entries.clear();
    this._pending.clear();
  }
}

/** Convenience: world-space AABB of an instanced entry, for culling decisions. */
export function poolBounds(pool, name, target = new Box3()) {
  const e = pool.entries.get(name);
  target.makeEmpty();
  if (!e || !e.mesh || e.count === 0) return target;
  const m = new Matrix4();
  const geoBox = e.geometry.boundingBox || (e.geometry.computeBoundingBox(), e.geometry.boundingBox);
  const tmp = new Box3();
  for (let i = 0; i < e.count; i++) {
    e.mesh.getMatrixAt(i, m);
    tmp.copy(geoBox).applyMatrix4(m);
    target.union(tmp);
  }
  return target;
}

export { Sphere };
