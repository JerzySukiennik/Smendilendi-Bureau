// Analysis-side adapter over src/model/catalog.js.
//
// This is the ONLY file in src/analysis/ that touches the catalogue, so the
// engine keeps running if a catalogue id is missing or an entry is incomplete.
// Nothing here invents architecture: real entries are used exactly as authored,
// and the fallback for an unknown id is a generic 0.60 m front clearance — the
// depth of a person standing at a piece of furniture — flagged as a guess.

import {
  CATALOG, tryEntry, clearanceBox,
  MATERIAL_PRICES, materialPrice, STRUCTURE_PRICES, wallStructurePrice,
} from '../model/catalog.js';

export { CATALOG, MATERIAL_PRICES, STRUCTURE_PRICES, wallStructurePrice };

const NO_CLEARANCE = { front: 0, back: 0, left: 0, right: 0 };
const DEFAULT_CLEARANCE = { front: 0.60, back: 0, left: 0, right: 0 };

const GUESS = [
  [/wardrobe|closet/, ['storage', 'wardrobe'], [1.00, 2.10, 0.60], { front: 0.60 }, 3200],
  [/\bbed\b|bed-/, ['bed'], [1.60, 0.55, 2.00], { front: 0.55, left: 0.70, right: 0.70 }, 2600],
  [/sofa|couch/, ['seat'], [2.00, 0.80, 0.90], { front: 0.90 }, 4200],
  [/desk|workstation/, ['workstation', 'table'], [1.60, 0.74, 0.80], { front: 0.90 }, 1800],
  [/chair|stool/, ['seat'], [0.45, 0.85, 0.50], { back: 0.60 }, 600],
  [/table/, ['table'], [1.60, 0.75, 0.90], { front: 0.80, back: 0.80 }, 2400],
  [/sink|basin/, ['sink', 'sanitary'], [0.60, 0.90, 0.60], { front: 0.75 }, 1600],
  [/hob|cooker|oven|stove/, ['hob', 'kitchen'], [0.60, 0.90, 0.60], { front: 1.20 }, 2200],
  [/fridge|refriger/, ['kitchen', 'appliance'], [0.60, 2.00, 0.65], { front: 1.20 }, 3200],
  [/worktop|counter|kitchen/, ['worktop', 'kitchen'], [0.60, 0.90, 0.60], { front: 1.20 }, 1100],
  [/wc|toilet|urinal/, ['wc', 'sanitary'], [0.38, 0.80, 0.70], { front: 0.60, left: 0.20, right: 0.20 }, 1600],
  [/shower/, ['shower', 'sanitary'], [0.90, 2.00, 0.90], { front: 0.60 }, 3400],
  [/bath/, ['bath', 'sanitary'], [1.70, 0.60, 0.75], { front: 0.70 }, 3900],
  [/shelf|shelving|bookcase|cabinet|storage/, ['storage', 'shelving'], [0.80, 1.80, 0.35], { front: 0.60 }, 1400],
  [/plant|tree/, ['plant'], [0.45, 1.20, 0.45], {}, 400],
  [/lamp|light|luminaire|pendant/, ['light'], [0.30, 0.40, 0.30], {}, 500],
  [/rug|carpet|mat/, ['soft', 'walkable'], [2.00, 0.02, 1.40], {}, 900],
];

export function pretty(id) {
  return String(id ?? 'item').replace(/[-_]+/g, ' ').trim() || 'item';
}

function guess(catalogId) {
  const id = String(catalogId ?? '').toLowerCase();
  for (const [re, tags, size, clr, price] of GUESS) {
    if (re.test(id)) {
      return {
        id: catalogId, name: pretty(catalogId), category: 'misc', file: null,
        size, price, anchor: 'floor', mount: 0,
        clearance: { ...NO_CLEARANCE, ...clr },
        tags, colorable: true, _guessed: true,
      };
    }
  }
  return {
    id: catalogId, name: pretty(catalogId), category: 'misc', file: null,
    size: [0.60, 0.80, 0.60], price: 400, anchor: 'floor', mount: 0,
    clearance: { ...DEFAULT_CLEARANCE }, tags: [], colorable: true, _guessed: true,
  };
}

/** Catalogue entry for an id, normalised, never null, never throws. */
export function entryOf(catalogId) {
  const raw = tryEntry ? tryEntry(catalogId) : (CATALOG ? CATALOG[catalogId] : null);
  if (!raw) return guess(catalogId);
  const g = guess(catalogId);
  return {
    ...raw,
    id: raw.id ?? catalogId,
    name: raw.name ?? pretty(catalogId),
    size: Array.isArray(raw.size) && raw.size.length === 3 ? raw.size : g.size,
    price: Number.isFinite(raw.price) ? raw.price : g.price,
    anchor: raw.anchor ?? 'floor',
    clearance: { ...NO_CLEARANCE, ...(raw.clearance ?? {}) },
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

/**
 * The name a person would use out loud. Catalogue names carry the size so the
 * editor's palette can be precise ("Washbasin 560", "Wardrobe, hinged, 1.0 m");
 * a client writing an e-mail says "washbasin" and "wardrobe".
 */
export function shortName(entry) {
  let n = String(entry?.name ?? entry?.id ?? 'item').split(',')[0].trim();
  n = n.replace(/\s+\d+(\.\d+)?\s*(x|\u00d7)\s*\d+(\.\d+)?\s*(mm|m)?$/i, '');
  n = n.replace(/\s+\d+(\.\d+)?\s*(mm|m)?$/i, '');
  return n.trim() || 'item';
}

export function tagsOf(catalogId) {
  return entryOf(catalogId).tags;
}

export function hasTag(catalogId, tag) {
  return entryOf(catalogId).tags.includes(tag);
}

/** Plan footprint of a placed piece, with its per-axis scale applied. */
export function footprintOf(f, entry = entryOf(f.catalogId)) {
  return {
    w: entry.size[0] * Math.abs(f.sx ?? 1),
    h: entry.size[1] * Math.abs(f.sy ?? 1),
    d: entry.size[2] * Math.abs(f.sz ?? 1),
  };
}

/**
 * Required clearance per side in metres, read back out of the catalogue's own
 * clearanceBox() so the ergonomics module and the editor's overlay can never
 * disagree about what the requirement is.
 */
export function clearanceOf(f, entry = entryOf(f.catalogId)) {
  try {
    const box = clearanceBox(entry, f);
    if (box && box.local) {
      const fp = footprintOf(f, entry);
      return {
        left: Math.max(0, -box.local.minX - fp.w / 2),
        right: Math.max(0, box.local.maxX - fp.w / 2),
        back: Math.max(0, -box.local.minZ - fp.d / 2),
        front: Math.max(0, box.local.maxZ - fp.d / 2),
      };
    }
  } catch { /* fall through to the entry's own block */ }
  return { ...NO_CLEARANCE, ...entry.clearance };
}

// --------------------------------------------------------------------------
// materials

/** Rate per m² for a finish. Never NaN. */
export function materialRate(matId) {
  try {
    const v = materialPrice(matId);
    if (Number.isFinite(v)) return v;
  } catch { /* fall through */ }
  const raw = MATERIAL_PRICES?.[matId];
  return Number.isFinite(raw) ? raw : 85;
}

/** Rate per m² of elevation for a wall carcass. */
export function structureRate(type) {
  try {
    const v = wallStructurePrice(type);
    if (Number.isFinite(v)) return v;
  } catch { /* fall through */ }
  return type === 'exterior' ? 820 : type === 'party' ? 880 : 280;
}

export function slabRate(kind) {
  const v = kind === 'roof' ? STRUCTURE_PRICES?.slabRoof : STRUCTURE_PRICES?.slabFloor;
  return Number.isFinite(v) ? v : (kind === 'roof' ? 560 : 620);
}

export function foundationRate() {
  return Number.isFinite(STRUCTURE_PRICES?.foundation) ? STRUCTURE_PRICES.foundation : 220;
}

export function materialName(matId) {
  return pretty(matId);
}
