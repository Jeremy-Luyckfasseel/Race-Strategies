/**
 * Engine-validation measurement library (engine-validation branch).
 *
 * PURE Node, no React. Takes a recorded session (see scripts/record-session.js)
 * and MEASURES how well the strategy engine's predictions match what actually
 * happened — it does NOT tune the engine. Every number in the report is computed
 * here transparently so it can be audited; `strategy.js` is imported, never
 * modified.
 *
 * What it derives from the capture (real-world ground truth):
 *   - fuel per lap, straight from tank deltas (traffic-proof — no clean laps needed)
 *   - the fuel-weight coefficient (s/L) and the per-compound 3-point degradation
 *     curve, from CLEAN laps only, via a joint regression that separates the two
 *   - the observed tyre life (how far the set was actually run)
 * Then it feeds those into findBestStrategies() and reports, per metric, whether
 * the engine matches reality "within tolerance" or "diverges — by how much / why".
 */

import { findBestStrategies, formatLapTime, formatRaceTime } from '../../src/logic/strategy.js';

// ---------------------------------------------------------------------------
// Tolerances — what counts as "matches" vs "diverges". Starting values; they
// mirror the Phase-1 live-trust bands and the Phase-4 mock-race pass bar. Tune
// after seeing real residuals (this is measurement config, not engine config).
// ---------------------------------------------------------------------------

export const TOLERANCES = {
  fuelPerLapL: 0.1, // L/lap — measured tank-delta is trusted within this
  fuelWeightSPerL: 0.005, // s/L — measured vs the 0.03 assumption
  lapTimeS: 0.3, // s/lap — degradation curve points
  pitLapLaps: 1, // laps — predicted vs actual pit lap (Phase-4 bar)
  totalLapsLaps: 1, // laps — predicted vs actual total laps
  cliffResidualS: 0.4, // s/lap — late-stint rise above the model that flags a cliff
};

const ASSUMED_PENALTY = 0.03; // the engine's fuel-weight assumption (s/L)

export const COMPOUND_NAMES = { H: 'Hard', M: 'Medium', S: 'Soft', IM: 'Intermediate', W: 'Wet' };

// ---------------------------------------------------------------------------
// Stats + tiny linear algebra (self-contained so the measurement is auditable).
// ---------------------------------------------------------------------------

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

/** Gaussian elimination with partial pivoting; null if singular. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Ordinary least squares: solve (XᵀX)c = Xᵀy. Null if singular. */
function leastSquares(X, y) {
  const cols = X[0].length;
  const XtX = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Xty = new Array(cols).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < cols; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < cols; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  return solveLinear(XtX, Xty);
}

// ---------------------------------------------------------------------------
// Lap cleaning (DECISION 5 rules, applied to the recorded per-lap records).
// ---------------------------------------------------------------------------

export const REFUEL_THRESHOLD_L = 1.0; // fuel rising > this across a lap = a refuel (a real pit)
const PIT_DEBOUNCE_LAPS = 2; // ignore a second boundary within this many laps (late keypress)

/**
 * Re-derive stint boundaries from the DATA, not the relay's speed-based pit flag.
 * A real pit is the only thing that REFUELS the car or CHANGES the tyres — a crash,
 * spin, off-track stop, or a standing/pit start does neither. So a new stint starts
 * only where fuel rose across a lap (refuel) OR the confirmed compound changed.
 * This makes the analysis robust to false "pits"; it overrides each lap's
 * stint / tireAge / outLap (the recorder's values, derived from the flaky flag).
 */
export function resegmentStints(laps) {
  const sorted = [...laps].sort((a, b) => a.lap - b.lap);
  let stint = 1;
  let stintStart = 0;
  let prevCompound = sorted.length ? sorted[0].compound : null;
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    const refuelled = Number.isFinite(Number(l.fuelUsedL)) && Number(l.fuelUsedL) < -REFUEL_THRESHOLD_L;
    const compoundChanged = !!l.compound && l.compound !== prevCompound;
    const farEnough = i - stintStart >= PIT_DEBOUNCE_LAPS;
    if (i > 0 && farEnough && (refuelled || compoundChanged)) {
      stint += 1;
      stintStart = i;
    }
    l.stint = stint;
    l.tireAge = i - stintStart;
    l.outLap = i === stintStart;
    prevCompound = l.compound || prevCompound;
  }
  return sorted;
}

/**
 * Annotate each lap with why it is / isn't a clean degradation sample, and
 * whether it's usable for the tank-delta fuel measurement.
 *   deg-clean: drop out-lap (tireAge 0), first flying lap (tireAge 1), in-lap
 *   (a pit happened during it), paused / off-track, no lap time, and laps >3%
 *   off the stint's clean median (traffic / mistakes).
 *   fuel-usable: any lap that burned a sane positive amount (not a refuel/out-lap).
 */
export function classifyLaps(laps) {
  // Group by stint for the per-stint median outlier filter.
  const byStint = new Map();
  for (const l of laps) {
    if (!byStint.has(l.stint)) byStint.set(l.stint, []);
    byStint.get(l.stint).push(l);
  }

  for (const l of laps) {
    const reasons = [];
    const t = Number(l.lapTimeSec);
    if (!Number.isFinite(t) || t <= 0) reasons.push('no-time');
    if (l.tireAge === 0 || l.outLap) reasons.push('out-lap');
    else if (l.tireAge === 1) reasons.push('first-flying');
    if (l.sawPit) reasons.push('in-lap');
    if (l.sawPaused) reasons.push('paused');
    if (l.sawOffTrack) reasons.push('off-track');
    l._reasons = reasons;

    // Fuel-usable: positive burn, not a refuel lap, not paused/jumped.
    const used = Number(l.fuelUsedL);
    l._fuelUsable = Number.isFinite(used) && used > 0 && !l.sawPaused;
  }

  // Per-stint clean median → outlier rule on the survivors.
  for (const [, group] of byStint) {
    const base = group.filter((l) => l._reasons.length === 0);
    const med = median(base.map((l) => l.lapTimeSec));
    for (const l of group) {
      l._degClean = false;
      if (l._reasons.length > 0 || med == null) continue;
      if (l.lapTimeSec > med * 1.03) l._reasons.push('slow-outlier');
      else if (l.lapTimeSec < med * 0.97) l._reasons.push('fast-outlier');
      else l._degClean = true;
    }
  }
  return laps;
}

// ---------------------------------------------------------------------------
// Measurements.
// ---------------------------------------------------------------------------

/** Fuel per lap from tank deltas — robust median, traffic-proof. */
export function measureFuelPerLap(laps, tank) {
  const deltas = laps.filter((l) => l._fuelUsable && l.fuelUsedL < tank).map((l) => l.fuelUsedL);
  return {
    value: median(deltas),
    spread: stddev(deltas),
    sampleCount: deltas.length,
    min: deltas.length ? Math.min(...deltas) : null,
    max: deltas.length ? Math.max(...deltas) : null,
  };
}

/** Observed "at full tank" times the engine expects, from a fuel-removed curve. */
function buildObservedTimes(deg, penalty, fuelPerLap, tank, life) {
  const lapsToMid = fuelPerLap > 0 ? Math.min(life / 2, tank / fuelPerLap) : 0;
  const lapsToEnd = fuelPerLap > 0 ? Math.min(life, tank / fuelPerLap) : 0;
  const fuelAtMid = Math.max(0, tank - lapsToMid * fuelPerLap);
  const fuelAtEnd = Math.max(0, tank - lapsToEnd * fuelPerLap);
  return {
    start: formatLapTime(deg.start + penalty * tank),
    half: formatLapTime(deg.half + penalty * fuelAtMid),
    end: formatLapTime(deg.end + penalty * fuelAtEnd),
  };
}

/**
 * Per-compound model: joint regression separating the fuel-weight slope from the
 * piecewise degradation curve, plus a model-fidelity / cliff check.
 *
 * Model:  lapTime = c0 + c1·min(age,bp) + c2·max(0,age-bp) + c3·fuel
 *   bp = repLife/2 ; penalty = c3 ; deg(age) at fuel 0 = c0..c2 terms.
 * Identifiability needs fuel variation at a given tyre age (a second stint or a
 * baseline run). A single monotone stint is collinear → we report that honestly,
 * fall back to the engine's 0.03 assumption, and still fit the degradation shape.
 */
export function fitCompoundModel(compoundLaps, repLife) {
  const clean = compoundLaps.filter((l) => l._degClean);
  const bp = repLife / 2;
  const result = {
    sampleCount: clean.length,
    repLife,
    penalty: ASSUMED_PENALTY,
    penaltyIdentifiable: false,
    deg: null,
    residualRmsS: null,
    cliff: { flagged: false, lateResidualS: null, note: '' },
  };
  if (clean.length < 4) {
    result.note = 'insufficient clean laps (<4) to fit a degradation curve';
    return result;
  }

  const age = clean.map((l) => l.tireAge);
  const fuel = clean.map((l) => l.fuelStartL);
  const y = clean.map((l) => l.lapTimeSec);
  const h1 = age.map((a) => Math.min(a, bp));
  const h2 = age.map((a) => Math.max(0, a - bp));

  // Try the joint fit (separates fuel-weight from degradation).
  const joint = leastSquares(
    clean.map((_, i) => [1, h1[i], h2[i], fuel[i]]),
    y
  );
  let c0, c1, c2, penalty;
  if (joint) {
    [c0, c1, c2, penalty] = joint;
    result.penalty = penalty;
    result.penaltyIdentifiable = true;
  } else {
    // Collinear (single fuel range): can't separate. Assume 0.03, fit the shape.
    penalty = ASSUMED_PENALTY;
    const degOnly = y.map((v, i) => v - penalty * fuel[i]);
    const fit = leastSquares(
      clean.map((_, i) => [1, h1[i], h2[i]]),
      degOnly
    );
    if (!fit) {
      result.note = 'degradation curve not identifiable from this capture';
      return result;
    }
    [c0, c1, c2] = fit;
  }

  result.deg = { start: c0, half: c0 + c1 * bp, end: c0 + c1 * bp + c2 * bp };

  // Residuals of the fuel-removed actual vs the piecewise model.
  const resid = clean.map((l, i) => {
    const predicted = c0 + c1 * h1[i] + c2 * h2[i];
    const actualDegOnly = l.lapTimeSec - penalty * fuel[i];
    return { age: age[i], r: actualDegOnly - predicted };
  });
  result.residualRmsS = Math.sqrt(mean(resid.map((x) => x.r ** 2)));

  // Cliff: does the last quarter of the run rise above the piecewise model?
  const late = resid.filter((x) => x.age > 0.75 * repLife).map((x) => x.r);
  result.cliff.lateResidualS = late.length ? mean(late) : null;
  if (late.length && result.cliff.lateResidualS > TOLERANCES.cliffResidualS) {
    result.cliff.flagged = true;
    result.cliff.note = `late-stint laps run ~${result.cliff.lateResidualS.toFixed(2)} s/lap ABOVE the piecewise model — real degradation is steeper / a cliff the 3-point model misses`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Stint / race reconstruction from the capture.
// ---------------------------------------------------------------------------

function reconstructRace(capture, laps) {
  const events = capture.events || [];
  const actualTotalLaps = laps.length ? Math.max(...laps.map((l) => l.lap)) : 0;

  // Real pit laps = the last lap of each data-derived stint except the last (the
  // in-lap), from the refuel/compound segmentation — NOT the speed-based flag, so
  // a crash/standing start is never counted as a pit.
  const stintNums = [...new Set(laps.map((l) => l.stint))].sort((a, b) => a - b);
  const actualPitLaps = stintNums
    .slice(0, -1)
    .map((s) => Math.max(...laps.filter((l) => l.stint === s).map((l) => l.lap)));

  // Pit durations from paired detect→exit event timestamps, if present.
  const pitDurations = [];
  let pendingDetect = null;
  for (const e of events) {
    if (e.type === 'pitDetected') pendingDetect = e;
    else if (e.type === 'pitExit' && pendingDetect && e.ts && pendingDetect.ts) {
      pitDurations.push((new Date(e.ts) - new Date(pendingDetect.ts)) / 1000);
      pendingDetect = null;
    }
  }
  const drivingSecs = laps.reduce((s, l) => s + (Number(l.lapTimeSec) || 0), 0);
  const pitSecs = pitDurations.reduce((s, d) => s + d, 0);
  const durationHours = (drivingSecs + pitSecs) / 3600;

  return {
    actualTotalLaps,
    actualPitLaps,
    pitDurations,
    pitBaseSecs: pitDurations.length ? mean(pitDurations) : null,
    drivingSecs,
    pitSecs,
    durationHours,
  };
}

// ---------------------------------------------------------------------------
// Main: compare a capture against the engine.
// ---------------------------------------------------------------------------

export function compareSession(capture) {
  // Re-derive stint boundaries from the data (refuel / compound change) so a crash
  // or a standing start can't be mistaken for a pit, THEN classify clean laps.
  const laps = classifyLaps(resegmentStints([...(capture.laps || [])]));
  const tank = Number(capture.meta?.tankCapacityL) || 0;
  const race = reconstructRace(capture, laps);

  const cleanCount = laps.filter((l) => l._degClean).length;
  const fuel = measureFuelPerLap(laps, tank || Infinity);

  // Per-compound models.
  const compoundIds = [...new Set(laps.map((l) => l.compound).filter(Boolean))];
  const compounds = compoundIds.map((id) => {
    const cl = laps.filter((l) => l.compound === id);
    // Representative tyre life = the longest run actually completed on this set.
    const stints = [...new Set(cl.map((l) => l.stint))];
    const repLife = Math.max(...stints.map((s) => cl.filter((l) => l.stint === s).length));
    const model = fitCompoundModel(cl, repLife);
    return { id, name: COMPOUND_NAMES[id] || id, observedLife: repLife, ...model };
  });

  // Fuel-weight verdict (use the first compound that could identify it).
  const identified = compounds.find((c) => c.penaltyIdentifiable);
  const fuelWeight = {
    identifiable: !!identified,
    sPerLiter: identified ? identified.penalty : null,
    assumed: ASSUMED_PENALTY,
    lapTimeFallsWithFuel: identified ? identified.penalty > 0 : null,
  };

  // Strategy quality — feed measured inputs into the engine.
  const measured = {
    fuelPerLap: fuel,
    fuelWeight,
    compounds: compounds.filter((c) => c.deg),
    race,
  };
  let strategy = { ran: false, reason: 'no usable compound model' };
  if (measured.compounds.length && fuel.value && tank > 0 && race.durationHours > 0) {
    const inputs = buildEngineInputs(capture, measured);
    const ranked = findBestStrategies(inputs);
    if (ranked && ranked.length) {
      const best = ranked[0];
      const predictedPitLaps = best.strategy.stints.filter((s) => s.pitLap != null).map((s) => s.pitLap);
      strategy = {
        ran: true,
        inputs,
        label: best.label,
        predictedTotalLaps: best.strategy.totalLaps,
        predictedPitLaps,
        predictedFirstPit: predictedPitLaps[0] ?? null,
        actualTotalLaps: race.actualTotalLaps,
        actualPitLaps: race.actualPitLaps,
        actualFirstPit: race.actualPitLaps[0] ?? null,
      };
    } else {
      strategy = { ran: false, reason: 'engine returned no valid strategy for the measured inputs' };
    }
  }

  return {
    meta: capture.meta || {},
    counts: { totalLaps: laps.length, cleanDegLaps: cleanCount, fuelLaps: fuel.sampleCount },
    laps,
    fuel,
    fuelWeight,
    compounds,
    race,
    strategy,
    verdicts: buildVerdicts({ fuel, fuelWeight, compounds, strategy }),
  };
}

function buildEngineInputs(capture, measured) {
  const tank = Number(capture.meta.tankCapacityL);
  const fuelPerLap = measured.fuelPerLap.value;
  const penalty = measured.fuelWeight.identifiable ? measured.fuelWeight.sPerLiter : ASSUMED_PENALTY;
  const compounds = measured.compounds.map((c) => {
    const obs = buildObservedTimes(c.deg, penalty, fuelPerLap, tank, c.observedLife);
    return {
      id: c.id,
      name: c.name,
      tireLife: Math.max(1, Math.round(c.observedLife)),
      mandatory: false,
      startLapTime: obs.start,
      halfLapTime: obs.half,
      endLapTime: obs.end,
    };
  });
  return {
    raceDurationHours: measured.race.durationHours,
    tankSize: tank,
    lapsPerFullTank: fuelPerLap > 0 ? tank / fuelPerLap : 1,
    fuelMap: 1.0,
    compounds,
    pitBaseSecs: measured.race.pitBaseSecs != null ? measured.race.pitBaseSecs : 25,
    tireChangeSecs: 0, // pit time is lumped into pitBaseSecs from the measured stop
    fuelRateLitersPerSec: 4.0,
    fuelWeightPenaltyPerLiter: penalty,
    mandatoryStops: 0,
    drivers: [{ id: 'd1', name: 'Driver', compounds: {} }],
    minDriverTimeSecs: 0,
    midRaceMode: false,
  };
}

function verdict(diff, tol) {
  return Math.abs(diff) <= tol ? 'matches' : 'diverges';
}

function buildVerdicts({ fuel, fuelWeight, compounds, strategy }) {
  const v = {};

  v.fuel = {
    status: fuel.sampleCount >= 3 ? 'measured' : 'insufficient-data',
    detail: fuel.value != null ? `${fuel.value.toFixed(2)} L/lap (±${fuel.spread.toFixed(2)}, n=${fuel.sampleCount})` : 'no data',
  };

  if (!fuelWeight.identifiable) {
    v.fuelWeight = {
      status: 'not-separable',
      detail: 'fuel-weight could not be separated from degradation in this capture — run a second stint / a baseline at a different fuel load',
    };
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
  line(`Tank    : ${m.tankCapacityL ?? '—'} L`);
  line(`Laps    : ${report.counts.totalLaps} recorded · ${report.counts.cleanDegLaps} clean (degradation) · ${report.counts.fuelLaps} usable (fuel)`);
  line(`Race    : ${report.race.actualTotalLaps} laps, ${formatRaceTime(report.race.drivingSecs + report.race.pitSecs)} elapsed, ${report.race.actualPitLaps.length} pit stop(s)${report.race.actualPitLaps.length ? ` at lap ${report.race.actualPitLaps.join(', ')}` : ''}`);
  line('');

  line('── 1. FUEL CONSUMPTION (tank deltas — traffic-proof) ──');
  line(`   ${report.verdicts.fuel.detail}`);
  line(`   → ${report.verdicts.fuel.status.toUpperCase()}`);
  line('');

  line('── 2. FUEL-WEIGHT EFFECT (does lap time fall as fuel burns?) ──');
  line(`   ${report.verdicts.fuelWeight.detail}`);
  line(`   → ${report.verdicts.fuelWeight.status.toUpperCase()}`);
  line('');

  line('── 3. TYRE DEGRADATION (real curve vs piecewise start/half/end) ──');
  if (!report.verdicts.degradation.length) {
    line('   insufficient clean laps to fit a degradation curve');
  }
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
