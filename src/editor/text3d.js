// text3d.js — 3D text as a placeable object: shop signs, house numbers, facade
// lettering (DESIGN-DECISIONS.md, "Editor scope").
//
// Two renderers, same interface.
//   * SIGNAGE (always available, zero network): glyphs built on a 5 x 7 cell and
//     extruded. Chunky, flat-shaded, and completely at home in the low-poly look.
//   * GROTESK (an upgrade): real letterforms from three's helvetiker typeface,
//     fetched from the same unpkg origin three itself comes from. If it does not
//     arrive, nothing breaks and nothing is logged as an error — the signage font
//     is the fallback, not a failure state.
//
// One text object = one merged geometry = one draw call.

import {
  Group, Mesh, BoxGeometry, BufferGeometry, BufferAttribute, Matrix4, Vector3,
  MeshStandardMaterial, Color, ExtrudeGeometry,
} from 'three';

// 5 x 7 cell, 7 rows top to bottom, 5 bits per row.
const GLYPHS = {
  A: '01110,10001,10001,11111,10001,10001,10001',
  B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110',
  D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111',
  F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111',
  H: '10001,10001,10001,11111,10001,10001,10001',
  I: '11111,00100,00100,00100,00100,00100,11111',
  J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001',
  L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001',
  N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110',
  P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101',
  R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110',
  T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110',
  V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001',
  X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100',
  Z: '11111,00001,00010,00100,01000,10000,11111',
  0: '01110,10011,10101,10101,11001,10001,01110',
  1: '00100,01100,00100,00100,00100,00100,01110',
  2: '01110,10001,00001,00110,01000,10000,11111',
  3: '11110,00001,00001,01110,00001,00001,11110',
  4: '00010,00110,01010,10010,11111,00010,00010',
  5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110',
  7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110',
  9: '01110,10001,10001,01111,00001,00010,01100',
  ' ': '00000,00000,00000,00000,00000,00000,00000',
  '-': '00000,00000,00000,11111,00000,00000,00000',
  '.': '00000,00000,00000,00000,00000,01100,01100',
  ',': '00000,00000,00000,00000,00000,00110,01100',
  "'": '00100,00100,00000,00000,00000,00000,00000',
  '!': '00100,00100,00100,00100,00100,00000,00100',
  '?': '01110,10001,00001,00110,00100,00000,00100',
  ':': '00000,01100,01100,00000,01100,01100,00000',
  '/': '00001,00010,00010,00100,01000,01000,10000',
  '+': '00000,00100,00100,11111,00100,00100,00000',
  '&': '01100,10010,10100,01000,10101,10010,01101',
  '#': '01010,01010,11111,01010,11111,01010,01010',
};

const CELL_W = 5;
const CELL_H = 7;
const ADVANCE = 6;    // cells between glyph origins

let _grotesk = null;          // loaded three Font, or null
let _groteskTried = false;

async function loadGrotesk() {
  if (_groteskTried) return _grotesk;
  _groteskTried = true;
  try {
    const { FontLoader } = await import('three/addons/loaders/FontLoader.js');
    const url = 'https://unpkg.com/three@0.180.0/examples/fonts/helvetiker_bold.typeface.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    _grotesk = new FontLoader().parse(await res.json());
    console.info('[editor] 3D text: helvetiker outlines available');
  } catch (_) {
    _grotesk = null;
    console.info('[editor] 3D text: using the built-in signage face (no network font)');
  }
  return _grotesk;
}

/** Kick the optional upgrade off in the background. Safe to call many times. */
export function primeFonts() { loadGrotesk().catch(() => {}); }

/**
 * buildTextGeometry(value, size, depth, font) -> BufferGeometry
 * `size` is the CAP HEIGHT in metres, the way signage is specified.
 * Origin: left edge, baseline at y = 0, extruded towards +z.
 */
export function buildTextGeometry(value, size = 0.3, depth = 0.03, font = 'signage') {
  const text = String(value ?? '').toUpperCase();
  if (font === 'grotesk' && _grotesk) {
    const g = groteskGeometry(text, size, depth);
    if (g) return g;
  }
  return signageGeometry(text, size, depth);
}

function signageGeometry(text, size, depth) {
  const u = size / CELL_H;                 // one cell, in metres
  const boxes = [];
  let penX = 0;
  for (const ch of text) {
    const rows = (GLYPHS[ch] || GLYPHS['?']).split(',');
    for (let r = 0; r < CELL_H; r++) {
      const row = rows[r];
      let c = 0;
      while (c < CELL_W) {
        if (row[c] !== '1') { c++; continue; }
        let run = 0;
        while (c + run < CELL_W && row[c + run] === '1') run++;
        boxes.push({
          x: penX + (c + run / 2) * u,
          y: (CELL_H - r - 0.5) * u,
          w: run * u,
          h: u,
        });
        c += run;
      }
    }
    penX += ADVANCE * u;
  }
  if (!boxes.length) boxes.push({ x: 0, y: 0, w: u, h: u });
  const geos = boxes.map((b) => {
    const g = new BoxGeometry(b.w, b.h, depth);
    g.applyMatrix4(new Matrix4().makeTranslation(b.x, b.y, depth / 2));
    return g;
  });
  const merged = concat(geos);
  for (const g of geos) g.dispose();
  merged.userData.width = penX > 0 ? penX - u : u;
  merged.userData.height = size;
  return merged;
}

function groteskGeometry(text, size, depth) {
  try {
    const shapes = _grotesk.generateShapes(text, size / 0.72);   // helvetiker cap ≈ 0.72 em
    if (!shapes.length) return null;
    // ExtrudeGeometry lives in core three, no addon needed.
    const g = new ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 4 });
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-b.min.x, -b.min.y, 0);
    g.userData.width = b.max.x - b.min.x;
    g.userData.height = size;
    return g;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------

export class TextRenderer {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'texts';
    scene.add(this.group);
    this.meshes = new Map();       // id -> Mesh
    this.materials = new Map();    // colour -> material
    this.version = -1;
    primeFonts();
  }

  material(color) {
    const key = String(color || '#2b2b2b');
    let m = this.materials.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color: new Color(key), roughness: 0.6, metalness: 0.05, flatShading: true });
      this.materials.set(key, m);
    }
    return m;
  }

  rebuild(model, levelId, { skip = null } = {}) {
    const seen = new Set();
    for (const id in model.texts) {
      const t = model.texts[id];
      if (t.levelId !== levelId) continue;
      if (skip && skip.has(id)) continue;
      seen.add(id);
      let mesh = this.meshes.get(id);
      const sig = `${t.value}|${t.size}|${t.depth}|${t.font}`;
      if (!mesh || mesh.userData.sig !== sig) {
        mesh?.geometry.dispose();
        const geo = buildTextGeometry(t.value, t.size, t.depth, t.font);
        if (mesh) { mesh.geometry = geo; } else {
          mesh = new Mesh(geo, this.material(t.color));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          this.meshes.set(id, mesh);
        }
        mesh.userData.sig = sig;
      }
      mesh.material = this.material(t.color);
      // The stored x/z is the CENTRE of the run, which is how you place a sign.
      const w = mesh.geometry.userData.width || 0;
      mesh.position.set(t.x, t.y, t.z);
      mesh.rotation.set(0, t.rot || 0, 0);
      mesh.geometry.userData.width = w;
      mesh.userData.textId = id;
      mesh.visible = true;
      // shift the geometry origin so `x` really is the centre
      mesh.position.x -= Math.cos(t.rot || 0) * w * 0.5;
      mesh.position.z += Math.sin(t.rot || 0) * w * 0.5;
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) { mesh.visible = false; }
    }
    this.version = model.version;
  }

  /** World-space width of a text entity as it is currently built. */
  widthOf(id) { return this.meshes.get(id)?.geometry.userData.width ?? 0; }

  dispose() {
    for (const m of this.meshes.values()) { m.geometry.dispose(); this.group.remove(m); }
    for (const m of this.materials.values()) m.dispose();
    this.meshes.clear();
    this.materials.clear();
    this.group.parent?.remove(this.group);
  }
}

function concat(geos) {
  const names = ['position', 'normal', 'uv'];
  const sizes = { position: 3, normal: 3, uv: 2 };
  const flat = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const out = new BufferGeometry();
  for (const n of names) {
    const arr = new Float32Array(total * sizes[n]);
    let at = 0;
    for (const g of flat) {
      const src = g.getAttribute(n);
      const count = g.getAttribute('position').count;
      if (src) arr.set(src.array.subarray(0, count * sizes[n]), at * sizes[n]);
      at += count;
    }
    out.setAttribute(n, new BufferAttribute(arr, sizes[n]));
  }
  for (let i = 0; i < flat.length; i++) if (flat[i] !== geos[i]) flat[i].dispose();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export { Vector3 };
