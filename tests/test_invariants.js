/**
 * Invariant and correctness tests for src/logic/strategy.js
 *
 * Covers gaps in test_comprehensive.js:
 *   1. Structural invariants on every returned strategy (lap continuity, fuel, tire age)
 *   2. Ranking correctness — result[0] truly dominates every other result
 *   3. Multi-compound (3+ compounds) — all compound combinations appear
 *   4. Multi-driver — minimum drive times satisfied
 *   5. Race time boundary — race finishes within one lap of target
 *   6. Known-answer scenarios — hand-computed expected values
 *   7. Bulk: no fuel overfill or tire overrun across all strategies
 *
 * Run with: node tests/test_invariants.js
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

function assertNear(label, actual, expected, tolerance) {
  const ok = Math.abs(actual - expected) <= tolerance;
  assert(label, ok, `expected ≈${expected} (±${tolerance}), got ${actual}`);
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ---------------------------------------------------------------------------
// Shared compound definitions
// ---------------------------------------------------------------------------

const H  = { id: 'H',  name: 'Hard',   tireLife: 40, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' };
const M  = { id: 'M',  name: 'Medium', tireLife: 25, mandatory: false, startLapTime: '1:58', halfLapTime: '1:59', endLapTime: '2:01' };
const S  = { id: 'S',  name: 'Soft',   tireLife: 15, mandatory: false, startLapTime: '1:55', halfLapTime: '1:57', endLapTime: '2:00' };

// ---------------------------------------------------------------------------
// checkInvariants
// Verifies structural correctness on up to `maxToCheck` strategies.
// ---------------------------------------------------------------------------

function checkInvariants(label, results, inputs, maxToCheck = 5) {
  const targetSecs = inputs.raceDurationHours * 3600;
  const compTireLife = {};
  for (const c of (inputs.compounds || [])) compTireLife[c.id] = c.tireLife;

  if (results.length === 0) {
    assert(`${label}: has results`, false, 'empty array — skipping invariant checks');
    return;
  }

  const toCheck = results.slice(0, maxToCheck);

  for (let ri = 0; ri < toCheck.length; ri++) {
    const r = toCheck[ri];
    const s = r.strategy;
    const stints = s.stints;
    const pfx = `${label}[${ri}]`;

    assert(`${pfx}: stints non-empty`, stints.length > 0);
    if (stints.length === 0) continue;

    // Track cumulative tire age between changes
    let tireAgeLaps = inputs.currentTireAgeLaps || 0;
    let currentCid = stints[0].compound;

    for (let i = 0; i < stints.length; i++) {
      const st = stints[i];
      const sp = `${pfx} stint${i + 1}`;
      const isLast = i === stints.length - 1;

      // Lap count consistency
      assert(`${sp}: lapsInStint >= 1`, st.lapsInStint >= 1,
        `lapsInStint=${st.lapsInStint}`);
      assert(`${sp}: lapsInStint == endLap - startLap + 1`,
        st.lapsInStint === st.endLap - st.startLap + 1,
        `lapsInStint=${st.lapsInStint}, start=${st.startLap}, end=${st.endLap}`);

      // Fuel
      assert(`${sp}: fuelToAddLiters >= 0`, st.fuelToAddLiters >= 0,
        `got ${st.fuelToAddLiters}`);
      assert(`${sp}: fuelToAddLiters <= tankSize`,
        st.fuelToAddLiters <= inputs.tankSize + 0.02,
        `fuelToAdd=${st.fuelToAddLiters?.toFixed(2)}, tank=${inputs.tankSize}`);

      // Pace
      assert(`${sp}: avgLapTimeSecs > 0`, st.avgLapTimeSecs > 0,
        `avg=${st.avgLapTimeSecs}`);
      assert(`${sp}: pitStopTimeSecs >= 0`, st.pitStopTimeSecs >= 0);

      // Pit flags on last vs non-last
      if (isLast) {
        assert(`${sp}: last stint pitLap is null`, st.pitLap === null,
          `pitLap=${st.pitLap}`);
        assert(`${sp}: last stint pitStopTimeSecs == 0`, st.pitStopTimeSecs === 0,
          `got ${st.pitStopTimeSecs}`);
        assert(`${sp}: last stint fuelToAddLiters == 0`, st.fuelToAddLiters === 0,
          `got ${st.fuelToAddLiters}`);
      } else {
        assert(`${sp}: non-last pitLap == endLap`,
          st.pitLap === st.endLap,
          `pitLap=${st.pitLap}, endLap=${st.endLap}`);
      }

      // Lap continuity: each stint starts right after the previous one ended
      if (i > 0) {
        assert(`${sp}: startLap == prev endLap + 1`,
          st.startLap === stints[i - 1].endLap + 1,
          `startLap=${st.startLap}, prevEnd=${stints[i - 1].endLap}`);
      }

      // Tire age: reset on tire change, check cumulative does not exceed tireLife
      if (i > 0 && stints[i - 1].tiresChanged) {
        tireAgeLaps = 0;
        currentCid = st.compound;
      }
      tireAgeLaps += st.lapsInStint;
      const tl = compTireLife[currentCid];
      if (tl && tl > 0) {
        assert(`${sp}: cumulative tire age (${tireAgeLaps}) <= tireLife (${tl})`,
          tireAgeLaps <= tl + 1,
          `overran by ${tireAgeLaps - tl} lap(s)`);
      }
    }

    // Summary field consistency
    const countedPits = stints.filter(st => st.pitLap !== null).length;
    assert(`${pfx}: numPitStops matches counted stints`,
      s.numPitStops === countedPits,
      `numPitStops=${s.numPitStops}, counted=${countedPits}`);

    assert(`${pfx}: totalLaps == last endLap`,
      s.totalLaps === stints[stints.length - 1].endLap,
      `totalLaps=${s.totalLaps}, lastEndLap=${stints[stints.length - 1].endLap}`);

    // Race time: must finish close to the target (no more than 1 extra lap over;
    // can be slightly under if the race ended mid-pit)
    const maxLapTime = Math.max(...stints.map(st => st.avgLapTimeSecs));
    assert(`${pfx}: estTotalRaceTimeSecs <= targetSecs + 2 lap times`,
      s.estTotalRaceTimeSecs <= targetSecs + maxLapTime * 2,
      `est=${s.estTotalRaceTimeSecs.toFixed(1)}, target=${targetSecs}`);
    assert(`${pfx}: estTotalRaceTimeSecs >= targetSecs - 1 pit window (200s)`,
      s.estTotalRaceTimeSecs >= targetSecs - 200,
      `est=${s.estTotalRaceTimeSecs.toFixed(1)}, target=${targetSecs}`);

    // Mandatory compounds appear
    const mandIds = (inputs.compounds || []).filter(c => c.mandatory).map(c => c.id);
    for (const mid of mandIds) {
      assert(`${pfx}: mandatory compound ${mid} used`,
        r.compoundIds.includes(mid), `compoundIds: ${r.compoundIds.join(',')}`);
    }

    // Pit count meets requirement
    assert(`${pfx}: numPitStops >= mandatoryStops`,
      s.numPitStops >= (inputs.mandatoryStops || 0),
      `numPitStops=${s.numPitStops}`);
  }
}

// ---------------------------------------------------------------------------
// checkRanking
// Verifies each result dominates the next (more laps, or equal laps + less time).
// ---------------------------------------------------------------------------

function checkRanking(label, results) {
  for (let i = 1; i < Math.min(results.length, 20); i++) {
    const a = results[i - 1].strategy;
    const b = results[i].strategy;
    const ok =
      a.totalLaps > b.totalLaps ||
      (a.totalLaps === b.totalLaps && a.estTotalRaceTimeSecs <= b.estTotalRaceTimeSecs);
    assert(`${label}: rank[${i - 1}] dominates rank[${i}]`, ok,
      `[${i-1}] laps=${a.totalLaps} time=${a.estTotalRaceTimeSecs.toFixed(0)}` +
      ` vs [${i}] laps=${b.totalLaps} time=${b.estTotalRaceTimeSecs.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Structural invariants across diverse scenarios
// ---------------------------------------------------------------------------

section('Invariants — single compound, 1h race');
{
  const inputs = {
    raceDurationHours: 1, tankSize: 30, lapsPerFullTank: 10, fuelMap: 1.0,
    compounds: [{ ...H }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 3.0,
    mandatoryStops: 0, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  checkInvariants('1h-single', res, inputs);
  checkRanking('1h-single', res);
}

section('Invariants — H+M+S, 4h race, mandatoryStops=1');
{
  const inputs = {
    raceDurationHours: 4, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  checkInvariants('4h-HMS', res, inputs);
  checkRanking('4h-HMS', res);
}

section('Invariants — 8h race, mandatory Soft, mandatoryStops=2');
{
  const inputs = {
    raceDurationHours: 8, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1.0,
    compounds: [{ ...H }, { ...S, mandatory: true }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 2, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  checkInvariants('8h-mandS', res, inputs);
  checkRanking('8h-mandS', res);
}

section('Invariants — mid-race mode, lap 10, 35L fuel remaining');
{
  const inputs = {
    raceDurationHours: 2, tankSize: 60, lapsPerFullTank: 15, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: true,
    currentLap: 10, currentFuel: 35, currentCompoundId: 'H', currentTireAgeLaps: 9,
  };
  const res = findBestStrategies(inputs);
  checkInvariants('mid-race', res, inputs);
  checkRanking('mid-race', res);
}

// ---------------------------------------------------------------------------
// Section 2 — Ranking: top result is provably optimal
// ---------------------------------------------------------------------------

section('Ranking — top result not beaten by any lower-ranked result');
{
  const inputs = {
    raceDurationHours: 2, tankSize: 60, lapsPerFullTank: 15, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  if (res.length > 0) {
    const best = res[0].strategy;
    for (let i = 1; i < res.length; i++) {
      const other = res[i].strategy;
      const dominated =
        best.totalLaps > other.totalLaps ||
        (best.totalLaps === other.totalLaps &&
          best.estTotalRaceTimeSecs <= other.estTotalRaceTimeSecs);
      assert(`Best dominates result[${i}]`, dominated,
        `best: laps=${best.totalLaps} time=${best.estTotalRaceTimeSecs.toFixed(0)}` +
        ` | [${i}]: laps=${other.totalLaps} time=${other.estTotalRaceTimeSecs.toFixed(0)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Multi-compound: all compound combinations explored
// ---------------------------------------------------------------------------

section('Multi-compound — H+M+S: each compound appears; all-3 combo appears');
{
  const inputs = {
    raceDurationHours: 4, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);

  const usedSets = res.map(r => r.compoundIds);
  assert('Hard appears in some strategy',   usedSets.some(s => s.includes('H')));
  assert('Medium appears in some strategy', usedSets.some(s => s.includes('M')));
  assert('Soft appears in some strategy',   usedSets.some(s => s.includes('S')));
  assert('Some strategy uses all 3',
    usedSets.some(s => s.includes('H') && s.includes('M') && s.includes('S')));
}

section('Multi-compound — H+M+S+IM+W: 5-compound scenario has many strategies');
{
  const IM = { id: 'IM', name: 'Intermediate', tireLife: 20, mandatory: false,
    startLapTime: '2:05', halfLapTime: '2:07', endLapTime: '2:10' };
  const W  = { id: 'W',  name: 'Wet',          tireLife: 18, mandatory: false,
    startLapTime: '2:08', halfLapTime: '2:10', endLapTime: '2:13' };
  const inputs = {
    raceDurationHours: 3, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }, { ...S }, IM, W],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  // With 5 compounds the engine generates thousands of patterns — result should be large
  assert('5-compound race yields many strategies (> 50)', res.length > 50,
    `got ${res.length}`);
  checkRanking('5-compound', res);
}

// ---------------------------------------------------------------------------
// Section 4 — Multi-driver: minimum drive time satisfied in best result
// ---------------------------------------------------------------------------

section('Multi-driver — 2 drivers, 2h minimum each in 6h race');
{
  const inputs = {
    raceDurationHours: 6, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1.0,
    compounds: [{ ...H }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
    drivers: [
      { id: 'd1', name: 'Alice', compounds: {} },
      { id: 'd2', name: 'Bob',   compounds: {} },
    ],
    minDriverTimeSecs: 7200,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  if (res.length > 0) {
    const summary = res[0].strategy.driverSummary;
    assert('Driver summary has 2 entries', summary.length === 2, `got ${summary.length}`);
    for (const d of summary) {
      assert(`${d.name}: metMinimum flag is true`, d.metMinimum,
        `totalTimeSecs=${d.totalTimeSecs?.toFixed(0)}, required=7200`);
      assert(`${d.name}: actual time >= 2h`,
        d.totalTimeSecs >= 7200,
        `got ${d.totalTimeSecs?.toFixed(0)}s`);
    }
  }
}

section('Multi-driver — 3 drivers, 1h minimum each in 4h race');
{
  const inputs = {
    raceDurationHours: 4, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 2, midRaceMode: false,
    drivers: [
      { id: 'd1', name: 'Alice', compounds: {} },
      { id: 'd2', name: 'Bob',   compounds: {} },
      { id: 'd3', name: 'Carol', compounds: {} },
    ],
    minDriverTimeSecs: 3600,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  if (res.length > 0) {
    const summary = res[0].strategy.driverSummary;
    assert('Driver summary has 3 entries', summary.length === 3);
    for (const d of summary) {
      assert(`${d.name}: metMinimum`, d.metMinimum,
        `totalTimeSecs=${d.totalTimeSecs?.toFixed(0)}s`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section 5 — Race time boundary
// ---------------------------------------------------------------------------

section('Race time boundary — 1h flat 2:00 laps, within one lap of target');
{
  const inputs = {
    raceDurationHours: 1, tankSize: 60, lapsPerFullTank: 20, fuelMap: 1.0,
    compounds: [{
      id: 'H', name: 'Hard', tireLife: 30, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00',
    }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  if (res.length > 0) {
    const s = res[0].strategy;
    // Must not finish more than 1 lap (120s) past the flag
    assert('estTotalRaceTimeSecs <= target + 1 lap',
      s.estTotalRaceTimeSecs <= 3600 + 120,
      `got ${s.estTotalRaceTimeSecs.toFixed(1)}s`);
    // Must be reasonably close to the target (within one pit stop window)
    assert('estTotalRaceTimeSecs >= target - 200s',
      s.estTotalRaceTimeSecs >= 3400,
      `got ${s.estTotalRaceTimeSecs.toFixed(1)}s`);
  }
}

section('Race time boundary — 8h race, last stint has no pitLap');
{
  const inputs = {
    raceDurationHours: 8, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1.0,
    compounds: [{ ...H }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  // Every strategy's last stint must be the finishing stint (no pit after it)
  for (let i = 0; i < Math.min(res.length, 10); i++) {
    const stints = res[i].strategy.stints;
    const lastStint = stints[stints.length - 1];
    assert(`result[${i}] last stint has pitLap === null`,
      lastStint.pitLap === null,
      `pitLap=${lastStint.pitLap}`);
  }
}

// ---------------------------------------------------------------------------
// Section 6 — Known-answer scenarios
// ---------------------------------------------------------------------------

section('Known answer — fuel-only pits (tireLife >> fuel range)');
// Setup: 1h race, flat 2:00 laps, 30L tank, 10 laps/tank (3 L/lap),
//        tireLife=40 (4× the fuel range), no fuel-weight penalty.
// Every pit is fuel-only: tireLife always outlasts fuel (40 >> 10).
// Pit time = 25s base + 30L / 3 L/s = 35s (no tire-change 27s).
// Stint 1: laps 1–10. Pit 35s. Elapsed 1235s.
// Stint 2: laps 11–20. Pit 35s. Elapsed 2470s.
// Stint 3: laps 21–30. Elapsed 3670s (crosses 3600 on lap 30).
// Expected: totalLaps≈30, numPitStops=2, all pits fuel-only.
{
  const inputs = {
    raceDurationHours: 1,
    tankSize: 30, lapsPerFullTank: 10, fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0,
    compounds: [{
      id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00',
    }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 3.0,
    mandatoryStops: 0, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Exactly 1 strategy (single compound)', res.length === 1, `got ${res.length}`);
  if (res.length > 0) {
    const s = res[0].strategy;
    assertNear('totalLaps ≈ 30',         s.totalLaps,              30,   1);
    assertNear('numPitStops ≈ 2',        s.numPitStops,            2,    1);
    assertNear('estRaceTime ≈ 3670s',    s.estTotalRaceTimeSecs,   3670, 10);

    const nonLastStints = s.stints.filter(st => st.pitLap !== null);
    const fuelOnlyPits = nonLastStints.filter(st => !st.tiresChanged);
    assert('All pit stops are fuel-only (no tire changes)',
      fuelOnlyPits.length === nonLastStints.length,
      `${nonLastStints.length - fuelOnlyPits.length} unexpected tire-change pit(s)`);
    for (const st of fuelOnlyPits) {
      assertNear(`Stint ${st.stintNum} pit time ≈ 35s`, st.pitStopTimeSecs, 35, 2);
    }
  }
}

section('Known answer — tire-limited pits (tireLife << fuel range)');
// Setup: 1h race, flat 2:00 laps, 60L tank, 15 laps/tank (4 L/lap),
//        tireLife=8 (far below fuel range of 15), no penalty.
// Tires always run out before fuel; every pit must change tires.
// Expected: ~4 stints, numPitStops=3, all pits include tire change.
{
  const inputs = {
    raceDurationHours: 1,
    tankSize: 60, lapsPerFullTank: 15, fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0,
    compounds: [{
      id: 'H', name: 'Hard', tireLife: 8, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00',
    }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Exactly 1 strategy (single compound)', res.length === 1, `got ${res.length}`);
  if (res.length > 0) {
    const s = res[0].strategy;
    assertNear('totalLaps in range [25, 35]', s.totalLaps, 30, 5);
    assertNear('numPitStops ≈ 3', s.numPitStops, 3, 1);

    const nonLastStints = s.stints.filter(st => st.pitLap !== null);
    const tirePits = nonLastStints.filter(st => st.tiresChanged);
    assert('All pit stops change tires',
      tirePits.length === nonLastStints.length,
      `only ${tirePits.length} of ${nonLastStints.length} pits changed tires`);

    // No stint should run more laps than tireLife
    for (const st of s.stints) {
      assert(`Stint ${st.stintNum}: lapsInStint (${st.lapsInStint}) <= tireLife (8)`,
        st.lapsInStint <= 8 + 1);
    }
  }
}

section('Known answer — flat laps, fuel-weight penalty makes avg faster than base');
// With no fuel-weight penalty, flat 2:00 laps → avg exactly 2:00 per stint.
// With penalty=0.03, car lightens as fuel burns → avg < 2:00 per stint.
{
  const base = findBestStrategies({
    raceDurationHours: 1, tankSize: 50, lapsPerFullTank: 15, fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0,
    compounds: [{
      id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00',
    }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  const pen = findBestStrategies({
    raceDurationHours: 1, tankSize: 50, lapsPerFullTank: 15, fuelMap: 1.0,
    fuelWeightPenaltyPerLiter: 0.03,
    compounds: [{
      id: 'H', name: 'Hard', tireLife: 40, mandatory: false,
      startLapTime: '2:00', halfLapTime: '2:00', endLapTime: '2:00',
    }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 0, midRaceMode: false,
  });
  assert('Both have results', base.length > 0 && pen.length > 0);
  if (base.length > 0 && pen.length > 0) {
    assertNear('No-penalty stint 1 avg == 120s',
      base[0].strategy.stints[0].avgLapTimeSecs, 120, 0.01);
    assert('Penalty stint 1 avg < 120s (fuel lightens car)',
      pen[0].strategy.stints[0].avgLapTimeSecs < 120,
      `avg=${pen[0].strategy.stints[0].avgLapTimeSecs.toFixed(3)}`);
    assert('Penalty strategy gets >= as many laps',
      pen[0].strategy.totalLaps >= base[0].strategy.totalLaps,
      `pen=${pen[0].strategy.totalLaps}, base=${base[0].strategy.totalLaps}`);
  }
}

// ---------------------------------------------------------------------------
// Section 7 — Bulk checks: no overfill or tire overrun in any strategy
// ---------------------------------------------------------------------------

section('Bulk — no fuel overfill across all strategies (6h, H+M+S, rich map)');
{
  const inputs = {
    raceDurationHours: 6, tankSize: 80, lapsPerFullTank: 20, fuelMap: 1.1,
    compounds: [{ ...H }, { ...M }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 2, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  let overfillCount = 0;
  for (const r of res) {
    for (const st of r.strategy.stints) {
      if (st.fuelToAddLiters > inputs.tankSize + 0.02) overfillCount++;
    }
  }
  assert(`No fuel overfill across all ${res.length} strategies`, overfillCount === 0,
    `${overfillCount} overfill instance(s)`);
}

section('Bulk — no tire overrun across all strategies (4h, H+M+S)');
{
  const inputs = {
    raceDurationHours: 4, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }, { ...S }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);

  const compTireLife = {};
  for (const c of inputs.compounds) compTireLife[c.id] = c.tireLife;

  let overrunCount = 0;
  for (const r of res) {
    const stints = r.strategy.stints;
    let cumAge = 0;
    let cid = stints[0]?.compound;
    for (let i = 0; i < stints.length; i++) {
      if (i > 0 && stints[i - 1].tiresChanged) {
        cumAge = 0;
        cid = stints[i].compound;
      }
      cumAge += stints[i].lapsInStint;
      const tl = compTireLife[cid];
      if (tl && cumAge > tl + 1) overrunCount++;
    }
  }
  assert(`No tire overrun across all ${res.length} strategies`, overrunCount === 0,
    `${overrunCount} overrun instance(s)`);
}

section('Bulk — no stint warnings in well-formed 4h race');
{
  const inputs = {
    raceDurationHours: 4, tankSize: 80, lapsPerFullTank: 22, fuelMap: 1.0,
    compounds: [{ ...H }, { ...M }],
    pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
    mandatoryStops: 1, midRaceMode: false,
  };
  const res = findBestStrategies(inputs);
  assert('Has strategies', res.length > 0);
  if (res.length > 0) {
    const bestStints = res[0].strategy.stints;
    const warnings = bestStints.filter(st => st.warning);
    assert('Best strategy has no stint warnings', warnings.length === 0,
      warnings.map(st => `stint ${st.stintNum}: ${st.warning}`).join(', '));
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
