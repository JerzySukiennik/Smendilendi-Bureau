// What the brief actually says.
//
// A commission (src/commission/index.js) carries a `constraints` array whose
// entries look like { code, check, text, limit }. The client SENDS those
// sentences: "Circulation must stay at least 1.40 m clear", "at most 4 storeys
// above ground". If the engine then measures against its own hard-coded 1.20 m
// the client contradicts himself in writing, which is the one thing a report
// to an architect cannot do.
//
// Every module reads its limit through here, and falls back to a defensible
// default only when the brief is silent (single-player sandbox, hand-written
// test briefs).

export const DWELLING_TYPES = new Set([
  'house', 'detached-house', 'dwelling', 'apartment', 'apartment-building', 'flat',
]);

/** The building type key, however the brief spells it. */
export function typeKey(brief) {
  return String(brief?.buildingType ?? brief?.type ?? 'house').toLowerCase();
}

export function isDwelling(brief) {
  return DWELLING_TYPES.has(typeKey(brief));
}

/** Constraint row for a `check` id, or null. */
export function constraintOf(brief, check) {
  const list = Array.isArray(brief?.constraints) ? brief.constraints : [];
  return list.find(c => c && c.check === check) ?? null;
}

export function hasConstraint(brief, check) {
  return !!constraintOf(brief, check);
}

/** Numeric limit the brief states for a `check`, or `fallback`. */
export function briefLimit(brief, check, fallback) {
  const c = constraintOf(brief, check);
  return Number.isFinite(c?.limit) ? c.limit : fallback;
}

/**
 * A building used by the public. Taken from the brief's own constraints —
 * a step-free entrance or an accessible WC is only ever demanded of one — and
 * from the building type as a backstop.
 */
export function isPublicBuilding(brief) {
  if (hasConstraint(brief, 'access.stepFreeEntrance')) return true;
  if (hasConstraint(brief, 'access.accessibleWc')) return true;
  if (brief?.params?.publicBuilding) return true;
  return !isDwelling(brief);
}

/**
 * Must the plan work for a wheelchair? Explicit brief flag first, then the
 * brief's own accessibility constraints. Before this existed the flag was
 * never set by a generated commission, so a clinic — the one building type
 * where it matters most — was never checked.
 */
export function requiresAccessibility(brief) {
  if (brief?.accessible != null) return !!brief.accessible;
  if (brief?.requiresAccessibility != null) return !!brief.requiresAccessibility;
  return isPublicBuilding(brief);
}

export function plotOf(brief) {
  const p = brief?.plot;
  return p && Array.isArray(p.boundary) && p.boundary.length >= 3 ? p : null;
}

/** Compass name of a plan direction. North is -Z, south +Z, east +X, west -X. */
export function compassOf(x, z) {
  if (Math.abs(x) >= Math.abs(z)) return x > 0 ? 'east' : 'west';
  return z > 0 ? 'south' : 'north';
}
