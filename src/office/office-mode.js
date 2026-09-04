// office-mode.js — the Mode wrapper around Office.
//
// Contract (ARCHITECTURE.md): { id, init(ctx), enter(params), update(dt),
// render(renderer), exit(), dispose() }. Everything real lives in office.js;
// this file is the plug.

import { Mode } from '../core/mode.js';
import { Office } from './office.js';
import { modelReport } from './models.js';

export class OfficeMode extends Mode {
  constructor() {
    super('office');
    this.office = null;
    this._pendingLuma = null;
  }

  init(ctx) {
    super.init(ctx);
    const t0 = performance.now();
    this.office = new Office(ctx).build();
    this.scene = this.office.scene;
    this.camera = this.office.camera;
    this.office.buildHud(document.getElementById('ui') || document.body);
    const models = modelReport();
    console.info(`[office] built in ${(performance.now() - t0).toFixed(0)} ms — `
      + `${this.office._propTypes.size} prop types, ${this.office.pool.instanceCount} instances, `
      + `${this.office.shadowPoints.length} contact shadows, `
      + `${models.loaded.length} catalogue models (${models.failed.length} procedural fallbacks)`);

    // Seat whoever is in the session. In single player that is one architect.
    const state = ctx.state;
    const players = Object.values(state?.get('players') || {});
    // Desks are dealt in ROSTER order — join order — the same on every client,
    // so two players agree on who sits where. The local player is whoever the
    // roster says they are, not forced to desk 1; forcing `me` first here and
    // then re-seating in roster order on the first 'players' event reshuffled
    // the room in front of a joining player. Single player: one entry, desk 1.
    const myId = state?.get('session.playerId');
    const me = players.find((p) => p.id === myId);
    const seated = players.length ? players
      : [{ id: 'local', nick: state?.get('session.nick') || 'Architect', color: '#e2725b', local: true }];
    if (me) me.local = true;
    this.office.assignPlayers(seated);

    // 'office.drop' is not a global binding — the office adds it for the mug.
    ctx.input?.rebind('office.drop', ['KeyG']);
    ctx.input?.rebind('office.manage', ['KeyM']);

    this._unsub = state?.on('players', () => {
      const list = Object.values(state.get('players') || {});
      if (list.length) this.office.assignPlayers(list);
      this.office.refreshHud();
    });
  }

  enter(params = {}) {
    super.enter(params);
    const { audio, input } = this.ctx;
    audio?.loop('amb.office-room-tone');
    // 17 Ambition Road is a street, and the office's long elevation is glass (the
    // window bay with the blinds, office.js). The traffic bed sits under the room
    // tone at roughly half its level — see assets/audio/manifest.json, which is
    // the only place either number is written down.
    audio?.loop('amb.street-outside');
    // Both office tracks were levelled by hand in the sign-off, but only the
    // first one had a call site. The playlist alternates them, so the second is
    // heard at the level it was approved at instead of never at all.
    audio?.musicPlaylist(['music.office-ambient-1', 'music.office-ambient-2']);
    this.office.refreshHud();
    this.office.hudEl?.classList.remove('hidden');
    // The office owns the mouse pointer's VISIBILITY, and only while it is the
    // mode on screen. See suspendCursor() in office.js for why that matters.
    this.office.resumeCursor();

    this._onCanvasClick = () => {
      if (this.office.interact.focus || this.office.panelOpen) return;
      input?.requestLock();
    };
    this.ctx.engine.renderer.domElement.addEventListener('mousedown', this._onCanvasClick);
  }

  update(dt) {
    const { input } = this.ctx;
    if (input?.pressed('office.manage') && !this.office.interact.focus) {
      if (this.office.panelOpen) this.office.closePanel(); else this.office.showManagement();
    }
    if (input?.pressed('cancel') && this.office.panelOpen) this.office.closePanel();
    this.office.update(dt);
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
    if (this._pendingLuma) {
      const fn = this._pendingLuma;
      this._pendingLuma = null;
      try { fn(this.office.sampleLuma(renderer)); } catch (e) { fn({ error: String(e) }); }
    }
  }

  /** Debug/QA hook: window.SB.engine.modes.get('office').measure().then(...) */
  measure() {
    return new Promise((res) => { this._pendingLuma = res; });
  }

  exit() {
    super.exit();
    this.ctx.audio?.stopLoop('amb.office-room-tone');
    this.ctx.audio?.stopLoop('amb.street-outside');
    this.ctx.input?.exitLock();
    this.office?.hudEl?.classList.add('hidden');
    // THE ONE LINE THAT MADE THE EDITOR UNUSABLE.
    //
    // Focusing a desk machine hides the browser's own pointer, because the OS
    // draws its own 1-bit one on the screen texture. That is right while the
    // office is on screen — and catastrophic the moment it is not, because the
    // Design app pushes EditorMode ON TOP of the office without ever releasing
    // the screen. `canvas.style.cursor` stayed 'none' for the whole editor
    // session, so the player was asked to draw walls with an invisible mouse.
    // Measured 2026-09-02: entering the editor through the game left
    // getComputedStyle(canvas).cursor === 'none'. That is Jurek's "you can't
    // draw those lines at all. Or anything."
    this.office?.suspendCursor();
    if (this._onCanvasClick) {
      this.ctx.engine.renderer.domElement.removeEventListener('mousedown', this._onCanvasClick);
      this._onCanvasClick = null;
    }
  }

  resize(w, h) {
    super.resize(w, h);
  }

  dispose() {
    this._unsub?.();
    this.office?.dispose();
    super.dispose();
  }
}

export default OfficeMode;
