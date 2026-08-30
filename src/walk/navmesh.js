// navmesh.js — the walkable world, generated from the player's actual building.
//
// VIEW-FREE. No three.js, no DOM. Everything here is derived; nothing is
// hand-authored. If a route does not exist in this file it does not exist in
// the drawing either, which is the entire point of the walkthrough.
//
// SOURCE OF TRUTH
// The 0.10 m occupancy grid comes straight from src/analysis/access.js
// (`buildWalkGrid`), the same grid the client's e-mail was written from. That
// grid already is: the room polygons from src/model/rooms.js, MINUS every
// floor-standing piece of furniture's footprint, PLUS a carved rectangle
// through every door and doorless opening, MINUS door leaves that sweep into
// circulation space, and it carries an exact euclidean distance transform so
// every cell knows its own clear width. Building a second navigation model
// beside it would let the walkthrough and the report disagree; they must not.
//
// WHAT THIS FILE ADDS
//  1. A PERSON. The analysis grid says "floor with nothing on it". A person is
//     not a point: PERSON_WIDTH is 0.55 m across the shoulders, so a cell is
//     only navigable when its clear width is at least that. A 0.45 m slot
//     between a sofa and a wall is floor, and is not a route.
//  2. A coarser 0.20 m lattice for search. 0.10 m is the right resolution to
//     MEASURE a corridor and four times more than is needed to WALK one.
//  3. Vertical circulation: stair rooms on adjacent levels are stitched with a
//     portal costing one flight of real going (16 x 0.28 m = 4.48 m).
//  4. Dijkstra distance fields per goal, cached. Thirty people share a handful
//     of destinations, so the expensive thing is computed once per destination
//     and every person just walks downhill.
//
// UNITS: metres everywhere. Plan coordinates are (x, z), y is up.

import { buildTopology, openingCentre, wallNormal, inRoom } from '../analysis/topology.js';
import { polygonBBox, pointInPolygon, distanceTransform } from '../analysis/geom.js';
import { classifyRooms } from '../analysis/classify.js';
import { buildWalkGrid, CELL as FINE_CELL } from '../analysis/access.js';
import { wallDir } from '../model/building.js';
import { roomCentroid } from '../model/rooms.js';
import { GOALS } from './roles.js';

/** Shoulder width of an adult in outdoor clothing. Below this, no passage. */
export const PERSON_WIDTH = 0.55;
/** Two people passing each other without turning sideways. */
export const PASSING_WIDTH = 1.20;
/** Search lattice. Two fine cells to a side. */
export const NAV_CELL = FINE_CELL * 2;      // 0.20 m
/** One storey of stair, measured as going, not as a straight line. */
export const STAIR_COST = 4.48;
/** How far outside the front door people appear and disappear. */
export const OUTSIDE_STANDOFF = 7.0;
/**
 * How far a body centre has to stay off the masonry.
 *
 * Not the shoulder half-width: an NPC's widest part at this scale is the
 * swinging arm, 0.24 m off the spine. Keeping the centre 0.24 m clear of the
 * wall face therefore keeps the whole body out of the plaster, and it is
 * exactly consistent with the navmesh's own definition of a passable cell — a
 * cell needs PERSON_WIDTH (0.55 m) of clear width, so its centre already sits
 * at least 0.275 m off any obstruction. Nothing that was walkable stops being
 * walkable because of this number, and a 0.90 m leaf still leaves +-0.21 m of
 * lateral freedom to walk through.
 */
export const WALL_CLEARANCE = 0.24;
/** Side of the bucket the solid wall spans are filed under. Metres. */
const SOLID_BUCKET = 1.0;
/** Bucket coordinates are biased by this many cells so they stay non-negative. */
const SOLID_BIAS = 16;

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// ---------------------------------------------------------------------------
// a small binary heap over (cost, index) pairs

class Heap {
  constructor() { this.cost = []; this.item = []; }
  get size() { return this.cost.length; }
  push(c, v) {
    const cost = this.cost, item = this.item;
    cost.push(c); item.push(v);
    let i = cost.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cost[i] >= cost[p]) break;
      [cost[i], cost[p]] = [cost[p], cost[i]];
      [item[i], item[p]] = [item[p], item[i]];
      i = p;
    }
  }
  pop() {
    const cost = this.cost, item = this.item;
    const topC = cost[0], topI = item[0];
    const lastC = cost.pop(), lastI = item.pop();
    if (cost.length) {
      cost[0] = lastC; item[0] = lastI;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < cost.length && cost[l] < cost[s]) s = l;
        if (r < cost.length && cost[r] < cost[s]) s = r;
        if (s === i) break;
        [cost[i], cost[s]] = [cost[s], cost[i]];
        [item[i], item[s]] = [item[s], item[i]];
        i = s;
      }
    }
    this._c = topC;
    return topI;
  }
  get lastCost() { return this._c; }
}

// ---------------------------------------------------------------------------

export class Navmesh {
  constructor(data) { Object.assign(this, data); }

  // -- addressing ----------------------------------------------------------

  /** Combined index for a world point on a level, or -1 if off the lattice. */
  indexAt(x, z, levelIdx = 0) {
    const L = this.levels[levelIdx];
    if (!L) return -1;
    const i = Math.floor((x - L.minX) / NAV_CELL);
    const j = Math.floor((z - L.minZ) / NAV_CELL);
    if (i < 0 || j < 0 || i >= L.w || j >= L.h) return -1;
    return L.base + j * L.w + i;
  }

  /** Centre of a cell, in world metres, plus its level. */
  centreOf(idx, out = { x: 0, y: 0, z: 0, level: 0 }) {
    const l = this.levelOf[idx];
    const L = this.levels[l];
    const k = idx - L.base;
    const i = k % L.w, j = (k - i) / L.w;
    out.x = L.minX + (i + 0.5) * NAV_CELL;
    out.z = L.minZ + (j + 0.5) * NAV_CELL;
    out.y = L.elevation;
    out.level = l;
    return out;
  }

  passable(idx) { return idx >= 0 && this.pass[idx] === 1; }

  /** Clear width, in metres, of the passage at this point. 0 = not floor. */
  widthAt(x, z, levelIdx = 0) {
    const idx = this.indexAt(x, z, levelIdx);
    return idx < 0 ? 0 : this.width[idx];
  }

  /** The room id containing this point, or null. */
  roomAt(x, z, levelIdx = 0) {
    const idx = this.indexAt(x, z, levelIdx);
    if (idx < 0) return null;
    const r = this.roomIdx[idx];
    return r < 0 ? null : this.roomIds[r];
  }

  /** The opening id of the doorway this point sits in, or null. */
  doorAt(x, z, levelIdx = 0) {
    const idx = this.indexAt(x, z, levelIdx);
    if (idx < 0) return null;
    const d = this.doorIdx[idx];
    return d < 0 ? null : this.doorIds[d];
  }

  /**
   * Nearest passable cell to a world point, searched in rings.
   * `maxRadius` in metres. Returns -1 when the point is nowhere near floor.
   */
  nearestPassable(x, z, levelIdx = 0, maxRadius = 2.0) {
    const L = this.levels[levelIdx];
    if (!L) return -1;
    const ci = Math.floor((x - L.minX) / NAV_CELL);
    const cj = Math.floor((z - L.minZ) / NAV_CELL);
    const R = Math.ceil(maxRadius / NAV_CELL);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= L.w || j >= L.h) continue;
          const idx = L.base + j * L.w + i;
          if (!this.pass[idx]) continue;
          const px = L.minX + (i + 0.5) * NAV_CELL;
          const pz = L.minZ + (j + 0.5) * NAV_CELL;
          const d = (px - x) * (px - x) + (pz - z) * (pz - z);
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  // -- masonry -------------------------------------------------------------

  /**
   * THE WALLS, AS THE PEOPLE MEET THEM.
   *
   * The navmesh is a good description of the floor INSIDE the building, but it
   * stops at the front door and says nothing at all about the site. Arriving
   * and leaving therefore happen off the mesh, and for as long as "off the
   * mesh" was allowed to mean "no collision", the arrival crowd walked bodily
   * through the 240 mm front wall on either side of the door reveal.
   *
   * Geometry is not a property of the grid; it is a property of the building.
   * So `nav.solids` carries every wall centreline cut into the pieces a body
   * cannot pass — derived from the same `model.walls` and `model.openings` the
   * visible geometry is extruded from, so what stops a person is exactly the
   * thing the player can see, down to the 240 mm — and it is consulted on every
   * step, in every state, inside the building and out.
   *
   * Two operations, and the difference between them matters:
   *
   *   pushOutOfWalls  the one the walkers use. It never refuses a step; it
   *                   moves the result to the nearest legal point. REFUSING was
   *                   tried first and was worse than the bug it fixed: somebody
   *                   nudged against a door jamb by the person behind them had
   *                   every direction rejected, stood there until the watchdog
   *                   gave up, and the post-occupancy report then printed
   *                   "no route" about a doorway that is perfectly walkable.
   *                   A collision model must never invent a finding about the
   *                   drawing. Pushing out slides them off the jamb and through.
   *   crossesWall     a straight yes/no, for a movement that is not a walk —
   *                   the idle shuffle, and a tunnelling guard.
   */
  crossesWall(x0, z0, x1, z1, levelIdx = 0, clearance = WALL_CLEARANCE) {
    const level = this.solids?.[levelIdx];
    if (!level || !level.spans.length) return false;
    return this._spansNear(level, x0, z0, x1, z1, clearance,
      (s) => spanBlocks(s, x0, z0, x1, z1, clearance)) === true;
  }

  /**
   * Move (x, z) to the nearest point that is `clearance` clear of every wall.
   * Two passes, so a body wedged into an internal corner leaves it properly.
   */
  pushOutOfWalls(x, z, levelIdx = 0, clearance = WALL_CLEARANCE, out = { x: 0, z: 0, moved: false }) {
    out.x = x; out.z = z; out.moved = false;
    const level = this.solids?.[levelIdx];
    if (!level || !level.spans.length) return out;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      this._spansNear(level, out.x, out.z, out.x, out.z, clearance, (s) => {
        const ax = out.x - s.x, az = out.z - s.z;
        const t = ax * s.ux + az * s.uz;
        const p = -ax * s.uz + az * s.ux;
        const tc = t < 0 ? 0 : (t > s.len ? s.len : t);
        const pc = p < -s.half ? -s.half : (p > s.half ? s.half : p);
        let dt = t - tc, dp = p - pc;
        const d = Math.hypot(dt, dp);
        if (d >= clearance) return false;
        let nt, np, want;
        if (d > 1e-7) {
          nt = dt / d; np = dp / d; want = clearance - d;
        } else {
          // Inside the masonry itself. Leave by the nearest face; a body in a
          // wall is a body that got there by some other bug, and the cheapest
          // honest thing to do is to put it back on the floor.
          const outs = [
            [-1, 0, t + clearance],                 // back past the near end
            [1, 0, s.len - t + clearance],          // on past the far end
            [0, -1, p + s.half + clearance],        // out through one face
            [0, 1, s.half - p + clearance],         // out through the other
          ];
          outs.sort((u, v) => u[2] - v[2]);
          nt = outs[0][0]; np = outs[0][1]; want = outs[0][2];
        }
        out.x += (nt * s.ux - np * s.uz) * want;
        out.z += (nt * s.uz + np * s.ux) * want;
        moved = true;
        return false;
      });
      out.moved ||= moved;
      if (!moved) break;
    }
    return out;
  }

  /** Visit every solid span whose padded footprint meets this query box. */
  _spansNear(level, x0, z0, x1, z1, clearance, fn) {
    const pad = level.maxHalf + clearance;
    const i0 = Math.floor((Math.min(x0, x1) - pad - level.minX) / SOLID_BUCKET);
    const i1 = Math.floor((Math.max(x0, x1) + pad - level.minX) / SOLID_BUCKET);
    const j0 = Math.floor((Math.min(z0, z1) - pad - level.minZ) / SOLID_BUCKET);
    const j1 = Math.floor((Math.max(z0, z1) + pad - level.minZ) / SOLID_BUCKET);
    const seen = (this._solidSeen ??= new Set());
    seen.clear();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = bucketKey(level, i, j);
        const bucket = k < 0 ? null : level.buckets.get(k);
        if (!bucket) continue;
        for (const si of bucket) {
          if (seen.has(si)) continue;
          seen.add(si);
          if (fn(level.spans[si])) return true;
        }
      }
    }
    return false;
  }

  // -- neighbours ----------------------------------------------------------

  /**
   * The extra cost of walking somewhere tight.
   *
   * A pure shortest-path field hugs every corner, because a corner is the
   * shortest way round. People do not: they walk down the middle of a corridor
   * and only squeeze when the building makes them. Without this the route
   * through a 1.20 m corridor clings to the skirting and the report prints the
   * clear width AT THE SKIRTING — 0.63 m — which is not what the corridor is.
   * The penalty is zero at and above the passing width, so it never distorts a
   * route choice in a space that is wide enough; it only decides WHERE INSIDE a
   * space the line runs. `route.length` is still measured geometrically off the
   * finished polyline, so nothing reported to the player is inflated by it.
   */
  comfort(idx) {
    const w = this.width[idx];
    if (w >= PASSING_WIDTH) return 1;
    return 1 + 0.8 * ((PASSING_WIDTH - w) / PASSING_WIDTH);
  }

  /** Fills `out` with [neighbourIdx, stepCost] pairs. Returns the count. */
  neighbours(idx, out) {
    const l = this.levelOf[idx];
    const L = this.levels[l];
    const k = idx - L.base;
    const i = k % L.w, j = (k - i) / L.w;
    let n = 0;
    for (let d = 0; d < 8; d++) {
      const [di, dj, cost] = DIRS[d];
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= L.w || nj >= L.h) continue;
      const nk = L.base + nj * L.w + ni;
      if (!this.pass[nk]) continue;
      if (di && dj) {
        // Refuse a diagonal that cuts a corner: both orthogonal cells must be
        // open, or the route squeezes through a zero-width gap between two
        // pieces of furniture that in reality touch.
        if (!this.pass[L.base + j * L.w + ni] || !this.pass[L.base + nj * L.w + i]) continue;
      }
      out[n++] = nk;
      out[n++] = cost * NAV_CELL * this.comfort(nk);
    }
    const ports = this.portalsFrom.get(idx);
    if (ports) for (const p of ports) { out[n++] = p.to; out[n++] = p.cost; }
    return n;
  }

  // -- distance fields -----------------------------------------------------

  /**
   * A Dijkstra distance field, in metres, from every cell to the nearest goal
   * cell. Cached by key; the cache is bounded because a field over a big
   * building is ~150 kB and thirty people only ever share a dozen goals.
   */
  field(key, goalCells) {
    const hit = this.fields.get(key);
    if (hit) { this.fields.delete(key); this.fields.set(key, hit); return hit; }

    const N = this.pass.length;
    const dist = new Float32Array(N).fill(Infinity);
    const heap = new Heap();
    let seeded = 0;
    for (const c of goalCells) {
      if (c < 0 || !this.pass[c] || dist[c] === 0) continue;
      dist[c] = 0; heap.push(0, c); seeded++;
    }
    const out = new Float64Array(20);
    if (seeded) {
      while (heap.size) {
        const k = heap.pop();
        const d = heap.lastCost;
        // `dist` is Float32 and the heap key is a Float64 sum, so the key must
        // be the value AS STORED or the stale-entry test rejects the live one:
        // 0.2 + 0.2 + 0.2 is 0.6000000000000001 in double and 0.60000002 as a
        // float, and `d > dist[k]` then skips a node that was never expanded.
        // That silently truncated every field to the goal room's own island.
        if (d > dist[k] + 1e-5) continue;
        const n = this.neighbours(k, out);
        for (let t = 0; t < n; t += 2) {
          const nk = out[t] | 0;
          const nd = d + out[t + 1];
          if (nd < dist[nk] - 1e-5) { dist[nk] = nd; heap.push(dist[nk], nk); }
        }
      }
    }
    const f = { dist, reachable: seeded > 0 };
    this.fields.set(key, f);
    if (this.fields.size > 40) this.fields.delete(this.fields.keys().next().value);
    return f;
  }

  /** Distance field to every passable cell of one room. */
  fieldToRoom(roomId) {
    return this.field(`room:${roomId}`, this.roomCells(roomId));
  }

  /** Distance field to the outside face of every exterior door. */
  fieldToOutside() {
    return this.field('outside', this.entrances.map((e) => e.cellOut).filter((c) => c >= 0));
  }

  roomCells(roomId) {
    const ri = this.roomIds.indexOf(roomId);
    if (ri < 0) return [];
    let cells = this._roomCells.get(roomId);
    if (cells) return cells;
    cells = [];
    for (let k = 0; k < this.pass.length; k++) {
      if (this.pass[k] && this.roomIdx[k] === ri) cells.push(k);
    }
    this._roomCells.set(roomId, cells);
    return cells;
  }

  // -- paths ---------------------------------------------------------------

  /**
   * The CLEAR WIDTH of the passage at a cell, measured ACROSS the direction of
   * travel, on the 0.10 m analysis lattice.
   *
   * `width[]` holds each cell's own distance to the nearest obstruction, which
   * is the right quantity for a distance transform and the wrong one to print:
   * standing 150 mm inside a 900 mm doorway, hard against the jamb, it reads
   * 300 mm, and an architect handed "this door is 632 mm" when he drew a 900
   * stops believing every other number on the page.
   *
   * A clear width is the span you have to fit through, so it is measured by
   * counting the unobstructed 100 mm cells across the passage. That is a
   * CONSERVATIVE reading — the true span is between count x 0.10 m and
   * (count + 1) x 0.10 m — which is the right way to round a width that
   * somebody may have to get a wheelchair through. Inside a doorway the count
   * is additionally capped at the leaf width, which is exact.
   *
   * THREE RULES, each of which was once wrong and printed a wrong millimetre
   * figure on the post-occupancy sheet:
   *
   * 1. NARROWEST, NOT WIDEST. A 0.20 m search cell has four 0.10 m quarters,
   *    and taking the widest of their spans erases any obstruction shorter than
   *    the cell: a 120 mm pilaster, a boxed duct, a bookcase set end-on — the
   *    exact things that pinch a real corridor. A 1.40 m corridor pinched to a
   *    hand-measured 0.700 m by a 120 mm stub reported 1.400 m at every cell
   *    across the obstruction, and the sheet then named a different room's door
   *    as the narrowest route. The reading has to be the narrowest span, for
   *    the same reason a schedule of clear widths is: the narrow one is the one
   *    that decides whether he fits.
   * 2. ONLY QUARTERS A PERSON COULD STAND IN. Narrowest over ALL quarters is
   *    too sensitive the other way: the 0.15 m slot between a wardrobe and the
   *    wall is floor, is not a route, and must not be printed as the corridor's
   *    clear width. A quarter counts only when its own clear width is at least
   *    a shoulder — the same PERSON_WIDTH test that decides passability — and
   *    every passable cell has at least one such quarter by construction.
   * 3. MEASURE ACROSS THE PASSAGE, NOT OUT THROUGH THE DOOR. The scan stops at
   *    a room boundary as well as at an obstruction. Without that, the cell in
   *    an 0.80 m corridor directly opposite a doorway measured the corridor
   *    plus the whole room behind the door and read 7.800 m.
   */
  passageWidth(cell, di, dj) {
    const l = this.levelOf[cell];
    const L = this.levels[l];
    const f = L.fine;
    const k = cell - L.base;
    const ci = k % L.w, cj = (k - ci) / L.w;
    // A clear width is measured along a WALL, so the scan is always orthogonal.
    // A diagonal step (neither axis dominant) has no single perpendicular: its
    // 45-degree chord cuts the corner of the room and is not a width of
    // anything — measured that way a 1.00 m doorway in the nursery read 500 mm.
    // Both axes are measured instead, and the narrower is the answer.
    const dirs = (di && dj) || (!di && !dj) ? [[1, 0], [0, 1]] : [[-dj, di]];
    let leafCap = Infinity;
    const dIdx = this.doorIdx[cell];
    if (dIdx >= 0) {
      const o = this.model.openings[this.doorIds[dIdx]];
      if (o && Number.isFinite(o.width)) leafCap = o.width;
    }

    // Two passes: quarters a person fits in, and — only if there are none —
    // every walkable quarter, so a cell nobody can use still returns a number.
    let best = Infinity;
    for (let pass = 0; pass < 2 && !Number.isFinite(best); pass++) {
      const floor = pass === 0 ? PERSON_WIDTH : 0;
      for (let sj = 0; sj < 2; sj++) {
        for (let si = 0; si < 2; si++) {
          const fi0 = ci * 2 + si, fj0 = cj * 2 + sj;
          if (fi0 >= f.w || fj0 >= f.h) continue;
          const k0 = fj0 * f.w + fi0;
          if (!f.walk[k0] || f.width[k0] < floor) continue;
          const room0 = f.roomOf[k0];
          for (const [px, pz] of dirs) {
            let count = 1;
            for (const sign of [1, -1]) {
              for (let step = 1; step <= 40; step++) {
                const i = fi0 + px * step * sign, j = fj0 + pz * step * sign;
                if (i < 0 || j < 0 || i >= f.w || j >= f.h) break;
                const kk = j * f.w + i;
                if (!f.walk[kk]) break;
                // Measured from inside a room, the span stops at that room's
                // own boundary: at the far wall, at the next room, and at the
                // reveal of a door in the side wall — the floor carved through
                // a doorway belongs to no room (roomOf < 0) and is not part of
                // the corridor's clear width. Measured from inside a doorway
                // (room0 < 0) nothing stops it but the masonry, and the leaf
                // width caps the answer anyway.
                if (room0 >= 0 && f.roomOf[kk] !== room0) break;
                count++;
              }
            }
            const span = count * FINE_CELL;
            if (span < best) best = span;
          }
        }
      }
    }
    return Math.min(Number.isFinite(best) ? best : this.width[cell], leafCap);
  }

  /**
   * Walk downhill on a field from a world point.
   *
   * -> { points: [{x,y,z,level}], length, minWidth, widths, doors: [openingId],
   *      rooms: [roomId], cells }
   * or null when the goal is not reachable from here — which is the finding
   * the whole walkthrough exists to surface.
   */
  path(x, z, levelIdx, field, maxSteps = 4000) {
    let idx = this.indexAt(x, z, levelIdx);
    if (idx < 0 || !this.pass[idx]) idx = this.nearestPassable(x, z, levelIdx, 1.5);
    if (idx < 0) return null;
    const dist = field.dist;
    if (!(dist[idx] < Infinity)) return null;

    const cells = [idx];
    const widths = [];
    const doors = [];
    const rooms = [];
    const out = new Float64Array(20);
    let cur = idx;
    let prev = idx;
    let guard = 0;
    while (dist[cur] > 1e-4 && guard++ < maxSteps) {
      const n = this.neighbours(cur, out);
      let best = -1, bestD = dist[cur];
      for (let t = 0; t < n; t += 2) {
        const nk = out[t] | 0;
        if (dist[nk] < bestD - 1e-6) { bestD = dist[nk]; best = nk; }
      }
      if (best < 0) break;
      prev = cur;
      cur = best;
      cells.push(cur);
      const d = this.doorIdx[cur];
      if (d >= 0 && doors[doors.length - 1] !== this.doorIds[d]) doors.push(this.doorIds[d]);
      const r = this.roomIdx[cur];
      if (r >= 0 && rooms[rooms.length - 1] !== this.roomIds[r]) rooms.push(this.roomIds[r]);
    }
    // clear widths, measured across the direction of travel at every step
    let minWidth = Infinity;
    for (let i = 0; i < cells.length; i++) {
      // A three-cell window, snapped to the dominant axis. Taken step by step
      // the direction jitters between orthogonal and diagonal, and a diagonal
      // perpendicular measures the room across its corner rather than measuring
      // the corridor across itself.
      const a = cells[Math.max(0, i - 3)], b = cells[Math.min(cells.length - 1, i + 3)];
      let di = 0, dj = 0;
      if (a !== b && this.levelOf[a] === this.levelOf[b]) {
        const L = this.levels[this.levelOf[a]];
        const ka = a - L.base, kb = b - L.base;
        const ia = ka % L.w, ib = kb % L.w;
        const ja = (ka - ia) / L.w, jb = (kb - ib) / L.w;
        const dx = ib - ia, dz = jb - ja;
        if (Math.abs(dx) >= 2 * Math.abs(dz)) { di = Math.sign(dx); dj = 0; }
        else if (Math.abs(dz) >= 2 * Math.abs(dx)) { di = 0; dj = Math.sign(dz); }
        else { di = Math.sign(dx); dj = Math.sign(dz); }
      }
      const w = this.passageWidth(cells[i], di, dj);
      widths.push(w);
      if (w < minWidth) minWidth = w;
    }
    if (!Number.isFinite(minWidth)) minWidth = this.width[idx];

    const points = this._smooth(cells);
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].level !== points[i - 1].level) { length += STAIR_COST; continue; }
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    }
    return { points, length, minWidth, widths, doors, rooms, cells };
  }

  /**
   * String-pulling. A grid path is a staircase of 0.20 m steps; a person walks
   * a straight line until something is in the way. Corners are kept when the
   * straight line would clip a wall, a doorframe or a table.
   */
  /**
   * The centre of a search cell is not necessarily somewhere a person fits.
   * A 0.20 m cell counts as passable when any ONE of its four 0.10 m quarters
   * is walkable, so its centre can sit inside the wardrobe that blocks the
   * other three — and a walker aiming at that centre never arrives. Every
   * waypoint is therefore moved to the widest quarter of its own cell.
   */
  _snapPoint(cell, out) {
    const L = this.levels[this.levelOf[cell]];
    const f = L.fine;
    const k = cell - L.base;
    const ci = k % L.w, cj = (k - ci) / L.w;
    let best = -1, bw = -1, bi = 0, bj = 0;
    for (let sj = 0; sj < 2; sj++) {
      for (let si = 0; si < 2; si++) {
        const fi = ci * 2 + si, fj = cj * 2 + sj;
        if (fi >= f.w || fj >= f.h) continue;
        const fk = fj * f.w + fi;
        if (!f.walk[fk]) continue;
        if (f.width[fk] > bw) { bw = f.width[fk]; best = fk; bi = fi; bj = fj; }
      }
    }
    if (best < 0) return out;
    out.x = f.minX + (bi + 0.5) * FINE_CELL;
    out.z = f.minZ + (bj + 0.5) * FINE_CELL;
    return out;
  }

  _smooth(cells) {
    const pt = (c) => this._snapPoint(c, this.centreOf(c, { x: 0, y: 0, z: 0, level: 0 }));
    if (cells.length <= 2) return cells.map(pt);
    const pts = [pt(cells[0])];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      const a = cells[anchor], b = cells[i];
      const sameLevel = this.levelOf[a] === this.levelOf[b];
      if (!sameLevel || !this._walkableSight(a, b)) {
        anchor = i - 1;
        pts.push(pt(cells[anchor]));
      }
    }
    pts.push(pt(cells[cells.length - 1]));
    return pts;
  }

  /**
   * Line of sight for a PERSON, on the 0.10 m grid, with a shoulder's margin.
   *
   * `pass[]` is the search lattice, and a 0.20 m search cell is marked passable
   * when ANY ONE of its four 0.10 m quarters is walkable — the right rule for
   * finding a route through a doorway, and far too generous for authoring the
   * line somebody then has to walk down. Smoothing on `pass[]` produced
   * polylines running 0.1-0.2 m inside a door jamb: the search said the route
   * existed, the walker could not follow it, and they ground against the frame
   * until the day ended. The straight leg is only kept when the fine grid is
   * walkable AND its clear width is at least a shoulder the whole way.
   */
  _walkableSight(a, b) {
    if (this.levelOf[a] !== this.levelOf[b]) return false;
    const L = this.levels[this.levelOf[a]];
    const f = L.fine;
    const pa = this.centreOf(a, { x: 0, y: 0, z: 0, level: 0 });
    const ax = pa.x, az = pa.z;
    const pb = this.centreOf(b, { x: 0, y: 0, z: 0, level: 0 });
    const dx = pb.x - ax, dz = pb.z - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (FINE_CELL * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t, z = az + dz * t;
      const i = Math.floor((x - f.minX) / FINE_CELL);
      const j = Math.floor((z - f.minZ) / FINE_CELL);
      if (i < 0 || j < 0 || i >= f.w || j >= f.h) return false;
      const k = j * f.w + i;
      if (!f.walk[k] || f.width[k] < PERSON_WIDTH) return false;
    }
    return true;
  }

  /** Is the straight segment between two cells entirely passable? */
  _lineOfSight(a, b) {
    if (this.levelOf[a] !== this.levelOf[b]) return false;
    const l = this.levelOf[a];
    const L = this.levels[l];
    const ka = a - L.base, kb = b - L.base;
    let i0 = ka % L.w, j0 = (ka - i0) / L.w;
    const i1 = kb % L.w, j1 = (kb - i1) / L.w;
    let di = Math.abs(i1 - i0), dj = Math.abs(j1 - j0);
    const si = i0 < i1 ? 1 : -1, sj = j0 < j1 ? 1 : -1;
    let err = di - dj;
    for (let guard = 0; guard < 4000; guard++) {
      if (!this.pass[L.base + j0 * L.w + i0]) return false;
      if (i0 === i1 && j0 === j1) return true;
      const e2 = 2 * err;
      if (e2 > -dj) { err -= dj; i0 += si; }
      if (e2 < di) { err += di; j0 += sj; }
      // supercover: a diagonal step must not cut a blocked corner
      if (e2 > -dj && e2 < di) {
        const pi = i0 - si, pj = j0 - sj;
        const a1 = pi >= 0 && pi < L.w ? this.pass[L.base + j0 * L.w + pi] : 0;
        const a2 = pj >= 0 && pj < L.h ? this.pass[L.base + pj * L.w + i0] : 0;
        if (!a1 && !a2) return false;
      }
    }
    return false;
  }

  // -- programme -----------------------------------------------------------

  /** Room ids of a given classified kind, biggest first. */
  roomsOfKind(kind) { return this.byKind.get(kind) ?? []; }

  /**
   * Rooms that satisfy a goal, in the goal's own order of preference. Empty
   * when the building has nowhere to do this at all.
   */
  roomsForGoal(goalKey) {
    const g = GOALS[goalKey];
    if (!g) return [];
    const out = [];
    for (const kind of g.rooms) {
      if (kind === '__outside') continue;
      for (const id of this.roomsOfKind(kind)) if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** A sensible standing point inside a room. */
  roomPoint(roomId) { return this.roomAnchors.get(roomId) ?? null; }

  kindOf(roomId) { return this.classes.get(roomId)?.key ?? 'unassigned'; }
  labelOf(roomId) { return this.classes.get(roomId)?.label ?? roomId; }
  areaOf(roomId) { return this.roomById.get(roomId)?.area ?? 0; }
}

// ---------------------------------------------------------------------------
// the masonry, as spans

/**
 * Distance from a point to a wall span, in the span's own frame.
 * The span is a RECTANGLE, `len` long and `2*half` thick, not a capsule: the
 * jamb at the end of a span is a flat reveal, and treating it as a round cap
 * would narrow every doorway by the wall thickness.
 */
function boxDist(t, p, len, half) {
  const dt = t < 0 ? -t : (t > len ? t - len : 0);
  const dp = Math.abs(p) - half;
  const dpp = dp > 0 ? dp : 0;
  return Math.hypot(dt, dpp);
}

/** Does the segment (t0,p0)->(t1,p1) touch the axis-aligned box? Slab test. */
function segmentHitsBox(t0, p0, t1, p1, tMin, tMax, pMin, pMax) {
  let lo = 0, hi = 1;
  const dt = t1 - t0, dp = p1 - p0;
  const clip = (d, a, b, v) => {
    if (Math.abs(d) < 1e-12) return v >= a && v <= b;
    let n = (a - v) / d, f = (b - v) / d;
    if (n > f) { const s = n; n = f; f = s; }
    if (n > lo) lo = n;
    if (f < hi) hi = f;
    return lo <= hi;
  };
  if (!clip(dt, tMin, tMax, t0)) return false;
  if (!clip(dp, pMin, pMax, p0)) return false;
  return lo <= hi;
}

/** Would this step put a body into `s`, or take it through `s`? */
function spanBlocks(s, x0, z0, x1, z1, clearance) {
  const ax = x0 - s.x, az = z0 - s.z;
  const bx = x1 - s.x, bz = z1 - s.z;
  const t0 = ax * s.ux + az * s.uz, p0 = -ax * s.uz + az * s.ux;
  const t1 = bx * s.ux + bz * s.uz, p1 = -bx * s.uz + bz * s.ux;
  const d1 = boxDist(t1, p1, s.len, s.half);
  if (d1 >= clearance) {
    // The step ENDS in the clear. At walking speed a frame is a couple of
    // centimetres against a 120 mm wall, so the only way to end up clear on the
    // far side is a jump; test the segment against the masonry itself.
    return segmentHitsBox(t0, p0, t1, p1, 0, s.len, -s.half, s.half);
  }
  const d0 = boxDist(t0, p0, s.len, s.half);
  if (d0 < clearance) return d1 < d0 - 1e-9;   // already inside: only refuse going deeper
  return true;
}

/**
 * buildSolids(model, levels) -> [ { spans, buckets, ... } ] per level
 *
 * Every wall centreline, cut into the pieces a body cannot walk through: the
 * spans between its openings. A door or a doorless opening is a hole all the
 * way to the floor and is subtracted; a window is only a hole if it starts at
 * the floor, which is what a full-height glazed screen is.
 */
function buildSolids(model, levels) {
  const out = levels.map((L) => ({
    levelId: L.levelId, minX: L.minX, minZ: L.minZ,
    spans: [], buckets: new Map(), cols: 0, maxHalf: 0,
  }));
  const levelIndex = new Map(levels.map((L, i) => [L.levelId, i]));
  const defaultLevel = model.levels?.[0]?.id;
  for (const id in model.walls) {
    const w = model.walls[id];
    const li = levelIndex.get(w.levelId ?? defaultLevel);
    if (li === undefined) continue;
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const holes = [];
    for (const oid of w.openings ?? []) {
      const o = model.openings[oid];
      if (!o) continue;
      if (o.kind === 'window' && (o.sill ?? 0) > 0.2) continue;
      holes.push([o.offset - o.width / 2, o.offset + o.width / 2]);
    }
    holes.sort((p, q) => p[0] - q[0]);
    let cursor = 0;
    const pieces = [];
    for (const [h0, h1] of holes) {
      if (h0 > cursor) pieces.push([cursor, h0]);
      if (h1 > cursor) cursor = h1;
    }
    if (cursor < len) pieces.push([cursor, len]);
    const half = (w.thickness ?? 0.12) / 2;
    for (const [s0, s1] of pieces) {
      if (s1 - s0 < 1e-4) continue;
      out[li].spans.push({
        wallId: id, x: a.x + ux * s0, z: a.z + uz * s0,
        ux, uz, len: s1 - s0, half,
      });
      if (half > out[li].maxHalf) out[li].maxHalf = half;
    }
  }
  // File each span in every 1 m bucket its padded footprint touches, so a step
  // only ever tests the handful of walls that are actually near it. Bucket
  // coordinates are biased so that a wall a few metres outside the lattice —
  // and a query from the pavement, which is where the arrival crowd is — still
  // maps to a non-negative cell of the same flat key space.
  for (const L of out) {
    const pad = L.maxHalf + WALL_CLEARANCE;
    let maxI = 1;
    const boxes = L.spans.map((s) => {
      const ex = s.x + s.ux * s.len, ez = s.z + s.uz * s.len;
      return {
        i0: Math.floor((Math.min(s.x, ex) - pad - L.minX) / SOLID_BUCKET),
        i1: Math.floor((Math.max(s.x, ex) + pad - L.minX) / SOLID_BUCKET),
        j0: Math.floor((Math.min(s.z, ez) - pad - L.minZ) / SOLID_BUCKET),
        j1: Math.floor((Math.max(s.z, ez) + pad - L.minZ) / SOLID_BUCKET),
      };
    });
    for (const b of boxes) if (b.i1 > maxI) maxI = b.i1;
    L.cols = maxI + SOLID_BIAS * 2 + 2;
    for (let n = 0; n < boxes.length; n++) {
      const b = boxes[n];
      for (let j = b.j0; j <= b.j1; j++) {
        for (let i = b.i0; i <= b.i1; i++) {
          const k = bucketKey(L, i, j);
          if (k < 0) continue;
          let arr = L.buckets.get(k);
          if (!arr) { arr = []; L.buckets.set(k, arr); }
          arr.push(n);
        }
      }
    }
  }
  return out;
}

/** Flat key for a bucket coordinate, or -1 when it is off the biased space. */
function bucketKey(L, i, j) {
  const bi = i + SOLID_BIAS, bj = j + SOLID_BIAS;
  if (bi < 0 || bj < 0 || bi >= L.cols) return -1;
  return bj * L.cols + bi;
}

// ---------------------------------------------------------------------------
// the one place the walkthrough legitimately differs from the analysis

/**
 * Give the door swings back.
 *
 * src/analysis/access.js subtracts the whole quarter disc a leaf sweeps from
 * any circulation space, and it is right to: when it measures a corridor it has
 * to assume the leaf could be anywhere in its swing, and a 0.90 m leaf opening
 * into a 1.20 m corridor is a real defect that belongs in the client's e-mail.
 *
 * The walkthrough is in a different position. It SIMULATES every leaf: doors
 * sit closed against the wall and swing only while somebody is going through
 * them. Keeping the conservative subtraction here would measure the clear width
 * beside a door at 0.63 m in a building where nothing is wrong, and it would
 * push the people who walk through it into a detour that nobody makes.
 *
 * So the swept area is restored — but only where it is genuinely clear floor:
 * inside the room polygon, outside every furniture footprint. Then the exact
 * euclidean distance transform is re-run over the repaired grid, using the
 * analysis module's own `distanceTransform`, so every clear width printed by
 * the post-occupancy report is still measured the same way the report to the
 * client was. The conservative grid is untouched; this is a second read of the
 * same source, not a second source.
 */
function restoreDoorSwings(model, fine) {
  const { w, h, walk, roomOf, width, swings, blockers, rooms, doorCells, minX, minZ } = fine;
  if (!swings || !swings.length) return 0;
  const cx = (i) => minX + (i + 0.5) * FINE_CELL;
  const cz = (j) => minZ + (j + 0.5) * FINE_CELL;
  let restored = 0;

  for (const sw of swings) {
    const roomIndex = rooms.findIndex((r) => r.id === sw.roomId);
    if (roomIndex < 0) continue;
    const room = rooms[roomIndex];
    const bb = polygonBBox(sw.poly);
    const i0 = Math.max(0, Math.floor((bb.minX - minX) / FINE_CELL) - 1);
    const i1 = Math.min(w - 1, Math.ceil((bb.maxX - minX) / FINE_CELL) + 1);
    const j0 = Math.max(0, Math.floor((bb.minZ - minZ) / FINE_CELL) - 1);
    const j1 = Math.min(h - 1, Math.ceil((bb.maxZ - minZ) / FINE_CELL) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (walk[k]) continue;
        const x = cx(i), z = cz(j);
        if (!pointInPolygon(x, z, sw.poly)) continue;
        if (!inRoom(room, x, z)) continue;
        let blocked = false;
        for (const b of blockers) {
          if (pointInPolygon(x, z, b.poly)) { blocked = true; break; }
        }
        if (blocked) continue;
        walk[k] = 1;
        if (roomOf[k] < 0) roomOf[k] = roomIndex;
        restored++;
      }
    }
  }
  if (!restored) return 0;

  const seed = new Uint8Array(w * h);
  for (let k = 0; k < seed.length; k++) seed[k] = walk[k] ? 0 : 1;
  const edt = distanceTransform(seed, w, h);
  for (let k = 0; k < width.length; k++) {
    width[k] = walk[k] ? 2 * Math.sqrt(edt[k]) * FINE_CELL : 0;
  }
  // A doorway is exactly as wide as its leaf, never as wide as the grid thinks.
  for (const [oid, cells] of doorCells) {
    const clear = model.openings[oid]?.width ?? Infinity;
    for (const k of cells) if (width[k] > clear) width[k] = clear;
  }
  return restored;
}

// ---------------------------------------------------------------------------
// construction

/**
 * buildNav(model, brief) -> Navmesh | null
 * Null only when the model has no enclosed room at all — there is nothing to
 * walk through, which the caller reports rather than crashing on.
 */
export function buildNav(model, brief = {}) {
  const topo = buildTopology(model);
  if (!topo.rooms.length) return null;
  const classes = classifyRooms(model, topo, brief);
  const ctx = { model, brief, topo, classes };

  const levels = [];
  const fineByLevel = new Map();
  let total = 0;
  const modelLevels = model.levels ?? [];
  for (let li = 0; li < modelLevels.length; li++) {
    const level = modelLevels[li];
    const fine = buildWalkGrid(ctx, level.id);
    if (!fine) continue;
    restoreDoorSwings(model, fine);
    const w = Math.ceil(fine.w / 2), h = Math.ceil(fine.h / 2);
    levels.push({
      levelId: level.id, elevation: level.elevation ?? 0, height: level.height ?? 2.70,
      w, h, minX: fine.minX, minZ: fine.minZ, base: total, fine,
    });
    fineByLevel.set(level.id, fine);
    total += w * h;
  }
  if (!levels.length) return null;

  const pass = new Uint8Array(total);
  const width = new Float32Array(total);
  const roomIdx = new Int16Array(total).fill(-1);
  const doorIdx = new Int16Array(total).fill(-1);
  const levelOf = new Uint8Array(total);

  const roomIds = topo.rooms.map((r) => r.id);
  const roomById = new Map(topo.rooms.map((r) => [r.id, r]));
  const doorIds = [];
  const doorIndexOf = new Map();

  for (let li = 0; li < levels.length; li++) {
    const L = levels[li];
    const f = L.fine;
    // fine roomOf indexes into f.rooms, not into topo.rooms — translate once
    const fineRoomToGlobal = f.rooms.map((r) => roomIds.indexOf(r.id));
    // openingId per fine cell
    const fineDoor = new Int16Array(f.w * f.h).fill(-1);
    for (const [oid, cells] of f.doorCells) {
      let di = doorIndexOf.get(oid);
      if (di === undefined) { di = doorIds.length; doorIds.push(oid); doorIndexOf.set(oid, di); }
      for (const k of cells) fineDoor[k] = di;
    }

    for (let j = 0; j < L.h; j++) {
      for (let i = 0; i < L.w; i++) {
        const c = L.base + j * L.w + i;
        levelOf[c] = li;
        let bestW = 0, room = -1, door = -1, ok = 0;
        for (let dj = 0; dj < 2; dj++) {
          const fj = j * 2 + dj;
          if (fj >= f.h) continue;
          for (let di2 = 0; di2 < 2; di2++) {
            const fi = i * 2 + di2;
            if (fi >= f.w) continue;
            const fk = fj * f.w + fi;
            if (!f.walk[fk]) continue;
            const wpc = f.width[fk];
            if (wpc >= PERSON_WIDTH) ok = 1;
            if (wpc > bestW) bestW = wpc;
            if (room < 0 && f.roomOf[fk] >= 0) room = fineRoomToGlobal[f.roomOf[fk]] ?? -1;
            if (door < 0 && fineDoor[fk] >= 0) door = fineDoor[fk];
          }
        }
        pass[c] = ok;
        width[c] = ok ? bestW : 0;
        roomIdx[c] = room;
        doorIdx[c] = door;
      }
    }
  }

  // -- vertical circulation ------------------------------------------------
  // Stair rooms whose plans overlap on adjacent levels are the same stair.
  const portalsFrom = new Map();
  const addPortal = (a, b, cost) => {
    if (!portalsFrom.has(a)) portalsFrom.set(a, []);
    portalsFrom.get(a).push({ to: b, cost });
  };
  for (let li = 0; li + 1 < levels.length; li++) {
    const A = levels[li], B = levels[li + 1];
    for (let j = 0; j < Math.min(A.h, B.h); j++) {
      for (let i = 0; i < Math.min(A.w, B.w); i++) {
        const a = A.base + j * A.w + i;
        // the two lattices share minX/minZ only if the bboxes matched; convert
        // through world coordinates so a different bbox per level still lines up
        const x = A.minX + (i + 0.5) * NAV_CELL;
        const z = A.minZ + (j + 0.5) * NAV_CELL;
        const bi = Math.floor((x - B.minX) / NAV_CELL);
        const bj = Math.floor((z - B.minZ) / NAV_CELL);
        if (bi < 0 || bj < 0 || bi >= B.w || bj >= B.h) continue;
        const b = B.base + bj * B.w + bi;
        if (!pass[a] || !pass[b]) continue;
        const ra = roomIdx[a] >= 0 ? classes.get(roomIds[roomIdx[a]])?.key : null;
        const rb = roomIdx[b] >= 0 ? classes.get(roomIds[roomIdx[b]])?.key : null;
        if (ra !== 'stair' || rb !== 'stair') continue;
        addPortal(a, b, STAIR_COST);
        addPortal(b, a, STAIR_COST);
      }
    }
  }

  // -- rooms by kind, biggest first ---------------------------------------
  const byKind = new Map();
  const sorted = [...topo.rooms].sort((a, b) => b.area - a.area);
  for (const r of sorted) {
    const k = classes.get(r.id)?.key ?? 'unassigned';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(r.id);
  }

  // -- an anchor point inside every room -----------------------------------
  const nav = new Navmesh({
    model, brief, topo, classes,
    levels, pass, width, roomIdx, doorIdx, levelOf,
    roomIds, roomById, doorIds, portalsFrom, byKind,
    fields: new Map(), _roomCells: new Map(),
    roomAnchors: new Map(), entrances: [], doors: [],
    solids: buildSolids(model, levels),
    cell: NAV_CELL,
  });

  for (const r of topo.rooms) {
    const li = levels.findIndex((L) => L.levelId === r.levelId);
    if (li < 0) continue;
    const c = roomCentroid(r);
    let idx = nav.indexAt(c.x, c.z, li);
    if (idx < 0 || !pass[idx] || roomIdx[idx] !== roomIds.indexOf(r.id)) {
      // centroid landed on furniture: take the widest passable cell of the room
      const cells = nav.roomCells(r.id);
      let best = -1, bestW = -1;
      for (const k of cells) if (width[k] > bestW) { bestW = width[k]; best = k; }
      idx = best;
    }
    if (idx >= 0) {
      const p = nav.centreOf(idx);
      nav.roomAnchors.set(r.id, { x: p.x, z: p.z, y: p.y, level: li, cell: idx });
    }
  }

  // -- doors: geometry for the swinging leaf, and the outside entrances -----
  const seenDoor = new Set();
  for (const oid of Object.keys(model.openings)) {
    const o = model.openings[oid];
    if (o.kind !== 'door' && o.kind !== 'opening') continue;
    const wall = model.walls[o.wallId];
    if (!wall) continue;
    const li = levels.findIndex((L) => L.levelId === (wall.levelId ?? modelLevels[0].id));
    if (li < 0) continue;
    const d = wallDir(model, wall);
    const n = wallNormal(model, wall);
    const c = openingCentre(model, o);
    const leaf = {
      openingId: oid, levelIdx: li, elevation: levels[li].elevation,
      width: o.width, height: o.height ?? 2.05, thickness: wall.thickness,
      cx: c.x, cz: c.z,
      dir: { x: d.x, z: d.z }, nrm: { x: n.x, z: n.z },
      swing: o.swing ?? null, kind: o.kind,
    };
    if (o.kind === 'door' && o.swing) {
      const [side, hand] = String(o.swing).split('-');
      const inward = side === 'in' ? 1 : -1;
      const along = hand === 'left' ? 1 : -1;
      const hingeD = o.offset + (hand === 'left' ? -o.width / 2 : o.width / 2);
      const face = (wall.thickness / 2) * inward;
      leaf.hinge = {
        x: d.a.x + d.x * hingeD + n.x * face,
        z: d.a.z + d.z * hingeD + n.z * face,
      };
      // closed = along the wall from the hinge; open = 90 deg towards `inward`
      leaf.closedDir = { x: d.x * along, z: d.z * along };
      leaf.openDir = { x: n.x * inward, z: n.z * inward };
    }
    nav.doors.push(leaf);
    seenDoor.add(oid);
  }

  // Exterior doors: the outside face is the side with no room behind it.
  for (const oid of topo.exteriorDoors) {
    const o = model.openings[oid];
    const wall = model.walls[o.wallId];
    if (!wall) continue;
    const li = levels.findIndex((L) => L.levelId === (wall.levelId ?? modelLevels[0].id));
    if (li < 0) continue;
    const c = openingCentre(model, o);
    const n = wallNormal(model, wall);
    const inside = (topo.openingRooms[oid] ?? [])[0] ?? null;
    if (!inside) continue;
    const anchor = nav.roomAnchors.get(inside);
    let sx = n.x, sz = n.z;
    if (anchor) {
      // point AWAY from the room this door serves
      const towards = (anchor.x - c.x) * n.x + (anchor.z - c.z) * n.z;
      if (towards > 0) { sx = -n.x; sz = -n.z; }
    }
    const inX = c.x - sx * (wall.thickness / 2 + 0.45);
    const inZ = c.z - sz * (wall.thickness / 2 + 0.45);
    let cellIn = nav.indexAt(inX, inZ, li);
    if (!nav.passable(cellIn)) cellIn = nav.nearestPassable(inX, inZ, li, 1.2);
    const outX = c.x + sx * (wall.thickness / 2 + 0.25);
    const outZ = c.z + sz * (wall.thickness / 2 + 0.25);
    let cellOut = nav.indexAt(outX, outZ, li);
    if (!nav.passable(cellOut)) cellOut = cellIn;
    nav.entrances.push({
      openingId: oid, roomId: inside, levelIdx: li,
      x: c.x, z: c.z, width: o.width,
      outX: c.x + sx * OUTSIDE_STANDOFF, outZ: c.z + sz * OUTSIDE_STANDOFF,
      nx: sx, nz: sz,
      cellIn, cellOut,
      kindInside: classes.get(inside)?.key ?? 'unassigned',
    });
  }

  // The main entrance is the one a visitor would use: into a hall or a
  // reception if there is one, otherwise the widest door on the lowest level.
  nav.entrances.sort((a, b) => {
    const rank = (e) => (e.kindInside === 'hall' || e.kindInside === 'reception' ? 0
      : e.kindInside === 'waiting' || e.kindInside === 'retail' || e.kindInside === 'cafe' ? 1 : 2);
    return (a.levelIdx - b.levelIdx) || (rank(a) - rank(b)) || (b.width - a.width);
  });
  nav.mainEntrance = nav.entrances[0] ?? null;

  // -- an anchor has to be a point somebody can actually stand on ----------
  //
  // roomPoint() is a room's ADDRESS: roomToRoom() measures the travel distance
  // to it, _goalRoomFor() picks the nearest room by it, and _approachCell()
  // aims the annoyed walker at it. It is chosen above as the widest passable
  // cell of the room, and width says nothing about reachability: a dining
  // table's clearance envelope plus two chairs can seal the far strip of a
  // kitchen, and the widest cell then sits in the pocket with no way in. The
  // room reads as used, because the crowd's field is seeded from every one of
  // its cells, but the distance printed to it is a distance to a point nobody
  // can reach.
  //
  // One flood fill from the front door settles it. An anchor outside that fill
  // is re-picked as the widest cell of the room that is inside it. A room with
  // no reachable cell at all keeps its anchor: that room is the finding, and
  // the walkthrough reports it as unreachable rather than moving the goalposts.
  const startCell = nav.mainEntrance
    ? (nav.mainEntrance.cellIn >= 0 ? nav.mainEntrance.cellIn : nav.mainEntrance.cellOut)
    : -1;
  if (startCell >= 0 && pass[startCell]) {
    const reach = nav.field('anchors:reachable', [startCell]).dist;
    for (const r of topo.rooms) {
      const a = nav.roomAnchors.get(r.id);
      if (!a || reach[a.cell] < Infinity) continue;
      let best = -1, bestW = -1;
      for (const k of nav.roomCells(r.id)) {
        if (!(reach[k] < Infinity)) continue;
        if (width[k] > bestW) { bestW = width[k]; best = k; }
      }
      if (best < 0) continue;
      const p = nav.centreOf(best);
      nav.roomAnchors.set(r.id, { x: p.x, z: p.z, y: p.y, level: levelOf[best], cell: best });
    }
  }

  return nav;
}

// ---------------------------------------------------------------------------
// measurements the post-occupancy report needs

/**
 * The narrowest point on a route, and where it is. `route` is a path result.
 * Returned width is the exact clear width from the 0.10 m distance transform,
 * not a grid quantisation, because it is going to be printed in millimetres.
 */
export function pinchOf(nav, route) {
  if (!route || !route.cells?.length) return null;
  let best = -1, bestW = Infinity;
  const widths = route.widths;
  for (let i = 0; i < route.cells.length; i++) {
    const w = widths ? widths[i] : nav.width[route.cells[i]];
    if (w < bestW) { bestW = w; best = route.cells[i]; }
  }
  if (best < 0) return null;
  const p = nav.centreOf(best);
  const roomI = nav.roomIdx[best];
  const doorI = nav.doorIdx[best];
  return {
    width: bestW, x: p.x, z: p.z, level: p.level,
    roomId: roomI >= 0 ? nav.roomIds[roomI] : null,
    openingId: doorI >= 0 ? nav.doorIds[doorI] : null,
    cell: best,
  };
}

/** Straight-line and walking distance between two room anchors. */
export function roomToRoom(nav, fromRoom, toRoom) {
  const a = nav.roomPoint(fromRoom);
  if (!a) return null;
  const f = nav.fieldToRoom(toRoom);
  return nav.path(a.x, a.z, a.level, f);
}
