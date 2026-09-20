/**
 * Dry/wet compound filtering and the crossover decision.
 *
 * Run with: node tests/test_conditions.js
 */

import {
  isWetCompound, compoundsFor, conditionsUnavailable,
  crossoverSecsPerLap, tyreOnlyPitLoss,
} from '../src/logic/conditions.js';

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

const c = (id, tireLife) => ({ id, tireLife });
const FULL = [c('H', 60), c('M', 40), c('S', 25), c('IM', 30), c('W', 20)];
const ids = (list) => list.map((x) => x.id).join(',');

// ────────────────────────────────────────────────────────────────────────────

section('which tyres are wet-weather tyres');
{
  assert('inters are', isWetCompound('IM'));
  assert('full wets are', isWetCompound('W'));
  assert('slicks are not', !isWetCompound('H') && !isWetCompound('M') && !isWetCompound('S'));
  assert('and nonsense is not', !isWetCompound(null) && !isWetCompound('X'));
}

section('filtering by conditions');
{
  assert('dry gives the slicks', ids(compoundsFor(FULL, 'dry')) === 'H,M,S');
  assert('wet gives the wets', ids(compoundsFor(FULL, 'wet')) === 'IM,W');
  assert('an unknown condition filters nothing',
    ids(compoundsFor(FULL, undefined)) === 'H,M,S,IM,W');
}

section('a switched-off compound is never offered');
{
  const noWets = [c('H', 60), c('M', 40), c('IM', 0), c('W', 0)];
  assert('life 0 keeps it out of the dry set', ids(compoundsFor(noWets, 'dry')) === 'H,M');
}

section('asking for wets with no wets set up');
{
  const noWets = [c('H', 60), c('M', 40), c('IM', 0), c('W', 0)];
  assert('it plans on what there is rather than refusing',
    ids(compoundsFor(noWets, 'wet')) === 'H,M',
    ids(compoundsFor(noWets, 'wet')));
  assert('and says the request could not be honoured',
    conditionsUnavailable(noWets, 'wet') === true);
  assert('which is not the case when they exist',
    conditionsUnavailable(FULL, 'wet') === false);
  assert('nor when nothing at all is set up',
    conditionsUnavailable([c('H', 0)], 'wet') === false);
}

section('the crossover — how much you must be losing to justify a stop');
{
  // A 52 s stop with 40 laps left pays for itself at 1.3 s/lap.
  assert('stop divided by laps', Math.abs(crossoverSecsPerLap(52, 40) - 1.3) < 0.001,
    String(crossoverSecsPerLap(52, 40)));
  assert('fewer laps left means you must be losing more',
    crossoverSecsPerLap(52, 10) > crossoverSecsPerLap(52, 40));
  assert('with one lap left, only a catastrophe justifies it',
    Math.abs(crossoverSecsPerLap(52, 1) - 52) < 0.001);

  assert('no laps left, no decision', crossoverSecsPerLap(52, 0) === null);
  assert('a negative lap count is not a decision', crossoverSecsPerLap(52, -3) === null);
  assert('a free stop is not a decision', crossoverSecsPerLap(0, 40) === null);
  assert('and nonsense is not', crossoverSecsPerLap(NaN, 40) === null);

  assert('a part-lap counts as the whole laps it contains',
    crossoverSecsPerLap(52, 40.9) === crossoverSecsPerLap(52, 40));
}

section('what an unscheduled tyre stop costs');
{
  assert('the pit lane plus the tyre change',
    tyreOnlyPitLoss({ pitBaseSecs: 25, tireChangeSecs: 27 }) === 52);
  assert('no fuel is assumed — rain does not make the car thirsty',
    tyreOnlyPitLoss({ pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4 }) === 52);
  assert('missing numbers are zero rather than NaN', tyreOnlyPitLoss({}) === 0);
  assert('and no inputs at all is zero', tyreOnlyPitLoss(null) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
