/**
 * What the learner measured has to survive a reload.
 *
 * An eight-hour race is eight hours of measurement and it used to live only in
 * one closure in memory: a refresh, a reclaimed tab, or venue wifi dropping the
 * page, and the session started again from zero with no way back. These cover
 * the round trip and — more importantly — that a restored learner carries on
 * measuring the same tyre rather than treating it as a fresh set.
 *
 * Run with: node tests/test_learner_store.js
 */

import {
  LEARNER_KEY, MAX_LAPS_PER_CAR, readStore, restoreFor, writeFor,
} from '../src/logic/learnerStore.js';
import { createLearner } from '../src/logic/telemetryLearner.js';

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

const IP = '192.168.1.50';

// The same synthetic ground truth the learner suite uses, in miniature.
const TANK = 100;
const LPL = 3.0;
const PENALTY = 0.03;
const LIFE = 30;

const frame = (currentLap, fuelLiters, lastLapMs = null, extra = {}) => ({
  currentLap, fuelLiters, lastLapMs, onTrack: true, paused: false, ...extra,
});

/** Pure degradation for a compound spec at a tyre age. */
function degAt(spec, age) {
  const half = LIFE / 2;
  if (age <= half) return spec.start + (age / half) * (spec.half - spec.start);
  return spec.half + Math.min(1, (age - half) / half) * (spec.end - spec.half);
}

/** Lap-complete frames for a stint, tyre age starting at `age0`. */
function stint(startLap, Fi, n, spec, age0 = 0) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const age = age0 + k - 1;
    const fuelStart = Fi - (k - 1) * LPL;
    out.push(frame(startLap + k, Fi - k * LPL, (degAt(spec, age) + PENALTY * fuelStart) * 1000));
  }
  return out;
}

const SPEC = { start: 120, half: 121, end: 123 };

const newLearner = (restore) => createLearner({
  tankSize: TANK, tireLife: LIFE, compoundId: 'M', restore,
});

// ---------------------------------------------------------------------------

section('the store survives everything a browser can hand it');
{
  assert('nothing stored reads as empty', Object.keys(readStore(null)).length === 0);
  assert('garbage reads as empty', Object.keys(readStore('{not json')).length === 0);
  assert('an array is not a store', Object.keys(readStore('[1,2,3]')).length === 0);

  assert('no history for an unknown car', restoreFor(null, IP) === null);
  assert('no history without a car', restoreFor('{}', null) === null);
  assert('an empty lap list is no history',
    restoreFor(JSON.stringify({ [IP]: { laps: [] } }), IP) === null);

  // A lap with no numeric age would become NaN inside the curve fit, which is
  // the one thing downstream cannot defend itself against.
  const junk = JSON.stringify({ [IP]: { laps: [{ lapTimeSecs: 120 }, { stintAge: 'x' }] } });
  assert('laps that would poison the fit are dropped', restoreFor(junk, IP) === null);
}

section('one car does not overwrite another');
{
  const a = writeFor(null, IP, { laps: [{ stintAge: 0, dirtyReasons: [] }], stintStartLap: 4 });
  const b = writeFor(a, '10.0.0.9', { laps: [{ stintAge: 1, dirtyReasons: [] }], stintStartLap: 9 });

  assert('the second car is stored', restoreFor(b, '10.0.0.9').stintStartLap === 9);
  assert('and the first is still there', restoreFor(b, IP).stintStartLap === 4);
  assert('storing nothing changes nothing', writeFor(b, IP, null) === b);
}

section('the store does not grow without bound');
{
  const many = Array.from({ length: MAX_LAPS_PER_CAR + 500 }, (_, i) => ({
    lapNum: i, stintAge: i % 30, dirtyReasons: [],
  }));
  const restored = restoreFor(writeFor(null, IP, { laps: many }), IP);
  assert('it is capped', restored.laps.length === MAX_LAPS_PER_CAR, String(restored.laps.length));
  // Recent running describes the car as it is now, so the OLD laps go.
  assert('and it is the oldest laps that go',
    restored.laps[restored.laps.length - 1].lapNum === many[many.length - 1].lapNum);
}

section('a reload costs the in-progress lap and nothing else');
{
  const live = newLearner(null);
  live.setDriver('ana');
  live.ingest(frame(1, 60));
  live.ingestAll(stint(1, 60, 16, SPEC));
  live.ingest(frame(17, TANK, null, { pitExit: true }));
  live.ingestAll(stint(17, TANK, 20, SPEC));

  const before = live.getEstimates();
  const raw = writeFor(null, IP, live.snapshot());

  // ...the tab reloads.
  const back = newLearner(restoreFor(raw, IP));
  const after = back.getEstimates();

  assert('every measured lap came back',
    after.compounds.M.sampleCount === before.compounds.M.sampleCount,
    `${after.compounds.M.sampleCount} vs ${before.compounds.M.sampleCount}`);
  assert('the fuel-weight penalty is the same number',
    Math.abs(after.fuelWeightPenaltyPerLiter - before.fuelWeightPenaltyPerLiter) < 1e-9);
  assert('and so is the tyre curve',
    Math.abs(after.compounds.M.deg.end - before.compounds.M.deg.end) < 1e-9);
  assert('the driver split came back too',
    after.byDriver.ana.M.sampleCount === before.byDriver.ana.M.sampleCount);
  assert('and it is confident immediately, not in two minutes',
    after.compounds.M.confident === true);
}

section('a restored learner is still on the same tyre');
{
  // The trap: tyre age is measured from the lap the stint began on. A learner
  // rebuilt with no stint origin calls the next lap age 0 and records a tyre
  // 20 laps old as a fresh one — which is worse than having lost the data,
  // because it is wrong rather than absent.
  const live = newLearner(null);
  live.ingest(frame(1, TANK));
  live.ingestAll(stint(1, TANK, 20, SPEC));

  const back = newLearner(restoreFor(writeFor(null, IP, live.snapshot()), IP));
  // Two more laps arrive after the reload, at tyre age 20 and 21.
  back.ingest(frame(21, TANK - 20 * LPL));
  back.ingestAll(stint(21, TANK - 20 * LPL, 2, SPEC, 20));

  const fresh = back._laps.filter((l) => l.lapNum > 21);
  assert('laps after the reload continue the stint', fresh.length > 0);
  assert('and are aged from where the stint really began',
    fresh.every((l) => l.stintAge >= 20),
    JSON.stringify(fresh.map((l) => l.stintAge)));

  // The compound and driver come back with it, so the laps after a reload are
  // not filed under "unknown" until someone taps the pickers again.
  const named = newLearner(null);
  named.setDriver('bo');
  named.setCompound('S', 20);
  named.ingest(frame(1, TANK));
  named.ingestAll(stint(1, TANK, 4, SPEC));
  const snap = restoreFor(writeFor(null, IP, named.snapshot()), IP);
  assert('the compound is remembered', snap.compoundId === 'S');
  assert('and so is the driver', snap.driverId === 'bo');
}

section('the key is the one the race reset clears');
{
  assert('it is the race-scoped learner key', LEARNER_KEY === 'gt7-learner');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
