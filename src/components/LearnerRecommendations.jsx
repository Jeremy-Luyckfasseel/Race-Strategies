/**
 * Propose-and-accept recommendation cards (Phase 1, Task 1.3).
 *
 * Renders the telemetry learner's confident, meaningfully-different estimates as
 * cards the race engineer accepts or ignores. The manual inputs stay the source of
 * truth — nothing here writes to them except via the parent's onAccept handler on
 * an explicit click (DECISION 7). Each card shows a trust line (sample size +
 * volatility) so the engineer can see how solid the number is before accepting.
 *
 */
import { DEFAULT_LANG, t, compoundName } from '../i18n/strings';

function fmtValue(rec, v) {
  if (rec.kind === 'compound') return v.join(' / ');
  if (rec.kind === 'penalty') return Number(v).toFixed(3);
  return String(v);
}

/**
 * The recommendation's headline, in the user's language. The pure layer carries
 * an English `label` for logs and a `labelKey` for this.
 */
function recLabel(rec, lang) {
  if (!rec.labelKey) return rec.label;
  // `labelVars` carries anything the pure layer cannot localise itself — a
  // driver's name, for the per-driver curves. The compound is always resolved
  // here, never taken from the engine's English TIRE_COMPOUNDS[].name.
  return t(rec.labelKey, lang, {
    ...(rec.labelVars || {}),
    compound: compoundName(rec.compoundId, lang) || rec.compoundId,
  });
}

function TrustLine({ trust, lang }) {
  if (!trust) return null;
  const n = trust.sampleCount ?? 0;
  const vol = trust.volatility != null ? `±${Number(trust.volatility).toFixed(2)}s` : null;
  return (
    <div className="rec-trust">
      <span className="rec-trust-samples">{t('lr_laps', lang, { n })}</span>
      {vol && <span className="rec-trust-vol">{vol}</span>}
      {trust.highlyVolatile && <span className="rec-trust-badge">{t('lr_volatile', lang)}</span>}
    </div>
  );
}

export default function LearnerRecommendations({ recommendations, onAccept, onIgnore, lang = DEFAULT_LANG }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="learner-recs">
      <div className="learner-recs-head">
        <span className="learner-recs-dot" />
        {t('lr_title', lang)}
        <span className="learner-recs-count">{recommendations.length}</span>
      </div>

      {recommendations.map((rec) => (
        <div key={rec.key} className="rec-card">
          <div className="rec-card-main">
            <div className="rec-label">{recLabel(rec, lang)}</div>
            <div className="rec-values">
              <span className="rec-measured">
                {t('lr_measured', lang)} {fmtValue(rec, rec.measured)}
                {rec.unit ? ` ${rec.unit}` : ''}
              </span>
              <span className="rec-vs">{t('lr_vs', lang)}</span>
              <span className="rec-current">
                {t('lr_current', lang)} {fmtValue(rec, rec.current)}
                {rec.unit ? ` ${rec.unit}` : ''}
              </span>
            </div>
            <TrustLine trust={rec.trust} lang={lang} />
          </div>
          <div className="rec-actions">
            <button className="rec-accept" onClick={() => onAccept(rec)}>
              {t('lr_accept', lang)}
            </button>
            <button className="rec-ignore" onClick={() => onIgnore(rec)}>
              {t('lr_ignore', lang)}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
