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

/**
 * One proposal on one line, for the car panel.
 *
 * The full cards were 135px for a single proposal, and the car panel has about
 * a third of that left under the tyre temperatures — so on the pit wall they
 * pushed the panel into a scroll, which is the one thing that screen must not
 * do. Here it is the first proposal only, with how many are waiting: accepting
 * or ignoring it brings up the next, so the slot is one row however many there
 * are. The sample count stays on the line — it is how you judge the number —
 * and the full cards are still on the Stratégie tab.
 */
function CompactRecs({ recommendations, onAccept, onIgnore, lang }) {
  const rec = recommendations[0];
  const n = recommendations.length;
  const unit = rec.unit ? ` ${rec.unit}` : '';
  const samples = rec.trust?.sampleCount;
  return (
    <div className="learner-recs learner-recs--compact">
      <span className="learner-recs-dot" />
      <span className="rec-c-label">{recLabel(rec, lang)}</span>
      <span className="rec-c-values">
        <span className="rec-measured">{fmtValue(rec, rec.measured)}{unit}</span>
        <span className="rec-vs">{t('lr_vs', lang)}</span>
        <span className="rec-current">{fmtValue(rec, rec.current)}{unit}</span>
        {samples != null && <span className="rec-c-dim">{t('lr_laps', lang, { n: samples })}</span>}
        {rec.trust?.highlyVolatile && <span className="rec-trust-badge">{t('lr_volatile', lang)}</span>}
      </span>
      {n > 1 && <span className="rec-c-dim rec-c-count">{t('lr_more', lang, { i: 1, n })}</span>}
      <span className="rec-c-actions">
        <button className="rec-accept" onClick={() => onAccept(rec)}>{t('lr_accept', lang)}</button>
        <button className="rec-ignore" onClick={() => onIgnore(rec)}>{t('lr_ignore', lang)}</button>
      </span>
    </div>
  );
}

export default function LearnerRecommendations({ recommendations, onAccept, onIgnore, compact = false, lang = DEFAULT_LANG }) {
  if (!recommendations || recommendations.length === 0) return null;
  if (compact) {
    return <CompactRecs recommendations={recommendations} onAccept={onAccept} onIgnore={onIgnore} lang={lang} />;
  }

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
