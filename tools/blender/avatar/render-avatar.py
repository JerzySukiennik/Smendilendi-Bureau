"""render-avatar.py -- look at an exported avatar GLB, in Blender, from the file.

    Blender -b -P tools/blender/avatar/render-avatar.py -- --glb assets/avatars/avatar-regular.glb \
        --out progress/shots/x.png --clip walk --t 0.25 --top hoodie --bottom tracksuit \
        --shoes trainers --hair short --extras cap,glasses --colors top=2f5d8a,... [--cols 4]

Renders a contact sheet: `--frames N` evenly spaced frames of the clip, from a
3/4 front view at office eye height, Workbench flat shading. This reads the
GLB back through the importer, so what is rendered is what shipped.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = {'glb': 'assets/avatars/avatar-regular.glb', 'out': 'progress/shots/avatar-test.png', 'clip': 'walk',
       'top': 'hoodie', 'bottom': 'tracksuit', 'shoes': 'trainers', 'hair': 'short', 'extras': '',
       'colors': 'top=3a6ea5,bottom=8a8f96,shoes=e6e2d8,hair=3a2c22,skin=d8b48c,extra=c8452b',
       'frames': '6', 'cols': '6', 'size': '420', 'view': 'front', 'dist': '3.2', 'height': '1.0', 'look': '0.88'}
i = 0
while i < len(argv):
    if argv[i].startswith('--'):
        opt[argv[i][2:]] = argv[i + 1]; i += 2
    else:
        i += 1

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=opt['glb'])
scene = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

show = {'body', 'face', f"top_{opt['top']}", f"bottom_{opt['bottom']}", f"shoes_{opt['shoes']}", f"hair_{opt['hair']}"}
show |= {f'extra_{e}' for e in opt['extras'].split(',') if e}
if opt['bottom'] == 'skirt':
    show.add('body_legs')
if opt['top'] == 'tshirt':
    show.add('body_arms')
for m in meshes:
    base = m.name.split('.')[0]
    m.hide_render = base not in show
    m.hide_viewport = m.hide_render

cols = {}
for kv in opt['colors'].split(','):
    k, v = kv.split('=')
    cols[k] = tuple(int(v[j:j + 2], 16) / 255 for j in (0, 2, 4))
def lin(c):
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)
for mat in bpy.data.materials:
    slot = mat.name.split('.')[0]
    key = slot.replace('tint_', '') if slot.startswith('tint_') else slot
    if key in cols and mat.use_nodes:
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*lin(cols[key]), 1.0)
    # Workbench reads the viewport colour
    if key in cols:
        mat.diffuse_color = (*lin(cols[key]), 1.0)
    elif slot == 'dark':
        mat.diffuse_color = (0.02, 0.018, 0.016, 1)
    elif slot == 'light':
        mat.diffuse_color = (0.9, 0.85, 0.75, 1)

# choose the clip
act = bpy.data.actions.get(opt['clip'])
if act is None:
    print('actions:', [a.name for a in bpy.data.actions]); raise SystemExit('no such clip')
if arm.animation_data is None:
    arm.animation_data_create()
for tr in arm.animation_data.nla_tracks:
    tr.mute = True
arm.animation_data.action = act
if hasattr(act, 'slots') and len(act.slots):
    arm.animation_data.action_slot = act.slots[0]
fr = act.frame_range
nfr = int(opt['frames'])
fps = scene.render.fps

# floor + light
bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
floor = bpy.context.object
fm = bpy.data.materials.new('floor'); fm.diffuse_color = (0.75, 0.72, 0.66, 1); floor.data.materials.append(fm)
if opt['clip'] in ('sit', 'sit_idle', 'type'):
    # a chair seat at 0.45 and a desk top at 0.74 so the posture can be judged
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.43)); seat = bpy.context.object; seat.scale = (0.46, 0.46, 0.04)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.0, 0.2)); post = bpy.context.object; post.scale = (0.05, 0.05, 0.42)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.24, 0.65)); back = bpy.context.object; back.scale = (0.44, 0.03, 0.4)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.65, 0.725)); desk = bpy.context.object; desk.scale = (1.6, 0.7, 0.03)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.45, 0.75)); kb = bpy.context.object; kb.scale = (0.44, 0.15, 0.02)
    dm = bpy.data.materials.new('desk'); dm.diffuse_color = (0.6, 0.45, 0.3, 1)
    for o in (seat, post, back, desk, kb):
        o.data.materials.append(dm)

scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_shadows = True
sh.shadow_intensity = 0.35
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.curvature_ridge_factor = 0.6
sh.curvature_valley_factor = 0.9
scene.display.render_aa = '8'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('w'); scene.world.color = (0.92, 0.90, 0.86)
size = int(opt['size'])
scene.render.resolution_x = size
scene.render.resolution_y = int(size * 1.35)
scene.render.image_settings.file_format = 'PNG'

cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 50
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
d = float(opt['dist'])
h = float(opt['height'])
views = {'front': (0.75, -1), 'side': (1.55, -1), 'back': (2.5, -1), 'threeq': (0.6, -1), 'left': (-0.75, -1)}
ang = views[opt['view']][0]
# in Blender, item +Z forward = -Y. Camera in front means -Y.
cam.location = (math.sin(ang) * d, -math.cos(ang) * d, h)
look = Vector((0, 0, float(opt['look'])))
direction = look - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

tmp = Path(opt['out']).with_suffix('')
files = []
for k in range(nfr):
    f = fr[0] + (fr[1] - fr[0]) * (k / max(1, nfr - 1)) * (0.999 if nfr > 1 else 0)
    if opt.get('t') is not None:
        f = fr[0] + float(opt['t']) * fps
    scene.frame_set(int(round(f)))
    scene.render.filepath = f'{tmp}_{k}.png'
    bpy.ops.render.render(write_still=True)
    files.append(scene.render.filepath)
    if opt.get('t') is not None:
        break

# contact sheet
import subprocess
ncol = min(int(opt['cols']), len(files))
nrow = math.ceil(len(files) / ncol)
try:
    from PIL import Image  # noqa
    have_pil = True
except Exception:
    have_pil = False
W, Hh = scene.render.resolution_x, scene.render.resolution_y
img = bpy.data.images.new('sheet', W * ncol, Hh * nrow)
px = [0.0] * (W * ncol * Hh * nrow * 4)
for idx, fpath in enumerate(files):
    im = bpy.data.images.load(fpath)
    src = list(im.pixels)
    r, c = divmod(idx, ncol)
    r = nrow - 1 - r
    for y in range(Hh):
        so = y * W * 4
        do = ((r * Hh + y) * (W * ncol) + c * W) * 4
        px[do:do + W * 4] = src[so:so + W * 4]
    bpy.data.images.remove(im)
    Path(fpath).unlink()
img.pixels = px
img.filepath_raw = opt['out']
img.file_format = 'PNG'
img.save()
print('wrote', opt['out'], f'{W*ncol}x{Hh*nrow}', 'frames', len(files), 'of', act.name, fr)
