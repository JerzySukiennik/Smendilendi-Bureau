// snap-check.mjs — the inference engine, checked in node, in BOTH cameras.
//
//   node src/editor/snap-check.mjs
//
// Why this file exists. Round 1 of the editor shipped an axis lock that drew a
// 60.1 m wall when the player asked for 4 m, and nobody caught it, because the
// same gesture was correct in the orthographic plan view and only wrong in the
// perspective one. Every linear inference was computing a WORLD position by
// interpolating a SCREEN parameter, which is exact under an affine projection
// and nonsense under a perspective one.
//
// So every case here is run TWICE — once on the perspective orbit camera and
// once on the orthographic plan camera — and a case only passes if both agree
// with the arithmetic to within a millimetre. A regression that hides in one
// projection cannot hide from this.
//
// It drives the REAL EditorCameras (with a stub for the two DOM objects it
// listens to) and the REAL Inference, so it tests shipping code, not a copy.

import { Vector2, Vector3 } from 'three';

const noop = () => {};
globalThis.window = globalThis.window || { addEventListener: noop, removeEventListener: noop };
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const { EditorCameras } = await import('./camera.js');
const { Inference } = await import('./snapping.js');

const W = 1280, H = 800;
const canvas = {
  addEventListener: noop, removeEventListener: noop,
  setPointerCapture: noop, releasePointerCapture: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
};

function cameras(mode) {
  const c = new EditorCameras(canvas);
  c.resize(W, H);
  if (mode === 'plan') {
    c.setView('plan', { instant: true });
    c.planCentre.set(-4, -2);
    c.planHeight = 24;
  } else {
    c.setView('orbit', { instant: true });
    c.target.set(-4, 1.2, -2);
    c.yaw = -2.35; c.pitch = 0.62; c.dist = 22;
  }
  c._apply();
  return c;
}

/** A model with one skewed wall, for Parallel / Perpendicular / Intersection. */
function model() {
  return {
    version: 1,
    levels: [{ id: 'L0', elevation: 0, height: 2.7 }],
    nodes: {
      n1: { id: 'n1', x: -8, z: 6 }, n2: { id: 'n2', x: -4, z: 3 },
      n3: { id: 'n3', x: -10, z: -6 }, n4: { id: 'n4', x: 0, z: -6 },
    },
    walls: {
      w1: { id: 'w1', a: 'n1', b: 'n2', levelId: 'L0', thickness: 0.24, openings: [] },
      w2: { id: 'w2', a: 'n3', b: 'n4', levelId: 'L0', thickness: 0.24, openings: [] },
    },
    openings: {}, furniture: {}, slabs: {}, texts: {},
  };
}

/** Ask the engine what it infers with the cursor exactly over `world`. */
function ask(cam, world, extra = {}) {
  const pixel = cam.toScreen(world, new Vector2());
  const ndc = cam.ndcFromPixel(pixel.x, pixel.y, new Vector2());
  const inf = extra.inference || new Inference();
  return inf.infer({
    ndc, pixel, cameras: cam, model: extra.model || model(), levelId: 'L0',
    from: extra.from ?? null, refDir: extra.refDir ?? null, lockAxis: extra.lockAxis ?? null,
    height: 0, fine: false, wallHit: null, faceHit: extra.faceHit ?? null,
    ignoreIds: null, guides: extra.guides || [],
  });
}

let pass = 0, fail = 0;
const mm = (a, b) => a.distanceTo(b) * 1000;

function check(what, cond, detail) {
  if (cond) { pass++; console.log(`  ok    ${what}${detail ? `  ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${what}${detail ? `  ${detail}` : ''}`); }
}

/** Every case runs in both projections; a pass in one is not a pass. */
function bothViews(name, fn) {
  for (const mode of ['orbit', 'plan']) {
    console.log(`${name} — ${mode === 'orbit' ? 'perspective 3D' : 'orthographic plan'}`);
    fn(cameras(mode), mode);
  }
}

// 1. the axis inferences and the arrow-key lock ------------------------------
bothViews('axis inference + arrow lock', (cam) => {
  const from = new Vector3(-8, 0, -2);
  const want = new Vector3(-4, 0, -2);          // 4 m along +X (the red axis)

  const free = ask(cam, want, { from });
  check('cursor on the red axis names On Red Axis', free.name === 'On Red Axis', `got "${free.name}"`);
  check('and lands within 1 mm', mm(free.point, want) < 1, `${mm(free.point, want).toFixed(3)} mm off`);

  const locked = ask(cam, want, { from, lockAxis: 'x' });
  check('ArrowRight lock lands within 1 mm', mm(locked.point, want) < 1,
    `${mm(locked.point, want).toFixed(3)} mm off, point ${fmtv(locked.point)}`);
  const len = locked.point.distanceTo(from);
  check('locked wall length is 4.000 m', Math.abs(len - 4) < 0.001, `${len.toFixed(4)} m`);

  // green (world +Z) and blue (world up) must behave the same way
  const wantG = new Vector3(-8, 0, 2);
  const g = ask(cam, wantG, { from, lockAxis: 'y' });
  check('ArrowLeft lock (green) within 1 mm', mm(g.point, wantG) < 1, `${mm(g.point, wantG).toFixed(3)} mm off`);
  const wantB = new Vector3(-8, 3, -2);
  const b = ask(cam, wantB, { from, lockAxis: 'z' });
  // Straight down the blue axis in plan the line has no screen image at all,
  // and refusing is the honest answer there.
  if (cam.mode === 'plan') {
    // Looking straight down the blue axis it has no screen image; the lock must
    // still hold and collapse onto the anchor rather than silently letting go.
    check('blue lock holds and collapses to the anchor',
      b.locked === true && mm(b.point, from) < 1, `got "${b.name}" locked=${b.locked} ${fmtv(b.point)}`);
  }
  else check('ArrowUp lock (blue) within 1 mm', mm(b.point, wantB) < 1, `${mm(b.point, wantB).toFixed(3)} mm off`);
});

// 2. parallel and perpendicular ----------------------------------------------
bothViews('parallel / perpendicular to a skewed wall', (cam) => {
  const ref = new Vector3(-4 - -8, 0, 3 - 6).normalize();     // the w1 direction
  const from = new Vector3(-2, 0, 7);
  const wantPar = from.clone().addScaledVector(ref, 4);
  const par = ask(cam, wantPar, { from, refDir: ref });
  check('cursor parallel to the wall names Parallel', par.name === 'Parallel', `got "${par.name}"`);
  check('parallel point within 1 mm', mm(par.point, wantPar) < 1, `${mm(par.point, wantPar).toFixed(3)} mm off`);

  const perp = new Vector3(-ref.z, 0, ref.x);
  const wantPerp = from.clone().addScaledVector(perp, 3);
  const pq = ask(cam, wantPerp, { from, refDir: ref });
  check('cursor perpendicular names Perpendicular', pq.name === 'Perpendicular', `got "${pq.name}"`);
  check('perpendicular point within 1 mm', mm(pq.point, wantPerp) < 1, `${mm(pq.point, wantPerp).toFixed(3)} mm off`);
});

// 3. on edge, endpoint, midpoint ---------------------------------------------
bothViews('point and edge inferences', (cam) => {
  const end = new Vector3(-4, 0, 3);
  const e = ask(cam, end);
  check('wall end names Endpoint', e.name === 'Endpoint', `got "${e.name}"`);
  check('endpoint exact', mm(e.point, end) < 1, `${mm(e.point, end).toFixed(3)} mm off`);

  const mid = new Vector3(-6, 0, 4.5);
  const m = ask(cam, mid);
  check('wall middle names Midpoint', m.name === 'Midpoint', `got "${m.name}"`);
  check('midpoint exact', mm(m.point, mid) < 1, `${mm(m.point, mid).toFixed(3)} mm off`);

  const on = new Vector3(-7, 0, 5.25);          // a quarter along w1
  const o = ask(cam, on);
  check('a point along the wall names On Edge', o.name === 'On Edge', `got "${o.name}"`);
  check('on-edge point within 1 mm', mm(o.point, on) < 1, `${mm(o.point, on).toFixed(3)} mm off`);
});

// 4. intersection -------------------------------------------------------------
bothViews('virtual intersection of two lines', (cam) => {
  // w1 runs (-8,6)->(-4,3); the guide runs due east at z = 4.5. They cross at
  // x = -6, z = 4.5 — a point where nothing is built.
  const guides = [{ a: new Vector3(-12, 0, 4.5), b: new Vector3(2, 0, 4.5) }];
  const want = new Vector3(-6, 0, 4.5);
  const s = ask(cam, want, { guides });
  check('crossing names Intersection', s.name === 'Intersection', `got "${s.name}"`);
  check('intersection within 1 mm', mm(s.point, want) < 1, `${mm(s.point, want).toFixed(3)} mm off`);
});

// 5. On Face vs the silent grid ----------------------------------------------
bothViews('On Face names itself, the bare grid stays silent', (cam) => {
  const p = new Vector3(6, 0, 1.5);
  const bare = ask(cam, p);
  check('nothing under the cursor: silent', bare.free === true && bare.name === 'On Grid', `got "${bare.name}" free=${bare.free}`);
  const onFace = ask(cam, p, { faceHit: { point: p.clone(), entityId: 'slab1' } });
  check('a face under the cursor: named On Face', onFace.name === 'On Face' && !onFace.free, `got "${onFace.name}" free=${onFace.free}`);
});

// 6. From Point ---------------------------------------------------------------
bothViews('From Point off a primed point', (cam) => {
  const inf = new Inference();
  const primed = new Vector3(-4, 0, 3);
  inf.tickDwell(new Vector2(100, 100), 0.5, primed);       // rest on the jamb
  inf.tickDwell(new Vector2(100, 100), 0.5, primed);
  const want = new Vector3(-4, 0, -1);                     // straight off it, 4 m
  const s = ask(cam, want, { inference: inf, model: { ...model(), walls: {}, nodes: {} } });
  check('inference off the primed point names From Point', s.name === 'From Point', `got "${s.name}"`);
  check('from-point within 1 mm', mm(s.point, want) < 1, `${mm(s.point, want).toFixed(3)} mm off`);
});

function fmtv(v) { return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`; }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
