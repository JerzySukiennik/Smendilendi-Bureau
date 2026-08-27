// audio.js — a four-bus audio system that is never allowed to break the game.
//
// Buses: music / sfx / ambient / ui, each with its own gain, all under a master.
// Every file is optional: a missing or undecodable sound logs one warning and then
// silently no-ops forever. The office must run before a single .ogg exists.
//
// Browsers block audio until a user gesture, so the context starts suspended and
// resumes on the first click/keypress. Positional sounds use a PannerNode driven
// by a THREE.Object3D each frame (no THREE.Audio dependency — we want the bus
// graph, not three's listener object model).

const BUSES = ['music', 'sfx', 'ambient', 'ui'];

export class AudioBus {
  constructor(opts = {}) {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.buffers = new Map();      // name -> AudioBuffer | null (null = known missing)
    this.loading = new Map();      // name -> Promise
    this.basePath = opts.basePath ?? 'assets/audio/';
    this.volumes = { master: 0.9, music: 0.45, sfx: 0.8, ambient: 0.5, ui: 0.7, ...(opts.volumes || {}) };
    this._playing = new Set();
    this._loops = new Map();       // name -> node handle
    this._missing = new Set();
    this._ready = false;
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this.manifest = opts.manifest || null;   // name -> file, consulted by play()
  }

  /** Load everything in this.manifest. Call once the audio files actually exist. */
  preloadAll() { return this.manifest ? this.loadAll(this.manifest) : Promise.resolve(0); }

  /** Create the context. Safe to call before any gesture — it starts suspended. */
  init() {
    if (this.ctx) return this;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; console.warn('[audio] no WebAudio, running silent'); return this; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);
    for (const b of BUSES) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[b];
      g.connect(this.master);
      this.buses[b] = g;
    }
    this._ready = true;

    const resume = () => {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return this;
  }

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    if (!this._ready) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  mute(v = true) { this.setVolume('master', v ? 0 : this.volumes.master || 0.9); }

  /**
   * Load one sound. Never throws. Resolves to an AudioBuffer or null.
   * name is the key used by play(); file defaults to `<name>.ogg`.
   */
  async load(name, file = null) {
    if (!this.enabled) return null;
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.loading.has(name)) return this.loading.get(name);
    this.init();
    const url = this.basePath + (file || `${name}.ogg`);
    const p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(data);
        this.buffers.set(name, buf);
        return buf;
      } catch (err) {
        if (!this._missing.has(name)) {
          this._missing.add(name);
          console.warn(`[audio] "${name}" unavailable (${url}) — running silent for this sound`);
        }
        this.buffers.set(name, null);
        return null;
      } finally {
        this.loading.delete(name);
      }
    })();
    this.loading.set(name, p);
    return p;
  }

  /** Load a manifest { name: file }. Resolves when all attempts have settled. */
  async loadAll(manifest) {
    const out = await Promise.all(Object.entries(manifest).map(([n, f]) => this.load(n, f)));
    const ok = out.filter(Boolean).length;
    console.info(`[audio] ${ok}/${out.length} sounds loaded`);
    return ok;
  }

  /**
   * play(name, opts) -> handle | null
   * opts: { bus='sfx', volume=1, rate=1, loop=false, detune=0,
   *         position:{x,y,z}, refDistance=2, maxDistance=25, delay=0 }
   */
  play(name, opts = {}) {
    if (!this.enabled) return null;
    this.init();
    const buf = this.buffers.get(name);
    if (buf === undefined) {
      // not loaded yet: kick off a load, play nothing this time (no queueing —
      // a sound that arrives 400 ms late is worse than no sound).
      this.load(name, this.manifest?.[name] || null);
      return null;
    }
    if (buf === null) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!opts.loop;
    src.playbackRate.value = opts.rate ?? 1;
    if (opts.detune && src.detune) src.detune.value = opts.detune;

    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;

    const busName = opts.bus || 'sfx';
    const bus = this.buses[busName] || this.buses.sfx;

    let panner = null;
    if (opts.position) {
      panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.refDistance ?? 2;      // metres — matches world units
      panner.maxDistance = opts.maxDistance ?? 25;
      panner.rolloffFactor = opts.rolloff ?? 1.1;
      setPos(panner, opts.position);
      src.connect(gain).connect(panner).connect(bus);
    } else {
      src.connect(gain).connect(bus);
    }

    const when = this.ctx.currentTime + (opts.delay ?? 0);
    src.start(when);
    const handle = {
      name, src, gain, panner, bus: busName,
      stop: (fade = 0.06) => {
        try {
          gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
          src.stop(this.ctx.currentTime + fade);
        } catch (_) {}
        this._playing.delete(handle);
      },
      setPosition: (p) => { if (panner) setPos(panner, p); },
      setVolume: (v, t = 0.05) => gain.gain.setTargetAtTime(v, this.ctx.currentTime, t),
    };
    src.onended = () => this._playing.delete(handle);
    this._playing.add(handle);
    return handle;
  }

  /** A named looping sound (office ambience, radio). Calling twice is a no-op. */
  loop(name, opts = {}) {
    if (this._loops.has(name)) return this._loops.get(name);
    const h = this.play(name, { ...opts, loop: true });
    if (h) this._loops.set(name, h);
    return h;
  }

  stopLoop(name, fade = 0.4) {
    const h = this._loops.get(name);
    if (!h) return;
    h.stop(fade);
    this._loops.delete(name);
  }

  /** Cross-fade the music bus to a new track. */
  music(name, { fade = 1.2, volume = 1 } = {}) {
    const prev = this._loops.get('__music');
    if (prev) { prev.stop(fade); this._loops.delete('__music'); }
    if (!name) return null;
    const h = this.play(name, { bus: 'music', loop: true, volume: 0.001 });
    if (h) {
      h.setVolume(volume, fade / 3);
      this._loops.set('__music', h);
    }
    return h;
  }

  /** Update the WebAudio listener from a camera. Call once per frame. */
  setListener(camera) {
    if (!this._ready || !camera) return;
    const l = this.ctx.listener;
    const p = camera.position;
    this._listenerPos = { x: p.x, y: p.y, z: p.z };
    const e = camera.matrixWorld.elements;
    // three's camera looks down -Z; forward = -(col 2), up = col 1.
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  stopAll(fade = 0.15) {
    for (const h of [...this._playing]) h.stop(fade);
    this._loops.clear();
  }

  dispose() {
    this.stopAll(0.01);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this._ready = false;
  }
}

function setPos(panner, p) {
  if (panner.positionX) {
    panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z;
  } else if (panner.setPosition) {
    panner.setPosition(p.x, p.y, p.z);
  }
}

/** The minimum sound set named in DESIGN-DECISIONS.md "Audio". */
export const AUDIO_MANIFEST = {
  'ui.click':       'ui-click.ogg',
  'ui.hover':       'ui-hover.ogg',
  'ui.error':       'ui-error.ogg',
  'keyboard':       'keyboard.ogg',
  'mouse.click':    'mouse-click.ogg',
  'startup':        'retro-startup.ogg',
  'coffee':         'coffee-machine.ogg',
  'mail':           'mail-notification.ogg',
  'ambient.office': 'office-ambience.ogg',
  'ambient.crowd':  'crowd.ogg',
  'music.menu':     'music-menu.ogg',
  'music.design':   'music-design.ogg',
  'music.walk':     'music-walkthrough.ogg',
};
