// materials-panel.js — the paint palette.
//
// Surfaces take a MATERIAL (plaster, brick, timber, tile, concrete, terrazzo...)
// and furniture takes a COLOUR, which is the distinction DESIGN-DECISIONS.md
// draws and the one the cost engine cares about: a material has a rate per
// square metre and changes the budget, a tint does not.
//
// Every swatch carries its rate, and picking one arms the Paint Bucket — so
// changing a face's material is: B, click swatch, click face. Three decisions.

import { MATERIAL_CLASSES, FURNITURE_TINTS, materialCost } from '../core/palette.js';
import { MATERIAL_PRICES, materialPrice } from '../model/catalog.js';
import { formatMoney } from './measure.js';

const WALL_FINISHES = ['plaster', 'paint', 'brick', 'stone', 'concrete', 'polishedConcrete', 'tile', 'wood', 'render', 'metal', 'glass', 'terrazzo'];
const FLOOR_FINISHES = ['screed', 'timberFloor', 'tileFloor', 'vinyl', 'carpet', 'terrazzo', 'polishedConcrete'];
const GROUND_FINISHES = ['grass', 'paving', 'gravel', 'asphalt', 'decking'];

export class MaterialsPanel {
  constructor(editor, root) {
    this.ed = editor;
    this.root = root;
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    this._section('Walls and facades', WALL_FINISHES);
    this._section('Floors', FLOOR_FINISHES);
    this._section('External ground', GROUND_FINISHES);

    const h = document.createElement('div');
    h.className = 'ed-h';
    h.textContent = 'Furniture colour';
    this.root.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'mat-grid';
    FURNITURE_TINTS.forEach((hex, i) => {
      const b = document.createElement('button');
      b.className = 'mat-sw';
      b.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      b.title = `tint ${i}`;
      b.addEventListener('click', () => {
        const tool = this.ed.setTool('paint');
        tool.setColor(hex);
        this._mark(b, 'tint');
        this.ed.hud?.flash('Colour armed — click a piece of furniture');
      });
      b.dataset.group = 'tint';
      grid.appendChild(b);
    });
    this.root.appendChild(grid);

    this.info = document.createElement('div');
    this.info.style.marginTop = '10px';
    this.root.appendChild(this.info);
    this.refresh();
  }

  _section(title, ids) {
    const h = document.createElement('div');
    h.className = 'ed-h';
    h.textContent = title;
    this.root.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'mat-grid';
    for (const id of ids) {
      const spec = MATERIAL_CLASSES[id];
      const b = document.createElement('button');
      b.className = 'mat-sw';
      b.dataset.mat = id;
      b.dataset.group = 'mat';
      b.style.background = spec ? `#${spec.color.toString(16).padStart(6, '0')}` : '#888';
      const s = document.createElement('span');
      s.textContent = id;
      b.appendChild(s);
      b.title = `${id} — ${materialPrice(id)} per m²`;
      b.addEventListener('click', () => {
        const tool = this.ed.setTool('paint');
        tool.setMaterial(id);
        this._mark(b, 'mat');
        this.refresh();
      });
      grid.appendChild(b);
    }
    this.root.appendChild(grid);
  }

  _mark(btn, group) {
    for (const b of this.root.querySelectorAll(`.mat-sw[data-group="${group}"]`)) b.classList.remove('on');
    btn.classList.add('on');
  }

  /** Show the rate of whatever is armed, and what the selection is finished in. */
  refresh() {
    const tool = this.ed.tools.get('paint');
    const mat = tool?.material || 'plaster';
    const rows = [[`Armed: ${mat}`, `${formatMoney(materialPrice(mat))} / m²`]];
    for (const id of this.ed.selection) {
      const w = this.ed.model.walls[id];
      if (!w) continue;
      rows.push([`${id} inner`, `${w.matInner} · ${formatMoney(materialPrice(w.matInner))} / m²`]);
      rows.push([`${id} outer`, `${w.matOuter} · ${formatMoney(materialPrice(w.matOuter))} / m²`]);
      break;
    }
    this.info.innerHTML = '';
    for (const [a, b] of rows) {
      const r = document.createElement('div');
      r.className = 'mat-row';
      const l = document.createElement('span'); l.textContent = a;
      const v = document.createElement('b'); v.textContent = b;
      r.append(l, v);
      this.info.appendChild(r);
    }
  }
}

export { MATERIAL_PRICES, materialCost };
