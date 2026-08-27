// catalogue-panel.js — browse the 122 catalogue entries and place them.
//
// Every row shows the three things an architect needs to decide with: the name,
// the REAL metric size (width x depth x height, in that order, in millimetres —
// the way a schedule is written), and the price. Click a row to arm the Place
// tool, or drag the row onto the model and drop it where it goes.

import { CATEGORIES, byCategory, allEntries } from '../model/catalog.js';

const CATEGORY_LABEL = {
  seating: 'Seating', tables: 'Tables', storage: 'Storage', beds: 'Beds',
  sanitary: 'Sanitary', kitchen: 'Kitchen', doors: 'Doors', windows: 'Windows',
  lighting: 'Lighting', plants: 'Planting', office: 'Office', retail: 'Retail',
  education: 'Education', clinic: 'Clinic', misc: 'Miscellaneous',
};

export class CataloguePanel {
  constructor(editor, root) {
    this.ed = editor;
    this.root = root;
    this.category = 'all';
    this.query = '';
    this.selected = null;
    this._build();
  }

  _build() {
    this.root.innerHTML = '';
    const search = el('input', 'cat-search');
    search.placeholder = `Search ${allEntries().length} components…`;
    search.addEventListener('input', () => { this.query = search.value.toLowerCase(); this.renderList(); });
    // Typing in here must not reach the editor's keyboard sink.
    search.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.appendChild(search);

    const cats = el('div', 'cat-cats');
    const mk = (id, label) => {
      const b = el('button');
      b.textContent = label;
      b.dataset.cat = id;
      b.addEventListener('click', () => { this.category = id; this.renderCats(); this.renderList(); });
      cats.appendChild(b);
    };
    mk('all', 'All');
    for (const c of CATEGORIES) mk(c, CATEGORY_LABEL[c] || c);
    this.cats = cats;
    this.root.appendChild(cats);

    this.list = el('div', 'cat-list');
    this.root.appendChild(this.list);

    this.renderCats();
    this.renderList();
  }

  renderCats() {
    for (const b of this.cats.children) b.classList.toggle('on', b.dataset.cat === this.category);
  }

  entries() {
    let list = this.category === 'all' ? allEntries() : byCategory(this.category);
    if (this.query) {
      list = list.filter(e => e.name.toLowerCase().includes(this.query)
        || e.id.includes(this.query)
        || e.tags.some(t => t.includes(this.query)));
    }
    return list;
  }

  renderList() {
    this.list.innerHTML = '';
    const list = this.entries();
    for (const e of list) {
      const b = el('button', 'cat-item');
      b.draggable = true;
      b.dataset.id = e.id;
      const nm = el('span', 'nm'); nm.textContent = e.name;
      const pr = el('span', 'pr'); pr.textContent = e.price.toLocaleString('en-GB').replace(/,/g, ' ');
      const dim = el('span', 'dim');
      // w x d x h in millimetres — a schedule reads plan dimensions first
      dim.textContent = `${mm(e.size[0])} × ${mm(e.size[2])} × ${mm(e.size[1])} mm`
        + (e.seatHeight ? ` · seat ${mm(e.seatHeight)}` : '')
        + (e.workHeight ? ` · work ${mm(e.workHeight)}` : '')
        + (e.anchor !== 'floor' ? ` · ${e.anchor}` : '');
      b.append(nm, pr, dim);
      b.title = e.note || e.name;
      b.addEventListener('click', () => this.pick(e.id));
      b.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', e.id);
        ev.dataTransfer.effectAllowed = 'copy';
        this.pick(e.id, { silent: true });
      });
      if (e.id === this.selected) b.classList.add('on');
      this.list.appendChild(b);
    }
    if (!list.length) {
      const d = el('div', 'ed-h');
      d.textContent = 'nothing matches';
      this.list.appendChild(d);
    }
  }

  pick(id, { silent = false } = {}) {
    this.selected = id;
    const tool = this.ed.setTool('place', { catalogId: id });
    tool?.setComponent?.(id);
    for (const b of this.list.children) b.classList?.toggle('on', b.dataset?.id === id);
    if (!silent) this.ed.hud?.refreshTool();
  }
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}
const mm = (m) => Math.round(m * 1000);
