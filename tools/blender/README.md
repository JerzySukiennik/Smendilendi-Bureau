# The model pipeline

Every catalogue GLB in `assets/models/` is generated from a script here. Nothing
is modelled by hand in a `.blend`, so a catalogue revision is a rebuild, not a
remodelling session.

```bash
node tools/blender/dump-catalog.mjs > tools/blender/_tmp/catalog.json
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make-models.py \
    -- --catalog tools/blender/_tmp/catalog.json [ids...]
node tools/blender/verify.mjs
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/render-sheet.py \
    -- --out progress/shots/catalogue-all.png --tile 460 --cols 4
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
| `families.py` | one function per catalogue family; `BUILDERS` maps id -> function |
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

1. **One connected body.** Before meshing, the parts' bounding boxes are grown by
   2 mm and union-found. More than one component raises `BuildError` naming every
   orphan. `verify.mjs` then re-checks the same property on the finished GLB, from
   the index buffer, so a build can never pass by construction alone.

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

Where a model's real bounding box legitimately differs from the catalogue (a tap
above a basin rim, a lever handle on a door leaf), the difference is declared in
`EXPECTED_DRIFT` in `verify.mjs` with the value the catalogue should carry, and
printed as `drift`, not hidden. `src/model/catalog.js` belongs to another agent;
this pipeline reports, it never edits.

## Adding a family

```python
def my_thing(e):                       # e is the catalogue entry
    w, h, d = e['size']
    s = Shape(e['id'], e.get('anchor', 'floor'), e['size'])
    s.box((w, 0.04, d), (0, h - 0.02, 0), 'tint', name='top')
    ...
    return s

BUILDERS['my-thing'] = my_thing
```

Primitives: `box`, `taper` (a box with two different cross-sections — legs, star
arms, pots), `cyl`, `tube` (a bar bent through a polyline — cords, spouts, steam
wands, stems), `card` (one double-sided quad, 2 triangles — leaves, paper), and
`shell` (an open-topped bowl with a real recess, rectangular or elliptical —
basins, sinks, WC pans, drip trays).

Then build it, run `verify.mjs`, render it, **and look at the picture**. A model
nobody has looked at is not finished, whatever the numbers say.
