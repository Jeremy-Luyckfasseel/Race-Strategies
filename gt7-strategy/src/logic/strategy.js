/**
 * GT7 Endurance Race Strategy Calculator
 * All pure functions — no React dependencies.
 */

// ---------------------------------------------------------------------------
// Tire compounds
// ---------------------------------------------------------------------------

/** Built-in tire compound definitions. wearMultiplier < 1 means longer lasting. */
export const TIRE_COMPOUNDS = [
  { id: 'RH', name: 'Racing Hard',   wearMultiplier: 0.7 },
  { id: 'RM', name: 'Racing Medium', wearMultiplier: 0.85 },
  { id: 'RS', name: 'Racing Soft',   wearMultiplier: 1.0 },
  { id: 'RSS', name: 'Racing Super Soft', wearMultiplier: 1.2 },
  { id: 'IM', name: 'Intermediate',  wearMultiplier: 0.9 },
  { id: 'WW', name: 'Wet',           wearMultiplier: 0.75 },
];

// ---------------------------------------------------------------------------
// Car presets
// ---------------------------------------------------------------------------

export const CAR_PRESETS = [
  {
    id: 'gr3',
    name: 'Gr.3 — Porsche 911 RSR',
    tankSize: 90,
    fuelPerLap: 3.2,
    tireWearLaps: 28,
  },
  {
    id: 'gr1',
    name: 'Gr.1 — Toyota TS050',
    tankSize: 75,
    fuelPerLap: 4.1,
    tireWearLaps: 22,
  },
  {
    id: 'gr4',
    name: 'Gr.4 — Mazda Atenza',
    tankSize: 60,
    fuelPerLap: 2.5,
    tireWearLaps: 35,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a "MM:SS.mmm" or "MM:SS" string into total seconds.
 * @param {string} str - e.g. "2:00" or "1:45.500"
 * @returns {number} Total seconds
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

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Calculate total race laps.
 * @param {number} raceDurationHours
 * @param {number} lapTimeSecs - Lap time in seconds
 * @returns {number} Total laps (ceiling)
 */
export function calcTotalLaps(raceDurationHours, lapTimeSecs) {
  if (lapTimeSecs <= 0) return 0;
  const raceSecs = raceDurationHours * 3600;
  return Math.ceil(raceSecs / lapTimeSecs);
}

/**
 * Calculate laps per tank of fuel.
 * @param {number} tankSize - Litres
 * @param {number} fuelPerLap - Base litres per lap
 * @param {number} fuelMap - Multiplier (0.9 = saving, 1.0 = normal, 1.1 = pushing)
 * @returns {number} Laps per full tank (floor, safety margin of 0.5 L kept)
 */
export function calcLapsPerTank(tankSize, fuelPerLap, fuelMap) {
  const effectiveConsumption = fuelPerLap * fuelMap;
  if (effectiveConsumption <= 0) return Infinity;
  // Keep 0.5 L safety buffer
  return Math.floor((tankSize - 0.5) / effectiveConsumption);
}

/**
 * Calculate laps per tire set.
 * @param {number} baseWearLaps - User's base tire life in laps
 * @param {number} compoundWearMultiplier - Lower = more durable
 * @returns {number} Laps per tire set (floor)
 */
export function calcLapsPerTireSet(baseWearLaps, compoundWearMultiplier) {
  return Math.floor(baseWearLaps / compoundWearMultiplier);
}

/**
 * Generate a list of required pit laps based on an interval.
 * Starting lap is excluded; pitLaps are the laps *on which you pit*.
 * @param {number} startLap - First lap of this segment (1-indexed)
 * @param {number} endLap - Last lap of the race
 * @param {number} interval - Laps between stops
 * @returns {number[]} Sorted array of pit laps
 */
function generateStopLaps(startLap, endLap, interval) {
  const stops = [];
  let next = startLap + interval;
  while (next <= endLap) {
    stops.push(next);
    next += interval;
  }
  return stops;
}

/**
 * Merge two sorted stop-lap arrays into one, combining entries within 3 laps.
 * @param {number[]} fuelStops
 * @param {number[]} tireStops
 * @returns {{ lap: number, fuel: boolean, tires: boolean }[]}
 */
function mergeStops(fuelStops, tireStops) {
  const merged = {};

  for (const lap of fuelStops) {
    merged[lap] = { lap, fuel: true, tires: false };
  }

  for (const tireLap of tireStops) {
    // Check if there's a fuel stop within ±3 laps
    let combined = false;
    for (let offset = -3; offset <= 3; offset++) {
      const candidate = tireLap + offset;
      if (merged[candidate] && merged[candidate].fuel) {
        merged[candidate].tires = true;
        combined = true;
        break;
      }
    }
    if (!combined) {
      if (merged[tireLap]) {
        merged[tireLap].tires = true;
      } else {
        merged[tireLap] = { lap: tireLap, fuel: false, tires: true };
      }
    }
  }

  return Object.values(merged).sort((a, b) => a.lap - b.lap);
}

/**
 * Build the full stint-by-stint strategy.
 *
 * @param {object} params
 * @param {number} params.raceDurationHours
 * @param {number} params.lapTimeSecs
 * @param {number} params.tankSize
 * @param {number} params.fuelPerLap
 * @param {number} params.fuelMap
 * @param {number} params.tireWearLaps
 * @param {string} params.compoundId
 * @param {number} params.pitTimeLoss       - Seconds lost per pit stop
 * @param {number} params.mandatoryStops    - Minimum number of pit stops required
 * @param {number} [params.currentLap]      - For mid-race mode; 0 or undefined = full race
 * @param {number} [params.currentFuel]     - Litres remaining at currentLap
 *
 * @returns {{
 *   totalLaps: number,
 *   lapsPerTank: number,
 *   lapsPerTireSet: number,
 *   numPitStops: number,
 *   totalTimeLostSecs: number,
 *   recommendedCompound: string,
 *   stints: Array<{
 *     stintNum: number,
 *     startLap: number,
 *     endLap: number,
 *     pitLap: number|null,
 *     lapsInStint: number,
 *     fuelToAdd: number,
 *     tiresChanged: boolean,
 *     compound: string,
 *     warning: string|null
 *   }>
 * }}
 */
export function buildStrategy(params) {
  const {
    raceDurationHours,
    lapTimeSecs,
    tankSize,
    fuelPerLap,
    fuelMap,
    tireWearLaps,
    compoundId,
    pitTimeLoss,
    mandatoryStops,
    currentLap = 0,
    currentFuel = null,
  } = params;

  const compound = TIRE_COMPOUNDS.find(c => c.id === compoundId) || TIRE_COMPOUNDS[2];
  const totalLaps = calcTotalLaps(raceDurationHours, lapTimeSecs);
  const lapsPerTank = calcLapsPerTank(tankSize, fuelPerLap, fuelMap);
  const lapsPerTireSet = calcLapsPerTireSet(tireWearLaps, compound.wearMultiplier);
  const effectiveConsumption = fuelPerLap * fuelMap;

  const raceStartLap = currentLap > 0 ? currentLap : 1;

  // Generate raw stop laps for fuel and tires from raceStartLap
  const fuelStops = generateStopLaps(raceStartLap, totalLaps, lapsPerTank);
  const tireStops = generateStopLaps(raceStartLap, totalLaps, lapsPerTireSet);

  // Merge stops
  let pitSchedule = mergeStops(fuelStops, tireStops);

  // Enforce mandatory stops: if we have fewer than required, add evenly spaced stops
  const currentStopCount = pitSchedule.length;
  if (mandatoryStops > currentStopCount) {
    const extra = mandatoryStops - currentStopCount;
    const interval = Math.floor((totalLaps - raceStartLap) / (mandatoryStops + 1));
    const existingLaps = new Set(pitSchedule.map(s => s.lap));
    let added = 0;
    for (let i = 1; i <= mandatoryStops + 1 && added < extra; i++) {
      const lap = raceStartLap + i * interval;
      if (lap < totalLaps && !existingLaps.has(lap)) {
        pitSchedule.push({ lap, fuel: true, tires: false });
        existingLaps.add(lap);
        added++;
      }
    }
    pitSchedule.sort((a, b) => a.lap - b.lap);
  }

  // Build stints
  const stints = [];
  let stintStart = raceStartLap;
  let stintNum = 1;

  // Track initial fuel for first stint (mid-race mode)
  let firstStintFuelAvailable = currentLap > 0 && currentFuel !== null
    ? currentFuel
    : tankSize;

  const allPitLaps = [...pitSchedule.map(s => s.lap), totalLaps + 1]; // sentinel

  for (let i = 0; i < allPitLaps.length; i++) {
    const rawPitLap = allPitLaps[i];
    const isLast = rawPitLap > totalLaps;
    const pitLap = isLast ? null : rawPitLap;
    const endLap = isLast ? totalLaps : rawPitLap;
    const lapsInStint = endLap - stintStart + (isLast ? 0 : 0); // laps driven this stint

    // laps driven before pitting (or end of race)
    const lapsDriven = endLap - stintStart + (isLast ? 1 : 0);

    // Fuel available this stint
    let fuelAvailable;
    if (stintNum === 1) {
      fuelAvailable = firstStintFuelAvailable;
    } else {
      // Previous stop added fuel; we'll compute after
      fuelAvailable = tankSize;
    }

    // Fuel needed for this stint
    const fuelNeeded = lapsDriven * effectiveConsumption;

    // Fuel to add at the *previous* stop (top up only what's needed for next stint)
    // We calculate fuel to add at the end of the *previous* stint (= start of this one)
    // For stintNum === 1, no fuel was just added.
    // This will be revisited below.

    const stopEntry = pitSchedule[i];
    const tiresChanged = stopEntry ? stopEntry.tires : false;

    // Warning checks
    let warning = null;
    if (fuelNeeded > tankSize) {
      warning = `Stint ${stintNum}: needs ${fuelNeeded.toFixed(1)} L but tank only holds ${tankSize} L`;
    }
    if (lapsDriven > lapsPerTireSet && !tiresChanged && stintNum > 1) {
      warning = (warning ? warning + '; ' : '') + `Stint ${stintNum}: tires exceed wear limit (${lapsDriven} laps on same set, limit ${lapsPerTireSet})`;
    }

    stints.push({
      stintNum,
      startLap: stintStart,
      endLap,
      pitLap,
      lapsInStint: lapsDriven,
      fuelToAdd: 0,  // filled in below
      tiresChanged,
      compound: compound.id,
      compoundName: compound.name,
      warning,
    });

    if (!isLast) {
      stintStart = rawPitLap + 1;
    }
    stintNum++;
  }

  // Back-fill fuelToAdd: each pit stop we add exactly enough fuel for the next stint
  for (let i = 0; i < stints.length - 1; i++) {
    const nextStint = stints[i + 1];
    const fuelForNextStint = nextStint.lapsInStint * effectiveConsumption;
    // Clamp to tank size
    const fuelToAdd = Math.min(Math.ceil(fuelForNextStint * 10) / 10, tankSize);
    stints[i].fuelToAdd = fuelToAdd;

    // Update warning for previous stint if needed
    if (fuelForNextStint > tankSize) {
      stints[i + 1].warning = `Needs ${fuelForNextStint.toFixed(1)} L but tank is only ${tankSize} L`;
    }
  }

  const numPitStops = stints.filter(s => s.pitLap !== null).length;
  const totalTimeLostSecs = numPitStops * pitTimeLoss;

  return {
    totalLaps,
    lapsPerTank,
    lapsPerTireSet,
    numPitStops,
    totalTimeLostSecs,
    recommendedCompound: compound.name,
    stints,
  };
}