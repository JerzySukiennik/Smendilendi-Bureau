# Architect Life: A House Design Simulator — the FINISH bar

**Source:** Steam store page, app 1296400 — <https://store.steampowered.com/app/1296400/Architect_Life_A_House_Design_Simulator/>
Developer SimFabric / Shine Research, published by SimFabric & Nacon, released 2025-06-19. Nine official store screenshots, all 1920x1080, downloaded full-resolution as `shot-01.jpg` ... `shot-09.jpg`.

---

## READ THIS FIRST — what we copy and what we do not

**We do NOT copy their style.** Architect Life is semi-realistic: PBR materials, photographed-looking wood grain, normal-mapped brick, foliage cards, real-camera depth of field. Our style is **clean low poly** — flat or lightly-shaded faces, no photo textures, silhouette-led shapes, a deliberately small material set.

**What we copy is four things, and a critic must only ever score us on these four:**

1. **Density.** They never show an empty room. Every shot is loaded with props.
2. **Lighting care.** Multiple sources, distinct colour temperatures, real contact shadows, visible bounce, sun shafts landing where they should.
3. **Richness / lived-in detail.** Books, mugs, rugs, plants, cables, candles, wall art, snow outside the glass, sticky notes on a shelf.
4. **Framing.** Every shot is composed — a chosen camera height, a lead line, a foreground element, a horizon in the right third. None of them is a default orbit-cam snapshot.

A low-poly render can hit all four. "Low poly" is a licence to simplify geometry, never a licence to ship an empty grey box with one light.

---

## Per-screenshot analysis

Hex values below are machine-sampled from the actual JPEGs: an 8-colour median-cut quantisation of each full frame ("palette"), plus 11x11-pixel averages at named points ("sampled"). Luminance percentiles are from the full pixel set (Rec.709 luma, 0-255).

---

### shot-01.jpg — Site plan on the architect's desk (miniature / diorama view)

**What it is.** The plot model — house, pool, lawn, driveway, trees — sitting physically on a wooden drawing desk, with the real desk surroundings visible behind and around it. Half game board, half architectural model.

**Prop count.** In the *desk* layer alone I count **18+ distinct prop types**: framed photo print on the wall, potted plant, pen/pencil cup with ~6 pencils, stacked cardboard boxes on a shelf, three yellow sticky notes with hand-written text, a bottle of white glue, a black marker pen, a rolled blue drawing tube, a metal ruler with printed scale numbers, a wooden shelf unit, a cork/wood desk surface, a printed contour drawing on the desk, a corrugated dark surface bottom-right, a stone/pebble pile, a laptop-edge sliver, a green notebook, a spiral-bound pad, dashed measurement guide lines with grab handles. In the *model* layer: house, pool, pool ladder, diving board, two paved circular patios, ~11 individual trees of at least 4 species, hedge shrubs, staircase, terrace railing, driveway, lawn, sand/gravel bed.

**Lighting.** Single warm key from upper-left/front (the sticky notes and glue bottle cast shadows down-right), colour temperature around 4500-5000 K — the desk wood samples `#9A6638` and reads warm. Fill is broad and cool from the ambient room. **Contact shadow under every single object** — the pencil cup, the glue bottle, the boxes, each tree on the lawn, the pool ladder. Bounce is visible: the underside of the white house volume picks up warm light off the sand `#ECCD9C` below it.

**Composition.** Three-quarter high-oblique, roughly 35-40 degrees down, camera pushed low enough that the desk objects behind the model rise above the horizon and give it a ceiling. The blue drawing tube runs left-to-right as a horizontal anchor; the ruler with numbers runs bottom-left as a vertical lead line; the dashed white selection bounds frame the plot as a rectangle inside the frame. Model occupies the centre 60%, real-world clutter occupies the border 40% — a deliberate frame-within-a-frame.

**Palette (quantised):** `#4E381F` 15% - `#C4D0B6` 14% - `#C2935F` 13% - `#B4B18A` 12% - `#5D6343` 12% - `#8E8F71` 12% - `#916E4D` 11% - `#232616` 11%
**Sampled:** desk wood `#9A6638` - pool water `#80BFC1` - lawn `#8B9E4D` - sand `#ECCD9C` - dark conifer `#2D4011` - sticky note `#EAAE26`
**Luminance:** p1 6 - p5 25 - p50 130 - p95 208 - p99 234 - mean 123 — a full-range image, real blacks and real near-whites.

**Material variety:** >=9 — wood (two tones), paper, cork, plastic, painted metal, water, glass, foliage, gravel, fabric.

---

### shot-02.jpg — Finished house at night, exterior hero

**What it is.** A completed round-plan villa at night, shot from lawn level. The single most "portfolio render" image in the set.

**Prop count.** ~14 distinct types outdoors: the house, curved balcony rail, external staircase, ivy climbing the render, arched windows, two garden uplighters (with visible light cones on the grass), foreground shrubs (3 varieties), a conifer, a low white boundary wall with slatted panels, distant city towers, wind turbines, a bench, patio furniture (two loungers plus a coffee table), and interior furniture readable *through* the glass — a sofa and a wall TV.

**Lighting — the best-taught shot in the set.** Four distinct temperatures, all separable by eye:
- **Moonlight key** cold blue from upper-left, ~7000-8000 K, sky zenith sampled `#40639F`.
- **Interior warm spill**, ~2700 K, sampled `#D5C0A4` in the window openings — the arched windows glow orange and throw warm light onto the balcony floor.
- **Two ground-mounted uplighters** on the lawn casting hard-edged, warmer-white cones up the shrubs — this is what sells "someone lit this".
- **Ambient sky fill** desaturating the far background to near-nothing.

**Contact shadows** are present under every shrub and under the loungers; the staircase has proper cast shadow onto the wall behind it. Bounce: warm interior light visibly re-lights the underside of the balcony overhang.

**Composition.** Eye-level (~1.6 m), symmetrical-ish but broken by the staircase entering from the right third. The house is centred but its top is cut by nothing — full building silhouette against the star field. Foreground shrubs at the bottom edge give depth layering (foreground / subject / background city). Horizon on the lower third.

**Palette:** `#2C4673` 18% - `#586D98` 18% - `#211E15` 15% - `#0C150A` 13% - `#040604` 13% - `#718FBB` 11% - `#26344B` 8% - `#485367` 5%
**Luminance:** p1 0 - p5 2 - p50 58 - p95 143 - p99 186 - mean 64 — a genuinely dark image that still reads. Nothing is muddy grey.

**Material variety:** >=8 — white render, timber decking, painted steel rail, glass, ivy, grass, stone paving, fabric upholstery.

---

### shot-03.jpg — Structural work: top-down plan editing on the model board

**What it is.** The **editor mode** shot, and therefore the most directly relevant to us. A plywood base board on the desk holds the wall shells; the player is dragging a wall with a live dimension readout.

**HUD anatomy (copy this structure, not the colours).**
- Top-centre: a 6-icon phase toolbar (Structural work / Finishing / Exterior / Furnishing / Decorating / Validate-tick) with a **text label tooltip pinned under the active icon** — "Structural work". The icons are thin white line art on a translucent dark chip.
- Right edge: two stacked "helper" chips, each an **icon + a right-aligned label + value** — `Measurement help / Length: 10 cm` and `Design help / Angles`.
- Lower right: a level indicator (`0` in a house glyph) and a compass rose.
- Bottom right: the persistent readouts — `Budget $80,919`, `Surface area 362 / 90 m2`.
- In-world: **each room carries a floating tag with its area and name** — `19 m2 Unnamed 3`, `51 m2 Unnamed 1`, `16 m2 Unnamed 4`, `9 m2 Unnamed 5`, `38 m2`.
- The dragged wall shows a **live cost delta `$464` and a live length `166`** right at the cursor.
- The whole plot is bounded by a **dashed white selection rectangle with round grab handles at corners and midpoints**.
- The desk itself carries a giant printed `15 degrees` and white construction lines — the game *decorates the empty space around the model* rather than leaving it flat.

**Prop count.** ~12 desk-layer types (stacked timber battens in a grid, a rolled bamboo mat, coiled rope, a hard hat, printed guide lines, dowel rods) plus the built shells, a pool, stairs, and floor slabs.

**Lighting.** Warm single key from upper-left at ~4000 K; the model board casts a long soft shadow to the lower-right on the desk `#321A11`. Ambient occlusion is clearly visible in every inside corner of every room shell — the wall/floor junctions darken. This is the single most copyable lighting fact for us: **AO in the wall-floor corners is what makes bare shells look built rather than drawn.**

**Composition.** Near-top-down (~70 degrees) but deliberately *not* orthographic — enough perspective that walls have thickness and read as 3D. The board is rotated ~5 degrees off-axis so nothing is dead parallel with the frame edge.

**Palette:** `#E8A060` 18% - `#805D4E` 16% - `#A68E86` 15% - `#866D6A` 15% - `#A8785C` 10% - `#EEC8A1` 9% - `#BFA99F` 9% - `#603B29` 8%
**Sampled:** desk `#321A11` - plywood base `#ECA562` - room floor `#C8946B` - HUD chip `#C2B2B0`
**Luminance:** p1 11 - p5 57 - p50 137 - p95 220 - p99 238 - mean 139.

---

### shot-04.jpg — Furnishing mode, cutaway interior from above

**What it is.** Furnishing phase with the roof removed, plus a **left-side "Specifications" panel** showing objectives.

**Panel anatomy.** Header row with icon + `Specifications`. A pink/magenta progress bar for `Surface area 289 / 280 m2` (over budget, so the bar reads red). Below, a **circular green ring gauge** for `Budget $150,710 / 260,300` and a green house glyph for `Levels 0-1`. Then a checklist of requirements, each a row with a small diamond bullet, a label and a right-aligned `have / need` fraction: `Windows 33 / 24`, `Large Windows 8 / 8`, `Very Large Windows 16 / 4`, `Wood walls`. Rows that are satisfied are green. Bottom-right: `Snapping On` chip with a magnet icon, plus `Budget $109,590` and `Surface area 289 / 280 m2`.

**Prop count.** >=20 distinct furniture/decor types in view: modular sofa (5 segments), ottoman, round coffee table, TV bench, floor lamp, ceiling fan/pendant, framed wall art, interior door, staircase (two runs), kitchen cabinetry, wall shelving with objects on it, parquet floor, sliding glass doors, balcony rail, potted plant, rug, wardrobe, bar stools, exterior palm, pool with decking.

**Lighting.** Bright tropical key from upper-right, ~5500 K, throwing **hard sunlight rectangles across the parquet floor through the window openings** — the classic "windows drawn on the floor" effect. Cool sky fill from the open roof. Warm bounce off the timber cladding onto the white sofa. Contact shadows under every sofa segment, the ottoman, the table, the plant pot.

**Composition.** ~45 degree high oblique, the cut walls forming strong diagonals from lower-left to upper-right. UI occupies the two opposite corners, leaving the centre diagonal completely clear for the subject. The turquoise pool in the top-right corner is a deliberate complementary accent against all that warm timber.

**Palette:** `#AB7652` 16% - `#110603` 15% - `#3C2519` 14% - `#586868` 13% - `#72BAC7` 12% - `#613926` 12% - `#CFBA9B` 10% - `#23221F` 8%
**Luminance:** p1 0 - p5 2 - p50 78 - p95 209 - p99 242 - mean 92 — very high contrast, deep shadow under the cutaway.

---

### shot-05.jpg — Decorating mode, wall-art placement

**What it is.** The player is positioning a small hanging planter on a wall. The selected object has a **cyan selection box and a large cyan downward arrow gizmo**; the HUD says `Motion / Height` and `Design help / On`.

**Prop count.** ~16 distinct types: spiral staircase (black steel), egg chair, dark area rug, timber floor with dashed placement guides burnt into it, two panel doors with handles, **six wall-mounted planters of three different designs**, trailing ivy, a straight staircase with timber treads and a turned-wood newel post and rail, a glass balustrade, a wall-mounted handrail, skirting, a ceiling, and the pool visible top-right.

**The dashed white guide lines running across the floor** are the snapping/alignment feedback made visible in-world — worth stealing wholesale.

**Lighting.** Soft overhead key ~5000 K with a strong warm bounce off the timber floor onto the grey-green wall; the wall reads `#CCB498` where lit. Contact shadow under the egg chair, under the rug edge (it lifts), and a soft AO band where every wall meets the floor and where the stair stringer meets the wall. Each hanging planter casts its own small shadow on the wall behind it — **the detail that proves the light is real and not baked flat.**

**Composition.** ~40 degrees down, three-point perspective, the staircase running as a strong diagonal from centre to bottom-right. The subject (selected planter) sits almost exactly on a rule-of-thirds intersection. The dark rug in the lower-left is a weight-balancing mass.

**Palette:** `#F0E4D4` 15% - `#130B07` 13% - `#A06943` 13% - `#B2A598` 13% - `#8C9692` 12% - `#422818` 12% - `#6B6055` 11% - `#E4B27F` 10%
**Luminance:** p1 0 - p5 6 - p50 135 - p95 232 - p99 236 - mean 125.

---

### shot-06.jpg — Contractors screen (pure 2D UI)

**What it is.** The management/menu layer. Nine contractor cards in three category groups (Structural work / Finishing work / Exterior), plus two summary columns on the right (Total cost, Total duration) with progress bars, and a gamepad button legend at the bottom (`A Select`, `Menu`, `B Back`).

**Anatomy worth copying.** Each contractor card is one row: an icon, a company name, then **three equal metric cells side by side — a thumbs-up star rating (4 of 5 stars), a dollar cost, a calendar duration**. Each cell has its own glyph above its value. The selected card is lifted by a **1 px light outline plus a lighter fill**, not by a glow. Category headers are small pill tabs that overlap the top-left corner of their group container.

**Lighting.** None — this is flat UI over a soft vertical/radial gradient background, `#81A1B0` top to `#314F63` mid, i.e. a cool blue-grey. Cards are near-black `#121B20` on mid-slate `#434D54`. The only saturated colour in the whole screen is the green progress fill and the yellow rating stars. **Restraint: two accent colours, everything else desaturated blue-grey.**

**Composition.** Two-column: 60% list on the left under a huge left-aligned all-caps `CONTRACTORS` title, 40% summary on the right. Generous margins. The title is roughly 4x the body text size.

**Palette:** `#7FA1B5` 16% - `#5C8095` 15% - `#1C2831` 14% - `#567383` 12% - `#6E8C9D` 11% - `#4B6A7D` 11% - `#324957` 10% - `#93B3C2` 10%
**Luminance:** p1 26 - p5 40 - p50 117 - p95 175 - p99 253 - mean 114 — note p1 = 26: a UI screen has no true black, unlike the 3D shots.

---

### shot-07.jpg — Timeline + event dialogue over the live construction site

**What it is.** The strongest *systems* shot. A Gantt-style timeline banner occupies the top ~27% of the frame; below it the live site (crane, poured slab, forest, river). A modal event card ("Weather / Rain") overlays the lower left with two choice buttons.

**Timeline anatomy.** A horizontal ruler with tick columns; three stacked coloured bars — dark `319 days` (structural), teal `220 days` (finishing), cyan `168 days` (exterior) — each prefixed by the same phase icon used in the in-world toolbar. A **white dashed vertical line labelled `Today`** and a **yellow/black hazard-striped vertical line labelled `Delivery`** at the right end. Colour is doing real work here: each phase keeps its colour across every screen in the game.

**Event card anatomy.** Icon + `Weather` header in pink. Body paragraph in plain prose, first person, in-world voice ("The weather forecast was right, unfortunately..."). An illustration panel to the right rendered as a **white line drawing on a dark blueprint field** — a different visual register from everything else, which is why it reads as an "event". Two choice buttons, each with the consequence right-aligned in colour: `+ 1 days` in green-ish, `$ -650` in pink. Persistent `Budget $260,300` bar at the bottom of the card.

**Lighting.** Overcast rain lighting on the site: flat cool key ~6500 K, low contrast on the ground plane, **actual rain streaks and puddle reflections**. The crane is the one saturated warm object (safety yellow) against an otherwise blue-green scene — a single accent against a cool field.

**Composition.** Hard horizontal split at 27%, modal in the lower-left third, subject (crane + slab) in the upper-right of the remaining space. The river runs as a diagonal from centre-left to bottom-right.

**Palette:** `#66AFE1` 17% - `#4C5F61` 17% - `#748682` 16% - `#285565` 13% - `#2B3C41` 13% - `#112F38` 11% - `#9FB4B9` 8% - `#4C7F99` 6%
**Luminance:** p1 23 - p5 31 - p50 101 - p95 189 - p99 243 - mean 107.

---

### shot-08.jpg — Finished house in landscape, wide establishing shot

**What it is.** The delivered building seen from across a meadow, with a whole village, lake and forested hills behind it. This is the "here is your project in the world" shot.

**Prop count.** ~22 distinct types: the main house (three cladding materials), a barn, two farmhouses, a pergola, hay bales, a wooden fence with individual posts, a dirt track with wheel ruts, a crop of dried maize, wildflowers scattered in the grass, ~30 individual trees of at least 5 species, a hedge, a lake, a distant boat, a jetty, a stone retaining wall, a timber deck, stilts under the deck, an outdoor table set, a stair run, a mown lawn strip, and a fence line running to the horizon.

**Lighting.** Bright midday sun, key from behind-left of the camera at ~5800 K. Long soft shadows raking across the grass from left to right — **the shadows are the most important thing in this frame**; without them the meadow is a green sheet. Sky is a graded blue with volumetric cumulus. There is aerial perspective: the far hills desaturate and shift blue (far hills read much cooler and lighter than the near trees). Bounce off the grass tints the underside of the deck green.

**Composition.** Camera at ~1.5 m in the grass, horizon on the upper third. **Framed by out-of-focus foreground foliage on both left and right edges** — a classic vignette-by-geometry. The dirt track is the lead line running from bottom-centre to the house. Depth of field: foreground trees and the far shore are soft, the house is sharp. Four depth layers: foreground foliage / meadow / house+village / hills+sky.

**Palette:** `#908645` 22% - `#D0DEEF` 22% - `#726336` 15% - `#2B5035` 12% - `#9DB8A9` 8% - `#76A98F` 8% - `#C7BC9C` 7% - `#538054` 5%
**Sampled:** sky zenith `#CDCCDE` - sky near horizon `#DADEF1` - cloud `#E8E6F2` - dirt path `#E3BE90` - stone base `#AA9998`
**Luminance:** p1 33 - p5 63 - p50 142 - p95 224 - p99 232 - mean 146 — a high-key image, but note p1 = 33, so even here nothing crushes to pure black.

---

### shot-09.jpg — Interior kitchen/dining, eye-level, winter light

**The single best finish reference in the whole set.** If a critic can only compare our render against one image, it is this one.

**Prop count — I count 26 distinct prop types:** four black dome pendant lamps on visible black cables, five recessed ceiling downlights, a starburst LED chandelier, a full-height grey cabinet run, brick feature wall, fluted-panel splashback, open shelving with objects on it, a kettle, a sink with mixer tap, a 5-burner gas hob, a stone island worktop, a fluted island base, two lit candles in candlesticks, two metal canisters, a vase of pink flowers, a dining table, four dining chairs (two designs), two upholstered swivel armchairs, floor-to-ceiling glazing with slim mullions, an exterior deck, deck railing, a snowy mountain range, conifers under snow, a neighbouring cabin, and a timber ceiling soffit.

**Lighting — the strongest in the set. At least four distinct colour temperatures:**
- **Cool daylight key** through the right-hand glazing, roughly 6500-7000 K, snow-bounced. Sky through glass samples `#778FAF`.
- **Warm sunlight patch**, ~4000 K, landing on the floor and up the left wall — sampled floor in sun `#FDE1C3`, a full 40 luma steps above the unlit floor.
- **Warm interior pendants**, ~2700 K, adding a soft pool on the island.
- **Candle flames**, ~1900 K, tiny but present, and the game bothered to include them.

**Contact shadow under every floor-standing object** — each chair leg has its own dark ellipse, the island meets the floor with a dark AO band, the table casts a real shadow. **Ambient occlusion** darkens every ceiling/wall junction and the recess behind the splashback. **Bounce** is unmistakable: the warm floor throws light back up onto the underside of the island lip and the white ceiling.

**Sampled materials:** ceiling in warm light `#BFA687` - pendant black `#00060D` - slate brick `#333D4B` - cabinet grey-lilac `#555964` - stone island `#978D8B` - sunlit wood floor `#FDE1C3` - terracotta chair `#A73209` - table top `#757B82` - sunlit wall `#A8A4A1`.

**Material variety: >=11** — matte painted MDF, slate brick, polished stone, oiled timber floor, timber ceiling, gloss black metal, brushed steel, glass, leather/fabric upholstery, wax, ceramic.

**Colour strategy.** The room is 90% desaturated cool greys and browns; the **only saturated colour in the entire image is the terracotta `#A73209` on three chairs plus the pink flowers.** That is the whole trick — one accent hue, repeated three times, against a neutral field.

**Composition.** Eye-level (~1.5 m), one-point perspective with the vanishing point pushed right, ceiling included at the top of the frame so the room feels enclosed. The island runs as a strong diagonal across the bottom-right. The window wall is a bright rectangle balancing the dark brick wall on the left — dark mass left, light mass right. Foreground (island + candles) / midground (dining set) / background (mountains) are three clean depth layers.

**Palette:** `#B6A794` 17% - `#766B66` 17% - `#484C55` 15% - `#272B32` 11% - `#A18D7B` 11% - `#7D8084` 10% - `#DAC4AF` 10% - `#6B5346` 9%
**Luminance:** p1 1 - p5 38 - p50 119 - p95 214 - p99 238 - mean 120.

---

## Cross-cutting observations

| Property | What Architect Life does, measurably |
|---|---|
| Prop density (room shot) | 16-26 distinct prop types per interior frame; never fewer than 12 |
| Light sources | 3-5 distinct sources per frame, 2-4 distinct colour temperatures |
| Contact shadow | Present under 100% of floor-standing objects, in 100% of frames |
| Ambient occlusion | Visible dark band at every wall/floor and wall/ceiling junction |
| Material count | 8-11 distinct materials per interior frame |
| Saturated accent | Exactly one accent hue per frame, repeated 2-4 times |
| Luminance range | p5 <= 63 and p95 >= 143 in every single frame — full range always used |
| Framing | Every frame has >=3 readable depth layers and a deliberate lead line or foreground frame |
| Empty floor | No frame has a bare floor area larger than ~25% of the frame |
| HUD | Corner-anchored, translucent dark chips, icon + label + value, never centre-screen |

---

## CHECKLIST — 15 measurable things our low-poly render must match

A critic holds one of our screenshots next to these nine images and answers each item **yes/no with a number**. Any "no" is a rejection with a specific fix.

1. **>=16 distinct prop *types* are visible in an interior room shot** (count types, not instances: "four identical chairs" = 1 type). Reference: shot-09 has 26, shot-04 has >=20. Our floor is 16.
2. **>=8 of those props are "lived-in" clutter**, i.e. objects with no structural function — books, mugs, candles, vases, cables, rugs, wall art, plants, papers, a kettle. Reference: shot-09 has candles, canisters, flowers, kettle, shelf objects, wall art, rug, cables.
3. **>=3 light sources with distinct colour temperatures** are identifiable in the frame, and a critic can name each one's approximate direction and warm/cool character. Reference: shot-09 has 4 (cool daylight ~6500 K, warm sun patch ~4000 K, pendants ~2700 K, candles ~1900 K).
4. **Every floor-standing object has a visible contact shadow** at its base — a distinctly darker area where the object meets the floor. Count objects, count shadows; the numbers must be equal. Zero exceptions allowed.
5. **A visible ambient-occlusion band exists at every wall/floor junction and every wall/ceiling junction** in the frame — the corner must be measurably darker than the middle of the same wall. Sample two pixels 20 px apart and require a luma difference of at least 12/255.
6. **Visible bounce light**: at least one surface is lit by light reflected off another surface, not by a source directly — e.g. the underside of a counter or shelf picking up floor colour. A critic must be able to point at it.
7. **At least one hard directional light patch is cast onto the floor or a wall through an opening** (window, doorway, skylight), with a readable shape edge. Reference: shot-04's window rectangles on the parquet, shot-09's sun patch.
8. **Luminance range: p5 <= 70 and p95 >= 140** on the full frame (Rec.709 luma, 0-255). Every one of the nine reference shots passes this. A flat mid-grey render fails it.
9. **>=8 visually distinct materials in an interior frame** — distinct by colour *and* by surface behaviour (matte / gloss / reflective / transmissive). Reference: 8-11 per frame.
10. **Exactly one saturated accent hue per frame, repeated 2-4 times**, with everything else at 25% saturation or less. Reference: shot-09's terracotta `#A73209` on three chairs. Two or more competing accents = fail.
11. **>=3 readable depth layers** — foreground / midground / background, separable by a critic drawing two horizontal lines on the screenshot. Reference: shot-08 has four.
12. **A deliberate framing device**: either a foreground element entering from an edge, or a lead line (path, counter, staircase, table edge) running from a frame edge toward the subject. Reference: shot-08's foliage frame + dirt track, shot-05's staircase diagonal.
13. **No bare floor region larger than 25% of the frame area.** Measure the largest contiguous unoccupied floor patch. Reference: none of the nine shots exceeds this.
14. **Every HUD element is corner- or edge-anchored, never centre-screen**, and each readout follows the icon + label + right-aligned value pattern; the centre 50% of the frame is clear of UI in all editor shots (03, 04, 05).
15. **Cast shadow direction is consistent across every object in the frame** and matches the stated key-light direction — pick any three objects; their shadows must point within 10 degrees of each other. Reference: shot-08's meadow shadows all rake left-to-right.

**Reminder for the critic:** none of these fifteen items mentions polygon count, texture realism, bevels, or PBR. All fifteen are achievable in flat-shaded low poly. If a critic rejects our render for "not looking like Architect Life", the critic is wrong; reject it only against the numbers above.
