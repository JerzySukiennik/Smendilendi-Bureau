// icons.js — hand-set pixel icons.
//
// Checklist 17: "Icons are 16x16, 32x32 or 48x48, drawn pixel-by-pixel with a
// hard 1-bit mask and a limited palette, with a visible black or dark outline
// and a hand-dithered highlight."
// Checklist 18: "The icon metaphors are period-correct. Floppy disk, CRT monitor
// with a beige bezel, manila folder, a physical trash can, a printer with
// fanfold paper, a telephone handset for the modem." — no hamburger, no cloud,
// no gear, no bell.
//
// 16x16 icons are authored as pixel art below. 32x32 desktop icons are built
// from hard-pixel primitives (integer rects, staircase diagonals, checkerboard
// highlight patches) — the same discipline, less transcription.

import { checker, fill, VGA } from './widgets.js';

// Palette letters for the art. Only the 16 VGA colours plus the four extra
// static system colours are reachable, so the chrome histogram stays small.
const P = {
  '.': null,
  k: VGA.black, w: VGA.white, g: VGA.gray, s: VGA.silver, l: '#DFDFDF',
  y: VGA.yellow, o: VGA.olive, n: VGA.navy, b: VGA.blue, c: VGA.aqua,
  t: VGA.teal, r: VGA.red, m: VGA.maroon, G: VGA.green, L: VGA.lime,
  p: VGA.purple, f: VGA.fuchsia, C: VGA.cream, S: VGA.skyblue,
  M: VGA.moneygreen, A: VGA.medgray,
};

// The three "machine greys" every icon's body, bevel and shadow are drawn from.
// Windows silver on the Windows tiers; the Platinum ramp on the Mac-like ones,
// because #C0C0C0/#808080/#DFDFDF inside an icon on a Platinum desktop is
// Windows art leaking into another OS (and it showed in a histogram: 678 px of
// #C0C0C0 on the tier-3 desktop). makeTheme() switches this.
export const GREY = { s: VGA.silver, g: VGA.gray, l: '#DFDFDF' };

export function setIconGreys(family) {
  const plat = family === 'platinum';
  GREY.s = plat ? '#CCCCCC' : VGA.silver;
  GREY.g = plat ? '#999999' : VGA.gray;
  GREY.l = plat ? '#DDDDDD' : '#DFDFDF';
  P.s = GREY.s; P.g = GREY.g; P.l = GREY.l;
}

export class Icon {
  constructor(w, h, art) { this.w = w; this.h = h; this.art = art; }
  draw(g, x, y) {
    x |= 0; y |= 0;
    for (let row = 0; row < this.art.length; row++) {
      const line = this.art[row];
      let run = 0, runC = null;
      for (let col = 0; col <= line.length; col++) {
        const c = col < line.length ? P[line[col]] : undefined;
        if (c === runC && col < line.length) { run++; continue; }
        if (runC) { g.fillStyle = runC; g.fillRect(x + col - run, y + row, run, 1); }
        runC = c; run = 1;
      }
    }
  }
}

function art16(spec) {
  const rows = spec.split('/');
  for (const r of rows) if (r.length !== 16) throw new Error(`16x16 icon row is ${r.length}px: "${r}"`);
  while (rows.length < 16) rows.push('................');
  return new Icon(16, 16, rows);
}

// --- 16x16 -----------------------------------------------------------------

export const I16 = {
  // A sealed envelope. Unread mail, mail app, the mail taskbar button.
  mail: art16([
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkk..',
    '.kwwwwwwwwwwwk..',
    '.kkwwwwwwwwwkk..',
    '.kwkkwwwwwkkwk..',
    '.kwwkkwwwkkwwk..',
    '.kwwwkkwkkwwwk..',
    '.kwwwwkkkwwwwk..',
    '.kwwwwwwwwwwwk..',
    '.kwwwwwwwwwwwk..',
    '.kkkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ].join('/')),
  // An opened envelope with the letter half out — a message already read.
  mailOpen: art16([
    '................',
    '................',
    '......kkk.......',
    '....kkwwwkk.....',
    '..kkwwwwwwwkk...',
    '.kwwwwwwwwwwwk..',
    '.kwkkkkkkkkkwk..',
    '.kwwwwwwwwwwwk..',
    '.kwkkkkkkkkkwk..',
    '.kwwwwwwwwwwwk..',
    '.kwkkkkkkkwwwk..',
    '.kwwwwwwwwwwwk..',
    '.kkkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ].join('/')),
  // Two terminals on a wire — the period metaphor for talking to other machines.
  chat: art16([
    '................',
    '.kkkkkkk........',
    '.ktttttk........',
    '.ktwwwtk........',
    '.ktwwwtk........',
    '.kkkkkkk........',
    '..ggggg.........',
    '....k...........',
    '....kkkkk.......',
    '........kkkkkkk.',
    '........ktttttk.',
    '........ktwwwtk.',
    '........ktwwwtk.',
    '........kkkkkkk.',
    '.........ggggg..',
    '................',
  ].join('/')),
  // A ruled ledger sheet with a totals line. Not a bar chart, not a "chart" glyph.
  cost: art16([
    '................',
    '..kkkkkkkkkkkk..',
    '..kwwwwwwwwwwk..',
    '..knnnnnnnnnnk..',
    '..kwwwwwwwwwwk..',
    '..kwgggwgggwwk..',
    '..kwwwwwwwwwwk..',
    '..kwgggwgggwwk..',
    '..kwwwwwwwwwwk..',
    '..kwgggwgggwwk..',
    '..kwwwwwwwwwwk..',
    '..kwGGGGGGGGwk..',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ].join('/')),
  // Manila folder, closed.
  folder: art16([
    '................',
    '................',
    '..kkkk..........',
    '..kyykkkkkkkk...',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kyyyyyyyyyyk..',
    '..kooooooooook..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
  ].join('/')),
  folderOpen: art16([
    '................',
    '................',
    '..kkkk..........',
    '..kyykkkkkkkk...',
    '..kyyyyyyyyyyk..',
    '..kwwwwwwwwwwkk.',
    '.kkwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwk..',
    '.kwwwwwwwwwwwk..',
    '.kooooooooook...',
    '.kkkkkkkkkkkk...',
    '................',
    '................',
    '................',
    '................',
  ].join('/')),
  // A CRT with a plan on the glass — the Design app.
  design: art16([
    '................',
    '.kkkkkkkkkkkkk..',
    '.klsssssssssgk..',
    '.klsnnnnnnnsgk..',
    '.klsncccccnsgk..',
    '.klsncwwwcnsgk..',
    '.klsncwwwcnsgk..',
    '.klsncccccnsgk..',
    '.klsnnnnnnnsgk..',
    '.klsssssssssgk..',
    '.kkkkkkkkkkkkk..',
    '.....kkkkk......',
    '....kssssskk....',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ].join('/')),
  // Two sliders on a panel — Win95's control-panel metaphor, never a gear.
  settings: art16([
    '................',
    '..kkkkkkkkkkkk..',
    '..kssssssssssk..',
    '..kskkkkkkkksk..',
    '..kswggggggwsk..',
    '..kskkkkkkkksk..',
    '..ksskkssssssk..',
    '..kskwwksssssk..',
    '..kskkkkkkkksk..',
    '..kswwwwggggsk..',
    '..kskkkkkkkksk..',
    '..ksssskkkssskk.',
    '..ksssskwwkssk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ].join('/')),
  // 3.5-inch floppy. Save.
  floppy: art16([
    '................',
    '..kkkkkkkkkkkk..',
    '..knnnnwwwwnnk..',
    '..knnnnwkkwnnk..',
    '..knnnnwkkwnnk..',
    '..knnnnwkkwnnk..',
    '..knnnnnnnnnnk..',
    '..knnnnnnnnnnk..',
    '..knwwwwwwwwnk..',
    '..knwkkkkkkwnk..',
    '..knwwwwwwwwnk..',
    '..knwkkkkkkwnk..',
    '..knwwwwwwwwnk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ].join('/')),
  // Text document with a folded corner.
  doc: art16([
    '................',
    '..kkkkkkkk......',
    '..kwwwwwwkk.....',
    '..kwwwwwwwk.....',
    '..kwkkkkwwk.....',
    '..kwwwwwwwk.....',
    '..kwkkkkkwk.....',
    '..kwwwwwwwk.....',
    '..kwkkkkkwk.....',
    '..kwwwwwwwk.....',
    '..kwkkkwwwk.....',
    '..kwwwwwwwk.....',
    '..kkkkkkkkk.....',
    '................',
    '................',
    '................',
  ].join('/')),
  // The machine itself.
  computer: art16([
    '................',
    '.kkkkkkkkkkkkk..',
    '.klsssssssssgk..',
    '.klstttttttsgk..',
    '.klstwwtttsgk...',
    '.klstttttttsgk..',
    '.klstttttttsgk..',
    '.klstttttttsgk..',
    '.klsssssssssgk..',
    '.kkkkkkkkkkkkk..',
    '.....kkkkk......',
    '....kssssskk....',
    '...kkkkkkkkkk...',
    '...ksssssssgk...',
    '...kkkkkkkkkk...',
    '................',
  ].join('/')),
  // Waste basket, physical, with ribs.
  bin: art16([
    '................',
    '.....kkkkk......',
    '....kkkkkkk.....',
    '...kkkkkkkkk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '...ksgsgsgsk....',
    '....kkkkkkk.....',
    '................',
    '................',
    '................',
    '................',
  ].join('/')),
  // A drafting set-square — the bureau's own mark, used on the Start button.
  square: art16([
    '................',
    '................',
    '...........k....',
    '..........kwk...',
    '.........kwlk...',
    '........kwlsk...',
    '.......kwlssk...',
    '......kwlsssk...',
    '.....kwlssssk...',
    '....kwlsssssk...',
    '...kwlssssssk...',
    '..kwlsssssssk...',
    '..kwwwwwwwwwk...',
    '..kkkkkkkkkkk...',
    '................',
    '................',
  ].join('/')),
  // Printer with fanfold paper.
  printer: art16([
    '................',
    '....kkkkkkkk....',
    '....kwwwwwwk....',
    '....kwkkkkwk....',
    '....kwwwwwwk....',
    '..kkkkkkkkkkkk..',
    '..ksssssssssgk..',
    '..kskkkkkkksgk..',
    '..ksssssssssgk..',
    '..kssssssrsgkk..',
    '..kkkkkkkkkkk...',
    '....kwwwwwwk....',
    '....kwkkkkwk....',
    '....kwwwwwwk....',
    '....kkkkkkkk....',
    '................',
  ].join('/')),
  // Telephone handset — the modem / the client on the line.
  phone: art16([
    '................',
    '..kkk......kkk..',
    '.kwwwk....kwwwk.',
    '.kwggk....kwggk.',
    '.kwggk....kwggk.',
    '.kkggkkkkkkggkk.',
    '..kggggggggggk..',
    '..kkgggggggggk..',
    '...kkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ].join('/')),
  // A stopped clock — the deadline.
  clock: art16([
    '................',
    '.....kkkkk......',
    '...kkwwwwwkk....',
    '..kwwwwkwwwwk...',
    '..kwwwwkwwwwk...',
    '.kwwwwwkwwwwwk..',
    '.kwwwwwkwwwwwk..',
    '.kwwwwwkkkkwwk..',
    '.kwwwwwwwwwwwk..',
    '.kwwwwwwwwwwwk..',
    '..kwwwwwwwwwk...',
    '...kkwwwwwkk....',
    '.....kkkkk......',
    '................',
    '................',
    '................',
  ].join('/')),
  warning: art16([
    '................',
    '.......kk.......',
    '......kyyk......',
    '......kyyk......',
    '.....kyyyyk.....',
    '.....kykkyk.....',
    '....kyykkyyk....',
    '....kyykkyyk....',
    '...kyyykkyyyk...',
    '...kyyykkyyyk...',
    '..kyyyyyyyyyyk..',
    '..kyyyykkyyyyk..',
    '.kyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ].join('/')),
  info: art16([
    '................',
    '.....kkkkk......',
    '...kknnnnnkk....',
    '..knnnwwwnnnk...',
    '..knnnwwwnnnk...',
    '.knnnnnnnnnnnk..',
    '.knnnwwwwwnnnk..',
    '.knnnnnwwwnnnk..',
    '.knnnnnwwwnnnk..',
    '.knnnnnwwwnnnk..',
    '..knnnwwwwwnnk..',
    '...kknnnnnnkk...',
    '.....kkkkk......',
    '................',
    '................',
    '................',
  ].join('/')),
  // Find: a magnifier over a manila folder. Round 1 pointed the Start menu's
  // "Find" at the plain document glyph, so Documents and Find were the same
  // white page — the one thing that gave the menu away in a blind A/B.
  find: art16([
    '..........kkk...',
    '.........kwwwk..',
    '........kwcccwk.',
    '........kwcccwk.',
    '.kkkk...kwcccwk.',
    '.kyyk....kwwwk..',
    'kkkkkkkkk.kkkk..',
    'kyyyyyyyyykkkkk.',
    'kywwwwwwwwykkk..',
    'kyyyyyyyyyyyk...',
    'kywwwwwwwwyyk...',
    'kyyyyyyyyyyyk...',
    'kyyyyyyyyyyyk...',
    'koooooooooook...',
    '.kkkkkkkkkkk....',
    '................',
  ].join('/')),
};

// --- 32x32 -----------------------------------------------------------------
//
// Round 2 rewrite. Round 1's 32x32 icons were flat, front-on and three or four
// colours, and that is the one thing a blind A/B against win95-09 picked our OS
// out on in under a second. Two measurements set the bar:
//
//   * win95-01's "My Computer" (x=27..51, y=2..33) is a 3/4 view. The CRT has a
//     visible TOP face and a #808080 SIDE face; the lit edges are outlined in
//     #808080 and the shadow edges in #000000; the keyboard is a perspective
//     slab whose keys are individually drawn as a w/g/k weave that steps one
//     pixel left per row.
//   * win95-09's Display control panel icon (x=6..22, y=6..19, a 17x14 patch)
//     samples NINE distinct colours: #000080 #808080 #000000 #C0C0C0 #FFFF00
//     #FFFFFF #0000FF #FF0000 #800000.
//
// So every icon below is built the same way: a hard silhouette in black, three
// faces (lit top, body front, #808080 side), a 1 px checkerboard where two
// tones meet, and three or four accent hues out of the VGA sixteen. Nothing is
// anti-aliased: every primitive is an integer fillRect or a run of them.

/** A hard-edged filled disc: integer half-widths from x^2 + y^2 = r^2, so every
 *  edge pixel is fully on or fully off (checklist 1 and 3 — no anti-aliasing). */
function disc(g, cx, cy, r, color) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    if (half > 0) fill(g, cx - half, cy + dy, half * 2, 1, color);
  }
}

/** The same, squashed: a hard ellipse, for the rim and foot of the waste bin. */
function ellipse(g, cx, cy, rx, ry, color) {
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
    if (half > 0) fill(g, cx - half, cy + dy, half * 2, 1, color);
  }
}

function outlineBox(g, x, y, w, h, body, hi, sh) {
  fill(g, x, y, w, h, VGA.black);
  fill(g, x + 1, y + 1, w - 2, h - 2, body);
  if (hi) { fill(g, x + 1, y + 1, w - 2, 1, hi); fill(g, x + 1, y + 1, 1, h - 2, hi); }
  if (sh) { fill(g, x + 1, y + h - 2, w - 2, 1, sh); fill(g, x + w - 2, y + 1, 1, h - 2, sh); }
}

/**
 * One span per row of a box seen in 3/4: the front face is (x, y, w, h) and the
 * top and right faces are 45 degree staircase shears of depth `d` going up and
 * to the right. Used first to stamp the silhouette in black and then again, one
 * pixel in, to lay the three faces down — so the whole solid carries a 1 px
 * dark outline on its shadow edges without a single diagonal being drawn twice.
 */
function isoSpans(x, y, w, h, d) {
  const out = [];
  for (let r = y - d; r < y + h; r++) {
    if (r < y) out.push([r, x + (y - r), x + w - 1 + d]);
    else out.push([r, x, x + w - 1 + Math.min(d, y + h - 1 - r)]);
  }
  return out;
}

/**
 * A solid in 3/4 view. Returns the front face rect, which is what every icon
 * then draws its detail on.
 *
 *   silhouette  #000000, one pixel proud on every side
 *   top face    `top`   — the lit surface, catching the light from up-left
 *   right face  `side`  — normally #808080, the shadow cheek
 *   front face  `body`
 *
 * `dither` lays a 1 px checkerboard of #FFFFFF over the body along the top of
 * the front face, which is the hand-dithered highlight checklist item 17 asks
 * for and the thing our round-1 icons had nowhere.
 */
function isoBox(g, x, y, w, h, d, body, top, side, dither = true) {
  for (const [r, a, b] of isoSpans(x, y, w, h, d)) fill(g, a, r, b - a + 1, 1, VGA.black);
  const f = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
  for (let i = 1; i <= d; i++) fill(g, f.x + i, f.y - i, f.w, 1, top);
  for (let j = 1; j <= d; j++) fill(g, f.x + f.w - 1 + j, f.y - j, 1, f.h, side);
  fill(g, f.x, f.y, f.w, f.h, body);
  if (dither) {
    checker(g, f.x, f.y, f.w, 1, VGA.white, body);
    checker(g, f.x, f.y, 1, f.h, VGA.white, body);
    fill(g, f.x + f.w - 1, f.y + 1, 1, f.h - 1, side);
    checker(g, f.x + 1, f.y + f.h - 1, f.w - 2, 1, side, body);
  }
  return f;
}

/** A sheet of typed paper: white, a navy heading, and two-tone ruled lines. */
function sheet(g, x, y, w, h) {
  fill(g, x, y, w, h, VGA.black);
  fill(g, x + 1, y + 1, w - 2, h - 2, VGA.white);
  fill(g, x + 1, y + 1, w - 2, 1, GREY.l);
  fill(g, x + w - 2, y + 2, 1, h - 3, GREY.s);
  fill(g, x + 3, y + 3, Math.min(9, w - 7), 2, VGA.navy);
  const rules = Math.floor((h - 9) / 3);
  for (let i = 0; i < rules; i++) {
    fill(g, x + 3, y + 7 + i * 3, w - 7, 1, GREY.g);
    fill(g, x + 3, y + 8 + i * 3, w - 7, 1, GREY.l);
  }
}

const ICON32 = {
  /**
   * The machine on the desk. A 3/4 CRT with a lit top face, a #808080 cheek and
   * a dithered glare on the glass, over a perspective keyboard whose keys are
   * a w/#C0C0C0/#808080 weave stepping one pixel per row — the same
   * construction as win95-01's My Computer, drawn as our own machine.
   */
  computer(g, x, y, screen = VGA.teal) {
    const f = isoBox(g, x + 2, y + 6, 22, 15, 4, GREY.s, GREY.l, GREY.g);
    checker(g, f.x + 3, f.y - 3, f.w - 8, 2, VGA.white, GREY.l);   // dither on the lit top
    // the glass, sunk into the bezel
    fill(g, x + 5, y + 9, 15, 9, VGA.black);
    fill(g, x + 6, y + 10, 13, 7, screen);
    checker(g, x + 6, y + 10, 5, 3, VGA.white, screen);            // hand-dithered glare
    fill(g, x + 8, y + 13, 8, 1, VGA.white);
    fill(g, x + 8, y + 15, 5, 1, VGA.white);
    fill(g, x + 5, y + 17, 1, 1, GREY.l);
    fill(g, x + 17, y + 18, 2, 1, VGA.lime);                       // power lamp
    fill(g, x + 7, y + 18, 6, 1, GREY.g);                          // vent slot
    // neck and foot
    fill(g, x + 10, y + 20, 7, 2, VGA.black);
    fill(g, x + 11, y + 20, 5, 1, GREY.g);
    const foot = isoBox(g, x + 6, y + 22, 16, 3, 2, GREY.s, GREY.l, GREY.g, false);
    fill(g, foot.x, foot.y, foot.w, 1, GREY.l);
    // keyboard, in perspective, keys drawn one at a time
    const kb = isoBox(g, x + 1, y + 26, 24, 4, 4, GREY.s, GREY.l, GREY.g, false);
    for (let i = 1; i <= 4; i++) {
      const ky = kb.y - i;
      for (let c = 0; c < kb.w; c++) {
        const m = (c + i * 2) % 3;
        fill(g, kb.x + i + c, ky, 1, 1, m === 0 ? VGA.white : m === 1 ? GREY.s : GREY.g);
      }
    }
    fill(g, kb.x, kb.y, kb.w, 1, GREY.l);
    checker(g, kb.x + 1, kb.y + 1, kb.w - 2, 1, GREY.g, GREY.s);
  },

  /**
   * Mail: a typed letter standing behind an envelope drawn in 3/4, with a
   * staircase flap, a maroon wax seal and an airmail dash along the bottom.
   * Round 1's was a white rectangle, a black outline and a V — two colours.
   */
  mail(g, x, y) {
    sheet(g, x + 6, y + 1, 20, 15);
    const f = isoBox(g, x + 1, y + 16, 28, 12, 3, VGA.white, GREY.l, GREY.g);
    // the flap: two hard staircases meeting in the middle, creased with a
    // 1 px lighter line under the fold
    const n = Math.min(f.w >> 1, f.h - 2);
    for (let i = 0; i < n; i++) {
      fill(g, f.x + i, f.y + i, 1, 1, GREY.g);
      fill(g, f.x + f.w - 1 - i, f.y + i, 1, 1, GREY.g);
      fill(g, f.x + i, f.y + i + 1, 1, 1, GREY.l);
      fill(g, f.x + f.w - 1 - i, f.y + i + 1, 1, 1, GREY.l);
    }
    const cx = f.x + (f.w >> 1);
    disc(g, cx, f.y + n, 3, VGA.black);
    disc(g, cx, f.y + n, 2, VGA.red);
    fill(g, cx - 1, f.y + n - 1, 1, 1, VGA.maroon);
    fill(g, cx, f.y + n + 1, 2, 1, VGA.maroon);
    // airmail dashes along the bottom edge
    for (let i = 0; i < f.w - 2; i += 4) {
      fill(g, f.x + 1 + i, f.y + f.h - 2, 2, 1, VGA.maroon);
      fill(g, f.x + 3 + i, f.y + f.h - 2, 2, 1, VGA.navy);
    }
  },

  /**
   * Manila folder in 3/4, with two sheets standing in it. The lighter yellow
   * along the lit edge is NOT a fifth yellow — #FFFF80 is off the 16-colour
   * palette (checklist 14), so a real 4-bit icon fakes it with a 1 px
   * checkerboard of white over yellow, and so does this.
   */
  folder(g, x, y) {
    fill(g, x + 2, y + 4, 13, 5, VGA.black);
    fill(g, x + 3, y + 5, 11, 3, VGA.yellow);
    checker(g, x + 3, y + 5, 11, 1, VGA.white, VGA.yellow);
    const b = isoBox(g, x + 2, y + 9, 27, 12, 3, VGA.yellow, VGA.yellow, VGA.olive, false);
    checker(g, b.x, b.y, b.w, 1, VGA.white, VGA.yellow);
    checker(g, b.x + 1, b.y - 1, b.w, 1, VGA.white, VGA.yellow);
    // the papers inside, poking above the front leaf
    sheet(g, x + 5, y + 11, 17, 12);
    sheet(g, x + 9, y + 13, 16, 11);
    // the front leaf, laid over them
    fill(g, x + 1, y + 17, 29, 12, VGA.black);
    fill(g, x + 2, y + 18, 27, 10, VGA.yellow);
    checker(g, x + 2, y + 18, 27, 1, VGA.white, VGA.yellow);
    checker(g, x + 2, y + 18, 1, 10, VGA.white, VGA.yellow);
    checker(g, x + 4, y + 20, 13, 4, VGA.white, VGA.yellow);      // hand dither
    checker(g, x + 3, y + 26, 25, 1, VGA.olive, VGA.yellow);
    fill(g, x + 2, y + 27, 27, 1, VGA.olive);
  },

  /** The Design app: a drawing board in 3/4 with a plan pinned to it. */
  design(g, x, y) {
    const f = isoBox(g, x + 1, y + 5, 29, 20, 3, GREY.s, GREY.l, GREY.g);
    fill(g, f.x + 2, f.y + 2, f.w - 5, f.h - 4, VGA.black);
    fill(g, f.x + 3, f.y + 3, f.w - 7, f.h - 6, VGA.white);
    const px0 = f.x + 5, py0 = f.y + 5;
    g.fillStyle = VGA.navy;                                   // a plan, in ink
    g.fillRect(px0, py0, 15, 1); g.fillRect(px0, py0 + 10, 15, 1);
    g.fillRect(px0, py0, 1, 11); g.fillRect(px0 + 14, py0, 1, 11);
    g.fillRect(px0 + 8, py0, 1, 6);
    g.fillStyle = VGA.red;
    g.fillRect(px0 + 8, py0 + 7, 1, 4); g.fillRect(px0 + 9, py0 + 10, 4, 1);
    checker(g, px0 + 1, py0 + 1, 6, 3, GREY.l, VGA.white);    // hatched room
    // the board's lip, and a pencil lying on it
    const lip = isoBox(g, x + 2, y + 25, 26, 4, 2, GREY.g, GREY.s, GREY.g, false);
    fill(g, lip.x, lip.y, lip.w, 1, GREY.l);
    fill(g, lip.x + 3, lip.y, 12, 1, VGA.yellow);
    fill(g, lip.x + 15, lip.y, 2, 1, VGA.maroon);
  },

  /**
   * The cost sheet: a clipboard in 3/4 with a chrome clip, a priced sheet and a
   * green total ruled off at the foot.
   */
  cost(g, x, y) {
    const f = isoBox(g, x + 3, y + 6, 24, 24, 3, GREY.s, GREY.l, GREY.g);
    fill(g, f.x + 2, f.y + 3, f.w - 5, f.h - 6, VGA.black);
    fill(g, f.x + 3, f.y + 4, f.w - 7, f.h - 8, VGA.white);
    const sx = f.x + 4, sy = f.y + 5;
    fill(g, sx, sy, 13, 2, VGA.navy);
    for (let i = 0; i < 4; i++) {
      fill(g, sx, sy + 4 + i * 3, 8, 1, GREY.g);
      fill(g, sx + 10, sy + 4 + i * 3, 4, 1, GREY.g);
      fill(g, sx, sy + 5 + i * 3, 8, 1, GREY.l);
    }
    fill(g, sx, sy + 16, 14, 1, VGA.black);
    fill(g, sx + 6, sy + 18, 8, 1, VGA.green);
    fill(g, sx, sy + 18, 4, 1, GREY.g);
    // the clip: chrome, so it is dithered rather than flat
    fill(g, f.x + 6, f.y - 5, 12, 6, VGA.black);
    fill(g, f.x + 7, f.y - 4, 10, 4, GREY.s);
    checker(g, f.x + 7, f.y - 4, 10, 2, VGA.white, GREY.s);
    fill(g, f.x + 7, f.y - 1, 10, 1, GREY.g);
    fill(g, f.x + 10, f.y - 7, 6, 2, VGA.black);
    fill(g, f.x + 11, f.y - 6, 4, 1, GREY.l);
  },

  /**
   * A sheet of paper with a folded corner. The Start menu asks for this next to
   * "Documents"; round 1 had no 32x32 version and quietly dropped a 16x16 into
   * a 32 px row.
   */
  doc(g, x, y) {
    fill(g, x + 6, y + 2, 20, 28, VGA.black);
    fill(g, x + 7, y + 3, 18, 26, VGA.white);
    // the folded corner: a staircase, the fold in shadow, dithered where the
    // paper curls — a Win95 icon never has a flat triangle there
    for (let i = 0; i < 7; i++) {
      fill(g, x + 19 + i, y + 3 + i, 7 - i, 1, i === 6 ? VGA.black : GREY.s);
      fill(g, x + 18 + i, y + 3 + i, 1, 1, VGA.black);
    }
    checker(g, x + 21, y + 5, 4, 3, GREY.l, GREY.s);
    fill(g, x + 9, y + 9, 8, 2, VGA.navy);                  // heading
    g.fillStyle = GREY.g;
    for (let i = 0; i < 5; i++) g.fillRect(x + 9, y + 14 + i * 3, 14, 1);
    g.fillStyle = GREY.l;
    for (let i = 0; i < 5; i++) g.fillRect(x + 9, y + 15 + i * 3, 14, 1);
    fill(g, x + 7, y + 3, 1, 26, GREY.l);                   // sheet highlight
    fill(g, x + 24, y + 10, 1, 19, GREY.s);                 // sheet shadow
    fill(g, x + 8, y + 28, 17, 1, GREY.s);
  },

  /** Documents: two typed sheets standing in a manila folder, in 3/4. */
  docs(g, x, y) {
    fill(g, x + 1, y + 6, 12, 4, VGA.black);                // tab
    fill(g, x + 2, y + 7, 10, 3, VGA.yellow);
    const b = isoBox(g, x + 1, y + 10, 27, 11, 3, VGA.yellow, VGA.yellow, VGA.olive, false);
    checker(g, b.x, b.y, b.w, 1, VGA.white, VGA.yellow);
    sheet(g, x + 5, y + 8, 15, 15);
    sheet(g, x + 11, y + 11, 16, 14);
    fill(g, x + 1, y + 18, 28, 11, VGA.black);              // front leaf
    fill(g, x + 2, y + 19, 26, 9, VGA.yellow);
    checker(g, x + 2, y + 19, 26, 1, VGA.white, VGA.yellow);
    checker(g, x + 2, y + 19, 1, 9, VGA.white, VGA.yellow);
    checker(g, x + 4, y + 21, 12, 3, VGA.white, VGA.yellow);
    checker(g, x + 3, y + 26, 24, 1, VGA.olive, VGA.yellow);
    fill(g, x + 2, y + 27, 26, 1, VGA.olive);
  },

  /**
   * Find: a chrome magnifier lying across a manila folder. Eight colours with a
   * dithered chrome ring and a dithered glare on the glass, because the Win95
   * originals never sit on two flat fills.
   */
  find(g, x, y) {
    fill(g, x + 1, y + 2, 12, 4, VGA.black);                // folder tab
    fill(g, x + 2, y + 3, 10, 3, VGA.yellow);
    outlineBox(g, x + 1, y + 5, 26, 20, VGA.yellow, null, VGA.olive);
    checker(g, x + 2, y + 6, 24, 1, VGA.white, VGA.yellow);
    checker(g, x + 2, y + 6, 1, 18, VGA.white, VGA.yellow);
    checker(g, x + 4, y + 8, 10, 4, VGA.white, VGA.yellow);
    fill(g, x + 2, y + 23, 24, 1, VGA.olive);

    // the handle first, so the barrel's outline closes over its top end
    for (let i = 0; i < 7; i++) {
      fill(g, x + 24 + i, y + 20 + i, 5, 1, VGA.black);
      fill(g, x + 25 + i, y + 21 + i, 3, 1, GREY.s);
      fill(g, x + 25 + i, y + 20 + i, 2, 1, GREY.l);
    }
    const cx = x + 19, cy = y + 14;
    disc(g, cx, cy, 9, VGA.black);                          // 1 px hard outline
    disc(g, cx, cy, 8, GREY.l);                             // chrome ring, lit
    for (let dy = -8; dy <= 8; dy++) {                      // ring shaded lower-right
      const half = Math.round(Math.sqrt(64 - dy * dy));
      if (dy >= -3 && half > 2) fill(g, cx + half - 2, cy + dy, 2, 1, GREY.g);
    }
    for (let dy = -8; dy <= -5; dy++) {                     // dither where lit meets ground
      const half = Math.round(Math.sqrt(64 - dy * dy));
      if (half > 1) checker(g, cx - half + 1, cy + dy, half, 1, VGA.white, GREY.l);
    }
    disc(g, cx, cy, 6, VGA.black);
    disc(g, cx, cy, 5, VGA.aqua);                           // glass
    checker(g, cx - 4, cy - 4, 4, 3, VGA.white, VGA.aqua);  // hand-dithered glare
    fill(g, cx - 4, cy - 4, 3, 1, VGA.white);
  },

  /**
   * Control panel: a box of sliders in 3/4. Checklist 18 — Win95 means
   * "settings" with a control panel, never with a gear.
   */
  settings(g, x, y) {
    const f = isoBox(g, x + 2, y + 6, 27, 23, 3, GREY.s, GREY.l, GREY.g);
    checker(g, f.x + 2, f.y - 2, f.w - 6, 2, VGA.white, GREY.l);   // dithered case top
    fill(g, f.x + 2, f.y + 2, f.w - 5, 4, VGA.navy);               // the label plate
    fill(g, f.x + 3, f.y + 3, f.w - 7, 1, VGA.blue);
    fill(g, f.x + 4, f.y + 4, 10, 1, GREY.l);
    fill(g, f.x + 2, f.y + 7, f.w - 5, 1, GREY.g);                 // etched rule
    fill(g, f.x + 2, f.y + 8, f.w - 5, 1, VGA.white);
    for (let i = 0; i < 3; i++) {
      const sy = f.y + 12 + i * 5;
      fill(g, f.x + 3, sy, 15, 1, VGA.black);                      // sunken slot
      fill(g, f.x + 3, sy + 1, 15, 1, VGA.white);
      const kx = f.x + 5 + i * 5;                                  // bevelled knob
      fill(g, kx, sy - 3, 4, 7, VGA.black);
      fill(g, kx + 1, sy - 2, 2, 5, GREY.s);
      fill(g, kx + 1, sy - 2, 1, 5, VGA.white);
      fill(g, kx + 2, sy + 2, 1, 1, GREY.g);
    }
    fill(g, f.x + 20, f.y + 12, 4, 4, VGA.black);                  // two lamps
    fill(g, f.x + 21, f.y + 13, 2, 2, VGA.lime);
    fill(g, f.x + 20, f.y + 18, 4, 4, VGA.black);
    fill(g, f.x + 21, f.y + 19, 2, 2, VGA.red);
    checker(g, f.x + 1, f.y + f.h - 2, f.w - 2, 1, GREY.g, GREY.s);
  },

  /**
   * Help: a closed book with a question mark. Win95's Help row is a book —
   * the circled "i" is the Win98/2000 info glyph and stays where Windows
   * actually uses it, on message boxes (checklist 18).
   */
  help(g, x, y) {
    // the page block first, so the cover closes over its spine side
    const pages = isoBox(g, x + 5, y + 8, 23, 18, 3, VGA.white, GREY.l, GREY.s, false);
    for (let i = 0; i < pages.h; i += 2) {
      fill(g, pages.x + pages.w - 2, pages.y + i, 2, 1, GREY.g);
      for (let j = 1; j <= 3; j++) fill(g, pages.x + pages.w - 1 + j, pages.y - j + i, 1, 1, GREY.g);
    }
    // the cover, teal, laid over the left two thirds
    fill(g, x + 3, y + 6, 21, 22, VGA.black);
    fill(g, x + 4, y + 7, 19, 20, VGA.teal);
    checker(g, x + 4, y + 7, 19, 1, VGA.aqua, VGA.teal);          // lit top edge
    checker(g, x + 4, y + 7, 1, 20, VGA.aqua, VGA.teal);
    fill(g, x + 4, y + 26, 19, 1, VGA.navy);                       // shadow foot
    fill(g, x + 7, y + 7, 1, 20, VGA.navy);                        // the hinge
    fill(g, x + 8, y + 7, 1, 20, VGA.aqua);
    // a maroon ribbon marker falling out of the foot
    fill(g, x + 18, y + 26, 3, 5, VGA.maroon);
    fill(g, x + 18, y + 26, 1, 5, VGA.red);
    // the question mark, in yellow with a hard black shadow
    const q = [
      [12, 10, 6, 2], [11, 12, 2, 2], [17, 12, 2, 3], [15, 15, 3, 2],
      [14, 17, 2, 3], [14, 22, 2, 2],
    ];
    for (const [qx, qy, qw, qh] of q) fill(g, x + qx + 1, y + qy + 1, qw, qh, VGA.black);
    for (const [qx, qy, qw, qh] of q) fill(g, x + qx, y + qy, qw, qh, VGA.yellow);
  },

  /**
   * A circled lower-case i — the Win95 information icon at 32 px, kept for
   * message-box severity, which is the one place Windows uses it. The disc is a
   * real rasterised circle, so every edge pixel is fully on or fully off.
   */
  info(g, x, y) {
    const r = 15;
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.round(Math.sqrt(r * r - dy * dy));
      const ry = y + 16 + dy;
      fill(g, x + 16 - half, ry, half * 2, 1, VGA.black);
      const inner = Math.round(Math.sqrt((r - 1) * (r - 1) - Math.min(dy * dy, (r - 1) * (r - 1))));
      if (Math.abs(dy) < r) fill(g, x + 16 - inner, ry, inner * 2, 1, VGA.navy);
    }
    for (let dy = -13; dy <= -8; dy++) {                          // dithered top light
      const half = Math.round(Math.sqrt(196 - dy * dy));
      if (half > 2) checker(g, x + 16 - half + 1, y + 16 + dy, half, 1, VGA.blue, VGA.navy);
    }
    fill(g, x + 14, y + 7, 4, 4, VGA.white);      // the dot
    fill(g, x + 12, y + 13, 6, 2, VGA.white);     // the serif at the top of the stem
    fill(g, x + 14, y + 13, 4, 10, VGA.white);    // the stem
    fill(g, x + 11, y + 23, 10, 2, VGA.white);    // the foot
  },

  /**
   * Waste basket: a real tapering cylinder seen in 3/4, with a hard elliptical
   * rim, a dark interior, ribs, a dithered turn where the lit side rolls into
   * the shadow, and a sheet of paper crumpled into it.
   */
  bin(g, x, y) {
    const cx = x + 16;
    // a sheet sticking out of the top
    fill(g, x + 17, y + 1, 8, 7, VGA.black);
    fill(g, x + 18, y + 2, 6, 5, VGA.white);
    checker(g, x + 18, y + 2, 6, 2, GREY.l, VGA.white);
    fill(g, x + 20, y + 4, 3, 1, GREY.g);
    // rim
    ellipse(g, cx, y + 7, 12, 4, VGA.black);
    ellipse(g, cx, y + 7, 10, 3, GREY.g);
    ellipse(g, cx, y + 8, 8, 2, VGA.black);
    // body: 21 rows, tapering from 24 wide to 17, ribs every third column
    for (let i = 0; i < 21; i++) {
      const half = 12 - Math.floor(i / 6);
      const ry = y + 8 + i;
      fill(g, cx - half, ry, half * 2, 1, VGA.black);
      fill(g, cx - half + 1, ry, half * 2 - 2, 1, GREY.s);
      fill(g, cx + half - 5, ry, 4, 1, GREY.g);                 // the shadow cheek
      checker(g, cx + half - 8, ry, 3, 1, GREY.g, GREY.s);      // dithered turn
      fill(g, cx - half + 1, ry, 1, 1, VGA.white);              // lit edge
    }
    for (let c = -9; c <= 9; c += 3) {                          // ribs
      fill(g, cx + c, y + 9, 1, 19, c === 0 ? GREY.g : GREY.g);
    }
    for (let i = 0; i < 20; i += 4) fill(g, cx - 11, y + 10 + i, 22, 1, GREY.g);
    ellipse(g, cx, y + 28, 9, 3, VGA.black);
    ellipse(g, cx, y + 27, 8, 2, GREY.g);
    checker(g, cx - 6, y + 26, 6, 2, GREY.s, GREY.g);
  },
};

export function icon32(g, name, x, y, arg) {
  const fn = ICON32[name];
  if (!fn) return false;
  fn(g, x | 0, y | 0, arg);
  return true;
}

export const ICON32_NAMES = Object.keys(ICON32);
