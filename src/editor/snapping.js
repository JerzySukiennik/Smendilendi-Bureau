// snapping.js — the inference engine.
//
// Every snap does TWO things: it moves the point, and it NAMES ITSELF. A snap
// without a name is a guess, and a guess is what makes a CAD-like editor feel
// untrustworthy. The names are SketchUp's, verbatim:
//
//   Endpoint, Midpoint, Intersection, Center, On Edge, On Line, On Face,
//   On Red Axis, On Green Axis, On Blue Axis, From Point, Parallel, Perpendicular
//
// and so is the colour grammar: red/green/blue = X/Y/Z, magenta = parallel or
// perpendicular to something, cyan = midpoint.
//
// Everything is decided in SCREEN SPACE, inside SNAP_PX pixels of the cursor,
// so snapping feels identical whether you are zoomed into a door reveal or
// looking at the whole site.

import { Vector2, Vector3 } from 'three';
import { AXIS, INFERENCE, SNAP_PX, GRID, FINE_GRID } from './constants.js';

const _p = new Vector3();
const _s = new Vector2();

/**
 * Inference — built once per editor, asked once per frame.
 *
 * infer(ctx) -> Snap
 *   ctx = {
 *     ndc, pixel,            cursor, in NDC and in canvas pixels
 *     cameras,               EditorCameras
 *     model, levelId,
 *     from,                  anchor point of the operation in progress, or null
 *     refDir,                reference direction for Parallel/Perpendicular
 *     lockAxis,              'x'|'y'|'z'|'ref'|null — an arrow key is held down
 *     height,                the y the free point falls back to (level elevation)
 *     fine,                  true = 10 mm grid instead of 100 mm
 *     wallHit,               { point, wallId } from a raycast, or null
 *     ignoreIds,             Set of entity ids not to snap to (the thing being dragged)
 *   }
 *
 * Snap = {
 *   point, name, color, kind, rank,
 *   wallId?, nodeId?, furnitureId?, axis?,
 *   guides: [ { a, b, color, dotted } ],
 *   locked: bool
 * }
 */
export class Inference {
  constructor() {
    this.enabled = true;              // Line tool's Alt cycles this
    this.mode = 'all';                // 'all' | 'off' | 'parperp'
    this.primed = null;               // hover-to-prime point
    this._dwell = { at: null, since: 0, pixel: new Vector2() };
    this.last = null;
  }

  /** Cycle All -> Off -> Parallel and Perpendicular Only -> All (Line tool, Alt). */
  cycleMode() {
    this.mode = this.mode === 'all' ? 'off' : this.mode === 'off' ? 'parperp' : 'all';
    return this.mode;
  }

  /** Hover-to-prime: resting the cursor on a point makes the engine prefer it. */
  tickDwell(pixel, dt, candidatePoint) {
    if (!candidatePoint) { this._dwell.at = null; this._dwell.since = 0; this.primed = null; return; }
    if (this._dwell.at && this._dwell.pixel.distanceTo(pixel) < 6) {
      this._dwell.since += dt;
      if (this._dwell.since > 0.35) this.primed = this._dwell.at.clone();
    } else {
      this._dwell.at = candidatePoint.clone();
      this._dwell.pixel.copy(pixel);
      this._dwell.since = 0;
      this.primed = null;
    }
  }

  infer(ctx) {
    const { cameras, pixel } = ctx;
    const grid = ctx.fine ? FINE_GRID : GRID;

    // --- an arrow-key axis lock overrides everything ------------------------
    if (ctx.lockAxis && ctx.from) {
      const locked = this._axisLock(ctx);
      if (locked) { this.last = locked; return locked; }
    }

    const cands = [];
    const push = (c) => { if (c) cands.push(c); };

    if (this.mode !== 'off') {
      if (this.mode === 'all') {
        this._points(ctx, push);
        this._onEdge(ctx, push);
        this._guides(ctx, push);
      }
      if (ctx.from) {
        this._axes(ctx, push);
        this._parPerp(ctx, push);
      }
    }

    // pick the best: highest rank, then nearest in pixels
    let best = null;
    for (const c of cands) {
      cameras.toScreen(c.point, _s);
      const d = _s.distanceTo(pixel);
      if (d > (c.tol ?? SNAP_PX)) continue;
      c.px = d;
      if (this.primed && c.point.distanceTo(this.primed) < 1e-4) c.rank += 8;
      if (!best || c.rank > best.rank || (c.rank === best.rank && c.px < best.px)) best = c;
    }

    if (best) {
      best.guides = best.guides || [];
      this.last = best;
      return best;
    }

    // --- nothing inferred: the free point on the working plane --------------
    const free = ctx.wallHit
      ? ctx.wallHit.point.clone()
      : (cameras.groundPoint(ctx.ndc, ctx.height ?? 0, new Vector3()) || new Vector3());
    if (!ctx.wallHit) {
      free.x = Math.round(free.x / grid) * grid;
      free.z = Math.round(free.z / grid) * grid;
      free.y = ctx.height ?? 0;
    }
    const snap = {
      point: free,
      ...INFERENCE.ON_FACE,
      kind: 'face',
      guides: [],
      locked: false,
      free: true,
      wallId: ctx.wallHit?.wallId ?? null,
    };
    this.last = snap;
    return snap;
  }

  // -- point inferences ------------------------------------------------------

  _points(ctx, push) {
    const { model, levelId, ignoreIds } = ctx;
    const y = ctx.height ?? 0;
    for (const id in model.walls) {
      const w = model.walls[id];
      if (w.levelId !== levelId) continue;
      if (ignoreIds?.has(id)) continue;
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      push({ point: new Vector3(a.x, y, a.z), ...INFERENCE.ENDPOINT, kind: 'endpoint', nodeId: w.a, wallId: id, guides: [] });
      push({ point: new Vector3(b.x, y, b.z), ...INFERENCE.ENDPOINT, kind: 'endpoint', nodeId: w.b, wallId: id, guides: [] });
      push({
        point: new Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2),
        ...INFERENCE.MIDPOINT, kind: 'midpoint', wallId: id, guides: [],
      });
      // opening centres read as Center — that is what you aim at to align a door
      for (const oid of w.openings) {
        const o = model.openings[oid];
        if (!o) continue;
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const t = o.offset / len;
        push({
          point: new Vector3(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t),
          ...INFERENCE.CENTER, kind: 'center', wallId: id, openingId: oid, guides: [],
        });
      }
    }
    for (const id in model.furniture) {
      const f = model.furniture[id];
      if (f.levelId !== levelId || ignoreIds?.has(id)) continue;
      push({ point: new Vector3(f.x, y + (f.y ?? 0), f.z), ...INFERENCE.CENTER, kind: 'center', furnitureId: id, guides: [] });
    }
  }

  _onEdge(ctx, push) {
    const { model, levelId, cameras, pixel, ignoreIds } = ctx;
    const y = ctx.height ?? 0;
    for (const id in model.walls) {
      const w = model.walls[id];
      if (w.levelId !== levelId || ignoreIds?.has(id)) continue;
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      const p = closestOnSegmentScreen(cameras, pixel, a, b, y);
      if (!p) continue;
      push({ point: p, ...INFERENCE.ON_EDGE, kind: 'onEdge', wallId: id, guides: [] });
    }
  }

  /** Setting-out lines drawn with the Line tool or left by the Tape Measure. */
  _guides(ctx, push) {
    const { cameras, pixel } = ctx;
    for (const gd of ctx.guides || []) {
      push({ point: gd.a.clone(), ...INFERENCE.ENDPOINT, kind: 'endpoint', guides: [] });
      push({ point: gd.b.clone(), ...INFERENCE.ENDPOINT, kind: 'endpoint', guides: [] });
      push({
        point: new Vector3().addVectors(gd.a, gd.b).multiplyScalar(0.5),
        ...INFERENCE.MIDPOINT, kind: 'midpoint', guides: [],
      });
      const p = closestOnSegmentScreen(cameras, pixel,
        { x: gd.a.x, z: gd.a.z }, { x: gd.b.x, z: gd.b.z }, gd.a.y);
      if (p) push({ point: p, ...INFERENCE.ON_LINE, kind: 'onLine', guides: [] });
    }
  }

  // -- linear inferences -----------------------------------------------------

  _axes(ctx, push) {
    const { from, cameras, pixel } = ctx;
    for (const key of ['x', 'y', 'z']) {
      const ax = AXIS[key];
      const p = closestOnRayScreen(cameras, pixel, from, ax.dir);
      if (!p) continue;
      const def = key === 'x' ? INFERENCE.AXIS_X : key === 'y' ? INFERENCE.AXIS_Y : INFERENCE.AXIS_Z;
      push({
        point: p, ...def, kind: 'axis', axis: key, guides: [{ a: from.clone(), b: p.clone(), color: ax.color, dotted: true }],
      });
    }
  }

  _parPerp(ctx, push) {
    const { from, refDir, cameras, pixel } = ctx;
    if (!refDir) return;
    const par = new Vector3(refDir.x, 0, refDir.z).normalize();
    if (par.lengthSq() < 1e-9) return;
    const perp = new Vector3(-par.z, 0, par.x);
    const pp = closestOnRayScreen(cameras, pixel, from, par);
    if (pp) {
      push({
        point: pp, ...INFERENCE.PARALLEL, kind: 'parallel',
        guides: [{ a: from.clone(), b: pp.clone(), color: INFERENCE.PARALLEL.color, dotted: true }],
      });
    }
    const pq = closestOnRayScreen(cameras, pixel, from, perp);
    if (pq) {
      push({
        point: pq, ...INFERENCE.PERPENDICULAR, kind: 'perpendicular',
        guides: [{ a: from.clone(), b: pq.clone(), color: INFERENCE.PERPENDICULAR.color, dotted: true }],
      });
    }
  }

  _axisLock(ctx) {
    const { from, lockAxis, cameras, pixel } = ctx;
    let dir; let def; let color;
    if (lockAxis === 'ref' && ctx.refDir) {
      dir = new Vector3(ctx.refDir.x, 0, ctx.refDir.z).normalize();
      def = INFERENCE.PARALLEL; color = INFERENCE.PARALLEL.color;
    } else {
      const ax = AXIS[lockAxis];
      if (!ax) return null;
      dir = ax.dir;
      def = lockAxis === 'x' ? INFERENCE.AXIS_X : lockAxis === 'y' ? INFERENCE.AXIS_Y : INFERENCE.AXIS_Z;
      color = ax.color;
    }
    const p = closestOnRayScreen(cameras, pixel, from, dir, Infinity);
    if (!p) return null;
    const grid = ctx.fine ? FINE_GRID : GRID;
    // Round the DISTANCE along the locked axis, never the raw coordinate: an
    // axis-locked drag from a node at 3.47 m must land on 3.47 + n * grid.
    const d = p.clone().sub(from).dot(dir);
    const rounded = Math.round(d / grid) * grid;
    const point = from.clone().addScaledVector(dir, rounded);
    return {
      point, ...def, kind: 'axis', axis: lockAxis, locked: true, color,
      guides: [{ a: from.clone(), b: point.clone(), color, dotted: true }],
    };
  }
}

// ---------------------------------------------------------------------------
// screen-space helpers

/** Closest world point on segment a-b (at height y) to the cursor, in pixels. */
function closestOnSegmentScreen(cameras, pixel, a, b, y) {
  const A = cameras.toScreen(_p.set(a.x, y, a.z), new Vector2());
  const B = cameras.toScreen(_p.set(b.x, y, b.z), new Vector2());
  const abx = B.x - A.x, aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-6) return null;
  let t = ((pixel.x - A.x) * abx + (pixel.y - A.y) * aby) / len2;
  if (t < 0 || t > 1) return null;
  return new Vector3(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t);
}

/**
 * Closest world point on the infinite line through `from` along `dir` to the
 * cursor, measured in SCREEN pixels. Returns null when the line is degenerate
 * on screen (looking straight down a vertical axis, for instance).
 */
function closestOnRayScreen(cameras, pixel, from, dir, tol = SNAP_PX) {
  const span = 60;   // metres of the line to consider on either side
  const A = cameras.toScreen(_p.copy(from).addScaledVector(dir, -span), new Vector2());
  const B = cameras.toScreen(_p.copy(from).addScaledVector(dir, span), new Vector2());
  const abx = B.x - A.x, aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 4) return null;
  const t = ((pixel.x - A.x) * abx + (pixel.y - A.y) * aby) / len2;
  const px = A.x + abx * t, py = A.y + aby * t;
  if (tol !== Infinity && Math.hypot(px - pixel.x, py - pixel.y) > tol) return null;
  const d = -span + t * (2 * span);
  return from.clone().addScaledVector(dir, d);
}

/** Round a plan point to the working grid. */
export function snapToGrid(p, grid = GRID) {
  p.x = Math.round(p.x / grid) * grid;
  p.z = Math.round(p.z / grid) * grid;
  return p;
}
