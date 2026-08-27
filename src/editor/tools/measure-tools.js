// tools/measure-tools.js — Tape Measure and Protractor.
//
// CLICK COUNT: T, click A, click B = 3 decisions. Same as SketchUp.
//
// The one deliberate departure from SketchUp: typing a length after a
// measurement does NOT rescale the model. Rescaling a designed building because
// somebody typed a number into a tape measure is a catastrophe, not a feature.
// Here the typed length lays a setting-out line of exactly that length along the
// direction you just measured — the thing an architect actually wanted.

import { Vector3 } from 'three';
import { TwoPointTool, Tool, fmt } from './base.js';
import { COLOR } from '../constants.js';
import { formatAngle } from '../measure.js';

export class TapeTool extends TwoPointTool {
  static id = 'tape';
  static toolName = 'Tape Measure';
  static valueLabel = 'Distance';
  static valueMode = 'length';
  static hint = 'Click two points to measure. Ctrl leaves a setting-out line. '
    + 'Typing a length lays a line of exactly that length along what you measured.';

  constructor(ed) {
    super(ed);
    this.measured = null;      // { a, b, length }
    this.makeGuide = false;
  }

  onMove(p) {
    super.onMove(p);
    this.makeGuide = !!this.ed.ctx?.input?.ctrl;
    if (this.from && this.to) {
      const d = new Vector3().subVectors(this.to, this.from);
      this.setDisplay(`${fmt(d.length())}   Δx ${fmt(d.x)}  Δy ${fmt(d.z)}  Δz ${fmt(d.y)}`);
    }
  }

  finish(a, b) {
    this.measured = { a: a.clone(), b: b.clone(), length: a.distanceTo(b) };
    this.refDir = new Vector3().subVectors(b, a).normalize();
    if (this.makeGuide) this.ed.guides.push({ a: a.clone(), b: b.clone() });
    this.flash(`${fmt(this.measured.length)}${this.makeGuide ? ' · line left' : ''}`);
    this.ed.measurements.setDisplay(fmt(this.measured.length));
    return null;
  }

  onValue(v) {
    if (v.kind !== 'length' || !(v.value > 0)) return false;
    if (this.from) {
      // still measuring: lay the line at exactly this length
      const dir = this.direction();
      this.ed.guides.push({ a: this.from.clone(), b: this.from.clone().addScaledVector(dir, v.value) });
      this.from = null;
      this.flash(`Setting-out line ${fmt(v.value)}`);
      return true;
    }
    if (!this.measured) return false;
    const dir = new Vector3().subVectors(this.measured.b, this.measured.a).normalize();
    this.ed.guides.push({ a: this.measured.a.clone(), b: this.measured.a.clone().addScaledVector(dir, v.value) });
    this.flash(`Setting-out line ${fmt(v.value)} along the measured direction`);
    return true;
  }

  draw(g, p) {
    if (this.from && p.snap) {
      g.line(this.from, p.snap.point, COLOR.axisX);
      this._witness(g, this.from, p.snap.point);
    } else if (this.measured) {
      g.dotted(this.measured.a, this.measured.b, COLOR.guide);
    }
  }

  _witness(g, a, b) {
    // little end ticks, so a measurement reads as a dimension and not as a wall
    const dir = new Vector3().subVectors(b, a);
    if (dir.lengthSq() < 1e-8) return;
    dir.normalize();
    const n = new Vector3(-dir.z, 0, dir.x).multiplyScalar(this.ed.cameras.metresPerPixel(a) * 8);
    g.line(a.clone().add(n), a.clone().sub(n), COLOR.axisX);
    g.line(b.clone().add(n), b.clone().sub(n), COLOR.axisX);
  }
}

// ---------------------------------------------------------------------------

export class ProtractorTool extends Tool {
  static id = 'protractor';
  static toolName = 'Protractor';
  static valueLabel = 'Angle';
  static valueMode = 'angle';
  static hint = 'Click the vertex, then one point on each leg. '
    + 'Ctrl leaves an angled setting-out line; type an angle to place one exactly.';

  constructor(ed) {
    super(ed);
    this.pts = [];
    this.angle = 0;
  }

  cancel() {
    if (!this.pts.length) return false;
    this.pts = [];
    return true;
  }

  onUp(p, info) {
    if (info?.dragged) return;
    this.pts.push(p.snap.point.clone());
    if (this.pts.length === 3) {
      const deg = this._angle(this.pts[0], this.pts[1], this.pts[2]);
      this.flash(`${formatAngle(deg)}`);
      if (this.ed.ctx?.input?.ctrl) {
        this.ed.guides.push({ a: this.pts[0].clone(), b: this.pts[2].clone() });
      }
      this.pts = [];
    }
  }

  onMove(p) {
    if (this.pts.length === 2) {
      this.angle = this._angle(this.pts[0], this.pts[1], p.snap.point);
      this.setDisplay(formatAngle(this.angle));
    } else if (this.pts.length === 1) {
      this.setDisplay('pick the first leg');
    } else {
      this.setDisplay('pick the vertex');
    }
  }

  _angle(v, a, b) {
    const u = new Vector3().subVectors(a, v);
    const w = new Vector3().subVectors(b, v);
    if (u.lengthSq() < 1e-9 || w.lengthSq() < 1e-9) return 0;
    let deg = (Math.atan2(w.z, w.x) - Math.atan2(u.z, u.x)) * 180 / Math.PI;
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    return deg;
  }

  onValue(v) {
    if (v.kind !== 'angle' || this.pts.length !== 2) return false;
    const u = new Vector3().subVectors(this.pts[1], this.pts[0]);
    const len = u.length() || 1;
    const base = Math.atan2(u.z, u.x);
    const a = base + v.deg * Math.PI / 180;
    this.ed.guides.push({
      a: this.pts[0].clone(),
      b: new Vector3(this.pts[0].x + Math.cos(a) * len, this.pts[0].y, this.pts[0].z + Math.sin(a) * len),
    });
    this.flash(`Line at ${formatAngle(v.deg)}`);
    this.pts = [];
    return true;
  }

  inferenceContext() {
    return { from: this.pts[0] || null, height: this.elevation };
  }

  draw(g, p) {
    if (!this.pts.length) return;
    const v = this.pts[0];
    if (this.pts[1]) g.line(v, this.pts[1], COLOR.guide);
    if (p.snap) g.line(v, p.snap.point, COLOR.magenta);
    const r = Math.max(0.4, this.ed.cameras.metresPerPixel(v) * 60);
    for (let i = 0; i < 36; i++) {
      const a0 = (i / 36) * Math.PI * 2, a1 = ((i + 1) / 36) * Math.PI * 2;
      if (i % 2) continue;
      g.line(
        new Vector3(v.x + Math.cos(a0) * r, v.y, v.z + Math.sin(a0) * r),
        new Vector3(v.x + Math.cos(a1) * r, v.y, v.z + Math.sin(a1) * r),
        COLOR.guide,
      );
    }
  }
}
