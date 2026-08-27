// walk-mode.js — the entry point src/main.js imports.
//
// The mode itself lives in walk.js; this file exists because main.js registers
// modes by a fixed path convention (`./<mode>/<mode>-mode.js`) and because a
// one-line re-export is cheaper to keep in step than a duplicated class.

export { WalkthroughMode, WalkthroughMode as default } from './walk.js';
export { DAY_START, DAY_END, MINUTES_PER_SECOND } from './walk.js';
