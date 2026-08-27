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

  _commit(a, b) {
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
