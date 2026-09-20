import { useState, useCallback } from "react";
import { CAR_PRESETS, isValidLapTimeStr as isValidLapTime } from "../logic/strategy";
import { DEFAULT_LANG, t, compoundName } from "../i18n/strings";


const BUILT_IN_PRESETS = CAR_PRESETS;

const DEFAULT_OPEN = {
  presets: false,
  race: true,
  pit: true,
  fuelWeight: false,
  fuel: true,
  compounds: true,
  midrace: false,
  drivers: true,
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

export default function InputPanel({ inputs, onChange, onCalculate, telem, telemSelectedIp, onTelemSelect, teamLabels = {}, lang = DEFAULT_LANG }) {
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);
  const [savedPresets, setSavedPresets] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-presets") || "[]"); }
    catch { return []; }
  });
  const [presetName, setPresetName] = useState("");

  const toggle = (key) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

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
      drivers: [{ id: "d1", name: t("driver_n", lang, { n: 1 }), compounds: {} }],
      minDriverTimeSecs: 7200, mandatoryStops: 0,
      midRaceMode: false, currentLap: "", currentFuel: "", currentCompoundId: "", currentTireAgeLaps: "",
    }));
  };

  const addDriver = () => {
    onChange((prev) => ({
      ...prev,
      drivers: [
        ...(prev.drivers || []),
        { id: `d${Date.now()}`, name: t("driver_n", lang, { n: (prev.drivers || []).length + 1 }), compounds: {} },
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
      <Section label={t("ip_presets", lang)} sectionKey="presets" openSections={openSections} toggle={toggle}>
        <div className="preset-list">
          {allPresets.map((preset) => (
            <button
              key={preset.id}
              className="preset-btn"
              onClick={() => loadPreset(preset)}
              title={t("ip_preset_title", lang, { tank: preset.tankSize, laps: preset.lapsPerFullTank })}
            >
              {preset.name}
              {!BUILT_IN_PRESETS.find((p) => p.id === preset.id) && (
                <span
                  className="preset-delete"
                  onClick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}
                  title={t("ip_preset_delete", lang)}
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
            placeholder={t("ip_preset_save_ph", lang)}
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            className="preset-name-input"
            onKeyDown={(e) => e.key === "Enter" && savePreset()}
          />
          <button className="btn-secondary" onClick={savePreset}>{t("ip_preset_save", lang)}</button>
        </div>
      </Section>

      {/* ── Race Settings ── */}
      <Section label={t("ip_race", lang)} sectionKey="race" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="raceDuration">
            {inputs.midRaceMode ? t("ip_time_left", lang) : t("ip_race_duration", lang)}
            {inputs.midRaceMode && <span className="hint">{t("ip_time_left_hint", lang)}</span>}
          </label>
          <input
            id="raceDuration"
            type="number" min="1" max="24" step="0.5"
            value={inputs.raceDurationHours}
            onChange={handleNum("raceDurationHours")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="mandatoryStops">{t("ip_mandatory_stops", lang)}</label>
          <input
            id="mandatoryStops"
            type="number" min="0" max="20" step="1"
            value={inputs.mandatoryStops}
            onChange={handleNum("mandatoryStops")}
          />
        </div>
      </Section>

      {/* ── Pit Stop Timing ── */}
      <Section label={t("ip_pit", lang)} sectionKey="pit" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="pitBaseSecs">
            {t("ip_pit_base", lang)}
            <span className="hint">{t("ip_pit_base_hint", lang)}</span>
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
            {t("ip_tire_change", lang)}
            <span className="hint">{t("ip_tire_change_hint", lang)}</span>
          </label>
          <input
            id="tireChangeSecs"
            type="number" min="5" max="60" step="1"
            value={inputs.tireChangeSecs}
            onChange={handleNum("tireChangeSecs")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="fuelRateLitersPerSec">{t("ip_fuel_rate", lang)}</label>
          <input
            id="fuelRateLitersPerSec"
            type="number" min="1" max="20" step="0.5"
            value={inputs.fuelRateLitersPerSec}
            onChange={handleNum("fuelRateLitersPerSec")}
          />
        </div>
      </Section>

      {/* ── Fuel Settings ── */}
      <Section label={t("ip_fuel", lang)} sectionKey="fuel" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="tankSize">{t("ip_tank_size", lang)}</label>
          <input
            id="tankSize"
            type="number" min="10" max="200" step="1"
            value={inputs.tankSize}
            onChange={handleNum("tankSize")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="lapsPerFullTank">{t("ip_laps_per_tank", lang)}</label>
          <input
            id="lapsPerFullTank"
            type="number" min="1" max="100" step="1"
            value={inputs.lapsPerFullTank}
            onChange={handleNum("lapsPerFullTank")}
          />
        </div>
        <div className="field-group">
          <label htmlFor="fuelMap">
            {t("ip_fuel_map", lang)}
            <span className="hint">{t("ip_fuel_map_hint", lang)}</span>
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
      <Section label={t("ip_fuel_weight", lang)} sectionKey="fuelWeight" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="fuelWeightPenaltyPerLiter">
            {t("ip_penalty", lang)}
            <span className="hint">{t("ip_penalty_hint", lang)}</span>
          </label>
          <input
            id="fuelWeightPenaltyPerLiter"
            type="number" min="0" max="0.2" step="0.005"
            value={inputs.fuelWeightPenaltyPerLiter}
            onChange={handleNum("fuelWeightPenaltyPerLiter")}
          />
        </div>
        <p className="field-note">{t("ip_penalty_note", lang)}</p>
      </Section>

      {/* ── Tire Compounds ── */}
      <Section label={t("ip_compounds", lang)} sectionKey="compounds" openSections={openSections} toggle={toggle}>
        <div className="table-scroll">
          <table className="compound-table">
            <thead>
              <tr>
                <th>{t("ip_compound", lang)}</th>
                <th title={t("ip_life_title", lang)}>{t("ip_life", lang)}</th>
                <th title={t("ip_t0_title", lang)}>t(0)</th>
                <th title={t("ip_thalf_title", lang)}>t(½)</th>
                <th title={t("ip_t1_title", lang)}>t(1)</th>
                <th title={t("ip_mandatory_title", lang)}>★</th>
              </tr>
            </thead>
            <tbody>
              {inputs.compounds.map((comp) => {
                const active = comp.tireLife > 0;
                return (
                  <tr key={comp.id}>
                    <td>
                      <span className={`compound-tag compound-${comp.id}`}>{comp.id}</span>
                      <span className="compound-name-label">{compoundName(comp.id, lang) || comp.name}</span>
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
        <p className="field-note">{t("ip_compounds_note", lang)}</p>
      </Section>

      {/* ── Mid-Race Mode ── */}
      <Section label={t("ip_midrace", lang)} sectionKey="midrace" openSections={openSections} toggle={toggle}>
        <div className="field-group toggle-row">
          <label htmlFor="midRaceMode">{t("ip_enable", lang)}</label>
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
        {inputs.midRaceMode && telem?.teams?.size > 0 && (
          <div className="field-group">
            <label>{t("ip_autofill", lang)}</label>
            <div className="midrace-team-list">
              {[...telem.teams.entries()].map(([ip, d], idx) => {
                const isSelected = ip === telemSelectedIp;
                return (
                  <button
                    key={ip}
                    className={`midrace-team-btn${isSelected ? " active" : ""}`}
                    onClick={() => onTelemSelect(isSelected ? "" : ip)}
                  >
                    <span className={`midrace-dot${d.onTrack ? " on" : " pit"}`} />
                    T{idx + 1} · {teamLabels[ip] || ip}
                    {isSelected && <span className="midrace-filling">{t("ip_filling", lang)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {inputs.midRaceMode && (
          <>
            <div className="field-group">
              <label htmlFor="currentLap">{t("ip_current_lap", lang)}</label>
              <input
                id="currentLap"
                type="number" min="1" step="1"
                placeholder={t("ip_current_lap_ph", lang)}
                value={inputs.currentLap}
                onChange={handleNum("currentLap")}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentFuel">{t("ip_current_fuel", lang)}</label>
              <input
                id="currentFuel"
                type="number" min="0" step="0.5"
                placeholder={t("ip_current_fuel_ph", lang)}
                value={inputs.currentFuel}
                onChange={handleNum("currentFuel")}
              />
            </div>
            <div className="field-group">
              <label htmlFor="currentCompoundId">{t("ip_current_compound", lang)}</label>
              <select
                id="currentCompoundId"
                value={inputs.currentCompoundId}
                onChange={(e) => handleChange("currentCompoundId", e.target.value)}
                className="compound-select"
              >
                <option value="">{t("ip_select", lang)}</option>
                {activeCompounds.map((c) => (
                  <option key={c.id} value={c.id}>{compoundName(c.id, lang) || c.name} ({c.id})</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="currentTireAgeLaps">
                {t("ip_tyre_age", lang)}
                <span className="hint">{t("ip_tyre_age_hint", lang)}</span>
              </label>
              <input
                id="currentTireAgeLaps"
                type="number" min="0" step="1"
                placeholder={t("ip_tyre_age_ph", lang)}
                value={inputs.currentTireAgeLaps}
                onChange={handleNum("currentTireAgeLaps")}
              />
            </div>
          </>
        )}
      </Section>

      {/* ── Drivers ── */}
      <Section label={t("ip_drivers", lang)} sectionKey="drivers" openSections={openSections} toggle={toggle}>
        <div className="field-group">
          <label htmlFor="minDriverTime">
            {t("ip_min_drive_time", lang)}
            <span className="hint">{t("ip_min_drive_time_hint", lang)}</span>
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
                  placeholder={t("ip_driver_name_ph", lang)}
                  aria-label={t("ip_driver_name_ph", lang)}
                />
                {(inputs.drivers || []).length > 1 && (
                  <button
                    className="driver-remove-btn"
                    onClick={() => removeDriver(driver.id)}
                    title={t("ip_driver_remove", lang)}
                    aria-label={t("ip_driver_remove", lang)}
                  >×</button>
                )}
              </div>
              {activeCompounds.length > 0 && (
                <details className="driver-times-details">
                  <summary className="driver-times-summary">
                    {t("ip_lap_times", lang)} {Object.keys(driver.compounds || {}).length > 0 ? t("ip_custom", lang) : t("ip_uses_global", lang)}
                  </summary>
                  <div style={{ padding: "0 0 8px" }}>
                    <table className="driver-compound-table">
                      <thead>
                        <tr>
                          <th>{t("ip_compound", lang)}</th>
                          <th title={t("ip_t0_short_title", lang)}>t(0)</th>
                          <th title={t("ip_thalf_short_title", lang)}>t(½)</th>
                          <th title={t("ip_t1_short_title", lang)}>t(1)</th>
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
                                    className={`compound-laptime-input driver-laptime-input${dc.startLapTime && !isValidLapTime(dc[key]) ? " input-invalid" : ""}`}
                                    placeholder={placeholder(key)}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="field-note">{t("ip_driver_times_note", lang)}</p>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>

        <button className="btn-secondary add-driver-btn" onClick={addDriver}>{t("ip_add_driver", lang)}</button>
      </Section>


      <button className="btn-cta calculate-btn" onClick={onCalculate} aria-label={t("aria_calculate", lang)}>
        {t("ip_calculate", lang)}
      </button>
      <button className="btn-ghost reset-btn" onClick={resetToDefaults}>{t("ip_reset", lang)}</button>
    </div>
  );
}
