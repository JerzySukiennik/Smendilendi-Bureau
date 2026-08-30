// walk.js — WalkthroughMode. "30 years later", in first person, together.
//
// The payoff of the whole loop. The client has accepted; the screen cuts thirty
// years forward; and then everybody walks the finished building while ten to
// thirty simulated people live in it. Over the walk the player collects the
// verdict, the cost, the usage statistics and a movement heat map, and then
// goes back to the office.
//
// WHAT THIS FILE OWNS
//   * the scene: the player's building, its furniture, the site, the light
//   * the first-person controller and its collision against the real walls
//   * the clock that drives one working day of occupancy
//   * the HUD, the chat, the heat-map overlay and the post-occupancy report
//   * the other players, over src/net
// Everything else is delegated: navmesh.js (routes), roles.js (who), npc.js
// (people and doors), aging.js (thirty years), heatmap.js (where), stats.js
// (the evaluation), transition.js (the cut).
//
// DRAW CALLS
// Two instance pools. `staticPool` holds the furniture and is filled once on
// entry; `dynPool` holds the people, the door leaves, the markers, the trees
// and the weathering, and is refilled every frame. A catalogue item costs at
// most two pooled calls no matter how many of it stand in the building: one for
// the surfaces that take the owner's colour and one for the surfaces that do
// not. The debug overlay (backquote) reports the running total.

import {
  Scene, PerspectiveCamera, Color, Fog, Group, Vector3, Matrix4, Quaternion,
  BoxGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
  Mesh, MeshBasicMaterial, CanvasTexture, MathUtils,
} from 'three';
import { Mode } from '../core/mode.js';
import { InstancePool } from '../core/instancing.js';
import {
  materialFor, tintedMaterial, makeLightRig, skyFor, COLORS, tint, FURNITURE_TINTS,
} from '../core/palette.js';
import { SLOT_MATERIALS } from '../core/assets.js';
import { buildMeshes, disposeBuilt } from '../model/geometry.js';
import { buildProcShape } from '../model/proc-shapes.js';
import { entry as catalogEntry, tryEntry } from '../model/catalog.js';
import { entryOf } from '../analysis/catalogue.js';
import { canonicalKey } from '../analysis/classify.js';
import { runAnalysis } from '../analysis/index.js';

import { buildNav, PERSON_WIDTH, PASSING_WIDTH } from './navmesh.js';
import { buildPopulation, rosterKeyFor, rngFrom, nextGoal, dwellFor, fitDayToBuilding, GOALS } from './roles.js';
import { Crowd } from './npc.js';
import { Heatmap } from './heatmap.js';
import { Stats, renderReport } from './stats.js';
import { Aging } from './aging.js';
import { Transition, HANDOVER_YEAR, SPAN_YEARS } from './transition.js';
import { demoModel, demoCommission, demoKindergarten, kindergartenCommission } from './demo.js';

// -- the day ----------------------------------------------------------------
export const DAY_START = 7.0;             // the caretaker is in before anyone else
export const DAY_END = 19.5;
/** Simulated minutes per real second. A whole day takes about 150 s to watch. */
export const MINUTES_PER_SECOND = 5.0;
/** Journeys sampled out of thirty years while the time lapse runs. */
export const PRESIM_JOURNEYS = 1400;

// -- the player -------------------------------------------------------------
const EYE_HEIGHT = 1.65;                  // eye level of a standing adult
const CROUCH_HEIGHT = 1.15;
const HEAD_CLEAR = 1.80;                  // what has to fit under a door head
const PLAYER_RADIUS = 0.28;
const WALK_SPEED = 1.45;                  // m/s — a shade brisker than the NPCs
const RUN_SPEED = 3.10;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3();

// ---------------------------------------------------------------------------
// furniture prototypes: proc-shapes -> two merged geometries per catalogue id

const TINT_SLOTS = new Set(['primary', 'fabric']);
const SKIP_CATEGORIES = new Set(['doors', 'windows']);

function geometryForPart(part) {
  let geo;
  switch (part.type) {
    case 'cyl':
      geo = new CylinderGeometry(part.rTop ?? 0.1, part.rBottom ?? 0.1, part.h ?? 0.5,
        Math.max(3, part.seg ?? 12));
      break;
    case 'plane':
      geo = new PlaneGeometry(part.size?.[0] ?? 0.5, part.size?.[1] ?? 0.5);
      break;
    case 'box':
    default: {
      const s = part.size || [0.4, 0.4, 0.4];
      geo = new BoxGeometry(Math.max(1e-3, s[0]), Math.max(1e-3, s[1]), Math.max(1e-3, s[2]));
      break;
    }
  }
  const r = part.rot || [0, 0, 0];
  if (r[0]) geo.rotateX(r[0]);
  if (r[1]) geo.rotateY(r[1]);
  if (r[2]) geo.rotateZ(r[2]);
  const p = part.pos || [0, 0, 0];
  geo.translate(p[0] || 0, p[1] || 0, p[2] || 0);
  return geo;
}

/** Concatenate part geometries, optionally baking a per-part colour in. */
function mergeParts(parts, colours) {
  if (!parts.length) return null;
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const col = colours ? new Float32Array(total * 3) : null;
  let at = 0;
  for (let i = 0; i < flat.length; i++) {
    const g = flat[i];
    const n = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array.subarray(0, n * 3), at * 3);
    const na = g.getAttribute('normal');
    if (na) nrm.set(na.array.subarray(0, n * 3), at * 3);
    if (col) {
      const c = colours[i];
      for (let k = 0; k < n; k++) {
        col[(at + k) * 3] = c.r; col[(at + k) * 3 + 1] = c.g; col[(at + k) * 3 + 2] = c.b;
      }
    }
    at += n;
    if (g !== parts[i]) g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  if (col) out.setAttribute('color', new BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  for (const g of parts) g.dispose();
  return out;
}

/**
 * A catalogue item as at most two instanced geometries.
 *   `tinted` — the surfaces that take the owner's colour (primary, fabric)
 *   `fixed`  — legs, metal, ceramic, glass, foliage: palette colours baked in
 * Both are shared prototypes; nothing is ever cloned per placement.
 */
function buildFurnitureProto(entry) {
  const shape = buildProcShape(entry);
  const tinted = [], fixed = [], fixedColours = [];
  for (const part of shape.parts) {
    const geo = geometryForPart(part);
    if (TINT_SLOTS.has(part.slot || 'primary')) tinted.push(geo);
    else {
      fixed.push(geo);
      fixedColours.push(materialFor(SLOT_MATERIALS[part.slot] || 'flat').color);
    }
  }
  return { tinted: mergeParts(tinted, null), fixed: mergeParts(fixed, fixedColours) };
}

// ---------------------------------------------------------------------------

export class WalkthroughMode extends Mode {
  constructor() {
    super('walk');
    this.phase = 'idle';
    this.hour = DAY_START;
    this.years = SPAN_YEARS;
    this.speed = MINUTES_PER_SECOND;
    this.paused = false;
    this._cssHref = null;
    this._presimDone = 0;
    this._remote = new Map();
    this._cursorAt = 0;
  }

  // -- lifecycle -----------------------------------------------------------

  init(ctx) {
    super.init(ctx);
    this._loadCss();

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(68, 1, 0.06, 400);
    this.worldGroup = new Group();
    this.scene.add(this.worldGroup);
    this.staticGroup = new Group();
    this.dynGroup = new Group();
    this.worldGroup.add(this.staticGroup, this.dynGroup);
    this.staticPool = new InstancePool(this.staticGroup);
    this.dynPool = new InstancePool(this.dynGroup);
    this._protos = new Map();

    this.ui = document.createElement('div');
    this.ui.className = 'walk-ui';
    this.ui.hidden = true;
    (ctx.app?.ui || document.getElementById('ui') || document.body).appendChild(this.ui);
    this._buildHud();
    this._bindKeys();
  }

  _loadCss() {
    const href = new URL('./walk.css', import.meta.url).href;
    if (document.querySelector(`link[data-walk-css]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.walkCss = '1';
    document.head.appendChild(link);
    this._cssHref = href;
  }

  /**
   * enter({ model, commission, analysis })
   * With nothing passed it falls back to the demo house, so the walkthrough can
   * be run and reviewed before the editor exists. `?walk=broken` on the URL
   * loads the variant with an unreachable room, which is how the annoyed-NPC
   * behaviour is demonstrated.
   */
  enter(params = {}) {
    super.enter(params);
    this.ui.hidden = false;

    const q = new URLSearchParams(location.search);
    const brokenDemo = q.get('walk') === 'broken';
    // `?walk=pinch` is the CLEAR WIDTH fixture: the same house with a 120 mm
    // pilaster in the corridor, which takes it from 1.20 m to a hand-measured
    // 0.700 m over 120 mm of its length. Asserted in src/walk/check-widths.mjs.
    const pinchDemo = q.get('walk') === 'pinch';
    const kg = q.get('plan') === 'kindergarten';
    const fallbackModel = () => (kg ? demoKindergarten({ broken: brokenDemo }) : demoModel({ broken: brokenDemo, pinch: pinchDemo }));
    const fallbackBrief = () => (kg ? kindergartenCommission(brokenDemo) : demoCommission(brokenDemo));
    this.model = params.model || this.ctx?.state?.get('model') || fallbackModel();
    this.commission = params.commission || this.ctx?.state?.get('commission') || fallbackBrief();
    // The brief the walkthrough measures against has to be the brief the CLIENT
    // wrote, `constraints` and all. Without them `briefLimit` finds nothing and
    // every module silently falls back to its own constant — so a clinic whose
    // client demanded 1.50 m of circulation in writing got a report benchmarked
    // at 1.20 m, and a house whose client demanded 1.20 m got one benchmarked at
    // 0.90 m. The client must never contradict himself in writing.
    this.brief = {
      buildingType: this.commission?.type ?? 'house',
      type: this.commission?.type ?? 'house',
      title: this.commission?.title,
      client: this.commission?.client,
      budget: this.commission?.budget,
      program: this.commission?.program ?? [],
      params: this.commission?.params ?? {},
      constraints: this.commission?.constraints ?? [],
      plot: this.commission?.plot ?? null,
    };
    this.analysis = params.analysis || this.ctx?.state?.get('analysis') || safeAnalysis(this.model, this.brief);
    this.seed = String(this.commission?.id ?? this.model?.id ?? 'walk');
    this.rng = rngFrom(`${this.seed}|walk`);

    // THE MODE SWITCH MUST NOT FREEZE THE TAB.
    //
    // Building the navmesh is the expensive thing here — 100 ms to a second on
    // a single-storey house, most of it inside the 100 mm occupancy grid the
    // analysis owns, and worse on four storeys. Doing it before the transition
    // existed meant the whole cut was preceded by a dead tab of exactly that
    // length, which is the first thing the player sees after signing off his
    // building. Nothing needs it until the presim starts, a second and a half
    // into the time lapse, so the shell goes up, the camera starts moving, and
    // the rest is built a slice at a time under the animation.
    this._buildShell();
    this._startTransition();
    this.ready = false;
    this._bootT = 0;
    this._boot = this._bootSteps();

    this.ctx?.audio?.music?.('music.walkthrough', { fade: 2.0 });
    this._bindNet();
  }

  /**
   * The build, in slices. Each `yield` is a frame boundary the time lapse can
   * draw between; the labels are what the debug overlay reports.
   */
  * _bootSteps() {
    const t0 = performance.now();
    this.nav = buildNav(this.model, this.brief);
    const tNav = performance.now() - t0;
    if (!this.nav) {
      this._fatal('There is no enclosed room in this model, so there is nothing to walk through.');
      return;
    }
    yield 'navmesh';
    this._buildPeople();
    yield 'people';
    // Warming the goal fields is a Dijkstra each, and there are a dozen of
    // them; one per slice keeps every one of them off the frame it would
    // otherwise have dropped.
    for (const g of this._goalKeys) { this.crowd.fieldForGoal(g); yield `field:${g}`; }
    this.nav.fieldToOutside();
    yield 'routes';
    this._buildAging();
    this.ready = true;
    const total = performance.now() - t0;
    this.ctx?.engine?.debug?.report('walk', `nav ${tNav.toFixed(0)} ms · ${this.crowd.agents.length} people`);
    console.info(`[walk] ${this.crowd.agents.length} people, ${this.nav.roomIds.length} rooms, nav in ${tNav.toFixed(0)} ms, ready in ${total.toFixed(0)} ms`);
  }

  /** Pump the boot generator for at most `budget` ms of this frame. */
  _pumpBoot(budget = 8) {
    if (!this._boot) return;
    const until = performance.now() + budget;
    do {
      const step = this._boot.next();
      if (step.done) { this._boot = null; return; }
    } while (performance.now() < until);
  }

  exit() {
    super.exit();
    this.ui.hidden = true;
    this.ctx?.input?.exitLock?.();
    this.ctx?.audio?.stopLoop?.('amb.crowd-interior');
    this._unbindNet?.();
  }

  // -- scene ---------------------------------------------------------------

  /**
   * Everything the opening shot needs and nothing that needs the navmesh: the
   * building, the site light, the furniture. The bounds come off the built
   * geometry's own bounding box rather than the room polygons, because the
   * navmesh does not exist yet when the camera starts moving.
   */
  _buildShell() {
    const scene = this.scene;
    const sky = skyFor('afternoon');
    scene.background = new Color(sky.sky);
    scene.fog = new Fog(sky.sky, 60, 190);

    // the building itself, straight out of the model
    if (this.built) disposeBuilt(this.built);
    this.built = buildMeshes(this.model, { ao: 1 });
    this.worldGroup.add(this.built.group);

    // where it is and how big, for the light rig and the opening camera
    const b = this.built.bounds;
    const minX = Number.isFinite(b?.min?.x) ? b.min.x : 0;
    const maxX = Number.isFinite(b?.max?.x) ? b.max.x : 12;
    const minZ = Number.isFinite(b?.min?.z) ? b.min.z : 0;
    const maxZ = Number.isFinite(b?.max?.z) ? b.max.z : 9;
    const elevation = this.model.levels?.[0]?.elevation ?? 0;
    this.centre = { x: (minX + maxX) / 2, y: elevation, z: (minZ + maxZ) / 2 };
    this.radius = Math.max(6, Math.max(maxX - minX, maxZ - minZ) / 2);

    if (this.rig) this.rig.dispose();
    this.rig = makeLightRig(scene, {
      timeOfDay: 'afternoon',
      radius: this.radius * 1.5,
      shadowMapSize: 2048,
    });
    this.rig.focus(this.centre.x, this.centre.z);
    // A walkthrough is the one mode that spends most of its time UNDER a roof
    // slab, and there is no global illumination in this engine: without a lift
    // the only light that reaches an interior is whatever falls through the
    // window openings, and the rooms read as caves. The sun keeps its full
    // strength and its shadows — the patch of light on the floor under a window
    // is the whole point of the daylight module — but the sky and the ambient
    // are raised to stand in for the bounce off the ceiling and the walls.
    this.rig.hemi.intensity *= 1.75;
    this.rig.ambient.intensity = 0.62;
    this._interiorHemi = this.rig.hemi.intensity;
    this._interiorAmb = this.rig.ambient.intensity;

    this._buildFurniture();
  }

  /** Fill the static pool once. Repeated items cost nothing extra. */
  _buildFurniture() {
    const model = this.model;
    const pool = this.staticPool;
    const levelY = new Map(model.levels.map((l) => [l.id, l.elevation ?? 0]));
    const levelH = new Map(model.levels.map((l) => [l.id, l.height ?? 2.70]));

    const needed = new Set();
    for (const id in model.furniture) {
      const f = model.furniture[id];
      const e = entryOf(f.catalogId);
      if (SKIP_CATEGORIES.has(e.category)) continue;
      needed.add(f.catalogId);
    }
    for (const catalogId of needed) {
      if (this._protos.has(catalogId)) continue;
      const e = tryEntry(catalogId) || entryOf(catalogId);
      const proto = buildFurnitureProto(e);
      this._protos.set(catalogId, proto);
      if (proto.tinted) {
        pool.register(`f:${catalogId}:t`, proto.tinted, tintedMaterial({ flatShading: true }));
      }
      if (proto.fixed) {
        pool.register(`f:${catalogId}:x`, proto.fixed,
          materialFor('flat', { vertexColors: true, flatShading: true }));
      }
    }

    pool.begin();
    let placed = 0;
    for (const id in model.furniture) {
      const f = model.furniture[id];
      const e = entryOf(f.catalogId);
      if (SKIP_CATEGORIES.has(e.category)) continue;
      const base = levelY.get(f.levelId) ?? 0;
      const h = levelH.get(f.levelId) ?? 2.70;
      let y = base + (f.y ?? 0);
      if (e.anchor === 'wall') y += e.mount ?? 1.0;
      else if (e.anchor === 'ceiling') y += h - (e.mount ?? 0.30);
      _q.setFromAxisAngle(_up, f.rot ?? 0);
      _p.set(f.x, y, f.z);
      _s.set(f.sx ?? 1, f.sy ?? 1, f.sz ?? 1);
      _m.compose(_p, _q, _s);
      const colour = f.color ?? tint(hashOf(f.catalogId));
      if (this._protos.get(f.catalogId)?.tinted) pool.place(`f:${f.catalogId}:t`, _m, colour);
      if (this._protos.get(f.catalogId)?.fixed) pool.place(`f:${f.catalogId}:x`, _m, 0xffffff);
      placed++;
    }
    pool.flush();
    this.furnitureCount = placed;
  }

  // -- people --------------------------------------------------------------

  _buildPeople() {
    // ?roster=kindergarten&cap=30 puts a different population into the same
    // building. It is a harness affordance, not a game feature: it is how the
    // thirty-person performance figure and the non-domestic rosters get
    // exercised without waiting for eight commission types to be playable.
    const q = new URLSearchParams(location.search);
    const rosterKey = rosterKeyFor(q.get('roster') || this.commission?.type);
    const cap = Math.max(1, Math.min(30, Number(q.get('cap')) || 30));
    // ?people=N asks for exactly N. `cap` only ever scales a roster DOWN, so
    // the thirty-person load case DESIGN-DECISIONS asks for ("10-30 NPCs",
    // 40 fps) could not be produced from a URL at all: the biggest roster on
    // the demo parameters is twenty-five.
    const want = Math.max(0, Math.min(30, Number(q.get('people')) || 0));
    this.population = buildPopulation({
      typeKey: rosterKey,
      params: this.commission?.params ?? {},
      seed: this.seed,
      cap: want || cap,
      want,
    });
    // The roster is written for a BUILDING TYPE; the timetable has to fit THIS
    // DRAWING. A goal whose rooms the client never asked for and the architect
    // never drew is dropped here, before anybody sets off — see the note on
    // `fitDayToBuilding`. What is NOT dropped is a goal whose room the brief
    // does list: walking to a study the client asked for and finding it missing
    // is the finding, and it still happens.
    const briefKinds = new Set();
    for (const line of this.brief?.program ?? []) {
      const k = canonicalKey(line?.key ?? line?.name);
      if (k) briefKinds.add(k);
    }
    const fitted = fitDayToBuilding(this.population, {
      has: (kind) => this.nav.roomsOfKind(kind).length > 0,
      asked: (kind) => briefKinds.has(kind),
    });
    this._droppedGoals = fitted.dropped;
    // TWO grids, and they are not the same measurement.
    //
    // `heat` is MOVEMENT: metres walked, fed only by addPath. It is what the
    // drawing titled "Movement heat map" shows and what wears the floor.
    // `occupancy` is STANDING: person-seconds spent in one spot.
    //
    // They were one grid, and standing outweighed walking about a hundred to
    // one — a dwell of 20-70 minutes deposited 60-210 units while a metre
    // walked deposited 0.74 — so the 98th-percentile normalisation buried every
    // route. The drawing then showed the circulation spine as the coldest part
    // of the plan directly underneath a table saying the corridor carried 218
    // journeys, which is a report contradicting itself on one page.
    this.heat = new Heatmap(this.nav);
    this.occupancy = new Heatmap(this.nav);
    this.stats = new Stats(this.nav, { typeKey: rosterKey, years: this.years, brief: this.brief });
    this.crowd = new Crowd({
      nav: this.nav,
      stats: this.stats,
      heat: this.heat,
      occupancy: this.occupancy,
      population: this.population,
      audio: this.ctx?.audio ?? null,
      rng: this.rng,
    });
    this.crowd.registerPools(this.dynPool);

    // Every goal field is warmed once, rather than the first time somebody
    // needs a WC in the middle of the walk — a Dijkstra over the whole building
    // is a few milliseconds, and a few milliseconds is a dropped frame. The
    // warming itself happens one field per slice, in `_bootSteps`.
    this._goalKeys = [...new Set(this.population.flatMap(
      (p) => (p.day ?? []).flatMap((b) => Object.keys(b.goals)),
    ))];

    // the presim walks each person from wherever they last were
    this._presimState = this.population.map(() => null);
    this._presimDone = 0;
  }

  _buildAging() {
    this.aging = new Aging({
      scene: this.worldGroup,
      nav: this.nav,
      model: this.model,
      commission: this.commission,
      heat: this.heat,
      built: this.built,
      rng: this.rng,
    }).build();
    this.aging.registerPools(this.dynPool);
    // The time lapse may already have aged the building past 0 while this was
    // still being built; join it where it is, not at handover.
    this.aging.setAge(this._age ?? 0);
  }

  // -- the cut -------------------------------------------------------------

  _startTransition() {
    this.phase = 'transition';
    this.hour = DAY_START;
    this.transition = new Transition({
      ui: this.ui,
      rig: this.rig,
      camera: this.camera,
      centre: this.centre,
      radius: this.radius,
      title: this.commission?.title ?? '',
      duration: 9.0,
      // Both of these run while the rest of the mode is still being built a
      // slice at a time under the animation, so both have to tolerate not
      // existing yet. The presim just starts later and runs the same 1400
      // journeys over the remaining lapse.
      onAge: (a) => { this._age = a; this.aging?.setAge(a); },
      presim: (k) => { if (this.ready) this._presim(k); },
    });
  }

  /**
   * Thirty years of use, sampled.
   *
   * Called from inside the time lapse, a few journeys per frame. Each one is a
   * real person with a real goal at a real hour, routed through the real
   * navmesh; the route is laid into the heat map and its length, its clear
   * width and its success or failure go into the statistics. This is where the
   * worn tracks on the floor come from, and it is why the post-occupancy report
   * has a sample worth reading rather than the dozen journeys a two-minute walk
   * would produce.
   */
  _presim(k) {
    const target = Math.floor(k * PRESIM_JOURNEYS);
    // Two dozen journeys a frame is the steady rate. When the presim starts
    // late — it waits for the navmesh, which is built under the same animation
    // — it is allowed to catch up rather than arrive at the walk with half the
    // sample, because the whole report is computed off this.
    let budget = Math.max(24, Math.ceil((target - this._presimDone) / 24));
    while (this._presimDone < target && budget-- > 0) {
      const i = this._presimDone % this.population.length;
      const person = this.population[i];
      this._presimDone++;
      const span = Math.max(0.5, person.leaveAt - person.arriveAt);
      const hour = person.arriveAt + this.rng() * span;
      const goal = nextGoal(person, hour, this.rng);
      const g = GOALS[goal];
      if (!g) continue;

      // where they are standing right now
      let from = this._presimState[i];
      if (!from) {
        const e = this.nav.mainEntrance;
        from = e ? this.nav.centreOf(e.cellIn >= 0 ? e.cellIn : 0) : null;
        if (!from) continue;
      }

      this.stats.journeyStarted(goal);
      // Through the AGENT, not the goal. `fieldForGoal` is multi-source and
      // sends everybody to the nearest instance, so with two identical group
      // rooms every child in the nursery filed into the one by the entrance —
      // 426 person-hours against 13, from routing alone — and the report then
      // printed that as a measurement of the architect's plan. `fieldFor` gives
      // each person the room that is theirs, spread deterministically, exactly
      // as the live crowd does.
      const field = goal === 'leave'
        ? this.nav.fieldToOutside()
        : this.crowd.fieldFor(this.crowd.agents[i], goal);
      if (!field) {
        this.stats.journeyFailed(goal, 'no-room', person, { ...from, hour });
        continue;
      }
      const route = this.nav.path(from.x, from.z, from.level ?? 0, field);
      if (!route) {
        this.stats.journeyFailed(goal, 'no-route', person, { ...from, hour });
        this._presimState[i] = null;
        continue;
      }
      this.stats.journeyDone(goal, route);
      const end = route.points[route.points.length - 1];
      // a person walking a metre spends 1/speed seconds on it
      this.heat.addPath(route.points, 1 / person.speed);
      const room = this.nav.roomAt(end.x, end.z, end.level ?? 0);
      if (room) {
        const dwell = dwellFor(goal, this.rng);
        this.stats.visit(room);
        this.stats.occupy(room, dwell * 60);
        // Standing still wears the floor too, just far more slowly — and it
        // wears it WHERE PEOPLE STAND. A distance field bottoms out one cell
        // inside the door, so depositing the whole dwell at the route's end put
        // a hot blob in every doorway and left the room floors blank. People
        // walk in; the wear goes in with them.
        this._wearInRoom(room, end, dwell);
      }
      this._presimState[i] = end;
    }
  }

  /**
   * Lay one visit's standing wear into a room: a few spots chosen among its
   * widest cells (nobody stands wedged against a wardrobe), with the last
   * couple of metres from the door walked in as track rather than dropped as a
   * blob. Weighted by clear width so the wear collects where the floor is open.
   */
  _wearInRoom(roomId, from, dwell) {
    const cells = this.nav.roomCells(roomId);
    if (!cells.length) { this.occupancy.add(from.x, from.z, from.level ?? 0, dwell * 3); return; }
    const level = from.level ?? 0;
    const picks = 3;
    for (let n = 0; n < picks; n++) {
      // best of four draws by clear width — cheap importance sampling
      let best = -1, bw = -1;
      for (let t = 0; t < 4; t++) {
        const c = cells[Math.floor(this.rng() * cells.length)];
        if (this.nav.width[c] > bw) { bw = this.nav.width[c]; best = c; }
      }
      if (best < 0) continue;
      const p = this.nav.centreOf(best);
      // the last couple of metres in are WALKED, so they are movement…
      this.heat.addPath([{ x: from.x, z: from.z, level }, { x: p.x, z: p.z, level }],
        1 / (2.4 * picks));
      // …and the dwell itself is STANDING, which is a different drawing.
      this.occupancy.add(p.x, p.z, level, (dwell * 3) / picks);
    }
  }

  // -- the first-person walk ------------------------------------------------

  _startWalk() {
    const e = this.nav.mainEntrance;
    const L = this.nav.levels[e ? e.levelIdx : 0];
    this.playerLevel = e ? e.levelIdx : 0;
    if (e) {
      // `e.nx, e.nz` points AWAY from the building, and the player is placed
      // 2.6 m out along it, so he has to be turned back through it to see the
      // facade. The camera convention is three.js's: forward is (-sin, -cos)
      // — so forward is (-nx, -nz) when yaw = atan2(nx, nz). npc.js uses the
      // opposite convention, (sin, cos), and copying its expression here landed
      // the very first frame of the walkthrough on an empty lawn with the whole
      // building behind the player's head.
      // Far enough back that the facade, not one door reveal, is what lands in
      // the first frame — scaled to the building, capped so a large one does
      // not put the player out in the street.
      const standoff = Math.min(6.5, Math.max(3.4, this.radius * 0.55));
      this.player = {
        x: e.x + e.nx * standoff, z: e.z + e.nz * standoff,
        yaw: Math.atan2(e.nx, e.nz), pitch: -0.05,
      };
      // The one assertion worth keeping: the first thing he sees is the thing
      // he drew. forward . (entrance - player) must be positive.
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      const dot = fx * (e.x - this.player.x) + fz * (e.z - this.player.z);
      if (dot <= 0) console.error(`[walk] player spawned facing away from the entrance (dot ${dot.toFixed(2)})`);
    } else {
      const a = this.nav.roomPoint(this.nav.roomIds[0]);
      this.player = { x: a?.x ?? 0, z: a?.z ?? 0, yaw: 0, pitch: 0 };
    }
    this.eye = EYE_HEIGHT;
    this.playerY = L.elevation;
    this.phase = 'reveal';
    this._placeCamera();
    this.ctx?.audio?.loop?.('amb.crowd-interior');
    this._hint('Click to look around · WASD to walk · H heat map · R the report');
  }

  _placeCamera() {
    const p = this.player;
    this.camera.position.set(p.x, this.playerY + this.eye, p.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(p.yaw);
    this.camera.rotateX(p.pitch);
  }

  _movePlayer(dt) {
    const input = this.ctx?.input;
    const p = this.player;
    if (!input) return;

    if (input.pointerLocked) {
      const look = input.consumeLook();
      p.yaw -= look.yaw;
      p.pitch = MathUtils.clamp(p.pitch - look.pitch, -1.35, 1.35);
    }

    const ax = input.axis2 ? input.axis2() : { x: 0, y: 0 };
    const crouch = input.down('crouch');
    this.eye += ((crouch ? CROUCH_HEIGHT : EYE_HEIGHT) - this.eye) * Math.min(1, dt * 10);
    const speed = (input.down('sprint') ? RUN_SPEED : WALK_SPEED) * (crouch ? 0.55 : 1);

    if (ax.x || ax.y) {
      const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      // three.js looks down -Z, so forward is (-sin, -cos)
      let dx = (-sin * ax.y) + (cos * ax.x);
      let dz = (-cos * ax.y) - (sin * ax.x);
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const step = speed * dt;
      const next = this._collide(p.x + dx * step, p.z + dz * step);
      p.x = next.x; p.z = next.z;
      this._footsteps(step);
    }

    // stairs: stand in a stair and press the interact key to change storey
    if (input.pressed && input.pressed('interact')) this._tryStairs();

    const L = this.nav.levels[this.playerLevel];
    this.playerY = L ? L.elevation : 0;
    this._placeCamera();
  }

  /**
   * Capsule against wall segments. The colliders come from the same
   * buildMeshes() call that produced the geometry, so the thing that stops the
   * player is exactly the thing he can see, down to the 240 mm.
   */
  _collide(px, pz) {
    const level = this.nav.levels[this.playerLevel];
    const levelId = level?.levelId;
    for (const c of this.built.colliders) {
      if (c.levelId !== levelId) continue;
      const ax = c.a.x, az = c.a.z;
      const dx = c.b.x - ax, dz = c.b.z - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-9) continue;
      const len = Math.sqrt(len2);
      const t = MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
      const cx = ax + dx * t, cz = az + dz * t;
      let ox = px - cx, oz = pz - cz;
      let d = Math.hypot(ox, oz);
      const r = c.thickness / 2 + PLAYER_RADIUS;
      if (d >= r) continue;
      const along = t * len;
      let through = false;
      for (const g of c.gaps) {
        if (g.head < HEAD_CLEAR) continue;
        if (along >= g.from + PLAYER_RADIUS * 0.7 && along <= g.to - PLAYER_RADIUS * 0.7) {
          through = true; break;
        }
      }
      if (through) continue;
      if (d < 1e-5) { ox = -dz / len; oz = dx / len; d = 1e-5; }
      const push = (r - d) / d;
      px += ox * push;
      pz += oz * push;
    }
    return { x: px, z: pz };
  }

  _tryStairs() {
    const room = this.nav.roomAt(this.player.x, this.player.z, this.playerLevel);
    if (!room || this.nav.kindOf(room) !== 'stair') return;
    const cell = this.nav.indexAt(this.player.x, this.player.z, this.playerLevel);
    const ports = this.nav.portalsFrom.get(cell);
    if (!ports || !ports.length) return;
    const to = ports[0].to;
    const c = this.nav.centreOf(to);
    this.player.x = c.x; this.player.z = c.z;
    this.playerLevel = c.level;
    this._hint(`${this.nav.levels[c.level].levelId}`);
  }

  _footsteps(step) {
    this._stepAcc = (this._stepAcc ?? 0) + step;
    if (this._stepAcc < 0.78) return;
    this._stepAcc = 0;
    const room = this.nav.roomAt(this.player.x, this.player.z, this.playerLevel);
    const kind = room ? this.nav.kindOf(room) : null;
    const hard = kind === 'bathroom' || kind === 'wc' || kind === 'kitchen' || kind === 'corridor';
    const n = 1 + Math.floor(Math.random() * 4);
    this.ctx?.audio?.play?.(`sfx.footstep-${hard ? 'tile' : 'carpet'}-${n}`, {
      context: 'walkthrough', rate: 0.94 + Math.random() * 0.12,
    });
  }

  // -- frame ---------------------------------------------------------------

  update(dt) {
    if (!this.built || this.phase === 'fatal') return;

    if (this.phase === 'transition') {
      // Build what is left of the mode inside the animation's own frames, then
      // let the lapse run. The cut will not land before `ready`, because the
      // player cannot be put in a building whose navmesh does not exist.
      this._pumpBoot(this._boot ? 8 : 0);
      const over = this.transition.update(dt);
      if (over && this.ready) this._startWalk();
      this._relight();
      this._renderDynamic();
      return;
    }

    if (this.phase === 'reveal') {
      this._movePlayer(dt);
      if (this.transition.reveal(dt)) { this.phase = 'walk'; this.transition = null; }
    } else if (this.phase === 'walk') {
      this._movePlayer(dt);
    }

    if (this.phase === 'walk' || this.phase === 'reveal') {
      if (!this.paused) {
        const dtSim = dt * this.speed * 60;         // simulated seconds
        this.hour += (dt * this.speed) / 60;
        this.crowd.update(dt, dtSim, this.hour);
        this.aging.update(dt, this.ctx.engine.time);
        if (this.hour >= DAY_END) this._openReport();
      }
      this._updateHud();
      this._sendCursor();
    }

    this._renderDynamic();
  }

  /** One begin/place/flush for everything that moves. */
  /** The sun sweep in the time lapse rewrites hemi/ambient; put the lift back. */
  _relight() {
    if (this._interiorHemi == null) return;
    this.rig.hemi.intensity = Math.max(this.rig.hemi.intensity, this._interiorHemi * 0.55);
    this.rig.ambient.intensity = this._interiorAmb;
  }

  _renderDynamic() {
    const pool = this.dynPool;
    pool.begin();
    // Everything below is built a slice at a time under the time lapse, so the
    // first frames of the cut legitimately have none of it yet.
    this.aging?.render(pool);
    if (this.phase !== 'transition') {
      this.crowd?.render(pool, this.camera);
      this._renderRemotePlayers(pool);
    } else {
      this.crowd?.doors.render(pool);
    }
    pool.flush();
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    super.resize(w, h);
  }

  // -- HUD -----------------------------------------------------------------

  _buildHud() {
    this.ui.innerHTML = `
      <div class="walk-crosshair"></div>
      <div class="walk-clock">
        <span class="wc-dial"><i></i></span>
        <span class="wc-time">Early morning</span>
        <span class="wc-year"></span>
      </div>
      <div class="walk-room"><span class="wr-name"></span><span class="wr-area"></span></div>
      <div class="walk-look"></div>
      <div class="walk-hint"></div>
      <div class="walk-toast"></div>
      <div class="walk-chat">
        <ul class="wch-log"></ul>
        <input class="wch-input" type="text" maxlength="200" placeholder="Say something…" />
      </div>
      <div class="walk-overlay" hidden></div>`;
    this.el = {
      time: this.ui.querySelector('.wc-time'),
      dial: this.ui.querySelector('.wc-dial'),
      year: this.ui.querySelector('.wc-year'),
      roomName: this.ui.querySelector('.wr-name'),
      roomArea: this.ui.querySelector('.wr-area'),
      look: this.ui.querySelector('.walk-look'),
      hint: this.ui.querySelector('.walk-hint'),
      toast: this.ui.querySelector('.walk-toast'),
      chat: this.ui.querySelector('.walk-chat'),
      chatLog: this.ui.querySelector('.wch-log'),
      chatInput: this.ui.querySelector('.wch-input'),
      overlay: this.ui.querySelector('.walk-overlay'),
    };
    this.el.year.textContent = `${HANDOVER_YEAR + SPAN_YEARS}`;
    this.el.chatInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const text = this.el.chatInput.value.trim();
        this.el.chatInput.value = '';
        if (text) this._say(text);
        this._closeChat();
      } else if (ev.key === 'Escape') {
        this.el.chatInput.value = '';
        this._closeChat();
      }
    });
  }

  /**
   * A DAY DIAL, NOT A WALL CLOCK — and the difference is a matter of honesty.
   *
   * A whole working day is compressed into about 150 seconds of watching, while
   * the people in it walk at their own real speed: 1.35 m/s for an adult, 0.93
   * for a child, because those are the figures a corridor is designed to. The
   * two rates differ by a factor of three hundred. An hh:mm readout beside them
   * therefore asserted something false about the one number a player whose
   * profession is circulation will actually read off the screen — a child was
   * seen taking 55 minutes of "clock time" to cross a 12 x 9 m house.
   *
   * So the clock says how far through the day the building is, which is true
   * and is what the light and the population are keyed to, and says nothing
   * about how long anything takes. The travel times that ARE asserted are in
   * the report, computed from measured route lengths at a stated walking speed.
   */
  _dayLabel(hour) {
    if (hour < 8.5) return 'Early morning';
    if (hour < 10.5) return 'Mid-morning';
    if (hour < 12.0) return 'Late morning';
    if (hour < 14.0) return 'Midday';
    if (hour < 16.0) return 'Afternoon';
    if (hour < 18.0) return 'Late afternoon';
    return 'Evening';
  }

  _updateHud() {
    const through = MathUtils.clamp((this.hour - DAY_START) / (DAY_END - DAY_START), 0, 1);
    const label = this._dayLabel(this.hour);
    if (label !== this._lastDayLabel) {
      this._lastDayLabel = label;
      this.el.time.textContent = label;
    }
    const pct = Math.round(through * 100);
    if (pct !== this._lastDayPct) {
      this._lastDayPct = pct;
      this.el.dial.style.setProperty('--through', `${through * 360}deg`);
      this.el.dial.title = `${pct} % through the working day`;
    }

    const room = this.nav.roomAt(this.player.x, this.player.z, this.playerLevel);
    if (room !== this._lastRoom) {
      this._lastRoom = room;
      this.el.roomName.textContent = room ? this.nav.labelOf(room) : 'outside';
      // The clear width where he is standing, measured the way the report
      // measures it — a SPAN across the passage, not this cell's own distance
      // to the nearest obstruction. `widthAt` is the distance transform: stand
      // 350 mm off the skirting of a 1.40 m corridor and it reads 0.70 m, and
      // the HUD would be contradicting the post-occupancy sheet in the same
      // building, in the same room, on the same grid.
      const cell = this.nav.indexAt(this.player.x, this.player.z, this.playerLevel);
      const clear = cell >= 0
        ? this.nav.passageWidth(cell, 0, 0)
        : this.nav.widthAt(this.player.x, this.player.z, this.playerLevel);
      this.el.roomArea.textContent = room
        ? `${this.nav.areaOf(room).toFixed(1)} m²  ·  clear ${clear.toFixed(2)} m`
        : '';
    }

    const look = this.crowd.pick(this.camera, 7);
    if (look) {
      this.el.look.hidden = false;
      this.el.look.className = `walk-look${look.blocked ? ' blocked' : ''}`;
      this.el.look.innerHTML = '<b></b><span></span>';
      this.el.look.children[0].textContent = look.label;
      this.el.look.children[1].textContent = look.doing;
    } else if (!this.el.look.hidden) {
      this.el.look.hidden = true;
    }

    if (this.crowd.blockedNow !== this._lastBlocked) {
      this._lastBlocked = this.crowd.blockedNow;
      if (this.crowd.blockedNow > 0) {
        this._toast(`${this.crowd.blockedNow} ${this.crowd.blockedNow === 1 ? 'person' : 'people'} cannot get where they are going`);
      }
    }
    this.ctx?.engine?.debug?.report('walk',
      `${this.crowd.visible} people · ${this.stats.completed}/${this.stats.journeys} journeys · dyn ${this.dynPool.drawCalls} + stat ${this.staticPool.drawCalls} calls`);
  }

  _hint(text) { this.el.hint.textContent = text; this.el.hint.classList.add('show'); }
  _toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), 4200);
  }

  // -- heat overlay ---------------------------------------------------------

  _toggleHeat() {
    if (this._heatMesh) {
      this._heatMesh.visible = !this._heatMesh.visible;
      this._hint(this._heatMesh.visible ? 'Heat map on the floor' : '');
      return;
    }
    const li = this.playerLevel;
    const L = this.nav.levels[li];
    const cv = this.heat.toCanvas(li, { px: 1, mode: 'heat' });
    const tex = new CanvasTexture(cv);
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false });
    const bw = L.w * this.nav.cell, bh = L.h * this.nav.cell;
    const mesh = new Mesh(new PlaneGeometry(bw, bh), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(L.minX + bw / 2, L.elevation + 0.02, L.minZ + bh / 2);
    mesh.renderOrder = 3;
    this.worldGroup.add(mesh);
    this._heatMesh = mesh;
    this._heatTex = tex;
    this._heatCanvas = cv;
    this._hint('Heat map on the floor — this is where the wear comes from');
  }

  // -- report ---------------------------------------------------------------

  _openReport() {
    if (this.phase === 'report') return;
    this.phase = 'report';
    this.paused = true;
    this.ctx?.input?.exitLock?.();
    // Two drawings, because they are two measurements. The first is metres
    // walked and answers "where is the circulation"; the second is time stood
    // still and answers "where is the building lived in". One grid carrying
    // both used to answer neither.
    const plan = this.heat.planCanvas(this.playerLevel, {
      width: 980,
      title: 'Movement heat map — thirty years of use',
      subtitle: `${this.stats.journeys} journeys sampled · metres walked · clear widths measured on a 100 mm grid`,
    });
    const occupancyPlan = this.occupancy.planCanvas(this.playerLevel, {
      width: 980,
      title: 'Occupancy — where people stood still',
      subtitle: 'person-seconds at rest, over the same thirty years',
    });
    const sheet = renderReport(this.stats, {
      analysis: this.analysis,
      commission: this.commission,
      heatCanvas: plan,
      occupancyCanvas: occupancyPlan,
      years: this.years,
    });
    const bar = document.createElement('div');
    bar.className = 'poe-actions';
    bar.innerHTML = '<button class="poe-back">Back to the office</button><button class="poe-stay">Keep walking</button>';
    bar.querySelector('.poe-back').addEventListener('click', () => this._leave());
    bar.querySelector('.poe-stay').addEventListener('click', () => this._closeReport());
    sheet.appendChild(bar);

    this.el.overlay.innerHTML = '';
    this.el.overlay.appendChild(sheet);
    this.el.overlay.hidden = false;
    this.ctx?.audio?.play?.('ui.window-open');
  }

  _closeReport() {
    this.el.overlay.hidden = true;
    this.el.overlay.innerHTML = '';
    this.paused = false;
    this.phase = 'walk';
    if (this.hour >= DAY_END) this.hour = DAY_START + 2;   // another day in the life
  }

  _leave() {
    this.el.overlay.hidden = true;
    this.el.overlay.innerHTML = '';
    const engine = this.ctx?.engine;
    if (engine && engine.modeStack.length > 1) engine.pop({ from: 'walk', stats: this.stats.summary() });
    else this._closeReport();
  }

  // -- chat and other players ----------------------------------------------

  _bindNet() {
    const net = this.ctx?.net;
    if (!net || typeof net.on !== 'function') return;
    const offChat = net.on('chat', (m) => this._appendChat(m));
    const offPlayers = net.on('players', (list) => { this._players = list; });
    this._players = net.players ?? [];
    this._unbindNet = () => { offChat?.(); offPlayers?.(); };
  }

  _sendCursor() {
    const net = this.ctx?.net;
    if (!net?.setCursor) return;
    const now = performance.now();
    if (now - this._cursorAt < 90) return;
    this._cursorAt = now;
    net.setCursor({ mode: 'walk', x: this.player.x, y: this.playerY, z: this.player.z });
  }

  _say(text) {
    const net = this.ctx?.net;
    if (net?.chat) net.chat(text);
    else this._appendChat({ pid: 'me', text, at: Date.now() });
  }

  _appendChat(msg) {
    const li = document.createElement('li');
    const who = this._players?.find?.((p) => p.id === msg.pid);
    li.innerHTML = '<b></b><span></span>';
    li.children[0].textContent = who?.nick ?? (msg.pid === 'me' ? 'you' : 'someone');
    if (who?.color) li.children[0].style.color = who.color;
    li.children[1].textContent = ` ${msg.text}`;
    this.el.chatLog.appendChild(li);
    while (this.el.chatLog.children.length > 8) this.el.chatLog.removeChild(this.el.chatLog.firstChild);
    this.el.chat.classList.add('show');
    clearTimeout(this._chatTimer);
    this._chatTimer = setTimeout(() => {
      if (!this.el.chat.classList.contains('typing')) this.el.chat.classList.remove('show');
    }, 9000);
  }

  _openChat() {
    this.el.chat.classList.add('show', 'typing');
    this.ctx?.input?.exitLock?.();
    this.el.chatInput.focus();
  }

  _closeChat() {
    this.el.chat.classList.remove('typing');
    this.el.chatInput.blur();
  }

  /**
   * Everybody else, walking the same building. The transport only carries
   * {mode, x, y, z}, so a remote architect is faced along the way he is
   * actually moving rather than along a yaw we would have to invent.
   */
  _renderRemotePlayers(pool) {
    const list = this._players;
    const me = this.ctx?.net?.playerId;
    if (!list?.length) return;
    for (const p of list) {
      if (!p || p.id === me) continue;
      const c = p.cursor;
      if (!c || c.mode !== 'walk') continue;
      let r = this._remote.get(p.id);
      if (!r) { r = { x: c.x, z: c.z, y: c.y, yaw: 0 }; this._remote.set(p.id, r); }
      const dx = c.x - r.x, dz = c.z - r.z;
      if (dx * dx + dz * dz > 4e-4) r.yaw = Math.atan2(dx, dz);
      r.x += dx * 0.25; r.z += dz * 0.25; r.y += (c.y - r.y) * 0.25;
      const colour = colourOf(p.color);
      const H = 1.78;
      _q.setFromAxisAngle(_up, r.yaw);
      _p.set(r.x, r.y + H * 0.47 + H * 0.145, r.z);
      _s.set(H * 0.23, H * 0.29, H * 0.14);
      _m.compose(_p, _q, _s);
      pool.place('npc.torso', _m, colour);
      _p.set(r.x, r.y + H * 0.235, r.z);
      _s.set(H * 0.20, H * 0.47, H * 0.12);
      _m.compose(_p, _q, _s);
      pool.place('npc.leg', _m, 0x2f2c29);
      _p.set(r.x, r.y + H * 0.82, r.z);
      _s.set(H * 0.115, H * 0.13, H * 0.115);
      _m.compose(_p, _q, _s);
      pool.place('npc.head', _m, 0xe3b48f);
      _p.set(r.x, r.y + H * 0.88, r.z);
      _s.set(H * 0.12, H * 0.034, H * 0.12);
      _m.compose(_p, _q, _s);
      pool.place('npc.hair', _m, colour);
    }
  }

  // -- keys -----------------------------------------------------------------

  _bindKeys() {
    this._onKey = (ev) => {
      if (!this.active || this.el.chat.classList.contains('typing')) return;
      // Nothing to show until the navmesh, the people and the statistics exist.
      if (!this.ready && ev.code !== 'Escape') return;
      switch (ev.code) {
        case 'KeyH': this._toggleHeat(); break;
        case 'KeyR': this.phase === 'report' ? this._closeReport() : this._openReport(); break;
        case 'KeyT': ev.preventDefault(); this._openChat(); break;
        case 'KeyP': this.paused = !this.paused; this._hint(this.paused ? 'Time paused' : ''); break;
        case 'Escape':
          if (this.phase === 'report') this._closeReport();
          else this.ctx?.input?.exitLock?.();
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', this._onKey);
    this._onClick = () => {
      if (!this.active) return;
      if (this.phase === 'walk' || this.phase === 'reveal') this.ctx?.input?.requestLock?.();
    };
    this.ctx?.input?.target?.addEventListener('click', this._onClick);
  }

  // -- teardown -------------------------------------------------------------

  _fatal(message) {
    this.phase = 'fatal';
    this.transition?.dispose();
    this.transition = null;
    this._boot = null;
    this.ui.hidden = false;
    this.el.overlay.hidden = false;
    this.el.overlay.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'walk-report';
    d.innerHTML = '<h1>Nothing to walk through</h1><p></p>';
    d.querySelector('p').textContent = message;
    this.el.overlay.appendChild(d);
    console.warn('[walk]', message);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.ctx?.input?.target?.removeEventListener('click', this._onClick);
    this.crowd?.dispose();
    this.aging?.dispose();
    this.staticPool?.dispose();
    this.dynPool?.dispose();
    for (const p of this._protos.values()) { p.tinted?.dispose(); p.fixed?.dispose(); }
    this._protos.clear();
    if (this.built) disposeBuilt(this.built);
    this._heatMesh?.geometry?.dispose();
    this._heatTex?.dispose();
    this.rig?.dispose();
    this.ui?.remove();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

function hashOf(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function colourOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.startsWith('#')) return parseInt(v.slice(1), 16);
  return COLORS.accent;
}

/** The analysis must never be the reason the walkthrough fails to open. */
function safeAnalysis(model, brief) {
  try { return runAnalysis(model, brief); }
  catch (err) { console.warn('[walk] analysis unavailable', err); return null; }
}

export default WalkthroughMode;
