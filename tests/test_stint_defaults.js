/**
 * What my car is on, and who is driving, when nobody has said.
 *
 * Picked before the stop wins; else the plan's tyre for the stint now
 * starting, and the same driver as before. Run with: node tests/test_stint_defaults.js
 */

import { stintAfterStop, planTyreAfterStop, planTyreNow } from '../src/logic/stintDefaults.js';

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

// A full-race plan: M 1–25, H 26–60, S 61–70.
const PLAN = { stints: [
  { startLap: 1, endLap: 25, compound: 'M' },
  { startLap: 26, endLap: 60, compound: 'H' },
  { startLap: 61, endLap: 70, compound: 'S' },
] };

section('the plan’s tyre after a stop');
{
  assert('in on 25, out on 26: the hard stint', planTyreAfterStop(PLAN, 26) === 'H');
  // Stopping early does not skip a stint: the next tyre is still the next one.
  assert('an early stop still takes the next planned tyre', planTyreAfterStop(PLAN, 20) === 'H');
  assert('the second stop: softs', planTyreAfterStop(PLAN, 61) === 'S');
  assert('a stop after the last planned one keeps the last tyre', planTyreAfterStop(PLAN, 68) === 'S');

  // Mid-race the plan is laid from the car's lap: its first stint is the one
  // that just ended, whatever lap numbers it carries.
  const mid = { stints: [
    { startLap: 40, endLap: 40, compound: 'M' },
    { startLap: 41, endLap: 70, compound: 'H' },
  ] };
  assert('mid-race, the plan’s second stint', planTyreAfterStop(mid, 41) === 'H');
  assert('no plan, no tyre', planTyreAfterStop(null, 26) === null);
}

section('the plan’s tyre now');
{
  assert('lap 30 is the hard stint', planTyreNow(PLAN, 30) === 'H');
  assert('no plan, nothing', planTyreNow(null, 30) === null);
}

section('what the stop sets');
{
  const picked = stintAfterStop({ pick: { driverId: 'q', compoundId: 'W' }, strategy: PLAN, exitLap: 26, previousDriverId: 'j' });
  assert('a picked tyre wins over the plan', picked.compoundId === 'W' && picked.compoundFrom === 'pick');
  assert('a picked driver wins over the one before', picked.driverId === 'q' && picked.driverFrom === 'pick');

  const none = stintAfterStop({ pick: { driverId: null, compoundId: null }, strategy: PLAN, exitLap: 26, previousDriverId: 'j' });
  assert('nothing picked: the plan’s tyre', none.compoundId === 'H' && none.compoundFrom === 'plan', JSON.stringify(none));
  assert('nothing picked: the same driver stays in', none.driverId === 'j' && none.driverFrom === 'same');

  const half = stintAfterStop({ pick: { driverId: 'q', compoundId: null }, strategy: PLAN, exitLap: 26, previousDriverId: 'j' });
  assert('picking only the driver still takes the plan’s tyre', half.compoundId === 'H' && half.driverId === 'q');

  const blind = stintAfterStop({ pick: null, strategy: null, exitLap: 26, previousDriverId: null });
  assert('no pick, no plan, nobody before: nothing is assumed',
    blind.compoundId === null && blind.driverId === null && blind.compoundFrom === null && blind.driverFrom === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
