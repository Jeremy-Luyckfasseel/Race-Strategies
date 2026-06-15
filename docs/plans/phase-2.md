# Phase 2 — The single-team in-race loop

> **Standalone context.** One of five phase plans derived from
> `Race-Strategies-Claude-Code-Build-Plan.md`. You may have no memory of writing
> it. **Before coding, read `CLAUDE.md`, `docs/DECISIONS.md` (locked answers), and
> `docs/CURRENT_STATE.md`.** The product is a GT7 endurance strategy calculator
> with live PS5 telemetry. Locked MVP = single-team / single-car / local.
> Distributed multi-car, cloud, whole-field board, and F1 are out of scope
> (Phase 5 stub).
>
> Goal of this phase: make the tool **useful live** — one glanceable screen that
> tells the driver/engineer exactly what to do right now.
>
> **All decisions for this phase are resolved in `docs/DECISIONS.md` and folded in
> below** — including audio callouts (Task 2.3), now **confirmed OUT of the MVP**,
> and the live-plan source, now aligned with Phase 1's **propose-and-accept** (the
> learner proposes; the human accepts; nothing silently overrides). If
> `docs/DECISIONS.md` and this file disagree, `DECISIONS.md` wins.

> **Audience (from the 0.4 concierge test — see `docs/DECISIONS.md` "Who the live
> view is for"): the live view's user is the RACE ENGINEER / STRATEGIST, not the
> driver.** A human is always already talking to the driver. The app surfaces
> updates + recommendations to that engineer, who decides and relays. The app
> **never talks to the driver directly** and never tries to be that voice (this is
> *why* audio is out — wrong audience, not just "polish later").

## Objective (what's true when this phase is done)

1. A primary in-race **"Now" view** — **built for the race engineer to read at a
   glance and relay** — surfaces only the in-the-moment essentials: the current
   optimal plan, the next action (pit lap target + fuel to add), a stint countdown,
   and a lift-and-coast / push prompt when fuel is tight or in surplus. Readable at
   a glance on a second screen.
2. The single-team experience is the **default landing view**. The multi-team
   leaderboard still exists but is moved behind an "Advanced / LAN event" section.
3. Audio callouts are **OUT of the MVP** (confirmed — the engineer is the voice to
   the driver, so an auto-voice is the wrong audience, not just deferred polish).
4. All existing tests stay green; any new pure helpers are node-tested.

## Prerequisites

- Phase 0 (guardrails) done.
- Phase 1 (telemetry learner) done — the "Now" view relies on the live optimal
  plan and learned fuel/deg estimates. If Phase 1 is incomplete, the "Now" view
  can still run off manual inputs + mid-race auto-fill, but the lift-and-coast and
  fuel-target prompts are far weaker. Confirm with the owner before starting Phase
  2 ahead of Phase 1.

## In scope / Out of scope

**In scope:**
- New component(s) for the "Now" view (e.g. `src/components/NowView.jsx`).
- Small pure helpers in `src/logic/` for derived live numbers (e.g. "laps left in
  stint", "fuel delta vs plan", "lift-and-coast needed?") — node-testable.
- Re-arranging tabs/landing in `src/App.jsx` so single-team is default and the
  leaderboard is demoted (not deleted).
- Optional `SpeechSynthesis` callouts + mute toggle.

**Out of scope — do NOT touch / build:**
- Deleting or rewriting the multi-team leaderboard, scan, or `Map<ip,packet>`
  plumbing — only de-emphasize it.
- The learner maths itself (Phase 1).
- Packaging / auto-connect / onboarding (Phase 3).
- Any multi-car "whole field" view (Phase 5).

## Tasks

### Task 2.1 — "Now" view

- **What to build:** A primary live view showing, for the selected car:
  - **Current optimal plan** headline (from `findBestStrategies` best result):
    the current stint's compound and the planned sequence.
  - **Next action:** target pit lap (`pitWindowLatestLap` / planned `pitLap`) and
    **fuel to add** at that stop (`fuelToAddLiters`), plus tires-yes/no.
  - **Stint countdown:** laps remaining in the current stint =
    planned `endLap − live currentLap`; show as a prominent number.
  - **Lift-and-coast / push prompt (DECISION 1):** margin unit = **laps of fuel**.
    Tight = projected to finish the stint with **under ~1 lap** of fuel margin →
    "lift and coast". Surplus = **over ~2 laps** → "you can push". Calm, factual
    wording — not naggy. Thresholds tunable (named constants).
- **Files created/changed:** `src/components/NowView.jsx` (new);
  `src/logic/raceState.js` (new, pure helpers) or similar; `src/App.jsx` (mount
  it); `src/index.css` (styles).
- **Approach / modelling choices:**
  - **Live plan source (DECISION 2, propose-and-accept):** the active strategy is
    computed from the **accepted / manual inputs**, NOT silently from raw learner
    output. It recalculates when the user edits a field or **accepts** a learner
    recommendation (Phase 1's propose-and-accept); learner proposals surface
    alongside but don't auto-apply. Keep a **"freeze plan" toggle** so nothing
    shifts mid-corner.
  - **Pit-now trigger (DECISION 3):** show the **earliest-of** (planned pit lap,
    fuel-exhaustion lap, tyre-wear threshold) and surface the **reason**:
    "box: fuel" / "box: tyres" / "box: plan".
  - Drive the view from: the live packet (`currentLap`, `fuelLiters`,
    `tireWear`, `lastLapMs`), the selected best strategy, and (Phase 1) the
    learner's live estimates.
  - Keep the *decision logic* (when to warn, how many laps of fuel margin counts
    as "tight", which pit reason wins) in a **pure helper** so it can be
    node-tested; the component just renders.
  - **Layout (DECISION 5):** a **dedicated full-screen race view**, separate from
    the configuration tabs — must be glanceable on a second screen. Large type,
    few elements, high contrast. (See the memory note on the "Carbon Wall
    Terminal" redesign aesthetic if it still applies.)
  - **i18n:** English is primary; wire callout/label strings through the
    lightweight i18n layer so French/Dutch are added as strings later, not a
    rewrite (DECISIONS — Internationalization).
- **Tests:** Node tests for the pure helpers: feed a synthetic race state and
  assert the right next-action / countdown / lift-and-coast verdict. No DOM test
  needed.
- **Acceptance:** Given a live (or simulated) packet + a computed strategy, the
  view shows the correct next pit lap, fuel to add, laps left in stint, and a
  correct lift-and-coast/push verdict; updates as packets arrive.

### Task 2.2 — Make single-team the default

- **What to build:** Make the single-team view the default landing experience;
  move the multi-team leaderboard behind an "Advanced / LAN event" section.
- **Files changed:** `src/App.jsx` (tab/landing logic, `activeTab` default);
  possibly `TelemetryLeaderboard.jsx` placement; `src/index.css`.
- **Approach:** Change the default `activeTab` / view so a fresh load shows the
  single-car "Now" + dashboard. Keep `TelemetryLeaderboard` mounted only inside an
  Advanced section (collapsed by default). Do **not** remove the multi-team code
  or the `teams` Map.
- **Tests:** none required (UI arrangement). Run `npm test` + `npm run lint`.
- **Acceptance:** Fresh load lands on the single-team view; the leaderboard is
  reachable but de-emphasized; no telemetry plumbing removed.

### Task 2.3 (CONFIRMED OUT of MVP) — Audio callouts

> Per `docs/DECISIONS.md` 2.4, audio is **confirmed out of the MVP** — and the 0.4
> test gives the deeper reason: **the engineer is the human voice to the driver, so
> an auto-voice is the wrong audience, not just deferred polish.** The visual "Now"
> view + propose-and-accept *is* the product; audio also drags in TTS, mute states,
> and language handling not needed yet. **Do not build this for the MVP.** If ever
> revisited: default **muted**, opt-in; events = box-this-lap + fuel-target;
> language follows the i18n layer. The plan below is kept only as a future reference.

- **What to build (only if confirmed in):** Optional spoken callouts via the
  browser `SpeechSynthesis` API for key events ("box this lap", "fuel target
  reached"), with a mute toggle (default muted).
- **Files changed:** small hook `src/hooks/useSpeech.js` (or inline);
  `NowView.jsx`; a mute control.
- **Approach:** Fire a callout when a tracked event transitions (e.g. enter the
  pit window, reach the fuel target). Debounce so it speaks once per event, not
  per frame. Default muted or remembered in localStorage (decision below).
- **Tests:** keep event-detection logic in a pure helper and node-test the
  transition detection; the speech call itself is browser-only.
- **Acceptance:** Toggling mute works; a callout fires exactly once per event;
  nothing speaks on every frame.

### Phase-2 acceptance (from the build plan)

During a session you can glance at one screen and know exactly when to pit and how
much fuel to add, updated live.

## Resolved decisions (from `docs/DECISIONS.md`) — folded into the tasks above

1. **Margin unit = laps of fuel.** Tight = <~1 lap margin → "lift and coast";
   surplus = >~2 laps → "you can push". Calm, factual; thresholds tunable.
2. **Live plan source:** active strategy = accepted/manual inputs; recalc on edit
   or on **accepting** a learner proposal (propose-and-accept); "freeze plan"
   toggle. (Revised from "auto-recalc from learner inputs" to match Phase 1.)
3. **Pit-now trigger:** earliest-of (planned pit lap, fuel-exhaustion lap,
   tyre-wear threshold), with the reason shown ("box: fuel/tyres/plan").
4. **Audio callouts: CONFIRMED OUT of MVP.** Do not build Task 2.3.
5. **Layout:** dedicated full-screen race view, separate from the config tabs.

### Still open — do NOT guess

- *(none — all Phase 2 decisions are now resolved in `docs/DECISIONS.md`.)*

## Risks / things likely to go wrong

- **Recompute churn.** Re-running `findBestStrategies` on every packet is wasteful
  and could flicker the recommendation. Throttle to per-lap or per-significant-
  change, and avoid showing a recommendation that flips every second.
- **Noisy live data.** `fuelLiters` and `tireWear` jitter; the lift-and-coast
  verdict must use smoothed values or it will flap. Keep smoothing in the pure
  helper.
- **Demoting, not deleting.** Easy to accidentally rip out multi-team plumbing
  while making single-team default — keep it intact behind the Advanced section.
- **Glanceability vs. detail.** Temptation to cram numbers in. The view's value is
  that it shows almost nothing. Resist.
- **Pure/UI split.** Keep all "what to do now" logic in node-testable helpers so
  the test suite still guards behaviour; the component should be dumb.
