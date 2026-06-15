/**
 * First-run onboarding (Phase 3, Task 3.3).
 *
 * Minimal "detect PS5 → go" flow (DECISION 6). On first launch we show the
 * firewall explainer (DECISION 7), run the auto-scan, show the detected PS5, let
 * the user optionally pick a car preset, then drop them into the full-screen "Now"
 * view. No telemetry numbers to type — Phase 1 learns them live. Everything beyond
 * detect → go is skippable. Persistence (the "done" flag) is handled by the parent.
 *
 * Strings go through the i18n layer (English primary).
 */

import { t } from '../i18n/strings';

export default function Onboarding({ telem, detectedIp, carPresets, onApplyCarPreset, onRescan, onComplete, lang }) {
  const connected = telem?.connected;
  const scanning = telem?.scanning;

  let statusKey;
  let statusVars;
  if (!connected) statusKey = 'ob_offline';
  else if (detectedIp) {
    statusKey = 'ob_detected';
    statusVars = { ip: detectedIp };
  } else if (scanning) statusKey = 'ob_scanning';
  else statusKey = 'ob_none';

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <h1 className="ob-title">{t('ob_title', lang)}</h1>

        <p className="ob-firewall">{t('ob_firewall', lang)}</p>

        <div className={`ob-status${detectedIp ? ' ob-status--ok' : ''}`}>
          <span className={`ob-dot${detectedIp ? ' ob-dot--ok' : scanning ? ' ob-dot--scan' : ''}`} />
          {t(statusKey, lang, statusVars)}
        </div>

        {connected && !detectedIp && (
          <button className="ob-rescan" onClick={onRescan} disabled={scanning}>
            {t('ob_rescan', lang)}
          </button>
        )}

        {carPresets && carPresets.length > 0 && (
          <label className="ob-car">
            <span className="ob-car-label">{t('ob_car_optional', lang)}</span>
            <select
              className="ob-car-select"
              defaultValue=""
              onChange={(e) => {
                const preset = carPresets.find((p) => p.id === e.target.value);
                if (preset) onApplyCarPreset(preset);
              }}
            >
              <option value="">{t('ob_car_none', lang)}</option>
              {carPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ob-actions">
          <button className="ob-go" onClick={onComplete}>
            {t('ob_go', lang)}
          </button>
          <button className="ob-skip" onClick={onComplete}>
            {t('ob_skip', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
