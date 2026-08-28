// measure.js — the Measurements box.
//
// The single most important interaction in the editor (reference/sketchup/ANALYSIS.md
// section 3): YOU NEVER CLICK INTO IT. While a tool is active the keyboard is a
// sink; the mouse establishes direction and intent, the keyboard establishes
// magnitude, and Enter commits. It also accepts a value AFTER the operation has
// finished — a sloppy drag followed by a typed number is a legitimate workflow.
//
// This module owns:
//   * MeasurementsBox — the keyboard sink and its state machine
//   * parseMeasure()  — every accepted number format, metric
//   * formatLength()/formatArea()/formatAngle() — how numbers are printed
//
// UNITS. The template is metric. A value with a unit suffix always wins:
//   4m 4.0m 4 → metres            4000 40cm 4000mm → the suffix, or the
//   bare-number rule below.
// BARE NUMBERS. An architect types either "4" or "4000" for the same wall and
// means the same wall. The rule is: a bare number >= 50 is millimetres, below
// that it is metres. The box always ECHOES the interpretation ("4000 = 4.000 m")
// so the rule is never a guess the player has to remember.

export const MM_THRESHOLD = 50;

const UNIT = {
  mm: 0.001, millimetre: 0.001, millimeter: 0.001,
  cm: 0.01, centimetre: 0.01, centimeter: 0.01,
  m: 1, metre: 1, meter: 1,
  km: 1000,
};

/** Length of one token, in metres, or null. */
export function parseLength(token) {
  if (token == null) return null;
  const t = String(token).trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const m = t.match(/^([+-]?\d*\.?\d+)(mm|cm|km|m)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2]) return n * UNIT[m[2]];
  return Math.abs(n) >= MM_THRESHOLD ? n * 0.001 : n;
}

/** True when the token carried an explicit unit (used for the echo line). */
export function hadUnit(token) {
  return /^[+-]?\d*\.?\d+(mm|cm|km|m)$/i.test(String(token ?? '').trim().replace(/\s+/g, ''));
}

/**
 * parseMeasure(text, mode) -> a typed value, or null when the text is not yet
 * a complete entry. `mode` is what the ACTIVE TOOL says it wants:
 *
 *   'length'  4m | 4000            -> { kind:'length', value }
 *   'pair'    900,2100 | 900, | ,2100 -> { kind:'pair', a, b }   (null = keep)
 *   'vector'  <0,500,0> relative, [3,4,5] global
 *                                  -> { kind:'vector', rel, x, y, z }
 *   'angle'   34.1 | 8:12 (slope)  -> { kind:'angle', deg }
 *   'factor'  1.5 | 150% | 10m     -> { kind:'factor', factor } | length
 *   'count'   12x external array, 5/ internal array
 *                                  -> { kind:'array', mode:'copies'|'divide', n }
 *
 * Array entries and vectors are recognised in EVERY mode, because that is what
 * SketchUp does: the syntax says what you meant, not the tool.
 */
export function parseMeasure(text, mode = 'length') {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/\s+/g, '');

  // arrays: 12x (copies at that spacing) / 5/ (copies dividing the gap)
  let m = t.match(/^(\d+)x$/);
  if (m) return { kind: 'array', mode: 'copies', n: parseInt(m[1], 10) };
  m = t.match(/^(\d+)\/$/);
  if (m) return { kind: 'array', mode: 'divide', n: parseInt(m[1], 10) };

  // segments / radius suffixes, kept for arcs and circles
  m = t.match(/^(\d+)s$/);
  if (m) return { kind: 'segments', n: parseInt(m[1], 10) };
  m = t.match(/^([\d.]+)r$/);
  if (m) return { kind: 'radius', value: parseLength(m[1]) };

  // vectors
  m = t.match(/^<(.*)>$/);
  if (m) return vector(m[1], true);
  m = t.match(/^\[(.*)\]$/);
  if (m) return vector(m[1], false);

  if (mode === 'angle') {
    m = t.match(/^([+-]?[\d.]+):([\d.]+)$/);           // 8:12 slope
    if (m) return { kind: 'angle', deg: Math.atan2(parseFloat(m[1]), parseFloat(m[2])) * 180 / Math.PI };
    const n = parseFloat(t);
    return Number.isFinite(n) ? { kind: 'angle', deg: n } : null;
  }

  if (mode === 'factor') {
    m = t.match(/^([\d.]+)%$/);
    if (m) return { kind: 'factor', factor: parseFloat(m[1]) / 100 };
    if (hadUnit(t)) { const L = parseLength(t); return L == null ? null : { kind: 'length', value: L }; }
    const n = parseFloat(t);
    if (t.match(/^[\d.]+$/) && Number.isFinite(n)) return { kind: 'factor', factor: n };
    const L = parseLength(t);
    return L == null ? null : { kind: 'length', value: L };
  }

  // pairs: "900,2100", "3," (first only), ",3" (second only)
  if (t.includes(',')) {
    const parts = t.split(',');
    if (parts.length === 2) {
      const a = parts[0] === '' ? null : parseLength(parts[0]);
      const b = parts[1] === '' ? null : parseLength(parts[1]);
      if (a === null && b === null) return null;
      return { kind: 'pair', a, b };
    }
    if (parts.length === 3) return vector(t, true);
    return null;
  }

  const L = parseLength(t);
  if (L == null) return null;
  return { kind: 'length', value: L };
}

function vector(body, rel) {
  const parts = body.split(',');
  if (parts.length !== 3) return null;
  const v = parts.map(p => (p === '' ? 0 : parseLength(p)));
  if (v.some(x => x == null || !Number.isFinite(x))) return null;
  // The UI vocabulary is SketchUp's: x = red, y = green (plan depth), z = blue (up).
  return { kind: 'vector', rel, x: v[0], y: v[1], z: v[2] };
}

// ---------------------------------------------------------------------------
// formatting

/** 4 -> "4000 mm" for values under 10 m, "12.40 m" above. Architects read both. */
export function formatLength(m, { mm = null } = {}) {
  if (!Number.isFinite(m)) return '—';
  const useMm = mm === null ? Math.abs(m) < 10 : mm;
  if (useMm) return `${Math.round(m * 1000)} mm`;
  return `${m.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} m`;
}

export function formatMetres(m, digits = 3) {
  if (!Number.isFinite(m)) return '—';
  return `${m.toFixed(digits)} m`;
}

export function formatArea(a) {
  if (!Number.isFinite(a)) return '—';
  return `${a.toFixed(2)} m²`;
}

export function formatAngle(deg) {
  if (!Number.isFinite(deg)) return '—';
  return `${deg.toFixed(1)}°`;
}

export function formatMoney(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-GB').replace(/,/g, ' ');
}

/** What the box echoes under a bare number, so the mm rule is never a secret. */
export function echoFor(text, mode) {
  const parsed = parseMeasure(text, mode);
  if (!parsed) return '';
  switch (parsed.kind) {
    case 'length': return hadUnit(text) ? '' : `= ${formatMetres(parsed.value)}`;
    case 'pair': {
      const a = parsed.a == null ? '—' : formatMetres(parsed.a);
      const b = parsed.b == null ? '—' : formatMetres(parsed.b);
      return `= ${a} × ${b}`;
    }
    case 'vector': return `${parsed.rel ? 'relative' : 'global'} ${formatMetres(parsed.x)}, ${formatMetres(parsed.y)}, ${formatMetres(parsed.z)}`;
    case 'angle': return `= ${formatAngle(parsed.deg)}`;
    case 'factor': return `= ${(parsed.factor * 100).toFixed(1)} %`;
    case 'array': return parsed.mode === 'copies' ? `= ${parsed.n} copies` : `= divided into ${parsed.n}`;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// the box itself

const ACCEPT = /^[0-9.,\-+<>[\]\/xXsSrRmMcCkK% ']$/;

/**
 * MeasurementsBox — a keyboard sink, not a form field.
 *
 * The editor feeds it every keydown that is not a tool shortcut. It never takes
 * DOM focus, so orbiting, panning and drawing all keep working while it listens.
 *
 *   onCommit(parsed, text)   Enter was pressed and the text parsed
 *   onChange(text, echo)     for the HUD
 */
export class MeasurementsBox {
  constructor({ onCommit = null, onChange = null } = {}) {
    this.text = '';
    this.label = 'Length';
    this.mode = 'length';
    this.display = '';        // what the tool wants shown while not typing
    this.typing = false;
    this.error = '';
    this.onCommit = onCommit;
    this.onChange = onChange;
  }

  /** The tool tells the box what it is measuring right now. */
  setContext(label, mode = 'length') {
    if (this.label === label && this.mode === mode) return;
    this.label = label;
    this.mode = mode;
    this._changed();
  }

  /** Live read-out from the tool (drag length, area, angle). Never overwrites typing. */
  setDisplay(v) {
    if (this.typing) return;
    if (this.display === v) return;
    this.display = v;
    this._changed();
  }

  /**
   * A REFUSAL, in the box the number was typed into.
   *
   * When a tool will not do what was asked — a 5000 mm door in a 4000 mm wall,
   * a wall 2 mm long — the reason belongs on the error line of the Measurements
   * box and nowhere else: that is where the player is looking, and hud.js
   * already renders it red. Cleared by the next keystroke, like a typo.
   */
  setError(msg) {
    if (this.error === (msg || '')) return;
    this.error = msg || '';
    this._changed();
  }

  clear() {
    if (!this.typing && !this.text && !this.error) return;
    this.text = '';
    this.typing = false;
    this.error = '';
    this._changed();
  }

  get value() { return this.typing ? this.text : this.display; }
  get echo() { return this.typing ? echoFor(this.text, this.mode) : ''; }

  /**
   * Feed a keyboard event. Returns true when the box consumed it.
   * Only characters that can start a measurement are consumed, so single-letter
   * tool shortcuts keep working until the moment you start typing a number.
   */
  key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key;

    if (k === 'Enter') {
      if (!this.typing || !this.text) return false;
      const parsed = parseMeasure(this.text, this.mode);
      if (!parsed) { this.error = 'not a measurement'; this._changed(); return true; }
      const text = this.text;
      this.text = '';
      this.typing = false;
      this.error = '';
      this._changed();
      this.onCommit?.(parsed, text);
      return true;
    }

    if (k === 'Escape') {
      if (!this.typing) return false;
      this.clear();
      return true;
    }

    if (k === 'Backspace') {
      if (!this.typing) return false;
      this.text = this.text.slice(0, -1);
      this.typing = this.text.length > 0;
      this.error = '';
      this._changed();
      return true;
    }

    if (k.length !== 1) return false;
    // Once typing has begun every character is ours; before it begins only
    // characters that can OPEN a measurement are, so "m" still means nothing and
    // "9" starts a number.
    const opens = /^[0-9.\-+<[,]$/.test(k);
    if (!this.typing && !opens) return false;
    if (this.typing && !ACCEPT.test(k)) return false;
    this.text += k;
    this.typing = true;
    this.error = '';
    this._changed();
    return true;
  }

  _changed() { this.onChange?.(this); }
}
