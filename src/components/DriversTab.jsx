import { useEffect, useState } from 'react';
import { DEFAULT_LANG, t, compoundName } from '../i18n/strings';
import { tyreHistory } from '../logic/tyreHistory';

function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

function formatDriveTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatDuration(secs) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

export default function DriversTab({ logs, drivers, minDriverTimeSecs, activeIp, onReset, onGoToTelemetry, currentLap = null, lang = DEFAULT_LANG }) {
  // Ticks once a second so the in-progress stint's elapsed time counts toward
  // its driver's total (and the "min not met" flag) instead of freezing at
  // zero for the whole stint. Date.now() is only ever read inside this effect,
  // never during render, so the component stays pure.
  const [now, setNow] = useState(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const entry = activeIp ? logs.get(activeIp) : null;
  const stints = entry
    ? [
        ...entry.history,
        ...(entry.current
          ? [{
              ...entry.current,
              endLap: null,
              durationSecs: now != null ? (now - entry.current.startTime) / 1000 : null,
              avgLapMs: entry.current.lapCount > 0 ? entry.current.lapMsSum / entry.current.lapCount : null,
              live: true,
            }]
          : []),
      ]
    : [];

  const driverTotals = new Map((drivers || []).map((d) => [d.id, 0]));
  for (const st of stints) {
    if (st.driverId != null && st.durationSecs != null) {
      driverTotals.set(st.driverId, (driverTotals.get(st.driverId) || 0) + st.durationSecs);
    }
  }
  const driverName = (id) => (drivers || []).find((d) => d.id === id)?.name || '—';
  const tyres = [...tyreHistory(entry, currentLap).entries()];
  const multiDriver = (drivers || []).length > 1;

  return (
    <div className="results-summary">
      {multiDriver && (
        <div className="driver-summary" aria-label={t('aria_driver_times', lang)}>
          {drivers.map((d) => {
            const total = driverTotals.get(d.id) || 0;
            const metMinimum = !(minDriverTimeSecs > 0) || total >= minDriverTimeSecs;
            return (
              <div key={d.id} className={`driver-chip${metMinimum ? '' : ' driver-chip-warn'}`}>
                <span className="driver-chip-name">{d.name}</span>
                <span className="driver-chip-time">{formatDriveTime(total)}</span>
                {!metMinimum && <span className="driver-chip-flag">{t('rs_min_not_met', lang)}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* What each compound has actually given this car, read back out of the
          same log the table below is built from. */}
      {activeIp && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">{t('dt_tyres_title', lang)}</span>
          </div>
          {tyres.length === 0 ? (
            <p className="empty-text" style={{ padding: '14px 16px' }}>{t('dt_tyres_empty', lang)}</p>
          ) : (
            <div className="table-scroll">
              <table className="tyre-table" aria-label={t('dt_tyres_title', lang)}>
                <thead>
                  <tr>
                    <th>{t('st_compound', lang)}</th>
                    <th>{t('dt_tyre_sets', lang)}</th>
                    <th>{t('dt_tyre_laps', lang)}</th>
                    <th>{t('dt_tyre_typical', lang)}</th>
                    <th>{t('dt_tyre_best', lang)}</th>
                    <th>{t('dt_tyre_falloff', lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {tyres.map(([id, rec]) => (
                    <tr key={id}>
                      <td>
                        <span className={`compound-tag compound-${id}`} title={compoundName(id, lang)}>{id}</span>
                      </td>
                      <td>{rec.completed}</td>
                      <td>
                        {rec.laps.length ? rec.laps.join(', ') : '—'}
                        {rec.liveLaps != null && (
                          <span className="tyre-live"> +{rec.liveLaps} {t('dt_tyre_running', lang)}</span>
                        )}
                      </td>
                      <td>{rec.typicalLaps ?? '—'}</td>
                      <td className="avg-lap-cell">{formatMs(rec.bestMs)}</td>
                      <td>
                        {rec.falloffMs == null
                          ? '—'
                          : `${rec.falloffMs > 0 ? '+' : ''}${(rec.falloffMs / 1000).toFixed(1)}s`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">{t('dt_title', lang)}</span>
          {stints.length > 0 && (
            <button className="btn-header-ghost" onClick={onReset}>{t('dt_reset', lang)}</button>
          )}
        </div>

        {!activeIp ? (
          <div className="empty-action">
            <p className="empty-text">{t('dt_no_team', lang)}</p>
            {onGoToTelemetry && (
              <button className="btn-secondary" onClick={onGoToTelemetry}>
                {/* Named off the tab's own key so the button and the tab can
                    never drift apart, in any language. */}
                {t('dt_go_telemetry', lang, { tab: t('now_tab', lang) })}
              </button>
            )}
          </div>
        ) : stints.length === 0 ? (
          <p className="empty-text">{t('dt_empty', lang)}</p>
        ) : (
          <div className="table-scroll">
            <table className="stint-table" aria-label={t('aria_stint_log', lang)}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('st_driver', lang)}</th>
                  <th>{t('st_compound', lang)}</th>
                  <th>{t('st_laps', lang)}</th>
                  <th>{t('dt_duration', lang)}</th>
                  <th>{t('st_avg_lap', lang)}</th>
                  <th>{t('dt_best', lang)}</th>
                  <th>{t('dt_worst', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {stints.map((st, i) => (
                  <tr key={i}>
                    <td className="stint-num">{i + 1}{st.live && t('dt_live', lang)}</td>
                    <td className="driver-cell">{driverName(st.driverId)}</td>
                    <td>
                      {st.compound
                        ? (
                          <span
                            className={`compound-tag compound-${st.compound}`}
                            title={compoundName(st.compound, lang)}
                          >
                            {st.compound}
                          </span>
                        )
                        : '—'}
                    </td>
                    <td>{st.startLap}{st.endLap ? `–${st.endLap}` : '+'}</td>
                    <td>{formatDuration(st.durationSecs)}</td>
                    <td className="avg-lap-cell">{formatMs(st.avgLapMs)}</td>
                    <td>{formatMs(st.bestLapMs)}</td>
                    <td>{formatMs(st.worstLapMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
