// camera.js — the three editor cameras and every navigation verb.
//
// THE RULE (reference/sketchup/ANALYSIS.md §6): navigation NEVER interrupts a
// tool. Orbit, pan and zoom live on their own buttons and modifiers and are
// handled here, on listeners of our own, so a wall drag survives an orbit.
//
// Mouse verbs, verbatim from the Quick Reference Card:
//   scroll wheel          zoom, ANCHORED TO THE CURSOR, speed scaling with the
//                         distance from the camera to whatever is under it
//   middle-drag           orbit
//   shift + middle-drag   pan
//   middle double-click   re-centre the view on the point under the cursor
// A MacBook trackpad has no middle button, so the same verbs are also on
//   alt-drag              orbit
//   alt + shift-drag      pan
//   right-drag            pan
//
// Three views, animated between (never a jump cut):
//   'orbit'  perspective, SketchUp-like, the default
//   'plan'   true orthographic top-down, north up — the drawing view
//   'walk'   eye level at 1.65 m, WASD + drag to look
//
// The plan transition narrows the perspective field of view to 8 degrees while
// flying up, so by the time the orthographic camera takes over the two
// projections are visually indistinguishable and the swap cannot be seen.

import {
  PerspectiveCamera, OrthographicCamera, Vector3, Vector2, Quaternion, Euler,
  MathUtils, Plane, Ray, Box3,
} from 'three';
import { EYE_HEIGHT } from './constants.js';

const UP = new Vector3(0, 1, 0);
const PLAN_UP = new Vector3(0, 0, -1);      // north (-Z) points up the screen
const ORBIT_FOV = 50;
const PLAN_FOV = 8;                          // near-orthographic at the end of the flight
const WALK_FOV = 62;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const ZERO_INSETS = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Does any sphere in `list` sit on the segment a-b (or swallow its start)?
 * Used to keep Zoom Extents from parking the camera inside a tree canopy.
 */
function blocked(a, b, list) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  for (const o of list) {
    const r = (o.r ?? 0) + 0.4;
    const px = o.x - a.x, py = (o.y ?? a.y) - a.y, pz = o.z - a.z;
    let t = len2 > 1e-6 ? (px * abx + py * aby + pz * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - abx * t, dy = py - aby * t, dz = pz - abz * t;
    if (dx * dx + dy * dy + dz * dz < r * r) return true;
  }
  return false;
}

export class EditorCameras {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   *   pickPoint(ndc) -> Vector3|null   what is under the cursor, for zoom anchoring
   *   onChange()                       fired whenever the view moved
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.pickPoint = opts.pickPoint || null;
    this.onChange = opts.onChange || null;

    this.persp = new PerspectiveCamera(ORBIT_FOV, 1, 0.05, 2000);
    this.ortho = new OrthographicCamera(-10, 10, 10, -10, -500, 1000);
    this.ortho.up.copy(PLAN_UP);

    this.mode = 'orbit';
    this.width = 1;
    this.height = 1;
    // False until resize() has been given a real viewport. Framing maths that
    // divides by the viewport is meaningless before that.
    this.sized = false;

    // Pixels of the viewport covered by the HUD. The HUD measures its own
    // panels and writes this; framing then aims at what is left.
    this.viewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
    // () -> [{ x, y, z, r }] — things the camera should not look through.
    this.obstacles = opts.obstacles || null;

    // orbit state
    this.target = new Vector3(4, 1.2, 4);
    this.dist = 22;
    this.yaw = -2.35;
    this.pitch = 0.62;

    // plan state
    this.planCentre = new Vector2(4, 4);
    this.planHeight = 24;                    // metres of world visible vertically

    // walk state
    this.walkPos = new Vector3(0, EYE_HEIGHT, 12);
    this.walkYaw = Math.PI;
    this.walkPitch = 0;

    // transition
    this._anim = null;

    this._drag = null;
    this._lastMiddleClick = 0;
    this._plane = new Plane(UP.clone(), 0);
    this._ray = new Ray();
    this._tmp = new Vector3();
    this._tmp2 = new Vector3();
    this._q = new Quaternion();

    this._bind();
    this._apply();
  }

  get camera() {
    if (this.mode === 'plan' && !this._anim) return this.ortho;
    return this.persp;
  }

  get animating() { return !!this._anim; }

  /** True while the mouse is driving the camera — tools stay live but do not draw. */
  get navigating() { return !!this._drag; }

  resize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.sized = this.width >= 2 && this.height >= 2;
    this.persp.aspect = this.width / this.height;
    this.persp.updateProjectionMatrix();
    this._applyOrtho();
  }

  // -- view switching --------------------------------------------------------

  /** setView('orbit'|'plan'|'walk'), animated unless `instant`. */
  setView(mode, { instant = false } = {}) {
    if (mode === this.mode && !this._anim) return;
    const from = this._currentPose();
    // Entering plan from a 3D view: frame what we were looking at.
    if (mode === 'plan') {
      this.planCentre.set(this.target.x, this.target.z);
      if (this.mode !== 'plan') this.planHeight = Math.max(6, this.dist * 0.9);
    }
    if (mode === 'walk' && this.mode !== 'walk') {
      // Stand where the orbit camera is looking, facing the target.
      const dir = this._tmp.copy(this.target).sub(this.persp.position);
      this.walkYaw = Math.atan2(-dir.x, -dir.z);
      this.walkPitch = 0;
      const back = this._tmp2.set(Math.sin(this.walkYaw), 0, Math.cos(this.walkYaw)).multiplyScalar(6);
      this.walkPos.set(this.target.x + back.x, EYE_HEIGHT, this.target.z + back.z);
    }
    if (mode === 'orbit' && this.mode === 'walk') {
      this.target.set(
        this.walkPos.x - Math.sin(this.walkYaw) * 6,
        1.2,
        this.walkPos.z - Math.cos(this.walkYaw) * 6,
      );
      this.yaw = this.walkYaw + Math.PI;
      this.pitch = 0.5;
      this.dist = 14;
    }
    this.mode = mode;
    const to = this._poseFor(mode);
    if (instant) { this._anim = null; this._apply(); this.onChange?.(); return; }
    this._anim = { t: 0, dur: 0.7, from, to };
  }

  cycleView() {
    const order = ['orbit', 'plan', 'walk'];
    this.setView(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  /**
   * Frame a Box3 (Shift+Z, Zoom Extents).
   *
   * Two things a naive implementation gets wrong and this one does not.
   * FIRST, the drawing is not centred on the canvas, it is centred on the part
   * of the canvas nobody is standing on: `viewInsets` carries the width of the
   * tool palette, the right-hand dock and the bars, so the model lands in the
   * clear rectangle between them instead of half under a panel.
   * SECOND, on a real plot the straight line from the camera to the model runs
   * through a tree as often as not, so the orbit yaw is turned until the line
   * of sight is clear of everything `obstacles()` reports.
   */
  zoomExtents(box) {
    if (!box || box.isEmpty()) return false;
    // Framing before the canvas has ever been measured is not "a bit off", it
    // is a different calculation: width/height are still the constructor's 1x1,
    // both free dimensions clamp to the 80 px floor, `shrink` becomes 80, and
    // the distance collapses to nothing. The editor opened 0.6 m from a point
    // in mid-air, looking at an empty olive void. Refuse instead, and let the
    // caller ask again once resize() has told us how big the viewport is.
    if (this.width < 2 || this.height < 2) return false;
    const c = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = Math.max(size.length() * 0.5, 2);
    const ins = this.viewInsets || ZERO_INSETS;
    const freeW = Math.max(80, this.width - ins.left - ins.right);
    const freeH = Math.max(80, this.height - ins.top - ins.bottom);

    this.target.copy(c);
    // Pad for the fraction of the viewport the panels eat, so the model still
    // fills the clear rectangle after it has been pushed into it.
    const shrink = Math.min(freeW / this.width, freeH / this.height);
    this.dist = (radius / Math.tan(MathUtils.degToRad(ORBIT_FOV * 0.5)) * 1.15) / Math.max(0.35, shrink);

    // plan: fit the box in the CLEAR rectangle, then offset the camera so that
    // rectangle, not the canvas, is what the drawing sits in the middle of.
    const fitH = Math.max(size.z, size.x / (freeW / freeH)) * 1.25 + 2;
    this.planHeight = fitH * (this.height / freeH);
    const mpp = this.planHeight / this.height;
    this.planCentre.set(
      c.x - ((ins.left - ins.right) / 2) * mpp,
      c.z - ((ins.top - ins.bottom) / 2) * mpp,
    );

    if (this.mode === 'walk') this.setView('orbit');
    else { this._clearYaw(); this._apply(); }
    this.onChange?.();
    return true;
  }

  /**
   * Turn the orbit yaw until neither the camera nor its line of sight sits
   * inside anything `obstacles()` reports (tree crowns, mostly). Tries the
   * current yaw first, then ever wider swings, and gives up on the original if
   * every direction is blocked — a bad view beats a moved view you did not ask
   * for.
   */
  _clearYaw() {
    const list = this.obstacles?.() || null;
    if (!list || !list.length) return;
    const yaw0 = this.yaw;
    const steps = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6, 3.14];
    for (const d of steps) {
      this.yaw = yaw0 + d;
      const pos = this._orbitPos(new Vector3());
      if (!blocked(pos, this.target, list)) return;
    }
    this.yaw = yaw0;
  }

  /** Re-centre on a world point without changing the view direction. */
  recentre(p) {
    if (!p) return;
    if (this.mode === 'plan') this.planCentre.set(p.x, p.z);
    else this.target.copy(p);
    this._apply();
    this.onChange?.();
  }

  // -- per-frame -------------------------------------------------------------

  update(dt, input = null) {
    if (this._anim) {
      const a = this._anim;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = easeInOut(a.t);
      this.persp.position.lerpVectors(a.from.pos, a.to.pos, k);
      this._q.slerpQuaternions(a.from.quat, a.to.quat, k);
      this.persp.quaternion.copy(this._q);
      this.persp.fov = MathUtils.lerp(a.from.fov, a.to.fov, k);
      this.persp.updateProjectionMatrix();
      if (a.t >= 1) { this._anim = null; this._apply(); }
      this.onChange?.();
      return;
    }
    if (this.mode === 'walk' && input) this._walk(dt, input);
  }

  _walk(dt, input) {
    const ax = input.axis2();
    if (!ax.x && !ax.y) return;
    const speed = (input.down('sprint') ? 2.8 : 1.35) * dt;
    const s = Math.sin(this.walkYaw), c = Math.cos(this.walkYaw);
    this.walkPos.x += (-s * ax.y + c * ax.x) * speed;
    this.walkPos.z += (-c * ax.y - s * ax.x) * speed;
    this.walkPos.y = EYE_HEIGHT;
    this._apply();
    this.onChange?.();
  }

  // -- poses -----------------------------------------------------------------

  _currentPose() {
    const cam = this.persp;
    if (this.mode === 'plan' && !this._anim) {
      // We were on the ortho camera; build the equivalent perspective pose.
      return this._poseFor('plan');
    }
    return { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
  }

  _poseFor(mode) {
    const cam = new PerspectiveCamera(ORBIT_FOV, this.width / this.height, 0.05, 2000);
    if (mode === 'orbit') {
      cam.fov = ORBIT_FOV;
      cam.up.copy(UP);
      cam.position.copy(this._orbitPos());
      cam.lookAt(this.target);
    } else if (mode === 'plan') {
      cam.fov = PLAN_FOV;
      cam.up.copy(PLAN_UP);
      const h = (this.planHeight * 0.5) / Math.tan(MathUtils.degToRad(PLAN_FOV * 0.5));
      cam.position.set(this.planCentre.x, h, this.planCentre.y);
      cam.lookAt(this.planCentre.x, 0, this.planCentre.y);
    } else {
      cam.fov = WALK_FOV;
      cam.up.copy(UP);
      cam.position.copy(this.walkPos);
      cam.quaternion.setFromEuler(new Euler(this.walkPitch, this.walkYaw, 0, 'YXZ'));
    }
    cam.updateMatrixWorld();
    return { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov };
  }

  _orbitPos(out = new Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
  }

  _apply() {
    if (this.mode === 'orbit') {
      this.persp.fov = ORBIT_FOV;
      this.persp.up.copy(UP);
      this.persp.position.copy(this._orbitPos());
      this.persp.lookAt(this.target);
      this.persp.updateProjectionMatrix();
      this.persp.updateMatrixWorld();
    } else if (this.mode === 'walk') {
      this.persp.fov = WALK_FOV;
      this.persp.up.copy(UP);
      this.persp.position.copy(this.walkPos);
      this.persp.quaternion.setFromEuler(new Euler(this.walkPitch, this.walkYaw, 0, 'YXZ'));
      this.persp.updateProjectionMatrix();
      this.persp.updateMatrixWorld();
    } else {
      this._applyOrtho();
    }
  }

  _applyOrtho() {
    const aspect = this.width / this.height;
    const h = this.planHeight * 0.5;
    const w = h * aspect;
    this.ortho.left = -w; this.ortho.right = w;
    this.ortho.top = h; this.ortho.bottom = -h;
    this.ortho.near = -500; this.ortho.far = 1000;
    this.ortho.up.copy(PLAN_UP);
    this.ortho.position.set(this.planCentre.x, 120, this.planCentre.y);
    this.ortho.lookAt(this.planCentre.x, 0, this.planCentre.y);
    this.ortho.updateProjectionMatrix();
    this.ortho.updateMatrixWorld();
  }

  // -- picking helpers -------------------------------------------------------

  /**
   * The rectangle of the canvas, in CSS pixels, that the editor is actually
   * being shown in. Null means the whole canvas. When the editor renders into
   * the monitor's texture and the camera has flown up to that monitor, the
   * pointer events still arrive in canvas pixels while `this.width/height` is
   * the tier's screen resolution — so every pixel has to be re-based onto the
   * on-screen rectangle first. Set by the office each frame from the projected
   * corners of the screen quad; every caller of ndcFromPixel gets it for free.
   */
  setViewportRect(rect) {
    // A degenerate rectangle is worse than none: a hidden pane reports a canvas
    // of zero CSS size, which collapsed every projected point onto a 2x1 px box
    // and would make snapping wilder than the bug this fixes. Below a sane
    // minimum, fall back to the render target's own space.
    this.viewportRect = (rect && rect.w >= 8 && rect.h >= 8) ? rect : null;
  }

  /** NDC (-1..1) from a canvas-relative pixel position. */
  ndcFromPixel(px, py, out = new Vector2()) {
    const r = this.viewportRect;
    if (r && r.w > 0 && r.h > 0) {
      return out.set(((px - r.x) / r.w) * 2 - 1, -((py - r.y) / r.h) * 2 + 1);
    }
    return out.set((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
  }

  /**
   * The cursor ray in WORLD space — origin and unit direction.
   *
   * Every linear inference (the axes, parallel, perpendicular, the arrow-key
   * lock) is a closest-point problem between this ray and a line in the model,
   * and it has to be solved in world space. Interpolating a world parameter
   * from a screen-space one is only correct under an affine projection, so it
   * works in the orthographic plan and is nonsense in the perspective view —
   * which is the view the editor starts in. Written into `out` (a THREE.Ray)
   * so the caller can keep one and never allocate.
   */
  cursorRay(ndc, out = new Ray()) {
    const cam = this.camera;
    if (cam.isOrthographicCamera) {
      this._tmp.set(ndc.x, ndc.y, -1).unproject(cam);
      out.origin.copy(this._tmp);
      out.direction.set(0, 0, -1).transformDirection(cam.matrixWorld).normalize();
    } else {
      out.origin.setFromMatrixPosition(cam.matrixWorld);
      this._tmp.set(ndc.x, ndc.y, 0.5).unproject(cam);
      out.direction.copy(this._tmp).sub(out.origin).normalize();
    }
    return out;
  }

  /** World point where the cursor ray meets a horizontal plane at height y. */
  groundPoint(ndc, y = 0, out = new Vector3()) {
    this.cursorRay(ndc, this._ray);
    this._plane.set(UP, -y);
    const hit = this._ray.intersectPlane(this._plane, out);
    return hit ? out : null;
  }

  /** True when the world point is in front of the camera (behind = unprojectable). */
  isInFront(p) {
    const cam = this.camera;
    if (cam.isOrthographicCamera) return true;
    this._tmp.copy(p).sub(cam.position);
    this._tmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    return this._tmp.dot(this._tmp2) > 0.02;
  }

  /** Project a world point to canvas pixels. */
  /**
   * A world point in the SAME pixel space the cursor arrives in.
   *
   * This is the other half of setViewportRect, and it was missing. Snapping
   * compares toScreen(point) against the cursor pixel with a ~14 px tolerance
   * (snapping.js). While the editor runs on the in-game monitor the render
   * target is the machine's own resolution (806x480) and the cursor is in
   * canvas pixels (1600x900), so the two were measured in different spaces:
   * a cursor sitting exactly on a wall node measured a 437 px gap, and over
   * four corners of a clean room 484.9 / 429.5 / 429.5 / 484.4 px. No point
   * inference could EVER fire on the monitor — only the `On Face` fallback —
   * which is exactly the reported "no way to draw a wall from one wall end to
   * another". ndcFromPixel already re-bases the cursor; this re-bases the
   * point, so both live in canvas pixels and the tolerance means something.
   */
  toScreen(p, out = new Vector2()) {
    this._tmp.copy(p).project(this.camera);
    const r = this.viewportRect;
    if (r && r.w > 0 && r.h > 0) {
      return out.set(r.x + (this._tmp.x * 0.5 + 0.5) * r.w, r.y + (-this._tmp.y * 0.5 + 0.5) * r.h);
    }
    return out.set((this._tmp.x * 0.5 + 0.5) * this.width, (-this._tmp.y * 0.5 + 0.5) * this.height);
  }

  /** Metres per CSS pixel at a world point — drives every screen-space tolerance. */
  metresPerPixel(at) {
    // Same correction: a tolerance in CSS pixels has to be converted at the
    // scale the player actually sees, not the render target's.
    const h = (this.viewportRect && this.viewportRect.h > 0) ? this.viewportRect.h : this.height;
    if (this.camera.isOrthographicCamera) return this.planHeight / h;
    const d = this.camera.position.distanceTo(at ?? this.target);
    return (2 * Math.tan(MathUtils.degToRad(this.camera.fov * 0.5)) * d) / h;
  }

  // -- input -----------------------------------------------------------------

  _bind() {
    const c = this.canvas;
    this._onDown = (e) => {
      const nav = this._navKind(e);
      if (!nav) return;
      if (e.button === 1) {
        const now = performance.now();
        if (now - this._lastMiddleClick < 320) { this._recentreAt(e); this._lastMiddleClick = 0; return; }
        this._lastMiddleClick = now;
      }
      this._drag = { kind: nav, x: e.clientX, y: e.clientY, button: e.button };
      c.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };
    this._onMove = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
      if (this._drag.kind === 'orbit') this._orbit(dx, dy);
      else this._pan(dx, dy);
      e.preventDefault();
    };
    this._onUp = (e) => {
      if (!this._drag) return;
      this.canvas.releasePointerCapture?.(e.pointerId);
      this._drag = null;
    };
    this._onWheel = (e) => {
      const r = c.getBoundingClientRect();
      const ndc = this.ndcFromPixel(e.clientX - r.left, e.clientY - r.top);
      this.zoomAt(ndc, e.deltaY);
      e.preventDefault();
    };
    this._onCtx = (e) => e.preventDefault();

    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    c.addEventListener('contextmenu', this._onCtx);
  }

  /** Which navigation gesture, if any, this pointerdown is. */
  _navKind(e) {
    if (e.button === 1) return e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 2) return 'pan';
    if (e.button === 0 && e.altKey) return e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 0 && this.forceNav) return this.forceNav;   // Orbit/Pan tools
    return null;
  }

  _orbit(dx, dy) {
    if (this.mode === 'plan') { this._pan(dx, dy); return; }
    if (this.mode === 'walk') {
      this.walkYaw -= dx * 0.0035;
      this.walkPitch = MathUtils.clamp(this.walkPitch - dy * 0.0035, -1.35, 1.35);
    } else {
      this.yaw -= dx * 0.0060;
      this.pitch = MathUtils.clamp(this.pitch + dy * 0.0060, -1.45, 1.45);
    }
    this._apply();
    this.onChange?.();
  }

  _pan(dx, dy) {
    if (this.mode === 'plan') {
      const mpp = this.planHeight / this.height;
      // Screen up is world -Z in the plan view, screen right is world +X.
      this.planCentre.x -= dx * mpp;
      this.planCentre.y += dy * mpp;
      this._apply();
      this.onChange?.();
      return;
    }
    if (this.mode === 'walk') {
      const s = Math.sin(this.walkYaw), c = Math.cos(this.walkYaw);
      this.walkPos.x -= (c * dx * 0.01);
      this.walkPos.z += (s * dx * 0.01);
      this.walkPos.y = EYE_HEIGHT;
      this._apply();
      this.onChange?.();
      return;
    }
    const mpp = this.metresPerPixel(this.target);
    const right = this._tmp.set(1, 0, 0).applyQuaternion(this.persp.quaternion);
    const up = this._tmp2.set(0, 1, 0).applyQuaternion(this.persp.quaternion);
    this.target.addScaledVector(right, -dx * mpp).addScaledVector(up, dy * mpp);
    this._apply();
    this.onChange?.();
  }

  _recentreAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = this.ndcFromPixel(e.clientX - r.left, e.clientY - r.top);
    const p = (this.pickPoint && this.pickPoint(ndc)) || this.groundPoint(ndc, 0);
    this.recentre(p);
  }

  /**
   * Cursor-anchored, distance-adaptive zoom.
   * The world point under the cursor stays under the cursor; the step is a
   * FRACTION of the distance to it, so far geometry zooms fast and near geometry
   * zooms slowly — the property that makes SketchUp navigation feel calm.
   */
  zoomAt(ndc, deltaY) {
    const anchor = (this.pickPoint && this.pickPoint(ndc)) || this.groundPoint(ndc, 0);
    const f = Math.exp(MathUtils.clamp(deltaY, -240, 240) * 0.0016);
    if (this.mode === 'plan') {
      const p = anchor || new Vector3(this.planCentre.x, 0, this.planCentre.y);
      this.planCentre.x = p.x + (this.planCentre.x - p.x) * f;
      this.planCentre.y = p.z + (this.planCentre.y - p.z) * f;
      this.planHeight = MathUtils.clamp(this.planHeight * f, 0.4, 900);
    } else if (this.mode === 'walk') {
      if (!anchor) return;
      const dir = this._tmp.copy(anchor).sub(this.walkPos);
      this.walkPos.addScaledVector(dir, 1 - f);
      this.walkPos.y = EYE_HEIGHT;
    } else {
      const p = anchor || this.target;
      this.target.set(
        p.x + (this.target.x - p.x) * f,
        p.y + (this.target.y - p.y) * f,
        p.z + (this.target.z - p.z) * f,
      );
      this.dist = MathUtils.clamp(this.dist * f, 0.35, 800);
    }
    this._apply();
    this.onChange?.();
  }

  /** Bounding box of everything, for Zoom Extents. */
  static boundsOf(object) {
    const b = new Box3();
    b.setFromObject(object);
    return b;
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('contextmenu', this._onCtx);
  }
}
