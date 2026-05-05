import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import InputPanel from "./components/InputPanel";
import ResultsSummary from "./components/ResultsSummary";
import StintTable from "./components/StintTable";
import StrategyTimeline from "./components/StrategyTimeline";
import { useStrategy } from "./hooks/useStrategy";
import { useTelemetry } from "./hooks/useTelemetry";
import { useCompoundDetector } from "./hooks/useCompoundDetector";
import { useTrackMap } from "./hooks/useTrackMap";
import LiveDashboard, { TrackMap } from "./components/LiveDashboard";
import TelemetryLeaderboard from "./components/TelemetryLeaderboard";
import TelemetryControls from "./components/TelemetryControls";

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
  const [activeTab, setActiveTab] = useState("strategy");

  const [ps5IPs, setPS5IPs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-ps5-ips") || '[""]'); }
    catch { return [""]; }
  });
  const [telemUrl, setTelemUrl] = useState("ws://localhost:20777");

  const [teamLabels, setTeamLabels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-team-labels") || "{}"); }
    catch { return {}; }
  });

  const [teamCompounds, setTeamCompounds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-team-compounds") || "{}"); }
    catch { return {}; }
  });

  const handledPitsRef = useRef(new Set());
  const telem    = useTelemetry();
  const detector = useCompoundDetector(telem.teams);
  const { result, calculating, calculate } = useStrategy(inputs);

  const savePS5IPs = useCallback((ips) => {
    setPS5IPs(ips);
    localStorage.setItem("gt7-ps5-ips", JSON.stringify(ips));
    if (telem.connected) telem.sendIPs(ips.map(ip => ip.trim()).filter(Boolean));
  }, [telem.connected, telem.sendIPs]);

  const updateTeamCompound = useCallback((ip, compound, persist = true) => {
    if (compound !== null) detector.confirmCompound(ip);
    else detector.stopDetecting(ip);
    setTeamCompounds(prev => {
      const next = { ...prev, [ip]: compound };
      if (persist && compound !== null) localStorage.setItem("gt7-team-compounds", JSON.stringify(next));
      return next;
    });
  }, [detector]);

  const teamKeys = useMemo(() => [...telem.teams.keys()], [telem.teams]);
  const getTeamLabel = useCallback((ip) => teamLabels[ip] || ip, [teamLabels]);

  const activeIp = telemSelectedIp || (teamKeys.length === 1 ? teamKeys[0] : null);

  const { mapRef, resetMap } = useTrackMap(
    telem.teams.get(activeIp ?? ''),
    () => activeIp && updateTeamCompound(activeIp, null, false),
  );

  const updateTeamLabel = useCallback((ip, label) => {
    setTeamLabels(prev => {
      const next = { ...prev, [ip]: label };
      localStorage.setItem("gt7-team-labels", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleChange = useCallback((updater) => {
    setInputs((prev) => typeof updater === "function" ? updater(prev) : updater);
  }, []);

  // Auto-clear compound picker when a pit stop is detected for any team
  useEffect(() => {
    for (const [ip, data] of telem.teams) {
      if (!data.pitDetected) continue;
      const key = `${ip}-${data.currentLap}`;
      if (!handledPitsRef.current.has(key)) {
        handledPitsRef.current.add(key);
        updateTeamCompound(ip, null);
      }
    }
  }, [telem.teams, updateTeamCompound]);

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

  const displayIp = activeIp;

  return (
    <div className="app-root">
      <header className="app-header">
        <CheckeredFlag />
        <div className="header-titles">
          <h1 className="header-title">GT7 Stratégie Course</h1>
          <p className="header-subtitle">Calculateur Arrêt Pit</p>
        </div>
        <div className="header-actions">
          {telem && (
            <div className={`telem-badge${telem.connected ? " live" : ""}`}>
              <span className={`telem-dot${telem.connected ? " live" : ""}`} />
              {telem.connected ? "Télémétrie En Direct" : "Télémétrie Hors Ligne"}
            </div>
          )}
          {best && (
            <button className="btn-header-ghost" onClick={() => window.print()}>
              Imprimer
            </button>
          )}
        </div>
      </header>

      <main className={`app-main${activeTab === 'telemetry' ? ' app-main--telemetry' : ''}`}>
        <aside className="sidebar">
          <InputPanel
            inputs={inputs}
            onChange={handleChange}
            onCalculate={() => { setSelectedIndex(0); calculate(); }}
            telem={telem}
            telemSelectedIp={telemSelectedIp}
            onTelemSelect={setTelemSelectedIp}
            teamLabels={teamLabels}
          />
        </aside>

        <section className="results-area">
          <div className="tab-bar">
            <button
              className={`tab-btn${activeTab === "strategy" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("strategy")}
            >
              Stratégie
            </button>
            <button
              className={`tab-btn${activeTab === "telemetry" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("telemetry")}
            >
              Télémétrie
              {telem.connected && telem.teams.size > 0 && (
                <span className="tab-live-dot" />
              )}
            </button>
          </div>

          {activeTab === "strategy" && (
            <div className={`tab-content${calculating ? " results-calculating" : ""}`}>
              {calculating && best && (
                <div className="recalc-badge">Recalculating&hellip;</div>
              )}
              {!best ? (
                <div className="empty-state">
                  <div className="empty-circuit-wrap">
                    <CircuitSVG />
                  </div>
                  <div className="empty-text-block">
                    <p className="empty-title">Aucune Donnée</p>
                    <p className="empty-text">
                      Configurez vos paramètres dans le panneau et appuyez sur{" "}
                      <strong>Calculer la Stratégie</strong> pour énumérer toutes les séquences valides.
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
            </div>
          )}

          {activeTab === "telemetry" && (() => {
            const cars = teamKeys.map((ip, i) => {
              const d = telem.teams.get(ip);
              const raw = teamLabels[ip];
              return {
                label: raw ? raw.slice(0, 9) : `T${i + 1}`,
                posX: d?.posX, posZ: d?.posZ, onTrack: d?.onTrack,
                isOwn: ip === displayIp,
                colorIdx: i,
              };
            });
            const lbProps = {
              teams: telem.teams,
              teamLabels,
              teamCompounds,
              pendingIps: detector.pendingIps,
              selectedIp: displayIp,
              onSelect: setTelemSelectedIp,
              onCompoundChange: (ip, c) => updateTeamCompound(ip, c),
            };
            return (
              <div className="tab-content tab-content--telemetry">
                <TelemetryControls
                  telem={telem}
                  ps5IPs={ps5IPs}
                  onSavePS5IPs={savePS5IPs}
                  telemUrl={telemUrl}
                  setTelemUrl={setTelemUrl}
                  teamLabels={teamLabels}
                  onTeamLabelChange={updateTeamLabel}
                />
                {telem.teams.size === 0 ? (
                  <div className="empty-state">
                    <div className="empty-text-block">
                      <p className="empty-title">
                        {telem.connected ? "En attente de données PS5" : "Télémétrie Hors Ligne"}
                      </p>
                      <p className="empty-text">
                        {telem.connected
                          ? "Ajoutez une IP PS5 ci-dessus et commencez à rouler dans GT7."
                          : "Connectez-vous au serveur relais, puis ajoutez les IPs PS5."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="telem-3col">
                    <div className="telem-3col-lb">
                      <TelemetryLeaderboard {...lbProps} />
                    </div>
                    <div className="telem-3col-map">
                      <TrackMap
                        currentLap={telem.teams.get(displayIp)?.currentLap ?? 0}
                        cars={cars}
                        mapRef={mapRef}
                        onReset={resetMap}
                      />
                    </div>
                    <div className="telem-3col-data">
                      {displayIp ? (
                        <LiveDashboard
                          data={telem.teams.get(displayIp)}
                          label={`T${teamKeys.indexOf(displayIp) + 1} · ${getTeamLabel(displayIp)}`}
                          compound={teamCompounds[displayIp] || null}
                          pendingConfirmation={detector.pendingIps.has(displayIp)}
                          onCompoundChange={(c) => updateTeamCompound(displayIp, c)}
                          onPitEntry={() => updateTeamCompound(displayIp, null, false)}
                        />
                      ) : (
                        <div className="telem-no-sel">
                          <p>Sélectionnez une équipe dans le tableau</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      </main>

      <footer className="app-footer">
        Calculateur Stratégie GT7 &middot; Estimations uniquement &mdash; vérifier avec les données du jeu
      </footer>
    </div>
  );
}
