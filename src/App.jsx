import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import InputPanel from "./components/InputPanel";
import ResultsSummary from "./components/ResultsSummary";
import StintTable from "./components/StintTable";
import StrategyTimeline from "./components/StrategyTimeline";
import { useStrategy } from "./hooks/useStrategy";
import { useTelemetry } from "./hooks/useTelemetry";
import { useCompoundDetector } from "./hooks/useCompoundDetector";
import { useStintLog } from "./hooks/useStintLog";
import { useTrackMap } from "./hooks/useTrackMap";
import { useTelemetryLearner } from "./hooks/useTelemetryLearner";
import { applyRecommendation } from "./logic/recommendations";
import { pickAutoConnectIp } from "./logic/connection";
import LiveDashboard, { TrackMap } from "./components/LiveDashboard";
import TelemetryLeaderboard from "./components/TelemetryLeaderboard";
import TelemetryControls from "./components/TelemetryControls";
import LearnerRecommendations from "./components/LearnerRecommendations";
import NowView from "./components/NowView";
import Onboarding from "./components/Onboarding";
import TeamPanel from "./components/TeamPanel";
import DriversTab from "./components/DriversTab";
import { CAR_PRESETS } from "./logic/strategy";
import { mergeAnalysisIntoInputs, mergeDriverSessions } from "./logic/sessionAnalysis";
import { teamColor, resolveActiveCars } from "./logic/teams";
import {
  INPUTS_KEY, buildSnapshot, validateSnapshot, applySnapshot, clearRace,
  loadInputs, snapshotFilename,
} from "./logic/racePersistence";
import { DEFAULT_LANG, t } from "./i18n/strings";

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
  // Restored silently, the way team names and tyres already are. An 8-hour
  // race should not be lost to an accidental refresh.
  const [inputs, setInputs] = useState(() => {
    try { return loadInputs(localStorage.getItem(INPUTS_KEY), DEFAULT_INPUTS); }
    catch { return DEFAULT_INPUTS; }
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [telemSelectedIp, setTelemSelectedIp] = useState("");
  // Single-team is the default landing experience (Phase 2, Task 2.2). The
  // multi-team leaderboard still exists but is demoted behind an Advanced toggle.
  const [activeTab, setActiveTab] = useState("now");
  const [showAdvancedLb, setShowAdvancedLb] = useState(false);

  // First-run onboarding gate (Phase 3, Task 3.3).
  const [onboarded, setOnboarded] = useState(() => {
    try { return localStorage.getItem("gt7-onboarded") === "1"; }
    catch { return true; }
  });

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

  // Which car is mine. Everything strategy-side (drivers, stint log, learner,
  // mid-race auto-fill) follows this and not the row you happen to be clicking.
  const [myTeamIp, setMyTeamIp] = useState(() => {
    try { return localStorage.getItem("gt7-my-team") || ""; }
    catch { return ""; }
  });

  const handledPitsRef = useRef(new Set());
  const autoScannedRef = useRef(false);
  const autoOpenedLbRef = useRef(false);
  const telem    = useTelemetry();
  const detector = useCompoundDetector(telem.teams);
  const stintLog = useStintLog(telem.teams, teamCompounds, inputs.drivers, myTeamIp || null);
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
      // Clearing has to be written too. Persisting only non-null values meant a
      // pit stop cleared the compound on screen but left the old one on disk,
      // so reloading the page brought back the tyre the car was on BEFORE the
      // stop — worse than showing nothing, because it reads as confirmed.
      if (persist) localStorage.setItem("gt7-team-compounds", JSON.stringify(next));
      return next;
    });
  }, [detector]);

  const teamKeys = useMemo(() => [...telem.teams.keys()], [telem.teams]);
  const getTeamLabel = useCallback((ip) => teamLabels[ip] || ip, [teamLabels]);

  // strategyIp = my car (owns drivers/stint log/learner/auto-fill).
  // displayIp  = the car the dashboard is inspecting, free to follow a click.
  const { strategyIp, displayIp } = useMemo(
    () => resolveActiveCars({ myTeamIp, selectedIp: telemSelectedIp, teamKeys }),
    [myTeamIp, telemSelectedIp, teamKeys],
  );

  const setMyTeam = useCallback((ip) => {
    setMyTeamIp((prev) => {
      const next = prev === ip ? "" : ip;
      try { localStorage.setItem("gt7-my-team", next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // The learner proposes changes to MY car model, so it must read my car —
  // never whichever rival's row happens to be selected.
  const learner = useTelemetryLearner({
    activeIp: strategyIp,
    data: strategyIp ? telem.teams.get(strategyIp) : null,
    inputs,
    confirmedCompoundId: (strategyIp && teamCompounds[strategyIp]) || "",
  });

  const acceptRecommendation = useCallback((rec) => {
    setInputs((prev) => applyRecommendation(prev, rec));
    learner.clearDismiss(rec);
    setSelectedIndex(0);
  }, [learner]);

  // The circuit outline is a property of the track, not of any one car, so it
  // can be traced from whoever is transmitting. Tying it to the selected car
  // meant a multi-car event drew nothing until someone was picked by hand —
  // and with no recorded bounds the map cannot place ANY car's dot, so the
  // whole field stayed invisible. (Which car is *mine* is a separate question,
  // still answered only by an explicit pick, per DECISION 4.)
  const mapSourceIp = displayIp ?? teamKeys[0] ?? null;
  const { mapRef, resetMap } = useTrackMap(
    telem.teams.get(mapSourceIp ?? ''),
    // Only my own car entering the pits may clear my compound — never some
    // other team's car that happens to be tracing the outline.
    () => { if (strategyIp && mapSourceIp === strategyIp) updateTeamCompound(strategyIp, null, false); },
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

  // Auto-connect on launch (Phase 3, Task 3.1): connect to the relay and let the
  // hook hold the link with capped-backoff auto-reconnect. The user does not
  // normally type IPs or press connect; manual override still works.
  useEffect(() => {
    telem.connect(telemUrl, ps5IPs.map((ip) => ip.trim()).filter(Boolean));
    // Mount-only: intentionally not re-running on telemUrl/ps5IPs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once connected with no IPs configured yet, auto-scan the LAN once.
  useEffect(() => {
    if (telem.connected && !autoScannedRef.current && !ps5IPs.some((ip) => ip.trim())) {
      autoScannedRef.current = true;
      telem.scan();
    }
  }, [telem.connected, telem, ps5IPs]);

  // Write the race setup back to disk shortly after it settles. Debounced so
  // typing a lap time is not a write per keystroke; 400 ms is far below the
  // time it takes to lose a browser, so nothing meaningful is ever at risk.
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(INPUTS_KEY, JSON.stringify(inputs)); }
      catch { /* storage full or blocked — the app keeps working */ }
    }, 400);
    return () => clearTimeout(id);
  }, [inputs]);

  /** Start a new race: clear this race's data, keep the circuit and presets. */
  const startNewRace = useCallback(() => {
    if (!window.confirm(
      "Effacer cette course ?\n\nPilotes, stratégie, noms d'équipe, pneus et journal "
      + 'des relais seront remis à zéro. La carte du circuit et vos préréglages sont conservés.',
    )) return;
    try { clearRace((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    window.location.reload();
  }, []);

  /** Download everything needed to rebuild this session elsewhere. */
  const exportRace = useCallback(() => {
    try {
      const snap = buildSnapshot((k) => localStorage.getItem(k));
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = snapshotFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }, []);

  const importRace = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let snap;
      try { snap = JSON.parse(String(reader.result)); }
      catch { window.alert('Fichier illisible.'); return; }

      const check = validateSnapshot(snap);
      if (!check.ok) { window.alert(`Import impossible : ${check.reason}.`); return; }
      if (!window.confirm(
        'Restaurer cette sauvegarde ?\n\nElle remplacera la course en cours.',
      )) return;

      applySnapshot(snap, (k, v) => localStorage.setItem(k, v));
      window.location.reload();
    };
    reader.readAsText(file);
  }, []);

  // Once a second car shows up this is a multi-car event, so reveal the
  // leaderboard rather than leaving the whole field hidden behind a toggle.
  // Fires once — closing it afterwards sticks.
  useEffect(() => {
    if (!autoOpenedLbRef.current && telem.teams.size > 1) {
      autoOpenedLbRef.current = true;
      setShowAdvancedLb(true);
    }
  }, [telem.teams.size]);

  // Auto-pick a PS5 only when exactly one is found (DECISION 4); otherwise leave
  // it to the user to choose in the telemetry controls.
  useEffect(() => {
    if (ps5IPs.some((ip) => ip.trim())) return;
    const ip = pickAutoConnectIp(telem.scanResults);
    if (ip) savePS5IPs([ip]);
  }, [telem.scanResults, ps5IPs, savePS5IPs]);

  const best = result?.best ?? null;
  const ranked = result?.ranked ?? [];
  const selectedStrategy = ranked[selectedIndex] ?? best;


  // --- "Now" view live state (Phase 2) ---
  // Freeze-plan toggle (DECISION 2): hold the plan steady so nothing shifts
  // mid-corner. Snapshotting on freeze (in the click handler) keeps the plan
  // pinned to what was on screen at that moment; unfrozen tracks the live best.
  const [planFrozen, setPlanFrozen] = useState(false);
  const [frozenBest, setFrozenBest] = useState(null);
  const toggleFreeze = useCallback(() => {
    if (!planFrozen) setFrozenBest(best); // about to freeze → snapshot current best
    setPlanFrozen((f) => !f);
  }, [planFrozen, best]);
  const nowBest = planFrozen ? frozenBest : best;

  // Best available fuel/lap: the learner's confident estimate, else derived from
  // the active (accepted/manual) inputs. The plan source stays the active inputs.
  const nowLitersPerLap = useMemo(() => {
    const est = learner.estimates;
    if (est && est.trust?.fuel?.confident && est.litersPerLap) return est.litersPerLap;
    const lpt = Number(inputs.lapsPerFullTank);
    const tank = Number(inputs.tankSize);
    return lpt > 0 ? tank / lpt : null;
  }, [learner.estimates, inputs.lapsPerFullTank, inputs.tankSize]);

  const nowCompoundId = (strategyIp && teamCompounds[strategyIp]) || null;
  const nowTireLife = nowCompoundId
    ? Number(inputs.compounds.find((c) => c.id === nowCompoundId)?.tireLife) || 0
    : 0;

  // --- Onboarding (Phase 3, Task 3.3) ---
  const detectedIp = strategyIp || pickAutoConnectIp(telem.scanResults);
  const completeOnboarding = useCallback(() => {
    try { localStorage.setItem("gt7-onboarded", "1"); } catch { /* ignore */ }
    setOnboarded(true);
    setActiveTab("now");
  }, []);
  const applyCarPreset = useCallback((preset) => {
    setInputs((prev) => ({
      ...prev,
      tankSize: preset.tankSize,
      lapsPerFullTank: preset.lapsPerFullTank,
      raceDurationHours: preset.raceDurationHours,
    }));
  }, []);

  // Apply recorded session(s), on the user's explicit click only. One session fills
  // the car model and keeps the user's driver setup; two or more build the team
  // (each driver's measured pace → the engine's per-driver model). Race length and
  // pit timings are always preserved.
  const applySessions = useCallback((sessions) => {
    if (!sessions || !sessions.length) return;
    setInputs((prev) =>
      sessions.length === 1 ? mergeAnalysisIntoInputs(sessions[0].analysis, prev) : mergeDriverSessions(sessions, prev)
    );
    setSelectedIndex(0);
  }, []);

  return (
    <div className="app-root">
      {!onboarded && (
        <Onboarding
          telem={telem}
          detectedIp={detectedIp}
          carPresets={CAR_PRESETS}
          onApplyCarPreset={applyCarPreset}
          onRescan={() => telem.scan()}
          onComplete={completeOnboarding}
          lang={DEFAULT_LANG}
        />
      )}
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
          <button className="btn-header-ghost" onClick={exportRace} title="Télécharger une sauvegarde de la course">
            Sauvegarder
          </button>
          <label className="btn-header-ghost" title="Restaurer une sauvegarde">
            Restaurer
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => { importRace(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          <button className="btn-header-ghost" onClick={startNewRace} title="Effacer la course en cours">
            Nouvelle course
          </button>
        </div>
      </header>

      <main className={`app-main${activeTab === 'telemetry' ? ' app-main--telemetry' : ''}`}>
        <aside className="sidebar">
          <TeamPanel onBuild={applySessions} lang={DEFAULT_LANG} />
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
              className={`tab-btn${activeTab === "now" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("now")}
            >
              {t("now_tab", DEFAULT_LANG)}
              {telem.connected && telem.teams.size > 0 && (
                <span className="tab-live-dot" />
              )}
            </button>
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
            <button
              className={`tab-btn${activeTab === "drivers" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("drivers")}
            >
              Pilotes
              {stintLog.pendingDriverIps.size > 0 && (
                <span className="tab-live-dot" />
              )}
            </button>
          </div>

          {activeTab === "now" && (
            <div className="tab-content tab-content--now">
              <LearnerRecommendations
                recommendations={learner.recommendations}
                onAccept={acceptRecommendation}
                onIgnore={learner.ignore}
              />
              <NowView
                data={strategyIp ? telem.teams.get(strategyIp) : null}
                strategy={nowBest?.strategy ?? null}
                planLabel={nowBest?.label ?? null}
                litersPerLap={nowLitersPerLap}
                tireLife={nowTireLife}
                frozen={planFrozen}
                onToggleFreeze={toggleFreeze}
                label={strategyIp ? getTeamLabel(strategyIp) : null}
                lang={DEFAULT_LANG}
              />
            </div>
          )}

          {activeTab === "strategy" && (
            <div className={`tab-content${calculating ? " results-calculating" : ""}`}>
              <LearnerRecommendations
                recommendations={learner.recommendations}
                onAccept={acceptRecommendation}
                onIgnore={learner.ignore}
              />
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

          {activeTab === "drivers" && (
            <div className="tab-content">
              <DriversTab
                logs={stintLog.logs}
                drivers={inputs.drivers}
                minDriverTimeSecs={inputs.minDriverTimeSecs}
                activeIp={strategyIp}
                onReset={stintLog.resetAll}
              />
            </div>
          )}

          {activeTab === "telemetry" && (() => {
            const cars = teamKeys.map((ip, i) => {
              const d = telem.teams.get(ip);
              const raw = teamLabels[ip];
              return {
                id: ip,
                // A short tag, not the full name: a dozen 9-character labels on
                // a 420px-wide map is an unreadable pile on the start grid. The
                // colour plus 3 letters identifies the car; the leaderboard has
                // the full name.
                label: raw ? raw.trim().slice(0, 3).toUpperCase() : `T${i + 1}`,
                posX: d?.posX, posZ: d?.posZ, onTrack: d?.onTrack,
                isOwn: ip === strategyIp,
                color: teamColor(telem.teamOrder.indexOf(ip)),
              };
            });
            const lbProps = {
              teams: telem.teams,
              teamOrder: telem.teamOrder,
              teamLabels,
              teamCompounds,
              pendingIps: detector.pendingIps,
              selectedIp: displayIp,
              onSelect: setTelemSelectedIp,
              onCompoundChange: (ip, c) => updateTeamCompound(ip, c),
              myTeamIp,
              onSetMyTeam: setMyTeam,
              onRenameTeam: updateTeamLabel,
              lapCrossings: telem.lapCrossings,
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
                {telem.teams.size > 0 && (
                  <button
                    className={`advanced-lan-toggle${showAdvancedLb ? " is-open" : ""}`}
                    onClick={() => setShowAdvancedLb((v) => !v)}
                  >
                    {showAdvancedLb
                      ? "Masquer le classement multi-équipes"
                      : `Afficher le classement multi-équipes${telem.teams.size > 1 ? ` (${telem.teams.size})` : ""}`}
                  </button>
                )}
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
                    {showAdvancedLb && (
                      <div className="telem-3col-lb">
                        <TelemetryLeaderboard {...lbProps} />
                      </div>
                    )}
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
                          // Only my own car has a driver roster — offering my
                          // drivers on a rival's dashboard would just log a lie.
                          drivers={displayIp === strategyIp ? inputs.drivers : null}
                          currentDriverId={stintLog.logs.get(displayIp)?.current?.driverId ?? null}
                          pendingDriver={stintLog.pendingDriverIps.has(displayIp)}
                          onDriverChange={(id) => stintLog.assignDriver(displayIp, id)}
                          // Tyre life is counted in laps since this set went
                          // on, measured against the life configured for that
                          // compound — GT7 reports no wear of its own.
                          tyreLaps={(() => {
                            const open = stintLog.logs.get(displayIp)?.current;
                            const lap = telem.teams.get(displayIp)?.currentLap;
                            return open && lap != null ? Math.max(0, lap - open.startLap) : null;
                          })()}
                          tyreLife={Number(
                            inputs.compounds.find((c) => c.id === teamCompounds[displayIp])?.tireLife,
                          ) || null}
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
