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
      endLapTime: '118',   // 1:58.000
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

const resultsHard = findBestStrategies({...params, compounds: [params.compounds[0]]});
const resultsSoft = findBestStrategies({...params, compounds: [params.compounds[1]]});

console.log('HARD TIRE ONLY STRATEGY:');
console.log(`Laps: ${resultsHard[0].strategy.totalLaps}, Time: ${resultsHard[0].strategy.estTotalRaceTimeSecs.toFixed(2)}s`);

console.log('\nSOFT TIRE ONLY STRATEGY:');
console.log(`Laps: ${resultsSoft[0].strategy.totalLaps}, Time: ${resultsSoft[0].strategy.estTotalRaceTimeSecs.toFixed(2)}s`);
