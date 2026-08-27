// capture.js — a screenshot of the editor, 3D and HUD together, without a
// screenshot tool. Dev harness only; the game never imports it.
//
// The canvas is created without preserveDrawingBuffer (rightly — it costs
// bandwidth every frame), so the drawing buffer cannot be read after the fact.
// Instead the scene is rendered once into a WebGLRenderTarget of exactly the
// size we want, read back, and the real HUD is drawn on top of it through an
// SVG <foreignObject> with editor.css inlined. What comes out is what the
// player sees, not a reconstruction of it.

import { WebGLRenderTarget, LinearFilter, SRGBColorSpace } from 'three';

export function makeCapture(ED) {
  let target = null;
  let cssText = null;

  async function css() {
    if (cssText != null) return cssText;
    const parts = [];
    for (const href of ['../style.css', './editor.css']) {
      try {
        const res = await fetch(new URL(href, import.meta.url));
        parts.push(await res.text());
      } catch (_) { /* keep going: a missing sheet only costs colour */ }
    }
    cssText = parts.join('\n');
    return cssText;
  }

  function renderTo(width, height) {
    const e = ED.editor;
    const renderer = ED.engine.renderer;
    if (!target || target.width !== width || target.height !== height) {
      target?.dispose();
      target = new WebGLRenderTarget(width, height, {
        minFilter: LinearFilter, magFilter: LinearFilter, colorSpace: SRGBColorSpace,
      });
    }
    const oldPr = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    e.cameras.resize(width, height);
    e.render(renderer, target);
    const buf = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buf);
    renderer.setPixelRatio(oldPr);
    e.cameras.resize(ED.engine.width, ED.engine.height);
    return buf;
  }

  function toCanvas(buf, width, height) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(width, height);
    // WebGL reads bottom-up; a canvas is top-down.
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4;
      img.data.set(buf.subarray(src, src + width * 4), y * width * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function drawHud(ctx, width, height) {
    const hud = ED.editor.hud?.root;
    if (!hud) return;
    const style = await css();
    const markup = new XMLSerializer().serializeToString(hud);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<foreignObject width="100%" height="100%">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${height}px;">`
      + `<style>${style}</style>${markup}</div></foreignObject></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, width, height); resolve(); };
      img.onerror = () => resolve();      // 3D only is better than nothing
      img.src = url;
    });
  }

  /**
   * capture({ width, height, hud }) -> PNG data URL.
   * The HUD is laid out for the live viewport, so `width`/`height` should keep
   * the viewport's aspect or the panels will not line up.
   */
  async function capture({ width = 1200, height = 750, hud = true, type = 'image/png', quality = 0.92 } = {}) {
    const buf = renderTo(width, height);
    const c = toCanvas(buf, width, height);
    if (hud) await drawHud(c.getContext('2d'), width, height);
    return c.toDataURL(type, quality);
  }

  /**
   * Capture and POST to the dev-only sink on 5181, which writes the PNG into
   * progress/shots/. Returns the path the sink reports. Nothing in the game
   * knows this exists; it is how a build agent gets a file out of a browser.
   */
  capture.save = async function save(name, opts) {
    const data = await capture(opts);
    const res = await fetch(`http://localhost:5181/?name=${encodeURIComponent(name)}`, {
      method: 'POST', body: data,
    });
    return `${res.status} ${await res.text()}`;
  };

  return capture;
}
