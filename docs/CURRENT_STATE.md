# CURRENT_STATE.md

> A factual map of the Race-Strategies codebase as it exists today, written from
> the real source (not from assumptions). Companion to `CLAUDE.md`. Update this
> file as the code changes — the phase plans in `docs/plans/` assume it is accurate.

Last verified against `src/`, `server/` and `tests/` on the `fix/ui-pass` branch,
2026-09-22 — module map, test list and loose ends all re-read from the source.

---

## 1. What the app is

GT7 (Gran Turismo 7) endurance race **strategy calculator**. A React + Vite SPA
that enumerates every valid pit / tire-compound combination for a timed
endurance race and ranks them by laps completed, then race time. It also has a
**live telemetry** tab that reads real-time data from one or more PS5s running
GT7 via a standalone Node UDP→WebSocket relay.

Three tabs: **Course** (the in-race screen and default landing — the plan
strip across the top, and under it the multi-team leaderboard, the track map
and the selected car's dashboard; the leaderboard reveals itself automatically
once a second car appears), **Stratégie** (the calculator, the only tab that
carries the setup sidebar), and **Pilotes** (per-driver drive-time totals + the
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

**The telemetry→engine learning path.** A pure learner
(`src/logic/telemetryLearner.js`) derives fuel burn, the fuel-weight penalty and
degradation curves **per compound and per driver** from live packets, and
**proposes** them as recommendations the engineer accepts or ignores
(`src/logic/recommendations.js`, `src/hooks/useTelemetryLearner.js`) — telemetry
never silently overwrites the active inputs (DECISION 7). Manual inputs remain
the source of truth. What it measures is persisted per car
(`src/logic/learnerStore.js`), so a reload mid-race costs at most the lap in
progress rather than the whole session.

The mid-race inputs are no longer written by an effect. `engineInputs` in
`App.jsx` is the single reconciler: the user's setup, the race clock, and where
the **★ car** actually is. The effect it replaced was keyed on the car you were
*looking at*, so clicking a rival's row rebuilt your plan from their fuel.

**What a stop this lap would do to the race** — where you rejoin and between
whom, whether an undercut lands, what traffic you are about to reach — is
`src/logic/racecraft.js`, shown on the plan strip. It deliberately models no
cost for attacking or defending: there is no data to calibrate that from, and
what a fight really costs the plan is fuel, which is already measured.

---

## 2. Module map

### Pure logic — `src/logic/` (zero React, node-testable)

| File | Role |
|------|------|
| `strategy.js` | The engine (~700 lines). `findBestStrategies`, `simulateStrategy`, `calcPitStopTime`, `parseLapTime`, `isValidLapTimeStr`, `formatLapTime`, `formatRaceTime`, `TIRE_COMPOUNDS`, `CAR_PRESETS`. Also takes `pacePenaltySecs` + `pacePenaltyLaps` — a flat per-lap cost for a **bounded** number of laps, because damage ends at the next stop. |
| `telemetryLearner.js` | `createLearner({tankSize, compounds, compoundId, driverId, restore})` → `{ingest, ingestAll, setCompound, setDriver, getEstimates, snapshot}`. Learns `litersPerLap`, the global fuel-weight penalty and a 3-point degradation curve **per compound and per driver**. The penalty regression blocks by *driver-on-compound*, not compound: two drivers on one tyre are not one curve, and the mismatch had nowhere to go but the fuel column. |
| `learnerStore.js` | Keeping what the learner measured across a reload. `readStore`/`restoreFor`/`writeFor`, `LEARNER_KEY`, `MAX_LAPS_PER_CAR`. Only measured laps are stored, never fits, so a restore costs at most the in-progress lap and a change to the fitting code applies to restored data. |
| `recommendations.js` | `buildRecommendations` / `applyRecommendation` / `dismissSnapshot`. Four kinds: laps-per-tank, fuel-weight penalty, per-compound curves, and per-**driver** curves. Accepting one is the only path a learned value enters `inputs`. |
| `racecraft.js` | The three questions about other cars. `positionIfPitNow` (where I rejoin, who is either side, and how far off in seconds), `undercut` (box first and pass in the pit lane — only the *difference* between the two stops counts against you, not the whole stop), `trafficAhead` (the backmarker I am about to reach), `freshTyreGainSecs`. Deliberately models no cost for attacking or defending: there is no data to calibrate it from. |
| `gaps.js` | Leaderboard intervals from start/finish crossings: `trackLapCrossings`, `lapInterval`, `liveInterval`, `lapProgress`, `lapsOnMe`, `formatInterval`. The ±1-lap case is resolved against the leader's previous crossing and says **nothing** when it cannot yet be told — a one-lap counter difference is the normal state of every close fight for part of every lap. `lapsOnMe` judges on track position, so a car that has just pitted is not called lapped. |
| `rivalIntel.js` | Any car's fuel read off its own trace: `trackFuelUse`, `burnPerLap` (median of clean laps), `fuelLapsLeft`, `predictedPitLap`, `rivalSummary`, `burnProgress`. No input from us and nothing assumed about their car. |
| `stintFuel.js` | Litres for the stint about to start, for a named driver on a named tyre. `burnRateFor` falls back driver → car → configured and says which it used; `stintFuel` returns a **tank target**, capped at the tank, never netted against live fuel — the stop it describes can be 25 laps away and the car arrives near empty. Deliberately NOT an engine re-run per driver: stint length is set by fuel range, and per-driver fuel would make fuel range depend on who is driving while the driver is chosen FROM the stint length. |
| `tyreHistory.js` | The stint log read back per compound: sets run, laps each, best/avg, measured fall-off. `currentSetOutlook` uses the **median** of previous *finished* sets, so one stint cut short by a spin is not the expectation. Silent on a first set. |
| `pitNow.js` | **Box now or wait**, answered by the engine rather than by arithmetic. Builds two futures and runs both through `findBestStrategies`, comparing laps first and race time second. `fullServiceLoss` returns **null** for an unknown fuel reading — an unknown tank is not an empty one. |
| `incident.js` | Not a damage button — anything that makes the plan wrong. `measuredLossSecs` / `effectiveLossSecs`. The lap it happened on is costed as a one-off, never averaged into the per-lap rate. |
| `paceTrack.js` | A ten-lap rolling window per car. Powers incident measurement and `detectPaceDrop`, which finds a **step** rather than a slope and requires it sustained across three laps, so a pit stop's in- and out-lap do not read as damage. |
| `carRoles.js` | Not every car on the LAN is racing. `splitByRole`, `isSafetyCar`, `safetyCarDeployed`, `fieldSlowdown`, `pitLossUnderSafetyCar`. A safety car is out of the standings and the gap chain but still shown and watched. |
| `conditions.js` | Dry/wet as a **filter over which compounds the engine may pick**, not a second simulation. `compoundsFor`, `conditionsUnavailable`, `crossoverSecsPerLap`, `tyreOnlyPitLoss`. |
| `raceClock.js` | `RACE_START_KEY`, `raceProgress`, `applyRaceClock`, `formatClock`. The lobby is open for hours and that driving is practice, so the race has an explicit start stamp; the plan then follows the clock rather than a field someone retypes. Remaining is quantised to the minute so the search runs once a minute. Pure: the caller passes `now`. |
| `raceState.js` | The live "Now" decisions: `currentStint`, `nextAction`, `fuelMarginLaps`, `liftAndCoastVerdict`, `fuelExhaustionLap`, `pitNowTrigger`, `medianRecent`. |
| `racePersistence.js` | What a race is made of on disk. `RACE_KEYS` / `SNAPSHOT_KEYS`, `buildSnapshot`/`validateSnapshot`/`applySnapshot`, `clearRace`, `loadInputs`. The circuit map deliberately survives a new race; what the learner measured does not. |
| `stintLog.js` | The Pilotes stint-log state machine: `openStint`, `closeStint`, `reopenStint` (archives an already-open stint rather than overwriting it), `recordLap`/`recordLapIfClean`, `setCompound`, `assignDriver`. Keeps aggregates, never a per-lap array. |
| `teams.js` | Multi-car display: `stableCarId` (hostname over IP, so a DHCP lease change is not a new car), `applyFlush` (one 20 Hz buffer flush, kept pure and node-testable), `resolveActiveCars` (**`strategyIp` vs `displayIp`**), `teamColor` + the 16-colour palette, `withTeamOrder`, `coalescePacket`, `dropStaleTeams`. |
| `pitDetect.js` | `detectPitEdges` — the relay's pit state machine, and the one module shared across that boundary. A stop must be sustained for `PIT_MIN_STOP_MS`, so a spin no longer fires a phantom stop. Speed-only: a car parked on track past the dwell still reads as a stop. |
| `connection.js` | `backoffDelay`, `isSessionActive`, `pickAutoConnectIp`. |
| `sessionAnalysis.js` | Recorded session → strategy inputs, single- and multi-driver merge. |
| `compoundDetector.js` | Doc-only stub. GT7 UDP does **not** expose tyre compound; it is user-set. No runnable code. |

### React hooks — `src/hooks/`

| File | Role |
|------|------|
| `useStrategy.js` | Wraps `findBestStrategies`. 600 ms debounce + immediate `calculate()`. Exports `computeStrategy`, the only sanctioned engine entry — it carries the wet-compound filter and the lap-time validation, and returns `null` rather than computing on a malformed lap time. |
| `useTelemetry.js` | WebSocket client to the relay. Packets are buffered in a ref and flushed at 20 Hz — one setState per packet meant ~600 re-renders/sec at ten cars. Prunes cars silent past `TEAM_STALE_MS`; carries one-shot pit edges across a flush window; auto-reconnects with capped backoff. |
| `useCompoundDetector.js` | Watches each packet's `pitExit`; returns `pendingIps` + `confirmCompound`/`stopDetecting`. Dedupes by `${ip}-${lap}`. |
| `useStintLog.js` | Adapter over `stintLog.js`. Opens a stint on pit exit (driver `null` until named), closes it on the next pit entry, persists to `gt7-stint-log`. |
| `useTelemetryLearner.js` | Runs the learner against the ★ car's packets, pushes in the confirmed compound **and driver**, recomputes once per lap, and persists to `localStorage` on the same edge. Restores per car on selection. Never writes to `inputs`. |
| `useTrackMap.js` | rAF loop recording GPS from **every** connected car into a shared 3 m grid — ten cars on one line cost nothing over one and complete the circuit ~10× faster. Each car extends its own segment. Only `strategyIp`'s pit entry fires `onPitEntry`. |
| `useDialog.js` | The app's own confirm/alert. `ask()` resolves true/false, `tell()` on acknowledgement. Replaces `window.confirm`, which also **blocks the main thread** while the relay is pushing at 20 Hz. |
| `useToasts.js` | Notices for what happened while you were looking elsewhere. Idempotent by `key`, capped, sticky ones wait for an answer. |

### Components — `src/components/`

| File | Role |
|------|------|
| `InputPanel.jsx` | The setup sidebar, shown on the Stratégie tab only. Car presets, race, pit timing, fuel, the compound table (life + three lap times + must-use) and per-driver overrides — both rendered through `orderCompounds()` so the tyres read softest-first like everywhere else, without reordering the stored array the engine depends on. |
| `ResultsSummary.jsx` | KPI strip, driver chips, top-6 comparison cards. `deltaLabel` signs itself from the number rather than a hardcoded `+`. |
| `StrategyTimeline.jsx` | The race as one horizontal bar. Hand-drawn with CSS percentages after the Recharts version was found rendering no bars at all; the label fits by a **container query** on the segment, because whether "S7 12" fits is a question about pixels and a percentage of the race cannot answer it. |
| `StintTable.jsx` | Lap-by-lap stint detail; red rows for warnings. |
| `NowView.jsx` | The plan strip across the top of the Course tab, laid out as a **grid**: car, stint, laps left, the next call, race state — then what a stop this lap would do underneath. One label size, one value size, one hero number. |
| `LiveDashboard.jsx` | The selected car: gear/speed, RPM/throttle/brake/fuel, fuel intel, tyre **temperature** per corner (the radius-derived wear was removed — it never moved on real hardware), laps-on-set against the configured life, compound + driver pickers, the incident panel and the box-now comparison. Exports `TrackMap`. |
| `TelemetryLeaderboard.jsx` | The field by race position: lap/gap, last/best, compound, fuel, pit status, laps-until-box per car, ★ to mark my team and ✎ to rename. |
| `TelemetryControls.jsx` | Relay URL, PS5 list, LAN scan. Lives in the **header** as a dropdown, not in a tab. |
| `DriversTab.jsx` | Per-driver drive time against `minDriverTimeSecs`, each driver's **measured burn rate** (marked when short of the sample gate), and the per-stint log — whose driver cell is a picker, so a stint nobody named at the stop can be named later and its laps move with the label. |
| `NextStintFuel.jsx` | "Who is getting in, on what" → litres, in the pit group of the car panel beside the pickers that record what actually happened. Offers only compounds that are set up, and says nothing at all when there is no next stop to fuel for. |
| `LearnerRecommendations.jsx` | Propose-and-accept cards with a trust line. |
| `Dialog.jsx` | The card the app asks its questions on. Escape and the backdrop cancel, Enter confirms, focus lands on the confirming button. |
| `Toasts.jsx` | Bottom right — the top of this screen is the plan and the left is the field. Notices **navigate** rather than act: a tyre picked by mis-tapping a corner card is a wrong compound in the stint log for the rest of the stint. |
| `Onboarding.jsx` | First-run overlay, gated by `gt7-onboarded`. |
| `TeamPanel.jsx` | Group/race/session organisation. |

### i18n — `src/i18n/`

`strings.js` (`t`, `LANGS`, `loadLang`, `compoundName`, `compoundShort`,
`compoundSequence`, `COMPOUND_ORDER`, `orderCompounds`) over `en.js` / `fr.js`.
English is the source of truth and the fallback; `DEFAULT_LANG` is `'fr'`.
`lang` is a plain prop — no context, no module global. `tests/test_ui_i18n.js`
fails if the tables drift apart.

### Root — `src/App.jsx`

Owns **all** state (no Redux/Context). Three tabs — **Stratégie** (the only one
with the sidebar), **Course** (the in-race screen and the default landing) and
**Pilotes**.

The one piece worth knowing: **`engineInputs`** is the single reconciler between
the user's setup, the race clock and where the ★ car actually is. Shortening
`raceDurationHours` without also setting `midRaceMode` left the engine planning
the remaining hours *from lap 1, on a full tank, on fresh tyres* — so from about
half distance the Now view said "run to the flag" for the rest of the race. It
replaced an effect keyed on `telemSelectedIp` — the car you are *looking at* —
which rebuilt your plan from a rival's fuel. One writer (the user, via
InputPanel), one deriver (this).

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

`npm test` runs all **45 suites** in sequence — **~3 096 assertions**, all
pure node, printing `✓/✗` and exiting non-zero on failure. **These are the
guardrail — keep every assertion green, and judge a run by its EXIT CODE, not
by reading the output.** Roughly 1 350 are hand-written; 1 643 are the bulk
invariant sweep in `test_invariants.js` — worth knowing which is which when
judging how much a passing `npm test` proves. (Counts inside loop-based checks
scale with how many stints an input produces, so they shift slightly whenever
engine behaviour changes. That is expected.)

**Newer suites, roughly in the order they were added:**

| File | Role |
|------|------|
| `test_race_clock.js` / `test_ui_race_clock.js` | The start stamp and what follows: remaining quantised to the minute, the plan sized to what is left, the Stratégie tab's banner explaining why its total is not the one you typed, and clearing the start from that banner. |
| `test_conditions.js` | Dry/wet as a compound filter, the fallback when no wet tyre is configured, and the crossover figure. |
| `test_car_roles.js` / `test_ui_safety_car.js` | A safety car out of the standings and the gap chain, renumbering behind it without a hole, deployment detection, and the reduced pit loss. |
| `test_rival_intel.js` | Burn rate from a car's own trace, the predicted box lap, and the refusal to guess before enough clean laps. |
| `test_ui_learner_recs.js` | The proposals in the car panel are ONE row — the first proposal, "1 of N", its sample count and volatility badge, buttons acting on the one on screen — while the Strategy tab keeps the full cards. The cards were 135px and pushed the car panel into a scroll. |
| `test_stint_fuel.js` / `test_ui_next_stint.js` | The burn-rate fallback chain and the litres, then the same on screen: a tank target rather than a netted amount, the brimmed case counted in laps rather than naming a race lap it cannot know, only tyres that are set up, and silence on the final stint. |
| `test_tyre_history.js` | Per-compound history, median-of-finished-sets outlook, silence on a first set. |
| `test_incident.js` / `test_pit_now.js` | The measured loss, and box-now vs wait run through the real engine. Includes the guard that an unknown fuel reading is **not** an empty tank. |
| `test_racecraft.js` / `test_ui_racecraft.js` | Where I rejoin and between whom, the undercut, and the traffic I am about to reach — plus the two failures the live field caught: a position disagreeing with the leaderboard, and a delta that escaped the field ("P4 → P13" in a ten-car race). |
| `test_learner_store.js` | The learner surviving a reload: the round trip, the cap, and that a restored learner is still on the **same tyre** — a rebuilt learner with no stint origin files a twenty-lap-old set as fresh, which is worse than losing the data. |
| `test_ui_timeline.js` | The bar renders segments at all — written after the Recharts version drew none. |
| `test_ui_trackmap_record.js` | The circuit recorded from every car into one shared grid, each car extending its own segment. |
| `test_ui_race_plan.js` | Four hours into an eight-hour race: the plan built on the car that exists, not a fresh one. Polls for the plan rather than sleeping past a debounce. |
| `test_ui_i18n.js` | The two string tables at parity, and one tyre order everywhere. |
| `test_ui_panels.js` | The four dashboard panels nothing rendered: incident, box-now, fuel intel, tyre outlook. Found a real bug — the fuel line gated on `intel` existing rather than `intel.confident`, so its "measuring" message was unreachable for the case it was written for. |
| `test_ui_toasts.js` | One event not stacking two cards, my car's notice not timing out while a rival's does, the stack dropping the oldest, a refreshed notice getting a fresh countdown, and that acting on one **navigates**. |
| `test_ui_setup.js` | The sidebar and the comparison cards — tyres softest-first without reordering storage, wets enterable before they have a life, and the delta badge signing itself. |


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

- **`compoundDetector.js`** is a comment-only file (the live logic is in
  `useCompoundDetector`). Intentional, but easy to mistake for dead code.
- **`tireWear` is radius-derived and was never shown to work.** Track testing
  found it does not move, matching the suspicion that GT7 reports a fixed spec
  radius. **It is no longer displayed.** The relay still computes it (harmless,
  and `npm run diag:tyres` prints raw radii so the question can be settled on
  real hardware); the dashboard shows tyre *temperature*, which GT7 genuinely
  sends, plus a modelled tyre life in laps-on-set.
- **Compound is user-set and always will be.** GT7's UDP stream carries no
  compound id. Everything downstream — the stint log, the tyre history, the
  learner's per-compound curves — is only as right as the taps after each stop.
  This is the single biggest source of wrong data in a real race.
- **Pit detection is speed-only.** A car parked on track past the dwell reads as
  a stop.
- **Salsa20 key is version-sensitive.** A GT7 update can change it and silently
  break decoding.
- **Never run against a real PS5 in this form.** Every verification in this
  branch is against `scripts/fake-field.mjs` — real Salsa20 packets from
  loopback addresses, but a simulation whose physics I wrote. The relay's byte
  offsets and crypto are exercised end-to-end by `test_relay_e2e.js`; the
  *plausibility of the numbers* on real hardware is not.
- **Packaging scaffolded, installer never built.** `npm run dist` on Windows;
  steps in `docs/PACKAGING.md`.
- **Multi-team scaffolding is load-bearing** for display (leaderboard, track
  map, LAN scan) even though strategy is single-team. Do not delete it.


---

## 6. Commands

```
npm run dev          # Vite dev server :5173
npm run build        # production build → /dist
npm run lint         # ESLint flat config — zero errors, 3 deliberate warnings
npm test             # all 45 suites (~3 096 assertions). Judge by EXIT CODE.
npm run test:smoke   # quick 1h race test
npm run telemetry    # the UDP→WS relay (separate process)
npm run demo         # ten fake PS5s, for testing with no hardware in the room
```

A full pit wall is three terminals: `telemetry`, `dev`, `demo`. All three can
stay up while `npm test` runs — the relay suite uses its own ports (34740 /
21777) and its own `127.0.9.x` source addresses precisely so they do not
collide. See the header of `scripts/fake-field.mjs` for the `PIT_*` knobs.
