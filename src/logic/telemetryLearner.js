/**
 * Telemetry learner — Phase 1, Task 1.1 (core).
 *
 * PURE JavaScript. Zero React / DOM imports, runnable under plain `node`, exactly
 * like `strategy.js`. It ingests decoded GT7 telemetry frames (the relay packet
 * shape in CURRENT_STATE §3A) one at a time and maintains running estimates of the
 * three numbers the strategy engine needs but the user currently types by hand:
 *
 *   1. fuel consumption per lap        — measured DIRECTLY from tank deltas
 *                                        (traffic-proof; no clean laps needed)
 *   2. the fuel-weight penalty (s/L)   — second-order refinement; clean laps only
 *   3. a 3-point tyre-degradation curve — second-order refinement; clean laps only
 *
 * It emits these in the SAME shape `findBestStrategies()` consumes (CURRENT_STATE
 * §3B): `lapsPerFullTank`, `fuelWeightPenaltyPerLiter`, and per-compound
 * `startLapTime / halfLapTime / endLapTime` (engine "observed at full tank"
 * convention — see the round-trip note on `buildObservedTimes` below).
 *
 * The learner NEVER mutates strategy inputs. It only reports estimates with a
 * trust payload; the propose-and-accept UI (Task 1.3) decides what to surface
 * (DECISION 7).
 *
 * Scope of THIS task (1.1): single running compound / single stint accumulation,
 * with a stint-age reset on pit-exit so a practice/qualifying stint can SEED the
 * fit (DECISION 5). Per-compound segmentation and multi-compound accumulation are
 * Task 1.2; the propose-and-accept hook/UI is Task 1.3.
 */

import { formatLapTime } from './strategy.js';

// ---------------------------------------------------------------------------
// Tunable constants (gating + cleaning). Kept here, named, so they are easy to
// retune after real stints (open item 1.6). NOTE: the synthetic-test tolerance
// thresholds live in tests/test_telemetry_learner.js, intentionally separate
// from these live-behaviour knobs (DECISION 6).
// ---------------------------------------------------------------------------

export const LEARNER_CONFIG = {
  // Fuel-weight penalty plausibility (DECISION 1). Seed + sanity range.
  fuelWeightPenaltySeed: 0.03,
  fuelWeightPenaltyMin: 0.02,
  fuelWeightPenaltyMax: 0.05,

  // Confidence gating (DECISION 5).
  minLapsForFuel: 3, // tank-delta fuel/lap usable after ~3 laps
  minCleanLapsForDeg: 7, // trust the deg curve only after ~6-8 clean laps
  minDegAgeSpanFraction: 0.3, // ...spanning at least this fraction of tireLife

  // Lap cleaning (DECISION 5). Median filter is the traffic/mistake safety net.
  outlierSlowFactor: 1.03, // drop clean-candidate laps > 3% over the stint median
  outlierFastFactor: 0.97, // ...and any implausibly fast lap

  // "Highly volatile" trust flags — band widens in chaos rather than hiding the
  // number (DECISION 5). These are display thresholds, not test thresholds.
  fuelVolatileStdL: 0.25, // L/lap spread above which fuel/lap is "highly volatile"
  degVolatileResidualSecs: 0.5, // regression RMS residual above which deg is volatile

  // A solve pivot smaller than this means fuel & tyre-age were collinear (a
  // single monotone stint with no fuel-load variation) → not identifiable.
  singularPivot: 1e-9,
};

// ---------------------------------------------------------------------------
// Small linear-algebra helper — solve a square system by Gaussian elimination
// with partial pivoting. No dependencies (keeps src/logic pure). Returns null
// if the matrix is singular within `singularPivot`.
// ---------------------------------------------------------------------------

function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < LEARNER_CONFIG.singularPivot) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Ordinary least squares: solve (XᵀX) c = Xᵀy for c.
 * @param {number[][]} X  design matrix, one row per observation
 * @param {number[]} y    observations
 * @returns {number[]|null} coefficient vector, or null if singular
 */
function leastSquares(X, y) {
  const cols = X[0].length;
  const XtX = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const Xty = new Array(cols).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i];
    for (let a = 0; a < cols; a++) {
      Xty[a] += row[a] * y[i];
      for (let b = 0; b < cols; b++) XtX[a][b] += row[a] * row[b];
    }
  }
  return solveLinear(XtX, Xty);
}

// ---------------------------------------------------------------------------
// Plain stats helpers.
// ---------------------------------------------------------------------------

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

// ---------------------------------------------------------------------------
// The learner.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} LapRecord
 * @property {number} lapNum       game lap number that was just completed
 * @property {number} stintAge     0-based lap index within the current stint
 * @property {number} lapTimeSecs  the just-completed lap time (lastLapMs / 1000)
 * @property {number} fuelStart    fuel on board at the start of this lap (L)
 * @property {number} fuelEnd      fuel on board at the end of this lap (L)
 * @property {number} fuelUsed     fuelStart - fuelEnd (L)
 * @property {string[]} dirtyReasons  why the lap is excluded from clean fits ([] = clean)
 */

/**
 * Create a stateful learner for one running car / compound.
 *
 * @param {object} cfg
 * @param {number} cfg.tankSize        litres (user-declared)
 * @param {number} cfg.tireLife        laps before "worn" for the running compound (user input — DECISION 3)
 * @param {string} [cfg.compoundId]    current compound id (set by the one-tap confirm flow — never guessed)
 * @param {number} [cfg.seedPenalty]   starting fuel-weight penalty (defaults to LEARNER_CONFIG.fuelWeightPenaltySeed)
 */
export function createLearner(cfg = {}) {
  const tankSize = Number(cfg.tankSize) || 0;
  const tireLife = Number(cfg.tireLife) || 0;
  const compoundId = cfg.compoundId || 'unknown';
  const seedPenalty = cfg.seedPenalty != null ? Number(cfg.seedPenalty) : LEARNER_CONFIG.fuelWeightPenaltySeed;

  /** @type {LapRecord[]} */
  const laps = [];

  // Per-frame bookkeeping for lap-boundary detection.
  let lastLapSeen = null; // previous frame's currentLap
  let lapStartFuel = null; // fuel captured at the start of the in-progress lap
  let stintStartLap = null; // game lap number at which the current stint began
  let outLapCountdown = 0; // completed laps still to exclude (out-lap + first flying lap)
  // Flags accumulated across the frames of the in-progress lap.
  let sawPaused = false;
  let sawOffTrack = false;
  let sawPitDetected = false;

  function resetInProgressFlags() {
    sawPaused = false;
    sawOffTrack = false;
    sawPitDetected = false;
  }

  /** Begin a fresh stint at `lap`: age resets to 0, out-lap + first flying lap excluded. */
  function startStint(lap) {
    stintStartLap = lap;
    outLapCountdown = 2; // the out-lap and the first flying lap after it
  }

  /**
   * Ingest one decoded telemetry frame (relay packet, CURRENT_STATE §3A).
   * @param {object} f
   */
  function ingest(f) {
    if (!f) return;
    const curLap = Number(f.currentLap);
    if (!Number.isFinite(curLap)) return;
    const fuel = Number(f.fuelLiters);

    // First frame ever — initialise, don't record. We may have joined mid-lap,
    // so the very first completed lap is treated as an out-lap.
    if (lastLapSeen === null) {
      lastLapSeen = curLap;
      lapStartFuel = Number.isFinite(fuel) ? fuel : null;
      stintStartLap = curLap;
      outLapCountdown = 1;
      resetInProgressFlags();
      return;
    }

    // Accumulate dirty-lap flags seen anywhere within the in-progress lap.
    if (f.paused) sawPaused = true;
    if (f.onTrack === false) sawOffTrack = true;
    if (f.pitDetected) sawPitDetected = true;

    // Pit-exit begins a new stint (tyre age → 0). The compound for the new stint
    // comes from the user's one-tap confirm flow; the learner never guesses it
    // (Task 1.2 routes per-compound — here it just resets age so a seed/practice
    // stint and the race stint don't share a tyre-age axis).
    if (f.pitExit) {
      startStint(curLap);
    }

    // No lap boundary yet — just keep the latest in-progress state.
    if (curLap === lastLapSeen) return;

    // A lap (or more) just completed. The completed lap is `lastLapSeen`.
    const delta = curLap - lastLapSeen;
    const completedLap = lastLapSeen;
    const lapTimeMs = Number(f.lastLapMs);
    const lapTimeSecs = Number.isFinite(lapTimeMs) && lapTimeMs > 0 ? lapTimeMs / 1000 : null;
    const fuelStart = lapStartFuel;
    const fuelEnd = Number.isFinite(fuel) ? fuel : null;
    const fuelUsed = fuelStart != null && fuelEnd != null ? fuelStart - fuelEnd : null;

    const dirtyReasons = [];
    if (delta !== 1) dirtyReasons.push('lapjump');
    if (lapTimeSecs === null) dirtyReasons.push('nolaptime');
    if (sawPaused) dirtyReasons.push('paused');
    if (sawOffTrack) dirtyReasons.push('offtrack');
    if (sawPitDetected) dirtyReasons.push('pitlap');
    if (outLapCountdown > 0) {
      dirtyReasons.push('outlap');
      outLapCountdown--;
    }

    laps.push({
      lapNum: completedLap,
      stintAge: completedLap - stintStartLap,
      lapTimeSecs,
      fuelStart,
      fuelEnd,
      fuelUsed,
      dirtyReasons,
    });

    // Roll forward to the new in-progress lap.
    lastLapSeen = curLap;
    lapStartFuel = fuelEnd;
    resetInProgressFlags();
  }

  function ingestAll(frames) {
    for (const f of frames) ingest(f);
  }

  // -------------------------------------------------------------------------
  // Estimation (computed on demand from the accumulated laps).
  // -------------------------------------------------------------------------

  /** Fuel/lap from tank deltas — traffic-proof, no clean-lap requirement. */
  function estimateFuel() {
    // A lap is usable for fuel if the tank actually went DOWN by a sane amount and
    // it wasn't a multi-lap jump or a pit (refuel) lap. We do NOT require it to be
    // "clean" — that's the whole traffic-proof point.
    const deltas = laps
      .filter(
        (l) =>
          l.fuelUsed != null &&
          l.fuelUsed > 0 &&
          l.fuelUsed < tankSize &&
          !l.dirtyReasons.includes('lapjump') &&
          !l.dirtyReasons.includes('pitlap') &&
          !l.dirtyReasons.includes('paused')
      )
      .map((l) => l.fuelUsed);

    const sampleCount = deltas.length;
    const litersPerLap = sampleCount > 0 ? median(deltas) : null;
    const volatility = stddev(deltas);
    const confident = sampleCount >= LEARNER_CONFIG.minLapsForFuel && litersPerLap != null;
    const lapsPerFullTank = litersPerLap && litersPerLap > 0 ? tankSize / litersPerLap : null;

    return {
      litersPerLap,
      lapsPerFullTank,
      sampleCount,
      volatility,
      confident,
      highlyVolatile: volatility > LEARNER_CONFIG.fuelVolatileStdL,
    };
  }

  /**
   * Joint least-squares for the fuel-weight penalty AND the 3-point degradation
   * curve, on clean laps only (DECISION 1, 2). Within a single monotone stint
   * fuel and tyre-age are collinear, so we solve them TOGETHER rather than
   * sequentially (the risks-section "joint multiple regression" route). A seed
   * practice stint at a different fuel load supplies the fuel-load variation that
   * makes the system identifiable (DECISION 5).
   *
   * Model:  lapTime = c0·1 + c1·h1(age) + c2·h2(age) + c3·fuel
   *   h1(age) = min(age, tireLife/2)        slope of segment 1 (ratio 0 → 0.5)
   *   h2(age) = max(0, age - tireLife/2)    slope of segment 2 (ratio 0.5 → 1.0)
   * so the pure (fuel-removed) degradation curve is
   *   D(0)        = c0
   *   D(life/2)   = c0 + c1·(life/2)
   *   D(life)     = c0 + c1·(life/2) + c2·(life/2)
   * and the fuel-weight penalty is c3. This is the engine's exact piecewise
   * 3-point form (strategy.js simulateStrategy), so the fit can't drift away from
   * what the engine can consume.
   */
  function estimateDegAndPenalty(litersPerLap) {
    const half = tireLife / 2;

    // Clean-lap selection: drop dirty laps, then median-filter the survivors
    // (traffic / mistakes). Non-consecutive clean laps are fine (DECISION 5).
    const candidates = laps.filter((l) => l.dirtyReasons.length === 0 && l.lapTimeSecs != null && l.fuelStart != null);
    const med = median(candidates.map((l) => l.lapTimeSecs));
    const clean =
      med == null
        ? []
        : candidates.filter(
            (l) =>
              l.lapTimeSecs <= med * LEARNER_CONFIG.outlierSlowFactor &&
              l.lapTimeSecs >= med * LEARNER_CONFIG.outlierFastFactor
          );

    const sampleCount = clean.length;
    const ageSpan = sampleCount > 0 ? Math.max(...clean.map((l) => l.stintAge)) - Math.min(...clean.map((l) => l.stintAge)) : 0;

    // Default / fallback estimate: seed penalty + a flat curve from the clean
    // median (graceful degradation when we can't yet identify the model).
    let penalty = seedPenalty;
    let deg = { start: med, half: med, end: med };
    let residual = 0;
    let identifiable = false;

    if (sampleCount >= 4 && tireLife > 0) {
      const X = clean.map((l) => [1, Math.min(l.stintAge, half), Math.max(0, l.stintAge - half), l.fuelStart]);
      const y = clean.map((l) => l.lapTimeSecs);
      const c = leastSquares(X, y);
      if (c) {
        const [c0, c1, c2, c3] = c;
        penalty = c3;
        deg = { start: c0, half: c0 + c1 * half, end: c0 + c1 * half + c2 * half };
        // RMS residual = volatility band for the curve.
        const sq = clean.map((l, i) => {
          const pred = X[i][0] * c0 + X[i][1] * c1 + X[i][2] * c2 + X[i][3] * c3;
          return (y[i] - pred) ** 2;
        });
        residual = Math.sqrt(mean(sq));
        identifiable = true;
      }
    }

    const penaltyInRange = penalty >= LEARNER_CONFIG.fuelWeightPenaltyMin && penalty <= LEARNER_CONFIG.fuelWeightPenaltyMax;
    const enoughSpan = ageSpan >= LEARNER_CONFIG.minDegAgeSpanFraction * tireLife;
    const confident =
      identifiable && sampleCount >= LEARNER_CONFIG.minCleanLapsForDeg && enoughSpan && penaltyInRange;

    return {
      penalty,
      penaltyInRange,
      deg,
      observed: buildObservedTimes(deg, penalty, litersPerLap),
      sampleCount,
      ageSpan,
      volatility: residual,
      confident,
      identifiable,
      highlyVolatile: residual > LEARNER_CONFIG.degVolatileResidualSecs,
    };
  }

  /**
   * Convert the pure (fuel-removed) degradation curve D + penalty into the
   * "observed at full tank" lap-time triple the engine expects as manual input.
   *
   * The engine (strategy.js:459-485) treats `startLapTime` as a full-tank
   * reference (no correction) and adds the already-burned fuel weight back onto
   * `halfLapTime` / `endLapTime` using its OWN burn schedule
   * (lapsToMid / lapsToEnd). We therefore emit exactly what that schedule implies,
   * so the engine's correction round-trips our curve back to D(age) + penalty·fuel
   * — i.e. feeding the learner's output into findBestStrategies reproduces the
   * physics we measured. Verified against strategy.js:467-474.
   */
  function buildObservedTimes(deg, penalty, litersPerLap) {
    if (deg == null || deg.start == null) return null;
    const lpl = litersPerLap && litersPerLap > 0 ? litersPerLap : null;
    // Engine's burn schedule. If we don't yet know litersPerLap, fall back to the
    // full-tank reference (no burn-off) so the strings are still well-formed.
    const lapsToMid = lpl ? Math.min(tireLife / 2, tankSize / lpl) : 0;
    const lapsToEnd = lpl ? Math.min(tireLife, tankSize / lpl) : 0;
    const fuelAtMid = lpl ? Math.max(0, tankSize - lapsToMid * lpl) : tankSize;
    const fuelAtEnd = lpl ? Math.max(0, tankSize - lapsToEnd * lpl) : tankSize;

    const startObs = deg.start + penalty * tankSize;
    const halfObs = deg.half + penalty * fuelAtMid;
    const endObs = deg.end + penalty * fuelAtEnd;

    return {
      startSecs: startObs,
      halfSecs: halfObs,
      endSecs: endObs,
      startLapTime: formatLapTime(startObs),
      halfLapTime: formatLapTime(halfObs),
      endLapTime: formatLapTime(endObs),
    };
  }

  /**
   * Current best estimates with trust payloads. Shaped to drop into
   * findBestStrategies input (CURRENT_STATE §3B). The `compounds` map is keyed by
   * compound id now so Task 1.2's per-compound segmentation slots in without
   * reshaping the output.
   */
  function getEstimates() {
    const fuel = estimateFuel();
    const dp = estimateDegAndPenalty(fuel.litersPerLap);

    const cleanLapCount = laps.filter((l) => l.dirtyReasons.length === 0).length;

    return {
      // --- engine-ready scalars ---
      litersPerLap: fuel.litersPerLap,
      lapsPerFullTank: fuel.lapsPerFullTank,
      fuelWeightPenaltyPerLiter: dp.penalty,

      // --- per-compound degradation (keyed; one entry in Task 1.1) ---
      compounds: {
        [compoundId]: {
          tireLife,
          startLapTime: dp.observed ? dp.observed.startLapTime : null,
          halfLapTime: dp.observed ? dp.observed.halfLapTime : null,
          endLapTime: dp.observed ? dp.observed.endLapTime : null,
          // Pure (fuel-removed) degradation points, in seconds — exposed for
          // tests and trust UI; the strings above are what the engine consumes.
          deg: dp.deg,
          sampleCount: dp.sampleCount,
          ageSpan: dp.ageSpan,
          volatility: dp.volatility,
          confident: dp.confident,
          highlyVolatile: dp.highlyVolatile,
        },
      },

      // --- trust payloads, per estimate (Task 1.3 propose-and-accept UI) ---
      trust: {
        fuel: {
          sampleCount: fuel.sampleCount,
          volatility: fuel.volatility,
          confident: fuel.confident,
          highlyVolatile: fuel.highlyVolatile,
        },
        fuelWeightPenalty: {
          value: dp.penalty,
          inRange: dp.penaltyInRange,
          identifiable: dp.identifiable,
          sampleCount: dp.sampleCount,
          volatility: dp.volatility,
          confident: dp.confident,
          highlyVolatile: dp.highlyVolatile,
        },
        degradation: {
          sampleCount: dp.sampleCount,
          ageSpan: dp.ageSpan,
          volatility: dp.volatility,
          confident: dp.confident,
          highlyVolatile: dp.highlyVolatile,
        },
      },

      // --- current stint snapshot ---
      currentStint: {
        compoundId,
        stintStartLap,
        lapsCompleted: laps.length,
        cleanLapCount,
        tireAge: laps.length > 0 ? laps[laps.length - 1].stintAge : 0,
      },
    };
  }

  return {
    ingest,
    ingestAll,
    getEstimates,
    // Exposed for tests / inspection.
    _laps: laps,
  };
}
