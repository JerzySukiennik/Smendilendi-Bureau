"""mats.py -- material slots for exported GLBs.

ONE MATERIAL SLOT PER COLOUR REGION. The slot named `tint` is the region the
player's colour multiplies; its base colour is therefore near-white, because the
runtime multiplies an instance colour into it (see src/core/assets.js, which maps
the proc-shapes slot `primary` to the white `flat` material for the same reason).

Slot names here are the CONTRACT the runtime reads. They deliberately match the
proc-shapes SLOTS vocabulary where they overlap, so swapping a placeholder solid
for a real GLB never changes an item's colour:

    proc-shapes slot     GLB material name     what it is
    primary          ->  tint                  the tintable region
    secondary        ->  wood                  timber carcase / legs
    accent           ->  accent                worktops, seat pads, sills
    metal            ->  metal                 steel, chrome, aluminium
    glass            ->  glass                 glazing
    fabric           ->  fabric                upholstery
    ceramic          ->  ceramic               sanitaryware
    foliage          ->  foliage               leaves

plus a few slots the placeholders never needed:

    chrome    bright polished steel (taps, group heads, castors)
    graphite  near-black machine bodies and screens
    soil      potting compost
    stem      woody plant stems
    rubber    castor tyres, feet, gaskets

Colours and roughness come from src/core/palette.js via dump-catalog.mjs, so the
GLBs and the runtime palette can never drift apart.
"""

import bpy

# slot -> (palette material class, override colour or None, override roughness,
#          metallic, double sided)
SLOTS = {
    'tint':     ('flat',          0xFFFFFF, 0.72, 0.0, False),
    'wood':     ('wood-mid',      None,     None, 0.0, False),
    'woodDark': ('wood-dark',     None,     None, 0.0, False),
    'accent':   ('accent',        None,     None, 0.0, False),
    'metal':    ('metal',         None,     0.40, 0.85, False),
    'chrome':   ('metal',         0xD8DCE0, 0.12, 1.00, False),
    'graphite': ('ink',           0x2B2E33, 0.42, 0.10, False),
    'glass':    ('glass',         None,     0.05, 0.0, False),
    'fabric':   ('flat',          0x6E7583, 0.95, 0.0, False),
    'ceramic':  ('tile',          0xF6F7F4, 0.20, 0.0, False),
    'foliage':  ('grass',         0x5C8F4E, 0.85, 0.0, True),
    'foliage2': ('grass',         0x74A85C, 0.85, 0.0, True),
    'foliage3': ('grass',         0x3F6B3C, 0.85, 0.0, True),
    'soil':     ('soil',          None,     1.00, 0.0, False),
    'stem':     ('wood-dark',     0x6B5A3E, 0.80, 0.0, False),
    'rubber':   ('ink',           0x1F2124, 0.85, 0.0, False),
    'paper':    ('paper',         None,     None, 0.0, False),
}


def _rgb(hexval):
    return (
        ((hexval >> 16) & 255) / 255.0,
        ((hexval >> 8) & 255) / 255.0,
        (hexval & 255) / 255.0,
    )


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_material(slot, palette):
    """Get or create the Blender material for a slot name."""
    if slot in bpy.data.materials:
        return bpy.data.materials[slot]
    if slot not in SLOTS:
        raise KeyError(f'unknown material slot "{slot}" -- add it to mats.SLOTS')

    cls_name, color_override, rough_override, metallic, double_sided = SLOTS[slot]
    cls = (palette.get('classes') or {}).get(cls_name, {})
    hexval = color_override if color_override is not None else cls.get('color', 0xCCCCCC)
    rough = rough_override if rough_override is not None else cls.get('roughness', 0.7)
    if metallic == 0.0:
        metallic = cls.get('metalness', 0.0)

    mat = bpy.data.materials.new(slot)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    r, g, b = (_srgb_to_linear(c) for c in _rgb(hexval))
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = float(rough)
    bsdf.inputs['Metallic'].default_value = float(metallic)
    if slot == 'glass':
        bsdf.inputs['Alpha'].default_value = 0.35
        mat.blend_method = 'BLEND'
    mat.use_backface_culling = not double_sided
    return mat
