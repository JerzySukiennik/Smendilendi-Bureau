# reference/ — the bars

This folder is the reference library that critic agents hold our output against, **side by side**. Nothing in here is inspiration or mood board. Every folder contains real downloaded images and one `ANALYSIS.md` that ends in a checklist of things a critic can **count or measure in our screenshot**, not things a critic can have an opinion about.

The rule for every critic: **score against the checklist, quoting a number. Never against a feeling.** "It doesn't look as good as the reference" is not a finding. "The room shot contains 9 distinct prop types; the bar is 16" is a finding.

---

## `architect-life/` — the bar for FINISH

*Architect Life: A House Design Simulator* (SimFabric / Nacon, Steam app 1296400). Nine official 1920x1080 store screenshots plus a per-image analysis with machine-sampled hex palettes and luminance percentiles, ending in a **15-point measurable checklist**.

**What the bar is.** Architect Life is semi-realistic and we are clean low poly, so **none of this is a style reference and a critic must never reject our work for not looking like it.** What we copy is four things only: *density* (16-26 distinct prop types in a room shot, never an empty floor), *lighting care* (three-plus sources at distinct colour temperatures, a contact shadow under every single floor-standing object, visible ambient occlusion in every wall junction, visible bounce), *lived-in richness* (books, mugs, candles, rugs, cables, wall art — at least eight props with no structural function), and *framing* (a chosen camera height, three readable depth layers, a lead line or a foreground framing element, one saturated accent hue repeated two to four times against a desaturated field). All fifteen checklist items are achievable in flat-shaded low poly, and none of them mentions polygon count or texture realism.

**How a critic uses it.** Take one screenshot of our render. Open `shot-09.jpg` (the kitchen — the single best reference in the set) next to it. Walk the 15-point checklist and write a number beside each item: prop types counted, light sources named with their direction and warm/cool character, objects counted against contact shadows counted, luminance p5 and p95 computed on the actual frame, materials counted, accent hues counted, depth layers counted, largest bare floor patch as a percentage. Any item that fails comes back as a specific instruction ("add 7 more prop types", "p95 is 118, the bar is 140"), never as "make it richer".

---

## `sketchup/` — the bar for how the EDITOR FEELS

15 screenshots of SketchUp's UI (tool palette, inference ScreenTips, the Measurements box, Entity Info, Push/Pull, Section Plane, arrow-key axis lock) plus an analysis sourced entirely from help.sketchup.com and the official Quick Reference Card 2026, ending in a **click-count table**.

**What the bar is.** Two properties, and nothing about appearance. First, **how few actions it takes to do a thing**: SketchUp draws an exact 4 m wall in 6 decisions, cuts a door opening in 6, changes a face's material in 3, moves an object an exact 500 mm along an axis in 5, and measures a distance in 3. Second, **how the program tells you what it is about to do before you commit**: every snap both moves the cursor *and* names itself in a ScreenTip, using a fixed colour grammar (red/green/blue = the X/Y/Z axes, magenta = parallel/perpendicular *and* "you are snapping inside a group", cyan = midpoint). Supporting facts a critic can check individually: the Measurements box is a keyboard sink you never click into and that still accepts a value *after* the operation has finished; double-click repeats the last Push/Pull or Offset distance; `Ctrl` means "and copy", `Shift` means "lock what is happening"; middle-drag orbits, shift+middle-drag pans, scroll zooms toward the cursor with distance-adaptive speed; and navigation never interrupts a modelling operation.

**How a critic uses it.** Perform each of the five operations (a)-(e) in our editor and fill in the same five columns — tool switches, mouse clicks, typed characters, typed entries, total decisions. **Our decision count must be less than or equal to SketchUp's.** Then apply the four qualitative gates, because a low count achieved by removing precision is a fail: every operation must accept a typed exact value with no click into a field first; every snap must name itself using one of the official inference names; axis colours must be red/green/blue for X/Y/Z everywhere; and orbit/pan/zoom must work mid-drag with cursor-anchored, distance-adaptive scroll zoom.

---

## `retro-os/` — the bar for the fictional retro OS

33 screenshots (14 Windows 95, 8 Windows 98, 6 System 7, 5 Mac OS 8 Platinum) plus an analysis whose geometry is **measured pixel by pixel out of those actual PNGs**, not recalled — title bar 18 px, scrollbar 16 px, taskbar 28 px, Start button 54x22, menu item 20 px, Platinum title bar 22 px with 1-px pinstripes, Mac and Windows menu bars both 20 px — ending in a **20-point authenticity checklist**.

**What the bar is.** Pixel discipline. The chrome is drawn from the 16-colour VGA palette plus `#DFDFDF` and the tooltip cream, every bevel is exactly 1 px per line and 2 px per edge from the five-grey 3D palette (`#FFFFFF` / `#DFDFDF` / `#C0C0C0` / `#808080` / `#000000`), every "50 % transparent" effect is really a 1-pixel checkerboard, disabled text is a two-pass emboss rather than a grey, all text is bitmap and aliased to exactly two colours, and nothing eases. The checklist is written specifically as a list of ways a **modern UI wearing a retro filter** betrays itself: rounded corners, drop shadows, anti-aliased or sub-pixel-positioned text, gradients where there should be flat fills, 8-px overlay scrollbars, touch-sized 40-px menu rows, outline-style vector icons, modern icon metaphors (hamburger, cloud, gear, bell), a chrome colour histogram in the dozens, real alpha, and easing animations.

**How a critic uses it.** Take a PNG screenshot of our OS at 1:1, open it in a pixel-accurate viewer, and tick all twenty. Items 6-11 and 16 are literally measured with a ruler or a colour picker; item 3 is a two-colour count on a text run; item 14 is a histogram of the non-content regions. Any single failure is a rejection, because one rounded corner breaks the fiction faster than any amount of good content repairs it.

---

## Folder contents

```
reference/
  README.md                    this file
  architect-life/
    shot-01.jpg .. shot-09.jpg 9 x 1920x1080 Steam store screenshots
    ANALYSIS.md                per-shot breakdown + 15-point checklist
  sketchup/
    sketchup-01.png .. -15.gif 15 UI / inference / panel screenshots
    ANALYSIS.md                tools, inference engine, Measurements box,
                               modifiers, mouse verbs, Entity Info,
                               + click-count table
  retro-os/
    win95-01..14.png           Windows 95
    win98-01..08.png           Windows 98
    system7-01..06.png         Apple System 7
    macos8-01..05.png          Mac OS 8 Platinum
    ANALYSIS.md                measured geometry, bevel construction,
                               palettes, fonts, dither
                               + 20-point authenticity checklist
```
