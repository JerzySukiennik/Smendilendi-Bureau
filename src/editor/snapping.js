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
// A candidate is ACCEPTED in screen space — inside SNAP_PX pixels of the cursor,
// so snapping feels identical whether you are zoomed into a door reveal or
// looking at the whole site — but every candidate is COMPUTED in world space.
// The distinction is the whole ball game for the linear inferences: projecting
// two ends of an axis and interpolating between them is only the same line
// under an affine projection, so it is right in the orthographic plan and
// badly wrong in the perspective orbit view, which is where the editor starts.
// Point inferences (endpoints, midpoints) are unaffected either way; the axes,
// Parallel, Perpendicular and the arrow-key lock are solved as a closest-point
// problem between the cursor RAY and the line, and only then measured in pixels.

import { Ray, Vector2, Vector3 } from 'three';
import { AXIS, INFERENCE, SNAP_PX, GRID, FINE_GRID } from './constants.js';

const _p = new Vector3();
const _s = new Vector2();
const _ray = new Ray();
const _w0 = new Vector3();
const _hit = new Vector3();

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
    this.fromPoint = null;            // the last primed point, for From Point
    this._dwell = { at: null, since: 0, pixel: new Vector2() };
    this.last = null;
  }

  /** Cycle All -> Off -> Parallel and Perpendicular Only -> All (Line tool, Alt). */
  cycleMode() {
    this.mode = this.mode === 'all' ? 'off' : this.mode === 'off' ? 'parperp' : 'all';
    return this.mode;
  }

  /** Forget the primed point — a new tool, an Escape, a finished operation. */
  clearPrimed() {
    this.primed = null;
    this.fromPoint = null;
    this._dwell.at = null;
    this._dwell.since = 0;
  }

  /** Hover-to-prime: resting the cursor on a point makes the engine prefer it. */
  tickDwell(pixel, dt, candidatePoint) {
    // A primed point is a passing thought, not a setting. It goes stale after a
    // few seconds so that a point you rested on a minute ago cannot quietly
    // hijack the next click you make somewhere else entirely.
    if (this.fromPoint) {
      this._primedAge = (this._primedAge ?? 0) + dt;
      if (this._primedAge > 6) this.fromPoint = null;
    }
    if (!candidatePoint) { this._dwell.at = null; this._dwell.since = 0; this.primed = null; return; }
    if (this._dwell.at && this._dwell.pixel.distanceTo(pixel) < 6) {
      this._dwell.since += dt;
      if (this._dwell.since > 0.35) {
        this.primed = this._dwell.at.clone();
        // A completed dwell also PRIMES the point for From Point, and that one
        // outlives the hover: you rest on a jamb, move away, and the inference
        // off it is still there. Replaced by the next completed dwell.
        this.fromPoint = this._dwell.at.clone();
        this._primedAge = 0;
      }
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
        this._intersections(ctx, push);
      }
      if (ctx.from) {
        this._axes(ctx, push);
        this._parPerp(ctx, push);
      }
      if (this.mode === 'all') this._fromPoint(ctx, push);
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
      quantizeAlong(best, grid);
      this.last = best;
      return best;
    }

    // --- nothing inferred ---------------------------------------------------
    //
    // Two different states live here and they are NOT the same thing. A cursor
    // resting on a real surface — a wall, a slab, the ground of the plot — is
    // On Face: it names itself and shows its blue marker, exactly as it does in
    // SketchUp, because you are picking a point ON something. A cursor over
    // nothing at all falls back to the working plane and the grid, and that one
    // stays silent: labelling empty air would be a claim we cannot support.
    // A tool that is working ON a wall face (the Door tool) has already
    // raycast it and hands us the exact point on the face. Everything else
    // draws on the working plane, on the grid, which is where a plan is drawn —
    // the face under the cursor decides the NAME, not the position.
    let point;
    let face = ctx.wallHit || null;
    if (face?.point) {
      point = face.point.clone();
    } else {
      face = (typeof ctx.faceHit === 'function' ? ctx.faceHit() : ctx.faceHit) || null;
      point = cameras.groundPoint(ctx.ndc, ctx.height ?? 0, new Vector3()) || new Vector3();
      point.x = Math.round(point.x / grid) * grid;
      point.z = Math.round(point.z / grid) * grid;
      point.y = ctx.height ?? 0;
    }
    const snap = face
      ? {
        point, ...INFERENCE.ON_FACE, kind: 'face', guides: [], locked: false,
        free: false, wallId: face.wallId ?? null, entityId: face.entityId ?? null,
      }
      : {
        point, ...INFERENCE.GRID, kind: 'grid', guides: [], locked: false,
        free: true, wallId: null,
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
    const { model, levelId, ignoreIds } = ctx;
    const y = ctx.height ?? 0;
    for (const id in model.walls) {
      const w = model.walls[id];
      if (w.levelId !== levelId || ignoreIds?.has(id)) continue;
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      const p = closestOnSegment(ctx, a, b, y);
      if (!p) continue;
      push({
        point: p, ...INFERENCE.ON_EDGE, kind: 'onEdge', wallId: id, guides: [],
        along: alongOf(a.x, y, a.z, b.x - a.x, 0, b.z - a.z),
      });
    }
  }

  /** Setting-out lines drawn with the Line tool or left by the Tape Measure. */
  _guides(ctx, push) {
    for (const gd of ctx.guides || []) {
      push({ point: gd.a.clone(), ...INFERENCE.ENDPOINT, kind: 'endpoint', guides: [] });
      push({ point: gd.b.clone(), ...INFERENCE.ENDPOINT, kind: 'endpoint', guides: [] });
      push({
        point: new Vector3().addVectors(gd.a, gd.b).multiplyScalar(0.5),
        ...INFERENCE.MIDPOINT, kind: 'midpoint', guides: [],
      });
      const p = closestOnSegment(ctx,
        { x: gd.a.x, z: gd.a.z }, { x: gd.b.x, z: gd.b.z }, gd.a.y);
      if (p) {
        push({
          point: p, ...INFERENCE.ON_LINE, kind: 'onLine', guides: [],
          along: alongOf(gd.a.x, gd.a.y, gd.a.z, gd.b.x - gd.a.x, 0, gd.b.z - gd.a.z),
        });
      }
    }
  }

  /**
   * Intersection — where two lines in the drawing CROSS.
   *
   * The value here is not the T-junction of two built walls: the model already
   * splits walls at those, so that point is an Endpoint. The value is the
   * VIRTUAL crossing of two lines that do not meet yet — the setting-out line
   * you laid across the plot and the face of a wall three metres away — which
   * is exactly the point an architect wants to start the next wall from.
   *
   * Every line considered here lies on the working plane, so the crossing is a
   * 2D problem. Lines further from the cursor than about eighty pixels are
   * dropped before any pairing, which keeps this a handful of tests per frame
   * instead of a quadratic sweep over the whole plan.
   */
  _intersections(ctx, push) {
    const { model, levelId, cameras, ignoreIds } = ctx;
    const y = ctx.height ?? 0;
    const at = cameras.groundPoint(ctx.ndc, y, new Vector3());
    if (!at) return;
    const near = cameras.metresPerPixel(at) * 80;

    const lines = [];
    for (const id in model.walls) {
      const w = model.walls[id];
      if (w.levelId !== levelId || ignoreIds?.has(id)) continue;
      const a = model.nodes[w.a], b = model.nodes[w.b];
      if (!a || !b) continue;
      addLine(lines, a.x, a.z, b.x, b.z, at, near);
      if (lines.length > 24) break;
    }
    for (const gd of ctx.guides || []) {
      addLine(lines, gd.a.x, gd.a.z, gd.b.x, gd.b.z, at, near);
      if (lines.length > 32) break;
    }

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const p = intersect2D(lines[i], lines[j]);
        if (!p) continue;
        push({
          point: new Vector3(p.x, y, p.z), ...INFERENCE.INTERSECTION,
          kind: 'intersection', guides: [],
        });
      }
    }
  }

  /**
   * From Point — the linear inference off a point you PRIMED by resting on it.
   * SketchUp's most quietly useful trick: hover a door jamb, move away, and the
   * axes through that jamb keep inferring so you can line something up with it
   * without drawing a guide first.
   */
  _fromPoint(ctx, push) {
    const p0 = this.fromPoint;
    if (!p0) return;
    if (ctx.from && p0.distanceTo(ctx.from) < 1e-4) return;   // that is just the axes
    for (const key of ['x', 'y', 'z']) {
      const p = closestOnLine(ctx, p0, AXIS[key].dir);
      if (!p) continue;
      if (p.distanceTo(p0) < 1e-3) continue;                  // the primed point itself
      if (p.y < (ctx.height ?? 0) - 1e-3) continue;           // never start a plan below the floor
      push({
        point: p, ...INFERENCE.FROM_POINT, kind: 'fromPoint', axis: key,
        along: { o: p0.clone(), d: AXIS[key].dir.clone() },
        guides: [{ a: p0.clone(), b: p.clone(), color: AXIS[key].color, dotted: true }],
      });
    }
  }

  // -- linear inferences -----------------------------------------------------

  _axes(ctx, push) {
    const { from } = ctx;
    for (const key of ['x', 'y', 'z']) {
      const ax = AXIS[key];
      const p = closestOnLine(ctx, from, ax.dir);
      if (!p) continue;
      const def = key === 'x' ? INFERENCE.AXIS_X : key === 'y' ? INFERENCE.AXIS_Y : INFERENCE.AXIS_Z;
      push({
        point: p, ...def, kind: 'axis', axis: key,
        along: { o: from.clone(), d: ax.dir.clone() },
        guides: [{ a: from.clone(), b: p.clone(), color: ax.color, dotted: true }],
      });
    }
  }

  /**
   * Parallel and Perpendicular — magenta, and ONLY ever magenta.
   *
   * When the reference edge is itself a world axis these two inferences are
   * geometrically identical to the red and green axes, so emitting them would
   * do nothing but rename the red axis "Perpendicular" and repaint it magenta
   * for every wall after the first in an orthogonal building. SketchUp keeps
   * magenta for a reference that is NOT a world axis, and so do we: an
   * axis-aligned reference is dropped here and the axis inference speaks.
   */
  _parPerp(ctx, push) {
    const { from, refDir } = ctx;
    if (!refDir) return;
    const par = new Vector3(refDir.x, 0, refDir.z).normalize();
    if (par.lengthSq() < 1e-9) return;
    if (isWorldAxis(par)) return;
    const perp = new Vector3(-par.z, 0, par.x);
    const pp = closestOnLine(ctx, from, par);
    if (pp) {
      push({
        point: pp, ...INFERENCE.PARALLEL, kind: 'parallel',
        along: { o: from.clone(), d: par.clone() },
        guides: [{ a: from.clone(), b: pp.clone(), color: INFERENCE.PARALLEL.color, dotted: true }],
      });
    }
    const pq = closestOnLine(ctx, from, perp);
    if (pq) {
      push({
        point: pq, ...INFERENCE.PERPENDICULAR, kind: 'perpendicular',
        along: { o: from.clone(), d: perp.clone() },
        guides: [{ a: from.clone(), b: pq.clone(), color: INFERENCE.PERPENDICULAR.color, dotted: true }],
      });
    }
  }

  _axisLock(ctx) {
    const { from, lockAxis } = ctx;
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
    // Looking straight down the locked axis (the blue axis in a plan view) the
    // line has no image on screen and the cursor cannot mean anything by it.
    // The lock still HOLDS — it collapses to the anchor rather than quietly
    // handing the operation back to the free inference, which is how a lock
    // becomes a trap.
    const p = closestOnLine(ctx, from, dir, Infinity) || from.clone();
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
// world-space helpers
//
// Both of these answer the same question — "which point of this line is the
// player pointing at?" — by finding the closest approach between the CURSOR RAY
// and the line, in metres, and then checking that the answer lands within
// SNAP_PX of the cursor once it is projected back. Screen space decides whether
// a candidate is close enough; world space decides where the candidate IS.

const MAX_REACH = 400;      // metres: nothing on a plot is further away than this

/**
 * Parameter along the line `from + dir * t` closest to the cursor ray, or null
 * when the line is within a couple of degrees of the view direction (its screen
 * image is a point, so the cursor cannot mean anything by it).
 */
function lineParamAtCursor(ctx, from, dir) {
  const cameras = ctx.cameras;
  cameras.cursorRay(ctx.ndc, _ray);
  const rd = _ray.direction;
  const b = dir.dot(rd);
  const denom = 1 - b * b;              // both directions are unit length
  if (denom < 2e-4) return null;        // ~1.1 degrees: looking down the line
  _w0.copy(from).sub(_ray.origin);
  const d = dir.dot(_w0);
  const e = rd.dot(_w0);
  const t = (b * e - d) / denom;
  if (!Number.isFinite(t)) return null;
  return t;
}

/** Closest world point on segment a-b (at height y) to the cursor. */
function closestOnSegment(ctx, a, b, y) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  _hit.set(dx / len, 0, dz / len);
  const from = _p.set(a.x, y, a.z);
  const t = lineParamAtCursor(ctx, from, _hit);
  if (t === null || t < 0 || t > len) return null;
  const out = new Vector3(a.x + (dx / len) * t, y, a.z + (dz / len) * t);
  return ctx.cameras.isInFront?.(out) === false ? null : out;
}

/**
 * Closest world point on the infinite line through `from` along `dir`.
 * `tol` is the screen-space acceptance radius in pixels; Infinity means the
 * caller has already committed to this line (an arrow-key lock) and wants the
 * point wherever it falls.
 */
function closestOnLine(ctx, from, dir, tol = SNAP_PX) {
  const t = lineParamAtCursor(ctx, from, dir);
  if (t === null || Math.abs(t) > MAX_REACH) return null;
  const out = from.clone().addScaledVector(dir, t);
  if (ctx.cameras.isInFront?.(out) === false) return null;
  if (tol !== Infinity) {
    ctx.cameras.toScreen(out, _s);
    if (_s.distanceTo(ctx.pixel) > tol) return null;
  }
  return out;
}

/** Within a fifth of a degree of the red or the green axis. */
function isWorldAxis(dir) {
  return Math.abs(dir.x) < 3e-3 || Math.abs(dir.z) < 3e-3;
}

/** The line a free candidate slides along, for quantizeAlong(). */
function alongOf(ox, oy, oz, dx, dy, dz) {
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return null;
  return { o: new Vector3(ox, oy, oz), d: new Vector3(dx / len, dy / len, dz / len) };
}

/**
 * QUANTIZE THE FREE PARAMETER, and only the free parameter.
 *
 * A point inferred onto a LINE — a wall edge, a setting-out line, one of the
 * axes off the anchor — is free to slide anywhere along that line, so without
 * this it lands wherever the cursor ray happened to cross: a wall click-drawn
 * along the red axis came out 5.9873 m, and a partition landing on the far wall
 * split it at 5.5006, which the plan then faithfully dimensioned as 5501 + 5499
 * under an overall of 11000. An architect reads that as a bug, because it is
 * one.
 *
 * So the DISTANCE ALONG THE LINE is rounded to the working grid (100 mm, or
 * 10 mm with Ctrl held) — never the raw x/z, which on a diagonal would push the
 * point off the very line the inference just promised it was on. Point
 * inferences (Endpoint, Midpoint, Center, Intersection) carry no `along` and are
 * never touched: they are exact model geometry and rounding them would be the
 * same bug from the other side.
 */
function quantizeAlong(snap, grid) {
  const a = snap.along;
  if (!a) return snap;
  const t = _p.copy(snap.point).sub(a.o).dot(a.d);
  const rounded = Math.round(t / grid) * grid;
  snap.point.copy(a.o).addScaledVector(a.d, rounded);
  if (snap.guides?.length) for (const g of snap.guides) g.b.copy(snap.point);
  return snap;
}

/** Keep a plan line only if it passes near the cursor's point on the plane. */
function addLine(out, ax, az, bx, bz, at, near) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const ux = dx / len, uz = dz / len;
  const perp = Math.abs((at.x - ax) * -uz + (at.z - az) * ux);
  if (perp > near) return;
  for (const l of out) {
    // two collinear lines cross everywhere and nowhere; keep one of them
    if (Math.abs(l.ux * uz - l.uz * ux) < 0.02
      && Math.abs((ax - l.x) * -l.uz + (az - l.z) * l.ux) < 1e-3) return;
  }
  out.push({ x: ax, z: az, ux, uz });
}

/** Crossing of two infinite plan lines, or null when they are near-parallel. */
function intersect2D(p, q) {
  const cross = p.ux * q.uz - p.uz * q.ux;
  if (Math.abs(cross) < 0.09) return null;          // under ~5 degrees: no honest point
  const t = ((q.x - p.x) * q.uz - (q.z - p.z) * q.ux) / cross;
  if (!Number.isFinite(t) || Math.abs(t) > MAX_REACH) return null;
  return { x: p.x + p.ux * t, z: p.z + p.uz * t };
}

/** Round a plan point to the working grid. */
export function snapToGrid(p, grid = GRID) {
  p.x = Math.round(p.x / grid) * grid;
  p.z = Math.round(p.z / grid) * grid;
  return p;
}
