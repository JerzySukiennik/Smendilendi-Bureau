// debug.js — the overlay that keeps everyone honest.
//
// ARCHITECTURE.md rule 5: "renderer.info.render.calls is on the debug overlay from
// day one." Toggled with backquote. Off screen it costs nothing; on screen it costs
// one DOM write every 250 ms.

import { UI } from './palette.js';

export class DebugOverlay {
  constructor(el, engine) {
    this.el = el;
    this.engine = engine;
    this.visible = false;
    this._acc = 0;
    this._frames = 0;
    this._fps = 0;
    this._ms = 0;
    this._msPeak = 0;
    this._lines = [];
    this._extra = new Map();     // label -> string, filled by whoever wants to report

    el.classList.add('debug-overlay');
    el.hidden = true;
    this._style();
  }

  _style() {
    // Inline so the overlay survives a missing/failed stylesheet — this is the
    // thing you need most when something is broken.
    Object.assign(this.el.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '9999',
      font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: UI.text, background: 'rgba(24,23,21,0.78)',
      padding: '7px 10px', borderRadius: '5px',
      border: `1px solid ${UI.line}`,
      whiteSpace: 'pre', pointerEvents: 'none',
      backdropFilter: 'blur(3px)',
      minWidth: '190px',
    });
  }

  toggle(v = !this.visible) {
    this.visible = v;
    this.el.hidden = !v;
  }

  /** Anyone can push a named line: overlay.report('mode', 'editor / wall tool'). */
  report(label, value) {
    if (value === null || value === undefined) this._extra.delete(label);
    else this._extra.set(label, String(value));
  }

  update(dt, frameMs) {
    this._frames++;
    this._acc += dt;
    if (frameMs > this._msPeak) this._msPeak = frameMs;
    if (this._acc < 0.25) return;

    this._fps = this._frames / this._acc;
    this._ms = (this._acc * 1000) / this._frames;
    this._frames = 0;
    this._acc = 0;
    if (this.visible) this._render();
    this._msPeak = 0;
  }

  _render() {
    const e = this.engine;
    const r = e.renderer;
    const info = r.info;
    const mode = e.activeMode;

    const L = [];
    L.push(`${this._fps.toFixed(0).padStart(3)} fps   ${this._ms.toFixed(2)} ms  (peak ${this._msPeak.toFixed(1)})`);
    L.push(`calls ${String(info.render.calls).padStart(4)}   tris ${fmt(info.render.triangles)}`);
    L.push(`geom  ${String(info.memory.geometries).padStart(4)}   tex  ${String(info.memory.textures).padStart(4)}`);
    L.push(`dpr   ${r.getPixelRatio().toFixed(2)}   ${e.width}x${e.height}  q${e.qualityStepCount ?? 0}`);
    L.push(`mode  ${mode ? mode.id : '-'}${e.modeStack.length > 1 ? ` (${e.modeStack.length})` : ''}`);
    const mem = performance.memory;
    if (mem) L.push(`heap  ${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`);
    for (const [k, v] of this._extra) L.push(`${k.padEnd(5)} ${v}`);

    this.el.textContent = L.join('\n');
  }

  dispose() { this.el.textContent = ''; this.el.hidden = true; }
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
