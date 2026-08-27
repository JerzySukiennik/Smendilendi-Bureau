// Presence — who is in the office, where their cursor is, and which of them
// have gone away without saying goodbye.
//
// Transport-agnostic on purpose: the local transport and the RTDB transport
// both keep their player map in one of these, so the rules for "stale" and the
// colour assignment are identical in single player and multiplayer.
//
// No browser-only APIs. Runs in bare node.

/** How often a live client rewrites its own lastSeen. */
export const HEARTBEAT_MS = 5000;
/** A player unseen for this long is considered gone and reaped by the host. */
export const PLAYER_TTL_MS = 20000;
/** A grab lock older than this is fair game — the holder's tab probably died. */
export const LOCK_TTL_MS = 15000;
/** How often the reaper runs. */
export const SWEEP_MS = 5000;

/**
 * Player colours. Warm, limited, and separated in hue so two cursors are never
 * confusable at a glance, which is the whole point of a coloured cursor.
 * Max 3 players per office (DESIGN-DECISIONS), the rest are spares for bots.
 */
export const PLAYER_COLORS = [
  '#e2725b',   // terracotta
  '#3f8f7c',   // verdigris
  '#e0a458',   // ochre
  '#5b6ee1',   // indigo
  '#b4656f',   // rose
  '#7a9a5b',   // olive
];

export function pickColor(taken = []) {
  const used = new Set(taken.filter(Boolean).map(c => String(c).toLowerCase()));
  for (const c of PLAYER_COLORS) if (!used.has(c)) return c;
  return PLAYER_COLORS[used.size % PLAYER_COLORS.length];
}

/** Trim a nick to something that fits a 3D desk nameplate. */
export function normalizeNick(nick, fallback = 'Architect') {
  const s = String(nick ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length ? s : fallback;
}

export function makePlayer({ id, nick, color, isHost = false, bot = false, now = Date.now() }) {
  return {
    id,
    nick: normalizeNick(nick),
    color: color || PLAYER_COLORS[0],
    isHost,
    bot,
    cursor: null,        // { mode, x, y, z }
    sel: [],             // selected object ids
    lastSeen: now,
  };
}

/**
 * The players map plus the two timers that keep it honest.
 *
 *   onHeartbeat()            — write our own lastSeen (transport supplies it)
 *   onReap(ids)              — these players are gone; drop their records
 *   onChange(players)        — the map changed, tell the session
 */
export class Presence {
  constructor({ selfId, onChange = null, onHeartbeat = null, onReap = null,
                ttl = PLAYER_TTL_MS, heartbeat = HEARTBEAT_MS, sweep = SWEEP_MS,
                reap = true, now = () => Date.now() } = {}) {
    this.selfId = selfId;
    this.players = Object.create(null);
    this.ttl = ttl;
    // When false, start() installs no sweep timer: somebody else (the local
    // hub, or the RTDB host) owns liveness and this map is a read-only mirror.
    // Reaping from a mirror deletes players who are perfectly alive, because a
    // mirror's lastSeen only advances when the owner happens to fan out.
    this.reapEnabled = reap !== false;
    this.heartbeatMs = heartbeat;
    this.sweepMs = sweep;
    this.now = now;
    this.onChange = onChange;
    this.onHeartbeat = onHeartbeat;
    this.onReap = onReap;
    this._timers = [];
    this._running = false;
  }

  /** Snapshot of the map as a plain object, safe to hand to the UI. */
  list() {
    return Object.values(this.players).sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id) { return this.players[id] ?? null; }
  get self() { return this.players[this.selfId] ?? null; }
  get count() { return Object.keys(this.players).length; }

  /** Insert or merge a player record. Returns true when anything changed. */
  upsert(id, data = {}) {
    const prev = this.players[id];
    const next = prev
      ? { ...prev, ...data, id }
      : makePlayer({ id, nick: data.nick, color: data.color, isHost: !!data.isHost, bot: !!data.bot, now: this.now() });
    if (data.nick !== undefined) next.nick = normalizeNick(data.nick);
    if (!next.color) next.color = pickColor(this.list().map(p => p.color));
    if (prev && shallowEqual(prev, next)) return false;
    this.players[id] = next;
    this._changed();
    return true;
  }

  remove(id) {
    if (!this.players[id]) return false;
    delete this.players[id];
    this._changed();
    return true;
  }

  /** Wholesale replace, used when RTDB hands us the whole /players node. */
  replaceAll(map) {
    this.players = Object.create(null);
    for (const [id, p] of Object.entries(map ?? {})) {
      this.players[id] = { ...makePlayer({ id, nick: p.nick, color: p.color, now: this.now() }), ...p, id };
    }
    this._changed();
  }

  touch(id = this.selfId, at = this.now()) {
    const p = this.players[id];
    if (!p) return;
    p.lastSeen = at;
  }

  /**
   * Drop everyone unseen for longer than the TTL. Never reaps ourselves (our
   * own clock is the one thing we can trust) and never reaps bots, which have
   * no heartbeat of their own — their employer's session owns them.
   */
  reap(at = this.now()) {
    const dead = [];
    for (const p of Object.values(this.players)) {
      if (p.id === this.selfId || p.bot) continue;
      if (at - (p.lastSeen ?? 0) > this.ttl) dead.push(p.id);
    }
    if (!dead.length) return dead;
    for (const id of dead) delete this.players[id];
    this._changed();
    if (this.onReap) this.onReap(dead);
    return dead;
  }

  start() {
    if (this._running) return;
    this._running = true;
    if (this.onHeartbeat) {
      const t = setInterval(() => { this.touch(); this.onHeartbeat(); }, this.heartbeatMs);
      if (t.unref) t.unref();
      this._timers.push(t);
    }
    if (this.reapEnabled) {
      const s = setInterval(() => this.reap(), this.sweepMs);
      if (s.unref) s.unref();
      this._timers.push(s);
    }
  }

  stop() {
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    this._running = false;
  }

  _changed() {
    if (this.onChange) this.onChange(this.list());
  }
}

/** Locks that expire, shared by both transports. */
export class LockTable {
  constructor({ ttl = LOCK_TTL_MS, now = () => Date.now() } = {}) {
    this.locks = Object.create(null);
    this.ttl = ttl;
    this.now = now;
  }

  holder(objId, at = this.now()) {
    const l = this.locks[objId];
    if (!l) return null;
    if (at - l.at > this.ttl) { delete this.locks[objId]; return null; }
    return l.pid;
  }

  /** Take the lock for pid, unless somebody else holds a live one. */
  tryLock(objId, pid, at = this.now()) {
    const h = this.holder(objId, at);
    if (h && h !== pid) return false;
    this.locks[objId] = { pid, at };
    return true;
  }

  release(objId, pid) {
    const l = this.locks[objId];
    if (!l) return false;
    if (pid && l.pid !== pid) return false;
    delete this.locks[objId];
    return true;
  }

  /** Everything held by a player who has left. */
  releaseAllBy(pid) {
    const freed = [];
    for (const [objId, l] of Object.entries(this.locks)) {
      if (l.pid === pid) { delete this.locks[objId]; freed.push(objId); }
    }
    return freed;
  }

  /** Expired locks, dropped. Returns the object ids that became free. */
  sweep(at = this.now()) {
    const freed = [];
    for (const [objId, l] of Object.entries(this.locks)) {
      if (at - l.at > this.ttl) { delete this.locks[objId]; freed.push(objId); }
    }
    return freed;
  }
}

function shallowEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k], vb = b[k];
    if (va === vb) continue;
    if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length && va.every((v, i) => v === vb[i])) continue;
    if (va && vb && typeof va === 'object' && typeof vb === 'object' && JSON.stringify(va) === JSON.stringify(vb)) continue;
    return false;
  }
  return true;
}
