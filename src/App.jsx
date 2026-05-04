import { useState, useCallback, useEffect } from "react";
import InputPanel from "./components/InputPanel";
import ResultsSummary from "./components/ResultsSummary";
import StintTable from "./components/StintTable";
import StrategyTimeline from "./components/StrategyTimeline";
import { useStrategy } from "./hooks/useStrategy";
import { useTelemetry } from "./hooks/useTelemetry";

const DEFAULT_INPUTS = {
  raceDurationHours: 8,
  tankSize: 100,
  lapsPerFullTank: 28,
  fuelMap: 1.0,
  compounds: [
    { id: "H",  name: "Hard",         tireLife: 60, mandatory: false, startLapTime: "2:00", halfLapTime: "2:01", endLapTime: "2:03" },
    { id: "M",  name: "Medium",       tireLife: 40, mandatory: false, startLapTime: "1:58", halfLapTime: "2:00", endLapTime: "2:03" },
    { id: "S",  name: "Soft",         tireLife: 25, mandatory: false, startLapTime: "1:56", halfLapTime: "1:59", endLapTime: "2:03" },
    { id: "IM", name: "Intermediate", tireLife: 0,  mandatory: false, startLapTime: "2:05", halfLapTime: "2:07", endLapTime: "2:10" },
    { id: "W",  name: "Wet",          tireLife: 0,  mandatory: false, startLapTime: "2:10", halfLapTime: "2:13", endLapTime: "2:17" },
  ],
  pitBaseSecs: 25,
  tireChangeSecs: 27,
  fuelRateLitersPerSec: 4.0,
  fuelWeightPenaltyPerLiter: 0.03,
  drivers: [{ id: "d1", name: "Driver 1", compounds: {} }],
  minDriverTimeSecs: 7200,
  mandatoryStops: 1,
  midRaceMode: false,
  currentLap: "",
  currentFuel: "",
  currentCompoundId: "",
  currentTireAgeLaps: "",
};

function CheckeredFlag() {
  const squares = Array.from({ length: 16 });
  return (
    <div className="header-logo" aria-hidden="true">
      <div className="header-logo-flag">
        {squares.map((_, i) => {
          const row = Math.floor(i / 4);
          const col = i % 4;
          const isWhite = (row + col) % 2 === 0;
          return (
            <span
              key={i}
              style={{
                display: "block",
                width: 7,
                height: 7,
                background: isWhite ? "var(--text-primary)" : "var(--bg-base)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CircuitSVG() {
  return (
    <svg
      viewBox="0 0 480 260"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="empty-circuit"
      aria-hidden="true"
    >
      {/* Main circuit outline — stylized endurance layout */}
      <path
        className="circuit-trace"
        d="
          M 55,175
          L 55,145
          Q 55,125 75,115
          L 95,108
          Q 110,102 112,88
          Q 114,70 135,65
          L 195,60
          Q 220,58 230,70
          Q 240,82 255,80
          L 310,72
          Q 355,68 375,95
          L 385,115
          Q 395,138 378,158
          L 355,170
          Q 332,180 325,198
          Q 318,218 295,222
          L 235,225
          Q 200,225 192,208
          L 185,192
          Q 179,178 155,176
          L 100,173
          Q 55,172 55,175
          Z
        "
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1000"
        strokeDasharray="1000"
        strokeDashoffset="1000"
      />
      {/* Start / finish line */}
      <line
        className="circuit-sf"
        x1="55" y1="158"
        x2="55" y2="190"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Sector dividers */}
      <line
        className="circuit-sf"
        x1="230" y1="63"
        x2="245" y2="63"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        className="circuit-sf"
        x1="320" y1="205"
        x2="330" y2="215"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function App() {
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [telemSelectedIp, setTelemSelectedIp] = useState("");

  const handleChange = useCallback((updater) => {
    setInputs((prev) => typeof updater === "function" ? updater(prev) : updater);
  }, []);

  const telem = useTelemetry();
  const { result, calculating, calculate } = useStrategy(inputs);

  useEffect(() => {
    if (!telemSelectedIp) return;
    const data = telem.teams.get(telemSelectedIp);
    if (!data) return;
    setInputs((prev) => {
      if (!prev.midRaceMode) return prev;
      return {
        ...prev,
        currentLap: data.currentLap ?? prev.currentLap,
        currentFuel: data.fuelLiters != null
          ? Math.round(data.fuelLiters * 10) / 10
          : prev.currentFuel,
      };
    });
  }, [telem.teams, telemSelectedIp]);

  const best = result?.best ?? null;
  const ranked = result?.ranked ?? [];
  const selectedStrategy = ranked[selectedIndex] ?? best;

  return (
    <div className="app-root">
      <header className="app-header">
        <CheckeredFlag />
        <div className="header-titles">
          <h1 className="header-title">GT7 Race Strategy</h1>
          <p className="header-subtitle">Endurance Pit Calculator</p>
        </div>
        <div className="header-actions">
          {telem && (
            <div className={`telem-badge${telem.connected ? " live" : ""}`}>
              <span className={`telem-dot${telem.connected ? " live" : ""}`} />
              {telem.connected ? "Live Telemetry" : "Telemetry Offline"}
            </div>
          )}
          {best && (
            <button className="btn-header-ghost" onClick={() => window.print()}>
              Print
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar">
          <InputPanel
            inputs={inputs}
            onChange={handleChange}
            onCalculate={() => { setSelectedIndex(0); calculate(); }}
            telem={telem}
            telemSelectedIp={telemSelectedIp}
            onTelemSelect={setTelemSelectedIp}
          />
        </aside>

        <section className={`results-area${calculating ? " results-calculating" : ""}`}>
          {calculating && best && (
            <div className="recalc-badge">Recalculating&hellip;</div>
          )}

          {!best ? (
            <div className="empty-state">
              <div className="empty-circuit-wrap">
                <CircuitSVG />
              </div>
              <div className="empty-text-block">
                <p className="empty-title">No Race Data</p>
                <p className="empty-text">
                  Configure your race parameters in the sidebar and press{" "}
                  <strong>Calculate Strategy</strong> to enumerate all valid pit sequences.
                </p>
              </div>
            </div>
          ) : (
            <>
              <ResultsSummary
                ranked={ranked}
                best={best}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />
              <StrategyTimeline
                stints={selectedStrategy.strategy.stints}
                totalLaps={selectedStrategy.strategy.totalLaps}
              />
              <StintTable stints={selectedStrategy.strategy.stints} />
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        GT7 Strategy Calculator &middot; Estimates only &mdash; verify with in-game data
      </footer>
    </div>
  );
}
