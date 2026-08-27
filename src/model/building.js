// BuildingModel — the single source of truth for the designed building.
// Pure data + pure functions. No three.js, no DOM. Must import in bare node.
//
// Units: metres, radians. Coordinates are (x, z) on plan, y is up.
// Ids are deterministic (seeded counter) so two clients applying the same op
// sequence produce byte-identical models.

export const EPS = 0.001;          // 1 mm — node dedup and coincidence tolerance
export const DEFAULT_WALL = {
  exterior: 0.24,                   // 240 mm masonry + finishes
  interior: 0.12,                   // 120 mm partition
  party: 0.25,                      // separating wall
};
export const DEFAULT_LEVEL_HEIGHT = 2.70;   // floor-to-ceiling, residential
export const DEFAULT_SLAB_THICKNESS = 0.30; // structural slab + build-up

// ---------------------------------------------------------------------------
// creation

export function createModel(opts = {}) {
  const level = { id: 'L0', name: 'Ground floor', elevation: 0, height: opts.height ?? DEFAULT_LEVEL_HEIGHT };
  return {
    id: opts.id ?? 'model',
    version: 0,
    _seq: 0,
    levels: [level],
    nodes: {},
    walls: {},
    openings: {},
    slabs: {},
    rooms: {},          // derived — see rooms.js
    furniture: {},
    texts: {},
    siteMods: {},
  };
}

function nextId(model, prefix) {
  model._seq += 1;
  return `${prefix}${model._seq}`;
}

// ---------------------------------------------------------------------------
// small geometry helpers (kept local so this file has zero imports)

export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

function segIntersect(a, b, c, d) {
  // Returns { t, u, x, z } for a proper crossing of segments ab and cd, else null.
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const denom = r.x * s.z - r.z * s.x;
  if (Math.abs(denom) < 1e-12) return null;            // parallel or collinear
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / denom;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / denom;
  const pad = EPS;                                      // do not split at the very ends
  if (t <= pad || t >= 1 - pad || u <= pad || u >= 1 - pad) return null;
  return { t, u, x: a.x + t * r.x, z: a.z + t * r.z };
}

export function wallLength(model, wall) {
  const a = model.nodes[wall.a], b = model.nodes[wall.b];
  return dist2(a.x, a.z, b.x, b.z);
}

export function wallDir(model, wall) {
  const a = model.nodes[wall.a], b = model.nodes[wall.b];
  const len = dist2(a.x, a.z, b.x, b.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len, len, a, b };
}

/** Point on a wall at distance d from node a, offset perpendicular by o. */
export function wallPoint(model, wall, d, o = 0) {
  const { x: dx, z: dz, a } = wallDir(model, wall);
  return { x: a.x + dx * d - dz * o, z: a.z + dz * d + dx * o };
}

// ---------------------------------------------------------------------------
// node management

/** Find an existing node within EPS, or create one. Returns the node id. */
function ensureNode(model, x, z, created) {
  for (const id in model.nodes) {
    const n = model.nodes[id];
    if (dist2(n.x, n.z, x, z) <= EPS) return id;
  }
  const id = nextId(model, 'n');
  model.nodes[id] = { id, x, z };
  if (created) created.push(id);
  return id;
}

function nodeIsOrphan(model, nodeId) {
  for (const id in model.walls) {
    const w = model.walls[id];
    if (w.a === nodeId || w.b === nodeId) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// op application
//
// applyOp(model, op) -> { model, changed, inverse }
// The input model is never mutated; a shallow-cloned copy is returned.

function cloneModel(m) {
  return {
    ...m,
    levels: m.levels.map(l => ({ ...l })),
    nodes: { ...m.nodes },
    walls: Object.fromEntries(Object.entries(m.walls).map(([k, w]) => [k, { ...w, openings: [...w.openings] }])),
    openings: { ...m.openings },
    slabs: { ...m.slabs },
    rooms: { ...m.rooms },
    furniture: { ...m.furniture },
    texts: { ...m.texts },
    siteMods: { ...m.siteMods },
  };
}

export function applyOp(model, op) {
  const m = cloneModel(model);
  m.version = model.version + 1;
  const changed = [];
  const handler = OPS[op.t];
  if (!handler) throw new Error(`unknown op: ${op.t}`);
  const inverse = handler(m, op, changed);
  return { model: m, changed, inverse };
}

export function applyOps(model, ops) {
  let m = model;
  const inverses = [];
  for (const op of ops) {
    const r = applyOp(m, op);
    m = r.model;
    inverses.unshift(r.inverse);
  }
  return { model: m, inverses };
}

const OPS = {
  // -- walls ---------------------------------------------------------------

  'wall.add'(m, op, changed) {
    const type = op.wallType ?? 'interior';
    const thickness = op.thickness ?? DEFAULT_WALL[type] ?? DEFAULT_WALL.interior;
    const levelId = op.levelId ?? m.levels[0].id;
    const createdNodes = [];
    const aId = ensureNode(m, op.ax, op.az, createdNodes);
    const bId = ensureNode(m, op.bx, op.bz, createdNodes);
    if (aId === bId) return { t: 'noop' };

    const made = [];
    addWallSplitting(m, { aId, bId, levelId, type, thickness, matInner: op.matInner ?? 'plaster', matOuter: op.matOuter ?? 'render' }, made, changed, op.id);
    return { t: 'wall.deleteMany', ids: made, nodes: createdNodes };
  },

  'wall.move'(m, op, changed) {
    const w = m.walls[op.id];
    if (!w) return { t: 'noop' };
    const a = m.nodes[w.a], b = m.nodes[w.b];
    const inv = { t: 'wall.moveNodes', id: op.id, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } };
    m.nodes[w.a] = { ...a, x: a.x + op.dx, z: a.z + op.dz };
    m.nodes[w.b] = { ...b, x: b.x + op.dx, z: b.z + op.dz };
    changed.push(op.id, w.a, w.b);
    return inv;
  },

  'wall.moveNodes'(m, op, changed) {
    const w = m.walls[op.id];
    if (!w) return { t: 'noop' };
    const a = m.nodes[w.a], b = m.nodes[w.b];
    const inv = { t: 'wall.moveNodes', id: op.id, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } };
    m.nodes[w.a] = { ...a, ...op.a };
    m.nodes[w.b] = { ...b, ...op.b };
    changed.push(op.id, w.a, w.b);
    return inv;
  },

  'node.move'(m, op, changed) {
    const n = m.nodes[op.id];
    if (!n) return { t: 'noop' };
    const inv = { t: 'node.move', id: op.id, x: n.x, z: n.z };
    m.nodes[op.id] = { ...n, x: op.x, z: op.z };
    changed.push(op.id);
    return inv;
  },

  'wall.split'(m, op, changed) {
    const w = m.walls[op.id];
    if (!w) return { t: 'noop' };
    const created = [];
    const midId = ensureNode(m, op.x, op.z, created);
    const parts = splitWallAt(m, op.id, midId, changed);
    return { t: 'wall.mergeBack', ids: parts, original: { ...w, openings: [...w.openings] }, node: midId };
  },

  'wall.mergeBack'(m, op, changed) {
    for (const id of op.ids) { delete m.walls[id]; changed.push(id); }
    m.walls[op.original.id] = { ...op.original, openings: [...op.original.openings] };
    if (op.node && nodeIsOrphan(m, op.node)) delete m.nodes[op.node];
    changed.push(op.original.id);
    return { t: 'noop' };
  },

  'wall.delete'(m, op, changed) {
    const w = m.walls[op.id];
    if (!w) return { t: 'noop' };
    const removedOpenings = w.openings.map(id => ({ ...m.openings[id] }));
    for (const id of w.openings) delete m.openings[id];
    delete m.walls[op.id];
    changed.push(op.id);
    const orphans = [w.a, w.b].filter(n => nodeIsOrphan(m, n));
    // Snapshot the node BEFORE deleting it: the inverse op has to put back the
    // two endpoints the restored wall refers to, or undo leaves a wall whose
    // `a`/`b` name nodes that no longer exist and every reader crashes on it.
    const nodes = orphans.map(id => ({ ...m.nodes[id] })).filter(n => n && n.id);
    for (const n of orphans) delete m.nodes[n];
    return { t: 'wall.restore', wall: { ...w, openings: [...w.openings] }, openings: removedOpenings, nodes };
  },

  'wall.deleteMany'(m, op, changed) {
    for (const id of op.ids) {
      const w = m.walls[id];
      if (!w) continue;
      for (const oid of w.openings) delete m.openings[oid];
      delete m.walls[id];
      changed.push(id);
    }
    for (const id of op.nodes ?? []) if (m.nodes[id] && nodeIsOrphan(m, id)) delete m.nodes[id];
    return { t: 'noop' };
  },

  'wall.restore'(m, op, changed) {
    for (const n of op.nodes ?? []) if (n && n.id) m.nodes[n.id] = { ...n };
    m.walls[op.wall.id] = { ...op.wall, openings: [...op.wall.openings] };
    for (const o of op.openings ?? []) m.openings[o.id] = { ...o };
    changed.push(op.wall.id);
    return { t: 'noop' };
  },

  'wall.setProps'(m, op, changed) {
    const w = m.walls[op.id];
    if (!w) return { t: 'noop' };
    const prev = {};
    for (const k of Object.keys(op.props)) prev[k] = w[k];
    m.walls[op.id] = { ...w, ...op.props };
    changed.push(op.id);
    return { t: 'wall.setProps', id: op.id, props: prev };
  },

  // -- openings ------------------------------------------------------------

  'opening.add'(m, op, changed) {
    const w = m.walls[op.wallId];
    if (!w) return { t: 'noop' };
    const id = op.id ?? nextId(m, 'o');
    const kind = op.kind ?? 'door';
    const o = {
      id,
      wallId: op.wallId,
      kind,
      catalogId: op.catalogId ?? null,
      offset: op.offset,
      width: op.width ?? (kind === 'door' ? 0.90 : 1.20),
      height: op.height ?? (kind === 'door' ? 2.05 : 1.40),
      sill: kind === 'door' ? 0 : (op.sill ?? 0.85),
      swing: kind === 'door' ? (op.swing ?? 'in-left') : null,
      glazingRatio: op.glazingRatio ?? (kind === 'window' ? 0.82 : 0),
    };
    m.openings[id] = o;
    m.walls[op.wallId] = { ...w, openings: [...w.openings, id] };
    changed.push(id, op.wallId);
    return { t: 'opening.delete', id };
  },

  'opening.move'(m, op, changed) {
    const o = m.openings[op.id];
    if (!o) return { t: 'noop' };
    const inv = { t: 'opening.move', id: op.id, offset: o.offset, wallId: o.wallId };
    if (op.wallId && op.wallId !== o.wallId) {
      const from = m.walls[o.wallId], to = m.walls[op.wallId];
      if (from) m.walls[from.id] = { ...from, openings: from.openings.filter(x => x !== op.id) };
      if (to) m.walls[to.id] = { ...to, openings: [...to.openings, op.id] };
      changed.push(o.wallId, op.wallId);
    }
    m.openings[op.id] = { ...o, offset: op.offset, wallId: op.wallId ?? o.wallId };
    changed.push(op.id);
    return inv;
  },

  'opening.resize'(m, op, changed) {
    const o = m.openings[op.id];
    if (!o) return { t: 'noop' };
    const inv = { t: 'opening.resize', id: op.id, width: o.width, height: o.height, sill: o.sill };
    m.openings[op.id] = {
      ...o,
      width: op.width ?? o.width,
      height: op.height ?? o.height,
      sill: op.sill ?? o.sill,
    };
    changed.push(op.id, o.wallId);
    return inv;
  },

  'opening.setProps'(m, op, changed) {
    const o = m.openings[op.id];
    if (!o) return { t: 'noop' };
    const prev = {};
    for (const k of Object.keys(op.props)) prev[k] = o[k];
    m.openings[op.id] = { ...o, ...op.props };
    changed.push(op.id, o.wallId);
    return { t: 'opening.setProps', id: op.id, props: prev };
  },

  'opening.delete'(m, op, changed) {
    const o = m.openings[op.id];
    if (!o) return { t: 'noop' };
    const w = m.walls[o.wallId];
    if (w) m.walls[w.id] = { ...w, openings: w.openings.filter(x => x !== op.id) };
    delete m.openings[op.id];
    changed.push(op.id, o.wallId);
    return { t: 'opening.restore', opening: { ...o } };
  },

  'opening.restore'(m, op, changed) {
    const o = { ...op.opening };
    m.openings[o.id] = o;
    const w = m.walls[o.wallId];
    if (w) m.walls[w.id] = { ...w, openings: [...w.openings, o.id] };
    changed.push(o.id, o.wallId);
    return { t: 'opening.delete', id: o.id };
  },

  // -- slabs ---------------------------------------------------------------

  'slab.add'(m, op, changed) {
    const id = op.id ?? nextId(m, 's');
    m.slabs[id] = {
      id,
      levelId: op.levelId ?? m.levels[0].id,
      polygon: op.polygon.map(p => [p[0], p[1]]),
      kind: op.kind ?? 'floor',
      mat: op.mat ?? 'screed',
    };
    changed.push(id);
    return { t: 'slab.delete', id };
  },

  'slab.delete'(m, op, changed) {
    const s = m.slabs[op.id];
    if (!s) return { t: 'noop' };
    delete m.slabs[op.id];
    changed.push(op.id);
    return { t: 'slab.add', ...s };
  },

  'slab.setMaterial'(m, op, changed) {
    const s = m.slabs[op.id];
    if (!s) return { t: 'noop' };
    const prev = s.mat;
    m.slabs[op.id] = { ...s, mat: op.mat };
    changed.push(op.id);
    return { t: 'slab.setMaterial', id: op.id, mat: prev };
  },

  // -- furniture -----------------------------------------------------------

  'furniture.add'(m, op, changed) {
    const id = op.id ?? nextId(m, 'f');
    m.furniture[id] = {
      id,
      levelId: op.levelId ?? m.levels[0].id,
      catalogId: op.catalogId,
      x: op.x, z: op.z, y: op.y ?? 0,
      rot: op.rot ?? 0,
      sx: op.sx ?? 1, sy: op.sy ?? 1, sz: op.sz ?? 1,
      color: op.color ?? null,
      lockedBy: null,
    };
    changed.push(id);
    return { t: 'furniture.delete', id };
  },

  'furniture.move'(m, op, changed) {
    const f = m.furniture[op.id];
    if (!f) return { t: 'noop' };
    const inv = { t: 'furniture.move', id: op.id, x: f.x, y: f.y, z: f.z, rot: f.rot };
    m.furniture[op.id] = { ...f, x: op.x ?? f.x, y: op.y ?? f.y, z: op.z ?? f.z, rot: op.rot ?? f.rot };
    changed.push(op.id);
    return inv;
  },

  'furniture.transform'(m, op, changed) {
    const f = m.furniture[op.id];
    if (!f) return { t: 'noop' };
    const inv = { t: 'furniture.transform', id: op.id, sx: f.sx, sy: f.sy, sz: f.sz, rot: f.rot };
    m.furniture[op.id] = {
      ...f,
      sx: op.sx ?? f.sx, sy: op.sy ?? f.sy, sz: op.sz ?? f.sz, rot: op.rot ?? f.rot,
    };
    changed.push(op.id);
    return inv;
  },

  'furniture.setColor'(m, op, changed) {
    const f = m.furniture[op.id];
    if (!f) return { t: 'noop' };
    const inv = { t: 'furniture.setColor', id: op.id, color: f.color };
    m.furniture[op.id] = { ...f, color: op.color };
    changed.push(op.id);
    return inv;
  },

  'furniture.delete'(m, op, changed) {
    const f = m.furniture[op.id];
    if (!f) return { t: 'noop' };
    delete m.furniture[op.id];
    changed.push(op.id);
    return { t: 'furniture.add', ...f };
  },

  // -- 3D text -------------------------------------------------------------

  'text.add'(m, op, changed) {
    const id = op.id ?? nextId(m, 't');
    m.texts[id] = {
      id,
      levelId: op.levelId ?? m.levels[0].id,
      value: op.value ?? 'TEXT',
      font: op.font ?? 'grotesk',
      x: op.x, y: op.y ?? 1.5, z: op.z,
      rot: op.rot ?? 0,
      size: op.size ?? 0.30,
      depth: op.depth ?? 0.03,
      color: op.color ?? '#2b2b2b',
      faceNormal: op.faceNormal ?? [0, 0, 1],
    };
    changed.push(id);
    return { t: 'text.delete', id };
  },

  'text.edit'(m, op, changed) {
    const t = m.texts[op.id];
    if (!t) return { t: 'noop' };
    const prev = {};
    for (const k of Object.keys(op.props)) prev[k] = t[k];
    m.texts[op.id] = { ...t, ...op.props };
    changed.push(op.id);
    return { t: 'text.edit', id: op.id, props: prev };
  },

  'text.delete'(m, op, changed) {
    const t = m.texts[op.id];
    if (!t) return { t: 'noop' };
    delete m.texts[op.id];
    changed.push(op.id);
    return { t: 'text.add', ...t };
  },

  // -- levels and rooms ----------------------------------------------------

  'level.add'(m, op, changed) {
    const below = m.levels[m.levels.length - 1];
    const level = {
      id: op.id ?? `L${m.levels.length}`,
      name: op.name ?? `Level ${m.levels.length}`,
      elevation: op.elevation ?? (below.elevation + below.height + DEFAULT_SLAB_THICKNESS),
      height: op.height ?? DEFAULT_LEVEL_HEIGHT,
    };
    m.levels = [...m.levels, level];
    changed.push(level.id);
    return { t: 'level.delete', id: level.id };
  },

  'level.delete'(m, op, changed) {
    const idx = m.levels.findIndex(l => l.id === op.id);
    if (idx < 0) return { t: 'noop' };
    const level = m.levels[idx];
    m.levels = m.levels.filter(l => l.id !== op.id);
    changed.push(op.id);
    return { t: 'level.add', ...level };
  },

  'level.setProps'(m, op, changed) {
    const idx = m.levels.findIndex(l => l.id === op.id);
    if (idx < 0) return { t: 'noop' };
    const prev = {};
    for (const k of Object.keys(op.props)) prev[k] = m.levels[idx][k];
    m.levels = m.levels.map(l => (l.id === op.id ? { ...l, ...op.props } : l));
    changed.push(op.id);
    return { t: 'level.setProps', id: op.id, props: prev };
  },

  // Room naming is stored as an override keyed by a stable room signature,
  // because room ids are derived and change when walls move.
  'room.rename'(m, op, changed) {
    const prev = m.siteMods.roomNames?.[op.key];
    m.siteMods = { ...m.siteMods, roomNames: { ...(m.siteMods.roomNames ?? {}), [op.key]: op.name } };
    changed.push(op.key);
    return { t: 'room.rename', key: op.key, name: prev };
  },

  'room.setProgram'(m, op, changed) {
    const prev = m.siteMods.roomPrograms?.[op.key];
    m.siteMods = { ...m.siteMods, roomPrograms: { ...(m.siteMods.roomPrograms ?? {}), [op.key]: op.program } };
    changed.push(op.key);
    return { t: 'room.setProgram', key: op.key, program: prev };
  },

  // -- locks (multiplayer grab) --------------------------------------------

  'lock.set'(m, op, changed) {
    const f = m.furniture[op.id];
    if (!f) return { t: 'noop' };
    const prev = f.lockedBy;
    m.furniture[op.id] = { ...f, lockedBy: op.by ?? null };
    changed.push(op.id);
    return { t: 'lock.set', id: op.id, by: prev };
  },

  noop() { return { t: 'noop' }; },
};

// ---------------------------------------------------------------------------
// wall insertion with automatic splitting
//
// Inserting a wall that crosses existing walls splits both at every crossing.
// This is what makes closed regions (and therefore rooms) emerge naturally.

function splitWallAt(m, wallId, midNodeId, changed) {
  const w = m.walls[wallId];
  const a = m.nodes[w.a], b = m.nodes[w.b], mid = m.nodes[midNodeId];
  const total = dist2(a.x, a.z, b.x, b.z);
  const cut = dist2(a.x, a.z, mid.x, mid.z);

  const w1 = { ...w, id: nextId(m, 'w'), a: w.a, b: midNodeId, openings: [] };
  const w2 = { ...w, id: nextId(m, 'w'), a: midNodeId, b: w.b, openings: [] };

  // Openings follow whichever half they sit in, keeping their local offset.
  for (const oid of w.openings) {
    const o = m.openings[oid];
    if (o.offset + o.width / 2 <= cut + EPS) {
      w1.openings.push(oid);
      m.openings[oid] = { ...o, wallId: w1.id };
    } else if (o.offset - o.width / 2 >= cut - EPS) {
      w2.openings.push(oid);
      m.openings[oid] = { ...o, wallId: w2.id, offset: o.offset - cut };
    } else {
      delete m.openings[oid];   // straddles the cut — cannot survive
    }
  }

  delete m.walls[wallId];
  m.walls[w1.id] = w1;
  m.walls[w2.id] = w2;
  changed.push(wallId, w1.id, w2.id);
  void total;
  return [w1.id, w2.id];
}

/**
 * Split every existing wall that passes through this node's position.
 * This is what turns a T-junction into two walls meeting a node, which the
 * room finder needs — without it, a partition butting into an outer wall
 * leaves the outer wall whole and no closed region is ever formed.
 */
function splitWallsThroughNode(m, nodeId, levelId, changed) {
  const n = m.nodes[nodeId];
  let again = true;
  while (again) {
    again = false;
    for (const id in m.walls) {
      const w = m.walls[id];
      if (w.levelId !== levelId) continue;
      if (w.a === nodeId || w.b === nodeId) continue;
      const a = m.nodes[w.a], b = m.nodes[w.b];
      const t = projectOnSegment(a, b, n);
      if (t <= EPS || t >= 1 - EPS) continue;
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      if (dist2(px, pz, n.x, n.z) > EPS) continue;
      splitWallAt(m, id, nodeId, changed);
      again = true;                     // the wall map changed under us
      break;
    }
  }
}

function addWallSplitting(m, spec, made, changed, forcedId) {
  const a = m.nodes[spec.aId], b = m.nodes[spec.bId];

  // 0. T-junctions: the new wall's own endpoints may sit on existing walls
  splitWallsThroughNode(m, spec.aId, spec.levelId, changed);
  splitWallsThroughNode(m, spec.bId, spec.levelId, changed);

  // 1. find crossings with every existing wall
  const cuts = [];   // { t, x, z, wallId }
  for (const id in m.walls) {
    const w = m.walls[id];
    if (w.levelId !== spec.levelId) continue;
    const c = m.nodes[w.a], d = m.nodes[w.b];
    const hit = segIntersect(a, b, c, d);
    if (hit) cuts.push({ ...hit, wallId: id });
  }

  // 2. split the existing walls at those points, and collect the split nodes
  const splitNodes = [];
  for (const cut of cuts) {
    if (!m.walls[cut.wallId]) continue;               // already gone
    const nodeId = ensureNode(m, cut.x, cut.z, null);
    splitWallAt(m, cut.wallId, nodeId, changed);
    splitNodes.push({ t: cut.t, nodeId });
  }

  // 3. also break at any existing node lying on the new wall
  for (const id in m.nodes) {
    if (id === spec.aId || id === spec.bId) continue;
    const n = m.nodes[id];
    const t = projectOnSegment(a, b, n);
    if (t > EPS && t < 1 - EPS) {
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      if (dist2(px, pz, n.x, n.z) <= EPS && !splitNodes.some(s => s.nodeId === id)) {
        splitNodes.push({ t, nodeId: id });
      }
    }
  }

  // 4. emit the new wall as a chain of segments between the ordered cut points
  splitNodes.sort((p, q) => p.t - q.t);
  const chain = [spec.aId, ...splitNodes.map(s => s.nodeId), spec.bId];
  for (let i = 0; i < chain.length - 1; i++) {
    if (chain[i] === chain[i + 1]) continue;
    if (wallExistsBetween(m, chain[i], chain[i + 1])) continue;
    const id = (i === 0 && forcedId) ? forcedId : nextId(m, 'w');
    m.walls[id] = {
      id,
      levelId: spec.levelId,
      a: chain[i], b: chain[i + 1],
      thickness: spec.thickness,
      type: spec.type,
      matInner: spec.matInner,
      matOuter: spec.matOuter,
      openings: [],
    };
    made.push(id);
    changed.push(id);
  }
}

function wallExistsBetween(m, aId, bId) {
  for (const id in m.walls) {
    const w = m.walls[id];
    if ((w.a === aId && w.b === bId) || (w.a === bId && w.b === aId)) return true;
  }
  return false;
}

function projectOnSegment(a, b, p) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return 0;
  return ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2;
}

// ---------------------------------------------------------------------------
// serialisation

export function serialize(model) {
  return JSON.stringify(model);
}

export function deserialize(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}

// ---------------------------------------------------------------------------
// convenience builders used by tests, the commission generator and bots

/** Draw a closed rectangular outline. Returns the ops, not the model. */
export function rectOps(x0, z0, x1, z1, opts = {}) {
  const t = opts.wallType ?? 'exterior';
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  return c.map((p, i) => {
    const q = c[(i + 1) % 4];
    return { t: 'wall.add', ax: p[0], az: p[1], bx: q[0], bz: q[1], wallType: t, ...opts };
  });
}
