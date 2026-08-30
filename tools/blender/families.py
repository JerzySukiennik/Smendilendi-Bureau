"""families.py -- the parametric family scripts, one per catalogue FAMILY.

WHAT CHANGED AND WHY
--------------------
The first version of this file had one bespoke function per item id and covered
15 of the catalogue's 122 entries. The other 107 fell through to a completely
different geometry path (src/model/proc-shapes.js): raw unbevelled boxes that no
verifier ever looked at, with a bath that was a solid sideboard, a corner sofa
with no L return and a stair whose handrail ran through the ceiling. A critic
walked the office and found them in ten seconds.

DESIGN-DECISIONS.md asks for "parametric scripts that generate whole families
(one 'chairs' script -> many variants)", so the registry is now keyed on the
catalogue's own `proc` function name -- the same family label the runtime uses --
and every one of the 122 entries resolves to a builder here. `builder_for(entry)`
is the only entry point; there is no per-id table to fall out of date.

Every builder takes the CATALOGUE ENTRY, so dimensions come from
src/model/catalog.js and are never typed twice, and returns a Shape.
`build.finish()` asserts solidity (faces that actually intersect, not boxes that
overlap), bevels, joins per material slot and applies the anchor rule.

JOINTS INTERPENETRATE, they do not abut: a leg runs up INTO the seat, a cistern
sits ON the pan's rear shoulder, a waste is sunk INTO the bowl floor the bowl
itself reports back. Anything that merely floats near its host is now caught.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))

from build import Shape                                  # noqa: E402

TAU = math.pi * 2


class _Rng:
    """Deterministic little LCG -- the catalogue must build byte-identically."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (1103515245 * self.s + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF

    def f(self, lo, hi):
        return lo + (hi - lo) * self.next()


def body(e, alt='metal'):
    """The main colour region.

    A colourable item MUST carry a `tint` slot (the runtime multiplies the
    player's colour into it) and an item the catalogue marks non-colourable must
    NOT: a tinted WC pan and a tinted espresso machine were both shipped last
    round because the family script picked the slot without asking the entry.
    """
    return 'tint' if e.get('colorable', True) else alt


def args_of(e):
    return list(e.get('proc') or [])[1:]


def _sh(e, default):
    return e.get('seatHeight') or default


def _on(pos, tilt, dy=0.0, dz=0.0):
    """World position of a point that sits at local (0, dy, dz) inside a part
    which is centred at `pos` and rotated `tilt` radians about X.

    Rotating a child about its OWN centre while offsetting it along the world
    axes is what lifted the reception card-reader screen 2.8 mm off its host.
    The offset has to travel with the parent's axes, which is what this does.
    """
    x, y, z = pos
    c, sn = math.cos(tilt), math.sin(tilt)
    return (x, y + dy * c - dz * sn, z + dy * sn + dz * c)


# ---------------------------------------------------------------------------
# SEATING
# ---------------------------------------------------------------------------


def fam_chair(e, a):
    """Four-legged chair with a real back: posts, slats and stretchers.

    Covers chair-dining and the two EN 1729 kids' sizes; everything scales off
    the catalogue envelope and the seat height, so a 0.26 m nursery chair comes
    out of the same script as a 0.45 m dining chair.
    """
    w, h, d = e['size']
    seat = _sh(e, h * 0.52)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    leg = max(0.030, w * 0.075)
    inset = leg / 2 + 0.012
    seat_t = max(0.030, h * 0.045)
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.taper((leg, leg), (leg * 0.78, leg * 0.78),
                    (sx * (w / 2 - inset), (seat - seat_t * 0.4) / 2, sz * (d / 2 - inset)),
                    axis='y', length=seat - seat_t * 0.4, slot='wood',
                    bevel=0.005, name='leg')
    # stretchers, so the legs are one body with each other as well as the seat
    for sz in (-1, 1):
        s.box((w - inset * 1.6, leg * 0.55, leg * 0.55),
              (0, seat * 0.36, sz * (d / 2 - inset)), 'wood', bevel=0.004, name='rail')
    s.box((w, seat_t, d), (0, seat - seat_t / 2, 0), slot,
          bevel=0.008, name='seat')
    back_h = h - seat
    post = leg * 0.92
    lean = -0.10
    for sx in (-1, 1):
        s.taper((post, post * 0.9), (post * 0.8, post * 0.8),
                (sx * (w / 2 - inset), seat + back_h / 2 - 0.02,
                 -d / 2 + inset + back_h * 0.05),
                axis='y', length=back_h + 0.04, slot='wood', rot=(lean, 0, 0),
                bevel=0.005, name='backpost')
    # the slats are set on the SAME lean and the SAME rake line as the posts, so
    # each one runs into both of them; the old version drifted forward with
    # height and the top slat ended up floating clear of the frame.
    post_cy = seat + back_h / 2 - 0.02
    post_z = -d / 2 + inset + back_h * 0.05
    for k, t in enumerate((0.45, 0.78)):
        y = seat + back_h * t
        # follow the raked post: a point dy up the post's own axis sits at
        # (dy*cos, dy*sin) away from the post centre, so the slat lands on the
        # posts at every height instead of drifting forward off the frame.
        dy = (y - post_cy) / math.cos(lean)
        s.box((w - inset * 1.2, back_h * 0.18, 0.030),
              (0, post_cy + dy * math.cos(lean), post_z + dy * math.sin(lean)),
              slot, rot=(lean, 0, 0), bevel=0.006, name=f'slat{k}')
    return s


def fam_stack_chair(e, a):
    """Cantilever café/visitor chair: a bent steel frame, a shell and a back."""
    w, h, d = e['size']
    seat = _sh(e, 0.45)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'fabric')
    r = 0.014
    # the skid foot runs the full declared depth: a cantilever chair IS as deep
    # as its frame, and building it 0.06 short of the envelope at both ends is
    # what made chair-visitor measure 10.7 % under its own catalogue depth.
    fz = d / 2
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.045)
        s.tube([(x, 0.012, fz), (x, 0.012, -fz)], r, 'metal', seg=6, name='foot')
        s.tube([(x, 0.010, fz - 0.01), (x, seat * 0.55, fz - 0.02),
                (x, seat - 0.03, fz - 0.06), (x, seat - 0.03, -fz + 0.06),
                (x, seat + (h - seat) * 0.55, -fz + 0.03),
                (x, h - 0.05, -fz + 0.055)], r, 'metal', seg=6, name='cantilever')
    s.box((w, 0.035, d * 0.86), (0, seat - 0.018, d * 0.02), slot,
          bevel=0.012, name='seat')
    s.box((w - 0.06, (h - seat) * 0.52, 0.032),
          (0, seat + (h - seat) * 0.66, -fz + 0.055), slot,
          rot=(-0.12, 0, 0), bevel=0.014, name='back')
    s.box((w - 0.10, 0.026, 0.05), (0, seat - 0.035, -fz + 0.08), 'metal',
          bevel=0.005, name='seat-brace')
    return s


def fam_task_chair(e, a):
    """Real task-chair anatomy: five-star base on castors, gas lift, seat pan,
    backrest on a proper post, armrests attached to seat AND back.

    The original bug: the placeholder rotated each base arm by -a about Y while
    positioning it at angle a, so every arm pointed 90 - 2a away from its own
    castor. An arm is built along its own +Z here and yawed by exactly the angle
    it is placed at, which is the only transform that can be right.
    """
    s = Shape(e['id'], 'floor', e['size'])
    seat_h = _sh(e, 0.46)
    rc = 0.3098                     # castor centre radius; 5-star -> 0.650 m wide
    wheel_r, wheel_t = 0.032, 0.026

    s.cyl(0.062, 0.056, 0.10, (0, 0.06, 0), 'graphite', seg=8, name='hub')
    for i in range(5):
        a_ = TAU * i / 5
        sx, cz = math.sin(a_), math.cos(a_)
        s.taper((0.078, 0.072), (0.046, 0.034), (sx * rc / 2, 0.055, cz * rc / 2),
                axis='z', length=rc, slot='graphite', rot=(0, a_, 0), name=f'star{i}')
        s.box((0.038, 0.058, 0.032), (sx * rc, 0.062, cz * rc), 'graphite',
              rot=(0, a_, 0), name=f'yoke{i}')
        s.cyl(wheel_r, wheel_r, wheel_t, (sx * rc, wheel_r, cz * rc), 'rubber',
              seg=8, axis='x', rot=(0, a_, 0), bevel=0.0, name=f'castor{i}')

    s.cyl(0.048, 0.044, 0.15, (0, 0.145, 0), 'chrome', seg=8, name='shroud')
    s.cyl(0.036, 0.036, 0.27, (0, 0.235, 0), 'chrome', seg=8, bevel=0.0, name='gaslift')
    s.box((0.22, 0.045, 0.28), (0, 0.385, 0.03), 'graphite', name='mechanism')
    s.box((0.05, 0.06, 0.10), (0.16, 0.375, 0.10), 'graphite', bevel=0.004, name='lever')

    s.box((0.50, 0.075, 0.47), (0, seat_h - 0.037, 0.035), body(e, 'fabric'),
          bevel=0.020, name='seat')

    lean = -0.17
    s.box((0.095, 0.30, 0.075), (0, 0.55, -0.185), 'graphite', rot=(lean, 0, 0), name='post')
    s.taper((0.44, 0.075), (0.40, 0.065), (0, 0.885, -0.248), axis='y', length=0.40,
            slot=body(e, 'fabric'), rot=(lean, 0, 0), bevel=0.016, name='back')
    s.box((0.42, 0.075, 0.055), (0, 0.695, -0.222), 'graphite', rot=(lean, 0, 0),
          bevel=0.010, name='lumbar')

    for sgn in (-1, 1):
        x = sgn * 0.235
        s.box((0.036, 0.24, 0.048), (x, 0.53, -0.02), 'graphite', name='armstem')
        s.box((0.050, 0.030, 0.28), (x, 0.670, -0.03), 'graphite', bevel=0.012, name='armpad')
        s.box((0.040, 0.040, 0.13), (sgn * 0.225, 0.668, -0.19), 'graphite', name='armlink')
    return s


def _sofa_run(s, e, x0, x1, z0, z1, h, seat, arms, slot, n_seats, tag=''):
    """One straight run of upholstery. The corner sofa is two of these."""
    w = x1 - x0
    d = z1 - z0
    cx = (x0 + x1) / 2
    cz = (z0 + z1) / 2
    plinth = 0.12
    arm_w = 0.19 if arms else 0.0
    back_t = 0.17
    s.box((w, plinth, d), (cx, plinth / 2, cz), 'wood', bevel=0.010, name=f'plinth{tag}')
    for side, sgn in arms:
        s.box((arm_w, h - 0.24, d - 0.03),
              (cx + sgn * (w / 2 - arm_w / 2), plinth + (h - 0.24) / 2 - 0.02, cz),
              'fabric', bevel=0.030, name=f'arm{tag}')
    inner_w = w - arm_w * len(arms)
    inner_cx = cx + (arm_w / 2) * (-sum(sgn for _, sgn in arms))
    s.box((inner_w + 0.02, h - seat + 0.06, back_t),
          (inner_cx, seat + (h - seat) / 2 - 0.03, z0 + back_t / 2), 'fabric',
          bevel=0.026, name=f'backrest{tag}')
    cw = inner_w / max(1, n_seats)
    for i in range(max(1, n_seats)):
        x = inner_cx - inner_w / 2 + cw * (i + 0.5)
        s.box((cw - 0.02, seat - plinth + 0.03, d - back_t - 0.05),
              (x, plinth + (seat - plinth) / 2, cz + back_t / 2 - 0.01), slot,
              bevel=0.026, name=f'cushion{tag}')
        s.box((cw - 0.05, h - seat - 0.10, 0.11),
              (x, seat + (h - seat) / 2 - 0.02, z0 + back_t + 0.03), slot,
              bevel=0.026, name=f'backcushion{tag}')


def fam_sofa(e, a):
    """Upholstery family: armchair, 2/3-seater, waiting bench and the CORNER
    sofa, which is an L and was previously built as a straight sofa 0.95 m deep
    in a 1.90 m envelope -- half the piece was simply missing.
    """
    w, h, d = e['size']
    seats = int(a[3]) if len(a) > 3 else 2
    seat = _sh(e, 0.42)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'fabric')

    if d < 0.72:                       # slim waiting bench: legs, slats, no plinth
        leg_h = seat - 0.05
        for sx in (-1, 1):
            x = sx * (w / 2 - 0.09)
            s.tube([(x, 0.01, d / 2 - 0.018), (x, leg_h, d / 2 - 0.04),
                    (x, leg_h, -d / 2 + 0.04), (x, 0.01, -d / 2 + 0.018)],
                   0.016, 'metal', seg=6, name='leg-frame')
            s.box((0.05, 0.05, d), (x, leg_h - 0.02, 0), 'metal',
                  bevel=0.004, name='leg-top')
        s.box((w - 0.06, 0.05, d * 0.62), (0, seat - 0.02, d * 0.14), slot,
              bevel=0.014, name='seat')
        # the back is carried on two uprights that rise out of the leg frame,
        # so the whole bench is one body instead of a slab hovering behind it
        for sx in (-1, 1):
            x = sx * (w / 2 - 0.09)
            s.box((0.045, (h - seat) + 0.10, 0.045),
                  (x, seat + (h - seat) / 2 - 0.03, -d / 2 + 0.075), 'metal',
                  rot=(-0.14, 0, 0), bevel=0.005, name='back-post')
        s.box((w - 0.06, (h - seat) * 0.72, 0.045),
              (0, seat + (h - seat) * 0.55, -d / 2 + 0.075), slot,
              rot=(-0.14, 0, 0), bevel=0.014, name='back')
        s.box((w - 0.12, 0.035, 0.05), (0, seat - 0.03, -d / 2 + 0.075), 'metal',
              bevel=0.005, name='brace')
        for i in range(seats - 1):
            x = -w / 2 + w * (i + 1) / seats
            s.box((0.02, 0.055, d * 0.60), (x, seat + 0.005, d * 0.14), 'metal',
                  bevel=0.004, name='divider')
        return s

    if d > 1.15:                       # corner: main run at the front, return along -x
        run_d = 0.95
        z0 = d / 2 - run_d
        _sofa_run(s, e, -w / 2, w / 2, z0, d / 2, h, seat,
                  [('right', 1)], slot, max(1, seats - 1))
        _sofa_run(s, e, -w / 2, -w / 2 + run_d, -d / 2, z0 + 0.02, h, seat,
                  [], slot, 1, tag='-ret')
        # the return's own back, along -x, and the corner cushion tying them
        s.box((0.17, h - seat + 0.06, d - run_d + 0.04),
              (-w / 2 + 0.085, seat + (h - seat) / 2 - 0.03, (-d / 2 + z0) / 2),
              'fabric', bevel=0.026, name='back-ret')
        s.box((run_d - 0.02, h - 0.24, 0.19),
              (-w / 2 + run_d / 2, 0.12 + (h - 0.24) / 2 - 0.02, -d / 2 + 0.095),
              'fabric', bevel=0.030, name='arm-ret')
        s.box((run_d - 0.20, 0.20, 0.34), (-w / 2 + run_d / 2 + 0.02, seat + 0.06, z0 + 0.10),
              slot, bevel=0.030, name='corner-cushion')
    else:
        _sofa_run(s, e, -w / 2, w / 2, -d / 2, d / 2, h, seat,
                  [('left', -1), ('right', 1)], slot, seats)
    # feet go under the plinths that actually exist: on an L the back-right
    # corner of the bounding box is empty floor, and a foot there floated.
    if d > 1.15:
        run_d = 0.95
        z0 = d / 2 - run_d
        feet = [(-w / 2 + 0.10, d / 2 - 0.10), (w / 2 - 0.10, d / 2 - 0.10),
                (w / 2 - 0.10, z0 + 0.10), (-w / 2 + 0.10, -d / 2 + 0.10),
                (-w / 2 + run_d - 0.10, -d / 2 + 0.10)]
    else:
        feet = [(sx * (w / 2 - 0.10), sz * (d / 2 - 0.10))
                for sx in (-1, 1) for sz in (-1, 1)]
    for fx, fz in feet:
        s.cyl(0.026, 0.022, 0.075, (fx, 0.036, fz), 'woodDark', seg=8, name='foot')
    return s


def fam_stool(e, a):
    """Bar stool (four splayed legs, footring) and the clinic gas-lift stool."""
    w, h, d = e['size']
    seat = _sh(e, h - 0.02)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'fabric')
    if 'exam' in e['id'] or h < 0.7:                      # gas-lift stool on castors
        rc = w / 2 - 0.03
        s.cyl(0.050, 0.046, 0.08, (0, 0.05, 0), 'graphite', seg=8, name='hub')
        for i in range(5):
            a_ = TAU * i / 5
            sx, cz = math.sin(a_), math.cos(a_)
            s.taper((0.060, 0.055), (0.038, 0.028), (sx * rc / 2, 0.048, cz * rc / 2),
                    axis='z', length=rc, slot='graphite', rot=(0, a_, 0), name='star')
            s.cyl(0.026, 0.026, 0.022, (sx * rc, 0.026, cz * rc), 'rubber', seg=8,
                  axis='x', rot=(0, a_, 0), bevel=0.0, name='castor')
        s.cyl(0.040, 0.036, 0.13, (0, 0.12, 0), 'chrome', seg=8, name='shroud')
        s.cyl(0.028, 0.028, seat - 0.20, (0, (seat + 0.16) / 2, 0), 'chrome', seg=8,
              bevel=0.0, name='gaslift')
        s.cyl(w / 2, w / 2 - 0.015, 0.07, (0, seat - 0.035, 0), slot, seg=16,
              bevel=0.014, name='seat')
        if h > seat + 0.02:                       # low back, up to the envelope
            s.box((0.040, (h - seat) + 0.06, 0.040), (0, seat + (h - seat) / 2 - 0.02,
                  -w / 2 + 0.06), 'chrome', bevel=0.004, name='back-post')
            s.box((w * 0.62, (h - seat) * 0.62, 0.045), (0, h - (h - seat) * 0.31,
                  -w / 2 + 0.075), slot, rot=(-0.16, 0, 0), bevel=0.014, name='back')
        return s
    s.cyl(w / 2, w / 2 - 0.010, 0.055, (0, seat - 0.027, 0), slot, seg=16,
          bevel=0.012, name='seat')
    s.cyl(w / 2 - 0.06, w / 2 - 0.06, 0.03, (0, seat - 0.065, 0), 'wood', seg=12,
          bevel=0.004, name='seat-frame')
    for i in range(4):
        a_ = TAU * (i + 0.5) / 4
        sx, cz = math.sin(a_), math.cos(a_)
        s.tube([(sx * (w / 2 - 0.055), seat - 0.045, cz * (d / 2 - 0.055)),
                (sx * (w / 2 - 0.010), 0.01, cz * (d / 2 - 0.010))],
               0.014, 'metal', seg=6, name='leg')
    ring_y = seat * 0.30
    s.ring((w * 0.86, d * 0.86), (w * 0.86 - 0.026, d * 0.86 - 0.026), 0.016,
           (0, ring_y, 0), 'metal', seg=16, bevel=0.0, name='footring')
    return s


# ---------------------------------------------------------------------------
# TABLES, DESKS AND COUNTERS
# ---------------------------------------------------------------------------


def fam_table(e, a):
    """Rectangular table: top, apron, four tapered legs. Dining, coffee, meeting,
    bar-height and the two EN 1729 school sizes all come out of this."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    top_t = 0.038 if h > 0.6 else 0.030
    apron = min(0.085, h * 0.16)
    inset = min(0.09, w * 0.06, d * 0.09)
    s.box((w, top_t, d), (0, h - top_t / 2, 0), slot, bevel=0.012, name='top')
    for sz in (-1, 1):
        s.box((w - inset * 2 - 0.02, apron, 0.026),
              (0, h - top_t - apron / 2 + 0.008, sz * (d / 2 - inset)), 'wood',
              bevel=0.005, name='apron-long')
    for sx in (-1, 1):
        s.box((0.026, apron, d - inset * 2 - 0.02),
              (sx * (w / 2 - inset), h - top_t - apron / 2 + 0.008, 0), 'wood',
              bevel=0.005, name='apron-short')
    lw = 0.075 if h > 0.6 else 0.055
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.taper((lw, lw), (lw * 0.7, lw * 0.7),
                    (sx * (w / 2 - inset), (h - 0.02) / 2, sz * (d / 2 - inset)),
                    axis='y', length=h - 0.02, slot='wood', bevel=0.007, name='leg')
    if h > 0.95:                                     # bar height: a foot rail
        for sz in (-1, 1):
            s.box((w - inset * 2, 0.030, 0.030), (0, 0.24, sz * (d / 2 - inset)),
                  'metal', bevel=0.004, name='footrail')
    return s


def fam_round_table(e, a):
    """Round table on a column and a cross foot -- or four legs at nursery size."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    top_t = 0.036
    seg = 20 if w > 0.9 else 16
    s.cyl(w / 2, w / 2, top_t, (0, h - top_t / 2, 0), slot, seg=seg,
          bevel=0.010, name='top')
    s.cyl(w * 0.20, w * 0.16, 0.05, (0, h - top_t - 0.02, 0), 'metal', seg=12,
          bevel=0.005, name='top-plate')
    if h < 0.6:                                        # kids' table: four legs
        for i in range(4):
            a_ = TAU * (i + 0.5) / 4
            s.taper((0.05, 0.05), (0.038, 0.038),
                    (math.sin(a_) * (w / 2 - 0.09), (h - 0.02) / 2,
                     math.cos(a_) * (d / 2 - 0.09)),
                    axis='y', length=h - 0.02, slot='wood', bevel=0.006, name='leg')
        rr = (w / 2 - 0.09)
        for i in range(4):
            am = TAU * (i + 1) / 4
            s.box((rr * 1.55, 0.030, 0.030),
                  (math.sin(am) * rr * 0.71, h * 0.42, math.cos(am) * rr * 0.71),
                  'wood', rot=(0, am, 0), bevel=0.003, name='rail')
        return s
    s.cyl(0.060, 0.055, h - top_t, (0, (h - top_t) / 2, 0), 'metal', seg=12,
          bevel=0.006, name='column')
    for i in range(4):
        a_ = TAU * (i + 0.5) / 4
        s.taper((0.11, 0.055), (0.055, 0.022),
                (math.sin(a_) * w * 0.16, 0.028, math.cos(a_) * d * 0.16),
                axis='z', length=w * 0.34, slot='metal', rot=(0, a_, 0),
                bevel=0.005, name='foot')
    return s


def fam_desk(e, a):
    """Office desk family: 1600 straight, 1800 corner (L top) and the 3200
    back-to-back bench. A-frame legs, modesty panel, cable tray, grommet."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    top_t = 0.030
    bench = d > 1.3 and w > 2.4
    corner = d > 1.0 and not bench

    top_y0 = h - top_t                 # underside of the worktop

    def leg_frame(x, z0, z1, wing=True):
        """An A-frame end. Post, foot and beam all INTERPENETRATE: the beam runs
        up into the worktop, the post runs up into the beam and down into the
        foot, and the glides stand proud below the foot. The old version stopped
        the post 25 mm short of the top, so every desk was a worktop hovering
        over two loose leg frames."""
        dz = z1 - z0
        cz = (z0 + z1) / 2
        post_h = top_y0 + 0.006 - 0.030
        s.box((0.05, post_h, 0.05), (x, 0.030 + post_h / 2, cz), 'metal',
              bevel=0.006, name='leg-post')
        s.box((0.06, 0.030, dz), (x, 0.045, cz), 'metal', bevel=0.006, name='leg-foot')
        s.box((0.06, 0.040, dz), (x, top_y0 - 0.010, cz), 'metal',
              bevel=0.005, name='leg-beam')
        if wing:
            for sz in (-1, 1):
                s.cyl(0.020, 0.020, 0.040, (x, 0.020, cz + sz * (dz / 2 - 0.04)),
                      'rubber', seg=8, bevel=0.0, name='glide')

    if bench:
        # the two tops LAP at the spine (they used to leave a 20 mm slot)
        s.box((w, top_t, d / 2 + 0.006), (0, h - top_t / 2, -d / 4 + 0.003), slot,
              bevel=0.010, name='top-a')
        s.box((w, top_t, d / 2 + 0.006), (0, h - top_t / 2, d / 4 - 0.003), slot,
              bevel=0.010, name='top-b')
        for sx in (-1, 1):
            leg_frame(sx * (w / 2 - 0.09), -d / 2 + 0.06, d / 2 - 0.06)
        leg_frame(0, -d / 2 + 0.06, d / 2 - 0.06)
        # the screen sits IN the catalogue envelope: 0.74 is the desk, and a
        # 0.34 m screen on top of it would have been 43 % over the declared box
        s.box((w - 0.30, 0.16, 0.026), (0, top_y0 - 0.05, 0), body(e, 'fabric'),
              bevel=0.008, name='bench-screen')
        s.box((w - 0.20, 0.05, 0.16), (0, top_y0 - 0.055, 0), 'metal', bevel=0.006,
              name='cable-tray')
    else:
        s.box((w, top_t, d if not corner else 0.80),
              (0, h - top_t / 2, 0 if not corner else d / 2 - 0.40), slot,
              bevel=0.010, name='top')
        if corner:
            s.box((0.80, top_t, d - 0.80 + 0.02), (-w / 2 + 0.40, h - top_t / 2,
                  -d / 2 + (d - 0.80 + 0.02) / 2), slot, bevel=0.010, name='top-return')
            leg_frame(-w / 2 + 0.09, -d / 2 + 0.06, -d / 2 + 0.74)
        for sx in (-1, 1):
            z0 = (d / 2 - 0.74) if corner else (-d / 2 + 0.06)
            leg_frame(sx * (w / 2 - 0.09), z0, d / 2 - 0.06)
        # the modesty panel is hung off the leg beams (it laps them by 25 mm)
        # and the cable tray is bolted to the modesty panel
        mz = (-d / 2 + 0.10) if not corner else 0.06
        s.box((w - 0.22, 0.40, 0.022), (0, top_y0 - 0.205, mz),
              slot, bevel=0.006, name='modesty')
        s.box((w - 0.40, 0.05, 0.14), (0, top_y0 - 0.075, mz + 0.075),
              'metal', bevel=0.006, name='cable-tray')
    s.ring((0.08, 0.08), (0.056, 0.056), top_t + 0.008,
           (w / 2 - 0.22, h - top_t / 2,
            (d / 2 - 0.20) if (corner or bench) else (-d / 2 + 0.12)),
           'graphite', seg=12, bevel=0.0, name='grommet')
    return s


def fam_counter(e, a):
    """Reception / till / café counter: a raised transaction top over a lower
    work surface, a public front skin, a kick recess and the things a counter
    carries. The accessible ledge is CLAMPED INSIDE the carcase -- it used to
    push 15 mm out through the end panel and read as a rod impaling it.
    """
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    front = d / 2
    work_h = e.get('workHeight') or 0.74
    if work_h > h - 0.20:
        work_h = h - 0.35
    skin_t = 0.05
    low_w = min(0.92, w * 0.45)
    low_h = min(0.78, h - 0.30)
    low_x = w / 2 - low_w / 2
    end_in = w / 2 - skin_t                      # inner face of the end panel

    s.box((w - low_w, h - 0.14, skin_t), (-low_w / 2, 0.10 + (h - 0.14) / 2,
          front - skin_t / 2), slot, bevel=0.008, name='front-skin')
    s.box((low_w, low_h - 0.14, skin_t), (low_x, 0.10 + (low_h - 0.14) / 2,
          front - skin_t / 2), slot, bevel=0.008, name='front-skin-low')
    # both worktops stop at the carcase; the outer edge is flush, not overhanging
    ledge_w = min(low_w + 0.03, end_in - (low_x - low_w / 2))
    s.box((ledge_w, 0.042, 0.34), (low_x - low_w / 2 + ledge_w / 2, low_h - 0.021,
          front - 0.17), 'accent', bevel=0.010, name='accessible-ledge')
    s.box((ledge_w - 0.02, 0.016, 0.03), (low_x - low_w / 2 + ledge_w / 2, low_h - 0.050,
          front - 0.005), 'graphite', bevel=0.003, name='ledge-edge')
    for rx in (-w / 2 + w * 0.28, -w / 2 + w * 0.56):
        s.box((0.012, h - 0.20, 0.020), (rx, 0.13 + (h - 0.20) / 2, front - 0.041),
              'graphite', bevel=0.0, name='reveal')
    # the band is PROUD of the skin. Centred on `front - 0.038` inside a 50 mm
    # skin it was a stripe nobody could see on all three counters.
    s.box((w - low_w - 0.02, 0.020, 0.024), (-low_w / 2, h - 0.15, front - 0.006),
          'accent', bevel=0.004, name='band')
    # the plinth runs up BEHIND the shadow gap: stopping it dead level with the
    # skin left it a separate body sitting on the floor under the counter
    s.box((w - 0.08, 0.125, d - 0.06), (0, 0.0625, -0.01), 'graphite', name='plinth')
    s.box((w, 0.028, 0.018), (0, 0.115, front - 0.012), 'graphite',
          bevel=0.004, name='shadow-gap')
    for sgn in (-1, 1):
        s.box((skin_t, h - 0.12, d - 0.10), (sgn * (w / 2 - skin_t / 2),
              0.10 + (h - 0.12) / 2, -0.03), slot, bevel=0.008, name='return')
    top_w = w - low_w + 0.03
    s.box((top_w, 0.045, 0.36), (-w / 2 + top_w / 2, h - 0.0225, front - 0.18),
          'accent', bevel=0.010, name='transaction-top')
    s.box((top_w - 0.04, 0.016, 0.03), (-w / 2 + top_w / 2, h - 0.052, front - 0.005),
          'graphite', bevel=0.003, name='top-edge-detail')
    s.box((w - 0.09, 0.04, d - 0.24), (0, work_h - 0.02, -0.06), 'wood',
          bevel=0.008, name='work-surface')
    s.box((w - 0.30, 0.50, 0.022), (0, work_h - 0.27, front - 0.20), slot,
          bevel=0.005, name='modesty-panel')

    if 'reception' in e['id']:
        s.box((0.30, 0.026, 0.024), (-0.30, h - 0.16, front - 0.008), 'graphite',
              bevel=0.004, name='letterbox-slot')
        s.box((0.20, 0.018, 0.16), (-0.55, work_h + 0.009, -0.14), 'graphite',
              bevel=0.004, name='monitor-foot')
        s.box((0.06, 0.14, 0.05), (-0.55, work_h + 0.08, -0.14), 'graphite', name='monitor-stem')
        mon = (-0.55, work_h + 0.20, -0.155)
        s.box((0.46, 0.28, 0.032), mon, 'graphite',
              rot=(0.10, 0, 0), bevel=0.006, name='monitor')
        s.box((0.42, 0.24, 0.010), _on(mon, 0.10, dz=0.013), 'glass',
              rot=(0.10, 0, 0), bevel=0.0, name='monitor-screen')
        # A pull-out tray hangs BELOW the worktop. At work_h - 0.031 it was
        # inside the 40 mm slab, and the keyboard on it was inside it outright:
        # the receptionist's desk had no keyboard on it from any angle.
        s.box((0.46, 0.022, 0.22), (-0.55, work_h - 0.075, 0.05), 'graphite',
              bevel=0.004, name='keyboard-tray')
        for sx in (-1, 1):
            s.box((0.020, 0.060, 0.10), (-0.55 + sx * 0.21, work_h - 0.060, -0.03),
                  'graphite', bevel=0.0, name='tray-runner')
        s.box((0.40, 0.016, 0.15), (-0.55, work_h - 0.056, 0.05), slot,
              bevel=0.003, name='keyboard')
        # card reader: the screen is sunk INTO the reader's own front face, so
        # the -0.42 rad tilt cannot lift it off its host (it used to float 2.8 mm)
        rx_, ry_, rz_ = low_x + 0.28, low_h + 0.045, front - 0.20
        tilt = -0.42
        s.box((0.090, 0.135, 0.060), (rx_, ry_, rz_), 'graphite',
              rot=(tilt, 0, 0), bevel=0.006, name='card-reader')
        s.box((0.058, 0.042, 0.036), _on((rx_, ry_, rz_), tilt, dz=0.020),
              'accent', rot=(tilt, 0, 0), bevel=0.003, name='card-reader-screen')
        # The in-tray sits ON THE STAFF WORK SURFACE, which is both where one
        # lives and the only shelf here with headroom for it. Centred on the
        # transaction top it was inside that 45 mm slab, taking its paper with
        # it, and raising it there would have pushed the counter over its own
        # catalogue height.
        tray = s.shell((0.26, 0.042, 0.19), 0.030, 0.012,
                       (-w / 2 + 0.34, work_h + 0.019, -0.10), slot='accent',
                       name='tray')
        s.box((0.22, 0.010, 0.16), (-w / 2 + 0.34, tray.floor_y + 0.004, -0.10),
              'paper', bevel=0.0, name='tray-paper')
        s.box((0.24, 0.014, 0.16), (low_x - low_w / 2 + 0.10, low_h + 0.004, front - 0.20),
              'paper', bevel=0.0, name='leaflets')
    elif 'till' in e['id']:
        # the till stands ON the transaction top, not in the air above the low
        # ledge: it used to start exactly level with the top and never touch it
        tx = low_x
        s.box((0.34, 0.11, 0.30), (tx, low_h + 0.045, front - 0.24), 'graphite',
              bevel=0.008, name='till-base')
        scr = (tx, low_h + 0.17, front - 0.20)
        s.box((0.30, 0.22, 0.026), scr, 'graphite',
              rot=(0.22, 0, 0), bevel=0.005, name='till-screen')
        s.box((0.26, 0.17, 0.010), _on(scr, 0.22, dz=0.011), 'glass',
              rot=(0.22, 0, 0), bevel=0.0, name='till-glass')
        s.box((0.10, 0.14, 0.07), (low_x - 0.24, low_h + 0.06, front - 0.22),
              'graphite', rot=(-0.35, 0, 0), bevel=0.006, name='pin-pad')
    else:
        for i in range(3):
            s.cyl(0.055, 0.050, 0.10, (low_x - 0.30 + i * 0.28, low_h + 0.045,
                  front - 0.20), 'ceramic', seg=10, bevel=0.006, name='cup-stack')
        s.box((0.44, 0.030, 0.30), (low_x, low_h + 0.006, front - 0.22), 'metal',
              bevel=0.005, name='tray-rail')
    return s


# ---------------------------------------------------------------------------
# STORAGE
# ---------------------------------------------------------------------------


def _carcase(s, e, w, h, d, slot, plinth=0.08, back=True, plinth_box=True):
    body_h = h - plinth
    if plinth > 0.005 and plinth_box:
        # 10 mm of the plinth runs UP INSIDE the carcase. Butting the two flush
        # left every wardrobe, chest and filing cabinet standing on a loose slab.
        s.box((w - 0.06, plinth + 0.010, d - 0.06), (0, (plinth + 0.010) / 2, -0.01),
              'graphite', bevel=0.005, name='plinth')
    s.box((w, body_h, d - 0.02), (0, plinth + body_h / 2, -0.01), slot,
          bevel=0.008, name='carcase')
    return plinth, body_h


def fam_cabinet(e, a):
    """Doored cabinets: wardrobes (hinged and sliding), sideboard, lockers,
    the fitting-room cubicle and the wall-hung medicine cabinet."""
    w, h, d = e['size']
    doors = int(a[3]) if len(a) > 3 else 2
    plinth = float(a[4]) if len(a) > 4 else 0.08
    anchor = e.get('anchor', 'floor')
    s = Shape(e['id'], anchor, e['size'])
    slot = body(e, 'wood')

    if 'fitting-room' in e['id']:
        t = 0.04
        s.box((w, h, t), (0, h / 2, -d / 2 + t / 2), slot, bevel=0.006, name='back-panel')
        for sgn in (-1, 1):
            s.box((t, h, d - t), (sgn * (w / 2 - t / 2), h / 2, 0.01), slot,
                  bevel=0.006, name='side-panel')
        s.cyl(0.016, 0.016, w - 0.04, (0, h - 0.10, d / 2 - 0.06), 'metal', seg=8,
              axis='x', bevel=0.0, name='curtain-rail')
        for i in range(9):
            x = -w / 2 + 0.06 + i * (w - 0.12) / 8
            # the curtain head laps OVER the rail; it used to stop 15 mm below it
            s.box((0.075, h - 0.16, 0.030), (x, (h - 0.16) / 2 + 0.06, d / 2 - 0.060),
                  'fabric', rot=(0, 0.30 * (1 if i % 2 else -1), 0), bevel=0.010,
                  name='curtain')
        s.box((w - 0.14, 0.045, 0.34), (0, 0.44, -d / 2 + 0.20), 'wood',
              bevel=0.008, name='bench')
        for sgn in (-1, 1):
            s.box((0.05, 0.44, 0.05), (sgn * (w / 2 - 0.14), 0.22, -d / 2 + 0.20),
                  'wood', bevel=0.005, name='bench-leg')
        s.box((0.45, 1.30, 0.012), (0, 1.10, -d / 2 + 0.046), 'glass',
              bevel=0.0, name='mirror')
        s.box((0.50, 1.36, 0.014), (0, 1.10, -d / 2 + 0.040), 'metal',
              bevel=0.004, name='mirror-frame')
        for i in range(3):
            s.cyl(0.012, 0.018, 0.05, (-0.24 + i * 0.24, h - 0.34, -d / 2 + 0.06),
                  'metal', seg=8, axis='z', bevel=0.004, name='hook')
        return s

    plinth_h, body_h = _carcase(s, e, w, h, d, slot, plinth)
    fz = d / 2 - 0.020
    gap = 0.006
    if 'lockers' in e['id']:
        cols, rows = 2, max(1, doors // 2)
        for r in range(rows):
            for c in range(cols):
                dw = w / cols - gap * 2
                dh = body_h / rows - gap * 2
                x = -w / 2 + w / cols * (c + 0.5)
                y = plinth_h + body_h / rows * (r + 0.5)
                s.box((dw, dh, 0.024), (x, y, fz), slot, bevel=0.005, name='door')
                for k in range(3):                     # ventilation slots
                    s.box((dw * 0.5, 0.008, 0.020), (x, y + dh / 2 - 0.05 - k * 0.022,
                          fz + 0.008), 'graphite', bevel=0.0, name='vent')
                s.box((0.030, 0.075, 0.028), (x + dw / 2 - 0.05, y, fz + 0.010),
                      'metal', bevel=0.004, name='latch')
                s.box((0.05, 0.035, 0.014), (x - dw / 2 + 0.07, y + dh / 2 - 0.06,
                      fz + 0.008), 'paper', bevel=0.0, name='number-plate')
        return s

    sliding = 'sliding' in e['id']
    for i in range(doors):
        dw = w / doors
        x = -w / 2 + dw * (i + 0.5)
        z = fz + (0.014 if sliding and i % 2 else 0.0)
        s.box((dw - (0.0 if sliding else gap * 2), body_h - gap * 2, 0.026),
              (x, plinth_h + body_h / 2, z), slot, bevel=0.005, name='door')
        if sliding:
            s.box((dw - 0.10, body_h - 0.16, 0.008), (x, plinth_h + body_h / 2, z + 0.014),
                  'glass' if i == 1 else 'accent', bevel=0.0, name='door-inlay')
            s.box((0.030, body_h - 0.10, 0.030), (x + dw / 2 - 0.05,
                  plinth_h + body_h / 2, z + 0.012), 'metal', bevel=0.004, name='pull')
        elif h > 1.2:
            s.box((0.024, 0.22, 0.030), (x + (dw / 2 - 0.06) * (1 if i % 2 else -1),
                  plinth_h + body_h * 0.52, fz + 0.014), 'metal', bevel=0.005, name='handle')
        else:
            s.box((dw * 0.5, 0.020, 0.028), (x, plinth_h + body_h - 0.09, fz + 0.014),
                  'metal', bevel=0.004, name='handle')
    if sliding:
        s.box((w, 0.030, 0.070), (0, h - 0.015, d / 2 - 0.045), 'metal',
              bevel=0.004, name='track-top')
        s.box((w, 0.020, 0.070), (0, plinth_h + 0.010, d / 2 - 0.045), 'metal',
              bevel=0.004, name='track-bottom')
    if 'medicine' in e['id']:
        s.box((w - 0.10, h - 0.14, 0.008), (0, h / 2, fz + 0.015), 'glass',
              bevel=0.0, name='mirror')
    if 'wardrobe' in e['id'] and 'sliding' not in e['id']:
        # a cornice is a PROJECTION. Flush with the carcase in x and 10 mm
        # inside it in z, it was invisible from every angle a player can stand
        # in -- the same failure as the hanging rail it replaced. It reads now
        # because the doors and drawer fronts stop below it and it oversails
        # them at the front.
        s.box((w, 0.034, d), (0, h - 0.017, 0.0), 'graphite',
              bevel=0.006, name='cornice')
    return s


def fam_drawers(e, a):
    """Drawer units: chest, filing cabinet, bedside table, treatment trolley."""
    w, h, d = e['size']
    n = int(a[3]) if len(a) > 3 else 3
    plinth = float(a[4]) if len(a) > 4 else 0.06
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    trolley = 'trolley' in e['id']
    if trolley:
        plinth = 0.10
    # A trolley stands on its castors, not on a plinth. With one, all four
    # castors and all four yokes were inside it -- a treatment trolley that
    # could not be wheeled anywhere and read as a chest of drawers.
    plinth_h, body_h = _carcase(s, e, w, h, d, slot, plinth,
                                plinth_box=not trolley)
    fz = d / 2 - 0.018
    for i in range(n):
        dh = body_h / n
        y = plinth_h + dh * (i + 0.5)
        s.box((w - 0.012, dh - 0.008, 0.024), (0, y, fz), slot, bevel=0.005,
              name='drawer-front')
        if 'filing' in e['id'] or trolley:
            s.box((w * 0.42, 0.028, 0.030), (0, y + dh / 2 - 0.055, fz + 0.012),
                  'metal', bevel=0.005, name='pull')
            s.box((w * 0.30, 0.030, 0.010), (0, y - dh / 2 + 0.055, fz + 0.010),
                  'paper', bevel=0.0, name='label')
        else:
            s.box((w * 0.34, 0.018, 0.032), (0, y, fz + 0.014), 'metal',
                  bevel=0.005, name='handle')
    if trolley:
        for sx in (-1, 1):
            for sz in (-1, 1):
                s.cyl(0.030, 0.030, 0.022, (sx * (w / 2 - 0.07), 0.030,
                      sz * (d / 2 - 0.07)), 'rubber', seg=8, axis='x', bevel=0.0,
                      name='castor')
                s.box((0.030, 0.080, 0.030), (sx * (w / 2 - 0.07), 0.065,
                      sz * (d / 2 - 0.07)), 'metal', bevel=0.004, name='castor-yoke')
        s.box((w, 0.026, 0.026), (0, h + 0.013, -d / 2 + 0.06), 'metal',
              bevel=0.005, name='push-handle')
        for sx in (-1, 1):
            s.box((0.026, 0.10, 0.026), (sx * (w / 2 - 0.03), h - 0.04, -d / 2 + 0.06),
                  'metal', bevel=0.004, name='handle-post')
    return s


def fam_shelf(e, a):
    """Open shelving: bookcase, retail gondola (double sided) and toy cubbies."""
    w, h, d = e['size']
    n = int(a[3]) if len(a) > 3 else 4
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    t = 0.024
    gondola = 'gondola' in e['id']
    s.box((w - 0.04, 0.06, d - 0.06), (0, 0.03, 0), 'graphite', bevel=0.005, name='plinth')
    for sgn in (-1, 1):
        s.box((t, h - 0.06, d), (sgn * (w / 2 - t / 2), 0.06 + (h - 0.06) / 2, 0),
              slot, bevel=0.005, name='side')
    if gondola:
        s.box((w - t * 2, h - 0.10, 0.020), (0, 0.06 + (h - 0.10) / 2, 0), slot,
              bevel=0.004, name='spine')
    else:
        s.box((w - t * 2 + 0.008, h - 0.10, 0.016),
              (0, 0.06 + (h - 0.10) / 2, -d / 2 + 0.010), slot, bevel=0.004, name='back')
    for i in range(n + 1):
        y = 0.06 + (h - 0.09) * i / n
        if gondola:
            for sz in (-1, 1):
                s.box((w - t * 2 + 0.006, 0.022, d / 2 - 0.02),
                      (0, y, sz * (d / 4 + 0.005)), slot, bevel=0.004,
                      rot=(0.06 * sz, 0, 0), name='shelf')
        else:
            s.box((w - t * 2 + 0.006, 0.022, d - 0.03), (0, y, 0.004), slot,
                  bevel=0.004, name='shelf')
    if 'toy' in e['id']:
        for i in range(2):
            x = -w / 2 + w * (i + 1) / 3
            s.box((0.018, h - 0.12, d - 0.04), (x, 0.06 + (h - 0.12) / 2, 0), slot,
                  bevel=0.004, name='divider')
    return s


# ---------------------------------------------------------------------------
# BEDS
# ---------------------------------------------------------------------------


def fam_bed(e, a):
    """Beds and the examination couch. The catalogue height IS the envelope:
    0.55 m is a bed with a low bedhead, which is what it says, so the mesh no
    longer runs 73 % over its own declared size to fit a 0.95 m headboard.
    """
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'fabric')

    if 'exam-couch' in e['id']:
        top = h - 0.04
        s.box((w - 0.06, 0.10, d - 0.10), (0, top - 0.16, 0), 'graphite',
              bevel=0.008, name='chassis')
        for sx in (-1, 1):
            for sz in (-1, 1):
                s.cyl(0.030, 0.030, top - 0.16, (sx * (w / 2 - 0.07), (top - 0.16) / 2,
                      sz * (d / 2 - 0.10)), 'chrome', seg=8, name='leg')
                s.cyl(0.040, 0.040, 0.022, (sx * (w / 2 - 0.07), 0.012,
                      sz * (d / 2 - 0.10)), 'rubber', seg=8, bevel=0.003, name='foot')
        for sx in (-1, 1):
            s.box((0.032, 0.032, d - 0.24), (sx * (w / 2 - 0.07), 0.16, 0), 'chrome',
                  bevel=0.0, name='leg-brace')
        s.box((w - 0.10, 0.07, d - 0.14), (0, top - 0.115, 0), 'chrome',
              bevel=0.006, name='rail')
        s.box((w, 0.11, d * 0.62), (0, top - 0.045, d * 0.18), slot,
              bevel=0.016, name='seatpad')
        s.box((w, 0.11, d * 0.36), (0, top - 0.045, -d * 0.31), slot,
              bevel=0.016, name='backpad')
        s.box((w * 0.86, 0.055, 0.10), (0, top + 0.03, -d / 2 + 0.09), slot,
              bevel=0.020, name='bolster')
        s.cyl(0.048, 0.048, w * 0.80, (0, top - 0.14, -d / 2 + 0.05), 'paper',
              seg=10, axis='x', name='paperroll')
        return s

    bunk = h > 1.2
    mat_t = 0.20 if not bunk else 0.16
    deck = h - mat_t if not bunk else 0.32

    def berth(y):
        s.box((w, 0.10, d - 0.04), (0, y - 0.05, 0), 'wood', bevel=0.008, name='frame')
        s.box((w - 0.07, mat_t, d - 0.09), (0, y + mat_t / 2 - 0.012, 0.01), slot,
              bevel=0.020, name='mattress')
        for sx in (-1, 1):
            s.box((w * 0.40, 0.08, 0.34), (sx * w * 0.22, y + mat_t - 0.02,
                  -d / 2 + 0.28), 'tint' if e.get('colorable', True) else 'fabric',
                  bevel=0.026, name='pillow')

    if bunk:
        berth(deck)
        berth(h - 0.30)
        for sx in (-1, 1):
            for sz in (-1, 1):
                s.box((0.07, h, 0.07), (sx * (w / 2 - 0.045), h / 2,
                      sz * (d / 2 - 0.045)), 'wood', bevel=0.006, name='post')
        s.box((w - 0.10, 0.05, 0.05), (0, h - 0.30 + 0.30, -d / 2 + 0.05), 'wood',
              bevel=0.005, name='guard-rail')
        s.box((w - 0.10, 0.05, 0.05), (0, h - 0.30 + 0.30, d / 2 - 0.05), 'wood',
              bevel=0.005, name='guard-rail-f')
        for i in range(4):
            s.cyl(0.016, 0.016, 0.34, (0.0, deck + 0.22 + i * 0.24, d / 2 - 0.05),
                  'wood', seg=8, axis='x', bevel=0.0, name='ladder-rung')
        for sx in (-1, 1):
            s.box((0.05, h - deck - 0.10, 0.05), (sx * 0.17, deck + 0.30 + (h - deck) / 2 - 0.20,
                  d / 2 - 0.05), 'wood', bevel=0.005, name='ladder-stile')
        return s

    berth(deck)
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.box((0.07, deck - 0.06, 0.07), (sx * (w / 2 - 0.05), (deck - 0.06) / 2,
                  sz * (d / 2 - 0.05)), 'woodDark', bevel=0.006, name='foot')
    head_h = min(h, deck + mat_t + 0.02)
    s.box((w, head_h, 0.055), (0, head_h / 2, -d / 2 + 0.027), 'wood',
          bevel=0.012, name='bedhead')
    s.box((w - 0.07, 0.055, d * 0.46), (0, deck + mat_t - 0.03, d * 0.24), 'fabric',
          bevel=0.014, name='throw')
    return s


def fam_cot(e, a):
    """Child's cot: slatted sides, a drop side, a mattress at 0.42."""
    w, h, d = e['size']
    base = 0.42
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    post = 0.055
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.box((post, h, post), (sx * (w / 2 - post / 2), h / 2,
                  sz * (d / 2 - post / 2)), 'wood', bevel=0.006, name='post')
    s.box((w - post, 0.05, d - post), (0, base - 0.025, 0), 'wood',
          bevel=0.006, name='base')
    s.box((w - post - 0.03, 0.10, d - post - 0.03), (0, base + 0.05, 0), slot,
          bevel=0.016, name='mattress')
    for sz in (-1, 1):
        for y in (h - 0.04, base + 0.14):
            s.box((w - post, 0.05, 0.035), (0, y, sz * (d / 2 - post / 2)), 'wood',
                  bevel=0.005, name='rail')
        for i in range(9):
            x = -w / 2 + post / 2 + (w - post) * (i + 0.5) / 9
            s.cyl(0.011, 0.011, h - base - 0.14, (x, base + 0.14 + (h - base - 0.14) / 2,
                  sz * (d / 2 - post / 2)), 'wood', seg=6, bevel=0.0, name='slat')
    for sx in (-1, 1):
        for y in (h - 0.04, base + 0.14):
            s.box((0.035, 0.05, d - post), (sx * (w / 2 - post / 2), y, 0), 'wood',
                  bevel=0.005, name='end-rail')
        for i in range(5):
            z = -d / 2 + post / 2 + (d - post) * (i + 0.5) / 5
            s.cyl(0.011, 0.011, h - base - 0.14, (sx * (w / 2 - post / 2),
                  base + 0.14 + (h - base - 0.14) / 2, z), 'wood', seg=6,
                  bevel=0.0, name='end-slat')
    return s


# ---------------------------------------------------------------------------
# SANITARY
# ---------------------------------------------------------------------------


def _mixer(s, x, rim_y, z, slot='chrome', height=0.16, reach=0.10, name='tap'):
    """A deck mixer: base, body, spout, lever. Sits ON the rim it is given."""
    s.cyl(0.028, 0.026, 0.040, (x, rim_y + 0.014, z), slot, seg=8, name=name + '-base')
    s.cyl(0.020, 0.019, height, (x, rim_y + 0.014 + height / 2, z), slot, seg=8,
          name=name + '-body')
    s.tube([(x, rim_y + height, z), (x, rim_y + height + 0.014, z + reach * 0.55),
            (x, rim_y + height - 0.020, z + reach)], 0.0125, slot, seg=6,
           name=name + '-spout')
    s.box((0.020, 0.018, 0.070), (x, rim_y + height + 0.010, z - 0.022), slot,
          rot=(0.35, 0, 0), bevel=0.005, name=name + '-lever')


def fam_basin(e, a):
    """Washbasin: a rim with a real aperture, an oval bowl with a recess, a waste
    sunk INTO the bowl floor, an overflow and a mixer.

    The waste used to be positioned from a guessed offset and floated 6 mm above
    the bowl floor; the rim was a rectangle around a 12-sided bowl, so the
    corners stood open. Both numbers now come from the bowl itself.
    """
    w, h, d = e['size']
    rim_h = e.get('workHeight') or h
    pedestal = bool(a[3]) if len(a) > 3 else False
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'ceramic')
    rim_t = 0.045
    bowl_w = w - 0.11
    bowl_d = d - 0.13
    bowl_depth = min(0.165, d * 0.36)

    s.ring((w, d), (bowl_w - 0.012, bowl_d - 0.012), rim_t,
           (0, rim_h - rim_t / 2, 0.0), slot, seg=14, bevel=0.008,
           round_xz=False, corner=min(w, d) * 0.30, name='rim')
    bowl = s.shell((bowl_w, bowl_depth + 0.03, bowl_d), bowl_depth, 0.020,
                   (0, rim_h - rim_t / 2 - (bowl_depth + 0.03) / 2 + 0.004, 0.012),
                   slot=slot, round_xz=True, seg=12, name='bowl')
    s.cyl(0.026, 0.024, 0.020, (0, bowl.floor_y, 0.012), 'chrome', seg=8,
          bevel=0.003, name='waste')
    s.box((0.075, 0.014, 0.018), (0, rim_h - rim_t - 0.030, -bowl_d / 2 + 0.03),
          'graphite', bevel=0.0, name='overflow')

    if pedestal:
        # the foot runs 45 mm up inside the pedestal shaft (it used to stop
        # 45 mm short of it and stand on the floor as a separate lump)
        s.taper((w * 0.42, d * 0.54), (w * 0.31, d * 0.40), (0, 0.070, 0.0),
                axis='y', length=0.14, slot=slot, bevel=0.010, name='ped-foot')
        s.taper((w * 0.30, d * 0.39), (w * 0.33, d * 0.46), (0, (rim_h - 0.20) / 2 + 0.09,
                0.0), axis='y', length=rim_h - 0.29, slot=slot, bevel=0.010, name='pedestal')
        s.taper((w * 0.33, d * 0.46), (w * 0.44, d * 0.55), (0, rim_h - 0.155, 0.005),
                axis='y', length=0.10, slot=slot, bevel=0.012, name='ped-neck')
    else:                                   # semi-pedestal + trap to the floor
        s.taper((w * 0.40, d * 0.44), (w * 0.30, d * 0.30),
                (0, rim_h - rim_t - 0.16, -d / 2 + d * 0.24), axis='y', length=0.30,
                slot=slot, bevel=0.010, name='semi-pedestal')
        s.cyl(0.028, 0.028, 0.10, (0, bowl.floor_y - 0.055, 0.012), 'chrome', seg=8,
              bevel=0.004, name='trap')
        s.tube([(0, bowl.floor_y - 0.095, 0.012), (0, bowl.floor_y - 0.135, -0.02),
                (0, bowl.floor_y - 0.150, -d / 2 + 0.075),
                (0, 0.0, -d / 2 + 0.075)], 0.017, 'chrome', seg=8, name='waste-pipe')
        s.cyl(0.040, 0.034, 0.05, (0, 0.025, -d / 2 + 0.075), 'chrome', seg=8,
              bevel=0.003, name='pipe-collar')
        s.box((w * 0.62, 0.16, 0.035), (0, rim_h - 0.20, -d / 2 + 0.018), slot,
              bevel=0.008, name='wall-bracket')
    _mixer(s, 0, rim_h - 0.006, -bowl_d / 2 - 0.004, height=0.15,
           reach=min(0.12, bowl_d * 0.42))
    return s


def fam_wc(e, a):
    """Close-coupled WC: cistern SITS ON the pan's rear shoulder, and the seat
    and lid are real rings hinged to the same shoulder.

    The seat used to be 14 loose boxes yawed around an ellipse -- a castellated
    rim with visible steps, which is what you see at eye height when you walk
    past. It is one horseshoe ring now, and the lid is a dished slab.
    """
    w, h, d = e['size']
    seat_h = _sh(e, 0.42)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'ceramic')
    rim = seat_h - 0.028
    pan_w, pan_d = w - 0.04, d * 0.60
    pan_z = d / 2 - pan_d / 2 - 0.02

    s.box((w - 0.08, rim + 0.06, d * 0.42), (0, (rim + 0.06) / 2, -d / 2 + d * 0.21),
          slot, bevel=0.016, name='shoulder')
    s.taper((w * 0.52, d * 0.36), (w * 0.74, d * 0.48), (0, (rim - 0.10) / 2, pan_z * 0.6),
            axis='y', length=rim - 0.10, slot=slot, bevel=0.012, name='pedestal')
    pan = s.shell((pan_w, 0.19, pan_d), 0.155, 0.026, (0, rim - 0.095, pan_z),
                  slot=slot, round_xz=True, seg=14, name='pan')
    s.cyl(0.030, 0.028, 0.05, (0, pan.floor_y - 0.02, pan_z), slot, seg=10,
          bevel=0.004, name='trap-throat')
    s.ring((pan_w - 0.006, pan_d - 0.006), (pan_w - 0.10, pan_d - 0.11), 0.022,
           (0, rim + 0.014, pan_z), body(e, 'ceramic'), seg=16, bevel=0.006,
           arc=(0.055, 0.945), name='seat')
    s.box((pan_w * 0.55, 0.024, 0.055), (0, rim + 0.014, pan_z - pan_d / 2 + 0.012),
          body(e, 'ceramic'), bevel=0.005, name='seat-bridge')
    lid = s.shell((pan_w - 0.004, 0.030, pan_d - 0.004), 0.014, 0.030,
                  (0, rim + 0.043, pan_z), slot=body(e, 'ceramic'),
                  round_xz=True, seg=14, rot=(math.pi, 0, 0), name='lid')
    # clear of the shoulder's top face (rim + 0.06); at rim + 0.030 the hinge
    # was inside it and the seat had no visible fixing at all
    s.box((pan_w * 0.42, 0.045, 0.05), (0, rim + 0.048, pan_z - pan_d / 2 - 0.006),
          'chrome', bevel=0.006, name='hinge')
    cist_h = h - rim - 0.09
    s.box((w, cist_h, d * 0.27), (0, rim + 0.05 + cist_h / 2, -d / 2 + d * 0.135),
          slot, bevel=0.014, name='cistern')
    # the lid drops 24 mm ONTO the cistern; it used to hover 16 mm above it,
    # taking the flush plate with it
    s.box((w - 0.02, 0.048, d * 0.27 + 0.01), (0, h - 0.024, -d / 2 + d * 0.135),
          slot, bevel=0.006, name='cistern-lid')
    s.box((0.10, 0.030, 0.055), (0, h - 0.012, -d / 2 + d * 0.135 + 0.02), 'chrome',
          bevel=0.004, name='flush-plate')
    if 'accessible' in e['id']:
        s.box((w * 0.66, 0.10, 0.045), (0, rim + 0.24, -d / 2 + d * 0.27 + 0.02),
              body(e, 'ceramic'), bevel=0.014, name='back-support')
        for sgn in (-1, 1):
            s.box((0.030, 0.16, 0.030), (sgn * w * 0.22, rim + 0.17,
                  -d / 2 + d * 0.27 + 0.01), 'chrome', bevel=0.004, name='support-arm')
    return s


def fam_wc_wall_hung(e, a):
    """Wall-hung WC: cantilevered pan, concealed cistern, so no ceramic above."""
    w, h, d = e['size']
    seat_h = _sh(e, h)
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'ceramic')
    rim = min(seat_h, h) - 0.03
    pan_d = d * 0.86
    pan_z = d / 2 - pan_d / 2
    s.box((w, h, 0.06), (0, h / 2, -d / 2 + 0.03), slot,
          bevel=0.010, name='wall-plate')
    # the pan is CANTILEVERED off the wall plate: without this neck the whole
    # bowl assembly hung in space 65 mm clear of the plate it is bolted to
    s.box((w * 0.62, 0.22, d * 0.42), (0, rim - 0.11, -d / 2 + d * 0.21 + 0.01), slot,
          bevel=0.010, name='pan-neck')
    s.taper((w * 0.72, d * 0.30), (w - 0.02, pan_d * 0.7), (0, rim - 0.13, pan_z * 0.4),
            axis='y', length=0.20, slot=slot, bevel=0.012, name='underside')
    pan = s.shell((w - 0.02, 0.16, pan_d), 0.13, 0.024, (0, rim - 0.08, pan_z),
                  slot=slot, round_xz=True, seg=14, name='pan')
    s.cyl(0.028, 0.026, 0.05, (0, pan.floor_y - 0.02, pan_z), slot, seg=10,
          bevel=0.004, name='trap')
    s.ring((w - 0.026, pan_d - 0.012), (w - 0.11, pan_d - 0.10), 0.020,
           (0, rim + 0.012, pan_z), slot, seg=16, bevel=0.006,
           arc=(0.055, 0.945), name='seat')
    s.box((w * 0.5, 0.022, 0.05), (0, rim + 0.012, pan_z - pan_d / 2 + 0.010), slot,
          bevel=0.005, name='seat-bridge')
    s.box((0.22, 0.12, 0.016), (0, h - 0.06, -d / 2 + 0.056), 'chrome',
          bevel=0.005, name='flush-plate')
    return s


def fam_urinal(e, a):
    """Bowl urinal: an oval bowl with a real well, a spreader and a waste."""
    w, h, d = e['size']
    s = Shape(e['id'], 'wall', e['size'])
    slot = body(e, 'ceramic')
    # the back slab is the full declared height; at 92 % of it the whole model
    # measured 5 % under its own catalogue box
    s.box((w - 0.04, h, 0.045), (0, h / 2, 0.022), slot, bevel=0.010,
          name='back-plate')
    bowl = s.shell((w, h * 0.62, d - 0.055), h * 0.50, 0.028,
                   (0, h * 0.40, d / 2 - 0.01), slot=slot, round_xz=True, seg=14,
                   rot=(-0.14, 0, 0), name='bowl')
    s.taper((w * 0.86, d * 0.44), (w * 0.42, d * 0.26), (0, h * 0.13, d * 0.36),
            axis='y', length=h * 0.24, slot=slot, bevel=0.010, name='throat')
    s.cyl(0.030, 0.028, 0.030, (0, h * 0.055, d * 0.36), 'chrome', seg=10,
          bevel=0.003, name='waste')
    s.cyl(0.024, 0.022, 0.05, (0, h - 0.055, 0.050), 'chrome', seg=10,
          bevel=0.004, name='spreader')
    s.box((0.07, 0.05, 0.030), (0, h - 0.12, 0.045), 'graphite', bevel=0.005,
          name='sensor')
    return s


def fam_bath(e, a):
    """A bath with a WELL in it. It used to be a solid box with a lid: 1.70 m of
    sideboard in the middle of a bathroom, 31 % over its own catalogue height.
    """
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'ceramic')
    rim_t = 0.05
    inner_w, inner_d = w - 0.10, d - 0.10
    depth = h - 0.12
    tub = s.shell((inner_w, depth + rim_t, inner_d), depth, 0.030,
                  (0, h - (depth + rim_t) / 2, 0), slot=slot, round_xz=False,
                  corner=min(inner_w, inner_d) * 0.26, seg=16, name='tub')
    s.ring((w, d), (inner_w - 0.010, inner_d - 0.010), rim_t, (0, h - rim_t / 2, 0),
           slot, seg=16, bevel=0.008, round_xz=False,
           corner=min(w, d) * 0.24, name='rim')
    s.box((w - 0.02, h - rim_t, 0.030), (0, (h - rim_t) / 2, d / 2 - 0.015), slot,
          bevel=0.008, name='apron')
    for sx in (-1, 1):
        s.box((0.030, h - rim_t, d - 0.03), (sx * (w / 2 - 0.015), (h - rim_t) / 2, 0),
              slot, bevel=0.008, name='end-panel')
    s.box((w - 0.06, 0.10, d - 0.06), (0, 0.05, 0), slot, bevel=0.006, name='plinth')
    s.cyl(0.030, 0.028, 0.022, (w / 2 - 0.16, tub.floor_y, 0), 'chrome', seg=8,
          bevel=0.003, name='waste')
    # on the flat back run, not out on the corner radius where the tub wall has
    # already curved away and the overflow met nothing
    s.cyl(0.024, 0.022, 0.040, (w / 2 - 0.36, h - rim_t - 0.05, -inner_d / 2 + 0.015),
          'chrome', seg=8, axis='z', bevel=0.0, name='overflow')
    _mixer(s, w / 2 - 0.17, h - 0.012, -d / 2 + 0.045, height=0.14,
           reach=min(0.14, d * 0.30), name='bath-tap')
    return s


def fam_shower(e, a):
    """Shower: tray with a fall to the waste, glass screen and door, riser rail,
    head and valve. h = 2.00 is the enclosure, not a box."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'ceramic')
    tray_h = 0.09
    tray = s.shell((w, tray_h, d), 0.035, 0.045, (0, tray_h / 2, 0), slot=slot,
                   round_xz=False, corner=0.05, seg=20, name='tray')
    s.cyl(0.045, 0.042, 0.018, (0, tray.floor_y, 0), 'chrome', seg=12,
          bevel=0.003, name='waste')
    post = 0.032
    pin = 0.055                          # post centres, in from the tray edge
    post_h = h - tray_h + 0.075          # the posts run 75 mm down INTO the tray
    post_y = tray_h - 0.075 + post_h / 2
    for sx in (-1, 1):
        s.box((post, post_h, post), (sx * (w / 2 - pin), post_y,
              -d / 2 + pin), 'metal', bevel=0.005, name='corner-post')
    s.box((post, post_h, post), (w / 2 - pin, post_y,
          d / 2 - pin), 'metal', bevel=0.005, name='front-post')
    s.box((w - pin, 0.035, post), (0, h - 0.02, -d / 2 + pin), 'metal',
          bevel=0.004, name='head-rail')
    s.box((w - pin * 2, h - tray_h - 0.10, 0.010), (0, tray_h + (h - tray_h) / 2 - 0.05,
          -d / 2 + pin), 'glass', bevel=0.0, name='back-glass')
    s.box((0.010, h - tray_h - 0.10, d - pin * 2), (w / 2 - pin,
          tray_h + (h - tray_h) / 2 - 0.05, 0), 'glass', bevel=0.0, name='side-glass')
    if w > 1.0:                                    # walk-in: a fixed return panel
        # it needs its own corner post: the return used to be a pane of glass
        # and a rail floating at the open corner with nothing holding them
        s.box((post, post_h, post), (-w / 2 + pin, post_y, d / 2 - pin),
              'metal', bevel=0.005, name='return-post')
        s.box((w * 0.34, h - tray_h - 0.10, 0.010), (-w / 2 + w * 0.17,
              tray_h + (h - tray_h) / 2 - 0.05, d / 2 - pin), 'glass',
              bevel=0.0, name='return-glass')
        s.box((w * 0.34, 0.030, post), (-w / 2 + w * 0.17, h - 0.02, d / 2 - pin),
              'metal', bevel=0.004, name='return-rail')
    # the riser rail is bracketed to the back glass and runs the whole way up to
    # the head. It used to stop 0.76 m below the head and stand 70 mm clear of
    # every surface it was supposedly fixed to.
    rx = w / 2 - 0.13
    rz = -d / 2 + pin
    riser_h = h - tray_h - 0.19
    s.cyl(0.014, 0.014, riser_h, (rx, tray_h + 0.10 + riser_h / 2, rz), 'chrome',
          seg=8, bevel=0.0, name='riser')
    for by in (tray_h + 0.22, h - 0.20):
        s.box((0.034, 0.034, 0.055), (rx, by, -d / 2 + pin + 0.012), 'chrome',
              bevel=0.004, name='riser-bracket')
    s.box((0.10, 0.16, 0.09), (rx, tray_h + 1.02, rz + 0.030), 'chrome',
          bevel=0.008, name='valve')
    s.tube([(rx, h - 0.16, rz), (rx, h - 0.13, rz + 0.075)], 0.011, 'chrome', seg=6,
           name='head-arm')
    s.cyl(0.075, 0.075, 0.020, (rx, h - 0.125, rz + 0.105), 'chrome',
          seg=12, bevel=0.004, rot=(0.30, 0, 0), name='head')
    return s


# ---------------------------------------------------------------------------
# KITCHEN
# ---------------------------------------------------------------------------


def fam_kitchen_base(e, a):
    """Base units, vanities and islands. The sink versions get a real bowl cut
    into the worktop, a waste sunk into the bowl floor and THE MIXER the
    catalogue note promises ("Single bowl 0.50 x 0.40 x 0.18 deep, mixer to the
    rear") -- it was missing, and the note has been describing a tap that was
    not there.
    """
    w, h, d = e['size']
    doors = int(a[3]) if len(a) > 3 else 2
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    plinth, top_t = 0.15, 0.04
    car_h = h - plinth - top_t
    sink = 'sink' in e['id'] or 'basin' in e['id']
    island = 'island' in e['id']

    # an island's carcase is set back from the worktop, which is what makes the
    # breakfast overhang an overhang instead of 0.22 m added to the footprint
    car_d = (d - 0.32) if island else (d - 0.02)
    car_z = (-0.15) if island else (-0.01)
    s.box((w - 0.06, plinth + 0.010, car_d - 0.08), (0, (plinth + 0.010) / 2,
          car_z - 0.02), 'graphite', bevel=0.006, name='plinth')

    # THE CARCASE IS CUT AWAY UNDER A BOWL. It used to be one solid box up to
    # 32 mm below the worktop, so a 180 mm bowl recess was a hole in a shell
    # standing inside a solid block: you looked into a sink and met the top of
    # the cabinet 18 mm down, and the waste on the bowl floor was sealed in the
    # unit. The lower carcase stops at the bowl floor now and the volume above
    # it is made of fillers around the bowls' own footprint.
    n_bowls = bw = bd = depth = bowl_bottom = None
    if sink:
        n_bowls = 2 if w > 1.0 else 1
        bw = min(0.52, (w - 0.16) / n_bowls - 0.04)
        bd = min(0.42, d - 0.16)
        depth = min(0.18, h * 0.20)
        bowl_bottom = h - top_t / 2 - (depth + 0.03) + 0.006
        low_top = bowl_bottom + 0.008
        s.box((w, low_top - plinth, car_d), (0, (plinth + low_top) / 2, car_z), slot,
              bevel=0.008, name='carcase')
        up_h = (h - top_t + 0.008) - bowl_bottom
        up_y = bowl_bottom + up_h / 2
        xs = sorted((0 if n_bowls == 1 else -w / 2 + w * (i + 0.5) / n_bowls)
                    for i in range(n_bowls))
        edges = [-w / 2] + [v for bx in xs
                            for v in (bx - bw / 2 + 0.012, bx + bw / 2 - 0.012)] \
                + [w / 2]
        for k in range(0, len(edges), 2):          # the gaps BETWEEN the bowls
            x0, x1 = edges[k], edges[k + 1]
            if x1 - x0 > 0.004:
                s.box((x1 - x0, up_h, car_d), ((x0 + x1) / 2, up_y, car_z), slot,
                      bevel=0.008, name='carcase-filler')
        bz0, bz1 = 0.005 - bd / 2 + 0.010, 0.005 + bd / 2 - 0.010
        for z0, z1 in ((car_z - car_d / 2, bz0), (bz1, car_z + car_d / 2)):
            if z1 - z0 > 0.004:
                s.box((w, up_h, z1 - z0), (0, up_y, (z0 + z1) / 2), slot,
                      bevel=0.008, name='carcase-rail')
    else:
        # the carcase runs 8 mm up into the worktop. Butted flush, the worktop
        # and the unit under it were two bodies on every non-sink base unit.
        s.box((w, car_h + 0.008, car_d), (0, plinth + car_h / 2 + 0.004, car_z),
              slot, bevel=0.008, name='carcase')

    bowl = None
    if sink:
        for i in range(n_bowls):
            bx = (0 if n_bowls == 1 else -w / 2 + w * (i + 0.5) / n_bowls)
            bowl = s.shell((bw, depth + 0.03, bd), depth, 0.016,
                           (bx, h - top_t / 2 - (depth + 0.03) / 2 + 0.006, 0.005),
                           slot='metal' if not sink or 'kitchen' in e['id'] else 'ceramic',
                           round_xz=False, corner=0.05, seg=10, bevel=0.0,
                           name=f'bowl{i}')
            s.cyl(0.030, 0.028, 0.020, (bx, bowl.floor_y, 0.005), 'metal', seg=8,
                  bevel=0.003, name='waste')
        _mixer(s, 0, h - 0.008, -d / 2 + 0.055, height=0.20, reach=0.16, name='mixer')
        # worktop as a frame around the aperture, so the bowl is genuinely let in
        s.box((w, top_t + 0.008, 0.075), (0, h - (top_t + 0.008) / 2, -d / 2 + 0.037),
              'accent', bevel=0.008, name='top-back')
        s.box((w, top_t + 0.008, d - bd - 0.075),
              (0, h - (top_t + 0.008) / 2, d / 2 - (d - bd - 0.075) / 2),
              'accent', bevel=0.008, name='top-front')
        side_w = (w - (bw * n_bowls + 0.06 * n_bowls)) / 2
        for sx in (-1, 1):
            s.box((side_w, top_t + 0.008, d), (sx * (w / 2 - side_w / 2),
                  h - (top_t + 0.008) / 2, 0), 'accent', bevel=0.008, name='top-side')
        if n_bowls > 1:
            s.box((w - side_w * 2 - bw * 2 - 0.04, top_t + 0.008, d),
                  (0, h - (top_t + 0.008) / 2, 0), 'accent', bevel=0.008, name='top-mid')
    else:
        s.box((w, top_t, d), (0, h - top_t / 2, 0), 'accent', bevel=0.008, name='worktop')
        # There is no upstand. There was one, and because the catalogue height
        # is the worktop it had to live BELOW it -- 55 mm of splashback hidden
        # inside the carcase, visible from nowhere. A base unit without a
        # splashback is ordinary; dead geometry pretending to be one is not.

    fz = car_z + car_d / 2 - 0.004
    if doors >= 2 and not sink:
        for i in range(doors):
            dw = w / doors
            x = -w / 2 + dw * (i + 0.5)
            s.box((dw - 0.008, car_h - 0.01, 0.020), (x, plinth + car_h / 2, fz),
                  slot, bevel=0.005, name='door')
            s.box((dw * 0.5, 0.014, 0.028), (x, plinth + car_h - 0.06, fz + 0.014),
                  'chrome', bevel=0.003, name='handle')
    else:
        s.box((w - 0.008, 0.14, 0.020), (0, plinth + car_h - 0.08, fz), slot,
              bevel=0.005, name='drawer-front')
        s.box((w - 0.008, car_h - 0.17, 0.020), (0, plinth + (car_h - 0.17) / 2, fz),
              slot, bevel=0.005, name='door')
        s.box((w * 0.55, 0.014, 0.028), (0, plinth + car_h - 0.08, fz + 0.014),
              'chrome', bevel=0.003, name='handle-drawer')
        s.box((w * 0.55, 0.014, 0.028), (0, plinth + car_h - 0.24, fz + 0.014),
              'chrome', bevel=0.003, name='handle-door')
    if island:
        # a corbel from the carcase out under the overhang, lapping both
        cb_z1 = d / 2 - 0.04
        cb_z0 = car_z + car_d / 2 - 0.04
        # two discrete corbels, which is what an island actually has. As one
        # bracket the full width of the unit it contained all three door
        # handles, so the front of the island had no ironmongery at all.
        for sx in (-1, 1):
            s.box((0.13, 0.14, cb_z1 - cb_z0), (sx * (w / 2 - 0.16), h - 0.07,
                  (cb_z0 + cb_z1) / 2), 'metal', bevel=0.006,
                  name='overhang-bracket')
    return s


def fam_kitchen_wall(e, a):
    """Wall unit: carcase 0.35 deep off the wall face, doors, underside detail."""
    w, h, d = e['size']
    s = Shape(e['id'], 'wall', e['size'])
    slot = body(e, 'metal')
    s.box((w, h, d - 0.01), (0, h / 2, d / 2), slot, bevel=0.008, name='carcase')
    for i in range(2):
        dw = w / 2
        x = -w / 2 + dw * (i + 0.5)
        s.box((dw - 0.008, h - 0.012, 0.020), (x, h / 2, d - 0.012), slot,
              bevel=0.005, name='door')
        s.box((0.020, h * 0.42, 0.028), (x + (dw / 2 - 0.05) * (1 if i else -1), h / 2,
              d - 0.002), 'chrome', bevel=0.004, name='handle')
    s.box((w - 0.06, 0.020, d - 0.08), (0, 0.008, d / 2), 'metal', bevel=0.003,
          name='underside-light')
    return s


def fam_tall_unit(e, a):
    """Tall boxes with a front: appliances, cupboards, coolers and the piano.

    Everything here used to be a single unbevelled box in proc-shapes; each item
    now gets the two or three features that let an architect name it across a
    room -- a porthole, a glass oven front, a bottle, a keyboard.
    """
    w, h, d = e['size']
    split = float(a[3]) if len(a) > 3 else 0.0
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    fz = d / 2 - 0.021
    item = e['id']

    if 'piano' in item:
        return _piano(e, s, w, h, d, slot)
    if 'printer' in item:
        return _printer(e, s, w, h, d)
    if 'display-fridge' in item:
        return _display_fridge(e, s, w, h, d)
    if 'stove' in item:
        return _stove(e, s, w, h, d)
    if 'scales' in item:
        return _scales(e, s, w, h, d)

    # the front face is 14 mm behind the nominal depth, so a 20 mm door drawn on
    # `fz` runs INTO it. It used to be 35 mm back and every applied part missed.
    # A bottle cooler's cabinet stops below the bottle. At full height the
    # 0.42 m bottle was sunk 0.39 m inside it, showing 30 mm of glass, and the
    # neck was buried outright: the render was a plain white cupboard.
    case_h = h - 0.40 if 'cooler' in item else h
    s.box((w, case_h - 0.06, d - 0.014), (0, 0.03 + (case_h - 0.06) / 2, -0.007),
          slot, bevel=0.010, name='carcase')
    s.box((w - 0.05, 0.07, d - 0.12), (0, 0.035, -0.03), 'graphite', name='base')

    if 'fridge-freezer' in item:
        for lo, hi in ((0.05, split - 0.04), (split, h - 0.05)):
            s.box((w - 0.006, hi - lo, 0.042), (0, (lo + hi) / 2, fz), 'metal',
                  bevel=0.008, name='door')
        for y in (split - 0.16, split + 0.10):
            s.box((0.028, 0.30, 0.036), (w / 2 - 0.075, y, d / 2 - 0.008), 'chrome',
                  bevel=0.005, name='handle')
        s.box((w - 0.10, 0.020, 0.02), (0, split - 0.02, d / 2 - 0.012), 'graphite',
              bevel=0.003, name='door-gap')
    elif 'washing' in item:
        s.box((w - 0.02, 0.12, 0.026), (0, h - 0.09, fz), 'graphite', bevel=0.005,
              name='fascia')
        s.cyl(0.040, 0.040, 0.030, (w / 2 - 0.09, h - 0.09, fz + 0.010), 'metal',
              seg=10, axis='z', bevel=0.004, name='dial')
        s.box((w * 0.55, 0.055, 0.026), (-w * 0.10, h - 0.09, fz + 0.008), 'metal',
              bevel=0.004, name='drawer')
        s.ring((0.36, 0.36), (0.29, 0.29), 0.040, (0, h * 0.46, fz + 0.012), 'metal',
               seg=16, rot=(math.pi / 2, 0, 0), bevel=0.006, name='door-ring')
        s.cyl(0.148, 0.148, 0.030, (0, h * 0.46, fz + 0.006), 'glass', seg=16,
              axis='z', bevel=0.0, name='porthole')
        s.box((0.030, 0.09, 0.030), (0.20, h * 0.46, fz + 0.012), 'metal',
              bevel=0.005, name='door-latch')
    elif 'oven' in item:
        s.box((w - 0.006, 0.60, 0.030), (0, 1.30, fz), 'graphite', bevel=0.006,
              name='oven-front')
        s.box((w - 0.12, 0.38, 0.014), (0, 1.28, fz + 0.010), 'glass', bevel=0.0,
              name='oven-glass')
        s.box((w - 0.10, 0.030, 0.036), (0, 1.55, fz + 0.014), 'chrome', bevel=0.005,
              name='oven-handle')
        for i in range(4):
            s.cyl(0.020, 0.020, 0.024, (-w / 2 + 0.11 + i * 0.12, 1.66, fz + 0.010),
                  'chrome', seg=8, axis='z', bevel=0.003, name='knob')
        for lo, hi in ((0.05, 0.95), (1.72, h - 0.05)):
            s.box((w - 0.010, hi - lo, 0.020), (0, (lo + hi) / 2, fz), slot,
                  bevel=0.005, name='door')
            s.box((w * 0.5, 0.016, 0.028), (0, hi - 0.06, d / 2 - 0.008), 'chrome',
                  bevel=0.004, name='handle')
    elif 'dishwasher' in item:
        s.box((w - 0.010, h - 0.14, 0.022), (0, 0.06 + (h - 0.14) / 2, fz), slot,
              bevel=0.005, name='door')
        s.box((w - 0.06, 0.030, 0.030), (0, h - 0.05, fz + 0.010), 'chrome',
              bevel=0.005, name='handle')
        s.box((w - 0.10, 0.020, 0.020), (0, h - 0.10, fz + 0.008), 'graphite',
              bevel=0.0, name='control-strip')
    elif 'cooler' in item:
        s.cyl(w * 0.42, w * 0.36, 0.44, (0, h - 0.22, 0), 'glass', seg=14,
              bevel=0.010, name='bottle')
        # a collar WIDER than the bottle's foot, so the bottle's wall cuts its
        # top face: a narrow neck sat inside the bottle and touched nothing
        s.cyl(w * 0.46, w * 0.46, 0.06, (0, case_h + 0.01, 0), 'graphite', seg=14,
              bevel=0.005, name='bottle-collar')
        for sgn in (-1, 1):
            s.box((0.035, 0.09, 0.06), (sgn * 0.07, h - 0.60, d / 2 - 0.02), 'graphite',
                  bevel=0.006, name='tap')
        s.box((w - 0.08, 0.024, 0.10), (0, h - 0.72, d / 2 - 0.04), 'metal',
              bevel=0.004, name='drip-tray')
    else:
        s.box((w - 0.010, h - 0.14, 0.022), (0, 0.06 + (h - 0.14) / 2, fz), slot,
              bevel=0.005, name='door')
        s.box((w * 0.5, 0.016, 0.028), (0, h - 0.14, d / 2 - 0.008), 'chrome',
              bevel=0.004, name='handle')
    return s


def _printer(e, s, w, h, d):
    """A multifunction printer is a base, an OUTPUT SLOT you can see into, an
    engine and a scanner lid. Modelled as one solid block, the output tray was
    a box buried inside it that no player could ever see."""
    dz, cz = d - 0.014, -0.007
    fz = d / 2 - 0.021
    slot_y0, slot_y1 = h * 0.56, h * 0.71
    s.box((w, slot_y0, dz), (0, slot_y0 / 2, cz), 'graphite', bevel=0.010, name='base')
    for i in range(2):
        y = slot_y0 * (0.30 + 0.34 * i)
        s.box((w - 0.03, slot_y0 * 0.30, 0.022), (0, y, fz), 'metal',
              bevel=0.005, name='paper-tray')
        s.box((w * 0.42, 0.024, 0.030), (0, y + slot_y0 * 0.11, fz + 0.010),
              'graphite', bevel=0.004, name='tray-pull')
    for sx in (-1, 1):
        s.box((0.075, slot_y1 - slot_y0 + 0.02, dz),
              (sx * (w / 2 - 0.0375), (slot_y0 + slot_y1) / 2, cz), 'graphite',
              bevel=0.006, name='slot-column')
    s.box((w, slot_y1 - slot_y0 + 0.02, 0.09), ((0), (slot_y0 + slot_y1) / 2,
          -d / 2 + 0.045), 'graphite', bevel=0.006, name='slot-back')
    s.box((w - 0.16, 0.018, dz - 0.10), (0, slot_y0 + 0.009, cz + 0.02), 'metal',
          bevel=0.004, name='output-shelf')
    eng_y0, eng_y1 = slot_y1, h - 0.12
    s.box((w, eng_y1 - eng_y0, dz), (0, (eng_y0 + eng_y1) / 2, cz), 'graphite',
          bevel=0.010, name='engine')
    lid = (0, h - 0.055, cz + 0.01)
    s.box((w, 0.13, dz - 0.03), (0, h - 0.065, cz + 0.01), 'graphite',
          bevel=0.010, name='scanner-lid')
    s.box((w - 0.10, 0.030, dz - 0.16), (0, h - 0.125, cz + 0.02), 'glass',
          bevel=0.0, name='platen')
    cp = (w / 2 - 0.16, h - 0.145, d / 2 - 0.08)
    s.box((0.26, 0.030, 0.16), cp, 'graphite', rot=(0.45, 0, 0), bevel=0.005,
          name='control-panel')
    s.box((0.17, 0.012, 0.10), _on(cp, 0.45, dy=0.014), 'glass', rot=(0.45, 0, 0),
          bevel=0.0, name='control-screen')
    del lid
    return s


def _display_fridge(e, s, w, h, d):
    """A glass-fronted display fridge: the whole point is that you see the
    shelves. Built as a solid block, four metal shelves were sealed inside it."""
    dz, cz = d - 0.014, -0.007
    t = 0.05
    base_h, canopy_h = 0.20, 0.16
    s.box((w, base_h, dz), (0, base_h / 2, cz), 'graphite', bevel=0.008, name='base')
    s.box((w, canopy_h, dz), (0, h - canopy_h / 2, cz), 'graphite', bevel=0.008,
          name='canopy')
    inner_h = h - base_h - canopy_h
    s.box((w, inner_h, t), (0, base_h + inner_h / 2, -d / 2 + t / 2), 'metal',
          bevel=0.006, name='back')
    for sx in (-1, 1):
        s.box((t, inner_h, dz), (sx * (w / 2 - t / 2), base_h + inner_h / 2, cz),
              'metal', bevel=0.006, name='side')
    for i in range(4):
        s.box((w - t * 2 + 0.010, 0.020, dz - 0.10),
              (0, base_h + inner_h * (i + 0.5) / 4.4, cz + 0.02), 'metal',
              bevel=0.004, name='shelf')
    # The door frame is FOUR RAILS around the opening. As one slab it was
    # 0.85 x inner_h x 0.026 with the 0.75-wide pane centred inside it on every
    # axis, so the glass -- the entire point of a display fridge -- was sealed
    # inside its own frame and the cabinet rendered as a solid metal box.
    door_y = base_h + inner_h / 2
    door_z = d / 2 - 0.017
    stile_w = 0.05
    rail_h = 0.05
    for sx in (-1, 1):
        s.box((stile_w, inner_h + 0.04, 0.026),
              (sx * ((w - t) / 2 - stile_w / 2), door_y, door_z), 'metal',
              bevel=0.006, name='door-stile')
    for sy in (-1, 1):
        s.box((w - t, rail_h, 0.026),
              (0, door_y + sy * ((inner_h + 0.04) / 2 - rail_h / 2), door_z),
              'metal', bevel=0.006, name='door-rail')
    s.box((w - t - stile_w * 2 + 0.012, inner_h + 0.04 - rail_h * 2 + 0.012, 0.012),
          (0, door_y, door_z), 'glass', bevel=0.0, name='door-glass')
    s.box((0.028, inner_h - 0.30, 0.034), (w / 2 - 0.09, base_h + inner_h / 2,
          d / 2 - 0.008), 'chrome', bevel=0.005, name='handle')
    s.box((w - 0.16, 0.06, 0.020), (0, h - 0.05, d / 2 - 0.012), 'accent',
          bevel=0.004, name='header-strip')
    return s



def _scales(e, s, w, h, d):
    """A column scale: a low platform you stand on, a slim column at the back,
    a display head and a height rod.

    It used to be built INSIDE the tall-unit carcase -- a full 0.40 x 1.40 x
    0.55 solid box -- so the platform, the column, the display and the height
    rod were all sealed in it and a clinic got a featureless grey slab labelled
    "scales". A scale is not a tall unit; it gets its own shape.
    """
    back = -d / 2
    base_h = 0.045
    s.box((w, base_h, d), (0, base_h / 2, 0), 'metal', bevel=0.006, name='base')
    s.box((w - 0.04, 0.030, d * 0.60), (0, base_h + 0.010, d * 0.16), 'graphite',
          bevel=0.004, name='platform')       # the rubber deck you stand on

    col_w, col_d = 0.12, 0.09
    col_z = back + 0.065
    col_top = h - 0.195
    s.box((col_w, col_top - base_h + 0.010, col_d),
          (0, base_h - 0.005 + (col_top - base_h + 0.010) / 2, col_z), 'metal',
          bevel=0.008, name='column')

    head_y = col_top + 0.055
    head_d = 0.11
    head_front = col_z + col_d / 2 - 0.02 + head_d
    s.box((w * 0.75, 0.130, head_d), (0, head_y, head_front - head_d / 2),
          'graphite', bevel=0.006, name='display-head')
    s.box((w * 0.55, 0.070, 0.014), (0, head_y, head_front - 0.004), 'glass',
          bevel=0.0, name='display')          # 10 mm PROUD of the head face

    rod_h = h - (head_y + 0.065) + 0.030
    # the rod telescopes out of the HEAD, not out of the column behind it: at
    # col_z it cleared the head by 12 mm and hung in the air
    s.cyl(0.013, 0.013, rod_h, (0, h - rod_h / 2, head_front - head_d / 2), 'metal',
          seg=8, bevel=0.0, name='height-rod')
    s.box((0.20, 0.014, 0.15), (0, h - 0.020, head_front - head_d / 2 + 0.055),
          'metal', bevel=0.003, name='height-slider')
    return s


def _stove(e, s, w, h, d):
    """A wood burner stands on legs over an open log store. As one solid block
    the log shelf was invisible geometry inside the casting."""
    dz, cz = d - 0.014, -0.007
    fz = d / 2 - 0.021
    leg_h, body_y0 = 0.26, 0.24
    for sx in (-1, 1):
        for sz in (-1, 1):
            s.box((0.055, leg_h, 0.055), (sx * (w / 2 - 0.05), leg_h / 2,
                  sz * (d / 2 - 0.06)), 'metal', bevel=0.006, name='stove-leg')
    s.box((w - 0.10, 0.026, d - 0.12), (0, 0.11, 0), 'metal', bevel=0.004,
          name='log-shelf')
    top_y0 = h - 0.20
    s.box((w, top_y0 - body_y0, dz), (0, (body_y0 + top_y0) / 2, cz), 'graphite',
          bevel=0.012, name='firebox')
    s.box((w, 0.045, dz), (0, top_y0 + 0.010, cz), 'metal',
          bevel=0.006, name='top-plate')
    s.cyl(0.075, 0.070, 0.20, (0, h - 0.10, -d / 2 + 0.16), 'graphite', seg=12,
          bevel=0.006, name='flue')
    door_y = (body_y0 + top_y0) / 2
    s.box((w - 0.09, top_y0 - body_y0 - 0.12, 0.026), (0, door_y, fz), 'graphite',
          bevel=0.008, name='firebox-door')
    s.box((w - 0.22, top_y0 - body_y0 - 0.24, 0.012), (0, door_y, fz + 0.010),
          'glass', bevel=0.0, name='fire-glass')
    s.box((0.030, 0.11, 0.030), (w / 2 - 0.09, door_y, fz + 0.010), 'metal',
          bevel=0.005, name='door-handle')
    s.box((0.11, 0.028, 0.040), (-w / 2 + 0.12, body_y0 + 0.05, fz + 0.012), 'metal',
          bevel=0.004, name='air-slider')
    return s


def _piano(e, s, w, h, d, slot):
    """An upright piano, because "tall unit" would have made it a wardrobe.

    THE CASE STOPS BEHIND THE KEYBOARD. It used to be a single box the full
    depth of the instrument, so all fifteen black keys and all three pedals sat
    inside it: the render was a white cabinet with a wooden panel and no
    keyboard at all, on an item whose owner plays the piano. The case is the
    rear 0.34 m now and the key shelf projects out of it.
    """
    front = d / 2                          # +0.31 on a 0.62 deep piano
    case_d = 0.34
    case_z = -front + case_d / 2           # case spans -front .. -front + 0.34
    case_face = -front + case_d
    key_y = 0.66                           # top of the naturals: the real height

    s.box((w, 0.10, case_d), (0, 0.05, case_z), 'woodDark', bevel=0.006,
          name='plinth')
    s.box((w, h - 0.10, case_d), (0, 0.10 + (h - 0.10) / 2, case_z), slot,
          bevel=0.010, name='body')

    # the key shelf and its two cheeks carry the keyboard out in front of the case
    shelf_top = key_y - 0.010
    s.box((w, 0.055, front - case_face + 0.03),
          (0, shelf_top - 0.0275, (case_face - 0.03 + front) / 2), slot,
          bevel=0.008, name='keybed')
    for sx in (-1, 1):
        s.box((0.085, 0.115, front - case_face + 0.03),
              (sx * (w / 2 - 0.0425), shelf_top + 0.020,
               (case_face - 0.03 + front) / 2), slot, bevel=0.008, name='key-cheek')

    nat_d = 0.145                          # a natural is 145 mm of playing length
    s.box((w - 0.17, 0.022, nat_d), (0, shelf_top + 0.011,
          front - 0.012 - nat_d / 2), 'ceramic', bevel=0.0, name='white-keys')
    # THE SHARPS ARE GROUPED 2-3, not spread evenly. Fifteen equidistant black
    # bars is not a keyboard, and the person this is being built for plays the
    # piano: a sharp follows naturals C D _ F G A _ , i.e. index % 7 in
    # {0, 1, 3, 4, 5}, and there is a two-natural gap at every E-F and B-C.
    n_nat = 26
    key_x0 = -(w - 0.17) / 2
    nat_w = (w - 0.17) / n_nat
    for i in range(n_nat - 1):
        if i % 7 not in (0, 1, 3, 4, 5):
            continue
        x = key_x0 + (i + 1) * nat_w
        s.box((nat_w * 0.56, 0.020, nat_d * 0.62),
              (x, shelf_top + 0.030, front - 0.012 - nat_d + nat_d * 0.62 / 2),
              'graphite', bevel=0.0, name='black-key')

    # the fallboard is UP, resting against the case above the keys, which is
    # where it has to be if the keyboard is going to be seen at all
    s.box((w - 0.02, 0.235, 0.028), (0, key_y + 0.145, case_face - 0.006), slot,
          bevel=0.006, name='fallboard')
    s.box((w - 0.06, 0.28, 0.026), (0, h - 0.27, case_face + 0.010), 'woodDark',
          rot=(0.16, 0, 0), bevel=0.006, name='music-desk')
    s.box((w - 0.06, 0.035, 0.08), (0, h - 0.42, case_face + 0.026), 'woodDark',
          bevel=0.005, name='music-ledge')

    # lyre and pedals, forward of the plinth and clear of it
    lyre_d = 0.24
    s.box((0.17, 0.17, lyre_d), (0, 0.085, case_face - 0.02 + lyre_d / 2),
          'woodDark', bevel=0.006, name='pedal-lyre')
    for i in range(3):
        s.box((0.034, 0.015, 0.115), (-0.065 + i * 0.065, 0.055,
              case_face - 0.02 + lyre_d - 0.02), 'chrome', bevel=0.003,
              name='pedal')
    return s


def fam_hob(e, a):
    """Induction hob: a glass plate in a slim frame with four printed zones."""
    w, h, d = e['size']
    rings = int(a[2]) if len(a) > 2 else 4
    s = Shape(e['id'], 'floor', e['size'])
    s.box((w, h * 0.55, d), (0, h * 0.275, 0), 'metal', bevel=0.004, name='pan')
    s.box((w - 0.012, h * 0.5, d - 0.012), (0, h * 0.72, 0), 'graphite',
          bevel=0.004, name='glass-top')
    for i in range(rings):
        sx = -1 if i % 2 == 0 else 1
        sz = -1 if i < 2 else 1
        r = 0.075 if i % 3 else 0.090
        s.ring((r * 2, r * 2), (r * 2 - 0.010, r * 2 - 0.010), 0.006,
               (sx * w * 0.23, h - 0.004, sz * d * 0.21), 'ceramic', seg=16,
               bevel=0.0, name='zone')
    s.box((w * 0.44, 0.006, 0.030), (0, h - 0.004, d / 2 - 0.035), 'ceramic',
          bevel=0.0, name='touch-panel')
    return s


# ---------------------------------------------------------------------------
# BLOCKS AND PANELS
# ---------------------------------------------------------------------------


def fam_block(e, a):
    """Objects the placeholder called "a block": extractor hood, downlight,
    planter, bin -- and the espresso machine, which is its own hero."""
    w, h, d = e['size']
    item = e['id']
    if 'espresso' in item:
        return _espresso(e)
    anchor = e.get('anchor', 'floor')
    s = Shape(e['id'], anchor, e['size'])
    slot = body(e, 'metal')

    if 'hood' in item:
        s.taper((w, d), (w * 0.42, d * 0.42), (0, h * 0.20, d / 2), axis='y',
                length=h * 0.40, slot='metal', bevel=0.008, name='canopy')
        s.box((w, 0.030, d), (0, 0.015, d / 2), 'metal', bevel=0.005, name='rim')
        s.box((w - 0.08, 0.020, d - 0.10), (0, 0.035, d / 2), 'graphite',
              bevel=0.004, name='filter')
        s.box((w * 0.40, h * 0.62, d * 0.40), (0, h * 0.69, d * 0.22), 'metal',
              bevel=0.006, name='chimney')
        s.box((w * 0.5, 0.020, 0.020), (0, 0.055, d - 0.02), 'graphite',
              bevel=0.0, name='controls')
        return s
    if 'downlight' in item:
        s.ring((w, d), (w * 0.66, d * 0.66), h, (0, -h / 2, 0), 'metal',
               seg=14, bevel=0.0, name='bezel')
        s.cyl(w * 0.34, w * 0.34, h * 0.8, (0, -h / 2, 0), 'glass', seg=14,
              bevel=0.0, name='lens')
        return s
    if 'planter' in item:
        # The trough is NOT the whole declared height. It used to be: a 0.60 m
        # box with a 0.50 m recess and 0.16-0.30 m plants standing on the bottom
        # of it, so all fourteen of them finished 0.19 m BELOW the rim and the
        # planter rendered as an empty white box. A planter is a container plus
        # the planting; the catalogue height is the top of the leaves.
        trough_h = h * 0.62
        trough = s.shell((w, trough_h, d), 0.14, 0.035, (0, trough_h / 2, 0),
                         slot=slot, round_xz=False, corner=0.06, seg=20,
                         name='trough')
        soil_y = trough.floor_y + 0.05
        s.box((trough.inner[0] - 0.010, 0.10, trough.inner[1] - 0.010),
              (0, trough.floor_y + 0.05, 0), 'soil', bevel=0.0, name='soil')
        rng = _Rng(7717)
        n_stem = 20
        for i in range(n_stem):
            x = -w / 2 + 0.09 + (w - 0.18) * i / (n_stem - 1.0)
            # the tallest stems reach the declared height; the shortest sit a
            # third of the way up, so the mass reads as planting and not a comb
            hgt = (h - soil_y) * rng.f(0.52, 1.0)
            if i == n_stem // 2:
                hgt = h - soil_y                       # one stem sets the bbox
            tx = x + rng.f(-0.05, 0.05)
            tz = rng.f(-d * 0.22, d * 0.22)
            s.tube([(x, soil_y - 0.02, 0.0),
                    (x + (tx - x) * 0.5, soil_y + hgt * 0.55, tz * 0.5),
                    (tx, soil_y + hgt, tz)], 0.008, 'stem', seg=5, name='stem')
            # leaves are threaded ON the stem line, not scattered near it: two
            # of the old random placements missed the stem and floated
            for k in range(4):
                t = 0.30 + 0.23 * k
                s.card((rng.f(0.07, 0.11), rng.f(0.09, 0.15)),
                       (x + (tx - x) * t, soil_y + hgt * t, tz * t),
                       ('foliage', 'foliage2', 'foliage3')[(i + k) % 3],
                       rot=(rng.f(-0.7, -0.1), rng.f(0, TAU), rng.f(-0.4, 0.4)),
                       name='leaf')
        return s
    # office bin
    bin_h = h - 0.03
    s.taper((w * 0.80, d * 0.80), (w, d), (0, bin_h / 2, 0), axis='y', length=bin_h,
            slot=slot, bevel=0.008, name='body')
    s.ring((w, d), (w - 0.030, d - 0.030), 0.020, (0, bin_h - 0.008, 0), 'metal',
           seg=16, bevel=0.004, name='rim')
    s.cyl(w * 0.48, w * 0.44, 0.035, (0, bin_h + 0.010, 0), 'graphite', seg=16,
          bevel=0.005, name='lid')
    s.box((w * 0.44, 0.014, 0.030), (0, bin_h + 0.028, 0), 'graphite', bevel=0.004,
          name='flap')
    return s


def _espresso(e):
    """A two-group commercial machine. The chrome band and the drip tray now WRAP
    the front corners, because from an oblique walk-past the front-only detail
    disappeared and it read as a black slab with a white lid again.
    """
    w, h, d = e['size']                  # 0.75 x 0.55 x 0.55
    s = Shape(e['id'], 'floor', e['size'])
    body_front = 0.19

    s.box((w - 0.03, 0.055, 0.42), (0, 0.028, -0.03), 'chrome', bevel=0.004,
          name='drip-tray')
    s.box((w - 0.09, 0.012, 0.36), (0, 0.058, -0.03), 'graphite', bevel=0.0,
          name='tray-well')
    for i in range(3):
        s.box((w - 0.10, 0.010, 0.016), (0, 0.064, -0.13 + i * 0.086), 'chrome',
              bevel=0.0, name='grille-bar')
    # tray returns down both sides: visible from az25 and az135
    for sgn in (-1, 1):
        s.box((0.028, 0.070, 0.42), (sgn * (w / 2 - 0.020), 0.035, -0.03), 'chrome',
              bevel=0.004, name='tray-cheek')

    s.box((w - 0.05, 0.38, 0.44), (0, 0.25, -0.03), 'graphite', bevel=0.012, name='body')
    for sgn in (-1, 1):
        s.box((0.030, 0.34, 0.40), (sgn * (w / 2 - 0.015), 0.25, -0.03), 'chrome',
              bevel=0.010, name='cheek')
    s.box((w - 0.06, 0.085, 0.022), (0, 0.315, body_front - 0.004), 'chrome',
          bevel=0.006, name='front-band')
    for sgn in (-1, 1):                      # the band turns the corner
        s.box((0.026, 0.085, 0.20), (sgn * (w / 2 - 0.026), 0.315, body_front - 0.11),
              'chrome', bevel=0.006, name='band-return')

    for sgn in (-1, 1):
        x = sgn * 0.165
        s.box((0.115, 0.10, 0.10), (x, 0.185, body_front - 0.03), 'chrome',
              bevel=0.010, name='group-body')
        s.cyl(0.052, 0.048, 0.055, (x, 0.128, body_front - 0.02), 'chrome', seg=8,
              name='group-head')
        s.cyl(0.058, 0.058, 0.030, (x, 0.098, body_front - 0.02), 'chrome', seg=8,
              bevel=0.0, name='portafilter')
        s.tube([(x, 0.100, body_front + 0.005),
                (x, 0.094, body_front + 0.098)], 0.013, 'graphite', seg=6,
               name='pf-handle')

    for sgn in (-1, 1):
        x = sgn * 0.30
        s.cyl(0.026, 0.026, 0.030, (x, 0.29, body_front - 0.004), 'chrome', seg=8,
              axis='z', bevel=0.004, name='steam-knob')
        s.tube([(x, 0.285, body_front - 0.03), (x, 0.200, body_front + 0.015),
                (x * 0.88, 0.105, body_front - 0.01)],
               0.0085, 'chrome', seg=5, name='steam-wand')

    s.cyl(0.046, 0.046, 0.022, (0, 0.315, body_front - 0.002), 'chrome', seg=8,
          axis='z', bevel=0.0, name='gauge-bezel')
    s.cyl(0.036, 0.036, 0.008, (0, 0.315, body_front + 0.010), 'paper', seg=8,
          axis='z', bevel=0.0, name='gauge-face')
    s.box((0.006, 0.030, 0.006), (0, 0.325, body_front + 0.014), 'accent',
          rot=(0, 0, 0.5), bevel=0.0, name='gauge-needle')

    # The cup-warming deck. Everything on it has to stay FORWARD of the boiler
    # housing: the first version parked both cups and the back rail at
    # z -0.13..-0.24, which is exactly where the housing sits, so the crockery
    # that makes the top of the machine readable was sealed inside it. Nothing
    # measured it, because a buried part is still joined and still the right
    # size. Shape.buried() reports it now; these z values keep it honest.
    s.box((w - 0.05, 0.024, 0.40), (0, 0.449, -0.05), 'chrome', bevel=0.0,
          name='warmer-top')
    deck_top = 0.449 + 0.012
    housing_z0 = -0.25                     # rear face of the machine body
    housing_d = 0.12
    housing_front = housing_z0 + housing_d
    for sgn in (-1, 1):
        s.box((0.014, 0.028, 0.24), (sgn * (w / 2 - 0.045), deck_top + 0.012, 0.02),
              'chrome', bevel=0.0, name='warmer-rail')
    s.box((w - 0.10, 0.028, 0.014), (0, deck_top + 0.012, 0.135), 'chrome',
          bevel=0.0, name='warmer-rail-front')
    for cx, cz in ((-0.20, 0.03), (0.12, 0.05)):
        s.cyl(0.032, 0.036, 0.054, (cx, deck_top + 0.025, cz), 'ceramic', seg=8,
              bevel=0.0, name='cup')          # 2 mm INTO the deck, not level on it
        s.ring((0.072, 0.072), (0.056, 0.056), 0.012, (cx, deck_top + 0.046, cz),
               'ceramic', seg=8, bevel=0.0, name='cup-mouth')

    s.box((w - 0.06, 0.115, housing_d), (0, 0.492, housing_z0 + housing_d / 2),
          'graphite', bevel=0.010, name='boiler-housing')
    assert housing_front < 0.03 - 0.036, 'cups must clear the boiler housing'
    return s


def fam_panel(e, a):
    """Wall-hung flat things: radiators, whiteboard, screens, TV, sconce and the
    balustrade (which is a frame, not a panel, and is built as one)."""
    w, h, d = e['size']
    item = e['id']
    anchor = e.get('anchor', 'floor')
    s = Shape(e['id'], anchor, e['size'])
    slot = body(e, 'metal')

    if 'balustrade' in item:
        rail_h = h
        for sx in (-1, 1):
            s.box((0.05, rail_h - 0.04, 0.05), (sx * (w / 2 - 0.03), (rail_h - 0.04) / 2, 0),
                  'metal', bevel=0.005, name='post')
            s.box((0.06, 0.016, 0.06), (sx * (w / 2 - 0.03), 0.008, 0), 'metal',
                  bevel=0.003, name='base-plate')
        s.cyl(0.022, 0.022, w, (0, rail_h - 0.022, 0), slot, seg=10, axis='x',
              bevel=0.0, name='handrail')
        s.box((w - 0.06, 0.030, 0.030), (0, 0.10, 0), 'metal', bevel=0.004,
              name='bottom-rail')
        n = max(3, int(w / 0.11))
        for i in range(n):
            x = -w / 2 + 0.05 + (w - 0.10) * i / (n - 1)
            s.cyl(0.008, 0.008, rail_h - 0.12, (x, 0.10 + (rail_h - 0.12) / 2, 0),
                  'metal', seg=6, bevel=0.0, name='baluster')
        return s
    if 'towel' in item:
        for sx in (-1, 1):
            s.cyl(0.016, 0.016, h - 0.04, (sx * (w / 2 - 0.03), h / 2, d / 2), slot,
                  seg=8, bevel=0.0, name='riser')
        n = 9
        for i in range(n):
            y = 0.06 + (h - 0.12) * i / (n - 1)
            s.cyl(0.012, 0.012, w - 0.04, (0, y, d / 2), slot, seg=8, axis='x',
                  bevel=0.0, name='rail')
        # the brackets span the whole declared projection off the wall; at
        # d - 0.02 the towel rail measured 25 % short of its own catalogue depth
        for sx in (-1, 1):
            s.box((0.05, 0.05, d), (sx * (w / 2 - 0.03), h * 0.18, d / 2),
                  'metal', bevel=0.005, name='bracket')
            s.box((0.05, 0.05, d), (sx * (w / 2 - 0.03), h * 0.82, d / 2),
                  'metal', bevel=0.005, name='bracket-t')
        s.box((0.05, 0.10, 0.05), (-w / 2 + 0.03, 0.05, d / 2), 'chrome', bevel=0.005,
              name='valve')
        return s
    if 'radiator-panel' in item:
        # a double panel radiator IS as deep as the catalogue says: the front
        # panel starts at the wall and the convector fins run out to the face
        s.box((w, h - 0.06, d * 0.50), (0, h / 2, d * 0.25), slot, bevel=0.006,
              name='panel')
        for i in range(int(w / 0.06)):
            s.box((0.020, h - 0.12, d * 0.56), (-w / 2 + 0.04 + i * 0.06, h / 2,
                  d * 0.72), slot, bevel=0.0, name='fin')
        s.box((w - 0.02, 0.020, d * 0.90), (0, h - 0.02, d * 0.50), 'metal',
              bevel=0.004, name='top-grille')
        for sx in (-1, 1):
            s.box((0.05, 0.06, 0.05), (sx * (w / 2 - 0.05), 0.03, d * 0.30), 'chrome',
                  bevel=0.005, name='valve')
        return s
    if 'sconce' in item:
        # full-height back plate: the fitting is as tall as the catalogue says,
        # and at 0.235 m it measured 22 % under it
        s.box((w * 0.55, h, 0.020), (0, h / 2, 0.010), 'metal', bevel=0.004,
              name='back-plate')
        s.taper((w * 0.62, d * 0.5), (w, d), (0, h * 0.55, d / 2), axis='y',
                length=h * 0.72, slot=slot, bevel=0.008, name='shade')
        s.cyl(0.020, 0.020, 0.05, (0, h * 0.22, 0.030), 'metal', seg=8, bevel=0.0,
              name='arm')
        s.box((w - 0.04, 0.012, d - 0.03), (0, h * 0.90, d / 2), 'glass', bevel=0.0,
              name='diffuser')
        return s
    # whiteboard, meeting screen, TV
    screen = 'screen' in item or 'tv' in item
    frame_t = 0.030 if screen else 0.040
    s.box((w, h, d * 0.90), (0, h / 2, d * 0.45),
          body(e, 'graphite') if screen else 'metal', bevel=0.005, name='frame')
    s.box((w - frame_t * 2, h - frame_t * 2, 0.010), (0, h / 2, d - 0.006),
          'graphite' if screen else slot, bevel=0.0, name='face')
    if screen:
        s.box((w - frame_t * 2 - 0.008, h - frame_t * 2 - 0.008, 0.006),
              (0, h / 2, d - 0.003), 'glass', bevel=0.0, name='glass')
        s.box((w * 0.3, 0.014, 0.010), (0, 0.030, d - 0.007), 'metal', bevel=0.0,
              name='badge')
    else:
        # the tray sits INSIDE the declared 50 mm projection; at 75 mm deep
        # it put the whiteboard 50 % over its own catalogue depth
        # tray and pens in FRONT of the frame (which is a solid box d * 0.90
        # deep): at d * 0.62 both pens were inside it and the board had none
        s.box((w - 0.30, 0.030, 0.028), (0, 0.030, d - 0.014), 'metal', bevel=0.005,
              name='pen-tray')
        for i, col in enumerate(('accent', 'graphite')):
            s.cyl(0.009, 0.009, 0.12, (-0.20 + i * 0.10, 0.052, d - 0.010), col,
                  seg=6, axis='x', bevel=0.0, name='pen')
    return s


# ---------------------------------------------------------------------------
# OPENINGS
# ---------------------------------------------------------------------------


def fam_door_leaf(e, a):
    """Door family: leaf, hinges and a lever both sides, plus the variant each id
    promises -- a vision panel, a second leaf, a track and hangers, a closer, or
    an entrance rail-and-stile with a letterplate.
    """
    w, h, d = e['size']
    item = e['id']
    s = Shape(e['id'], 'wall', e['size'])
    slot = body(e, 'wood')
    leaf = max(0.040, float(a[2]) if len(a) > 2 else 0.04)
    glazed = 'glazed' in item
    double = 'double' in item
    sliding = 'sliding' in item
    entrance = 'entrance' in item
    n = 2 if double else 1
    lw = w / n

    for i in range(n):
        x0 = -w / 2 + lw * i
        cx = x0 + lw / 2
        # a sliding leaf hangs ON the wall face; the declared depth is the leaf
        # plus the track projection, so nothing is offset off the datum
        z0 = leaf / 2
        if glazed or entrance:
            rail = 0.14 if entrance else 0.12
            gh = h * (0.52 if entrance else 0.62)
            gy = h * (0.62 if entrance else 0.58)
            # four rails around the opening: the glass is IN the hole, not inside
            # a solid slab (which is how the window sashes got sealed shut)
            s.box((lw, h - gy - gh / 2, leaf), (cx, h - (h - gy - gh / 2) / 2, z0),
                  slot, bevel=0.005, name='top-rail')
            s.box((lw, gy - gh / 2, leaf), (cx, (gy - gh / 2) / 2, z0), slot,
                  bevel=0.005, name='bottom-rail')
            for sx in (-1, 1):
                sw = (lw - (lw - 2 * rail)) / 2
                s.box((sw, gh + 0.02, leaf), (cx + sx * (lw / 2 - sw / 2), gy, z0),
                      slot, bevel=0.005, name='stile')
            s.box((lw - rail * 2 + 0.01, gh, 0.012), (cx, gy, z0), 'glass',
                  bevel=0.0, name='vision-glass')
            # The bead is a FRAME round the pane. Built as one slab it was
            # (opening + 20 mm) x (opening + 10 mm) x 0.45 leaf on the pane's own
            # centre, so it swallowed the glass whole and every glazed door
            # rendered as a solid panelled leaf.
            bead = 0.022
            gw = lw - rail * 2 + 0.01
            for sx in (-1, 1):
                s.box((bead, gh + bead * 2, leaf * 0.45),
                      (cx + sx * (gw / 2 + bead / 2 - 0.004), gy, z0), slot,
                      bevel=0.004, name='bead-stile')
            for sy in (-1, 1):
                s.box((gw + bead * 2, bead, leaf * 0.45),
                      (cx, gy + sy * (gh / 2 + bead / 2 - 0.004), z0), slot,
                      bevel=0.004, name='bead-rail')
        else:
            s.box((lw, h, leaf), (cx, h / 2, z0), slot, bevel=0.005, name='leaf')
            s.box((lw - 0.10, h - 0.16, 0.006), (cx, h / 2 + 0.02, z0 + leaf / 2 - 0.001),
                  slot, bevel=0.004, name='panel-front')
            s.box((lw - 0.10, h - 0.16, 0.006), (cx, h / 2 + 0.02, z0 - leaf / 2 + 0.001),
                  slot, bevel=0.004, name='panel-back')
        hinge_x = cx - lw / 2 + 0.006 if i == 0 else cx + lw / 2 - 0.006
        if not sliding:
            for y in (0.24, h / 2, h - 0.24):
                s.box((0.018, 0.10, leaf + 0.006), (hinge_x, y, z0), 'chrome',
                      bevel=0.003, name='hinge')
        hx = cx + (lw / 2 - 0.065) * (1 if i == 0 else -1)
        if sliding:
            s.box((0.14, 0.20, 0.014), (hx, 1.05, z0 + leaf / 2 + 0.004), 'chrome',
                  bevel=0.004, name='flush-pull')
            s.box((0.10, 0.14, 0.010), (hx, 1.05, z0 + leaf / 2 + 0.008), 'graphite',
                  bevel=0.0, name='pull-recess')
        else:
            for zc, sgn in ((z0 + leaf / 2 + 0.008, 1), (z0 - leaf / 2 - 0.008, -1)):
                s.cyl(0.030, 0.030, 0.024, (hx, 1.05, zc - sgn * 0.008), 'chrome',
                      seg=12, axis='z', bevel=0.004, name='rose')
                s.tube([(hx, 1.05, zc - sgn * 0.004), (hx, 1.05, zc + sgn * 0.030),
                        (hx - 0.045 * (1 if i == 0 else -1), 1.048, zc + sgn * 0.034),
                        (hx - 0.100 * (1 if i == 0 else -1), 1.045, zc + sgn * 0.030)],
                       0.011, 'chrome', seg=8, name='lever')
    if double:
        s.box((0.020, h - 0.10, leaf + 0.010), (0, h / 2, leaf / 2), slot,
              bevel=0.004, name='astragal')
    if sliding:
        s.box((w, 0.055, 0.075), (0, h - 0.028, leaf + 0.0225), 'metal',
              bevel=0.006, name='track')
        for sx in (-1, 1):
            s.box((0.030, 0.075, 0.030), (sx * (w / 2 - 0.12), h - 0.050,
                  leaf + 0.014), 'metal', bevel=0.004, name='hanger')
    if 'fire' in item:
        s.box((0.30, 0.055, 0.055), (w / 2 - 0.30, h - 0.06, leaf + 0.030), 'metal',
              bevel=0.005, name='closer-arm')
        s.box((0.20, 0.075, 0.06), (w / 2 - 0.10, h - 0.06, leaf / 2 + 0.030), 'metal',
              bevel=0.006, name='closer-body')
        s.cyl(0.055, 0.055, 0.006, (0, h - 0.30, leaf + 0.002), 'accent', seg=12,
              axis='z', bevel=0.0, name='fire-sign')
    if entrance:
        # on the bottom rail, where a letterplate goes: at 0.90 it sat in the
        # glazed opening and touched nothing at all
        s.box((0.32, 0.06, 0.020), (0.0, 0.58, leaf + 0.004), 'chrome', bevel=0.004,
              name='letterplate')
        s.box((0.05, 0.20, 0.028), (-w / 2 + 0.10, 1.05, leaf + 0.010), 'chrome',
              bevel=0.005, name='pull-handle')
    return s


def fam_window(e, a):
    """Window family. THE SASHES ARE FRAMES, NOT SLABS, AND THEY TOUCH THE FRAME.

    The approved 1200x1400 shipped with each pane sealed inside a solid sash box
    with 38/16/37 mm of clearance on every axis, so no glass was ever visible --
    in a game whose core mechanic is daylight, every window was a blank panel.
    A sash is four rails around an opening now, the glass sits in the rebate
    touching them, and the sash LAPS the outer frame the way a casement does
    (it used to stop 17 mm inside it and hang there as a separate body).
    """
    w, h, d = e['size']
    sashes = int(a[2]) if len(a) > 2 else 1
    transom = int(a[3]) if len(a) > 3 else 0
    fw = float(a[4]) if len(a) > 4 else 0.06
    item = e['id']
    s = Shape(e['id'], 'wall', e['size'])
    slot = body(e, 'metal')
    roof = 'rooflight' in item
    fd = d if roof else min(0.085, d * 0.62)
    zc = d / 2 if roof else d * 0.38
    f = max(0.050, fw)
    lap = 0.012                       # how far the sash laps onto the frame
    # A shopfront stands on a solid spandrel panel. The frame used to start at
    # y = 0 and the panel was then laid over the bottom 0.28 m of it, sealing
    # the whole bottom frame rail and one sash rail per bay inside itself.
    base_h = 0.28 if 'shopfront' in item else 0.0
    gh = h - base_h                   # the glazed height, above any base panel

    s.box((w, f, fd), (0, base_h + f / 2, zc), slot, bevel=0.005, name='frame-b')
    s.box((w, f, fd), (0, h - f / 2, zc), slot, bevel=0.005, name='frame-t')
    for sx in (-1, 1):
        s.box((f, gh, fd), (sx * (w / 2 - f / 2), base_h + gh / 2, zc), slot,
              bevel=0.005, name='frame-s')

    bays = max(1, sashes) if sashes else 1
    inner_w = w - f * 2
    inner_h = gh - f * 2
    bay_w = inner_w / bays
    rail = min(0.052, bay_w * 0.16)
    st = 0.042
    zs = (d - st / 2 - 0.008) if roof else (zc + 0.008)
    handle_at = None

    for i in range(bays):
        cx = -inner_w / 2 + bay_w * (i + 0.5)
        if i > 0:
            s.box((f * 0.85, inner_h + 0.01, fd),
                  (-inner_w / 2 + bay_w * i, base_h + gh / 2, zc), slot,
                  bevel=0.005, name='mullion')
        rows = ((0.0, 0.72), (0.72, 1.0)) if transom else ((0.0, 1.0),)
        for r0, r1 in rows:
            row_h = inner_h * (r1 - r0)
            cy = base_h + f + inner_h * r0 + row_h / 2
            if transom and r0 > 0:
                s.box((bay_w + f, f * 0.8, fd), (cx, base_h + f + inner_h * r0, zc),
                      slot, bevel=0.005, name='transom')
            # the sash is the opening PLUS a lap onto the frame on every side
            sw = bay_w + lap * 2
            sh = row_h + lap * 2
            s.box((sw, rail, st), (cx, cy - sh / 2 + rail / 2, zs), slot,
                  bevel=0.004, name='sash-b')
            s.box((sw, rail, st), (cx, cy + sh / 2 - rail / 2, zs), slot,
                  bevel=0.004, name='sash-t')
            for sx in (-1, 1):
                s.box((rail, sh, st), (cx + sx * (sw / 2 - rail / 2), cy, zs), slot,
                      bevel=0.004, name='sash-s')
            # glass IN the opening, lapping the rails by 6 mm all round and
            # standing 4 mm proud of the sash face so it reads from both sides
            s.box((sw - rail * 2 + 0.012, sh - rail * 2 + 0.012, 0.010),
                  (cx, cy, zs + 0.004), 'glass', bevel=0.0, name='glazing')
            if handle_at is None and r1 - r0 > 0.5:
                handle_at = (cx - (sw / 2 - rail / 2), cy)

    if roof:
        pass          # the kerb IS the frame; the flashing skirt it used to
                      # carry was a box inside that kerb on every axis
    elif 'shopfront' in item:
        s.box((w, base_h + 0.02, d), (0, (base_h + 0.02) / 2, d / 2), slot,
              bevel=0.006, name='base-panel')
    else:
        s.box((w - 0.02, 0.026, d), (0, 0.013, d / 2), 'accent', bevel=0.006,
              name='sill')
    if handle_at is not None and 'rooflight' not in item:
        hx, hy = handle_at
        s.cyl(0.020, 0.020, 0.020, (hx, hy, zs + st / 2 - 0.004), 'chrome', seg=10,
              axis='z', bevel=0.003, name='handle-rose')
        s.box((0.022, 0.105, 0.020), (hx, hy - 0.05, zs + st / 2 + 0.008), 'chrome',
              bevel=0.004, name='handle')
    return s


# ---------------------------------------------------------------------------
# LIGHTING
# ---------------------------------------------------------------------------


def fam_pendant(e, a):
    """Pendant luminaire.

    The catalogue hangs this with `mount: 1.20` under a ceiling anchor, so the
    RUNTIME already provides the drop. The old model carried its own 1.20 m cord
    as well, which both broke the declared 0.24 m envelope by 500 % and would
    have hung the shade 2.64 m below the soffit. The model is the luminaire.
    """
    w, h, _ = e['size']
    s = Shape(e['id'], 'ceiling', e['size'])
    slot = body(e, 'metal')
    s.cyl(0.024, 0.024, h * 0.16, (0, -h * 0.08, 0), 'graphite', seg=8, bevel=0.0,
          name='cord-grip')
    s.cyl(w / 2, w / 2 * 0.34, h * 0.86, (0, -h * 0.14 - h * 0.43, 0), slot, seg=18,
          bevel=0.004, name='shade')
    # a lit disc across the shade's mouth, not a bulb sealed inside a solid
    # cone where nobody could ever see it (and where it read as a loose body)
    s.cyl(w / 2 * 0.94, w / 2 * 0.94, 0.012, (0, -h + 0.010, 0), 'glass', seg=18,
          bevel=0.0, name='diffuser')
    return s


def fam_linear_light(e, a):
    """Batten and track: a housing with a diffuser, or a track with spot heads."""
    w, h, d = e['size']
    s = Shape(e['id'], e.get('anchor', 'ceiling'), e['size'])
    slot = body(e, 'metal')
    if 'track' in e['id']:
        s.box((w, h * 0.36, d), (0, -h * 0.18, 0), 'graphite', bevel=0.004, name='track')
        for i in range(3):
            x = -w / 2 + w * (i + 0.5) / 3
            s.cyl(0.020, 0.020, h * 0.30, (x, -h * 0.48, 0), 'graphite', seg=8,
                  bevel=0.0, name='spot-stem')
            s.cyl(d * 0.32, d * 0.28, h * 0.36, (x, -h * 0.72, 0.004), 'graphite',
                  seg=10, rot=(0.5, 0, 0), bevel=0.004, name='spot-head')
            s.cyl(d * 0.24, d * 0.24, 0.010, (x, -h * 0.86, 0.014), 'glass', seg=10,
                  rot=(0.5, 0, 0), bevel=0.0, name='spot-lens')
        return s
    s.box((w, h * 0.55, d), (0, -h * 0.275, 0), slot, bevel=0.004, name='housing')
    s.box((w - 0.02, h * 0.55, d - 0.016), (0, -h * 0.70, 0), 'glass', bevel=0.0,
          name='diffuser')
    for sx in (-1, 1):
        s.box((0.03, h * 0.4, d), (sx * (w / 2 - 0.015), -h * 0.72, 0), slot,
              bevel=0.003, name='end-cap')
    return s


def fam_floor_lamp(e, a):
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    s.cyl(w * 0.42, w * 0.40, 0.022, (0, 0.011, 0), 'metal', seg=16, bevel=0.004,
          name='base')
    s.cyl(0.014, 0.014, h - 0.30, (0, (h - 0.30) / 2 + 0.02, 0), 'metal', seg=8,
          bevel=0.0, name='stem')
    s.cyl(w / 2 * 0.86, w / 2, 0.30, (0, h - 0.16, 0), slot, seg=18, bevel=0.004,
          name='shade')
    s.cyl(0.022, 0.022, 0.06, (0, h - 0.30, 0), 'metal', seg=8, bevel=0.0,
          name='lampholder')
    s.cyl(w / 2 * 0.80, w / 2 * 0.80, 0.012, (0, h - 0.304, 0), 'glass', seg=16,
          bevel=0.0, name='diffuser')
    return s


def fam_desk_lamp(e, a):
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    s.cyl(w / 2, w * 0.46, 0.020, (0, 0.010, 0), 'metal', seg=20, bevel=0.004,
          name='base')
    s.tube([(0, 0.014, -0.045), (0, h * 0.52, -0.055), (0, h * 0.80, -0.02),
            (0.0, h - 0.11, 0.012)], 0.010, 'metal', seg=6, name='arm')
    s.cyl(w * 0.40, w * 0.30, 0.10, (0, h - 0.098, 0.014), slot, seg=12,
          rot=(0.7, 0, 0), bevel=0.005, name='head')
    s.cyl(w * 0.26, w * 0.26, 0.010, (0, h - 0.135, 0.036), 'glass', seg=12,
          rot=(0.7, 0, 0), bevel=0.0, name='lens')
    return s


# ---------------------------------------------------------------------------
# OFFICE, EDUCATION, MISC
# ---------------------------------------------------------------------------


def fam_monitor(e, a):
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    s.box((w * 0.42, 0.016, d), (0, 0.008, 0), 'graphite', bevel=0.004,
          name='foot')
    s.box((0.06, h * 0.36, 0.05), (0, h * 0.18, -0.01), 'graphite', bevel=0.005,
          name='stem')
    bez = (0, h * 0.66, 0.006)
    s.box((w, h * 0.62, 0.028), bez, 'graphite', rot=(0.06, 0, 0),
          bevel=0.006, name='bezel')
    s.box((w - 0.024, h * 0.62 - 0.030, 0.010), _on(bez, 0.06, dz=0.013), 'glass',
          rot=(0.06, 0, 0), bevel=0.0, name='screen')
    s.box((0.06, 0.012, 0.014), _on(bez, 0.06, dy=-h * 0.30, dz=0.014), 'metal',
          rot=(0.06, 0, 0), bevel=0.0, name='badge')
    return s


def fam_plant(e, a):
    """Potted plants: a real pot with soil, a trunk with branches and individual
    leaf cards in three greens. The pot was 0.30 m across under a 1.80 m tree --
    a plant that would tip over -- so it is proportioned to the canopy now.
    """
    spread, h, _ = e['size']
    s = Shape(e['id'], 'floor', [spread, h, spread])
    slot = body(e, 'ceramic')
    big = h > 1.4
    pot_h = max(0.14, min(0.42, h * 0.22))
    pot_r = max(0.09, spread * (0.27 if big else 0.30))
    s.taper((pot_r * 1.55, pot_r * 1.55), (pot_r * 2.0, pot_r * 2.0), (0, pot_h / 2, 0),
            axis='y', length=pot_h, slot=slot, bevel=0.010, name='pot')
    s.ring((pot_r * 2.10, pot_r * 2.10), (pot_r * 1.86, pot_r * 1.86), 0.035,
           (0, pot_h - 0.017, 0), slot, seg=18, bevel=0.006, name='pot-rim')
    s.cyl(pot_r * 0.95, pot_r * 0.95, 0.045, (0, pot_h - 0.050, 0), 'soil', seg=18,
          bevel=0.004, name='soil')

    rng = _Rng(20260827)
    greens = ('foliage', 'foliage2', 'foliage3')
    if not big and h < 0.6:                          # small pot plant
        n = 0
        for i in range(18):
            a_ = i * 2.39996
            reach = spread * rng.f(0.16, 0.34)
            tip = (math.sin(a_) * reach, pot_h + rng.f(0.05, h - pot_h - 0.02),
                   math.cos(a_) * reach)
            s.tube([(0, pot_h - 0.03, 0), (tip[0] * 0.4, (pot_h + tip[1]) / 2, tip[2] * 0.4),
                    tip], 0.006, 'stem', seg=4, name='stem')
            # the card is centred ON the stem tip: offsetting it past the tip
            # left 7 of 18 leaves as loose quads floating beside the plant
            s.card((rng.f(0.06, 0.09), rng.f(0.07, 0.11)), tip, greens[n % 3],
                   rot=(rng.f(-0.8, -0.2), a_, rng.f(-0.4, 0.4)), name='leaf')
            n += 1
        return s

    top = h - (0.16 if big else 0.10)
    trunk = [(0.0, pot_h - 0.06, 0.0), (0.014, top * 0.42, -0.012),
             (-0.020, top * 0.66, 0.016), (0.012, top * 0.86, -0.008)]
    s.tube(trunk, 0.034 if big else 0.026, 'stem', seg=6, name='trunk')
    s.tube([(0.012, top * 0.85, -0.008), (0.004, top, 0.004)], 0.020, 'stem',
           seg=6, name='trunk-top')

    n_branch = 16 if big else 10
    leaves_per = 8 if big else 5
    leaf_lo, leaf_hi = (0.075, 0.115) if big else (0.11, 0.17)
    tips = []
    for i in range(n_branch):
        a_ = i * 2.39996 + rng.f(-0.22, 0.22)
        # canopy weighted to the top: a ficus is not bare-legged to head height
        base_t = 0.46 + 0.54 * ((i / max(1, n_branch - 1)) ** 0.72)
        by = pot_h + (top * 0.88 - pot_h) * base_t
        bx = 0.012 * math.sin(base_t * 3)
        reach = spread * (rng.f(0.24, 0.42) if big else rng.f(0.23, 0.35))
        rise = rng.f(0.10, 0.30) * (1.0 if big else 0.7)
        mid = (bx + math.sin(a_) * reach * 0.45, by + rise * 0.65,
               math.cos(a_) * reach * 0.45)
        tip = (bx + math.sin(a_) * reach, by + rise, math.cos(a_) * reach)
        s.tube([(bx, by, 0.0), mid, tip], rng.f(0.010, 0.015), 'stem', seg=5,
               name='branch')
        tips.append((mid, tip, a_))
    tips.append(((0.012, top * 0.86, -0.008), (0.004, top - 0.01, 0.004), 0.0))

    n = 0
    for mid, tip, a_ in tips:
        for k in range(leaves_per):
            t = 0.22 + 0.72 * k / max(1, leaves_per - 1)
            px = mid[0] + (tip[0] - mid[0]) * t
            py = mid[1] + (tip[1] - mid[1]) * t
            pz = mid[2] + (tip[2] - mid[2]) * t
            lw = rng.f(leaf_lo, leaf_hi)
            lh = rng.f(leaf_lo * 1.4, leaf_hi * 1.45)
            yaw = a_ + rng.f(-0.9, 0.9)
            pitch = rng.f(-0.85, -0.15)
            roll = rng.f(-0.45, 0.45)
            off = lh * 0.42
            s.card((lw, lh),
                   (px + math.sin(yaw) * off * 0.55, py + off * 0.42,
                    pz + math.cos(yaw) * off * 0.55),
                   greens[n % 3], rot=(pitch, yaw, roll), name='leaf')
            n += 1
    return s


def fam_mat(e, a):
    """Rugs and nap mats: a soft slab with a rolled edge, not a cardboard sheet."""
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'fabric')
    s.box((w - h, h * 0.9, d - h), (0, h / 2, 0), slot, bevel=min(0.012, h * 0.35),
          name='field')
    r = h / 2
    for sx in (-1, 1):
        s.cyl(r, r, d - h, (sx * (w / 2 - r), r, 0), slot, seg=8, axis='z',
              bevel=0.0, name='edge-x')
    for sz in (-1, 1):
        s.cyl(r, r, w - h, (0, r, sz * (d / 2 - r)), slot, seg=8, axis='x',
              bevel=0.0, name='edge-z')
    if h > 0.05:                                    # nap mat: a folded pillow end
        # the pillow is IN the declared 80 mm, not standing 18 mm proud of it
        s.box((w - h - 0.04, h * 0.55, d * 0.18), (0, h - h * 0.275,
              -d / 2 + d * 0.12), slot, bevel=0.014, name='pillow-end')
    else:
        s.box((w - h - 0.10, h * 0.5, d - h - 0.10), (0, h * 0.75, 0), 'accent',
              bevel=0.0, name='border')
    return s


def fam_stair_flight(e, a):
    """A straight flight: treads, risers, two CLOSED STRINGS and a rake balustrade.

    Two things were wrong. The going was derived as d/(n-1) while the catalogue
    means d/n (16 goings of 0.28 = 4.48 m, which is the declared depth), so the
    treads climbed a different line from the strings and 24 of the 43 parts came
    out as loose bodies. And the balustrade ran to 3.80 m in a 2.80 m storey --
    straight through the ceiling -- because it drew a 0.90 m rail above the top
    nosing. The rail above the landing belongs to the floor above.
    """
    w, h, d = e['size']
    n = int(a[1]) if len(a) > 1 else 16
    rise = h / n
    going = d / n
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    tread_t = 0.045
    string_t = 0.045
    # walking UP is towards -Z: nosing i sits at d/2 - going*(i+1), rise*(i+1),
    # so the nosing line runs from (d/2, 0) to (-d/2, h) exactly
    for i in range(n - 1):
        y = rise * (i + 1)
        z = d / 2 - going * (i + 0.5)
        s.box((w - string_t * 2 + 0.012, tread_t, going + 0.030),
              (0, y - tread_t / 2, z), slot, bevel=0.006, name='tread')
        s.box((w - string_t * 2, rise - tread_t + 0.012, 0.024),
              (0, y - rise / 2 - tread_t / 2, z - going / 2 + 0.012), slot,
              bevel=0.0, name='riser')
    # closed strings: a solid wedge under the nosing line, flat on the floor.
    # A rotated slab would hang below y = 0 and above y = h.
    for sx in (-1, 1):
        s.wedge((string_t, h, d), (sx * (w / 2 - string_t / 2), 0, 0), 'wood',
                bevel=0.006, name='string')
    # balustrade on the left string, capped at the floor above
    rail_h = 0.90
    x = -w / 2 + string_t / 2
    z_bot = d / 2 - 0.07
    y_bot = h * (d / 2 - z_bot) / d
    # the rake rail runs at rail_h above the pitch line and STOPS where it meets
    # the floor above
    z_top = d / 2 - d * (h - rail_h) / h
    y_top = h * (d / 2 - z_top) / d
    s.box((0.055, y_bot + rail_h, 0.055), (x, (y_bot + rail_h) / 2, z_bot), 'metal',
          bevel=0.005, name='newel-bottom')
    s.box((0.055, h, 0.055), (x, h / 2, z_top), 'metal', bevel=0.005, name='newel-top')
    s.tube([(x, y_bot + rail_h, z_bot), (x, y_top + rail_h, z_top)], 0.024, 'metal',
           seg=8, name='handrail')
    nb = max(3, n // 3)
    for i in range(nb):
        t = (i + 0.5) / nb
        z = z_bot + (z_top - z_bot) * t
        y0 = h * (d / 2 - z) / d
        y1 = y0 + rail_h
        s.cyl(0.011, 0.011, rail_h + 0.03, (x, (y0 + y1) / 2, z), 'metal', seg=6,
              bevel=0.0, name='baluster')
    return s


def fam_stair_u_return(e, a):
    """Two flights about a half landing, inside the declared 2.30 x 2.80 x 2.80.

    The carriages used to be rotated slabs: the lower one hung 107 mm below the
    floor and the upper one stood 107 mm above the storey, so the model measured
    3.01 m in a 2.80 m box. They are wedges now, flat on their own datum.
    """
    w, h, d = e['size']
    n = int(a[1]) if len(a) > 1 else 16
    gap = float(a[4]) if len(a) > 4 else 0.10
    flight_w = (w - gap) / 2
    per = n // 2
    rise = h / n
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'wood')
    land_d = 1.10
    run_d = d - land_d
    going = run_d / per
    tread_t = 0.045
    half = rise * per                     # half-landing level

    def flight(x0, up_from, z_nose0, direction):
        """`z_nose0` is the bottom nosing; the flight climbs towards `direction`."""
        for i in range(per):
            y = up_from + rise * (i + 1)
            z = z_nose0 + direction * going * (i + 0.5)
            s.box((flight_w, tread_t, going + 0.03), (x0, y - tread_t / 2, z), slot,
                  bevel=0.006, name='tread')
            s.box((flight_w - 0.02, rise - tread_t + 0.012, 0.024),
                  (x0, y - rise / 2 - tread_t / 2, z - direction * (going / 2 - 0.012)),
                  slot, bevel=0.0, name='riser')
        # a wedge carriage under the whole run, on the datum it starts from
        s.wedge((flight_w + 0.01, half, run_d),
                (x0, up_from, z_nose0 + direction * run_d / 2),
                'wood', rot=(0, 0 if direction < 0 else math.pi, 0),
                bevel=0.006, name='carriage')

    flight(-w / 2 + flight_w / 2, 0.0, d / 2, -1)
    flight(w / 2 - flight_w / 2, half, -d / 2 + land_d, 1)
    s.box((w, 0.14, land_d + 0.02), (0, half - 0.07, -d / 2 + land_d / 2), slot,
          bevel=0.008, name='half-landing')
    for sgn in (-1, 1):
        s.box((0.06, half + 0.06, 0.06), (sgn * (w / 2 - 0.03), (half + 0.06) / 2,
              -d / 2 + 0.05), 'metal', bevel=0.005, name='landing-post')
    for sgn in (-1, 1):
        s.box((0.05, 0.94, 0.05), (sgn * (w / 2 - 0.03), half + 0.47, -d / 2 + 0.05),
              'metal', bevel=0.005, name='landing-newel')
    s.box((w - 0.06, 0.045, 0.045), (0, half + 0.90, -d / 2 + 0.05), 'metal',
          bevel=0.005, name='landing-rail')
    s.box((gap + 0.06, 0.14, run_d), (0, half - 0.07, -d / 2 + land_d + run_d / 2),
          'wood', bevel=0.006, name='well-beam')
    return s


def fam_lift_shaft(e, a):
    """Lift enclosure to EN 81-70: 1.10 x 1.40 car, 0.90 m clear door."""
    w, h, d = e['size']
    door_w = float(a[3]) if len(a) > 3 else 0.9
    door_h = float(a[4]) if len(a) > 4 else 2.1
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    t = 0.09
    s.box((w, h, t), (0, h / 2, -d / 2 + t / 2), slot, bevel=0.006, name='back')
    for sx in (-1, 1):
        s.box((t, h, d - t), (sx * (w / 2 - t / 2), h / 2, 0.01), slot, bevel=0.006,
              name='side')
    s.box((w, h - door_h, t), (0, door_h + (h - door_h) / 2, d / 2 - t / 2), slot,
          bevel=0.006, name='lintel')
    for sx in (-1, 1):
        jamb = (w - door_w) / 2
        s.box((jamb, door_h, t), (sx * (w / 2 - jamb / 2), door_h / 2, d / 2 - t / 2),
              slot, bevel=0.006, name='jamb')
    for sx in (-1, 1):
        s.box((door_w / 2 - 0.006, door_h - 0.02, 0.030),
              (sx * (door_w / 4), (door_h - 0.02) / 2, d / 2 - 0.030), 'metal',
              bevel=0.005, name='car-door')
    s.box((w, 0.05, 0.05), (0, door_h + 0.02, d / 2 - 0.03), 'metal', bevel=0.005,
          name='door-head')
    # both stand PROUD of the jamb. Recessed 20 mm into a 90 mm jamb they were
    # geometry sealed inside the wall, invisible and unattached.
    s.box((0.10, 0.30, 0.030), (door_w / 2 + 0.08, 1.05, d / 2 - 0.008), 'graphite',
          bevel=0.005, name='call-panel')
    s.box((0.07, 0.10, 0.012), (door_w / 2 + 0.08, 1.20, d / 2 + 0.004), 'glass',
          bevel=0.0, name='call-display')
    s.box((w - 0.04, 0.030, 0.10), (0, 0.015, d / 2 - 0.06), 'metal', bevel=0.004,
          name='sill')
    return s


def fam_ramp(e, a):
    """1:12 accessible ramp, built as a WEDGE.

    The deck used to be a stack of boxes whose first segment started 59 mm below
    the floor -- you walked into a step to reach the ramp -- and the rotated
    skin over it put the piece 23 % over its declared 0.40 m rise. A wedge has a
    flat underside on the floor plane and a top face that runs from 0.000 at the
    bottom to exactly h at the top, so both problems are structural, not tuned.
    """
    w, h, d = e['size']
    s = Shape(e['id'], 'floor', e['size'])
    slot = body(e, 'metal')
    s.wedge((w, h, d), (0, 0, 0), slot, bevel=0.0, name='deck')
    # edge protection is a flush strip ON the deck, not an upstand over it
    for sx in (-1, 1):
        s.box((0.040, 0.014, d - 0.30), (sx * (w / 2 - 0.05), h / 2, 0), 'graphite',
              rot=(math.atan2(h, d), 0, 0), bevel=0.0, name='edge-strip')
    for i in range(7):
        z = d / 2 - 0.12 - (d - 0.34) * i / 6
        y = h * (d / 2 - z) / d
        s.box((w - 0.14, 0.014, 0.040), (0, y - 0.004, z), 'accent',
              rot=(math.atan2(h, d), 0, 0), bevel=0.0, name='nosing-strip')
    return s


# ---------------------------------------------------------------------------
# the registry
# ---------------------------------------------------------------------------

FAMILIES = {
    'procChair': fam_chair,
    'procStackChair': fam_stack_chair,
    'procTaskChair': fam_task_chair,
    'procSofa': fam_sofa,
    'procStool': fam_stool,
    'procTable': fam_table,
    'procRoundTable': fam_round_table,
    'procDesk': fam_desk,
    'procCounter': fam_counter,
    'procCabinet': fam_cabinet,
    'procDrawers': fam_drawers,
    'procShelf': fam_shelf,
    'procBed': fam_bed,
    'procCot': fam_cot,
    'procWC': fam_wc,
    'procWCWallHung': fam_wc_wall_hung,
    'procUrinal': fam_urinal,
    'procBasin': fam_basin,
    'procBath': fam_bath,
    'procShower': fam_shower,
    'procKitchenBase': fam_kitchen_base,
    'procKitchenWall': fam_kitchen_wall,
    'procTallUnit': fam_tall_unit,
    'procHob': fam_hob,
    'procBlock': fam_block,
    'procPanel': fam_panel,
    'procDoorLeaf': fam_door_leaf,
    'procWindowFrame': fam_window,
    'procPendant': fam_pendant,
    'procLinearLight': fam_linear_light,
    'procFloorLamp': fam_floor_lamp,
    'procDeskLamp': fam_desk_lamp,
    'procMonitor': fam_monitor,
    'procPlant': fam_plant,
    'procMat': fam_mat,
    'procStairFlight': fam_stair_flight,
    'procStairUReturn': fam_stair_u_return,
    'procLiftShaft': fam_lift_shaft,
    'procRamp': fam_ramp,
}


def builder_for(entry):
    """The builder for a catalogue entry, or None. Keyed on the family, not the
    id, so a new catalogue entry in an existing family builds with no edit here.
    """
    proc = entry.get('proc')
    if not proc:
        return None
    fn = FAMILIES.get(proc[0])
    if fn is None:
        return None
    return lambda e: fn(e, list(proc)[1:])


# THE DECLARED ENVELOPE, where a real fitting stands outside its catalogue box.
#
# Every one of the 122 entries is built to the size its own catalogue row gives.
# Fifteen of them then carry a piece of real ironmongery that cannot fit inside
# that box: a basin's catalogue height IS its rim height (the same number the
# entry carries as `workHeight`, which the ergonomics module reads), and a deck
# mixer stands 0.18 m above the rim; a door's catalogue thickness is the LEAF,
# and a lever projects 0.05 m each side of it.
#
# These are the only fifteen, they are all a single axis, and each one is
# printed as `drift` by verify.mjs and written into _tmp/catalog-handoff.json
# with the value src/model/catalog.js should carry. That file belongs to another
# agent; this pipeline reports and never edits. Nothing here is a licence to
# scale a wrong design into place -- the finished mesh is still asserted against
# the number below to within 4 %.
#
# Keep in step with EXPECTED_DRIFT in verify.mjs; a mismatch fails the audit.
ENVELOPE = {
    # deck mixers above a rim height
    'basin-560': [0.56, 1.03, 0.46],
    'basin-cloak-400': [0.40, 1.03, 0.30],
    'basin-clinical': [0.60, 1.08, 0.50],
    'basin-vanity-800': [0.80, 1.07, 0.48],
    'kitchen-base-sink-800': [0.80, 1.12, 0.60],
    'kids-basin-row': [1.20, 0.77, 0.40],
    'bath-1700': [1.70, 0.74, 0.75],
    # lever handles either side of a leaf
    'door-internal-800': [0.80, 2.05, 0.15],
    'door-internal-900': [0.90, 2.05, 0.15],
    'door-internal-1000': [1.00, 2.05, 0.15],
    'door-glazed-900': [0.90, 2.05, 0.15],
    'door-double-1600': [1.60, 2.10, 0.15],
    'door-fire-ei30-900': [0.90, 2.05, 0.17],
    'door-entrance-1000': [1.00, 2.10, 0.18],
}

# Kept for the case where a family must be BUILT to something other than the
# catalogue number. Empty: every family reads the catalogue directly.
SIZE_OVERRIDES = {}

# Per-item fit tolerance. Joinery is built to the millimetre and gets the 4 %
# default; an organic canopy has no canonical spread, so a plant may be nudged
# further onto its declared envelope without that meaning anything is wrong.
FIT_MAX = {
    'plant-ficus-large': 0.14,
    'plant-monstera': 0.14,
    'plant-pot-small': 0.16,
}

# Every axis of every item is now fitted and asserted. This table used to
# exempt 19 items from one or two axes each, and those unwatched axes are
# exactly where the drift hid: a wall-hung basin whose rim landed at 0.53 m
# instead of 0.85, an island 24 % over its own depth, a kids' basin row 41 %
# over its height. Anything that legitimately sits outside the catalogue box
# belongs in ENVELOPE above, where it is declared and handed off.
FIT_AXES = {}
