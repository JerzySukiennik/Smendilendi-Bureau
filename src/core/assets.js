// assets.js — GLTF loading with a manifest, measured against the catalogue.
//
// ARCHITECTURE.md rule 6: "Measure, never assume geometry. Box3.setFromObject at
// runtime for any loaded GLB. Catalogue entries declare their metric size; the
// loader compares and warns on drift > 2 %."
//
// Nothing here ever blocks the game. A missing GLB produces a PROCEDURAL PLACEHOLDER
// of exactly the catalogue's declared metric size, built from the part descriptions
// in src/model/proc-shapes.js when that module is present, and from a labelled
// bevelled box when it is not. The office is playable before a single asset exists.

import {
  Box3, Vector3, Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry,
  ConeGeometry, PlaneGeometry,
} from 'three';
import { materialFor, tint } from './palette.js';

export const DRIFT_TOLERANCE = 0.02;      // 2 %

// ---------------------------------------------------------------------------
// procedural shape descriptions (optional dependency)

let procShapes = null;
let procTried = false;

async function getProcShapes() {
  if (procTried) return procShapes;
  procTried = true;
  try {
    procShapes = await import('../model/proc-shapes.js');
  } catch (_) {
    procShapes = null;   // not written yet — placeholders fall back to a box
  }
  return procShapes;
}

/**
 * Material slot -> palette material class. The slot vocabulary is owned by
 * src/model/proc-shapes.js (SLOTS); the mapping to a look is owned here, because
 * palette.js is the look contract and proc-shapes.js is view-free.
 *
 * 'primary' maps to the neutral 'flat' material on purpose: it is the slot that
 * takes the player's tint, and an instance/vertex colour MULTIPLIES the material
 * colour, so its base must be white.
 */
export const SLOT_MATERIALS = {
  primary:   'flat',
  secondary: 'wood-mid',
  accent:    'accent',
  metal:     'metal',
  glass:     'glass',
  fabric:    'flat',
  ceramic:   'tile',
  foliage:   'grass',
};

/**
 * Turn a proc-shapes description into a three.js Group.
 *
 * The part contract is proc-shapes.js's, quoted here so a change there is caught:
 *   { type:'box',   size:[w,h,d], pos:[x,y,z], rot:[rx,ry,rz], slot }
 *   { type:'cyl',   rBottom, rTop, h, seg,     pos, rot,       slot }
 *   { type:'plane', size:[w,d],   pos, rot,    slot }
 * `pos` is the CENTRE of the part; the shape's origin is the footprint centre on
 * the floor (y = 0 at the base), the same convention as BuildingModel.furniture.
 */
export function buildProcedural(desc, fallbackSize = [0.5, 0.5, 0.5]) {
  const g = new Group();
  const parts = Array.isArray(desc) ? desc : (desc?.parts || []);
  if (!parts.length) return null;
  for (const p of parts) {
    let geo;
    switch (p.type || p.shape) {
      case 'cyl':
      case 'cylinder':
        geo = new CylinderGeometry(
          p.rTop ?? p.r ?? 0.1,
          p.rBottom ?? p.r ?? 0.1,
          p.h ?? 0.5,
          Math.max(3, p.seg ?? p.segments ?? 12),
        );
        break;
      case 'cone':
        geo = new ConeGeometry(p.rBottom ?? p.r ?? 0.1, p.h ?? 0.5, p.seg ?? 10);
        break;
      case 'sphere':
        geo = new SphereGeometry(p.r ?? 0.1, p.seg ?? 12, Math.max(4, (p.seg ?? 12) / 2));
        break;
      case 'plane':
        geo = new PlaneGeometry(p.size?.[0] ?? 0.5, p.size?.[1] ?? 0.5);
        break;
      case 'box':
      default: {
        const s = p.size || fallbackSize;
        geo = new BoxGeometry(s[0] ?? 0.5, s[1] ?? 0.5, s[2] ?? 0.5);
        break;
      }
    }
    const matId = SLOT_MATERIALS[p.slot] || p.mat || 'flat';
    const m = new Mesh(geo, materialFor(matId, { side: p.type === 'plane' ? 'double' : undefined }));
    const pos = p.pos || [0, 0, 0];
    m.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    const rot = p.rot || [0, 0, 0];
    m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.slot = p.slot || 'primary';
    g.add(m);
  }
  return g;
}

/** A last-resort placeholder: a box of exactly the declared metric size. */
export function placeholderBox(size = [0.5, 0.5, 0.5], colorIndex = 2) {
  const [w, h, d] = size;
  const g = new Group();
  const body = new Mesh(
    new BoxGeometry(Math.max(w, 0.02), Math.max(h, 0.02), Math.max(d, 0.02)),
    materialFor('flat', { flatShading: true }),
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.placeholder = true;
  body.userData.tint = tint(colorIndex);
  g.add(body);
  g.userData.placeholder = true;
  return g;
}

// ---------------------------------------------------------------------------
// the loader

export class Assets {
  /**
   * @param {object} opts
   *   basePath  : where the GLBs live, default 'assets/models/'
   *   catalog   : { [id]: CatalogEntry } — used for size verification. Optional;
   *               setCatalog() can supply it later once catalog.js exists.
   */
  constructor(opts = {}) {
    this.basePath = opts.basePath ?? 'assets/models/';
    this.catalog = opts.catalog || null;
    this.cache = new Map();       // id -> { group, size, placeholder }
    this.loading = new Map();     // id -> Promise
    this.warnings = [];
    this._loader = null;
    this._missing = new Set();
    this._box = new Box3();
    this._size = new Vector3();
  }

  setCatalog(catalog) { this.catalog = catalog; }

  entry(id) { return this.catalog?.[id] || null; }

  async _gltfLoader() {
    if (this._loader) return this._loader;
    try {
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js').catch(() => ({ DRACOLoader: null })),
      ]);
      const l = new GLTFLoader();
      if (DRACOLoader) {
        const d = new DRACOLoader();
        d.setDecoderPath('https://unpkg.com/three@0.180.0/examples/jsm/libs/draco/');
        l.setDRACOLoader(d);
      }
      this._loader = l;
    } catch (err) {
      console.warn('[assets] GLTFLoader unavailable, everything will be a placeholder', err);
      this._loader = null;
    }
    return this._loader;
  }

  /**
   * get(id) -> Promise<{ group, size:Vector3, placeholder:boolean }>
   * `group` is the SHARED prototype — clone it, or better, hand its geometry to
   * an InstancePool. Never mutate the prototype.
   */
  get(id) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.loading.has(id)) return this.loading.get(id);
    const p = this._load(id).finally(() => this.loading.delete(id));
    this.loading.set(id, p);
    return p;
  }

  /** Synchronous accessor for anything already resolved, else null. */
  peek(id) { return this.cache.get(id) || null; }

  async _load(id) {
    const e = this.entry(id);
    const declared = e?.size || null;
    const file = e?.file || null;

    let group = null;
    let placeholder = false;

    if (file) {
      const loader = await this._gltfLoader();
      if (loader) {
        try {
          const url = /^(https?:)?\//.test(file) || file.startsWith('assets/') ? file : this.basePath + file;
          const gltf = await loader.loadAsync(url);
          group = gltf.scene;
          group.traverse((o) => {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
          });
        } catch (err) {
          if (!this._missing.has(id)) {
            this._missing.add(id);
            console.warn(`[assets] "${id}" (${file}) failed to load — using a placeholder`);
          }
          group = null;
        }
      }
    }

    if (!group) {
      placeholder = true;
      const shapes = await getProcShapes();
      // proc-shapes.js builds from the CATALOGUE ENTRY (it reads entry.proc and
      // falls back to a block of entry.size), so hand it the entry, not the id.
      let desc = null;
      if (shapes && e) {
        try { desc = shapes.buildProcShape(e); } catch (err) { desc = null; }
      }
      group = (desc && buildProcedural(desc, declared)) || placeholderBox(declared || [0.5, 0.5, 0.5], hashIndex(id));
      group.name = `placeholder:${id}`;
    } else {
      group.name = `asset:${id}`;
    }

    // Measure. Always. Even the placeholder — a proc-shapes description can drift
    // from the catalogue just as easily as a Blender export can.
    this._box.setFromObject(group);
    const size = this._box.getSize(new Vector3());
    const rec = { id, group, size, box: this._box.clone(), placeholder };

    if (declared) {
      const drift = this._verify(id, declared, size, placeholder);
      rec.drift = drift;
    }

    this.cache.set(id, rec);
    return rec;
  }

  _verify(id, declared, measured, placeholder) {
    const axes = ['w', 'h', 'd'];
    const m = [measured.x, measured.y, measured.z];
    const worst = { axis: null, pct: 0 };
    for (let i = 0; i < 3; i++) {
      const dec = declared[i];
      if (!dec) continue;
      const pct = Math.abs(m[i] - dec) / dec;
      if (pct > worst.pct) { worst.pct = pct; worst.axis = axes[i]; worst.declared = dec; worst.measured = m[i]; }
    }
    if (worst.pct > DRIFT_TOLERANCE) {
      const msg = `[assets] size drift on "${id}" ${worst.axis}: catalogue ${worst.declared.toFixed(3)} m, `
        + `mesh ${worst.measured.toFixed(3)} m (${(worst.pct * 100).toFixed(1)} %)`
        + (placeholder ? ' [placeholder]' : '');
      this.warnings.push({ id, ...worst, placeholder });
      if (!placeholder) console.warn(msg);
    }
    return worst.pct;
  }

  /**
   * Preload a list of ids (or the whole catalogue). Never rejects.
   * Returns { total, loaded, placeholders, drifted }.
   */
  async preload(ids = null, onProgress = null) {
    const list = ids || Object.keys(this.catalog || {});
    let done = 0;
    const recs = [];
    for (const id of list) {
      recs.push(await this.get(id).catch(() => null));
      done++;
      onProgress?.(done / list.length, id);
    }
    const loaded = recs.filter((r) => r && !r.placeholder).length;
    const placeholders = recs.filter((r) => r && r.placeholder).length;
    const summary = {
      total: list.length, loaded, placeholders,
      drifted: this.warnings.filter((w) => !w.placeholder).length,
    };
    console.info(`[assets] ${summary.loaded} models, ${summary.placeholders} placeholders, ${summary.drifted} over ${DRIFT_TOLERANCE * 100} % drift`);
    return summary;
  }

  /** A fresh instance of a prototype. Prefer the InstancePool where you can. */
  instance(id) {
    const rec = this.cache.get(id);
    if (!rec) return null;
    const c = rec.group.clone(true);
    c.userData.catalogId = id;
    return c;
  }

  dispose() {
    for (const rec of this.cache.values()) {
      rec.group.traverse?.((o) => { if (o.isMesh) o.geometry?.dispose(); });
    }
    this.cache.clear();
  }
}

function hashIndex(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export { Box3, Vector3 };
