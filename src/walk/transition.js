// transition.js — "30 years later".
//
// A cut, not a fade. The screen does not just wash out and come back: the
// camera holds on the finished building on the day of handover, then thirty
// years run past in five seconds — the sun sweeping the facade over and over,
// the trees climbing past the eaves, the render going grey, a sign appearing
// beside the door, the floor inside wearing where people walk — a year counter
// ticking 2026 to 2056, and only then the hard cut to eye level.
//
// The time lapse is also when the WEAR IS EARNED. `presim` is called with the
// fraction of the thirty years that have passed, and the walkthrough uses it to
// run real journeys through the real navmesh and lay them into the heat map. By
// the time the player is standing in the entrance hall the floor already shows
// where thirty years of use went, because thirty years of use were simulated.

import { Vector3, MathUtils } from 'three';

export const HANDOVER_YEAR = 2026;
export const SPAN_YEARS = 30;

const PHASE = {
  HOLD: 'hold',
  LAPSE: 'lapse',
  CUT: 'cut',
  DONE: 'done',
};

const TIMES = ['morning', 'noon', 'afternoon', 'evening'];

export class Transition {
  /**
   * @param {object} o
   *   ui        the #ui element to hang the overlay on
   *   rig       the light rig from palette.makeLightRig
   *   camera    the mode's camera — driven for the whole sequence
   *   centre    {x, y, z} of the building
   *   radius    metres, half the building's largest plan dimension
   *   onAge     (0..1) => void, called every frame
   *   presim    (0..1) => void, called every frame during the lapse
   *   duration  seconds of the whole thing
   */
  constructor({ ui, rig, camera, centre, radius, onAge, presim = null, duration = 8.5, title = '' }) {
    this.ui = ui;
    this.rig = rig;
    this.camera = camera;
    this.centre = new Vector3(centre.x, centre.y, centre.z);
    this.radius = Math.max(6, radius);
    this.onAge = onAge;
    this.presim = presim;
    this.title = title;

    this.t = 0;
    this.holdFor = duration * 0.16;
    this.lapseFor = duration * 0.64;
    this.cutFor = duration * 0.20;
    this.duration = duration;
    this.phase = PHASE.HOLD;
    this.done = false;
    this.yaw = -0.75;

    this._states = this._captureSun();
    this._buildDom();
  }

  /**
   * Read the four times of day out of the rig itself rather than inventing a
   * second set of sun positions. palette.js owns the sun; this only replays it.
   */
  _captureSun() {
    const out = [];
    const before = this.rig.timeOfDay;
    for (const name of TIMES) {
      this.rig.setTimeOfDay(name);
      out.push({
        pos: this.rig.key.position.clone(),
        colour: this.rig.key.color.clone(),
        intensity: this.rig.key.intensity,
        hemi: this.rig.hemi.color.clone(),
        hemiGround: this.rig.hemi.groundColor.clone(),
        hemiI: this.rig.hemi.intensity,
      });
    }
    this.rig.setTimeOfDay(before);
    return out;
  }

  _buildDom() {
    const el = document.createElement('div');
    el.className = 'walk-transition';
    el.innerHTML = `
      <div class="wt-bar wt-top"></div>
      <div class="wt-bar wt-bottom"></div>
      <div class="wt-centre">
        <div class="wt-year">2026</div>
        <div class="wt-caption"></div>
        <div class="wt-sub"></div>
      </div>
      <div class="wt-wipe"></div>`;
    this.el = el;
    this.yearEl = el.querySelector('.wt-year');
    this.captionEl = el.querySelector('.wt-caption');
    this.subEl = el.querySelector('.wt-sub');
    this.wipeEl = el.querySelector('.wt-wipe');
    this.captionEl.textContent = 'Handover';
    this.subEl.textContent = this.title;
    this.ui.appendChild(el);
  }

  /** Where the camera sits while the years go by. */
  _placeCamera(k) {
    const r = MathUtils.lerp(this.radius * 3.1, this.radius * 2.1, k);
    const h = MathUtils.lerp(this.radius * 1.15, this.radius * 0.72, k);
    this.yaw += 0.0;      // set per frame by update()
    this.camera.position.set(
      this.centre.x + Math.sin(this.yaw) * r,
      this.centre.y + h,
      this.centre.z + Math.cos(this.yaw) * r,
    );
    this.camera.lookAt(this.centre.x, this.centre.y + this.radius * 0.18, this.centre.z);
  }

  /** Interpolate the sun continuously round the captured day. */
  _sunAt(u) {
    const n = this._states.length;
    const f = u * n;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const k = f - Math.floor(f);
    const a = this._states[i], b = this._states[j];
    const key = this.rig.key, hemi = this.rig.hemi;
    key.position.lerpVectors(a.pos, b.pos, k);
    key.color.copy(a.colour).lerp(b.colour, k);
    key.intensity = MathUtils.lerp(a.intensity, b.intensity, k);
    hemi.color.copy(a.hemi).lerp(b.hemi, k);
    hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, k);
    hemi.intensity = MathUtils.lerp(a.hemiI, b.hemiI, k);
  }

  update(dt) {
    if (this.done) return true;
    this.t += dt;

    if (this.t < this.holdFor) {
      this.phase = PHASE.HOLD;
      const k = this.t / this.holdFor;
      this.yaw = -0.75 + k * 0.06;
      this._placeCamera(0);
      this.onAge?.(0);
      this.el.style.setProperty('--wt-bars', '1');
      this.wipeEl.style.opacity = String(Math.max(0, 1 - k * 2.4));
      this.yearEl.textContent = String(HANDOVER_YEAR);
      return false;
    }

    const tl = this.t - this.holdFor;
    if (tl < this.lapseFor) {
      if (this.phase !== PHASE.LAPSE) {
        this.phase = PHASE.LAPSE;
        this.captionEl.textContent = '30 years later';
      }
      // ease so the first years crawl and the last ones blur past
      const raw = tl / this.lapseFor;
      const k = raw * raw * (3 - 2 * raw);
      this.yaw = -0.69 + k * 1.25;
      this._placeCamera(k);
      // twelve days go by; the sun sweeps the facade twelve times
      this._sunAt((raw * 12) % 1);
      this.onAge?.(k);
      this.presim?.(k);
      const year = Math.round(HANDOVER_YEAR + k * SPAN_YEARS);
      this.yearEl.textContent = String(year);
      this.wipeEl.style.opacity = '0';
      this.subEl.textContent = this.title;
      return false;
    }

    const tc = tl - this.lapseFor;
    if (tc < this.cutFor) {
      if (this.phase !== PHASE.CUT) {
        this.phase = PHASE.CUT;
        this.rig.setTimeOfDay('afternoon');
      }
      const k = tc / this.cutFor;
      this.onAge?.(1);
      this.yearEl.textContent = String(HANDOVER_YEAR + SPAN_YEARS);
      this.yaw = 0.56 + k * 0.10;
      this._placeCamera(1);
      // the cut: hard to black over the last third, then straight into the eye
      this.wipeEl.style.opacity = String(MathUtils.clamp((k - 0.55) / 0.35, 0, 1));
      this.el.style.setProperty('--wt-bars', String(1 - MathUtils.clamp((k - 0.6) / 0.4, 0, 1)));
      return false;
    }

    this.phase = PHASE.DONE;
    this.done = true;
    this.onAge?.(1);
    this.rig.setTimeOfDay('afternoon');
    return true;
  }

  /** Fade the black away once the first-person camera is in place. */
  reveal(dt) {
    const cur = parseFloat(this.wipeEl?.style.opacity || '0');
    if (!this.wipeEl) return true;
    const next = Math.max(0, cur - dt * 1.6);
    this.wipeEl.style.opacity = String(next);
    if (next <= 0.001) { this.dispose(); return true; }
    return false;
  }

  dispose() {
    this.el?.remove();
    this.el = null;
    this.wipeEl = null;
  }
}
