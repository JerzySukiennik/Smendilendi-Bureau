// Client personas and the voice banks used to write the brief e-mail.
// View-free: no imports at all.
//
// A persona supplies tone + one human quirk. The tone selects a bank of sentence
// stems so two clients with the same tone still read differently thanks to the
// quirk line, the greeting and the sign-off.

/**
 * tone values: warm | brisk | pedantic | anxious | grand | dry | earnest | playful
 * `types` narrows which building types a persona can be attached to; an empty
 * array means "any".
 */
export const PERSONAS = [
  {
    id: 'retired-teacher', tone: 'warm', company: 'never',
    quirk: 'a rescued three-legged cat called Rambo',
    quirkLine: 'One more thing, and please do not laugh: we have a rescued three-legged cat called Rambo, and he needs a sunny windowsill somewhere low enough for him to hop onto.',
    greet: 'Dear architect,', sign: 'Warmly,',
    types: ['house', 'apartment'],
  },
  {
    id: 'restaurant-veteran', tone: 'brisk', company: 'maybe',
    quirk: 'has run kitchens for twenty years and hates a blind corner',
    quirkLine: 'I have run kitchens for twenty years, so one warning: if there is a blind corner between the pass and the dining room, someone will get scalded and I will make it your problem.',
    greet: 'Hello,', sign: 'Regards,',
    types: ['cafe', 'shop'],
  },
  {
    id: 'concert-pianist', tone: 'earnest', company: 'never',
    quirk: 'owns a full-size grand piano',
    quirkLine: 'The one thing I cannot compromise on is the piano: a full-size grand, 2.75 m long, and it needs a wall away from the window glare and a room that does not ring like a bathroom.',
    greet: 'Good morning,', sign: 'With thanks,',
    types: ['house', 'library', 'apartment'],
  },
  {
    id: 'district-official', tone: 'pedantic', company: 'always',
    quirk: 'quotes the local plan from memory',
    quirkLine: 'I should mention that I sit on the planning committee, so I will read your drawings the way I read everyone else\'s: setbacks first, then the entrance, then everything else.',
    greet: 'Dear Sir or Madam,', sign: 'Yours faithfully,',
    types: [],
  },
  {
    id: 'young-family', tone: 'anxious', company: 'never',
    quirk: 'twins who will not sleep through noise',
    quirkLine: 'We have twins, and they wake at the sound of a kettle, so please keep the bedrooms as far from the kitchen and the street as the plot allows.',
    greet: 'Hi,', sign: 'Thank you so much,',
    types: ['house', 'apartment'],
  },
  {
    id: 'developer-shark', tone: 'dry', company: 'always',
    quirk: 'counts everything in cost per square metre',
    quirkLine: 'I think in cost per square metre and nothing else, so charm me with the plan, not with the render.',
    greet: 'Good afternoon,', sign: 'Best,',
    types: ['apartment', 'office', 'shop'],
  },
  {
    id: 'gp-doctor', tone: 'earnest', company: 'maybe',
    quirk: 'still remembers that childhood waiting room',
    quirkLine: 'I still remember the waiting room I sat in as a child — brown, windowless, everyone knee to knee — and I have spent my whole career promising myself I would never make patients sit in one.',
    greet: 'Dear colleague,', sign: 'Kind regards,',
    types: ['clinic'],
  },
  {
    id: 'nursery-head', tone: 'warm', company: 'always',
    quirk: 'wants to see the garden from the office desk',
    quirkLine: 'Selfishly: put my little office where I can see the garden, because I have never once trusted a playground I could not see.',
    greet: 'Hello there,', sign: 'All the best,',
    types: ['kindergarten'],
  },
  {
    id: 'librarian-chief', tone: 'pedantic', company: 'always',
    quirk: 'measures everything in linear metres of shelving',
    quirkLine: 'I will judge the whole scheme in linear metres of shelving, and I will notice if you have quietly lost forty of them behind a feature staircase.',
    greet: 'Dear architect,', sign: 'Sincerely,',
    types: ['library'],
  },
  {
    id: 'startup-founder', tone: 'playful', company: 'always',
    quirk: 'insists on a table tennis table that nobody uses',
    quirkLine: 'There will be a table tennis table. Nobody will use it. I am aware. Give it 4 by 6 metres of clear floor anyway, it is a load-bearing part of our culture.',
    greet: 'Hey,', sign: 'Cheers,',
    types: ['office'],
  },
  {
    id: 'baker-second-life', tone: 'warm', company: 'maybe',
    quirk: 'starts baking at four and wants the delivery door away from the neighbours',
    quirkLine: 'I start at four in the morning, which means the delivery door needs to be as far from the neighbours\' bedrooms as you can decently put it.',
    greet: 'Good day,', sign: 'Warm regards,',
    types: ['cafe', 'shop'],
  },
  {
    id: 'retired-engineer', tone: 'pedantic', company: 'never',
    quirk: 'will check your dimensions with a very good tape measure',
    quirkLine: 'Fair warning: I spent forty years in structural engineering and I own a very good tape measure, so round numbers that do not add up will be found.',
    greet: 'Dear Sir or Madam,', sign: 'Yours,',
    types: ['house', 'office'],
  },
  {
    id: 'gallerist', tone: 'grand', company: 'maybe',
    quirk: 'hates corridors on principle',
    quirkLine: 'I detest corridors. A corridor is a room that has given up. Rooms should open into rooms wherever the plan will allow it.',
    greet: 'Dear architect,', sign: 'Yours,',
    types: ['house', 'library', 'shop', 'cafe'],
  },
  {
    id: 'clinic-manager', tone: 'brisk', company: 'always',
    quirk: 'has watched staff carry dirty trays through a waiting room',
    quirkLine: 'At our last premises the staff carried dirty trays straight through the waiting room twice a day. I would like never to see that again.',
    greet: 'Hello,', sign: 'Regards,',
    types: ['clinic'],
  },
  {
    id: 'widowed-collector', tone: 'earnest', company: 'never',
    quirk: 'four thousand books and nowhere to put them',
    quirkLine: 'I have four thousand books in boxes in a rented garage, and the whole point of this building is that they finally come home.',
    greet: 'Good morning,', sign: 'With gratitude,',
    types: ['house', 'library'],
  },
  {
    id: 'cycle-shop-owner', tone: 'playful', company: 'maybe',
    quirk: 'wants to wheel a bicycle through every door',
    quirkLine: 'Test every door by imagining me pushing a cargo bike through it, because sooner or later I will.',
    greet: 'Hi!', sign: 'Cheers,',
    types: ['shop', 'cafe', 'office'],
  },
  {
    id: 'housing-cooperative', tone: 'dry', company: 'always',
    quirk: 'answers to eleven very opinionated members',
    quirkLine: 'Everything I write here has been argued over by eleven members, so please do not add a twelfth opinion unless it is a very good one.',
    greet: 'Dear architect,', sign: 'On behalf of the members,',
    types: ['apartment', 'office'],
  },
  {
    id: 'chef-patron', tone: 'grand', company: 'maybe',
    quirk: 'wants the kitchen visible from the street',
    quirkLine: 'The kitchen is not a back room. I want a passer-by on the pavement to see the pass and smell the bread before they have decided anything.',
    greet: 'Dear architect,', sign: 'With respect,',
    types: ['cafe'],
  },
  {
    id: 'school-nurse', tone: 'anxious', company: 'always',
    quirk: 'terrified of a step nobody notices',
    quirkLine: 'I have picked children up off floors for fifteen years. If there is a single unnecessary step anywhere on the route from the gate to the front door, I will find it and I will worry about it.',
    greet: 'Hello,', sign: 'Thank you,',
    types: ['kindergarten', 'clinic'],
  },
  {
    id: 'estate-heir', tone: 'grand', company: 'never',
    quirk: 'inherited the plot and the family\'s opinions with it',
    quirkLine: 'The plot came to me from my grandmother along with a great many family opinions, most of which I intend to ignore, except the one about the old tree.',
    greet: 'Dear architect,', sign: 'Yours sincerely,',
    types: ['house', 'apartment', 'library'],
  },
  {
    id: 'night-shift-nurse', tone: 'warm', company: 'never',
    quirk: 'sleeps during the day and needs a dark bedroom',
    quirkLine: 'I sleep in daylight because of my shifts, so one bedroom has to be genuinely darkenable — the others can be as bright as you like.',
    greet: 'Hi,', sign: 'Thanks a lot,',
    types: ['house', 'apartment'],
  },
  {
    id: 'archivist', tone: 'pedantic', company: 'always',
    quirk: 'keeps a spreadsheet of everything, including you',
    quirkLine: 'I keep a spreadsheet of every decision on this project, including the ones you have not made yet, so precise answers travel better with me than beautiful ones.',
    greet: 'Dear architect,', sign: 'Regards,',
    types: ['library', 'office', 'clinic'],
  },
  {
    id: 'returning-emigrant', tone: 'earnest', company: 'never',
    quirk: 'has been away twenty years and misses a proper porch',
    quirkLine: 'I have been abroad for twenty years and the thing I have missed most, absurdly, is a covered porch where you can stand and watch rain without getting wet.',
    greet: 'Good evening,', sign: 'Very best,',
    types: ['house', 'cafe'],
  },
  {
    id: 'small-town-mayor', tone: 'grand', company: 'always',
    quirk: 'wants the building to be photographed',
    quirkLine: 'Be aware that this will be photographed for the town\'s anniversary, so the side that faces the street has to be worth the photograph.',
    greet: 'Dear architect,', sign: 'Yours faithfully,',
    types: ['library', 'kindergarten', 'clinic', 'office'],
  },
  {
    id: 'physiotherapist', tone: 'brisk', company: 'maybe',
    quirk: 'measures every door by whether a wheelchair turns after it',
    quirkLine: 'I will test every door by asking whether a wheelchair can still turn once it is through, because that is the half everyone forgets.',
    greet: 'Hello,', sign: 'Best regards,',
    types: ['clinic', 'kindergarten'],
  },
  {
    id: 'second-generation-grocer', tone: 'dry', company: 'maybe',
    quirk: 'inherited a shop and a lot of shelving',
    quirkLine: 'I inherited the family shelving along with the business, so please do not design anything that only works with bespoke joinery.',
    greet: 'Good morning,', sign: 'Regards,',
    types: ['shop', 'cafe'],
  },
  {
    id: 'amateur-astronomer', tone: 'playful', company: 'never',
    quirk: 'wants somewhere to put a telescope',
    quirkLine: 'Somewhere on this building there needs to be a flat, unlit spot where a person can stand with a telescope and not be seen doing it.',
    greet: 'Hello,', sign: 'Clear skies,',
    types: ['house', 'apartment', 'office'],
  },
  {
    id: 'foundation-director', tone: 'anxious', company: 'always',
    quirk: 'the money is a grant and the grant has an auditor',
    quirkLine: 'Every credit here is grant money with an auditor attached to it, so an overrun is not a conversation we can have — it is a form I have to fill in.',
    greet: 'Dear architect,', sign: 'Kind regards,',
    types: ['kindergarten', 'library', 'clinic'],
  },
  {
    id: 'furniture-maker', tone: 'warm', company: 'maybe',
    quirk: 'will build the fitted furniture in their own workshop',
    quirkLine: 'I will be making the fitted furniture myself in my own workshop, so give me honest flat walls and I will do the rest.',
    greet: 'Hello,', sign: 'All the best,',
    types: ['house', 'shop', 'cafe'],
  },
  {
    id: 'ex-teacher-headmistress', tone: 'brisk', company: 'always',
    quirk: 'thinks cloakrooms decide whether a morning goes well',
    quirkLine: 'Thirty years in schools taught me that the cloakroom decides whether the whole morning goes well, so please give it more room than feels reasonable.',
    greet: 'Good morning,', sign: 'Regards,',
    types: ['kindergarten', 'library'],
  },
];

// Sentence banks keyed by tone. {…} placeholders are filled by index.js.
export const VOICE = {
  warm: {
    intro: [
      'We have finally bought the plot at {address} and we would very much like you to design {article} {typeName} on it.',
      'After a long search we have the land at {address}, and we would love you to make {article} {typeName} out of it.',
    ],
    programLead: ['What we are hoping for is', 'What we picture is', 'What we need inside it is'],
    site: [
      'The street runs along the {streetSide} side, so that is where people will arrive from.',
      'People will come from the {streetSide} side, where the street is.',
    ],
    money: [
      'We have set aside {budget} for the build, which we know is not endless, and we would love to see a design in about {weeks} weeks.',
      'Our budget is {budget} and we are hoping for drawings in roughly {weeks} weeks.',
    ],
    close: ['Take your time with it, and tell us honestly if we are asking too much.', 'Do tell us if any of this is unreasonable — we would rather hear it now.'],
  },
  brisk: {
    intro: [
      'We are building {article} {typeName} at {address} and I would like you to draw it.',
      'Site secured at {address}. I need {article} {typeName} on it and I need it to work.',
    ],
    programLead: ['The programme is simple:', 'Here is what it has to hold:', 'It has to contain'],
    site: [
      'The street is on the {streetSide} side and the entrance goes there, no arguments.',
      'Access is from the {streetSide}. The front door belongs on that side.',
    ],
    money: [
      'Budget is {budget}. You have {weeks} weeks.',
      '{budget} to build, {weeks} weeks to design. Both are firm.',
    ],
    close: ['Send me a plan, not a mood board.', 'Draw it, cost it, send it.'],
  },
  pedantic: {
    intro: [
      'I am writing to commission {article} {typeName} on the plot at {address}.',
      'This letter concerns a proposed {typeName} at {address}, for which I would like your design.',
    ],
    programLead: ['The accommodation required is as follows:', 'The schedule of accommodation is', 'The building must provide'],
    site: [
      'The site addresses the street on its {streetSide} boundary, and the principal entrance must face it.',
      'The public frontage is the {streetSide} boundary; the entrance is to be taken from there.',
    ],
    money: [
      'The construction budget is {budget}, and I expect the design within {weeks} weeks.',
      'I have allowed {budget} for construction and {weeks} weeks for design.',
    ],
    close: ['I would be grateful for dimensioned plans rather than impressions.', 'Please annotate your drawings; I will read the annotations.'],
  },
  anxious: {
    intro: [
      'I hope this is the right way to go about it — we have a plot at {address} and we need {article} {typeName} on it.',
      'We have never done anything like this before, but we own the land at {address} and we need {article} {typeName}.',
    ],
    programLead: ['We think we need', 'As far as we can work out we need', 'Our list, for what it is worth, is'],
    site: [
      'The street is on the {streetSide} side, which we assume decides where the door goes.',
      'Everything arrives from the {streetSide}, where the street is.',
    ],
    money: [
      'We have {budget} and honestly not a credit more, and we would need the drawings inside {weeks} weeks.',
      'The budget is {budget}, which frightens us a little, and we have about {weeks} weeks before we have to decide.',
    ],
    close: ['Please tell us if we have got any of this badly wrong.', 'If something here is impossible, say so early rather than late.'],
  },
  grand: {
    intro: [
      'I have acquired the ground at {address} and I intend to put {article} {typeName} on it.',
      'The plot at {address} is mine, and it deserves {article} {typeName} worth walking past.',
    ],
    programLead: ['The building shall hold', 'What it must contain is', 'It is to accommodate'],
    site: [
      'The street lies to the {streetSide}, and the building should turn its best face that way.',
      'It presents itself to the {streetSide}, where the street is, and it should do so well.',
    ],
    money: [
      'I have committed {budget} to the construction and I would like the design in {weeks} weeks.',
      'The sum available is {budget}, and {weeks} weeks is all the time I am prepared to wait.',
    ],
    close: ['Do not give me something forgettable.', 'I would rather be argued with than agreed with badly.'],
  },
  dry: {
    intro: [
      'We hold the plot at {address} and require {article} {typeName} designed on it.',
      'Subject: {article} {typeName} at {address}. We own it, we want it built.',
    ],
    programLead: ['Required:', 'The scheme has to deliver', 'The building needs'],
    site: [
      'Street frontage is the {streetSide} boundary; the entrance goes there.',
      'Frontage: {streetSide}. Entrance from the frontage.',
    ],
    money: [
      'Construction budget {budget}. Design due in {weeks} weeks.',
      'We have {budget} and {weeks} weeks. Neither number moves.',
    ],
    close: ['Efficiency will be appreciated more than expression.', 'A tight plan beats a clever one.'],
  },
  earnest: {
    intro: [
      'This project matters a great deal to me, and it sits on the plot at {address}: {article} {typeName}.',
      'I have wanted to do this for years, and now there is a plot at {address} for {article} {typeName}.',
    ],
    programLead: ['What it needs to hold is', 'It has to make room for', 'The rooms I need are'],
    site: [
      'The street comes in from the {streetSide}, so that is the side people will see first.',
      'People approach from the {streetSide}, which makes that side the one that speaks first.',
    ],
    money: [
      'I can spend {budget} on building it, and I would like to see a design in {weeks} weeks.',
      'I have {budget} for the works, and about {weeks} weeks before I need to decide.',
    ],
    close: ['I would rather it be honest than impressive.', 'Please make it something people are glad to be inside.'],
  },
  playful: {
    intro: [
      'So: we bought a plot at {address}, and now we need {article} {typeName} to go on it.',
      'Good news, we own land at {address}. Bad news, it is empty. Please put {article} {typeName} on it.',
    ],
    programLead: ['The shopping list is', 'Here is the wish list:', 'We need, roughly,'],
    site: [
      'The street is on the {streetSide} side, so that is where the front door lives.',
      'Everyone turns up from the {streetSide}. Put the door where they arrive.',
    ],
    money: [
      'We have {budget} to spend and about {weeks} weeks before anyone panics.',
      'Budget: {budget}. Timeline: {weeks} weeks. Panic level: currently low.',
    ],
    close: ['Surprise us, but only in the good way.', 'Have fun with it, within reason and within budget.'],
  },
};

export function personasForType(typeKey) {
  const fits = PERSONAS.filter(p => p.types.length === 0 || p.types.includes(typeKey));
  return fits.length ? fits : PERSONAS;
}
