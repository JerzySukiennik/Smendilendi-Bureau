// Name pools for procedurally generated clients, companies and places.
// View-free: no imports at all. Pure data + tiny deterministic pickers.
//
// Every picker takes an `rng` — a function returning a float in [0, 1) — so the
// same seed always produces the same names.

// Polish surnames are gendered (-ski / -ska), so first names carry a gender and
// the surname is inflected to match. Getting this wrong is the first thing a
// Polish-speaking player notices.
export const FIRST_NAMES_M = [
  'Marek', 'Tomasz', 'Piotr', 'Jakub', 'Bartosz', 'Rafal', 'Kamil', 'Szymon',
  'Grzegorz', 'Wojciech', 'Filip', 'Adam', 'Henrik', 'Lars', 'Otto', 'Emile',
  'Julian', 'Roman', 'Kacper', 'Cezary', 'Borys', 'Stefan', 'Leon', 'Konrad',
  'Norbert', 'Damian', 'Gustav', 'Antoni',
];

export const FIRST_NAMES_F = [
  'Anna', 'Helena', 'Iwona', 'Zofia', 'Klara', 'Ewa', 'Maja', 'Lidia',
  'Nadia', 'Olga', 'Sara', 'Renata', 'Ingrid', 'Margit', 'Beatrix', 'Sylvie',
  'Marta', 'Dorota', 'Alicja', 'Wanda', 'Nina', 'Halina', 'Irena', 'Basia',
  'Teresa', 'Aneta', 'Weronika', 'Mirella',
];

export const FIRST_NAMES = [...FIRST_NAMES_M, ...FIRST_NAMES_F];

// Surnames that do not inflect for gender.
export const SURNAMES_FLAT = [
  'Wrona', 'Stelmach', 'Chmiel', 'Wieczorek', 'Palka', 'Zubek', 'Marchewka',
  'Kepa', 'Hoffmann', 'Lindqvist', 'Vermeer', 'Brandt', 'Novak', 'Halvorsen',
  'Reiter', 'Duval', 'Aaltonen', 'Meszaros', 'Kubiak', 'Grabowiec', 'Rzepka',
  'Molenda', 'Cieslak', 'Bugaj', 'Kolodziej', 'Piorko',
];

// Stems that take -i for a man and -a for a woman.
export const SURNAMES_STEM = [
  'Zawadzk', 'Nowick', 'Kaminsk', 'Gorsk', 'Rembowsk', 'Sadowsk', 'Lipinsk',
  'Dabrowsk', 'Fijalkowsk', 'Ostrowsk', 'Sowinsk', 'Tarnowsk', 'Baranowsk',
  'Zielinsk', 'Wachowsk', 'Poplawsk', 'Sikorsk', 'Jarock', 'Wisniewsk',
];

export const SURNAMES = [
  ...SURNAMES_FLAT,
  ...SURNAMES_STEM.map(st => st + 'i'),
];

// Two-part company names. A + B, sometimes with a legal-ish suffix.
export const COMPANY_A = [
  'Northline', 'Meadow', 'Verdant', 'Aster', 'Kestrel', 'Bright', 'Ravel',
  'Copperfield', 'Orchard', 'Halcyon', 'Lantern', 'Marram', 'Foxglove', 'Quarry',
  'Sable', 'Tern', 'Willow', 'Ironbridge', 'Sundial', 'Clearwater', 'Pinegate',
  'Basalt', 'Harrow', 'Alder',
];

export const COMPANY_B = [
  'Holdings', 'Works', 'Collective', 'Partners', 'Group', 'Trust', 'Estates',
  'Foundation', 'Institute', 'Society', 'Ventures', 'Union', 'Company', 'Guild',
];

export const COMPANY_SUFFIX = ['', '', '', ' Ltd', ' & Co.', ' Sp. z o.o.'];

export const STREETS = [
  'Kwiatowa', 'Mlynarska', 'Sosnowa', 'Dluga', 'Polna', 'Cicha', 'Nadrzeczna',
  'Ogrodowa', 'Piaskowa', 'Wiatrakowa', 'Brzozowa', 'Lipowa', 'Sadowa',
  'Kolejowa', 'Wschodnia', 'Zachodnia', 'Jaworowa', 'Bukowa', 'Klonowa',
  'Rybacka', 'Targowa', 'Rzemieslnicza', 'Wodna', 'Grabowa', 'Stawowa',
];

export const DISTRICTS = [
  'Stary Brzeg', 'Zapole', 'Nowa Huta Wschod', 'Wilcza Gora', 'Rudnik',
  'Ostrowek', 'Debina', 'Kamionka', 'Sloneczne', 'Zaborze', 'Jelonki',
  'Mokra Wies', 'Piaski Dolne', 'Wierzbowo', 'Podlesie', 'Kotlina',
];

// Trading names, keyed by building type. Used for the commission title.
export const TRADE_NAMES = {
  cafe: ['Bez Cukru', 'The Slow Kettle', 'Kawiarnia Pod Lipa', 'Fold', 'Zielona Kuchnia', 'Mora', 'Piec i Sol'],
  shop: ['Dobre Rzeczy', 'The Corner Provision', 'Nasze Ziarno', 'Cyklo', 'Papier i Nic', 'Sklep Pod Zegarem'],
  kindergarten: ['Male Jelonki', 'Kolorowa Ferajna', 'The Acorn Rooms', 'Sloneczna Grupa', 'Pod Kasztanem'],
  clinic: ['Przychodnia Zdroj', 'Vita Nova', 'Centrum Kamionka', 'Salve', 'Osrodek Debina'],
  library: ['Biblioteka Miejska', 'Czytelnia Zapole', 'The Reading Room', 'Ksiaznica Podlesie'],
  office: ['Studio Piatro', 'Kontora', 'North Wing', 'Warsztat Cyfrowy', 'Biuro Ostrowek'],
  apartment: ['Kamienica Sadowa', 'Dom Wschodni', 'The Lindens', 'Osiedle Stawowe'],
  house: ['Dom Nad Skarpa', 'Dom Zawadzkich', 'The Long House', 'Dom Pod Brzozami'],
};

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function pickPersonName(rng, avoid = []) {
  const make = () => {
    const male = rng() < 0.5;
    const first = pick(rng, male ? FIRST_NAMES_M : FIRST_NAMES_F);
    const last = rng() < 0.5
      ? pick(rng, SURNAMES_FLAT)
      : pick(rng, SURNAMES_STEM) + (male ? 'i' : 'a');
    return `${first} ${last}`;
  };
  for (let attempt = 0; attempt < 12; attempt++) {
    const name = make();
    if (!avoid.includes(name)) return name;
  }
  return make();
}

// Institutions do not trade as "Ventures". Second half of the name by type.
export const COMPANY_B_BY_TYPE = {
  clinic: ['Health Centre', 'Medical Partnership', 'Practice', 'Care Group'],
  kindergarten: ['Nursery Trust', 'Foundation', 'Education Society', 'Childcare Group'],
  library: ['Cultural Centre', 'Library Trust', 'Foundation', 'Reading Society'],
  apartment: ['Housing Cooperative', 'Estates', 'Residents Association', 'Holdings'],
  cafe: ['Kitchen Company', 'Hospitality', 'Bakery Group', 'Works'],
  shop: ['Trading Company', 'Retail', 'Provisions', 'Works'],
  office: ['Group', 'Partners', 'Works', 'Collective'],
  house: ['Group', 'Partners', 'Estates'],
};

export function pickCompany(rng, typeKey) {
  const second = COMPANY_B_BY_TYPE[typeKey] || COMPANY_B;
  return `${pick(rng, COMPANY_A)} ${pick(rng, second)}${pick(rng, COMPANY_SUFFIX)}`;
}

export function pickAddress(rng) {
  const number = 1 + Math.floor(rng() * 88);
  return `${pick(rng, STREETS)} ${number}, ${pick(rng, DISTRICTS)}`;
}

export function pickTradeName(rng, typeKey) {
  const pool = TRADE_NAMES[typeKey] || TRADE_NAMES.house;
  return pick(rng, pool);
}
