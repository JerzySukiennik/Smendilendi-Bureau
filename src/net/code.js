// Office codes — the only access control the session has.
//
// There is no auth (Spark plan, no anonymous auth), so the code IS the key to
// the office. It must therefore be long enough that guessing is hopeless, and
// unambiguous enough that a person can read it off a screen and type it in.
//
// Alphabet: 31 symbols, digits 2-9 and A-Z minus the lookalikes 0 O 1 I L.
// 31^8 = 852 891 037 441 combinations. At a (generous) 10 guesses/second a
// brute-force sweep of the whole space averages ~1 350 years, and RTDB would
// throttle long before that. Good enough for a session that lives an evening.
//
// No imports. Runs in bare node and in the browser.

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;
export const CODE_GROUP = 4;          // display grouping: ABCD-EFGH

/** Cryptographically strong random bytes, with a plain-Math fallback. */
function randomBytes(n) {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/**
 * A fresh office code. Uniform over the alphabet: bytes that would bias the
 * modulo (256 is not a multiple of 31) are rejected and redrawn.
 */
export function generateCode(length = CODE_LENGTH) {
  const n = CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;          // 248 for n = 31
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] >= limit) continue;            // reject, keeps it uniform
      out += CODE_ALPHABET[bytes[i] % n];
    }
  }
  return out;
}

/**
 * Clean up something a human typed: trim, drop separators, upper-case.
 * Does NOT silently repair characters that are not in the alphabet — 0/O and
 * 1/I/L are all excluded, so there is no unambiguous repair for them and a
 * quiet guess would drop the player into the wrong (or a non-existent) office.
 * Returns the cleaned string, which may still be invalid.
 */
export function normalizeCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
}

/** True when `input` cleans up to exactly one well-formed code. */
export function validateCode(input) {
  const s = normalizeCode(input);
  if (s.length !== CODE_LENGTH) return false;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Cleaned code, or null when it is not a valid one. */
export function parseCode(input) {
  const s = normalizeCode(input);
  return validateCode(s) ? s : null;
}

/**
 * Why a code was rejected, as a sentence for the join dialog.
 * Returns null when the code is fine.
 */
export function codeError(input) {
  const s = normalizeCode(input);
  if (s.length === 0) return 'Enter the office code.';
  if (s.length !== CODE_LENGTH) return `Office codes are ${CODE_LENGTH} characters — this one has ${s.length}.`;
  const bad = [...s].filter(ch => !CODE_ALPHABET.includes(ch));
  if (bad.length) {
    const amb = bad.filter(ch => '01OIL'.includes(ch));
    if (amb.length) return `Office codes never contain ${amb.join(', ')} — check the ${amb[0] === '0' || amb[0] === 'O' ? 'O / zero' : 'I / L / one'}.`;
    return `${bad.join(', ')} cannot appear in an office code.`;
  }
  return null;
}

/** ABCD-EFGH for display. Never store the formatted form. */
export function formatCode(code) {
  const s = normalizeCode(code);
  const parts = [];
  for (let i = 0; i < s.length; i += CODE_GROUP) parts.push(s.slice(i, i + CODE_GROUP));
  return parts.join('-');
}

/**
 * A stable per-browser identity. No accounts: the player id is a random string
 * kept in localStorage so a reload rejoins as the same person.
 */
export function playerIdFor(storageKey = 'smendilendi.pid') {
  const fresh = () => 'p' + generateCode(12).toLowerCase();
  try {
    const store = globalThis.localStorage;
    if (!store) return fresh();
    let id = store.getItem(storageKey);
    if (!id || id.length < 6) {
      id = fresh();
      store.setItem(storageKey, id);
    }
    return id;
  } catch {
    return fresh();                                // private mode, blocked storage
  }
}
