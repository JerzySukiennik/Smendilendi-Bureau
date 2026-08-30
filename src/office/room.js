// room.js — the studio shell.
//
// A converted top-floor loft occupied by a small architecture practice:
//   interior 15.00 x 9.60 m, 3.30 m floor to soffit, 0.24 m exterior walls.
//   west wall  (x = 0)     three full-height glazed bays, 2.20 x 2.60, sill 0.45
//   north wall (z = 0)     limewashed brick feature wall + a 0.65 m clerestory
//   east wall  (x = 15.0)  solid, the tea point and the plotter live against it
//   south wall (z = 9.6)   solid, single leaf door 0.90 x 2.05 at x = 12.60
//   soffit                 five exposed downstand beams, 0.25 w x 0.35 deep
//
// Everything is generated, vertex-AO-baked and merged into one geometry per
// material class. The whole shell is SIX draw calls.
//
// Two things here are load-bearing for the finish bar
// (reference/architect-life/ANALYSIS.md):
//   * item 5 — a measurable AO band at every wall/floor and wall/ceiling
//     junction. It is baked into vertex colour by aoFloor()/aoCeil()/aoCorner()
//     below, ~45 % darkening over the last 0.55 m, so two pixels 20 px apart
//     across a junction differ by far more than the 12/255 the bar requires.
//   * item 7 — a hard directional light patch through an opening. The glazed
//     bays are REAL GAPS in a shadow-casting wall, so the sun draws its own
//     rectangles on the floor. Nothing here is a painted-on fake.

import {
  BufferGeometry, BufferAttribute, PlaneGeometry, BoxGeometry, Mesh, Group,
  Vector3, Color,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBuilder, builderMaterial, compensate, OFFICE } from './props.js';

export const ROOM = {
  W: 15.00,          // interior, x
  D: 9.60,           // interior, z
  H: 3.30,           // floor to soffit
  WALL: 0.24,        // exterior wall thickness
  SILL: 0.45,
  HEAD: 3.05,
  CLEREST_BOTTOM: 2.40,
  CLEREST_TOP: 3.05,
  BRICK_TOP: 2.30,
  DOOR_X: 12.60,
  DOOR_W: 0.90,
  DOOR_H: 2.05,
  // glazed bays on the west wall: [z centre, width]
  BAYS: [[2.00, 2.20], [4.80, 2.20], [7.60, 2.20]],
};

// --- AO ramps --------------------------------------------------------------
const sm = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
/** Darkening near the floor: 0.52 at contact, full by 0.55 m. */
const aoFloor = (y) => 0.52 + 0.48 * sm(y / 0.55);
/**
 * Darkening near the soffit, ON THE WALL.
 *
 * Finish bar item 5 asks for >= 12/255 across a junction. Round 1 measured
 * 0/255 at wall/ceiling: the wall arrived at the soffit at 0.62 and the ceiling
 * arrived at the same wall at 0.58, so the two surfaces met at the identical
 * value and the "AO band" was invisible — a gradient with nothing on the other
 * side of it is not a junction, it is a wash. In a real room the CEILING is the
 * darker of the two at the joint (it is the surface facing away from every light
 * and the one the wall bounces into), so the wall's ramp is now shallow and the
 * ceiling's, below, is deep.
 */
const aoCeil = (y) => 0.78 + 0.22 * sm((ROOM.H - y) / 0.40);
/** Darkening of the CEILING PLANE near a wall — the other half of that band. */
const aoCeilEdge = (d) => 0.34 + 0.66 * sm(d / 0.90);
/** Darkening near a vertical corner, d = distance to the nearest return. */
const aoCorner = (d) => 0.58 + 0.42 * sm(d / 0.70);
/** Floor darkening near a wall. */
const aoFloorEdge = (d) => 0.50 + 0.50 * sm(d / 0.85);

/**
 * A subdivided quad with a per-vertex shade callback.
 * plane is authored in the XY plane facing +z, then transformed by the caller.
 */
function shadedPlane(w, h, nx, ny, shade, color, mat = 'flat') {
  const g = new PlaneGeometry(w, h, nx, ny);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = compensate(mat, color);
  for (let i = 0; i < pos.count; i++) {
    const k = shade(pos.getX(i) + w / 2, pos.getY(i) + h / 2);
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/**
 * Limewashed brick. 215 x 65 bricks on a 225 x 75 module, running bond, each
 * brick its own quad with its own brightness so a flat-shaded wall still reads
 * as masonry. Joints are the dark backing plane showing through the 10 mm gap.
 */
function brickWall(w, h, seed = 17) {
  const MOD_W = 0.225, MOD_H = 0.075, BW = 0.215, BH = 0.065;
  const cols = Math.ceil(w / MOD_W) + 1;
  const rows = Math.ceil(h / MOD_H);
  const verts = [], norms = [], colours = [], idx = [];
  let rnd = seed;
  const R = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const base = new Color(OFFICE.limewash);
  const proud = [];
  let v = 0;
  for (let r = 0; r < rows; r++) {
    const y0 = r * MOD_H;
    const off = (r % 2) ? -MOD_W / 2 : 0;
    for (let c = 0; c < cols; c++) {
      const x0 = off + c * MOD_W;
      const x1 = Math.min(x0 + BW, w), xa = Math.max(x0, 0);
      if (x1 <= xa) continue;
      const y1 = Math.min(y0 + BH, h);
      if (y1 <= y0) continue;
      const k = 0.88 + R() * 0.22;
      // one brick in ~18 sits proud — the detail that makes a flat wall read
      if (R() > 0.945) proud.push([xa, y0, x1 - xa, y1 - y0, k]);
      const zc = 0.012;
      verts.push(xa, y0, zc, x1, y0, zc, x1, y1, zc, xa, y1, zc);
      for (let i = 0; i < 4; i++) {
        norms.push(0, 0, 1);
        colours.push(base.r * k, base.g * k, base.b * k);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(norms), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  g.setIndex(idx);
  return { geometry: g, proud };
}

/**
 * buildRoom() -> { group, colliders, meshes, glazing, dims }
 * colliders: wall segments in plan, { x1, z1, x2, z2 } — see player.js.
 */
export function buildRoom(opts = {}) {
  const { W, D, H, WALL, SILL, HEAD, BAYS, BRICK_TOP, CLEREST_BOTTOM, CLEREST_TOP } = ROOM;
  const group = new Group();
  group.name = 'room';
  const b = new MeshBuilder();
  b._ao = false;                    // the shell bakes its own AO, not the prop AO

  // ---- floor: polished concrete slab with 3.0 m saw-cut joints -------------
  {
    const g = shadedPlane(W, D, 30, 20, (x, y) => {
      const d = Math.min(x, W - x, y, D - y);
      return aoFloorEdge(d);
    }, OFFICE.concreteFloor, 'polishedConcrete');
    g.rotateX(-Math.PI / 2);
    g.translate(W / 2, 0, D / 2);
    b.parts.set('polishedConcrete', [g]);
  }
  // saw cuts, 4 mm wide, 3.0 m grid — also the room's lead lines
  for (let x = 3; x < W; x += 3) {
    b.box(0.006, 0.002, D - 0.02, { x, y: 0.0015, z: D / 2, color: 0x6f6a63, mat: 'polishedConcrete', ao: false });
  }
  for (let z = 3; z < D; z += 3) {
    b.box(W - 0.02, 0.002, 0.006, { x: W / 2, y: 0.0015, z, color: 0x6f6a63, mat: 'polishedConcrete', ao: false });
  }

  // ---- ceiling -------------------------------------------------------------
  //
  // OVER: the plane runs 0.26 m PAST the interior on every side, so it laps over
  // the top of the wall. Built exactly to the interior it met the wall on a
  // shared edge, and the hairline between them leaked the 205-luma sky straight
  // into the room — a stepped, aliased cream line at 199 luma running the whole
  // length of every wall, which is what a critic actually saw at the junction
  // instead of an AO band.
  const OVER = 0.26;
  {
    const g = shadedPlane(W + OVER * 2, D + OVER * 2, 30, 20, (x, y) => {
      const d = Math.min(x - OVER, W + OVER - x, y - OVER, D + OVER - y);
      return aoCeilEdge(d);
    }, OFFICE.ceiling, 'plaster');
    g.rotateX(Math.PI / 2);
    g.translate(W / 2, H, D / 2);
    b.parts.set('plaster', [g]);
  }
  // five exposed downstand beams spanning the 9.6 m direction
  const beamX = [2.5, 5.0, 7.5, 10.0, 12.5];
  for (const x of beamX) {
    b.box(0.25, 0.35, D, { x, y: H - 0.175, z: D / 2, color: 0xdcd4c6, mat: 'plaster', ao: false });
    // a slightly darker underside sells the beam as a solid, not a stripe
    b.box(0.25, 0.004, D, { x, y: H - 0.352, z: D / 2, color: 0x9e978a, mat: 'plaster', ao: false });
  }

  // ---- north wall: limewashed brick + clerestory ---------------------------
  {
    const { geometry, proud } = brickWall(W, BRICK_TOP);
    // AO bake on the brick: floor band, and the two vertical returns
    const pos = geometry.attributes.position;
    const col = geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const k = aoFloor(y) * aoCorner(Math.min(x, W - x)) * (0.70 + 0.30 * sm((BRICK_TOP - y) / 0.30));
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    geometry.rotateY(0);            // already faces +z
    b.parts.set('flat', (b.parts.get('flat') || []).concat([geometry]));
    for (const [x, y, pw, ph, k] of proud) {
      b.box(pw, ph, 0.012, {
        x: x + pw / 2, y: y + ph / 2, z: 0.018,
        color: new Color(OFFICE.limewash).multiplyScalar(k * aoFloor(y) * 1.04).getHex(), ao: false,
      });
    }
    // backing plane = the mortar joints
    b.box(W, BRICK_TOP, 0.02, { x: W / 2, y: BRICK_TOP / 2, z: -0.01, color: 0x8a8279, ao: false });
    // brick-on-edge coping between brick and clerestory
    b.box(W, 0.10, 0.13, { x: W / 2, y: BRICK_TOP + 0.05, z: 0.05, color: OFFICE.limewashDk, ao: false });
  }
  // clerestory head panel + the piers between the four lights
  b.box(W, H + 0.06 - CLEREST_TOP, 0.10, { x: W / 2, y: (CLEREST_TOP + H + 0.06) / 2, z: 0.05, color: OFFICE.wallShade, mat: 'plaster', ao: false });
  b.box(W, CLEREST_BOTTOM - BRICK_TOP - 0.10, 0.10, { x: W / 2, y: (BRICK_TOP + 0.10 + CLEREST_BOTTOM) / 2, z: 0.05, color: OFFICE.wallShade, mat: 'plaster', ao: false });
  const clerX = [3.75, 7.50, 11.25];
  for (const x of clerX) {
    b.box(0.16, CLEREST_TOP - CLEREST_BOTTOM, 0.14, { x, y: (CLEREST_BOTTOM + CLEREST_TOP) / 2, z: 0.05, color: OFFICE.wallShade, mat: 'plaster', ao: false });
  }

  // ---- west wall: three full-height glazed bays ----------------------------
  // Piers between and beside the bays, plus a head and a sill panel per bay.
  const bayEdges = [];
  for (const [zc, bw] of BAYS) bayEdges.push([zc - bw / 2, zc + bw / 2]);
  let cursor = 0;
  const westShade = (yy) => aoFloor(yy) * aoCeil(yy);
  const wallPanel = (z0, z1, y0, y1) => {
    if (z1 - z0 < 0.001 || y1 - y0 < 0.001) return;
    const g = shadedPlane(z1 - z0, y1 - y0, Math.max(1, Math.round((z1 - z0) * 4)), Math.max(1, Math.round((y1 - y0) * 4)),
      (u, vv) => westShade(y0 + vv) * aoCorner(Math.min(z0 + u, D - (z0 + u))),
      OFFICE.wallPaint, 'plaster');
    g.rotateY(Math.PI / 2);
    g.translate(0.001, y0 + (y1 - y0) / 2, z0 + (z1 - z0) / 2);
    b.parts.set('plaster', (b.parts.get('plaster') || []).concat([g]));
    // The solid behind it, so the wall casts a real shadow — and, where it
    // reaches the soffit, carried 60 mm PAST it, so there is no hairline for
    // the sky to come through.
    const top = y1 >= H - 1e-6 ? H + 0.06 : y1;
    b.box(WALL, top - y0, z1 - z0, { x: -WALL / 2, y: (y0 + top) / 2, z: (z0 + z1) / 2, color: OFFICE.wallShade, mat: 'plaster', ao: false });
  };
  for (const [z0, z1] of bayEdges) {
    wallPanel(cursor, z0, 0, H);
    wallPanel(z0, z1, 0, SILL);
    wallPanel(z0, z1, HEAD, H);
    cursor = z1;
  }
  wallPanel(cursor, D, 0, H);

  // ---- east wall -----------------------------------------------------------
  {
    const g = shadedPlane(D, H, 20, 14, (u, vv) => westShade(vv) * aoCorner(Math.min(u, D - u)), OFFICE.wallPaint, 'plaster');
    g.rotateY(-Math.PI / 2);
    g.translate(W - 0.001, H / 2, D / 2);
    b.parts.set('plaster', (b.parts.get('plaster') || []).concat([g]));
    b.box(WALL, H + 0.06, D + WALL * 2, { x: W + WALL / 2, y: (H + 0.06) / 2, z: D / 2, color: OFFICE.wallShade, mat: 'plaster', ao: false });
  }

  // ---- south wall (with the door opening) ---------------------------------
  {
    const dx0 = ROOM.DOOR_X - ROOM.DOOR_W / 2, dx1 = ROOM.DOOR_X + ROOM.DOOR_W / 2;
    const seg = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return;
      const g = shadedPlane(x1 - x0, y1 - y0, Math.max(1, Math.round((x1 - x0) * 3)), Math.max(1, Math.round((y1 - y0) * 4)),
        (u, vv) => westShade(y0 + vv) * aoCorner(Math.min(x0 + u, W - (x0 + u))), OFFICE.wallPaint, 'plaster');
      g.rotateY(Math.PI);
      g.translate(x0 + (x1 - x0) / 2, y0 + (y1 - y0) / 2, D - 0.001);
      b.parts.set('plaster', (b.parts.get('plaster') || []).concat([g]));
      const top = y1 >= H - 1e-6 ? H + 0.06 : y1;
      b.box(x1 - x0, top - y0, WALL, { x: (x0 + x1) / 2, y: (y0 + top) / 2, z: D + WALL / 2, color: OFFICE.wallShade, mat: 'plaster', ao: false });
    };
    seg(0, dx0, 0, H);
    seg(dx0, dx1, ROOM.DOOR_H, H);
    seg(dx1, W, 0, H);
    // door lining + a closed leaf
    b.box(ROOM.DOOR_W + 0.08, 0.06, 0.30, { x: ROOM.DOOR_X, y: ROOM.DOOR_H + 0.03, z: D + 0.03, color: OFFICE.charcoal, mat: 'ink', ao: false });
    b.box(ROOM.DOOR_W, ROOM.DOOR_H, 0.045, { x: ROOM.DOOR_X, y: ROOM.DOOR_H / 2, z: D + 0.06, color: OFFICE.charcoal, mat: 'ink', ao: false });
    b.box(0.02, 0.13, 0.05, { x: ROOM.DOOR_X - 0.35, y: 1.05, z: D + 0.03, color: OFFICE.steel, mat: 'metal', ao: false });
  }

  // ---- skirting: 80 mm, dark. The AO band made physical. -------------------
  const sk = 0.08;
  b.box(W, sk, 0.022, { x: W / 2, y: sk / 2, z: 0.011, color: OFFICE.skirting, mat: 'ink', ao: false });
  b.box(W, sk, 0.022, { x: W / 2, y: sk / 2, z: D - 0.011, color: OFFICE.skirting, mat: 'ink', ao: false });
  b.box(0.022, sk, D, { x: 0.011, y: sk / 2, z: D / 2, color: OFFICE.skirting, mat: 'ink', ao: false });
  b.box(0.022, sk, D, { x: W - 0.011, y: sk / 2, z: D / 2, color: OFFICE.skirting, mat: 'ink', ao: false });

  // ---- glazing: frames (metal) + panes (glass) ----------------------------
  const glazing = [];
  const frame = 0.055;
  for (const [zc, bw] of BAYS) {
    const z0 = zc - bw / 2, z1 = zc + bw / 2;
    const hgt = HEAD - SILL;
    // outer frame
    b.box(0.07, frame, bw, { x: 0.035, y: SILL + frame / 2, z: zc, color: 0xf2eee7, mat: 'metal', ao: false });
    b.box(0.07, frame, bw, { x: 0.035, y: HEAD - frame / 2, z: zc, color: 0xf2eee7, mat: 'metal', ao: false });
    b.box(0.07, hgt, frame, { x: 0.035, y: SILL + hgt / 2, z: z0 + frame / 2, color: 0xf2eee7, mat: 'metal', ao: false });
    b.box(0.07, hgt, frame, { x: 0.035, y: SILL + hgt / 2, z: z1 - frame / 2, color: 0xf2eee7, mat: 'metal', ao: false });
    // one mullion, one transom — slim, as an architect would specify
    b.box(0.07, hgt, 0.045, { x: 0.035, y: SILL + hgt / 2, z: zc, color: 0xf2eee7, mat: 'metal', ao: false });
    b.box(0.07, 0.045, bw, { x: 0.035, y: SILL + hgt * 0.66, z: zc, color: 0xf2eee7, mat: 'metal', ao: false });
    // internal cill board
    b.box(0.22, 0.035, bw + 0.10, { x: 0.11, y: SILL - 0.0175, z: zc, color: OFFICE.oakPale, mat: 'wood-light', ao: false });
    glazing.push({ x: 0.05, y: SILL + hgt / 2, z: zc, w: bw, h: hgt, sill: SILL, head: HEAD, normal: new Vector3(1, 0, 0) });
  }
  // clerestory frames
  for (let i = 0; i < 4; i++) {
    const x0 = i === 0 ? 0.10 : clerX[i - 1] + 0.08;
    const x1 = i === 3 ? W - 0.10 : clerX[i] - 0.08;
    const cw = x1 - x0, ch = CLEREST_TOP - CLEREST_BOTTOM;
    b.box(cw, 0.04, 0.07, { x: (x0 + x1) / 2, y: CLEREST_BOTTOM + 0.02, z: 0.035, color: 0xf2eee7, mat: 'metal', ao: false });
    b.box(cw, 0.04, 0.07, { x: (x0 + x1) / 2, y: CLEREST_TOP - 0.02, z: 0.035, color: 0xf2eee7, mat: 'metal', ao: false });
    glazing.push({ x: (x0 + x1) / 2, y: (CLEREST_BOTTOM + CLEREST_TOP) / 2, z: 0.05, w: cw, h: ch, normal: new Vector3(0, 0, 1) });
  }

  // Build the opaque shell.
  const parts = b.build();
  const meshes = {};
  for (const { mat, geometry } of parts) {
    const m = new Mesh(geometry, builderMaterial(mat));
    m.name = `room:${mat}`;
    m.castShadow = mat !== 'polishedConcrete';
    m.receiveShadow = true;
    group.add(m);
    meshes[mat] = m;
  }

  // Glass panes as one mesh, added last so blending sorts behind nothing.
  {
    const gs = [];
    for (const g of glazing) {
      const pane = new PlaneGeometry(g.normal.x ? g.w : g.w, g.h);
      if (g.normal.x) pane.rotateY(Math.PI / 2);
      pane.translate(g.x, g.y, g.z);
      pane.deleteAttribute('uv');
      gs.push(pane);
    }
    const merged = mergeGeometries(gs, false);
    const glass = new Mesh(merged, builderMaterial('glass'));
    glass.name = 'room:glass';
    glass.renderOrder = 3;
    group.add(glass);
    meshes.glass = glass;
  }

  // ---- collision: plan segments -------------------------------------------
  // A capsule-vs-segment test (player.js). Openings are ignored: you cannot
  // walk through a window, and the door is closed.
  const colliders = [
    { x1: 0, z1: 0, x2: W, z2: 0 },
    { x1: W, z1: 0, x2: W, z2: D },
    { x1: W, z1: D, x2: 0, z2: D },
    { x1: 0, z1: D, x2: 0, z2: 0 },
  ];

  return { group, colliders, meshes, glazing, dims: { ...ROOM } };
}

/** Where the sun patch from a given bay lands, for framing and for the report. */
export function sunPatchFootprint(bay, sunDir) {
  // sunDir points FROM the sun TOWARDS the scene (normalised).
  const drop = -sunDir.y;
  if (drop <= 0.01) return null;
  const hx = sunDir.x, hz = sunDir.z;
  const near = bay.sill / drop, far = bay.head / drop;
  return {
    near: new Vector3(bay.x + hx * near, 0, bay.z + hz * near),
    far: new Vector3(bay.x + hx * far, 0, bay.z + hz * far),
    length: far - near,
  };
}
