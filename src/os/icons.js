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
};

// --- 32x32 -----------------------------------------------------------------
// Built from hard-pixel primitives: 1 px black outline, flat body, a 1-pixel
// checkerboard highlight patch where a real icon would have a hand dither.

function outlineBox(g, x, y, w, h, body, hi, sh) {
  fill(g, x, y, w, h, VGA.black);
  fill(g, x + 1, y + 1, w - 2, h - 2, body);
  if (hi) { fill(g, x + 1, y + 1, w - 2, 1, hi); fill(g, x + 1, y + 1, 1, h - 2, hi); }
  if (sh) { fill(g, x + 1, y + h - 2, w - 2, 1, sh); fill(g, x + w - 2, y + 1, 1, h - 2, sh); }
}

const ICON32 = {
  /** The machine on the desk: CRT, beige bezel, teal glass, keyboard slab. */
  computer(g, x, y, screen = VGA.teal) {
    outlineBox(g, x + 1, y + 2, 30, 22, GREY.s, GREY.l, GREY.g);
    fill(g, x + 4, y + 5, 24, 15, VGA.black);
    fill(g, x + 5, y + 6, 22, 13, screen);
    checker(g, x + 6, y + 7, 8, 4, VGA.white, screen);      // hand-dithered glare
    fill(g, x + 8, y + 13, 16, 1, VGA.white);
    fill(g, x + 8, y + 15, 11, 1, VGA.white);
    fill(g, x + 25, y + 21, 2, 2, VGA.lime);                 // power lamp
    outlineBox(g, x + 6, y + 24, 20, 3, GREY.g, null, null);
    outlineBox(g, x + 2, y + 26, 28, 5, GREY.s, GREY.l, GREY.g);
    for (let i = 0; i < 6; i++) fill(g, x + 5 + i * 4, y + 28, 3, 1, GREY.g);
  },
  /** Sealed envelope, 32x32. */
  mail(g, x, y) {
    outlineBox(g, x + 2, y + 7, 28, 18, VGA.white, null, GREY.s);
    g.fillStyle = VGA.black;
    for (let i = 0; i < 13; i++) {                            // staircase flap
      g.fillRect(x + 3 + i, y + 8 + i, 1, 1);
      g.fillRect(x + 28 - i, y + 8 + i, 1, 1);
    }
    fill(g, x + 15, y + 21, 3, 1, VGA.black);
    fill(g, x + 3, y + 22, 26, 1, GREY.s);
  },
  /**
   * Manila folder, 32x32. The lighter yellow along the top edge is NOT a
   * fifth yellow — #FFFF80 is off the 16-colour palette (checklist 14) and
   * round 1 leaked 58 px of it into every tier. A real 4-bit icon fakes it
   * with a 1 px checkerboard of yellow over white, so that is what this does.
   */
  folder(g, x, y) {
    fill(g, x + 2, y + 6, 12, 4, VGA.black);
    fill(g, x + 3, y + 7, 10, 3, VGA.yellow);
    outlineBox(g, x + 2, y + 9, 28, 17, VGA.yellow, null, VGA.olive);
    checker(g, x + 3, y + 10, 26, 1, VGA.white, VGA.yellow);   // top bevel
    checker(g, x + 3, y + 10, 1, 15, VGA.white, VGA.yellow);   // left bevel
    fill(g, x + 3, y + 24, 26, 1, VGA.olive);
    checker(g, x + 5, y + 12, 10, 4, VGA.white, VGA.yellow);   // hand dither
  },
  /** The Design app: a drawing board with a plan pinned to it. */
  design(g, x, y) {
    outlineBox(g, x + 1, y + 3, 30, 24, GREY.s, GREY.l, GREY.g);
    fill(g, x + 4, y + 6, 24, 18, VGA.white);
    g.fillStyle = VGA.navy;                                   // a plan, in ink
    g.fillRect(x + 7, y + 9, 18, 1); g.fillRect(x + 7, y + 21, 18, 1);
    g.fillRect(x + 7, y + 9, 1, 13); g.fillRect(x + 24, y + 9, 1, 13);
    g.fillRect(x + 15, y + 9, 1, 8);
    g.fillStyle = VGA.red;
    g.fillRect(x + 15, y + 17, 1, 5); g.fillRect(x + 16, y + 21, 5, 1);
    fill(g, x + 2, y + 27, 28, 3, GREY.g);
    fill(g, x + 6, y + 30, 20, 1, VGA.black);
  },
  /** The cost sheet: a ruled ledger with a green total. */
  cost(g, x, y) {
    outlineBox(g, x + 4, y + 2, 24, 28, VGA.white, null, GREY.s);
    fill(g, x + 5, y + 3, 22, 4, VGA.navy);
    for (let i = 0; i < 6; i++) fill(g, x + 6, y + 10 + i * 3, 14, 1, GREY.g);
    for (let i = 0; i < 6; i++) fill(g, x + 22, y + 10 + i * 3, 4, 1, GREY.g);
    fill(g, x + 6, y + 27, 20, 1, VGA.green);
    fill(g, x + 6, y + 25, 20, 1, VGA.green);
  },
  /**
   * A sheet of paper with a folded corner, 32x32. The Start menu asks for this
   * one next to "Documents" and "Find"; round 1 had no 32x32 version and quietly
   * dropped a 16x16 into a 32 px row.
   */
  doc(g, x, y) {
    fill(g, x + 6, y + 2, 20, 28, VGA.black);
    fill(g, x + 7, y + 3, 18, 26, VGA.white);
    // the folded corner: a staircase, then the fold in shadow
    for (let i = 0; i < 7; i++) {
      fill(g, x + 19 + i, y + 3 + i, 7 - i, 1, i === 6 ? VGA.black : GREY.s);
      fill(g, x + 18 + i, y + 3 + i, 1, 1, VGA.black);
    }
    g.fillStyle = GREY.g;
    for (let i = 0; i < 6; i++) g.fillRect(x + 9, y + 13 + i * 3, 14, 1);
    g.fillRect(x + 9, y + 10, 8, 1);
  },
  /**
   * Control panel, 32x32: a box of sliders. Checklist 18 — Win95 means
   * "settings" with a control panel, never with a gear.
   */
  settings(g, x, y) {
    outlineBox(g, x + 2, y + 5, 28, 22, GREY.s, GREY.l, GREY.g);
    for (let i = 0; i < 3; i++) {
      const sy = y + 10 + i * 6;
      fill(g, x + 6, sy, 20, 1, VGA.black);
      fill(g, x + 6, sy + 1, 20, 1, VGA.white);
      const kx = x + 8 + i * 6;
      fill(g, kx, sy - 3, 4, 7, VGA.black);
      fill(g, kx + 1, sy - 2, 2, 5, GREY.s);
      fill(g, kx + 1, sy - 2, 1, 5, VGA.white);
    }
  },
  /**
   * A circled lower-case i — the Win95 information icon at 32 px. The disc is
   * a real rasterised circle (integer half-widths from x^2 + y^2 = r^2), so
   * every edge pixel is fully on or fully off.
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
    fill(g, x + 14, y + 7, 4, 4, VGA.white);      // the dot
    fill(g, x + 12, y + 13, 6, 2, VGA.white);     // the serif at the top of the stem
    fill(g, x + 14, y + 13, 4, 10, VGA.white);    // the stem
    fill(g, x + 11, y + 23, 10, 2, VGA.white);    // the foot
  },
  /** Waste basket with ribs and a rim. */
  bin(g, x, y) {
    fill(g, x + 7, y + 6, 18, 2, VGA.black);
    fill(g, x + 8, y + 8, 16, 1, GREY.s);
    for (let i = 0; i < 20; i++) {
      const w = 16 - Math.floor(i / 5);
      fill(g, x + 8 + Math.floor(i / 10), y + 9 + i, w, 1, i % 2 ? GREY.s : GREY.g);
    }
    fill(g, x + 7, y + 9, 1, 20, VGA.black);
    fill(g, x + 24, y + 9, 1, 20, VGA.black);
    fill(g, x + 9, y + 29, 14, 1, VGA.black);
  },
};

export function icon32(g, name, x, y, arg) {
  const fn = ICON32[name];
  if (!fn) return false;
  fn(g, x | 0, y | 0, arg);
  return true;
}

export const ICON32_NAMES = Object.keys(ICON32);
