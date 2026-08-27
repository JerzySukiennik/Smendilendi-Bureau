// office-mode.js — the Mode wrapper around Office.
//
// Contract (ARCHITECTURE.md): { id, init(ctx), enter(params), update(dt),
// render(renderer), exit(), dispose() }. Everything real lives in office.js;
// this file is the plug.

import { Mode } from '../core/mode.js';
import { Office } from './office.js';

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
    console.info(`[office] built in ${(performance.now() - t0).toFixed(0)} ms — `
      + `${this.office._propTypes.size} prop types, ${this.office.pool.instanceCount} instances, `
      + `${this.office.shadowPoints.length} contact shadows`);

    // Seat whoever is in the session. In single player that is one architect.
    const state = ctx.state;
    const players = Object.values(state?.get('players') || {});
    const me = players.find((p) => p.id === state?.get('session.playerId'))
      || players[0]
      || { id: 'local', nick: state?.get('session.nick') || 'Architect', color: '#e2725b' };
    this.office.assignPlayers([me, ...players.filter((p) => p.id !== me.id)]);

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
    // Both office tracks were levelled by hand in the sign-off, but only the
    // first one had a call site. The playlist alternates them, so the second is
    // heard at the level it was approved at instead of never at all.
    audio?.musicPlaylist(['music.office-ambient-1', 'music.office-ambient-2']);
    this.office.refreshHud();
    this.office.hudEl?.classList.remove('hidden');

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
    this.ctx.input?.exitLock();
    this.office?.hudEl?.classList.add('hidden');
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
