// Daylight: glazed area against floor area, and real sun rays.
//
// Two measurements:
//   1. window-to-floor ratio per room. 1:8 for habitable rooms, 1:12 for a
//      kitchen, nothing required for a WC, store or corridor.
//   2. direct sun. The solar position is computed from the NOAA equations for
//      the plot's latitude (Warsaw, 52.2 N by default) at 09:00, 12:00 and
//      16:00 local standard time on 21 March and 21 December. A grid of points
//      on each room floor at 0.85 m — desk height — casts a ray at the sun and
//      is tested against the building's own walls (with their openings as real
//      holes), the ceilings, and the neighbouring buildings on the plot.
//
// Sanity check an architect will run: solar noon on 21 December at 52.2 N is
// 90 - 52.2 - 23.44 = 14.4 degrees above the horizon. The model reproduces it.

import { pointInPolygon, polygonBBox, polygonCentroid, r1, r2 } from './geom.js';
import { wallDir } from '../model/building.js';
import { wallNormal, inRoom } from './topology.js';
import { makeIssue } from './issues.js';

export const DESK_HEIGHT = 0.85;         // m above the finished floor
export const SAMPLE_SPACING = 0.50;      // m
export const MAX_SAMPLES = 240;
export const DEFAULT_LAT = 52.2297;      // Warsaw
export const DEFAULT_LON = 21.0122;
export const DEFAULT_TZ = 1;             // CET; neither test date is in summer time
export const WINTER_NOON_MIN = 10;       // % of floor we want lit at midday in December

export const SUN_SAMPLES = [
  { date: '21 March',    day: 80,  hour: 9 },
  { date: '21 March',    day: 80,  hour: 12 },
  { date: '21 March',    day: 80,  hour: 16 },
  { date: '21 December', day: 355, hour: 9 },
  { date: '21 December', day: 355, hour: 12 },
  { date: '21 December', day: 355, hour: 16 },
];

const DEG = Math.PI / 180;

/**
 * NOAA solar position. Returns altitude and azimuth in radians; azimuth is
 * measured clockwise from north.
 */
export function solarPosition(dayOfYear, localHour, latDeg = DEFAULT_LAT, lonDeg = DEFAULT_LON, tz = DEFAULT_TZ) {
  const g = (2 * Math.PI / 365) * (dayOfYear - 1 + (localHour - 12) / 24);
  const eqTime = 229.18 * (0.000075
    + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918
    - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  const timeOffset = eqTime + 4 * lonDeg - 60 * tz;          // minutes
  const trueSolarTime = localHour * 60 + timeOffset;          // minutes
  const ha = (trueSolarTime / 4 - 180) * DEG;                 // hour angle, radians
  const lat = latDeg * DEG;

  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const altitude = Math.PI / 2 - zen;

  let azimuth = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  if (azimuth < 0) azimuth += 2 * Math.PI;
  return { altitude, azimuth, declination: decl, eqTime };
}

/** Unit vector towards the sun. +X east, -Z north, +Y up. */
export function sunVector(altitude, azimuth) {
  const c = Math.cos(altitude);
  return { x: Math.sin(azimuth) * c, y: Math.sin(altitude), z: -Math.cos(azimuth) * c };
}

// --------------------------------------------------------------------------
// occluders

function buildOccluders(model, topo, brief) {
  const walls = [];
  const ceilings = [];
  const prisms = [];
  const levelById = new Map(model.levels.map(l => [l.id, l]));

  for (const id in model.walls) {
    const w = model.walls[id];
    const level = levelById.get(w.levelId) ?? model.levels[0];
    const d = wallDir(model, w);
    const n = wallNormal(model, w);
    walls.push({
      id,
      ax: d.a.x, az: d.a.z, dx: d.x, dz: d.z, len: d.len,
      nx: n.x, nz: n.z,
      y0: level.elevation, y1: level.elevation + level.height,
      holes: w.openings.map(oid => model.openings[oid]).filter(Boolean).map(o => ({
        u0: o.offset - o.width / 2, u1: o.offset + o.width / 2,
        y0: level.elevation + (o.sill ?? 0), y1: level.elevation + (o.sill ?? 0) + o.height,
      })),
    });
  }

  for (const room of topo.rooms) {
    const level = levelById.get(room.levelId) ?? model.levels[0];
    ceilings.push({ y: level.elevation + level.height, polygon: room.polygon, holes: room.holes ?? [] });
  }
  for (const id in model.slabs) {
    const s = model.slabs[id];
    const level = levelById.get(s.levelId) ?? model.levels[0];
    ceilings.push({
      y: s.kind === 'roof' ? level.elevation + level.height : level.elevation,
      polygon: s.polygon, holes: [],
    });
  }

  for (const nb of neighbourList(brief)) prisms.push(nb);
  return { walls, ceilings, prisms };
}

function neighbourList(brief) {
  const plot = brief?.plot ?? {};
  const raw = plot.neighbours ?? plot.neighbors ?? plot.buildings ?? [];
  const out = [];
  for (const n of raw) {
    if (!n) continue;
    const height = Number.isFinite(n.height) ? n.height : 9.0;
    let polygon = null;
    if (Array.isArray(n.polygon) && n.polygon.length >= 3) {
      polygon = n.polygon.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]));
    } else if (Number.isFinite(n.x) && Number.isFinite(n.w)) {
      const hw = n.w / 2, hd = (n.d ?? n.w) / 2;
      polygon = [[n.x - hw, n.z - hd], [n.x + hw, n.z - hd], [n.x + hw, n.z + hd], [n.x - hw, n.z + hd]];
    }
    if (polygon) out.push({ polygon, height, name: n.name ?? 'the neighbouring building' });
  }
  return out;
}

/**
 * Is the sun visible from (px, py, pz)? Returns null when it is, otherwise the
 * kind of thing in the way: 'wall' | 'ceiling' | 'neighbour'.
 */
export function occluderHit(occ, px, py, pz, dir) {
  const EPS = 1e-4;
  let bestT = Infinity, bestKind = null;

  for (const w of occ.walls) {
    const denom = w.nx * dir.x + w.nz * dir.z;
    if (Math.abs(denom) < 1e-9) continue;
    const t = (w.nx * (w.ax - px) + w.nz * (w.az - pz)) / denom;
    if (t <= EPS || t >= bestT) continue;
    const hx = px + dir.x * t, hz = pz + dir.z * t, hy = py + dir.y * t;
    const u = (hx - w.ax) * w.dx + (hz - w.az) * w.dz;
    if (u < 0 || u > w.len) continue;
    if (hy < w.y0 || hy > w.y1) continue;
    let through = false;
    for (const h of w.holes) {
      if (u >= h.u0 && u <= h.u1 && hy >= h.y0 && hy <= h.y1) { through = true; break; }
    }
    if (through) continue;
    bestT = t; bestKind = 'wall';
  }

  if (Math.abs(dir.y) > 1e-9) {
    for (const c of occ.ceilings) {
      const t = (c.y - py) / dir.y;
      if (t <= EPS || t >= bestT) continue;
      const hx = px + dir.x * t, hz = pz + dir.z * t;
      if (!pointInPolygon(hx, hz, c.polygon)) continue;
      let inHole = false;
      for (const h of c.holes ?? []) if (pointInPolygon(hx, hz, h)) { inHole = true; break; }
      if (inHole) continue;
      bestT = t; bestKind = 'ceiling';
    }
  }

  for (const nb of occ.prisms) {
    const poly = nb.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const nx = -ez, nz = ex;
      const denom = nx * dir.x + nz * dir.z;
      if (Math.abs(denom) < 1e-9) continue;
      const t = (nx * (a[0] - px) + nz * (a[1] - pz)) / denom;
      if (t <= EPS || t >= bestT) continue;
      const hx = px + dir.x * t, hz = pz + dir.z * t, hy = py + dir.y * t;
      const len2 = ex * ex + ez * ez;
      const u = ((hx - a[0]) * ex + (hz - a[1]) * ez) / len2;
      if (u < 0 || u > 1) continue;
      if (hy < 0 || hy > nb.height) continue;
      bestT = t; bestKind = 'neighbour';
    }
  }

  return bestKind;
}

// --------------------------------------------------------------------------

function floorSamples(room) {
  const b = polygonBBox(room.polygon);
  const pts = [];
  for (let z = b.minZ + SAMPLE_SPACING / 2; z < b.maxZ; z += SAMPLE_SPACING) {
    for (let x = b.minX + SAMPLE_SPACING / 2; x < b.maxX; x += SAMPLE_SPACING) {
      if (inRoom(room, x, z)) pts.push([x, z]);
      if (pts.length >= MAX_SAMPLES) return pts;
    }
  }
  if (!pts.length) pts.push(polygonCentroid(room.polygon));
  return pts;
}

function glazedArea(model, room) {
  let a = 0;
  for (const oid of room.windows) {
    const o = model.openings[oid];
    if (!o) continue;
    a += o.width * o.height * (o.glazingRatio ?? 1);
  }
  return a;
}

/** True when every window in the room faces within 60 degrees of due north. */
function allWindowsFaceNorth(model, topo, room) {
  if (!room.windows.length) return false;
  return room.windows.every((oid) => {
    const o = model.openings[oid];
    const wall = model.walls[o?.wallId];
    if (!wall) return false;
    const n = wallNormal(model, wall);
    // Point the normal away from this room.
    const c = polygonCentroid(room.polygon);
    const mid = wallDir(model, wall);
    const px = mid.a.x + mid.x * o.offset, pz = mid.a.z + mid.z * o.offset;
    const outward = ((px - c[0]) * n.x + (pz - c[1]) * n.z) >= 0 ? n : { x: -n.x, z: -n.z };
    return (outward.x * 0 + outward.z * -1) > 0.5;   // north is -Z
  });
}

export function analyzeDaylight(ctx) {
  const { model, brief, topo, classes } = ctx;
  const issues = [];
  const occ = buildOccluders(model, topo, brief);
  const lat = brief?.plot?.latitude ?? DEFAULT_LAT;
  const lon = brief?.plot?.longitude ?? DEFAULT_LON;
  const levelById = new Map(model.levels.map(l => [l.id, l]));

  const sun = SUN_SAMPLES.map((s) => {
    const p = solarPosition(s.day, s.hour, lat, lon);
    return { ...s, altitudeDeg: r1(p.altitude / DEG), azimuthDeg: r1(p.azimuth / DEG), vec: sunVector(p.altitude, p.azimuth) };
  });

  const metrics = {
    latitude: lat,
    longitude: lon,
    sun: sun.map(s => ({ date: s.date, hour: s.hour, altitudeDeg: s.altitudeDeg, azimuthDeg: s.azimuthDeg })),
    rooms: {},
  };

  for (const room of topo.rooms) {
    const cls = classes.get(room.id);
    const level = levelById.get(room.levelId) ?? model.levels[0];
    const glass = glazedArea(model, room);
    const ratio = glass > 0 ? room.area / glass : Infinity;
    const samples = floorSamples(room);
    const y = level.elevation + DESK_HEIGHT;

    const perSample = [];
    const causes = new Map();
    for (const s of sun) {
      if (s.vec.y <= 0) { perSample.push({ date: s.date, hour: s.hour, percent: 0 }); continue; }
      let lit = 0;
      for (const [px, pz] of samples) {
        const kind = occluderHit(occ, px, y, pz, s.vec);
        if (!kind) lit++;
        else causes.set(kind, (causes.get(kind) ?? 0) + 1);
      }
      perSample.push({ date: s.date, hour: s.hour, percent: r1((lit / samples.length) * 100) });
    }

    const best = Math.max(...perSample.map(s => s.percent));
    const decNoon = perSample.find(s => s.date === '21 December' && s.hour === 12)?.percent ?? 0;

    metrics.rooms[room.id] = {
      name: cls?.label ?? 'room',
      kind: cls?.key,
      area: r2(room.area),
      glazedArea: r2(glass),
      ratio: glass > 0 ? `1:${r1(ratio)}` : '1:∞',
      required: cls?.glaze ? `1:${cls.glaze}` : null,
      samples: samples.length,
      sun: perSample,
      bestSunPercent: best,
      decemberNoonPercent: decNoon,
    };

    if (!cls?.glaze) continue;                       // no daylight required here

    if (glass <= 0) {
      issues.push(makeIssue('DAYLIGHT_NO_GLAZING', {
        measured: 0, required: r2(room.area / cls.glaze),
        room: cls.label, area: room.area,
      }, { roomId: room.id }));
    } else if (ratio > cls.glaze + 1e-6) {
      issues.push(makeIssue('DAYLIGHT_RATIO_LOW', {
        measured: glass, required: r2(room.area / cls.glaze),
        ratio, requiredRatio: cls.glaze,
        deficit: room.area / cls.glaze - glass,
        room: cls.label, area: room.area,
      }, { roomId: room.id }));
    }

    if (!cls.habitable) continue;

    if (best <= 0) {
      const dominant = [...causes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      const cause = glass <= 0
        ? 'It has no window to let any in.'
        : allWindowsFaceNorth(model, topo, room)
          ? 'Every window it has faces north, so it never will.'
          : dominant === 'neighbour'
            ? 'The building next door stands in front of it all day.'
            : 'The walls of your own plan are in the way.';
      issues.push(makeIssue('DAYLIGHT_NO_SUN', {
        measured: 0, required: 1, room: cls.label, cause,
      }, { roomId: room.id }));
    } else if (decNoon < WINTER_NOON_MIN) {
      issues.push(makeIssue('DAYLIGHT_WINTER_DARK', {
        measured: decNoon, required: WINTER_NOON_MIN, room: cls.label,
      }, { roomId: room.id }));
    }
  }

  return { issues, metrics };
}
