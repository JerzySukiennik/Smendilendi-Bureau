// TEMPORARY build-agent harness — drives the editor through its real DOM
// handlers in a hidden browser tab. Deleted at the end of the round; nothing
// in the game imports it.
export function install(ED, W = 1200, H = 750) {
  ED.engine.width = W; ED.engine.height = H;
  ED.engine.renderer.setPixelRatio(1);
  ED.engine.renderer.setSize(W, H, false);
  ED.editor.cameras.resize(W, H);
  ED.editor.cameras.zoomExtents(ED.editor.contentBounds());
  const cv = ED.engine.renderer.domElement;
  if (window.__pump) clearInterval(window.__pump);
  window.__errs = [];
  window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
  const oldErr = console.error;
  console.error = (...a) => { window.__errs.push(a.join(' ')); oldErr(...a); };
  window.__pump = setInterval(() => {
    try { ED.engine._tick(performance.now()); } catch (e) { window.__errs.push('tick: ' + e); }
  }, 16);
  const pe = (type, x, y, o = {}) => cv.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true,
    button: o.button ?? 0, buttons: o.buttons ?? 1, pointerId: 1, pointerType: 'mouse', ...o,
  }));
  const D = {
    move(x, y) { pe('pointermove', x, y, { buttons: 0 }); D.tick(1); },
    down: (x, y) => pe('pointerdown', x, y),
    up: (x, y) => window.dispatchEvent(new PointerEvent('pointerup', {
      clientX: x, clientY: y, bubbles: true, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse',
    })),
    click(x, y) { D.move(x, y); D.down(x, y); D.up(x, y); D.tick(1); },
    drag(x0, y0, x1, y1) { D.move(x0, y0); D.down(x0, y0); D.move(x1, y1); D.tick(1); D.up(x1, y1); D.tick(1); },
    key: (k, code) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, bubbles: true, cancelable: true })),
    type(s) {
      for (const ch of s) {
        D.key(ch, /[0-9]/.test(ch) ? 'Digit' + ch : ch === ',' ? 'Comma' : ch === '.' ? 'Period'
          : ch === '-' ? 'Minus' : ch === '<' ? 'Comma' : ch === '>' ? 'Period' : 'Key' + ch.toUpperCase());
      }
    },
    enter: () => D.key('Enter', 'Enter'),
    esc: () => D.key('Escape', 'Escape'),
    tool: (letter) => D.key(letter.toLowerCase(), 'Key' + letter.toUpperCase()),
    tick(n = 2) { for (let i = 0; i < n; i++) ED.engine._tick(performance.now()); },
    tip() { const t = ED.editor.hud?.tip; return { txt: t?.textContent || '', col: t?.querySelector('i')?.style.background || '' }; },
    meas() { const m = ED.editor.measurements; return { display: m.display, text: m.text, error: m.error }; },
    walls: () => Object.values(ED.editor.model.walls).map((w) => {
      const a = ED.editor.model.nodes[w.a], b = ED.editor.model.nodes[w.b];
      return { id: w.id, a: [+a.x.toFixed(4), +a.z.toFixed(4)], b: [+b.x.toFixed(4), +b.z.toFixed(4)], len: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(6) };
    }),
    furn: () => Object.entries(ED.editor.model.furniture).map(([id, f]) => ({ id, cat: f.catalogId, x: +f.x.toFixed(4), y: +(f.y ?? 0).toFixed(4), z: +f.z.toFixed(4) })),
    openings: () => Object.entries(ED.editor.model.openings).map(([id, o]) => ({ id, wall: o.wallId, off: +o.offset.toFixed(4), W: +o.width.toFixed(4), H: +o.height.toFixed(4) })),
    reset() {
      const m = ED.editor.model;
      for (const id of Object.keys(m.walls)) ED.editor.apply({ t: 'wall.delete', id });
      for (const id of Object.keys(m.furniture)) ED.editor.apply({ t: 'furniture.delete', id });
      for (const id of Object.keys(m.slabs)) ED.editor.apply({ t: 'slab.delete', id });
      ED.editor.guides.length = 0; ED.editor.lockAxis = null; ED.editor.clearSelection();
      ED.editor.setTool('select'); ED.editor.setView('orbit');
      D.tick(3);
      return Object.keys(m.walls).length;
    },
    labels() {
      const plan = ED.editor.plan;
      const proto = Object.getPrototypeOf(plan);
      if (!proto.__wrapped) {
        const orig = proto._uploadLabels;
        proto._uploadLabels = function (labels) {
          window.__labels = labels.map((l) => ({ t: l.text, sub: l.sub, x: +l.x.toFixed(3), z: +l.z.toFixed(3), size: l.size, rot: l.rot || 0 }));
          return orig.call(this, labels);
        };
        proto.__wrapped = true;
      }
      plan.version = -1;
      plan.build(ED.editor.model, ED.editor.levelId, ED.editor.roomLabels());
      return window.__labels || [];
    },
    segs() { return ED.editor.plan.lines.geometry.getAttribute('position').count / 2; },
  };
  window.D = D;
  D.tick(5);
  return { frame: ED.engine.frame, size: [ED.engine.width, ED.engine.height] };
}
