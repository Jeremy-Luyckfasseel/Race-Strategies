import { useState } from 'react';
import { formatRaceTime } from '../logic/strategy';

function formatDriveTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

const INITIAL_SHOW = 6;

export default function ResultsSummary({ ranked, best, selectedIndex, onSelect }) {
  const [showAll, setShowAll] = useState(false);

  if (!best) return null;

  const strat = best.strategy;
  const {
    totalLaps,
    numPitStops,
    effectiveLapsPerTank,
    lapsPerTireSet,
    totalTimeLostSecs,
    estTotalRaceTimeSecs,
    driverSummary,
  } = strat;
  const multiDriver = driverSummary && driverSummary.length > 1;

  const totalTimeLostMins = (totalTimeLostSecs / 60).toFixed(1);
  const hasWarnings = strat.stints.some(s => s.warning);

  const kpiCards = [
    { label: 'Total Race Laps', value: totalLaps, unit: 'laps' },
    { label: 'Pit Stops', value: numPitStops, unit: 'stops' },
    { label: 'Fuel Laps per Stint', value: effectiveLapsPerTank, unit: 'laps' },
    { label: 'Tyre Laps per Set', value: lapsPerTireSet, unit: 'laps' },
    { label: 'Total Pit Time Lost', value: totalTimeLostMins, unit: 'min' },
    { label: 'Est. Race Time', value: formatRaceTime(estTotalRaceTimeSecs), unit: '' },
  ];

  const visibleStrategies = showAll ? ranked : ranked.slice(0, INITIAL_SHOW);

  return (
    <div className="results-summary">
      {hasWarnings && (
        <div className="warning-banner">
          ⚠ Strategy has warnings — check the stint table below
        </div>
      )}

      {/* Driver time summary */}
      {multiDriver && (
        <div className="driver-summary">
          {driverSummary.map(d => (
            <div key={d.id} className={`driver-chip${d.metMinimum ? '' : ' driver-chip-warn'}`}>
              <span className="driver-chip-name">{d.name}</span>
              <span className="driver-chip-time">{formatDriveTime(d.totalTimeSecs)}</span>
              {!d.metMinimum && <span className="driver-chip-flag">⚠ min not met</span>}
            </div>
          ))}
        </div>
      )}

      {/* Winner KPI strip */}
      <div className="kpi-grid">
        {kpiCards.map(card => (
          <div className="kpi-card" key={card.label}>
            <span className="kpi-value">{card.value}</span>
            {card.unit && <span className="kpi-unit"> {card.unit}</span>}
            <span className="kpi-label">{card.label}</span>
          </div>
        ))}
      </div>

      {/* Strategy comparison grid (if multiple strategies) */}
      {ranked.length > 1 && (
        <div className="strategy-comparison">
          <h3 className="section-heading comparison-title">Strategy Comparison</h3>
          <div className="comparison-grid">
            {visibleStrategies.map((entry, idx) => {
              const s = entry.strategy;
              const isBest = idx === 0;
              const lapDelta = s.totalLaps - best.strategy.totalLaps;
              const timeDeltaSecs = s.estTotalRaceTimeSecs - best.strategy.estTotalRaceTimeSecs;
              return (
                <div
                  key={`${entry.label}-${idx}`}
                  className={`comparison-card${isBest ? ' comparison-best' : ''}${idx === selectedIndex ? ' comparison-selected' : ''}`}
                  onClick={() => onSelect(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(idx);
                    }
                  }}
                >
                  {isBest && <span className="best-badge">★ Best</span>}
                  {!isBest && (
                    <span className="delta-badge">
                      {lapDelta !== 0
                        ? `${lapDelta > 0 ? '+' : ''}${lapDelta} laps`
                        : `+${timeDeltaSecs.toFixed(0)}s`}
                    </span>
                  )}
                  <div className="comparison-compound">
                    <span className={`compound-tag compound-${entry.compoundIds[0]}`}>
                      {entry.compoundIds.join('+')}
                    </span>
                  </div>
                  <div className="comparison-label">{entry.label}</div>
                  <div className="comparison-stats">
                    <div><span className="stat-val">{s.numPitStops}</span> stops</div>
                    <div><span className="stat-val">{(s.totalTimeLostSecs / 60).toFixed(1)}</span> min lost</div>
                    <div><span className="stat-val">{formatRaceTime(s.estTotalRaceTimeSecs)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {ranked.length > INITIAL_SHOW && (
            <button
              className="btn-ghost show-more-btn"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll ? `Show top ${INITIAL_SHOW}` : `Show all ${ranked.length} strategies`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
