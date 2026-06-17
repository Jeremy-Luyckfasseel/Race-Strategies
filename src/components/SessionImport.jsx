/**
 * Session import (session-import branch).
 *
 * Load one OR MORE sessions recorded by the recorder (captures/*.json). Each file
 * is one driver — for a team, every driver records on their own PS5 at home and the
 * strategist drops all the files in here at once. Files self-identify their driver
 * (recorder --driver), and the name stays editable. The measured car model + each
 * driver's pace are derived via the shared pure brain (src/logic/sessionAnalysis.js)
 * and, on an explicit Apply, folded into the strategy:
 *   - 1 file  → fill the car model, keep your driver setup
 *   - 2+ files → build the team: per-driver pace into the engine's per-driver model
 * Nothing is typed by hand and nothing is applied until you click Apply.
 */

import { useRef, useState } from 'react';
import { analyzeCapture } from '../logic/sessionAnalysis';
import { t } from '../i18n/strings';

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export default function SessionImport({ onApply, lang }) {
  const [sessions, setSessions] = useState([]); // [{ id, fileName, driver, analysis, error }]
  const [applied, setApplied] = useState(false);
  const idRef = useRef(0);

  function readOne(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const id = ++idRef.current;
        try {
          const cap = JSON.parse(String(reader.result));
          if (!cap || !Array.isArray(cap.laps) || cap.laps.length === 0) throw new Error('empty');
          const analysis = analyzeCapture(cap);
          const driver = analysis.meta?.driver || analysis.meta?.team || file.name.replace(/\.json$/i, '');
          resolve({ id, fileName: file.name, driver, analysis });
        } catch {
          resolve({ id, fileName: file.name, error: true });
        }
      };
      reader.readAsText(file);
    });
  }

  const onFiles = (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setApplied(false);
    Promise.all(files.map(readOne)).then((loaded) => setSessions((prev) => [...prev, ...loaded]));
    e.target.value = ''; // allow re-selecting the same file
  };

  const setDriver = (id, name) => setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, driver: name } : s)));
  const remove = (id) => setSessions((prev) => prev.filter((s) => s.id !== id));

  const valid = sessions.filter((s) => !s.error && (s.analysis.fuel.value || s.analysis.compounds.some((c) => c.deg)));

  const apply = () => {
    if (!valid.length) return;
    onApply(valid.map((s) => ({ driver: s.driver, analysis: s.analysis })));
    setApplied(true);
  };

  return (
    <div className="session-import">
      <div className="si-head">{t('si_title', lang)}</div>
      <p className="si-hint">{t('si_hint', lang)}</p>

      <label className="si-file">
        <input type="file" accept=".json,application/json" multiple onChange={onFiles} />
        <span>{t('si_choose', lang)}</span>
      </label>

      {sessions.length > 0 && (
        <div className="si-summary">
          {sessions.map((s) => (
            <div key={s.id} className={`si-session${s.error ? ' si-session--error' : ''}`}>
              <div className="si-session-top">
                {s.error ? (
                  <span className="si-error">{t('si_error', lang)} — {s.fileName}</span>
                ) : (
                  <input
                    className="si-driver-name"
                    value={s.driver}
                    onChange={(e) => setDriver(s.id, e.target.value)}
                    aria-label={t('si_driver', lang)}
                  />
                )}
                <button className="si-remove" onClick={() => remove(s.id)} title={t('si_remove', lang)}>
                  ×
                </button>
              </div>

              {!s.error && (
                <>
                  <div className="si-session-line">
                    {s.analysis.fuel.value != null
                      ? `${round1(s.analysis.fuel.value)} L · ${round1(s.analysis.fuel.lapsPerFullTank)} ${t('si_laps_tank', lang)}`
                      : '—'}
                    {s.analysis.fuelWeight.identifiable ? ` · ${s.analysis.fuelWeight.sPerLiter.toFixed(3)} s/L` : ''}
                  </div>
                  {s.analysis.compounds.filter((c) => c.deg && c.observed).map((c) => (
                    <div className="si-session-line si-compound" key={c.id}>
                      <span className={`si-cmp compound-${c.id}`}>{c.name}</span>
                      <span className="si-times">
                        {c.observed.start} / {c.observed.half} / {c.observed.end}
                        <span className="si-meta">
                          {c.observedLife} {t('si_laps', lang)} ·{' '}
                          <span className={c.confident ? 'si-ok' : 'si-warnish'}>{c.confident ? t('si_confident', lang) : t('si_weak', lang)}</span>
                        </span>
                      </span>
                    </div>
                  ))}
                  {s.analysis.warnings.map((w, i) => (
                    <div key={i} className={`si-warn si-warn--${w.level}`}>{w.msg}</div>
                  ))}
                </>
              )}
            </div>
          ))}

          {valid.length > 0 ? (
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
