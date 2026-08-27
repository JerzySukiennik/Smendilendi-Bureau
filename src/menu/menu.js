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
  Scene, Group, Color, Fog, Mesh, PerspectiveCamera, PlaneGeometry, BoxGeometry,
  CylinderGeometry, SphereGeometry, ConeGeometry, MeshStandardMaterial,
  MeshBasicMaterial, BufferAttribute, PointLight, MathUtils, Matrix4,
  Vector2, Vector3, Raycaster, CanvasTexture, DoubleSide, RingGeometry, SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Mode } from '../core/mode.js';
import { materialFor, makeLightRig, skyFor, COLORS } from '../core/palette.js';
import { InstancePool } from '../core/instancing.js';
import { buildBadBuilding, B } from './bad-building.js';
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

/** Mid-morning, sun in the south-east. Both visible elevations get light. */
export const SUN = { azimuth: 129, elevation: 21 };

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
    this.blocked = false;   // a lobby panel is over the scene
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

    this._buildSky(scene, sky);
    this._buildSite(scene);

    const building = buildBadBuilding();
    scene.add(building.group);
    this.building = building;

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
  }

  _buildSite(scene) {
    const bin = new Map();
    const add = (mat, g) => { (bin.get(mat) || bin.set(mat, []).get(mat)).push(g); };
    const slab = (mat, x0, z0, x1, z1, y) => {
      const g = new PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0));
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      add(mat, g);
    };

    slab('grass', -160, -160, 160, 160, 0);
    slab('paving', -17.5, 4.8, 17.5, 9.3, 0.02);      // the forecourt
    slab('paving', -46, 9.3, 46, 11.4, 0.03);         // the public pavement
    slab('asphalt', -70, 11.4, 70, 18.4, 0.01);       // the street
    slab('asphalt', -70, -19.5, 70, -12.5, 0.015);    // the back road
    slab('gravel', -17.5, -8.0, -8.6, 4.8, 0.02);     // side yard
    slab('asphalt', 9.6, -8.0, 20.5, 4.6, 0.02);      // the car park
    for (let i = 0; i < 4; i++) {                     // parking bay markings
      add('paper', boxAt(11.0 + i * 2.4, 0.035, -1.7, 0.10, 0.01, 5.0));
    }
    add('concrete', boxAt(0, 0.10, 11.4, 92, 0.20, 0.13));   // kerb

    const group = new Group();
    group.name = 'site';
    for (const [mat, geoms] of bin) {
      const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
      if (!merged) continue;
      const m = new Mesh(merged, materialFor(mat));
      m.receiveShadow = true;
      m.name = `site:${mat}`;
      group.add(m);
    }
    scene.add(group);

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
      const m = new Mesh(merged, materialFor(mat));
      m.castShadow = false; m.receiveShadow = true;
      ngroup.add(m);
    }
    scene.add(ngroup);
  }

  _buildProps() {
    this._registerKinds(this.poolStatic);
    this._registerKinds(this.poolLive);
    this._layoutStatics();
    this.poolStatic.begin();
    for (const [name, tr, color] of this.statics) this.poolStatic.place(name, tr, color);
    this.poolStatic.flush();
  }

  /** Every repeated kind, registered in both pools. An unused kind costs nothing:
   *  the InstancedMesh is only allocated on the first place(). */
  _registerKinds(pool) {
    // Every repeated object in the scene goes through the pool. Sizes are the
    // real ones: a bollard is 1.00 m, a wheelie bin 1.10 m, a street lamp column
    // 5.00 m, a hedge 1.05 m, a traffic cone 0.75 m.
    pool.register('trunk', new CylinderGeometry(0.16, 0.24, 4.2, 7), materialFor('wood-dark'));
    pool.register('crown', new SphereGeometry(1.0, 7, 5), materialFor('flat', { flatShading: true }));
    pool.register('bush', new SphereGeometry(0.55, 6, 4), materialFor('flat', { flatShading: true }));
    pool.register('hedge', new BoxGeometry(1.8, 1.05, 0.75), materialFor('flat', { flatShading: true }));
    pool.register('bollard', new CylinderGeometry(0.09, 0.11, 1.0, 8), materialFor('metal'));
    pool.register('cone', new ConeGeometry(0.21, 0.75, 8), materialFor('flat'));
    pool.register('lamppost', new CylinderGeometry(0.07, 0.10, 5.0, 8), materialFor('metal'));
    pool.register('lamphead', new BoxGeometry(0.55, 0.14, 0.24), materialFor('metal'));
    pool.register('bin', new BoxGeometry(0.58, 1.10, 0.72), materialFor('flat'));
    pool.register('slabPaver', new BoxGeometry(0.58, 0.05, 0.58), materialFor('flat'));
    pool.register('planter', new BoxGeometry(1.2, 0.5, 0.6), materialFor('concrete'));
    pool.register('benchSeat', new BoxGeometry(1.8, 0.08, 0.45), materialFor('wood-mid'));
    pool.register('benchLeg', new BoxGeometry(0.08, 0.42, 0.42), materialFor('metal'));
    pool.register('bikeWheel', new CylinderGeometry(0.34, 0.34, 0.05, 12).rotateX(Math.PI / 2), materialFor('ink'));
    pool.register('bikeFrame', new BoxGeometry(1.0, 0.06, 0.06), materialFor('flat'));
    pool.register('signPost', new CylinderGeometry(0.04, 0.04, 2.2, 6), materialFor('metal'));
    pool.register('signPlate', new BoxGeometry(0.62, 0.44, 0.04), materialFor('flat'));
    pool.register('carBody', new BoxGeometry(4.3, 0.85, 1.78), materialFor('flat'));
    pool.register('carCabin', new BoxGeometry(2.2, 0.62, 1.62), materialFor('flat'));
    // registered with its axis along +X, so rotationY = 0 is a car facing north
    pool.register('wheel', new CylinderGeometry(0.32, 0.32, 0.20, 10).rotateZ(Math.PI / 2), materialFor('ink'));
    pool.register('leaf', new BoxGeometry(0.14, 0.02, 0.09), materialFor('flat'));
    pool.register('bird', new BoxGeometry(0.34, 0.04, 0.11), materialFor('ink'));
    pool.register('skip', new BoxGeometry(3.4, 1.25, 1.75), materialFor('flat'));
    pool.register('pallet', new BoxGeometry(1.2, 0.14, 0.8), materialFor('wood-mid'));
    pool.register('board', new BoxGeometry(2.4, 1.4, 0.08), materialFor('paper'));
    pool.register('boardLeg', new BoxGeometry(0.09, 2.0, 0.09), materialFor('wood-mid'));

  }

  /** The street, laid out once. */
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
      const greens = [0x6f8f4a, 0x86a659, 0x7d9a52, 0x5f7f45];
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
      S('hedge', { position: { x, y: 0.53, z: 9.2 }, rotationY: 0.02 * Math.sin(i) }, i % 2 ? 0x5f7f45 : 0x6f8f4a);
    }
    for (let i = 0; i < 9; i++) {
      S('bush', { position: { x: -16 + i * 1.3, y: 0.5, z: 5.6 }, scale: 0.8 + (i % 3) * 0.2 }, i % 2 ? 0x7f9a52 : 0x6f8f4a);
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
    S('bin', { position: { x: -5.6, y: 0.55, z: 6.1 } }, 0x476b4a);
    S('bin', { position: { x: -4.9, y: 0.55, z: 6.1 } }, 0x35566e);
    S('bin', { position: { x: -4.2, y: 0.55, z: 6.1 }, rotationY: 0.1 }, 0x8d7f6c);
    S('benchSeat', { position: { x: -7.6, y: 0.44, z: 8.0 } });
    S('benchLeg', { position: { x: -8.35, y: 0.21, z: 8.0 } });
    S('benchLeg', { position: { x: -6.85, y: 0.21, z: 8.0 } });
    S('planter', { position: { x: 5.6, y: 0.25, z: 8.4 } });
    S('planter', { position: { x: -11.5, y: 0.25, z: 8.4 } });
    S('bush', { position: { x: 5.6, y: 0.72, z: 8.4 }, scale: 0.9 }, 0x86a659);
    S('bush', { position: { x: -11.5, y: 0.72, z: 8.4 }, scale: 0.9 }, 0x7f9a52);
    for (let i = 0; i < 3; i++) {
      const x = 15.0 + i * 0.75;
      S('bikeWheel', { position: { x: x - 0.45, y: 0.34, z: 5.6 } });
      S('bikeWheel', { position: { x: x + 0.45, y: 0.34, z: 5.6 } });
      S('bikeFrame', { position: { x, y: 0.62, z: 5.6 } }, [0xb2472e, 0x3f7a76, 0xc9a227][i]);
    }
    // the side yard: a skip that has been there since the handover, a stack of
    // pallets, and the agent's board that says the top floor is still available
    S('skip', { position: { x: -12.6, y: 0.63, z: 1.2 }, rotationY: 0.16 }, 0xc9a227);
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
    const parked = [[11.2, -0.2, 0xb2472e, 1], [13.6, 0.4, 0x35566e, 1], [16.0, -0.6, 0xd7c9b0, 1]];
    for (const [x, z, c] of parked) {
      S('carBody', { position: { x, y: 0.72, z }, rotationY: Math.PI / 2 }, c);
      S('carCabin', { position: { x, y: 1.42, z: z - 0.15 }, rotationY: Math.PI / 2 }, c);
      for (const [lat, lng] of [[-0.82, 1.45], [0.82, 1.45], [-0.82, -1.45], [0.82, -1.45]]) {
        S('wheel', { position: { x: x + lat, y: 0.32, z: z + lng } });
      }
    }
    // two cars at the kerb, because the bottom-left of the frame was bare asphalt
    for (const [x, c] of [[-13.6, 0x55504a], [-8.2, 0xbfae95]]) {
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

    this.car = { x: -60, speed: 9.5, z: -16.0, color: 0x3f7a76 };
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
        c: [0xc9a227, 0xa2a45c, 0xb98450, 0x9d5f38][i % 4],
      });
    }
  }

  _buildLights(scene) {
    this.rig = makeLightRig(scene, { timeOfDay: 'morning', radius: 30, shadowMapSize: 2048 });
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

    // 2700 K pool behind the ground-floor glazing, so the building reads as
    // occupied and the glass is not a black hole.
    this.interior = new PointLight(0xffc98a, 90, 24, 2);
    this.interior.position.set(4.6, 2.4, 1.0);
    scene.add(this.interior);
    const upper = new PointLight(0xffd2a0, 55, 20, 2);
    upper.position.set(5.2, 5.7, 0.6);
    scene.add(upper);
    // the entrance downlight, under the 900 mm reveal
    this.entranceLight = new PointLight(0xffdcae, 26, 6.5, 2);
    this.entranceLight.position.set(0.3, 2.75, 3.75);
    scene.add(this.entranceLight);
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

    this.ctx?.engine?.debug?.report('menu',
      `${this.lines.length} sign lines, ${this.building.crimes.length} tags, `
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
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, depthTest: false, fog: false, side: DoubleSide });
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
      if (this.hoverTag !== -1) { this.hoverTag = -1; this.lobby?.hideTag(); }
      return;
    }
    this.pointer.set(input.ndc.x, input.ndc.y);
    this.ray.setFromCamera(this.pointer, this.camera);

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
    g.fillStyle = '#d4763a';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = '#2b2825';
    g.stroke();
    g.fillStyle = '#20201e';
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
  const pole = new Mesh(new CylinderGeometry(0.055, 0.075, 7.0, 8), materialFor('metal'));
  pole.position.y = 3.5;
  pole.castShadow = true;
  group.add(pole);
  const finial = new Mesh(new SphereGeometry(0.11, 8, 6), materialFor('metal-warm'));
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
