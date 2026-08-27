// The ONE place the Firebase project is named. Nothing else in the codebase
// may hard-code any of these values.
//
// >>> ORCHESTRATOR: replace the placeholders below with the real config from
// >>> the Firebase console (Project settings -> Your apps -> Web app -> SDK
// >>> setup and configuration -> Config), for the gzowotesla@gmail.com project
// >>> on the Spark plan. Only `databaseURL`, `apiKey`, `projectId` and
// >>> `appId` are actually needed by Realtime Database. Leave the rest as-is
// >>> if the console does not give them.
//
// These values are NOT secrets — a Firebase web config is public by design and
// ships in every client. Access control is the office code plus the database
// rules, not the config. Suggested rules for /smendilendi (paste into the RTDB
// Rules tab), which stop the whole database from being enumerable while still
// allowing an office to be read and written by anyone holding its code:
//
//   {
//     "rules": {
//       "smendilendi": {
//         "$office": {
//           ".read":  "$office.length >= 8",
//           ".write": "$office.length >= 8",
//           "ops":      { ".indexOn": [] },
//           "players":  { "$pid": { ".validate": "newData.hasChildren(['nick','color'])" } }
//         }
//       }
//     }
//   }
//
// NOTE: the shared RTDB rules hazard in the global stack notes applies if this
// ever lands in the gzowos-games instance — a rules deploy replaces the WHOLE
// ruleset. Merge into the live rules, never overwrite them.

export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_ME_API_KEY',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  databaseURL: 'https://REPLACE_ME-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME.appspot.com',
  messagingSenderId: 'REPLACE_ME_SENDER_ID',
  appId: 'REPLACE_ME_APP_ID',
};

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
  return Object.values(cfg).some(v => typeof v === 'string' && v.includes('REPLACE_ME'));
}
