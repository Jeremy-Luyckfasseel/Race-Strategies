import { useState, useCallback } from 'react';
import InputPanel from './components/InputPanel';
import ResultsSummary from './components/ResultsSummary';
import StintTable from './components/StintTable';
import StrategyTimeline from './components/StrategyTimeline';
import { useStrategy } from './hooks/useStrategy';

const DEFAULT_INPUTS = {
  raceDurationHours: 8,
  tankSize: 100,
  lapsPerFullTank: 28,
  fuelMap: 1.0,
  compounds: [
    { id: 'H', name: 'Hard', tireLife: 60, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
    { id: 'M', name: 'Medium', tireLife: 40, mandatory: false, startLapTime: '1:58', halfLapTime: '2:00', endLapTime: '2:03' },
    { id: 'S', name: 'Soft', tireLife: 25, mandatory: false, startLapTime: '1:56', halfLapTime: '1:59', endLapTime: '2:03' },
    { id: 'IM', name: 'Intermediate', tireLife: 0, mandatory: false, startLapTime: '2:05', halfLapTime: '2:07', endLapTime: '2:10' },
    { id: 'W', name: 'Wet', tireLife: 0, mandatory: false, startLapTime: '2:10', halfLapTime: '2:13', endLapTime: '2:17' },
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 5,
  fuelRateLitersPerSec: 4.0,
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

  const { result, calculating, calculate } = useStrategy(inputs);
  const best = result?.best ?? null;
  const ranked = result?.ranked ?? [];

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
          <InputPanel inputs={inputs} onChange={handleChange} onCalculate={calculate} />
        </aside>

        <section className={`results-area${calculating ? ' results-calculating' : ''}`}>
          {calculating && best && (
            <div className="recalc-badge">⟳ Recalculating…</div>
          )}
          {!best ? (
            <div className="empty-state">
              <span className="empty-icon">📊</span>
              <p>Enter your race parameters and click <strong>Calculate Strategy</strong>.</p>
            </div>
          ) : (
            <>
              <ResultsSummary ranked={ranked} best={best} />
              <StrategyTimeline stints={best.strategy.stints} totalLaps={best.strategy.totalLaps} />
              <StintTable stints={best.strategy.stints} />
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