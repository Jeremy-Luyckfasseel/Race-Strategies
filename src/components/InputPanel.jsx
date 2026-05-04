import { useState, useCallback } from "react";
import { CAR_PRESETS } from "../logic/strategy";

function formatLapMs(ms) {
  if (ms == null || ms <= 0) return "—";
  const totalSecs = ms / 1000;
  const m = Math.floor(totalSecs / 60);
  const s = (totalSecs % 60).toFixed(3);
  return `${m}:${s.padStart(6, "0")}`;
}

const BUILT_IN_PRESETS = CAR_PRESETS;

function isValidLapTime(str) {
  if (!str) return false;
  return /^\d+:\d{1,2}(\.\d{1,3})?$/.test(str.trim()) || /^\d+(\.\d+)?$/.test(str.trim());
}

const DEFAULT_OPEN = {
  presets: false,
  race: true,
  pit: true,
  fuelWeight: false,
  fuel: true,
  compounds: true,
  midrace: false,
  drivers: true,
  telemetry: false,
};

function Section({ label, sectionKey, openSections, toggle, children }) {
  const isOpen = openSections[sectionKey];
  return (
    <div className="input-section">
      <button
        className={`section-toggle${isOpen ? " open" : ""}`}
        onClick={() => toggle(sectionKey)}
        aria-expanded={isOpen}
      >
        <span className="section-toggle-label">{label}</span>
        <span className={`section-chevron${isOpen ? " open" : ""}`}>›</span>
      </button>
      <div className={`section-body${isOpen ? " open" : ""}`}>
        <div className="section-body-inner">{children}</div>
      </div>
    </div>
  );
}

export default function InputPanel({ inputs, onChange, onCalculate, telem, telemSelectedIp, onTelemSelect }) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);
  const [savedPresets, setSavedPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-presets") || "[]"); }
    catch { return []; }
  });
  const [presetName, setPresetName] = useState("");
  const [telemUrl, setTelemUrl] = useState("ws://localhost:20777");
  const [ps5IPs, setPS5IPs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-ps5-ips") || '[""]'); }
    catch { return [""]; }
  });

  const toggle = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const savePS5IPs = (ips) => {
    setPS5IPs(ips);
    localStorage.setItem("gt7-ps5-ips", JSON.stringify(ips));
    if (telem?.connected) telem.sendIPs(ips.map((ip) => ip.trim()).filter(Boolean));
  };

  const addPS5IP    = () => savePS5IPs([...ps5IPs, ""]);
  const removePS5IP = (idx) => savePS5IPs(ps5IPs.filter((_, i) => i !== idx));
  const updatePS5IP = (idx, val) => savePS5IPs(ps5IPs.map((ip, i) => (i === idx ? val : ip)));

  const handleChange = useCallback((key, value) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  }, [onChange]);

  const handleNum = (key) => (e) =>
    handleChange(key, e.target.value === "" ? "" : Number(e.target.value));

  const loadPreset = (preset) => {
    onChange((prev) => {
      let nextCompounds = prev.compounds;
      if (preset.compounds) {
        nextCompounds = preset.compounds;
      } else if (preset.tireWearLaps) {
        const oldBase = prev.compounds.find((c) => c.tireLife > 0)?.tireLife || 30;
        const ratio = preset.tireWearLaps / oldBase;
        nextCompounds = prev.compounds.map((c) => ({
          ...c,
          tireLife: c.tireLife > 0 ? Math.max(1, Math.round(c.tireLife * ratio)) : 0,
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
    localStorage.setItem("gt7-presets", JSON.stringify(updated));
    setPresetName("");
  };

  const deletePreset = (id) => {
    const updated = savedPresets.filter((p) => p.id !== id);
    setSavedPresets(updated);
    localStorage.setItem("gt7-presets", JSON.stringify(updated));
  };

  const resetToDefaults = () => {
    onChange(() => ({
      raceDurationHours: 8, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1.0,
      compounds: [
        { id: "H",  name: "Hard",         tireLife: 60, mandatory: false, startLapTime: "2:00", halfLapTime: "2:01", endLapTime: "2:03" },
        { id: "M",  name: "Medium",       tireLife: 40, mandatory: false, startLapTime: "1:58", halfLapTime: "2:00", endLapTime: "2:03" },
        { id: "S",  name: "Soft",         tireLife: 25, mandatory: false, startLapTime: "1:56", halfLapTime: "1:59", endLapTime: "2:03" },
        { id: "IM", name: "Intermediate", tireLife: 0,  mandatory: false, startLapTime: "2:05", halfLapTime: "2:07", endLapTime: "2:10" },
        { id: "W",  name: "Wet",          tireLife: 0,  mandatory: false, startLapTime: "2:10", halfLapTime: "2:13", endLapTime: "2:17" },
      ],
      pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4.0,
      fuelWeightPenaltyPerLiter: 0.03,
      drivers: [{ id: "d1", name: "Driver 1", compounds: {} }],
      minDriverTimeSecs: 7200, mandatoryStops: 1,
      midRaceMode: false, currentLap: "", currentFuel: "", currentCompoundId: "", currentTireAgeLaps: "",
    }));
  };

  const addDriver = () => {
    onChange((prev) => ({
      ...prev,
      drivers: [
        ...(prev.drivers || []),
        { id: `d${Date.now()}`, name: `Driver ${(prev.drivers || []).length + 1}`, compounds: {} },
      ],
    }));
  };

  const removeDriver = (id) => {
    onChange((prev) => ({ ...prev, drivers: (prev.drivers || []).filter((d) => d.id !== id) }));
  };

  const updateDriverName = (id, name) => {
    onChange((prev) => ({
      ...prev,
      drivers: (prev.drivers || []).map((d) => (d.id === id ? { ...d, name } : d)),
    }));
  };

  const updateDriverCompound = (driverId, compoundId, key, value) => {
    onChange((prev) => ({
      ...prev,
      drivers: (prev.drivers || []).map((d) =>
        d.id === driverId
          ? { ...d, compounds: { ...d.compounds, [compoundId]: { ...(d.compounds?.[compoundId] || {}), [key]: value } } }
          : d
      ),
    }));
  };

  const updateCompound = (compoundId, key, value) => {
    onChange((prev) => ({
      ...prev,
      compounds: prev.compounds.map((c) => (c.id === compoundId ? { ...c, [key]: value } : c)),
    }));
  };

  const activeCompounds = inputs.compounds.filter((c) => c.tireLife > 0);
  const allPresets = [...BUILT_IN_PRESETS, ...savedPresets];

  return (
    <div className="input-panel">

      {/* ── Car Presets ── */}
      <Section label="Car Presets" sectionKey="presets" openSections={openSections} toggle={toggle}>
        <div className="preset-list">
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              className="preset-btn"
              onClick={() => loadPreset(preset)}
              title={`Tank: ${preset.tankSize}L · Laps/Tank: ${preset.lapsPerFullTank}`}
            >
              {preset.name}
              {!BUILT_IN_PRESETS.find((p) => p.id === preset.id) && (
                <span
                  className="preset-delete"
                  onClick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}
                  title="Delete"
                  role="button"
                  tabIndex={-1}
                >×</span>
              )}
            </button>
          ))}
        </div>
        <div className="save-preset-row">
          <input
            type="text"
            placeholder="Save current as preset…"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            className="preset-name-input"
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
          />
          <button className="btn-secondary" onClick={savePreset}>Save</button>
        </div>
      </Section>

      {/* ── Race Settings ── */}
      <Section label="Race Settings" sectionKey="race" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="raceDuration">
            {inputs.midRaceMode ? "Time Remaining (hours)" : "Race Duration (hours)"}
            {inputs.midRaceMode && <span className="hint"> — time left</span>}
          </label>
          <input
            id="raceDuration"
            type="number" min="1" max="24" step="0.5"
            value={inputs.raceDurationHours}
            onChange={handleNum("raceDurationHours")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="mandatoryStops">Mandatory Pit Stops</label>
          <input
            id="mandatoryStops"
            type="number" min="0" max="20" step="1"
            value={inputs.mandatoryStops}
            onChange={handleNum("mandatoryStops")}
          />
        </div>
      </Section>

      {/* ── Pit Stop Timing ── */}
      <Section label="Pit Stop Timing" sectionKey="pit" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="pitBaseSecs">
            Base Pit Time (sec)
            <span className="hint"> — entry + exit</span>
          </label>
          <input
            id="pitBaseSecs"
            type="number" min="10" max="120" step="1"
            value={inputs.pitBaseSecs}
            onChange={handleNum("pitBaseSecs")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="tireChangeSecs">
            Tyre Change Time (sec)
            <span className="hint"> — added when swapping</span>
          </label>
          <input
            id="tireChangeSecs"
            type="number" min="5" max="60" step="1"
            value={inputs.tireChangeSecs}
            onChange={handleNum("tireChangeSecs")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="fuelRateLitersPerSec">Fuel Rate (L/sec)</label>
          <input
            id="fuelRateLitersPerSec"
            type="number" min="1" max="20" step="0.5"
            value={inputs.fuelRateLitersPerSec}
            onChange={handleNum("fuelRateLitersPerSec")}
          />
        </div>
      </Section>

      {/* ── Fuel Settings ── */}
      <Section label="Fuel" sectionKey="fuel" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="tankSize">Tank Size (L)</label>
          <input
            id="tankSize"
            type="number" min="10" max="200" step="1"
            value={inputs.tankSize}
            onChange={handleNum("tankSize")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="lapsPerFullTank">Laps per Full Tank</label>
          <input
            id="lapsPerFullTank"
            type="number" min="1" max="100" step="1"
            value={inputs.lapsPerFullTank}
            onChange={handleNum("lapsPerFullTank")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="fuelMap">
            Fuel Map
            <span className="hint"> — saving ↔ rich</span>
          </label>
          <div className="slider-row">
            <input
              id="fuelMap"
              type="range" min="0.7" max="1.3" step="0.05"
              value={inputs.fuelMap}
              onChange={(e) => handleChange("fuelMap", Number(e.target.value))}
            />
            <span className="slider-value">{Number(inputs.fuelMap).toFixed(2)}×</span>
          </div>
        </div>
      </Section>

      {/* ── Fuel Weight ── */}
      <Section label="Fuel Weight Penalty" sectionKey="fuelWeight" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="fuelWeightPenaltyPerLiter">
            Penalty (sec/L)
            <span className="hint"> — 0.02–0.05 typical</span>
          </label>
          <input
            id="fuelWeightPenaltyPerLiter"
            type="number" min="0" max="0.2" step="0.005"
            value={inputs.fuelWeightPenaltyPerLiter}
            onChange={handleNum("fuelWeightPenaltyPerLiter")}
          />
        </div>
        <p className="field-note">
          Measure: two laps at same tyre age — full tank vs. near-empty. Divide time
          diff by tank size. E.g. 1.5s ÷ 50L = 0.03 s/L. Set to 0 to encode fuel
          effect directly in lap times.
        </p>
      </Section>

      {/* ── Tire Compounds ── */}
      <Section label="Tyre Compounds" sectionKey="compounds" openSections={openSections} toggle={toggle}>
        <div className="table-scroll">
          <table className="compound-table">
            <thead>
              <tr>
                <th>Compound</th>
                <th title="Laps before worn out (0 = skip)">Life</th>
                <th title="Lap time at start of stint — fresh tyres, full tank">t(0)</th>
                <th title="Lap time at ~50% through the stint">t(½)</th>
                <th title="Lap time at end of stint — worn tyres, near-empty">t(1)</th>
                <th title="Mandatory compound">★</th>
              </tr>
            </thead>
            <tbody>
              {inputs.compounds.map((comp) => {
                const active = comp.tireLife > 0;
                return (
                  <tr key={comp.id}>
                    <td>
                      <span className={`compound-tag compound-${comp.id}`}>{comp.id}</span>
                      <span className="compound-name-label">{comp.name}</span>
                    </td>
                    <td>
                      <input
                        type="number" min="0" max="200" step="1"
                        value={comp.tireLife}
                        onChange={(e) => updateCompound(comp.id, "tireLife", e.target.value === "" ? 0 : Number(e.target.value))}
                        className="compound-life-input"
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.startLapTime || ""}
                        onChange={(e) => updateCompound(comp.id, "startLapTime", e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.startLapTime) ? " input-invalid" : ""}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.halfLapTime || ""}
                        onChange={(e) => updateCompound(comp.id, "halfLapTime", e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.halfLapTime) ? " input-invalid" : ""}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={comp.endLapTime || ""}
                        onChange={(e) => updateCompound(comp.id, "endLapTime", e.target.value)}
                        className={`compound-laptime-input${active && !isValidLapTime(comp.endLapTime) ? " input-invalid" : ""}`}
                        placeholder="M:SS"
                      />
                    </td>
                    <td className="compound-mandatory-cell">
                      <label className="toggle-switch toggle-sm">
                        <input
                          type="checkbox"
                          checked={!!comp.mandatory}
                          onChange={(e) => updateCompound(comp.id, "mandatory", e.target.checked)}
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
        <p className="field-note">
          Enter what you observe in-game from a full tank:
          t(0) = first lap · t(½) = ~50% tyre wear · t(1) = last lap before pit.
          Life = 0 to exclude a compound.
        </p>
      </Section>

      {/* ── Mid-Race Mode ── */}
      <Section label="Mid-Race Recalculation" sectionKey="midrace" openSections={openSections} toggle={toggle}>
        <div className="field-group toggle-row">
          <label htmlFor="midRaceMode">Enable</label>
          <label className="toggle-switch">
            <input
              id="midRaceMode"
              type="checkbox"
              checked={inputs.midRaceMode}
              onChange={(e) => handleChange("midRaceMode", e.target.checked)}
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
                type="number" min="1" step="1"
                placeholder="e.g. 45"
                value={inputs.currentLap}
                onChange={handleNum("currentLap")}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentFuel">Fuel Remaining (L)</label>
              <input
                id="currentFuel"
                type="number" min="0" step="0.5"
                placeholder="e.g. 28.5"
                value={inputs.currentFuel}
                onChange={handleNum("currentFuel")}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentCompoundId">Current Tyre Compound</label>
              <select
                id="currentCompoundId"
                value={inputs.currentCompoundId}
                onChange={(e) => handleChange("currentCompoundId", e.target.value)}
                className="compound-select"
              >
                <option value="">— Select —</option>
                {activeCompounds.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="currentTireAgeLaps">
                Tyre Age (laps)
                <span className="hint"> — laps on current set</span>
              </label>
              <input
                id="currentTireAgeLaps"
                type="number" min="0" step="1"
                placeholder="e.g. 8"
                value={inputs.currentTireAgeLaps}
                onChange={handleNum("currentTireAgeLaps")}
              />
            </div>
          </>
        )}
      </Section>

      {/* ── Drivers ── */}
      <Section label="Drivers" sectionKey="drivers" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="minDriverTime">
            Minimum Drive Time (hours)
            <span className="hint"> — per driver</span>
          </label>
          <input
            id="minDriverTime"
            type="number" min="0" max="24" step="0.5"
            value={Number(inputs.minDriverTimeSecs) / 3600}
            onChange={(e) => handleChange("minDriverTimeSecs", Math.round(Number(e.target.value) * 3600))}
          />
        </div>

        <div className="driver-list">
          {(inputs.drivers || []).map((driver) => (
            <div key={driver.id} className="driver-row">
              <div className="driver-header">
                <input
                  className="driver-name-input"
                  type="text"
                  value={driver.name}
                  onChange={(e) => updateDriverName(driver.id, e.target.value)}
                  placeholder="Driver name"
                  aria-label="Driver name"
                />
                {(inputs.drivers || []).length > 1 && (
                  <button
                    className="driver-remove-btn"
                    onClick={() => removeDriver(driver.id)}
                    title="Remove driver"
                    aria-label="Remove driver"
                  >×</button>
                )}
              </div>
              {activeCompounds.length > 0 && (
                <details className="driver-times-details">
                  <summary className="driver-times-summary">
                    Custom lap times {Object.keys(driver.compounds || {}).length > 0 ? "(customised)" : "(uses global)"}
                  </summary>
                  <div style={{ padding: "0 0 8px" }}>
                    <table className="driver-compound-table">
                      <thead>
                        <tr>
                          <th>Compound</th>
                          <th title="Lap 1, fresh tyres, full tank">t(0)</th>
                          <th title="~50% tyre wear">t(½)</th>
                          <th title="Last lap before pit">t(1)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeCompounds.map((comp) => {
                          const dc = driver.compounds?.[comp.id] || {};
                          const placeholder = (key) => {
                            const m = { startLapTime: comp.startLapTime, halfLapTime: comp.halfLapTime, endLapTime: comp.endLapTime };
                            return m[key] || "M:SS";
                          };
                          return (
                            <tr key={comp.id}>
                              <td><span className={`compound-tag compound-${comp.id}`}>{comp.id}</span></td>
                              {["startLapTime", "halfLapTime", "endLapTime"].map((key) => (
                                <td key={key}>
                                  <input
                                    type="text"
                                    value={dc[key] || ""}
                                    onChange={(e) => updateDriverCompound(driver.id, comp.id, key, e.target.value)}
                                    className={`compound-laptime-input driver-laptime-input${dc[key] && !isValidLapTime(dc[key]) ? " input-invalid" : ""}`}
                                    placeholder={placeholder(key)}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="field-note">Leave blank to use global compound times.</p>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>

        <button className="btn-secondary add-driver-btn" onClick={addDriver}>+ Add Driver</button>
      </Section>

      {/* ── GT7 Live Telemetry ── */}
      {telem && (
        <Section label="GT7 Live Telemetry" sectionKey="telemetry" openSections={openSections} toggle={toggle}>
          <div className="telem-ip-list">
            {ps5IPs.map((ip, idx) => (
              <div key={idx} className="telem-ip-row">
                <input
                  type="text"
                  className="telem-ip-input"
                  value={ip}
                  onChange={(e) => updatePS5IP(idx, e.target.value)}
                  placeholder="192.168.1.10"
                  spellCheck={false}
                  aria-label="PS5 IP address"
                />
                {ps5IPs.length > 1 && (
                  <button className="telem-ip-remove" onClick={() => removePS5IP(idx)} title="Remove" aria-label="Remove IP">×</button>
                )}
              </div>
            ))}
            <button className="btn-ghost telem-ip-add" onClick={addPS5IP}>+ Add PS5</button>
          </div>

          <div className="telem-connect-row">
            <input
              className="telem-url-input"
              type="text"
              value={telemUrl}
              onChange={(e) => setTelemUrl(e.target.value)}
              placeholder="ws://localhost:20777"
              disabled={telem.connected}
              aria-label="WebSocket relay URL"
            />
            {telem.connected ? (
              <button className="btn-secondary telem-btn" onClick={telem.disconnect}>Disconnect</button>
            ) : (
              <button
                className="btn-secondary telem-btn"
                onClick={() => telem.connect(telemUrl, ps5IPs.map((ip) => ip.trim()).filter(Boolean))}
              >Connect</button>
            )}
          </div>

          {!telem.connected && (
            <p className="field-note">
              Run <code>node server/telemetry-server.js</code> then click Connect.
              PS5s must be on the same local network.
            </p>
          )}

          {telem.connected && telem.teams.size === 0 && (
            <p className="field-note telem-waiting">
              {ps5IPs.filter((ip) => ip.trim()).length === 0
                ? "Add PS5 IP addresses above to start receiving data."
                : "Waiting for PS5 data…"}
            </p>
          )}

          {telem.teams.size > 0 && (
            <div className="telem-teams">
              <p className="telem-teams-label">
                {telem.teams.size} PS5{telem.teams.size !== 1 ? "s" : ""} live
                {inputs.midRaceMode && telemSelectedIp && " · auto-filling"}
              </p>
              <div className="telem-team-list">
                {[...telem.teams.entries()].map(([ip, d], idx) => {
                  const isSelected = ip === telemSelectedIp;
                  return (
                    <div
                      key={ip}
                      className={`telem-team-card${isSelected ? " telem-team-selected" : ""}${!d.onTrack ? " telem-team-pit" : ""}`}
                      onClick={() => onTelemSelect(isSelected ? "" : ip)}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTelemSelect(isSelected ? "" : ip); }
                      }}
                    >
                      <div className="telem-team-header">
                        <span className="telem-team-num">T{idx + 1}</span>
                        <span className="telem-team-ip">{ip}</span>
                        <span className={`telem-track-badge${d.onTrack ? " on-track" : " in-pit"}`}>
                          {d.onTrack ? "On Track" : "Pit"}
                        </span>
                      </div>
                      <div className="telem-team-stats">
                        <span><strong>Lap</strong> {d.currentLap}</span>
                        <span><strong>Fuel</strong> {d.fuelLiters != null ? `${d.fuelLiters.toFixed(1)} L` : "—"}</span>
                        <span><strong>Speed</strong> {d.speedKmh} km/h</span>
                        <span><strong>Last</strong> {formatLapMs(d.lastLapMs)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {inputs.midRaceMode && !telemSelectedIp && (
                <p className="field-note">Select a team above to auto-fill current lap and fuel.</p>
              )}
            </div>
          )}
        </Section>
      )}

      <button className="btn-cta calculate-btn" onClick={onCalculate} aria-label="Calculate race strategy">
        Calculate Strategy
      </button>
      <button className="btn-ghost reset-btn" onClick={resetToDefaults}>Reset to Defaults</button>
    </div>
  );
}
