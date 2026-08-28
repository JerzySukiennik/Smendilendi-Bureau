// props.mjs — office props that are NOT catalogue components.
//
// The catalogue (src/model/catalog.js) is the PLAYER's palette: things the player
// places inside a building they designed. It is owned by another agent and this
// pipeline never edits it.
//
// The studio itself needs a second, smaller set of objects: the drawing board the
// architect works at, the four generations of desk computer, the coffee machine's
// mug, the corkboard the brief is pinned to. Those are dressing for `src/office/`,
// not components a client can buy, so they live here instead.
//
// Shape is deliberately identical to a CatalogEntry so build.py, verify.mjs and the
// contact sheet treat both lists the same way.
//
// STATUS: these eleven are SPECIFIED, NOT BUILT. Every one has `proc: null`, so
// `families.builder_for()` returns None and `make-models.py` skips it; there is
// no GLB for any of them and no `assets/models/props.json`. Nothing in `src/`
// references them yet either. They need a family each (a raked drafting top, a
// five-drawer plan chest, a deep-bodied CRT, four generations of case, a roll
// plotter, a chipboard massing model, a corkboard, a mug with a handle) and none
// of that is shared with the catalogue families, which is why it is not folded
// into `procTallUnit` and pretended to be done. Build them before `src/office/`
// starts loading them, and give each one a `proc` naming its new family.

const P = (o) => ({
  id: o.id,
  name: o.name,
  category: o.category ?? 'prop',
  file: `assets/models/${o.id}.glb`,
  size: o.size,
  price: o.price ?? 0,
  anchor: o.anchor ?? 'floor',
  mount: o.mount ?? 0,
  clearance: { front: 0, back: 0, left: 0, right: 0 },
  tags: o.tags ?? [],
  colorable: o.colorable ?? false,
  proc: null,
  seatHeight: null,
  workHeight: o.workHeight ?? null,
  opening: null,
  note: o.note ?? '',
  hero: true,
});

export const EXTRA_PROPS = [
  P({
    id: 'prop-drawing-board', name: 'Drawing board', category: 'prop',
    size: [1.40, 1.05, 0.90], workHeight: 0.75, colorable: false,
    tags: ['hero', 'workstation', 'studio'],
    note: 'A0 drafting table, top raked ~12 deg, parallel rule on the board, stand at 0.75.',
  }),
  P({
    id: 'prop-plan-chest', name: 'Plan chest', category: 'prop',
    size: [1.10, 0.90, 0.80], workHeight: 0.90, colorable: false,
    tags: ['hero', 'storage', 'studio'],
    note: 'A0 plan chest, five 0.13 m drawers with full-width pulls, on a plinth.',
  }),
  P({
    id: 'prop-crt-monitor', name: 'CRT monitor', category: 'prop',
    size: [0.42, 0.40, 0.44], colorable: false,
    tags: ['hero', 'computer'],
    note: '15-inch beige CRT: deep tapered body, curved-ish faceplate, tilt foot.',
  }),
  P({
    id: 'prop-pc-tier1', name: 'Pentagram 133', category: 'prop',
    size: [0.42, 0.16, 0.42], colorable: false,
    tags: ['hero', 'computer', 'tier1'],
    note: 'Tier 1 desktop: beige pizza-box case, floppy slot, big round power button.',
  }),
  P({
    id: 'prop-pc-tier2', name: 'Kompakt 2000', category: 'prop',
    size: [0.20, 0.42, 0.45], colorable: false,
    tags: ['hero', 'computer', 'tier2'],
    note: 'Tier 2 desktop: putty mini-tower, CD tray, vent grille.',
  }),
  P({
    id: 'prop-pc-tier3', name: 'Sunstation Pro', category: 'prop',
    size: [0.24, 0.46, 0.50], colorable: false,
    tags: ['hero', 'computer', 'tier3'],
    note: 'Tier 3 workstation: graphite tower with a handle and a slotted front.',
  }),
  P({
    id: 'prop-pc-tier4', name: 'Melon Studio M5', category: 'prop',
    size: [0.20, 0.20, 0.20], colorable: false,
    tags: ['hero', 'computer', 'tier4'],
    note: 'Tier 4: a small brushed cube. The joke is that it is almost all air.',
  }),
  P({
    id: 'prop-plotter', name: 'Roll plotter', category: 'prop',
    size: [1.35, 1.05, 0.62], colorable: false,
    tags: ['hero', 'studio'],
    note: 'A0 roll plotter on legs: body at 0.75, paper roll under it, catch basket.',
  }),
  P({
    id: 'prop-arch-model', name: 'Model on a base', category: 'prop',
    size: [0.60, 0.28, 0.45], colorable: false,
    tags: ['hero', 'studio', 'desk'],
    note: 'Chipboard massing model on a base board: five blocks, a road, two trees.',
  }),
  P({
    id: 'prop-corkboard', name: 'Corkboard', category: 'prop',
    size: [1.20, 0.90, 0.05], anchor: 'wall', mount: 1.00, colorable: false,
    tags: ['hero', 'studio', 'brief'],
    note: 'Where the brief is pinned. Frame, cork face, four pinned sheets.',
  }),
  P({
    id: 'prop-mug', name: 'Mug', category: 'prop',
    size: [0.115, 0.095, 0.082], colorable: true,
    tags: ['hero', 'desk', 'coffee'],
    note: 'Carried from the coffee machine. Handle on +x, coffee surface inside.',
  }),
];

export default EXTRA_PROPS;
