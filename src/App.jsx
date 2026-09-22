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
import { RACE_START_KEY, raceProgress, applyRaceClock, formatClock } from "./logic/raceClock";
import { conditionsUnavailable, crossoverSecsPerLap, tyreOnlyPitLoss } from "./logic/conditions";
import { isSafetyCar, safetyCarDeployed, fieldSlowdown, pitLossUnderSafetyCar } from "./logic/carRoles";
import { paceBefore, paceAfter, incidentLapCostMs } from "./logic/paceTrack";
import { lapsOnMe, liveInterval, lapProgress } from "./logic/gaps";
import { positionIfPitNow, undercut, trafficAhead, freshTyreGainSecs } from "./logic/racecraft";
import { measuredLossSecs, effectiveLossSecs } from "./logic/incident";
import { pitNowScenarios, comparePitNow, fullServiceLoss } from "./logic/pitNow";
import { computeStrategy } from "./hooks/useStrategy";
import LiveDashboard, { TrackMap } from "./components/LiveDashboard";
import Dialog from "./components/Dialog";
import Toasts from "./components/Toasts";
import { useToasts } from "./hooks/useToasts";
import { useDialog } from "./hooks/useDialog";
import TelemetryLeaderboard from "./components/TelemetryLeaderboard";
import TelemetryControls from "./components/TelemetryControls";
import LearnerRecommendations from "./components/LearnerRecommendations";
import NowView from "./components/NowView";
import Onboarding from "./components/Onboarding";
import TeamPanel from "./components/TeamPanel";
import DriversTab from "./components/DriversTab";
import { CAR_PRESETS, parseLapTime } from "./logic/strategy";
import { mergeAnalysisIntoInputs, mergeDriverSessions } from "./logic/sessionAnalysis";
import { teamColor, resolveActiveCars } from "./logic/teams";
import {
  INPUTS_KEY, buildSnapshot, validateSnapshot, applySnapshot, clearRace,
  loadInputs, snapshotFilename,
} from "./logic/racePersistence";
import { LANGS, LANG_KEY, loadLang, t, compoundName, compoundSequence } from "./i18n/strings";

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
  drivers: [{ id: "d1", name: "Driver 1", compounds: {} }], // localised by defaultInputs()
  minDriverTimeSecs: 7200,
  // Endurance racing has no mandatory stop count — fuel and tyres decide when
  // the car comes in, not a rule. Left at zero so the plan is driven by the
  // car rather than by a constraint that is not there.
  mandatoryStops: 0,
  conditions: "dry",
  // Seconds lost to damage every lap, and the lap it is repaired on. Declared
  // here so a reload cannot resurrect a penalty the UI has no way to clear.
  pacePenaltySecs: 0,
  pacePenaltyUntilLap: null,
  midRaceMode: false,
  currentLap: "",
  currentFuel: "",
  currentCompoundId: "",
  currentTireAgeLaps: "",
};

/**
 * The defaults, with the one field a human reads localised. Everything else in
 * DEFAULT_INPUTS is a number or a compound id, so only the driver name moves.
 */
function defaultInputs(lang) {
  return {
    ...DEFAULT_INPUTS,
    drivers: [{ id: "d1", name: t("driver_n", lang, { n: 1 }), compounds: {} }],
  };
}

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
  // UI language. Every component takes it as a prop rather than reading a
  // module global, so a switch re-renders the whole tree the normal way. It is
  // declared first because the default inputs below are seeded from it.
  const [lang, setLangState] = useState(() => loadLang((k) => localStorage.getItem(k)));
  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  // Restored silently, the way team names and tyres already are. An 8-hour
  // race should not be lost to an accidental refresh.
  const [inputs, setInputs] = useState(() => {
    const fallback = defaultInputs(lang);
    try { return loadInputs(localStorage.getItem(INPUTS_KEY), fallback); }
    catch { return fallback; }
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  // When the race actually started. The lobby is open for hours beforehand and
  // all of that driving is practice: until this is set, nothing is race data
  // and the plan runs on the configured length rather than a clock.
  const [raceStartedAt, setRaceStartedAt] = useState(() => {
    try {
      const v = Number(localStorage.getItem(RACE_START_KEY));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch { return null; }
  });

  // Ticks the clock for display. Only while a race is running, so an idle app
  // is not re-rendering once a second for nothing.
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    // Unconditional. It used to run only once a race was started, which was
    // fine while the only reader was the race clock — but the track map now
    // places cars from it too, and in the lobby a frozen `now` freezes every
    // car's position around the lap at different, stale fractions. One
    // setState a second is nothing beside a 20 Hz telemetry flush.
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const [telemSelectedIp, setTelemSelectedIp] = useState("");
  // Single-team is the default landing experience (Phase 2, Task 2.2). The
  // multi-team leaderboard still exists but is demoted behind an Advanced toggle.
  // "race" is the merged in-race screen: the plan strip over the field,
  // the map and the selected car. Splitting those across two tabs meant
  // reading the call on one and watching the car obey it on the other.
  const [activeTab, setActiveTab] = useState("race");
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
  // Remembered per machine. At a two-team event the second PC points at the
  // first PC's relay, and that has to survive closing the app.
  const [telemUrl, setTelemUrlState] = useState(() => {
    try { return localStorage.getItem("gt7-relay-url") || "ws://localhost:20777"; }
    catch { return "ws://localhost:20777"; }
  });
  const setTelemUrl = useCallback((url) => {
    setTelemUrlState(url);
    try { localStorage.setItem("gt7-relay-url", url); } catch { /* ignore */ }
  }, []);

  const [teamLabels, setTeamLabels] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-team-labels") || "{}"); }
    catch { return {}; }
  });

  // Which cars are not racing. At an organised event one PS5 is the safety
  // car: it must not take a place, sit in the gap chain, collect a stint log
  // or have its fuel read as if it were racing.
  const [carRoles, setCarRoles] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gt7-car-roles") || "{}"); }
    catch { return {}; }
  });
  const updateCarRoles = useCallback((next) => {
    setCarRoles(next);
    try { localStorage.setItem("gt7-car-roles", JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

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
  // The safety car spends the race going in and out of the pit lane, which is
  // exactly what opens and closes stints and raises tyre prompts. Everything
  // that treats a car as a competitor gets this, not the raw field.
  const racingTeams = useMemo(() => {
    if (!Object.keys(carRoles).length) return telem.teams;
    const out = new Map();
    for (const [ip, packet] of telem.teams) if (!isSafetyCar(carRoles, ip)) out.set(ip, packet);
    return out;
  }, [telem.teams, carRoles]);
  // Every confirmation the app asks goes through one card, so they all behave
  // the same way and none of them is the browser's grey box.
  const dialog = useDialog();
  // Things that happened while you were looking somewhere else. The app
  // already worked them out; on a screen this dense, being ON the screen is
  // not the same as having been seen.
  const toasts = useToasts();
  const detector = useCompoundDetector(racingTeams);
  const stintLog = useStintLog(racingTeams, teamCompounds, inputs.drivers, myTeamIp || null);
  const teamKeys = useMemo(() => [...telem.teams.keys()], [telem.teams]);
  const getTeamLabel = useCallback((ip) => teamLabels[ip] || ip, [teamLabels]);

  // strategyIp = my car (owns drivers/stint log/learner/auto-fill).
  // displayIp  = the car the dashboard is inspecting, free to follow a click.
  const { strategyIp, displayIp } = useMemo(
    () => resolveActiveCars({ myTeamIp, selectedIp: telemSelectedIp, teamKeys }),
    [myTeamIp, telemSelectedIp, teamKeys],
  );

  // My car's live state, reduced to the few scalars the plan actually needs.
  // Reading them out here rather than passing the packet around matters: the
  // teams Map gets a fresh identity on every 50 ms flush, so anything that
  // depends on it recomputes twenty times a second.
  const myLive = strategyIp ? telem.teams.get(strategyIp) : null;
  const myLap = myLive?.currentLap ?? null;
  // Whole litres. The engine plans stints in laps and does not need tenths;
  // quantising here is what stops the strategy being re-run on every packet,
  // which with useStrategy's 600 ms debounce would mean it never ran at all.
  const myFuelL = myLive?.fuelLiters != null ? Math.round(myLive.fuelLiters) : null;

  // Laps on the set my car is running, from the stint log.
  const openTyreLaps = useMemo(() => {
    const open = strategyIp ? stintLog.logs.get(strategyIp)?.current : null;
    return open && myLap != null ? Math.max(0, myLap - open.startLap) : null;
  }, [strategyIp, stintLog.logs, myLap]);

  // While a race is running the plan is built from what is LEFT of it, not
  // from the configured length — which is the field you would otherwise be
  // retyping every few minutes from the pit wall. Quantised to the minute by
  // raceProgress, so the search runs once a minute rather than once a second.
  const clock = useMemo(
    () => raceProgress(raceStartedAt, inputs.raceDurationHours, clockNow),
    [raceStartedAt, inputs.raceDurationHours, clockNow],
  );
  const remainingMins = clock ? clock.remainingMins : null;

  /**
   * What the engine actually runs on: the user's setup, reconciled with the
   * race clock and with where my car really is.
   *
   * The clock alone was not enough and was quietly wrong. Shortening
   * `raceDurationHours` without `midRaceMode` left the engine planning the
   * remaining four hours *from lap 1, on a full tank, on fresh tyres* — so the
   * plan's stints were numbered 1..N of the remainder while every consumer
   * compared them against the car's absolute lap, and from about half distance
   * the Now view told the engineer "run to the flag" for the rest of the race.
   *
   * Derived in one place, from `strategyIp` only. It replaces an effect that
   * wrote the same fields from `telemSelectedIp` — the car you are LOOKING at —
   * so clicking a rival's row rebuilt your plan from their lap and fuel and
   * persisted it. There is now one writer (the user, via InputPanel) and one
   * deriver (this).
   */
  const engineInputs = useMemo(() => {
    let next = applyRaceClock(inputs, remainingMins != null ? { remainingMins } : null);

    // Only once a race has been started AND my car is transmitting. With no
    // telemetry the user's own mid-race toggle is left to mean what it says.
    if (clock && myLap != null) {
      next = {
        ...next,
        midRaceMode: true,
        currentLap: myLap,
        currentFuel: myFuelL,
        currentCompoundId: teamCompounds[strategyIp] || null,
        currentTireAgeLaps: openTyreLaps ?? 0,
      };
    }

    // Damage does not last the race: the car is repaired at the next stop. The
    // penalty is stored as the lap it stops applying ON, and turned into a
    // countdown here, so it shrinks as the car gets closer and expires by
    // itself at the stop rather than quietly slowing the whole plan.
    // `Number(null)` is 0, not NaN, so the null case is checked before coercing
    // — otherwise "never repaired" became "repaired immediately".
    const untilLap = inputs.pacePenaltyUntilLap;
    if (Number(inputs.pacePenaltySecs) > 0 && untilLap != null && myLap != null) {
      next = { ...next, pacePenaltyLaps: Math.max(0, Number(untilLap) - myLap) };
    }
    return next;
  }, [inputs, remainingMins, clock, myLap, myFuelL, teamCompounds, strategyIp, openTyreLaps]);

  const { result, calculating, calculate } = useStrategy(engineInputs);

  const setConditions = useCallback((next) => {
    setInputs((prev) => (prev.conditions === next ? prev : { ...prev, conditions: next }));
    setSelectedIndex(0);
  }, []);

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
    // Whoever the engineer named at the last stop, so each lap is attributed
    // and the learner can fit a curve per driver rather than one for the car.
    currentDriverId: strategyIp ? (stintLog.logs.get(strategyIp)?.current?.driverId ?? null) : null,
    inputs,
    confirmedCompoundId: (strategyIp && teamCompounds[strategyIp]) || "",
  });

  const acceptRecommendation = useCallback((rec) => {
    setInputs((prev) => applyRecommendation(prev, rec));
    learner.clearDismiss(rec);
    setSelectedIndex(0);
  }, [learner]);

  // The circuit outline is a property of the track, not of any one car, so
  // EVERY car traces it. Points are deduplicated into a 3 m grid, so ten cars
  // on the same line cost nothing over one — they only add cells where their
  // lines differ, which is how the track gets its real width. The circuit
  // therefore appears roughly ten times faster, which is the whole value of a
  // lobby session before the race: the map and the pit lane are already there.
  //
  // It also ends a surprise. This used to follow whichever car's dashboard was
  // open, so clicking another leaderboard row silently changed who was drawing
  // and welded the two traces into one line. (Which car is *mine* is a separate
  // question, still answered only by an explicit pick, per DECISION 4 — and
  // only my car's pit entry may clear my compound.)
  const { mapRef, resetMap } = useTrackMap(
    racingTeams,
    strategyIp,
    () => { if (strategyIp) updateTeamCompound(strategyIp, null, false); },
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
  /**
   * The lights go out. Everything that describes THIS race restarts: the stint
   * log, the driver totals it feeds, and the tyres each car is on (nobody's
   * practice set is the one they start on). The circuit, the team names, the
   * roster, the setup and anything the learner picked up in practice are all
   * kept — learning the car during the lobby session is the point of it.
   */
  const startRace = useCallback(async () => {
    if (!await dialog.ask({
      title: t("dlg_start_title", lang),
      body: t("now_start_confirm", lang),
      confirmLabel: t("dlg_start_go", lang),
      danger: true,
    })) return;
    const at = Date.now();
    setRaceStartedAt(at);
    setClockNow(at);
    try { localStorage.setItem(RACE_START_KEY, String(at)); } catch { /* ignore */ }
    stintLog.resetAll();
    setTeamCompounds({});
    // Whatever went wrong in the lobby did not happen in this race, and its
    // lap numbers refer to a counter that is about to reset.
    setIncidentMark(null);
    setInputs((prev) => ({ ...prev, pacePenaltySecs: 0, pacePenaltyUntilLap: null }));
    try { localStorage.setItem("gt7-team-compounds", "{}"); } catch { /* ignore */ }
    setSelectedIndex(0);
    setPlanFrozen(false);
  }, [lang, stintLog, dialog]);

  const clearRaceStart = useCallback(async () => {
    if (!await dialog.ask({
      title: t("dlg_clear_title", lang),
      body: t("now_clear_confirm", lang),
      confirmLabel: t("dlg_clear_go", lang),
    })) return;
    setRaceStartedAt(null);
    try { localStorage.removeItem(RACE_START_KEY); } catch { /* ignore */ }
  }, [lang, dialog]);

  const startNewRace = useCallback(async () => {
    if (!await dialog.ask({
      title: t("dlg_new_race_title", lang),
      body: t("app_new_race_confirm", lang),
      confirmLabel: t("dlg_new_race_go", lang),
      danger: true,
    })) return;
    try { clearRace((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    window.location.reload();
  }, [lang, dialog]);

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
    reader.onload = async () => {
      const problem = (body) => dialog.tell({ title: t("dlg_import_problem_title", lang), body });

      let snap;
      try { snap = JSON.parse(String(reader.result)); }
      catch { problem(t("app_import_unreadable", lang)); return; }

      const check = validateSnapshot(snap);
      if (!check.ok) { problem(t("app_import_failed", lang, { reason: check.reason })); return; }
      if (!await dialog.ask({
        title: t("dlg_import_title", lang),
        body: t("app_import_confirm", lang),
        confirmLabel: t("dlg_import_go", lang),
        danger: true,
      })) return;

      applySnapshot(snap, (k, v) => localStorage.setItem(k, v));
      window.location.reload();
    };
    reader.readAsText(file);
  }, [lang, dialog]);

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

  // The safety car lives in the pit lane, so leaving it is the signal. Under
  // it, the stop itself is no quicker — but the race you are missing is, so
  // less of it goes by while you are stationary.
  /**
   * What a stop THIS LAP does to the race, as opposed to to the plan.
   *
   * The plan is set by fuel range and tyre life, both counted in laps, so
   * racing somebody barely moves it. Where you come out, and whether stopping
   * first gets you past them, are decided by the same one stop — and neither
   * is readable off a gap column. Recomputed on the one-second clock, because
   * all three answers move continuously as the field spreads.
   */
  const racecraft = useMemo(() => {
    if (!strategyIp || !clock) return null;
    const mine = telem.lapCrossings.get(strategyIp);
    if (!mine) return null;

    // Only cars that are racing: a safety car is not in the standings and must
    // not take a place off anyone.
    const racingIps = [...telem.teams.keys()].filter((ip) => !isSafetyCar(carRoles, ip));
    // Without a fuel reading there is no honest cost for a stop, and without
     // that there is no honest answer to "where would I come out". This used to
     // pass 0 for an unknown reading, which quotes a full refuel and overstates
     // the places lost.
    const myFuel = telem.teams.get(strategyIp)?.fuelLiters;
    const pitLoss = fullServiceLoss(inputs, Number.isFinite(Number(myFuel)) ? myFuel : null);
    if (pitLoss == null) return null;
    const name = (ip) => getTeamLabel(ip);

    // GT7's own classification for "where I am now", so the strip agrees with
    // the leaderboard; the geometry only supplies how many places the stop costs.
    const myPos = Number(telem.teams.get(strategyIp)?.racePos) || null;
    const position = positionIfPitNow(
      telem.lapCrossings, strategyIp, pitLoss, clockNow, racingIps, myPos,
    );

    // The car directly ahead of me on the road, which is the one the undercut
    // is against — not whoever happens to be next in the standings.
    const myTrackPos = lapProgress(mine, clockNow);
    let ahead = null;
    if (myTrackPos != null) {
      for (const ip of racingIps) {
        if (ip === strategyIp) continue;
        // Same lap only: you cannot undercut somebody you are lapping.
        if (lapsOnMe(mine, telem.lapCrossings.get(ip), clockNow) != null) continue;
        const p = lapProgress(telem.lapCrossings.get(ip), clockNow);
        if (p == null || p <= myTrackPos) continue;
        if (!ahead || p < ahead.pos) ahead = { ip, pos: p };
      }
    }

    let uc = null;
    if (ahead) {
      const gap = liveInterval(telem.lapCrossings.get(ahead.ip), mine, clockNow);
      const comp = engineInputs.compounds?.find((c) => c.id === teamCompounds[strategyIp]);
      // The engine's compounds carry lap-time STRINGS; the racecraft helper
      // wants the seconds they parse to, which is what tirePaceSecs uses.
      const spec = comp && {
        tireLife: comp.tireLife,
        startSecs: parseLapTime(comp.startLapTime),
        endSecs: parseLapTime(comp.endLapTime),
      };
      const gain = freshTyreGainSecs(spec, openTyreLaps ?? 0);
      if (gap && gap.secs != null && gain > 0) {
        const r = undercut({ gapSecs: gap.secs, myPitLossSecs: pitLoss, theirPitLossSecs: pitLoss, gainPerLapSecs: gain });
        if (r) uc = { ...r, who: name(ahead.ip) };
      }
    }

    const tf = trafficAhead(
      telem.lapCrossings, strategyIp, clockNow,
      (ip) => (racingIps.includes(ip) ? lapsOnMe(mine, telem.lapCrossings.get(ip), clockNow) : null),
    );

    return {
      position: position && {
        ...position,
        // Named here rather than in the pure layer, which has no idea what a
        // car is called.
        ahead: position.ahead && { ...position.ahead, name: name(position.ahead.ip) },
        behind: position.behind && { ...position.behind, name: name(position.behind.ip) },
      },
      undercut: uc,
      traffic: tf && { ...tf, who: name(tf.ip) },
    };
  }, [strategyIp, clock, clockNow, telem.lapCrossings, telem.teams, carRoles, inputs,
      engineInputs.compounds, teamCompounds, openTyreLaps, getTeamLabel]);

  /**
   * A car has finished its stop.
   *
   * For MY car this is the moment the compound and driver have to be recorded,
   * or the stint log and the learner spend the next hour describing a tyre
   * that is not on the car. For a rival it is free intel about what they
   * fitted. Either way the prompt already exists on that car's dashboard, so
   * the notice navigates rather than duplicating the pickers into a corner.
   *
   * Keyed per car and per stop, so the same edge cannot stack two cards, and
   * sticky for my own car: a tyre has to be answered either way.
   */
  /**
   * A new measurement disagrees with the setup.
   *
   * These already surface as Accept/Ignore cards, but those cards live at the
   * top of two tabs and an engineer reading the map will not see one arrive.
   * The toast says a measurement landed; accepting or ignoring it is still a
   * decision made on the card, where the numbers are side by side.
   */
  // Keyed by recommendation, holding the last VALUE raised for it. As a Set of
  // `key:value` strings it grew one entry per distinct decimal the learner ever
  // produced — over eight hours of a figure drifting by hundredths, that is an
  // unbounded cache of numbers nobody will ever look at again. A Map holds at
  // most one entry per recommendation kind, which is a handful.
  const recSeen = useRef(new Map());
  useEffect(() => {
    for (const rec of learner.recommendations) {
      // Keyed on the VALUE, not just the field: the same estimate drifting by
      // a hair must not raise a second notice, but a real change should.
      const value = JSON.stringify(rec.measured);
      if (recSeen.current.get(rec.key) === value) continue;
      recSeen.current.set(rec.key, value);
      toasts.push({
        key: `rec:${rec.key}`,
        kind: 'info',
        title: t("toast_measured", lang, {
          // Through compoundName, like the card that says the same thing:
          // interpolating the raw id put "S lap times" on the notice, and in
          // French an untranslated single letter where a word belongs.
          what: rec.labelKey
            ? t(rec.labelKey, lang, {
                ...(rec.labelVars || {}),
                compound: compoundName(rec.compoundId, lang) || rec.compoundId || '',
              })
            : rec.label,
        }),
        detail: t("toast_measured_detail", lang, {
          measured: Array.isArray(rec.measured) ? rec.measured[0] : rec.measured,
          current: Array.isArray(rec.current) ? rec.current[0] : rec.current,
        }),
        action: {
          label: t("toast_go_plan", lang),
          run: () => setActiveTab("race"),
        },
      });
    }
  }, [learner.recommendations, lang, toasts]);

  const pitExitSeen = useRef(new Map());

  /**
   * Both toast caches describe ONE car in ONE race, so both are dropped when
   * either changes.
   *
   * `pitExitSeen` is keyed by lap number, and GT7's lap counter restarts with
   * the race — which is exactly what the comment in `startRace` says about the
   * incident mark. A stop on lap 3 of the lobby session would otherwise
   * silence the stop on lap 3 of the race, and that toast is the one that says
   * "confirm the tyre and the driver": miss it and the stint log and the
   * learner spend the next stint describing a tyre that is not on the car.
   *
   * `recSeen` is dropped for the same reason plus one of its own: the learner
   * is deliberately NOT reset at the flag (practice is how you learn the car),
   * so without this it would go on suppressing the pre-race version of every
   * measurement it had already raised.
   */
  useEffect(() => {
    pitExitSeen.current.clear();
    recSeen.current.clear();
  }, [raceStartedAt, strategyIp]);
  useEffect(() => {
    for (const [ip, d] of telem.teams) {
      if (!d?.pitExit || isSafetyCar(carRoles, ip)) continue;
      const lap = d.currentLap ?? 0;
      if (pitExitSeen.current.get(ip) === lap) continue;
      pitExitSeen.current.set(ip, lap);

      const mine = ip === strategyIp;
      toasts.push({
        key: `pit:${ip}:${lap}`,
        kind: mine ? 'act' : 'info',
        sticky: mine,
        title: t(mine ? "toast_pit_mine" : "toast_pit_rival", lang, { who: getTeamLabel(ip) }),
        detail: t(mine ? "toast_pit_mine_detail" : "toast_pit_rival_detail", lang),
        action: {
          label: t("toast_go_car", lang),
          run: () => { setActiveTab("race"); setTelemSelectedIp(ip); },
        },
      });
    }
  }, [telem.teams, carRoles, strategyIp, lang, getTeamLabel, toasts]);

  const scDeployedIp = useMemo(
    () => safetyCarDeployed(telem.teams, carRoles),
    [telem.teams, carRoles],
  );
  const scSlowdown = useMemo(
    () => (scDeployedIp ? fieldSlowdown(telem.teams, carRoles) : null),
    [scDeployedIp, telem.teams, carRoles],
  );
  const scPitLoss = pitLossUnderSafetyCar(tyreOnlyPitLoss(inputs), scSlowdown);

  // Something went wrong. Deliberately not a "damage" flag: a spin, a penalty
  // or anything else that makes the plan wrong gets the same treatment, since
  // the questions are the same — what is it costing, and do I stop.
  // GT7 repairs are quick — five seconds covers most of them, and it is not
  // knowable in advance anyway, so it is a constant rather than a field nobody
  // can fill in honestly before the car is already in the box.
  const REPAIR_SECS = 5;

  const [incidentMark, setIncidentMark] = useState(null);
  const markIncident = useCallback(() => {
    // The LAP it happened on, not how many laps were on record. The pace window
    // slides, so a stored index points somewhere else entirely ten laps later —
    // which silently reported the damaged laps as the pace before the damage.
    setIncidentMark({ lap: myLap ?? 0, manualSecs: '' });
  }, [myLap]);
  const clearIncident = useCallback(() => setIncidentMark(null), []);
  const setIncidentLoss = useCallback((v) => {
    setIncidentMark((prev) => (prev ? { ...prev, manualSecs: v } : prev));
  }, []);

  // Everything the incident panel shows, derived rather than stored: the
  // one-off cost of the lap it happened on, the ongoing rate since, and the
  // three-way call between carrying it, repairing at a stop you were making
  // anyway, and coming in now.
  // What the incident cost, measured. Cheap, so it stays a memo.
  const incidentCost = useMemo(() => {
    if (!incidentMark) return null;
    const rec = strategyIp ? telem.pace?.get(strategyIp) : null;
    const oneOffMs = incidentLapCostMs(rec, incidentMark.lap);
    return {
      oneOffSecs: oneOffMs != null ? oneOffMs / 1000 : null,
      lossSecs: effectiveLossSecs(
        incidentMark.manualSecs,
        measuredLossSecs(paceBefore(rec, incidentMark.lap), paceAfter(rec, incidentMark.lap)),
      ),
    };
  }, [incidentMark, strategyIp, telem.pace]);

  const nextStopLap = useMemo(() => {
    const stints = nowBest?.strategy?.stints;
    if (!stints || myLap == null) return null;
    const next = stints.find((st) => st.pitLap != null && st.pitLap >= myLap);
    return next ? next.pitLap : null;
  }, [nowBest, myLap]);

  /**
   * Box now, or wait — run through the real engine, and therefore expensive.
   *
   * In an effect rather than a memo, and keyed on the lap rather than on the
   * telemetry Maps. Those get a fresh identity on every 50 ms flush, so a memo
   * listing them ran two full strategy searches — a few hundred milliseconds
   * each — twenty times a second, synchronously during render, from the moment
   * an incident was marked. The tab locked solid exactly while the car was
   * damaged and the screen was needed.
   */
  const [incidentCompare, setIncidentCompare] = useState(null);
  useEffect(() => {
    const loss = incidentCost?.lossSecs;
    if (!incidentMark || loss == null || myLap == null || myFuelL == null) {
      setIncidentCompare(null);
      return;
    }
    const sc = pitNowScenarios({
      inputs: engineInputs,
      currentLap: myLap,
      currentFuel: myFuelL,
      compoundId: teamCompounds[strategyIp] || null,
      tyreAgeLaps: openTyreLaps ?? 0,
      lossPerLapSecs: loss,
      lapsToNextStop: nextStopLap != null ? nextStopLap - myLap : null,
      lapsRemaining: (nowBest?.strategy?.totalLaps ?? 0) - myLap,
      // Coming in for damage means tyres and fuel as well — the car is already
      // stationary, so it would be daft not to take them.
      pitLossSecs: fullServiceLoss(inputs, myFuelL),
      repairSecs: REPAIR_SECS,
    });
    if (!sc) { setIncidentCompare(null); return; }
    // Through the same validated path the Strategy tab uses, so a wet/dry
    // switch or a malformed lap time cannot produce a confident verdict here
    // while the rest of the app has correctly given up.
    const run = (i) => computeStrategy(i);
    setIncidentCompare(comparePitNow(run(sc.pitNow), run(sc.wait)));
  }, [
    incidentMark, incidentCost, myLap, myFuelL, nextStopLap,
    engineInputs, inputs, teamCompounds, strategyIp, openTyreLaps, nowBest,
  ]);

  const incident = useMemo(() => (incidentMark ? {
    lap: incidentMark.lap,
    manualSecs: incidentMark.manualSecs,
    oneOffSecs: incidentCost?.oneOffSecs ?? null,
    lossSecs: incidentCost?.lossSecs ?? null,
    nextStopLap,
    applied: Number(inputs.pacePenaltySecs) > 0,
    compare: incidentCompare,
  } : null), [incidentMark, incidentCost, nextStopLap, inputs.pacePenaltySecs, incidentCompare]);

  /**
   * Plan on the damaged pace — until the next stop, where it gets repaired.
   * Storing the lap it ends on rather than a lap count keeps it correct as the
   * race goes on: the window shrinks on its own and expires at the stop.
   */
  const applyPacePenalty = useCallback((secs, untilLap) => {
    const on = Number(secs) > 0;
    setInputs((prev) => ({
      ...prev,
      pacePenaltySecs: on ? Number(secs) : 0,
      pacePenaltyUntilLap: on ? (untilLap ?? null) : null,
    }));
    setSelectedIndex(0);
  }, []);

  const nowCompoundId = (strategyIp && teamCompounds[strategyIp]) || null;
  const nowTireLife = nowCompoundId
    ? Number(inputs.compounds.find((c) => c.id === nowCompoundId)?.tireLife) || 0
    : 0;

  // --- Onboarding (Phase 3, Task 3.3) ---
  // A console that is actively streaming is, by any sane reading, detected.
  // Consulting only the scan results and the starred car meant the welcome
  // screen announced "no PS5 found" with a full field live behind it.
  const detectedIp = strategyIp || teamKeys[0] || pickAutoConnectIp(telem.scanResults);
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
          lang={lang}
        />
      )}
      <header className="app-header">
        <CheckeredFlag />
        <div className="header-titles">
          <h1 className="header-title">{t("app_title", lang)}</h1>
          <p className="header-subtitle">{t("app_subtitle", lang)}</p>
        </div>
        <div className="header-actions">
          {telem && (
            <div className={`telem-badge${telem.connected ? " live" : ""}`}>
              <span className={`telem-dot${telem.connected ? " live" : ""}`} />
              {telem.connected ? t("app_telem_live", lang) : t("app_telem_offline", lang)}
            </div>
          )}
          {/* Setup, not race data. It lived in a row across the middle of the
              race screen, between the plan and the field, costing 48px of the
              one screen that has to show everything at once — and it is needed
              about twice a weekend. It hangs off the header now, beside the
              connection state it is about. */}
          <div className="header-telem">
            <TelemetryControls
              telem={telem}
              ps5IPs={ps5IPs}
              onSavePS5IPs={savePS5IPs}
              telemUrl={telemUrl}
              setTelemUrl={setTelemUrl}
              teamLabels={teamLabels}
              onTeamLabelChange={updateTeamLabel}
              lang={lang}
            />
          </div>
          {best && (
            <button className="btn-header-ghost" onClick={() => window.print()}>
              {t("app_print", lang)}
            </button>
          )}
          <button className="btn-header-ghost" onClick={exportRace} title={t("app_save_title", lang)}>
            {t("app_save", lang)}
          </button>
          <label className="btn-header-ghost" title={t("app_restore_title", lang)}>
            {t("app_restore", lang)}
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => { importRace(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          <button className="btn-header-ghost" onClick={startNewRace} title={t("app_new_race_title", lang)}>
            {t("app_new_race", lang)}
          </button>
          <div className="lang-switch" role="group" aria-label={t("app_lang_title", lang)}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                className={`lang-btn${lang === l.id ? " lang-active" : ""}`}
                onClick={() => setLang(l.id)}
                aria-pressed={lang === l.id}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className={`app-main${activeTab === 'strategy' ? '' : ' app-main--full'}`}>
        <aside className="sidebar" hidden={activeTab !== 'strategy'}>
          <TeamPanel onBuild={applySessions} lang={lang} />
          <InputPanel
            inputs={inputs}
            onChange={handleChange}
            onCalculate={() => { setSelectedIndex(0); calculate(); }}
            liveDriven={!!clock && myLap != null}
            lang={lang}
          />
        </aside>

        <section className="results-area">
          <div className="tab-bar">
            <button
              className={`tab-btn${activeTab === "strategy" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("strategy")}
            >
              {t("app_tab_strategy", lang)}
            </button>
            <button
              className={`tab-btn${activeTab === "race" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("race")}
            >
              {t("now_tab", lang)}
              {telem.connected && telem.teams.size > 0 && (
                <span className="tab-live-dot" />
              )}
            </button>
            <button
              className={`tab-btn${activeTab === "drivers" ? " tab-active" : ""}`}
              onClick={() => setActiveTab("drivers")}
            >
              {t("app_tab_drivers", lang)}
              {stintLog.pendingDriverIps.size > 0 && (
                <span className="tab-live-dot" />
              )}
            </button>
          </div>

          {activeTab === "race" && (() => {
            const cars = teamKeys.map((ip, i) => {
              const d = telem.teams.get(ip);
              const raw = teamLabels[ip];
              // Whole laps between us, so a car about to be lapped does not
              // look identical to one you are fighting. Nothing is added for a
              // car on my lap — a clean tag IS the signal that this one counts.
              const dl = strategyIp && ip !== strategyIp && !isSafetyCar(carRoles, ip)
                ? lapsOnMe(telem.lapCrossings.get(strategyIp), telem.lapCrossings.get(ip), clockNow)
                : null;
              const tag = isSafetyCar(carRoles, ip)
                ? 'SC'
                : (raw ? raw.trim().slice(0, 3).toUpperCase() : `T${i + 1}`);
              return {
                id: ip,
                // A short tag, not the full name: a dozen 9-character labels on
                // a 420px-wide map is an unreadable pile on the start grid. The
                // colour plus 3 letters identifies the car; the leaderboard has
                // the full name.
                label: dl ? `${tag} ${dl > 0 ? '+' : ''}${dl}L` : tag,
                // Traffic is dimmed; the cars on my lap keep full weight.
                lapped: dl != null,
                posX: d?.posX, posZ: d?.posZ, onTrack: d?.onTrack,
                isOwn: ip === strategyIp,
                // The safety car is not one of the teams, so it does not take
                // a team colour — it reads as what it is, at a glance.
                isSafety: isSafetyCar(carRoles, ip),
                color: isSafetyCar(carRoles, ip) ? '#FFFFFF' : teamColor(telem.teamOrder.indexOf(ip)),
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
              fuelUse: telem.fuelUse,
              carRoles,
              onRoleChange: updateCarRoles,
              pace: telem.pace,
              scDeployed: !!scDeployedIp,
              lang,
            };
            return (
            <div className="tab-content tab-content--race">
              {/* The strip: the clock, the plan and the next call, across the
                  top of the screen the car is actually watched on. */}
              <div className="race-strip">
              <NowView
                data={strategyIp ? telem.teams.get(strategyIp) : null}
                strategy={nowBest?.strategy ?? null}
                planLabel={nowBest?.sequenceIds ? compoundSequence(nowBest.sequenceIds, lang) : (nowBest?.label ?? null)}
                litersPerLap={nowLitersPerLap}
                tireLife={nowTireLife}
                frozen={planFrozen}
                onToggleFreeze={toggleFreeze}
                label={strategyIp ? getTeamLabel(strategyIp) : null}
                needsTeam={!strategyIp && telem.teams.size > 0}
                onGoToTelemetry={() => setShowAdvancedLb(true)}
                clock={clock}
                onStartRace={startRace}
                onClearRace={clearRaceStart}
                conditions={inputs.conditions ?? "dry"}
                onConditionsChange={setConditions}
                conditionsWarning={
                  conditionsUnavailable(inputs.compounds, inputs.conditions ?? "dry")
                    ? ((inputs.conditions ?? "dry") === "wet" ? "cond_no_wets" : "cond_no_dry")
                    : null
                }
                scDeployed={!!scDeployedIp}
                scPitLoss={scPitLoss}
                scGreenPitLoss={tyreOnlyPitLoss(inputs)}
                scSlowdown={scSlowdown}
                racecraft={racecraft}
                crossoverSecs={crossoverSecsPerLap(
                  tyreOnlyPitLoss(inputs),
                  (nowBest?.strategy?.totalLaps ?? 0)
                    - (strategyIp ? (telem.teams.get(strategyIp)?.currentLap ?? 0) : 0),
                )}
                lang={lang}
              />
              </div>


              {telem.teams.size === 0 ? (
                <div className="empty-state">
                  <div className="empty-text-block">
                    <p className="empty-title">
                      {telem.connected ? t("app_waiting_ps5", lang) : t("app_telem_offline", lang)}
                    </p>
                    <p className="empty-text">
                      {telem.connected
                        ? t("app_waiting_ps5_text", lang)
                        : t("app_offline_text", lang)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="telem-3col">
                  {showAdvancedLb ? (
                    <div className="telem-3col-lb">
                      <TelemetryLeaderboard {...lbProps} />
                      <button
                        className="advanced-lan-toggle is-open"
                        onClick={() => setShowAdvancedLb(false)}
                      >
                        {t("app_lb_hide", lang)}
                      </button>
                    </div>
                  ) : telem.teams.size > 0 && (
                    /* Folded away it is a rail down the left edge, so it costs
                       a few pixels of width instead of a row of height. */
                    <button
                      className="lb-rail"
                      onClick={() => setShowAdvancedLb(true)}
                      title={t("app_lb_show", lang)}
                    >
                      <span className="lb-rail-text">
                        {t("app_lb_show", lang)}
                        {telem.teams.size > 1 ? ` (${telem.teams.size})` : ""}
                      </span>
                    </button>
                  )}
                  <div className="telem-3col-map">
                    <TrackMap
                      currentLap={telem.teams.get(displayIp)?.currentLap ?? 0}
                      cars={cars}
                      mapRef={mapRef}
                      onReset={resetMap}
                      lang={lang}
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
                        fuelRecord={telem.fuelUse?.get(displayIp) ?? null}
                        stintEntry={stintLog.logs.get(displayIp) ?? null}
                        // The incident is about MY car, so the controls only
                        // appear on mine — a rival's dashboard has nothing to
                        // report and nothing to decide.
                        incident={displayIp === strategyIp ? incident : null}
                        onIncident={displayIp === strategyIp ? markIncident : undefined}
                        onClearIncident={clearIncident}
                        onIncidentLoss={setIncidentLoss}
                        onApplyPace={displayIp === strategyIp ? applyPacePenalty : undefined}
                        lang={lang}
                      />
                    ) : (
                      <div className="telem-no-sel">
                        <p>{t("app_no_selection", lang)}</p>
                      </div>
                    )}

                    {/* Under the car rather than across the top of the screen.
                        A measurement that disagrees with your setup is an offer
                        to answer when you have a moment, not a call — and at the
                        top it took a full-width band off the one screen that has
                        to show everything, to say one sentence. The toast is
                        what finds you; this is where you decide. */}
                    <LearnerRecommendations
                      recommendations={learner.recommendations}
                      onAccept={acceptRecommendation}
                      onIgnore={learner.ignore}
                      lang={lang}
                    />
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {activeTab === "strategy" && (
            <div className={`tab-content${calculating ? " results-calculating" : ""}`}>
              {/* Without this the tab read "6:57:42" for an eight-hour race
                  and looked broken. It is right — the clock has been running
                  for an hour and the engine is planning the remainder — but
                  nothing on the tab said so, and a total that does not match
                  the one you typed is a bug until proven otherwise. */}
              {clock && (
                <div className="clock-banner">
                  <span className="clock-banner-title">{t("app_clock_banner", lang)}</span>
                  <span className="clock-banner-time">
                    {t("app_clock_banner_time", lang, {
                      left: formatClock(clock.remainingSecs),
                      total: `${inputs.raceDurationHours}h`,
                    })}
                  </span>
                  {engineInputs.midRaceMode && (
                    <span className="clock-banner-car">
                      {t("app_clock_banner_car", lang, {
                        lap: engineInputs.currentLap,
                        fuel: engineInputs.currentFuel,
                      })}
                    </span>
                  )}
                  <span className="clock-banner-hint">{t("app_clock_banner_hint", lang)}</span>
                  <button className="clock-banner-clear" onClick={clearRaceStart}>
                    {t("app_clock_banner_clear", lang)}
                  </button>
                </div>
              )}
              <LearnerRecommendations
                recommendations={learner.recommendations}
                onAccept={acceptRecommendation}
                onIgnore={learner.ignore}
                lang={lang}
              />
              {calculating && best && (
                <div className="recalc-badge">{t("app_recalculating", lang)}</div>
              )}
              {!best ? (
                <div className="empty-state">
                  <div className="empty-circuit-wrap">
                    <CircuitSVG />
                  </div>
                  <div className="empty-text-block">
                    <p className="empty-title">{t("app_empty_title", lang)}</p>
                    <p className="empty-text">
                      {t("app_empty_before_cta", lang)}{" "}
                      <strong>{t("ip_calculate", lang)}</strong> {t("app_empty_after_cta", lang)}
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
                    lang={lang}
                  />
                  <StrategyTimeline
                    stints={selectedStrategy.strategy.stints}
                    totalLaps={selectedStrategy.strategy.totalLaps}
                    lang={lang}
                  />
                  <StintTable stints={selectedStrategy.strategy.stints} lang={lang} />
                </>
              )}
            </div>
          )}

          {activeTab === "drivers" && (
            <div className="tab-content">
              <DriversTab
                logs={stintLog.logs}
                currentLap={strategyIp ? (telem.teams.get(strategyIp)?.currentLap ?? null) : null}
                drivers={inputs.drivers}
                minDriverTimeSecs={inputs.minDriverTimeSecs}
                activeIp={strategyIp}
                onReset={stintLog.resetAll}
                onGoToTelemetry={() => setActiveTab("race")}
                lang={lang}
              />
            </div>
          )}

        </section>
      </main>

      <Dialog dialog={dialog.dialog} onClose={dialog.close} lang={lang} />
      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} lang={lang} />

      {/* Hidden on the race screen: it is a credit line, and every pixel there
          is one the map or the car panel could use. */}
      <footer className={`app-footer${activeTab === "race" ? " app-footer--hidden" : ""}`}>
        {t("app_footer", lang)}
      </footer>
    </div>
  );
}
