// tools/base.js — the tool contract.
//
// A tool never touches the model directly and never touches the DOM. It reads
// the pointer (already carrying a named snap), decides what the player means,
// and emits ops. Everything else — undo, network, rebuild — follows from that.
//
//   activate(params)          becoming the active tool
//   deactivate()
//   onDown(p, event)          left button down, no navigation modifier
//   onUp(p, { dragged })      left button up; `dragged` distinguishes a drag
//   onMove(p)                 every frame the cursor is over the canvas
//   onDoubleClick(p)          the repeat gesture
//   onValue(parsed, text)     the Measurements box committed; return false when
//                             the tool has nothing to do with a value
//   onKey(e)                  return true to swallow the key
//   cancel()                  Escape; return true if something was cancelled
//   draw(gizmos, p)           preview lines and ghosts
//   inferenceContext()        { from, refDir, height, wallHit, ignoreIds }
//
// TWO-CLICK OR DRAG. Every two-point tool accepts both gestures, because both
// are muscle memory: click, move, click — or press, drag, release.

import { Vector3 } from 'three';
import { AXIS } from '../constants.js';

export class Tool {
  static id = 'tool';

  constructor(ed) {
    this.ed = ed;
  }

  get id() { return this.constructor.id; }
  get name() { return this.constructor.toolName || this.constructor.id; }
  get hint() { return this.constructor.hint || ''; }
  get valueLabel() { return this.constructor.valueLabel || 'Length'; }
  get valueMode() { return this.constructor.valueMode || 'length'; }

  get model() { return this.ed.model; }
  get level() { return this.ed.level; }
  get elevation() { return this.ed.level?.elevation ?? 0; }

  apply(op, opts) { return this.ed.apply(op, opts); }
  flash(msg) { this.ed.hud?.flash(msg); }
  setDisplay(v) { this.ed.measurements.setDisplay(v); }

  /**
   * TRUE WHILE A NUMBER IS BEING TYPED — and then every printable key belongs
   * to the Measurements box, not to the tool.
   *
   * editor.js gives the tool first refusal on every key so a tool can own a
   * modifier, and a tool that owns a key UNCONDITIONALLY steals it out of the
   * middle of a number: the Door tool ate the comma of "900,2100" (its own
   * label asks for "Width, height") and committed a 9 002 100 mm door, the Wall
   * tool's [ and ] would eat the brackets of a typed coordinate, the Slab tool's
   * R would eat the r of "4r". Every tool key that is a character the box can
   * accept is guarded on this.
   */
  get typing() { return !!this.ed.measurements.typing; }

  /** Refuse, and say why on the error line of the Measurements box. */
  refuse(msg) {
    this.ed.measurements.setError(msg);
    this.flash(msg);
    return true;                    // the value WAS ours; we just would not do it
  }

  /**
   * The direction a locked axis means RIGHT NOW.
   *
   * An arrow key names the LINE, never the way along it — the cursor names that,
   * exactly as it does with no lock at all. Taking the axis vector raw made a
   * typed length build east while the preview, the guide and the Measurements
   * box all said west, which is the one thing the inference engine exists to
   * make impossible. A negative typed length flips it, as it does in SketchUp.
   */
  lockedDir(hint, sign = 1) {
    const a = this.ed.lockAxis;
    if (!a || a === 'ref' || !AXIS[a]) return null;
    const dir = AXIS[a].dir.clone();
    if (hint && hint.lengthSq() > 1e-12 && dir.dot(hint) < 0) dir.negate();
    return sign < 0 ? dir.negate() : dir;
  }

  activate() {}
  deactivate() { this.cancel(); }
  cancel() { return false; }
  onDown() {}
  onUp() {}
  onMove() {}
  onDoubleClick() {}
  onValue() { return false; }
  onKey() { return false; }
  draw() {}
  inferenceContext() { return { height: this.elevation }; }
}

/**
 * TwoPointTool — start a point, finish a point, both by click-click and by
 * press-drag-release. Subclasses implement finish(a, b) and preview(g, a, b).
 */
export class TwoPointTool extends Tool {
  constructor(ed) {
    super(ed);
    this.from = null;         // Vector3
    this.to = null;
    this.last = null;         // what a value typed AFTER the operation edits
  }

  cancel() {
    if (!this.from && !this.pressFrom) return false;
    this.from = null;
    this.pressFrom = null;
    this.to = null;
    this.ed.measurements.clear();
    return true;
  }

  onDown(p) {
    this.pressFrom = p.snap.point.clone();
  }

  onUp(p, { dragged } = {}) {
    const here = p.snap.point.clone();
    if (dragged) {
      // press - drag - release
      const a = this.from || this.pressFrom;
      if (a && here.distanceTo(a) > 1e-4) this._commit(a, here);
      return;
    }
    // click - move - click
    if (!this.from) { this.from = this.pressFrom || here; return; }
    if (here.distanceTo(this.from) > 1e-4) this._commit(this.from, here);
  }

  /**
   * Nothing shorter than this is built, whichever gesture asked for it.
   *
   * Clicking twice in the same place used to leave a 2 mm wall in the model —
   * invisible, costed, in the schedule, and measured by the analysis engine.
   * The typed path already refused a zero; the clicked path did not, and the
   * guard belongs where BOTH of them end up.
   */
  get minLength() { return 0; }

  _commit(a, b) {
    const len = a.distanceTo(b);
    if (len < this.minLength) {
      this.refuse(`Too short — ${this.name.toLowerCase()}s start at ${Math.round(this.minLength * 1000)} mm`);
      return;                       // the run stays live: the next click still lands
    }
    const next = this.finish(a.clone(), b.clone());
    this.from = next ? next.clone() : null;
    this.pressFrom = null;
    this.ed.measurements.clear();
  }

  onMove(p) {
    this.to = p.snap.point.clone();
    if (this.from) {
      const d = this.to.distanceTo(this.from);
      this.setDisplay(fmt(d));
    } else {
      this.setDisplay('');
    }
  }

  /** The direction the cursor is currently indicating, normalised. */
  direction() {
    if (!this.from || !this.to) return new Vector3(1, 0, 0);
    const d = new Vector3().subVectors(this.to, this.from);
    if (d.lengthSq() < 1e-9) return new Vector3(1, 0, 0);
    return d.normalize();
  }

  inferenceContext() {
    return {
      from: this.from,
      refDir: this.refDir || null,
      height: this.elevation,
      ignoreIds: null,
    };
  }

  /** @returns {Vector3|null} the point the next segment should chain from */
  finish() { return null; }
}

export function fmt(v) {
  if (!Number.isFinite(v)) return '';
  return Math.abs(v) < 10 ? `${Math.round(v * 1000)} mm` : `${v.toFixed(3)} m`;
}

export { Vector3 };
