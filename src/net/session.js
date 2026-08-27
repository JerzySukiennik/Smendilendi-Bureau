// Session — the one thing the rest of the game talks to about other people.
//
//   createSession({ mode:'local'|'online', code?, nick, color }) -> Session
//
// Single player and multiplayer are the SAME object with a different transport
// underneath. Employee bots get their own Session on the same office code, so a
// bot submitting a wall and a human submitting a wall are indistinguishable to
// everything above this file.
//
// Ordering and convergence
// ------------------------
// The op log is the truth and its order is the transport's order (RTDB push
// keys, which sort lexicographically by server time). Locally sent ops are
// applied optimistically so the editor never feels laggy, but they are held in
// a `pending` list and the authoritative model is rebuilt as
//     base (confirmed ops, in log order) + pending (ours, not yet confirmed)
// every time something is confirmed. Because `base` only ever sees the log in
// log order, and building.js's applyOp is deterministic, every client's `base`
// is byte-identical at the same seq — including ids minted by the model's own
// counter. Ids for objects a player creates are assigned here instead, from the
// player id, so a selection survives a rebase.
//
// Events (session.on(name, fn) -> unsubscribe):
//   'op'       { op, seq, local, echo, model, changed }
//   'players'  [ { id, nick, color, cursor, sel, lastSeen } ]
//   'chat'     { id, pid, text, at, history }
//   'lock'     { objId, pid }            // pid null = released
//   'snapshot' { model, seq }
//   'phase'    'lobby'|'brief'|'design'|'review'|'walkthrough'|...
//   'status'   { kind, online, warning }
//   'host'     { hostId, isHost }

import { applyOp, createModel, deserialize } from '../model/building.js';
import { createLocalTransport } from './local.js';
import { createRtdbTransport } from './rtdb.js';
import { generateCode, parseCode, playerIdFor } from './code.js';
import { normalizeNick, pickColor } from './presence.js';

/** Host writes /snapshot every this many confirmed ops (ARCHITECTURE.md). */
export const SNAPSHOT_EVERY = 50;

/** Ops that mint a new object id, and the prefix that id gets. */
const ID_PREFIX = {
  'wall.add': 'w',
  'opening.add': 'o',
  'slab.add': 's',
  'furniture.add': 'f',
  'text.add': 't',
};

/** Session-level control op, handled here rather than by building.js. */
export const SET_MODEL = 'session.setModel';

export function createSession(opts = {}) {
  return new Session(opts);
}

export class Session {
  constructor({
    mode = 'local',
    code = null,
    nick = 'Architect',
    color = null,
    playerId = null,
    model = null,
    bot = false,
    transport = null,
  } = {}) {
    this.mode = mode === 'online' ? 'online' : 'local';
    this.code = parseCode(code) ?? (code ? String(code).toUpperCase() : generateCode());
    this.playerId = playerId ?? (bot ? 'b' + generateCode(8).toLowerCase() : playerIdFor());
    this.nick = normalizeNick(nick);
    this.color = color ?? null;
    this.bot = bot;
    this.isHost = false;
    this.hostId = null;
    this.phase = 'lobby';
    this.players = [];
    this.locks = Object.create(null);       // objId -> pid
    this.chatLog = [];

    this.base = model ? deserialize(model) : createModel();
    this.model = this.base;
    this.lastSeq = null;
    this.confirmedCount = 0;
    this.pending = [];                      // ops sent, not yet echoed back
    this._appliedSeqs = new Set();          // log positions already applied — exactly once
    this._seenChat = new Set();
    this._cidCounter = 0;
    this._idCounter = 0;
    this._handlers = new Map();
    this._left = false;

    this.transport = transport ?? (this.mode === 'online'
      ? createRtdbTransport({ code: this.code, playerId: this.playerId, nick: this.nick, color: this.color, bot })
      : createLocalTransport({ code: this.code, playerId: this.playerId, nick: this.nick, color: this.color, bot }));

    this.id = `${this.code}:${this.playerId}`;
    this.ready = this._connect();
  }

  // -- events ---------------------------------------------------------------

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); }
      catch (err) { console.error(`[net] handler for '${event}' threw`, err); }
    }
  }

  // -- connection -----------------------------------------------------------

  async _connect() {
    // Yield once so the caller can attach handlers before the transport starts
    // replaying the log — the local transport replays synchronously.
    await null;
    const r = await this.transport.connect({
      onOp: (op, seq) => this._ingest(op, seq),
      onPlayers: list => { this.players = list; this.emit('players', list); },
      onChat: (msg, history = false) => {
        if (msg?.id != null) {
          if (this._seenChat.has(msg.id)) return;
          this._seenChat.add(msg.id);
          if (this._seenChat.size > 500) this._seenChat.delete(this._seenChat.values().next().value);
        }
        this.chatLog.push(msg);
        if (this.chatLog.length > 200) this.chatLog.shift();
        this.emit('chat', { ...msg, history });
      },
      onLock: (objId, pid) => {
        if (pid) this.locks[objId] = pid; else delete this.locks[objId];
        this.emit('lock', { objId, pid: pid ?? null });
      },
      onSnapshot: ({ model, seq }) => this._adoptSnapshot(model, seq),
      onPhase: phase => { if (phase && phase !== this.phase) { this.phase = phase; this.emit('phase', phase); } },
      onHost: hostId => {
        this.hostId = hostId ?? null;
        const was = this.isHost;
        this.isHost = hostId === this.playerId;
        if (was !== this.isHost || hostId) this.emit('host', { hostId: this.hostId, isHost: this.isHost });
      },
      onStatus: s => this.emit('status', s),
      // The transport noticed the log has outgrown its cap and wants the host
      // to compact it. Only the host can, and snapshot() already checks.
      onNeedSnapshot: () => this.snapshot(),
    });
    // Assign, never OR: a bot that opened the office and was then demoted by a
    // joining human must actually stop believing it is host, or two clients
    // compact the op log against two different snapshot points.
    this.isHost = this.hostId != null ? this.hostId === this.playerId : !!r?.isHost;
    this.kind = r?.kind ?? this.transport.kind;
    this.warning = r?.warning ?? null;
    if (!this.color) this.color = this.transport.color ?? pickColor(this.players.map(p => p.color));
    this.emit('status', { kind: this.kind, online: this.kind === 'rtdb', warning: this.warning });
    return this;
  }

  // -- ops ------------------------------------------------------------------

  /**
   * Submit an op. Applied locally first (optimistic), then appended to the log.
   * Returns the decorated op, whose `id` is the id the created object will have.
   */
  sendOp(op) {
    if (this._left) throw new Error('session has left');
    const full = this._decorate(op);
    // Apply BEFORE queueing. An op that throws (a malformed payload, an op type
    // this build does not know) must not enter `pending`, or every later ingest
    // re-runs the rebase, throws again, and the client's model freezes forever
    // while the log moves on without it.
    let r;
    try {
      r = this._applyTo(this.model, full);
    } catch (err) {
      console.warn('[net] refusing to send an op that does not apply', full.t, err?.message ?? err);
      return null;
    }
    this.pending.push(full);
    this.model = r.model;
    this.emit('op', { op: full, seq: null, local: true, echo: false, model: this.model, changed: r.changed });
    this.transport.sendOp(full);
    return full;
  }

  /** Convenience for bots and the commission generator. */
  sendOps(ops) { return ops.map(o => this.sendOp(o)); }

  _decorate(op) {
    const cid = `${this.playerId}:${++this._cidCounter}`;
    const out = stripUndefined({ ...op, by: this.playerId, cid, at: Date.now() });
    const prefix = ID_PREFIX[op.t];
    if (prefix && !out.id) out.id = `${prefix}_${this.playerId.slice(1, 7)}${++this._idCounter}`;
    return out;
  }

  _applyTo(model, op) {
    if (op.t === SET_MODEL) {
      return { model: cloneJson(deserialize(op.model)), changed: ['*'] };
    }
    return applyOp(model, op);
  }

  /** An op came back from the log — this is the authoritative order. */
  _ingest(op, seq) {
    // Exactly once. A transport may hand the same log position over twice (a
    // replay racing a fan-out, a re-armed listener after a snapshot); applying
    // a relative op such as wall.move a second time diverges this client from
    // its peers permanently and silently.
    const posKey = seq ?? (op.cid ? 'cid:' + op.cid : null);
    if (posKey != null) {
      if (this._appliedSeqs.has(posKey)) return;
      this._appliedSeqs.add(posKey);
      if (this._appliedSeqs.size > 4000) this._appliedSeqs.delete(this._appliedSeqs.values().next().value);
    }

    const own = !!op.cid && this.pending.some(p => p.cid === op.cid);
    const wasFirstPending = own && this.pending[0]?.cid === op.cid;

    // A bad op must not kill the delivery callback. Skip it, but still advance
    // the log position, so this client stays in step with peers that skipped it
    // too (applyOp is deterministic: they reject exactly what we reject).
    let r;
    try {
      r = this._applyTo(this.base, op);
    } catch (err) {
      console.warn('[net] skipping an op that does not apply', op?.t, err?.message ?? err);
      r = null;
    }
    if (r) this.base = r.model;
    this.lastSeq = seq;
    this.confirmedCount += 1;

    if (own) this.pending = this.pending.filter(p => p.cid !== op.cid);

    let changed = r ? r.changed : [];
    if (this.pending.length) {
      let m = this.base;
      const survivors = [];
      for (const p of this.pending) {
        try {
          const rr = this._applyTo(m, p);
          m = rr.model;
          changed = changed.concat(rr.changed);
          survivors.push(p);
        } catch (err) {
          // It applied once against an older base and no longer does — the
          // object it touched was deleted under us. Drop it rather than wedge
          // the client; the log is the truth and it never reached the log.
          console.warn('[net] dropping a pending op that no longer applies', p?.t, err?.message ?? err);
        }
      }
      this.pending = survivors;
      this.model = m;
    } else {
      this.model = this.base;
    }

    // Our own op arriving in the position we assumed changes nothing on screen:
    // base+[p1,p2,p3] and (base+p1)+[p2,p3] are the same op sequence.
    if (!(own && wasFirstPending)) {
      this.emit('op', {
        op, seq, local: own, echo: own, model: this.model, changed: dedupe(changed),
      });
    }

    this._maybeSnapshot();
  }

  _adoptSnapshot(model, seq) {
    this.base = cloneJson(deserialize(model));
    this.lastSeq = seq ?? this.lastSeq;
    // The 50-op cadence counts ops since the last compaction point, not since
    // the tab opened — otherwise the host's snapshots drift off the boundary.
    this.confirmedCount = 0;
    let m = this.base;
    const survivors = [];
    for (const p of this.pending) {
      try { m = this._applyTo(m, p).model; survivors.push(p); }
      catch (err) { console.warn('[net] dropping a pending op after snapshot', p?.t, err?.message ?? err); }
    }
    this.pending = survivors;
    this.model = m;
    this.emit('snapshot', { model: this.model, seq: this.lastSeq });
  }

  _maybeSnapshot() {
    if (!this.isHost) return;
    if (this.confirmedCount % SNAPSHOT_EVERY !== 0) return;
    this.snapshot(this.base);
  }

  /**
   * Replace the whole model — a new commission, or an undo of everything.
   * Host-driven; it travels as an entry in the op log so late joiners and
   * everyone already in the office end up on the same model.
   */
  setModel(model) {
    // Deep copy: deserialize is the identity for a live object, and handing the
    // log a reference to something the caller still mutates aliases the model
    // into the transport's own storage.
    return this.sendOp({ t: SET_MODEL, model: cloneJson(deserialize(model)) });
  }

  /** Host only. Write the compacting snapshot. Safe to call on a client (no-op). */
  snapshot(model = this.base) {
    if (!this.isHost) return null;
    return this.transport.writeSnapshot(model, this.lastSeq);
  }

  // -- people ---------------------------------------------------------------

  setCursor(cursor) { this.transport.setCursor(cursor); }

  /** Grab lock. Resolves true when this player owns the object. */
  async lock(objId) {
    const won = await this.transport.lock(objId);
    if (won) this.locks[objId] = this.playerId;
    return won;
  }

  unlock(objId) {
    if (this.locks[objId] === this.playerId) delete this.locks[objId];
    this.transport.unlock(objId);
  }

  /** Who holds this object, or null. */
  lockedBy(objId) { return this.locks[objId] ?? null; }

  /** True when someone ELSE holds it — the editor's "hands off" test. */
  isLockedByOther(objId) {
    const p = this.locks[objId];
    return !!p && p !== this.playerId;
  }

  chat(text) {
    const t = String(text ?? '').trim().slice(0, 240);
    if (!t) return null;
    return this.transport.chat(t);
  }

  setPhase(phase) {
    this.phase = phase;
    this.transport.setPhase(phase);
    this.emit('phase', phase);
  }

  player(id = this.playerId) { return this.players.find(p => p.id === id) ?? null; }

  leave() {
    if (this._left) return;
    this._left = true;
    try { this.transport.leave(); } catch (err) { console.warn('[net] leave', err); }
    this._handlers.clear();
  }
}

function dedupe(arr) { return [...new Set(arr)]; }

function cloneJson(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/** RTDB rejects undefined. Drop those keys before anything goes on the wire. */
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export { generateCode, parseCode, formatCode, validateCode, codeError } from './code.js';
export { PLAYER_COLORS, LOCK_TTL_MS, PLAYER_TTL_MS } from './presence.js';
