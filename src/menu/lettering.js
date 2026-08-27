// lettering.js — real extruded 3D lettering for the menu facade.
//
// The menu buttons ARE the signage on the building, so the letters have to be
// geometry, not a sprite: they catch the key light, they throw a shadow onto the
// render behind them, and they sit 60 mm proud of the wall like fabricated
// channel letters actually do.
//
// Two paths, one interface:
//   1. three/addons FontLoader + TextGeometry with helvetiker_bold, fetched from
//      the SAME pinned unpkg origin the import map already uses for three itself.
//      If that origin is reachable, three is reachable, so this is not a new
//      dependency.
//   2. A built-in stroke font (STROKES below) if the typeface JSON 404s — a
//      version bump on the CDN must not leave the menu without buttons. It is
//      drawn like draughting stencil lettering, which is the right register for
//      a game about an architect anyway.
//
// Both paths return ONE merged BufferGeometry per line, so a line of signage is
// one draw call.
//
// The typeface has no U+0141 LATIN CAPITAL LETTER L WITH STROKE, and the game's
// display title is "Smendiłendi Bureau" with the Polish ł. We letter the title in
// caps, so 'Ł' is synthesised: the 'L' glyph plus a bar across its stem at the
// proportions Polish typefaces actually use (bar at ~55 % of cap height, rising
// left to right, projecting past the stem on both sides).

import { BufferGeometry, BufferAttribute, BoxGeometry, Box3, Vector3, Matrix4 } from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FONT_URL = 'https://unpkg.com/three@0.180.0/examples/fonts/helvetiker_bold.typeface.json';

/** helvetiker's cap height as a fraction of the em size, measured off the 'H' glyph. */
export const CAP_RATIO = 0.72;

let _font = null;
let _fontPromise = null;
let _fontFailed = false;

/**
 * Load the typeface once. Never rejects: a failure resolves to null and the
 * caller silently gets the stroke font instead.
 */
export function loadLetteringFont(url = FONT_URL) {
  if (_font || _fontFailed) return Promise.resolve(_font);
  if (_fontPromise) return _fontPromise;
  _fontPromise = new Promise((resolve) => {
    new FontLoader().load(
      url,
      (font) => { _font = font; resolve(font); },
      undefined,
      (err) => {
        _fontFailed = true;
        console.warn('[menu] typeface unavailable, falling back to stencil lettering', err?.message || err);
        resolve(null);
      },
    );
  });
  return _fontPromise;
}

export function letteringFont() { return _font; }

// ---------------------------------------------------------------------------
// Public API

/**
 * buildText(text, opts) -> BufferGeometry
 *
 * opts:
 *   cap       cap height in metres (NOT the em size — signage is specified by
 *             cap height, so that is what the caller gets to say)
 *   depth     extrusion depth in metres (how far the letter stands off the wall)
 *   bevel     true for a 6 mm arris on the letter faces
 *   align     'left' | 'centre' — where x = 0 sits
 *   maxWidth  if given, the whole line is scaled down to fit
 *
 * The returned geometry has its baseline at y = 0 and carries
 * geometry.userData = { width, cap, scale } so a caller can lay lines out.
 */
export function buildText(text, opts = {}) {
  const {
    cap = 0.5,
    depth = 0.06,
    bevel = true,
    align = 'left',
    maxWidth = 0,
  } = opts;

  const raw = _font ? textFromFont(String(text), cap, depth, bevel)
    : textFromStrokes(String(text), cap, depth);

  if (!raw) return emptyGeometry();

  raw.computeBoundingBox();
  const bb = raw.boundingBox;
  let width = bb.max.x - bb.min.x;
  let scale = 1;
  if (maxWidth > 0 && width > maxWidth) {
    scale = maxWidth / width;
    raw.applyMatrix4(new Matrix4().makeScale(scale, scale, 1));
    raw.computeBoundingBox();
    width = raw.boundingBox.max.x - raw.boundingBox.min.x;
  }
  // Baseline stays at y = 0; x is anchored by `align`.
  const dx = align === 'centre' ? -(raw.boundingBox.min.x + raw.boundingBox.max.x) / 2 : -raw.boundingBox.min.x;
  raw.applyMatrix4(new Matrix4().makeTranslation(dx, 0, 0));
  raw.computeBoundingBox();
  raw.computeBoundingSphere();
  raw.userData = { width, cap: cap * scale, scale, text: String(text) };
  return raw;
}

/**
 * Width one line WOULD occupy at a given cap height, without building geometry.
 * Used to pick a single common scale for a stack of menu lines, so the four
 * buttons are lettered at one size the way a real sign schedule would be.
 */
export function measureText(text, cap = 0.5) {
  const s = String(text);
  if (_font) {
    const size = cap / CAP_RATIO;
    let w = 0;
    for (const ch of s) w += advance(ch, size);
    return w;
  }
  const unit = cap / STROKE_CAP;
  let w = 0;
  for (const ch of s) w += (STROKE_ADVANCE[ch] ?? STROKE_ADVANCE._) * unit;
  return w;
}

/** A flat box that covers a line of lettering — the invisible hover target. */
export function hitBox(geometry, pad = 0.22, depth = 0.35) {
  const bb = geometry.boundingBox || new Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  const w = bb.max.x - bb.min.x + pad * 2;
  const h = bb.max.y - bb.min.y + pad * 2;
  const g = new BoxGeometry(w, h, depth);
  g.translate((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, depth / 2 - 0.05);
  return g;
}

// ---------------------------------------------------------------------------
// Path 1 — the loaded typeface

function advance(ch, size) {
  const glyphs = _font?.data?.glyphs;
  if (!glyphs) return size * 0.6;
  const key = SUBSTITUTE[ch] ?? ch;
  const g = glyphs[key] || glyphs[' '] || null;
  const res = _font.data.resolution || 1000;
  if (!g) return size * 0.5;
  return (g.ha / res) * size;
}

/** Characters the typeface does not have, and what we draw instead. */
const SUBSTITUTE = { 'Ł': 'L', 'ł': 'l', 'Ż': 'Z', 'ż': 'z', 'Ó': 'O', 'ó': 'o' };

function textFromFont(text, cap, depth, bevel) {
  const size = cap / CAP_RATIO;
  const parts = [];
  let x = 0;
  for (const ch of text) {
    const adv = advance(ch, size);
    if (ch !== ' ') {
      const draw = SUBSTITUTE[ch] ?? ch;
      let g;
      try {
        g = new TextGeometry(draw, {
          font: _font,
          size,
          depth,
          curveSegments: 4,
          bevelEnabled: !!bevel,
          bevelThickness: bevel ? 0.008 : 0,
          bevelSize: bevel ? 0.006 : 0,
          bevelSegments: 1,
        });
      } catch (err) {
        console.warn('[menu] glyph failed', ch, err?.message || err);
        g = null;
      }
      if (g && g.getAttribute('position')?.count) {
        g.translate(x, 0, 0);
        parts.push(g);
        // Synthesise the Polish stroke on Ł / ł.
        if (ch === 'Ł' || ch === 'ł') parts.push(polishBar(x, size, cap, depth, ch === 'Ł'));
      }
    }
    x += adv;
  }
  return mergeParts(parts);
}

/** The bar of Ł: a slim slab across the stem, rising left to right. */
function polishBar(x, size, cap, depth, isCap) {
  const t = cap * 0.13;                 // bar thickness
  const len = cap * (isCap ? 0.52 : 0.44);
  const stem = size * 0.09;             // helvetiker bold stem is ~0.09 em from the left edge
  const g = new BoxGeometry(len, t, depth);
  g.rotateZ(0.42);                      // Polish typefaces rake the bar ~24 degrees
  g.translate(x + stem + size * 0.05, cap * (isCap ? 0.52 : 0.42), depth / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Path 2 — the built-in stencil font
//
// Glyphs on a 6 wide x 10 tall cell (cap height 10, baseline y = 0), described
// as polylines. Curves are polygonised, which is exactly what stencil lettering
// on a drawing looks like, so nothing is lost.

const STROKE_CAP = 10;
const STROKE_W = 1.35;                  // stroke thickness in cell units

const S = {
  A: [[[0,0],[3,10],[6,0]], [[1,3.3],[5,3.3]]],
  B: [[[0,0],[0,10],[3.6,10],[5,9],[5,6.4],[3.6,5.4],[0,5.4]], [[3.6,5.4],[5.3,4.4],[5.3,1],[3.6,0],[0,0]]],
  C: [[[5.6,8.4],[4,10],[1.6,10],[0,8.4],[0,1.6],[1.6,0],[4,0],[5.6,1.6]]],
  D: [[[0,0],[0,10],[3.4,10],[5.4,8.2],[5.4,1.8],[3.4,0],[0,0]]],
  E: [[[5.4,10],[0,10],[0,0],[5.4,0]], [[0,5.2],[4.4,5.2]]],
  F: [[[5.4,10],[0,10],[0,0]], [[0,5.2],[4.4,5.2]]],
  G: [[[5.6,8.4],[4,10],[1.6,10],[0,8.4],[0,1.6],[1.6,0],[4,0],[5.6,1.6],[5.6,4.4],[3.2,4.4]]],
  H: [[[0,0],[0,10]], [[6,0],[6,10]], [[0,5.2],[6,5.2]]],
  I: [[[3,0],[3,10]]],
  J: [[[5,10],[5,2],[3.6,0],[1.4,0],[0,1.8]]],
  K: [[[0,0],[0,10]], [[5.8,10],[0.4,4.8]], [[1.8,6.2],[6,0]]],
  L: [[[0,10],[0,0],[5.4,0]]],
  M: [[[0,0],[0,10],[3,4.6],[6,10],[6,0]]],
  N: [[[0,0],[0,10],[6,0],[6,10]]],
  O: [[[1.6,0],[0,1.8],[0,8.2],[1.6,10],[4.4,10],[6,8.2],[6,1.8],[4.4,0],[1.6,0]]],
  P: [[[0,0],[0,10],[3.8,10],[5.4,8.8],[5.4,6],[3.8,4.8],[0,4.8]]],
  Q: [[[1.6,0],[0,1.8],[0,8.2],[1.6,10],[4.4,10],[6,8.2],[6,1.8],[4.4,0],[1.6,0]], [[3.6,2.6],[6.2,-0.4]]],
  R: [[[0,0],[0,10],[3.8,10],[5.4,8.8],[5.4,6],[3.8,4.8],[0,4.8]], [[2.8,4.8],[6,0]]],
  S: [[[5.6,8.6],[4,10],[1.6,10],[0,8.6],[0,6.4],[1.4,5.3],[4.4,5.3],[5.8,4.1],[5.8,1.4],[4.2,0],[1.6,0],[0,1.4]]],
  T: [[[0,10],[6,10]], [[3,10],[3,0]]],
  U: [[[0,10],[0,1.8],[1.6,0],[4.4,0],[6,1.8],[6,10]]],
  V: [[[0,10],[3,0],[6,10]]],
  W: [[[0,10],[1.4,0],[3,6.4],[4.6,0],[6,10]]],
  X: [[[0,0],[6,10]], [[0,10],[6,0]]],
  Y: [[[0,10],[3,5],[6,10]], [[3,5],[3,0]]],
  Z: [[[0,10],[6,10],[0,0],[6,0]]],
  0: [[[1.4,0],[0,1.8],[0,8.2],[1.4,10],[4,10],[5.4,8.2],[5.4,1.8],[4,0],[1.4,0]]],
  1: [[[1,8.2],[2.8,10],[2.8,0]]],
  2: [[[0,8.4],[1.6,10],[3.8,10],[5.4,8.4],[5.4,6.4],[0,0],[5.4,0]]],
  3: [[[0,9.6],[1.8,10],[4,10],[5.4,8.6],[5.4,6.4],[3.6,5.3],[5.4,4.2],[5.4,1.4],[4,0],[1.6,0],[0,1]]],
  4: [[[4,0],[4,10],[0,3.2],[5.6,3.2]]],
  5: [[[5.2,10],[0.4,10],[0,5.6],[3.4,6],[5.2,4.6],[5.2,1.6],[3.6,0],[1.2,0],[0,1]]],
  6: [[[5,9.4],[3.4,10],[1.4,10],[0,8],[0,1.8],[1.4,0],[3.8,0],[5.2,1.6],[5.2,3.8],[3.8,5.2],[1.4,5.2],[0,3.8]]],
  7: [[[0,10],[5.6,10],[2,0]]],
  8: [[[1.6,5.2],[0,6.6],[0,8.6],[1.6,10],[4,10],[5.4,8.6],[5.4,6.6],[3.8,5.2],[1.6,5.2],[0,3.8],[0,1.4],[1.6,0],[4,0],[5.4,1.4],[5.4,3.8],[3.8,5.2]]],
  9: [[[0.4,0.6],[2,0],[4,0],[5.4,2],[5.4,8.2],[4,10],[1.6,10],[0.2,8.4],[0.2,6.2],[1.6,4.8],[4,4.8],[5.4,6.2]]],
  '-': [[[1,5.2],[5,5.2]]],
  '.': [[[2.6,0],[3.4,0]]],
  '/': [[[0.6,0],[5.4,10]]],
  ':': [[[2.6,2.4],[3.4,2.4]], [[2.6,6.6],[3.4,6.6]]],
};
// Ł is L with the raked bar.
S['Ł'] = [...S.L, [[-0.4, 4.6], [3.4, 6.2]]];

const STROKE_ADVANCE = { _: 7.4, I: 4.0, '.': 4.0, ':': 4.0, '-': 6.4, '1': 5.6, ' ': 3.4, M: 7.8, W: 7.8 };

function strokeAdvance(ch) { return STROKE_ADVANCE[ch] ?? STROKE_ADVANCE._; }

function textFromStrokes(text, cap, depth) {
  const unit = cap / STROKE_CAP;
  const parts = [];
  let x = 0;
  for (const ch of text) {
    const up = ch.toUpperCase();
    const glyph = S[up];
    if (glyph) {
      for (const poly of glyph) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i], b = poly[i + 1];
          parts.push(strokeSegment(a, b, unit, depth, x));
        }
        // a small square plug at every joint keeps the corners solid
        for (const p of poly) parts.push(strokeJoint(p, unit, depth, x));
      }
    }
    x += strokeAdvance(up) * unit;
  }
  return mergeParts(parts);
}

function strokeSegment(a, b, unit, depth, ox) {
  const ax = a[0] * unit + ox, ay = a[1] * unit;
  const bx = b[0] * unit + ox, by = b[1] * unit;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1e-4;
  const t = STROKE_W * unit;
  const g = new BoxGeometry(len, t, depth);
  g.rotateZ(Math.atan2(dy, dx));
  g.translate((ax + bx) / 2, (ay + by) / 2, depth / 2);
  return g;
}

function strokeJoint(p, unit, depth, ox) {
  const t = STROKE_W * unit;
  const g = new BoxGeometry(t, t, depth);
  g.translate(p[0] * unit + ox, p[1] * unit, depth / 2);
  return g;
}

// ---------------------------------------------------------------------------

function mergeParts(parts) {
  let clean = parts.filter((g) => g && g.getAttribute('position')?.count);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  // mergeGeometries insists every input agrees about the index buffer, and this
  // list mixes both kinds: TextGeometry is an ExtrudeGeometry and comes back
  // non-indexed, while the BoxGeometry used for the stroke font and for the bar
  // of Ł is indexed. Expand the indexed ones rather than trying to index the
  // others — a line of signage is a few hundred triangles either way.
  const anyIndexed = clean.some((g) => g.index);
  const anyPlain = clean.some((g) => !g.index);
  if (anyIndexed && anyPlain) {
    clean = clean.map((g) => {
      if (!g.index) return g;
      const flat = g.toNonIndexed();
      g.dispose();
      return flat;
    });
  }
  for (const g of clean) {
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    }
  }
  const merged = mergeGeometries(clean, false);
  if (!merged) {
    console.warn('[menu] lettering merge failed; showing the first glyph only');
    return clean[0];
  }
  for (const g of clean) g.dispose();
  return merged;
}

function emptyGeometry() {
  const g = new BufferGeometry();
  g.userData = { width: 0, cap: 0, scale: 1, text: '' };
  g.boundingBox = new Box3(new Vector3(), new Vector3());
  return g;
}
