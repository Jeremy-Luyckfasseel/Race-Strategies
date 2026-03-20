import { findBestStrategies } from './src/logic/strategy.js';

const params = {
  raceDurationHours: 8,
  tankSize: 75,
  lapsPerFullTank: 22,
  fuelMap: 1.0,
  compounds: [
    {
      id: 'H',
      name: 'Hard',
      tireLife: 60,
      startLapTime: '120', // 2:00.000
      halfLapTime: '121',  // 2:01.000
      endLapTime: '123',   // 2:03.000
      mandatory: false
    },
    {
      id: 'S',
      name: 'Soft',
      tireLife: 20,
      startLapTime: '115', // 1:55.000
      halfLapTime: '116',  // 1:56.000
      endLapTime: '120',   // 2:00.000
      mandatory: false
    }
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 27,
  fuelRateLitersPerSec: 4.0,
  mandatoryStops: 0,
  midRaceMode: false,
  currentLap: 1,
  currentFuel: ''
};

const results = findBestStrategies(params);

// Log top 3 strategies
console.log(`Found ${results.length} strategies.`);
results.slice(0, 3).forEach((r, i) => {
  console.log(`\nRank ${i + 1}: ${r.label}`);
  console.log(`Total Laps: ${r.strategy.totalLaps}`);
  console.log(`Total Time: ${r.strategy.estTotalRaceTimeSecs.toFixed(2)}s`);
  console.log(`Pit Stops: ${r.strategy.numPitStops}`);
  console.log('Stints:');
  r.strategy.stints.forEach(s => {
    console.log(`  Stint ${s.stintNum} (${s.compoundName}): Laps ${s.startLap}-${s.endLap} (${s.lapsInStint} laps) | Fuel Added: ${s.fuelToAddLiters.toFixed(2)}L | Tires Changed: ${s.tiresChanged} | Pit Time: ${s.pitStopTimeSecs.toFixed(2)}s | Avg Lap: ${s.avgLapTimeSecs.toFixed(2)}s`);
  });
});
