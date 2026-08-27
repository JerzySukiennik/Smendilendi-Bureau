"""render-sheet.py -- a labelled contact sheet of the exported GLBs.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/render-sheet.py -- \
        --out progress/shots/catalogue-rework.png [--tile 560] [ids...]

Project rule: never report on a model nobody has looked at. So the build is not
finished until this has run and the image has been opened.

The lighting is the game's, not a studio's -- one warm key `DirectionalLight`
plus a cool hemisphere, the pair described in ARCHITECTURE.md under "Look", with
Filmic tone mapping standing in for the runtime's ACES. The camera sits at
office eye height (1.60 m) so pieces are judged the way the player meets them,
and a 1.75 m figure stands beside each one, because "za maly" is a judgement
about a thing next to a person and cannot be made from a number.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'lib'))

EYE = 1.60
FIGURE_H = 1.75


def clear():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.cameras, bpy.data.lights, bpy.data.curves, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def add_box(name, size, loc, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(material)
    return ob


def scale_figure(x):
    """A 1.75 m person as simple volumes. Not art -- a ruler you can recognise.

    Blender is Z-up here: sizes are (width, depth, HEIGHT). Getting that pair the
    wrong way round is how the first sheet came back with the figure lying in
    mid-air, which is also how it was caught -- by looking at the picture.
    """
    skin = mat('fig', (0.40, 0.42, 0.46), 0.9)
    add_box('fig-legs', (0.34, 0.22, 0.86), (x, 0.0, 0.43), skin)
    add_box('fig-torso', (0.44, 0.24, 0.60), (x, 0.0, 1.16), skin)
    add_box('fig-neck', (0.12, 0.12, 0.07), (x, 0.0, 1.49), skin)
    add_box('fig-head', (0.19, 0.22, 0.24), (x, 0.0, 1.63), skin)
    add_box('fig-arm-l', (0.10, 0.12, 0.58), (x - 0.27, 0.0, 1.15), skin)
    add_box('fig-arm-r', (0.10, 0.12, 0.58), (x + 0.27, 0.0, 1.15), skin)


def label(text, cam, y_local, size, colour):
    """Caption pinned to the camera, so the ground plane can never hide it."""
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = text
    t.data.size = size
    t.data.align_x = 'CENTER'
    t.data.materials.append(colour)
    t.parent = cam
    # local to the camera: -Z forward, +Y up. matrix_parent_inverse is left at
    # identity on purpose -- setting it to the camera's inverse would make this
    # location a WORLD one, which is how the first sheet buried its captions
    # under the floor.
    t.location = (0.0, y_local, -1.0)
    t.rotation_euler = (0, 0, 0)
    return t


def setup_world():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium Contrast'
    scene.eevee.use_raytracing = True
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.62, 0.68, 0.78, 1)     # the cool hemisphere
    bg.inputs[1].default_value = 0.85
    scene.world = world

    bpy.ops.object.light_add(type='SUN', location=(3, -4, 6))
    key = bpy.context.object
    key.data.energy = 3.4
    key.data.angle = math.radians(6)
    key.data.color = (1.0, 0.94, 0.84)                     # the warm key
    key.rotation_euler = (math.radians(52), 0, math.radians(38))
    bpy.ops.object.light_add(type='AREA', location=(-4, -3, 3))
    fill = bpy.context.object
    fill.data.energy = 90
    fill.data.size = 6
    fill.data.color = (0.86, 0.90, 1.0)
    fill.rotation_euler = (math.radians(66), 0, math.radians(-52))


def render_one(glb, item, tile, out_png):
    clear()
    setup_world()
    ground = mat('ground', (0.74, 0.72, 0.69), 0.95)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.object.data.materials.append(ground)

    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in imported:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    size = hi - lo
    # ceiling-anchored items hang from a soffit: give them one to hang from
    if item.get('anchor') == 'ceiling':
        for ob in imported:
            ob.location.z += 2.60
        lo.z += 2.60
        hi.z += 2.60
        add_box('soffit', (2.4, 2.4, 0.10), (0, 0, 2.65),
                mat('soffit', (0.86, 0.85, 0.82), 0.95))

    figure_x = hi.x + 0.62
    scale_figure(figure_x)

    span_x = max(hi.x, figure_x + 0.35) - min(lo.x, figure_x - 0.35)
    span_z = max(hi.z, FIGURE_H)
    target = Vector(((min(lo.x, figure_x - 0.35) + max(hi.x, figure_x + 0.35)) / 2,
                     (lo.y + hi.y) / 2, span_z * 0.54))
    # frame it properly: a 50 mm lens on a 36 mm sensor sees 2*atan(18/50) = 39.6
    # degrees, so the distance that actually fits `span` is span / (2 tan(fov/2)).
    fov = 2 * math.atan(18.0 / 50.0)
    radius = max(span_x, span_z, 0.9) / (2 * math.tan(fov / 2)) * 1.22
    yaw = math.radians(-34)
    cam_z = EYE if span_z < 2.2 else span_z * 0.72
    cam_pos = target + Vector((math.sin(yaw) * -radius, -math.cos(yaw) * radius, 0))
    cam_pos.z = cam_z
    bpy.ops.object.camera_add(location=cam_pos)
    cam = bpy.context.object
    cam.data.lens = 50
    d = target - cam_pos
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam

    ink = mat('ink', (0.05, 0.05, 0.06), 0.9)
    ink.use_nodes = True
    ink.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.05, 0.05, 0.06, 1)
    ink.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.0
    label(item['id'], cam, -0.290, 0.028, ink)
    label(f"{size.x:.2f} w x {size.z:.2f} h x {size.y:.2f} d m    "
          f"{item.get('tris', '?')} tris    {item.get('parts', '?')} parts, "
          f"{item.get('bodies', '?')} body", cam, -0.325, 0.019, ink)

    scene = bpy.context.scene
    scene.render.resolution_x = tile
    scene.render.resolution_y = tile
    scene.render.filepath = str(out_png)
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--tile', type=int, default=560)
    ap.add_argument('--cols', type=int, default=0)
    ap.add_argument('ids', nargs='*')
    args = ap.parse_args(argv)

    report = json.loads((HERE / '_tmp' / 'build-report.json').read_text())
    built = {b['id']: b for b in report['built']}
    ids = args.ids or list(built)
    tmp = HERE / '_tmp' / 'tiles'
    tmp.mkdir(parents=True, exist_ok=True)

    tiles = []
    for item_id in ids:
        b = built.get(item_id)
        if not b:
            print(f'  skip {item_id}: not in the build report')
            continue
        png = tmp / f'{item_id}.png'
        render_one(ROOT / 'assets' / 'models' / f'{item_id}.glb',
                   {'id': item_id, 'anchor': b['anchor'], 'tris': b['tris'],
                    'parts': b['parts'], 'bodies': b['components']},
                   args.tile, png)
        tiles.append(png)
        print(f'  rendered {item_id}')

    cols = args.cols or (4 if len(tiles) > 9 else 3)
    rows = math.ceil(len(tiles) / cols)
    t = args.tile
    sheet = np.ones((rows * t, cols * t, 4), dtype=np.float32)
    for i, png in enumerate(tiles):
        img = bpy.data.images.load(str(png))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        px = px[::-1]                                    # Blender images are bottom-up
        r, c = divmod(i, cols)
        sheet[r * t:(r + 1) * t, c * t:(c + 1) * t] = px
        bpy.data.images.remove(img)
    # 2 px rules between tiles so the eye separates them
    for r in range(1, rows):
        sheet[r * t - 1:r * t + 1, :, :3] = 0.80
    for c in range(1, cols):
        sheet[:, c * t - 1:c * t + 1, :3] = 0.80

    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.data.images.new('sheet', width=cols * t, height=rows * t, alpha=True)
    result.pixels = sheet[::-1].ravel().tolist()
    result.filepath_raw = str(out)
    result.file_format = 'PNG'
    result.save()
    print(f'wrote {out}  ({cols * t} x {rows * t}, {len(tiles)} tiles)')


main()
