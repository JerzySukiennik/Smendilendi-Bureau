// cost.js — the live bill of quantities.
//
// Reads src/analysis/cost.js's metrics straight off the state:
//   analysis.metrics.cost = { bill:[{trade,item,qty,unit,rate,total}], subtotals,
//                             net, contingency, total, budget, costPerM2,
//                             overrunPct, quantities }
// and draws it as a period spreadsheet: raised column headers, 1 px grey grid,
// right-aligned money, bold trade subtotals, and a cost-against-budget bar that
// turns from Navy to Maroon the moment the drawing goes over.
//
// Rates are per m² of elevation, per m² on plan and per number, exactly as a
// quantity surveyor would set them out. Nothing here rounds money to something
// friendlier than the analysis produced.

import {
  fill, hline, vline, bevel, field, headerRow, statusBar, inside, textY, clipped,
  checker, VGA, progress,
} from '../widgets.js';
import { BODY, BODY_BOLD, UI } from '../font.js';
import { toolbar, toolbarHit, ScrollPane, TOOLBAR_H, UI_SCALE, money } from './common.js';

// The grid's own row pitch, in the machine's UI scale. A fixed 15 px was
// right on the one machine it was written for and buried the text on every
// other one once the type scaled (item 12).
const ROW_BASE = 15;
const ROW = () => ROW_BASE * UI_SCALE;

export class CostApp {
  constructor(ctx, os, win) {
    this.ctx = ctx;
    this.os = os;
    this.win = win;
    this.title = 'Cost Sheet';
    this.pane = new ScrollPane(ROW());
    this.sel = -1;
    this.groupByTrade = true;
    this.tools = [
      { id: 'refresh', tip: 'Recalculate', icon: 'cost' },
      { sep: true },
      { id: 'print', tip: 'Print bill', icon: 'printer' },
      { id: 'save', tip: 'Save bill', icon: 'floppy' },
    ];
    this.toolState = {};
    this.menu = [
      { label: '&File', items: [
        { label: '&Save Bill...', accel: 'Ctrl+S', id: 'save' },
        { label: '&Print...', accel: 'Ctrl+P', id: 'print' },
        { sep: true },
        { label: '&Close', id: 'close' },
      ] },
      { label: '&View', items: [
        { label: 'Group by &Trade', id: 'group', checked: true },
        { label: 'Flat &List', id: 'flat' },
        { sep: true },
        { label: '&Refresh', accel: 'F5', id: 'refresh' },
      ] },
      { label: '&Help', items: [{ label: '&About Cost Sheet', id: 'about' }] },
    ];
    this.refresh();
  }

  mount() {
    const st = this.ctx.state;
    if (st?.on) this._off = st.on('analysis', () => { this.refresh(); this.os.invalidate(); });
  }

  unmount() { this._off?.(); }

  refresh() {
    const st = this.ctx.state;
    const cost = st?.get?.('analysis.metrics.cost') ?? this.ctx.cost ?? null;
    this.cost = cost && Array.isArray(cost.bill) && cost.bill.length ? cost : SAMPLE;
    this.rows = this.buildRows();
  }

  buildRows() {
    const c = this.cost;
    const rows = [];
    if (this.groupByTrade) {
      const trades = [];
      for (const l of c.bill) if (!trades.includes(l.trade)) trades.push(l.trade);
      for (const t of trades) {
        rows.push({ kind: 'trade', label: t });
        for (const l of c.bill) if (l.trade === t) rows.push({ kind: 'line', l });
        rows.push({ kind: 'sub', label: `${t} subtotal`, total: c.subtotals?.[t] ?? 0 });
      }
    } else {
      for (const l of c.bill) rows.push({ kind: 'line', l });
    }
    rows.push({ kind: 'gap' });
    rows.push({ kind: 'sub', label: 'Net of contingency', total: c.net });
    rows.push({ kind: 'sub', label: 'Contingency', total: c.contingency });
    rows.push({ kind: 'total', label: 'Total as drawn', total: c.total });
    return rows;
  }

  columns(w) {
    const qty = 74, unit = 62, rate = 70, total = 88;
    return [
      { label: 'Item', w: Math.max(120, w - qty - unit - rate - total) },
      { label: 'Quantity', w: qty, align: 'right' },
      { label: 'Unit', w: unit },
      { label: 'Rate', w: rate, align: 'right' },
      { label: 'Total', w: total, align: 'right' },
    ];
  }

  paint(g, r) {
    const pal = this.os.theme.pal;
    const mac = this.os.theme.family === 'platinum';
    const c = this.cost;
    fill(g, r.x, r.y, r.w, r.h, pal.face);
    toolbar(g, { x: r.x, y: r.y, w: r.w, h: TOOLBAR_H }, this.tools, pal, this.toolState);

    // The budget band is the first thing to go when the window is short, the
    // way a Win95 status bar drops panes: it is 46 px of fixed furniture, and
    // overlapping it onto a collapsed grid is what made the window unreadable
    // at 220x140 in round 2. Below ~40 px of grid the band is dropped whole.
    const statusH = 20 * UI_SCALE;
    const gridTop = r.y + TOOLBAR_H + 2;
    let barH = 46 * UI_SCALE;
    let gridH = r.h - TOOLBAR_H - 2 - barH - statusH - 4;
    if (gridH < 40) { barH = 0; gridH = Math.max(0, r.h - TOOLBAR_H - 2 - statusH - 4); }
    const outer = { x: r.x + 2, y: gridTop, w: r.w - 4, h: gridH };
    const inner = field(g, outer.x, outer.y, outer.w, outer.h, pal);
    const cols = this.columns(inner.w - 16);
    headerRow(g, inner.x, inner.y, inner.w, 17, cols, pal, UI);

    const hdr = 17 * UI_SCALE;
    const bodyRect = { x: inner.x, y: inner.y + hdr, w: inner.w, h: inner.h - hdr };
    const body = this.pane.layout(bodyRect, this.rows.length * ROW() + 4);
    fill(g, body.x, body.y, body.w, body.h, pal.window);
    clipped(g, body, () => {
      const first = Math.max(0, Math.floor(this.pane.top / ROW()));
      const last = Math.min(this.rows.length, first + Math.ceil(body.h / ROW()) + 1);
      // the column rules, drawn first so text sits on top of them
      let cx = body.x;
      for (let i = 0; i < cols.length - 1; i++) { cx += cols[i].w; vline(g, cx, body.y, body.h, pal.face); }
      for (let i = first; i < last; i++) {
        const row = this.rows[i];
        const y = body.y + i * ROW() - this.pane.top;
        const on = i === this.sel && row.kind === 'line';
        if (on) fill(g, body.x, y, body.w, ROW(), pal.hilite);
        const fg = on ? pal.hiliteText : pal.text;
        hline(g, body.x, y + ROW() - 1, body.w, pal.face);
        if (row.kind === 'trade') {
          fill(g, body.x, y, body.w, ROW() - 1, pal.face);
          BODY_BOLD.draw(g, row.label.toUpperCase(), body.x + 4, textY(y, ROW()), pal.text);
        } else if (row.kind === 'sub' || row.kind === 'total') {
          const f = row.kind === 'total' ? BODY_BOLD : BODY_BOLD;
          if (row.kind === 'total') { hline(g, body.x, y, body.w, pal.text); hline(g, body.x, y + ROW() - 2, body.w, pal.text); }
          f.draw(g, row.label, body.x + 4, textY(y, ROW()), pal.text);
          const t = money(row.total);
          f.draw(g, t, body.x + body.w - 6 - f.measure(t), textY(y, ROW()), pal.text);
        } else if (row.kind === 'line') {
          const l = row.l;
          const cells = [l.item, fmtQty(l.qty), l.unit, money(l.rate), money(l.total)];
          let x = body.x;
          for (let ci = 0; ci < cols.length; ci++) {
            const cw = cols[ci].w;
            const t = BODY.ellipsis(cells[ci], cw - 8);
            if (cols[ci].align === 'right') BODY.draw(g, t, x + cw - 6 - BODY.measure(t), textY(y, ROW()), fg);
            else BODY.draw(g, t, x + 4, textY(y, ROW()), fg);
            x += cw;
          }
        }
      }
    });
    this.pane.paint(g, pal, mac);

    // --- cost against budget
    const budget = c.budget || 0;
    const over = budget > 0 && c.total > budget;
    if (barH) {
      const by = r.y + r.h - statusH - barH;
      const bx = r.x + 6, bw = r.w - 12;
      const right = `${money(c.total)} of ${budget ? money(budget) : '—'} credits`;
      twoColumn(g, bx, by + 2, bw, BODY_BOLD, 'Cost against budget', BODY, right, pal.text, pal.text);

      const trough = { x: bx, y: by + 15 * UI_SCALE, w: bw, h: 18 * UI_SCALE };
      const in2 = bevel(g, trough.x, trough.y, trough.w, trough.h, 'sunken', pal);
      fill(g, in2.x, in2.y, in2.w, in2.h, pal.face);
      const frac = budget > 0 ? Math.min(1.35, c.total / budget) : 0;
      const blocks = Math.floor((in2.w - 2) / 10);
      const on = Math.round(Math.min(1, frac) * blocks);
      for (let i = 0; i < on; i++) {
        // Navy, not pal.titleActive: on the Platinum tiers the title bar is grey
        // and the blocks would vanish into the trough.
        fill(g, in2.x + 1 + i * 10, in2.y + 1, 8, in2.h - 2, over ? VGA.maroon : VGA.navy);
    }
    if (budget > 0) {
      // the budget line itself, drawn as a hard 1 px rule through the trough
      const mx = in2.x + Math.round(in2.w * Math.min(1, 1 / Math.max(frac, 1)));
      vline(g, mx, trough.y - 3, trough.h + 6, VGA.black);
    }
    const note = !budget ? 'No budget in the brief.'
      : over ? `Over by ${money(c.total - budget)} credits (${(c.overrunPct ?? ((c.total - budget) / budget) * 100).toFixed(1)} %).`
        : `Inside the budget by ${money(budget - c.total)} credits.`;
    const perM2 = c.costPerM2 ? `${money(c.costPerM2)} credits/m²` : '';
    twoColumn(g, bx, by + 35, bw, over ? BODY_BOLD : BODY, note, BODY, perM2,
      over ? VGA.maroon : pal.text, pal.text);
    }

    statusBar(g, r.x, r.y + r.h - statusH, r.w, statusH, [
      { w: 150, text: `${c.bill.length} priced items` },
      { w: 130, text: c.quantities ? `${c.quantities.floorArea ?? 0} m² floor` : '' },
      { w: -1, text: over ? 'OVER BUDGET' : 'Within budget' },
    ], pal, BODY);
  }

  pointer(ev) {
    if (ev.type === 'move') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      const id = t?.id ?? null;
      if (id !== this.toolState.hot) { this.toolState.hot = id; this.os.invalidate(); }
    }
    if (ev.type === 'down') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t) { this.toolState.down = t.id; this.os.invalidate(); return; }
      if (inside(this.pane.rect, ev.gx, ev.gy) && !this.pane.pointer(ev)) {
        const i = Math.floor((ev.gy - this.pane.rect.y + this.pane.top) / ROW());
        this.sel = (i >= 0 && i < this.rows.length && this.rows[i].kind === 'line') ? i : -1;
        this.os.invalidate();
        return;
      }
    }
    if (ev.type === 'up' && this.toolState.down) {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t && t.id === this.toolState.down) this.onMenu(t.id);
      this.toolState.down = null;
      this.os.invalidate();
      return;
    }
    if (this.pane.pointer(ev)) this.os.invalidate();
  }

  key(ev) {
    if (ev.key === 'F5') { this.refresh(); this.os.invalidate(); return true; }
    return false;
  }

  onMenu(id) {
    switch (id) {
      case 'close': this.os.wm.close(this.win); break;
      case 'group': this.groupByTrade = true; this.rows = this.buildRows(); break;
      case 'flat': this.groupByTrade = false; this.rows = this.buildRows(); break;
      case 'refresh': this.refresh(); break;
      case 'save':
        this.os.wm.dialog({ title: 'Save Bill', icon: 'info', w: 340, h: 130,
          message: 'The bill is recomputed from the model every time\nyou open it. There is nothing to save.' });
        break;
      case 'print':
        this.os.wm.dialog({ title: 'Print', icon: 'warning', w: 330, h: 130, message: 'Still no printer.' });
        break;
      case 'about':
        this.os.wm.dialog({ title: 'About Cost Sheet', icon: 'info', w: 350, h: 140,
          message: 'Cost Sheet 2.0\nQuantities measured off the model, priced\nfrom the catalogue. 6 % contingency added.' });
        break;
      default: break;
    }
    this.os.invalidate();
  }
}

function fmtQty(q) {
  const n = Number(q) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * A caption on the left and a figure hard right on the same baseline — but only
 * while both actually fit.
 *
 * Round 2 found the budget band overprinting itself at the window's own declared
 * minimum: "Cost against budget" and "493 996 of 1 240 000 credits" were drawn
 * unconditionally, so at 220 px the reader got "Cost again§13budget| 240 000
 * credits". Windows 95 does not overlap text to fit; its status bar drops whole
 * panes and its list columns ellipsis. So this does both: when the two strings
 * plus a 12 px gutter do not fit, the right one is dropped outright, and if the
 * left one alone still does not fit it is ellipsised.
 */
function twoColumn(g, x, y, w, leftFont, leftText, rightFont, rightText, leftColor, rightColor) {
  const GUTTER = 12;
  const lw = leftFont.measure(leftText);
  const rw = rightText ? rightFont.measure(rightText) : 0;
  if (rw && lw + GUTTER + rw <= w - 4) {
    leftFont.draw(g, leftText, x, y, leftColor);
    rightFont.draw(g, rightText, x + w - 4 - rw, y, rightColor);
    return;
  }
  leftFont.draw(g, leftFont.ellipsis(leftText, w - 4), x, y, leftColor);
}

/** Shown before a model exists. Rates are the catalogue's own. */
const SAMPLE = {
  bill: [
    { trade: 'Structure', item: 'exterior wall carcass', qty: 148.6, unit: 'm² elev.', rate: 620, total: 92132 },
    { trade: 'Structure', item: 'interior wall carcass', qty: 96.2, unit: 'm² elev.', rate: 310, total: 29822 },
    { trade: 'Structure', item: 'floor slab', qty: 132.0, unit: 'm² plan', rate: 480, total: 63360 },
    { trade: 'Structure', item: 'roof structure and covering', qty: 148.0, unit: 'm² plan', rate: 690, total: 102120 },
    { trade: 'Structure', item: 'foundations', qty: 132.0, unit: 'm² plan', rate: 520, total: 68640 },
    { trade: 'Finishes', item: 'plaster finish to walls', qty: 244.8, unit: 'm²', rate: 95, total: 23256 },
    { trade: 'Finishes', item: 'oak floor finish', qty: 78.0, unit: 'm²', rate: 260, total: 20280 },
    { trade: 'Finishes', item: 'tile floor finish', qty: 34.0, unit: 'm²', rate: 190, total: 6460 },
    { trade: 'Finishes', item: 'plastered and painted ceilings', qty: 118.4, unit: 'm²', rate: 85, total: 10064 },
    { trade: 'Openings', item: 'door, leaf frame and ironmongery', qty: 11, unit: 'no.', rate: 1500, total: 16500 },
    { trade: 'Openings', item: 'window, glazed unit and frame', qty: 26.4, unit: 'm²', rate: 900, total: 23760 },
    { trade: 'Furniture', item: 'dining chair, moulded ply', qty: 6, unit: 'no.', rate: 340, total: 2040 },
    { trade: 'Furniture', item: 'worktop run, 0.90 m high', qty: 4, unit: 'no.', rate: 1250, total: 5000 },
    { trade: 'Furniture', item: 'double bed, 1.60 x 2.00 m', qty: 1, unit: 'no.', rate: 2600, total: 2600 },
  ],
  subtotals: { Structure: 356074, Finishes: 60060, Openings: 40260, Furniture: 9640, Contingency: 27962 },
  net: 466034,
  contingency: 27962,
  total: 493996,
  budget: 1240000,
  costPerM2: 3742,
  quantities: { floorArea: 132.0 },
};

export default CostApp;
