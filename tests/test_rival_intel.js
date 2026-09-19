/**
 * Reading a rival's fuel, which the relay sends for every car on the LAN.
 *
 * The number this produces gets used to tell a race engineer when a rival is
 * committed to boxing, so the failure that matters is not "slightly off" — it
 * is confidently wrong on a lap where something unusual happened. Most of what
 * follows is therefore about laps that must NOT count: the lap with the hose
 * in, the lap the car saved fuel, the lap it had an off.
 *
 * Run with: node tests/test_rival_intel.js
 */

import {
  trackFuelUse, burnPerLap, fuelLapsLeft, predictedPitLap,
  stintLapsFromLastStop, rivalSummary,
} from '../src/logic/rivalIntel.js';

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

const IP = '10.0.0.7';
const feed = (state, fuel, lap) => trackFuelUse(state, new Map([[IP, { fuelLiters: fuel, currentLap: lap }]]));

/** Burn `perLap` litres over `laps` whole laps, a few packets each. */
function driveLaps(state, startFuel, startLap, laps, perLap) {
  let fuel = startFuel;
  let lap = startLap;
  for (let i = 0; i < laps; i++) {
    for (let k = 1; k <= 4; k++) state = feed(state, fuel - (perLap * k) / 4, lap);
    fuel -= perLap;
    lap += 1;
    state = feed(state, fuel, lap);
  }
  return { state, fuel, lap };
}

// ────────────────────────────────────────────────────────────────────────────

section('nothing is claimed before anything is known');
{
  let s = new Map();
  assert('no record, no burn', burnPerLap(s.get(IP)) === null);

  s = feed(s, 80, 4);
  assert('one packet is not a lap', burnPerLap(s.get(IP)) === null);
  assert('and no pit lap is predicted', predictedPitLap(s.get(IP)) === null);
  assert('nor a summary', rivalSummary(s.get(IP)) === null);
}

section('a car burning 3.5 L a lap');
{
  const r = driveLaps(new Map(), 80, 4, 4, 3.5);
  const rec = r.state.get(IP);

  assert('the burn is measured', Math.abs(burnPerLap(rec) - 3.5) < 0.001, String(burnPerLap(rec)));
  // 66 L left at 3.5 L/lap = 18.8 laps.
  assert('fuel laps left follow from it',
    Math.abs(fuelLapsLeft(rec) - 66 / 3.5) < 0.01, String(fuelLapsLeft(rec)));
  assert('and the lap it has to box on',
    predictedPitLap(rec) === 8 + Math.floor(66 / 3.5), String(predictedPitLap(rec)));
  assert('three clean laps is enough to be confident', rivalSummary(rec).confident === true);
}

section('the lap with the hose in must not count as consumption');
{
  // Four clean laps, then a stop mid-lap, then more running.
  let { state, fuel, lap } = driveLaps(new Map(), 80, 4, 4, 3.5);
  const burnBefore = burnPerLap(state.get(IP));

  // Into the pits and refuelled from 66 L to 95 L over several packets.
  for (let f = fuel; f <= 95; f += 5) state = feed(state, f, lap);
  state = feed(state, 95, lap);
  // Back out and burning again — this is what banks the stop.
  state = feed(state, 94.5, lap);
  state = feed(state, 94, lap);
  // Finish the lap the stop happened on.
  state = feed(state, 93, lap + 1);

  const rec = state.get(IP);
  assert('the burn rate is unchanged by the stop',
    Math.abs(burnPerLap(rec) - burnBefore) < 0.001,
    `${burnBefore} → ${burnPerLap(rec)}`);
  assert('the refuel is recorded', rec.lastStop !== null && rec.lastStop.fuelAdded > 25,
    JSON.stringify(rec.lastStop));
  assert('and it says how long that load lasts',
    stintLapsFromLastStop(rec) === Math.floor(rec.lastStop.fuelAdded / burnPerLap(rec)),
    String(stintLapsFromLastStop(rec)));
}

section('one odd lap does not move the number');
{
  // Four laps at 3.5, then one lap where the car crawled round behind a
  // safety car and used almost nothing.
  let { state, fuel, lap } = driveLaps(new Map(), 80, 4, 4, 3.5);
  ({ state, fuel, lap } = driveLaps(state, fuel, lap, 1, 0.4));

  const rec = state.get(IP);
  assert('the median ignores it', Math.abs(burnPerLap(rec) - 3.5) < 0.001, String(burnPerLap(rec)));

  // And a thirsty lap on the other side is ignored just the same.
  const hot = driveLaps(state, fuel, lap, 1, 9.0).state.get(IP);
  assert('and ignores a thirsty one too', Math.abs(burnPerLap(hot) - 3.5) < 0.001,
    String(burnPerLap(hot)));
}

section('only the recent stint counts');
{
  // Five laps at 5 L (rich), then five at 3 L (saving). The window is 5, so the
  // old figure must have fallen out entirely.
  let { state, fuel, lap } = driveLaps(new Map(), 120, 1, 5, 5.0);
  ({ state, fuel, lap } = driveLaps(state, fuel, lap, 5, 3.0));

  const rec = state.get(IP);
  assert('the rich laps are gone', Math.abs(burnPerLap(rec) - 3.0) < 0.001, String(burnPerLap(rec)));
  assert('and only the window is retained', rec.burns.length === 5, String(rec.burns.length));
}

section('rubbish in the feed is ignored, not propagated');
{
  let s = new Map();
  s = trackFuelUse(s, new Map([[IP, { fuelLiters: null, currentLap: 3 }]]));
  assert('a null fuel reading is skipped', s.get(IP) === undefined);

  s = trackFuelUse(s, new Map([[IP, { fuelLiters: -5, currentLap: 3 }]]));
  assert('a negative one too', s.get(IP) === undefined);

  const r = driveLaps(new Map(), 80, 4, 4, 3.5);
  const before = r.state;
  const after = trackFuelUse(before, new Map([[IP, { fuelLiters: NaN, currentLap: 9 }]]));
  assert('and a NaN leaves the record untouched, by identity', after === before);
}

section('two cars are tracked independently');
{
  const A = '10.0.0.2';
  const B = '10.0.0.3';
  let s = new Map();
  for (let i = 0; i < 5; i++) {
    s = trackFuelUse(s, new Map([
      [A, { fuelLiters: 100 - i * 4, currentLap: 1 + i }],
      [B, { fuelLiters: 100 - i * 2, currentLap: 1 + i }],
    ]));
  }
  assert('the thirsty one reads 4 L', Math.abs(burnPerLap(s.get(A)) - 4) < 0.001,
    String(burnPerLap(s.get(A))));
  assert('the economical one reads 2 L', Math.abs(burnPerLap(s.get(B)) - 2) < 0.001,
    String(burnPerLap(s.get(B))));
  assert('and they predict different pit laps',
    predictedPitLap(s.get(A)) !== predictedPitLap(s.get(B)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
