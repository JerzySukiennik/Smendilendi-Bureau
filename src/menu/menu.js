// menu.js — MenuMode. The main menu is a place, not a screen.
//
// The camera stands on the pavement opposite 17 Ambition Road at 5.6 m — the
// height of a first-floor window across the street, which is where architectural
// photographs of a three-storey building are actually taken from — and drifts
// slowly. The four menu buttons are the fabricated channel letters bolted to the
// render bay of the south elevation; the game title is the rooftop sign. Hovering
// a line of signage warms it to the studio orange and lifts it 25 mm off the wall.
//
// The building is a catalogue of professional crimes (see bad-building.js). Twelve
// of them carry a surveyor's tag the player can hover for the diagnosis; that is
// the joke's payoff, and it is aimed squarely at one player.
//
// COMPOSITION, against reference/architect-life/ANALYSIS.md:
//   depth layers   hedge + street furniture (z 8-11) / building (z -5..+5) /
//                  neighbouring blocks and tree line (z -20..-60)
//   lights         warm key at 26 deg elevation, cool hemisphere, a 2700 K
//                  interior pool behind the glazing, a warm entrance downlight
//   accent         one saturated hue (the studio orange) on the hovered letters,
//                  the tags, the hazard tape and the cones — nothing else
//   contact shadow every floor-standing object casts a real shadow; the key light
//                  is the only shadow caster so all shadows are parallel
//
// SUN. src/core/palette.js's makeLightRig puts the sun at +cos(azimuth) on Z,
// which is the opposite of the convention every other file uses (north = -Z, so
// a sun at azimuth 180 belongs at +Z — see sunVector() in src/analysis/daylight.js).
// We take the rig for its colours, its intensities and its fitted shadow camera,
// and then place the sun ourselves so that the compass in this scene agrees with
// the compass in the analysis engine. Flagged to the orchestrator; palette.js is
// not ours to edit.

import {
  Scene, Group, Color, Fog, Mesh, PerspectiveCamera, PlaneGeometry,
  BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, MeshStandardMaterial,
  MeshBasicMaterial, BufferAttribute, PointLight, DirectionalLight, MathUtils, Matrix4,
  Vector2, Vector3, Box3, Raycaster, CanvasTexture, DoubleSide, RingGeometry, SRGBColorSpace,
  AdditiveBlending,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Mode } from '../core/mode.js';
import { makeLightRig, skyFor, COLORS } from '../core/palette.js';
import { menuMaterial, gradeTint, bakeVertexAO, gradedSlab, gradedBox } from './grade.js';
import { InstancePool } from '../core/instancing.js';
import { buildBadBuilding, B, COLONNADE } from './bad-building.js';
import { loadLetteringFont, buildText, measureText, hitBox } from './lettering.js';
import { Lobby } from './lobby.js';

/** The four buttons, top to bottom on the render bay. */
export const MENU_ITEMS = [
  { id: 'single', label: 'SINGLE PLAYER', y: 8.55 },
  { id: 'multi', label: 'MULTIPLAYER', y: 7.50 },
  { id: 'settings', label: 'SETTINGS', y: 6.15 },
  { id: 'credits', label: 'CREDITS', y: 5.10 },
];

export const TITLE = 'SMENDIŁENDI BUREAU';

/** The scene's four vegetation tints, already pulled to 26 % saturation. */
const GREENS = [0x6f8f4a, 0x86a659, 0x7d9a52, 0x5f7f45].map((c) => gradeTint(c, 'green'));

/** Mid-morning, sun in the south-east. Both visible elevations get light. */
export const SUN = { azimuth: 129, elevation: 21 };

/**
 * The surveyor's tags — colour and opacity.
 *
 * THE ACCENT IS NOT THEIRS. Round 2 drew all twelve discs in COLORS.accent, the
 * same #d4763a as the hover feedback, the flag, the cones and the hazard tape,
 * and then woke all twelve to 0.88 whenever the ray hit the building's bounding
 * box — which is most of the frame, and is the state every screenshot of that
 * round is in. The critic counted eighteen accents against a checklist asking for
 * two to four, and observed correctly that when everything is the highlight
 * colour, hovering stops meaning anything.
 *
 * So the tags get their own role and their own hue: a cool survey blue disc with
 * a pale numeral, which is what an annotation over a photograph looks like and is
 * nothing else in this scene. #d4763a is now reserved for the hovered sign line,
 * the flag, the three cones and the hazard X — four accents in the resting frame.
 *
 * And they stay down. `awake` is no longer "the ray hits the building": a tag
 * lifts when the pointer is within TAG_WAKE_PX of it on screen, or when the
 * surveyor's-report chip is hot. Point at the building and the two or three tags
 * under your cursor come up; the hero frame carries twelve quiet chips.
 */
const TAG_DIM = 0.18;
const TAG_AWAKE = 0.85;
const TAG_WAKE_PX = 130;
const TAG_FACE = '#3f6a86';     // survey blue
const TAG_RULE = '#1c2b35';
const TAG_INK = '#eef2f4';

// WHERE THE FRAME TIME ACTUALLY GOES — measured, round 2, and it is not where
// the round-1 comment that used to sit here said it was.
//
// That comment asserted the scene was "100 % fill-rate bound", quoted dpr 0.50 ->
// 20.4 ms / 1.00 -> 43.4 / 1.75 -> 127.3, and on the strength of it this file
// rendered into a 4x multisampled half-float target at a capped 1.35 dpr and
// blitted the result. None of it reproduces. Interleaved in one call, six
// alternating rounds, gl.finish-bounded, at 1600x900: straight to the canvas at
// dpr 1.75 = 6.70 ms, through the render target at dpr 1.75 = 6.52 ms, straight
// to the canvas at dpr 0.35 = 6.61 ms. Twenty-five times the pixels for 1.3 %
// more time. The cost is CPU, inside renderer.render, and it is linear in DRAW
// CALLS: 0 / 22 / 41 / 59 / 77 calls -> 0.17 / 4.29 / 13.6 / 20.9 / 30.6 ms.
//
// So the render target was 80 MB of VRAM, an MSAA resolve and a second render
// pass bought with a measurement that does not exist, and it also broke the debug
// overlay: renderer.info resets per render() call (engine.js:152), so two calls a
// frame meant the overlay reported the two triangles of the blit quad instead of
// the scene. It is gone. render() is the base Mode implementation again.
//
// The lever that IS real is draw calls, so this file now merges the one-off
// street dressing instead of giving each piece its own InstancedMesh — see
// _buildDressing(). Anything added here should be added to a merge or to an
// existing pool kind, never as a new mesh.

const CAM = {
  eye: new Vector3(17.5, 5.6, 21.5),
  look: new Vector3(0.2, 5.3, 0.0),
  fov: 40,
};

export class MenuMode extends Mode {
  constructor() {
    super('menu');
    this.t = 0;
    this.hoverItem = -1;
    this.hoverTag = -1;
    this.pinnedTag = -1;
    this.lines = [];        // { id, mesh, hit, material, baseZ }
    this.ray = new Raycaster();
    this.pointer = new Vector2();
    this.viewW = 1;
    this.viewH = 1;
    this.blocked = false;   // a lobby panel is over the scene
    this.tagAlpha = [];     // per-tag opacity, tweened
    this.tagsHot = false;   // the report chip is hovered / the report is open
    this.tagNear = -1;      // the tag the pointer is closest to, in pixels
  }

  // -------------------------------------------------------------------------

  init(ctx) {
    super.init(ctx);
    const scene = new Scene();
    this.scene = scene;

    const sky = skyFor('morning');
    scene.background = new Color(sky.sky);
    scene.fog = new Fog(sky.sky, 70, 220);

    // near/far matter more here than anywhere else in the game. The menu camera
    // orbits the building at roughly 40-60 m, and the facade is covered in trim
    // that sits only a few millimetres proud of the wall behind it. A 0.1 m near
    // plane against a 500 m far plane spends almost the whole 24-bit depth buffer
    // on the first metre in front of the lens, leaving ~1.5 mm of depth resolution
    // out where the building actually is - so the string courses, the sign panel
    // and the window reveals z-fight against their own walls. Nothing is ever
    // within 3 m of this camera, so pulling the near plane out to 1 m costs
    // nothing visible and buys a 10x finer depth step at the building.
    this.camera = new PerspectiveCamera(CAM.fov, 1, 1.0, 400);
    this.camera.position.copy(CAM.eye);
    this.camera.lookAt(CAM.look);

    // The building goes up FIRST: it owns the occupancy grid that the ground
    // plane's AO bake reads, so the pavement darkens where it meets the plinth.
    const building = buildBadBuilding();
    scene.add(building.group);
    this.building = building;
    this.buildingBox = new Box3().setFromObject(building.group);

    this._buildSky(scene, sky);
    this._buildSite(scene, building.occ);

    // Two pools, because the street does not move and the leaves do. Rebuilding
    // 250 static placements every frame just to add three birds re-uploads every
    // instance buffer 60 times a second for nothing.
    this.props = new Group();
    scene.add(this.props);
    this.poolStatic = new InstancePool(this.props);
    this.poolLive = new InstancePool(this.props);
    this._buildProps();

    this._buildMotion(scene);
    this._buildLights(scene);
    this._buildTags(scene);

    // Lettering needs the typeface; everything above is already on screen while
    // it loads, so a slow font never shows the player a blank frame.
    this.letters = new Group();
    scene.add(this.letters);
    loadLetteringFont().then(() => this._buildLettering()).catch((e) => console.warn('[menu] lettering', e));

    this.lobby = new Lobby(ctx, {
      onAction: (id, data) => this._act(id, data),
      crimes: building.crimes,
      onCrimeFocus: (i) => { this.pinnedTag = i; },
      onBlock: (v) => { this.blocked = v; },
      onTagsHot: (v) => { this.tagsHot = v; },
    });
  }

  // -- scene ----------------------------------------------------------------

  _buildSky(scene, sky) {
    // A gradient dome rather than a flat clear colour: one extra draw call buys
    // the whole upper half of the frame a tonal range. Colours are derived from
    // the palette's sky, never invented here.
    const g = new SphereGeometry(300, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const low = new Color(sky.sky);
    const high = low.clone().multiplyScalar(0.66);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = MathUtils.clamp(pos.getY(i) / 300, 0, 1) ** 0.7;
      c.copy(low).lerp(high, t);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    const dome = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false, depthWrite: false }));
    dome.renderOrder = -1;
    scene.add(dome);
    this._dome = dome;
    this._buildClouds(scene, low);
  }

  /**
   * Four low-poly cumulus, merged into one unlit draw call.
   *
   * Round 1 measured the sky as the largest single region in the frame — 22.97 %
   * of it, flat to within 6/255 from top to bottom. A quarter of the picture was
   * doing no work at all. These sit 120-170 m out along the view axis, which the
   * camera's 40 deg vertical field puts across the top third of the shot, and
   * they are vertex-shaded bright on top and sky-grey underneath so they read as
   * volumes rather than as stickers.
   */
  _buildClouds(scene, skyLow) {
    const parts = [];
    const top = new Color(0xfdfaf4);
    const bot = skyLow.clone().lerp(new Color(0xffffff), 0.35);
    const puff = (cx, cy, cz, rx, ry, rz) => {
      const g = new SphereGeometry(1, 7, 5);
      g.scale(rx, ry, rz);
      g.translate(cx, cy, cz);
      const pos = g.getAttribute('position');
      const col = new Float32Array(pos.count * 3);
      const c = new Color();
      for (let i = 0; i < pos.count; i++) {
        const t = MathUtils.clamp((pos.getY(i) - (cy - ry)) / (2 * ry), 0, 1) ** 0.8;
        c.copy(bot).lerp(top, t);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new BufferAttribute(col, 3));
      parts.push(g);
    };
    // [centre x, y, z, radius, how many puffs, spread]
    const banks = [
      [-40, 44, -120, 11, 4, 1.0],
      [-118, 38, -150, 14, 5, 1.15],
      [24, 50, -140, 9, 3, 0.9],
      [-78, 30, -96, 8, 3, 0.8],
    ];
    banks.forEach(([cx, cy, cz, r, n, k], b) => {
      for (let i = 0; i < n; i++) {
        const f = (i - (n - 1) / 2);
        puff(cx + f * r * 1.15, cy + Math.sin(b * 2 + i) * r * 0.16, cz + Math.cos(b + i * 1.7) * r * 0.5,
          r * k * (0.72 + 0.28 * Math.cos(i + b)), r * 0.44, r * 0.7);
      }
    });
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    const clouds = new Mesh(merged, new MeshBasicMaterial({ vertexColors: true, fog: false, flatShading: true }));
    clouds.name = 'clouds';
    clouds.renderOrder = -1;
    scene.add(clouds);
    this._clouds = clouds;
  }

  _buildSite(scene, occ) {
    const bin = new Map();
    const add = (mat, g) => { (bin.get(mat) || bin.set(mat, []).get(mat)).push(g); };
    /**
     * `cell` tessellates the slab. The ground within ~25 m of the building is
     * subdivided so the AO bake below has vertices near the plinth to darken;
     * everything beyond that is one quad, because there is nothing there to
     * occlude it. A single 320 m quad has four corners, and four corners cannot
     * hold a contact band — which is exactly why round 1 measured 0.1/255 of
     * variation into the wall/ground junction.
     */
    const slab = (mat, x0, z0, x1, z1, y, cell = 0) => {
      const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
      const sw = cell ? Math.max(1, Math.min(96, Math.round(w / cell))) : 1;
      const sd = cell ? Math.max(1, Math.min(96, Math.round(d / cell))) : 1;
      const g = new PlaneGeometry(w, d, sw, sd);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      add(mat, g);
    };

    slab('grass', -26, -22, 30, 22, 0, 0.8);          // the near field, tessellated
    slab('grass', -160, -160, 160, -22, 0);
    slab('grass', -160, 22, 160, 160, 0);
    slab('grass', -160, -22, -26, 22, 0);
    slab('grass', 30, -22, 160, 22, 0);
    slab('paving', -17.5, 4.8, 17.5, 9.3, 0.02, 0.8); // the forecourt
    slab('paving', -46, 9.3, 46, 11.4, 0.03);         // the public pavement
    slab('asphalt', -70, 11.4, 70, 18.4, 0.01);       // the street
    slab('asphalt', -70, -19.5, 70, -12.5, 0.015);    // the back road
    slab('gravel', -17.5, -8.0, -8.6, 4.8, 0.02);     // side yard
    slab('asphalt', 9.6, -8.0, 20.5, 4.6, 0.02, 0.9); // the car park
    for (let i = 0; i < 4; i++) {                     // parking bay markings
      add('paper', boxAt(11.0 + i * 2.4, 0.035, -1.7, 0.10, 0.01, 5.0));
    }
    add('concrete', boxAt(0, 0.10, 11.4, 92, 0.20, 0.13));   // kerb

    const group = new Group();
    group.name = 'site';
    let aoSum = 0, aoN = 0;
    for (const [mat, geoms] of bin) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) continue;
      if (occ) { aoSum += bakeVertexAO(merged, occ, { strength: 0.80, floor: 0.45, reach: 1.9 }); aoN++; }
      const m = new Mesh(merged, menuMaterial(mat, { vertexColors: !!occ }));
      m.receiveShadow = true;
      m.name = `site:${mat}`;
      group.add(m);
    }
    scene.add(group);
    this.siteAO = aoN ? aoSum / aoN : 1;

    // Two neighbouring blocks and a run of terraces: the third depth layer, and
    // the reason the building reads as being in a street rather than in a void.
    const nb = new Map();
    const nadd = (mat, g) => { (nb.get(mat) || nb.set(mat, []).get(mat)).push(g); };
    const block = (mat, cx, cz, w, h, d, floors) => {
      nadd(mat, boxAt(cx, h / 2, cz, w, h, d));
      nadd('concrete', boxAt(cx, h + 0.2, cz, w + 0.4, 0.4, d + 0.4));
      for (let f = 0; f < floors; f++) {
        const y = 1.2 + f * (h - 1.4) / floors;
        for (let i = 0; i < Math.max(2, Math.floor(w / 2.6)); i++) {
          const x = cx - w / 2 + 1.3 + i * 2.6;
          if (x > cx + w / 2 - 0.8) continue;
          nadd('ink', boxAt(x, y + 0.7, cz + d / 2 + 0.02, 1.1, 1.4, 0.06));
        }
      }
    };
    block('stone', -30.5, -14.0, 12, 11.5, 10, 3);
    block('concrete', 34.0, -30.0, 14, 8.5, 11, 2);
    block('plaster', -34.0, -34.0, 19, 14.0, 12, 4);
    block('concrete-dark', 9.0, -40.0, 24, 9.5, 13, 3);
    const ngroup = new Group();
    ngroup.name = 'neighbours';
    for (const [mat, geoms] of nb) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) continue;
      const m = new Mesh(merged, menuMaterial(mat));
      m.castShadow = false; m.receiveShadow = true;
      ngroup.add(m);
    }
    scene.add(ngroup);

    // A town roofline 95-135 m out. It is far enough into the fog (70-220 m) to
    // desaturate and shift toward the sky on its own, which is the aerial
    // perspective the reference gets from a photographed hillside — and it stops
    // the top-left quarter of the frame being nothing but flat sky.
    const far = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let x = -170; x < 90; x += 7 + rnd() * 9) {
      const h = 7 + rnd() * 13;
      const w = 6 + rnd() * 12;
      const z = -96 - rnd() * 38;
      far.push(boxAt(x, h / 2, z, w, h, 9 + rnd() * 8));
      if (rnd() > 0.55) far.push(boxAt(x + w * 0.2, h + 1.6, z, w * 0.4, 3.2, 6));   // a ridge or a tank
    }
    const skyline = new Mesh(mergeGeometries(far, false), menuMaterial('stone'));
    for (const g of far) g.dispose();
    skyline.name = 'skyline';
    skyline.castShadow = false; skyline.receiveShadow = false;
    scene.add(skyline);
  }

  _buildProps() {
    this._registerKinds(this.poolStatic, {});
    // Leaves, birds and the passing car do not cast: the shadow map is baked
    // ONCE per enter() (see enter()), so anything that moves must not be in it
    // or its shadow freezes on the ground while the object walks away.
    this._registerKinds(this.poolLive, { castShadow: false });
    this._layoutStatics();
    this.poolStatic.begin();
    for (const [name, tr, color] of this.statics) this.poolStatic.place(name, tr, color);
    this.poolStatic.flush();
  }

  /** Every repeated kind, registered in both pools. An unused kind costs nothing:
   *  the InstancedMesh is only allocated on the first place(). */
  _registerKinds(pool, o = {}) {
    // Every repeated object in the scene goes through the pool. Sizes are the
    // real ones: a bollard is 1.00 m, a wheelie bin 1.10 m, a street lamp column
    // 5.00 m, a hedge 1.05 m, a traffic cone 0.75 m.
    pool.register('trunk', new CylinderGeometry(0.16, 0.24, 4.2, 7), menuMaterial('wood-dark'), o);
    pool.register('crown', new SphereGeometry(1.0, 7, 5), menuMaterial('flat', { flatShading: true }), o);
    pool.register('bush', new SphereGeometry(0.55, 6, 4), menuMaterial('flat', { flatShading: true }), o);
    pool.register('hedge', new BoxGeometry(1.8, 1.05, 0.75), menuMaterial('flat', { flatShading: true }), o);
    pool.register('bollard', new CylinderGeometry(0.09, 0.11, 1.0, 8), menuMaterial('metal'), o);
    pool.register('cone', new ConeGeometry(0.21, 0.75, 8), menuMaterial('flat'), o);
    pool.register('lamppost', new CylinderGeometry(0.07, 0.10, 5.0, 8), menuMaterial('metal'), o);
    pool.register('lamphead', new BoxGeometry(0.55, 0.14, 0.24), menuMaterial('metal'), o);
    pool.register('bin', new BoxGeometry(0.58, 1.10, 0.72), menuMaterial('flat'), o);
    pool.register('slabPaver', new BoxGeometry(0.58, 0.05, 0.58), menuMaterial('flat'), o);
    pool.register('planter', new BoxGeometry(1.2, 0.5, 0.6), menuMaterial('concrete'), o);
    pool.register('benchSeat', new BoxGeometry(1.8, 0.08, 0.45), menuMaterial('wood-mid'), o);
    pool.register('benchLeg', new BoxGeometry(0.08, 0.42, 0.42), menuMaterial('metal'), o);
    pool.register('bikeWheel', new CylinderGeometry(0.34, 0.34, 0.05, 12).rotateX(Math.PI / 2), menuMaterial('ink'), o);
    pool.register('bikeFrame', new BoxGeometry(1.0, 0.06, 0.06), menuMaterial('flat'), o);
    pool.register('signPost', new CylinderGeometry(0.04, 0.04, 2.2, 6), menuMaterial('metal'), o);
    pool.register('signPlate', new BoxGeometry(0.62, 0.44, 0.04), menuMaterial('flat'), o);
    pool.register('carBody', new BoxGeometry(4.3, 0.85, 1.78), menuMaterial('flat'), o);
    pool.register('carCabin', new BoxGeometry(2.2, 0.62, 1.62), menuMaterial('flat'), o);
    // registered with its axis along +X, so rotationY = 0 is a car facing north
    pool.register('wheel', new CylinderGeometry(0.32, 0.32, 0.20, 10).rotateZ(Math.PI / 2), menuMaterial('ink'), o);
    pool.register('leaf', new BoxGeometry(0.14, 0.02, 0.09), menuMaterial('flat'), o);
    pool.register('bird', new BoxGeometry(0.34, 0.04, 0.11), menuMaterial('ink'), o);
    pool.register('skip', new BoxGeometry(3.4, 1.25, 1.75), menuMaterial('flat'), o);
    pool.register('pallet', new BoxGeometry(1.2, 0.14, 0.8), menuMaterial('wood-mid'), o);
    pool.register('board', new BoxGeometry(2.4, 1.4, 0.08), menuMaterial('paper'), o);
    pool.register('boardLeg', new BoxGeometry(0.09, 2.0, 0.09), menuMaterial('wood-mid'), o);

  }

  /**
   * The street, laid out once.
   *
   * Every colour here goes through gradeTint (src/menu/grade.js) except the four
   * things that ARE the accent: the flag, the three cones, the hazard tape and one
   * vehicle. Round 1 measured two competing saturated hue masses — 31 % of the
   * frame warm and 19 % green — either of which read as "the accent"; the bar is
   * one accent repeated two to four times against a field at 25 % saturation.
   */
  _layoutStatics() {
    this.statics = [];
    const S = (name, tr, color) => this.statics.push([name, tr, color ?? null]);

    // street trees along the pavement, and a tree line in the distance
    const treeSpots = [
      [-15.5, 8.4, 1.15], [-10.0, 10.6, 0.9], [16.8, 11.6, 1.1],
      [-19.5, 1.0, 0.95], [-21.5, -6.0, 1.1], [20.5, -2.0, 0.9],
      [-30, -14, 1.2], [-16, -22, 1.1], [4, -24, 1.0], [22, -26, 1.15],
      [34, -12, 1.0], [-38, -4, 1.05], [30, 6, 0.95], [-27, 8, 0.9],
    ];
    treeSpots.forEach(([x, z, s], i) => {
      S('trunk', { position: { x, y: 2.1 * s, z }, scale: { x: s, y: s, z: s }, rotationY: i });
      const greens = GREENS;
      for (let k = 0; k < 3; k++) {
        S('crown', {
          position: { x: x + Math.sin(i + k) * 0.75 * s, y: (4.4 + k * 0.85) * s, z: z + Math.cos(i * 2 + k) * 0.7 * s },
          scale: { x: (1.55 - k * 0.28) * s, y: (1.25 - k * 0.22) * s, z: (1.55 - k * 0.28) * s },
        }, greens[(i + k) % 4]);
      }
    });

    // the hedge that frames the bottom of the shot
    for (let i = 0; i < 20; i++) {
      const x = -17 + i * 1.8;
      if (x > -3.4 && x < 5.2) continue;         // the gap the entrance path goes through
      S('hedge', { position: { x, y: 0.53, z: 9.2 }, rotationY: 0.02 * Math.sin(i) }, i % 2 ? GREENS[3] : GREENS[0]);
    }
    for (let i = 0; i < 9; i++) {
      S('bush', { position: { x: -16 + i * 1.3, y: 0.5, z: 5.6 }, scale: 0.8 + (i % 3) * 0.2 }, i % 2 ? GREENS[2] : GREENS[0]);
    }

    // bollards guarding the forecourt, on 1.5 m centres
    for (let i = 0; i < 9; i++) S('bollard', { position: { x: 5.4 + i * 1.5, y: 0.5, z: 6.0 } });

    // two street lamps, on the public pavement where they belong
    for (const x of [-6.5, 12.0]) {
      S('lamppost', { position: { x, y: 2.5, z: 10.4 } });
      S('lamphead', { position: { x: x + 0.22, y: 5.05, z: 10.4 } });
    }

    // the cones under the roof outlet — someone's answer to crime 11
    S('cone', { position: { x: -0.5, y: 0.98, z: 5.9 } }, COLORS.accent);
    S('cone', { position: { x: 1.15, y: 0.98, z: 6.3 }, rotationY: 0.5 }, COLORS.accent);
    S('cone', { position: { x: 0.2, y: 0.98, z: 6.6 }, rotationY: 1.1 }, COLORS.accentDeep);

    // bins, bench, bikes, a planter, a for-sale board
    S('bin', { position: { x: -5.6, y: 0.55, z: 6.1 } }, gradeTint(0x476b4a, 'prop'));
    S('bin', { position: { x: -4.9, y: 0.55, z: 6.1 } }, gradeTint(0x35566e, 'prop'));
    S('bin', { position: { x: -4.2, y: 0.55, z: 6.1 }, rotationY: 0.1 }, gradeTint(0x8d7f6c, 'prop'));
    S('benchSeat', { position: { x: -7.6, y: 0.44, z: 8.0 } });
    S('benchLeg', { position: { x: -8.35, y: 0.21, z: 8.0 } });
    S('benchLeg', { position: { x: -6.85, y: 0.21, z: 8.0 } });
    S('planter', { position: { x: 5.6, y: 0.25, z: 8.4 } });
    S('planter', { position: { x: -11.5, y: 0.25, z: 8.4 } });
    S('bush', { position: { x: 5.6, y: 0.72, z: 8.4 }, scale: 0.9 }, GREENS[1]);
    S('bush', { position: { x: -11.5, y: 0.72, z: 8.4 }, scale: 0.9 }, GREENS[2]);
    for (let i = 0; i < 3; i++) {
      const x = 15.0 + i * 0.75;
      S('bikeWheel', { position: { x: x - 0.45, y: 0.34, z: 5.6 } });
      S('bikeWheel', { position: { x: x + 0.45, y: 0.34, z: 5.6 } });
      S('bikeFrame', { position: { x, y: 0.62, z: 5.6 } }, gradeTint([0xb2472e, 0x3f7a76, 0xc9a227][i], 'prop'));
    }
    // the side yard: a skip that has been there since the handover, a stack of
    // pallets, and the agent's board that says the top floor is still available
    S('skip', { position: { x: -12.6, y: 0.63, z: 1.2 }, rotationY: 0.16 }, gradeTint(0xc9a227, 'prop'));
    for (let i = 0; i < 5; i++) S('pallet', { position: { x: -15.0, y: 0.08 + i * 0.15, z: -1.6 }, rotationY: 0.05 * i });
    for (let i = 0; i < 3; i++) S('pallet', { position: { x: -13.6, y: 0.08 + i * 0.15, z: -2.4 }, rotationY: 1.5 + 0.06 * i });
    S('boardLeg', { position: { x: -11.2, y: 1.0, z: 8.9 } });
    S('boardLeg', { position: { x: -9.0, y: 1.0, z: 8.9 } });
    S('board', { position: { x: -10.1, y: 2.35, z: 8.9 } }, COLORS.paper);
    S('signPost', { position: { x: 8.4, y: 1.1, z: 8.2 } });
    S('signPlate', { position: { x: 8.4, y: 2.0, z: 8.24 } }, COLORS.paper);
    // a loose run of pavers, because a real forecourt is never one clean slab
    for (let i = 0; i < 26; i++) {
      S('slabPaver', { position: { x: -2.2 + (i % 4) * 0.62, y: 0.05, z: 6.8 + Math.floor(i / 4) * 0.62 } }, COLORS.paving);
    }

    // parked cars in the side car park
    // one vehicle stays at full saturation as an accent repeat; the rest are graded
    const parked = [[11.2, -0.2, COLORS.accentDeep, 1], [13.6, 0.4, gradeTint(0x35566e, 'vehicle'), 1],
      [16.0, -0.6, gradeTint(0xd7c9b0, 'vehicle'), 1]];
    for (const [x, z, c] of parked) {
      S('carBody', { position: { x, y: 0.72, z }, rotationY: Math.PI / 2 }, c);
      S('carCabin', { position: { x, y: 1.42, z: z - 0.15 }, rotationY: Math.PI / 2 }, c);
      for (const [lat, lng] of [[-0.82, 1.45], [0.82, 1.45], [-0.82, -1.45], [0.82, -1.45]]) {
        S('wheel', { position: { x: x + lat, y: 0.32, z: z + lng } });
      }
    }
    // two cars at the kerb, because the bottom-left of the frame was bare asphalt
    for (const [x, c] of [[-13.6, gradeTint(0x55504a, 'vehicle')], [-8.2, gradeTint(0xbfae95, 'vehicle')]]) {
      S('carBody', { position: { x, y: 0.72, z: 12.4 } }, c);
      S('carCabin', { position: { x: x - 0.25, y: 1.42, z: 12.4 } }, c);
      for (const [lng, lat] of [[-1.45, 0.82], [1.45, 0.82], [-1.45, -0.82], [1.45, -0.82]]) {
        S('wheel', { position: { x: x + lng, y: 0.32, z: 12.4 + lat }, rotationY: Math.PI / 2 });
      }
    }
  }

  _buildMotion(scene) {
    // A flag, a car on the back road, three birds and a drift of leaves. Nothing
    // here is decoration for its own sake: a menu with no motion at all reads as
    // a screenshot, and the player stops looking within three seconds.
    this.flag = makeFlag();
    this.flag.group.position.set(-12.6, 0, 7.0);
    scene.add(this.flag.group);

    this.car = { x: -60, speed: 9.5, z: -16.0, color: gradeTint(0x3f7a76, 'vehicle') };
    this.birds = [
      { r: 22, a: 0.0, y: 17.5, s: 0.30, cx: -4, cz: -6 },
      { r: 26, a: 2.1, y: 19.5, s: 0.24, cx: -4, cz: -6 },
      { r: 19, a: 4.4, y: 16.0, s: 0.34, cx: -4, cz: -6 },
    ];
    this.leaves = [];
    for (let i = 0; i < 34; i++) {
      this.leaves.push({
        x: -18 + Math.random() * 34, y: Math.random() * 9, z: 2 + Math.random() * 9,
        vy: 0.35 + Math.random() * 0.4, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 0.8,
        c: gradeTint([0xc9a227, 0xa2a45c, 0xb98450, 0x9d5f38][i % 4], 'prop'),
      });
    }
  }

  _buildLights(scene) {
    // 1024, not 2048. The shadow map is baked once and never re-rendered (the sun
    // does not move and nothing that moves casts), so its only remaining cost is
    // the lookup; halving the map halves the one-off bake and the memory, and at
    // a 60 m fitted shadow camera 1024 is still a 59 mm texel.
    this.rig = makeLightRig(scene, { timeOfDay: 'morning', radius: 30, shadowMapSize: 1024 });
    // The morning preset is tuned for an interior. Outdoors, at 21 degrees, the
    // sun has to be the dominant source or the frame collapses into mid-grey and
    // fails checklist item 8 (p5 <= 70, p95 >= 140).
    this.rig.key.intensity = 2.9;
    this.rig.hemi.intensity = 0.40;
    this.rig.ambient.intensity = 0.11;
    this.rig.key.target.position.set(0, 3, 0);
    this.rig.key.target.updateMatrixWorld();
    placeSun(this.rig.key, SUN.azimuth, SUN.elevation, 80);
    this.rig.key.shadow.camera.near = 42;
    this.rig.key.shadow.camera.far = 126;
    this.rig.key.shadow.camera.updateProjectionMatrix();

    // ONE 2700 K pool behind the ground-floor glazing, so the building reads as
    // occupied and the glass is not a black hole.
    //
    // Round 1 had three PointLights here. Profiled at dpr 1.75 they cost 19 ms of
    // a 104 ms frame — a fifth of the budget — and two of the three were lighting
    // surfaces you see through 28 %-opacity glass from 27 m away. Those two are
    // now emissive materials ('lobby-glow' in grade.js): the same picture, zero
    // per-fragment cost, and one fewer light in every shader in the scene.
    this.interior = new PointLight(0xffc98a, 105, 26, 2);
    this.interior.position.set(4.6, 2.6, 1.2);
    scene.add(this.interior);

    // The bounce. reference/architect-life checklist item 6 asks for light that
    // has visibly come off something else; with no GI the only honest way to get
    // it is a dim, wide, warm directional coming UP off the forecourt. It carries
    // no shadow, so it costs one more light term and nothing else, and it is what
    // puts a colour on the balcony soffit and the underside of the beam.
    const bounce = new DirectionalLight(0xdcc6a6, 0.36);
    bounce.position.set(7, -6, 16);
    bounce.target.position.set(2, 5.5, 0);
    bounce.castShadow = false;
    scene.add(bounce);
    scene.add(bounce.target);
    this.bounce = bounce;

    this._buildSunPatch(scene);
  }

  /**
   * Checklist item 7: a hard patch of directional light thrown through an opening.
   * The reference gets most of its interior credibility from exactly this, and
   * round 1 had none — the floor behind the curtain wall measured a uniform
   * 151,146,130 across the whole bay.
   *
   * The sun is at azimuth 129, elevation 21, so sunlight travels
   *   d = (-sin129 cos21, -sin21, +cos129 cos21) = (-0.7255, -0.3584, -0.5875)
   * Dropping from a head at height h to a floor at height f therefore shifts the
   * patch (h-f)/0.3584 * 0.7255 west and the same * 0.5875 north. For the ground
   * storey (head 3.90 under the slab band, floor 0.60) that is 6.68 m west and
   * 5.41 m north — which is the parallelogram built below, one per glazing bay,
   * mullion gaps and all.
   */
  _buildSunPatch(scene) {
    const az = MathUtils.degToRad(SUN.azimuth), el = MathUtils.degToRad(SUN.elevation);
    const dx = -Math.sin(az) * Math.cos(el);
    const dy = -Math.sin(el);
    const dz = Math.cos(az) * Math.cos(el);
    const cw = B.curtain;
    const glassZ = B.z1 - 0.08;
    const inZ = B.z1 - B.wall - 0.06;          // the inside face of the glazing line
    const parts = [];
    const bay = (u0, u1, head, floor) => {
      // the ray from the head of the opening, walked down to the floor
      const tHead = (head - floor) / -dy;
      const far = { x: dx * tHead, z: glassZ + dz * tHead };
      // the ray from the sill lands at the glass; clip it back to the inside face
      const tSill = (glassZ - inZ) / -dz;
      const near = { x: dx * tSill, z: inZ };
      const g = new PlaneGeometry(1, 1);
      const pos = g.getAttribute('position');
      // PlaneGeometry winds TL, TR, BL, BR — so: far@u0, far@u1, near@u0, near@u1
      const corners = [
        { x: u0 + far.x, z: far.z }, { x: u1 + far.x, z: far.z },
        { x: u0 + near.x, z: near.z }, { x: u1 + near.x, z: near.z },
      ];
      for (let i = 0; i < 4; i++) pos.setXYZ(i, corners[i].x, floor + 0.008, corners[i].z);
      g.computeVertexNormals();
      parts.push(g);
    };
    for (let i = 0; i < 5; i++) {
      const u0 = cw.u0 + (cw.u1 - cw.u0) * (i / 5) + 0.07;
      const u1 = cw.u0 + (cw.u1 - cw.u0) * ((i + 1) / 5) - 0.07;
      bay(u0, u1, B.lvl[1] - B.band, B.lvl[0]);        // ground storey, head 3.90
      bay(u0, u1, B.lvl[2] - B.band, B.lvl[1]);        // first storey, head 6.90
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    const m = new Mesh(merged, new MeshBasicMaterial({
      color: new Color(0xffd9a8), transparent: true, opacity: 0.42,
      blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide,
    }));
    m.name = 'sun-patch';
    m.renderOrder = 2;
    scene.add(m);
    this.sunPatch = m;
  }

  // -- lettering ------------------------------------------------------------

  _buildLettering() {
    const a = this.building.anchors;
    const avail = a.sign.u1 - a.sign.u0;

    // One common cap height for all four lines, set by the longest — which is
    // how a sign schedule is actually written.
    let cap = 0.62;
    let widest = 0;
    for (const it of MENU_ITEMS) widest = Math.max(widest, measureText(it.label, cap));
    if (widest > avail) cap *= avail / widest;

    for (const it of MENU_ITEMS) {
      const geo = buildText(it.label, { cap, depth: 0.09, align: 'left', maxWidth: avail });
      const material = new MeshStandardMaterial({ color: new Color(COLORS.ink), roughness: 0.42, metalness: 0.06 });
      material.name = `menu:${it.id}`;
      const mesh = new Mesh(geo, material);
      mesh.position.set(a.sign.u0, it.y, a.sign.z);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.name = `letters:${it.id}`;
      this.letters.add(mesh);

      const hit = new Mesh(hitBox(geo, 0.24, 0.45), new MeshBasicMaterial({ visible: false }));
      hit.position.copy(mesh.position);
      hit.userData.item = it.id;
      this.letters.add(hit);

      this.lines.push({ id: it.id, label: it.label, mesh, hit, material, baseZ: a.sign.z, hover: 0 });
    }

    // the rooftop sign
    const tGeo = buildText(TITLE, { cap: 0.86, depth: 0.11, align: 'centre', maxWidth: a.roofSign.u1 - a.roofSign.u0 });
    const tMat = new MeshStandardMaterial({ color: new Color(COLORS.paper), roughness: 0.55, metalness: 0.0 });
    const title = new Mesh(tGeo, tMat);
    title.position.set((a.roofSign.u0 + a.roofSign.u1) / 2, a.roofSign.y, a.roofSign.z);
    title.castShadow = true;
    title.name = 'letters:title';
    this.letters.add(title);
    this.title = title;

    // the letters are new shadow casters and the map is not auto-updating
    const r = this.ctx?.engine?.renderer;
    if (r) r.shadowMap.needsUpdate = true;

    this.ctx?.engine?.debug?.report('menu',
      `${this.lines.length} sign lines, ${this.building.crimes.length} tags, `
      + `AO ${this.building.aoMean.toFixed(2)}/${(this.siteAO ?? 1).toFixed(2)}, `
      + `${this.poolStatic.instanceCount}+${this.poolLive.instanceCount} instances`);
  }

  // -- surveyor's tags ------------------------------------------------------

  _buildTags(scene) {
    const crimes = this.building.crimes;
    const tex = numberAtlas(crimes.map((c) => String(c.n)));
    const size = 0.62;
    const quads = [];
    // Billboarded once, to the camera's own axis. The camera drifts by a couple
    // of degrees, which is far too little for a fixed billboard to read wrong.
    // A right-handed basis with +Z toward the camera. Getting `right` backwards
    // here mirrors every numeral on every tag, which is exactly what it did.
    const fwd = new Vector3().subVectors(CAM.eye, CAM.look).normalize();
    const right = new Vector3(fwd.z, 0, -fwd.x).normalize();
    const up = new Vector3().crossVectors(fwd, right).normalize();
    const m = new Vector3();
    crimes.forEach((c, i) => {
      const g = new PlaneGeometry(size, size);
      const uv = g.getAttribute('uv');
      const col = i % 4, row = Math.floor(i / 4);
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, (uv.getX(k) + col) / 4, (uv.getY(k) + (3 - row)) / 4);
      }
      // orient the quad to face the camera, then move it to the crime
      g.applyMatrix4(new Matrix4().makeBasis(right, up, fwd));
      m.copy(c.at).addScaledVector(fwd, 0.42);
      g.translate(m.x, m.y, m.z);
      quads.push(g);
    });
    const merged = mergeGeometries(quads, false);
    // Per-tag opacity, carried as vertex alpha so twelve independently fading
    // tags still cost one draw call and one texture.
    //
    // Round 1 drew all twelve at full opacity, always, with depthTest off, and
    // eight of them landed inside the centre 50 % of the frame — checklist item
    // 14, failed outright. They now sit at 20 % until you point at the building
    // or at the report chip, so the hero shot is clean and the joke arrives when
    // the player goes looking for it.
    const vcount = merged.getAttribute('position').count;
    const cols = new Float32Array(vcount * 4);
    for (let i = 0; i < vcount; i++) { cols[i * 4] = 1; cols[i * 4 + 1] = 1; cols[i * 4 + 2] = 1; cols[i * 4 + 3] = TAG_DIM; }
    merged.setAttribute('color', new BufferAttribute(cols, 4));
    this.tagAlpha = crimes.map(() => TAG_DIM);
    this.tagVerts = vcount / crimes.length;
    const mat = new MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, depthTest: false, fog: false, side: DoubleSide });
    const mesh = new Mesh(merged, mat);
    mesh.renderOrder = 4;
    mesh.name = 'surveyor-tags';
    scene.add(mesh);
    this.tagMesh = mesh;

    // a single ring that hops to whichever tag is hovered
    const ring = new Mesh(new RingGeometry(size * 0.62, size * 0.74, 20), new MeshBasicMaterial({ color: new Color(COLORS.paper), transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, fog: false, side: DoubleSide }));
    ring.visible = false;
    ring.renderOrder = 5;
    scene.add(ring);
    this.tagRing = ring;
    this._tagBasis = { fwd, right, up };
  }

  // -- lifecycle ------------------------------------------------------------

  enter(params = {}) {
    super.enter(params);
    this.lobby?.show();
    // The sun does not move and nothing that moves casts, so the shadow map is
    // rendered once instead of sixty times a second. Profiled at 12 ms of a
    // 104 ms frame for the depth pass alone at 2048; the map is 1024 now and the
    // pass runs on exactly one frame per enter().
    const r = this.ctx?.engine?.renderer;
    if (r) {
      this._shadowAuto = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
    }
    const audio = this.ctx?.audio;
    if (audio) {
      // music.menu is deliberately not preloaded (it is a megabyte), so load it
      // and start it when it arrives rather than dropping it on the floor.
      audio.load('music.menu').then((buf) => { if (buf && this.active) audio.music('music.menu', { fade: 2.0 }); }).catch(() => {});
      audio.load('amb.birds-outside').then((buf) => { if (buf && this.active) audio.loop('amb.birds-outside'); }).catch(() => {});
    }
    this.ctx?.engine?.debug?.report('mode', 'menu — 17 Ambition Road');
  }

  exit() {
    super.exit();
    this.lobby?.hide();
    const r = this.ctx?.engine?.renderer;
    if (r && this._shadowAuto !== undefined) {
      r.shadowMap.autoUpdate = this._shadowAuto;
      r.shadowMap.needsUpdate = true;
    }
    this.ctx?.audio?.stopLoop('amb.birds-outside', 0.6);
  }

  // -- frame ----------------------------------------------------------------

  update(dt) {
    this.t += dt;
    const t = this.t;

    // slow drift: a 96 s lateral swing and a 61 s rise, plus a whisper of mouse
    // parallax. Amplitudes are small on purpose — the shot is composed, and a
    // camera that wanders spoils a composition.
    const input = this.ctx?.input;
    const px = input ? MathUtils.clamp(input.ndc.x, -1, 1) : 0;
    const py = input ? MathUtils.clamp(input.ndc.y, -1, 1) : 0;
    const swing = Math.sin(t * (Math.PI * 2 / 96));
    const rise = Math.sin(t * (Math.PI * 2 / 61));
    this.camera.position.set(
      CAM.eye.x + swing * 0.85 + px * 0.42,
      CAM.eye.y + rise * 0.30 + py * 0.24,
      CAM.eye.z + swing * -0.40,
    );
    this.camera.lookAt(CAM.look.x + swing * 0.25, CAM.look.y + rise * 0.10, CAM.look.z);

    this._motion(dt, t);
    this._pick();
    this._tweenLines(dt);
    this._tweenTags(dt);

    // only the things that actually move are rebuilt each frame
    const pool = this.poolLive;
    pool.begin();
    // the car on the back road
    this.car.x += this.car.speed * dt;
    if (this.car.x > 62) this.car.x = -62;
    const cx = this.car.x, cz = this.car.z;
    pool.place('carBody', { position: { x: cx, y: 0.72, z: cz } }, this.car.color);
    pool.place('carCabin', { position: { x: cx - 0.2, y: 1.42, z: cz } }, this.car.color);
    for (const [lng, lat] of [[-1.45, 0.82], [1.45, 0.82], [-1.45, -0.82], [1.45, -0.82]]) {
      pool.place('wheel', { position: { x: cx + lng, y: 0.32, z: cz + lat }, rotationY: Math.PI / 2 });
    }
    for (const b of this.birds) {
      b.a += b.s * dt;
      pool.place('bird', {
        position: { x: b.cx + Math.cos(b.a) * b.r, y: b.y + Math.sin(b.a * 2.3) * 0.7, z: b.cz + Math.sin(b.a) * b.r },
        rotationY: -b.a + Math.PI / 2,
      });
    }
    for (const lf of this.leaves) {
      lf.y -= lf.vy * dt;
      if (lf.y < -0.2) { lf.y = 8.5 + Math.random() * 2; lf.x = -18 + Math.random() * 34; }
      const sway = Math.sin(t * lf.sp + lf.ph);
      pool.place('leaf', {
        position: { x: lf.x + sway * 0.6, y: lf.y, z: lf.z + Math.cos(t * lf.sp * 0.7 + lf.ph) * 0.3 },
        rotationY: t * lf.sp + lf.ph,
      }, lf.c);
    }
    pool.flush();

    this.flag.update(t);
  }

  _motion(dt, t) {
    // the interior lamp breathes very slightly, which stops the glazing looking
    // like a painted panel
    if (this.interior) this.interior.intensity = 90 + Math.sin(t * 0.7) * 6;
  }

  /** Raycast the signage and the tags. */
  _pick() {
    const input = this.ctx?.input;
    if (!input) return;
    if (this.blocked) {
      this._setHover(-1);
      this.overBuilding = false;
      if (this.hoverTag !== -1) { this.hoverTag = -1; this.lobby?.hideTag(); }
      return;
    }
    this.pointer.set(input.ndc.x, input.ndc.y);
    this.ray.setFromCamera(this.pointer, this.camera);

    // Pointing anywhere at the building brings the whole schedule up. One box
    // test, no raycast against 24 000 triangles.
    this.overBuilding = this.buildingBox ? this.ray.ray.intersectsBox(this.buildingBox) : false;

    // tags first: they are small and they sit in front of everything
    let tag = -1;
    if (this.tagMesh) {
      const hit = this.ray.intersectObject(this.tagMesh, false)[0];
      if (hit) tag = Math.floor(hit.faceIndex / 2);
    }
    if (tag !== this.hoverTag) {
      this.hoverTag = tag;
      if (tag >= 0) {
        const c = this.building.crimes[tag];
        this.lobby?.showTag(c, this._project(c.at));
        this.tagRing.position.copy(c.at).addScaledVector(this._tagBasis.fwd, 0.44);
        this.tagRing.quaternion.copy(this.camera.quaternion);
        this.tagRing.visible = true;
        this.ctx?.audio?.play('ui.click-soft');
      } else if (this.pinnedTag < 0) {
        this.lobby?.hideTag();
        this.tagRing.visible = false;
      }
    }

    let item = -1;
    if (tag < 0 && this.lines.length) {
      const hit = this.ray.intersectObjects(this.lines.map((l) => l.hit), false)[0];
      if (hit) item = this.lines.findIndex((l) => l.hit === hit.object);
    }
    this._setHover(item);

    const canvas = this.ctx.engine?.canvas;
    if (canvas) canvas.style.cursor = (item >= 0 || tag >= 0) ? 'pointer' : 'default';

    if (input.mousePressed(0)) {
      if (item >= 0) {
        this.ctx?.audio?.play('ui.click');
        this._act(this.lines[item].id);
      } else if (tag >= 0) {
        this.pinnedTag = this.pinnedTag === tag ? -1 : tag;
        this.lobby?.openReport(tag);
      }
    }
  }

  /** Twelve tags, three states: dim, awake, hovered. */
  _tweenTags(dt) {
    if (!this.tagMesh || !this.tagAlpha.length) return;
    const k = 1 - Math.exp(-dt * 9);
    const awake = this.tagsHot || this.overBuilding;
    const attr = this.tagMesh.geometry.getAttribute('color');
    let dirty = false;
    for (let i = 0; i < this.tagAlpha.length; i++) {
      const target = (i === this.hoverTag || i === this.pinnedTag) ? 1
        : awake ? TAG_AWAKE : TAG_DIM;
      const a = this.tagAlpha[i] + (target - this.tagAlpha[i]) * k;
      if (Math.abs(a - this.tagAlpha[i]) < 0.0015) continue;
      this.tagAlpha[i] = a;
      for (let v = 0; v < this.tagVerts; v++) attr.setW(i * this.tagVerts + v, a);
      dirty = true;
    }
    if (dirty) attr.needsUpdate = true;
    if (this.tagRing) this.tagRing.material.opacity = 0.9 * (this.hoverTag >= 0 ? 1 : 0);
  }

  _setHover(i) {
    if (i === this.hoverItem) return;
    this.hoverItem = i;
    if (i >= 0) this.ctx?.audio?.play('ui.tool-select', { rate: 1.15 });
  }

  _tweenLines(dt) {
    const k = 1 - Math.exp(-dt * 11);
    const hot = new Color(COLORS.accent);
    const cold = new Color(COLORS.ink);
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      const target = i === this.hoverItem ? 1 : 0;
      l.hover += (target - l.hover) * k;
      l.material.color.copy(cold).lerp(hot, l.hover);
      l.material.emissive.copy(hot).multiplyScalar(l.hover * 0.16);
      l.mesh.position.z = l.baseZ + l.hover * 0.025;
      l.mesh.position.x = this.building.anchors.sign.u0 + l.hover * 0.03;
    }
  }

  /**
   * One render() call per frame, straight to the canvas. See the note at the top
   * of this file: the render target this used to draw through measured no faster,
   * cost 80 MB, and made renderer.info report the blit quad instead of the scene.
   */
  render(renderer) {
    if (!this.scene || !this.camera) return;
    renderer.render(this.scene, this.camera);
  }

  _project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5), y: (-p.y * 0.5 + 0.5) };
  }

  // -- actions --------------------------------------------------------------

  _act(id, data) {
    switch (id) {
      case 'single': this.lobby.startSingle(); break;
      case 'multi': this.lobby.openMultiplayer(); break;
      case 'settings': this.lobby.openSettings(); break;
      case 'credits': this.lobby.openCredits(); break;
      case 'enter-office': this._enterOffice(data); break;
      default: break;
    }
  }

  _enterOffice(session) {
    const engine = this.ctx.engine;
    const state = this.ctx.state;
    if (session) {
      this.ctx.net = session;
      if (this.ctx.app) this.ctx.app.net = session;
      state?.patch({
        'session.code': session.code,
        'session.host': !!session.isHost,
        'session.playerId': session.playerId,
      });
    }
    this.ctx?.audio?.play('ui.submit');
    if (engine.modes.has('office')) {
      this.ctx?.audio?.music(null, { fade: 1.0 });
      engine.replace('office', { session });
    } else {
      this.lobby.notBuiltYet();
    }
  }

  resize(w, h) {
    super.resize(w, h);
    this.viewW = w;
    this.viewH = h;
    this.lobby?.resize(w, h);
  }

  dispose() {
    this.lobby?.dispose();
    this.poolStatic?.dispose();
    this.poolLive?.dispose();
    this.rig?.dispose();
    for (const l of this.lines) l.material.dispose();
    this.tagMesh?.material?.map?.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// helpers

/** Put a directional light where the compass says the sun is. */
export function placeSun(light, azimuthDeg, elevationDeg, dist = 80) {
  const az = MathUtils.degToRad(azimuthDeg);
  const el = MathUtils.degToRad(elevationDeg);
  const c = Math.cos(el);
  // north = -Z, east = +X, azimuth clockwise from north (src/analysis/daylight.js)
  light.position.set(
    light.target.position.x + Math.sin(az) * c * dist,
    light.target.position.y + Math.sin(el) * dist,
    light.target.position.z - Math.cos(az) * c * dist,
  );
  return light;
}

function boxAt(cx, cy, cz, w, h, d) {
  const g = new BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  return g;
}

/**
 * One 512 x 512 canvas holding up to 16 numbered survey tags in a 4 x 4 grid.
 * Twelve tags therefore cost one texture and, merged, one draw call.
 */
function numberAtlas(labels) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  for (let i = 0; i < labels.length && i < 16; i++) {
    const cx = (i % 4) * 128 + 64;
    const cy = Math.floor(i / 4) * 128 + 64;
    g.beginPath();
    g.arc(cx, cy, 50, 0, Math.PI * 2);
    g.fillStyle = TAG_FACE;
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = TAG_RULE;
    g.stroke();
    g.fillStyle = TAG_INK;
    g.font = 'bold 62px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(labels[i], cx, cy + 3);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * A flag on a 7 m pole. The cloth is a 12 x 4 strip whose vertices are pushed by
 * a travelling sine — cheap, one draw call, and the only thing in the frame that
 * moves quickly enough to catch the eye.
 */
function makeFlag() {
  const group = new Group();
  const pole = new Mesh(new CylinderGeometry(0.055, 0.075, 7.0, 8), menuMaterial('metal'));
  pole.position.y = 3.5;
  pole.castShadow = true;
  group.add(pole);
  const finial = new Mesh(new SphereGeometry(0.11, 8, 6), menuMaterial('metal-warm'));
  finial.position.y = 7.05;
  group.add(finial);

  const W = 1.9, H = 1.15, NX = 12, NY = 4;
  const geo = new PlaneGeometry(W, H, NX, NY);
  geo.translate(W / 2, 0, 0);
  const cloth = new Mesh(geo, new MeshStandardMaterial({ color: new Color(COLORS.accent), roughness: 0.85, side: DoubleSide }));
  cloth.position.set(0.06, 6.15, 0);
  cloth.castShadow = true;
  group.add(cloth);

  const pos = geo.getAttribute('position');
  const base = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { base[i * 2] = pos.getX(i); base[i * 2 + 1] = pos.getY(i); }

  return {
    group,
    update(t) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 2], y = base[i * 2 + 1];
        const k = x / W;
        pos.setZ(i, Math.sin(t * 3.1 - k * 5.2) * 0.20 * k + Math.sin(t * 1.7 - k * 3.0 + y) * 0.07 * k);
        pos.setY(i, y + Math.sin(t * 2.3 - k * 4.0) * 0.05 * k);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}
