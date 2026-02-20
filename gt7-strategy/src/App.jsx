import { useState, useCallback } from 'react';
import InputPanel from './components/InputPanel';
import ResultsSummary from './components/ResultsSummary';
import StintTable from './components/StintTable';
import StrategyTimeline from './components/StrategyTimeline';
import { useStrategy } from './hooks/useStrategy';

const DEFAULT_INPUTS = {
  raceDurationHours: 8,
  lapTime: '2:00',
  tankSize: 100,
  fuelPerLap: 3.5,
  fuelMap: 1.0,
  tireWearLaps: 30,
  compoundId: 'RH',
  pitTimeLoss: 60,
  mandatoryStops: 1,
  midRaceMode: false,
  currentLap: '',
  currentFuel: '',
};

export default function App() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const handleChange = useCallback((updater) => {
    setInputs(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const { strategy, calculating } = useStrategy(inputs);

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-inner">
          <span className="header-logo">🏁</span>
          <div>
            <h1 className="header-title">GT7 Race Strategy</h1>
            <p className="header-subtitle">Endurance pit strategy calculator</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <InputPanel inputs={inputs} onChange={handleChange} />
        </aside>

        <section className={`results-area${calculating ? ' results-calculating' : ''}`}>
          {calculating && strategy && (
            <div className="recalc-badge">⟳ Recalculating…</div>
          )}
          {!strategy ? (
            <div className="empty-state">
              <span className="empty-icon">📊</span>
              <p>Enter your race parameters on the left to generate a strategy.</p>
            </div>
          ) : (
            <>
              <ResultsSummary strategy={strategy} pitTimeLoss={inputs.pitTimeLoss} />
              <StrategyTimeline stints={strategy.stints} totalLaps={strategy.totalLaps} />
              <StintTable stints={strategy.stints} />
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        GT7 Strategy Calculator · All calculations are estimates. Verify with in-game data.
      </footer>
    </div>
  );
}