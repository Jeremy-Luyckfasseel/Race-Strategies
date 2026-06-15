/**
 * Tests for the propose-and-accept logic in src/logic/recommendations.js
 * (Phase 1, Task 1.3). Pure node — no React.
 *
 * Asserts the "should we recommend this?" rules: surface only when confident AND
 * meaningfully different; never mutate inputs; don't re-nag after an ignore until
 * the measured value shifts materially; and an accepted value, once applied,
 * produces a valid ranked strategy.
 *
 * Run with: node tests/test_recommendations.js
 */

import {
  buildRecommendations,
  applyRecommendation,
  dismissSnapshot,
  RECOMMEND_CONFIG,
} from '../src/logic/recommendations.js';
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INPUTS = {
  raceDurationHours: 8,
  tankSize: 100,
  lapsPerFullTank: 33,
  fuelMap: 1.0,
  fuelWeightPenaltyPerLiter: 0.03,
  mandatoryStops: 1,
  pitBaseSecs: 25,
  tireChangeSecs: 27,
  fuelRateLitersPerSec: 4.0,
  minDriverTimeSecs: 0,
  drivers: [{ id: 'd1', name: 'Driver 1', compounds: {} }],
  compounds: [
    { id: 'M', name: 'Medium', tireLife: 30, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    { id: 'S', name: 'Soft', tireLife: 20, mandatory: false, startLapTime: '1:58', halfLapTime: '2:00', endLapTime: '2:04' },
  ],
};

// A confident learner estimate that differs from INPUTS on every field.
function confidentEstimates() {
  return {
    litersPerLap: 3.0,
    lapsPerFullTank: 28.0, // vs 33 → differs
    fuelWeightPenaltyPerLiter: 0.04, // vs 0.03 → differs
    compounds: {
      M: {
        tireLife: 30,
        startLapTime: '1:58.500',
        halfLapTime: '2:00.000',
        endLapTime: '2:02.000',
        deg: { start: 118.5, half: 120, end: 122 },
        sampleCount: 20,
        volatility: 0.05,
        confident: true,
        highlyVolatile: false,
      },
    },
    trust: {
      fuel: { sampleCount: 30, volatility: 0.05, confident: true, highlyVolatile: false },
      fuelWeightPenalty: { value: 0.04, inRange: true, identifiable: true, sampleCount: 20, volatility: 0.05, confident: true, highlyVolatile: false },
      degradation: { sampleCount: 20, ageSpan: 18, volatility: 0.05, confident: true, highlyVolatile: false },
    },
  };
}

// ---------------------------------------------------------------------------

section('Nothing surfaced when estimates are not confident');
{
  const est = confidentEstimates();
  est.trust.fuel.confident = false;
  est.trust.fuelWeightPenalty.confident = false;
  est.compounds.M.confident = false;
  const recs = buildRecommendations(est, INPUTS, {});
  assert('no recommendations when nothing is confident', recs.length === 0, `got ${recs.length}`);
}

section('Confident + meaningfully different → recommendations surface');
{
  const recs = buildRecommendations(confidentEstimates(), INPUTS, {});
  const byKey = Object.fromEntries(recs.map((r) => [r.key, r]));
  assert('fuel recommendation present', !!byKey.lapsPerFullTank);
  assert('penalty recommendation present', !!byKey.fuelWeightPenaltyPerLiter);
  assert('compound M recommendation present', !!byKey['compound:M']);
  assert('compound S NOT present (no learned curve)', !byKey['compound:S']);
  assert('fuel rec carries current + measured', byKey.lapsPerFullTank.current === 33 && byKey.lapsPerFullTank.measured === 28);
  assert('fuel rec carries a trust payload', byKey.lapsPerFullTank.trust && byKey.lapsPerFullTank.trust.sampleCount === 30);
  assert('inputs were not mutated', INPUTS.lapsPerFullTank === 33 && INPUTS.fuelWeightPenaltyPerLiter === 0.03);
}

section('Within-threshold differences are not surfaced');
{
  const est = confidentEstimates();
  est.lapsPerFullTank = 33.2; // within minFuelLapsDiff (0.5) of 33
  est.fuelWeightPenaltyPerLiter = 0.031; // within minPenaltyDiff (0.003) of 0.03
  // Make the compound match too, so no compound rec.
  est.compounds.M.startLapTime = '2:00.000';
  est.compounds.M.halfLapTime = '2:01.000';
  est.compounds.M.endLapTime = '2:03.000';
  const recs = buildRecommendations(est, INPUTS, {});
  assert('no recommendations when all within threshold', recs.length === 0, `got ${recs.map((r) => r.key).join(',')}`);
}

section('Ignore gate — dismissed stays dismissed until a material shift');
{
  const est = confidentEstimates();
  let recs = buildRecommendations(est, INPUTS, {});
  const fuelRec = recs.find((r) => r.key === 'lapsPerFullTank');

  // User ignores the fuel rec → record the snapshot.
  const dismissed = { [fuelRec.key]: dismissSnapshot(fuelRec) };

  // Same measured value → must NOT re-surface.
  recs = buildRecommendations(est, INPUTS, dismissed);
  assert('ignored fuel rec does not re-nag at same value', !recs.some((r) => r.key === 'lapsPerFullTank'));
  assert('other recs still surface', recs.some((r) => r.key === 'fuelWeightPenaltyPerLiter'));

  // Small drift (< reSurface) → still suppressed.
  est.lapsPerFullTank = 28.0 + RECOMMEND_CONFIG.reSurfaceFuelLaps * 0.5;
  recs = buildRecommendations(est, INPUTS, dismissed);
  assert('small drift after ignore stays suppressed', !recs.some((r) => r.key === 'lapsPerFullTank'));

  // Material shift (>= reSurface) → re-surfaces.
  est.lapsPerFullTank = 28.0 + RECOMMEND_CONFIG.reSurfaceFuelLaps + 0.2;
  recs = buildRecommendations(est, INPUTS, dismissed);
  assert('material shift re-surfaces the rec', recs.some((r) => r.key === 'lapsPerFullTank'));
}

section('Accept applies to a NEW inputs object and yields a valid strategy');
{
  const recs = buildRecommendations(confidentEstimates(), INPUTS, {});
  const fuelRec = recs.find((r) => r.key === 'lapsPerFullTank');
  const penRec = recs.find((r) => r.key === 'fuelWeightPenaltyPerLiter');
  const compRec = recs.find((r) => r.key === 'compound:M');

  let next = applyRecommendation(INPUTS, fuelRec);
  assert('fuel accept updates lapsPerFullTank', next.lapsPerFullTank === 28);
  assert('accept does not mutate original inputs', INPUTS.lapsPerFullTank === 33);
  assert('accept returns a new object', next !== INPUTS);

  next = applyRecommendation(next, penRec);
  assert('penalty accept updates field', next.fuelWeightPenaltyPerLiter === 0.04);

  next = applyRecommendation(next, compRec);
  const m = next.compounds.find((c) => c.id === 'M');
  assert('compound accept updates the 3 lap times', m.startLapTime === '1:58.500' && m.endLapTime === '2:02.000');
  assert('other compound untouched', next.compounds.find((c) => c.id === 'S').startLapTime === '1:58');

  const ranked = findBestStrategies(next);
  assert('accepted inputs produce a valid ranked strategy', Array.isArray(ranked) && ranked.length > 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
