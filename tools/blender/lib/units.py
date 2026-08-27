"""units.py -- the coordinate contract, in one place.

THE CONVENTION (documented in tools/blender/README.md, binding on every later agent)

  * Metres. Radians. No scene unit scaling, no parent transforms, scale applied.
  * ITEM SPACE, which is what the GLB contains and what the game sees:
        +X  width,  to the item's right
        +Y  up
        +Z  FORWARD -- the direction a chair faces, the side a wardrobe's doors
            open towards, the side a WC is approached from.
    Origin:
        anchor 'floor'    X and Z centred on the footprint, Y = 0 at the base.
        anchor 'wall'     X centred, Y = 0 at the item's own base (the catalogue
                          `mount` says how high that sits), Z = 0 AT THE WALL FACE
                          with the item extending towards +Z, into the room.
        anchor 'ceiling'  X and Z centred, Y = 0 at the ceiling, item hanging
                          DOWN into -Y.
  * BLENDER SPACE is Z-up, and the glTF exporter is run with export_yup=True,
    which rewrites Blender (x, y, z) as glTF (x, z, -y). Composing the two, an
    item-space point maps into Blender as

        blender = (x, -z, y)

    which is the ordinary Blender convention of "the front of the object faces -Y"
    (numpad-1 Front view looks along +Y). So the models look right in the viewport
    AND come out of the exporter in item space. Every family script is written in
    ITEM space; ITEM_TO_BLENDER is applied once, inside the Shape builder.
"""

import math

from mathutils import Matrix

# item (x, y, z) -> blender (x, -z, y)
ITEM_TO_BLENDER = Matrix((
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 0.0, -1.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
))

BLENDER_TO_ITEM = ITEM_TO_BLENDER.inverted()

# a cylinder primitive is created along its local +Z; this stands it up along item +Y
CYL_UP = Matrix.Rotation(-math.pi / 2, 4, 'X')


def to_blender(p):
    """An item-space (x, y, z) tuple in Blender coordinates."""
    return (p[0], -p[2], p[1])


def to_item(p):
    """A Blender-space (x, y, z) tuple in item coordinates."""
    return (p[0], p[2], -p[1])


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def lerp(a, b, t):
    return a + (b - a) * t
