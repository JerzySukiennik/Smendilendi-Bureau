// playthrough.js — drive the whole core loop from a running page.
//
// This is the QA harness for src/core/loop.js: menu -> office -> desk ->
// monitor -> OS -> editor -> submit -> client mail -> revision -> resubmit ->
// walkthrough -> office. Every action goes through the same listeners a player
// uses (mousemove/mousedown/mouseup on the canvas, pointer events for the
// editor, keydown on the window); nothing here reaches into a mode and calls
// a game function directly, EXCEPT where a comment says so.
//
// It exists because the Claude browser pane suspends requestAnimationFrame
// whenever it is not being screenshotted, so the game does not advance between
// tool calls. tools/shot.js `step()` drives the engine by hand; this file is
// the script that plays on top of it.

import { Vector3 } from 'three';
import { step, run, shot, pin, click, tap, hold, move } from './shot.js';

export { step, run, shot, pin, click, tap, hold, move };

export function sb() { return window.SB; }
export function eng() { return window.SB.engine; }
export function office() { return eng().modes.get('office')?.office; }
export function editorMode() { return eng().modes.get('editor'); }
export function editor() { return editorMode()?.editor; }
export function walk() { return eng().modes.get('walk'); }
export function loop() { return window.SB.loop; }

// ---------------------------------------------------------------------------
// pointer events (the editor listens to these, not to mouse events)

function pointerEvent(type, x, y, extra = {}) {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, view: window, pointerId: 1,
    pointerType: 'mouse', isPrimary: true,
    clientX: x, clientY: y, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, ...extra,
  });
}

export function pMove(x, y) {
  eng().canvas.dispatchEvent(pointerEvent('pointermove', x, y, { buttons: 0 }));
  step(1);
}

export function pClick(x, y, { settle = 2 } = {}) {
  const c = eng().canvas;
  c.dispatchEvent(pointerEvent('pointermove', x, y, { buttons: 0 }));
  step(1);
  c.dispatchEvent(pointerEvent('pointerdown', x, y));
  step(1);
  window.dispatchEvent(pointerEvent('pointerup', x, y));
  step(settle);
}

/** World point -> client pixel, through whichever camera the editor is using. */
export function worldToClient(x, y, z, camera = null) {
  const cam = camera || editor().cameras.camera;
  const v = new Vector3(x, y, z).project(cam);
  const r = eng().canvas.getBoundingClientRect();
  return {
    x: r.left + (v.x * 0.5 + 0.5) * r.width,
    y: r.top + (-v.y * 0.5 + 0.5) * r.height,
  };
}

// ---------------------------------------------------------------------------
// stage 1 — the menu

export async function boot({ tries = 40 } = {}) {
  for (let i = 0; i < tries && !window.SB; i++) await new Promise((r) => setTimeout(r, 200));
  if (!window.SB) throw new Error('the app never booted');
  pin(1280, 720);
  step(30);
  return { mode: sb().state.get('mode') };
}

/** Click the SINGLE PLAYER lettering on the building. */
export function singlePlayer() {
  const menu = eng().modes.get('menu');
  const hit = menu.lines.find((l) => l.id === 'single').hit;
  hit.updateWorldMatrix(true, false);
  if (!hit.geometry.boundingBox) hit.geometry.computeBoundingBox();
  const p = hit.localToWorld(hit.geometry.boundingBox.getCenter(new Vector3()));
  p.project(menu.camera);
  const r = eng().canvas.getBoundingClientRect();
  const x = r.left + (p.x * 0.5 + 0.5) * r.width;
  const y = r.top + (-p.y * 0.5 + 0.5) * r.height;
  move(x, y); step(2);
  const hovering = menu.hoverItem;
  click(x, y, { steps: 6 });
  return { x: Math.round(x), y: Math.round(y), hovering, mode: sb().state.get('mode') };
}

// ---------------------------------------------------------------------------
// stage 2 — the desk

/** Walk forward until the crosshair is on a workstation screen. */
export function walkToDesk({ maxSeconds = 12 } = {}) {
  const o = office();
  const log = [];
  for (let i = 0; i < maxSeconds * 2; i++) {
    const h = o.interact.hover;
    if (h && h.kind === 'screen') return { found: h.id, steps: i, log };
    hold('KeyW', 30);
    log.push([+o.player.pos.x.toFixed(2), +o.player.pos.z.toFixed(2), o.interact.hover?.id ?? null]);
  }
  return { found: null, log };
}

/** F on the highlighted monitor: sit down and fly the camera to the screen. */
export function sitDown() {
  tap('KeyF');
  step(120);                                  // the 0.85 s flight, with margin
  const o = office();
  return {
    focus: !!o.interact.focus,
    at: o.interact.focus?.workstation?.slot?.index,
    t: o.interact.focus?.t,
  };
}

// ---------------------------------------------------------------------------
// stage 2b — the in-world OS

/** The workstation the player is sitting at. */
export function ws() { return office()?.interact?.focus?.workstation ?? null; }

/**
 * An OS pixel -> a client pixel on the canvas.
 * The office maps the mouse onto the screen quad by raycasting it and reading
 * the uv, so this is that mapping run backwards: OS pixel -> view-canvas uv ->
 * a point on the screen plane in world space -> projected through the camera.
 */
export function osToClient(ox, oy) {
  const w = ws();
  if (!w) throw new Error('not at a screen');
  const surf = w.os;
  const os = surf.os;
  const vw = surf.canvas.width, vh = surf.canvas.height;
  const dx = (vw - os.theme.w) >> 1, dy = (vh - os.theme.h) >> 1;
  const u = (ox + dx) / vw, v = (oy + dy) / vh;
  const screen = w.screen;
  screen.updateWorldMatrix(true, false);
  const g = screen.geometry.parameters;        // PlaneGeometry(w, h)
  const world = screen.localToWorld(new Vector3((u - 0.5) * g.width, (0.5 - v) * g.height, 0));
  world.project(office().camera);
  const r = eng().canvas.getBoundingClientRect();
  return {
    x: r.left + (world.x * 0.5 + 0.5) * r.width,
    y: r.top + (-world.y * 0.5 + 0.5) * r.height,
  };
}

/**
 * Click at an OS pixel, through the world. The office reads input.ndc every
 * frame while focused and pushes it into the OS as pointer(u, v, buttons), so
 * a real mousedown held across a frame is what makes the OS see a click.
 */
export function osClick(ox, oy, { double = false } = {}) {
  const p = osToClient(ox, oy);
  const c = eng().canvas;
  const ev = (type, buttons) => new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: p.x, clientY: p.y, button: 0, buttons,
  });
  const once = () => {
    c.dispatchEvent(ev('mousemove', 0)); step(2);
    c.dispatchEvent(ev('mousedown', 1)); step(2);
    window.dispatchEvent(ev('mouseup', 0)); step(2);
  };
  once();
  if (double) once();
  step(2);
  return { at: [Math.round(p.x), Math.round(p.y)], os: ws().os.os.phase };
}

/** Where the Design button sits in the OS quick-launch tray. */
export function designRect() {
  const os = ws().os.os;
  const q = os.quickLaunch.find((e) => e.id === 'editor');
  return q?._rect ?? null;
}

/** Run Design from the quick-launch tray. */
export function openDesign() {
  const r = designRect();
  if (!r) return { ok: false, why: 'the Design app is not on the tray' };
  osClick(r.x + (r.w >> 1), r.y + (r.h >> 1));
  step(60);
  return { ok: sb().state.get('mode') === 'editor', mode: sb().state.get('mode') };
}

// ---------------------------------------------------------------------------
// stage 3 — drawing

/** Put the editor in the top-down plan view, framed on the buildable area. */
export function planView() {
  const ed = editor();
  ed.setView('plan');
  step(90);
  ed.cameras.zoomExtents(ed.contentBounds());
  step(30);
  return { view: ed.cameras.mode };
}

/** Pick a tool by its own shortcut key, the way a user does. */
export function tool(id) {
  const keys = { select: ['Space', ' '], line: ['KeyL', 'l'], rect: ['KeyR', 'r'],
    wall: ['KeyW', 'w'], door: ['KeyD', 'd'], window: ['KeyN', 'n'], slab: ['KeyG', 'g'] };
  const k = keys[id];
  if (k) tap(k[0], { key: k[1] });
  const ed = editor();
  const viaKey = ed.tool?.id === id;
  if (!viaKey) ed.setTool(id);                 // the HUD tool button does exactly this
  step(2);
  return { tool: ed.tool?.id, viaKey };
}

/** Two clicks in the world = one rectangle of walls. */
export function drawRect(x0, z0, x1, z1) {
  const ed = editor();
  const a = worldToClient(x0, 0, z0);
  const b = worldToClient(x1, 0, z1);
  const before = Object.keys(ed.model.walls).length;
  pClick(a.x, a.y);
  pMove(b.x, b.y);
  pClick(b.x, b.y, { settle: 6 });
  return { walls: Object.keys(ed.model.walls).length, added: Object.keys(ed.model.walls).length - before };
}

/** Two clicks in the world = one wall. */
export function drawWall(x0, z0, x1, z1) {
  const ed = editor();
  const a = worldToClient(x0, 0, z0);
  const b = worldToClient(x1, 0, z1);
  const before = Object.keys(ed.model.walls).length;
  pClick(a.x, a.y);
  pMove(b.x, b.y);
  pClick(b.x, b.y, { settle: 6 });
  tap('Escape');
  return { walls: Object.keys(ed.model.walls).length, added: Object.keys(ed.model.walls).length - before };
}

/** One click on a wall = one opening of the current tool's kind. */
export function cutOpening(x, z) {
  const ed = editor();
  const p = worldToClient(x, 1.0, z);
  const before = Object.keys(ed.model.openings).length;
  pClick(p.x, p.y, { settle: 6 });
  return { openings: Object.keys(ed.model.openings).length, added: Object.keys(ed.model.openings).length - before };
}

// ---------------------------------------------------------------------------
// stage 4 — the HUD buttons

export function hudButton(label) {
  const root = editorMode()?.hud?.root;
  if (!root) return null;
  for (const b of root.querySelectorAll('button')) {
    if ((b.textContent || '').trim().toLowerCase().startsWith(label.toLowerCase())) return b;
  }
  return null;
}

export function clickHud(label) {
  const b = hudButton(label);
  if (!b) return { ok: false, why: `no button "${label}"` };
  const r = b.getBoundingClientRect();
  click(r.left + r.width / 2, r.top + r.height / 2, { steps: 3 });
  return { ok: true, label: b.textContent.trim() };
}

// ---------------------------------------------------------------------------
// waiting

/** Advance the engine AND real time together until `fn()` is true. */
export async function until(fn, { seconds = 20, dt = 1 / 60 } = {}) {
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    if (fn()) return true;
    step(15, dt);
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

export function status() {
  const s = sb().state;
  const l = loop();
  const rep = s.get('analysis');
  return {
    mode: s.get('mode'),
    stack: eng().modeStack.map((m) => m.id),
    phase: l.phase,
    round: l.round,
    commission: s.get('commission')?.title,
    walls: Object.keys(s.get('model')?.walls || {}).length,
    mail: (s.get('mail.messages') || []).map((m) => `${m.from}: ${m.subject}`),
    score: rep?.score,
    accepted: rep?.accepted,
    issues: rep?.issues?.length,
    bank: s.get('bank.balance'),
  };
}

Object.assign(window, {
  __P: {
    boot, singlePlayer, walkToDesk, sitDown, osClick, openDesign, designRect,
    planView, tool, drawRect, drawWall, cutOpening, clickHud, hudButton,
    until, status, shot, step, run, pin, worldToClient, osToClient, ws,
    editor, editorMode, office, walk, loop, pClick, pMove, move, tap, hold, click,
  },
});

// ---------------------------------------------------------------------------
// stage 3 — draw something an architect would recognise as a building

/** The rectangle we lay the shell on: centred in the buildable area. */
export function shellRect() {
  const c = sb().state.get('commission');
  const poly = (c.plot.buildable && c.plot.buildable.length >= 3) ? c.plot.buildable : c.plot.boundary;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  const w = Math.min(14, Math.max(6, (maxX - minX) - 1.6));
  const d = Math.min(10, Math.max(6, (maxZ - minZ) - 1.6));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return { x0: +(cx - w / 2).toFixed(2), x1: +(cx + w / 2).toFixed(2),
           z0: +(cz - d / 2).toFixed(2), z1: +(cz + d / 2).toFixed(2), cx, cz, w, d };
}

/**
 * The shell, one cross wall and the doors, drawn with the editor's own tools.
 * Plan view for the walls (an orthographic top-down cursor lands exactly where
 * it is pointed) and the 3D view for the openings (the Door tool picks a wall
 * FACE, and a plan cut shows a wall's top, not its face).
 */
export function drawBuilding() {
  const ed = editor();
  const r = shellRect();
  const out = { rect: r };

  tap('F2', { key: 'F2' });                 // Plan
  step(120);
  clickHud('Zoom extents');
  step(30);
  out.view = ed.cameras.mode;

  tool('rect');
  out.shell = drawRect(r.x0, r.z0, r.x1, r.z1);

  tool('wall');
  out.cross = drawWall(r.cx, r.z0, r.cx, r.z1);
  out.cross2 = drawWall(r.x0, r.cz, r.cx, r.cz);

  tap('F3', { key: 'F3' });                 // back to 3D for the openings
  step(120);
  clickHud('Zoom extents');
  step(40);
  out.view3d = ed.cameras.mode;
  out.rooms = Object.keys(ed.rooms().rooms).length;
  return out;
}

/** Point at the outside face of the wall between (ax,az) and (bx,bz) and click. */
export function openingOnWall(ax, az, bx, bz, outward = 1) {
  const ed = editor();
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * outward, nz = (dx / len) * outward;
  const before = Object.keys(ed.model.openings).length;
  // 130 mm proud of the centreline: outside the 240 mm wall face, not inside it
  const p = worldToClient(mx + nx * 0.13, 1.0, mz + nz * 0.13);
  pMove(p.x, p.y);
  const pending = ed.tool?.pending ? { ...ed.tool.pending, wall: undefined, a: undefined, b: undefined } : null;
  pClick(p.x, p.y, { settle: 6 });
  return {
    added: Object.keys(ed.model.openings).length - before,
    openings: Object.keys(ed.model.openings).length,
    pending,
  };
}

// ---------------------------------------------------------------------------
// stages 4-7

export async function submitAndWait({ seconds = 40 } = {}) {
  const st = sb().state;
  const before = (st.get('mail.messages') || []).length;
  const round = loop().round;
  const clicked = clickHud('Submit') .ok ? 'Submit' : clickHud('Resubmit').ok ? 'Resubmit' : null;
  const gotMail = await until(() => (st.get('mail.messages') || []).length > before, { seconds });
  return {
    clicked, gotMail,
    round: loop().round, roundWas: round, phase: loop().phase,
    mode: st.get('mode'),
    score: st.get('analysis')?.score,
    accepted: st.get('analysis')?.accepted,
    issues: (st.get('analysis')?.issues || []).length,
    subject: (st.get('mail.messages') || [])[0]?.subject,
  };
}

/** Open Design again, cut one more window, hand it back. */
export async function reviseAndResubmit() {
  const opened = openDesign();
  if (!opened.ok) return { opened, fixed: null };
  const ed = editor();
  const r = shellRect();
  tool('window');
  const fix = [
    openingOnWall(r.x0, r.z0, r.x1, r.z0, -1),
    openingOnWall(r.x1, r.z0, r.x1, r.z1, 1),
  ];
  const sub = await submitAndWait();
  return { opened, fix, sub };
}

export async function waitForWalk({ seconds = 60 } = {}) {
  const st = sb().state;
  const got = await until(() => st.get('mode') === 'walk', { seconds });
  if (!got) return { got, mode: st.get('mode'), phase: loop().phase };
  // The nine-second cut, then the navmesh and the people, built in slices.
  const w = walk();
  await until(() => w.ready, { seconds: 60, dt: 1 / 30 });
  // A minute of occupancy at 5 simulated minutes a second, so the heat map has
  // something in it before the report is read.
  for (let i = 0; i < 40; i++) { step(30, 1 / 20); await new Promise((r) => setTimeout(r, 5)); }
  return { got, ready: w.ready, phase: w.phase, people: w.crowd?.agents?.length, hour: w.hour };
}

/** R opens the post-occupancy report; the sheet's own button goes back. */
export async function endWalk() {
  const w = walk();
  tap('KeyR', { key: 'r' });
  step(10);
  const sheet = document.querySelector('.poe-back');
  const out = { report: w.phase, hadSheet: !!sheet };
  if (sheet) {
    await shot('loop-08b-report.png');
    const r = sheet.getBoundingClientRect();
    click(r.left + r.width / 2, r.top + r.height / 2, { steps: 10 });
  }
  await until(() => sb().state.get('mode') === 'office', { seconds: 20 });
  await until(() => loop().phase === 'settled' || loop().phase === 'brief', { seconds: 20 });
  out.mode = sb().state.get('mode');
  out.phase = loop().phase;
  out.bank = sb().state.get('bank.balance');
  return out;
}

// ---------------------------------------------------------------------------
// walking without a mouse
//
// Pointer lock is the one input a synthetic event cannot produce, so the yaw
// is whatever the office spawned with. That is not a dead end: forward/back
// and strafe left/right span the floor plane, so any point is reachable by
// decomposing the vector to it into the player's own basis and holding the
// two keys that correspond. It is exactly what a player does when he sidesteps
// round a desk without turning his head.

export function walkTo(x, z, { bursts = 90, near = 0.45, burst = 18 } = {}) {
  const o = office();
  const p = o.player;
  const log = [];
  // The eight ways a first-person player can move without turning his head.
  const COMBOS = [
    { k: ['KeyW'], f: 1, r: 0 },
    { k: ['KeyW', 'KeyD'], f: 0.707, r: 0.707 },
    { k: ['KeyD'], f: 0, r: 1 },
    { k: ['KeyS', 'KeyD'], f: -0.707, r: 0.707 },
    { k: ['KeyS'], f: -1, r: 0 },
    { k: ['KeyS', 'KeyA'], f: -0.707, r: -0.707 },
    { k: ['KeyA'], f: 0, r: -1 },
    { k: ['KeyW', 'KeyA'], f: 0.707, r: -0.707 },
  ];
  let banned = -1;
  for (let i = 0; i < bursts; i++) {
    const dx = x - p.pos.x, dz = z - p.pos.z;
    const d0 = Math.hypot(dx, dz);
    if (d0 < near) break;
    const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    const wantF = (dx * -sn + dz * -cs) / d0;
    const wantR = (dx * cs + dz * -sn) / d0;
    // Best heading first; a heading that made no progress last time is skipped
    // once, which is what gets a player round the end of a desk rather than
    // grinding into its side for ever.
    const order = COMBOS.map((c, idx) => ({ c, idx, dot: c.f * wantF + c.r * wantR }))
      .sort((a, b) => b.dot - a.dot)
      .filter((e) => e.idx !== banned || e.dot > 0.99);
    const pick = order[0];
    for (const k of pick.c.k) window.dispatchEvent(new KeyboardEvent('keydown', { code: k, key: k, bubbles: true }));
    step(burst);
    for (const k of pick.c.k) window.dispatchEvent(new KeyboardEvent('keyup', { code: k, key: k, bubbles: true }));
    step(1);
    const d1 = Math.hypot(x - p.pos.x, z - p.pos.z);
    log.push([+p.pos.x.toFixed(2), +p.pos.z.toFixed(2), pick.c.k.join('+'), +d1.toFixed(2)]);
    banned = (d0 - d1 < 0.04) ? pick.idx : -1;
  }
  return {
    at: [+p.pos.x.toFixed(2), +p.pos.z.toFixed(2)],
    distance: +Math.hypot(x - p.pos.x, z - p.pos.z).toFixed(2),
    hover: o.interact.hover?.id ?? null,
    bursts: log.length,
    log: log.slice(-14),
  };
}

/**
 * Stand where the crosshair falls on workstation `index`'s monitor.
 * The crosshair is fixed at the centre of the screen, so the standing point is
 * the monitor pushed back along the direction the player is facing.
 */
export function standAtDesk(index = 0) {
  const o = office();
  const w = o.workstations[index];
  const p = new Vector3();
  w.screen.getWorldPosition(p);
  const yaw = o.player.yaw;
  const tries = [];
  for (const back of [1.5, 1.15, 1.9, 0.9]) {
    const target = { x: p.x + Math.sin(yaw) * back, z: p.z + Math.cos(yaw) * back };
    const r = walkTo(target.x, target.z);
    tries.push({ back, target: [+target.x.toFixed(2), +target.z.toFixed(2)], ...r });
    step(4);
    const h = o.interact.hover;
    if (h && h.kind === 'screen') return { ok: true, hover: h.id, tries };
  }
  return { ok: false, hover: o.interact.hover?.id ?? null, tries };
}

// ---------------------------------------------------------------------------
// the whole loop, start to finish

const LOG = { started: new Date().toISOString(), stages: [] };

async function post(name, obj) {
  try {
    await fetch(`/__shot/${name}`, { method: 'POST', body: btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2)))) });
  } catch (_) {}
}

async function stage(name, fn) {
  const t0 = performance.now();
  let out, err = null;
  try { out = await fn(); } catch (e) { err = String(e && e.stack || e); }
  LOG.stages.push({ name, ms: Math.round(performance.now() - t0), out, err, status: safeStatus() });
  await post('loop-log.json', LOG);
  if (err) throw new Error(`${name}: ${err}`);
  return out;
}

function safeStatus() { try { return status(); } catch (e) { return { error: String(e) }; } }

/**
 * Play the whole thing. Fire and forget:
 *   import('/tools/playthrough.js').then(P => P.playAll());
 * and read progress/shots/loop-log.json as it goes.
 */
export async function playAll(opts = {}) {
  LOG.stages.length = 0;
  LOG.started = new Date().toISOString();

  await stage('boot', async () => boot());
  await stage('shot:menu', () => shot('loop-01-menu.png'));
  await stage('single player', async () => { const r = singlePlayer(); await run(2.5); return r; });
  await stage('shot:office', () => shot('loop-02-office-brief.png'));

  await stage('walk to the desk', () => standAtDesk(0));
  await stage('sit down', () => sitDown());
  await stage('shot:monitor', () => shot('loop-03-at-the-monitor.png'));

  await stage('open Design', () => openDesign());
  await stage('shot:editor', () => shot('loop-04-editor.png'));

  await stage('draw the building', () => drawBuilding(opts.plan));
  await stage('shot:drawn', () => shot('loop-05-drawn.png'));

  await stage('submit', () => submitAndWait());
  await stage('shot:client mail', () => shot('loop-06-client-mail.png'));

  await stage('revision', () => reviseAndResubmit());
  await stage('shot:resubmitted', () => shot('loop-07-resubmitted.png'));

  await stage('walkthrough', () => waitForWalk());
  await stage('shot:walkthrough', () => shot('loop-08-walkthrough.png'));

  await stage('back to the office', () => endWalk());
  await stage('shot:office again', () => shot('loop-09-back-in-office.png'));

  LOG.finished = new Date().toISOString();
  await post('loop-log.json', LOG);
  return LOG;
}

Object.assign(window.__P || (window.__P = {}), { walkTo, standAtDesk, playAll });
