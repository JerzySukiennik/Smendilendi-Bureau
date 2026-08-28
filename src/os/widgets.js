// widgets.js — the pixel kit every part of the fictional OS draws with.
//
// Everything here is measured out of reference/retro-os/ANALYSIS.md. The two
// bevel constructions in section 2 are the heart of it and they are NOT the same
// rule:
//
//   window frame / panel (EDGE_RAISED)  top-left  #DFDFDF then #FFFFFF
//                                       bot-right #808080 then #000000
//   push button (DrawFrameControl)      top-left  #FFFFFF then #DFDFDF
//                                       bot-right #808080 then #000000
//
// "So: window frame = light-then-white. Button = white-then-light. Getting this
// backwards is the single most common tell of a fake." (ANALYSIS.md 2b)
//
// No alpha, no gradients (except the one documented Win98 title ramp), no
// rounded corners, no easing. Every "50 %" is a 1-pixel checkerboard where
// pixel (x+y) parity picks the colour, computed in absolute screen space so the
// pattern is continuous across every widget that uses it.

import { SANS, SANS_BOLD, splitMnemonic } from './font.js';

// ---------------------------------------------------------------------------
// Palettes

/** Windows 95/98 default scheme. ANALYSIS.md section 3. */
export const WIN = {
  face: '#C0C0C0',
  hi: '#FFFFFF',            // ButtonHighlight / 3DHilight
  light: '#DFDFDF',         // ButtonLight / 3DLight — the fourth grey people forget
  shadow: '#808080',        // ButtonShadow
  dark: '#000000',          // ButtonDarkShadow
  window: '#FFFFFF',
  text: '#000000',
  gray: '#808080',
  titleActive: '#000080',
  titleActive2: '#1084D0',  // GradientActiveTitle, Win98 only
  titleText: '#FFFFFF',
  titleInactive: '#808080',
  titleInactive2: '#B5B5B5',
  titleInactiveText: '#C0C0C0',
  hilite: '#000080',
  hiliteText: '#FFFFFF',
  desktop: '#008080',
  info: '#FFFFE1',
  infoText: '#000000',
};

/** Mac OS 8 Platinum. The seven neutral greys sampled in ANALYSIS.md section 8. */
export const PLATINUM = {
  face: '#CCCCCC',
  hi: '#FFFFFF',
  light: '#DDDDDD',
  shadow: '#999999',
  dark: '#000000',
  mid: '#EEEEEE',
  stripe: '#777777',
  window: '#FFFFFF',
  text: '#000000',
  gray: '#777777',
  titleActive: '#CCCCCC',
  titleText: '#000000',
  titleInactive: '#CCCCCC',
  titleInactiveText: '#777777',
  hilite: '#000080',
  hiliteText: '#FFFFFF',
  desktop: '#999999',
  info: '#FFFFE1',
  infoText: '#000000',
};

/** The 16-colour VGA set (ANALYSIS.md section 7) — icons draw from this only. */
export const VGA = {
  black: '#000000', maroon: '#800000', green: '#008000', olive: '#808000',
  navy: '#000080', purple: '#800080', teal: '#008080', silver: '#C0C0C0',
  gray: '#808080', red: '#FF0000', lime: '#00FF00', yellow: '#FFFF00',
  blue: '#0000FF', fuchsia: '#FF00FF', aqua: '#00FFFF', white: '#FFFFFF',
  // the four extra static system colours
  moneygreen: '#C0DCC0', skyblue: '#A6CAF0', cream: '#FFFBF0', medgray: '#A0A0A4',
};

// ---------------------------------------------------------------------------
// Primitives. Every coordinate is floored — nothing is ever half a pixel.

export function fill(g, x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

export function hline(g, x, y, w, c) { fill(g, x, y, w, 1, c); }
export function vline(g, x, y, h, c) { fill(g, x, y, 1, h, c); }

/** 1 px outline, no fill. */
export function frameRect(g, x, y, w, h, c) {
  hline(g, x, y, w, c);
  hline(g, x, y + h - 1, w, c);
  vline(g, x, y + 1, h - 2, c);
  vline(g, x + w - 1, y + 1, h - 2, c);
}

/**
 * One bevel line pair: top-left colour `tl`, bottom-right colour `br`, drawn as
 * an L on each side so the corner pixel belongs to the top-left run — exactly
 * how DrawEdge lays it down.
 */
function edge(g, x, y, w, h, tl, br) {
  if (w <= 0 || h <= 0) return;
  hline(g, x, y, w, tl);
  vline(g, x, y, h, tl);
  hline(g, x, y + h - 1, w, br);
  vline(g, x + w - 1, y, h, br);
}

/**
 * bevel(g, x, y, w, h, style, pal)
 *   'panel'   EDGE_RAISED  — window frames, scrollbars, menus, toolbars
 *   'button'  raised push button
 *   'pressed' pushed-in button (two lines only)
 *   'sunken'  EDGE_SUNKEN  — text fields, list views, the client area
 *   'etched'  EDGE_ETCHED  — group boxes and separators, two lines only
 *   'thin'    one raised line (toolbar buttons on hover)
 *   'thinIn'  one sunken line
 * Returns the inset rectangle the caller may draw content into.
 */
export function bevel(g, x, y, w, h, style = 'panel', pal = WIN) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  switch (style) {
    case 'panel':                                     // light then white inward
      edge(g, x, y, w, h, pal.light, pal.dark);
      edge(g, x + 1, y + 1, w - 2, h - 2, pal.hi, pal.shadow);
      return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
    case 'button':                                    // white then light inward
      edge(g, x, y, w, h, pal.hi, pal.dark);
      edge(g, x + 1, y + 1, w - 2, h - 2, pal.light, pal.shadow);
      return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
    case 'pressed':
      edge(g, x, y, w, h, pal.shadow, pal.hi);
      return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    case 'sunken':
      edge(g, x, y, w, h, pal.shadow, pal.hi);
      edge(g, x + 1, y + 1, w - 2, h - 2, pal.dark, pal.light);
      return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
    case 'etched':
      edge(g, x, y, w, h, pal.shadow, pal.hi);
      edge(g, x + 1, y + 1, w - 2, h - 2, pal.face, pal.face);
      return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
    case 'thin':
      edge(g, x, y, w, h, pal.hi, pal.shadow);
      return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    case 'thinIn':
      edge(g, x, y, w, h, pal.shadow, pal.hi);
      return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    case 'outline':                                   // Platinum: 1 px black rule
      frameRect(g, x, y, w, h, pal.dark);
      return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    default:
      return { x, y, w, h };
  }
}

/** A raised panel filled with ButtonFace, the commonest thing in the OS. */
export function panel(g, x, y, w, h, pal = WIN, style = 'panel') {
  fill(g, x, y, w, h, pal.face);
  return bevel(g, x, y, w, h, style, pal);
}

// --- 1-pixel dithers -------------------------------------------------------
// ANALYSIS.md section 6: "pixel (x, y) uses colour A when (x + y) is even".
// The pattern is created once per colour pair and anchored at the canvas origin,
// so the parity is global and continuous — the way a real blit mask behaves.

const _patterns = new Map();

export function checkerPattern(g, a, b) {
  const key = a + '|' + b;
  let p = _patterns.get(key);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = 2; c.height = 2;
  const cg = c.getContext('2d');
  cg.fillStyle = a; cg.fillRect(0, 0, 1, 1); cg.fillRect(1, 1, 1, 1);
  cg.fillStyle = b; cg.fillRect(1, 0, 1, 1); cg.fillRect(0, 1, 1, 1);
  p = g.createPattern(c, 'repeat');
  _patterns.set(key, p);
  return p;
}

/**
 * An arbitrary hard-pixel tile, cached and repeated. Same mechanism as
 * checkerPattern — a tiny offscreen canvas turned into a CanvasPattern — so a
 * whole-screen desktop pattern costs one fillRect, not one per pixel. `draw`
 * receives the tile's own 2D context and paints it once, ever.
 */
export function tilePattern(g, key, w, h, draw) {
  let p = _patterns.get(key);
  if (p) return p;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cg = c.getContext('2d');
  cg.imageSmoothingEnabled = false;
  draw(cg);
  p = g.createPattern(c, 'repeat');
  _patterns.set(key, p);
  return p;
}

/** Fill a rect with a cached tile. Integer coordinates, no resampling. */
export function tile(g, x, y, w, h, key, tw, th, draw) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = tilePattern(g, key, tw, th, draw);
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

/** 50 % checkerboard fill. (x+y) even -> a, odd -> b, in absolute pixels. */
export function checker(g, x, y, w, h, a, b) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = checkerPattern(g, a, b);
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

/** The 1 px dotted focus rectangle, inset by the caller, dots on alternate px. */
export function focusRect(g, x, y, w, h, c = '#000000') {
  x |= 0; y |= 0; w |= 0; h |= 0;
  g.fillStyle = c;
  for (let i = 0; i < w; i++) {
    if ((x + i + y) % 2 === 0) g.fillRect(x + i, y, 1, 1);
    if ((x + i + y + h - 1) % 2 === 0) g.fillRect(x + i, y + h - 1, 1, 1);
  }
  for (let i = 1; i < h - 1; i++) {
    if ((x + y + i) % 2 === 0) g.fillRect(x, y + i, 1, 1);
    if ((x + w - 1 + y + i) % 2 === 0) g.fillRect(x + w - 1, y + i, 1, 1);
  }
}

/** The XOR drag outline a slow machine draws instead of moving the window. */
export function dragOutline(g, x, y, w, h, a = '#FFFFFF', b = '#000000') {
  const t = 2;
  g.fillStyle = checkerPattern(g, a, b);
  g.fillRect(x | 0, y | 0, w | 0, t);
  g.fillRect(x | 0, (y + h - t) | 0, w | 0, t);
  g.fillRect(x | 0, (y + t) | 0, t, (h - 2 * t) | 0);
  g.fillRect((x + w - t) | 0, (y + t) | 0, t, (h - 2 * t) | 0);
}

// --- hard-pixel arrows -----------------------------------------------------
// Scrollbar arrows are a solid black triangle 7 px wide by 4 px tall; submenu
// markers are the same triangle turned on its side, 4 x 7 (ANALYSIS.md 5).

export function triangle(g, cx, cy, dir, c = '#000000', size = 4) {
  // (cx, cy) is the APEX and the shape widens away from it: 4 rows of
  // 1/3/5/7 px for a scrollbar arrow, 4 columns of 1/3/5/7 px for a submenu
  // marker. Hard pixels, no anti-aliasing, both dimensions odd so the apex
  // lands on a whole pixel.
  g.fillStyle = c;
  for (let i = 0; i < size; i++) {
    const run = 2 * i + 1;
    switch (dir) {
      case 'up':    g.fillRect((cx - i) | 0, (cy + i) | 0, run, 1); break;
      case 'down':  g.fillRect((cx - i) | 0, (cy - i) | 0, run, 1); break;
      case 'left':  g.fillRect((cx + i) | 0, (cy - i) | 0, 1, run); break;
      default:      g.fillRect((cx - i) | 0, (cy - i) | 0, 1, run); break;
    }
  }
}

// ---------------------------------------------------------------------------
// Text

export const FONT = SANS;
export const FONT_BOLD = SANS_BOLD;

/**
 * Top of the glyph box for a run vertically centred in `h`.
 *
 * The font's box is 11 rows (9 above the baseline + 2 descender) inside a 13 px
 * cell, so centring the cell and adding its 2 rows of internal leading is the
 * same arithmetic as (h - 9) / 2. Checked against three reference captures:
 *   18 px title bar  -> +4  (win95-09: bar y4..21, "Control Panel" ink y8..16)
 *   20 px menu band  -> +5  (win95-09: band y22..41, "File" ink y27..35)
 *   32 px Start item -> +11 (win95-05: item y252..283, "Documents" ink y263..)
 */
export function textY(y, h) { return (y + ((h - 9) >> 1)) | 0; }

export function text(g, s, x, y, c = '#000000', font = SANS) {
  return font.draw(g, s, x, y, c);
}

export function textCentred(g, s, x, y, w, h, c = '#000000', font = SANS) {
  const tw = font.measure(s);
  return font.draw(g, s, x + ((w - tw) >> 1), textY(y, h), c);
}

export function label(g, s, x, y, c = '#000000', font = SANS, disabled = false) {
  return font.drawMnemonic(g, s, x, y, c, { disabled });
}

// ---------------------------------------------------------------------------
// Controls

/**
 * Push button. 21 px tall by default (measured), 23 with the default ring.
 * A pressed button offsets its label by exactly (+1, +1) — never scales it.
 */
export function button(g, r, opts = {}) {
  const {
    label: lbl = '', pressed = false, disabled = false, focused = false,
    isDefault = false, pal = WIN, font = SANS, icon = null, flat = false,
  } = opts;
  const { x, y, w, h } = r;
  // The default-button ring is drawn OUTSIDE the button, so the button itself
  // stays 21 px and the pair measures 23 (ANALYSIS.md 1: "Push button 21 px
  // tall, 23 px including the default-button ring"; win95-10 ring y415, button
  // y416..436, ring y437). Shrinking the button to fit the ring inside made it
  // 19 px, which is what round 1 shipped.
  if (isDefault) frameRect(g, x - 1, y - 1, w + 2, h + 2, pal.dark);
  fill(g, x, y, w, h, pal.face);
  if (flat && !pressed) {
    // toolbar button at rest: no bevel at all until hovered
  } else {
    bevel(g, x, y, w, h, pressed ? 'pressed' : (flat ? 'thin' : 'button'), pal);
  }
  const dx = pressed ? 1 : 0;
  const { text: plain } = splitMnemonic(lbl);
  let tx = x + ((w - font.measure(plain)) >> 1);
  if (icon) {
    const iw = icon.w + 3;
    tx = x + ((w - font.measure(plain) - iw) >> 1) + iw;
    icon.draw(g, x + ((w - font.measure(plain) - iw) >> 1) + dx, y + ((h - icon.h) >> 1) + dx);
  }
  // Measured: win95-10's 21 px OK button has its cap top 5 px below the button
  // top, not 6 — Windows centres the label on the button's lit interior, which
  // is one row shorter than the button. textY on (h - 1) reproduces it exactly.
  const ty = textY(y, h - 1) + dx;
  if (lbl) font.drawMnemonic(g, lbl, tx + dx, ty, pal.text, { disabled });
  if (focused) focusRect(g, x + 3, y + 3, w - 6, h - 6, pal.dark);
  return r;
}

/** Sunken white field — text boxes, list views, the client area of a document. */
export function field(g, x, y, w, h, pal = WIN, bg = null) {
  const inner = bevel(g, x, y, w, h, 'sunken', pal);
  fill(g, inner.x, inner.y, inner.w, inner.h, bg || pal.window);
  return inner;
}

export function groupBox(g, x, y, w, h, title, pal = WIN, font = SANS) {
  bevel(g, x, y, w, h, 'etched', pal);
  if (title) {
    const tw = font.measure(splitMnemonic(title).text);
    fill(g, x + 7, y - 1, tw + 4, 3, pal.face);   // break the rule for the caption
    fill(g, x + 7, y + 2, tw + 4, 7, pal.face);
    font.drawMnemonic(g, title, x + 9, y - 4, pal.text);
  }
  return { x: x + 3, y: y + 10, w: w - 6, h: h - 13 };
}

export function checkbox(g, x, y, checked, pal = WIN) {
  const inner = bevel(g, x, y, 13, 13, 'sunken', pal);
  fill(g, inner.x, inner.y, inner.w, inner.h, pal.window);
  if (checked) {
    // 7x7 hard-pixel tick, no anti-aliasing
    g.fillStyle = pal.text;
    const rows = ['....#', '...##', '#.###', '###..', '.##..', '..#..'];
    for (let ry = 0; ry < rows.length; ry++) {
      for (let rx = 0; rx < rows[ry].length; rx++) {
        if (rows[ry][rx] === '#') g.fillRect(x + 3 + rx, y + 3 + ry, 1, 1);
      }
    }
  }
  return 13;
}

export function radio(g, x, y, checked, pal = WIN) {
  // A 12x12 pixel circle, drawn from a hand-set bitmap so it stays hard-edged.
  const ring = ['....####....', '..##....##..', '.#........#.', '.#........#.',
    '#..........#', '#..........#', '#..........#', '#..........#',
    '.#........#.', '.#........#.', '..##....##..', '....####....'];
  for (let ry = 0; ry < 12; ry++) {
    for (let rx = 0; rx < 12; rx++) {
      if (ring[ry][rx] !== '#') continue;
      const top = ry < 6 || (ry === 6 && rx < 6);
      g.fillStyle = top ? pal.shadow : pal.hi;
      g.fillRect(x + rx, y + ry, 1, 1);
    }
  }
  fill(g, x + 3, y + 3, 6, 6, pal.window);
  fill(g, x + 4, y + 2, 4, 8, pal.window);
  fill(g, x + 2, y + 4, 8, 4, pal.window);
  if (checked) {
    fill(g, x + 4, y + 5, 4, 2, pal.text);
    fill(g, x + 5, y + 4, 2, 4, pal.text);
  }
  return 12;
}

/**
 * Progress bar: a sunken trough filled with discrete blocks.
 * "hard-cut progress bar advancing in discrete 8-px blocks" (checklist 19).
 */
export function progress(g, x, y, w, h, frac, pal = WIN, color = null) {
  const inner = bevel(g, x, y, w, h, 'sunken', pal);
  fill(g, inner.x, inner.y, inner.w, inner.h, pal.face);
  const blockW = 8, gap = 2;
  const n = Math.floor(inner.w / (blockW + gap));
  const on = Math.round(Math.max(0, Math.min(1, frac)) * n);
  for (let i = 0; i < on; i++) {
    fill(g, inner.x + 1 + i * (blockW + gap), inner.y + 1, blockW, inner.h - 2, color || pal.titleActive);
  }
  return inner;
}

// ---------------------------------------------------------------------------
// Scrollbars — exactly 16 px, square 16x16 arrow buttons, checkerboard track.

export const SCROLLBAR = 16;

export class Scroll {
  constructor() { this.value = 0; this.page = 1; this.max = 1; }
  get maxValue() { return Math.max(0, this.max - this.page); }
  clamp() { this.value = Math.max(0, Math.min(this.value, this.maxValue)); return this.value; }
  set(v) { this.value = v; return this.clamp(); }
  by(d) { return this.set(this.value + d); }
  get visible() { return this.max > this.page; }
}

/**
 * Scrollbar geometry, so hit testing and painting agree exactly.
 * Returns { up, down, track, thumb } rectangles.
 */
export function scrollbarGeom(r, scroll, vertical = true) {
  const { x, y, w, h } = r;
  const len = vertical ? h : w;
  const btn = SCROLLBAR;
  const trackLen = Math.max(0, len - btn * 2);
  const ratio = scroll.max > 0 ? Math.min(1, scroll.page / scroll.max) : 1;
  const thumbLen = Math.max(8, Math.round(trackLen * ratio));
  const range = Math.max(0, trackLen - thumbLen);
  const t = scroll.maxValue > 0 ? scroll.value / scroll.maxValue : 0;
  const off = Math.round(range * Math.max(0, Math.min(1, t)));
  if (vertical) {
    return {
      up: { x, y, w, h: btn },
      down: { x, y: y + h - btn, w, h: btn },
      track: { x, y: y + btn, w, h: trackLen },
      thumb: { x, y: y + btn + off, w, h: thumbLen },
    };
  }
  return {
    up: { x, y, w: btn, h },
    down: { x: x + w - btn, y, w: btn, h },
    track: { x: x + btn, y, w: trackLen, h },
    thumb: { x: x + btn + off, y, w: thumbLen, h },
  };
}

export function scrollbar(g, r, scroll, vertical = true, opts = {}) {
  const { pal = WIN, part = null, mac = false } = opts;
  const geo = scrollbarGeom(r, scroll, vertical);
  const enabled = scroll.visible;

  if (mac) {
    // Platinum: a 1 px black outline instead of a bevel (ANALYSIS.md 8).
    fill(g, r.x, r.y, r.w, r.h, pal.mid);
    frameRect(g, r.x, r.y, r.w, r.h, pal.dark);
  } else {
    fill(g, r.x, r.y, r.w, r.h, pal.face);
  }

  // track: 1 px checkerboard of ButtonHighlight over ButtonFace
  if (!mac) {
    const trackPressed = part === 'pageup' || part === 'pagedown';
    checker(g, geo.track.x, geo.track.y, geo.track.w, geo.track.h,
      trackPressed ? pal.shadow : pal.hi, pal.face);
  } else {
    checker(g, geo.track.x, geo.track.y, geo.track.w, geo.track.h, pal.mid, pal.face);
  }

  const arrow = (rect, dir, pressed) => {
    if (mac) {
      fill(g, rect.x, rect.y, rect.w, rect.h, pressed ? pal.shadow : pal.face);
      frameRect(g, rect.x, rect.y, rect.w, rect.h, pal.dark);
      bevel(g, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, pressed ? 'pressed' : 'thin', pal);
    } else {
      fill(g, rect.x, rect.y, rect.w, rect.h, pal.face);
      bevel(g, rect.x, rect.y, rect.w, rect.h, pressed ? 'pressed' : 'button', pal);
    }
    const cx = rect.x + (rect.w >> 1) + (pressed ? 1 : 0);
    const cy = rect.y + (rect.h >> 1) + (pressed ? 1 : 0);
    const c = enabled ? pal.dark : pal.shadow;
    if (dir === 'up') triangle(g, cx, cy - 2, 'up', c, 4);
    else if (dir === 'down') triangle(g, cx, cy + 2, 'down', c, 4);
    else if (dir === 'left') triangle(g, cx - 2, cy, 'left', c, 4);
    else triangle(g, cx + 2, cy, 'right', c, 4);
  };

  arrow(geo.up, vertical ? 'up' : 'left', part === 'up');
  arrow(geo.down, vertical ? 'down' : 'right', part === 'down');

  if (enabled) {
    if (mac) {
      fill(g, geo.thumb.x, geo.thumb.y, geo.thumb.w, geo.thumb.h, pal.face);
      frameRect(g, geo.thumb.x, geo.thumb.y, geo.thumb.w, geo.thumb.h, pal.dark);
      bevel(g, geo.thumb.x + 1, geo.thumb.y + 1, geo.thumb.w - 2, geo.thumb.h - 2, 'thin', pal);
      // the small textured grip
      const gx = geo.thumb.x + (geo.thumb.w >> 1);
      const gy = geo.thumb.y + (geo.thumb.h >> 1);
      for (let i = -2; i <= 2; i++) {
        if (vertical) { hline(g, gx - 3, gy + i * 2, 7, i % 2 === 0 ? pal.stripe : pal.hi); }
        else { vline(g, gx + i * 2, gy - 3, 7, i % 2 === 0 ? pal.stripe : pal.hi); }
      }
    } else {
      fill(g, geo.thumb.x, geo.thumb.y, geo.thumb.w, geo.thumb.h, pal.face);
      bevel(g, geo.thumb.x, geo.thumb.y, geo.thumb.w, geo.thumb.h, 'button', pal);
    }
  }
  return geo;
}

export function scrollbarHit(r, scroll, vertical, px, py) {
  const geo = scrollbarGeom(r, scroll, vertical);
  if (inside(geo.up, px, py)) return 'up';
  if (inside(geo.down, px, py)) return 'down';
  if (inside(geo.thumb, px, py)) return 'thumb';
  if (inside(geo.track, px, py)) {
    if (vertical) return py < geo.thumb.y ? 'pageup' : 'pagedown';
    return px < geo.thumb.x ? 'pageup' : 'pagedown';
  }
  return null;
}

export function inside(r, x, y) {
  return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

// ---------------------------------------------------------------------------
// Composite pieces used by more than one app

/** A list/table header row: raised buttons with a left-aligned label. */
export function headerRow(g, x, y, w, h, cols, pal = WIN, font = SANS) {
  let cx = x;
  for (const c of cols) {
    const cw = Math.min(c.w, x + w - cx);
    if (cw <= 0) break;
    fill(g, cx, y, cw, h, pal.face);
    bevel(g, cx, y, cw, h, 'button', pal);
    const t = font.ellipsis(c.label, cw - 8);
    if (c.align === 'right') font.draw(g, t, cx + cw - 4 - font.measure(t), textY(y, h), pal.text);
    else font.draw(g, t, cx + 4, textY(y, h), pal.text);
    cx += cw;
  }
  if (cx < x + w) { fill(g, cx, y, x + w - cx, h, pal.face); bevel(g, cx, y, x + w - cx, h, 'button', pal); }
}

/** Clip helper: run `fn` with a rectangular clip, always integer-aligned. */
export function clipped(g, r, fn) {
  g.save();
  g.beginPath();
  g.rect(r.x | 0, r.y | 0, r.w | 0, r.h | 0);
  g.clip();
  fn();
  g.restore();
}

/** Status bar with sunken panes, 23 px overall (measured in win95-09). */
export function statusBar(g, x, y, w, h, panes, pal = WIN, font = SANS) {
  fill(g, x, y, w, h, pal.face);
  let cx = x + 2;
  for (const p of panes) {
    const pw = p.w === -1 ? (x + w - 2 - cx) : p.w;
    bevel(g, cx, y + 2, pw, h - 4, 'sunken', pal);
    const t = font.ellipsis(p.text ?? '', pw - 8);
    font.draw(g, t, cx + 4, textY(y + 2, h - 4), pal.text);
    cx += pw + 2;
  }
}
