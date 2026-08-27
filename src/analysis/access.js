// Access, circulation, clear widths and escape.
//
// Two independent measurements, because they answer different questions:
//   * the door graph answers "can I get there at all"
//   * a 0.10 m walkable grid answers "how wide is it and how far is it"
//
// The grid is the room polygons, plus a carved rectangle through every door or
// doorless opening, minus every floor-standing piece of furniture.
//
// A door SWING is not subtracted from the walkable grid, in any room. The leaf
// is only in that quarter circle while somebody is walking through it, and no
// code of practice measures a corridor with the doors held open: clear width is
// measured between the walls. What the swing must be clear of is FURNITURE and
// OTHER DOORS, and both are measured separately below. Subtracting it from the
// route grid as well used to seal the front door with its own leaf and report
// a 0.28 m route to every room in an ordinary house.
//
// Two width conventions, and the difference matters to an architect:
//   * clear width — measured between wall faces along the route. A doorway is
//     not part of it; a 1.20 m corridor served by 0.90 m leaves is a 1.20 m
//     corridor, exactly as the client's own constraint says in writing.
//   * door clear opening — the leaf width, checked in its own right. A doorway
//     narrower than DOOR_MIN_CLEAR does become the route's bottleneck, because
//     at that point something really is in the way.

import {
  polygonBBox, pointInPolygon, obbPolygon, polygonsOverlap, polygonDistance,
  distanceTransform, distPointSeg, r2, r1,
} from './geom.js';
import { PASSABLE_KINDS, bfs, openingCentre, wallNormal, doorSwingPolygon, bboxOfRooms, inRoom } from './topology.js';
import { entryOf, footprintOf, shortName } from './catalogue.js';
import { PRIVATE_ROUTE_TARGETS, BEDROOMS } from './classify.js';
import { isDwelling, briefLimit, requiresAccessibility } from './brief.js';
import { makeIssue } from './issues.js';

export const CELL = 0.10;                 // m — grid resolution
export const DOOR_CARVE_MARGIN = 0.20;    // m carved past each wall face
export const REQUIRED_WIDTH_PUBLIC = 1.20;
export const REQUIRED_WIDTH_DWELLING = 0.90;
export const REQUIRED_TURNING_CIRCLE = 1.50;
export const ESCAPE_LIMIT_DWELLING = 30.0;
export const ESCAPE_LIMIT_PUBLIC = 18.0;  // dead-end travel distance
export const DOOR_MIN_CLEAR = 0.80;       // m — clear opening of a usable door
const ROUTE_FREE = 99;                    // sentinel: a threshold, not a corridor
const MIN_BLOCKING_HEIGHT = 0.25;         // m — below this you step over it

export { isDwelling };

// --------------------------------------------------------------------------
// the walkable grid

export function buildWalkGrid(ctx, levelId) {
  const { model, topo, classes } = ctx;
  const rooms = topo.rooms.filter(r => r.levelId === levelId);
  if (!rooms.length) return null;
  const b = bboxOfRooms(rooms);
  const pad = 1.0;
  const minX = b.minX - pad, minZ = b.minZ - pad;
  const w = Math.ceil((b.maxX - b.minX + 2 * pad) / CELL);
  const h = Math.ceil((b.maxZ - b.minZ + 2 * pad) / CELL);
  const walk = new Uint8Array(w * h);
  const roomOf = new Int16Array(w * h).fill(-1);
  const cx = (i) => minX + (i + 0.5) * CELL;
  const cz = (j) => minZ + (j + 0.5) * CELL;

  const stamp = (poly, fn) => {
    const pb = polygonBBox(poly);
    const i0 = Math.max(0, Math.floor((pb.minX - minX) / CELL) - 1);
    const i1 = Math.min(w - 1, Math.ceil((pb.maxX - minX) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((pb.minZ - minZ) / CELL) - 1);
    const j1 = Math.min(h - 1, Math.ceil((pb.maxZ - minZ) / CELL) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (pointInPolygon(cx(i), cz(j), poly)) fn(j * w + i);
      }
    }
  };

  // 1. floors
  rooms.forEach((room, idx) => stamp(room.polygon, (k) => {
    const i = k % w, j = (k - i) / w;
    if (!inRoom(room, cx(i), cz(j))) return;      // courtyards and pods are not floor
    walk[k] = 1; roomOf[k] = idx;
  }));

  // 2. carve the door holes. Done before the obstacles, so a piece of
  //    furniture standing in a doorway really does seal it.
  const doorCells = new Map();      // openingId -> [cellIndex]
  for (const oid in model.openings) {
    const o = model.openings[oid];
    if (!PASSABLE_KINDS.has(o.kind)) continue;
    const wall = model.walls[o.wallId];
    if (!wall || (wall.levelId ?? model.levels[0].id) !== levelId) continue;
    const c = openingCentre(model, o);
    const n = wallNormal(model, wall);
    const depth = wall.thickness + 2 * DOOR_CARVE_MARGIN;
    const angle = Math.atan2(n.x, n.z);   // rot that maps local +Z onto the normal
    const poly = obbPolygon(c.x, c.z, o.width, depth, angle);
    const cells = [];
    stamp(poly, (k) => { walk[k] = 1; cells.push(k); });
    doorCells.set(oid, cells);
  }

  // 3. furniture
  const blockers = [];
  for (const fid in model.furniture) {
    const f = model.furniture[fid];
    if (f.levelId !== levelId) continue;
    const entry = entryOf(f.catalogId);
    if (entry.anchor && entry.anchor !== 'floor') continue;
    const fp = footprintOf(f, entry);
    if (fp.h < MIN_BLOCKING_HEIGHT || entry.tags.includes('walkable')) continue;
    const poly = obbPolygon(f.x, f.z, fp.w, fp.d, f.rot ?? 0);
    blockers.push({ id: fid, poly, entry, f });
    stamp(poly, (k) => { walk[k] = 0; });
  }

  // 4. door swings. Recorded, never subtracted from the floor: see the note at
  //    the top of this file. They are measured against furniture and against
  //    each other in analyzeAccess().
  const swings = [];
  for (const oid in model.openings) {
    const o = model.openings[oid];
    const wall = model.walls[o.wallId];
    if (!wall || (wall.levelId ?? model.levels[0].id) !== levelId) continue;
    const poly = doorSwingPolygon(model, o);
    if (!poly) continue;
    const hinge = poly[0];
    const tip = poly[poly.length - 1];
    const room = rooms.find(r => inRoom(r, (hinge[0] + tip[0]) / 2, (hinge[1] + tip[1]) / 2));
    swings.push({ id: oid, poly, hinge, radius: o.width, roomId: room?.id ?? null });
  }

  // 5. clear width from an exact euclidean distance transform of the obstacles.
  //
  //    The transform measures from cell CENTRE to cell CENTRE, and the face of
  //    the obstacle sits half a cell inside the first blocked centre — at both
  //    ends. Left uncorrected the raster reads every gap one whole cell wide,
  //    and a 1.28 m corridor is reported as 1.40 m. Subtracting CELL removes
  //    that bias; what is left is +/- half a cell of phase, 50 mm at 0.10 m.
  const seed = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) seed[k] = walk[k] ? 0 : 1;
  const edt = distanceTransform(seed, w, h);
  const width = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) {
    width[k] = walk[k] ? Math.max(0, 2 * Math.sqrt(edt[k]) * CELL - CELL) : 0;
  }
  // At a doorway the clear width is the leaf width exactly, and the raster
  // cannot resolve that on its own — a 0.90 m leaf lands on 8 or 9 cells
  // depending on where the grid falls, so it reads 0.80 m half the time. An
  // architect reading "0.80 m" against a door he drew at 900 would rightly
  // stop trusting every other number in the report. Adding back the one cell
  // of phase and capping at the leaf width states the dimension he drew;
  // anything standing in the opening has already taken the cell out of `walk`,
  // so an obstructed doorway still reads narrow.
  for (const [oid, cells] of doorCells) {
    const clear = model.openings[oid]?.width ?? Infinity;
    for (const k of cells) if (walk[k]) width[k] = Math.min(clear, width[k] + CELL);
  }

  // Route width: the width the CORRIDOR test walks on.
  //
  // A doorway is a threshold, not a corridor. The constriction it puts in an
  // inscribed-circle measurement does not stop at the reveal either: half a
  // leaf-width further into the room the biggest circle that fits is still
  // pinched by the two reveal corners, so a 1.28 m corridor entered through a
  // 0.90 m door measures 0.93 m and the client complains about a corridor he
  // asked for and got. The zone that belongs to the door is therefore the leaf
  // width by (wall + one leaf width), and inside it a passage that is at least
  // a usable clear opening does not count as the route's narrowest point.
  // Anything that narrows the opening below that — furniture in the doorway —
  // has already lost its cells from `walk`, keeps its measured width, and is
  // reported for what it is.
  const routeWidth = Float64Array.from(width);
  for (const oid in model.openings) {
    const o = model.openings[oid];
    if (!PASSABLE_KINDS.has(o.kind)) continue;
    const wall = model.walls[o.wallId];
    if (!wall || (wall.levelId ?? model.levels[0].id) !== levelId) continue;
    const c = openingCentre(model, o);
    const n = wallNormal(model, wall);
    const zone = obbPolygon(c.x, c.z, o.width, wall.thickness + o.width + 2 * CELL,
      Math.atan2(n.x, n.z));
    stamp(zone, (k) => {
      if (walk[k] && width[k] >= DOOR_MIN_CLEAR - 1e-9) routeWidth[k] = ROUTE_FREE;
    });
  }

  return { levelId, w, h, minX, minZ, walk, roomOf, width, routeWidth, rooms, doorCells, blockers, swings, cx, cz };
}

// --------------------------------------------------------------------------
// grid searches

// 8-connected, but a diagonal step is refused when either orthogonal cell
// beside it is blocked: without that, a route squeezes through a zero-width
// corner and the grid reports a passage where the drawing has none.
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class Heap {
  constructor(cmp) { this.a = []; this.cmp = cmp; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < a.length && this.cmp(a[l], a[s]) < 0) s = l;
        if (r < a.length && this.cmp(a[r], a[s]) < 0) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]]; i = s;
      }
    }
    return top;
  }
}

/** Shortest travel distance in metres from any start cell. */
export function travelDistances(grid, starts) {
  const dist = new Float64Array(grid.w * grid.h).fill(Infinity);
  const heap = new Heap((a, b) => a[0] - b[0]);
  for (const k of starts) { if (grid.walk[k]) { dist[k] = 0; heap.push([0, k]); } }
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > dist[k]) continue;
    const i = k % grid.w, j = (k - i) / grid.w;
    for (const [di, dj, cost] of NEIGHBOURS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.w || nj >= grid.h) continue;
      const nk = nj * grid.w + ni;
      if (!grid.walk[nk]) continue;
      if (di && dj && !(grid.walk[j * grid.w + ni] && grid.walk[nj * grid.w + i])) continue;
      const nd = d + cost * CELL;
      if (nd < dist[nk] - 1e-9) { dist[nk] = nd; heap.push([nd, nk]); }
    }
  }
  return dist;
}

/**
 * Widest-path search: best achievable bottleneck clear width to every cell.
 * Walks on `routeWidth`, so doorways wide enough to be doorways do not count
 * as the corridor's narrowest point.
 */
export function bottleneckWidths(grid, starts) {
  const field = grid.routeWidth ?? grid.width;
  const best = new Float64Array(grid.w * grid.h).fill(-1);
  const heap = new Heap((a, b) => b[0] - a[0]);   // max-first
  for (const k of starts) {
    if (!grid.walk[k]) continue;
    best[k] = field[k];
    heap.push([best[k], k]);
  }
  while (heap.size) {
    const [v, k] = heap.pop();
    if (v < best[k]) continue;
    const i = k % grid.w, j = (k - i) / grid.w;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.w || nj >= grid.h) continue;
      const nk = nj * grid.w + ni;
      if (!grid.walk[nk]) continue;
      if (di && dj && !(grid.walk[j * grid.w + ni] && grid.walk[nj * grid.w + i])) continue;
      const nv = Math.min(v, field[nk]);
      if (nv > best[nk] + 1e-9) { best[nk] = nv; heap.push([nv, nk]); }
    }
  }
  return best;
}

// --------------------------------------------------------------------------

export function analyzeAccess(ctx) {
  const { model, brief, topo, classes } = ctx;
  const issues = [];
  const dwelling = isDwelling(brief);
  // The client puts these numbers in the brief in writing ("Circulation must
  // stay at least 1.40 m clear"). Measuring against our own default instead
  // would have him contradict his own letter, which is the one thing a report
  // to an architect must never do. The defaults below apply only when the
  // brief is silent — a sandbox model, or a hand-written test brief.
  const requiredWidth = briefLimit(brief, 'access.corridorWidth',
    dwelling ? REQUIRED_WIDTH_DWELLING : REQUIRED_WIDTH_PUBLIC);
  const escapeLimit = briefLimit(brief, 'access.escapeDistance',
    dwelling ? ESCAPE_LIMIT_DWELLING : ESCAPE_LIMIT_PUBLIC);
  const accessible = requiresAccessibility(brief);
  const nameOf = (roomId) => classes.get(roomId)?.label ?? 'room';

  const metrics = {
    entranceCount: topo.exteriorDoors.length,
    requiredWidth,
    escapeLimit,
    accessible,
    rooms: {},
    graphEdgeCount: topo.graphEdgeCount,
  };

  if (topo.exteriorDoors.length === 0) {
    issues.push(makeIssue('ACCESS_NO_ENTRANCE', { measured: 0, required: 1 }));
  }

  // -- reachability over the door graph -------------------------------------
  const starts = ['OUTSIDE', ...topo.rooms.filter(r => classes.get(r.id)?.key === 'stair').map(r => r.id)];
  const reached = new Set();
  for (const s of starts) for (const k of bfs(topo.adjacency, s).keys()) reached.add(k);

  const noDoor = topo.rooms.filter(r => r.doors.length === 0);
  const unreachable = topo.rooms.filter(r => r.doors.length > 0 && !reached.has(r.id));

  for (const room of noDoor) {
    issues.push(makeIssue('ACCESS_ROOM_NO_DOOR', {
      measured: 0, required: 1, room: nameOf(room.id), area: room.area,
    }, { roomId: room.id }));
  }
  for (const room of unreachable) {
    issues.push(makeIssue('ACCESS_ROOM_UNREACHABLE', {
      measured: unreachable.length, required: 0, room: nameOf(room.id),
    }, { roomId: room.id }));
  }

  // -- a WC you can only reach through a bedroom ----------------------------
  const bedrooms = topo.rooms.filter(r => BEDROOMS.has(classes.get(r.id)?.key)).map(r => r.id);
  if (bedrooms.length) {
    const blocked = new Set(bedrooms);
    const withoutBedrooms = new Set();
    for (const s of starts) {
      if (blocked.has(s)) continue;
      for (const k of bfs(topo.adjacency, s, blocked).keys()) withoutBedrooms.add(k);
    }
    for (const room of topo.rooms) {
      const cls = classes.get(room.id);
      if (!PRIVATE_ROUTE_TARGETS.has(cls?.key)) continue;
      if (!reached.has(room.id) || withoutBedrooms.has(room.id)) continue;
      const through = room.doors
        .map(d => topo.openingRooms[d]?.find(x => x !== room.id))
        .filter(x => x && bedrooms.includes(x))[0];
      issues.push(makeIssue('ACCESS_WC_THROUGH_BEDROOM', {
        measured: 1, required: 2, room: nameOf(room.id), through: through ? nameOf(through) : 'bedroom',
      }, { roomId: room.id }));
    }
  }

  // -- grid measurements, per level -----------------------------------------
  for (const level of model.levels) {
    const grid = buildWalkGrid(ctx, level.id);
    if (!grid) continue;

    const entryCells = [];
    for (const oid of topo.exteriorDoors) {
      for (const k of grid.doorCells.get(oid) ?? []) entryCells.push(k);
    }
    if (!entryCells.length) {
      // Upper floor: start from the stair, which is where you arrive.
      grid.rooms.forEach((room, idx) => {
        if (classes.get(room.id)?.key !== 'stair') return;
        for (let k = 0; k < grid.roomOf.length; k++) if (grid.roomOf[k] === idx) entryCells.push(k);
      });
    }

    const hasEntry = entryCells.length > 0;
    const dist = hasEntry ? travelDistances(grid, entryCells) : null;
    const bottleneck = hasEntry ? bottleneckWidths(grid, entryCells) : null;

    grid.rooms.forEach((room, idx) => {
      let cells = 0, maxWidth = 0, worstEscape = 0, bestBottleneck = 0, reachedCells = 0;
      for (let k = 0; k < grid.roomOf.length; k++) {
        if (grid.roomOf[k] !== idx || !grid.walk[k]) continue;
        cells++;
        if (grid.width[k] > maxWidth) maxWidth = grid.width[k];
        if (!hasEntry) continue;
        if (Number.isFinite(dist[k])) {
          reachedCells++;
          if (dist[k] > worstEscape) worstEscape = dist[k];
          if (bottleneck[k] > bestBottleneck) bestBottleneck = bottleneck[k];
        }
      }
      // The route into a room is never reported wider than the room's own
      // widest point — and this is also what turns the doorway sentinel back
      // into a real dimension for a room whose only cells are in a doorway.
      bestBottleneck = Math.min(bestBottleneck, maxWidth);
      const m = {
        name: nameOf(room.id),
        kind: classes.get(room.id)?.key ?? 'unassigned',
        area: r2(room.area),
        freeFloor: r2(cells * CELL * CELL),
        maxClearWidth: r2(maxWidth),
        routeClearWidth: hasEntry ? r2(bestBottleneck) : null,
        travelToExit: hasEntry && reachedCells ? r1(worstEscape) : null,
        gridReachable: reachedCells > 0,
      };
      metrics.rooms[room.id] = m;

      if (!hasEntry) return;
      if (unreachable.some(r => r.id === room.id) || noDoor.some(r => r.id === room.id)) return;

      if (!reachedCells) {
        // The door graph says you can get here; the floor says you cannot.
        // Something is standing in the doorway.
        const culprit = grid.blockers.find(b => room.doors.some(
          oid => (grid.doorCells.get(oid) ?? []).some((k) => {
            const i = k % grid.w, j = (k - i) / grid.w;
            return pointInPolygon(grid.cx(i), grid.cz(j), b.poly);
          })));
        issues.push(makeIssue('ACCESS_ROUTE_BLOCKED', {
          measured: 0, required: requiredWidth, room: nameOf(room.id),
          obstruction: culprit ? `the ${shortName(culprit.entry).toLowerCase()} standing in the doorway` : 'whatever is standing in the doorway',
        }, { roomId: room.id, furnitureId: culprit?.id }));
        return;
      }

      if (bestBottleneck + 1e-6 < requiredWidth) {
        issues.push(makeIssue('ACCESS_CLEAR_WIDTH', {
          measured: bestBottleneck, required: requiredWidth, room: nameOf(room.id),
        }, { roomId: room.id }));
      }
      if (accessible && maxWidth + 1e-6 < REQUIRED_TURNING_CIRCLE) {
        issues.push(makeIssue('ACCESS_TURNING_CIRCLE', {
          measured: maxWidth, required: REQUIRED_TURNING_CIRCLE, room: nameOf(room.id),
        }, { roomId: room.id }));
      }
      if (worstEscape > escapeLimit) {
        issues.push(makeIssue('ACCESS_ESCAPE_DISTANCE', {
          measured: worstEscape, required: escapeLimit, room: nameOf(room.id),
        }, { roomId: room.id }));
      }
    });

    // -- door swings ---------------------------------------------------------
    for (const s of grid.swings) {
      for (const b of grid.blockers) {
        if (!polygonsOverlap(s.poly, b.poly)) continue;
        let near = Infinity;
        for (let i = 0; i < b.poly.length; i++) {
          const p = b.poly[i], q = b.poly[(i + 1) % b.poly.length];
          near = Math.min(near, distPointSeg(s.hinge[0], s.hinge[1], p[0], p[1], q[0], q[1]));
        }
        const intrusion = Math.max(0, s.radius - near);
        if (intrusion < 0.02) continue;
        issues.push(makeIssue('ACCESS_DOOR_SWING_BLOCKED', {
          measured: intrusion, required: s.radius,
          room: s.roomId ? nameOf(s.roomId) : 'room',
          item: shortName(b.entry).toLowerCase(),
        }, { openingId: s.id, furnitureId: b.id }));
      }
    }
    for (let a = 0; a < grid.swings.length; a++) {
      for (let b = a + 1; b < grid.swings.length; b++) {
        const s1 = grid.swings[a], s2 = grid.swings[b];
        if (!polygonsOverlap(s1.poly, s2.poly)) continue;
        // The number the client is given is the one he can check on the plan:
        // how far apart the two hinges are, against the two leaf widths. The
        // old figure was radius + radius - distance, which is not a length of
        // anything and read as "the leaves overlap by 1.22 m" for two 0.90 m
        // doors.
        const d = Math.hypot(s1.hinge[0] - s2.hinge[0], s1.hinge[1] - s2.hinge[1]);
        if (s1.radius + s2.radius - d < 0.02) continue;
        issues.push(makeIssue('ACCESS_DOOR_SWING_CLASH', {
          measured: d, required: Math.max(s1.radius, s2.radius),
          leafA: s1.radius, leafB: s2.radius,
          room: s1.roomId ? nameOf(s1.roomId) : 'entrance',
        }, { openingId: s1.id }));
      }
    }
  }

  metrics.unreachableRooms = unreachable.length;
  metrics.roomsWithoutDoors = noDoor.length;
  return { issues, metrics };
}

/** Exposed for the walkthrough NPCs, which want the same grid the client used. */
export function walkableGrid(ctx, levelId) {
  return buildWalkGrid(ctx, levelId);
}

export { polygonDistance };
