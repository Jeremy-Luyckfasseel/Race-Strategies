/**
 * Tests for src/logic/gaps.js — leaderboard intervals from line crossings.
 *
 * The case that drove this: the old column subtracted the two cars' most
 * recent LAP TIMES, so two cars thirty seconds apart running identical laps
 * showed no gap at all, while one slow lap looked like losing that much time.
 *
 * Run with: node tests/test_gaps.js
 */

import { trackLapCrossings, lapInterval, formatInterval } from '../src/logic/gaps.js';

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
  assert('a lap down shows laps, not seconds',
    formatInterval(lapInterval({ lap: 14, crossedAt: 0 }, { lap: 13, crossedAt: 0 })) === '+1L');
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

  // A lap difference is straight from GT7's counter and is trustworthy at once.
  let d = trackLapCrossings(new Map(), new Map([['a', pkt(9, 0)], ['b', pkt(8, 0)]]));
  assert('but a lap down is reported immediately',
    formatInterval(lapInterval(d.get('a'), d.get('b'))) === '+1L');
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
  assert('a car still on the old lap reads as a lap down',
    formatInterval(lapInterval(c.get('lead'), c.get('back'))) === '+1L');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
