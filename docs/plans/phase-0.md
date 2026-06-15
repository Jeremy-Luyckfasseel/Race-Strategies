# Phase 0 — Set up guardrails

> **Standalone context.** This plan is one of five (`phase-0.md` … `phase-4.md`)
> derived from `Race-Strategies-Claude-Code-Build-Plan.md`. When you open this
> file you may have no memory of writing it. Before doing anything, read
> `CLAUDE.md` (scope, conventions) and `docs/CURRENT_STATE.md` (the real module
> map and data shapes). The product is a GT7 endurance **strategy calculator**
> with live PS5 telemetry. The locked MVP is **single-team / single-car / local**;
> distributed multi-car, cloud, whole-field, and F1 support are **out of scope**
> (future Phase 5 stub only).
>
> **Do not write feature code in Phase 0.** This phase only sets up the guardrails
> and shared documentation that every later phase depends on.

## Objective (what's true when this phase is done)

1. `CLAUDE.md` states the locked MVP scope, the explicit out-of-scope list, and
   the working rules (always run `npm test` and never weaken a test; `src/logic/`
   stays pure JS; one feature per git branch).
2. `docs/CURRENT_STATE.md` exists and is accurate. *(Already created — this phase
   verifies and, if needed, refreshes it.)*
3. `docs/BACKLOG.md` exists: small tasks with acceptance criteria, with
   already-done work flagged so nothing is rebuilt.
4. `npm test` passes unchanged (no logic was touched).
5. **Two zero-code validation experiments are run/scheduled before Phase 1** (per
   the re-sequencing in `docs/DECISIONS.md`): the **concierge / Wizard-of-Oz trust
   test** and a **SmartScreen audit**. These don't produce code; they de-risk the
   whole build before it starts.

## Prerequisites

None. This is the first phase. Everything else assumes it is done.

## In scope / Out of scope

**In scope:** editing `CLAUDE.md`; verifying/refreshing `docs/CURRENT_STATE.md`;
creating `docs/BACKLOG.md`; running the two zero-code pre-build validation
experiments (Tasks 0.4–0.5).

**Out of scope — do NOT touch:** any file under `src/`, `server/`, or `tests/`.
No behaviour changes. No new dependencies. Do not write feature code here. (The
two experiments are *activities*, not code.)

## Tasks

### Task 0.1 — Update `CLAUDE.md`

- **What to build:** Add a clearly headed "MVP scope & working rules" section to
  `CLAUDE.md` capturing:
  - Locked MVP = single-team / single-car / local, GT7 on PS5, strategy inputs
    auto-derived from live telemetry.
  - Out of scope (v2): distributed multi-car aggregation, cloud server for
    at-home leagues, whole-field organizer board, F1-game support.
  - Rule: always run `npm test` after changes; keep all existing assertions
    passing; **never delete or weaken a test to make it pass**.
  - Convention: `src/logic/strategy.js` (and `src/logic/` generally) stays pure
    JS with zero React dependency, runnable under plain `node`.
  - Workflow: one feature per git branch.
- **Files changed:** `CLAUDE.md`.
- **Approach:** Append a new section; do not rewrite existing content. Keep it
  short and skimmable.
- **Tests:** none (docs only). Run `npm test` once to confirm still green.
- **Acceptance:** `CLAUDE.md` contains all five rules above; `npm test` passes.

### Task 0.2 — Verify / refresh `docs/CURRENT_STATE.md`

- **What to build:** Confirm `docs/CURRENT_STATE.md` still matches the code
  (module map, telemetry packet shape, engine input/output shape, the two physics
  models, the half-finished list). Fix any drift.
- **Files changed:** `docs/CURRENT_STATE.md` (only if drift found).
- **Approach:** Re-read `src/logic/strategy.js`, `server/telemetry-server.js`, and
  the hooks; diff against the doc. Base claims on real code, never assumptions.
- **Tests:** none.
- **Acceptance:** A reviewer can follow the doc to each named file/line and find
  it accurate.

### Task 0.3 — Create `docs/BACKLOG.md`

- **What to build:** A backlog derived from `CURRENT_STATE.md` + the MVP scope,
  broken into small tasks each with a one-line acceptance criterion, grouped by
  phase (1–4). Flag anything already implemented (e.g. mid-race `currentLap` /
  `fuelLiters` auto-fill, multi-team scaffolding, track-map recording) as
  **DONE — do not rebuild**.
- **Files changed:** `docs/BACKLOG.md` (new).
- **Approach:** One bullet per task; mark status `[ ]` / `[done]`. Keep it a
  living checklist, not prose. Also capture the **cross-cutting i18n item**
  (per `docs/DECISIONS.md`: English primary, lightweight i18n wired in so
  French + Dutch become strings files later). The app currently has hardcoded
  French strings, so schedule a small i18n scaffold — naturally alongside the
  Phase 2 UI work — rather than leaving it implicit.
- **Tests:** none.
- **Acceptance:** Every Phase 1–4 task in the build plan appears as at least one
  backlog item; already-done items are flagged.

### Task 0.4 — Concierge / Wizard-of-Oz trust test (zero code — do this BEFORE Phase 1)

> The single highest-leverage experiment in the whole plan, per the red-team
> review. It costs one evening and zero code and answers the make-or-break product
> question before any learner is built.

- **What to do (not build):** Sit in a GT7 endurance team's Discord during a live
  race and **be the algorithm** — feed strategy calls (pit lap, fuel, push/save)
  by voice or text and watch whether the team **follows or overrides** you.
- **What it answers:** Do teams actually want **live automation**, or just a
  **better static planner**? (assist vs automate). If they keep overriding with
  human-judgement context the data can't see ("I'm saving tyres behind this slow
  car"), the product must be **assist-not-automate** — which validates the
  **propose-and-accept** design Phase 1 is built around, and could reshape it.
- **Files changed:** none (optionally capture notes in `docs/VALIDATION.md`).
- **Acceptance:** A written takeaway recorded (in `docs/VALIDATION.md` or the
  backlog) on whether teams want automation vs. a planner, and any signal that
  changes the Phase 1 design, **before** learner code starts.

### Task 0.5 — SmartScreen audit (zero/low code — early, alongside Phase 1)

- **What to do:** Observe how target users handle the Windows SmartScreen
  "unknown publisher" warning — using a comparable unsigned sim tool (SimHub /
  CrewChief / Hector) or a throwaway unsigned build — to confirm the unsigned-app
  friction is a **click-through, not a wall** before investing in packaging polish
  (Phase 3).
- **Files changed:** none (note the result in `docs/VALIDATION.md`).
- **Acceptance:** A recorded read on whether the unsigned warning blocks adoption;
  if it does, that escalates the code-signing-cert timing (see Phase 3 / Phase 4
  pre-launch checklist).

## Decisions I need from you (CRITICAL)

- **None for Phase 0.** It is documentation + guardrails only. All cross-phase
  decisions are now answered in `docs/DECISIONS.md` (the source of truth); the
  physics/modelling answers that bite hardest are folded into `phase-1.md`.

## Risks / things likely to go wrong

- Over-editing `CLAUDE.md` and accidentally dropping existing project guidance.
  Mitigation: append, don't rewrite.
- `CURRENT_STATE.md` drifting silently in later phases. Mitigation: the build
  plan's own guidance — refresh it as you go.
- Backlog turning into a second copy of the build plan. Keep it task-sized and
  acceptance-focused, not narrative.
