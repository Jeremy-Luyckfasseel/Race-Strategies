import { useState } from "react";
import { formatRaceTime } from "../logic/strategy";
import { DEFAULT_LANG, t, compoundName, compoundSequence } from "../i18n/strings";

function formatDriveTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

const INITIAL_SHOW = 6;

/**
 * The compound sequence, in the user's language. The engine's own `label` stays
 * English (logs, tests); `sequenceIds` is the same sequence as ids, so the
 * display name is looked up here rather than baked in upstream.
 */
const planLabel = (entry, lang) =>
  entry.sequenceIds ? compoundSequence(entry.sequenceIds, lang) : entry.label;

/* Proportional tyre stint bar — the key differentiator vs. pill badges */
function StintBar({ stints, lang }) {
  if (!stints || !stints.length) return null;
  const total = stints.reduce((s, st) => s + st.lapsInStint, 0);
  if (total === 0) return null;
  return (
    <div
      className="stint-bar"
      role="img"
      aria-label={t("aria_tyre_sequence", lang, { seq: stints.map((s) => s.compound).join(" › ") })}
    >
      {stints.map((st, i) => {
        const pct = st.lapsInStint / total;
        return (
          <div
            key={i}
            className={`stint-bar-seg cmpd-fill-${st.compound}`}
            style={{ flex: st.lapsInStint }}
            title={t("rs_stint_bar_title", lang, {
              compound: compoundName(st.compound, lang) || st.compound,
              n: st.lapsInStint,
            })}
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

export default function ResultsSummary({ ranked, best, selectedIndex, onSelect, lang = DEFAULT_LANG }) {
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
    { label: t("rs_kpi_laps", lang),     value: totalLaps,             unit: t("rs_unit_laps", lang) },
    { label: t("rs_kpi_stops", lang),    value: numPitStops,           unit: t("rs_unit_stops", lang) },
    { label: t("rs_kpi_time", lang),     value: formatRaceTime(estTotalRaceTimeSecs), unit: "" },
    { label: t("rs_kpi_pit_time", lang), value: totalTimeLostMins,     unit: t("rs_unit_min", lang) },
    { label: t("rs_kpi_fuel_laps", lang), value: effectiveLapsPerTank, unit: t("rs_unit_laps", lang) },
    { label: t("rs_kpi_tyre_laps", lang), value: lapsPerTireSet,       unit: t("rs_unit_laps", lang) },
  ];

  const visibleStrategies = showAll ? ranked : ranked.slice(0, INITIAL_SHOW);

  return (
    <div className="results-summary">
      {hasWarnings && (
        <div className="warning-banner" role="alert">
          {t("rs_warning", lang)}
        </div>
      )}

      {multiDriver && (
        <div className="driver-summary" aria-label={t("aria_driver_times", lang)}>
          {driverSummary.map((d) => (
            <div key={d.id} className={`driver-chip${d.metMinimum ? "" : " driver-chip-warn"}`}>
              <span className="driver-chip-name">{d.name}</span>
              <span className="driver-chip-time">{formatDriveTime(d.totalTimeSecs)}</span>
              {!d.metMinimum && (
                <span className="driver-chip-flag">{t("rs_min_not_met", lang)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* KPI Strip */}
      <div className="kpi-grid" role="region" aria-label={t("aria_kpis", lang)}>
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
          <div className="comparison-heading">{t("rs_alternatives", lang)}</div>
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
                  aria-label={t("aria_strategy_n", lang, { n: idx + 1, label: planLabel(entry, lang) })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(idx); }
                  }}
                >
                  {/* Proportional tyre strip across the top */}
                  <StintBar stints={s.stints} lang={lang} />

                  {/* Card body */}
                  <div className="comparison-card-body">
                    <div>
                      {isBest
                        ? <span className="best-badge">{t("rs_best", lang)}</span>
                        : <span className="delta-badge">
                            {lapDelta !== 0
                              ? `${lapDelta > 0 ? "+" : ""}${lapDelta} ${t("rs_unit_laps", lang)}`
                              : `+${timeDeltaSecs.toFixed(0)}s`}
                          </span>}
                    </div>

                    <div className="comparison-compound">
                      {entry.compoundIds.map((id, i) => (
                        <span key={i} className={`compound-pill compound-${id}`}>{id}</span>
                      ))}
                    </div>

                    <div className="comparison-label">{planLabel(entry, lang)}</div>

                    <div className="comparison-stats">
                      <div><span className="stat-val">{s.numPitStops}</span> {t("rs_stops", lang)}</div>
                      <div><span className="stat-val">{(s.totalTimeLostSecs / 60).toFixed(1)}</span> {t("rs_min_lost", lang)}</div>
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
              {showAll
                ? t("rs_show_top", lang, { n: INITIAL_SHOW })
                : t("rs_show_all", lang, { n: ranked.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
