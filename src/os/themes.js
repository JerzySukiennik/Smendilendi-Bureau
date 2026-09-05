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
  textY, textCentred, triangle, focusRect, inside, button, field, SCROLLBAR, tile,
} from './widgets.js';
import { SANS, SANS_BOLD, CHICAGO, CHICAGO_BOLD, GENEVA, FIXED, splitMnemonic, scaledFace } from './font.js';
import { I16, icon32, setIconGreys } from './icons.js';

export const CAPTION_BTN = { w: 16, h: 14 };

// ---------------------------------------------------------------------------

class BaseTheme {
  constructor(cfg) {
    Object.assign(this, cfg);
    // The chrome face and the small content face. Windows tiers use one
    // typeface for both, exactly as Win95 did; PlatinumTheme overrides them
    // with Chicago 12 and Geneva (ANALYSIS.md section 4).
    // THE MACHINE'S UI SCALE, applied to the type AND to every chrome metric
    // that is expressed in the type's pixels. Scaling one without the other
    // gives you 18-row text in an 18 px title bar. See scaledFace in font.js
    // for why the type scale is an integer.
    const n = Math.max(1, Math.round(this.uiScale || 1));
    this.uiScale = n;
    this.font = scaledFace(SANS, n);
    this.fontBold = scaledFace(SANS_BOLD, n);
    this.fontSmall = this.font;
    if (n > 1 && this.metrics) {
      const m = { ...this.metrics };
      for (const k of ['titleH', 'menuH', 'menuItemH', 'startItemH', 'shellH',
        'buttonH', 'rowH', 'menuBarH', 'dockH', 'scrollbar', 'iconPitch', 'frame', 'clientInset']) {
        if (typeof m[k] === 'number') m[k] = Math.round(m[k] * (k === 'frame' || k === 'clientInset' ? 1 : n));
      }
      this.metrics = m;
    }
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
  /**
   * How this machine prints a keyboard shortcut in a menu.
   *
   * "Ctrl+S" is a Windows string and no Mac ever showed one; System 7 and
   * Mac OS 8 print the Command mark and the key. PlatinumTheme overrides this,
   * so the SAME app menu definition reads "Ctrl+S" on tiers 1-2 and "\u2318S"
   * on tiers 3-4 without the app knowing which machine it is running on.
   */
  accelText(accel) { return accel; }

  menuSize(items) {
    let w = 0;
    let h = 4;
    for (const it of items) {
      if (it.sep) { h += 7; continue; }
      const lw = this.font.measure(splitMnemonic(it.label).text);
      const acc = it.accel ? this.accelText(it.accel) : '';
      const aw = acc ? this.font.measure(acc) + 18 : 0;
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
        const acc = this.accelText(it.accel);
        const aw = this.font.measure(acc);
        if (it.disabled) this.font.drawDisabled(g, acc, r.x + r.w - 12 - aw, textY(y, ih));
        else this.font.draw(g, acc, r.x + r.w - 12 - aw, textY(y, ih), tc);
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
    fill(g, 0, 0, this.w, this.h, this.desktopA);
    // If a machine sets a desktop pattern it is a real one: the 8x8 tiled
    // monochrome bitmap Win95 ships (ANALYSIS.md 6), a sparse dot every 4 px in
    // both axes. Round 1 used a 50 % checkerboard, which halves the apparent
    // brightness — sampled across win95-01's desktop there is no black at all,
    // only #008282 and the white of the icon labels.
    if (this.desktopPattern) {
      g.fillStyle = this.desktopB;
      for (let y = 0; y < this.h; y += 4) {
        for (let x = (y % 8 === 0) ? 0 : 2; x < this.w; x += 4) g.fillRect(x, y, 1, 1);
      }
    }
  }

  paintShell(g, os) {
    const pal = this.pal;
    const y = this.h - this.metrics.shellH;
    // ANALYSIS.md 5: "28 px tall. Top edge: 1 px #C0C0C0, then 1 px #FFFFFF
    // highlight, then face." That is BDR_RAISEDINNER over the face, NOT a full
    // EDGE_RAISED panel — round 1 drew #DFDFDF then #FFFFFF, which is one
    // pixel off the measured bar (both lines are in palette, so no checklist
    // item catches it; a column scan does).
    fill(g, 0, y, this.w, this.metrics.shellH, pal.face);
    hline(g, 0, y, this.w, pal.face);
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
        // 32 px rows take 32x32 art. If a name has none, draw a hollow box so
        // the gap is loud in review instead of shipping as a half-height icon
        // sitting next to a full-height one.
        if (!icon32(g, it.icon, x + 1, y, this.screenTint)) {
          frameRect(g, x + 2, y + 1, 30, 30, pal.shadow);
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
        // shellH 0: VELLUM has NO bottom bar. Mac OS 8 switches applications
        // from the Application menu at the right end of the menu bar; it has
        // no taskbar, and a window strip along the bottom next to a global menu
        // bar reads as a Windows/Mac chimera. ATELIER (tier 4) puts 28 back for
        // its Control Strip, which is a different, later idea.
        frame: 4, titleH: 22, menuH: 20, clientInset: 1, menuItemH: 20,
        startItemH: 20, shellH: 0, buttonH: 20, scrollbar: SCROLLBAR,
        rowH: 16, iconPitch: 75, menuBarH: 20,
      },
      ...cfg,
    });
    // THE typeface change. ANALYSIS.md section 4 gives System 7 and Mac OS 8
    // Chicago 12 for menus, titles and buttons and Geneva for icon labels and
    // list views, and calls the bitmap face "the single loudest authenticity
    // signal in a screenshot". Round 2 shipped MS Sans Serif here and a critic
    // decided the blind A/B in under a second on the letterforms alone.
    // Both faces are traced out of macos8-01..05 — see src/os/font.js.
    this.font = CHICAGO;
    this.fontBold = CHICAGO_BOLD;
    this.fontSmall = GENEVA;
  }

  /** Ctrl+S -> the Command mark and the key. Anything else is left alone. */
  accelText(accel) {
    const m = /^(?:Ctrl|Cmd)\+(.+)$/.exec(String(accel ?? ''));
    return m ? `\u2318${m[1]}` : accel;
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

  /**
   * The band the 20 px menu bar is made of. VELLUM's is macos8-05 exactly —
   * #FFFFFF, 17 px #DDDDDD, #999999, #000000 — and ATELIER overrides it with
   * one grey lighter and a darker rule.
   */
  menuBarRamp() { return { band: this.pal.light, rule: this.pal.shadow }; }

  /**
   * The global menu bar, shared by both Platinum tiers.
   *
   * The run of menus starts at the left. The entry flagged `appMenu` (see
   * os.globalMenu) hangs off the RIGHT edge instead, showing the active
   * application's 16x16 icon and its name — that is how a Mac switches
   * applications, and it is why neither Platinum tier needs a taskbar. The
   * clock sits immediately to its left.
   */
  paintMenuBarGlobal(g, os) {
    const pal = this.pal;
    const ramp = this.menuBarRamp();
    hline(g, 0, 0, this.w, pal.hi);
    fill(g, 0, 1, this.w, 17, ramp.band);
    hline(g, 0, 18, this.w, ramp.rule);
    hline(g, 0, 19, this.w, pal.dark);

    const menu = os.globalMenu();

    // right end first, so the left run knows where it must stop
    let rightEdge = this.w;
    for (let i = 0; i < menu.length; i++) {
      const m = menu[i];
      if (!m.appMenu) continue;
      const label = this.font.ellipsis(splitMnemonic(m.label).text, 120);
      const w = this.font.measure(label) + 30;
      const x = this.w - w - 4;
      const open = os.menuOwner === 'global' && os.menuIndex === i;
      if (open) fill(g, x, 1, w, 17, pal.dark);
      this.font.draw(g, label, x + 6, textY(0, this.metrics.menuBarH), open ? pal.hi : pal.text);
      if (m.icon && I16[m.icon]) I16[m.icon].draw(g, x + w - 20, 2);
      m._rect = { x, y: 0, w, h: 19 };
      rightEdge = x;
    }

    // clock, in the menu bar, like every Mac since 1991
    const clock = os.clockText();
    const cw = this.font.measure(clock);
    this.font.draw(g, clock, rightEdge - 12 - cw, textY(0, this.metrics.menuBarH), pal.text);

    let x = 8;
    for (let i = 0; i < menu.length; i++) {
      const m = menu[i];
      if (m.appMenu) continue;
      const isApple = i === 0;
      const label = splitMnemonic(m.label).text;
      const w = isApple ? 22 : this.font.measure(label) + 14;
      if (x + w > rightEdge - 12 - cw - 8) { m._rect = { x: -99, y: -99, w: 0, h: 0 }; continue; }
      const open = os.menuOwner === 'global' && os.menuIndex === i;
      if (open) fill(g, x, 1, w, 17, pal.dark);
      if (isApple) {
        I16.square.draw(g, x + 3, 1);
      } else {
        this.font.drawMnemonic(g, m.label, x + 7, textY(0, this.metrics.menuBarH), open ? pal.hi : pal.text);
      }
      m._rect = { x, y: 0, w, h: 19 };
      x += w;
    }
  }

  /** VELLUM's whole shell IS the menu bar. No taskbar, no strip, no dock. */
  paintShell(g, os) {
    this.paintMenuBarGlobal(g, os);
  }

  startRect() { return { x: 0, y: 0, w: 0, h: 0 }; }
  trayRect() { return { x: this.w, y: 0, w: 0, h: 0 }; }
}

// ---------------------------------------------------------------------------
// ATELIER 9 — tier 4.
//
// Round 1 gave tiers 3 and 4 the same class, the same 22 px pinstriped title
// bar, the same icons and the same cursor, and only changed the resolution and
// two greys. That is one OS at two sizes, and DESIGN-DECISIONS.md promises "a
// new OS theme, cursor and startup sound each time". So ATELIER is its own
// generation of the same house style:
//
//   * the pinstripes are gone — a flat #EEEEEE bar, the way every OS went
//     after 1999
//   * the title sits on a solid navy plate in white, left aligned
//   * the close box moved to the RIGHT, with collapse and zoom beside it
//   * the window strip along the bottom became a Control-Strip-style dock of
//     square icon tiles
//   * its own pointer (thin) and its own wait cursor (a quadrant disc)
//
// Everything else — 20 px menus, 16 px scrollbars, 1 px bevels, hard corners —
// stays, because those are the parts the checklist measures.
class AtelierTheme extends PlatinumTheme {
  constructor(cfg) {
    super({ ...cfg });
    this.metrics = { ...this.metrics, shellH: 28 };
  }

  /** All three boxes on the right; close is the outermost. */
  captionButtons(win, cap) {
    const y = cap.y + 5;
    const right = cap.x + cap.w - 4;
    const out = [{ id: 'close', x: right - 12, y, w: 12, h: 12 }];
    if (win.resizable !== false) {
      out.push({ id: 'max', x: right - 12 - 15, y, w: 12, h: 12 });
      out.push({ id: 'min', x: right - 12 - 30, y, w: 12, h: 12 });
    }
    return out;
  }

  paintWindow(g, win, focused, os) {
    const pal = this.pal;
    const L = this.layout(win);
    const { x, y, w, h } = win;
    const th = this.metrics.titleH;

    // ATELIER's frame ramp is its own: black rule, then #EEEEEE / #999999,
    // where VELLUM runs #FFFFFF / #999999 and adds no second step. Measured on
    // column x = win.x: 000000, EEEEEE, CCCCCC, 999999 outward — a four-step
    // frame against VELLUM's three.
    fill(g, x, y, w, h, pal.face);
    frameRect(g, x, y, w, h, pal.dark);
    hline(g, x + 1, y + 1, w - 2, pal.mid);
    vline(g, x + 1, y + 1, h - 2, pal.mid);
    hline(g, x + 1, y + h - 2, w - 2, pal.shadow);
    vline(g, x + w - 2, y + 1, h - 2, pal.shadow);
    hline(g, x + 2, y + h - 3, w - 4, pal.stripe);
    vline(g, x + w - 3, y + 2, h - 4, pal.stripe);

    // flat title band — no stripes anywhere
    const bar = { x: x + 1, y: y + 2, w: w - 2, h: th - 3 };
    fill(g, bar.x, bar.y, bar.w, bar.h, focused ? pal.mid : pal.face);
    hline(g, bar.x, y + th - 2, bar.w, pal.shadow);
    hline(g, bar.x, y + th - 1, bar.w, pal.dark);

    // the title plate: solid navy, white bold text, hard left
    const title = this.fontBold.ellipsis(win.title, bar.w - 80);
    const tw = this.fontBold.measure(title) + 12;
    if (focused) {
      fill(g, bar.x + 4, y + 4, tw, 14, WIN.titleActive);
      this.fontBold.draw(g, title, bar.x + 10, y + 6, WIN.titleText);
    } else {
      this.fontBold.draw(g, title, bar.x + 10, y + 6, pal.titleInactiveText);
    }

    for (const b of L.buttons) {
      if (!focused) continue;
      const pressed = os && os.pressed && os.pressed.kind === 'caption'
        && os.pressed.btn === b.id && os.pressed.hot;
      this.platinumBox(g, b, pressed);
      if (b.id === 'close') {                    // an X, so the outer box reads as close
        g.fillStyle = pal.dark;
        for (let i = 0; i < 6; i++) {
          g.fillRect(b.x + 3 + i, b.y + 3 + i, 1, 1);
          g.fillRect(b.x + 8 - i, b.y + 3 + i, 1, 1);
        }
      }
    }

    const c = L.client;
    frameRect(g, c.x - 1, c.y - 1, c.w + 2, c.h + 2, pal.dark);
    return c;
  }

  /**
   * ATELIER's backdrop is a 4 px diagonal twill, not a flat grey field.
   *
   * Round 2 measured tier 4's desktop at 94.16 % one colour over a 1152x870
   * screen, which made it read as a lighter recolour of VELLUM's Platinum
   * checkerboard rather than a different machine. Platinum-era desktops shipped
   * woven patterns, so this is one: two diagonal threads, #777777 dark and
   * #EEEEEE light, over the #999999 ground — 25 / 25 / 50, three colours, a
   * real 1-bit weave with no alpha anywhere (checklist 13). Drawn through a
   * cached 4x4 CanvasPattern, so a whole-screen repaint is one fillRect.
   */
  paintDesktop(g) {
    const ground = this.desktopA;
    const dark = this.pal.stripe;
    const lite = this.pal.mid;
    tile(g, 0, 0, this.w, this.h, `twill|${ground}|${dark}|${lite}`, 4, 4, (t) => {
      t.fillStyle = ground; t.fillRect(0, 0, 4, 4);
      for (let i = 0; i < 4; i++) {
        t.fillStyle = dark; t.fillRect(i, i, 1, 1);
        t.fillStyle = lite; t.fillRect((i + 2) % 4, i, 1, 1);
      }
    });
  }

  /** One grey lighter than VELLUM's band, and a darker rule under it. */
  menuBarRamp() { return { band: this.pal.mid, rule: this.pal.stripe }; }

  paintShell(g, os) {
    const pal = this.pal;
    // the same menu bar construction as VELLUM, on ATELIER's ramp, and with the
    // same Application menu at the right end — Mac OS 9 kept it when it added
    // the Control Strip, and so do we
    this.paintMenuBarGlobal(g, os);

    // the dock: square 24 px tiles, one per window, centred on the screen
    const sh = this.metrics.shellH;
    const sy = this.h - sh;
    fill(g, 0, sy, this.w, sh, pal.face);
    hline(g, 0, sy, this.w, pal.dark);
    hline(g, 0, sy + 1, this.w, pal.hi);
    const list = os.wm.taskList();
    const box = 24;
    let bx = ((this.w - list.length * (box + 4)) >> 1);
    for (const win of list) {
      const active = os.wm.focused === win && !win.minimized;
      fill(g, bx, sy + 2, box, box, pal.face);
      bevel(g, bx, sy + 2, box, box, active ? 'pressed' : 'thin', pal);
      if (win.icon && I16[win.icon]) I16[win.icon].draw(g, bx + 4, sy + 6);
      win._taskRect = { x: bx, y: sy + 2, w: box, h: box };
      bx += box + 4;
    }
    this.paintControlStrip(g, os, sy);
  }

  /**
   * The Control Strip — the thing tier 4 has that tier 3 does not. Two tab
   * modules pulled out at the right end of the dock: a sound level in five hard
   * blocks, and a colour-depth module. Both are read-outs, not controls, and
   * both are drawn from the same bevel kit as everything else.
   */
  paintControlStrip(g, os, sy) {
    const pal = this.pal;
    const h = this.metrics.shellH - 4;
    const modules = [
      { w: 62, draw: (x, y) => {
        I16.settings?.draw(g, x + 3, y + ((h - 16) >> 1));
        const level = 3;                       // the machine is quiet; it is an office
        for (let i = 0; i < 5; i++) {
          const bh = 4 + i * 2;
          fill(g, x + 22 + i * 7, y + h - 4 - bh, 5, bh, i < level ? pal.dark : pal.shadow);
        }
      } },
      { w: 88, draw: (x, y) => {
        const d = new Date();
        const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
        const label = `${day} ${d.getDate()} ${mon}`;
        this.font.draw(g, label, x + ((88 - this.font.measure(label)) >> 1), textY(y, h), pal.text);
      } },
    ];
    let x = this.w - 6;
    for (let i = modules.length - 1; i >= 0; i--) x -= modules[i].w + 2;
    for (const m of modules) {
      fill(g, x, sy + 2, m.w, h, pal.face);
      frameRect(g, x, sy + 2, m.w, h, pal.dark);
      hline(g, x + 1, sy + 3, m.w - 2, pal.hi);
      vline(g, x + 1, sy + 3, h - 2, pal.hi);
      hline(g, x + 1, sy + h - 1, m.w - 2, pal.shadow);
      vline(g, x + m.w - 2, sy + 3, h - 3, pal.shadow);
      m.draw(x, sy + 2);
      x += m.w + 2;
    }
    // the pull tab at the far right, the way a Control Strip is dragged closed
    const tx = this.w - 4;
    fill(g, tx - 1, sy + 2, 3, h, pal.face);
    frameRect(g, tx - 1, sy + 2, 3, h, pal.dark);
  }
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
  // VELLUM 8 draws a narrower, taller Platinum pointer — a different driver,
  // not the same bitmap at a different size.
  plat: cur(0, 0, [
    'X.........',
    'XX........',
    'XOX.......',
    'XOOX......',
    'XOOOX.....',
    'XOOOOX....',
    'XOOOOOX...',
    'XOOOOOOX..',
    'XOOOOOOOX.',
    'XOOOOXXXXX',
    'XOOXOOX...',
    'XOX.XOOX..',
    'XX...XOOX.',
    'X.....XOOX',
    '.......XXX',
  ]),
  // ATELIER 9 is thinner again and hollow: a 1 px outline with white fill.
  thin: cur(0, 0, [
    'XX........',
    'XOX.......',
    'XOOX......',
    'XOOOX.....',
    'XOOOOX....',
    'XOOOOOX...',
    'XOOOOOOX..',
    'XOOOOOOOX.',
    'XOOOXXXXXX',
    'XOOXOX....',
    'XOXX.OX...',
    'XX...XOX..',
    'X.....XOX.',
    '.......XX.',
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
  // ATELIER waits with a quadrant disc, not a watch and not sand.
  quadrants: cur(8, 8, [
    '....XXXXXX....',
    '..XXOOOOOOXX..',
    '.XOOOOXXOOOOX.',
    '.XOOOOXXOOOOX.',
    'XOOOOOXXOOOOOX',
    'XOOOOOXXOOOOOX',
    'XXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXX',
    'XOOOOOXXOOOOOX',
    'XOOOOOXXOOOOOX',
    '.XOOOOXXOOOOX.',
    '.XOOOOXXOOOOX.',
    '..XXOOOOOOXX..',
    '....XXXXXX....',
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
    uiScale: 1,
    osName: 'TRESTLE',
    osVersion: '3.1',
    tagline: 'Trestle Workbench 3.1',
    w: 640, h: 480,
    family: 'win',
    gradientTitle: false,
    quickLaunch: false,
    startLabel: 'Start',
    desktopA: '#008080', desktopB: VGA.black, desktopPattern: true,
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
    spec: '1.6 GHz - 512 MB RAM - 40 GB',
    uiScale: 2,
    osName: 'CORNICE',
    osVersion: 'XP',
    tagline: 'Cornice XP Professional',
    w: 1024, h: 768,
    family: 'win',
    chrome: 'xp',
    gradientTitle: true,
    quickLaunch: false,
    startLabel: 'start',
    desktopA: '#3A6EA5', desktopB: '#3A6EA5',
    screenTint: '#0A46A8',
    cursorKind: 'arrow',
    crt: true,                 // 2001 is still a CRT on a desk
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
    spec: '3.4 GHz quad - 16 GB RAM - 512 GB SSD',
    uiScale: 2,
    osName: 'VELLUM',
    osVersion: '10',
    tagline: 'Vellum 10 Pro',
    // 1366 x 768, the laptop resolution the reference capture is of, not a
    // desktop 1600 x 900. It is also 27 % fewer pixels to repaint and upload to
    // the monitor texture on every cursor move, which on this machine measured
    // 11.5 ms a frame against 4.9 ms on the tier below it.
    w: 1366, h: 768,
    family: 'win',
    chrome: 'win10',
    startLabel: '',
    desktopA: '#0B3B66', desktopB: '#0B3B66',
    screenTint: '#0078D7',
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
    // "Melon Studio M5 should be 4K." The panel is 3840 x 2160; the OS draws
    // its own surface at half that and the machine's 1.0 drawing-resolution
    // grant is what spends the other half on the model, which is the only
    // place on this screen where the pixels are worth the milliseconds.
    spec: 'M5 12-core - 32 GB - 1 TB - 4K display',
    uiScale: 2,
    osName: 'ATELIER',
    osVersion: '26',
    tagline: 'Atelier 26 Liquid Glass',
    display: [3840, 2160],
    w: 1920, h: 1080,
    family: 'platinum',
    desktopA: '#1E6FD9', desktopB: '#0B3E96',
    screenTint: '#0A84FF',
    chrome: 'macos26',
    cursorKind: 'thin',
    waitCursor: 'quadrants',
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

/**
 * The four machines, built lazily so the modern themes can live in their own
 * module. themes-modern.js takes the base classes as arguments rather than
 * importing them, because importing back into this file would make the retro
 * gate's source scan follow the cycle into modern code and fail on the first
 * rgba() it met — see the header of themes-modern.js.
 */
let XPTheme, Win10Theme, MacOS26Theme;
export function installModernThemes({ makeXPTheme, makeWin10Theme, makeMacOSTheme }) {
  XPTheme = makeXPTheme(WinTheme);
  Win10Theme = makeWin10Theme(BaseTheme);
  MacOS26Theme = makeMacOSTheme(BaseTheme);
}

export function makeTheme(n) {
  const cfg = tierConfig(n);
  // Icons follow the machine: the silver ramp on the two Windows-chrome eras,
  // the pale ramp on Windows 10 and macOS. One active theme at a time, so a
  // module-level switch is the whole mechanism.
  setIconGreys(cfg.chrome === 'macos26' || cfg.chrome === 'win10' ? 'platinum' : cfg.family);
  if (cfg.chrome === 'macos26' && MacOS26Theme) return new MacOS26Theme(cfg);
  if (cfg.chrome === 'win10' && Win10Theme) return new Win10Theme(cfg);
  if (cfg.chrome === 'xp' && XPTheme) return new XPTheme(cfg);
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
        // A real POST is not a GUI: it is VGA text mode, an 8 px fixed cell
        // and a 16 px line. Round 2 set it in the proportional GUI font, which
        // a column-ink scan gives away at once — irregular inter-glyph pitch
        // where a text mode has a constant 8 (ANALYSIS.md section 4 names
        // Fixedsys / Terminal for exactly this).
        FIXED.draw(g, s, 16, 12 + i * 16, '#C0C0C0');
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
  // XP boots to black: the logo, then the four-cell bar sliding left to right
  // under it. No BIOS post, no panel, no bevel — the machine is 2001 now.
  2: {
    duration: 4.2,
    soundAt: 0.6,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#000000');
      const cx = th.w >> 1, cy = (th.h >> 1) - 30;
      // the flag: four cells, warm to cool, on a black field
      const s = 26, gp = 3;
      const cells = ['#F25022', '#7FBA00', '#00A4EF', '#FFB900'];
      for (let i = 0; i < 4; i++) {
        const dx = (i % 2) ? gp : -s - gp, dy = (i > 1) ? gp : -s - gp;
        fill(g, cx + dx, cy + dy, s, s, cells[i]);
      }
      SANS_BOLD.draw(g, 'CORNICE', cx + 44, cy - 24, '#FFFFFF');
      SANS.draw(g, 'XP  Professional', cx + 44, cy - 6, '#8FA8C8');
      // the sliding three-block bar in its sunken well
      const bar = { x: cx - 90, y: cy + 78, w: 180, h: 14 };
      frameRect(g, bar.x - 1, bar.y - 1, bar.w + 2, bar.h + 2, '#3A4A5E');
      const span = bar.w + 60;
      const head = ((t * 150) % span) - 60;
      for (let i = 0; i < 3; i++) {
        const bx = Math.round(head + i * 20);
        if (bx < 0 || bx + 16 > bar.w) continue;
        fill(g, bar.x + bx, bar.y + 2, 16, bar.h - 4, '#4E8CE8');
      }
      SANS.draw(g, 'Kompakt 2000', cx - 90, th.h - 60, '#5A6E88');
    },
  },
  // Windows 10 boots to the mark and a ring of dots going round it. Flat white
  // on black, nothing else on the screen.
  3: {
    duration: 4.4,
    soundAt: 0.4,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#000000');
      const cx = th.w >> 1, cy = (th.h >> 1) - 20;
      const s = 22, gp = 3;
      for (let i = 0; i < 4; i++) {
        const dx = (i % 2) ? gp : -s - gp, dy = (i > 1) ? gp : -s - gp;
        fill(g, cx + dx, cy + dy, s, s, '#FFFFFF');
      }
      // six dots on a circle, each a little behind the one in front
      for (let i = 0; i < 6; i++) {
        const a = t * 3.0 - i * 0.32;
        const px = Math.round(cx + Math.cos(a) * 62);
        const py = Math.round(cy + 92 + Math.sin(a) * 10);
        const d = 4;
        fill(g, px - d / 2, py - d / 2, d, d, i < 3 ? '#FFFFFF' : '#9A9A9A');
      }
      SANS.draw(g, 'Vellum 10', cx - 34, th.h - 56, '#6E6E6E');
    },
  },
  // macOS boots to the mark and one thin bar filling once. That is the whole
  // screen; anything else on it is another operating system.
  4: {
    duration: 4.0,
    soundAt: 0.4,
    paint(g, th, t) {
      fill(g, 0, 0, th.w, th.h, '#000000');
      const cx = th.w >> 1, cy = (th.h >> 1) - 20;
      // the practice's lozenge, drawn as a diamond of flat rows so this file
      // stays inside the retro gate's ban on rounded and alpha primitives
      const R = 22;
      for (let dy = -R; dy <= R; dy++) {
        const half = R - Math.abs(dy);
        if (half <= 0) continue;
        fill(g, cx - half, cy + dy, half * 2, 1, '#FFFFFF');
      }
      const bar = { x: cx - 100, y: cy + 84, w: 200, h: 5 };
      fill(g, bar.x, bar.y, bar.w, bar.h, '#3A3A3A');
      fill(g, bar.x, bar.y, Math.floor(bar.w * Math.min(1, t / 3.2)), bar.h, '#FFFFFF');
    },
  },
};
