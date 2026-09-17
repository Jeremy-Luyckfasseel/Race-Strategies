# CURRENT_STATE.md

> A factual map of the Race-Strategies codebase as it exists today, written from
> the real source (not from assumptions). Companion to `CLAUDE.md`. Update this
> file as the code changes — the phase plans in `docs/plans/` assume it is accurate.

Last verified against: `src/`, `server/`, `tests/` at the time of writing.

---

## 1. What the app is

GT7 (Gran Turismo 7) endurance race **strategy calculator**. A React + Vite SPA
that enumerates every valid pit / tire-compound combination for a timed
endurance race and ranks them by laps completed, then race time. It also has a
**live telemetry** tab that reads real-time data from one or more PS5s running
GT7 via a standalone Node UDP→WebSocket relay.

Three tabs (Phase 2): **Course** (the live single-team "Now" view — default
landing), **Stratégie** (the calculator), and **Télémétrie** (live dashboard +
track map; the multi-team leaderboard is demoted behind an "Advanced / LAN event"
toggle, hidden by default). UI strings are mostly French; a lightweight
English-primary i18n layer (`src/i18n/strings.js`) was seeded for the Now view.

**The telemetry→engine learning path now exists (Phase 1).** A pure learner
(`src/logic/telemetryLearner.js`) derives fuel burn, the fuel-weight penalty, and
per-compound degradation from live packets and **proposes** them as
recommendations the engineer accepts or ignores (`src/logic/recommendations.js`,
`src/hooks/useTelemetryLearner.js`) — telemetry never silently overwrites the
active inputs (DECISION 7). The older mid-race auto-fill (live `currentLap` /
`fuelLiters` into the mid-race inputs when mid-race mode is on and a team is
selected) still runs alongside. Manual inputs remain the source of truth.

---

## 2. Module map

### Pure logic — `src/logic/` (zero React, node-testable)

| File | Role |
|------|------|
| `strategy.js` | The engine (~700 lines). Exports `findBestStrategies`, `simulateStrategy` (internal), `calcPitStopTime`, `parseLapTime`, `isValidLapTimeStr`, `formatLapTime`, `formatRaceTime`, `TIRE_COMPOUNDS`, `CAR_PRESETS`. |
| `telemetryLearner.js` | **Phase 1.** `createLearner({tankSize, compounds, tireLife, compoundId})` → `{ingest, ingestAll, setCompound, getEstimates}`. Learns `litersPerLap` (tank-delta), the global fuel-weight penalty + per-compound 3-point degradation (joint block least-squares), with per-estimate trust payloads. Emits the engine's input shape. `LEARNER_CONFIG`. |
| `recommendations.js` | **Phase 1.** `buildRecommendations(estimates, inputs, dismissed)` (confident + meaningfully-differs gating, no re-nag after ignore), `applyRecommendation(inputs, rec)` (new object, only path a learned value enters inputs), `dismissSnapshot`, `RECOMMEND_CONFIG`. |
| `raceState.js` | **Phase 2.** Live "Now" decision logic: `currentStint`, `nextAction`, `fuelMarginLaps`, `liftAndCoastVerdict`, `fuelExhaustionLap`, `pitNowTrigger` (earliest-of + reason), `medianRecent` smoothing, `RACE_STATE_CONFIG`. |
| `connection.js` | **Phase 3.** Auto-connect helpers: `backoffDelay` (capped exponential), `isSessionActive` (onTrack AND moving), `pickAutoConnectIp` (auto-pick only a single PS5), `RECONNECT_CONFIG`. |
| `compoundDetector.js` | Doc-only stub. States that GT7 UDP does **not** expose tire compound; compound must be set by the user. No runnable code. |

### React hooks — `src/hooks/`

| File | Role |
|------|------|
| `useStrategy.js` | Wraps `findBestStrategies`. 600 ms debounce on input change + immediate `calculate()`. Validates/coerces inputs in `compute()`, including rejecting a malformed lap-time string (`isValidLapTimeStr`) on any active compound or driver override — returns `null` rather than silently computing with `parseLapTime`'s 120s fallback. Returns `{ result: {ranked, best} \| null, calculating, calculate }`. |
| `useTelemetry.js` | WebSocket client to the relay. Returns `{ connected, reconnecting, teams: Map<ip,packet>, serverIPs, connect, disconnect, sendIPs, scan, scanning, scanResults }`. Each team packet is stamped with `ts: Date.now()`. **Phase 3: auto-reconnect** with capped exponential backoff (re-sends last IPs), suppressed after an explicit `disconnect()`. |
| `useCompoundDetector.js` | Watches each team packet's `pitExit` flag. Adds the IP to a `pendingIps` Set so the UI can prompt for a one-tap compound confirmation. `confirmCompound(ip)` / `stopDetecting(ip)` clear it. Dedupes by `${ip}-${currentLap}`. |
| `useTrackMap.js` | App-level `requestAnimationFrame` loop that records GPS (`posX`/`posZ`) into segments + an occupancy grid, persisted to `localStorage` (`gt7_track_map_v1`). Detects the pit lane from a sustained slow zone and fires `onPitEntry`. Returns `{ mapRef, resetMap }`. |
| `useTelemetryLearner.js` | **Phase 1.** Runs `createLearner` against the selected car's live packets (resets only when the car changes), throttles `getEstimates()` to once per new lap, pushes the confirmed compound in, and manages ignore/dismiss state. Returns `{ estimates, recommendations, ignore, clearDismiss }`. Never writes to `inputs`. |

### Components — `src/components/`

| File | Role |
|------|------|
| `InputPanel.jsx` | The whole sidebar form. Collapsible sections: car presets (localStorage), race, pit timing, fuel, fuel-weight penalty, compound table (per-compound life + 3 lap times + mandatory flag), mid-race mode, drivers (per-driver per-compound lap-time overrides). Also renders the mid-race "auto-fill from PS5" team picker. |
| `ResultsSummary.jsx` | KPI strip + driver summary chips + top-6 strategy comparison cards. |
| `StrategyTimeline.jsx` | Recharts horizontal bar chart of stints + pit windows. |
| `StintTable.jsx` | Lap-by-lap stint detail; red rows for warnings. |
| `LiveDashboard.jsx` | Single-team widget: gear/speed, RPM/throttle/brake/fuel bars, per-corner tire temp + wear, compound picker, and the SVG `TrackMap` (exported named). |
| `TelemetryControls.jsx` | Server URL + connect/disconnect, PS5 IP list editor, LAN scan button + results, team label editor. |
| `TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap, compound picker, fuel bar, pit/track status. **Phase 2: now mounted only behind the Télémétrie tab's "Advanced / LAN event" toggle (hidden by default).** |
| `NowView.jsx` | **Phase 2.** The glanceable in-race "Now" view (dumb renderer over `raceState.js`): current plan, big stint countdown, next action (box lap + fuel + tyres + next compound), lift-and-coast/push verdict + pit reason, and a "freeze plan" toggle. |
| `LearnerRecommendations.jsx` | **Phase 1.** Propose-and-accept cards (Accept / Ignore + sample-size/volatility trust line) for the learner's confident, meaningfully-different estimates. |
| `Onboarding.jsx` | **Phase 3.** First-run overlay: firewall explainer → auto-scan → detected PS5 → optional car preset → into the Now view. Gated by a `gt7-onboarded` localStorage flag. |

### Root — `src/App.jsx`

Owns **all** state (no Redux/Context):
`inputs`, `selectedIndex`, `telemSelectedIp`, `activeTab`, `ps5IPs`,
`telemUrl`, `teamLabels`, `teamCompounds`. Wires the hooks together, holds
`DEFAULT_INPUTS`, and contains the only telemetry→strategy auto-fill effect.

### Server — `server/telemetry-server.js`

Standalone Node process, **not** part of the Vite build. Run with
`npm run telemetry`.
- Binds UDP **33740** (receives GT7 telemetry), sends heartbeat `"A"` to PS5s on
  UDP **33739** every 100 ms, relays decoded packets over WebSocket **20777**.
- Decrypts each packet with a community-documented **Salsa20** key, parses the
  GT7 binary layout, computes derived fields, broadcasts to all browser clients.
- LAN scan: heartbeats every host in the local /24s, collects which IPs reply
  with valid GT7 packets, reverse-DNS resolves hostnames.
- Tire **wear** is *derived*, not given: it tracks the max tire **radius** seen
  per corner and reports current radius as a % of that max.
- Pit detection is **speed-based**: `pitDetected` fires once when speed drops
  <5 km/h after being >60; `pitExit` fires once when speed returns >60 after a
  stop. (`useTrackMap` separately detects a geometric pit *zone*.)

### Tests — `tests/` (plain node, no runner)

| File | Role |
|------|------|
| `test.js` | `npm run test:smoke` — quick 1-hour race sanity check (not part of `npm test`). |
| `test_comprehensive.js` | 124 assertions. Helpers, degradation curve, fuel tracking, pit timing, tyre-change economics, mandatory compound filter, mid-race mode, fuel-weight penalty. |
| `test_invariants.js` | 1 640 bulk-generated assertions. Structural invariants, ranking dominance, multi-compound coverage, multi-driver minimums, race-time boundary, known-answer hand-computed scenarios, bulk no-overfill / no-overrun checks. |
| `test_telemetry_learner.js` | 37 assertions. **Phase 1.** Synthetic seed+race sessions from known ground truth; tight (synthetic) vs live-trust tolerance bands; recovery, engine round-trip, confidence gating, single-stint non-identifiability, multi-compound segmentation. |
| `test_recommendations.js` | 20 assertions. **Phase 1.** Propose-and-accept gating, no-mutation, ignore/material-shift re-surface, accepted value → valid ranked strategy. |
| `test_race_state.js` | 29 assertions. **Phase 2.** `raceState` helpers: stint/next-action, fuel margin + lift-and-coast verdict, earliest-of pit trigger, smoothing. |
| `test_connection.js` | 18 assertions. **Phase 3.** `connection` helpers: backoff schedule, session-active detection, single-PS5 auto-pick. |
| `test_engine_validation.js` | 27 assertions. Recorded-session measurement library (`scripts/lib/validation.js`) recovers fuel/weight/degradation from a synthetic capture; guards the measurement logic, not the engine. |
| `test_session_analysis.js` | 42 assertions. `sessionAnalysis.js` — recorded-session → strategy-input derivation, single- and multi-driver merge (including per-driver tyre-life-mismatch correction). |
| `test_groups.js` | 18 assertions. Team Groups → Races → Sessions state (pure, local, `src/logic/groups.js`). |
| `test_sync_store.js` | 17 assertions. Self-hosted sync server's filesystem store; path-traversal rejection. |
| `test_sync_client.js` | 11 assertions. `syncClient` ↔ `sync-server` round trip over real HTTP. |

`npm test` runs all eleven suites above (every row except `test.js`) in
sequence — 1 983 assertions total, all pure node; they print `✓/✗` lines and
exit non-zero on failure. **These are the guardrail — keep every assertion
green.** 343 of the 1 983 are hand-written; 1 640 are bulk-generated invariant
sweeps (see `test_invariants.js` above) — worth knowing which is which when
judging how much a passing `npm test` actually proves. (Assertion counts
inside loop-based checks scale with how many stints/strategies an input
produces, so they shift slightly whenever engine behaviour changes — this is
expected, not a discrepancy to chase.)

---

## 3. Data shapes

### A. Telemetry packet (relay → browser, one per UDP frame)

Broadcast object (see `parsePacket` + `udp.on('message')` in the server):

```
{
  ps5ip,                       // label or IP string (Map key in the browser)
  posX, posZ,                  // world metres (rounded 0.1) — track map
  rpm, rpmWarning, rpmLimiter,
  fuelLiters,                  // fuelRatio * fuelCapacity, rounded 0.1
  fuelRatio,                   // 0..1, rounded 0.001
  fuelCapacity,                // litres, rounded 0.1
  speedKmh,
  latG,                        // |speed * yawRate| / 9.81
  boost,                       // gauge bar
  waterTemp, oilTemp, oilPressure,
  tireTemp: [FL,FR,RL,RR],     // °C, rounded
  tireRadius: [FL,FR,RL,RR],   // metres, rounded 1e-4
  tireWear:  [FL,FR,RL,RR],    // % of max-seen radius (only if radii > 0) — DERIVED, not native
  currentLap, totalLaps,       // int16; currentLap counts from the game
  bestLapMs, lastLapMs,        // ms, null if <= 0
  racePos, totalCars,          // null if <= 0
  gear, suggestedGear,         // suggestedGear null if 0
  throttle, brake,             // 0..255
  onTrack, paused,             // booleans from flag byte
  pitDetected?,                // true only on the one packet where a stop begins
  pitExit?,                    // true only on the one packet where the car leaves the pit
  ts                           // Date.now(), added in useTelemetry on receive
}
```

**Not available from GT7 UDP:** tire compound ID, native tire wear/life, and an
explicit "tire is dead" signal. Compound is user-supplied; wear is inferred from
radius.

### B. Strategy engine input (`findBestStrategies(params)`)

```
{
  raceDurationHours,               // in mid-race mode this means time REMAINING
  tankSize,                        // litres
  lapsPerFullTank,
  fuelMap,                         // 0.7..1.3 multiplier on burn
  compounds: [{
    id, name, tireLife,            // tireLife = laps before "worn"; 0 = disabled
    mandatory,                     // boolean
    startLapTime, halfLapTime, endLapTime   // "M:SS(.mmm)" strings, observed at FULL TANK
  }, ...],
  pitBaseSecs, tireChangeSecs, fuelRateLitersPerSec,
  fuelWeightPenaltyPerLiter,       // seconds added per litre of fuel on board
  mandatoryStops,
  drivers: [{ id, name, compounds: { [compoundId]: {startLapTime,halfLapTime,endLapTime} } }],
  minDriverTimeSecs,
  midRaceMode, currentLap, currentFuel, currentCompoundId, currentTireAgeLaps
}
```

`useStrategy.compute()` filters compounds to `tireLife > 0`, coerces numbers, and
gates the mid-race fields behind `midRaceMode`.

### C. Strategy engine output (per ranked entry)

`findBestStrategies` returns a sorted array of:

```
{ label, compoundIds: [...], strategy: {
    totalLaps, effectiveLapsPerTank, lapsPerTireSet, numPitStops,
    totalTimeLostSecs, totalDrivingTimeSecs, estTotalRaceTimeSecs,
    driverSummary: [{ id, name, totalTimeSecs, metMinimum }],
    stints: [{
      stintNum, startLap, endLap, lapsInStint, pitLap,    // pitLap null on last stint
      fuelToAddLiters, tiresChanged, compound, compoundName,
      pitStopTimeSecs, warning, pitWindowLatestLap,
      driverId, driverName, avgLapTimeSecs
    }, ...]
} }
```

Sort: `totalLaps` DESC, then `estTotalRaceTimeSecs` ASC.

---

## 4. The two physics models inside the engine (important for Phase 1)

These are the assumptions the learner in Phase 1 must produce inputs for. **Read
them before designing the learner.**

### Fuel-weight correction (linear)

The user enters lap times observed *in game at whatever fuel load each point
happens to be at*. The engine treats `t(start)` as a full-tank reference and
**corrects** `t(mid)` / `t(end)` back to their full-tank equivalents by adding
the fuel-weight penalty that had already burned off
(`findBestStrategies`, lines ~459-485). Then during simulation it re-applies
`(fuelOnBoard - tankSize) * penalty` to every lap, so a lighter car laps faster
(`simulateStrategy`, lines ~256-260). The model is strictly **linear in litres**;
`fuelWeightPenaltyPerLiter` is a single scalar.

### Tire degradation (piecewise linear, 3 points)

Each compound is described by exactly three lap times — start / half / end — and
a `tireLife` (laps). Degradation is a **two-segment linear** curve over tire-age
ratio (`simulateStrategy`, lines ~241-254):
- ratio 0 → 0.5: lap time interpolates `start → half`
- ratio 0.5 → 1.0: lap time interpolates `half → end`

There is no exponential "cliff". `tireLife` is the laps at which ratio = 1.0; the
engine never models running past it (stints are capped). The learner must emit
this same 3-point-per-compound shape, or the strategy engine can't consume it.

### Other engine behaviours worth knowing

- Generates all cyclic compound patterns up to length 5 (`MAX_PATTERN_LENGTH`),
  plus non-cyclic "hold last" variants, simulates each, filters by mandatory
  rules, dedupes by stint signature, ranks. < ~4000 patterns for 5 compounds.
- Pit time = `base + (tiresChanged ? tireChange : 0) + fuelToAdd / fuelRate`
  (`calcPitStopTime`) — the three terms are strictly additive, i.e. tyre change
  and refuelling are assumed **sequential**, not done in parallel by the pit
  crew. Confirmed against real GT7 behaviour; do not "fix" this to a
  `max(tireChange, fuelTime)` model without re-confirming.
- **Tyre-change decision** (`simulateStrategy`, around the `tiresActuallyChanged`
  assignment): a change is forced when the compound plan calls for a different
  compound, or when the current set has exactly zero remaining life. In every
  other case it's a genuine cost/benefit comparison — projected total time on
  the ageing tyres vs. on a fresh set plus `tireChangeSecs`, over the shared
  upcoming-stint length, bounded by whichever of fuel / mandatory-pacing / the
  tyres' own remaining life binds first (`cappedStintLaps` + `tirePaceSecs`
  helpers). This replaced an earlier fixed "always change unless tyres
  comfortably reach the finish" heuristic. Two things worth knowing:
  - The forced condition is intentionally scoped to "zero life left," not
    "won't reach the end of the whole race" — the latter is true at nearly
    every stop in a real multi-hour race (a single tyre set is never going to
    outlast the whole event), which made the comparison below effectively
    unreachable except at the last stop of the race.
  - Known simplification: the comparison only weighs the single upcoming
    stint, not any extra stint length a fresh set might unlock further down
    the race (that would need a multi-stop lookahead). The horizon is
    deliberately capped at the tyres' own remaining life (never extrapolated
    past 100% wear) — extending it further breaks the "stints are capped,
    never modelled past tyre life" invariant above and was found, in testing,
    to corrupt downstream stint-length planning.
- **Multi-driver assignment** (`findBestStrategies` + `pickNextDriver` +
  `planDriverAssignment`): two candidate assignments are computed per
  strategy and the better one kept, never regressing relative to either
  alone.
  1. **Chronological greedy** (`pickNextDriver`): as each stint comes up, the
     driver who owes the most toward their minimum takes it; tie-break least
     accumulated time. Exception: if the upcoming stint (stint length is
     fixed by fuel/tyre/pacing, not by who drives it) is much shorter than a
     normal stint for this race (e.g. a tyre-life-remainder stint from the
     economics above, or every stint when heavy `mandatoryStops` pacing caps
     them all — `normalStintSecs` includes fuel, tyre life, AND
     mandatory-pacing so a uniformly-short-stinted race isn't misjudged as
     "all fragments") and wouldn't clear the most-behind driver's deficit
     anyway, it goes instead to whichever owing driver it WOULD fully cover.
  2. **Longest-stint-first planning** (`planDriverAssignment`): stint lengths
     are fixed by fuel/tyre/mandatory-pacing independent of driver identity,
     so the whole race's stint-length sequence is knowable in advance (probed
     with one throwaway `simulateStrategy` call before the real one).
     Sort stints longest-first, assign each to whoever currently owes the
     most — so big stints go to whoever needs them before only small ones are
     left, which the chronological, one-stint-at-a-time pick can't see
     coming.

  Neither approach dominates the other — confirmed empirically across a
  ~2000-combination parameter sweep (driver count, race length,
  `mandatoryStops`, minimum drive time): longest-stint-first fixed 9 cases
  chronological-only missed, but chronological-only beat longest-stint-first
  in 2 different cases when tried alone. `findBestStrategies` runs both and
  keeps the winner — but "winner" first respects the SAME priority the final
  cross-candidate ranking uses (`totalLaps` DESC, then race time ASC), only
  falling back to `[driversSatisfied, worstCaseDriverTotal]` when laps and
  race time are tied. Per-driver compound times mean the two assignments can
  occasionally finish a different number of laps for the same compound plan
  (whoever drives a stint changes how long it takes); without this
  lap-count-first check, a fairness-motivated swap could pick an assignment
  that satisfies more drivers but completes fewer laps — which is the metric
  `findBestStrategies` actually ranks candidates by, so that swap would make
  the candidate rank worse for no guaranteed benefit. With this check, the
  swap can only ever improve fairness "for free," never at a lap-count cost.
  - **Known limitation, not a bug to chase:** still not a hard guarantee. With
    very few total stints relative to driver count (e.g. 2 drivers splitting
    a 2-stint race) there is only one way to split them — no assignment
    algorithm, however smart, can improve on that. Verified exhaustively for
    one such case (2 drivers, minimum = exactly half a 2h race): checked all
    2^11 possible ways to split that race's 11 stints between 2 drivers, and
    the best any of them achieves is short of both minimums — the shortfall
    there is stint lengths (fixed by fuel/tyre physics, discrete lap counts)
    not dividing evenly, not an assignment-quality problem. Confirmed present
    even on pre-tyre-economics code with the simplest possible config (1
    mandatory stop, 2 drivers, minimum = exactly half the race) — it predates
    and is unrelated to the tyre-change economics work. Closing it fully
    would require changing PIT TIMING itself based on driver-fairness needs,
    not just the assignment of already-fixed stints — a materially bigger,
    riskier change to the fuel/tyre-driven stint-length model, not attempted
    here.

---

## 5. Half-finished / dead / loose ends

- **`compoundDetector.js`** is a comment-only file (the real logic lives in the
  `useCompoundDetector` hook). Intentional, but easy to mistake for dead code.
- **Telemetry→engine learning path exists (Phase 1, done).** The differentiator
  (auto-derive fuel burn / fuel-weight / degradation) is implemented as a
  propose-and-accept flow (`telemetryLearner.js` + `recommendations.js` +
  `useTelemetryLearner.js` + `LearnerRecommendations.jsx`). The legacy
  `currentLap` + `fuelLiters` mid-race auto-fill still runs alongside.
- **Auto-connect / auto-reconnect exist (Phase 3, done).** App auto-connects on
  launch, auto-scans, auto-picks a single PS5, and reconnects with capped backoff
  (`connection.js` + `useTelemetry.js` + `App.jsx`). Manual override still works.
- **`tireWear` is radius-derived and unproven.** Whether it is stable/monotonic
  enough to drive a degradation model is unverified (a Phase 1 open question).
- **Salsa20 key is version-sensitive.** A GT7 update can change it and silently
  break decoding.
- **Packaging scaffolded (Phase 3, build not yet run).** Electron
  (`electron/main.cjs` + electron-builder config in `package.json`) bundles the UI
  + relay into a Windows installer; steps in `docs/PACKAGING.md`. The installer
  itself has not been built/smoke-tested yet — `npm run dist` on Windows. The dev
  workflow (`npm run dev` / `telemetry` / `test`) is unchanged.
- **Multi-team scaffolding is present** (leaderboard, `Map<ip,packet>`, scan)
  even though the MVP is single-team. The build plan says keep it but
  de-emphasize it (Phase 2.2), not delete it.
- A stray `bash.exe.stackdump` sits in the repo root (untracked, ignorable).

---

## 6. Commands

```
npm run dev          # Vite dev server :5173
npm run build        # production build → /dist
npm run lint         # ESLint flat config
npm test             # all eleven suites in tests/ (see §2 Tests table) — 1 983 assertions
npm run test:smoke   # quick 1h race test
npm run telemetry    # start the UDP→WS relay (separate process)
```
