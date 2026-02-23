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
    initialFuel
  } = p;

  const stints = [];
  let currentLap = startLapOffset || 1;
  let elapsedSecs = 0;
  let compIdx = 0;
  let activeComp = compoundPlan[0];
  let tireLapsLeft = Math.floor(activeComp.tireLife * 0.9);

  // Mid-race logic: use initialFuel to cap Stint 1 fuel limits
  let fuelLapsLeft = initialFuel !== null ? Math.floor(initialFuel / effectiveLitersPerLap) : effectiveLPT;
  if (fuelLapsLeft < 1) fuelLapsLeft = 1;

  let totalTimeLostSecs = 0;
  let totalDrivingTimeSecs = 0;
  let pitsDone = 0;

  while (elapsedSecs < targetRaceTimeSecs) {
    let timeRemainingEst = targetRaceTimeSecs - elapsedSecs;
    let estRemainingLapsForMins = Math.ceil(timeRemainingEst / activeComp.avgLapTimeSecs);
    let reqStops = mandatoryStops - pitsDone;
    let limitForMandatory = 9999;
    if (reqStops > 0 && estRemainingLapsForMins > 0) {
      limitForMandatory = Math.ceil(estRemainingLapsForMins / (reqStops + 1));
    }

    let trueF = currentLap + fuelLapsLeft - 1;
    let trueT = currentLap + tireLapsLeft - 1;
    let targetStopLap;
    let changeTires = false;

    if (limitForMandatory < fuelLapsLeft && limitForMandatory < tireLapsLeft) {
      targetStopLap = currentLap + limitForMandatory - 1;
      // Change tires if we are close to tire life limits
      if (targetStopLap >= trueT - 3) changeTires = true;
    } else {
      // 3 lap merging rule
      if (Math.abs(trueF - trueT) <= 3) {
        targetStopLap = Math.min(trueF, trueT);
        changeTires = true;
      } else if (trueF < trueT) {
        targetStopLap = trueF;
        changeTires = false;
      } else {
        targetStopLap = trueT;
        changeTires = true;
      }
    }

    // Defensive programming
    if (targetStopLap < currentLap) targetStopLap = currentLap;

    let lapsInStint = 0;
    let stintDrivingSecs = 0;
    let isLast = false;

    // Simulate laps sequentially for precision against time buffer
    for (let lap = currentLap; lap <= targetStopLap; lap++) {
      stintDrivingSecs += activeComp.avgLapTimeSecs;
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
    }

    let pitStopTimeSecs = 0;
    let fuelToAddLiters = 0;
    let tiresActuallyChanged = false;

    if (!isLast) {
      pitsDone++;
      let timeRemainingAtPit = targetRaceTimeSecs - elapsedSecs;
      let nextCompIdx = (changeTires && compIdx + 1 < compoundPlan.length) ? compIdx + 1 : compIdx;
      let nextComp = compoundPlan[nextCompIdx];
      let estRemainingLaps = Math.ceil(timeRemainingAtPit / nextComp.avgLapTimeSecs);

      let currentTireAge = Math.floor(activeComp.tireLife * 0.9) - tireLapsLeft + lapsInStint;
      let currentTireLifeLeft = Math.floor(activeComp.tireLife * 0.9) - currentTireAge;

      // "if the tires would survive to the finish without dropping below 10%, do NOT schedule a tire change"
      // EXCEPT: if the strategy requires switching compounds, we MUST change tires.
      let isDifferentCompound = activeComp.id !== nextComp.id;
      if (changeTires && !isDifferentCompound && estRemainingLaps <= currentTireLifeLeft) {
        changeTires = false;
      }

      tiresActuallyChanged = changeTires || isDifferentCompound;

      let nextReqStops = mandatoryStops - pitsDone;
      let nextLimit = 9999;
      if (nextReqStops > 0 && estRemainingLaps > 0) {
        nextLimit = Math.ceil(estRemainingLaps / (nextReqStops + 1));
      }

      let nextTireCap = tiresActuallyChanged ? Math.floor(nextComp.tireLife * 0.9) : (tireLapsLeft - lapsInStint);
      if (nextTireCap < 1) nextTireCap = 1;

      let nextF = effectiveLPT;
      let nextT = nextTireCap;

      let nextStintLaps;
      if (nextLimit < nextF && nextLimit < nextT) {
        nextStintLaps = nextLimit;
      } else {
        if (Math.abs(nextF - nextT) <= 3) nextStintLaps = Math.min(nextF, nextT);
        else if (nextF < nextT) nextStintLaps = nextF;
        else nextStintLaps = nextT;
      }

      let lapsInNextStint = Math.min(nextStintLaps, estRemainingLaps);

      // The last stint fuel add should be exactly enough to finish plus safety
      let rawFuel = lapsInNextStint * effectiveLitersPerLap + 0.5;
      fuelToAddLiters = Math.min(rawFuel, tankSize);

      pitStopTimeSecs = calcPitStopTime(pitBaseSecs, tiresActuallyChanged, tireChangeSecs, fuelToAddLiters, fuelRateLitersPerSec);

      elapsedSecs += pitStopTimeSecs;
      totalTimeLostSecs += pitStopTimeSecs;

      if (tiresActuallyChanged) {
        if (compIdx + 1 < compoundPlan.length) {
          compIdx++;
          activeComp = compoundPlan[compIdx];
        }
        tireLapsLeft = Math.floor(activeComp.tireLife * 0.9);
      } else {
        tireLapsLeft -= lapsInStint;
      }

      // Determine fuel left correctly based on actual added fuel cap
      if (fuelToAddLiters >= tankSize) {
        fuelLapsLeft = effectiveLPT;
      } else {
        fuelLapsLeft = lapsInNextStint;
      }
      if (fuelLapsLeft < 1) fuelLapsLeft = 1;
    }

    stints.push({
      stintNum: stints.length + 1,
      startLap: currentLap,
      endLap,
      lapsInStint,
      pitLap: isLast ? null : endLap,
      fuelToAddLiters: isLast ? 0 : fuelToAddLiters,
      tiresChanged: isLast ? false : tiresActuallyChanged,
      compound: activeComp.id,
      compoundName: activeComp.name,
      pitStopTimeSecs,
      warning,
      avgLapTimeSecs: activeComp.avgLapTimeSecs // needed by StrategyTimeline if it ever looks, not strictly requested
    });

    if (isLast) break;
    currentLap = endLap + 1;
  }

  let maxLapsPerSet = activeComp.tireLife;
  for (let c of compoundPlan) {
    if (c.tireLife > maxLapsPerSet) maxLapsPerSet = c.tireLife;
  }

  return {
    totalLaps: stints[stints.length > 0 ? stints.length - 1 : 0].endLap,
    effectiveLapsPerTank: effectiveLPT,
    lapsPerTireSet: Math.floor(maxLapsPerSet * 0.9),
    numPitStops: stints.filter(s => s.pitLap !== null).length,
    totalTimeLostSecs,
    totalDrivingTimeSecs,
    estTotalRaceTimeSecs: elapsedSecs,
    stints
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
    mandatoryStops, midRaceMode, currentLap, currentFuel
  } = params;

  if (!compounds || compounds.length === 0) return [];
  const targetRaceTimeSecs = Number(raceDurationHours) * 3600;
  if (targetRaceTimeSecs <= 0) return [];

  // Effective laps per tank with fuel mapping inversion fixed
  const effectiveLPT = Math.floor(Number(lapsPerFullTank) / (Number(fuelMap) || 1.0));
  const effectiveLitersPerLap = (Number(tankSize) / Number(lapsPerFullTank)) * (Number(fuelMap) || 1.0);
  if (effectiveLPT <= 0) return [];

  // Active compounds mapped to precise calculated parameters
  const activeCompounds = compounds
    .filter(c => c.tireLife > 0)
    .map(c => {
      const info = TIRE_COMPOUNDS.find(tc => tc.id === c.id);
      const startSecs = parseLapTime(c.startLapTime);
      const halfSecs = parseLapTime(c.halfLapTime);
      const endSecs = parseLapTime(c.endLapTime);
      return {
        id: c.id,
        name: info?.name || c.name,
        tireLife: Number(c.tireLife),
        // Weighted average across 3 points
        avgLapTimeSecs: (startSecs + 2 * halfSecs + endSecs) / 4,
      };
    });

  if (activeCompounds.length === 0) return [];

  // Generate sequence plans up to length 3
  const plans = [];
  for (let c1 of activeCompounds) plans.push([c1]);
  for (let c1 of activeCompounds) {
    for (let c2 of activeCompounds) {
      if (c1.id !== c2.id) plans.push([c1, c2]);
    }
  }
  for (let c1 of activeCompounds) {
    for (let c2 of activeCompounds) {
      for (let c3 of activeCompounds) {
        if (c1.id !== c2.id && c2.id !== c3.id) plans.push([c1, c2, c3]);
      }
    }
  }

  const mandatoryIds = new Set(compounds.filter(c => c.mandatory).map(c => c.id));
  const startLapOffset = midRaceMode && currentLap ? Number(currentLap) : 1;
  const initialFuel = midRaceMode && currentFuel !== '' ? Number(currentFuel) : null;

  const strategies = plans.map(plan => {
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
      initialFuel
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

  // Filter out strategies that miss mandatory compounds entirely
  let filtered = strategies;
  if (mandatoryIds.size > 0) {
    filtered = strategies.filter(s => {
      for (const req of mandatoryIds) {
        if (!s.compoundIds.includes(req)) return false;
      }
      return true;
    });
  }

  // Deduplicate by identical stint history to avoid duplicate outputs
  const uniqueStrats = [];
  const signatureSet = new Set();
  for (let s of filtered) {
    const sig = s.strategy.stints.map(st => `${st.lapsInStint}-${st.compound}-${st.fuelToAddLiters}`).join('|');
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

/*
 * Scenario A Trace Comment:
 * - 8h = 28800s
 * - Hard tires: start 120s, half 121s, end 123s. avgLapTimeSecs = 121.25s. tireLife 60, safe cap 54.
 * - tankSize 75, lapsPerFullTank 22. fuelMap 1.0. effectiveLPT 22. effectiveLitersPerLap 3.409.
 * - Pit: 25s base, +27s tires, 4L/s fuel.
 * 
 * Stint 1: 1 -> 22. End lap 22. Laps=22. 
 * Next limits: Fuel 22, Tire 32 (54-22). Diff=10. Target next stint = 22 laps.
 * Add fuel = 22 * 3.409 + 0.5 = 75.5 capped at 75L. Pit time = 25 + 0 + (75/4) = 43.75s.
 * 
 * Stint 2: 23 -> 44. Laps=22. 
 * Next limits: Fuel 22, Tire 10. Target next stint is 10 laps.
 * Add fuel = 10 * 3.409 + 0.5 = 34.59L. Pit time = 25 + 0 + (34.59/4) = 33.65s.
 * 
 * Stint 3: 45 -> 54. Laps=10.
 * End of this stint triggers both tire (out of 54 cap) and fuel (only loaded 10 laps worth).
 * Target next stint = 22 laps.
 * Add fuel 75L. Change tires. Pit time = 25 + 27 + (75/4) = 70.75s.
 * 
 * Repeats loop until time expires.
 */