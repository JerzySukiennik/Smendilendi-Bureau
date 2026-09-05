// loop.js — the game loop. The thing that makes four rooms one building.
//
// Every mode in this project worked on its own and none of them called the next
// one. menu -> office existed, walk -> office existed, and the two doors in the
// middle (office -> editor, accepted -> walkthrough) did not. This file is those
// doors, plus the paperwork that has to travel through them.
//
// DESIGN-DECISIONS.md, "Core loop":
//   1. brief arrives by e-mail
//   2. walk to the desk, click the monitor, design
//   3. submit -> "3 days later" -> the client's list of things to fix
//   4. EXACTLY ONE revision round
//   5. accepted -> "30 years later" -> walk the finished building
//   6. back to the office, fee in the bank, next brief
//
// WHAT THIS FILE OWNS
//   * the Commission in state, and generating the next one
//   * the inbox: every message state.mail.messages ever holds is posted here
//   * the Design app on every desk machine, and the push into EditorMode
//   * submit(): analysis -> client mail -> the revision round counter
//   * the wipe between stages
//   * the push into WalkthroughMode and the settlement when it comes back
//
// WHAT IT DOES NOT OWN
//   The building. There is exactly one BuildingModel and it lives in the net
//   Session (`ctx.net.model`); the editor reads it through `editor.model`, and
//   this file publishes THAT SAME OBJECT to `state.model` at every stage
//   boundary so the analysis and the walkthrough measure the model the player
//   actually drew. Nothing here ever copies it.

import { generateCommission } from '../commission/index.js';
import { runAnalysis } from '../analysis/index.js';
import { revisionMail, acceptanceMail } from '../analysis/mail.js';
import { createModel } from '../model/building.js';
import { getRooms } from '../model/rooms.js';

/** Phases the loop moves through. Mirrored to the net session for other players. */
export const PHASES = ['brief', 'design', 'review', 'revising', 'walkthrough', 'settled'];

/** How long a stage wipe holds, seconds. */
const WIPE_HOLD = 2.4;

export class GameLoop {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.engine = ctx.engine;
    this.phase = 'idle';
    /** Submissions made on the current commission. 1 = the revision round is live. */
    this.round = 0;
    /** Finished commissions, oldest first — generateCommission reads it. */
    this.completed = [];
    this.report = null;
    this.seq = 0;
    this._wiredOs = new Set();
    this._netWired = null;
    this._lastMode = null;
    this._busy = false;
    this._overlay = null;
  }

  // -- boot ------------------------------------------------------------------

  attach() {
    this._ensureStyles();
    this.engine.onUpdate(() => this._tick());
    this.state.on('mode', (id) => this._onMode(id));
    return this;
  }

  /** Every frame, cheap: adopt any desk machine that has finished booting. */
  _tick() {
    this._wireNet();
    const office = this.engine.modes.get('office')?.office;
    if (!office?.workstations) return;
    for (const ws of office.workstations) if (ws.os) this._wireOs(ws.os);
    // Replay the room once the office exists to receive it.
    if (this._officeState && !this._officeApplied) {
      this._officeApplied = true;
      office.applyOfficeState?.(this._officeState);
    }
  }

  /**
   * Keep `state.model` on the session's CURRENT model.
   *
   * applyOp is pure: every op produces a new object and the session swaps its
   * `model` reference for it. So a `state.model` published once at a stage
   * boundary is a photograph of the drawing as it was, and anything reading the
   * state between boundaries — the walkthrough's fallback, the cost sheet, a
   * critic at the console — measures a building the player has since changed.
   * There is still exactly ONE model (ARCHITECTURE.md rule 7); this makes the
   * state point at it continuously instead of at one of its former selves.
   */
  _wireNet() {
    const net = this.ctx.net;
    if (!net?.on || this._netWired === net) return;
    this._netWired = net;
    const publish = (e) => { if (e?.model) this.state.set('model', e.model); };
    net.on('op', publish);
    net.on('snapshot', publish);
    if (net.model) this.state.set('model', net.model);
    // THE ROSTER. The office seats whoever is in `state.players` and subscribes
    // to it (office-mode.js) — but nobody ever wrote the session's roster INTO
    // state.players. So two players could share an office over the live
    // database, trade ops and chat, and still each see three desks reading
    // "Architect / – / –" and no avatar of the other. Measured 2026-09-04 with
    // two identities (?pid=ada / ?pid=bo): both sessions held [Ada, Bo], both
    // offices seated nobody. This is the missing bridge: every 'players' event
    // becomes state.players, keyed by id, local player first.
    // AN UNCHANGED ROSTER IS NOT AN EVENT.
    //
    // Jurek, item 13: "if I switch to another window for a moment, a lot of
    // things flicker afterwards — the player list, things on the desk." A
    // backgrounded tab throttles its timers, and on return the heartbeats it
    // could not send all arrive at once: a burst of 'players' events, each
    // re-seating the desks, re-running the avatar sync and rebuilding the
    // roster's DOM in the same frame. Nothing about the office had changed.
    //
    // The signature includes the cursor, because that IS how a remote player's
    // position reaches the office — a player who is walking still produces
    // events, at the 8 Hz he publishes them, and a player standing still
    // produces none.
    const roster = (list) => {
      const arr = Array.isArray(list) ? list : Object.values(list || {});
      const byId = {};
      const sig = [];
      for (const p of arr) {
        if (!p || !p.id) continue;
        byId[p.id] = { ...p, local: p.id === net.playerId };
        const c = p.cursor;
        sig.push(`${p.id}|${p.nick}|${p.color}|${c ? `${c.mode},${c.x},${c.z},${c.ry ?? ''},${c.hold ?? ''},${c.act ?? ''}` : ''}`);
      }
      const key = sig.sort().join(';');
      if (key === this._rosterKey) return;
      this._rosterKey = key;
      this.state.set('players', byId);
    };
    net.on('players', roster);
    // The room: lamps and the machine the studio owns. The office may not be
    // built yet when the first record arrives, so it is kept and replayed —
    // a guest who joins before walking in must still see the lamps that are on.
    const applyOffice = (o) => {
      this._officeState = { ...(this._officeState || {}), ...(o || {}) };
      this.engine.modes.get('office')?.office?.applyOfficeState?.(this._officeState);
    };
    net.on('office', applyOffice);
    if (net.office) applyOffice(net.office);
    if (net.players && (Array.isArray(net.players) ? net.players.length : Object.keys(net.players).length)) roster(net.players);
  }

  _onMode(id) {
    const prev = this._lastMode;
    this._lastMode = id;
    if (id === prev) return;
    // A stage overlay belongs to the moment between two stages. Arriving in a
    // mode means that moment is over, so nothing full-screen may still be
    // sitting on the player's mouse whatever route we took to get here.
    if (!this._busy) this.clearWipes();
    if (id === 'office' && !this._started) { this._started = true; this.startCampaign(); }
    if (id === 'office' && prev === 'walk') this._settle();
  }

  // -- stage 1: the brief ----------------------------------------------------

  /** First commission of the session. Called the moment the office opens. */
  startCampaign() {
    if (this.state.get('commission')) { this.phase = 'brief'; return; }
    // A GUEST NEVER STARTS A JOB. THE HOST'S JOB IS THE JOB.
    //
    // A commission is derived from (session code, round number), so two players
    // in the same office agree only while their round numbers agree — and a
    // player joining an office where one job is already finished had n = 0
    // against the host's n = 1. Measured on code NPVPYYT7: the buildable
    // corner moves from (-9.4, -32.3) to (-14.4, 21.7). Different site,
    // different brief, same office. Everything the guest drew inside the
    // host's building was then off his own plot and REFUSED, which is exactly
    // "design does not work". Worse, newCommission() replaces the model, and
    // that travels as an op — so the guest's arrival wiped the host's drawing.
    //
    // So the guest waits, and adopts the round the host's model announces.
    if (this.ctx.net && this.ctx.net.isHost === false) { this._awaitHostCommission(); return; }
    this.newCommission();
  }

  /**
   * Adopt the host's commission from the model id.
   *
   * The round number rides in the model id (`m<n>-<commissionId>`) because the
   * model already travels to every player as an op and needs no new channel,
   * no new presence field and no database rule change. Anything else would be
   * a second source of truth for the same number.
   */
  _awaitHostCommission() {
    this._setPhase('brief');
    const adopt = (model) => {
      const m = /^m(\d+)-/.exec(model?.id || '');
      if (!m) return;
      const n = Number(m[1]);
      if (this._adoptedRound === n) return;
      this._adoptedRound = n;
      this.newCommission({ n, keepModel: true });
    };
    const net = this.ctx.net;
    if (net.model) adopt(net.model);
    net.on('op', (e) => adopt(e?.model));
    net.on('snapshot', (e) => adopt(e?.model));
  }

  newCommission({ n = this.completed.length, keepModel = false } = {}) {
    const code = this.state.get('session.code') || 'LOCAL';
    // The first job is a soft one. Difficulty tightens the budget and the
    // deadline and shrinks the plot; an architect meeting the game for the
    // first time should not open on the worst site it can generate — see
    // commissionAt, which owns the seed and the difficulty ramp.
    // REPLAY THE CHAIN INSTEAD OF TRUSTING THE LOCAL HISTORY.
    //
    // generateCommission reads the history's CONTENTS, not just its length —
    // it avoids repeating the last three building types and the last six
    // clients. A guest adopting round 3 has an empty `completed`, so passing
    // it straight in produced a different building type and a different client
    // from the host's, on the same code and the same round. Every past job was
    // itself generated from (code, k), so the chain can simply be rebuilt: it
    // is exact, it needs no extra channel, and n is never more than a handful.
    const c = commissionAt(code, n);

    this.round = 0;
    this.report = null;
    this.state.set('commission', c);
    this.state.set('analysis', null);

    // A new job is a new drawing. The model lives in the session, so this is
    // the one place it is ever replaced, and it travels as an op so every
    // player in the office lands on the same empty sheet.
    // The round number rides in the model id so a guest can read it back; see
    // _awaitHostCommission. `keepModel` is the guest adopting a job that is
    // already under way — replacing the model there would wipe the drawing it
    // just joined.
    const net = this.ctx.net;
    if (net?.setModel && !keepModel) net.setModel(createModel({ id: `m${n}-${c.id}` }));
    this.state.set('model', net?.model ?? null);

    // The editor may already have been built for the previous commission: it
    // has to be re-sited on the new plot before the player can open it.
    this.engine.modes.get('editor')?.setCommission?.(c);

    this.postMail({
      kind: 'brief', locked: true,
      from: `${c.client?.name ?? 'The client'}${c.client?.company ? `, ${c.client.company}` : ''}`,
      subject: `${c.title} — brief`,
      body: c.briefText || '',
    });
    this._setPhase('brief');
    this.toast(`New brief: ${c.title}. It is in your inbox.`);
    return c;
  }

  get commission() { return this.state.get('commission'); }

  /** The subset of the commission the analysis engine reads. */
  brief() {
    const c = this.commission;
    if (!c) return {};
    return {
      buildingType: c.type, type: c.type, title: c.title, client: c.client,
      budget: c.budget, program: c.program, constraints: c.constraints,
      plot: c.plot, storeys: c.storeys, areas: c.areas, params: c.params,
    };
  }

  // -- stage 2: the desk -----------------------------------------------------

  /**
   * Put the Design application on a desk machine and listen for it being run.
   * The OS already knows how to hand the whole screen to a foreign app: an app
   * registered `fullscreen: true` makes openApp() emit 'fullscreen' instead of
   * opening a window (src/os/os.js). That event is this door.
   */
  _wireOs(surface) {
    if (!surface || this._wiredOs.has(surface)) return;
    const os = surface.os || surface;
    if (!os?.registerApp || !os.apps) return;
    this._wiredOs.add(surface);
    if (!os.apps.has('editor')) {
      os.registerApp({
        id: 'editor', title: 'Design', menuLabel: '&Design', icon: 'design',
        // The tray only exists from tier 2 up, so the starter machine needs the
        // desktop icon; otherwise the one app the whole game is about is buried
        // two levels down the Start menu on the machine every player starts on.
        desktopIcon32: 'design',
        fullscreen: true, quickLaunch: true,
        window: { w: 1, h: 1 },
      });
    }
    os.on('fullscreen', ({ id }) => { if (id === 'editor') this.openEditor(); });
  }

  /** Hand over from the office to the editor. The office stays under it. */
  openEditor() {
    if (this._busy) return null;
    // OPENING DESIGN TWICE MUST BE OPENING IT ONCE.
    //
    // Jurek, with two screenshots: the first double-click leaves the OS
    // desktop on the monitor with the editor's palette floating over the whole
    // office; the second gets the drawing but no cursor and no movement. Both
    // are the same fault. openEditorOnScreen() refuses when a screen editor is
    // already up and returns null — and the null was read as "there is no
    // monitor to run on", so the caller fell through to pushing the editor as
    // a MODE OVER THE GAME. That is the office plus the OS plus a HUD, with
    // two editors fighting over the pointer. A double-click sends the open
    // twice, so it happened on the very first attempt.
    const office0 = this.engine.modes.get('office')?.office;
    if (this._editorOnScreen && office0?.screenEditor) return office0.screenEditor.mode;
    if (this.engine.activeMode?.id === 'editor') return this.engine.activeMode;
    if (!this.commission) this.newCommission();
    const ed = this.engine.modes.get('editor');
    if (!ed) { this.toast('The editor is not installed on this machine.'); return null; }
    // ON THE MONITOR when there is one to be on. The office is the active
    // mode and a workstation has the player's focus — the design app asked for
    // "fullscreen" from inside the OS — so the editor runs on that screen at
    // the tier's resolution and the camera fills the frame with it. The old
    // path (a mode pushed over the game) remains for the case where there is
    // no focused monitor, e.g. a harness page.
    const office = this.engine.modes.get('office')?.office;
    // IF THERE IS A MONITOR, THE EDITOR RUNS ON IT. The fallback to a mode over
    // the game exists for a harness with no office in it, and it was being
    // taken in the real game whenever `interact.focus` happened to be null —
    // which is every route into Design that is not "already leaning into the
    // screen". So: take the focused workstation if there is one, otherwise this
    // player's own desk, and fly to it first. Only a genuinely office-less
    // engine falls through.
    let ws = office?.interact?.focus?.workstation;
    if (office && !ws) {
      ws = office.workstations?.find((w) => w.player?.local)
        || office.workstations?.find((w) => w.player)
        || office.workstations?.[0];
      if (ws) office.interact.focusScreen(ws, { fill: true });
    }
    let mode;
    if (office && ws && this.engine.activeMode?.id === 'office' && ed.enterOnScreen) {
      mode = office.openEditorOnScreen(ws, ed, { commission: this.commission });
      this._editorOnScreen = !!mode;
    }
    if (!mode) {
      console.warn('[loop] no monitor to run the editor on — falling back to a mode over the game',
        { hasOffice: !!office, hasWorkstation: !!ws, activeMode: this.engine.activeMode?.id });
      mode = this.engine.push('editor', { commission: this.commission });
      this._editorOnScreen = false;
    }
    const editor = mode?.editor;
    if (editor) {
      editor.onSubmit = () => this.submit();
      editor.onLeave = () => this.leaveEditor();
      editor.submitLabel = this.round === 0 ? 'Submit to client' : 'Resubmit';
      editor.hud?.refreshSubmit?.();
    }
    this._setPhase('design');
    return mode;
  }

  /** Back to the desk without submitting. */
  leaveEditor() {
    const office = this.engine.modes.get('office')?.office;
    if (this._editorOnScreen && office?.screenEditor) {
      this._editorOnScreen = false;
      this.state.set('model', this.ctx.net?.model ?? this.state.get('model'));
      office.closeEditorOnScreen();
      // the camera may still be at the fill distance; hand focus back to the OS
      // view or release it entirely if the player pressed Escape
      if (office.interact.focus && office.interact.focus.dir > 0) office.interact.releaseScreen();
      return;
    }
    if (this.engine.activeMode?.id !== 'editor') return;
    this.state.set('model', this.ctx.net?.model ?? this.state.get('model'));
    this.engine.pop({ from: 'editor' });
  }

  // -- stages 3-5: submit, the letter, the revision round --------------------

  /**
   * Hand the drawings over.
   *
   * Round 1 gets the client's list of things to fix. Round 2 ends the job —
   * that is the contract in DESIGN-DECISIONS.md and there is no third round.
   * If the second set still has blockers in it the client does not pretend to
   * be happy: he signs it off under protest and docks the fee, which is what a
   * real one would do and what an architect would expect to read.
   */
  async submit() {
    if (this._busy) return null;
    const model = this.ctx.net?.model || this.state.get('model');
    if (!model) { this.flash('There is no drawing to submit.'); return null; }

    // A model with no enclosed room is not a submission, it is a blank sheet.
    let roomCount = 0;
    try {
      for (const l of model.levels) {
        const r = getRooms(model, l.id);
        roomCount += r.order.filter((id) => !r.rooms[id].isOutside).length;
      }
    } catch (_) { roomCount = 0; }
    if (roomCount === 0) {
      this.flash('Nothing enclosed yet — the client needs rooms, not lines.');
      return null;
    }

    this._busy = true;
    try {
      return await this._submit(model);
    } catch (err) {
      // A throw anywhere past this point used to leave `_busy` true forever —
      // Submit dead, Back to desk still working, and no message. Now it says so.
      console.error('[loop] submit failed', err);
      this.flash(`Something went wrong handing the drawings over: ${err.message || err}`);
      return null;
    } finally {
      // `_busy` and the overlay are released together, on every path out,
      // including the ones nobody has thought of yet.
      this._busy = false;
      this.clearWipes();
    }
  }

  async _submit(model) {
    const brief = this.brief();
    let report;
    try {
      report = runAnalysis(model, brief);
    } catch (err) {
      console.error('[loop] analysis failed', err);
      this.flash(`The checker fell over: ${err.message || err}`);
      return null;
    }
    this.round += 1;
    this.report = report;
    // ONE model, seen by the editor, the analysis, the walkthrough and the net.
    this.state.set('model', model);
    this.state.set('analysis', report);
    this._setPhase('review');

    const finalRound = this.round >= 2 || report.accepted;
    await this.wipe('Three days later', report.accepted && this.round === 1
      ? 'The client has read the drawings.'
      : 'The drawings are with the client.');

    // Back to the desk. The letter is read on the machine it arrived on.
    if (this._editorOnScreen) { const office = this.engine.modes.get('office')?.office; this._editorOnScreen = false; office?.closeEditorOnScreen(); office?.interact?.releaseScreen?.(); }
    else if (this.engine.activeMode?.id === 'editor') this.engine.pop({ from: 'editor' });

    if (!finalRound) {
      const mail = revisionMail(report, brief);
      this.postMail({ ...mail, kind: 'revision' });
      this._setPhase('revising');
      this.toast(`${mail.from} has replied. One revision round — read it and fix it.`);
      return report;
    }

    const mail = report.accepted ? acceptanceMail(report, brief) : this._protestMail(report, brief);
    this.postMail({ ...mail, kind: 'acceptance' });
    this.toast(report.accepted
      ? 'Signed off. Thirty years from now, it is still standing.'
      : 'Signed off under protest. The fee takes the hit.');
    // A beat at the desk so the letter is visibly delivered, then the cut.
    await wait(1.6);
    this.startWalkthrough();
    return report;
  }

  /**
   * The second set still has blockers in it. The client is out of time, so he
   * builds it and pays less. The engine's own revision letter is the body —
   * every number in it is still measured — with the loop's covering line on top.
   */
  _protestMail(report, brief) {
    const base = revisionMail(report, brief);
    const must = (report.issues || []).filter((i) => i.severity === 'blocker' || i.severity === 'major');
    const head = [
      'We are out of programme, so this is going to site as drawn.',
      `${must.length} of the things below are still not right, and I am reducing the`,
      'fee accordingly. I would rather have the building than another round of drawings.',
      '',
      '---',
      '',
    ].join('\n');
    return {
      subject: `${base.subject.split(' — ')[0]} — going ahead as drawn`,
      from: base.from,
      tone: base.tone,
      body: head + base.body,
    };
  }

  // -- stage 6: thirty years later -------------------------------------------

  startWalkthrough() {
    const model = this.ctx.net?.model || this.state.get('model');
    if (!model) return null;
    // The stack has to be [office, walk] and not [office, editor, walk]:
    // walk.js pops when the player is done, and that pop must land in the
    // office, not back in an editor for a building that is now thirty years old.
    while (this.engine.modeStack.length > 1 && this.engine.activeMode?.id !== 'office') {
      this.engine.pop({ from: 'loop' });
    }
    this._setPhase('walkthrough');
    return this.engine.push('walk', {
      model,
      commission: this.commission,
      analysis: this.report || this.state.get('analysis'),
    });
  }

  // -- stage 7: the fee, and the next brief ----------------------------------

  _settle() {
    if (this.phase !== 'walkthrough') return;
    const c = this.commission;
    const report = this.report || this.state.get('analysis');
    const office = this.engine.modes.get('office')?.office;
    const economy = office?.economy;
    if (!c || !economy) { this._setPhase('settled'); return; }

    // The fee is the one the brief quoted. Blockers left in the set at hand-over
    // come off it at 8 % each, which is the same arithmetic the protest letter
    // told the player about.
    const blockers = (report?.issues || []).filter((i) => i.severity === 'blocker').length;
    const majors = (report?.issues || []).filter((i) => i.severity === 'major').length;
    const gross = Math.round(c.fee || 0);
    const cut = Math.min(0.6, blockers * 0.08 + majors * 0.03);
    const fee = Math.round(gross * (1 - cut));
    const employees = this.state.get('office.employees') || [];
    economy.credit(fee, `Fee — ${c.title}`, { commissionId: c.id });
    // Nothing subscribes to the ledger, and the office rebuilds its HUD chips in
    // enter() — which has already run by the time state.mode flips to 'office'
    // and brings us here. Without this the BANK chip reads 30 000 for the rest
    // of the session while state.bank.balance is 252 200. Measured 2026-09-01.
    office.refreshHud?.();

    const lines = [
      `${c.title}`,
      '',
      `Fee as quoted        ${money(gross)}`,
    ];
    if (cut > 0) lines.push(`Withheld (${blockers} blocker${blockers === 1 ? '' : 's'}, ${majors} major)   -${money(gross - fee)}`);
    lines.push(`Paid                 ${money(fee)}`);
    lines.push('', `Balance now ${money(economy.balance)}.`);
    if (employees.length) lines.push('', `${employees.length} on the payroll.`);

    this.postMail({
      kind: 'mail', from: 'Bureau accounts',
      subject: `Fee received — ${c.title}`,
      body: lines.join('\n'),
    });

    this.completed.push(c);
    this._setPhase('settled');
    this.toast(`${money(fee)} in the bank.`);
    // The next brief lands a moment later, so the two notifications do not
    // arrive on top of each other.
    wait(2.2).then(() => { if (this.phase === 'settled') this.newCommission(); });
  }

  // -- the inbox -------------------------------------------------------------

  postMail(msg) {
    const list = [...(this.state.get('mail.messages') || [])];
    list.unshift({
      id: msg.id || `msg-${++this.seq}`,
      from: msg.from || 'Unknown sender',
      subject: msg.subject || '(no subject)',
      body: msg.body || '',
      at: Date.now(),
      unread: true,
      kind: msg.kind || 'mail',
      locked: !!msg.locked,
    });
    this.state.set('mail.messages', list);
    this.state.set('mail.unread', list.filter((m) => m.unread).length);
    this.ctx.audio?.play?.('ui.mail-notify');
    return list[0];
  }

  // -- the wipe --------------------------------------------------------------

  /**
   * The screen wipe between stages. DESIGN-DECISIONS.md asks for "3 days later"
   * by name. It is a DOM overlay rather than anything in the scene, because at
   * this moment the scene is being torn down and rebuilt underneath it.
   */
  wipe(title, sub = '', hold = WIPE_HOLD) {
    const host = document.getElementById('ui') || document.body;
    // NOTHING SURVIVES ITS OWN WIPE. `.loop-wipe` is `position:fixed; inset:0;
    // pointer-events:all` — a full-screen click eater — and it used to be
    // removed only by a setTimeout chain hanging off the end of this method. Any
    // throw between creating it and removing it, or a second wipe overlapping
    // the first, left one in the DOM for the rest of the session and every click
    // in the game went into it. That is the shape of "I can't click anything.
    // The game goes on, I can't do anything."
    //
    // Three belts, because this one is not allowed to fail: any stale overlay is
    // swept before a new one is made, the removal is a `finally`, and the
    // element carries a hard self-destruct that does not depend on any promise
    // being awaited by anybody.
    this.clearWipes();
    const el = document.createElement('div');
    el.className = 'loop-wipe';
    el.innerHTML = `<div class="loop-wipe-in"><h1></h1><p></p></div>`;
    el.querySelector('h1').textContent = title;
    el.querySelector('p').textContent = sub;
    host.appendChild(el);
    this._overlay = el;
    // Reading a layout property flushes style, which is all a CSS transition
    // needs to have a "from" value to animate out of. This used to be
    // `requestAnimationFrame(() => el.classList.add('on'))`, and rAF is exactly
    // the thing that is not guaranteed to run: any host that suspends the frame
    // callback (a background tab, an offscreen embed, the review harness) never
    // adds the class, so the wipe sits at opacity 0 for its whole 2.4 s and the
    // player watches the editor while the client reads the drawings.
    void el.offsetWidth;
    el.classList.add('on');
    const drop = () => {
      clearTimeout(el._selfDestruct);
      el.remove();
      if (this._overlay === el) this._overlay = null;
    };
    // The self-destruct. It is not a fallback for a bug we know about; it is the
    // guarantee that a bug we do not know about cannot take the mouse away.
    el._selfDestruct = setTimeout(drop, (hold + 3) * 1000);
    return wait(hold)
      .then(() => { el.classList.remove('on'); return wait(0.5); })
      .catch(() => {})
      .finally(drop);
  }

  /** Remove every stage overlay in the document, whoever put it there. */
  clearWipes() {
    for (const el of document.querySelectorAll('.loop-wipe')) {
      clearTimeout(el._selfDestruct);
      el.remove();
    }
    this._overlay = null;
  }

  // -- talking to the player -------------------------------------------------

  toast(text) {
    const office = this.engine.modes.get('office')?.office;
    if (office?.toast) office.toast(text);
    else console.info(`[loop] ${text}`);
  }

  flash(text) {
    const ed = this.engine.modes.get('editor')?.editor;
    if (ed?.hud?.flash) ed.hud.flash(text);
    else this.toast(text);
  }

  _setPhase(p) {
    this.phase = p;
    this.state.set('session.phase', p);
    try { this.ctx.net?.setPhase?.(p); } catch (_) {}
  }

  _ensureStyles() {
    if (document.getElementById('loop-css')) return;
    const s = document.createElement('style');
    s.id = 'loop-css';
    s.textContent = `
.loop-wipe{position:fixed;inset:0;z-index:900;display:grid;place-items:center;
  background:#100e0c;opacity:0;transition:opacity .45s ease;pointer-events:all;
  font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.loop-wipe.on{opacity:1}
.loop-wipe-in{text-align:center;transform:translateY(8px);transition:transform .6s ease}
.loop-wipe.on .loop-wipe-in{transform:none}
.loop-wipe h1{margin:0;font-size:clamp(28px,5vw,64px);font-weight:600;letter-spacing:.06em;
  color:#f0e6d6}
.loop-wipe p{margin:.9em 0 0;font-size:15px;letter-spacing:.04em;color:#9a9086}
`;
    document.head.appendChild(s);
  }
}

function wait(seconds) {
  return new Promise((r) => setTimeout(r, Math.max(0, seconds * 1000)));
}

function money(v) {
  const n = Math.round(v || 0);
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-GB').replace(/,/g, ' ');
}

export function createLoop(ctx) {
  return new GameLoop(ctx).attach();
}

export default GameLoop;


/**
 * The nth commission of an office, from nothing but the office code.
 *
 * Deterministic and self-contained: every earlier job is regenerated in order
 * so the avoidance rules see the same history the host's did. This is the ONE
 * definition of what job an office is on, shared by host and guest, so the two
 * cannot drift.
 */
function commissionAt(code, n) {
  const history = [];
  let c = null;
  for (let k = 0; k <= n; k++) {
    const d = Math.min(0.85, 0.30 + k * 0.09);
    c = generateCommission(`${code}-${k}`, d, history);
    if (k < n) history.push(c);
  }
  return c;
}
