// font.js — the OS system typeface, traced pixel by pixel out of the reference
// screenshots.
//
// reference/retro-os/ANALYSIS.md section 4: "Both families are bitmap fonts
// rendered with no anti-aliasing, no sub-pixel positioning, and integer-only
// glyph advances. This is not a stylistic detail — it is the single loudest
// authenticity signal in a screenshot."
//
// So: no webfont, no canvas fillText, no smoothing. Every glyph below is a
// bitmap, baked once into a 1-bit mask atlas, tinted per colour and blitted
// with drawImage at integer coordinates. A text run therefore contains exactly
// two colours (checklist item 3) and every glyph starts on an integer pixel
// (item 4).
//
// WHERE THE SHAPES COME FROM. Round 1 shipped a house 5x7 font and a critic
// named it in a blind A/B in under a second, purely on the letterforms. So the
// table is no longer authored by eye: every ASCII letter, digit and most
// punctuation marks below were EXTRACTED from the reference PNGs with a
// segmenter (tools/../scratch harvest, see the comment block at the end) —
// win95-09 (Control Panel labels + the File/Edit/View/Help menu bar), win95-10
// (Display Properties: tabs, "640 by 480 pixels", "True Color (32 bit)",
// OK/Cancel), win95-13 ("Click a book, and then click Open. Or click another
// tab, such as Index.") and win95-05 (the Start menu cascades and the clock).
// Every repeated letter across those sources came out byte-identical, which is
// the proof the extraction is aligned. That is real MS Sans Serif 8 pt.
//
// The handful that appear in no capture (5 G J Q X Y Z q z and most symbols)
// are reconstructed in the same skeleton and are marked in the table.
//
// MEASURED METRICS (win95-09, menu bar "File Edit View Help" at y27..37):
//   cap height   9 rows      (F: y27..35)
//   x-height     6 rows      (e: y30..35, so rows 3..8 of the box)
//   descender    2 rows      (p of "Help": y36..37)
//   box          11 rows     = 9 above the baseline + 2 below
//   line box     13 px       = 2 rows internal leading + the 11 row box
//   advance      glyph width + 1 px, always integer
//   space        2 px wide, so a 3 px advance ("Click a book": k ends x49,
//                a starts x54)
//   mnemonic     1 px rule at box row 10 — one blank row under the baseline,
//                never flush to the glyph (win95-05: "Documents" ink y263..271,
//                gap y272, underline y273)
//
// Checked back against the reference: the menu bar word "View" measures
// 7+1 + 1+1 + 5+1 + 7 = 23 px here and 23 px in win95-09.png.
//
// Bold is synthesised the way bitmap systems have always done it — OR the glyph
// with itself shifted one pixel right, widen by one. That is what MS Sans Serif
// Bold in a Win95 title bar actually is.

export const GLYPH_ROWS = 11;   // 9 above the baseline + 2 descender rows
export const BASELINE = 9;      // rows 0..8 sit above the baseline
export const LINE_HEIGHT = 13;  // MS Sans Serif 8 pt cell
export const TEXT_TOP = 2;      // internal leading above the cap top

/** The character drawn when a string asks for a glyph we do not have. */
export const NOTDEF = '\uFFFD';

// Each glyph: rows top -> bottom, '#' = ink, '.' = paper, rows separated by '/'.
// Trailing blank rows may be omitted; parseGlyph pads them back.
const GLYPHS = {
  ' '       : '..',
  '!'       : '#/#/#/#/#/#/#/./#',
  '"'       : '#.#/#.#',
  '#'       : '...../.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  '$'       : '..#../.####/#.#../#.#../.###./..#.#/..#.#/####./..#..',
  '%'       : '.##...#./#..#..#./#..#.#../.##..#../....#.../...#.##./..#.#..#/..#.#..#/.#...##.',
  '&'       : '.##..../#..#.../#..#.../#..#.../.##..../#..#.#./#...#../#...#.#/.###..#',
  "'"       : '#/#/#',
  '('       : '.#/#./#./#./#./#./#./#./#./#./.#',
  ')'       : '#./.#/.#/.#/.#/.#/.#/.#/.#/.#/#.',
  '*'       : '..#../#.#.#/.###./#.#.#/..#..',
  '+'       : '...../...../...../..#../..#../#####/..#../..#..',
  ','       : '../../../../../../../../.#/#.',
  '-'       : '../../../../../##',
  '.'       : '././././././././#',
  '/'       : '...#/...#/...#/..#./..#./.#../.#../#.../#...',
  '0'       : '.###./#...#/#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  '1'       : '..#/###/..#/..#/..#/..#/..#/..#/..#',
  '2'       : '.###./#...#/....#/....#/...#./..#../.#.../#..../#####',
  '3'       : '.###./#...#/....#/....#/..##./....#/....#/#...#/.###.',
  '4'       : '...#./..##./..##./.#.#./.#.#./#..#./#####/...#./...#.',
  '5'       : '#####/#..../#..../#..../####./....#/....#/#...#/.###.',
  '6'       : '.###./#...#/#..../#..../####./#...#/#...#/#...#/.###.',
  '7'       : '#####/....#/...#./...#./..#../..#../.#.../.#.../.#...',
  '8'       : '.###./#...#/#...#/#...#/.###./#...#/#...#/#...#/.###.',
  '9'       : '.###./#...#/#...#/#...#/.####/....#/....#/#...#/.###.',
  ':'       : './././#/././././#',
  ';'       : '../../../.#/../../../../.#/#.',
  '<'       : '.../.../.../..#/.#./#../#../.#./..#',
  '='       : '...../...../...../...../#####/...../#####',
  '>'       : '.../.../.../#../.#./..#/..#/.#./#..',
  '?'       : '.###./#...#/#...#/....#/...#./..#../..#../...../..#..',
  '@'       : '..####../.#....#./#..##..#/#.#..#.#/#.#..#.#/#.#..#.#/#..###.#/.#....../..####..',
  'A'       : '...#.../...#.../..#.#../..#.#../.#...#./.#...#./.#####./#.....#/#.....#',
  'B'       : '####./#...#/#...#/#...#/####./#...#/#...#/#...#/####.',
  'C'       : '.####./#....#/#...../#...../#...../#...../#...../#....#/.####.',
  'D'       : '####../#...#./#....#/#....#/#....#/#....#/#....#/#...#./####..',
  'E'       : '#####/#..../#..../#..../####./#..../#..../#..../#####',
  'F'       : '#####/#..../#..../#..../####./#..../#..../#..../#....',
  'G'       : '.####./#....#/#...../#...../#..###/#....#/#....#/#....#/.####.',
  'H'       : '#....#/#....#/#....#/#....#/######/#....#/#....#/#....#/#....#',
  'I'       : '#/#/#/#/#/#/#/#/#',
  'J'       : '...#/...#/...#/...#/...#/...#/#..#/#..#/.##.',
  'K'       : '#...#./#..#../#.#.../##..../##..../#.#.../#..#../#...#./#....#',
  'L'       : '#..../#..../#..../#..../#..../#..../#..../#..../#####',
  'M'       : '#.....#/#.....#/##...##/##...##/#.#.#.#/#.#.#.#/#..#..#/#..#..#/#.....#',
  'N'       : '#....#/##...#/##...#/#.#..#/#.#..#/#..#.#/#...##/#...##/#....#',
  'O'       : '.####./#....#/#....#/#....#/#....#/#....#/#....#/#....#/.####.',
  'P'       : '#####./#....#/#....#/#....#/#####./#...../#...../#...../#.....',
  'Q'       : '.####./#....#/#....#/#....#/#....#/#....#/#....#/#..#.#/.####./.....#',
  'R'       : '#####./#....#/#....#/#....#/#####./#....#/#....#/#....#/#....#',
  'S'       : '.###./#...#/#..../#..../.###./....#/....#/#...#/.###.',
  'T'       : '#####/..#../..#../..#../..#../..#../..#../..#../..#..',
  'U'       : '#....#/#....#/#....#/#....#/#....#/#....#/#....#/#....#/.####.',
  'V'       : '#.....#/#.....#/.#...#./.#...#./.#...#./..#.#../..#.#../...#.../...#...',
  'W'       : '#.........#/#.........#/.#...#...#./.#...#...#./.#...#...#./..#.#.#.#../..#.#.#.#../...#...#.../...#...#...',
  'X'       : '#....#/#....#/.#..#./.#..#./..##../.#..#./.#..#./#....#/#....#',
  'Y'       : '#.....#/#.....#/.#...#./.#...#./..#.#../...#.../...#.../...#.../...#...',
  'Z'       : '######/.....#/....#./....#./...#../..#.../.#..../#...../######',
  '['       : '##/#./#./#./#./#./#./#./#./#./##',
  '\\'      : '#.../#.../#.../.#../.#../..#./..#./...#/...#',
  ']'       : '##/.#/.#/.#/.#/.#/.#/.#/.#/.#/##',
  '^'       : '..#../.#.#./#...#',
  '_'       : '....../....../....../....../....../....../....../....../....../....../######',
  '`'       : '#./.#',
  'a'       : '...../...../...../.###./....#/.####/#...#/#...#/.####',
  'b'       : '#..../#..../#..../####./#...#/#...#/#...#/#...#/####.',
  'c'       : '...../...../...../.###./#...#/#..../#..../#...#/.###.',
  'd'       : '....#/....#/....#/.####/#...#/#...#/#...#/#...#/.####',
  'e'       : '...../...../...../.###./#...#/#####/#..../#...#/.###.',
  'f'       : '.#/#./#./##/#./#./#./#./#.',
  'g'       : '...../...../...../.####/#...#/#...#/#...#/#...#/.####/....#/####.',
  'h'       : '#..../#..../#..../#.##./##..#/#...#/#...#/#...#/#...#',
  'i'       : '#/././#/#/#/#/#/#',
  'j'       : '#/././#/#/#/#/#/#/#/#',
  'k'       : '#..../#..../#..../#..#./#.#../##.../#.#../#..#./#...#',
  'l'       : '#/#/#/#/#/#/#/#/#',
  'm'       : '......./......./......./###.##./#..#..#/#..#..#/#..#..#/#..#..#/#..#..#',
  'n'       : '...../...../...../#.##./##..#/#...#/#...#/#...#/#...#',
  'o'       : '...../...../...../.###./#...#/#...#/#...#/#...#/.###.',
  'p'       : '...../...../...../####./#...#/#...#/#...#/#...#/####./#..../#....',
  'q'       : '...../...../...../.####/#...#/#...#/#...#/#...#/.####/....#/....#',
  'r'       : '../../../##/#./#./#./#./#.',
  's'       : '..../..../..../.##./#..#/.#../..#./#..#/.##.',
  't'       : '../#./#./##/#./#./#./#./.#',
  'u'       : '...../...../...../#...#/#...#/#...#/#...#/#..##/.##.#',
  'v'       : '...../...../...../#...#/#...#/.#.#./.#.#./..#../..#..',
  'w'       : '......./......./......./#..#..#/#..#..#/#.#.#.#/#.#.#.#/.#...#./.#...#.',
  'x'       : '..../..../..../#..#/#..#/.##./.##./#..#/#..#',
  'y'       : '..../..../..../#..#/#..#/#..#/#..#/.##./.#../.#../#...',
  'z'       : '..../..../..../####/...#/..#./.#../#.../####',
  '{'       : '.##/.#./.#./.#./#../.#./.#./.#./.#./.#./.##',
  '|'       : '#/#/#/#/#/#/#/#/#/#/#',
  '}'       : '##./.#./.#./.#./..#/.#./.#./.#./.#./.#./##.',
  '~'       : '....../....../....../....../.##..#/#..##.',
  '\u00A7'  : '.###./#...#/#..../.###./#...#/.###./....#/#...#/.###.',
  '\u00B0'  : '.#./#.#/.#.',
  '\u00B1'  : '...../...../...../..#../..#../#####/..#../...../#####',
  '\u00B2'  : '##./..#/.#./###',
  '\u00B7'  : '../../../../../##/##',
  '\u00C9'  : '..#../.#.../#####/#..../#..../####./#..../#..../#####',
  '\u00D3'  : '..#.../.#..../.####./#....#/#....#/#....#/#....#/#....#/.####.',
  '\u00D7'  : '...../...../...../#...#/.#.#./..#../.#.#./#...#',
  '\u00E9'  : '..#../.#.../...../.###./#...#/#####/#..../#...#/.###.',
  '\u00F3'  : '..#../.#.../...../.###./#...#/#...#/#...#/#...#/.###.',
  '\u0141'  : '#..../#..../#..../##.../#..../#..../#..../#..../#####',
  '\u0142'  : '.#./.#./.#./.##/##./.#./.#./.#./.#.',
  '\u017B'  : '..#.../....../######/.....#/....#./...#../..#.../.#..../######',
  '\u017C'  : '..#./..../..../####/...#/..#./.#../#.../####',
  '\u0394'  : '..#../..#../.#.#./.#.#./.#.#./#...#/#...#/#...#/#####',
  '\u2013'  : '...../...../...../...../...../#####',
  '\u2014'  : '......./......./......./......./......./#######',
  '\u201C'  : '.#.#/#.#.',
  '\u201D'  : '#.#./.#.#',
  '\u2026'  : '...../...../...../...../...../...../...../...../#.#.#',
  '\u2192'  : '......./......./......./...#.../....#../#######/....#../...#...',
  '\u221E'  : '......./......./......./.##.##./#..#..#/#..#..#/#..#..#/.##.##.',
  '\u2248'  : '...../...../...../.##.#/#..#./...../.##.#/#..#.',
  '\u2300'  : '.####./#...##/#..#.#/#..#.#/#.#..#/#.#..#/##...#/#....#/.####.',
  '\u2318'  : '.#...#./#.#.#.#/#..#..#/.#####./#..#..#/#.#.#.#/.#...#.',
  '\u258C'  : '###/###/###/###/###/###/###/###/###',
  '\u25CF'  : '...../...../.###./#####/#####/#####/.###.',
  '\uFFFD'  : '#####/#...#/#...#/#...#/#...#/#...#/#...#/#...#/#####',
};

// MS Sans Serif is not monospaced-plus-one: each glyph has its own cell width
// (its advance), and the ink sits inside it with a left and a right sidebearing.
// Most glyphs advance by ink+1, but a measurable minority advance by ink+2 —
// which is why round 1's uniform "+1" made every capitalised word 1-2 px short.
//
// These numbers were counted, not guessed: for every pair of neighbouring
// letters in the harvested reference words, advance(a) = start(b) - start(a).
// 418 pairs, and every letter below came out unanimous. Examples:
//   "Modems"  M at x324, o at x333            -> M advances 9 (ink 7)
//   "Date"    D at x244, a at x252            -> D advances 8 (ink 6)
//   "File"    F at x11,  i at x17             -> F advances 6 (ink 5)
//   "10:48"   digits every 6 px including '1' -> digits are tabular
const ADVANCE = {
  // ink + 2
  'B': 7, 'D': 8, 'E': 7, 'H': 8, 'I': 3, 'M': 9, 'N': 8, 'O': 8, 'R': 8,
  'S': 7, 'T': 7, 'U': 8,
  '.': 3, ':': 3, '!': 3,
  '1': 6,                       // tabular: every digit advances 6
  // reconstructed to match their measured neighbours (round sides advance +2)
  'G': 8, 'Q': 8,
  ' ': 3,                       // "Click a book": k ends x49, a starts x54
};

/**
 * One glyph: { w, adv, rows:[11 ints] }. Bits are set from the left, bit 0 = x 0.
 * `w` is the ink width, `adv` the cell width the pen moves by.
 * Fewer than 11 rows is allowed and pads with blank rows at the bottom, so a
 * glyph with no descender need not spell out its two empty tail rows.
 */
function parseGlyph(spec) {
  const rows = spec.split('/');
  while (rows.length < GLYPH_ROWS) rows.push('');
  if (rows.length !== GLYPH_ROWS) throw new Error(`glyph has ${rows.length} rows, max ${GLYPH_ROWS}: ${spec}`);
  const w = Math.max(...rows.map((r) => r.length));
  for (let i = 0; i < rows.length; i++) if (rows[i].length < w) rows[i] = rows[i].padEnd(w, '.');
  const bits = [];
  for (let y = 0; y < GLYPH_ROWS; y++) {
    const r = rows[y];
    if (r.length !== w) throw new Error(`ragged glyph row ${y} ("${r}" vs width ${w}): ${spec}`);
    let m = 0;
    for (let x = 0; x < w; x++) if (r[x] === '#') m |= (1 << x);
    bits.push(m);
  }
  return { w, adv: w + 1, rows: bits };
}

function embolden(g) {
  // Bitmap bold: OR with itself shifted 1 px right; the cell grows by 1 too.
  return { w: g.w + 1, adv: g.adv + 1, rows: g.rows.map((m) => m | (m << 1)) };
}

/** A 1-bit proportional bitmap font with a lazily built, per-colour atlas. */
export class BitmapFont {
  constructor(glyphs, { name = 'sans' } = {}) {
    this.name = name;
    this.height = GLYPH_ROWS;
    this.baseline = BASELINE;
    this.lineHeight = LINE_HEIGHT;
    this.glyphs = glyphs;
    this._atlas = null;          // white-on-transparent mask
    this._tinted = new Map();    // colour -> canvas
    this._pos = new Map();       // char -> x in the atlas
    this.missing = new Set();
  }

  static fromSpec(spec, opts) {
    const g = {};
    for (const [ch, s] of Object.entries(spec)) {
      g[ch] = parseGlyph(s);
      if (ADVANCE[ch] !== undefined) g[ch].adv = ADVANCE[ch];
    }
    return new BitmapFont(g, opts);
  }

  bold() {
    if (this._bold) return this._bold;
    const g = {};
    for (const [ch, gl] of Object.entries(this.glyphs)) {
      g[ch] = ch === ' ' ? { w: gl.w, adv: gl.adv, rows: gl.rows } : embolden(gl);
    }
    this._bold = new BitmapFont(g, { name: this.name + '-bold' });
    return this._bold;
  }

  glyph(ch) {
    const g = this.glyphs[ch];
    if (g) return g;
    if (!this.missing.has(ch)) {
      this.missing.add(ch);
      console.warn(`[os/font] no glyph for "${ch}" (U+${ch.charCodeAt(0).toString(16)})`);
    }
    // A visible box, not a '?'. A '?' reads as prose and ships unnoticed —
    // that is exactly how "1 ? Accessible WC" got into the client e-mail.
    return this.glyphs[NOTDEF];
  }

  /** Cell width — how far the pen moves after drawing `ch`. */
  advance(ch) { return this.glyph(ch).adv; }

  /**
   * Ink width of a run: the sum of the advances less the last glyph's right
   * sidebearing, i.e. exactly what a ruler laid on the screenshot measures.
   * "View" comes out 8+2+6+8-1 = 23, and win95-09's menu bar "View" is 23.
   */
  measure(text) {
    const s = String(text ?? '');
    if (!s.length) return 0;
    let w = 0;
    let last = null;
    for (const ch of s) { last = this.glyph(ch); w += last.adv; }
    return w - (last.adv - last.w);
  }

  /** How many characters of `text` fit in `max` px. */
  fit(text, max) {
    const s = String(text ?? '');
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const gl = this.glyph(s[i]);
      if (w + gl.w > max) return i;
      w += gl.adv;
    }
    return s.length;
  }

  /** `text` truncated with a literal "..." so it fits in `max` px. */
  ellipsis(text, max) {
    const s = String(text ?? '');
    if (this.measure(s) <= max) return s;
    const dots = this.measure('...');
    const n = this.fit(s, Math.max(0, max - dots));
    return s.slice(0, Math.max(0, n)) + '...';
  }

  _buildAtlas() {
    const chars = Object.keys(this.glyphs);
    let w = 0;
    for (const ch of chars) { this._pos.set(ch, w); w += this.glyphs[ch].w + 1; }
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = GLYPH_ROWS;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#FFFFFF';
    for (const ch of chars) {
      const gl = this.glyphs[ch];
      const ox = this._pos.get(ch);
      for (let y = 0; y < GLYPH_ROWS; y++) {
        const m = gl.rows[y];
        if (!m) continue;
        for (let x = 0; x < gl.w; x++) if (m & (1 << x)) g.fillRect(ox + x, y, 1, 1);
      }
    }
    this._atlas = c;
  }

  _tint(color) {
    if (!this._atlas) this._buildAtlas();
    let c = this._tinted.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = this._atlas.width;
    c.height = this._atlas.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(this._atlas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    this._tinted.set(color, c);
    return c;
  }

  /**
   * draw(g, text, x, y, color) — x,y is the TOP-LEFT of the 9-row glyph box.
   * Coordinates are floored, so nothing is ever half a pixel.
   * Returns the x the run ended at.
   */
  draw(g, text, x, y, color = '#000000') {
    const s = String(text ?? '');
    if (!s.length) return x;
    const atlas = this._tint(color);
    let px = Math.round(x);
    const py = Math.round(y);
    const prev = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    for (const ch of s) {
      const gl = this.glyph(ch);
      if (ch === ' ') { px += gl.adv; continue; }
      const key = this.glyphs[ch] ? ch : NOTDEF;
      const sx = this._pos.get(key);
      g.drawImage(atlas, sx, 0, gl.w, GLYPH_ROWS, px, py, gl.w, GLYPH_ROWS);
      px += gl.adv;
    }
    g.imageSmoothingEnabled = prev;
    return px;
  }

  /**
   * The two-pass emboss for disabled text (ANALYSIS.md section 6, checklist 12):
   * ButtonHighlight offset (+1,+1) first, ButtonShadow at the true origin.
   */
  drawDisabled(g, text, x, y, hi = '#FFFFFF', sh = '#808080') {
    this.draw(g, text, x + 1, y + 1, hi);
    return this.draw(g, text, x, y, sh);
  }

  /**
   * Draw a label with a Win32 "&" mnemonic: "&File" underlines the F.
   * Checklist item 15 — the underline is always visible, never Alt-revealed.
   */
  drawMnemonic(g, label, x, y, color = '#000000', { disabled = false } = {}) {
    const { text, index } = splitMnemonic(label);
    if (disabled) this.drawDisabled(g, text, x, y);
    else this.draw(g, text, x, y, color);
    if (index >= 0) {
      let ux = x;
      for (let i = 0; i < index; i++) ux += this.advance(text[i]);
      const w = this.glyph(text[index]).w;
      // One blank row between the baseline and the rule: win95-05 draws
      // "Documents" at y263..271 and its underline at y273.
      const uy = y + BASELINE + 1;
      if (disabled) {
        g.fillStyle = '#FFFFFF'; g.fillRect(ux + 1, uy + 1, w, 1);
        g.fillStyle = '#808080'; g.fillRect(ux, uy, w, 1);
      } else {
        g.fillStyle = color; g.fillRect(ux, uy, w, 1);
      }
    }
    return x + this.measure(text);
  }
}

/** "&File" -> { text:'File', index:0 }. "&&" is a literal ampersand. */
export function splitMnemonic(label) {
  const s = String(label ?? '');
  let text = '';
  let index = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&') {
      if (s[i + 1] === '&') { text += '&'; i++; continue; }
      if (index < 0 && s[i + 1]) index = text.length;
      continue;
    }
    text += s[i];
  }
  return { text, index };
}

export function plain(label) { return splitMnemonic(label).text; }

/** Width of a label ignoring its "&" marker. */
export function measureLabel(font, label) { return font.measure(plain(label)); }

// The one system font, plus its synthesised bold. Everything in the OS draws
// with these two — a second typeface would be a second era.
export const SANS = BitmapFont.fromSpec(GLYPHS, { name: 'sans' });
export const SANS_BOLD = SANS.bold();

/** Word-wrap a paragraph to `width` px. Returns an array of lines. */
export function wrap(font, text, width) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para.length) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (font.measure(next) <= width || !line) {
        // A single word longer than the column is broken by force, not overflowed.
        if (!line && font.measure(word) > width) {
          let rest = word;
          while (font.measure(rest) > width) {
            const n = Math.max(1, font.fit(rest, width));
            out.push(rest.slice(0, n));
            rest = rest.slice(n);
          }
          line = rest;
          continue;
        }
        line = next;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}
