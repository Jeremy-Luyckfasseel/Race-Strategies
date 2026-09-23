# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GT7 (Gran Turismo 7) Endurance Race Strategy Calculator — a React + Vite web app that enumerates all valid pit/tire compound combinations and finds optimal race strategies. Accounts for fuel weight degradation, tire wear curves (per-compound, piecewise), variable pit stop times, multi-driver minimum time requirements, and live PS5 telemetry for mid-race recalculation.

**Tech stack:** React 19, Vite 7, WebSocket (`ws` 8.18), Node.js UDP relay. No charting library — the one chart is hand-drawn (see `StrategyTimeline.jsx`).

## Commands

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to /dist
npm run lint         # ESLint (flat config)
npm run preview      # Preview production build locally
npm test             # All 47 suites (~3 155 assertions). Judge by EXIT CODE, not output.
npm run test:smoke   # Quick 1-hour race smoke test
npm run telemetry    # Start UDP→WebSocket relay server (separate process)

# Or run test files directly:
node tests/test.js
node tests/test_comprehensive.js
node server/telemetry-server.js
```

Test scripts in `tests/` are plain Node.js — no test runner. They import `findBestStrategies` directly from `src/logic/strategy.js` and log JSON output.

## Architecture

### Strict separation between logic and UI

The strategy engine (`src/logic/strategy.js`) is pure JavaScript with zero React dependency. This is intentional — it can be tested with `node` directly and keeps the algorithm portable.

The React integration layer is `src/hooks/useStrategy.js`, which wraps `findBestStrategies()` with a 600ms debounce and exposes results to components.

### Data flow

```
App.jsx  (state: inputs, selectedIndex, telemSelectedIp, activeTab, teamLabels, teamCompounds)
  ├── InputPanel            → collects all parameters; localStorage presets + PS5 IPs
  ├── useStrategy hook      → calls findBestStrategies(inputs); debounced; returns sorted array
  ├── useTelemetry hook     → WebSocket to relay server; multi-team Map<ip, packet>; scan support
  ├── useCompoundDetector   → watches pitExit flag; prompts user to confirm tire compound
  ├── useToasts             → notices for what happened while you looked elsewhere
  ├── [Stratégie tab]  (the only tab with the setup sidebar)
  │     ├── ResultsSummary  → KPI strip, driver summary, top-6 strategy comparison cards
  │     ├── StrategyTimeline → the race as one bar: stint segments, pit marks, windows
  │     └── StintTable      → lap-by-lap stint detail for selected strategy
  ├── [Course tab]  (the in-race screen, and the default landing)
  │     ├── NowView         → the plan strip: clock, stint, laps left, the next call,
  │     │                     and what a stop THIS lap would do to the race
  │     ├── TelemetryLeaderboard → multi-team table: pos, lap, gap, times, compound, fuel
  │     ├── TrackMap        → the circuit, recorded from every car, with lapped-car marks
  │     └── LiveDashboard   → the selected car: speed/gear, RPM/pedals/fuel bars,
  │                           tyre temps, compound + driver pickers, fuel intel, incident
  └── [Pilotes tab]
        └── DriversTab      → per-driver drive time vs. the minimum, and the stint log
```

`TelemetryControls` (relay URL, PS5 list, LAN scan) hangs off the **header** as a
dropdown rather than living in a tab: it is setup, needed about twice a weekend,
and in the flow it cost a row of the one screen that has to show everything.

State lives only in `App.jsx` — no Redux, no Context.

### Strategy algorithm (`src/logic/strategy.js`)

- `findBestStrategies(inputs)` — entry point; generates all compound sequences up to 5-element patterns (~4000 for 5 compounds), each tried both as a repeating cycle and holding the last compound, simulates each, filters by mandatory stops/compounds, deduplicates, and sorts by (total laps DESC, race time ASC). Rejects (returns `null` upstream via `useStrategy`) if any active compound's or driver-override's lap time fails `isValidLapTimeStr` — never silently falls back to `parseLapTime`'s 120s default for user input.
- **"Banzai" final-stint override**: no pattern (cyclic or hold-last, capped at 5 elements) can express "run X for the whole race, but Y just for the true final stint" once a race needs more than 5 total stops — cyclic repeats Y periodically, hold-last locks it in forever once reached. That's a real gap: degradation barely matters over a short closing stint, so a fresher/faster compound can gain a little there even when it would lose over a full one. After ranking, the #1 result is re-simulated once per OTHER active compound with `finalStintOverride: { atPitsDone, compound }` (only that one compound decision changes; everything before it is identical by causality), keeping whichever wins on totalLaps/race-time. Only tried on the #1 result, not all candidates — the effect is local to one stint and can't plausibly change which base compound plan ranks best, so this stays cheap (a handful of extra `simulateStrategy` calls, not thousands). Every override candidate is re-checked against `mandatoryIds` before being accepted — the mandatory-compound filter runs on the un-overridden candidates, before ranking, so it has no way to know this step exists; the cheapest way to satisfy "compound X must appear somewhere" is often to use it for one short stint, which can legitimately be the true final one, and the override must not silently swap that away.
- `simulateStrategy(params)` — lap-by-lap simulation: tracks fuel consumption, fuel-weight speed correction per lap, piecewise tire wear curve (0–50% soft degradation, 50–100% harder degradation), and greedy multi-driver assignment.
- Pit stop time = `basePitSecs + (tiresChanged ? tireChangeSecs : 0) + fuelToAdd / fuelRateLitersPerSec` — the three terms are additive (tyres and fuel serviced sequentially, not in parallel, per confirmed GT7 behaviour).
- Tyre-change decision: forced when the compound plan calls for a different compound, or when the current set is at exactly zero remaining life (not "won't reach the end of the whole race" — that's true at nearly every stop in a real endurance race and made the comparison below unreachable in practice); otherwise it's a real cost/benefit comparison (projected pace on ageing vs. fresh tyres over the shared upcoming-stint length, bounded by the tyres' own remaining life, vs. `tireChangeSecs`) via `tirePaceSecs`/`cappedStintLaps`.
- Mandatory minimum pit stops are enforced during stint planning by capping stint length.

### Fuel weight correction model

User observes lap times at full tank. The engine corrects t(start), t(mid), t(end) to their full-tank equivalents by adding back the fuel-weight penalty that was already burned. During simulation, the correction is reapplied each lap based on actual live fuel level (car speeds up as fuel burns).

### Multi-driver logic

Two candidate assignments are computed per strategy and the better one is kept (`findBestStrategies`, never regresses relative to either alone):
1. **Chronological greedy** (`pickNextDriver`): each stint, as it comes up, goes to the driver who owes the most time toward their minimum; tie-break least accumulated total time. Exception: a stint much shorter than a normal one for this race (e.g. a tyre-life-remainder stint from the tyre-change economics, or every stint when heavy `mandatoryStops` pacing caps them all — `normalStintSecs` accounts for fuel, tyre life, AND mandatory-pacing so it isn't misjudged) can't meaningfully dent the most-behind driver's deficit anyway, so it goes instead to whichever owing driver it WOULD fully satisfy — otherwise a fixed-length race can burn its few long stints on drivers who keep drawing short ones and never catch up.
2. **Longest-stint-first planning + local search** (`planDriverAssignment`): stint lengths are fixed by fuel/tyre/mandatory-pacing independent of driver identity, so the whole race's stint-length sequence is knowable in advance (probed with one throwaway `simulateStrategy` call). Sort stints longest-first and assign each to whoever currently owes the most — so big stints go to whoever needs them before only small ones are left to hand out, something the chronological pick can't see coming. That first (LPT) pass still commits to each assignment irrevocably and can land short of an achievable split; a second pass then repeatedly swaps a stint between two drivers whenever it improves the outcome, until no swap helps — a standard local-search refinement for multiway partitioning. Not exact optimization (that's NP-hard in general), but reliable for the stint/driver counts an endurance race actually produces.

Neither dominates the other (confirmed empirically — each can occasionally out-perform the other), so `findBestStrategies` runs both and picks the better one — but "better" always respects the same priority the final ranking uses first: totalLaps DESC, then race time ASC. Since per-driver compound times can differ, which driver runs a stint changes how many seconds it takes, so the two assignments can occasionally complete a different number of laps for the same compound plan; only when laps and race time are tied does driver-satisfaction (then worst-case driver total) decide. This guarantees the swap never makes a candidate rank worse than it otherwise would — it only ever improves fairness when doing so is free. This closes most cases a single greedy pass missed, but is still not a hard guarantee: with very few total stints relative to driver count (e.g. 2 drivers splitting a 2-stint race) there is only one way to split them, and a minimum set right at the theoretical maximum can still leave a driver marginally short by design — that's stint lengths (fixed by fuel/tyre physics, discrete lap counts) not dividing evenly, not an assignment-quality problem, and no algorithm can fix it without changing pit timing itself. Per-driver compound lap times override global times when set.

### My team vs. the car you're looking at

Once several cars are on screen these are two different things, and conflating
them silently repoints the strategy at a rival. `resolveActiveCars`
(`src/logic/teams.js`) splits them:

- **`strategyIp`** — my car, marked with ★ in the leaderboard and persisted to
  `gt7-my-team`. Owns the drivers, the stint log and its driver prompts, the
  learner's recommendations, the Now view and the mid-race auto-fill. A car
  marked mine stays mine while it is not transmitting.
- **`displayIp`** — the car the dashboard widget is inspecting; follows a
  leaderboard click so you can look at anyone.

Every car gets a stint log (a rival's pit history is useful), but only mine
carries driver names or raises a driver prompt — otherwise a 10-car field
would pop a confirmation every time anyone pitted. With no team marked and
several cars connected, both resolve to `null` rather than guessing
(DECISION 4).

### Live driver assignment (telemetry side)

This is separate from the planner's `planDriverAssignment` above — it is manual, not computed. On the Course tab, `LiveDashboard` shows a driver picker (from `inputs.drivers`) alongside the existing compound picker; both are prompted together in one banner when a pit stop finishes (`pendingDriver` from `useStintLog`, `pendingConfirmation` from `useCompoundDetector`). Picking a driver calls `useStintLog`'s `assignDriver(ip, driverId)`, which only labels the stint that's already running — it has no effect on the strategy planner's stint lengths or ranking. The next-stint block (`NextStintFuel`) asks the same two questions BEFORE the stop; its pick lives in `App` as `nextPick` and, at my car's pit exit, is applied as the new stint's driver and tyre, answering both prompts and clearing itself. This relies on the pit-exit effect in `App` being declared after `useCompoundDetector` and `useStintLog`, so in the same commit the new stint is already open and both prompts already raised — `test_ui_app_e2e.js` guards it. The Pilotes tab (`DriversTab.jsx`) reads the resulting log to show each driver's total time against `minDriverTimeSecs` and a per-stint table (duration, tyre, avg/best/worst lap); see `stintLog.js`/`useStintLog.js` above.

### ESLint config note

The `no-unused-vars` rule ignores variables whose names start with an uppercase letter or underscore (pattern: `^[A-Z_]`). This is intentional to allow unused React import-style names.

`tests/`, `scripts/` and `server/` get `globals.node`, since they run under node rather than in a browser. Without that block every one of them reported `process`, `Buffer` and `console` as undefined — about sixty false errors that buried the real ones.

**Lint is at zero errors and CI fails on any new one**, so keep it there. Three `react-hooks/exhaustive-deps` warnings remain and are deliberate. **Two**
`eslint-disable` lines live in `src/`, each carrying its reasoning on the line
above it: `exhaustive-deps` suppressions for deliberately mount-only or
single-dependency effects (`App.jsx`, `TelemetryControls.jsx`). A third, in
`useTelemetryLearner.js`, was removed — it became an unused-directive warning of
its own once that effect gained a `try` block — and its reasoning is left there
as a plain comment. If you add one, justify it the same way or fix the code
instead.

## Key files

| File | Purpose |
|------|---------|
| `src/logic/strategy.js` | Pure-JS strategy engine — also takes `pacePenaltySecs` + `pacePenaltyLaps`: a flat cost on every lap for a bounded number of laps. **Bounded because damage does not last the race — the car is repaired at the next stop.** Applied per lap in the simulation rather than folded into the compound constants, which could not express a penalty that ends; it deliberately does not move `avgLapTimeSecs`, a planning estimate, since over the handful of laps damage usually lasts that beats pretending the whole race is slower (~700 lines); exports `findBestStrategies`, `TIRE_COMPOUNDS`, `CAR_PRESETS`, `formatLapTime`, `formatRaceTime`, `parseLapTime`, `isValidLapTimeStr`, `calcPitStopTime` |
| `src/components/ManualPlan.jsx` + `runManualPlan` (strategy.js) | **A strategy typed in by hand**, on the Strategy tab. Rows of tyre / stints (or "until the flag" on the last row) / laps per stint, so ten medium stints are one row. `findBestStrategies({ ...inputs, manualPlan })` expands the rows into the engine's own compound plan (hold-last) and runs it through the same `evaluate` as the engine's plans — same simulation, same two driver assignments; drivers are deliberately not part of the typed plan. Typed laps reach `simulateStrategy` as `forcedStintLaps`, still capped by fuel and tyre life (a cut stint is reported), and the stop before a typed stint fuels for THAT stint and changes a set that could not last it. Each row reports what the engine would run on it (the "engine: N" chip that fills the field), rows the race never reaches, and `beyondPlan` when the rows run out before the flag. Mid-race it skips the stints in my stint log. "Race this plan" makes it `planBase`, which the race screen and the freeze follow instead of `best`; persisted as `gt7-manual-plan` — deliberately NOT a RACE_KEY, because it is typed in the lobby and "New race" is how the lobby is cleared before the real one; it is in SNAPSHOT_KEYS so a save carries it |
| `src/logic/stintFuel.js` | How many litres for the stint about to start, given who is getting in and what is being fitted — the two things the plan's per-stop figure could not know. `burnRateFor` goes driver → car → configured and reports which it used, because the same litres from a driver's own 41 laps and from a number typed in last week are not the same claim. `stintFuel` answers with a **tank target**, capped at the tank: it must not net against live fuel, since the stop it describes can be 25 laps away and the car arrives near empty — netting there read "nothing to add" for a stint that would start on fumes. Deliberately not an engine re-run per driver: stint length is set by fuel range, and per-driver fuel would make fuel range depend on who is driving while the driver is picked FROM the stint length |
| `src/logic/tyreHistory.js` | Reads the stint log back as per-compound history: sets run, laps each, best/avg, and measured fall-off. `currentSetOutlook` says how long previous sets of the compound you are on lasted and how many laps that leaves. The **median** of previous sets, so one stint cut short by a spin does not become the expectation, and completed stints only — the one being driven would drag it down. Silent on a first set |
| `src/logic/conditions.js` | Dry/wet as a **filter over which compounds the engine may pick**, not a second simulation — nothing about the car changes because it started raining. Falls back to whatever is active rather than refusing to plan when no wet tyre is set up. Also `crossoverSecsPerLap`: a stop costs X and you have N laps to win it back, so the per-lap loss that justifies changing tyres is X/N |
| `src/logic/paceTrack.js` | A ten-lap rolling window of completed lap times per car — the stint log keeps aggregates on purpose, which is useless for "what was this car doing just before X". Powers incident measurement and `detectPaceDrop`, which finds a **step** in a rival's pace rather than a slope (tyres going off is a slope) and requires the step to be **sustained across every one of the last three laps**, so a pit stop's slow in-lap and out-lap followed by a normal one does not read as damage |
| `src/logic/pitNow.js` | **Box now or wait**, answered by the engine rather than by arithmetic. The first version costed an early stop as a whole extra stop; that is only true if the race cannot absorb it, and a plan that finishes with tyre life or fuel range left over absorbs it for nothing but the time stationary — which it usually does, since the last stint rarely ends exactly as the tyre does. Builds two futures (come in: full tank, fresh tyres, stop+repair off the clock / stay out: current fuel and tyres, the bleed to the next stop off the clock), runs both through `findBestStrategies` and compares **laps completed** first, race time second. A sub-second difference is reported as a dead heat rather than broken arbitrarily |
| `src/logic/incident.js` | Not a damage button — anything that makes the plan wrong. Costs all three options in seconds (carry it, repair at a stop you were making anyway, come in now) and names the cheapest. The point: **a scheduled stop is already paid for**, so repairing there costs only the repair, which is why "just pit immediately" is usually wrong. The lap the incident happened on is costed separately as a one-off, never averaged into the per-lap rate — it holds the spin and the recovery, and folding it in would send a car in for a scrape |
| `src/logic/carRoles.js` | Not every car on the LAN is racing. A safety car marked here is out of the standings, the gap chain, the stint log and the fuel intel, but still shown and watched. `safetyCarDeployed` fires the moment it leaves the pit lane; `fieldSlowdown` measures how much slower the field is running (median of last-lap vs best-lap, so one bad lap moves nothing) and `pitLossUnderSafetyCar` turns that into what a stop is actually worth right now |
| `src/logic/raceClock.js` | When the race actually started, and what follows. The lobby is open for hours beforehand and that driving is practice, so the race has an explicit start stamp (`gt7-race-start`, a RACE_KEY). `raceProgress` derives elapsed/remaining from it and quantises remaining to the **minute** — `applyRaceClock` then replaces `raceDurationHours` with what is left, so the plan follows the clock instead of a field someone retypes from the pit wall, and the search runs once a minute rather than once a second. Pure: the caller passes `now` |
| `src/logic/compoundDetector.js` | Placeholder/note: GT7 UDP does not expose compound ID; compound tracking is user-driven only |
| `src/logic/stintLog.js` | Pure stint-log state machine for the Pilotes tab: `openStint`/`closeStint` (folds the running lap sum/count into a duration + average, no per-lap array kept), `reopenStint` (pit-exit's entry point — archives an already-open `current` first if its closing pit-entry packet was never seen, instead of overwriting it), `recordLap`/`recordLapIfClean` (best/worst; the latter skips the out-lap and paused/off-track laps), `setCompound`, `assignDriver`/`assignDriverAt` (name a stint after the fact), and `stintLapRange` — **exclusive of the closing lap**, because adjacent stints share the pit lap (`closeStint` takes `endLap: currentLap`, `reopenStint` takes `startLap: currentLap`, the same game lap) and it is what the learner records anyway: a lap is filed when the NEXT one starts. Inclusive, naming a stint that had just ended matched the running stint's `startLap` and silently repointed every later lap to that past driver |
| `src/hooks/useStrategy.js` | React hook wrapping the engine; 600ms debounce + manual `calculate()` |
| `src/hooks/useTelemetry.js` | WebSocket hook; exposes `connect`, `disconnect`, `sendIPs`, `scan`; returns `teams` Map<ip, packet>, `scanning`, `scanResults` |
| `src/hooks/useCompoundDetector.js` | Watches `data.pitExit` per team; returns `pendingIps` Set + `confirmCompound(ip)` / `stopDetecting(ip)` |
| `src/hooks/useTrackMap.js` | Records the circuit from **every connected car**, not one. Points dedup into a 3 m grid, so ten cars on the same line cost nothing over one — they only add cells where the lines differ, which gives the track its real width and completes it ~10× faster (the whole value of a lobby session before the race). Per-car recording state lives in `map.cars`; the grid, segments and bounds are shared, and each car extends **its own** segment — appending to whichever segment was last welds two cars' traces into one stroke. Only `strategyIp`'s pit entry fires `onPitEntry`. Covered by `tests/test_ui_trackmap_record.js` |
| `src/hooks/useStintLog.js` | Thin adapter over `stintLog.js`: opens a stint on pit exit (driver left `null` until `assignDriver(ip, driverId)` is called), closes it on the next pit entry, persists to `localStorage` (`gt7-stint-log`); returns `{ logs, pendingDriverIps, assignDriver, resetAll }`. A fresh log's first stint that "began" after the lap the car is on is dropped and reopened: after "Start race" the car's last lobby packet is still held, and without this the race's first stint opened at the lobby's lap number |
| `src/App.jsx` | Root component; owns all state; three-tab UI (Stratégie / Course / Pilotes, landing on Course); derives `engineInputs` from the race clock and the ★ car; raises the toasts |
| `src/components/InputPanel.jsx` | Full sidebar form: car presets, race settings, pit timings, fuel, tire compounds, mid-race mode, drivers, live telemetry |
| `src/components/ResultsSummary.jsx` | KPI cards + driver summary chips + strategy comparison grid (top-6, expandable) |
| `src/components/StrategyTimeline.jsx` | The race as one horizontal bar — a segment per stint sized by its share of the laps, pit marks, pit-window shading, compound colours. Plain CSS percentages: no chart library, no measurement, so `tests/test_ui_timeline.js` can assert on it. It replaced a Recharts chart that rendered **no bars at all** under Recharts 3 (every rectangle came back `width: 0`) while its axes and tooltip still worked — which is why that test exists |
| `src/components/StintTable.jsx` | Stint detail table; highlights warning rows in red |
| `src/components/LiveDashboard.jsx` | Single-team telemetry widget: gear/speed, RPM/throttle/brake bars, fuel bar, **tyre temperature per corner** (the radius-derived "wear %" was removed — it never moved on real hardware; see `npm run diag:tyres`), modelled tyre life in laps-on-set vs. configured `tireLife`, driver + compound pickers, SVG track map (GPS recorded at 60Hz RAF) with pit lane detection and multi-car dots |
| `src/components/TelemetryControls.jsx` | Collapsible panel: server URL + connect/disconnect, PS5 IP list management, network scan button and results |
| `src/components/TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap times, compound picker, fuel bar, pit/track status |
| `src/components/DriversTab.jsx` | Pilotes tab: per-driver total drive time vs. `minDriverTimeSecs`, and a per-stint log (driver, tyre, laps, duration, avg/best/worst lap) for the selected team, including the in-progress stint |
| `src/index.css` | The whole theme, as CSS vars on `:root`. Accent is **racing red `#E4002B`**, not gold — the app moved off purple-and-gold long ago and this line said otherwise for months. The intent behind the look, and the rules that came from getting it wrong, are in `docs/DESIGN.md`; read the live `--accent` / `--bg-*` values here before styling anything |
| `server/telemetry-server.js` | Node.js UDP relay: receives Salsa20-encrypted GT7 packets on port 33740, relays to browser via WebSocket on port 20777; supports LAN scan for PS5s and DNS hostname resolution |
| `tests/test.js` | Smoke test (1h race) |
| `tests/test_comprehensive.js` | The engine's own suite (~142 assertions). The full list of all 47 suites, and what each one guards, is in `docs/CURRENT_STATE.md` §2 |

## Telemetry server

`server/telemetry-server.js` runs as a separate Node.js process (not part of the Vite app).

- UDP port **33740** — receives encrypted telemetry from GT7 on PS5
- UDP port **33739** — sends heartbeat ("A") packets to PS5s to keep them streaming
- WebSocket port **20777** — relays decoded packets to the browser

**Protocol (browser ↔ relay):**
- Browser → Server: `{ type: 'setIPs', ips: ['192.168.1.x', ...] }` to start/update tracking
- Browser → Server: `{ type: 'scan' }` — trigger LAN scan for active PS5s
- Server → Browser: `{ type: 'ips', ips: [...] }` — current tracked IPs
- Server → Browser: `{ type: 'scanning' }` — scan started
- Server → Browser: `{ type: 'scanResult', results: [{ip, hostname}] }` — scan complete
- Server → Browser: `{ ps5ip, fuelLiters, fuelRatio, currentLap, totalLaps, speedKmh, onTrack, lastLapMs, bestLapMs, racePos, totalCars, gear, suggestedGear, rpm, rpmLimiter, rpmWarning, throttle, brake, waterTemp, oilTemp, boost, tireTemp[], tireWear[], posX, posZ, paused, pitDetected, pitExit }` per packet

**Pit and compound detection:**
- Pit edges come from `detectPitEdges` (`src/logic/pitDetect.js` — the one module the relay shares with the app, so it stays node-testable). GT7 exposes no pit flag, so it is inferred from speed, and a stop must be **sustained** (`PIT_MIN_STOP_MS`) before it counts. Without that dwell a spin fired a full phantom pit stop: compound cleared, stint closed, driver prompt raised. It remains speed-only — a car parked on track for longer than the dwell still reads as a stop.
- **Car identity is the hostname when one is known.** `stableCarId` (`src/logic/teams.js`, also imported by the relay) picks what a car is reported as — the value everything downstream keys on: colour, stint log, whether it is the starred team. The LAN scan registers bare IPs, so without this a DHCP lease change makes a console look like a brand-new car mid-race. The relay remembers hostnames found by reverse DNS during a scan and reports those instead. It deliberately does **not** change what gets heartbeated: heartbeats keep going to the IP, which always works, because a hostname that fails to forward-resolve would mean no telemetry at all. Address to reach the console, hostname to name it.
- `pitDetected` — set for one packet when the car enters the pit lane (App clears the compound selection)
- `pitExit` — set for one packet when the car exits the pit (triggers `useCompoundDetector` to request compound confirmation from user)
- GT7 UDP does not expose compound ID; it must be set manually via the compound picker buttons after each stop

## Default inputs (App.jsx)

- Race: 8 hours, **0 mandatory stops** — endurance racing has no stop count in the rules; fuel and tyres decide when the car comes in. The input remains for series that do impose one
- Fuel: 100L tank, 28 laps/tank, fuel map 1.0×, weight penalty 0.03 s/L
- Pit: 25s base, 27s tire change, 4.0 L/s fuel rate
- Tire compounds: H, M, S, IM, W (all active by default)
- Drivers: 1 driver, 2h minimum drive time

## MVP scope & working rules

These are the locked guardrails for the current build. They override convenience.
The full rationale lives in `docs/DECISIONS.md` (source of truth); the live module
map is `docs/CURRENT_STATE.md`; the task checklist is `docs/BACKLOG.md`; the look
and the rules behind it are `docs/DESIGN.md`.

### Locked MVP scope

- **Strategy is single-team.** GT7 on PS5, with strategy inputs **auto-derived
  from live telemetry** (the differentiator). It must work with no servers and
  no cooperation from anyone else. Driver rosters, stint planning, the Pilotes
  log and the calculated strategy all belong to **my team only** — there is one
  `inputs` object and one engine run, and that is deliberate.
- **Display is multi-car (local LAN).** Every PS5 on the same LAN, relayed by
  the one local `telemetry-server.js`, is **shown** on the track map and the
  multi-team leaderboard: name, position, gap, tyre, fuel, lap times. A 10+ car
  LAN event is a supported scenario for *display*, so multi-car scaffolding
  (leaderboard, `Map<ip,packet>`, LAN scan, `src/logic/teams.js`) is
  **load-bearing — do not delete or de-emphasize it.**

### Out of scope (v2 — do NOT build now)

- Distributed multi-car aggregation (anything beyond one local LAN + one relay).
- Cloud server for at-home leagues.
- Per-team strategy: driver rosters, inputs or a calculated plan for teams
  other than my own.
- F1-game support.

### Working rules

- **Always run `npm test` after changes.** Keep every existing assertion passing.
  **Never delete or weaken a test to make it pass** — fix the code or the test's
  premise, never silence the guardrail.
- **UI changes need a UI test.** The components are rendered for real in
  `tests/test_ui_*.js` via a small jsdom harness in `tests/helpers/` (React's
  own `act`, a hand-stepped `requestAnimationFrame`, and an esbuild module hook
  so `.jsx` imports work under plain node). Still no test runner — the same
  assert/section style as every other suite. The track map's dots are built
  with raw `createElementNS` inside an rAF loop, so nothing else catches a
  break there.
- **`src/logic/` stays pure JS** with zero React dependency, runnable under plain
  `node`. The engine is portable and node-testable by design.
- **One feature per git branch.** Each phase / feature gets its own branch.
- **English is primary; all user-facing strings go through `src/i18n/`**
  (`strings.js` + `en.js`/`fr.js`). `en` is the source of truth and the fallback
  for a missing key; `DEFAULT_LANG` is `'fr'` so an unconfigured machine (and the
  UI tests) see French. `lang` is threaded as a plain prop from `App.jsx` — no
  context, no module global — so a new component takes `lang = DEFAULT_LANG` and
  calls `t(key, lang, vars)`. Never hardcode a visible string; adding Dutch is
  `nl.js` plus one entry in `LANGS`. `tests/test_ui_i18n.js` fails if the tables
  drift apart.
  `src/logic/` stays presentation-free: it keeps its English `label`/`warning`
  text (logs and the other suites assert on it) and additionally emits what the
  UI renders — `warningCode` on a stint, `sequenceIds` on a strategy, `labelKey`
  on a recommendation. Compound display names come from `compoundName()` /
  `compoundShort()` / `compoundSequence()` in the i18n layer, never from the
  engine's `TIRE_COMPOUNDS[].name`.
- **Product name is a placeholder.** `Race-Strategies` is the repo name only — do
  not hardcode a brand string anywhere it's hard to swap later.
