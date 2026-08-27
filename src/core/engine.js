// engine.js — one renderer, one loop, one mode stack.
//
// Adaptive quality (ARCHITECTURE.md, "non-negotiable"):
//   powerPreference 'high-performance'
//   start setPixelRatio(min(devicePixelRatio, 1.75))
//   rolling 2 s average frame time
//   > 22 ms  -> step -0.25, floor 1.0
//   <= 17 ms -> step +0.25, ceiling min(devicePixelRatio, 1.75)
//   6 s cooldown between steps
//
// The mode stack is a stack, not a swap: the Editor is PUSHED over the Office so
// that popping it returns to the office exactly as it was, at the desk.

import {
  WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace, PCFSoftShadowMap, ColorManagement,
} from 'three';
import { DebugOverlay } from './debug.js';

export const QUALITY = {
  MAX_RATIO: 1.75,
  MIN_RATIO: 1.0,
  STEP: 0.25,
  WINDOW: 2.0,        // s of frames averaged before a decision
  WARMUP: 60,         // frames ignored after a start/resize (shader compilation)
  STALL_MS: 200,      // a frame slower than this is a stall, not a quality signal
  DOWN_MS: 22,
  UP_MS: 17,
  COOLDOWN: 6.0,      // s between steps
};

export class Engine {
  constructor(canvas, opts = {}) {
    ColorManagement.enabled = true;

    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFSoftShadowMap;
    r.shadowMap.autoUpdate = true;
    r.info.autoReset = true;

    this.maxRatio = Math.min(window.devicePixelRatio || 1, QUALITY.MAX_RATIO);
    this.pixelRatio = this.maxRatio;
    this.qualityStepCount = 0;
    this._qAcc = 0;
    this._qFrames = 0;
    this._qCooldown = 0;
    this._qWarmup = QUALITY.WARMUP;

    this.width = 1;
    this.height = 1;

    this.modeStack = [];
    this.modes = new Map();        // id -> instance (so a mode is init()ed once)
    this.ctx = null;               // set by App via setContext()

    this.running = false;
    this.clockLast = 0;
    this.time = 0;
    this.frame = 0;
    this.maxDt = opts.maxDt ?? 0.1;   // a tab-switch must not teleport the player

    this.debug = null;
    this._hooks = { update: new Set(), resize: new Set() };

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    // A window dragged to a second display with a different DPI changes dpr.
    this._dprQuery = null;
    this._watchDpr();

    this._onContextLost = (e) => {
      e.preventDefault();
      console.error('[engine] WebGL context lost — pausing the loop');
      this.stop();
    };
    this._onContextRestored = () => {
      console.warn('[engine] WebGL context restored');
      this.resize();
      this.start();
    };
    canvas.addEventListener('webglcontextlost', this._onContextLost);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);

    this.resize();
  }

  setContext(ctx) { this.ctx = ctx; }

  attachDebug(el) {
    this.debug = new DebugOverlay(el, this);
    return this.debug;
  }

  // -- modes ---------------------------------------------------------------

  get activeMode() { return this.modeStack[this.modeStack.length - 1] || null; }

  register(mode) {
    this.modes.set(mode.id, mode);
    return mode;
  }

  _ensureInit(mode) {
    if (!mode.initialised) {
      const t0 = performance.now();
      mode.init(this.ctx);
      console.info(`[engine] mode "${mode.id}" initialised in ${(performance.now() - t0).toFixed(0)} ms`);
      mode.resize?.(this.width, this.height);
    }
  }

  /** Push a mode on top of the stack. The one below is suspended, not disposed. */
  push(modeOrId, params = {}) {
    const mode = typeof modeOrId === 'string' ? this.modes.get(modeOrId) : modeOrId;
    if (!mode) throw new Error(`[engine] unknown mode "${modeOrId}"`);
    if (typeof modeOrId !== 'string') this.modes.set(mode.id, mode);
    const cur = this.activeMode;
    if (cur === mode) return mode;
    if (cur) cur.exit();
    this._ensureInit(mode);
    this.modeStack.push(mode);
    mode.resize?.(this.width, this.height);
    mode.enter(params);
    this.ctx?.state?.set('mode', mode.id);
    return mode;
  }

  /** Pop back to whatever was underneath. Returns the newly active mode. */
  pop(params = {}) {
    if (this.modeStack.length <= 1) return this.activeMode;
    const gone = this.modeStack.pop();
    gone.exit();
    const cur = this.activeMode;
    cur.resize?.(this.width, this.height);
    cur.enter(params);
    this.ctx?.state?.set('mode', cur.id);
    return cur;
  }

  /** Replace the whole stack (menu -> office). */
  replace(modeOrId, params = {}) {
    while (this.modeStack.length) this.modeStack.pop().exit();
    return this.push(modeOrId, params);
  }

  onUpdate(fn) { this._hooks.update.add(fn); return () => this._hooks.update.delete(fn); }
  onResize(fn) { this._hooks.resize.add(fn); return () => this._hooks.resize.delete(fn); }

  // -- sizing --------------------------------------------------------------

  resize() {
    const el = this.canvas.parentElement || document.body;
    const w = Math.max(1, el.clientWidth || window.innerWidth);
    const h = Math.max(1, el.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this._qWarmup = Math.max(this._qWarmup, 20);
    for (const m of this.modeStack) m.resize?.(w, h);
    for (const fn of this._hooks.resize) fn(w, h);
  }

  _watchDpr() {
    if (!window.matchMedia) return;
    const attach = () => {
      const q = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        this.maxRatio = Math.min(window.devicePixelRatio || 1, QUALITY.MAX_RATIO);
        this.pixelRatio = Math.min(this.pixelRatio, this.maxRatio);
        this.resize();
        attach();
      };
      if (q.addEventListener) q.addEventListener('change', onChange, { once: true });
      this._dprQuery = q;
    };
    try { attach(); } catch (_) { /* older Safari: no resolution media query */ }
  }

  // -- adaptive quality ----------------------------------------------------

  _adapt(frameMs, dt) {
    // A stall is not a quality signal. Shader compilation on the first frames, a
    // backgrounded tab, a GC pause or a mode init all produce frame times in the
    // hundreds of ms; letting them into the average drops the resolution of a
    // machine that is actually fine. Warm up, then reject outliers.
    if (this._qWarmup > 0) { this._qWarmup--; return; }
    if (frameMs > QUALITY.STALL_MS) return;

    this._qAcc += frameMs;
    this._qFrames++;
    if (this._qCooldown > 0) this._qCooldown -= dt;
    const windowMs = QUALITY.WINDOW * 1000;
    if (this._qAcc < windowMs) return;

    const avg = this._qAcc / this._qFrames;
    this._qAcc = 0;
    this._qFrames = 0;
    if (this._qCooldown > 0) return;

    if (avg > QUALITY.DOWN_MS && this.pixelRatio > QUALITY.MIN_RATIO) {
      this._setRatio(Math.max(QUALITY.MIN_RATIO, this.pixelRatio - QUALITY.STEP), avg);
    } else if (avg <= QUALITY.UP_MS && this.pixelRatio < this.maxRatio) {
      this._setRatio(Math.min(this.maxRatio, this.pixelRatio + QUALITY.STEP), avg);
    }
  }

  _setRatio(v, avg) {
    if (Math.abs(v - this.pixelRatio) < 1e-6) return;
    const dir = v > this.pixelRatio ? 'up' : 'down';
    this.pixelRatio = v;
    this.qualityStepCount++;
    this._qCooldown = QUALITY.COOLDOWN;
    this.renderer.setPixelRatio(v);
    this.renderer.setSize(this.width, this.height, false);
    this._qWarmup = 20;
    console.info(`[engine] quality ${dir} -> dpr ${v.toFixed(2)} (avg ${avg.toFixed(1)} ms)`);
  }

  /** Force a pixel ratio and stop adapting (settings screen "quality: fixed"). */
  lockPixelRatio(v) {
    this.pixelRatio = Math.max(QUALITY.MIN_RATIO, Math.min(v, this.maxRatio));
    this._qCooldown = Infinity;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
  }

  // -- loop ----------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.clockLast = performance.now();
    this.renderer.setAnimationLoop((now) => this._tick(now));
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick(now) {
    const t = now ?? performance.now();
    let dt = (t - this.clockLast) / 1000;
    this.clockLast = t;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > this.maxDt) dt = this.maxDt;
    this.time += dt;
    this.frame++;

    const mode = this.activeMode;
    try {
      if (mode) mode.update(dt);
      for (const fn of this._hooks.update) fn(dt, this.time);
      if (mode) mode.render(this.renderer);
    } catch (err) {
      console.error('[engine] frame failed, stopping the loop to avoid a log flood', err);
      this.stop();
      throw err;
    }

    const frameMs = performance.now() - t;
    this._adapt(frameMs, dt);
    this.debug?.update(dt, frameMs);
    this.ctx?.input?.endFrame();
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
    for (const m of this.modes.values()) m.dispose?.();
    this.modes.clear();
    this.modeStack.length = 0;
    this.renderer.dispose();
  }
}
