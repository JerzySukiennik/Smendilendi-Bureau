// Topology: the rooms of every level, which room each opening serves, and the
// door adjacency graph the access module walks.
//
// All of it comes from src/model/rooms.js — computeRooms() already returns
// clear internal polygons (offset to the wall faces), the doors and windows on
// each room, and the door edges including the ones that lead OUTSIDE. This file
// only merges the per-level results and adds the two pieces of geometry the
// analysis needs and the model layer does not provide: where an opening sits in
// the world, and the quarter disc a door leaf sweeps.

import { wallDir, wallPoint } from '../model/building.js';
import { computeRooms, roomGraph } from '../model/rooms.js';
import { polygonArea, polygonPerimeter, polygonBBox, pointInPolygon } from './geom.js';

export const PASSABLE_KINDS = new Set(['door', 'opening']);
export const OUTSIDE = 'OUTSIDE';

/** Is (x, z) inside this room, holes excluded? */
export function inRoom(room, x, z) {
  if (!pointInPolygon(x, z, room.polygon)) return false;
  for (const h of room.holes ?? []) if (pointInPolygon(x, z, h)) return false;
  return true;
}

/** World point on the wall centreline at the opening's centre. */
export function openingCentre(model, opening) {
  const wall = model.walls[opening.wallId];
  if (!wall) return null;
  return wallPoint(model, wall, opening.offset, 0);
}

/** Unit normal of a wall, on the side wallPoint's positive offset moves to. */
export function wallNormal(model, wall) {
  const d = wallDir(model, wall);
  return { x: -d.z, z: d.x };
}

export function buildTopology(model) {
  const rooms = [];
  const edges = [];
  for (const level of model.levels) {
    const res = computeRooms(model, level.id);
    for (const id of res.order) {
      const r = res.rooms[id];
      rooms.push({
        id: r.id,
        levelId: r.levelId ?? level.id,
        polygon: r.polygon,
        holes: r.holes ?? [],
        area: Number.isFinite(r.area) ? r.area : polygonArea(r.polygon),
        perimeter: Number.isFinite(r.perimeter) ? r.perimeter : polygonPerimeter(r.polygon),
        name: r.name ?? null,
        program: r.program ?? null,
        key: r.id,
        doors: [...(r.doors ?? [])],
        windows: [...(r.windows ?? [])],
        wallIds: r.wallIds ?? [],
      });
    }
    for (const e of res.edges ?? []) edges.push(e);
    // Consulted so the model layer's own view is exercised on every run; the
    // measurements below are built on `edges`, which is the same data.
    try { roomGraph(model, res); } catch { /* the graph is optional here */ }
  }

  const byId = new Map(rooms.map(r => [r.id, r]));

  const openingRooms = {};
  for (const r of rooms) {
    for (const oid of [...r.doors, ...r.windows]) {
      (openingRooms[oid] ??= []).push(r.id);
    }
  }

  const exteriorDoors = [];
  const adjacency = new Map();
  for (const r of rooms) adjacency.set(r.id, []);
  adjacency.set(OUTSIDE, []);
  const link = (a, b, openingId) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push({ to: b, openingId });
  };

  for (const e of edges) {
    const o = model.openings[e.openingId];
    if (!o || !PASSABLE_KINDS.has(o.kind)) continue;
    link(e.a, e.b, e.openingId);
    link(e.b, e.a, e.openingId);
    if (e.a === OUTSIDE || e.b === OUTSIDE) exteriorDoors.push(e.openingId);
  }

  return {
    rooms, byId, openingRooms, exteriorDoors, adjacency,
    graphEdgeCount: edges.length,
  };
}

/**
 * The quarter disc a door leaf sweeps, as a polygon.
 * 'left' hangs at the node-a end of the hole, 'right' at the node-b end.
 * 'in-*' swings to the side wallPoint's positive offset moves to, 'out-*' to
 * the other. Radius = the leaf width: a 0.90 m leaf needs 0.90 m of clear floor.
 */
export function doorSwingPolygon(model, opening, segments = 8) {
  if (opening.kind !== 'door' || !opening.swing) return null;
  const wall = model.walls[opening.wallId];
  if (!wall) return null;
  const d = wallDir(model, wall);
  const n = wallNormal(model, wall);
  const [side, hand] = String(opening.swing).split('-');
  const inward = side === 'in' ? 1 : -1;
  const along = hand === 'left' ? 1 : -1;
  const hingeD = opening.offset + (hand === 'left' ? -opening.width / 2 : opening.width / 2);
  const face = (wall.thickness / 2) * inward;
  const hx = d.a.x + d.x * hingeD + n.x * face;
  const hz = d.a.z + d.z * hingeD + n.z * face;
  const r = opening.width;
  const pts = [[hx, hz]];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (Math.PI / 2);   // 0 = flat on the wall, pi/2 = fully open
    const ax = d.x * along * Math.cos(t) + n.x * inward * Math.sin(t);
    const az = d.z * along * Math.cos(t) + n.z * inward * Math.sin(t);
    pts.push([hx + ax * r, hz + az * r]);
  }
  return pts;
}

/** Breadth-first search over the door graph. Returns Map(roomId -> hops). */
export function bfs(adjacency, start, blocked = new Set()) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of adjacency.get(cur) ?? []) {
      if (blocked.has(e.to) || dist.has(e.to)) continue;
      dist.set(e.to, dist.get(cur) + 1);
      queue.push(e.to);
    }
  }
  return dist;
}

export function bboxOfRooms(rooms) {
  let b = null;
  for (const r of rooms) {
    const rb = polygonBBox(r.polygon);
    b = b ? {
      minX: Math.min(b.minX, rb.minX), minZ: Math.min(b.minZ, rb.minZ),
      maxX: Math.max(b.maxX, rb.maxX), maxZ: Math.max(b.maxZ, rb.maxZ),
    } : rb;
  }
  return b;
}
