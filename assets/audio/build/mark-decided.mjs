#!/usr/bin/env node
// mark-decided.mjs — stamp the 2026-08-27 sign-off onto review/batches.json.
//
//   node tools/make-batch.mjs audio            # rebuild from disk
//   node assets/audio/build/mark-decided.mjs   # then re-stamp
//
// tools/make-batch.mjs rebuilds every item from the files, so it drops per-item
// annotations — run this straight after it. It does two things:
//   * items the owner already approved AND whose file has not changed get a
//     `decided` block, so he is not asked to judge the same sound twice;
//   * items whose file changed in this round get `changedSince`, saying what was
//     replaced and why, so he knows which twelve actually need fresh ears.
// The batch note (which the page renders) says the same thing in prose, and a
// top-level `decisions` block records it durably — make-batch carries that over.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const P = join(ROOT, 'review/batches.json');
const doc = JSON.parse(readFileSync(P, 'utf8'));
const dec = JSON.parse(readFileSync(join(ROOT, 'review/decisions-2026-08-27.json'), 'utf8'));
const byId = new Map(dec.decisions.map(d => [d.id, d]));

// What this round actually did to each reviewed audio id.
const APPLIED = {
  'music.menu':             { state: 'decided', what: 'Approved 2026-08-27, unchanged.' },
  'music.office-ambient-1': { state: 'decided', what: 'Approved 2026-08-27 with a 0.45 trim — applied, asset gain is now 0.315.' },
  'music.office-ambient-2': { state: 'decided', what: 'Approved 2026-08-27 with a 0.45 trim — applied, asset gain is now 0.315.' },
  'music.walkthrough':      { state: 'decided', what: 'Approved 2026-08-27 with a 0.25 trim — applied, asset gain is now 0.175.' },
  'ui.click-soft':          { state: 'decided', what: 'Approved 2026-08-27 with a 0.6 trim — applied, asset gain is now 0.51.' },

  'ui.click':        { state: 'new', what: 'REPLACED — you rejected the old one as too synthetic. This is a real mouse switch (freesound CC0, Pepe827), press only, 57 ms.' },
  'ui.window-open':  { state: 'new', what: 'REPLACED — too synthetic. This is a real door latch being pressed (freesound CC0, JohnyTud), trimmed and pitched up 14 % so it reads as a drawer front.' },
  'ui.window-close': { state: 'new', what: 'REPLACED — too synthetic. Same door, the latch catching. Same trim and pitch, so open and close are one object.' },
  'ui.snap':         { state: 'new', what: 'REPLACED — you have the Kenney set in too many games. This is a real toggle light switch (freesound CC0, Philip_Berger). Nothing from Kenney.' },
  'ui.submit':       { state: 'new', what: 'REPLACED — same reason. A real sheet of paper gathered and released (freesound CC0, Lau7). Nothing from Kenney.' },
  'ui.tool-select':  { state: 'new', what: 'REPLACED — same reason. One real key, down and up (freesound CC0, chris112233). Nothing from Kenney.' },

  'ui.error':        { state: 'new', what: 'REPLACED with your own file (erro.mp3), trimmed and levelled. NOT CC0 — see CREDITS.md.' },
  'ui.mail-notify':  { state: 'new', what: 'REPLACED with your own file (windows-10-notification.mp3). Microsoft audio, NOT CC0 — see CREDITS.md.' },
  'os.boot-tier1':   { state: 'new', what: 'REPLACED with your own file (windows-xp-startup.mp3). Microsoft audio, NOT CC0 — see CREDITS.md.' },
  'os.boot-tier2':   { state: 'new', what: 'REPLACED with your own file (windows-vista-startup.mp3). Microsoft audio, NOT CC0 — see CREDITS.md.' },
  'os.boot-tier3':   { state: 'new', what: 'REPLACED with your own file (w.mp3): an unlabelled Microsoft startup chime, three struck notes F#3 -> C#4 -> G#4 and a 1.6 s tail. NOT CC0 — see CREDITS.md.' },
  'os.boot-tier4':   { state: 'new', what: 'REPLACED with your own file (mac-os-big-sur-startup.mp3). Apple audio, NOT CC0 — see CREDITS.md.' },
};

let decided = 0, fresh = 0;
for (const b of doc.batches) {
  if (b.kind !== 'audio') continue;
  for (const item of b.items) {
    const a = APPLIED[item.id];
    if (!a) continue;
    const d = byId.get(item.id);
    if (a.state === 'decided') {
      item.decided = { verdict: d?.verdict || 'approve', at: d?.at || dec.at, applied: a.what };
      decided++;
    } else {
      item.changedSince = { previousVerdict: d?.verdict || null, previousNote: d?.note || '', applied: a.what };
      fresh++;
    }
  }
  const n = b.items.filter(i => i.decided).length;
  const m = b.items.filter(i => i.changedSince).length;
  b.note = b.note.replace(/\s*—\s*SIGN-OFF 2026-08-27[\s\S]*$/, '')
    + ` — SIGN-OFF 2026-08-27: ${n} of these ${n === 1 ? 'is' : 'are'} already approved and unchanged`
    + `${n ? ' (' + b.items.filter(i => i.decided).map(i => i.name).join(', ') + ') — no need to judge ' + (n === 1 ? 'it' : 'them') + ' again' : ''}.`
    + (m ? ` ${m} ${m === 1 ? 'is' : 'are'} NEW since you last listened and ${m === 1 ? 'needs' : 'need'} a fresh verdict.` : '');
}

// Durable record: make-batch.mjs carries a top-level `decisions` block over verbatim.
doc.decisions = {
  source: 'review/decisions-2026-08-27.json',
  appliedAt: new Date().toISOString(),
  appliedBy: 'audio-signoff',
  levelChanges: dec.levelChanges,
  applied: Object.fromEntries(Object.entries(APPLIED).map(([id, a]) => [id, a.what])),
};

writeFileSync(P, JSON.stringify(doc, null, 2) + '\n');
console.log(`decided ${decided}, needing a fresh verdict ${fresh}`);
for (const b of doc.batches) if (b.kind === 'audio') console.log(`\n[${b.id}] ${b.note}`);
