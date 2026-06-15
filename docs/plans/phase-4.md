# Phase 4 — Validation-ready slice (build last, then STOP and test)

> **Standalone context.** One of five phase plans derived from
> `Race-Strategies-Claude-Code-Build-Plan.md`. You may have no memory of writing
> it. **Before coding, read `CLAUDE.md`, `docs/DECISIONS.md` (locked answers), and
> `docs/CURRENT_STATE.md`.** The product is a single-team / single-car / local GT7
> endurance strategy tool whose hook is "no manual input — it learns your car
> live." Cloud / multi-car / F1 are out of scope (see the Phase 5 stub at the
> bottom).
>
> This phase builds the **minimum** needed to find out whether anyone wants this,
> then deliberately stops coding until that question is answered.
>
> **Decisions for this phase are resolved in `docs/DECISIONS.md` and folded in
> below** (Cloudflare Pages, standalone English landing, Tally→Sheet capture,
> Cloudflare Web Analytics, the single €9.99/season fake-door offer). The only
> blocker is the **product name (PENDING — not chosen)**: do not hardcode a brand
> string in a hard-to-change way. If `docs/DECISIONS.md` and this file disagree,
> `DECISIONS.md` wins.

## Objective (what's true when this phase is done)

1. A single landing page exists describing the single-team strategy tool: what it
   does, the "it learns your car live" hook, and a clear call to action.
2. The page has an **email-capture** field and a **fake-door** "Get the season
   pass — €X" button that records the click **before** any payment system is
   built.
3. Click/lead events are recorded somewhere the owner can actually read them.
4. Existing app + tests are untouched and green.
5. A written validation checklist exists so the owner knows what "success" looks
   like before resuming code.

## Prerequisites

- Phase 0 done.
- Ideally Phases 1–3 done — the validation pitch ("learns your car live", "open
  it and get a live strategy") only rings true if those features exist to demo.
  The landing page itself can be built earlier, but **the validation step**
  (showing real teams, running a real mock race) needs the working product.

## In scope / Out of scope

**In scope:**
- A standalone one-page marketing/landing site (can be a separate minimal
  static page or a small route — keep it decoupled from the app's core).
- Email capture + fake-door button with click recording.
- A `docs/VALIDATION.md` checklist capturing the questions to answer and the
  bar for proceeding to Phase 5.

**Out of scope — do NOT build:**
- **Any real payment / checkout.** The button is a fake door — it records intent,
  takes no money.
- Accounts, billing, backend user system.
- **Anything from Phase 5** (distributed multi-car, cloud league server,
  whole-field board, F1). Not now.
- Heavy marketing infrastructure — one page, one capture, one button.

## Tasks

### Task 4.1 — One-page site

- **What to build:** A single landing page covering:
  - what the tool does (single-team GT7 endurance strategy, live),
  - the differentiator hook: **"no manual input — it learns your car live"**,
  - a clear CTA,
  - a **download button for the Windows desktop app** (the Electron build from
    Phase 3 — there is **no web version of the capture app**; browsers can't open
    the raw UDP sockets the PS5 needs, per DECISION),
  - an **email-capture** field,
  - the single fake-door offer (below) as a button that **records the click** with
    no payment behind it.
- **The fake-door offer (DECISION — locked, single + simple):**
  > "Single-team live race strategy that learns your car automatically —
  > **€9.99/season, up to 5 drivers**."
  Do **not** build tiered/seat-scaling pricing or a league/host tier into the fake
  door — those are future models; validate this one simple offer first.
- **Files created/changed:** a **standalone** landing page (not an in-app route) —
  e.g. `landing/index.html` (+ small JS/CSS). Keep it fully decoupled from the
  strategy app so it deploys independently. Add `docs/VALIDATION.md`.
- **Approach / choices (all locked in DECISIONS):**
  - **Hosting:** Cloudflare Pages. Keep it static and cheap.
  - **Language / i18n:** English, but built with the i18n strings layer so French +
    Dutch can be added later as strings files, not a rewrite.
  - **Email capture:** a **Tally form → Google Sheet**. Wire the capture field to
    the Tally form so leads land in the Sheet the owner reads.
  - **Analytics / click recording:** **Cloudflare Web Analytics** — track visits
    and the fake-door button clicks. Both the email submit and the fake-door click
    must fire distinct, attributable events (do not silently `console.log`).
  - **Privacy:** one consent line — "we'll only email you about this tool" —
    EU-friendly, data not shared.
  - **Product name:** PENDING — use a neutral placeholder and keep the brand string
    in one easily-swapped constant; do not bake an unchosen name throughout.
- **Tests:** none in the node suite (this is a static page). Manually verify the
  email submit reaches the Tally → Google Sheet, and the fake-door click registers
  in Cloudflare Web Analytics. Do **not** modify `tests/` or app logic; `npm test`
  stays green.
- **Acceptance:** The page renders, states the hook + CTA + the €9.99/season offer,
  offers the Windows app download, and both the email capture (→ Sheet) and the
  fake-door click (→ analytics) land as readable, attributable events — with no
  payment code anywhere.

### Then: validate (no more code until answered)

Create/maintain `docs/VALIDATION.md` with the build plan's three questions:
- Show the live "Now" view to 2–3 GT7 endurance teams/leagues — do they want it?
- Does the fake-door pricing button get real clicks when posted in sim-racing
  communities?
- Run a real mock endurance race — does the learner stay accurate enough live to
  trust the strategy? **Pass bar (DECISION):** predicted pit lap within **±1 lap**
  of optimal; fuel prediction error **under ~1 lap's worth** by stint end; **no
  accidental dry-running**. (Ties back to Phase 1 tolerances.)

**Put the tools down here.** If those land, *then* consider Phase 5. If they
don't, you've spent the minimum to find out.

### Phase-4 acceptance (from the build plan)

A working landing page with email capture + a fake-door price button that records
clicks, plus a written validation checklist — and a deliberate stop.

## Resolved decisions (from `docs/DECISIONS.md`) — folded into the tasks above

- **Offer:** single fake-door — "€9.99/season, up to 5 drivers". No tiers/seats.
- **Recording:** email → Tally form → Google Sheet; clicks/visits → Cloudflare Web
  Analytics.
- **Hosting:** Cloudflare Pages.
- **Form:** standalone page (not an in-app route), English, i18n-ready for
  French + Dutch later, with a Windows-app download button. **No web capture app**
  (browsers can't open the PS5 UDP sockets).
- **Privacy:** one consent line ("we'll only email you about this tool"),
  EU-friendly, data not shared.
- **Mock-race pass bar:** pit lap within ±1 lap of optimal; fuel error under ~1
  lap's worth by stint end; no accidental dry-running.

### Pre-launch checklist — do NOT guess (neither blocks building; both happen right before the page goes live)

- **Product name (PENDING — not chosen).** `Race-Strategies` is a placeholder repo
  name only. Do **not** hardcode a brand string in a hard-to-change way — keep it
  in one swappable constant. Candidate directions: Undercut, Boxbox,
  Stint/Stintwise, Pitwall, Pitboard. Before committing: check domain + trademark
  availability and avoid F1/brand-owned terms. Pick the final name right before the
  landing page goes live.
- **Code-signing cert (ties to Phase 3).** The Windows app linked from this page is
  unsigned during validation. **Before charging strangers (the €9.99 offer becomes
  real), buy a cert and ship a signed build** — an unsigned binary behind a paywall
  reads as sketchy and kills conversion.

> **Sequencing note:** the **concierge / Wizard-of-Oz trust test** (be the
> algorithm by voice in a team's live race) is a *separate, earlier* validation
> activity — it runs **before Phase 1**, not as part of this fake-door page. See
> `docs/DECISIONS.md` "Sequencing" and `phase-1.md` prerequisites. This phase's
> validation is the public fake-door + mock race; the concierge test already
> answered "assist vs automate" before any learner code was written.

## Risks / things likely to go wrong

- **Fake-door ethics/clarity.** The button must not feel like a bait-and-switch
  charge — clicking should lead to an honest "coming soon / join the list", not a
  broken checkout. Get the post-click message right.
- **Clicks that go nowhere.** If recording isn't wired to a sink the owner reads,
  the whole experiment yields no data. Verify the event actually lands.
- **Validating too early.** Showing the page before Phases 1–3 work means you're
  testing a promise, not the product. Sequence matters.
- **Scope creep into payments/accounts.** The temptation to "just add Stripe" or a
  login defeats the point. Hold the line: fake door only.
- **Coupling the landing page to the app** so it can't be shared without running
  the whole thing. Prefer a static, independently hostable page.

---

## Phase 5 — future / OUT OF SCOPE (stub only — do not plan or build)

Recorded here only so it isn't accidentally pulled forward. Consider **only if**
Phase 4 validation succeeds (teams want it + fake-door clicks + the learner proves
accurate in a real mock race):

- Distributed **multi-car** telemetry aggregation across machines.
- **Cloud server** for at-home / online leagues (no shared LAN).
- The **whole-field organizer board** (every car, race-control view).
- **F1-game support** (the pure `src/logic/` engine is designed to port; that's
  the reuse bet).

None of this is in the MVP. The build plan is explicit: build the part that
depends on nobody else first, validate, *then* decide. Do not create Phase 5 work
items from these plan files.
