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
