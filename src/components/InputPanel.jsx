import { useState, useCallback } from 'react';
import { CAR_PRESETS } from '../logic/strategy';

const BUILT_IN_PRESETS = CAR_PRESETS;

export default function InputPanel({ inputs, onChange, onCalculate }) {
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
      tireChangeSecs: 5,
      fuelRateLitersPerSec: 4.0,
      mandatoryStops: 1,
      midRaceMode: false,
      currentLap: '',
      currentFuel: '',
    }));
  };

  /** Update a single compound property (tireLife or mandatory) */
  const updateCompound = (compoundId, key, value) => {
    onChange(prev => ({
      ...prev,
      compounds: prev.compounds.map(c =>
        c.id === compoundId ? { ...c, [key]: value } : c
      ),
    }));
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
          <label htmlFor="pitBaseSecs">Base Pit Time (sec)</label>
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
          <label htmlFor="tireChangeSecs">Tire Change Time (sec)</label>
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
                <th>Tire Life</th>
                <th>Start Lap</th>
                <th>Half Lap</th>
                <th>End Lap</th>
                <th>Req'd</th>
              </tr>
            </thead>
            <tbody>
              {inputs.compounds.map(comp => (
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
                      className="compound-laptime-input"
                      placeholder="M:SS"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={comp.halfLapTime || ''}
                      onChange={(e) => updateCompound(comp.id, 'halfLapTime', e.target.value)}
                      className="compound-laptime-input"
                      placeholder="M:SS"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={comp.endLapTime || ''}
                      onChange={(e) => updateCompound(comp.id, 'endLapTime', e.target.value)}
                      className="compound-laptime-input"
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
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-hint">Set Tire Life to 0 to exclude a compound. Lap times use M:SS format. Toggle "Req'd" for mandatory.</p>
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
          </>
        )}
      </section>

      <button className="btn-cta calculate-btn" onClick={onCalculate}>Calculate Strategy</button>
      <button className="btn-ghost reset-btn" onClick={resetToDefaults}>Reset to Defaults</button>
    </div>
  );
}
