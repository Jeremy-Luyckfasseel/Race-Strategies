# BACKLOG.md

> A living, task-sized checklist derived from `docs/CURRENT_STATE.md`, the phase
> plans in `docs/plans/`, and the locked MVP scope in `docs/DECISIONS.md`. One
> bullet per task, each with a one-line acceptance criterion. Grouped by phase.
>
> **Status key:** `[ ]` = todo · `[~]` = partial · `[done]` = already implemented,
> **do not rebuild** (verify, don't redo).
>
> Source of truth for *why* each task exists is `docs/DECISIONS.md`; the *how* is
> the matching `docs/plans/phase-N.md`. This file is the checklist, not the spec.

---

## Already built — DO NOT REBUILD

These exist in the current code. Verify before extending; never re-implement.

- [done] **Strategy engine** — `findBestStrategies` enumerates/ranks all valid
  pit+compound strategies (`src/logic/strategy.js`). _Accept: `npm test` green
  (~1586 assertions)._
- [done] **`useStrategy` hook** — 600 ms-debounced wrapper + manual `calculate()`.
- [done] **Telemetry relay** — UDP 33740 receive + Salsa20 decode + WS 20777 relay
  + LAN scan + heartbeat (`server/telemetry-server.js`).
- [done] **`useTelemetry` hook** — WS client, `teams: Map<ip,packet>`, `scan`.
  _Note: no auto-reconnect yet (Phase 3.1)._
- [done] **Mid-race `currentLap` + `fuelLiters` auto-fill** — live state copied into
  mid-race inputs when mid-race mode on + team selected (`App.jsx` ~220-225).
  _This is live **state**, not learned model params — don't double-write in Phase 1._
- [done] **One-tap compound confirm flow** — `useCompoundDetector` watches `pitExit`
  and prompts the user (GT7 doesn't expose compound). _Keep as-is; MVP scope._
- [done] **Pit detection** — speed-based `pitDetected`/`pitExit` (server) + geometric
  pit-zone (`useTrackMap`).
- [done] **Track-map recording** — `useTrackMap` 60 Hz RAF GPS → segments + grid,
  persisted to localStorage.
- [done] **Multi-team scaffolding** — leaderboard, `Map<ip,packet>`, LAN scan.
  _Keep but **de-emphasize** (Phase 2.2); do not delete._
- [done] **Live dashboard** — single-team gear/speed/RPM/fuel/tire widget +
  SVG track map (`LiveDashboard.jsx`).

---

## Phase 0 — Guardrails (this phase)

- [done] **0.1 Update `CLAUDE.md`** — MVP scope + out-of-scope + working rules
  (test discipline, pure `src/logic/`, one-branch-per-feature, i18n, placeholder
  name). _Accept: all five rules present; `npm test` green._
- [done] **0.2 Verify/refresh `CURRENT_STATE.md`** — diffed against real code; fixed
  stale assertion count. _Accept: doc traces to real files/lines._
- [done] **0.3 Create `docs/BACKLOG.md`** — this file. _Accept: every Phase 1–4 task
  appears; done items flagged._
- [ ] **0.4 Concierge / Wizard-of-Oz trust test** — be the algorithm in a team's
  live-race Discord; record assist-vs-automate takeaway in `docs/VALIDATION.md`.
  _Zero code. Do BEFORE Phase 1. Accept: written takeaway recorded._
- [ ] **0.5 SmartScreen audit** — observe how users handle the unsigned-app warning
  (SimHub/CrewChief/Hector or a throwaway build). _Accept: recorded read on whether
  it blocks adoption, in `docs/VALIDATION.md`. Run early, alongside Phase 1._

---

## Phase 1 — Auto-derive strategy inputs from telemetry (headline feature)

- [ ] **1.1 Telemetry learner module** — new pure `src/logic/telemetryLearner.js`
  (zero React, node-testable): `createLearner()` with `.ingest(frame)` /
  `.getEstimates()`. Emits `litersPerLap`, `lapsPerFullTank`,
  `fuelWeightPenaltyPerLiter`, per-compound 3-point curve + `tireLife`, each with a
  trust payload (`sampleCount`, `volatility`, `confident`). _Accept: zero-noise
  synthetic recovers truth within tight band (±0.05 L/lap, ±0.003 s/L, ±0.15 s/lap);
  noisy within live-trust band._
- [ ] **1.1a Fuel/lap from tank-delta** — measure `litersPerLap` directly from tank
  deltas (traffic-proof, no clean laps). _Accept: usable after ~3 laps; accurate in
  a chaotic stint._
- [ ] **1.1b Fuel-weight scalar** — linear regression of clean-lap time vs fuel load,
  single scalar s/L per track, seed 0.03, sanity-range ~0.02–0.05, no taper.
  _Accept: recovered within band on synthetic data._
- [ ] **1.1c Tire-deg curve** — fit lap-time-vs-lap-in-stint (after subtracting
  fuel-weight), sample at 0 / `tireLife`÷2 / `tireLife` → start/half/end; index by
  lap-count-since-stint; conservative safety margin near `tireLife`; cliff = known
  limitation. _Accept: 3 points recovered within band; engine consumes them
  unchanged._
- [ ] **1.1d Clean-lap filter** — drop out/in/first-flying/paused/off-track/penalty
  laps + outliers (>~3% over stint clean median, implausibly fast); accept
  non-consecutive clean laps. _Accept: filter applied only to the two refinements,
  not fuel/lap._
- [ ] **1.1e Practice/quali seeding** — ingest an earlier stint so the learner is
  never cold. _Accept: fuel/lap + weight slope + deg curve seeded before race lap 1._
- [ ] **1.1f Tolerance config object** — single object, **synthetic-test thresholds
  vs live-trust thresholds separated + commented** in named constants. _Accept:
  loosening live behaviour can't weaken test thresholds._
- [ ] **1.1g Fuel-map handling** — don't force `fuelMap=1.0`; learn `litersPerLap`
  at running map; `fuelMap` stays a what-if lever; map is user-declared (packet
  doesn't expose it — confirmed). _Accept: re-learns on user map change._
- [ ] **1.1 test** — `tests/test_telemetry_learner.js` synthetic ground-truth,
  no-noise + noisy cases, thresholds in named constants. _Accept: passes; existing
  suite still green._
- [ ] **1.2 Per-stint / per-compound segmentation** — split stream by `pitExit`,
  reset tire age at boundary, accumulate a separate deg model per compound; compound
  comes from the existing one-tap confirm (never guessed); fuel-weight stays one
  global estimate. _Accept: two compounds → two distinct curves; same compound across
  stints refines, not resets._
- [ ] **1.3 Propose-and-accept wiring** — optional `useTelemetryLearner.js` runs the
  learner on the selected car; learner output held in a **separate `learned` object**,
  never auto-written to `inputs`; confident + materially-different values surface a
  recommendation card ("measured X vs your Y — Accept/Ignore") with a trust display;
  Accept copies into `inputs` + recalcs; Ignore won't re-nag until value shifts.
  _Accept: nothing changes the active strategy until the human accepts; propose/accept
  decision logic lives in a node-tested pure helper._

---

## Phase 2 — Single-team in-race loop ("Now" view)

- [ ] **2.1 "Now" view** — `src/components/NowView.jsx` + pure `src/logic/raceState.js`
  helpers: current optimal plan headline, next action (target pit lap + fuel to add +
  tires y/n), stint countdown (`endLap − currentLap`), lift-and-coast/push prompt.
  _Accept: shows correct next pit lap, fuel, laps-left, and L&C verdict; updates live._
- [ ] **2.1a Margin = laps of fuel** — tight <~1 lap → "lift and coast"; surplus
  >~2 laps → "you can push"; calm wording; tunable named constants. _Accept: correct
  verdict from synthetic race state in a node test._
- [ ] **2.1b Live plan source** — active strategy from accepted/manual inputs only;
  recalc on edit or on **accept**; "freeze plan" toggle. _Accept: plan never shifts
  silently from raw learner output; freeze holds it steady._
- [ ] **2.1c Pit-now trigger** — earliest-of (planned pit lap, fuel-exhaustion lap,
  tyre-wear threshold) with reason shown ("box: fuel/tyres/plan"). _Accept: correct
  earliest reason from a node test._
- [ ] **2.1d Full-screen race layout** — dedicated glanceable second-screen view,
  large type, few elements. _Accept: readable at a glance, separate from config tabs._
- [ ] **2.2 Single-team as default** — default `activeTab`/landing = single-team
  "Now" + dashboard; multi-team leaderboard moved behind a collapsed "Advanced / LAN
  event" section (not deleted). _Accept: fresh load lands single-team; no telemetry
  plumbing removed._
- [skip] **2.3 Audio callouts** — **CONFIRMED OUT of MVP** (DECISIONS 2.4). Do not
  build. Future-only: default muted, opt-in, events = box-this-lap + fuel-target.

---

## Phase 3 — Packaging & onboarding

- [ ] **3.0 Distribution form** — CONFIRMED Electron; record at top of
  `docs/PACKAGING.md`. _Accept: choice documented._
- [ ] **3.1 Auto-connect / auto-reconnect** — on mount connect to relay + scan;
  auto-pick PS5 only when exactly one found, else prompt; "session active" =
  `onTrack` AND speed >~5 km/h; reconnect with exponential backoff 1→2→4…cap ~15 s
  all session unless user disconnected. Extract pure helpers (backoff, active-session
  check) for node tests. _Accept: fresh launch shows live data with no IP typed;
  relay restart reconnects; explicit disconnect stays disconnected._
- [ ] **3.2 Package as Electron app** — main process spawns `telemetry-server.js`
  child + loads built `dist/`; electron-builder Windows installer; ship **unsigned**
  for MVP (SmartScreen click-through guide); note Salsa20 key location;
  `docs/PACKAGING.md` reproduces the build. _Accept: Windows installer launches on a
  clean machine, starts relay itself, shows UI — no terminal/npm; dev workflow
  (`npm run dev` + `npm run telemetry`) still works._
- [ ] **3.3 First-run onboarding** — `src/components/Onboarding.jsx`: firewall
  explainer line → auto-scan → show detected PS5 → optional car/track tag → drop into
  "Now" view; localStorage "done" flag. _Accept: first-time user goes nothing → live
  strategy in a few clicks, no telemetry numbers typed._

---

## Phase 4 — Validation-ready slice (build last, then STOP)

- [ ] **4.1 One-page landing site** — standalone `landing/index.html` (decoupled from
  the app), English + i18n-ready, states the "learns your car live" hook + CTA,
  Windows-app download button (no web capture app), email capture, single fake-door
  offer button. _Accept: page renders with hook + CTA + €9.99/season offer + download._
- [ ] **4.1a Fake-door offer** — single + simple: "Single-team live race strategy that
  learns your car automatically — €9.99/season, up to 5 drivers." No tiers/seats.
  _Accept: one offer, no payment code anywhere._
- [ ] **4.1b Email capture → Tally → Google Sheet** — wire the field to a Tally form.
  _Accept: a test submit lands in the Sheet._
- [ ] **4.1c Analytics** — Cloudflare Web Analytics; email-submit and fake-door click
  fire distinct attributable events (not `console.log`). _Accept: click registers in
  analytics._
- [ ] **4.1d Privacy + hosting** — one consent line ("we'll only email you about this
  tool"); deploy on Cloudflare Pages. _Accept: consent line present; page hosted._
- [ ] **4.2 `docs/VALIDATION.md` checklist** — the three validation questions (teams
  want the "Now" view? fake-door clicks? mock-race accuracy?) + pass bar (pit lap
  within ±1 lap, fuel error <~1 lap by stint end, no dry-running). _Accept: checklist
  written; deliberate stop after Phase 4._

---

## Cross-cutting

- [ ] **i18n scaffold** — wire a lightweight i18n strings layer (English primary) so
  French + Dutch become strings files, not a rewrite. The app currently has hardcoded
  French strings; migrate them as the scaffold lands. _Schedule alongside Phase 2 UI
  work. Accept: all user-facing strings flow through the i18n layer; English default._
- [ ] **Product name** — `Race-Strategies` is a placeholder. Keep the brand in one
  swappable constant; final name chosen right before the landing page goes live
  (shortlist: Undercut / Boxbox / Stint(wise) / Pitwall / Pitboard; check
  domain+trademark, avoid F1 terms). _Pre-launch, not a build blocker._
- [ ] **Code-signing cert** — buy + sign before any paid public launch (unsigned fine
  through league validation). _Pre-launch, not a build blocker._

---

## Phase 5 — OUT OF SCOPE (stub — do not build)

Recorded only so it isn't pulled forward. Consider **only if** Phase 4 validates.

- [oos] Distributed multi-car telemetry aggregation.
- [oos] Cloud server for at-home / online leagues.
- [oos] Whole-field organizer / race-control board.
- [oos] F1-game support (the pure `src/logic/` engine is designed to port).
