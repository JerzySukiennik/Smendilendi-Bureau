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
import { MONITOR_SCREEN, OFFICE, ACCENT } from './props.js';
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

/** Try the real OS module, fall back to the stand-in. */
export async function createScreen(opts) {
  try {
    const mod = await import('../os/os.js');
    if (mod?.createOsSurface) return mod.createOsSurface(opts);
  } catch (_) { /* the OS piece is not in yet */ }
  return new PlaceholderOs(opts);
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
  const plate = new Mesh(new BoxGeometry(0.24, 0.052, 0.018), materialFor('metal'));
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
  mugColors: [0xe9e6df, 0x8f877b, 0x35566e, 0x7f9a52, 0xd4763a, 0x9c8f7c],
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
    this.player = null;
    this.os = null;
    this.screen = null;
    this.nameplate = null;
    this.glow = null;
    this.personal = { plant: 'succulent', poster: 'plan', figurine: 'duck', mugColor: 0 };

    // The screen: a plain unlit quad. A monitor is an emitter, not a lit
    // surface — lighting it with the room's key would make it grey.
    const geo = new PlaneGeometry(MONITOR_SCREEN.w, MONITOR_SCREEN.h);
    this.screen = new Mesh(geo, new MeshBasicMaterial({ color: 0x101214, toneMapped: false }));
    this.screen.position.set(0, MONITOR_SCREEN.y, MONITOR_SCREEN.z + 0.001);
    this.screen.name = 'screen';
    this.screen.userData.workstation = this;
    this.group.add(this.screen);

    // The monitor throws a little cool light back into the room — light source
    // number four, and by far the coolest colour temperature in the frame.
    this.glow = new PointLight(0x9fc4e8, 0.0, 1.9, 2.0);
    this.glow.position.set(0, MONITOR_SCREEN.y, MONITOR_SCREEN.z + 0.30);
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
  async assign(player, { tier = 1 } = {}) {
    this.player = player;
    if (this.nameplate) { this.group.remove(this.nameplate); this.nameplate = null; }
    if (player) {
      this.nameplate = makeNameplate(player.nick, player.color);
      this.nameplate.position.set(0.53, 0.74, 0.16);
      this.nameplate.rotation.y = -0.35;
      this.group.add(this.nameplate);
    }
    if (!this.os) {
      this.os = await createScreen({
        width: 512, height: 306, tier,
        nick: player?.nick || 'idle', playerId: player?.id || null,
      });
      this.screen.material.map = this.os.texture;
      this.screen.material.needsUpdate = true;
    }
    const lit = player ? 1.0 : 0.34;
    this.screen.material.color.setScalar(lit);
    this.glow.intensity = 0.55 * lit;
  }

  setTier(tier) { this.os?.setTier?.(tier); }

  update(dt, visible) {
    if (visible) this.os?.update?.(dt);
  }

  dispose() {
    this.os?.dispose?.();
    this.screen.geometry.dispose();
    this.screen.material.dispose();
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
