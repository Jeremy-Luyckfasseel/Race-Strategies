/**
 * Measuring what an incident cost.
 *
 * The decision that follows from it — box now or wait — lives in
 * tests/test_pit_now.js, because it is answered by the engine rather than by
 * arithmetic. An arithmetic cost model used to live here and was deleted once
 * the engine comparison replaced it.
 *
 * Run with: node tests/test_incident.js
 */

import {
  trackLapTimes, recentPace, paceBefore, paceAfter, incidentLapCostMs, detectPaceDrop,
  PACE_WINDOW,
} from '../src/logic/paceTrack.js';
import { measuredLossSecs, effectiveLossSecs } from '../src/logic/incident.js';

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

const IP = '10.0.0.3';

/**
 * Complete laps with these times. `startLap` is the lap the car is ON when it
 * starts; each completed lap is filed under the lap it belongs to.
 */
function laps(state, times, startLap = 1) {
  let s = state;
  let lap = startLap;
  // The first sighting only establishes the lap number.
  s = trackLapTimes(s, new Map([[IP, { currentLap: lap, lastLapMs: 1 }]]));
  for (const ms of times) {
    lap += 1;
    s = trackLapTimes(s, new Map([[IP, { currentLap: lap, lastLapMs: ms }]]));
  }
  return s;
}

const lapNow = (state) => state.get(IP).lap;

// ────────────────────────────────────────────────────────────────────────────

section('recording laps');
{
  let s = laps(new Map(), [90_000, 90_200, 90_100]);
  assert('three laps recorded', s.get(IP).times.length === 3, String(s.get(IP).times.length));
  assert('each filed under the lap it belongs to',
    s.get(IP).times.map((e) => e.lap).join(',') === '1,2,3',
    s.get(IP).times.map((e) => e.lap).join(','));

  const same = trackLapTimes(s, new Map([[IP, { currentLap: s.get(IP).lap, lastLapMs: 90_000 }]]));
  assert('the same lap is not recorded twice, by identity', same === s);

  const noTime = trackLapTimes(s, new Map([[IP, { currentLap: 99, lastLapMs: 0 }]]));
  assert('a lap with no time is skipped, by identity', noTime === s);
}

section('the window forgets, but never loses track of which lap is which');
{
  const many = Array.from({ length: 25 }, (_, i) => 90_000 + i);
  const s = laps(new Map(), many);
  const rec = s.get(IP);
  assert('only the last ten are kept', rec.times.length === PACE_WINDOW, String(rec.times.length));
  assert('and they still carry their real lap numbers',
    rec.times[rec.times.length - 1].lap === rec.lap - 1,
    `${rec.times[rec.times.length - 1].lap} vs ${rec.lap - 1}`);
}

section('pace is a median, so traffic does not become the pace');
{
  const s = laps(new Map(), [90_000, 98_000, 90_200]);
  assert('one lap stuck behind someone is ignored',
    recentPace(s.get(IP)) === 90_200, String(recentPace(s.get(IP))));
  assert('no history, no pace', recentPace(null) === null);
}

section('before, the incident lap itself, and after');
{
  // Four clean laps at ~90s, then the lap it happened on, then three at ~92s.
  let s = laps(new Map(), [90_000, 90_100, 89_900, 90_000]);
  const incidentLap = lapNow(s);           // the lap the car is on when marked
  s = laps(s, [104_000, 92_000, 92_100, 91_900], incidentLap);

  const rec = s.get(IP);
  const before = paceBefore(rec, incidentLap);
  const after = paceAfter(rec, incidentLap);

  assert('pace before is the laps before it', Math.abs(before - 90_000) < 60, String(before));
  assert('pace after skips the lap it happened on',
    Math.abs(after - 92_000) < 60, String(after));
  assert('so the ongoing loss is two seconds a lap',
    Math.abs(measuredLossSecs(before, after) - 2) < 0.1,
    String(measuredLossSecs(before, after)));
  assert('the incident lap is costed on its own',
    Math.abs(incidentLapCostMs(rec, incidentLap) - 14_000) < 100,
    String(incidentLapCostMs(rec, incidentLap)));
}

section('and it still works once the window has slid past the incident');
{
  // The bug this replaced: with the incident stored as an INDEX, everything
  // below returned null or — worse — reported the damaged laps as the pace
  // before the damage, from the eleventh lap of every race onward.
  let s = laps(new Map(), Array.from({ length: 15 }, () => 90_000));
  const incidentLap = lapNow(s);
  s = laps(s, [104_000, 93_000, 93_000, 93_000], incidentLap);

  const rec = s.get(IP);
  assert('the window has long since filled', rec.times.length === PACE_WINDOW);
  assert('pace before is still the healthy laps',
    paceBefore(rec, incidentLap) === 90_000, String(paceBefore(rec, incidentLap)));
  assert('pace after is still the damaged ones',
    paceAfter(rec, incidentLap) === 93_000, String(paceAfter(rec, incidentLap)));
  assert('and the loss is measured, not lost',
    Math.abs(measuredLossSecs(paceBefore(rec, incidentLap), paceAfter(rec, incidentLap)) - 3) < 0.01);
}

section('nothing is claimed before a lap has been completed after it');
{
  let s = laps(new Map(), [90_000, 90_100, 90_000]);
  const incidentLap = lapNow(s);
  s = laps(s, [104_000], incidentLap);

  assert('the incident lap alone gives no rate', paceAfter(s.get(IP), incidentLap) === null);
  assert('and no loss', measuredLossSecs(paceBefore(s.get(IP), incidentLap), null) === null);
}

section('a typed number wins, because the radio knows before the data does');
{
  assert('manual overrides measured', effectiveLossSecs(3.5, 2.0) === 3.5);
  assert('measured is used when nothing is typed', effectiveLossSecs('', 2.0) === 2.0);
  assert('and nothing at all is null', effectiveLossSecs('', null) === null);
  assert('a zero or negative typed value is not an override', effectiveLossSecs(0, 2.0) === 2.0);
}

section('spotting a rival who has lost pace');
{
  const steady = laps(new Map(), [90_000, 90_200, 90_100, 93_100, 93_000, 93_200]);
  const drop = detectPaceDrop(steady.get(IP));
  assert('a sustained step is caught', drop !== null && Math.abs(drop.lostMs - 3000) < 200,
    JSON.stringify(drop));
  assert('and it names the lap it started on', drop.fromLap === steady.get(IP).lap - 3,
    `${drop.fromLap} vs ${steady.get(IP).lap - 3}`);

  const slope = laps(new Map(), [90_000, 90_300, 90_600, 90_900, 91_200, 91_500]);
  assert('gradual degradation is not an incident', detectPaceDrop(slope.get(IP)) === null,
    JSON.stringify(detectPaceDrop(slope.get(IP))));

  const stop = laps(new Map(), [90_000, 90_100, 90_200, 115_000, 96_000, 90_100]);
  assert('a pit stop is not an incident', detectPaceDrop(stop.get(IP)) === null,
    JSON.stringify(detectPaceDrop(stop.get(IP))));

  const thin = laps(new Map(), [90_000, 95_000]);
  assert('too little history says nothing', detectPaceDrop(thin.get(IP)) === null);

  // A safety car slows everyone at once and DOES trip this. That is the
  // caller's to suppress — it knows whether one is deployed and this cannot.
  const sc = laps(new Map(), [90_000, 90_000, 90_000, 140_000, 140_000, 140_000]);
  assert('a caution looks exactly like damage from here, by design',
    detectPaceDrop(sc.get(IP)) !== null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
