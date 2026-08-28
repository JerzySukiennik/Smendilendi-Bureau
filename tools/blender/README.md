# The model pipeline

Every catalogue GLB in `assets/models/` is generated from a script here. Nothing
is modelled by hand in a `.blend`, so a catalogue revision is a rebuild, not a
remodelling session.

**All 122 catalogue entries are built here.** They used to be 15, and the other
107 fell through to a second, unbevelled, never-audited geometry path in
`src/model/proc-shapes.js` — raw boxes in a different visual language, a bath
that was a solid sideboard, a corner sofa with no L return, a stair whose
handrail ran to 3.80 m through a 2.80 m storey. `families.py` is keyed on the
catalogue's own `proc` family name now, so one script per FAMILY covers every
variant and a new catalogue row in an existing family needs no edit here.

```bash
node tools/blender/dump-catalog.mjs > tools/blender/_tmp/catalog.json
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make-models.py \
    — --catalog tools/blender/_tmp/catalog.json [ids...]
node tools/blender/verify.mjs
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/render-sheet.py \
    — --out progress/shots/catalogue-all.png --tile 460 --cols 4
```

`dump-catalog.mjs` reads `src/model/catalog.js` **through node, every run**, so the
dimensions in a GLB are always the catalogue's own. Blender never sees a number
that was typed twice.

## Files

| file | what it owns |
|---|---|
| `lib/units.py` | the coordinate contract (below) |
| `lib/mats.py` | material slots; colours come from `src/core/palette.js` |
| `lib/build.py` | the `Shape` builder: primitives, the connectivity assertion, bevelling, per-slot joining, the anchor rule, GLB export |
| `families.py` | one function per catalogue FAMILY; `FAMILIES` maps the catalogue's own `proc` name -> function, and `ENVELOPE` declares the fourteen items that stand outside their catalogue box |
| `make-models.py` | the build driver, run inside Blender |
| `verify.mjs` | the independent audit; parses the GLB by hand, never through a loader |
| `render-sheet.py` | labelled contact sheets at office eye height with a 1.75 m figure |
| `props.mjs` | office dressing that is not a catalogue component |

## The coordinate contract

Metres, radians, transforms applied, no parent transforms.

Item space — what the GLB contains and what the game sees:

- `+X` width, to the item's right
- `+Y` up
- `+Z` **forward**: the direction a chair faces, the side a wardrobe opens
  towards, the side a WC is approached from.

Origin, by anchor:

| anchor | origin |
|---|---|
| `floor` | X and Z centred on the footprint, Y = 0 at the base |
| `wall` | X centred, Y = 0 at the base, **Z = 0 at the wall face**, item extends into `+Z` |
| `ceiling` | X and Z centred, Y = 0 at the ceiling, item hangs into `-Y` |

Blender is Z-up and the exporter runs with `export_yup=True`, which rewrites
Blender `(x, y, z)` as glTF `(x, z, -y)`. Composing the two, item space maps into
Blender as `(x, -z, y)` — the ordinary "front faces -Y" convention. Family
scripts are written in item space only; `ITEM_TO_BLENDER` is applied once, inside
`finish()`.

## The three rules `finish()` enforces

1. **One connected body, proven face against face.** Before meshing, every pair
   of parts whose bounding boxes overlap is tested with `BVHTree.overlap` — do
   their triangles actually intersect, within 0.2 mm? More than one component
   raises `BuildError` naming every orphan. `verify.mjs` re-checks the same
   property on the finished GLB with its own triangle-triangle test (Moller,
   coplanar case included), so a build can never pass by construction alone.

   The bounding box is a **prefilter, never a proof**. It used to be the whole
   test, and it cannot see a floating part: a tap 6 mm above a basin, a waste
   buried under a bowl floor and a pane sealed inside a sash all have
   overlapping boxes and no shared surface. A critic tested the fifteen models
   that passed that way and found five of them in pieces, two of which a human
   had already approved.

   A consequence worth knowing: a part **entirely inside** another solid reports
   as disconnected, because its surfaces meet nothing. That is deliberate. It is
   invisible geometry, and it caught a hanging rail sealed inside a wardrobe
   carcase, four shelves inside a solid display fridge, a printer's output tray
   inside its own casing and a lift call panel buried in a 90 mm jamb.

   This exists because the reviewer rejected two unrelated items in one sitting
   with the same sentence — *"elementy nie są połączone"*, the parts are not
   joined. Parts must **interpenetrate at their joints**: a leg runs up into the
   seat, an armrest overlaps both the seat side and the back post, a cistern sits
   on the pan's rear shoulder.

2. **Bevelled.** Sharp edges (>= 28°) get a bevel, scaled down on small parts and
   dropped below 2.5 mm where it would be invisible at office scale. "Clean low
   poly" in `DESIGN-DECISIONS.md` means softly bevelled volumes, not raw boxes.

3. **One mesh per material region.** Parts are joined per slot, so an object is
   `len(slots)` meshes. The tintable slot is named **`tint`** and is near-white,
   because the runtime multiplies the player's colour into it.

## Sizes and the catalogue

`ARCHITECTURE.md` requires the bounding box to match `catalog.js` within 2 %.
`Shape.fit()` will nudge a finished body onto the catalogue number by at most 4 %
— that is for the last fraction of a percent a bevel or a polygon radius leaves
behind, not a licence to scale a wrong design into place; beyond that it raises.

Every axis of every item is fitted and asserted. `FIT_AXES` used to exempt 19
items from one or two axes each, and those unwatched axes are exactly where the
drift hid: a wall-hung basin whose rim landed at 0.53 m instead of the 0.85 the
ergonomics module reads, an island 24 % over its own depth, a kids' basin row
41 % over its height. `FIT_AXES` is empty now.

Fourteen items carry a piece of real ironmongery that cannot fit inside the
catalogue box — a deck mixer above a basin's rim height, a lever handle either
side of a door leaf. Those are declared **twice**, in `ENVELOPE` in
`families.py` (which the build asserts against) and in `EXPECTED_DRIFT` in
`verify.mjs` (which prints them as `drift`, with the value the catalogue should
carry). The two must agree; a mismatch fails the audit. Nothing else drifts.

`src/model/catalog.js` belongs to another agent; this pipeline reports, it never
edits. **The handoff is in `_tmp/catalog-handoff.json`** and `verify.mjs` prints
a HANDOFF line every run: 107 entries have a GLB and no `file:` line, so until
someone adds those lines the game still draws them with the procedural fallback,
and 14 entries want their `size` updated to the value listed under `drift`.

## Adding a family

The registry is keyed on the family, not the id, so every catalogue row whose
`proc` names an existing family builds with no edit here.

```python
def fam_my_thing(e, a):                # e is the catalogue entry, a its proc args
    w, h, d = e['size']
    s = Shape(e['id'], e.get('anchor', 'floor'), e['size'])
    s.box((w, 0.04, d), (0, h - 0.02, 0), body(e, 'wood'), name='top')
    ...
    return s

FAMILIES['procMyThing'] = fam_my_thing
```

Use `body(e, alt)` for the main colour region rather than naming a slot: it
returns `tint` only when the entry says `colorable`, and hands back `alt`
otherwise. Passing `body(e, 'tint')` defeats it, which is how a kids' basin row
the catalogue marks `colorable: false` shipped a live tint region anyway.

Primitives: `box`, `taper` (a box with two different cross-sections — legs, star
arms, pots), `cyl`, `tube` (a bar bent through a polyline — cords, spouts, steam
wands, stems), `card` (one double-sided quad, 2 triangles — leaves, paper),
`ring` (a flat annulus, whole or a horseshoe arc — WC seats, basin rim
apertures, pot rims), `shell` (an open-topped bowl with a real recess,
rectangular or elliptical — basins, sinks, WC pans, drip trays; it hands back
the bowl floor height so a waste is placed FROM it instead of guessed at) and
`wedge` (flat on the floor, top face rising along -Z — ramps and closed stair
strings; a rotated slab cannot do that job without hanging below the floor
plane, which is how a ramp came to start 60 mm down in a step).

Two habits the primitives cannot enforce and a family script must:

* **Joints interpenetrate, they do not abut.** Two faces exactly level with each
  other are two bodies. Run the leg up into the seat, the plinth up into the
  carcase, the sash onto the frame.
* **A child rotated on its parent moves with the PARENT's axes.** `_on(pos,
  tilt, dy, dz)` gives the world position of a point at local `(0, dy, dz)`
  inside a part tilted about X. Offsetting along the world axes instead is what
  lifted a reception card-reader screen 2.8 mm off its own host.

Then build it, run `verify.mjs`, render it, **and look at the picture**. A model
nobody has looked at is not finished, whatever the numbers say.
