"""build-avatars.py -- the parametric, rigged, animated low-poly humanoid.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/avatar/build-avatars.py \
        -- [--out assets/avatars] [--builds slim,regular,broad] [--fps 30]

One GLB per BODY BUILD. Every outfit piece is in the file as a separately
named skinned mesh (the runtime shows/hides them), every colour region is a
material slot named for the tint it takes (the runtime multiplies the player's
colour in), and the clips are exported as named glTF animations.

The coordinate contract is the catalogue's (tools/blender/README.md): metres,
+X right, +Y up, +Z forward, origin on the floor between the feet, transforms
applied. Everything in this file is written in ITEM space; ITEM_TO_BLENDER is
applied once when meshes and bones are created.

Why it looks like a person and not a mannequin
----------------------------------------------
Proportions are taken from real landmarks as fractions of stature (hip joint at
0.53 H, knee 0.30 H, shoulder 0.81 H, chin 0.87 H, fingertips 0.43 H). The feet
in the walk are PLANTED: the stance foot is solved with a two-bone analytic IK
against a contact point that moves backwards at exactly the clip's speed, with
a heel-strike and a toe-off rolling about the heel and toe. The cloth pieces
(tracksuit legs, hoodie hem, skirt) carry SECONDARY BONES whose rotation is a
damped spring driven by the parent limb's angular acceleration, integrated
offline here, so the fabric lags and overshoots the leg instead of being a
rigid tube.

Bone names use underscores, never dots: three.js strips '.' from node names when
it binds animation tracks, and `thigh.L` would silently become `thighL`.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

# ---------------------------------------------------------------------------
# coordinate contract (mirrors tools/blender/lib/units.py)

ITEM_TO_BLENDER = Matrix((
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 0.0, -1.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
))


def to_b(p):
    return Vector((p[0], -p[2], p[1]))


TAU = math.pi * 2
FPS = 30

# ---------------------------------------------------------------------------
# material slots. Tint slots are near-white: the runtime multiplies the colour in.

SLOTS = {
    # name        colour     rough  metal
    'skin':        (0xFFFFFF, 0.80, 0.0),
    'tint_top':    (0xFFFFFF, 0.90, 0.0),
    'tint_bottom': (0xFFFFFF, 0.90, 0.0),
    'tint_shoes':  (0xFFFFFF, 0.70, 0.0),
    'tint_hair':   (0xFFFFFF, 0.85, 0.0),
    'tint_extra':  (0xFFFFFF, 0.80, 0.0),
    'dark':        (0x2B2825, 0.60, 0.0),   # eyes, brows, mouth, soles, frames
    'light':       (0xF3ECE1, 0.80, 0.0),   # trainer soles, drawstrings, stripes
}


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(slot):
    if slot in bpy.data.materials:
        return bpy.data.materials[slot]
    hexval, rough, metal = SLOTS[slot]
    mat = bpy.data.materials.new(slot)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    rgb = [((hexval >> s) & 255) / 255.0 for s in (16, 8, 0)]
    bsdf.inputs['Base Color'].default_value = (*[_srgb_to_linear(c) for c in rgb], 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    mat.use_backface_culling = True
    return mat


# ---------------------------------------------------------------------------
# body builds -- the parametric space. Every length is metres; `H` is stature.

BUILDS = {
    'slim':    dict(H=1.72, shoulder=0.195, chest=(0.31, 0.19), belly=(0.27, 0.17), hip=(0.30, 0.20), limb=0.88, hip_x=0.085, head=0.97),
    'regular': dict(H=1.75, shoulder=0.215, chest=(0.36, 0.22), belly=(0.32, 0.20), hip=(0.34, 0.21), limb=1.00, hip_x=0.095, head=1.00),
    'broad':   dict(H=1.775, shoulder=0.240, chest=(0.42, 0.26), belly=(0.40, 0.25), hip=(0.38, 0.23), limb=1.15, hip_x=0.105, head=1.03),
}


class Proportions:
    """Landmarks as fractions of stature, so a build is a height plus a few widths."""

    def __init__(self, b):
        H = b['H']
        self.H = H
        self.b = b
        self.head_top = H
        self.chin = 0.874 * H
        self.head_c = 0.937 * H           # centre of the head box
        self.neck_base = 0.822 * H
        self.shoulder_y = 0.811 * H
        self.chest_top = 0.826 * H
        self.chest_bot = 0.686 * H
        self.belly_bot = 0.583 * H
        self.pelvis_bot = 0.491 * H
        self.hip_y = 0.531 * H            # hip joint
        self.knee_y = 0.297 * H
        self.ankle_y = 0.051 * H
        self.shoulder_x = b['shoulder']
        self.elbow_y = 0.651 * H
        self.wrist_y = 0.491 * H
        self.hand_end = 0.446 * H
        self.finger_end = 0.411 * H
        self.hip_x = b['hip_x']
        self.limb = b['limb']
        self.head_scale = b['head']
        self.L1 = self.hip_y - self.knee_y
        self.L2 = self.knee_y - self.ankle_y
        self.A1 = self.shoulder_y - self.elbow_y
        self.A2 = self.elbow_y - self.wrist_y
        self.foot_len = 0.26
        self.heel = -0.06                 # z of the heel relative to the ankle
        self.toe = 0.20                   # z of the toe relative to the ankle


# ---------------------------------------------------------------------------
# skeleton definition, in item space: (head, tail, parent, local-Z direction)

def skeleton(P):
    sx, hx = P.shoulder_x, P.hip_x
    B = {}
    up, fwd, back, right, left = (0, 1, 0), (0, 0, 1), (0, 0, -1), (1, 0, 0), (-1, 0, 0)
    B['hips'] = ((0, P.hip_y, 0), (0, P.belly_bot + 0.02, 0), None, fwd)
    B['spine'] = ((0, P.belly_bot + 0.02, 0), (0, P.chest_bot, 0), 'hips', fwd)
    B['chest'] = ((0, P.chest_bot, 0), (0, P.shoulder_y, 0), 'spine', fwd)
    B['neck'] = ((0, P.shoulder_y, 0), (0, P.chin, 0), 'chest', fwd)
    B['head'] = ((0, P.chin, 0), (0, P.head_top, 0), 'neck', fwd)
    for s, sg in (('L', -1), ('R', 1)):
        x = sg * sx
        B[f'shoulder_{s}'] = ((sg * 0.04, P.shoulder_y, 0), (x, P.shoulder_y, 0), 'chest', fwd)
        B[f'upperarm_{s}'] = ((x, P.shoulder_y, 0), (x, P.elbow_y, 0), f'shoulder_{s}', fwd)
        B[f'forearm_{s}'] = ((x, P.elbow_y, 0), (x, P.wrist_y, 0), f'upperarm_{s}', fwd)
        B[f'hand_{s}'] = ((x, P.wrist_y, 0), (x, P.hand_end, 0), f'forearm_{s}', fwd)
        B[f'fingersA_{s}'] = ((x - sg * 0.019, P.hand_end, 0), (x - sg * 0.019, P.finger_end, 0), f'hand_{s}', fwd)
        B[f'fingersB_{s}'] = ((x + sg * 0.019, P.hand_end, 0), (x + sg * 0.019, P.finger_end, 0), f'hand_{s}', fwd)
        hxx = sg * hx
        B[f'thigh_{s}'] = ((hxx, P.hip_y, 0), (hxx, P.knee_y, 0), 'hips', fwd)
        B[f'shin_{s}'] = ((hxx, P.knee_y, 0), (hxx, P.ankle_y, 0), f'thigh_{s}', fwd)
        B[f'foot_{s}'] = ((hxx, P.ankle_y, -0.02), (hxx, 0.02, P.toe - 0.02), f'shin_{s}', up)
        B[f'pant_up_{s}'] = ((hxx, P.hip_y, 0), (hxx, P.knee_y, 0), f'thigh_{s}', fwd)
        B[f'pant_lo_{s}'] = ((hxx, P.knee_y, 0), (hxx, P.ankle_y, 0), f'shin_{s}', fwd)
    hem_y = P.belly_bot + 0.02
    B['hem_F'] = ((0, hem_y, 0.12), (0, hem_y - 0.14, 0.12), 'spine', fwd)
    B['hem_B'] = ((0, hem_y, -0.12), (0, hem_y - 0.14, -0.12), 'spine', back)
    sk_y = P.belly_bot + 0.02
    sk_end = 0.33 * P.H
    B['skirt_F'] = ((0, sk_y, 0.14), (0, sk_end, 0.20), 'hips', fwd)
    B['skirt_B'] = ((0, sk_y, -0.14), (0, sk_end, -0.20), 'hips', back)
    B['skirt_L'] = ((-0.17, sk_y, 0), (-0.24, sk_end, 0), 'hips', left)
    B['skirt_R'] = ((0.17, sk_y, 0), (0.24, sk_end, 0), 'hips', right)
    return B


def make_armature(name, bones):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, (h, t, parent, zdir) in bones.items():
        b = arm.edit_bones.new(n)
        b.head = to_b(h)
        b.tail = to_b(t)
        b.align_roll(to_b(zdir))
        eb[n] = b
    for n, (h, t, parent, zdir) in bones.items():
        if parent:
            eb[n].parent = eb[parent]
            eb[n].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'XYZ'
    arm.display_type = 'STICK'
    return ob


# ---------------------------------------------------------------------------
# mesh primitives, item space, with rigid or gradient bone binding

BEVEL_ANGLE = math.radians(50)


class Piece:
    """One exported object: a list of parts, each a bmesh with a material slot
    and a vertex-weight function."""

    def __init__(self, name):
        self.name = name
        self.parts = []      # (bm, slot, weights: list of dict bone->w per vert)

    def add(self, bm, slot, bind):
        """`bind` is a bone name (rigid) or a callable(item_pos) -> {bone: w}."""
        bm.verts.ensure_lookup_table()
        weights = []
        for v in bm.verts:
            if callable(bind):
                weights.append(bind(v.co))
            else:
                weights.append({bind: 1.0})
        self.parts.append((bm, slot, weights))


def _bevel(bm, amt, seg=1, angle=BEVEL_ANGLE):
    if amt <= 0:
        return
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) >= angle]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=amt, offset_type='OFFSET', segments=seg,
                        profile=0.5, affect='EDGES', clamp_overlap=True, loop_slide=True)


def tbox(wb, wt, h, db, dt, pos, bevel=0.012, seg=1, rot=None):
    """A box whose bottom is (wb x db) and top (wt x dt); pos = (cx, base_y, cz)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        t = v.co.y + 0.5
        x = v.co.x * (wb + (wt - wb) * t)
        z = v.co.z * (db + (dt - db) * t)
        v.co = Vector((x, t * h, z))
    _bevel(bm, bevel, seg)
    if rot is not None:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(pos))
    return bm


def box(w, h, d, pos, bevel=0.012, seg=1, rot=None, cuts=0):
    bm = tbox(w, w, h, d, d, pos, bevel, seg, rot)
    if cuts:
        vertical = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) > 0.9]
        bmesh.ops.subdivide_edges(bm, edges=vertical, cuts=cuts, use_grid_fill=True)
    return bm


def cyl(r_bot, r_top, h, pos, seg=8, bevel=0.010, cap=True, sx=1.0, sz=1.0, cuts=0):
    """A vertical (item +Y) cone/cylinder; pos = (cx, base_y, cz)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg,
                          radius1=r_bot, radius2=r_top, depth=h)
    # blender cone axis is Z: rotate Z->Y (item up), then lift base to 0
    rot = Matrix.Rotation(-math.pi / 2, 3, 'X')
    for v in bm.verts:
        p = rot @ v.co
        v.co = Vector((p.x * sx, p.y + h / 2, p.z * sz))
    if cap:
        _bevel(bm, bevel, 1, angle=math.radians(60))
    if cuts:
        vertical = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) > 0.9]
        bmesh.ops.subdivide_edges(bm, edges=vertical, cuts=cuts, use_grid_fill=True)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(pos))
    return bm


def gradient(bone_top, bone_bot, y_top, y_bot):
    """Weights that go from bone_top at y_top to bone_bot at y_bot."""
    def f(p):
        t = (y_top - p.y) / (y_top - y_bot)
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        if t <= 0:
            return {bone_top: 1.0}
        if t >= 1:
            return {bone_bot: 1.0}
        return {bone_top: 1.0 - t, bone_bot: t}
    return f


def bulge(bone_fix, bone_cloth, y_top, y_bot, peak=0.5):
    """Weights fixed to bone_fix at both ends and swinging on bone_cloth in the
    middle: the cuff stays on the ankle, the fabric between bows out."""
    def f(p):
        t = (y_top - p.y) / (y_top - y_bot)
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        w = math.sin(math.pi * (t ** (math.log(0.5) / math.log(peak))))
        w = max(0.0, min(1.0, w))
        if w < 0.02:
            return {bone_fix: 1.0}
        return {bone_fix: 1.0 - w, bone_cloth: w}
    return f


def skirt_bind(y_top, y_bot):
    def f(p):
        t = (y_top - p.y) / (y_top - y_bot)
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        if t <= 0.02:
            return {'hips': 1.0}
        ang = math.atan2(p.x, p.z)
        w = {
            'skirt_F': max(0.0, math.cos(ang)),
            'skirt_B': max(0.0, -math.cos(ang)),
            'skirt_R': max(0.0, math.sin(ang)),
            'skirt_L': max(0.0, -math.sin(ang)),
        }
        tot = sum(w.values()) or 1.0
        out = {k: v / tot * t for k, v in w.items() if v > 0}
        out['hips'] = 1.0 - t
        return out
    return f


# ---------------------------------------------------------------------------
# the body and the outfit pieces

def build_body(P):
    b = P.b
    (cw, cd), (bw, bd), (hw, hd) = b['chest'], b['belly'], b['hip']
    lim = P.limb
    hs = P.head_scale
    body = Piece('body')
    face = Piece('face')
    arms = Piece('body_arms')
    legs = Piece('body_legs')

    # head: a softly rounded box, chin at P.chin
    head_h = P.head_top - P.chin
    hw_, hd_ = 0.16 * hs, 0.19 * hs
    body.add(box(hw_, head_h, hd_, (0, P.chin, 0), bevel=0.034, seg=2), 'skin', 'head')
    body.add(cyl(0.048 * hs, 0.044 * hs, P.chin + 0.02 - (P.shoulder_y - 0.02),
                 (0, P.shoulder_y - 0.02, -0.005)), 'skin', 'neck')
    # torso: three stacked boxes, pelvis / belly / chest, shoulders rounded
    body.add(tbox(hw, bw, P.belly_bot - P.pelvis_bot + 0.03, hd, bd, (0, P.pelvis_bot, 0), 0.02), 'skin', 'hips')
    body.add(tbox(bw, cw * 0.96, P.chest_bot - P.belly_bot + 0.03, bd, cd * 0.96, (0, P.belly_bot - 0.01, 0), 0.018), 'skin', 'spine')
    body.add(tbox(cw * 0.96, cw, P.chest_top - P.chest_bot, cd * 0.96, cd, (0, P.chest_bot - 0.01, 0), 0.03), 'skin', 'chest')

    # face features
    fz = hd_ / 2
    ey = P.head_c + 0.025 * hs
    for sg in (-1, 1):
        face.add(box(0.024, 0.017, 0.012, (sg * 0.034 * hs, ey - 0.0085, fz - 0.004), 0.0), 'dark', 'head')
        face.add(box(0.036, 0.008, 0.010, (sg * 0.034 * hs, ey + 0.016, fz - 0.003), 0.0), 'dark', 'head')
        body.add(box(0.012, 0.032, 0.024, (sg * (hw_ / 2 + 0.004), P.head_c - 0.01, -0.01), 0.004), 'skin', 'head')
    body.add(tbox(0.018, 0.024, 0.032, 0.014, 0.022, (0, P.head_c - 0.022, fz - 0.002), 0.004), 'skin', 'head')
    face.add(box(0.036, 0.006, 0.008, (0, P.head_c - 0.045 * hs, fz - 0.002), 0.0), 'dark', 'head')

    # arms
    for s, sg in (('L', -1), ('R', 1)):
        x = sg * P.shoulder_x
        ru = 0.050 * lim
        rf = 0.042 * lim
        arms.add(cyl(ru * 0.9, ru, P.A1 + 0.03, (x, P.elbow_y - 0.015, 0)), 'skin', f'upperarm_{s}')
        arms.add(cyl(rf * 0.82, rf, P.A2 + 0.02, (x, P.wrist_y - 0.01, 0)), 'skin', f'forearm_{s}')
        # hand: palm, two finger blocks, thumb
        body.add(box(0.074, P.wrist_y - P.hand_end + 0.02, 0.03, (x, P.hand_end - 0.005, 0), 0.008), 'skin', f'hand_{s}')
        for fb, off in (('A', -0.019), ('B', 0.019)):
            body.add(box(0.034, P.hand_end - P.finger_end + 0.012, 0.026,
                         (x + sg * off, P.finger_end, 0), 0.006), 'skin', f'fingers{fb}_{s}')
        body.add(box(0.022, 0.05, 0.024, (x - sg * 0.047, P.wrist_y - 0.06, 0.008), 0.006), 'skin', f'hand_{s}')

    # legs (bare, for the skirt)
    for s, sg in (('L', -1), ('R', 1)):
        x = sg * P.hip_x
        rt = 0.078 * lim
        rs = 0.058 * lim
        legs.add(cyl(rt * 0.82, rt, P.L1 + 0.05, (x, P.knee_y - 0.02, 0)), 'skin', f'thigh_{s}')
        legs.add(cyl(rs * 0.72, rs, P.L2 + 0.03, (x, P.ankle_y - 0.01, 0)), 'skin', f'shin_{s}')
    return [body, face, arms, legs]


def build_tops(P):
    b = P.b
    (cw, cd), (bw, bd) = b['chest'], b['belly']
    lim = P.limb
    out = []
    ru = 0.050 * lim
    rf = 0.042 * lim

    def torso(piece, slot, pad, top_pad, bottom_y, bevel=0.022):
        piece.add(tbox(bw + pad, cw * 0.97 + pad, P.chest_bot - bottom_y + 0.01, bd + pad, cd * 0.97 + pad,
                       (0, bottom_y, 0), bevel), slot, gradient('spine', 'hips', P.chest_bot, bottom_y))
        # the chest slots INSIDE the belly box (narrower at the overlap, 70 mm of it)
        # rather than meeting it face to face: two bevelled boxes that merely touch
        # leave a chamfered V groove, which flat shading draws as a crack.
        piece.add(tbox(cw * 0.90 + pad, cw + top_pad, P.chest_top - P.chest_bot + 0.08, cd * 0.90 + pad, cd + top_pad,
                       (0, P.chest_bot - 0.07, 0), 0.03), slot, 'chest')

    def sleeves(piece, slot, pad, long, cuff=True):
        for s, sg in (('L', -1), ('R', 1)):
            x = sg * P.shoulder_x
            if long:
                piece.add(cyl((ru + pad) * 0.92, ru + pad + 0.01, P.A1 + 0.05, (x, P.elbow_y - 0.02, 0)), slot, f'upperarm_{s}')
                piece.add(cyl((rf + pad) * 0.9, rf + pad, P.A2 + 0.02, (x, P.wrist_y - 0.005, 0)), slot, f'forearm_{s}')
            else:
                piece.add(cyl(ru + pad + 0.006, ru + pad + 0.012, 0.15, (x, P.shoulder_y - 0.13, 0)), slot, f'upperarm_{s}')

    # t-shirt: short sleeves, untucked hem just below the belt line
    t = Piece('top_tshirt')
    torso(t, 'tint_top', 0.026, 0.03, P.belly_bot - 0.02)
    sleeves(t, 'tint_top', 0.012, False)
    t.add(cyl(0.062, 0.058, 0.03, (0, P.shoulder_y - 0.005, -0.005), cap=False, bevel=0), 'tint_top', 'chest')
    out.append(t)

    # shirt: long sleeves, collar, placket
    sh = Piece('top_shirt')
    torso(sh, 'tint_top', 0.024, 0.026, P.belly_bot - 0.03)
    sleeves(sh, 'tint_top', 0.010, True)
    for sg in (-1, 1):
        sh.add(box(0.05, 0.05, 0.02, (sg * 0.032, P.shoulder_y - 0.015, cd / 2 + 0.0),
                   0.004, rot=Matrix.Rotation(sg * 0.5, 3, 'Y') @ Matrix.Rotation(-0.35, 3, 'X')), 'tint_top', 'chest')
    sh.add(box(0.024, P.chest_top - P.belly_bot + 0.02, 0.008, (0, P.belly_bot - 0.02, cd / 2 + 0.024), 0.0),
           'light', gradient('chest', 'spine', P.chest_bot + 0.03, P.belly_bot))
    out.append(sh)

    # hoodie: baggy, hem flaps on their own bones, pocket, hood, drawstrings
    h = Piece('top_hoodie')
    hem_top = P.belly_bot + 0.02
    # the torso carries on BEHIND the hem, and the hem flaps stand 7 mm proud of it:
    # a hem that merely hangs off the bottom edge opens a hollow black band the
    # moment the cloth bones swing it out.
    torso(h, 'tint_top', 0.05, 0.05, hem_top - 0.075, bevel=0.026)
    sleeves(h, 'tint_top', 0.022, True)
    flap_w = bw + 0.064
    flap_d = bd + 0.064
    # front and back hem flaps hinged at hem_top, swinging on hem_F / hem_B
    h.add(box(flap_w, 0.20, 0.03, (0, hem_top - 0.15, flap_d / 2 - 0.015), 0.01),
          'tint_top', gradient('spine', 'hem_F', hem_top + 0.05, hem_top - 0.15))
    h.add(box(flap_w, 0.20, 0.03, (0, hem_top - 0.15, -flap_d / 2 + 0.015), 0.01),
          'tint_top', gradient('spine', 'hem_B', hem_top + 0.05, hem_top - 0.15))
    for sg in (-1, 1):   # side panels stay with the hips so the hem never opens at the side
        h.add(box(0.03, 0.20, flap_d - 0.05, (sg * (flap_w / 2 - 0.015), hem_top - 0.15, 0), 0.01), 'tint_top', 'hips')
    # kangaroo pocket
    h.add(box(bw * 0.7, 0.12, 0.024, (0, hem_top + 0.055, flap_d / 2 - 0.010), 0.008), 'tint_top', 'spine')
    # hood: a collar around the back of the neck and a bag hanging on the shoulders
    h.add(box(0.22, 0.075, 0.07, (0, P.shoulder_y - 0.02, -0.10), 0.02), 'tint_top', 'chest')
    for sg in (-1, 1):
        h.add(box(0.06, 0.07, 0.14, (sg * 0.095, P.shoulder_y - 0.015, -0.03), 0.018), 'tint_top', 'chest')
    h.add(tbox(0.20, 0.26, 0.19, 0.05, 0.11, (0, P.shoulder_y - 0.19, -cd / 2 - 0.06), 0.024), 'tint_top', 'chest')
    for sg in (-1, 1):
        h.add(cyl(0.004, 0.004, 0.14, (sg * 0.03, P.shoulder_y - 0.15, cd / 2 + 0.05), seg=6, bevel=0), 'light', 'chest')
    out.append(h)
    return out


def build_bottoms(P):
    hw, hd = P.b['hip']
    lim = P.limb
    out = []
    waist = P.belly_bot + 0.02

    # tracksuit bottoms: baggy tubes on lagging bones, gathered cuff, side stripe
    tr = Piece('bottom_tracksuit')
    tr.add(tbox(hw + 0.03, hw + 0.03, waist - P.pelvis_bot + 0.005, hd + 0.03, hd + 0.03, (0, P.pelvis_bot, 0), 0.02), 'tint_bottom', 'hips')
    for s, sg in (('L', -1), ('R', 1)):
        x = sg * P.hip_x
        r_top = 0.112 * lim
        r_knee = 0.100 * lim
        r_cuff = 0.075 * lim
        tr.add(cyl(r_knee, r_top, P.L1 + 0.04, (x, P.knee_y - 0.01, 0), bevel=0.012, cuts=2),
               'tint_bottom', bulge(f'thigh_{s}', f'pant_up_{s}', P.hip_y, P.knee_y, peak=0.6))
        tr.add(cyl(r_cuff + 0.01, r_knee + 0.018, (P.knee_y + 0.055) - (P.ankle_y + 0.04),
                   (x, P.ankle_y + 0.04, 0), bevel=0.012, cuts=2),
               'tint_bottom', bulge(f'shin_{s}', f'pant_lo_{s}', P.knee_y, P.ankle_y + 0.04, peak=0.55))
        tr.add(cyl(r_cuff, r_cuff, 0.045, (x, P.ankle_y + 0.02, 0), bevel=0.006),
               'tint_bottom', f'pant_lo_{s}')
        # stripe down the outer seam
        tr.add(box(0.012, P.L1 + 0.02, 0.028, (x + sg * (r_top - 0.008), P.knee_y, 0), 0.0, cuts=2,
                   rot=Matrix.Rotation(sg * (r_top - r_knee) / P.L1, 3, 'Z')),
               'light', bulge(f'thigh_{s}', f'pant_up_{s}', P.hip_y, P.knee_y, peak=0.6))
        tr.add(box(0.012, P.L2 - 0.03, 0.028, (x + sg * (r_knee - 0.012), P.ankle_y + 0.05, 0), 0.0, cuts=2,
                   rot=Matrix.Rotation(sg * (r_knee - r_cuff - 0.01) / P.L2, 3, 'Z')),
               'light', bulge(f'shin_{s}', f'pant_lo_{s}', P.knee_y, P.ankle_y + 0.04, peak=0.55))
    out.append(tr)

    # chinos: slimmer, stiffer -- bound to the leg bones directly
    ch = Piece('bottom_chinos')
    ch.add(tbox(hw + 0.024, hw + 0.024, waist - P.pelvis_bot, hd + 0.024, hd + 0.024, (0, P.pelvis_bot, 0), 0.018), 'tint_bottom', 'hips')
    for s, sg in (('L', -1), ('R', 1)):
        x = sg * P.hip_x
        ch.add(cyl(0.080 * lim, 0.092 * lim, P.L1 + 0.04, (x, P.knee_y - 0.01, 0)), 'tint_bottom', f'thigh_{s}')
        ch.add(cyl(0.064 * lim, 0.094 * lim, (P.knee_y + 0.05) - (P.ankle_y + 0.03),
                   (x, P.ankle_y + 0.03, 0)), 'tint_bottom', f'shin_{s}')
    out.append(ch)

    # skirt: an A-line cone on four hem bones
    sk = Piece('bottom_skirt')
    sk.add(tbox(hw + 0.026, hw + 0.026, waist - P.pelvis_bot + 0.02, hd + 0.026, hd + 0.026, (0, P.pelvis_bot, 0), 0.018), 'tint_bottom', 'hips')
    hem_y = 0.33 * P.H
    # wide enough that a swinging thigh stays inside it: the cone is open, so a
    # leg that leaves the skirt reads as a tear rather than as a leg.
    sk.add(cyl(0.295, hw / 2 + 0.03, waist - hem_y - 0.02, (0, hem_y, 0), seg=12, bevel=0.0, cap=False, sx=1.0, sz=0.90),
           'tint_bottom', skirt_bind(waist - 0.02, hem_y))
    out.append(sk)
    return out


def build_shoes(P):
    out = []
    a = P.ankle_y
    for name, upper_h, sole_h, sole_slot, toe_pad in (('shoes_trainers', 0.075, 0.028, 'light', 0.0),
                                                      ('shoes_boots', 0.16, 0.024, 'dark', 0.005)):
        p = Piece(name)
        for s, sg in (('L', -1), ('R', 1)):
            x = sg * P.hip_x
            zc = (P.heel + P.toe) / 2
            L = P.toe - P.heel + toe_pad
            p.add(box(0.10, sole_h + 0.004, L, (x, 0, zc), 0.006), sole_slot, f'foot_{s}')
            p.add(tbox(0.094, 0.082, upper_h, L - 0.008, L - 0.05, (x, sole_h, zc - 0.012), 0.018), 'tint_shoes', f'foot_{s}')
            if name == 'shoes_trainers':
                p.add(box(0.05, 0.05, 0.03, (x, a - 0.02, 0.055), 0.008, rot=Matrix.Rotation(-0.6, 3, 'X')), 'tint_shoes', f'foot_{s}')
        out.append(p)
    return out


def build_hair(P):
    hs = P.head_scale
    top = P.head_top
    hc = P.head_c
    hw_, hd_ = 0.16 * hs, 0.19 * hs
    out = []

    def cap(p, h, pad=0.012, back=True):
        p.add(box(hw_ + pad * 2, h, hd_ + pad * 2, (0, top - h + 0.02, -0.004), 0.03, seg=2), 'tint_hair', 'head')
        if back:
            p.add(box(hw_ + pad * 2, 0.10, 0.035, (0, top - h - 0.06, -hd_ / 2 - 0.006), 0.012), 'tint_hair', 'head')

    p = Piece('hair_short'); cap(p, 0.075); out.append(p)
    p = Piece('hair_buzz'); cap(p, 0.05, 0.006, back=False)
    p.add(box(hw_ + 0.012, 0.07, 0.02, (0, top - 0.10, -hd_ / 2 - 0.0), 0.008), 'tint_hair', 'head'); out.append(p)
    p = Piece('hair_bob'); cap(p, 0.075, back=False)
    for sg in (-1, 1):
        p.add(box(0.03, 0.16, hd_ * 0.8, (sg * (hw_ / 2 + 0.012), P.chin + 0.005, -0.02), 0.01), 'tint_hair', 'head')
    p.add(box(hw_ + 0.084, 0.16, 0.035, (0, P.chin + 0.005, -hd_ / 2 - 0.01), 0.01), 'tint_hair', 'head')
    p.add(box(hw_ + 0.02, 0.035, 0.03, (0, hc + 0.045, hd_ / 2 - 0.004), 0.01), 'tint_hair', 'head'); out.append(p)
    p = Piece('hair_long'); cap(p, 0.075, back=False)
    for sg in (-1, 1):
        p.add(box(0.03, 0.26, hd_ * 0.55, (sg * (hw_ / 2 + 0.012), P.chin - 0.10, -0.045), 0.01), 'tint_hair', 'head')
    p.add(tbox(hw_ + 0.06, hw_ + 0.084, 0.34, 0.05, 0.035, (0, P.chin - 0.18, -hd_ / 2 - 0.02), 0.012), 'tint_hair', 'head')
    p.add(box(hw_ + 0.02, 0.035, 0.03, (0, hc + 0.045, hd_ / 2 - 0.004), 0.01), 'tint_hair', 'head'); out.append(p)
    p = Piece('hair_bun'); cap(p, 0.06)
    p.add(box(0.085, 0.08, 0.08, (0, top - 0.09, -hd_ / 2 - 0.045), 0.03, seg=2), 'tint_hair', 'head'); out.append(p)
    # the curls sit LOWER than they read: a hairstyle must not push the stature
    # out of the 1.70-1.80 band the office is dimensioned for.
    p = Piece('hair_curly')
    p.add(box(hw_ + 0.03, 0.09, hd_ + 0.03, (0, top - 0.085, -0.006), 0.035, seg=2), 'tint_hair', 'head')
    # the curls sit OUTSIDE the skull cap, or they are buried in it and the style
    # is indistinguishable from 'short' -- which is exactly how it shipped once.
    for (x, y, z) in ((-0.105, -0.03, 0.04), (0.105, -0.03, 0.04), (0, 0.015, 0.105),
                      (-0.085, 0.01, -0.085), (0.085, 0.01, -0.085),
                      (-0.115, -0.07, -0.045), (0.115, -0.07, -0.045), (0, -0.045, -0.135)):
        p.add(box(0.085, 0.08, 0.085, (x * hs, top - 0.075 + y, z), 0.032, seg=1), 'tint_hair', 'head')
    out.append(p)
    return out


def build_extras(P):
    hs = P.head_scale
    hw_, hd_ = 0.16 * hs, 0.19 * hs
    fz = hd_ / 2
    out = []
    g = Piece('extra_glasses')
    ey = P.head_c + 0.025 * hs
    for sg in (-1, 1):
        g.add(box(0.036, 0.030, 0.006, (sg * 0.034 * hs, ey - 0.015, fz + 0.008), 0.0), 'dark', 'head')
        g.add(box(0.005, 0.005, hd_ * 0.55, (sg * (hw_ / 2 + 0.003), ey - 0.002, -0.0), 0.0), 'dark', 'head')
    g.add(box(0.03, 0.005, 0.005, (0, ey + 0.003, fz + 0.008), 0.0), 'dark', 'head')
    out.append(g)
    c = Piece('extra_cap')
    c.add(box(hw_ + 0.03, 0.085, hd_ + 0.03, (0, P.head_top - 0.065, -0.004), 0.03, seg=2), 'tint_extra', 'head')
    c.add(box(hw_ + 0.01, 0.012, 0.085, (0, P.head_top - 0.06, hd_ / 2 + 0.035), 0.004, rot=Matrix.Rotation(0.18, 3, 'X')), 'tint_extra', 'head')
    out.append(c)
    return out


# ---------------------------------------------------------------------------
# turning pieces into skinned objects

def realise(piece, arm_ob, bone_names, coll):
    me = bpy.data.meshes.new(piece.name)
    ob = bpy.data.objects.new(piece.name, me)
    coll.objects.link(ob)
    for n in bone_names:
        ob.vertex_groups.new(name=n)
    gidx = {n: i for i, n in enumerate(bone_names)}
    slots = []
    bm = bmesh.new()
    dl = bm.verts.layers.deform.verify()
    for pbm, slot, weights in piece.parts:
        if slot not in slots:
            slots.append(slot)
        mi = slots.index(slot)
        pbm.verts.ensure_lookup_table()
        vmap = {}
        for v, w in zip(pbm.verts, weights):
            nv = bm.verts.new(ITEM_TO_BLENDER.to_3x3() @ v.co)
            for bn, ww in w.items():
                nv[dl][gidx[bn]] = ww
            vmap[v] = nv
        for f in pbm.faces:
            try:
                nf = bm.faces.new([vmap[v] for v in f.verts])
                nf.material_index = mi
                nf.smooth = False
            except ValueError:
                pass
        pbm.free()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for s in slots:
        me.materials.append(material(s))
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_ob
    ob.parent = arm_ob
    return ob


# ---------------------------------------------------------------------------
# posing: analytic IK and a per-clip pose function

def limb_ik(u, L1, L2, joint_back):
    """u: target in the limb root's LOCAL frame (x lateral, y down, z forward).
    Returns (flex, abduct, bend) for XYZ eulers of the root and the second bone.
    joint_back=True for a leg (knee forward, ankle behind), False for an arm
    (elbow back, hand in front)."""
    a = math.atan2(-u.x, u.y)
    d = math.hypot(u.x, u.y)
    f = u.z
    dist = math.hypot(d, f)
    mx = (L1 + L2) * 0.9995
    if dist > mx:
        d *= mx / dist
        f *= mx / dist
        dist = mx
    dist = max(dist, abs(L1 - L2) + 1e-4)
    cphi = (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)
    phi = math.acos(max(-1.0, min(1.0, cphi)))
    cbeta = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)
    beta = math.acos(max(-1.0, min(1.0, cbeta)))
    if joint_back:
        theta = math.atan2(f, d) + beta
        bend = -(math.pi - phi)
    else:
        theta = math.atan2(f, d) - beta
        bend = math.pi - phi
    return theta, a, bend


class Rig:
    """Forward kinematics of the trunk in item space, enough to place the hip
    and shoulder joints for the IK solves."""

    def __init__(self, P, bones):
        self.P = P
        self.bones = bones
        self.rest = {n: Vector(h) for n, (h, t, p, z) in bones.items()}

    def trunk(self, pose):
        """world position + rotation of hips, spine, chest, neck, head."""
        out = {}
        R = Matrix.Identity(3)
        pos = self.rest['hips'] + Vector(pose['hips']['loc'])
        prev = 'hips'
        for n in ('hips', 'spine', 'chest', 'neck', 'head'):
            if n != 'hips':
                pos = pos + R @ (self.rest[n] - self.rest[prev])
            R = R @ Euler(pose[n]['rot'], 'XYZ').to_matrix()
            out[n] = (pos.copy(), R.copy())
            prev = n
        return out

    def solve_leg(self, pose, side, ankle, pitch_up=0.0):
        P = self.P
        hip_pos, R = self.trunk(pose)['hips']
        joint = hip_pos + R @ (self.rest[f'thigh_{side}'] - self.rest['hips'])
        u = R.transposed() @ (Vector(ankle) - joint)
        ul = Vector((-u.x, -u.y, u.z))          # thigh local: X = -X, Y = down, Z = fwd
        theta, a, bend = limb_ik(ul, P.L1, P.L2, True)
        pose[f'thigh_{side}']['rot'] = (theta, 0.0, a)
        pose[f'shin_{side}']['rot'] = (bend, 0.0, 0.0)
        pose[f'foot_{side}']['rot'] = (pitch_up - (theta + bend), 0.0, -a)
        return theta, bend

    def solve_arm(self, pose, side, wrist, extra_abduct=0.0):
        P = self.P
        ch_pos, R = self.trunk(pose)['chest']
        joint = ch_pos + R @ (self.rest[f'upperarm_{side}'] - self.rest['chest'])
        u = R.transposed() @ (Vector(wrist) - joint)
        ul = Vector((-u.x, -u.y, u.z))
        theta, a, bend = limb_ik(ul, P.A1, P.A2, False)
        pose[f'upperarm_{side}']['rot'] = (theta, 0.0, a + extra_abduct)
        pose[f'forearm_{side}']['rot'] = (bend, 0.0, 0.0)
        return theta, bend


def base_pose(bones):
    return {n: {'loc': (0.0, 0.0, 0.0), 'rot': (0.0, 0.0, 0.0)} for n in bones}


def ease(t):
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return t * t * (3 - 2 * t)


ARM_ABDUCT = math.radians(7)


def standing_arms(pose, t, sway=0.0, side_bias=0.0):
    for s, sg in (('L', -1), ('R', 1)):
        pose[f'upperarm_{s}']['rot'] = (sway * sg + side_bias, 0.0, sg * ARM_ABDUCT)
        pose[f'forearm_{s}']['rot'] = (math.radians(12), 0.0, 0.0)
        pose[f'hand_{s}']['rot'] = (math.radians(5), 0.0, 0.0)


# ---------------------------------------------------------------------------
# clips

WALK_T = 1.0            # seconds per cycle (two steps)
WALK_STANCE = 0.60      # fraction of the cycle a foot is on the ground
WALK_A = 0.33           # half the ankle travel relative to the hip during stance
WALK_SPEED = 2 * WALK_A / (WALK_STANCE * WALK_T)     # m/s the clip is authored for
SEAT_H = 0.45
DESK_H = 0.74


def rot_x(v, ang):
    """rotate an item-space (0,y,z) vector about +X; positive lifts +z toward +y"""
    c, s = math.cos(ang), math.sin(ang)
    return Vector((v.x, v.y * c - v.z * s, v.y * s + v.z * c))


def walk_foot(P, phase, x):
    """Ankle position + foot pitch (toe-up positive) for one foot at cycle
    phase in [0,1). Stance = [0, WALK_STANCE): contact moving back at WALK_SPEED."""
    heel = Vector((0, -P.ankle_y, P.heel))     # heel relative to the ankle (flat)
    toe = Vector((0, -P.ankle_y, P.toe))
    ay = P.ankle_y
    if phase < WALK_STANCE:
        s = phase / WALK_STANCE
        z_flat = WALK_A - 2 * WALK_A * s        # ankle z if the foot were flat, moving at -v
        if s < 0.18:                             # heel strike: rolling about the heel
            p = math.radians(14) * (1 - s / 0.18)
            heel_pt = Vector((x, 0, z_flat + P.heel))
            ank = heel_pt + rot_x(-heel, -p)     # toe-up p => rotate ankle (which is +y,+z of heel) up-back
            return ank, p
        if s > 0.62:                             # toe off: rolling about the toe
            p = -math.radians(26) * ((s - 0.62) / 0.38)
            toe_pt = Vector((x, 0, z_flat + P.toe))
            ank = toe_pt + rot_x(-toe, -p)
            return ank, p
        return Vector((x, ay, z_flat)), 0.0
    # swing
    s = (phase - WALK_STANCE) / (1 - WALK_STANCE)
    # starts where toe-off ended, ends at heel strike
    p0 = -math.radians(26)
    z0 = -WALK_A + P.toe - math.sin(0) * 0
    toe_pt = Vector((x, 0, -WALK_A + P.toe))
    ank0 = toe_pt + rot_x(-toe, -p0)
    p1 = math.radians(14)
    heel_pt = Vector((x, 0, WALK_A + P.heel))
    ank1 = heel_pt + rot_x(-heel, -p1)
    e = ease(s)
    ank = ank0.lerp(ank1, e)
    lift = 0.055 * math.sin(math.pi * min(1.0, s * 1.05))
    ank.y += lift
    pitch = p0 * (1 - ease(s * 1.6)) + p1 * ease((s - 0.5) * 2) + (-math.radians(10)) * math.sin(math.pi * s)
    return ank, pitch


def clip_walk(rig, bones, fps):
    P = rig.P
    n = int(round(WALK_T * fps))
    frames = []
    for i in range(n + 1):
        t = i / n
        pose = base_pose(bones)
        bob = -0.022 * math.cos(TAU * 2 * t)     # lowest at heel strike, highest over the stance leg
        # hips: bob, small yaw with the stride, roll onto the stance leg
        sway = 0.012 * math.sin(TAU * t)
        yaw = math.radians(4) * math.sin(TAU * t)
        roll = math.radians(2.5) * math.sin(TAU * t)
        pose['hips']['loc'] = (sway, bob - 0.050, 0.0)
        pose['hips']['rot'] = (math.radians(3), yaw, roll)
        pose['spine']['rot'] = (math.radians(2), -yaw * 0.6, -roll * 0.6)
        pose['chest']['rot'] = (math.radians(1), -yaw * 0.9, -roll * 0.5)
        pose['neck']['rot'] = (math.radians(-3), yaw * 0.4, 0.0)
        pose['head']['rot'] = (math.radians(-1) + 0.5 * math.radians(1) * math.cos(TAU * 2 * t), yaw * 0.2, 0.0)
        # feet: right foot half a cycle behind the left
        for s, sg, ph in (('L', -1, t), ('R', 1, (t + 0.5) % 1.0)):
            ank, pitch = walk_foot(P, ph, sg * (P.hip_x + 0.01))
            rig.solve_leg(pose, s, ank, pitch)
        # arms swing against the legs; elbows breathe with the swing
        for s, sg, ph in (('L', -1, (t + 0.5) % 1.0), ('R', 1, t)):
            sw = math.radians(24) * math.cos(TAU * ph)  # forward at the start of this leg's swing... opposite leg
            pose[f'upperarm_{s}']['rot'] = (sw - math.radians(3), 0.0, sg * ARM_ABDUCT)
            pose[f'forearm_{s}']['rot'] = (math.radians(20) + math.radians(12) * (0.5 + 0.5 * math.cos(TAU * ph)), 0.0, 0.0)
            pose[f'hand_{s}']['rot'] = (math.radians(6), 0.0, 0.0)
        frames.append(pose)
    return frames, True


def clip_idle(rig, bones, fps, T=4.0):
    P = rig.P
    n = int(round(T * fps))
    frames = []
    feet = {s: Vector((sg * (P.hip_x + 0.03), P.ankle_y, 0.0)) for s, sg in (('L', -1), ('R', 1))}
    for i in range(n + 1):
        t = i / n
        pose = base_pose(bones)
        breath = math.sin(TAU * t * 2 - 0.4)             # two breaths in the loop
        shift = math.sin(TAU * t)                        # weight shift left / right
        pose['hips']['loc'] = (0.02 * shift, -0.012 - 0.004 * abs(shift), 0.0)
        pose['hips']['rot'] = (math.radians(2), 0.0, math.radians(2.2) * shift)
        pose['spine']['rot'] = (math.radians(1.5) + math.radians(1.0) * breath, 0.0, -math.radians(1.5) * shift)
        pose['chest']['rot'] = (-math.radians(1.5) * breath, 0.0, -math.radians(1.0) * shift)
        look = math.radians(9) * math.sin(math.pi * ease((t - 0.45) / 0.3)) if 0.45 < t < 0.75 else 0.0
        pose['neck']['rot'] = (math.radians(-2), look * 0.5, 0.0)
        pose['head']['rot'] = (math.radians(-1) - math.radians(1.2) * breath, look * 0.6, math.radians(1.0) * shift)
        for s in ('L', 'R'):
            rig.solve_leg(pose, s, feet[s], 0.0)
        standing_arms(pose, t, sway=math.radians(1.5) * breath)
        for s, sg in (('L', -1), ('R', 1)):
            pose[f'upperarm_{s}']['rot'] = (math.radians(-2) + math.radians(1.5) * breath, 0.0, sg * (ARM_ABDUCT + math.radians(1.2) * breath))
        frames.append(pose)
    return frames, True


def seated_pose(rig, bones, P, t_breath=0.0, lean=math.radians(6), hands='lap', look=0.0):
    """The seated posture: hip joints just above the seat, thighs forward, shins
    down to the floor, root = seat centre, chair facing +Z."""
    pose = base_pose(bones)
    hip_y = SEAT_H + 0.075 * P.limb
    hip_z = -0.04
    breath = math.sin(TAU * t_breath)
    pose['hips']['loc'] = (0.0, hip_y - P.hip_y, hip_z)
    pose['hips']['rot'] = (math.radians(4), 0.0, 0.0)
    pose['spine']['rot'] = (lean * 0.5 + math.radians(0.8) * breath, 0.0, 0.0)
    pose['chest']['rot'] = (lean * 0.3 - math.radians(1.2) * breath, 0.0, 0.0)
    pose['neck']['rot'] = (-lean * 0.6, look, 0.0)
    pose['head']['rot'] = (-lean * 0.4 - math.radians(3) - math.radians(0.8) * breath, look * 0.5, 0.0)
    knee_z = hip_z + P.L1
    for s, sg in (('L', -1), ('R', 1)):
        ank = Vector((sg * (P.hip_x + 0.035), P.ankle_y, knee_z + 0.035))
        rig.solve_leg(pose, s, ank, 0.0)
    tr = rig.trunk(pose)
    if hands == 'lap':
        for s, sg in (('L', -1), ('R', 1)):
            wr = Vector((sg * (P.hip_x + 0.02), hip_y + 0.085, hip_z + P.L1 * 0.62))
            rig.solve_arm(pose, s, wr, sg * math.radians(2))
            pose[f'hand_{s}']['rot'] = (math.radians(-20), 0.0, 0.0)
            pose[f'fingersA_{s}']['rot'] = (math.radians(-25), 0.0, 0.0)
            pose[f'fingersB_{s}']['rot'] = (math.radians(-30), 0.0, 0.0)
    return pose


def clip_sit_idle(rig, bones, fps, T=2.4):
    n = int(round(T * fps))
    frames = []
    for i in range(n + 1):
        t = i / n
        pose = seated_pose(rig, bones, rig.P, t_breath=t)
        frames.append(pose)
    return frames, True


def clip_sit(rig, bones, fps, T_trans=0.8, T_hold=2.4):
    """Stand 0.32 m in front of the seat centre, lower into the chair, then the
    seated idle. Feet stay planted throughout."""
    P = rig.P
    n1 = int(round(T_trans * fps))
    n2 = int(round(T_hold * fps))
    seated = seated_pose(rig, bones, P)
    seat_hip = Vector(seated['hips']['loc'])
    hip_z0 = seat_hip.z + P.L1 + 0.035 - 0.06    # standing over the feet (a little behind them)
    feet = {s: Vector((sg * (P.hip_x + 0.035), P.ankle_y, seat_hip.z + P.L1 + 0.035)) for s, sg in (('L', -1), ('R', 1))}
    frames = []
    for i in range(n1 + n2 + 1):
        pose = base_pose(bones)
        if i <= n1:
            e = ease(i / n1)
            bend = math.sin(math.pi * e)                      # lean forward mid-way
            loc = Vector((0.0, -0.012, hip_z0)).lerp(seat_hip, e)
            loc.y -= 0.03 * bend
            pose['hips']['loc'] = tuple(loc)
            pose['hips']['rot'] = (math.radians(2) + math.radians(2) * e, 0.0, 0.0)
            pose['spine']['rot'] = (math.radians(1.5) + math.radians(18) * bend + math.radians(3) * e, 0.0, 0.0)
            pose['chest']['rot'] = (math.radians(8) * bend + math.radians(1.8) * e, 0.0, 0.0)
            pose['neck']['rot'] = (-math.radians(2) - math.radians(10) * bend - math.radians(3.6) * e, 0.0, 0.0)
            pose['head']['rot'] = (-math.radians(1) - math.radians(6) * bend - math.radians(2.4 + 3) * e, 0.0, 0.0)
            for s in ('L', 'R'):
                rig.solve_leg(pose, s, feet[s], 0.0)
            # arms: hang, then reach forward for balance, then onto the lap
            for s, sg in (('L', -1), ('R', 1)):
                tr = rig.trunk(pose)
                hip = Vector(pose['hips']['loc'])
                lap = Vector((sg * (P.hip_x + 0.02), seat_hip.y + P.hip_y + 0.085, seat_hip.z + P.L1 * 0.62))
                hang = tr['chest'][0] + Vector((sg * (P.shoulder_x + 0.03), -(P.A1 + P.A2) + 0.02, 0.06 + 0.16 * bend))
                wr = hang.lerp(lap, ease((e - 0.55) / 0.45))
                rig.solve_arm(pose, s, wr, sg * math.radians(3))
                pose[f'hand_{s}']['rot'] = (math.radians(-12) * e, 0.0, 0.0)
                pose[f'fingersA_{s}']['rot'] = (math.radians(-25) * e, 0.0, 0.0)
                pose[f'fingersB_{s}']['rot'] = (math.radians(-30) * e, 0.0, 0.0)
        else:
            pose = seated_pose(rig, bones, P, t_breath=(i - n1) / n2)
        frames.append(pose)
    return frames, False


def clip_type(rig, bones, fps, T=2.0):
    """Seated at a 0.74 m desk, forearms over the keyboard, fingers working."""
    P = rig.P
    n = int(round(T * fps))
    frames = []
    import random
    rnd = random.Random(7)
    taps = [(rnd.random(), rnd.choice('LR'), rnd.choice('AB')) for _ in range(22)]
    for i in range(n + 1):
        t = i / n
        pose = seated_pose(rig, bones, P, t_breath=t, lean=math.radians(9), hands='none',
                           look=math.radians(4) * math.sin(TAU * t))
        pose['head']['rot'] = (pose['head']['rot'][0] - math.radians(3), pose['head']['rot'][1], 0.0)
        hip = Vector(pose['hips']['loc'])
        for s, sg in (('L', -1), ('R', 1)):
            drift = 0.012 * math.sin(TAU * t + sg)
            wr = Vector((sg * 0.13 + drift, DESK_H + 0.055, 0.40 + 0.006 * math.sin(TAU * 2 * t + sg)))
            rig.solve_arm(pose, s, wr, sg * math.radians(-4))
            pose[f'hand_{s}']['rot'] = (math.radians(-38), sg * math.radians(6), 0.0)
            for fb in ('A', 'B'):
                ang = math.radians(-18)
                for (t0, ts, tf) in taps:
                    if ts == s and tf == fb:
                        d = (t - t0) % 1.0
                        if d < 0.12:
                            ang += math.radians(-28) * math.sin(math.pi * d / 0.12)
                pose[f'fingers{fb}_{s}']['rot'] = (ang, 0.0, 0.0)
        frames.append(pose)
    return frames, True


def clip_wave(rig, bones, fps, T=1.6):
    P = rig.P
    n = int(round(T * fps))
    frames = []
    feet = {s: Vector((sg * (P.hip_x + 0.03), P.ankle_y, 0.0)) for s, sg in (('L', -1), ('R', 1))}
    for i in range(n + 1):
        t = i / n
        pose = base_pose(bones)
        up = ease(t / 0.22) * (1 - ease((t - 0.78) / 0.22))
        pose['hips']['loc'] = (0.0, -0.012, 0.0)
        pose['hips']['rot'] = (math.radians(2), 0.0, -math.radians(2) * up)
        pose['spine']['rot'] = (math.radians(1.5), 0.0, math.radians(2) * up)
        pose['chest']['rot'] = (0.0, math.radians(-6) * up, math.radians(3) * up)
        pose['neck']['rot'] = (math.radians(-2), math.radians(4) * up, math.radians(-4) * up)
        pose['head']['rot'] = (math.radians(-1), math.radians(3) * up, math.radians(-5) * up)
        for s in ('L', 'R'):
            rig.solve_leg(pose, s, feet[s], 0.0)
        standing_arms(pose, t)
        wig = math.sin(TAU * 3.0 * (t - 0.22)) if 0.22 < t < 0.78 else 0.0
        # right arm: raise sideways and forward, forearm up, hand waving
        # upper arm out to the side and a little forward, forearm folded up beside
        # the head (flex, then twist the bent forearm round the upper arm's axis)
        pose['upperarm_R']['rot'] = (math.radians(-2) + math.radians(17) * up, 0.0, ARM_ABDUCT + math.radians(118) * up)
        pose['forearm_R']['rot'] = (math.radians(12) + math.radians(63) * up, math.radians(-90) * up + math.radians(22) * up * wig, 0.0)
        pose['hand_R']['rot'] = (math.radians(5) - math.radians(15) * up, 0.0, math.radians(20) * up * wig)
        frames.append(pose)
    return frames, False


# ---------------------------------------------------------------------------
# cloth: damped springs on the secondary bones, driven by the limb they hang on

def _second_derivative(vals, dt, loop):
    n = len(vals)
    out = []
    for i in range(n):
        if loop:
            a, b, c = vals[(i - 1) % (n - 1)], vals[i], vals[(i + 1) % (n - 1)]
        else:
            a, b, c = vals[max(0, i - 1)], vals[i], vals[min(n - 1, i + 1)]
        out.append((a - 2 * b + c) / (dt * dt))
    return out


def spring_track(drive_acc, target, dt, loop, k, zeta, clamp, gain=1.0):
    """delta'' = k (target - delta) - c delta' - gain * drive_acc, integrated."""
    n = len(target)
    c = 2 * zeta * math.sqrt(k)
    d = 0.0
    v = 0.0
    out = [0.0] * n
    passes = 4 if loop else 1
    sub = 6
    h = dt / sub
    for p in range(passes):
        for i in range(n - 1 if loop else n):
            for _ in range(sub):
                acc = k * (target[i] - d) - c * v - gain * drive_acc[i]
                v += acc * h
                d += v * h
                d = max(-clamp, min(clamp, d))
            out[i] = d
    if loop:
        out[n - 1] = out[0]
    return out


def add_cloth(frames, loop, fps):
    dt = 1.0 / fps
    n = len(frames)
    th = {s: [f[f'thigh_{s}']['rot'][0] for f in frames] for s in 'LR'}
    sh = {s: [f[f'thigh_{s}']['rot'][0] + f[f'shin_{s}']['rot'][0] for f in frames] for s in 'LR'}
    zero = [0.0] * n
    for s in 'LR':
        up = spring_track(_second_derivative(th[s], dt, loop), zero, dt, loop, k=70.0, zeta=0.30, clamp=0.40, gain=0.9)
        lo = spring_track(_second_derivative(sh[s], dt, loop), zero, dt, loop, k=80.0, zeta=0.28, clamp=0.45, gain=0.8)
        for i, f in enumerate(frames):
            f[f'pant_up_{s}']['rot'] = (up[i], 0.0, 0.0)
            f[f'pant_lo_{s}']['rot'] = (lo[i], 0.0, 0.0)
    # hoodie hem: pushed out by the thigh coming forward (front) or going back (back),
    # driven by the thigh angle MEASURED FROM THIS CLIP'S OWN MEAN. The raw angle is
    # the wrong driver: a seated thigh sits at 85 degrees for the whole clip, and the
    # hem was thrown out over the lap like a board and held there. What actually
    # pushes a hem is the leg moving relative to where it is resting, which is what
    # the centred angle measures -- zero in a held pose, full swing in a walk.
    thc = {s: [v - sum(th[s][:n - 1 if loop else n]) / (n - 1 if loop else n) for v in th[s]] for s in 'LR'}
    HEM_CAP = 0.55
    front = [min(HEM_CAP, 0.55 * max(0.0, thc['L'][i], thc['R'][i])) for i in range(n)]
    back = [min(HEM_CAP, 0.55 * max(0.0, -thc['L'][i], -thc['R'][i])) for i in range(n)]
    hf = spring_track(zero, front, dt, loop, k=140.0, zeta=0.35, clamp=0.9)
    hb = spring_track(zero, back, dt, loop, k=140.0, zeta=0.35, clamp=0.9)
    # skirt: front panel lifts with the thighs, sides breathe with the abduction
    sfront = [min(0.80, 0.85 * max(0.0, thc['L'][i], thc['R'][i])) for i in range(n)]
    sback = [min(0.50, 0.6 * max(0.0, -thc['L'][i], -thc['R'][i])) for i in range(n)]
    sf = spring_track(zero, sfront, dt, loop, k=120.0, zeta=0.35, clamp=1.7)
    sb = spring_track(zero, sback, dt, loop, k=120.0, zeta=0.35, clamp=1.0)
    ab = {s: [abs(f[f'thigh_{s}']['rot'][2]) for f in frames] for s in 'LR'}
    sl = spring_track(zero, [0.3 * ab['L'][i] for i in range(n)], dt, loop, k=120.0, zeta=0.35, clamp=0.6)
    sr = spring_track(zero, [0.3 * ab['R'][i] for i in range(n)], dt, loop, k=120.0, zeta=0.35, clamp=0.6)
    for i, f in enumerate(frames):
        f['hem_F']['rot'] = (hf[i], 0.0, 0.0)
        f['hem_B']['rot'] = (hb[i], 0.0, 0.0)
        f['skirt_F']['rot'] = (sf[i], 0.0, 0.0)
        f['skirt_B']['rot'] = (sb[i], 0.0, 0.0)
        f['skirt_L']['rot'] = (sl[i], 0.0, 0.0)
        f['skirt_R']['rot'] = (sr[i], 0.0, 0.0)


# ---------------------------------------------------------------------------
# keyframing and export

def write_action(arm_ob, name, frames, fps):
    act = bpy.data.actions.new(name)
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    arm_ob.animation_data.action = act
    if hasattr(act, 'slots') and hasattr(arm_ob.animation_data, 'action_slot'):
        try:
            if len(act.slots) == 0:
                act.slots.new(id_type='OBJECT', name=name)
            arm_ob.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    pb = arm_ob.pose.bones
    n = len(frames)
    # build the fcurves directly: far faster than keyframe_insert per bone per frame
    for bone in frames[0]:
        p = pb[bone]
        for path, idx_n, key in (('location', 3, 'loc'), ('rotation_euler', 3, 'rot')):
            for k in range(idx_n):
                dp = f'pose.bones["{bone}"].{path}'
                fc = act.fcurves.new(dp, index=k, action_group=bone)
                fc.keyframe_points.add(n)
                co = []
                for i, f in enumerate(frames):
                    co.extend((float(i), float(f[bone][key][k])))
                fc.keyframe_points.foreach_set('co', co)
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
                fc.update()
    act.frame_range = (0, n - 1)
    act.use_frame_range = True
    return act


def stash_actions(arm_ob, actions):
    ad = arm_ob.animation_data
    ad.action = None
    for act in actions:
        track = ad.nla_tracks.new()
        track.name = act.name
        strip = track.strips.new(act.name, 0, act)
        strip.name = act.name
        if hasattr(strip, 'action_slot') and hasattr(act, 'slots') and len(act.slots):
            try:
                strip.action_slot = act.slots[0]
            except Exception:
                pass
        track.mute = False


def export(arm_ob, meshes, path):
    bpy.ops.object.select_all(action='DESELECT')
    arm_ob.select_set(True)
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm_ob
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials='EXPORT',
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_skins=True,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_morph=False,
        export_draco_mesh_compression_enable=False,
    )


# ---------------------------------------------------------------------------
# self-check inside Blender: read the posed foot back and compare to the target

def check_walk(arm_ob, act, P, fps):
    """Prints the left ankle's world velocity during the flat part of the stance.
    A planted foot moves at exactly -WALK_SPEED, so the numbers should all agree."""
    arm_ob.animation_data.action = act
    if hasattr(act, 'slots') and len(act.slots):
        arm_ob.animation_data.action_slot = act.slots[0]
    scene = bpy.context.scene
    pts = []
    n = int(round(WALK_T * fps))
    for i in range(n + 1):
        scene.frame_set(i)
        h = arm_ob.pose.bones['shin_L'].tail    # the ankle joint
        pts.append((h.x, h.z, -h.y))          # to item space
    arm_ob.animation_data.action = None
    vs = []
    for i in range(n):
        ph = i / n
        s = ph / WALK_STANCE
        if ph < WALK_STANCE and 0.2 < s < 0.6:
            dz = (pts[i + 1][2] - pts[i][2]) * fps
            dy = (pts[i + 1][1] - pts[i][1]) * fps
            vs.append((dz, dy, pts[i][1]))
    if vs:
        vz = [v[0] for v in vs]
        print(f'  walk check: flat-stance ankle vz mean {sum(vz)/len(vz):+.3f} m/s '
              f'(authored {-WALK_SPEED:+.3f}), spread {max(vz)-min(vz):.4f}, '
              f'height {min(v[2] for v in vs):.3f}..{max(v[2] for v in vs):.3f}')
    return pts


def check_pose(arm_ob, act, frame, bone, expect, tail=False):
    arm_ob.animation_data.action = act
    if hasattr(act, 'slots') and len(act.slots):
        arm_ob.animation_data.action_slot = act.slots[0]
    bpy.context.scene.frame_set(frame)
    h = arm_ob.pose.bones[bone].tail if tail else arm_ob.pose.bones[bone].head
    got = Vector((h.x, h.z, -h.y))
    arm_ob.animation_data.action = None
    err = (got - Vector(expect)).length
    print(f'  {act.name}@{frame} {bone}: got ({got.x:+.3f},{got.y:+.3f},{got.z:+.3f}) '
          f'expect ({expect[0]:+.3f},{expect[1]:+.3f},{expect[2]:+.3f}) err {err*1000:.1f} mm')
    return err


# ---------------------------------------------------------------------------

def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def build_one(build, out_dir, fps):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.frame_start = 0
    P = Proportions(BUILDS[build])
    bones = skeleton(P)
    arm_ob = make_armature('Armature', bones)
    bone_names = list(bones.keys())
    coll = scene.collection

    pieces = []
    pieces += build_body(P)
    pieces += build_tops(P)
    pieces += build_bottoms(P)
    pieces += build_shoes(P)
    pieces += build_hair(P)
    pieces += build_extras(P)
    meshes = [realise(p, arm_ob, bone_names, coll) for p in pieces]

    rig = Rig(P, bones)
    clips = {}
    for name, fn in (('idle', clip_idle), ('walk', clip_walk), ('sit', clip_sit),
                     ('sit_idle', clip_sit_idle), ('type', clip_type), ('wave', clip_wave)):
        frames, loop = fn(rig, bones, fps)
        add_cloth(frames, loop, fps)
        clips[name] = write_action(arm_ob, name, frames, fps)
        print(f'  clip {name:9s} {len(frames)-1:4d} frames  {(len(frames)-1)/fps:.2f} s  loop={loop}')

    # self checks: IK targets landed, feet planted
    check_walk(arm_ob, clips['walk'], P, fps)
    check_pose(arm_ob, clips['idle'], 0, 'shin_L', (-(P.hip_x + 0.03), P.ankle_y, 0.0), tail=True)
    n1 = int(round(0.8 * fps))
    seat_hip_y = SEAT_H + 0.075 * P.limb
    check_pose(arm_ob, clips['sit'], n1 + 10, 'thigh_L', (-P.hip_x, seat_hip_y, -0.04))
    check_pose(arm_ob, clips['sit'], n1 + 10, 'shin_L', (-(P.hip_x + 0.035), P.ankle_y, -0.04 + P.L1 + 0.035), tail=True)
    check_pose(arm_ob, clips['type'], 5, 'forearm_R', (0.13 + 0.012 * math.sin(TAU * 5 / 60 + 1), DESK_H + 0.055, 0.40 + 0.006 * math.sin(TAU * 2 * 5 / 60 + 1)), tail=True)

    stash_actions(arm_ob, list(clips.values()))
    out = Path(out_dir) / f'avatar-{build}.glb'
    export(arm_ob, meshes, out)
    tris = {m.name: tri_count(m) for m in meshes}
    print(f'  wrote {out} ({out.stat().st_size/1024:.0f} kB)')
    print('  triangles per piece:', tris)
    return tris


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out_dir = 'assets/avatars'
    builds = list(BUILDS.keys())
    fps = FPS
    i = 0
    while i < len(argv):
        if argv[i] == '--out':
            out_dir = argv[i + 1]; i += 2
        elif argv[i] == '--builds':
            builds = argv[i + 1].split(','); i += 2
        elif argv[i] == '--fps':
            fps = int(argv[i + 1]); i += 2
        else:
            i += 1
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    print(f'walk clip authored for {WALK_SPEED:.3f} m/s')
    for b in builds:
        print(f'== build {b}')
        build_one(b, out_dir, fps)


if __name__ == '__main__':
    main()
