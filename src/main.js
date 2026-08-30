// main.js — boots the App.
//
// The App owns the shared context every mode receives:
//   ctx = { engine, state, input, audio, net, assets }
// Modes are registered lazily: a mode module that does not exist yet simply is
// not registered, and the engine falls back to the placeholder. That is what lets
// five agents build five modes in parallel without ever breaking the page.

import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { AudioBus } from './core/audio.js';
import { Assets } from './core/assets.js';
import { PlaceholderMode } from './core/mode.js';
import { createState } from './core/state.js';
import { createLoop } from './core/loop.js';

// Modes to try, in the order they should be attempted. Each entry names the module
// and the export; a missing module is skipped with one console.info, not an error.
const MODE_MODULES = [
  { id: 'menu', path: './menu/menu-mode.js', export: 'MenuMode' },
  { id: 'office', path: './office/office-mode.js', export: 'OfficeMode' },
  { id: 'editor', path: './editor/editor-mode.js', export: 'EditorMode' },
  { id: 'walk', path: './walk/walk-mode.js', export: 'WalkthroughMode' },
];

class App {
  constructor() {
    this.canvas = document.getElementById('view');
    this.ui = document.getElementById('ui');
    this.debugEl = document.getElementById('debug');

    this.state = createState();
    this.engine = new Engine(this.canvas);
    this.input = new Input(this.canvas);
    this.audio = new AudioBus();
    this.assets = new Assets();
    this.net = null;              // src/net/session.js attaches later

    this.ctx = {
      engine: this.engine,
      state: this.state,
      input: this.input,
      audio: this.audio,
      assets: this.assets,
      net: this.net,
      app: this,
    };
    this.engine.setContext(this.ctx);
    this.debug = this.engine.attachDebug(this.debugEl);
  }

  async boot() {
    // Debug overlay is on from day one, per ARCHITECTURE.md.
    this.debug.toggle(true);
    this.input.on('action', ({ action }) => {
      if (action === 'debug.toggle') this.debug.toggle();
    });

    // Audio: the context starts suspended and resumes on the first gesture.
    // Every file is optional — nothing here can fail the boot.
    this.audio.init();
    // assets/audio/manifest.json is the only list of sounds there is. Read it,
    // then decode the short ones up front (clicks and footsteps have to be
    // instant) and leave music, radio and room tone to load on first play —
    // those are the multi-megabyte files.
    this.audio.loadManifest().then(() => this.audio.preloadAll(
      (name, e) => e.kind !== 'music' && e.kind !== 'radio' && e.kind !== 'amb',
    )).catch(() => {});

    // Try the real modes; fall back to the placeholder.
    let first = null;
    for (const m of MODE_MODULES) {
      try {
        const mod = await import(/* @vite-ignore */ m.path);
        const Ctor = mod[m.export] || mod.default;
        if (!Ctor) throw new Error(`no export ${m.export}`);
        const inst = new Ctor();
        this.engine.register(inst);
        if (!first) first = inst;
      } catch (err) {
        console.info(`[app] mode "${m.id}" not available yet (${m.path})`);
      }
    }
    if (!first) {
      first = new PlaceholderMode();
      this.engine.register(first);
      console.info('[app] running the placeholder mode — no game mode is present yet');
    }

    // The game loop. It has to exist BEFORE the first mode is pushed: it
    // listens for the office opening, and that is where the first brief is
    // generated and posted to the inbox.
    this.loop = createLoop(this.ctx);
    this.ctx.loop = this.loop;

    this.engine.push(first);
    this.engine.start();

    // Keep the audio listener on whatever camera is rendering.
    this.engine.onUpdate(() => {
      const mode = this.engine.activeMode;
      if (mode?.camera) this.audio.setListener(mode.camera);
    });

    window.SB = this;   // one global, for the console and for the critics
    console.info('[app] Smendilendi Bureau ready — backquote toggles the debug overlay');
  }
}

const app = new App();
app.boot().catch((err) => {
  console.error('[app] boot failed', err);
  const el = document.getElementById('ui');
  if (el) {
    el.innerHTML = `<div class="fatal"><h1>Boot failed</h1><pre>${String(err && err.stack || err)}</pre></div>`;
  }
});

export default app;
