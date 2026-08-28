// surface.js — the adapter that puts the real OS on a desk monitor.
//
// src/office/desks.js declares the contract and, until this file existed, fell
// through to its own PlaceholderOs stand-in — anti-aliased fillText in Lucida
// Console, a roundRect and off-palette greys, i.e. everything the OS was built
// not to be. The OS itself was already monitor-ready (an integer-resolution
// canvas, a phosphor pass in os.crtCanvas, its own drawn cursor); the only
// missing part was this bridge.
//
//   createOsSurface({ width, height, tier, playerId, nick, state, audio, net })
//     -> { texture, update(dt), pointer(u, v, buttons), key(e), focus(on),
//          setTier(n), wheel(dy), openApp(id), on(evt, fn), os, dispose() }
//
// Two jobs, and both are about not lying to the player:
//
//   ASPECT. The office screen quad is 0.545 x 0.325 m — 1.677:1, a widescreen
//   panel — while every one of the four machines runs a 4:3-ish desktop. Simply
//   stretching the OS canvas across the quad would make each pixel 1.26 x wider
//   than it is tall, which destroys the bitmap font the whole piece is built on:
//   an 8 px 'l' and an 8 px 'I' stop being the same width. So the OS is blitted
//   1:1 into a larger view canvas at the quad's aspect and the surround is left
//   black, exactly as a 4:3 signal sits on a 16:10 monitor. Square pixels, no
//   resampling, and pointer(u, v) is un-mapped through the same offsets.
//
//   REPAINTS. os.paint() only runs on dirty frames (checklist 19: nothing
//   eases, so a still desktop is a still texture). Uploading the canvas to the
//   GPU every frame anyway would cost three full texture uploads per frame for
//   three desks, for identical pixels. os.frame counts real repaints, so the
//   blit and texture.needsUpdate happen on those frames only.

import { OS } from './os.js';

export async function createOsSurface(opts = {}) {
  const {
    width = 512, height = 306, tier = 1,
    playerId = null, nick = null,
    state = null, audio = null, net = null,
    crt = true,
  } = opts;

  // Dynamic: src/os/ must stay importable from src/os/dev.html, which is a bare
  // page with no import map. A static `import ... from 'three'` at module scope
  // would break the OS harness and the node-side checks for everyone.
  const THREE = await import('three');

  const os = new OS({ state, audio, net, tier, playerId, nick, crt: true });
  os.setCrt(crt !== false);

  const view = document.createElement('canvas');
  view.className = 'os-surface';
  const vg = view.getContext('2d', { alpha: false });

  let ox = 0, oy = 0;
  function relayout() {
    const sw = os.theme.w, sh = os.theme.h;
    const want = (width > 0 && height > 0) ? width / height : sw / sh;
    let vw = sw, vh = sh;
    if (want > sw / sh) vw = Math.round(sh * want);
    else if (want < sw / sh) vh = Math.round(sw / want);
    vw += vw & 1; vh += vh & 1;                      // even, so the offsets are integers
    if (view.width !== vw || view.height !== vh) { view.width = vw; view.height = vh; }
    ox = (vw - sw) >> 1;
    oy = (vh - sh) >> 1;
    vg.imageSmoothingEnabled = false;
  }
  relayout();

  const texture = new THREE.CanvasTexture(view);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  // Magnification is Nearest: when the camera flies to the screen the player
  // reads the OS through this texture, and a bitmap font must not be smoothed.
  // Minification is Linear: across the room the screen is ~40 px wide, and
  // point-sampling a 1 px scanline comb at that size is a crawling moire.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 1;

  let lastFrame = -1;
  function blit() {
    vg.imageSmoothingEnabled = false;
    if (ox || oy) { vg.fillStyle = '#000000'; vg.fillRect(0, 0, view.width, view.height); }
    vg.drawImage(os.screenCanvas, ox, oy);
    texture.needsUpdate = true;
    lastFrame = os.frame;
  }
  os.update(0);                                       // first paint, so the desk is never black
  blit();

  // --- input bridge ---------------------------------------------------------
  // The office speaks pointer(u, v, buttons) every frame while the player is at
  // the screen; the OS speaks pointerMove / pointerDown(button) / pointerUp on
  // edges. interact.js already hands v top-down (`v: 1 - hit.uv.y`).

  const DOM_BUTTON = [0, 2, 1];   // buttons bit 0/1/2 -> button left/right/middle
  let heldButtons = 0;
  let focused = false;

  function pointer(u, v, buttons = 0) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    const x = clampInt(Math.floor(u * view.width) - ox, 0, os.theme.w - 1);
    const y = clampInt(Math.floor(v * view.height) - oy, 0, os.theme.h - 1);
    os.pointerMove(x, y);
    const b = buttons | 0;
    for (let bit = 0; bit < 3; bit++) {
      const now = (b >> bit) & 1, was = (heldButtons >> bit) & 1;
      if (now && !was) { if (!focused) focusOn(true); os.pointerDown(DOM_BUTTON[bit]); }
      else if (!now && was) os.pointerUp();
    }
    heldButtons = b;
  }

  function focusOn(on) {
    const want = on !== false;
    if (want === focused) return;
    focused = want;
    if (want) os.focus();
    else { if (heldButtons) { os.pointerUp(); heldButtons = 0; } os.blur(); }
  }

  return {
    texture,
    canvas: view,
    os,                                               // the editor bridge reaches through this
    get grants() { return os.grants; },

    update(dt) {
      os.update(dt || 0);
      if (os.frame !== lastFrame) blit();
    },

    pointer,
    focus: focusOn,
    wheel(dy) { os.wheel(Math.sign(dy) * 3); },

    key(e) {
      if (!e) return false;
      const k = e.key ?? '';
      return os.key({
        key: k,
        char: typeof k === 'string' && k.length === 1 ? k : '',
        ctrl: !!(e.ctrlKey || e.metaKey),
        shift: !!e.shiftKey,
      });
    },

    setTier(n) {
      os.setTier(n, { boot: true });
      relayout();
      os.update(0);
      blit();
    },

    openApp(id, params) { return os.openApp(id, params); },
    on(name, fn) { return os.on(name, fn); },

    dispose() {
      texture.dispose();
      os.dispose();
    },
  };
}

function clampInt(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v | 0); }

export default createOsSurface;
