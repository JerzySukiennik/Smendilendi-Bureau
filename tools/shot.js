// shot.js — put the frame the player is looking at on disk.
//
// Loaded into the running page (`await import('/tools/shot.js')`) and used as
//   await __shot('loop-01-menu.png')
// It composites two layers, because the game is two layers: the WebGL canvas,
// re-rendered on the spot so the read-back is not an empty back buffer, and the
// DOM UI (the editor HUD, the office HUD, the stage wipe), serialised through
// an SVG foreignObject with every same-origin stylesheet inlined. The result is
// POSTed to the dev server, which writes progress/shots/<name>.
//
// If the DOM layer fails to rasterise the shot is still written — canvas only —
// and the return value says so, so a screenshot is never silently half a game.

function collectCss() {
  const out = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) out.push(rule.cssText);
    } catch (_) { /* cross-origin (the CDN font sheet): skip */ }
  }
  return out.join('\n');
}

function domLayer(cssW, cssH) {
  const clone = document.body.cloneNode(true);
  for (const c of clone.querySelectorAll('canvas')) c.remove();

  // foreignObject content has to be well-formed XML, and innerHTML is not:
  // one unclosed <input> in the lobby is enough to make the whole image fail
  // to decode, silently. XMLSerializer produces XHTML from the same DOM, and
  // escapes the stylesheet text for us on the way out.
  const wrap = document.createElement('div');
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrap.setAttribute('style', `width:${cssW}px;height:${cssH}px;margin:0`);
  const style = document.createElement('style');
  style.textContent = collectCss();
  wrap.appendChild(style);
  while (clone.firstChild) wrap.appendChild(clone.firstChild);
  const xml = new XMLSerializer().serializeToString(wrap);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cssW}" height="${cssH}">`
    + `<foreignObject x="0" y="0" width="${cssW}" height="${cssH}">`
    + `${xml}</foreignObject></svg>`;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export async function shot(name) {
  const app = window.SB;
  const eng = app?.engine;
  if (!eng) throw new Error('no engine');
  const canvas = eng.canvas;
  const mode = eng.activeMode;

  // A WebGL context without preserveDrawingBuffer is cleared the moment the
  // frame is presented, so the canvas must be redrawn in THIS task.
  try { mode?.render?.(eng.renderer); } catch (e) { console.warn('[shot] render', e); }

  const w = canvas.width, h = canvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0, w, h);

  let domOk = false;
  try {
    const img = await domLayer(canvas.clientWidth || w, canvas.clientHeight || h);
    if (img) { g.drawImage(img, 0, 0, w, h); domOk = true; }
  } catch (e) { console.warn('[shot] dom layer', e); }

  const data = out.toDataURL('image/png');
  const res = await fetch(`/__shot/${name}`, { method: 'POST', body: data.split(',')[1] });
  const path = await res.text();
  return { path, w, h, domOk, bytes: data.length };
}

window.__shot = shot;
export default shot;

/**
 * shotWhenVisible(name) — the same capture, but held until the pane is shown.
 *
 * Measured 2026-08-30: while the Claude browser pane is HIDDEN
 * (document.visibilityState === 'hidden') the tab's GL commands are not
 * executed at all. renderer.info still counts 70 draw calls and 179 646
 * triangles for a frame, the context is not lost, and
 * `render(); gl.readPixels(centre)` comes back [0,0,0,0] — so every screenshot
 * taken between tool calls is a blank canvas under a white DOM layer, and ten
 * of them are byte-identical. ARCHITECTURE.md's warning about the pane
 * throttling rAF understates it: nothing renders.
 *
 * So the capture waits for a real visible frame. Arm it, leave the promise
 * unawaited, then take ANY pane screenshot from the tool side — that displays
 * the pane, rAF resumes, and this resolves with a real image.
 */
export function shotWhenVisible(name, { frames = 3, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const wait = () => {
      if (document.visibilityState === 'visible') {
        let n = frames;
        const spin = () => (n-- > 0 ? requestAnimationFrame(spin) : shot(name).then(resolve, (e) => resolve({ error: String(e) })));
        requestAnimationFrame(spin);
        return;
      }
      if (performance.now() - t0 > timeout) { resolve({ error: 'pane never became visible', name }); return; }
      setTimeout(wait, 80);
    };
    wait();
  });
}

window.__shotWhenVisible = shotWhenVisible;

/**
 * step(n, dt) — advance the engine by n frames, independently of rAF.
 *
 * ARCHITECTURE.md already warns that the Claude browser pane throttles
 * requestAnimationFrame. It is worse than throttling: outside the instant a
 * screenshot is taken the pane reports document.hidden === true, so rAF is
 * SUSPENDED and the game does not advance between tool calls at all. Clicking
 * a 3D menu item then depends on a frame that never comes.
 *
 * So the loop is driven by hand. `_tick(now)` takes its clock as an argument,
 * which makes this exact: n frames of exactly dt seconds each, the same code
 * path the rAF loop runs, input edges consumed frame by frame in order.
 */
export function step(n = 60, dt = 1 / 60) {
  const e = window.SB?.engine;
  if (!e) throw new Error('no engine');
  const t0 = performance.now();
  for (let i = 0; i < n; i++) e._tick(e.clockLast + dt * 1000);
  return { frames: n, wallMs: +(performance.now() - t0).toFixed(1), simTime: +e.time.toFixed(2) };
}

/** Step for `seconds` of simulated time while letting real timers fire between chunks. */
export async function run(seconds = 1, dt = 1 / 60) {
  const chunks = Math.max(1, Math.round(seconds / 0.25));
  for (let i = 0; i < chunks; i++) {
    step(Math.round(0.25 / dt), dt);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { seconds, simTime: +window.SB.engine.time.toFixed(2) };
}

window.__step = step;
window.__run = run;

/**
 * pin(w, h) — freeze the page layout at a real viewport size.
 *
 * When the browser pane is not displayed, body.clientWidth is 0 and
 * Engine.resize() falls all the way through to a 1 x 1 framebuffer, which
 * silently ruins both the screenshots and any measurement taken between tool
 * calls. Pinning the layout in CSS pixels keeps the canvas the size it is when
 * the pane IS displayed, so a hidden pane changes nothing but the compositing.
 */
export function pin(w = 1280, h = 720) {
  for (const el of [document.documentElement, document.body, document.getElementById('app')]) {
    if (!el) continue;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.minWidth = `${w}px`;
    el.style.minHeight = `${h}px`;
  }
  window.SB?.engine?.resize();
  return { w: window.SB?.engine?.width, h: window.SB?.engine?.height };
}

window.__pin = pin;

// ---------------------------------------------------------------------------
// Playing the game from here.
//
// The pane does not deliver its own clicks while it is not displayed, so the
// play-through drives the SAME event listeners a human does: mousemove /
// mousedown / mouseup on the canvas (src/core/input.js binds exactly those)
// and keydown / keyup on the window. Coordinates are CSS pixels in the pinned
// 1280 x 720 viewport, i.e. where the thing actually is on screen.
//
// The one thing that cannot be done this way is pointer lock: the browser only
// grants it on a trusted gesture, so free-look in the office is unavailable to
// this harness. Everything else — walking, F to sit, the in-world OS cursor,
// every DOM button in the editor HUD — goes through the real path.

function at(x, y) {
  return document.elementFromPoint(x, y) || window.SB.engine.canvas;
}

function mouseEvent(type, x, y, extra = {}) {
  return new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1,
    ...extra,
  });
}

export function move(x, y) {
  const el = at(x, y);
  el.dispatchEvent(mouseEvent('mousemove', x, y, { buttons: 0 }));
  return el.id || el.className || el.tagName;
}

export function click(x, y, { steps = 4 } = {}) {
  const el = at(x, y);
  el.dispatchEvent(mouseEvent('mousemove', x, y, { buttons: 0 }));
  el.dispatchEvent(mouseEvent('mousedown', x, y));
  step(1);                                   // the frame that sees the press
  window.dispatchEvent(mouseEvent('mouseup', x, y));
  el.dispatchEvent(mouseEvent('mouseup', x, y));
  if (el.click && el.tagName === 'BUTTON') el.click();
  step(steps);
  return el.textContent ? el.textContent.slice(0, 40) : (el.id || el.tagName);
}

/** Press and release a key, with one frame in between so the edge is seen. */
export function tap(code, opts = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: opts.key || code, bubbles: true }));
  step(2);
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: opts.key || code, bubbles: true }));
  step(1);
  return code;
}

/** Hold a key down for `frames` frames — walking, in other words. */
export function hold(code, frames = 30) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
  step(frames);
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
  step(1);
  return code;
}

Object.assign(window, { __move: move, __click: click, __tap: tap, __hold: hold });
