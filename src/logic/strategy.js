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
    processedDrivers,
    minDriverTimeSecs,
    cyclic = true,
  } = p;

  const stints = [];
  let currentLap = startLapOffset || 1;
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

    if (targetStopLap < currentLap) targetStopLap = currentLap;

    // Stint length is fixed by fuel/tyre/mandatory-pacing above, independent
    // of which driver runs it — so pick the driver AFTER knowing how long this
    // stint will be. A stint-length-aware pick avoids "wasting" a short stint
    // (e.g. a tyre-economics-driven remainder stint) on whoever owes the most
    // when it can't cover their deficit anyway: see pickNextDriver.
    const estimatedStintSecs = (targetStopLap - currentLap + 1) * activeComp.avgLapTimeSecs;
    const normalStintSecs = effectiveLPT * activeComp.avgLapTimeSecs;
    currentDriverIdx = pickNextDriver(processedDrivers, driverTimeSecs, minDriverTimeSecs || 0, estimatedStintSecs, normalStintSecs);
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
      let dynamicLapTime = Math.max(1, baseLapTime + fuelWeightCorrection);
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
    
    let warning = null;
    if (fuelNeededLiters > tankSize) {
      warning = 'Fuel required exceeds tank capacity';
    } else if (fuelNeededLiters > currentFuelLiters + 0.001) {
      warning = 'Not enough fuel for stint';
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
      
      let nextComp = cyclic
        ? compoundPlan[pitsDone % compoundPlan.length]
        : compoundPlan[Math.min(pitsDone, compoundPlan.length - 1)];
      let estRemainingLaps = Math.ceil(timeRemainingAtPit / activeComp.avgLapTimeSecs);
      // Use next compound's pace for fuel planning — avoids underfueling when switching to a faster compound
      let estRemainingLapsForFuel = Math.ceil(timeRemainingAtPit / nextComp.avgLapTimeSecs);

      let currentTireAge = activeComp.tireLife - tireLapsLeft + lapsInStint;
      let currentTireLifeLeft = activeComp.tireLife - currentTireAge;

      let isDifferentCompound = activeComp.id !== nextComp.id;

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
      pitWindowLatestLap: isLast ? null : pitWindowLatestLap,
      driverId: stintDriverId,
      driverName: stintDriverName,
      avgLapTimeSecs: stintAvgLapTimeSecs,
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

/**
 * Generate and rank all valid multi-compound strategies.
 * @param {object} params
 * @returns {Array} Array of sorted strategies
 */
export function findBestStrategies(params) {
  const {
    raceDurationHours, tankSize, lapsPerFullTank, fuelMap,
    compounds, pitBaseSecs, tireChangeSecs, fuelRateLitersPerSec,
    mandatoryStops, midRaceMode, currentLap, currentFuel,
    fuelWeightPenaltyPerLiter, drivers, minDriverTimeSecs,
  } = params;
  const penalty = Number(fuelWeightPenaltyPerLiter) || 0;

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

  const strategies = allVariants.map(({ plan, cyclic }) => {
    const strategy = simulateStrategy({
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
      processedDrivers,
      minDriverTimeSecs: minDriveTimeSecs,
      cyclic,
    });

    // Label generation based on what was actually used
    const finalSequence = [];
    let lastId = null;
    let actuallyUsedArr = [];
    for (const st of strategy.stints) {
      if (st.compound !== lastId) {
        finalSequence.push({ id: st.compound, name: st.compoundName });
        lastId = st.compound;
      }
      if (!actuallyUsedArr.includes(st.compound)) {
        actuallyUsedArr.push(st.compound);
      }
    }

    return {
      label: finalSequence.map(f => f.name).join(' → '),
      compoundIds: actuallyUsedArr,
      strategy
    };
  });

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

  return uniqueStrats;
}

