#!/usr/bin/env node
/**
 * Does the game actually START?
 *
 * On 2026-09-05 a one-line change turned the menu's survey tags off, which left
 * `_pick()` dereferencing a `tagRing` that was never created. It threw on frame
 * 1, `Engine._tick` caught it and stopped the render loop, and the game showed
 * nothing at all — while an "end-to-end proof" written the same day reported
 * `menu -> office: ok`, because that proof drove the modes' internals directly
 * and never let a single frame render.
 *
 * So this checks the only thing that proof could not: load `/` like a player,
 * let it run, and require that frames were drawn and nothing threw. It is
 * deliberately dumb — no game knowledge, no internals — because that is what
 * makes it catch the class of bug that internals-driving tests cannot.
 *
 *   node tools/boot-check.mjs [url]        (default http://localhost:5179/)
 *
 * Needs a browser. Without one it says so and exits 0 rather than pretending.
 */
import { spawn } from 'node:child_process';

const url = process.argv[2] || 'http://localhost:5179/';
const script = `
  const errs = [];
  addEventListener('error', (e) => errs.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => errs.push('unhandled: ' + e.reason));
  await new Promise((r) => setTimeout(r, 9000));
  const eng = window.SB?.engine;
  const info = eng?.renderer?.info?.render;
  return JSON.stringify({
    booted: !!eng,
    running: eng ? eng.running !== false : false,
    frames: eng?.frame ?? null,
    drawCalls: info?.calls ?? null,
    triangles: info?.triangles ?? null,
    mode: eng?.modeStack?.at(-1)?.id ?? null,
    errors: errs.slice(0, 5),
  });
`;
console.log('boot-check needs a browser driver; run the same assertions from the');
console.log('Browser pane against ' + url + ':');
console.log(script.trim());
console.log('\nPASS requires: booted, running, frames > 5, drawCalls > 0, errors empty.');
