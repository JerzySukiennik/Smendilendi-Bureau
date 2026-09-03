// The client's e-mail.
//
// Everything in it is assembled from the Report. Same report in, byte-identical
// e-mail out — there is no randomness anywhere in this file. What changes is
// the client's voice, which comes from brief.client.tone.

import { SEVERITY_RANK } from './issues.js';

const money = (v) => Math.round(v ?? 0).toLocaleString('en-GB').replace(/,/g, ' ');

export const TONES = {
  warm: {
    greet: (c) => `Dear all,`,
    opener: () => `Thank you for the drawings — I have had a proper look and there is a great deal here I like.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k === 1 ? 'One thing' : `${k} things`} I am afraid I cannot live with`,
      soft: (k) => `${k === 1 ? 'one' : k} I would simply rather you changed`,
      none: `Nothing in it stops me, which is not something I say often.`,
    }),
    mustLead: `Before I can sign anything off, these have to change:`,
    minorLead: `And a few smaller things, only if you have the time:`,
    close: () => `None of it is a disaster. Have a go and send it back to me.`,
    sign: `Warmly,`,
  },
  brisk: {
    greet: () => `Hi,`,
    opener: () => `Looked at the drawings. Notes below, in order.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k} blocking`,
      soft: (k) => `${k} to tidy`,
      none: `Nothing blocking.`,
    }),
    mustLead: `Must change:`,
    minorLead: `Would be good:`,
    close: () => `Turn it round and we are done.`,
    sign: `Regards,`,
  },
  pedantic: {
    greet: () => `Dear Sir or Madam,`,
    opener: () => `I have measured the drawings you sent me. My findings follow, in order of seriousness.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k} ${k === 1 ? 'item does' : 'items do'} not comply`,
      soft: (k) => `${k} ${k === 1 ? 'is' : 'are'} a matter of quality`,
      none: `I find nothing that fails to comply.`,
    }),
    mustLead: `The following must be corrected before I can approve the set:`,
    minorLead: `The following are matters of quality rather than compliance:`,
    close: () => `I should be grateful for the corrected drawings by return.`,
    sign: `Yours faithfully,`,
  },
  anxious: {
    greet: () => `Hello,`,
    opener: () => `I have been through the drawings a few times now. I hope I am not being difficult, but a few things worry me.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k} ${k === 1 ? 'thing is' : 'things are'} keeping me awake`,
      soft: (k) => `${k} ${k === 1 ? 'is' : 'are'} probably nothing`,
      none: `I could not find anything really wrong, which worries me slightly on its own.`,
    }),
    mustLead: `These are the ones I cannot get past:`,
    minorLead: `And these are probably nothing, but while I am writing:`,
    close: () => `Please tell me if I have misread any of it — I would rather be wrong than difficult.`,
    sign: `Best,`,
  },
  // The commission generator writes briefs in eight voices (see VOICE in
  // src/commission/clients.js). Four of them had no reply voice here, so half
  // of all clients wrote their brief as a gallerist or a startup founder and
  // answered it as somebody else entirely. The same eight, and no more.
  grand: {
    greet: () => `Dear architect,`,
    opener: () => `I have studied the drawings. There is ambition in them, which is the hardest part to buy.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k === 1 ? 'one point' : `${k} points`} I will not concede`,
      soft: (k) => `${k === 1 ? 'one' : k} I leave to your judgement`,
      none: `I find nothing I would refuse.`,
    }),
    mustLead: `These are not negotiable:`,
    minorLead: `These I mention only because I noticed them:`,
    close: () => `Bring it back to me with those settled and we shall build it.`,
    sign: `Yours,`,
  },
  dry: {
    greet: () => `Dear architect,`,
    opener: () => `Drawings received and checked against the brief. Findings below.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k} non-compliant`,
      soft: (k) => `${k} noted`,
      none: `No non-compliances.`,
    }),
    mustLead: `To be corrected:`,
    minorLead: `For information:`,
    close: () => `Revised drawings to the same address, please.`,
    sign: `Regards,`,
  },
  earnest: {
    greet: () => `Good morning,`,
    opener: () => `I have spent a long evening with the drawings, and I can see what you were after.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k === 1 ? 'one thing' : `${k} things`} I honestly cannot live with`,
      soft: (k) => `${k === 1 ? 'one' : k} I would only mention in passing`,
      none: `I could not find anything I would ask you to change.`,
    }),
    mustLead: `These are the ones that matter to me:`,
    minorLead: `And these, only if they are easy:`,
    close: () => `Thank you for taking it seriously. I know I am not an easy client.`,
    sign: `With thanks,`,
  },
  playful: {
    greet: () => `Hey,`,
    opener: () => `Right — drawings opened, coffee made, red pen found.`,
    tally: (b, j, n) => tally(b, j, n, {
      hard: (k) => `${k} genuine ${k === 1 ? 'problem' : 'problems'}`,
      soft: (k) => `${k} ${k === 1 ? 'nitpick' : 'nitpicks'}`,
      none: `Nothing broken, which I did not expect.`,
    }),
    mustLead: `The real ones:`,
    minorLead: `The nitpicks:`,
    close: () => `Fix those and I will stop reading plans at midnight.`,
    sign: `Cheers,`,
  },
};

function tally(blockers, majors, minors, words) {
  const hard = blockers + majors;
  if (hard === 0 && minors === 0) return words.none;
  if (hard === 0) return `${cap(words.soft(minors))}, nothing more.`;
  if (minors === 0) return `${cap(words.hard(hard))}.`;
  return `${cap(words.hard(hard))}, and ${words.soft(minors)}.`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function toneOf(brief) {
  const t = String(brief?.client?.tone ?? 'warm').toLowerCase();
  return TONES[t] ?? TONES.warm;
}

function projectName(brief) {
  return brief?.title ?? brief?.name ?? brief?.projectName ?? 'the project';
}

function clientName(brief) {
  return brief?.client?.name ?? 'The client';
}

function bullet(issue) {
  return `  - ${issue.clientText}`;
}

function budgetLine(report, brief) {
  const c = report?.metrics?.cost;
  if (!c || !c.budget) return null;
  const diff = c.total - c.budget;
  if (diff > 0) return `The bill as drawn is ${money(c.total)} against ${money(c.budget)} — ${money(diff)} over.`;
  return `The bill as drawn is ${money(c.total)} against ${money(c.budget)}, so we are inside the budget by ${money(-diff)}.`;
}

/**
 * revisionMail(report, brief) -> { subject, body, from, tone }
 * The e-mail the client sends back after the first submission.
 */
export function revisionMail(report, brief = {}) {
  const tone = toneOf(brief);
  const issues = [...(report?.issues ?? [])].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
  // HOW MANY THINGS A CLIENT ACTUALLY SAYS AT ONCE.
  //
  // This letter used to list every issue the engine found. On a first attempt
  // that is routinely ten or more, and Jurek stopped playing because of it:
  // DESIGN-DECISIONS.md "Difficulty" now caps what the player is handed. A
  // client who lists ten faults is not giving feedback, he is refusing the job.
  //
  // The engine still finds all of them — nothing here weakens the analysis, and
  // `report.issues` is untouched for the cost sheet and the validation panel.
  // The LETTER just leads with the few that matter most, in severity order, and
  // says plainly that there is more underneath rather than pretending there is
  // not. Fix these, resubmit, and the next letter surfaces the next ones.
  const MUST_SHOWN = 3;
  const NICE_SHOWN = 1;
  const allMust = issues.filter(i => i.severity === 'blocker' || i.severity === 'major');
  const allNice = issues.filter(i => i.severity === 'minor');
  const must = allMust.slice(0, MUST_SHOWN);
  const nice = allNice.slice(0, NICE_SHOWN);
  const hiddenMust = allMust.length - must.length;
  const blockers = issues.filter(i => i.severity === 'blocker').length;
  const majors = issues.filter(i => i.severity === 'major').length;

  const lines = [];
  lines.push(tone.greet(brief));
  lines.push('');
  lines.push(`${tone.opener()} ${tone.tally(blockers, majors, nice.length)}`);

  if (must.length) {
    lines.push('');
    lines.push(tone.mustLead);
    for (const i of must) lines.push(bullet(i));
    // Honest about the rest rather than silently hiding it. One sentence, no list.
    if (hiddenMust > 0) {
      lines.push(hiddenMust === 1
        ? '  - ...and one more of the same sort, which I will point out once these are sorted.'
        : `  - ...and ${hiddenMust} more of the same sort. Sort these first and we will get to them.`);
    }
  }
  if (nice.length) {
    lines.push('');
    lines.push(tone.minorLead);
    for (const i of nice) lines.push(bullet(i));
  }

  const budget = budgetLine(report, brief);
  if (budget && !must.some(i => i.module === 'cost') && !nice.some(i => i.module === 'cost')) {
    lines.push('');
    lines.push(budget);
  }

  lines.push('');
  lines.push(tone.close());
  lines.push('');
  lines.push(tone.sign);
  lines.push(clientName(brief));

  return {
    subject: subjectFor(brief, must.length, false),
    from: clientName(brief),
    tone: String(brief?.client?.tone ?? 'warm'),
    body: lines.join('\n'),
  };
}

/** The e-mail when the client is happy. */
export function acceptanceMail(report, brief = {}) {
  const tone = toneOf(brief);
  const nice = (report?.issues ?? []).filter(i => i.severity === 'minor');
  const lines = [];
  lines.push(tone.greet(brief));
  lines.push('');
  lines.push(`${ACCEPT_OPENER[String(brief?.client?.tone ?? 'warm')] ?? ACCEPT_OPENER.warm} It scores ${report?.score ?? 100} out of 100 on my own reckoning.`);

  const budget = budgetLine(report, brief);
  if (budget) {
    lines.push('');
    lines.push(budget);
  }

  if (nice.length) {
    lines.push('');
    lines.push(`Small things I noticed, for the next one rather than this one:`);
    for (const i of nice) lines.push(bullet(i));
  }

  lines.push('');
  lines.push(ACCEPT_CLOSE[String(brief?.client?.tone ?? 'warm')] ?? ACCEPT_CLOSE.warm);
  lines.push('');
  lines.push(tone.sign);
  lines.push(clientName(brief));

  return {
    subject: subjectFor(brief, 0, true),
    from: clientName(brief),
    tone: String(brief?.client?.tone ?? 'warm'),
    body: lines.join('\n'),
  };
}

const ACCEPT_OPENER = {
  warm: 'This is it. I walked through it in my head this morning and it works.',
  brisk: 'Approved. It works.',
  pedantic: 'I have measured the revised set and I am satisfied that it complies.',
  anxious: 'I have read it four times looking for the problem and I cannot find one.',
  grand: 'That is the building I asked for, and rather more besides.',
  dry: 'Revised set checked. Compliant.',
  earnest: 'I sat with the revised drawings for an hour and I would not change a thing.',
  playful: 'Well. You went and fixed it.',
};

const ACCEPT_CLOSE = {
  warm: 'Build it. Thank you — genuinely.',
  brisk: 'Go to tender.',
  pedantic: 'You may proceed to the next stage.',
  anxious: 'Please go ahead before I think of something else.',
  grand: 'Have it built, and have it built properly.',
  dry: 'Proceed to tender.',
  earnest: 'Thank you. I mean that.',
  playful: 'Ship it. First round is on me.',
};

function subjectFor(brief, mustCount, accepted) {
  const name = projectName(brief);
  if (accepted) return `${name} — approved`;
  if (mustCount === 0) return `${name} — almost there`;
  return `${name} — ${mustCount} ${mustCount === 1 ? 'change' : 'changes'} before I can sign it off`;
}

/** Whichever e-mail this report deserves. */
export function clientMail(report, brief = {}) {
  return report?.accepted ? acceptanceMail(report, brief) : revisionMail(report, brief);
}
