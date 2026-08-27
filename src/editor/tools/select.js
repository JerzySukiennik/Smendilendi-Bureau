// tools/select.js — Select.
//
// Ctrl adds, Shift adds/subtracts, Ctrl+Shift subtracts — SketchUp's grammar,
// unchanged. A double-click on a wall selects the whole connected run, which is
// how you paint or delete an elevation in one gesture.

import { Tool } from './base.js';
import { formatArea, formatLength } from '../measure.js';
import { tryEntry } from '../../model/catalog.js';

export class SelectTool extends Tool {
  static id = 'select';
  static toolName = 'Select';
  static valueLabel = '';
  static valueMode = 'length';
  static hint = 'Click to select. Ctrl adds, Shift adds/subtracts, Ctrl+Shift subtracts. '
    + 'Double-click a wall for the whole run. Delete removes the selection.';

  onMove(p) {
    const hit = this.ed.pickAny(p.ndc);
    this.ed.hover = hit ? { kind: 'any', id: hit.entityId } : null;
    this.setDisplay(hit ? this._describe(hit.entityId) : '');
  }

  onUp(p, info) {
    if (info?.dragged) return;
    const hit = this.ed.pickAny(p.ndc);
    const input = this.ed.ctx?.input;
    const ctrl = !!input?.ctrl, shift = !!input?.shift;
    if (!hit) { if (!ctrl && !shift) this.ed.clearSelection(); return; }
    if (ctrl && shift) { this.ed.selection.delete(hit.entityId); this.ed.hud?.refreshSelection(); return; }
    if (ctrl) { this.ed.select([hit.entityId], { add: true }); return; }
    if (shift) { this.ed.toggleSelect(hit.entityId); return; }
    this.ed.select([hit.entityId]);
  }

  onDoubleClick(p) {
    const hit = this.ed.pickShell(p.ndc);
    if (!hit) return;
    const w = this.model.walls[hit.entityId];
    if (!w) return;
    this.ed.select(connectedRun(this.model, w.id));
    this.flash(`${this.ed.selection.size} walls in the run`);
  }

  /** Entity Info in one line: the numbers that are consequences, never editable. */
  _describe(id) {
    const m = this.model;
    if (m.walls[id]) {
      const w = m.walls[id];
      const a = m.nodes[w.a], b = m.nodes[w.b];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      return `Wall · ${formatLength(len)} · ${Math.round(w.thickness * 1000)} mm ${w.type}`;
    }
    if (m.openings[id]) {
      const o = m.openings[id];
      return `${cap(o.kind)} · ${Math.round(o.width * 1000)} × ${Math.round(o.height * 1000)} mm`
        + (o.sill ? ` · sill ${Math.round(o.sill * 1000)} mm` : '');
    }
    if (m.furniture[id]) {
      const f = m.furniture[id];
      const e = tryEntry(f.catalogId);
      if (!e) return 'Object';
      return `${e.name} · ${(e.size[0] * (f.sx ?? 1)).toFixed(2)} × ${(e.size[2] * (f.sz ?? 1)).toFixed(2)} m · ${e.price}`;
    }
    if (m.texts[id]) return `Text · "${m.texts[id].value}" · cap ${Math.round(m.texts[id].size * 1000)} mm`;
    if (m.slabs[id]) return `Slab · ${cap(m.slabs[id].kind)}`;
    const r = this.ed.rooms().rooms[id];
    if (r) return `${r.name} · ${formatArea(r.area)}`;
    return '';
  }
}

/** Every wall reachable from this one through shared nodes. */
function connectedRun(model, startId) {
  const out = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.pop();
    const w = model.walls[id];
    if (!w) continue;
    for (const other in model.walls) {
      if (out.has(other)) continue;
      const o = model.walls[other];
      if (o.levelId !== w.levelId) continue;
      if (o.a === w.a || o.a === w.b || o.b === w.a || o.b === w.b) { out.add(other); queue.push(other); }
    }
  }
  return [...out];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
