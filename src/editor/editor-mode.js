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
  Matrix4,
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
    // The ground of the plot is a surface you can point AT: with it in this
    // list a cursor over the site reads "On Face" instead of saying nothing.
    this.editor.siteFaces = this.siteFaces || [];
    // The trees the plan has to show as SYMBOLS rather than as objects: the plot
    // owns them, plan.js draws them, and this is the one place the two meet.
    this.editor.plan.setSite({ trees: this.commission?.plot?.trees || [] });
    // And Zoom Extents will not park the camera inside a lime tree — unless the
    // player has switched the trees off, in which case there is nothing to
    // stand in and no reason to swing the view.
    this.editor.cameras.obstacles = () => (this.editor.layers.trees ? (this.crowns || []) : []);
    // The tag switches in the HUD reach the site through here.
    this.editor.onLayersChanged = () => this._applySiteVisibility();
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
    this.siteFaces = [];       // ground the cursor can legitimately be ON
    this.crowns = [];          // tree canopies: culled when they get in the way
    // Which TAG owns each mesh, so the editor's visibility switches can take
    // the neighbours out of the picture without taking the ground with them.
    this.tagged = { site: [], neighbours: [] };

    // ground beyond the plot
    const ground = new Mesh(new PlaneGeometry(400, 400), materialFor('grass'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    g.add(ground);
    this.siteFaces.push(ground);
    this.tagged.site.push(ground);

    // the plot itself, a shade lighter so the boundary reads without a fence
    const plotMesh = new Mesh(polygonGeometry(plot.boundary), materialFor('grass'));
    plotMesh.material = materialFor('grass');
    plotMesh.rotation.x = -Math.PI / 2;
    plotMesh.position.y = 0;
    plotMesh.receiveShadow = true;
    g.add(plotMesh);
    this.siteFaces.push(plotMesh);
    this.tagged.site.push(plotMesh);

    // buildable area (inside the setbacks) — the line the building must not cross
    if (plot.buildable?.length >= 3) {
      const b = new Mesh(polygonGeometry(plot.buildable), new MeshBasicMaterial({
        // Jurek asked for "a square, a bit grey, where you build". The previous
        // 0xf0e2c8 at 0.35 read as OLIVE once the grass showed through it — a
        // critic measured it — so this is a neutral grey at an opacity that stays
        // grey over green. Neutral on purpose: it must read as "ground you may
        // use", not as a material or a floor finish.
        color: 0xb8b4ae, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false,
      }));
      b.rotation.x = -Math.PI / 2;
      b.position.y = 0.004;
      g.add(b);
      this.tagged.site.push(b);
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
      this.tagged.site.push(road);
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
      this.tagged.neighbours.push(top);
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
        this.tagged.neighbours.push(w);
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
      const i0 = pool.place('crown', {
        position: { x: t.x, y: clear + crownH * 0.42, z: t.z },
        rotationY: (t.x * 0.7 + t.z * 0.3) % Math.PI,
        scale: { x: r * 2, y: crownH * 0.72, z: r * 2 },
      }, t.protected ? 0x6f8f4a : 0x87a55c);
      const i1 = pool.place('crown', {
        position: { x: t.x, y: clear + crownH * 0.82, z: t.z },
        rotationY: (t.x * 1.3 + t.z) % Math.PI,
        scale: { x: r * 1.3, y: crownH * 0.5, z: r * 1.3 },
      }, t.protected ? 0x7d9c56 : 0x93b168);
      // A canopy is two boxes, not a ball, so it is tested as an ELLIPSOID that
      // contains them: r * 1.45 horizontally (the half-diagonal of a box r wide)
      // and the full crown height vertically. A sphere on the same centre missed
      // the corners, and a corner of an oak fills the viewport just as well as
      // its middle does.
      this.crowns.push({
        x: t.x, y: clear + crownH * 0.55, z: t.z,
        rx: r * 1.45, ry: Math.max(crownH * 0.62, 1),
        r: Math.max(r * 1.45, crownH * 0.62),      // the sphere Zoom Extents avoids
        idx: [i0, i1].filter(i => i >= 0),
        keep: [], hidden: false,
      });
    }
    pool.flush();
    this.treePool = pool;

    // Remember each canopy's own matrix so culling it is reversible.
    const crownMesh = pool.entries.get('crown')?.mesh;
    if (crownMesh) {
      for (const c of this.crowns) {
        c.keep = c.idx.map((i) => { const m = new Matrix4(); crownMesh.getMatrixAt(i, m); return m; });
      }
    }
    this._zeroMatrix = new Matrix4().makeScale(0, 0, 0);

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
    this.tagged.site.push(marker);
  }

  /**
   * A tree standing between you and your model is a wall of opaque green with
   * no explanation attached, and on a plot with four limes on it that is not a
   * corner case: Zoom Extents landed inside a canopy at two of twelve azimuths.
   * So a canopy that is on the line between the camera and what the camera is
   * looking at — or that the camera is standing inside — takes itself out of
   * the picture until you move. The trunk stays: the tree is still there, still
   * protected, still in the way of the walls, and you can still see where.
   */
  _cullCanopies() {
    const mesh = this.treePool?.entries.get('crown')?.mesh;
    if (!mesh || !this.crowns?.length || !this.editor) return;
    const cams = this.editor.cameras;
    if (cams.mode === 'plan') return;              // canopies are already hidden
    if (!this.editor.layers.trees) return;         // the whole tag is off
    const eye = cams.camera.position;
    const look = cams.mode === 'walk'
      ? _lookAhead(cams, this._look || (this._look = new Vector3()))
      : cams.target;
    let dirty = false;
    for (const c of this.crowns) {
      const hide = _crownInTheWay(c, eye, look);
      if (hide === c.hidden) continue;
      c.hidden = hide;
      for (let k = 0; k < c.idx.length; k++) {
        mesh.setMatrixAt(c.idx[k], hide ? this._zeroMatrix : c.keep[k]);
      }
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Show or hide the site content that stands above the plan cut.
   *
   * The TRUNK goes too, not only the canopy. A trunk is 2.6 m of solid timber
   * standing well above the 1.20 m cut and above the drawing's own linework, so
   * in plan it printed a filled brown disc over whatever it happened to stand
   * on — in one case across a dimension string and its figure. plan.js draws
   * the tree properly instead: canopy outline, centre cross, lightest weight,
   * bottom layer.
   */
  _siteForView(mode) {
    this._planCut = mode === 'plan';
    this._applySiteVisibility();
  }

  /**
   * The one place site visibility is decided, because two rules act on the same
   * meshes and they must not overwrite each other: the PLAN takes out whatever
   * stands above the 1.20 m cut, and the player's TAGS take out whatever he has
   * switched off. Anything either of them hides stays hidden.
   */
  _applySiteVisibility() {
    const plan = !!this._planCut;
    const tags = this.editor?.layers || { site: true, neighbours: true, trees: true };
    for (const o of this.tagged?.site || []) o.visible = tags.site;
    for (const o of this.tagged?.neighbours || []) o.visible = tags.neighbours;
    for (const o of this.aboveCut || []) if (plan) o.visible = false;
    for (const kind of ['crown', 'trunk']) {
      const e = this.treePool?.entries.get(kind);
      if (e?.mesh) e.mesh.visible = tags.trees && !plan;
    }
    // Ground you cannot see is ground the cursor must not read "On Face" off,
    // and a canopy nobody can see is not in the way of Zoom Extents either.
    if (this.editor) this.editor.siteFaces = tags.site ? (this.siteFaces || []) : [];
  }

  /**
   * Re-site the editor on a NEW commission.
   *
   * Added for the game loop (src/core/loop.js). init() reads the commission
   * once and a mode is only ever init()ed once, so without this the second
   * brief of a session would have been drawn on the first brief's plot: the
   * wrong boundary, the wrong setbacks, the wrong neighbours casting the shade
   * the daylight module measures, and a cost bar reading against last month's
   * budget. Everything the plot owns is torn down and rebuilt; the model itself
   * is not touched here, because it belongs to the session.
   */
  setCommission(commission) {
    if (!commission || !this.initialised) return false;
    if (commission === this.commission) return false;
    this.commission = commission;

    this.treePool?.dispose();
    this.treePool = null;
    clearGroup(this.site);
    this._buildSite(commission.plot);

    const ed = this.editor;
    if (ed) {
      ed.brief = briefFrom(commission);
      // The editor refuses geometry outside the buildable line (editor._opAllowed)
      // and needs the polygon itself to do it — `siteBounds` is only the boundary's
      // extent, which is neither the setback line nor the right shape now that
      // plots come in six outline families.
      ed.plot = commission.plot || null;
      ed.siteBounds = boundsOfPolygon(commission.plot?.boundary);
      ed.siteFaces = this.siteFaces || [];
      ed.plan.setSite({ trees: commission.plot?.trees || [] });
      ed.cameras.obstacles = () => (ed.layers.trees ? (this.crowns || []) : []);
      ed._labelCache = null;
      ed._costCache.version = -1;
      ed.markDirty(['*']);
      ed._needsInitialFrame = true;      // frame the new plot on the next update
      ed.hud?.refreshValidation?.();
      ed.hud?.refreshCost?.();
    }
    this._applySiteVisibility();
    return true;
  }

  // -- mode plumbing -------------------------------------------------------

  enter(params = {}) {
    super.enter(params);
    // The loop hands the current brief in on every push; a commission that has
    // moved on since this mode was built re-sites it here rather than silently
    // drawing on the wrong plot.
    if (params.commission) this.setCommission(params.commission);
    if (this.hud) this.hud.root.style.display = '';
    if (this.editor) {
      this.editor.enabled = true;
      this.editor.hud?.refreshTool();
      this.editor.hud?.refreshSubmit?.();
    }
  }

  exit() {
    super.exit();
    if (this.hud) this.hud.root.style.display = 'none';
    if (this.editor) this.editor.enabled = false;
  }

  /** The office calls this with the monitor's texture target; null = full screen. */
  setRenderTarget(rt, viewportRect = null) {
    this.renderTarget = rt;
    if (rt) this.editor?.resize(rt.width, rt.height);
    else this.editor?.resize(this.ctx.engine.width, this.ctx.engine.height);
    this.editor?.cameras?.setViewportRect?.(rt ? viewportRect : null);
  }

  /**
   * Run INSIDE the in-game computer instead of as a mode over the game.
   * DESIGN-DECISIONS.md, second playtest, item 4: clicking the monitor zooms
   * the camera until the monitor fills the real screen and the editor runs on
   * that screen at the computer tier's resolution — no separate window. The
   * office owns the render target and the framing; this mode just agrees to
   * be entered without being on the engine's stack and to draw into what it
   * is given. The HUD is pinned to the projected screen rectangle by the
   * office every frame, so the palette and the top bar sit ON the monitor.
   */
  enterOnScreen(params, rt, viewportRect) {
    this.onScreen = true;
    this.enter(params);
    this.setRenderTarget(rt, viewportRect);
  }

  exitOnScreen() {
    this.onScreen = false;
    this.setRenderTarget(null);
    if (this.hud) { const st = this.hud.root.style; st.left = st.top = st.width = st.height = ''; }
    this.exit();
  }

  /** Called by the office each frame with the screen quad's on-canvas rectangle. */
  setScreenRect(rect) {
    this.editor?.cameras?.setViewportRect?.(rect);
    if (this.hud && rect) {
      const st = this.hud.root.style;
      st.left = `${rect.x}px`; st.top = `${rect.y}px`; st.width = `${rect.w}px`; st.height = `${rect.h}px`;
    }
  }

  update(dt) {
    this.editor?.update(dt);
    this._cullCanopies();
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

/**
 * Empty a group and give back what it held. Geometry is always ours; materials
 * come from the shared palette cache and must NOT be disposed — the only
 * exception is the buildable-area overlay, which _buildSite news up itself.
 */
function clearGroup(g) {
  if (!g) return;
  for (let i = g.children.length - 1; i >= 0; i--) {
    const o = g.children[i];
    g.remove(o);
    o.traverse?.((n) => {
      if (!n.isMesh && !n.isInstancedMesh) return;
      n.geometry?.dispose?.();
      const m = n.material;
      if (m && m.isMeshBasicMaterial) m.dispose();
    });
  }
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

/** Six metres ahead of a walking camera is what it is looking at. */
function _lookAhead(cams, out) {
  return out.set(
    cams.walkPos.x - Math.sin(cams.walkYaw) * 6,
    1.6,
    cams.walkPos.z - Math.cos(cams.walkYaw) * 6,
  );
}

/**
 * Is this canopy on the line of sight, or is the camera standing in it?
 * Everything is measured in the canopy's own ellipsoid units, so one test
 * covers a squat wide lime and a tall narrow poplar.
 */
function _crownInTheWay(c, eye, look) {
  const rx = c.rx + 0.6, ry = c.ry + 0.6;
  const ex = (eye.x - c.x) / rx, ey = (eye.y - c.y) / ry, ez = (eye.z - c.z) / rx;
  if (ex * ex + ey * ey + ez * ez < 1.6 * 1.6) return true;      // standing in it
  const abx = (look.x - eye.x) / rx, aby = (look.y - eye.y) / ry, abz = (look.z - eye.z) / rx;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-9) return false;
  const px = -ex, py = -ey, pz = -ez;
  let t = (px * abx + py * aby + pz * abz) / len2;
  if (t < 0 || t > 1) return false;                 // behind the eye or past the model
  const qx = px - abx * t, qy = py - aby * t, qz = pz - abz * t;
  return qx * qx + qy * qy + qz * qz < 1;
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
