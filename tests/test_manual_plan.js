/**
 * A strategy typed in by hand, run through the engine.
 *
 * The engine enumerates compound patterns of up to five elements. A plan like
 * "Medium for ten stints, then Soft to the flag" is not one of those, and the
 * pit wall may simply know better than the model. So the rows are expanded
 * into the engine's own compound plan and simulated the same way: same fuel,
 * same tyre model, same driver assignment. What this suite guards is that the
 * plan run is the plan typed — tyres in order, typed laps honoured, fuel for
 * the stint that was typed — and that it says plainly when the race and the
 * plan do not line up.
 *
 * Run with: node tests/test_manual_plan.js
 */

import { findBestStrategies } from '../src/logic/strategy.js';

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

const BASE = {
  raceDurationHours: 2,
  tankSize: 100,
  lapsPerFullTank: 28,
  fuelMap: 1.0,
  compounds: [
    { id: 'H', tireLife: 40, startLapTime: '1:32', halfLapTime: '1:33', endLapTime: '1:34.5' },
    { id: 'M', tireLife: 25, startLapTime: '1:31', halfLapTime: '1:32', endLapTime: '1:33.5' },
    { id: 'S', tireLife: 12, startLapTime: '1:30', halfLapTime: '1:31', endLapTime: '1:33' },
    { id: 'W', tireLife: 0, startLapTime: '1:50', halfLapTime: '1:51', endLapTime: '1:52' },
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 27,
  fuelRateLitersPerSec: 4,
  mandatoryStops: 0,
  midRaceMode: false,
  fuelWeightPenaltyPerLiter: 0.03,
};

const run = (manualPlan, over = {}) => findBestStrategies({ ...BASE, ...over, manualPlan })[0];
const tyres = (r) => r.strategy.stints.map((s) => s.compound);
const laps = (r) => r.strategy.stints.map((s) => s.lapsInStint);

section('rows become the tyres, in order');
{
  const r = run([
    { compoundId: 'M', stints: 2, laps: null },
    { compoundId: 'S', stints: null, laps: null },
  ]);
  const t = tyres(r);
  assert('the first two stints are mediums', t[0] === 'M' && t[1] === 'M', t.join());
  assert('and softs from there to the flag', t.slice(2).every((x) => x === 'S') && t.length > 3, t.join());
  assert('one result, marked as the typed plan', !!r.manual, JSON.stringify(Object.keys(r)));
  assert('an until-the-flag row means the race never runs past the plan', r.manual.beyondPlan === false);
}

section('typed laps are the laps run');
{
  const r = run([
    { compoundId: 'M', stints: 2, laps: 15 },
    { compoundId: 'S', stints: null, laps: 10 },
  ]);
  const l = laps(r);
  assert('both medium stints are 15 laps', l[0] === 15 && l[1] === 15, l.join());
  const softs = r.strategy.stints.slice(2, -1).map((s) => s.lapsInStint);
  assert('every soft stint but the last is 10', softs.length > 0 && softs.every((x) => x === 10), softs.join());
  assert('nothing was cut short', r.manual.cutShort.length === 0, JSON.stringify(r.manual.cutShort));
}

section('the engine says what it would run, per row');
{
  const r = run([
    { compoundId: 'M', stints: 2, laps: 15 },
    { compoundId: 'S', stints: null, laps: null },
  ]);
  const [m, s] = r.manual.rows.map((x) => x.engineLaps);
  // The engine sizes a medium stint by its 25-lap life and a 28-lap tank.
  assert('a figure for the medium row, near the tyre life', m >= 20 && m <= 25, String(m));
  assert('and a shorter one for the soft row', s > 0 && s <= 12, String(s));
}

section('what fuel or tyre life cannot allow is cut, and said');
{
  // 40 laps on a 25-lap medium. The stint stops at the tyre and says so.
  const r = run([
    { compoundId: 'M', stints: 1, laps: 40 },
    { compoundId: 'H', stints: null, laps: null },
  ]);
  assert('the stint is cut to what the tyre allows', laps(r)[0] <= 25, String(laps(r)[0]));
  assert('and the cut is reported', r.manual.cutShort.length === 1 && r.manual.cutShort[0].asked === 40,
    JSON.stringify(r.manual.cutShort));
}

section('the stop before a typed stint fuels for THAT stint');
{
  // Soft stints of 10 laps: each stop must carry enough for 10 laps, not for
  // whatever the engine would have run.
  const r = run([
    { compoundId: 'M', stints: 1, laps: 20 },
    { compoundId: 'S', stints: null, laps: 10 },
  ]);
  const lpl = BASE.tankSize / BASE.lapsPerFullTank;
  const first = r.strategy.stints[0];
  const leftAfter = BASE.tankSize - first.lapsInStint * lpl;
  const tank = leftAfter + first.fuelToAddLiters;
  assert('the tank after the first stop covers the 10-lap soft stint', tank >= 10 * lpl - 0.01,
    `${tank.toFixed(1)} L vs ${(10 * lpl).toFixed(1)} L`);
  assert('without filling to the brim for it', tank < BASE.tankSize - 1, tank.toFixed(1));
}

section('when the race and the plan do not line up');
{
  const short = run([{ compoundId: 'H', stints: 1, laps: null }]);
  assert('rows that run out before the flag are flagged', short.manual.beyondPlan === true);
  assert('and the last tyre carries on', tyres(short).every((x) => x === 'H'), tyres(short).join());
  assert('the planned count is given', short.manual.plannedStints === 1, String(short.manual.plannedStints));

  const long = run([
    { compoundId: 'H', stints: 20, laps: null },
    { compoundId: 'S', stints: null, laps: null },
  ], { raceDurationHours: 1 });
  assert('a row the race never reaches is marked', long.manual.rows[1].reached === false,
    JSON.stringify(long.manual.rows.map((x) => x.reached)));
  assert('the row it does reach is not', long.manual.rows[0].reached === true);
}

section('a tyre with no life set cannot be run');
{
  const [r] = findBestStrategies({ ...BASE, manualPlan: [{ compoundId: 'W', stints: null, laps: null }] });
  assert('it comes back as an error, not a plan', r && r.manual?.error === 'invalid_tyre' && !r.strategy,
    JSON.stringify(r?.manual));
  assert('naming the row', r.manual.rows[0].invalid === true);
}

section('mid-race, the stints already driven are skipped');
{
  const r = run([
    { compoundId: 'M', stints: 2, laps: null },
    { compoundId: 'S', stints: null, laps: 10 },
  ], {
    raceDurationHours: 1,
    midRaceMode: true, currentLap: 50, currentFuel: 60, currentCompoundId: 'S', currentTireAgeLaps: 4,
    manualStintsDone: 2, manualLapsIntoStint: 4,
  });
  const t = tyres(r);
  assert('two stints done, so the rest is softs', t.every((x) => x === 'S'), t.join());
  assert('the running stint has only what is left of its 10 laps', laps(r)[0] === 6, String(laps(r)[0]));
  assert('stints are counted from the start of the race', r.manual.raceStints === r.strategy.stints.length + 2);
}

section('drivers are assigned as for any engine plan');
{
  const r = run([{ compoundId: 'M', stints: null, laps: null }], {
    drivers: [{ id: 'a', name: 'A', compounds: {} }, { id: 'b', name: 'B', compounds: {} }],
    minDriverTimeSecs: 1800,
  });
  const names = new Set(r.strategy.stints.map((s) => s.driverId));
  assert('both drivers get stints', names.has('a') && names.has('b'), [...names].join());
  assert('and both meet the minimum', r.strategy.driverSummary.every((d) => d.metMinimum),
    JSON.stringify(r.strategy.driverSummary));
}

section('without a typed plan nothing changes');
{
  const auto = findBestStrategies(BASE);
  assert('the engine still ranks its own plans', auto.length > 1 && !auto[0].manual);
  assert('and no stint carries a typed length', auto[0].strategy.stints.every((s) => s.forcedLaps === null));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
