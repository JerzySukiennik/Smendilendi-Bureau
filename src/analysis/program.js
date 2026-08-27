// Program and ergonomics.
//
// Program: does the drawing contain the rooms the brief asked for, at the areas
// it asked for, next to the things it asked them to be next to.
// Ergonomics: can the furniture actually be used. Every clearance is measured
// by casting rays out of the face of the piece until they hit a wall, another
// piece, or a door swing — so the number in the complaint is the real distance
// on the drawing, not a bounding-box overlap.

import { wallDir } from '../model/building.js';
import { obbPolygon, frontVector, rotY, r2 } from './geom.js';
import { bfs, doorSwingPolygon, inRoom } from './topology.js';
import { entryOf, footprintOf, clearanceOf, shortName, pretty } from './catalogue.js';
import { canonicalKey, ROOM_KINDS } from './classify.js';
import { makeIssue } from './issues.js';

export const KITCHEN_TRIANGLE_MIN = 3.6;
export const KITCHEN_TRIANGLE_MAX = 8.0;
export const CLEARANCE_PROBE_EXTRA = 0.60;   // how far past the requirement we look
export const CLEARANCE_TOLERANCE = 0.03;     // 30 mm — below this it is drawing tolerance, not a fault
const SIDE_SAMPLES = [0.25, 0.5, 0.75];
const SIDE_WORDS = {
  front: 'in front of', back: 'behind', left: 'to the left of', right: 'to the right of',
};

const USE_VERBS = [
  [/wardrobe|closet/, 'open the doors'],
  [/^bed$|bed\b/, 'get into it'],
  [/wc|toilet/, 'sit down'],
  [/fridge/, 'open the door'],
  [/desk|workstation/, 'pull the chair out'],
  [/sink|basin/, 'stand at it'],
  [/hob|oven|cooker/, 'stand at it to cook'],
  [/shower|bath/, 'step in'],
  [/sofa|chair|seat/, 'sit down without climbing over something'],
];

function useVerb(entry) {
  const hay = `${entry.id ?? ''} ${entry.tags.join(' ')}`.toLowerCase();
  for (const [re, verb] of USE_VERBS) if (re.test(hay)) return verb;
  return 'use it';
}

// --------------------------------------------------------------------------
// ray casting against the room's obstacles

function rayPolygon(px, pz, dx, dz, poly, maxT) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a[0] - px) * ez - (a[1] - pz) * ex) / denom;
    const u = ((a[0] - px) * dz - (a[1] - pz) * dx) / denom;
    if (t > 1e-6 && t < best && u >= 0 && u <= 1 && t <= maxT) best = t;
  }
  return best;
}

function wallRects(model, levelId) {
  const out = [];
  for (const id in model.walls) {
    const w = model.walls[id];
    if ((w.levelId ?? model.levels[0].id) !== levelId) continue;
    const d = wallDir(model, w);
    const cx = (d.a.x + d.b.x) / 2, cz = (d.a.z + d.b.z) / 2;
    const rot = Math.atan2(-d.z, d.x);       // local +X along the wall
    out.push({ id, poly: obbPolygon(cx, cz, d.len, w.thickness, rot) });
  }
  return out;
}

/** Free distance out of one face of a placed piece, in metres. */
function measureClearance(f, entry, side, obstacles, maxT) {
  const fp = footprintOf(f, entry);
  const rot = f.rot ?? 0;
  const [fx, fz] = frontVector(rot);
  // local axes: +Z front, -Z back, +X right, -X left
  const dirs = {
    front: [fx, fz],
    back: [-fx, -fz],
    right: rotY(1, 0, rot),
    left: rotY(-1, 0, rot),
  };
  const halfDepth = { front: fp.d / 2, back: fp.d / 2, left: fp.w / 2, right: fp.w / 2 };
  const spanAxis = { front: rotY(1, 0, rot), back: rotY(1, 0, rot), left: rotY(0, 1, rot), right: rotY(0, 1, rot) };
  const spanLen = { front: fp.w, back: fp.w, left: fp.d, right: fp.d };

  const [dx, dz] = dirs[side];
  const [sx, sz] = spanAxis[side];
  let min = Infinity;
  for (const t of SIDE_SAMPLES) {
    const off = (t - 0.5) * spanLen[side];
    const px = f.x + dx * halfDepth[side] + sx * off;
    const pz = f.z + dz * halfDepth[side] + sz * off;
    let hit = maxT;
    for (const o of obstacles) {
      if (o.ownerId === f.id) continue;
      const h = rayPolygon(px, pz, dx, dz, o.poly, maxT);
      if (h < hit) hit = h;
    }
    if (hit < min) min = hit;
  }
  return min;
}

// --------------------------------------------------------------------------

export function analyzeProgram(ctx) {
  const { model, brief, topo, classes } = ctx;
  const issues = [];
  const levelById = new Map(model.levels.map(l => [l.id, l]));
  const nameOf = (id) => classes.get(id)?.label ?? 'room';

  const metrics = { program: [], ergonomics: [], kitchens: [], ceilings: [] };

  // -- required rooms -------------------------------------------------------
  const entries = Array.isArray(brief?.program) ? brief.program : [];
  const byKind = new Map();
  for (const room of topo.rooms) {
    const key = classes.get(room.id)?.key ?? 'unassigned';
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push(room);
  }

  for (const entry of entries) {
    const key = canonicalKey(entry.key) ?? entry.key;
    const found = [...(byKind.get(key) ?? [])].sort((a, b) => b.area - a.area);
    const want = entry.count ?? 1;
    const label = entry.name ?? ROOM_KINDS[key]?.label ?? pretty(entry.key);

    metrics.program.push({
      key, name: label, required: want, found: found.length,
      minArea: entry.minArea ?? null,
      areas: found.map(r => r2(r.area)),
    });

    if (found.length < want) {
      issues.push(makeIssue('PROGRAM_ROOM_MISSING', {
        measured: found.length, required: want, item: label,
      }));
    }

    for (const room of found.slice(0, want)) {
      if (Number.isFinite(entry.minArea) && room.area + 1e-6 < entry.minArea) {
        issues.push(makeIssue('PROGRAM_ROOM_UNDERSIZED', {
          measured: room.area, required: entry.minArea, room: nameOf(room.id),
        }, { roomId: room.id }));
      }
      for (const tag of entry.requires ?? []) {
        if (!(classes.get(room.id)?.tags?.has(tag))) {
          issues.push(makeIssue('PROGRAM_TAG_MISSING', {
            measured: 0, required: 1, room: nameOf(room.id), item: pretty(tag),
          }, { roomId: room.id }));
        }
      }
      for (const other of entry.adjacentTo ?? []) {
        const otherKey = canonicalKey(other) ?? other;
        const targets = byKind.get(otherKey) ?? [];
        if (!targets.length) continue;                 // already reported as missing
        const hops = bfs(topo.adjacency, room.id);
        const best = Math.min(...targets.map(t => hops.get(t.id) ?? Infinity));
        if (best > 1) {
          issues.push(makeIssue('PROGRAM_ADJACENCY_MISSING', {
            measured: Number.isFinite(best) ? best : 99, required: 1,
            room: nameOf(room.id),
            item: ROOM_KINDS[otherKey]?.label ?? pretty(other),
          }, { roomId: room.id }));
        }
      }
    }
  }

  // -- ceiling heights ------------------------------------------------------
  const seenLevels = new Set();
  for (const room of topo.rooms) {
    const cls = classes.get(room.id);
    const level = levelById.get(room.levelId) ?? model.levels[0];
    if (!cls?.habitable) continue;
    const attic = /attic|loft/i.test(level.name ?? '');
    const required = attic ? 2.20 : cls.minCeiling;
    const tag = `${level.id}:${required}`;
    if (level.height + 1e-6 < required && !seenLevels.has(tag)) {
      seenLevels.add(tag);
      metrics.ceilings.push({ levelId: level.id, height: r2(level.height), required });
      issues.push(makeIssue('PROGRAM_CEILING_LOW', {
        measured: level.height, required, room: level.name ?? level.id,
      }, { roomId: room.id }));
    }
  }

  // -- ergonomics -----------------------------------------------------------
  for (const level of model.levels) {
    const walls = wallRects(model, level.id);
    const furniture = Object.values(model.furniture).filter(f => f.levelId === level.id);
    const obstacles = [
      ...walls.map(w => ({ poly: w.poly, ownerId: null })),
      ...furniture.map(f => {
        const e = entryOf(f.catalogId);
        const fp = footprintOf(f, e);
        return { poly: obbPolygon(f.x, f.z, fp.w, fp.d, f.rot ?? 0), ownerId: f.id };
      }),
    ];
    for (const oid in model.openings) {
      const o = model.openings[oid];
      const w = model.walls[o.wallId];
      if (!w || (w.levelId ?? model.levels[0].id) !== level.id) continue;
      const poly = doorSwingPolygon(model, o);
      if (poly) obstacles.push({ poly, ownerId: null });
    }

    for (const f of furniture) {
      const entry = entryOf(f.catalogId);
      const clr = clearanceOf(f, entry);
      const room = topo.rooms.find(r => r.levelId === level.id && inRoom(r, f.x, f.z));
      for (const side of ['front', 'back', 'left', 'right']) {
        const required = clr[side] ?? 0;
        if (required <= 0.01) continue;
        const maxT = required + CLEARANCE_PROBE_EXTRA;
        const available = measureClearance(f, entry, side, obstacles, maxT);
        metrics.ergonomics.push({
          furnitureId: f.id, item: entry.name, side,
          available: r2(Math.min(available, maxT)), required: r2(required),
        });
        if (available < required - CLEARANCE_TOLERANCE) {
          issues.push(makeIssue('ERGO_CLEARANCE_BLOCKED', {
            measured: available, required,
            room: room ? nameOf(room.id) : 'plan',
            item: shortName(entry).toLowerCase(),
            where: SIDE_WORDS[side],
            verb: useVerb(entry),
          }, { furnitureId: f.id, roomId: room?.id }));
        }
      }
    }
  }

  // -- kitchen work triangle ------------------------------------------------
  for (const room of topo.rooms) {
    const cls = classes.get(room.id);
    if (cls?.key !== 'kitchen') continue;
    const pieces = cls.furniture.map(id => model.furniture[id]).filter(Boolean);
    const byTag = (tag) => pieces.find(f => entryOf(f.catalogId).tags.includes(tag));
    // The catalogue has no 'fridge' tag — a fridge is a cold appliance, and the
    // only honest way to find one is by its catalogue id.
    const byId = (re) => pieces.find(f => re.test(String(f.catalogId ?? '')));
    const sink = byTag('sink'), hob = byTag('hob'), fridge = byId(/fridge/i);
    if (!sink || !hob || !fridge) continue;
    const leg = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    const total = leg(sink, hob) + leg(hob, fridge) + leg(fridge, sink);
    metrics.kitchens.push({ roomId: room.id, triangle: r2(total) });
    if (total < KITCHEN_TRIANGLE_MIN || total > KITCHEN_TRIANGLE_MAX) {
      issues.push(makeIssue('ERGO_KITCHEN_TRIANGLE', {
        measured: total, required: total < KITCHEN_TRIANGLE_MIN ? KITCHEN_TRIANGLE_MIN : KITCHEN_TRIANGLE_MAX,
        min: KITCHEN_TRIANGLE_MIN, max: KITCHEN_TRIANGLE_MAX,
        room: nameOf(room.id),
        direction: total < KITCHEN_TRIANGLE_MIN
          ? 'as drawn the three of them are on top of each other'
          : 'as drawn you walk further than you cook',
      }, { roomId: room.id }));
    }
  }

  return { issues, metrics };
}

