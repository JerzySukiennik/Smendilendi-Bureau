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
