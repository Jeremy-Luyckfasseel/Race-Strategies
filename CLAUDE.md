# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GT7 (Gran Turismo 7) Endurance Race Strategy Calculator — a React + Vite web app that enumerates all valid pit/tire compound combinations and finds optimal race strategies. Accounts for fuel weight degradation, tire wear curves (per-compound, piecewise), variable pit stop times, multi-driver minimum time requirements, and live PS5 telemetry for mid-race recalculation.

**Tech stack:** React 19, Vite 7, WebSocket (`ws` 8.18), Node.js UDP relay. No charting library — the one chart is hand-drawn (see `StrategyTimeline.jsx`).

## Commands

Scripts are in `package.json`. Two that aren't obvious:

- `npm test` runs all 49 suites (~3 226 assertions). **Judge by EXIT CODE, not output.**
- `npm run telemetry` is the UDP→WebSocket relay — a separate process from the Vite app.

Test scripts in `tests/` are plain Node.js — no test runner. They import `findBestStrategies` directly from `src/logic/strategy.js` and log JSON output.

## Architecture

### Strict separation between logic and UI

The strategy engine (`src/logic/strategy.js`) is pure JavaScript with zero React dependency. This is intentional — it can be tested with `node` directly and keeps the algorithm portable.

The React integration layer is `src/hooks/useStrategy.js`, which wraps `findBestStrategies()` with a 600ms debounce and exposes results to components.

`TelemetryControls` (relay URL, PS5 list, LAN scan) hangs off the **header** as a
dropdown rather than living in a tab: it is setup, needed about twice a weekend,
and in the flow it cost a row of the one screen that has to show everything.

State lives only in `App.jsx` — no Redux, no Context.

The strategy algorithm, fuel-weight model and multi-driver assignment are
documented in `src/logic/CLAUDE.md`.

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

Rivals I **follow** (◉ beside the star in the leaderboard, `gt7-followed`,
kept across "New race" like the typed plan) are the only ones whose stops raise
a toast and a flickering tyre button; the rest dim. With none followed, every
car does, as before (`isFollowed`, `teams.js`).

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

The module map, and what each of the 49 test suites guards, is `docs/CURRENT_STATE.md`.
Per-module rationale lives in `src/logic/CLAUDE.md` and `src/hooks/CLAUDE.md`. One
cross-cutting entry not covered there:

- `src/components/ManualPlan.jsx` + `runManualPlan` (strategy.js) — **A strategy typed in by hand**, on the Strategy tab. Rows of tyre / stints (or "until the flag" on the last row) / laps per stint, so ten medium stints are one row. `findBestStrategies({ ...inputs, manualPlan })` expands the rows into the engine's own compound plan (hold-last) and runs it through the same `evaluate` as the engine's plans — same simulation, same two driver assignments; drivers are deliberately not part of the typed plan. Typed laps reach `simulateStrategy` as `forcedStintLaps`, still capped by fuel and tyre life (a cut stint is reported), and the stop before a typed stint fuels for THAT stint and changes a set that could not last it. Each row reports what the engine would run on it (the "engine: N" chip that fills the field), rows the race never reaches, and `beyondPlan` when the rows run out before the flag. Mid-race it skips the stints in my stint log. "Race this plan" makes it `planBase`, which the race screen and the freeze follow instead of `best`; persisted as `gt7-manual-plan` — deliberately NOT a RACE_KEY, because it is typed in the lobby and "New race" is how the lobby is cleared before the real one; it is in SNAPSHOT_KEYS so a save carries it.
- `LiveDashboard.jsx` shows **tyre temperature per corner**; the radius-derived "wear %" was removed — it never moved on real hardware (see `npm run diag:tyres`).

## Telemetry server

Ports and the browser↔relay protocol are in `server/telemetry-server.js`. The gotchas:

- Pit edges come from `detectPitEdges` (`src/logic/pitDetect.js` — the one module the relay shares with the app, so it stays node-testable). GT7 exposes no pit flag, so it is inferred from speed, and a stop must be **sustained** (`PIT_MIN_STOP_MS`) before it counts. Without that dwell a spin fired a full phantom pit stop: compound cleared, stint closed, driver prompt raised. It remains speed-only — a car parked on track for longer than the dwell still reads as a stop.
- **Car identity is the hostname when one is known.** `stableCarId` (`src/logic/teams.js`, also imported by the relay) picks what a car is reported as — the value everything downstream keys on: colour, stint log, whether it is the starred team. The LAN scan registers bare IPs, so without this a DHCP lease change makes a console look like a brand-new car mid-race. The relay remembers hostnames found by reverse DNS during a scan and reports those instead. It deliberately does **not** change what gets heartbeated: heartbeats keep going to the IP, which always works, because a hostname that fails to forward-resolve would mean no telemetry at all. Address to reach the console, hostname to name it.
- GT7 UDP does not expose compound ID; it must be set manually via the compound picker buttons after each stop.

## Default inputs

Defaults live in `App.jsx`. The one worth knowing: **0 mandatory stops** — endurance racing has no stop count in the rules; fuel and tyres decide when the car comes in. The input remains for series that do impose one.

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
