// dev.js — the harness that runs the OS on its own, outside the game.
//
// It builds the same ctx a Mode would get ({ state, audio, net }), seeds the
// state with a REAL commission and a REAL analysis report where those modules
// are available, and drives os.update(dt) from one rAF loop. Nothing in here is
// part of the OS; it exists so the OS can be run, looked at and screenshotted at
// 1:1 without the rest of the game being finished.
//
//   http://localhost:5179/src/os/dev.html
//
// Console API (used to take the four checklist screenshots):
//   OSDEV.os                  the OS instance
//   OSDEV.tier(n)             switch machine, skipping the boot animation
//   OSDEV.pose()              two overlapping windows, a menu open, scrollbars
//   OSDEV.shot()              the screen as a PNG data URL, 1:1

import { createOS } from './os.js';
import { createState } from '../core/state.js';
import { AudioBus } from '../core/audio.js';

const host = document.getElementById('host');
const state = createState();

// Audio: the same bus the game uses, pointed at the real manifest. No path
// override — AudioBus resolves assets/audio/ against its own module URL, so this
// page works at any depth.
const audio = new AudioBus();
audio.init();
audio.loadManifest().then(() => audio.preloadAll((n, e) => e.kind === 'os' || e.kind === 'ui' || n === 'sfx.mouse-click')).catch(() => {});

// A local stand-in for src/net's Session, so Chat has people to talk to without
// the OS ever importing Firebase.
const net = makeLocalNet();

const ctx = { state, audio, net, nick: 'Jurek' };

// Seed real content where the analysis and commission modules exist. Both are
// being edited by another agent right now, so every import is optional.
await seed(state).catch((e) => console.info('[dev] running on the sample inbox —', e.message));

const os = createOS(ctx);
os.attachDOM(host);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  os.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// THE RETRO GUARD. Tier 1 scored 20/20 against real Windows 95 captures and
// survived a blind A/B; tiers 3 and 4 are about to be rebuilt as Windows 11 and
// macOS analogues ON THE SAME DRAWING SURFACE. The one way that work can break
// tier 1 is by letting alpha, easing, anti-aliased type or a rounded corner
// leak into the shared code — every one of which shows up as colours that are
// not in the palette. So: paint the tier-1 desktop, count distinct colours,
// and refuse anything outside VGA-16 + #DFDFDF (ButtonLight) + #FFFFE1 (tooltip
// cream). A real Win95 frame samples 13-17 colours; the cap is 20.
// Run from the console on this page: `await OSDEV.retroGuard()`; the tier-3/4
// critic runs it after every change and treats a fail as a blocker.
const RETRO_PALETTE = new Set([
  '000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
  '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff',
  'dfdfdf', 'ffffe1',
]);
// THE GATE GOVERNS THE STARTER MACHINE, AND ONLY THAT.
// It used to cover tiers 1 and 2, because both were 1990s Windows. Jurek moved
// Kompakt 2000 to Windows XP on 2026-09-05, and XP is not a 16-colour era: it
// has rounded title bars, three-stop gradients and a soft drop shadow on its
// title text, every one of which this gate exists to forbid. The goal names
// Windows 95/98 as the bar "for the fictional OS on the starter computer", so
// the starter computer is exactly the scope, and pinning it there keeps the
// gate at full strength instead of it being switched off as a nuisance.
const RETRO_TIERS = [1];

async function retroGuard(tier = 1, { maxDistinct = 20 } = {}) {
  // PIN THE GATE TO THE ERAS IT GOVERNS. A critic pointed out that the guard
  // would happily be aimed at tier 3 or 4 and fail them, because a Windows 11
  // or macOS analogue MUST exceed 20 colours — so the one check protecting the
  // best-scoring piece in the game could be "disproved" by misuse and switched
  // off. It now refuses tiers it does not govern instead of failing them.
  if (!RETRO_TIERS.includes(tier)) {
    const r = { tier, skipped: true, pass: true,
      why: `tier ${tier} is a modern analogue; the retro palette gate does not apply` };
    console.info('[retro-guard]', 'SKIP', r);
    return r;
  }
  os.setTier(tier, { boot: false });
  // a few frames so the desktop, taskbar and any open window are all painted
  for (let i = 0; i < 6; i++) { os.update(1 / 60); await new Promise((r) => requestAnimationFrame(r)); }
  const c = os.canvas;
  const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Map();
  for (let i = 0; i < img.length; i += 4) {
    const k = ((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]).toString(16).padStart(6, '0');
    seen.set(k, (seen.get(k) || 0) + 1);
    if (img[i + 3] !== 255) seen.set('ALPHA<255', (seen.get('ALPHA<255') || 0) + 1);
  }
  // TIER 2's SANCTIONED GRADIENT. CORNICE 98's active title bar is the Windows 98
  // ramp #000080 -> #1084D0, which is a legitimate period feature and by
  // definition a few hundred distinct colours. Excluding the whole title bar by
  // row would also excuse anything else drawn there, so instead a colour is
  // forgiven only if it actually sits ON that ramp, within a couple of levels.
  const onWin98Ramp = (hex) => {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const t = g / 132;                                   // green runs 0 -> 132 across the ramp
    if (t < -0.02 || t > 1.02) return false;
    return Math.abs(r - 16 * t) <= 3 && Math.abs(b - (128 + 80 * t)) <= 3;
  };
  const forgiven = tier === 2 ? onWin98Ramp : () => false;
  const offPalette = [...seen.entries()]
    .filter(([k]) => !RETRO_PALETTE.has(k) && !forgiven(k))
    .sort((a, b) => b[1] - a[1]);
  const distinct = seen.size;
  // The ramp's own colours do not count against the budget either.
  const rampCount = tier === 2 ? [...seen.keys()].filter(forgiven).length : 0;
  const budget = distinct - rampCount;
  const pass = budget <= maxDistinct && offPalette.length === 0;
  const report = { tier, size: `${c.width}x${c.height}`, distinct, offRamp: budget, maxDistinct,
    offPalette: offPalette.slice(0, 12).map(([k, n]) => `#${k} x${n}`), pass };
  console[pass ? 'info' : 'error']('[retro-guard]', pass ? 'PASS' : 'FAIL', report);
  return report;
}

/**
 * The whole standing gate, for anything that wants one call: every retro tier,
 * plus a structural assertion that modern chrome has not leaked into the shared
 * drawing surface. The palette check catches colour; this catches the shapes
 * that would produce it — alpha, blur, rounded corners, fractional coordinates.
 */
/** Source with // and block comments removed. Strings are left alone. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

async function retroGate() {
  const results = [];
  for (const t of RETRO_TIERS) results.push(await retroGuard(t));
  // Strip comments before scanning. A gate that fails because a COMMENT
  // explains why rgba() is banned is a gate that teaches you to stop writing
  // the explanation down, and the explanation is the valuable half. Measured:
  // the sentence "the first rgba() it met" in themes.js failed the whole gate.
  const src = stripComments([themesSource, osSource].filter(Boolean).join('\n'));
  const banned = [
    [/\brgba\s*\(/, 'rgba() — the era has no alpha; 50 % is a 1 px checkerboard'],
    [/shadowBlur\s*=/, 'shadowBlur — nothing in 1995 had a soft shadow'],
    [/\broundRect\s*\(/, 'roundRect — every corner is a hard 90 degree pixel corner'],
    [/borderRadius/, 'borderRadius — same'],
    [/globalAlpha\s*=\s*0?\.[0-9]/, 'fractional globalAlpha'],
  ];
  const leaks = [];
  for (const [re, why] of banned) {
    const m = src.match(new RegExp(re.source, 'g'));
    if (m) leaks.push(`${why} (${m.length}x)`);
  }
  const pass = results.every((r) => r.pass) && leaks.length === 0;
  const out = { tiers: results.map((r) => `${r.tier}:${r.pass ? 'pass' : 'FAIL'}${r.skipped ? ' (skipped)' : ''}`), leaks, pass };
  console[pass ? 'info' : 'error']('[retro-gate]', pass ? 'PASS' : 'FAIL', out);
  return out;
}

// The retro drawing surface's own source, read once, so the structural check
// above looks at what actually ships rather than at a remembered rule.
let themesSource = '', osSource = '';
try {
  themesSource = await (await fetch(new URL('./themes.js', import.meta.url))).text();
  osSource = await (await fetch(new URL('./os.js', import.meta.url))).text();
} catch (_) { /* file:// or offline — the palette check still runs */ }

window.OSDEV = {
  retroGuard,
  retroGate,
  os,
  state,
  tier(n) {
    os.setTier(n, { boot: false });
    os.update(0);
    return `${os.config.hardware} — ${os.config.osName} ${os.config.osVersion} at ${os.theme.w}x${os.theme.h}`;
  },
  /** The pose every tier is screenshotted in: two overlapping windows, a menu
   *  open over them, and a scrollbar in both panes. */
  pose(menu = 0) {
    os.phase = 'desktop';
    os.wm.closeAll();
    os.startOpen = false;
    const th = os.theme;
    const mail = os.openApp('mail');
    const cost = os.openApp('cost');
    const mac = th.family === 'platinum';
    const left = mac ? 12 : 92;              // leave the desktop icon column clear
    mail.x = left; mail.y = mac ? th.metrics.menuBarH + 8 : 8;
    mail.w = Math.round(th.w * 0.78); mail.h = Math.round(th.h * 0.58);
    cost.x = left + Math.round(th.w * 0.10); cost.y = Math.round(th.h * 0.30);
    cost.w = Math.round(th.w * 0.72); cost.h = Math.round(th.h * 0.56);
    if (cost.x + cost.w > th.w - 6) cost.x = th.w - 6 - cost.w;
    for (const w of [mail, cost]) w.app?.resize?.(th.clientOf(w));
    os.wm.focus(cost);
    os.cursor.x = Math.round(th.w * 0.42);
    os.cursor.y = Math.round(th.h * 0.52);
    os.cursor.visible = true;
    os.focused = true;
    os.invalidate();
    os.update(0);                       // lay the menu bar out before opening it
    const item = cost.menu[menu];
    const r = item._rect;
    os.wm.openMenu('win', cost, menu, item.items, { x: r.x, y: r.y + r.h });
    os.wm.menu.hot = os.wm.menu.items.find((i) => !i.sep) ?? null;
    os.update(0);
    return 'posed';
  },
  /** The clean pixels, which is what the authenticity checklist is ticked on. */
  shot() { return os.canvas.toDataURL('image/png'); },
  /** The same frame through the monitor's glass, for the office. */
  shotCrt() { os.setCrt(true); os.invalidate(); os.paint(); const d = os.crtCanvas.toDataURL('image/png'); os.setCrt(false); os.invalidate(); os.paint(); return d; },
};

console.info('[dev] OS harness ready. OSDEV.tier(1..4), OSDEV.pose(), OSDEV.shot()');

// ---------------------------------------------------------------------------

async function seed(st) {
  const { generateCommission } = await import('../commission/index.js');
  const commission = generateCommission('smendilendi-os', 0.5);
  st.set('commission', commission);

  const messages = [{
    id: 'brief', kind: 'brief', locked: true, unread: true,
    at: Date.now() - 26 * 3600e3,
    from: `${commission.client.name}${commission.client.company ? `, ${commission.client.company}` : ''}`,
    subject: `${commission.title} — brief`,
    body: commission.briefText,
  }];

  // A revision e-mail needs a model and a report; if the model module is not
  // ready, the brief alone is still real content.
  try {
    const { createModel } = await import('../model/building.js');
    const { runAnalysis } = await import('../analysis/index.js');
    const { revisionMail } = await import('../analysis/mail.js');
    const model = createModel();
    const report = runAnalysis(model, commission);
    // An empty model prices out at nothing. Only publish a report the Cost
    // Sheet can actually show; otherwise it falls back to its own sample bill.
    if ((report.metrics?.cost?.bill?.length ?? 0) > 3) st.set('analysis', report);
    const mail = revisionMail(report, commission);
    messages.push({
      id: 'revision', unread: true, at: Date.now() - 2 * 3600e3,
      from: mail.from, subject: mail.subject, body: mail.body,
    });
  } catch (e) {
    console.info('[dev] no analysis yet —', e.message);
  }

  const { sampleInbox } = await import('./apps/mail.js');
  for (const m of sampleInbox(null)) if (m.id !== 'brief') messages.push(m);
  st.set('mail.messages', messages);
  st.set('mail.unread', messages.filter((m) => m.unread).length);
}

function makeLocalNet() {
  const handlers = new Map();
  const players = [
    { id: 'p1', nick: 'Jurek', color: '#000080' },
    { id: 'p2', nick: 'Marta', color: '#800000' },
    { id: 'p3', nick: 'Wojtek', color: '#008080' },
  ];
  const log = [
    { pid: 'p2', nick: 'Marta', text: 'I have the north wing. Leave the stair to me.', at: Date.now() - 640e3 },
    { pid: 'p3', nick: 'Wojtek', text: 'The corridor by the WC is 1.05 m. It has to be 1.20.', at: Date.now() - 420e3 },
    { pid: 'p2', nick: 'Marta', text: 'Widening it now — grabbing that wall, hands off for a minute.', at: Date.now() - 380e3 },
    { pid: 'p1', nick: 'Jurek', text: 'Fine. I am moving the entrance to face the street anyway.', at: Date.now() - 120e3 },
  ];
  return {
    kind: 'local', code: 'GZOWO-14', playerId: 'p1', players, chatLog: log,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    chat(text) {
      const m = { pid: 'p1', nick: 'Jurek', text, at: Date.now() };
      log.push(m);
      for (const fn of handlers.get('chat') ?? []) fn(m);
      return m;
    },
  };
}
