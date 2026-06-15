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

### 0.4 — Concierge / Wizard-of-Oz trust test  ·  STATUS: ☑ DONE

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

**Takeaway (recorded):**
- **Follow or override?** Both — some calls were acted on, some overridden. Mixed,
  as expected for live judgement calls.
- **Verdict — ASSIST, not automate.** Confirmed. Teams want decision support, not
  a tool that runs the strategy for them. This validates the **propose-and-accept**
  design Phase 1 is built around.
- **Key design clarification — the user is the race engineer, not the driver.**
  There is always a human already talking to the driver (engineer / strategist).
  **The app must NOT talk to the driver directly or try to be that voice.** Its job
  is to surface clear, live updates and recommendations **to that engineer**, who
  makes the call and relays it. (Reinforces audio-callouts staying OUT of MVP, and
  sharpens who the Phase 2 "Now" view is for.)
- **Does anything change the Phase 1 design?** No change to the learner itself —
  propose-and-accept holds. The change is to the *audience* of the live surface
  (Phase 2): build it for the engineer-relayer, glanceable, no auto-voice.

---

### 0.5 — SmartScreen audit  ·  STATUS: ☑ RESOLVED (owner read)

> Confirm the unsigned-app friction is a **click-through, not a wall**, before
> investing in packaging polish (Phase 3).

- **Do:** Observe how target users handle the Windows SmartScreen "unknown
  publisher" warning — using a comparable unsigned sim tool (SimHub / CrewChief /
  Hector) or a throwaway unsigned build.
- **Watch for:** do they click "More info → Run anyway", or does the warning stop
  them cold?

**Takeaway:**
- **Verdict — click-through, not a wall.** Per the owner (who knows the GT7
  sim-racing community first-hand): users **don't care** about the unsigned-app
  warning — this hobby routinely installs unsigned tools (SimHub, CrewChief,
  Hector) and clicks straight through. No formal observation needed.
- **Implication:** the "ship unsigned for the MVP" decision stands; the
  code-signing cert stays a **pre-paid-launch** item, not a build blocker. (An
  unsigned binary behind the €9.99 paywall still reads as sketchy to a paying
  stranger, so sign before charging — see Phase 3 / Phase 4 pre-launch checklist.)
- **Why the pop-up exists at all:** see the two-pop-up explanation in
  `phase-3.md` (Task 3.2) — SmartScreen fires because we're unsigned by choice;
  the separate firewall prompt fires because the relay is a network app and is
  unavoidable regardless of signing.

---

## Phase 4 — public validation (later; see `phase-4.md`)

Filled in during/after Phase 4. The three questions + pass bar:

- Show the live "Now" view to 2–3 GT7 endurance teams/leagues — do they want it?
- Does the fake-door pricing button get real clicks in sim-racing communities?
- Run a real mock endurance race — does the learner stay accurate enough to trust?
  - **Pass bar:** predicted pit lap within **±1 lap** of optimal; fuel prediction
    error **under ~1 lap's worth** by stint end; **no accidental dry-running**.

**Put the tools down here.** If those land, *then* consider Phase 5.
