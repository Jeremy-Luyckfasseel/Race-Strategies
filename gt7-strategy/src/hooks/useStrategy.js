import { useState, useEffect } from 'react';
import { buildStrategy, parseLapTime } from '../logic/strategy';

const DEBOUNCE_MS = 300;

function compute(inputs) {
  const {
    raceDurationHours,
    lapTime,
    tankSize,
    fuelPerLap,
    fuelMap,
    tireWearLaps,
    compoundId,
    pitTimeLoss,
    mandatoryStops,
    midRaceMode,
    currentLap,
    currentFuel,
  } = inputs;

  const lapTimeSecs = parseLapTime(lapTime);

  if (
    !raceDurationHours || raceDurationHours <= 0 ||
    !lapTimeSecs       || lapTimeSecs <= 0 ||
    !tankSize          || tankSize <= 0 ||
    !fuelPerLap        || fuelPerLap <= 0
  ) {
    return null;
  }

  return buildStrategy({
    raceDurationHours: Number(raceDurationHours),
    lapTimeSecs,
    tankSize:       Number(tankSize),
    fuelPerLap:     Number(fuelPerLap),
    fuelMap:        Number(fuelMap) || 1.0,
    tireWearLaps:   Number(tireWearLaps) || 30,
    compoundId,
    pitTimeLoss:    Number(pitTimeLoss) || 60,
    mandatoryStops: Number(mandatoryStops) || 0,
    currentLap:     midRaceMode ? Number(currentLap) || 0 : 0,
    currentFuel:    midRaceMode ? Number(currentFuel) : null,
  });
}

/**
 * Custom hook that debounces user inputs and returns computed strategy results.
 * The calculation only runs 300ms after the user stops changing values,
 * preventing UI freezes on fast keystrokes.
 *
 * @param {object} inputs - All user-configurable race inputs
 * @returns {{ strategy: object|null, calculating: boolean }}
 */
export function useStrategy(inputs) {
  const [strategy, setStrategy] = useState(() => compute(inputs));
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    setCalculating(true);
    const id = setTimeout(() => {
      setStrategy(compute(inputs));
      setCalculating(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inputs.raceDurationHours,
    inputs.lapTime,
    inputs.tankSize,
    inputs.fuelPerLap,
    inputs.fuelMap,
    inputs.tireWearLaps,
    inputs.compoundId,
    inputs.pitTimeLoss,
    inputs.mandatoryStops,
    inputs.midRaceMode,
    inputs.currentLap,
    inputs.currentFuel,
  ]);

  return { strategy, calculating };
}
