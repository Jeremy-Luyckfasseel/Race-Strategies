import { useState, useCallback } from 'react';
import { findBestStrategies } from '../logic/strategy';

/**
 * Run findBestStrategies with validated, coerced inputs.
 * Returns { ranked, best } or null if inputs are invalid.
 */
function compute(inputs) {
  const {
    raceDurationHours,
    tankSize,
    lapsPerFullTank,
    fuelMap,
    compounds,
    pitBaseSecs,
    tireChangeSecs,
    fuelRateLitersPerSec,
    mandatoryStops,
    midRaceMode,
    currentLap,
    currentFuel,
  } = inputs;

  // Basic validation
  if (
    !raceDurationHours || Number(raceDurationHours) <= 0 ||
    !tankSize || Number(tankSize) <= 0 ||
    !lapsPerFullTank || Number(lapsPerFullTank) <= 0
  ) {
    return null;
  }

  // Ensure compounds array has at least one active compound
  const activeCompounds = (compounds || []).filter(c => c.tireLife > 0);
  if (activeCompounds.length === 0) return null;

  const ranked = findBestStrategies({
    raceDurationHours: Number(raceDurationHours),
    tankSize: Number(tankSize),
    lapsPerFullTank: Number(lapsPerFullTank),
    fuelMap: Number(fuelMap) || 1.0,
    compounds: activeCompounds,
    pitBaseSecs: Number(pitBaseSecs) || 25,
    tireChangeSecs: Number(tireChangeSecs) || 27,
    fuelRateLitersPerSec: Number(fuelRateLitersPerSec) || 4.0,
    mandatoryStops: Number(mandatoryStops) || 0,
    midRaceMode: !!midRaceMode,
    currentLap: midRaceMode ? Number(currentLap) || 0 : 0,
    currentFuel: midRaceMode && currentFuel !== '' && currentFuel !== null && !isNaN(currentFuel) ? Number(currentFuel) : null,
  });

  if (!ranked || ranked.length === 0) return null;

  return {
    ranked,
    best: ranked[0],
  };
}

/**
 * Custom hook — only computes strategy when `calculate()` is called.
 * No auto-recalculation on input changes.
 *
 * @param {object} inputs - All user-configurable race inputs
 * @returns {{ result: {ranked, best}|null, calculating: boolean, calculate: () => void }}
 */
export function useStrategy(inputs) {
  const [result, setResult] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const calculate = useCallback(() => {
    setCalculating(true);
    // Use requestAnimationFrame so the "calculating" state renders first
    requestAnimationFrame(() => {
      setResult(compute(inputs));
      setCalculating(false);
    });
  }, [inputs]);

  return { result, calculating, calculate };
}
