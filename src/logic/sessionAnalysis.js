/**
 * Session analysis (engine-validation / session-import) — PURE JavaScript.
 *
 * The single derivation brain for "turn a recorded session into strategy inputs."
 * Both the validation comparison (scripts/lib/validation.js) and the in-app session
 * import (src/components/SessionImport.jsx) use this — there is no second copy of
 * the measurement maths. It imports `strategy.js` for formatting only and never
 * modifies the engine.
 *
 * From a capture (per-lap ground truth, see scripts/record-session.js) it MEASURES:
 *   - fuel per lap from tank deltas (traffic-proof; no clean laps needed)
 *   - the fuel-weight coefficient + the per-compound 3-point degradation curve,
 *     from CLEAN laps via a joint regression that separates the two
 *   - the observed tyre life
 * and reports data-quality WARNINGS (unlimited fuel, fuel-weight not separable,
 * degradation cliff, too few clean laps). `mergeAnalysisIntoInputs` then folds the
 * measured CAR MODEL onto the user's strategy inputs (race length, drivers, and pit
 * timings are left untouched — the recording is the car, not the race plan).
 */

import { formatLapTime } from './strategy.js';

export const ASSUMED_PENALTY = 0.03; // engine's fuel-weight assumption (s/L)
export const COMPOUND_NAMES = { H: 'Hard', M: 'Medium', S: 'Soft', IM: 'Intermediate', W: 'Wet' };

export const SESSION_CONFIG = {
  refuelThresholdL: 1.0, // fuel rising > this across a lap = a refuel (a real pit)
  pitDebounceLaps: 2, // ignore a 2nd boundary within this many laps (late keypress)
  minCleanLapsForDeg: 6, // trust a degradation curve only after this many clean laps
  cliffResidualS: 0.4, // late-stint rise above the model that flags a cliff (s/lap)
  outlierSlowFactor: 1.03, // drop clean-candidate laps > 3% over the stint median
  outlierFastFactor: 0.97, // ...and any implausibly fast lap
  minFuelLaps: 3, // fuel/lap usable after this many tank-delta laps
};

// ---------------------------------------------------------------------------
// Stats + tiny linear algebra (self-contained, auditable).
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
const round3 = (x) => Math.round(x * 1000) / 1000;

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
// Stint segmentation (data-derived, robust to crashes / standing starts).
// ---------------------------------------------------------------------------

/**
 * Re-derive stint boundaries from the DATA, not the relay's speed-based pit flag.
 * A real pit is the only thing that REFUELS the car or CHANGES the tyres — a crash,
 * spin, off-track stop, or a standing/pit start does neither. A new stint starts
 * only where fuel rose across a lap (refuel) OR the confirmed compound changed.
 * Overrides each lap's stint / tireAge / outLap.
 */
export function resegmentStints(laps) {
  const sorted = [...laps].sort((a, b) => a.lap - b.lap);
  let stint = 1;
  let stintStart = 0;
  let prevCompound = sorted.length ? sorted[0].compound : null;
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    const refuelled = Number.isFinite(Number(l.fuelUsedL)) && Number(l.fuelUsedL) < -SESSION_CONFIG.refuelThresholdL;
    const compoundChanged = !!l.compound && l.compound !== prevCompound;
    const farEnough = i - stintStart >= SESSION_CONFIG.pitDebounceLaps;
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

// ---------------------------------------------------------------------------
// Lap cleaning.
// ---------------------------------------------------------------------------

/**
 * Annotate each lap with why it is / isn't a clean degradation sample, and whether
 * it's usable for the tank-delta fuel measurement. Deg-clean drops out-lap
 * (tireAge 0), first flying lap (tireAge 1), in-lap (a pit during it), paused /
 * off-track, no-time, and laps >3% off the stint clean median.
 */
export function classifyLaps(laps) {
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
    const used = Number(l.fuelUsedL);
    l._fuelUsable = Number.isFinite(used) && used > 0 && !l.sawPaused;
  }
  for (const [, group] of byStint) {
    const base = group.filter((l) => l._reasons.length === 0);
    const med = median(base.map((l) => l.lapTimeSec));
    for (const l of group) {
      l._degClean = false;
      if (l._reasons.length > 0 || med == null) continue;
      if (l.lapTimeSec > med * SESSION_CONFIG.outlierSlowFactor) l._reasons.push('slow-outlier');
      else if (l.lapTimeSec < med * SESSION_CONFIG.outlierFastFactor) l._reasons.push('fast-outlier');
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
    lapsPerFullTank: deltas.length && median(deltas) > 0 && Number.isFinite(tank) ? tank / median(deltas) : null,
  };
}

/** Observed "at full tank" times the engine expects, from a fuel-removed curve. */
export function buildObservedTimes(deg, penalty, fuelPerLap, tank, life) {
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
 * Per-compound model: a joint regression separating the fuel-weight slope from the
 * piecewise degradation curve, plus a model-fidelity / cliff check. Identifiability
 * needs fuel variation at a given tyre age (a second stint / baseline run); a single
 * monotone stint is collinear → reported honestly, falls back to the 0.03 assumption.
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

  const joint = leastSquares(clean.map((_, i) => [1, h1[i], h2[i], fuel[i]]), y);
  let c0, c1, c2, penalty;
  if (joint) {
    [c0, c1, c2, penalty] = joint;
    result.penalty = penalty;
    result.penaltyIdentifiable = true;
  } else {
    penalty = ASSUMED_PENALTY;
    const degOnly = y.map((v, i) => v - penalty * fuel[i]);
    const fit = leastSquares(clean.map((_, i) => [1, h1[i], h2[i]]), degOnly);
    if (!fit) {
      result.note = 'degradation curve not identifiable from this capture';
      return result;
    }
    [c0, c1, c2] = fit;
  }
  result.deg = { start: c0, half: c0 + c1 * bp, end: c0 + c1 * bp + c2 * bp };

  const resid = clean.map((l, i) => {
    const predicted = c0 + c1 * h1[i] + c2 * h2[i];
    return { age: age[i], r: l.lapTimeSec - penalty * fuel[i] - predicted };
  });
  result.residualRmsS = Math.sqrt(mean(resid.map((x) => x.r ** 2)));
  const late = resid.filter((x) => x.age > 0.75 * repLife).map((x) => x.r);
  result.cliff.lateResidualS = late.length ? mean(late) : null;
  if (late.length && result.cliff.lateResidualS > SESSION_CONFIG.cliffResidualS) {
    result.cliff.flagged = true;
    result.cliff.note = `late-stint laps run ~${result.cliff.lateResidualS.toFixed(2)} s/lap ABOVE the piecewise model — real degradation is steeper / a cliff the 3-point model misses`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Race reconstruction (stint boundaries from data, not the speed flag).
// ---------------------------------------------------------------------------

export function reconstructRace(capture, laps) {
  const events = capture.events || [];
  const actualTotalLaps = laps.length ? Math.max(...laps.map((l) => l.lap)) : 0;
  const stintNums = [...new Set(laps.map((l) => l.stint))].sort((a, b) => a - b);
  const actualPitLaps = stintNums
    .slice(0, -1)
    .map((s) => Math.max(...laps.filter((l) => l.stint === s).map((l) => l.lap)));

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
  return {
    actualTotalLaps,
    actualPitLaps,
    pitDurations,
    pitBaseSecs: pitDurations.length ? mean(pitDurations) : null,
    drivingSecs,
    pitSecs,
    durationHours: (drivingSecs + pitSecs) / 3600,
    numStints: stintNums.length,
  };
}

// ---------------------------------------------------------------------------
// The headline: analyse a capture into a structured, data-quality-aware result.
// ---------------------------------------------------------------------------

function buildWarnings({ fuel, fuelWeight, compounds }) {
  const w = [];
  if (!fuel.value || fuel.sampleCount < SESSION_CONFIG.minFuelLaps) {
    w.push({
      level: 'error',
      code: 'no-fuel',
      msg: 'No fuel consumption detected — was fuel consumption OFF (unlimited)? Fuel/lap can’t be measured. Run with fuel consumption ON.',
    });
  }
  if (compounds.every((c) => !c.deg)) {
    w.push({ level: 'error', code: 'no-deg', msg: 'No usable degradation curve — too few clean laps. Run a full stint at race pace.' });
  }
  if (!fuelWeight.identifiable && compounds.some((c) => c.deg)) {
    w.push({
      level: 'warn',
      code: 'fuel-weight-not-separable',
      msg: 'Fuel-weight effect couldn’t be separated from degradation — add a baseline stint at a different fuel load. Using the 0.03 s/L assumption.',
    });
  }
  for (const c of compounds) {
    if (c.deg && c.sampleCount < SESSION_CONFIG.minCleanLapsForDeg) {
      w.push({ level: 'warn', code: 'low-sample', msg: `${c.name}: only ${c.sampleCount} clean laps — degradation estimate is weak.` });
    }
    if (c.cliff && c.cliff.flagged) {
      w.push({ level: 'warn', code: 'cliff', msg: `${c.name}: real degradation steeper than the model near the end (a cliff the 3-point model under-warns).` });
    }
  }
  return w;
}

/**
 * Analyse a recorded session into measured fuel / fuel-weight / per-compound
 * degradation, observed engine-ready lap times, race stats, and data-quality
 * warnings. Pure; safe to run in the browser.
 */
export function analyzeCapture(capture) {
  const laps = classifyLaps(resegmentStints([...(capture?.laps || [])]));
  const tank = Number(capture?.meta?.tankCapacityL) || 0;
  const race = reconstructRace(capture || {}, laps);
  const fuel = measureFuelPerLap(laps, tank || Infinity);

  const compoundIds = [...new Set(laps.map((l) => l.compound).filter(Boolean))];
  const rawCompounds = compoundIds.map((id) => {
    const cl = laps.filter((l) => l.compound === id);
    const stintNums = [...new Set(cl.map((l) => l.stint))];
    const repLife = Math.max(1, ...stintNums.map((s) => cl.filter((l) => l.stint === s).length));
    return { id, name: COMPOUND_NAMES[id] || id, observedLife: repLife, ...fitCompoundModel(cl, repLife) };
  });

  const identified = rawCompounds.find((c) => c.penaltyIdentifiable);
  const penalty = identified ? identified.penalty : ASSUMED_PENALTY;
  const fuelWeight = {
    identifiable: !!identified,
    sPerLiter: identified ? identified.penalty : null,
    assumed: ASSUMED_PENALTY,
    lapTimeFallsWithFuel: identified ? identified.penalty > 0 : null,
  };

  const compounds = rawCompounds.map((c) => ({
    ...c,
    observed: c.deg ? buildObservedTimes(c.deg, penalty, fuel.value, tank, c.observedLife) : null,
    confident: !!c.deg && c.sampleCount >= SESSION_CONFIG.minCleanLapsForDeg,
  }));

  return {
    meta: capture?.meta || {},
    tank,
    counts: { totalLaps: laps.length, cleanDegLaps: laps.filter((l) => l._degClean).length, fuelLaps: fuel.sampleCount },
    fuel,
    fuelWeight,
    penalty,
    compounds,
    race,
    warnings: buildWarnings({ fuel, fuelWeight, compounds }),
    laps,
  };
}

/**
 * Fold the measured CAR MODEL from an analysis onto existing strategy inputs:
 * tank size, laps-per-tank, fuel-weight penalty, and per-compound observed lap
 * times + tyre life. Race length, drivers, pit timings and mandatory stops are
 * intentionally left untouched — the recording measures the car, not the race plan,
 * so the multi-driver / race config the user set still applies on top.
 *
 * Returns a NEW inputs object (never mutates) — this is the only path measured data
 * enters the strategy, and only when the user clicks Apply.
 */
export function mergeAnalysisIntoInputs(analysis, base = {}) {
  const tank = analysis.tank || Number(base.tankSize) || 100;
  const fuelPerLap = analysis.fuel.value;
  const penalty = analysis.fuelWeight.identifiable
    ? round3(analysis.fuelWeight.sPerLiter)
    : Number(base.fuelWeightPenaltyPerLiter) || ASSUMED_PENALTY;

  const measured = {};
  for (const c of analysis.compounds) if (c.deg && c.observed) measured[c.id] = c;

  const compounds = (base.compounds || []).map((bc) => {
    const m = measured[bc.id];
    return m
      ? { ...bc, tireLife: Math.max(1, Math.round(m.observedLife)), startLapTime: m.observed.start, halfLapTime: m.observed.half, endLapTime: m.observed.end }
      : bc;
  });
  for (const id of Object.keys(measured)) {
    if (!compounds.some((c) => c.id === id)) {
      const m = measured[id];
      compounds.push({
        id,
        name: m.name,
        tireLife: Math.max(1, Math.round(m.observedLife)),
        mandatory: false,
        startLapTime: m.observed.start,
        halfLapTime: m.observed.half,
        endLapTime: m.observed.end,
      });
    }
  }

  const out = { ...base, tankSize: tank, fuelWeightPenaltyPerLiter: penalty, compounds };
  if (fuelPerLap > 0) out.lapsPerFullTank = Math.round((tank / fuelPerLap) * 10) / 10;
  return out;
}

/** Convenience: analyse a capture and fold it onto base inputs in one call. */
export function deriveStrategyInputs(capture, base = {}) {
  return mergeAnalysisIntoInputs(analyzeCapture(capture), base);
}
