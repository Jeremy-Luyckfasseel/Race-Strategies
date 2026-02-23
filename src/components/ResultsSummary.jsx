import { formatRaceTime } from '../logic/strategy';

/**
 * ResultsSummary — KPI cards for the best strategy + comparison grid for top 6.
 */
export default function ResultsSummary({ ranked, best }) {
  if (!best) return null;

  const strat = best.strategy;
  const {
    totalLaps,
    numPitStops,
    effectiveLapsPerTank,
    lapsPerTireSet,
    totalTimeLostSecs,
    estTotalRaceTimeSecs,
  } = strat;

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

  // Top 6 strategies for comparison (if more than 1)
  const topStrategies = ranked.slice(0, 6);

  return (
    <div className="results-summary">
      {hasWarnings && (
        <div className="warning-banner">
          ⚠ Strategy has warnings — check the stint table below
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
      {topStrategies.length > 1 && (
        <div className="strategy-comparison">
          <h3 className="section-heading comparison-title">Strategy Comparison</h3>
          <div className="comparison-grid">
            {topStrategies.map((entry, idx) => {
              const s = entry.strategy;
              const isBest = idx === 0;
              return (
                <div
                  key={entry.label}
                  className={`comparison-card${isBest ? ' comparison-best' : ''}`}
                >
                  {isBest && <span className="best-badge">★ Best</span>}
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
        </div>
      )}
    </div>
  );
}
