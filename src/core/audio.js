// audio.js — a four-bus audio system that is never allowed to break the game.
//
// Buses come from assets/audio/mix.json, each with its own gain, all under a
// master. Every file is optional: a missing or undecodable sound logs one warning
// and then silently no-ops forever. The office must run before a single .ogg exists.
//
// Browsers block audio until a user gesture, so the context starts suspended and
// resumes on the first click/keypress. Positional sounds use a PannerNode driven
// by a THREE.Object3D each frame (no THREE.Audio dependency — we want the bus
// graph, not three's listener object model).

/**
 * TWO data files, both read, neither retyped:
 *
 *   assets/audio/manifest.json — what sounds exist, where their files are, which
 *     bus they belong on and how loud each one was authored:
 *       "sfx.coffee-machine": { ogg, m4a, kind, loop, gain, positional }
 *
 *   assets/audio/mix.json — how loud that actually comes out:
 *       effective = master x buses[kindToBus[kind]] x entry.gain
 *     The review page plays every sound through exactly this arithmetic, so the
 *     numbers the human signed off ARE these numbers. Round 2 shipped mix.json
 *     and taught the review page to honour it, but left this file with its own
 *     hardcoded bus table — which disagreed (radio on its own bus at 0.55, os on
 *     sfx at 0.8, against mix.json's radio->ambient 0.5 and os->ui 0.7). The
 *     review page was therefore promising a level the engine would not play.
 *     mix.json is now the only source of the mix, and DEFAULTS below exist purely
 *     so a failed fetch is quiet rather than silent.
 */
export const MANIFEST_PATH = 'assets/audio/manifest.json';
export const MIX_PATH = 'assets/audio/mix.json';

/** Mirror of assets/audio/mix.json, used only when the fetch fails. */
export const DEFAULT_MIX = Object.freeze({
  master: 0.9,
  buses: { music: 0.45, ambient: 0.5, sfx: 0.8, ui: 0.7 },
  kindToBus: { music: 'music', radio: 'ambient', amb: 'ambient', os: 'ui', ui: 'ui', sfx: 'sfx' },
});

/** Bus names in a mix, in a stable order. */
export function busNames(mix = DEFAULT_MIX) {
  return Object.keys(mix?.buses || DEFAULT_MIX.buses);
}

/** manifest `kind` -> mixer bus, straight out of the mix. */
export function busForKind(kind, mix = DEFAULT_MIX) {
  const map = mix?.kindToBus || DEFAULT_MIX.kindToBus;
  if (map[kind]) return map[kind];
  if (mix?.buses?.[kind]) return kind;          // a kind that is already a bus name
  return 'sfx';
}

/**
 * The one piece of arithmetic that has to agree with the review page:
 *   effective = master x busGain x assetGain
 * Pure, so the node check can call it with the same manifest entry the browser gets.
 */
export function effectiveGain(entry, mix = DEFAULT_MIX) {
  const master = Number.isFinite(mix?.master) ? mix.master : DEFAULT_MIX.master;
  let bus = busForKind(entry?.kind, mix);
  // A kind pointed at a bus the mix does not define would be a NaN gain node in
  // the class, so name the same fallback here.
  if (mix?.buses && mix.buses[bus] === undefined) bus = 'sfx';
  const busGain = mix?.buses?.[bus] ?? DEFAULT_MIX.buses[bus] ?? 0.8;
  const asset = typeof entry?.gain === 'number' ? entry.gain : 1;
  return { bus, master, busGain, asset, effective: master * busGain * asset };
}

/** Entries whose `kind` this mix cannot route. Should always be empty. */
export function validateManifest(manifest, mix = DEFAULT_MIX) {
  const map = mix?.kindToBus || DEFAULT_MIX.kindToBus;
  return Object.entries(manifest || {})
    .filter(([, e]) => e && e.kind && !map[e.kind] && !mix?.buses?.[e.kind])
    .map(([n, e]) => `${n} (kind "${e.kind}")`);
}

/**
 * Which codec this browser should be asked for. Every manifest entry ships both
 * an .ogg and an .m4a: Chrome/Firefox take the ogg, Safari — the browser on the
 * target MacBook — needs the m4a. Guessing wrong is silence, not a fallback,
 * because decodeAudioData rejects rather than negotiating.
 */
export function preferredCodec(audioEl = null) {
  const el = audioEl || (typeof document !== 'undefined' ? document.createElement('audio') : null);
  if (!el || !el.canPlayType) return 'ogg';
  const ogg = el.canPlayType('audio/ogg; codecs="vorbis"');
  if (ogg === 'probably' || ogg === 'maybe') return 'ogg';
  const m4a = el.canPlayType('audio/mp4; codecs="mp4a.40.2"');
  if (m4a === 'probably' || m4a === 'maybe') return 'm4a';
  return 'ogg';
}

const CODECS = ['ogg', 'm4a', 'mp3', 'wav'];

/**
 * manifest.json and mix.json are CONFIG, not content: their names never change, so
 * a browser will happily keep serving the copy it cached before the last deploy.
 * That is not a cosmetic problem — a stale manifest plays every sound at the old
 * level and silently drops any id added since. Caught on 2026-08-27 while checking
 * the mix in a live page: transferSize 0, os.boot.1 still in the manifest, every
 * level a round behind. 'no-cache' still uses the cache, it just revalidates first,
 * so the normal case is a 304 and no bytes. The audio FILES stay fully cacheable —
 * they are immutable for a given name.
 */
const CONFIG_FETCH = { cache: 'no-cache' };

/**
 * resolveSource(name, { manifest, prefer, basePath }) -> url | null
 * The preferred codec if the entry has it, otherwise the first one it does have.
 */
export function resolveSource(name, { manifest, prefer = 'ogg', basePath = 'assets/audio/' } = {}) {
  const e = manifest && manifest[name];
  if (!e) return null;
  if (typeof e === 'string') return basePath + e;              // legacy flat form
  const order = [prefer, ...CODECS.filter((c) => c !== prefer)];
  for (const c of order) if (e[c]) return basePath + e[c];
  return null;
}

export class AudioBus {
  constructor(opts = {}) {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.buffers = new Map();      // name -> AudioBuffer | null (null = known missing)
    this.loading = new Map();      // name -> Promise
    this.basePath = opts.basePath ?? 'assets/audio/';
    this.mix = normaliseMix(opts.mix || DEFAULT_MIX);
    this.mixPath = opts.mixPath ?? MIX_PATH;
    this._mixFromFile = !!opts.mix;          // an injected mix is not re-fetched
    // Bus gains live in the mix; `volumes` is the live copy the settings screen
    // moves. A bus with no value would set gain.value to undefined — a NaN gain
    // node, i.e. silence on everything routed through it — so it is always seeded
    // from the mix, never left blank.
    this.volumes = this._volumesFromMix();
    if (opts.volumes) Object.assign(this.volumes, opts.volumes);
    this._playing = new Set();
    this._loops = new Map();       // name -> node handle
    this._missing = new Set();
    this._ready = false;
    this._listenerPos = { x: 0, y: 0, z: 0 };
    this.manifest = opts.manifest || null;   // name -> entry, from manifest.json
    this.manifestPath = opts.manifestPath ?? MANIFEST_PATH;
    this.codec = opts.codec || null;         // resolved lazily: 'ogg' | 'm4a'
  }

  _volumesFromMix() {
    const v = { master: this.mix.master };
    for (const b of busNames(this.mix)) v[b] = this.mix.buses[b];
    return v;
  }

  get busList() { return busNames(this.mix); }

  /** Fetch assets/audio/mix.json. Never throws; a failure falls back to DEFAULT_MIX. */
  async loadMix(url = this.mixPath) {
    this._mixFromFile = true;
    try {
      const res = await fetch(url, CONFIG_FETCH);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.mix = normaliseMix(await res.json());
    } catch (err) {
      this.mix = normaliseMix(DEFAULT_MIX);
      console.warn(`[audio] mix ${url} unavailable — using the built-in default mix`, err);
    }
    this.volumes = this._volumesFromMix();
    this._applyVolumes();
    return this.mix;
  }

  /**
   * Fetch assets/audio/manifest.json. Never throws; a failure just means silence.
   * The mix has to be in place first — routing and levels come from it — so a
   * caller that only asks for the manifest still gets the real mix.
   */
  async loadManifest(url = this.manifestPath) {
    if (!this._mixFromFile) await this.loadMix();
    try {
      const res = await fetch(url, CONFIG_FETCH);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = await res.json();
      const bad = validateManifest(this.manifest, this.mix);
      if (bad.length) console.warn(`[audio] unroutable manifest kinds: ${bad.join(', ')}`);
      console.info(`[audio] manifest: ${Object.keys(this.manifest).length} sounds, codec ${this.preferred()}`);
    } catch (err) {
      console.warn(`[audio] manifest ${url} unavailable — running silent`, err);
      this.manifest = this.manifest || {};
    }
    return this.manifest;
  }

  /** Load the mix first, then the manifest — validation needs the mix. */
  async loadConfig() {
    await this.loadMix();
    await this.loadManifest();
    return this;
  }

  preferred() {
    if (!this.codec) this.codec = preferredCodec();
    return this.codec;
  }

  /** The url this build will actually fetch for a sound. */
  urlFor(name) {
    return resolveSource(name, { manifest: this.manifest, prefer: this.preferred(), basePath: this.basePath });
  }

  entry(name) { return this.manifest?.[name] || null; }

  /** Which bus a sound rides. */
  busOf(name) { return busForKind(this.entry(name)?.kind, this.mix); }

  /**
   * How loud `name` really comes out: master x bus x the asset's own gain, using
   * the LIVE bus values (so it tracks the settings screen). Positional sounds get
   * this at their reference distance and only ever get quieter than it.
   * Returns the same shape as the pure effectiveGain().
   */
  gainOf(name) {
    const e = this.entry(name) || {};
    const bus = busForKind(e.kind, this.mix);
    const master = this.volumes.master ?? this.mix.master;
    const busGain = this.volumes[bus] ?? this.mix.buses[bus] ?? 0.8;
    const asset = typeof e.gain === 'number' ? e.gain : 1;
    return { bus, master, busGain, asset, effective: master * busGain * asset };
  }

  /**
   * Load the manifest if it is not loaded, then load every sound in it.
   * Ambience and music are big; pass a filter to stage the download.
   */
  async preloadAll(filter = null) {
    if (!this.manifest) await this.loadManifest();
    const names = Object.keys(this.manifest).filter((n) => !filter || filter(n, this.manifest[n]));
    const out = await Promise.all(names.map((n) => this.load(n)));
    const ok = out.filter(Boolean).length;
    console.info(`[audio] ${ok}/${out.length} sounds decoded`);
    return ok;
  }

  /** Create the context. Safe to call before any gesture — it starts suspended. */
  init() {
    if (this.ctx) return this;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; console.warn('[audio] no WebAudio, running silent'); return this; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);
    for (const b of this.busList) {
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

  /** Rebuild any bus nodes the current mix needs, then push every value. */
  _applyVolumes() {
    if (!this._ready) return;
    for (const b of this.busList) {
      if (!this.buses[b]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses[b] = g;
      }
    }
    this.setMasterGain(this.volumes.master);
    for (const b of this.busList) this.setVolume(b, this.volumes[b]);
  }

  setVolume(bus, v) {
    this.volumes[bus] = v;
    if (!this._ready) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /**
   * Settings screen. `kind` may be a bus name ('ui') or a manifest kind ('os',
   * 'radio', 'amb') — both land on the right bus, so a settings slider labelled
   * "Radio" can pass 'radio' without knowing it shares the ambient bus.
   */
  setBusGain(kind, v) {
    const bus = this.mix.buses[kind] !== undefined ? kind : busForKind(kind, this.mix);
    this.setVolume(bus, v);
    return bus;
  }

  getBusGain(kind) {
    const bus = this.mix.buses[kind] !== undefined ? kind : busForKind(kind, this.mix);
    return this.volumes[bus];
  }

  setMasterGain(v) { this.setVolume('master', v); }
  getMasterGain() { return this.volumes.master; }

  mute(v = true) { this.setVolume('master', v ? 0 : this.mix.master); }

  /**
   * Load one sound. Never throws. Resolves to an AudioBuffer or null.
   * name is the key used by play(); file defaults to `<name>.ogg`.
   */
  async load(name, file = null) {
    if (!this.enabled) return null;
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (this.loading.has(name)) return this.loading.get(name);
    this.init();
    // The path comes from the manifest, never from the name. A name with no
    // manifest entry is a bug in the caller, not a filename to guess at.
    const url = file ? this.basePath + file : this.urlFor(name);
    if (!url) {
      if (!this._missing.has(name)) {
        this._missing.add(name);
        console.warn(`[audio] "${name}" is not in ${this.manifestPath} — nothing to play`);
      }
      this.buffers.set(name, null);
      return null;
    }
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

  /** Load a subset by name. Resolves when all attempts have settled. */
  async loadAll(names) {
    const list = Array.isArray(names) ? names : Object.keys(names || {});
    const out = await Promise.all(list.map((n) => this.load(n)));
    const ok = out.filter(Boolean).length;
    console.info(`[audio] ${ok}/${out.length} sounds loaded`);
    return ok;
  }

  /**
   * play(name, opts) -> handle | null
   * opts: { bus, volume=1, rate=1, loop=false, detune=0,
   *         position:{x,y,z}, refDistance=2, maxDistance=25, delay=0 }
   *
   * The gain node carries the ASSET gain (times any caller override). The bus
   * gain and the master are further down the graph, so what leaves the speakers
   * is master x bus x asset — the same product the review page showed. A
   * positional sound puts its panner between the asset gain and the bus, so it
   * starts at the asset gain and only attenuates from there with distance.
   */
  play(name, opts = {}) {
    if (!this.enabled) return null;
    this.init();
    const buf = this.buffers.get(name);
    if (buf === undefined) {
      // not loaded yet: kick off a load, play nothing this time (no queueing —
      // a sound that arrives 400 ms late is worse than no sound).
      this.load(name);
      return null;
    }
    if (buf === null) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

    // The manifest carries the sound's own intent: which bus it belongs on, its
    // authored gain, whether it loops and whether it is a point in the room.
    // opts still wins, so a caller can override any of it.
    const meta = this.entry(name) || {};

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop ?? !!meta.loop;
    src.playbackRate.value = opts.rate ?? 1;
    if (opts.detune && src.detune) src.detune.value = opts.detune;

    const gain = this.ctx.createGain();
    gain.gain.value = (opts.volume ?? 1) * (meta.gain ?? 1);

    const busName = opts.bus || busForKind(meta.kind, this.mix);
    const bus = this.buses[busName] || this.buses.sfx || this.master;

    let panner = null;
    const wantsPanner = opts.position && (opts.positional ?? meta.positional ?? true);
    if (wantsPanner) {
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

  /**
   * Cross-fade the music bus to a new track. `volume` is a multiplier ON TOP of
   * the track's authored gain, so music(name) plays at exactly the level the
   * review page showed.
   */
  music(name, { fade = 1.2, volume = 1 } = {}) {
    const prev = this._loops.get('__music');
    if (prev) { prev.stop(fade); this._loops.delete('__music'); }
    if (!name) return null;
    const meta = this.entry(name) || {};
    const target = volume * (meta.gain ?? 1);
    const h = this.play(name, { loop: true, volume: 0.001 });
    if (h) {
      h.setVolume(target, fade / 3);
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

/** A mix with every field present, whatever the JSON turned out to look like. */
function normaliseMix(raw) {
  const buses = { ...(raw && raw.buses ? raw.buses : DEFAULT_MIX.buses) };
  for (const [k, v] of Object.entries(buses)) if (!Number.isFinite(v)) buses[k] = DEFAULT_MIX.buses[k] ?? 0.8;
  const kindToBus = { ...(raw && raw.kindToBus ? raw.kindToBus : DEFAULT_MIX.kindToBus) };
  // A kind pointed at a bus that does not exist would be silent; route it to sfx.
  for (const [k, b] of Object.entries(kindToBus)) if (buses[b] === undefined) kindToBus[k] = 'sfx';
  return {
    master: Number.isFinite(raw && raw.master) ? raw.master : DEFAULT_MIX.master,
    buses,
    kindToBus,
  };
}

function setPos(panner, p) {
  if (panner.positionX) {
    panner.positionX.value = p.x; panner.positionY.value = p.y; panner.positionZ.value = p.z;
  } else if (panner.setPosition) {
    panner.setPosition(p.x, p.y, p.z);
  }
}
