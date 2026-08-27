#!/usr/bin/env node
// make-batch.mjs — regenerate review/batches.json from what is actually on disk.
//
//   node tools/make-batch.mjs audio     rebuild the audio batches
//   node tools/make-batch.mjs models    rebuild the model batch
//   node tools/make-batch.mjs all       both (default)
//
// Idempotent. Running it twice in a row produces a byte-identical file.
//
// It never destroys human input:
//   * a top-level `decisions` block (if a decisions export was ever pasted back
//     into the file) is carried over verbatim;
//   * an item's `why` line is only overwritten when the on-disk copy was itself
//     machine-generated (`whyAuto: true`). Hand-edited copy survives.
//   * batches this run does not produce are left in place.
//
// Sources of truth, in order of preference:
//   audio   assets/audio/manifest.json  +  assets/audio/CREDITS.md (or REVIEW.md)
//           falling back to a plain directory scan of assets/audio/{music,ui,os}
//   models  assets/models/*.glb cross-referenced against src/model/catalog.js
//           (the catalogue is authoritative for name / size / price / rationale)

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, extname, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'review/batches.json');
const AUDIO_DIR = join(root, 'assets/audio');
const MODEL_DIR = join(root, 'assets/models');

const mode = (process.argv[2] || 'all').toLowerCase();
if (!['audio', 'models', 'all'].includes(mode)) {
  console.error('usage: node tools/make-batch.mjs [audio|models|all]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// small helpers

const exists = p => { try { return existsSync(p); } catch { return false; } };
const readJSON = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

function listFiles(dir, exts) {
  if (!exists(dir)) return [];
  return readdirSync(dir)
    .filter(f => exts.includes(extname(f).toLowerCase()))
    .filter(f => { try { return statSync(join(dir, f)).isFile(); } catch { return false; } })
    .sort();
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return `0:${String(Math.round(sec)).padStart(2, '0')}`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Duration of an Ogg (Vorbis or Opus) file, from its page headers. null on any doubt. */
function oggDuration(file) {
  try {
    const buf = readFileSync(file);
    if (buf.length < 64 || buf.toString('latin1', 0, 4) !== 'OggS') return null;

    // identification header sits in the first page payload
    const segCount = buf[26];
    const payload = 27 + segCount;
    let rate = null, preSkip = 0;
    if (buf.toString('latin1', payload, payload + 8) === 'OpusHead') {
      rate = 48000;
      preSkip = buf.readUInt16LE(payload + 10);
    } else if (buf.toString('latin1', payload + 1, payload + 7) === 'vorbis') {
      rate = buf.readUInt32LE(payload + 12);
    }
    if (!rate) return null;

    // last page: scan backwards for the capture pattern
    let last = -1;
    for (let i = buf.length - 14; i >= 0; i--) {
      if (buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53) { last = i; break; }
    }
    if (last < 0) return null;
    const granule = Number(buf.readBigUInt64LE(last + 6));
    const sec = (granule - preSkip) / rate;
    return sec > 0 && sec < 60 * 60 ? sec : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// audio

// Hand-written rationale, keyed by item id. Survives regeneration; the point of
// the review page is that Jurek reads WHY this sound was picked, not just hears it.
const AUDIO_WHY = {
  'music.menu':
    'Plays under the badly-designed building on the main menu. Wants to be curious rather than '
    + 'grand — this is a game about drawing, not about saving the world.',
  'music.office':
    'The bed the whole design session sits on. Deliberately unobtrusive and long: it has to survive '
    + 'forty minutes of wall-drawing without becoming furniture you notice.',
  'music.walkthrough':
    'The "30 years later" walk. Warmer and slower than the office track — the building is finished '
    + 'and full of people, and the music should let that land.',
  'music.radio':
    'The switchable office radio. Diegetic, so it is allowed to have more character than the score; '
    + 'it plays through a spatial panner and falls off with distance.',
  'ui.click':
    'The default confirm. Short, dry, no tail — a hundred of these happen per minute in the editor '
    + 'and anything ringy becomes torture.',
  'ui.click-soft':
    'Hover and secondary presses. The same character as the confirm click but quieter and duller, '
    + 'so the two read as one family.',
  'ui.tool-select':
    'Switching tool in the editor. Slightly pitched so it is distinguishable from a plain click '
    + 'without being a separate event in your head.',
  'ui.snap':
    'A wall endpoint snapping to the grid or to another node. This one has to be felt more than '
    + 'heard — it is the tactile core of drawing.',
  'ui.window-open':
    'A window opening in the in-game OS. Retro-mechanical, matching the fictional operating system '
    + 'rather than anything modern.',
  'ui.window-close':
    'The counterpart to window-open: same material, shorter, falling instead of rising.',
  'ui.mail-notify':
    'A brief or a client reply lands in Mail. Must cut through the room tone from across the office '
    + 'but never startle.',
  'ui.submit':
    'Sending a design to the client. The one UI sound allowed to feel like a small ceremony, because '
    + 'it commits you to the single revision round.',
  'ui.error':
    'A refused action. Flat and short — an unpleasant sound is a punishment, and the analysis engine '
    + 'already does the criticising.',
  'os.boot-tier1':
    'Startup chime for the Pentagram 133, the starter machine. Should sound cheap and a bit sad; '
    + 'it is the sound you upgrade away from.',
  'os.boot-tier2':
    'Kompakt 2000. Recognisably the same idea as tier 1, but cleaner — the progression has to be '
    + 'audible in one A/B.',
  'os.boot-tier3':
    'Sunstation Pro. A workstation noise: confident, a little corporate.',
  'os.boot-tier4':
    'Melon Studio M5, the endgame machine. Short, expensive, over before you can get bored of it.',
};

const AUDIO_SETS = [
  {
    id: 'audio-music', title: 'Music', dir: 'music',
    note: 'The four long-form tracks. Listen with the loop toggle on: the only question that '
        + 'matters for music here is whether you can hear the seam when it wraps.',
    defaultLoop: true, prefix: 'music',
  },
  {
    id: 'audio-ui', title: 'UI sounds', dirs: ['ui', 'os'],
    note: 'Every click, snap and chime the player hears through the in-game computer. Play them '
        + 'back to back — they have to sound like one set of hardware, not thirteen downloads.',
    defaultLoop: false, prefix: null,
  },
];

// placeholders used only while the audio agent has not produced anything yet
const AUDIO_PLACEHOLDERS = {
  'audio-music': ['menu', 'office', 'walkthrough', 'radio'],
  'audio-ui': [],
};

/** Normalise whatever shape assets/audio/manifest.json turns out to have. */
function readAudioManifest() {
  const m = readJSON(join(AUDIO_DIR, 'manifest.json'));
  if (!m) return null;
  const out = new Map();          // id -> { file, loop, licence, source, title, why, duration }
  const push = (id, o) => { if (id && o && o.file) out.set(id, o); };

  const norm = (id, v) => {
    if (typeof v === 'string') return { file: v };
    if (v && typeof v === 'object') {
      return {
        file: v.file || v.src || v.path || v.ogg || null,
        loop: v.loop ?? undefined,
        licence: v.licence || v.license || undefined,
        source: v.source || v.url || undefined,
        title: v.name || v.title || undefined,
        why: v.why || v.reason || undefined,
        duration: v.duration ?? undefined,
      };
    }
    return null;
  };

  const walk = (obj, path) => {
    if (Array.isArray(obj)) {
      for (const it of obj) {
        if (it && typeof it === 'object' && (it.id || it.name)) push(it.id || it.name, norm(it.id || it.name, it));
      }
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'version' || k === 'generated' || k === 'updated') continue;
      const id = path ? `${path}.${k}` : k;
      const n = norm(id, v);
      if (n && n.file) push(id, n);
      else if (v && typeof v === 'object') walk(v, id);
    }
  };
  walk(m.sounds || m.assets || m, '');
  return out.size ? out : null;
}

/** Pull licence + source URL per file base name out of CREDITS.md / REVIEW.md. */
function readAudioCredits() {
  const text = ['CREDITS.md', 'REVIEW.md', '../../CREDITS.md']
    .map(f => readText(join(AUDIO_DIR, f)))
    .filter(Boolean).join('\n');
  const byBase = new Map();
  if (!text) return byBase;
  for (const line of text.split('\n')) {
    const url = (line.match(/https?:\/\/\S+?(?=[)\s,;]|$)/) || [])[0] || null;
    const lic = (line.match(/\bCC0(?:\s*1\.0)?\b|\bCC[- ]BY(?:[- ]SA)?(?:\s*[\d.]+)?\b|\bpublic domain\b/i) || [])[0] || null;
    if (!url && !lic) continue;
    for (const m of line.matchAll(/([a-z0-9][a-z0-9_-]*)\.(?:ogg|m4a|mp3|wav)/gi)) {
      const base = m[1].toLowerCase();
      const prev = byBase.get(base) || {};
      byBase.set(base, { licence: lic || prev.licence || null, source: url || prev.source || null });
    }
  }
  return byBase;
}

function buildAudioBatches() {
  const manifest = readAudioManifest();
  const credits = readAudioCredits();
  const batches = [];
  let real = 0, placeholder = 0;

  for (const set of AUDIO_SETS) {
    const dirs = set.dirs || [set.dir];
    const items = [];

    for (const d of dirs) {
      const abs = join(AUDIO_DIR, d);
      for (const f of listFiles(abs, ['.ogg'])) {
        const base = basename(f, '.ogg');
        const id = `${set.prefix || d}.${base}`;
        const m4a = exists(join(abs, `${base}.m4a`)) ? `../assets/audio/${d}/${base}.m4a` : null;
        const mf = manifest?.get(id) || manifest?.get(base) || null;
        const cr = credits.get(base.toLowerCase()) || {};
        const dur = mf?.duration ?? fmtDuration(oggDuration(join(abs, f)));

        items.push({
          id,
          name: mf?.title || titleFromBase(base),
          why: AUDIO_WHY[id] || mf?.why || autoWhy(id, base, d),
          whyAuto: !AUDIO_WHY[id] && !mf?.why,
          loop: mf?.loop ?? (set.defaultLoop || /room-tone|ambience|loop|radio/.test(base)),
          src: { ogg: `../assets/audio/${d}/${f}`, ...(m4a ? { m4a } : {}) },
          meta: {
            duration: typeof dur === 'string' ? dur : fmtDuration(dur),
            licence: mf?.licence || cr.licence || 'unrecorded',
            source: mf?.source || cr.source || null,
          },
        });
        real++;
      }
    }

    if (!items.length) {
      for (const base of AUDIO_PLACEHOLDERS[set.id] || []) {
        const id = `${set.prefix || dirs[0]}.${base}`;
        items.push({
          id,
          name: titleFromBase(base),
          why: AUDIO_WHY[id] || autoWhy(id, base, dirs[0]),
          whyAuto: !AUDIO_WHY[id],
          loop: set.defaultLoop,
          missing: true,
          src: { ogg: `../assets/audio/${dirs[0]}/${base}.ogg` },
          meta: { duration: null, licence: 'unrecorded', source: null },
        });
        placeholder++;
      }
    }

    if (!items.length) continue;
    batches.push({
      id: set.id, title: set.title, kind: 'audio',
      note: set.note
        + (items.every(i => i.missing) ? ' — NOT DELIVERED YET: these are placeholders, re-run tools/make-batch.mjs once the files land.' : ''),
      items,
    });
  }

  return { batches, stats: { real, placeholder, manifest: !!manifest, credits: credits.size } };
}

function titleFromBase(base) {
  const s = base.replace(/[-_]+/g, ' ').replace(/\b(\d)\b/g, '$1');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function autoWhy(id, base, dir) {
  if (dir === 'music') return `Long-form ${base} track. Rationale not recorded yet — check the loop point.`;
  if (dir === 'os') return `Startup chime for one of the four computer tiers. The tiers must be distinguishable in one A/B.`;
  return `UI sound "${base}". Rationale not recorded yet — judge it against the rest of the set.`;
}

// ---------------------------------------------------------------------------
// models

async function buildModelBatch() {
  const cat = await import(join(root, 'src/model/catalog.js'));
  const entries = cat.allEntries().filter(e => e.file);
  const onDisk = new Set(listFiles(MODEL_DIR, ['.glb']));

  const items = entries.map(e => {
    const file = basename(e.file);
    const present = onDisk.has(file);
    const clr = e.clearance;
    const clearanceLine = (clr.front || clr.back || clr.left || clr.right)
      ? `Clearance F/B/L/R ${clr.front} / ${clr.back} / ${clr.left} / ${clr.right} m`
      : null;

    return {
      id: e.id,
      name: e.name,
      why: e.note || defaultModelWhy(e),
      whyAuto: !e.note,
      glb: `../assets/models/${file}`,
      present,
      proc: !!e.proc,                       // a proxy solid exists if the GLB does not
      size: e.size,
      price: e.price,
      meta: {
        category: e.category,
        anchor: e.anchor,
        mount: e.mount || 0,
        clearance: clearanceLine,
        seatHeight: e.seatHeight,
        workHeight: e.workHeight,
        licence: 'authored in Blender for this project',
        source: null,
      },
    };
  });

  // strays: a GLB on disk that no catalogue entry claims
  const claimed = new Set(entries.map(e => basename(e.file)));
  const strays = [...onDisk].filter(f => !claimed.has(f));

  const missing = items.filter(i => !i.present).length;
  const note =
    'The headline pieces — every catalogue item that is modelled by hand rather than generated. '
    + 'Judge them at the scale figure: 1.75 m, standing next to the model, with the real bounding '
    + 'box in metres under it. If a dimension looks wrong to you, it is wrong.'
    + (missing ? ` — ${missing} of ${items.length} GLBs are not on disk yet; those tiles render the procedural proxy solid instead, clearly marked.` : '')
    + (strays.length ? ` — unclaimed GLBs in assets/models: ${strays.join(', ')}.` : '');

  return {
    batch: { id: 'models-1', title: 'Headline models', kind: 'model', note, items },
    stats: { total: items.length, present: items.length - missing, strays: strays.length },
  };
}

function defaultModelWhy(e) {
  const [w, h, d] = e.size;
  return `${e.name} — ${w} x ${h} x ${d} m, ${e.price} units. No rationale recorded in the catalogue; `
       + 'check the dimensions against the scale figure.';
}

// ---------------------------------------------------------------------------
// merge + write

function mergeBatch(prevBatches, next) {
  const prev = prevBatches.find(b => b.id === next.id);
  if (!prev) return next;
  const prevItems = new Map((prev.items || []).map(i => [i.id, i]));
  next.items = next.items.map(item => {
    const old = prevItems.get(item.id);
    // a hand-edited `why` (whyAuto absent or false) always wins
    if (old && old.why && old.whyAuto !== true && item.whyAuto === true) {
      return { ...item, why: old.why, whyAuto: false };
    }
    return item;
  });
  return next;
}

const prevDoc = readJSON(OUT) || {};
const prevBatches = Array.isArray(prevDoc.batches) ? prevDoc.batches : [];

const produced = [];
let audioStats = null, modelStats = null;

if (mode === 'audio' || mode === 'all') {
  const r = buildAudioBatches();
  audioStats = r.stats;
  produced.push(...r.batches);
}
if (mode === 'models' || mode === 'all') {
  const r = await buildModelBatch();
  modelStats = r.stats;
  produced.push(r.batch);
}

const producedIds = new Set(produced.map(b => b.id));
// keep batches this run did not regenerate, in their original position
const ORDER = ['audio-music', 'audio-ui', 'models-1'];
const merged = [
  ...produced.map(b => mergeBatch(prevBatches, b)),
  ...prevBatches.filter(b => !producedIds.has(b.id)),
].sort((a, b) => {
  const ia = ORDER.indexOf(a.id), ib = ORDER.indexOf(b.id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
});

const doc = {
  generated: 'tools/make-batch.mjs',
  batches: merged,
};
if (prevDoc.decisions && Object.keys(prevDoc.decisions).length) doc.decisions = prevDoc.decisions;

writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

const total = merged.reduce((n, b) => n + b.items.length, 0);
console.log(`wrote ${relative(root, OUT)} — ${merged.length} batches, ${total} items`);
if (audioStats) {
  console.log(`  audio : ${audioStats.real} real file(s), ${audioStats.placeholder} placeholder(s)`
    + `, manifest.json ${audioStats.manifest ? 'found' : 'MISSING'}`
    + `, credits entries ${audioStats.credits}`);
}
if (modelStats) {
  console.log(`  models: ${modelStats.present}/${modelStats.total} GLBs on disk`
    + (modelStats.strays ? `, ${modelStats.strays} unclaimed` : ''));
}
if (doc.decisions) console.log(`  carried over ${Object.keys(doc.decisions).length} recorded decision(s)`);
