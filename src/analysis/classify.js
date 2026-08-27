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

  // Rooms the commission briefs actually ask for. Every one of the eight
  // building types in src/commission/types.js writes its schedule in these
  // words; if a word is missing here the client asks for a room the engine
  // can never see, and the complaint can never be cleared.
  meeting:   { label: 'meeting room',  habitable: true,  glaze: 8,  minCeiling: 2.50 },
  // A focus booth is occupied for minutes, not hours: no daylight duty, but it
  // is still a room somebody stands up in.
  focus:     { label: 'focus room',    habitable: false, glaze: null, minCeiling: 2.50 },
  breakout:  { label: 'tea point',     habitable: true,  glaze: 12, minCeiling: 2.50 },
  reception: { label: 'reception',     habitable: true,  glaze: 8,  minCeiling: 2.70 },
  waiting:   { label: 'waiting area',  habitable: true,  glaze: 8,  minCeiling: 2.70 },
  staffroom: { label: 'staff room',    habitable: true,  glaze: 8,  minCeiling: 2.50 },
  changing:  { label: 'staff changing', habitable: false, glaze: null, minCeiling: 2.20 },
  cloakroom: { label: 'cloakroom',     habitable: false, glaze: null, minCeiling: 2.20 },
  sickroom:  { label: 'sick room',     habitable: true,  glaze: 8,  minCeiling: 2.50 },
  counter:   { label: 'counter',       habitable: true,  glaze: 8,  minCeiling: 2.70 },
  archive:   { label: 'archive',       habitable: false, glaze: null, minCeiling: 2.20 },
  comms:     { label: 'comms room',    habitable: false, glaze: null, minCeiling: 2.20 },
  cleaner:   { label: "cleaner's store", habitable: false, glaze: null, minCeiling: 2.20 },
  waste:     { label: 'waste store',   habitable: false, glaze: null, minCeiling: 2.20 },
  delivery:  { label: 'goods entrance', habitable: false, glaze: null, minCeiling: 2.20 },
  // A whole flat, not a room. Matched as a group of rooms, see UNIT_KINDS.
  flat:      { label: 'flat',          habitable: true,  glaze: 8,  minCeiling: 2.50 },
};

/**
 * Programme lines that ask for a self-contained DWELLING rather than a room.
 * `rooms` is the number of habitable rooms the flat must contain: a studio is
 * one, a two-room flat two. The programme matcher counts rooms in a group, it
 * does not look for one big room called "flat".
 */
export const UNIT_KINDS = {
  apt_studio: { label: 'studio flat',     rooms: 1 },
  apt_two:    { label: 'two-room flat',   rooms: 2 },
  apt_three:  { label: 'three-room flat', rooms: 3 },
};

/** Room kinds that are circulation shared by the whole building, not part of a flat. */
export const COMMON_KINDS = new Set(['corridor', 'stair', 'hall']);

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

  // the commission vocabulary
  workspace: 'office', meetingroom: 'meeting', boardroom: 'meeting',
  focusroom: 'focus', phonebooth: 'focus',
  teapoint: 'breakout', kitchenette2: 'breakout',
  receptiondesk: 'reception', issuedesk: 'reception', frontdesk: 'reception',
  waitingarea: 'waiting', waitingroom: 'waiting',
  staffroom: 'staffroom', staffchanging: 'changing', changingroom: 'changing',
  staffworkroom: 'study',
  grouproom: 'classroom', playgroup: 'classroom', childrenslibrary: 'reading',
  children: 'reading', lending: 'reading', openshelving: 'reading',
  studyroom: 'study',
  sickroom: 'sickroom', firstaid: 'sickroom',
  checkout: 'counter', till: 'counter', pass: 'counter',
  records: 'office', backoffice: 'office',
  stock: 'store', stockroom: 'store', bikestore: 'store', bikepram: 'store',
  pramstore: 'store', binstore: 'waste', kitchenstore: 'store',
  coldstore: 'store', drystore: 'store',
  wastehold: 'waste', clinicalwaste: 'waste', refuse: 'waste',
  goodsentrance: 'delivery', deliveries: 'delivery', servicebay: 'delivery',
  comms: 'comms', serverroom: 'comms',
  cleanutility: 'utility', dirtyutility: 'utility',
  entrancelobby: 'hall', staircore: 'stair',
  issuingkitchen: 'kitchen',
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

/**
 * A programme line from the brief asks either for a ROOM or for a whole
 * DWELLING UNIT. Resolve which, so the programme matcher never silently
 * fails to recognise a word the client used.
 *   -> { kind: 'room', key } | { kind: 'unit', key, rooms } | { kind: 'unknown' }
 */
export function resolveProgramKey(key) {
  const raw = String(key ?? '').toLowerCase().replace(/[^a-z]/g, '');
  for (const uk in UNIT_KINDS) {
    if (raw === uk.replace(/[^a-z]/g, '')) return { kind: 'unit', key: uk, ...UNIT_KINDS[uk] };
  }
  const room = canonicalKey(key);
  if (room) return { kind: 'room', key: room };
  return { kind: 'unknown', key: String(key ?? '') };
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
  { key: 'meeting', any: ['meeting'] },
  { key: 'waiting', any: ['waiting'] },
  { key: 'reception', any: ['reception'] },
  { key: 'cloakroom', any: ['cloakroom'] },
  { key: 'stair', any: ['stair'] },
  { key: 'office', any: ['workstation'] },
  { key: 'dining', all: ['table'], min: 4, tag: 'seat' },
  { key: 'living', any: ['lounge'] },
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

    const renamed = !!(names[room.key] ?? names[room.id]);
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
      // A rename by the player is the only name worth repeating back to him.
      // rooms.js auto-labels every face "Room 549"; a client writing an e-mail
      // says "the living room", never "the Room 549".
      label: renamed ? room.name : kind.label,
      habitable: kind.habitable,
      glaze: kind.glaze,
      minCeiling: kind.minCeiling,
      source,
      renamed,
      index: n,
      tags,
      furniture,
    });
  }

  // Disambiguate repeats so the e-mail can say "the second bedroom".
  const totals = new Map();
  for (const c of out.values()) totals.set(c.key, (totals.get(c.key) ?? 0) + 1);
  for (const c of out.values()) {
    if (!c.renamed && totals.get(c.key) > 1) {
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
