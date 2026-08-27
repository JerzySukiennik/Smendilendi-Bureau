// npc.js — the people, the doors they open, and the moment they give up.
//
// Thirty years of use, acted out. Everything a person does here resolves to a
// ROOM in the player's own model and a ROUTE through the player's own plan; the
// only reason a journey can fail is that the drawing does not support it.
//
// THE LESSON THIS FILE EXISTS TO TEACH
// When someone cannot reach where they need to go, they do not silently
// teleport, re-plan or stand still. They stop AT THE POINT THE ROUTE RAN OUT,
// look around, tap a foot, and a marker appears over their head. The player
// watches his own circulation mistake being performed. It is also written into
// the statistics, with the room they wanted and the reason.
//
// PERFORMANCE
// Every person is five instanced boxes — head, hair, torso, leg, arm — so the
// whole crowd is five draw calls no matter how many of them there are. Nothing
// is cloned. The walk cycle is procedural: a hip rotation, a counter-swinging
// arm and a two-centimetre bob, which at this scale reads as walking and costs
// one Matrix4 compose per limb.

import {
  Matrix4, Quaternion, Vector3, BoxGeometry, PlaneGeometry,
  MeshBasicMaterial, CanvasTexture, DoubleSide,
} from 'three';
import { materialFor, tintedMaterial, COLORS } from '../core/palette.js';
import { GOALS, nextGoal, dwellFor } from './roles.js';
import { PASSING_WIDTH, PERSON_WIDTH } from './navmesh.js';

/** Radius of a person for crowd separation. Half the shoulder width. */
export const PERSON_RADIUS = PERSON_WIDTH / 2;
/** How long an annoyed person stands there before trying something else. */
export const ANNOY_SECONDS = 7.5;
/** How close a person has to be to a door before they push it open. */
export const DOOR_TRIGGER = 1.6;

// Scratch objects. Nothing in the render loop allocates: at thirty people and
// nine limbs each that would be three hundred throwaway objects every frame.
const _m = new Matrix4();
const _q = new Quaternion();
const _qLimb = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const AXIS_X = new Vector3(1, 0, 0);

// ---------------------------------------------------------------------------
// 1. the icon atlas — the only pictures in the walkthrough

const ICONS = ['alert', 'door', 'wc', 'cup', 'desk', 'talk', 'star', 'sleep', 'clock', 'book', 'box'];

function drawIcon(g, name, s) {
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = s * 0.10;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const c = s / 2;
  switch (name) {
    case 'alert':
      g.beginPath(); g.moveTo(c, s * 0.16); g.lineTo(c, s * 0.62); g.stroke();
      g.beginPath(); g.arc(c, s * 0.80, s * 0.075, 0, Math.PI * 2); g.fill();
      break;
    case 'door':
      g.strokeRect(s * 0.26, s * 0.16, s * 0.44, s * 0.68);
      g.beginPath(); g.arc(s * 0.62, s * 0.52, s * 0.045, 0, Math.PI * 2); g.fill();
      break;
    case 'wc':   // the universally understood pictogram: a seat in section
      g.beginPath();
      g.moveTo(s * 0.30, s * 0.24); g.lineTo(s * 0.30, s * 0.56);
      g.quadraticCurveTo(s * 0.30, s * 0.70, s * 0.50, s * 0.70);
      g.quadraticCurveTo(s * 0.70, s * 0.70, s * 0.70, s * 0.56);
      g.lineTo(s * 0.70, s * 0.24);
      g.stroke();
      g.beginPath(); g.moveTo(s * 0.44, s * 0.70); g.lineTo(s * 0.44, s * 0.84); g.stroke();
      break;
    case 'cup':
      g.beginPath();
      g.moveTo(s * 0.28, s * 0.36); g.lineTo(s * 0.34, s * 0.76);
      g.lineTo(s * 0.62, s * 0.76); g.lineTo(s * 0.68, s * 0.36);
      g.closePath(); g.stroke();
      g.beginPath(); g.arc(s * 0.70, s * 0.50, s * 0.10, -1.2, 1.2); g.stroke();
      break;
    case 'desk':
      g.beginPath(); g.moveTo(s * 0.20, s * 0.44); g.lineTo(s * 0.80, s * 0.44); g.stroke();
      g.beginPath(); g.moveTo(s * 0.26, s * 0.44); g.lineTo(s * 0.26, s * 0.80); g.stroke();
      g.beginPath(); g.moveTo(s * 0.74, s * 0.44); g.lineTo(s * 0.74, s * 0.80); g.stroke();
      g.strokeRect(s * 0.40, s * 0.22, s * 0.24, s * 0.20);
      break;
    case 'talk':
      g.beginPath();
      g.moveTo(s * 0.20, s * 0.26); g.lineTo(s * 0.80, s * 0.26);
      g.lineTo(s * 0.80, s * 0.62); g.lineTo(s * 0.46, s * 0.62);
      g.lineTo(s * 0.32, s * 0.80); g.lineTo(s * 0.32, s * 0.62);
      g.lineTo(s * 0.20, s * 0.62); g.closePath(); g.stroke();
      break;
    case 'star':
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.15 : s * 0.34;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
      break;
    case 'sleep':
      g.font = `700 ${s * 0.34}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('z', s * 0.36, s * 0.66);
      g.font = `700 ${s * 0.46}px Helvetica, Arial, sans-serif`;
      g.fillText('Z', s * 0.64, s * 0.36);
      break;
    case 'clock':
      g.beginPath(); g.arc(c, c, s * 0.30, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(c, c); g.lineTo(c, s * 0.30); g.stroke();
      g.beginPath(); g.moveTo(c, c); g.lineTo(s * 0.68, c); g.stroke();
      break;
    case 'book':
      g.beginPath();
      g.moveTo(s * 0.22, s * 0.28); g.lineTo(s * 0.50, s * 0.34); g.lineTo(s * 0.78, s * 0.28);
      g.lineTo(s * 0.78, s * 0.72); g.lineTo(s * 0.50, s * 0.78); g.lineTo(s * 0.22, s * 0.72);
      g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(s * 0.50, s * 0.34); g.lineTo(s * 0.50, s * 0.78); g.stroke();
      break;
    case 'box':
    default:
      g.strokeRect(s * 0.24, s * 0.32, s * 0.52, s * 0.44);
      g.beginPath(); g.moveTo(s * 0.24, s * 0.46); g.lineTo(s * 0.76, s * 0.46); g.stroke();
      break;
  }
}

/** One 512 px atlas, 4 x 4 cells of 128 px. Built once, shared by every marker. */
function buildIconAtlas() {
  const cell = 128, cols = 4;
  const cv = document.createElement('canvas');
  cv.width = cv.height = cell * cols;
  const g = cv.getContext('2d');
  ICONS.forEach((name, i) => {
    g.save();
    g.translate((i % cols) * cell, Math.floor(i / cols) * cell);
    drawIcon(g, name, cell);
    g.restore();
  });
  const tex = new CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

/** A plane whose UVs are cropped to one atlas cell. */
function iconGeometry(index, size = 0.34) {
  const cols = 4;
  const geo = new PlaneGeometry(size, size);
  const u0 = (index % cols) / cols, v0 = 1 - (Math.floor(index / cols) + 1) / cols;
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) / cols, v0 + uv.getY(i) / cols);
  }
  uv.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// 2. doors — they swing, and they make a noise

export class Doors {
  /**
   * @param {Navmesh} nav
   * @param {AudioBus} audio
   */
  constructor(nav, audio) {
    this.nav = nav;
    this.audio = audio;
    this.state = new Map();      // openingId -> { open, target, leaf, sounded }
    for (const d of nav.doors) {
      if (!d.hinge) continue;    // a doorless opening has no leaf to swing
      this.state.set(d.openingId, { open: 0, target: 0, leaf: d, hold: 0, sounded: false });
    }
  }

  /** Ask a door to open. Called by anyone walking at it. */
  push(openingId, holdSeconds = 1.4) {
    const s = this.state.get(openingId);
    if (!s) return;
    s.target = 1;
    s.hold = Math.max(s.hold, holdSeconds);
    if (!s.sounded && s.open < 0.05) {
      s.sounded = true;
      this.audio?.play('sfx.door-open', {
        position: { x: s.leaf.cx, y: s.leaf.elevation + 1.0, z: s.leaf.cz },
        volume: 0.55, refDistance: 3, maxDistance: 22, rate: 0.94 + Math.random() * 0.12,
      });
    }
  }

  update(dt) {
    for (const s of this.state.values()) {
      if (s.hold > 0) { s.hold -= dt; if (s.hold <= 0) s.target = 0; }
      const speed = s.target > s.open ? 2.6 : 1.5;      // opens briskly, closes on the check
      const before = s.open;
      s.open += Math.sign(s.target - s.open) * Math.min(Math.abs(s.target - s.open), speed * dt);
      if (before > 0.06 && s.open <= 0.06 && s.target === 0) {
        s.sounded = false;
        this.audio?.play('sfx.door-close', {
          position: { x: s.leaf.cx, y: s.leaf.elevation + 1.0, z: s.leaf.cz },
          volume: 0.45, refDistance: 3, maxDistance: 22, rate: 0.95 + Math.random() * 0.1,
        });
      }
    }
  }

  registerPools(pool) {
    if (!pool.has('door.leaf')) {
      pool.register('door.leaf', new BoxGeometry(1, 1, 1), tintedMaterial());
      pool.register('door.handle', new BoxGeometry(1, 1, 1), materialFor('metal'));
    }
  }

  render(pool) {
    for (const s of this.state.values()) {
      const d = s.leaf;
      // The leaf rotates about its hinge from flat-in-the-wall to 90 degrees.
      const a = s.open * (Math.PI / 2);
      const cx = d.closedDir.x * Math.cos(a) + d.openDir.x * Math.sin(a);
      const cz = d.closedDir.z * Math.cos(a) + d.openDir.z * Math.sin(a);
      const yaw = Math.atan2(cx, cz);
      const t = 0.042;                       // 42 mm leaf, the real thickness
      const midX = d.hinge.x + cx * d.width * 0.5;
      const midZ = d.hinge.z + cz * d.width * 0.5;
      _q.setFromAxisAngle(_up, yaw);
      _p.set(midX, d.elevation + d.height / 2, midZ);
      _s.set(t, d.height, d.width);
      _m.compose(_p, _q, _s);
      pool.place('door.leaf', _m, COLORS.woodMid);

      // lever handle, 1.05 m above the floor, on the leading edge
      const hx = d.hinge.x + cx * (d.width - 0.06);
      const hz = d.hinge.z + cz * (d.width - 0.06);
      _p.set(hx, d.elevation + 1.05, hz);
      _s.set(0.11, 0.03, 0.03);
      _m.compose(_p, _q, _s);
      pool.place('door.handle', _m, COLORS.metal);
    }
  }

  openness(openingId) { return this.state.get(openingId)?.open ?? 1; }
}

// ---------------------------------------------------------------------------
// 3. one person

const STATE = {
  OFFSTAGE: 0, ENTERING: 1, WALKING: 2, IDLE: 3, BLOCKED: 4, LEAVING: 5, GONE: 6,
};

class Agent {
  constructor(person, nav) {
    this.p = person;
    this.nav = nav;
    this.x = 0; this.z = 0; this.y = 0; this.level = 0;
    this.yaw = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.state = STATE.OFFSTAGE;
    this.path = null;
    this.pathIdx = 1;
    this.goal = null;
    this.lastGoal = null;
    this.route = null;
    this.dwellUntil = -1;              // hours
    this.annoy = 0;                    // seconds left of standing there fuming
    this.annoyReason = null;
    this.wcNeed = Math.random() * 0.5;
    this.coffeeNeed = Math.random() * 0.5;
    this.speedScale = 1;
    this.squeezeCooldown = 0;
    this.roomId = null;
    this.vx = 0; this.vz = 0;
    this.bob = 0;
    this.lookAbout = 0;
    this.settling = false;         // walking to a spot inside the room they reached
    this.home = new Map();         // goalKey -> the room that is THEIRS
  }

  get active() { return this.state !== STATE.OFFSTAGE && this.state !== STATE.GONE; }
  get walking() { return this.state === STATE.WALKING || this.state === STATE.ENTERING || this.state === STATE.LEAVING; }
}

// ---------------------------------------------------------------------------
// 4. the crowd

export class Crowd {
  /**
   * @param {object} o
   *   nav        Navmesh
   *   stats      Stats
   *   heat       Heatmap
   *   population [Person] from roles.buildPopulation
   *   audio      AudioBus (optional)
   *   rng        () => 0..1
   */
  constructor({ nav, stats, heat, population, audio = null, rng = Math.random }) {
    this.nav = nav;
    this.stats = stats;
    this.heat = heat;
    this.audio = audio;
    this.rng = rng;
    this.doors = new Doors(nav, audio);
    this.agents = population.map((p) => new Agent(p, nav));
    this.hour = 7.0;
    this._hash = new Map();
    this._iconTex = null;
    this._iconGeo = new Map();
    this._nearest = null;
    this._nearBuf = [];
    this.t = 0;
    this.visible = 0;
    this.blockedNow = 0;
  }

  // -- goals ---------------------------------------------------------------

  /**
   * One distance field per GOAL, not per room: everyone who needs a WC is
   * heading for the same set of cells, and Dijkstra does not care how many of
   * them there are. Thirty people therefore cost at most a dozen fields.
   */
  fieldForGoal(goalKey) {
    const rooms = this.nav.roomsForGoal(goalKey);
    if (!rooms.length) return null;
    const cells = [];
    for (const id of rooms) for (const c of this.nav.roomCells(id)) cells.push(c);
    if (!cells.length) return null;
    return this.nav.field(`goal:${goalKey}`, cells);
  }

  /**
   * The field THIS person should follow for THIS goal.
   *
   * For a goal marked `assigned` in roles.js the person keeps one room — a
   * child belongs to a group, a member of staff has a desk — chosen once and
   * spread deterministically across the rooms that qualify. Everything else
   * (the WC, a coffee, the way out) uses the multi-source field, because for
   * those the nearest one really is the right one.
   */
  fieldFor(a, goalKey) {
    const g = GOALS[goalKey];
    if (!g?.assigned) return this.fieldForGoal(goalKey);
    let room = a.home.get(goalKey);
    if (room === undefined) {
      const rooms = this.nav.roomsForGoal(goalKey);
      if (!rooms.length) { a.home.set(goalKey, null); return null; }
      const i = this.agents.indexOf(a);
      room = rooms[(i < 0 ? 0 : i) % rooms.length];
      a.home.set(goalKey, room);
    }
    if (!room) return null;
    return this.nav.fieldToRoom(room);
  }

  /** Send an agent after a goal. Returns true when a route was found. */
  dispatch(a, goalKey) {
    const stats = this.stats;
    a.goal = goalKey;
    stats.journeyStarted(goalKey);

    if (goalKey === 'leave') {
      const f = this.nav.fieldToOutside();
      const route = this.nav.path(a.x, a.z, a.level, f);
      if (!route) { this.blockAgent(a, 'no-route'); return false; }
      a.route = route;
      a.path = route.points.slice();
      const e = this.nav.mainEntrance;
      if (e) a.path.push({ x: e.outX, z: e.outZ, y: this.nav.levels[e.levelIdx].elevation, level: e.levelIdx });
      a.pathIdx = 1;
      a.state = STATE.LEAVING;
      return true;
    }

    const f = this.fieldFor(a, goalKey);
    if (!f) { this.blockAgent(a, 'no-room'); return false; }
    const route = this.nav.path(a.x, a.z, a.level, f);
    if (!route || !route.points.length) { this.blockAgent(a, 'no-route'); return false; }
    if (route.points.length < 2 && route.length < 0.05) {
      // already standing in a room that satisfies the goal
      stats.journeyDone(goalKey, route);
      this.arrive(a);
      return true;
    }
    a.route = route;
    a.path = route.points;
    a.pathIdx = 1;
    a.state = STATE.WALKING;
    return true;
  }

  /** The visible failure. This is the whole point of the walkthrough. */
  blockAgent(a, reason) {
    a.state = STATE.BLOCKED;
    a.annoy = ANNOY_SECONDS;
    a.annoyReason = reason;
    a.path = null;
    a.route = null;
    a.lookAbout = 0;
    this.stats.journeyFailed(a.goal, reason, a.p, { x: a.x, z: a.z, level: a.level, hour: this.hour });
  }

  arrive(a) {
    a.path = null;
    a.settling = false;
    a.dwellUntil = this.hour + dwellFor(a.goal, this.rng) / 60;
    a.lastGoal = a.goal;
    const room = this.nav.roomAt(a.x, a.z, a.level);
    a.roomId = room;
    this.stats.visit(room);
    if (a.goal === 'wc') a.wcNeed = 0;
    if (a.goal === 'coffee' || a.goal === 'eat') a.coffeeNeed = 0;

    // A distance field ends at the NEAREST cell of the goal room, which is the
    // cell just inside the door. Left there, twenty children arrive one after
    // another and stand in their own doorway in a heap. People walk INTO a
    // room, so the last leg is a short straight walk to somewhere with space
    // around it — line of sight only, no second search.
    const spot = this._spotIn(a, room);
    if (spot) {
      a.state = STATE.WALKING;
      a.settling = true;
      a.path = [
        { x: a.x, z: a.z, y: a.y, level: a.level },
        { x: spot.x, z: spot.z, y: a.y, level: a.level },
      ];
      a.pathIdx = 1;
      return;
    }
    a.state = STATE.IDLE;
  }

  /**
   * Somewhere in `room` with elbow room: visible from where the person is
   * standing, at least 1.2 m further in, and not already taken by somebody
   * else. Eight tries, then give up and stand where you are.
   */
  _spotIn(a, roomId) {
    if (!roomId) return null;
    const cells = this.nav.roomCells(roomId);
    if (cells.length < 6) return null;
    const here = this.nav.indexAt(a.x, a.z, a.level);
    let best = null, bestScore = -Infinity;
    for (let t = 0; t < 8; t++) {
      const c = cells[Math.floor(this.rng() * cells.length)];
      if (c === here) continue;
      const p = this.nav.centreOf(c);
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < 1.0 || d > 9.0) continue;
      if (here >= 0 && !this.nav._lineOfSight(here, c)) continue;
      let crowd = 0;
      for (const o of this.agents) {
        if (o === a || !o.active) continue;
        const od = Math.hypot(o.x - p.x, o.z - p.z);
        if (od < 1.1) crowd += (1.1 - od);
      }
      const score = this.nav.width[c] * 0.6 + Math.min(d, 4) * 0.25 - crowd * 2.2;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /** Pick what to do next: an involuntary need first, then the timetable. */
  chooseGoal(a) {
    const p = a.p;
    if (p.needs.wc > 0 && a.wcNeed >= 1) return 'wc';
    if (p.needs.coffee > 0 && a.coffeeNeed >= 1 && this.rng() < 0.6) return 'coffee';
    return nextGoal(p, this.hour, this.rng, a.lastGoal);
  }

  // -- simulation ----------------------------------------------------------

  /**
   * @param {number} dt      real seconds
   * @param {number} dtSim   simulated seconds
   * @param {number} hour    the building's clock
   */
  update(dt, dtSim, hour) {
    this.hour = hour;
    this.t += dt;
    const nav = this.nav;
    this.doors.update(dt);
    this._rebuildHash();
    let visible = 0, blocked = 0;

    for (const a of this.agents) {
      const p = a.p;

      // -- appearing and disappearing on their own timetable ---------------
      if (a.state === STATE.OFFSTAGE) {
        if (hour >= p.arriveAt && hour < p.leaveAt) this.spawn(a);
        else continue;
      }
      if (a.state === STATE.GONE) continue;
      visible++;

      // needs build up on their own clock, in simulated hours
      const dh = dtSim / 3600;
      a.wcNeed += dh * 0.32 * (p.needs.wc || 0);
      a.coffeeNeed += dh * 0.28 * (p.needs.coffee || 0);
      if (a.squeezeCooldown > 0) a.squeezeCooldown -= dt;

      // going home overrides everything
      if (hour >= p.leaveAt && a.state !== STATE.LEAVING && a.state !== STATE.BLOCKED) {
        this.dispatch(a, 'leave');
      }

      switch (a.state) {
        case STATE.IDLE: {
          this.idleStep(a, dt);
          if (hour >= a.dwellUntil) this.dispatch(a, this.chooseGoal(a));
          break;
        }
        case STATE.BLOCKED: {
          blocked++;
          a.annoy -= dt;
          a.lookAbout += dt;
          // A person who cannot get where they wanted does not stand there for
          // ever: after a while they try something else, and if that fails too
          // the statistics record both attempts.
          if (a.annoy <= 0) {
            const alt = a.annoyReason === 'no-room'
              ? nextGoal(p, hour, this.rng, a.goal)
              : this.chooseGoal(a);
            a.lastGoal = a.goal;
            if (!this.dispatch(a, alt)) a.annoy = ANNOY_SECONDS * 1.4;
          }
          break;
        }
        case STATE.WALKING:
        case STATE.ENTERING:
        case STATE.LEAVING:
          this.walkStep(a, dt, dtSim);
          break;
        default: break;
      }

      // occupancy and wear, in simulated person-seconds
      if (a.state !== STATE.GONE) {
        const room = nav.roomAt(a.x, a.z, a.level);
        a.roomId = room;
        if (room) this.stats.occupy(room, dtSim);
        this.heat.add(a.x, a.z, a.level, dtSim * (a.walking ? 0.010 : 0.0016));
      }
    }
    this.visible = visible;
    this.blockedNow = blocked;
    this.stats.simSeconds += dtSim;
    this.stats.realSeconds += dt;
  }

  spawn(a) {
    const e = this.nav.mainEntrance;
    const L = this.nav.levels[e ? e.levelIdx : 0];
    if (!e) {
      // No exterior door at all. They stand outside the building and never get
      // in; the analysis has already said so, and here it is, happening.
      const b = this.nav.levels[0];
      a.x = b.minX - 2; a.z = b.minZ - 2; a.level = 0; a.y = b.elevation;
      a.state = STATE.BLOCKED; a.goal = 'arrive'; a.annoy = ANNOY_SECONDS * 3;
      a.annoyReason = 'no-route';
      this.stats.journeyStarted('arrive');
      this.stats.journeyFailed('arrive', 'no-route', a.p, { x: a.x, z: a.z, level: 0, hour: this.hour });
      return;
    }
    const spread = (this.rng() - 0.5) * 3.0;
    a.x = e.outX - e.nz * spread;
    a.z = e.outZ + e.nx * spread;
    a.level = e.levelIdx;
    a.y = L.elevation;
    a.yaw = Math.atan2(-e.nx, -e.nz);
    a.state = STATE.ENTERING;
    a.goal = 'arrive';
    this.stats.journeyStarted('arrive');
    const anchor = this.nav.roomPoint(e.roomId);
    const inside = e.cellIn >= 0
      ? this.nav.centreOf(e.cellIn)
      : (anchor ?? { x: e.x, z: e.z, y: L.elevation, level: e.levelIdx });
    a.path = [
      { x: a.x, z: a.z, y: a.y, level: a.level },
      { x: e.x, z: e.z, y: a.y, level: a.level },
      { x: inside.x, z: inside.z, y: inside.y, level: inside.level },
    ];
    a.pathIdx = 1;
    a.route = { length: 0, minWidth: e.width, doors: [e.openingId], cells: [], points: a.path };
  }

  /**
   * Standing still is not standing rigid: a shuffle, a turn of the head, and
   * enough personal space that two people who arrived at the same table do not
   * end up inside each other.
   */
  idleStep(a, dt) {
    a.bob = Math.sin(this.t * 1.4 + a.phase) * 0.004;
    a.yaw += Math.sin(this.t * 0.55 + a.phase) * dt * 0.25;
    a.vx = 0; a.vz = 0;
    let sx = 0, sz = 0;
    for (const o of this._near(a)) {
      if (o === a) continue;
      const ox = a.x - o.x, oz = a.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.62 || od < 1e-4) continue;
      sx += (ox / od) * (0.62 - od);
      sz += (oz / od) * (0.62 - od);
    }
    if (!sx && !sz) return;
    const nx = a.x + sx * dt * 2.4, nz = a.z + sz * dt * 2.4;
    if (this.nav.passable(this.nav.indexAt(nx, nz, a.level))) { a.x = nx; a.z = nz; }
  }

  walkStep(a, dt, dtSim) {
    const nav = this.nav;
    const path = a.path;
    if (!path || a.pathIdx >= path.length) {
      if (a.state === STATE.LEAVING) { a.state = STATE.GONE; this.stats.journeyDone('leave', a.route); return; }
      if (a.settling) { a.settling = false; a.state = STATE.IDLE; a.path = null; return; }
      this.stats.journeyDone(a.goal, a.route);
      this.arrive(a);
      return;
    }
    const target = path[a.pathIdx];

    // a stair is a level change, taken as one step
    if (target.level !== a.level) {
      a.level = target.level;
      a.y = nav.levels[target.level].elevation;
    }

    let dx = target.x - a.x, dz = target.z - a.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-6) { a.pathIdx++; return; }
    dx /= d; dz /= d;

    // -- crowd: separation, and the squeeze -------------------------------
    const width = nav.widthAt(a.x, a.z, a.level) || PASSING_WIDTH;
    let sx = 0, sz = 0, crowded = 0;
    for (const o of this._near(a)) {
      if (o === a) continue;
      const ox = a.x - o.x, oz = a.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od > 0.85 || od < 1e-4) continue;
      const push = (0.85 - od) / 0.85;
      sx += (ox / od) * push;
      sz += (oz / od) * push;
      if (od < 0.72) crowded++;
    }
    let speed = a.p.speed * a.speedScale;
    if (crowded) {
      if (width < PASSING_WIDTH) {
        // Two people, one width. They turn sideways and edge past — the exact
        // thing a 1.20 m corridor is for, made visible by its absence.
        speed *= 0.42;
        a.bob = Math.sin(this.t * 12 + a.phase) * 0.012;
        if (a.squeezeCooldown <= 0) {
          a.squeezeCooldown = 2.5;
          const cell = nav.indexAt(a.x, a.z, a.level);
          if (cell >= 0) this.stats.recordSqueeze(cell, a.x, a.z, a.level, width);
        }
      } else {
        speed *= 0.78;
      }
    }

    // steering = the path direction plus the separation push, kept on the mesh
    const bias = width < PASSING_WIDTH ? 0.18 : 0.55;
    let mx = dx + sx * bias, mz = dz + sz * bias;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;

    const step = speed * dt;
    let nx = a.x + mx * step, nz = a.z + mz * step;
    // Never let separation shove somebody through a wall — but only once they
    // are ON the mesh. Arriving and leaving happens OUTSIDE the building, where
    // there is no navmesh at all, and clamping to it there pinned everyone who
    // had just appeared on the pavement to the spot: every candidate step was
    // "not passable", so the fallback held them still and twenty-one people
    // stood outside their own front door for the whole day.
    const onMesh = nav.passable(nav.indexAt(a.x, a.z, a.level));
    if (onMesh && !nav.passable(nav.indexAt(nx, nz, a.level))) {
      nx = a.x + dx * step; nz = a.z + dz * step;
      if (!nav.passable(nav.indexAt(nx, nz, a.level))) {
        const near = nav.nearestPassable(nx, nz, a.level, 0.6);
        if (near >= 0) { const c = nav.centreOf(near); nx = c.x; nz = c.z; }
        else { nx = a.x; nz = a.z; }
      }
    }
    a.vx = (nx - a.x) / Math.max(dt, 1e-4);
    a.vz = (nz - a.z) / Math.max(dt, 1e-4);
    a.x = nx; a.z = nz;

    // face where you are going, but turn at a human rate
    const wantYaw = Math.atan2(a.vx, a.vz);
    let dyaw = wantYaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    a.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));

    // the walk cycle: one stride is about 0.72 m for an adult
    const stride = 0.36 * (a.p.height / 1.72);
    a.phase += (step / stride) * Math.PI;
    a.bob = Math.abs(Math.sin(a.phase)) * 0.018;

    if (d <= Math.max(0.16, step * 1.2)) a.pathIdx++;

    // -- doors -------------------------------------------------------------
    const doorId = nav.doorAt(a.x + dx * 0.9, a.z + dz * 0.9, a.level)
      ?? nav.doorAt(a.x, a.z, a.level);
    if (doorId) this.doors.push(doorId, 1.8);
  }

  _rebuildHash() {
    this._hash.clear();
    for (const a of this.agents) {
      if (!a.active) continue;
      const k = `${a.level}|${Math.floor(a.x)}|${Math.floor(a.z)}`;
      let arr = this._hash.get(k);
      if (!arr) { arr = []; this._hash.set(k, arr); }
      arr.push(a);
    }
  }

  _near(a) {
    const out = this._nearBuf;
    out.length = 0;
    const bx = Math.floor(a.x), bz = Math.floor(a.z);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const arr = this._hash.get(`${a.level}|${bx + di}|${bz + dj}`);
        if (arr) for (const o of arr) out.push(o);
      }
    }
    return out;
  }

  // -- rendering -----------------------------------------------------------

  registerPools(pool) {
    if (!pool.has('npc.torso')) {
      const unit = new BoxGeometry(1, 1, 1);
      const mat = tintedMaterial({ flatShading: true });
      pool.register('npc.torso', unit, mat);
      pool.register('npc.head', unit, mat);
      pool.register('npc.hair', unit, mat);
      pool.register('npc.leg', unit, mat);
      pool.register('npc.arm', unit, mat);
    }
    this.doors.registerPools(pool);
    if (!this._iconTex) {
      this._iconTex = buildIconAtlas();
      const mat = new MeshBasicMaterial({
        map: this._iconTex, transparent: true, depthWrite: false,
        side: DoubleSide, toneMapped: false,
      });
      this._iconMat = mat;
      ICONS.forEach((name, i) => {
        const geo = iconGeometry(i, name === 'alert' ? 0.40 : 0.30);
        this._iconGeo.set(name, geo);
        pool.register(`icon.${name}`, geo, mat, { castShadow: false, receiveShadow: false });
      });
    }
  }

  /**
   * Place every limb of every visible person. Five draw calls for the crowd,
   * two for the doors and one per icon kind actually on screen.
   */
  render(pool, camera) {
    const camPos = camera.position;
    this.doors.render(pool);

    for (const a of this.agents) {
      if (!a.active) continue;
      const p = a.p;
      const H = p.height;
      const dx = a.x - camPos.x, dz = a.z - camPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 60 * 60) continue;                 // beyond 60 m, not worth a matrix

      const legLen = H * 0.47;
      const torsoH = H * 0.29;
      const headS = H * 0.13;
      const base = a.y + a.bob;
      const cy_ = Math.cos(a.yaw), sy_ = Math.sin(a.yaw);

      // A limb hangs from a joint and swings about the person's own X axis, so
      // its centre is the joint plus R(yaw)*R(x,angle) applied to (0,-len/2,0):
      //   (-L/2 sin(ang) sin(yaw),  -L/2 cos(ang),  -L/2 sin(ang) cos(yaw))
      const limb = (name, jx, jy, jz, ang, len, thick, colour) => {
        const c = Math.cos(ang), sn = Math.sin(ang);
        _q.setFromAxisAngle(_up, a.yaw);
        _qLimb.setFromAxisAngle(AXIS_X, ang);
        _q.multiply(_qLimb);
        _p.set(jx - (len * 0.5) * sn * sy_, jy - (len * 0.5) * c, jz - (len * 0.5) * sn * cy_);
        _s.set(thick, len, thick);
        _m.compose(_p, _q, _s);
        pool.place(name, _m, colour);
      };

      // legs — hip rotation about the person's own X axis
      const swing = a.walking ? Math.sin(a.phase) * 0.55 : 0;
      const tap = a.state === STATE.BLOCKED ? Math.max(0, Math.sin(a.lookAbout * 9)) * 0.35 : 0;
      for (let s = -1; s <= 1; s += 2) {
        const legAng = (s > 0 ? swing : -swing) + (s > 0 ? tap : 0);
        limb('npc.leg',
          a.x + cy_ * (H * 0.075) * s, base + legLen, a.z - sy_ * (H * 0.075) * s,
          legAng, legLen, H * 0.085, p.trousers);
      }

      // torso
      _q.setFromAxisAngle(_up, a.yaw);
      _p.set(a.x, base + legLen + torsoH * 0.5, a.z);
      _s.set(H * 0.215, torsoH, H * 0.125);
      _m.compose(_p, _q, _s);
      pool.place('npc.torso', _m, p.cloth);

      // arms, counter-swinging
      const armLen = H * 0.30;
      const shY = base + legLen + torsoH - H * 0.02;
      for (let s = -1; s <= 1; s += 2) {
        const ang = (s > 0 ? -swing : swing) * 0.8;
        limb('npc.arm',
          a.x + cy_ * (H * 0.125) * s, shY, a.z - sy_ * (H * 0.125) * s,
          ang, armLen, H * 0.058, p.cloth);
      }

      // head — an annoyed person turns it, looking for the way through
      const headYaw = a.yaw + (a.state === STATE.BLOCKED ? Math.sin(a.lookAbout * 2.1) * 0.85 : 0);
      _q.setFromAxisAngle(_up, headYaw);
      const headY = base + legLen + torsoH + headS * 0.5 + H * 0.012;
      _p.set(a.x, headY, a.z);
      _s.set(headS * 0.86, headS, headS * 0.86);
      _m.compose(_p, _q, _s);
      pool.place('npc.head', _m, p.skin);

      _p.set(a.x, headY + headS * 0.44, a.z);
      _s.set(headS * 0.90, headS * 0.26, headS * 0.90);
      _m.compose(_p, _q, _s);
      pool.place('npc.hair', _m, p.hair);

      // -- the marker over the head ---------------------------------------
      let icon = null, colour = null;
      if (a.state === STATE.BLOCKED) {
        icon = 'alert';
        colour = a.annoyReason === 'no-room' ? 0xc9a227 : 0xb2472e;
      } else if (distSq < 12 * 12 && a.goal && GOALS[a.goal]) {
        icon = GOALS[a.goal].icon;
        colour = 0xf3ece1;
      }
      if (icon && pool.has(`icon.${icon}`)) {
        const bounce = a.state === STATE.BLOCKED ? Math.abs(Math.sin(a.lookAbout * 4)) * 0.06 : 0;
        _p.set(a.x, headY + headS * 0.9 + 0.20 + bounce, a.z);
        _q.copy(camera.quaternion);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        pool.place(`icon.${icon}`, _m, colour);
      }
    }
  }

  /** The person the crosshair is on, for the HUD read-out. */
  pick(camera, maxDist = 7) {
    const dir = camera.getWorldDirection(_dir);
    let best = null, bestDot = 0.985;
    for (const a of this.agents) {
      if (!a.active) continue;
      const dx = a.x - camera.position.x;
      const dz = a.z - camera.position.z;
      const dy = (a.y + a.p.height * 0.72) - camera.position.y;
      const d = Math.hypot(dx, dy, dz);
      if (d > maxDist || d < 0.2) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot > bestDot) { bestDot = dot; best = a; }
    }
    if (!best) return null;
    const g = GOALS[best.goal];
    let doing;
    if (best.state === STATE.BLOCKED) {
      doing = best.annoyReason === 'no-room'
        ? `${g ? g.label : best.goal} — there is no such room in this building`
        : `${g ? g.label : best.goal} — cannot get there from here`;
    } else if (best.state === STATE.IDLE) {
      doing = `${g ? g.label : 'settled in'}${best.roomId ? ` in the ${this.nav.labelOf(best.roomId)}` : ''}`;
    } else if (best.state === STATE.LEAVING) {
      doing = 'going home';
    } else {
      doing = `on the way — ${g ? g.label : best.goal}`;
    }
    return { label: best.p.label, doing, blocked: best.state === STATE.BLOCKED, agent: best };
  }

  dispose() {
    for (const g of this._iconGeo.values()) g.dispose();
    this._iconGeo.clear();
    this._iconTex?.dispose();
    this._iconMat?.dispose();
  }
}

export { STATE as NPC_STATE };
