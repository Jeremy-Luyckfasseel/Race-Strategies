import { findBestStrategies } from '../src/logic/strategy.js';

console.time('findBestStrategies');
const res = findBestStrategies({
  raceDurationHours: 1,
  tankSize: 100,
  lapsPerFullTank: 10,
  fuelMap: 1.0,
  compounds: [
    { id: 'H', name: 'Hard', tireLife: 15, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    { id: 'M', name: 'Medium', tireLife: 10, mandatory: false, startLapTime: '1:58', halfLapTime: '2:00', endLapTime: '2:03' },
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 5,
  fuelRateLitersPerSec: 4.0,
  mandatoryStops: 0,
  midRaceMode: false,
});
console.timeEnd('findBestStrategies');

if (res.length > 0) {
  console.log("Best Strategy:", JSON.stringify(res[0], null, 2));
  console.log("Total strategies found:", res.length);
} else {
  console.log("No strategies found.");
}
