#!/usr/bin/env node
// verify-signoff.mjs — proves the 2026-08-27 audio sign-off actually landed.
//
//   node assets/audio/build/verify-signoff.mjs
//
// Asserts, and fails loudly on any of them:
//   1  every path in manifest.json exists on disk
//   2  every manifest id has a row in CREDITS.md
//   3  no CC-BY (or any other attribution licence) anywhere in CREDITS.md
//   4  exactly the six owner-supplied files are flagged "proprietary": true,
//      and none of them claims CC0
//   5  the four level trims equal review/decisions-2026-08-27.json exactly
//   6  every .ogg and .m4a decodes (ffmpeg -f null) and none clips
//   7  the ENGINE (src/core/audio.js) and the REVIEW PAGE (review/batches.json)
//      compute the same effective gain for every reviewed id and context
//   8  every manifest duration matches its file
//   9  no CALL SITE in src/ can produce a level other than the reviewed one
//  10  no file outside src/core/audio.js states a bus LEVEL, and the engine's
//      fallback mix still equals mix.json
//
// Pass --fast to skip 6 and 8, the two ffmpeg passes (~90 s). Everything else
// runs in milliseconds, which is what tools/smoke.mjs calls.
//
// Check 9 is the one that had to exist. Until round 3 this script "passed"
// because checks 1-8 compared two copies of the same incomplete arithmetic: the
// engine's master x bus x asset against the review page's master x bus x asset.
// Neither looked at what the game actually calls, and what the game actually
// called was play('music.office-ambient-1', { volume: 0.55 }) — cutting a level
// the human had signed off at 12.8% down to 7.0%. So this script now reads every
// play/music/loop call in src/ and fails if any of them lands anywhere other than
// the number in the manifest.
//
// ROUND 4 added check 10 and closed three holes in check 9. An independent critic
// moved a level three ways while this script printed "all checks passed":
//   * a third hardcoded bus mix in src/menu/lobby.js, pushed onto the bus on menu
//     entry — mix.json's music bus 0.45 -> 0.30 changed the promise and not the
//     game (check 10);
//   * `h?.setVolume?.(0.15)` inside the OS play wrapper, cutting every OS sound to
//     15% — and the scanner dropped the wrapper line entirely (check 10c + the
//     scanner no longer skips expression-form calls);
//   * `play('ui.click', { bus: 'sfx' })`, swapping the ui bus (0.7) for sfx (0.8),
//     a key the scanner parsed and the check ignored (checks 9a and 9f).
// The engine now refuses all three at runtime as well; these checks make writing
// one a build failure rather than a silent no-op.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const AUDIO = join(ROOT, 'assets/audio');
const { effectiveGain, contextNames, DEFAULT_MIX, busNames } = await import(join(ROOT, 'src/core/audio.js'));
const { scanCallSites, rawVolumeHits, stringRefs, mixLiteralHits, stripComments, sourceFiles } =
  await import(join(dirname(fileURLToPath(import.meta.url)), 'scan-callsites.mjs'));

const FAST = process.argv.includes('--fast');

const manifest = JSON.parse(readFileSync(join(AUDIO, 'manifest.json'), 'utf8'));
const mix = JSON.parse(readFileSync(join(AUDIO, 'mix.json'), 'utf8'));
const credits = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8');
const decisions = JSON.parse(readFileSync(join(ROOT, 'review/decisions-2026-08-27.json'), 'utf8'));
const batches = JSON.parse(readFileSync(join(ROOT, 'review/batches.json'), 'utf8'));

let fails = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) fails++;
};

// 1 -------------------------------------------------------------------------
const missing = [];
let paths = 0;
for (const [id, e] of Object.entries(manifest))
  for (const c of ['ogg', 'm4a'])
    if (e[c]) { paths++; if (!existsSync(join(AUDIO, e[c]))) missing.push(`${id}:${e[c]}`); }
ok(`1. every manifest path exists (${paths} files, ${Object.keys(manifest).length} ids)`,
   missing.length === 0, missing.join(', '));

// 2 -------------------------------------------------------------------------
const creditIds = new Set([...credits.matchAll(/^\|\s*`assets\/audio\/[^`]+`\s*\|\s*`([^`]+)`/gm)].map(m => m[1]));
const noRow = Object.keys(manifest).filter(id => !creditIds.has(id));
ok(`2. every id has a CREDITS row (${creditIds.size} rows)`, noRow.length === 0, noRow.join(', '));

// 3 -------------------------------------------------------------------------
const attribution = [...credits.matchAll(/\bCC[\s-]?BY\b[^|\n]*/gi)].map(m => m[0].trim());
ok('3. no CC-BY anywhere in CREDITS.md', attribution.length === 0, attribution.join(' / '));

// 4 -------------------------------------------------------------------------
const EXPECT_PROP = ['ui.error', 'ui.mail-notify', 'os.boot-tier1', 'os.boot-tier2', 'os.boot-tier3', 'os.boot-tier4'];
const flagged = Object.entries(manifest).filter(([, e]) => e.proprietary === true).map(([id]) => id).sort();
ok(`4a. exactly the six owner-supplied files are flagged proprietary`,
   JSON.stringify(flagged) === JSON.stringify([...EXPECT_PROP].sort()), flagged.join(', '));
const propCC0 = EXPECT_PROP.filter(id => /CC0/i.test(manifest[id]?.licence || ''));
ok('4b. no proprietary entry claims CC0', propCC0.length === 0, propCC0.join(', '));
const propInCC0Table = EXPECT_PROP.filter(id => {
  const row = credits.split('\n').find(l => l.startsWith('|') && l.includes('`' + id + '`'));
  if (!row) return true;
  const licenceCell = row.split('|').slice(1, -1)[5] || '';   // column 6 = Licence
  return /CC0/i.test(licenceCell);
});
ok('4c. no proprietary id sits in a CC0 row in CREDITS.md', propInCC0Table.length === 0, propInCC0Table.join(', '));

// 5 -------------------------------------------------------------------------
const gainRows = decisions.levelChanges.map(({ id, newGain }) =>
  `${id}=${manifest[id]?.gain} (want ${newGain})`);
const gainBad = decisions.levelChanges.filter(({ id, newGain }) => manifest[id]?.gain !== newGain);
ok(`5. the ${decisions.levelChanges.length} level trims match the decisions file exactly`,
   gainBad.length === 0, gainRows.join(', '));

// 6 -------------------------------------------------------------------------
// One ffmpeg pass per file does both jobs: a non-zero exit is a decode failure,
// and astats' overall peak is the clipping check. 108 files, 8 at a time.
const files = [];
for (const [id, e] of Object.entries(manifest))
  for (const c of ['ogg', 'm4a']) if (e[c]) files.push({ id, codec: c, path: join(AUDIO, e[c]) });

async function probe(f) {
  try {
    const { stderr } = await pexec('ffmpeg',
      ['-hide_banner', '-nostats', '-i', f.path, '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level',
       '-f', 'null', '-'], { maxBuffer: 1 << 26 });
    const m = stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/);
    return { ...f, peak: m ? parseFloat(m[1]) : NaN, error: null };
  } catch (err) {
    return { ...f, peak: NaN, error: String(err.stderr || err.message).split('\n').filter(Boolean).pop() };
  }
}
const results = [];
if (FAST) console.log(`SKIP  6. decode + clipping (${files.length} files, ffmpeg) — --fast`);
else for (let i = 0; i < files.length; i += 8) results.push(...await Promise.all(files.slice(i, i + 8).map(probe)));
if (!FAST) {
const decodeFails = results.filter(r => r.error).map(r => `${r.id}.${r.codec}: ${r.error}`);
ok(`6a. every file decodes (${files.length} files)`, decodeFails.length === 0, decodeFails.slice(0, 6).join(' | '));

// Clipping is a question about the OUTPUT, not about the file. Nothing plays at
// unity: every sound goes through master x bus x asset first. A decoded sample
// above 0 dBFS (lossy codecs overshoot; that is normal) only matters if the mix
// cannot pull it back under 1.0.
const clips = results.filter(r => Number.isFinite(r.peak))
  .map(r => ({ ...r, out: Math.pow(10, r.peak / 20) * effectiveGain(manifest[r.id], mix).effective }))
  .filter(r => r.out >= 1.0);
ok('6b. nothing clips at the mix (peak x master x bus x asset < 1.0)', clips.length === 0,
   clips.map(r => `${r.id}.${r.codec} -> ${r.out.toFixed(3)}`).join(', '));

const over = results.filter(r => Number.isFinite(r.peak) && r.peak >= 0);
const mine = new Set(['ui.error', 'ui.mail-notify', 'ui.click', 'ui.snap', 'ui.submit', 'ui.tool-select',
                      'ui.window-open', 'ui.window-close', 'os.boot-tier1', 'os.boot-tier2', 'os.boot-tier3', 'os.boot-tier4']);
ok('6c. no file rebuilt by this sign-off decodes above 0 dBFS',
   over.filter(r => mine.has(r.id)).length === 0,
   over.filter(r => mine.has(r.id)).map(r => `${r.id}.${r.codec} ${r.peak}`).join(', '));
if (over.length) console.log('      inherited codec overshoot, harmless at the mix: '
  + over.map(r => `${r.id}.${r.codec} ${r.peak.toFixed(2)} dBFS`).join(', '));
}

// 7 -------------------------------------------------------------------------
// The tolerance is EXACT now (1e-12, i.e. float noise only). It used to allow a
// 4-decimal match, which hid make-batch.mjs storing +(x).toFixed(4) — a 2.5e-5
// lie on exactly the three ids the human re-levelled.
const reviewed = [];
for (const b of batches.batches) if (b.kind === 'audio') for (const i of b.items) reviewed.push(i);
console.log('\n7. effective gain — engine vs review page');
console.log('   ' + 'id'.padEnd(24) + 'context'.padEnd(13) + 'kind'.padEnd(7) + 'bus'.padEnd(9)
          + 'engine'.padEnd(13) + 'review page'.padEnd(13) + 'match');
let mismatch = 0, rows = 0;
for (const item of reviewed) {
  const entry = manifest[item.id];
  if (!entry) { console.log(`   ${item.id.padEnd(24)} NOT IN MANIFEST`); mismatch++; continue; }
  const pairs = [[null, item.mix.effective], ...(item.mix.contexts || []).map(c => [c.name, c.effective])];
  for (const [ctx, page] of pairs) {
    const eng = effectiveGain(entry, mix, ctx);
    const same = Math.abs(eng.effective - page) < 1e-12;
    if (!same) mismatch++;
    rows++;
    console.log(`   ${item.id.padEnd(24)}${String(ctx || '(base)').padEnd(13)}${String(entry.kind).padEnd(7)}`
              + `${eng.bus.padEnd(9)}${eng.effective.toFixed(6).padEnd(13)}${page.toFixed(6).padEnd(13)}${same ? 'yes' : 'NO'}`);
  }
}
console.log('');
ok(`7. engine and review page agree on all ${rows} reviewed levels (${reviewed.length} ids)`, mismatch === 0,
   mismatch ? `${mismatch} mismatched` : '');

// 8 -------------------------------------------------------------------------
// The review page prefers the manifest's `duration` string over its own m:ss
// formatter, which rounds a 57 ms mouse click to "0:00". So the manifest carries
// a real one — and it has to stay true.
const dfmt = x => x < 10 ? `${x.toFixed(2)} s` : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
const stale = [];
if (FAST) console.log('SKIP  8. manifest durations (ffprobe) — --fast');
else for (const [id, e] of Object.entries(manifest)) {
  if (!e.duration) { stale.push(`${id} (none)`); continue; }
  const real = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', join(AUDIO, e.ogg)]).toString().trim());
  if (dfmt(real) !== e.duration) stale.push(`${id} says ${e.duration}, file is ${dfmt(real)}`);
}
if (!FAST) ok('8. every manifest duration matches its file', stale.length === 0, stale.slice(0, 5).join(', '));

// 9 -------------------------------------------------------------------------
// THE CALL SITES. Everything above this line describes what the game is supposed
// to play. This is the only part that reads what it actually does.
const scan = scanCallSites({ root: ROOT, manifest });
const reviewedIds = new Map(reviewed.map(i => [i.id, i]));

// 9a — a raw `volume:` or `bus:` anywhere in src/ is the whole defect, in one
// grep. Both are levels: `volume` multiplies on top of the reviewed number, and
// `bus` swaps one bus gain for another (ui 0.7 -> sfx 0.8 is 1.14x louder).
const rawVol = rawVolumeHits(ROOT);
ok(`9a. no call site passes a raw volume or bus (${scan.files} source files scanned)`,
   rawVol.length === 0, rawVol.slice(0, 8).join(' | '));

// 9b — every named context exists in the manifest.
const badCtx = [];
for (const s of scan.sites) {
  if (!s.context) continue;
  for (const id of s.ids) {
    if (manifest[id]?.contexts?.[s.context] === undefined)
      badCtx.push(`${s.file}:${s.line} ${id} context "${s.context}"`);
  }
  if (s.contextExpr) badCtx.push(`${s.file}:${s.line} context is a variable — not statically reviewable`);
}
ok('9b. every context named at a call site is declared in manifest.json',
   badCtx.length === 0, badCtx.slice(0, 6).join(', '));

// 9c — a sound that declares contexts must never be played without one: the base
// level of such an id was never reviewed and is louder than every context.
const PLAYS = new Set(['play', 'music', 'musicPlaylist', 'loop']);
const missingCtx = [];
for (const s of scan.sites) {
  if (!PLAYS.has(s.fn) || s.context || s.contextExpr) continue;
  for (const id of s.ids) if (contextNames(manifest[id]).length)
    missingCtx.push(`${s.file}:${s.line} ${id} (declares ${contextNames(manifest[id]).join('/')})`);
}
ok('9c. no sound with declared contexts is played at its unreviewed base level',
   missingCtx.length === 0, missingCtx.slice(0, 6).join(', '));

// 9d — a level the human approved and the game never plays is a bug. That is how
// music.office-ambient-2 sat in the manifest, hand-trimmed, with no call site.
// An id reached through a variable (the boot chimes, via computerTier().bootSound)
// counts as played: the string is in src/ and it resolves at runtime.
// ROUND 4: this used to accept ANY string literal of the id anywhere in src/ as
// proof it was reachable, which counted a PRELOAD LIST as a playback path —
// ui.mail-notify appeared only inside warmSounds()'s decode array and the table
// printed it at 53.55% / yes for a sound nothing played. stringRefs now says what
// each occurrence is doing, and only a dispatch slot (`sound: 'os.boot-tier1'`,
// read back through computerTier(tier).bootSound) resolves to a real play.
const refs = stringRefs(ROOT, new Set(Object.keys(manifest)));
const dispatchRef = (id) => (refs.get(id) || []).filter(r => r.kind === 'dispatch');
const played = new Set();
for (const s of scan.sites) if (PLAYS.has(s.fn)) for (const id of s.ids) played.add(id);
const reachable = (id) => played.has(id) || dispatchRef(id).length > 0;
const approvedSilent = [...reviewedIds.entries()]
  .filter(([id, i]) => i.decided?.verdict === 'approve' && !reachable(id)).map(([id]) => id);
ok('9d. every APPROVED sound has a call site', approvedSilent.length === 0, approvedSilent.join(', '));

// 9e — the review page renders one level per id. A context on a reviewed id
// would be a level the human never sees, which is the defect wearing a hat.
const ctxOnReviewed = [...reviewedIds.keys()].filter(id => contextNames(manifest[id]).length);
ok('9e. no reviewed id carries contexts the review page cannot show',
   ctxOnReviewed.length === 0, ctxOnReviewed.join(', '));

// 9f — THE TABLE: id x call site x the level that leaves the speakers.
console.log('\n9. every audio id x every call site x the level that leaves the speakers');
console.log('   ' + 'id'.padEnd(23) + 'context'.padEnd(12) + 'call site'.padEnd(30)
          + 'level'.padEnd(9) + 'reviewed'.padEnd(10) + 'ok');
const byId = new Map();
for (const s of scan.sites) {
  if (!PLAYS.has(s.fn)) continue;
  for (const id of s.ids) {
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(s);
  }
}
let levelBad = 0, levelRows = 0;
const pct = x => (x * 100).toFixed(2) + '%';
for (const id of Object.keys(manifest)) {
  const entry = manifest[id];
  const sites = byId.get(id) || [];
  if (!sites.length) {
    // No literal call site. Either the id is reached through a dispatch slot on a
    // data object (a boot chime) or nothing plays it at all. A mention inside a
    // preload list is NOT a playback path — see 9d.
    const via = dispatchRef(id);
    const why = via.length ? `via ${via[0].at.replace(/^src\//, '')}` : 'nothing plays this id';
    console.log(`   ${id.padEnd(23)}${'—'.padEnd(12)}${why.padEnd(30)}`
              + `${(via.length ? pct(effectiveGain(entry, mix).effective) : '—').padEnd(9)}`
              + `${pct(effectiveGain(entry, mix).effective).padEnd(10)}${via.length ? 'yes' : 'unused'}`);
    if (via.length) levelRows++;
    continue;
  }
  for (const s of sites) {
    const eng = effectiveGain(entry, mix, s.context);
    // The reviewed number for this id and context: the review page's if the id is
    // in a batch, otherwise the manifest's own declared level.
    const item = reviewedIds.get(id);
    const pageCtx = item && s.context ? (item.mix.contexts || []).find(c => c.name === s.context) : null;
    const want = item ? (s.context ? (pageCtx ? pageCtx.effective : NaN) : item.mix.effective)
                      : eng.effective;
    // A raw volume would multiply in on top; a bus override would replace the bus
    // gain with a different one; a dynamic factor only attenuates. The engine now
    // ignores volume and bus, but the level this row PRINTS is what the call site
    // asked for, so a reviewer sees the divergence rather than a silent no-op.
    const busOverride = s.bus && mix.buses?.[s.bus] !== undefined
      ? mix.buses[s.bus] / eng.busGain : (s.bus || s.busExpr ? NaN : 1);
    const actual = eng.effective * (s.volume ? Number(s.volume) || NaN : 1) * busOverride;
    const good = Number.isFinite(want) && Math.abs(actual - want) < 1e-12
              && !s.volume && !s.bus && !s.busExpr;
    if (!good) levelBad++;
    levelRows++;
    console.log(`   ${id.padEnd(23)}${String(s.context || '(base)').padEnd(12)}`
              + `${(s.file.replace(/^src\//, '') + ':' + s.line).padEnd(30)}`
              + `${(s.dynamic ? '≤' : '') + pct(actual)}`.padEnd(9)
              + `${pct(want).padEnd(10)}${good ? 'yes' : 'NO'}`);
  }
}
for (const s of scan.sites) {
  if (!PLAYS.has(s.fn) || s.ids.length || s.form === 'stop') continue;
  // An id that only exists at runtime. It cannot be resolved here, but it also
  // cannot bend its level: with no override, whatever it names plays at that
  // id's reviewed number. An override on such a call IS unreviewable, so it fails.
  const bad = !!s.volume || !!s.context || s.contextExpr || !!s.bus || s.busExpr;
  if (bad) levelBad++;
  levelRows++;
  console.log(`   ${s.arg.slice(0, 22).padEnd(23)}${'—'.padEnd(12)}`
            + `${(s.file.replace(/^src\//, '') + ':' + s.line).padEnd(30)}`
            + `${'runtime id'.padEnd(9)}${'—'.padEnd(10)}`
            + `${bad ? 'NO — unreviewable override' : 'yes'}`);
}
console.log('');
ok(`9f. all ${levelRows} playback paths land on the reviewed level`, levelBad === 0,
   levelBad ? `${levelBad} path(s) off` : '');

const unused = Object.keys(manifest).filter(id => !byId.has(id) && !dispatchRef(id).length);
if (unused.length) console.log(`      note: ${unused.length} id(s) nothing plays yet — `
  + `not a level bug, but they ship dead weight: ${unused.join(', ')}`);

// 10 ------------------------------------------------------------------------
// THE MIX HAS ONE HOME. Checks 1-9 all start from mix.json, so anything that
// writes a bus level from somewhere else is invisible to every one of them. That
// is not hypothetical: src/menu/lobby.js carried
//   volumes: { master: 0.9, music: 0.45, ambient: 0.5, sfx: 0.8, ui: 0.7 }
// and _applyPrefs() pushed all five onto the AudioBus from the constructor, on
// the first screen of the game. Setting mix.json's music bus to 0.30 moved the
// review page to 4.72% for music.walkthrough, this script printed "all checks
// passed", and the game played 7.09% — 1.5x louder — because lobby.js put 0.45
// back. The review page was promising a level the engine would not honour, which
// is the round-2 defect relocated one file over.
const BUSES = ['master', ...busNames(mix)];

// 10a — the engine's fetch-failure fallback must still BE the mix.
const mixEq = (a, b) => JSON.stringify({ master: a.master, buses: a.buses, kindToBus: a.kindToBus })
                     === JSON.stringify({ master: b.master, buses: b.buses, kindToBus: b.kindToBus });
ok('10a. DEFAULT_MIX in src/core/audio.js equals assets/audio/mix.json', mixEq(DEFAULT_MIX, mix),
   mixEq(DEFAULT_MIX, mix) ? '' : `engine ${JSON.stringify(DEFAULT_MIX)} vs file ${JSON.stringify(mix)}`);

// 10b — nowhere else may STATE a bus level: not as a literal map of bus names to
// numbers, and not as a number handed to setVolume/setBusGain/setMasterGain. A
// settings screen may say "the player moved this bus to this value"; it may not
// say what the default is.
const mixDupes = mixLiteralHits(ROOT, BUSES);
ok(`10b. no bus level is written outside mix.json (${BUSES.join('/')})`,
   mixDupes.length === 0, mixDupes.slice(0, 6).join(' | '));

// 10c — the gain node behind a playing sound must not be writable from outside
// the engine. One line in the OS play wrapper — `h?.setVolume?.(0.15)` — cut
// every sound the OS routes to 15% of its reviewed level with all nine checks
// still green, because no scanner can see a level change that never names an id.
// So the write is gone rather than watched for.
const engineSrc = readFileSync(join(ROOT, 'src/core/audio.js'), 'utf8');
const handleWrite = /setVolume\s*:/.test(stripComments(engineSrc));
ok('10c. a play() handle exposes no way to change its own gain', !handleWrite,
   handleWrite ? 'src/core/audio.js defines a setVolume property on the play handle' : '');
const outsideGain = [];
for (const f of sourceFiles(ROOT)) {
  const t = stripComments(readFileSync(f, 'utf8'));
  t.split('\n').forEach((l, i) => {
    if (/\.gain\b\s*(\.|\[)/.test(l) || /\bcreateGain\s*\(/.test(l) || /\bnew\s+AudioContext\b/.test(l))
      outsideGain.push(`${f.replace(ROOT + '/', '')}:${i + 1}  ${l.trim().slice(0, 80)}`);
  });
}
ok('10d. no file outside the engine touches a gain node or opens its own AudioContext',
   outsideGain.length === 0, outsideGain.slice(0, 5).join(' | '));

console.log(`\n${fails ? fails + ' CHECK(S) FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
