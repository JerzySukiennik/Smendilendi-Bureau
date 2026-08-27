// tools/nav.js — Orbit, Pan and Section Plane.
//
// Orbit and Pan exist as TOOLS because SketchUp has them as tools, but they are
// not how you normally navigate: middle-drag orbits and shift+middle-drag pans
// from inside any tool, and on a trackpad alt-drag and alt+shift-drag do the
// same. These two just move those verbs onto the left button for as long as they
// are active.

import { Vector3 } from 'three';
import { Tool } from './base.js';
import { COLOR, AXIS } from '../constants.js';

export class OrbitTool extends Tool {
  static id = 'orbit';
  static toolName = 'Orbit';
  static hint = 'Drag to orbit. You never need this: middle-drag (or alt-drag) orbits from inside any tool.';
  onDoubleClick(p) { this.ed.cameras.recentre(p.snap?.point); }
}

export class PanTool extends Tool {
  static id = 'pan';
  static toolName = 'Pan';
  static hint = 'Drag to pan. Shift+middle-drag (or alt+shift-drag) does the same from inside any tool.';
}

/**
 * Section Plane — slice the model to see inside.
 * Click a face; the plane takes that face's normal. Arrow keys re-orient it
 * (up = blue, right = red, left = green), and the Measurements box moves it by
 * an exact distance along its own normal.
 */
export class SectionTool extends Tool {
  static id = 'section';
  static toolName = 'Section Plane';
  static valueLabel = 'Offset';
  static valueMode = 'length';
  static hint = 'Click a face to cut there. Arrow keys re-orient (up blue, right red, left green); '
    + 'type a distance to slide the cut. Esc removes it.';

  constructor(ed) {
    super(ed);
    this.normal = new Vector3(0, 1, 0);
    this.point = new Vector3(0, 1.2, 0);
  }

  activate() {
    if (this.ed.section) { this.normal.copy(this.ed.section.normal); this.point.copy(this.ed.section.point); }
  }

  cancel() {
    if (!this.ed.section) return false;
    this.ed.setSection(null);
    this.flash('Section removed');
    return true;
  }

  onKey(e) {
    const map = { ArrowUp: 'z', ArrowRight: 'x', ArrowLeft: 'y' };
    const key = map[e.code];
    if (!key) return false;
    this.normal.copy(AXIS[key].dir).negate();
    this.ed.setSection({ normal: this.normal.clone(), point: this.point.clone() });
    this.flash(`Section normal on the ${key === 'x' ? 'red' : key === 'y' ? 'green' : 'blue'} axis`);
    return true;
  }

  onUp(p, info) {
    if (info?.dragged) return;
    const hit = this.ed.pickAny(p.ndc);
    if (hit && hit.face) {
      this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).negate();
      this.point.copy(hit.point);
    } else {
      this.point.copy(p.snap.point);
      this.point.y = 1.2;
      this.normal.set(0, 1, 0);
    }
    this.ed.setSection({ normal: this.normal.clone(), point: this.point.clone() });
    this.flash('Section plane placed');
  }

  onValue(v) {
    if (v.kind !== 'length' || !this.ed.section) return false;
    this.point.addScaledVector(this.normal, -v.value);
    this.ed.setSection({ normal: this.normal.clone(), point: this.point.clone() });
    this.flash(`Section moved ${v.value.toFixed(3)} m`);
    return true;
  }

  draw(g) {
    if (!this.ed.section) return;
    const n = this.ed.section.normal;
    const p = this.ed.section.point;
    // a square of the cutting plane, drawn in the section orange SketchUp uses
    const up = Math.abs(n.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(up, n).normalize().multiplyScalar(6);
    const v = new Vector3().crossVectors(n, u).normalize().multiplyScalar(6);
    const c = [
      p.clone().add(u).add(v), p.clone().sub(u).add(v),
      p.clone().sub(u).sub(v), p.clone().add(u).sub(v),
    ];
    for (let i = 0; i < 4; i++) g.line(c[i], c[(i + 1) % 4], COLOR.ghost);
  }
}
