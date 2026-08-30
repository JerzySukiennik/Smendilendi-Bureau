#!/usr/bin/env node
/**
 * Writes assets/audio/build/callsites.json — every (id, context) the game can
 * play and the line of src/ that plays it — so level-report.html can show the
 * call site next to the level it MEASURED in a real browser. Same scanner the
 * sign-off uses, so the page cannot quietly disagree with the verifier.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCallSites, stringRefs } from './scan-callsites.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/audio/manifest.json'), 'utf8'));
const { sites } = scanCallSites({ root: ROOT, manifest });
const out = {};
for (const s of sites) {
  for (const id of s.ids || []) {
    const key = `${id}|${s.context || '(base)'}`;
    (out[key] ||= []).push({ at: `${s.file.replace(/^src\//, '')}:${s.line}`, fn: s.fn,
                             dynamic: !!s.dynamic });
  }
}
// Ids reached through a runtime id — the boot chime is picked as
// `computerTier(tier).bootSound` and handed to play() as a variable, so it has no
// literal call site. Without these the report would print "—" next to a sound
// that very much does play, which reads as dead weight.
const refs = stringRefs(ROOT, new Set(Object.keys(manifest)));
for (const [id, hits] of refs) {
  const key = `${id}|(base)`;
  if (out[key]) continue;
  out[key] = hits.map((h) => ({ at: `${String(h.at || h).replace(/^src\//, '')}`, fn: 'via ' + (h.kind || 'reference'),
                                dynamic: false }));
}
writeFileSync(join(HERE, 'callsites.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`callsites.json: ${Object.keys(out).length} (id, context) paths`);
