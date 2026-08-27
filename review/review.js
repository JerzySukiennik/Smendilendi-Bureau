// review.js — the asset sign-off page.
//
// Three things happen here and nothing else:
//   1. Audio items are fetched, decoded through Web Audio, and their REAL waveform
//      is drawn from the AudioBuffer. Click to seek, L to loop (the loop toggle is
//      the actual question for music: can you hear the seam).
//   2. Model items spin on a turntable next to a 1.75 m figure with the real
//      bounding box in metres, rendered by ONE shared WebGLRenderer using a
//      scissor/viewport pass per visible tile. One renderer, never one per tile.
//   3. Every verdict lands in localStorage the instant it is made, and the whole
//      set is copyable as JSON — that is how the decisions get back to Claude.
//
// Same lighting rig and same palette as the game, imported from src/core/palette.js,
// so what is approved here is what ships.

import {
  Scene, Group, Mesh, PerspectiveCamera, WebGLRenderer, Box3, Box3Helper, Vector3,
  BoxGeometry, CylinderGeometry, SphereGeometry, CircleGeometry, PlaneGeometry,
  GridHelper, Color, MathUtils, PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeLightRig, materialFor, COLORS } from '../src/core/palette.js';
import { procShape } from '../src/model/catalog.js';

const STORE_KEY = 'smendilendi.review.decisions.v1';
const VERDICTS = ['approve', 'reject', 'needswork'];
const VERDICT_LABEL = { approve: 'Approve', reject: 'Reject', needswork: 'Needs work' };
const FIGURE_H = 1.75;                 // metres — the scale figure
const $ = s => document.querySelector(s);

// ---------------------------------------------------------------------------
// decisions store

const decisions = loadDecisions();

function loadDecisions() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}
function saveDecisions() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(decisions)); }
  catch (e) { toast('could not save to localStorage: ' + e.message); }
}
function setVerdict(id, verdict) {
  const d = decisions[id] || (decisions[id] = {});
  d.verdict = d.verdict === verdict ? null : verdict;   // pressing the same key clears it
  if (!d.verdict && !d.note) delete decisions[id]; else d.at = new Date().toISOString();
  saveDecisions(); refreshItem(id); refreshCounters(); refreshExport();
}
function setNote(id, note) {
  const d = decisions[id] || (decisions[id] = {});
  d.note = note;
  if (!d.verdict && !d.note) delete decisions[id]; else d.at = new Date().toISOString();
  saveDecisions(); refreshCounters(); refreshExport();
}
function setTrim(id, trim) {
  const d = decisions[id] || (decisions[id] = {});
  d.trim = trim === 1 ? undefined : +trim.toFixed(2);
  if (d.trim === undefined) delete d.trim;
  if (!d.verdict && !d.note && d.trim === undefined) delete decisions[id]; else d.at = new Date().toISOString();
  saveDecisions(); refreshExport();
}
const verdictOf = id => decisions[id]?.verdict || null;
const trimOf = id => decisions[id]?.trim ?? 1;

// How loud a sound is when the game plays it: master x bus x the asset's own
// gain, straight out of assets/audio/mix.json. `playRaw` compares against the
// untouched file.
let playRaw = false;
const inGameGain = item => (item.mix?.effective ?? 0.9);
const playbackGain = item => (playRaw ? 0.9 : inGameGain(item) * trimOf(item.id));

// ---------------------------------------------------------------------------
// page state

let DOC = { batches: [] };
const items = [];                 // flat, in page order: { item, batch, el, kind, ... }
const byId = new Map();
let focusIndex = 0;

boot();

async function boot() {
  let res;
  try {
    res = await fetch('batches.json?' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DOC = await res.json();
  } catch (e) {
    fatal('Could not load <code>review/batches.json</code>: ' + e.message
      + '<br>Run <code>node tools/make-batch.mjs all</code> and reload.');
    return;
  }
  if (!DOC.batches?.length) {
    fatal('<code>batches.json</code> has no batches. Run <code>node tools/make-batch.mjs all</code>.');
    return;
  }
  buildPage();
  initAudio();
  await initThree();
  wireGlobalKeys();
  refreshCounters();
  refreshExport();
  setFocus(0, false);
}

function fatal(html) {
  const d = document.createElement('div');
  d.className = 'fatal';
  d.innerHTML = `<b>Cannot start.</b> ${html}`;
  $('#batches').appendChild(d);
}

// ---------------------------------------------------------------------------
// DOM

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildPage() {
  const host = $('#batches');
  for (const batch of DOC.batches) {
    const sec = document.createElement('section');
    sec.dataset.batch = batch.id;
    const warn = /NOT DELIVERED|not on disk|placeholder/i.test(batch.note || '');
    sec.innerHTML = `
      <h2>${esc(batch.title)} <span class="tally" data-tally></span></h2>
      <div class="batchnote${warn ? ' warn' : ''}">${esc(batch.note || '')}</div>
      <div class="bar" data-bar style="margin-bottom:14px"><i></i></div>
      <div class="${batch.kind === 'model' ? 'tiles' : 'rows'}" data-list></div>`;
    host.appendChild(sec);

    const list = sec.querySelector('[data-list]');
    for (const item of batch.items) {
      const rec = batch.kind === 'model'
        ? buildModelTile(item, batch)
        : buildAudioRow(item, batch);
      rec.batch = batch;
      rec.kind = batch.kind;
      rec.index = items.length;
      items.push(rec);
      byId.set(item.id, rec);
      list.appendChild(rec.el);
    }
  }
}

/** The Approve / Reject / Needs work strip plus the note field. */
function decideBlock(item) {
  const wrap = document.createElement('div');
  wrap.className = 'decide';
  wrap.innerHTML = `
    <div class="verdicts">
      ${VERDICTS.map(v => `<button type="button" data-v="${v}" aria-pressed="false">
        ${VERDICT_LABEL[v]}<kbd>${v[0].toUpperCase()}</kbd></button>`).join('')}
    </div>
    <input type="text" data-note placeholder="note (optional)" spellcheck="false">`;
  for (const b of wrap.querySelectorAll('button')) {
    b.addEventListener('click', () => { setVerdict(item.id, b.dataset.v); setFocus(byId.get(item.id).index, false); });
  }
  const note = wrap.querySelector('[data-note]');
  note.value = decisions[item.id]?.note || '';
  note.addEventListener('input', () => setNote(item.id, note.value));
  note.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Enter') note.blur();
  });
  return wrap;
}

function metaChips(item) {
  const m = item.meta || {};
  let m2;
  const bits = [];
  if (m.duration) bits.push(`<span class="chip">${esc(m.duration)}</span>`);
  if (item.loop) bits.push(`<span class="chip">loops</span>`);
  if (m.origTitle || m.author) {
    const credit = [m.origTitle, m.author].filter(Boolean).join(' — ');
    bits.push(`<span class="chip">${esc(credit)}</span>`);
  }
  const lic = m.licence || 'unrecorded';
  const licShort = /^CC0/i.test(lic) ? 'CC0' : lic;
  bits.push(`<span class="chip${/unrecorded|unknown/i.test(lic) ? ' bad' : ''}" title="${esc(lic)}">${esc(licShort)}</span>`);
  if (m.source) bits.push(`<a href="${esc(m.source)}" target="_blank" rel="noopener">source ↗</a>`);
  else bits.push(`<span class="chip bad">no source link</span>`);
  if (m2 = item.mix) {
    const pct = Math.round(inGameGain(item) * 100);
    const chain = `master ${m2.master} x ${m2.bus} bus ${m2.busGain} x asset ${m2.asset} = ${m2.effective}`;
    bits.push(`<span class="chip" title="${esc(chain)}">${esc(m2.bus)} bus · ${pct}% in game</span>`);
    if (m2.positional) bits.push(`<span class="chip" title="Positional in the world — this is the level at the source, the loudest it ever gets.">3D</span>`);
  }
  if (item.missing) bits.push(`<span class="chip bad">file not delivered</span>`);
  return bits.join('');
}

function buildAudioRow(item, batch) {
  const el = document.createElement('div');
  el.className = 'row pending' + (item.missing ? ' missing' : '');
  el.tabIndex = -1;
  el.dataset.id = item.id;

  const play = document.createElement('button');
  play.className = 'play'; play.type = 'button';
  play.dataset.state = 'idle';
  play.textContent = '▶';
  play.setAttribute('aria-label', 'play ' + item.name);

  const what = document.createElement('div');
  what.className = 'what';
  what.innerHTML = `<b>${esc(item.name)}</b>
    <div class="why">${esc(item.why || '')}</div>
    <div class="meta">${metaChips(item)}</div>`;

  const wave = document.createElement('div');
  wave.className = 'wave';
  const canvas = document.createElement('canvas');
  const state = document.createElement('div'); state.className = 'state'; state.textContent = 'waiting';
  const time = document.createElement('div'); time.className = 'time'; time.textContent = '';
  wave.append(canvas, state, time);

  const waveCol = document.createElement('div');
  waveCol.className = 'wavecol';
  waveCol.appendChild(wave);
  if (item.loop) {
    const lb = document.createElement('button');
    lb.className = 'loopbtn'; lb.type = 'button'; lb.textContent = 'loop';
    lb.setAttribute('aria-pressed', 'true');
    wave.appendChild(lb);
    lb.addEventListener('click', () => toggleLoop(item.id));
  }

  const rec = { id: item.id, item, el, play, canvas, state, time, wave, peaks: null, buffer: null,
                loop: !!item.loop, decoded: false, failed: false };

  // Level trim. The slider does not change what you hear relative to the game —
  // it changes what the game will do. Anything you move here ships as the new
  // gain for that sound.
  if (item.mix) {
    const trim = document.createElement('div');
    trim.className = 'trim';
    const range = document.createElement('input');
    range.type = 'range'; range.min = '0'; range.max = '2'; range.step = '0.05';
    range.value = String(trimOf(item.id));
    range.setAttribute('aria-label', 'level trim for ' + item.name);
    const read = document.createElement('span');
    read.className = 'trimread';
    const paint = () => {
      const t = +range.value;
      read.textContent = t === 1 ? 'level ok' : `${t > 1 ? '+' : ''}${Math.round((t - 1) * 100)}%`;
      read.dataset.changed = String(t !== 1);
      trim.title = `Plays at ${Math.round(inGameGain(item) * t * 100)}% — the level this sound will have in the game.`;
    };
    paint();
    range.addEventListener('input', () => {
      paint();
      if (playing && playing.id === item.id && !playRaw) {
        playing.gain.gain.setTargetAtTime(playbackGain(item), ctx().currentTime, 0.02);
      }
    });
    range.addEventListener('change', () => { setTrim(item.id, +range.value); paint(); });
    range.addEventListener('dblclick', () => { range.value = '1'; setTrim(item.id, 1); paint(); });
    trim.append(range, read);
    rec.trimEl = trim; rec.trimRange = range; rec.trimPaint = paint;
    waveCol.appendChild(trim);
  }

  play.addEventListener('click', () => togglePlay(item.id));
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    seek(item.id, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  });
  el.addEventListener('mousedown', () => setFocus(rec.index, false));

  el.append(play, what, waveCol, decideBlock(item));
  return rec;
}

function buildModelTile(item, batch) {
  const el = document.createElement('div');
  el.className = 'tile pending';
  el.tabIndex = -1;
  el.dataset.id = item.id;

  const [w, h, d] = item.size || [1, 1, 1];
  const m = item.meta || {};
  const extra = [
    m.category, m.anchor && m.anchor !== 'floor' ? `${m.anchor}-mounted` : null,
    m.seatHeight ? `seat ${m.seatHeight} m` : null,
    m.workHeight ? `work top ${m.workHeight} m` : null,
    m.clearance,
  ].filter(Boolean);

  el.innerHTML = `
    <div class="stage" data-stage>
      <div class="loading" data-loading>loading</div>
      ${item.present === false ? '<div class="proxy">proxy solid · GLB not delivered</div>' : ''}
      <div class="hint">click to enlarge</div>
      <div class="dims" data-dims>
        <div class="scalebar" data-scalebar></div>
        <span class="box">1 m &nbsp;·&nbsp; ${w} × ${h} × ${d} m</span>
      </div>
    </div>
    <div class="tilebody">
      <div class="head"><b>${esc(item.name)}</b><span class="price">${item.price ?? '—'} units</span></div>
      <div class="why">${esc(item.why || '')}</div>
      <div class="meta">${extra.map(x => `<span>${esc(x)}</span>`).join('')}</div>
    </div>`;

  const body = el.querySelector('.tilebody');
  body.appendChild(decideBlock(item));

  const rec = {
    id: item.id, item, el,
    stage: el.querySelector('[data-stage]'),
    loading: el.querySelector('[data-loading]'),
    scalebar: el.querySelector('[data-scalebar]'),
    group: null, built: false, visible: false, spin: true, angle: Math.PI * 0.15,
    frame: null, requested: false,
  };
  rec.stage.addEventListener('click', () => { setFocus(rec.index, false); openBig(rec); });
  el.addEventListener('mousedown', e => { if (!e.target.closest('.stage')) setFocus(rec.index, false); });
  return rec;
}

function refreshItem(id) {
  const rec = byId.get(id);
  if (!rec) return;
  const v = verdictOf(id);
  rec.el.classList.remove('pending', ...VERDICTS);
  rec.el.classList.add(v || 'pending');
  for (const b of rec.el.querySelectorAll('.verdicts button')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === v));
  }
  if (bigRec && bigRec.id === id) syncBigDecide();
}

function refreshCounters() {
  let allDone = 0, allTotal = 0;
  for (const sec of document.querySelectorAll('[data-batch]')) {
    const batch = DOC.batches.find(b => b.id === sec.dataset.batch);
    const total = batch.items.length;
    const done = batch.items.filter(i => verdictOf(i.id)).length;
    allDone += done; allTotal += total;
    sec.querySelector('[data-tally]').textContent = `${done} of ${total} decided`;
    const bar = sec.querySelector('[data-bar]');
    bar.querySelector('i').style.width = (total ? done / total * 100 : 0) + '%';
    bar.classList.toggle('mixed', batch.items.some(i => ['reject', 'needswork'].includes(verdictOf(i.id))));
    for (const i of batch.items) refreshItemClassOnly(i.id);
  }
  $('#overallCount').textContent = `${allDone} of ${allTotal} decided`;
  $('#overallBar').querySelector('i').style.width = (allTotal ? allDone / allTotal * 100 : 0) + '%';
}
function refreshItemClassOnly(id) {
  const rec = byId.get(id); if (!rec) return;
  const v = verdictOf(id);
  rec.el.classList.remove('pending', ...VERDICTS);
  rec.el.classList.add(v || 'pending');
  for (const b of rec.el.querySelectorAll('.verdicts button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
}

// ---------------------------------------------------------------------------
// focus

function setFocus(i, scroll = true) {
  if (!items.length) return;
  focusIndex = (i % items.length + items.length) % items.length;
  for (const r of items) r.el.classList.remove('focused');
  const rec = items[focusIndex];
  rec.el.classList.add('focused');
  if (scroll) rec.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const focused = () => items[focusIndex];

// ---------------------------------------------------------------------------
// audio — real decoding, real waveforms

let actx = null;
let playing = null;      // { id, src, gain, startedAt, offset }

function initAudio() {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const rec = byId.get(e.target.dataset.id);
      if (rec && rec.kind === 'audio') { decodeItem(rec); io.unobserve(e.target); }
    }
  }, { rootMargin: '400px 0px' });
  for (const r of items) if (r.kind === 'audio') io.observe(r.el);
  window.addEventListener('resize', () => { for (const r of items) if (r.kind === 'audio' && r.decoded) drawWave(r); });
}

function ctx() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

async function decodeItem(rec) {
  if (rec.decoded || rec.failed || rec.pending) return;
  rec.pending = true;
  rec.state.textContent = 'decoding';
  const urls = [rec.item.src?.ogg, rec.item.src?.m4a].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      rec.buffer = await ctx().decodeAudioData(buf);
      rec.decoded = true; rec.pending = false;
      rec.peaks = computePeaks(rec.buffer, 900);
      rec.state.textContent = '';
      rec.time.textContent = fmtTime(rec.buffer.duration);
      // the decoded duration is the truth; correct the manifest's if it disagrees
      const chip = rec.el.querySelector('.meta .chip');
      if (chip && /^\d+:\d\d$/.test(chip.textContent.trim())) chip.textContent = fmtTime(rec.buffer.duration);
      drawWave(rec);
      return;
    } catch (e) { rec.lastError = e.message; }
  }
  rec.pending = false; rec.failed = true;
  rec.state.textContent = rec.item.missing ? 'not delivered' : 'failed: ' + (rec.lastError || 'unknown');
  rec.play.disabled = true;
  drawWave(rec);
}

/** Min/max peak pairs per column, straight off the AudioBuffer. No fakery. */
function computePeaks(buffer, columns) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const n = chans[0].length;
  const step = Math.max(1, Math.floor(n / columns));
  const mins = new Float32Array(columns), maxs = new Float32Array(columns);
  for (let i = 0; i < columns; i++) {
    const a = i * step, b = Math.min(n, a + step);
    let lo = 0, hi = 0;
    for (let j = a; j < b; j++) {
      let v = 0;
      for (let c = 0; c < chans.length; c++) v += chans[c][j];
      v /= chans.length;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    mins[i] = lo; maxs[i] = hi;
  }
  return { mins, maxs, columns };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawWave(rec) {
  const cv = rec.canvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(60, cv.clientWidth), h = Math.max(30, cv.clientHeight);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  if (!rec.peaks) return;
  const isPlaying = playing && playing.id === rec.id;
  const pos = currentPos(rec);
  const frac = rec.buffer ? Math.min(1, pos / rec.buffer.duration) : 0;

  // baseline
  g.strokeStyle = cssVar('--rule'); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2 + .5); g.lineTo(w, h / 2 + .5); g.stroke();

  const { mins, maxs, columns } = rec.peaks;
  const played = cssVar('--accent'), rest = cssVar('--dim');
  for (let i = 0; i < columns; i++) {
    const x = i / columns * w;
    g.strokeStyle = (i / columns) <= frac && (isPlaying || rec.seekFrac != null) ? played : rest;
    g.globalAlpha = (i / columns) <= frac && (isPlaying || rec.seekFrac != null) ? 0.95 : 0.55;
    const y1 = h / 2 - maxs[i] * (h / 2 - 2);
    const y2 = h / 2 - mins[i] * (h / 2 - 2);
    g.beginPath();
    g.moveTo(x + .5, y1);
    g.lineTo(x + .5, Math.max(y2, y1 + 0.7));
    g.stroke();
  }
  g.globalAlpha = 1;

  // playhead
  if (isPlaying || rec.seekFrac != null) {
    const x = frac * w;
    g.strokeStyle = cssVar('--accent'); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
}

function currentPos(rec) {
  if (playing && playing.id === rec.id) {
    const t = playing.offset + (ctx().currentTime - playing.startedAt);
    return rec.loop && rec.buffer ? t % rec.buffer.duration : Math.min(t, rec.buffer?.duration ?? 0);
  }
  if (rec.seekFrac != null && rec.buffer) return rec.seekFrac * rec.buffer.duration;
  return 0;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60), s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stopAudio() {
  if (!playing) return;
  const rec = byId.get(playing.id);
  try { playing.src.onended = null; playing.src.stop(); } catch {}
  playing = null;
  if (rec) { rec.play.dataset.state = 'idle'; rec.play.textContent = '▶'; drawWave(rec); rec.time.textContent = fmtTime(rec.buffer?.duration); }
}

function togglePlay(id, offsetFrac = null) {
  const rec = byId.get(id);
  if (!rec || rec.kind !== 'audio') return;
  if (playing && playing.id === id && offsetFrac == null) { stopAudio(); return; }
  stopAudio();
  if (!rec.decoded) { decodeItem(rec).then(() => { if (rec.decoded) togglePlay(id, offsetFrac); }); return; }

  const c = ctx();
  const src = c.createBufferSource();
  src.buffer = rec.buffer;
  src.loop = rec.loop;
  const gain = c.createGain();
  gain.gain.value = playbackGain(rec.item);
  src.connect(gain).connect(c.destination);
  const offset = (offsetFrac ?? rec.seekFrac ?? 0) * rec.buffer.duration;
  src.start(0, offset);
  playing = { id, src, gain, startedAt: c.currentTime, offset };
  rec.play.dataset.state = 'playing'; rec.play.textContent = '■';
  src.onended = () => { if (playing && playing.src === src) stopAudio(); };
  tickAudio();
}

function seek(id, frac) {
  const rec = byId.get(id);
  if (!rec || !rec.decoded) return;
  rec.seekFrac = frac;
  if (playing && playing.id === id) togglePlay(id, frac);
  else drawWave(rec);
}

function toggleLoop(id) {
  const rec = byId.get(id);
  if (!rec || rec.kind !== 'audio') return;
  rec.loop = !rec.loop;
  const b = rec.wave.querySelector('.loopbtn');
  if (b) b.setAttribute('aria-pressed', String(rec.loop));
  if (playing && playing.id === id) { playing.src.loop = rec.loop; }
  toast(`${rec.item.name}: loop ${rec.loop ? 'on' : 'off'}`);
}

let audioRaf = 0;
function tickAudio() {
  cancelAnimationFrame(audioRaf);
  const step = () => {
    if (!playing) return;
    const rec = byId.get(playing.id);
    if (rec) { drawWave(rec); rec.time.textContent = `${fmtTime(currentPos(rec))} / ${fmtTime(rec.buffer.duration)}`; }
    audioRaf = requestAnimationFrame(step);
  };
  audioRaf = requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// three.js — ONE renderer, one scissor pass per visible tile

let renderer, scene, rig, tileCam, bigCam, controls, modelSlot, figure, ground, boxHelper;
let modelRecs = [];
let bigRec = null;
const gltf = new GLTFLoader();
const _v = new Vector3(), _v2 = new Vector3();

/** slot name (proc-shapes) -> palette material id */
function slotMaterial(slot, category) {
  switch (slot) {
    case 'metal': return materialFor('metal', { flatShading: true });
    case 'glass': return materialFor('glass');
    case 'ceramic': return materialFor('tile', { flatShading: true });
    case 'foliage': return materialFor('grass', { flatShading: true });
    case 'fabric': return materialFor('plaster-warm', { flatShading: true });
    case 'accent': return materialFor('accent', { flatShading: true });
    case 'secondary': return materialFor('concrete-dark', { flatShading: true });
    default:
      if (category === 'sanitary') return materialFor('tile', { flatShading: true });
      if (category === 'kitchen') return materialFor('concrete', { flatShading: true });
      if (category === 'plants') return materialFor('grass', { flatShading: true });
      if (category === 'lighting') return materialFor('metal-warm', { flatShading: true });
      if (category === 'windows' || category === 'doors') return materialFor('wood-mid', { flatShading: true });
      return materialFor('wood-light', { flatShading: true });
  }
}

async function initThree() {
  modelRecs = items.filter(r => r.kind === 'model');
  const canvas = $('#gl');
  if (!modelRecs.length) { canvas.style.display = 'none'; return; }

  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { toast('WebGL unavailable: ' + e.message); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  sizeRenderer();
  window.addEventListener('resize', () => { sizeRenderer(); for (const r of modelRecs) if (r.frame) layoutScalebar(r); });

  // one scene, reused by every pass — the model group is swapped in per tile
  scene = new Scene();
  rig = makeLightRig(scene, { timeOfDay: 'afternoon', indoor: false, radius: 3.2, shadowMapSize: 1024 });

  ground = new Mesh(new CircleGeometry(7, 48), materialFor('paving'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new GridHelper(10, 10, COLORS.concreteDk, COLORS.concreteDk);
  grid.material.transparent = true; grid.material.opacity = 0.32;
  grid.position.y = 0.003;
  scene.add(grid);

  figure = buildFigure();
  scene.add(figure);

  modelSlot = new Group();
  scene.add(modelSlot);

  boxHelper = new Box3Helper(new Box3(), new Color(COLORS.accent));
  boxHelper.material.transparent = true;
  boxHelper.material.opacity = 0.55;
  boxHelper.material.depthTest = false;
  scene.add(boxHelper);

  tileCam = new PerspectiveCamera(30, 1, 0.05, 200);
  bigCam = new PerspectiveCamera(35, 1, 0.05, 200);
  controls = new OrbitControls(bigCam, $('#big'));
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.6;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.enabled = false;

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const rec = byId.get(e.target.dataset.id);
      if (!rec) continue;
      rec.visible = e.isIntersecting;
      if (e.isIntersecting) buildModel(rec);
    }
  }, { rootMargin: '200px 0px' });
  for (const r of modelRecs) io.observe(r.el);

  renderLoop();
}

function sizeRenderer() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

/** A 1.75 m person, as a flat silhouette solid. The whole point of the tile. */
function buildFigure() {
  const g = new Group();
  const mat = materialFor('ink', { transparent: true, opacity: 0.62 });
  const add = (geo, x, y, z = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true;
    g.add(m);
  };
  add(new SphereGeometry(0.105, 16, 12), 0, 1.645);
  add(new CylinderGeometry(0.045, 0.05, 0.08, 10), 0, 1.50);
  add(new BoxGeometry(0.40, 0.55, 0.21), 0, 1.20);
  add(new BoxGeometry(0.34, 0.20, 0.20), 0, 0.87);
  add(new BoxGeometry(0.145, 0.78, 0.17), -0.088, 0.39);
  add(new BoxGeometry(0.145, 0.78, 0.17), 0.088, 0.39);
  add(new BoxGeometry(0.10, 0.62, 0.13), -0.252, 1.17);
  add(new BoxGeometry(0.10, 0.62, 0.13), 0.252, 1.17);
  g.userData.height = FIGURE_H;
  return g;
}

/** Build the tile's model group: the GLB if it exists, otherwise the game's own proxy solid. */
async function buildModel(rec) {
  if (rec.built || rec.requested) return;
  rec.requested = true;
  const item = rec.item;
  let group = null;

  if (item.glb && item.present !== false) {
    try {
      const g = await gltf.loadAsync(item.glb);
      group = g.scene;
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    } catch (e) {
      console.warn(`[review] ${item.id}: GLB failed (${e.message}) — falling back to the proxy solid`);
      rec.el.querySelector('.stage').insertAdjacentHTML('afterbegin',
        '<div class="proxy">proxy solid · GLB failed to load</div>');
    }
  }
  if (!group) group = buildProxy(item);

  // measure, never assume (ARCHITECTURE rule 6)
  const box = new Box3().setFromObject(group);
  const size = box.getSize(_v).clone();
  const declared = item.size || [size.x, size.y, size.z];
  const drift = Math.max(...[0, 1, 2].map(i => {
    const d = declared[i]; const a = [size.x, size.y, size.z][i];
    return d > 0.001 ? Math.abs(a - d) / d : 0;
  }));
  if (drift > 0.02) {
    console.warn(`[review] ${item.id}: bbox drift ${(drift * 100).toFixed(1)}% — declared `
      + `${declared.join('×')} m, measured ${[size.x, size.y, size.z].map(v => v.toFixed(3)).join('×')} m`);
    rec.drift = drift;
    const meta = rec.el.querySelector('.tilebody .meta');
    if (meta) meta.insertAdjacentHTML('beforeend',
      `<span style="color:var(--wip)">bbox drift ${(drift * 100).toFixed(1)}%</span>`);
  }

  // sit it on the ground, centred on its own footprint
  group.position.x -= (box.min.x + box.max.x) / 2;
  group.position.z -= (box.min.z + box.max.z) / 2;
  group.position.y -= box.min.y;
  const mount = item.meta?.mount || 0;
  if (mount) group.position.y += mount;

  const holder = new Group();
  holder.add(group);
  rec.group = holder;
  rec.localBox = new Box3().setFromObject(holder);
  rec.built = true;
  rec.loading.remove();

  // framing: model turntable radius + the figure standing beside it
  const w = size.x, d = size.z, h = size.y + mount;
  const R = 0.5 * Math.hypot(w, d);
  const figX = -(R + 0.55);
  const total = new Box3(
    new Vector3(figX - 0.30, 0, -Math.max(R, 0.25)),
    new Vector3(R, Math.max(h, FIGURE_H), Math.max(R, 0.25)),
  );
  rec.frame = { R, figX, total, h, w, d };
  layoutScalebar(rec);
}

function buildProxy(item) {
  const g = new Group();
  let shape = null;
  try { shape = procShape(item.id); } catch { shape = null; }
  if (!shape) {
    const [w, h, d] = item.size || [1, 1, 1];
    const m = new Mesh(new BoxGeometry(w, h, d), slotMaterial('primary', item.meta?.category));
    m.position.y = h / 2; m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
  }
  for (const p of shape.parts) {
    let geo;
    if (p.type === 'box') geo = new BoxGeometry(p.size[0], p.size[1], p.size[2]);
    else if (p.type === 'cyl') geo = new CylinderGeometry(p.rTop, p.rBottom, p.h, p.seg || 16);
    else geo = new PlaneGeometry(p.size[0], p.size[1]);
    const m = new Mesh(geo, slotMaterial(p.slot, item.meta?.category));
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/**
 * Fit a camera to a box from a fixed 3/4 direction. Returns the distance so the
 * scale bar can be computed from the same numbers the camera used.
 */
function fitCamera(cam, box, aspect, pad = 1.16) {
  const size = box.getSize(_v);
  const center = box.getCenter(_v2).clone();
  const vFov = MathUtils.degToRad(cam.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dist = Math.max(
    (size.y / 2) / Math.tan(vFov / 2),
    (size.x / 2) / Math.tan(hFov / 2),
  ) * pad + size.z * 0.5;
  const az = MathUtils.degToRad(34), el = MathUtils.degToRad(20);
  cam.aspect = aspect;
  cam.position.set(
    center.x + Math.sin(az) * Math.cos(el) * dist,
    center.y + Math.sin(el) * dist,
    center.z + Math.cos(az) * Math.cos(el) * dist,
  );
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  return { dist, center };
}

/** Metres-per-pixel at the model plane → the width of the "1 m" bar under the tile. */
function layoutScalebar(rec) {
  if (!rec.frame || !rec.scalebar) return;
  const r = rec.stage.getBoundingClientRect();
  if (r.width < 10) return;
  const aspect = r.width / r.height;
  const { dist } = fitCamera(tileCam, rec.frame.total, aspect);
  const visibleH = 2 * dist * Math.tan(MathUtils.degToRad(tileCam.fov) / 2);
  const pxPerM = r.height / visibleH;
  rec.scalebar.style.width = Math.max(12, Math.round(pxPerM)) + 'px';
}

let last = performance.now();
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!renderer) return;

  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);

  const clear = new Color(cssVar('--tile') || '#efe9dc');

  if (bigRec) {
    controls.update();
    if (bigRec.spin) bigRec.angle += dt * 0.35;
    const el = $('#big');
    const r = el.getBoundingClientRect();
    stage(bigRec, bigCam, r, clear, false);
    return;
  }

  for (const rec of modelRecs) {
    if (!rec.visible || !rec.built) continue;
    const r = rec.stage.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width < 4 || r.height < 4) continue;
    if (rec.spin) rec.angle += dt * 0.35;
    stage(rec, tileCam, r, clear, true);
  }
}

/** Swap this record's model into the shared scene and render it into one scissor rect. */
function stage(rec, cam, r, clear, fit) {
  modelSlot.clear();
  rec.group.rotation.y = rec.angle;
  modelSlot.add(rec.group);

  const f = rec.frame;
  figure.position.set(f.figX, 0, 0);
  figure.visible = true;

  // bounding box of the model itself, in world space, drawn as a wire cage
  boxHelper.box.setFromObject(rec.group);
  boxHelper.visible = true;

  rig.focus(0, 0);
  if (fit) fitCamera(cam, f.total, r.width / r.height);
  else { cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); }

  const y = window.innerHeight - r.bottom;
  renderer.setViewport(r.left, y, r.width, r.height);
  renderer.setScissor(r.left, y, r.width, r.height);
  renderer.setScissorTest(true);
  renderer.setClearColor(clear, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, cam);
  renderer.setScissorTest(false);
}

// ---------------------------------------------------------------------------
// big view

function openBig(rec) {
  if (!rec.built) { buildModel(rec).then(() => rec.built && openBig(rec)); return; }
  bigRec = rec;
  const el = $('#big');
  el.hidden = false; el.classList.add('open');
  $('#gl').classList.add('modal');
  const [w, h, d] = rec.item.size || [];
  $('#bigName').textContent = rec.item.name;
  $('#bigMeta').textContent = `${w} × ${h} × ${d} m · ${rec.item.price} units · ${rec.item.meta?.category || ''}`
    + (rec.item.present === false ? ' · PROXY SOLID, GLB not delivered' : '');
  $('#bigWhy').textContent = rec.item.why || '';
  const r = el.getBoundingClientRect();
  const { center, dist } = fitCamera(bigCam, rec.frame.total, r.width / r.height, 1.05);
  controls.target.copy(center);
  controls.enabled = true;
  controls.update();
  syncBigDecide();
}

function closeBig() {
  if (!bigRec) return;
  bigRec = null;
  const el = $('#big');
  el.classList.remove('open'); el.hidden = true;
  $('#gl').classList.remove('modal');
  controls.enabled = false;
}

function syncBigDecide() {
  if (!bigRec) return;
  const host = $('#bigDecide');
  const v = verdictOf(bigRec.id);
  host.innerHTML = `<div class="verdicts">${VERDICTS.map(x =>
    `<button type="button" data-v="${x}" aria-pressed="${x === v}">${VERDICT_LABEL[x]}<kbd>${x[0].toUpperCase()}</kbd></button>`).join('')}</div>`;
  for (const b of host.querySelectorAll('button')) b.addEventListener('click', () => setVerdict(bigRec.id, b.dataset.v));
}

$('#bigClose').addEventListener('click', closeBig);
$('#big').addEventListener('click', e => { if (e.target.classList.contains('backdrop')) closeBig(); });

// ---------------------------------------------------------------------------
// export

function buildExport() {
  const list = [], pending = [];
  const counts = { approve: 0, reject: 0, needswork: 0 };
  for (const rec of items) {
    const d = decisions[rec.id];
    if (d?.verdict) {
      counts[d.verdict]++;
      list.push({ id: rec.id, batch: rec.batch.id, name: rec.item.name, verdict: d.verdict, note: d.note || '', at: d.at,
                  ...(d.trim ? { trim: d.trim, newGain: +((rec.item.mix?.asset ?? 1) * d.trim).toFixed(3) } : {}) });
    } else {
      pending.push(rec.id);
      if (d?.note || d?.trim) list.push({ id: rec.id, batch: rec.batch.id, name: rec.item.name, verdict: null, note: d.note || '', at: d.at,
                  ...(d.trim ? { trim: d.trim, newGain: +((rec.item.mix?.asset ?? 1) * d.trim).toFixed(3) } : {}) });
    }
  }
  return {
    project: 'smendilendi-bureau',
    kind: 'asset-review',
    at: new Date().toISOString(),
    summary: { total: items.length, decided: items.length - pending.length, ...counts },
    decisions: list,
    pending,
    levelChanges: list.filter(d => d.trim).map(d => ({ id: d.id, newGain: d.newGain })),
  };
}

function refreshExport() {
  const doc = buildExport();
  $('#json').textContent = JSON.stringify(doc, null, 2);
  const s = doc.summary;
  $('#exportSummary').textContent =
    `${s.decided} of ${s.total} decided — ${s.approve} approved, ${s.needswork} need work, ${s.reject} rejected`;
}

$('#copyBtn').addEventListener('click', async () => {
  const text = $('#json').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('decisions copied — paste them back to Claude');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? 'decisions copied — paste them back to Claude' : 'copy blocked — select the JSON below manually');
  }
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([$('#json').textContent], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'decisions.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('downloaded — if you cannot find it, use Copy instead');
});

$('#resetBtn').addEventListener('click', () => {
  if (!Object.keys(decisions).length) { toast('nothing to clear'); return; }
  if (!confirm('Clear every recorded decision on this page?')) return;
  for (const k of Object.keys(decisions)) delete decisions[k];
  saveDecisions();
  for (const rec of items) {
    const n = rec.el.querySelector('[data-note]'); if (n) n.value = '';
    if (rec.trimRange) { rec.trimRange.value = '1'; rec.trimPaint?.(); }
    refreshItem(rec.id);
  }
  refreshCounters(); refreshExport();
});

$('#jumpExport').addEventListener('click', () => $('#export').scrollIntoView({ behavior: 'smooth' }));
$('#legendClose').addEventListener('click', () => $('#legend').remove());

// ---------------------------------------------------------------------------
// keyboard — this is what makes a 15-item batch take two minutes

function wireGlobalKeys() {
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const rec = focused();
    switch (e.key.toLowerCase()) {
      case 'a': if (rec) { setVerdict(rec.id, 'approve'); advance(); } e.preventDefault(); break;
      case 'r': if (rec) { setVerdict(rec.id, 'reject'); advance(); } e.preventDefault(); break;
      case 'w': if (rec) { setVerdict(rec.id, 'needswork'); advance(); } e.preventDefault(); break;
      case 'j': case 'arrowdown': setFocus(focusIndex + 1); e.preventDefault(); break;
      case 'k': case 'arrowup': setFocus(focusIndex - 1); e.preventDefault(); break;
      case 'l': if (rec?.kind === 'audio') { toggleLoop(rec.id); e.preventDefault(); } break;
      case 'g': {
        playRaw = !playRaw;
        document.body.dataset.raw = String(playRaw);
        if (playing) {
          const p = byId.get(playing.id);
          if (p) playing.gain.gain.setTargetAtTime(playbackGain(p.item), ctx().currentTime, 0.02);
        }
        toast(playRaw ? 'playing the raw file' : 'playing at the in-game level');
        e.preventDefault(); break;
      }
      case 'enter': {
        const n = rec?.el.querySelector('[data-note]');
        if (n) { n.focus(); n.select(); e.preventDefault(); }
        break;
      }
      case 'escape':
        if (bigRec) closeBig(); else stopAudio();
        e.preventDefault(); break;
      case ' ':
        if (!rec) break;
        if (rec.kind === 'audio') togglePlay(rec.id);
        else { rec.spin = !rec.spin; toast(rec.spin ? 'spinning' : 'paused'); }
        e.preventDefault(); break;
    }
  });
}

/** After a verdict, step to the next still-undecided item — the batch drains itself. */
function advance() {
  for (let i = 1; i <= items.length; i++) {
    const n = (focusIndex + i) % items.length;
    if (!verdictOf(items[n].id)) { setFocus(n); return; }
  }
  setFocus(focusIndex + 1);
}

// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}
