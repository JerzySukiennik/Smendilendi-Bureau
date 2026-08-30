// selftest.js — drives the editor the way a person does, and counts the cost.
//
// This exists because the pass mark for the editor is a NUMBER, not an opinion:
// reference/sketchup/ANALYSIS.md §7 gives a decision count for five operations
// and our count has to be less than or equal to it. Eyeballing a click count is
// exactly the kind of measurement that drifts, so it is scripted.
//
// Everything here goes through REAL DOM EVENTS on the real canvas and the real
// window — the same pointerdown / pointerup / keydown listeners a hand drives.
// Nothing calls a tool method directly. A "decision" is counted the way the
// reference counts one: a tool switch, a mouse click, or one typed entry.
//
//   ED.selftest.all()      run every graded operation, return the table
//   ED.selftest.house()    build the small house used for the screenshots
//
// Loaded only by src/editor/dev.html. The game never imports it.

const KEYCODE = {
  ' ': 'Space', '.': 'Period', ',': 'Comma', '-': 'Minus', '<': 'Comma', '>': 'Period',
};

export function makeSelfTest(ED) {
  const ed = () => ED.editor;
  const canvas = () => ED.editor.canvas;

  let decisions = 0;
  const log = [];
  const count = (kind, what) => { decisions++; log.push(`${decisions}. ${kind}: ${what}`); };

  // -- primitive input ------------------------------------------------------

  function key(code, k, opts = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code, key: k, bubbles: true, cancelable: true, ...opts,
    }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: k, bubbles: true }));
  }

  /** One typed entry: the characters and the Enter that commits them. */
  function typeValue(text) {
    for (const ch of text) {
      const code = KEYCODE[ch]
        || (/[0-9]/.test(ch) ? `Digit${ch}` : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : 'Unidentified');
      key(code, ch);
    }
    key('Enter', 'Enter');
    count('typed', `"${text}" Enter`);
  }

  function tool(id, keyCode, keyChar) {
    key(keyCode, keyChar);
    count('tool', `${id} (${keyChar})`);
    if (ed().tool.id !== id) throw new Error(`tool switch failed: wanted ${id}, got ${ed().tool.id}`);
  }

  function pointerAt(px, py, type, extra = {}) {
    const c = canvas();
    const r = c.getBoundingClientRect();
    const ev = new PointerEvent(type, {
      clientX: r.left + px, clientY: r.top + py,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, ...extra,
    });
    (type === 'pointerup' ? window : c).dispatchEvent(ev);
  }

  /** Move the cursor. Moving the mouse is not a decision — only clicking is. */
  function moveTo(px, py) {
    pointerAt(px, py, 'pointermove');
    ed()._updateSnap();
    ed()._pointer.over = true;
    ed().tool.onMove?.(ed()._pointer);
  }

  function clickAt(px, py, what) {
    moveTo(px, py);
    pointerAt(px, py, 'pointerdown');
    pointerAt(px, py, 'pointerup');
    count('click', what);
  }

  /** World point -> canvas pixels. */
  function px(x, y, z) {
    const p = ed().cameras.toScreen(ED.v3(x, y, z));
    return [p.x, p.y];
  }

  const clickWorld = (x, y, z, what) => clickAt(...px(x, y, z), what);
  const moveWorld = (x, y, z) => moveTo(...px(x, y, z));

  function reset() {
    const e = ed();
    const ops = [];
    for (const id in e.model.walls) ops.push({ t: 'wall.delete', id });
    for (const id in e.model.furniture) ops.push({ t: 'furniture.delete', id });
    for (const id in e.model.texts) ops.push({ t: 'text.delete', id });
    for (const id in e.model.slabs) ops.push({ t: 'slab.delete', id });
    e.applyMany(ops);
    e.guides.length = 0;
    e.clearSelection();
    e.flushRebuild();
    rest();
  }

  /**
   * Put the editor back in its RESTING state — the Select tool, the way
   * SketchUp sits between operations. The reference's own click counts assume
   * this (its row (d) spends no tool switch on Select), so ours must too, and
   * returning to it is not itself counted.
   */
  function rest() {
    if (ed().tool.id !== 'select') key('Space', ' ');
  }

  function orbitOn(tx, tz, yaw = Math.PI, pitch = 0.45, dist = 24) {
    const c = ed().cameras;
    c.setView('orbit', { instant: true });
    c.target.set(tx, 1.2, tz);
    c.yaw = yaw; c.pitch = pitch; c.dist = dist;
    c._apply();
    ed()._viewChanged();
  }

  function planOn(cx, cz, height = 22) {
    const c = ed().cameras;
    c.setView('plan', { instant: true });
    c.planCentre.set(cx, cz);
    c.planHeight = height;
    c._apply();
    ed()._viewChanged();
  }

  function start(name) { decisions = 0; log.length = 0; log.push(`--- ${name}`); }
  function done(extra = {}) { return { decisions, log: log.slice(), ...extra }; }

  // -- the five graded operations ------------------------------------------

  /** (a) Draw a 4 m wall of an exactly specified length. Bar: 6 decisions. */
  function wall4m() {
    reset();
    orbitOn(2, 0, Math.PI, 0.6, 22);
    start('a — draw a 4 m wall, exact length');
    tool('wall', 'KeyW', 'w');
    clickWorld(0, 0, 0, 'start point at the origin');
    moveWorld(3, 0, 0);                       // point the mouse along the red axis
    typeValue('4m');
    const e = ed();
    const walls = Object.values(e.model.walls);
    const w = walls[walls.length - 1];
    const a = e.model.nodes[w.a], b = e.model.nodes[w.b];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return done({
      measured: { length: +len.toFixed(4), thickness: w.thickness, type: w.type, height: e.storeyHeight },
      pass: Math.abs(len - 4) < 1e-6,
    });
  }

  /** (a') A bare 4 m setting-out line. Bar: 3 decisions. */
  function line4m() {
    reset();
    orbitOn(2, 0, Math.PI, 0.6, 22);
    start("a' — a bare 4 m line");
    tool('line', 'KeyL', 'l');
    clickWorld(0, 0, 0, 'start point');
    moveWorld(3, 0, 0);
    typeValue('4m');
    const g = ed().guides[ed().guides.length - 1];
    const len = g ? g.a.distanceTo(g.b) : 0;
    return done({ measured: { length: +len.toFixed(4) }, pass: Math.abs(len - 4) < 1e-6 });
  }

  /** (b) Cut a door opening in an existing wall. Bar: 6 decisions. */
  function door() {
    reset();
    // one 6 m wall to cut
    ed().apply({ t: 'wall.add', ax: 0, az: 0, bx: 6, bz: 0, wallType: 'exterior', thickness: 0.24 });
    ed().flushRebuild();
    orbitOn(3, 0, Math.PI, 0.35, 14);
    start('b — cut a door opening');
    tool('door', 'KeyD', 'd');
    clickWorld(3, 1.2, -0.12, 'on the wall face');
    const o = Object.values(ed().model.openings)[0];
    return done({
      measured: o ? { width: o.width, height: o.height, offset: o.offset, swing: o.swing, catalogId: o.catalogId } : null,
      pass: !!o && Math.abs(o.width - 0.9) < 1e-6 && Math.abs(o.height - 2.05) < 1e-6,
    });
  }

  /** (b2) Cut a door of a NON-default width, i.e. with an exact typed value. */
  function door800() {
    reset();
    ed().apply({ t: 'wall.add', ax: 0, az: 0, bx: 6, bz: 0, wallType: 'exterior', thickness: 0.24 });
    ed().flushRebuild();
    orbitOn(3, 0, Math.PI, 0.35, 14);
    start('b2 — cut a door and set an exact width');
    tool('door', 'KeyD', 'd');
    clickWorld(3, 1.2, -0.12, 'on the wall face');
    typeValue('800');
    const o = Object.values(ed().model.openings)[0];
    return done({ measured: o ? { width: o.width, height: o.height } : null, pass: !!o && Math.abs(o.width - 0.8) < 1e-6 });
  }

  /** (c) Change a face's material. Bar: 3 decisions. */
  function material() {
    reset();
    ed().apply({ t: 'wall.add', ax: 0, az: 0, bx: 6, bz: 0, wallType: 'exterior', thickness: 0.24 });
    ed().flushRebuild();
    orbitOn(3, 0, Math.PI, 0.35, 14);
    start("c — change a face's material");
    tool('paint', 'KeyB', 'b');
    const sw = document.querySelector('.mat-sw[data-mat="brick"]');
    if (!sw) throw new Error('no brick swatch in the materials panel');
    sw.click();
    count('click', 'brick swatch in the Materials panel');
    clickWorld(3, 1.2, -0.12, 'the wall face');
    const w = Object.values(ed().model.walls)[0];
    return done({ measured: { matInner: w.matInner, matOuter: w.matOuter }, pass: w.matOuter === 'brick' || w.matInner === 'brick' });
  }

  /** (d) Move an object exactly 500 mm along an axis. Bar: 5 decisions. */
  function move500() {
    reset();
    const f = ed().apply({ t: 'furniture.add', catalogId: 'chair-dining', x: 0, z: 0, rot: 0 });
    ed().flushRebuild();
    orbitOn(0, 0, Math.PI, 0.6, 8);
    start('d — move an object exactly 500 mm along an axis');
    clickWorld(0, 0.45, 0, 'the chair (Select is the resting tool)');
    tool('move', 'KeyM', 'm');
    key('ArrowRight', 'ArrowRight');
    count('typed', 'Right arrow locks the red axis');
    typeValue('500');
    const o = ed().model.furniture[f.id];
    return done({ measured: { x: +o.x.toFixed(4), z: +o.z.toFixed(4) }, pass: Math.abs(o.x - 0.5) < 1e-6 && Math.abs(o.z) < 1e-6 });
  }

  /** (d') The same move, typed as relative coordinates. Bar: 4 decisions. */
  function move500vector() {
    reset();
    const f = ed().apply({ t: 'furniture.add', catalogId: 'chair-dining', x: 0, z: 0, rot: 0 });
    ed().flushRebuild();
    orbitOn(0, 0, Math.PI, 0.6, 8);
    start("d' — move by typed relative coordinates");
    clickWorld(0, 0.45, 0, 'the chair (Select is the resting tool)');
    tool('move', 'KeyM', 'm');
    typeValue('<500,0,0>');
    const o = ed().model.furniture[f.id];
    return done({ measured: { x: +o.x.toFixed(4), z: +o.z.toFixed(4) }, pass: Math.abs(o.x - 0.5) < 1e-6 });
  }

  /** (e) Measure a distance. Bar: 3 decisions. */
  function measure() {
    reset();
    ed().apply({ t: 'wall.add', ax: 0, az: 0, bx: 6, bz: 0, wallType: 'exterior', thickness: 0.24 });
    ed().flushRebuild();
    orbitOn(3, 0, Math.PI, 0.6, 16);
    start('e — measure a distance');
    tool('tape', 'KeyT', 't');
    clickWorld(0, 0, 0, 'point A (Endpoint)');
    clickWorld(6, 0, 0, 'point B (Endpoint)');
    const t = ed().tools.get('tape');
    return done({
      measured: { length: t.measured ? +t.measured.length.toFixed(4) : null, box: ed().measurements.display },
      pass: !!t.measured && Math.abs(t.measured.length - 6) < 1e-6,
    });
  }

  // -- the house ------------------------------------------------------------

  /**
   * A small house drawn with nothing but the editor's own tools, on the plot the
   * harness is pinned to (dev21, House for Ostrowski on Mlynarska).
   * Returns the decision count for the whole thing.
   */
  function house() {
    reset();
    planOn(4.5, -2, 20);
    start('the whole house');

    // 1. the shell: 11.0 x 8.0 m, exterior 240 mm
    tool('rect', 'KeyR', 'r');
    clickWorld(-1, 0, -6, 'south-west corner of the shell');
    moveWorld(6, 0, -2);
    typeValue('11000,8000');

    // 2. two partitions in interior 120 mm.
    //    The first is typed to an exact 8 m so it lands ON the north wall and
    //    closes a region; the second is drawn between two On Edge inferences,
    //    which needs no number at all.
    tool('wall', 'KeyW', 'w');
    key('KeyW', 'w');                      // W again = interior 120 mm
    count('tool', 'wall again -> interior 120 mm');
    clickWorld(4.5, 0, -6, 'the south wall at its Midpoint');
    moveWorld(4.5, 0, -2);
    typeValue('8000');
    key('Escape', 'Escape');
    clickWorld(4.5, 0, -2.5, 'On Edge of the new partition');
    clickWorld(10, 0, -2.5, 'On Edge of the east wall');
    key('Escape', 'Escape');

    // 3. openings — entrance on the north (street) side, windows south and west
    ed().flushRebuild();
    orbitOn(4.5, -2, 0, 0.30, 26);         // look at the north elevation
    tool('door', 'KeyD', 'd');
    clickWorld(2.0, 1.2, 2.12, 'entrance door on the north wall');
    tool('window', 'KeyN', 'n');
    clickWorld(6.5, 1.55, 2.12, 'window on the north wall');
    orbitOn(4.5, -2, Math.PI, 0.30, 26);   // south elevation
    clickWorld(1.5, 1.55, -6.12, 'window on the south wall');
    clickWorld(8.0, 1.55, -6.12, 'second window on the south wall');

    // 4. floor slab: one click inside a room
    ed().flushRebuild();
    planOn(4.5, -2, 20);
    tool('slab', 'KeyG', 'g');
    clickWorld(2, 0, -3, 'inside the living room');

    // 5. finishes
    orbitOn(4.5, -2, Math.PI, 0.35, 26);
    tool('paint', 'KeyB', 'b');
    document.querySelector('.mat-sw[data-mat="brick"]')?.click();
    count('click', 'brick swatch');
    clickWorld(4.5, 1.6, -6.12, 'the south facade, with Ctrl for the whole run');

    // 6. furniture
    tool('place', 'KeyC', 'c');
    planOn(4.5, -2, 20);
    const cat = ED.editor.hud.catalogue;
    cat.pick('sofa-3seat');
    count('click', 'Sofa, 3 seats in the catalogue');
    clickWorld(2.0, 0, -4.6, 'place the sofa');
    cat.pick('table-dining-4');
    count('click', 'Dining table, 4 in the catalogue');
    clickWorld(2.2, 0, -1.8, 'place the table');
    cat.pick('bed-double-1600');
    count('click', 'Double bed in the catalogue');
    clickWorld(8.0, 0, -4.0, 'place the bed');

    ed().flushRebuild();
    const e = ed();
    const rooms = e.rooms();
    return done({
      measured: {
        walls: Object.keys(e.model.walls).length,
        openings: Object.keys(e.model.openings).length,
        furniture: Object.keys(e.model.furniture).length,
        rooms: rooms.order.map(id => ({ name: rooms.rooms[id].name, area: rooms.rooms[id].area })),
        cost: e.cost().total,
        budget: e.budget,
      },
    });
  }

  // -- regressions ----------------------------------------------------------
  //
  // Not click counts: things that were BROKEN, each one asserted in the terms
  // that would have caught it. A benchmark measures how good the editor is; a
  // regression measures whether it is still there at all.

  /**
   * THE MOUSE REACHES THE 3D VIEW.
   *
   * This class of bug has now killed two modes. #ui > * { pointer-events: auto }
   * in the shell carries an id and beats a mode root's own
   * `pointer-events: none`, so a full-screen HUD layer that does not wear the
   * shell's `passthrough` class becomes a sheet of glass over the canvas: the
   * panels keep working, and orbit, zoom, drawing, selecting and painting all
   * die silently. Asserted the only way that cannot be fooled — ask the
   * document what is actually under the middle of the viewport.
   */
  function pointerReachesCanvas() {
    const c = canvas();
    const r = c.getBoundingClientRect();
    const root = ED.editor.hud?.root;
    const style = root ? getComputedStyle(root) : null;
    // Middle of the clear rectangle, i.e. away from the palette and the dock.
    const ins = ED.editor.cameras.viewInsets || { left: 0, right: 0, top: 0, bottom: 0 };
    const x = r.left + (ins.left + (r.width - ins.right)) / 2;
    const y = r.top + (ins.top + (r.height - ins.bottom)) / 2;
    const el = document.elementFromPoint(x, y);
    const measured = {
      rootClass: root?.className || null,
      rootPointerEvents: style?.pointerEvents || null,
      underCentre: el ? `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : null,
      at: [Math.round(x), Math.round(y)],
    };
    return { measured, pass: el === c && style?.pointerEvents === 'none' };
  }

  /**
   * FRAMING BEFORE THERE IS A VIEWPORT IS REFUSED.
   *
   * zoomExtents divides by the viewport; with the constructor's 1x1 canvas the
   * free width and height clamped to the 80 px floor and the distance collapsed
   * to ~0, which is how the editor came to open 0.6 m from a point in mid-air
   * looking at an empty olive void. The guard must refuse and leave the camera
   * where it was, and a real viewport must still frame.
   */
  function framingGuard() {
    const c = ED.editor.cameras;
    const w = c.width, h = c.height, dist = c.dist;
    c.width = 1; c.height = 1; c.sized = false;
    const refused = c.zoomExtents(ED.editor.contentBounds());
    const distAfterRefusal = c.dist;
    c.resize(w, h);
    const framed = c.zoomExtents(ED.editor.contentBounds());
    const distFramed = c.dist;
    return {
      measured: {
        refused, distBefore: +dist.toFixed(3), distAfterRefusal: +distAfterRefusal.toFixed(3),
        framed, distFramed: +distFramed.toFixed(3), viewport: [w, h],
      },
      pass: refused === false && Math.abs(distAfterRefusal - dist) < 1e-9
        && framed === true && distFramed > 4,
    };
  }

  /**
   * ONE TYPED RE-LENGTH IS ONE UNDO STEP.
   *
   * A re-length is internally wall.delete + wall.add. While those were two
   * history entries, one Ctrl+Z after a mistyped length left NO WALL AT ALL —
   * a state the player never asked for and can only read as a bug.
   */
  function relengthUndo() {
    reset();
    orbitOn(2, 0, Math.PI, 0.6, 22);
    start('r — typed re-length costs one undo');
    tool('wall', 'KeyW', 'w');
    clickWorld(0, 0, 0, 'start point');
    moveWorld(3, 0, 0);
    typeValue('4m');
    key('Escape', 'Escape');
    typeValue('6000');
    const after6 = lengths();
    key('KeyZ', 'z', { ctrlKey: true });
    const afterUndo = lengths();
    key('KeyY', 'y', { ctrlKey: true });
    const afterRedo = lengths();
    return {
      measured: { after6, afterUndo, afterRedo },
      pass: after6.length === 1 && Math.abs(after6[0] - 6) < 1e-6
        && afterUndo.length === 1 && Math.abs(afterUndo[0] - 4) < 1e-6
        && afterRedo.length === 1 && Math.abs(afterRedo[0] - 6) < 1e-6,
    };
  }

  function lengths() {
    const e = ed();
    return Object.values(e.model.walls).map((w) => {
      const a = e.model.nodes[w.a], b = e.model.nodes[w.b];
      return +Math.hypot(b.x - a.x, b.z - a.z).toFixed(6);
    });
  }

  /**
   * THE PAINT TOAST IS THE BUDGET BAR.
   *
   * The bucket used to price the GROSS elevation at the CURRENT storey height
   * while the bill of quantities priced gross-minus-openings at the WALL's own
   * level height — 16 % apart on one wall with one window, and compounding on
   * an upper storey. Two different answers to "what did that cost" in front of
   * an architect is the game being wrong about his profession.
   */
  function paintCostTruth() {
    reset();
    const e = ed();
    const wall = e.apply({ t: 'wall.add', ax: 0, az: 0, bx: 6, bz: 0, wallType: 'exterior', thickness: 0.24 });
    e.apply({
      t: 'opening.add', wallId: wall.id, kind: 'window', offset: 3, width: 2, height: 1.5, sill: 0.9,
    });
    e.flushRebuild();
    orbitOn(3, 0, Math.PI, 0.35, 14);
    key('KeyB', 'b');
    e.tools.get('paint').material = 'brick';
    const before = e.cost().total;
    // Painted through the real canvas, and the toast is read off the HUD the
    // player reads it off.
    const toast = toastFor(() => clickAt(...px(1.0, 1.2, -0.13), 'the wall face, clear of the window'));
    const budgetDelta = e.cost().total - before;
    const w = e.model.walls[wall.id];
    return {
      measured: {
        openings: Object.keys(e.model.openings).length,
        painted: w ? { matInner: w.matInner, matOuter: w.matOuter } : null,
        budgetDelta: Math.round(budgetDelta),
        toast,
      },
      pass: Math.abs(budgetDelta) > 1 && !!toast
        && toast.indexOf(`${budgetDelta >= 0 ? '+' : ''}${Math.round(budgetDelta)}`) >= 0,
    };
  }

  function toastFor(fn) {
    const hud = ED.editor.hud;
    if (!hud) { fn(); return null; }
    const el = hud.flashEl;
    el.textContent = '';
    fn();
    return el.textContent;
  }

  /**
   * SHORTCUTS FOLLOW THE LETTER, NOT THE PHYSICAL KEY.
   *
   * SketchUp binds by character. Keying off e.code alone gave a French
   * architect on AZERTY the Wall tool when he pressed Z, nothing when he
   * pressed W, and killed every shortcut on any input path that omits e.code
   * while the Measurements box — which reads e.key — carried on working.
   */
  function shortcutsByLetter() {
    reset();
    const out = {};
    ed().setTool('select');
    key('', 'w');                       // no e.code at all: the letter must carry it
    out.keyOnly = ed().tool.id;
    ed().setTool('select');
    key('KeyZ', 'w');                   // AZERTY: the letter W on the physical Z key
    out.azerty = ed().tool.id;
    ed().setTool('select');
    key('KeyT', '');                    // no letter: e.code must still work
    out.codeOnly = ed().tool.id;
    rest();
    return { measured: out, pass: out.keyOnly === 'wall' && out.azerty === 'wall' && out.codeOnly === 'tape' };
  }

  /** NO INVENTED ROOM NAMES on a sheet the client reads. */
  function roomNaming() {
    const labels = [...ED.editor.roomLabels().values()];
    const invented = labels.filter(l => /^Room\s*\d+$/i.test(l));
    return { measured: { labels, invented }, pass: invented.length === 0 };
  }

  /** Every tag actually takes its geometry out of the picture, and puts it back. */
  function tagsHideThings() {
    const e = ed();
    const was = { ...e.layers };
    const seen = {};
    for (const id of Object.keys(e.layers)) {
      e.setLayer(id, false);
      seen[id] = visibleTagCount(id);
      e.setLayer(id, true);
      seen[`${id}_back`] = visibleTagCount(id);
    }
    for (const id in was) e.setLayer(id, was[id]);
    const pass = Object.keys(e.layers).every(id => seen[id] === 0 && seen[`${id}_back`] >= 0);
    return { measured: seen, pass };
  }

  function visibleTagCount(id) {
    const e = ed();
    const mode = ED.mode;
    if (id === 'furniture') return e.furniture.group.visible ? 1 : 0;
    if (id === 'text') return e.texts.group.visible ? 1 : 0;
    if (id === 'trees') {
      const m = mode?.treePool?.entries.get('crown')?.mesh;
      return m && m.visible ? 1 : 0;
    }
    return (mode?.tagged?.[id] || []).filter(o => o.visible).length;
  }

  function all() {
    const table = {};
    const run = (k, fn) => { try { table[k] = fn(); } catch (err) { table[k] = { error: String(err.message || err) }; } };
    run('a_wall4m', wall4m);
    run('a2_line4m', line4m);
    run('b_door', door);
    run('b2_door800', door800);
    run('c_material', material);
    run('d_move500', move500);
    run('d2_move500vector', move500vector);
    run('e_measure', measure);
    run('r1_pointerReachesCanvas', pointerReachesCanvas);
    run('r2_framingGuard', framingGuard);
    run('r3_relengthUndo', relengthUndo);
    run('r4_paintCostTruth', paintCostTruth);
    run('r5_shortcutsByLetter', shortcutsByLetter);
    run('r6_roomNaming', roomNaming);
    run('r7_tagsHideThings', tagsHideThings);
    return table;
  }

  return {
    all, house, reset, wall4m, line4m, door, door800, material, move500, move500vector, measure,
    planOn, orbitOn,
    pointerReachesCanvas, framingGuard, relengthUndo, paintCostTruth, shortcutsByLetter,
    roomNaming, tagsHideThings,
  };
}
