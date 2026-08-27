// palette.js — the look contract for the whole game.
//
// DESIGN-DECISIONS.md "Look": clean low poly, simple volumes, softly bevelled edges,
// a limited WARM palette, flat colours on furniture (no textures on props), soft
// lighting with ambient occlusion.
//
// Everything visible in the game takes its colour from here. No other file may
// invent a hex value. Materials are cached singletons keyed by id + variant, so
// two calls to materialFor('wood-light') return the SAME material instance and the
// renderer can batch them.
//
// Colours are authored in sRGB hex and fed to THREE.Color with setHex(hex, SRGBColorSpace)
// semantics (three r152+ converts hex literals through the working colour space
// automatically when ColorManagement is enabled, which engine.js does).

import {
  MeshStandardMaterial, MeshPhysicalMaterial, Color, DoubleSide, FrontSide,
  DirectionalLight, HemisphereLight, AmbientLight, MathUtils,
  BufferGeometry, BufferAttribute, Mesh, PlaneGeometry, CanvasTexture,
  Vector3,
} from 'three';
// Prices are NOT ours. catalog.js is view-free (three math only), so importing it
// here costs nothing and keeps a single source of truth for money.
import { materialPrice } from '../model/catalog.js';

// COMPASS CONVENTION — shared with src/commission/plot.js ("north is -z, south is
// +z, east is +x, west is -x") and src/analysis/daylight.js sunVector()
// ("+X east, -Z north, +Y up"). Azimuth is measured clockwise from north, so
//     east  = +x = sin(az)
//     north = -z = -cos(az)
// A sun due south (az 180) therefore sits at +z and throws every shadow to -z.
// This file used to have the sign flipped, which put the midday sun in the north
// and contradicted the daylight analysis the client's e-mail is built from.

// ---------------------------------------------------------------------------
// 1. The palette proper — warm, limited, architectural.

export const COLORS = {
  // neutrals, warm-shifted (never pure grey — every neutral has a touch of ochre)
  paper:      0xf3ece1,   // lightest plaster / paper
  plaster:    0xe8ddcd,   // interior wall
  plasterWarm:0xdfd0ba,   // sunlit facade
  stone:      0xc9bda9,
  concrete:   0xb4aca1,
  concreteDk: 0x8d8880,
  graphite:   0x4a4642,   // darkest structural tone
  ink:        0x2b2825,   // text, outlines

  // wood
  woodLight:  0xd7ab73,   // oak / birch
  woodMid:    0xb98450,
  woodDark:   0x7d5433,   // walnut
  woodRed:    0x9d5f38,

  // masonry / ground
  brick:      0xa9573f,
  brickPale:  0xc07a5c,
  tile:       0xe4e6e3,   // sanitary tile, faintly cool to read as ceramic
  tileDark:   0x6f7d7a,
  paving:     0xbdb5a8,
  asphalt:    0x50504e,
  grass:      0x7f9a52,
  grassDry:   0xa2a45c,
  soil:       0x6f5a45,

  // accents — the brand tones of the studio
  accent:     0xd4763a,   // Smendiłendi orange, used for UI highlight + hero props
  accentDeep: 0xa8501f,
  teal:       0x3f7a76,   // the cool counterweight
  sky:        0xa9c6d8,

  // glass and metal
  glass:      0xcfe0e2,
  metal:      0x9aa0a2,
  metalWarm:  0xb08d5e,   // brass
};

// 16 flat furniture tints. Deliberately desaturated and warm-biased so a room
// full of them still reads as one picture. Index order is stable — the network
// sends the index, not the hex.
export const FURNITURE_TINTS = [
  0xe8ddcd, // 0  bone
  0xd7c9b0, // 1  linen
  0xbfae95, // 2  hessian
  0x8d7f6c, // 3  taupe
  0x55504a, // 4  charcoal
  0x2f2c29, // 5  near-black
  0xd4763a, // 6  orange
  0xb2472e, // 7  rust
  0x86341f, // 8  burnt
  0xc9a227, // 9  mustard
  0x7f9a52, // 10 olive
  0x476b4a, // 11 forest
  0x3f7a76, // 12 teal
  0x35566e, // 13 slate blue
  0x7a6b8a, // 14 dusty violet
  0xb2657a, // 15 dusty rose
];

export function tint(i) {
  return FURNITURE_TINTS[((i | 0) % FURNITURE_TINTS.length + FURNITURE_TINTS.length) % FURNITURE_TINTS.length];
}

// ---------------------------------------------------------------------------
// 2. Material classes.
//
// Each entry is a physically-plausible description. roughness/metalness are not
// decorative: they are what makes plaster read as plaster next to tile.

// The `use` tag says who is allowed to ask for this class, and it is checked by
// the core cross-check script:
//   'finish' — a surface the PLAYER PAINTS WITH. The id vocabulary here is not
//              ours: it is exactly the key set of MATERIAL_PRICES in
//              src/model/catalog.js (routed through MATERIAL_ALIAS in
//              src/model/geometry.js). A finish that is priced but has no class
//              here rendered as grey plaster, which is how nine of them —
//              paint, timberFloor, tileFloor, vinyl, carpet, terrazzo,
//              polishedConcrete, gravel, decking — used to look.
//   'prop'   — object/prop materials referenced by SLOT_MATERIALS in
//              src/core/assets.js and by the menu/office scenes. Never painted.
//   'both'   — legitimately used as a finish AND as a prop material.
//
// There is deliberately NO price here. Money has exactly one home,
// MATERIAL_PRICES in src/model/catalog.js (ARCHITECTURE.md rule 7). This file
// used to carry a second `cost` per class that disagreed with it on 13 of the
// 13 shared ids (plaster 45 vs 85, brick 120 vs 260, glass 380 vs 720).
export const MATERIAL_CLASSES = {
  // -- prop / structural base ------------------------------------------------
  // 'flat' is the base for ANYTHING that gets its colour per-instance or per-vertex.
  // An InstancedMesh instance colour MULTIPLIES the material colour, so a tinted
  // pool built on a coloured material double-darkens. Pools and furniture use this.
  'flat':          { color: 0xffffff,           roughness: 0.72, metalness: 0.0,  use: 'prop' },

  // -- wall / ceiling finishes ----------------------------------------------
  'plaster':       { color: COLORS.plaster,     roughness: 0.94, metalness: 0.0,  use: 'both' },
  'plaster-warm':  { color: COLORS.plasterWarm, roughness: 0.94, metalness: 0.0,  use: 'finish' }, // alias target of 'render'
  'paint':         { color: COLORS.paper,       roughness: 0.96, metalness: 0.0,  use: 'finish' },
  'paper':         { color: COLORS.paper,       roughness: 0.97, metalness: 0.0,  use: 'prop' },
  'brick':         { color: COLORS.brick,       roughness: 0.88, metalness: 0.0,  use: 'both' },
  'brick-pale':    { color: COLORS.brickPale,   roughness: 0.88, metalness: 0.0,  use: 'prop' },
  'stone':         { color: COLORS.stone,       roughness: 0.80, metalness: 0.0,  use: 'finish' },
  'concrete':      { color: COLORS.concrete,    roughness: 0.90, metalness: 0.0,  use: 'both' },
  'concrete-dark': { color: COLORS.concreteDk,  roughness: 0.90, metalness: 0.0,  use: 'prop' },
  'polishedConcrete': { color: 0xa9a49b,        roughness: 0.38, metalness: 0.0,  use: 'finish' },
  'tile':          { color: COLORS.tile,        roughness: 0.22, metalness: 0.0,  use: 'both' },
  'tile-dark':     { color: COLORS.tileDark,    roughness: 0.22, metalness: 0.0,  use: 'prop' },
  'terrazzo':      { color: 0xded6c6,           roughness: 0.34, metalness: 0.0,  use: 'finish' },

  // -- timber ----------------------------------------------------------------
  'wood-light':    { color: COLORS.woodLight,   roughness: 0.62, metalness: 0.0,  use: 'prop' },
  'wood-mid':      { color: COLORS.woodMid,     roughness: 0.58, metalness: 0.0,  use: 'both' },  // alias target of 'wood'/'timber'
  'wood-dark':     { color: COLORS.woodDark,    roughness: 0.52, metalness: 0.0,  use: 'prop' },
  'timberFloor':   { color: 0xc79a63,           roughness: 0.55, metalness: 0.0,  use: 'finish' },
  'decking':       { color: 0xa87b4c,           roughness: 0.80, metalness: 0.0,  use: 'finish' },

  // -- floor finishes --------------------------------------------------------
  'tileFloor':     { color: 0xd9d5cd,           roughness: 0.28, metalness: 0.0,  use: 'finish' },
  'vinyl':         { color: 0xcfc7ba,           roughness: 0.45, metalness: 0.0,  use: 'finish' },
  'carpet':        { color: 0x8d8272,           roughness: 1.00, metalness: 0.0,  use: 'finish' },

  // -- glass, metal ----------------------------------------------------------
  'glass':         { color: COLORS.glass,       roughness: 0.05, metalness: 0.0,  use: 'both', glass: true },
  'metal':         { color: COLORS.metal,       roughness: 0.35, metalness: 0.85, use: 'both' },
  'metal-warm':    { color: COLORS.metalWarm,   roughness: 0.30, metalness: 0.90, use: 'prop' },

  // -- external ground -------------------------------------------------------
  'grass':         { color: COLORS.grass,       roughness: 1.0,  metalness: 0.0,  use: 'both' },
  'paving':        { color: COLORS.paving,      roughness: 0.85, metalness: 0.0,  use: 'both' },
  'gravel':        { color: 0xa39a8c,           roughness: 1.0,  metalness: 0.0,  use: 'finish' },
  'asphalt':       { color: COLORS.asphalt,     roughness: 0.95, metalness: 0.0,  use: 'both' },
  'soil':          { color: COLORS.soil,        roughness: 1.0,  metalness: 0.0,  use: 'prop' },

  // -- studio accents --------------------------------------------------------
  'accent':        { color: COLORS.accent,      roughness: 0.55, metalness: 0.0,  use: 'prop' },
  'ink':           { color: COLORS.ink,         roughness: 0.7,  metalness: 0.0,  use: 'prop' },
};

/**
 * Finishes that src/model/geometry.js currently redirects to a different class
 * through its MATERIAL_ALIAS table, so the class named here is NOT what the
 * player sees. That file belongs to the model agent; this list exists so the
 * divergence is tracked instead of silently rendering the wrong surface, and so
 * tools/verify-core.mjs fails the moment a NEW one appears.
 *
 *   stone  — a real stone class exists here (COLORS.stone, roughness 0.80) but
 *            geometry.js aliases 'stone' -> 'concrete'. Stone cladding costs
 *            480/m2 against fair-faced concrete's 130/m2 and reads completely
 *            differently on a facade; the alias should be dropped now that the
 *            class exists. HANDOFF to the model agent.
 */
export const ALIASED_AWAY = { stone: 'concrete' };

/** Ids a player may paint a surface with (their names come from catalog.js). */
export const FINISH_IDS = Object.keys(MATERIAL_CLASSES).filter((k) => MATERIAL_CLASSES[k].use !== 'prop');
/** Ids only props, scenery and the UI may use. */
export const PROP_IDS = Object.keys(MATERIAL_CLASSES).filter((k) => MATERIAL_CLASSES[k].use !== 'finish');

export const MATERIAL_IDS = Object.keys(MATERIAL_CLASSES);

const _cache = new Map();

/**
 * materialFor(id, opts) -> a cached MeshStandardMaterial.
 * opts: { vertexColors, side:'front'|'double', transparent, flatShading }
 * Anything that needs a per-object colour should use vertexColors or an
 * InstancedMesh instance colour rather than cloning a material.
 */
export function materialFor(id, opts = {}) {
  const spec = MATERIAL_CLASSES[id];
  if (!spec) {
    if (!_cache.has('__missing_warned_' + id)) {
      _cache.set('__missing_warned_' + id, true);
      console.warn(`[palette] unknown material id "${id}" — falling back to plaster`);
    }
    return materialFor('plaster', opts);
  }
  const key = [
    id,
    opts.vertexColors ? 'vc' : '',
    opts.side === 'double' ? 'ds' : '',
    opts.flatShading ? 'fs' : '',
    opts.transparent ? 'tr' : '',
  ].join('|');
  let m = _cache.get(key);
  if (m) return m;

  const common = {
    color: new Color(spec.color),
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: opts.side === 'double' ? DoubleSide : FrontSide,
    flatShading: !!opts.flatShading,
    vertexColors: !!opts.vertexColors,
  };

  if (spec.glass) {
    m = new MeshPhysicalMaterial({
      ...common,
      transparent: true,
      opacity: 0.28,
      transmission: 0.0,      // real transmission is too expensive for the budget
      envMapIntensity: 1.0,
      depthWrite: false,
      side: DoubleSide,
    });
  } else {
    m = new MeshStandardMaterial({
      ...common,
      transparent: !!opts.transparent,
      opacity: opts.transparent ? (opts.opacity ?? 0.5) : 1,
    });
  }
  m.name = `mat:${id}`;
  m.userData.materialId = id;
  m.userData.costPerM2 = materialCost(id);
  _cache.set(key, m);
  return m;
}

/**
 * Unit cost per m2 for a finish id.
 *
 * Delegated, never duplicated: src/model/catalog.js owns every price in the game
 * and src/analysis/cost.js bills from it. This function exists only so view code
 * that already holds a palette id does not have to reach across two modules.
 * `id` may be a palette class id or a catalog finish id — PALETTE_TO_FINISH
 * translates the handful that differ.
 */
export const PALETTE_TO_FINISH = {
  'plaster-warm': 'render',
  'wood-light': 'wood',
  'wood-mid': 'wood',
  'wood-dark': 'wood',
  'brick-pale': 'brick',
  'concrete-dark': 'concrete',
  'tile-dark': 'tile',
  'metal-warm': 'metal',
  'flat': 'paint',
  'paper': 'paint',
  'accent': 'paint',
  'ink': 'paint',
  'soil': 'grass',
};

export function materialCost(id) {
  const finish = PALETTE_TO_FINISH[id] || id;
  return materialPrice(finish);
}

/**
 * A single shared material for everything that is flat-coloured furniture.
 * Per-object colour arrives as an InstancedMesh instance colour or vertex colour,
 * so the whole catalogue can render in a handful of draw calls.
 */
export function furnitureMaterial({ flatShading = false, vertexColors = true } = {}) {
  return materialFor('flat', { vertexColors, flatShading });
}

/**
 * The material an InstancePool should use when it supplies per-instance colours.
 * White base, so the instance colour IS the colour the player sees.
 */
export function tintedMaterial({ flatShading = false } = {}) {
  return materialFor('flat', { flatShading });
}

export function disposeMaterials() {
  for (const m of _cache.values()) if (m && m.dispose) m.dispose();
  _cache.clear();
}

// ---------------------------------------------------------------------------
// 3. Lighting rig.
//
// One warm key DirectionalLight with a tuned shadow camera, one cool
// HemisphereLight, plus a very low ambient so shadowed interiors never go black.
// Sun elevation/azimuth follow a plausible day arc for a mid-latitude site
// (Warsaw, 52 N): the sun never gets higher than ~60 deg even at noon in summer.

const DAY = {
  morning: { elev: 18, azim: 100, sun: 0xffd9a8, sky: 0xbcd6ea, ground: 0x8e7f6a, sunI: 2.0, hemiI: 0.55 },
  noon:    { elev: 55, azim: 175, sun: 0xfff2dd, sky: 0xcfe3f2, ground: 0x9c8f79, sunI: 3.0, hemiI: 0.75 },
  afternoon:{elev: 32, azim: 235, sun: 0xffdcae, sky: 0xc4d9ea, ground: 0x9a8a72, sunI: 2.5, hemiI: 0.65 },
  evening: { elev: 9,  azim: 268, sun: 0xffb972, sky: 0x9fb4c9, ground: 0x6f6353, sunI: 1.5, hemiI: 0.40 },
  overcast:{ elev: 45, azim: 180, sun: 0xe8e6e2, sky: 0xd2d8dd, ground: 0x8f8a80, sunI: 0.9, hemiI: 1.15 },
};

/**
 * makeLightRig(scene, { timeOfDay, indoor, radius }) -> handle
 *
 * radius = the half-size in metres of the area that must receive shadows; the
 * directional light's orthographic shadow camera is fitted to exactly that, which
 * is what keeps shadow texels large enough to look soft rather than crunchy.
 * Returns { key, hemi, ambient, setTimeOfDay(t), focus(x,z), dispose() }.
 */
export function makeLightRig(scene, opts = {}) {
  const {
    timeOfDay = 'afternoon',
    indoor = false,
    radius = 30,
    shadowMapSize = 2048,
  } = opts;

  const key = new DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2.5;               // softens PCFSoft further
  key.target.position.set(0, 0, 0);
  scene.add(key);
  scene.add(key.target);

  const hemi = new HemisphereLight(0xffffff, 0xffffff, 1);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  // A whisper of ambient. Interiors in a low-poly game with no GI go pure black
  // in shadow otherwise; 0.10-0.18 is enough to keep material colour readable.
  const ambient = new AmbientLight(0xfff0dd, indoor ? 0.30 : 0.18);
  scene.add(ambient);

  let current = timeOfDay;

  function fitShadow(r) {
    const c = key.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 0.5; c.far = r * 4 + 20;
    c.updateProjectionMatrix();
  }

  function setTimeOfDay(t) {
    const d = DAY[t] || DAY.afternoon;
    current = DAY[t] ? t : 'afternoon';
    const el = MathUtils.degToRad(d.elev);
    const az = MathUtils.degToRad(d.azim);
    const dist = radius * 2.2 + 20;
    key.position.set(
      key.target.position.x + Math.sin(az) * Math.cos(el) * dist,
      key.target.position.y + Math.sin(el) * dist,
      key.target.position.z + Math.cos(az) * Math.cos(el) * dist,
    );
    key.color.setHex(d.sun);
    key.intensity = d.sunI * (indoor ? 0.85 : 1);
    hemi.color.setHex(d.sky);
    hemi.groundColor.setHex(d.ground);
    hemi.intensity = d.hemiI;
  }

  function focus(x, z) {
    key.target.position.set(x, 0, z);
    key.target.updateMatrixWorld();
    setTimeOfDay(current);
  }

  fitShadow(radius);
  setTimeOfDay(timeOfDay);

  return {
    key, hemi, ambient,
    setTimeOfDay, focus,
    fitShadow,
    get timeOfDay() { return current; },
    dispose() {
      scene.remove(key); scene.remove(key.target);
      scene.remove(hemi); scene.remove(ambient);
      key.dispose(); hemi.dispose(); ambient.dispose();
    },
  };
}

/** Background/fog colours that go with a time of day. */
export function skyFor(timeOfDay = 'afternoon') {
  const d = DAY[timeOfDay] || DAY.afternoon;
  return { sky: d.sky, ground: d.ground, sun: d.sun };
}

export const UI = {
  bg:        '#20201e',
  panel:     '#2b2926',
  panelHi:   '#37342f',
  line:      '#4a4642',
  text:      '#f3ece1',
  textDim:   '#a89f92',
  accent:    '#d4763a',
  good:      '#7f9a52',
  warn:      '#c9a227',
  bad:       '#b2472e',
};
