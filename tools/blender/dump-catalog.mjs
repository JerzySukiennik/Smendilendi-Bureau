// dump-catalog.mjs — the bridge between the JS catalogue and the Blender pipeline.
//
// Blender's Python cannot import ES modules, and the catalogue is owned by another
// agent and still moving. So the build reads it THROUGH NODE, at generation time,
// every run. A catalogue revision is picked up automatically; nothing here caches.
//
//   node tools/blender/dump-catalog.mjs            -> JSON on stdout
//
// Emits { catalog: [entry...], palette: { colors, classes }, props: [propSpec...] }.

import { CATALOG } from '../../src/model/catalog.js';
import { COLORS, MATERIAL_CLASSES, FURNITURE_TINTS } from '../../src/core/palette.js';
import { EXTRA_PROPS } from './props.mjs';

const catalog = Object.values(CATALOG).map((e) => ({
  id: e.id,
  name: e.name,
  category: e.category,
  file: e.file,
  size: e.size,
  price: e.price,
  anchor: e.anchor,
  mount: e.mount,
  clearance: e.clearance,
  tags: e.tags,
  colorable: e.colorable,
  proc: e.proc,
  seatHeight: e.seatHeight,
  workHeight: e.workHeight,
  opening: e.opening,
  note: e.note,
}));

process.stdout.write(JSON.stringify({
  catalog,
  props: EXTRA_PROPS,
  palette: {
    colors: COLORS,
    classes: MATERIAL_CLASSES,
    tints: FURNITURE_TINTS,
  },
}, null, 1));
