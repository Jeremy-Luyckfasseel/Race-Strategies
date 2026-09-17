# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GT7 (Gran Turismo 7) Endurance Race Strategy Calculator — a React + Vite web app that enumerates all valid pit/tire compound combinations and finds optimal race strategies. Accounts for fuel weight degradation, tire wear curves (per-compound, piecewise), variable pit stop times, multi-driver minimum time requirements, and live PS5 telemetry for mid-race recalculation.

**Tech stack:** React 19, Vite 7, Recharts 3.7, WebSocket (`ws` 8.18), Node.js UDP relay

## Commands

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to /dist
npm run lint         # ESLint (flat config)
npm run preview      # Preview production build locally
npm test             # Full test suite (~129 tests)
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
  ├── [Strategy tab]
  │     ├── ResultsSummary  → KPI strip, driver summary, top-6 strategy comparison cards
  │     ├── StrategyTimeline → Recharts horizontal bar chart (stints + pit windows)
  │     └── StintTable      → lap-by-lap stint detail for selected strategy
  └── [Télémétrie tab]
        ├── TelemetryControls   → server URL field, PS5 IP list, network scan button
        ├── TelemetryLeaderboard → multi-team table: pos, lap, gap, times, compound, fuel, status
        └── LiveDashboard       → single-team widget: speed/gear, RPM/pedals/fuel bars,
                                   tire temps/wear, compound picker, SVG track map with car dots
```

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

### Live driver assignment (telemetry side)

This is separate from the planner's `planDriverAssignment` above — it is manual, not computed. In the Télémétrie tab, `LiveDashboard` shows a driver picker (from `inputs.drivers`) alongside the existing compound picker; both are prompted together in one banner when a pit stop finishes (`pendingDriver` from `useStintLog`, `pendingConfirmation` from `useCompoundDetector`). Picking a driver calls `useStintLog`'s `assignDriver(ip, driverId)`, which only labels the stint that's already running — it has no effect on the strategy planner's stint lengths or ranking. The Pilotes tab (`DriversTab.jsx`) reads the resulting log to show each driver's total time against `minDriverTimeSecs` and a per-stint table (duration, tyre, avg/best/worst lap); see `stintLog.js`/`useStintLog.js` above.

### ESLint config note

The `no-unused-vars` rule ignores variables whose names start with an uppercase letter or underscore (pattern: `^[A-Z_]`). This is intentional to allow unused React import-style names.

## Key files

| File | Purpose |
|------|---------|
| `src/logic/strategy.js` | Pure-JS strategy engine (~700 lines); exports `findBestStrategies`, `TIRE_COMPOUNDS`, `CAR_PRESETS`, `formatLapTime`, `formatRaceTime`, `parseLapTime`, `isValidLapTimeStr`, `calcPitStopTime` |
| `src/logic/compoundDetector.js` | Placeholder/note: GT7 UDP does not expose compound ID; compound tracking is user-driven only |
| `src/logic/stintLog.js` | Pure stint-log state machine for the Pilotes tab: `openStint`/`closeStint` (folds the running lap sum/count into a duration + average, no per-lap array kept), `reopenStint` (pit-exit's entry point — archives an already-open `current` first if its closing pit-entry packet was never seen, instead of overwriting it), `recordLap`/`recordLapIfClean` (best/worst; the latter skips the out-lap and paused/off-track laps), `setCompound`, `assignDriver` |
| `src/hooks/useStrategy.js` | React hook wrapping the engine; 600ms debounce + manual `calculate()` |
| `src/hooks/useTelemetry.js` | WebSocket hook; exposes `connect`, `disconnect`, `sendIPs`, `scan`; returns `teams` Map<ip, packet>, `scanning`, `scanResults` |
| `src/hooks/useCompoundDetector.js` | Watches `data.pitExit` per team; returns `pendingIps` Set + `confirmCompound(ip)` / `stopDetecting(ip)` |
| `src/hooks/useStintLog.js` | Thin adapter over `stintLog.js`: opens a stint on pit exit (driver left `null` until `assignDriver(ip, driverId)` is called), closes it on the next pit entry, persists to `localStorage` (`gt7-stint-log`); returns `{ logs, pendingDriverIps, assignDriver, resetAll }` |
| `src/App.jsx` | Root component; owns all state; two-tab UI (Strategy / Télémétrie); wires telemetry→strategy autofill |
| `src/components/InputPanel.jsx` | Full sidebar form: car presets, race settings, pit timings, fuel, tire compounds, mid-race mode, drivers, live telemetry |
| `src/components/ResultsSummary.jsx` | KPI cards + driver summary chips + strategy comparison grid (top-6, expandable) |
| `src/components/StrategyTimeline.jsx` | Recharts horizontal bar chart with pit markers, pit-window shading, compound colors |
| `src/components/StintTable.jsx` | Stint detail table; highlights warning rows in red |
| `src/components/LiveDashboard.jsx` | Single-team telemetry widget: gear/speed, RPM/throttle/brake bars, fuel bar, tire temp+wear per corner, compound picker, SVG track map (GPS recorded at 60Hz RAF) with pit lane detection and multi-car dots |
| `src/components/TelemetryControls.jsx` | Collapsible panel: server URL + connect/disconnect, PS5 IP list management, network scan button and results |
| `src/components/TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap times, compound picker, fuel bar, pit/track status |
| `src/components/DriversTab.jsx` | Pilotes tab: per-driver total drive time vs. `minDriverTimeSecs`, and a per-stint log (driver, tyre, laps, duration, avg/best/worst lap) for the selected team, including the in-progress stint |
| `src/index.css` | Global dark racing theme (gold accent `#FFD700`; CSS vars for all colors) |
| `server/telemetry-server.js` | Node.js UDP relay: receives Salsa20-encrypted GT7 packets on port 33740, relays to browser via WebSocket on port 20777; supports LAN scan for PS5s and DNS hostname resolution |
| `tests/test.js` | Smoke test (1h race) |
| `tests/test_comprehensive.js` | Full test suite (~129 tests) |

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
- `pitDetected` — set for one packet when the car enters the pit lane (App clears the compound selection)
- `pitExit` — set for one packet when the car exits the pit (triggers `useCompoundDetector` to request compound confirmation from user)
- GT7 UDP does not expose compound ID; it must be set manually via the compound picker buttons after each stop

## Default inputs (App.jsx)

- Race: 8 hours, 1 mandatory stop
- Fuel: 100L tank, 28 laps/tank, fuel map 1.0×, weight penalty 0.03 s/L
- Pit: 25s base, 27s tire change, 4.0 L/s fuel rate
- Tire compounds: H, M, S, IM, W (all active by default)
- Drivers: 1 driver, 2h minimum drive time

## MVP scope & working rules

These are the locked guardrails for the current build. They override convenience.
The full rationale lives in `docs/DECISIONS.md` (source of truth); the live module
map is `docs/CURRENT_STATE.md`; the task checklist is `docs/BACKLOG.md`.

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
- **`src/logic/` stays pure JS** with zero React dependency, runnable under plain
  `node`. The engine is portable and node-testable by design.
- **One feature per git branch.** Each phase / feature gets its own branch.
- **English is primary; wire i18n as a strings file** so French + Dutch are added
  later without a rewrite (the app currently has hardcoded French strings).
- **Product name is a placeholder.** `Race-Strategies` is the repo name only — do
  not hardcode a brand string anywhere it's hard to swap later.
