// input.js — keyboard/mouse, a rebindable action map, pointer lock, mouse rays.
//
// Modes never read event.code directly. They ask for actions:
//   input.down('forward')        held this frame
//   input.pressed('interact')    went down since the last frame
//   input.released('jump')
//   input.axis2('move')          -> {x, y} from the WASD cluster
// Rebinding is a map edit, so a settings screen is a data change, not code.

import { Vector2, Vector3, Raycaster, Plane } from 'three';

export const DEFAULT_BINDINGS = {
  // movement
  'forward':      ['KeyW', 'ArrowUp'],
  'back':         ['KeyS', 'ArrowDown'],
  'left':         ['KeyA', 'ArrowLeft'],
  'right':        ['KeyD', 'ArrowRight'],
  'jump':         ['Space'],
  'sprint':       ['ShiftLeft', 'ShiftRight'],
  'crouch':       ['KeyC'],
  'up':           ['KeyE'],          // editor free-camera vertical
  'down':         ['KeyQ'],

  // general
  'interact':     ['KeyF', 'KeyE'],
  'cancel':       ['Escape'],
  'confirm':      ['Enter'],
  'chat':         ['KeyT'],
  'menu':         ['Escape'],
  'debug.toggle': ['Backquote'],
  'debug.wire':   ['F9'],

  // editor tools — the numbers are the muscle memory a CAD user already has
  'tool.select':  ['Digit1', 'KeyV'],
  'tool.wall':    ['Digit2', 'KeyW'],     // only active when not walking
  'tool.door':    ['Digit3'],
  'tool.window':  ['Digit4'],
  'tool.slab':    ['Digit5'],
  'tool.furnish': ['Digit6'],
  'tool.material':['Digit7'],
  'tool.text':    ['Digit8'],
  'tool.measure': ['KeyM'],

  // editor operations
  'edit.undo':    ['KeyZ'],               // with ctrl/meta, see modifier() below
  'edit.redo':    ['KeyY'],
  'edit.delete':  ['Delete', 'Backspace'],
  'edit.duplicate':['KeyD'],
  'edit.snap':    ['AltLeft', 'AltRight'],
  'edit.ortho':   ['ShiftLeft'],

  // camera
  'view.top':     ['KeyO'],
  'view.orbit':   ['KeyP'],
  'view.walk':    ['KeyL'],
  'view.focus':   ['KeyH'],
};

export class Input {
  /**
   * @param {HTMLElement} target  the canvas (pointer lock + mouse events)
   */
  constructor(target, opts = {}) {
    this.target = target;
    this.bindings = { ...DEFAULT_BINDINGS, ...(opts.bindings || {}) };
    this._keyToActions = new Map();
    this.rebuildLookup();

    this.keys = new Set();          // held key codes
    this._downThisFrame = new Set();
    this._upThisFrame = new Set();

    this.mouse = new Vector2(0, 0);       // pixels, canvas-relative
    this.ndc = new Vector2(0, 0);         // -1..1
    this.wheel = 0;
    this.movement = new Vector2(0, 0);    // pointer-lock delta, consumed per frame
    this.buttons = new Set();
    this._btnDownThisFrame = new Set();
    this._btnUpThisFrame = new Set();

    this.pointerLocked = false;
    this.enabled = true;
    this.mouseSensitivity = opts.mouseSensitivity ?? 0.0022;   // rad per pixel
    this.invertY = false;

    this._raycaster = new Raycaster();
    this._plane = new Plane(new Vector3(0, 1, 0), 0);
    this._hit = new Vector3();

    this._listeners = { lock: new Set(), unlock: new Set(), action: new Set() };
    this._bind();
  }

  rebuildLookup() {
    this._keyToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes) {
        if (!this._keyToActions.has(code)) this._keyToActions.set(code, []);
        this._keyToActions.get(code).push(action);
      }
    }
  }

  /** Rebind one action. codes is an array of KeyboardEvent.code strings. */
  rebind(action, codes) {
    this.bindings[action] = Array.isArray(codes) ? codes : [codes];
    this.rebuildLookup();
  }

  // -- queries -------------------------------------------------------------

  /** Is any key bound to this action held right now? */
  down(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this._downThisFrame.has(c)) return true;
    return false;
  }

  released(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this._upThisFrame.has(c)) return true;
    return false;
  }

  keyDown(code) { return this.keys.has(code); }

  /** WASD as a normalised-ish vector: x = strafe (+right), y = forward (+forward). */
  axis2() {
    const x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const y = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    if (x !== 0 && y !== 0) return { x: x * Math.SQRT1_2, y: y * Math.SQRT1_2 };
    return { x, y };
  }

  mouseDown(button = 0) { return this.buttons.has(button); }
  mousePressed(button = 0) { return this._btnDownThisFrame.has(button); }
  mouseReleased(button = 0) { return this._btnUpThisFrame.has(button); }

  /** ctrl on Windows/Linux, cmd on macOS — one question for both. */
  get ctrl() { return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('MetaLeft') || this.keys.has('MetaRight'); }
  get shift() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }
  get alt() { return this.keys.has('AltLeft') || this.keys.has('AltRight'); }

  /** Consume the accumulated pointer-lock delta (radians ready for a camera). */
  consumeLook() {
    const dx = this.movement.x * this.mouseSensitivity;
    const dy = this.movement.y * this.mouseSensitivity * (this.invertY ? -1 : 1);
    this.movement.set(0, 0);
    return { yaw: -dx, pitch: -dy };
  }

  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  // -- rays ----------------------------------------------------------------

  /** A raycaster set up from the current mouse (or screen centre when locked). */
  ray(camera) {
    const c = this.pointerLocked ? { x: 0, y: 0 } : this.ndc;
    this._raycaster.setFromCamera(c, camera);
    return this._raycaster;
  }

  /**
   * Where the mouse ray meets a horizontal plane at height y.
   * The workhorse for wall drawing and furniture placement.
   * Returns a Vector3 or null when the ray is parallel to / behind the plane.
   */
  groundPoint(camera, y = 0, target = new Vector3()) {
    const r = this.ray(camera);
    this._plane.set(new Vector3(0, 1, 0), -y);
    const hit = r.ray.intersectPlane(this._plane, this._hit);
    if (!hit) return null;
    return target.copy(this._hit);
  }

  /** First intersection with a list of objects, or null. */
  pick(camera, objects, recursive = true) {
    const hits = this.ray(camera).intersectObjects(objects, recursive);
    return hits.length ? hits[0] : null;
  }

  // -- pointer lock --------------------------------------------------------

  requestLock() {
    if (this.pointerLocked) return;
    const p = this.target.requestPointerLock?.({ unadjustedMovement: true });
    // Safari and Firefox reject the options object; fall back to the plain call.
    if (p && typeof p.catch === 'function') p.catch(() => { try { this.target.requestPointerLock(); } catch (_) {} });
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  on(event, fn) {
    this._listeners[event]?.add(fn);
    return () => this._listeners[event]?.delete(fn);
  }

  _emit(event, arg) {
    const set = this._listeners[event];
    if (set) for (const fn of set) fn(arg);
  }

  // -- plumbing ------------------------------------------------------------

  _bind() {
    const t = this.target;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (isTypingTarget(e.target)) return;
      if (!this.keys.has(e.code)) this._downThisFrame.add(e.code);
      this.keys.add(e.code);
      const actions = this._keyToActions.get(e.code);
      if (actions) for (const a of actions) this._emit('action', { action: a, code: e.code, event: e });
      // Stop the browser eating the keys we care about (space scrolls, / searches).
      if (this._keyToActions.has(e.code) && e.code !== 'Escape' && !this.ctrl) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      if (this.keys.has(e.code)) this._upThisFrame.add(e.code);
      this.keys.delete(e.code);
    };
    // A window blur while keys are held would otherwise leave the player walking.
    this._onBlur = () => { this.keys.clear(); this.buttons.clear(); this.movement.set(0, 0); };

    this._onMouseMove = (e) => {
      // Deltas accumulate in both modes: pointer-locked look, and drag-to-orbit
      // in the editor where the cursor stays visible.
      this.movement.x += e.movementX || 0;
      this.movement.y += e.movementY || 0;
      if (!this.pointerLocked) {
        const r = t.getBoundingClientRect();
        this.mouse.set(e.clientX - r.left, e.clientY - r.top);
        this.ndc.set((this.mouse.x / r.width) * 2 - 1, -(this.mouse.y / r.height) * 2 + 1);
      }
    };
    this._onMouseDown = (e) => {
      if (!this.buttons.has(e.button)) this._btnDownThisFrame.add(e.button);
      this.buttons.add(e.button);
    };
    this._onMouseUp = (e) => {
      if (this.buttons.has(e.button)) this._btnUpThisFrame.add(e.button);
      this.buttons.delete(e.button);
    };
    this._onWheel = (e) => { this.wheel += e.deltaY; e.preventDefault(); };
    this._onContext = (e) => e.preventDefault();

    this._onLockChange = () => {
      const locked = document.pointerLockElement === t;
      if (locked === this.pointerLocked) return;
      this.pointerLocked = locked;
      this.movement.set(0, 0);
      this._emit(locked ? 'lock' : 'unlock');
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    t.addEventListener('mousemove', this._onMouseMove);
    t.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    t.addEventListener('wheel', this._onWheel, { passive: false });
    t.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', () => console.warn('[input] pointer lock denied'));
  }

  /** Called by the engine at the END of every frame. */
  endFrame() {
    this._downThisFrame.clear();
    this._upThisFrame.clear();
    this._btnDownThisFrame.clear();
    this._btnUpThisFrame.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.target.removeEventListener('mousemove', this._onMouseMove);
    this.target.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.target.removeEventListener('wheel', this._onWheel);
    this.target.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}
