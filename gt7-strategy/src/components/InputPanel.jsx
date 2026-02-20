import { useState, useCallback } from 'react';
import { TIRE_COMPOUNDS, CAR_PRESETS } from '../logic/strategy';

const BUILT_IN_PRESETS = CAR_PRESETS;

const DEFAULT_INPUTS = {
  raceDurationHours: 8,
  lapTime: '2:00',
  tankSize: 100,
  fuelPerLap: 3.5,
  fuelMap: 1.0,
  tireWearLaps: 30,
  compoundId: 'RH',
  pitTimeLoss: 60,
  mandatoryStops: 1,
  midRaceMode: false,
  currentLap: '',
  currentFuel: '',
};

export default function InputPanel({ inputs, onChange }) {
  const [savedPresets, setSavedPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gt7-presets') || '[]');
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState('');

  const handleChange = useCallback((key, value) => {
    onChange(prev => ({ ...prev, [key]: value }));
  }, [onChange]);

  const handleNum = (key) => (e) => handleChange(key, e.target.value === '' ? '' : Number(e.target.value));
  const handleStr = (key) => (e) => handleChange(key, e.target.value);

  const loadPreset = (preset) => {
    onChange(prev => ({
      ...prev,
      tankSize: preset.tankSize,
      fuelPerLap: preset.fuelPerLap,
      tireWearLaps: preset.tireWearLaps,
    }));
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    const preset = {
      id: Date.now().toString(),
      name: presetName.trim(),
      tankSize: inputs.tankSize,
      fuelPerLap: inputs.fuelPerLap,
      tireWearLaps: inputs.tireWearLaps,
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
    onChange(() => ({ ...DEFAULT_INPUTS }));
  };

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
              title={`Tank: ${preset.tankSize}L | Fuel: ${preset.fuelPerLap}L/lap | Tires: ${preset.tireWearLaps} laps`}
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
          <label htmlFor="raceDuration">Race Duration (hours)</label>
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
          <label htmlFor="lapTime">Avg Lap Time (M:SS)</label>
          <input
            id="lapTime"
            type="text"
            placeholder="2:00"
            value={inputs.lapTime}
            onChange={handleStr('lapTime')}
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

        <div className="field-group">
          <label htmlFor="pitTimeLoss">Pit Stop Time Loss (seconds)</label>
          <input
            id="pitTimeLoss"
            type="number"
            min="10"
            max="300"
            step="1"
            value={inputs.pitTimeLoss}
            onChange={handleNum('pitTimeLoss')}
          />
        </div>
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
          <label htmlFor="fuelPerLap">Fuel Use Per Lap (L)</label>
          <input
            id="fuelPerLap"
            type="number"
            min="0.5"
            max="20"
            step="0.1"
            value={inputs.fuelPerLap}
            onChange={handleNum('fuelPerLap')}
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
              onChange={handleStr('fuelMap')}
            />
            <span className="slider-value">{Number(inputs.fuelMap).toFixed(2)}×</span>
          </div>
        </div>
      </section>

      {/* ── Tire Settings ── */}
      <section className="input-section">
        <h3 className="section-title">Tire Settings</h3>

        <div className="field-group">
          <label htmlFor="tireWearLaps">Tire Life — Base Laps</label>
          <input
            id="tireWearLaps"
            type="number"
            min="5"
            max="150"
            step="1"
            value={inputs.tireWearLaps}
            onChange={handleNum('tireWearLaps')}
          />
        </div>

        <div className="field-group">
          <label htmlFor="compound">Tire Compound</label>
          <select
            id="compound"
            value={inputs.compoundId}
            onChange={handleStr('compoundId')}
          >
            {TIRE_COMPOUNDS.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.wearMultiplier < 1 ? 'more durable' : c.wearMultiplier === 1 ? 'baseline' : 'less durable'})
              </option>
            ))}
          </select>
        </div>
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
                onChange={handleStr('currentLap')}
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
                onChange={handleStr('currentFuel')}
              />
            </div>
          </>
        )}
      </section>

      <button className="btn-ghost reset-btn" onClick={resetToDefaults}>Reset to Defaults</button>
    </div>
  );
}
