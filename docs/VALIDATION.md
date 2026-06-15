# VALIDATION.md

> Where validation experiments and their takeaways are recorded. Two zero-code
> experiments are scheduled **before / alongside Phase 1** (per `docs/DECISIONS.md`
> "Sequencing" and `phase-0.md` Tasks 0.4–0.5). They de-risk the whole build before
> learner code starts.
>
> **These are human activities, not code** — Claude Code cannot run them. The
> templates below are ready to fill in. Until then they are **PENDING**.

---

## Pre-build experiments (do these before Phase 1)

### 0.4 — Concierge / Wizard-of-Oz trust test  ·  STATUS: ☐ PENDING

> The single highest-leverage experiment in the plan. One evening, zero code.
> Answers the make-or-break product question: **do teams want live automation, or
> just a better static planner?** (assist vs automate).

- **Do:** Sit in a GT7 endurance team's Discord during a live race and **be the
  algorithm** — feed strategy calls (pit lap, fuel, push/save) by voice or text and
  watch whether the team **follows or overrides** you.
- **Watch for:** human-judgement overrides the data can't see ("I'm saving tyres
  behind this slow car"). Frequent overrides → the product must be
  **assist-not-automate**, which validates the **propose-and-accept** design Phase 1
  is built around.

**Takeaway (fill in):**
- Date / race:
- Did they follow or override the calls?
- Examples of context the data couldn't see:
- **Verdict — automate vs. assist:**
- **Does anything change the Phase 1 design?** (record BEFORE learner code starts):

---

### 0.5 — SmartScreen audit  ·  STATUS: ☐ PENDING

> Confirm the unsigned-app friction is a **click-through, not a wall**, before
> investing in packaging polish (Phase 3).

- **Do:** Observe how target users handle the Windows SmartScreen "unknown
  publisher" warning — using a comparable unsigned sim tool (SimHub / CrewChief /
  Hector) or a throwaway unsigned build.
- **Watch for:** do they click "More info → Run anyway", or does the warning stop
  them cold?

**Takeaway (fill in):**
- Date / who observed:
- Tool used (SimHub / CrewChief / Hector / throwaway build):
- Did the warning block adoption, or was it click-through?
- **If it blocks:** escalate the code-signing-cert timing (Phase 3 / Phase 4
  pre-launch checklist).

---

## Phase 4 — public validation (later; see `phase-4.md`)

Filled in during/after Phase 4. The three questions + pass bar:

- Show the live "Now" view to 2–3 GT7 endurance teams/leagues — do they want it?
- Does the fake-door pricing button get real clicks in sim-racing communities?
- Run a real mock endurance race — does the learner stay accurate enough to trust?
  - **Pass bar:** predicted pit lap within **±1 lap** of optimal; fuel prediction
    error **under ~1 lap's worth** by stint end; **no accidental dry-running**.

**Put the tools down here.** If those land, *then* consider Phase 5.
