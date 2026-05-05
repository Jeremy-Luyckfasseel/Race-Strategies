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

- `findBestStrategies(inputs)` — entry point; generates all cyclic compound sequences (up to 5-element patterns, ~4000 for 5 compounds), simulates each, filters by mandatory stops/compounds, deduplicates, and sorts by (total laps DESC, race time ASC).
- `simulateStrategy(params)` — lap-by-lap simulation: tracks fuel consumption, fuel-weight speed correction per lap, piecewise tire wear curve (0–50% soft degradation, 50–100% harder degradation), and greedy multi-driver assignment.
- Pit stop time = `basePitSecs + (tiresChanged ? tireChangeSecs : 0) + fuelToAdd / fuelRateLitersPerSec`
- Mandatory minimum pit stops are enforced during stint planning by capping stint length.

### Fuel weight correction model

User observes lap times at full tank. The engine corrects t(start), t(mid), t(end) to their full-tank equivalents by adding back the fuel-weight penalty that was already burned. During simulation, the correction is reapplied each lap based on actual live fuel level (car speeds up as fuel burns).

### Multi-driver logic

Greedy assignment: each stint, the driver who owes the most time toward their minimum gets assigned. Tie-break: least accumulated total time. Per-driver compound lap times override global times when set.

### ESLint config note

The `no-unused-vars` rule ignores variables whose names start with an uppercase letter or underscore (pattern: `^[A-Z_]`). This is intentional to allow unused React import-style names.

## Key files

| File | Purpose |
|------|---------|
| `src/logic/strategy.js` | Pure-JS strategy engine (~620 lines); exports `findBestStrategies`, `TIRE_COMPOUNDS`, `CAR_PRESETS`, `formatLapTime`, `formatRaceTime`, `parseLapTime` |
| `src/logic/compoundDetector.js` | Placeholder/note: GT7 UDP does not expose compound ID; compound tracking is user-driven only |
| `src/hooks/useStrategy.js` | React hook wrapping the engine; 600ms debounce + manual `calculate()` |
| `src/hooks/useTelemetry.js` | WebSocket hook; exposes `connect`, `disconnect`, `sendIPs`, `scan`; returns `teams` Map<ip, packet>, `scanning`, `scanResults` |
| `src/hooks/useCompoundDetector.js` | Watches `data.pitExit` per team; returns `pendingIps` Set + `confirmCompound(ip)` / `stopDetecting(ip)` |
| `src/App.jsx` | Root component; owns all state; two-tab UI (Strategy / Télémétrie); wires telemetry→strategy autofill |
| `src/components/InputPanel.jsx` | Full sidebar form: car presets, race settings, pit timings, fuel, tire compounds, mid-race mode, drivers, live telemetry |
| `src/components/ResultsSummary.jsx` | KPI cards + driver summary chips + strategy comparison grid (top-6, expandable) |
| `src/components/StrategyTimeline.jsx` | Recharts horizontal bar chart with pit markers, pit-window shading, compound colors |
| `src/components/StintTable.jsx` | Stint detail table; highlights warning rows in red |
| `src/components/LiveDashboard.jsx` | Single-team telemetry widget: gear/speed, RPM/throttle/brake bars, fuel bar, tire temp+wear per corner, compound picker, SVG track map (GPS recorded at 60Hz RAF) with pit lane detection and multi-car dots |
| `src/components/TelemetryControls.jsx` | Collapsible panel: server URL + connect/disconnect, PS5 IP list management, network scan button and results |
| `src/components/TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap times, compound picker, fuel bar, pit/track status |
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
