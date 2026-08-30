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
import { PASSING_WIDTH, PERSON_WIDTH, WALL_CLEARANCE } from './navmesh.js';

/** Radius of a person for crowd separation. Half the shoulder width. */
export const PERSON_RADIUS = PERSON_WIDTH / 2;
/** How long an annoyed person stands there before trying something else. */
export const ANNOY_SECONDS = 7.5;
/** How close a person has to be to a door before they push it open. */
export const DOOR_TRIGGER = 1.6;
/**
 * How long somebody may make NO progress towards their next waypoint before
 * they re-plan. Real seconds, so it is independent of the clock's speed.
 *
 * Nothing in a crowd simulation stays on its polyline: separation pushes people
 * off it, and once off it the straight run to the next corner can graze a door
 * jamb the smoothed line cleared. Without this, an agent in that position walks
 * on the spot for the rest of the day and every statistic downstream — busiest
 * room, occupancy, the heat map — measures the bug instead of the building.
 */
export const STUCK_SECONDS = 2.5;
/** Consecutive stuck windows before we accept that there is no way through. */
export const MAX_REPLANS = 3;
/** How far ahead on the current segment a walker aims. Metres. */
const LOOKAHEAD = 0.55;
/**
 * How far the torso turns when somebody edges past another person in a passage
 * narrower than PASSING_WIDTH. Radians.
 *
 * 1.35 rad is 77 degrees, and the number is a measurement, not a look: a torso
 * is 0.215 H across the shoulders and 0.125 H front to back, so the width it
 * presents across the corridor is 0.215 |cos t| + 0.125 |sin t| of stature.
 * That is FLAT until well past 60 degrees — at 60 degrees a squeezing figure is
 * no narrower than a walking one, which is why a modest lean shows nothing. At
 * 77 degrees it is 0.170 H: an adult goes from 370 mm across to 293 mm, and the
 * shoulder visibly leads.
 */
const SQUEEZE_TURN = 1.35;
/** Most goal markers drawn in one frame, nearest and most annoyed first. */
const MAX_ICONS = 8;
/** Closest two markers may come on screen, in NDC (2 = the whole viewport). */
const ICON_SEPARATION = 0.14;
/**
 * The shortest visit the walkthrough can portray. The clock runs at five
 * simulated minutes per real second while people walk at their real speed, so a
 * courier with a four-minute delivery would be sent home from the pavement
 * before he reached the door. Everyone gets long enough to get in, do the one
 * thing they came for and walk out.
 */
const MIN_VISIT_HOURS = 0.75;

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
const _push = { x: 0, z: 0, moved: false };

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
        context: 'door', refDistance: 3, maxDistance: 22, rate: 0.94 + Math.random() * 0.12,
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
          refDistance: 3, maxDistance: 22, rate: 0.95 + Math.random() * 0.1,
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
    // The squeeze, as a body attitude rather than an event: `squeezeHold` is
    // how much longer the pinch lasts, `squeeze` is the eased 0..1 the mesh is
    // drawn from, `squeezeSide` which shoulder leads.
    this.squeezeHold = 0;
    this.squeeze = 0;
    this.squeezeSide = 1;
    this.roomId = null;
    this.vx = 0; this.vz = 0;
    this.bob = 0;
    this.lookAbout = 0;
    this.settling = 0;             // 0 none, 1 walking into the room, 2 walking to a spot
    this.home = new Map();         // goalKey -> the room that is THEIRS
    this.goalRoom = null;          // the room the FIELD was built for, not where we stand
    this.blockedRoom = null;       // the room they could not reach, for the marker
    this.pendingBlock = null;      // give up on arrival, at the point the route ran out
    this.stuckT = 0;               // real seconds without progress
    this.bestD = Infinity;         // closest we have been to the current waypoint
    this.replans = 0;
    this.leaveAt = person.leaveAt;
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
  constructor({ nav, stats, heat, occupancy = null, population, audio = null, rng = Math.random }) {
    this.nav = nav;
    this.stats = stats;
    // `heat` records metres walked; `occupancy` records seconds stood still.
    // Mixing them makes the busiest corridor in the building read as its
    // coldest floor — see the note in walk.js `_buildPeople`.
    this.heat = heat;
    this.occupancy = occupancy ?? heat;
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
    this._approach = new Map();      // roomId -> the reachable cell nearest to it
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

  /** Is this person off the navmesh altogether — i.e. still out on the site? */
  outside(a) {
    return !this.nav.passable(this.nav.indexAt(a.x, a.z, a.level));
  }

  /**
   * A route from where the person is ACTUALLY standing.
   *
   * Somebody who has just appeared on the pavement is seven metres from the
   * building and nowhere near the navmesh, so `nav.path` — which only looks
   * 1.5 m for a cell to start from — finds nothing and used to report the
   * drawing as unroutable. It is not: they walk to the front door first, and
   * the route proper starts there.
   */
  _route(a, field) {
    const nav = this.nav;
    let r = nav.path(a.x, a.z, a.level, field);
    if (r) return r;
    if (!this.outside(a)) return null;         // on the mesh: genuinely unreachable
    const e = nav.mainEntrance;
    if (!e || e.cellIn < 0) return null;
    const c = nav.centreOf(e.cellIn);
    r = nav.path(c.x, c.z, e.levelIdx, field);
    if (!r) return null;
    const L = nav.levels[e.levelIdx];
    const approach = [
      { x: a.x, z: a.z, y: a.y, level: a.level },
      { x: e.x, z: e.z, y: L.elevation, level: e.levelIdx },
    ];
    let extra = Math.hypot(e.x - a.x, e.z - a.z)
      + Math.hypot(r.points[0].x - e.x, r.points[0].z - e.z);
    return { ...r, points: approach.concat(r.points), length: r.length + extra };
  }

  /** The room this goal was routed to: their own if assigned, else the nearest. */
  _goalRoomFor(a, goalKey) {
    const g = GOALS[goalKey];
    if (g?.assigned && a.home.get(goalKey)) return a.home.get(goalKey);
    const rooms = this.nav.roomsForGoal(goalKey);
    if (!rooms.length) return null;
    let best = null, bd = Infinity;
    for (const id of rooms) {
      const p = this.nav.roomPoint(id);
      if (!p) continue;
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < bd) { bd = d; best = id; }
    }
    return best ?? rooms[0];
  }

  /**
   * WHERE THE MISSING DOOR SHOULD HAVE BEEN.
   *
   * DESIGN-DECISIONS: "an NPC with no route stops and visibly gets annoyed".
   * Stopping wherever they happened to be standing — six metres away, outside
   * a different room's door — tells the player nothing, and in a house with one
   * sealed study it reads as the bathroom being sealed. So the person walks as
   * far as the plan lets them and gives up AT THE OBSTRUCTION.
   *
   * "At the obstruction" is not the same as "nearest the room". Every wall of a
   * sealed study is equally close to it, and the plain nearest-cell answer put
   * everybody in the entrance hall against the study's party wall, 2.7 m
   * sideways from the wall the door plainly belongs in. The architect looking at
   * them is being shown the wrong wall.
   *
   * So the wall is chosen first, by the length of frontage the room shares with
   * space people can actually reach — the missing door belongs in the longest
   * wall between the sealed room and the circulation — and the person stands at
   * the middle of that frontage. Ties go to a corridor, then a hall, because
   * that is where a door would have been drawn. Nearest-cell remains the
   * fallback for a room with no usable frontage at all.
   *
   * One Dijkstra from the person finds their own island; the answer is cached
   * per room, because everybody stuck on the same side of the same wall shares
   * it.
   */
  _approachCell(a, roomId) {
    const nav = this.nav;
    const hit = this._approach.get(roomId);
    if (hit !== undefined) return hit;
    const target = nav.roomPoint(roomId);
    if (!target) { this._approach.set(roomId, -1); return -1; }
    const from = nav.passable(nav.indexAt(a.x, a.z, a.level))
      ? nav.indexAt(a.x, a.z, a.level)
      : (nav.mainEntrance ? nav.mainEntrance.cellIn : -1);
    if (from < 0) { this._approach.set(roomId, -1); return -1; }
    const mine = nav.field(`from:${from}`, [from]);
    const cells = nav.roomCells(roomId);
    const goalCells = new Set(cells);

    const frontage = this._bestFrontage(roomId, mine, goalCells);
    if (frontage >= 0) { this._approach.set(roomId, frontage); return frontage; }

    // The point to get close to is the ROOM, not its centre: somebody who
    // cannot reach a study stops against the wall that seals it, not two metres
    // short of it because that happens to be nearer the middle of the room.
    const marks = [];
    const stride = Math.max(1, Math.floor(cells.length / 80));
    const p = { x: 0, y: 0, z: 0, level: 0 };
    for (let i = 0; i < cells.length; i += stride) {
      nav.centreOf(cells[i], p);
      marks.push(p.x, p.z);
    }
    if (!marks.length) marks.push(target.x, target.z);
    let best = -1, bd = Infinity;
    const c = { x: 0, y: 0, z: 0, level: 0 };
    for (let k = 0; k < nav.pass.length; k++) {
      if (!nav.pass[k] || goalCells.has(k)) continue;
      if (!(mine.dist[k] < Infinity)) continue;
      nav.centreOf(k, c);
      let d = Infinity;
      for (let t = 0; t < marks.length; t += 2) {
        const dd = (c.x - marks[t]) * (c.x - marks[t]) + (c.z - marks[t + 1]) * (c.z - marks[t + 1]);
        if (dd < d) d = dd;
      }
      if (d < bd) { bd = d; best = k; }
    }
    this._approach.set(roomId, best);
    return best;
  }

  /**
   * The middle of the longest stretch of `roomId`'s perimeter that has
   * reachable floor on the other side of it. -1 when there is none.
   *
   * Walks each of the room's own walls at 0.20 m and asks, on both faces,
   * whether the cell just off the wall is floor this person can get to. The
   * wall with the most such samples is the one a door is missing from; the
   * standing point is the median sample along it, so the person is centred on
   * the frontage rather than jammed into its corner.
   */
  _bestFrontage(roomId, mine, goalCells) {
    const nav = this.nav;
    const room = nav.roomById.get(roomId);
    if (!room?.wallIds?.length) return -1;
    const li = nav.levels.findIndex((L) => L.levelId === room.levelId);
    if (li < 0) return -1;
    const RANK = { corridor: 0, hall: 1, stair: 2, reception: 3 };
    let bestCells = null, bestScore = -1, bestRank = 99;
    for (const wid of room.wallIds) {
      const w = nav.model.walls[wid];
      if (!w) continue;
      const a = nav.model.nodes[w.a], b = nav.model.nodes[w.b];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.4) continue;
      const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      const half = (w.thickness ?? 0.12) / 2;
      for (const side of [1, -1]) {
        let found = [];
        let kinds = new Map();
        // A cell only counts as floor once it is PERSON_WIDTH clear of
        // everything, so the first sample line has to stand a shoulder off the
        // face, not a grid cell — at 0.20 m every sample beside a 1.20 m
        // corridor wall read as impassable and no wall had any frontage at all.
        // Furniture pushed against a wall moves the line further out again.
        for (const stand of [PERSON_WIDTH, PERSON_WIDTH * 1.7, PERSON_WIDTH * 2.5]) {
          const off = half + stand;
          found = [];
          kinds = new Map();
          for (let t = nav.cell; t <= len - nav.cell; t += nav.cell) {
            const x = a.x + ux * t - uz * off * side;
            const z = a.z + uz * t + ux * off * side;
            const k = nav.indexAt(x, z, li);
            if (k < 0 || !nav.pass[k] || goalCells.has(k)) continue;
            if (!(mine.dist[k] < Infinity)) continue;
            found.push(k);
            const rk = nav.roomIdx[k] >= 0 ? nav.kindOf(nav.roomIds[nav.roomIdx[k]]) : null;
            if (rk) kinds.set(rk, (kinds.get(rk) ?? 0) + 1);
          }
          if (found.length >= 2) break;
        }
        if (found.length < 2) continue;
        let rank = 99;
        for (const kind of kinds.keys()) rank = Math.min(rank, RANK[kind] ?? 9);
        // longest reachable frontage first; a tie goes to the circulation side
        if (found.length > bestScore || (found.length === bestScore && rank < bestRank)) {
          bestScore = found.length; bestRank = rank; bestCells = found;
        }
      }
    }
    if (!bestCells) return -1;
    return bestCells[Math.floor(bestCells.length / 2)];
  }

  /** Walk as far towards an unreachable room as the plan allows, then give up. */
  _giveUpNear(a, goalKey) {
    const room = this._goalRoomFor(a, goalKey);
    const near = room ? this._approachCell(a, room) : -1;
    if (near >= 0) {
      const r = this._route(a, this.nav.field(`cell:${near}`, [near]));
      if (r && r.points.length > 1 && r.length > 0.4) {
        a.route = r;
        a.path = r.points;
        a.pathIdx = 1;
        a.state = STATE.WALKING;
        a.goalRoom = room;
        a.pendingBlock = { reason: 'no-route', roomId: room };
        a.bestD = Infinity; a.stuckT = 0; a.replans = 0;
        return true;
      }
    }
    this.blockAgent(a, 'no-route', room);
    return false;
  }

  /** Send an agent after a goal. Returns true when a route was found. */
  dispatch(a, goalKey) {
    const stats = this.stats;
    const nav = this.nav;
    a.goal = goalKey;
    a.pendingBlock = null;
    a.goalRoom = null;
    a.blockedRoom = null;
    a.settling = 0;
    a.bestD = Infinity;
    a.stuckT = 0;
    a.replans = 0;
    stats.journeyStarted(goalKey);

    if (goalKey === 'leave') {
      const e = nav.mainEntrance;
      if (this.outside(a)) {
        // Already out on the site — a short-stay visitor who never came in, or
        // somebody who has just stepped through the door. Walking away is not a
        // circulation failure and must not be written up as one.
        const L = nav.levels[e ? e.levelIdx : 0];
        a.route = { length: 0, minWidth: Infinity, doors: [], cells: [], points: [] };
        a.path = [
          { x: a.x, z: a.z, y: a.y, level: a.level },
          e ? { x: e.outX, z: e.outZ, y: L.elevation, level: e.levelIdx }
            : { x: a.x, z: a.z - 8, y: a.y, level: a.level },
        ];
        a.pathIdx = 1;
        a.state = STATE.LEAVING;
        return true;
      }
      const route = this._route(a, nav.fieldToOutside());
      if (!route) { this.blockAgent(a, 'no-route', null); return false; }
      a.route = route;
      a.path = route.points.slice();
      if (e) a.path.push({ x: e.outX, z: e.outZ, y: nav.levels[e.levelIdx].elevation, level: e.levelIdx });
      a.pathIdx = 1;
      a.state = STATE.LEAVING;
      return true;
    }

    const f = this.fieldFor(a, goalKey);
    if (!f) { this.blockAgent(a, 'no-room', null); return false; }
    const route = this._route(a, f);
    if (!route || !route.points.length) return this._giveUpNear(a, goalKey);
    const end = route.points[route.points.length - 1];
    a.goalRoom = nav.roomAt(end.x, end.z, end.level ?? a.level) ?? this._goalRoomFor(a, goalKey);
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
  blockAgent(a, reason, roomId = null) {
    a.state = STATE.BLOCKED;
    a.annoy = ANNOY_SECONDS;
    a.annoyReason = reason;
    a.blockedRoom = roomId ?? a.goalRoom ?? null;
    a.path = null;
    a.route = null;
    a.lookAbout = 0;
    a.settling = 0;
    a.pendingBlock = null;
    // Somebody standing on the pavement outside a building that HAS a usable
    // front door is not a defect in the drawing, and their trouble must never
    // reach the architect's report. A building with no exterior door at all is
    // a different matter, and `spawn` records that one itself.
    if (this.outside(a) && this.nav.mainEntrance) return;
    this.stats.journeyFailed(a.goal, reason, a.p, { x: a.x, z: a.z, level: a.level, hour: this.hour });
  }

  arrive(a) {
    const nav = this.nav;
    a.path = null;
    a.settling = 0;
    a.dwellUntil = this.hour + dwellFor(a.goal, this.rng) / 60;
    a.lastGoal = a.goal;
    // The room is the one the FIELD was built for. Reading it back off the
    // agent's own position credits the whole dwell to whatever room crowd
    // separation happened to nudge them into — which is how a child ends up
    // recorded as napping in the corridor.
    const room = a.goalRoom ?? nav.roomAt(a.x, a.z, a.level);
    a.goalRoom = room;
    a.roomId = room;
    this.stats.visit(room);
    if (a.goal === 'wc') a.wcNeed = 0;
    if (a.goal === 'coffee' || a.goal === 'eat') a.coffeeNeed = 0;

    // Nudged back over the threshold by the people behind them? Walk the last
    // metre or two in, properly, before settling.
    if (room && nav.roomAt(a.x, a.z, a.level) !== room) {
      const r = nav.path(a.x, a.z, a.level, nav.fieldToRoom(room));
      if (r && r.points.length > 1) {
        a.path = r.points;
        a.pathIdx = 1;
        a.settling = 1;
        a.state = STATE.WALKING;
        a.bestD = Infinity; a.stuckT = 0; a.replans = 0;
        return;
      }
    }
    this._settleStep(a);
  }

  /**
   * A distance field ends at the NEAREST cell of the goal room, which is the
   * cell just inside the door. Left there, twenty children arrive one after
   * another and stand in their own doorway in a heap. People walk INTO a room,
   * so the last leg is a short straight walk to somewhere with space around it
   * — line of sight only, no second search.
   */
  _settleStep(a) {
    const spot = this._spotIn(a, a.goalRoom ?? this.nav.roomAt(a.x, a.z, a.level));
    if (spot) {
      a.state = STATE.WALKING;
      a.settling = 2;
      a.path = [
        { x: a.x, z: a.z, y: a.y, level: a.level },
        { x: spot.x, z: spot.z, y: a.y, level: a.level },
      ];
      a.pathIdx = 1;
      a.bestD = Infinity; a.stuckT = 0; a.replans = 0;
      return;
    }
    a.settling = 0;
    a.path = null;
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
      // The turn is held for the length of the PINCH and eased in and out, so
      // it reads as somebody edging through rather than as a one-frame twitch.
      a.squeezeHold = Math.max(0, a.squeezeHold - dt);
      const wantSq = a.squeezeHold > 0 ? 1 : 0;
      a.squeeze += Math.max(-dt * 3.2, Math.min(dt * 3.2, wantSq - a.squeeze));

      // Going home overrides everything — except walking in. Sending somebody
      // home while they are still on the approach path stranded every
      // short-stay visitor (a courier's window is four minutes; the walk from
      // the pavement to the door is twenty simulated ones) outside the door for
      // the rest of the day.
      if (hour >= a.leaveAt && a.state !== STATE.LEAVING && a.state !== STATE.BLOCKED
          && a.state !== STATE.ENTERING) {
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
        if (a.walking) this.heat.add(a.x, a.z, a.level, dtSim * 0.010);
        else this.occupancy.add(a.x, a.z, a.level, dtSim * 0.0016);
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
    a.leaveAt = Math.max(a.p.leaveAt, this.hour + MIN_VISIT_HOURS);
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
    if (this.nav.crossesWall(a.x, a.z, nx, nz, a.level)) return;
    if (this.nav.passable(this.nav.indexAt(nx, nz, a.level))) { a.x = nx; a.z = nz; }
  }

  /** The end of a path: arrival, the way out, or the point the route ran out. */
  _pathDone(a) {
    if (a.state === STATE.LEAVING) {
      a.state = STATE.GONE;
      this.stats.journeyDone('leave', a.route);
      return;
    }
    if (a.pendingBlock) {
      const pb = a.pendingBlock;
      a.pendingBlock = null;
      this.blockAgent(a, pb.reason, pb.roomId);
      return;
    }
    if (a.settling === 1) { this._settleStep(a); return; }
    if (a.settling === 2) { a.settling = 0; a.path = null; a.state = STATE.IDLE; return; }
    this.stats.journeyDone(a.goal, a.route);
    this.arrive(a);
  }

  /**
   * No progress for STUCK_SECONDS. Re-plan from where the person actually is;
   * after MAX_REPLANS windows without progress, accept that this building will
   * not let them through and make the failure visible.
   */
  _unstick(a) {
    a.stuckT = 0;
    a.bestD = Infinity;
    a.replans++;
    if (a.settling) { a.settling = 0; a.path = null; a.state = STATE.IDLE; return; }
    if (a.pendingBlock) {
      const pb = a.pendingBlock;
      a.pendingBlock = null;
      this.blockAgent(a, pb.reason, pb.roomId);
      return;
    }
    if (a.replans > MAX_REPLANS) { this.blockAgent(a, 'no-route', a.goalRoom); return; }
    // The cheapest cure first: give up on this waypoint and steer for the next
    // one on the same polyline. A corner that cannot be stood exactly on is
    // still a corner you can walk past.
    if (a.path && a.pathIdx + 1 < a.path.length) { a.pathIdx++; return; }
    const field = a.state === STATE.LEAVING
      ? this.nav.fieldToOutside()
      : this.fieldFor(a, a.goal);
    const r = field && this._route(a, field);
    if (r && r.points.length > 1) {
      a.route = r;
      a.path = r.points.slice();
      if (a.state === STATE.LEAVING) {
        const e = this.nav.mainEntrance;
        if (e) a.path.push({ x: e.outX, z: e.outZ, y: this.nav.levels[e.levelIdx].elevation, level: e.levelIdx });
      }
      a.pathIdx = 1;
      return;
    }
    if (a.state === STATE.ENTERING) { a.state = STATE.IDLE; a.path = null; return; }
    this.blockAgent(a, 'no-route', a.goalRoom);
  }

  walkStep(a, dt, dtSim) {
    const nav = this.nav;
    const path = a.path;
    if (!path || a.pathIdx >= path.length) { this._pathDone(a); return; }
    const target = path[a.pathIdx];

    // a stair is a level change, taken as one step
    if (target.level !== a.level) {
      a.level = target.level;
      a.y = nav.levels[target.level].elevation;
    }

    const d = Math.hypot(target.x - a.x, target.z - a.z);
    if (d < 1e-6) { a.pathIdx++; a.bestD = Infinity; a.stuckT = 0; a.replans = 0; return; }

    // -- aim: re-acquire the polyline, do not cut across from where we drifted
    // Separation pushes people 0.2-0.4 m off the smoothed line. Steering
    // straight at the next corner from out there sends the run through the door
    // jamb the smoothed line cleared, and the walker grinds against the wall
    // for the rest of the day. Aiming at a point ON the segment, a little way
    // ahead, walks them back onto their own route first.
    const prev = path[a.pathIdx - 1];
    let ax = target.x, az = target.z;
    if (prev && prev.level === a.level) {
      const sxg = target.x - prev.x, szg = target.z - prev.z;
      const seg = Math.hypot(sxg, szg);
      if (seg > 1e-3) {
        let t = ((a.x - prev.x) * sxg + (a.z - prev.z) * szg) / (seg * seg);
        t = Math.min(1, Math.max(0, t) + LOOKAHEAD / seg);
        ax = prev.x + sxg * t; az = prev.z + szg * t;
      }
    }
    let dx = ax - a.x, dz = az - a.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-6) { dx = (target.x - a.x) / d; dz = (target.z - a.z) / d; }
    else { dx /= dl; dz /= dl; }

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
        // Two people, one width. They TURN SIDEWAYS and edge past — the exact
        // thing a 1.20 m corridor is for, made visible by its absence.
        //
        // This has to be visible on the body, not just in the log. A 12 mm bob
        // on a 1.72 m figure is nothing, and it was overwritten by the stride
        // bob forty lines further down in the same function anyway. So the
        // torso yaws towards the direction of travel until the shoulder leads:
        // at SQUEEZE_TURN the silhouette across the corridor goes from 0.215 H
        // to 0.170 H — a fifth narrower — and the arms stop swinging into the
        // wall. The head keeps facing where they are going.
        speed *= 0.42;
        if (a.squeeze < 0.05) {
          // lead with the shoulder AWAY from whoever is coming past
          a.squeezeSide = (dx * sz - dz * sx) >= 0 ? 1 : -1;
        }
        a.squeezeHold = Math.max(a.squeezeHold, 0.8);
        if (a.squeezeCooldown <= 0) {
          a.squeezeCooldown = 2.5;
          const cell = nav.indexAt(a.x, a.z, a.level);
          // The report prints this number in millimetres, so it has to be a
          // SPAN measured across the direction of travel, not this cell's own
          // distance to the nearest obstruction: standing against the skirting
          // of a 1.20 m corridor the distance transform reads 0.62 m, and an
          // architect handed that for a corridor he drew at 1200 stops
          // believing the rest of the page.
          if (cell >= 0) {
            const di = Math.abs(dx) >= Math.abs(dz) ? Math.sign(dx) : 0;
            const dj = di ? 0 : Math.sign(dz);
            const span = nav.passageWidth(cell, di, dj);
            if (span < PASSING_WIDTH) this.stats.recordSqueeze(cell, a.x, a.z, a.level, span);
          }
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
    // Two separate questions, and conflating them is what put four people
    // inside the front wall.
    //
    // "Is this cell floor?" is a question about the NAVMESH, and the navmesh
    // only describes the inside of the building. Arriving and leaving happen
    // out on the site, where there is no mesh at all, so that test has to be
    // off there — clamping to it pinned everyone who had just appeared on the
    // pavement to the spot, and it has to be off when the WAYPOINT is off the
    // mesh too, or a leaver standing on his own threshold has every step
    // towards the street rejected and never goes home.
    //
    // "Is there a wall in the way?" is a question about the BUILDING, and the
    // answer never depends on which side of the front door you are standing on.
    // It is asked on every step, in every state. Before it was, separation
    // pushed the arrival crowd sideways off the approach path and straight
    // through the 240 mm masonry beside the door reveal.
    const onMesh = nav.passable(nav.indexAt(a.x, a.z, a.level))
      && nav.passable(nav.indexAt(target.x, target.z, target.level ?? a.level));
    const tryStep = (ux, uz) => {
      // The wall answer is a PUSH, not a veto: the step is taken and then slid
      // out of any masonry it landed in. Vetoing it instead pinned people
      // against door jambs until the watchdog wrote "no route" into the report
      // about a doorway that works — a collision model must never invent a
      // finding about the drawing.
      const hit = nav.pushOutOfWalls(a.x + ux * step, a.z + uz * step, a.level, WALL_CLEARANCE, _push);
      const px = hit.x, pz = hit.z;
      if (hit.moved && Math.hypot(px - a.x, pz - a.z) < step * 0.12) return null;
      if (!onMesh || nav.passable(nav.indexAt(px, pz, a.level))) return [px, pz];
      return null;
    };
    // biased step, then the pure path direction, then slide along the wall.
    // Snapping back to the nearest passable cell centre, which is what this did
    // before, is a FIXED POINT: it returns the same cell every frame and the
    // walker never advances.
    let moved = tryStep(mx, mz) || tryStep(dx, dz);
    if (!moved) {
      const cands = Math.abs(dx) >= Math.abs(dz)
        ? [[Math.sign(dx), 0], [0, Math.sign(dz)]]
        : [[0, Math.sign(dz)], [Math.sign(dx), 0]];
      for (const [ux, uz] of cands) {
        if (!ux && !uz) continue;
        moved = tryStep(ux, uz);
        if (moved) break;
      }
    }
    const nx = moved ? moved[0] : a.x;
    const nz = moved ? moved[1] : a.z;
    a.vx = (nx - a.x) / Math.max(dt, 1e-4);
    a.vz = (nz - a.z) / Math.max(dt, 1e-4);
    a.x = nx; a.z = nz;

    // face where you are going, but turn at a human rate
    if (Math.abs(a.vx) > 1e-4 || Math.abs(a.vz) > 1e-4) {
      const wantYaw = Math.atan2(a.vx, a.vz);
      let dyaw = wantYaw - a.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      a.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));
    }

    // the walk cycle: one stride is about 0.72 m for an adult
    const stride = 0.36 * (a.p.height / 1.72);
    a.phase += (step / stride) * Math.PI;
    a.bob = Math.abs(Math.sin(a.phase)) * 0.018;

    // -- the watchdog ------------------------------------------------------
    const now = Math.hypot(target.x - a.x, target.z - a.z);
    if (now < a.bestD - 0.05) { a.bestD = now; a.stuckT = 0; }
    else a.stuckT += dt;

    if (now <= Math.max(0.16, step * 1.2)) {
      a.pathIdx++;
      a.bestD = Infinity; a.stuckT = 0; a.replans = 0;
    } else if (a.stuckT >= STUCK_SECONDS) {
      this._unstick(a);
      return;
    }

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
    const marks = (this._marks ??= []);
    marks.length = 0;

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
      // The body turns sideways in a squeeze; the head keeps facing the way
      // they are going, which is what makes it read as edging past rather than
      // as wandering off sideways.
      const bodyYaw = a.yaw + a.squeeze * SQUEEZE_TURN * a.squeezeSide;
      const cyB = Math.cos(bodyYaw), syB = Math.sin(bodyYaw);

      // A limb hangs from a joint and swings about the person's own X axis, so
      // its centre is the joint plus R(yaw)*R(x,angle) applied to (0,-len/2,0):
      //   (-L/2 sin(ang) sin(yaw),  -L/2 cos(ang),  -L/2 sin(ang) cos(yaw))
      const limb = (name, jx, jy, jz, ang, len, thick, colour) => {
        const c = Math.cos(ang), sn = Math.sin(ang);
        _q.setFromAxisAngle(_up, bodyYaw);
        _qLimb.setFromAxisAngle(AXIS_X, ang);
        _q.multiply(_qLimb);
        _p.set(jx - (len * 0.5) * sn * syB, jy - (len * 0.5) * c, jz - (len * 0.5) * sn * cyB);
        _s.set(thick, len, thick);
        _m.compose(_p, _q, _s);
        pool.place(name, _m, colour);
      };

      // legs — hip rotation about the person's own X axis
      const swing = a.walking ? Math.sin(a.phase) * 0.55 * (1 - 0.65 * a.squeeze) : 0;
      const tap = a.state === STATE.BLOCKED ? Math.max(0, Math.sin(a.lookAbout * 9)) * 0.35 : 0;
      for (let s = -1; s <= 1; s += 2) {
        const legAng = (s > 0 ? swing : -swing) + (s > 0 ? tap : 0);
        limb('npc.leg',
          a.x + cyB * (H * 0.075) * s, base + legLen, a.z - syB * (H * 0.075) * s,
          legAng, legLen, H * 0.085, p.trousers);
      }

      // torso
      _q.setFromAxisAngle(_up, bodyYaw);
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
          a.x + cyB * (H * 0.125) * s, shY, a.z - syB * (H * 0.125) * s,
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
      // Collected, not drawn: see _placeIcons. A dozen of these billboards
      // overlapping in a crowded entrance hall hid the room they were meant to
      // annotate, and several of them hung over the lawn with their person on
      // the far side of a wall.
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
        marks.push({
          icon, colour, agent: a, distSq,
          x: a.x, y: headY + headS * 0.9 + 0.20 + bounce, z: a.z,
        });
      }
    }
    this._placeIcons(pool, camera, marks);
  }

  /**
   * The markers, thinned to the ones a person could actually read.
   *
   * Three rules, in this order:
   *   1. A marker whose person is behind a wall is not drawn. The wall spans
   *      the walkers collide against are the same ones that block the sight
   *      line, so this costs one segment test per candidate.
   *   2. No two markers within ICON_SEPARATION of each other on screen. The
   *      nearer one wins, so the crowd in front reads and the crowd behind it
   *      does not smear into one white mass.
   *   3. At most MAX_ICONS a frame, nearest first, with the people who have
   *      GIVEN UP always ahead of the people who are merely going somewhere —
   *      the failures are the whole point of the walkthrough.
   */
  _placeIcons(pool, camera, marks) {
    if (!marks.length) return;
    const camLevel = this._levelAtY(camera.position.y);
    marks.sort((m, n) => {
      const bm = m.agent.state === STATE.BLOCKED ? 0 : 1;
      const bn = n.agent.state === STATE.BLOCKED ? 0 : 1;
      return bm - bn || m.distSq - n.distSq;
    });
    const taken = (this._iconScreen ??= []);
    taken.length = 0;
    let drawn = 0;
    for (const m of marks) {
      if (drawn >= MAX_ICONS) break;
      // 1. line of sight, through the real masonry
      if (m.agent.level === camLevel
        && this.nav.crossesWall(camera.position.x, camera.position.z, m.x, m.z, m.agent.level, 0)) continue;
      // 2. screen-space separation
      _p.set(m.x, m.y, m.z).project(camera);
      if (_p.z <= -1 || _p.z >= 1) continue;
      if (_p.x < -1.15 || _p.x > 1.15 || _p.y < -1.15 || _p.y > 1.15) continue;
      let clash = false;
      for (let i = 0; i < taken.length; i += 2) {
        if (Math.hypot(_p.x - taken[i], _p.y - taken[i + 1]) < ICON_SEPARATION) { clash = true; break; }
      }
      if (clash) continue;
      taken.push(_p.x, _p.y);
      _p.set(m.x, m.y, m.z);
      _q.copy(camera.quaternion);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      pool.place(`icon.${m.icon}`, _m, m.colour);
      drawn++;
    }
  }

  /** Which storey a world height belongs to. */
  _levelAtY(y) {
    let best = 0;
    for (let i = 0; i < this.nav.levels.length; i++) {
      if (y >= this.nav.levels[i].elevation - 0.1) best = i;
    }
    return best;
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
      const room = best.blockedRoom ? this.nav.labelOf(best.blockedRoom) : null;
      doing = best.annoyReason === 'no-room'
        ? `${g ? g.label : best.goal} — there is no such room in this building`
        : `${g ? g.label : best.goal} — cannot reach the ${room ?? 'room they need'} from here`;
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
