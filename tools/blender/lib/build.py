"""build.py -- the Shape builder every family script is written against.

WHY THIS FILE EXISTS AT ALL
---------------------------
The first pass at the catalogue emitted loose, unjoined primitives that floated
next to each other. The reviewer's words, on two unrelated items and without
being prompted: "elementy nie sa polaczone" -- the parts are not joined. So the
builder now REFUSES to export an object whose parts do not form one connected
body, and it bevels every hard edge, because "clean low poly" means softly
bevelled volumes and not raw boxes.

Three rules, enforced here so no family script can forget them:

  1. CONNECTED. Before anything is meshed, the parts' axis-aligned boxes are
     grown by `TOUCH_TOL` and a union-find runs over the overlapping pairs. More
     than one component -> BuildError naming every orphan. A chair leg that does
     not reach the seat cannot leave this file.
  2. BEVELLED. Every part gets a bevel on its sharp edges (>= BEVEL_ANGLE), with
     clamp_overlap so thin parts survive. Cards (leaves, glazing) opt out.
  3. ONE MESH PER MATERIAL REGION. Parts are joined per slot at the end, so an
     object is `len(slots)` meshes, never `len(parts)`.

Everything is written in ITEM space (see units.py): +X right, +Y up, +Z forward,
metres, origin on the floor at the centre of the footprint. `finish()` applies
the anchor rule, then ITEM_TO_BLENDER, so the exporter's Y-up conversion lands
the GLB back in item space.
"""

import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mats import make_material                       # noqa: E402
from units import CYL_UP, ITEM_TO_BLENDER            # noqa: E402

TOUCH_TOL = 0.002        # 2 mm: parts closer than this count as touching
BEVEL = 0.006            # default bevel offset, metres
BEVEL_ANGLE = math.radians(28)
SMOOTH_ANGLE = math.radians(34)


class BuildError(Exception):
    pass


class Part:
    __slots__ = ('name', 'slot', 'bm', 'lo', 'hi', 'bevel')

    def __init__(self, name, slot, bm, bevel):
        self.name = name
        self.slot = slot
        self.bm = bm
        self.bevel = bevel
        vs = [v.co for v in bm.verts]
        self.lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        self.hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))

    def overlaps(self, other, tol=TOUCH_TOL):
        for i in range(3):
            if self.lo[i] - tol > other.hi[i] or other.lo[i] - tol > self.hi[i]:
                return False
        return True


def _xform(bm, pos, rot):
    if rot and any(rot):
        bmesh.ops.transform(bm, matrix=Euler(rot, 'XYZ').to_matrix().to_4x4(), verts=bm.verts)
    if pos and any(pos):
        bmesh.ops.translate(bm, vec=Vector(pos), verts=bm.verts)


class Shape:
    """One catalogue item under construction."""

    def __init__(self, item_id, anchor='floor', size=None):
        self.id = item_id
        self.anchor = anchor
        self.declared = size
        self.parts = []
        self._n = 0

    # -- primitives ---------------------------------------------------------

    def box(self, size, pos, slot='tint', rot=(0, 0, 0), bevel=None, name=None):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        _xform(bm, pos, rot)
        return self._add(bm, slot, bevel, name or 'box')

    def taper(self, size_a, size_b, pos, axis='x', length=1.0, slot='tint', rot=(0, 0, 0),
              bevel=None, name=None):
        """A box whose (h, w) cross-section goes from size_a at -axis/2 to size_b at +axis/2.

        This is what a five-star chair base arm, a tapered leg or a splayed pot
        actually is; faking it with a plain box is where "raw boxes" comes from.
        """
        ax = {'x': 0, 'y': 1, 'z': 2}[axis]
        o1, o2 = [i for i in (0, 1, 2) if i != ax]
        bm = bmesh.new()
        verts = []
        for sgn, (s1, s2) in ((-0.5, size_a), (0.5, size_b)):
            for a in (-0.5, 0.5):
                for b in (-0.5, 0.5):
                    co = [0.0, 0.0, 0.0]
                    co[ax] = sgn * length
                    co[o1] = a * s1
                    co[o2] = b * s2
                    verts.append(bm.verts.new(co))
        bm.verts.ensure_lookup_table()
        q = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        for f in q:
            bm.faces.new([verts[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        _xform(bm, pos, rot)
        return self._add(bm, slot, bevel, name or 'taper')

    def cyl(self, r_bottom, r_top, h, pos, slot='tint', seg=12, axis='y', rot=(0, 0, 0),
            bevel=None, name=None, cap=True):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg,
                              radius1=r_bottom, radius2=r_top, depth=h)
        m = Matrix.Identity(4)
        if axis == 'y':
            m = CYL_UP.inverted()          # primitive is +Z; stand it up along +Y
        elif axis == 'x':
            m = Matrix.Rotation(math.pi / 2, 4, 'Y')
        if axis != 'z':
            bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        _xform(bm, pos, rot)
        return self._add(bm, slot, bevel, name or 'cyl')

    def card(self, size, pos, slot='foliage', rot=(0, 0, 0), name=None):
        """A single double-sided quad: 2 triangles. Leaves, blinds, paper."""
        w, h = size
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in
              ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
        bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        _xform(bm, pos, rot)
        return self._add(bm, slot, 0.0, name or 'card')

    def tube(self, path, r, slot='metal', seg=8, bevel=0.0, name=None):
        """A round bar bent through a polyline. Cord, tap spout, steam wand, stem."""
        pts = [Vector(p) for p in path]
        bm = bmesh.new()
        rings = []
        for i, p in enumerate(pts):
            if i == 0:
                d = (pts[1] - pts[0])
            elif i == len(pts) - 1:
                d = (pts[-1] - pts[-2])
            else:
                d = (pts[i + 1] - pts[i - 1])
            d.normalize()
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            u = d.cross(up).normalized()
            v = d.cross(u).normalized()
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(bm.verts.new(p + u * (math.cos(a) * r) + v * (math.sin(a) * r)))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return self._add(bm, slot, bevel, name or 'tube')

    def shell(self, outer, inner_depth, wall, pos, slot='ceramic', rot=(0, 0, 0),
              bevel=None, name=None, seg=None, round_xz=False):
        """An open-topped BOWL: an outer volume with a real recess cut into its top.

        The reviewer's complaint about the washbasin was "nie ma dziury na mycie"
        -- there is nowhere to wash. A basin, a sink, a bath and a drip tray all
        need an actual concave void, so the builder owns one instead of leaving
        every family script to fake it with a darker box.

        Built as five/annulus walls so it stays manifold and cheap; no booleans.
        """
        w, h, d = outer
        parts = []
        base_h = h - inner_depth
        if base_h < 0.004:
            raise BuildError(f'{self.id}: shell base too thin ({base_h:.3f} m)')
        if round_xz:
            # elliptical bowl: a basin, a WC pan and a drip tray are all ovals, and
            # a rectangular recess is exactly what stops one reading as a basin.
            n = seg or 16
            rx, rz = w / 2, d / 2
            parts.append(self.cyl(min(rx, rz) * 0.8, 1.0, base_h,
                                  (pos[0], pos[1] - h / 2 + base_h / 2, pos[2]),
                                  slot, seg=n, rot=rot, bevel=bevel,
                                  name=(name or 'bowl') + '-base'))
            # scale the round base into the ellipse
            bmesh.ops.transform(parts[-1].bm,
                                matrix=(Matrix.Translation(Vector(pos))
                                        @ Matrix.Diagonal(Vector((rx, 1.0, rz))).to_4x4()
                                        @ Matrix.Translation(-Vector(pos))),
                                verts=parts[-1].bm.verts)
            self._recompute(parts[-1])
            for k in range(n):
                a0 = 2 * math.pi * k / n
                a1 = 2 * math.pi * (k + 1) / n
                am = (a0 + a1) / 2
                p0 = (math.sin(a0) * rx, math.cos(a0) * rz)
                p1 = (math.sin(a1) * rx, math.cos(a1) * rz)
                seg_len = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 1.08
                mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
                yaw = math.atan2(mx, mz)
                parts.append(self.box(
                    (seg_len, inner_depth, wall),
                    (pos[0] + mx * (1 - wall / (2 * max(rx, rz))),
                     pos[1] - h / 2 + base_h + inner_depth / 2,
                     pos[2] + mz * (1 - wall / (2 * max(rx, rz)))),
                    slot, rot=(0, yaw, 0), bevel=0.0, name=(name or 'bowl') + f'-w{k}'))
            return parts
        parts.append(self.box((w, base_h, d), (pos[0], pos[1] - h / 2 + base_h / 2, pos[2]),
                              slot, rot=rot, bevel=bevel, name=(name or 'bowl') + '-base'))
        y = pos[1] - h / 2 + base_h + inner_depth / 2
        for sx in (-1, 1):
            parts.append(self.box((wall, inner_depth, d),
                                  (pos[0] + sx * (w / 2 - wall / 2), y, pos[2]),
                                  slot, rot=rot, bevel=bevel, name=(name or 'bowl') + '-x'))
        for sz in (-1, 1):
            parts.append(self.box((w - wall * 2, inner_depth, wall),
                                  (pos[0], y, pos[2] + sz * (d / 2 - wall / 2)),
                                  slot, rot=rot, bevel=bevel, name=(name or 'bowl') + '-z'))
        return parts

    # -- bookkeeping --------------------------------------------------------

    def _add(self, bm, slot, bevel, name):
        self._n += 1
        p = Part(f'{name}.{self._n}', slot, bm, BEVEL if bevel is None else bevel)
        self.parts.append(p)
        return p

    # -- the assertion ------------------------------------------------------

    def components(self, tol=TOUCH_TOL):
        """Union-find over parts whose bounding boxes touch. Returns a list of lists."""
        n = len(self.parts)
        parent = list(range(n))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for i in range(n):
            for j in range(i + 1, n):
                if self.parts[i].overlaps(self.parts[j], tol):
                    ri, rj = find(i), find(j)
                    if ri != rj:
                        parent[ri] = rj
        groups = {}
        for i in range(n):
            groups.setdefault(find(i), []).append(i)
        out = sorted(groups.values(), key=len, reverse=True)
        return [[self.parts[i] for i in g] for g in out]

    def assert_connected(self):
        comps = self.components()
        if len(comps) <= 1:
            return
        main = comps[0]
        orphans = []
        for c in comps[1:]:
            for p in c:
                orphans.append(f'{p.name} [{p.slot}] at '
                               f'({(p.lo.x + p.hi.x) / 2:.3f}, {(p.lo.y + p.hi.y) / 2:.3f}, '
                               f'{(p.lo.z + p.hi.z) / 2:.3f})')
        raise BuildError(
            f'{self.id}: {len(self.parts)} parts form {len(comps)} disconnected bodies; '
            f'the main body has {len(main)}. Floating: ' + '; '.join(orphans))

    # -- finishing ----------------------------------------------------------

    def bounds(self):
        lo = Vector((min(p.lo.x for p in self.parts), min(p.lo.y for p in self.parts),
                     min(p.lo.z for p in self.parts)))
        hi = Vector((max(p.hi.x for p in self.parts), max(p.hi.y for p in self.parts),
                     max(p.hi.z for p in self.parts)))
        return lo, hi

    def _recompute(self, p):
        vs = [v.co for v in p.bm.verts]
        p.lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
        p.hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))

    def translate_all(self, vec):
        for p in self.parts:
            bmesh.ops.translate(p.bm, vec=Vector(vec), verts=p.bm.verts)
            self._recompute(p)

    def scale_all(self, vec):
        m = Matrix.Diagonal(Vector(vec)).to_4x4()
        for p in self.parts:
            bmesh.ops.transform(p.bm, matrix=m, verts=p.bm.verts)
            self._recompute(p)

    def place_origin(self):
        """Apply the anchor rule from units.py."""
        lo, hi = self.bounds()
        dx = -(lo.x + hi.x) / 2
        if self.anchor == 'floor':
            self.translate_all((dx, -lo.y, -(lo.z + hi.z) / 2))
        elif self.anchor == 'wall':
            self.translate_all((dx, -lo.y, -lo.z))
        elif self.anchor == 'ceiling':
            self.translate_all((dx, -hi.y, -(lo.z + hi.z) / 2))
        else:
            raise BuildError(f'{self.id}: unknown anchor {self.anchor}')

    def fit(self, target, axes='xyz', max_pct=0.04):
        """Nudge the finished body onto the catalogue size.

        Design to the millimetre first; this only removes the last fraction of a
        percent that bevels and round profiles leave behind. Anything beyond
        `max_pct` is a design error, not a rounding error, and raises.
        """
        lo, hi = self.bounds()
        cur = (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
        s = [1.0, 1.0, 1.0]
        for i, ax in enumerate('xyz'):
            if ax not in axes or not target[i] or cur[i] < 1e-6:
                continue
            f = target[i] / cur[i]
            if abs(f - 1.0) > max_pct:
                raise BuildError(
                    f'{self.id}: {ax} measures {cur[i]:.4f} m against a catalogue '
                    f'{target[i]:.4f} m ({(f - 1) * 100:+.1f} %). Fix the geometry or '
                    f'the catalogue -- do not scale it away.')
            s[i] = f
        self.scale_all(s)


# ---------------------------------------------------------------------------
# meshing


def _to_object(part, palette, coll):
    me = bpy.data.meshes.new(part.name)
    part.bm.to_mesh(me)
    ob = bpy.data.objects.new(part.name, me)
    ob.data.materials.append(make_material(part.slot, palette))
    coll.objects.link(ob)
    return ob


def _bevel(bm, amt):
    """Bevel the sharp edges, with the offset scaled to the part.

    A 20 mm handle does not need a 6 mm chamfer, and paying ~40 extra triangles
    for one is how a catalogue of soft volumes turns into a triangle budget
    problem. Below 2.5 mm the bevel is invisible at office scale, so it is
    dropped entirely.
    """
    if amt <= 0:
        return
    vs = [v.co for v in bm.verts]
    ext = min(max(v[i] for v in vs) - min(v[i] for v in vs) for i in range(3))
    amt = min(amt, ext / 4.0)
    if amt < 0.0025:
        return
    edges = [e for e in bm.edges
             if len(e.link_faces) == 2 and e.calc_face_angle(0.0) >= BEVEL_ANGLE]
    if not edges:
        return
    verts = set()
    for e in edges:
        verts.update(e.verts)
    bmesh.ops.bevel(bm, geom=list(verts) + edges, offset=amt, offset_type='OFFSET',
                    segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)


def finish(shape, palette, target_size=None, fit_axes='xyz', fit_max=0.04):
    """Assert, bevel, join per slot, apply the anchor, hand back Blender objects."""
    shape.assert_connected()
    for p in shape.parts:
        _bevel(p.bm, p.bevel)
        shape._recompute(p)
    shape.place_origin()
    if target_size:
        shape.fit(target_size, fit_axes, fit_max)
        shape.place_origin()

    coll = bpy.context.scene.collection
    by_slot = {}
    for p in shape.parts:
        by_slot.setdefault(p.slot, []).append(p)

    objects = []
    for slot, parts in by_slot.items():
        merged = bmesh.new()
        for p in parts:
            tmp = bpy.data.meshes.new('tmp')
            p.bm.to_mesh(tmp)
            merged.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        bmesh.ops.transform(merged, matrix=ITEM_TO_BLENDER, verts=merged.verts)
        bmesh.ops.remove_doubles(merged, verts=merged.verts, dist=1e-5)
        me = bpy.data.meshes.new(f'{shape.id}.{slot}')
        merged.to_mesh(me)
        merged.free()
        ob = bpy.data.objects.new(f'{shape.id}.{slot}', me)
        ob.data.materials.append(make_material(slot, palette))
        coll.objects.link(ob)
        objects.append(ob)

    for ob in objects:
        for poly in ob.data.polygons:
            poly.use_smooth = True
        try:
            ob.data.set_sharp_from_angle(angle=SMOOTH_ANGLE)
        except AttributeError:
            for poly in ob.data.polygons:
                poly.use_smooth = False
    return objects


def clear_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def export_glb(objects, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        export_materials='EXPORT',
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )


def tri_count(objects):
    n = 0
    for ob in objects:
        for poly in ob.data.polygons:
            n += max(0, len(poly.vertices) - 2)
    return n
