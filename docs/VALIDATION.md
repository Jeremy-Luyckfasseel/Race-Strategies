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

## Phase 4 — public validation  ·  STATUS: ☐ READY TO RUN

The landing page (`landing/`) is **built** — a standalone fake-door + email capture
that records attributable click events (verified locally: the season-pass click
fires `#/fake_door_click`, the email submit fires `#/email_submit`, both visible to
Cloudflare Web Analytics). **The validation itself is a human activity** — Claude
can't run it. Do these in order, then read the results before writing any Phase 5
code.

### Before posting the page (owner setup — see `landing/README.md`)

- [ ] Pick the **product name** and set `BRAND` in `landing/app.js` (PENDING — see
      `docs/DECISIONS.md`). Check domain + trademark first.
- [ ] Set `DOWNLOAD_URL` to the Windows installer (Phase 3 `npm run dist` output).
- [ ] Set `TALLY_URL` to your Tally form (email → Google Sheet).
- [ ] Paste the **Cloudflare Web Analytics** token into `landing/index.html` and
      uncomment the beacon; deploy to **Cloudflare Pages**.
- [ ] Confirm one test email lands in the Google Sheet and one test click shows in
      Web Analytics. **If recording isn't wired to a sink you read, the experiment
      yields nothing** — verify the event lands before posting.

### The three questions + pass bar

1. **Do teams want it?** Show the live "Now" view to **2–3 GT7 endurance
   teams/leagues**. Record: would they use it live? what's missing?
   - Result: _______________________________________________
2. **Will strangers click the offer?** Post the page in sim-racing communities.
   Does the **€9.99/season** fake-door button get real clicks? how many vs visits?
   - Result: _______________________________________________
3. **Is the learner accurate enough live?** Run a **real mock endurance race**.
   - **Pass bar (DECISION):** predicted pit lap within **±1 lap** of optimal;
     fuel-prediction error **under ~1 lap's worth** by stint end; **no accidental
     dry-running**. (Ties back to Phase 1 tolerances — retune `LEARNER_CONFIG` /
     the test bands if real residuals warrant.)
   - Result: _______________________________________________

**Put the tools down here.** If those land — teams want it, the fake door gets real
clicks, and the learner proves accurate in a real mock race — *then* consider
Phase 5. If they don't, you've spent the minimum to find out.
