// RtdbTransport — the same session protocol over Firebase Realtime Database.
//
// No auth (Spark plan, no anonymous auth): identity is the random id in
// localStorage and access is the 8-character office code. Path layout is fixed
// by ARCHITECTURE.md:
//
//   /smendilendi/<code>/meta        { createdAt, host, phase }
//   /smendilendi/<code>/players/<pid> { nick, color, cursor:{mode,x,y,z}, sel:[], lastSeen }
//   /smendilendi/<code>/ops/<pushKey> Op          // append-only; trimmed to the
//                                                 // snapshot point once it passes
//                                                 // OPS_CAP entries (see below)
//   /smendilendi/<code>/snapshot    { model, seq } // host, every 50 ops
//   /smendilendi/<code>/locks/<objId> { pid, at }  // grab lock, 15 s TTL
//   /smendilendi/<code>/chat/<id>   { pid, text, at }
//
// The Firebase SDK is imported dynamically from the CDN, so this module itself
// imports cleanly in bare node (where the https import fails, is caught, and
// the transport degrades to LocalTransport with one warning).

import { FIREBASE_CONFIG, FIREBASE_SDK, DB_ROOT, isPlaceholderConfig } from './firebase-config.js';
import { createLocalTransport } from './local.js';
import { Presence, LOCK_TTL_MS, PLAYER_TTL_MS, pickColor, normalizeNick } from './presence.js';

/**
 * Hard cap on /ops. The host normally compacts every SNAPSHOT_EVERY (50) ops,
 * but if nobody has compacted for this long — a host that froze, an office that
 * only bots are writing to — any client asks the session to compact, and the
 * session obliges if it is (or has just become) the host. Without this the log
 * grows without bound and every later joiner replays all of it.
 */
export const OPS_CAP = 500;

let sdkPromise = null;

/** Load firebase-app + firebase-database from the CDN exactly once. */
export async function loadFirebase() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const [app, db] = await Promise.all([
        import(/* @vite-ignore */ FIREBASE_SDK.app),
        import(/* @vite-ignore */ FIREBASE_SDK.database),
      ]);
      return { ...app, ...db };
    })().catch(err => { sdkPromise = null; throw err; });
  }
  return sdkPromise;
}

export function createRtdbTransport(opts = {}) {
  return new RtdbTransport(opts);
}

export class RtdbTransport {
  constructor({ code, playerId, nick, color, bot = false, config = FIREBASE_CONFIG } = {}) {
    this.kind = 'rtdb';
    this.code = code;
    this.playerId = playerId;
    this.nick = normalizeNick(nick);
    this.color = color || null;
    this.bot = bot;
    this.config = config;
    this.isHost = false;
    this.online = false;
    this.fallback = null;          // a LocalTransport if we could not get online
    this.warning = null;
    this.handlers = {};
    this._unsubs = [];
    this._clockOffset = 0;
    this._cursorPending = null;
    this._cursorTimer = null;
    this._opCount = 0;
    this._lastSeq = null;
    this._snapSeq = null;
    this._opsUnsub = null;
    this._dead = false;
  }

  now() { return Date.now() + this._clockOffset; }

  /** Everything that can go wrong here ends in local mode, never in a throw. */
  async connect(handlers = {}) {
    this.handlers = handlers;
    if (isPlaceholderConfig(this.config)) {
      return this._degrade('src/net/firebase-config.js still holds REPLACE_ME placeholders');
    }
    try {
      const fb = this.fb = await loadFirebase();
      this.app = fb.initializeApp(this.config, 'smendilendi-' + this.code);
      this.db = fb.getDatabase(this.app);
      await this._wire();
      this.online = true;
      return { isHost: this.isHost, code: this.code, kind: this.kind };
    } catch (err) {
      return this._degrade(err && err.message ? err.message : String(err));
    }
  }

  async _degrade(reason) {
    // Tear the half-built RTDB side down FIRST. _wire installs listeners and
    // starts the heartbeat before the awaits that can reject; leaving them
    // running would feed this session two unrelated op/seq spaces at once and
    // keep writing presence from a session that reports itself offline.
    this._teardownRtdb();
    this.warning = reason;
    console.warn(`[net] multiplayer unavailable (${reason}) — running this office locally. ` +
                 'Other players will not see it.');
    this.kind = 'local-fallback';
    this.fallback = createLocalTransport({
      code: this.code, playerId: this.playerId, nick: this.nick, color: this.color, bot: this.bot,
    });
    const r = await this.fallback.connect(this.handlers);
    this.isHost = this.fallback.isHost;
    this.online = false;
    this.handlers.onStatus?.({ kind: this.kind, online: false, warning: reason });
    return { ...r, kind: this.kind, warning: reason };
  }

  /** Drop every live RTDB listener, timer and heartbeat. Safe to call twice. */
  _teardownRtdb() {
    this._dead = true;
    for (const off of this._unsubs) { try { off(); } catch { /* already gone */ } }
    this._unsubs = [];
    if (this._opsUnsub) { try { this._opsUnsub(); } catch { /* already gone */ } }
    this._opsUnsub = null;
    try { this.presence?.stop(); } catch { /* nothing to stop */ }
    this.presence = null;
    if (this._cursorTimer) clearTimeout(this._cursorTimer);
    this._cursorTimer = null;
    this._cursorPending = null;
  }

  // -------------------------------------------------------------------------

  async _wire() {
    const fb = this.fb;
    const { ref, get, set, update, remove, onValue, onChildAdded, onDisconnect,
            runTransaction, query, orderByKey, startAfter, limitToLast } = fb;
    const root = `${DB_ROOT}/${this.code}`;
    this.paths = {
      meta: `${root}/meta`,
      players: `${root}/players`,
      me: `${root}/players/${this.playerId}`,
      ops: `${root}/ops`,
      snapshot: `${root}/snapshot`,
      locks: `${root}/locks`,
      chat: `${root}/chat`,
    };

    // clock skew — locks and heartbeats compare timestamps written by
    // different machines, so use the server's idea of "now", not the tab's.
    try {
      const off = await get(ref(this.db, '.info/serverTimeOffset'));
      this._clockOffset = off.val() ?? 0;
    } catch { this._clockOffset = 0; }

    // --- meta / host election ------------------------------------------
    // Host election. A transaction, so three clients opening the same code at
    // once still end up with exactly one host. A bot never takes the office
    // over from a human — it only claims an office nobody has opened yet.
    await runTransaction(ref(this.db, this.paths.meta), cur => {
      if (cur === null) return { createdAt: this.now(), host: this.playerId, phase: 'lobby' };
      if (!cur.host && !this.bot) return { ...cur, host: this.playerId };
      return cur;                                   // leave it alone
    });
    this._unsubs.push(onValue(ref(this.db, this.paths.meta), snap => {
      if (this._dead) return;
      const meta = snap.val() ?? {};
      this.isHost = meta.host === this.playerId;
      this.handlers.onHost?.(meta.host ?? null);
      if (meta.phase) this.handlers.onPhase?.(meta.phase);
      // The host left and onDisconnect took its player record with it, or its
      // record is still there but has gone stale: the lowest-id live human
      // promotes itself. Waiting for the host to reap the host never happens.
      if (!this.isHost && meta.host && !this._isLive(meta.host)) this._claimHost();
    }));

    // --- presence -------------------------------------------------------
    const existing = await get(ref(this.db, this.paths.players));
    const takenColors = Object.values(existing.val() ?? {}).map(p => p && p.color);
    this.color = this.color || pickColor(takenColors);
    const me = { nick: this.nick, color: this.color, bot: this.bot, cursor: null, sel: [], lastSeen: this.now() };
    await set(ref(this.db, this.paths.me), me);
    onDisconnect(ref(this.db, this.paths.me)).remove();

    this.presence = new Presence({
      selfId: this.playerId,
      now: () => this.now(),
      onHeartbeat: () => { update(ref(this.db, this.paths.me), { lastSeen: this.now() }).catch(() => {}); },
      onReap: ids => {
        // The host prunes; but if the HOST is the stale one, nobody would ever
        // prune it, so the lowest-id live human prunes too. remove() is
        // idempotent, so the rare double-delete is harmless.
        if (!this.isHost && this._lowestLiveHuman() !== this.playerId) return;
        for (const id of ids) remove(ref(this.db, `${this.paths.players}/${id}`)).catch(() => {});
      },
    });
    this.presence.start();

    this._unsubs.push(onValue(ref(this.db, this.paths.players), snap => {
      if (this._dead) return;
      this.presence.replaceAll(snap.val() ?? {});
      this.handlers.onPlayers?.(this.presence.list());
    }));

    // --- late joiner: snapshot, then the ops recorded after it -----------
    const snapSnap = await get(ref(this.db, this.paths.snapshot));
    const snapshot = snapSnap.val();
    if (snapshot && snapshot.model) {
      this._lastSeq = snapshot.seq ?? null;
      this._snapSeq = this._lastSeq;
      this.handlers.onSnapshot?.({ model: snapshot.model, seq: snapshot.seq ?? null });
    }
    this._armOps(this._lastSeq);

    // Keep watching /snapshot. If we drop off the network while the host
    // compacts, the ops we missed are DELETED on the server and our
    // onChildAdded query would silently resume past the hole. Re-adopting the
    // newer snapshot and re-arming the ops query from it is the only recovery.
    this._unsubs.push(onValue(ref(this.db, this.paths.snapshot), s => {
      if (this._dead) return;
      const v = s.val();
      if (!v || !v.model) return;
      const seq = v.seq ?? null;
      if (!seq || seq === this._snapSeq) return;
      if (this._lastSeq && seq <= this._lastSeq) { this._snapSeq = seq; return; }
      console.warn(`[net] the op log was compacted past us (${this._lastSeq} -> ${seq}); re-adopting the snapshot`);
      this._snapSeq = seq;
      this._lastSeq = seq;
      this._opCount = 0;
      this.handlers.onSnapshot?.({ model: v.model, seq });
      this._armOps(seq);
    }));

    // --- locks -----------------------------------------------------------
    this._unsubs.push(onValue(ref(this.db, this.paths.locks), snap => {
      if (this._dead) return;
      const locks = snap.val() ?? {};
      const now = this.now();
      const live = {};
      for (const [objId, l] of Object.entries(locks)) {
        if (!l || (now - (l.at ?? 0)) > LOCK_TTL_MS) {
          // TTL sweep: whoever notices clears it. The transaction in lock()
          // makes the double-clear harmless.
          remove(ref(this.db, `${this.paths.locks}/${objId}`)).catch(() => {});
          continue;
        }
        live[objId] = l.pid;
      }
      const prev = this._locks ?? {};
      for (const objId of new Set([...Object.keys(prev), ...Object.keys(live)])) {
        if (prev[objId] !== live[objId]) this.handlers.onLock?.(objId, live[objId] ?? null);
      }
      this._locks = live;
    }));

    // --- chat ------------------------------------------------------------
    // Read the backlog first and flag it as history, exactly as local.js does,
    // so the UI does not toast fifty old messages at a joiner. Everything after
    // the backlog's last key is live.
    let lastChatKey = null;
    try {
      const backlog = await get(query(ref(this.db, this.paths.chat), orderByKey(), limitToLast(50)));
      backlog.forEach(child => {
        const m = child.val();
        if (!m) return;
        lastChatKey = child.key;
        this.handlers.onChat?.({ id: child.key, ...m }, true);
      });
    } catch (err) { console.warn('[net] chat backlog', err); }
    const chatQuery = lastChatKey
      ? query(ref(this.db, this.paths.chat), orderByKey(), startAfter(lastChatKey))
      : query(ref(this.db, this.paths.chat), orderByKey());
    this._unsubs.push(onChildAdded(chatQuery, snap => {
      if (this._dead) return;
      const m = snap.val();
      if (m) this.handlers.onChat?.({ id: snap.key, ...m }, false);
    }));

    this.handlers.onStatus?.({ kind: this.kind, online: true, warning: null });
  }

  /** (Re)point the ops listener at everything after `from`. */
  _armOps(from) {
    const { ref, query, orderByKey, startAfter, onChildAdded } = this.fb;
    if (this._opsUnsub) { try { this._opsUnsub(); } catch { /* already gone */ } }
    const opsRef = ref(this.db, this.paths.ops);
    const q = from ? query(opsRef, orderByKey(), startAfter(from)) : query(opsRef, orderByKey());
    this._opsUnsub = onChildAdded(q, snap => {
      if (this._dead) return;
      const op = snap.val();
      if (!op) return;
      this._lastSeq = snap.key;
      this._opCount += 1;
      this.handlers.onOp?.(op, snap.key);
      // The log has outgrown its cap and nobody has compacted it. Ask the
      // session; only a host will actually write, and _claimHost has already
      // made sure an office with a dead host gets a live one.
      if (this._opCount > OPS_CAP && this._opCount % 50 === 0) this.handlers.onNeedSnapshot?.();
    });
  }

  /** A player record we can still believe in — present and heartbeating. */
  _isLive(pid) {
    const p = this.presence?.get(pid);
    if (!p) return false;
    return (this.now() - (p.lastSeen ?? 0)) <= PLAYER_TTL_MS;
  }

  _lowestLiveHuman() {
    const humans = (this.presence?.list() ?? [])
      .filter(p => !p.bot && this._isLive(p.id))
      .map(p => p.id)
      .sort();
    return humans[0] ?? null;
  }

  /** Promote ourselves only if we are the lowest-id live human left. */
  async _claimHost() {
    if (this.bot || this._lowestLiveHuman() !== this.playerId) return;
    const { ref, runTransaction } = this.fb;
    await runTransaction(ref(this.db, this.paths.meta), cur => {
      if (!cur) return cur;
      if (cur.host && this._isLive(cur.host)) return cur;        // somebody beat us to it
      return { ...cur, host: this.playerId };
    }).catch(() => {});
  }

  // -------------------------------------------------------------------------

  sendOp(op) {
    if (this.fallback) return this.fallback.sendOp(op);
    const { ref, push, set } = this.fb;
    const r = push(ref(this.db, this.paths.ops));
    set(r, op).catch(err => console.warn('[net] op write failed', err));
    return r.key;
  }

  /** Cursors move every frame; the wire sees at most 10 updates a second. */
  setCursor(cursor) {
    if (this.fallback) return this.fallback.setCursor(cursor);
    this._cursorPending = cursor;
    if (this._cursorTimer) return;
    this._cursorTimer = setTimeout(() => {
      this._cursorTimer = null;
      const c = this._cursorPending;
      this._cursorPending = null;
      if (!c) return;
      const { ref, update } = this.fb;
      update(ref(this.db, this.paths.me), {
        cursor: { mode: c.mode ?? null, x: c.x ?? 0, y: c.y ?? 0, z: c.z ?? 0 },
        sel: c.sel ?? [],
        lastSeen: this.now(),
      }).catch(() => {});
    }, 100);
    if (this._cursorTimer.unref) this._cursorTimer.unref();
  }

  /**
   * Grab lock. A transaction, so with two players reaching for the same chair
   * exactly one of them wins — a plain read-then-write would let both through.
   */
  async lock(objId) {
    if (this.fallback) return this.fallback.lock(objId);
    const { ref, runTransaction, onDisconnect } = this.fb;
    const lockRef = ref(this.db, `${this.paths.locks}/${objId}`);
    const now = this.now();
    try {
      const res = await runTransaction(lockRef, cur => {
        if (cur && cur.pid !== this.playerId && (now - (cur.at ?? 0)) <= LOCK_TTL_MS) return;  // abort
        return { pid: this.playerId, at: now };
      });
      const won = !!res.committed && res.snapshot.val()?.pid === this.playerId;
      if (won) onDisconnect(lockRef).remove();
      return won;
    } catch (err) {
      console.warn('[net] lock failed', err);
      return false;
    }
  }

  unlock(objId) {
    if (this.fallback) return this.fallback.unlock(objId);
    const { ref, remove, onDisconnect } = this.fb;
    const lockRef = ref(this.db, `${this.paths.locks}/${objId}`);
    onDisconnect(lockRef).cancel().catch(() => {});
    remove(lockRef).catch(() => {});
  }

  chat(text) {
    if (this.fallback) return this.fallback.chat(text);
    const { ref, push, set } = this.fb;
    const r = push(ref(this.db, this.paths.chat));
    const msg = { pid: this.playerId, text, at: this.now() };
    set(r, msg).catch(() => {});
    return { id: r.key, ...msg };
  }

  setPhase(phase) {
    if (this.fallback) return this.fallback.setPhase(phase);
    const { ref, update } = this.fb;
    update(ref(this.db, this.paths.meta), { phase }).catch(() => {});
  }

  /**
   * Host only. Writes /snapshot and then trims the op log back to the
   * snapshot, which is what keeps /ops under the 500-entry cap.
   */
  async writeSnapshot(model, seq) {
    if (this.fallback) return this.fallback.writeSnapshot(model, seq);
    const { ref, get, query, orderByKey, endBefore, update, runTransaction } = this.fb;
    const at = seq ?? this._lastSeq;
    const payload = { model: JSON.parse(JSON.stringify(model)), seq: at ?? null, at: this.now() };
    try {
      // A transaction with a monotonicity guard, not a plain set(). A client
      // that still believes it is host must never move /snapshot BACKWARDS:
      // the trim below then deletes the ops between the two points, and they
      // exist nowhere else. Seq values are RTDB push keys, which sort
      // lexicographically in write order.
      const res = await runTransaction(ref(this.db, this.paths.snapshot), cur => {
        if (cur && cur.seq && at && cur.seq >= at) return;        // abort, ours is stale
        return payload;
      });
      if (!res.committed) {
        console.warn('[net] snapshot skipped: a newer one is already there');
        return null;
      }
      this._snapSeq = at ?? this._snapSeq;
      this._opCount = 0;
      if (at) {
        const old = await get(query(ref(this.db, this.paths.ops), orderByKey(), endBefore(at)));
        const kill = {};
        let n = 0;
        old.forEach(child => { kill[child.key] = null; n += 1; });
        if (n) await update(ref(this.db, this.paths.ops), kill);
      }
    } catch (err) {
      console.warn('[net] snapshot write failed', err);
    }
    return payload;
  }

  leave() {
    if (this.fallback) { this.fallback.leave(); this.fallback = null; return; }
    this._teardownRtdb();
    try {
      const { ref, remove } = this.fb;
      for (const [objId, pid] of Object.entries(this._locks ?? {})) {
        if (pid === this.playerId) remove(ref(this.db, `${this.paths.locks}/${objId}`)).catch(() => {});
      }
      remove(ref(this.db, this.paths.me)).catch(() => {});
    } catch { /* never block leaving */ }
    this.online = false;
  }
}
