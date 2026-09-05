// LocalTransport — the whole session protocol with no network at all.
//
// Single player runs this. It is not a stub: it implements the same ordered
// op log, the same grab locks with the same TTL, the same presence map and the
// same late-joiner snapshot replay as the RTDB transport, so everything above
// src/net/session.js runs one code path. Employee bots are extra participants
// in the same in-process hub, which is why they can contend for a lock with
// the player and lose.
//
// Delivery-exactly-once
// ---------------------
// Hub events are fanned out on a microtask, but a client's log replay happens
// inside connect(). Those two windows overlap: an op pushed after the joining
// client entered hub.clients but before its replay ran would otherwise arrive
// twice — once from the replay, once from the queued fan-out — and a relative
// op (wall.move dx) applied twice diverges that client permanently. Every
// client therefore keeps a replay watermark (the highest log key it has
// already been handed) and drops any fanned-out op at or below it. Chat is
// deduped by id for the same reason.
//
// Liveness
// --------
// The HUB owns liveness, not the clients. A client's Presence is a read-only
// mirror refreshed on every roster fan-out; if it ran its own reaper it would
// delete peers whose mirrored lastSeen simply had not been refreshed yet.
//
// No browser-only APIs. Runs in bare node.

import { generateCode } from './code.js';
import {
  LockTable, Presence, pickColor, normalizeNick,
  LOCK_TTL_MS, PLAYER_TTL_MS, SWEEP_MS,
} from './presence.js';

/** Every hub alive in this tab/process, keyed by office code. */
const HUBS = new Map();

/** Op keys must sort lexicographically like RTDB push keys do. */
function seqKey(n) { return 'L' + String(n).padStart(9, '0'); }

/** Same cap as /ops in RTDB: the log is a transport, the snapshot is the archive. */
export const OPS_CAP = 500;

/**
 * The in-process stand-in for the RTDB office node. Owns the op log, the
 * snapshot, the locks, the chat and the player records, exactly as
 * /smendilendi/<code> does.
 */
export class LocalHub {
  constructor(code) {
    this.code = code;
    this.meta = { createdAt: Date.now(), host: null, phase: 'lobby' };
    this.ops = [];                       // [{ key, op }]
    this.seq = 0;
    this.chatSeq = 0;                    // never resets — ids stay unique past the cap
    this.snapshot = null;                // { model, seq }
    this.chat = [];
    this.locks = new LockTable({ ttl: LOCK_TTL_MS });
    this.players = Object.create(null);
    this.clients = new Set();
    this._queue = [];
    this._flushing = false;
    this._reaper = null;
  }

  join(client) {
    this.clients.add(client);
    const prevHost = this.meta.host;
    const host = this.meta.host ? this.players[this.meta.host] : null;
    // A bot is never host while a human is in the room: the host writes the
    // snapshots and owns the phase, and a bot outlives nobody.
    if (!host || (host.bot && !client.bot)) this.meta.host = client.playerId;
    // Tell the DEMOTED client it is no longer host. Without this both the bot
    // and the human believe they are host and both compact the op log.
    if (this.meta.host !== prevHost) this._emit('onHost', this.meta.host);
    this._startReaper();
  }

  leave(client) {
    this.clients.delete(client);
    this._dropPlayer(client.playerId);
    if (!this.clients.size) {
      this._stopReaper();
      HUBS.delete(this.code);
    }
  }

  /** Remove one player record and repair host/locks. Shared by leave + reap. */
  _dropPlayer(pid) {
    delete this.players[pid];
    const freed = this.locks.releaseAllBy(pid);
    for (const objId of freed) this._emit('onLock', objId, null);
    if (this.meta.host === pid) {
      const all = Object.keys(this.players).sort();
      const humans = all.filter(id => !this.players[id].bot);
      this.meta.host = humans[0] ?? all[0] ?? null;
      this._emit('onHost', this.meta.host);
    }
    this._emit('onPlayers', this.playerList());
  }

  /**
   * One reaper for the whole office. Bots have no heartbeat of their own (their
   * employer's session owns them) and a client that is still in this.clients is
   * by definition alive, so only orphaned records go.
   */
  _startReaper() {
    if (this._reaper) return;
    this._reaper = setInterval(() => this.reap(), SWEEP_MS);
    if (this._reaper.unref) this._reaper.unref();
  }

  _stopReaper() {
    if (this._reaper) clearInterval(this._reaper);
    this._reaper = null;
  }

  reap(at = Date.now()) {
    const live = new Set([...this.clients].map(c => c.playerId));
    const dead = [];
    for (const p of Object.values(this.players)) {
      if (p.bot || live.has(p.id)) continue;
      if (at - (p.lastSeen ?? 0) > PLAYER_TTL_MS) dead.push(p.id);
    }
    for (const id of dead) this._dropPlayer(id);
    return dead;
  }

  playerList() {
    return Object.values(this.players).sort((a, b) => a.id.localeCompare(b.id)).map(p => ({ ...p }));
  }

  pushOp(op) {
    this.seq += 1;
    const key = seqKey(this.seq);
    this.ops.push({ key, op });
    if (this.ops.length > OPS_CAP && this.snapshot?.seq) {
      this.ops = this.ops.filter(e => e.key > this.snapshot.seq);
    }
    this._emit('onOp', op, key);
    return key;
  }

  /**
   * Compacting snapshot. REFUSES to go backwards: a client that still believes
   * it is host must not replace a newer snapshot with an older one, because the
   * trim below then deletes ops that exist nowhere else.
   */
  writeSnapshot(model, seq) {
    const at = seq ?? (this.ops.at(-1)?.key ?? null);
    const cur = this.snapshot;
    if (cur && cur.seq && (!at || at <= cur.seq)) return cur;      // stale writer
    this.snapshot = { model: JSON.parse(JSON.stringify(model)), seq: at };
    // Trimming the log is what the snapshot is FOR — same rule as rtdb.js,
    // which deletes every op key strictly before the snapshot's seq.
    if (at) this.ops = this.ops.filter(e => e.key > at);
    return this.snapshot;
  }

  pushChat({ pid, text, at }) {
    const msg = { id: 'c' + (++this.chatSeq), pid, text, at: at ?? Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this._emit('onChat', msg);
    return msg;
  }

  setPhase(phase) {
    this.meta.phase = phase;
    this._emit('onPhase', phase);
  }

  /**
   * Deliveries are queued and flushed on a microtask, like a real socket, so
   * nothing above this layer can accidentally depend on synchronous delivery
   * that RTDB would never give it. Order is preserved across the flush.
   */
  _emit(handler, ...args) {
    this._queue.push([handler, args]);
    this._schedule();
  }

  _schedule() {
    if (this._flushing) return;
    this._flushing = true;
    queueMicrotask(() => {
      this._flushing = false;
      const q = this._queue;
      this._queue = [];
      for (const [name, a] of q) {
        for (const client of [...this.clients]) client._deliver(name, a);
      }
      if (this._queue.length) this._schedule();
    });
  }
}

export function getLocalHub(code) {
  let hub = HUBS.get(code);
  if (!hub) { hub = new LocalHub(code); HUBS.set(code, hub); }
  return hub;
}

/** Test/debug helper — forget every hub in this process. */
export function resetLocalHubs() {
  for (const hub of HUBS.values()) hub._stopReaper();
  HUBS.clear();
}

export function createLocalTransport(opts = {}) {
  return new LocalTransport(opts);
}

export class LocalTransport {
  constructor({ code, playerId, nick, color, bot = false } = {}) {
    this.kind = 'local';
    this.code = code || generateCode();
    this.playerId = playerId;
    this.nick = normalizeNick(nick);
    this.color = color || null;
    this.bot = bot;
    this.isHost = false;
    this.online = false;
    this.hub = null;
    this.handlers = {};
    this.presence = null;
    this._cursorTimer = null;
    this._sweep = null;
    this._replayHigh = null;             // highest op key already handed over
    this._seenChat = new Set();          // chat ids already handed over
    this._left = false;
  }

  async connect(handlers = {}) {
    this.handlers = handlers;
    const hub = this.hub = getLocalHub(this.code);
    hub.join(this);

    this.color = this.color || pickColor(hub.playerList().map(p => p.color));
    hub.players[this.playerId] = {
      id: this.playerId,
      nick: this.nick,
      color: this.color,
      bot: this.bot,
      cursor: null,
      sel: [],
      lastSeen: Date.now(),
    };
    this.isHost = hub.meta.host === this.playerId;

    // Read-only mirror: the hub owns liveness (reap:false), we only keep our
    // own lastSeen fresh in the hub's record.
    this.presence = new Presence({
      selfId: this.playerId,
      reap: false,
      onHeartbeat: () => { const p = this.hub?.players[this.playerId]; if (p) p.lastSeen = Date.now(); },
    });
    this.presence.replaceAll(Object.fromEntries(hub.playerList().map(p => [p.id, p])));
    this.presence.start();

    this._sweep = setInterval(() => {
      const freed = hub.locks.sweep();
      for (const objId of freed) hub._emit('onLock', objId, null);
    }, 5000);
    if (this._sweep.unref) this._sweep.unref();

    // Late joiner: snapshot first, then only the ops recorded after it.
    // Synchronous here so the caller's session is current the moment connect
    // resolves; the watermark stops the queued fan-out repeating any of it.
    if (hub.snapshot && handlers.onSnapshot) {
      handlers.onSnapshot({ model: JSON.parse(JSON.stringify(hub.snapshot.model)), seq: hub.snapshot.seq });
    }
    const from = hub.snapshot?.seq ?? null;
    this._replayHigh = from;
    for (const e of hub.ops) {
      if (from && e.key <= from) continue;
      this._replayHigh = e.key;
      handlers.onOp?.(e.op, e.key);
    }
    for (const m of hub.chat) {
      this._seenChat.add(m.id);
      handlers.onChat?.(m, true);
    }
    handlers.onPhase?.(hub.meta.phase);
    handlers.onHost?.(hub.meta.host);
    handlers.onPlayers?.(hub.playerList());
    for (const [objId, l] of Object.entries(hub.locks.locks)) handlers.onLock?.(objId, l.pid);

    this.online = true;
    hub._emit('onPlayers', hub.playerList());
    return { isHost: this.isHost, code: this.code, kind: this.kind };
  }

  sendOp(op) {
    if (!this.hub) return null;
    return this.hub.pushOp(op);
  }

  setOffice(patch) {
    if (!this.hub) return;
    this.hub.office = { ...(this.hub.office || {}), ...patch };
    this.hub._emit('onOffice', { ...this.hub.office });
  }

  setCursor(cursor) {
    const p = this.hub?.players[this.playerId];
    if (!p) return;
      // `ry` rides with the cursor so the office can place a remote player
      // FACING the right way. It goes inside `cursor` on purpose: the database
      // rule for a player record is `$other: false`, so a new sibling field
      // would be rejected outright, while `cursor` is validated only as
      // "has children". Editor cursors simply never set it.
    p.cursor = cursor && { mode: cursor.mode ?? null, x: cursor.x ?? 0, y: cursor.y ?? 0, z: cursor.z ?? 0,
      ...(Number.isFinite(cursor.ry) ? { ry: cursor.ry } : {}),
      ...(cursor.hold ? { hold: String(cursor.hold).slice(0, 16) } : {}) };
    p.sel = cursor?.sel ?? p.sel;
    p.lastSeen = Date.now();
    this.hub._emit('onPlayers', this.hub.playerList());
  }

  async lock(objId) {
    if (!this.hub) return true;
    const won = this.hub.locks.tryLock(objId, this.playerId);
    if (won) this.hub._emit('onLock', objId, this.playerId);
    return won;
  }

  unlock(objId) {
    if (!this.hub) return;
    if (this.hub.locks.release(objId, this.playerId)) this.hub._emit('onLock', objId, null);
  }

  chat(text) {
    if (!this.hub) return null;
    return this.hub.pushChat({ pid: this.playerId, text, at: Date.now() });
  }

  setPhase(phase) { this.hub?.setPhase(phase); }

  writeSnapshot(model, seq) { return this.hub?.writeSnapshot(model, seq) ?? null; }

  leave() {
    if (this._left) return;
    this._left = true;
    this.presence?.stop();
    if (this._sweep) clearInterval(this._sweep);
    this._sweep = null;
    this.online = false;
    this.hub?.leave(this);
    this.hub = null;
  }

  /** Called by the hub. Fans a hub event out to the session's handlers. */
  _deliver(name, args) {
    if (this._left) return;
    if (name === 'onOp') {
      const key = args[1];
      // Already handed over by the replay inside connect(): dropping it here is
      // what keeps a relative op from being applied twice.
      if (this._replayHigh && key <= this._replayHigh) return;
      this._replayHigh = key;
    } else if (name === 'onChat') {
      const id = args[0]?.id;
      if (id != null) {
        if (this._seenChat.has(id)) return;
        this._seenChat.add(id);
        if (this._seenChat.size > 500) this._seenChat.delete(this._seenChat.values().next().value);
      }
    } else if (name === 'onPlayers') {
      // Refresh the mirror so peers' lastSeen tracks the hub, not connect time.
      const list = args[0] ?? [];
      this.presence?.replaceAll(Object.fromEntries(list.map(p => [p.id, p])));
    } else if (name === 'onHost') {
      this.isHost = args[0] === this.playerId;
    }
    const fn = this.handlers[name];
    if (typeof fn === 'function') fn(...args);
  }
}
