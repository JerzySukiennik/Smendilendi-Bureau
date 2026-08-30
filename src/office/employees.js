// employees.js — hireable staff: the seat, the presence and the money.
//
// DESIGN-DECISIONS.md: "Hireable employees at three tiers: intern (cheap, makes
// mistakes you must fix), architect (solid), partner (excellent, expensive). A
// hired employee gets their own cubicle with a nameplate and actually designs
// their assigned scope."
//
// This module builds everything EXCEPT the designing. An employee is modelled
// as a bot player: it takes a cubicle, it is visibly at its desk, it has a
// nameplate, it draws a salary — and every change it will eventually make to
// the building goes out through the SAME op channel a human uses:
//
//   employee.emitOp({ t:'wall.add', ... })
//     -> net.sendOp({ ...op, by: employee.id })
//
// so a later piece only has to supply the decisions. Nothing downstream needs
// to know whether an op came from a person or from an intern.

import { Group, Mesh, BoxGeometry, SphereGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { MeshBuilder, builderMaterial, OFFICE } from './props.js';
import { makeFloatingNick, makeNameplate } from './desks.js';
import { EMPLOYEE_TIERS, employeeTier } from './upgrades.js';
import { rectSegments } from './player.js';
import { FIRST_NAMES, SURNAMES, pickPersonName } from '../commission/names.js';

/**
 * Three cubicles along the south side of the studio, facing the window wall.
 * Each is 1.60 x 1.55 with a 1.35 m felt screen on two sides — a real cubicle,
 * not a cardboard box, and 1.30 m of circulation behind the chairs.
 */
export const CUBICLES = [
  { index: 0, x: 5.10, z: 6.10, ry: Math.PI },
  { index: 1, x: 6.95, z: 6.10, ry: Math.PI },
  { index: 2, x: 8.80, z: 6.10, ry: Math.PI },
];

const SKIN = [0xd8b48c, 0xc39a72, 0x9c7248, 0x6f4e34, 0xe6c9a8];
const SHIRT = [0x6c655c, 0x55504a, 0x8f877b, 0x35566e, 0x3a3835];

/** A seated low-poly figure, ~1.72 m standing, built once and cloned per hire. */
function buildBody(shirt, skin) {
  const b = new MeshBuilder();
  b._ao = false;
  // seated: hips at 0.46, torso to 1.02, head centre 1.19
  b.boxUp(0.34, 0.42, 0.24, { y: 0.48, color: shirt });                    // torso
  b.boxUp(0.30, 0.10, 0.22, { y: 0.44, color: shirt, shade: 0.85 });       // shoulders/base
  b.boxUp(0.36, 0.14, 0.44, { y: 0.40, z: 0.10, color: 0x4a453f });        // thighs
  for (const sx of [-1, 1]) {
    b.boxUp(0.11, 0.44, 0.12, { x: sx * 0.10, y: 0.0, z: 0.28, color: 0x4a453f });  // shins
    b.boxUp(0.10, 0.05, 0.22, { x: sx * 0.10, y: 0.0, z: 0.36, color: OFFICE.charcoal }); // shoes
  }
  b.cylUp(0.055, 0.05, 0.09, 8, { y: 0.90, color: skin });                 // neck
  b.add(new SphereGeometry(0.105, 10, 7), { y: 1.03, s: [1, 1.12, 0.94], color: skin });
  b.add(new SphereGeometry(0.108, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62),
    { y: 1.045, s: [1, 1.05, 0.98], color: 0x3a322a });                    // hair
  return b.build();
}

let _bodyCache = new Map();
function bodyMeshes(shirt, skin) {
  const key = `${shirt}|${skin}`;
  if (!_bodyCache.has(key)) _bodyCache.set(key, buildBody(shirt, skin));
  return _bodyCache.get(key);
}

export class Employee {
  constructor({ id, name, tier, cubicle, net = null, seed = 1 }) {
    this.id = id;
    this.name = name;
    this.tier = tier;
    this.spec = employeeTier(tier);
    this.cubicle = cubicle;
    this.net = net;
    this.busy = false;
    this.task = null;
    this.progress = 0;
    this.opsSent = 0;

    const shirt = SHIRT[seed % SHIRT.length];
    const skin = SKIN[(seed * 7) % SKIN.length];

    this.group = new Group();
    this.group.name = `employee-${id}`;
    this.group.position.set(cubicle.x, 0, cubicle.z + 0.62);
    this.group.rotation.y = cubicle.ry;

    this.body = new Group();
    for (const { mat, geometry } of bodyMeshes(shirt, skin)) {
      const m = new Mesh(geometry, builderMaterial(mat));
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
    }
    this.group.add(this.body);

    // arms are separate so they can type
    this.arms = [];
    for (const sx of [-1, 1]) {
      const arm = new Group();
      arm.position.set(sx * 0.19, 0.86, 0.02);
      const shirtMat = new MeshStandardMaterial({ color: shirt, roughness: 0.80, flatShading: true });
      const skinMat = new MeshStandardMaterial({ color: skin, roughness: 0.85, flatShading: true });
      const upper = new Mesh(new BoxGeometry(0.09, 0.30, 0.09), shirtMat);
      upper.position.y = -0.15;
      upper.castShadow = true;
      arm.add(upper);
      const fore = new Group();
      fore.position.y = -0.30;
      const f = new Mesh(new BoxGeometry(0.075, 0.27, 0.075), skinMat);
      f.position.y = -0.135;
      f.castShadow = true;
      fore.add(f);
      arm.add(fore);
      arm.userData.fore = fore;
      arm.rotation.x = -1.15;
      fore.rotation.x = 0.95;
      this.body.add(arm);
      this.arms.push(arm);
    }

    this.nick = makeFloatingNick(name, '#a89f92');
    this.nick.position.set(0, 1.52, 0);
    this.group.add(this.nick);

    this.plate = makeNameplate(name.split(' ')[0], this.spec.id === 'partner' ? '#d4763a' : '#8f877b');
    this.plate.position.set(-0.52, 1.29, -0.10);
    this.plate.rotation.y = Math.PI;
    this.group.add(this.plate);

    this._t = seed * 1.7;
  }

  /** The one channel an employee's design work is allowed to use. */
  emitOp(op) {
    this.opsSent++;
    if (this.net?.sendOp) return this.net.sendOp({ ...op, by: this.id });
    return null;
  }

  assign(task) { this.task = task; this.busy = !!task; this.progress = 0; }

  update(dt, cameraPos) {
    this._t += dt;
    // typing: forearms tick, torso breathes, head glances at the screen
    const typing = this.busy ? 1 : 0.45;
    for (let i = 0; i < this.arms.length; i++) {
      const a = this.arms[i];
      const ph = this._t * (7.5 + i * 1.3) + i * 2.1;
      a.userData.fore.rotation.x = 0.95 + Math.sin(ph) * 0.06 * typing;
      a.rotation.x = -1.15 + Math.sin(ph * 0.5) * 0.03 * typing;
    }
    this.body.position.y = Math.sin(this._t * 1.6) * 0.006;
    this.body.rotation.y = Math.sin(this._t * 0.31) * 0.10;
    if (cameraPos) this.nick.lookAt(cameraPos.x, this.nick.getWorldPosition(_v).y, cameraPos.z);
    // The office-wide focus multiplier: a hot cup of coffee makes the room work
    // faster for as long as it stays hot (office.js applyFocus/_decayFocus).
    // 0 -> 1.0x, 1 -> 1.5x.
    const focus = 1 + (this.focus || 0) * 0.5;
    if (this.busy) this.progress = Math.min(1, this.progress + dt * 0.02 * this.spec.speed * focus);
  }
}

const _v = new Vector3();

export class Staff {
  /**
   * @param {THREE.Object3D} parent   where cubicle occupants are added
   * @param {Economy} economy
   * @param {object} opts { net, state, rng }
   */
  constructor(parent, economy, opts = {}) {
    this.parent = parent;
    this.economy = economy;
    this.net = opts.net || null;
    this.state = opts.state || null;
    this.list = [];
    this.rng = opts.rng || Math.random;
    this._seq = 0;
  }

  get free() { return CUBICLES.filter((c) => !this.list.some((e) => e.cubicle.index === c.index)); }

  cost(tierId) { return employeeTier(tierId).hire; }

  /** @returns {{ ok, reason?, employee? }} */
  hire(tierId) {
    const spec = employeeTier(tierId);
    const cub = this.free[0];
    if (!cub) return { ok: false, reason: 'Every cubicle is taken.' };
    if (!this.economy.canAfford(spec.hire)) {
      return { ok: false, reason: `Hiring a ${spec.name.toLowerCase()} costs ${this.economy.format(spec.hire)}.` };
    }
    this.economy.debit(spec.hire, `Hired ${spec.name}`);
    const seed = ++this._seq;
    const name = pickPersonName(this.rng, this.list.map((e) => e.name))
      || `${FIRST_NAMES[seed % FIRST_NAMES.length]} ${SURNAMES[(seed * 5) % SURNAMES.length]}`;
    const e = new Employee({
      id: `emp-${seed}-${spec.id}`, name, tier: spec.id, cubicle: cub, net: this.net, seed,
    });
    this.list.push(e);
    this.parent.add(e.group);
    this._sync();
    return { ok: true, employee: e };
  }

  fire(id) {
    const i = this.list.findIndex((e) => e.id === id);
    if (i < 0) return false;
    const [e] = this.list.splice(i, 1);
    this.parent.remove(e.group);
    this._sync();
    return true;
  }

  payrollPerCommission() {
    return this.list.reduce((n, e) => n + e.spec.salary, 0);
  }

  _sync() {
    this.state?.set('office.employees', this.list.map((e) => ({
      id: e.id, name: e.name, tier: e.tier, cubicle: e.cubicle.index,
    })));
  }

  /** Office-wide focus, 0..1. Set by office.js when somebody sips hot coffee. */
  setFocus(f) {
    this.focus = f || 0;
    for (const e of this.list) e.focus = this.focus;
  }

  update(dt, cameraPos) {
    for (const e of this.list) e.update(dt, cameraPos);
  }

  /** Plan colliders for the occupied cubicles' chairs, so you cannot walk through staff. */
  colliders() {
    const out = [];
    for (const e of this.list) out.push(...rectSegments(e.group.position.x, e.group.position.z, 0.56, 0.56, 0));
    return out;
  }
}

export { EMPLOYEE_TIERS };
