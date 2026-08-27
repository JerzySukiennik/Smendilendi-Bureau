// menu-mode.js — the module path src/main.js looks for.
//
// The mode itself lives in menu.js alongside the scene it builds; this file only
// exists so that main.js's MODE_MODULES table (./menu/menu-mode.js, export
// MenuMode) resolves without either file having to be renamed.

export { MenuMode, MENU_ITEMS, TITLE, SUN } from './menu.js';
export { MenuMode as default } from './menu.js';
