// tools/draw.js — Wall, Line, Rectangle, Slab.
//
// Wall is the primary verb of the whole game: click a start point, move, type
// "4m" or "4000", Enter — a wall of the right thickness appears and the next one
// chains from its end, so a whole plan is drawn without ever letting go.
//
// CLICK COUNT (the bar is reference/sketchup/ANALYSIS.md §7):
//   a 4 m wall of exact length : W, click, "4m" Enter          = 3 decisions
//   a bare 4 m setting-out line: L, click, "4m" Enter           = 3 decisions
//   a 6 x 4 m room outline     : R, click, "6000,4000" Enter    = 3 decisions
//
// A value typed AFTER the wall is finished re-lengths it, exactly the way the
// Measurements box keeps working after a Push/Pull.

import { Vector3 } from 'three';
import { Tool, TwoPointTool, fmt } from './base.js';
import { DEFAULT_WALL } from '../../model/building.js';
import { COLOR, AXIS } from '../constants.js';

// ---------------------------------------------------------------------------

export class WallTool extends TwoPointTool {
  static id = 'wall';
  static toolName = 'Wall';
  static valueLabel = 'Length';
  static valueMode = 'length';
  static hint = 'Click a start point, then type a length or click the end. '
    + 'W again toggles exterior / interior. Arrow keys lock an axis. Esc ends the run.';

  constructor(ed) {
    super(ed);
    this.wallType = 'exterior';
    this.thickness = DEFAULT_WALL.exterior;
  }

  activate(_params, again) {
    // Pressing the tool key again cycles the wall type — one key, no panel trip.
    if (again) {
      this.wallType = this.wallType === 'exterior' ? 'interior' : 'exterior';
      this.thickness = DEFAULT_WALL[this.wallType];
      this.flash(`${cap(this.wallType)} wall, ${Math.round(this.thickness * 1000)} mm`);
    }
  }

  get hintLine() {
    return `${cap(this.wallType)} ${Math.round(this.thickness * 1000)} mm · ${this.constructor.hint}`;
  }

  finish(a, b) {
    const op = this.apply({
      t: 'wall.add',
      ax: r(a.x), az: r(a.z), bx: r(b.x), bz: r(b.z),
      wallType: this.wallType,
      thickness: this.thickness,
      levelId: this.ed.levelId,
    });
    if (op) {
      this.last = {
        wallId: op.id,
        a: { x: r(a.x), z: r(a.z) },
        dir: new Vector3(b.x - a.x, 0, b.z - a.z).normalize(),
        length: a.distanceTo(b),
      };
      this.refDir = this.last.dir;
    }
    return b;                       // chain from the end
  }

  onValue(v) {
    if (v.kind === 'pair' && v.a != null) {
      // length, thickness
      if (v.b != null) this.thickness = clamp(v.b, 0.05, 1.2);
      return this._byLength(v.a);
    }
    if (v.kind !== 'length') return false;
    return this._byLength(v.value);
  }

  _byLength(len) {
    if (!(len > 0)) return false;
    if (this.from) {
      const dir = this.ed.lockAxis && this.ed.lockAxis !== 'ref'
        ? AXIS[this.ed.lockAxis].dir.clone()
        : this.direction();
      const b = this.from.clone().addScaledVector(dir, len);
      this._commit(this.from.clone(), b);
      return true;
    }
    // no operation in progress: re-length the wall just drawn
    if (!this.last) return false;
    const L = this.last;
    const a = new Vector3(L.a.x, this.elevation, L.a.z);
    const b = a.clone().addScaledVector(L.dir, len);
    this.apply({ t: 'wall.delete', id: L.wallId });
    const op = this.apply({
      t: 'wall.add',
      ax: r(a.x), az: r(a.z), bx: r(b.x), bz: r(b.z),
      wallType: this.wallType, thickness: this.thickness, levelId: this.ed.levelId,
    });
    if (op) { L.wallId = op.id; L.length = len; }
    this.from = null;
    this.flash(`Wall re-set to ${fmt(len)}`);
    return true;
  }

  onKey(e) {
    if (e.code === 'BracketLeft') { this.thickness = clamp(this.thickness - 0.02, 0.06, 1.2); this.flash(`${Math.round(this.thickness * 1000)} mm`); return true; }
    if (e.code === 'BracketRight') { this.thickness = clamp(this.thickness + 0.02, 0.06, 1.2); this.flash(`${Math.round(this.thickness * 1000)} mm`); return true; }
    return false;
  }

  draw(g, p) {
    if (!this.from || !p.snap) return;
    const b = p.snap.point;
    const color = p.snap.kind === 'axis' ? p.snap.color : COLOR.ghost;
    g.line(this.from, b, color);
    const len = this.from.distanceTo(b);
    if (len < 1e-3) return;
    // the ghost of the wall itself, at its real thickness and storey height
    const mid = new Vector3().addVectors(this.from, b).multiplyScalar(0.5);
    const ang = Math.atan2(b.x - this.from.x, b.z - this.from.z);
    const h = this.ed.storeyHeight;
    g.ghostBox(mid.x, this.elevation + h / 2, mid.z, this.thickness, h, len, ang);
  }
}

// ---------------------------------------------------------------------------

/**
 * Line — a setting-out line. Not a wall: a construction guide you draw a plan
 * against, exactly what an architect reaches for before committing structure.
 * Guides snap ("On Line"), cost nothing, and are erased with the Eraser.
 */
export class LineTool extends TwoPointTool {
  static id = 'line';
  static toolName = 'Line';
  static valueLabel = 'Length';
  static valueMode = 'length';
  static hint = 'Setting-out line: click a start point, then type a length or click the end. '
    + 'Alt cycles the inference engine (all / off / parallel and perpendicular only).';

  finish(a, b) {
    this.ed.guides.push({ a: a.clone(), b: b.clone() });
    this.last = { a: a.clone(), dir: new Vector3().subVectors(b, a).normalize(), index: this.ed.guides.length - 1 };
    this.refDir = this.last.dir;
    return b;
  }

  onValue(v) {
    if (v.kind !== 'length' || !(v.value > 0)) return false;
    if (this.from) {
      const dir = this.ed.lockAxis && this.ed.lockAxis !== 'ref' ? AXIS[this.ed.lockAxis].dir.clone() : this.direction();
      this._commit(this.from.clone(), this.from.clone().addScaledVector(dir, v.value));
      return true;
    }
    if (!this.last) return false;
    const gd = this.ed.guides[this.last.index];
    if (!gd) return false;
    gd.b.copy(this.last.a).addScaledVector(this.last.dir, v.value);
    this.flash(`Line re-set to ${fmt(v.value)}`);
    return true;
  }

  onKey(e) {
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      const m = this.ed.inference.cycleMode();
      this.flash(m === 'all' ? 'All inferences on' : m === 'off' ? 'All inferences off' : 'Parallel and perpendicular only');
      return true;
    }
    return false;
  }

  draw(g, p) {
    if (this.from && p.snap) g.dotted(this.from, p.snap.point, p.snap.kind === 'axis' ? p.snap.color : COLOR.guide);
  }
}

// ---------------------------------------------------------------------------

export class RectTool extends TwoPointTool {
  static id = 'rect';
  static toolName = 'Rectangle';
  static valueLabel = 'Length, width';
  static valueMode = 'pair';
  static hint = 'Two opposite corners, or type "6000,4000". Draws a closed run of walls. '
    + 'Alt draws from the centre.';

  constructor(ed) {
    super(ed);
    this.fromCentre = false;
    this.wallType = 'exterior';
  }

  finish(a, b) {
    const [x0, z0, x1, z1] = this._corners(a, b);
    if (Math.abs(x1 - x0) < 0.05 || Math.abs(z1 - z0) < 0.05) return null;
    const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const ops = c.map((pt, i) => {
      const q = c[(i + 1) % 4];
      return {
        t: 'wall.add', ax: r(pt[0]), az: r(pt[1]), bx: r(q[0]), bz: r(q[1]),
        wallType: this.wallType, thickness: DEFAULT_WALL[this.wallType], levelId: this.ed.levelId,
      };
    });
    const made = this.ed.applyMany(ops);
    this.last = { ids: made.map(o => o.id), a: a.clone(), corner: [x0, z0, x1, z1] };
    this.flash(`${(Math.abs(x1 - x0)).toFixed(2)} × ${(Math.abs(z1 - z0)).toFixed(2)} m`);
    return null;                      // rectangles do not chain
  }

  _corners(a, b) {
    if (this.fromCentre) {
      const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
      return [r(a.x - dx), r(a.z - dz), r(a.x + dx), r(a.z + dz)];
    }
    return [r(Math.min(a.x, b.x)), r(Math.min(a.z, b.z)), r(Math.max(a.x, b.x)), r(Math.max(a.z, b.z))];
  }

  onMove(p) {
    super.onMove(p);
    this.fromCentre = !!this.ed.ctx?.input?.alt;
    if (this.from && this.to) {
      const [x0, z0, x1, z1] = this._corners(this.from, this.to);
      this.setDisplay(`${fmt(Math.abs(x1 - x0))} × ${fmt(Math.abs(z1 - z0))}`);
    }
  }

  onValue(v) {
    if (v.kind !== 'pair' && v.kind !== 'length') return false;
    const w = v.kind === 'length' ? v.value : (v.a ?? 0);
    const d = v.kind === 'length' ? v.value : (v.b ?? v.a ?? 0);
    if (!(w > 0) || !(d > 0)) return false;
    const a = this.from || this.ed._pointer.snap?.point?.clone();
    if (!a) return false;
    // direction of the two typed dimensions follows the quadrant the cursor is in
    const sx = this.to && this.to.x < a.x ? -1 : 1;
    const sz = this.to && this.to.z < a.z ? -1 : 1;
    this.from = a;
    this._commit(a.clone(), new Vector3(a.x + sx * w, a.y, a.z + sz * d));
    return true;
  }

  draw(g, p) {
    if (!this.from || !p.snap) return;
    const [x0, z0, x1, z1] = this._corners(this.from, p.snap.point);
    const h = this.ed.storeyHeight;
    const t = DEFAULT_WALL[this.wallType];
    const y = this.elevation;
    g.rect((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, y + 0.01, COLOR.ghost);
    g.ghostBox((x0 + x1) / 2, y + h / 2, z0, Math.abs(x1 - x0), h, t);
    g.ghostBox((x0 + x1) / 2, y + h / 2, z1, Math.abs(x1 - x0), h, t);
    g.ghostBox(x0, y + h / 2, (z0 + z1) / 2, t, h, Math.abs(z1 - z0));
    g.ghostBox(x1, y + h / 2, (z0 + z1) / 2, t, h, Math.abs(z1 - z0));
  }
}

// ---------------------------------------------------------------------------

/**
 * Slab — a floor or roof plate. Click inside a closed room and the slab takes
 * that room's polygon; drag a rectangle for anything else.
 */
export class SlabTool extends TwoPointTool {
  static id = 'slab';
  static toolName = 'Slab';
  static valueLabel = 'Length, width';
  static valueMode = 'pair';
  static hint = 'Click inside a room to floor it, or drag a rectangle. R toggles floor / roof.';

  constructor(ed) {
    super(ed);
    this.kind = 'floor';
  }

  onKey(e) {
    if (e.code === 'KeyR') {
      this.kind = this.kind === 'floor' ? 'roof' : 'floor';
      this.flash(`Slab: ${this.kind}`);
      return true;
    }
    return false;
  }

  onUp(p, info) {
    // A click inside a room floors that room — one decision, no dragging.
    if (!info?.dragged && !this.from) {
      const rooms = this.ed.rooms();
      for (const id of rooms.order) {
        const rm = rooms.rooms[id];
        if (pointInPoly(rm.polygon, p.snap.point.x, p.snap.point.z)) {
          this.apply({
            t: 'slab.add', levelId: this.ed.levelId, kind: this.kind,
            polygon: rm.polygon.map(q => [q[0], q[1]]),
            mat: this.kind === 'roof' ? 'concrete' : 'screed',
          });
          this.flash(`${cap(this.kind)} slab, ${rm.area.toFixed(2)} m²`);
          return;
        }
      }
    }
    super.onUp(p, info);
  }

  finish(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    if (x1 - x0 < 0.1 || z1 - z0 < 0.1) return null;
    this.apply({
      t: 'slab.add', levelId: this.ed.levelId, kind: this.kind,
      polygon: [[r(x0), r(z0)], [r(x1), r(z0)], [r(x1), r(z1)], [r(x0), r(z1)]],
      mat: this.kind === 'roof' ? 'concrete' : 'screed',
    });
    return null;
  }

  draw(g, p) {
    if (!this.from || !p.snap) return;
    const b = p.snap.point;
    g.rect((this.from.x + b.x) / 2, (this.from.z + b.z) / 2,
      Math.abs(b.x - this.from.x), Math.abs(b.z - this.from.z), this.elevation + 0.02, COLOR.ghost);
  }
}

// ---------------------------------------------------------------------------

const r = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
