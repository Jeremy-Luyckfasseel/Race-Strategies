/**
 * Tests for src/logic/sessionAnalysis.js — the shared "recorded session → strategy
 * inputs" brain used by both the validation CLI and the in-app session import.
 *
 * Asserts: recovery of fuel / fuel-weight / degradation from synthetic captures;
 * the data-quality warnings (unlimited fuel, not-separable, cliff); and that
 * merging the measured CAR MODEL onto base inputs leaves the race plan + drivers
 * untouched and yields a valid ranked strategy.
 *
 * Run with: node tests/test_session_analysis.js
 */

import { analyzeCapture, mergeAnalysisIntoInputs, deriveStrategyInputs, mergeDriverSessions } from '../src/logic/sessionAnalysis.js';
import { findBestStrategies, parseLapTime } from '../src/logic/strategy.js';

let passed = 0;
let failed = 0;
function assert(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}
function near(label, a, e, tol) {
  assert(label, a != null && Math.abs(a - e) <= tol, `expected ≈${e} (±${tol}), got ${a}`);
}
function section(n) {
  console.log(`\n── ${n} ──`);
}

// Known truth: 3 L/lap, 0.03 s/L, piecewise deg over a 28-lap life.
const FUEL = 3,
  PEN = 0.03,
  L = 28,
  BP = 14;
const degOnly = (age) => (age <= BP ? 120 + (age / BP) * 1 : 121 + ((age - BP) / BP) * 2);

function makeStint(stint, Fi, maxAge, startLap, compound = 'M', degFn = degOnly, fuelPerLap = FUEL) {
  const out = [];
  for (let age = 0; age <= maxAge; age++) {
    const fuelStart = Fi - age * fuelPerLap;
    const t = degFn(age) + PEN * fuelStart;
    out.push({
      lap: startLap + age,
      lapTimeMs: Math.round(t * 1000),
      lapTimeSec: Math.round(t * 1000) / 1000,
      fuelStartL: fuelStart,
      fuelEndL: fuelStart - fuelPerLap,
      fuelUsedL: fuelPerLap,
      compound,
      tireWear: [100, 100, 100, 100],
      minSpeedKmh: 120,
      maxSpeedKmh: 280,
      sawPit: false,
      sawOffTrack: false,
      sawPaused: false,
    });
  }
  return out;
}

function twoStintCapture() {
  const s1 = makeStint(1, 60, 15, 1);
  const s2 = makeStint(2, 100, 27, 17);
  s1[s1.length - 1].sawPit = true;
  s2[0].fuelStartL = s1[s1.length - 1].fuelEndL; // refuel jump → boundary
  s2[0].fuelUsedL = Math.round((s2[0].fuelStartL - s2[0].fuelEndL) * 100) / 100;
  return { meta: { tankCapacityL: 100, team: 'T', startCompound: 'M' }, laps: [...s1, ...s2], events: [] };
}

// ---------------------------------------------------------------------------
section('analyzeCapture recovers the car model from a clean session');
{
  const a = analyzeCapture(twoStintCapture());
  near('fuel/lap', a.fuel.value, FUEL, 0.1);
  near('laps per tank', a.fuel.lapsPerFullTank, 100 / FUEL, 1);
  assert('fuel-weight identifiable', a.fuelWeight.identifiable === true);
  near('fuel-weight s/L', a.fuelWeight.sPerLiter, PEN, 0.005);
  const m = a.compounds.find((c) => c.id === 'M');
  near('deg start', m.deg.start, degOnly(0), 0.3);
  near('deg half', m.deg.half, degOnly(L / 2), 0.3);
  near('deg end', m.deg.end, degOnly(L), 0.3);
  assert('emits engine-ready observed times', /\d:\d\d/.test(m.observed.start));
  assert('compound is confident', m.confident === true);
  assert('no error warnings on a clean session', !a.warnings.some((w) => w.level === 'error'));
}

section('Warnings — unlimited fuel, not-separable, cliff');
{
  // Unlimited fuel: tank never depletes (fuelUsed 0) → no fuel measurable.
  const flat = makeStint(1, 100, 20, 1).map((l) => ({ ...l, fuelStartL: 100, fuelEndL: 100, fuelUsedL: 0 }));
  const a1 = analyzeCapture({ meta: { tankCapacityL: 100 }, laps: flat, events: [] });
  assert('unlimited-fuel warning', a1.warnings.some((w) => w.code === 'no-fuel'));

  // Single stint → fuel-weight can't be separated from degradation.
  const a2 = analyzeCapture({ meta: { tankCapacityL: 100 }, laps: makeStint(1, 100, 20, 1), events: [] });
  assert('not-separable warning', a2.warnings.some((w) => w.code === 'fuel-weight-not-separable'));
  assert('fuel-weight reported not identifiable', a2.fuelWeight.identifiable === false);

  // Cliff: degradation accelerates in the last quarter.
  const cliff = (age) => 118 + (age / 30) * 4 + (age > 0.75 * 30 ? (age - 0.75 * 30) * 1.3 : 0);
  const a3 = analyzeCapture({ meta: { tankCapacityL: 100 }, laps: makeStint(1, 100, 29, 1, 'S', cliff), events: [] });
  assert('cliff warning', a3.warnings.some((w) => w.code === 'cliff'));
}

section('mergeAnalysisIntoInputs folds the car model, leaves the race plan');
{
  const base = {
    raceDurationHours: 8,
    tankSize: 999,
    lapsPerFullTank: 99,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.05,
    mandatoryStops: 2,
    pitBaseSecs: 30,
    tireChangeSecs: 27,
    fuelRateLitersPerSec: 4.0,
    minDriverTimeSecs: 7200,
    drivers: [
      { id: 'd1', name: 'A', compounds: {} },
      { id: 'd2', name: 'B', compounds: {} },
    ],
    compounds: [
      { id: 'M', name: 'Medium', tireLife: 99, mandatory: false, startLapTime: '2:10', halfLapTime: '2:11', endLapTime: '2:13' },
      { id: 'S', name: 'Soft', tireLife: 99, mandatory: false, startLapTime: '2:05', halfLapTime: '2:07', endLapTime: '2:10' },
    ],
  };
  const out = mergeAnalysisIntoInputs(analyzeCapture(twoStintCapture()), base);

  // Car model is updated from the session…
  near('tankSize from session', out.tankSize, 100, 0.1);
  near('lapsPerFullTank from session', out.lapsPerFullTank, 100 / FUEL, 1);
  near('penalty from session', out.fuelWeightPenaltyPerLiter, PEN, 0.005);
  const m = out.compounds.find((c) => c.id === 'M');
  assert('M lap times replaced', m.startLapTime !== '2:10' && m.endLapTime !== '2:13');
  assert('M tyre life ~28', Math.abs(m.tireLife - 28) <= 1);

  // …but the RACE PLAN + drivers are left untouched.
  assert('race duration untouched', out.raceDurationHours === 8);
  assert('mandatory stops untouched', out.mandatoryStops === 2);
  assert('drivers untouched', out.drivers.length === 2 && out.minDriverTimeSecs === 7200);
  assert('pit timing untouched', out.pitBaseSecs === 30 && out.tireChangeSecs === 27);
  assert('unseen compound (S) untouched', out.compounds.find((c) => c.id === 'S').startLapTime === '2:05');

  assert('did not mutate base inputs', base.tankSize === 999 && base.compounds[0].startLapTime === '2:10');
}

section('deriveStrategyInputs → a valid (multi-driver) ranked strategy');
{
  const base = {
    raceDurationHours: 2,
    tankSize: 100,
    lapsPerFullTank: 30,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.03,
    mandatoryStops: 1,
    pitBaseSecs: 25,
    tireChangeSecs: 27,
    fuelRateLitersPerSec: 4.0,
    minDriverTimeSecs: 1800,
    drivers: [
      { id: 'd1', name: 'A', compounds: {} },
      { id: 'd2', name: 'B', compounds: {} },
    ],
    compounds: [{ id: 'M', name: 'Medium', tireLife: 30, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' }],
  };
  const inputs = deriveStrategyInputs(twoStintCapture(), base);
  const ranked = findBestStrategies(inputs);
  assert('engine returns a ranked strategy from derived inputs', Array.isArray(ranked) && ranked.length > 0);
  assert('multi-driver preserved into the engine run', inputs.drivers.length === 2);
}

section('mergeDriverSessions — combine drivers, keep per-driver pace');
{
  // Each driver records their own two-stint session; Bob is 1.5 s/lap slower.
  function driverSession(name, degFn) {
    const s1 = makeStint(1, 60, 15, 1, 'M', degFn);
    s1[s1.length - 1].sawPit = true;
    const s2 = makeStint(2, 100, 27, 17, 'M', degFn);
    s2[0].fuelStartL = s1[s1.length - 1].fuelEndL;
    s2[0].fuelUsedL = Math.round((s2[0].fuelStartL - s2[0].fuelEndL) * 100) / 100;
    const cap = { meta: { tankCapacityL: 100, driver: name, startCompound: 'M' }, laps: [...s1, ...s2], events: [] };
    return { driver: name, analysis: analyzeCapture(cap) };
  }
  const alice = driverSession('Alice', degOnly);
  const bob = driverSession('Bob', (a) => degOnly(a) + 1.5);

  const base = {
    raceDurationHours: 2,
    tankSize: 1,
    lapsPerFullTank: 1,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.05,
    mandatoryStops: 1,
    pitBaseSecs: 25,
    tireChangeSecs: 27,
    fuelRateLitersPerSec: 4.0,
    minDriverTimeSecs: 1800,
    drivers: [{ id: 'old', name: 'placeholder', compounds: {} }],
    compounds: [{ id: 'M', name: 'Medium', tireLife: 30, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' }],
  };
  const out = mergeDriverSessions([alice, bob], base);

  assert('two drivers in the team', out.drivers.length === 2);
  assert('driver names carried from captures', out.drivers[0].name === 'Alice' && out.drivers[1].name === 'Bob');
  assert('each driver has per-compound times', !!out.drivers[0].compounds.M && !!out.drivers[1].compounds.M);
  assert(
    'per-driver pace preserved (Bob slower than Alice)',
    parseLapTime(out.drivers[1].compounds.M.startLapTime) > parseLapTime(out.drivers[0].compounds.M.startLapTime)
  );

  // Global car model is taken from the sessions (same car), averaged.
  near('global tank from sessions', out.tankSize, 100, 0.1);
  near('global laps/tank from sessions', out.lapsPerFullTank, 100 / FUEL, 1);
  near('global penalty from sessions', out.fuelWeightPenaltyPerLiter, PEN, 0.005);

  // Race plan kept.
  assert('race length kept', out.raceDurationHours === 2);
  assert('min drive time kept', out.minDriverTimeSecs === 1800);

  const ranked = findBestStrategies(out);
  assert('engine runs the multi-driver team plan', Array.isArray(ranked) && ranked.length > 0);
  assert('plan covers both drivers', ranked[0].strategy.driverSummary.length === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
