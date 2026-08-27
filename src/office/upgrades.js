// upgrades.js — two independent progression tracks.
//
// DESIGN-DECISIONS.md: "Four computer tiers, parody names ... Desks, chairs,
// lighting and plants upgrade on a SEPARATE TRACK from the computers."
//
// The two tracks are deliberately not interchangeable: the computer track buys
// capability (bigger screen, longer undo, live daylight preview, a new OS theme
// and startup sound), the studio track buys the room (better desks, better
// chairs, better light, more plants). Money is shared, so choosing is the game.
//
// Everything here is data. The office applies it; nothing in this file touches
// three.js, so the OS agent can read the same table for its themes.

export const COMPUTER_TIERS = [
  {
    tier: 1, id: 'pentagram-133', name: 'Pentagram 133',
    price: 0, blurb: 'It boots. Eventually.',
    screen: [0.545, 0.325], screenPixels: [512, 306],
    undo: 8, previewFps: 12, daylightPreview: false, bootSound: 'os.boot.1',
    grain: 0.22, cursor: 'chunky',
  },
  {
    tier: 2, id: 'kompakt-2000', name: 'Kompakt 2000',
    price: 18_000, blurb: 'Twice the RAM, half the crashes.',
    screen: [0.610, 0.360], screenPixels: [640, 378],
    undo: 24, previewFps: 24, daylightPreview: false, bootSound: 'os.boot.2',
    grain: 0.12, cursor: 'arrow',
  },
  {
    tier: 3, id: 'sunstation-pro', name: 'Sunstation Pro',
    price: 52_000, blurb: 'A workstation. It says so on the case.',
    screen: [0.700, 0.394], screenPixels: [896, 504],
    undo: 80, previewFps: 45, daylightPreview: true, bootSound: 'os.boot.3',
    grain: 0.05, cursor: 'precision',
  },
  {
    tier: 4, id: 'melon-studio-m5', name: 'Melon Studio M5',
    price: 128_000, blurb: 'Silent, thin, and worth a junior architect a year.',
    screen: [0.800, 0.450], screenPixels: [1024, 576],
    undo: 250, previewFps: 60, daylightPreview: true, bootSound: 'os.boot.4',
    grain: 0.0, cursor: 'precision',
  },
];

export const STUDIO_TIERS = [
  {
    tier: 1, name: 'Second-hand fit-out', price: 0,
    blurb: 'Melamine tops, borrowed chairs, one working ceiling light.',
    deskTop: 0xc9c3b8, deskEdge: 0x9c968b, chairFabric: 0x6c655c,
    pendants: 2, deskLamps: 0, plants: 1, rug: false, lampWarmth: 0xffd7a8,
  },
  {
    tier: 2, name: 'Proper desks', price: 14_000,
    blurb: 'Oak-veneer tops on steel frames, and a chair that adjusts.',
    deskTop: 0xd8c9b1, deskEdge: 0xb4a68e, chairFabric: 0x6c655c,
    pendants: 3, deskLamps: 2, plants: 2, rug: true, lampWarmth: 0xffd7a8,
  },
  {
    tier: 3, name: 'Lit like a studio', price: 33_000,
    blurb: 'Task lighting at every desk, warm pendants, and a rug you would keep.',
    deskTop: 0xd8c9b1, deskEdge: 0xb4a68e, chairFabric: 0x55504a,
    pendants: 5, deskLamps: 3, plants: 4, rug: true, lampWarmth: 0xffcf9a,
  },
  {
    tier: 4, name: 'Somewhere clients notice', price: 76_000,
    blurb: 'Solid tops, a planted corner, and light you could photograph.',
    deskTop: 0xdccfba, deskEdge: 0xb4a68e, chairFabric: 0x3a3835,
    pendants: 5, deskLamps: 3, plants: 6, rug: true, lampWarmth: 0xffc98c,
  },
];

export const EMPLOYEE_TIERS = [
  {
    id: 'intern', name: 'Intern', hire: 3_000, salary: 4_000,
    blurb: 'Fast, keen, and will put a bathroom door where a wardrobe goes.',
    speed: 1.35, errorRate: 0.34, quality: 0.55,
  },
  {
    id: 'architect', name: 'Architect', hire: 9_000, salary: 12_000,
    blurb: 'Solid. Draws what the brief says and asks when it does not.',
    speed: 1.0, errorRate: 0.10, quality: 0.82,
  },
  {
    id: 'partner', name: 'Partner', hire: 22_000, salary: 26_000,
    blurb: 'Expensive, opinionated, and right often enough to justify both.',
    speed: 0.85, errorRate: 0.03, quality: 0.96,
  },
];

export function computerTier(n) {
  return COMPUTER_TIERS[Math.min(COMPUTER_TIERS.length, Math.max(1, n | 0)) - 1];
}
export function studioTier(n) {
  return STUDIO_TIERS[Math.min(STUDIO_TIERS.length, Math.max(1, n | 0)) - 1];
}
export function employeeTier(id) {
  return EMPLOYEE_TIERS.find((t) => t.id === id) || EMPLOYEE_TIERS[0];
}

/**
 * Upgrades — the two ladders plus the money rules that connect them.
 * `onChange(track, tier, spec)` fires after a successful purchase so the office
 * can restyle itself without this module knowing what a Mesh is.
 */
export class Upgrades {
  constructor(state, economy, opts = {}) {
    this.state = state;
    this.economy = economy;
    this.computer = state?.get('office.computerTier') || 1;
    this.studio = state?.get('office.tier') || 1;
    this.onChange = opts.onChange || null;
    this._sync();
  }

  _sync() {
    this.state?.set('office.computerTier', this.computer);
    this.state?.set('office.tier', this.studio);
  }

  next(track) {
    const list = track === 'computer' ? COMPUTER_TIERS : STUDIO_TIERS;
    const cur = track === 'computer' ? this.computer : this.studio;
    return cur >= list.length ? null : list[cur];      // list is 0-based, cur is 1-based
  }

  /** @returns {{ ok:boolean, reason?:string, spec?:object }} */
  buy(track) {
    const spec = this.next(track);
    if (!spec) return { ok: false, reason: 'Already on the top tier.' };
    if (!this.economy.canAfford(spec.price)) {
      return { ok: false, reason: `Needs ${this.economy.format(spec.price)}, the bank has ${this.economy.format()}.` };
    }
    this.economy.debit(spec.price, `${track === 'computer' ? 'Computers' : 'Studio'}: ${spec.name}`);
    if (track === 'computer') this.computer = spec.tier; else this.studio = spec.tier;
    this._sync();
    this.onChange?.(track, spec.tier, spec);
    return { ok: true, spec };
  }

  get computerSpec() { return computerTier(this.computer); }
  get studioSpec() { return studioTier(this.studio); }
}
