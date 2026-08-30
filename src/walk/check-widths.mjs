#!/usr/bin/env node
// check-widths.mjs — the clear widths the post-occupancy sheet prints, against
// hand calculations from the same drawing.
//
//   node src/walk/check-widths.mjs
//
// VIEW-FREE, no three.js, no DOM: it builds the demo models, builds the
// navmesh, and asserts millimetres. Exits non-zero on the first failure.
//
// WHY THIS FILE EXISTS. "Narrowest route walked — 1400 mm" printed for a gap
// the architect can scale off his own drawing at 700 mm is the game being
// caught being wrong about his profession, and it is not a failure any
// screenshot shows: the walkthrough looked perfect while the number was twice
// the truth. `passageWidth` used to take the WIDEST span over the four 0.10 m
// quarters of each 0.20 m search cell, which erased every obstruction shorter
// than about a metre — columns, pilasters, boxed ducts, a bookcase set end-on.
// Every case below was measured by hand off the model geometry first.

import { demoModel, demoKindergarten } from './demo.js';
import { buildNav, roomToRoom, pinchOf } from './navmesh.js';

let failures = 0;
const mm = (v) => `${(v * 1000).toFixed(0)} mm`;

function check(name, got, want, tol = 0.02) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        measured ${mm(got)}, hand calculation ${mm(want)} (±${mm(tol)})`);
}

function assert(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
}

/** The narrowest clear width on any room-to-room route in this plan. */
function narrowest(nav) {
  let worst = null;
  for (const a of nav.roomIds) {
    for (const b of nav.roomIds) {
      if (a === b) continue;
      const route = roomToRoom(nav, a, b);
      if (!route) continue;
      const p = pinchOf(nav, route);
      if (p && (!worst || p.width < worst.width)) worst = p;
    }
  }
  return worst;
}

// -- 1. the pilaster -------------------------------------------------------
// demoModel({ pinch: true }) hangs a 120 mm stub off the north corridor wall,
// ending at z = 4.76. The south face of the corridor is at z = 5.46.
// Clear width past it: 5.46 - 4.76 = 0.700 m.
{
  const nav = buildNav(demoModel({ pinch: true }), {});
  const w = narrowest(nav);
  check('a 120 mm pilaster pinches the 1.20 m corridor to 700 mm', w?.width ?? NaN, 0.700);
  assert('and the sheet points at the pilaster, not at some other door',
    !!w && Math.abs(w.x - 3.20) <= 0.45 && Math.abs(w.z - 5.10) <= 0.45,
    w ? `reported at (${w.x.toFixed(2)}, ${w.z.toFixed(2)}); the stub is at (3.20, 4.76 to 5.46)` : 'nothing measured');
}

// -- 2. the unobstructed corridor -----------------------------------------
// Same plan without the stub: 1.20 m clear the whole way, and the narrowest
// route in the house is then the 0.80 m bathroom door.
{
  const nav = buildNav(demoModel(), {});
  const w = narrowest(nav);
  check('the narrowest route in the clean house is the 800 mm bathroom door',
    w?.width ?? NaN, 0.800);

  // A cell in the corridor directly opposite a doorway must measure ACROSS the
  // corridor, not out through the door and across the room behind it.
  const corridor = nav.roomIds.find((r) => nav.labelOf(r) === 'Corridor');
  let worstOpposite = 0, at = null;
  for (const c of nav.roomCells(corridor)) {
    if (!nav.pass[c]) continue;
    const p = nav.centreOf(c);
    const span = nav.passageWidth(c, 1, 0);
    if (span > worstOpposite) { worstOpposite = span; at = p; }
  }
  assert('no corridor cell measures out through a doorway',
    worstOpposite <= 1.25,
    `widest reading anywhere in the 1.20 m corridor: ${mm(worstOpposite)}`
    + (at ? ` at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})` : ''));
}

// -- 3. the bookcase left standing in the corridor -------------------------
// demoModel({ broken: true }) stands a 320 mm deep bookcase against the south
// corridor wall: 1.20 - 0.32 = 0.88 m of floor, which the 0.10 m lattice
// reports conservatively as 8 cells, 0.800 m.
{
  const nav = buildNav(demoModel({ broken: true }), {});
  const w = narrowest(nav);
  check('a 320 mm bookcase takes the corridor to 800 mm', w?.width ?? NaN, 0.800);
}

// -- 4. the nursery --------------------------------------------------------
// A 1.48 m corridor and 0.90 m room doors: the narrowest route is a door leaf,
// stated at the width it was drawn at.
{
  const nav = buildNav(demoKindergarten(), {});
  const w = narrowest(nav);
  check('the nursery narrows at a 900 mm door leaf', w?.width ?? NaN, 0.900);
}

console.log(failures ? `\n${failures} FAILED` : '\nall widths agree with the drawing');
process.exit(failures ? 1 : 0);
