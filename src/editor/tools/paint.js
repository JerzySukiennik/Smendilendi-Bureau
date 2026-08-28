// tools/paint.js — Paint Bucket and Eraser.
//
// CLICK COUNT for changing a face's material, against SketchUp's 3:
//   B -> click a swatch in the Materials panel -> click the face  = 3 decisions
// (B opens the Materials tab itself, which is what makes that count true)
//   B -> Alt+click a face you like (sample) -> click the target   = 3 decisions
//
// SketchUp's modifier grammar, kept verbatim:
//   Alt          sample the material under the cursor
//   Ctrl         all connected (the whole wall run)
//   Shift        all matching (replace that material everywhere in the model)
// And, because materials are money here, every stroke prints what it did to the
// budget: "brick to 6 faces  +14 400".

import { Tool } from './base.js';
import { COLOR } from '../constants.js';
import { materialPrice, tryEntry } from '../../model/catalog.js';
import { wallLength } from '../../model/building.js';

export class PaintTool extends Tool {
  static id = 'paint';
  static toolName = 'Paint Bucket';
  static valueLabel = '';
  static valueMode = 'length';
  static hint = 'Click a face to paint it. Alt samples, Ctrl paints the whole run, '
    + 'Shift replaces that material everywhere. Furniture takes a colour instead.';

  constructor(ed) {
    super(ed);
    this.material = 'plaster';
    this.color = null;              // furniture tint, chosen in the panel
  }

  /**
   * Arming the bucket brings the palette up. Without this the count above is a
   * lie: B leaves the Catalogue tab showing, so the swatch you are told to
   * click next is not on screen and the path costs a fourth decision to find
   * it. A tool that needs a panel opens that panel.
   */
  activate() {
    this.ed.hud?.showTab('materials');
  }

  setMaterial(id) { this.material = id; this.flash(`${id} — ${materialPrice(id)} / m²`); }
  setColor(hex) { this.color = hex; }

  onMove(p) {
    const hit = this.ed.pickAny(p.ndc);
    this.ed.hover = hit ? { kind: 'any', id: hit.entityId } : null;
    this._hit = hit;
    if (hit && this.model.walls[hit.entityId]) {
      const side = this._sideOf(hit);
      this.setDisplay(`${this.material} · ${side} face · ${materialPrice(this.material)} / m²`);
    } else if (hit && this.model.furniture[hit.entityId]) {
      const e = tryEntry(this.model.furniture[hit.entityId].catalogId);
      this.setDisplay(e ? `${e.name} · colour` : '');
    } else {
      this.setDisplay(`${this.material} · ${materialPrice(this.material)} / m²`);
    }
  }

  /** Which face of the wall the ray hit: the inner one or the outer one. */
  _sideOf(hit) {
    const w = this.model.walls[hit.entityId];
    if (!w || !hit.face) return 'inner';
    const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    const n = hit.face.normal;
    return (n.x * nx + n.z * nz) >= 0 ? 'inner' : 'outer';
  }

  onUp(p, info) {
    if (info?.dragged) return;
    const input = this.ed.ctx?.input;
    const hit = this.ed.pickAny(p.ndc);
    if (!hit) return;

    // Alt = sample
    if (input?.alt) {
      const w = this.model.walls[hit.entityId];
      if (w) { this.material = this._sideOf(hit) === 'inner' ? w.matInner : w.matOuter; this.flash(`Sampled ${this.material}`); this.ed.hud?.refreshMaterials(); }
      const s = this.model.slabs[hit.entityId];
      if (s) { this.material = s.mat; this.flash(`Sampled ${this.material}`); this.ed.hud?.refreshMaterials(); }
      return;
    }

    const f = this.model.furniture[hit.entityId];
    if (f) {
      if (this.color == null) { this.flash('Pick a colour in the panel first'); return; }
      this.apply({ t: 'furniture.setColor', id: hit.entityId, color: this.color });
      return;
    }

    const slab = this.model.slabs[hit.entityId];
    if (slab) {
      this.apply({ t: 'slab.setMaterial', id: hit.entityId, mat: this.material });
      this.flash(`${this.material} floor · ${materialPrice(this.material)} / m²`);
      return;
    }

    const w = this.model.walls[hit.entityId];
    if (!w) return;
    const side = this._sideOf(hit);
    const key = side === 'inner' ? 'matInner' : 'matOuter';
    let ids = [hit.entityId];
    if (input?.shift) ids = this._allMatching(w[key], key);
    else if (input?.ctrl) ids = this._run(w.id);
    const before = this._cost(ids, key);
    this.ed.applyMany(ids.map(id => ({ t: 'wall.setProps', id, props: { [key]: this.material } })));
    const after = this._cost(ids, key, this.material);
    const delta = after - before;
    this.flash(`${this.material} to ${ids.length} face${ids.length > 1 ? 's' : ''}  ${delta >= 0 ? '+' : ''}${Math.round(delta)}`);
  }

  _cost(ids, key, override = null) {
    let sum = 0;
    for (const id of ids) {
      const w = this.model.walls[id];
      if (!w) continue;
      const area = wallLength(this.model, w) * this.ed.storeyHeight;
      sum += area * materialPrice(override || w[key]);
    }
    return sum;
  }

  _run(startId) {
    const m = this.model;
    const out = new Set([startId]);
    const q = [startId];
    while (q.length) {
      const w = m.walls[q.pop()];
      if (!w) continue;
      for (const other in m.walls) {
        if (out.has(other)) continue;
        const o = m.walls[other];
        if (o.levelId !== w.levelId) continue;
        if (o.a === w.a || o.a === w.b || o.b === w.a || o.b === w.b) { out.add(other); q.push(other); }
      }
    }
    return [...out];
  }

  _allMatching(mat, key) {
    const out = [];
    for (const id in this.model.walls) if (this.model.walls[id][key] === mat) out.push(id);
    return out;
  }

  draw(g, p) {
    void g; void p;
  }
}

// ---------------------------------------------------------------------------

export class EraserTool extends Tool {
  static id = 'erase';
  static toolName = 'Eraser';
  static valueLabel = '';
  static valueMode = 'length';
  static hint = 'Click or drag over things to delete them. Setting-out lines are erased too.';

  constructor(ed) {
    super(ed);
    this.marked = new Set();
  }

  cancel() {
    if (!this.marked.size) return false;
    this.marked.clear();
    return true;
  }

  onMove(p) {
    const hit = this.ed.pickAny(p.ndc);
    this.ed.hover = hit ? { kind: 'any', id: hit.entityId } : null;
    // dragging with the button down marks everything it touches, like SketchUp
    if (this.ed._down && hit) this.marked.add(hit.entityId);
    this.setDisplay(this.marked.size ? `${this.marked.size} marked` : '');
  }

  onUp(p, info) {
    const ids = new Set(this.marked);
    this.marked.clear();
    if (!info?.dragged) {
      const hit = this.ed.pickAny(p.ndc);
      if (hit) ids.add(hit.entityId);
      else this._eraseGuideNear(p);
    }
    if (!ids.size) return;
    const ops = [];
    for (const id of ids) {
      if (this.model.walls[id]) ops.push({ t: 'wall.delete', id });
      else if (this.model.openings[id]) ops.push({ t: 'opening.delete', id });
      else if (this.model.furniture[id]) ops.push({ t: 'furniture.delete', id });
      else if (this.model.texts[id]) ops.push({ t: 'text.delete', id });
      else if (this.model.slabs[id]) ops.push({ t: 'slab.delete', id });
    }
    if (ops.length) {
      this.ed.applyMany(ops);
      this.flash(`Deleted ${ops.length}`);
    }
  }

  _eraseGuideNear(p) {
    const tol = this.ed.cameras.metresPerPixel(p.snap.point) * 10;
    const idx = this.ed.guides.findIndex(gd => distToSeg(p.snap.point, gd.a, gd.b) < tol);
    if (idx >= 0) { this.ed.guides.splice(idx, 1); this.flash('Setting-out line erased'); }
  }

  draw(g) {
    for (const id of this.marked) {
      const w = this.model.walls[id];
      if (w) this.ed._outlineWall(g, w, COLOR.axisZ);
    }
  }
}

function distToSeg(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
