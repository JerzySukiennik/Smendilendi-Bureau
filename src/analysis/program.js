// Program and ergonomics.
//
// Program: does the drawing contain the rooms the brief asked for, at the areas
// it asked for, next to the things it asked them to be next to.
// Ergonomics: can the furniture actually be used. Every clearance is measured
// by casting rays out of the face of the piece until they hit a wall, another
// piece, or a door swing — so the number in the complaint is the real distance
// on the drawing, not a bounding-box overlap.
//
// Clearances are VOLUMES. Each piece needs a rectangle kept clear over a band
// of heights, and only an obstacle whose own band overlaps that band counts.
// Without this the engine measures a kitchen wall cabinet against the worktop
// 0.55 m below it and calls a correctly drawn kitchen unusable.

import { wallDir } from '../model/building.js';
import { obbPolygon, frontVector, rotY, r2, pointInPolygon } from './geom.js';
import { bfs, doorSwingPolygon, inRoom, OUTSIDE } from './topology.js';
import {
  entryOf, footprintOf, clearanceOf, shortName, pretty,
  verticalExtentOf, clearanceBandOf, bandsOverlap,
  resolveTag, satisfiesTag,
} from './catalogue.js';
import { canonicalKey, ROOM_KINDS, resolveProgramKey, COMMON_KINDS } from './classify.js';
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

/** Height band an opening's leaf sweeps through. A door is solid from the floor. */
function openingBand(o) {
  const sill = Number.isFinite(o.sill) ? o.sill : 0;
  const h = Number.isFinite(o.height) ? o.height : 2.05;
  return { zMin: sill, zMax: sill + h };
}

/**
 * Free distance out of one face of a placed piece, in metres.
 *
 * Two things are NOT obstacles, and the engine used to think both were:
 *   * anything whose height band misses the band that has to be clear — a wall
 *     cabinet is not in the way of the worktop 0.55 m below it;
 *   * whatever the piece is set into or standing on — a hob dropped into a
 *     worktop starts its measurement inside the base unit's footprint, and the
 *     far face of that base unit is the front of the run, not an obstruction.
 */
function measureClearance(f, entry, side, obstacles, maxT, band) {
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
      if (band && o.band && !bandsOverlap(band, o.band)) continue;
      if (pointInPolygon(px, pz, o.poly)) continue;     // we are set into it
      const h = rayPolygon(px, pz, dx, dz, o.poly, maxT);
      if (h < hit) hit = h;
    }
    if (hit < min) min = hit;
  }
  return min;
}

// --------------------------------------------------------------------------

/**
 * The self-contained dwellings in the model: clusters of rooms joined by doors
 * WITHOUT passing through shared circulation. An apartment brief asks for
 * "3 x two-room flat", never for a room called "flat" — this is what it is
 * measured against.
 */
export function countDwellingUnits(model, topo, classes) {
  const common = new Set();
  for (const r of topo.rooms) if (COMMON_KINDS.has(classes.get(r.id)?.key)) common.add(r.id);
  const seen = new Set();
  const units = [];
  for (const start of topo.rooms) {
    if (seen.has(start.id) || common.has(start.id)) continue;
    seen.add(start.id);
    const queue = [start.id];
    const group = [];
    while (queue.length) {
      const cur = queue.shift();
      group.push(cur);
      for (const e of topo.adjacency.get(cur) ?? []) {
        if (e.to === OUTSIDE || common.has(e.to) || seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    const rooms = group.map(id => topo.byId.get(id)).filter(Boolean);
    units.push({
      rooms: group.slice().sort(),
      area: rooms.reduce((s, r) => s + r.area, 0),
      habitableRooms: group.filter(id => classes.get(id)?.habitable).length,
    });
  }
  return units.sort((a, b) => b.area - a.area || (a.rooms[0] < b.rooms[0] ? -1 : 1));
}

export function analyzeProgram(ctx) {
  const { model, brief, topo, classes } = ctx;
  const issues = [];
  const levelById = new Map(model.levels.map(l => [l.id, l]));
  const nameOf = (id) => classes.get(id)?.label ?? 'room';

  const metrics = { program: [], ergonomics: [], kitchens: [], ceilings: [], unstocked: [] };

  // -- required rooms -------------------------------------------------------
  const entries = Array.isArray(brief?.program) ? brief.program : [];
  const byKind = new Map();
  for (const room of topo.rooms) {
    const key = classes.get(room.id)?.key ?? 'unassigned';
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push(room);
  }

  const units = countDwellingUnits(model, topo, classes);
  // Two programme lines can resolve to the same room KIND — a house asks for a
  // "main bedroom" and a "bedroom", and both are bedrooms. Each line takes the
  // largest room not already spoken for, in the order the client wrote them,
  // so the main bedroom gets the big one and the second line is judged on the
  // second room instead of complaining that the first has no single bed in it.
  const claimed = new Set();
  const claimedUnits = new Set();

  for (const entry of entries) {
    // A programme line asks either for a ROOM or for a whole DWELLING — the
    // apartment briefs are written in flats, not in rooms, and matching
    // "apt_two" against a room kind can never succeed. classify.js resolves
    // which; before this was wired every apartment commission opened with an
    // unclearable blocker for every flat it asked for.
    const resolved = resolveProgramKey(entry.key);
    const want = entry.count ?? 1;

    if (resolved.kind === 'unit') {
      // Smallest qualifying flat first: a studio is satisfied by a studio, not
      // by the three-bedroom on the top floor, and each flat is counted once.
      const matching = units
        .filter(u => !claimedUnits.has(u) && u.habitableRooms >= resolved.rooms)
        .sort((a, b) => a.habitableRooms - b.habitableRooms || a.area - b.area
          || (a.rooms[0] < b.rooms[0] ? -1 : 1));
      const label = entry.name ?? resolved.label;
      metrics.program.push({
        key: resolved.key, name: label, required: want, found: matching.length,
        minArea: entry.minArea ?? null,
        areas: matching.map(u => r2(u.area)),
        matched: Math.min(matching.length, want),
        unit: true, habitableRoomsEach: resolved.rooms,
      });
      if (matching.length < want) {
        issues.push(makeIssue('PROGRAM_ROOM_MISSING', {
          measured: matching.length, required: want, item: label,
        }));
      }
      for (const u of matching.slice(0, want)) {
        claimedUnits.add(u);
        if (Number.isFinite(entry.minArea) && u.area + 1e-6 < entry.minArea) {
          issues.push(makeIssue('PROGRAM_ROOM_UNDERSIZED', {
            measured: u.area, required: entry.minArea, room: label,
          }, { roomId: u.rooms[0] }));
        }
      }
      continue;
    }

    const key = resolved.kind === 'room' ? resolved.key : entry.key;
    const found = [...(byKind.get(key) ?? [])]
      .filter(r => !claimed.has(r.id))
      .sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1));
    const label = entry.name ?? ROOM_KINDS[key]?.label ?? pretty(entry.key);

    metrics.program.push({
      key, name: label, required: want,
      // `found` is how many rooms of this kind are still unclaimed — the pool
      // this line chose from. `matched` is how many it actually got.
      found: found.length, matched: Math.min(found.length, want),
      minArea: entry.minArea ?? null,
      areas: found.map(r => r2(r.area)),
    });

    if (found.length < want) {
      issues.push(makeIssue('PROGRAM_ROOM_MISSING', {
        measured: found.length, required: want, item: label,
      }));
    }

    for (const room of found.slice(0, want)) {
      claimed.add(room.id);
      if (Number.isFinite(entry.minArea) && room.area + 1e-6 < entry.minArea) {
        issues.push(makeIssue('PROGRAM_ROOM_UNDERSIZED', {
          measured: room.area, required: entry.minArea, room: nameOf(room.id),
        }, { roomId: room.id }));
      }
      // The brief asks for a "bed_double" and a "washbasin"; the catalogue tags
      // those things 'bed' and 'basin'. catalogue.js owns the translation —
      // reading the raw tag set here made the client ask for twenty-five
      // objects the engine could never find and the player could never draw.
      for (const tag of entry.requires ?? []) {
        const req = resolveTag(tag);
        if (req.kind === 'unstocked' || req.kind === 'unknown') {
          metrics.unstocked.push({ roomId: room.id, tag: req.tag, kind: req.kind });
          continue;                                    // not in the palette: not a fault
        }
        const placed = (classes.get(room.id)?.furniture ?? [])
          .some(fid => satisfiesTag(req, model.furniture[fid]?.catalogId));
        const byText = req.kind === 'text' && Object.values(model.texts ?? {})
          .some(t => t.levelId === room.levelId && inRoom(room, t.x, t.z));
        if (placed || byText) continue;
        issues.push(makeIssue('PROGRAM_TAG_MISSING', {
          measured: 0, required: 1, room: nameOf(room.id), item: req.label,
        }, { roomId: room.id }));
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
    const ceiling = level.height ?? 2.70;
    const fullHeight = { zMin: 0, zMax: ceiling };
    const obstacles = [
      ...walls.map(w => ({ poly: w.poly, ownerId: null, band: fullHeight })),
      ...furniture.map(f => {
        const e = entryOf(f.catalogId);
        const fp = footprintOf(f, e);
        return {
          poly: obbPolygon(f.x, f.z, fp.w, fp.d, f.rot ?? 0),
          ownerId: f.id,
          band: verticalExtentOf(f, e, ceiling),
        };
      }),
    ];
    for (const oid in model.openings) {
      const o = model.openings[oid];
      const w = model.walls[o.wallId];
      if (!w || (w.levelId ?? model.levels[0].id) !== level.id) continue;
      const poly = doorSwingPolygon(model, o);
      if (poly) obstacles.push({ poly, ownerId: null, band: openingBand(o) });
    }

    for (const f of furniture) {
      const entry = entryOf(f.catalogId);
      const clr = clearanceOf(f, entry);
      const band = clearanceBandOf(f, entry, ceiling);
      const room = topo.rooms.find(r => r.levelId === level.id && inRoom(r, f.x, f.z));
      for (const side of ['front', 'back', 'left', 'right']) {
        const required = clr[side] ?? 0;
        if (required <= 0.01) continue;
        const maxT = required + CLEARANCE_PROBE_EXTRA;
        const available = measureClearance(f, entry, side, obstacles, maxT, band);
        metrics.ergonomics.push({
          furnitureId: f.id, item: entry.name, side,
          available: r2(Math.min(available, maxT)), required: r2(required),
          zMin: r2(band.zMin), zMax: r2(band.zMax),
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

