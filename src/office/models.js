// models.js — the office's bridge to the Blender catalogue in assets/models/.
//
// WHY THIS FILE EXISTS
//
// 122 GLBs sit in assets/models/ — bevelled, one connected body per material
// region, dimensions verified against src/model/catalog.js — and until now the
// office used NONE of them: props.js generated all 39 of its props from boxes
// and cylinders. Rendered side by side under the same light rig
// (tools/prop-sheet.html), the catalogue wins on every object it has:
// bookshelf-800 is a carcass with sides, a back and five shelves against a black
// slab with lines scored in it; lamp-floor is a drum shade on a stem against a
// single bent plane; plant-ficus-large is a trunk with branches and leaves
// against a brown box with flat blades stuck in it.
//
// So the office routes through the catalogue where the catalogue has the object.
//
// HOW, and why not just add the GLB scene to the scene graph
//
// The office's whole look is one pipeline: MeshBuilder bakes an exact surface
// colour AND a contact/wall ambient-occlusion ramp into vertex colour, then
// merges everything into ONE geometry per material class. That is what keeps
// the room at 46 draw calls and what puts the AO band at every floor junction
// (finish bar item 5). Dropping a GLB in as its own Group would cost a draw call
// per material per instance, lose the AO bake, and import the catalogue's own
// saturated greens (foliage #5c8e4f, HSV s 0.44) into a room whose palette is
// capped at s 0.25 outside the single accent (finish bar item 10).
//
// Instead we take the GLB's GEOMETRY and re-enter it into the office pipeline:
// every mesh is flattened to prop-local space, tagged with the office material
// class and studio colour its Blender material slot maps to, and handed back as
// the same `[{ mat, color, geometry }]` shape MeshBuilder.model() consumes. The
// silhouettes are Blender's; the colour, the AO and the draw-call budget stay
// the office's.
//
// LOADING
//
// The Mode contract is synchronous (`init(ctx)` builds the whole office), so the
// models must be in memory before Office.build() runs. This module therefore
// uses TOP-LEVEL AWAIT: main.js already does `await import(mode.path)` for every
// mode at boot, so the office module simply resolves a little later and nothing
// downstream has to become async. Every failure mode is contained — a GLB that
// 404s, a GLTFLoader that will not import, or the whole thing timing out — falls
// back to the procedural body of the prop, which is the code that shipped
// before. Nothing here can fail the boot.

import { Box3, Vector3, Matrix4 } from 'three';

// Resolved against THIS MODULE, not against the page. tools/prop-sheet.html
// lives one directory down, and a page-relative 'assets/models/' silently 404s
// there — which looks exactly like "the catalogue routing does not work".
const BASE = new URL('../../assets/models/', import.meta.url).href;
const LOAD_TIMEOUT_MS = 8000;
const DRIFT_TOLERANCE = 0.02;      // ARCHITECTURE.md rule 6

// ---------------------------------------------------------------------------
// Blender material slot -> office look.
//
// The catalogue exports a closed vocabulary of 15 slot names (verified across
// all 122 GLBs). `mat` is a palette material class from src/core/palette.js;
// `color` is the EXACT final surface colour, the same contract as props.js —
// MeshBuilder divides by the class's own base before writing the attribute.
//
// The hex values are the office's, not the GLB's: OFFICE in props.js is the
// single source, and they are repeated here as literals only because props.js
// imports this file and the cycle has to be broken somewhere. Any change to a
// value here must be made in OFFICE too, and the studio-green note below is the
// reason they are not simply the GLB's own colours.
export const SLOT_LOOK = {
  // white base: the per-instance / per-call tint lands here and nowhere else
  tint:     { mat: 'flat',        color: 0xffffff },
  metal:    { mat: 'metal',       color: 0x9c9a95 },   // OFFICE.steel
  chrome:   { mat: 'metal',       color: 0xd2cfc8 },
  graphite: { mat: 'ink',         color: 0x3a3835 },   // OFFICE.charcoal
  rubber:   { mat: 'ink',         color: 0x1d1c1a },   // OFFICE.nearBlack
  glass:    { mat: 'glass',       color: null },
  // Foliage: the GLB greens are s 0.44, which would be a second saturated hue
  // competing with the studio orange. These are OFFICE.leaf / leafDark and a
  // mid tone between them — s 0.17-0.18, inside the finish bar's 0.25 cap.
  soil:     { mat: 'flat',        color: 0x4c443b },   // OFFICE.soil
  stem:     { mat: 'flat',        color: 0x6b5f4e },
  foliage:  { mat: 'flat',        color: 0x76806a },   // OFFICE.leaf
  foliage2: { mat: 'flat',        color: 0x87907a },
  foliage3: { mat: 'flat',        color: 0x5b6553 },   // OFFICE.leafDark
  wood:     { mat: 'wood-dark',   color: 0x9c8f7c },   // OFFICE.walnutSoft
  paper:    { mat: 'paper',       color: 0xf1ece2 },   // OFFICE.paper
  accent:   { mat: 'accent',      color: 0xd4763a },   // ACCENT
  ceramic:  { mat: 'tile',        color: 0xe9e6df },   // OFFICE.ceramic
};

const FALLBACK_SLOT = { mat: 'flat', color: 0xcbc6bd };

// ---------------------------------------------------------------------------
// What the office takes from the catalogue.
//
// `size` is the catalogue's declared metric size and is CHECKED against the
// loaded mesh; `slots` overrides the look table for this model only. Anything
// the catalogue does not have — the A0 plan chest, the roll plotter, the
// cubicle screens, the cardboard boxes — is not listed here and stays
// procedural in props.js. So does the monitor: desks.js hangs the live in-game
// OS off MONITOR_SCREEN/MONITOR_ANCHOR in props.js, and moving the bezel
// without moving those two constants is exactly the bug that put the whole OS
// under the desk for three rounds. It is not worth re-opening for an object
// that already reads correctly.

export const MODELS = {
  desk: {
    file: 'desk-1600', size: [1.60, 0.74, 0.80],
    // The top is the tier-tinted timber, as in the procedural desk.
    slots: { tint: { mat: 'wood-light', color: 0xffffff } },
  },
  taskChair:    { file: 'chair-task',        size: [0.65, 1.10, 0.65] },
  stackChair:   { file: 'chair-stacking',    size: [0.44, 0.80, 0.50] },
  // bookshelf-800 is deliberately not here: office.js stands 34 instanced books
  // ON the shelves, so it needs the shelf heights as numbers. See the note on
  // propBookshelf / BOOKSHELF_SHELVES in props.js.
  deskLamp:     { file: 'lamp-desk',         size: [0.20, 0.55, 0.20] },
  floorLamp:    { file: 'lamp-floor',        size: [0.40, 1.60, 0.40] },
  // Shade only: it hangs from y = 0 down to y = -0.24, and props.js keeps the
  // procedural cord and the lit disc above/below it.
  pendantShade: { file: 'pendant-lamp',      size: [0.40, 0.24, 0.40] },
  plantFicus:   { file: 'plant-ficus-large', size: [0.80, 1.80, 0.80] },
  plantMonstera:{ file: 'plant-monstera',    size: [0.70, 1.20, 0.70] },
  // plant-pot-small is deliberately NOT here — see the note on propPlantSmall
  // in props.js. The model has holes through the pot wall and a stick bundle
  // for foliage; it is reported rather than used.
  // table-meeting-8 is deliberately not here: rendered against the procedural
  // trestle table it is the plainer object. See propMeetingTable in props.js.
  bin:          { file: 'bin-office',        size: [0.30, 0.40, 0.30] },
  credenza:     { file: 'sideboard-1600',    size: [1.60, 0.80, 0.45] },
};

// ---------------------------------------------------------------------------

const PARTS = new Map();          // key -> [{ slot, mat, color, geometry, size }]
const REPORT = { loaded: [], failed: [], drift: [], ms: 0 };

/** The baked parts for a catalogue-backed prop, or null if it is not available. */
export function modelParts(key) { return PARTS.get(key) || null; }

/** True when at least one model loaded — i.e. the office is running on the catalogue. */
export function modelsAvailable() { return PARTS.size > 0; }

/** What happened at boot. Printed by office.js and read by the prop sheet. */
export function modelReport() { return REPORT; }

/**
 * Declared metric size of a catalogue-backed prop, so a call site can scale to
 * a size it needs without hard-coding the model's dimensions twice.
 */
export function modelSize(key) {
  const rec = PARTS.get(key);
  return rec ? rec.size : (MODELS[key]?.size || null);
}

// ---------------------------------------------------------------------------
// loading

function stripGeometry(geo) {
  // The office merges GLB geometry into the same buffers as BoxGeometry and
  // CylinderGeometry, and mergeGeometries refuses a set whose attributes or
  // indexed-ness disagree. Everything the office draws is indexed with
  // position + normal (+ the colour MeshBuilder writes), so normalise to that.
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(idx);
  }
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

function bakeOne(key, spec, gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(gltfScene.matrixWorld).invert();
  const parts = [];
  const m = new Matrix4();
  gltfScene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const slotName = mats[0]?.name || 'tint';
    const look = (spec.slots && spec.slots[slotName]) || SLOT_LOOK[slotName] || FALLBACK_SLOT;
    const geo = stripGeometry(o.geometry.clone());
    m.multiplyMatrices(inverse, o.matrixWorld);
    geo.applyMatrix4(m);
    parts.push({ slot: slotName, mat: look.mat, color: look.color, geometry: geo });
  });
  if (!parts.length) return null;

  // ARCHITECTURE.md rule 6: measure, never assume. The catalogue declares the
  // metric size; the mesh has to agree, and a prop that silently arrives 8 %
  // short is a prop an architect will measure and disbelieve.
  const box = new Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  const size = box.getSize(new Vector3());
  parts.size = [size.x, size.y, size.z];
  parts.box = box;
  const declared = spec.size;
  if (declared) {
    for (let i = 0; i < 3; i++) {
      const d = declared[i];
      if (!d) continue;
      const pct = Math.abs(parts.size[i] - d) / d;
      if (pct > DRIFT_TOLERANCE) {
        REPORT.drift.push({ key, axis: 'xyz'[i], declared: d, measured: parts.size[i], pct });
        console.warn(`[office/models] size drift on "${key}" (${spec.file}) `
          + `${'xyz'[i]}: catalogue ${d.toFixed(3)} m, mesh ${parts.size[i].toFixed(3)} m `
          + `(${(pct * 100).toFixed(1)} %)`);
      }
    }
  }
  return parts;
}

async function loadAll() {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  let GLTFLoader;
  try {
    ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  } catch (err) {
    console.warn('[office/models] GLTFLoader unavailable — the office stays on procedural props', err);
    REPORT.failed.push({ key: '*', reason: 'no GLTFLoader' });
    return;
  }
  const loader = new GLTFLoader();

  const jobs = Object.entries(MODELS).map(async ([key, spec]) => {
    try {
      const gltf = await loader.loadAsync(`${BASE}${spec.file}.glb`);
      const parts = bakeOne(key, spec, gltf.scene);
      if (!parts) throw new Error('no meshes in the GLB');
      PARTS.set(key, parts);
      REPORT.loaded.push(key);
    } catch (err) {
      REPORT.failed.push({ key, file: spec.file, reason: String(err && err.message || err) });
      console.warn(`[office/models] "${key}" (${spec.file}) unavailable — `
        + `falling back to the procedural prop: ${err && err.message}`);
    }
  });

  // A hung request must not hold the boot. Whatever has not arrived by the
  // timeout simply is not in PARTS, and props.js draws its procedural body.
  let timer = null;
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise((res) => { timer = setTimeout(() => {
      console.warn(`[office/models] timed out after ${LOAD_TIMEOUT_MS} ms — `
        + `${PARTS.size}/${Object.keys(MODELS).length} models in, the rest stay procedural`);
      res();
    }, LOAD_TIMEOUT_MS); }),
  ]);
  if (timer) clearTimeout(timer);

  REPORT.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
  console.info(`[office/models] ${REPORT.loaded.length}/${Object.keys(MODELS).length} `
    + `catalogue models in ${REPORT.ms.toFixed(0)} ms`
    + (REPORT.failed.length ? `, ${REPORT.failed.length} fell back to procedural` : '')
    + (REPORT.drift.length ? `, ${REPORT.drift.length} over ${DRIFT_TOLERANCE * 100} % drift` : ''));
}

// Top-level await: see the header. The office module graph is loaded once, at
// boot, behind main.js's own `await import(...)`.
await loadAll();
