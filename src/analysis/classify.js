// What kind of room is this? Everything downstream — daylight requirements,
// escape rules, ergonomics, the client's own words — hangs off this answer.
//
// Order of evidence, strongest first:
//   1. an explicit program set on the room (room.program, or a rename op)
//   2. the room's own name
//   3. the tags of the furniture standing in it
//   4. geometry: area, aspect ratio, how many doors

import { polygonAspect } from './geom.js';
import { inRoom } from './topology.js';
import { entryOf } from './catalogue.js';

/**
 * glaze = the denominator of the required window-to-floor ratio (1:8, 1:12),
 *         null where no daylight is required at all.
 * minCeiling = clear floor-to-ceiling height in metres.
 */
export const ROOM_KINDS = {
  living:    { label: 'living room',   habitable: true,  glaze: 8,  minCeiling: 2.50 },
  bedroom:   { label: 'bedroom',       habitable: true,  glaze: 8,  minCeiling: 2.50 },
  kitchen:   { label: 'kitchen',       habitable: true,  glaze: 12, minCeiling: 2.50 },
  dining:    { label: 'dining room',   habitable: true,  glaze: 8,  minCeiling: 2.50 },
  study:     { label: 'study',         habitable: true,  glaze: 8,  minCeiling: 2.50 },
  office:    { label: 'office',        habitable: true,  glaze: 8,  minCeiling: 2.50 },
  classroom: { label: 'classroom',     habitable: true,  glaze: 8,  minCeiling: 3.00 },
  playroom:  { label: 'playroom',      habitable: true,  glaze: 8,  minCeiling: 2.50 },
  ward:      { label: 'consulting room', habitable: true, glaze: 8, minCeiling: 2.70 },
  reading:   { label: 'reading room',  habitable: true,  glaze: 8,  minCeiling: 2.70 },
  cafe:      { label: 'dining area',   habitable: true,  glaze: 8,  minCeiling: 2.70 },
  retail:    { label: 'shop floor',    habitable: true,  glaze: 8,  minCeiling: 2.70 },
  bathroom:  { label: 'bathroom',      habitable: false, glaze: null, minCeiling: 2.20 },
  wc:        { label: 'WC',            habitable: false, glaze: null, minCeiling: 2.20 },
  hall:      { label: 'entrance hall', habitable: false, glaze: null, minCeiling: 2.20 },
  corridor:  { label: 'corridor',      habitable: false, glaze: null, minCeiling: 2.20 },
  stair:     { label: 'stair',         habitable: false, glaze: null, minCeiling: 2.20 },
  store:     { label: 'store',         habitable: false, glaze: null, minCeiling: 2.20 },
  utility:   { label: 'utility room',  habitable: false, glaze: null, minCeiling: 2.20 },
  technical: { label: 'plant room',    habitable: false, glaze: null, minCeiling: 2.20 },
  garage:    { label: 'garage',        habitable: false, glaze: null, minCeiling: 2.20 },
  unassigned:{ label: 'unnamed room',  habitable: false, glaze: null, minCeiling: 2.20 },
};

const ALIASES = {
  livingroom: 'living', lounge: 'living', sittingroom: 'living', salon: 'living',
  bed: 'bedroom', master: 'bedroom', masterbedroom: 'bedroom', guestroom: 'bedroom',
  kitchenette: 'kitchen', cook: 'kitchen',
  diner: 'dining', diningroom: 'dining',
  workroom: 'study', den: 'study', workspace: 'office', openplanoffice: 'office',
  bath: 'bathroom', shower: 'bathroom', ensuite: 'bathroom', washroom: 'bathroom',
  toilet: 'wc', lavatory: 'wc', restroom: 'wc',
  entrance: 'hall', entry: 'hall', foyer: 'hall', lobby: 'hall', vestibule: 'hall',
  passage: 'corridor', hallway: 'corridor', circulation: 'corridor',
  staircase: 'stair', stairs: 'stair',
  storage: 'store', pantry: 'store', larder: 'store', cupboard: 'store',
  laundry: 'utility', boiler: 'technical', plant: 'technical', server: 'technical',
  shop: 'retail', sales: 'retail', salesfloor: 'retail',
  restaurant: 'cafe', canteen: 'cafe',
  library: 'reading', readingroom: 'reading',
  consulting: 'ward', treatment: 'ward', surgery: 'ward',
};

export function canonicalKey(key) {
  if (!key) return null;
  const k = String(key).toLowerCase().replace(/[^a-z]/g, '');
  if (ROOM_KINDS[k]) return k;
  if (ALIASES[k]) return ALIASES[k];
  for (const alias in ALIASES) if (k.includes(alias)) return ALIASES[alias];
  for (const kind in ROOM_KINDS) if (k.includes(kind)) return kind;
  return null;
}

// Furniture tags that give a room away, strongest signal first.
const TAG_RULES = [
  { key: 'bathroom', any: ['bath', 'shower'] },
  { key: 'wc', any: ['wc', 'urinal'] },
  { key: 'kitchen', any: ['hob', 'worktop', 'sink'] },
  { key: 'bedroom', any: ['bed'] },
  { key: 'classroom', any: ['child', 'play'] },
  { key: 'ward', any: ['exam-couch', 'clinic'] },
  { key: 'retail', any: ['till', 'retail', 'shopfront'] },
  { key: 'cafe', any: ['cafe', 'bar'] },
  { key: 'office', any: ['workstation', 'meeting'] },
  { key: 'dining', all: ['table'], min: 4, tag: 'seat' },
  { key: 'living', any: ['lounge'] },
  { key: 'hall', any: ['reception'] },
  { key: 'store', any: ['shelving'] },
];

function roomTags(model, room) {
  const tags = new Map();          // tag -> count
  for (const fid in model.furniture) {
    const f = model.furniture[fid];
    if (f.levelId !== room.levelId) continue;
    if (!inRoom(room, f.x, f.z)) continue;
    for (const t of entryOf(f.catalogId).tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  }
  return tags;
}

/**
 * classifyRooms(model, topo, brief) -> Map(roomId -> {
 *   key, label, habitable, glaze, minCeiling, source, tags, furniture: [id]
 * })
 */
export function classifyRooms(model, topo, brief = {}) {
  const out = new Map();
  const names = model.siteMods?.roomNames ?? {};
  const programs = model.siteMods?.roomPrograms ?? {};
  const counters = new Map();

  for (const room of topo.rooms) {
    const tags = roomTags(model, room);
    const explicit = canonicalKey(room.program)
      ?? canonicalKey(programs[room.key] ?? programs[room.id])
      ?? canonicalKey(room.name)
      ?? canonicalKey(names[room.key] ?? names[room.id]);
    let key = explicit;
    let source = explicit ? 'named' : null;

    if (!key) {
      key = fromTags(tags);
      if (key) source = 'furniture';
    }
    if (!key) {
      key = fromGeometry(room, topo);
      source = 'geometry';
    }

    const kind = ROOM_KINDS[key] ?? ROOM_KINDS.unassigned;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);

    const furniture = [];
    for (const fid in model.furniture) {
      const f = model.furniture[fid];
      if (f.levelId === room.levelId && inRoom(room, f.x, f.z)) furniture.push(fid);
    }

    out.set(room.id, {
      key,
      label: room.name && source === 'named' ? room.name : kind.label,
      habitable: kind.habitable,
      glaze: kind.glaze,
      minCeiling: kind.minCeiling,
      source,
      index: n,
      tags,
      furniture,
    });
  }

  // Disambiguate repeats so the e-mail can say "the second bedroom".
  const totals = new Map();
  for (const c of out.values()) totals.set(c.key, (totals.get(c.key) ?? 0) + 1);
  for (const c of out.values()) {
    if (c.source !== 'named' && totals.get(c.key) > 1) {
      c.label = `${ORDINALS[c.index - 1] ?? `${c.index}th`} ${ROOM_KINDS[c.key].label}`;
    }
  }
  void brief;
  return out;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

function fromTags(tags) {
  for (const rule of TAG_RULES) {
    if (rule.all && !rule.all.every(t => tags.has(t))) continue;
    if (rule.any && !rule.any.some(t => tags.has(t))) continue;
    if (rule.min && (tags.get(rule.tag) ?? 0) < rule.min) continue;
    return rule.key;
  }
  return null;
}

function fromGeometry(room, topo) {
  const a = polygonAspect(room.polygon);
  const doors = room.doors.length;
  if (a.short <= 2.00 && a.ratio >= 2.2 && doors >= 2) return 'corridor';
  if (room.area < 3.0 && doors <= 1) return 'store';
  if (doors >= 3 && room.area < 14 && topo.exteriorDoors.some(d => room.doors.includes(d))) return 'hall';
  return 'unassigned';
}

/** Rooms whose only reasonable route must not run through a bedroom. */
export const PRIVATE_ROUTE_TARGETS = new Set(['wc', 'bathroom']);
export const BEDROOMS = new Set(['bedroom']);
