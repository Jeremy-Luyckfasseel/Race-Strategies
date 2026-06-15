/**
 * Propose-and-accept recommendation cards (Phase 1, Task 1.3).
 *
 * Renders the telemetry learner's confident, meaningfully-different estimates as
 * cards the race engineer accepts or ignores. The manual inputs stay the source of
 * truth — nothing here writes to them except via the parent's onAccept handler on
 * an explicit click (DECISION 7). Each card shows a trust line (sample size +
 * volatility) so the engineer can see how solid the number is before accepting.
 *
 * Strings are French to match the current app (i18n extraction is a later task).
 */

function fmtValue(rec, v) {
  if (rec.kind === 'compound') return v.join(' / ');
  if (rec.kind === 'penalty') return Number(v).toFixed(3);
  return String(v);
}

function TrustLine({ trust }) {
  if (!trust) return null;
  const n = trust.sampleCount ?? 0;
  const vol = trust.volatility != null ? `±${Number(trust.volatility).toFixed(2)}s` : null;
  return (
    <div className="rec-trust">
      <span className="rec-trust-samples">{n} tours</span>
      {vol && <span className="rec-trust-vol">{vol}</span>}
      {trust.highlyVolatile && <span className="rec-trust-badge">TRÈS VARIABLE</span>}
    </div>
  );
}

export default function LearnerRecommendations({ recommendations, onAccept, onIgnore }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="learner-recs">
      <div className="learner-recs-head">
        <span className="learner-recs-dot" />
        Recommandations télémétrie
        <span className="learner-recs-count">{recommendations.length}</span>
      </div>

      {recommendations.map((rec) => (
        <div key={rec.key} className="rec-card">
          <div className="rec-card-main">
            <div className="rec-label">{rec.label}</div>
            <div className="rec-values">
              <span className="rec-measured">
                mesuré {fmtValue(rec, rec.measured)}
                {rec.unit ? ` ${rec.unit}` : ''}
              </span>
              <span className="rec-vs">vs</span>
              <span className="rec-current">
                actuel {fmtValue(rec, rec.current)}
                {rec.unit ? ` ${rec.unit}` : ''}
              </span>
            </div>
            <TrustLine trust={rec.trust} />
          </div>
          <div className="rec-actions">
            <button className="rec-accept" onClick={() => onAccept(rec)}>
              Accepter
            </button>
            <button className="rec-ignore" onClick={() => onIgnore(rec)}>
              Ignorer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
