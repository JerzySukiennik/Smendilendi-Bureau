// player.js — first-person movement in the office.
//
// No physics engine (ARCHITECTURE.md rule 2). The player is a vertical capsule
// of radius 0.32 m; the world is a list of plan SEGMENTS. Every wall, every
// desk, every plan chest contributes segments, so one solver handles all of it:
// push the circle out of any segment it overlaps, three relaxation passes.
//
// Dimensions are a person's, not a shooter's:
//   eye height        1.62 m standing, 1.05 m crouched, 1.21 m seated
//   shoulder radius   0.32 m
//   walk              1.35 m/s   (a studio is not a racetrack)
//   hurry             2.30 m/s
//   step length       0.72 m  -> the footstep and the head bob share one phase

import { Vector3, MathUtils } from 'three';

export const PLAYER = {
  radius: 0.32,
  eye: 1.62,
  eyeCrouch: 1.05,
  eyeSeated: 1.21,
  walk: 1.35,
  run: 2.30,
  accel: 14,
  damp: 12,
  stepLength: 0.72,
  bobAmp: 0.022,
  bobSide: 0.014,
  pitchMin: -1.35,
  pitchMax: 1.35,
};

/** Squared distance from point (px,pz) to segment, plus the closest point. */
function closestOnSegment(px, pz, s, out) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - s.x1) * dx + (pz - s.z1) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = s.x1 + dx * t;
  out.z = s.z1 + dz * t;
  const ex = px - out.x, ez = pz - out.z;
  return ex * ex + ez * ez;
}

/** An oriented rectangle in plan -> four segments. */
export function rectSegments(cx, cz, w, d, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const hw = w / 2, hd = d / 2;
  const pt = (x, z) => ({ x: cx + x * c + z * s, z: cz - x * s + z * c });
  const a = pt(-hw, -hd), b = pt(hw, -hd), e = pt(hw, hd), f = pt(-hw, hd);
  return [
    { x1: a.x, z1: a.z, x2: b.x, z2: b.z },
    { x1: b.x, z1: b.z, x2: e.x, z2: e.z },
    { x1: e.x, z1: e.z, x2: f.x, z2: f.z },
    { x1: f.x, z1: f.z, x2: a.x, z2: a.z },
  ];
}

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} opts { colliders, spawn:{x,z,yaw}, surfaces:[{x0,z0,x1,z1,kind}] }
   */
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.pos = new Vector3(opts.spawn?.x ?? 12.0, 0, opts.spawn?.z ?? 8.4);
    this.vel = new Vector3();
    this.yaw = opts.spawn?.yaw ?? Math.PI * 0.78;
    this.pitch = 0;
    this.colliders = opts.colliders || [];
    this.surfaces = opts.surfaces || [];
    this.crouch = false;
    this.enabled = true;

    this.stepPhase = 0;
    this.distance = 0;
    this._bob = 0;
    this._eye = PLAYER.eye;
    this._tmp = { x: 0, z: 0 };
    this.onFootstep = null;         // (surfaceKind, speed) => void
    this.seat = null;               // { x, z, yaw, eye } while seated
    this._seatBlend = 0;
  }

  setColliders(list) {
    this.colliders = list;
    // cheap broadphase: each segment's plan AABB, fattened by the capsule radius
    for (const s of this.colliders) {
      s._minx = Math.min(s.x1, s.x2) - PLAYER.radius - 0.05;
      s._maxx = Math.max(s.x1, s.x2) + PLAYER.radius + 0.05;
      s._minz = Math.min(s.z1, s.z2) - PLAYER.radius - 0.05;
      s._maxz = Math.max(s.z1, s.z2) + PLAYER.radius + 0.05;
    }
  }

  surfaceAt(x, z) {
    for (const s of this.surfaces) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s.kind;
    }
    return 'tile';
  }

  look(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = MathUtils.clamp(this.pitch + dPitch, PLAYER.pitchMin, PLAYER.pitchMax);
  }

  sit(seat) { this.seat = seat; }
  stand() { this.seat = null; }

  update(dt, input) {
    const seated = !!this.seat;
    this._seatBlend = MathUtils.damp(this._seatBlend, seated ? 1 : 0, 9, dt);

    if (this.enabled && input && !seated) {
      const ax = input.axis2();
      const speed = input.down('sprint') ? PLAYER.run : PLAYER.walk;
      const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      // yaw 0 looks down -z, the three.js convention the camera already uses
      const fx = -sn, fz = -cs;
      const rx = cs, rz = -sn;
      const wish = this._tmp;
      wish.x = (fx * ax.y + rx * ax.x) * speed;
      wish.z = (fz * ax.y + rz * ax.x) * speed;
      this.crouch = input.down('crouch');
      const k = this.crouch ? 0.45 : 1;
      this.vel.x = MathUtils.damp(this.vel.x, wish.x * k, PLAYER.accel, dt);
      this.vel.z = MathUtils.damp(this.vel.z, wish.z * k, PLAYER.accel, dt);
    } else {
      this.vel.x = MathUtils.damp(this.vel.x, 0, PLAYER.damp, dt);
      this.vel.z = MathUtils.damp(this.vel.z, 0, PLAYER.damp, dt);
    }

    const step = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (!seated && step > 1e-5) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this._resolve();
      this.distance += step;

      // head bob and footsteps share one phase, so the foot lands at the bottom
      const prev = this.stepPhase;
      this.stepPhase = (this.distance / PLAYER.stepLength) % 1;
      if (this.stepPhase < prev) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        this.onFootstep?.(this.surfaceAt(this.pos.x, this.pos.z), sp);
      }
    } else if (!seated) {
      this.stepPhase = MathUtils.damp(this.stepPhase, Math.round(this.stepPhase), 6, dt);
    }

    // -- camera ------------------------------------------------------------
    const moving = Math.hypot(this.vel.x, this.vel.z);
    const bobT = this.stepPhase * Math.PI * 2;
    const amt = Math.min(1, moving / PLAYER.walk);
    this._bob = MathUtils.damp(this._bob, amt, 8, dt);
    const bobY = Math.sin(bobT * 2) * PLAYER.bobAmp * this._bob;
    const bobX = Math.sin(bobT) * PLAYER.bobSide * this._bob;

    const targetEye = this.crouch ? PLAYER.eyeCrouch : PLAYER.eye;
    this._eye = MathUtils.damp(this._eye, targetEye, 10, dt);

    let cx = this.pos.x, cz = this.pos.z, cy = this._eye + bobY;
    let yaw = this.yaw;
    if (this._seatBlend > 0.001 && this.seat) {
      const t = this._seatBlend;
      cx = MathUtils.lerp(cx, this.seat.x, t);
      cz = MathUtils.lerp(cz, this.seat.z, t);
      cy = MathUtils.lerp(cy, this.seat.eye ?? PLAYER.eyeSeated, t);
      yaw = MathUtils.lerp(yaw, this.seat.yaw ?? yaw, t);
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, yaw, bobX * 0.35);
  }

  /** Push the capsule out of every segment it overlaps. Three relaxation passes. */
  _resolve() {
    const r = PLAYER.radius;
    const p = this._tmp;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const s of this.colliders) {
        if (this.pos.x < s._minx || this.pos.x > s._maxx || this.pos.z < s._minz || this.pos.z > s._maxz) continue;
        const d2 = closestOnSegment(this.pos.x, this.pos.z, s, p);
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        let nx, nz;
        if (d > 1e-6) { nx = (this.pos.x - p.x) / d; nz = (this.pos.z - p.z) / d; }
        else {
          // dead centre on the segment: push along its normal
          const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
          const l = Math.hypot(dx, dz) || 1;
          nx = -dz / l; nz = dx / l;
        }
        const push = r - d;
        this.pos.x += nx * push;
        this.pos.z += nz * push;
        // kill the velocity component into the wall so we slide, not stick
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) { this.vel.x -= nx * vn; this.vel.z -= nz * vn; }
        moved = true;
      }
      if (!moved) break;
    }
  }

  /** Where the player is looking, as a world direction. */
  forward(target = new Vector3()) {
    return target.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}
