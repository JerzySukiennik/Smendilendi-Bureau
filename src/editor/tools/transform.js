// tools/transform.js — Move, Rotate, Scale, Offset.
//
// CLICK COUNT for the graded operation (move an object exactly 500 mm along an
// axis), against SketchUp's 5:
//
//   click the object (Select) -> M -> Right arrow (locks red) -> "500" Enter
//   = 4 decisions
//   click the object (Select) -> M -> "<500,0,0>" Enter
//   = 3 decisions
//
// The saving over SketchUp is one click: activating Move with something already
// selected starts the move from the selection's own centre instead of demanding
// a grab point. The grab point is still available — click one and the move
// re-anchors there — it is just not compulsory.
//
// GRAB LOCK: starting a move takes the multiplayer lock on every object in the
// selection; the objects glow in the holder's colour for everyone else and are
// frozen until the move commits or is cancelled.

import { Vector3 } from 'three';
import { Tool, fmt } from './base.js';
import { AXIS, COLOR } from '../constants.js';
import { tryEntry } from '../../model/catalog.js';
import { backsOntoWall, snapAgainstWall } from '../snapping.js';

class TransformTool extends Tool {
  constructor(ed) {
    super(ed);
    this.op = null;        // the live operation
    this.last = null;      // what a value typed AFTERWARDS re-does
  }

  /** Everything selected, as a list of { kind, id, x, z, y }. */
  targets() {
    const m = this.model;
    const out = [];
    for (const id of this.ed.selection) {
      if (m.furniture[id]) out.push({ kind: 'furniture', id, ...pick(m.furniture[id]) });
      else if (m.texts[id]) out.push({ kind: 'text', id, ...pick(m.texts[id]) });
      else if (m.walls[id]) {
        const w = m.walls[id];
        const a = m.nodes[w.a], b = m.nodes[w.b];
        out.push({ kind: 'wall', id, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: 0, a: { ...a }, b: { ...b } });
      }
    }
    return out;
  }

  centroid(list) {
    if (!list.length) return null;
    let x = 0, z = 0, y = 0;
    for (const t of list) { x += t.x; z += t.z; y += t.y || 0; }
    return new Vector3(x / list.length, y / list.length, z / list.length);
  }

  lock(ids) { for (const id of ids) this.ed.session.lock?.(id); }
  unlock(ids) { for (const id of ids) this.ed.session.unlock?.(id); }

  cancel() {
    if (!this.op) return false;
    this.unlock(this.op.targets.map(t => t.id));
    this.op = null;
    this.ed.measurements.clear();
    return true;
  }

  inferenceContext() {
    return {
      from: this.op?.anchor || null,
      height: this.elevation,
      ignoreIds: this.op ? new Set(this.op.targets.map(t => t.id)) : null,
    };
  }
}

// ---------------------------------------------------------------------------

export class MoveTool extends TransformTool {
  static id = 'move';
  static toolName = 'Move';
  static valueLabel = 'Distance';
  static valueMode = 'length';
  static hint = 'With something selected, Move starts straight away. Arrow keys lock an axis, '
    + 'Ctrl copies, "<500,0,0>" moves by exact components, "6x" makes an array.';

  activate() {
    const list = this.targets();
    if (!list.length) { this.op = null; return; }
    // Armed, not yet grabbed: the centroid is a usable anchor for a typed value
    // straight away, and the first CLICK re-anchors the move to the point the
    // player picked instead of dropping the objects there.
    this._start(list, this.centroid(list), false);
  }

  _start(list, anchor, grabbed = true) {
    this.op = { targets: list, anchor: anchor.clone(), delta: new Vector3(), copy: false, grabbed };
    this.lock(list.map(t => t.id));
  }

  onDown(p) {
    if (this.op) return;
    const hit = this.ed.pickAny(p.ndc);
    if (!hit) return;
    this.ed.select([hit.entityId]);
    const list = this.targets();
    if (list.length) this._start(list, p.snap.point.clone(), true);
  }

  onMove(p) {
    if (!this.op) { this.setDisplay(''); return; }
    const raw = new Vector3().subVectors(p.snap.point, this.op.anchor);
    this.op.delta.copy(this._constrain(raw));
    this.op.copy = !!this.ed.ctx?.input?.ctrl;
    this._wallSnap(p);
    this.setDisplay(fmt(this.op.delta.length()) + (this.op.snapRot != null ? ' · on wall' : ''));
  }

  /**
   * DRAGGING A WC TOWARDS A WALL PUTS IT AGAINST THE WALL — at any wall angle.
   *
   * Only for a single floor piece that the catalogue says backs onto something
   * (see snapping.backsOntoWall): a selection of six chairs being shuffled, or
   * anything on a locked axis, keeps the delta it was given. Shift suppresses.
   */
  _wallSnap(p) {
    const op = this.op;
    op.snapRot = null;
    if (!op || op.targets.length !== 1) return;
    const t = op.targets[0];
    if (t.kind !== 'furniture') return;
    if (this.ed.lockAxis || this.ed.ctx?.input?.shift) return;
    const f = this.model.furniture[t.id];
    const entry = f ? tryEntry(f.catalogId) : null;
    if (!entry || !backsOntoWall(entry)) return;
    const want = { x: t.x + op.delta.x, z: t.z + op.delta.z };
    const hit = snapAgainstWall(this.model, this.ed.levelId, want, entry, { reach: 0.55 });
    if (!hit) return;
    op.delta.x = hit.x - t.x;
    op.delta.z = hit.z - t.z;
    op.snapRot = hit.rot;
    void p;
  }

  /**
   * FURNITURE STAYS ON THE FLOOR unless the blue axis is explicitly locked.
   *
   * The grab point and the drop point are snapped independently, so a grab that
   * landed on a wall face and a drop that landed on the ground handed the move a
   * vertical component nobody asked for: a dining chair moved 500 mm sideways
   * came to rest 446 mm in the air, contact shadow and all. Height is a
   * deliberate act — ArrowUp locks blue, or a typed "<0,0,500>", which _commit()
   * honours through its `exact` flag — never a by-product of where two rays
   * happened to hit.
   */
  _groundOnly() {
    if (this.ed.lockAxis === 'z') return false;
    const list = this.op?.targets || [];
    return list.length > 0 && list.every(t => t.kind === 'furniture');
  }

  _constrain(v) {
    const a = this.ed.lockAxis;
    if (a && a !== 'ref') {
      const dir = AXIS[a].dir;
      return dir.clone().multiplyScalar(v.dot(dir));
    }
    if (this._groundOnly()) return new Vector3(v.x, 0, v.z);
    return v;
  }

  onUp(p, info) {
    if (!this.op) return;
    if (info?.dragged) { this._commit(this.op.delta.clone()); return; }
    // A CLICK, not a drag. SketchUp's Move is click-to-grab, move, click-to-drop,
    // and a press-release on the object is the GRAB half of that. Treating it as
    // the drop is what made Move drag-only: the mouse button had to stay down
    // through the arrow key and all four digits of a typed distance.
    if (!this.op.grabbed) {
      this.op.grabbed = true;
      this.op.anchor.copy(p.snap.point);
      this.op.delta.set(0, 0, 0);
      this.setDisplay('');
      return;
    }
    if (this.op.delta.lengthSq() < 1e-8) { this.cancel(); return; }   // dropped where it was
    this._commit(this.op.delta.clone());
  }

  /**
   * `exact` marks a delta the player TYPED. A typed vector is the deliberate act
   * _groundOnly() talks about, so its blue component is honoured instead of
   * being quietly flattened — dropping it made "<0,0,500>" do nothing at all,
   * with no message, while the same tool moved happily along red and green.
   */
  _commit(delta, { copies = 1, exact = false } = {}) {
    if (!this.op) return false;
    const list = this.op.targets;
    const copy = this.op.copy || copies > 1;
    const ops = [];
    const flat = !exact && this._groundOnly();
    for (let c = 1; c <= copies; c++) {
      const d = delta.clone().multiplyScalar(c);
      const dGround = flat ? new Vector3(d.x, 0, d.z) : d;
      for (const t of list) ops.push(...moveOps(this.model, t, t.kind === 'furniture' ? dGround : d, copy));
    }
    // A piece that found a wall takes the wall's angle with it — sliding a WC
    // onto a slanted wall and leaving it square to the world would be worse
    // than not snapping at all.
    if (this.op.snapRot != null && !copy && list.length === 1 && list[0].kind === 'furniture') {
      ops.push({ t: 'furniture.move', id: list[0].id, rot: Math.round(this.op.snapRot * 1e4) / 1e4 });
    }
    this.ed.applyMany(ops);
    this.last = { targets: list, delta: delta.clone(), copies, copy };
    this.unlock(list.map(t => t.id));
    this.op = null;
    this.ed.measurements.clear();
    this.flash(`${copy ? 'Copied' : 'Moved'} ${list.length} object${list.length > 1 ? 's' : ''} ${fmt(delta.length())}`);
    return true;
  }

  /**
   * TWO TYPED VECTOR FORMS, AND THEY MEAN DIFFERENT THINGS — SketchUp's rule:
   *   <500,0,0>   RELATIVE: move by these components
   *   [500,0,0]   GLOBAL:   put the grabbed point at this coordinate
   * Treating the square brackets as relative moved a chair at x = 3.000 to
   * x = 3.500 when the player had asked for x = 0.500, which is a whole
   * different building when the coordinate came off a survey.
   */
  onValue(v) {
    if (v.kind === 'vector') {
      // UI axes: x = red, y = green (plan depth), z = blue (up)
      const d = new Vector3(v.x, v.z, v.y);
      if (!v.rel) {
        // The anchor is the grabbed point, or the selection's own centre when
        // Move was armed without grabbing anything.
        const anchor = this.op ? this.op.anchor.clone() : this.centroid(this.targets());
        if (!anchor) return this.refuse('Nothing to place — select something first');
        d.sub(anchor);
        if (!this.op && !this.last) return this.refuse('Nothing to place — select something first');
      }
      if (this.op) return this._commit(d, { exact: true });
      return this._redoLast(d);
    }
    if (v.kind === 'array' && this.op) {
      const d = this.op.delta.clone();
      if (d.lengthSq() < 1e-9) return false;
      if (v.mode === 'copies') { this.op.copy = true; return this._commit(d, { copies: v.n }); }
      const step = d.clone().divideScalar(v.n);
      this.op.copy = true;
      return this._commit(step, { copies: v.n });
    }
    if (v.kind !== 'length') return false;
    const sign = v.value < 0 ? -1 : 1;
    const len = Math.abs(v.value);
    if (this.op) {
      // The lock names the LINE; the cursor still names which way along it.
      let dir = this.lockedDir(this.op.delta, sign);
      if (!dir) {
        dir = this.op.delta.clone();
        if (dir.lengthSq() < 1e-9) dir = new Vector3(sign, 0, 0);
        else dir.normalize().multiplyScalar(sign);
      }
      return this._commit(dir.multiplyScalar(len));
    }
    // after the fact: redo the last move at a new distance — still down the
    // locked axis if one is held, not down whatever diagonal the drag left.
    if (!this.last) return false;
    let dir = this.lockedDir(this.last.delta, sign);
    if (!dir) {
      dir = this.last.delta.clone();
      if (dir.lengthSq() < 1e-9) return false;
      dir.normalize().multiplyScalar(sign);
    }
    return this._redoLast(dir.multiplyScalar(len), true);
  }

  _redoLast(delta, undoFirst = false) {
    if (!this.last) return false;
    const list = this.last.targets;
    const ops = [];
    if (undoFirst) for (const t of list) ops.push(...moveOps(this.model, t, this.last.delta.clone().negate(), false));
    for (const t of list) ops.push(...moveOps(this.model, t, delta, false));
    this.ed.applyMany(ops);
    this.last = { ...this.last, delta: delta.clone() };
    this.flash(`Moved ${fmt(delta.length())}`);
    return true;
  }

  draw(g, p) {
    if (!this.op) return;
    const a = this.op.anchor;
    const b = a.clone().add(this.op.delta);
    const lockColor = this.ed.lockAxis && this.ed.lockAxis !== 'ref' ? AXIS[this.ed.lockAxis].color : COLOR.ghost;
    g.line(a, b, lockColor);
    for (const t of this.op.targets) {
      if (t.kind === 'wall') {
        const A = new Vector3(t.a.x, this.elevation, t.a.z).add(this.op.delta);
        const B = new Vector3(t.b.x, this.elevation, t.b.z).add(this.op.delta);
        g.line(A, B, COLOR.ghost);
      } else {
        const entry = t.kind === 'furniture' ? tryEntry(this.model.furniture[t.id]?.catalogId) : null;
        const s = entry ? entry.size : [0.4, 0.4, 0.4];
        const f = this.model.furniture[t.id];
        g.ghostBox(t.x + this.op.delta.x, (t.y || 0) + this.op.delta.y + s[1] / 2, t.z + this.op.delta.z,
          s[0] * (f?.sx ?? 1), s[1] * (f?.sy ?? 1), s[2] * (f?.sz ?? 1), f?.rot || 0);
      }
    }
    void p;
  }
}

// ---------------------------------------------------------------------------

export class RotateTool extends TransformTool {
  static id = 'rotate';
  static toolName = 'Rotate';
  static valueLabel = 'Angle';
  static valueMode = 'angle';
  static hint = 'Click to set the start of the angle, then move or type degrees. '
    + 'Ctrl rotates a copy. Negative is counter-clockwise; "8:12" is a slope.';

  activate() {
    const list = this.targets();
    if (!list.length) { this.op = null; return; }
    this.op = { targets: list, anchor: this.centroid(list), ref: null, angle: 0, copy: false };
    this.lock(list.map(t => t.id));
  }

  onUp(p, info) {
    if (!this.op) {
      const hit = this.ed.pickAny(p.ndc);
      if (hit) { this.ed.select([hit.entityId]); this.activate(); }
      return;
    }
    if (!this.op.ref) {
      this.op.ref = angleOf(this.op.anchor, p.snap.point);
      return;
    }
    if (info?.dragged || Math.abs(this.op.angle) > 1e-4) this._commit(this.op.angle);
  }

  onMove(p) {
    if (!this.op) { this.setDisplay(''); return; }
    if (this.op.ref == null) { this.setDisplay('0.0°'); return; }
    const a = angleOf(this.op.anchor, p.snap.point);
    let d = (a - this.op.ref) * 180 / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (this.ed.ctx?.input?.shift) d = Math.round(d / 15) * 15;
    this.op.angle = d;
    this.op.copy = !!this.ed.ctx?.input?.ctrl;
    this.setDisplay(`${d.toFixed(1)}°`);
  }

  _commit(deg) {
    const rad = deg * Math.PI / 180;
    const ops = [];
    for (const t of this.op.targets) ops.push(...rotateOps(this.model, t, this.op.anchor, rad, this.op.copy));
    this.ed.applyMany(ops);
    this.last = { targets: this.op.targets, anchor: this.op.anchor.clone(), deg };
    this.unlock(this.op.targets.map(t => t.id));
    this.op = null;
    this.flash(`Rotated ${deg.toFixed(1)}°`);
    return true;
  }

  onValue(v) {
    if (v.kind !== 'angle') return false;
    if (this.op) { if (this.op.ref == null) this.op.ref = 0; return this._commit(v.deg); }
    if (!this.last) return false;
    const ops = [];
    const back = -this.last.deg * Math.PI / 180;
    for (const t of this.last.targets) ops.push(...rotateOps(this.model, t, this.last.anchor, back, false));
    for (const t of this.last.targets) ops.push(...rotateOps(this.model, t, this.last.anchor, v.deg * Math.PI / 180, false));
    this.ed.applyMany(ops);
    this.last.deg = v.deg;
    this.flash(`Rotated ${v.deg.toFixed(1)}°`);
    return true;
  }

  draw(g, p) {
    if (!this.op) return;
    const c = this.op.anchor;
    const r = Math.max(0.6, this.ed.cameras.metresPerPixel(c) * 90);
    // the protractor disc
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
      g.line(
        new Vector3(c.x + Math.cos(a0) * r, c.y, c.z + Math.sin(a0) * r),
        new Vector3(c.x + Math.cos(a1) * r, c.y, c.z + Math.sin(a1) * r),
        i % 4 === 0 ? COLOR.magenta : COLOR.guide,
      );
    }
    if (this.op.ref != null) {
      g.line(c, new Vector3(c.x + Math.cos(this.op.ref) * r, c.y, c.z + Math.sin(this.op.ref) * r), COLOR.guide);
      const a = this.op.ref + this.op.angle * Math.PI / 180;
      g.line(c, new Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r), COLOR.magenta);
    }
    void p;
  }
}

// ---------------------------------------------------------------------------

export class ScaleTool extends TransformTool {
  static id = 'scale';
  static toolName = 'Scale';
  static valueLabel = 'Scale';
  static valueMode = 'factor';
  static hint = 'Drag to scale about the centre; an arrow key restricts to one axis. '
    + 'Type "1.5", "150%" or a finished length such as "2400".';

  activate() {
    const list = this.targets().filter(t => t.kind === 'furniture' || t.kind === 'text');
    if (!list.length) { this.op = null; return; }
    this.op = { targets: list, anchor: this.centroid(list), factor: 1, start: null };
    this.lock(list.map(t => t.id));
  }

  onDown(p) {
    if (!this.op) {
      const hit = this.ed.pickFurniture(p.ndc) || this.ed.pickText(p.ndc);
      if (hit) { this.ed.select([hit.entityId]); this.activate(); }
      return;
    }
    this.op.start = p.snap.point.distanceTo(this.op.anchor) || 1;
  }

  onMove(p) {
    if (!this.op) { this.setDisplay(''); return; }
    if (this.op.start) {
      const d = p.snap.point.distanceTo(this.op.anchor);
      this.op.factor = clamp(d / this.op.start, 0.05, 20);
    }
    this.setDisplay(`${(this.op.factor * 100).toFixed(1)} %`);
  }

  onUp(p, info) {
    if (!this.op || !this.op.start) return;
    if (info?.dragged || Math.abs(this.op.factor - 1) > 1e-3) this._commit(this.op.factor);
    void p;
  }

  _axisMask() {
    const a = this.ed.lockAxis;
    if (a === 'x') return [1, 0, 0];
    if (a === 'y') return [0, 0, 1];
    if (a === 'z') return [0, 1, 0];
    return [1, 1, 1];
  }

  _commit(factor) {
    const mask = this._axisMask();
    const ops = [];
    for (const t of this.op.targets) {
      if (t.kind === 'furniture') {
        const f = this.model.furniture[t.id];
        ops.push({
          t: 'furniture.transform', id: t.id,
          sx: (f.sx ?? 1) * (mask[0] ? factor : 1),
          sy: (f.sy ?? 1) * (mask[1] ? factor : 1),
          sz: (f.sz ?? 1) * (mask[2] ? factor : 1),
        });
      } else if (t.kind === 'text') {
        const tx = this.model.texts[t.id];
        ops.push({ t: 'text.edit', id: t.id, props: { size: (tx.size || 0.3) * factor } });
      }
    }
    this.ed.applyMany(ops);
    this.last = { targets: this.op.targets, factor };
    this.unlock(this.op.targets.map(t => t.id));
    this.op = null;
    this.flash(`Scaled ${(factor * 100).toFixed(1)} %`);
    return true;
  }

  onValue(v) {
    if (v.kind === 'factor') {
      if (this.op) return this._commit(v.factor);
      return false;
    }
    if (v.kind === 'length' && this.op) {
      // a finished length: scale so the item's largest axis measures that
      const t = this.op.targets[0];
      const f = this.model.furniture[t.id];
      const entry = f ? tryEntry(f.catalogId) : null;
      const current = entry ? Math.max(entry.size[0] * (f.sx ?? 1), entry.size[2] * (f.sz ?? 1)) : 1;
      return this._commit(clamp(v.value / current, 0.05, 20));
    }
    return false;
  }

  draw(g) {
    if (!this.op) return;
    const c = this.op.anchor;
    const r = 0.4;
    g.rect(c.x, c.z, r * 2 * this.op.factor, r * 2 * this.op.factor, c.y + 0.02, COLOR.magenta);
  }
}

// ---------------------------------------------------------------------------

export class OffsetTool extends Tool {
  static id = 'offset';
  static toolName = 'Offset';
  static valueLabel = 'Offset';
  static valueMode = 'length';
  static hint = 'Click a wall, then move or type a distance to lay a parallel wall. '
    + 'Double-click another wall to repeat the same offset.';

  constructor(ed) {
    super(ed);
    this.wallId = null;
    this.distance = 0;
    this.lastDistance = 0;
  }

  cancel() {
    if (!this.wallId) return false;
    this.wallId = null;
    return true;
  }

  onDown(p) {
    if (this.wallId) return;
    const hit = this.ed.pickShell(p.ndc);
    if (hit && this.model.walls[hit.entityId]) this.wallId = hit.entityId;
  }

  onMove(p) {
    if (!this.wallId) { this.setDisplay(''); return; }
    const w = this.model.walls[this.wallId];
    const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    this.distance = (p.snap.point.x - a.x) * nx + (p.snap.point.z - a.z) * nz;
    this.setDisplay(fmt(Math.abs(this.distance)));
  }

  onUp(p, info) {
    if (!this.wallId) return;
    if (Math.abs(this.distance) < 0.02) return;
    this._commit(this.distance);
    void p; void info;
  }

  onDoubleClick(p) {
    const hit = this.ed.pickShell(p.ndc);
    if (!hit || !this.model.walls[hit.entityId] || !this.lastDistance) return;
    this.wallId = hit.entityId;
    this._commit(this.lastDistance);
  }

  _commit(distance) {
    const w = this.model.walls[this.wallId];
    if (!w) { this.wallId = null; return false; }
    const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len * distance, nz = (b.x - a.x) / len * distance;
    this.apply({
      t: 'wall.add',
      ax: r(a.x + nx), az: r(a.z + nz), bx: r(b.x + nx), bz: r(b.z + nz),
      wallType: w.type, thickness: w.thickness, levelId: w.levelId,
    });
    this.lastDistance = distance;
    this.wallId = null;
    this.flash(`Offset ${fmt(Math.abs(distance))}`);
    return true;
  }

  onValue(v) {
    if (v.kind !== 'length') return false;
    if (!this.wallId) return false;
    return this._commit(Math.sign(this.distance || 1) * v.value);
  }

  draw(g, p) {
    if (!this.wallId) return;
    const w = this.model.walls[this.wallId];
    if (!w) return;
    const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len * this.distance, nz = (b.x - a.x) / len * this.distance;
    const y = this.elevation + 0.02;
    g.line(new Vector3(a.x + nx, y, a.z + nz), new Vector3(b.x + nx, y, b.z + nz), COLOR.magenta);
    g.dotted(new Vector3(a.x, y, a.z), new Vector3(a.x + nx, y, a.z + nz), COLOR.magenta);
    void p;
  }
}

// ---------------------------------------------------------------------------

function pick(o) { return { x: o.x, z: o.z, y: o.y ?? 0 }; }

function moveOps(model, t, d, copy) {
  if (t.kind === 'furniture') {
    const f = model.furniture[t.id];
    if (!f) return [];
    if (copy) return [{ t: 'furniture.add', ...f, id: undefined, x: r(f.x + d.x), y: r((f.y ?? 0) + d.y), z: r(f.z + d.z) }];
    return [{ t: 'furniture.move', id: t.id, x: r(f.x + d.x), y: r((f.y ?? 0) + d.y), z: r(f.z + d.z) }];
  }
  if (t.kind === 'text') {
    const x = model.texts[t.id];
    if (!x) return [];
    if (copy) return [{ t: 'text.add', ...x, id: undefined, x: r(x.x + d.x), y: r(x.y + d.y), z: r(x.z + d.z) }];
    return [{ t: 'text.edit', id: t.id, props: { x: r(x.x + d.x), y: r(x.y + d.y), z: r(x.z + d.z) } }];
  }
  if (t.kind === 'wall') {
    const w = model.walls[t.id];
    if (!w) return [];
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (copy) {
      return [{
        t: 'wall.add', ax: r(a.x + d.x), az: r(a.z + d.z), bx: r(b.x + d.x), bz: r(b.z + d.z),
        wallType: w.type, thickness: w.thickness, levelId: w.levelId,
      }];
    }
    return [{ t: 'wall.move', id: t.id, dx: r(d.x), dz: r(d.z) }];
  }
  return [];
}

function rotateOps(model, t, centre, rad, copy) {
  const rot = (x, z) => {
    const dx = x - centre.x, dz = z - centre.z;
    const c = Math.cos(rad), s = Math.sin(rad);
    return { x: r(centre.x + dx * c - dz * s), z: r(centre.z + dx * s + dz * c) };
  };
  if (t.kind === 'furniture') {
    const f = model.furniture[t.id];
    if (!f) return [];
    const p = rot(f.x, f.z);
    if (copy) return [{ t: 'furniture.add', ...f, id: undefined, x: p.x, z: p.z, rot: (f.rot || 0) + rad }];
    return [
      { t: 'furniture.move', id: t.id, x: p.x, z: p.z, rot: (f.rot || 0) + rad },
    ];
  }
  if (t.kind === 'text') {
    const x = model.texts[t.id];
    if (!x) return [];
    const p = rot(x.x, x.z);
    return [{ t: 'text.edit', id: t.id, props: { x: p.x, z: p.z, rot: (x.rot || 0) + rad } }];
  }
  if (t.kind === 'wall') {
    const w = model.walls[t.id];
    if (!w) return [];
    const a = rot(model.nodes[w.a].x, model.nodes[w.a].z);
    const b = rot(model.nodes[w.b].x, model.nodes[w.b].z);
    return [{ t: 'wall.moveNodes', id: t.id, a, b }];
  }
  return [];
}

function angleOf(c, p) { return Math.atan2(p.z - c.z, p.x - c.x); }
const r = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
