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

export default function DriversTab({ logs, drivers, minDriverTimeSecs, activeIp, onReset }) {
  const entry = activeIp ? logs.get(activeIp) : null;
  const stints = entry
    ? [
        ...entry.history,
        ...(entry.current
          ? [{
              ...entry.current,
              endLap: null,
              durationSecs: null,
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
  const multiDriver = (drivers || []).length > 1;

  return (
    <div className="results-summary">
      {multiDriver && (
        <div className="driver-summary" aria-label="Driver time summary">
          {drivers.map((d) => {
            const total = driverTotals.get(d.id) || 0;
            const metMinimum = !(minDriverTimeSecs > 0) || total >= minDriverTimeSecs;
            return (
              <div key={d.id} className={`driver-chip${metMinimum ? '' : ' driver-chip-warn'}`}>
                <span className="driver-chip-name">{d.name}</span>
                <span className="driver-chip-time">{formatDriveTime(total)}</span>
                {!metMinimum && <span className="driver-chip-flag">min non atteint</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Journal des Relais</span>
          <button className="btn-header-ghost" onClick={onReset}>Réinitialiser</button>
        </div>

        {!activeIp ? (
          <p className="empty-text">Sélectionnez une équipe dans l'onglet Télémétrie.</p>
        ) : stints.length === 0 ? (
          <p className="empty-text">Aucun relais enregistré pour l'instant.</p>
        ) : (
          <div className="table-scroll">
            <table className="stint-table" aria-label="Driver stint log">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pilote</th>
                  <th>Composé</th>
                  <th>Tours</th>
                  <th>Durée</th>
                  <th>Tour Moy.</th>
                  <th>Meilleur</th>
                  <th>Pire</th>
                </tr>
              </thead>
              <tbody>
                {stints.map((st, i) => (
                  <tr key={i}>
                    <td className="stint-num">{i + 1}{st.live && ' (en cours)'}</td>
                    <td className="driver-cell">{driverName(st.driverId)}</td>
                    <td>
                      {st.compound
                        ? <span className={`compound-tag compound-${st.compound}`}>{st.compound}</span>
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
