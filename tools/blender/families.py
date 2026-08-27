"""families.py -- the parametric family scripts.

Each builder takes the CATALOGUE ENTRY (so the dimensions come from
src/model/catalog.js, never from a number typed twice) and returns a Shape.
`build.finish()` then asserts connectivity, bevels, joins per material slot and
applies the anchor rule, so nothing below has to remember to do any of that.

Every joint below is written to INTERPENETRATE, not to abut: a leg runs up INTO
the seat, an armrest overlaps both the seat side and the back post, a cistern
sits ON the pan's rear shoulder. That is what makes the export one connected
body instead of a pile of primitives standing near each other.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))

from build import Shape                                  # noqa: E402

TAU = math.pi * 2


# ---------------------------------------------------------------------------
# seating


def chair_task(e):
    """Real task-chair anatomy: five-star base on castors, gas lift, seat pan,
    backrest on a proper post, armrests attached to seat AND back.

    The bug this replaces: the placeholder rotated each base arm by -a about Y
    while positioning it at angle a, so every arm pointed 90 - 2a away from its
    own castor -- "nogi sa w dziwne strony". An arm is built along its own +Z
    here and yawed by exactly the angle it is placed at, which is the only
    transform that can be right.
    """
    s = Shape(e['id'], 'floor', e['size'])
    seat_h = e.get('seatHeight') or 0.46
    rc = 0.3098                     # castor centre radius; 5-star -> 0.650 m wide
    wheel_r, wheel_t = 0.032, 0.026

    s.cyl(0.062, 0.056, 0.10, (0, 0.06, 0), 'graphite', seg=8, name='hub')
    for i in range(5):
        a = TAU * i / 5
        sx, cz = math.sin(a), math.cos(a)
        s.taper((0.078, 0.072), (0.046, 0.034), (sx * rc / 2, 0.055, cz * rc / 2),
                axis='z', length=rc, slot='graphite', rot=(0, a, 0), name=f'star{i}')
        s.box((0.038, 0.058, 0.032), (sx * rc, 0.062, cz * rc), 'graphite',
              rot=(0, a, 0), name=f'yoke{i}')
        s.cyl(wheel_r, wheel_r, wheel_t, (sx * rc, wheel_r, cz * rc), 'rubber',
              seg=8, axis='x', rot=(0, a, 0), bevel=0.0, name=f'castor{i}')

    s.cyl(0.048, 0.044, 0.15, (0, 0.145, 0), 'chrome', seg=8, name='shroud')
    s.cyl(0.036, 0.036, 0.27, (0, 0.235, 0), 'chrome', seg=8, bevel=0.0, name='gaslift')
    s.box((0.22, 0.045, 0.28), (0, 0.385, 0.03), 'graphite', name='mechanism')
    s.box((0.05, 0.06, 0.10), (0.16, 0.375, 0.10), 'graphite', bevel=0.004, name='lever')

    s.box((0.50, 0.075, 0.47), (0, seat_h - 0.037, 0.035), 'tint', bevel=0.020, name='seat')

    lean = -0.17
    s.box((0.095, 0.30, 0.075), (0, 0.55, -0.185), 'graphite', rot=(lean, 0, 0), name='post')
    s.taper((0.44, 0.075), (0.40, 0.065), (0, 0.885, -0.248), axis='y', length=0.40,
            slot='tint', rot=(lean, 0, 0), bevel=0.016, name='back')
    s.box((0.42, 0.075, 0.055), (0, 0.695, -0.222), 'graphite', rot=(lean, 0, 0),
          bevel=0.010, name='lumbar')

    for sgn in (-1, 1):
        x = sgn * 0.235
        s.box((0.036, 0.24, 0.048), (x, 0.53, -0.02), 'graphite', name='armstem')
        s.box((0.050, 0.030, 0.28), (x, 0.670, -0.03), 'graphite', bevel=0.012, name='armpad')
        s.box((0.040, 0.040, 0.13), (sgn * 0.225, 0.668, -0.19), 'graphite', name='armlink')
    return s


def sofa_3seat(e):
    """Approved in review -- rebuilt with the same composition, joined and bevelled."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    seat_h = e.get('seatHeight') or 0.42
    arm_w, back_t, plinth = 0.19, 0.17, 0.13
    s.box((w, plinth, d), (0, plinth / 2, 0), 'wood', bevel=0.010, name='plinth')
    for sgn in (-1, 1):
        s.box((arm_w, h - 0.24, d - 0.04), (sgn * (w / 2 - arm_w / 2),
              plinth + (h - 0.24) / 2 - 0.02, 0), 'fabric', bevel=0.030, name='arm')
    s.box((w - arm_w, h - seat_h + 0.06, back_t),
          (0, seat_h + (h - seat_h) / 2 - 0.03, -d / 2 + back_t / 2), 'fabric',
          bevel=0.026, name='backrest')
    inner = w - arm_w * 2
    cw = inner / 3
    for i in range(3):
        x = -inner / 2 + cw * (i + 0.5)
        s.box((cw - 0.02, seat_h - plinth + 0.03, d - back_t - 0.06),
              (x, plinth + (seat_h - plinth) / 2, back_t / 2 - 0.02), 'tint',
              bevel=0.026, name='cushion')
        s.box((cw - 0.05, h - seat_h - 0.10, 0.11),
              (x, seat_h + (h - seat_h) / 2 - 0.02, -d / 2 + back_t + 0.03), 'tint',
              bevel=0.026, name='backcushion')
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.cyl(0.026, 0.022, 0.06, (sx * (w / 2 - 0.10), 0.03, sz * (d / 2 - 0.10)),
                  'woodDark', seg=8, name='foot')
    return s


def exam_couch(e):
    """Approved in review. 1900 x 620 at 0.70 -- flat top, paper roll at the head."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    top = h - 0.04
    s.box((w - 0.06, 0.10, d - 0.10), (0, top - 0.16, 0), 'graphite', bevel=0.008, name='chassis')
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.cyl(0.030, 0.030, top - 0.16, (sx * (w / 2 - 0.07), (top - 0.16) / 2,
                  sz * (d / 2 - 0.10)), 'chrome', seg=8, name='leg')
            s.cyl(0.040, 0.040, 0.022, (sx * (w / 2 - 0.07), 0.012, sz * (d / 2 - 0.10)),
                  'rubber', seg=8, bevel=0.003, name='foot')
    for sx in (-1, 1):
        s.box((0.032, 0.032, d - 0.24), (sx * (w / 2 - 0.07), 0.16, 0), 'chrome',
              bevel=0.0, name='leg-brace')
    s.box((w - 0.10, 0.05, d - 0.14), (0, top - 0.13, 0), 'chrome', bevel=0.006, name='rail')
    s.box((w, 0.11, d * 0.62), (0, top - 0.045, d * 0.18), 'tint', bevel=0.016, name='seatpad')
    s.box((w, 0.11, d * 0.36), (0, top - 0.045, -d * 0.31), 'tint', bevel=0.016, name='backpad')
    s.box((w * 0.86, 0.055, 0.10), (0, top + 0.03, -d / 2 + 0.09), 'tint',
          bevel=0.020, name='bolster')
    s.cyl(0.048, 0.048, w * 0.80, (0, top - 0.14, -d / 2 + 0.05), 'paper',
          seg=10, axis='x', name='paperroll')
    return s


# ---------------------------------------------------------------------------
# tables and counters


def table_dining_4(e):
    """Rebuilt after "za maly". See the report: the mesh is built to 1.60 x 0.90,
    the size a four-cover table needs once the covers have a service strip between
    them, and the catalogue's 1.40 x 0.80 is flagged for its owner.
    """
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', None)
    top_t, apron = 0.038, 0.085
    s.box((w, top_t, d), (0, h - top_t / 2, 0), 'tint', bevel=0.012, name='top')
    inset = 0.075
    for sz in (-1, 1):
        s.box((w - inset * 2 - 0.02, apron, 0.026),
              (0, h - top_t - apron / 2 + 0.006, sz * (d / 2 - inset)), 'wood',
              bevel=0.005, name='apron-long')
    for sx in (-1, 1):
        s.box((0.026, apron, d - inset * 2 - 0.02),
              (sx * (w / 2 - inset), h - top_t - apron / 2 + 0.006, 0), 'wood',
              bevel=0.005, name='apron-short')
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.taper((0.075, 0.075), (0.052, 0.052),
                    (sx * (w / 2 - inset), (h - 0.02) / 2, sz * (d / 2 - inset)),
                    axis='y', length=h - 0.02, slot='wood', bevel=0.007, name='leg')
    return s


def desk_reception(e):
    """Counter with a raised transaction top, a lower work surface, a modesty
    panel, a kick recess and the small stuff a real reception desk carries.
    """
    w, h, d = e['size']                  # 2.20 x 1.10 x 0.80
    s = Shape(e['id'], 'floor', e['size'])
    front = d / 2                        # public face at +z
    work_h = e.get('workHeight') or 0.74
    skin_t = 0.05

    low_w = 0.92                          # accessible section, top at 0.75
    low_x = w / 2 - low_w / 2
    s.box((w - low_w, h - 0.14, skin_t), (-low_w / 2, 0.10 + (h - 0.14) / 2,
          front - skin_t / 2), 'tint', bevel=0.008, name='front-skin')
    s.box((low_w, 0.75 - 0.14, skin_t), (low_x, 0.10 + (0.75 - 0.14) / 2,
          front - skin_t / 2), 'tint', bevel=0.008, name='front-skin-low')
    s.box((low_w + 0.03, 0.042, 0.34), (low_x, 0.75 - 0.021, front - 0.17), 'accent',
          bevel=0.010, name='accessible-ledge')
    s.box((low_w, 0.016, 0.03), (low_x, 0.75 - 0.050, front - 0.005), 'graphite',
          bevel=0.003, name='ledge-edge')
    for rx in (-w / 2 + 0.62, -w / 2 + 1.24):
        s.box((0.012, h - 0.20, 0.020), (rx, 0.13 + (h - 0.20) / 2, front - 0.041),
              'graphite', bevel=0.0, name='reveal')
    s.box((w - low_w - 0.02, 0.020, 0.024), (-low_w / 2, 0.95, front - 0.038),
          'accent', bevel=0.004, name='band')
    s.box((w - 0.10, 0.10, d - 0.14), (0, 0.05, -0.02), 'graphite', name='plinth')
    s.box((w, 0.028, 0.018), (0, 0.115, front - 0.012), 'graphite',
          bevel=0.004, name='shadow-gap')
    for sgn in (-1, 1):
        s.box((skin_t, h - 0.12, d - 0.10), (sgn * (w / 2 - skin_t / 2),
              0.10 + (h - 0.12) / 2, -0.03), 'tint', bevel=0.008, name='return')
    s.box((w - low_w + 0.03, 0.045, 0.36), (-low_w / 2 + 0.015, h - 0.0225, front - 0.18),
          'accent', bevel=0.010, name='transaction-top')
    s.box((w - low_w, 0.016, 0.03), (-low_w / 2, h - 0.052, front - 0.005), 'graphite',
          bevel=0.003, name='top-edge-detail')
    s.box((w - 0.09, 0.04, d - 0.24), (0, work_h - 0.02, -0.06), 'wood',
          bevel=0.008, name='work-surface')
    s.box((w - 0.30, 0.50, 0.022), (0, work_h - 0.29, front - 0.20), 'tint',
          bevel=0.005, name='modesty-panel')
    s.box((0.30, 0.026, 0.024), (-0.30, h - 0.16, front - skin_t / 2), 'graphite',
          bevel=0.004, name='letterbox-slot')

    # the "rzeczy" -- everything below stays under the 1.10 counter on purpose
    s.box((0.20, 0.018, 0.16), (-0.55, work_h + 0.009, -0.14), 'graphite',
          bevel=0.004, name='monitor-foot')
    s.box((0.06, 0.14, 0.05), (-0.55, work_h + 0.08, -0.14), 'graphite', name='monitor-stem')
    s.box((0.46, 0.28, 0.032), (-0.55, work_h + 0.20, -0.155), 'graphite',
          rot=(0.10, 0, 0), bevel=0.006, name='monitor')
    s.box((0.42, 0.24, 0.008), (-0.55, work_h + 0.20, -0.137), 'glass',
          rot=(0.10, 0, 0), bevel=0.0, name='monitor-screen')
    s.box((0.46, 0.022, 0.20), (-0.55, work_h - 0.031, 0.02), 'graphite',
          bevel=0.004, name='keyboard-tray')
    s.box((0.40, 0.016, 0.14), (-0.55, work_h - 0.012, 0.02), 'tint',
          bevel=0.003, name='keyboard')
    s.box((0.090, 0.135, 0.060), (low_x + 0.28, 0.795, front - 0.20), 'graphite',
          rot=(-0.42, 0, 0), bevel=0.006, name='card-reader')
    s.box((0.058, 0.042, 0.030), (low_x + 0.28, 0.833, front - 0.222), 'accent',
          rot=(-0.42, 0, 0), bevel=0.003, name='card-reader-screen')
    s.shell((0.26, 0.042, 0.19), 0.034, 0.012, (-0.86, h - 0.021, front - 0.19),
            slot='accent', name='tray')          # recessed flush into the top
    s.box((0.30, 0.010, 0.22), (-0.86, h - 0.043, front - 0.19), 'paper',
          bevel=0.0, name='tray-paper')
    s.box((0.24, 0.014, 0.16), (low_x - 0.26, 0.755, front - 0.20), 'paper',
          bevel=0.0, name='leaflets')
    return s


# ---------------------------------------------------------------------------
# sanitary


def wc_floor(e):
    """Close-coupled WC: cistern SITS ON the pan's rear shoulder, seat and lid
    are hinged to the same shoulder. One solid, not three near each other.
    """
    w, h, d = e['size']                  # 0.38 x 0.79 x 0.70
    s = Shape(e['id'], 'floor', e['size'])
    seat_h = e.get('seatHeight') or 0.42
    rim = seat_h - 0.025                 # ceramic rim, the seat sits on top of it

    s.box((0.30, 0.44, 0.30), (0, 0.22, -0.20), 'ceramic', bevel=0.016, name='shoulder')
    s.taper((0.20, 0.26), (0.28, 0.34), (0, 0.13, 0.02), axis='y', length=0.26,
            slot='ceramic', bevel=0.012, name='pedestal')
    s.shell((0.34, 0.17, 0.42), 0.14, 0.026, (0, rim - 0.085, 0.13),
            slot='ceramic', round_xz=True, seg=12, name='pan')
    ring_n = 14
    for k in range(ring_n):
        a = TAU * (k + 0.5) / ring_n
        rx, rz = 0.158, 0.205
        px, pz = math.sin(a) * rx, math.cos(a) * rz
        seg_len = TAU * ((rx + rz) / 2) / ring_n * 1.12
        s.box((seg_len, 0.020, 0.062), (px * 0.93, rim + 0.010, 0.13 + pz * 0.93),
              'tint', rot=(0, math.atan2(px, pz), 0), bevel=0.005, name='seat')
    s.box((0.20, 0.026, 0.06), (0, rim + 0.013, -0.075), 'tint', bevel=0.006, name='seat-hinge')
    s.box((w, 0.38, 0.19), (0, 0.60, -0.255), 'ceramic', bevel=0.014, name='cistern')
    s.box((w - 0.02, 0.022, 0.20), (0, 0.79 - 0.011, -0.25), 'ceramic',
          bevel=0.006, name='cistern-lid')
    s.box((0.10, 0.022, 0.055), (0, 0.782, -0.20), 'chrome', bevel=0.004, name='flush-plate')
    s.box((0.325, 0.38, 0.026), (0, 0.605, -0.150), 'tint', rot=(-0.10, 0, 0),
          bevel=0.010, name='lid')
    s.box((0.10, 0.05, 0.05), (0, 0.425, -0.155), 'chrome', bevel=0.006, name='lid-hinge')
    return s


def basin_560(e):
    """A basin with a BOWL: a real recessed oval well with a rim, a waste, an
    overflow slot and a mixer on the tap hole. The placeholder was a lump.
    """
    w, h, d = e['size']                  # 0.56 x 0.85 x 0.46, rim at 0.85
    rim_h = e.get('workHeight') or 0.85
    s = Shape(e['id'], 'floor', None)
    rim_t, frame = 0.045, 0.06
    open_w, open_d = w - frame * 2, d - frame * 2 - 0.05

    for sz in (-1, 1):
        depth = frame + (0.05 if sz < 0 else 0.0)
        s.box((w, rim_t, depth), (0, rim_h - rim_t / 2, sz * (d / 2 - depth / 2)),
              'ceramic', bevel=0.010, name='rim-z')
    for sx in (-1, 1):
        s.box((frame, rim_t, d), (sx * (w / 2 - frame / 2), rim_h - rim_t / 2, 0),
              'ceramic', bevel=0.010, name='rim-x')

    bowl_y = rim_h - rim_t - 0.070
    s.shell((open_w + 0.01, 0.175, open_d + 0.01), 0.155, 0.022, (0, bowl_y - 0.010, 0.012),
            slot='ceramic', round_xz=True, seg=12, name='bowl')
    s.cyl(0.026, 0.026, 0.02, (0, bowl_y - 0.062, 0.012), 'chrome', seg=12,
          bevel=0.003, name='waste')
    s.box((0.075, 0.014, 0.016), (0, rim_h - rim_t - 0.028, -open_d / 2 + 0.02),
          'graphite', bevel=0.0, name='overflow')

    s.taper((0.235, 0.25), (0.165, 0.18), (0, 0.045, 0.0), axis='y', length=0.09,
            slot='ceramic', bevel=0.010, name='ped-foot')
    s.taper((0.165, 0.18), (0.185, 0.21), (0, 0.365, 0.0), axis='y', length=0.56,
            slot='ceramic', bevel=0.010, name='pedestal')
    s.taper((0.185, 0.21), (0.245, 0.255), (0, 0.685, 0.005), axis='y', length=0.09,
            slot='ceramic', bevel=0.012, name='ped-neck')

    tap_z = -d / 2 + 0.055
    s.cyl(0.028, 0.026, 0.045, (0, rim_h + 0.018, tap_z), 'chrome', seg=12, name='tap-base')
    s.cyl(0.020, 0.019, 0.13, (0, rim_h + 0.095, tap_z), 'chrome', seg=12, name='tap-body')
    s.tube([(0, rim_h + 0.150, tap_z), (0, rim_h + 0.158, tap_z + 0.035),
            (0, rim_h + 0.150, tap_z + 0.085), (0, rim_h + 0.130, tap_z + 0.100)],
           0.0125, 'chrome', seg=8, name='spout')
    s.box((0.022, 0.020, 0.070), (0, rim_h + 0.156, tap_z - 0.018), 'chrome',
          rot=(0.30, 0, 0), bevel=0.005, name='lever')
    return s


# ---------------------------------------------------------------------------
# kitchen


def kitchen_base_sink_800(e):
    """Approved in review -- rebuilt joined and bevelled, and the bowl the
    catalogue note promises (0.50 x 0.40 x 0.18) is now actually cut into the top.
    No mixer: this unit lines up in a run and its 0.90 m worktop must stay exact.
    """
    w, h, d = e['size']                  # 0.80 x 0.90 x 0.60
    s = Shape(e['id'], 'floor', e['size'])
    plinth, top_t = 0.15, 0.04
    car_h = h - plinth - top_t
    s.box((w - 0.06, plinth, d - 0.12), (0, plinth / 2, -0.04), 'graphite',
          bevel=0.006, name='plinth')
    s.box((w, car_h, d - 0.03), (0, plinth + car_h / 2, -0.015), 'tint',
          bevel=0.008, name='carcase')
    s.box((w, top_t, 0.075), (0, h - top_t / 2, -d / 2 + 0.037), 'accent',
          bevel=0.008, name='top-back')
    s.box((w, top_t, 0.085), (0, h - top_t / 2, d / 2 - 0.042), 'accent',
          bevel=0.008, name='top-front')
    for sx in (-1, 1):
        s.box((0.14, top_t, d), (sx * (w / 2 - 0.07), h - top_t / 2, 0), 'accent',
              bevel=0.008, name='top-side')
    s.shell((0.52, 0.20, 0.42), 0.18, 0.014, (0, h - 0.10, 0.005),
            slot='metal', name='bowl')
    s.cyl(0.030, 0.030, 0.018, (0, h - 0.19, 0.005), 'metal', seg=12,
          bevel=0.003, name='waste')
    fz = d / 2 - 0.024
    s.box((w - 0.008, 0.14, 0.020), (0, plinth + car_h - 0.08, fz), 'tint',
          bevel=0.005, name='drawer-front')
    s.box((w - 0.008, car_h - 0.17, 0.020), (0, plinth + (car_h - 0.17) / 2, fz), 'tint',
          bevel=0.005, name='door')
    s.box((w * 0.55, 0.014, 0.028), (0, plinth + car_h - 0.08, d / 2 - 0.010), 'chrome',
          bevel=0.003, name='handle-drawer')
    s.box((w * 0.55, 0.014, 0.028), (0, plinth + car_h - 0.24, d / 2 - 0.010), 'chrome',
          bevel=0.003, name='handle-door')
    return s


def fridge_freezer_tall(e):
    """Approved in review -- rebuilt joined and bevelled."""
    w, h, d = e['size']                  # 0.60 x 2.00 x 0.65
    s = Shape(e['id'], 'floor', e['size'])
    split = 1.30
    s.box((w, h - 0.06, d - 0.035), (0, 0.03 + (h - 0.06) / 2, -0.0175), 'tint',
          bevel=0.010, name='carcase')
    s.box((w - 0.05, 0.06, d - 0.12), (0, 0.03, -0.03), 'graphite', name='base')
    fz = d / 2 - 0.021
    s.box((w - 0.006, split - 0.09, 0.042), (0, 0.05 + (split - 0.09) / 2, fz), 'metal',
          bevel=0.008, name='door-lower')
    s.box((w - 0.006, h - split - 0.05, 0.042), (0, split + (h - split - 0.05) / 2, fz),
          'metal', bevel=0.008, name='door-upper')
    for y in (split - 0.16, split + 0.10):
        s.box((0.028, 0.30, 0.036), (w / 2 - 0.075, y, d / 2 - 0.008), 'chrome',
              bevel=0.005, name='handle')
    s.box((w - 0.10, 0.020, 0.02), (0, split - 0.02, d / 2 - 0.012), 'graphite',
          bevel=0.003, name='door-gap')
    return s


# ---------------------------------------------------------------------------
# openings


def door_internal_900(e):
    """Approved in review. Leaf 0.90 x 2.05 plus real hardware; the lining is cut
    by src/model/geometry.js as a wall reveal, so it is not modelled twice here.
    """
    w, h, _ = e['size']
    s = Shape(e['id'], 'wall', None)
    leaf = 0.045
    s.box((w, h, leaf), (0, h / 2, leaf / 2), 'tint', bevel=0.005, name='leaf')
    s.box((w - 0.10, h - 0.16, 0.006), (0, h / 2 + 0.02, leaf - 0.001), 'tint',
          bevel=0.004, name='panel-front')
    s.box((w - 0.10, h - 0.16, 0.006), (0, h / 2 + 0.02, 0.001), 'tint',
          bevel=0.004, name='panel-back')
    for y in (0.24, h / 2, h - 0.24):
        s.box((0.018, 0.10, leaf + 0.006), (-w / 2 + 0.006, y, leaf / 2), 'chrome',
              bevel=0.003, name='hinge')
    hx = w / 2 - 0.065
    for zc, sgn in ((leaf + 0.012, 1), (-0.012, -1)):
        s.cyl(0.030, 0.030, 0.026, (hx, 1.05, zc - sgn * 0.006), 'chrome', seg=12,
              axis='z', bevel=0.004, name='rose')
        s.tube([(hx, 1.05, zc), (hx, 1.05, zc + sgn * 0.036),
                (hx - 0.045, 1.048, zc + sgn * 0.040),
                (hx - 0.100, 1.045, zc + sgn * 0.036)], 0.011, 'chrome', seg=8, name='lever')
    return s


def window_1200x1400(e):
    """Approved in review. Frame, one mullion, two sashes, glazing, internal sill
    and a handle -- all inside the declared 0.12 m depth so the wall cut is honest.
    """
    w, h, d = e['size']                  # 1.20 x 1.40 x 0.12
    s = Shape(e['id'], 'wall', e['size'])
    f, fd = 0.062, 0.075
    zc = 0.045
    s.box((w, f, fd), (0, f / 2, zc), 'tint', bevel=0.005, name='frame-b')
    s.box((w, f, fd), (0, h - f / 2, zc), 'tint', bevel=0.005, name='frame-t')
    for sx in (-1, 1):
        s.box((f, h, fd), (sx * (w / 2 - f / 2), h / 2, zc), 'tint', bevel=0.005, name='frame-s')
    s.box((f * 0.85, h - f * 2 + 0.01, fd), (0, h / 2, zc), 'tint', bevel=0.005, name='mullion')
    for sgn in (-1, 1):
        cx = sgn * (w / 4 + f * 0.20)
        sw = w / 2 - f * 1.4
        s.box((sw, h - f * 2 - 0.02, 0.040), (cx, h / 2, zc + 0.006), 'tint',
              bevel=0.004, name='sash')
        s.box((sw - 0.075, h - f * 2 - 0.095, 0.010), (cx, h / 2, zc + 0.006), 'glass',
              bevel=0.0, name='glazing')
    s.cyl(0.020, 0.020, 0.018, (-f * 0.55, h / 2, zc + 0.030), 'chrome', seg=10,
          axis='z', bevel=0.003, name='handle-rose')
    s.box((0.022, 0.105, 0.020), (-f * 0.55, h / 2 - 0.05, zc + 0.040), 'chrome',
          bevel=0.004, name='handle')
    s.box((w - 0.02, 0.026, 0.120), (0, 0.013, 0.065), 'accent', bevel=0.006, name='sill')
    return s


# ---------------------------------------------------------------------------
# lighting and plants


def pendant_lamp(e):
    """Approved in review. Ceiling anchor: y = 0 at the soffit, hanging into -Y,
    exactly like the placeholder the reviewer signed off.
    """
    w, sh, _ = e['size']                 # 0.40 shade dia, 0.24 shade height
    drop = e.get('mount') or 1.20
    s = Shape(e['id'], 'ceiling', [w, None, w])
    s.cyl(0.048, 0.048, 0.022, (0, -0.011, 0), 'metal', seg=12, bevel=0.004, name='canopy')
    s.cyl(0.0045, 0.0045, drop, (0, -drop / 2, 0), 'graphite', seg=6, bevel=0.0, name='cord')
    s.cyl(w / 2, w / 2 * 0.34, sh, (0, -drop - sh / 2, 0), 'tint', seg=18,
          bevel=0.004, name='shade')
    s.cyl(0.022, 0.022, 0.05, (0, -drop - sh + 0.03, 0), 'metal', seg=10,
          bevel=0.003, name='lampholder')
    s.cyl(0.030, 0.026, 0.055, (0, -drop - sh + 0.075, 0), 'glass', seg=10,
          bevel=0.004, name='bulb')
    return s


def plant_ficus_large(e):
    """Individual leaf cards on branching stems in three greens, in a real pot
    with soil. The placeholder was five green cylinders -- a blob with no
    silhouette, which is exactly what the reviewer objected to.
    """
    spread, h, _ = e['size']             # 0.80 x 1.80 x 0.80
    s = Shape(e['id'], 'floor', [spread, h, spread])
    pot_h, pot_r = 0.36, 0.165
    s.taper((pot_r * 1.5, pot_r * 1.5), (pot_r * 2.05, pot_r * 2.05), (0, pot_h / 2, 0),
            axis='y', length=pot_h, slot='tint', bevel=0.010, name='pot')
    s.cyl(pot_r * 1.06, pot_r * 1.06, 0.035, (0, pot_h - 0.017, 0), 'tint', seg=18,
          bevel=0.006, name='pot-rim')
    s.cyl(pot_r * 0.98, pot_r * 0.98, 0.045, (0, pot_h - 0.055, 0), 'soil', seg=18,
          bevel=0.004, name='soil')

    trunk = [(0.0, pot_h - 0.06, 0.0), (0.014, 0.70, -0.012), (-0.020, 1.10, 0.016),
             (0.012, 1.44, -0.008)]
    s.tube(trunk, 0.034, 'stem', seg=6, name='trunk')
    s.tube([(0.012, 1.42, -0.008), (0.004, 1.62, 0.004)], 0.021, 'stem', seg=6, name='trunk-top')

    rng = _Rng(20260827)
    tips = []
    for i in range(16):
        a = i * 2.39996 + rng.f(-0.22, 0.22)      # golden angle: no two branches stack up
        base_t = 0.40 + 0.60 * (i / 15.0)      # a spiral up the trunk, not four tiers
        by = pot_h + (1.44 - pot_h) * base_t
        bx = 0.012 * math.sin(base_t * 3)
        reach = spread * rng.f(0.22, 0.40)
        rise = rng.f(0.10, 0.30)
        mid = (bx + math.sin(a) * reach * 0.45, by + rise * 0.65, math.cos(a) * reach * 0.45)
        tip = (bx + math.sin(a) * reach, by + rise, math.cos(a) * reach)
        s.tube([(bx, by, 0.0), mid, tip], rng.f(0.010, 0.015), 'stem', seg=5, name='branch')
        tips.append((mid, tip, a))
    tips.append(((0.004, 1.56, 0.004), (0.004, 1.70, 0.004), 0.0))

    greens = ('foliage', 'foliage2', 'foliage3')
    n = 0
    for mid, tip, a in tips:
        for k in range(9):
            t = 0.24 + 0.92 * k / 8.0      # the last leaf sits past the tip, hiding it
            px = mid[0] + (tip[0] - mid[0]) * t
            py = mid[1] + (tip[1] - mid[1]) * t
            pz = mid[2] + (tip[2] - mid[2]) * t
            lw = rng.f(0.070, 0.105)
            lh = rng.f(0.105, 0.155)
            yaw = a + rng.f(-0.9, 0.9)
            pitch = rng.f(-0.85, -0.15)
            roll = rng.f(-0.45, 0.45)
            off = lh * 0.42
            s.card((lw, lh),
                   (px + math.sin(yaw) * off * 0.55,
                    py + off * 0.42,
                    pz + math.cos(yaw) * off * 0.55),
                   greens[n % 3], rot=(pitch, yaw, roll), name='leaf')
            n += 1
    return s


class _Rng:
    """Deterministic little LCG -- the catalogue must build byte-identically."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (1103515245 * self.s + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF

    def f(self, lo, hi):
        return lo + (hi - lo) * self.next()


# ---------------------------------------------------------------------------
# beds


def bed_double_1600(e):
    """Approved in review -- rebuilt joined and bevelled."""
    w, h, d = e['size']                  # 1.60 x 0.55 x 2.00 (h = mattress top)
    s = Shape(e['id'], 'floor', None)
    frame_h = 0.34
    s.box((w, frame_h - 0.10, d - 0.04), (0, 0.10 + (frame_h - 0.10) / 2, 0), 'wood',
          bevel=0.010, name='frame')
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.box((0.07, 0.12, 0.07), (sx * (w / 2 - 0.06), 0.06, sz * (d / 2 - 0.06)),
                  'woodDark', bevel=0.006, name='foot')
    s.box((w - 0.07, 0.22, d - 0.09), (0, frame_h + 0.09, 0.01), 'tint',
          bevel=0.020, name='mattress')
    s.box((w, 0.95, 0.055), (0, 0.475, -d / 2 + 0.027), 'wood', bevel=0.012, name='headboard')
    for sx in (-1, 1):
        s.box((w * 0.42, 0.10, 0.38), (sx * w * 0.23, frame_h + 0.24, -d / 2 + 0.30),
              'tint', bevel=0.030, name='pillow')
    s.box((w - 0.07, 0.055, d * 0.52), (0, frame_h + 0.21, d * 0.22), 'fabric',
          bevel=0.014, name='throw')
    return s


# ---------------------------------------------------------------------------
# retail


def espresso_machine(e):
    """A two-group commercial machine. The placeholder was procBlock() -- one
    box, which is precisely the "czarny kwadrat" the reviewer rejected.
    """
    w, h, d = e['size']                  # 0.75 x 0.55 x 0.55
    s = Shape(e['id'], 'floor', None)
    body_front = 0.19

    s.box((w - 0.03, 0.055, 0.42), (0, 0.028, -0.03), 'chrome', bevel=0.004, name='drip-tray')
    for i in range(6):
        s.box((w - 0.10, 0.010, 0.016), (0, 0.060, -0.03 - 0.145 + i * 0.058), 'chrome',
              bevel=0.0, name='grille-bar')
    s.box((w - 0.09, 0.012, 0.36), (0, 0.058, -0.03), 'graphite', bevel=0.0, name='tray-well')

    s.box((w - 0.05, 0.38, 0.44), (0, 0.25, -0.03), 'graphite', bevel=0.012, name='body')
    for sgn in (-1, 1):
        s.box((0.030, 0.34, 0.40), (sgn * (w / 2 - 0.015), 0.25, -0.03), 'chrome',
              bevel=0.010, name='cheek')
    s.box((w - 0.06, 0.085, 0.022), (0, 0.315, body_front - 0.004), 'chrome',
          bevel=0.006, name='front-band')

    for sgn in (-1, 1):
        x = sgn * 0.165
        s.box((0.115, 0.10, 0.10), (x, 0.185, body_front - 0.03), 'chrome',
              bevel=0.010, name='group-body')
        s.cyl(0.052, 0.048, 0.055, (x, 0.128, body_front - 0.02), 'chrome', seg=8,
              name='group-head')
        s.cyl(0.058, 0.058, 0.030, (x, 0.098, body_front - 0.02), 'chrome', seg=8,
              bevel=0.0, name='portafilter')
        s.tube([(x, 0.100, body_front + 0.005), (x, 0.098, body_front + 0.060),
                (x, 0.094, body_front + 0.098)], 0.013, 'graphite', seg=6, name='pf-handle')
        s.cyl(0.020, 0.020, 0.020, (x, 0.100, body_front + 0.010), 'chrome', seg=8,
              axis='z', bevel=0.0, name='pf-ferrule')

    for sgn in (-1, 1):
        x = sgn * 0.30
        s.cyl(0.026, 0.026, 0.030, (x, 0.29, body_front - 0.02), 'chrome', seg=10,
              axis='z', bevel=0.004, name='steam-knob')
        s.tube([(x, 0.285, body_front - 0.03), (x, 0.235, body_front + 0.02),
                (x * 0.90, 0.150, body_front + 0.010), (x * 0.88, 0.105, body_front - 0.01)],
               0.0085, 'chrome', seg=5, name='steam-wand')

    s.cyl(0.046, 0.046, 0.022, (0, 0.315, body_front - 0.002), 'chrome', seg=10,
          axis='z', bevel=0.0, name='gauge-bezel')
    s.cyl(0.036, 0.036, 0.008, (0, 0.315, body_front + 0.010), 'paper', seg=10,
          axis='z', bevel=0.0, name='gauge-face')
    s.box((0.006, 0.030, 0.006), (0, 0.325, body_front + 0.014), 'accent',
          rot=(0, 0, 0.5), bevel=0.0, name='gauge-needle')

    s.box((w - 0.05, 0.022, 0.40), (0, 0.451, -0.05), 'chrome', bevel=0.0, name='warmer-top')
    for sgn in (-1, 1):
        s.box((0.014, 0.028, 0.38), (sgn * (w / 2 - 0.045), 0.474, -0.05), 'chrome',
              bevel=0.0, name='warmer-rail')
    s.box((w - 0.10, 0.028, 0.014), (0, 0.474, -0.24), 'chrome', bevel=0.0, name='warmer-rail-b')
    cups = ((-0.21, -0.14), (-0.04, -0.16), (0.13, -0.13), (-0.12, 0.04), (0.13, 0.04))
    for cx, cz in cups:
        s.cyl(0.030, 0.034, 0.052, (cx, 0.488, cz), 'ceramic', seg=6,
              bevel=0.0, name='cup')

    s.box((w - 0.06, 0.115, 0.16), (0, 0.492, -0.17), 'tint', bevel=0.010, name='boiler-housing')
    s.box((0.20, 0.030, 0.012), (0, 0.520, -0.093), 'graphite', bevel=0.0, name='badge')
    return s


BUILDERS = {
    'chair-task': chair_task,
    'sofa-3seat': sofa_3seat,
    'exam-couch': exam_couch,
    'table-dining-4': table_dining_4,
    'desk-reception': desk_reception,
    'wc-floor': wc_floor,
    'basin-560': basin_560,
    'kitchen-base-sink-800': kitchen_base_sink_800,
    'fridge-freezer-tall': fridge_freezer_tall,
    'door-internal-900': door_internal_900,
    'window-1200x1400': window_1200x1400,
    'pendant-lamp': pendant_lamp,
    'plant-ficus-large': plant_ficus_large,
    'bed-double-1600': bed_double_1600,
    'espresso-machine': espresso_machine,
}

# Items whose finished bounding box is deliberately NOT the catalogue number.
# Each one is reported to the catalogue's owner with a recommended value; none
# of them is scaled to hide the difference.
SIZE_OVERRIDES = {
    'table-dining-4': (1.60, 0.75, 0.90),
}

# Per-item fit tolerance. Joinery is built to the millimetre and gets the 4 %
# default; an organic canopy has no canonical spread, so the ficus may be nudged
# further onto its declared 0.80 m without that meaning anything is wrong.
FIT_MAX = {
    'plant-ficus-large': 0.14,
}

FIT_AXES = {
    'plant-ficus-large': 'xz',
    'chair-task': 'xyz',
    'desk-reception': 'xyz',
    'wc-floor': 'xyz',
}
