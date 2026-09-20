/**
 * Measuring what an incident cost, and deciding what to do about it.
 *
 * Run with: node tests/test_incident.js
 */

import {
  trackLapTimes, recentPace, paceBefore, paceAfter, incidentLapCostMs, detectPaceDrop,
} from '../src/logic/paceTrack.js';
import {
  incidentDecision, measuredLossSecs, effectiveLossSecs,
  CARRY, REPAIR_AT_STOP, PIT_NOW,
} from '../src/logic/incident.js';

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

/** Complete laps with these times, in order. */
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

// ────────────────────────────────────────────────────────────────────────────

section('recording laps');
{
  let s = laps(new Map(), [90_000, 90_200, 90_100]);
  assert('three laps recorded', s.get(IP).times.length === 3, String(s.get(IP).times.length));
  assert('the first sighting is not counted as a lap', s.get(IP).times[0] === 90_000);

  const same = trackLapTimes(s, new Map([[IP, { currentLap: s.get(IP).lap, lastLapMs: 90_000 }]]));
  assert('the same lap is not recorded twice, by identity', same === s);

  const noTime = trackLapTimes(s, new Map([[IP, { currentLap: 99, lastLapMs: 0 }]]));
  assert('a lap with no time is skipped, by identity', noTime === s);
}

section('the window forgets');
{
  const many = Array.from({ length: 25 }, (_, i) => 90_000 + i);
  const s = laps(new Map(), many);
  assert('only the last ten are kept', s.get(IP).times.length === 10, String(s.get(IP).times.length));
  assert('and they are the most recent ones',
    s.get(IP).times[9] === 90_024, String(s.get(IP).times[9]));
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
  // Four clean laps at ~90s, then the lap it happened on (a long one), then
  // three laps at ~92s: two seconds a lap worse off.
  let s = laps(new Map(), [90_000, 90_100, 89_900, 90_000]);
  const beforeCount = s.get(IP).times.length;
  s = laps(s, [104_000, 92_000, 92_100, 91_900], s.get(IP).lap);

  const rec = s.get(IP);
  const before = paceBefore(rec, beforeCount);
  const after = paceAfter(rec, beforeCount);

  assert('pace before is the laps before it', Math.abs(before - 90_000) < 60, String(before));
  assert('pace after skips the lap it happened on',
    Math.abs(after - 92_000) < 60, String(after));
  assert('so the ongoing loss is two seconds a lap',
    Math.abs(measuredLossSecs(before, after) - 2) < 0.1,
    String(measuredLossSecs(before, after)));

  // And the incident lap is reported separately, as the one-off it is.
  assert('the incident lap is costed on its own',
    Math.abs(incidentLapCostMs(rec, beforeCount) - 14_000) < 100,
    String(incidentLapCostMs(rec, beforeCount)));
}

section('nothing is claimed before a lap has been completed after it');
{
  let s = laps(new Map(), [90_000, 90_100, 90_000]);
  const beforeCount = s.get(IP).times.length;
  s = laps(s, [104_000], s.get(IP).lap);

  assert('the incident lap alone gives no rate',
    paceAfter(s.get(IP), beforeCount) === null);
  assert('and no loss', measuredLossSecs(paceBefore(s.get(IP), beforeCount), null) === null);
}

section('a typed number wins, because the radio knows before the data does');
{
  assert('manual overrides measured', effectiveLossSecs(3.5, 2.0) === 3.5);
  assert('measured is used when nothing is typed', effectiveLossSecs('', 2.0) === 2.0);
  assert('and nothing at all is null', effectiveLossSecs('', null) === null);
  assert('a zero or negative typed value is not an override', effectiveLossSecs(0, 2.0) === 2.0);
}

section('the decision — a stop you were making anyway is already paid for');
{
  // Losing 2s/lap with 80 laps left, a stop due in 9, a 50s stop, 15s repair.
  const d = incidentDecision({
    lossPerLapSecs: 2, lapsRemaining: 80, lapsToNextStop: 9,
    pitLossSecs: 50, repairSecs: 15,
  });
  const cost = (id) => d.options.find((o) => o.id === id).secs;

  assert('carrying it to the flag costs 160s', cost(CARRY) === 160);
  assert('repairing at the scheduled stop costs 18s of damage plus the repair',
    cost(REPAIR_AT_STOP) === 33, String(cost(REPAIR_AT_STOP)));
  assert('pitting now costs a whole extra stop plus the repair',
    cost(PIT_NOW) === 65, String(cost(PIT_NOW)));
  assert('so you wait for the stop you were making anyway', d.best === REPAIR_AT_STOP);
  assert('and it says by how much', Math.abs(d.marginSecs - 32) < 0.01, String(d.marginSecs));
}

section('until the damage is bad enough that waiting costs more than the stop');
{
  const d = incidentDecision({
    lossPerLapSecs: 8, lapsRemaining: 60, lapsToNextStop: 20,
    pitLossSecs: 50, repairSecs: 15,
  });
  assert('160s of bleeding beats a 65s stop, so come in now', d.best === PIT_NOW,
    JSON.stringify(d.options));
}

section('near the end, you live with it');
{
  const d = incidentDecision({
    lossPerLapSecs: 2, lapsRemaining: 5, lapsToNextStop: 2,
    pitLossSecs: 50, repairSecs: 15,
  });
  assert('10s of damage beats any stop', d.best === CARRY, JSON.stringify(d.options));
}

section('with no stop left in the plan');
{
  const d = incidentDecision({
    lossPerLapSecs: 2, lapsRemaining: 40, lapsToNextStop: null,
    pitLossSecs: 50, repairSecs: 15,
  });
  assert('repairing at a stop is not offered',
    d.options.find((o) => o.id === REPAIR_AT_STOP).available === false);
  assert('and the choice is carry or come in', d.best === CARRY || d.best === PIT_NOW);
  assert('carrying 80s beats a 65s stop... just', d.best === PIT_NOW, JSON.stringify(d.options));
}

section('the decision refuses to invent one');
{
  assert('no loss, no decision',
    incidentDecision({ lossPerLapSecs: 0, lapsRemaining: 50 }) === null);
  assert('no laps left, no decision',
    incidentDecision({ lossPerLapSecs: 2, lapsRemaining: 0 }) === null);
  assert('and nonsense is not a decision',
    incidentDecision({ lossPerLapSecs: NaN, lapsRemaining: 50 }) === null);
}

section('spotting a rival who has lost pace');
{
  // Steady, then a step down of three seconds that stays.
  const steady = laps(new Map(), [90_000, 90_200, 90_100, 93_100, 93_000, 93_200]);
  const drop = detectPaceDrop(steady.get(IP));
  assert('a sustained step is caught', drop !== null && Math.abs(drop.lostMs - 3000) < 200,
    JSON.stringify(drop));

  // Tyres going off is a slope, not a step, and must not trip it.
  const slope = laps(new Map(), [90_000, 90_300, 90_600, 90_900, 91_200, 91_500]);
  assert('gradual degradation is not an incident', detectPaceDrop(slope.get(IP)) === null,
    JSON.stringify(detectPaceDrop(slope.get(IP))));

  // A pit stop is a slow in-lap and a slow out-lap — two laps, not three.
  const stop = laps(new Map(), [90_000, 90_100, 90_200, 115_000, 96_000, 90_100]);
  assert('a pit stop is not an incident', detectPaceDrop(stop.get(IP)) === null,
    JSON.stringify(detectPaceDrop(stop.get(IP))));

  const thin = laps(new Map(), [90_000, 95_000]);
  assert('too little history says nothing', detectPaceDrop(thin.get(IP)) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
