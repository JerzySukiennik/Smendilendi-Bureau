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
import { COLOR } from '../constants.js';

// ---------------------------------------------------------------------------

export class WallTool extends TwoPointTool {
  static id = 'wall';
  static planar = true;   // draws in plan: no vertical axis inference
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

  // A pier of less than 100 mm is not a wall in any building anywhere.
  get minLength() { return 0.10; }

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

  /**
   * A typed length, in the direction the drawing is ALREADY showing.
   *
   * `len` may be negative: that is the explicit flip, the same one SketchUp
   * takes. Everything else about the direction comes from the cursor, including
   * which way along a locked axis the wall runs — see Tool.lockedDir().
   */
  _byLength(len) {
    if (!Number.isFinite(len) || Math.abs(len) < 1e-9) return this.refuse('A wall needs a length');
    const sign = len < 0 ? -1 : 1;
    const L0 = Math.abs(len);
    if (L0 < this.minLength) return this.refuse(`Too short — walls start at ${Math.round(this.minLength * 1000)} mm`);
    if (this.from) {
      const aim = this.direction();
      const dir = this.lockedDir(aim, sign) || aim.multiplyScalar(sign);
      const b = this.from.clone().addScaledVector(dir, L0);
      this._commit(this.from.clone(), b);
      return true;
    }
    // no operation in progress: re-length the wall just drawn
    if (!this.last) return false;
    const L = this.last;
    const a = new Vector3(L.a.x, this.elevation, L.a.z);
    const b = a.clone().addScaledVector(L.dir, L0 * sign);
    // ONE undo step, not two. A re-length is a delete plus an add, and while
    // those were two history entries the first Ctrl+Z after a mistyped length
    // left the wall gone entirely — an intermediate state the player never
    // asked for. applyMany batches the pair, so Ctrl+Z goes straight back to
    // the length it had before.
    const made = this.ed.applyMany([
      { t: 'wall.delete', id: L.wallId },
      {
        t: 'wall.add',
        ax: r(a.x), az: r(a.z), bx: r(b.x), bz: r(b.z),
        wallType: this.wallType, thickness: this.thickness, levelId: this.ed.levelId,
      },
    ]);
    const op = made.find(o => o.t === 'wall.add');
    if (op) { L.wallId = op.id; L.length = L0; }
    this.from = null;
    this.flash(`Wall re-set to ${fmt(L0)}`);
    return true;
  }

  onKey(e) {
    if (this.typing) return false;          // [ and ] are characters a number can contain
    if (e.code === 'BracketLeft') { this.thickness = clamp(this.thickness - 0.02, 0.06, 1.2); this.flash(`${Math.round(this.thickness * 1000)} mm`); return true; }
    if (e.code === 'BracketRight') { this.thickness = clamp(this.thickness + 0.02, 0.06, 1.2); this.flash(`${Math.round(this.thickness * 1000)} mm`); return true; }
    return false;
  }

  draw(g, p) {
    const a = this.anchor;
    if (!a || !p.snap) return;
    const b = p.snap.point;
    const color = p.snap.kind === 'axis' ? p.snap.color : COLOR.ghost;
    g.line(a, b, color);
    const len = a.distanceTo(b);
    if (len < 1e-3) return;
    // the ghost of the wall itself, at its real thickness and storey height
    const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    const ang = Math.atan2(b.x - a.x, b.z - a.z);
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
  static planar = true;   // draws in plan: no vertical axis inference
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

  get minLength() { return 0.05; }

  onValue(v) {
    if (v.kind !== 'length' || !Number.isFinite(v.value) || Math.abs(v.value) < 1e-9) return false;
    const sign = v.value < 0 ? -1 : 1;
    const len = Math.abs(v.value);
    if (this.from) {
      const aim = this.direction();
      const dir = this.lockedDir(aim, sign) || aim.multiplyScalar(sign);
      this._commit(this.from.clone(), this.from.clone().addScaledVector(dir, len));
      return true;
    }
    if (!this.last) return false;
    const gd = this.ed.guides[this.last.index];
    if (!gd) return false;
    gd.b.copy(this.last.a).addScaledVector(this.last.dir, len * sign);
    this.flash(`Line re-set to ${fmt(len)}`);
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
    const a = this.anchor;
    if (a && p.snap) g.dotted(a, p.snap.point, p.snap.kind === 'axis' ? p.snap.color : COLOR.guide);
  }
}

// ---------------------------------------------------------------------------

export class RectTool extends TwoPointTool {
  static id = 'rect';
  static planar = true;   // draws in plan: no vertical axis inference
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
    const centre = this.fromCentre;
    const made = this._build(a, b, centre);
    if (!made) return null;
    this.last = {
      ids: made.ids, a: a.clone(), corner: made.corner, fromCentre: centre,
      sx: b.x < a.x ? -1 : 1, sz: b.z < a.z ? -1 : 1,
    };
    return null;                      // rectangles do not chain
  }

  /** Lay the four walls of one rectangle. @returns {{ids,corner}|null} */
  _build(a, b, centre) {
    const [x0, z0, x1, z1] = this._corners(a, b, centre);
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
    // A REFUSED RECTANGLE IS NOT A RECTANGLE. applyMany returns [] when the
    // buildable guard turns the batch down, and this used to sail past it:
    // it returned a `made` with no ids, RoomTool then laid the floor and the
    // ceiling on top of that nothing, and the size message overwrote the
    // refusal on the way out. So the player dragged a room across the boundary
    // and was told "Room 17.00 x 15.00 m" while receiving a bare floor and no
    // walls at all — which is what "design does not work" actually looked like.
    // Measured: four wall.add ops refused, two slab.add ops accepted, one
    // cheerful message. Nothing is built now unless the walls were.
    if (ops.length && !made.length) return null;
    this.flash(`${(Math.abs(x1 - x0)).toFixed(2)} × ${(Math.abs(z1 - z0)).toFixed(2)} m`);
    return { ids: made.map(o => o.id), corner: [x0, z0, x1, z1] };
  }

  _corners(a, b, centre = this.fromCentre) {
    if (centre) {
      const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
      return [r(a.x - dx), r(a.z - dz), r(a.x + dx), r(a.z + dz)];
    }
    return [r(Math.min(a.x, b.x)), r(Math.min(a.z, b.z)), r(Math.max(a.x, b.x)), r(Math.max(a.z, b.z))];
  }

  onMove(p) {
    super.onMove(p);
    this.fromCentre = !!this.ed.ctx?.input?.alt;
    // `anchor`, not `from`: during a press-drag `from` is still null (base.js),
    // and reading it here is why a dragged-out room showed no size at all until
    // the button came up. Both gestures now read out the same two numbers.
    const a = this.anchor;
    if (a && this.to) {
      const [x0, z0, x1, z1] = this._corners(a, this.to);
      this.setDisplay(this.sizeReadout(Math.abs(x1 - x0), Math.abs(z1 - z0)));
    }
  }

  /**
   * The two numbers the player watches while the rectangle grows.
   *
   * ONE UNIT FOR BOTH. `fmt` switches from millimetres to metres at 10 m on
   * its own, which on a rectangle produced "7000 mm × 10.000 m" — two units in
   * one dimension string, which no drawing has ever been annotated in. The
   * larger side chooses for the pair.
   */
  sizeReadout(w, d) {
    const metres = Math.max(w, d) >= 10;
    const one = (v) => (metres ? `${v.toFixed(2)} m` : `${Math.round(v * 1000)} mm`);
    return `${one(w)} × ${one(d)}`;
  }

  /**
   * A typed "6000,4000".
   *
   * Two rules, and the second one is the one that keeps the model honest:
   *
   * 1. Alt draws from the CENTRE, so the pair is still the rectangle's real
   *    length and width and the far corner is HALF of it away. Committing the
   *    full pair and then mirroring it about the centre built a 12 x 8 m
   *    rectangle out of a typed 6 x 4 — twice the building, on the tool an
   *    architect sets the shell out with.
   * 2. With nothing in progress the pair RE-SETS the rectangle just drawn,
   *    exactly as a typed length re-lengths the wall just drawn. It used to
   *    fall back to the cursor and lay a SECOND rectangle over the first: four
   *    walls became twelve and the schedule listed two overlapping rooms, in
   *    silence. Mistyping a dimension and retyping it is a five-minute-old
   *    reflex; it has to land on the rectangle you can see.
   */
  onValue(v) {
    if (v.kind !== 'pair' && v.kind !== 'length') return false;
    const w = v.kind === 'length' ? v.value : (v.a ?? 0);
    const d = v.kind === 'length' ? v.value : (v.b ?? v.a ?? 0);
    if (!(w > 0) || !(d > 0)) return this.refuse('A rectangle needs a length and a width');
    if (!this.from && this.last) return this._resetLast(w, d);
    const a = this.from || this.ed._pointer.snap?.point?.clone();
    if (!a) return false;
    // direction of the two typed dimensions follows the quadrant the cursor is in
    const sx = this.to && this.to.x < a.x ? -1 : 1;
    const sz = this.to && this.to.z < a.z ? -1 : 1;
    const k = this.fromCentre ? 0.5 : 1;
    this.from = a;
    this._commit(a.clone(), new Vector3(a.x + sx * w * k, a.y, a.z + sz * d * k));
    return true;
  }

  /** Re-set the rectangle just drawn to a typed size: delete its four walls, lay four new ones. */
  _resetLast(w, d) {
    const L = this.last;
    const k = L.fromCentre ? 0.5 : 1;
    const a = L.a.clone();
    const b = new Vector3(a.x + L.sx * w * k, a.y, a.z + L.sz * d * k);
    const [x0, z0, x1, z1] = this._corners(a, b, L.fromCentre);
    if (Math.abs(x1 - x0) < 0.05 || Math.abs(z1 - z0) < 0.05) {
      return this.refuse('Too small — a rectangle starts at 50 mm');
    }
    // If the player has since erased it, re-typing a size must not resurrect it.
    const alive = L.ids.filter(id => this.model.walls[id]);
    if (!alive.length) { this.last = null; return this.refuse('That rectangle is gone'); }
    this.ed.applyMany(alive.map(id => ({ t: 'wall.delete', id })));
    const made = this._build(a, b, L.fromCentre);
    if (!made) { this.last = null; return this.refuse('That rectangle is gone'); }
    this.last = { ...L, ids: made.ids, corner: made.corner };
    this.ed.measurements.clear();
    this.flash(`Rectangle re-set to ${fmt(Math.abs(x1 - x0))} × ${fmt(Math.abs(z1 - z0))}`);
    return true;
  }

  draw(g, p) {
    const a = this.anchor;
    if (!a || !p.snap) return;
    const [x0, z0, x1, z1] = this._corners(a, p.snap.point);
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
 * Room — press on the ground, drag, let go, and a room is there.
 *
 * THE PRIMARY VERB OF THE GAME (DESIGN-DECISIONS.md, "Dragging out a room is the
 * primary way to build"). One gesture produces a floor, four walls at the right
 * thickness and a ceiling, sized to the drag and reading its own dimensions as
 * it goes. It is the model a thirteen-year-old already knows from The Sims and
 * the way an architect blocks a plan out before drawing it properly.
 *
 * It costs nothing in credibility, because it emits the SAME ops the Rectangle
 * tool emits — `wall.add` splits and welds itself against everything it crosses,
 * so a second room dragged against the first shares its wall instead of doubling
 * it up — plus the two `slab.add`s the player would otherwise have to remember.
 */
export class RoomTool extends RectTool {
  static id = 'room';
  static toolName = 'Room';
  static valueLabel = 'Length, width';
  static valueMode = 'pair';
  static hint = 'Press on the ground and drag: a room appears — floor, walls and ceiling. '
    + 'Drag a second one against it and they share the wall. Or type "6000,4000".';

  _build(a, b, centre) {
    const made = super._build(a, b, centre);
    if (!made) return null;
    const [x0, z0, x1, z1] = made.corner;
    // The floor and the ceiling run to the wall CENTRELINES, which is where the
    // room polygon runs and where geometry.js expects a slab to stop.
    const poly = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const slabs = this.ed.applyMany([
      { t: 'slab.add', levelId: this.ed.levelId, kind: 'floor', polygon: poly.map(p => [p[0], p[1]]), mat: 'screed' },
      { t: 'slab.add', levelId: this.ed.levelId, kind: 'roof', polygon: poly.map(p => [p[0], p[1]]), mat: 'concrete' },
    ]);
    made.ids = made.ids.concat(slabs.map(o => o.id));
    const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
    this.flash(`Room ${w.toFixed(2)} × ${d.toFixed(2)} m — ${clearArea(w, d, this.wallType).toFixed(1)} m² inside the walls`);
    return made;
  }

  /**
   * The read-out while the room grows: the two dimensions, then the floor area
   * you could actually stand on. The drag runs along wall CENTRELINES, so the
   * clear area is the rectangle less half a wall on each of four sides — the
   * same arithmetic src/model/rooms.js does, and the same number the schedule
   * will print. Quoting w x d as the area (which this used to do) overstated a
   * 6.00 x 5.00 m room by 2.6 m2, and an architect reads that as a bug because
   * it is one.
   */
  sizeReadout(w, d) {
    if (!(w > 0) || !(d > 0)) return super.sizeReadout(w, d);
    return `${super.sizeReadout(w, d)} · ${clearArea(w, d, this.wallType).toFixed(1)} m² inside`;
  }

  /** Re-typing a size has to take the slabs with it, not leave them behind. */
  _resetLast(w, d) {
    const L = this.last;
    if (L) {
      const dead = L.ids.filter(id => this.model.slabs[id]);
      if (dead.length) this.ed.applyMany(dead.map(id => ({ t: 'slab.delete', id })));
      L.ids = L.ids.filter(id => !this.model.slabs[id]);
    }
    return super._resetLast(w, d);
  }
}

// ---------------------------------------------------------------------------

/**
 * Slab — a floor or roof plate. Click inside a closed room and the slab takes
 * that room's polygon; drag a rectangle for anything else.
 */
export class SlabTool extends TwoPointTool {
  static id = 'slab';
  static planar = true;   // draws in plan: no vertical axis inference
  static toolName = 'Slab';
  static valueLabel = 'Length, width';
  static valueMode = 'pair';
  static hint = 'Click inside a room to floor it, or drag a rectangle. R toggles floor / roof.';

  constructor(ed) {
    super(ed);
    this.kind = 'floor';
  }

  onKey(e) {
    if (this.typing) return false;          // "4r" is a radius, not a floor/roof toggle
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
    const a = this.anchor;
    if (!a || !p.snap) return;
    const b = p.snap.point;
    g.rect((a.x + b.x) / 2, (a.z + b.z) / 2,
      Math.abs(b.x - a.x), Math.abs(b.z - a.z), this.elevation + 0.02, COLOR.ghost);
  }
}

// ---------------------------------------------------------------------------

// Node coordinates are rounded to the MICROMETRE, not to the millimetre.
// Rounding each coordinate to 1 mm costs up to 0.7 mm of length on a diagonal,
// so a wall typed as exactly 4000 came out 3999.46 mm — a number an architect
// reads as a bug, because it is one. A micrometre is finer than anything the
// model, the analysis or the drawing can express, and still far coarser than
// the 1 mm node-merge tolerance in building.js, so junctions still weld.
const r = (v) => Math.round(v * 1e6) / 1e6;

/** Clear internal area of a centreline rectangle built in walls of one thickness. */
function clearArea(w, d, wallType = 'exterior') {
  const t = DEFAULT_WALL[wallType] ?? DEFAULT_WALL.exterior;
  return Math.max(0, w - t) * Math.max(0, d - t);
}
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
