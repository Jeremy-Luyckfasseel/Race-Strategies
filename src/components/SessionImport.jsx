/**
 * Session import (session-import branch).
 *
 * Load a session recorded by the recorder (captures/*.json), MEASURE the car model
 * from it (fuel/lap, fuel-weight, per-compound degradation, tyre life) via the
 * shared pure brain (src/logic/sessionAnalysis.js), show it with its data-quality
 * warnings, and — on an explicit click — fold it into the active strategy inputs.
 *
 * Propose-and-accept: nothing is applied until the user clicks Apply, and only the
 * CAR MODEL is touched (race length, drivers, pit timings stay as the user set them
 * — so the existing multi-driver setup keeps working on top of the learned car).
 */

import { useState } from 'react';
import { analyzeCapture } from '../logic/sessionAnalysis';
import { t } from '../i18n/strings';

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export default function SessionImport({ onApply, lang }) {
  const [analysis, setAnalysis] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState(false);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setApplied(false);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const capture = JSON.parse(String(reader.result));
        if (!capture || !Array.isArray(capture.laps) || capture.laps.length === 0) throw new Error('empty');
        setAnalysis(analyzeCapture(capture));
        setFileName(file.name);
      } catch {
        setAnalysis(null);
        setFileName(file.name);
        setError(t('si_error', lang));
      }
    };
    reader.readAsText(file);
  };

  const usable = analysis && (analysis.fuel.value || analysis.compounds.some((c) => c.deg));

  const apply = () => {
    if (!analysis) return;
    onApply(analysis);
    setApplied(true);
  };

  return (
    <div className="session-import">
      <div className="si-head">{t('si_title', lang)}</div>
      <p className="si-hint">{t('si_hint', lang)}</p>

      <label className="si-file">
        <input type="file" accept=".json,application/json" onChange={onFile} />
        <span>{fileName || t('si_choose', lang)}</span>
      </label>

      {error && <div className="si-error">{error}</div>}

      {analysis && !error && (
        <div className="si-summary">
          <div className="si-row">
            <span className="si-label">{t('si_fuel', lang)}</span>
            <span className="si-val">
              {analysis.fuel.value != null ? `${round1(analysis.fuel.value)} L · ${round1(analysis.fuel.lapsPerFullTank)} ${t('si_laps_tank', lang)}` : '—'}
            </span>
          </div>
          <div className="si-row">
            <span className="si-label">{t('si_weight', lang)}</span>
            <span className="si-val">
              {analysis.fuelWeight.identifiable ? `${analysis.fuelWeight.sPerLiter.toFixed(3)} s/L` : t('si_not_separable', lang)}
            </span>
          </div>

          {analysis.compounds.filter((c) => c.deg && c.observed).map((c) => (
            <div className="si-row si-compound" key={c.id}>
              <span className={`si-cmp compound-${c.id}`}>{c.name}</span>
              <span className="si-val si-times">
                {c.observed.start} / {c.observed.half} / {c.observed.end}
                <span className="si-meta">
                  {c.observedLife} {t('si_laps', lang)} ·{' '}
                  <span className={c.confident ? 'si-ok' : 'si-warnish'}>{c.confident ? t('si_confident', lang) : t('si_weak', lang)}</span>
                </span>
              </span>
            </div>
          ))}

          {analysis.warnings.map((w, i) => (
            <div key={i} className={`si-warn si-warn--${w.level}`}>{w.msg}</div>
          ))}

          {usable ? (
            <button className={`si-apply${applied ? ' is-applied' : ''}`} onClick={apply} disabled={applied}>
              {applied ? t('si_applied', lang) : t('si_apply', lang)}
            </button>
          ) : (
            <div className="si-warn si-warn--error">{t('si_no_model', lang)}</div>
          )}
        </div>
      )}
    </div>
  );
}
