// chat.js — team chat over src/net.
//
// DESIGN-DECISIONS.md: "Text chat only, no voice." 1-3 players in one shared
// office, each with their own colour, so a nick is drawn in that player's colour
// and the message in black. The transport is whatever session.js gave us —
// LocalTransport in single player, RTDB in an office with other people — and
// this app never knows which, exactly as ARCHITECTURE.md requires.
//
// The OS is not allowed to import src/net directly (that module reaches for
// Firebase). It uses ctx.net if the app handed one in, and otherwise talks to a
// tiny local stand-in so the window is never dead.

import {
  fill, hline, vline, bevel, field, statusBar, inside, textY, clipped, button,
  focusRect, VGA,
} from '../widgets.js';
import { BODY, BODY_BOLD, UI, wrap } from '../font.js';
import { I16 } from '../icons.js';
import { ScrollPane } from './common.js';

const LINE = 13;

/** Nick colours, from the 16-colour set so the chrome histogram stays small. */
export const NICK_COLORS = [VGA.navy, VGA.maroon, VGA.teal, VGA.purple, VGA.green, VGA.olive];

export class ChatApp {
  constructor(ctx, os, win) {
    this.ctx = ctx;
    this.os = os;
    this.win = win;
    this.title = 'Studio Talk';
    this.pane = new ScrollPane(LINE);
    this.input = '';
    this.caret = true;
    this.caretT = 0;
    this.messages = [];
    this.colors = new Map();
    this.menu = [
      { label: '&File', items: [
        { label: '&Copy Office Code', id: 'code' },
        { sep: true },
        { label: '&Close', id: 'close' },
      ] },
      { label: '&View', items: [
        { label: 'Show &Timestamps', id: 'stamps', checked: true },
        { label: 'Show &Joins', id: 'joins', checked: true },
      ] },
      { label: '&Help', items: [{ label: '&About Studio Talk', id: 'about' }] },
    ];
    this.stamps = true;
  }

  mount() {
    const net = this.ctx.net ?? null;
    this.net = net;
    if (net?.on) {
      this._off = net.on('chat', (m) => {
        this.push(m);
        this.os.play('ui.click-soft');
        this.os.invalidate();
      });
      for (const m of net.chatLog ?? []) this.push(m);
    }
    if (!this.messages.length) {
      const t = Date.now();
      this.push({ pid: 'sys', text: `Connected to office ${this.code()}.`, at: t - 60000, system: true });
      this.push({ pid: 'sys', text: 'Everyone in this office sees the same model. Grab an object to lock it.', at: t - 59000, system: true });
    }
  }

  unmount() { this._off?.(); }

  code() { return this.net?.code ?? 'LOCAL-OFF'; }

  push(m) {
    this.messages.push({
      pid: m.pid ?? 'sys',
      nick: m.nick ?? this.nickOf(m.pid),
      text: String(m.text ?? ''),
      at: m.at ?? Date.now(),
      system: !!m.system,
    });
    if (this.messages.length > 300) this.messages.shift();
    this.lines = null;
    this.pane.v.set(1e9);
  }

  nickOf(pid) {
    const p = this.net?.players?.find?.((x) => x.id === pid);
    return p?.nick ?? (pid === this.net?.playerId ? 'You' : pid ?? 'system');
  }

  colorOf(pid) {
    if (pid === 'sys') return VGA.gray;
    const p = this.net?.players?.find?.((x) => x.id === pid);
    if (p?.color && /^#[0-9a-f]{6}$/i.test(p.color)) return p.color;
    if (!this.colors.has(pid)) this.colors.set(pid, NICK_COLORS[this.colors.size % NICK_COLORS.length]);
    return this.colors.get(pid);
  }

  send() {
    const t = this.input.trim();
    if (!t) return;
    this.input = '';
    if (this.net?.chat) this.net.chat(t);
    else this.push({ pid: this.net?.playerId ?? 'me', nick: 'You', text: t, at: Date.now() });
    this.os.play('ui.click');
    this.os.invalidate();
  }

  // --- painting ------------------------------------------------------------

  paint(g, r, win, focused) {
    const pal = this.os.theme.pal;
    const mac = this.os.theme.family === 'platinum';
    fill(g, r.x, r.y, r.w, r.h, pal.face);

    const statusH = 20;
    const inputH = 22;
    const roster = 88;

    // transcript
    const outer = { x: r.x + 3, y: r.y + 3, w: r.w - 6 - roster - 3, h: r.h - inputH - statusH - 12 };
    const inner = field(g, outer.x, outer.y, outer.w, outer.h, pal);
    const textW = inner.w - 12;
    if (!this.lines || this.lineW !== textW) this.relayout(textW);
    const body = this.pane.layout(inner, this.lines.length * LINE + 6);
    fill(g, body.x, body.y, body.w, body.h, pal.window);
    clipped(g, body, () => {
      const first = Math.max(0, Math.floor(this.pane.top / LINE));
      const last = Math.min(this.lines.length, first + Math.ceil(body.h / LINE) + 1);
      for (let i = first; i < last; i++) {
        const ln = this.lines[i];
        const y = body.y + 3 + i * LINE - this.pane.top;
        let x = body.x + 4;
        if (ln.head) {
          if (this.stamps) {
            const ts = hhmm(ln.at);
            BODY.draw(g, ts, x, y, pal.gray);
            x += BODY.measure(ts) + 5;
          }
          const nick = ln.system ? '*' : `${ln.nick}:`;
          BODY_BOLD.draw(g, nick, x, y, this.colorOf(ln.pid));
          x += BODY_BOLD.measure(nick) + 4;
        } else {
          x += this.indent;
        }
        BODY.draw(g, ln.text, x, y, ln.system ? pal.gray : pal.text);
      }
    });
    this.pane.paint(g, pal, mac);

    // roster
    const rx = r.x + r.w - roster - 3;
    BODY_BOLD.draw(g, 'In the office', rx, r.y + 3, pal.text);
    const rin = field(g, rx, r.y + 15, roster, outer.h - 12, pal);
    const players = this.players();
    players.forEach((p, i) => {
      const y = rin.y + 2 + i * 15;
      fill(g, rin.x + 4, y + 3, 7, 7, this.colorOf(p.id));
      hline(g, rin.x + 4, y + 2, 7, pal.text);
      hline(g, rin.x + 4, y + 10, 7, pal.text);
      vline(g, rin.x + 3, y + 3, 7, pal.text);
      vline(g, rin.x + 11, y + 3, 7, pal.text);
      BODY.draw(g, BODY.ellipsis(p.nick, roster - 22), rin.x + 15, y, pal.text);
    });

    // input line + Send
    const iy = r.y + r.h - statusH - inputH - 4;
    const bw = 54;
    const fin = field(g, r.x + 3, iy, r.w - 6 - bw - 4, inputH, pal);
    const shown = BODY.ellipsis(this.input, fin.w - 8);
    BODY.draw(g, shown, fin.x + 4, textY(fin.y, fin.h), pal.text);
    if (focused && this.caret) {
      const cx = fin.x + 4 + BODY.measure(shown);
      fill(g, cx + 1, fin.y + 3, 1, fin.h - 6, pal.text);
    }
    button(g, { x: r.x + r.w - bw - 3, y: iy, w: bw, h: inputH }, {
      label: '&Send', pal, isDefault: true, pressed: this.sendDown,
    });
    this.sendRect = { x: r.x + r.w - bw - 3, y: iy, w: bw, h: inputH };
    this.inputRect = fin;

    statusBar(g, r.x, r.y + r.h - statusH, r.w, statusH, [
      { w: 132, text: `Office ${this.code()}` },
      { w: 96, text: `${players.length} connected` },
      { w: -1, text: this.net ? (this.net.kind === 'rtdb' ? 'Online' : 'Local session') : 'Local session' },
    ], pal, BODY);
  }

  players() {
    const list = this.net?.players;
    if (Array.isArray(list) && list.length) return list;
    return [{ id: this.net?.playerId ?? 'me', nick: this.ctx.nick ?? 'You' }];
  }

  relayout(textW) {
    this.lineW = textW;
    this.indent = 34;
    const out = [];
    for (const m of this.messages) {
      const head = (this.stamps ? BODY.measure(hhmm(m.at)) + 5 : 0)
        + BODY_BOLD.measure(m.system ? '*' : `${m.nick}:`) + 4;
      const parts = wrap(BODY, m.text, Math.max(40, textW - head));
      parts.forEach((t, i) => out.push({ ...m, text: t, head: i === 0 }));
      this.indent = Math.max(this.indent, 0);
    }
    this.lines = out;
  }

  // --- input ---------------------------------------------------------------

  pointer(ev) {
    if (ev.type === 'down' && inside(this.sendRect, ev.gx, ev.gy)) { this.sendDown = true; this.os.invalidate(); return; }
    if (ev.type === 'up') {
      if (this.sendDown && inside(this.sendRect, ev.gx, ev.gy)) this.send();
      this.sendDown = false;
      this.os.invalidate();
    }
    if (this.pane.pointer(ev)) this.os.invalidate();
  }

  cursor(x, y) {
    return this.inputRect && inside(this.inputRect, this.inputRect.x + x, this.inputRect.y + y) ? 'ibeam' : null;
  }

  key(ev) {
    if (ev.key === 'Enter') { this.send(); return true; }
    if (ev.key === 'Backspace') { this.input = this.input.slice(0, -1); this.os.invalidate(); return true; }
    if (ev.char && ev.char.length === 1 && !ev.ctrl) {
      if (this.input.length < 240) this.input += ev.char;
      this.os.invalidate();
      return true;
    }
    return false;
  }

  update(dt) {
    this.caretT += dt;
    if (this.caretT > 0.5) { this.caretT = 0; this.caret = !this.caret; return true; }
    return false;
  }

  onMenu(id) {
    switch (id) {
      case 'close': this.os.wm.close(this.win); break;
      case 'stamps': this.stamps = !this.stamps; this.lines = null; break;
      case 'code':
        this.os.wm.dialog({ title: 'Office code', icon: 'info', w: 320, h: 130,
          message: `This office is ${this.code()}.\nRead it out; anyone who types it joins.` });
        break;
      case 'about':
        this.os.wm.dialog({ title: 'About Studio Talk', icon: 'info', w: 340, h: 130,
          message: 'Studio Talk 1.0\nText only. The bureau has no microphone budget.' });
        break;
      default: break;
    }
    this.os.invalidate();
  }
}

function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default ChatApp;
