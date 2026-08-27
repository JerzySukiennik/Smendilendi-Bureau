// Issue codes, severities and the client-voice sentence for each one.
// View-free. Deterministic: the same fields always produce the same sentence.
//
// Issue = {
//   module, severity, code,
//   roomId | wallId | furnitureId,
//   measured, required, unit,
//   clientText
// }

export const SEVERITIES = ['blocker', 'major', 'minor'];
export const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 };
export const SEVERITY_WEIGHT = { blocker: 25, major: 10, minor: 3 };

const m = (v, digits = 2) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '?';
  const f = Math.pow(10, digits);
  return (Math.round(v * f) / f).toFixed(digits);
};
const money = (v) => Math.round(v).toLocaleString('en-GB').replace(/,/g, ' ');
const pct = (v) => `${Math.round(v * 10) / 10}%`;

/**
 * Every entry: module, severity (string or a function of the context),
 * unit, and text(ctx) -> the sentence the client writes.
 * ctx always carries: room (display name), item (display name), measured,
 * required, plus whatever the module adds.
 */
export const ISSUE_DEFS = {
  // -- access --------------------------------------------------------------
  ACCESS_NO_ENTRANCE: {
    module: 'access', severity: 'blocker', unit: 'doors',
    text: (c) => `There is no way into the building — I count ${m(c.measured, 0)} doors in an external wall. Somewhere on the street side I need a front door.`,
  },
  ACCESS_ROOM_UNREACHABLE: {
    module: 'access', severity: 'blocker', unit: 'rooms',
    text: (c) => `I cannot get to the ${c.room} at all. Walking in from the front door and trying every opening, it is one of ${m(c.measured, 0)} rooms with no route to it.`,
  },
  ACCESS_ROOM_NO_DOOR: {
    module: 'access', severity: 'blocker', unit: 'doors',
    text: (c) => `The ${c.room} has no door — ${m(c.measured, 0)} openings in its walls. It is a sealed box of ${m(c.area, 1)} m².`,
  },
  ACCESS_WC_THROUGH_BEDROOM: {
    module: 'access', severity: 'major', unit: 'routes',
    text: (c) => `The only way to the ${c.room} is through the ${c.through}. Guests would have to walk through somebody's bedroom, and there is no second route.`,
  },
  ACCESS_ROUTE_BLOCKED: {
    module: 'access', severity: 'blocker', unit: 'm',
    text: (c) => `The ${c.room} has a door, but nothing can get through it — ${c.obstruction} leaves ${m(c.measured)} m of floor to walk on where I need ${m(c.required)} m. On the drawing the room may as well not be there.`,
  },
  ACCESS_CLEAR_WIDTH: {
    module: 'access', severity: 'major', unit: 'm',
    text: (c) => `The route to the ${c.room} narrows to ${m(c.measured)} m at its tightest point. I asked for ${m(c.required)} m clear — at ${m(c.measured)} m you cannot pass somebody carrying a box, let alone push a pram through.`,
  },
  ACCESS_TURNING_CIRCLE: {
    module: 'access', severity: 'major', unit: 'm',
    text: (c) => `A wheelchair needs a ${m(c.required)} m circle to turn. The widest clear spot in the ${c.room} measures ${m(c.measured)} m across, so once you are in there you cannot turn round.`,
  },
  ACCESS_ESCAPE_DISTANCE: {
    module: 'access', severity: 'major', unit: 'm',
    text: (c) => `From the far corner of the ${c.room} it is ${m(c.measured, 1)} m of walking to reach an external door. The limit here is ${m(c.required, 1)} m and the fire officer will measure it exactly the way I did.`,
  },
  ACCESS_DOOR_SWING_BLOCKED: {
    module: 'access', severity: 'major', unit: 'm',
    text: (c) => `The door to the ${c.room} cannot open — the ${c.item} sits ${m(c.measured)} m into its swing. The leaf is ${m(c.required)} m wide and needs that quarter circle clear.`,
  },
  ACCESS_DOOR_SWING_CLASH: {
    module: 'access', severity: 'minor', unit: 'm',
    text: (c) => `Two doors by the ${c.room} are hinged ${m(c.measured)} m apart and their leaves are ${m(c.leafA)} m and ${m(c.leafB)} m — open one and the other jams against it. Hang one the other way and it goes away.`,
  },

  // -- daylight ------------------------------------------------------------
  DAYLIGHT_RATIO_LOW: {
    module: 'daylight', severity: (c) => (c.measured > 0 && c.ratio <= c.requiredRatio * 1.4 ? 'minor' : 'major'),
    unit: 'm²/m²',
    text: (c) => `The ${c.room} is ${m(c.area, 1)} m² with ${m(c.measured)} m² of glass — that is 1:${m(c.ratio, 1)}. I need 1:${m(c.requiredRatio, 0)} here, so roughly ${m(c.deficit)} m² more window.`,
  },
  DAYLIGHT_NO_GLAZING: {
    module: 'daylight', severity: 'blocker', unit: 'm²',
    text: (c) => `The ${c.room} has no window at all. ${m(c.area, 1)} m² of habitable floor with ${m(c.measured)} m² of glass is not a room, it is a cupboard.`,
  },
  DAYLIGHT_NO_SUN: {
    module: 'daylight', severity: 'major', unit: '%',
    text: (c) => `I checked the ${c.room} at 09:00, 12:00 and 16:00 on both 21 March and 21 December: ${pct(c.measured)} of the floor sees direct sun at any of them. ${c.cause}`,
  },
  DAYLIGHT_WINTER_DARK: {
    module: 'daylight', severity: 'minor', unit: '%',
    text: (c) => `On 21 December the ${c.room} gets sun on ${pct(c.measured)} of its floor at midday. I would like at least ${pct(c.required)} in a room people sit in all winter.`,
  },

  // -- cost ----------------------------------------------------------------
  COST_OVER_BUDGET: {
    module: 'cost', severity: (c) => (c.overrunPct > 15 ? 'blocker' : c.overrunPct > 5 ? 'major' : 'minor'),
    unit: 'units',
    text: (c) => `The bill comes to ${money(c.measured)} against a budget of ${money(c.required)} — ${pct(c.overrunPct)} over, ${money(c.measured - c.required)} I do not have. The biggest line is ${c.topTrade} at ${money(c.topTradeTotal)}.`,
  },
  COST_UNDER_SPENT: {
    module: 'cost', severity: 'minor', unit: 'units',
    text: (c) => `You have used ${money(c.measured)} of ${money(c.required)} — ${pct(c.underPct)} of the budget is still sitting there. If you can spend it on the building rather than hand it back, please do.`,
  },

  // -- the site ------------------------------------------------------------
  // Raised by site.js. They carry module 'program' (compliance with what the
  // brief put in writing) or 'access' (the entrance), so the Report interface
  // is unchanged and the e-mail sorts them with everything else.
  SITE_OUTSIDE_BOUNDARY: {
    module: 'program', severity: 'blocker', unit: 'm',
    text: (c) => `The building crosses my boundary by ${m(c.measured)} m. That is not my land, and no amount of drawing will make it mine.`,
  },
  SITE_SETBACK_BREACH: {
    module: 'program', severity: 'blocker', unit: 'm',
    text: (c) => `The building sits ${m(c.measured)} m over the buildable line. The setbacks are ${m(c.front, 1)} m front, ${m(c.side, 1)} m side and ${m(c.rear, 1)} m rear, and the planning office measures them the same way I do.`,
  },
  SITE_TOO_MANY_FLOORS: {
    module: 'program', severity: 'blocker', unit: 'storeys',
    text: (c) => `You have drawn ${m(c.measured, 0)} storeys above ground. The local plan allows ${m(c.required, 0)}.`,
  },
  SITE_COVERAGE: {
    module: 'program', severity: 'major', unit: '%',
    text: (c) => `The footprint covers ${pct(c.measured)} of the plot — ${m(c.footprint, 0)} m² of ${m(c.plotArea, 0)} m². The limit is ${pct(c.required)}.`,
  },
  SITE_GREEN_AREA: {
    module: 'program', severity: 'major', unit: '%',
    text: (c) => `Only ${pct(c.measured)} of the plot is left unbuilt where the local plan wants ${pct(c.required)} planted. The garden is not a leftover.`,
  },
  SITE_PROTECTED_TREE: {
    module: 'program', severity: 'major', unit: 'm',
    text: (c) => `A wall runs ${m(c.measured)} m inside the crown of the protected ${c.species} — its radius on the survey is ${m(c.radius, 1)} m. That tree was here before either of us.`,
  },
  SITE_ENTRANCE_OFF_STREET: {
    module: 'access', severity: 'major', unit: 'doors',
    text: (c) => `Not one of the ${m(c.doors, 0)} external doors faces the street. The main one opens ${c.facing}, and the street is to the ${c.street}.`,
  },

  // -- program -------------------------------------------------------------
  PROGRAM_ROOM_MISSING: {
    module: 'program', severity: 'blocker', unit: 'rooms',
    text: (c) => `I asked for ${m(c.required, 0)} × ${c.item} and I can find ${m(c.measured, 0)}. That is the whole point of the commission.`,
  },
  PROGRAM_ROOM_UNDERSIZED: {
    module: 'program', severity: (c) => (c.measured < c.required * 0.8 ? 'major' : 'minor'),
    unit: 'm²',
    text: (c) => `The ${c.room} is ${m(c.measured, 1)} m². The brief says ${m(c.required, 1)} m² — you are ${m(c.required - c.measured, 1)} m² short.`,
  },
  PROGRAM_TAG_MISSING: {
    module: 'program', severity: 'minor', unit: 'items',
    text: (c) => `The ${c.room} has no ${c.item}. I know it is furniture rather than architecture, but I need to see where it goes.`,
  },
  PROGRAM_ADJACENCY_MISSING: {
    module: 'program', severity: 'major', unit: 'doors',
    text: (c) => `The ${c.room} does not open onto the ${c.item} — the shortest way between them is ${m(c.measured, 0)} rooms. They have to be next to each other.`,
  },
  PROGRAM_CEILING_LOW: {
    module: 'program', severity: 'major', unit: 'm',
    text: (c) => `${c.room} at ${m(c.measured)} m floor to ceiling. Habitable rooms want ${m(c.required)} m; anything less feels like a basement and will not pass.`,
  },
  ERGO_CLEARANCE_BLOCKED: {
    module: 'program', severity: (c) => (c.measured < c.required * 0.5 ? 'major' : 'minor'),
    unit: 'm',
    text: (c) => `In the ${c.room} there is ${m(c.measured)} m of space ${c.where} the ${c.item}; it needs ${m(c.required)} m. As drawn you cannot ${c.verb}.`,
  },
  ERGO_KITCHEN_TRIANGLE: {
    module: 'program', severity: 'minor', unit: 'm',
    text: (c) => `The work triangle in the ${c.room} — sink to hob to fridge — measures ${m(c.measured, 1)} m. It wants to sit between ${m(c.min, 1)} and ${m(c.max, 1)} m; ${c.direction}.`,
  },
};

/**
 * Build an Issue. `code` must exist in ISSUE_DEFS.
 * ctx supplies the numbers; `target` is { roomId } | { wallId } | { furnitureId }.
 */
export function makeIssue(code, ctx = {}, target = {}) {
  const def = ISSUE_DEFS[code];
  if (!def) throw new Error(`unknown issue code: ${code}`);
  const severity = typeof def.severity === 'function' ? def.severity(ctx) : def.severity;
  const round4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : (v ?? null));
  const issue = {
    module: def.module,
    severity,
    code,
    measured: round4(ctx.measured),
    required: round4(ctx.required),
    unit: def.unit,
    clientText: def.text(ctx),
  };
  if (target.roomId) issue.roomId = target.roomId;
  if (target.wallId) issue.wallId = target.wallId;
  if (target.furnitureId) issue.furnitureId = target.furnitureId;
  if (target.openingId) issue.openingId = target.openingId;
  return issue;
}

/** Stable sort: blockers first, then module, then code, then the text. */
export function sortIssues(issues) {
  return [...issues].sort((a, b) => (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.module.localeCompare(b.module)
    || a.code.localeCompare(b.code)
    || String(a.roomId ?? a.furnitureId ?? '').localeCompare(String(b.roomId ?? b.furnitureId ?? ''))
    || a.clientText.localeCompare(b.clientText)
  ));
}

export function scoreOf(issues) {
  let score = 100;
  for (const i of issues) score -= SEVERITY_WEIGHT[i.severity] ?? 0;
  return Math.max(0, Math.round(score));
}
