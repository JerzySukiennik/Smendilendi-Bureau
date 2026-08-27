// font.js — hand-authored bitmap fonts for the in-game OS.
//
// reference/retro-os/ANALYSIS.md section 4: "Both families are bitmap fonts
// rendered with no anti-aliasing, no sub-pixel positioning, and integer-only
// glyph advances. This is not a stylistic detail — it is the single loudest
// authenticity signal in a screenshot."
//
// So: no webfont, no canvas fillText, no smoothing. Every glyph is authored here
// as a 9-row pixel bitmap, baked once into a 1-bit mask atlas, tinted per colour
// and blitted with drawImage at integer coordinates. A text run therefore
// contains exactly two colours (checklist item 3) and every glyph starts on an
// integer pixel (item 4).
//
// Metrics, chosen to match MS Sans Serif 8 pt at 96 DPI (11 px em, 13 px line):
//   rows 0..6  above the baseline  (cap height 7)
//   rows 7..8  below the baseline  (descender 2)
//   advance    = glyph width + 1
//   line box   = 13 px, so text sits at y + 2 inside a 13 px row.
//
// Bold is synthesised the way bitmap systems have always done it — OR the glyph
// with itself shifted one pixel right, widen by one. That is what MS Sans Serif
// Bold in a Win95 title bar actually is.

export const GLYPH_ROWS = 9;
export const BASELINE = 7;      // rows 0..6 sit above the baseline
export const LINE_HEIGHT = 13;
export const TEXT_TOP = 2;      // top padding inside a 13 px line box

// Each glyph: rows top -> bottom, '#' = ink, '.' = paper, rows separated by '/'.
// Every glyph declares all 9 rows so nothing can drift vertically.
const GLYPHS = {
  ' ': '.../.../.../.../.../.../.../.../...',
  '!': '#/#/#/#/#/./#/./.',
  '"': '#.#/#.#/.../.../.../.../.../.../...',
  '#': '...../.#.#./#####/.#.#./#####/.#.#./...../...../.....',
  '$': '..#../.####/#.#../.###./..#.#/####./..#../...../.....',
  '%': '##..#/##.#./...#./..#../.#.../#.##./..##./...../.....',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#/...../.....',
  "'": '#/#',
  '(': '.#/#./#./#./#./#./.#/../..',
  ')': '#./.#/.#/.#/.#/.#/#./../..',
  '*': '#.#/.#./#.#/.../.../.../.../.../...',
  '+': '...../...../..#../..#../#####/..#../..#../...../.....',
  ',': '../../../../../../.#/#./..',
  '-': '.../.../.../.../###/.../.../.../...',
  '.': '././././././#',
  '/': '...#/...#/..#./..#./.#../.#../#.../..../....',
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###./...../.....',
  '1': '..#../.##../..#../..#../..#../..#../.###./...../.....',
  '2': '.###./#...#/....#/...#./..#../.#.../#####/...../.....',
  '3': '.###./#...#/....#/..##./....#/#...#/.###./...../.....',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#./...../.....',
  '5': '#####/#..../####./....#/....#/#...#/.###./...../.....',
  '6': '..##./.#.../#..../####./#...#/#...#/.###./...../.....',
  '7': '#####/....#/...#./..#../..#../.#.../.#.../...../.....',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###./...../.....',
  '9': '.###./#...#/#...#/.####/....#/...#./.##../...../.....',
  ':': '././././#/././#',
  ';': '../../.#/../../.#/#./../..',
  '<': '../../.#/#./#./#./.#/../..',
  '=': '..../..../####/..../####/..../..../..../....',
  '>': '../../#./.#/.#/.#/#./../..',
  '?': '.##./#..#/...#/..#./..#./..../..#./..../....',
  '@': '.###./#...#/#.###/#.#.#/#.###/#..../.###./...../.....',
  'A': '..#../.#.#./#...#/#...#/#####/#...#/#...#/...../.....',
  'B': '####./#...#/#...#/####./#...#/#...#/####./...../.....',
  'C': '.###./#...#/#..../#..../#..../#...#/.###./...../.....',
  'D': '####./#...#/#...#/#...#/#...#/#...#/####./...../.....',
  'E': '#####/#..../#..../####./#..../#..../#####/...../.....',
  'F': '#####/#..../#..../####./#..../#..../#..../...../.....',
  'G': '.###./#...#/#..../#..##/#...#/#...#/.####/...../.....',
  'H': '#...#/#...#/#...#/#####/#...#/#...#/#...#/...../.....',
  'I': '#/#/#/#/#/#/#/./.',
  'J': '...#/...#/...#/...#/...#/#..#/.##./..../....',
  'K': '#...#/#..#./#.#../##.../#.#../#..#./#...#/...../.....',
  'L': '#..../#..../#..../#..../#..../#..../#####/...../.....',
  'M': '#.....#/##...##/#.#.#.#/#..#..#/#.....#/#.....#/#.....#/......./.......',
  'N': '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#/...../.....',
  'O': '.###./#...#/#...#/#...#/#...#/#...#/.###./...../.....',
  'P': '####./#...#/#...#/####./#..../#..../#..../...../.....',
  'Q': '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#/...../.....',
  'R': '####./#...#/#...#/####./#.#../#..#./#...#/...../.....',
  'S': '.####/#..../#..../.###./....#/....#/####./...../.....',
  'T': '#####/..#../..#../..#../..#../..#../..#../...../.....',
  'U': '#...#/#...#/#...#/#...#/#...#/#...#/.###./...../.....',
  'V': '#...#/#...#/#...#/#...#/#...#/.#.#./..#../...../.....',
  'W': '#.....#/#.....#/#.....#/#..#..#/#.#.#.#/##...##/#.....#/......./.......',
  'X': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#/...../.....',
  'Y': '#...#/#...#/.#.#./..#../..#../..#../..#../...../.....',
  'Z': '#####/....#/...#./..#../.#.../#..../#####/...../.....',
  '[': '##/#./#./#./#./#./##/../..',
  '\\': '#.../#.../.#../.#../..#./..#./...#/..../....',
  ']': '##/.#/.#/.#/.#/.#/##/../..',
  '^': '.#./#.#/.../.../.../.../.../.../...',
  '_': '...../...../...../...../...../...../...../#####/.....',
  '`': '#./.#/../../../../../../..',
  'a': '..../..../.##./...#/.###/#..#/.###/..../....',
  'b': '#.../#.../###./#..#/#..#/#..#/###./..../....',
  'c': '..../..../.###/#.../#.../#.../.###/..../....',
  'd': '...#/...#/.###/#..#/#..#/#..#/.###/..../....',
  'e': '..../..../.##./#..#/####/#.../.###/..../....',
  'f': '.##/#../###/#../#../#../#../.../...',
  'g': '..../..../.###/#..#/#..#/#..#/.###/...#/###.',
  'h': '#.../#.../###./#..#/#..#/#..#/#..#/..../....',
  'i': '#/./#/#/#/#/#/./.',
  'j': '..#/.../..#/..#/..#/..#/..#/..#/##.',
  'k': '#.../#.../#..#/#.#./##../#.#./#..#/..../....',
  'l': '#/#/#/#/#/#/#/./.',
  'm': '......./......./###.###/#..#..#/#..#..#/#..#..#/#..#..#/......./.......',
  'n': '..../..../###./#..#/#..#/#..#/#..#/..../....',
  'o': '..../..../.##./#..#/#..#/#..#/.##./..../....',
  'p': '..../..../###./#..#/#..#/#..#/###./#.../#...',
  'q': '..../..../.###/#..#/#..#/#..#/.###/...#/...#',
  'r': '.../.../#.#/##./#../#../#../.../...',
  's': '..../..../.###/#.../.##./...#/###./..../....',
  't': '.../.#./###/.#./.#./.#./.##/.../...',
  'u': '..../..../#..#/#..#/#..#/#..#/.###/..../....',
  'v': '...../...../#...#/#...#/#...#/.#.#./..#../...../.....',
  'w': '......./......./#.....#/#..#..#/#.#.#.#/#.#.#.#/.#...#./......./.......',
  'x': '...../...../#...#/.#.#./..#../.#.#./#...#/...../.....',
  'y': '..../..../#..#/#..#/#..#/#..#/.###/...#/###.',
  'z': '..../..../####/...#/..#./.#../####/..../....',
  '{': '..#/.#./.#./#../.#./.#./..#/.../...',
  '|': '#/#/#/#/#/#/#/#/#',
  '}': '#../.#./.#./..#/.#./.#./#../.../...',
  '~': '...../...../...../.##.#/#..##/...../...../...../.....',
  // Extras the game actually needs.
  '²': '##./..#/.#./###/.../.../.../.../...',            // superscript two, for m²
  '°': '.#./#.#/.#./.../.../.../.../.../...',            // degree
  '·': '../../../../##/##/../../..',                     // middle dot
  '—': '...../...../...../...../#####/...../...../...../.....', // em dash
  'ł': '.#./.#./###/##./.#./.#./.#./.../...',            // l with stroke — "Smendiłendi"
  '…': '........./........./........./........./........./........./#.#.#..../........./.........',
};

/**
 * One glyph: { w, rows:[9 ints] }. Bits are set from the left, bit 0 = x 0.
 * Fewer than 9 rows is allowed and pads with blank rows at the bottom, so a
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
  return { w, rows: bits };
}

function embolden(g) {
  return { w: g.w + 1, rows: g.rows.map((m) => m | (m << 1)) };
}

/** A 1-bit proportional bitmap font with a lazily built, per-colour atlas. */
export class BitmapFont {
  constructor(glyphs, { spacing = 1, name = 'sans', space = 3 } = {}) {
    this.name = name;
    this.spacing = spacing;
    this.height = GLYPH_ROWS;
    this.baseline = BASELINE;
    this.lineHeight = LINE_HEIGHT;
    this.glyphs = glyphs;
    this.spaceWidth = space;
    this._atlas = null;          // white-on-transparent mask
    this._tinted = new Map();    // colour -> canvas
    this._pos = new Map();       // char -> x in the atlas
    this.missing = new Set();
  }

  static fromSpec(spec, opts) {
    const g = {};
    for (const [ch, s] of Object.entries(spec)) g[ch] = parseGlyph(s);
    return new BitmapFont(g, opts);
  }

  bold() {
    if (this._bold) return this._bold;
    const g = {};
    for (const [ch, gl] of Object.entries(this.glyphs)) {
      g[ch] = ch === ' ' ? { w: gl.w, rows: gl.rows } : embolden(gl);
    }
    this._bold = new BitmapFont(g, { spacing: this.spacing, name: this.name + '-bold', space: this.spaceWidth });
    return this._bold;
  }

  glyph(ch) {
    const g = this.glyphs[ch];
    if (g) return g;
    if (!this.missing.has(ch)) {
      this.missing.add(ch);
      console.warn(`[os/font] no glyph for "${ch}" (U+${ch.charCodeAt(0).toString(16)})`);
    }
    return this.glyphs['?'];
  }

  advance(ch) {
    if (ch === ' ') return this.spaceWidth + this.spacing;
    return this.glyph(ch).w + this.spacing;
  }

  /** Pixel width of a run, without the trailing inter-glyph gap. */
  measure(text) {
    const s = String(text ?? '');
    if (!s.length) return 0;
    let w = 0;
    for (const ch of s) w += this.advance(ch);
    return w - this.spacing;
  }

  /** How many characters of `text` fit in `max` px. */
  fit(text, max) {
    const s = String(text ?? '');
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const a = this.advance(s[i]);
      if (w + a - this.spacing > max) return i;
      w += a;
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
      if (ch === ' ') { px += this.spaceWidth + this.spacing; continue; }
      const gl = this.glyph(ch);
      const key = this.glyphs[ch] ? ch : '?';
      const sx = this._pos.get(key);
      g.drawImage(atlas, sx, 0, gl.w, GLYPH_ROWS, px, py, gl.w, GLYPH_ROWS);
      px += gl.w + this.spacing;
    }
    g.imageSmoothingEnabled = prev;
    return px - this.spacing;
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
      const w = text[index] === ' ' ? this.spaceWidth : this.glyph(text[index]).w;
      const uy = y + BASELINE;      // 1 px rule directly under the glyph
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
export const SANS = BitmapFont.fromSpec(GLYPHS, { name: 'sans', spacing: 1, space: 3 });
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
