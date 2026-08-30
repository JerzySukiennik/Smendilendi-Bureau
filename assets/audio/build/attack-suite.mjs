#!/usr/bin/env node
/**
 * attack-suite.mjs — does the sign-off actually catch a moved level?
 *
 * verify-signoff.mjs says "all checks passed". This asks the only question that
 * matters about that sentence: if somebody DID move one of the levels Jurek
 * signed off, would it still say that? Every attack below is one an independent
 * critic actually used to defeat an earlier round of the sign-off, so this is a
 * regression test for the guarantee itself, not a hypothetical.
 *
 * It copies the working tree to a scratch directory, applies one attack, runs
 * verify-signoff.mjs, restores, and repeats. The real repo is never modified.
 *
 *   node assets/audio/build/attack-suite.mjs
 *
 * Every row must read exit=1. A row reading exit=0 is a way to make the review
 * page promise a level the game will not play.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SC = join(tmpdir(), 'audio-attack-suite');

// The files any attack touches; restoring just these is ~200x faster than
// re-copying 102 audio files per attack.
const TOUCHED = ['src/os/wm.js', 'src/os/os.js', 'src/menu/menu.js', 'src/menu/lobby.js',
                 'src/office/office-mode.js', 'src/walk/walk.js',
                 'assets/audio/mix.json', 'review/batches.json'];
let pristine = null;
function fresh() {
  if (!pristine) {
    rmSync(SC, { recursive: true, force: true });
    mkdirSync(SC, { recursive: true });
    execSync(`rsync -a --exclude .git --exclude node_modules "${ROOT}/" "${SC}/"`);
    if (existsSync(join(ROOT, 'node_modules'))) execSync(`ln -s "${ROOT}/node_modules" "${SC}/node_modules"`);
    pristine = Object.fromEntries(TOUCHED.map((f) => [f, readFileSync(join(SC, f), 'utf8')]));
  }
  for (const [f, t] of Object.entries(pristine)) writeFileSync(join(SC, f), t);
}

const edit = (rel, fn) => writeFileSync(join(SC, rel), fn(readFileSync(join(SC, rel), 'utf8')));
const insertAfter = (rel, line, code) => edit(rel, (s) => {
  const L = s.split('\n'); L.splice(line, 0, code); return L.join('\n');
});
const bumpMix = () => {
  const p = join(SC, 'assets/audio/mix.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.buses.music = 0.30;                                  // the review page moves...
  writeFileSync(p, JSON.stringify(j, null, 2));
  execSync('node tools/make-batch.mjs', { cwd: SC, stdio: 'ignore' });   // ...and so does batches.json
};

/** [label, how to move a level, which round's critic found it] */
const ATTACKS = [
  ['raw volume: at a call site',              () => edit('src/os/wm.js', (s) => s.replace("this.os.play('ui.click');", "this.os.play('ui.click', { volume: 0.5 });")), 'r2'],
  ['h?.setVolume?.(0.15) in a play wrapper',  () => edit('src/os/os.js', (s) => s.replace('const h = a.play(name, opts);', 'const h = a.play(name, opts); h?.setVolume?.(0.15);')), 'r4'],
  ['h.gain.gain.value = 0.15 in a wrapper',   () => edit('src/os/os.js', (s) => s.replace('const h = a.play(name, opts);', 'const h = a.play(name, opts); if (h) h.gain.gain.value = 0.15;')), 'r4'],
  ['play(id, { bus: "sfx" })',                () => edit('src/menu/menu.js', (s) => s.replace("this.ctx?.audio?.play('ui.click')", "this.ctx?.audio?.play('ui.click', { bus: 'sfx' })")), 'r4'],
  ['mix.json music 0.45 -> 0.30',             bumpMix, 'r4'],
  ['audio?.setVolume?.("music", 0.2)',        () => insertAfter('src/office/office-mode.js', 55, '    this.ctx?.audio?.setVolume?.("music", 0.2);'), 'r5'],
  ['audio.setVolume("music", 0.2)',           () => insertAfter('src/office/office-mode.js', 55, '    this.ctx.audio.setVolume("music", 0.2);'), 'r5'],
  ['a 4th hardcoded copy of the bus mix',     () => insertAfter('src/walk/walk.js', 1, 'const MIX = { master: 0.9, music: 0.30, ambient: 0.5, sfx: 0.8, ui: 0.7 };'), 'r4'],
  ['a context the manifest never declared',   () => edit('src/walk/walk.js', (s) => s.replace("context: 'walkthrough'", "context: 'whisper'")), 'r5'],
  ['audio.volumes.music = 0.2',               () => insertAfter('src/office/office-mode.js', 55, '    if (this.ctx?.audio?.volumes) this.ctx.audio.volumes.music = 0.2;'), 'r5'],
  ['audio.mix.buses.music = 0.2',             () => insertAfter('src/office/office-mode.js', 55, '    if (this.ctx?.audio?.mix) { this.ctx.audio.mix.buses.music = 0.2; }'), 'r5'],
  ['applyUserVolumes({ music: 0.2 })',        () => insertAfter('src/menu/lobby.js', 162, '    this.ctx?.audio?.applyUserVolumes?.({ music: 0.2 });'), 'r5'],
];

function verify() {
  try { return { code: 0, out: execSync('node assets/audio/build/verify-signoff.mjs --fast', { cwd: SC, encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

fresh();
const base = verify();
console.log(`baseline, nothing moved:  exit=${base.code}  ${base.out.trim().split('\n').pop()}`);
if (base.code !== 0) { console.error('\nThe tree does not pass its own sign-off; fix that first.'); process.exit(1); }

console.log('\nfound  attack                                    verifier  failing check(s)');
console.log('-----  ----------------------------------------  --------  ------------------------');
let escaped = 0;
for (const [name, apply, round] of ATTACKS) {
  fresh(); apply();
  const r = verify();
  const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(6).split('.')[0]);
  if (r.code === 0) escaped++;
  console.log(`${round.padEnd(6)} ${name.padEnd(41)} exit=${r.code}   ${fails.join(', ') || 'NONE — this attack escaped'}`);
}
rmSync(SC, { recursive: true, force: true });
console.log(`\n${escaped ? `${escaped} ATTACK(S) ESCAPED THE SIGN-OFF` : `all ${ATTACKS.length} attacks caught`}`);
process.exit(escaped ? 1 : 0);
