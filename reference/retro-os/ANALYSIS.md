# Retro OS — the bar for our fictional operating system

**33 screenshots** in this folder: 14 Windows 95, 8 Windows 98, 6 System 7, 5 Mac OS 8 (Platinum).

Everything in the "measured" tables below was sampled **from these actual PNGs** with a pixel-run scanner, not recalled from memory. Where a number comes from documentation rather than from a pixel I say so. Where a capture's palette has been quantised (several of the 4-bit and 8-bit colormap PNGs round `#C0C0C0` to `#C3C3C3` or `#BFB8BF`, and `#008080` to `#008282`) I give the canonical value and note the drift.

**Authoritative captures** (true-colour, unquantised, and therefore the ones I measured against): `win95-09.png` (Control Panel, 415x362), `win95-10.png` / `win95-11.png` (Display Properties, 404x448), `win98-06.png`, `win98-07.png`, `macos8-03.png` (Control Panels, 772x512).

---

## Screenshot index

| File | px | Contents |
|---|---|---|
| `win95-01.png` | 640x480 | Desktop, "Welcome to Windows 95" dialog, taskbar with Start button, clock, desktop icon column |
| `win95-02.png` | 525x302 | Win95 UI element detail |
| `win95-03.png` | 800x28 | **A taskbar strip alone** — clean reference for taskbar height and bevel |
| `win95-04.png` | 640x480 | Desktop |
| `win95-05.png` | 640x480 | **Start menu fully cascaded three levels deep** (Programs > Accessories > System Tools > ScanDisk) with the vertical "Windows 95" banner |
| `win95-06/07/08.png` | 640x480 | Desktop / Explorer variants |
| `win95-09.png` | 415x362 | **Control Panel window** — title bar, menu bar, 32x32 icon grid, status bar. My primary measurement source |
| `win95-10/11.png` | 404x448 | **Display Properties** — tabs, group boxes, combo box, slider, disabled group ("Font size" greyed), default push button. Second measurement source |
| `win95-12.png` | 480x321 | **WordPad** — two toolbars with 16x16 raised buttons and separators, a font/size combo pair, a ruler, and a status bar ("For Help, press F1") |
| `win95-13.png` | 434x428 | **Help Topics dialog** — tab control, tree/list with book icons, a selected row in `#000080`/`#FFFFFF`, and a row of three push buttons with the default ring on "Display" |
| `win95-14.png` | 640x28 | **A second clean taskbar strip** with three task buttons, one of them pressed (Control Panel), plus the clock |
| `win98-01.png` | 640x480 | Win98 desktop |
| `win98-02.png` | 800x600 | Win98 desktop |
| `win98-03.png` | 640x480 | **Two Explorer windows, gradient title bars, toolbar with large icons, Address bar, scrollbars, status bar with panes, taskbar with Quick Launch** |
| `win98-04.png` | 640x480 | Explorer variant |
| `win98-05.png` | 640x480 | **Calculator + Windows Help** — tree control, tabs, both scrollbars, gradient title bar |
| `win98-06/07/08.png` | ~500x440 | Dialog detail |
| `system7-01..06.png` | up to 640x480 | System 7 desktop, Finder windows, menu bar, Calculator, Note Pad, Control Panels |
| `macos8-01..05.png` | up to 772x512 | Mac OS 8 Platinum desktop, Appearance control panel, Control Panels window, Control Strip, balloon help |

---

## 1. Windows 95 / 98 — measured geometry

All values at 96 DPI, "Small Fonts", the Win95 default.

| Element | Measured | Source |
|---|---|---|
| **Title bar height** | **18 px** | `win95-09` y=4..21; `win95-10` y=3..20; `win95-01` dialog y=56..73. Three independent captures, all 18. |
| Window sizing frame | **4 px** on every side | `win95-09` x=0..3 and y=0..3 |
| Menu bar band | **20 px** (19 px menu + 1 px spacer) | `win95-09` y=22..41 |
| Client sunken edge | **2 px**: `#808080` then `#000000` | `win95-09` y=42, y=43 |
| Status bar | **23 px** overall; inner sunken pane 17 px | `win95-09` y=337..359 |
| **Push button** | **21 px** tall (23 px including the default-button ring) | `win95-10` OK button y=416..436 |
| Default-button ring | **1 px** `#000000`, drawn *outside* the button bevel | `win95-10` y=415 and y=437 |
| Tab height | **19 px** | `win95-10` y=31..49 |
| **Scrollbar (both axes)** | **16 px** | `win98-05` x=611..626 and y=421..436; `win98-03` x=612..627. Matches `SM_CXVSCROLL` = `SM_CYHSCROLL` = 16 |
| **Taskbar height** | **28 px** | `win95-01` y=452..479 |
| **Start button** | **54 x 22 px** | `win95-01` x=2..55, y=456..477 |
| Desktop icon grid pitch | **75 px vertical** (32x32 icon + label) | `win95-01`, icon tops at y=2 and y=77 |
| **Start menu item pitch** | **32 px** (32x32 icons) | `win95-05`, highlighted "Programs" y=220..251 |
| Cascade menu item height | **20 px** (16x16 icons) | `win95-05`, highlighted "Accessories" y=221..240 |

**Documented but not measured here** (Win32 `GetSystemMetrics` defaults at 96 DPI): `SM_CYCAPTION` 18, `SM_CXBORDER`/`SM_CYBORDER` 1, `SM_CXFRAME`/`SM_CYFRAME` 4 (sizing border), `SM_CXDLGFRAME` 3, `SM_CYMENU` 19, `SM_CXVSCROLL` 16, caption buttons 16x14 px inside an 18 px bar.

---

## 2. The 3D bevel construction — exactly which pixel is which

This is the part that everybody gets wrong, and it is *not* one rule. **Windows draws two different raised edges depending on whether the thing is a window/panel or a control**, and the difference is visible.

### Palette (canonical, and confirmed pixel-exact in `win95-09` / `win95-10`)

| System colour | Hex | Role |
|---|---|---|
| `COLOR_3DFACE` / **ButtonFace** | **`#C0C0C0`** | the body of everything |
| `COLOR_3DHILIGHT` / **ButtonHighlight** | **`#FFFFFF`** | brightest bevel line |
| `COLOR_3DLIGHT` / **ButtonLight** | **`#DFDFDF`** | second bevel line — the one people forget |
| `COLOR_3DSHADOW` / **ButtonShadow** | **`#808080`** | inner dark bevel line |
| `COLOR_3DDKSHADOW` / **ButtonDarkShadow** | **`#000000`** | outer dark bevel line |

### (a) Window frame / raised panel — `EDGE_RAISED`

Reading **inward from the top-left corner**:

```
row 0   #DFDFDF   <- BDR_RAISEDOUTER, top/left  = ButtonLight
row 1   #FFFFFF   <- BDR_RAISEDINNER, top/left  = ButtonHighlight
row 2   #C0C0C0   } the remaining 2 px of the 4 px sizing frame
row 3   #C0C0C0   }
row 4.. #000080   <- title bar begins
```

Reading **inward from the bottom-right**:

```
last-1  #808080   <- BDR_RAISEDINNER, bottom/right = ButtonShadow
last    #000000   <- BDR_RAISEDOUTER, bottom/right = ButtonDarkShadow
```

Measured verbatim in `win95-09`: `#DFDFDF x1 @0 | #FFFFFF x1 @1 | #C0C0C0 x2 @2 | #000080 x18 @4 | ... | #808080 x1 @360 | #000000 x1 @361`.

### (b) Push button (raised) — `DrawFrameControl`, the *opposite* order

```
top/left    px0 #FFFFFF   (ButtonHighlight)
            px1 #DFDFDF   (ButtonLight)
body            #C0C0C0
bottom/right px-2 #808080 (ButtonShadow)
            px-1 #000000  (ButtonDarkShadow)
```

Measured in `win95-10`, OK button, column x=196: `#000000 @415 (default ring) | #FFFFFF @416 | #DFDFDF @417 | #C0C0C0 x17 @418 | #808080 @435 | #000000 @436`.

**So: window frame = light-then-white. Button = white-then-light.** Getting this backwards is the single most common tell of a fake.

### (c) Pressed button

Two lines only, inverted, and the label shifts **1 px down and 1 px right**:

```
top/left     #808080  (ButtonShadow), 1 px
body         #C0C0C0
bottom/right #FFFFFF  (ButtonHighlight), 1 px
```

### (d) Sunken field / client edge (`EDGE_SUNKEN`, text boxes, list views, the client area)

```
top/left     px0 #808080  (BDR_SUNKENOUTER = ButtonShadow)
             px1 #000000  (BDR_SUNKENINNER = ButtonDarkShadow)
field            #FFFFFF  (COLOR_WINDOW)
bottom/right px-2 #DFDFDF (ButtonLight)
             px-1 #FFFFFF (ButtonHighlight)
```

Measured in `win95-09` at the client boundary: `#808080 @42 | #000000 @43`, and in `win95-10`'s combo box: `#808080 @262 | #000000 @263 | #FFFFFF @264 ...`.

### (e) Group box / etched line (`EDGE_ETCHED`)

1 px `#808080` then 1 px `#FFFFFF`. Used for group-box outlines and menu separators. Only two lines, never four.

---

## 3. Full Windows 95 default colour scheme

| Element | Hex | Note |
|---|---|---|
| **ActiveTitle** | **`#000080`** | measured `#000080` in `win95-09`/`win95-10` |
| **GradientActiveTitle** (Win98+) | **`#1084D0`** | left-to-right gradient with ActiveTitle; the gradient progression is visible in `win98-03`/`win98-05`. Win95 has **no gradient** — flat `#000080` only. |
| TitleText | `#FFFFFF` | |
| InactiveTitle | `#808080` | |
| GradientInactiveTitle (Win98+) | `#B5B5B5` | |
| InactiveTitleText | `#C0C0C0` | |
| **ButtonFace / Menu / Scrollbar / 3DFace** | **`#C0C0C0`** | |
| **ButtonHighlight / 3DHilight** | **`#FFFFFF`** | |
| **ButtonLight / 3DLight** | **`#DFDFDF`** | |
| **ButtonShadow / 3DShadow** | **`#808080`** | |
| **ButtonDarkShadow / 3DDkShadow** | **`#000000`** | |
| ButtonText / MenuText / WindowText | `#000000` | |
| **Window** | `#FFFFFF` | |
| WindowFrame | `#000000` | |
| **Highlight** (selection) | **`#000080`** | measured in `win95-10`'s combo box and `win95-05`'s menu |
| **HighlightText** | **`#FFFFFF`** | |
| **GrayText** (disabled) | **`#808080`** | |
| **Background / Desktop** | **`#008080`** (teal) | `win95-01` shows `#008282`, a 4-bit palette rounding |
| AppWorkspace (MDI backdrop) | `#808080` | |
| **InfoWindow** (tooltip) | **`#FFFFE1`** | |
| InfoText | `#000000` | |
| Scrollbar track | `#C0C0C0`, **rendered as a 50 % checkerboard of `#FFFFFF` and `#C0C0C0`** | see section 6 |

---

## 4. Fonts

| System | Font | Size | Character |
|---|---|---|---|
| Win95/98 UI, menus, buttons, labels | **MS Sans Serif** | **8 pt** = 11 px em, ~13 px line box at 96 DPI | **Bitmap** (`SSERIFE.FON`). Hand-hinted, hard pixel edges, **no anti-aliasing whatsoever**. |
| Win95/98 title bar | **MS Sans Serif Bold** | 8 pt | |
| Win95/98 icon titles | MS Sans Serif | 8 pt | |
| Win95/98 fixed-pitch (Notepad default, console) | **Fixedsys** / **Terminal** | 9 pt / 8x12 | bitmap |
| Windows 2000 onward | Tahoma 8 pt | | **This is the boundary.** A retro OS that renders in Tahoma is Windows 2000, not Windows 95. |
| System 7 & Mac OS 8 menus, titles, buttons | **Chicago** | **12 pt** | bitmap, heavy, distinctive. Replaced by **Charcoal** in Mac OS 8.5. |
| Mac icon labels, list views, small UI text | **Geneva** | **9 pt** (also 10 and 12) | bitmap |
| Mac fixed-pitch | Monaco | 9 pt | |

Both families are **bitmap fonts rendered with no anti-aliasing, no sub-pixel positioning, and integer-only glyph advances.** Every glyph starts on an integer pixel. This is not a stylistic detail — it is the single loudest authenticity signal in a screenshot.

---

## 5. Icons, scrollbars, taskbar, menus

### Icon grid sizes

- **Windows:** 16x16 (small, shell list views, title bars, taskbar buttons), **32x32** (standard, desktop and Start menu top level, `win95-09`'s Control Panel grid), 48x48 (extra large). 4-bit (16 colour) icons throughout Win95; 8-bit (256 colour) added in Win98.
- **Mac:** 16x16 (`ics#`/`ics8`) and 32x32 (`ICN#`/`icl8`), 1-bit mask plus 4-bit or 8-bit colour.
- **Desktop grid pitch measured at 75 px vertical** in `win95-01`.

### Scrollbar (16 px), construction across the width

```
px 0  #DFDFDF   ButtonLight
px 1  #FFFFFF   ButtonHighlight
px 2..13  #C0C0C0  face (12 px)
px 14 #808080   ButtonShadow
px 15 #000000   ButtonDarkShadow
```

Measured in `win98-05` at both the vertical (x=611..626) and horizontal (y=421..436) bars.

- **Arrow buttons are square, 16x16**, one at each end, each a raised button with a **black solid triangle** 7 px wide x 4 px tall, drawn from hard pixels, no anti-aliasing.
- **The thumb is a raised button** with the same 2 px bevel, minimum length ~8 px.
- **The track is not flat.** Measured in `win98-03` at y=300, x=607..621: `#FFFFFF, #BDBDBD, #FFFFFF, #BDBDBD, ...` alternating **every single pixel** — a 50 % checkerboard of ButtonHighlight over ButtonFace. On a clicked/pressed track it inverts to `#808080` over `#C0C0C0`.

### Taskbar

- **28 px tall.** Top edge: 1 px `#C0C0C0`, then 1 px `#FFFFFF` highlight, then face.
- **Start button 54 x 22 px**, a standard raised button containing a 16x16 flag icon and the word "Start" in bold.
- Task buttons: 22 px tall, raised when inactive, **pressed (shadow/highlight inverted, label offset 1 px down-right) when their window is active**.
- Notification area at the right is a **sunken** panel containing 16x16 icons and the clock in MS Sans Serif 8 pt.
- Win98 adds the **Quick Launch** bar: a sunken strip of 16x16 icons with a vertical gripper of two 1-px dotted lines.

### Menus

- **Menu bar band 20 px**; menu bar items get ~6 px horizontal padding and highlight to `#000080` with `#FFFFFF` text on hover/open.
- **Popup menu item height 20 px** with 16x16 icons; the **Start menu's top level is 32 px** because it uses 32x32 icons (`win95-05`).
- Popup menus have a **raised 2 px border** and a 1 px `#000000` outer... in Win95 the popup uses `EDGE_RAISED` plus a hard drop of no shadow at all in 95, and an optional shadow only from Win2000. **Win95 menus have no drop shadow.**
- **Separator = 2 px etched line**: 1 px `#808080` then 1 px `#FFFFFF`, inset from both edges.
- **Left gutter** holds the icon / checkmark column (about 20 px wide); **right gutter** holds the accelerator text (`Ctrl+C`) right-aligned and the **submenu arrow**, a solid black right-pointing triangle 4x7 px.
- **Underlined accelerators (mnemonics).** Exactly one letter per item carries a 1 px `#000000` underline directly beneath it — `<u>F</u>ile`, `Shut <u>D</u>own...`, `<u>P</u>rograms` (all visible in `win95-05` and `win95-09`). Under Win95 the underlines are **always visible**; the "hide until Alt is pressed" behaviour arrives in Windows 2000. Pressing `Alt` plus the letter activates the item; inside an open menu the bare letter suffices.
- **Item states:** normal `#000000` on `#C0C0C0`; hovered `#FFFFFF` on `#000080`; **disabled = the embossed grey** (section 6); checked items show a 7x7 black checkmark or a 6 px bullet in the left gutter, drawn **pressed-in** (sunken bevel) rather than as a tick badge.
- Items that open a dialog end in **`...`** (three literal periods). Items that open a submenu end with the arrow. This is a rule, not a habit.

---

## 6. Dither patterns

Windows 95 has almost no true transparency and no alpha. Everything that would today be `opacity: 0.5` is a **1-pixel checkerboard**.

### The 50 % checkerboard

```
pixel (x, y) uses colour A when (x + y) is even, colour B when (x + y) is odd
```

Used for:
- **The scrollbar track** — `#FFFFFF` / `#C0C0C0` (measured in `win98-03`).
- **The pressed scrollbar track and pressed toolbar buttons** — `#808080` / `#C0C0C0`.
- **The default Win95 desktop pattern** where one is set — a 8x8 tiled monochrome bitmap of the desktop colour and black.
- **Marching-ants / drag rectangles** — an XOR-drawn dotted 1 px line.
- **Focus rectangles** — a 1 px dotted `#000000` rectangle, dots on alternate pixels, inset 1 px inside the control (visible around the pressed default button).
- **The Explorer "cut" ghost** and disabled icons — the icon is drawn through a checkerboard mask.

### Disabled ("greyed") text — the embossed effect

Not one colour. **Two passes:**

1. Draw the string in **`#FFFFFF`** (ButtonHighlight) offset **+1 px right, +1 px down**.
2. Draw the string in **`#808080`** (ButtonShadow) at the true origin.

The result reads as *carved into* the panel. Visible in `win95-10`'s greyed-out "Font size" group box and its disabled "Custom..." and "Apply" buttons. A flat 50 %-alpha grey label is a modern fake.

---

## 7. The 16-colour VGA palette

The whole of Windows 95's chrome is drawn from these sixteen and nothing else.

| Name | Hex | | Name | Hex |
|---|---|---|---|---|
| Black | `#000000` | | Gray | `#808080` |
| Maroon | `#800000` | | Red | `#FF0000` |
| Green | `#008000` | | Lime | `#00FF00` |
| Olive | `#808000` | | Yellow | `#FFFF00` |
| Navy | `#000080` | | Blue | `#0000FF` |
| Purple | `#800080` | | Fuchsia | `#FF00FF` |
| **Teal** | **`#008080`** | | Aqua | `#00FFFF` |
| **Silver** | **`#C0C0C0`** | | White | `#FFFFFF` |

The **20 Windows static system colours** are these 16 plus four more reserved at the ends of the system palette:

`#C0DCC0` (money green) - `#A6CAF0` (sky blue) - `#FFFBF0` (cream) - `#A0A0A4` (medium grey)

`#DFDFDF` (ButtonLight) is **not** in the 16-colour VGA set — it is a 256-colour-era addition, which is why it only shows up on the bevels and never in an icon.

---

## 8. Mac OS 8 "Platinum" and System 7 — measured

### Platinum grey ramp (sampled from `macos8-03.png`)

`#FFFFFF` - `#EEEEEE` - `#DDDDDD` - `#CCCCCC` - `#999999` - `#777777` - `#000000`

Seven pure greys, all neutral, no colour cast. (System 7 before it is essentially two: black and white, with `#555555` / `#888888` appearing only in dithered patterns.)

### Mac OS 8 window title bar — **22 px**, measured `macos8-03` column x=200

```
y  0   #000000    1 px black outer frame
y  1   #FFFFFF    highlight
y  2- 3 #CCCCCC   2 px
y  4-15 #FFFFFF / #777777 alternating every row   <- THE PINSTRIPES: 6 white/grey pairs, 12 rows
y 16-19 #CCCCCC   4 px
y 20   #999999
y 21   #000000    bottom rule
```

**The pinstripes are the whole identity of Platinum**, and they are exactly 1 px on, 1 px off — never a gradient, never a soft texture. They run the full width of the bar, interrupted only by the title text's background plate, the close box (left), and the collapse/zoom boxes (right).

- **Close box** at the far left, **collapse (windowshade) box and zoom box** at the far right, each a small square with its own bevel.
- **Grow box** in the bottom-right corner of the window, overlapping the scrollbars.
- Window frame, right and bottom: `#FFFFFF` - `#CCCCCC` - `#CCCCCC` - `#999999` - `#000000` - `#000000`.

### Menu bars

| | Measured | Construction |
|---|---|---|
| **System 7** | **20 px** | `y 0..18 #FFFFFF`, `y 19..20 #000000` — pure white with a black rule. `system7-05.png` |
| **Mac OS 8** | **20 px** | `y 0 #FFFFFF`, `y 1..17 #DDDDDD`, `y 18 #999999`, `y 19 #000000`. `macos8-05.png` |

Both are full-width, always present, and carry the Apple menu at the far left and the clock/menu extras at the far right.

### Mac scrollbar — **16 px**, same as Windows

Measured in `macos8-03`: `#000000` (1 px border), `#EEEEEE` x14, `#000000` (1 px border). Platinum scrollbars have a **1 px black outline** where Windows has a bevel; the thumb is a Platinum-bevelled block with a small textured grip.

---

## 9. THE 20-POINT AUTHENTICITY CHECKLIST

A critic opens a screenshot of our fictional OS and ticks these. **Each one is a specific way a "modern UI with a retro filter" gives itself away.** Any single failure is a rejection.

| # | Check | Fail condition (the modern tell) |
|---|---|---|
| **1** | **Every corner is a hard 90-degree pixel corner.** | Any `border-radius`, any rounded button, any softened window corner. Zero exceptions — Win95 and Platinum have literally none. |
| **2** | **No drop shadows anywhere.** No window shadow, no menu shadow, no button shadow, no text shadow. | Any blurred dark region behind a floating element. Popup menus in Win95 sit directly on the pixels beneath them. |
| **3** | **All text is aliased.** Every glyph pixel is fully on or fully off; count the distinct colours in a text run — it must be exactly 2. | Any grey fringe pixel around a letterform. Any sub-pixel (coloured) fringing. Any `font-smoothing`. |
| **4** | **Every glyph starts on an integer pixel** and advances by integer widths. | Fractional letter-spacing, `letter-spacing: 0.02em`, kerning that shifts a glyph half a pixel. |
| **5** | **Flat fills only, except the Win98-style title bar gradient.** | Any gradient on a button, panel, toolbar, taskbar or menu. Any "subtle" vertical sheen. If a title bar gradient exists it must be a straight `#000080` -> `#1084D0` horizontal ramp and nothing else. |
| **6** | **Every bevel is exactly 1 px per line, 2 px per edge, and uses only `#FFFFFF` / `#DFDFDF` / `#C0C0C0` / `#808080` / `#000000`.** | A 3 px border, a 1 px border, an anti-aliased bevel, or a bevel using an off-palette grey like `#E8E8E8` or `#B0B0B0`. |
| **7** | **Window frames read light-then-white inward (`#DFDFDF`, `#FFFFFF`); buttons read white-then-light (`#FFFFFF`, `#DFDFDF`).** | Both drawn the same way. This is the classic error. |
| **8** | **Sunken fields are `#808080` then `#000000` on top-left, `#DFDFDF` then `#FFFFFF` on bottom-right.** | A single-line 1 px grey border around a text field. |
| **9** | **Title bar is exactly 18 px** (Windows) **or 22 px** (Platinum), measured with a pixel ruler. | 24, 28, 32, or "whatever the line-height came out as". |
| **10** | **Scrollbars are exactly 16 px wide**, with square 16x16 arrow buttons carrying hard-pixel solid black triangles. | A thin 8 px modern scrollbar. A rounded thumb. No arrow buttons at all. An auto-hiding overlay scrollbar. |
| **11** | **The scrollbar track is a 1-px checkerboard of `#FFFFFF` and `#C0C0C0`**, not a flat grey. | A flat track fill. |
| **12** | **Disabled text is the two-pass emboss** — `#FFFFFF` offset (+1,+1) under `#808080` at origin. | A flat grey label, or a label at 50 % opacity. |
| **13** | **No transparency or alpha anywhere.** Every "50 %" effect is a 1-pixel checkerboard. | Any `rgba()`, any `opacity` other than 0 or 1, any frosted/blurred panel, any translucent menu. |
| **14** | **The total distinct-colour count in the chrome is <= 20**, and every chrome colour is drawn from the 16-colour VGA palette plus `#DFDFDF` plus the tooltip cream `#FFFFE1`. | A screenshot whose chrome samples 40+ unique hexes. Run a histogram on the non-content regions. |
| **15** | **Exactly one letter per menu item and per button label is underlined** with a 1 px rule, and the underlines are **always visible**, not revealed on Alt. | No mnemonics at all, or mnemonics that appear only on keypress (that is Windows 2000+). |
| **16** | **Menu items are 20 px tall** (32 px only in a Start-menu-style top level with 32x32 icons), separators are a 2 px etched `#808080`/`#FFFFFF` line, submenus are marked by a solid black 4x7 triangle, dialogs by a literal `...`. | Menu items 36-44 px tall with generous padding — i.e. touch-target sizing. Chevron `>` glyphs instead of solid triangles. |
| **17** | **Icons are 16x16, 32x32 or 48x48, drawn pixel-by-pixel with a hard 1-bit mask and a limited palette**, with a visible black or dark outline and a hand-dithered highlight. | Flat vector glyphs, line-art "outline icons", Material/Feather/Lucide strokes, gradient-filled app icons, or any icon that scales smoothly. |
| **18** | **The icon metaphors are period-correct.** Floppy disk, CRT monitor with a beige bezel, manila folder, a physical trash can or recycle bin, a printer with fanfold paper, a telephone handset for the modem. | A hamburger menu, a cloud, a gear that means "settings" (Win95 uses a control-panel-with-a-slider), a heart, a bell, a wifi fan, a "share" node graph, a magnifier used as a generic search glyph in the title bar. |
| **19** | **Nothing animates with easing.** State changes are instantaneous single-frame swaps: a button is either raised or pressed, a menu is either closed or fully drawn. The only motion allowed is a hard-cut progress bar advancing in discrete 8-px blocks and a 1-frame window "zoom" outline. | Any transition, any `ease-out`, any fade, any slide-in menu, any hover cross-fade, any spring, any 200 ms anything. Hover states may change colour, but they change on the frame the cursor arrives. |
| **20** | **The cursor set is period-correct and 32x32 1-bit with a mask** — the black arrow with a white outline, the I-beam, the hourglass (Windows) or the wristwatch / spinning beachball-of-quadrants (Mac). | A modern OS cursor composited over the screenshot, an anti-aliased pointer, or a CSS `cursor: pointer` hand that came from the host browser rather than from our OS. |

### Bonus tells worth flagging even though they are not in the twenty

- **A pressed button must offset its label by exactly (+1, +1)** — not scale it, not dim it.
- **A focused control shows a 1 px dotted black focus rectangle**, inset 1 px, dots on alternating pixels.
- **The active window's title bar is `#000080`; inactive is `#808080`.** If every window looks active, the depth model is missing.
- **Text is left-aligned and vertically centred by integer division**, so a 20 px row with an 11 px font sits at y+4 or y+5 — never at a half pixel.
- **Platinum pinstripes are 1 px on / 1 px off.** A 2-px stripe or a soft texture is a fake.

---

## Reminder on scope

This bar is about **pixel discipline**, not about nostalgia decoration. A screenshot that scores 20/20 here will look like it was captured on a real machine in 1996 — which is exactly the point, because the fictional OS is the frame the whole game is presented through, and a single rounded corner breaks the fiction faster than any amount of good content can repair it.
