// wm.js — the window manager.
//
// Draggable titled windows, z-order on click, focus/blur states that really
// differ, minimise/maximise/close where the era allows it, modal dialogs, an
// in-window menu bar on the Windows tiers and a global one on the Platinum
// tiers, plus a taskbar/window strip painted by the theme.
//
// Nothing here eases, fades or slides (checklist 19). A window is either at the
// old position or the new one; a menu is either closed or fully drawn. On the
// tier-1 machine the drag does not even move the window — it drags a 1-pixel
// checkerboard outline and jumps at the drop, which is exactly what a 133 MHz
// box with "show window contents while dragging" turned off did.

import { inside, dragOutline, fill, frameRect, hline, vline, checker, button as BUTTON } from './widgets.js';
import { SANS } from './font.js';
import { I16 } from './icons.js';

let SEQ = 1;

export class Win {
  constructor(spec) {
    this.id = spec.id ?? `win${SEQ++}`;
    this.appId = spec.appId ?? this.id;
    this.title = spec.title ?? 'Untitled';
    this.icon = spec.icon ?? null;
    this.x = spec.x | 0;
    this.y = spec.y | 0;
    this.w = spec.w | 0;
    this.h = spec.h | 0;
    this.minW = spec.minW ?? 180;
    this.minH = spec.minH ?? 100;
    this.resizable = spec.resizable !== false;
    this.modal = !!spec.modal;
    this.menu = spec.menu ?? null;
    this.menuOpen = -1;
    this.minimized = false;
    this.maximized = false;
    this.shaded = false;                 // Platinum windowshade
    this.app = spec.app ?? null;
    this.restore = null;
    this.foreign = spec.foreign ?? null; // a DOM/3D app mounted over the canvas
    this.fullscreen = !!spec.fullscreen;
    this.onClose = spec.onClose ?? null;
  }
}

export class WindowManager {
  constructor(os) {
    this.os = os;
    this.windows = [];
    this.focused = null;
    this.drag = null;
    this.ghost = null;
    this.menu = null;        // { owner:'win'|'global', win, index, items, rect, hot, parent }
  }

  get theme() { return this.os.theme; }

  // --- lifecycle -----------------------------------------------------------

  open(spec) {
    const win = spec instanceof Win ? spec : new Win(spec);
    this.windows.push(win);
    this.focus(win);
    win.app?.mount?.(win, this.os.ctx, this.os);
    this.os.play('ui.window-open');
    this.os.invalidate();
    return win;
  }

  close(win) {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    // A popup belongs to the window whose menu bar opened it. Closing the
    // window without closing the popup leaves it painted over the desktop,
    // detached from any menu bar — which is what buying a computer upgrade
    // with a menu open used to do.
    if (this.menu && this.menu.win === win) this.closeMenu();
    this.windows.splice(i, 1);
    win.app?.unmount?.();
    win.onClose?.(win);
    if (this.focused === win) {
      const next = [...this.windows].reverse().find((w) => !w.minimized) ?? null;
      this.focused = next;
    }
    this.os.play('ui.window-close');
    this.os.invalidate();
  }

  closeAll() {
    this.closeMenu();                     // including a global (Apple/Start) popup
    for (const w of [...this.windows]) this.close(w);
  }

  find(appId) { return this.windows.find((w) => w.appId === appId) ?? null; }

  focus(win) {
    if (!win) return;
    const i = this.windows.indexOf(win);
    if (i >= 0) { this.windows.splice(i, 1); this.windows.push(win); }
    win.minimized = false;
    this.focused = win;
    this.os.invalidate();
  }

  minimize(win) {
    win.minimized = true;
    if (this.focused === win) this.focused = [...this.windows].reverse().find((w) => !w.minimized) ?? null;
    this.os.invalidate();
  }

  toggleMax(win) {
    if (!win.resizable) return;
    const th = this.theme;
    if (win.maximized) {
      Object.assign(win, win.restore);
      win.maximized = false;
    } else {
      win.restore = { x: win.x, y: win.y, w: win.w, h: win.h };
      const top = th.family === 'platinum' ? th.metrics.menuBarH : 0;
      win.x = 0; win.y = top;
      win.w = th.w;
      win.h = th.h - th.metrics.shellH - top;
      win.maximized = true;
    }
    win.app?.resize?.(th.clientOf(win));
    this.os.invalidate();
  }

  /** Windows in taskbar order — creation order, not z-order, so they stop moving. */
  taskList() {
    return this.windows.filter((w) => !w.modal).sort((a, b) => (a.id > b.id ? 1 : -1));
  }

  get modal() { return [...this.windows].reverse().find((w) => w.modal) ?? null; }

  // --- painting ------------------------------------------------------------

  paint(g) {
    const th = this.theme;
    for (const win of this.windows) {
      if (win.minimized) continue;
      const focused = this.focused === win;
      const client = th.paintWindow(g, win, focused, this.os);
      win.client = client;
      if (win.shaded) continue;
      if (win.foreign) {
        // A foreign app (the 3D editor) draws itself elsewhere; the OS reserves
        // the hole and says so, so the screen is never left undefined.
        fill(g, client.x, client.y, client.w, client.h, '#000000');
        checker(g, client.x, client.y, client.w, client.h, '#000000', th.pal.shadow);
        SANS.draw(g, `${win.title} is drawn by the editor`, client.x + 8, client.y + 8, '#FFFFFF');
      } else if (win.app?.paint) {
        g.save();
        g.beginPath();
        g.rect(client.x, client.y, client.w, client.h);
        g.clip();
        win.app.paint(g, client, win, focused);
        g.restore();
      }
      if (win.resizable && th.family === 'platinum' && !win.maximized) this.paintGrowBox(g, win);
    }
    if (this.ghost) dragOutline(g, this.ghost.x, this.ghost.y, this.ghost.w, this.ghost.h, '#FFFFFF', '#000000');
  }

  /** Popups are painted after the shell — a Win95 menu overlays the taskbar. */
  paintMenus(g) {
    if (this.menu) this.paintMenu(g);
  }

  paintGrowBox(g, win) {
    const th = this.theme, pal = th.pal;
    const s = 15;
    const x = win.x + win.w - s - 1, y = win.y + win.h - s - 1;
    fill(g, x, y, s, s, pal.face);
    frameRect(g, x, y, s, s, pal.dark);
    for (let i = 0; i < 3; i++) {
      hline(g, x + 3 + i, y + 4 + i * 3, 8 - i * 2, pal.stripe);
      hline(g, x + 3 + i, y + 5 + i * 3, 8 - i * 2, pal.hi);
    }
    win._growRect = { x, y, w: s, h: s };
  }

  paintMenu(g) {
    const th = this.theme;
    const m = this.menu;
    th.paintMenu(g, m.rect, m.items, m.hot);
    if (m.child) th.paintMenu(g, m.child.rect, m.child.items, m.child.hot);
  }

  // --- menus ---------------------------------------------------------------

  openMenu(owner, win, index, items, anchor) {
    const th = this.theme;
    const size = th.menuSize(items);
    let x = anchor.x, y = anchor.y;
    if (x + size.w > th.w) x = th.w - size.w;
    if (y + size.h > th.h) y = Math.max(0, th.h - size.h);
    this.menu = { owner, win, index, items, rect: { x, y, w: size.w, h: size.h }, hot: null, child: null };
    if (win) win.menuOpen = index;
    this.os.menuOwner = owner;
    this.os.menuIndex = index;
    this.os.invalidate();
  }

  closeMenu() {
    if (!this.menu) return;
    if (this.menu.win) this.menu.win.menuOpen = -1;
    this.menu = null;
    this.os.menuOwner = null;
    this.os.menuIndex = -1;
    this.os.invalidate();
  }

  menuBarHit(x, y) {
    const th = this.theme;
    if (th.globalMenuBar) {
      if (y >= th.metrics.menuBarH) return null;
      const menu = this.os.globalMenu();
      for (let i = 0; i < menu.length; i++) if (inside(menu[i]._rect, x, y)) return { kind: 'global', index: i, item: menu[i] };
      return null;
    }
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const win = this.windows[i];
      if (win.minimized || !win.menu) continue;
      const L = th.layout(win);
      if (!L.menubar || !inside(L.menubar, x, y)) continue;
      for (let k = 0; k < win.menu.length; k++) if (inside(win.menu[k]._rect, x, y)) return { kind: 'win', win, index: k, item: win.menu[k] };
      return { kind: 'win', win, index: -1, item: null };
    }
    return null;
  }

  activateMenuItem(item) {
    const m = this.menu;
    this.closeMenu();
    if (!item || item.disabled) return;
    if (item.action) item.action(this.os);
    else if (m?.win?.app?.onMenu) m.win.app.onMenu(item.id ?? item.label, item);
    else this.os.onMenu?.(item.id ?? item.label, item);
    this.os.play('ui.click');
  }

  // --- input ---------------------------------------------------------------

  hitWindow(x, y) {
    const modal = this.modal;
    if (modal) return inside({ x: modal.x, y: modal.y, w: modal.w, h: modal.h }, x, y) ? modal : null;
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i];
      if (w.minimized) continue;
      const h = w.shaded ? this.theme.metrics.titleH + this.theme.metrics.frame * 2 : w.h;
      if (inside({ x: w.x, y: w.y, w: w.w, h }, x, y)) return w;
    }
    return null;
  }

  /** Which part of a window is under the cursor. */
  part(win, x, y) {
    const th = this.theme;
    const L = th.layout(win);
    for (const b of L.buttons) if (inside(b, x, y)) return { kind: 'caption', btn: b.id, rect: b };
    if (inside(L.cap, x, y)) return { kind: 'title' };
    if (win.shaded) return { kind: 'frame' };
    if (L.menubar && inside(L.menubar, x, y)) return { kind: 'menubar' };
    if (win._growRect && inside(win._growRect, x, y)) return { kind: 'resize', edge: 'se' };
    if (win.resizable && !win.maximized && th.family === 'win') {
      const f = th.metrics.frame + 1;
      const right = x >= win.x + win.w - f, bottom = y >= win.y + win.h - f;
      const left = x < win.x + f, top = y < win.y + f;
      if (right && bottom) return { kind: 'resize', edge: 'se' };
      if (right) return { kind: 'resize', edge: 'e' };
      if (bottom) return { kind: 'resize', edge: 's' };
      if (left || top) return { kind: 'frame' };
    }
    if (inside(L.client, x, y)) return { kind: 'client', rect: L.client };
    return { kind: 'frame' };
  }

  pointerDown(x, y, ev) {
    // an open menu swallows the click
    if (this.menu) {
      const m = this.menu;
      const target = (m.child && inside(m.child.rect, x, y)) ? m.child : (inside(m.rect, x, y) ? m : null);
      if (target) {
        const it = target.items.find((i) => !i.sep && inside(i._rect, x, y));
        if (it && it.submenu) return true;
        if (it) { this.activateMenuItem(it); return true; }
        return true;
      }
      const bar = this.menuBarHit(x, y);
      this.closeMenu();
      if (!bar) return true;
    }

    const bar = this.menuBarHit(x, y);
    if (bar && bar.item) {
      if (bar.kind === 'win') this.focus(bar.win);
      const r = bar.item._rect;
      this.openMenu(bar.kind, bar.kind === 'win' ? bar.win : null, bar.index, bar.item.items,
        { x: r.x, y: r.y + r.h });
      return true;
    }

    const win = this.hitWindow(x, y);
    if (!win) return false;
    if (this.focused !== win) this.focus(win);

    const p = this.part(win, x, y);
    if (p.kind === 'caption') {
      this.os.pressed = { kind: 'caption', win, btn: p.btn, rect: p.rect, hot: true };
      this.os.invalidate();
      return true;
    }
    if (p.kind === 'title') {
      if (ev?.double) {
        if (this.theme.family === 'platinum') { win.shaded = !win.shaded; this.os.invalidate(); }
        else this.toggleMax(win);
        return true;
      }
      if (!win.maximized) {
        this.drag = { win, mode: 'move', dx: x - win.x, dy: y - win.y };
        if (this.theme.slow) this.ghost = { x: win.x, y: win.y, w: win.w, h: win.h };
      }
      return true;
    }
    if (p.kind === 'resize') {
      this.drag = { win, mode: 'resize', edge: p.edge, x0: x, y0: y, w0: win.w, h0: win.h };
      if (this.theme.slow) this.ghost = { x: win.x, y: win.y, w: win.w, h: win.h };
      return true;
    }
    if (p.kind === 'client' && win.app?.pointer) {
      win.app.pointer({ type: 'down', x: x - p.rect.x, y: y - p.rect.y, gx: x, gy: y, button: ev?.button ?? 0, double: !!ev?.double, rect: p.rect });
      this.os.invalidate();
    }
    return true;
  }

  pointerMove(x, y, ev) {
    if (this.os.pressed?.kind === 'caption') {
      const hot = inside(this.os.pressed.rect, x, y);
      if (hot !== this.os.pressed.hot) { this.os.pressed.hot = hot; this.os.invalidate(); }
      return true;
    }
    if (this.drag) {
      const d = this.drag;
      const th = this.theme;
      if (d.mode === 'move') {
        const nx = Math.max(-d.win.w + 60, Math.min(th.w - 60, x - d.dx));
        const top = th.family === 'platinum' ? th.metrics.menuBarH : 0;
        const ny = Math.max(top, Math.min(th.h - th.metrics.shellH - 8, y - d.dy));
        if (this.ghost) { this.ghost.x = nx; this.ghost.y = ny; }
        else { d.win.x = nx; d.win.y = ny; }
      } else {
        const nw = Math.max(d.win.minW, Math.min(th.w - d.win.x, d.w0 + (d.edge.includes('e') ? x - d.x0 : 0)));
        const nh = Math.max(d.win.minH, Math.min(th.h - d.win.y, d.h0 + (d.edge.includes('s') ? y - d.y0 : 0)));
        if (this.ghost) { this.ghost.w = nw; this.ghost.h = nh; }
        else {
          d.win.w = nw; d.win.h = nh;
          d.win.app?.resize?.(th.clientOf(d.win));
        }
      }
      this.os.invalidate();
      return true;
    }
    if (this.menu) {
      const m = this.menu;
      const target = (m.child && inside(m.child.rect, x, y)) ? m.child : m;
      const it = target.items.find((i) => !i.sep && inside(i._rect, x, y)) ?? null;
      if (target.hot !== it) {
        target.hot = it;
        if (target === m) m.child = null;
        if (it && it.submenu) {
          const size = this.theme.menuSize(it.submenu);
          let sx = m.rect.x + m.rect.w - 3;
          if (sx + size.w > this.theme.w) sx = m.rect.x - size.w + 3;
          m.child = { items: it.submenu, rect: { x: sx, y: it._rect.y - 2, w: size.w, h: size.h }, hot: null };
        }
        this.os.invalidate();
      }
      // hovering another menu-bar title while open switches to it, instantly
      const bar = this.menuBarHit(x, y);
      if (bar && bar.item && bar.index !== m.index) {
        const r = bar.item._rect;
        this.openMenu(bar.kind, bar.kind === 'win' ? bar.win : null, bar.index, bar.item.items, { x: r.x, y: r.y + r.h });
      }
      return true;
    }
    const win = this.hitWindow(x, y);
    if (win && win.app?.pointer) {
      const L = this.theme.layout(win);
      if (inside(L.client, x, y)) {
        win.app.pointer({ type: 'move', x: x - L.client.x, y: y - L.client.y, gx: x, gy: y, rect: L.client, down: !!ev?.down });
      }
    }
    return !!win;
  }

  pointerUp(x, y) {
    if (this.os.pressed?.kind === 'caption') {
      const p = this.os.pressed;
      this.os.pressed = null;
      if (inside(p.rect, x, y)) {
        if (p.btn === 'close') this.close(p.win);
        // On the Platinum tiers that box is the COLLAPSE box, not a minimise
        // button: it windowshades the window up into its own title bar, exactly
        // as a double-click on the title bar already does here. Those tiers
        // have no taskbar to restore a hidden window from — hiding is the
        // Application menu's Hide Others, and it is undone by Show All.
        else if (p.btn === 'min') {
          if (this.theme.family === 'platinum') p.win.shaded = !p.win.shaded;
          else this.minimize(p.win);
        } else if (p.btn === 'max') this.toggleMax(p.win);
      }
      this.os.invalidate();
      return true;
    }
    if (this.drag) {
      const d = this.drag;
      if (this.ghost) {
        if (d.mode === 'move') { d.win.x = this.ghost.x; d.win.y = this.ghost.y; }
        else { d.win.w = this.ghost.w; d.win.h = this.ghost.h; d.win.app?.resize?.(this.theme.clientOf(d.win)); }
        this.ghost = null;
      }
      this.drag = null;
      this.os.invalidate();
      return true;
    }
    const win = this.hitWindow(x, y);
    if (win && win.app?.pointer) {
      const L = this.theme.layout(win);
      win.app.pointer({ type: 'up', x: x - L.client.x, y: y - L.client.y, gx: x, gy: y, rect: L.client });
      this.os.invalidate();
    }
    return !!win;
  }

  wheel(x, y, dy) {
    const win = this.hitWindow(x, y);
    if (!win || !win.app?.pointer) return false;
    const L = this.theme.layout(win);
    win.app.pointer({ type: 'wheel', x: x - L.client.x, y: y - L.client.y, dy, rect: L.client });
    this.os.invalidate();
    return true;
  }

  key(ev) {
    if (this.menu) {
      if (ev.key === 'Escape') { this.closeMenu(); return true; }
      const items = (this.menu.child ?? this.menu).items.filter((i) => !i.sep);
      const hit = items.find((i) => mnemonicOf(i.label) === ev.key.toLowerCase());
      if (hit) { this.activateMenuItem(hit); return true; }
      return true;
    }
    const win = this.focused;
    if (!win) return false;
    if (ev.key === 'Escape' && win.modal) { this.close(win); return true; }
    if (win.app?.key) return !!win.app.key(ev);
    return false;
  }

  /** Modal dialog helper used by every app. */
  dialog({ title, message, icon = 'info', buttons = ['OK'], onResult = null, w = 320, h = 130 }) {
    const th = this.theme;
    const x = (th.w - w) >> 1, y = (th.h - h) >> 1;
    const self = this;
    const app = {
      buttons: [],
      hot: -1,
      paint(g, r) {
        const pal = th.pal;
        fill(g, r.x, r.y, r.w, r.h, pal.face);
        if (I16[icon]) {
          I16[icon].draw(g, r.x + 14, r.y + 16);
          I16[icon].draw(g, r.x + 14, r.y + 32);
        }
        const lines = String(message).split('\n');
        lines.forEach((l, i) => SANS.draw(g, l, r.x + 44, r.y + 18 + i * 14, pal.text));
        this.buttons = [];
        const bw = 76, bh = 21;
        let bx = r.x + r.w - 12 - buttons.length * (bw + 8) + 8;
        for (let i = 0; i < buttons.length; i++) {
          const rect = { x: bx, y: r.y + r.h - bh - 12, w: bw, h: bh };
          BUTTON(g, rect, { label: buttons[i], pal, isDefault: i === 0, pressed: this.hot === i });
          this.buttons.push(rect);
          bx += bw + 8;
        }
      },
      pointer(ev) {
        const idx = this.buttons.findIndex((b) => inside(b, ev.gx, ev.gy));
        if (ev.type === 'down') { this.hot = idx; }
        if (ev.type === 'up') {
          if (idx >= 0 && idx === this.hot) {
            self.close(winRef);
            onResult?.(idx, buttons[idx]);
          }
          this.hot = -1;
        }
      },
      key(ev) {
        if (ev.key === 'Enter') { self.close(winRef); onResult?.(0, buttons[0]); return true; }
        return false;
      },
    };
    const winRef = this.open(new Win({ title, x, y, w, h, resizable: false, modal: true, app, icon: 'info' }));
    return winRef;
  }
}

function mnemonicOf(label) {
  const i = String(label).indexOf('&');
  return i >= 0 ? String(label)[i + 1]?.toLowerCase() : null;
}
