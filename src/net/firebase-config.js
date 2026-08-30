// The ONE place the Firebase project is named. Nothing else in the codebase
// may hard-code any of these values.
//
// This is NOT a secret. A Firebase web config is public by design and ships in
// every client; security comes from database.rules.json and from the 8-character
// office code, not from hiding this file.
//
// This game has its OWN Firebase project (`bureau-gzowo-40531`, on the account
// jerzysukiennik203@gmail.com) rather than sharing `gzowos-games` with the other
// Gzowo games. That matters for one reason worth remembering: a Realtime Database
// has a single ruleset for the whole instance, so on the shared database a
// `firebase deploy --only database` replaces the rules for every game at once and
// has silently deleted another game's block before now. Here the rules are ours
// alone and deploying them is safe.

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyB8NHBrwa-1hGkEHBPxpVxnzKMrEWdmSuw',
  authDomain: 'bureau-gzowo-40531.firebaseapp.com',
  databaseURL: 'https://bureau-gzowo-40531-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'bureau-gzowo-40531',
  storageBucket: 'bureau-gzowo-40531.firebasestorage.app',
  messagingSenderId: '693888626841',
  appId: '1:693888626841:web:d8ce3f4c50bc2a936c4808',
};

/** Deploy tooling and any future non-module consumer read the same object. */
export const firebaseConfig = FIREBASE_CONFIG;

/** Firebase JS SDK, ESM, straight from the CDN. No bundler, no npm. */
export const FIREBASE_SDK = {
  app: 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
  database: 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js',
};

/** Root of everything this game writes. */
export const DB_ROOT = 'smendilendi';

/**
 * True while the config still holds placeholders. The session checks this
 * BEFORE touching the network and falls back to local mode with one warning,
 * so a fresh clone of the repo runs single player perfectly and never throws.
 */
export function isPlaceholderConfig(cfg = FIREBASE_CONFIG) {
  return Object.values(cfg).some((v) => typeof v === 'string' && v.includes('REPLACE_ME'));
}

export default FIREBASE_CONFIG;
