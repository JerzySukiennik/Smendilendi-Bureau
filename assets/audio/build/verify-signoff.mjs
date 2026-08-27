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
//      compute the same effective gain for every reviewed id

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const AUDIO = join(ROOT, 'assets/audio');
const { effectiveGain } = await import(join(ROOT, 'src/core/audio.js'));

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
for (let i = 0; i < files.length; i += 8) results.push(...await Promise.all(files.slice(i, i + 8).map(probe)));
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

// 7 -------------------------------------------------------------------------
const reviewed = [];
for (const b of batches.batches) if (b.kind === 'audio') for (const i of b.items) reviewed.push(i);
console.log('\n7. effective gain — engine vs review page');
console.log('   ' + 'id'.padEnd(24) + 'kind'.padEnd(7) + 'bus'.padEnd(9)
          + 'engine'.padEnd(11) + 'review page'.padEnd(13) + 'match');
let mismatch = 0;
for (const item of reviewed) {
  const entry = manifest[item.id];
  if (!entry) { console.log(`   ${item.id.padEnd(24)} NOT IN MANIFEST`); mismatch++; continue; }
  const eng = effectiveGain(entry, mix);
  const page = item.mix.effective;
  const same = Math.abs(eng.effective - page) < 1e-9 || eng.effective.toFixed(4) === page.toFixed(4);
  if (!same) mismatch++;
  console.log(`   ${item.id.padEnd(24)}${String(entry.kind).padEnd(7)}${eng.bus.padEnd(9)}`
            + `${eng.effective.toFixed(4).padEnd(11)}${page.toFixed(4).padEnd(13)}${same ? 'yes' : 'NO'}`);
}
console.log('');
ok(`7. engine and review page agree on all ${reviewed.length} reviewed ids`, mismatch === 0,
   mismatch ? `${mismatch} mismatched` : '');

// 8 -------------------------------------------------------------------------
// The review page prefers the manifest's `duration` string over its own m:ss
// formatter, which rounds a 57 ms mouse click to "0:00". So the manifest carries
// a real one — and it has to stay true.
const dfmt = x => x < 10 ? `${x.toFixed(2)} s` : `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
const stale = [];
for (const [id, e] of Object.entries(manifest)) {
  if (!e.duration) { stale.push(`${id} (none)`); continue; }
  const real = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', join(AUDIO, e.ogg)]).toString().trim());
  if (dfmt(real) !== e.duration) stale.push(`${id} says ${e.duration}, file is ${dfmt(real)}`);
}
ok('8. every manifest duration matches its file', stale.length === 0, stale.slice(0, 5).join(', '));

console.log(`\n${fails ? fails + ' CHECK(S) FAILED' : 'all checks passed'}`);
process.exit(fails ? 1 : 0);
