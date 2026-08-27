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
  return {
    context: ctx ? (ctx[1] ?? ctx[2]) : null,
    contextExpr: ctxExpr,
    volume: vol ? vol[1].trim() : null,
    dynamic: dyn ? dyn[1].trim() : null,
    bus: bus ? bus[1] : null,
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
      // Not an audio call at all (three.js AnimationAction.play(), a DOM
      // media element, a custom loop()) — unless it carries audio options.
      const opts = readOpts(body, arg.length);
      const audioish = /audio|\bos\b|this\.play|\.play\?\./.test(text.slice(Math.max(0, m.index - 40), m.index + 6));
      if (!res.ids.length && res.form === 'expression' && !opts.volume && !opts.context && !audioish) continue;
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
  const refs = new Map();                 // id -> ['file:line', ...]
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/'([^']+)'|"([^"]+)"/g)) {
        const id = m[1] ?? m[2];
        if (!manifestIds.has(id)) continue;
        if (!refs.has(id)) refs.set(id, []);
        refs.get(id).push(`${relative(root, file)}:${i + 1}`);
      }
    });
  }
  return refs;
}

/** A blunt second net: no raw `volume:` may exist in src/ outside the engine. */
export function rawVolumeHits(root) {
  const hits = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((l, i) => {
      if (/[{,]\s*volume\s*:/.test(l)) hits.push(`${relative(root, file)}:${i + 1}  ${l.trim()}`);
    });
  }
  return hits;
}
