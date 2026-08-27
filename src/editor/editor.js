// editor.js — the heart of the game.
//
// Responsibilities, in the order they matter:
//   1. dispatch the pointer and the keyboard to the active tool, with the
//      Measurements box ALWAYS listening (measure.js) and navigation never
//      interrupting anything (camera.js)
//   2. turn tool intent into OPS and nothing else — every change to the building
//      goes through session.sendOp, which is what makes undo, multiplayer and
//      employee bots the same mechanism (ARCHITECTURE.md)
//   3. keep the 3D view in step with the model INCREMENTALLY: a wall edit
//      rebuilds one level's shell, a furniture edit rebuilds no geometry at all,
//      and a live drag rebuilds nothing until it is committed
//   4. own the three cameras, the inference engine, the gizmos and the plan
//
// It owns no DOM. hud.js, catalogue-panel.js and materials-panel.js do that, and
// talk to the editor through the small API at the bottom of this file.

import { Group, Raycaster, Vector2, Vector3, Box3, Plane } from 'three';
import { applyOp } from '../model/building.js';
import { buildMeshes, disposeBuilt } from '../model/geometry.js';
import { getRooms } from '../model/rooms.js';
import { billOfQuantities } from '../analysis/cost.js';
import { runAnalysis } from '../analysis/index.js';
import { tryEntry } from '../model/catalog.js';
import { EditorCameras } from './camera.js';
import { Inference } from './snapping.js';
import { Gizmos } from './gizmo.js';
import { PlanDrawing } from './plan.js';
import { FurnitureRenderer } from './furniture.js';
import { TextRenderer } from './text3d.js';
import { MeasurementsBox } from './measure.js';
import { COLOR, HISTORY_BY_TIER, AXIS } from './constants.js';
import { TOOLS } from './tools/index.js';

const CLICK_PX = 6;
const EMPTY_PLANES = [];

export class Editor {
  /**
   * @param {object} ctx   the App context { engine, state, input, audio, net, assets }
   * @param {object} opts  { scene, canvas, session, levelId, brief }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.scene = opts.scene;
    this.canvas = opts.canvas;
    this.session = opts.session;
    this.levelId = opts.levelId || this.session.model.levels[0].id;
    this.brief = opts.brief || null;
    // What to frame before a single wall exists: the plot's buildable area, so
    // the first thing an architect sees is the piece of ground he may build on.
    this.siteBounds = opts.siteBounds || null;

    this.buildingRoot = new Group();
    this.buildingRoot.name = 'building-root';
    this.scene.add(this.buildingRoot);
    this.builtByLevel = new Map();       // levelId -> built (from buildMeshes)
    this.materialCache = new Map();      // shared across rebuilds, never re-created

    this.cameras = new EditorCameras(this.canvas, {
      pickPoint: (ndc) => this.pickAnyPoint(ndc),
    });
    this.gizmos = new Gizmos(this.scene, this.cameras);
    this.plan = new PlanDrawing(this.scene);
    this.furniture = new FurnitureRenderer(this.scene);
    this.texts = new TextRenderer(this.scene);
    this.inference = new Inference();

    this.measurements = new MeasurementsBox({
      onCommit: (parsed, text) => this._onValue(parsed, text),
      onChange: () => this.hud?.refreshMeasurements(),
    });

    this.selection = new Set();
    this.hover = null;                   // { kind, id }
    this.guides = [];                    // setting-out lines: { a, b } in world space
    this.section = null;                 // { normal, point } for the Section Plane
    this._sectionPlane = null;
    this._planCut = null;
    this.lockAxis = null;                // 'x'|'y'|'z'|'ref'|null
    this.tools = new Map();
    this.tool = null;
    this.hud = null;                     // set by editor-mode
    this.enabled = true;

    this.history = [];
    this.redoStack = [];
    this.historyLimit = HISTORY_BY_TIER[ctx?.state?.get('office.computerTier') ?? 2] ?? 24;

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._pixel = new Vector2();
    this._pointer = { ndc: this._ndc, pixel: this._pixel, snap: null, over: false, buttons: 0 };
    this._down = null;
    this._dirty = { shell: new Set(), furniture: false, texts: false, plan: false };
    this._suspendRebuild = false;
    this._stats = { rebuildMs: 0, rebuildWhat: '', drawCalls: 0 };
    this._costCache = { version: -1, total: 0, bill: null };
    this._analysis = null;
    this._unsub = [];

    for (const T of TOOLS) {
      const t = new T(this);
      this.tools.set(t.id, t);
    }

    this._bind();
    this.rebuildAll();
    this.setTool('select');
    this.cameras.zoomExtents(this.contentBounds());
  }

  // -- model -----------------------------------------------------------------

  get model() { return this.session.model; }
  get level() { return this.model.levels.find(l => l.id === this.levelId) || this.model.levels[0]; }
  get storeyHeight() { return this.level?.height ?? 2.7; }
  get playerId() { return this.session.playerId; }

  /**
   * The ONLY way the building changes. Returns the decorated op (with its final
   * id) or null when the op did not apply.
   */
  apply(op, { history = true } = {}) {
    const before = this.model;
    const full = this.session.sendOp(op);
    if (!full) return null;
    if (history) {
      // applyOp is pure and deterministic, so re-running it against the model as
      // it was gives us exactly the inverse the session already applied.
      let inverse = null;
      try { inverse = applyOp(before, full).inverse; } catch (_) { inverse = null; }
      if (inverse && inverse.t !== 'noop') {
        this.history.push({ op: full, inverse });
        if (this.history.length > this.historyLimit) this.history.shift();
        this.redoStack.length = 0;
      }
    }
    return full;
  }

  applyMany(ops, opts) {
    const out = [];
    for (const op of ops) {
      const r = this.apply(op, opts);
      if (r) out.push(r);
    }
    return out;
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    this.session.sendOp(entry.inverse);
    this.redoStack.push(entry);
    this.hud?.flash('Undo');
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.session.sendOp(entry.op);
    this.history.push(entry);
    this.hud?.flash('Redo');
    return true;
  }

  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // -- rebuild ---------------------------------------------------------------

  /** Mark what changed. Ids come straight from the session's `changed` list. */
  markDirty(changed) {
    if (!changed || changed.includes('*')) {
      for (const l of this.model.levels) this._dirty.shell.add(l.id);
      this._dirty.furniture = true;
      this._dirty.texts = true;
      this._dirty.plan = true;
      return;
    }
    const m = this.model;
    for (const id of changed) {
      if (m.furniture[id] || id.startsWith('f')) { this._dirty.furniture = true; continue; }
      if (m.texts[id] || id.startsWith('t')) { this._dirty.texts = true; continue; }
      const w = m.walls[id];
      const o = m.openings[id];
      const s = m.slabs[id];
      const lvl = w?.levelId || s?.levelId || (o && m.walls[o.wallId]?.levelId);
      this._dirty.shell.add(lvl || this.levelId);
      this._dirty.plan = true;
    }
    // A deleted entity is not in the model any more, so anything we could not
    // classify falls back to the level being edited rather than to nothing.
    if (!this._dirty.shell.size && !this._dirty.furniture && !this._dirty.texts) {
      this._dirty.shell.add(this.levelId);
      this._dirty.plan = true;
    }
  }

  /** Do the queued work. Called once per frame, never inside a drag. */
  flushRebuild() {
    if (this._suspendRebuild) return;
    const t0 = performance.now();
    const what = [];
    if (this._dirty.shell.size) {
      for (const levelId of this._dirty.shell) this._rebuildLevel(levelId);
      what.push(`${this._dirty.shell.size} level${this._dirty.shell.size > 1 ? 's' : ''}`);
      this._dirty.shell.clear();
    }
    if (this._dirty.furniture) {
      this.furniture.rebuild(this.model, this.levelId, { skip: this._ghosted, ceiling: this.storeyHeight });
      what.push('furniture');
      this._dirty.furniture = false;
    }
    if (this._dirty.texts) {
      this.texts.rebuild(this.model, this.levelId, { skip: this._ghosted });
      what.push('text');
      this._dirty.texts = false;
    }
    if (this._dirty.plan) {
      if (this.cameras.mode === 'plan') this.plan.build(this.model, this.levelId);
      this._dirty.plan = false;
    }
    if (what.length) {
      this._stats.rebuildMs = performance.now() - t0;
      this._stats.rebuildWhat = what.join(' + ');
      this.hud?.refreshSchedule();
      this.hud?.refreshCost();
    }
  }

  _rebuildLevel(levelId) {
    const old = this.builtByLevel.get(levelId);
    if (old) {
      this.buildingRoot.remove(old.group);
      disposeBuilt({ ...old, materials: null, _ownedMaterials: false });
    }
    const built = buildMeshes(this.model, {
      levelId,
      materialCache: this.materialCache,
      wallHeight: this.model.levels.find(l => l.id === levelId)?.height,
    });
    built.group.name = `level:${levelId}`;
    this.buildingRoot.add(built.group);
    this.builtByLevel.set(levelId, built);
    this._pickIndex = null;
  }

  rebuildAll() {
    for (const l of this.model.levels) this._rebuildLevel(l.id);
    this.furniture.rebuild(this.model, this.levelId, { ceiling: this.storeyHeight });
    this.texts.rebuild(this.model, this.levelId);
    this.plan.version = -1;
    if (this.cameras.mode === 'plan') this.plan.build(this.model, this.levelId);
    this.hud?.refreshSchedule();
    this.hud?.refreshCost();
  }

  /** Everything the camera should be able to frame. */
  contentBounds() {
    const b = new Box3();
    b.makeEmpty();
    b.setFromObject(this.buildingRoot);
    for (const gd of this.guides) { b.expandByPoint(gd.a); b.expandByPoint(gd.b); }
    if (!b.isEmpty()) return b;
    if (this.siteBounds && !this.siteBounds.isEmpty()) return this.siteBounds.clone();
    b.setFromCenterAndSize(new Vector3(0, 1.35, 0), new Vector3(16, 3, 12));
    return b;
  }

  // -- derived data ----------------------------------------------------------

  rooms() { return getRooms(this.model, this.levelId); }

  cost() {
    if (this._costCache.version === this.model.version) return this._costCache;
    let boq;
    try { boq = billOfQuantities(this.model, {}); }
    catch (err) { console.warn('[editor] cost failed', err); boq = { total: 0, bill: [], subtotals: {} }; }
    this._costCache = { version: this.model.version, total: boq.total, bill: boq.bill, subtotals: boq.subtotals };
    return this._costCache;
  }

  get budget() { return Number.isFinite(this.brief?.budget) ? this.brief.budget : null; }

  /** The validation panel's button. Deterministic, so it is safe to spam. */
  validate() {
    try {
      this._analysis = runAnalysis(this.model, this.brief || {});
    } catch (err) {
      console.error('[editor] analysis failed', err);
      this._analysis = { score: 0, issues: [], metrics: {}, error: String(err.message || err) };
    }
    this.ctx?.state?.set('analysis', this._analysis);
    this.hud?.refreshValidation();
    return this._analysis;
  }

  get analysis() { return this._analysis; }

  /** Highlight whatever an issue points at, and fly the camera to it. */
  focusIssue(issue) {
    if (!issue) return;
    const id = issue.roomId || issue.wallId || issue.furnitureId;
    if (!id) return;
    this.select([id]);
    const p = this.centreOf(id);
    if (p) this.cameras.recentre(p);
  }

  centreOf(id) {
    const m = this.model;
    if (m.walls[id]) {
      const a = m.nodes[m.walls[id].a], b = m.nodes[m.walls[id].b];
      if (a && b) return new Vector3((a.x + b.x) / 2, 1.2, (a.z + b.z) / 2);
    }
    if (m.furniture[id]) return new Vector3(m.furniture[id].x, 0.6, m.furniture[id].z);
    if (m.texts[id]) return new Vector3(m.texts[id].x, m.texts[id].y, m.texts[id].z);
    const rooms = this.rooms();
    const r = rooms.rooms[id];
    if (r) {
      let x = 0, z = 0;
      for (const p of r.polygon) { x += p[0]; z += p[1]; }
      return new Vector3(x / r.polygon.length, 1.2, z / r.polygon.length);
    }
    return null;
  }

  // -- selection -------------------------------------------------------------

  select(ids, { add = false } = {}) {
    if (!add) this.selection.clear();
    for (const id of ids || []) {
      if (this.session.isLockedByOther(id)) continue;
      this.selection.add(id);
    }
    this.session.setCursor?.({ mode: 'select', ...(this._pointer.snap?.point || {}) });
    this.hud?.refreshSelection();
  }

  toggleSelect(id) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.hud?.refreshSelection();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.hud?.refreshSelection();
  }

  deleteSelection() {
    const ops = [];
    for (const id of this.selection) {
      if (this.model.walls[id]) ops.push({ t: 'wall.delete', id });
      else if (this.model.openings[id]) ops.push({ t: 'opening.delete', id });
      else if (this.model.furniture[id]) ops.push({ t: 'furniture.delete', id });
      else if (this.model.texts[id]) ops.push({ t: 'text.delete', id });
      else if (this.model.slabs[id]) ops.push({ t: 'slab.delete', id });
    }
    if (!ops.length) return false;
    this.applyMany(ops);
    this.clearSelection();
    return true;
  }

  // -- tools -----------------------------------------------------------------

  setTool(id, params = {}) {
    const next = this.tools.get(id);
    if (!next) { console.warn(`[editor] no tool "${id}"`); return null; }
    if (this.tool === next) { next.activate?.(params, true); return next; }
    this.tool?.cancel?.();
    this.tool?.deactivate?.();
    this.tool = next;
    this.lockAxis = null;
    this.measurements.clear();
    this.measurements.setContext(next.valueLabel || 'Length', next.valueMode || 'length');
    next.activate?.(params, false);
    this.hud?.refreshTool();
    this.cameras.forceNav = id === 'orbit' ? 'orbit' : id === 'pan' ? 'pan' : null;
    return next;
  }

  _onValue(parsed, text) {
    const handled = this.tool?.onValue?.(parsed, text);
    if (handled === false) this.hud?.flash('That tool does not take a value');
  }

  /**
   * Drop a catalogue component onto the model at a screen position. The HUD
   * calls this from the drag-and-drop handler; clicking a catalogue row arms the
   * Place tool instead, so both gestures place the same object the same way.
   */
  dropComponent(catalogId, clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this._pixel.set(clientX - r.left, clientY - r.top);
    this.cameras.ndcFromPixel(this._pixel.x, this._pixel.y, this._ndc);
    const tool = this.setTool('place', { catalogId });
    tool.setComponent?.(catalogId);
    this._updateSnap();
    this._pointer.over = true;
    tool.onMove(this._pointer);
    tool.onUp(this._pointer, { dragged: false });
  }

  // -- picking ---------------------------------------------------------------

  _pickables() {
    const out = [];
    for (const built of this.builtByLevel.values()) {
      if (built.group.visible) out.push(...built.group.children);
    }
    return out;
  }

  _raycaster(ndc) {
    this._ray.setFromCamera(ndc, this.cameras.camera);
    this._ray.params.Line = { threshold: 0.05 };
    return this._ray;
  }

  /** Nearest hit on the building shell, mapped back to its wall or slab id. */
  pickShell(ndc) {
    const hits = this._raycaster(ndc).intersectObjects(this._pickables(), false);
    if (!hits.length) return null;
    const hit = hits[0];
    const id = this._entityAt(hit);
    return id ? { ...hit, entityId: id } : null;
  }

  _entityAt(hit) {
    if (!this._pickIndex) this._buildPickIndex();
    const list = this._pickIndex.get(hit.object);
    if (!list) return null;
    const tri = hit.faceIndex;
    for (const r of list) if (tri >= r.triStart && tri < r.triStart + r.triCount) return r.id;
    return null;
  }

  _buildPickIndex() {
    this._pickIndex = new Map();
    for (const built of this.builtByLevel.values()) {
      for (const [id, rec] of built.byId) {
        for (const e of rec.entries) {
          if (!this._pickIndex.has(e.mesh)) this._pickIndex.set(e.mesh, []);
          this._pickIndex.get(e.mesh).push({ id, triStart: e.triStart, triCount: e.triCount });
        }
      }
    }
    for (const list of this._pickIndex.values()) list.sort((a, b) => a.triStart - b.triStart);
  }

  pickFurniture(ndc) {
    const hits = this._raycaster(ndc).intersectObjects(this.furniture.pickables(), false);
    for (const h of hits) {
      const id = this.furniture.idFromHit(h);
      if (id) return { ...h, entityId: id };
    }
    return null;
  }

  pickText(ndc) {
    const hits = this._raycaster(ndc).intersectObjects([...this.texts.meshes.values()], false);
    for (const h of hits) if (h.object.userData.textId) return { ...h, entityId: h.object.userData.textId };
    return null;
  }

  /** Anything at all, nearest first. Used by Select, Paint, Eraser and Move. */
  pickAny(ndc) {
    const cands = [this.pickShell(ndc), this.pickFurniture(ndc), this.pickText(ndc)].filter(Boolean);
    if (!cands.length) return null;
    cands.sort((a, b) => a.distance - b.distance);
    return cands[0];
  }

  /** A world point for the camera to anchor a zoom on. */
  pickAnyPoint(ndc) {
    const hit = this.pickAny(ndc);
    if (hit) return hit.point.clone();
    return null;
  }

  /** Which wall face is under the cursor, and where on it — the Door/Window tool. */
  pickWallFace(ndc) {
    const hit = this.pickShell(ndc);
    if (!hit) return null;
    const w = this.model.walls[hit.entityId];
    if (!w) return null;
    const a = this.model.nodes[w.a], b = this.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const offset = (hit.point.x - a.x) * dx + (hit.point.z - a.z) * dz;
    return { wallId: w.id, wall: w, offset, length: len, point: hit.point.clone(), height: hit.point.y, hit };
  }

  // -- pointer / keyboard ----------------------------------------------------

  _bind() {
    const c = this.canvas;
    this._onMove = (e) => {
      const r = c.getBoundingClientRect();
      this._pixel.set(e.clientX - r.left, e.clientY - r.top);
      this.cameras.ndcFromPixel(this._pixel.x, this._pixel.y, this._ndc);
      this._pointer.over = true;
      if (this._down && !this._down.dragging) {
        if (this._pixel.distanceTo(this._down.pixel) > CLICK_PX) this._down.dragging = true;
      }
    };
    this._onLeave = () => { this._pointer.over = false; };
    this._onDown = (e) => {
      if (!this.enabled) return;
      if (e.button !== 0 || e.altKey) return;          // navigation owns those
      if (this.cameras.forceNav) return;
      const r = c.getBoundingClientRect();
      this._pixel.set(e.clientX - r.left, e.clientY - r.top);
      this.cameras.ndcFromPixel(this._pixel.x, this._pixel.y, this._ndc);
      this._down = { pixel: this._pixel.clone(), t: performance.now(), dragging: false };
      this._updateSnap();
      this.tool?.onDown?.(this._pointer, e);
    };
    this._onUp = (e) => {
      if (!this.enabled || !this._down) return;
      if (e.button !== 0) return;
      const dragged = this._down.dragging;
      this._down = null;
      this._updateSnap();
      this.tool?.onUp?.(this._pointer, { dragged, event: e });
    };
    this._onDbl = (e) => {
      if (!this.enabled || e.button !== 0 || e.altKey) return;
      this._updateSnap();
      this.tool?.onDoubleClick?.(this._pointer, e);
    };
    this._onKey = (e) => this._key(e);

    c.addEventListener('pointermove', this._onMove);
    c.addEventListener('pointerleave', this._onLeave);
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointerup', this._onUp);
    c.addEventListener('dblclick', this._onDbl);
    window.addEventListener('keydown', this._onKey);
  }

  _key(e) {
    if (!this.enabled) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // 1. Ctrl/Cmd combinations
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
      if (k === 'y') { e.preventDefault(); this.redo(); return; }
      return;
    }

    // 2. the tool gets first refusal (arrow locks, tool-specific modifiers)
    if (this.tool?.onKey?.(e) === true) { e.preventDefault(); return; }

    // 3. arrow keys lock the drawing direction to an axis
    const lock = axisForKey(e.code);
    if (lock !== undefined) {
      e.preventDefault();
      this.lockAxis = this.lockAxis === lock ? null : lock;
      this.hud?.flash(this.lockAxis ? `Locked to ${lockName(this.lockAxis)}` : 'Inference unlocked');
      return;
    }

    // 4. the Measurements box — ALWAYS live, never focused, never clicked into
    if (this.measurements.key(e)) { e.preventDefault(); return; }

    // 5. everything else
    const code = e.code;
    if (code === 'Escape') {
      e.preventDefault();
      if (this.tool?.cancel?.()) return;
      if (this.lockAxis) { this.lockAxis = null; return; }
      this.clearSelection();
      return;
    }
    if (code === 'Delete' || code === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
    if (code === 'Tab') { e.preventDefault(); this.cameras.cycleView(); this._viewChanged(); return; }
    if (code === 'F2') { e.preventDefault(); this.setView('plan'); return; }
    if (code === 'F3') { e.preventDefault(); this.setView('orbit'); return; }
    if (code === 'F4') { e.preventDefault(); this.setView('walk'); return; }
    if (code === 'KeyZ' && e.shiftKey) { e.preventDefault(); this.cameras.zoomExtents(this.contentBounds()); return; }

    const id = SHORTCUTS[code];
    if (id) { e.preventDefault(); this.setTool(id); }
  }

  setView(mode) {
    this.cameras.setView(mode);
    this._viewChanged();
  }

  /**
   * The Section Plane. three's clipping planes are a renderer-wide setting, so
   * the editor writes them on every frame it renders — never once at set time,
   * which would leak the cut into whatever mode renders next.
   */
  setSection(s) {
    this.section = s;
    if (!s) { this._sectionPlane = null; return; }
    const n = s.normal.clone().normalize();
    this._sectionPlane = new Plane(n, -n.dot(s.point));
  }

  /** The clipping planes for this frame — the Section Plane tool, or none. */
  _clippingPlanes() {
    return this._sectionPlane ? [this._sectionPlane] : EMPTY_PLANES;
  }

  _viewChanged() {
    const plan = this.cameras.mode === 'plan';
    this.plan.visible = plan;
    if (plan) this.plan.build(this.model, this.levelId);
    for (const built of this.builtByLevel.values()) built.group.visible = !plan;
    this.gizmos.axesVisible = !plan;
    // A plan is a section at 1.20 m, so everything the section would remove is
    // taken out of the picture: the 3D shell (replaced by the drawing) and, via
    // this hook, whatever the scene owner keeps above the cut — tree canopies,
    // the neighbours' upper storeys. Done by hiding rather than by a clipping
    // plane: a cut canopy is a solid green disc, and a plan wants the trunk.
    this.onViewChanged?.(this.cameras.mode);
    this.hud?.refreshTool();
  }

  _updateSnap() {
    const c = this.tool?.inferenceContext?.() || {};
    this._pointer.snap = this.inference.infer({
      ndc: this._ndc,
      pixel: this._pixel,
      cameras: this.cameras,
      model: this.model,
      levelId: this.levelId,
      from: c.from ?? null,
      refDir: c.refDir ?? null,
      lockAxis: this.lockAxis,
      height: c.height ?? (this.level?.elevation ?? 0),
      fine: !!this.ctx?.input?.ctrl,
      wallHit: c.wallHit ?? null,
      ignoreIds: c.ignoreIds ?? null,
      guides: this.guides,
    });
    return this._pointer.snap;
  }

  // -- frame -----------------------------------------------------------------

  update(dt) {
    this.cameras.update(dt, this.ctx?.input);
    if (this._pointer.over && !this.cameras.navigating) {
      this._updateSnap();
      this.inference.tickDwell(this._pixel, dt, this._pointer.snap?.point);
      this.tool?.onMove?.(this._pointer);
    }
    this.flushRebuild();

    // gizmos
    const g = this.gizmos;
    g.begin();
    g.clearGhost();
    if (this.cameras.mode !== 'plan') g.drawAxes(new Vector3(0, this.level?.elevation ?? 0, 0));
    for (const gd of this.guides) g.dotted(gd.a, gd.b, COLOR.guide);
    this._drawSelection(g);
    this.tool?.draw?.(g, this._pointer);
    const snap = this._pointer.over && !this.cameras.navigating ? this._pointer.snap : null;
    if (snap) {
      for (const gu of snap.guides || []) {
        if (gu.dotted) g.dotted(gu.a, gu.b, gu.color);
        else g.line(gu.a, gu.b, gu.color);
      }
      g.showMarker(snap.free ? null : snap);
      this.hud?.setInference(snap.free ? '' : snap.name, snap.color, this._pixel);
    } else {
      g.showMarker(null);
      this.hud?.setInference('', 0, this._pixel);
    }
    g.end();

    // other players
    if (this.session.players?.length > 1) {
      g.updateCursors(this.session.players.filter(p => p.id !== this.playerId));
      if (snap) this.session.setCursor({ mode: this.tool?.id, x: r3(snap.point.x), y: r3(snap.point.y), z: r3(snap.point.z) });
    }

    this.hud?.tick(dt);
  }

  _drawSelection(g) {
    const m = this.model;
    const draw = (id, color) => {
      if (m.walls[id]) this._outlineWall(g, m.walls[id], color);
      else if (m.furniture[id]) this._outlineFurniture(g, m.furniture[id], color);
      else if (m.texts[id]) {
        const t = m.texts[id];
        g.rect(t.x, t.z, Math.max(0.3, this.texts.widthOf(id)), 0.2, t.y, color, t.rot);
      } else if (m.openings[id]) {
        const o = m.openings[id];
        const w = m.walls[o.wallId];
        if (w) this._outlineOpening(g, w, o, color);
      } else {
        const r = this.rooms().rooms[id];
        if (r) for (let i = 0; i < r.polygon.length; i++) {
          const a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.length];
          g.line(new Vector3(a[0], 0.03, a[1]), new Vector3(b[0], 0.03, b[1]), color);
        }
      }
    };
    for (const id of this.selection) {
      const holder = this.session.lockedBy(id);
      const color = holder && holder !== this.playerId ? 0xb2472e : COLOR.selection;
      draw(id, color);
    }
    if (this.hover && !this.selection.has(this.hover.id)) draw(this.hover.id, COLOR.hover);
    // Objects held by other players glow in the holder's colour and are frozen.
    for (const [objId, pid] of Object.entries(this.session.locks || {})) {
      if (pid === this.playerId) continue;
      const p = this.session.players.find(x => x.id === pid);
      draw(objId, colorHex(p?.color) ?? 0xd4763a);
    }
  }

  _outlineWall(g, w, color) {
    const m = this.model;
    const a = m.nodes[w.a], b = m.nodes[w.b];
    if (!a || !b) return;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len * w.thickness / 2;
    const nz = (b.x - a.x) / len * w.thickness / 2;
    const y0 = this.level.elevation + 0.01;
    const y1 = y0 + this.storeyHeight;
    const c = [
      new Vector3(a.x + nx, y0, a.z + nz), new Vector3(b.x + nx, y0, b.z + nz),
      new Vector3(b.x - nx, y0, b.z - nz), new Vector3(a.x - nx, y0, a.z - nz),
    ];
    for (let i = 0; i < 4; i++) {
      g.line(c[i], c[(i + 1) % 4], color);
      const up = c[i].clone(); up.y = y1;
      const up2 = c[(i + 1) % 4].clone(); up2.y = y1;
      g.line(up, up2, color);
      g.line(c[i], up, color);
    }
  }

  _outlineOpening(g, w, o, color) {
    const m = this.model;
    const a = m.nodes[w.a], b = m.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const y0 = this.level.elevation + o.sill;
    const y1 = y0 + o.height;
    const half = o.width / 2;
    const p = (s, y) => new Vector3(a.x + dx * (o.offset + s * half), y, a.z + dz * (o.offset + s * half));
    g.line(p(-1, y0), p(1, y0), color);
    g.line(p(-1, y1), p(1, y1), color);
    g.line(p(-1, y0), p(-1, y1), color);
    g.line(p(1, y0), p(1, y1), color);
  }

  _outlineFurniture(g, f, color) {
    const entry = tryEntry(f.catalogId);
    if (!entry) return;
    const [w, h, d] = entry.size;
    const sx = (f.sx ?? 1) * w, sy = (f.sy ?? 1) * h, sz = (f.sz ?? 1) * d;
    const base = (entry.anchor === 'ceiling' ? this.storeyHeight - (entry.mount || 0) : (entry.mount || 0)) + (f.y ?? 0);
    const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0);
    const corners = [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]
      .map(([x, z]) => new Vector3(f.x + x * c - z * s, base, f.z + x * s + z * c));
    for (let i = 0; i < 4; i++) {
      const p0 = corners[i], p1 = corners[(i + 1) % 4];
      const q0 = p0.clone(); q0.y = base + sy;
      const q1 = p1.clone(); q1.y = base + sy;
      g.line(p0, p1, color);
      g.line(q0, q1, color);
      g.line(p0, q0, color);
    }
  }

  render(renderer, target = null) {
    // three only re-uploads clipping uniforms per material when local clipping
    // is on; with it off, a global plane set after the first frame reaches only
    // the first material drawn. It costs nothing to leave on.
    if (!renderer.localClippingEnabled) renderer.localClippingEnabled = true;
    renderer.clippingPlanes = this._clippingPlanes();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cameras.camera);
    renderer.clippingPlanes = [];
    if (target) renderer.setRenderTarget(null);
    this._stats.drawCalls = renderer.info.render.calls;
  }

  resize(w, h) { this.cameras.resize(w, h); }

  get stats() { return this._stats; }

  // -- session wiring --------------------------------------------------------

  attachSession() {
    this._unsub.push(this.session.on('op', ({ changed }) => {
      this.markDirty(changed);
      this._costCache.version = -1;
    }));
    this._unsub.push(this.session.on('snapshot', () => { this.markDirty(['*']); }));
    this._unsub.push(this.session.on('players', () => this.hud?.refreshPlayers()));
    this._unsub.push(this.session.on('lock', () => this.hud?.refreshSelection()));
  }

  dispose() {
    for (const u of this._unsub) u();
    this._unsub.length = 0;
    const c = this.canvas;
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerleave', this._onLeave);
    c.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('dblclick', this._onDbl);
    window.removeEventListener('keydown', this._onKey);
    this.cameras.dispose();
    this.gizmos.dispose();
    this.plan.dispose();
    this.furniture.dispose();
    this.texts.dispose();
    for (const built of this.builtByLevel.values()) disposeBuilt({ ...built, materials: null, _ownedMaterials: false });
    this.builtByLevel.clear();
    for (const m of this.materialCache.values()) m.dispose();
    this.materialCache.clear();
  }
}

// ---------------------------------------------------------------------------

/**
 * Tool shortcuts. Letters only, and that is not an oversight: the digits belong
 * to the Measurements box, which is always listening, so a tool bound to "5"
 * could never fire — you would type a 5 into a measurement instead. SketchUp
 * puts its tools on letters for exactly this reason. src/core/input.js still
 * carries digit bindings for a future rebinding screen; the editor ignores them.
 *
 * Every letter matches SketchUp wherever SketchUp has the tool (L, R, M, Q, S,
 * F, T, B, E, O, H, Space). The ones it does not have — Wall, Door, wiNdow,
 * slaB->G, Catalogue, teXt, section plane K — take the free letters.
 */
export const SHORTCUTS = {
  Space: 'select', KeyV: 'select',
  KeyL: 'line',
  KeyR: 'rect',
  KeyW: 'wall',
  KeyD: 'door',
  KeyN: 'window',
  KeyG: 'slab',
  KeyC: 'place',
  KeyB: 'paint',
  KeyX: 'text',
  KeyM: 'move',
  KeyQ: 'rotate',
  KeyS: 'scale',
  KeyF: 'offset',
  KeyT: 'tape',
  KeyA: 'protractor',
  KeyE: 'erase',
  KeyO: 'orbit',
  KeyH: 'pan',
  KeyK: 'section',
};

function axisForKey(code) {
  if (code === 'ArrowRight') return 'x';
  if (code === 'ArrowLeft') return 'y';
  if (code === 'ArrowUp') return 'z';
  if (code === 'ArrowDown') return 'ref';
  return undefined;
}

function lockName(a) {
  if (a === 'ref') return 'parallel / perpendicular';
  return `the ${a === 'x' ? 'red' : a === 'y' ? 'green' : 'blue'} axis (${AXIS[a].name})`;
}

function colorHex(css) {
  if (!css) return null;
  const s = String(css).replace('#', '');
  const v = parseInt(s, 16);
  return Number.isFinite(v) ? v : null;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
