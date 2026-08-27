// heatmap.js — where the building was actually used.
//
// One grid per level, 0.25 m cells, accumulating person-seconds. Two consumers:
//
//   * the POST-OCCUPANCY PLAN at the end of the walk — the drawing an architect
//     recognises, with the heat laid over the room outlines;
//   * the WORN FLOOR, in the world, during the walk — the same data as a
//     texture on a decal plane. The tracks on the floor are not decoration
//     applied by hand: they are where these thirty people walked.
//
// Everything is in metres. Only the canvas rendering touches the DOM, and it is
// only called when something asks for a picture.

export const HEAT_CELL = 0.25;

/** Sequential ramp, warm, dark-to-hot. Built from the game palette. */
const RAMP = [
  [0.00, [0x20, 0x20, 0x1e, 0]],
  [0.06, [0x3f, 0x7a, 0x76, 90]],
  [0.22, [0x7f, 0x9a, 0x52, 150]],
  [0.45, [0xc9, 0xa2, 0x27, 200]],
  [0.70, [0xd4, 0x76, 0x3a, 225]],
  [1.00, [0xb2, 0x47, 0x2e, 245]],
];

function rampAt(t) {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (v - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
        c0[3] + (c1[3] - c0[3]) * k,
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export class Heatmap {
  /**
   * @param {Navmesh} nav
   * @param {number} cell metres
   */
  constructor(nav, cell = HEAT_CELL) {
    this.nav = nav;
    this.cell = cell;
    this.levels = nav.levels.map((L) => {
      // Cover the whole lattice of that level; the navmesh already padded it.
      const w = Math.ceil((L.w * nav.cell) / cell);
      const h = Math.ceil((L.h * nav.cell) / cell);
      return {
        levelId: L.levelId, minX: L.minX, minZ: L.minZ, w, h,
        grid: new Float32Array(w * h),
        peak: 0,
      };
    });
    this.total = 0;
    this.samples = 0;
    this.dirty = true;
  }

  bounds(levelIdx = 0) {
    const L = this.levels[levelIdx];
    if (!L) return { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
    return { minX: L.minX, minZ: L.minZ, maxX: L.minX + L.w * this.cell, maxZ: L.minZ + L.h * this.cell };
  }

  /**
   * Deposit `amount` person-seconds at a point. The 3x3 kernel is not a blur
   * for looks: a person is 0.5 m wide and wears a track that wide, so a
   * point-sample would draw a line one cell across that no floor ever shows.
   */
  add(x, z, levelIdx = 0, amount = 1) {
    const L = this.levels[levelIdx];
    if (!L) return;
    const fi = (x - L.minX) / this.cell - 0.5;
    const fj = (z - L.minZ) / this.cell - 0.5;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const tx = fi - i0, tz = fj - j0;
    // bilinear deposit, then a light spread to the 8 ring so the track has width
    const put = (i, j, a) => {
      if (i < 0 || j < 0 || i >= L.w || j >= L.h || a <= 0) return;
      const k = j * L.w + i;
      const v = (L.grid[k] += a);
      if (v > L.peak) L.peak = v;
    };
    const core = amount * 0.62;
    put(i0, j0, core * (1 - tx) * (1 - tz));
    put(i0 + 1, j0, core * tx * (1 - tz));
    put(i0, j0 + 1, core * (1 - tx) * tz);
    put(i0 + 1, j0 + 1, core * tx * tz);
    const ring = amount * 0.38 / 8;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        put(i0 + di, j0 + dj, ring);
      }
    }
    this.total += amount;
    this.samples++;
    this.dirty = true;
  }

  /**
   * Lay a whole journey down at once. `points` is a smoothed path; the walk is
   * resampled at half a cell so a 12 m straight leg does not deposit two dots.
   * `weight` is person-seconds per metre — one person walking at 1.35 m/s
   * spends 0.74 s on every metre.
   */
  addPath(points, weight = 0.74, levelOverride = null) {
    if (!points || points.length < 2) return 0;
    const step = this.cell * 0.5;
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const lvl = levelOverride ?? (b.level ?? 0);
      if (a.level !== b.level) continue;                  // a stair, not a floor
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 1e-6) continue;
      const n = Math.max(1, Math.ceil(d / step));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        this.add(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, lvl, (d / n) * weight);
      }
      len += d;
    }
    return len;
  }

  /** Value at a world point, in person-seconds. */
  at(x, z, levelIdx = 0) {
    const L = this.levels[levelIdx];
    if (!L) return 0;
    const i = Math.floor((x - L.minX) / this.cell);
    const j = Math.floor((z - L.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= L.w || j >= L.h) return 0;
    return L.grid[j * L.w + i];
  }

  /**
   * The value that 98 % of the occupied cells fall under. Normalising on the
   * absolute peak makes every plan look empty, because one cell in a doorway
   * always dwarfs the rooms.
   */
  scaleOf(levelIdx = 0, percentile = 0.98) {
    const L = this.levels[levelIdx];
    if (!L) return 1;
    // Sorting every occupied cell is the expensive part of drawing the wear.
    // The distribution moves slowly, so the answer is cached against the number
    // of samples that have gone in since it was last computed.
    const c = (this._scaleCache ??= new Map()).get(levelIdx);
    if (c && this.samples - c.at < 900 && c.p === percentile) return c.v;
    const vals = [];
    for (let k = 0; k < L.grid.length; k++) if (L.grid[k] > 0) vals.push(L.grid[k]);
    if (!vals.length) return 1;
    vals.sort((a, b) => a - b);
    const v = Math.max(1e-6, vals[Math.min(vals.length - 1, Math.floor(vals.length * percentile))]);
    this._scaleCache.set(levelIdx, { v, at: this.samples, p: percentile });
    return v;
  }

  // -- pictures ------------------------------------------------------------

  /**
   * The heat itself, as an RGBA canvas one pixel per cell scaled by `px`.
   * `mode` 'heat' is the report colour ramp; 'wear' is the floor decal —
   * a dull scuff, alpha only, no colour drama.
   */
  toCanvas(levelIdx = 0, { px = 4, mode = 'heat', scale = null, gamma = 0.55, into = null } = {}) {
    const L = this.levels[levelIdx];
    const cv = into || document.createElement('canvas');
    if (!L) { cv.width = cv.height = 1; return cv; }
    cv.width = L.w; cv.height = L.h;
    const ctx = cv.getContext('2d');
    // Reused: at 30 Hz of NPC movement this is called every couple of seconds
    // to refresh the worn floor, and a fresh ImageData each time is a hitch.
    const key = `${levelIdx}|${mode}`;
    let img = this._img?.get(key);
    if (!img || img.width !== L.w || img.height !== L.h) {
      img = ctx.createImageData(L.w, L.h);
      (this._img ??= new Map()).set(key, img);
    }
    const s = scale ?? this.scaleOf(levelIdx);
    for (let k = 0; k < L.grid.length; k++) {
      const t = Math.pow(Math.min(1, L.grid[k] / s), gamma);
      const o = k * 4;
      if (mode === 'wear') {
        // Worn floor: the finish loses its colour and gains a slight sheen.
        // 0.34 is as far as it goes — a scuffed track, not a stain.
        img.data[o] = 0x6f; img.data[o + 1] = 0x63; img.data[o + 2] = 0x53;
        img.data[o + 3] = Math.round(Math.min(1, t) * 86);
      } else {
        const c = rampAt(t);
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
        img.data[o + 3] = Math.round(c[3] * Math.min(1, t * 1.6));
      }
    }
    ctx.putImageData(img, 0, 0);
    if (px === 1 || into) return cv;
    const big = document.createElement('canvas');
    big.width = L.w * px; big.height = L.h * px;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(cv, 0, 0, big.width, big.height);
    return big;
  }

  /**
   * The post-occupancy plan: the architect's drawing with the heat on it.
   * Walls in poché, room names, a north point, a scale bar and a legend — a
   * page he could put in a report, not a game screen.
   */
  planCanvas(levelIdx = 0, {
    width = 1000, margin = 56, showNames = true, title = 'Movement heat map',
    subtitle = '', rooms = null,
  } = {}) {
    const nav = this.nav;
    const L = this.levels[levelIdx];
    const b = this.bounds(levelIdx);
    const wm = b.maxX - b.minX, hm = b.maxZ - b.minZ;
    const scale = (width - margin * 2) / wm;
    const height = Math.round(hm * scale) + margin * 2 + 48;
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const g = cv.getContext('2d');
    const X = (x) => margin + (x - b.minX) * scale;
    const Z = (z) => margin + (z - b.minZ) * scale;

    g.fillStyle = '#f3ece1';
    g.fillRect(0, 0, width, height);

    // 1. rooms as white floor with a hairline
    const list = (rooms ?? nav.topo.rooms).filter((r) => r.levelId === L.levelId);
    for (const r of list) {
      g.beginPath();
      r.polygon.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1]))));
      g.closePath();
      for (const hole of r.holes ?? []) {
        g.moveTo(X(hole[0][0]), Z(hole[0][1]));
        for (let i = hole.length - 1; i >= 0; i--) g.lineTo(X(hole[i][0]), Z(hole[i][1]));
        g.closePath();
      }
      g.fillStyle = '#ffffff';
      g.fill('evenodd');
    }

    // 2. the heat
    const heat = this.toCanvas(levelIdx, { px: 1, mode: 'heat' });
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(heat, X(L.minX), Z(L.minZ), L.w * this.cell * scale, L.h * this.cell * scale);
    g.restore();

    // 3. walls, drawn as real poché from the model
    g.fillStyle = '#2b2825';
    for (const id in nav.model.walls) {
      const wl = nav.model.walls[id];
      if ((wl.levelId ?? nav.model.levels[0].id) !== L.levelId) continue;
      const a = nav.model.nodes[wl.a], c = nav.model.nodes[wl.b];
      if (!a || !c) continue;
      const dx = c.x - a.x, dz = c.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * (wl.thickness / 2), nz = dx / len * (wl.thickness / 2);
      g.beginPath();
      g.moveTo(X(a.x + nx), Z(a.z + nz));
      g.lineTo(X(c.x + nx), Z(c.z + nz));
      g.lineTo(X(c.x - nx), Z(c.z - nz));
      g.lineTo(X(a.x - nx), Z(a.z - nz));
      g.closePath();
      g.fill();
    }

    // 4. openings punched back out of the poché, doors shown with their swing
    for (const oid in nav.model.openings) {
      const o = nav.model.openings[oid];
      const wl = nav.model.walls[o.wallId];
      if (!wl || (wl.levelId ?? nav.model.levels[0].id) !== L.levelId) continue;
      const a = nav.model.nodes[wl.a], c = nav.model.nodes[wl.b];
      if (!a || !c) continue;
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      const dx = (c.x - a.x) / len, dz = (c.z - a.z) / len;
      const nx = -dz * (wl.thickness / 2 + 0.02), nz = dx * (wl.thickness / 2 + 0.02);
      const p0x = a.x + dx * (o.offset - o.width / 2), p0z = a.z + dz * (o.offset - o.width / 2);
      const p1x = a.x + dx * (o.offset + o.width / 2), p1z = a.z + dz * (o.offset + o.width / 2);
      g.fillStyle = o.kind === 'window' ? '#dfeaf0' : '#ffffff';
      g.beginPath();
      g.moveTo(X(p0x + nx), Z(p0z + nz));
      g.lineTo(X(p1x + nx), Z(p1z + nz));
      g.lineTo(X(p1x - nx), Z(p1z - nz));
      g.lineTo(X(p0x - nx), Z(p0z - nz));
      g.closePath();
      g.fill();
      if (o.kind === 'window') {
        g.strokeStyle = '#4a4642'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(X(p0x), Z(p0z)); g.lineTo(X(p1x), Z(p1z)); g.stroke();
      }
    }
    const leafArc = (d) => {
      if (!d.hinge || !d.closedDir || !d.openDir) return;
      g.strokeStyle = 'rgba(43,40,37,0.55)';
      g.lineWidth = 1;
      const r = d.width * scale;
      const hx = X(d.hinge.x), hz = Z(d.hinge.z);
      const a0 = Math.atan2(d.closedDir.z, d.closedDir.x);
      const a1 = Math.atan2(d.openDir.z, d.openDir.x);
      g.beginPath(); g.moveTo(hx, hz); g.lineTo(hx + Math.cos(a0) * r, hz + Math.sin(a0) * r); g.stroke();
      g.beginPath();
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      g.arc(hx, hz, r, a0, a0 + da, da < 0);
      g.stroke();
    };
    for (const d of nav.doors) if (d.levelIdx === levelIdx) leafArc(d);

    // 5. labels
    if (showNames) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const r of list) {
        const a = nav.roomPoint(r.id);
        if (!a) continue;
        const label = nav.labelOf(r.id);
        g.fillStyle = '#2b2825';
        g.font = '600 12px "Inter", Helvetica, Arial, sans-serif';
        g.fillText(label.toUpperCase(), X(a.x), Z(a.z) - 7);
        g.fillStyle = '#7a736a';
        g.font = '11px ui-monospace, Menlo, monospace';
        g.fillText(`${r.area.toFixed(1)} m²`, X(a.x), Z(a.z) + 8);
      }
    }

    // 6. title block
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#2b2825';
    g.font = '600 15px "Inter", Helvetica, Arial, sans-serif';
    g.fillText(title, margin, 30);
    if (subtitle) {
      g.fillStyle = '#7a736a';
      g.font = '12px ui-monospace, Menlo, monospace';
      g.fillText(subtitle, margin, 46);
    }

    // 7. scale bar — 5 m, drawn to scale, because a plan without one is a picture
    const barY = height - 30;
    const barLen = 5 * scale;
    g.strokeStyle = '#2b2825'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(margin, barY); g.lineTo(margin + barLen, barY); g.stroke();
    for (let i = 0; i <= 5; i++) {
      const x = margin + (barLen * i) / 5;
      g.beginPath(); g.moveTo(x, barY - 4); g.lineTo(x, barY + 4); g.stroke();
    }
    g.fillStyle = '#2b2825';
    g.font = '11px ui-monospace, Menlo, monospace';
    g.fillText('0', margin - 3, barY + 18);
    g.fillText('5 m', margin + barLen - 8, barY + 18);

    // 8. north point — the compass convention of the whole game: north is -z
    const nxp = width - margin - 18, nyp = height - 46;
    g.strokeStyle = '#2b2825';
    g.beginPath(); g.moveTo(nxp, nyp + 16); g.lineTo(nxp, nyp - 14); g.stroke();
    g.beginPath();
    g.moveTo(nxp, nyp - 20); g.lineTo(nxp - 5, nyp - 8); g.lineTo(nxp + 5, nyp - 8);
    g.closePath(); g.fillStyle = '#2b2825'; g.fill();
    g.font = '600 11px "Inter", Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', nxp, nyp - 24);

    // 9. legend
    const lw = 132, lx = width - margin - lw, ly = 22;
    const grad = g.createLinearGradient(lx, 0, lx + lw, 0);
    for (let i = 0; i <= 10; i++) {
      const c = rampAt(i / 10);
      grad.addColorStop(i / 10, `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${(c[3] / 255).toFixed(2)})`);
    }
    g.fillStyle = grad;
    g.fillRect(lx, ly, lw, 9);
    g.strokeStyle = '#c9bda9'; g.lineWidth = 1;
    g.strokeRect(lx + 0.5, ly + 0.5, lw - 1, 9);
    g.fillStyle = '#7a736a';
    g.font = '10px ui-monospace, Menlo, monospace';
    g.textAlign = 'left';
    g.fillText('quiet', lx, ly + 22);
    g.textAlign = 'right';
    g.fillText('busy', lx + lw, ly + 22);

    return cv;
  }
}
