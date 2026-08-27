// common.js — the pieces every app in the OS shares: a toolbar of 16x16 raised
// buttons with separators (win95-12's WordPad is the reference), a scrolling
// pane whose bar is the real 16 px scrollbar, and a selectable list.

import {
  fill, hline, vline, bevel, checker, inside, text, textY, Scroll, scrollbar,
  scrollbarGeom, scrollbarHit, SCROLLBAR, clipped,
} from '../widgets.js';
import { SANS, SANS_BOLD } from '../font.js';
import { I16 } from '../icons.js';

export const TOOLBAR_H = 26;
export const ROW_H = 17;

/**
 * A WordPad-style toolbar: 16x16 icons in 24x24 buttons, raised only under the
 * cursor, with 2 px etched separators between groups.
 */
export function toolbar(g, r, items, pal, state = {}) {
  fill(g, r.x, r.y, r.w, r.h, pal.face);
  hline(g, r.x, r.y + r.h - 1, r.w, pal.shadow);
  hline(g, r.x, r.y + r.h - 2, r.w, pal.hi);
  let x = r.x + 2;
  for (const it of items) {
    if (it.sep) {
      vline(g, x + 2, r.y + 4, r.h - 10, pal.shadow);
      vline(g, x + 3, r.y + 4, r.h - 10, pal.hi);
      x += 8;
      continue;
    }
    const rect = { x, y: r.y + 1, w: 24, h: 22 };
    const hot = state.hot === it.id;
    const down = state.down === it.id;
    if (down) { fill(g, rect.x, rect.y, rect.w, rect.h, pal.face); bevel(g, rect.x, rect.y, rect.w, rect.h, 'pressed', pal); }
    else if (hot && !it.disabled) bevel(g, rect.x, rect.y, rect.w, rect.h, 'thin', pal);
    const d = down ? 1 : 0;
    if (I16[it.icon]) {
      if (it.disabled) {
        // disabled icons are drawn through the 50 % checkerboard mask
        I16[it.icon].draw(g, rect.x + 4 + d, rect.y + 3 + d);
        checker(g, rect.x + 4, rect.y + 3, 16, 16, pal.face, null);
      } else {
        I16[it.icon].draw(g, rect.x + 4 + d, rect.y + 3 + d);
      }
    }
    it._rect = rect;
    x += 24;
  }
  return items;
}

export function toolbarHit(items, x, y) {
  return items.find((i) => !i.sep && i._rect && inside(i._rect, x, y)) ?? null;
}

/**
 * A scrolling viewport with a real 16 px scrollbar down its right edge.
 * The app tells it how tall the content is; it does the rest.
 */
export class ScrollPane {
  constructor(rowH = ROW_H) {
    this.v = new Scroll();
    this.rowH = rowH;
    this.part = null;
    this.dragOff = 0;
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.bar = null;
  }

  /** r is the whole pane including the bar. Returns the content rectangle. */
  layout(r, contentH) {
    this.contentH = contentH;
    const needs = contentH > r.h;
    this.bar = needs ? { x: r.x + r.w - SCROLLBAR, y: r.y, w: SCROLLBAR, h: r.h } : null;
    this.rect = { x: r.x, y: r.y, w: r.w - (needs ? SCROLLBAR : 0), h: r.h };
    this.v.page = this.rect.h;
    this.v.max = Math.max(contentH, this.rect.h);
    this.v.clamp();
    return this.rect;
  }

  paint(g, pal, mac = false) {
    if (this.bar) scrollbar(g, this.bar, this.v, true, { pal, part: this.part, mac });
  }

  get top() { return this.v.value; }

  pointer(ev, pal) {
    if (!this.bar) return false;
    const gx = ev.gx ?? (this.rect.x + ev.x), gy = ev.gy ?? (this.rect.y + ev.y);
    if (ev.type === 'wheel') { this.v.by(ev.dy * this.rowH); return true; }
    if (ev.type === 'down') {
      const part = scrollbarHit(this.bar, this.v, true, gx, gy);
      if (!part) return false;
      this.part = part;
      const geo = scrollbarGeom(this.bar, this.v, true);
      if (part === 'up') this.v.by(-this.rowH);
      else if (part === 'down') this.v.by(this.rowH);
      else if (part === 'pageup') this.v.by(-this.v.page);
      else if (part === 'pagedown') this.v.by(this.v.page);
      else if (part === 'thumb') this.dragOff = gy - geo.thumb.y;
      return true;
    }
    if (ev.type === 'move' && this.part === 'thumb') {
      const geo = scrollbarGeom(this.bar, this.v, true);
      const trackLen = this.bar.h - SCROLLBAR * 2 - geo.thumb.h;
      const t = trackLen > 0 ? (gy - this.dragOff - (this.bar.y + SCROLLBAR)) / trackLen : 0;
      this.v.set(Math.round(Math.max(0, Math.min(1, t)) * this.v.maxValue));
      return true;
    }
    if (ev.type === 'up') { const had = !!this.part; this.part = null; return had; }
    return false;
  }
}

/**
 * A list of rows in a sunken white field. Selection is the system Highlight
 * navy with white text, exactly as in win95-13's Help Topics list.
 */
export class ListView {
  constructor(rowH = ROW_H) {
    this.pane = new ScrollPane(rowH);
    this.rowH = rowH;
    this.sel = 0;
    this.onSelect = null;
    this.onActivate = null;
  }

  layout(r, count) {
    this.count = count;
    this.body = this.pane.layout(r, count * this.rowH);
    return this.body;
  }

  paint(g, pal, drawRow, mac = false) {
    const r = this.body;
    fill(g, r.x, r.y, r.w, r.h, pal.window);
    const first = Math.floor(this.pane.top / this.rowH);
    const last = Math.min(this.count, first + Math.ceil(r.h / this.rowH) + 1);
    clipped(g, r, () => {
      for (let i = first; i < last; i++) {
        const y = r.y + i * this.rowH - this.pane.top;
        const on = i === this.sel;
        if (on) fill(g, r.x, y, r.w, this.rowH, pal.hilite);
        drawRow(g, i, { x: r.x, y, w: r.w, h: this.rowH }, on);
      }
    });
    this.pane.paint(g, pal, mac);
  }

  pointer(ev, pal) {
    if (this.pane.pointer(ev, pal)) return true;
    const gx = ev.gx, gy = ev.gy;
    if ((ev.type === 'down') && inside(this.body, gx, gy)) {
      const i = Math.floor((gy - this.body.y + this.pane.top) / this.rowH);
      if (i >= 0 && i < this.count) {
        const was = this.sel;
        this.sel = i;
        this.onSelect?.(i);
        if (ev.double && was === i) this.onActivate?.(i);
      }
      return true;
    }
    return false;
  }

  key(ev) {
    if (ev.key === 'ArrowDown') { this.sel = Math.min(this.count - 1, this.sel + 1); this.reveal(); this.onSelect?.(this.sel); return true; }
    if (ev.key === 'ArrowUp') { this.sel = Math.max(0, this.sel - 1); this.reveal(); this.onSelect?.(this.sel); return true; }
    if (ev.key === 'Enter') { this.onActivate?.(this.sel); return true; }
    return false;
  }

  reveal() {
    const y = this.sel * this.rowH;
    if (y < this.pane.v.value) this.pane.v.set(y);
    else if (y + this.rowH > this.pane.v.value + this.body.h) this.pane.v.set(y + this.rowH - this.body.h);
  }
}

/** Two-colour money, the way a quantity surveyor writes it: 1 240 000. */
export function money(v) {
  const n = Math.round(Number(v) || 0);
  return String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function dateShort(ms) {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  let h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${day} ${mon}  ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
