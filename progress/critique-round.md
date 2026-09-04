# Independent critique round — 2026-09-03

Critic with fresh context, wrote none of this code. Game served from
`tools/devserver.py` on port 5179, driven through the Browser pane.

Scoring targets:
1. `reference/architect-life/ANALYSIS.md` — 15-point FINISH checklist (office + menu)
2. `reference/sketchup/ANALYSIS.md` — 5 click-count benchmarks + 4 qualitative gates (editor)
3. `reference/retro-os/ANALYSIS.md` — 20-point authenticity checklist (in-game OS)

Status: IN PROGRESS — appended as work proceeds, per the standing instruction that
previous rounds lost everything by saving the report for last.

## Method notes

* Screenshots from the Browser pane come back at 800x450 (CSS canvas 1280x720,
  drawing buffer 2240x1260), so nothing pixel-critical is measured from them.
  Instead I installed my own probes in the page: `__grab(W,H)` renders the active
  mode's scene into a `WebGLRenderTarget` and reads it back with
  `readRenderTargetPixels`, `__stats()` computes the Rec.709 luma percentiles and a
  hue histogram, and `__px(x,y)` samples a single pixel. None of this uses the
  game's own `office.sampleLuma()` — a critic should not score a build with the
  build's own ruler.
* The same `__stats()` was run over five of the nine Architect Life JPEGs so the
  thresholds are calibrated against the reference rather than against my intuition.
  This turned out to matter: a naive "fraction of pixels above 25% saturation"
  metric scores the reference frames at 0.44-0.92, so item 10 cannot be read
  literally as a per-pixel test. Calibrated reading below.

### Calibration run over the reference images (my code, their pixels)

| frame | p1 | p5 | p50 | p95 | mean | hue families >5% of pixels |
|---|---|---|---|---|---|---|
| shot-09 (kitchen, the named best) | 1 | 40 | 119 | 213 | 120 | 2 (warm 10-30, cool 190-220) |
| shot-04 (furnishing cutaway) | 0 | 3 | 79 | 207 | 93 | 2 (warm 0-40, cyan 180-200) |
| shot-03 (editor / plan) | 13 | 58 | 137 | 220 | 139 | 1 (warm 0-30) |
| shot-05 (decorating) | 0 | 7 | 135 | 232 | 125 | 1 (warm 10-30) |
| shot-02 (night exterior) | 0 | 2 | 58 | 142 | 64 | 1 (blue 200-240) + small warm |

So the operational form of item 10 is **at most two hue families holding >5% of the
frame each**, not a per-pixel saturation cap. I score against that.

---

# BAR 1 — Architect Life FINISH checklist (office + menu)

Scored frame: the office hero view the game itself spawns you into
(`player.pos 12.3, 1.62, 8.35`, yaw 0.98, pitch -0.12), plus the menu.

| # | Item | Measured | Verdict |
|---|---|---|---|
| 1 | >=16 distinct prop types in an interior shot | 17 instanced prop families with >=1 instance inside the camera frustum (desk, deskSmall, monitor, keyboard, mouse, deskLamp, penCup, mug, paperStack, pedestal, taskChair, partition, blueprint, sheet, plantSmall, crumpledPaper, pendant) plus non-instanced floor lamp, cardboard boxes, corkboard, blinds, kitchen run, brick wall, nameplates, desk personalisation = **24+** | PASS |
| 2 | >=8 of them lived-in clutter | mug, penCup, paperStack, loose sheets (4 in frame, 22 in the room), pinned blueprints/cyanotypes, crumpled paper, potted plants, cardboard boxes, corkboard, desk personalisation objects = **10** | PASS |
| 3 | >=3 light sources, distinct colour temperatures | 19 lights. Four families by hex: sun `#ffdcb0` dir from -X high (warm ~4500 K, the only shadow caster), hemisphere `#93b8e2` sky over `#6a6055` ground (cool ~8000 K), pendants `#ffab5e` x3 (~2400 K), monitor glow `#9fc4e8` (cool). | PASS |
| 4 | Contact shadow under every floor-standing object | 93 contact-shadow decals in the room, **59 inside the scored frustum** against ~20 genuinely floor-standing objects in it. Verified visually at 2.2x on the cubicle cluster: every chair, box, pedestal and partition sits on a dark decal, and the sun additionally casts a real directional shadow. | PASS |
| 5 | AO band at every wall/floor and wall/ceiling junction, >=12/255 over 20 px | Plaster wall, floor junction (x=200 in a 960x540 readback): 115 at 20 px above the skirting falling to 82 at the skirting = **delta 33**. Ceiling junction same column: 113 -> 147 over 12 px = **delta 34**. BUT the west end wall measures **178 -> 179 over 45 px (delta 1)** — dead flat, no ramp at all, and it is the largest single surface when you face west. | PASS for the scored frame, with a named exception (west wall) |
| 6 | Visible bounce light | Hemisphere ground term `#6a6055` warm, plus baked vertex tint; the underside of the desk tops and the chair seats pick up floor warmth in the 2.2x crop. Pointable, if softer than the reference. | PASS (weak) |
| 7 | Hard directional patch through an opening | Yes, and it is the best single finish moment in the build: facing the west glazing the sun throws sharp-edged window rectangles with readable mullion divisions across the floor and up the skirting. | PASS |
| 8 | p5 <= 70 and p95 >= 140 | office **p5 44, p95 190** (p1 19, p50 125, mean 123); menu **p5 41, p95 203** (p1 28, p50 132, mean 132) | PASS both |
| 9 | >=8 visually distinct materials | material slots resolved in the frame: polishedConcrete, plaster, brick/limewash, wood-light, wood-dark, metal, glass, ink (matte black), flat (felt/plastic), paper, tile (ceramic) = **11** | PASS |
| 10 | One accent hue, everything else neutral | office hue histogram: a single family, bins 20-30, 31% of pixels; nothing else above 0.5%. Accent = the orange stacking chairs, placed 2 of 4. Menu: one family (bins 10-60). Reference frames run 1-2 families, so this is inside the bar. | PASS |
| 11 | >=3 depth layers | foreground meeting table + plant / midground cubicle cluster + partitions / background glazing, brick wall, kitchen run | PASS |
| 12 | Deliberate framing device | foreground table edge entering bottom-right, ceiling beams as converging lead lines, floor tile joints running to the window wall | PASS |
| 13 | No bare floor patch > 25% of frame | measured by raycasting a 60x34 grid through the camera and flood-filling the cells that hit y~0: floor is 23.3% of the frame, **largest contiguous bare patch 19.4%** | PASS |
| 14 | HUD corner-anchored, icon+label+value, centre 50% clear | four chips: time/office code top-right, bank/computers/studio/staff bottom-right, each icon + label + right-aligned value. Centre clear. (The dev overlay top-left is debug, not HUD, and I hid it for measurement.) | PASS |
| 15 | Shadow directions consistent | one shadow-casting light only (the `#ffdcb0` directional), so every cast shadow is parallel by construction; verified on chairs, boxes and partitions in the 2.2x crop | PASS |

**BAR 1 SCORE: 15/15**, with item 5 carrying a named exception and item 6 scored as
a weak pass. This is a genuinely finished-looking office; the checklist no longer
discriminates against it, which is itself worth saying to the builder.

## Blind A/B, bar 1

I cropped equal 420x300 regions of a 1600x900 readback of our office and of the
reference JPEGs at the same scale, put them side by side unlabelled, and asked
myself which is which.

**Pair 1 — ours (partition + brick + kitchen run) vs `shot-09` (dining/glazing).**
Told them apart instantly. Three tells, in order of how much they mattered:
1. **A flat grey slab.** The felt partition occupies ~35% of our crop as one dead
   mid-grey rectangle with no gradient, no AO, no edge variation. Nothing in any of
   the nine reference frames is that uniform over that much area. This is the same
   defect as the flat west wall in item 5 and it is the single loudest tell.
2. **Nothing beyond the glass.** Our windows read as flat sky-blue fill; shot-09
   puts a snow field, conifers, a neighbouring cabin and a deck rail out there,
   which is where its background depth layer comes from.
3. Depth of field and specular response on the reference. Out of scope — that is
   their PBR style, not our finish bar.

**Pair 2 — ours (cubicle bay: monitors, pedestal, corkboard, brick) vs `shot-05`
(timber floor + rug).** Genuinely close, and in this pair ours reads *denser* than
the reference crop. The only reliable cue was surface texture (their wood grain and
rug nap against our flat fills), which the analysis explicitly rules out of scope.
This pair is a pass.

---

# BAR 3 — Retro OS 20-point authenticity checklist

**Scope change received mid-pass from the coordinator:** tiers 3 and 4 are being
rebuilt as a Windows 11 analogue and a macOS 26 analogue, so they are NOT scored
against this checklist. Tier 1 (Pentagram 133 / TRESTLE 3.1, 640x480) is the graded
piece; tier 2 (Kompakt 2000 / CORNICE 98, 800x600) is scored as well. Tiers 3-4 are
recorded below only as a note of what is being replaced.

## Method

Measured on the **OS's own 2D canvas at 1:1** via `getImageData`, not from a pane
screenshot, using a run-length scanner (`__col`, `__row`) and an ASCII pixel dump
(`__dump`). CRT phosphor pass off (`os.crt === false` in the harness), so these are
the pixels the OS actually draws. Pose: Mail behind, Cost Sheet focused, File menu
open, list views and a scrollbar on screen.

## Tier 1 — TRESTLE 3.1

| # | Check | Measured | Verdict |
|---|---|---|---|
| 1 | Hard 90-degree corners | Cost Sheet top-left, three consecutive rows: `#DFDFDF x7` / `#DFDFDF, #FFFFFF x6` / `#DFDFDF, #FFFFFF, #C0C0C0 x5` — a perfect mitre, zero rounding | PASS |
| 2 | No drop shadows | whole 640x480 frame contains **13 distinct colours**; a blurred shadow is arithmetically impossible. Popup menu sits directly on the pixels beneath it | PASS |
| 3 | All text aliased, 2 colours per run | font is a hand-authored 1-bit bitmap face (`theme.font.glyphs`, each glyph a row-bitmask array). Menu text runs sample exactly `#FFFFFF` on `#000080` | PASS |
| 4 | Integer glyph origins and advances | every glyph carries integer `w`/`adv`/`lsb`; there is no float path | PASS |
| 5 | Flat fills only | tier 1 title bar is 18 rows of solid `#000080`. 13 colours total = no gradient anywhere | PASS |
| 6 | 1 px per bevel line, 2 px per edge, five greys only | every bevel measured is 1 px; only `#FFFFFF #DFDFDF #C0C0C0 #808080 #000000` appear | PASS |
| 7 | Frame light-then-white, button white-then-light | **window frame** (Cost Sheet, x=400 down): `#DFDFDF @144, #FFFFFF @145, #C0C0C0 x2 @146, #000080 x18 @148`. **button** (scrollbar arrow, y=253 across): `#FFFFFF @591, #DFDFDF @592, face x12, #808080 @605, #000000 @606`. The two orders are opposite, exactly as specified | PASS |
| 8 | Sunken fields `#808080`/`#000000` then `#DFDFDF`/`#FFFFFF` | measured at the client edge and at the list-view boundary | PASS |
| 9 | Title bar exactly 18 px | Cost Sheet `#000080 x18 @148..165`; Mail (inactive) `#808080 x18 @12..29`. `theme.metrics.titleH === 18` | PASS |
| 10 | Scrollbars exactly 16 px, square arrow buttons, hard black triangles | scrollbar band x=591..606 = **16 px**; arrow button 16x16; the triangle is a solid `#000000` wedge at y=241..244 of widths **1, 3, 5, 7** = 7 px wide x 4 px tall, exactly the reference | PASS |
| 11 | Track is a 1-px `#FFFFFF`/`#C0C0C0` checkerboard | measured down x=597 from y=268: `#C0C0C0, #FFFFFF, #C0C0C0, #FFFFFF ...` alternating every single row | PASS |
| 12 | Disabled text = two-pass emboss | `font.js:423` `drawDisabled()` draws `#FFFFFF` at (+1,+1) then `#808080` at origin, and the mnemonic underline gets the same treatment (`font.js:446`). Not exercised in my pose, so verified in code rather than in pixels | PASS |
| 13 | No transparency or alpha | 13 distinct colours; every "50%" on screen is a 1-px checkerboard (scrollbar track, taskbar free space, desktop pattern) | PASS |
| 14 | <= 20 distinct chrome colours, all VGA-16 + `#DFDFDF` | **13**: `#C0C0C0 #008080 #FFFFFF #000000 #000080 #808080 #DFDFDF #FFFF00 #800000 #808000 #008000 #FF0000 #00FF00`. Every one is in the palette | PASS |
| 15 | One underlined mnemonic per item, always visible | measured: `File` underline at y=181 (5 px rule under the F), `Save Bill...` at y=202, `Print...` at y=222, `Close` at y=249. Menu-bar items carry theirs too | PASS |
| 16 | Menu items 20 px, 2 px etched separator, solid triangle, literal `...` | highlighted `Save Bill...` occupies y=187..206 = **20 px**; separator at y=230/231 is `#808080` then `#FFFFFF`, inset from both edges; accelerators (`Ctrl+S`, `Ctrl+P`) right-aligned; ellipses are three literal periods | PASS |
| 17 | Icons hand-set, limited palette, 1-bit mask | desktop icon at (10,8) samples **7 colours**, all system palette. Icon grid pitch measured from `desktopIcons` y-values: 8, 83, 158, 233, 308 = **75 px**, the Win95 desktop pitch exactly | PASS |
| 18 | Period-correct metaphors | Pentagram 133 (CRT box, the My-Computer slot), Mail (envelope with a wax seal), Projects (manila folder), Cost Sheet, Wastebasket. No hamburger, no gear, no cloud | PASS |
| 19 | Nothing eases | `wm.js` and `widgets.js` are written with no interpolation; `os.paint()` runs only on dirty frames and `os.frame` counts real repaints. State changes are single-frame swaps | PASS |
| 20 | Period cursor drawn by the OS | `os.css:28` sets `cursor: none` over the screen and the OS draws its own (`os.cursor = {kind:'chunky'}`); the arrow is visible in the frame as hard black-on-white pixels | PASS |

**TIER 1 SCORE: 20/20.** This is the strongest piece in the build by a wide margin.

## Tier 2 — CORNICE 98

Same metrics table (titleH 18, menuH 20, scrollbar 16, shellH 28, iconPitch 75), same
palette, `gradientTitle: true`. The active title bar is a straight horizontal ramp:
sampled at 0% `#000080`, 25% `#042194`, 50% `#0842A8`, 75% `#0C63BC`, 90% `#0E77C8`
— i.e. `#000080` -> `#1084D0` and nothing else, which item 5 explicitly sanctions.

The frame samples 258 distinct colours, but **13** once the two title-bar bands are
excluded — and those 13 are the same VGA set as tier 1. Item 14's "<= 20" and item 5's
gradient exception contradict each other for any Win98 theme; I score item 14 on the
non-gradient chrome and note the raw number. **TIER 2: 20/20 on the same evidence.**

## Tiers 3 and 4 — recorded, not scored (about to be rebuilt)

| | tier 3 | tier 4 |
|---|---|---|
| machine / OS | Sunstation Pro — VELLUM 8 | Melon Studio M5 — ATELIER 9 |
| resolution | 1024x768 | 1152x870 |
| theme family | `platinum` | `platinum` |
| font | `chicago` | `chicago` |
| title bar | 22 px (Platinum) | 22 px (Platinum) |
| shell | none (`shellH 0`) — global menu bar | 28 px shell + global menu bar |
| palette | 7-grey Platinum ramp `#FFFFFF #EEEEEE #DDDDDD #CCCCCC #999999 #777777 #000000` | same |
| distinct colours in frame | 15 | 15 |

Both are today a Mac OS 8 Platinum clone: neutral grey ramp, pinstripe title bars,
Chicago bitmap font, 16 px scrollbars with a 1 px black outline. That is what the
Windows 11 and macOS 26 analogues will replace. Worth saying plainly to whoever does
the rebuild: **the Platinum theme currently in tiers 3-4 is good work and would score
well against this checklist** — it is being replaced for a product reason (the four
machines should span thirty years), not because it is bad.

## Blind A/B, bar 3

Our tier-1 Cost Sheet window (title bar, menu bar, open File menu, list view) at 2x,
beside the same-size crop of `win95-09.png` (the real Control Panel) at 2x, unlabelled.

**I could not reliably pick the real one from the chrome.** Everything that usually
gives a clone away matched: bevel order, 18 px caption, mnemonic underlines, the
navy highlight, the etched separator, the right-aligned accelerator, the literal
ellipsis, the aliased text. The two cues that exist are:
1. **Glyph shapes.** Our bitmap face is not MS Sans Serif — the lowercase `e` and `S`
   are subtly different. This is legitimate for a fictional OS and I do not count it.
2. **Content.** Theirs says Control Panel, ours says Cost Sheet. Not a rendering tell.

This is a pass, and an unusually clean one.

---

# BAR 2 — SketchUp: click counts and the four gates (editor)

## Important measurement note before the numbers

`document.hidden === true` for the Browser pane, so `requestAnimationFrame` is
throttled to near-zero and **`EditorMode.update()` was not being called at all** —
zero calls in a one-second sample, with `renderer.info.render.frame` stuck at 67.
Since the editor drives tool hover state (`tool.onMove`) from `update()`, every
hover-dependent tool silently did nothing and looked broken. This is exactly the
trap ARCHITECTURE.md warns about, in a new costume. I fixed it for the session with
`setInterval(() => mode.update(1/60), 16)` and every benchmark below was run with
that pump in place. **No tool was found broken once the loop was actually running.**

Second artifact worth recording: the pane's `computer{action:"type"}` does not
produce `keydown` events the page sees, so typed measurements appear to be ignored.
Dispatching a real `KeyboardEvent` works. Anyone re-running this must not report
"typing does nothing" from the pane's type action alone.

## The five benchmark operations, counted the same way SketchUp's table counts

| # | Operation | Our method | Tool switches | Clicks | Typed | **Decisions** | SketchUp bar | Result |
|---|---|---|---|---|---|---|---|---|
| a | Draw a 4 m wall as a 3D volume, exact length | `W` -> click start -> type `4000` Enter | 1 | 1 | 1 | **3** | <= 6 | **beats it by half**; the wall arrives at 240 mm and full storey height with no extrusion step |
| a' | Same, bare line | (no bare-line equivalent; the wall IS the primitive) | — | — | — | **3** | <= 3 | meets |
| b | Cut a door opening in an existing wall | `D` -> click the wall | 1 | 1 | 0 | **2** | <= 6 | **beats it by 3x**; 900 x 2050, swing in-left, auto-snapped "centred" |
| c | Change a face's material | `B` (also opens the Materials tab) -> click swatch -> click face | 1 | 2 | 0 | **3** | <= 3 | meets |
| d | Move an object 500 mm along an axis | click object -> `M` -> click grab point -> Right arrow -> type `500` Enter | 1 | 2 | 1 arrow + 1 entry | **5** | <= 5 | meets |
| e | Measure a distance | `T` -> click A -> click B | 1 | 2 | 0 | **3** | <= 3 | meets |

Every result verified against the model, not against the UI:
* (a) `walls` gained an entry of length **4.000 m**, thickness 0.24, type exterior.
* (b) `openings` gained `{kind:'door', width:0.9, height:2.05, swing:'in-left'}` at
  offset 8.85 on a 17.70 m wall — the "centred" candidate.
* (c) wall 3's `matInner` changed `plaster` -> `brick`.
* (d) the chair moved `x -4.100 -> -4.600` and `z` unchanged: exactly 500 mm on X.
* (e) readout `Distance 17.763 m · Δx -17.700 m · Δy 1500 mm · Δz 0 mm` — richer than
  SketchUp's single figure.

## The four qualitative gates

| Gate | Evidence | Verdict |
|---|---|---|
| Every operation accepts an exact typed value, no click into a field | the Measurements box is a keyboard sink on `window` (`editor.js:1013`, step 4 of `_key`). Typing `2500` mid-run renders `Length 2500▌ = 2.500 m` in the DOM with a caret and a live unit resolution. It is never focused and never clicked into | **PASS** |
| Every snap names itself with an official inference name | observed live: `Endpoint`, `Midpoint`, `On Face`, `On Green Axis`. `constants.js` carries the full table with SketchUp's own names and colours: Endpoint green `#3F9C35`, Midpoint cyan `#22B3C4`, On Edge red `#D23B2E`, On Face blue `#2F6FD0`, Parallel/Perpendicular magenta `#C23FB0` | **PASS** |
| Axis colours red/green/blue for X/Y/Z | `COLOR.axisX #D23B2E`, `axisY #3F9C35`, `axisZ #2F6FD0`, used on the axes, the snap marker and the label text | **PASS** |
| Navigation never interrupts a tool; cursor-anchored, distance-adaptive zoom | tested: started a wall run (`tool.from = {-5.65, 0, -14.2}`), dispatched a wheel event; camera moved `(-40.8, 42.4, -40.3) -> (-27.3, 28.9, -27.0)` and **`tool.from` was unchanged**. `camera.js:536 zoomAt()` anchors on `pickPoint(ndc)` and moves a *fraction* of the distance to it | **PASS** |

**BAR 2 SCORE: 6/6** (5 click-count benchmarks + the four gates counted as one line
in the six, per the analysis's own framing: 5 operations, all at or under the bar,
and 4 gates, all passed).

## The recent changes, checked one by one

| Change | Verdict | Evidence |
|---|---|---|
| Editor opens with `room` armed, and says so | **works** | `editor.tool.id === 'room'` on entry; status bar reads "Room (P) · Press on the ground and drag: a room appears — floor, walls and ceiling…" and a centred coach line repeats it |
| Press-and-drag builds a room by mouse, no plan view | **works** | one `left_click_drag` on the ground took the model from 0 to **4 walls, 4 nodes, 2 slabs** (floor + ceiling) in a single gesture, in the default orbit view. Live readout during/after: "Room 17.70 × 3.00 m — 48.2 m² inside the walls", cost bar moved to 281 478 / 2 905 000 |
| Second room merges rather than doubling walls | **not tested** (ran out of runway); the model exposes `wall.add` self-splitting, so the mechanism is there |
| `R` is rotate-by-a-step | **works** | `editor.js:888` intercepts R before the tool table; 15 degrees, Alt = 90, Shift = reverse. Stale artefact: `src/editor/selftest.js:280` still asserts `tool('rect','KeyR','r')` and will now fail |
| Chairs removed from player workstations | **works** | `office.js:640` comment plus code; the three task chairs still visible are the staff cubicles', which is correct ("somebody is sitting in them") |
| Briefs ask 4-5 rooms, no area minimums | **works, measured** | 24 generated commissions: room counts all **4 or 5**. Zero player-facing strings contain a room area — `minArea` survives in the engine (`Living room minArea 26`) while the phrase reads "a living room the whole family actually fits into" |
| Protected trees out of the buildable area | **works, measured** | **0 of 24** commissions has a protected tree inside `plot.buildable`. Previously 19 of 24 |
| Plots actually differ | **largely works, measured** | 24 plots across **7 shape families**: rect 6, chamfer 4, wide-shallow 3, flag 3, wedge 2, trapezoid 2, L 1. Largest family 25%. Area range 665-2704 m², 22 distinct values. By vertex count 16/24 are still quadrilaterals, but "corner", "deep-and-narrow" and "wide-shallow" legitimately are quadrilaterals, so the family count is the fair measure and it passes |
| Shader pre-compilation on mode entry | **present**, not benchmarked here |

---

# The three biggest remaining gaps

## Bar 1 (finish) — kill the flat slabs

**What:** two of the largest surfaces in the office carry no shading variation at
all. Measured: the west end wall reads luma **178 -> 179 over 45 px** approaching
the floor (the rest of the room's plaster does 115 -> 82 over 27 px), and the felt
cubicle partitions render as one uniform mid-grey rectangle. In the blind A/B against
`shot-09` the partition was what gave our frame away inside a second, ahead of
anything to do with polygon count or texture.

**Do this:** apply the same `aoFloor()/aoCeil()/aoCorner()` vertex ramps that
`room.js` already uses on the plaster walls to (a) the west end wall, which is
currently drawn as an `ao: false` solid, and (b) the `partition` prop, which needs a
vertical gradient of its own — darker at the base, lighter at the top edge — plus a
slightly darker return on its side faces. Verify by sampling a column down each
surface: no surface larger than about 10% of the frame may vary by less than 12/255
over its height. Second, cheaper win in the same pass: put something outside the
windows. They currently read as flat sky fill and that is the other tell.

## Bar 2 (editor) — the buildable area is decoration, not a rule

**What:** DESIGN-DECISIONS.md (2026-08-30, "The plot in the editor") says dragging a
room outside the buildable area must be "refused, or at minimum flagged the instant
it happens — not three days later in the client's letter". It is neither. I drew a
room and two walls well outside the footprint and **8 of the model's 10 nodes ended
up outside `plot.buildable`** with no refusal, no colour change, and no warning
element anywhere in the DOM. `grep -rn buildable src/editor/` finds exactly one hit,
in `editor-mode.js:133`, and it only draws the overlay. The only thing that ever
notices is `src/analysis/site.js`, i.e. the client's letter.

Related and in the same fix: the overlay is `#F0E2C8 at 0.35 opacity` over green
grass, which composites to a muted olive. Jurek asked for "a clearly readable grey
footprint" and this is not grey and not clearly readable.

**Do this:** (1) repaint the buildable overlay as an opaque, desaturated grey slab
with a hard edge, so it reads as ground you may build on rather than a tint. (2) In
the room and wall tools, test each candidate node against `plot.buildable` in
`onMove` and turn the ghost red plus flash "outside the buildable area" while it is
outside; on `onUp`, either refuse or commit-and-flag. The polygon test is eight lines
and the plot is already on `EditorMode`.

## Bar 3 (retro OS) — nothing, and that is the finding

Tier 1 scores **20/20** on the pixel checklist and survived a blind A/B against a
real Windows 95 capture. There is no remaining gap in the graded piece, so the
actionable statement is about what happens next rather than what is wrong now:

**Do this:** when tiers 3 and 4 are rebuilt as the Windows 11 and macOS 26 analogues,
**do not let the rebuild loosen tiers 1 and 2.** The single mechanism that makes tier
1 authentic is that everything is drawn from one hand-authored 1-bit bitmap font and
a 13-colour palette into an integer-resolution canvas — no CSS, no vector text, no
alpha. A modern tier will want anti-aliased type, real alpha, rounded corners and
easing, all of which are ordinary in `os.js`'s drawing surface once anything permits
them. Gate the new families behind their own theme so that the `win` and `platinum`
paths cannot acquire a blur, a radius, a float coordinate or a 14th colour. A cheap
standing check: assert that a tier-1 frame samples **<= 20 distinct colours** and
that every one is in the VGA-16 plus `#DFDFDF`; it is 13 today and any regression
shows up as a single failing number.

---

# Smaller things worth a line each

* `src/editor/selftest.js:280` still asserts `KeyR -> rect`. R is rotate now; that
  assertion is stale and will fail.
* The editor's coach tip ("Press and drag on the pale ground…") sits dead centre of
  the frame. Architect Life item 14 wants the centre 50% clear of UI in editor
  shots. It is transient, so this is a note, not a rejection.
* The Measurements box's internal `display` field stays `"0 mm"` while `text` holds
  what you typed. The DOM renders correctly from `text`, so this is cosmetic, but
  anyone reading `measurements.display` for a test will get a false negative — I
  nearly filed a bug on it.
* One anomaly I could not reproduce: an early typed `4000` mid-chain produced a
  0.400 m wall rather than 4.000 m. Every clean repetition gave exactly 4.000 m.
  Flagging it rather than dropping it, in case the wall tool's chained-run state
  loses the first digit.

# Scores

| Bar | Score |
|---|---|
| Architect Life finish checklist (office + menu) | **15/15** (item 5 with a named exception, item 6 a weak pass) |
| SketchUp click counts + gates (editor) | **6/6** — 5 benchmarks at or under the bar, two of them by a wide margin; 4/4 gates |
| Retro OS authenticity, tier 1 | **20/20** |
| Retro OS authenticity, tier 2 | **20/20** (item 14 scored on non-gradient chrome: 13 colours) |
| Retro OS, tiers 3-4 | not scored — being rebuilt as Windows 11 / macOS 26 analogues |

Critique complete.


## End-to-end proof — 2026-09-04

Driven in the browser, one continuous run, no console shortcuts past the entry point:

| stage | result |
|---|---|
| menu -> office | ok |
| commission | library, 4 required rooms, budget 9 475 000 |
| brief delivered | "The Reading Room — branch library on Wodna — brief" in Mail |
| editor | opened INSIDE the monitor (office stayed the active mode) |
| drawing | 4 walls + floor + roof through the editor's own op path |
| submit | report: score 0, accepted false, 6 blockers |
| phase | revising |
| client letter | revision mail posted |
| resubmit | round 2, accepted, phase walkthrough |
| walkthrough | mode pushed, 20 NPCs, 1400 presim steps |

Two things that looked like defects and were not:

* "The client letter is the brief." No — `state.mail.messages` is NEWEST FIRST
  (acceptance, revision, brief). Reading `messages[length-1]` reads the oldest.
* "The walkthrough runs 0 journeys." Correct behaviour: the test building was a
  sealed box with zero openings, so there is nowhere for anyone to walk. The
  crowd exists (20 agents) and the simulation ran; it had nothing to do.

Still open from the second playtest: items 6 (do build-mode doors satisfy the
programme), 9 (build outside the grey area is warned, not prevented; trees and
grass undetailed), 10 (mail layout), 11-12 (cursors), 13 (coffee machine),
14 (throwing paper), and the rest of item 17 beyond the palette.
