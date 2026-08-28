// settings.js — the machine control panel.
//
// Built to the shape of win95-10/11 (Display Properties), because that capture
// is the one with every hard case in it: a tab control at 19 px, group boxes as
// 2 px etched lines, a disabled group whose caption is the two-pass emboss, a
// list with a navy selection, a trackbar, and a default push button with the
// 1 px ring drawn OUTSIDE the bevel.
//
// In fiction this is where the office swaps between the machines it owns; in
// practice it is also how the four visual tiers are exercised.

import {
  fill, hline, vline, bevel, field, button, groupBox, checkbox, statusBar,
  inside, textY, clipped, focusRect, checker, VGA, panel,
} from '../widgets.js';
import { SANS, SANS_BOLD, wrap } from '../font.js';
import { I16, icon32 } from '../icons.js';
import { TIERS } from '../themes.js';
import { ListView, money } from './common.js';

const TAB_H = 19;
const TABS = ['&Display', '&Machine', '&Sound'];

export class SettingsApp {
  constructor(ctx, os, win) {
    this.ctx = ctx;
    this.os = os;
    this.win = win;
    this.title = 'Machine';
    this.tab = 0;
    this.list = new ListView(17);
    this.list.sel = os.tier - 1;
    this.pending = os.tier;
    this.list.onSelect = (i) => { this.pending = i + 1; this.os.invalidate(); };
    this.dragBus = null;
    this.buses = [
      { id: 'master', label: '&Master' },
      { id: 'music', label: 'M&usic' },
      { id: 'sfx', label: '&Effects' },
      { id: 'ui', label: 'I&nterface' },
    ];
    this.crt = os.crt;
    this.menu = [
      { label: '&File', items: [{ label: '&Close', id: 'close' }] },
      { label: '&Help', items: [{ label: '&About This Machine', id: 'about' }] },
    ];
  }

  mount() {}
  unmount() {}

  paint(g, r) {
    const pal = this.os.theme.pal;
    fill(g, r.x, r.y, r.w, r.h, pal.face);

    // --- tab control
    let tx = r.x + 4;
    this.tabRects = [];
    for (let i = 0; i < TABS.length; i++) {
      const w = SANS.measure(TABS[i].replace('&', '')) + 20;
      const on = i === this.tab;
      const y = r.y + (on ? 2 : 4);
      const h = TAB_H + (on ? 2 : 0);
      fill(g, tx, y, w, h, pal.face);
      hline(g, tx + 1, y, w - 2, pal.hi);
      vline(g, tx, y + 1, h - 1, pal.hi);
      vline(g, tx + w - 1, y + 1, h - 1, pal.shadow);
      vline(g, tx + w - 2, y + 2, h - 2, pal.face);
      SANS.drawMnemonic(g, TABS[i], tx + 10, y + (on ? 5 : 4), pal.text);
      this.tabRects.push({ x: tx, y, w, h });
      tx += w - 1;
    }
    const page = { x: r.x + 4, y: r.y + TAB_H + 4, w: r.w - 8, h: r.h - TAB_H - 42 };
    fill(g, page.x, page.y, page.w, page.h, pal.face);
    bevel(g, page.x, page.y, page.w, page.h, 'panel', pal);
    // the tab that is open joins its page: paint over the seam
    const t = this.tabRects[this.tab];
    fill(g, t.x + 1, page.y, t.w - 2, 2, pal.face);

    clipped(g, page, () => {
      if (this.tab === 0) this.paintDisplay(g, page, pal);
      else if (this.tab === 1) this.paintMachine(g, page, pal);
      else this.paintSound(g, page, pal);
    });

    // --- OK / Cancel / Apply
    const bw = 76, bh = 21, by = r.y + r.h - bh - 6;
    const applyOn = this.pending !== this.os.tier;
    this.okRect = { x: r.x + r.w - 3 * (bw + 6) - 4, y: by, w: bw, h: bh };
    this.cancelRect = { x: r.x + r.w - 2 * (bw + 6) - 4, y: by, w: bw, h: bh };
    this.applyRect = { x: r.x + r.w - (bw + 6) - 4, y: by, w: bw, h: bh };
    button(g, this.okRect, { label: 'OK', pal, isDefault: true, pressed: this.down === 'ok' });
    button(g, this.cancelRect, { label: 'Cancel', pal, pressed: this.down === 'cancel' });
    button(g, this.applyRect, { label: '&Apply', pal, disabled: !applyOn, pressed: this.down === 'apply' });
  }

  // --- pages ---------------------------------------------------------------

  paintDisplay(g, p, pal) {
    // the monitor preview, drawn as a hard-pixel object, never a photograph
    const mw = 150, mh = 116;
    const mx = p.x + ((p.w - mw) >> 1), my = p.y + 8;
    fill(g, mx, my, mw, mh, pal.face);
    bevel(g, mx, my, mw, mh, 'panel', pal);
    const sx = mx + 12, sy = my + 10, sw = mw - 24, sh = mh - 34;
    fill(g, sx - 2, sy - 2, sw + 4, sh + 4, VGA.black);
    const cfg = TIERS[this.pending - 1];
    fill(g, sx, sy, sw, sh, cfg.family === 'platinum' ? '#CCCCCC' : '#008080');
    if (cfg.family === 'platinum') checker(g, sx, sy, sw, sh, '#CCCCCC', '#999999');
    // a miniature of that tier's own chrome
    fill(g, sx + 6, sy + 8, sw - 30, sh - 24, pal.face);
    if (cfg.family === 'platinum') {
      for (let i = 0; i < 6; i++) hline(g, sx + 7, sy + 9 + i, sw - 32, i % 2 ? '#777777' : '#FFFFFF');
    } else {
      fill(g, sx + 7, sy + 9, sw - 32, 6, cfg.gradientTitle ? '#1084D0' : '#000080');
      fill(g, sx + 7, sy + 9, 20, 6, '#000080');
    }
    fill(g, mx + 12, my + mh - 20, mw - 24, 3, pal.shadow);
    fill(g, mx + 40, my + mh - 12, mw - 80, 6, pal.face);

    // machine list
    const gy = my + mh + 6;
    const gb = groupBox(g, p.x + 8, gy, p.w - 16, p.h - (gy - p.y) - 12, '&Machines in the office', pal);
    const listRect = { x: gb.x + 4, y: gb.y + 2, w: gb.w - 8, h: gb.h - 30 };
    const inner = field(g, listRect.x, listRect.y, listRect.w, listRect.h, pal);
    this.list.layout(inner, TIERS.length);
    this.list.paint(g, pal, (gg, i, row, on) => {
      const t = TIERS[i];
      const fg = on ? pal.hiliteText : pal.text;
      I16.computer.draw(gg, row.x + 2, row.y + ((row.h - 16) >> 1));
      SANS.draw(gg, `${t.hardware} — ${t.osName} ${t.osVersion}`, row.x + 22, textY(row.y, row.h), fg);
      const res = `${t.w} x ${t.h}`;
      SANS.draw(gg, res, row.x + row.w - 8 - SANS.measure(res), textY(row.y, row.h), fg);
    }, this.os.theme.family === 'platinum');

    const sel = TIERS[this.pending - 1];
    SANS.draw(g, `${sel.spec}`, gb.x + 6, gb.y + gb.h - 24, pal.text);
    SANS.draw(g, sel.grants.note, gb.x + 6, gb.y + gb.h - 12, pal.text);
  }

  paintMachine(g, p, pal) {
    const cfg = this.os.config;
    const gb = groupBox(g, p.x + 8, p.y + 10, p.w - 16, 128, '&This machine', pal);
    icon32(g, 'computer', gb.x + 8, gb.y + 6, cfg.screenTint);
    const rows = [
      ['Machine', cfg.hardware],
      ['System', `${cfg.osName} ${cfg.osVersion} — ${cfg.tagline}`],
      ['Processor', cfg.spec],
      ['Display', `${cfg.w} x ${cfg.h}, ${cfg.family === 'platinum' ? 'thousands of colours' : '256 colours'}`],
    ];
    rows.forEach(([k, v], i) => {
      SANS_BOLD.draw(g, k, gb.x + 48, gb.y + 6 + i * 14, pal.text);
      SANS.draw(g, SANS.ellipsis(v, gb.w - 130), gb.x + 118, gb.y + 6 + i * 14, pal.text);
    });

    const y2 = gb.y + 74;
    SANS_BOLD.draw(g, 'What this machine gives the editor', gb.x + 8, y2, pal.text);
    const gr = cfg.grants;
    const lines = [
      `Undo history: ${gr.undo} steps`,
      `Editor viewport: ${Math.round(gr.viewportScale * 100)} % of the screen`,
      `Live daylight preview: ${gr.daylightPreview ? 'yes' : 'no'}`,
      `Live shadows: ${gr.shadowPreview ? 'yes' : 'no'}`,
      `Design variants on disk: ${gr.maxVariants}`,
    ];
    lines.forEach((l, i) => SANS.draw(g, l, gb.x + 12, y2 + 14 + i * 12, pal.text));

    // a disabled group, to show the two-pass emboss on a real control
    const dg = { x: p.x + 8, y: p.y + 150, w: p.w - 16, h: 46 };
    bevel(g, dg.x, dg.y, dg.w, dg.h, 'etched', pal);
    fill(g, dg.x + 7, dg.y - 1, SANS.measure('Hardware acceleration') + 6, 8, pal.face);
    SANS.drawDisabled(g, 'Hardware acceleration', dg.x + 9, dg.y - 4);
    checkbox(g, dg.x + 10, dg.y + 12, false, pal);
    SANS.drawDisabled(g, 'Use the 3D accelerator card', dg.x + 28, dg.y + 14);
    SANS.drawDisabled(g, 'No accelerator is fitted to this machine.', dg.x + 10, dg.y + 28);
  }

  paintSound(g, p, pal) {
    const gb = groupBox(g, p.x + 8, p.y + 10, p.w - 16, 118, '&Volume', pal);
    this.sliderRects = [];
    this.buses.forEach((b, i) => {
      const y = gb.y + 8 + i * 26;
      SANS.drawMnemonic(g, b.label, gb.x + 8, y + 4, pal.text);
      const tr = { x: gb.x + 78, y: y + 6, w: gb.w - 130, h: 4 };
      bevel(g, tr.x, tr.y, tr.w, tr.h, 'sunken', pal);
      // tick marks under the groove, hard pixels only
      for (let k = 0; k <= 10; k++) vline(g, tr.x + Math.round((tr.w - 1) * k / 10), tr.y + 8, k % 5 === 0 ? 4 : 2, pal.shadow);
      const v = this.volume(b.id);
      const tx = tr.x + Math.round((tr.w - 11) * v);
      fill(g, tx, y - 3, 11, 19, pal.face);
      bevel(g, tx, y - 3, 11, 19, 'button', pal);
      vline(g, tx + 5, y + 1, 10, pal.shadow);
      const pct = `${Math.round(v * 100)} %`;
      SANS.draw(g, pct, gb.x + gb.w - 40, y + 4, pal.text);
      this.sliderRects.push({ id: b.id, track: tr });
    });

    const gy = gb.y + gb.h + 8;
    const g2 = groupBox(g, p.x + 8, gy, p.w - 16, 62, '&Screen', pal);
    checkbox(g, g2.x + 8, g2.y + 4, this.crt, pal);
    SANS.draw(g, 'Phosphor and scanlines on the monitor', g2.x + 26, g2.y + 6, pal.text);
    this.crtBox = { x: g2.x + 8, y: g2.y + 4, w: 13, h: 13 };
    const note = this.os.config.crt
      ? 'The office shows this machine through its own glass.'
      : 'This machine drives a flat panel. Nothing to simulate.';
    if (this.os.config.crt) SANS.draw(g, note, g2.x + 8, g2.y + 24, pal.text);
    else SANS.drawDisabled(g, note, g2.x + 8, g2.y + 24);
    SANS.draw(g, `Startup sound: ${this.os.config.sound}`, g2.x + 8, g2.y + 38, pal.text);
  }

  volume(id) {
    const a = this.ctx.audio;
    const v = a?.volumes?.[id];
    return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 0.7;
  }

  setVolume(id, v) {
    const a = this.ctx.audio;
    const val = Math.max(0, Math.min(1, v));
    if (a?.setVolume) a.setVolume(id, val);
    else if (a?.volumes) a.volumes[id] = val;
    this.os.invalidate();
  }

  // --- input ---------------------------------------------------------------

  pointer(ev) {
    const { gx, gy } = ev;
    if (ev.type === 'down') {
      const ti = this.tabRects?.findIndex((r) => inside(r, gx, gy)) ?? -1;
      if (ti >= 0) { this.tab = ti; this.os.play('ui.click'); this.os.invalidate(); return; }
      if (inside(this.okRect, gx, gy)) { this.down = 'ok'; this.os.invalidate(); return; }
      if (inside(this.cancelRect, gx, gy)) { this.down = 'cancel'; this.os.invalidate(); return; }
      if (inside(this.applyRect, gx, gy)) { this.down = 'apply'; this.os.invalidate(); return; }
      if (this.tab === 2) {
        if (this.crtBox && inside(this.crtBox, gx, gy)) { this.crt = !this.crt; this.os.setCrt(this.crt); return; }
        for (const s of this.sliderRects ?? []) {
          if (gx >= s.track.x - 6 && gx <= s.track.x + s.track.w + 6 && Math.abs(gy - (s.track.y + 2)) < 12) {
            this.dragBus = s;
            this.setVolume(s.id, (gx - s.track.x) / s.track.w);
            return;
          }
        }
      }
    }
    if (ev.type === 'move' && this.dragBus) {
      this.setVolume(this.dragBus.id, (gx - this.dragBus.track.x) / this.dragBus.track.w);
      return;
    }
    if (ev.type === 'up') {
      const d = this.down;
      this.down = null;
      this.dragBus = null;
      if (d === 'ok' && inside(this.okRect, gx, gy)) { this.apply(); this.os.wm.close(this.win); return; }
      if (d === 'apply' && inside(this.applyRect, gx, gy)) { this.apply(); return; }
      if (d === 'cancel' && inside(this.cancelRect, gx, gy)) { this.os.wm.close(this.win); return; }
      this.os.invalidate();
    }
    if (this.tab === 0 && this.list.pointer(ev)) this.os.invalidate();
  }

  apply() {
    if (this.pending !== this.os.tier) {
      const t = this.pending;
      this.os.wm.close(this.win);
      this.os.setTier(t);
    }
    this.os.invalidate();
  }

  key(ev) {
    if (this.tab === 0 && this.list.key(ev)) { this.pending = this.list.sel + 1; return true; }
    if (ev.key === 'Enter') { this.apply(); return true; }
    return false;
  }

  onMenu(id) {
    if (id === 'close') this.os.wm.close(this.win);
    if (id === 'about') this.os.about();
  }
}

export default SettingsApp;
