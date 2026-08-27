// economy.js — one shared bank for the whole practice.
//
// DESIGN-DECISIONS.md: "One shared bank. Fees fund everything." Nothing
// persists between sessions, so this is a session ledger, not a save file.
//
// Scale is anchored to the rest of the game and not invented here: briefs carry
// construction budgets in the 200-600k band (src/model/catalog.js, note under
// MATERIAL_PRICES), and an architect's fee is a percentage of construction
// cost. FEE_RATE below is the RIBA-ish sliding scale a practising architect
// would recognise — a bigger job earns a smaller percentage.
//
// Every movement of money goes through credit()/debit() so the ledger is the
// single source of truth and the HUD can just render it.

export const FEE_RATE = [
  // [ construction cost up to, fee as a fraction ]
  [150_000, 0.105],
  [300_000, 0.090],
  [600_000, 0.075],
  [Infinity, 0.062],
];

export const SALARY = {
  // paid once per completed commission, not per month: a commission IS the
  // unit of time in this game.
  intern: 4_000,
  architect: 12_000,
  partner: 26_000,
};

export const STARTING_BALANCE = 30_000;

/** Fee for a commission of the given construction cost, rounded to 100. */
export function feeFor(constructionCost) {
  const c = Math.max(0, Number(constructionCost) || 0);
  for (const [cap, rate] of FEE_RATE) if (c <= cap) return Math.round((c * rate) / 100) * 100;
  return 0;
}

/** What a late delivery costs: 4 % of the fee per day, capped at 40 %. */
export function latePenalty(fee, daysLate) {
  const d = Math.max(0, daysLate | 0);
  return Math.round(fee * Math.min(0.40, d * 0.04));
}

export class Economy {
  /**
   * @param {State} state  src/core/state.js — 'bank.balance' and 'bank.history'
   */
  constructor(state, opts = {}) {
    this.state = state;
    this.listeners = new Set();
    const existing = state?.get('bank.balance');
    this.balance = Number.isFinite(existing) && existing > 0 ? existing : (opts.starting ?? STARTING_BALANCE);
    this.history = state?.get('bank.history') || [];
    this._sync();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _sync() {
    this.state?.set('bank.balance', this.balance);
    this.state?.set('bank.history', this.history);
    for (const fn of this.listeners) fn(this.balance, this.history);
  }

  _entry(delta, reason, meta) {
    const e = { delta, reason, at: Date.now(), balance: this.balance, ...meta };
    this.history.push(e);
    if (this.history.length > 120) this.history.shift();
    return e;
  }

  canAfford(amount) { return this.balance >= Math.max(0, amount | 0); }

  credit(amount, reason = 'income', meta = {}) {
    const a = Math.max(0, Math.round(amount) || 0);
    if (!a) return null;
    this.balance += a;
    const e = this._entry(a, reason, meta);
    this._sync();
    return e;
  }

  /** Returns the ledger entry, or null when there is not enough money. */
  debit(amount, reason = 'expense', meta = {}) {
    const a = Math.max(0, Math.round(amount) || 0);
    if (a > this.balance) return null;
    this.balance -= a;
    const e = this._entry(-a, reason, meta);
    this._sync();
    return e;
  }

  /**
   * Settle a finished commission: fee in, late penalty and payroll out.
   * @returns {{ fee, penalty, payroll, net }}
   */
  settle({ constructionCost = 0, daysLate = 0, employees = [] } = {}) {
    const fee = feeFor(constructionCost);
    const penalty = latePenalty(fee, daysLate);
    let payroll = 0;
    for (const e of employees) payroll += SALARY[e.tier] ?? 0;
    if (fee) this.credit(fee, 'Commission fee', { constructionCost });
    if (penalty) this.debit(penalty, `Late delivery (${daysLate} d)`, { daysLate });
    if (payroll) this.debit(payroll, `Payroll (${employees.length})`, { payroll });
    return { fee, penalty, payroll, net: fee - penalty - payroll };
  }

  format(v = this.balance) {
    const n = Math.round(v);
    return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-GB').replace(/,/g, ' ');
  }
}
