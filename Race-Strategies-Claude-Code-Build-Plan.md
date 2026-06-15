# Race-Strategies — Build Plan for Claude Code

A phased plan to take the existing prototype to a shippable, validation-ready MVP. Designed to be fed to Claude Code **one task at a time**, using the existing test suite as a guardrail. Lightweight on purpose — no heavy framework.

---

## Locked scope (read first)

**MVP = single-team / single-car, local, GT7 on PS5, with strategy inputs auto-derived from live telemetry.**

- **In scope:** read your own car's telemetry locally; auto-learn fuel burn, fuel-weight effect, and tyre degradation during a session; compute and live-update the optimal strategy; a clear in-race "what to do now" view; packaging so a non-developer can run it.
- **Explicitly OUT of scope for now (v2, do NOT build yet):** distributed multi-car aggregation, cloud server for at-home leagues, the whole-field organizer board, F1-game support. These come *after* a single team confirms the tool is genuinely useful and someone signals they'd pay.
- **Why:** the single-team local version needs no servers and no cooperation from other people, so it's the fastest thing to ship and validate. Build the part that depends on nobody else first.

---

## Phase 0 — Set up guardrails (do this before any feature work)

**Task 0.1 — Update `CLAUDE.md`.** Add: the locked MVP scope above; the explicit out-of-scope list; the rule "always run `npm test` after changes and keep all existing assertions passing — never delete a test to make it pass"; the convention "the strategy engine in `src/logic/strategy.js` stays pure JS with zero React dependency"; "one feature per git branch."

**Task 0.2 — Ask Claude Code to produce a current-state map.** Prompt: *"Read the whole repo and write `docs/CURRENT_STATE.md`: a concise map of every module, what it does, the data shapes flowing between telemetry → engine → UI, and anything that looks half-finished or dead. Do not change any code."* This gives the AI (and you) accurate shared context for everything after.

**Task 0.3 — Backlog.** Prompt: *"Based on CURRENT_STATE.md and the MVP scope in CLAUDE.md, produce `docs/BACKLOG.md` breaking the work into small tasks with acceptance criteria. Flag anything already done so we don't rebuild it."*

---

## Phase 1 — Auto-derive strategy inputs from telemetry (the core differentiator)

This is the feature that sets you apart: the user stops hand-measuring lap times, fuel burn, and degradation. The app learns them live.

**Task 1.1 — Telemetry learner module.** Prompt: *"Create `src/logic/telemetryLearner.js` — pure JS, zero React, testable in node like strategy.js. It ingests a stream of decoded telemetry frames and estimates, per stint: fuel consumption per lap, the fuel-weight penalty (regress lap time against fuel load), and a tyre-degradation curve (from lap-time drift plus the per-corner tyre-wear values already in the feed). Output an object matching the input shape `findBestStrategies()` already expects. Write a test file with synthetic telemetry whose 'true' values are known, asserting the learner recovers them within tolerance."*

**Task 1.2 — Per-stint / per-compound segmentation.** Prompt: *"Extend the learner to segment data by stint, using the existing pit-exit detection. Keep the existing one-tap 'confirm compound' flow — do not attempt to auto-detect compound (GT7's feed doesn't expose it; one tap per stop is acceptable). Each compound accumulates its own degradation model."*

**Task 1.3 — Wire learner into the live strategy.** Prompt: *"Feed the learner's live estimates into the strategy inputs so they auto-populate as a session runs, while keeping manual-override fields. Add tests that a running session progressively replaces manual inputs with learned ones."*

*Acceptance for Phase 1:* run a logged/synthetic session and watch the strategy inputs fill themselves in with no manual typing; all prior tests still green.

---

## Phase 2 — The single-team in-race loop (make it useful live)

**Task 2.1 — "Now" view.** Prompt: *"Add a primary in-race view that surfaces only what the driver/engineer needs in the moment: current optimal plan, the next action (pit lap target, fuel to add), a stint countdown, and a 'lift and coast / push' prompt when the model says fuel is tight or in surplus. Keep it readable at a glance on a second screen."*

**Task 2.2 — Make single-team the default.** Prompt: *"Make the single-team view the default landing tab. Move the multi-team leaderboard behind an 'Advanced / LAN event' section — keep the code, just de-emphasize it for the MVP."*

**Task 2.3 (optional) — Audio callouts.** Prompt: *"Add optional spoken callouts for key events (box this lap, fuel target reached) using the browser SpeechSynthesis API, with a mute toggle."*

*Acceptance for Phase 2:* during a session you can glance at one screen and know exactly when to pit and how much fuel to add, updated live.

---

## Phase 3 — Packaging & onboarding (the biggest real gap)

Right now it requires clone + npm + running a relay + firewall. No real user does that. Fix it.

**Task 3.0 — Decide the distribution form (your call, not Claude's).** Options, simplest first:
- **A) Packaged desktop app (recommended):** bundle the UI + the telemetry relay into one double-click app (Tauri is lightweight; Electron is heavier but simpler). User installs once, opens it, done.
- **B) Hosted web UI + tiny downloadable agent:** the dashboard lives on the web; a small agent reads the PS5 locally and feeds the browser.

Pick one before Task 3.1.

**Task 3.1 — Auto-connect flow.** Prompt: *"Implement: on launch, auto-scan the LAN for an active GT7 PS5 (reuse existing scan), auto-detect when a session becomes active from the telemetry stream, auto-connect, and hold the connection with auto-reconnect on drop. The user should not have to enter IPs or press connect in the normal case."*

**Task 3.2 — Package it.** Prompt: *"Wrap the app per the chosen distribution form so a non-technical user can install and run it without Node, npm, or a terminal. Produce build instructions in `docs/PACKAGING.md`."*

**Task 3.3 — First-run onboarding.** Prompt: *"Add a minimal first-run flow: detect PS5 → confirm car/track (or auto) → go. No manual telemetry inputs required, since Phase 1 learns them."*

*Acceptance for Phase 3:* a friend who has never seen the repo can install it, open it, and get a live strategy during a race without touching a terminal.

---

## Phase 4 — Validation-ready slice (build last, then STOP and test)

**Task 4.1 — One-page site.** Prompt: *"Scaffold a single landing page describing the single-team strategy tool: what it does, the 'no manual input — it learns your car live' hook, and a clear call to action. Include an email-capture field and a 'Get the season pass — €X' button that records the click (fake-door test) before any payment is built."*

**Then put the tools down and validate** (no more code until this is answered):
- Show the live "Now" view to 2–3 GT7 endurance teams/leagues. Do they want it?
- Does the fake-door pricing button get real clicks when posted in sim-racing communities?
- Run a real mock endurance race: does the learner stay accurate enough live to trust the strategy?

If those land, *then* consider Phase 5 (distributed multi-car / F1). If they don't, you've spent the minimum to find out.

---

## How to drive Claude Code through this

- Feed **one task at a time**, not the whole plan. Paste the task prompt, let it propose a plan, approve, let it implement, then run `npm test`.
- Start each feature on its own branch.
- After each task, ask: *"Run the full test suite and summarize what changed and why."*
- If a task is bigger than expected, ask Claude Code to split it before coding.
- Keep `src/logic/` pure and tested — it's your most valuable, most reusable asset (it ports straight to F1 later).
- Update `CURRENT_STATE.md` and `BACKLOG.md` as you go so the AI's context stays accurate.

---

## On BMAD (for reference)

Skipped for now: it's optimized for greenfield/complex builds and is flagged as heavy and slow for small features on existing code — wrong fit for incremental work on a codebase you already have, and it burns tokens. Revisit it only if you commit to the large distributed v2, or if plain Claude Code starts producing inconsistent results and you need more structure.
