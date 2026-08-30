// tools/openings.js — Door and Window.
//
// One click on a wall cuts the opening. It arrives at a real catalogue size
// (0.90 x 2.05 m internal door, 1.20 x 1.40 m window with its sill at 0.85), it
// snaps to the offsets an architect actually uses — centred in the run, or a
// 100 mm jamb off the corner — and it shows the dimension it is about to commit
// to before you commit to it.
//
// CLICK COUNT: D, click on the wall = 2 decisions. With an exact width,
// D, click, "800" Enter = 3. The bar is 6.
//
// The opening is a GAP IN THE WALL EXTRUSION, never a boolean — geometry.js
// resolves it. This tool only ever emits opening.add / opening.resize.

import { Vector3 } from 'three';
import { Tool, fmt } from './base.js';
import { COLOR } from '../constants.js';
import { byCategory, tryEntry } from '../../model/catalog.js';

const MIN_PIER = 0.10;              // keep 100 mm of wall beside an opening
const SWINGS = ['in-left', 'in-right', 'out-left', 'out-right'];

class OpeningTool extends Tool {
  constructor(ed, kind, category, defaultId) {
    super(ed);
    this.kind = kind;
    this.family = byCategory(category).filter(e => e.opening && e.opening.kind === kind);
    if (!this.family.length) this.family = byCategory(category);
    this.index = Math.max(0, this.family.findIndex(e => e.id === defaultId));
    this.pending = null;             // { wallId, offset, width, height, sill, valid, why }
    this.last = null;                // the opening just cut — a typed value edits it
  }

  get entry() { return this.family[this.index] || null; }
  get spec() {
    const e = this.entry;
    const o = e?.opening || {};
    return {
      catalogId: e?.id ?? null,
      width: o.width ?? (this.kind === 'door' ? 0.90 : 1.20),
      height: o.height ?? (this.kind === 'door' ? 2.05 : 1.40),
      sill: this.kind === 'door' ? 0 : (o.sill ?? 0.85),
      glazingRatio: o.glazingRatio ?? (this.kind === 'window' ? 0.78 : 0),
      price: e?.price ?? 0,
      name: e?.name ?? this.kind,
    };
  }

  activate(_p, again) {
    if (again) { this.cycle(1); }
  }

  cycle(d) {
    if (!this.family.length) return;
    this.index = (this.index + d + this.family.length) % this.family.length;
    this.flash(`${this.entry.name} — ${Math.round(this.spec.width * 1000)} × ${Math.round(this.spec.height * 1000)} mm, ${this.entry.price}`);
  }

  cancel() {
    const had = !!(this.pending || this.last || this._widthOverride || this._heightOverride);
    this.pending = null;
    this.last = null;
    this._widthOverride = null;
    this._heightOverride = null;
    return had;
  }

  /**
   * THE COMMA BELONGS TO THE NUMBER, NOT TO THE SWING.
   *
   * The swing flip used to sit on ',' and '.', which are the pair separator and
   * the decimal point of the box this tool labels "Width, height". Typing the
   * 900,2100 the label asks for fired a swing toast, swallowed the comma and
   * committed 9 002 100 mm. The flip moved to '<' and '>' — Shift on the same
   * two keys, and the glyphs point the way the leaf goes — so every character
   * the Measurements box can use reaches it untouched. [ and ] are guarded as
   * well: they open a typed coordinate.
   */
  onKey(e) {
    if (this.typing) return false;
    if (e.code === 'BracketLeft') { this.cycle(-1); return true; }
    if (e.code === 'BracketRight') { this.cycle(1); return true; }
    if (this.kind === 'door' && (e.key === '<' || e.key === '>')) {
      this.swing = SWINGS[(SWINGS.indexOf(this.swing || 'in-left') + (e.key === '>' ? 1 : 3)) % 4];
      this.flash(`Swing: ${this.swing}`);
      return true;
    }
    return false;
  }

  inferenceContext() {
    return { height: this.elevation };
  }

  onMove(p) {
    const face = this.ed.pickWallFace(p.ndc);
    this.pending = face ? this._plan(face) : null;
    if (this.pending) {
      const s = this.pending;
      this.setDisplay(`${Math.round(s.width * 1000)} × ${Math.round(s.height * 1000)} mm  ·  ${fmt(s.fromEnd)} from ${s.endName}`);
    } else {
      this.setDisplay('');
    }
  }

  /** Where the opening would land, and whether it is legal there. */
  _plan(face) {
    const spec = this.spec;
    const width = this._widthOverride ?? spec.width;
    const height = this._heightOverride ?? spec.height;
    const half = width / 2;
    const len = face.length;
    let offset = face.offset;

    // candidate offsets an architect actually uses
    const cands = [
      { at: len / 2, name: 'centred' },
      { at: MIN_PIER + half, name: 'jamb from start' },
      { at: len - MIN_PIER - half, name: 'jamb from end' },
    ];
    // ... plus alignment with the centre of any other opening on a parallel wall
    for (const oid of face.wall.openings) {
      const o = this.model.openings[oid];
      if (o) cands.push({ at: o.offset, name: 'aligned' });
    }
    let snappedTo = null;
    for (const c of cands) {
      if (Math.abs(offset - c.at) < 0.30) { offset = c.at; snappedTo = c.name; break; }
    }
    if (!snappedTo) offset = Math.round(offset / 0.05) * 0.05;
    offset = Math.min(Math.max(offset, half + MIN_PIER), len - half - MIN_PIER);

    const sill = this.kind === 'door' ? 0
      : clamp(Math.round((face.height - height / 2) / 0.05) * 0.05, 0.05, Math.max(0.05, this.ed.storeyHeight - height - 0.15));

    let valid = true; let why = '';
    if (len < width + MIN_PIER * 2) { valid = false; why = `wall is only ${fmt(len)} long`; }
    for (const oid of face.wall.openings) {
      const o = this.model.openings[oid];
      if (!o) continue;
      if (Math.abs(o.offset - offset) < (o.width + width) / 2 + MIN_PIER) { valid = false; why = 'overlaps another opening'; }
    }
    if (sill + height > this.ed.storeyHeight - 0.05) { valid = false; why = 'head above the ceiling'; }

    const a = this.model.nodes[face.wall.a], b = this.model.nodes[face.wall.b];
    const fromStart = offset - half;
    const fromEnd = len - offset - half;
    return {
      wallId: face.wallId, wall: face.wall, len, offset,
      width, height, sill,
      catalogId: spec.catalogId, glazingRatio: spec.glazingRatio,
      valid, why, snappedTo,
      fromEnd: Math.min(fromStart, fromEnd),
      endName: fromStart <= fromEnd ? 'start' : 'end',
      a, b,
    };
  }

  onUp(p, info) {
    if (info?.dragged) return;
    if (!this.pending) return;
    if (!this.pending.valid) { this.flash(`Cannot cut here: ${this.pending.why}`); return; }
    const s = this.pending;
    const op = this.apply({
      t: 'opening.add',
      wallId: s.wallId,
      kind: this.kind,
      catalogId: s.catalogId,
      offset: r(s.offset),
      width: r(s.width),
      height: r(s.height),
      sill: r(s.sill),
      swing: this.kind === 'door' ? (this.swing || 'in-left') : null,
      glazingRatio: s.glazingRatio,
    });
    if (op) {
      this.last = { id: op.id };
      this.flash(`${this.spec.name} cut — ${Math.round(s.width * 1000)} × ${Math.round(s.height * 1000)} mm`);
    }
    void p;
  }

  /**
   * The Measurements box, before and after.
   *   nothing cut yet  -> the typed size becomes the size of the NEXT opening
   *   something cut    -> the typed size RESIZES the opening just cut
   * That is the SketchUp rule ("you can enter a precise distance until you
   * select something else"), and it is unambiguous: to change the size before
   * cutting, press Escape first or pick another leaf with [ and ].
   */
  onValue(v) {
    let width = null, height = null;
    if (v.kind === 'length') width = v.value;
    else if (v.kind === 'pair') { width = v.a; height = v.b; }
    else return false;

    if (this.last) return this._resize(width, height);
    if (width != null) {
      const max = this._maxWidthHere();
      if (max != null && width > max + 1e-9) {
        return this.refuse(`Too wide — that wall is only ${Math.round((max + MIN_PIER * 2) * 1000)} mm`);
      }
      this._widthOverride = width;
    }
    if (height != null) this._heightOverride = height;
    this.flash(`Next ${this.kind}: ${Math.round((this._widthOverride ?? this.spec.width) * 1000)}`
      + ` × ${Math.round((this._heightOverride ?? this.spec.height) * 1000)} mm`);
    return true;
  }

  /**
   * Resize the opening just cut — and REFUSE a size the wall cannot hold.
   *
   * A 5000 mm door typed into a 4000 mm wall used to be accepted in silence: the
   * mesh still built, so the model looked plausible while being nonsense, and the
   * analysis engine then went and measured it. The end-of-wall case was already
   * guarded on the clicked path; this is the same guard on the typed one, and it
   * says the number the player needs rather than just refusing.
   */
  _resize(width, height) {
    const o = this.model.openings[this.last.id];
    const w = o ? this.model.walls[o.wallId] : null;
    if (!o || !w) { this.last = null; return this.refuse('That opening is gone'); }
    const len = wallLength(this.model, w);
    const maxW = len - MIN_PIER * 2;
    const maxH = this.ed.storeyHeight - (o.sill || 0) - 0.05;

    if (width != null) {
      if (width < 0.2) return this.refuse('Too narrow — an opening starts at 200 mm');
      if (width > maxW + 1e-9) {
        return this.refuse(`Too wide — the wall is ${Math.round(len * 1000)} mm,`
          + ` the widest that fits is ${Math.round(maxW * 1000)} mm`);
      }
    }
    if (height != null && height > maxH + 1e-9) {
      return this.refuse(`Too tall — the head would be above the ceiling;`
        + ` ${Math.round(maxH * 1000)} mm is the most`);
    }

    // The width may no longer fit where the opening sits: slide it back inside
    // the wall rather than letting it hang over the end.
    const nextW = width ?? o.width;
    const offset = clamp(o.offset, nextW / 2 + MIN_PIER, len - nextW / 2 - MIN_PIER);
    const ops = [{
      t: 'opening.resize', id: this.last.id,
      width: width != null ? r(width) : undefined,
      height: height != null ? r(height) : undefined,
    }];
    if (Math.abs(offset - o.offset) > 1e-6) ops.push({ t: 'opening.move', id: this.last.id, offset: r(offset) });
    this.ed.applyMany(ops);
    this.flash(`Resized to ${width != null ? Math.round(width * 1000) : '—'}`
      + `${height != null ? ` × ${Math.round(height * 1000)}` : ''} mm`);
    return true;
  }

  /** The widest opening the wall under the cursor could take, or null. */
  _maxWidthHere() {
    const w = this.pending?.wall;
    if (!w) return null;
    return wallLength(this.model, w) - MIN_PIER * 2;
  }


  draw(g, p) {
    const s = this.pending;
    if (!s || !s.a || !s.b) return;
    const len = s.len || 1;
    const dx = (s.b.x - s.a.x) / len, dz = (s.b.z - s.a.z) / len;
    const cx = s.a.x + dx * s.offset, cz = s.a.z + dz * s.offset;
    const color = s.valid ? COLOR.ghost : 0xb2472e;
    const y0 = this.elevation + s.sill;
    const ang = Math.atan2(dx, dz);
    g.ghostBox(cx, y0 + s.height / 2, cz, s.width, s.height, s.wall.thickness + 0.02, ang, color);
    // the dimension from the near end of the wall to the near jamb
    const half = s.width / 2;
    const from = new Vector3(s.a.x, this.elevation + 0.02, s.a.z);
    const to = new Vector3(cx - dx * half, this.elevation + 0.02, cz - dz * half);
    g.dotted(from, to, COLOR.axisX);
    void p;
  }
}

export class DoorTool extends OpeningTool {
  static id = 'door';
  static toolName = 'Door';
  static valueLabel = 'Width, height';
  static valueMode = 'pair';
  static hint = 'Click a wall to cut a door. [ ] change the leaf, < > flip the swing. '
    + 'Type "900,2100" for an exact width and height. Default 900 × 2050 mm.';

  constructor(ed) {
    super(ed, 'door', 'doors', 'door-internal-900');
    this.swing = 'in-left';
  }

  get hintLine() {
    const e = this.entry;
    return `${e ? e.name : 'Door'} · swing ${this.swing} · ${this.constructor.hint}`;
  }
}

export class WindowTool extends OpeningTool {
  static id = 'window';
  static toolName = 'Window';
  static valueLabel = 'Width, height';
  static valueMode = 'pair';
  static hint = 'Click a wall to cut a window; the height you click sets the sill. '
    + '[ ] change the unit. Default 1200 × 1400 mm, sill 850 mm.';

  constructor(ed) {
    super(ed, 'window', 'windows', 'window-1200x1400');
  }

  get hintLine() {
    const e = this.entry;
    return `${e ? e.name : 'Window'} · ${this.constructor.hint}`;
  }
}

const r = (v) => (v == null ? v : Math.round(v * 1000) / 1000);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function wallLength(model, w) {
  const a = model.nodes[w.a], b = model.nodes[w.b];
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.z - a.z);
}
export { tryEntry };
