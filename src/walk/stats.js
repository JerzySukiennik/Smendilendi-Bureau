// stats.js — the post-occupancy evaluation.
//
// A POE is what a practice does a year or two after handover: go back, watch
// the building being used, and write down what the drawing got right and what
// it got wrong. That is exactly what thirty years of simulated occupancy
// produces here, so it is presented as a POE and not as a score screen. Every
// line carries a MEASURED figure and, where one exists, the benchmark it is
// measured against.
//
// The benchmarks used, and where they come from:
//   corridor / route clear width      1.20 m public, 0.90 m dwelling
//                                     (the same two constants the access
//                                     module writes the client's e-mail from)
//   two people passing                1.20 m — below this they turn sideways
//   travel distance to a WC           75 m in a workplace (WT §84); not
//                                     applicable in a dwelling
//   door leaf clear width             0.90 m for an accessible route
//
// Nothing here invents a number. Cost and the verdict come from the analysis
// report; widths come from the navmesh's distance transform; distances come
// from the routes the simulated people actually walked.

import { PASSING_WIDTH, PERSON_WIDTH } from './navmesh.js';
import { GOALS } from './roles.js';

export const WC_TRAVEL_LIMIT = 75.0;      // m, workplace
export const WIDTH_PUBLIC = 1.20;
export const WIDTH_DWELLING = 0.90;

const DWELLING = new Set(['house', 'apartment']);

/** The item of `it` with the highest score, or null. */
function rank(it, score) {
  let best = null, bs = -Infinity;
  for (const x of it) { const s = score(x); if (s > bs) { bs = s; best = x; } }
  return best;
}

export class Stats {
  constructor(nav, { typeKey = 'office', years = 30 } = {}) {
    this.nav = nav;
    this.typeKey = typeKey;
    this.years = years;
    this.dwelling = DWELLING.has(typeKey);
    this.requiredWidth = this.dwelling ? WIDTH_DWELLING : WIDTH_PUBLIC;

    this.journeys = 0;
    this.completed = 0;
    this.failed = 0;
    this.failedNoRoute = 0;
    this.failedNoRoom = 0;
    this.distance = 0;                    // m, completed journeys only
    this.byGoal = new Map();              // goalKey -> { n, fail, dist, worstWidth }
    this.roomSeconds = new Map();         // roomId -> person-seconds
    this.roomVisits = new Map();          // roomId -> arrivals
    this.doorUses = new Map();            // openingId -> count
    this.pinch = new Map();               // cell -> { width, uses, x, z, level, roomId, openingId }
    this.squeeze = new Map();             // cell -> { n, width, x, z, level }
    this.annoyed = [];                    // the visible failures, in order
    this.simSeconds = 0;                  // simulated occupancy seconds
    this.realSeconds = 0;                 // wall-clock seconds of the walk
  }

  // -- collection ----------------------------------------------------------

  goalBucket(goal) {
    let b = this.byGoal.get(goal);
    if (!b) { b = { n: 0, fail: 0, dist: 0, worstWidth: Infinity, maxDist: 0 }; this.byGoal.set(goal, b); }
    return b;
  }

  journeyStarted(goal) {
    this.journeys++;
    this.goalBucket(goal).n++;
  }

  /** A journey that arrived. `route` is the navmesh path that was walked. */
  journeyDone(goal, route) {
    this.completed++;
    const b = this.goalBucket(goal);
    const d = route?.length ?? 0;
    this.distance += d;
    b.dist += d;
    if (d > b.maxDist) b.maxDist = d;
    if (route && route.minWidth < b.worstWidth) b.worstWidth = route.minWidth;
    if (route) this.recordPinch(route);
    for (const oid of route?.doors ?? []) {
      this.doorUses.set(oid, (this.doorUses.get(oid) ?? 0) + 1);
    }
  }

  /**
   * A journey that could not happen. `reason` is either 'no-route' (the room
   * exists but nothing connects to it, or the gap is under 0.55 m) or
   * 'no-room' (the building has no room of that kind at all).
   */
  journeyFailed(goal, reason, person, where) {
    this.failed++;
    this.goalBucket(goal).fail++;
    if (reason === 'no-room') this.failedNoRoom++; else this.failedNoRoute++;
    if (this.annoyed.length < 400) {
      this.annoyed.push({
        goal, reason,
        role: person?.label ?? 'Someone',
        personId: person?.id ?? null,
        x: where?.x ?? 0, z: where?.z ?? 0, level: where?.level ?? 0,
        hour: where?.hour ?? null,
      });
    }
  }

  /** The narrowest cell of a walked route, counted once per journey. */
  recordPinch(route) {
    if (!route?.cells?.length) return;
    let best = -1, bw = Infinity;
    const widths = route.widths;
    for (let i = 0; i < route.cells.length; i++) {
      const w = widths ? widths[i] : this.nav.width[route.cells[i]];
      if (w < bw) { bw = w; best = route.cells[i]; }
    }
    if (best < 0) return;
    let p = this.pinch.get(best);
    if (!p) {
      const w = this.nav.centreOf(best);
      const ri = this.nav.roomIdx[best], di = this.nav.doorIdx[best];
      p = {
        width: bw, uses: 0, x: w.x, z: w.z, level: w.level,
        roomId: ri >= 0 ? this.nav.roomIds[ri] : null,
        openingId: di >= 0 ? this.nav.doorIds[di] : null,
      };
      this.pinch.set(best, p);
    }
    p.uses++;
  }

  /** Two people in the same place where only one fits. */
  recordSqueeze(cell, x, z, level, width) {
    let s = this.squeeze.get(cell);
    if (!s) { s = { n: 0, width, x, z, level }; this.squeeze.set(cell, s); }
    s.n++;
  }

  /** Someone stood in a room for dt seconds. */
  occupy(roomId, dt) {
    if (!roomId) return;
    this.roomSeconds.set(roomId, (this.roomSeconds.get(roomId) ?? 0) + dt);
  }

  visit(roomId) {
    if (!roomId) return;
    this.roomVisits.set(roomId, (this.roomVisits.get(roomId) ?? 0) + 1);
  }

  // -- the report ----------------------------------------------------------

  /** Person-hours per square metre — the honest density figure. */
  densityOf(roomId) {
    const area = this.nav.areaOf(roomId) || 1;
    return (this.roomSeconds.get(roomId) ?? 0) / 3600 / area;
  }

  busiestRoom() {
    let best = null, bv = -1;
    for (const id of this.nav.roomIds) {
      const v = this.densityOf(id);
      if (v > bv) { bv = v; best = id; }
    }
    return best ? { id: best, label: this.nav.labelOf(best), value: bv, area: this.nav.areaOf(best), seconds: this.roomSeconds.get(best) ?? 0 } : null;
  }

  deadestRoom() {
    // Circulation is meant to be empty; judging a corridor as "dead space" is a
    // category error, so it is excluded. So is anything with no floor area.
    const skip = new Set(['corridor', 'stair', 'hall']);
    let best = null, bv = Infinity;
    for (const id of this.nav.roomIds) {
      if (skip.has(this.nav.kindOf(id))) continue;
      if (this.nav.areaOf(id) < 1.5) continue;
      const v = this.densityOf(id);
      if (v < bv) { bv = v; best = id; }
    }
    return best ? { id: best, label: this.nav.labelOf(best), value: bv, area: this.nav.areaOf(best), seconds: this.roomSeconds.get(best) ?? 0 } : null;
  }

  _describePinch(p) {
    if (!p) return null;
    return {
      ...p,
      label: p.openingId
        ? `doorway ${p.openingId}`
        : (p.roomId ? this.nav.labelOf(p.roomId) : 'route'),
      required: this.requiredWidth,
      passes: p.width >= this.requiredWidth,
      canPass: p.width >= PASSING_WIDTH,
    };
  }

  /**
   * The BUSIEST narrow place: ranked by how many journeys go through it,
   * weighted by how far under the standard it is. It answers "where is the
   * circulation problem people actually meet", and it is emphatically not the
   * narrowest point — reporting it as one told an architect his narrowest route
   * passed at 900 mm while 164 journeys were going through an 800 mm door.
   */
  worstPinch() { return this._describePinch(rank(this.pinch.values(), (p) => p.uses * (1 + Math.max(0, this.requiredWidth - p.width) * 8))); }

  /** The narrowest place anybody actually walked through. A minimum, not a rank. */
  narrowestPinch() { return this._describePinch(rank(this.pinch.values(), (p) => -p.width)); }

  wcTravel() {
    const b = this.byGoal.get('wc');
    if (!b || !b.n) return null;
    const done = b.n - b.fail;
    // Nobody got there. An average over zero journeys is 0.0 m, which reads on
    // the sheet as the best possible result for the worst possible building —
    // so it has to be the "nobody could find one" row instead.
    if (done <= 0) return null;
    return {
      average: b.dist / done,
      max: b.maxDist,
      journeys: b.n,
      failed: b.fail,
      limit: this.dwelling ? null : WC_TRAVEL_LIMIT,
    };
  }

  busiestDoor() {
    let best = null, bn = -1;
    for (const [oid, n] of this.doorUses) if (n > bn) { bn = n; best = oid; }
    if (!best) return null;
    const o = this.nav.model.openings[best];
    return { openingId: best, uses: bn, width: o?.width ?? 0 };
  }

  /** Journeys per simulated year, scaled from the sample that was walked. */
  summary() {
    const wc = this.wcTravel();
    const pinch = this.worstPinch();
    const narrow = this.narrowestPinch();
    const busy = this.busiestRoom();
    const dead = this.deadestRoom();
    return {
      journeys: this.journeys,
      completed: this.completed,
      failed: this.failed,
      failedNoRoute: this.failedNoRoute,
      failedNoRoom: this.failedNoRoom,
      successRate: this.journeys ? this.completed / this.journeys : 1,
      averageDistance: this.completed ? this.distance / this.completed : 0,
      totalDistance: this.distance,
      wc, pinch, narrow, busy, dead,
      door: this.busiestDoor(),
      squeezes: [...this.squeeze.values()].reduce((s, x) => s + x.n, 0),
      worstSqueeze: [...this.squeeze.values()].sort((a, b) => b.n - a.n)[0] ?? null,
      annoyed: this.annoyed.length,
      requiredWidth: this.requiredWidth,
      dwelling: this.dwelling,
    };
  }
}

// ---------------------------------------------------------------------------
// the sheet

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const money = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-GB').replace(/,/g, ' ') : '—');

function row(label, measured, benchmark, verdict) {
  const tr = document.createElement('tr');
  if (verdict) tr.className = `poe-${verdict}`;
  tr.innerHTML = `<td class="poe-label"></td><td class="poe-measured"></td><td class="poe-bench"></td>`;
  tr.children[0].textContent = label;
  tr.children[1].textContent = measured;
  tr.children[2].textContent = benchmark ?? '';
  return tr;
}

/**
 * renderReport(stats, { analysis, commission, heatCanvas }) -> HTMLElement
 *
 * The finished evaluation: the client's verdict at the top in his own words,
 * the money, the measured circulation performance, and the plan with the heat
 * on it. Laid out like a report page, because that is what it is.
 */
export function renderReport(stats, { analysis = null, commission = null, heatCanvas = null, years = 30 } = {}) {
  const s = stats.summary();
  const root = document.createElement('div');
  root.className = 'walk-report';

  const client = commission?.client?.name ?? 'The client';
  const accepted = analysis?.accepted !== false;
  const score = analysis?.score;

  const head = document.createElement('header');
  head.className = 'poe-head';
  head.innerHTML = `
    <div class="poe-kicker">Post-occupancy evaluation &middot; ${years} years after handover</div>
    <h1></h1>
    <div class="poe-sub"></div>`;
  head.querySelector('h1').textContent = commission?.title ?? 'The building';
  head.querySelector('.poe-sub').textContent =
    `${commission?.address ?? ''}${commission?.address ? ' · ' : ''}${commission?.typeName ?? ''}`;
  root.appendChild(head);

  // -- the verdict ---------------------------------------------------------
  const verdict = document.createElement('section');
  verdict.className = `poe-verdict ${accepted ? 'ok' : 'bad'}`;
  const issues = (analysis?.issues ?? []).slice(0, 3);
  const line = accepted
    ? `${client} accepted the scheme.`
    : `${client} signed it off under protest.`;
  verdict.innerHTML = `<h2>The client's verdict</h2><p class="poe-quote"></p><ul class="poe-issues"></ul>`;
  verdict.querySelector('.poe-quote').textContent =
    `“${line}${score != null ? ` It scored ${Math.round(score)} out of 100 on the practice's own check.` : ''}”`;
  const ul = verdict.querySelector('.poe-issues');
  for (const i of issues) {
    const li = document.createElement('li');
    li.className = `sev-${i.severity}`;
    li.textContent = i.clientText || i.code;
    ul.appendChild(li);
  }
  if (!issues.length) {
    const li = document.createElement('li');
    li.className = 'sev-none';
    li.textContent = 'Nothing outstanding at handover.';
    ul.appendChild(li);
  }
  root.appendChild(verdict);

  // -- the money -----------------------------------------------------------
  const cost = analysis?.metrics?.cost ?? null;
  const budget = commission?.budget ?? cost?.budget ?? null;
  const built = cost?.total ?? cost?.cost ?? null;
  const cards = document.createElement('section');
  cards.className = 'poe-cards';
  const card = (k, v, sub, tone) => {
    const d = document.createElement('div');
    d.className = `poe-card${tone ? ' ' + tone : ''}`;
    d.innerHTML = '<div class="k"></div><div class="v"></div><div class="s"></div>';
    d.children[0].textContent = k;
    d.children[1].textContent = v;
    d.children[2].textContent = sub ?? '';
    return d;
  };
  cards.appendChild(card('Construction cost', built != null ? money(built) : '—',
    budget != null ? `budget ${money(budget)}` : '',
    built != null && budget != null ? (built <= budget ? 'good' : 'bad') : ''));
  cards.appendChild(card('Journeys walked', String(s.journeys),
    `${s.completed} arrived · ${s.failed} gave up`,
    s.failed === 0 ? 'good' : (s.failed / Math.max(1, s.journeys) > 0.05 ? 'bad' : 'warn')));
  cards.appendChild(card('Average journey', `${fmt(s.averageDistance)} m`,
    `${fmt(s.totalDistance / 1000, 2)} km walked in total`));
  cards.appendChild(card('Narrowest route', `${fmt(s.narrow?.width ?? NaN, 2)} m`,
    s.narrow ? `at the ${s.narrow.label}` : '',
    s.narrow ? (s.narrow.passes ? 'good' : 'bad') : ''));
  root.appendChild(cards);

  // -- the measured table --------------------------------------------------
  const tableWrap = document.createElement('section');
  tableWrap.className = 'poe-table-wrap';
  tableWrap.innerHTML = `<h2>What the building did</h2>
    <table class="poe-table"><thead><tr>
      <th>Observation</th><th>Measured</th><th>Benchmark</th>
    </tr></thead><tbody></tbody></table>`;
  const tb = tableWrap.querySelector('tbody');

  tb.appendChild(row('Journeys completed',
    `${s.completed} of ${s.journeys} (${Math.round(s.successRate * 100)} %)`,
    '100 %', s.failed === 0 ? 'good' : 'bad'));

  if (s.failedNoRoute) {
    tb.appendChild(row('Journeys with no route at all',
      `${s.failedNoRoute}`, `0 — every room reachable`, 'bad'));
  }
  if (s.failedNoRoom) {
    tb.appendChild(row('Journeys with no room to go to',
      `${s.failedNoRoom}`, 'the brief lists the room', 'bad'));
  }

  if (s.wc) {
    tb.appendChild(row('Average walk to a WC',
      `${fmt(s.wc.average)} m (worst ${fmt(s.wc.max)} m)`,
      s.wc.limit ? `${s.wc.limit.toFixed(0)} m max, WT §84` : 'no statutory limit in a dwelling',
      s.wc.limit ? (s.wc.max <= s.wc.limit ? 'good' : 'bad') : null));
  } else {
    tb.appendChild(row('Average walk to a WC', 'nobody could find one', 'a WC on every occupied level', 'bad'));
  }

  if (s.narrow) {
    tb.appendChild(row(`Narrowest route walked — ${s.narrow.label}`,
      `${(s.narrow.width * 1000).toFixed(0)} mm clear, used by ${s.narrow.uses} journeys`,
      `${(s.narrow.required * 1000).toFixed(0)} mm`,
      s.narrow.passes ? 'good' : 'bad'));
  }
  if (s.pinch && !(s.narrow && s.pinch.x === s.narrow.x && s.pinch.z === s.narrow.z)) {
    tb.appendChild(row(`Busiest narrow point — ${s.pinch.label}`,
      `${(s.pinch.width * 1000).toFixed(0)} mm clear, used by ${s.pinch.uses} journeys`,
      `${(s.pinch.required * 1000).toFixed(0)} mm`,
      s.pinch.passes ? 'good' : 'bad'));
  }

  if (s.worstSqueeze) {
    tb.appendChild(row('Busiest place two people had to squeeze past each other',
      `${(s.worstSqueeze.width * 1000).toFixed(0)} mm clear, ${s.worstSqueeze.n} times`,
      `${(PASSING_WIDTH * 1000).toFixed(0)} mm to pass without turning`,
      s.worstSqueeze.width >= PASSING_WIDTH ? 'good' : 'warn'));
  }

  if (s.busy) {
    tb.appendChild(row(`Busiest room — ${s.busy.label}`,
      `${fmt(s.busy.value, 2)} person-hours per m² (${fmt(s.busy.area)} m²)`, ''));
  }
  if (s.dead) {
    tb.appendChild(row(`Least-used room — ${s.dead.label}`,
      `${fmt(s.dead.value, 2)} person-hours per m² (${fmt(s.dead.area)} m²)`,
      s.dead.value < 0.01 ? 'never entered' : '', s.dead.value < 0.01 ? 'warn' : null));
  }
  if (s.door) {
    tb.appendChild(row('Busiest door',
      `${(s.door.width * 1000).toFixed(0)} mm leaf, ${s.door.uses} passages`,
      '900 mm for an accessible route',
      s.door.width >= 0.90 ? 'good' : 'warn'));
  }
  tb.appendChild(row('Shoulder width assumed for a passage',
    `${(PERSON_WIDTH * 1000).toFixed(0)} mm`, 'adult in outdoor clothing'));

  root.appendChild(tableWrap);

  // -- what people gave up on ---------------------------------------------
  if (stats.annoyed.length) {
    const sec = document.createElement('section');
    sec.className = 'poe-fails';
    sec.innerHTML = '<h2>Where people gave up</h2><ul></ul>';
    const list = sec.querySelector('ul');
    const grouped = new Map();
    for (const a of stats.annoyed) {
      const key = `${a.role}|${a.goal}|${a.reason}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [key, n] of [...grouped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      const [role, goal, reason] = key.split('|');
      const li = document.createElement('li');
      const g = GOALS[goal];
      li.textContent = reason === 'no-room'
        ? `${role} wanted somewhere to go — ${g ? g.label : goal} — and this building has no such room. ${n}×`
        : `${role} ${g ? g.label : goal} and could not get there from where they were standing. ${n}×`;
      list.appendChild(li);
    }
    root.appendChild(sec);
  }

  // -- the plan ------------------------------------------------------------
  if (heatCanvas) {
    const sec = document.createElement('section');
    sec.className = 'poe-plan';
    sec.appendChild(heatCanvas);
    root.appendChild(sec);
  }

  return root;
}
