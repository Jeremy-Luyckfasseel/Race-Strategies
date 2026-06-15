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

Two tabs today: **Stratégie** (the calculator) and **Télémétrie** (live dashboard
+ multi-team leaderboard + track map). UI strings are in French.

**Today the telemetry and the strategy engine are only loosely connected.** The
only auto-fill path: when mid-race mode is on AND a team is selected, the app
copies the live `currentLap` and `fuelLiters` into the mid-race inputs (see
`App.jsx` effect at lines ~215-229). Everything else — lap times per compound,
fuel burn, tire life, fuel-weight penalty — is **typed by hand**. Closing that
gap is the whole point of Phase 1.

---

## 2. Module map

### Pure logic — `src/logic/` (zero React, node-testable)

| File | Role |
|------|------|
| `strategy.js` | The engine (~630 lines). Exports `findBestStrategies`, `simulateStrategy` (internal), `calcPitStopTime`, `parseLapTime`, `formatLapTime`, `formatRaceTime`, `TIRE_COMPOUNDS`, `CAR_PRESETS`. |
| `compoundDetector.js` | Doc-only stub. States that GT7 UDP does **not** expose tire compound; compound must be set by the user. No runnable code. |

### React hooks — `src/hooks/`

| File | Role |
|------|------|
| `useStrategy.js` | Wraps `findBestStrategies`. 600 ms debounce on input change + immediate `calculate()`. Validates/coerces inputs in `compute()`. Returns `{ result: {ranked, best} \| null, calculating, calculate }`. |
| `useTelemetry.js` | WebSocket client to the relay. Returns `{ connected, teams: Map<ip,packet>, serverIPs, connect, disconnect, sendIPs, scan, scanning, scanResults }`. Each team packet is stamped with `ts: Date.now()`. **No auto-reconnect** — `onclose` just sets `connected=false`. |
| `useCompoundDetector.js` | Watches each team packet's `pitExit` flag. Adds the IP to a `pendingIps` Set so the UI can prompt for a one-tap compound confirmation. `confirmCompound(ip)` / `stopDetecting(ip)` clear it. Dedupes by `${ip}-${currentLap}`. |
| `useTrackMap.js` | App-level `requestAnimationFrame` loop that records GPS (`posX`/`posZ`) into segments + an occupancy grid, persisted to `localStorage` (`gt7_track_map_v1`). Detects the pit lane from a sustained slow zone and fires `onPitEntry`. Returns `{ mapRef, resetMap }`. |

### Components — `src/components/`

| File | Role |
|------|------|
| `InputPanel.jsx` | The whole sidebar form. Collapsible sections: car presets (localStorage), race, pit timing, fuel, fuel-weight penalty, compound table (per-compound life + 3 lap times + mandatory flag), mid-race mode, drivers (per-driver per-compound lap-time overrides). Also renders the mid-race "auto-fill from PS5" team picker. |
| `ResultsSummary.jsx` | KPI strip + driver summary chips + top-6 strategy comparison cards. |
| `StrategyTimeline.jsx` | Recharts horizontal bar chart of stints + pit windows. |
| `StintTable.jsx` | Lap-by-lap stint detail; red rows for warnings. |
| `LiveDashboard.jsx` | Single-team widget: gear/speed, RPM/throttle/brake/fuel bars, per-corner tire temp + wear, compound picker, and the SVG `TrackMap` (exported named). |
| `TelemetryControls.jsx` | Server URL + connect/disconnect, PS5 IP list editor, LAN scan button + results, team label editor. |
| `TelemetryLeaderboard.jsx` | Multi-team table sorted by race position: lap/gap, last/best lap, compound picker, fuel bar, pit/track status. |

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
| `test.js` | `npm run test:smoke` — quick 1-hour race sanity check. |
| `test_comprehensive.js` | Helpers + broad `findBestStrategies` coverage (part of the ~1586 assertions `npm test` runs). |
| `test_invariants.js` | Structural invariants, ranking dominance, multi-compound coverage, multi-driver minimums, race-time boundary, known-answer hand-computed scenarios, bulk no-overfill / no-overrun checks. |

`npm test` runs `test_comprehensive.js` then `test_invariants.js`. Both are pure
node imports of `src/logic/strategy.js`; they print `✓/✗` lines and exit non-zero
on failure. **These are the guardrail — keep every assertion green.**

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
- Pit time = `base + (tiresChanged ? tireChange : 0) + fuelToAdd / fuelRate`.
- Multi-driver: greedy — the driver owing the most toward their minimum takes the
  next stint; tie-break least accumulated time.

---

## 5. Half-finished / dead / loose ends

- **`compoundDetector.js`** is a comment-only file (the real logic lives in the
  `useCompoundDetector` hook). Intentional, but easy to mistake for dead code.
- **No telemetry→engine learning path.** The differentiator the build plan
  describes (auto-derive fuel burn / fuel-weight / degradation) **does not exist
  yet**. Only `currentLap` + `fuelLiters` auto-fill in mid-race mode.
- **No auto-reconnect / auto-connect.** The browser must be told the server URL
  and IPs; a dropped socket stays dropped until manual reconnect.
- **`tireWear` is radius-derived and unproven.** Whether it is stable/monotonic
  enough to drive a degradation model is unverified (a Phase 1 open question).
- **Salsa20 key is version-sensitive.** A GT7 update can change it and silently
  break decoding.
- **No packaging.** Running the app needs clone + `npm` + a separate relay
  process + firewall allowance. No double-click distributable (Phase 3).
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
npm test             # test_comprehensive.js + test_invariants.js
npm run test:smoke   # quick 1h race test
npm run telemetry    # start the UDP→WS relay (separate process)
```
