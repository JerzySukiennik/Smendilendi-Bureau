// scan-callsites.mjs — find every place in src/ that asks for a sound, and what
// level that place will actually produce.
//
// The audio sign-off used to be checked by comparing two copies of the same
// arithmetic: the engine's master x bus x asset against the review page's master
// x bus x asset. Both agreed, and both were wrong, because the thing that
// actually cut the human's approved levels lived at the CALL SITES —
// `play('music.office-ambient-1', { volume: 0.55 })`. Nothing in the chain looked
// at those. This module does.
//
// It is deliberately a text scanner, not a parser: no build step, no npm
// packages, and a regex over a call is enough to answer the only question that
// matters — which id, in which declared context, with what extra factor.
//
//   scanCallSites({ root, manifest }) -> { sites, errors, files }
//     sites: [{ file, line, fn, id, ids, context, dynamic, volume, raw }]
//
// `ids` is what a template literal expands to (`sfx.footstep-${kind}-${n}` ->
// the eight footstep ids that exist in the manifest). A call whose id is a
// variable resolves to no ids and is reported, so a reviewer can see it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const CALL_RE = /\.\s*(play|music|musicPlaylist|loop|stopLoop)\s*\??\.?\s*\(/g;

/**
 * `file:line` of calls that are provably not audio (a three.js AnimationAction,
 * a DOM media element). Empty today, and every addition needs a reason in the
 * commit: this list is the only way a .play() escapes the level table.
 */
const NON_AUDIO = new Set([]);

/**
 * Blank out // and /* *\/ comments, keeping every byte position and newline, so a
 * line/column computed on the result still points at the real file. A rule about
 * what the CODE says must not fire on a comment that quotes the thing it forbids
 * — which is exactly what happened the first time check 10 ran, on the paragraph
 * in lobby.js explaining why the bus-mix literal was deleted.
 */
export function stripComments(text) {
  let out = '';
  let i = 0;
  const keep = (c) => (c === '\n' ? '\n' : ' ');
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) out += keep(text[i]);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] ?? ''); i += 2; continue; }
        out += text[i];
        if (text[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Files worth scanning: everything under src/ except the audio engine itself. */
export function sourceFiles(root, skip = ['src/core/audio.js']) {
  const out = [];
  const skipSet = new Set(skip.map((s) => join(root, s)));
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (['.js', '.html', '.mjs'].includes(extname(name)) && !skipSet.has(p)) out.push(p);
    }
  };
  walk(join(root, 'src'));
  return out;
}

/**
 * Text from just after an opening paren to its matching close, honouring
 * strings, template literals and nested ${}. Returns null if unbalanced.
 */
function callBody(text, open) {
  let i = open, depth = 0;
  const stack = [];                       // 'sq' | 'dq' | 'tpl' | 'tplExpr'
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    const top = stack[stack.length - 1];
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack.pop();
      i++; continue;
    }
    if (top === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && n === '{') { stack.push('tplExpr'); i += 2; continue; }
      i++; continue;
    }
    if (c === "'") { stack.push('sq'); i++; continue; }
    if (c === '"') { stack.push('dq'); i++; continue; }
    if (c === '`') { stack.push('tpl'); i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; if (top === 'tplExpr' && c === '{') stack.push('brace'); i++; continue; }
    if (c === '}' && top === 'tplExpr') { stack.pop(); i++; continue; }
    if (c === '}' && top === 'brace') { stack.pop(); depth--; i++; continue; }
    if (c === '}' || c === ']') { depth--; i++; continue; }
    if (c === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
      i++; continue;
    }
    i++;
  }
  return null;
}

/** The first argument's source text (up to the top-level comma). */
function firstArg(body) {
  let depth = 0;
  const stack = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i], n = body[i + 1];
    const top = stack[stack.length - 1];
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') { i++; continue; }
      if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) stack.pop();
      continue;
    }
    if (top === 'tpl') {
      if (c === '\\') { i++; continue; }
      if (c === '`') stack.pop();
      else if (c === '$' && n === '{') { stack.push('tplExpr'); i++; }
      continue;
    }
    if (c === "'") { stack.push('sq'); continue; }
    if (c === '"') { stack.push('dq'); continue; }
    if (c === '`') { stack.push('tpl'); continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { if (top === 'tplExpr' && c === '}') stack.pop(); else depth--; continue; }
    if (c === ',' && depth === 0) return body.slice(0, i);
  }
  return body;
}

/**
 * Which manifest ids an argument can name.
 *   'ui.click'                       -> ['ui.click']
 *   `sfx.footstep-${kind}-${n}`      -> every manifest id matching the shape
 *   ['music.a', 'music.b']           -> both (musicPlaylist)
 *   someVariable                     -> [] (reported, not guessed)
 */
export function resolveIds(arg, manifestIds) {
  const a = arg.trim();
  if (!a) return { ids: [], form: 'empty' };
  if (a === 'null' || a === 'undefined') return { ids: [], form: 'stop' };

  if (a.startsWith('[')) {
    const parts = [...a.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    return { ids: parts.filter((p) => manifestIds.has(p)), form: 'array',
             unknown: parts.filter((p) => !manifestIds.has(p)) };
  }
  const lit = a.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (lit) {
    const id = lit[1] ?? lit[2];
    return { ids: manifestIds.has(id) ? [id] : [], form: 'literal',
             unknown: manifestIds.has(id) ? [] : [id] };
  }
  if (a.startsWith('`')) {
    const body = a.slice(1, -1);
    // ${...} -> one id segment; everything else is literal and must match exactly
    let re = '^';
    let i = 0;
    while (i < body.length) {
      if (body[i] === '$' && body[i + 1] === '{') {
        let d = 1, j = i + 2;
        while (j < body.length && d > 0) { if (body[j] === '{') d++; else if (body[j] === '}') d--; j++; }
        re += '[A-Za-z0-9_-]+';
        i = j;
      } else {
        re += body[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i++;
      }
    }
    re += '$';
    const rx = new RegExp(re);
    return { ids: [...manifestIds].filter((id) => rx.test(id)), form: 'template', pattern: re };
  }
  return { ids: [], form: 'expression' };
}

/** `context: 'name'` / `volume: <expr>` / `dynamic: <expr>` in the options object. */
function readOpts(body, afterFirst) {
  const rest = body.slice(afterFirst);
  const ctx = rest.match(/[{,]\s*context\s*:\s*'([^']+)'|[{,]\s*context\s*:\s*"([^"]+)"/);
  const ctxExpr = !ctx && /[{,]\s*context\s*:/.test(rest);
  const vol = rest.match(/[{,]\s*volume\s*:\s*([^,}]+)/);
  const dyn = rest.match(/[{,]\s*dynamic\s*:\s*([^,}]+)/);
  const bus = rest.match(/[{,]\s*bus\s*:\s*'([^']+)'/);
  const busExpr = !bus && /[{,]\s*bus\s*:/.test(rest);
  return {
    context: ctx ? (ctx[1] ?? ctx[2]) : null,
    contextExpr: ctxExpr,
    volume: vol ? vol[1].trim() : null,
    dynamic: dyn ? dyn[1].trim() : null,
    bus: bus ? bus[1] : null,
    busExpr,
  };
}

export function scanCallSites({ root, manifest }) {
  const manifestIds = new Set(Object.keys(manifest));
  const files = sourceFiles(root);
  const sites = [];
  const errors = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file);
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(text))) {
      const open = m.index + m[0].length - 1;
      const body = callBody(text, open);
      if (body === null) { errors.push(`${rel}: unbalanced ${m[1]}( call`); continue; }
      const arg = firstArg(body);
      const res = resolveIds(arg, manifestIds);
      const opts = readOpts(body, arg.length);
      // ROUND 4: this used to drop any call whose id was a plain variable unless a
      // 40-character peek behind it smelled of audio. `const h = a.play(name, opts)`
      // — the OS's own play wrapper, through which every OS sound is routed —
      // did not smell of audio, so the one place a critic could hide a level
      // change was the one place the scanner refused to look. Expression-form
      // calls are now KEPT and listed; the 9f table shows them as runtime ids and
      // fails them if they carry any override. There are five such calls in src/
      // today and none of them is a three.js AnimationAction, so the false-positive
      // cost is zero; if a genuine non-audio .play() ever appears, it belongs in
      // NON_AUDIO below by name rather than behind a guess.
      if (NON_AUDIO.has(`${rel}:${text.slice(0, m.index).split('\n').length}`)) continue;
      if (res.form === 'stop' && m[1] !== 'music') continue;

      sites.push({
        file: rel,
        line: text.slice(0, m.index).split('\n').length,
        fn: m[1],
        arg: arg.trim(),
        form: res.form,
        ids: res.ids,
        unknown: res.unknown || [],
        ...opts,
        raw: text.slice(m.index, m.index + Math.min(body.length + m[0].length + 1, 200)).replace(/\s+/g, ' '),
      });
    }
  }
  sites.sort((a, b) => (a.ids[0] || 'zzz').localeCompare(b.ids[0] || 'zzz')
                    || a.file.localeCompare(b.file) || a.line - b.line);
  return { sites, errors, files: files.length };
}

/**
 * Manifest ids that appear as a plain string literal somewhere in src/ without
 * being the argument of a play call — a boot chime reached through
 * `computerTier(tier).bootSound`, say. Not a level, but proof the id is wired to
 * something, which is the difference between "played indirectly" and "dead".
 */
export function stringRefs(root, manifestIds) {
  const refs = new Map();                 // id -> [{ at, kind }, ...]
  for (const file of sourceFiles(root)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(root, file);
    // Matched per LINE, because a lone apostrophe inside a double-quoted string
    // ("the office's") desynchronises quote pairing for the rest of a file-wide
    // scan and silently loses every id after it. refKind still sees the whole
    // preceding text, so a wrapped preload list is still read as a list.
    let offset = 0;
    for (const line of text.split('\n')) {
      for (const m of line.matchAll(/'([^']+)'|"([^"]+)"/g)) {
        const id = m[1] ?? m[2];
        if (!manifestIds.has(id)) continue;
        if (!refs.has(id)) refs.set(id, []);
        refs.get(id).push({
          at: `${rel}:${text.slice(0, offset).split('\n').length}`,
          kind: refKind(text, offset + m.index),
        });
      }
      offset += line.length + 1;
    }
  }
  return refs;
}

/**
 * What a bare id string is DOING where it sits, judged by the character in front
 * of it. Three outcomes, and only one of them is evidence that anything plays:
 *
 *   list     `const names = ['ui.click', 'ui.mail-notify', ...]` — a preload or
 *            decode list. ROUND 4: verify-signoff counted exactly this as proof
 *            that ui.mail-notify was reachable and printed it at 53.55% / yes,
 *            when the only thing that array does is decode the file. A list is
 *            not a playback path.
 *   dispatch `sound: 'os.boot-tier1'` — a sound slot on a data object, reached at
 *            runtime through computerTier(tier).bootSound. That IS a playback
 *            path; the id resolves and plays at its declared level.
 *   arg      the argument of some other call (a load()).
 */
export function refKind(text, at) {
  // The whole preceding text, not the line: a preload list wraps, and its second
  // line starts with the string itself. Judging by the line alone called
  // 'sfx.keyboard-type-1' — the first entry on a continuation line — "other".
  const before = text.slice(0, at).replace(/\s+$/, '');
  if (/[[,]$/.test(before)) return 'list';
  if (/[:=]$/.test(before)) return 'dispatch';
  if (/\($/.test(before)) return 'arg';
  return 'other';
}

/**
 * A blunt second net: no key that bends a level may exist in src/ outside the
 * engine. `volume:` multiplies on top of the reviewed number; `bus:` swaps the
 * bus gain for another one (ui 0.7 for sfx 0.8 is 1.14x louder), which round 4's
 * critic used to make menu.js:899 play ui.click at 61.20% while the verifier
 * printed 53.55% / yes. Both are ignored by the engine now; this makes writing
 * one a build failure rather than a silent no-op.
 */
export function rawVolumeHits(root) {
  const hits = [];
  for (const file of sourceFiles(root)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((l, i) => {
      if (/[{,]\s*(volume|bus)\s*:/.test(l)) hits.push(`${relative(root, file)}:${i + 1}  ${l.trim()}`);
    });
  }
  return hits;
}

/**
 * Every place outside src/core/audio.js that states a bus LEVEL rather than
 * reading one. Two shapes, both of which have shipped:
 *
 *   a) an object literal keyed by the mix's own bus names with numeric values —
 *      src/menu/lobby.js held `{ master: 0.9, music: 0.45, ambient: 0.5,
 *      sfx: 0.8, ui: 0.7 }`, a third copy of mix.json, and pushed it onto the bus
 *      on menu entry. Nothing checked that it still agreed with mix.json.
 *   b) a numeric literal handed to setVolume/setBusGain/setMasterGain — the same
 *      lie in one line instead of five.
 *
 * String maps (labels) and variables are fine: a label cannot be a level.
 */
export function mixLiteralHits(root, busNames, skip = ['src/core/audio.js']) {
  const hits = [];
  const buses = new Set(busNames);
  const NUM = String.raw`-?\d*\.?\d+`;
  for (const file of sourceFiles(root, skip)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(root, file);
    // a) object literals: collect every `key: <number>` pair inside one { ... }
    for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
      const named = [...m[1].matchAll(new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*:\s*(${NUM})\s*(?:,|$)`, 'g'))]
        .map((x) => x[1]).filter((k) => buses.has(k));
      if (new Set(named).size >= 2) {
        hits.push(`${rel}:${text.slice(0, m.index).split('\n').length}  bus-mix literal { ${named.join(', ')} } `
          + '— mix.json is the only place a bus level is written');
      }
    }
    // b) a level pushed straight at the bus
    text.split('\n').forEach((l, i) => {
      const m = l.match(new RegExp(String.raw`\.(setVolume|setBusGain|setMasterGain|setUserVolume)\s*\(([^)]*)\)`));
      if (!m) return;
      const args = m[2].split(',').map((a) => a.trim());
      const last = args[args.length - 1] || '';
      if (new RegExp(`^${NUM}$`).test(last))
        hits.push(`${rel}:${i + 1}  ${m[1]}(..., ${last}) — a literal bus level outside mix.json`);
    });
  }
  return hits;
}
