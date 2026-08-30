// os.js — the fictional retro operating system that runs on the desk computer.
//
//   createOS(ctx) -> { canvas, focus(), blur(), setTier(n), openApp(id),
//                      update(dt), dispose(), ... }
//
// ARCHITECTURE.md: the OS renders to a canvas that the office uses as the
// monitor's screen texture and that goes full-screen when focused — the SAME
// code path both times. So the OS never touches the DOM layout: it paints into
// one fixed-size, integer-resolution canvas (640x480, 800x600, 1024x768 or
// 1152x870 depending on the machine), and whoever displays it decides whether
// that canvas becomes a THREE.CanvasTexture or an <img>-sharp element scaled by
// an integer factor.
//
// Everything is aliased and hard-pixelled: a bitmap font (font.js), 1-pixel
// bevels (widgets.js), hand-set icons (icons.js), no alpha, no easing, and the
// OS draws its own cursor so the host browser's pointer never appears.

import { makeTheme, tierConfig, TIERS, BOOT, grantsFor } from './themes.js';
import { WindowManager, Win } from './wm.js';
import { fill, frameRect, checker, inside, VGA, text as drawText } from './widgets.js';
import { BODY, selectFaces, splitMnemonic } from './font.js';
import { I16, icon32 } from './icons.js';
import { MailApp } from './apps/mail.js';
import { ChatApp } from './apps/chat.js';
import { CostApp } from './apps/cost.js';
import { FilesApp } from './apps/files.js';
import { SettingsApp } from './apps/settings.js';

export { TIERS, grantsFor };

// The office monitor adapter. desks.js probes for exactly this name on
// src/os/os.js and falls back to a placeholder desktop when it is absent.
export { createOsSurface } from './surface.js';

const DBL_MS = 380;
// Win95's tooltip dwell. One frame, no animation, once the pointer has been
// still on a toolbar button this long.
const TIP_DELAY = 0.55;

export class OS {
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.state = ctx.state ?? null;
    this.audio = ctx.audio ?? null;
    this.net = ctx.net ?? null;

    this.tier = clampTier(ctx.tier ?? this.state?.get?.('office.computerTier') ?? 1);
    this.theme = makeTheme(this.tier);
    this.config = tierConfig(this.tier);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'os-canvas';
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.crtCanvas = document.createElement('canvas');
    this.crtG = this.crtCanvas.getContext('2d', { alpha: false });
    this.crt = false;
    this.crtWanted = ctx.crt === true;

    this.wm = new WindowManager(this);
    this.apps = new Map();
    this.desktopIcons = [];
    this.quickLaunch = [];
    this.startOpen = false;
    this.startMenuRect = null;
    this.startHot = null;
    this.hoverT = 0;
    this.menuOwner = null;
    this.menuIndex = -1;
    this.pressed = null;
    this.focused = false;
    this.dirty = true;
    this.frame = 0;
    this.time = 0;
    this.phase = 'boot';           // 'boot' | 'desktop' | 'off'
    this.bootT = 0;
    this.bootPlayed = false;
    this.cursor = { x: (this.theme.w / 2) | 0, y: (this.theme.h / 2) | 0, kind: 'arrow', visible: false };
    this.mouseDown = false;
    this.lastClick = { t: 0, x: -99, y: -99 };
    this.selectedIcon = -1;
    this.listeners = new Map();
    this.variants = [];
    this._clock = '';
    this._domHandlers = null;
    this.element = null;
    this.scale = 1;

    this.registerBuiltins();
    this.warmSounds();
    this.applyTier(this.tier, { boot: true });
  }

  // --- events --------------------------------------------------------------

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }

  emit(name, payload) {
    for (const fn of this.listeners.get(name) ?? []) {
      try { fn(payload); } catch (e) { console.error(`[os] handler ${name}`, e); }
    }
  }

  play(name, opts) {
    const a = this.audio;
    if (!a?.play) return;
    try {
      const h = a.play(name, opts);
      // AudioBus caches a sound asked for before assets/audio/manifest.json has
      // arrived as permanently missing. If the manifest has since loaded and the
      // name IS in it, clear that stale entry so the next play has a buffer.
      if (!h && a.manifest && a.manifest[name] && a.buffers && a.buffers.get(name) === null) {
        a.buffers.delete(name);
        a.load?.(name);
      }
    } catch (_) {}
  }

  /**
   * Decode the handful of sounds the OS itself needs before anything asks for
   * one. Without this the startup chime is requested while the manifest is
   * still in flight, is written off as missing, and the machine boots silent
   * for the rest of the session.
   */
  warmSounds() {
    const a = this.audio;
    if (!a?.load) return;
    const names = ['ui.click', 'ui.click-soft', 'ui.window-open', 'ui.window-close',
      'ui.error', 'ui.mail-notify', 'sfx.mouse-click',
      'sfx.keyboard-type-1', 'sfx.keyboard-type-2', 'sfx.keyboard-type-3', 'sfx.keyboard-type-4',
      ...TIERS.map((t) => t.sound)];
    Promise.resolve(a.manifest ? null : a.loadManifest?.())
      .then(() => { for (const n of names) { a.buffers?.delete(n); a.load(n); } })
      .catch(() => {});
  }

  invalidate() { this.dirty = true; }

  // --- apps ----------------------------------------------------------------

  /**
   * registerApp({ id, title, icon, window, create, mount, unmount, fullscreen })
   *
   *   create(ctx, os, win) -> instance      a native, canvas-drawn app
   *   mount(el, ctx) / unmount()            a foreign app that draws itself
   *
   * See the handoff note at the bottom of this file for the editor's contract.
   */
  registerApp(spec) {
    if (!spec?.id) throw new Error('registerApp needs an id');
    this.apps.set(spec.id, spec);
    if (spec.desktop !== false) this.layoutDesktop();
    if (spec.quickLaunch) this.quickLaunch.push({ id: spec.id, icon: spec.icon });
    this.invalidate();
    return () => { this.apps.delete(spec.id); this.layoutDesktop(); };
  }

  registerBuiltins() {
    const mk = (Cls) => (ctx, os, win) => new Cls(ctx, os, win);
    // menuLabel carries the "&" mnemonic every menu-borne copy of the name
    // needs. Checklist 15 wants exactly one underlined letter per item and the
    // letters unique within a list, so these are picked as a set, not per app:
    // Mail, P_rojects, Cost Sheet, Studio Talk, Machi_ne.
    this.registerApp({ id: 'mail', title: 'Mail', menuLabel: '&Mail', icon: 'mail', desktopIcon32: 'mail', create: mk(MailApp), window: { w: 0.86, h: 0.74 }, quickLaunch: true });
    this.registerApp({ id: 'files', title: 'Projects', menuLabel: 'P&rojects', icon: 'folder', desktopIcon32: 'folder', create: mk(FilesApp), window: { w: 0.62, h: 0.58 }, quickLaunch: true });
    // The Cost Sheet's budget band is two columns of live numbers — a left
    // caption and a right-aligned figure on each of two lines. Measured at the
    // old default minimum (220x140) they overprinted each other
    // ("Cost again§13budget| 240 000 credits"), and the grid collapsed to a
    // clipped header row. 360x240 is where the two strings stop touching at the
    // widest money this bill produces; below that the band also drops its right
    // column on its own (apps/cost.js), the way a Win95 status bar drops panes.
    this.registerApp({ id: 'cost', title: 'Cost Sheet', menuLabel: '&Cost Sheet', icon: 'cost', desktopIcon32: 'cost', create: mk(CostApp), window: { w: 0.80, h: 0.66, minW: 360, minH: 240 } });
    this.registerApp({ id: 'chat', title: 'Studio Talk', menuLabel: '&Studio Talk', icon: 'chat', desktopIcon32: null, create: mk(ChatApp), window: { w: 0.52, h: 0.58, minW: 300, minH: 220 } });
    this.registerApp({ id: 'settings', title: 'Machine', menuLabel: 'Machi&ne', icon: 'settings', desktopIcon32: 'computer', create: mk(SettingsApp), window: { w: 0.62, h: 0.78, minW: 380, minH: 380 } });
  }

  app(id) { return this.apps.get(id) ?? null; }

  openApp(id, params = {}) {
    const spec = this.apps.get(id);
    if (!spec) { console.warn(`[os] no app "${id}"`); return null; }
    const existing = this.wm.find(id);
    if (existing) {
      this.wm.focus(existing);
      existing.app?.onOpen?.(params);
      return existing;
    }
    const th = this.theme;

    if (spec.fullscreen) {
      // The 3D editor: the OS hands the whole screen over and steps aside.
      this.emit('fullscreen', { id, params });
      spec.launch?.(this.ctx, this, params);
      return null;
    }

    const wspec = spec.window ?? {};
    const w = Math.round((wspec.w > 1 ? wspec.w : (wspec.w ?? 0.6) * th.w) / 2) * 2;
    const h = Math.round((wspec.h > 1 ? wspec.h : (wspec.h ?? 0.6) * th.h) / 2) * 2;
    const n = this.wm.windows.length;
    const top = th.family === 'platinum' ? th.metrics.menuBarH + 4 : 8;
    const win = new Win({
      appId: id,
      title: spec.title,
      icon: spec.icon,
      x: 16 + (n % 5) * 22,
      y: top + (n % 5) * 20,
      w: Math.min(w, th.w - 40),
      h: Math.min(h, th.h - th.metrics.shellH - top - 20),
      resizable: wspec.resizable !== false,
      minW: wspec.minW ?? 220,
      minH: wspec.minH ?? 140,
    });
    if (spec.create) {
      win.app = spec.create(this.ctx, this, win);
      win.menu = win.app.menu ?? null;
      if (win.app.title) win.title = win.app.title;
    } else if (spec.mount) {
      win.foreign = spec;
      this.mountForeign(win, spec);
    }
    this.wm.open(win);
    win.app?.onOpen?.(params);
    this.emit('open', { id, win });
    return win;
  }

  /** A foreign app gets a positioned DOM element over the screen. */
  mountForeign(win, spec) {
    if (!this.element) return;
    const el = document.createElement('div');
    el.className = 'os-foreign';
    this.element.appendChild(el);
    win.foreignEl = el;
    spec.mount(el, this.ctx, this, win);
    win.onClose = () => { try { spec.unmount?.(); } catch (_) {} el.remove(); };
    this.syncForeign();
  }

  syncForeign() {
    for (const win of this.wm.windows) {
      if (!win.foreignEl) continue;
      const c = win.client ?? this.theme.clientOf(win);
      const s = this.scale;
      Object.assign(win.foreignEl.style, {
        left: `${c.x * s}px`, top: `${c.y * s}px`,
        width: `${c.w * s}px`, height: `${c.h * s}px`,
        display: win.minimized ? 'none' : 'block',
      });
    }
  }

  // --- tiers ---------------------------------------------------------------

  /**
   * Switch machine. `boot: false` is a *request to be already switched on*, not
   * a hint — src/office/desks.js calls it through skipBoot() so an unowned desk
   * shows a lit desktop the moment the office loads instead of replaying the
   * 5-second POST (and firing the startup chime once per surface).
   *
   * Round 2: the guard used to be `t === this.tier && this.phase !== 'off'`,
   * which ignored the flag, so skipBoot() on a machine that was already on the
   * requested tier returned having done nothing at all and left the screen in
   * 'boot'. Measured: setTier(1,{boot:false}) on a fresh tier-1 OS went
   * {tier:1,phase:'boot'} -> {tier:1,phase:'boot'}. The tier only has to be
   * left alone when the request is already satisfied — same tier AND already on
   * the desktop, or a plain boot request for the tier that is booting.
   */
  setTier(n, { boot = true } = {}) {
    const t = clampTier(n);
    if (t === this.tier && this.phase !== 'off' && (boot || this.phase === 'desktop')) return;
    this.applyTier(t, { boot });
  }

  applyTier(t, { boot = true } = {}) {
    const open = this.wm.windows.filter((w) => !w.modal && !w.foreign).map((w) => w.appId);
    this.wm.closeAll();
    this.tier = t;
    this.config = tierConfig(t);
    this.theme = makeTheme(t);
    this.canvas.width = this.theme.w;
    this.canvas.height = this.theme.h;
    this.crtCanvas.width = this.theme.w;
    this.crtCanvas.height = this.theme.h;
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.g.imageSmoothingEnabled = false;
    this.crtG.imageSmoothingEnabled = false;
    // The phosphor pass is OFF unless the monitor asks for it: the office turns
    // it on for the screen texture, the full-screen view keeps clean pixels.
    this.crt = this.crtWanted === true && !!this.config.crt;
    this.cursor.kind = this.config.cursorKind ?? 'arrow';
    this.cursor.x = Math.min(this.cursor.x, this.theme.w - 4);
    this.cursor.y = Math.min(this.cursor.y, this.theme.h - 4);
    this.state?.set?.('office.computerTier', t);
    this.layoutDesktop();
    this.reopen = open;
    if (boot) {
      this.phase = 'boot';
      this.bootT = 0;
      this.bootPlayed = false;
    } else {
      this.phase = 'desktop';
      this.restoreApps();
    }
    this.emit('tier', { tier: t, config: this.config, grants: this.config.grants });
    this.invalidate();
  }

  restoreApps() {
    const list = this.reopen?.length ? this.reopen : ['mail'];
    this.reopen = null;
    for (const id of list) if (this.apps.has(id)) this.openApp(id);
    this.wm.focus(this.wm.windows[this.wm.windows.length - 1]);
  }

  get grants() { return this.config.grants; }

  // --- desktop -------------------------------------------------------------

  layoutDesktop() {
    const th = this.theme;
    const pitch = th.metrics.iconPitch;
    const list = [];
    const push = (label, icon, run) => list.push({ label, icon, run });
    push(this.config.hardware, 'computer', () => this.openApp('settings'));
    push('Mail', 'mail', () => this.openApp('mail'));
    push('Projects', 'folder', () => this.openApp('files'));
    push('Cost Sheet', 'cost', () => this.openApp('cost'));
    push('Wastebasket', 'bin', () => this.wm.dialog({
      title: 'Wastebasket',
      message: '4 items.\nOne of them is a car park you should not\nhave drawn. It stays deleted.',
      icon: 'info',
    }));
    const mac = th.family === 'platinum';
    list.forEach((it, i) => {
      it.x = mac ? th.w - 78 : 10;
      it.y = (mac ? th.metrics.menuBarH + 10 : 8) + i * pitch;
      it.w = 68;
      it.h = 52;
      // The hit rectangle is set here, not in the paint pass: an icon must be
      // clickable on the first frame after a tier change, before any repaint.
      it._rect = { x: it.x, y: it.y, w: it.w, h: 48 };
    });
    this.desktopIcons = list;
  }

  paintDesktopIcons(g) {
    const pal = this.theme.pal;
    this.desktopIcons.forEach((it, i) => {
      if (!icon32(g, it.icon, it.x + 18, it.y, this.config.screenTint)) {
        I16[it.icon]?.draw(g, it.x + 26, it.y + 8);
      }
      const label = BODY.ellipsis(it.label, it.w);
      const tw = BODY.measure(label);
      const lx = it.x + ((it.w - tw) >> 1);
      const ly = it.y + 36;
      const on = this.selectedIcon === i;
      if (on) fill(g, lx - 2, ly - 1, tw + 4, 11, pal.hilite);
      BODY.draw(g, label, lx, ly, on ? pal.hiliteText : (this.theme.family === 'platinum' ? '#000000' : '#FFFFFF'));
      it._rect = { x: it.x, y: it.y, w: it.w, h: 48 };
    });
  }

  // --- shell ---------------------------------------------------------------

  clockText() {
    const d = new Date();
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
  }

  startItems() {
    const apps = [...this.apps.values()].filter((a) => a.desktop !== false);
    const items = [
      { label: '&Programs', icon: 'folder', submenu: apps.map((a) => ({ label: a.menuLabel ?? a.title, icon: a.icon, action: () => this.openApp(a.id) })) },
      { label: '&Documents', icon: 'docs', submenu: [
        { label: '&Brief.txt', icon: 'doc', action: () => this.openApp('mail') },
        { label: '&Cost sheet', icon: 'cost', action: () => this.openApp('cost') },
      ] },
      { label: '&Settings', icon: 'settings', action: () => this.openApp('settings') },
      { label: '&Find', icon: 'find', action: () => this.wm.dialog({ title: 'Find', message: 'Nothing here is lost.\nThe office is only three rooms.', icon: 'info' }) },
      // A book with a question mark, exactly as win95-05 draws its Help row.
      // The circled "i" is the Win98/2000 info glyph and stays where Windows
      // really uses it — on message boxes (checklist 18).
      { label: '&Help', icon: 'help', action: () => this.help() },
      { sep: true },
      { label: 'S&hut Down...', icon: 'computer', action: () => this.shutdownDialog() },
    ];
    return items;
  }

  /**
   * The Platinum tiers' menu bar.
   *
   * The two menus the OS owns are held on `this._bar` and REBUILT IN PLACE, not
   * reallocated. themes.js writes each entry's hit rectangle onto the object as
   * it paints it, and wm.menuBarHit() reads that rectangle back off a fresh
   * call to this method — so a menu that hands out a new object every call can
   * never be clicked. Measured: before this, `globalMenu()[0]._rect` was
   * `undefined` on every call after the paint, and the Apple menu on tiers 3
   * and 4 silently swallowed every click. The focused window's own menus were
   * fine because those objects belong to the app and are passed through.
   */
  globalMenu() {
    const focused = this.wm.focused;
    if (!this._bar) this._bar = { apple: { label: '&Apple' }, app: { appMenu: true } };
    const apple = this._bar.apple;
    apple.items = [
      { label: `About ${this.config.osName} ${this.config.osVersion}...`, action: () => this.about() },
      { sep: true },
      ...[...this.apps.values()].map((a) => ({ label: a.menuLabel ?? a.title, icon: a.icon, action: () => this.openApp(a.id) })),
      { sep: true },
      { label: 'Shut &Down...', action: () => this.shutdownDialog() },
    ];
    const own = (focused?.menu ?? []).map((m) => m);

    // The Application menu. Round 2 gave the Platinum tiers a Windows taskbar
    // with pressed/raised task buttons along the bottom AND a global menu bar
    // along the top, which is a chimera: no Mac ever shipped both. Mac OS 8
    // switches applications from the RIGHT END of the menu bar — the active
    // application's icon and name, and a menu of everything running with the
    // active one checked, above Hide Others / Show All. So that is what this is,
    // and `appMenu: true` tells the Platinum shells to hang it off the right
    // edge instead of adding it to the run on the left.
    const list = this.wm.taskList();
    const appMenu = this._bar.app;
    appMenu.label = focused?.title ?? this.config.osName;
    appMenu.icon = focused?.icon ?? 'square';
    appMenu.items = [
      { label: 'Hide Others', disabled: list.length < 2,
        action: () => { for (const w of list) if (w !== focused) this.wm.minimize(w); } },
      { label: 'Show All', disabled: !list.some((w) => w.minimized),
        action: () => { for (const w of list) w.minimized = false; this.invalidate(); } },
      { sep: true },
      ...(list.length
        ? list.map((w) => ({ label: w.title, icon: w.icon, checked: w === focused, action: () => this.wm.focus(w) }))
        : [{ label: 'No windows open', disabled: true }]),
    ];
    return [apple, ...own, appMenu];
  }

  about() {
    this.wm.dialog({
      title: `About ${this.config.osName}`,
      icon: 'info',
      w: 340, h: 150,
      message: `${this.config.osName} ${this.config.osVersion}\n${this.config.tagline}\n${this.config.hardware} - ${this.config.spec}\n${this.config.grants.note}`,
    });
  }

  help() {
    this.wm.dialog({
      title: 'Help',
      icon: 'info',
      w: 360, h: 150,
      message: 'Double-click an icon to open it.\nDrag a title bar to move a window.\nPress Escape to leave the screen and stand up.',
    });
  }

  shutdownDialog() {
    this.wm.dialog({
      title: 'Shut Down',
      icon: 'warning',
      w: 330, h: 140,
      message: 'Are you sure you want to shut down the machine?\nAnything not saved to Projects is lost.',
      buttons: ['&Yes', '&No'],
      onResult: (i) => { if (i === 0) { this.phase = 'off'; this.invalidate(); this.emit('shutdown', {}); } },
    });
  }

  // --- boot ----------------------------------------------------------------

  boot() {
    this.phase = 'boot';
    this.bootT = 0;
    this.bootPlayed = false;
    this.invalidate();
  }

  paintBoot(g) {
    const spec = BOOT[this.tier];
    spec.paint(g, this.theme, this.bootT);
  }

  // --- painting ------------------------------------------------------------

  paint() {
    // Repaint counter. The office monitor uploads its texture to the GPU only
    // on frames where this actually moved — see src/os/surface.js.
    this.frame++;
    const g = this.g;
    g.imageSmoothingEnabled = false;
    const th = this.theme;
    // Point the UI/BODY module bindings at this machine's typefaces before a
    // single pixel is drawn. Everything downstream — chrome, widgets, apps —
    // reads them live, so tiers 1-2 render in MS Sans Serif and tiers 3-4 in
    // Chicago and Geneva without either side knowing about the other.
    selectFaces(th.family);

    if (this.phase === 'off') {
      fill(g, 0, 0, th.w, th.h, '#000000');
      th.font.draw(g, this.offMessage(), 20, th.h - 24, '#808080');
      this.dirty = false;
      if (this.crt) this.composeCRT();
      return;
    }
    if (this.phase === 'boot') {
      this.paintBoot(g);
      this.dirty = false;
      if (this.crt) this.composeCRT();
      return;
    }

    th.paintDesktop(g, this);
    this.paintDesktopIcons(g);
    this.wm.paint(g);
    th.paintShell(g, this);
    if (this.startOpen && this.startMenuRect) th.paintStartMenu(g, this, this.startHot);
    this.wm.paintMenus(g);
    this.paintTip(g);
    if (this.focused && this.cursor.visible) this.paintCursor(g);
    this.dirty = false;
    this.syncForeign();
    if (this.crt) this.composeCRT();
  }

  /**
   * What the pointer is resting on, if it is the kind of thing that gets a tip:
   * a Quick Launch button, a taskbar button, or a toolbar button inside a
   * window. Everything else answers null and no tip is drawn.
   */
  tipFor(x, y) {
    if (this.wm.menu || this.startOpen || this.mouseDown) return null;
    for (const q of this.quickLaunch) {
      if (q._rect && inside(q._rect, x, y)) return { text: this.apps.get(q.id)?.title ?? q.id, rect: q._rect };
    }
    for (const win of this.wm.taskList()) {
      if (win._taskRect && inside(win._taskRect, x, y)) return { text: win.title, rect: win._taskRect };
    }
    const win = this.wm.hitWindow(x, y);
    for (const it of win?.app?.tools ?? []) {
      if (!it.sep && it._rect && inside(it._rect, x, y) && it.tip) return { text: it.tip, rect: it._rect };
    }
    return null;
  }

  paintTip(g) {
    if (this.hoverT < TIP_DELAY) return;
    const tip = this.tipFor(this.cursor.x, this.cursor.y);
    if (!tip) return;
    const pal = this.theme.pal;
    const f = this.theme.fontSmall;
    const w = f.measure(tip.text) + 7;
    const h = 17;
    let x = Math.min(this.theme.w - w - 1, tip.rect.x + 2);
    let y = tip.rect.y + tip.rect.h + 2;
    if (y + h > this.theme.h) y = tip.rect.y - h - 2;
    fill(g, x, y, w, h, pal.info);
    frameRect(g, x, y, w, h, pal.dark);   // 1 px black, no shadow, no radius
    f.draw(g, tip.text, x + 3, f.top(y, h), pal.infoText);
  }

  /** What the screen says once the machine is off. Not a Windows line on a Mac. */
  offMessage() {
    return this.theme.family === 'platinum'
      ? 'It is now safe to switch off your Macintosh.'
      : 'It is now safe to turn off your computer.';
  }

  paintCursor(g) {
    const spec = this.theme.cursor(this.cursor.kind);
    const x = (this.cursor.x - spec.hotX) | 0;
    const y = (this.cursor.y - spec.hotY) | 0;
    for (let row = 0; row < spec.art.length; row++) {
      const line = spec.art[row];
      for (let col = 0; col < line.length; col++) {
        const c = line[col];
        if (c === '.') continue;
        g.fillStyle = c === 'X' ? '#000000' : '#FFFFFF';
        g.fillRect(x + col, y + row, 1, 1);
      }
    }
  }

  /**
   * The CRT pass. This is a property of the MONITOR, not of the OS: the office
   * shows the phosphor version on the desk, and the same clean pixels go
   * full-screen. Keeping it in a second canvas means the chrome histogram of the
   * OS itself is never polluted by scanlines.
   */
  composeCRT() {
    const g = this.crtG;
    const th = this.theme;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.canvas, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#B4B4B4';
    for (let y = 1; y < th.h; y += 2) g.fillRect(0, y, th.w, 1);
    g.globalCompositeOperation = 'source-over';
  }

  setCrt(on) {
    this.crtWanted = on;
    this.crt = !!on && !!this.config.crt;
    this.invalidate();
  }

  /** The canvas an office monitor should texture from. */
  get screenCanvas() { return this.crt ? this.crtCanvas : this.canvas; }

  // --- input ---------------------------------------------------------------

  focus() {
    this.focused = true;
    this.cursor.visible = true;
    this.invalidate();
    this.emit('focus', {});
  }

  blur() {
    this.focused = false;
    this.cursor.visible = false;
    this.wm.closeMenu();
    this.startOpen = false;
    this.mouseDown = false;
    this.invalidate();
    this.emit('blur', {});
  }

  /** Move the in-OS cursor. x,y are OS pixels — the office converts from UV. */
  pointerMove(x, y) {
    const nx = clamp(x, 0, this.theme.w - 1);
    const ny = clamp(y, 0, this.theme.h - 1);
    if (nx === this.cursor.x && ny === this.cursor.y) return;
    this.cursor.x = nx; this.cursor.y = ny;
    this.hoverT = 0;
    if (this.phase === 'desktop') {
      if (this.startOpen && this.startMenuRect) {
        // While a cascade is open the parent row that opened it stays lit, even
        // though the pointer has left the parent menu entirely — that is how a
        // Win95 cascade reads as one connected object.
        const pinned = this.wm.menu?.owner === 'start';
        const hot = this.startMenuRect.items.find((i) => !i.sep && inside(i._rect, nx, ny)) ?? null;
        if (!pinned && hot !== this.startHot) this.startHot = hot;
        else if (pinned && hot && hot !== this.startHot && !hot.submenu) {
          this.wm.closeMenu();
          this.startHot = hot;
        }
      }
      this.wm.pointerMove(nx, ny, { down: this.mouseDown });
      this.cursor.kind = this.cursorFor(nx, ny);
    }
    this.invalidate();
  }

  cursorFor(x, y) {
    const base = this.config.cursorKind ?? 'arrow';
    if (this.wm.drag) return this.wm.drag.mode === 'resize' ? 'hresize' : base;
    const win = this.wm.hitWindow(x, y);
    if (win) {
      const p = this.wm.part(win, x, y);
      if (p.kind === 'resize') return 'hresize';
      if (p.kind === 'client' && win.app?.cursor) return win.app.cursor(x - p.rect.x, y - p.rect.y) ?? base;
    }
    return base;
  }

  pointerDown(button = 0) {
    if (this.phase === 'boot') { this.bootT = BOOT[this.tier].duration; return; }
    if (this.phase === 'off') { this.boot(); return; }
    const x = this.cursor.x, y = this.cursor.y;
    const now = performance.now();
    const double = now - this.lastClick.t < DBL_MS
      && Math.abs(x - this.lastClick.x) < 4 && Math.abs(y - this.lastClick.y) < 4;
    this.lastClick = { t: now, x, y };
    this.mouseDown = true;
    this.play('sfx.mouse-click');

    // Start menu / start button
    const th = this.theme;
    if (th.family === 'win') {
      const sb = th.startRect();
      if (inside(sb, x, y)) { this.toggleStart(); return; }
      if (this.startOpen) {
        const r = this.startMenuRect;
        const it = r.items.find((i) => !i.sep && inside(i._rect, x, y));
        if (it) {
          if (it.submenu) {
            // The parent STAYS OPEN behind its cascade, with the row that
            // opened it still highlighted and the Start button still pressed.
            // Round 2 closed it here, which left the submenu floating on bare
            // desktop with nothing to explain where it came from — a popup with
            // no parent is not something Windows 95 could draw.
            this.startHot = it;
            this.wm.openMenu('start', null, -1, it.submenu, { x: r.x + r.w - 4, y: it._rect.y });
            return;
          }
          this.startOpen = false;
          this.startHot = null;
          it.action?.(this);
          this.invalidate();
          return;
        }
        if (!inside(r, x, y) && !this.wm.menu) { this.startOpen = false; this.startHot = null; this.invalidate(); }
      }
      // task buttons
      for (const win of this.wm.taskList()) {
        if (win._taskRect && inside(win._taskRect, x, y)) {
          if (this.wm.focused === win && !win.minimized) this.wm.minimize(win);
          else this.wm.focus(win);
          return;
        }
      }
      for (const q of this.quickLaunch) {
        if (q._rect && inside(q._rect, x, y)) { this.openApp(q.id); return; }
      }
    } else if (th.metrics.shellH > 0) {
      // Only ATELIER has a bottom bar to click. VELLUM switches windows from
      // the Application menu, so a leftover _taskRect from another tier must
      // never keep swallowing clicks on the desktop.
      for (const win of this.wm.taskList()) {
        if (win._taskRect && inside(win._taskRect, x, y)) { this.wm.focus(win); return; }
      }
    }

    if (this.wm.pointerDown(x, y, { button, double })) return;

    // desktop
    const idx = this.desktopIcons.findIndex((i) => inside(i._rect, x, y));
    this.selectedIcon = idx;
    if (idx >= 0 && double) this.desktopIcons[idx].run(this);
    this.invalidate();
  }

  pointerUp() {
    this.mouseDown = false;
    if (this.phase !== 'desktop') return;
    this.wm.pointerUp(this.cursor.x, this.cursor.y);
  }

  wheel(dy) {
    if (this.phase !== 'desktop') return;
    this.wm.wheel(this.cursor.x, this.cursor.y, dy);
  }

  key(ev) {
    if (this.phase === 'boot') { this.bootT = BOOT[this.tier].duration; return true; }
    if (this.startOpen && ev.key === 'Escape') { this.startOpen = false; this.startHot = null; this.invalidate(); return true; }
    // Ctrl+Esc is how Windows 95 opened the Start menu from the keyboard.
    if (ev.ctrl && ev.key === 'Escape' && this.theme.family === 'win') { this.toggleStart(); return true; }
    if (ev.alt && !ev.ctrl && this.phase === 'desktop' && this.altMenu(ev)) return true;
    const handled = this.wm.key(ev);
    // You are sitting at a desk in front of a keyboard, so the keyboard makes a
    // noise. Only when the keystroke went somewhere (an app consumed it) and only
    // for the keys that actually move text — arrowing around a file list is not
    // typing. Four samples, picked at random, each one a little quieter than the
    // last press so a sentence does not come out as a machine gun.
    if (handled && (ev.char || ev.key === 'Backspace' || ev.key === 'Enter')) this.typeSound();
    return handled;
  }

  /**
   * Alt + a letter, the other half of checklist item 15.
   *
   * "Exactly one letter per menu item and per button label is underlined ...
   * and the underlines are ALWAYS VISIBLE." A permanently drawn underline that
   * does nothing is worse than no underline at all, so Alt has to arrive here
   * (see surface.js and attachDOM) and open the matching menu.
   *
   * Windows tiers only — and that is the point. The Mac never had mnemonics,
   * so tiers 3 and 4 draw no underlines (the Chicago face carries
   * mnemonics:false) and answer no Alt.
   */
  altMenu(ev) {
    if (this.theme.family !== 'win') return false;
    const ch = String(ev.char || '').toLowerCase();
    if (!ch || ch.length !== 1) return false;
    const win = this.wm.focused;
    const bar = win?.menu ?? [];
    for (let i = 0; i < bar.length; i++) {
      if (mnemonicOf(bar[i].label) !== ch) continue;
      const L = this.theme.layout(win);
      if (!L.menubar) return false;
      const r = bar[i]._rect ?? { x: L.menubar.x, y: L.menubar.y, h: L.menubar.h };
      this.wm.openMenu('win', win, i, bar[i].items, { x: r.x, y: L.menubar.y + L.menubar.h });
      return true;
    }
    // ...and the Start button, whose label really is "Start".
    if (ch === 's' && !bar.length) { this.toggleStart(); return true; }
    return false;
  }

  /** One keystroke. `dynamic` may only attenuate, so this is never louder than
   *  the level assets/audio/manifest.json declares for the sample. */
  typeSound() {
    const n = 1 + Math.floor(Math.random() * 4);
    this.play(`sfx.keyboard-type-${n}`, { dynamic: 0.75 + Math.random() * 0.25, rate: 0.96 + Math.random() * 0.08 });
  }

  toggleStart() {
    const open = !this.startOpen;
    // Closing the Start button closes anything cascading off it, and opening it
    // clears whatever menu was up. Either way the two never disagree.
    if (this.wm.menu?.owner === 'start') this.wm.closeMenu();
    this.startOpen = open;
    if (open) {
      this.startMenuRect = this.theme.startMenu(this);
      this.startHot = null;
    } else {
      this.startHot = null;
    }
    this.invalidate();
  }

  /** Attach to a DOM element for the full-screen path. */
  attachDOM(host) {
    const el = document.createElement('div');
    el.className = 'os-screen';
    el.appendChild(this.canvas);
    host.appendChild(el);
    this.element = el;
    this.host = host;
    this.resizeToHost();

    const toOS = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return [Math.floor((e.clientX - r.left) / this.scale), Math.floor((e.clientY - r.top) / this.scale)];
    };
    const h = {
      move: (e) => { const [x, y] = toOS(e); this.pointerMove(x, y); },
      down: (e) => { const [x, y] = toOS(e); this.pointerMove(x, y); this.focus(); this.pointerDown(e.button); e.preventDefault(); },
      up: () => this.pointerUp(),
      wheel: (e) => { this.wheel(Math.sign(e.deltaY) * 3); e.preventDefault(); },
      key: (e) => {
        if (!this.focused) return;
        const handled = this.key({
          key: e.key,
          char: e.key.length === 1 ? e.key : '',
          ctrl: e.ctrlKey || e.metaKey,
          shift: e.shiftKey,
          alt: e.altKey,
        });
        if (handled || e.key === 'Tab' || (e.altKey && e.key.length === 1)) e.preventDefault();
      },
      resize: () => this.resizeToHost(),
    };
    el.addEventListener('pointermove', h.move);
    el.addEventListener('pointerdown', h.down);
    window.addEventListener('pointerup', h.up);
    el.addEventListener('wheel', h.wheel, { passive: false });
    window.addEventListener('keydown', h.key);
    window.addEventListener('resize', h.resize);
    this._domHandlers = { el, h };
    this.focus();
    return el;
  }

  resizeToHost() {
    if (!this.element || !this.host) return;
    const availW = this.host.clientWidth || window.innerWidth;
    const availH = this.host.clientHeight || window.innerHeight;
    const s = Math.max(1, Math.floor(Math.min(availW / this.theme.w, availH / this.theme.h)));
    this.scale = s;
    this.canvas.style.width = `${this.theme.w * s}px`;
    this.canvas.style.height = `${this.theme.h * s}px`;
    this.element.style.width = `${this.theme.w * s}px`;
    this.element.style.height = `${this.theme.h * s}px`;
    this.syncForeign();
    this.invalidate();
  }

  // --- loop ----------------------------------------------------------------

  update(dt) {
    this.time += dt;
    if (this.phase === 'boot') {
      const spec = BOOT[this.tier];
      this.bootT += dt;
      if (!this.bootPlayed && this.bootT >= spec.soundAt) {
        this.bootPlayed = true;
        this.play(this.config.sound);
      }
      this.invalidate();
      if (this.bootT >= spec.duration) {
        this.phase = 'desktop';
        this.restoreApps();
        this.emit('ready', { tier: this.tier });
      }
    } else if (this.phase === 'desktop') {
      const c = this.clockText();
      if (c !== this._clock) { this._clock = c; this.invalidate(); }
      for (const win of this.wm.windows) {
        if (win.app?.update?.(dt)) this.invalidate();
      }
      // Tooltip dwell. Win95 waits, then the tip appears in one frame — no
      // fade, no slide (checklist 19). It is the only use of the tooltip cream
      // #FFFFE1 in the whole scheme, and round 2 defined the colour and then
      // never drew anything with it.
      if (this.hoverT < TIP_DELAY) {
        this.hoverT += dt;
        if (this.hoverT >= TIP_DELAY) this.invalidate();
      }
    }
    if (this.dirty) this.paint();
  }

  dispose() {
    const d = this._domHandlers;
    if (d) {
      d.el.removeEventListener('pointermove', d.h.move);
      d.el.removeEventListener('pointerdown', d.h.down);
      window.removeEventListener('pointerup', d.h.up);
      d.el.removeEventListener('wheel', d.h.wheel);
      window.removeEventListener('keydown', d.h.key);
      window.removeEventListener('resize', d.h.resize);
      d.el.remove();
    }
    this.wm.closeAll();
    this.listeners.clear();
    this._domHandlers = null;
    this.element = null;
  }
}

function clampTier(n) { return Math.max(1, Math.min(TIERS.length, n | 0)); }
/** "S&ettings" -> "e". The letter the underline sits under. */
function mnemonicOf(label) {
  const { text, index } = splitMnemonic(label);
  return index >= 0 ? text[index].toLowerCase() : null;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v | 0)); }

/**
 * createOS(ctx) — the surface the rest of the game uses.
 *
 * ctx = { state, audio, net, ... } (the same ctx every Mode gets).
 * Returns the OS instance, which satisfies the documented shape:
 *   { canvas, screenCanvas, focus(), blur(), setTier(n), openApp(id),
 *     update(dt), dispose(), registerApp(spec), on(event, fn), grants }
 */
export function createOS(ctx = {}) {
  return new OS(ctx);
}

export default createOS;
