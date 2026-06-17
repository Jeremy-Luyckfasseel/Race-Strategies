/**
 * Tests for the engine-validation measurement library (scripts/lib/validation.js).
 *
 * Builds synthetic CAPTURES from a known ground truth (the same shape the recorder
 * writes) and asserts the comparison recovers fuel/lap, the fuel-weight slope, and
 * the degradation curve, flags a real cliff the piecewise model misses, and runs
 * the engine. This guards the MEASUREMENT logic — it does not touch the engine.
 *
 * Run with: node tests/test_engine_validation.js
 */

import { compareSession, classifyLaps, measureFuelPerLap, resegmentStints } from '../scripts/lib/validation.js';

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

// Known truth: fuel 3 L/lap, penalty 0.03 s/L, piecewise deg over a 28-lap life.
const FUEL = 3,
  PEN = 0.03,
  L = 28,
  BP = 14;
function degOnly(age) {
  if (age <= BP) return 120 + (age / BP) * (121 - 120);
  return 121 + ((age - BP) / BP) * (123 - 121); // age 28 → 123
}
function makeStint(stint, Fi, maxAge, startLap, compound = 'M', degFn = degOnly) {
  const out = [];
  for (let age = 0; age <= maxAge; age++) {
    const fuelStart = Fi - age * FUEL;
    const t = degFn(age) + PEN * fuelStart;
    out.push({
      lap: startLap + age,
      lapTimeMs: Math.round(t * 1000),
      lapTimeSec: Math.round(t * 1000) / 1000,
      fuelStartL: fuelStart,
      fuelEndL: fuelStart - FUEL,
      fuelUsedL: FUEL,
      compound,
      stint,
      tireAge: age,
      tireWear: [100, 100, 100, 100],
      tireRadius: null,
      minSpeedKmh: 120,
      maxSpeedKmh: 280,
      sawPit: false,
      sawOffTrack: false,
      sawPaused: false,
      outLap: age === 0,
      lapJump: false,
      tsEnd: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
section('Recovery from a clean two-stint capture (baseline + race on M)');
{
  const s1 = makeStint(1, 60, 15, 1); // practice/baseline, 60 L, ages 0..15
  const s2 = makeStint(2, 100, 27, 17); // race, full tank, ages 0..27
  s1[s1.length - 1].sawPit = true; // in-lap
  // Model the refuel at the pit: the out-lap's fuel jumps up (negative "used").
  s2[0].fuelStartL = s1[s1.length - 1].fuelEndL;
  s2[0].fuelUsedL = Math.round((s2[0].fuelStartL - s2[0].fuelEndL) * 100) / 100;
  const capture = {
    meta: { tankCapacityL: 100, team: 'TEST', startCompound: 'M', startedAt: '2026-01-01T00:00:00Z' },
    laps: [...s1, ...s2],
    events: [
      { type: 'pitDetected', lap: 16, ts: '2026-01-01T00:30:00Z' },
      { type: 'pitExit', lap: 16, ts: '2026-01-01T00:30:30Z' },
    ],
  };

  const r = compareSession(capture);
  near('fuel/lap recovered', r.fuel.value, FUEL, 0.1);
  assert('fuel-weight identifiable (two fuel ranges)', r.fuelWeight.identifiable === true);
  near('fuel-weight s/L recovered', r.fuelWeight.sPerLiter, PEN, 0.005);
  assert('lap time falls as fuel burns', r.fuelWeight.lapTimeFallsWithFuel === true);

  const m = r.compounds.find((c) => c.id === 'M');
  assert('M model fit', !!m.deg);
  near('deg start', m.deg.start, degOnly(0), 0.3);
  near('deg half', m.deg.half, degOnly(L / 2), 0.3);
  near('deg end', m.deg.end, degOnly(L), 0.3);
  assert('fit residual small', m.residualRmsS != null && m.residualRmsS < 0.15, `rms=${m.residualRmsS}`);
  assert('no false cliff on a clean linear-ish curve', m.cliff.flagged === false);

  assert('engine ran on measured inputs', r.strategy.ran === true);
  assert('engine predicted a positive lap count', r.strategy.predictedTotalLaps > 0);
  assert('verdict object present', !!r.verdicts && !!r.verdicts.fuel && !!r.verdicts.strategy);
}

// ---------------------------------------------------------------------------
section('Cliff detection — real degradation steeper than the 3-point model');
{
  const L2 = 30;
  const cliff = (age) => {
    let base = 118 + (age / L2) * 4; // gentle linear 118 → 122
    if (age > 0.75 * L2) base += (age - 0.75 * L2) * 1.3; // sharp late rise (a cliff)
    return base;
  };
  const s = makeStint(1, 100, 29, 1, 'S', cliff); // single stint on S, 30 laps
  const capture = { meta: { tankCapacityL: 100, team: 'CLIFF', startCompound: 'S' }, laps: s, events: [] };

  const r = compareSession(capture);
  const sc = r.compounds.find((c) => c.id === 'S');
  assert('S model fit', !!sc.deg);
  assert('cliff flagged', sc.cliff.flagged === true, `lateResidual=${sc.cliff.lateResidualS}`);
  assert('degradation verdict diverges on cliff', r.verdicts.degradation.find((d) => d.compound === 'Soft')?.status === 'diverges');
  // Single stint → fuel-weight cannot be separated; report it honestly.
  assert('single stint → fuel-weight not separable', r.fuelWeight.identifiable === false);
  assert('fuel-weight verdict says not-separable', r.verdicts.fuelWeight.status === 'not-separable');
}

// ---------------------------------------------------------------------------
section('Lap cleaning — out-lap / first-flying / in-lap / outliers excluded');
{
  const laps = [
    { lap: 1, lapTimeSec: 120, fuelStartL: 60, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 0, sawPit: false, sawPaused: false, sawOffTrack: false, outLap: true },
    { lap: 2, lapTimeSec: 120, fuelStartL: 57, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 1, sawPit: false, sawPaused: false, sawOffTrack: false },
    { lap: 3, lapTimeSec: 120, fuelStartL: 54, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 2, sawPit: false, sawPaused: false, sawOffTrack: false },
    { lap: 4, lapTimeSec: 121, fuelStartL: 51, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 3, sawPit: false, sawPaused: false, sawOffTrack: false },
    { lap: 5, lapTimeSec: 140, fuelStartL: 48, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 4, sawPit: false, sawPaused: false, sawOffTrack: false }, // traffic outlier
    { lap: 6, lapTimeSec: 121, fuelStartL: 45, fuelUsedL: 3, compound: 'M', stint: 1, tireAge: 5, sawPit: true, sawPaused: false, sawOffTrack: false }, // in-lap
  ];
  classifyLaps(laps);
  const reason = (n) => laps.find((l) => l.lap === n)._reasons;
  assert('out-lap excluded', reason(1).includes('out-lap'));
  assert('first-flying excluded', reason(2).includes('first-flying'));
  assert('clean laps kept', laps.find((l) => l.lap === 3)._degClean && laps.find((l) => l.lap === 4)._degClean);
  assert('traffic outlier excluded', reason(5).includes('slow-outlier'));
  assert('in-lap excluded', reason(6).includes('in-lap'));

  const fuel = measureFuelPerLap(laps, 100);
  near('fuel/lap from all usable laps', fuel.value, 3, 0.01);
}

// ---------------------------------------------------------------------------
section('Stint segmentation is robust — a crash is NOT a pit, a refuel IS');
{
  // One stint on M with a slow "crash" lap in the middle (no refuel) → stays one
  // stint; the crash lap is just an excluded outlier, not a false pit boundary.
  const laps = makeStint(1, 100, 15, 1);
  laps[5].lapTimeSec += 30; // crash: very slow lap
  laps[5].lapTimeMs = Math.round(laps[5].lapTimeSec * 1000);
  laps[5].minSpeedKmh = 0; // car stopped
  const seg = resegmentStints(laps);
  assert('crash does NOT start a new stint', new Set(seg.map((l) => l.stint)).size === 1);

  // A genuine refuel (fuel jumps up on the out-lap) DOES start a new stint.
  const a = makeStint(1, 100, 10, 1);
  const b = makeStint(2, 100, 10, 12);
  b[0].fuelStartL = a[a.length - 1].fuelEndL;
  b[0].fuelUsedL = Math.round((b[0].fuelStartL - b[0].fuelEndL) * 100) / 100;
  const seg2 = resegmentStints([...a, ...b]);
  assert('refuel DOES start a new stint', new Set(seg2.map((l) => l.stint)).size === 2);

  // A compound change (confirmed via keypress) also starts a new stint.
  const c = makeStint(1, 100, 8, 1, 'M');
  const d = makeStint(2, 100, 8, 10, 'S');
  const seg3 = resegmentStints([...c, ...d]);
  assert('compound change starts a new stint', new Set(seg3.map((l) => l.stint)).size === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
