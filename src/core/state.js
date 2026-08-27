// Observable session store. No dependencies, works in bare node.
// Paths are dot-separated: 'office.bank', 'players.p1.nick'.

function splitPath(path) {
  return path === '' ? [] : path.split('.');
}

function getIn(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setIn(obj, parts, value) {
  if (parts.length === 0) throw new Error('state.set needs a non-empty path');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  const prev = cur[last];
  cur[last] = value;
  return prev;
}

export class State {
  constructor(initial = {}) {
    this.data = initial;
    this._subs = new Map(); // path -> Set<fn>
  }

  get(path) {
    return path === undefined ? this.data : getIn(this.data, splitPath(path));
  }

  set(path, value) {
    const prev = setIn(this.data, splitPath(path), value);
    if (prev !== value) this._notify(path, value, prev);
    return value;
  }

  /** Shallow merge of a flat object of path -> value. */
  patch(obj) {
    for (const [path, value] of Object.entries(obj)) this.set(path, value);
  }

  /**
   * Subscribe to a path. Fires when that exact path changes, and also when any
   * ancestor or descendant of it changes (prefix matching in both directions),
   * so on('office') hears office.bank and on('office.bank') hears a whole-office
   * replacement.
   * Returns an unsubscribe function.
   */
  on(path, fn) {
    if (!this._subs.has(path)) this._subs.set(path, new Set());
    this._subs.get(path).add(fn);
    return () => {
      const set = this._subs.get(path);
      if (!set) return;
      set.delete(fn);
      if (set.size === 0) this._subs.delete(path);
    };
  }

  /** Fire every subscriber once with the current value. */
  emit(path) {
    this._notify(path, this.get(path), undefined);
  }

  _notify(changedPath, value, prev) {
    for (const [subPath, fns] of this._subs) {
      if (!pathTouches(subPath, changedPath)) continue;
      const v = subPath === changedPath ? value : this.get(subPath);
      for (const fn of fns) fn(v, prev, changedPath);
    }
  }
}

/** True when a change at `changed` is relevant to a subscriber watching `sub`. */
export function pathTouches(sub, changed) {
  if (sub === changed || sub === '') return true;
  return changed.startsWith(sub + '.') || sub.startsWith(changed + '.');
}

/** Structural clone good enough for plain JSON-ish state. */
export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k in v) out[k] = clone(v[k]);
  return out;
}

export function createState() {
  return new State({
    mode: 'boot',
    session: { code: null, host: false, playerId: null },
    players: {},
    office: { tier: 1, computerTier: 1, desks: [], employees: [] },
    bank: { balance: 0, history: [] },
    commission: null,
    model: null,
    analysis: null,
    mail: { messages: [], unread: 0 },
    chat: { messages: [] },
  });
}
