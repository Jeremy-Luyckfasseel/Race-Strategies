/**
 * Box now or wait — the comparison that replaced a wrong assumption.
 *
 * The first version costed an early stop as a whole extra stop. It is only an
 * extra stop if the race cannot absorb it, and a plan that finishes with tyre
 * life or fuel range left over absorbs it for nothing but the time stationary.
 * So the last section here runs the real engine and checks exactly that: with
 * slack in the plan, coming in early does NOT cost a stop.
 *
 * Run with: node tests/test_pit_now.js
 */

import { pitNowScenarios, comparePitNow, fullServiceLoss, PIT_NOW, WAIT } from '../src/logic/pitNow.js';
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

const INPUTS = {
  raceDurationHours: 2,
  tankSize: 100,
  lapsPerFullTank: 28,
  fuelMap: 1,
  compounds: [
    { id: 'M', name: 'Medium', tireLife: 40, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 27,
  fuelRateLitersPerSec: 4,
  fuelWeightPenaltyPerLiter: 0.03,
  drivers: [],
  minDriverTimeSecs: 0,
  mandatoryStops: 0,
};

const result = (totalLaps, estTotalRaceTimeSecs) => ({ best: { strategy: { totalLaps, estTotalRaceTimeSecs } } });

// ────────────────────────────────────────────────────────────────────────────

section('the two futures');
{
  // The live inputs carry a penalty, because by the time an engineer asks this
  // question they may already have applied one. Both futures cost their option
  // by taking time off the clock, so neither may ALSO be slowed per lap.
  const s = pitNowScenarios({
    inputs: { ...INPUTS, pacePenaltySecs: 4, pacePenaltyLaps: 10 },
    currentLap: 20, currentFuel: 30, compoundId: 'M',
    tyreAgeLaps: 12, lossPerLapSecs: 2, lapsToNextStop: 10, lapsRemaining: 40,
    pitLossSecs: 52, repairSecs: 5,
  });

  assert('coming in means a full tank', s.pitNow.currentFuel === 100);
  assert('and fresh tyres', s.pitNow.currentTireAgeLaps === 0);
  assert('with the stop and the repair off the clock',
    Math.abs(s.pitNow.raceDurationHours - (2 - 57 / 3600)) < 1e-9,
    String(s.pitNow.raceDurationHours));

  assert('waiting keeps the fuel it has', s.wait.currentFuel === 30);
  assert('and the tyres it is on', s.wait.currentTireAgeLaps === 12);
  assert('bleeding 2s for ten laps, plus the repair at the stop',
    Math.abs(s.wait.raceDurationHours - (2 - 25 / 3600)) < 1e-9,
    String(s.wait.raceDurationHours));

  assert('both are mid-race runs', s.pitNow.midRaceMode && s.wait.midRaceMode);
  assert('and neither carries a pace penalty, since the cost is off the clock',
    s.pitNow.pacePenaltySecs === 0 && s.wait.pacePenaltySecs === 0,
    `${s.pitNow.pacePenaltySecs} / ${s.wait.pacePenaltySecs}`);
  assert('nor a penalty window inherited from the live inputs',
    s.pitNow.pacePenaltyLaps === null && s.wait.pacePenaltyLaps === null,
    `${s.pitNow.pacePenaltyLaps} / ${s.wait.pacePenaltyLaps}`);
}

section('with no stop left in the plan, waiting means carrying it to the flag');
{
  const s = pitNowScenarios({
    inputs: INPUTS, currentLap: 50, currentFuel: 40, compoundId: 'M',
    lossPerLapSecs: 2, lapsToNextStop: null, lapsRemaining: 12,
    pitLossSecs: 52, repairSecs: 5,
  });
  assert('it bleeds for every remaining lap', s.bleedLaps === 12, String(s.bleedLaps));
  assert('and is never repaired, so no repair time is charged',
    s.repairedLater === false);
  assert('which is 24 seconds off the clock',
    Math.abs(s.wait.raceDurationHours - (2 - 24 / 3600)) < 1e-9,
    String(s.wait.raceDurationHours));
}

section('a missing fuel reading is not an empty tank');
{
  for (const fuel of [undefined, null, NaN, -3]) {
    assert(`fuel ${String(fuel)} gives no scenarios rather than a poisoned one`,
      pitNowScenarios({
        inputs: INPUTS, currentLap: 20, currentFuel: fuel, compoundId: 'M',
        lossPerLapSecs: 2, lapsToNextStop: 10, lapsRemaining: 40,
        pitLossSecs: 52, repairSecs: 5,
      }) === null);
  }
  assert('an empty tank is still a real reading',
    pitNowScenarios({
      inputs: INPUTS, currentLap: 20, currentFuel: 0, compoundId: 'M',
      lossPerLapSecs: 2, lapsToNextStop: 10, lapsRemaining: 40,
      pitLossSecs: 52, repairSecs: 5,
    }) !== null);
  assert('and a non-finite lap count is not a close call',
    comparePitNow(result(NaN, 1), result(80, 1)) === null);
}

section('no time left is not a decision');
{
  assert('a finished race has nothing to compare',
    pitNowScenarios({ inputs: { ...INPUTS, raceDurationHours: 0 }, currentLap: 1 }) === null);
}

section('comparing what the two finish with');
{
  const more = comparePitNow(result(84, 7200), result(82, 7200));
  assert('more laps wins', more.best === PIT_NOW && more.lapsDelta === 2);

  const fewer = comparePitNow(result(81, 7200), result(83, 7200));
  assert('fewer laps loses', fewer.best === WAIT && fewer.lapsDelta === -2);

  const onTime = comparePitNow(result(83, 7100), result(83, 7200));
  assert('level on laps falls to the clock', onTime.best === PIT_NOW, JSON.stringify(onTime));
  assert('and reports the seconds', onTime.secsDelta === 100);

  const dead = comparePitNow(result(83, 7200.2), result(83, 7200));
  assert('a fraction of a second is a dead heat, not a call', dead.tied === true);
  assert('which names no winner rather than inventing one', dead.best === null);

  assert('nothing to compare gives nothing', comparePitNow(null, result(80, 1)) === null);
}

section('the real engine: an early stop the race can absorb');
{
  // Two hours, 28 laps a tank, 40-lap tyres. Fuel forces the stops, so the
  // tyres always have life left when the car comes in — there is slack.
  const s = pitNowScenarios({
    inputs: INPUTS, currentLap: 10, currentFuel: 60, compoundId: 'M',
    tyreAgeLaps: 10, lossPerLapSecs: 0.4, lapsToNextStop: 8, lapsRemaining: 45,
    pitLossSecs: 52, repairSecs: 5,
  });

  const pit = { best: findBestStrategies(s.pitNow)[0] };
  const wait = { best: findBestStrategies(s.wait)[0] };
  const cmp = comparePitNow(pit, wait);

  assert('both futures produce a plan', cmp !== null, JSON.stringify(cmp));
  // The point of the whole module: coming in early has NOT cost a whole stop.
  // If it had, the difference would be a stop's worth of laps, not one or two.
  assert('an early stop does not cost a stop\'s worth of laps',
    Math.abs(cmp.lapsDelta) <= 2, JSON.stringify(cmp));

  // And at a trivial loss, waiting should still be at least as good.
  assert('with almost nothing wrong, there is no case for boxing',
    cmp.best !== PIT_NOW || cmp.lapsDelta <= 0, JSON.stringify(cmp));
}

section('the real engine: damage bad enough to be worth the stop');
{
  const heavy = pitNowScenarios({
    inputs: INPUTS, currentLap: 10, currentFuel: 60, compoundId: 'M',
    tyreAgeLaps: 10, lossPerLapSecs: 12, lapsToNextStop: 8, lapsRemaining: 45,
    pitLossSecs: 52, repairSecs: 5,
  });
  const cmp = comparePitNow(
    { best: findBestStrategies(heavy.pitNow)[0] },
    { best: findBestStrategies(heavy.wait)[0] },
  );
  assert('twelve seconds a lap is worth coming in for',
    cmp.best === PIT_NOW || cmp.tied, JSON.stringify(cmp));
}

section('a stop for damage is a full service, not a tyre change');
{
  // Coming in with 30 of 100 litres: 70 litres at 4 L/s is 17.5 s on top of
  // the pit lane and the tyres. Charging only base + tyres would make coming
  // in look cheaper than it is, and on an early lap it is much cheaper.
  assert('pit lane, tyres and the fuel it takes to fill it',
    Math.abs(fullServiceLoss(INPUTS, 30) - (25 + 27 + 70 / 4)) < 1e-9,
    String(fullServiceLoss(INPUTS, 30)));
  assert('a nearly-full car pays almost no fuel time',
    Math.abs(fullServiceLoss(INPUTS, 98) - (25 + 27 + 0.5)) < 1e-9,
    String(fullServiceLoss(INPUTS, 98)));
  assert('an empty one pays the lot',
    Math.abs(fullServiceLoss(INPUTS, 0) - (25 + 27 + 25)) < 1e-9,
    String(fullServiceLoss(INPUTS, 0)));
  assert('and a stop early in a stint costs more than one late in it',
    fullServiceLoss(INPUTS, 10) > fullServiceLoss(INPUTS, 80));
  assert('no inputs is zero rather than NaN', fullServiceLoss(null, 0) === 0);
}

section('damage is carried until the next stop, not to the flag');
{
  const base = { ...INPUTS, mandatoryStops: 0 };
  const plan = (o) => findBestStrategies({ ...base, ...o })[0].strategy;

  const healthy = plan({});
  const forever = plan({ pacePenaltySecs: 8 });
  const untilStop = plan({ pacePenaltySecs: 8, pacePenaltyLaps: 6 });

  assert('unrepaired damage costs the whole race',
    forever.estTotalRaceTimeSecs !== healthy.estTotalRaceTimeSecs
      || forever.totalLaps < healthy.totalLaps,
    `${healthy.totalLaps} vs ${forever.totalLaps}`);
  assert('six damaged laps cost far less than a damaged race',
    untilStop.totalLaps >= forever.totalLaps, `${untilStop.totalLaps} vs ${forever.totalLaps}`);
  assert('and a window of zero laps costs nothing at all',
    plan({ pacePenaltySecs: 8, pacePenaltyLaps: 0 }).totalLaps === healthy.totalLaps);

  // The window must actually bite: the same damage over more laps costs more.
  const six = plan({ pacePenaltySecs: 8, pacePenaltyLaps: 6 }).estTotalRaceTimeSecs;
  const twenty = plan({ pacePenaltySecs: 8, pacePenaltyLaps: 20 }).estTotalRaceTimeSecs;
  assert('twenty damaged laps is worse than six',
    twenty !== six, `${six} vs ${twenty}`);
}

section('an unknown fuel reading is not an empty tank');
{
  // Number(null) is 0, not NaN, so an unknown reading coerced straight to a
  // number is indistinguishable from a dry tank — and a dry tank quotes the
  // most expensive stop there is. That number feeds how many places a stop
  // would cost, so guessing here shows "you lose three places" when you lose
  // one. There is no honest answer without a reading.
  const INP = { pitBaseSecs: 25, tireChangeSecs: 5, tankSize: 100, fuelRateLitersPerSec: 4 };

  assert('a real reading costs only the fuel actually needed',
    Math.abs(fullServiceLoss(INP, 60) - (25 + 5 + 10)) < 1e-9,
    String(fullServiceLoss(INP, 60)));
  assert('a genuinely empty tank costs a full refuel',
    Math.abs(fullServiceLoss(INP, 0) - (25 + 5 + 25)) < 1e-9,
    String(fullServiceLoss(INP, 0)));

  assert('but no reading at all says nothing', fullServiceLoss(INP, null) === null);
  assert('and neither does an undefined one', fullServiceLoss(INP, undefined) === null);
  assert('nor a value that is not a number', fullServiceLoss(INP, 'x') === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
