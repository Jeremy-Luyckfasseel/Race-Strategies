/**
 * GT7 Endurance Race Strategy Calculator
 * All pure functions — no React dependencies.
 */

// ---------------------------------------------------------------------------
// Tire compounds
// ---------------------------------------------------------------------------

/** @type {Array<{id: string, name: string}>} */
export const TIRE_COMPOUNDS = [
  { id: 'H', name: 'Hard' },
  { id: 'M', name: 'Medium' },
  { id: 'S', name: 'Soft' },
  { id: 'IM', name: 'Intermediate' },
  { id: 'W', name: 'Wet' },
];

// ---------------------------------------------------------------------------
// Car presets
// ---------------------------------------------------------------------------

/**
 * Built-in car presets with realistic GT7 values.
 * @type {Array<{id: string, name: string, tankSize: number, lapsPerFullTank: number, tireWearLaps: number, raceDurationHours: number}>}
 */
export const CAR_PRESETS = [
  {
    id: 'gr010',
    name: 'GR010 Hybrid',
    tankSize: 75,
    lapsPerFullTank: 22,
    tireWearLaps: 35,
    raceDurationHours: 8,
  },
  {
    id: 'p4',
    name: 'Ferrari 330 P4',
    tankSize: 120,
    lapsPerFullTank: 35,
    tireWearLaps: 45,
    raceDurationHours: 8,
  },
  {
    id: 'rx500',
    name: 'Mazda RX-500',
    tankSize: 60,
    lapsPerFullTank: 18,
    tireWearLaps: 30,
    raceDurationHours: 8,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a string is a well-formed lap time ("M:SS", "M:SS.mmm", or plain
 * seconds). Validate user-typed input with this BEFORE calling parseLapTime —
 * parseLapTime itself makes no such guarantee on malformed input (empty →
 * 120s, but e.g. "abc:def" → 0 and "1:xx" → 60, never a clean rejection),
 * which is fine for internal machine-formatted strings (e.g. values
 * round-tripped through formatLapTime, which can't produce those shapes) but
 * would hide a typo's effect on the computed strategy if used to gate user
 * input instead of this function.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidLapTimeStr(str) {
  if (!str) return false;
  const s = String(str).trim();
  return /^\d+:\d{1,2}(\.\d{1,3})?$/.test(s) || /^\d+(\.\d+)?$/.test(s);
}

/**
 * Parse a "MM:SS.mmm" or "MM:SS" string into total seconds.
 * Returns 120 (2 min) if the string is empty or unparseable.
 * @param {string} str
 * @returns {number}
 */
export function parseLapTime(str) {
  if (!str) return 120;
  const parts = str.split(':');
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  return parseFloat(str) || 120;
}

/**
 * Format seconds as "M:SS.mmm".
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatLapTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/**
 * Format seconds as "H:MM:SS".
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatRaceTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Pit stop time = base + optional tire change + fueling time.
 * @param {number} pitBaseSecs
 * @param {boolean} tiresChanged
 * @param {number} tireChangeSecs
 * @param {number} fuelToAddLiters
 * @param {number} fuelRateLitersPerSec
 * @returns {number}
 */
export function calcPitStopTime(pitBaseSecs, tiresChanged, tireChangeSecs, fuelToAddLiters, fuelRateLitersPerSec) {
  let time = pitBaseSecs;
  if (tiresChanged) time += tireChangeSecs;
  if (fuelToAddLiters > 0 && fuelRateLitersPerSec > 0) {
    time += fuelToAddLiters / fuelRateLitersPerSec;
  }
  return time;
}

/**
 * Piecewise-linear pace at a given tyre age: start→half over the first 50% of
 * life, half→end over the back 50%, clamped at end pace past 100%. Callers
 * (the lap loop, and the tyre-change cost/benefit comparison below) never
 * actually drive tireAge past tireLife — stints are capped before that point
 * — so the clamp is a defensive boundary, not a modelled "running on dead
 * tyres" behaviour; there is still no cliff past declared tireLife.
 */
function tirePaceSecs(ct, tireAge, tireLife) {
  const tireRatio = tireAge / tireLife;
  if (tireRatio <= 0.5) {
    const r = tireRatio / 0.5;
    return ct.startSecs + r * (ct.halfSecs - ct.startSecs);
  }
  let r = (tireRatio - 0.5) / 0.5;
  if (r > 1.0) r = 1.0;
  return ct.halfSecs + r * (ct.endSecs - ct.halfSecs);
}

/** Next stint length capped by tyre life, fuel range, and mandatory-stop pacing (whichever binds first). */
function cappedStintLaps(tireCapLaps, fuelCapLaps, mandatoryPacingLaps) {
  if (mandatoryPacingLaps < fuelCapLaps && mandatoryPacingLaps < tireCapLaps) return mandatoryPacingLaps;
  return tireCapLaps <= fuelCapLaps ? tireCapLaps : fuelCapLaps;
}

// ---------------------------------------------------------------------------
// Multi-driver helpers
// ---------------------------------------------------------------------------

/**
 * Pick which driver should take the next stint.
 * Priority: driver who still has the most unfulfilled minimum time.
 * Tie-break: driver with least total accumulated time.
 *
 * Exception: a stint much shorter than a normal one for this race (e.g. a
 * tyre-life remainder from the tyre-change economics in simulateStrategy)
 * can't make a meaningful dent in the most-behind driver's deficit anyway —
 * give it instead to whichever owing driver it WOULD fully cover, so it isn't
 * wasted. Reserve normal-length-or-longer stints for the driver who owes the
 * most as usual: only they can actually be satisfied by one, so diverting a
 * full-length stint away from them would risk the same problem in reverse —
 * a fixed-length race running out of stints before everyone's minimum is met.
 *
 * This is a single-pass greedy heuristic, not a solved schedule — it doesn't
 * know what stint lengths are still coming. findBestStrategies tries this
 * AND a whole-race-aware alternative (planDriverAssignment, which sees every
 * stint length up front) and keeps whichever actually works out better; see
 * that function and the comment above its call site for how they're
 * combined. Even together they reliably meet everyone's minimum only when it
 * leaves reasonable slack below an even split of the race — a minimum set
 * right at the theoretical maximum a driver could get (e.g. exactly
 * race-length ÷ driver-count, especially with few total stints) can still
 * leave them marginally short, no matter which of the two picks the driver.
 * Confirmed even with the simplest possible config (1 mandatory stop, 2
 * drivers, minimum = exactly half the race), predating and unrelated to the
 * tyre-change economics above.
 */
function pickNextDriver(drivers, driverTimeSecs, minDriverTimeSecs, upcomingStintSecs, normalStintSecs) {
  if (drivers.length === 1) return 0;
  const min = minDriverTimeSecs || 0;
  const owed = drivers.map((_, i) => Math.max(0, min - driverTimeSecs[i]));
  const maxOwed = Math.max(...owed);
  if (maxOwed <= 0) return driverTimeSecs.indexOf(Math.min(...driverTimeSecs));
  const isFragmentStint = upcomingStintSecs != null && normalStintSecs > 0 && upcomingStintSecs < 0.6 * normalStintSecs;
  if (isFragmentStint) {
    let bestFit = -1;
    for (let i = 0; i < owed.length; i++) {
      if (owed[i] > 0 && owed[i] <= upcomingStintSecs && (bestFit === -1 || owed[i] > owed[bestFit])) bestFit = i;
    }
    if (bestFit !== -1 && owed[bestFit] < maxOwed) return bestFit;
  }
  return owed.indexOf(maxOwed);
}

/**
 * Precompute which driver runs each stint, given the FULL sequence of stint
 * durations for the race. Stint boundaries are fixed by fuel/tyre/mandatory-
 * pacing independent of driver identity (see the neutral-pace probe run in
 * findBestStrategies), so this sequence is knowable up front. Unlike
 * pickNextDriver's one-stint-at-a-time view, this sees every stint length in
 * advance and can allocate the long ones to whoever needs them most before
 * only short ones are left to hand out — the reason a chronological greedy
 * pick can leave a driver short even when the race has more than enough
 * total time for everyone, just not enough LONG stints left once a short one
 * already went to the wrong driver.
 *
 * Longest-stint-first, each assigned to whoever currently owes the most
 * toward their minimum (once everyone's minimum is met, to whoever has
 * driven least overall) — a standard load-balancing strategy (schedule the
 * biggest jobs first) adapted to a "reach at least X" target rather than
 * "minimize the maximum." This first pass commits to each assignment
 * irrevocably and can still land short of the best available split — e.g. 9
 * stints split between 2 drivers needing 1800s each landed [1924, 1789]
 * (short by 11s) when a single stint swap reaches [1806, 1907] from the SAME
 * stints (total unchanged at 3713s — a swap only redistributes it between
 * the two), simply because by the time the smallest stints are placed, the
 * two drivers are already near-tied and whichever gets the short end, stays
 * short. A second pass (below) fixes exactly this: local-search refinement
 * by swapping stints between drivers whenever it helps, which finds that
 * better split directly from the same starting point.
 *
 * Not a hard guarantee: with very few stints relative to driver count (e.g.
 * 2 drivers splitting a 2-stint race), there is only one way to split them —
 * no assignment algorithm can improve on that; the shortfall in that case
 * comes from stint lengths (fixed by fuel/tyre physics) not dividing evenly,
 * not from a bad assignment choice. See pickNextDriver's docstring.
 *
 * Also assumes stint boundaries are driver-independent — true for LAP COUNTS
 * (fixed by fuel/tyre/mandatory-pacing before any driver is picked), but not
 * exactly true for durations when per-driver compound times differ: a
 * different driver on an early stint changes elapsedSecs, which can shift
 * where LATER stints end. `stintSecsInOrder` comes from a probe run using
 * whichever driver the chronological pick happened to assign, so the plan
 * built here can end up targeting a slightly different stint than the real
 * (re-simulated) run actually has at that index. This doesn't corrupt
 * anything — each simulation stays internally consistent on its own — and
 * findBestStrategies' totalLaps/race-time priority means a plan that ends up
 * worse from this drift is simply rejected in favour of the chronological
 * result, never accepted anyway. It just means the fairness improvement is
 * somewhat less reliable when drivers have meaningfully different pace.
 *
 * @param {number[]} stintSecsInOrder total time (driving + attributable pit
 *   stop) for each stint, in chronological race order
 * @param {number} numDrivers
 * @param {number} minDriverTimeSecs
 * @returns {number[]} driver index for each stint, same order as input
 */
function planDriverAssignment(stintSecsInOrder, numDrivers, minDriverTimeSecs) {
  if (numDrivers <= 1) return stintSecsInOrder.map(() => 0);
  const order = stintSecsInOrder
    .map((secs, index) => ({ secs, index }))
    .sort((a, b) => b.secs - a.secs);
  const driverTotals = new Array(numDrivers).fill(0);
  const assignment = new Array(stintSecsInOrder.length);
  for (const { secs, index } of order) {
    const owed = driverTotals.map((t) => Math.max(0, minDriverTimeSecs - t));
    const maxOwed = Math.max(...owed);
    const driverIdx = maxOwed > 0 ? owed.indexOf(maxOwed) : driverTotals.indexOf(Math.min(...driverTotals));
    assignment[index] = driverIdx;
    driverTotals[driverIdx] += secs;
  }

  // Local-search refinement: repeatedly find the single stint-swap between
  // two drivers that improves [driversSatisfied, worstCaseTotal] the most,
  // apply it, repeat until no swap helps. This is exact multiway-partition
  // optimization only for trivially small inputs — for the stint/driver
  // counts an endurance race actually produces (dozens of stints, up to a
  // handful of drivers) it isn't guaranteed globally optimal, but it reliably
  // escapes LPT's "committed too early" failure mode (the example above):
  // starting from [1924, 1789], swapping one 508s stint (driver A) for one
  // 390s stint (driver B) reaches [1806, 1907] in a single step, already
  // clearing both minimums.
  //
  // Every applied swap strictly improves the score in the same lexicographic
  // order used to compare it, so the sequence of scores can't repeat a prior
  // state — termination is guaranteed without the iteration cap; the cap is
  // just cheap insurance against a mistake in that reasoning, not a load-
  // bearing part of it.
  const n = stintSecsInOrder.length;
  const scoreOf = (totals) => [totals.filter((t) => t >= minDriverTimeSecs).length, Math.min(...totals)];
  const isBetter = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

  let guard = 0;
  const maxIterations = n * 4;
  for (;;) {
    if (guard++ >= maxIterations) break;
    let bestSwap = null;
    let bestScore = scoreOf(driverTotals);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const di = assignment[i];
        const dj = assignment[j];
        if (di === dj) continue;
        const secsI = stintSecsInOrder[i];
        const secsJ = stintSecsInOrder[j];
        const trial = driverTotals.slice();
        trial[di] += secsJ - secsI;
        trial[dj] += secsI - secsJ;
        const trialScore = scoreOf(trial);
        if (isBetter(trialScore, bestScore)) {
          bestScore = trialScore;
          bestSwap = { i, j, di, dj, secsI, secsJ };
        }
      }
    }
    if (!bestSwap) break;
    const { i, j, di, dj, secsI, secsJ } = bestSwap;
    assignment[i] = dj;
    assignment[j] = di;
    driverTotals[di] += secsJ - secsI;
    driverTotals[dj] += secsI - secsJ;
  }

  return assignment;
}

// ---------------------------------------------------------------------------
// Multi-compound strategy engine (simulation-based)
// ---------------------------------------------------------------------------

/**
 * Simulate the race stint-by-stint with a given compound plan.
 * @param {object} p
 * @returns {object} Strategy object with stints array
 */
function simulateStrategy(p) {
  const {
    targetRaceTimeSecs,
    tankSize,
    effectiveLPT,
    effectiveLitersPerLap,
    compoundPlan,
    pitBaseSecs,
    tireChangeSecs,
    fuelRateLitersPerSec,
    mandatoryStops,
    startLapOffset,
    initialFuel,
    initialCompound,
    currentTireAgeLaps,
    fuelWeightPenaltyPerLiter,
    // Seconds on every lap from the car's condition rather than its fuel or
    // tyres, for as many laps as that condition lasts. See findBestStrategies.
    pacePenalty = 0,
    pacePenaltyLapCount = Infinity,
    processedDrivers,
    minDriverTimeSecs,
    cyclic = true,
    presetDriverAssignment = null,
    finalStintOverride = null,
    // A typed-in plan's stint lengths: (stintIndex) => laps, or null for "the
    // engine decides". Still capped by fuel and tyre life — a car cannot run
    // past its tank — and a stint that had to be cut says so (`forcedLaps`).
    forcedStintLaps = null,
  } = p;

  const stints = [];
  let currentLap = startLapOffset || 1;
  // Where the simulated remainder begins, so a bounded pace penalty knows how
  // many laps it has left to run.
  const simStartLap = currentLap;
  let elapsedSecs = 0;
  let activeComp = initialCompound || compoundPlan[0];
  let tireLapsLeft = Math.max(1, activeComp.tireLife - (currentTireAgeLaps || 0));

  // Mid-race logic: use initialFuel to cap Stint 1 fuel limits
  let currentFuelLiters = initialFuel !== null ? initialFuel : tankSize;

  let totalTimeLostSecs = 0;
  let totalDrivingTimeSecs = 0;
  let pitsDone = 0;

  // Multi-driver state
  const driverTimeSecs = processedDrivers.map(() => 0);
  let currentDriverIdx = 0;

  const FUEL_ROUND_EPSILON = 0.0001;

  while (elapsedSecs < targetRaceTimeSecs) {
    let fuelLapsLeft = Math.floor(currentFuelLiters / effectiveLitersPerLap + FUEL_ROUND_EPSILON);
    if (fuelLapsLeft > effectiveLPT) fuelLapsLeft = effectiveLPT;
    if (fuelLapsLeft < 1) fuelLapsLeft = 1;

    // Latest lap we could push this stint to (fuel OR tires, whichever runs first)
    const pitWindowLatestLap = currentLap + Math.min(fuelLapsLeft, tireLapsLeft) - 1;

    // Per-lap metric logic happens inside the lap loop now

    // Three different lap-time estimators are used across this function, each for
    // a different purpose — not an oversight, each needs a different bias:
    //   1. slowestLapTime (below) — the WORST case across every compound in the
    //      plan. Dividing remaining time by it deliberately UNDER-estimates
    //      remaining laps, which schedules mandatory stops sooner rather than
    //      later — the safe direction. An optimistic (fast) pace would instead
    //      OVER-estimate remaining laps, push a required stop's target lap too
    //      late, and risk it never happening before the race ends.
    //   2. activeComp.avgLapTimeSecs (used for estRemainingLaps at each pit) — the
    //      pace of the tyre actually being run right now, for realistic stint sizing.
    //   3. nextComp.avgLapTimeSecs (used for estRemainingLapsForFuel) — the pace of
    //      the tyre about to be fitted, so switching to a faster compound doesn't
    //      under-fuel the upcoming stint.
    let slowestLapTime = compoundPlan[0].avgLapTimeSecs;
    for (const c of compoundPlan) {
      if (c.avgLapTimeSecs > slowestLapTime) slowestLapTime = c.avgLapTimeSecs;
    }

    let timeRemainingEst = targetRaceTimeSecs - elapsedSecs;
    let estRemainingLapsForMins = Math.ceil(timeRemainingEst / slowestLapTime);
    let reqStops = mandatoryStops - pitsDone;
    let limitForMandatory = 9999;
    if (reqStops > 0 && estRemainingLapsForMins > 0) {
      limitForMandatory = Math.ceil(estRemainingLapsForMins / (reqStops + 1));
    }

    let trueF = currentLap + fuelLapsLeft - 1;
    let trueT = currentLap + tireLapsLeft - 1;
    let targetStopLap;

    if (limitForMandatory < fuelLapsLeft && limitForMandatory < tireLapsLeft) {
      targetStopLap = currentLap + limitForMandatory - 1;
    } else {
      targetStopLap = trueT <= trueF ? trueT : trueF;
    }

    const forcedLaps = forcedStintLaps ? forcedStintLaps(stints.length) : null;
    if (forcedLaps > 0) {
      targetStopLap = currentLap + Math.min(forcedLaps, fuelLapsLeft, tireLapsLeft) - 1;
    }

    if (targetStopLap < currentLap) targetStopLap = currentLap;

    // Stint length is fixed by fuel/tyre/mandatory-pacing above, independent
    // of which driver runs it — so pick the driver AFTER knowing how long this
    // stint will be. A stint-length-aware pick avoids "wasting" a short stint
    // (e.g. a tyre-economics-driven remainder stint) on whoever owes the most
    // when it can't cover their deficit anyway: see pickNextDriver.
    const estimatedStintSecs = (targetStopLap - currentLap + 1) * activeComp.avgLapTimeSecs;
    // Bounded by tire life AND mandatory-stop pacing too, not just the
    // fuel-tank cap — otherwise whichever of those is actually the binding
    // constraint for this race makes every one of its stints look like a
    // "fragment" relative to an unreachably large reference, misfiring the
    // exception on every stint instead of just genuinely short ones (e.g. a
    // race with many mandatoryStops relative to its length legitimately runs
    // uniformly short stints throughout — that's normal for THIS race, not a
    // remainder to route around).
    const normalStintSecs = Math.min(effectiveLPT, activeComp.tireLife, limitForMandatory) * activeComp.avgLapTimeSecs;
    // A precomputed assignment (see planDriverAssignment) knows every stint's
    // length for the whole race up front and can allocate long stints to
    // whoever needs them most BEFORE only short ones are left to hand out —
    // pickNextDriver only ever sees one stint at a time, chronologically, and
    // can't do that. Fall back to it for any stint beyond the precomputed
    // plan's length (can happen if driver-specific pace shifts a later stint
    // boundary slightly from the neutral-pace probe run that built the plan).
    const stintIndex = stints.length;
    currentDriverIdx = presetDriverAssignment && presetDriverAssignment[stintIndex] !== undefined
      ? presetDriverAssignment[stintIndex]
      : pickNextDriver(processedDrivers, driverTimeSecs, minDriverTimeSecs || 0, estimatedStintSecs, normalStintSecs);
    const currentDriver = processedDrivers[currentDriverIdx];

    let lapsInStint = 0;
    let stintDrivingSecs = 0;
    let isLast = false;

    // Simulate laps sequentially for precision against time buffer
    for (let lap = currentLap; lap <= targetStopLap; lap++) {
      let tireAge = activeComp.tireLife - tireLapsLeft + lapsInStint;
      // Use current driver's compound times; fall back to global compound times
      const ct = currentDriver.compTimes[activeComp.id] ?? activeComp;
      let baseLapTime = tirePaceSecs(ct, tireAge, activeComp.tireLife);

      // Fuel weight correction: full-tank reference times adjusted for current fuel.
      // As fuel burns the car gets lighter → faster. Correction is negative (speeds up lap).
      let fuelAtStartOfLap = Math.max(0, currentFuelLiters - lapsInStint * effectiveLitersPerLap);
      let fuelWeightCorrection = (fuelAtStartOfLap - tankSize) * fuelWeightPenaltyPerLiter;
      // Damage is carried for a known number of laps and then repaired.
      const damaged = pacePenalty > 0 && (lap - simStartLap) < pacePenaltyLapCount;
      let dynamicLapTime = Math.max(1, baseLapTime + fuelWeightCorrection + (damaged ? pacePenalty : 0));
      stintDrivingSecs += dynamicLapTime;
      lapsInStint++;
      if (elapsedSecs + stintDrivingSecs >= targetRaceTimeSecs) {
        isLast = true;
        break;
      }
    }

    let endLap = currentLap + lapsInStint - 1;
    elapsedSecs += stintDrivingSecs;
    totalDrivingTimeSecs += stintDrivingSecs;

    // Warning check
    let fuelNeededLiters = lapsInStint * effectiveLitersPerLap;
    
    // `warning` stays English: it is what logs and the test-suite assert on.
    // `warningCode` is what the UI renders, through the i18n layer -- keeping
    // this module free of presentation while still being translatable.
    let warning = null;
    let warningCode = null;
    // The same 0.001 L tolerance the next branch already uses, and for the same
    // reason. A stint sized to exactly one tank needs exactly one tank, but
    // `100 / 22 * 22` is 100.00000000000001 in binary — so the plan the engine
    // had just proved was drivable was labelled undrivable, on a warning that
    // says the driver cannot finish the stint. A tenth of a millilitre is not
    // a fuel problem.
    if (fuelNeededLiters > tankSize + 0.001) {
      warning = 'Fuel required exceeds tank capacity';
      warningCode = 'warn_fuel_exceeds_tank';
    } else if (fuelNeededLiters > currentFuelLiters + 0.001) {
      warning = 'Not enough fuel for stint';
      warningCode = 'warn_not_enough_fuel';
    }

    currentFuelLiters -= fuelNeededLiters;
    if (currentFuelLiters < 0) currentFuelLiters = 0;

    let pitStopTimeSecs = 0;
    let fuelToAddLiters = 0;
    let tiresActuallyChanged = false;
    
    // Capture the compound and driver used for this stint before pit stop swaps them
    let stintCompoundId = activeComp.id;
    let stintCompoundName = activeComp.name;
    let stintAvgLapTimeSecs = lapsInStint > 0 ? stintDrivingSecs / lapsInStint : activeComp.avgLapTimeSecs;
    const stintDriverId = currentDriver.id;
    const stintDriverName = currentDriver.name;

    if (!isLast) {
      pitsDone++;
      let timeRemainingAtPit = targetRaceTimeSecs - elapsedSecs;
      
      // A "banzai" final-stint override (see the override loop in
      // findBestStrategies, near the end of that function): the
      // compound plan is otherwise unchanged, everything up to this pit is
      // identical to the un-overridden run — only the compound chosen for
      // what turns out to be the last stint is swapped, to try a fresher/
      // faster compound where degradation barely matters because there
      // isn't enough race left to wear it. Which specific pit this fires at
      // is decided by the CALLER from a prior, un-overridden run of this
      // same plan (pitsDone there is only known after simulating once), not
      // computed here — this branch just needs to honour it when it matches.
      let nextComp = (finalStintOverride && pitsDone === finalStintOverride.atPitsDone)
        ? finalStintOverride.compound
        : cyclic
        ? compoundPlan[pitsDone % compoundPlan.length]
        : compoundPlan[Math.min(pitsDone, compoundPlan.length - 1)];
      let estRemainingLaps = Math.ceil(timeRemainingAtPit / activeComp.avgLapTimeSecs);
      // Use next compound's pace for fuel planning — avoids underfueling when switching to a faster compound
      let estRemainingLapsForFuel = Math.ceil(timeRemainingAtPit / nextComp.avgLapTimeSecs);

      let currentTireAge = activeComp.tireLife - tireLapsLeft + lapsInStint;
      let currentTireLifeLeft = activeComp.tireLife - currentTireAge;

      let isDifferentCompound = activeComp.id !== nextComp.id;

      // The next stint's typed length, if the plan gives one.
      const nextForced = forcedStintLaps ? forcedStintLaps(stints.length + 1) : null;

      let nextReqStops = mandatoryStops - pitsDone;
      let nextLimit = 9999;
      if (nextReqStops > 0 && estRemainingLaps > 0) {
        nextLimit = Math.ceil(estRemainingLaps / (nextReqStops + 1));
      }

      if (isDifferentCompound) {
        // The plan calls for a different compound here — physically requires a change.
        tiresActuallyChanged = true;
      } else if (currentTireLifeLeft <= 0) {
        // Tyres are exactly at their declared life with zero margin left — the
        // engine never models running past this point (no cliff, but no
        // extension either), so there's nothing left to weigh: change.
        // Deliberately NOT based on whether the current set could reach the
        // end of the WHOLE race — that made this branch fire on almost every
        // stop of a normal multi-hour race (tire life is always far shorter
        // than total race distance), leaving the cost/benefit comparison below
        // unreachable in practice. This is the narrow, physically-correct
        // trigger instead.
        tiresActuallyChanged = true;
      } else if (nextForced > 0 && nextForced > currentTireLifeLeft) {
        // The typed next stint is longer than this set has left: keeping it
        // would cut the stint short of what was asked for, so change.
        tiresActuallyChanged = true;
      } else {
        // Compare total time over the SAME upcoming stint length (bounded by
        // whichever constraint the "keep" option hits first — fuel, mandatory
        // pacing, or the tyres' own remaining life) on the ageing tyres vs. on
        // a fresh set plus the pit-lane tireChangeSecs cost. Fuel needed is
        // identical on both sides for that shared lap count, so it cancels out
        // and only pace + the tyre-change cost decide it.
        // (Simplification: this only weighs the upcoming stint, not any extra
        // stint length fresh tyres might unlock further down the race — a
        // full multi-stop lookahead would catch that but isn't done here.)
        const keepStintLaps = cappedStintLaps(currentTireLifeLeft, effectiveLPT, nextLimit);
        const ct = currentDriver.compTimes[activeComp.id] ?? activeComp;
        let keepSecs = 0;
        let freshSecs = 0;
        for (let i = 0; i < keepStintLaps; i++) {
          keepSecs += tirePaceSecs(ct, currentTireAge + i, activeComp.tireLife);
          freshSecs += tirePaceSecs(ct, i, activeComp.tireLife);
        }
        tiresActuallyChanged = (freshSecs + tireChangeSecs) < keepSecs;
      }

      let nextTireCap = tiresActuallyChanged ? nextComp.tireLife : (tireLapsLeft - lapsInStint);
      if (nextTireCap < 1) nextTireCap = 1;

      let lapsInNextStint = Math.min(cappedStintLaps(nextTireCap, effectiveLPT, nextLimit), estRemainingLapsForFuel);
      // Fuel for the stint that was typed, not the one the engine would run.
      if (nextForced > 0) {
        lapsInNextStint = Math.min(nextForced, cappedStintLaps(nextTireCap, effectiveLPT, 9999), estRemainingLapsForFuel);
      }

      // The required total fuel in the tank for the next stint
      let targetFuelLiters = lapsInNextStint * effectiveLitersPerLap + 0.5;
      targetFuelLiters = Math.min(targetFuelLiters, tankSize);
      
      fuelToAddLiters = targetFuelLiters - currentFuelLiters;
      if (fuelToAddLiters < 0) fuelToAddLiters = 0; // Don't siphon

      currentFuelLiters += fuelToAddLiters;

      pitStopTimeSecs = calcPitStopTime(pitBaseSecs, tiresActuallyChanged, tireChangeSecs, fuelToAddLiters, fuelRateLitersPerSec);

      if (elapsedSecs + pitStopTimeSecs >= targetRaceTimeSecs) {
        isLast = true;
        pitStopTimeSecs = 0;
        fuelToAddLiters = 0;
        tiresActuallyChanged = false;
      } else {
        elapsedSecs += pitStopTimeSecs;
        totalTimeLostSecs += pitStopTimeSecs;

        if (tiresActuallyChanged) {
          activeComp = nextComp;
          tireLapsLeft = activeComp.tireLife;
        } else {
          tireLapsLeft -= lapsInStint;
        }
      }

    }

    // Accumulate driver time for this stint (driving + pit stop time)
    driverTimeSecs[currentDriverIdx] += stintDrivingSecs + (isLast ? 0 : pitStopTimeSecs);

    stints.push({
      stintNum: stints.length + 1,
      startLap: currentLap,
      endLap,
      lapsInStint,
      pitLap: isLast ? null : endLap,
      fuelToAddLiters: isLast ? 0 : fuelToAddLiters,
      tiresChanged: isLast ? false : tiresActuallyChanged,
      compound: stintCompoundId,
      compoundName: stintCompoundName,
      pitStopTimeSecs,
      warning,
      warningCode,
      pitWindowLatestLap: isLast ? null : pitWindowLatestLap,
      driverId: stintDriverId,
      driverName: stintDriverName,
      avgLapTimeSecs: stintAvgLapTimeSecs,
      // What a typed plan asked for, when it asked; null otherwise.
      forcedLaps: forcedLaps > 0 ? forcedLaps : null,
    });

    if (isLast) break;
    currentLap = endLap + 1;
  }

  // Primary compound = the one used in the most stints; show its tire life as the KPI
  const compoundUsageCount = {};
  for (const s of stints) compoundUsageCount[s.compound] = (compoundUsageCount[s.compound] || 0) + 1;
  const primaryCompoundId = Object.entries(compoundUsageCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const primaryCompound = compoundPlan.find(c => c.id === primaryCompoundId);
  const maxLapsPerSet = primaryCompound ? primaryCompound.tireLife : 0;

  const driverSummary = processedDrivers.map((d, i) => ({
    id: d.id,
    name: d.name,
    totalTimeSecs: driverTimeSecs[i],
    metMinimum: !minDriverTimeSecs || driverTimeSecs[i] >= minDriverTimeSecs,
  }));

  return {
    totalLaps: stints.length > 0 ? stints[stints.length - 1].endLap : 0,
    effectiveLapsPerTank: effectiveLPT,
    lapsPerTireSet: maxLapsPerSet,
    numPitStops: stints.filter(s => s.pitLap !== null).length,
    totalTimeLostSecs,
    totalDrivingTimeSecs,
    estTotalRaceTimeSecs: elapsedSecs,
    driverSummary,
    stints,
  };
}

// ---------------------------------------------------------------------------
// Strategy enumeration — test bounded compound sequences
// ---------------------------------------------------------------------------

/** Human-readable compound sequence + the set of compounds actually used, from a simulated strategy's stints. */
function labelStrategy(strategy) {
  const finalSequence = [];
  let lastId = null;
  const compoundIds = [];
  for (const st of strategy.stints) {
    if (st.compound !== lastId) {
      finalSequence.push({ id: st.compound, name: st.compoundName });
      lastId = st.compound;
    }
    if (!compoundIds.includes(st.compound)) compoundIds.push(st.compound);
  }
  // `label` stays English (logs, tests); `sequenceIds` is the same run-length
  // sequence as ids, which the UI turns into a translated label.
  return {
    label: finalSequence.map((f) => f.name).join(' → '),
    sequenceIds: finalSequence.map((f) => f.id),
    compoundIds,
  };
}

/**
 * Generate and rank all valid multi-compound strategies.
 * @param {object} params
 * @returns {Array} Array of sorted strategies
 */
// ---------------------------------------------------------------------------
// A typed-in plan
// ---------------------------------------------------------------------------

/**
 * Run a plan typed row by row: "Medium, 10 stints, 25 laps each / then Soft
 * until the flag". A row is `{ compoundId, stints, laps }`; `stints: null`
 * means until the flag (only meaningful on the last row); `laps: null` means
 * the engine sizes that row's stints from fuel and tyre life, as it does for
 * its own plans. Drivers are not part of it — they are assigned exactly as
 * for an engine plan.
 *
 * Mid-race it skips the stints already driven (`stintsDone`), and the running
 * stint only has what is left of its typed length (`lapsIntoStint`).
 *
 * Returns the usual result shape plus `manual`:
 *   rows[i].engineLaps   what the engine would run on that row, to offer
 *   rows[i].reached      whether the race gets to that row at all
 *   rows[i].invalid      the tyre has no life set, so it cannot be simulated
 *   beyondPlan           the race needs more stints than the rows give (and no
 *                        row is "until the flag"), so the last tyre carries on
 *   cutShort             stints whose typed laps fuel or tyre life would not allow
 */
function runManualPlan(rows, activeCompounds, evaluate, { stintsDone = 0, lapsIntoStint = 0 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const byId = new Map(activeCompounds.map((c) => [c.id, c]));
  const invalid = rows.map((r) => !byId.has(r.compoundId));
  if (invalid.some(Boolean)) {
    return { manual: { rows: rows.map((r, i) => ({ ...r, invalid: invalid[i], engineLaps: null, reached: false })), error: 'invalid_tyre' } };
  }

  // Every row becomes one entry per stint; an "until the flag" last row is the
  // tail that repeats.
  const entries = [];
  const rowOf = [];
  let tail = null;
  rows.forEach((r, i) => {
    const n = r.stints == null ? null : Math.max(0, Math.floor(Number(r.stints)) || 0);
    if (n == null && i === rows.length - 1) { tail = { row: i, comp: byId.get(r.compoundId), laps: Number(r.laps) > 0 ? Math.floor(Number(r.laps)) : null }; return; }
    for (let k = 0; k < (n ?? 1); k++) {
      entries.push({ comp: byId.get(r.compoundId), laps: Number(r.laps) > 0 ? Math.floor(Number(r.laps)) : null });
      rowOf.push(i);
    }
  });
  if (entries.length === 0 && !tail) return null;

  const entryAt = (i) => (i < entries.length ? entries[i] : (tail ?? entries[entries.length - 1]));
  const rowAt = (i) => (i < entries.length ? rowOf[i] : (tail ? tail.row : rowOf[rowOf.length - 1]));

  // The engine plan from where the race is now: the remaining entries, then
  // the tail (or the last entry) held to the flag.
  const plan = entries.slice(stintsDone).map((e) => e.comp);
  plan.push(tail ? tail.comp : entryAt(Math.max(stintsDone, entries.length - 1)).comp);

  const typed = (i) => {
    const laps = entryAt(i + stintsDone).laps;
    if (!(laps > 0)) return null;
    return i === 0 && lapsIntoStint > 0 ? Math.max(1, laps - lapsIntoStint) : laps;
  };

  const result = evaluate(plan, false, { forcedStintLaps: typed });
  const engine = evaluate(plan, false);

  const raceStints = result.strategy.stints.length + stintsDone;
  const rowFirstStint = rows.map((_, i) => {
    for (let k = 0; k < raceStints; k++) if (rowAt(k) === i) return k;
    return -1;
  });

  // What the engine would run on each row: the first full stint it gives that
  // row (a race's last stint is cut by the flag, so it is only used when it is
  // the only one).
  const engineLaps = rows.map((_, i) => {
    const mine = engine.strategy.stints.filter((_, k) => rowAt(k + stintsDone) === i);
    const full = mine.find((st) => st.pitLap !== null) ?? mine[0];
    return full ? full.lapsInStint : null;
  });

  const cutShort = result.strategy.stints
    .filter((st) => st.forcedLaps && st.pitLap !== null && st.lapsInStint < st.forcedLaps)
    .map((st) => ({ stintNum: st.stintNum + stintsDone, asked: st.forcedLaps, got: st.lapsInStint }));

  return {
    label: result.label,
    sequenceIds: result.sequenceIds,
    compoundIds: result.compoundIds,
    strategy: result.strategy,
    manual: {
      rows: rows.map((r, i) => ({ ...r, engineLaps: engineLaps[i], reached: rowFirstStint[i] !== -1, invalid: false })),
      beyondPlan: !tail && raceStints > entries.length,
      plannedStints: tail ? null : entries.length,
      raceStints,
      cutShort,
    },
  };
}

export function findBestStrategies(params) {
  const {
    raceDurationHours, tankSize, lapsPerFullTank, fuelMap,
    compounds, pitBaseSecs, tireChangeSecs, fuelRateLitersPerSec,
    mandatoryStops, midRaceMode, currentLap, currentFuel,
    fuelWeightPenaltyPerLiter, drivers, minDriverTimeSecs,
    pacePenaltySecs = 0, pacePenaltyLaps = null,
  } = params;
  const penalty = Number(fuelWeightPenaltyPerLiter) || 0;
  // Seconds added to every lap regardless of fuel or tyre: a damaged car, or
  // one being driven to a delta. Zero for a healthy car, which is the default.
  // Bounded, because damage does not last the race: the car is repaired at the
  // next stop, and after that it is healthy again. `pacePenaltyLaps` is how
  // many laps from here the penalty applies for — normally the laps until that
  // stop. Null means it is never repaired and it runs to the flag.
  //
  // Applied per lap rather than folded into the compound times, which are
  // constants for the whole race and could not express a penalty that ends.
  // It therefore does NOT move `avgLapTimeSecs`, which is a planning estimate
  // used for stint sizing; over the handful of laps damage usually lasts, that
  // is a better approximation than pretending the whole race is slower.
  const pacePenalty = Math.max(0, Number(pacePenaltySecs) || 0);
  const pacePenaltyLapCount = pacePenaltyLaps == null || !Number.isFinite(Number(pacePenaltyLaps))
    ? Infinity
    : Math.max(0, Math.floor(Number(pacePenaltyLaps)));

  if (!compounds || compounds.length === 0) return [];
  const targetRaceTimeSecs = Number(raceDurationHours) * 3600;
  if (targetRaceTimeSecs <= 0) return [];

  // Effective laps per tank with fuel mapping inversion fixed
  const safeLapsPerFullTank = Number(lapsPerFullTank) || 1; // Prevent DivByZero
  const effectiveLPT = Math.floor(safeLapsPerFullTank / (Number(fuelMap) || 1.0));
  const effectiveLitersPerLap = (Number(tankSize) / safeLapsPerFullTank) * (Number(fuelMap) || 1.0);
  if (effectiveLPT <= 0) return [];

  // Active compounds mapped to precise calculated parameters
  const activeCompounds = compounds
    .filter(c => c.tireLife > 0)
    .map(c => {
      const info = TIRE_COMPOUNDS.find(tc => tc.id === c.id);
      const tireLife = Number(c.tireLife);
      const startSecs = parseLapTime(c.startLapTime);
      const halfSecs  = parseLapTime(c.halfLapTime);
      const endSecs   = parseLapTime(c.endLapTime);

      // Correct user-observed (in-game) lap times to full-tank equivalents so
      // the piecewise curve isolates tire degradation. The simulation then
      // re-applies -(tankSize - currentFuel) * penalty each lap.
      //
      // t(start) is always observed at full tank → no correction.
      // t(mid) was observed after (tireLife/2) laps of fuel burn.
      // t(end) was observed after min(tireLife, effectiveLPT) laps of burn
      //   (capped at one tank because the user refuelled for long-life compounds).
      const lapsToMid = Math.min(tireLife / 2, effectiveLPT);
      const lapsToEnd = Math.min(tireLife,      effectiveLPT);
      const fuelAtMid = Math.max(0, tankSize - lapsToMid * effectiveLitersPerLap);
      const fuelAtEnd = Math.max(0, tankSize - lapsToEnd * effectiveLitersPerLap);

      const startFT = startSecs;
      const halfFT  = halfSecs  + (tankSize - fuelAtMid) * penalty;
      const endFT   = endSecs   + (tankSize - fuelAtEnd) * penalty;

      return {
        id: c.id,
        name: info?.name || c.name,
        tireLife,
        startSecs: startFT,
        halfSecs:  halfFT,
        endSecs:   endFT,
        avgLapTimeSecs: (startFT / 4 + halfFT / 2 + endFT / 4),
      };
    });

  if (activeCompounds.length === 0) return [];

  // Build per-driver compound times with the same full-tank correction applied above.
  // If no drivers are defined, fall back to a single anonymous driver using global times.
  function driverCompTimes(rawCompounds) {
    const out = {};
    for (const comp of activeCompounds) {
      const dc = rawCompounds?.[comp.id];
      if (dc?.startLapTime) {
        const s = parseLapTime(dc.startLapTime);
        const h = parseLapTime(dc.halfLapTime);
        const e = parseLapTime(dc.endLapTime);
        const lapsToMid = Math.min(comp.tireLife / 2, effectiveLPT);
        const lapsToEnd = Math.min(comp.tireLife,     effectiveLPT);
        const fuelAtMid = Math.max(0, tankSize - lapsToMid * effectiveLitersPerLap);
        const fuelAtEnd = Math.max(0, tankSize - lapsToEnd * effectiveLitersPerLap);
        out[comp.id] = {
          startSecs: s,
          halfSecs:  h + (tankSize - fuelAtMid) * penalty,
          endSecs:   e + (tankSize - fuelAtEnd) * penalty,
        };
      } else {
        out[comp.id] = { startSecs: comp.startSecs, halfSecs: comp.halfSecs, endSecs: comp.endSecs };
      }
    }
    return out;
  }

  const processedDrivers = (drivers && drivers.length > 0)
    ? drivers.map(d => ({ id: d.id, name: d.name, compTimes: driverCompTimes(d.compounds) }))
    : [{ id: 'default', name: 'Driver', compTimes: driverCompTimes(null) }];

  const minDriveTimeSecs = Number(minDriverTimeSecs) || 0;

  // Generate all cyclic patterns up to MAX_PATTERN_LENGTH elements.
  // A pattern [H, S] means: pit 1 → H, pit 2 → S, pit 3 → H, pit 4 → S … (repeating).
  // This naturally covers single-compound, alternating, and complex cycling strategies
  // without any transition limit. Pattern count = sum(N^k, k=1..MAX_PATTERN_LENGTH)
  // which stays small even for 5 compounds (< 4000 patterns at length 5).
  const MAX_PATTERN_LENGTH = 5;
  const plans = [];

  function generatePatterns(current) {
    if (current.length >= 1) plans.push([...current]);
    if (current.length >= MAX_PATTERN_LENGTH) return;
    for (const c of activeCompounds) {
      current.push(c);
      generatePatterns(current);
      current.pop();
    }
  }

  generatePatterns([]);

  const mandatoryIds = new Set(compounds.filter(c => c.mandatory).map(c => c.id));
  const startLapOffset = midRaceMode && currentLap ? Number(currentLap) : 1;
  const initialFuel = midRaceMode && currentFuel !== null && currentFuel !== '' ? Number(currentFuel) : null;
  const currentCompoundId = midRaceMode && params.currentCompoundId ? params.currentCompoundId : null;
  const currentTireAgeLaps = midRaceMode && params.currentTireAgeLaps !== undefined ? Number(params.currentTireAgeLaps) : 0;
  
  const initialCompound = currentCompoundId ? activeCompounds.find(c => c.id === currentCompoundId) : null;

  // For each compound pattern, simulate both modes:
  //   cyclic=true  → [H,S] repeats as H S H S H S … (already handled before)
  //   cyclic=false → [H,S] holds last as H S S S S … (new: covers permanent compound switches)
  // Single-compound plans produce the same result in both modes, so only multi-compound plans get the second variant.
  // Deduplication below removes any variants that produce identical stint sequences.
  const allVariants = [
    ...plans.map(plan => ({ plan, cyclic: true })),
    ...plans.filter(plan => plan.length > 1).map(plan => ({ plan, cyclic: false })),
  ];

  // One compound plan through the simulation and both driver assignments. The
  // engine's own enumeration and a typed-in plan both come through here, so a
  // typed plan is simulated and driver-assigned exactly as the engine's are.
  function evaluate(plan, cyclic, extra = {}) {
    const baseSimParams = {
      targetRaceTimeSecs,
      tankSize: Number(tankSize),
      effectiveLPT,
      effectiveLitersPerLap,
      compoundPlan: plan,
      pitBaseSecs: Number(pitBaseSecs) || 25,
      tireChangeSecs: Number(tireChangeSecs) || 27,
      fuelRateLitersPerSec: Number(fuelRateLitersPerSec) || 4.0,
      mandatoryStops: Number(mandatoryStops) || 0,
      startLapOffset,
      initialFuel,
      initialCompound,
      currentTireAgeLaps,
      fuelWeightPenaltyPerLiter: penalty,
      pacePenalty,
      pacePenaltyLapCount,
      processedDrivers,
      minDriverTimeSecs: minDriveTimeSecs,
      cyclic,
      ...extra,
    };

    let strategy = simulateStrategy(baseSimParams);
    let usedDriverAssignment = null;

    // With a real multi-driver minimum to hit, picking one stint at a time
    // chronologically (pickNextDriver, above) can leave a driver short even
    // when the race has enough total time for everyone — see
    // planDriverAssignment's docstring. Stint lengths are fixed by
    // fuel/tyre/mandatory-pacing, not by who drives them, so this first run's
    // stint sequence is a valid probe: pull the attributed time per stint
    // from it, plan a longest-stint-first assignment, and re-simulate with
    // that instead. That planner isn't strictly better, though — it's a
    // different greedy with its own failure modes and can occasionally find
    // a WORSE split than the chronological pick did (verified: neither
    // heuristic dominates the other across a broad parameter sweep). So run
    // both and keep the better one for THIS candidate.
    //
    // "Better" respects the same priority findBestStrategies ranks all
    // candidates by — totalLaps DESC, then estTotalRaceTimeSecs ASC — before
    // ever looking at driver fairness. Which driver runs a stint changes
    // exactly how many seconds it takes (per-driver compTimes overrides), so
    // with differing driver paces the two assignments CAN finish a different
    // number of laps for the same compound plan; only when laps and race
    // time are tied does driver-satisfaction (then worst-case driver total)
    // decide. This guarantees the swap never makes this candidate rank worse
    // than it otherwise would, only ever improves fairness "for free."
    if (processedDrivers.length > 1 && minDriveTimeSecs > 0) {
      const stintSecsInOrder = strategy.stints.map(
        (s) => s.lapsInStint * s.avgLapTimeSecs + (s.pitLap !== null ? s.pitStopTimeSecs : 0)
      );
      const presetDriverAssignment = planDriverAssignment(stintSecsInOrder, processedDrivers.length, minDriveTimeSecs);
      const lptStrategy = simulateStrategy({ ...baseSimParams, presetDriverAssignment });
      const fairnessScore = (s) => {
        const totals = s.driverSummary.map((d) => d.totalTimeSecs);
        const satisfied = s.driverSummary.filter((d) => d.metMinimum).length;
        return [satisfied, Math.min(...totals)];
      };
      let useLpt;
      if (lptStrategy.totalLaps !== strategy.totalLaps) {
        useLpt = lptStrategy.totalLaps > strategy.totalLaps;
      } else if (lptStrategy.estTotalRaceTimeSecs !== strategy.estTotalRaceTimeSecs) {
        useLpt = lptStrategy.estTotalRaceTimeSecs < strategy.estTotalRaceTimeSecs;
      } else {
        const [chronoSatisfied, chronoWorst] = fairnessScore(strategy);
        const [lptSatisfied, lptWorst] = fairnessScore(lptStrategy);
        useLpt = lptSatisfied > chronoSatisfied || (lptSatisfied === chronoSatisfied && lptWorst > chronoWorst);
      }
      if (useLpt) {
        strategy = lptStrategy;
        usedDriverAssignment = presetDriverAssignment;
      }
    }

    const { label, sequenceIds, compoundIds } = labelStrategy(strategy);

    return {
      label,
      sequenceIds,
      compoundIds,
      strategy,
      _simParams: baseSimParams,
      _driverAssignment: usedDriverAssignment,
    };
  }

  // A typed-in plan: run that one plan only, and say how it fits the race.
  if (params.manualPlan) {
    const r = runManualPlan(params.manualPlan, activeCompounds, evaluate, {
      stintsDone: midRaceMode ? Number(params.manualStintsDone) || 0 : 0,
      lapsIntoStint: midRaceMode ? Number(params.manualLapsIntoStint) || 0 : 0,
    });
    return r ? [r] : [];
  }

  const strategies = allVariants.map(({ plan, cyclic }) => evaluate(plan, cyclic));

  // Hard filter: remove strategies that violate mandatory compound or minimum stop rules
  const filtered = strategies.filter(s => {
    if (s.strategy.numPitStops < Number(mandatoryStops)) return false;
    for (const req of mandatoryIds) {
      if (!s.compoundIds.includes(req)) return false;
    }
    return true;
  });

  // Deduplicate by identical stint history to avoid duplicate outputs
  const uniqueStrats = [];
  const signatureSet = new Set();
  for (let s of filtered) {
    const sig = s.strategy.stints.map(st => `${st.lapsInStint}-${st.compound}-${st.fuelToAddLiters.toFixed(1)}`).join('|');
    if (!signatureSet.has(sig)) {
      signatureSet.add(sig);
      uniqueStrats.push(s);
    }
  }

  uniqueStrats.sort((a, b) => {
    if (b.strategy.totalLaps !== a.strategy.totalLaps) {
      return b.strategy.totalLaps - a.strategy.totalLaps;
    }
    return a.strategy.estTotalRaceTimeSecs - b.strategy.estTotalRaceTimeSecs;
  });

  // "Banzai" final stint: no compound pattern (cyclic or hold-last) can
  // express "run X for the whole race, but Y just for the true final stint"
  // — cyclic repeats a compound periodically, hold-last locks it in forever
  // once reached, neither means "only at the very end regardless of how many
  // stops the race has." That's a real tactic though: degradation barely
  // matters over a short closing stint (not enough distance to wear tyres),
  // so a fresher/faster compound can gain a little there even when it would
  // lose over a full stint. Tried only on the #1 result, not all ~4-8k
  // candidates — the effect is local to one stint, so it can't plausibly
  // change which BASE compound plan ranks best; re-simulating it here ~4
  // extra times is far cheaper than doing so for every candidate.
  //
  // Reuses whichever driver assignment the winning strategy actually used
  // (chronological or the LPT/local-search plan) via finalStintOverride,
  // which only changes the compound chosen for the specific pit that led to
  // the ORIGINAL run's last stint — everything before that pit is simulated
  // identically either way, by causality (a pit choice can't affect what
  // already happened before it), and if the override compound turns out to
  // need an unplanned extra stop, the fallback in simulateStrategy reverts to
  // the plan's normal pattern for it, so a backfiring override just produces
  // a worse totalLaps/race-time and gets correctly rejected below.
  if (uniqueStrats.length > 0) {
    const best = uniqueStrats[0];
    const finalCompoundId = best.strategy.stints[best.strategy.stints.length - 1].compound;
    let bestFinalStrategy = best.strategy;
    for (const overrideComp of activeCompounds) {
      if (overrideComp.id === finalCompoundId) continue;
      const overrideStrategy = simulateStrategy({
        ...best._simParams,
        presetDriverAssignment: best._driverAssignment,
        finalStintOverride: { atPitsDone: best.strategy.numPitStops, compound: overrideComp },
      });
      // The mandatory-compound filter already ran (above, before ranking) on
      // the un-overridden candidates — it has no way to know this step would
      // exist. If the compound being swapped OUT was the only occurrence of
      // a required compound in the plan (a real case: the cheapest way to
      // satisfy "compound X must appear somewhere" is often to use it for
      // just one short stint, which can legitimately be the final one), the
      // override must not silently undo that requirement.
      const stillSatisfiesMandatory = [...mandatoryIds].every((req) =>
        overrideStrategy.stints.some((st) => st.compound === req)
      );
      const better = stillSatisfiesMandatory && (
        overrideStrategy.totalLaps > bestFinalStrategy.totalLaps ||
        (overrideStrategy.totalLaps === bestFinalStrategy.totalLaps &&
          overrideStrategy.estTotalRaceTimeSecs < bestFinalStrategy.estTotalRaceTimeSecs)
      );
      if (better) bestFinalStrategy = overrideStrategy;
    }
    if (bestFinalStrategy !== best.strategy) {
      best.strategy = bestFinalStrategy;
      Object.assign(best, labelStrategy(bestFinalStrategy));
    }
  }

  return uniqueStrats.map((s) => ({
    label: s.label, sequenceIds: s.sequenceIds, compoundIds: s.compoundIds, strategy: s.strategy,
  }));
}

