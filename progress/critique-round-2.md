# Independent critique — round 2, 2026-09-05

Fresh-context critic. I wrote none of this code. Game served by `tools/devserver.py`
on port 5179, driven through the Browser pane; every number below is measured by my
own probe code, never by the build's own instrumentation and never off a pane
screenshot (the pane is hidden this session, so `computer{screenshot}` returns black —
ARCHITECTURE.md's warning, honoured). Frames that needed to be *looked* at were
rendered by the page, read back, and POSTed to `/__shot/`, so the images I judged are
the real framebuffer at native resolution.

Round 1 is `progress/critique-round.md`. I re-measured its load-bearing claims rather
than trusting them, and I say below where a round-1 pass no longer holds.

---

# BAR 3 — Retro OS, tier 1 only

Tiers 3-4 are being rebuilt as modern analogues and are out of scope, per
DESIGN-DECISIONS.md 2026-08-30. Tier 2 is not asked for this round.

## `OSDEV.retroGuard()` — the standing gate

Run on `src/os/dev.html`. The harness uses `requestAnimationFrame`, which the hidden
pane throttles to a stop, so I swapped rAF for a 4 ms `setTimeout` for the duration —
otherwise the guard never resolves and looks broken. **Anyone re-running it in the pane
must do the same or they will report a hang that is not there.**

```
{ tier: 1, size: "640x480", distinct: 9, maxDistinct: 20, offPalette: [], pass: true }
```

**PASS.** 9 distinct colours on the bare desktop, zero off-palette.

The bare desktop is a weak pose, so I re-ran the same histogram over a loaded one
(Mail behind, Cost Sheet focused, File menu open, list view, scrollbar):

| colour | share of the 640x480 frame |
|---|---|
| `#C0C0C0` | 35.39 % |
| `#008080` | 25.78 % |
| `#FFFFFF` | 18.20 % |
| `#000000` | 7.28 % |
| `#000080` | 5.81 % |
| `#808080` | 5.26 % |
| `#DFDFDF` | 2.12 % |
| `#FFFF00` | 0.10 % |
| `#800000` | 0.03 % |
| `#808000` | 0.02 % |
| `#008000` | 0.01 % |
| `#FF0000` | 0.0035 % |
| `#00FF00` | 0.0011 % |

**13 distinct, every one inside VGA-16 + `#DFDFDF` + `#FFFFE1`.** Frame saved as
`progress/shots/c2-os-t1.png`.

## The 20-point checklist, re-measured on that frame

Measured with my own run-length scanner over `getImageData` on the OS's own canvas at
1:1, CRT pass off (`os.crt === false`).

| # | Check | My measurement | Verdict |
|---|---|---|---|
| 1 | Hard 90-degree corners | Cost Sheet top-left (156,144), three rows: `#DFDFDF x10` / `#DFDFDF, #FFFFFF x9` / `#DFDFDF, #FFFFFF, #C0C0C0 x8`. A clean mitre, zero rounding | PASS |
| 2 | No drop shadows | 13 colours in the whole frame — a blur is arithmetically impossible. The File popup sits directly on the Cost Sheet's pixels | PASS |
| 3 | Text aliased, 2 colours per run | highlighted `Save Bill...` row samples exactly `#FFFFFF` on `#000080`, no third value anywhere in the run | PASS |
| 4 | Integer glyph origins | 1-bit bitmap face; every glyph carries integer `w`/`adv`/`lsb`, no float path exists | PASS |
| 5 | Flat fills only | title bar is 18 rows of solid `#000080`; 13 colours total forbids a gradient | PASS |
| 6 | 1 px bevels, five greys only | every bevel run measured is exactly 1 px; only `#FFFFFF #DFDFDF #C0C0C0 #808080 #000000` appear | PASS |
| 7 | Frame light-then-white; button white-then-light | **frame** (x=400 down from y=144): `#DFDFDF, #FFFFFF, #C0C0C0 x2, #000080 x18`. **button** (scrollbar arrow, x=591+7 down): `#FFFFFF, #DFDFDF, face x13, #808080, #000000`. Opposite orders, as specified | PASS |
| 8 | Sunken fields `#808080`/`#000000` then `#DFDFDF`/`#FFFFFF` | measured at the list-view and client-area boundaries | PASS |
| 9 | Title bar exactly 18 px | Cost Sheet `#000080 x18`; Mail (inactive) `#808080 x18`. `metrics.titleH === 18` | PASS |
| 10 | Scrollbar exactly 16 px, square arrows, hard black triangles | checkerboard columns run **x 591..606 = 16 px**; arrow button 16x16 with the raised bevel; solid `#000000` wedge inside it | PASS |
| 11 | Track is a 1 px `#FFFFFF`/`#C0C0C0` checkerboard | x=600 down from y=300: `#FFFFFF, #C0C0C0` alternating every single row for 18 rows; row 310 across: same alternation every column | PASS |
| 12 | Disabled text = two-pass emboss | `font.js drawDisabled()` draws `#FFFFFF` at (+1,+1) then `#808080` at origin, mnemonic rule included. Not in my pose; verified in code | PASS |
| 13 | No transparency | 13 colours; every 50 % effect on screen is a literal 1 px checkerboard (`widgets.js:219 checker()`) | PASS |
| 14 | <= 20 distinct chrome colours, all in palette | **13**, zero off-palette. `retroGuard` agrees at 9 on the bare desktop | PASS |
| 15 | One underlined mnemonic per item, always visible | `File` / `Edit` / `View` / `Message` / `Help` all carry a visible 1 px rule in the saved frame; menu items `&Save Bill...`, `&Print...`, `&Close` carry theirs | PASS |
| 16 | Menu items 20 px, 2 px etched separator, literal `...` | highlighted item = `#000080 x20` exactly; separator is `#808080` then `#FFFFFF`, inset; `Ctrl+S` / `Ctrl+P` right-aligned; ellipses are three literal periods | PASS |
| 17 | Icons hand-set, limited palette, 1-bit mask | desktop icon column pitch 75 px (the Win95 pitch); icons sample inside the 13-colour set | PASS |
| 18 | Period-correct metaphors | CRT box, envelope, manila folder, clipboard, wastebasket. No hamburger, gear, cloud or bell | PASS |
| 19 | Nothing eases | no interpolation in `wm.js` / `widgets.js`; `os.paint()` runs only on dirty frames | PASS |
| 20 | Period cursor drawn by the OS | `os.cursor = {kind:'chunky'}`, `os.css` sets `cursor:none` over the screen; the arrow is in the frame as hard black-on-white pixels | PASS |

**BAR 3 SCORE: 20/20.** `retroGuard()` passes.

## Blind A/B, bar 3

I put the Cost Sheet crop (title bar, menu bar, open File menu, list view, scrollbar)
beside the `win95-09.png` Control Panel crop at the same scale, unlabelled.

**I could not tell them apart from the chrome.** Bevel order, 18 px caption, navy
highlight, etched separator, right-aligned accelerator, aliased text, checkerboard
track — all identical. The only tells are the glyph shapes (our face is not MS Sans
Serif, which is legitimate for a fictional OS) and the window titles. Same verdict as
round 1, independently reached.

## The single biggest remaining gap — bar 3

There is no defect in tier 1 to report; the actionable item is the **regression risk**
from the tiers 3-4 rebuild, and it is concrete and unguarded today:

**Input:** run `OSDEV.retroGuard(2)`, `(3)`, `(4)`.
**What happens:** the guard's signature is `retroGuard(tier = 1, {maxDistinct = 20})`,
so it will happily be pointed at tier 3 or 4 and fail them — a modern analogue *must*
exceed 20 colours. There is nothing that pins the guard to tiers 1-2, and nothing in
the repo runs it automatically.
**What should happen instead:** make it a two-part standing check that CI-style code
can call blind — `retroGuard()` asserts tiers 1 and 2 only (tier 2 excluding the two
sanctioned title-bar gradient bands), and a second assertion forbids the `win` theme
family from ever acquiring a non-integer coordinate, an `rgba()`, a `shadowBlur`, a
`borderRadius` or a 21st colour, however the modern themes are implemented on the
shared drawing surface. Today the only thing protecting the best-scoring piece in the
build is that nobody has touched `surface.js` yet.

---

# BLOCKER FOUND BEFORE ANY BAR — the game does not start

This is not on any of the three checklists, and it outranks all of them.

**Input:** open `http://localhost:5179/` at HEAD (`4fa00c9`) and wait.
**What happens:** `MenuMode.update()` throws on the **very first frame**, every time:

```
TypeError: Cannot set properties of undefined (setting 'visible')
    at MenuMode._pick (src/menu/menu.js:1244:28)
    at MenuMode.update (src/menu/menu.js:1078:10)
    at Engine._tick (src/core/engine.js:373:22)
```

`Engine._tick` catches it, logs `[engine] frame failed, stopping the loop to avoid a
log flood`, calls `this.stop()` and rethrows. **The render loop is dead from frame 1.**
Nothing draws, nothing is clickable, there is no main menu.

**Cause, traced:** playtest item 3 removed the survey tags — `menu.js:132` now reads
`const SHOW_SURVEY_TAGS = false;` and `menu.js:219` guards `_buildTags(scene)` behind
it. `_buildTags` is the only place that assigns `this.tagRing` (`menu.js:969`). But
`_pick()` dereferences it **unguarded** at line 1244, in the `else` branch of
`if (ringOn >= 0)`, and with no tags `ringOn` is always `-1`, so line 1244 runs on
every frame. Lines 1227/1231/1289 are the same hazard behind `if (tag !== …)` guards;
1325 is correctly guarded with `if (this.tagRing)`.

Confirmed by construction, not by inference: on a clean load I read
`m.blocked === false`, `'tagRing' in m === false`, and a single manual `m.update(1/60)`
threw the stack above. I then set

```js
m.tagRing = { visible:false, material:{opacity:0},
              position:{addScaledVector(){return this;}}, quaternion:{copy(){}} };
```

and the menu rendered immediately — 73 draw calls, 158 610 triangles, zero further
errors. **One undefined property is the entire difference between a dead build and a
working one.** Every measurement below was taken with that one-line stub in place.

**What should happen instead:** guard the four unguarded dereferences the way line
1325 already does (`if (this.tagRing) …`), or, better, have `_pick()` return early
when `this.tagMesh` is absent — with `SHOW_SURVEY_TAGS = false` the whole tag half of
`_pick` is dead code and raycasting for it every frame is waste as well as a crash.

**Process finding, which matters more than the bug.** The commit that turned the tags
off is `8787cf0`, and the commit after it (`4fa00c9`) records an "end-to-end proof"
whose first row reads `menu -> office | ok`. That proof was driven by calling into the
game's internals, not by loading the page and looking at it. A proof that never lets
the engine run a frame of the menu cannot see a crash in the menu's first frame.
**Any future end-to-end claim has to start from a cold page load with the loop
running.**

---

# BAR 1 — Architect Life FINISH checklist

Scored frames, both 1600x900, written to disk from the real framebuffer:
`progress/shots/c2-office-hero.png` (the spawn view, player 12.30/1.62/8.35, yaw 0.98)
and `progress/shots/c2-menu.png`. A second office frame,
`progress/shots/c2-office-west.png` (player 12.00/4.80, yaw pi/2), was taken
specifically to re-test round 1's named exception.

| # | Item | My measurement | Verdict |
|---|---|---|---|
| 1 | >=16 distinct prop types in frame | frustum-tested every instance: **17 instanced prop families** with >=1 instance in frame (sheet 23, monitor 6, keyboard 6, partition 6, blueprint 6, pendant 5, desk 3, mouse 3, deskLamp 3, penCup 3, mug 3, paperStack 3, deskSmall 3, taskChair 3, plantSmall 3, pedestal 2, stackChair 2) plus non-instanced screen, nameplate, blinds, personalisation, floor lamp, boxes, corkboard, kitchen run, brick wall | PASS |
| 2 | >=8 of them lived-in clutter | sheets (23 in frame), mug, penCup, paperStack, pinned blueprints, plantSmall, personalisation objects, cardboard boxes, corkboard = **9** | PASS |
| 3 | >=3 light sources, distinct colour temperature | **19 lights**, five families by hex: sun `#ffdcb0` directional from (-32.6, 17.2, -9.8), intensity 6.4, **the only shadow caster**; hemisphere `#93b8e2` sky over `#6a6055` ground; pendants `#ffab5e` x5; desk/task lamps `#ffc98a` / `#ffc07a` / `#ffd0a0` / `#ffc78e`; monitor glow `#9fc4e8` x3 | PASS |
| 4 | Contact shadow under every floor-standing object | **61 contact-shadow decals inside the frustum** against ~20 genuinely floor-standing objects in it (3 task chairs, 2 stacking chairs, 2 pedestals, 3 desks, 3 small desks, 6 partitions, floor lamp, boxes) | PASS |
| 5 | AO band >=12/255 over 20 px at every wall/floor and wall/ceiling junction | **wall/floor**, column x=40 of the west frame: plaster holds 135-141 down the wall, then **141 -> 87 (delta 54)** into the junction. **wall/ceiling**, same column: **130 -> 79 (delta 51)** over 8 px. Round 1's named exception — "the west end wall measures 178 -> 179 over 45 px, dead flat" — **is fixed** | PASS, exception cleared |
| 6 | Visible bounce light | hemisphere ground term is warm `#6a6055` and the desk undersides and chair seats pick it up; pointable but softer than the reference | PASS (weak) |
| 7 | Hard directional patch through an opening | yes — sharp-edged window rectangles with readable mullion divisions across the floor in both frames; still the best finish moment in the build | PASS |
| 8 | p5 <= 70 and p95 >= 140 | office hero **p5 28, p95 208** (p1 5, p50 143, mean 133); west frame **p5 28, p95 212**; menu **p5 29, p95 212** | PASS all three |
| 9 | >=8 visually distinct materials | material slots resolved in frame: polishedConcrete, plaster, brick, wood-light, wood-dark, metal, glass, ink, flat, paper, tile = **11** | PASS |
| 10 | One accent hue, everything else neutral | hue histogram over pixels with sat > 0.25: **one warm family, bins 20-30 deg, 21.5 % of the frame; nothing else above 1 %.** For calibration the reference frames run 2 families (shot-09 warm 10-30 + cool 190-220; shot-04 warm 10-40 + cyan 180-200), so we are inside the bar and in fact tighter than it | PASS |
| 11 | >=3 depth layers | foreground partition + meeting table / midground cubicle cluster / background glazing, brick wall, kitchen run | PASS |
| 12 | Deliberate framing device | partition entering from the left edge; ceiling beams converging; floor tile joints running to the window wall | PASS |
| 13 | No bare floor patch > 25 % of frame | raycast a 40x23 grid through the camera against all 90 visible meshes, flood-filled the cells hitting y < 0.06: floor is **15.9 %** of the frame and the **largest contiguous bare patch is 13.0 %** | PASS |
| 14 | HUD corner-anchored, icon + label + value, centre 50 % clear | four chip groups: nick top-left, time / office code top-right, bank / computers / studio / staff bottom-right. Each is icon + label + right-aligned value. Centre clear. FPS/debug overlay is off by default (`main.js`, `this.debug.toggle(false)`), which is playtest item 3 satisfied | PASS |
| 15 | Cast shadow direction consistent | exactly one shadow-casting light in the scene, so every cast shadow is parallel by construction | PASS |

**BAR 1 SCORE: 15/15.** Round 1's two named weaknesses both held their fixes: the
west wall now has a real AO ramp, and there is now geometry beyond the glass.

### One measurement I ran and then discarded, because it was wrong

I built a "largest dead-flat region" detector (8x8 blocks, luma std < 1, merged when
neighbouring block means agree within 1.5) to re-test round 1's "flat slab" finding.
It reported our largest flat region at **9.93 % of the west frame** — the near
partition. That number is misleading and I am recording it so nobody quotes it: the
merge rule chains a slow gradient into one component. Profiled directly, the partition
runs **luma 47 at the top to 27 at the bottom over 340 px (delta 20/255)** vertically,
and is uniform horizontally (std 0.00 over 410 px) — which is what a felt panel should
do. The same detector scores the reference `shot-05` at **10.24 %** and `shot-09` at
**7.73 %**, i.e. worse than us. **Round 1's partition finding is fixed.**

## Blind A/B, bar 1

Equal-scale 420x300 crops, ours beside the reference, unlabelled.

**Pair 1 — our desk bay + brick wall vs `shot-09` scaled to match.** Told them apart
in under a second; ours is the left one. Two tells, and neither is about polygons:
1. **The pinned drawings on the brick wall are six identical blank off-white
   rectangles at identical pitch.** Same size, same value, same spacing, no content,
   and the corkboard beside them is an empty tan rectangle. Nothing in any of the nine
   reference frames is a repeated blank rectangle at even spacing; that pattern reads
   as an unfilled array, not as pinned work. Ironically the props are *dense* enough —
   it is the repetition that gives it away, not the count.
2. **Every brick in the brick wall is the same value.** The reference never repeats a
   surface unit without varying it.

**Pair 2 — our west glazing vs `shot-05` scaled to match.** Told them apart instantly
again; ours is the left one, and this is the important one:

**What is beyond our glass is a painted backdrop.** The neighbouring buildings are
plain pale grey-blue slabs with **no window openings, no roof detail, no value
variation between blocks**, and the one "tree" is a single dark-green trapezoid whose
silhouette is a straight sloping line that cuts across a window mullion. Measured: the
entire exterior world — everything visible through every window, spanning a 260 x 260 m
bounding box — is **one mesh of 1 872 triangles** plus a 728-triangle sky dome. That is
roughly thirty boxes standing in for a city, seen through a full-height window at eye
level, and the eye reads it as flat card.

Round 1's fix ("put something outside the windows") landed literally: something is
there. It is not yet a background layer, it is a cut-out.

## The single biggest remaining gap — bar 1

**Input:** stand anywhere along the west or south glazing (e.g. player x 12.0, z 4.8,
yaw pi/2) and look out.
**What happens:** flat untextured slabs, no fenestration, no value separation between
near and far blocks, a flat green wedge for a tree, and a single ground band. 1 872
triangles for the whole exterior.
**What should happen instead:** the background needs the two things the reference gets
for free from aerial perspective, and both are cheap in flat-shaded low poly:
(a) **give the blocks windows** — an emissive/dark instanced grid on each facade is one
extra draw call and immediately reads as a building rather than a slab; (b) **separate
the depth bands by value and hue** — near blocks at full saturation, mid blocks lifted
~15 % toward the sky colour, far blocks ~35 %, which is what makes `shot-08`'s hills
sit behind its village. And replace the trapezoid conifer with the same low-poly
conifer already used in the menu scene, which is a real cone stack and already in the
build. Verify by measuring: at least three distinct luma bands across the exterior
region seen through one window, each separated by >= 15/255, and no facade larger than
2 % of the frame that is a single flat value.
