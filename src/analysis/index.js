// runAnalysis(model, brief) -> Report
//
// The deterministic evaluation engine. No randomness, no AI, no three.js.
//
// FIVE modules measure the model — access, daylight, cost, programme and the
// SITE (boundary, setbacks, storey and coverage limits, protected trees, and
// the direction the front door faces). The client puts every one of those in
// the brief in writing, so every one of them is measured. Each complaint
// carries the number that justifies it; mail.js turns the report into the
// client's e-mail.
//
//   Report = { score, accepted, issues: [Issue], metrics: {...} }
//   Issue  = { module, severity, code, roomId|wallId|furnitureId|openingId,
//              measured, required, unit, clientText }

import { buildTopology } from './topology.js';
import { classifyRooms } from './classify.js';
import { analyzeAccess } from './access.js';
import { analyzeDaylight } from './daylight.js';
import { analyzeCost } from './cost.js';
import { analyzeProgram } from './program.js';
import { analyzeSite } from './site.js';
import { sortIssues, scoreOf } from './issues.js';
import { revisionMail, acceptanceMail, clientMail } from './mail.js';

export { revisionMail, acceptanceMail, clientMail };

/** The score a first submission must clear to be signed off with majors outstanding. */
export const ACCEPT_SCORE = 50;
export { ISSUE_DEFS, SEVERITY_RANK, SEVERITY_WEIGHT } from './issues.js';
export { buildWalkGrid, walkableGrid } from './access.js';
export { solarPosition, sunVector, SUN_SAMPLES } from './daylight.js';
export { billOfQuantities, quantities } from './cost.js';
export { classifyRooms, ROOM_KINDS } from './classify.js';
export { buildTopology } from './topology.js';
export { analyzeSite, builtFootprint, entranceDirections } from './site.js';

export function runAnalysis(model, brief = {}) {
  const topo = buildTopology(model);
  const classes = classifyRooms(model, topo, brief);
  const ctx = { model, brief, topo, classes };

  const access = analyzeAccess(ctx);
  const daylight = analyzeDaylight(ctx);
  const cost = analyzeCost(ctx);
  const program = analyzeProgram(ctx);
  const site = analyzeSite(ctx);

  const issues = sortIssues([
    ...access.issues, ...daylight.issues, ...cost.issues,
    ...program.issues, ...site.issues,
  ]);
  const score = scoreOf(issues);
  // Acceptance turns on BLOCKERS alone. It used to need zero majors as well,
  // which meant a tight corridor or a dim bedroom could refuse a whole house —
  // exactly the "too demanding" Jurek reported. Majors still count against the
  // score, still appear in the letter, and still cost fee and reputation; they
  // just do not send the drawings back a second time.
  // ...but leniency needs a floor. The smoke's first submission scored 0/100
  // with thirteen majors and, under "blockers alone", came back ACCEPTED —
  // a client signing off a house he has thirteen serious complaints about.
  // So: no blockers, AND the score clears 50. A house under that comes back
  // once, with its three biggest points in plain words, which is the gentle
  // letter the contract asks for; a house over it is signed, majors and all,
  // and the fee settlement docks 3% per major instead of sending it back.
  const accepted = !issues.some(i => i.severity === 'blocker') && score >= ACCEPT_SCORE;

  return {
    score,
    accepted,
    issues,
    metrics: {
      modelVersion: model.version,
      rooms: topo.rooms.map(r => ({
        id: r.id,
        levelId: r.levelId,
        name: classes.get(r.id)?.label ?? null,
        kind: classes.get(r.id)?.key ?? null,
        habitable: classes.get(r.id)?.habitable ?? false,
        area: Math.round(r.area * 100) / 100,
        doors: r.doors.length,
        windows: r.windows.length,
      })),
      access: access.metrics,
      daylight: daylight.metrics,
      cost: cost.metrics,
      program: program.metrics,
      site: site.metrics,
      counts: {
        blockers: issues.filter(i => i.severity === 'blocker').length,
        majors: issues.filter(i => i.severity === 'major').length,
        minors: issues.filter(i => i.severity === 'minor').length,
      },
    },
  };
}

export default runAnalysis;
