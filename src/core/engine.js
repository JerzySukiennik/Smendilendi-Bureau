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

/**
 * QualityController — the adaptive-quality state machine, with NO renderer in it.
 *
 * Round 1 shipped this logic inline in Engine, where the only way to check it was
 * to read it. It is a clock-driven state machine, so it now takes its clock as an
 * argument: tick(frameMs, dt) is the whole input, `onChange` is the whole output,
 * and tools/verify-core.mjs drives thousands of synthetic seconds through it in
 * node and asserts the resulting ladder.
 *
 * Rules (ARCHITECTURE.md, "non-negotiable"):
 *   start at min(devicePixelRatio, 1.75)
 *   average frame time over a 2 s window
 *   avg > 22 ms  -> ratio -= 0.25, floor 1.0
 *   avg <= 17 ms -> ratio += 0.25, ceiling min(devicePixelRatio, 1.75)
 *   6 s cooldown between steps
 * Plus two guards that are not decoration: WARMUP frames after any start, resize
 * or step are ignored (shader compilation), and any frame over STALL_MS is thrown
 * away rather than averaged (a GC pause or a backgrounded tab is not a quality
 * signal — averaged in, one 900 ms hitch drags a healthy 16 ms average over the
 * 22 ms line and permanently downgrades a machine that was fine).
 */
export class QualityController {
  constructor({ maxRatio = QUALITY.MAX_RATIO, onChange = null, spec = QUALITY } = {}) {
    this.spec = spec;
    this.maxRatio = Math.max(spec.MIN_RATIO, Math.min(maxRatio, spec.MAX_RATIO));
    this.pixelRatio = this.maxRatio;
    this.onChange = onChange;
    this.stepCount = 0;
    this.locked = false;
    this.time = 0;          // seconds of ticks seen — the injected clock
    this.lastStepAt = -Infinity;
    this._acc = 0;          // ms of accepted frames in the current window
    this._frames = 0;
    this._warmup = spec.WARMUP;
    this._rejected = 0;     // frames thrown away as stalls (debug overlay)
  }

  /** Ignore the next `n` frames — call after a resize or an expensive mode init. */
  warmup(n = 20) { this._warmup = Math.max(this._warmup, n); }

  /** Force a ratio without touching the cooldown (settings screen, tests). */
  set(v) {
    const next = Math.max(this.spec.MIN_RATIO, Math.min(v, this.maxRatio));
    if (Math.abs(next - this.pixelRatio) < 1e-6) return false;
    this.pixelRatio = next;
    this._acc = 0; this._frames = 0;
    this.warmup(20);
    this.onChange?.(next, { dir: 'set', avg: null, at: this.time });
    return true;
  }

  /** Pin the ratio and stop adapting. */
  lock(v = this.pixelRatio) { this.set(v); this.locked = true; }
  unlock() { this.locked = false; this.lastStepAt = this.time; }

  /** The device changed DPI (window dragged to another display). */
  setMaxRatio(v) {
    this.maxRatio = Math.max(this.spec.MIN_RATIO, Math.min(v, this.spec.MAX_RATIO));
    if (this.pixelRatio > this.maxRatio) this.set(this.maxRatio);
  }

  /**
   * One frame. `frameMs` is how long the frame took, `dt` how long since the
   * previous one, in seconds. Returns true if the pixel ratio changed.
   */
  tick(frameMs, dt) {
    const s = this.spec;
    this.time += dt;
    if (this.locked) return false;
    if (this._warmup > 0) { this._warmup--; return false; }
    if (frameMs > s.STALL_MS) { this._rejected++; return false; }

    this._acc += frameMs;
    this._frames++;
    if (this._acc < s.WINDOW * 1000) return false;

    const avg = this._acc / this._frames;
    this._acc = 0;
    this._frames = 0;
    if (this.time - this.lastStepAt < s.COOLDOWN) return false;

    if (avg > s.DOWN_MS && this.pixelRatio > s.MIN_RATIO) {
      return this._step(Math.max(s.MIN_RATIO, this.pixelRatio - s.STEP), avg, 'down');
    }
    if (avg <= s.UP_MS && this.pixelRatio < this.maxRatio) {
      return this._step(Math.min(this.maxRatio, this.pixelRatio + s.STEP), avg, 'up');
    }
    return false;
  }

  _step(v, avg, dir) {
    if (Math.abs(v - this.pixelRatio) < 1e-6) return false;
    this.pixelRatio = v;
    this.stepCount++;
    this.lastStepAt = this.time;
    this.warmup(20);
    this.onChange?.(v, { dir, avg, at: this.time });
    return true;
  }
}

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

    this.quality = new QualityController({
      maxRatio: Math.min(window.devicePixelRatio || 1, QUALITY.MAX_RATIO),
      onChange: (v, why) => {
        this.renderer.setPixelRatio(v);
        this.renderer.setSize(this.width, this.height, false);
        if (why.dir !== 'set') {
          console.info(`[engine] quality ${why.dir} -> dpr ${v.toFixed(2)} (avg ${why.avg.toFixed(1)} ms)`);
        }
      },
    });

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

  // The renderer-facing view of the quality state machine.
  get pixelRatio() { return this.quality.pixelRatio; }
  get maxRatio() { return this.quality.maxRatio; }
  get qualityStepCount() { return this.quality.stepCount; }

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

  /**
   * Compile every shader this mode will need, BEFORE its first frame.
   *
   * three.js compiles a program the first time a given material/light/shadow
   * combination is actually drawn, and that compile is synchronous on the main
   * thread. In a room the player walks around, that means the frame where a new
   * corner first comes into view can block for seconds — which is exactly what
   * Jurek reported: "normally it's fine, about 30 fps, but every so often
   * there's a massive lag spike where I can't walk for about 5 seconds."
   *
   * Nothing in this project pre-compiled anything, so every one of those
   * compiles landed mid-play. Doing them here moves the cost into the loading
   * moment, where a pause is expected and invisible.
   *
   * `compileAsync` (three r152+) yields between programs instead of blocking, so
   * the boot itself does not freeze either; we fall back to the synchronous
   * `compile` where it is missing, and swallow failures because a warm-up that
   * throws must never stop a mode from opening.
   */
  _warmShaders(mode) {
    const scene = mode.scene;
    const camera = mode.camera || mode.office?.camera;
    if (!scene || !camera) return;
    try {
      const t0 = performance.now();
      if (this.renderer.compileAsync) {
        this.renderer.compileAsync(scene, camera).then(() => {
          console.info(`[engine] "${mode.id}" shaders warm in ${(performance.now() - t0).toFixed(0)} ms`);
        }).catch(() => {});
      } else {
        this.renderer.compile(scene, camera);
        console.info(`[engine] "${mode.id}" shaders warm in ${(performance.now() - t0).toFixed(0)} ms`);
      }
    } catch (_) { /* a cold shader is a stutter; a thrown warm-up is a dead game */ }
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
    this._warmShaders(mode);
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
    this._warmShaders(cur);
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
    this.quality.warmup(20);
    for (const m of this.modeStack) m.resize?.(w, h);
    for (const fn of this._hooks.resize) fn(w, h);
  }

  _watchDpr() {
    if (!window.matchMedia) return;
    const attach = () => {
      const q = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => {
        this.quality.setMaxRatio(Math.min(window.devicePixelRatio || 1, QUALITY.MAX_RATIO));
        this.resize();
        attach();
      };
      if (q.addEventListener) q.addEventListener('change', onChange, { once: true });
      this._dprQuery = q;
    };
    try { attach(); } catch (_) { /* older Safari: no resolution media query */ }
  }

  // -- adaptive quality ----------------------------------------------------

  _adapt(frameMs, dt) { this.quality.tick(frameMs, dt); }

  /** Force a pixel ratio and stop adapting (settings screen "quality: fixed"). */
  lockPixelRatio(v) { this.quality.lock(v); }

  /** Hand control back to the adaptive loop. */
  unlockPixelRatio() { this.quality.unlock(); }

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
