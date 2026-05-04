import { useState, useCallback, useEffect, useRef } from 'react';
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
    fuelWeightPenaltyPerLiter,
    drivers,
    minDriverTimeSecs,
    mandatoryStops,
    midRaceMode,
    currentLap,
    currentFuel,
    currentCompoundId,
    currentTireAgeLaps,
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
    fuelWeightPenaltyPerLiter: Number(fuelWeightPenaltyPerLiter) || 0,
    drivers: drivers || [],
    minDriverTimeSecs: Number(minDriverTimeSecs) || 0,
    mandatoryStops: Number(mandatoryStops) || 0,
    midRaceMode: !!midRaceMode,
    currentLap: midRaceMode ? Number(currentLap) || 0 : 0,
    currentFuel: midRaceMode && currentFuel !== '' && currentFuel !== null && !isNaN(currentFuel) ? Number(currentFuel) : null,
    currentCompoundId: midRaceMode && currentCompoundId ? currentCompoundId : null,
    currentTireAgeLaps: midRaceMode && currentTireAgeLaps !== '' ? Number(currentTireAgeLaps) || 0 : 0,
  });

  if (!ranked || ranked.length === 0) return null;

  return {
    ranked,
    best: ranked[0],
  };
}

/**
 * Custom hook — computes strategy automatically (debounced) on input changes,
 * and immediately when `calculate()` is called manually.
 *
 * @param {object} inputs - All user-configurable race inputs
 * @returns {{ result: {ranked, best}|null, calculating: boolean, calculate: () => void }}
 */
export function useStrategy(inputs) {
  const [result, setResult] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const debounceRef = useRef(null);

  // Auto-calculate with 600ms debounce on input changes
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setResult(compute(inputs));
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [inputs]);

  // Manual calculate — runs immediately with loading state
  const calculate = useCallback(() => {
    clearTimeout(debounceRef.current);
    setCalculating(true);
    requestAnimationFrame(() => {
      setResult(compute(inputs));
      setCalculating(false);
    });
  }, [inputs]);

  return { result, calculating, calculate };
}
