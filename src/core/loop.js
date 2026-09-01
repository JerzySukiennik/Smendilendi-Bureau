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
  }

  _onMode(id) {
    const prev = this._lastMode;
    this._lastMode = id;
    if (id === prev) return;
    if (id === 'office' && !this._started) { this._started = true; this.startCampaign(); }
    if (id === 'office' && prev === 'walk') this._settle();
  }

  // -- stage 1: the brief ----------------------------------------------------

  /** First commission of the session. Called the moment the office opens. */
  startCampaign() {
    if (this.state.get('commission')) { this.phase = 'brief'; return; }
    this.newCommission();
  }

  newCommission() {
    const code = this.state.get('session.code') || 'LOCAL';
    const n = this.completed.length;
    const seed = `${code}-${n}`;
    // The first job is a soft one. Difficulty tightens the budget and the
    // deadline and shrinks the plot; an architect meeting the game for the
    // first time should not open on the worst site it can generate.
    const difficulty = Math.min(0.85, 0.30 + n * 0.09);
    const c = generateCommission(seed, difficulty, this.completed);

    this.round = 0;
    this.report = null;
    this.state.set('commission', c);
    this.state.set('analysis', null);

    // A new job is a new drawing. The model lives in the session, so this is
    // the one place it is ever replaced, and it travels as an op so every
    // player in the office lands on the same empty sheet.
    const net = this.ctx.net;
    if (net?.setModel) net.setModel(createModel({ id: `m-${c.id}` }));
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
    if (!this.commission) this.newCommission();
    const ed = this.engine.modes.get('editor');
    if (!ed) { this.toast('The editor is not installed on this machine.'); return null; }
    // Everything the editor needs to talk back through.
    const mode = this.engine.push('editor', { commission: this.commission });
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
    const brief = this.brief();
    let report;
    try {
      report = runAnalysis(model, brief);
    } catch (err) {
      console.error('[loop] analysis failed', err);
      this.flash(`The checker fell over: ${err.message || err}`);
      this._busy = false;
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
    if (this.engine.activeMode?.id === 'editor') this.engine.pop({ from: 'editor' });

    if (!finalRound) {
      const mail = revisionMail(report, brief);
      this.postMail({ ...mail, kind: 'revision' });
      this._setPhase('revising');
      this.toast(`${mail.from} has replied. One revision round — read it and fix it.`);
      this._busy = false;
      return report;
    }

    const mail = report.accepted ? acceptanceMail(report, brief) : this._protestMail(report, brief);
    this.postMail({ ...mail, kind: 'acceptance' });
    this.toast(report.accepted
      ? 'Signed off. Thirty years from now, it is still standing.'
      : 'Signed off under protest. The fee takes the hit.');
    this._busy = false;
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
    const el = document.createElement('div');
    el.className = 'loop-wipe';
    el.innerHTML = `<div class="loop-wipe-in"><h1></h1><p></p></div>`;
    el.querySelector('h1').textContent = title;
    el.querySelector('p').textContent = sub;
    host.appendChild(el);
    this._overlay = el;
    requestAnimationFrame(() => el.classList.add('on'));
    return wait(hold).then(() => {
      el.classList.remove('on');
      return wait(0.5).then(() => { el.remove(); if (this._overlay === el) this._overlay = null; });
    });
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
