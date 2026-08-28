// mail.js — the inbox. Where the brief arrives and where the client's revision
// notes are read, so it has to be genuinely pleasant to read at 640 x 480.
//
// A list pane over a reading pane, in the period style: 16x16 envelopes, unread
// subjects in bold, the selected row in Highlight navy with white text, a 16 px
// scrollbar in each pane, and a status bar counting the messages.
//
// Bodies come from the analysis engine: src/analysis/mail.js writes the client's
// e-mail out of the Report, and src/commission/ writes the brief. This app never
// invents architecture — it renders what the state hands it and only falls back
// to its own sample inbox when nothing has been generated yet.

import {
  fill, hline, vline, bevel, field, headerRow, statusBar, inside, textY,
  clipped, checker,
} from '../widgets.js';
import { SANS, SANS_BOLD, wrap } from '../font.js';
import { I16 } from '../icons.js';
import { toolbar, toolbarHit, ListView, ScrollPane, TOOLBAR_H, dateShort } from './common.js';

const HEADER_H = 17;

export class MailApp {
  constructor(ctx, os, win) {
    this.ctx = ctx;
    this.os = os;
    this.win = win;
    this.title = 'Mail';
    this.list = new ListView(HEADER_H);
    this.body = new ScrollPane(13);
    this.split = 0.42;
    this.tools = [
      { id: 'reply', icon: 'mail' },
      { id: 'forward', icon: 'mailOpen' },
      { sep: true },
      { id: 'print', icon: 'printer' },
      { id: 'delete', icon: 'bin' },
      { sep: true },
      { id: 'brief', icon: 'doc' },
    ];
    this.toolState = {};
    this.menu = [
      { label: '&File', items: [
        { label: '&Open', accel: 'Enter', id: 'open' },
        { label: '&Print...', accel: 'Ctrl+P', id: 'print' },
        { sep: true },
        { label: '&Close', accel: 'Alt+F4', id: 'close' },
      ] },
      { label: '&Edit', items: [
        { label: 'Cu&t', accel: 'Ctrl+X', id: 'cut', disabled: true },
        { label: '&Copy', accel: 'Ctrl+C', id: 'copy' },
        { label: '&Paste', accel: 'Ctrl+V', id: 'paste', disabled: true },
        { sep: true },
        { label: 'Select &All', accel: 'Ctrl+A', id: 'all' },
      ] },
      { label: '&View', items: [
        { label: '&Toolbar', id: 'toolbar', checked: true },
        { label: '&Status Bar', id: 'status', checked: true },
        { sep: true },
        { label: 'Sort by &Date', id: 'sortdate', checked: true },
        { label: 'Sort by &Sender', id: 'sortfrom' },
      ] },
      { label: '&Message', items: [
        { label: '&Reply to Client', accel: 'Ctrl+R', id: 'reply' },
        { label: 'Mark as &Unread', id: 'unread' },
        { sep: true },
        { label: '&Delete', accel: 'Del', id: 'delete' },
      ] },
      { label: '&Help', items: [
        { label: '&Help Topics', id: 'help' },
        { sep: true },
        { label: '&About Mail', id: 'about' },
      ] },
    ];
    this.messages = [];
    this.refresh();
    this.list.onSelect = (i) => this.select(i);
  }

  mount() {
    const st = this.ctx.state;
    if (st?.on) this._off = st.on('mail', () => { this.refresh(); this.os.invalidate(); });
    this.select(0);
  }

  unmount() { this._off?.(); }

  refresh() {
    const st = this.ctx.state;
    const fromState = st?.get?.('mail.messages');
    this.messages = (Array.isArray(fromState) && fromState.length)
      ? fromState.map(normalise)
      : sampleInbox(st?.get?.('commission'));
    if (this.list.sel >= this.messages.length) this.list.sel = Math.max(0, this.messages.length - 1);
    this.lines = null;

    // A message that has just landed announces itself. The client's revision
    // arrives while you are looking at the model, not at the inbox, so this is
    // the only moment the player is told. `_unread` is undefined on the first
    // refresh (the constructor), so opening Mail never chimes at its own backlog
    // — only a RISE in the unread count does.
    const unread = this.messages.filter((m) => m.unread).length;
    if (this._unread !== undefined && unread > this._unread) this.os.play('ui.mail-notify');
    this._unread = unread;
  }

  get current() { return this.messages[this.list.sel] ?? null; }

  select(i) {
    this.list.sel = Math.max(0, Math.min(this.messages.length - 1, i));
    const m = this.current;
    if (m && m.unread) {
      m.unread = false;
      const st = this.ctx.state;
      const n = this.messages.filter((x) => x.unread).length;
      st?.set?.('mail.unread', n);
    }
    this.body.v.set(0);
    this.lines = null;
    this.os.invalidate();
  }

  // --- painting ------------------------------------------------------------

  paint(g, r) {
    const pal = this.os.theme.pal;
    const mac = this.os.theme.family === 'platinum';
    fill(g, r.x, r.y, r.w, r.h, pal.face);

    const tb = { x: r.x, y: r.y, w: r.w, h: TOOLBAR_H };
    toolbar(g, tb, this.tools, pal, this.toolState);

    const statusH = 20;
    const top = r.y + TOOLBAR_H + 2;
    const avail = r.h - TOOLBAR_H - 2 - statusH - 4;
    const listH = Math.max(HEADER_H + this.list.rowH * 3 + 4, Math.round(avail * this.split));
    const listRect = { x: r.x + 2, y: top, w: r.w - 4, h: listH };

    // --- list pane
    const inner = field(g, listRect.x, listRect.y, listRect.w, listRect.h, pal);
    const cols = this.columns(inner.w);
    headerRow(g, inner.x, inner.y, inner.w, HEADER_H, cols, pal, SANS);
    const bodyRect = { x: inner.x, y: inner.y + HEADER_H, w: inner.w, h: inner.h - HEADER_H };
    this.list.layout(bodyRect, this.messages.length);
    this.list.paint(g, pal, (gg, i, row, on) => this.paintRow(gg, i, row, on, cols, pal), mac);

    // --- splitter: a 2 px etched line, the whole width
    const spY = listRect.y + listRect.h + 1;
    hline(g, r.x + 2, spY, r.w - 4, pal.shadow);
    hline(g, r.x + 2, spY + 1, r.w - 4, pal.hi);

    // --- reading pane
    const readRect = { x: r.x + 2, y: spY + 3, w: r.w - 4, h: r.y + r.h - statusH - (spY + 3) - 3 };
    const rin = field(g, readRect.x, readRect.y, readRect.w, readRect.h, pal);
    this.paintReading(g, rin, pal, mac);

    // --- status bar
    const unread = this.messages.filter((m) => m.unread).length;
    statusBar(g, r.x, r.y + r.h - statusH, r.w, statusH, [
      { w: Math.max(120, r.w - 190), text: `${this.messages.length} message${this.messages.length === 1 ? '' : 's'}, ${unread} unread` },
      { w: 84, text: this.current ? 'Inbox' : '' },
      { w: -1, text: '' },
    ], pal, SANS);
  }

  columns(w) {
    const from = Math.max(96, Math.round(w * 0.26));
    const when = 108;
    return [
      { label: '', w: 20 },
      { label: 'From', w: from },
      { label: 'Subject', w: Math.max(80, w - from - when - 20) },
      { label: 'Received', w: when },
    ];
  }

  paintRow(g, i, row, on, cols, pal) {
    const m = this.messages[i];
    const fg = on ? pal.hiliteText : pal.text;
    const f = m.unread ? SANS_BOLD : SANS;
    const icon = m.unread ? 'mail' : 'mailOpen';
    I16[icon]?.draw(g, row.x + 2, row.y + ((row.h - 16) >> 1));
    let x = row.x + cols[0].w;
    const cells = [m.from, m.subject, dateShort(m.at)];
    for (let c = 1; c < cols.length; c++) {
      const cw = cols[c].w;
      const t = f.ellipsis(cells[c - 1], cw - 8);
      f.draw(g, t, x + 4, textY(row.y, row.h), fg);
      x += cw;
    }
  }

  paintReading(g, r, pal, mac) {
    const m = this.current;
    if (!m) {
      SANS.draw(g, 'No message selected.', r.x + 8, r.y + 8, pal.gray);
      return;
    }
    const pad = 8;
    const headH = 46;
    // header block: labels in bold, values plain, then an etched rule
    fill(g, r.x, r.y, r.w, headH, pal.face);
    const lab = (s, y) => SANS_BOLD.draw(g, s, r.x + pad, y, pal.text);
    const val = (s, y, w) => SANS.draw(g, SANS.ellipsis(s, w), r.x + pad + 52, y, pal.text);
    lab('From:', r.y + 4); val(m.from, r.y + 4, r.w - 70);
    lab('Subject:', r.y + 17); val(m.subject, r.y + 17, r.w - 70);
    lab('Date:', r.y + 30); val(dateShort(m.at), r.y + 30, r.w - 70);
    hline(g, r.x, r.y + headH, r.w, pal.shadow);
    hline(g, r.x, r.y + headH + 1, r.w, pal.hi);

    const paneRect = { x: r.x, y: r.y + headH + 2, w: r.w, h: r.h - headH - 2 };
    const textW = paneRect.w - pad * 2 - 16;
    if (!this.lines || this.lineWidth !== textW) {
      this.lines = wrap(SANS, m.body, textW);
      this.lineWidth = textW;
    }
    const contentH = this.lines.length * 13 + 8;
    const body = this.body.layout(paneRect, contentH);
    fill(g, body.x, body.y, body.w, body.h, pal.window);
    clipped(g, body, () => {
      const first = Math.max(0, Math.floor(this.body.top / 13) - 1);
      const last = Math.min(this.lines.length, first + Math.ceil(body.h / 13) + 2);
      for (let i = first; i < last; i++) {
        const line = this.lines[i];
        const y = body.y + 4 + i * 13 - this.body.top;
        // a bulleted complaint from the analysis engine is set in bold
        const bullet = line.startsWith('  - ');
        (bullet ? SANS_BOLD : SANS).draw(g, bullet ? line.slice(4) : line, body.x + pad + (bullet ? 10 : 0), y, pal.text);
        if (bullet) fill(g, body.x + pad + 2, y + 4, 3, 3, pal.text);
      }
    });
    this.body.paint(g, pal, mac);
  }

  // --- input ---------------------------------------------------------------

  pointer(ev) {
    if (ev.type === 'move') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      const id = t?.id ?? null;
      if (id !== this.toolState.hot) { this.toolState.hot = id; this.os.invalidate(); }
    }
    if (ev.type === 'down') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t) { this.toolState.down = t.id; this.os.invalidate(); return; }
    }
    if (ev.type === 'up' && this.toolState.down) {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t && t.id === this.toolState.down) this.onMenu(t.id);
      this.toolState.down = null;
      this.os.invalidate();
      return;
    }
    if (this.list.pointer(ev)) { this.os.invalidate(); return; }
    if (this.body.pointer(ev)) { this.os.invalidate(); }
  }

  key(ev) {
    if (this.list.key(ev)) { this.select(this.list.sel); return true; }
    if (ev.key === 'PageDown') { this.body.v.by(this.body.rect.h); this.os.invalidate(); return true; }
    if (ev.key === 'PageUp') { this.body.v.by(-this.body.rect.h); this.os.invalidate(); return true; }
    return false;
  }

  onMenu(id) {
    const os = this.os;
    switch (id) {
      case 'close': os.wm.close(this.win); break;
      case 'reply':
        os.wm.dialog({ title: 'Reply', icon: 'info', w: 340, h: 140,
          message: 'The client hears from you when you submit\nthe drawings, not before.\n\nSubmit from the Design window.' });
        break;
      case 'delete':
        if (this.current?.locked) {
          os.play('ui.error');
          os.wm.dialog({ title: 'Mail', icon: 'warning', w: 330, h: 130, message: 'The brief cannot be deleted.\nYou will want it again in about ten minutes.' });
        } else if (this.current) {
          this.messages.splice(this.list.sel, 1);
          this.select(Math.min(this.list.sel, this.messages.length - 1));
        }
        break;
      case 'unread': if (this.current) { this.current.unread = true; os.invalidate(); } break;
      case 'print':
        os.wm.dialog({ title: 'Print', icon: 'info', w: 330, h: 130, message: 'There is no printer attached.\nThere has never been a printer attached.' });
        break;
      case 'brief': this.select(this.messages.findIndex((m) => m.kind === 'brief')); break;
      case 'about':
        os.wm.dialog({ title: 'About Mail', icon: 'info', w: 330, h: 140,
          message: `Mail 1.2 for ${os.config.osName} ${os.config.osVersion}\nSmendilendi Bureau, single seat licence.` });
        break;
      case 'help': os.help(); break;
      default: break;
    }
    os.invalidate();
  }
}

function normalise(m, i) {
  return {
    id: m.id ?? `m${i}`,
    from: m.from ?? 'Unknown sender',
    subject: m.subject ?? '(no subject)',
    body: m.body ?? '',
    at: m.at ?? Date.now(),
    unread: m.unread !== false,
    kind: m.kind ?? 'mail',
    locked: !!m.locked,
  };
}

/**
 * The fallback inbox, used before a commission has been generated. Every number
 * in it is one an architect would recognise: 1.20 m corridors, 0.90 x 2.05 m
 * door leaves, a 1:8 window-to-floor ratio, m² throughout.
 */
export function sampleInbox(commission) {
  const now = Date.now();
  const hour = 3600e3;
  const out = [];

  if (commission) {
    out.push({
      id: 'brief', kind: 'brief', locked: true, unread: true, at: now - 26 * hour,
      from: `${commission.client?.name ?? 'The client'}${commission.client?.company ? `, ${commission.client.company}` : ''}`,
      subject: `${commission.title ?? 'New commission'} — brief`,
      body: commission.briefText ?? '',
    });
  } else {
    out.push({
      id: 'brief', kind: 'brief', locked: true, unread: true, at: now - 26 * hour,
      from: 'Hanna Reszka, Reszka & Daughter',
      subject: 'Detached house, ul. Lipowa 14 — brief',
      body: [
        'Dear all,',
        '',
        'We have bought the plot at Lipowa 14 and would like you to draw the house.',
        'The plot is 21.5 m wide and 34 m deep, falls 1.4 m towards the north, and',
        'the street is on the south side. The entrance must face the street.',
        '',
        'What we need, and roughly how big:',
        '',
        '  - living room, 32 m2, facing the garden',
        '  - kitchen with a dining place, 18 m2',
        '  - three bedrooms, 14 / 12 / 12 m2',
        '  - bathroom 7 m2 and a separate WC 2.5 m2',
        '  - hall, utility room, and a covered place for two bicycles',
        '',
        'Two conditions I will not move on. The WC must not open off the kitchen,',
        'and my mother uses a walking frame, so the ground floor has to work for',
        'her: no step at the entrance and nothing narrower than 1.20 m.',
        '',
        'The budget is 1 240 000 credits including the site works, and I would',
        'rather hear now than later if that is not enough.',
        '',
        'Warmly,',
        'Hanna Reszka',
      ].join('\n'),
    });
  }

  out.push({
    id: 'planning', unread: true, at: now - 5 * hour,
    from: 'Planning Department',
    subject: 'Setbacks and coverage — confirmation',
    body: [
      'Confirming the conditions for the plot, as requested.',
      '',
      '  - front setback: 6.00 m from the street boundary',
      '  - side setbacks: 4.00 m, or 3.00 m where the wall has no openings',
      '  - maximum site coverage: 30 % of the plot area',
      '  - maximum ridge height: 9.00 m above existing ground at the entrance',
      '  - at least 40 % of the plot to remain planted',
      '',
      'The lime tree at the north-east corner is protected. Its root protection',
      'area is a circle of radius 6.00 m measured from the trunk; no foundation,',
      'no trench and no site hut inside it.',
      '',
      'These are conditions, not suggestions.',
    ].join('\n'),
  });

  out.push({
    id: 'bureau', unread: false, at: now - 30 * hour,
    from: 'Bureau Notices',
    subject: 'The plotter, again',
    body: [
      'The A1 plotter is out of magenta and has been since March.',
      '',
      'Until the cartridge arrives, all site plans will print with the trees',
      'in cyan. Nobody has complained. One client said it read as "an ecological',
      'approach", so we are leaving it.',
      '',
      'Second: whoever has been saving files as final_final_v3_REALLY_FINAL,',
      'the Projects window has a Save As box for a reason.',
    ].join('\n'),
  });

  return out.map(normalise);
}

export default MailApp;
