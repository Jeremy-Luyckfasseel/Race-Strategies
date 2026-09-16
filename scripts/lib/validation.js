/**
 * Engine-validation comparison (engine-validation branch). PURE Node, no React.
 *
 * The MEASUREMENT lives in src/logic/sessionAnalysis.js (shared with the in-app
 * session import — one derivation brain, no duplicate maths). This module is the
 * validation layer on top: it feeds the measured inputs into the strategy engine
 * and reports, per metric, whether the engine matches reality "within tolerance"
 * or "diverges — by how much / why". It imports strategy.js; it never modifies it.
 */

import { findBestStrategies, formatRaceTime } from '../../src/logic/strategy.js';
import {
  analyzeCapture,
  // re-exported below so existing tooling/tests can import them from here too
  classifyLaps,
  resegmentStints,
  measureFuelPerLap,
  fitCompoundModel,
} from '../../src/logic/sessionAnalysis.js';

export { analyzeCapture, classifyLaps, resegmentStints, measureFuelPerLap, fitCompoundModel };

// Tolerances — what counts as "matches" vs "diverges". Mirror the Phase-1
// live-trust bands and the Phase-4 mock-race pass bar. Tune after real residuals.
export const TOLERANCES = {
  fuelWeightSPerL: 0.005, // s/L — measured vs the 0.03 assumption
  lapTimeS: 0.3, // s/lap — degradation curve residual
  pitLapLaps: 1, // laps — predicted vs actual pit lap
  totalLapsLaps: 1, // laps — predicted vs actual total laps
};

// ---------------------------------------------------------------------------
// Build standalone engine inputs for the RECORDED race (its own duration / pits),
// so the engine's plan can be compared against what the driver actually did.
// ---------------------------------------------------------------------------

function buildEngineInputs(a) {
  const tank = a.tank;
  const fuelPerLap = a.fuel.value;
  const compounds = a.compounds
    .filter((c) => c.deg && c.observed)
    .map((c) => ({
      id: c.id,
      name: c.name,
      tireLife: Math.max(1, Math.round(c.observedLife)),
      mandatory: false,
      startLapTime: c.observed.start,
      halfLapTime: c.observed.half,
      endLapTime: c.observed.end,
    }));
  return {
    raceDurationHours: a.race.durationHours,
    tankSize: tank,
    lapsPerFullTank: fuelPerLap > 0 ? tank / fuelPerLap : 1,
    fuelMap: 1.0,
    compounds,
    pitBaseSecs: a.race.pitBaseSecs != null ? a.race.pitBaseSecs : 25,
    tireChangeSecs: 0, // pit time lumped into pitBaseSecs from the measured stop
    fuelRateLitersPerSec: 4.0,
    fuelWeightPenaltyPerLiter: a.penalty,
    mandatoryStops: 0,
    drivers: [{ id: 'd1', name: 'Driver', compounds: {} }],
    minDriverTimeSecs: 0,
    midRaceMode: false,
  };
}

export function compareSession(capture) {
  const a = analyzeCapture(capture);

  let strategy = { ran: false, reason: 'no usable compound model' };
  const usable = a.compounds.filter((c) => c.deg && c.observed);
  if (usable.length && a.fuel.value && a.tank > 0 && a.race.durationHours > 0) {
    const ranked = findBestStrategies(buildEngineInputs(a));
    if (ranked && ranked.length) {
      const best = ranked[0];
      const predictedPitLaps = best.strategy.stints.filter((s) => s.pitLap != null).map((s) => s.pitLap);
      strategy = {
        ran: true,
        label: best.label,
        predictedTotalLaps: best.strategy.totalLaps,
        predictedPitLaps,
        predictedFirstPit: predictedPitLaps[0] ?? null,
        actualTotalLaps: a.race.actualTotalLaps,
        actualPitLaps: a.race.actualPitLaps,
        actualFirstPit: a.race.actualPitLaps[0] ?? null,
      };
    } else {
      strategy = { ran: false, reason: 'engine returned no valid strategy for the measured inputs' };
    }
  }

  return {
    meta: a.meta,
    counts: a.counts,
    fuel: a.fuel,
    fuelWeight: a.fuelWeight,
    compounds: a.compounds,
    race: a.race,
    warnings: a.warnings,
    strategy,
    verdicts: buildVerdicts(a, strategy),
  };
}

function verdict(diff, tol) {
  return Math.abs(diff) <= tol ? 'matches' : 'diverges';
}

function buildVerdicts(a, strategy) {
  const v = {};
  const { fuel, fuelWeight, compounds } = a;

  v.fuel = {
    status: fuel.sampleCount >= 3 && fuel.value ? 'measured' : 'insufficient-data',
    detail: fuel.value != null ? `${fuel.value.toFixed(2)} L/lap (±${fuel.spread.toFixed(2)}, n=${fuel.sampleCount})` : 'no data',
  };

  if (!fuelWeight.identifiable) {
    v.fuelWeight = { status: 'not-separable', detail: 'fuel-weight could not be separated from degradation — run a second stint / baseline at a different fuel load' };
  } else {
    const diff = fuelWeight.sPerLiter - fuelWeight.assumed;
    v.fuelWeight = {
      status: verdict(diff, TOLERANCES.fuelWeightSPerL),
      detail: `measured ${fuelWeight.sPerLiter.toFixed(4)} s/L vs assumed ${fuelWeight.assumed} (Δ ${diff >= 0 ? '+' : ''}${diff.toFixed(4)}); lap time ${fuelWeight.lapTimeFallsWithFuel ? 'falls' : 'does NOT fall'} as fuel burns`,
    };
  }

  v.degradation = compounds
    .filter((c) => c.deg)
    .map((c) => ({
      compound: c.name,
      status: c.cliff.flagged ? 'diverges' : c.residualRmsS != null && c.residualRmsS <= TOLERANCES.lapTimeS ? 'matches' : 'check',
      detail:
        `model start/half/end = ${c.deg.start.toFixed(2)}/${c.deg.half.toFixed(2)}/${c.deg.end.toFixed(2)}s over ${c.observedLife} laps; ` +
        `fit RMS ${c.residualRmsS != null ? c.residualRmsS.toFixed(2) : '—'}s` +
        (c.cliff.flagged ? ` — ⚠ ${c.cliff.note}` : ''),
    }));

  if (strategy.ran) {
    const pitDiff = strategy.predictedFirstPit != null && strategy.actualFirstPit != null ? strategy.predictedFirstPit - strategy.actualFirstPit : null;
    const lapDiff = strategy.predictedTotalLaps - strategy.actualTotalLaps;
    v.strategy = {
      pitLap: {
        status: pitDiff == null ? 'no-actual-pit' : verdict(pitDiff, TOLERANCES.pitLapLaps),
        detail: `engine first pit lap ${strategy.predictedFirstPit ?? '—'} vs actual ${strategy.actualFirstPit ?? '—'}${pitDiff != null ? ` (Δ ${pitDiff >= 0 ? '+' : ''}${pitDiff})` : ''}`,
      },
      totalLaps: {
        status: verdict(lapDiff, TOLERANCES.totalLapsLaps),
        detail: `engine predicts ${strategy.predictedTotalLaps} laps vs actual ${strategy.actualTotalLaps} (Δ ${lapDiff >= 0 ? '+' : ''}${lapDiff})`,
      },
    };
  } else {
    v.strategy = { status: 'not-run', detail: strategy.reason };
  }
  return v;
}

// ---------------------------------------------------------------------------
// Plain-language report.
// ---------------------------------------------------------------------------

export function formatReport(report) {
  const L = [];
  const line = (s = '') => L.push(s);
  const m = report.meta;

  line('══════════════════════════════════════════════════════════════════');
  line(' ENGINE VALIDATION REPORT');
  line('══════════════════════════════════════════════════════════════════');
  line(`Session : ${m.team || '—'}   recorded ${m.startedAt || '—'}`);
  line(`Tank    : ${report.meta.tankCapacityL ?? '—'} L`);
  line(`Laps    : ${report.counts.totalLaps} recorded · ${report.counts.cleanDegLaps} clean (degradation) · ${report.counts.fuelLaps} usable (fuel)`);
  line(`Race    : ${report.race.actualTotalLaps} laps, ${formatRaceTime(report.race.drivingSecs + report.race.pitSecs)} elapsed, ${report.race.actualPitLaps.length} pit stop(s)${report.race.actualPitLaps.length ? ` at lap ${report.race.actualPitLaps.join(', ')}` : ''}`);
  line('');

  if (report.warnings.length) {
    line('── ⚠ DATA QUALITY ──');
    for (const w of report.warnings) line(`   [${w.level}] ${w.msg}`);
    line('');
  }

  line('── 1. FUEL CONSUMPTION (tank deltas — traffic-proof) ──');
  line(`   ${report.verdicts.fuel.detail}`);
  line(`   → ${report.verdicts.fuel.status.toUpperCase()}`);
  line('');

  line('── 2. FUEL-WEIGHT EFFECT (does lap time fall as fuel burns?) ──');
  line(`   ${report.verdicts.fuelWeight.detail}`);
  line(`   → ${report.verdicts.fuelWeight.status.toUpperCase()}`);
  line('');

  line('── 3. TYRE DEGRADATION (real curve vs piecewise start/half/end) ──');
  if (!report.verdicts.degradation.length) line('   insufficient clean laps to fit a degradation curve');
  for (const d of report.verdicts.degradation) {
    line(`   [${d.compound}] ${d.detail}`);
    line(`   → ${d.status.toUpperCase()}`);
  }
  line('');

  line('── 4. STRATEGY QUALITY (engine plan vs what the driver did) ──');
  if (!report.strategy.ran) {
    line(`   not run: ${report.strategy.reason}`);
  } else {
    line(`   engine recommends: ${report.strategy.label}`);
    line(`   pit lap   : ${report.verdicts.strategy.pitLap.detail}`);
    line(`   → ${report.verdicts.strategy.pitLap.status.toUpperCase()}`);
    line(`   total laps: ${report.verdicts.strategy.totalLaps.detail}`);
    line(`   → ${report.verdicts.strategy.totalLaps.status.toUpperCase()}`);
  }
  line('');

  line('── VERDICT SUMMARY ──');
  line(`   Fuel/lap        : ${report.verdicts.fuel.status}`);
  line(`   Fuel-weight     : ${report.verdicts.fuelWeight.status}`);
  for (const d of report.verdicts.degradation) line(`   Degradation ${d.compound.padEnd(4)}: ${d.status}`);
  if (report.strategy.ran) {
    line(`   Pit lap         : ${report.verdicts.strategy.pitLap.status}`);
    line(`   Total laps      : ${report.verdicts.strategy.totalLaps.status}`);
  }
  line('══════════════════════════════════════════════════════════════════');
  line('Measurement only — discrepancies are reported, the engine is unchanged.');
  return L.join('\n');
}
