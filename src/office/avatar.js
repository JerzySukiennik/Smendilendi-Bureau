// avatar.js — the player character: one rigged GLB per body build, an outfit
// assembled by showing and hiding meshes, colours multiplied into five tint
// slots, six named clips, and a nick plaque that floats over the head.
//
// This module is a LIBRARY. It knows nothing about the office, the network or
// the player controller: it hands back a Group you parent wherever you like and
// an AnimationMixer you must drive. Wiring it into the office belongs elsewhere.
//
//
// API
// ---
//
//   const av = await loadAvatar(spec)
//
//     spec          an AvatarSpec (below); missing keys fall back to DEFAULT_SPEC
//     av.group      THREE.Group, origin between the feet, +Z the way it faces,
//                   scaled 1:1 in metres (1.74 / 1.77 / 1.80 m tall)
//     av.mixer      THREE.AnimationMixer — call av.update(dt) every frame
//     av.update(dt) advances the mixer; equivalent to av.mixer.update(dt)
//     av.play(clip, opts)   cross-fade to a clip by name. opts:
//                     { fade = 0.18, loop, timeScale = 1, reset = false }
//                     Non-looping clips (sit, wave) hold their last frame.
//                     Returns the AnimationAction.
//     av.playing    the name of the clip currently faded in
//     av.setTint(slot, hex)  slot in TINT_SLOTS, hex '#rrggbb' or 0xrrggbb
//     av.setPiece(name, on)  show/hide one wardrobe mesh by its GLB name
//                     ('top_hoodie', 'hair_bun', 'extra_cap', …). Use setSpec
//                     for ordinary outfit changes — this is the escape hatch.
//     av.setSpec(spec)  re-dress and re-colour in place, no reload
//     av.spec       the resolved spec currently on screen (read-only copy)
//     av.height     measured stature in metres
//     av.dispose()  frees the geometries, materials and textures THIS avatar
//                   owns. The shared source GLB stays cached for the next one.
//
//   randomSpec(seed)    a deterministic, plausible spec. Same seed, same person.
//                       `seed` may be a number or a string (a nick, a peer id).
//   DEFAULT_SPEC        the spec every field falls back to
//   BUILDS, TOPS, BOTTOMS, SHOES, HAIR, TINT_SLOTS, CLIPS
//                       the spec space, for a character-creation UI to iterate
//   makeNickLabel(nick, color, opts)
//                       a billboarded THREE.Sprite carrying the nick on a
//                       plaque. Position it yourself (NICK_Y is a good height).
//                       The sprite is returned immediately and REDRAWS ITSELF
//                       once the bundled Nunito has loaded — nothing to await.
//                       .dispose() on the returned sprite frees its texture.
//
//
// AvatarSpec
// ----------
//
//   {
//     build:   'slim' | 'regular' | 'broad',
//     top:     'tshirt' | 'shirt' | 'hoodie',
//     bottom:  'tracksuit' | 'chinos' | 'skirt',
//     shoes:   'trainers' | 'boots',
//     hair:    'short' | 'buzz' | 'bob' | 'long' | 'bun' | 'curly',
//     cap:     boolean,      // only sits right over 'short' or 'buzz'
//     glasses: boolean,
//     colors: { top, bottom, shoes, hair, skin, extra }   // '#rrggbb'
//   }
//
// The GLB carries every piece at once; dressing is visibility. Bare forearms
// (`body_arms`) show only under the t-shirt and bare legs (`body_legs`) only
// under the skirt, so the heaviest wearable silhouette is ~3040 triangles out
// of the ~5980 in the file.
//
//
// Why the source GLB is cached and the instance is cloned
// ------------------------------------------------------
//
// Three players in one office is three avatars off at most three GLBs. The
// parsed glTF is cached per build and every avatar is a SkeletonUtils.clone of
// it, which shares geometry (cheap) but needs its own materials, because the
// tint is a material colour and two players do not wear the same jumper. So
// materials are cloned per avatar and disposed with it; geometry belongs to the
// cache and is never disposed by an instance.

import {
  AnimationMixer, Box3, CanvasTexture, Color, DoubleSide, Group, LoopOnce, LoopRepeat,
  SRGBColorSpace, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// --- the spec space ---------------------------------------------------------

export const BUILDS = ['slim', 'regular', 'broad'];
export const TOPS = ['tshirt', 'shirt', 'hoodie'];
export const BOTTOMS = ['tracksuit', 'chinos', 'skirt'];
export const SHOES = ['trainers', 'boots'];
export const HAIR = ['short', 'buzz', 'bob', 'long', 'bun', 'curly'];
export const TINT_SLOTS = ['top', 'bottom', 'shoes', 'hair', 'skin', 'extra'];
export const CLIPS = ['idle', 'walk', 'sit', 'sit_idle', 'type', 'wave'];

/** Clips that must not loop: they are transitions or one-shots. */
const ONCE = new Set(['sit', 'wave']);

export const DEFAULT_SPEC = Object.freeze({
  build: 'regular',
  top: 'hoodie',
  bottom: 'tracksuit',
  shoes: 'trainers',
  hair: 'short',
  cap: false,
  glasses: false,
  colors: Object.freeze({
    top: '#3a6ea5',
    bottom: '#8a8f96',
    shoes: '#e6e2d8',
    hair: '#3a2c22',
    skin: '#d8b48c',
    extra: '#c8452b',
  }),
});

/** Height above the group's origin for the nick plaque, in metres. */
export const NICK_Y = 2.02;

// Palettes a random person may be dressed from. Kept inside the office's warm,
// low-saturation range (DESIGN-DECISIONS "Look") — the clothes are allowed one
// saturated note each, the room is not.
const CLOTH_COLORS = [
  '#3a6ea5', '#2f5d8a', '#c8452b', '#d98c3f', '#5b7f5a', '#7a5f8e',
  '#39424c', '#8a8f96', '#c9c2b4', '#a8453f', '#2f6f6a', '#d6c26b',
];
const BOTTOM_COLORS = [
  '#39424c', '#8a8f96', '#5a5148', '#2f3a44', '#6f6a60', '#3f4a3f', '#7d6b57',
];
const SHOE_COLORS = ['#e6e2d8', '#2b2825', '#c14a3a', '#3d5570', '#b7b1a4'];
const HAIR_COLORS = ['#241c16', '#3a2c22', '#5b4530', '#8a6a3f', '#b89a63', '#7d7d7d', '#c2603a'];
const SKIN_COLORS = ['#f2d3b8', '#e6bd97', '#d8b48c', '#c39468', '#9c6b45', '#6f4a30', '#4a3122'];

// --- the shared GLB cache ---------------------------------------------------

// Resolved against THIS MODULE, not the page: tools/avatar-preview.html sits one
// directory down and a page-relative 'assets/…' silently 404s there.
const ASSET_BASE = new URL('../../assets/avatars/', import.meta.url);

const sources = new Map();       // build -> Promise<GLTF>
let loader = null;

function sourceFor(build) {
  if (!sources.has(build)) {
    loader ||= new GLTFLoader();
    sources.set(build, loader.loadAsync(new URL(`avatar-${build}.glb`, ASSET_BASE).href));
  }
  return sources.get(build);
}

/** Warm the cache before the office needs an avatar. Never rejects. */
export function preloadAvatars(builds = BUILDS) {
  return Promise.all(builds.map((b) => sourceFor(b).catch(() => null)));
}

// --- spec helpers -----------------------------------------------------------

function resolve(spec = {}) {
  const pick = (v, list, fb) => (list.includes(v) ? v : fb);
  return {
    build: pick(spec.build, BUILDS, DEFAULT_SPEC.build),
    top: pick(spec.top, TOPS, DEFAULT_SPEC.top),
    bottom: pick(spec.bottom, BOTTOMS, DEFAULT_SPEC.bottom),
    shoes: pick(spec.shoes, SHOES, DEFAULT_SPEC.shoes),
    hair: pick(spec.hair, HAIR, DEFAULT_SPEC.hair),
    cap: !!spec.cap,
    glasses: !!spec.glasses,
    colors: { ...DEFAULT_SPEC.colors, ...(spec.colors || {}) },
  };
}

/** The set of GLB mesh names a spec puts on screen. */
function wornMeshes(s) {
  const on = new Set(['body', 'face', `top_${s.top}`, `bottom_${s.bottom}`,
    `shoes_${s.shoes}`, `hair_${s.hair}`]);
  if (s.top === 'tshirt') on.add('body_arms');       // bare forearms
  if (s.bottom === 'skirt') on.add('body_legs');     // bare shins
  if (s.cap) on.add('extra_cap');
  if (s.glasses) on.add('extra_glasses');
  return on;
}

/** mulberry32 — small, fast, and identical everywhere. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A deterministic, plausible person. Pass a peer id or a nick and everyone in
 * the session generates the same stranger for the same player.
 */
export function randomSpec(seed = Math.floor(Math.random() * 2 ** 32)) {
  const r = rng(typeof seed === 'string' ? hashString(seed) : seed);
  const of = (list) => list[Math.floor(r() * list.length) % list.length];
  const hair = of(HAIR);
  return {
    build: of(BUILDS),
    top: of(TOPS),
    bottom: of(BOTTOMS),
    shoes: of(SHOES),
    hair,
    // a cap only reads right over cropped hair, and not on everyone
    cap: (hair === 'short' || hair === 'buzz') && r() < 0.28,
    glasses: r() < 0.3,
    colors: {
      top: of(CLOTH_COLORS),
      bottom: of(BOTTOM_COLORS),
      shoes: of(SHOE_COLORS),
      hair: of(HAIR_COLORS),
      skin: of(SKIN_COLORS),
      extra: of(CLOTH_COLORS),
    },
  };
}

// --- loading ----------------------------------------------------------------

/**
 * Build one avatar. Resolves once its GLB is in memory (the first call per body
 * build fetches ~840 kB; later ones are clones of the cached parse).
 */
export async function loadAvatar(spec = {}) {
  const s = resolve(spec);
  const gltf = await sourceFor(s.build);

  const group = new Group();
  group.name = `avatar-${s.build}`;
  const root = cloneSkinned(gltf.scene);
  group.add(root);

  // Materials are per-avatar: the tint is a material colour, and two players do
  // not share a jumper. Geometry stays shared with the cache.
  const mats = new Map();          // slot name -> cloned material
  // GLB piece name -> the meshes that make it up. GLTFLoader SPLITS a mesh with
  // more than one material into `name_1`, `name_2`, so a piece is a list, and
  // the piece name is the node name with that suffix stripped.
  const meshes = new Map();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const piece = o.name.replace(/_\d+$/, '');
    if (!meshes.has(piece)) meshes.set(piece, []);
    meshes.get(piece).push(o);
    o.castShadow = true;
    o.receiveShadow = false;       // a 3000-triangle body self-shadowing is noise
    o.frustumCulled = false;       // skinned bounds are the rest pose's, not the clip's
    const list = Array.isArray(o.material) ? o.material : [o.material];
    // The skirt is an OPEN cone: a swinging leg passes through it, and with a
    // single-sided material that reads as a tear with a leg in it. It gets its
    // own two-sided clone of the shared slot material.
    const twoSided = piece === 'bottom_skirt';
    const cloned = list.map((m) => {
      const key = twoSided ? `${m.name}@skirt` : m.name;
      if (!mats.has(key)) {
        const c = m.clone();
        c.name = m.name;
        c.userData.slot = m.name;
        if (twoSided) c.side = DoubleSide;
        mats.set(key, c);
      }
      return mats.get(key);
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });

  const mixer = new AnimationMixer(root);
  const actions = new Map();
  for (const clip of gltf.animations) {
    const a = mixer.clipAction(clip);
    a.clampWhenFinished = true;
    a.setLoop(ONCE.has(clip.name) ? LoopOnce : LoopRepeat, Infinity);
    actions.set(clip.name, a);
  }

  const av = {
    group,
    mixer,
    spec: s,
    playing: null,
    height: 0,

    update(dt) { mixer.update(dt); },

    play(name, opts = {}) {
      const next = actions.get(name);
      if (!next) return null;
      const { fade = 0.18, timeScale = 1, reset = false, loop } = opts;
      if (loop !== undefined) next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      next.timeScale = timeScale;
      if (av.playing === name && !reset) return next;
      const prev = av.playing && actions.get(av.playing);
      if (reset || next.time === 0 || ONCE.has(name)) next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      if (prev && prev !== next && fade > 0) {
        next.play();
        prev.crossFadeTo(next, fade, false);
      } else {
        if (prev && prev !== next) prev.stop();
        next.play();
      }
      av.playing = name;
      return next;
    },

    setTint(slot, hex) {
      const want = slot === 'skin' ? 'skin' : `tint_${slot}`;
      let hit = false;
      for (const mat of mats.values()) {
        if (mat.userData.slot !== want) continue;
        mat.color.set(hex);
        hit = true;
      }
      if (hit) av.spec.colors[slot] = typeof hex === 'string' ? hex : `#${new Color(hex).getHexString()}`;
    },

    setPiece(name, on) {
      for (const m of meshes.get(name) || []) m.visible = !!on;
    },

    setSpec(next) {
      const r = resolve({ ...av.spec, ...next, colors: { ...av.spec.colors, ...(next.colors || {}) } });
      if (r.build !== av.spec.build) {
        console.warn('[avatar] setSpec cannot change the body build in place; reload instead');
        r.build = av.spec.build;
      }
      av.spec = r;
      const on = wornMeshes(r);
      for (const [name, list] of meshes) for (const m of list) m.visible = on.has(name);
      for (const slot of TINT_SLOTS) av.setTint(slot, r.colors[slot]);
      av.height = measure();
    },

    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      for (const m of mats.values()) {
        for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) m[k]?.dispose?.();
        m.dispose();
      }
      group.removeFromParent();
      // geometry belongs to the cached source GLB and is deliberately kept
    },
  };

  // Stature is measured over the VISIBLE pieces in the rest pose. Box3
  // .setFromObject would happily include the hidden long hair hanging past the
  // shoulders and report a taller person than the one on screen.
  const box = new Box3();
  const tmp = new Box3();
  function measure() {
    root.updateWorldMatrix(true, true);
    box.makeEmpty();
    for (const list of meshes.values()) for (const m of list) {
      if (!m.visible) continue;
      m.geometry.computeBoundingBox();
      tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      box.union(tmp);
    }
    return box.getSize(new Vector3()).y;
  }

  av.setSpec(s);
  av.play('idle', { fade: 0 });

  return av;
}

// --- the nick plaque --------------------------------------------------------

const NICK_FONT = 'AvatarNick';
let fontPromise = null;

/** Loads the bundled Nunito once; resolves to the family name or null. */
function nickFont() {
  if (fontPromise) return fontPromise;
  if (typeof FontFace === 'undefined' || !document?.fonts) {
    fontPromise = Promise.resolve(null);
    return fontPromise;
  }
  const url = new URL('Nunito-Bold.ttf', ASSET_BASE).href;
  const face = new FontFace(NICK_FONT, `url(${url})`, { weight: '700' });
  fontPromise = face.load().then((f) => {
    document.fonts.add(f);
    return NICK_FONT;
  }).catch(() => null);
  return fontPromise;
}

const NICK = {
  px: 44,          // cap height in CSS-ish pixels before supersampling
  ss: 3,           // supersample factor — drawn at 3x, mipmapped down
  padX: 22,
  padY: 11,
  radius: 14,
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawNick(canvas, nick, color, family) {
  const { px, ss, padX, padY, radius } = NICK;
  const ctx = canvas.getContext('2d');
  const font = `700 ${px * ss}px ${family ? `"${family}", ` : ''}system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(nick).width) + padX * 2 * ss;
  const h = Math.ceil((px + padY * 2) * ss);
  // power-of-two-ish is not required, but a stable width avoids a resize per frame
  canvas.width = Math.max(8, w);
  canvas.height = h;
  ctx.font = font;                       // resizing the canvas clears the state
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // the plaque: dark, translucent, softly rounded — legible over a pale office
  // wall and over a dark monitor alike, without becoming a UI element
  ctx.fillStyle = 'rgba(22, 20, 18, 0.30)';
  roundRect(ctx, 0, 0, canvas.width, canvas.height, radius * ss);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = Math.max(1, 1.2 * ss);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // a soft drop shadow does the work a stroke would do badly at this size
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 5 * ss;
  ctx.shadowOffsetY = 1.5 * ss;
  ctx.fillStyle = color;
  ctx.fillText(nick, canvas.width / 2, canvas.height / 2 + 1 * ss);
  return { w: canvas.width, h: canvas.height };
}

/**
 * A billboarded nick plaque.
 *
 * @param {string} nick   the player's name; trimmed to 18 characters
 * @param {string} color  the player's colour, '#rrggbb'
 * @param {object} opts   { height = 0.13 }  world height of the plaque in metres
 * @returns {Sprite}      with .dispose(); .setNick(nick, color) redraws it
 */
export function makeNickLabel(nick, color = '#ffffff', opts = {}) {
  const height = opts.height ?? 0.13;
  const canvas = document.createElement('canvas');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    // the plaque must stay readable when a desk is between you and the player,
    // but not glow through a wall — depthTest on, render last
  });
  const sprite = new Sprite(material);
  sprite.renderOrder = 10;

  let text = String(nick ?? '').slice(0, 18) || '?';
  let tint = color;

  const redraw = (family) => {
    const { w, h } = drawNick(canvas, text, tint, family);
    texture.needsUpdate = true;
    sprite.scale.set((w / h) * height, height, 1);
  };

  redraw(null);                                   // readable immediately
  nickFont().then((f) => { if (f) redraw(f); });  // crisper a moment later

  sprite.setNick = (n, c) => {
    text = String(n ?? '').slice(0, 18) || '?';
    if (c) tint = c;
    nickFont().then((f) => redraw(f));
  };
  sprite.dispose = () => {
    texture.dispose();
    material.dispose();
    sprite.removeFromParent();
  };
  return sprite;
}
