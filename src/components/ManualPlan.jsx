/**
 * A strategy typed in by hand.
 *
 * The engine only tries compound patterns of up to five elements, and the pit
 * wall may know something the model does not. So the plan is typed as rows —
 * a tyre, how many stints on it, and laps per stint — "Medium ×10 then Soft
 * until the flag" is two rows, not eleven. Drivers are left out on purpose:
 * they are assigned exactly as for the engine's own plans.
 *
 * Laps are the user's, but the engine's own length for that row sits next to
 * the field and one click puts it in. Left empty, the engine sizes the row.
 *
 * The plan is run through the same simulation as the engine's (fuel, tyre
 * model, stop times), compared against the engine's best, and one button makes
 * it the plan the race screen follows.
 */
import { DEFAULT_LANG, t, COMPOUND_ORDER, compoundName } from '../i18n/strings';
import { formatRaceTime } from '../logic/strategy';
import StrategyTimeline from './StrategyTimeline';

const COMPOUND_CLS = { H: 'cp-hard', M: 'cp-med', S: 'cp-soft', IM: 'cp-inter', W: 'cp-wet' };

/** How the typed plan compares with the engine's best, in one line. */
function versus(mine, best, lang) {
  if (!best?.strategy || !mine?.strategy) return null;
  const dl = mine.strategy.totalLaps - best.strategy.totalLaps;
  if (dl > 0) return { cls: 'is-good', text: t('mp_vs_laps_more', lang, { n: dl }) };
  if (dl < 0) return { cls: 'is-bad', text: t('mp_vs_laps_less', lang, { n: -dl }) };
  const dt = mine.strategy.estTotalRaceTimeSecs - best.strategy.estTotalRaceTimeSecs;
  if (Math.abs(dt) < 0.5) return { cls: '', text: t('mp_vs_same', lang) };
  return dt < 0
    ? { cls: 'is-good', text: t('mp_vs_faster', lang, { t: `${(-dt).toFixed(1)}s` }) }
    : { cls: 'is-bad', text: t('mp_vs_slower', lang, { t: `${dt.toFixed(1)}s` }) };
}

export default function ManualPlan({ rows, onRows, result, best, racing, onRacing, lang = DEFAULT_LANG }) {
  const meta = result?.manual ?? null;
  const setRow = (i, patch) => onRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const addRow = () => {
    // The row that was last stops being "until the flag": only the last row
    // can run to the end.
    const prev = rows.map((r, k) => (k === rows.length - 1 && r.stints == null ? { ...r, stints: 1 } : r));
    onRows([...prev, { compoundId: rows[rows.length - 1]?.compoundId ?? 'M', stints: null, laps: null }]);
  };
  const removeRow = (i) => {
    const next = rows.filter((_, k) => k !== i);
    if (next.length === 0 && racing) onRacing(false);
    onRows(next);
  };

  const vs = versus(result, best, lang);

  return (
    <div className="card mp-card">
      <div className="card-header">
        <span className="card-title">{t('mp_title', lang)}</span>
        {racing && result?.strategy && <span className="mp-racing-pill">{t('mp_racing', lang)}</span>}
      </div>
      <p className="mp-intro">{t('mp_intro', lang)}</p>

      {rows.length > 0 && (
        <div className="mp-rows">
          <div className="mp-row mp-row--head">
            <span>{t('mp_tyre', lang)}</span>
            <span>{t('mp_stints', lang)}</span>
            <span>{t('mp_laps', lang)}</span>
            <span />
          </div>
          {rows.map((r, i) => {
            const m = meta?.rows?.[i];
            const last = i === rows.length - 1;
            return (
              <div key={i} className={`mp-row${m && !m.reached && !m.invalid ? ' is-unreached' : ''}`}>
                <div className="mp-tyres">
                  {COMPOUND_ORDER.map((id) => (
                    <button
                      key={id}
                      className={`ld-cp-btn ${COMPOUND_CLS[id]}${r.compoundId === id ? ' active' : ''}`}
                      title={compoundName(id, lang)}
                      onClick={() => setRow(i, { compoundId: id })}
                    >
                      {id}
                    </button>
                  ))}
                </div>

                <div className="mp-stints">
                  {r.stints == null ? (
                    <span className="mp-flag">{t('mp_until_flag', lang)}</span>
                  ) : (
                    <input
                      type="number" min="1" className="mp-input"
                      value={r.stints}
                      aria-label={t('mp_stints', lang)}
                      onChange={(e) => setRow(i, { stints: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                    />
                  )}
                  {last && (
                    <label className="mp-flag-toggle">
                      <input
                        type="checkbox"
                        checked={r.stints == null}
                        onChange={(e) => setRow(i, { stints: e.target.checked ? null : 1 })}
                      />
                      {t('mp_until_flag_short', lang)}
                    </label>
                  )}
                </div>

                <div className="mp-laps">
                  <input
                    type="number" min="1" className="mp-input"
                    value={r.laps ?? ''}
                    placeholder="—"
                    aria-label={t('mp_laps', lang)}
                    onChange={(e) => {
                      const n = Math.floor(Number(e.target.value));
                      setRow(i, { laps: n > 0 ? n : null });
                    }}
                  />
                  {m?.engineLaps != null && m.engineLaps !== r.laps && (
                    <button
                      className="mp-engine"
                      title={t('mp_engine_title', lang)}
                      onClick={() => setRow(i, { laps: m.engineLaps })}
                    >
                      {t('mp_engine', lang, { n: m.engineLaps })}
                    </button>
                  )}
                </div>

                <button className="mp-remove" title={t('mp_remove', lang)} onClick={() => removeRow(i)}>×</button>

                {m?.invalid && <div className="mp-note is-bad">{t('mp_invalid', lang)}</div>}
                {m && !m.reached && !m.invalid && <div className="mp-note">{t('mp_unreached', lang)}</div>}
              </div>
            );
          })}
        </div>
      )}

      <button className="mp-add" onClick={addRow}>{t('mp_add', lang)}</button>

      {result?.strategy && (
        <div className="mp-result">
          <div className="mp-summary">
            <span className="mp-total">
              {t('mp_result', lang, {
                laps: result.strategy.totalLaps,
                time: formatRaceTime(result.strategy.estTotalRaceTimeSecs),
              })}
            </span>
            {vs && <span className={`mp-vs ${vs.cls}`}>{vs.text}</span>}
          </div>

          {meta.beyondPlan && (
            <div className="mp-note is-warn">
              {t('mp_beyond', lang, { planned: meta.plannedStints, race: meta.raceStints })}
            </div>
          )}
          {meta.cutShort.map((c) => (
            <div key={c.stintNum} className="mp-note is-warn">
              {t('mp_cut', lang, { n: c.stintNum, asked: c.asked, got: c.got })}
            </div>
          ))}

          <StrategyTimeline stints={result.strategy.stints} totalLaps={result.strategy.totalLaps} lang={lang} />

          <div className="mp-actions">
            {racing ? (
              <button className="mp-back" onClick={() => onRacing(false)}>{t('mp_back', lang)}</button>
            ) : (
              <button className="mp-race" onClick={() => onRacing(true)}>{t('mp_race', lang)}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
