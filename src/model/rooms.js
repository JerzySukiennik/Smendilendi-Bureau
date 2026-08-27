// Room detection — the planar subdivision of the wall graph.
//
// View-free: no three.js, no DOM, no browser globals. Imports in bare node.
// Units: metres. Plan coordinates are (x, z); y is up and irrelevant here.
//
// The whole file is one idea: the walls of a level form a planar graph, and the
// bounded faces of that graph are the rooms. Everything else — clear areas,
// door adjacency, courtyards — falls out of that subdivision.
//
// Areas are CLEAR INTERNAL areas: every face polygon runs along wall
// CENTRELINES, and each edge is then offset inward by half of ITS OWN wall
// thickness before the shoelace is taken. A 6.00 x 4.00 m rectangle of 0.24 m
// exterior wall is 21.66 m2, not 24.00 m2 — which is the number an architect
// expects to read on the drawing. A dangling stub wall inside a room is
// traversed twice by the face cycle and its footprint is cut out of the area as
// a slit, so a room with a 1.88 m long 0.12 m stub reads 0.2256 m2 smaller.
//
// Open sky (courtyards, atria, light wells) is decided PER FACE, not per
// connected component: a bounded face counts as open sky when every wall
// bounding it is exterior or party AND none of those walls has the street on
// the other side. That is what separates a courtyard (its walls face the
// building on both sides) from an ordinary room in a shell (its walls face the
// street on the far side). Subdividing a courtyard with interior partitions
// turns it back into rooms, and a roof slab over it always does.

export const ROOM_EPS = 0.001;          // 1 mm — coincidence tolerance
export const MIN_ROOM_AREA = 0.5;       // m2 — below this a room is flagged `undersized`,
                                        // e.g. a riser or a broom cupboard. Still a room:
                                        // it is enclosed space with a door, and the
                                        // schedule must not silently swallow it.
export const MIN_FACE_AREA = 0.01;      // m2 — below this there is no clear space at all
                                        // (walls meet walls); the face is not a room.

// ---------------------------------------------------------------------------
// small geometry helpers

const hyp = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

/** Signed area of a closed polygon [[x,z], ...]. Positive = counter-clockwise. */
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

export function perimeterOf(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += hyp(p[0], p[1], q[0], q[1]);
  }
  return s;
}

/** Ray-casting point-in-polygon. Boundary results are not specified. */
export function pointInPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInRoomShape(room, x, z) {
  if (!pointInPolygon(room.polygon, x, z)) return false;
  for (const h of room.holes ?? []) if (pointInPolygon(h, x, z)) return false;
  return true;
}

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 < 1e-12 ? 0 : ((x - ax) * dx + (z - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return hyp(x, z, ax + dx * t, az + dz * t);
}

function distToPolygonEdges(polys, x, z) {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const d = distToSegment(x, z, p[0], p[1], q[0], q[1]);
      if (d < best) best = d;
    }
  }
  return best;
}

// FNV-1a, 32 bit. Stable across runs and platforms — room ids must be.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 1. planar graph construction
//
// building.js already splits walls on add, but a model can arrive from the
// network, from a snapshot or from a hand-written fixture, so we rebuild the
// subdivision defensively: every proper crossing and every T-junction inside
// EPS becomes a shared vertex.

function buildPlanarGraph(model, levelId) {
  const pts = [];                          // [{x,z}]
  const CELL = 0.01;                       // 10 mm buckets; EPS is 1 mm, so a
  const grid = new Map();                  // 3x3 neighbourhood is always enough
  const cellKey = (x, z) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
  const ensurePoint = (x, z) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = grid.get(`${cx + i}:${cz + j}`);
        if (!bucket) continue;
        for (const idx of bucket) if (hyp(pts[idx].x, pts[idx].z, x, z) <= ROOM_EPS) return idx;
      }
    }
    pts.push({ x, z });
    const key = cellKey(x, z);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(pts.length - 1);
    return pts.length - 1;
  };

  const wallIds = Object.keys(model.walls).filter(id => model.walls[id].levelId === levelId).sort();
  const segs = [];                         // parent wall segments
  for (const id of wallIds) {
    const w = model.walls[id];
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (!a || !b) continue;
    const len = hyp(a.x, a.z, b.x, b.z);
    if (len <= ROOM_EPS) continue;
    segs.push({
      wallId: id,
      thickness: w.thickness ?? 0.12,
      type: w.type ?? 'interior',
      ai: ensurePoint(a.x, a.z),
      bi: ensurePoint(b.x, b.z),
      len,
    });
  }

  // pass 1 — every proper crossing becomes a vertex shared by both walls
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const hit = properIntersection(pts[segs[i].ai], pts[segs[i].bi], pts[segs[j].ai], pts[segs[j].bi]);
      if (hit) ensurePoint(hit.x, hit.z);
    }
  }

  // pass 2 — split every wall at every vertex lying in its interior
  const edges = [];                        // sub-edges of the planar graph
  const seen = new Map();                  // "u:v" (u<v) -> edge index, kills duplicates
  for (const s of segs) {
    const A = pts[s.ai], B = pts[s.bi];
    const cuts = [{ t: 0, i: s.ai }, { t: 1, i: s.bi }];
    const minX = Math.min(A.x, B.x) - ROOM_EPS, maxX = Math.max(A.x, B.x) + ROOM_EPS;
    const minZ = Math.min(A.z, B.z) - ROOM_EPS, maxZ = Math.max(A.z, B.z) + ROOM_EPS;
    for (let p = 0; p < pts.length; p++) {
      if (p === s.ai || p === s.bi) continue;
      const P = pts[p];
      if (P.x < minX || P.x > maxX || P.z < minZ || P.z > maxZ) continue;   // cheap reject
      const t = paramOnSegment(A, B, P);
      if (t <= ROOM_EPS / s.len || t >= 1 - ROOM_EPS / s.len) continue;
      const px = A.x + (B.x - A.x) * t, pz = A.z + (B.z - A.z) * t;
      if (hyp(px, pz, pts[p].x, pts[p].z) > ROOM_EPS) continue;
      cuts.push({ t, i: p });
    }
    cuts.sort((p, q) => p.t - q.t);
    for (let k = 0; k < cuts.length - 1; k++) {
      const u = cuts[k], v = cuts[k + 1];
      if (u.i === v.i) continue;
      if (hyp(pts[u.i].x, pts[u.i].z, pts[v.i].x, pts[v.i].z) <= ROOM_EPS) continue;
      const key = u.i < v.i ? `${u.i}:${v.i}` : `${v.i}:${u.i}`;
      if (seen.has(key)) continue;         // collinear overlap — keep the first
      seen.set(key, edges.length);
      edges.push({
        u: u.i, v: v.i,
        wallId: s.wallId,
        thickness: s.thickness,
        type: s.type,
        t0: u.t, t1: v.t,                  // range along the PARENT wall, a -> b
      });
    }
  }

  // adjacency, sorted counter-clockwise by direction angle
  const adj = pts.map(() => []);
  edges.forEach((e, idx) => {
    adj[e.u].push({ to: e.v, he: idx * 2, angle: Math.atan2(pts[e.v].z - pts[e.u].z, pts[e.v].x - pts[e.u].x) });
    adj[e.v].push({ to: e.u, he: idx * 2 + 1, angle: Math.atan2(pts[e.u].z - pts[e.v].z, pts[e.u].x - pts[e.v].x) });
  });
  for (const list of adj) list.sort((p, q) => p.angle - q.angle || p.to - q.to);

  return { pts, edges, adj };
}

function properIntersection(a, b, c, d) {
  const rx = b.x - a.x, rz = b.z - a.z;
  const sx = d.x - c.x, sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;             // parallel or collinear
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  const pad = ROOM_EPS;
  if (t <= pad || t >= 1 - pad || u <= pad || u >= 1 - pad) return null;
  return { x: a.x + t * rx, z: a.z + t * rz };
}

function paramOnSegment(a, b, p) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return -1;
  return ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
}

// ---------------------------------------------------------------------------
// 2. face traversal
//
// Half-edge h = (u -> v) has id 2*e (u = edges[e].u) or 2*e+1 (reversed).
// next(h) leaves v along the neighbour that comes immediately CLOCKWISE from u
// when sweeping around v. Interior faces come out counter-clockwise (positive
// signed area); every connected component contributes exactly one clockwise
// face, which is that component's outer boundary.

function traverseFaces(g) {
  const { edges, adj } = g;
  const heCount = edges.length * 2;
  const heFrom = h => (h % 2 === 0 ? edges[h >> 1].u : edges[h >> 1].v);
  const heTo = h => (h % 2 === 0 ? edges[h >> 1].v : edges[h >> 1].u);

  // index of each half-edge inside adj[from]
  const slot = new Array(heCount).fill(-1);
  for (let vi = 0; vi < adj.length; vi++) {
    adj[vi].forEach((entry, k) => { slot[entry.he] = k; });
  }

  const next = (h) => {
    const v = heTo(h);
    const twin = h ^ 1;                       // v -> u, outgoing at v
    const k = slot[twin];
    const list = adj[v];
    const nk = (k - 1 + list.length) % list.length;   // one step clockwise
    return list[nk].he;
  };

  const faceOf = new Array(heCount).fill(-1);
  const faces = [];
  for (let h0 = 0; h0 < heCount; h0++) {
    if (faceOf[h0] !== -1) continue;
    const cycle = [];
    let h = h0;
    let guard = 0;
    do {
      faceOf[h] = faces.length;
      cycle.push(h);
      h = next(h);
      if (++guard > heCount * 4) break;       // impossible, but never hang the sim
    } while (h !== h0 && faceOf[h] === -1);
    faces.push({ cycle, component: -1 });
  }

  // connected components, over vertices
  const comp = new Array(adj.length).fill(-1);
  let nComp = 0;
  for (let s = 0; s < adj.length; s++) {
    if (comp[s] !== -1 || adj[s].length === 0) continue;
    const stack = [s];
    comp[s] = nComp;
    while (stack.length) {
      const v = stack.pop();
      for (const e of adj[v]) if (comp[e.to] === -1) { comp[e.to] = nComp; stack.push(e.to); }
    }
    nComp++;
  }
  for (const f of faces) f.component = comp[heFrom(f.cycle[0])];

  return { faces, faceOf, heFrom, heTo, nComp };
}

/**
 * The BOUNDING cycle of a face: the same cycle with dangling spurs removed
 * (a half-edge immediately followed by its own twin encloses nothing).
 *
 * Used for CLASSIFICATION only — winding, wall types, room id. The geometry
 * uses the FULL cycle, because a stub wall standing in a room still occupies
 * floor area and must be cut out of it.
 */
function stripSpurs(cycle) {
  let out = cycle.slice();
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      if ((out[i] ^ 1) === out[j]) {
        const drop = new Set([i, j]);
        out = out.filter((_, k) => !drop.has(k));
        changed = true;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. per-edge inward offset
//
// For a cycle traversed with the interior on the left, offset each edge line by
// half of its own wall thickness along the left normal, then re-intersect
// consecutive offset lines.
//
// Two degenerate joins matter:
//   * collinear continuation with a change of thickness — emit both offset
//     points so the jog in the wall face is real;
//   * a 180 degree reversal, i.e. the tip of a dangling stub — emit both offset
//     points so the stub reads as a slit of exactly its own thickness.

function offsetCycle(cycle, g, heFrom, heTo) {
  const { pts, edges } = g;
  const lines = cycle.map(h => {
    const a = pts[heFrom(h)], b = pts[heTo(h)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const nx = -uz, nz = ux;                       // left normal
    const off = (edges[h >> 1].thickness ?? 0.12) / 2;
    return { px: a.x + nx * off, pz: a.z + nz * off, ux, uz, nx, nz, off };
  });

  const poly = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], M = lines[(i + 1) % lines.length];
    const b = pts[heTo(cycle[i])];
    const den = L.ux * M.uz - L.uz * M.ux;
    if (Math.abs(den) < 1e-9) {
      // parallel: collinear continuation, or a 180 degree reversal (stub tip)
      const dot = L.ux * M.ux + L.uz * M.uz;
      poly.push([b.x + L.nx * L.off, b.z + L.nz * L.off]);
      if (dot < 0 || Math.abs(L.off - M.off) > 1e-9) {
        poly.push([b.x + M.nx * M.off, b.z + M.nz * M.off]);
      }
      continue;
    }
    const t = ((M.px - L.px) * M.uz - (M.pz - L.pz) * M.ux) / den;
    poly.push([L.px + L.ux * t, L.pz + L.uz * t]);
  }
  // the intersection points are the CORNERS after edge i; the polygon therefore
  // starts at the corner after edge 0 — winding is unaffected either way.
  return poly;
}

// ---------------------------------------------------------------------------
// 4. the main entry point

/**
 * computeRooms(model, levelId) -> { rooms: {id: Room}, order: [id], edges: [...] }
 * Rooms are DERIVED. Nothing here mutates the model.
 */
export function computeRooms(model, levelId = model.levels?.[0]?.id ?? 'L0') {
  const g = buildPlanarGraph(model, levelId);
  const empty = { rooms: {}, order: [], edges: [], levelId };
  if (g.edges.length === 0) { register(empty); return empty; }

  const { faces, faceOf, heFrom, heTo } = traverseFaces(g);

  // geometry per face
  for (const f of faces) {
    f.bound = stripSpurs(f.cycle);                 // classification cycle
    if (f.bound.length < 3) { f.degenerate = true; f.centreArea = 0; continue; }
    f.centrePoly = f.bound.map(h => [g.pts[heFrom(h)].x, g.pts[heFrom(h)].z]);
    f.centreArea = signedArea(f.centrePoly);
    f.inset = offsetCycle(f.cycle, g, heFrom, heTo);   // FULL cycle: stubs cut slits
    f.insetArea = signedArea(f.inset);
    f.wallIds = [...new Set(f.bound.map(h => g.edges[h >> 1].wallId))].sort();
  }

  // the clockwise face of each component is that component's outer boundary
  const outerOfComponent = new Map();
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f.degenerate) continue;
    if (f.centreArea < 0) {
      const cur = outerOfComponent.get(f.component);
      if (cur === undefined || f.centreArea < faces[cur].centreArea) outerOfComponent.set(f.component, i);
      f.isOuter = true;
    }
  }

  // nesting: a component whose outline sits inside a bounded face of another
  // component punches a hole in that face — a free-standing pod, or a detached
  // courtyard ring.
  const holesByFace = new Map();
  for (const [compId, outerIdx] of outerOfComponent) {
    const outer = faces[outerIdx];
    const probe = outer.centrePoly[0];
    let parent = -1;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      if (f.degenerate || f.isOuter || f.component === compId) continue;
      if (!pointInPolygon(f.centrePoly, probe[0], probe[1])) continue;
      if (parent === -1 || f.centreArea < faces[parent].centreArea) parent = i;
    }
    if (parent === -1) continue;                       // top-level component
    outer.nestedIn = parent;
    if (!holesByFace.has(parent)) holesByFace.set(parent, []);
    holesByFace.get(parent).push(outer.inset);         // offset outward already
  }

  // "sky" faces: the unbounded region around the building. A component outline
  // that is not nested inside anything opens straight onto the street.
  const skyFace = new Array(faces.length).fill(false);
  for (const [, outerIdx] of outerOfComponent) {
    if (faces[outerIdx].nestedIn === undefined) skyFace[outerIdx] = true;
  }

  // open sky per bounded face: a courtyard / atrium / light well.
  // Every bounding wall is exterior or party AND none of them has the street on
  // the far side. A plain room in a shell fails the second test (its walls face
  // the street outside), a subdivided annexe fails the first (it has interior
  // partitions), and a roof slab over the face vetoes the whole verdict.
  const roofs = (Object.values(model.slabs ?? {}))
    .filter(s => s.levelId === levelId && s.kind === 'roof' && Array.isArray(s.polygon));
  const openSky = new Array(faces.length).fill(false);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f.degenerate || f.centreArea <= 0) continue;
    let sky = true;
    for (const h of f.bound) {
      const t = g.edges[h >> 1].type;
      if (t !== 'exterior' && t !== 'party') { sky = false; break; }
      const other = faceOf[h ^ 1];
      if (other >= 0 && skyFace[other]) { sky = false; break; }
    }
    if (sky && roofs.length) {
      const p = polyInteriorPoint(f.inset, holesByFace.get(i) ?? []);
      if (p && roofs.some(s => pointInPolygon(s.polygon, p.x, p.z))) sky = false;
    }
    openSky[i] = sky;
  }

  // build the rooms
  const rooms = {};
  const faceLabel = new Array(faces.length).fill(null);   // roomId | 'OUTSIDE' | null
  const usedIds = new Set();
  const candidates = [];
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (f.degenerate) continue;
    if (f.centreArea < 0) { faceLabel[i] = 'OUTSIDE'; continue; }
    if (f.centreArea === 0) continue;                    // no enclosed region at all
    if (openSky[i]) { faceLabel[i] = 'OUTSIDE'; continue; }
    const holes = holesByFace.get(i) ?? [];
    let area = f.insetArea;                              // positive: bounded, CCW
    for (const h of holes) area -= Math.abs(signedArea(h));
    // No clear space left: the walls bounding this face eat it entirely. That is
    // solid construction, not a room — and NOT the street either, so it stays
    // unlabelled and no door is rewired through it.
    if (!(area > MIN_FACE_AREA)) continue;
    candidates.push({ faceIndex: i, holes, area });
  }

  // deterministic ids from the sorted wall ids of the face
  for (const c of candidates) {
    const f = faces[c.faceIndex];
    let id = `r${hash32(`${levelId}|${f.wallIds.join(',')}`).toString(16).padStart(8, '0')}`;
    let n = 1;
    while (usedIds.has(id)) id = `${id}_${n++}`;        // collision, practically never
    usedIds.add(id);
    c.id = id;
    faceLabel[c.faceIndex] = id;
  }

  // A nested component's outline is NOT the street: the space on its far side is
  // whatever face encloses it. Without this, a door in a detached courtyard ring
  // or in a free-standing pod has 'OUTSIDE' on both sides and disappears from
  // both the schedule and the circulation graph.
  for (const [, outerIdx] of outerOfComponent) {
    const parent = faces[outerIdx].nestedIn;
    if (parent !== undefined) faceLabel[outerIdx] = faceLabel[parent];
  }

  const names = model.siteMods?.roomNames ?? {};
  const programs = model.siteMods?.roomPrograms ?? {};

  // Default labels are derived from the room's own STABLE id, never from its
  // rank in this plan. Adding a room somewhere else must not renumber the
  // drawing. Numbers land in 100..999, the way they do on a real floor plan.
  const takenNums = new Set();
  const byId = candidates.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of byId) {
    if (names[c.id]) { c.name = names[c.id]; continue; }
    let n = 100 + (hash32(c.id) % 900);
    for (let guard = 0; takenNums.has(n) && guard < 900; guard++) n = n === 999 ? 100 : n + 1;
    takenNums.add(n);
    c.name = `Room ${n}`;
  }

  candidates.sort((a, b) => (b.area - a.area) || (a.id < b.id ? -1 : 1));

  for (const c of candidates) {
    const f = faces[c.faceIndex];
    let poly = f.inset;
    if (signedArea(poly) < 0) poly = poly.slice().reverse();
    const holes = c.holes.map(h => (signedArea(h) > 0 ? h.slice().reverse() : h));
    rooms[c.id] = {
      id: c.id,
      levelId,
      polygon: poly.map(p => [round(p[0]), round(p[1])]),
      holes: holes.map(h => h.map(p => [round(p[0]), round(p[1])])),
      area: round(c.area, 4),
      perimeter: round(perimeterOf(poly) + holes.reduce((s, h) => s + perimeterOf(h), 0), 4),
      name: c.name,
      program: programs[c.id] ?? null,
      doors: [],
      windows: [],
      wallIds: f.wallIds,
      isOutside: false,
      undersized: c.area < MIN_ROOM_AREA,   // riser, cupboard: real, but flag it
    };
  }

  // openings -> the two faces their wall separates
  const adjEdges = [];
  const openingIds = Object.keys(model.openings).sort();
  for (const oid of openingIds) {
    const o = model.openings[oid];
    const w = model.walls[o.wallId];
    if (!w || w.levelId !== levelId) continue;
    const a = model.nodes[w.a], b = model.nodes[w.b];
    if (!a || !b) continue;
    const len = hyp(a.x, a.z, b.x, b.z) || 1;
    const tc = (o.offset ?? 0) / len;
    let edgeIdx = -1;
    for (let e = 0; e < g.edges.length; e++) {
      const ge = g.edges[e];
      if (ge.wallId !== o.wallId) continue;
      if (edgeIdx === -1) edgeIdx = e;                              // fallback
      if (tc >= ge.t0 - 1e-9 && tc <= ge.t1 + 1e-9) { edgeIdx = e; break; }
    }
    if (edgeIdx === -1) continue;
    const A = faceOf[edgeIdx * 2] >= 0 ? faceLabel[faceOf[edgeIdx * 2]] : null;
    const B = faceOf[edgeIdx * 2 + 1] >= 0 ? faceLabel[faceOf[edgeIdx * 2 + 1]] : null;
    for (const side of [A, B]) {
      if (side && side !== 'OUTSIDE' && rooms[side]) {
        const bucket = o.kind === 'window' ? rooms[side].windows : rooms[side].doors;
        if (!bucket.includes(oid)) bucket.push(oid);
      }
    }
    if (o.kind === 'window') continue;
    if (!A || !B || A === B) continue;
    adjEdges.push({ a: A, b: B, openingId: oid, clearWidth: o.width ?? 0.90 });
  }

  const order = candidates.map(c => c.id);
  const result = { rooms, order, edges: adjEdges, levelId };
  register(result);
  return result;
}

function round(v, d = 6) {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Any point strictly inside ring-minus-holes, or null. Coarse but deterministic. */
function polyInteriorPoint(poly, holes) {
  const shape = { polygon: signedArea(poly) < 0 ? poly.slice().reverse() : poly, holes };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of shape.polygon) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const N = 16;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const z = minZ + ((maxZ - minZ) * j) / N;
      if (pointInRoomShape(shape, x, z)) return { x, z };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. room graph

const ADJ = new WeakMap();      // rooms map -> edges, so roomGraph() is free
function register(result) {
  ADJ.set(result.rooms, result.edges);
  ADJ.set(result, result.edges);
}

/**
 * roomGraph(model, rooms) -> { nodes: [roomId|'OUTSIDE'], edges: [{a,b,openingId,clearWidth}] }
 * `rooms` may be the map returned by computeRooms, or the whole result object.
 */
export function roomGraph(model, rooms) {
  const map = rooms && rooms.rooms ? rooms.rooms : (rooms ?? {});
  let edges = ADJ.get(rooms) ?? ADJ.get(map);
  if (!edges) {
    const ids = Object.keys(map);
    const levelId = ids.length ? map[ids[0]].levelId : (model.levels?.[0]?.id ?? 'L0');
    edges = computeRooms(model, levelId).edges;
  }
  const nodes = [...Object.keys(map).sort(), 'OUTSIDE'];
  return { nodes, edges: edges.map(e => ({ ...e })) };
}

/** roomId containing (x, z), or null. Holes (pods, courtyards) count as outside. */
export function pointInRoom(rooms, x, z) {
  const map = rooms && rooms.rooms ? rooms.rooms : (rooms ?? {});
  const ids = Object.keys(map).sort();
  for (const id of ids) if (pointInRoomShape(map[id], x, z)) return id;
  return null;
}

/**
 * roomCentroid(room) -> {x, z}
 * Area centroid when it falls inside the room, otherwise the deepest sampled
 * interior point — an L-shaped room must not get a label out in the garden.
 */
export function roomCentroid(room) {
  const poly = room.polygon;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    a += cross;
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  a /= 2;
  if (Math.abs(a) > 1e-9) {
    cx /= 6 * a; cz /= 6 * a;
    if (pointInRoomShape(room, cx, cz)) return { x: round(cx), z: round(cz) };
  }
  // fallback: coarse pole of inaccessibility over the bounding box
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[1] > maxZ) maxZ = p[1];
  }
  const rings = [poly, ...(room.holes ?? [])];
  const N = 24;
  let best = null, bestD = -1;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const z = minZ + ((maxZ - minZ) * j) / N;
      if (!pointInRoomShape(room, x, z)) continue;
      const d = distToPolygonEdges(rings, x, z);
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
  }
  return best ? { x: round(best.x), z: round(best.z) } : { x: round((minX + maxX) / 2), z: round((minZ + maxZ) / 2) };
}

// ---------------------------------------------------------------------------
// 6. cache, keyed on model.version

const CACHE = new WeakMap();    // model -> Map(levelId -> { version, result })

/** Cached computeRooms. Recomputes only when model.version changed. */
export function getRooms(model, levelId = model.levels?.[0]?.id ?? 'L0') {
  let per = CACHE.get(model);
  if (!per) { per = new Map(); CACHE.set(model, per); }
  const hit = per.get(levelId);
  if (hit && hit.version === model.version) return hit.result;
  const result = computeRooms(model, levelId);
  per.set(levelId, { version: model.version, result });
  return result;
}

/** Drop the cache for one model (or one level of it). Rarely needed. */
export function invalidateRooms(model, levelId) {
  if (!model) return;
  if (levelId === undefined) CACHE.delete(model);
  else CACHE.get(model)?.delete(levelId);
}

/** All rooms of a model, every level, in level order. */
export function getAllRooms(model) {
  const out = { rooms: {}, order: [] };
  for (const l of model.levels ?? []) {
    const r = getRooms(model, l.id);
    Object.assign(out.rooms, r.rooms);
    out.order.push(...r.order);
  }
  return out;
}
