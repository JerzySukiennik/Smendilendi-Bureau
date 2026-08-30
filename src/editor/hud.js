// hud.js — every pixel of the editor that is not 3D.
//
// The layout is SketchUp's, because that is where an architect's eyes already
// go (reference/sketchup/sketchup-01.png): the tool palette down the left, the
// status/hint line along the bottom left, and THE MEASUREMENTS BOX IN THE BOTTOM
// RIGHT CORNER. The box is never focusable and has no cursor of its own — it
// mirrors measure.js, which is a keyboard sink, not a form field.
//
// The right-hand dock carries the four things the client will judge: the
// catalogue, the materials, the room schedule with live clear areas, and the
// validation panel that runs src/analysis on demand and highlights what it
// complains about in 3D.

import { TOOL_GROUPS, TOOL_KEYS } from './tools/index.js';
import { CataloguePanel } from './catalogue-panel.js';
import { MaterialsPanel } from './materials-panel.js';
import { formatArea, formatMoney, formatMetres } from './measure.js';

/** Type sizes the Measurements value steps down through to stay on one line. */
const VALUE_SIZES = [17, 15, 13, 11];

const VIEWS = [
  { id: 'orbit', label: '3D', key: 'F3' },
  { id: 'plan', label: 'Plan', key: 'F2' },
  { id: 'walk', label: 'Eye level', key: 'F4' },
];

export class EditorHUD {
  constructor(editor, uiRoot) {
    this.ed = editor;
    this.root = document.createElement('div');
    // 'passthrough' is NOT decoration. #ui > * { pointer-events: auto } in
    // src/style.css carries an id and out-specifies `.ed-root { pointer-events:
    // none }` in editor.css, so a bare 'ed-root' turns this full-screen layer
    // into a sheet of glass over the canvas: no orbit, no zoom, no drawing, no
    // clicking a face — the whole 3D viewport goes dead to the mouse while the
    // panels on top of it keep working, which is exactly the trap style.css
    // documents at line 59. The shell's escape hatch is by CLASS, so a mode
    // root opts out by wearing it. selftest.pointerReachesCanvas() guards it.
    this.root.className = 'ed-root passthrough';
    uiRoot.appendChild(this.root);
    this._flashUntil = 0;
    this._build();
    this.syncInsets();
    this._onResize = () => this.syncInsets();
    window.addEventListener('resize', this._onResize);
    editor.hud = this;
    this.refreshTool();
    this.refreshSchedule();
    this.refreshCost();
    this.refreshPlayers();
  }

  // -- construction ----------------------------------------------------------

  _build() {
    this._buildTools();
    this._buildTop();
    this._buildDock();
    this._buildStatus();
    this._buildMeasure();
    this._buildCost();

    this.tip = div('ed-tip');
    this.root.appendChild(this.tip);

    this.flashEl = div('ed-flash');
    this.root.appendChild(this.flashEl);

    this.playersEl = div('ed-players');
    this.root.appendChild(this.playersEl);

    this._buildDrop();
  }

  _buildTools() {
    const box = div('ed-tools');
    this.toolButtons = new Map();
    for (const grp of TOOL_GROUPS) {
      const h = div('grp');
      h.textContent = grp.name;
      box.appendChild(h);
      for (const id of grp.ids) {
        const tool = this.ed.tools.get(id);
        if (!tool) continue;
        const b = document.createElement('button');
        b.innerHTML = ICONS[id] || ICONS.default;
        b.title = `${tool.name}${TOOL_KEYS[id] ? ` (${TOOL_KEYS[id]})` : ''}`;
        b.addEventListener('click', () => this.ed.setTool(id));
        box.appendChild(b);
        this.toolButtons.set(id, b);
      }
    }
    this.root.appendChild(box);
  }

  _buildTop() {
    const bar = div('ed-top');
    this.viewButtons = new Map();
    for (const v of VIEWS) {
      const b = document.createElement('button');
      b.textContent = v.label;
      b.title = `${v.label} view (${v.key})`;
      b.addEventListener('click', () => this.ed.setView(v.id));
      bar.appendChild(b);
      this.viewButtons.set(v.id, b);
    }
    bar.appendChild(div('sep'));

    this.undoBtn = button('Undo', () => this.ed.undo(), 'Ctrl+Z');
    this.redoBtn = button('Redo', () => this.ed.redo(), 'Ctrl+Shift+Z');
    bar.append(this.undoBtn, this.redoBtn);
    bar.appendChild(div('sep'));
    bar.appendChild(button('Zoom extents', () => this.ed.cameras.zoomExtents(this.ed.contentBounds()), 'Shift+Z'));
    bar.appendChild(button('Check design', () => { this.ed.validate(); this.showTab('validate'); }));

    // The two ways out of the editor. Both are hidden until the game loop
    // (src/core/loop.js) installs its handlers, so src/editor/dev.html — where
    // there is no office to go back to and no client to submit to — is
    // unchanged. refreshSubmit() is the loop's hook for relabelling the button
    // on the revision round.
    bar.appendChild(div('sep'));
    this.backBtn = button('Back to desk', () => this.ed.leaveToOffice(), 'Leave the editor');
    this.submitBtn = button('Submit to client', () => this.ed.submit(), 'Hand the drawings over');
    this.submitBtn.classList.add('primary');
    bar.append(this.backBtn, this.submitBtn);
    this.refreshSubmit();
    this.root.appendChild(bar);
  }

  /** Show the loop's buttons once it has something for them to do. */
  refreshSubmit() {
    if (!this.submitBtn) return;
    this.submitBtn.style.display = this.ed.onSubmit ? '' : 'none';
    this.submitBtn.textContent = this.ed.submitLabel || 'Submit to client';
    if (this.backBtn) this.backBtn.style.display = this.ed.onLeave ? '' : 'none';
  }

  _buildDock() {
    const dock = div('ed-dock');
    const tabs = div('tabs');
    const body = div('body');
    this.panes = new Map();
    this.tabs = new Map();
    const add = (id, label) => {
      const t = document.createElement('button');
      t.textContent = label;
      t.addEventListener('click', () => this.showTab(id));
      tabs.appendChild(t);
      const p = div('ed-pane');
      body.appendChild(p);
      this.tabs.set(id, t);
      this.panes.set(id, p);
      return p;
    };
    const cat = add('catalogue', 'Catalogue');
    const mat = add('materials', 'Materials');
    const sched = add('schedule', 'Rooms');
    const val = add('validate', 'Check');

    dock.append(tabs, body, this._buildLayers());
    this.root.appendChild(dock);

    this.catalogue = new CataloguePanel(this.ed, cat);
    this.materials = new MaterialsPanel(this.ed, mat);
    this.schedulePane = sched;
    this.validatePane = val;
    this._buildValidate();
    this.showTab('catalogue');
  }

  /**
   * TAGS — the row that gets the site out of the way.
   *
   * The reference keeps its Tag list in the inspector and a SketchUp user
   * reaches for it the moment something he cannot edit is standing in front of
   * something he can. Here that is not a corner case: on a real plot the
   * neighbours' volumes and the trees fill a third of the frame at a normal
   * working orbit, and Section Plane slices rather than hides. So the switches
   * live at the foot of the dock, always visible, one click each — no menu, no
   * dialog. Each one carries the count of what it holds, because "Neighbours"
   * on an empty plot ought to say 0 rather than pretend.
   */
  _buildLayers() {
    const row = div('ed-layers');
    const h = document.createElement('span');
    h.className = 'lbl';
    h.textContent = 'Show';
    row.appendChild(h);
    this.layerButtons = new Map();
    const items = [
      ['site', 'Site'],
      ['neighbours', 'Neighbours'],
      ['trees', 'Trees'],
      ['furniture', 'Furniture'],
      ['text', 'Text'],
    ];
    for (const [id, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = `Show or hide ${label.toLowerCase()}`;
      b.addEventListener('click', () => {
        const on = this.ed.toggleLayer(id);
        this.flash(`${label} ${on ? 'shown' : 'hidden'}`);
      });
      row.appendChild(b);
      this.layerButtons.set(id, b);
    }
    this.layersRow = row;
    queueMicrotask(() => this.refreshLayers());
    return row;
  }

  refreshLayers() {
    if (!this.layerButtons) return;
    for (const [id, b] of this.layerButtons) b.classList.toggle('off', !this.ed.layers[id]);
  }

  _buildValidate() {
    const p = this.validatePane;
    p.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'ed-btn';
    b.textContent = 'Run the checks';
    b.addEventListener('click', () => this.ed.validate());
    p.appendChild(b);
    this.validateBody = div();
    p.appendChild(this.validateBody);
    this.refreshValidation();
  }

  _buildStatus() {
    const s = div('ed-status');
    this.toolName = document.createElement('span');
    this.toolName.className = 'tool';
    this.hintLine = document.createElement('span');
    this.hintLine.className = 'hint';
    s.append(this.toolName, this.hintLine);
    this.root.appendChild(s);
  }

  _buildMeasure() {
    const m = div('ed-measure');
    this.mLabel = div('lbl');
    this.mValue = div('val');
    this.mEcho = div('echo');
    m.append(this.mLabel, this.mValue, this.mEcho);
    this.measureEl = m;
    this.root.appendChild(m);
    this.refreshMeasurements();
  }

  _buildCost() {
    const c = div('ed-cost');
    const row = div('row');
    this.costLabel = document.createElement('span');
    this.costValue = document.createElement('b');
    row.append(this.costLabel, this.costValue);
    const bar = div('bar');
    this.costFill = div('fill');
    bar.appendChild(this.costFill);
    c.append(row, bar);
    this.root.appendChild(c);
  }

  /** Drag a catalogue row onto the model and drop it where it goes. */
  _buildDrop() {
    const canvas = this.ed.canvas;
    this._onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    this._onDrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      if (id) this.ed.dropComponent(id, e.clientX, e.clientY);
    };
    canvas.addEventListener('dragover', this._onDragOver);
    canvas.addEventListener('drop', this._onDrop);
  }

  showTab(id) {
    for (const [k, t] of this.tabs) t.classList.toggle('on', k === id);
    for (const [k, p] of this.panes) p.classList.toggle('on', k === id);
    if (id === 'schedule') this.refreshSchedule();
  }

  // -- refreshers ------------------------------------------------------------

  refreshTool() {
    const t = this.ed.tool;
    if (!t) return;
    for (const [id, b] of this.toolButtons) b.classList.toggle('on', id === t.id);
    for (const [id, b] of this.viewButtons) b.classList.toggle('on', id === this.ed.cameras.mode);
    this.toolName.textContent = `${t.name}${TOOL_KEYS[t.id] ? `  (${TOOL_KEYS[t.id]})` : ''}`;
    this.hintLine.textContent = t.hintLine || t.hint;
    this.mLabel.textContent = t.valueLabel || 'Measurements';
    this.undoBtn.disabled = !this.ed.canUndo;
    this.redoBtn.disabled = !this.ed.canRedo;
  }

  /**
   * The value row is ONE LINE, ALWAYS, and it shrinks rather than spill.
   *
   * The box may never change size — it stands 8 px under the cost bar and a
   * second line pushed its own caption up behind it. But the read-outs that
   * matter most are the long ones: the tape's "6000 mm  Δx 6000 mm  Δy 0 mm
   * Δz 0 mm", the door's "900 × 2050 mm · 2000 mm from end", the bucket's
   * finish and rate. Eliding those instead of wrapping them would trade one
   * unreadable box for another, so the type steps down until the line fits —
   * MEASURED, not guessed from a character count, because the box is 300 px on
   * a wide viewport and 250 px on a narrow one and the mono face is whatever
   * the machine has. The ellipsis stays as the last resort below 11 px.
   */
  refreshMeasurements() {
    const m = this.ed.measurements;
    this.measureEl.classList.toggle('typing', m.typing);
    this.mLabel.textContent = m.label || 'Measurements';
    this.mValue.innerHTML = m.typing
      ? `${escapeHtml(m.text)}<span class="caret">▌</span>`
      : escapeHtml(m.display || '');
    this.mEcho.textContent = m.error || m.echo || '';
    this.mEcho.classList.toggle('err', !!m.error);
    this._fitValue(m.typing ? m.text : (m.display || ''));
  }

  /**
   * Step the value down through the type sizes until it is on one line. Only
   * when the string actually changed, and it stops at the FIRST size that fits,
   * so the common case (a length, at full size) costs one layout read.
   */
  _fitValue(shown) {
    if (shown === this._fittedText) return;
    this._fittedText = shown;
    const el = this.mValue;
    for (const px of VALUE_SIZES) {
      el.style.fontSize = `${px}px`;
      if (el.scrollWidth <= el.clientWidth) return;
    }
  }

  refreshCost() {
    const c = this.ed.cost();
    const budget = this.ed.budget;
    this.costLabel.textContent = budget ? 'Cost against budget' : 'Cost so far';
    this.costValue.textContent = budget
      ? `${formatMoney(c.total)} / ${formatMoney(budget)}`
      : formatMoney(c.total);
    const frac = budget ? c.total / budget : Math.min(1, c.total / 500000);
    this.costFill.style.width = `${Math.min(100, frac * 100).toFixed(1)}%`;
    this.costFill.className = `fill${frac > 1 ? ' over' : frac > 0.9 ? ' warn' : ''}`;
    this.undoBtn.disabled = !this.ed.canUndo;
    this.redoBtn.disabled = !this.ed.canRedo;
  }

  refreshSchedule() {
    if (!this.schedulePane) return;
    if (!this.panes.get('schedule')?.classList.contains('on')) { this._scheduleStale = true; return; }
    this._scheduleStale = false;
    const rooms = this.ed.rooms();
    const labels = this.ed.roomLabels();
    const t = document.createElement('table');
    t.className = 'sched';
    t.innerHTML = '<thead><tr><th>Room</th><th class="n">Area</th><th class="n">D</th><th class="n">W</th></tr></thead>';
    const tb = document.createElement('tbody');
    let total = 0;
    for (const id of rooms.order) {
      const r = rooms.rooms[id];
      total += r.area;
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.className = 'name';
      const known = labels.get(id) || '';
      // r.name is the internal hash ("Room 432") and never belonged on screen.
      // A room the engine cannot classify is shown as unnamed — dim, italic and
      // still one click from a name — rather than given a number that would
      // then be printed on the drawing the client reads.
      name.textContent = known || 'unnamed';
      name.classList.toggle('anon', !known);
      name.title = known ? 'Click to rename' : 'Not named yet — click to name it';
      // Entity Info edits a name in place; so does this. Click the cell, type,
      // Enter. Escape puts it back, and an empty entry hands the room back to
      // whatever the analysis engine calls it.
      name.addEventListener('click', (e) => { e.stopPropagation(); this._editRoomName(name, id); });
      tr.appendChild(name);
      const rest = document.createElement('td');
      rest.className = 'n';
      rest.textContent = r.area.toFixed(2);
      tr.appendChild(rest);
      tr.insertAdjacentHTML('beforeend', `<td class="n">${r.doors.length}</td><td class="n">${r.windows.length}</td>`);
      tr.addEventListener('click', () => { this.ed.select([id]); this.ed.cameras.recentre(this.ed.centreOf(id)); });
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    const tf = document.createElement('tfoot');
    tf.innerHTML = `<tr><td>${rooms.order.length} rooms</td><td class="n">${total.toFixed(2)}</td><td colspan="2"></td></tr>`;
    t.appendChild(tf);
    this.schedulePane.innerHTML = '';
    const h = div('ed-h');
    h.textContent = 'Room schedule — clear internal areas · click a name to rename';
    this.schedulePane.append(h, t);
  }

  _editRoomName(cell, id) {
    if (cell.querySelector('input')) return;
    const was = cell.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ed-rename';
    input.value = this.ed.model.siteMods?.roomNames?.[id] ?? '';
    input.placeholder = was === 'unnamed' ? 'Name this room' : was;
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (keep) => {
      if (done) return;
      done = true;
      if (keep) this.ed.renameRoom(id, input.value);
      this.refreshSchedule();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  refreshValidation() {
    if (!this.validateBody) return;
    const a = this.ed.analysis;
    this.validateBody.innerHTML = '';
    if (!a) {
      const p = div('ed-h');
      p.textContent = 'not run yet';
      this.validateBody.appendChild(p);
      return;
    }
    const head = div('ed-h');
    head.textContent = `score ${a.score} · ${a.issues.length} issue${a.issues.length === 1 ? '' : 's'}`
      + (a.accepted ? ' · would be accepted' : '');
    this.validateBody.appendChild(head);
    for (const issue of a.issues) {
      const d = div(`issue ${issue.severity}`);
      const text = document.createElement('div');
      text.textContent = issue.clientText || issue.code;
      const nums = div('num');
      if (issue.measured != null) {
        nums.textContent = `measured ${round(issue.measured)}${issue.unit ? ' ' + issue.unit : ''}`
          + (issue.required != null ? ` · required ${round(issue.required)}${issue.unit ? ' ' + issue.unit : ''}` : '');
      }
      const code = div('code');
      code.textContent = `${issue.module} · ${issue.code}`;
      d.append(text, nums, code);
      d.addEventListener('click', () => this.ed.focusIssue(issue));
      this.validateBody.appendChild(d);
    }
    if (a.metrics?.cost?.total != null) {
      const m = div('ed-h');
      m.textContent = `cost ${formatMoney(a.metrics.cost.total)}`
        + (a.metrics.cost.budget ? ` of ${formatMoney(a.metrics.cost.budget)}` : '')
        + (a.metrics.cost.costPerM2 ? ` · ${formatMoney(a.metrics.cost.costPerM2)} / m²` : '');
      this.validateBody.appendChild(m);
    }
  }

  refreshSelection() {
    this.materials?.refresh();
  }

  refreshMaterials() { this.materials?.refresh(); }

  refreshPlayers() {
    const me = this.ed.playerId;
    const list = (this.ed.session.players || []);
    this.playersEl.innerHTML = '';
    if (list.length < 2) return;
    for (const p of list) {
      const d = div('p');
      d.style.borderLeftColor = p.color || '#d4763a';
      d.textContent = p.id === me ? `${p.nick} (you)` : p.nick;
      this.playersEl.appendChild(d);
    }
  }

  /** The inference ScreenTip: a small yellow label beside the cursor. */
  setInference(name, color, pixel) {
    if (!name) { this.tip.classList.remove('on'); return; }
    const hex = `#${(color >>> 0).toString(16).padStart(6, '0')}`;
    this.tip.innerHTML = `<i style="background:${hex}"></i>${escapeHtml(name)}`;
    this.tip.style.left = `${pixel.x}px`;
    this.tip.style.top = `${pixel.y}px`;
    this.tip.classList.add('on');
  }

  flash(msg) {
    this.flashEl.textContent = msg;
    this.flashEl.classList.add('on');
    this._flashUntil = performance.now() + 1600;
  }

  tick(dt = 0) {
    this._insetAge = (this._insetAge ?? 1) + dt;
    if (this._insetAge > 0.5) { this._insetAge = 0; this.syncInsets(); }
    if (this._flashUntil && performance.now() > this._flashUntil) {
      this.flashEl.classList.remove('on');
      this._flashUntil = 0;
    }
    if (this._scheduleStale && this.panes.get('schedule')?.classList.contains('on')) this.refreshSchedule();
    const t = this.ed.tool;
    if (t && this.toolName.textContent.indexOf(t.name) !== 0) this.refreshTool();
    if (this._viewWas !== this.ed.cameras.mode) {
      this._viewWas = this.ed.cameras.mode;
      for (const [id, b] of this.viewButtons) b.classList.toggle('on', id === this._viewWas);
    }
  }

  /**
   * Tell the cameras how much of the viewport the HUD is standing on, so Zoom
   * Extents frames the model in the CLEAR rectangle instead of centring it on
   * the canvas and letting the dock eat a third of the drawing. Measured off
   * the real elements, never hard-coded: the dock can be resized by CSS.
   */
  syncInsets() {
    const c = this.ed.canvas.getBoundingClientRect();
    if (!(c.width > 0) || !(c.height > 0)) return;
    const box = (sel) => this.root.querySelector(sel)?.getBoundingClientRect() || null;
    // A panel wider than a third of the viewport is not a panel, it is a div
    // that has not been styled yet — editor.css is appended as a <link> and the
    // first measurement can land before it loads. Ignore those; tick() will ask
    // again in half a second and get the real numbers.
    const w = (r) => (r && r.width > 0 && r.width < c.width * 0.34 ? r.width : 0);
    const h = (r) => (r && r.height > 0 && r.height < c.height * 0.25 ? r.height : 0);
    this.ed.cameras.viewInsets = {
      left: w(box('.ed-tools')) ? w(box('.ed-tools')) + 16 : 0,
      right: w(box('.ed-dock')) ? w(box('.ed-dock')) + 16 : 0,
      top: h(box('.ed-top')) ? h(box('.ed-top')) + 16 : 0,
      bottom: h(box('.ed-measure')) ? h(box('.ed-measure')) + 16 : 0,
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.ed.canvas.removeEventListener('dragover', this._onDragOver);
    this.ed.canvas.removeEventListener('drop', this._onDrop);
    this.root.remove();
  }
}

// ---------------------------------------------------------------------------

function div(cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  return d;
}

function button(label, fn, title) {
  const b = document.createElement('button');
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', fn);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const round = (v) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100) : v);

// 18 x 18 line icons, drawn on the same 2 px grid so the palette reads as one set.
const S = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
const wrap = (body) => `<svg viewBox="0 0 18 18" ${S}>${body}</svg>`;
const ICONS = {
  default: wrap('<rect x="3" y="3" width="12" height="12"/>'),
  select: wrap('<path d="M4 2l9 7-4 1 2.5 5-2 1L7 11l-3 2z" fill="currentColor" stroke="none"/>'),
  line: wrap('<path d="M2 15L15 3"/><circle cx="2.6" cy="14.4" r="1.3"/><circle cx="14.4" cy="3.6" r="1.3"/>'),
  rect: wrap('<rect x="2.5" y="4.5" width="13" height="9"/>'),
  wall: wrap('<rect x="2" y="6" width="14" height="7"/><path d="M2 9.5h14M6 6v3.5M11 9.5V13M13 6v3.5M4 9.5V13M9 6v3.5"/>'),
  door: wrap('<path d="M4 15V3h7v12"/><path d="M11 15a7 7 0 0 0-7-7" stroke-dasharray="1.5 1.5"/><circle cx="9" cy="9.5" r="0.7" fill="currentColor"/>'),
  window: wrap('<rect x="2.5" y="4.5" width="13" height="9"/><path d="M9 4.5v9M2.5 9h13"/>'),
  slab: wrap('<path d="M2 11l7-4 7 4-7 4z"/><path d="M2 11v2l7 4 7-4v-2"/>'),
  place: wrap('<path d="M4 14V8l5-3 5 3v6z"/><path d="M7 14v-3h4v3"/>'),
  move: wrap('<path d="M9 2v14M2 9h14M9 2L7 4M9 2l2 2M9 16l-2-2M9 16l2-2M2 9l2-2M2 9l2 2M16 9l-2-2M16 9l-2 2"/>'),
  rotate: wrap('<path d="M15 9a6 6 0 1 1-2.2-4.6"/><path d="M15 3v3h-3"/>'),
  scale: wrap('<rect x="3" y="3" width="7" height="7"/><path d="M12 8v7H5"/><path d="M10 13l5-5M15 8v3M15 8h-3"/>'),
  offset: wrap('<path d="M3 13V5h10"/><path d="M6 15V8h9" stroke-dasharray="2 1.6"/>'),
  tape: wrap('<path d="M2 7h14v4H2z"/><path d="M5 7v2M8 7v3M11 7v2M14 7v3"/>'),
  protractor: wrap('<path d="M2 13a7 7 0 0 1 14 0z"/><path d="M9 13V6M9 13l6-2"/>'),
  paint: wrap('<path d="M5 3l7 7-5 5-7-7z"/><path d="M13 11c0 1.7 1 2.7 1 2.7s1-1 1-2.7a1 1 0 0 0-2 0z" fill="currentColor"/>'),
  erase: wrap('<path d="M7 15h8"/><path d="M3 11l6-6 5 5-5 5H5z"/>'),
  text: wrap('<path d="M3 5V3h12v2M9 3v12M6 15h6"/>'),
  section: wrap('<path d="M2 6h14v6H2z" stroke-dasharray="2 1.6"/><path d="M2 9h14"/>'),
  orbit: wrap('<circle cx="9" cy="9" r="4"/><ellipse cx="9" cy="9" rx="7.5" ry="3" transform="rotate(-25 9 9)"/>'),
  pan: wrap('<path d="M9 3v8M6 6v6M12 6v6M4 9v3a5 5 0 0 0 10 0V9"/>'),
};
