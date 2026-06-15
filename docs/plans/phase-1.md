# Phase 1 — Auto-derive strategy inputs from telemetry

> **Standalone context.** One of five phase plans derived from
> `Race-Strategies-Claude-Code-Build-Plan.md`. You may have no memory of writing
> it. **Before coding, read `CLAUDE.md`, `docs/DECISIONS.md` (locked answers), and
> `docs/CURRENT_STATE.md`** — especially CURRENT_STATE §3 (data shapes) and §4
> (the two physics models the engine uses). The product is a GT7 endurance
> strategy calculator with live PS5 telemetry. Locked MVP = single-team /
> single-car / local. Distributed/cloud/F1 are out of scope (Phase 5 stub).
>
> This is the **headline feature**: the user stops hand-measuring lap times, fuel
> burn, and tire degradation — the app learns them live from telemetry.
>
> **The physics decisions for this phase are now resolved in `docs/DECISIONS.md`
> and folded into the tasks below.** Only one small item remains open (fuel-map
> packet exposure — resolved by inspection: not exposed → user-declared). Do not
> re-guess the resolved items; if `docs/DECISIONS.md` and this file ever
> disagree, `DECISIONS.md` wins.

## Objective (what's true when this phase is done)

1. A new pure-JS module `src/logic/telemetryLearner.js` (zero React, node-testable
   like `strategy.js`) ingests a stream of decoded telemetry frames and estimates,
   **per stint and per compound**:
   - fuel consumption per lap,
   - the fuel-weight penalty (seconds per litre), and
   - a tire-degradation curve expressed in the engine's 3-point form
     (start / half / end lap times + `tireLife`).
2. Its output is shaped so it drops straight into the `findBestStrategies()`
   input (CURRENT_STATE §3B) — i.e. it produces `compounds[]`, `lapsPerFullTank`,
   and `fuelWeightPenaltyPerLiter` (and the live mid-race fields it can fill).
3. Data is segmented by stint using the existing pit-exit detection; the existing
   one-tap "confirm compound" flow is preserved (compound is **not** auto-detected).
4. The learner's live estimates feed the strategy inputs so they auto-populate as
   a session runs, while manual-override fields still work.
5. A synthetic-telemetry test file proves the learner recovers known "true" values
   within an agreed tolerance. **All existing tests stay green.**

## Prerequisites

- Phase 0 done (guardrails + backlog + accurate CURRENT_STATE).
- The physics decisions at the bottom of this file answered by the owner (they are,
  in `docs/DECISIONS.md`).
- **Concierge / Wizard-of-Oz trust test run FIRST (re-sequenced ahead of this
  phase — see `docs/DECISIONS.md` "Sequencing").** Before writing learner code,
  validate by voice/text in a team's live race whether they want live automation or
  just a better static planner. If they keep overriding human-judgement calls
  ("I'm saving tyres behind this backmarker"), that confirms the **assist-not-
  automate / propose-and-accept** direction this phase is built around — and could
  reshape it. Zero code; one evening; do it before sinking build effort.

## In scope / Out of scope

**In scope:**
- New pure module `src/logic/telemetryLearner.js`.
- New test `tests/test_telemetry_learner.js` (plain node, same style as the
  others).
- Wiring in `src/App.jsx` / a small new hook to run the learner against live
  telemetry and **propose** estimates (propose-and-accept — the learner never
  silently overrides the active `inputs`).
- Minimal UI affordance: recommendation card(s) with Accept/Ignore + a trust
  display (sample size + volatility). Can be lightweight — full "Now" view is
  Phase 2.

**Out of scope — do NOT touch / build:**
- Auto-detecting tire compound (GT7 doesn't expose it — keep the one-tap flow).
- Any change to the ranking/simulation maths in `strategy.js` **unless** a
  decision below explicitly calls for it (e.g. a richer deg model). Default: the
  learner adapts to the engine, not the reverse.
- Multi-car / cross-team learning. Single selected car only.
- Packaging, auto-connect, the "Now" view (Phases 2–3).

## Tasks

### Task 1.1 — Telemetry learner module (core)

- **What to build:** `src/logic/telemetryLearner.js`. A pure module that accepts
  telemetry frames (the packet shape in CURRENT_STATE §3A) one at a time (or as an
  array) and maintains running estimates. Suggested shape:
  - `createLearner(config)` → stateful object, or a pure
    `learnFromFrames(frames, options)` → estimates. Pick one; prefer a small
    `createLearner()` with `.ingest(frame)` and `.getEstimates()` so it can run
    live and be unit-tested by replaying an array.
  - `getEstimates()` returns at least:
    `{ lapsPerFullTank, litersPerLap, fuelWeightPenaltyPerLiter,
       compounds: { [compoundId]: { tireLife, startLapTime, halfLapTime, endLapTime, sampleCount, confident } },
       currentStint: {...} }`.
    Each learned scalar/curve should carry a **trust payload** — at minimum
    `{ sampleCount, volatility, confident }` (volatility = a spread/confidence band,
    with a "highly volatile" state) — so the propose-and-accept UI (Task 1.3) can
    show how solid each number is.
- **Files created/changed:** `src/logic/telemetryLearner.js` (new).
- **Approach / modelling choices (confirm against decisions below):**
  - **Lap detection:** a new lap = `currentLap` increments. Capture per-lap
    `lastLapMs` (the just-completed lap), the fuel level at lap start/end, and the
    tire-wear / tire-age at that lap.
  - **Fuel per lap — the load-bearing number, measured directly from tank deltas
    (DECISION 5).** `fuelAtLapStart - fuelAtLapEnd`, read straight from the tank —
    **not** inferred from lap times. This makes it **traffic-proof**: it stays
    accurate even in a chaotic stint, because a lap behind a backmarker still burns
    the same fuel. This is the number that answers "fuel to the flag / when must I
    pit", so it must **not** depend on clean laps. Average over recent laps in the
    stint (a lap or two of tank jitter is fine), derive
    `lapsPerFullTank = tankSize / litersPerLap`, and report `litersPerLap`
    directly. **Only the fuel-weight coefficient and the degradation curve (below)
    need clean laps — both are second-order refinements, not this number.** The
    learner is therefore *not* "blind in traffic"; its most important output is
    robust regardless.
  - **Fuel-weight penalty (DECISION 1):** linear regression of clean-lap time
    against fuel load on board (independent variable = litres), within a window
    where tire age is roughly constant — slope = seconds/litre. It is a **single
    scalar, learned per track**; do **not** model any taper. Seed at **0.03 s/L**;
    sanity-check the learned value against the plausible range **~0.02–0.05**
    (longer track → higher). The engine's model is strictly linear
    (CURRENT_STATE §4), so a single slope is what it can consume.
  - **Tire degradation (DECISIONS 2, 3, 4):** index degradation by
    **lap-count-since-stint** (clean, deterministic) — NOT by radius/wear, which is
    only a secondary corroborating signal. `tireLife` **stays a user input**; the
    learner fits the curve only *within* it. Fit lap-time-vs-lap-in-stint **after
    removing the fuel-weight component** (subtract `penalty * fuelOnBoard` so you
    isolate degradation), then sample that fitted curve at lap 0, lap
    `tireLife/2`, and lap `tireLife` to emit `start/half/end`. The 3-point model is
    **piecewise** (it bends — it can represent an accelerating drop-off), not a flat
    linear fit, and because `tireLife` is user-set you only model the **usable
    window before the cliff**. Keep this model — do **not** extend the engine to a
    richer/non-linear curve for the MVP. **Cliff safety margin (DECISION 2):** add a
    conservative margin near `tireLife` (the model under-warns at the very edge if a
    stint is stretched to the limit) and document the cliff as a **known
    limitation**.
  - **Clean-lap filtering — for the two refinements ONLY (DECISION 5):** the
    fuel-weight slope and the degradation curve are fit on clean laps; fuel/lap is
    not (it's tank-delta, above). Discard out-laps, in-laps, the first flying lap
    after pit exit, laps with `paused`, and off-track / penalty laps. **Accept
    clean laps even when non-consecutive** (don't require an unbroken run). Outlier
    rule: drop laps slower than the stint's clean median by more than ~3% (traffic /
    mistakes) and any implausibly fast lap. Traffic isn't reliably auto-detectable
    without opponent-proximity data — the median filter is the safety net.
  - **Seed from a practice/qualifying stint (DECISION 5):** let the learner ingest
    an earlier practice/quali stint so it is **never starting cold** in the race
    (endurance teams practice). Seeds the fuel/lap, the weight slope, and the deg
    curve before lap 1 of the race proper.
  - **Confidence gating + trust signal (DECISION 5):** fuel/lap usable after ~3
    laps (tank-delta); trust/surface the degradation curve only after ~6–8 clean
    laps spanning enough of the stint. Expose per estimate a `confident` flag PLUS
    a **trust display payload — sample size and a volatility / confidence band**,
    including a "highly volatile" state — so the UI can show *how solid* a number is
    rather than hiding uncertainty. **Widen the band in chaos** instead of
    suppressing the estimate.
  - **Fuel map (DECISION 8):** do **not** force `fuelMap = 1.0`. Learn
    `litersPerLap` at whatever map is actually running and keep `fuelMap` as a
    separate what-if lever. The GT7 packet does **not** expose the fuel-map level
    (confirmed by inspecting `server/telemetry-server.js` — only fuel ratio +
    capacity are parsed), so the map is user-declared; when the user changes it,
    the learner re-learns `litersPerLap`.
  - Output lap times as `"M:SS.mmm"` strings via the engine's `formatLapTime`, OR
    as seconds — match whatever `findBestStrategies` consumes (it accepts both via
    `parseLapTime`; strings keep parity with manual entry).
- **Tests to add:** `tests/test_telemetry_learner.js`. Generate **synthetic
  frames** from a known ground truth: pick a true `litersPerLap`, true
  `penaltySecPerLiter`, and a true 3-point degradation curve; emit frames lap by
  lap (decrement fuel, advance tire age, compute lap time = base deg curve +
  penalty*fuel + small noise). Assert the learner recovers each within tolerance.
  Include a no-noise case (exact recovery) and a noisy case (tolerance band).
  **Tolerances (DECISION 6):** clean-data synthetic-recovery tests must hold the
  tight band — ±0.05 L/lap, ±0.003 s/L, ±0.15 s/lap; the noisy case uses the
  live-trust band — ±0.1 L/lap, ±0.005 s/L, ±0.3 s/lap. These are the starting
  thresholds; the owner expects to retune them after seeing residuals from real
  stints (open item 1.6), so keep them in named constants at the top of the test.
- **Acceptance:** With zero-noise synthetic data the learner recovers
  `litersPerLap`, `penaltySecPerLiter`, and the 3 lap times within the tight band;
  with noise it recovers them within the live-trust band. `npm test` (existing
  suite) still fully green.

### Task 1.2 — Per-stint / per-compound segmentation

- **What to build:** Extend the learner to split the frame stream into stints
  using the existing **pit-exit** signal, and accumulate a **separate**
  degradation model per compound.
- **Files changed:** `src/logic/telemetryLearner.js`; possibly a tiny adapter so
  it can read the same `pitExit` flag the relay emits.
- **Approach:**
  - A stint boundary = a `pitExit` frame (car leaves the pit). Reset per-stint
    accumulators (tire age → 0, fresh deg samples).
  - The compound for the new stint comes from the **user's one-tap confirmation**
    (existing `useCompoundDetector` / `teamCompounds[ip]`). The learner takes the
    compound id as an input per stint; it never guesses it.
  - Each compound id owns its own running degradation fit; samples from multiple
    stints on the same compound accumulate.
  - Keep the fuel-weight penalty as a single global estimate (it's a car property,
    not a tire property) unless a decision says otherwise.
- **Tests:** Extend the test with a multi-stint synthetic session that switches
  compound at a pit-exit; assert each compound's curve is learned independently
  and tire age resets at the boundary.
- **Acceptance:** Two stints on different compounds yield two distinct learned
  curves; a second stint on the same compound refines (doesn't reset) that
  compound's model. Compound is only ever set via the existing confirm flow.

### Task 1.3 — Surface learner estimates via PROPOSE & ACCEPT (NOT silent auto-fill)

> **This task was revised after a red-team review. The earlier "silent auto-fill +
> global toggle" model is dropped** — it's the black box that makes teams distrust
> the tool and revert to their spreadsheet under pressure. The corrected model
> (DECISION 7) keeps the human in control.

- **What to build:** Run the learner in the background against the live telemetry
  and **surface recommendations the human accepts or ignores** — the manual inputs
  remain the active strategy and the source of truth. Telemetry **never silently
  overrides** a field.
- **Files changed:** optionally a new `src/hooks/useTelemetryLearner.js` that runs
  `createLearner` against `telem.teams.get(activeIp)`; `src/App.jsx` (wiring);
  a small recommendation/"trust" UI surface (could live in `InputPanel.jsx` or the
  Phase 2 "Now" view).
- **Approach (propose & accept — DECISION 7):**
  - Run one learner instance for the selected car. Ingest each packet; throttle
    `getEstimates()` to ~once per new lap (not per frame).
  - **The active `inputs` are the manual / last-accepted numbers.** The learner's
    output is held in a **separate `learned` object** and is **never written into
    `inputs` automatically.**
  - When a learned value is **confident AND meaningfully differs** from the active
    input, surface a **recommendation card**: e.g. *"measured 3.12 L/lap vs your
    3.40 — Accept / Ignore"*. Only an explicit **Accept** copies it into `inputs`
    (and triggers a recalc); **Ignore** dismisses it (and shouldn't nag again until
    the value shifts materially).
  - Every learned/proposed value shows a **trust display**: sample size +
    volatility / confidence band (incl. "highly volatile"), straight from the
    learner's trust payload (Task 1.1). The point is the human can see *how solid*
    the recommendation is before accepting.
  - Respect the existing mid-race auto-fill (currentLap/currentFuel) — that live
    *state* (not a learned model parameter) may still flow as today; don't
    double-write.
- **Tests:** Add a node-level test (or extend the learner test) that replays a
  synthetic session and asserts the **estimate object** progressively converges to
  truth AND that a `confident` recommendation is only emitted once enough samples
  exist (the propose/accept *logic* — "should we recommend this?" — should live in
  a pure helper so it's node-testable; the React surface isn't). Optionally assert
  that an accepted estimate fed into `findBestStrategies` yields a valid ranked
  result.
- **Acceptance:** Replaying a logged/synthetic session, the learner **proposes**
  corrected values with a visible trust signal; **nothing changes the active
  strategy until the human accepts**; ignoring a proposal doesn't re-nag until it
  materially shifts; all prior tests green.

### Phase-1 acceptance (revised from the build plan)

Run a logged/synthetic session and watch the learner **propose** accurate fuel /
weight / degradation values with a trust signal, which the human accepts into the
active strategy — **no silent overrides, no black box**; all prior tests still
green.

## Resolved decisions (from `docs/DECISIONS.md`) — folded into the tasks above

1. **Fuel-weight effect:** linear, single scalar s/L, learned per track. No taper.
   Seed 0.03; plausible range ~0.02–0.05.
2. **Tyre-deg shape:** keep the engine's 3-point **piecewise** model (it bends —
   not a flat linear fit); model only within user-set `tireLife` (before the
   cliff) + a conservative **safety margin** near the limit; note the cliff as a
   known limitation. Don't extend the engine (richer curve = post-MVP).
3. **`tireLife`:** stays a user input; learner fits the curve within it. (Learner
   *suggesting* a tireLife is a future enhancement, not MVP.)
4. **Degradation x-axis:** lap-count-since-stint. Radius-derived wear is a
   secondary corroborating signal only.
5. **Signal robustness:** **fuel consumption = tank-delta, traffic-proof, no clean
   laps needed** (the load-bearing number). Only the fuel-weight coefficient and
   the deg curve need clean laps (second-order). Accept **non-consecutive** clean
   laps; **seed from a practice stint**; **widen the confidence band in chaos**.
   Cleaning: drop out/in/first-flying/paused/off-track laps + outliers (>~3% over
   stint clean median, and implausibly fast). Confidence: fuel/lap after ~3 laps;
   deg curve after ~6–8 clean laps spanning the stint.
6. **Tolerances:** single config object, **synthetic-test vs live-trust thresholds
   separated + commented**. Tight (tests) ±0.05 L/lap, ±0.003 s/L, ±0.15 s/lap;
   live-trust (noisy) ±0.1 L/lap, ±0.005 s/L, ±0.3 s/lap. Retune after real stints.
7. **Override UX — PROPOSE & ACCEPT (revised; supersedes silent auto-fill):** manual
   numbers stay the active strategy + source of truth; the learner never silently
   overrides; when confident it **surfaces a recommendation** ("measured X vs your
   Y — Accept/Ignore") with a **trust display** (sample size + volatility band), and
   the human decides.
8. **Fuel map:** do not force 1.0; learn `litersPerLap` at the running map, keep
   `fuelMap` as a what-if lever.

### Still open — do NOT guess

- **1.8 (resolved by inspection, confirm live if convenient):** the GT7 packet
  does **not** expose the fuel-map level — `server/telemetry-server.js` parses only
  fuel ratio (0x44) + capacity (0x48). Treat fuel map as user-declared; learner
  re-learns `litersPerLap` when the user changes it. A one-time live log check can
  confirm, but do not block Phase 1 on it.
- **1.6:** the tolerance constants above are starting values — the owner will
  tighten/loosen them after the first real stints. Keep them as named constants so
  retuning is a one-line change.

## Risks / things likely to go wrong

- **Confounded signals.** Lap time mixes fuel weight, tire deg, driver variance,
  and traffic. If the fuel-weight slope and the deg curve are fit on overlapping
  data they trade off against each other and both come out wrong. Mitigation: fit
  the penalty on a near-constant-tire-age window (or jointly via multiple
  regression) and document the method.
- **Too few clean laps early.** Short stints / heavy traffic can leave almost no
  usable laps for the *second-order refinements* (weight slope, deg curve);
  estimates must degrade gracefully and not surface noise as fact (the `confident`
  flag + volatility band). Note this does **not** threaten fuel/lap (tank-delta).
  Mitigations: seed from a practice stint, accept non-consecutive clean laps.
- **Tyre cliff under-warning.** The 3-point model only covers up to `tireLife`; a
  team stretching a stint past the usable window can hit the real cliff the model
  doesn't represent. Mitigation: conservative safety margin near `tireLife` +
  document as a known limitation (richer curve is post-MVP).
- **Building automation the users don't want.** If the concierge test shows teams
  want assist-not-automate, a silent/aggressive learner would be wrong product.
  Mitigation: the propose-and-accept design + running the concierge test first.
- **Radius/wear noise.** If tire radius is jittery or non-monotonic, a deg model
  keyed on it will be unstable — hence decision #4.
- **Over-writing user input.** The wiring must never clobber a value the user
  deliberately set. Get the override model (decision #7) right before wiring.
- **Engine coupling.** If the learner emits a shape the engine can't consume, it's
  useless — keep output identical to the manual input shape (CURRENT_STATE §3B).
- **Keep `src/logic/` pure.** The learner must be node-testable with no React/DOM
  imports, exactly like `strategy.js`.
