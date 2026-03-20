import { findBestStrategies } from './src/logic/strategy.js';

// Setup an 8 hour race where Softs are much faster but die quickly, Hards are slow but last forever.
const res = findBestStrategies({
  raceDurationHours: 8,
  tankSize: 100,
  lapsPerFullTank: 15,
  fuelMap: 1.0,
  compounds: [
    { id: 'H', name: 'Hard', tireLife: 50, startLapTime: '2:00.000', halfLapTime: '2:01.000', endLapTime: '2:02.000' }, // avg 121s
    { id: 'S', name: 'Soft', tireLife: 12, startLapTime: '1:54.000', halfLapTime: '1:55.000', endLapTime: '1:56.000' }  // avg 115s (6 seconds faster per lap!)
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 10,
  fuelRateLitersPerSec: 5,
  mandatoryStops: 0,
  midRaceMode: false,
});

if (res.length > 0) {
  console.log("TOP 3 STRATEGIES FOR 8 HOUR RACE:");
  for(let i=0; i<3; i++) {
    if(!res[i]) break;
    console.log(`\nRank ${i+1}: ${res[i].label}`);
    console.log(`Total Laps: ${res[i].strategy.totalLaps}`);
    console.log(`Pit Stops: ${res[i].strategy.numPitStops}`);
    console.log(`Total Time Lost in Pits: ${res[i].strategy.totalTimeLostSecs}s`);
  }
}
