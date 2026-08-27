// The plot.
//
// Every commission generates a real plot: a boundary that must not be crossed,
// setbacks that define the buildable line, protected trees, a coverage limit, a
// storey limit and a street side the entrance has to face. The client puts all
// of that in writing in the brief. This file is what measures it.
//
// Everything here is measured off the same BuildingModel the other four
// modules use. Nothing is estimated:
//   * the footprint is rasterised at 0.10 m from the ground-level rooms and
//     the ground-level wall bodies, so a courtyard is not counted as built and
//     the wall thickness is;
//   * a boundary or setback breach is the largest distance any wall body
//     reaches past the line, in metres;
//   * a tree is built over when a wall body enters the crown radius given on
//     the survey;
//   * the entrance direction is the outward normal of the wall the front door
//     sits in, resolved against the room behind it.
//
// The issues carry module 'program' (brief compliance) or 'access', so the
// Report interface in ARCHITECTURE.md is unchanged; each one also carries
// group: 'site' so the editor can put them on the site plan.

import { wallDir } from '../model/building.js';
import {
  polygonBBox, pointInPolygon, obbPolygon, distPointSeg, polygonArea, polygonCentroid, r1, r2,
} from './geom.js';
import { wallNormal } from './topology.js';
import { plotOf, briefLimit, hasConstraint, compassOf } from './brief.js';
import { makeIssue } from './issues.js';

export const FOOTPRINT_CELL = 0.10;      // m
export const BREACH_TOLERANCE = 0.02;    // 20 mm — below this it is drawing tolerance

/** The wall bodies of a level as oriented rectangles: length x thickness. */
export function wallBodies(model, levelIds = null) {
  const out = [];
  const first = model.levels[0]?.id;
  for (const id in model.walls) {
    const w = model.walls[id];
    const lid = w.levelId ?? first;
    if (levelIds && !levelIds.has(lid)) continue;
    const d = wallDir(model, w);
    const cx = (d.a.x + d.b.x) / 2, cz = (d.a.z + d.b.z) / 2;
    const rot = Math.atan2(-d.z, d.x);
    out.push({ id, levelId: lid, poly: obbPolygon(cx, cz, d.len, w.thickness, rot), type: w.type });
  }
  return out;
}

/** Signed distance to a polygon: positive inside, negative outside, metres. */
export function signedDistanceToPolygon(poly, x, z) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    d = Math.min(d, distPointSeg(x, z, a[0], a[1], b[0], b[1]));
  }
  return pointInPolygon(x, z, poly) ? d : -d;
}

/** How far the worst corner of `bodies` reaches outside `poly`. 0 when all inside. */
function worstBreach(bodies, poly) {
  let worst = 0, wallId = null;
  for (const b of bodies) {
    for (const [x, z] of b.poly) {
      const s = signedDistanceToPolygon(poly, x, z);
      if (s < -worst) { worst = -s; wallId = b.id; }
    }
  }
  return { metres: worst, wallId };
}

/**
 * Built footprint in m², rasterised at 0.10 m. Counted as built: any cell
 * inside a ground-level room (courtyards excluded, they are holes) or inside a
 * ground-level wall body. Upper storeys do not add footprint.
 */
export function builtFootprint(model, topo) {
  const ground = model.levels.reduce((lo, l) => (l.elevation < lo.elevation ? l : lo), model.levels[0]);
  if (!ground) return { area: 0, cells: 0 };
  const rooms = topo.rooms.filter(r => r.levelId === ground.id);
  const bodies = wallBodies(model, new Set([ground.id]));
  if (!rooms.length && !bodies.length) return { area: 0, cells: 0 };

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const eat = (poly) => {
    const b = polygonBBox(poly);
    if (b.minX < minX) minX = b.minX;
    if (b.minZ < minZ) minZ = b.minZ;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxZ > maxZ) maxZ = b.maxZ;
  };
  for (const r of rooms) eat(r.polygon);
  for (const b of bodies) eat(b.poly);
  if (!Number.isFinite(minX)) return { area: 0, cells: 0 };

  const w = Math.ceil((maxX - minX) / FOOTPRINT_CELL) + 2;
  const h = Math.ceil((maxZ - minZ) / FOOTPRINT_CELL) + 2;
  if (w * h > 4_000_000) return { area: NaN, cells: 0, tooLarge: true };
  const grid = new Uint8Array(w * h);
  const cx = (i) => minX + (i + 0.5) * FOOTPRINT_CELL;
  const cz = (j) => minZ + (j + 0.5) * FOOTPRINT_CELL;

  const stamp = (poly, holes) => {
    const b = polygonBBox(poly);
    const i0 = Math.max(0, Math.floor((b.minX - minX) / FOOTPRINT_CELL) - 1);
    const i1 = Math.min(w - 1, Math.ceil((b.maxX - minX) / FOOTPRINT_CELL) + 1);
    const j0 = Math.max(0, Math.floor((b.minZ - minZ) / FOOTPRINT_CELL) - 1);
    const j1 = Math.min(h - 1, Math.ceil((b.maxZ - minZ) / FOOTPRINT_CELL) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = cx(i), z = cz(j);
        if (!pointInPolygon(x, z, poly)) continue;
        if (holes && holes.some(hh => pointInPolygon(x, z, hh))) continue;
        grid[j * w + i] = 1;
      }
    }
  };
  for (const r of rooms) stamp(r.polygon, r.holes);
  for (const b of bodies) stamp(b.poly, null);

  let cells = 0;
  for (let k = 0; k < grid.length; k++) cells += grid[k];
  return { area: cells * FOOTPRINT_CELL * FOOTPRINT_CELL, cells };
}

/** Storeys above ground. A basement is not a storey the local plan counts. */
export function storeysAboveGround(model) {
  return model.levels.filter(l => (l.elevation ?? 0) >= -0.01).length;
}

/**
 * Outward compass direction of every external door: the wall normal turned
 * away from the room the door serves.
 */
export function entranceDirections(model, topo) {
  const out = [];
  for (const oid of topo.exteriorDoors) {
    const o = model.openings[oid];
    const wall = model.walls[o?.wallId];
    if (!o || !wall) continue;
    const inside = (topo.openingRooms[oid] ?? []).map(id => topo.byId.get(id)).filter(Boolean)[0];
    const n = wallNormal(model, wall);
    const d = wallDir(model, wall);
    const px = d.a.x + d.x * o.offset, pz = d.a.z + d.z * o.offset;
    let ox = n.x, oz = n.z;
    if (inside) {
      const c = polygonCentroid(inside.polygon);
      if ((px - c[0]) * n.x + (pz - c[1]) * n.z < 0) { ox = -n.x; oz = -n.z; }
    }
    out.push({
      openingId: oid, x: r2(px), z: r2(pz), width: o.width,
      main: /entrance|main/i.test(String(o.catalogId ?? '')),
      facing: compassOf(ox, oz),
    });
  }
  return out;
}

// --------------------------------------------------------------------------

export function analyzeSite(ctx) {
  const { model, brief, topo } = ctx;
  const issues = [];
  const plot = plotOf(brief);

  const fp = builtFootprint(model, topo);
  const storeys = storeysAboveGround(model);
  const metrics = {
    footprint: Number.isFinite(fp.area) ? r1(fp.area) : null,
    storeys,
    plot: plot ? { area: plot.area ?? r1(polygonArea(plot.boundary)), kind: plot.kind ?? null } : null,
    coverage: null,
    breaches: {},
    entrances: entranceDirections(model, topo),
    streetSides: plot?.streetSides ?? null,
    trees: [],
  };

  // -- storey limit ---------------------------------------------------------
  const maxFloors = briefLimit(brief, 'plot.maxFloors', null);
  if (Number.isFinite(maxFloors) && storeys > maxFloors) {
    issues.push(makeIssue('SITE_TOO_MANY_FLOORS', {
      measured: storeys, required: maxFloors,
    }));
  }

  if (!plot) { metrics.measured = false; return { issues, metrics }; }
  metrics.measured = true;

  const bodies = wallBodies(model);
  const boundary = plot.boundary;
  const buildable = Array.isArray(plot.buildable) && plot.buildable.length >= 3
    ? plot.buildable : boundary;

  // -- the boundary and the buildable line ----------------------------------
  const overBoundary = worstBreach(bodies, boundary);
  const overBuildable = worstBreach(bodies, buildable);
  metrics.breaches.boundary = r2(overBoundary.metres);
  metrics.breaches.buildable = r2(overBuildable.metres);

  if (overBoundary.metres > BREACH_TOLERANCE) {
    issues.push(makeIssue('SITE_OUTSIDE_BOUNDARY', {
      measured: overBoundary.metres, required: 0,
    }, { wallId: overBoundary.wallId }));
  } else if (overBuildable.metres > BREACH_TOLERANCE && hasConstraint(brief, 'plot.withinSetbacks')) {
    const setbacks = plot.setbacks ?? {};
    issues.push(makeIssue('SITE_SETBACK_BREACH', {
      measured: overBuildable.metres, required: 0,
      front: setbacks.front ?? null, side: setbacks.side ?? null, rear: setbacks.rear ?? null,
    }, { wallId: overBuildable.wallId }));
  }

  // -- protected trees ------------------------------------------------------
  for (const t of plot.trees ?? []) {
    let nearest = Infinity, wallId = null;
    for (const b of bodies) {
      let d = Infinity;
      for (let i = 0; i < b.poly.length; i++) {
        const p = b.poly[i], q = b.poly[(i + 1) % b.poly.length];
        d = Math.min(d, distPointSeg(t.x, t.z, p[0], p[1], q[0], q[1]));
      }
      if (pointInPolygon(t.x, t.z, b.poly)) d = 0;
      if (d < nearest) { nearest = d; wallId = b.id; }
    }
    const intrusion = Math.max(0, t.radius - nearest);
    metrics.trees.push({
      x: t.x, z: t.z, radius: t.radius, species: t.species ?? null,
      protected: !!t.protected, clearance: Number.isFinite(nearest) ? r2(nearest) : null,
    });
    if (!t.protected || intrusion <= BREACH_TOLERANCE) continue;
    issues.push(makeIssue('SITE_PROTECTED_TREE', {
      measured: intrusion, required: t.radius,
      species: t.species ?? 'tree', radius: t.radius,
    }, { wallId }));
  }

  // -- coverage and planted area -------------------------------------------
  const plotArea = Number.isFinite(plot.area) ? plot.area : polygonArea(boundary);
  if (Number.isFinite(fp.area) && plotArea > 0) {
    const coverage = fp.area / plotArea;
    metrics.coverage = r2(coverage * 100);
    const maxCoverage = briefLimit(brief, 'plot.siteCoverage', null);
    if (Number.isFinite(maxCoverage) && coverage > maxCoverage + 1e-6) {
      issues.push(makeIssue('SITE_COVERAGE', {
        measured: coverage * 100, required: maxCoverage * 100,
        footprint: fp.area, plotArea,
      }));
    }
    const minGreen = briefLimit(brief, 'plot.greenArea', null);
    if (Number.isFinite(minGreen)) {
      // Paving is a phase-2 site edit and is not modelled yet, so this measures
      // the building alone. It is stated that way in the metrics.
      const green = 1 - coverage;
      metrics.greenArea = r2(green * 100);
      metrics.greenAreaExcludesPaving = true;
      if (green < minGreen - 1e-6) {
        issues.push(makeIssue('SITE_GREEN_AREA', {
          measured: green * 100, required: minGreen * 100,
        }));
      }
    }
  }

  // -- the entrance has to face the street ----------------------------------
  const streets = new Set([
    ...(plot.streetSides ?? []),
    ...(plot.entranceFacing ? [plot.entranceFacing] : []),
    ...(plot.street?.side ? [plot.street.side] : []),
  ].filter(Boolean));
  if (streets.size && metrics.entrances.length && hasConstraint(brief, 'plot.entranceFacing')) {
    const onStreet = metrics.entrances.filter(e => streets.has(e.facing));
    if (!onStreet.length) {
      const main = metrics.entrances.find(e => e.main) ?? metrics.entrances[0];
      issues.push(makeIssue('SITE_ENTRANCE_OFF_STREET', {
        measured: 0, required: 1,
        facing: main.facing, street: [...streets].join(' or '),
        doors: metrics.entrances.length,
      }, { openingId: main.openingId }));
    }
  }

  return { issues, metrics };
}
