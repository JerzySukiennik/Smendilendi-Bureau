// roles.js — who lives in the building, and what their day looks like.
//
// VIEW-FREE. Plain data plus pure functions; no three.js, no DOM. The whole
// point of this file is that the population of a building is a consequence of
// what the building IS, not a decoration: a kindergarten gets children,
// teachers and a cook; a clinic gets patients, a receptionist, nurses and
// doctors; an office gets staff and visitors; a house gets a family.
//
// A schedule here is a real daily pattern, not a random walk. Each role has an
// arrival window, a departure window, and a set of TIME BANDS; inside a band
// the role's goals carry weights. When a person finishes what they were doing
// they draw a new goal from the band that covers the current clock time. On top
// of that sit two NEEDS that build up on their own clock — the WC and a hot
// drink — because those two are what actually generate the circulation load an
// architect gets judged on.
//
// Units: hours as decimals (8.5 = 08:30), minutes for dwell times, m/s for
// walking speed, metres for stature. Adult stature 1.72 m and 1.35 m/s are the
// figures used for corridor design; a child of nursery age is 1.05 m and walks
// at about 0.85 m/s, which is why a nursery corridor fills up so fast.

// ---------------------------------------------------------------------------
// 1. Goals. A goal resolves to a ROOM KIND from src/analysis/classify.js, in
//    order of preference. The first kind that exists in the player's building
//    wins. If NONE of them exists, the journey fails before it starts and the
//    statistics record it — "there is nowhere in this building to make tea" is
//    a finding, not a bug.

// `assigned: true` means this goal belongs to a PARTICULAR room, chosen once
// per person and kept: a child belongs to a group, a member of staff has a
// desk, a resident has a bedroom. Without it every distance field is
// multi-source and everybody walks to the nearest instance, so one group room
// fills up and the other two are never entered — which then shows up in the
// report as "least-used room: Group room 1, never entered" and blames the
// architect for a bug in the simulation.
export const GOALS = {
  arrive: {
    label: 'arriving', icon: 'door', dwell: [1, 2],
    rooms: ['hall', 'reception', 'waiting', 'corridor', 'retail', 'cafe'],
  },
  leave: {
    label: 'going home', icon: 'door', dwell: [0, 0],
    rooms: ['__outside'],
  },
  wc: {
    label: 'needs the WC', icon: 'wc', dwell: [3, 6],
    rooms: ['wc', 'bathroom'],
  },
  coffee: {
    label: 'wants a coffee', icon: 'cup', dwell: [4, 12],
    rooms: ['breakout', 'kitchen', 'staffroom', 'cafe'],
  },
  desk: {
    label: 'at their desk', icon: 'desk', dwell: [25, 75], assigned: true,
    rooms: ['office', 'study', 'staffroom'],
  },
  meeting: {
    label: 'in a meeting', icon: 'talk', dwell: [20, 50],
    rooms: ['meeting', 'focus', 'office'],
  },
  classroom: {
    label: 'in the group room', icon: 'star', dwell: [20, 55], assigned: true,
    rooms: ['classroom', 'playroom'],
  },
  nap: {
    label: 'nap time', icon: 'sleep', dwell: [30, 60], assigned: true,
    rooms: ['playroom', 'classroom', 'sickroom'],
  },
  play: {
    label: 'playing', icon: 'star', dwell: [10, 30], assigned: true,
    rooms: ['playroom', 'hall', 'classroom'],
  },
  staff: {
    label: 'in the staff room', icon: 'cup', dwell: [10, 25],
    rooms: ['staffroom', 'breakout', 'office'],
  },
  reception: {
    label: 'at reception', icon: 'talk', dwell: [15, 60],
    rooms: ['reception', 'hall', 'waiting'],
  },
  waiting: {
    label: 'waiting to be seen', icon: 'clock', dwell: [8, 30],
    rooms: ['waiting', 'hall', 'corridor'],
  },
  consult: {
    label: 'in the consulting room', icon: 'talk', dwell: [10, 25], assigned: true,
    rooms: ['ward', 'sickroom', 'office'],
  },
  treat: {
    label: 'treating a patient', icon: 'talk', dwell: [12, 30], assigned: true,
    rooms: ['ward', 'sickroom'],
  },
  read: {
    label: 'reading', icon: 'book', dwell: [20, 60], assigned: true,
    rooms: ['reading', 'study', 'living'],
  },
  browse: {
    label: 'browsing', icon: 'star', dwell: [4, 14], assigned: true,
    rooms: ['retail', 'reading', 'cafe'],
  },
  till: {
    label: 'at the till', icon: 'talk', dwell: [2, 5],
    rooms: ['counter', 'reception', 'retail'],
  },
  serve: {
    label: 'serving', icon: 'cup', dwell: [6, 18],
    rooms: ['counter', 'cafe', 'kitchen'],
  },
  cook: {
    label: 'in the kitchen', icon: 'cup', dwell: [20, 60],
    rooms: ['kitchen'],
  },
  eat: {
    label: 'eating', icon: 'cup', dwell: [15, 45],
    rooms: ['cafe', 'dining', 'kitchen', 'breakout'],
  },
  living: {
    label: 'in the living room', icon: 'star', dwell: [20, 70], assigned: true,
    rooms: ['living', 'dining'],
  },
  bedroom: {
    label: 'in their room', icon: 'sleep', dwell: [20, 90], assigned: true,
    rooms: ['bedroom', 'study'],
  },
  store: {
    label: 'fetching something', icon: 'box', dwell: [2, 6],
    rooms: ['store', 'archive', 'utility', 'delivery'],
  },
  utility: {
    label: 'doing the laundry', icon: 'box', dwell: [6, 15],
    rooms: ['utility', 'kitchen', 'store'],
  },
  clean: {
    label: 'cleaning', icon: 'box', dwell: [4, 10],
    rooms: ['corridor', 'hall', 'wc', 'office'],
  },
  deliver: {
    label: 'delivering', icon: 'box', dwell: [2, 5],
    rooms: ['delivery', 'store', 'reception', 'hall'],
  },
};

export const GOAL_KEYS = Object.keys(GOALS);

// ---------------------------------------------------------------------------
// 2. Appearance. Flat low-poly people: a coat colour, trousers, skin, hair.
//    Kept out of palette.js on purpose — these are the only hex values in the
//    game that are not architectural surfaces, and they belong to the people.

export const SKIN_TONES = [0xf0cdb0, 0xe3b48f, 0xc98f68, 0xa16b45, 0x7a4c30, 0x5a3722];
export const HAIR_TONES = [0x2b2825, 0x4a3527, 0x6d4b2c, 0x9a7440, 0xc9b083, 0x8d8880, 0xe8ddcd];

// ---------------------------------------------------------------------------
// 3. Role definitions.
//
//   count(params)  how many of this role the building holds. `params` is the
//                  commission's own params block (bedrooms, children, seats,
//                  staff, beds…), so the population follows the brief.
//   day            time bands, each { from, to, goals: {goalKey: weight} }
//   arrive/leave   [earliest, latest] hour; each person draws once, so a school
//                  does not have twenty people walking through the door in the
//                  same second.
//   needs          per-hour probability weights for the two involuntary goals.
//   topUp          how readily this role absorbs a shortfall when the head
//                  count has to be raised (see buildPopulation). 0 = never.
//                  A busier building has more visitors, more children and more
//                  patients; it does not have more of whichever role happened
//                  to be the largest, which is how a three-bedroom family house
//                  ended up with FOUR PARENTS — and with twenty-four of them at
//                  the thirty-person load case.
//   maxCount       hard ceiling on this role, whatever else is asked for. Two
//                  parents is two parents.

const ADULT = { height: 1.72, speed: 1.35, adult: true };
const CHILD = { height: 1.05, speed: 0.85, adult: false, child: true };
const TEEN = { height: 1.55, speed: 1.30, adult: false };
const ELDER = { height: 1.66, speed: 0.95, adult: true, elder: true };

function role(key, label, base, extra) {
  return {
    key, label,
    ...base,
    needs: { wc: 1.0, coffee: 1.0 },
    arrive: [8.0, 9.0],
    leave: [16.5, 18.0],
    topUp: 0,
    maxCount: Infinity,
    ...extra,
  };
}

// -- house ------------------------------------------------------------------

const HOUSE_ROLES = [
  role('parent', 'Parent', ADULT, {
    cloth: 0x35566e, count: () => 2, resident: true, maxCount: 2,
    arrive: [6.8, 7.4], leave: [21.5, 22.5],
    day: [
      { from: 6.5, to: 8.5, goals: { eat: 4, wc: 3, bedroom: 2, living: 1 } },
      { from: 8.5, to: 16.0, goals: { desk: 3, utility: 2, living: 3, store: 1, eat: 2 } },
      { from: 16.0, to: 19.0, goals: { eat: 4, living: 4, utility: 2, bedroom: 1 } },
      { from: 19.0, to: 23.0, goals: { living: 5, eat: 2, bedroom: 3, wc: 1 } },
    ],
  }),
  role('child', 'Child', CHILD, {
    cloth: 0xd4763a, count: (p) => Math.max(1, (p.bedrooms ?? 3) - 1), resident: true,
    topUp: 2, maxCount: 5,
    arrive: [7.0, 7.6], leave: [21.0, 21.6],
    day: [
      { from: 6.5, to: 8.0, goals: { eat: 4, wc: 3, bedroom: 3 } },
      { from: 8.0, to: 15.0, goals: { bedroom: 3, living: 3, play: 2 } },
      { from: 15.0, to: 20.0, goals: { play: 4, living: 4, bedroom: 3, eat: 2 } },
      { from: 20.0, to: 23.0, goals: { bedroom: 6, wc: 2 } },
    ],
  }),
  role('grandparent', 'Grandparent', ELDER, {
    cloth: 0x7a6b8a, count: () => 1, visitor: true, topUp: 1, maxCount: 4,
    arrive: [11.0, 12.5], leave: [18.0, 19.5],
    day: [
      { from: 10.0, to: 20.0, goals: { living: 5, eat: 3, wc: 2, bedroom: 1 } },
    ],
  }),
  role('friend', 'Visiting friend', TEEN, {
    cloth: 0x476b4a, count: () => 2, visitor: true, topUp: 3, maxCount: 14,
    arrive: [14.0, 16.5], leave: [18.0, 19.5],
    day: [
      { from: 13.0, to: 20.0, goals: { play: 4, bedroom: 3, living: 3, wc: 1, eat: 1 } },
    ],
  }),
  role('courier', 'Courier', ADULT, {
    cloth: 0xb2472e, count: () => 1, visitor: true, maxCount: 2,
    arrive: [10.0, 15.0], leave: [10.2, 15.2], stay: [4, 8],
    day: [{ from: 6.0, to: 22.0, goals: { deliver: 5, arrive: 1 } }],
  }),
];

// -- kindergarten -----------------------------------------------------------

const KINDERGARTEN_ROLES = [
  role('nurseryChild', 'Child', CHILD, {
    cloth: 0xc9a227, count: (p) => Math.min(18, p.children ?? 24),
    topUp: 3, maxCount: 24,
    arrive: [7.2, 8.6], leave: [15.0, 16.8],
    needs: { wc: 2.6, coffee: 0 },
    day: [
      { from: 7.0, to: 9.0, goals: { play: 5, arrive: 2, wc: 2 } },
      { from: 9.0, to: 11.5, goals: { classroom: 6, play: 3, wc: 3 } },
      { from: 11.5, to: 12.5, goals: { eat: 6, wc: 2 } },
      { from: 12.5, to: 14.0, goals: { nap: 7, wc: 2 } },
      { from: 14.0, to: 17.0, goals: { play: 6, classroom: 3, wc: 2 } },
    ],
  }),
  role('teacher', 'Teacher', ADULT, {
    cloth: 0x3f7a76, count: (p) => Math.max(2, Math.ceil((p.children ?? 24) / 12)),
    topUp: 1, maxCount: 6,
    arrive: [6.8, 7.4], leave: [16.0, 17.2],
    day: [
      { from: 6.5, to: 9.0, goals: { classroom: 4, staff: 3, coffee: 2 } },
      { from: 9.0, to: 12.0, goals: { classroom: 7, wc: 1, store: 1 } },
      { from: 12.0, to: 14.0, goals: { eat: 4, classroom: 3, staff: 2 } },
      { from: 14.0, to: 17.5, goals: { classroom: 5, play: 3, staff: 2, coffee: 1 } },
    ],
  }),
  role('cook', 'Cook', ADULT, {
    cloth: 0xe8ddcd, count: () => 1, maxCount: 2,
    arrive: [6.2, 6.8], leave: [14.5, 15.5],
    day: [
      { from: 6.0, to: 11.0, goals: { cook: 7, store: 3 } },
      { from: 11.0, to: 13.0, goals: { cook: 5, eat: 3, deliver: 1 } },
      { from: 13.0, to: 16.0, goals: { cook: 4, store: 2, staff: 2, coffee: 1 } },
    ],
  }),
  role('parentDropoff', 'Parent', ADULT, {
    cloth: 0x8d7f6c, count: () => 4, visitor: true, topUp: 2, maxCount: 8,
    arrive: [7.4, 8.8], leave: [7.7, 9.2], stay: [4, 10],
    day: [{ from: 6.0, to: 18.0, goals: { arrive: 3, classroom: 4, reception: 2 } }],
  }),
];

// -- office -----------------------------------------------------------------

const OFFICE_ROLES = [
  role('staff', 'Member of staff', ADULT, {
    cloth: 0x55504a, count: (p) => Math.min(20, Math.max(8, p.staff ?? 16)),
    topUp: 3, maxCount: 24,
    arrive: [7.8, 9.4], leave: [16.4, 18.4],
    day: [
      { from: 7.5, to: 10.0, goals: { desk: 7, coffee: 3, meeting: 1 } },
      { from: 10.0, to: 12.0, goals: { desk: 6, meeting: 3, coffee: 2, wc: 1 } },
      { from: 12.0, to: 13.5, goals: { eat: 5, coffee: 3, desk: 2 } },
      { from: 13.5, to: 17.0, goals: { desk: 6, meeting: 3, coffee: 2, store: 1 } },
      { from: 17.0, to: 19.0, goals: { desk: 4, leave: 2 } },
    ],
  }),
  role('receptionistOffice', 'Receptionist', ADULT, {
    cloth: 0xd4763a, count: () => 1, maxCount: 2,
    arrive: [7.6, 8.0], leave: [16.6, 17.2],
    day: [{ from: 7.0, to: 18.0, goals: { reception: 8, coffee: 2, wc: 1, store: 1 } }],
  }),
  role('visitor', 'Visitor', ADULT, {
    cloth: 0x9d5f38, count: () => 4, visitor: true, topUp: 2, maxCount: 10,
    arrive: [9.5, 15.5], leave: [10.5, 16.5], stay: [25, 60],
    day: [{ from: 8.0, to: 18.0, goals: { reception: 2, meeting: 6, coffee: 2, wc: 1 } }],
  }),
  role('cleaner', 'Cleaner', ADULT, {
    cloth: 0x476b4a, count: () => 1, maxCount: 2,
    arrive: [6.4, 6.9], leave: [17.5, 18.5],
    day: [{ from: 6.0, to: 19.0, goals: { clean: 6, store: 3, wc: 1, coffee: 1 } }],
  }),
];

// -- clinic -----------------------------------------------------------------

const CLINIC_ROLES = [
  role('patient', 'Patient', ADULT, {
    cloth: 0xbfae95, count: (p) => Math.min(14, Math.max(8, (p.consultingRooms ?? 4) * 3)), visitor: true,
    topUp: 3, maxCount: 18,
    arrive: [8.0, 16.0], leave: [8.6, 16.8], stay: [25, 55],
    day: [{ from: 7.0, to: 18.0, goals: { reception: 2, waiting: 6, consult: 5, wc: 2 } }],
  }),
  role('receptionistClinic', 'Receptionist', ADULT, {
    cloth: 0x3f7a76, count: () => 1, maxCount: 2,
    arrive: [7.4, 7.9], leave: [17.5, 18.2],
    day: [{ from: 7.0, to: 19.0, goals: { reception: 8, coffee: 2, wc: 1 } }],
  }),
  role('nurse', 'Nurse', ADULT, {
    cloth: 0x86a6c9, count: (p) => Math.max(2, Math.ceil((p.consultingRooms ?? 4) / 2)),
    topUp: 1, maxCount: 6,
    arrive: [7.2, 7.8], leave: [16.8, 17.6],
    day: [
      { from: 7.0, to: 12.0, goals: { treat: 6, store: 2, waiting: 2, coffee: 1 } },
      { from: 12.0, to: 13.5, goals: { staff: 4, eat: 3, treat: 2 } },
      { from: 13.5, to: 18.0, goals: { treat: 6, store: 2, wc: 1, coffee: 1 } },
    ],
  }),
  role('doctor', 'Doctor', ADULT, {
    cloth: 0xf3ece1, count: (p) => Math.max(2, p.consultingRooms ?? 4),
    topUp: 1, maxCount: 8,
    arrive: [7.8, 8.4], leave: [17.0, 18.0],
    day: [
      { from: 7.5, to: 12.5, goals: { consult: 8, treat: 2, coffee: 1 } },
      { from: 12.5, to: 13.5, goals: { staff: 5, eat: 3, coffee: 2 } },
      { from: 13.5, to: 18.0, goals: { consult: 8, treat: 2, wc: 1 } },
    ],
  }),
  role('cleanerClinic', 'Cleaner', ADULT, {
    cloth: 0x476b4a, count: () => 1, maxCount: 2,
    arrive: [6.4, 6.9], leave: [17.5, 18.5],
    day: [{ from: 6.0, to: 19.0, goals: { clean: 6, store: 3, wc: 1 } }],
  }),
];

// -- library ----------------------------------------------------------------

const LIBRARY_ROLES = [
  role('reader', 'Reader', ADULT, {
    cloth: 0x7a6b8a, count: () => 10, visitor: true, topUp: 3, maxCount: 18,
    arrive: [9.0, 16.0], leave: [10.0, 17.5], stay: [35, 90],
    day: [{ from: 8.0, to: 19.0, goals: { read: 7, browse: 4, wc: 1, coffee: 1 } }],
  }),
  role('studentReader', 'Student', TEEN, {
    cloth: 0x35566e, count: () => 4, visitor: true, topUp: 2, maxCount: 10,
    arrive: [13.0, 16.0], leave: [15.0, 18.0], stay: [50, 110],
    day: [{ from: 12.0, to: 19.0, goals: { read: 8, browse: 3, wc: 1 } }],
  }),
  role('librarian', 'Librarian', ADULT, {
    cloth: 0x3f7a76, count: () => 3, maxCount: 4,
    arrive: [8.2, 8.8], leave: [17.4, 18.4],
    day: [{ from: 8.0, to: 19.0, goals: { reception: 5, browse: 3, store: 2, coffee: 2, wc: 1 } }],
  }),
  role('libraryChild', 'Child', CHILD, {
    cloth: 0xd4763a, count: () => 3, visitor: true, topUp: 1, maxCount: 6,
    arrive: [15.0, 16.5], leave: [16.5, 18.0], stay: [40, 70],
    needs: { wc: 2.4, coffee: 0 },
    day: [{ from: 14.0, to: 19.0, goals: { read: 4, browse: 5, play: 3, wc: 2 } }],
  }),
];

// -- cafe -------------------------------------------------------------------

const CAFE_ROLES = [
  role('guest', 'Guest', ADULT, {
    cloth: 0x8d7f6c, count: (p) => Math.min(16, Math.max(8, Math.round((p.seats ?? 40) / 3))), visitor: true,
    topUp: 3, maxCount: 20,
    arrive: [8.5, 19.0], leave: [9.5, 20.0], stay: [30, 70],
    day: [{ from: 8.0, to: 21.0, goals: { eat: 7, till: 2, wc: 2 } }],
  }),
  role('waiter', 'Waiter', ADULT, {
    cloth: 0x2f2c29, count: (p) => Math.max(2, Math.ceil((p.seats ?? 40) / 20)),
    topUp: 1, maxCount: 6,
    arrive: [7.6, 8.2], leave: [19.5, 21.0],
    day: [{ from: 7.5, to: 21.5, goals: { serve: 6, till: 3, cook: 2, store: 1, wc: 1 } }],
  }),
  role('chef', 'Chef', ADULT, {
    cloth: 0xf3ece1, count: () => 2, maxCount: 3,
    arrive: [6.6, 7.2], leave: [19.5, 20.5],
    day: [{ from: 6.5, to: 21.0, goals: { cook: 8, store: 2, wc: 1, coffee: 1 } }],
  }),
  role('barista', 'Barista', ADULT, {
    cloth: 0x9d5f38, count: () => 1, maxCount: 2,
    arrive: [6.8, 7.4], leave: [17.5, 18.5],
    day: [{ from: 6.5, to: 19.0, goals: { serve: 6, till: 4, store: 1 } }],
  }),
];

// -- shop -------------------------------------------------------------------

const SHOP_ROLES = [
  role('shopper', 'Shopper', ADULT, {
    cloth: 0x8d7f6c, count: () => 12, visitor: true, topUp: 3, maxCount: 20,
    arrive: [9.0, 18.0], leave: [9.3, 18.4], stay: [8, 22],
    day: [{ from: 8.0, to: 20.0, goals: { browse: 7, till: 3, wc: 1 } }],
  }),
  role('cashier', 'Cashier', ADULT, {
    cloth: 0xd4763a, count: () => 2, maxCount: 4,
    arrive: [8.4, 8.9], leave: [18.4, 19.2],
    day: [{ from: 8.0, to: 20.0, goals: { till: 8, browse: 2, coffee: 1, wc: 1 } }],
  }),
  role('stockStaff', 'Stock assistant', ADULT, {
    cloth: 0x55504a, count: () => 2, topUp: 1, maxCount: 4,
    arrive: [7.4, 8.0], leave: [16.5, 17.5],
    day: [{ from: 7.0, to: 18.0, goals: { store: 5, browse: 4, deliver: 2, coffee: 1 } }],
  }),
];

// -- apartment building -----------------------------------------------------

const APARTMENT_ROLES = [
  role('resident', 'Resident', ADULT, {
    cloth: 0x35566e, count: (p) => Math.min(18, Math.max(10, (p.flats ?? 8) * 2)), resident: true,
    topUp: 3, maxCount: 22,
    arrive: [6.6, 8.6], leave: [17.0, 20.0],
    day: [
      { from: 6.0, to: 9.0, goals: { eat: 4, wc: 3, living: 2, leave: 2 } },
      { from: 9.0, to: 17.0, goals: { living: 4, bedroom: 3, eat: 2, utility: 2 } },
      { from: 17.0, to: 23.0, goals: { living: 5, eat: 4, bedroom: 3, utility: 1 } },
    ],
  }),
  role('residentChild', 'Child', CHILD, {
    cloth: 0xc9a227, count: (p) => Math.min(6, Math.max(2, Math.round((p.flats ?? 8) / 2))), resident: true,
    topUp: 2, maxCount: 9,
    arrive: [7.0, 7.8], leave: [20.5, 21.5],
    needs: { wc: 2.2, coffee: 0 },
    day: [
      { from: 6.5, to: 8.0, goals: { eat: 4, wc: 3, bedroom: 2 } },
      { from: 15.0, to: 21.0, goals: { play: 4, living: 3, bedroom: 3, eat: 2 } },
    ],
  }),
  role('postman', 'Postal worker', ADULT, {
    cloth: 0xb2472e, count: () => 1, visitor: true, maxCount: 1,
    arrive: [10.0, 11.5], leave: [10.3, 11.8], stay: [5, 10],
    day: [{ from: 9.0, to: 13.0, goals: { deliver: 6, arrive: 2 } }],
  }),
  role('caretaker', 'Caretaker', ELDER, {
    cloth: 0x476b4a, count: () => 1, maxCount: 1,
    arrive: [7.4, 8.2], leave: [15.5, 16.5],
    day: [{ from: 7.0, to: 17.0, goals: { clean: 5, store: 3, utility: 2, coffee: 1 } }],
  }),
];

export const ROSTERS = {
  house: HOUSE_ROLES,
  kindergarten: KINDERGARTEN_ROLES,
  office: OFFICE_ROLES,
  clinic: CLINIC_ROLES,
  library: LIBRARY_ROLES,
  cafe: CAFE_ROLES,
  shop: SHOP_ROLES,
  apartment: APARTMENT_ROLES,
};

export const DEFAULT_ROSTER = 'office';

// ---------------------------------------------------------------------------
// 4. Building the population.

export const MIN_POPULATION = 10;
export const MAX_POPULATION = 30;

/** Deterministic PRNG so the same building is inhabited by the same people. */
export function rngFrom(seed) {
  let t = 0;
  const s = String(seed ?? 'walk');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  t = h >>> 0;
  return function rng() {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng, a, b) => a + (b - a) * rng();
const pickOf = (rng, arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

/**
 * buildPopulation({ typeKey, params, seed, cap }) -> [Person]
 *
 * Person = {
 *   id, role, label, height, speed, adult,
 *   cloth, skin, hair, hat,
 *   arriveAt, leaveAt,            // hours
 *   day: [ band ],
 *   needs: { wc, coffee },
 *   resident, visitor
 * }
 *
 * The count is the sum of the roster's own count() functions, scaled down as a
 * whole if it would exceed `cap` (performance, DESIGN-DECISIONS "NPC count
 * capped") and topped up if it falls below MIN_POPULATION or below an
 * explicitly requested head count.
 *
 * Scaling DOWN is proportional, so the mix stays right: a clinic that has to
 * shed people sheds patients, not its only receptionist.
 *
 * Scaling UP goes to the roles that plausibly scale, by their `topUp` weight
 * and never past their `maxCount`. Handing the whole shortfall to whichever
 * role was already the largest is what put four Parents in a three-bedroom
 * family house — and twenty-four of them at the thirty-person load case. A
 * busier house has more visiting friends and more children in it. It does not
 * have more parents. Where the plausible ceilings cannot reach the number that
 * was asked for, the population stops at what the building can honestly hold.
 */
export function buildPopulation({
  typeKey = DEFAULT_ROSTER, params = {}, seed = 'walk',
  cap = MAX_POPULATION, want = 0,
} = {}) {
  const roster = ROSTERS[typeKey] || ROSTERS[DEFAULT_ROSTER];
  const rng = rngFrom(`${seed}|${typeKey}`);

  const wanted = roster.map((r) => ({
    role: r,
    n: Math.min(r.maxCount ?? Infinity, Math.max(0, Math.round(r.count(params) || 0))),
    added: 0,
  }));
  let total = wanted.reduce((s, w) => s + w.n, 0);

  // Top up towards the minimum — or towards an explicitly requested head count,
  // which is how the load case is reached. One person at a time, always to the
  // role whose share is furthest behind its topUp weight, so the mix stays
  // recognisable at every head count and the result is deterministic.
  const floor = Math.min(MAX_POPULATION, Math.max(MIN_POPULATION, want || 0));
  while (total < floor) {
    let pick = null, best = -Infinity;
    for (const w of wanted) {
      const weight = w.role.topUp || 0;
      if (weight <= 0 || w.n >= (w.role.maxCount ?? Infinity)) continue;
      const share = weight / (w.added + 1);
      if (share > best) { best = share; pick = w; }
    }
    if (!pick) break;                 // nobody left who can plausibly scale
    pick.n++; pick.added++; total++;
  }
  // Scale down proportionally, but never below one of any role that had one.
  if (total > cap) {
    const k = cap / total;
    for (const w of wanted) w.n = w.n > 0 ? Math.max(1, Math.floor(w.n * k)) : 0;
    total = wanted.reduce((s, w) => s + w.n, 0);
    // rounding can still leave us over: shave the biggest roles first
    while (total > cap) {
      const biggest = wanted.filter((w) => w.n > 1).sort((a, b) => b.n - a.n)[0];
      if (!biggest) break;
      biggest.n--; total--;
    }
  }

  const people = [];
  for (const { role: r, n } of wanted) {
    for (let i = 0; i < n; i++) {
      const arriveAt = between(rng, r.arrive[0], r.arrive[1]);
      let leaveAt;
      if (r.stay) {
        leaveAt = arriveAt + between(rng, r.stay[0], r.stay[1]) / 60;
      } else {
        leaveAt = Math.max(arriveAt + 0.75, between(rng, r.leave[0], r.leave[1]));
      }
      people.push({
        id: `n${people.length.toString(36)}`,
        role: r.key,
        label: r.label,
        height: r.height * between(rng, 0.94, 1.06),
        speed: r.speed * between(rng, 0.9, 1.1),
        adult: !!r.adult,
        child: !!r.child,
        cloth: r.cloth,
        trousers: pickOf(rng, [0x2f2c29, 0x35566e, 0x55504a, 0x8d7f6c, 0x4a4642]),
        skin: pickOf(rng, SKIN_TONES),
        hair: pickOf(rng, HAIR_TONES),
        arriveAt,
        leaveAt,
        day: r.day,
        needs: r.needs,
        resident: !!r.resident,
        visitor: !!r.visitor,
      });
    }
  }
  return people;
}

/** The time band covering `hour` for this person, or the nearest one. */
export function bandAt(person, hour) {
  const day = person.day || [];
  for (const b of day) if (hour >= b.from && hour < b.to) return b;
  if (!day.length) return null;
  // outside every band: use the closest one, so nobody freezes at 06:00
  let best = day[0], bestD = Infinity;
  for (const b of day) {
    const d = hour < b.from ? b.from - hour : hour - b.to;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/**
 * Draw the next goal for this person at this hour. `rng` is the walk's own
 * generator so the whole simulation is reproducible from one seed.
 * `exclude` is the goal they have just finished — nobody goes to the WC twice
 * in a row on purpose.
 */
export function nextGoal(person, hour, rng, exclude = null) {
  const band = bandAt(person, hour);
  if (!band) return 'wander';
  const entries = Object.entries(band.goals).filter(([k, v]) => v > 0 && GOALS[k] && k !== exclude);
  if (!entries.length) return 'wander';
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/** Dwell time in MINUTES for a goal, jittered. */
export function dwellFor(goalKey, rng) {
  const g = GOALS[goalKey];
  if (!g) return 5;
  return between(rng, g.dwell[0], g.dwell[1]);
}

/** Map a commission building type onto a roster key. */
export function rosterKeyFor(typeKey) {
  const k = String(typeKey || '').toLowerCase();
  if (ROSTERS[k]) return k;
  if (k.includes('house') || k.includes('dwelling')) return 'house';
  if (k.includes('kinder') || k.includes('nursery')) return 'kindergarten';
  if (k.includes('clinic') || k.includes('health')) return 'clinic';
  if (k.includes('librar')) return 'library';
  if (k.includes('cafe') || k.includes('restaur')) return 'cafe';
  if (k.includes('shop') || k.includes('retail')) return 'shop';
  if (k.includes('apart') || k.includes('flat')) return 'apartment';
  return DEFAULT_ROSTER;
}
