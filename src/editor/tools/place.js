// tools/place.js — placing catalogue objects, and 3D Text.
//
// The ghost is the real object at its real metric size, so you see a 1600 x 800
// desk fitting or not fitting BEFORE you commit. Wall-anchored items (basins,
// wall units, radiators) snap flat to the wall face under the cursor and take
// its rotation; floor items snap to the plan grid and to other objects' faces.
//
// The Measurements box takes an ANGLE while placing (type 90, Enter) and, after
// placing, still takes one — the object just placed rotates.

import { Vector3 } from 'three';
import { Tool } from './base.js';
import { COLOR } from '../constants.js';
import { tryEntry } from '../../model/catalog.js';
import { baseHeight } from '../furniture.js';
import { backsOntoWall, snapAgainstWall } from '../snapping.js';

export class PlaceTool extends Tool {
  static id = 'place';
  static toolName = 'Place';
  static valueLabel = 'Rotation';
  static valueMode = 'angle';
  static hint = 'Pick a component in the catalogue, then click to place it. Things that '
    + 'belong against a wall find one by themselves — hold Shift to place free. '
    + 'R turns it 15°, Alt+R a right angle, Ctrl keeps placing copies.';

  constructor(ed) {
    super(ed);
    this.catalogId = null;
    this.rot = 0;
    this.pos = new Vector3();
    this.valid = false;
    this.last = null;
    this.wallAligned = false;
  }

  activate(params = {}) {
    if (params.catalogId) this.catalogId = params.catalogId;
    this.ed.hud?.showTab('catalogue');
    if (!this.catalogId) this.flash('Pick a component in the catalogue');
  }

  setComponent(id) {
    this.catalogId = id;
    const e = tryEntry(id);
    if (e) this.flash(`${e.name} — ${(e.size[0]).toFixed(2)} × ${(e.size[2]).toFixed(2)} × ${(e.size[1]).toFixed(2)} m · ${e.price}`);
  }

  cancel() {
    if (!this.catalogId && !this.last) return false;
    this.last = null;
    return true;
  }

  onKey(e) {
    if (e.code === 'BracketLeft') { this.rot -= Math.PI / 12; return true; }
    if (e.code === 'BracketRight') { this.rot += Math.PI / 12; return true; }
    return false;
  }

  onMove(p) {
    const entry = tryEntry(this.catalogId);
    if (!entry) { this.valid = false; this.setDisplay(''); return; }
    this.wallAligned = false;
    if (entry.anchor === 'wall') {
      const face = this.ed.pickWallFace(p.ndc);
      if (face) {
        const a = this.model.nodes[face.wall.a], b = this.model.nodes[face.wall.b];
        const len = face.length || 1;
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        const nx = -dz, nz = dx;
        const side = Math.sign((p.snap.point.x - a.x) * nx + (p.snap.point.z - a.z) * nz) || 1;
        const off = face.wall.thickness / 2 + entry.size[2] / 2;
        this.pos.set(a.x + dx * face.offset + nx * off * side, 0, a.z + dz * face.offset + nz * off * side);
        this.rot = Math.atan2(nx * side, nz * side);
        this.wallAligned = true;
      } else {
        this.pos.copy(p.snap.point);
      }
    } else if (backsOntoWall(entry) && !this.ed.ctx?.input?.shift) {
      // FLOOR PIECES THAT BELONG AGAINST A WALL FIND ONE BY THEMSELVES, at any
      // wall angle — the wall is a segment and this is plan geometry, so 37
      // degrees behaves exactly like 90. Shift places free.
      const hit = snapAgainstWall(this.model, this.ed.levelId, p.snap.point, entry);
      if (hit) {
        this.pos.set(hit.x, 0, hit.z);
        this.rot = hit.rot;
        this.wallAligned = true;
      } else {
        this.pos.copy(p.snap.point);
      }
    } else {
      this.pos.copy(p.snap.point);
    }
    this.valid = true;
    this.setDisplay(`${entry.name} · ${(this.rot * 180 / Math.PI).toFixed(0)}°${this.wallAligned ? ' · on wall' : ''}`);
  }

  onUp(p, info) {
    if (info?.dragged || !this.valid) return;
    const entry = tryEntry(this.catalogId);
    if (!entry) return;
    const op = this.apply({
      t: 'furniture.add',
      levelId: this.ed.levelId,
      catalogId: this.catalogId,
      x: r(this.pos.x), z: r(this.pos.z), y: 0,
      rot: r(this.rot),
      sx: 1, sy: 1, sz: 1,
      color: null,
    });
    if (op) {
      this.last = { id: op.id };
      this.ed.select([op.id]);
      this.flash(`${entry.name} placed · ${entry.price}`);
    }
    if (!this.ed.ctx?.input?.ctrl) {
      // one placement per pick unless Ctrl is held, so a stray click cannot
      // carpet the plan with wardrobes
      this.valid = true;
    }
    void p;
  }

  onValue(v) {
    if (v.kind === 'angle') {
      this.rot = v.deg * Math.PI / 180;
      if (this.last) {
        this.apply({ t: 'furniture.move', id: this.last.id, rot: r(this.rot) });
        this.flash(`Rotated to ${v.deg.toFixed(1)}°`);
      }
      return true;
    }
    if (v.kind === 'length' && this.last) {
      // a typed length after placing scales the object to that overall width
      const f = this.model.furniture[this.last.id];
      const e = f ? tryEntry(f.catalogId) : null;
      if (!e) return false;
      const k = v.value / e.size[0];
      this.apply({ t: 'furniture.transform', id: this.last.id, sx: k });
      this.flash(`Width set to ${(v.value).toFixed(3)} m`);
      return true;
    }
    return false;
  }

  draw(g, p) {
    const entry = tryEntry(this.catalogId);
    if (!entry || !this.valid) return;
    const [w, h, d] = entry.size;
    const base = baseHeight(entry, { y: 0 }, this.ed.storeyHeight);
    g.ghostBox(this.pos.x, base + h / 2, this.pos.z, w, h, d, this.rot, COLOR.ghost);
    // the clearance the piece needs, drawn on the floor — a wardrobe whose doors
    // cannot open is a client complaint, so show it before it becomes one
    const c = entry.clearance;
    if (c && (c.front || c.back || c.left || c.right)) {
      const cw = w + (c.left || 0) + (c.right || 0);
      const cd = d + (c.front || 0) + (c.back || 0);
      const shiftZ = ((c.front || 0) - (c.back || 0)) / 2;
      const cx = this.pos.x + Math.sin(this.rot) * shiftZ;
      const cz = this.pos.z + Math.cos(this.rot) * shiftZ;
      g.rect(cx, cz, cw, cd, this.elevation + 0.015, COLOR.magenta, this.rot);
    }
    void p;
  }
}

// ---------------------------------------------------------------------------

export class TextTool extends Tool {
  static id = 'text';
  static toolName = 'Text (3D)';
  static valueLabel = 'Cap height';
  static valueMode = 'length';
  static hint = 'Type the words in the panel, then click a wall or the ground to place them. '
    + 'A typed length sets the cap height; [ ] rotate.';

  constructor(ed) {
    super(ed);
    this.value = 'GZOWO';
    this.size = 0.30;
    this.depth = 0.03;
    this.color = '#2b2825';
    this.font = 'signage';
    this.rot = 0;
    this.pos = new Vector3();
    this.last = null;
  }

  setValue(v) { this.value = String(v || '').slice(0, 40) || 'TEXT'; }

  onKey(e) {
    if (e.code === 'BracketLeft') { this.rot -= Math.PI / 12; return true; }
    if (e.code === 'BracketRight') { this.rot += Math.PI / 12; return true; }
    return false;
  }

  onMove(p) {
    const face = this.ed.pickWallFace(p.ndc);
    if (face) {
      const a = this.model.nodes[face.wall.a], b = this.model.nodes[face.wall.b];
      const len = face.length || 1;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const nx = -dz, nz = dx;
      const side = Math.sign((face.point.x - a.x) * nx + (face.point.z - a.z) * nz) || 1;
      const off = face.wall.thickness / 2 + 0.005;
      this.pos.set(a.x + dx * face.offset + nx * off * side, face.point.y, a.z + dz * face.offset + nz * off * side);
      this.rot = Math.atan2(nx * side, nz * side);
    } else {
      this.pos.copy(p.snap.point);
      this.pos.y = this.elevation + 0.01;
    }
    this.setDisplay(`"${this.value}" · cap ${Math.round(this.size * 1000)} mm`);
  }

  onUp(p, info) {
    if (info?.dragged) return;
    const op = this.apply({
      t: 'text.add',
      levelId: this.ed.levelId,
      value: this.value,
      font: this.font,
      x: r(this.pos.x), y: r(this.pos.y), z: r(this.pos.z),
      rot: r(this.rot),
      size: this.size,
      depth: this.depth,
      color: this.color,
    });
    if (op) { this.last = { id: op.id }; this.ed.select([op.id]); this.flash(`"${this.value}" placed`); }
    void p;
  }

  onValue(v) {
    if (v.kind !== 'length' || !(v.value > 0)) return false;
    this.size = Math.min(3, v.value);
    if (this.last) {
      this.apply({ t: 'text.edit', id: this.last.id, props: { size: this.size } });
      this.flash(`Cap height ${Math.round(this.size * 1000)} mm`);
    }
    return true;
  }

  draw(g) {
    const w = this.value.length * this.size * 0.72;
    g.rect(this.pos.x, this.pos.z, w, this.size * 0.2, this.pos.y, COLOR.ghost, this.rot);
  }
}

const r = (v) => Math.round(v * 10000) / 10000;
