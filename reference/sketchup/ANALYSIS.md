# SketchUp — the bar for how the EDITOR FEELS

**Sources:** Trimble's official documentation at help.sketchup.com (every claim below is traceable to a page listed at the bottom) and the official **SketchUp Quick Reference Card 2026 (Windows)**, plus 15 screenshots downloaded into this folder.

This is not a style reference. Nothing here is about how SketchUp *looks*. It is about **how few actions it takes to do a thing, and how the program tells you what it is about to do before you commit.** Those two properties are the whole reason architects tolerate SketchUp, and they are what our editor has to match.

---

## Screenshot index

| File | Size | What it shows |
|---|---|---|
| `sketchup-01.png` | 1117x718 | Full UI with numbered callouts: 1 title bar, 2 menu bar, 3 Getting Started toolbar, 4 drawing area, 5 status bar, 6 Default Tray. **The Measurements box is the field at the bottom right, labelled "Measurements".** |
| `sketchup-02.png` | 512x422 | The **Large Tool Set** — the two-column vertical tool palette, the whole modelling vocabulary in one column of icons |
| `sketchup-03.png` | 602x602 | **Midpoint inference**: cyan dot on the edge + the yellow "Midpoint" ScreenTip beside the pencil cursor |
| `sketchup-04.png` | 604x522 | **Perpendicular to Edge inference**: the reference edge highlighted magenta, the rubber-band line magenta, ScreenTip "Perpendicular to Edge" |
| `sketchup-05.png` | 1139x606 | **Push/Pull mid-drag**: blue-axis extrusion arrow on the face, status bar reads "Drag to push or pull face or enter value. Ctrl = toggle create new starting face.", Measurements box reads **`Distance  5'`** |
| `sketchup-06.png` | 1140x609 | Push/Pull before the drag: face hatched as selected, status bar "Pick face to push or pull.", Measurements box `Distance 0"` |
| `sketchup-07.png` | 1409x645 | **Entity Info panel**, four states side by side: Face (Area), Edge (Length, Soft, Smooth), Solid Component (Volume + Advanced Attributes), Solid Group (Volume) |
| `sketchup-08.png` | 1539x867 | **Section Plane** cutting a whole house model; the orange section-plane rectangle with its numbered handles |
| `sketchup-09.png` | 1539x867 | Section Plane being placed on a face |
| `sketchup-10.gif` | 472x322 | Animated: **arrow-key axis lock** applied to a drawing *direction* |
| `sketchup-11.png` | 1899x600 | Section cut in Right view + the Styles > Edit > Modeling colour list (Selected blue, Locked red, Guides, Inactive Section, Active Section orange, Section Fill, Section Lines) |
| `sketchup-12.png` | 1152x922 | Model with **edges coloured By axis** — the red/green/blue edge colouring, plus the Styles > Edge panel (Profiles 2, Depth cue 4, Extension 3, Endpoints 9, Jitter, Dashes) |
| `sketchup-13.png` / `sketchup-14.png` | 413x375 | **Corner inference grips** on a bounding box (Move/Scale) |
| `sketchup-15.gif` | 472x322 | Animated: **arrow-key lock** applied to a drawing *plane* |

---

## 1. The tools an architect already knows, by their exact names

Use these names verbatim in our UI. An architect who has used SketchUp must not have to translate.

| Official tool name | Default shortcut | What it does |
|---|---|---|
| **Select** | `Spacebar` | pick entities; `Ctrl` add, `Shift` add/subtract, `Ctrl+Shift` subtract |
| **Lasso** | `Shift+Spacebar` | freehand selection |
| **Line** | `L` | click start, click end; chains from the last endpoint |
| **Rectangle** | `R` | two opposite corners |
| **Rotated Rectangle** | — | three clicks: corner, first edge, width+angle |
| **Circle** | `C` | centre, then radius |
| **Polygon** | — | sides typed first, then centre + radius |
| **2 Point Arc** | `A` | two endpoints + bulge |
| **3 Point Arc** / **Arc** / **Pie** | — | |
| **Push/Pull** | `P` | extrude a face |
| **Move** | `M` | `Ctrl` = copy, `Alt` = Autofold |
| **Rotate** | `Q` | vertex, start of angle, end of angle; `Ctrl` = rotate a copy |
| **Scale** | `S` | `Ctrl` = about centre, `Shift` = uniform |
| **Offset** | `F` | offset a face or a connected run of edges |
| **Follow Me** | — | sweep a profile along a path |
| **Tape Measure** | `T` | measure, create guides, or **resize the whole model** by typing an intended size |
| **Protractor** | — | measure angles, create angled guides |
| **Paint Bucket** | `B` | "The default shortcut is B for Bucket!" |
| **Eraser** | `E` | `Ctrl` soften, `Shift` hide, `Alt` unsoften |
| **Orbit** | `O` | |
| **Pan** | `H` | |
| **Zoom** | `Z` | |
| **Zoom Window** | — | |
| **Zoom Extents** | `Shift+Z` | |
| **Section Plane** | — (`Tools > Section Plane`) | slice the model to see inside |
| **Make Component** | `G` | |
| **Search** | `Shift+S` | |

Toolbar names, also verbatim: **Getting Started toolbar**, **Large Tool Set**, **Drawing toolbar**, **Edit toolbar**, **Principal toolbar**, **Camera toolbar**.

---

## 2. The inference engine — the actual mechanism

SketchUp's docs: *"SketchUp displays several types of inferences: **point, linear, and shape**. SketchUp often combines inferences together to form a **complex inference**."*

Every inference does **two** things at once: it snaps the cursor, **and** it names itself in a yellow ScreenTip beside the cursor. The naming is not decoration — it is how the user knows *which* of six possible snaps just fired. Our editor must do both. A snap without a label is a guess.

### Point inferences

| Name | Definition (Trimble's words) | Marker colour |
|---|---|---|
| **Endpoint** | "End of a line, arc, or arc segment" | green |
| **Midpoint** | "Middle point on a line, edge, or arc segment" | cyan (see `sketchup-03.png`) |
| **Arc Midpoint** | "Middle point on an arc" | cyan |
| **Intersection** | "Point where a line intersects another line or face" | black X |
| **On Face** | "A point that lies on a face" | blue |
| **On Edge** | "A point that lies on an edge" | red |
| **Center** | "Center of a circle, arc, or polygon" | blue |
| **On Line** | "A point along a guide line" | red |
| **Guide Point** | a guide point | grey/black |
| **Origin point** | "The point at the intersection of the three drawing axes" | axis-coloured |
| **Component Origin Point** | the axis origin inside a group or component | — |
| **On Section** | where a drawing tool creates an edge on a section plane | — |

**Critical rule, verbatim:** *"All these point inference types are **magenta** in color when the geometry is inside a group or component."* One colour change tells you you are snapping to something outside your current editing context. That is a whole class of user error prevented by a colour swap.

### Linear inferences

- **On Red Axis** / **On Green Axis** / **On Blue Axis** — alignment to a drawing axis. Red = X, Green = Y, Blue = Z. The axis colours are the single most important convention in the whole program: they appear on the axes themselves, on the rubber-band line, on the dotted inference line, and optionally on every edge in the model (`sketchup-12.png`, Styles > Edge > Color: **By axis**).
- **From Point** — "Linear alignment from a point; **the dotted line's colour corresponds to the axis direction**."
- **Through Point** — draw from one point, hover a second point, hold **Shift** to lock the direction through it.
- **Parallel** — parallel to an edge. **Magenta.**
- **Perpendicular** — perpendicular to an edge. **Magenta** (`sketchup-04.png`).
- **Perpendicular to Face**, **Extend Edge**, **Tangent at Vertex**.

Colour coding summary a critic can test: **red = X axis, green = Y axis, blue = Z axis, magenta = parallel/perpendicular-to-something (and also = inside a group), cyan = midpoint/tangent.**

### Shape inferences

**Square** ("A rectangle whose sides are all the same size" — blue dots plus a "Square" ScreenTip), **Golden Section**, **Half / Quarter / Three-Quarter Circle**.

### Locking inferences with the keyboard

| Key | Effect (Trimble's words) |
|---|---|
| **Up arrow** | "Locks the drawing direction or drawing plane to the **Blue** axis" |
| **Left arrow** | "Locks the drawing direction or drawing plane to the **Green** axis" |
| **Right arrow** | "Locks the drawing direction or drawing plane to the **Red** axis. A good way to remember left from right is to say **'Right locks Red.'**" |
| **Down arrow** | "Toggle to lock the **parallel/perpendicular** drawing direction... Basically, **anything that turns magenta**." |
| **Shift** | "Locks the drawing direction or drawing plane to the **active** drawing direction/plane." |
| **Shift+Alt** (Win) / **Shift+Cmd** (Mac) | frees the Rotate/Protractor centre while keeping the drawing plane |

Two more official behaviours worth stealing outright:

- **Hover-to-prime:** *"By pausing your cursor over a location you want to infer from, SketchUp will prioritize aligning with that point when drawing."* You teach the engine what you care about just by resting the mouse there for a moment.
- **Linear Inferencing Toggle** (Line tool): after the first click, `Alt` (Win) / `Cmd` (Mac) cycles **All Inferences On -> All Inferences Off -> Parallel and Perpendicular Only -> All Inferences On**. There is always an escape hatch when the snapping is fighting you.

---

## 3. The Measurements box

Official: *"The Measurements Box appears in the **lower right corner** of the SketchUp interface. **The way the Measurements Box works changes based on which tool you are using.**"*

**The behaviour that matters, and the one most clones get wrong: you never click into it.** You start an operation with the mouse, you type a number, you press Enter. The field is a keyboard sink that is always listening while a tool is active. The mouse establishes *direction and intent*; the keyboard establishes *magnitude*.

It also works **after** the operation. Push/Pull, verbatim: *"Until you select something else, you can enter a precise distance in the Measurements box. Type a number and a value, and then press Enter."* Offset: *"You can reset the distance in this way as many times as you like until you make another change to your drawing or select a different tool."* So a sloppy drag followed by a typed number is a legitimate, fast workflow — drag to establish which way, type to establish how far.

(The Rectangle tool is the documented exception: *"Once you have drawn a rectangle, you can't modify the width or length after moving on to another operation."*)

### Accepted formats

Units: `10"`, `10'`, `10mm`, `10cm`, `10m`. Mixed imperial `3' 6"` works, and *"that unit overrides your template's default units."*

| Tool | What you type |
|---|---|
| Line | `4m` |
| **Rectangle** | `length,width` -> `20,40` or `8',20'`. **`3',` sets only the first dimension; `,3'` only the second.** Negative `-24,-24` flips direction |
| Rotated Rectangle | `width,angle` -> `90,20` |
| **Circle** | radius, or **segments** as `24s` |
| **2 Point Arc** | bulge; **radius** as `2r`; **segments** as `12s` |
| **Push/Pull** | distance -> `2700` |
| **Move** | distance `20'`, `-35mm`; **global coordinates in square brackets `[3', 4', 5']`**; **relative in angle brackets `<3', 4', 5'>`** |
| **Move — array** | `12x` = 12 copies at that spacing (external); `5/` = 5 copies divided into the gap (internal) |
| **Rotate** | decimal degrees `34.1`, or a slope `8:12`; negative = counter-clockwise |
| **Scale** | factor `1.5` (= 150 %) or a length `10m` |
| Offset | distance |
| **Tape Measure** | measure, then type the intended size -> **rescales the entire model** |

---

## 4. Push/Pull, specifically

- **Double-click a face = apply the last push/pull amount to it.** One gesture, zero typing, exact repeat. This is the single highest-value shortcut in the program.
- **`Ctrl` (Win) / `Option` (Mac)** = push/pull a **copy** of the face, leaving the original in place. The status bar literally reads: *"Drag to push or pull face or enter value. Ctrl = toggle create new starting face."* (`sketchup-05.png`)
- Type the distance during or after the drag.
- Inference during Push/Pull, verbatim: *"If you need to pull a face so that it's parallel with another face... hover the Push/Pull cursor over the other face, and the inference engine tells you when the two faces are parallel."* Extrusion snaps to other geometry, not just to numbers.
- Preselect trick: select a hard-to-hit face with the Select tool first, then Push/Pull it. `Esc` cancels mid-operation.
- Cutting through requires the pushed face to be parallel to the far face; otherwise you get *"a message that says the offset is limited."*
- **Offset has the same repeat gesture:** *"Double-clicking another face immediately after you create an offset automatically applies another offset, of the same amount, to the face."*

---

## 5. Modifier keys, per tool

| Tool | Modifiers |
|---|---|
| **Select** | `Ctrl` add - `Shift` add/subtract - `Ctrl+Shift` subtract |
| **Line** | `Alt` lock current inference direction - arrows lock axis |
| **Rectangle** | `Alt` draw from centre |
| **Move** | `Ctrl` **copy mode** (allows multiple consecutive) - `Shift` lock current inference - **`Alt` Autofold** ("allow move even if it means adding extra edges and faces") - arrows: **up = blue, right = red, left = green, down = parallel/perpendicular** |
| **Rotate** | `Ctrl` rotate a **copy** - `Shift` lock the rotation plane - `Alt`/`Cmd` while Shift held frees the protractor from that plane - arrays via `5/` or `12x` |
| **Scale** | `Ctrl` scale about centre - `Shift` scale uniformly |
| **Offset** | `Alt`/`Cmd` allow results to overlap - **double-click repeats** |
| **Push/Pull** | `Ctrl`/`Option` new starting face - **double-click repeats last distance** |
| **Paint Bucket** | **`Alt` sample material** - `Ctrl`/`Option` **All Connected** (paint matching adjacent faces) - `Shift` **All Matching** (replace that material everywhere in the model) - `Ctrl+Shift` **All on Same Object** |
| **Eraser** | `Ctrl` soften/smooth - `Shift` hide - `Alt` unsoften. Drag highlights edges **blue** before release. *"The Eraser tool doesn't allow you to erase faces"* — faces die with their bounding edges |
| **Tape Measure** | `Ctrl` toggle create-guide vs measure-only - arrows lock axis |
| **Protractor** | `Ctrl` toggle guide creation - arrows lock the rotation plane |
| **Orbit** | `Alt`/`Option` disable gravity-weighted orbit - `Shift` temporarily become Pan - **double-click re-centres the model** |
| **Section Plane** | `Shift` over a face locks the cursor direction - arrows orient the plane normal (up blue, right red, left green, **down parallel to face**) |
| **Zoom** | `Shift`+drag changes Field of View |

The pattern: **`Ctrl` almost always means "and make a copy / and do it to everything connected". `Shift` almost always means "lock what is currently happening". `Alt` is the odd-one-out escape hatch per tool.** Keep that grammar.

---

## 6. Mouse verbs — non-negotiable

From the Quick Reference Card's "Middle Button (Wheel)" block:

| Input | Verb |
|---|---|
| **Scroll wheel** | **Zoom** |
| **Middle-drag** | **Orbit** |
| **Shift + middle-drag** | **Pan** |
| **Middle double-click** | **Re-center view** |

(Note: middle double-click is officially "Re-center view", *not* Zoom Extents. Zoom Extents is `Shift+Z`.)

**Zoom is anchored to the cursor**, verbatim: *"When you zoom by scrolling, SketchUp uses your cursor as the zoom's center point."* Contrast with dragging the Zoom tool, which *"zooms in or out from the center of the screen."*

**Zoom speed is distance-adaptive**, verbatim: *"The zoom speed depends how far your geometry is from the Zoom cursor. When geometry is farther away, SketchUp zooms quickly. The zoom speed feels slower when your geometry is relatively close to the Zoom cursor."* This is the thing that makes SketchUp navigation feel calm instead of lurching. A fixed zoom step per notch is the giveaway of an amateur editor.

Also official: you can Pan without leaving your tool by holding **scroll wheel + left button**, and Orbit temporarily by **click-and-holding the scroll wheel**.

And the design principle behind all of it, in Trimble's own words: *"there are tools you don't even need to activate to use, and can even use when other tools are activated."* Navigation must never interrupt a modelling operation. You can orbit halfway through a Push/Pull to find the reference face you need.

---

## 6b. The Entity Info panel

Opened from the **Default Tray** (`Window > Default Tray > Entity Info` on Windows, `Window > Entity Info` on Mac), or by context-clicking any geometry and choosing **Entity Info**. See `sketchup-07.png`, which shows four states side by side.

**What it displays** is driven entirely by what is selected, and the entity type is printed in bold in the upper left:

| Selection | Panel shows |
|---|---|
| **Face** | thumbnail, **Layer** (Tag) dropdown, **Area**, Toggles row |
| **Edge** | thumbnail, **Layer**, **Length**, **Soft** checkbox, **Smooth** checkbox, Toggles |
| **Circle / Polygon** | as Face, plus **Radius** and **Segments** |
| **Solid Group (1 in model)** | **Layer**, **Instance** name, **Type** (IFC classification) dropdown, **Volume**, Toggles |
| **Solid Component (1 in model)** | **Layer**, **Instance**, **Definition**, **Volume**, Toggles, plus **Advanced Attributes**: Price, Size, Url, Status, Owner, Type |
| **Multiple entities** | a count instead of measurements |

**What is editable inline** — this matters more than the display:

- **Layer / Tag** dropdown: editable.
- **Radius** and **Segments**: editable, and this is documented as the *supported* way to change a circle after the fact — *"click in the Radius or Segments box, change the value, and press Enter (Windows) or Return (Mac). After you press Enter or Return, your shape reflects your changes."*
- **Soft** and **Smooth** checkboxes on an edge: editable.
- **Instance** and **Definition** names, and every Advanced Attribute: editable text fields.
- **Area**, **Length** and **Volume**: read-only display.
- The **Toggles** icon row: *"toggle visibility, locked status, and an entity's ability to cast and receive shadows."*

**The lesson for our inspector:** the panel is *not* a read-out. It is a second, keyboard-driven way to edit the same model, and the fields that make sense to type (radius, segment count, name, tag, flags) are typeable, while the fields that are consequences of geometry (area, length, volume) are not. Our inspector must draw that line the same way — never offer an editable-looking box for a derived value.

---

## 7. CLICK-COUNT TABLE — the bar our editor must match or beat

"Tool switches" = keystrokes or clicks spent activating a tool. "Clicks" = mouse clicks (a double-click counts as 2). "Typed" = characters including Enter. **"Decisions"** = tool switches + clicks + typed entries treated as one unit each — the number of distinct things the user has to think about.

| # | Operation | Method in SketchUp | Tool switches | Clicks | Typed | **Decisions** |
|---|---|---|---|---|---|---|
| **a** | **Draw a 4 m wall** (exact length, as a 3D volume 200 mm thick, 2700 mm high) | `R` -> click start corner -> type `4m,200` Enter -> `P` -> click top face -> type `2700` Enter | 2 | 2 | 13 chars, 2 entries | **6** |
| **a'** | *Same, but only the 4 m line* | `L` -> click start -> type `4m` Enter | 1 | 1 | 3 chars, 1 entry | **3** |
| **b** | **Cut a door opening** in an existing wall | `R` -> click on the wall face (snaps to floor via On Edge) -> type `900,2100` Enter -> `P` -> **double-click** the new face (repeats the last distance = wall thickness) | 2 | 3 | 9 chars, 1 entry | **6** |
| **b'** | *Same, first time (no previous distance to repeat)* | `R` -> click -> type `900,2100` Enter -> `P` -> click face -> type `-200` Enter | 2 | 2 | 14 chars, 2 entries | **6** |
| **c** | **Change a face's material** | `B` -> click the swatch in Materials -> click the face | 1 | 2 | 0 | **3** |
| **c'** | *Copy a material already in the model* | `B` -> `Alt`+click the source face (sample) -> click the target face | 1 | 2 | 0 | **3** |
| **c''** | *Paint every face with that material at once* | `B` -> click swatch -> `Shift`+click one face (All Matching) | 1 | 2 | 0 | **3** |
| **d** | **Move an object 500 mm along an axis** | click the object (Select) -> `M` -> click a grab point -> nudge toward the axis -> press the axis arrow key -> type `500` Enter | 1 | 2 | 1 arrow + 4 chars | **5** |
| **d'** | *Same, using explicit relative coordinates* | click object -> `M` -> click grab point -> type `<0,500,0>` Enter | 1 | 2 | 10 chars, 1 entry | **4** |
| **e** | **Measure a distance** | `T` -> click point A -> click point B; the length appears in the Measurements box | 1 | 2 | 0 | **3** |
| **e'** | *Measure and leave a guide line* | `T` -> click A -> click B (guide created; `Ctrl` toggles guide off) | 1 | 2 | 0 | **3** |

### How a critic uses this table

For each of the five operations (a)-(e), the critic performs the same task in **our** editor, counting the same way, and fills in the same five columns. **Our number must be less than or equal to SketchUp's Decisions column.** Specifically:

1. Draw a wall of an exactly specified length: **<= 6 decisions** (**<= 3** for a bare line).
2. Cut a door opening in an existing wall: **<= 6 decisions**, and **<= 6 when the repeat gesture is available**.
3. Change a face's material: **<= 3 decisions.**
4. Move an object an exact distance along an axis: **<= 5 decisions** (**<= 4** with typed coordinates).
5. Measure a distance: **<= 3 decisions.**

And four qualitative gates that go with the numbers — a low click count achieved by removing precision is a fail, not a win:

- **Every operation accepts an exact typed value, with no click into a field first.** The keyboard is always live while a tool is active.
- **Every snap names itself** in a label at the cursor, and the label uses one of the official inference names above.
- **Axis colours are red/green/blue for X/Y/Z**, used consistently on the axes, the rubber band, the dotted guide and (optionally) the edges.
- **Navigation never interrupts a tool.** Orbit, pan and zoom must be usable in the middle of a wall drag, and scroll-zoom must be anchored to the cursor with distance-adaptive speed.

---

## Sources

- <https://help.sketchup.com/en/default-keyboard-shortcuts>
- <https://help.sketchup.com/en/quick-reference-cards> -> QRC 2026 SketchUp Windows PDF
- <https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts>
- <https://help.sketchup.com/en/using-measurements-box>
- <https://help.sketchup.com/en/sketchup/pushing-and-pulling-shapes-3d>
- <https://help.sketchup.com/en/sketchup/drawing-basic-shapes>
- <https://help.sketchup.com/en/sketchup/moving-entities-around>
- <https://help.sketchup.com/en/sketchup/flipping-mirroring-rotating-and-arrays>
- <https://help.sketchup.com/en/sketchup/offsetting-line-existing-geometry>
- <https://help.sketchup.com/en/sketchup/applying-materials> / <https://help.sketchup.com/en/sketchup/replacing-material>
- <https://help.sketchup.com/en/sketchup/erasing-and-undoing> / <https://help.sketchup.com/en/sketchup/softening-smoothing-and-hiding-geometry>
- <https://help.sketchup.com/en/sketchup/stretching-geometry>
- <https://help.sketchup.com/en/sketchup/slicing-model-peer-inside>
- <https://help.sketchup.com/en/sketchup/viewing-model> / <https://help.sketchup.com/en/sketchup/using-your-mouse>
- <https://help.sketchup.com/en/sketchup/inspecting-entity>
- <https://help.sketchup.com/en/sketchup/user-interface> / <https://help.sketchup.com/en/sketchup/toolbars>
