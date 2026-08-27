#!/usr/bin/env node
// Append one entry to progress/progress.json.
// usage: node tools/log-progress.mjs '<json>'
//   json = { piece, role:"builder"|"critic"|"orchestrator", round, status:"wip"|"pass"|"fail",
//             headline, detail?, gap?, files?:[], metrics?:{} }
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = join(root, 'progress/progress.json');
const arg = process.argv[2];
if (!arg) { console.error('need a JSON argument'); process.exit(1); }
const entry = JSON.parse(arg);
entry.at = new Date().toISOString();
const db = JSON.parse(readFileSync(p, 'utf8'));
db.entries.push(entry);
db.updated = entry.at;
writeFileSync(p, JSON.stringify(db, null, 1));
console.log('logged:', entry.piece, entry.status, entry.headline);
