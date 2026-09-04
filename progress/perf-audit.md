# Performance audit — the 30 fps baseline and the multi-second stall (2026-09-04)

Owner's report (DESIGN-DECISIONS.md, 2026-08-30): ~30 fps baseline, and every so often a
~5 s freeze where input does nothing. Two problems; measured separately below.

Already ruled out by DESIGN-DECISIONS.md (not re-checked here): `_auditScreens` (runs
twice on a 9 s delay), and shadow-map rebuilds (static, driven by `invalidateShadows()`).

Method: `preview_start {name:"game"}` on 5179, office entered via
`SB.engine.modeStack.at(-1)._act('single')`, frames instrumented from the console.
Per ARCHITECTURE.md, no fps is quoted from the overlay; render cost is the explicit
`gl.finish()` loop, stalls are wall-clock `performance.now()` deltas plus `longtask`.

## 1. Stall trace

(pending)

## 2. Baseline — ms-per-render

(pending)

## 3. Attribution experiments

(pending)

## 4. Fixes and re-measurement

(pending)

## 5. Not attributed

(pending)
