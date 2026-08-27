// Procedural commissions: the brief, the client, the plot.
// View-free: no imports outside this directory. Must import in bare node.
//
//   generateCommission(seed, difficulty, history) -> Commission
//
// `difficulty` is 0..1 (a 1..5 value is accepted and rescaled). `history` is an
// array of previously generated commissions; it is used to avoid repeating a
// building type or a client three times in a row. Same seed + difficulty +
// history length -> byte identical commission (JSON.stringify equal).

import { BUILDING_TYPES, TYPE_KEYS, programArea, constraintsFor } from './types.js';
import { PERSONAS, VOICE, personasForType } from './clients.js';
import { pickPersonName, pickCompany, pickAddress, pickTradeName, pick } from './names.js';
import {
  generatePlot, describePlot, buildableArea, insideBuildableArea,
  distanceToBoundary, polygonArea, pointInPolygon,
} from './plot.js';

export {
  BUILDING_TYPES, TYPE_KEYS, programArea,
  generatePlot, buildableArea, insideBuildableArea, distanceToBoundary,
  polygonArea, pointInPolygon, PERSONAS,
};

// ---------------------------------------------------------------------------
// deterministic PRNG — mulberry32 seeded through an fnv-1a string hash

export function hashSeed(seed) {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  let t = a >>> 0;
  return function rng() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// small helpers

const lerp = (a, b, t) => a + (b - a) * t;
const roundTo = (v, step) => Math.round(v / step) * step;
const money = n => n.toLocaleString('en-GB').replace(/,/g, ' ');
const words = s => (s.trim().match(/\S+/g) || []).length;

function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function fill(str, vars) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function lower(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// the brief e-mail

function writeBrief(ctx) {
  const { type, params, program, plot, client, vars, rng } = ctx;
  const bank = VOICE[client.tone] || VOICE.warm;

  const heroes = program.filter(r => r.hero && r.phrase).map(r => r.phrase);
  const rest = program.filter(r => !r.hero && r.key !== 'cleaner').slice(0, 12);

  const lead = pick(rng, bank.programLead);
  const programSentence = `${lead} ${joinList(heroes)}.`;

  // pick three ancillary rooms for a second, quieter programme sentence
  const secondaryPicks = [];
  const pool = rest.slice();
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length) % pool.length;
    secondaryPicks.push(lower(pool.splice(idx, 1)[0].name));
  }
  const secondarySentence = secondaryPicks.length
    ? `On top of that it has to find room for ${joinList(secondaryPicks.map(n => `a ${n}`))}.`
    : '';

  const plotSentence = `The plot runs to ${Math.round(plot.area)} m2 and is ${describePlot(plot)}; once the setbacks are taken off there is about ${Math.round(plot.buildableArea)} m2 left to build on.`;
  const siteSentence = fill(pick(rng, bank.site), vars);
  const introSentence = fill(pick(rng, bank.intro), vars);
  const moneySentence = fill(pick(rng, bank.money), vars);
  const closeSentence = pick(rng, bank.close);

  // optional colour, added only if the letter is running short
  const optional = [];
  const protectedTrees = plot.trees.filter(t => t.protected);
  if (protectedTrees.length) {
    optional.push(`There ${protectedTrees.length === 1 ? 'is one protected tree' : `are ${protectedTrees.length} protected trees`} on the survey and the conservation officer has already told me they are staying.`);
  }
  if (plot.terrain.kind === 'slope') {
    optional.push(`The ground falls about ${plot.fallAcrossSite} m towards the ${plot.terrain.slopeDirName}, which I am told is either a problem or an opportunity depending on who I ask.`);
  }
  const tall = plot.neighbours.filter(n => n.storeys >= 3)
    .sort((a, b) => b.height - a.height)[0];
  if (tall) {
    const side = (tall.name.match(/to the (\w+)$/) || [, 'boundary'])[1];
    optional.push(`I should warn you about the ${side} boundary: our neighbours put up a ${tall.storeys}-storey block ${tall.height} m high, and it takes a good deal of the sun with it.`);
  }
  if (secondarySentence) optional.push(secondarySentence);
  if (plot.streetSides.length > 1) {
    optional.push(`It is a corner plot, so it has two public faces and no back of house to hide behind.`);
  }

  // assemble, then tune the length into the 120-220 word window
  const build = (extras) => {
    const p1 = [introSentence, plotSentence, siteSentence, ...extras.filter(e => e !== secondarySentence)];
    const p2 = [programSentence, ...(extras.includes(secondarySentence) ? [secondarySentence] : [])];
    const p3 = [moneySentence];
    const p4 = [client.quirkLine, closeSentence];
    const sig = `${client.sign}\n${client.name}${client.company ? `\n${client.company}` : ''}`;
    return [client.greet, p1.join(' '), p2.join(' '), p3.join(' '), p4.join(' '), sig].join('\n\n');
  };

  let extras = [];
  let text = build(extras);
  for (let i = 0; i < optional.length && words(text) < 130; i++) {
    extras = optional.slice(0, i + 1);
    text = build(extras);
  }
  // too long: drop extras from the back, then shorten the hero list
  while (words(text) > 218 && extras.length) {
    extras = extras.slice(0, -1);
    text = build(extras);
  }
  if (words(text) > 218 && heroes.length > 3) {
    const trimmed = heroes.slice(0, Math.max(3, heroes.length - 2));
    const shorter = `${lead} ${joinList(trimmed)}.`;
    text = text.replace(programSentence, shorter);
  }
  return text;
}

// ---------------------------------------------------------------------------

function chooseType(rng, history) {
  const recent = history.slice(-3).map(c => c.type);
  const pool = TYPE_KEYS.filter(k => !recent.includes(k));
  const from = pool.length ? pool : TYPE_KEYS;
  return BUILDING_TYPES[from[Math.floor(rng() * from.length) % from.length]];
}

function chooseClient(rng, typeKey, history) {
  const usedIds = history.slice(-6).map(c => c.client && c.client.personaId);
  const usedNames = history.map(c => c.client && c.client.name).filter(Boolean);
  const fits = personasForType(typeKey);
  const fresh = fits.filter(p => !usedIds.includes(p.id));
  const pool = fresh.length ? fresh : fits;
  const persona = pool[Math.floor(rng() * pool.length) % pool.length];
  const wantsCompany = persona.company === 'always'
    || (persona.company === 'maybe' && rng() < 0.55);
  return {
    personaId: persona.id,
    name: pickPersonName(rng, usedNames),
    company: wantsCompany ? pickCompany(rng, typeKey) : null,
    tone: persona.tone,
    quirk: persona.quirk,
    quirkLine: persona.quirkLine,
    greet: persona.greet,
    sign: persona.sign,
    avatarSeed: Math.floor(rng() * 0xFFFFFF),
  };
}

function titleFor(rng, type, params, client, address) {
  const street = address.split(' ')[0];
  const surname = client.name.split(' ')[1];
  const trade = pickTradeName(rng, type.key);
  switch (type.key) {
    case 'house':
      return `House for ${surname} on ${street}`;
    case 'apartment':
      return `${trade}: ${params.units} flats on ${street}`;
    case 'office':
      return `${trade} — offices for ${params.staff} on ${street}`;
    case 'kindergarten':
      return `${trade} — kindergarten for ${params.children} children`;
    case 'clinic':
      return `${trade} — ${params.rooms}-room clinic on ${street}`;
    case 'library':
      return `${trade} — branch library on ${street}`;
    case 'cafe':
      return `${trade} — ${params.seats}-cover cafe on ${street}`;
    default:
      return `${trade} — shop on ${street}`;
  }
}

/**
 * @param {string|number} seed
 * @param {number} difficulty 0..1 (or 1..5)
 * @param {Array} history previously generated commissions
 * @returns {object} Commission
 */
export function generateCommission(seed, difficulty = 0.5, history = []) {
  let d = Number(difficulty);
  if (!Number.isFinite(d)) d = 0.5;
  if (d > 1) d = (d - 1) / 4;                 // accept a 1..5 scale
  d = Math.min(1, Math.max(0, d));

  const h = hashSeed(`${seed}|${d.toFixed(3)}|${history.length}`);
  const rng = mulberry32(h);

  const type = chooseType(rng, history);
  const params = type.params(rng, d);
  params.storeys = Math.min(params.storeys, type.maxFloors);

  const program = type.program(params);
  const netArea = programArea(program);
  const grossArea = Math.round(netArea * type.grossFactor);
  const footprint = Math.round(grossArea / params.storeys);

  const client = chooseClient(rng, type.key, history);
  const address = pickAddress(rng);
  // A site the brief cannot legally accommodate is a bug, not a challenge:
  // size it for the coverage limit, the planted-area limit and, for a
  // kindergarten, the 10 m2 of outdoor play area per child.
  const outdoorNeed = type.key === 'kindergarten' ? params.children * 10 : 0;
  const minPlotArea = Math.max(
    footprint / type.maxCoverage,
    type.greenArea ? footprint / (1 - type.greenArea) : 0,
    footprint + outdoorNeed + 120,
  );
  const plot = generatePlot(rng, {
    difficulty: d, targetFootprint: footprint, minPlotArea, typeKey: type.key,
  });
  plot.address = address;

  // ---- money -----------------------------------------------------------
  const siteWorks = Math.round(plot.area * 45
    + (plot.terrain.kind === 'slope' ? plot.area * 55 * (plot.terrain.slopePercent / 10) : 0)
    + plot.trees.filter(t => t.protected).length * 4000);
  const fairCost = grossArea * type.unitCost + siteWorks;
  const tightness = lerp(1.26, 0.95, d);
  const budget = roundTo(fairCost * tightness, 5000);
  const feeRate = lerp(type.feeRate[0], type.feeRate[1], d);
  const fee = roundTo(budget * feeRate, 500);
  const deadlineDays = Math.max(6, Math.round(type.deadlineBase * lerp(1.15, 0.72, d)));

  // ---- constraints -----------------------------------------------------
  const constraints = constraintsFor(type, params);
  if (plot.terrain.kind === 'slope') {
    constraints.push({
      code: 'SLOPE_EARTHWORKS',
      check: 'plot.terrainCut',
      text: `The ground falls ${plot.fallAcrossSite} m across the site towards the ${plot.terrain.slopeDirName} at ${plot.terrain.slopePercent} %; cut and fill are costed, and the finished floor must sit within 1.20 m of existing ground at the entrance.`,
      limit: 1.20,
    });
  }
  if (plot.streetSides.length > 1) {
    constraints.push({
      code: 'CORNER_FRONTAGE',
      check: 'plot.cornerFrontage',
      text: `Corner plot: both the ${plot.streetSides[0]} and the ${plot.streetSides[1]} boundary are public frontages and take the front setback.`,
    });
  }

  // ---- prose -----------------------------------------------------------
  const weeks = Math.max(2, Math.round(deadlineDays / 7));
  const vars = {
    address,
    typeName: type.name,
    article: type.article,
    streetSide: plot.street.side,
    entranceFacing: plot.entranceFacing,
    budget: `${money(budget)} credits`,
    weeks,
    days: deadlineDays,
  };
  const briefText = writeBrief({ type, params, program, plot, client, vars, rng });
  const title = titleFor(rng, type, params, client, address);

  return {
    id: `C-${h.toString(36).toUpperCase()}`,
    seed: String(seed),
    difficulty: Math.round(d * 100) / 100,
    type: type.key,
    typeName: type.name,
    client: {
      name: client.name,
      company: client.company,
      tone: client.tone,
      quirk: client.quirk,
      avatarSeed: client.avatarSeed,
      personaId: client.personaId,
    },
    title,
    briefText,
    address,
    budget,
    fee,
    deadlineDays,
    params,
    storeys: params.storeys,
    areas: { net: netArea, gross: grossArea, footprint },
    program,
    constraints,
    plot,
    reputationDelta: {
      onTime: Math.round(6 + d * 10),
      late: -Math.round(3 + d * 6),
      rejected: -Math.round(8 + d * 12),
    },
  };
}

/** Convenience: a whole campaign of commissions with rising difficulty. */
export function generateCampaign(seed, count = 8) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(generateCommission(`${seed}#${i}`, count === 1 ? 0.5 : i / (count - 1), out));
  }
  return out;
}
