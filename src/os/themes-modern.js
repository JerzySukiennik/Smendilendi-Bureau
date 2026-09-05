// themes-modern.js — the three machines that are NOT the starter box.
//
// Jurek, 2026-09-05, with reference captures:
//   Kompakt 2000    -> Windows XP        (windowsXP.jpeg)
//   Sunstation Pro  -> Windows 10        (windows10.avif)
//   Melon Studio M5 -> macOS 26, 4K      (MacOS26/*.jpg, .avif, .jpeg)
//
// WHY THIS IS ITS OWN FILE. dev.js's retro gate scans the theme SOURCE for
// rgba(), roundRect, shadowBlur and fractional globalAlpha and fails if it
// finds any, because none of them existed in 1995 and all of them are the easy
// way to fake a period screen. Every one of them is REQUIRED here: XP has
// rounded title bars, Windows 10 has a flat translucent shell, and macOS 26 is
// literally called Liquid Glass. Splitting the file is what lets the gate go on
// protecting the starter machine at full strength instead of being switched off
// the first time a modern tier needs a soft edge. themes.js stays retro-clean.
//
// The starter machine (Pentagram 133 / TRESTLE 3.1) is untouched and stays in
// themes.js: the goal names Windows 95/98 as the bar "for the fictional OS on
// the starter computer", so tier 1 is the one that has to keep passing it.

import { LUNA, AERO10, GLASS, fill, hline, vline, textY, text } from './widgets.js';
import { I16, icon32 } from './icons.js';
import { splitMnemonic } from './font.js';


/**
 * A wallpaper is painted ONCE and blitted after that.
 *
 * All three of these wallpapers are expensive: Bliss alone draws 15 cloud
 * masses of 7 ellipses each plus 26 mown bands, and the OS marks itself dirty
 * on every cursor move, so that was ~130 filled paths per mouse-move on a
 * 1920 x 1080 surface. Jurek has told us once already that we were eating his
 * whole CPU. The picture cannot change without the screen size changing, so it
 * is cached against exactly that and thrown away when the machine does.
 */
function cachedWallpaper(theme, g, paint) {
  const key = `${theme.w}x${theme.h}`;
  if (theme._wpKey !== key || !theme._wp) {
    const c = document.createElement('canvas');
    c.width = theme.w; c.height = theme.h;
    paint(c.getContext('2d'));
    theme._wp = c; theme._wpKey = key;
    // the menu-bar luminance sampling is taken from the wallpaper, so it has
    // to be recomputed when the wallpaper is
    theme._inkKey = null;
  }
  g.drawImage(theme._wp, 0, 0);
}

const CAP = { xp: 21, win10: 32, mac: 28 };

// --- small helpers the three of them share ---------------------------------

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else {
    const k = Math.min(r, w / 2, h / 2);
    g.moveTo(x + k, y);
    g.arcTo(x + w, y, x + w, y + h, k);
    g.arcTo(x + w, y + h, x, y + h, k);
    g.arcTo(x, y + h, x, y, k);
    g.arcTo(x, y, x + w, y, k);
    g.closePath();
  }
}

/** A vertical ramp through any number of stops. */
function vgrad(g, x, y, w, h, stops) {
  const grd = g.createLinearGradient(x, y, x, y + h);
  for (const [t, c] of stops) grd.addColorStop(t, c);
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  return grd;
}

function vgradRound(g, x, y, w, h, r, stops) {
  const grd = g.createLinearGradient(x, y, x, y + h);
  for (const [t, c] of stops) grd.addColorStop(t, c);
  g.save(); rr(g, x, y, w, h, r); g.clip();
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  g.restore();
}

function circle(g, cx, cy, r, colour) {
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = colour; g.fill();
}

export { rr, vgrad, circle };

// ---------------------------------------------------------------------------
// Windows XP — Luna Blue. Kompakt 2000, tier 2.
//
// What makes a screenshot read as XP rather than as "Windows 98 in blue", from
// the reference: (a) the title bar is ROUNDED at the top two corners and flat
// at the bottom, (b) it is a three-stop blue that is LIGHTER in the middle than
// at either end, (c) the close button is its own red lozenge, not a grey box
// with an X, (d) the Start button is a green pill that overhangs the taskbar's
// full height, and (e) the notification area is a separate, lighter blue inset
// with a rounded left edge. Get those five and the era is unmistakable.

export function makeXPTheme(WinTheme) {
  return class XPTheme extends WinTheme {
    constructor(cfg) {
      super({
        ...cfg,
        family: 'win',
        pal: LUNA,
        gradientTitle: true,
        metrics: {
          frame: 4, titleH: CAP.xp + 5, menuH: 20, clientInset: 2, menuItemH: 20,
          startItemH: 32, shellH: 30, buttonH: 23, scrollbar: 16,
          rowH: 18, iconPitch: 76,
        },
      });
    }

    // Three buttons, right-aligned, close last and slightly wider — XP's close
    // is a wider lozenge than the other two, which is most of why the corner
    // reads as XP at a glance.
    captionButtons(win, cap) {
      const h = 21, y = cap.y + ((this.metrics.titleH - h) >> 1);
      const right = cap.x + cap.w - 5;
      const out = [{ id: 'close', x: right - 27, y, w: 27, h }];
      if (win.resizable !== false) {
        out.push({ id: 'max', x: right - 27 - 22, y, w: 21, h });
        out.push({ id: 'min', x: right - 27 - 44, y, w: 21, h });
      }
      return out;
    }

    _capButton(g, b, pressed, id) {
      const red = b.id === 'close';
      const top = red ? '#F08A7A' : '#7FB4F2';
      const midA = red ? '#D9503A' : '#3C7FE0';
      const midB = red ? '#B8331E' : '#1E5CC0';
      vgradRound(g, b.x, b.y, b.w, b.h, 3,
        pressed ? [[0, midB], [1, midA]] : [[0, top], [0.42, midA], [1, midB]]);
      g.save(); rr(g, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, 3);
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.stroke(); g.restore();
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + (pressed ? 1 : 0);
      g.strokeStyle = '#FFFFFF'; g.fillStyle = '#FFFFFF'; g.lineWidth = 2;
      g.beginPath();
      if (id === 'close') {
        g.moveTo(cx - 4, cy - 4); g.lineTo(cx + 4, cy + 4);
        g.moveTo(cx + 4, cy - 4); g.lineTo(cx - 4, cy + 4); g.stroke();
      } else if (id === 'min') {
        g.fillRect(cx - 5, cy + 3, 10, 3);
      } else if (id === 'max') {
        g.lineWidth = 1; g.strokeRect(cx - 5.5, cy - 4.5, 11, 9);
        g.fillRect(cx - 5, cy - 4, 11, 3);
      } else if (id === 'restore') {
        g.lineWidth = 1;
        g.strokeRect(cx - 6.5, cy - 1.5, 9, 7); g.fillRect(cx - 6, cy - 1, 9, 2);
        g.strokeRect(cx - 2.5, cy - 5.5, 9, 7); g.fillRect(cx - 2, cy - 5, 9, 2);
      }
    }

    paintWindow(g, win, focused, os) {
      const pal = this.pal;
      const L = this.layout(win);
      const R = 8;                       // XP's top corner radius

      // The blue frame IS the window: a 4 px blue surround with the title bar
      // as its top, rounded only at the top, and the client sunk inside it.
      const on = focused;
      g.save();
      rr(g, win.x, win.y, win.w, win.h, [R, R, 0, 0]);
      g.clip();
      vgrad(g, win.x, win.y, win.w, win.h,
        on ? [[0, pal.titleActive2], [1, pal.titleActive]] : [[0, pal.titleInactive2], [1, pal.titleInactive]]);
      g.restore();

      const cap = L.cap;
      const capTop = win.y, capH = cap.h + 4;
      g.save();
      rr(g, win.x, capTop, win.w, capH + R, [R, R, 0, 0]);
      g.clip();
      vgrad(g, win.x, capTop, win.w, capH,
        on
          ? [[0, '#0A56C8'], [0.10, '#3F92F0'], [0.42, '#1E6FE0'], [0.88, '#0C4FB8'], [1, '#0A46A8']]
          : [[0, '#8FAEE0'], [0.42, '#A8C4EE'], [1, '#7BA2DF']]);
      // the glassy top lip
      g.fillStyle = 'rgba(255,255,255,0.30)';
      g.fillRect(win.x, capTop + 1, win.w, 3);
      g.restore();

      let tx = win.x + 8;
      if (win.icon && I16[win.icon]) { I16[win.icon].draw(g, tx, capTop + 6); tx += 21; }
      const btnLeft = L.buttons.length ? Math.min(...L.buttons.map(b => b.x)) : win.x + win.w;
      const title = this.fontBold.ellipsis(win.title, Math.max(0, btnLeft - tx - 6));
      // XP's title is white with a dark drop shadow one pixel down-right
      this.fontBold.draw(g, title, tx + 1, textY(capTop, capH) + 1,
        on ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.20)');
      this.fontBold.draw(g, title, tx, textY(capTop, capH), on ? pal.titleText : pal.titleInactiveText);

      for (const b of L.buttons) {
        const id = (b.id === 'max' && win.maximized) ? 'restore' : b.id;
        const pressed = os && os.pressed && os.pressed.kind === 'caption'
          && os.pressed.btn === b.id && os.pressed.hot;
        this._capButton(g, b, pressed, id);
      }

      // the face inside the blue frame
      const inX = win.x + 4, inY = capTop + capH, inW = win.w - 8, inH = win.y + win.h - inY - 4;
      fill(g, inX, inY, inW, inH, pal.face);
      if (L.menubar) this.paintMenuBar(g, { ...L.menubar, y: inY }, win.menu, win.menuOpen);

      const c = L.client;
      g.strokeStyle = '#9EB6D8'; g.lineWidth = 1;
      g.strokeRect(c.x - 1.5, c.y - 1.5, c.w + 3, c.h + 3);
      return c;
    }

    layout(win) {
      const L = super.layout(win);
      // the caption is inset by the frame in the base class; XP paints it edge
      // to edge, so the client has to start below the taller painted caption.
      const capH = L.cap.h + 4;
      const top = win.y + capH;
      let cy = top;
      if (L.menubar) { L.menubar = { ...L.menubar, y: cy }; cy += this.metrics.menuH; }
      L.client = {
        x: win.x + 4 + this.metrics.clientInset,
        y: cy + this.metrics.clientInset,
        w: win.w - 8 - this.metrics.clientInset * 2,
        h: win.y + win.h - cy - 4 - this.metrics.clientInset * 2,
      };
      return L;
    }

    // --- Bliss -------------------------------------------------------------
    //
    // The photograph is two thirds sky and one third hill, and the hill's crown
    // sits LEFT of centre and runs off the right edge below the horizon — not a
    // symmetrical dome in the middle. First pass put the crown at 72 % of the
    // height, which left a green sliver along the bottom and read as a golf
    // course seen from a plane. Measured off the reference: the sky/grass
    // boundary crosses the left edge at 0.60 H, peaks at 0.55 H around x = 0.30 W,
    // and falls to 0.78 H at the right edge.
    paintDesktop(g) { cachedWallpaper(this, g, (c) => this._bliss(c)); }

    _bliss(g) {
      const W = this.w, H = this.h;
      // The photograph does NOT go hazy at the horizon: it stays a saturated
      // blue right down to the grass line, and that contrast against the green
      // is half of why the image is recognisable. A pale band at 0.80 made the
      // whole middle of the screen read as fog.
      // THE SKY IS PAINTED TO THE BOTTOM OF THE SCREEN, not to the horizon.
      // Painting it to 0.66 H left a 53-row band at the right edge that neither
      // the sky nor the hill covered — the hill's crown falls to 0.73 H there —
      // and the previous frame showed through it. A closed window left a strip
      // of its own spreadsheet lying on the grass.
      vgrad(g, 0, 0, W, H,
        [[0, '#1B5CBE'], [0.28, '#3585D6'], [0.57, '#63A6E4'], [0.66, '#8CC0EC'], [1, '#8CC0EC']]);
      const rnd = mulberry(20011025);
      // cumulus: small and high, larger and flatter as they approach the
      // horizon. Never over the hill — in the photograph the sky is clean there.
      g.save();
      // Fewer, flatter, softer. Thirty-four hard lumps at full opacity read as
      // cotton wool glued to the sky; the photograph has maybe a dozen cloud
      // masses, all much wider than they are tall, and most of them thin.
      for (let i = 0; i < 15; i++) {
        const cx = rnd() * W * 1.05;
        const t = rnd();
        const cy = H * (0.05 + t * 0.44);
        const s = (14 + rnd() * 24) * (0.7 + t * 0.8);
        const a = 0.14 + rnd() * 0.30;
        for (let k = 0; k < 7; k++) {
          const ox = (rnd() - 0.5) * s * 3.0, oy = (rnd() - 0.5) * s * 0.45;
          g.fillStyle = `rgba(255,255,255,${(a * (0.5 + rnd() * 0.5)).toFixed(3)})`;
          g.beginPath();
          g.ellipse(cx + ox, cy + oy, s * (0.5 + rnd() * 0.8), s * (0.16 + rnd() * 0.22), 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();

      const crown = (t) => {
        // one long asymmetric swell: high left of centre, falling away right
        const a = Math.exp(-Math.pow((t - 0.30) / 0.46, 2));
        return H * (0.60 - 0.05 * a + 0.18 * Math.pow(Math.max(0, t - 0.18), 1.7));
      };
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      g.lineTo(0, crown(0));
      for (let x = 0; x <= W; x += 3) g.lineTo(x, crown(x / W));
      g.lineTo(W, H);
      g.closePath();
      g.clip();
      vgrad(g, 0, H * 0.52, W, H * 0.48,
        [[0, '#A6D65C'], [0.16, '#7CBB3E'], [0.52, '#4E9328'], [1, '#25571A']]);
      // the mown texture: faint darker bands following the slope
      g.globalAlpha = 0.10;
      g.strokeStyle = '#14380F'; g.lineWidth = 1;
      for (let k = 0; k < 26; k++) {
        const off = H * (0.01 + k * 0.016);
        g.beginPath();
        for (let x = 0; x <= W; x += 6) g.lineTo(x, crown(x / W) + off + Math.sin(x * 0.01 + k) * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.restore();
    }

    // --- the taskbar -------------------------------------------------------
    paintShell(g, os) {
      const pal = this.pal;
      const H = this.metrics.shellH, y = this.h - H, W = this.w;
      vgrad(g, 0, y, W, H, [[0, '#3D7BE8'], [0.10, '#2A5BD7'], [0.88, '#1E4CC0'], [1, '#1941A5']]);
      hline(g, 0, y, W, '#0A3C9E');
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y + 1, W, 2);

      // Start: a green pill running the taskbar's full height, notched right
      const sb = this.startRect();
      const down = os.startOpen;
      g.save();
      rr(g, sb.x - 10, sb.y, sb.w + 10, sb.h, [0, 12, 12, 0]);
      g.clip();
      vgrad(g, sb.x - 10, sb.y, sb.w + 10, sb.h,
        down ? [[0, '#2C7A28'], [1, '#3C9B37']] : [[0, '#5FBE52'], [0.36, '#3C9B37'], [1, '#2C7A28']]);
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(sb.x - 10, sb.y + 1, sb.w + 10, 3);
      g.restore();
      const d = down ? 1 : 0;
      I16.square.draw(g, sb.x + 5 + d, sb.y + 6 + d);
      this.fontBold.draw(g, this.startLabel, sb.x + 26 + d, textY(sb.y, sb.h) + d + 1, 'rgba(0,0,0,0.42)');
      this.fontBold.draw(g, this.startLabel, sb.x + 25 + d, textY(sb.y, sb.h) + d, '#FFFFFF');

      // task buttons: rounded, a lighter blue, pressed ones sunk and darker
      let x = sb.x + sb.w + 10;
      const tray = this.trayRect(os);
      const list = os.wm.taskList();
      if (list.length) {
        const avail = tray.x - 8 - x;
        const bw = Math.max(70, Math.min(160, Math.floor(avail / list.length) - 4));
        list.forEach((win, i) => {
          const bx = x + i * (bw + 4), by = y + 4, bh = H - 8;
          if (bx + bw > tray.x - 8) return;
          const active = os.wm.focused === win && !win.minimized;
          vgradRound(g, bx, by, bw, bh, 3,
            active ? [[0, '#1B49B4'], [1, '#2C63D8']] : [[0, '#4E8AEC'], [1, '#2E63D4']]);
          g.save(); rr(g, bx + 0.5, by + 0.5, bw - 1, bh - 1, 3);
          g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.stroke(); g.restore();
          if (win.icon && I16[win.icon]) I16[win.icon].draw(g, bx + 5, by + ((bh - 16) >> 1));
          const t = this.font.ellipsis(win.title, bw - 28);
          this.font.draw(g, t, bx + 25, textY(by, bh), '#FFFFFF');
          win._taskRect = { x: bx, y: by, w: bw, h: bh };
        });
      }

      // notification area: its own lighter blue, rounded on the left only
      g.save();
      rr(g, tray.x, y, this.w - tray.x, H, [10, 0, 0, 10]);
      g.clip();
      vgrad(g, tray.x, y, this.w - tray.x, H, [[0, '#2FA8E0'], [0.5, '#159AD6'], [1, '#0C7CBB']]);
      g.fillStyle = 'rgba(255,255,255,0.30)'; g.fillRect(tray.x, y + 1, this.w - tray.x, 2);
      g.restore();
      I16.phone.draw(g, tray.x + 10, y + ((H - 16) >> 1));
      const clock = os.clockText();
      this.font.draw(g, clock, this.w - 10 - this.font.measure(clock), textY(y, H), '#FFFFFF');
    }

    startRect() { return { x: 10, y: this.h - this.metrics.shellH, w: 74, h: this.metrics.shellH }; }

    trayRect(os) {
      const clock = os.clockText();
      const w = this.font.measure(clock) + 46;
      return { x: this.w - w, y: this.h - this.metrics.shellH, w, h: this.metrics.shellH };
    }

    /** XP's Start panel: a blue header, a white body, a blue footer. */
    paintStartMenu(g, os, hot) {
      const pal = this.pal;
      const r = os.startMenuRect;
      const R = 8;
      g.save();
      rr(g, r.x, r.y, r.w, r.h, [R, R, 0, 0]);
      g.clip();
      fill(g, r.x, r.y, r.w, r.h, '#FFFFFF');
      vgrad(g, r.x, r.y, r.w, 42, [[0, '#2A6FDC'], [1, '#0A46A8']]);
      fill(g, r.x, r.y + r.h - 26, r.w, 26, '#2A6FDC');
      g.restore();
      g.save(); rr(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, [R, R, 0, 0]);
      g.strokeStyle = '#0A46A8'; g.lineWidth = 1; g.stroke(); g.restore();

      this.fontBold.draw(g, `${this.osName} ${this.osVersion}`, r.x + 14, textY(r.y, 42), '#FFFFFF');

      let y = r.y + 46;
      const x = r.x + 4;
      for (const it of r.items) {
        if (it.sep) { hline(g, x + 8, y + 3, r.w - 24, '#C8D4E8'); y += 7; continue; }
        const on = hot === it;
        if (on) {
          g.save(); rr(g, x, y, r.w - 8, r.itemH, 3);
          g.fillStyle = '#316AC5'; g.fill(); g.restore();
        }
        if (it.icon && !icon32(g, it.icon, x + 4, y, this.screenTint)) {
          g.strokeStyle = '#9EB6D8'; g.strokeRect(x + 5.5, y + 1.5, 29, 29);
        }
        this.fontBold.drawMnemonic(g, it.label, x + 40, textY(y, r.itemH), on ? '#FFFFFF' : '#0A2B60');
        it._rect = { x, y, w: r.w - 8, h: r.itemH };
        y += r.itemH;
      }
    }

    startMenu(os) {
      const m = super.startMenu(os);
      return { ...m, y: this.h - this.metrics.shellH - (m.h + 68), h: m.h + 68, banner: 0 };
    }
  };
}

/** The one PRNG the clouds use, so Bliss is the same sky on every boot. */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Windows 10. Sunstation Pro, tier 3.
//
// From the reference: the shell is near-black and full width, the Start panel
// is a dark column of small items with a field of FLAT COLOUR TILES beside it,
// window chrome is white with a hairline border and black text, and the accent
// blue appears only on the tiles, the selection and the focused border. There
// is no bevel anywhere on the screen — that absence is the whole look, and it
// is why this cannot just be XP with the gradients turned off.

export function makeWin10Theme(BaseTheme) {
  return class Win10Theme extends BaseTheme {
    constructor(cfg) {
      super({
        ...cfg,
        family: 'win',
        pal: AERO10,
        globalMenuBar: false,
        gradientTitle: false,
        metrics: {
          frame: 1, titleH: CAP.win10, menuH: 22, clientInset: 0, menuItemH: 24,
          startItemH: 34, shellH: 40, buttonH: 24, scrollbar: 16,
          rowH: 20, iconPitch: 80,
        },
      });
    }

    captionButtons(win, cap) {
      const h = CAP.win10, w = 45, y = cap.y;
      const right = cap.x + cap.w;
      const out = [{ id: 'close', x: right - w, y, w, h }];
      if (win.resizable !== false) {
        out.push({ id: 'max', x: right - w * 2, y, w, h });
        out.push({ id: 'min', x: right - w * 3, y, w, h });
      }
      return out;
    }

    paintWindow(g, win, focused, os) {
      const pal = this.pal;
      const L = this.layout(win);
      fill(g, win.x, win.y, win.w, win.h, pal.face);
      // one hairline border, accent when focused. Windows 10 has no frame.
      g.strokeStyle = focused ? pal.border : pal.borderInactive;
      g.lineWidth = 1;
      g.strokeRect(win.x + 0.5, win.y + 0.5, win.w - 1, win.h - 1);

      const cap = L.cap;
      fill(g, cap.x, cap.y, cap.w, cap.h, '#FFFFFF');
      let tx = cap.x + 10;
      if (win.icon && I16[win.icon]) { I16[win.icon].draw(g, tx, cap.y + ((cap.h - 16) >> 1)); tx += 24; }
      const btnLeft = L.buttons.length ? Math.min(...L.buttons.map(b => b.x)) : cap.x + cap.w;
      const title = this.font.ellipsis(win.title, Math.max(0, btnLeft - tx - 8));
      this.font.draw(g, title, tx, textY(cap.y, cap.h), focused ? pal.titleText : pal.titleInactiveText);

      for (const b of L.buttons) {
        const id = (b.id === 'max' && win.maximized) ? 'restore' : b.id;
        const pressed = os && os.pressed && os.pressed.kind === 'caption'
          && os.pressed.btn === b.id && os.pressed.hot;
        // the close button is the only one that goes red, and only under the
        // pointer — a permanently red X is the tell of a fake Windows 10.
        if (pressed) fill(g, b.x, b.y, b.w, b.h, id === 'close' ? '#E81123' : '#E5E5E5');
        const ink = (pressed && id === 'close') ? '#FFFFFF' : '#1A1A1A';
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.strokeStyle = ink; g.lineWidth = 1; g.beginPath();
        if (id === 'close') {
          g.moveTo(cx - 5, cy - 5); g.lineTo(cx + 5, cy + 5);
          g.moveTo(cx + 5, cy - 5); g.lineTo(cx - 5, cy + 5); g.stroke();
        } else if (id === 'min') {
          g.moveTo(cx - 5, cy + 0.5); g.lineTo(cx + 5, cy + 0.5); g.stroke();
        } else if (id === 'max') {
          g.strokeRect(cx - 5.5, cy - 5.5, 11, 11);
        } else {
          g.strokeRect(cx - 6.5, cy - 3.5, 9, 9);
          g.beginPath(); g.moveTo(cx - 3.5, cy - 3.5); g.lineTo(cx - 3.5, cy - 6.5);
          g.lineTo(cx + 5.5, cy - 6.5); g.lineTo(cx + 5.5, cy + 2.5); g.lineTo(cx + 2.5, cy + 2.5);
          g.stroke();
        }
      }

      if (L.menubar) this.paintMenuBar(g, L.menubar, win.menu, win.menuOpen);
      const c = L.client;
      fill(g, c.x, c.y, c.w, c.h, pal.window);
      return c;
    }

    paintMenuBar(g, r, menu, openIdx) {
      const pal = this.pal;
      fill(g, r.x, r.y, r.w, r.h, '#FFFFFF');
      hline(g, r.x, r.y + r.h - 1, r.w, '#E6E6E6');
      let x = r.x + 4;
      for (let i = 0; i < menu.length; i++) {
        const m = menu[i];
        const w = this.font.measure(splitMnemonic(m.label).text) + 16;
        const open = i === openIdx;
        if (open) fill(g, x, r.y, w, r.h - 1, pal.hilite);
        this.font.drawMnemonic(g, m.label, x + 8, textY(r.y, r.h), pal.text);
        m._rect = { x, y: r.y, w, h: r.h };
        x += w;
      }
    }

    paintMenu(g, r, items, hot) {
      const pal = this.pal;
      fill(g, r.x, r.y, r.w, r.h, '#FFFFFF');
      g.strokeStyle = '#D6D6D6'; g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      let y = r.y + 2;
      for (const it of items) {
        if (it.sep) { hline(g, r.x + 8, y + 3, r.w - 16, '#E6E6E6'); y += 7; continue; }
        const ih = this.metrics.menuItemH;
        const on = hot === it && !it.disabled;
        if (on) fill(g, r.x + 1, y, r.w - 2, ih, pal.hilite);
        const tc = it.disabled ? pal.gray : pal.text;
        if (it.checked) {
          g.strokeStyle = tc; g.lineWidth = 1.6; g.beginPath();
          g.moveTo(r.x + 8, y + ih / 2); g.lineTo(r.x + 11, y + ih / 2 + 4); g.lineTo(r.x + 16, y + ih / 2 - 5);
          g.stroke();
        } else if (it.icon && I16[it.icon]) I16[it.icon].draw(g, r.x + 6, y + ((ih - 16) >> 1));
        this.font.drawMnemonic(g, it.label, r.x + 26, textY(y, ih), tc, { disabled: !!it.disabled });
        if (it.accel) {
          const acc = this.accelText(it.accel), aw = this.font.measure(acc);
          this.font.draw(g, acc, r.x + r.w - 12 - aw, textY(y, ih), pal.gray);
        }
        it._rect = { x: r.x + 1, y, w: r.w - 2, h: ih };
        y += ih;
      }
    }

    paintDesktop(g) { cachedWallpaper(this, g, (c) => this._hero(c)); }

    _hero(g) {
      const W = this.w, H = this.h;
      // the hero wallpaper: a dark blue field with the light coming from behind
      // the logo, which is four panes in perspective rather than four squares.
      const grd = g.createRadialGradient(W * 0.56, H * 0.44, 10, W * 0.56, H * 0.44, W * 0.75);
      grd.addColorStop(0, '#1E6FBF'); grd.addColorStop(0.55, '#0E3F7A'); grd.addColorStop(1, '#061B36');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      const cx = W * 0.56, cy = H * 0.44, s = Math.min(W, H) * 0.26;
      g.save();
      g.translate(cx, cy);
      g.transform(1, 0, -0.22, 1, 0, 0);      // the logo leans back to the left
      const gap = s * 0.07;
      for (let i = 0; i < 4; i++) {
        const px = (i % 2) ? gap : -s / 2 - gap + s * 0.0;
        const py = (i > 1) ? gap : -s / 2 - gap;
        const pw = s / 2, ph = s / 2;
        const gg = g.createLinearGradient(px, py, px + pw, py + ph);
        gg.addColorStop(0, 'rgba(190,225,255,0.95)'); gg.addColorStop(1, 'rgba(120,185,240,0.75)');
        g.fillStyle = gg;
        g.fillRect(px, py, pw, ph);
      }
      g.restore();
    }

    paintShell(g, os) {
      const pal = this.pal;
      const H = this.metrics.shellH, y = this.h - H, W = this.w;
      g.fillStyle = 'rgba(24,24,24,0.94)'; g.fillRect(0, y, W, H);
      hline(g, 0, y, W, 'rgba(255,255,255,0.10)');

      // Start: the four-pane mark, no word
      const sb = this.startRect();
      if (os.startOpen) { g.fillStyle = pal.accent; g.fillRect(sb.x, sb.y, sb.w, sb.h); }
      const mx = sb.x + sb.w / 2, my = sb.y + sb.h / 2, q = 5, gp = 1.5;
      g.fillStyle = '#FFFFFF';
      g.fillRect(mx - q - gp, my - q - gp, q, q); g.fillRect(mx + gp, my - q - gp, q, q);
      g.fillRect(mx - q - gp, my + gp, q, q); g.fillRect(mx + gp, my + gp, q, q);

      // the search field — the single most recognisable thing on a Win10 bar
      const fx = sb.x + sb.w + 2, fw = Math.min(220, Math.max(120, W * 0.20));
      fill(g, fx, y + 5, fw, H - 10, '#2E2E2E');
      g.strokeStyle = '#4A4A4A'; g.lineWidth = 1; g.strokeRect(fx + 0.5, y + 5.5, fw - 1, H - 11);
      g.strokeStyle = '#C8C8C8'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(fx + 16, y + H / 2 - 1, 4.5, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(fx + 19, y + H / 2 + 2); g.lineTo(fx + 23, y + H / 2 + 6); g.stroke();
      this.font.draw(g, 'Ask me anything', fx + 30, textY(y + 5, H - 10), '#9C9C9C');

      // task buttons: an icon with a 3 px accent underline when active
      let x = fx + fw + 6;
      const tray = this.trayRect(os);
      for (const win of os.wm.taskList()) {
        const bw = 44;
        if (x + bw > tray.x - 6) break;
        const active = os.wm.focused === win && !win.minimized;
        if (active) {
          g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, y + 1, bw, H - 1);
          fill(g, x + 4, y + H - 3, bw - 8, 3, pal.accentLite);
        }
        if (win.icon && I16[win.icon]) I16[win.icon].draw(g, x + ((bw - 16) >> 1), y + ((H - 16) >> 1));
        win._taskRect = { x, y, w: bw, h: H };
        x += bw;
      }

      const clock = os.clockText();
      this.font.draw(g, clock, this.w - 12 - this.font.measure(clock), y + 6, '#FFFFFF');
      this.font.draw(g, os.dateText ? os.dateText() : '', this.w - 12 - this.font.measure(clock), y + 20, '#FFFFFF');
    }

    startRect() { return { x: 0, y: this.h - this.metrics.shellH, w: 48, h: this.metrics.shellH }; }

    trayRect(os) {
      const clock = os.clockText();
      const w = this.font.measure(clock) + 30;
      return { x: this.w - w, y: this.h - this.metrics.shellH, w, h: this.metrics.shellH };
    }

    startMenu(os) {
      const items = os.startItems();
      const ih = this.metrics.startItemH;
      const listW = 260;
      const bodyH = items.reduce((s, it) => s + (it.sep ? 7 : ih), 0);
      const h = Math.max(bodyH + 16, 360);
      const w = listW + 300;
      return { x: 0, y: this.h - this.metrics.shellH - h, w, h, banner: 0, itemH: ih, items, listW };
    }

    /** The dark column plus the tile field. The tiles are what say "10". */
    paintStartMenu(g, os, hot) {
      const pal = this.pal;
      const r = os.startMenuRect;
      g.fillStyle = 'rgba(36,36,36,0.97)'; g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

      let y = r.y + 8;
      const x = r.x;
      for (const it of r.items) {
        if (it.sep) { hline(g, x + 12, y + 3, r.listW - 24, 'rgba(255,255,255,0.12)'); y += 7; continue; }
        const on = hot === it;
        if (on) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x, y, r.listW, r.itemH); }
        if (it.icon && I16[it.icon]) I16[it.icon].draw(g, x + 12, y + ((r.itemH - 16) >> 1));
        this.font.drawMnemonic(g, it.label, x + 40, textY(y, r.itemH), '#FFFFFF');
        it._rect = { x, y, w: r.listW, h: r.itemH };
        y += r.itemH;
      }

      // the tiles: flat squares of one colour each, two sizes, no gloss
      const TILE = [
        [pal.tile, 'Draw'], ['#1E9E77', 'Mail'], ['#B8471F', 'Cost'],
        ['#7A3FA8', 'Files'], ['#0E7C86', 'Chat'], ['#C08A16', 'Notes'],
      ];
      const tx0 = r.x + r.listW + 16, ty0 = r.y + 44, t = 68, gapT = 6;
      this.font.draw(g, 'Design', tx0, ty0 - 18, '#FFFFFF');
      TILE.forEach(([c, label], i) => {
        const big = i === 0;
        const col = big ? 0 : ((i + 1) % 3);
        const row = big ? 0 : Math.floor((i + 1) / 3);
        const bx = tx0 + col * (t + gapT), by = ty0 + row * (t + gapT);
        const bw = big ? t * 2 + gapT : t;
        fill(g, bx, by, bw, t, c);
        this.font.draw(g, label, bx + 8, by + t - 18, '#FFFFFF');
      });
    }
  };
}

// ---------------------------------------------------------------------------
// macOS 26 — Liquid Glass. Melon Studio M5, tier 4.
//
// From the references: nothing on this screen is opaque and nothing is square.
// The menu bar has NO band of its own — the wallpaper runs straight under it
// and the text sits on the pixels. Windows are heavily rounded, their chrome is
// a pale wash rather than a bar, and the three traffic lights sit at the left
// with no glyphs until you are over them. The dock FLOATS: a rounded glass slab
// with a gap beneath it, not a strip welded to the bottom edge. The control
// centre is a stack of rounded glass tiles.
//
// This keeps family 'platinum' on purpose: os.js and wm.js already read that
// flag to mean "global menu bar at the top, no Start button, Command in the
// accelerators", which is exactly what this machine wants. It is a layout
// contract, not a claim about the year.

export function makeMacOSTheme(BaseTheme) {
  return class MacOS26Theme extends BaseTheme {
    constructor(cfg) {
      super({
        ...cfg,
        family: 'platinum',
        pal: GLASS,
        globalMenuBar: true,
        metrics: {
          frame: 0, titleH: CAP.mac, menuH: 0, clientInset: 0, menuItemH: 24,
          menuBarH: 28, startItemH: 32, shellH: 0, dockH: 62, buttonH: 26,
          scrollbar: 14, rowH: 20, iconPitch: 84,
        },
      });
    }

    accelText(accel) {
      return String(accel).replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥')
        .replace(/Shift\+/g, '⇧');
    }

    captionButtons(win, cap) {
      const d = 12, y = cap.y + ((cap.h - d) >> 1), x = cap.x + 14;
      const out = [{ id: 'close', x, y, w: d, h: d }];
      if (win.resizable !== false) {
        out.push({ id: 'min', x: x + 20, y, w: d, h: d });
        out.push({ id: 'max', x: x + 40, y, w: d, h: d });
      }
      return out;
    }

    layout(win) {
      const m = this.metrics;
      const cap = { x: win.x, y: win.y, w: win.w, h: m.titleH };
      const buttons = this.captionButtons(win, cap);
      const client = { x: win.x, y: win.y + m.titleH, w: win.w, h: win.h - m.titleH };
      return { cap, buttons, menubar: null, client };
    }

    frameFor(win, cw, ch) { return { w: cw, h: ch + this.metrics.titleH }; }

    paintWindow(g, win, focused, os) {
      const pal = this.pal;
      const L = this.layout(win);
      const R = 12;

      g.save();
      g.shadowColor = 'rgba(8,16,32,0.34)';
      g.shadowBlur = focused ? 26 : 12;
      g.shadowOffsetY = focused ? 10 : 4;
      rr(g, win.x, win.y, win.w, win.h, R);
      g.fillStyle = '#FFFFFF';
      g.fill();
      g.restore();

      // chrome: a pale wash across the top, no rule under it
      g.save();
      rr(g, win.x, win.y, win.w, win.h, R); g.clip();
      vgrad(g, win.x, win.y, win.w, L.cap.h + 8,
        focused ? [[0, 'rgba(246,248,252,0.98)'], [1, 'rgba(238,241,247,0.94)']]
                : [[0, 'rgba(248,249,251,0.98)'], [1, 'rgba(244,246,249,0.96)']]);
      g.restore();

      // traffic lights: colour only while the window has focus, glyphs only
      // while the pointer is in the window — as the real thing behaves.
      const over = os && os.wm && os.wm.hover === win;
      const lights = { close: ['#FF5F57', '#E0443E'], min: ['#FEBC2E', '#DEA123'], max: ['#28C840', '#1DAD2B'] };
      for (const b of L.buttons) {
        const [c, edge] = lights[b.id] || lights.close;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        circle(g, cx, cy, b.w / 2, focused ? c : '#D6D8DC');
        g.strokeStyle = focused ? edge : '#C4C7CC'; g.lineWidth = 0.6;
        g.beginPath(); g.arc(cx, cy, b.w / 2 - 0.3, 0, Math.PI * 2); g.stroke();
        if (over && focused) {
          g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.2; g.beginPath();
          if (b.id === 'close') { g.moveTo(cx - 2.6, cy - 2.6); g.lineTo(cx + 2.6, cy + 2.6); g.moveTo(cx + 2.6, cy - 2.6); g.lineTo(cx - 2.6, cy + 2.6); }
          else if (b.id === 'min') { g.moveTo(cx - 3, cy); g.lineTo(cx + 3, cy); }
          else { g.moveTo(cx - 2.6, cy + 2.6); g.lineTo(cx + 2.6, cy - 2.6); }
          g.stroke();
        }
      }

      const title = this.fontBold.ellipsis(win.title, win.w - 140);
      this.fontBold.draw(g, title, win.x + (win.w - this.fontBold.measure(title)) / 2,
        textY(L.cap.y, L.cap.h), focused ? pal.titleText : pal.titleInactiveText);

      const c = L.client;
      g.save(); rr(g, win.x, win.y, win.w, win.h, R); g.clip();
      fill(g, c.x, c.y, c.w, c.h, pal.window);
      g.restore();
      return c;
    }

    // --- wallpaper: the blue sweep over sand --------------------------------
    paintDesktop(g) { cachedWallpaper(this, g, (c) => this._sweep(c)); }

    _sweep(g) {
      const W = this.w, H = this.h, pal = this.pal;
      vgrad(g, 0, 0, W, H, [[0, pal.skyA], [0.30, '#BFD9EA'], [0.62, pal.skyB], [1, pal.skyC]]);
      // the sweep: three nested arcs of light, the signature of the 26 wallpaper
      const bands = [
        [0.86, 'rgba(255,255,255,0.55)', H * 0.10],
        [0.72, 'rgba(120,190,235,0.75)', H * 0.16],
        [0.54, 'rgba(20,90,190,0.80)', H * 0.24],
        [0.36, 'rgba(8,50,140,0.70)', H * 0.30],
      ];
      for (const [t, c, thick] of bands) {
        g.save();
        g.strokeStyle = c; g.lineWidth = thick; g.lineCap = 'round';
        g.beginPath();
        g.ellipse(W * 0.16, H * (0.30 + (1 - t) * 0.5), W * 0.92, H * (0.42 + (1 - t) * 0.30),
          -0.22, Math.PI * 0.02, Math.PI * 0.60);
        g.stroke();
        g.restore();
      }
      // the warm sand the sweep comes out of, top-left
      const sg = g.createRadialGradient(W * 0.06, H * 0.10, 4, W * 0.06, H * 0.10, W * 0.42);
      sg.addColorStop(0, 'rgba(238,224,196,0.85)'); sg.addColorStop(1, 'rgba(238,224,196,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
    }

    // --- the menu bar has no band ------------------------------------------
    //
    // The contract is Platinum's, not mine to invent: os.globalMenu() returns
    // the practice mark, the focused window's own menus, and ONE entry flagged
    // appMenu that belongs at the right end. wm.menuBarHit() reads back the
    // _rect this paint writes onto each entry, so an entry painted without one
    // is an entry that cannot be clicked — which is exactly how the Apple menu
    // was dead for a round on the tier this replaces.
    /**
     * THE BAR HAS NO BAND, SO THE INK HAS TO FOLLOW THE WALLPAPER.
     *
     * First pass painted every entry white, which is right over the blue half
     * of the sweep and INVISIBLE over the sand at the top left — measured, the
     * strip behind "File View Help" is a flat (238, 231, 214) with not one dark
     * pixel in it, so the menus were simply not there. macOS solves this by
     * reading the desktop behind the bar, and so does this: the strip is
     * sampled once per screen size into 48 luminance buckets, and each entry
     * takes dark or light ink from the bucket it sits over. Sampled once, not
     * per frame, and thrown away when the machine changes.
     */
    _barInk(g, x, w) {
      const H = this.metrics.menuBarH;
      const key = `${this.w}x${this.h}`;
      if (this._inkKey !== key) {
        const N = 48;
        const img = g.getImageData(0, 0, this.w, H).data;
        const buckets = new Array(N).fill(0);
        const counts = new Array(N).fill(0);
        for (let py = 0; py < H; py += 3) {
          for (let px = 0; px < this.w; px += 3) {
            const o = (py * this.w + px) * 4;
            const b = Math.min(N - 1, Math.floor(px / this.w * N));
            buckets[b] += 0.299 * img[o] + 0.587 * img[o + 1] + 0.114 * img[o + 2];
            counts[b]++;
          }
        }
        this._ink = buckets.map((v, i) => (counts[i] ? v / counts[i] : 128));
        this._inkKey = key;
      }
      const N = this._ink.length;
      const a = Math.max(0, Math.min(N - 1, Math.floor(x / this.w * N)));
      const b = Math.max(0, Math.min(N - 1, Math.floor((x + w) / this.w * N)));
      let lum = 0;
      for (let i = a; i <= b; i++) lum += this._ink[i];
      lum /= (b - a + 1);
      return lum > 150 ? '#11141A' : '#FFFFFF';
    }

    paintMenuBarGlobal(g, os) {
      const H = this.metrics.menuBarH;
      // no band and no rule: macOS 26 lets the desktop run straight through the
      // bar. The only concession is a whisper of glass to lift the contrast.
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, 0, this.w, H);
      const menu = os.globalMenu();

      // right end first, so the left run knows where it has to stop
      let rightEdge = this.w;
      const clock = os.clockText();
      const cw = this.font.measure(clock);
      const clockInk = this._barInk(g, this.w - 14 - cw, cw);
      this.font.draw(g, clock, this.w - 14 - cw, textY(0, H), clockInk);
      rightEdge = this.w - 14 - cw;

      // control centre: two sliders on a glass pill, straight off the reference
      const ccW = 30, ccX = rightEdge - ccW - 10;
      g.save(); rr(g, ccX, 4, ccW, H - 8, 8);
      g.fillStyle = 'rgba(255,255,255,0.30)'; g.fill(); g.restore();
      g.strokeStyle = clockInk; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(ccX + 6, H / 2 - 3.5); g.lineTo(ccX + 24, H / 2 - 3.5);
      g.moveTo(ccX + 6, H / 2 + 3.5); g.lineTo(ccX + 24, H / 2 + 3.5); g.stroke();
      circle(g, ccX + 19, H / 2 - 3.5, 2.4, clockInk);
      circle(g, ccX + 11, H / 2 + 3.5, 2.4, clockInk);
      rightEdge = ccX - 8;

      for (let i = 0; i < menu.length; i++) {
        const m = menu[i];
        if (!m.appMenu) continue;
        const label = this.fontBold.ellipsis(splitMnemonic(m.label).text, 160);
        const w = this.fontBold.measure(label) + 24;
        const x = rightEdge - w;
        const open = os.menuOwner === 'global' && os.menuIndex === i;
        if (open) {
          g.save(); rr(g, x, 3, w, H - 6, 7);
          g.fillStyle = 'rgba(255,255,255,0.40)'; g.fill(); g.restore();
        }
        this.fontBold.draw(g, label, x + 12, textY(0, H), open ? '#11141A' : this._barInk(g, x, w));
        m._rect = { x, y: 0, w, h: H };
        rightEdge = x - 4;
      }

      let x = 10;
      for (let i = 0; i < menu.length; i++) {
        const m = menu[i];
        if (m.appMenu) continue;
        const isMark = i === 0;
        const label = splitMnemonic(m.label).text;
        const w = isMark ? 24 : this.font.measure(label) + 20;
        if (x + w > rightEdge - 8) { m._rect = { x: -99, y: -99, w: 0, h: 0 }; continue; }
        const open = os.menuOwner === 'global' && os.menuIndex === i;
        if (open) {
          g.save(); rr(g, x, 3, w, H - 6, 7);
          g.fillStyle = 'rgba(255,255,255,0.40)'; g.fill(); g.restore();
        }
        const ink = open ? '#11141A' : this._barInk(g, x, w);
        // The practice's mark, drawn rather than typed: the bitmap faces have
        // no lozenge glyph and fell back to a pair of bars that read as a
        // pause button sitting where the Apple menu goes.
        if (isMark) {
          const cx = x + w / 2, cy = H / 2;
          g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
          rr(g, -4.5, -4.5, 9, 9, 2.2); g.fillStyle = ink; g.fill(); g.restore();
        } else this.font.drawMnemonic(g, m.label, x + 10, textY(0, H), ink);
        m._rect = { x, y: 0, w, h: H };
        x += w;
      }
    }

    /** Menus are glass cards with rounded corners and a soft shadow. */
    paintMenu(g, r, items, hot) {
      const pal = this.pal;
      g.save();
      g.shadowColor = 'rgba(8,16,32,0.30)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
      rr(g, r.x, r.y, r.w, r.h, 10);
      g.fillStyle = 'rgba(250,251,253,0.96)'; g.fill();
      g.restore();
      g.save(); rr(g, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
      g.strokeStyle = 'rgba(255,255,255,0.80)'; g.lineWidth = 1; g.stroke(); g.restore();

      let y = r.y + 5;
      for (const it of items) {
        if (it.sep) { hline(g, r.x + 10, y + 3, r.w - 20, 'rgba(0,0,0,0.10)'); y += 7; continue; }
        const ih = this.metrics.menuItemH;
        const on = hot === it && !it.disabled;
        if (on) {
          g.save(); rr(g, r.x + 5, y, r.w - 10, ih, 6);
          g.fillStyle = pal.hilite; g.fill(); g.restore();
        }
        const tc = it.disabled ? pal.gray : (on ? pal.hiliteText : pal.text);
        if (it.checked) {
          g.strokeStyle = tc; g.lineWidth = 1.6; g.beginPath();
          g.moveTo(r.x + 12, y + ih / 2); g.lineTo(r.x + 15, y + ih / 2 + 4); g.lineTo(r.x + 20, y + ih / 2 - 5);
          g.stroke();
        }
        this.font.drawMnemonic(g, it.label, r.x + 28, textY(y, ih), tc, { disabled: !!it.disabled });
        if (it.accel) {
          const acc = this.accelText(it.accel), aw = this.font.measure(acc);
          this.font.draw(g, acc, r.x + r.w - 14 - aw, textY(y, ih), on ? tc : pal.gray);
        }
        it._rect = { x: r.x + 5, y, w: r.w - 10, h: ih };
        y += ih;
      }
    }

    // --- the shell is the bar AND the dock ----------------------------------
    //
    // Both, and in this order. The first version drew only the dock, so
    // paintMenuBarGlobal never ran, no menu entry ever got the _rect that
    // wm.menuBarHit() reads back, and every menu on the best machine in the
    // game was unclickable. Measured: all five global entries reported
    // _rect MISSING. That is the same failure the tier this replaces shipped
    // once already, which is why it is called out here.
    paintShell(g, os) {
      this.paintMenuBarGlobal(g, os);
      this.paintDock(g, os);
    }

    paintDock(g, os) {
      const list = os.wm.taskList();
      const D = this.metrics.dockH, pad = 10, cell = 46;
      const n = Math.max(4, list.length + 3);
      const w = n * cell + pad * 2;
      const x = (this.w - w) / 2, y = this.h - D - 10;

      g.save();
      g.shadowColor = 'rgba(8,20,44,0.32)'; g.shadowBlur = 22; g.shadowOffsetY = 8;
      rr(g, x, y, w, D, 20);
      g.fillStyle = 'rgba(255,255,255,0.34)'; g.fill();
      g.restore();
      g.save(); rr(g, x + 0.5, y + 0.5, w - 1, D - 1, 20);
      g.strokeStyle = 'rgba(255,255,255,0.70)'; g.lineWidth = 1; g.stroke(); g.restore();
      // the top-inside highlight that makes glass read as glass
      g.save(); rr(g, x + 2, y + 2, w - 4, D * 0.5, [18, 18, 0, 0]); g.clip();
      vgrad(g, x, y, w, D * 0.5, [[0, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
      g.restore();

      const TINT = ['#0A84FF', '#30C46A', '#FF9F0A', '#AF52DE', '#FF375F', '#5AC8FA'];
      let cx = x + pad;
      list.forEach((win, i) => {
        const bx = cx, by = y + (D - 38) / 2;
        g.save(); rr(g, bx, by, 38, 38, 10);
        g.fillStyle = TINT[i % TINT.length]; g.fill(); g.restore();
        if (win.icon && I16[win.icon]) I16[win.icon].draw(g, bx + 11, by + 11);
        const active = os.wm.focused === win && !win.minimized;
        if (active) circle(g, bx + 19, y + D - 5, 2, 'rgba(20,30,50,0.75)');
        win._taskRect = { x: bx, y: by, w: 38, h: 38 };
        cx += cell;
      });
      // the three that are always there, so the dock is never nearly empty
      for (let i = 0; i < 3; i++) {
        const bx = cx, by = y + (D - 38) / 2;
        g.save(); rr(g, bx, by, 38, 38, 10);
        g.fillStyle = TINT[(list.length + i) % TINT.length]; g.fill(); g.restore();
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fillRect(bx + 12, by + 12, 14, 14);
        cx += cell;
      }
    }

    startRect() { return { x: 0, y: 0, w: 0, h: 0 }; }
    trayRect() { return { x: this.w, y: 0, w: 0, h: 0 }; }
    startMenu(os) { return { x: 0, y: 0, w: 0, h: 0, items: [], itemH: 0, banner: 0 }; }
    paintStartMenu() {}
  };
}
