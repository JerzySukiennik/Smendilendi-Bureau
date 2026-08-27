// editor-mode.js — the Mode wrapper around the editor.
//
// Two render paths, one code path (ARCHITECTURE.md): when the office hands us a
// render target we draw into the monitor's screen texture, and when the player
// focuses the monitor we draw the same scene straight to the canvas. Nothing
// about the editor changes; only `setRenderTarget` does.
//
// The scene the editor lives in is the SITE, not a void: the plot boundary, the
// setback line the building must stay inside, the neighbours that will shade it,
// the trees that cannot be felled and the street the entrance has to face. An
// architect who cannot see the site is being asked to design in the dark.

import {
  Scene, Color, Fog, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry, Group,
  Vector3, Shape, ShapeGeometry, DoubleSide, MeshBasicMaterial, Vector2, Box3,
} from 'three';
import { Mode } from '../core/mode.js';
import { materialFor, makeLightRig, skyFor, tintedMaterial, COLORS } from '../core/palette.js';
import { InstancePool } from '../core/instancing.js';
import { createSession } from '../net/session.js';
import { generateCommission } from '../commission/index.js';
import { Editor } from './editor.js';
import { EditorHUD } from './hud.js';

// Resolved against THIS module, not against the document, so the editor styles
// load the same from index.html and from src/editor/dev.html.
const CSS_HREF = new URL('./editor.css', import.meta.url).href;

export class EditorMode extends Mode {
  constructor() {
    super('editor');
    this.editor = null;
    this.hud = null;
    this.renderTarget = null;
    this.commission = null;
  }

  init(ctx) {
    super.init(ctx);
    ensureCss();

    const scene = new Scene();
    const sky = skyFor('noon');
    scene.background = new Color(sky.sky);
    scene.fog = new Fog(sky.sky, 90, 260);
    this.scene = scene;

    // --- the commission -----------------------------------------------------
    this.commission = ctx.state?.get('commission')
      || generateCommission(`editor-${Date.now() % 100000}`, 0.4);
    if (!ctx.state?.get('commission')) ctx.state?.set('commission', this.commission);

    // --- the site -----------------------------------------------------------
    this.site = new Group();
    this.site.name = 'site';
    scene.add(this.site);
    this._buildSite(this.commission.plot);

    this.rig = makeLightRig(scene, { timeOfDay: 'noon', radius: 40, shadowMapSize: 2048 });

    // --- session ------------------------------------------------------------
    this.session = ctx.net || createSession({
      mode: 'local',
      nick: ctx.state?.get('session.playerId') ? 'Architect' : 'Architect',
      color: '#d4763a',
    });
    if (!ctx.net) { ctx.net = this.session; ctx.state?.set('session.playerId', this.session.playerId); }

    // --- the editor ---------------------------------------------------------
    this.editor = new Editor(ctx, {
      scene,
      canvas: ctx.engine.canvas,
      session: this.session,
      brief: briefFrom(this.commission),
      siteBounds: boundsOfPolygon(this.commission.plot?.boundary),
    });
    this.editor.attachSession();
    // A plan is a section at 1.20 m: everything the site owns above the cut
    // leaves the picture, so the drawing is not read through a tree canopy.
    this.editor.onViewChanged = (mode) => this._siteForView(mode);
    this.camera = this.editor.cameras.camera;

    this.hud = new EditorHUD(this.editor, document.getElementById('ui'));
    this.hud.refreshTool();
    this.editor.setView('orbit');
  }

  // -- the plot ------------------------------------------------------------

  _buildSite(plot) {
    if (!plot) return;
    const g = this.site;
    this.aboveCut = [];        // site meshes that a plan cut would remove

    // ground beyond the plot
    const ground = new Mesh(new PlaneGeometry(400, 400), materialFor('grass'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    g.add(ground);

    // the plot itself, a shade lighter so the boundary reads without a fence
    const plotMesh = new Mesh(polygonGeometry(plot.boundary), materialFor('grass'));
    plotMesh.material = materialFor('grass');
    plotMesh.rotation.x = -Math.PI / 2;
    plotMesh.position.y = 0;
    plotMesh.receiveShadow = true;
    g.add(plotMesh);

    // buildable area (inside the setbacks) — the line the building must not cross
    if (plot.buildable?.length >= 3) {
      const b = new Mesh(polygonGeometry(plot.buildable), new MeshBasicMaterial({
        color: 0xf0e2c8, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false,
      }));
      b.rotation.x = -Math.PI / 2;
      b.position.y = 0.004;
      g.add(b);
    }

    // the street
    if (plot.street?.centreline?.length === 2) {
      const [a, b] = plot.street.centreline;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const road = new Mesh(new PlaneGeometry(plot.street.width || 6, len), materialFor('asphalt'));
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = -Math.atan2(b[0] - a[0], b[1] - a[1]);
      road.position.set((a[0] + b[0]) / 2, 0.006, (a[1] + b[1]) / 2);
      road.receiveShadow = true;
      g.add(road);
    }

    // neighbours: real volumes at their real heights, because they cast the shade
    // the daylight analysis measures
    for (const n of plot.neighbours || []) {
      const poly = n.polygon;
      if (!poly || poly.length < 3) continue;
      const shape = polygonGeometry(poly);
      const top = new Mesh(shape, materialFor('concrete'));
      top.rotation.x = -Math.PI / 2;
      top.position.y = n.height;
      top.castShadow = true;
      top.receiveShadow = true;
      g.add(top);
      this.aboveCut.push(top);
      // walls of the neighbour, as a simple extrusion of its footprint
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const w = new Mesh(new PlaneGeometry(l, n.height), materialFor('plaster-warm', { side: 'double' }));
        w.position.set((p[0] + q[0]) / 2, n.height / 2, (p[1] + q[1]) / 2);
        w.rotation.y = Math.atan2(q[0] - p[0], q[1] - p[1]) + Math.PI / 2;
        w.castShadow = true;
        w.receiveShadow = true;
        g.add(w);
        // Only the part above the cut is hidden in plan; a 1.20 m cut through a
        // neighbour reads as its footprint, which is what a site plan shows.
        if (n.height > 1.2) this.aboveCut.push(w);
      }
    }

    // trees, instanced
    const pool = new InstancePool(g);
    // A tree is a trunk plus two offset crown blocks: enough silhouette to read
    // as a lime at 40 m, still two pool kinds and two draw calls for the whole site.
    pool.register('trunk', new CylinderGeometry(0.16, 0.24, 1, 8), materialFor('wood-dark'));
    pool.register('crown', new BoxGeometry(1, 1, 1), tintedMaterial({ flatShading: true }));
    pool.begin();
    for (const t of plot.trees || []) {
      const r = t.radius || 3;          // canopy RADIUS, metres
      const h = t.height || 10;         // overall height to the top of the canopy
      const clear = Math.min(2.6, h * 0.28);   // clear stem under the canopy
      pool.place('trunk', { position: { x: t.x, y: clear / 2, z: t.z }, scale: { x: 1, y: clear, z: 1 } });
      const crownH = h - clear;
      pool.place('crown', {
        position: { x: t.x, y: clear + crownH * 0.42, z: t.z },
        rotationY: (t.x * 0.7 + t.z * 0.3) % Math.PI,
        scale: { x: r * 2, y: crownH * 0.72, z: r * 2 },
      }, t.protected ? 0x6f8f4a : 0x87a55c);
      pool.place('crown', {
        position: { x: t.x, y: clear + crownH * 0.82, z: t.z },
        rotationY: (t.x * 1.3 + t.z) % Math.PI,
        scale: { x: r * 1.3, y: crownH * 0.5, z: r * 1.3 },
      }, t.protected ? 0x7d9c56 : 0x93b168);
    }
    pool.flush();
    this.treePool = pool;

    // a marker cube on the entrance side, so "the entrance must face the street"
    // is a thing you can see and not a sentence in an e-mail
    const c = centroid(plot.boundary);
    const dir = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[plot.entranceFacing] || [0, 1];
    const bs = bounds(plot.boundary);
    const marker = new Mesh(new BoxGeometry(1.6, 0.06, 1.6), materialFor('accent'));
    marker.position.set(
      c.x + dir[0] * (bs.w / 2 + 1.2),
      0.03,
      c.z + dir[1] * (bs.d / 2 + 1.2),
    );
    g.add(marker);
  }

  /** Show or hide the site content that stands above the plan cut. */
  _siteForView(mode) {
    const plan = mode === 'plan';
    for (const o of this.aboveCut || []) o.visible = !plan;
    const crown = this.treePool?.entries.get('crown');
    if (crown?.mesh) crown.mesh.visible = !plan;
  }

  // -- mode plumbing -------------------------------------------------------

  enter(params = {}) {
    super.enter(params);
    if (this.hud) this.hud.root.style.display = '';
    if (this.editor) {
      this.editor.enabled = true;
      this.editor.hud?.refreshTool();
    }
  }

  exit() {
    super.exit();
    if (this.hud) this.hud.root.style.display = 'none';
    if (this.editor) this.editor.enabled = false;
  }

  /** The office calls this with the monitor's texture target; null = full screen. */
  setRenderTarget(rt) {
    this.renderTarget = rt;
    if (rt) this.editor?.resize(rt.width, rt.height);
    else this.editor?.resize(this.ctx.engine.width, this.ctx.engine.height);
  }

  update(dt) {
    this.editor?.update(dt);
    this.camera = this.editor?.cameras.camera || this.camera;
    this.rig?.focus(this.editor?.cameras.target.x || 0, this.editor?.cameras.target.z || 0);
    const dbg = this.ctx?.engine?.debug;
    if (dbg && this.editor) {
      const s = this.editor.stats;
      dbg.report('editor', `${this.editor.cameras.mode} · rebuild ${s.rebuildMs.toFixed(1)} ms (${s.rebuildWhat || 'idle'})`);
      dbg.report('model', `v${this.editor.model.version} · ${Object.keys(this.editor.model.walls).length} walls · `
        + `${Object.keys(this.editor.model.openings).length} openings · ${this.editor.furniture.count || 0} objects`);
    }
  }

  render(renderer) {
    if (!this.editor) return;
    this.editor.render(renderer, this.renderTarget);
  }

  resize(w, h) {
    if (this.renderTarget) return;
    this.editor?.resize(w, h);
  }

  dispose() {
    this.hud?.dispose();
    this.editor?.dispose();
    this.treePool?.dispose();
    this.rig?.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------

/** The subset of the commission the analysis engine reads as a brief. */
function briefFrom(c) {
  if (!c) return {};
  return {
    buildingType: c.type,
    budget: c.budget,
    program: c.program,
    constraints: c.constraints,
    plot: c.plot,
    storeys: c.storeys,
    areas: c.areas,
    params: c.params,
    title: c.title,
  };
}

function polygonGeometry(poly) {
  const shape = new Shape();
  shape.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
  shape.closePath();
  const g = new ShapeGeometry(shape);
  // ShapeGeometry lives in XY; the caller rotates it flat, which mirrors Z.
  g.scale(1, -1, 1);
  return g;
}

function centroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) { x += p[0]; z += p[1]; }
  return { x: x / poly.length, z: z / poly.length };
}

/** Box3 over a plan polygon, one storey tall — what the camera frames at start. */
function boundsOfPolygon(poly) {
  const b = new Box3();
  b.makeEmpty();
  if (!poly || poly.length < 3) return b;
  for (const p of poly) {
    b.expandByPoint(new Vector3(p[0], 0, p[1]));
    b.expandByPoint(new Vector3(p[0], 3.0, p[1]));
  }
  return b;
}

function bounds(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
  }
  return { w: maxX - minX, d: maxZ - minZ, minX, maxX, minZ, maxZ };
}

function ensureCss() {
  if (document.querySelector(`link[href="${CSS_HREF}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = CSS_HREF;
  document.head.appendChild(l);
}

export { Vector3, Vector2, COLORS };
