/**
 * Comprehensive test suite for src/logic/strategy.js
 * Run with: node --experimental-vm-modules test_comprehensive.js
 * (or node test_comprehensive.js if package.json has "type":"module")
 */
import {
  parseLapTime,
  formatLapTime,
  formatRaceTime,
  calcPitStopTime,
  findBestStrategies,
} from './src/logic/strategy.js';

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

function assertNear(label, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) <= tolerance;
  assert(label, ok, `expected ${expected}, got ${actual}`);
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
section('parseLapTime');
assertNear('M:SS',         parseLapTime('2:00'),   120);
assertNear('M:SS.mmm',     parseLapTime('1:58.5'), 118.5);
assertNear('plain seconds', parseLapTime('125.3'),  125.3);
assertNear('empty → 120',  parseLapTime(''),        120);
assertNear('null → 120',   parseLapTime(null),      120);

section('formatLapTime');
assert('2:00.000', formatLapTime(120) === '2:00.000');
assert('1:30.500', formatLapTime(90.5) === '1:30.500');

section('formatRaceTime');
assert('8:00:00', formatRaceTime(28800) === '8:00:00');
assert('0:01:30', formatRaceTime(90) === '0:01:30');
assert('invalid → 0:00:00', formatRaceTime(-1) === '0:00:00');

section('calcPitStopTime');
// base only
assertNear('base only', calcPitStopTime(25, false, 27, 0, 4), 25);
// base + tire change
assertNear('base + tires', calcPitStopTime(25, true, 27, 0, 4), 52);
// base + fuel only
assertNear('base + 40L fuel', calcPitStopTime(25, false, 27, 40, 4), 25 + 10);
// base + tires + fuel
assertNear('base + tires + 80L fuel', calcPitStopTime(25, true, 27, 80, 4), 25 + 27 + 20);

// ---------------------------------------------------------------------------
// Tire degradation curve
// ---------------------------------------------------------------------------
section('Tire degradation — single compound (Hard 60 laps, start=120 half=121 end=123)');
{
  const res = findBestStrategies({
    raceDurationHours: 8,
    tankSize: 100,
    lapsPerFullTank: 28,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 60, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns at least one strategy', res.length > 0);
  if (res.length > 0) {
    const best = res[0].strategy;
    const s1 = best.stints[0];
    // First stint avgLap should be between startSecs (120) and endSecs (123)
    assert('Stint 1 avg lap > 120', s1.avgLapTimeSecs > 120);
    assert('Stint 1 avg lap < 123.5', s1.avgLapTimeSecs < 123.5);
    // Total laps must cover about 8h/~121s = ~237 laps
    assert('Total laps > 200', best.totalLaps > 200);
    // At least one pit stop in an 8h race with 28-lap tank
    assert('At least 6 pit stops', best.numPitStops >= 6);
  }
}

// ---------------------------------------------------------------------------
// Fuel tracking
// ---------------------------------------------------------------------------
section('Fuel tracking — tank never overfilled');
{
  const res = findBestStrategies({
    raceDurationHours: 2,
    tankSize: 50,
    lapsPerFullTank: 10,
    fuelMap: 1.0,
    compounds: [
      { id: 'M', name: 'Medium', tireLife: 20, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 20, tireChangeSecs: 20, fuelRateLitersPerSec: 5.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns strategies', res.length > 0);
  if (res.length > 0) {
    const stints = res[0].strategy.stints;
    for (const s of stints.filter(st => st.pitLap !== null)) {
      assert(`Stint ${s.stintNum}: fuelToAdd ≤ tankSize (50L)`, s.fuelToAddLiters <= 50.01,
        `fuelToAdd = ${s.fuelToAddLiters.toFixed(2)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Pit timing
// ---------------------------------------------------------------------------
section('Pit stop timing — fuel-only stop (no tire change, no mandatory)');
{
  // Single compound, tire lasts 40 laps, fuel runs out after 10 laps
  // So each pit should be fuel-only: base + fuel time, no tire change time
  const res = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 30,
    lapsPerFullTank: 9,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns strategies', res.length > 0);
  if (res.length > 0) {
    const stints = res[0].strategy.stints;
    // First intermediate pit should not change tires (fuel-limited)
    const fuelPits = stints.filter(s => s.pitLap !== null && !s.tiresChanged);
    assert('At least one fuel-only pit exists', fuelPits.length > 0);
    for (const s of fuelPits) {
      // pitStopTimeSecs = base (25) + fuel time, no tire change (27)
      assert(`Stint ${s.stintNum}: pit time ≥ 25 and < 52`, s.pitStopTimeSecs >= 25 && s.pitStopTimeSecs < 52,
        `pitStopTimeSecs = ${s.pitStopTimeSecs.toFixed(2)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Compound switch fuel planning
// ---------------------------------------------------------------------------
section('Compound switch fuel planning — switching to faster compound');
{
  // H → S scenario: Soft laps faster, so remaining laps estimate should be LARGER
  // when using Soft avg lap time. This means more fuel should be loaded vs buggy version.
  const res = findBestStrategies({
    raceDurationHours: 2,
    tankSize: 60,
    lapsPerFullTank: 12,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:10', halfLapTime: '2:12', endLapTime: '2:15' },
      { id: 'S', name: 'Soft', tireLife: 15, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:02', endLapTime: '2:05' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  });
  assert('Returns strategies with H→S', res.length > 0);
  if (res.length > 0) {
    const hToS = res.find(r => r.label.includes('Hard') && r.label.includes('Soft'));
    if (hToS) {
      const pits = hToS.strategy.stints.filter(s => s.pitLap !== null);
      // After switching to Soft (faster), no stint should end with a warning about insufficient fuel
      const fuelWarnings = hToS.strategy.stints.filter(s => s.warning && s.warning.includes('fuel'));
      assert('No fuel warnings in H→S strategy', fuelWarnings.length === 0,
        `Found: ${fuelWarnings.map(s => `stint ${s.stintNum}: ${s.warning}`).join(', ')}`);
    } else {
      assert('H→S plan exists in results', false, 'No H→S strategy found; skip compound-switch fuel test');
    }
  }
}

// ---------------------------------------------------------------------------
// Mandatory compound filter
// ---------------------------------------------------------------------------
section('Mandatory compound hard filter');
{
  // Mark Soft as mandatory — all results must include Soft
  const res = findBestStrategies({
    raceDurationHours: 2,
    tankSize: 60,
    lapsPerFullTank: 12,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
      { id: 'S', name: 'Soft', tireLife: 15, mandatory: true,
        startLapTime: '1:56', halfLapTime: '1:58', endLapTime: '2:01' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  });
  assert('Returns strategies when mandatory is satisfiable', res.length > 0);
  for (const r of res) {
    assert(`"${r.label}" includes Soft`, r.compoundIds.includes('S'),
      `compoundIds: ${r.compoundIds.join(',')}`);
  }
}

{
  // Mandatory compound with tireLife 0 → excluded from activeCompounds → no valid strategies
  const res = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 60,
    lapsPerFullTank: 12,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
      { id: 'S', name: 'Soft', tireLife: 0, mandatory: true,  // excluded but mandatory
        startLapTime: '1:56', halfLapTime: '1:58', endLapTime: '2:01' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns [] when mandatory compound is disabled (tireLife=0)', res.length === 0,
    `Got ${res.length} strategies`);
}

// ---------------------------------------------------------------------------
// Mandatory stop count
// ---------------------------------------------------------------------------
section('Mandatory pit stop count');
{
  const res = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 200,
    lapsPerFullTank: 60,  // enough fuel for the whole race without stopping
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 60, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 2, midRaceMode: false,
  });
  assert('Returns strategies when mandatoryStops=2', res.length > 0);
  for (const r of res) {
    assert(`"${r.label}" has ≥ 2 pit stops`, r.strategy.numPitStops >= 2,
      `numPitStops = ${r.strategy.numPitStops}`);
  }
}

// ---------------------------------------------------------------------------
// Mid-race mode — initialFuel null check
// ---------------------------------------------------------------------------
section('Mid-race mode — null fuel defaults to full tank (not 0)');
{
  // midRaceMode=true, currentFuel=null (as set by App.jsx default) must NOT result in empty tank at start
  const res = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 60,
    lapsPerFullTank: 12,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: true,
    currentLap: 1, currentFuel: null, currentCompoundId: '', currentTireAgeLaps: 0,
  });
  assert('Returns strategies with null currentFuel', res.length > 0);
  if (res.length > 0) {
    // With null fuel → full tank (60L) → no immediate fuel warning on stint 1
    const s1 = res[0].strategy.stints[0];
    assert('Stint 1 has no fuel warning when fuel=null', !s1.warning || !s1.warning.includes('fuel'),
      `warning: ${s1.warning}`);
  }
}

// ---------------------------------------------------------------------------
// Mid-race mode — specified fuel carries over correctly
// ---------------------------------------------------------------------------
section('Mid-race mode — specified currentFuel used for stint 1');
{
  const res = findBestStrategies({
    raceDurationHours: 0.5,
    tankSize: 60,
    lapsPerFullTank: 12,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: true,
    currentLap: 5, currentFuel: 40, currentCompoundId: 'H', currentTireAgeLaps: 4,
  });
  assert('Returns strategies starting mid-race', res.length > 0);
  if (res.length > 0) {
    const s1 = res[0].strategy.stints[0];
    assert('Stint 1 starts at lap 5', s1.startLap === 5, `startLap = ${s1.startLap}`);
    // 40L tank → 12 laps max, so stint 1 should be ≤ 12 laps (not 60L / litersPerLap)
    const litersPerLap = 60 / 12;  // 5 L/lap
    const expectedFuelLaps = Math.floor(40 / litersPerLap);
    assert(`Stint 1 laps ≤ fuel laps (${expectedFuelLaps})`, s1.lapsInStint <= expectedFuelLaps + 1,
      `lapsInStint = ${s1.lapsInStint}`);
  }
}

// ---------------------------------------------------------------------------
// Total race time accuracy
// ---------------------------------------------------------------------------
section('Total race time — within 10 laps of expected lap count');
{
  // 8h race, 2:00 laps (120s) → expect ~240 laps
  const res = findBestStrategies({
    raceDurationHours: 8,
    tankSize: 100,
    lapsPerFullTank: 28,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 60, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00' },  // flat pace
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns strategies', res.length > 0);
  if (res.length > 0) {
    const best = res[0].strategy;
    // 8h = 28800s. At 120s flat + some pit time ≈ 225-240 laps
    assert('Total laps in range [220, 245]', best.totalLaps >= 220 && best.totalLaps <= 245,
      `totalLaps = ${best.totalLaps}`);
    // Race finishes on lap completion after time expires, so up to one lap's overshoot is correct
    assert('estTotalRaceTimeSecs ≤ 28800 + one lap (120s)', best.estTotalRaceTimeSecs <= 28920,
      `got ${best.estTotalRaceTimeSecs.toFixed(0)}s`);
  }
}

// ---------------------------------------------------------------------------
// Fuel map scaling
// ---------------------------------------------------------------------------
section('Fuel map — rich map (1.2) uses more fuel per lap, fewer laps per tank');
{
  const base = findBestStrategies({
    raceDurationHours: 2, tankSize: 60, lapsPerFullTank: 15, fuelMap: 1.0,
    compounds: [{ id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  const rich = findBestStrategies({
    raceDurationHours: 2, tankSize: 60, lapsPerFullTank: 15, fuelMap: 1.2,
    compounds: [{ id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  if (base.length > 0 && rich.length > 0) {
    const basePits = base[0].strategy.numPitStops;
    const richPits = rich[0].strategy.numPitStops;
    assert('Rich map results in ≥ as many pit stops as normal', richPits >= basePits,
      `base=${basePits}, rich=${richPits}`);
  }
}

// ---------------------------------------------------------------------------
// Deduplication — identical strategies collapsed
// ---------------------------------------------------------------------------
section('Strategy deduplication');
{
  // Single compound → all plans are the same compound repeated → should deduplicate to 1
  const res = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 60,
    lapsPerFullTank: 10,
    fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Single compound produces exactly 1 unique strategy', res.length === 1,
    `got ${res.length}`);
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
section('Edge cases');
{
  assert('Empty compounds → []', findBestStrategies({
    raceDurationHours: 1, tankSize: 60, lapsPerFullTank: 10, fuelMap: 1.0,
    compounds: [], pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  }).length === 0);

  assert('All tireLife=0 → []', findBestStrategies({
    raceDurationHours: 1, tankSize: 60, lapsPerFullTank: 10, fuelMap: 1.0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 0, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  }).length === 0);

  assert('Zero raceDuration → []', findBestStrategies({
    raceDurationHours: 0, tankSize: 60, lapsPerFullTank: 10, fuelMap: 1.0,
    compounds: [{ id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  }).length === 0);
}

// ---------------------------------------------------------------------------
// Fuel weight model
// ---------------------------------------------------------------------------
section('Fuel weight penalty — later stints run faster as fuel burns');
{
  // With a 0.03 s/L penalty and 50L tank, a full-tank lap should be 1.5s slower
  // than a near-empty lap (for the same tire age). We verify this is applied.
  const resNoPenalty = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 50,
    lapsPerFullTank: 15,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  const resPenalty = findBestStrategies({
    raceDurationHours: 1,
    tankSize: 50,
    lapsPerFullTank: 15,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.03,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:02' },
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Returns strategies with penalty=0', resNoPenalty.length > 0);
  assert('Returns strategies with penalty=0.03', resPenalty.length > 0);
  if (resNoPenalty.length > 0 && resPenalty.length > 0) {
    const avgNone = resNoPenalty[0].strategy.stints[0].avgLapTimeSecs;
    const avgPenalty = resPenalty[0].strategy.stints[0].avgLapTimeSecs;
    // With penalty, stint 1 starts at full-tank pace (same as no-penalty) but
    // gets progressively faster as fuel burns → stint average should be LOWER
    assert('Fuel penalty makes stint average faster (lighter car later)', avgPenalty < avgNone,
      `noPenalty avg=${avgNone.toFixed(3)}, withPenalty avg=${avgPenalty.toFixed(3)}`);
    // Faster laps → more laps fit in the race window (or same, never fewer)
    const lapsNone = resNoPenalty[0].strategy.totalLaps;
    const lapsPenalty = resPenalty[0].strategy.totalLaps;
    assert('Fuel penalty results in ≥ total laps (faster car completes more)', lapsPenalty >= lapsNone,
      `noPenalty=${lapsNone}, withPenalty=${lapsPenalty}`);
  }
}

{
  // Verify first lap time is unchanged by penalty (full tank → correction = 0)
  // Both runs have identical t(start)=2:00 and start with full tank
  const res0 = findBestStrategies({
    raceDurationHours: 0.5,
    tankSize: 50,
    lapsPerFullTank: 15,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00' },  // flat tire curve
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  const res3 = findBestStrategies({
    raceDurationHours: 0.5,
    tankSize: 50,
    lapsPerFullTank: 15,
    fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.03,
    compounds: [
      { id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
        startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00' },  // flat tire curve
    ],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  if (res0.length > 0 && res3.length > 0) {
    // Stint 1 starts at full tank → first-lap contribution is exactly 120s regardless of penalty
    // (The penalty correction at lap 0 is (tankSize - tankSize) * penalty = 0)
    // The avg will differ because later laps in the stint are faster with penalty
    const avg0 = res0[0].strategy.stints[0].avgLapTimeSecs;
    const avg3 = res3[0].strategy.stints[0].avgLapTimeSecs;
    assert('Flat tire + penalty: avg faster than 120s (fuel lightens car)', avg3 <= 120.0,
      `avg with penalty = ${avg3.toFixed(3)}`);
    assert('Flat tire + no penalty: avg = 120s', Math.abs(avg0 - 120.0) < 0.01,
      `avg no penalty = ${avg0.toFixed(3)}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
