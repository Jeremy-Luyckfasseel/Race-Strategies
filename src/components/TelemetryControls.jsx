import { useState, useEffect, useRef } from 'react';
import { DEFAULT_LANG, t } from '../i18n/strings';

export default function TelemetryControls({
  telem,
  ps5IPs, onSavePS5IPs,
  telemUrl, setTelemUrl,
  teamLabels, onTeamLabelChange,
  lang = DEFAULT_LANG,
}) {
  // Open until the relay is up and a car is streaming, then out of the way:
  // this is needed once, before the race, and it was costing a scroll every
  // time anyone wanted to see the whole track map.
  const [open, setOpen] = useState(true);
  const settled = telem.connected && telem.teams?.size > 0;
  const collapsedOnce = useRef(false);
  useEffect(() => {
    if (settled && !collapsedOnce.current) {
      collapsedOnce.current = true;
      setOpen(false);
    }
  }, [settled]);
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
          {t('tc_connections', lang)}
          {telem.connected && <span className="tc-live-badge">{t('tc_live', lang)}</span>}
        </span>
        <button className="tc-collapse-btn" onClick={() => setOpen(o => !o)}>
          {open ? t('tc_hide', lang) : t('tc_show', lang)}
        </button>
      </div>
      {/* Wrapped so it can be lifted out of the flow: on the race screen the
          panel hangs from the header as a dropdown rather than taking a row
          across the middle of the one screen that has to show everything. */}
      {open && (
        <div className="tc-body">
          <div className="tc-row">

            {/* ── Connection ── */}
            <div className="tc-group">
              <span className="tc-label">{t('tc_server', lang)}</span>
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
                  <button className="btn-secondary tc-btn" onClick={telem.disconnect}>{t('tc_disconnect', lang)}</button>
                ) : (
                  <button
                    className="btn-secondary tc-btn"
                    onClick={() => telem.connect(telemUrl, ps5IPs.map(ip => ip.trim()).filter(Boolean))}
                  >
                    {t('tc_connect', lang)}
                  </button>
                )}
              </div>
              {!telem.connected && (
                <p className="tc-hint">{t('tc_waiting_relay', lang)}</p>
              )}
              {telem.connected && telem.relayAddresses?.length > 0 && (
                <p className="tc-hint">
                  {t('tc_other_pc_1', lang)}{' '}
                  <code>{telem.relayAddresses[0]}</code> {t('tc_other_pc_2', lang)}
                </p>
              )}
            </div>

            {/* ── PS5 IPs ── */}
            <div className="tc-group tc-group-ips">
              <span className="tc-label">{t('tc_ps5_ips', lang)}</span>
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
                      <button className="tc-ip-remove" onClick={() => removeIP(idx)} title={t('tc_remove', lang)}>×</button>
                    )}
                  </div>
                ))}
                <button className="btn-ghost tc-add-btn" onClick={addIP}>{t('tc_add_ps5', lang)}</button>
              </div>
            </div>

            {/* ── Scan ── */}
            <div className="tc-group">
              <span className="tc-label">{t('tc_detection', lang)}</span>
              <button
                className="btn-secondary tc-btn tc-scan-btn"
                onClick={telem.connected ? telem.scan : undefined}
                disabled={!telem.connected || telem.scanning}
                title={!telem.connected ? t('tc_connect_first', lang) : t('tc_scan_title', lang)}
              >
                {telem.scanning ? t('tc_scanning', lang) : t('tc_scan', lang)}
              </button>
              {!telem.connected && (
                <p className="tc-hint">{t('tc_connect_first', lang)}</p>
              )}
            </div>

          </div>

          {/* ── Scan results ── */}
          {telem.scanResults?.length > 0 && (
            <div className="tc-scan-results">
              <span className="tc-scan-label">
                {t(telem.scanResults.length > 1 ? 'tc_scan_found_many' : 'tc_scan_found', lang, { n: telem.scanResults.length })}
              </span>
              {telem.scanResults.map(({ ip, hostname }) => (
                <span key={ip} className="tc-scan-result-tag">
                  {hostname ? <><strong>{hostname}</strong><span className="tc-scan-ip">{ip}</span></> : ip}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
