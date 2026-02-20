/**
 * ResultsSummary — top-level KPI cards for the strategy output.
 */
export default function ResultsSummary({ strategy, pitTimeLoss }) {
  if (!strategy) return null;

  const {
    totalLaps,
    numPitStops,
    lapsPerTank,
    lapsPerTireSet,
    recommendedCompound,
    totalTimeLostSecs,
  } = strategy;

  const totalTimeLostMins = (totalTimeLostSecs / 60).toFixed(1);

  const cards = [
    { label: 'Total Race Laps',      value: totalLaps,           unit: 'laps' },
    { label: 'Pit Stops',            value: numPitStops,         unit: 'stops' },
    { label: 'Fuel Laps per Stint',  value: lapsPerTank,         unit: 'laps' },
    { label: 'Tyre Laps per Set',    value: lapsPerTireSet,      unit: 'laps' },
    { label: 'Total Pit Time Lost',  value: totalTimeLostMins,   unit: 'min' },
    { label: 'Compound',             value: recommendedCompound, unit: '' },
  ];

  const hasWarnings = strategy.stints.some(s => s.warning);

  return (
    <div className="results-summary">
      {hasWarnings && (
        <div className="warning-banner">
          ⚠ Strategy has warnings — check the stint table below
        </div>
      )}
      <div className="kpi-grid">
        {cards.map(card => (
          <div className="kpi-card" key={card.label}>
            <span className="kpi-value">{card.value}</span>
            {card.unit && <span className="kpi-unit"> {card.unit}</span>}
            <span className="kpi-label">{card.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
