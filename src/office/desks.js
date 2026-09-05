// desks.js — one workstation per player.
//
// A workstation is: the desk and pedestal (merged into the room's static batch),
// a task chair, a monitor whose screen carries the in-game OS as a LIVE TEXTURE,
// a 3D-text nameplate with the player's nick, and four pieces of personalisation
// that every other player can see — plant, poster, figurine and mug colour.
//
// The screen is the interesting part. src/os/ is another agent's piece and may
// not exist yet, so this module defines the contract and ships a working stand-in:
//
//   INTERFACE (implement in src/os/, export from src/os/os.js)
//     createOsSurface({ width, height, tier, playerId, state })
//       -> { texture,                       // THREE.Texture, updated by the OS
//            update(dt),                    // called every frame while visible
//            pointer(u, v, buttons),        // u,v in 0..1 from the screen quad
//            key(event),                    // forwarded while focused
//            focus(on), dispose() }
//
//   Until it exists, PlaceholderOs below draws a fictional retro desktop on a
//   canvas — a real, ticking, readable screen, so the monitor is never a black
//   rectangle in a screenshot.

import {
  Group, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace,
  BoxGeometry, MeshStandardMaterial, Color, PointLight,
} from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import {
  MONITOR_SCREEN, MONITOR_ANCHOR, OFFICE, ACCENT, MeshBuilder, builderMaterial,
  propPlantSmall, propMug, propSheet, chamferBoxGeometry,
} from './props.js';
import { materialFor } from '../core/palette.js';

const FONT_URL = 'https://unpkg.com/three@0.180.0/examples/fonts/helvetiker_bold.typeface.json';

let _fontPromise = null;
export function loadNameplateFont() {
  if (!_fontPromise) {
    _fontPromise = new Promise((res) => {
      new FontLoader().load(FONT_URL, res, undefined, () => {
        console.info('[office] nameplate font unavailable — falling back to engraved plates');
        res(null);
      });
    });
  }
  return _fontPromise;
}

// ---------------------------------------------------------------------------
// The stand-in OS. Deliberately not a mock: it ticks, the clock is real, and it
// is drawn from reference/retro-os so it reads as the right machine.

const OS_THEMES = [
  { // tier 1 — Pentagram 133: 4-bit teal desktop, chunky chrome
    desk: '#2c7a72', face: '#c3c3c3', shadow: '#7f7f7f', light: '#f0f0f0',
    bar: '#000082', text: '#000000', barText: '#ffffff', name: 'PENTAGRAM 133',
  },
  { desk: '#3a6ea5', face: '#d4d0c8', shadow: '#808080', light: '#ffffff',
    bar: '#0a246a', text: '#000000', barText: '#ffffff', name: 'KOMPAKT 2000' },
  { desk: '#5b6d84', face: '#dddad2', shadow: '#8b877e', light: '#ffffff',
    bar: '#2e3d52', text: '#1a1a1a', barText: '#f2f2f2', name: 'SUNSTATION PRO' },
  { desk: '#7d8791', face: '#eceae5', shadow: '#9b968d', light: '#ffffff',
    bar: '#3c3c40', text: '#141414', barText: '#ffffff', name: 'MELON STUDIO M5' },
];

export class PlaceholderOs {
  constructor({ width = 512, height = 306, tier = 1, nick = 'Architect' } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.tier = tier;
    this.nick = nick;
    this._acc = 0;
    this._caret = 0;
    this.draw();
  }

  setTier(t) { this.tier = t; this.draw(); }

  update(dt) {
    this._acc += dt;
    this._caret += dt;
    if (this._acc >= 0.5) { this._acc = 0; this.draw(); }
  }

  draw() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    const t = OS_THEMES[Math.min(OS_THEMES.length - 1, Math.max(0, this.tier - 1))];
    const px = Math.max(1, Math.round(W / 512));
    g.imageSmoothingEnabled = false;

    g.fillStyle = t.desk; g.fillRect(0, 0, W, H);

    // desktop icons
    const icons = [['Editor', ACCENT], ['Mail', '#e8e2d4'], ['Chat', '#cfd8d0'], ['Costs', '#d8cfae']];
    icons.forEach(([label, col], i) => {
      const x = 14 * px, y = (14 + i * 46) * px;
      g.fillStyle = typeof col === 'number' ? '#d4763a' : col;
      g.fillRect(x, y, 26 * px, 22 * px);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + 3 * px, y + 22 * px, 26 * px, 3 * px);
      g.fillStyle = '#ffffff';
      g.font = `${9 * px}px "Lucida Console", Monaco, monospace`;
      g.fillText(label, x - 2 * px, y + 34 * px);
    });

    const win = (x, y, w, h, title, body) => {
      g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(x + 3 * px, y + 3 * px, w, h);
      g.fillStyle = t.face; g.fillRect(x, y, w, h);
      g.fillStyle = t.light; g.fillRect(x, y, w, px); g.fillRect(x, y, px, h);
      g.fillStyle = t.shadow; g.fillRect(x, y + h - px, w, px); g.fillRect(x + w - px, y, px, h);
      g.fillStyle = t.bar; g.fillRect(x + 2 * px, y + 2 * px, w - 4 * px, 14 * px);
      g.fillStyle = t.barText;
      g.font = `bold ${9 * px}px "Lucida Console", Monaco, monospace`;
      g.fillText(title, x + 6 * px, y + 12 * px);
      g.fillStyle = t.face;
      g.fillRect(x + w - 16 * px, y + 4 * px, 10 * px, 10 * px);
      g.fillStyle = t.text;
      g.font = `${9 * px}px "Lucida Console", Monaco, monospace`;
      body(g, x + 7 * px, y + 28 * px, w - 14 * px, px);
    };

    win(96 * px, 16 * px, 200 * px, 118 * px, 'Mail — Inbox', (c, x, y, w, p) => {
      const rows = [
        ['●', 'Kowalski Family', 'Detached house, 4 beds'],
        ['', 'City of Gzowo', 'RE: kindergarten brief'],
        ['', 'Bureau accounts', 'Fee 24 000 received'],
      ];
      rows.forEach((r, i) => {
        c.fillStyle = i === 0 ? '#ffffff' : 'rgba(0,0,0,0.04)';
        c.fillRect(x - 2 * p, y - 9 * p + i * 22 * p, w + 4 * p, 20 * p);
        c.fillStyle = '#d4763a'; c.fillText(r[0], x, y + i * 22 * p);
        c.fillStyle = t.text;
        c.font = `bold ${9 * p}px "Lucida Console", Monaco, monospace`;
        c.fillText(r[1], x + 10 * p, y + i * 22 * p);
        c.font = `${8 * p}px "Lucida Console", Monaco, monospace`;
        c.fillStyle = '#5a5a5a';
        c.fillText(r[2], x + 10 * p, y + 9 * p + i * 22 * p);
      });
    });

    win(150 * px, 140 * px, 190 * px, 96 * px, 'Cost sheet', (c, x, y, w, p) => {
      const rows = [['Structure', '128 400'], ['Envelope', '96 250'], ['Finishes', '41 900'], ['Total', '266 550']];
      rows.forEach((r, i) => {
        c.fillStyle = i === 3 ? t.text : '#3a3a3a';
        c.font = `${i === 3 ? 'bold ' : ''}${9 * p}px "Lucida Console", Monaco, monospace`;
        c.fillText(r[0], x, y + i * 15 * p);
        c.textAlign = 'right';
        c.fillText(r[1], x + w - 4 * p, y + i * 15 * p);
        c.textAlign = 'left';
      });
      c.fillStyle = '#b9b3a6'; c.fillRect(x, y + 58 * p, w - 4 * p, 8 * p);
      c.fillStyle = '#d4763a'; c.fillRect(x, y + 58 * p, (w - 4 * p) * 0.82, 8 * p);
    });

    // taskbar
    g.fillStyle = t.face; g.fillRect(0, H - 20 * px, W, 20 * px);
    g.fillStyle = t.light; g.fillRect(0, H - 20 * px, W, px);
    g.fillStyle = t.text;
    g.font = `bold ${9 * px}px "Lucida Console", Monaco, monospace`;
    g.fillRect(4 * px, H - 17 * px, 52 * px, 14 * px);
    g.fillStyle = t.face;
    g.fillText('START', 8 * px, H - 6 * px);
    g.fillStyle = t.text;
    g.font = `${9 * px}px "Lucida Console", Monaco, monospace`;
    g.fillText(t.name, 66 * px, H - 6 * px);
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    g.textAlign = 'right';
    g.fillText(clock, W - 8 * px, H - 6 * px);
    g.textAlign = 'left';

    this.texture.needsUpdate = true;
  }

  pointer() {}
  key() {}
  focus() {}
  dispose() { this.texture.dispose(); }
}

/**
 * Try the real OS module, fall back to the stand-in.
 *
 * The fallback used to be silent: `catch (_) {}` with no logging, so an OS that
 * half-loaded was indistinguishable from one that worked, and the office would
 * quietly ship the stand-in for the rest of the session. It now says so, loudly
 * and once, with the actual error.
 */
let _fallbackWarned = false;
export async function createScreen(opts) {
  try {
    const mod = await import('../os/os.js');
    if (mod?.createOsSurface) return await mod.createOsSurface(opts);
    throw new Error('src/os/os.js exports no createOsSurface');
  } catch (err) {
    if (!_fallbackWarned) {
      _fallbackWarned = true;
      console.warn('[office] the real OS did not load — desk monitors are running the '
        + 'PlaceholderOs stand-in. Reason:', err);
    }
  }
  return new PlaceholderOs(opts);
}

/**
 * Mean and peak luma of whatever a screen surface is currently painting.
 * Used by office.js to assert that a monitor is not a black rectangle; a
 * screen that never lights is the one defect a screenshot cannot show you,
 * because a black screen and a missing screen look identical.
 */
export function screenLuma(surface) {
  const src = surface?.canvas || surface?.texture?.image;
  if (!src || !src.width) return null;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = Math.max(1, Math.round(96 * src.height / src.width));
  const g = c.getContext('2d', { willReadFrequently: true });
  try { g.drawImage(src, 0, 0, c.width, c.height); } catch (_) { return null; }
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l;
    if (l > max) max = l;
  }
  return { mean: sum / (d.length / 4), max };
}

// ---------------------------------------------------------------------------

/**
 * Nameplate: extruded 3D text on a small plate, exactly as DESIGN-DECISIONS.md
 * asks ("a nameplate with the player's nick in 3D text"). 14 mm cap height,
 * 4 mm extrusion, on a 40 mm brushed plate — a real desk nameplate.
 */
export function makeNameplate(nick, colorHex) {
  const g = new Group();
  g.name = 'nameplate';
  // Chamfered, like every other object in the room: a brushed nameplate is
  // 60 mm from the player's eye when they sit down and a hard arris on it is
  // the first thing that reads as untooled.
  const plate = new Mesh(chamferBoxGeometry(0.24, 0.052, 0.018, 0.003), materialFor('metal'));
  plate.position.y = 0.026;
  plate.castShadow = true; plate.receiveShadow = true;
  g.add(plate);
  const strip = new Mesh(new BoxGeometry(0.24, 0.008, 0.004), new MeshStandardMaterial({
    color: new Color(colorHex || ACCENT), roughness: 0.55,
  }));
  strip.position.set(0, 0.004, 0.009);
  g.add(strip);

  loadNameplateFont().then((font) => {
    if (!font || !g.parent) return;
    const geo = new TextGeometry(String(nick).slice(0, 14), {
      font, size: 0.014, depth: 0.004, curveSegments: 2, bevelEnabled: false,
    });
    geo.computeBoundingBox();
    const w = geo.boundingBox.max.x - geo.boundingBox.min.x;
    geo.translate(-w / 2, 0, 0);
    const m = new Mesh(geo, materialFor('ink'));
    m.position.set(0, 0.020, 0.009);
    m.castShadow = false;
    g.add(m);
    g.userData.text = m;
  });
  return g;
}

/** A floating nick above another player's or an employee's head. */
export function makeFloatingNick(nick, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(24,22,20,0.72)';
  roundRect(g, 4, 12, 248, 40, 8); g.fill();
  g.fillStyle = colorHex || '#d4763a';
  roundRect(g, 4, 12, 6, 40, 3); g.fill();
  g.fillStyle = '#f3ece1';
  g.font = 'bold 24px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(nick).slice(0, 14), 132, 33);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const m = new Mesh(new PlaneGeometry(0.46, 0.115), new MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false,
  }));
  m.renderOrder = 6;
  return m;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------------------

export const PERSONALISATION = {
  plants: ['none', 'succulent', 'fern', 'cactus'],
  posters: ['none', 'plan', 'section', 'photo'],
  figurines: ['none', 'duck', 'obelisk', 'arch'],
  mugColors: [0xe9e6df, 0x8f877b, 0x4e5b66, 0x7f9a52, 0xd4763a, 0x9c8f7c],
};

/**
 * One workstation. `slot` fixes where it stands; `player` may be null (an empty
 * desk waiting for someone to join), in which case the screen sleeps.
 */
export class Workstation {
  /**
   * @param {object} slot { x, z, ry, index }
   */
  constructor(slot) {
    this.slot = slot;
    this.group = new Group();
    this.group.name = `workstation-${slot.index}`;
    this.group.position.set(slot.x, 0, slot.z);
    this.group.rotation.y = slot.ry || 0;
    // `undefined` means "never assigned", which is NOT the same thing as an
    // assigned-but-empty desk (`null`). assignPlayers() compared `ws.player?.id`
    // with `p?.id`, and for a never-assigned empty slot both sides were
    // undefined, so the guard skipped it forever: two of three monitors had no
    // OS, no texture and no glow — the dead black rectangle the class comment
    // below explicitly forbids.
    this.player = undefined;
    this.assigned = false;
    this.os = null;
    this.screen = null;
    this.nameplate = null;
    this.glow = null;
    this.personalGroup = null;
    this.personal = { plant: 'succulent', poster: 'plan', figurine: 'duck', mugColor: 0 };

    // The screen: a plain unlit quad. A monitor is an emitter, not a lit
    // surface — lighting it with the room's key would make it grey.
    //
    // MONITOR_SCREEN is monitor-local; MONITOR_ANCHOR is where the monitor
    // stands on the desk. Both are needed, and forgetting the second one is
    // what buried the whole in-game OS under the desk for three rounds.
    const geo = new PlaneGeometry(MONITOR_SCREEN.w, MONITOR_SCREEN.h);
    this.screen = new Mesh(geo, new MeshBasicMaterial({ color: 0x101214, toneMapped: false }));
    this.screen.position.set(
      0,
      MONITOR_ANCHOR.y + MONITOR_SCREEN.y,
      MONITOR_ANCHOR.z + MONITOR_SCREEN.z + 0.001,
    );
    this.screen.name = 'screen';
    this.screen.userData.workstation = this;
    this.group.add(this.screen);

    // The monitor throws a little cool light back into the room — light source
    // number four, and by far the coolest colour temperature in the frame.
    this.glow = new PointLight(0x9fc4e8, 0.0, 2.6, 2.0);
    this.glow.position.set(
      0,
      MONITOR_ANCHOR.y + MONITOR_SCREEN.y,
      MONITOR_ANCHOR.z + MONITOR_SCREEN.z + 0.34,
    );
    this.group.add(this.glow);
  }

  /** Screen centre in world space — the camera flies to a point off this. */
  screenWorld(target) {
    this.screen.getWorldPosition(target);
    return target;
  }

  /**
   * Assign a player, or null for an empty desk.
   *
   * An empty desk still runs its machine — it sits at the desktop with the
   * backlight down, the way an office looks when someone is at lunch. A black
   * rectangle would be one fewer light source and one more dead hole in the
   * frame, and it would not be true to a studio either.
   */
  async assign(player, { tier = 1, ctx = null } = {}) {
    this.player = player || null;
    this.assigned = true;
    if (ctx) this.ctx = ctx;
    if (this.nameplate) { this.group.remove(this.nameplate); this.nameplate = null; }
    if (player) {
      this.nameplate = makeNameplate(player.nick, player.color);
      this.nameplate.position.set(0.53, 0.74, 0.16);
      this.nameplate.rotation.y = -0.35;
      this.group.add(this.nameplate);
    }
    this.buildPersonal();
    if (!this.os) {
      // The session HAS to travel into the machine. Without `state` the OS
      // constructs every app against a null store, so Mail falls back to its
      // own sample inbox and the brief the loop posted — and, worse, the
      // client's list of things to fix — is never readable on the desk the
      // core loop runs through. Measured 2026-08-30: the play-through opened
      // Mail on the player's own monitor and read "Detached house, ul. Lipowa
      // 14", a placeholder, while state.mail held the real letter.
      // `audio` is what makes the mail chime and the keyboard audible; `net`
      // is what Chat talks over.
      this.os = await createScreen({
        width: 545, height: 325, tier,
        nick: player?.nick || 'idle', playerId: player?.id || null,
        state: this.ctx?.state || null,
        audio: this.ctx?.audio || null,
        net: this.ctx?.net || null,
      });
      this.screen.material.map = this.os.texture;
      this.screen.material.needsUpdate = true;
      // Arrival should never show a black rectangle, and the player should still
      // get to watch his own machine come to life. Those are not in conflict —
      // they just want different states.
      //
      // Other people's desks are ALREADY ON: skip their boot straight to the
      // desktop, so the room reads as an occupied studio the moment you walk in.
      //
      // The player's own machine is OFF. A dark screen on an unused computer is
      // correct, not a bug — and OS.focus() switches it on, so the POST and the
      // startup chime play when he sits down and clicks the monitor, which is
      // exactly where DESIGN-DECISIONS.md puts the per-tier OS identity.
      //
      // (Round 3 of this file made BOTH cases skip the boot, to fix the player's
      // monitor being a black rectangle for the first 5 s. That cured the symptom
      // by deleting the feature: the startup sequence never played at all. Jurek
      // caught it immediately — "czemu komputery są już włączone od początku?")
      // EVERY MACHINE STARTS OFF, not just the player's own.
      //
      // Supersedes "an empty desk still runs its machine ... the way an office
      // looks when someone is at lunch". Jurek, third playtest, items 8 and 11:
      // "workstation 3 is always on" and "all the computers should switch off
      // when you leave". An unattended desk sitting at a lit desktop for the
      // whole session is exactly what he is looking at, and the two reports are
      // one wish: a machine is on while somebody is using it and dark
      // otherwise. It costs the room a little cool light, which the window and
      // the desk lamps already carry.
      this.powerOff();
    }
    this.setScreenLit(false);
    this.assertPainting();
    return this;
  }

  /**
   * The standing assertion, checked the moment a desk is assigned rather than
   * nine seconds later by an audit nobody reads.
   *
   * A monitor that paints nothing is the one defect a screenshot cannot show
   * you, because a black screen and a missing screen look identical. Finish bar
   * item 1 counts prop types and the signature interaction of the whole game is
   * "click the monitor", so a dead screen fails both at once.
   */
  assertPainting(min = 12) {
    // A machine we deliberately switched off is supposed to be dark. Only a
    // screen that is meant to be painting and is not counts as the defect.
    if (this.os?.os?.phase === 'off') { this.lastLuma = null; return true; }
    const l = screenLuma(this.os);
    const ok = !!l && l.mean > min;
    if (!ok) {
      console.error(`[office] workstation ${this.slot.index} (${this.player?.nick || 'empty'}) `
        + 'is painting NOTHING — the desk monitor is a black rectangle. '
        + 'luma:', l, 'os phase:', this.os?.os?.phase);
    }
    this.lastLuma = l;
    return ok;
  }

  /**
   * The screen's own brightness and the light it throws into the room.
   *
   * One place, because the two used to be set together in `assign` and nowhere
   * else — so a machine switched off later stayed bright, and a machine
   * switched on stayed dim.
   */
  setScreenLit(on) {
    const lit = on ? 1.0 : 0.06;
    this.screen.material.color.setScalar(lit);
    this.glow.intensity = on ? 1.5 : 0;
  }

  /** Cut the power to this desk's machine, so it can be switched on later. */
  powerOff() {
    this.setScreenLit(false);
    const raw = this.os?.os;
    if (raw?.powerOff) { raw.powerOff(); this.os.update?.(0); return true; }
    return false;
  }

  /** Jump a surface straight to the desktop — through the SURFACE, not the OS. */
  skipBoot(tier = 1) {
    // Through `this.os.setTier` (the surface adapter), never `this.os.os.setTier`
    // (the raw OS). The adapter is what re-lays-out the view canvas and drops
    // the stale GPU texture when the resolution changes with the tier; calling
    // past it left the desk showing a black rectangle at the new tier.
    if (this.os?.setTier) { this.os.setTier(tier, { boot: false }); this.os.update?.(0); return true; }
    const raw = this.os?.os;
    if (raw?.setTier) { raw.setTier(tier, { boot: false }); this.os.update?.(0); return true; }
    // Fallback for any surface without that hook: run it forward until it
    // paints something. 12 s of simulated time, capped.
    for (let i = 0; i < 240; i++) {
      this.os?.update?.(0.05);
      const l = screenLuma(this.os);
      if (l && l.mean > 20) return true;
    }
    return false;
  }

  /**
   * A new machine on this desk.
   *
   * The player's own machine BOOTS: DESIGN-DECISIONS.md puts the per-tier OS
   * identity — "a new OS theme, cursor and startup sound each time" — on the act
   * of buying, and a POST you watch is how a new computer announces itself.
   * Nobody else's does, because three machines booting in unison is three
   * startup chimes over each other and a studio that looks like it lost power.
   */
  setTier(tier) {
    // EVERY DESK TAKES THE NEW MACHINE, whoever bought it. Jurek, item 10:
    // "the OS does not update on the guest after the host upgrades it." The
    // upgrade is the office's, not one player's, so a desk that keeps the old
    // tier is a desk showing a computer the studio no longer owns. Only the
    // machine the buyer is sitting at plays the POST and the startup chime;
    // the others change quietly, because three startup sounds at once is a
    // studio that sounds like it lost power.
    this.tier = tier;
    if (this.player && this.os?.os?.phase !== 'off') { this.os?.setTier?.(tier); return; }
    if (this.os?.setTier) this.os.setTier(tier, { boot: false });
    this.powerOff();
  }

  // -- desk personalisation ---------------------------------------------------
  //
  // DESIGN-DECISIONS.md: "Desk personalisation (plant, poster, figurine, mug
  // colour) visible to other players." PERSONALISATION used to be an exported
  // constant with no consumer anywhere in src/ — the list existed, the meshes
  // did not. These four choices are now real geometry on the desk, rebuilt in
  // place when the player changes them from the management panel, and they ride
  // the same shared-state path as everything else so the other two architects
  // see them.

  setPersonal(patch = {}) {
    Object.assign(this.personal, patch);
    this.buildPersonal();
    return this.personal;
  }

  buildPersonal() {
    if (this.personalGroup) {
      this.group.remove(this.personalGroup);
      for (const m of this.personalGroup.children) { m.geometry.dispose(); }
      this.personalGroup = null;
    }
    if (!this.player) return null;      // an empty desk is bare, and that reads
    const p = this.personal;
    const b = new MeshBuilder();

    // plant — desk end, far side from the mouse hand
    if (p.plant && p.plant !== 'none') {
      const seed = { succulent: 5, fern: 17, cactus: 41 }[p.plant] || 5;
      b.at({ x: -0.62, y: 0.74, z: 0.06 }, (q) => propPlantSmall(q, {
        seed, pot: p.plant === 'cactus' ? 0xc9a07a : OFFICE.ceramic,
      }));
    }
    // figurine — 60-90 mm of nonsense on top of the monitor's plinth
    if (p.figurine && p.figurine !== 'none') {
      b.at({ x: 0.30, y: 0.74, z: -0.16 }, (q) => figurine(q, p.figurine));
    }
    // poster — an A4 print in a clip frame, standing against the desk return
    if (p.poster && p.poster !== 'none') {
      b.at({ x: 0.70, y: 0.74, z: -0.20, ry: -0.42, rx: -0.16 }, (q) => {
        q.boxUp(0.012, 0.30, 0.014, { x: -0.10, color: OFFICE.steelDark, mat: 'metal', ao: false });
        q.boxUp(0.012, 0.30, 0.014, { x: 0.10, color: OFFICE.steelDark, mat: 'metal', ao: false });
        q.at({ y: 0.16 }, (r) => propSheet(r, {
          w: 0.21, h: 0.297,
          color: p.poster === 'photo' ? 0xd8cfbe : OFFICE.paper,
          ink: p.poster === 'section' ? OFFICE.charcoal : 0x8b8478,
        }));
      });
    }
    // the player's own mug, in their chosen colour
    const mugCol = PERSONALISATION.mugColors[p.mugColor % PERSONALISATION.mugColors.length];
    b.at({ x: 0.46, y: 0.74, z: 0.22, ry: 0.6 }, (q) => propMug(q, { color: mugCol, full: true }));

    const g = new Group();
    g.name = 'personalisation';
    for (const { mat, geometry } of b.build()) {
      const m = new Mesh(geometry, builderMaterial(mat));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    this.group.add(g);
    this.personalGroup = g;
    return g;
  }

  update(dt, visible) {
    if (visible) this.os?.update?.(dt);
  }

  dispose() {
    this.os?.dispose?.();
    this.screen.geometry.dispose();
    this.screen.material.dispose();
    if (this.personalGroup) for (const m of this.personalGroup.children) m.geometry.dispose();
  }
}

/** 60-90 mm of desk nonsense. Three shapes, all instantly readable at 2 m. */
function figurine(b, kind) {
  if (kind === 'duck') {
    b.cylUp(0.030, 0.034, 0.030, 10, { color: 0xe8c341, mat: 'flat', ao: false });
    b.sphere(0.026, 8, { y: 0.048, s: [1, 0.9, 1.15], color: 0xe8c341, mat: 'flat', ao: false });
    b.sphere(0.017, 7, { y: 0.072, z: 0.012, color: 0xe8c341, mat: 'flat', ao: false });
    b.boxUp(0.012, 0.008, 0.020, { y: 0.070, z: 0.030, color: 0xd4763a, mat: 'flat', ao: false });
  } else if (kind === 'obelisk') {
    b.cboxUp(0.052, 0.012, 0.052, { color: OFFICE.charcoal, mat: 'ink', ao: false, c: 0.003 });
    b.add(new BoxGeometry(0.030, 0.075, 0.030), { y: 0.050, s: [1, 1, 1], color: 0xdad3c4, mat: 'flat', ao: false });
    b.add(new BoxGeometry(0.030, 0.026, 0.030), { y: 0.100, s: [0.35, 1, 0.35], color: 0xdad3c4, mat: 'flat', ao: false });
  } else {                                     // 'arch' — a model of an arch
    b.cboxUp(0.070, 0.010, 0.040, { color: OFFICE.ply, ao: false, c: 0.003 });
    b.cboxUp(0.016, 0.058, 0.030, { x: -0.024, y: 0.010, color: 0xe7e0d1, mat: 'paper', ao: false, c: 0.003 });
    b.cboxUp(0.016, 0.058, 0.030, { x: 0.024, y: 0.010, color: 0xe7e0d1, mat: 'paper', ao: false, c: 0.003 });
    b.cboxUp(0.064, 0.014, 0.030, { y: 0.068, color: 0xe7e0d1, mat: 'paper', ao: false, c: 0.003 });
  }
}

/**
 * Desk positions. Three workstations in a row facing south, backs to the brick
 * pin-up wall, window light arriving from the right — the way a studio is
 * actually laid out, because nobody sits facing a window.
 */
export const DESK_SLOTS = [
  { index: 0, x: 5.40, z: 2.80, ry: 0 },
  { index: 1, x: 7.70, z: 2.80, ry: 0 },
  { index: 2, x: 10.00, z: 2.80, ry: 0 },
];
