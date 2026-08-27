// Quantities off the model, then money.
//
// A real bill of quantities: every line carries the measured quantity, its
// unit, the rate it was priced at and the extension, so the player can see
// which decision cost what. Rates come from the catalogue —
// STRUCTURE_PRICES for the carcass, MATERIAL_PRICES for the finishes,
// CATALOG[..].price for every door, window and piece of furniture.
//
// Walls are measured per m² of elevation (length x storey height) net of
// openings; slabs per m² on plan; finishes per m² of face.

import { DEFAULT_SLAB_THICKNESS, wallLength } from '../model/building.js';
import { polygonArea, r2, r0 } from './geom.js';
import {
  entryOf, materialRate, materialName, structureRate, slabRate, foundationRate, pretty,
} from './catalogue.js';
import { makeIssue } from './issues.js';

export const CONTINGENCY = 0.06;
export const CEILING_FINISH_RATE = 85;        // plastered and painted soffit, per m²
export const FALLBACK_DOOR_PRICE = 1500;      // leaf, frame and ironmongery
export const FALLBACK_WINDOW_RATE_M2 = 900;
export const FALLBACK_OPENING_PRICE = 350;    // structural opening, lintel only

const TRADE_ORDER = ['Structure', 'Finishes', 'Openings', 'Services', 'Furniture', 'Contingency'];

// Heating, sanitary, electrics and ventilation, per m2 of floor. No bill of
// quantities for a building omits them, and leaving them out here put the whole
// engine roughly 25 % below the budget the commission generator writes from an
// all-in rate per m2 — so every correctly costed scheme drew a permanent
// "you have money left over" complaint. Rates are per building type because a
// clinic and a shop are not remotely the same job.
export const SERVICES_RATE = {
  house: 1100, apartment: 1150, office: 1250, retail: 950,
  cafe: 1500, kindergarten: 1350, library: 1200, clinic: 1900,
  _default: 1200,
};

export function servicesRate(brief) {
  const key = String(brief?.buildingType ?? brief?.type ?? '').toLowerCase();
  return SERVICES_RATE[key] ?? SERVICES_RATE._default;
}

function line(bill, trade, item, qty, unit, rate) {
  if (!(qty > 1e-6) || !Number.isFinite(rate)) return;
  bill.push({ trade, item, qty: r2(qty), unit, rate: r2(rate), total: r0(qty * rate) });
}

export function quantities(model) {
  const levelById = new Map(model.levels.map(l => [l.id, l]));
  const wallArea = {};            // wall type -> net m² of elevation
  const faceArea = {};            // material -> m² of finished face
  const openings = {};            // catalogId | generic-kind -> { count, area, kind }
  const furnitureCount = {};      // catalogId -> count
  const slabArea = { floor: 0, roof: 0 };
  const floorFinish = {};         // material -> m²
  let grossWallArea = 0;
  let openingsArea = 0;

  for (const id in model.walls) {
    const w = model.walls[id];
    const level = levelById.get(w.levelId) ?? model.levels[0];
    const gross = wallLength(model, w) * level.height;
    let holes = 0;
    for (const oid of w.openings) {
      const o = model.openings[oid];
      if (o) holes += o.width * o.height;
    }
    const net = Math.max(0, gross - holes);
    grossWallArea += gross;
    openingsArea += Math.min(holes, gross);
    wallArea[w.type] = (wallArea[w.type] ?? 0) + net;
    faceArea[w.matInner] = (faceArea[w.matInner] ?? 0) + net;
    faceArea[w.matOuter] = (faceArea[w.matOuter] ?? 0) + net;
  }

  for (const id in model.slabs) {
    const s = model.slabs[id];
    const a = polygonArea(s.polygon);
    const kind = s.kind === 'roof' ? 'roof' : 'floor';
    slabArea[kind] += a;
    if (kind === 'floor') floorFinish[s.mat] = (floorFinish[s.mat] ?? 0) + a;
  }

  // Openings are grouped by catalogue item AND drawn size. A window stretched
  // in the editor is no longer the item in the palette, and a bill that still
  // charged its palette price let the player double his glazing for nothing.
  // Distinct sizes are distinct lines, which is how a real bill reads anyway.
  for (const id in model.openings) {
    const o = model.openings[id];
    const w = r2(o.width), h = r2(o.height);
    const key = `${o.catalogId ?? `generic-${o.kind}`}|${w}x${h}`;
    const rec = openings[key] ?? (openings[key] = {
      count: 0, area: 0, kind: o.kind, catalogId: o.catalogId, width: w, height: h,
    });
    rec.count += 1;
    rec.area += o.width * o.height;
  }

  for (const id in model.furniture) {
    const cid = model.furniture[id].catalogId;
    furnitureCount[cid] = (furnitureCount[cid] ?? 0) + 1;
  }

  return {
    wallArea, faceArea, openings, furnitureCount, slabArea, floorFinish,
    grossWallArea, openingsArea,
    slabVolume: (slabArea.floor + slabArea.roof) * DEFAULT_SLAB_THICKNESS,
  };
}

export function billOfQuantities(model, ctx) {
  const q = quantities(model);
  const bill = [];

  for (const type of ['exterior', 'interior', 'party']) {
    line(bill, 'Structure', `${type} wall carcass`, q.wallArea[type] ?? 0, 'm² elev.', structureRate(type));
  }
  line(bill, 'Structure', 'floor slab', q.slabArea.floor, 'm² plan', slabRate('floor'));
  line(bill, 'Structure', 'roof structure and covering', q.slabArea.roof, 'm² plan', slabRate('roof'));
  line(bill, 'Structure', 'foundations', q.slabArea.floor, 'm² plan', foundationRate());

  for (const mat in q.faceArea) {
    line(bill, 'Finishes', `${materialName(mat)} finish to walls`, q.faceArea[mat], 'm²', materialRate(mat));
  }
  for (const mat in q.floorFinish) {
    line(bill, 'Finishes', `${materialName(mat)} floor finish`, q.floorFinish[mat], 'm²', materialRate(mat));
  }
  // Ceilings are measured off the derived rooms — that is the real soffit area,
  // the slab includes the thickness under the external walls.
  const ceiling = ctx?.topo ? ctx.topo.rooms.reduce((s, r) => s + r.area, 0) : q.slabArea.floor;
  line(bill, 'Finishes', 'plastered and painted ceilings', ceiling, 'm²', CEILING_FINISH_RATE);

  for (const key in q.openings) {
    const rec = q.openings[key];
    if (rec.catalogId) {
      const e = entryOf(rec.catalogId);
      const catArea = (e.size?.[0] ?? 0) * (e.size?.[1] ?? 0);
      const drawn = rec.width * rec.height;
      // Drawn to the catalogue size: buy the item. Drawn to anything else: it
      // is a made-to-measure unit, priced at the same rate per m² of opening.
      if (catArea > 0.01 && Math.abs(drawn - catArea) / catArea > 0.02) {
        line(bill, 'Openings', `${e.name}, made to ${rec.width} x ${rec.height} m`,
          rec.area, 'm²', e.price / catArea);
      } else {
        line(bill, 'Openings', e.name, rec.count, 'no.', e.price);
      }
    } else if (rec.kind === 'door') {
      line(bill, 'Openings', 'door, leaf frame and ironmongery', rec.count, 'no.', FALLBACK_DOOR_PRICE);
    } else if (rec.kind === 'window') {
      line(bill, 'Openings', 'window, glazed unit and frame', rec.area, 'm²', FALLBACK_WINDOW_RATE_M2);
    } else {
      line(bill, 'Openings', 'structural opening with lintel', rec.count, 'no.', FALLBACK_OPENING_PRICE);
    }
  }

  // Services, measured off the derived rooms — the floor area people occupy,
  // not the slab, which includes the ground under the external walls.
  const servicedArea = ctx?.topo ? ctx.topo.rooms.reduce((s, r) => s + r.area, 0) : q.slabArea.floor;
  line(bill, 'Services', 'heating, sanitary, electrics and ventilation',
    servicedArea, 'm²', servicesRate(ctx?.brief));

  for (const id in q.furnitureCount) {
    const e = entryOf(id);
    line(bill, 'Furniture', e.name ?? pretty(id), q.furnitureCount[id], 'no.', e.price);
  }

  const subtotals = {};
  for (const l of bill) subtotals[l.trade] = (subtotals[l.trade] ?? 0) + l.total;
  const net = Object.values(subtotals).reduce((a, b) => a + b, 0);
  const contingency = Math.round(net * CONTINGENCY);
  bill.push({
    trade: 'Contingency', item: `contingency at ${Math.round(CONTINGENCY * 100)}%`,
    qty: 1, unit: 'sum', rate: contingency, total: contingency,
  });
  subtotals.Contingency = contingency;

  bill.sort((a, b) => TRADE_ORDER.indexOf(a.trade) - TRADE_ORDER.indexOf(b.trade)
    || b.total - a.total || a.item.localeCompare(b.item));

  return { bill, subtotals, net, contingency, total: net + contingency, quantities: q };
}

export function analyzeCost(ctx) {
  const { model, brief } = ctx;
  const issues = [];
  const boq = billOfQuantities(model, ctx);
  const budget = Number.isFinite(brief?.budget) ? brief.budget : null;

  const topTrade = Object.entries(boq.subtotals)
    .filter(([t]) => t !== 'Contingency')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['Structure', 0];

  const floorArea = boq.quantities.slabArea.floor
    || (ctx.topo ? ctx.topo.rooms.reduce((s, r) => s + r.area, 0) : 0);

  const metrics = {
    total: boq.total,
    net: boq.net,
    contingency: boq.contingency,
    subtotals: boq.subtotals,
    budget,
    bill: boq.bill,
    quantities: {
      grossWallArea: r2(boq.quantities.grossWallArea),
      openingsArea: r2(boq.quantities.openingsArea),
      slabAreaFloor: r2(boq.quantities.slabArea.floor),
      slabAreaRoof: r2(boq.quantities.slabArea.roof),
      slabVolume: r2(boq.quantities.slabVolume),
      floorArea: r2(floorArea),
    },
    costPerM2: r0(boq.total / Math.max(1, floorArea)),
  };

  if (budget) {
    const overrun = boq.total - budget;
    const overrunPct = (overrun / budget) * 100;
    metrics.overrunPct = r2(overrunPct);
    if (overrun > 0) {
      issues.push(makeIssue('COST_OVER_BUDGET', {
        measured: boq.total, required: budget, overrunPct,
        topTrade: topTrade[0].toLowerCase(), topTradeTotal: topTrade[1],
      }));
    } else if (boq.total < budget * 0.75) {
      issues.push(makeIssue('COST_UNDER_SPENT', {
        measured: boq.total, required: budget,
        underPct: ((budget - boq.total) / budget) * 100,
      }));
    }
  }

  return { issues, metrics };
}
