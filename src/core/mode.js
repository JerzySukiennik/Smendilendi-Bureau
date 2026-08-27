// mode.js — the Mode interface plus one placeholder mode.
//
// Exactly one mode is active at a time. Each mode owns its own THREE.Scene and
// camera; the Engine owns the single renderer. Contract (ARCHITECTURE.md):
//   { id, init(ctx), enter(params), update(dt), render(renderer), exit(), dispose() }
//   ctx = { engine, state, input, audio, net, assets }
//
// MenuMode / OfficeMode / EditorMode / WalkthroughMode live in their own
// directories and are written by other agents; they extend this class.

import {
  Scene, PerspectiveCamera, Color, Fog, Mesh, PlaneGeometry, BoxGeometry,
  CylinderGeometry, Group, MathUtils, Vector3,
} from 'three';
import { materialFor, tintedMaterial, makeLightRig, skyFor, COLORS, tint } from './palette.js';
import { InstancePool } from './instancing.js';

export class Mode {
  constructor(id) {
    this.id = id;
    this.ctx = null;
    this.scene = null;
    this.camera = null;
    this.initialised = false;
    this.active = false;
  }

  /** Called once, the first time the mode is pushed. Build the scene here. */
  init(ctx) { this.ctx = ctx; this.initialised = true; }

  /** Called every time the mode becomes active. Cheap. */
  enter(_params = {}) { this.active = true; }

  /** dt in seconds, already clamped by the engine. */
  update(_dt) {}

  /** Default render. Override for render targets / split views. */
  render(renderer) {
    if (this.scene && this.camera) renderer.render(this.scene, this.camera);
  }

  /** Called when another mode takes over. Release pointer lock, stop loops. */
  exit() { this.active = false; }

  /** Viewport changed. Override when the camera is not a plain perspective one. */
  resize(width, height) {
    if (this.camera && this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Free GPU resources. Called when the mode is discarded for good. */
  dispose() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        // materials come from the shared palette cache — never disposed here
      }
    });
    this.scene = null;
  }
}

// ---------------------------------------------------------------------------
// PlaceholderMode — proof that the whole shell runs, and the reference for how a
// real mode is written. A lit ground plane, a small arrangement of volumes at
// believable architectural sizes, and an instanced field of props so the debug
// overlay shows a real, non-trivial draw-call count from day one.

export class PlaceholderMode extends Mode {
  constructor() {
    super('placeholder');
    this.t = 0;
    this.orbit = { yaw: 2.2, pitch: 0.40, dist: 24, target: new Vector3(0, 1.2, 0) };
    this.autoOrbit = true;
  }

  init(ctx) {
    super.init(ctx);
    const scene = new Scene();
    const sky = skyFor('morning');
    scene.background = new Color(sky.sky);
    scene.fog = new Fog(sky.sky, 45, 130);

    // --- ground: 120 x 120 m of grass, with a paved apron 24 x 18 m ----------
    const ground = new Mesh(new PlaneGeometry(160, 160), materialFor('grass'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const apron = new Mesh(new PlaneGeometry(26, 20), materialFor('paving'));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = 0.01;
    apron.receiveShadow = true;
    scene.add(apron);

    // --- volumes at real sizes ---------------------------------------------
    // A 9.0 x 6.0 m single-storey block, 3.0 m to the eaves; a 4.5 x 4.5 m annex
    // at 2.7 m (the residential floor-to-ceiling from building.js); a 0.24 m
    // freestanding wall. Everything here is a number an architect can check.
    const blocks = new Group();
    blocks.add(volume(9.0, 3.0, 6.0, 'plaster', -3.5, 0, 0));
    blocks.add(volume(4.5, 2.7, 4.5, 'brick', 3.25, 0, 0.75));
    blocks.add(volume(6.0, 1.10, 0.24, 'concrete', -3.5, 0, -3.9));   // 1.10 m garden wall, 240 mm thick
    scene.add(blocks);
    this.blocks = blocks;

    // a slab roof over the big block, 0.30 m thick (DEFAULT_SLAB_THICKNESS)
    const roof = new Mesh(new BoxGeometry(9.4, 0.30, 6.4), materialFor('concrete-dark'));
    roof.position.set(-3.5, 3.0 + 0.15, 0);
    roof.castShadow = true; roof.receiveShadow = true;
    scene.add(roof);

    // --- instanced props: everything repeated goes through the pool ---------
    const propGroup = new Group();
    scene.add(propGroup);
    const pool = new InstancePool(propGroup);
    // a 0.42 m seat-height stool (DESIGN: seat 0.42-0.46 m)
    pool.register('stool', new CylinderGeometry(0.17, 0.19, 0.42, 10), tintedMaterial());
    // a 0.60 x 0.60 m paving slab, 0.06 m thick
    pool.register('slab', new BoxGeometry(0.58, 0.06, 0.58), tintedMaterial());
    // a 3.5 m tree: 0.22 m trunk + crown
    pool.register('trunk', new CylinderGeometry(0.11, 0.14, 3.0, 8), materialFor('wood-dark'));
    pool.register('crown', new BoxGeometry(2.2, 2.2, 2.2), tintedMaterial({ flatShading: true }));
    this.pool = pool;

    pool.begin();
    // 12 stools in two rows on the apron
    for (let i = 0; i < 12; i++) {
      const x = -5 + (i % 6) * 2.0;
      const z = 6.0 + Math.floor(i / 6) * 1.6;
      pool.place('stool', { position: { x, y: 0.21, z }, rotationY: (i * 0.7) % Math.PI }, tint(6 + (i % 6)));
    }
    // a 16 x 10 field of paving slabs at 0.60 m centres — 160 instances, 1 draw call
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 10; j++) {
        pool.place('slab', { position: { x: -4.5 + i * 0.6, y: 0.04, z: -9.5 + j * 0.6 } }, COLORS.paving);
      }
    }
    // 14 trees around the plot edge
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const r = 26 + ((i * 7) % 9);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pool.place('trunk', { position: { x, y: 1.5, z } });
      pool.place('crown', { position: { x, y: 3.6 + (i % 3) * 0.3, z }, rotationY: i * 0.4 },
        i % 3 === 0 ? 0x6f8f4a : 0x86a659);   // two crown greens, lit not multiplied
    }
    pool.flush();

    // --- light rig ----------------------------------------------------------
    // morning sun (18 deg, azim 100) so the camera opens on a LIT facade — the
    // palette has to sell itself in the first frame anyone sees.
    this.rig = makeLightRig(scene, { timeOfDay: 'morning', radius: 24, shadowMapSize: 2048 });

    const camera = new PerspectiveCamera(55, 1, 0.1, 400);
    this.scene = scene;
    this.camera = camera;
    this._placeCamera();
  }

  enter(params = {}) {
    super.enter(params);
    this.ctx?.engine?.debug?.report('scene', `${this.pool.instanceCount} instances / ${this.pool.drawCalls} pooled calls`);
  }

  _placeCamera() {
    const o = this.orbit;
    const cp = Math.cos(o.pitch);
    this.camera.position.set(
      o.target.x + Math.sin(o.yaw) * cp * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.yaw) * cp * o.dist,
    );
    this.camera.lookAt(o.target);
  }

  update(dt) {
    this.t += dt;
    const input = this.ctx?.input;
    if (input) {
      // drag to orbit, wheel to dolly — enough to prove input works end to end
      if (input.mouseDown(0)) {
        this.autoOrbit = false;
        const d = input.consumeLook();
        this.orbit.yaw -= d.yaw * 3;
        this.orbit.pitch = MathUtils.clamp(this.orbit.pitch - d.pitch * 3, 0.06, 1.45);
      } else {
        input.movement.set(0, 0);
      }
      const w = input.consumeWheel();
      if (w) this.orbit.dist = MathUtils.clamp(this.orbit.dist + w * 0.01, 6, 90);
      const ax = input.axis2();
      if (ax.x || ax.y) {
        this.autoOrbit = false;
        const s = (input.down('sprint') ? 12 : 5) * dt;
        const f = new Vector3(this.orbit.target.x - this.camera.position.x, 0, this.orbit.target.z - this.camera.position.z).normalize();
        const r = new Vector3(f.z, 0, -f.x);
        this.orbit.target.addScaledVector(f, ax.y * s).addScaledVector(r, ax.x * s);
      }
    }
    if (this.autoOrbit) this.orbit.yaw += dt * 0.055;
    this._placeCamera();
    this.rig.focus(this.orbit.target.x, this.orbit.target.z);
  }

  dispose() {
    this.pool?.dispose();
    this.rig?.dispose();
    super.dispose();
  }
}

/** A box sitting ON the ground (origin at floor centre), in metres. */
function volume(w, h, d, mat, x, y, z) {
  const m = new Mesh(new BoxGeometry(w, h, d), materialFor(mat));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
