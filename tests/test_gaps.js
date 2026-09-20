/**
 * Tests for src/logic/gaps.js — leaderboard intervals from line crossings.
 *
 * The case that drove this: the old column subtracted the two cars' most
 * recent LAP TIMES, so two cars thirty seconds apart running identical laps
 * showed no gap at all, while one slow lap looked like losing that much time.
 *
 * Run with: node tests/test_gaps.js
 */

import {
  trackLapCrossings, lapInterval, formatInterval, lapProgress, liveInterval, lapsOnMe,
} from '../src/logic/gaps.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

const pkt = (currentLap, ts) => ({ currentLap, ts });

section('trackLapCrossings — stamps each new lap, by packet arrival time');
{
  let crossings = new Map();
  crossings = trackLapCrossings(crossings, new Map([['a', pkt(3, 10_000)]]));
  assert('records the crossing', crossings.get('a').lap === 3);
  assert('uses the packet\'s own arrival stamp, not the flush time',
    crossings.get('a').crossedAt === 10_000);

  // More packets on the same lap must not move the crossing time — the car
  // crossed once, and re-stamping every packet would zero every gap.
  const same = trackLapCrossings(crossings, new Map([['a', pkt(3, 11_000)]]));
  assert('further packets on the same lap change nothing', same === crossings);
  assert('and the original crossing time stands', same.get('a').crossedAt === 10_000);

  const next = trackLapCrossings(crossings, new Map([['a', pkt(4, 122_000)]]));
  assert('a new lap re-stamps', next.get('a').crossedAt === 122_000 && next.get('a').lap === 4);
  assert('and is a real, witnessed crossing', next.get('a').witnessed === true);
  assert('and does not mutate the previous map', crossings.get('a').lap === 3);

  assert('a car with no lap yet is ignored',
    trackLapCrossings(new Map(), new Map([['x', pkt(0, 1)]])).size === 0);
}

section('lapInterval — the gap the old code could not see');
{
  // Two cars on the same lap, thirty seconds apart, running identical pace.
  // The old rule subtracted last-lap times, got zero, and showed nothing.
  const ahead = { lap: 12, crossedAt: 100_000, witnessed: true };
  const behind = { lap: 12, crossedAt: 130_000, witnessed: true };
  const gap = lapInterval(ahead, behind);
  assert('reports the real 30 s gap', gap.secs === 30, JSON.stringify(gap));
  assert('formats it', formatInterval(gap) === '+30.0s');
}

section('lapInterval — lapped cars');
{
  // ONE lap on the counter is not evidence of being lapped. Between the car
  // ahead crossing the line and the car three seconds behind it crossing, the
  // counters differ by one for every pair in the field — so with nothing to
  // measure a lap duration against, one lap means "cannot tell yet".
  assert('one lap on the counter alone says nothing',
    lapInterval({ lap: 14, crossedAt: 0 }, { lap: 13, crossedAt: 0 }) === null);

  // With the leader's previous crossing there IS something to measure against:
  // a 120 s lap, and the car behind began its lap before that lap started.
  const reallyLapped = lapInterval(
    { lap: 14, crossedAt: 220_000, prevCrossedAt: 100_000 },
    { lap: 13, crossedAt: 95_000, witnessed: true },
  );
  assert('a lap down does show laps once it can be told from a gap',
    formatInterval(reallyLapped) === '+1L', JSON.stringify(reallyLapped));

  // Two or more is unambiguous whatever the timestamps say.
  assert('two laps down',
    formatInterval(lapInterval({ lap: 15, crossedAt: 0 }, { lap: 13, crossedAt: 0 })) === '+2L');
}

section('lapInterval — refuses to invent a number');
{
  assert('null when the car ahead has not crossed yet',
    lapInterval(undefined, { lap: 2, crossedAt: 1, witnessed: true }) === null);
  assert('null when the car behind has not crossed yet',
    lapInterval({ lap: 2, crossedAt: 1, witnessed: true }, undefined) === null);
  assert('null rather than a negative gap if the ranking disagrees with timing',
    lapInterval({ lap: 12, crossedAt: 130_000, witnessed: true }, { lap: 12, crossedAt: 100_000, witnessed: true }) === null);
  assert('null when the supposedly-behind car is on a later lap',
    lapInterval({ lap: 12, crossedAt: 0, witnessed: true }, { lap: 13, crossedAt: 0, witnessed: true }) === null);
  assert('formatInterval passes null straight through', formatInterval(null) === null);
}

section('joining mid-race — no fictitious dead heat');
{
  // Caught by the multi-car integration test: on startup every car is stamped
  // at the instant the app first sees it, so a field strung out over half a
  // minute compared as simultaneous and every gap read about zero.
  let c = new Map();
  c = trackLapCrossings(c, new Map([
    ['lead', pkt(5, 1_000)],
    ['mid', pkt(5, 1_000)],   // same flush: identical stamps, unrelated positions
  ]));
  assert('no interval is claimed from two first sightings',
    lapInterval(c.get('lead'), c.get('mid')) === null);
  assert('so the column shows nothing rather than a false dead heat',
    formatInterval(lapInterval(c.get('lead'), c.get('mid'))) === null);

  // A ONE-lap difference is not: the car ahead has crossed and the car right
  // behind it has not, which is the normal state of every close fight for part
  // of every lap. Claiming "+1L" there is what put a lapped marker on the car
  // being raced during the opening laps of a real session.
  let d = trackLapCrossings(new Map(), new Map([['a', pkt(9, 0)], ['b', pkt(8, 0)]]));
  assert('one lap apart on first sighting is still not called',
    lapInterval(d.get('a'), d.get('b')) === null);

  // Two laps needs no corroboration — no close fight spans two lap counters.
  let e = trackLapCrossings(new Map(), new Map([['a', pkt(10, 0)], ['b', pkt(8, 0)]]));
  assert('but two laps down is reported immediately',
    formatInterval(lapInterval(e.get('a'), e.get('b'))) === '+2L');
}

section('a three-car field over two laps');
{
  let c = new Map();
  // First sighting — provisional for everyone.
  c = trackLapCrossings(c, new Map([
    ['lead', pkt(4, -118_000)],
    ['mid', pkt(4, -118_000)],
    ['back', pkt(4, -118_000)],
  ]));
  assert('nothing is reported before a lap has been witnessed',
    lapInterval(c.get('lead'), c.get('mid')) === null);

  // Now each car is actually seen crossing into lap 5, a few seconds apart.
  c = trackLapCrossings(c, new Map([['lead', pkt(5, 0)]]));
  c = trackLapCrossings(c, new Map([['mid', pkt(5, 2_500)]]));
  c = trackLapCrossings(c, new Map([['back', pkt(5, 9_000)]]));
  assert('mid is 2.5 s off the lead', formatInterval(lapInterval(c.get('lead'), c.get('mid'))) === '+2.5s');
  assert('back is 6.5 s off mid', formatInterval(lapInterval(c.get('mid'), c.get('back'))) === '+6.5s');

  // Next lap the midfielder has closed right up.
  c = trackLapCrossings(c, new Map([['lead', pkt(6, 120_000)]]));
  c = trackLapCrossings(c, new Map([['mid', pkt(6, 120_400)]]));
  assert('the closed gap shows at the next crossing',
    formatInterval(lapInterval(c.get('lead'), c.get('mid'))) === '+0.4s');
  // This assertion used to expect '+1L', which was the bug rather than the
  // rule: `back` crossed the line 9 s after `lead` on lap 5 and is nine
  // seconds behind, not a lap down. Reading the counter alone, every close
  // fight flipped to "+1L" the instant the car in front started a new lap and
  // flipped back when the car behind followed it — once per lap, all race.
  assert('a car still on the old lap reads as the seconds it actually is',
    formatInterval(lapInterval(c.get('lead'), c.get('back'))) === '+9.0s',
    String(formatInterval(lapInterval(c.get('lead'), c.get('back')))));
}

section('lapInterval — telling "not crossed yet" apart from "a lap down"');
{
  // Both cases show lapDiff === 1. What separates them is how long ago the
  // leader's previous crossing was, measured against its own lap time.
  const pkt = (lap, ts) => new Map([['x', { currentLap: lap, ts }]]);

  // 100 s laps. The leader is on lap 10, having crossed at 1000 s and 900 s.
  let lead = trackLapCrossings(new Map(), pkt(8, 800_000));
  lead = trackLapCrossings(lead, pkt(9, 900_000));
  lead = trackLapCrossings(lead, pkt(10, 1_000_000));
  const ahead = lead.get('x');

  // A car three seconds back has not reached the line yet: still on lap 9.
  let close = trackLapCrossings(new Map(), pkt(8, 803_000));
  close = trackLapCrossings(close, pkt(9, 903_000));
  assert('three seconds back reads as three seconds, not a lap',
    formatInterval(lapInterval(ahead, close.get('x'))) === '+3.0s',
    String(formatInterval(lapInterval(ahead, close.get('x')))));

  // A car genuinely a lap down starts its lap 9 AFTER the leader has already
  // started its lap 10 — that is what being lapped is. The measured interval
  // then exceeds the leader's own lap time, which is the discriminator.
  let lapped = trackLapCrossings(new Map(), pkt(8, 905_000));
  lapped = trackLapCrossings(lapped, pkt(9, 1_005_000));
  assert('a car a full lap back still reads as a lap down',
    formatInterval(lapInterval(ahead, lapped.get('x'))) === '+1L',
    String(formatInterval(lapInterval(ahead, lapped.get('x')))));

  // Two laps or more never needs the crossing times.
  let miles = trackLapCrossings(new Map(), pkt(7, 700_000));
  miles = trackLapCrossings(miles, pkt(8, 800_000));
  assert('two laps down is reported straight from the counter',
    formatInterval(lapInterval(ahead, miles.get('x'))) === '+2L');
}

section('a ten-car field strung out down the road');
{
  // Replays the shape scripts/fake-field.mjs produces: ten cars on a 90 s lap,
  // each 540 ms behind the one in front, every car's packet emitted on the same
  // 60 Hz tick. Added after a live run appeared to show whole-second gaps — this
  // proves the interval maths itself is not the cause.
  const LAP = 90_000, HZ = 60, CARS = 10, SPACING = 0.006;
  let c = new Map();
  for (let e = 0; e <= 100_000; e += 1000 / HZ) {
    const batch = new Map();
    for (let i = 0; i < CARS; i++) {
      const progress = e / LAP - i * SPACING;
      batch.set(`car${i}`, { currentLap: Math.max(1, Math.floor(progress) + 1), ts: e });
    }
    c = trackLapCrossings(c, batch);
  }

  assert('every car has crossed and been witnessed',
    [...c.values()].every((r) => r.witnessed && r.lap === 2));

  const expected = (LAP * SPACING) / 1000;   // 0.54 s
  const intervals = [];
  for (let i = 1; i < CARS; i++) {
    intervals.push(lapInterval(c.get(`car${i - 1}`), c.get(`car${i}`)).secs);
  }
  assert('every adjacent pair reports the real spacing, not a rounded second',
    intervals.every((s) => Math.abs(s - expected) < 0.05),
    JSON.stringify(intervals.map((s) => +s.toFixed(3))));
  assert('none of them collapses to zero', intervals.every((s) => s > 0.4));
  assert('so the field spans about five seconds end to end',
    Math.abs(intervals.reduce((a, b) => a + b, 0) - expected * (CARS - 1)) < 0.2);
}

section('lapProgress — where a car is around the lap, between crossings');
{
  const pkt = (lap, ts, lastLapMs) => new Map([['x', { currentLap: lap, ts, lastLapMs }]]);
  let c = trackLapCrossings(new Map(), pkt(4, 0, 90_000));
  c = trackLapCrossings(c, pkt(5, 90_000, 90_000));
  const rec = c.get('x');

  assert('at the line it is exactly the lap', lapProgress(rec, 90_000) === 5);
  assert('a third of a lap later it is a third in',
    Math.abs(lapProgress(rec, 90_000 + 30_000) - 5.3333) < 0.001,
    String(lapProgress(rec, 90_000 + 30_000)));
  assert('it never runs past the line on a slower lap',
    lapProgress(rec, 90_000 + 200_000) === 6,
    String(lapProgress(rec, 90_000 + 200_000)));

  const unseen = trackLapCrossings(new Map(), pkt(5, 0, 90_000)).get('x');
  assert('a car only just sighted cannot be placed', lapProgress(unseen, 1000) === null);

  let noTime = trackLapCrossings(new Map(), pkt(4, 0, 0));
  noTime = trackLapCrossings(noTime, pkt(5, 90_000, 0));
  assert('nor can one with no lap time yet', lapProgress(noTime.get('x'), 95_000) === null);
}

section('liveInterval — the gap moves between crossings, not once a lap');
{
  const feed = (lap, ts) => new Map([['x', { currentLap: lap, ts, lastLapMs: 90_000 }]]);
  const build = (offset) => {
    let c = trackLapCrossings(new Map(), feed(4, offset));
    c = trackLapCrossings(c, feed(5, offset + 90_000));
    return c.get('x');
  };
  // Leader crossed into lap 5 at t=90s; a car 3 s back crossed at t=93s.
  const ahead = build(0);
  const behind = build(3_000);

  const atCrossing = liveInterval(ahead, behind, 93_000);
  assert('three seconds at the moment both have crossed',
    Math.abs(atCrossing.secs - 3) < 0.01, JSON.stringify(atCrossing));
  assert('and it is flagged as a live estimate', atCrossing.live === true);

  const later = liveInterval(ahead, behind, 120_000);
  assert('it still reads three seconds half a lap later, not a frozen number',
    Math.abs(later.secs - 3) < 0.01, JSON.stringify(later));

  assert('a negative ranking says nothing rather than a negative gap',
    liveInterval(behind, ahead, 120_000) === null);

  // A car in the pits stops covering ground; do not invent progress for it.
  const boxed = liveInterval(ahead, behind, 200_000, true);
  assert('a boxed car falls back to the crossing-based interval',
    boxed !== null && boxed.live !== true, JSON.stringify(boxed));

  // Without a witnessed lap it must degrade to the old behaviour, not to null.
  const fresh = trackLapCrossings(new Map(), feed(5, 0)).get('x');
  assert('an unplaceable car falls back instead of vanishing',
    liveInterval(ahead, fresh, 95_000) === lapInterval(ahead, fresh));
}

section('who is traffic and who is a rival');
{
  // On the map every dot looks the same, so a car about to be lapped is
  // indistinguishable from one you are fighting — and they call for opposite
  // things. This is the number that separates them.
  const me = { lap: 40, crossedAt: 100_000, prevCrossedAt: 0, witnessed: true };

  assert('a car on my lap is a rival, not traffic',
    lapsOnMe(me, { lap: 40, crossedAt: 103_000, witnessed: true }) === null);

  assert('two laps down reads as two laps down',
    lapsOnMe(me, { lap: 38, crossedAt: 100_000, witnessed: true }) === -2);

  assert('and a car two laps up reads the other way',
    lapsOnMe(me, { lap: 42, crossedAt: 100_000, witnessed: true }) === 2);

  // The whole reason this goes through lapInterval: between their crossing and
  // mine, a car three seconds ahead of me is on a higher lap number.
  // Subtracting counters would put "+1L" on it for part of every lap — on the
  // car I am actually racing, which is the one dot that must stay clean.
  // Both started lap 40 on a 120 s lap: them at t=100s, me three seconds later.
  // They have now started lap 41 while I am still on 40.
  const meMidLap = { lap: 40, crossedAt: 103_000, prevCrossedAt: 0, witnessed: true };
  const justAhead = { lap: 41, crossedAt: 220_000, prevCrossedAt: 100_000, witnessed: true };
  assert('a car three seconds ahead that has just crossed is still a rival',
    lapsOnMe(meMidLap, justAhead) === null, String(lapsOnMe(meMidLap, justAhead)));

  // ...while one genuinely a lap down does read as lapped, by the same
  // discriminator: a whole lap elapsed between the two crossings.
  // They began their lap 39 BEFORE I began my lap 40 — a whole lap apart, not
  // a hundred-and-something seconds within the same one.
  const meLapped = { lap: 40, crossedAt: 220_000, prevCrossedAt: 100_000, witnessed: true };
  const aLapDown = { lap: 39, crossedAt: 95_000, prevCrossedAt: 0, witnessed: true };
  assert('but a car a full lap behind does read as lapped',
    lapsOnMe(meLapped, aLapDown) === -1, String(lapsOnMe(meLapped, aLapDown)));

  // And the boundary the discriminator actually draws: a car nearly a lap
  // behind but still inside my current lap is 118 s back, not lapped. Calling
  // that "-1L" would put a lapped marker on a car still on the same lap.
  const nearlyALap = { lap: 39, crossedAt: 218_000, prevCrossedAt: 0, witnessed: true };
  assert('a car 118s back on a 120s lap is not yet lapped',
    lapsOnMe(meLapped, nearlyALap) === null);

  assert('a car we have never seen cross says nothing', lapsOnMe(me, null) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
