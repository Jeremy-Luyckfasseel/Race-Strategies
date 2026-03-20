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
    initialFuel,
    initialCompound,
    currentTireAgeLaps
  } = p;

  const stints = [];
  let currentLap = startLapOffset || 1;
  let elapsedSecs = 0;
  let activeComp = initialCompound || compoundPlan[0];
  let activeTireLifeCap = Math.floor(activeComp.tireLife * 0.9);
  let tireLapsLeft = currentTireAgeLaps !== undefined ? Math.max(1, activeTireLifeCap - currentTireAgeLaps) : activeTireLifeCap;

  // Mid-race logic: use initialFuel to cap Stint 1 fuel limits
  let currentFuelLiters = initialFuel !== null ? initialFuel : tankSize;

  let totalTimeLostSecs = 0;
  let totalDrivingTimeSecs = 0;
  let pitsDone = 0;

  while (elapsedSecs < targetRaceTimeSecs) {
    let fuelLapsLeft = Math.floor((currentFuelLiters / effectiveLitersPerLap) + 1e-9);
    if (fuelLapsLeft > effectiveLPT) fuelLapsLeft = effectiveLPT;
    if (fuelLapsLeft < 1) fuelLapsLeft = 1;

    // Per-lap metric logic happens inside the lap loop now

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
    let changeTires = false;

    if (limitForMandatory < fuelLapsLeft && limitForMandatory < tireLapsLeft) {
      targetStopLap = currentLap + limitForMandatory - 1;
      // Change tires if we are close to tire life limits
      if (targetStopLap >= trueT - 3) changeTires = true;
    } else {
      // Change tires only when tires run out before or simultaneously with fuel
      if (trueT <= trueF) {
        targetStopLap = trueT;
        changeTires = true;
      } else {
        targetStopLap = trueF;
        changeTires = false;
      }
    }

    // Defensive programming
    if (targetStopLap < currentLap) targetStopLap = currentLap;

    let lapsInStint = 0;
    let stintDrivingSecs = 0;
    let isLast = false;

    // Simulate laps sequentially for precision against time buffer
    for (let lap = currentLap; lap <= targetStopLap; lap++) {
      let tireAge = Math.floor(activeComp.tireLife * 0.9) - tireLapsLeft + lapsInStint;
      let tireRatio = tireAge / activeComp.tireLife;
      let baseLapTime = 0;
      if (tireRatio <= 0.5) {
        let r = tireRatio / 0.5;
        baseLapTime = activeComp.startSecs + r * (activeComp.halfSecs - activeComp.startSecs);
      } else {
        let r = (tireRatio - 0.5) / 0.5;
        if (r > 1.0) r = 1.0;
        baseLapTime = activeComp.halfSecs + r * (activeComp.endSecs - activeComp.halfSecs);
      }

      let currentFuelThisLap = currentFuelLiters - lapsInStint * effectiveLitersPerLap;
      let missingFuelLiters = tankSize - currentFuelThisLap;
      if (missingFuelLiters < 0) missingFuelLiters = 0;
      let stintTimeGainSecs = missingFuelLiters * 0.01;

      let dynamicLapTime = baseLapTime - stintTimeGainSecs;
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
    
    // Capture the compound used for this stint before pit stop swaps it
    let stintCompoundId = activeComp.id;
    let stintCompoundName = activeComp.name;
    let stintAvgLapTimeSecs = activeComp.avgLapTimeSecs;

    if (!isLast) {
      pitsDone++;
      let timeRemainingAtPit = targetRaceTimeSecs - elapsedSecs;
      
      let nextComp = compoundPlan[pitsDone] || compoundPlan[compoundPlan.length - 1];
      // Find the fastest possible lap time to safely cap remaining laps
      let fastestLapTime = activeComp.startSecs;
      let estRemainingLaps = Math.ceil(timeRemainingAtPit / fastestLapTime);

      let currentTireAge = Math.floor(activeComp.tireLife * 0.9) - tireLapsLeft + lapsInStint;
      let currentTireLifeLeft = Math.floor(activeComp.tireLife * 0.9) - currentTireAge;

      let isDifferentCompound = activeComp.id !== nextComp.id;
      
      // "if the tires would survive to the finish without dropping below 10%, do NOT schedule a tire change"
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
        if (nextT <= nextF) nextStintLaps = nextT;
        else nextStintLaps = nextF;
      }

      let lapsInNextStint = Math.min(nextStintLaps, estRemainingLaps);

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
          tireLapsLeft = Math.floor(activeComp.tireLife * 0.9);
        } else {
          tireLapsLeft -= lapsInStint;
        }
      }

    }

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
      avgLapTimeSecs: stintAvgLapTimeSecs // Correct lap time for this stint
    });

    if (isLast) break;
    currentLap = endLap + 1;
  }

  let maxLapsPerSet = 0;
  for (let s of stints) {
    if (s.lapsInStint > maxLapsPerSet) maxLapsPerSet = s.lapsInStint;
  }

  return {
    totalLaps: stints[stints.length > 0 ? stints.length - 1 : 0].endLap,
    effectiveLapsPerTank: effectiveLPT,
    lapsPerTireSet: maxLapsPerSet,
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
  const safeLapsPerFullTank = Number(lapsPerFullTank) || 1; // Prevent DivByZero
  const effectiveLPT = Math.floor(safeLapsPerFullTank / (Number(fuelMap) || 1.0));
  const effectiveLitersPerLap = (Number(tankSize) / safeLapsPerFullTank) * (Number(fuelMap) || 1.0);
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
        startSecs,
        halfSecs,
        endSecs,
        // Trapezoidal average across 3 points
        avgLapTimeSecs: (startSecs / 4 + halfSecs / 2 + endSecs / 4),
      };
    });

  if (activeCompounds.length === 0) return [];

  // Bounding MAX_STINTS mathematically prevents combinatorial explosion in 4-compound plans
  const absoluteMinLapTime = Math.min(...activeCompounds.map(c => c.startSecs));
  const absoluteMaxLaps = Math.ceil(targetRaceTimeSecs / absoluteMinLapTime);
  const minStintLaps = Math.min(effectiveLPT, Math.min(...activeCompounds.map(c => c.tireLife)));
  const MAX_STINTS = Math.max(10, Math.ceil(absoluteMaxLaps / minStintLaps) + 2);

  const plans = [];
  const maxPracticalStints = Math.min(MAX_STINTS, absoluteMaxLaps);
  const MAX_TRANSITIONS = 3; 

  function generatePlans(currentSeq, transitions) {
    if (currentSeq.length === maxPracticalStints) {
      plans.push([...currentSeq]);
      return;
    }
    let lastComp = currentSeq.length > 0 ? currentSeq[currentSeq.length - 1] : null;

    if (transitions >= MAX_TRANSITIONS && lastComp) {
      const remainder = maxPracticalStints - currentSeq.length;
      const tail = Array(remainder).fill(lastComp);
      plans.push([...currentSeq, ...tail]);
      return;
    }

    for (const c of activeCompounds) {
      const isNewTransition = (lastComp !== null && c.id !== lastComp.id);
      if (isNewTransition && transitions >= MAX_TRANSITIONS) continue;
      
      currentSeq.push(c);
      generatePlans(currentSeq, transitions + (isNewTransition ? 1 : 0));
      currentSeq.pop();
    }
  }
  
  generatePlans([], 0);

  const mandatoryIds = new Set(compounds.filter(c => c.mandatory).map(c => c.id));
  const startLapOffset = midRaceMode && currentLap ? Number(currentLap) : 1;
  const initialFuel = midRaceMode && currentFuel !== '' ? Number(currentFuel) : null;
  const currentCompoundId = midRaceMode && params.currentCompoundId ? params.currentCompoundId : null;
  const currentTireAgeLaps = midRaceMode && params.currentTireAgeLaps !== undefined ? Number(params.currentTireAgeLaps) : 0;
  
  const initialCompound = currentCompoundId ? activeCompounds.find(c => c.id === currentCompoundId) : null;

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
      initialFuel,
      initialCompound,
      currentTireAgeLaps
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

  // Apply time penalties for missed mandatory requirements instead of completely filtering them out
  let filtered = strategies;
  for (let s of filtered) {
    let penaltySecs = Math.max(0, mandatoryStops - s.strategy.numPitStops) * 60;
    if (mandatoryIds.size > 0) {
      for (const req of mandatoryIds) {
        if (!s.compoundIds.includes(req)) penaltySecs += 60;
      }
    }
    s.strategy.estTotalRaceTimeSecs += penaltySecs;
    if (penaltySecs > 0 && s.strategy.stints.length > 0) {
      s.strategy.stints[s.strategy.stints.length - 1].warning = `Penalty: +${penaltySecs}s for missed mandatory rules`;
    }
  }

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