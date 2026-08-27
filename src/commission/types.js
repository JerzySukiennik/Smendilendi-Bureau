// The eight building types, each with a real schedule of accommodation.
// View-free: no imports at all.
//
// Every area below is NET usable floor area in square metres and every one of
// them is defensible:
//   - 2.5 m2 of clear activity floor per child in a nursery group room, with the
//     cloakroom and the washroom excluded from that figure.
//   - 1 WC + 1 washbasin per 15 children, cubicles 0.80 x 1.20 m with 1.50 m
//     high divisions so staff can see over them.
//   - 10 m2 of outdoor play area per child.
//   - 1.45 m2 per cover in a cafe dining room, including circulation.
//   - Neufert: 1.4 m2 of kitchen per cover for a full restaurant, 0.3 for a
//     coffee bar; a cafe serving hot food sits at 0.55.
//   - 14 m2 for a consulting room: a couch reachable from three sides plus a
//     seat for one companion.
//   - 1.6 m2 per waiting seat, four seats per consulting room.
//   - Accessible WC 2.20 x 2.10 m = 4.6 m2, 1.50 m turning circle.
//   - 9 m2 per open-plan workstation including circulation.
//   - 2.8 m2 per library reader seat (Dahlgren, 30 sq ft), ~100 volumes per m2
//     of open shelving including 1.20 m aisles.
//   - Worktop 0.90 m high, 1.20 m clear between opposing kitchen runs.
//   - Corridors 1.20 m in dwellings, 1.40 m in buildings used by the public.
//   - Door leaf 0.90 x 2.05 m. Stair riser 0.175 m, going 0.28 m.
//   - Glazing to floor area 1:8 in habitable rooms, 1:12 elsewhere.

const R = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Shorthand for a schedule row. */
function room(key, name, minArea, opts = {}) {
  return {
    key,
    name,
    minArea: R(minArea),
    count: opts.count ?? 1,
    requires: opts.requires ?? [],
    adjacentTo: opts.adjacentTo ?? [],
    note: opts.note ?? '',
    phrase: opts.phrase ?? '',
    hero: opts.hero ?? false,
  };
}

// Constraints shared by everything that is built on a plot.
function baseConstraints(p) {
  const list = [
    {
      code: 'PLOT_SETBACKS',
      check: 'plot.withinSetbacks',
      text: 'No part of the building may cross the buildable line set by the front, side and rear setbacks.',
    },
    {
      code: 'ENTRANCE_FACING',
      check: 'plot.entranceFacing',
      text: 'The main entrance must face the street side of the plot.',
    },
    {
      code: 'MAX_FLOORS',
      check: 'plot.maxFloors',
      text: `The local plan allows at most ${p.maxFloors} storey${p.maxFloors > 1 ? 's' : ''} above ground.`,
      limit: p.maxFloors,
    },
    {
      code: 'SITE_COVERAGE',
      check: 'plot.siteCoverage',
      text: `Built footprint may not exceed ${Math.round(p.maxCoverage * 100)} % of the plot area.`,
      limit: p.maxCoverage,
    },
    {
      code: 'PROTECTED_TREES',
      check: 'plot.protectedTrees',
      text: 'Protected trees may not be built over: keep walls outside the crown radius given on the survey.',
    },
    {
      code: 'BUDGET',
      check: 'cost.budget',
      text: 'Construction cost must not exceed the stated budget.',
    },
    {
      code: 'DAYLIGHT_RATIO',
      check: 'daylight.ratio',
      text: 'Glazing must reach 1/8 of the floor area in habitable rooms and 1/12 in ancillary rooms.',
      limit: 1 / 8,
    },
    {
      code: 'CORRIDOR_WIDTH',
      check: 'access.corridorWidth',
      text: `Circulation must stay at least ${R(p.corridor, 2)} m clear, and every door leaf is 0.90 x 2.05 m.`,
      limit: p.corridor,
    },
    {
      code: 'ESCAPE_DISTANCE',
      check: 'access.escapeDistance',
      text: `No point in the building may be more than ${p.escape} m from an exit along an escape route.`,
      limit: p.escape,
    },
  ];
  if (p.greenArea) {
    list.push({
      code: 'BIOLOGICALLY_ACTIVE_AREA',
      check: 'plot.greenArea',
      text: `At least ${Math.round(p.greenArea * 100)} % of the plot must stay unpaved and planted.`,
      limit: p.greenArea,
    });
  }
  if (p.publicBuilding) {
    list.push({
      code: 'STEP_FREE_ENTRANCE',
      check: 'access.stepFreeEntrance',
      text: 'The entrance must be step-free from the street: no threshold higher than 0.02 m, ramps at most 6 %.',
    });
    list.push({
      code: 'ACCESSIBLE_WC',
      check: 'access.accessibleWc',
      text: 'At least one accessible WC, 2.20 x 2.10 m clear with a 1.50 m turning circle and a 0.90 m transfer space.',
    });
  }
  if (p.storeys > 1 && (p.publicBuilding || p.key === 'apartment')) {
    list.push({
      code: 'LIFT_REQUIRED',
      check: 'access.liftAbove',
      text: 'Every floor above ground must be reachable by lift; car at least 1.10 x 1.40 m with a 0.90 m door.',
    });
  }
  return list;
}

export const BUILDING_TYPES = {

  // -------------------------------------------------------------- house
  house: {
    key: 'house',
    name: 'detached house',
    article: 'a',
    unitCost: 5500,
    grossFactor: 1.28,
    feeRate: [0.070, 0.105],
    deadlineBase: 13,
    publicBuilding: false,
    params(rng, d) {
      const bedrooms = 2 + Math.floor(rng() * 4);              // 2..5
      return { bedrooms, occupants: bedrooms + 1, storeys: bedrooms >= 4 ? 2 : 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.35,
    greenArea: 0.30,
    corridor: 1.20,
    escape: 30,
    program(p) {
      const baths = p.bedrooms >= 4 ? 2 : 1;
      return [
        room('hall', 'Entrance hall', 7.0, {
          requires: ['wardrobe'], adjacentTo: ['living'],
          note: 'Room to put down bags and hang wet coats; 1.20 m clear to the stairs.',
        }),
        room('living', 'Living room', 22 + p.bedrooms * 2, {
          requires: ['sofa', 'seat'], adjacentTo: ['dining'], hero: true,
          phrase: 'a living room the whole family actually fits into',
          note: 'A 3.00 m conversation circle plus a 1.00 m route past the back of the sofa.',
        }),
        room('dining', 'Dining room', 12, {
          requires: ['table', 'seat'], adjacentTo: ['kitchen', 'living'], hero: true,
          phrase: 'a dining table that seats everyone at once',
          note: '0.60 m of table edge per person and 0.80 m behind a pushed-out chair.',
        }),
        room('kitchen', 'Kitchen', 11, {
          requires: ['worktop', 'sink', 'cooker', 'fridge'], adjacentTo: ['dining'], hero: true,
          phrase: 'a proper kitchen next to it',
          note: 'Worktop at 0.90 m, at least 1.20 m clear between opposing runs.',
        }),
        room('bedroom_main', 'Main bedroom', 14, {
          requires: ['bed_double', 'wardrobe'], hero: true,
          phrase: 'a main bedroom with room to walk round the bed',
          note: '0.75 m clear on both sides of a double bed, 0.90 m in front of the wardrobe doors.',
        }),
        room('bedroom', 'Bedroom', 11, {
          count: p.bedrooms - 1, requires: ['bed_single', 'wardrobe'], hero: true,
          phrase: `${p.bedrooms - 1} further bedroom${p.bedrooms - 1 > 1 ? 's' : ''}`,
        }),
        room('bathroom', 'Bathroom', 6.5, {
          count: baths, requires: ['bath', 'washbasin', 'wc'],
          note: '0.90 m clear in front of the basin and the WC; 0.70 m beside the bath.',
        }),
        room('wc', 'Guest WC', 1.8, {
          requires: ['wc', 'washbasin'], adjacentTo: ['hall'],
          note: 'On the entrance level, 0.90 x 1.50 m clear, not opening straight into the dining room.',
        }),
        room('utility', 'Utility room', 6.0, {
          requires: ['washing_machine', 'sink'], adjacentTo: ['kitchen'],
          note: 'Washing machine, boiler and the drying rack that otherwise ends up in the bathroom.',
        }),
        room('store', 'Storage', 3.5, { requires: ['shelving'] }),
      ];
    },
    extraConstraints() {
      return [{
        code: 'BATHROOM_PRIVACY',
        check: 'access.bathroomPrivacy',
        text: 'No bathroom or WC may be reachable only by passing through a bedroom or the kitchen.',
      }];
    },
  },

  // -------------------------------------------------------------- cafe
  cafe: {
    key: 'cafe',
    name: 'cafe with a hot kitchen',
    article: 'a',
    unitCost: 7000,
    grossFactor: 1.35,
    feeRate: [0.060, 0.095],
    deadlineBase: 14,
    publicBuilding: true,
    params(rng) {
      const seats = 32 + Math.floor(rng() * 9) * 5;            // 32..72
      return { seats, staff: Math.ceil(seats / 14) + 2, storeys: 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.55,
    greenArea: 0,
    corridor: 1.40,
    escape: 30,
    program(p) {
      return [
        room('lobby', 'Entrance lobby', 5.0, {
          requires: ['sign'],
          note: 'Draught lobby with both doors 0.90 m clear; no revolving door on this budget.',
        }),
        room('dining', 'Dining room', 1.45 * p.seats, {
          requires: ['table', 'seat'], adjacentTo: ['counter'], hero: true,
          phrase: `room for ${p.seats} people to sit down`,
          note: '1.45 m2 per cover including circulation; 1.20 m between chair backs where staff must pass.',
        }),
        room('counter', 'Counter and pass', 11, {
          requires: ['counter', 'coffee_machine', 'checkout'], adjacentTo: ['dining', 'kitchen'], hero: true,
          phrase: 'a counter you can see the coffee being made at',
          note: '0.90 m worktop, 1.10 m clear behind it for two people to pass back to back.',
        }),
        room('kitchen', 'Kitchen', Math.max(18, 0.55 * p.seats), {
          requires: ['worktop', 'sink', 'cooker', 'fridge'], adjacentTo: ['counter', 'dry_store'], hero: true,
          phrase: 'a kitchen that can actually cook, not just reheat',
          note: 'Neufert: 1.4 m2 per cover for a restaurant, 0.3 for a coffee bar. Hot food puts this at 0.55.',
        }),
        room('dry_store', 'Dry store', 6.0, { requires: ['shelving'], adjacentTo: ['kitchen', 'delivery'] }),
        room('cold_store', 'Cold store', 4.0, { requires: ['fridge'], adjacentTo: ['kitchen'] }),
        room('delivery', 'Goods entrance', 5.0, {
          adjacentTo: ['dry_store'], hero: true,
          phrase: 'a delivery door that does not go through the dining room',
          note: 'Crates arrive here. The route from the van to the store must not cross the customer route.',
        }),
        room('waste', 'Waste store', 3.5, { adjacentTo: ['delivery'] }),
        room('staff_room', 'Staff room', 7.0, { requires: ['locker', 'table', 'seat'] }),
        room('staff_wc', 'Staff WC', 2.4, {
          requires: ['wc', 'washbasin'], adjacentTo: ['staff_room'], hero: true,
          phrase: 'a staff WC of their own',
          note: 'Separate from the customer WCs: nobody in whites should cross the dining room to reach a toilet.',
        }),
        room('wc_guest', 'Customer WC', 3.2, { count: 2, requires: ['wc', 'washbasin'] }),
        room('wc_accessible', 'Accessible WC', 4.6, {
          requires: ['wc', 'washbasin'],
          note: '2.20 x 2.10 m clear, 1.50 m turning circle, 0.90 m transfer space beside the WC.',
        }),
      ];
    },
    extraConstraints() {
      return [
        {
          code: 'DELIVERY_SEPARATION',
          check: 'program.deliveryAccess',
          text: 'The goods route from the delivery door to the stores must not pass through the dining room.',
        },
        {
          code: 'STAFF_WC_SEPARATE',
          check: 'program.staffWcSeparate',
          text: 'The staff WC must be reachable from the kitchen side without entering the customer area.',
        },
      ];
    },
  },

  // -------------------------------------------------------- kindergarten
  kindergarten: {
    key: 'kindergarten',
    name: 'kindergarten',
    article: 'a',
    unitCost: 6500,
    grossFactor: 1.42,
    feeRate: [0.065, 0.100],
    deadlineBase: 18,
    publicBuilding: true,
    params(rng) {
      const children = 40 + Math.floor(rng() * 13) * 5;        // 40..100
      const groups = Math.ceil(children / 22);
      return { children, groups, perGroup: Math.ceil(children / groups), storeys: 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.30,
    greenArea: 0.30,
    corridor: 1.40,
    escape: 25,
    program(p) {
      const wcPerGroup = Math.ceil(p.perGroup / 15);
      return [
        room('lobby', 'Entrance and buggy drop', 14, { requires: ['sign'] }),
        room('group_room', 'Group room', 2.5 * p.perGroup, {
          count: p.groups, requires: ['child_table', 'child_chair', 'shelving'],
          adjacentTo: ['cloakroom', 'group_wc'], hero: true,
          phrase: `${p.groups} group room${p.groups > 1 ? 's' : ''} for ${p.perGroup} children each`,
          note: '2.5 m2 of clear activity floor per child. The cloakroom and the washroom are NOT counted in it.',
        }),
        room('cloakroom', 'Cloakroom', Math.max(8, 0.8 * p.perGroup), {
          count: p.groups, requires: ['locker'], adjacentTo: ['group_room'], hero: true,
          phrase: 'a cloakroom for each of them',
          note: 'A hook, a bench and a boot tray per child, plus 1.20 m for a parent kneeling to do up a coat.',
        }),
        room('group_wc', 'Group washroom', Math.max(6, 2.2 * wcPerGroup + 3), {
          count: p.groups, requires: ['wc', 'washbasin'], adjacentTo: ['group_room'], hero: true,
          phrase: 'its own washroom off the group room',
          note: `1 WC and 1 washbasin per 15 children (${wcPerGroup} each here); cubicles 0.80 x 1.20 m with 1.50 m divisions so staff can see over.`,
        }),
        room('hall', 'Movement hall', 65, {
          requires: ['play_mat'], hero: true,
          phrase: 'a hall big enough to run in when it rains',
          note: 'Multipurpose: gym in the morning, parents evening at night. 3.20 m clear height if you can get it.',
        }),
        room('issuing_kitchen', 'Issuing kitchen', 22, {
          requires: ['worktop', 'sink', 'fridge'], adjacentTo: ['kitchen_store', 'hall'],
          note: 'Meals arrive cooked; this portions and washes up. Separate hand basin from the pot sink.',
        }),
        room('kitchen_store', 'Kitchen store', 8, { requires: ['shelving'], adjacentTo: ['issuing_kitchen', 'delivery'] }),
        room('delivery', 'Delivery', 4, { adjacentTo: ['kitchen_store'] }),
        room('sick_room', 'Sick room', 8, {
          requires: ['bed_single', 'washbasin'], adjacentTo: ['office'],
          note: 'For a child who has to be kept apart, in sight of the office.',
        }),
        room('office', 'Head of nursery', 10, {
          requires: ['desk', 'seat'],
          note: 'A view of the play area is worth more here than the extra square metre.',
        }),
        room('staff_room', 'Staff room', 14, { requires: ['table', 'seat', 'locker'] }),
        room('staff_wc', 'Staff and accessible WC', 4.6, {
          requires: ['wc', 'washbasin'],
          note: 'Adult height, 2.20 x 2.10 m clear so it doubles as the accessible WC.',
        }),
        room('pram_store', 'Pram store', 7, { requires: ['pram_rack'] }),
        room('cleaner', 'Cleaner', 3, { requires: ['sink'] }),
      ];
    },
    extraConstraints(p) {
      return [
        {
          code: 'OUTDOOR_PLAY_AREA',
          check: 'program.outdoorPlayArea',
          text: `At least ${p.children * 10} m2 of outdoor play area on the plot: 10 m2 per child.`,
          limit: p.children * 10,
        },
        {
          code: 'GROUP_ROOMS_GROUND_FLOOR',
          check: 'program.groundFloorGroupRooms',
          text: 'Every group room must be on the ground floor with a door of its own onto the play area.',
        },
      ];
    },
  },

  // -------------------------------------------------------------- office
  office: {
    key: 'office',
    name: 'small office building',
    article: 'a',
    unitCost: 6000,
    grossFactor: 1.36,
    feeRate: [0.055, 0.090],
    deadlineBase: 16,
    publicBuilding: true,
    params(rng) {
      const staff = 18 + Math.floor(rng() * 15) * 3;           // 18..60
      return {
        staff,
        meetings: 1 + Math.ceil(staff / 24),
        storeys: clamp(Math.ceil(staff / 26), 1, 4),
      };
    },
    maxFloors: 4,
    maxCoverage: 0.50,
    greenArea: 0,
    corridor: 1.40,
    escape: 30,
    program(p) {
      return [
        room('reception', 'Reception', 16, {
          requires: ['reception_desk', 'waiting_bench'], hero: true,
          phrase: 'a reception that does not feel like a corridor with a desk in it',
          note: 'A 0.75-0.80 m section of counter for a seated or wheelchair user.',
        }),
        room('workspace', 'Open workspace', 9 * p.staff, {
          requires: ['desk', 'seat'], hero: true,
          phrase: `desks for ${p.staff} people`,
          note: '9 m2 per workstation for open plan including circulation; 1.20 m behind a seated chair.',
        }),
        room('meeting', 'Meeting room', 19, {
          count: p.meetings, requires: ['meeting_table', 'seat'], hero: true,
          phrase: `${p.meetings} meeting room${p.meetings > 1 ? 's' : ''}`,
          note: '2.3 m2 per seat around the table plus 0.90 m to walk behind a pushed-out chair.',
        }),
        room('focus', 'Focus room', 6, {
          count: 2, requires: ['desk', 'seat'],
          note: 'One-person call room. A door, a desk and a mechanical supply of air.',
        }),
        room('breakout', 'Tea point and breakout', Math.max(15, 0.55 * p.staff), {
          requires: ['worktop', 'sink', 'fridge', 'table', 'seat'], hero: true,
          phrase: 'somewhere to make coffee that is not the meeting room',
        }),
        room('comms', 'Comms room', 6, {
          requires: ['server_rack'],
          note: 'No water pipes overhead, and its own cooling.',
        }),
        room('archive', 'Archive', 9, { requires: ['shelving'] }),
        room('wc', 'WC block', 5.0, { count: 2 * p.storeys, requires: ['wc', 'washbasin'] }),
        room('wc_accessible', 'Accessible WC', 4.6, { requires: ['wc', 'washbasin'] }),
        room('cleaner', 'Cleaner', 3, { requires: ['sink'] }),
        room('bike_store', 'Bike store', Math.max(8, 0.6 * p.staff), { requires: ['bike_rack'] }),
      ];
    },
    extraConstraints() {
      return [{
        code: 'PARKING',
        check: 'plot.parking',
        text: 'One parking space per 40 m2 of office floor, at least one of them accessible at 3.60 x 5.00 m.',
      }];
    },
  },

  // -------------------------------------------------------------- clinic
  clinic: {
    key: 'clinic',
    name: 'primary care clinic',
    article: 'a',
    unitCost: 7500,
    grossFactor: 1.45,
    feeRate: [0.070, 0.110],
    deadlineBase: 20,
    publicBuilding: true,
    params(rng) {
      const rooms = 3 + Math.floor(rng() * 6);                 // 3..8
      return { rooms, waitingSeats: rooms * 4, storeys: rooms >= 7 ? 2 : 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.45,
    greenArea: 0,
    corridor: 1.50,
    escape: 30,
    program(p) {
      return [
        room('entrance', 'Entrance', 14, { requires: ['sign'] }),
        room('reception', 'Reception and records counter', 16, {
          requires: ['reception_desk', 'desk'], adjacentTo: ['waiting', 'records'], hero: true,
          phrase: 'a reception where you can speak without the whole room hearing you',
          note: 'Part of the counter at 0.75-0.80 m; a quiet position off the queue for private questions.',
        }),
        room('waiting', 'Waiting area', 1.6 * p.waitingSeats, {
          requires: ['waiting_bench', 'seat'], adjacentTo: ['reception'], hero: true,
          phrase: `a waiting area for ${p.waitingSeats} people`,
          note: `1.6 m2 per seat; four seats per consulting room covers normal overlap. One wheelchair space per ten seats.`,
        }),
        room('consulting', 'Consulting room', 14, {
          count: p.rooms, requires: ['desk', 'seat', 'exam_couch', 'washbasin'], hero: true,
          phrase: `${p.rooms} consulting rooms`,
          note: '14 m2 lets a couch be approached from three sides and still seats a companion. Basin in every room.',
        }),
        room('treatment', 'Treatment room', 16, {
          requires: ['exam_couch', 'sink', 'worktop'], adjacentTo: ['clean_utility'],
          note: 'Dressings and minor procedures; needs the clean utility next door, not down a corridor.',
        }),
        room('clean_utility', 'Clean utility', 8, {
          requires: ['worktop', 'sink', 'shelving'],
          note: 'Sterile supply. It must not be entered from the dirty side.',
        }),
        room('dirty_utility', 'Dirty utility', 8, {
          requires: ['sink', 'worktop'], adjacentTo: ['waste_hold'],
          note: 'Sluice. Soiled goods must reach it without crossing the waiting area.',
        }),
        room('wc_accessible', 'Accessible WC', 4.6, {
          requires: ['wc', 'washbasin'], adjacentTo: ['waiting'], hero: true,
          phrase: 'an accessible WC off the waiting area',
          note: '2.20 x 2.10 m clear, 1.50 m turning circle, grab rails both sides, 0.90 m transfer space.',
        }),
        room('wc_patient', 'Patient WC', 3.2, { count: Math.max(1, Math.floor(p.rooms / 3)), requires: ['wc', 'washbasin'] }),
        room('staff_room', 'Staff room', 13, { requires: ['table', 'seat', 'worktop', 'sink'] }),
        room('staff_changing', 'Staff changing', 8, { requires: ['locker'] }),
        room('staff_wc', 'Staff WC', 3.2, { requires: ['wc', 'washbasin'] }),
        room('records', 'Records and back office', 10, { requires: ['shelving', 'desk'] }),
        room('waste_hold', 'Clinical waste hold', 4, { adjacentTo: ['dirty_utility'] }),
        room('cleaner', 'Cleaner', 3, { requires: ['sink'] }),
      ];
    },
    extraConstraints() {
      return [{
        code: 'CLEAN_DIRTY_SEPARATION',
        check: 'program.cleanDirtySeparation',
        text: 'The route from the dirty utility to the waste hold must not pass through the waiting area or the clean utility.',
      }];
    },
  },

  // ------------------------------------------------------------- library
  library: {
    key: 'library',
    name: 'branch library',
    article: 'a',
    unitCost: 6800,
    grossFactor: 1.38,
    feeRate: [0.065, 0.100],
    deadlineBase: 18,
    publicBuilding: true,
    params(rng) {
      const seats = 30 + Math.floor(rng() * 9) * 10;           // 30..110
      const volumes = 12000 + Math.floor(rng() * 12) * 3000;   // 12k..45k
      return { seats, volumes, storeys: seats >= 80 ? 2 : 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.45,
    greenArea: 0.15,
    corridor: 1.50,
    escape: 30,
    program(p) {
      const lending = p.volumes / 100;
      const reading = 2.8 * p.seats;
      return [
        room('foyer', 'Foyer and returns', 22, { requires: ['sign'], hero: true, phrase: 'a foyer where you can return a book after hours' }),
        room('issue_desk', 'Issue desk', 12, { requires: ['reception_desk'], adjacentTo: ['foyer', 'lending'] }),
        room('lending', 'Open shelving', lending, {
          requires: ['bookshelf'], hero: true,
          phrase: `open shelving for ${p.volumes.toLocaleString('en-GB')} volumes`,
          note: 'About 100 volumes per m2 including aisles at 1.20 m, widened to 1.50 m where a wheelchair must turn.',
        }),
        room('reading', 'Reading area', reading, {
          requires: ['table', 'seat'], adjacentTo: ['lending'], hero: true,
          phrase: `${p.seats} places to sit and read`,
          note: '2.8 m2 per reader seat at a table; a carrel needs the same.',
        }),
        room('children', "Children's library", Math.max(40, 0.12 * (lending + reading)), {
          requires: ['child_table', 'child_chair', 'bookshelf'], hero: true,
          phrase: "a children's corner that is allowed to be noisy",
          note: 'At least 10 % of the public floor, acoustically separated from the quiet reading area.',
        }),
        room('study_room', 'Study room', 8, { count: 2, requires: ['table', 'seat'] }),
        room('staff_workroom', 'Staff workroom', 14, {
          requires: ['desk', 'seat', 'shelving'],
          note: 'Book processing and repairs; 14 m2 is the standard 150 sq ft workroom.',
        }),
        room('office', 'Librarian office', 10, { requires: ['desk', 'seat'] }),
        room('store', 'Closed store', 12, { requires: ['shelving'] }),
        room('wc', 'WC block', 4.0, { count: 2, requires: ['wc', 'washbasin'] }),
        room('wc_accessible', 'Accessible WC', 4.6, { requires: ['wc', 'washbasin'] }),
        room('cleaner', 'Cleaner', 3, { requires: ['sink'] }),
      ];
    },
    extraConstraints() {
      return [{
        code: 'CHILDREN_AREA_SHARE',
        check: 'program.childrenAreaShare',
        text: "The children's library must be at least 10 % of the public floor area and must not open off the quiet reading room.",
        limit: 0.10,
      }];
    },
  },

  // ---------------------------------------------------------------- shop
  shop: {
    key: 'shop',
    name: 'small shop',
    article: 'a',
    unitCost: 5000,
    grossFactor: 1.30,
    feeRate: [0.055, 0.090],
    deadlineBase: 10,
    publicBuilding: true,
    params(rng) {
      const sales = 60 + Math.floor(rng() * 13) * 10;          // 60..180
      return { sales, staff: 3 + Math.floor(rng() * 4), storeys: 1 };
    },
    maxFloors: 2,
    maxCoverage: 0.60,
    greenArea: 0,
    corridor: 1.40,
    escape: 30,
    program(p) {
      return [
        room('lobby', 'Entrance', 5, { requires: ['sign'] }),
        room('sales', 'Sales floor', p.sales, {
          requires: ['display_shelf'], hero: true,
          phrase: `${p.sales} m2 of sales floor`,
          note: 'Main aisle 1.40 m, secondary aisles 1.10 m; a trolley needs 1.50 m to turn at the end of a run.',
        }),
        room('checkout', 'Checkout', 7, {
          requires: ['checkout', 'counter'], adjacentTo: ['sales', 'lobby'], hero: true,
          phrase: 'a till you can queue at without blocking the door',
          note: 'At least 3.00 m of queue space clear of the entrance swing.',
        }),
        room('stock', 'Stockroom', Math.max(15, 0.35 * p.sales), {
          requires: ['shelving'], adjacentTo: ['delivery', 'sales'], hero: true,
          phrase: 'a stockroom big enough to take a full delivery',
          note: 'About 35 % of the sales floor; a pallet is 1.20 x 0.80 m and needs 1.80 m to be turned.',
        }),
        room('delivery', 'Goods entrance', 5, { adjacentTo: ['stock'], hero: true, phrase: 'a back door for deliveries' }),
        room('office', 'Office', 7, { requires: ['desk', 'seat'] }),
        room('staff_room', 'Staff room', 8, { requires: ['table', 'seat', 'locker'] }),
        room('staff_wc', 'Staff WC', 2.4, { requires: ['wc', 'washbasin'] }),
        room('wc_accessible', 'Accessible WC', 4.6, { requires: ['wc', 'washbasin'] }),
        room('waste', 'Waste store', 3, { adjacentTo: ['delivery'] }),
      ];
    },
    extraConstraints() {
      return [{
        code: 'STOCK_DELIVERY_ACCESS',
        check: 'program.deliveryAccess',
        text: 'Deliveries must reach the stockroom without being carried across the sales floor.',
      }];
    },
  },

  // ----------------------------------------------------------- apartment
  apartment: {
    key: 'apartment',
    name: 'small apartment building',
    article: 'a',
    unitCost: 5200,
    grossFactor: 1.40,
    feeRate: [0.050, 0.085],
    deadlineBase: 16,
    publicBuilding: false,
    params(rng) {
      const units = 6 + Math.floor(rng() * 9);                 // 6..14
      const storeys = clamp(Math.ceil(units / 4), 2, 4);
      const nStudio = Math.max(1, Math.round(units * 0.25));
      const nThree = Math.max(1, Math.round(units * 0.25));
      return { units, storeys, nStudio, nThree, nTwo: units - nStudio - nThree };
    },
    maxFloors: 4,
    maxCoverage: 0.45,
    greenArea: 0.25,
    corridor: 1.40,
    escape: 30,
    program(p) {
      const list = [
        room('entrance_lobby', 'Entrance lobby', 14, {
          requires: ['sign'], hero: true,
          phrase: 'a lobby with the post boxes in it',
          note: 'Mailboxes plus 1.50 m clear past them, and somewhere to put a pram down while unlocking.',
        }),
        room('stair_core', 'Stair and lift core', 17, {
          count: p.storeys,
          note: 'Flight 1.20 m clear, riser 0.175 m, going 0.28 m; lift car 1.10 x 1.40 m with a 0.90 m door.',
        }),
      ];
      if (p.nStudio > 0) list.push(room('apt_studio', 'Studio flat', 34, {
        count: p.nStudio, requires: ['bed_single', 'worktop', 'sink', 'wc', 'washbasin', 'shower'], hero: true,
        phrase: `${p.nStudio} studio${p.nStudio > 1 ? 's' : ''}`,
      }));
      if (p.nTwo > 0) list.push(room('apt_two', 'Two-room flat', 50, {
        count: p.nTwo, requires: ['bed_double', 'worktop', 'sink', 'wc', 'washbasin', 'bath'], hero: true,
        phrase: `${p.nTwo} two-room flat${p.nTwo > 1 ? 's' : ''}`,
      }));
      if (p.nThree > 0) list.push(room('apt_three', 'Three-room flat', 66, {
        count: p.nThree, requires: ['bed_double', 'bed_single', 'worktop', 'sink', 'wc', 'washbasin', 'bath'], hero: true,
        phrase: `${p.nThree} three-room flat${p.nThree > 1 ? 's' : ''} for families`,
      }));
      list.push(
        room('bike_pram', 'Bike and pram store', Math.max(10, 0.7 * p.units), {
          requires: ['bike_rack', 'pram_rack'], hero: true,
          phrase: 'a ground floor store for bikes and prams',
        }),
        room('bin_store', 'Bin store', 7, { note: 'Reachable from the street by the refuse crew without entering the lobby.' }),
        room('technical', 'Technical room', 10, { requires: ['shelving'] }),
        room('cleaner', 'Cleaner', 3, { requires: ['sink'] }),
      );
      return list;
    },
    extraConstraints() {
      return [
        {
          code: 'DWELLING_DAYLIGHT',
          check: 'daylight.ratio',
          text: 'Every habitable room in every flat needs glazing of at least 1/8 of its floor area.',
          limit: 1 / 8,
        },
        {
          code: 'NO_SINGLE_ASPECT_NORTH',
          check: 'daylight.singleAspectNorth',
          text: 'No flat may be single aspect facing north only.',
        },
      ];
    },
  },
};

export const TYPE_KEYS = Object.keys(BUILDING_TYPES);

/** Net programme area in m2, counting the `count` of each row. */
export function programArea(program) {
  return R(program.reduce((sum, r) => sum + r.minArea * r.count, 0), 1);
}

/** Every constraint for a type, including the shared plot/access/cost ones. */
export function constraintsFor(type, params) {
  const ctx = {
    key: type.key,
    maxFloors: type.maxFloors,
    maxCoverage: type.maxCoverage,
    greenArea: type.greenArea,
    corridor: type.corridor,
    escape: type.escape,
    publicBuilding: type.publicBuilding,
    storeys: params.storeys,
  };
  const extra = type.extraConstraints ? type.extraConstraints(params) : [];
  return [...baseConstraints(ctx), ...extra];
}
