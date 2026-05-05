import { useState, useEffect } from 'react';

export default function TelemetryControls({
  telem,
  ps5IPs, onSavePS5IPs,
  telemUrl, setTelemUrl,
  teamLabels, onTeamLabelChange,
}) {
  const [open, setOpen] = useState(true);
  const addIP    = () => onSavePS5IPs([...ps5IPs, '']);
  const removeIP = (i) => onSavePS5IPs(ps5IPs.filter((_, j) => j !== i));
  const updateIP = (i, v) => onSavePS5IPs(ps5IPs.map((ip, j) => j === i ? v : ip));

  // Auto-add IPs found by scan so heartbeats keep flowing without a manual click
  useEffect(() => {
    if (!telem.scanResults?.length || !telem.connected) return;
    const existing = new Set(ps5IPs.map(ip => ip.trim()).filter(Boolean));
    const newIPs = telem.scanResults.map(r => r.ip).filter(ip => !existing.has(ip));
    if (!newIPs.length) return;
    const merged = [...existing, ...newIPs];
    onSavePS5IPs(merged);
    telem.scanResults.forEach(({ ip, hostname }) => {
      if (hostname && !teamLabels[ip]) onTeamLabelChange?.(ip, hostname);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telem.scanResults]);

  return (
    <div className="tc-panel">
      <div className="tc-collapse-bar">
        <span className="tc-collapse-title">
          CONNEXIONS
          {telem.connected && <span className="tc-live-badge">● EN DIRECT</span>}
        </span>
        <button className="tc-collapse-btn" onClick={() => setOpen(o => !o)}>
          {open ? '▲ Masquer' : '▼ Afficher'}
        </button>
      </div>
      {open && (
        <>
          <div className="tc-row">

            {/* ── Connection ── */}
            <div className="tc-group">
              <span className="tc-label">SERVEUR</span>
              <div className="tc-input-row">
                <input
                  className="tc-url-input"
                  type="text"
                  value={telemUrl}
                  onChange={(e) => setTelemUrl(e.target.value)}
                  disabled={telem.connected}
                  spellCheck={false}
                />
                {telem.connected ? (
                  <button className="btn-secondary tc-btn" onClick={telem.disconnect}>Déconnecter</button>
                ) : (
                  <button
                    className="btn-secondary tc-btn"
                    onClick={() => telem.connect(telemUrl, ps5IPs.map(ip => ip.trim()).filter(Boolean))}
                  >
                    Connecter
                  </button>
                )}
              </div>
              {!telem.connected && (
                <p className="tc-hint">Lancez d'abord <code>node server/telemetry-server.js</code></p>
              )}
            </div>

            {/* ── PS5 IPs ── */}
            <div className="tc-group">
              <span className="tc-label">PS5 IPs</span>
              <div className="tc-ip-list">
                {ps5IPs.map((ip, idx) => (
                  <div key={idx} className="tc-ip-row">
                    <input
                      type="text"
                      className="tc-ip-input"
                      value={ip}
                      onChange={(e) => updateIP(idx, e.target.value)}
                      placeholder="192.168.1.10"
                      spellCheck={false}
                    />
                    {ps5IPs.length > 1 && (
                      <button className="tc-ip-remove" onClick={() => removeIP(idx)} title="Supprimer">×</button>
                    )}
                  </div>
                ))}
                <button className="btn-ghost tc-add-btn" onClick={addIP}>+ Ajouter PS5</button>
              </div>
            </div>

            {/* ── Scan ── */}
            <div className="tc-group">
              <span className="tc-label">DÉTECTION</span>
              <button
                className="btn-secondary tc-btn tc-scan-btn"
                onClick={telem.connected ? telem.scan : undefined}
                disabled={!telem.connected || telem.scanning}
                title={!telem.connected ? 'Connectez le serveur d\'abord' : 'Scanner le réseau local pour les PS5'}
              >
                {telem.scanning ? 'Scan en cours…' : '⟳ Scanner Réseau'}
              </button>
              {!telem.connected && (
                <p className="tc-hint">Connectez le serveur d&apos;abord</p>
              )}
            </div>

          </div>

          {/* ── Scan results ── */}
          {telem.scanResults?.length > 0 && (
            <div className="tc-scan-results">
              <span className="tc-scan-label">
                {telem.scanResults.length} PS5{telem.scanResults.length > 1 ? 's' : ''} trouvée{telem.scanResults.length > 1 ? 's' : ''} — ajoutées automatiquement
              </span>
              {telem.scanResults.map(({ ip, hostname }) => (
                <span key={ip} className="tc-scan-result-tag">
                  {hostname ? <><strong>{hostname}</strong><span className="tc-scan-ip">{ip}</span></> : ip}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
