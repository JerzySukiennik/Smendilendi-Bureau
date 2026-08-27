// themes.js — the four machines and the four fictional operating systems.
//
// DESIGN-DECISIONS.md, "Office & progression": four computer tiers with parody
// names, "a new OS theme, cursor and startup sound each time", and each upgrade
// buys real affordances in the editor.
//
//   1  Pentagram 133   — TRESTLE 3.1      640 x 480   a grubby 16-colour box
//   2  Kompakt 2000    — CORNICE 98       800 x 600   the gradient-title descendant
//   3  Sunstation Pro  — VELLUM 8         1024 x 768  Platinum, global menu bar
//   4  Melon Studio M5 — ATELIER 9        1152 x 870  the polished one, still 1997
//
// Every number below was measured off the captures in reference/retro-os/ with a
// pixel scanner, not remembered:
//   window sizing frame 4 px: #DFDFDF, #FFFFFF, then 2 px of face; bottom-right
//     #808080 then #000000                                    (win95-09 col 200)
//   title bar 18 px starting exactly at the frame, x from 4 to w-5
//   caption buttons 16 x 14, two of them, then a 2 px gap, then close, then 2 px
//     to the title bar's right edge                           (win95-09 row 8)
//   menu band 20 px, client sunken edge #808080 then #000000  (win95-09)
//   taskbar 28 px, Start 54 x 22 at x=2 y=4, task buttons 22 px   (win95-14)
//   Win98 title gradient is a flat horizontal ramp #000080 -> #1084D0 (win98-03)
//   Platinum title bar 22 px: black, white, 2 px #CCCCCC, 12 rows of 1 px
//     #FFFFFF/#777777 pinstripe, 4 px #CCCCCC, #999999, black  (macos8-03 col 200)
//   Platinum menu bar 20 px: #FFFFFF, 17 px #DDDDDD, #999999, black (macos8-05)

import {
  WIN, PLATINUM, VGA, fill, hline, vline, frameRect, bevel, panel, checker, text,
  textY, textCentred, triangle, focusRect, inside, button, field, SCROLLBAR,
} from './widgets.js';
import { SANS, SANS_BOLD, splitMnemonic } from './font.js';
import { I16, icon32 } from './icons.js';

export const CAPTION_BTN = { w: 16, h: 14 };

// ---------------------------------------------------------------------------

class BaseTheme {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.font = SANS;
    this.fontBold = SANS_BOLD;
  }

  /** Rectangle a window's own content lives in, plus every chrome hot spot. */
  layout(win) {
    const m = this.metrics;
    const x = win.x, y = win.y, w = win.w, h = win.h;
    const f = m.frame;
    const cap = { x: x + f, y: y + f, w: w - f * 2, h: m.titleH };
    const buttons = this.captionButtons(win, cap);
    let cy = cap.y + cap.h;
    let menubar = null;
    if (win.menu && win.menu.length && !this.globalMenuBar) {
      menubar = { x: x + f, y: cy, w: w - f * 2, h: m.menuH };
      cy += m.menuH;
    }
    const client = { x: x + f + m.clientInset, y: cy + m.clientInset,
      w: w - f * 2 - m.clientInset * 2, h: h - (cy - y) - f - m.clientInset * 2 };
    return { cap, buttons, menubar, client };
  }

  clientOf(win) { return this.layout(win).client; }

  /** Outer size needed for a given client size. */
  frameFor(win, cw, ch) {
    const m = this.metrics;
    const menuH = (win.menu && win.menu.length && !this.globalMenuBar) ? m.menuH : 0;
    return {
      w: cw + m.frame * 2 + m.clientInset * 2,
      h: ch + m.frame * 2 + m.titleH + menuH + m.clientInset * 2,
    };
  }

  // --- shared chrome -------------------------------------------------------

  /**
   * A popup menu: raised panel, 20 px items, 2 px etched separators, a 20 px
   * left gutter for checkmarks, accelerators right-aligned, submenu arrows as
   * solid 4x7 triangles. No shadow — Win95 popups sit straight on the pixels.
   */
  menuSize(items) {
    let w = 0;
    let h = 4;
    for (const it of items) {
      if (it.sep) { h += 7; continue; }
      const lw = this.font.measure(splitMnemonic(it.label).text);
      const aw = it.accel ? this.font.measure(it.accel) + 18 : 0;
      const sw = it.submenu ? 14 : 0;
      w = Math.max(w, 22 + lw + aw + sw + 12);
      h += this.metrics.menuItemH;
    }
    return { w: Math.max(w, 90), h };
  }

  paintMenu(g, r, items, hot) {
    const pal = this.pal;
    fill(g, r.x, r.y, r.w, r.h, pal.face);
    bevel(g, r.x, r.y, r.w, r.h, 'panel', pal);
    let y = r.y + 2;
    for (const it of items) {
      if (it.sep) {
        hline(g, r.x + 3, y + 3, r.w - 6, pal.shadow);
        hline(g, r.x + 3, y + 4, r.w - 6, pal.hi);
        y += 7;
        continue;
      }
      const ih = this.metrics.menuItemH;
      const on = hot === it && !it.disabled;
      if (on) fill(g, r.x + 2, y, r.w - 4, ih, pal.hilite);
      const tc = on ? pal.hiliteText : pal.text;
      if (it.checked) {
        // a pressed-in tick in the left gutter, never a badge
        const cx = r.x + 6, cy = y + ((ih - 7) >> 1);
        g.fillStyle = tc;
        const tick = ['....#', '...##', '#.###', '###..', '.##..', '..#..'];
        for (let ry = 0; ry < tick.length; ry++)
          for (let rx = 0; rx < 5; rx++) if (tick[ry][rx] === '#') g.fillRect(cx + rx, cy + ry, 1, 1);
      } else if (it.icon && I16[it.icon]) {
        I16[it.icon].draw(g, r.x + 3, y + ((ih - 16) >> 1));
      }
      this.font.drawMnemonic(g, it.label, r.x + 22, textY(y, ih), tc, { disabled: !!it.disabled });
      if (it.accel) {
        const aw = this.font.measure(it.accel);
        if (it.disabled) this.font.drawDisabled(g, it.accel, r.x + r.w - 12 - aw, textY(y, ih));
        else this.font.draw(g, it.accel, r.x + r.w - 12 - aw, textY(y, ih), tc);
      }
      if (it.submenu) triangle(g, r.x + r.w - 9, y + (ih >> 1), 'right', tc, 4);
      it._rect = { x: r.x + 2, y, w: r.w - 4, h: ih };
      y += ih;
    }
  }

  /** The in-window menu bar (Windows tiers) or the global bar (Platinum). */
  paintMenuBar(g, r, menu, openIdx) {
    const pal = this.pal;
    fill(g, r.x, r.y, r.w, r.h, pal.face);
    let x = r.x + 2;
    for (let i = 0; i < menu.length; i++) {
      const m = menu[i];
      const w = this.font.measure(splitMnemonic(m.label).text) + 12;
      const open = i === openIdx;
      if (open) fill(g, x, r.y + 1, w, r.h - 2, pal.hilite);
      this.font.drawMnemonic(g, m.label, x + 6, textY(r.y, r.h), open ? pal.hiliteText : pal.text);
      m._rect = { x, y: r.y + 1, w, h: r.h - 2 };
      x += w;
    }
  }

  /** Cursor bitmaps. 1-bit with a mask, drawn by os.js. */
  cursor(kind) { return CURSORS[kind] || CURSORS.arrow; }
}

// ---------------------------------------------------------------------------
// Windows-family chrome (tiers 1 and 2)

class WinTheme extends BaseTheme {
  constructor(cfg) {
    super({
      family: 'win',
      pal: WIN,
      globalMenuBar: false,
      metrics: {
        frame: 4, titleH: 18, menuH: 20, clientInset: 2, menuItemH: 20,
        startItemH: 32, shellH: 28, buttonH: 21, scrollbar: SCROLLBAR,
        rowH: 17, iconPitch: 75,
      },
      ...cfg,
    });
  }

  captionButtons(win, cap) {
    const { w, h } = CAPTION_BTN;
    const y = cap.y + ((this.metrics.titleH - h) >> 1);
    const right = cap.x + cap.w - 2;
    const out = [];
    out.push({ id: 'close', x: right - w, y, w, h });
    if (win.resizable !== false) {
      out.push({ id: 'max', x: right - w - 2 - w, y, w, h });
      out.push({ id: 'min', x: right - w - 2 - w * 2, y, w, h });
    }
    return out;
  }

  captionGlyph(g, b, pressed) {
    const dx = pressed ? 1 : 0;
    const cx = b.x + 4 + dx, cy = b.y + 4 + dx;
    g.fillStyle = '#000000';
    if (b.id === 'close') {
      const art = ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'];
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (art[y][x] === '#') g.fillRect(cx - 1 + x, cy - 1 + y, 1, 1);
    } else if (b.id === 'min') {
      g.fillRect(cx - 1, cy + 4, 6, 2);
    } else if (b.id === 'max') {
      g.fillRect(cx - 1, cy - 1, 9, 9);
      g.fillStyle = this.pal.face;
      g.fillRect(cx, cy + 1, 7, 6);
    } else if (b.id === 'restore') {
      g.fillRect(cx + 1, cy - 1, 7, 7);
      g.fillStyle = this.pal.face; g.fillRect(cx + 2, cy + 1, 5, 4);
      g.fillStyle = '#000000'; g.fillRect(cx - 1, cy + 1, 7, 7);
      g.fillStyle = this.pal.face; g.fillRect(cx, cy + 3, 5, 4);
    }
  }

  paintWindow(g, win, focused, os) {
    const pal = this.pal;
    const L = this.layout(win);
    // 4 px sizing frame: raised panel edge, then 2 px of face
    fill(g, win.x, win.y, win.w, win.h, pal.face);
    bevel(g, win.x, win.y, win.w, win.h, 'panel', pal);

    // caption
    const cap = L.cap;
    if (focused) {
      if (this.gradientTitle) {
        for (let i = 0; i < cap.w; i++) {
          fill(g, cap.x + i, cap.y, 1, cap.h, rampColor(pal.titleActive, pal.titleActive2, i / Math.max(1, cap.w - 1)));
        }
      } else {
        fill(g, cap.x, cap.y, cap.w, cap.h, pal.titleActive);
      }
    } else if (this.gradientTitle) {
      for (let i = 0; i < cap.w; i++) {
        fill(g, cap.x + i, cap.y, 1, cap.h, rampColor(pal.titleInactive, pal.titleInactive2, i / Math.max(1, cap.w - 1)));
      }
    } else {
      fill(g, cap.x, cap.y, cap.w, cap.h, pal.titleInactive);
    }

    let tx = cap.x + 2;
    if (win.icon && I16[win.icon]) {
      I16[win.icon].draw(g, tx, cap.y + 1);
      tx += 19;
    }
    const btnLeft = L.buttons.length ? Math.min(...L.buttons.map(b => b.x)) : cap.x + cap.w;
    const title = this.fontBold.ellipsis(win.title, Math.max(0, btnLeft - tx - 4));
    this.fontBold.draw(g, title, tx, textY(cap.y, cap.h), focused ? pal.titleText : pal.titleInactiveText);

    for (const b of L.buttons) {
      const id = (b.id === 'max' && win.maximized) ? 'restore' : b.id;
      const pressed = os && os.pressed && os.pressed.kind === 'caption' && os.pressed.btn === b.id && os.pressed.hot;
      fill(g, b.x, b.y, b.w, b.h, pal.face);
      bevel(g, b.x, b.y, b.w, b.h, pressed ? 'pressed' : 'button', pal);
      this.captionGlyph(g, { ...b, id }, pressed);
    }

    if (L.menubar) this.paintMenuBar(g, L.menubar, win.menu, win.menuOpen);

    // client: 2 px sunken edge, exactly #808080 then #000000 on the top-left
    const c = L.client;
    bevel(g, c.x - 2, c.y - 2, c.w + 4, c.h + 4, 'sunken', pal);
    return c;
  }

  // --- desktop and taskbar -------------------------------------------------

  paintDesktop(g, os) {
    const pal = this.pal;
    if (this.desktopDither) checker(g, 0, 0, this.w, this.h, this.desktopA, this.desktopB);
    else fill(g, 0, 0, this.w, this.h, this.desktopA);
  }

  paintShell(g, os) {
    const pal = this.pal;
    const y = this.h - this.metrics.shellH;
    fill(g, 0, y, this.w, this.metrics.shellH, pal.face);
    hline(g, 0, y, this.w, pal.light);
    hline(g, 0, y + 1, this.w, pal.hi);

    // Start button, 54 x 22 at x=2, y=+4
    const sb = this.startRect();
    const down = os.startOpen;
    fill(g, sb.x, sb.y, sb.w, sb.h, pal.face);
    bevel(g, sb.x, sb.y, sb.w, sb.h, down ? 'pressed' : 'button', pal);
    const d = down ? 1 : 0;
    I16.square.draw(g, sb.x + 3 + d, sb.y + 3 + d);
    this.fontBold.draw(g, this.startLabel, sb.x + 21 + d, textY(sb.y, sb.h) + d, pal.text);

    // quick launch (tier 2 only) — a sunken strip with a two-line gripper
    let x = sb.x + sb.w + 2;
    if (this.quickLaunch) {
      const items = os.quickLaunch;
      const qw = items.length * 20 + 6;
      vline(g, x + 1, y + 6, 14, pal.hi); vline(g, x + 2, y + 6, 14, pal.shadow);
      x += 5;
      bevel(g, x, y + 4, qw, 22, 'thinIn', pal);
      items.forEach((it, i) => {
        const bx = x + 3 + i * 20;
        if (I16[it.icon]) I16[it.icon].draw(g, bx, y + 7);
        it._rect = { x: bx - 2, y: y + 5, w: 20, h: 20 };
      });
      x += qw + 4;
      vline(g, x, y + 6, 14, pal.hi); vline(g, x + 1, y + 6, 14, pal.shadow);
      x += 5;
    }

    // task buttons, 22 px tall, pressed when their window is active
    const tray = this.trayRect(os);
    const avail = tray.x - 4 - x;
    const list = os.wm.taskList();
    if (list.length) {
      const bw = Math.max(60, Math.min(154, Math.floor(avail / list.length) - 3));
      list.forEach((win, i) => {
        const bx = x + i * (bw + 3);
        if (bx + bw > tray.x - 4) return;
        const active = os.wm.focused === win && !win.minimized;
        fill(g, bx, y + 4, bw, 22, pal.face);
        bevel(g, bx, y + 4, bw, 22, active ? 'pressed' : 'button', pal);
        if (active) checker(g, bx + 2, y + 6, bw - 4, 18, pal.hi, pal.face);
        const dd = active ? 1 : 0;
        if (win.icon && I16[win.icon]) I16[win.icon].draw(g, bx + 4 + dd, y + 7 + dd);
        const t = this.font.ellipsis(win.title, bw - 26);
        this.font.draw(g, t, bx + 22 + dd, textY(y + 4, 22) + dd, pal.text);
        win._taskRect = { x: bx, y: y + 4, w: bw, h: 22 };
      });
    }

    // notification area: sunken, 16x16 icons, then the clock
    bevel(g, tray.x, tray.y, tray.w, tray.h, 'thinIn', pal);
    I16.phone.draw(g, tray.x + 4, tray.y + 3);
    const clock = os.clockText();
    this.font.draw(g, clock, tray.x + tray.w - 6 - this.font.measure(clock), textY(tray.y, tray.h), pal.text);
  }

  startRect() { return { x: 2, y: this.h - this.metrics.shellH + 4, w: 54, h: 22 }; }

  trayRect(os) {
    const clock = os.clockText();
    const w = this.font.measure(clock) + 32;
    const y = this.h - this.metrics.shellH + 4;
    return { x: this.w - w - 3, y, w, h: 22 };
  }

  /** The Start menu: 32 px items with 32x32 icons and the vertical banner. */
  startMenu(os) {
    const items = os.startItems();
    const ih = this.metrics.startItemH;
    let w = 0;
    for (const it of items) w = Math.max(w, this.font.measure(splitMnemonic(it.label).text) + 54);
    const bodyH = items.reduce((s, it) => s + (it.sep ? 7 : ih), 0);
    const h = bodyH + 6;
    return { x: 2, y: this.h - this.metrics.shellH - h, w: Math.max(150, w) + 22, h, banner: 22, itemH: ih, items };
  }

  paintStartMenu(g, os, hot) {
    const pal = this.pal;
    const r = os.startMenuRect;
    fill(g, r.x, r.y, r.w, r.h, pal.face);
    bevel(g, r.x, r.y, r.w, r.h, 'panel', pal);
    // the vertical banner down the left edge
    fill(g, r.x + 3, r.y + 3, r.banner, r.h - 6, pal.titleInactive);
    g.save();
    g.translate(r.x + 3, r.y + r.h - 5);
    g.rotate(-Math.PI / 2);
    this.fontBold.draw(g, `${this.osName} ${this.osVersion}`, 4, 4, pal.hi);
    g.restore();

    let y = r.y + 3;
    const x = r.x + 3 + r.banner;
    for (const it of r.items) {
      if (it.sep) {
        hline(g, x + 2, y + 3, r.w - r.banner - 10, pal.shadow);
        hline(g, x + 2, y + 4, r.w - r.banner - 10, pal.hi);
        y += 7; continue;
      }
      const on = hot === it;
      if (on) fill(g, x, y, r.w - r.banner - 6, r.itemH, pal.hilite);
      if (it.icon) {
        if (!icon32(g, it.icon, x + 1, y, this.screenTint)) {
          if (I16[it.icon]) I16[it.icon].draw(g, x + 8, y + ((r.itemH - 16) >> 1));
        }
      }
      this.fontBold.drawMnemonic(g, it.label, x + 36, textY(y, r.itemH), on ? pal.hiliteText : pal.text);
      if (it.submenu) triangle(g, r.x + r.w - 10, y + (r.itemH >> 1), 'right', on ? pal.hiliteText : pal.text, 4);
      it._rect = { x, y, w: r.w - r.banner - 6, h: r.itemH };
      y += r.itemH;
    }
  }
}

// ---------------------------------------------------------------------------
// Platinum-family chrome (tiers 3 and 4)

class PlatinumTheme extends BaseTheme {
  constructor(cfg) {
    super({
      family: 'platinum',
      pal: PLATINUM,
      globalMenuBar: true,
      metrics: {
        frame: 4, titleH: 22, menuH: 20, clientInset: 1, menuItemH: 20,
        startItemH: 20, shellH: 20, buttonH: 20, scrollbar: SCROLLBAR,
        rowH: 16, iconPitch: 75, menuBarH: 20,
      },
      ...cfg,
    });
  }

  captionButtons(win, cap) {
    const y = cap.y + 5;
    const out = [{ id: 'close', x: cap.x + 4, y, w: 12, h: 12 }];
    if (win.resizable !== false) {
      out.push({ id: 'max', x: cap.x + cap.w - 18, y, w: 12, h: 12 });
      out.push({ id: 'min', x: cap.x + cap.w - 34, y, w: 12, h: 12 });   // windowshade
    }
    return out;
  }

  platinumBox(g, b, pressed) {
    const pal = this.pal;
    frameRect(g, b.x, b.y, b.w, b.h, pal.dark);
    fill(g, b.x + 1, b.y + 1, b.w - 2, b.h - 2, pressed ? pal.shadow : pal.face);
    if (!pressed) {
      hline(g, b.x + 1, b.y + 1, b.w - 2, pal.hi);
      vline(g, b.x + 1, b.y + 1, b.h - 2, pal.hi);
      hline(g, b.x + 1, b.y + b.h - 2, b.w - 2, pal.shadow);
      vline(g, b.x + b.w - 2, b.y + 1, b.h - 2, pal.shadow);
    }
    // the little glyphs inside the collapse and zoom boxes
    if (b.id === 'max') { frameRect(g, b.x + 3, b.y + 3, 7, 7, pal.dark); fill(g, b.x + 3, b.y + 3, 4, 4, pal.dark); }
    if (b.id === 'min') hline(g, b.x + 3, b.y + (b.h >> 1), 6, pal.dark);
  }

  paintWindow(g, win, focused, os) {
    const pal = this.pal;
    const L = this.layout(win);
    const { x, y, w, h } = win;

    // frame: 1 px black, 1 px white, 2 px face, and #999999 before the black
    // on the bottom-right (macos8-03).
    fill(g, x, y, w, h, pal.face);
    frameRect(g, x, y, w, h, pal.dark);
    hline(g, x + 1, y + 1, w - 2, pal.hi);
    vline(g, x + 1, y + 1, h - 2, pal.hi);
    hline(g, x + 1, y + h - 2, w - 2, pal.shadow);
    vline(g, x + w - 2, y + 1, h - 2, pal.shadow);

    // title bar, 22 px, with the pinstripes
    // macos8-03, column x=200: black, white, 2 px #CCCCCC, 12 rows of pinstripe,
    // 4 px #CCCCCC, #999999, black — 22 rows in all.
    const cap = L.cap;
    const bar = { x: x + 1, y: y + 2, w: w - 2, h: this.metrics.titleH - 3 };
    fill(g, bar.x, bar.y, bar.w, bar.h, pal.face);
    if (focused) {
      // 12 rows of 1 px #FFFFFF / #777777, starting white — never a gradient
      for (let i = 0; i < 12; i++) {
        hline(g, bar.x, y + 4 + i, bar.w, i % 2 === 0 ? pal.hi : pal.stripe);
      }
    }
    hline(g, bar.x, y + this.metrics.titleH - 2, bar.w, pal.shadow);
    hline(g, bar.x, y + this.metrics.titleH - 1, bar.w, pal.dark);

    // title text sits on its own plate that interrupts the stripes
    const title = this.fontBold.ellipsis(win.title, bar.w - 90);
    const tw = this.fontBold.measure(title) + 16;
    const tx = bar.x + ((bar.w - tw) >> 1);
    fill(g, tx, y + 3, tw, 14, pal.face);
    this.fontBold.draw(g, title, tx + 8, y + 5, focused ? pal.text : pal.titleInactiveText);

    for (const b of L.buttons) {
      if (!focused) continue;                   // an inactive Mac window shows no boxes
      const pressed = os && os.pressed && os.pressed.kind === 'caption' && os.pressed.btn === b.id && os.pressed.hot;
      this.platinumBox(g, b, pressed);
    }

    const c = L.client;
    frameRect(g, c.x - 1, c.y - 1, c.w + 2, c.h + 2, pal.dark);
    return c;
  }

  paintDesktop(g, os) {
    checker(g, 0, 0, this.w, this.h, this.desktopA, this.desktopB);
  }

  /** The global menu bar (top) plus the window strip (bottom). */
  paintShell(g, os) {
    const pal = this.pal;
    // menu bar: #FFFFFF, 17 px #DDDDDD, #999999, #000000 (macos8-05)
    hline(g, 0, 0, this.w, pal.hi);
    fill(g, 0, 1, this.w, 17, pal.light);
    hline(g, 0, 18, this.w, pal.shadow);
    hline(g, 0, 19, this.w, pal.dark);

    const menu = os.globalMenu();
    let x = 8;
    for (let i = 0; i < menu.length; i++) {
      const m = menu[i];
      const isApple = i === 0;
      const label = splitMnemonic(m.label).text;
      const w = isApple ? 22 : this.font.measure(label) + 14;
      const open = os.menuOwner === 'global' && os.menuIndex === i;
      if (open) fill(g, x, 1, w, 17, pal.dark);
      if (isApple) {
        I16.square.draw(g, x + 3, 1);
      } else {
        this.font.drawMnemonic(g, m.label, x + 7, 4, open ? pal.hi : pal.text);
      }
      m._rect = { x, y: 0, w, h: 19 };
      x += w;
    }

    // clock at the far right, in the menu bar, like every Mac since 1991
    const clock = os.clockText();
    this.font.draw(g, clock, this.w - 10 - this.font.measure(clock), 4, pal.text);

    // the window strip along the bottom — our stand-in for the Control Strip
    const sy = this.h - this.metrics.shellH;
    fill(g, 0, sy, this.w, this.metrics.shellH, pal.face);
    hline(g, 0, sy, this.w, pal.hi);
    hline(g, 0, sy + 1, this.w, pal.light);
    hline(g, 0, this.h - 1, this.w, pal.shadow);
    let bx = 6;
    for (const win of os.wm.taskList()) {
      const active = os.wm.focused === win && !win.minimized;
      const label = this.font.ellipsis(win.title, 110);
      const w = this.font.measure(label) + 26;
      fill(g, bx, sy + 2, w, 16, pal.face);
      frameRect(g, bx, sy + 2, w, 16, pal.dark);
      if (active) {
        for (let i = 0; i < 12; i += 2) hline(g, bx + 1, sy + 3 + i / 2, w - 2, i % 4 === 0 ? pal.hi : pal.mid);
      }
      if (win.icon && I16[win.icon]) I16[win.icon].draw(g, bx + 2, sy + 2);
      this.font.draw(g, label, bx + 20, sy + 5, active ? pal.text : pal.gray);
      win._taskRect = { x: bx, y: sy + 2, w, h: 16 };
      bx += w + 5;
    }
  }

  startRect() { return { x: 0, y: 0, w: 0, h: 0 }; }
  trayRect() { return { x: this.w, y: 0, w: 0, h: 0 }; }
}

/** Straight horizontal ramp between two hexes — the ONE gradient we allow. */
export function rampColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const gg = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `#${((1 << 24) | (r << 16) | (gg << 8) | bl).toString(16).slice(1).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Cursors — 1-bit, black arrow with a white outline, drawn from a mask.
// Checklist 20: never the host browser's pointer.

function cur(hotX, hotY, art) {
  return { hotX, hotY, art, w: art[0].length, h: art.length };
}

export const CURSORS = {
  arrow: cur(0, 0, [
    'X.........',
    'XX........',
    'XOX.......',
    'XOOX......',
    'XOOOX.....',
    'XOOOOX....',
    'XOOOOOX...',
    'XOOOOOOX..',
    'XOOOOOOOX.',
    'XOOOOOOOOX',
    'XOOOOOXXXX',
    'XOOXOOX...',
    'XOX.XOOX..',
    'XX..XOOX..',
    'X....XOOX.',
    '......XOOX',
    '.......XX.',
  ]),
  // The tier-1 machine has a fatter, cruder pointer — a cheap driver's idea of one.
  chunky: cur(0, 0, [
    'XX.........',
    'XXX........',
    'XOXX.......',
    'XOOXX......',
    'XOOOXX.....',
    'XOOOOXX....',
    'XOOOOOXX...',
    'XOOOOOOXX..',
    'XOOOOOOOXX.',
    'XOOOOOOOOXX',
    'XOOOOOOOXXX',
    'XOOOXOOOX..',
    'XOOXXOOOX..',
    'XOX.XOOOX..',
    'XX..XOOOX..',
    'X....XOOX..',
    '.....XOOX..',
    '......XX...',
  ]),
  ibeam: cur(3, 8, [
    'XXXXX',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    '..X..',
    'XXXXX',
  ]),
  // The hourglass: Windows waits with sand, the Mac with a watch.
  wait: cur(7, 7, [
    'XXXXXXXXXXXX',
    'XOOOOOOOOOOX',
    'XOXXXXXXXXOX',
    '.XOXXXXXXOX.',
    '..XOXXXXOX..',
    '...XOXXOX...',
    '....XOOX....',
    '....XOOX....',
    '...XOXXOX...',
    '..XOXOOXOX..',
    '.XOXOOOOXOX.',
    'XOXOOOOOOXOX',
    'XOXXXXXXXXOX',
    'XOOOOOOOOOOX',
    'XXXXXXXXXXXX',
  ]),
  watch: cur(7, 7, [
    '..XXXXXX..',
    '.XOOOOOOX.',
    'XOOOOOOOOX',
    'XOOOXOOOOX',
    'XOOOXOOOOX',
    'XOOOXXXOOX',
    'XOOOOOOOOX',
    'XOOOOOOOOX',
    '.XOOOOOOX.',
    '..XXXXXX..',
  ]),
  hresize: cur(4, 4, [
    '..X...X..',
    '.XX...XX.',
    'XOXXXXXOX',
    '.XX...XX.',
    '..X...X..',
  ]),
  move: cur(7, 7, [
    '....XX....',
    '...XOOX...',
    '..XXOOXX..',
    '....XX....',
    'X...XX...X',
    'XXXXXXXXXX',
    'XOOOOOOOOX',
    'XXXXXXXXXX',
    'X...XX...X',
    '....XX....',
    '..XXOOXX..',
    '...XOOX...',
    '....XX....',
  ]),
};

// ---------------------------------------------------------------------------
// The four machines.
//
// `grants` is the contract with the rest of the game: what this machine buys the
// player. The editor reads it through os.grants (see the handoff notes).

export const TIERS = [
  {
    tier: 1,
    hardware: 'Pentagram 133',
    spec: '133 MHz - 16 MB RAM - 1.2 GB',
    osName: 'TRESTLE',
    osVersion: '3.1',
    tagline: 'Trestle Workbench 3.1',
    w: 640, h: 480,
    family: 'win',
    gradientTitle: false,
    quickLaunch: false,
    startLabel: 'Start',
    desktopA: '#008080', desktopB: '#000000', desktopDither: true,
    screenTint: VGA.teal,
    cursorKind: 'chunky',
    crt: true,                 // scanlines and grain on the office monitor
    slow: true,                // outline window drag, visible redraw
    sound: 'os.boot-tier1',
    grants: {
      undo: 5, viewportScale: 0.55, daylightPreview: false, shadowPreview: false,
      autosave: false, maxVariants: 2, orbitSmoothing: 0,
      note: 'Outline drag, 5 levels of undo, no live daylight.',
    },
  },
  {
    tier: 2,
    hardware: 'Kompakt 2000',
    spec: '450 MHz - 128 MB RAM - 8 GB',
    osName: 'CORNICE',
    osVersion: '98',
    tagline: 'Cornice 98 Second Edition',
    w: 800, h: 600,
    family: 'win',
    gradientTitle: true,
    quickLaunch: true,
    startLabel: 'Start',
    desktopA: '#008080', desktopB: '#008080', desktopDither: false,
    screenTint: VGA.navy,
    cursorKind: 'arrow',
    crt: true,
    slow: false,
    sound: 'os.boot-tier2',
    grants: {
      undo: 25, viewportScale: 0.72, daylightPreview: false, shadowPreview: false,
      autosave: true, maxVariants: 6, orbitSmoothing: 0.15,
      note: 'Live window drag, 25 levels of undo, autosave.',
    },
  },
  {
    tier: 3,
    hardware: 'Sunstation Pro',
    spec: '733 MHz - 512 MB RAM - 40 GB',
    osName: 'VELLUM',
    osVersion: '8',
    tagline: 'Vellum 8 Platinum',
    w: 1024, h: 768,
    family: 'platinum',
    desktopA: '#CCCCCC', desktopB: '#999999',
    screenTint: VGA.silver,
    cursorKind: 'arrow',
    waitCursor: 'watch',
    crt: false,
    slow: false,
    sound: 'os.boot-tier3',
    grants: {
      undo: 80, viewportScale: 0.85, daylightPreview: true, shadowPreview: false,
      autosave: true, maxVariants: 12, orbitSmoothing: 0.25,
      note: 'Live daylight preview, 80 levels of undo.',
    },
  },
  {
    tier: 4,
    hardware: 'Melon Studio M5',
    spec: '1.2 GHz - 1.5 GB RAM - 120 GB',
    osName: 'ATELIER',
    osVersion: '9',
    tagline: 'Atelier 9 Studio Edition',
    w: 1152, h: 870,
    family: 'platinum',
    desktopA: '#DDDDDD', desktopB: '#CCCCCC',
    screenTint: VGA.white,
    cursorKind: 'arrow',
    waitCursor: 'watch',
    crt: false,
    slow: false,
    sound: 'os.boot-tier4',
    grants: {
      undo: 250, viewportScale: 1.0, daylightPreview: true, shadowPreview: true,
      autosave: true, maxVariants: 32, orbitSmoothing: 0.35,
      note: 'Live daylight and shadows, 250 levels of undo, the full viewport.',
    },
  },
];

export function tierConfig(n) {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, (n | 0) - 1))];
}

export function grantsFor(n) { return tierConfig(n).grants; }

export function makeTheme(n) {
  const cfg = tierConfig(n);
  return cfg.family === 'platinum' ? new PlatinumTheme(cfg) : new WinTheme(cfg);
}

// ---------------------------------------------------------------------------
// Boot sequences. Each tier boots differently, and every one of them ends by
// playing its own startup sound through src/core/audio.js.

export const BOOT = {
  1: {
    duration: 5.0,
    soundAt: 2.6,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#000000');
      const lines = [
        'Pentagram BIOS v2.11  (C) 1996 Pentagram Micro',
        '',
        'Main Processor    : P133 MMX',
        'Memory Test       : ',
        '',
        'Detecting IDE Primary Master   ... QUANTUM 1275AT',
        'Detecting IDE Primary Slave    ... None',
        'Detecting Floppy Drive A       ... 1.44 MB, 3.5 in.',
        'Detecting Display Adapter      ... TRIDENT 1 MB',
        '',
        'Starting TRESTLE 3.1 ...',
      ];
      const shown = Math.min(lines.length, Math.floor(t / 0.16));
      for (let i = 0; i < shown; i++) {
        let s = lines[i];
        if (i === 3) {
          const k = Math.min(16384, Math.floor(t * 12000));
          s += `${k} KB ${k >= 16384 ? 'OK' : ''}`;
        }
        SANS.draw(g, s, 16, 14 + i * 13, '#C0C0C0');
      }
      if (t > 2.4) {
        // the splash: a plain 16-colour panel, no photography, no gradient
        const w = 380, h = 180, x = (th.w - w) >> 1, y = (th.h - h) >> 1;
        fill(g, x, y, w, h, '#C0C0C0');
        bevel(g, x, y, w, h, 'panel', WIN);
        fill(g, x + 4, y + 4, w - 8, 42, '#000080');
        SANS_BOLD.draw(g, 'TRESTLE', x + 16, y + 12, '#FFFFFF');
        SANS.draw(g, 'Workbench 3.1', x + 16, y + 28, '#C0C0C0');
        SANS.draw(g, 'Pentagram 133  -  16 MB', x + 16, y + 60, '#000000');
        SANS.draw(g, 'Smendilendi Bureau licence: single seat', x + 16, y + 76, '#000000');
        const frac = Math.min(1, (t - 2.6) / 2.0);
        const bar = { x: x + 16, y: y + 110, w: w - 32, h: 18 };
        bevel(g, bar.x, bar.y, bar.w, bar.h, 'sunken', WIN);
        for (let i = 0; i < Math.floor(frac * 20); i++) fill(g, bar.x + 2 + i * 10, bar.y + 2, 8, bar.h - 4, '#000080');
        SANS.draw(g, 'Loading system files', x + 16, y + 136, '#808080');
      }
    },
  },
  2: {
    duration: 4.2,
    soundAt: 0.6,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#000000');
      const w = 520, h = 260, x = (th.w - w) >> 1, y = (th.h - h) >> 1;
      fill(g, x, y, w, h, '#C0C0C0');
      bevel(g, x, y, w, h, 'panel', WIN);
      for (let i = 0; i < w - 8; i++) {
        fill(g, x + 4 + i, y + 4, 1, 70, rampColor('#000080', '#1084D0', i / (w - 9)));
      }
      SANS_BOLD.draw(g, 'CORNICE', x + 20, y + 18, '#FFFFFF');
      SANS.draw(g, '98  Second Edition', x + 20, y + 36, '#C0C0C0');
      SANS.draw(g, 'Kompakt 2000', x + 20, y + 54, '#C0C0C0');
      SANS.draw(g, 'Starting up...', x + 20, y + 96, '#000000');
      const frac = Math.min(1, t / 3.4);
      const bar = { x: x + 20, y: y + 120, w: w - 40, h: 20 };
      bevel(g, bar.x, bar.y, bar.w, bar.h, 'sunken', WIN);
      const n = Math.floor(frac * ((bar.w - 4) / 10));
      for (let i = 0; i < n; i++) fill(g, bar.x + 2 + i * 10, bar.y + 2, 8, bar.h - 4, '#000080');
      SANS.draw(g, 'Copyright (C) 1998 Cornice Systems. All rights reserved.', x + 20, y + h - 40, '#808080');
    },
  },
  3: {
    duration: 4.4,
    soundAt: 0.4,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#CCCCCC');
      const w = 460, h = 150, x = (th.w - w) >> 1, y = ((th.h - h) >> 1) - 40;
      fill(g, x, y, w, h, '#FFFFFF');
      frameRect(g, x, y, w, h, '#000000');
      for (let i = 0; i < 12; i++) hline(g, x + 1, y + 4 + i, w - 2, i % 2 === 0 ? '#FFFFFF' : '#777777');
      SANS_BOLD.draw(g, 'Vellum 8', x + 24, y + 40, '#000000');
      SANS.draw(g, 'Sunstation Pro', x + 24, y + 58, '#777777');
      SANS.draw(g, 'Welcome to Vellum', x + 24, y + 92, '#000000');
      SANS.draw(g, 'Starting up the desktop', x + 24, y + 110, '#777777');
      // extensions marching along the bottom, the way a Mac announced itself
      const n = Math.min(9, Math.floor(t * 3));
      for (let i = 0; i < n; i++) {
        const ix = 40 + i * 40, iy = th.h - 90;
        const which = ['folder', 'floppy', 'phone', 'printer', 'doc', 'clock', 'settings', 'computer', 'design'][i % 9];
        if (I16[which]) {
          I16[which].draw(g, ix, iy);
          I16[which].draw(g, ix + 16, iy);
        }
      }
    },
  },
  4: {
    duration: 4.0,
    soundAt: 0.4,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#DDDDDD');
      const w = 520, h = 190, x = (th.w - w) >> 1, y = ((th.h - h) >> 1) - 30;
      fill(g, x, y, w, h, '#FFFFFF');
      frameRect(g, x, y, w, h, '#000000');
      for (let i = 0; i < 12; i++) hline(g, x + 1, y + 4 + i, w - 2, i % 2 === 0 ? '#FFFFFF' : '#777777');
      SANS_BOLD.draw(g, 'ATELIER 9', x + 28, y + 44, '#000000');
      SANS.draw(g, 'Studio Edition  -  Melon Studio M5', x + 28, y + 62, '#777777');
      SANS.draw(g, '1152 x 870, millions of colours', x + 28, y + 96, '#000000');
      SANS.draw(g, 'Drawing tablet found', x + 28, y + 112, '#000000');
      const frac = Math.min(1, t / 3.2);
      const bar = { x: x + 28, y: y + 140, w: w - 56, h: 14 };
      frameRect(g, bar.x, bar.y, bar.w, bar.h, '#000000');
      fill(g, bar.x + 1, bar.y + 1, Math.floor((bar.w - 2) * frac), bar.h - 2, '#777777');
      checker(g, bar.x + 1, bar.y + 1, Math.floor((bar.w - 2) * frac), bar.h - 2, '#999999', '#777777');
    },
  },
};
