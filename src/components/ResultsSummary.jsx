import { useState } from "react";
import { formatRaceTime } from "../logic/strategy";

function formatDriveTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const INITIAL_SHOW = 6;

/* Proportional tyre stint bar — the key differentiator vs. pill badges */
function StintBar({ stints }) {
  if (!stints || !stints.length) return null;
  const total = stints.reduce((s, st) => s + st.lapsInStint, 0);
  if (total === 0) return null;
  return (
    <div
      className="stint-bar"
      role="img"
      aria-label={`Tyre sequence: ${stints.map((s) => s.compound).join(" › ")}`}
    >
      {stints.map((st, i) => {
        const pct = st.lapsInStint / total;
        return (
          <div
            key={i}
            className={`stint-bar-seg cmpd-fill-${st.compound}`}
            style={{ flex: st.lapsInStint }}
            title={`${st.compoundName || st.compound}: ${st.lapsInStint} laps`}
          >
            {pct > 0.13 && (
              <span className="stint-bar-label">{st.compound}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
  const hasWarnings = strat.stints.some((s) => s.warning);

  const kpiCards = [
    { label: "Tours Course",    value: totalLaps,              unit: "tours" },
    { label: "Arrêts Pit",     value: numPitStops,            unit: "arrêts" },
    { label: "Temps Est.",     value: formatRaceTime(estTotalRaceTimeSecs), unit: "" },
    { label: "Temps aux Stands", value: totalTimeLostMins,    unit: "min" },
    { label: "Tours Carburant", value: effectiveLapsPerTank,  unit: "tours" },
    { label: "Tours Pneus",    value: lapsPerTireSet,         unit: "tours" },
  ];

  const visibleStrategies = showAll ? ranked : ranked.slice(0, INITIAL_SHOW);

  return (
    <div className="results-summary">
      {hasWarnings && (
        <div className="warning-banner" role="alert">
          La stratégie a des avertissements — vérifiez le tableau des relais
        </div>
      )}

      {multiDriver && (
        <div className="driver-summary" aria-label="Driver time summary">
          {driverSummary.map((d) => (
            <div key={d.id} className={`driver-chip${d.metMinimum ? "" : " driver-chip-warn"}`}>
              <span className="driver-chip-name">{d.name}</span>
              <span className="driver-chip-time">{formatDriveTime(d.totalTimeSecs)}</span>
              {!d.metMinimum && (
                <span className="driver-chip-flag">min non atteint</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* KPI Strip */}
      <div className="kpi-grid" role="region" aria-label="Key strategy metrics">
        {kpiCards.map((card) => (
          <div className="kpi-card" key={card.label}>
            <div className="kpi-value">
              {card.value}
              {card.unit && <span className="kpi-unit">{card.unit}</span>}
            </div>
            <div className="kpi-label">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Strategy Alternatives */}
      {ranked.length > 1 && (
        <div className="strategy-comparison">
          <div className="comparison-heading">Alternatives de Stratégie</div>
          <div className="comparison-grid">
            {visibleStrategies.map((entry, idx) => {
              const s = entry.strategy;
              const isBest = idx === 0;
              const lapDelta = s.totalLaps - best.strategy.totalLaps;
              const timeDeltaSecs = s.estTotalRaceTimeSecs - best.strategy.estTotalRaceTimeSecs;
              return (
                <div
                  key={`${entry.label}-${idx}`}
                  className={`comparison-card${idx === selectedIndex ? " comparison-selected" : ""}`}
                  onClick={() => onSelect(idx)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={idx === selectedIndex}
                  aria-label={`Strategy ${idx + 1}: ${entry.label}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(idx); }
                  }}
                >
                  {/* Proportional tyre strip across the top */}
                  <StintBar stints={s.stints} />

                  {/* Card body */}
                  <div className="comparison-card-body">
                    <div>
                      {isBest
                        ? <span className="best-badge">Meilleure</span>
                        : <span className="delta-badge">
                            {lapDelta !== 0
                              ? `${lapDelta > 0 ? "+" : ""}${lapDelta} tours`
                              : `+${timeDeltaSecs.toFixed(0)}s`}
                          </span>}
                    </div>

                    <div className="comparison-compound">
                      {entry.compoundIds.map((id, i) => (
                        <span key={i} className={`compound-pill compound-${id}`}>{id}</span>
                      ))}
                    </div>

                    <div className="comparison-label">{entry.label}</div>

                    <div className="comparison-stats">
                      <div><span className="stat-val">{s.numPitStops}</span> arrêts</div>
                      <div><span className="stat-val">{(s.totalTimeLostSecs / 60).toFixed(1)}</span> min perdues</div>
                      <div><span className="stat-val">{formatRaceTime(s.estTotalRaceTimeSecs)}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {ranked.length > INITIAL_SHOW && (
            <button
              className="btn-ghost show-more-btn"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? `Afficher top ${INITIAL_SHOW}` : `Afficher toutes les ${ranked.length} stratégies`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
