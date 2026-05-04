import { useState, useCallback } from 'react';
import { CAR_PRESETS } from '../logic/strategy';

function formatLapMs(ms) {
  if (ms == null || ms <= 0) return '—';
  const totalSecs = ms / 1000;
  const m = Math.floor(totalSecs / 60);
  const s = (totalSecs % 60).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

const BUILT_IN_PRESETS = CAR_PRESETS;

function isValidLapTime(str) {
  if (!str) return false;
  return /^\d+:\d{1,2}(\.\d{1,3})?$/.test(str.trim()) || /^\d+(\.\d+)?$/.test(str.trim());
}

export default function InputPanel({ inputs, onChange, onCalculate, telem, telemSelectedIp, onTelemSelect }) {
  const [savedPresets, setSavedPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gt7-presets') || '[]');
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('');
  const [telemUrl, setTelemUrl] = useState('ws://localhost:20777');
  const [ps5IPs, setPS5IPs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gt7-ps5-ips') || '[""]'); }
    catch { return ['']; }
  });

  const savePS5IPs = (ips) => {
    setPS5IPs(ips);
    localStorage.setItem('gt7-ps5-ips', JSON.stringify(ips));
    if (telem?.connected) telem.sendIPs(ips.map(ip => ip.trim()).filter(Boolean));
  };

  const addPS5IP = () => savePS5IPs([...ps5IPs, '']);
  const removePS5IP = (idx) => savePS5IPs(ps5IPs.filter((_, i) => i !== idx));
  const updatePS5IP = (idx, val) => savePS5IPs(ps5IPs.map((ip, i) => i === idx ? val : ip));

  const handleChange = useCallback((key, value) => {
    onChange(prev => ({ ...prev, [key]: value }));
  }, [onChange]);

  const handleNum = (key) => (e) => handleChange(key, e.target.value === '' ? '' : Number(e.target.value));

  /** Load a car preset — sets tank, laps-per-tank, and adjusts tire wear */
  const loadPreset = (preset) => {
    onChange(prev => {
      let nextCompounds = prev.compounds;
      if (preset.compounds) {
        nextCompounds = preset.compounds;
      } else if (preset.tireWearLaps) {
        const oldBase = prev.compounds.find(c => c.tireLife > 0)?.tireLife || 30;
        const ratio = preset.tireWearLaps / oldBase;
        nextCompounds = prev.compounds.map(c => ({
          ...c,
          tireLife: c.tireLife > 0 ? Math.max(1, Math.round(c.tireLife * ratio)) : 0
        }));
      }

      return {
        ...prev,
        tankSize: preset.tankSize,
        lapsPerFullTank: preset.lapsPerFullTank,
        compounds: nextCompounds,
        ...(preset.raceDurationHours != null ? { raceDurationHours: preset.raceDurationHours } : {}),
      };
    });
  };

  /** Save current settings as a user preset */
  const savePreset = () => {
    if (!presetName.trim()) return;
    const preset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      tankSize: inputs.tankSize,
      lapsPerFullTank: inputs.lapsPerFullTank,
      compounds: inputs.compounds,
      raceDurationHours: inputs.raceDurationHours,
    };
    const updated = [...savedPresets, preset];
    setSavedPresets(updated);
    localStorage.setItem('gt7-presets', JSON.stringify(updated));
    setPresetName('');
  };

  const deletePreset = (id) => {
    const updated = savedPresets.filter(p => p.id !== id);
    setSavedPresets(updated);
    localStorage.setItem('gt7-presets', JSON.stringify(updated));
  };

  const resetToDefaults = () => {
    onChange(() => ({
      raceDurationHours: 8,
      tankSize: 100,
      lapsPerFullTank: 28,
      fuelMap: 1.0,
      compounds: [
        { id: 'H', name: 'Hard', tireLife: 60, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
        { id: 'M', name: 'Medium', tireLife: 40, mandatory: false, startLapTime: '1:58', halfLapTime: '2:00', endLapTime: '2:03' },
        { id: 'S', name: 'Soft', tireLife: 25, mandatory: false, startLapTime: '1:56', halfLapTime: '1:59', endLapTime: '2:03' },
        { id: 'IM', name: 'Intermediate', tireLife: 0, mandatory: false, startLapTime: '2:05', halfLapTime: '2:07', endLapTime: '2:10' },
        { id: 'W', name: 'Wet', tireLife: 0, mandatory: false, startLapTime: '2:10', halfLapTime: '2:13', endLapTime: '2:17' },
      ],
      pitBaseSecs: 25,
      tireChangeSecs: 27,
      fuelRateLitersPerSec: 4.0,
      fuelWeightPenaltyPerLiter: 0.03,
      drivers: [{ id: 'd1', name: 'Driver 1', compounds: {} }],
      minDriverTimeSecs: 7200,
      mandatoryStops: 1,
      midRaceMode: false,
      currentLap: '',
      currentFuel: '',
      currentCompoundId: '',
      currentTireAgeLaps: '',
    }));
  };

  /** Add a new driver */
  const addDriver = () => {
    onChange(prev => ({
      ...prev,
      drivers: [
        ...(prev.drivers || []),
        { id: `d${Date.now()}`, name: `Driver ${(prev.drivers || []).length + 1}`, compounds: {} },
      ],
    }));
  };

  /** Remove a driver by id */
  const removeDriver = (id) => {
    onChange(prev => ({ ...prev, drivers: (prev.drivers || []).filter(d => d.id !== id) }));
  };

  /** Update a driver's name */
  const updateDriverName = (id, name) => {
    onChange(prev => ({
      ...prev,
      drivers: (prev.drivers || []).map(d => d.id === id ? { ...d, name } : d),
    }));
  };

  /** Update a driver's lap time for a specific compound */
  const updateDriverCompound = (driverId, compoundId, key, value) => {
    onChange(prev => ({
      ...prev,
      drivers: (prev.drivers || []).map(d =>
        d.id === driverId
          ? { ...d, compounds: { ...d.compounds, [compoundId]: { ...(d.compounds?.[compoundId] || {}), [key]: value } } }
          : d
      ),
    }));
  };

  /** Update a single compound property */
  const updateCompound = (compoundId, key, value) => {
    onChange(prev => ({
      ...prev,
      compounds: prev.compounds.map(c =>
        c.id === compoundId ? { ...c, [key]: value } : c
      ),
    }));
  };

  const activeCompounds = inputs.compounds.filter(c => c.tireLife > 0);
  const allPresets = [...BUILT_IN_PRESETS, ...savedPresets];

  return (
    <div className="input-panel">
      {/* ── Car Presets ── */}
      <section className="input-section">
        <h3 className="section-title">Car Presets</h3>
        <div className="preset-list">
          {allPresets.map(preset => (
            <button
              key={preset.id}
              className="preset-btn"
              onClick={() => loadPreset(preset)}
              title={`Tank: ${preset.tankSize}L | Laps/Tank: ${preset.lapsPerFullTank} | Tires: ${preset.tireWearLaps} laps`}
            >
              {preset.name}
              {preset.id && !BUILT_IN_PRESETS.find(p => p.id === preset.id) && (
                <span
                  className="preset-delete"
                  onClick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}
                  title="Delete"
                >×</span>
              )}
            </button>
          ))}
        </div>
        <div className="save-preset-row">
          <input
            type="text"
            placeholder="Preset name…"
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            className="preset-name-input"
            onKeyDown={e => e.key === 'Enter' && savePreset()}
          />
          <button className="btn-secondary" onClick={savePreset}>Save</button>
        </div>
      </section>

      {/* ── Race Settings ── */}
      <section className="input-section">
        <h3 className="section-title">Race Settings</h3>

        <div className="field-group">
          <label htmlFor="raceDuration">
            {inputs.midRaceMode ? 'Time Remaining (hours)' : 'Race Duration (hours)'}
            {inputs.midRaceMode && <span className="hint"> (enter time left, not full race)</span>}
          </label>
          <input
            id="raceDuration"
            type="number"
            min="1"
            max="24"
            step="0.5"
            value={inputs.raceDurationHours}
            onChange={handleNum('raceDurationHours')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="mandatoryStops">Mandatory Pit Stops</label>
          <input
            id="mandatoryStops"
            type="number"
            min="0"
            max="20"
            step="1"
            value={inputs.mandatoryStops}
            onChange={handleNum('mandatoryStops')}
          />
        </div>
      </section>

      {/* ── Pit Stop Timing ── */}
      <section className="input-section">
        <h3 className="section-title">Pit Stop Timing</h3>

        <div className="field-group">
          <label htmlFor="pitBaseSecs">
            Base Pit Time (sec)
            <span className="hint"> (pit lane entry + exit)</span>
          </label>
          <input
            id="pitBaseSecs"
            type="number"
            min="10"
            max="120"
            step="1"
            value={inputs.pitBaseSecs}
            onChange={handleNum('pitBaseSecs')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="tireChangeSecs">
            Tire Change Time (sec)
            <span className="hint"> (added when swapping compounds)</span>
          </label>
          <input
            id="tireChangeSecs"
            type="number"
            min="5"
            max="60"
            step="1"
            value={inputs.tireChangeSecs}
            onChange={handleNum('tireChangeSecs')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="fuelRateLitersPerSec">Fuel Rate (L/sec)</label>
          <input
            id="fuelRateLitersPerSec"
            type="number"
            min="1"
            max="20"
            step="0.5"
            value={inputs.fuelRateLitersPerSec}
            onChange={handleNum('fuelRateLitersPerSec')}
          />
        </div>
      </section>

      {/* ── Fuel Weight Model ── */}
      <section className="input-section">
        <h3 className="section-title">Fuel Weight</h3>

        <div className="field-group">
          <label htmlFor="fuelWeightPenaltyPerLiter">
            Fuel Weight Penalty (sec/L)
            <span className="hint"> (0.02–0.05 typical · 0 to disable)</span>
          </label>
          <input
            id="fuelWeightPenaltyPerLiter"
            type="number"
            min="0"
            max="0.2"
            step="0.005"
            value={inputs.fuelWeightPenaltyPerLiter}
            onChange={handleNum('fuelWeightPenaltyPerLiter')}
          />
        </div>
        <p className="table-hint">
          How to measure: drive two laps at the same tyre age — one at full tank, one near-empty.
          Divide the time difference by tank size (L). E.g. 1.5s difference ÷ 50L = 0.03 s/L.
          Set to 0 if you prefer to encode the full effect directly in your lap times.
        </p>
      </section>

      {/* ── Fuel Settings ── */}
      <section className="input-section">
        <h3 className="section-title">Fuel Settings</h3>

        <div className="field-group">
          <label htmlFor="tankSize">Tank Size (L)</label>
          <input
            id="tankSize"
            type="number"
            min="10"
            max="200"
            step="1"
            value={inputs.tankSize}
            onChange={handleNum('tankSize')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="lapsPerFullTank">Laps per Full Tank</label>
          <input
            id="lapsPerFullTank"
            type="number"
            min="1"
            max="100"
            step="1"
            value={inputs.lapsPerFullTank}
            onChange={handleNum('lapsPerFullTank')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="fuelMap">
            Fuel Map
            <span className="hint"> (0.9 = saving · 1.0 = normal · 1.1 = rich)</span>
          </label>
          <div className="slider-row">
            <input
              id="fuelMap"
              type="range"
              min="0.7"
              max="1.3"
              step="0.05"
              value={inputs.fuelMap}
              onChange={(e) => handleChange('fuelMap', Number(e.target.value))}
            />
            <span className="slider-value">{Number(inputs.fuelMap).toFixed(2)}×</span>
          </div>
        </div>

      </section>

      {/* ── Tire Compound Table ── */}
      <section className="input-section">
        <h3 className="section-title">Tire Compounds</h3>
        <div className="table-scroll">
          <table className="compound-table">
            <thead>
              <tr>
                <th>Compound</th>
                <th>Life (laps)</th>
                <th title="Lap time at start of stint — fresh tyres, full tank">t(start)</th>
                <th title="Lap time at ~50% through the stint — half worn, half fuel">t(mid)</th>
                <th title="Lap time at end of stint — worn tyres, near-empty tank">t(end)</th>
                <th>Req'd</th>
              </tr>
            </thead>
            <tbody>
              {inputs.compounds.map(comp => {
                const active = comp.tireLife > 0;
                return (
                  <tr key={comp.id}>
                    <td>
                      <span className={`compound-tag compound-${comp.id}`}>{comp.id}</span>
                      <span className="compound-name-label">{comp.name}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="200"
                        step="1"
                        value={comp.tireLife}
                        onChange={(e) => updateCompound(comp.id, 'tireLife', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="compound-life-input"
                        placeholder="0 = skip"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.startLapTime || ''}
                        onChange={(e) => updateCompound(comp.id, 'startLapTime', e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.startLapTime) ? ' input-invalid' : ''}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.halfLapTime || ''}
                        onChange={(e) => updateCompound(comp.id, 'halfLapTime', e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.halfLapTime) ? ' input-invalid' : ''}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.endLapTime || ''}
                        onChange={(e) => updateCompound(comp.id, 'endLapTime', e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.endLapTime) ? ' input-invalid' : ''}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td className="compound-mandatory-cell">
                      <label className="toggle-switch toggle-sm">
                        <input
                          type="checkbox"
                          checked={!!comp.mandatory}
                          onChange={(e) => updateCompound(comp.id, 'mandatory', e.target.checked)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="table-hint">
          Enter what you observe in-game during a stint starting from a full tank:
          t(start) = your first lap (fresh tyres, full tank) ·
          t(mid) = lap at ~50% tyre wear ·
          t(end) = last lap before pitting (tyres worn, fuel at whatever level).
          The fuel weight penalty above is used to separate the fuel effect automatically — no special measurement needed.
          Set Life to 0 to exclude a compound.
        </p>
      </section>

      {/* ── Mid-Race Mode ── */}
      <section className="input-section">
        <h3 className="section-title">Mid-Race Recalculation</h3>
        <div className="field-group toggle-row">
          <label htmlFor="midRaceMode">Enable</label>
          <label className="toggle-switch">
            <input
              id="midRaceMode"
              type="checkbox"
              checked={inputs.midRaceMode}
              onChange={e => handleChange('midRaceMode', e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        {inputs.midRaceMode && (
          <>
            <div className="field-group">
              <label htmlFor="currentLap">Current Lap</label>
              <input
                id="currentLap"
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 45"
                value={inputs.currentLap}
                onChange={handleNum('currentLap')}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentFuel">Fuel Remaining (L)</label>
              <input
                id="currentFuel"
                type="number"
                min="0"
                step="0.5"
                placeholder="e.g. 28.5"
                value={inputs.currentFuel}
                onChange={handleNum('currentFuel')}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentCompoundId">Current Tire Compound</label>
              <select
                id="currentCompoundId"
                value={inputs.currentCompoundId}
                onChange={e => handleChange('currentCompoundId', e.target.value)}
                className="compound-select"
              >
                <option value="">— Select —</option>
                {activeCompounds.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="currentTireAgeLaps">
                Current Tire Age (laps)
                <span className="hint"> (laps on current set)</span>
              </label>
              <input
                id="currentTireAgeLaps"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 8"
                value={inputs.currentTireAgeLaps}
                onChange={handleNum('currentTireAgeLaps')}
              />
            </div>
          </>
        )}
      </section>

      {/* ── Drivers ── */}
      <section className="input-section">
        <h3 className="section-title">Drivers</h3>

        <div className="field-group">
          <label htmlFor="minDriverTime">
            Minimum Drive Time (hours)
            <span className="hint"> (per driver)</span>
          </label>
          <input
            id="minDriverTime"
            type="number"
            min="0"
            max="24"
            step="0.5"
            value={Number(inputs.minDriverTimeSecs) / 3600}
            onChange={e => handleChange('minDriverTimeSecs', Math.round(Number(e.target.value) * 3600))}
          />
        </div>

        <div className="driver-list">
          {(inputs.drivers || []).map((driver, dIdx) => (
            <div key={driver.id} className="driver-row">
              <div className="driver-header">
                <input
                  className="driver-name-input"
                  type="text"
                  value={driver.name}
                  onChange={e => updateDriverName(driver.id, e.target.value)}
                  placeholder="Driver name"
                />
                {(inputs.drivers || []).length > 1 && (
                  <button
                    className="driver-remove-btn"
                    onClick={() => removeDriver(driver.id)}
                    title="Remove driver"
                  >×</button>
                )}
              </div>
              {activeCompounds.length > 0 && (
                <details className="driver-times-details">
                  <summary className="driver-times-summary">
                    Custom lap times {Object.keys(driver.compounds || {}).length > 0 ? '(customised)' : '(uses global)'}
                  </summary>
                  <table className="driver-compound-table">
                    <thead>
                      <tr>
                        <th>Compound</th>
                        <th title="Lap 1, fresh tyres, full tank">t(start)</th>
                        <th title="~50% tyre wear">t(mid)</th>
                        <th title="Last lap before pit">t(end)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeCompounds.map(comp => {
                        const dc = driver.compounds?.[comp.id] || {};
                        const placeholder = (key) => {
                          const m = { startLapTime: comp.startLapTime, halfLapTime: comp.halfLapTime, endLapTime: comp.endLapTime };
                          return m[key] || 'M:SS';
                        };
                        return (
                          <tr key={comp.id}>
                            <td><span className={`compound-tag compound-${comp.id}`}>{comp.id}</span></td>
                            {['startLapTime', 'halfLapTime', 'endLapTime'].map(key => (
                              <td key={key}>
                                <input
                                  type="text"
                                  value={dc[key] || ''}
                                  onChange={e => updateDriverCompound(driver.id, comp.id, key, e.target.value)}
                                  className={`compound-laptime-input driver-laptime-input${dc[key] && !isValidLapTime(dc[key]) ? ' input-invalid' : ''}`}
                                  placeholder={placeholder(key)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="table-hint">Leave blank to use the global compound times above.</p>
                </details>
              )}
            </div>
          ))}
        </div>

        <button className="btn-secondary add-driver-btn" onClick={addDriver}>+ Add Driver</button>
      </section>

      {/* ── GT7 Live Telemetry ── */}
      {telem && (
        <section className="input-section">
          <h3 className="section-title">
            GT7 Live Telemetry
            <span className={`telem-status-dot${telem.connected ? ' telem-dot-on' : ''}`} title={telem.connected ? 'Connected' : 'Disconnected'} />
          </h3>

          {/* PS5 IP list */}
          <div className="telem-ip-list">
            {ps5IPs.map((ip, idx) => (
              <div key={idx} className="telem-ip-row">
                <input
                  type="text"
                  className="telem-ip-input"
                  value={ip}
                  onChange={e => updatePS5IP(idx, e.target.value)}
                  placeholder="192.168.1.10"
                  spellCheck={false}
                />
                {ps5IPs.length > 1 && (
                  <button className="telem-ip-remove" onClick={() => removePS5IP(idx)} title="Remove">×</button>
                )}
              </div>
            ))}
            <button className="btn-ghost telem-ip-add" onClick={addPS5IP}>+ Add PS5</button>
          </div>

          {/* Server URL + connect button */}
          <div className="telem-connect-row">
            <input
              className="telem-url-input"
              type="text"
              value={telemUrl}
              onChange={e => setTelemUrl(e.target.value)}
              placeholder="ws://localhost:20777"
              disabled={telem.connected}
              title="Relay server WebSocket URL"
            />
            {telem.connected ? (
              <button className="btn-secondary telem-btn" onClick={telem.disconnect}>Disconnect</button>
            ) : (
              <button
                className="btn-secondary telem-btn"
                onClick={() => telem.connect(telemUrl, ps5IPs.map(ip => ip.trim()).filter(Boolean))}
              >Connect</button>
            )}
          </div>

          {!telem.connected && (
            <p className="table-hint">
              Run <code>node telemetry-server.js</code> on this machine, then click Connect.
              PS5s must be on the same local network.
            </p>
          )}

          {telem.connected && telem.teams.size === 0 && (
            <p className="table-hint telem-waiting">
              {ps5IPs.filter(ip => ip.trim()).length === 0
                ? 'Add PS5 IP addresses above to start receiving data.'
                : 'Waiting for PS5 data…'}
            </p>
          )}

          {telem.teams.size > 0 && (
            <div className="telem-teams">
              <p className="telem-teams-label">
                {telem.teams.size} PS5{telem.teams.size !== 1 ? 's' : ''} live
                {inputs.midRaceMode && telemSelectedIp && ' · auto-filling mid-race'}
              </p>
              <div className="telem-team-list">
                {[...telem.teams.entries()].map(([ip, d], idx) => {
                  const isSelected = ip === telemSelectedIp;
                  return (
                    <div
                      key={ip}
                      className={`telem-team-card${isSelected ? ' telem-team-selected' : ''}${!d.onTrack ? ' telem-team-pit' : ''}`}
                      onClick={() => onTelemSelect(isSelected ? '' : ip)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTelemSelect(isSelected ? '' : ip); } }}
                      title={isSelected ? 'Click to deselect' : 'Click to auto-fill mid-race data'}
                    >
                      <div className="telem-team-header">
                        <span className="telem-team-num">T{idx + 1}</span>
                        <span className="telem-team-ip">{ip}</span>
                        <span className={`telem-track-badge${d.onTrack ? ' on-track' : ' in-pit'}`}>
                          {d.onTrack ? 'On Track' : 'Pit'}
                        </span>
                      </div>
                      <div className="telem-team-stats">
                        <span><strong>Lap</strong> {d.currentLap}</span>
                        <span><strong>Fuel</strong> {d.fuelLiters != null ? `${d.fuelLiters.toFixed(1)} L` : '—'}</span>
                        <span><strong>Speed</strong> {d.speedKmh} km/h</span>
                        <span><strong>Last</strong> {formatLapMs(d.lastLapMs)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {inputs.midRaceMode && !telemSelectedIp && (
                <p className="table-hint">Select a team above to auto-fill current lap and fuel.</p>
              )}
            </div>
          )}
        </section>
      )}

      <button className="btn-cta calculate-btn" onClick={onCalculate}>Calculate Strategy</button>
      <button className="btn-ghost reset-btn" onClick={resetToDefaults}>Reset to Defaults</button>
    </div>
  );
}
