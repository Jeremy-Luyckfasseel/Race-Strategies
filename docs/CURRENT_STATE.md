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

Four tabs: **Course** (the live single-team "Now" view — default landing),
**Stratégie** (the calculator), **Télémétrie** (live dashboard + track map +
the multi-team leaderboard, which now reveals itself automatically once a
second car appears), and **Pilotes** (per-driver drive-time totals + the
per-stint log — duration, tyre, avg/best/worst lap — built from pit-exit/entry
events; see `stintLog.js`/`useStintLog.js` below). **Every user-facing string now
goes through the i18n layer** (`src/i18n/strings.js` + `en.js`/`fr.js`): English is
the source of truth and the fallback for any missing key, French is the default a
machine with nothing stored gets, and a FR/EN switch in the header flips the whole
tree and persists under `gt7-lang`. `lang` is a plain prop threaded from `App.jsx`
— no context, no module global. Adding Dutch is `nl.js` plus one entry in `LANGS`.
That includes what comes out of the pure engine: `src/logic/` keeps its English
`label`/`warning` for logs and tests and additionally emits `warningCode`,
`sequenceIds` and `labelKey` for the UI to translate, so tyre names, stint
warnings and learner recommendations all follow the switch. Guarded by
`tests/test_ui_i18n.js`, which also fails if the two tables drift apart.

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
| `gaps.js` | `trackLapCrossings(prev, packets)` + `lapInterval`/`formatInterval` — leaderboard intervals derived from start/finish crossings. Replaces a column that subtracted the two cars' last LAP TIMES (a pace difference, not a gap: two cars 30 s apart at equal pace showed nothing). Refreshes once per lap per car; going continuous would need projecting cars onto the recorded centreline. A car's first sighting is marked `witnessed: false` — on joining mid-race we know only which lap a car is on, not when it began, so second-level intervals wait for a lap change we actually saw (a lap *difference* is reported immediately, since it comes from GT7's own counter). |
| `racePersistence.js` | What a race is made of on disk. `RACE_KEYS` / `SNAPSHOT_KEYS`, `buildSnapshot`/`validateSnapshot`/`applySnapshot` for export-import, `clearRace` for a new race (keeps the circuit map — it describes the track, not the race), `loadInputs` (merged over defaults, falls back on anything unparseable or lacking a compound table). localStorage is the store: the payload is tens of KB, the track map is self-bounding, and synchronous writes are durable immediately. |
| `pitDetect.js` | `detectPitEdges(prev, speedKmh, now, cfg)` — the relay's pit entry/exit state machine (imported by `server/telemetry-server.js`, the one module shared across that boundary). A stop must be sustained for `PIT_MIN_STOP_MS` before it counts, so a spin no longer fires a phantom pit stop. Still speed-only: a car parked on track past the dwell reads as a stop. |
| `teams.js` | Multi-car display helpers: `stableCarId` (what a car is reported as — prefers a hostname learned from a LAN scan over a bare IP, so a DHCP lease change does not spawn a new car; imported by the relay, which still heartbeats the IP), `applyFlush` (one buffer flush — merge, crossings, order, prune — kept pure and out of the hook so the 20 Hz hot path is node-testable, and exercised directly by `test_multicar_integration.js`), `resolveActiveCars` (splits `strategyIp` — my car, owning drivers/stint log/learner/auto-fill — from `displayIp`, the car being inspected, so clicking a rival never repoints my strategy), the 16-colour `TEAM_PALETTE` + `teamColor(orderIndex)` (shared by the leaderboard and the track map so a car's colour matches in both and never changes as it gains places), append-only `withTeamOrder`, `coalescePacket` (carries one-shot pit edges across a flush window), `isStalePacket`/`dropStaleTeams` + `TEAM_STALE_MS`. |
| `stintLog.js` | Pure stint-log state machine backing the Pilotes tab: `emptyEntry`, `openStint`, `closeStint` (folds the running lap sum/count into a duration + average, keeps no per-lap array), `reopenStint` (pit-exit's entry point — archives an already-open `current` first if its closing pit-entry packet was never seen, rather than overwriting and losing it), `recordLap` (best/worst tracking) and `recordLapIfClean` (same, but skips the out-lap and any lap paused/off-track when it completed), `setCompound` (fills once, never overwrites), `assignDriver`. |

### React hooks — `src/hooks/`

| File | Role |
|------|------|
| `useStrategy.js` | Wraps `findBestStrategies`. 600 ms debounce on input change + immediate `calculate()`. Validates/coerces inputs in `compute()`, including rejecting a malformed lap-time string (`isValidLapTimeStr`) on any active compound or driver override — returns `null` rather than silently computing with `parseLapTime`'s 120s fallback. Returns `{ result: {ranked, best} \| null, calculating, calculate }`. |
| `useTelemetry.js` | WebSocket client to the relay. Returns `{ connected, reconnecting, teams: Map<ip,packet>, teamOrder, serverIPs, connect, disconnect, sendIPs, scan, scanning, scanResults }`. Each team packet is stamped with `ts: Date.now()`. **Packets are buffered in a ref and flushed to state at 20 Hz** — one setState per packet meant ~600 re-renders/sec at 10 cars, since each packet is its own WebSocket event and React cannot batch across them. On each flush, cars silent longer than `TEAM_STALE_MS` are pruned. `coalescePacket` carries the relay's one-shot `pitDetected`/`pitExit` edges forward so an edge that lands mid-window is not overwritten before it is flushed. `teamOrder` is append-only first-seen order and picks each car's display colour. **Phase 3: auto-reconnect** with capped exponential backoff (re-sends last IPs), suppressed after an explicit `disconnect()`. |
| `useCompoundDetector.js` | Watches each team packet's `pitExit` flag. Adds the IP to a `pendingIps` Set so the UI can prompt for a one-tap compound confirmation. `confirmCompound(ip)` / `stopDetecting(ip)` clear it. Dedupes by `${ip}-${currentLap}`. |
| `useTrackMap.js` | App-level `requestAnimationFrame` loop that records GPS (`posX`/`posZ`) into segments + an occupancy grid, persisted to `localStorage` (`gt7_track_map_v1`). Detects the pit lane from a sustained slow zone and fires `onPitEntry`. Returns `{ mapRef, resetMap }`. |
| `useTelemetryLearner.js` | **Phase 1.** Runs `createLearner` against the selected car's live packets (resets only when the car changes), throttles `getEstimates()` to once per new lap, pushes the confirmed compound in, and manages ignore/dismiss state. Returns `{ estimates, recommendations, ignore, clearDismiss }`. Never writes to `inputs`. |
| `useStintLog.js` | Thin React adapter over `stintLog.js`: subscribes to `teams`, dedupes pit-entry/exit/lap-completion per team (same `${ip}-${lap}` pattern as `useCompoundDetector`), persists the log to `localStorage` (`gt7-stint-log`). Opens the first stint on the first on-track packet (defaults to the first configured driver — no pit to prompt on yet), then a new stint on every pit exit via `reopenStint` (driver left `null` until `assignDriver(ip, driverId)` is called) and closes it on the next pit entry via `closeStint`. Lap folding goes through `recordLapIfClean`. Returns `{ logs: Map<ip,{history,current}>, pendingDriverIps, assignDriver, resetAll }`. |

### Components — `src/components/`

| File | Role |
|------|------|
| `InputPanel.jsx` | The whole sidebar form. Collapsible sections: car presets (localStorage), race, pit timing, fuel, fuel-weight penalty, compound table (per-compound life + 3 lap times + mandatory flag), mid-race mode, drivers (per-driver per-compound lap-time overrides). Also renders the mid-race "auto-fill from PS5" team picker. |
| `ResultsSummary.jsx` | KPI strip + driver summary chips + top-6 strategy comparison cards. |
| `tyreHistory.js` | Per-compound tyre history read back out of the stint log — sets run, laps each, measured fall-off, and how long the set you are on is likely to last. Shown on the car dashboard and as a table in the Pilotes tab. Works for rivals too, once their compound is tagged. |
| `conditions.js` | The DRY/WET switch on the Race tab, as a compound filter plus the crossover figure. |
| `paceTrack.js` | Rolling lap-time window per car; incident measurement and rival pace-drop detection. |
| `pitNow.js` | The box-now-or-wait comparison, run through the real engine so "does coming in actually cost a stop" is answered rather than assumed. |
| `incident.js` | The **Incident** button on the car dashboard (damage, spin, penalty — anything). Measures the one-off cost and the ongoing per-lap loss, and calls carry / repair-at-next-stop / box-now. Rivals who lose pace with no stop to explain it get a DOWN badge in the leaderboard. |
| `carRoles.js` | Safety-car handling: roles per car, out of the standings and gaps, pinned below the field, deployment detection and the reduced pit loss that follows from it. |
| `raceClock.js` | The race start stamp and the clock that follows from it. Practice in the lobby is not the race: **Start race** on the Race tab stamps the moment, resets the stint log and every car's tyre, and from then on the plan is built from the time *remaining* rather than the configured length. Keeps the circuit, names, roster, setup and anything the learner picked up in practice. `tests/test_race_clock.js` + `tests/test_ui_race_clock.js`. |
| `StrategyTimeline.jsx` | The race as one horizontal bar: a segment per stint, pit marks, pit windows. Hand-drawn with CSS percentages after the Recharts version was found rendering no bars at all under Recharts 3; the dependency went with it (bundle 695 kB → 340 kB). Covered by `tests/test_ui_timeline.js`. |
| `StintTable.jsx` | Lap-by-lap stint detail; red rows for warnings. |
| `LiveDashboard.jsx` | Single-team widget: gear/speed, RPM/throttle/brake/fuel bars, per-corner tire temp + wear, compound picker, and the SVG `TrackMap` (exported named). |
| `TelemetryControls.jsx` | Server URL + connect/disconnect, PS5 IP list editor, LAN scan button + results. Team naming lives in the leaderboard, not here — the auto-scan still seeds a label from a resolved hostname. |
| `TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap, compound picker, fuel bar, pit/track status. Colours each row via `teamColor(teamOrder.indexOf(ip))` so a car's colour is fixed for the session and matches its dot on the track map. Revealed automatically once a second car connects. **Also the team-management surface:** a ★ per row marks *my* team (persisted to `gt7-my-team`), and ✎ / double-click renames any team inline. |
| `NowView.jsx` | **Phase 2.** The glanceable in-race "Now" view (dumb renderer over `raceState.js`): current plan, big stint countdown, next action (box lap + fuel + tyres + next compound), lift-and-coast/push verdict + pit reason, and a "freeze plan" toggle. |
| `LearnerRecommendations.jsx` | **Phase 1.** Propose-and-accept cards (Accept / Ignore + sample-size/volatility trust line) for the learner's confident, meaningfully-different estimates. |
| `Onboarding.jsx` | **Phase 3.** First-run overlay: firewall explainer → auto-scan → detected PS5 → optional car preset → into the Now view. Gated by a `gt7-onboarded` localStorage flag. |
| `DriversTab.jsx` | Pilotes tab: driver time totals (reusing `ResultsSummary`'s `.driver-chip` styling, flagged when a driver is under `minDriverTimeSecs`) and a per-stint log table (driver, tyre, laps, duration, avg/best/worst lap) for the selected team, including the in-progress stint. |

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

The UI suites add a small DOM harness (`tests/helpers/`): jsdom, React's own `act`, and a hand-stepped `requestAnimationFrame` so the map's animation loop can be driven deterministically. `.jsx` is transpiled on import by an esbuild module hook (esbuild already ships with Vite), so the tests load the real components rather than a build artefact. No test runner — the same hand-rolled assert/section style as every other suite.

| File | Role |
|------|------|
| `test.js` | `npm run test:smoke` — quick 1-hour race sanity check (not part of `npm test`). |
| `test_comprehensive.js` | 142 assertions. Helpers, degradation curve, fuel tracking, pit timing, tyre-change economics, mandatory compound filter, mid-race mode, fuel-weight penalty. |
| `test_invariants.js` | 1 640 bulk-generated assertions. Structural invariants, ranking dominance, multi-compound coverage, multi-driver minimums, race-time boundary, known-answer hand-computed scenarios, bulk no-overfill / no-overrun checks. |
| `test_telemetry_learner.js` | 37 assertions. **Phase 1.** Synthetic seed+race sessions from known ground truth; tight (synthetic) vs live-trust tolerance bands; recovery, engine round-trip, confidence gating, single-stint non-identifiability, multi-compound segmentation. |
| `test_recommendations.js` | 20 assertions. **Phase 1.** Propose-and-accept gating, no-mutation, ignore/material-shift re-surface, accepted value → valid ranked strategy. |
| `test_race_persistence.js` | 42 assertions. `src/logic/racePersistence.js` — which keys are race-scoped vs. app-scoped (the circuit map deliberately survives a new race), snapshot build/validate/apply including refusing a newer schema and ignoring unknown keys from a tampered file, and `loadInputs` merging a stored setup over current defaults so an older save gains fields added since. |
| `test_race_state.js` | 29 assertions. **Phase 2.** `raceState` helpers: stint/next-action, fuel margin + lift-and-coast verdict, earliest-of pit trigger, smoothing. |
| `test_connection.js` | 18 assertions. **Phase 3.** `connection` helpers: backoff schedule, session-active detection, single-PS5 auto-pick. |
| `test_engine_validation.js` | 27 assertions. Recorded-session measurement library (`scripts/lib/validation.js`) recovers fuel/weight/degradation from a synthetic capture; guards the measurement logic, not the engine. |
| `test_session_analysis.js` | 42 assertions. `sessionAnalysis.js` — recorded-session → strategy-input derivation, single- and multi-driver merge (including per-driver tyre-life-mismatch correction). |
| `test_groups.js` | 18 assertions. Team Groups → Races → Sessions state (pure, local, `src/logic/groups.js`). |
| `test_sync_store.js` | 17 assertions. Self-hosted sync server's filesystem store; path-traversal rejection. |
| `test_sync_client.js` | 11 assertions. `syncClient` ↔ `sync-server` round trip over real HTTP. |
| `test_ui_leaderboard.js` | 55 assertions. **Renders the real component.** Rename by ✎, double-click, blur and Escape; ★ marking; that a car keeps its colour when the running order changes; the interval column; that a long team name still renders on the busiest row; that the narrow column keeps the last lap and the fuel litres under the name; a 12-car field. |
| `test_ui_trackmap.js` | 36 assertions. **Renders the real SVG and steps its rAF loop by hand** — the imperative `createElementNS` dot code has no other safety net. A dot per car, own-car halo in the team's own colour, boxed cars dimmed not dropped, 3-char outlined tags at grid density, and that the dot advances on frames between packets without jumping back. |
| `test_ui_drivers.js` | 35 assertions. Pilotes tab (stint rows, driver totals, the minimum flag, the live stint counting once the 1 s clock ticks, reset) and LiveDashboard's pit confirmation (drivers offered only on my own car; banner wording per what is still unknown). |
| `test_ui_reconnect.js` | 19 assertions. The three distinct "lost connection" cases: a PS5 going quiet (kept inside the staleness window, returns on its own with the same colour), the relay dropping (auto-reconnect re-registers the PS5 list and data resumes), and a browser reload (★, team names, tyres and the stint log come back; a tyre cleared by a pit stop stays cleared; strategy inputs are deliberately not persisted). |
| `test_ui_app_e2e.js` | 26 assertions. **The whole App mounted** against a fake relay with a ten-car field: packets reaching the board, ★ persisting and reaching the map's own-car marker, a rename reaching the map tag, the Pilotes tab following the star rather than the selection, a rival's pit stop not prompting for my driver, and all four tabs rendering. |
| `test_relay_e2e.js` | 20 assertions. **Not mocked** — spawns `server/telemetry-server.js`, opens a real WebSocket, and sends real Salsa20-encrypted GT7 packets from ten distinct loopback source addresses. Proves the crypto, byte offsets, per-console keying and pit-edge logic hold across a real socket for a whole field (~4.5k packets relayed). Takes ~13 s, most of it genuinely waiting out the pit dwell. |
| `test_multicar_integration.js` | 36 assertions. A simulated 12-car race driven through the **real** `applyFlush` (not a copy): measures the batching ratio (~36x fewer state updates than packets), colour stability when a car retires, pit edges surviving the flush window, intervals, `resolveActiveCars`, and the stint log over a full pit cycle. |
| `test_gaps.js` | 20 assertions. `src/logic/gaps.js` — `trackLapCrossings` (stamps by packet arrival, never re-stamps mid-lap, same-ref when unchanged) and `lapInterval` (real seconds on the same lap, laps when lapped, null rather than a negative or invented gap). |
| `test_pit_detect.js` | 20 assertions. `src/logic/pitDetect.js` — the relay's pit edges: a sustained stop yields one entry + one exit, a spin yields none, a standing start yields none, and edges fire once rather than on every packet. |
| `test_teams.js` | 45 assertions. `src/logic/teams.js` — the 16-colour palette, `teamColor` fallbacks, append-only `withTeamOrder`, `isStalePacket`/`dropStaleTeams` (same-reference returns when nothing changed), and the key multi-car invariant: a car keeps its colour when another car drops out. |
| `test_stint_log.js` | 29 assertions. `src/logic/stintLog.js` — the Drivers-tab stint-log state machine: stint open/close, per-lap average/best/worst folding without retaining individual lap times, compound sync, driver (re)assignment, `reopenStint`'s defensive archive-before-overwrite (a missed pit-entry packet must not lose the prior stint), `recordLapIfClean`'s out-lap/paused/off-track exclusion. |

`npm test` runs all twenty-three suites above (every row except `test.js`) in
sequence — 2 407 assertions total, all pure node; they print `✓/✗` lines and
exit non-zero on failure. **These are the guardrail — keep every assertion
green.** 767 of the 2 407 are hand-written; 1 640 are bulk-generated invariant
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
  - **Known gap in this pattern language, and how it's closed**: neither
    cyclic nor hold-last can express "run compound X for the whole race, but
    Y just for the true final stint" once a race needs MORE than 5 total
    stops — cyclic would repeat Y periodically throughout the race, hold-last
    would lock Y in forever the first time it's reached; neither means "only
    at the very end, however many stops that turns out to be." This is a
    real racing tactic (degradation barely matters over a short closing
    stint, so a fresher/faster compound can win there even though it loses
    over a full stint) that the language structurally can't reach on its
    own. Closed by `findBestStrategies` re-simulating just the #1-ranked
    result once per OTHER active compound, via `simulateStrategy`'s
    `finalStintOverride: { atPitsDone, compound }` param — only the compound
    decision at that one specific pit changes; everything before it is
    identical by causality (an earlier stint can't be affected by a later
    compound choice), and if the override compound needs an unplanned extra
    stop, `simulateStrategy` falls back to the plan's normal pattern for it,
    so a backfiring override just produces worse totalLaps/race-time and is
    correctly rejected. Only tried on the #1 candidate, not all ~4-8k of
    them — the effect is local to one stint and can't plausibly change which
    BASE compound plan ranks best, so this stays cheap (verified: a
    realistic 8h/3-compound/3-driver calc goes from ~115ms to ~131ms).
  - **Mandatory-compound safety**: the mandatory-compound filter (below) runs
    BEFORE ranking, on the un-overridden candidates — it has no way to know
    this override step exists. The cheapest way to satisfy "compound X must
    appear somewhere" is often to use it for just one short stint, which can
    legitimately be the true final one (confirmed reachable: a 2.5h race
    with Hard non-mandatory and a fast-but-short-lived Soft marked mandatory
    naturally puts Soft only at the final stint). Every override candidate is
    re-checked against `mandatoryIds` before being accepted (`every(req =>
    overrideStrategy.stints.some(st => st.compound === req))`) — without
    this, the override would happily swap away a mandatory compound's only
    occurrence purely on lap-time grounds, silently violating a constraint
    the user configured. Found by code review before it shipped; see
    `tests/test_comprehensive.js`'s "never overrides away a mandatory
    compound's only occurrence" test.
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
  2. **Longest-stint-first planning + local search** (`planDriverAssignment`):
     stint lengths are fixed by fuel/tyre/mandatory-pacing independent of
     driver identity, so the whole race's stint-length sequence is knowable
     in advance (probed with one throwaway `simulateStrategy` call before the
     real one). First pass: sort stints longest-first, assign each to
     whoever currently owes the most — so big stints go to whoever needs
     them before only small ones are left, which the chronological,
     one-stint-at-a-time pick can't see coming. This first pass (LPT) still
     commits to each assignment irrevocably and can land short of an
     achievable split from the same stint sizes — e.g. 9 stints split
     between 2 drivers needing 1800s each landed `[1924, 1789]` (11s short)
     when a single stint swap reaches `[1806, 1907]` from the SAME stints
     (total unchanged at 3713s), simply because by the time the smallest
     stints are placed, two drivers are already near-tied. Second
     pass: repeatedly find the single stint-swap between two drivers that
     improves `[driversSatisfied, worstCaseTotal]` the most, apply it,
     repeat until no swap helps — a standard local-search refinement for
     multiway partitioning (not exact — that's NP-hard for ≥3 "bins" in
     general — but reliable for the dozens-of-stints/≤~5-drivers an
     endurance race actually produces, and cheap: O(stints²) per round,
     a handful of rounds to converge).

  Neither top-level approach dominates the other — confirmed empirically
  across a ~2000-combination parameter sweep (driver count, race length,
  `mandatoryStops`, minimum drive time): longest-stint-first (with local
  search) fixed 11 cases chronological-only missed, 0 regressions.
  Local search alone accounts for 2 of those 11 — the exact cases where
  plain LPT used to be worse than chronological when tried in isolation.
  `findBestStrategies` runs both and keeps the winner — but "winner" first
  respects the SAME priority the final
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
- **`tireWear` is radius-derived and was never shown to work.** Track testing
  found it does not move, matching the suspicion that GT7 reports a fixed spec
  radius; `current / max-seen` is then exactly 100% for ever. **It is no longer
  displayed.** The relay still computes it (harmless, and `npm run diag:tyres`
  prints the raw radii so the question can be settled on real hardware), but
  the dashboard now shows tyre *temperature* per corner — which GT7 genuinely
  sends — plus a modelled tyre life counted in laps-on-set against the
  compound's configured `tireLife`, per DECISIONS.md item 4.
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
npm test             # all twenty-three suites in tests/ (see §2 Tests table) — 2 407 assertions
npm run test:smoke   # quick 1h race test
npm run telemetry    # start the UDP→WS relay (separate process)
```
