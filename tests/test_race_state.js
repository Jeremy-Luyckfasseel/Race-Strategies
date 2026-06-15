/**
 * Tests for the live race-state helpers in src/logic/raceState.js (Phase 2, Task 2.1).
 * Pure node — no DOM. Feeds a synthetic race state + a strategy and asserts the
 * next action, stint countdown, fuel margin / lift-and-coast verdict, smoothing,
 * and the earliest-of pit-now trigger.
 *
 * Run with: node tests/test_race_state.js
 */

import {
  currentStint,
  nextAction,
  fuelExhaustionLap,
  fuelMarginLaps,
  liftAndCoastVerdict,
  pitNowTrigger,
  medianRecent,
  RACE_STATE_CONFIG,
} from '../src/logic/raceState.js';

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

// A 3-stint synthetic strategy (shape per CURRENT_STATE §3C).
const STRATEGY = {
  totalLaps: 90,
  stints: [
    { stintNum: 1, startLap: 1, endLap: 30, lapsInStint: 30, pitLap: 30, fuelToAddLiters: 60, tiresChanged: true, compound: 'M', compoundName: 'Medium', pitWindowLatestLap: 32 },
    { stintNum: 2, startLap: 31, endLap: 60, lapsInStint: 30, pitLap: 60, fuelToAddLiters: 60, tiresChanged: true, compound: 'M', compoundName: 'Medium', pitWindowLatestLap: 62 },
    { stintNum: 3, startLap: 61, endLap: 90, lapsInStint: 30, pitLap: null, fuelToAddLiters: 0, tiresChanged: false, compound: 'S', compoundName: 'Soft', pitWindowLatestLap: null },
  ],
};

// ---------------------------------------------------------------------------

section('currentStint — locates the stint and counts laps left');
{
  const cs = currentStint(STRATEGY, 25);
  assert('in stint 1 at lap 25', cs.index === 0 && cs.stint.stintNum === 1);
  assert('laps left = endLap - currentLap', cs.lapsLeftInStint === 5);
  assert('not last stint', cs.isLastStint === false);

  const cs2 = currentStint(STRATEGY, 61);
  assert('lap 61 is in stint 3', cs2.index === 2 && cs2.isLastStint === true);

  assert('lap past the race clamps to last stint', currentStint(STRATEGY, 999).index === 2);
  assert('null when no strategy', currentStint(null, 10) === null);
  assert('null on non-finite lap', currentStint(STRATEGY, NaN) === null);
}

section('nextAction — pit lap, fuel, tyres, next compound');
{
  const na = nextAction(STRATEGY, 25);
  assert('targets stint 1 pit lap', na.pitLap === 30);
  assert('reports fuel to add', na.fuelToAddLiters === 60);
  assert('reports tyres changed', na.tiresChanged === true);
  assert('carries the pit window latest lap', na.pitWindowLatestLap === 32);
  assert('next compound is the following stint compound', na.nextCompound === 'M');

  const last = nextAction(STRATEGY, 70);
  assert('final stint → run to flag (no pit)', last.runToFlag === true && last.pitLap === null);
}

section('Fuel margin + lift-and-coast verdict (DECISION 1)');
{
  // Stint 1, lap 25 → 5 laps left. litersPerLap = 3.
  const lapsLeft = currentStint(STRATEGY, 25).lapsLeftInStint; // 5
  // Tight: only ~5.5 laps of fuel for 5 laps left → margin 0.5 < 1 → lift.
  let margin = fuelMarginLaps(16.5, 3, lapsLeft);
  assert('tight margin ≈ 0.5', Math.abs(margin - 0.5) < 1e-9);
  assert('verdict lift when margin < 1', liftAndCoastVerdict(margin) === 'lift');

  // Comfortable: ~6.5 laps of fuel → margin 1.5 → ok.
  margin = fuelMarginLaps(19.5, 3, lapsLeft);
  assert('verdict ok between thresholds', liftAndCoastVerdict(margin) === 'ok');

  // Surplus: ~7.5 laps of fuel → margin 2.5 > 2 → push.
  margin = fuelMarginLaps(22.5, 3, lapsLeft);
  assert('verdict push when margin > 2', liftAndCoastVerdict(margin) === 'push');

  assert('unknown when litersPerLap invalid', liftAndCoastVerdict(fuelMarginLaps(50, 0, 5)) === 'unknown');

  // Exactly at the lift threshold (margin == 1.0) is NOT lift (boundary).
  assert('boundary margin == 1.0 is ok, not lift', liftAndCoastVerdict(RACE_STATE_CONFIG.liftAndCoastMarginLaps) === 'ok');
}

section('fuelExhaustionLap');
{
  // lap 25, 30 L, 3 L/lap → 10 more laps → dry by lap 35.
  assert('dry lap = currentLap + floor(fuel/lpl)', fuelExhaustionLap(25, 30, 3) === 35);
  assert('null when litersPerLap is 0', fuelExhaustionLap(25, 30, 0) === null);
}

section('pitNowTrigger — earliest-of with the reason (DECISION 3)');
{
  // Plan says lap 30, fuel runs out lap 28, tyres lap 33 → fuel wins (earliest).
  let t = pitNowTrigger({ plannedPitLap: 30, fuelExhaustionLap: 28, tyreWearLap: 33 });
  assert('earliest candidate wins (fuel @28)', t.lap === 28 && t.reason === 'fuel');

  // Tyres earliest.
  t = pitNowTrigger({ plannedPitLap: 30, fuelExhaustionLap: 31, tyreWearLap: 27 });
  assert('tyres win when earliest', t.lap === 27 && t.reason === 'tyres');

  // Only the plan is known.
  t = pitNowTrigger({ plannedPitLap: 30, fuelExhaustionLap: null, tyreWearLap: null });
  assert('falls back to plan', t.lap === 30 && t.reason === 'plan');

  // Tie between fuel and plan → safety (fuel) wins.
  t = pitNowTrigger({ plannedPitLap: 30, fuelExhaustionLap: 30, tyreWearLap: null });
  assert('tie → fuel (safety) beats plan', t.lap === 30 && t.reason === 'fuel');

  assert('null when no candidates', pitNowTrigger({}) === null);
}

section('medianRecent — smoothing damps a jitter spike');
{
  // A single bad fuel reading (a spike) should not move the median.
  assert('median ignores one spike', medianRecent([30, 30, 30, 9, 30]) === 30);
  assert('uses only the recent window', medianRecent([1, 1, 1, 1, 1, 5, 5, 5, 5, 5], 5) === 5);
  assert('null on empty', medianRecent([]) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
