# Phase 3 — Packaging & onboarding

> **Standalone context.** One of five phase plans derived from
> `Race-Strategies-Claude-Code-Build-Plan.md`. You may have no memory of writing
> it. **Before coding, read `CLAUDE.md`, `docs/DECISIONS.md` (locked answers), and
> `docs/CURRENT_STATE.md`** — note in particular that the telemetry relay
> (`server/telemetry-server.js`) is a separate Node process from the Vite app, and
> there is currently **no auto-connect / no auto-reconnect** (CURRENT_STATE §5).
> The product is a single-team / single-car / local GT7 strategy tool. Cloud /
> multi-car / F1 are out of scope (Phase 5 stub).
>
> Goal: close the biggest real adoption gap — today the app needs clone + npm + a
> manually-run relay + firewall. A non-developer can't run it. Fix that.
>
> **Distribution is CONFIRMED: an Electron desktop app, Windows first, shipped
> unsigned for the MVP** (per `docs/DECISIONS.md`). **Hard line:** ship unsigned
> through friends-and-league validation, but **buy a code-signing cert and sign
> before any paid public launch** — an unsigned binary behind a €9.99 paywall
> kills conversion. A cheap **SmartScreen audit** (watch how testers handle the
> unsigned warning) runs early, before/alongside Phase 1. If `docs/DECISIONS.md`
> and this file disagree, `DECISIONS.md` wins.

## Objective (what's true when this phase is done)

1. On launch the app **auto-connects**: scans the LAN for an active GT7 PS5
   (reusing the existing scan), detects when a session becomes active from the
   stream, connects, and holds the connection with **auto-reconnect** on drop. The
   user does not normally type IPs or press connect.
2. The app is **packaged** per the owner's chosen distribution form so a
   non-technical user can install and run it without Node, npm, or a terminal.
   Build instructions live in `docs/PACKAGING.md`.
3. A minimal **first-run onboarding** flow: detect PS5 → confirm car/track (or
   auto) → go. No manual telemetry inputs required (Phase 1 learns them).
4. Existing tests stay green; the relay's protocol with the browser is unchanged
   or extended backward-compatibly.

## Prerequisites

- Phase 0 (guardrails) done.
- **Task 3.0 distribution decision: CONFIRMED — Electron desktop app.**
- Phase 1 (learner) strongly recommended first, because onboarding's "no manual
  inputs" promise depends on the learner filling them. Phase 2 ("Now" view) is the
  natural thing the packaged app opens into.

## In scope / Out of scope

**In scope:**
- Auto-connect / auto-reconnect logic in `src/hooks/useTelemetry.js` (and a thin
  orchestration layer in `App.jsx`).
- Reusing the existing server-side LAN scan (`{type:'scan'}` → `scanResult`).
- Bundling UI + relay into one installable artifact (per chosen form).
- `docs/PACKAGING.md` with reproducible build steps.
- A first-run onboarding component/flow.

**Out of scope — do NOT touch / build:**
- The Salsa20 decode, packet parser, or strategy/learner maths.
- Multi-PS5 / multi-team auto-management (single car is the target; the scan may
  find several but onboarding picks one).
- Cloud hosting of telemetry, accounts, payments (Phase 4 is a fake-door only).
- Rewriting the relay in another language unless the chosen distribution form
  requires it (e.g. Tauri sidecar) — if so, that's a deliberate, owner-approved
  sub-task.

## Tasks

### Task 3.0 — Distribution form (CONFIRMED: Electron)

- **Decision (confirmed):** ship as an **Electron desktop app**. It reuses the
  existing Node relay directly (UDP + Salsa20 + WebSocket), bundling UI + relay
  into one installable app — no terminal, no npm for the user. Tauri was considered
  and deferred (it would force a Node sidecar or a Rust rewrite of the decode).
  Accepted trade-off: larger install + more memory than Tauri — fine for MVP. A
  hosted web UI is **not viable for capture** — browsers can't open the raw UDP
  sockets the PS5 needs (see Phase 4 / DECISIONS). Note: the red-team's "Electron
  penalty" was really about *unsigned* binaries (Task 3.2), not the framework.
- **Output:** record this choice at the top of `docs/PACKAGING.md`.

### Task 3.1 — Auto-connect flow

- **What to build:** On launch: auto-scan the LAN for an active GT7 PS5 (reuse the
  existing `scan`), auto-detect when a session becomes active from the telemetry
  stream, auto-connect to it, and auto-reconnect if the socket drops.
- **Files changed:** `src/hooks/useTelemetry.js` (add reconnect + maybe an
  `autoConnect` helper); `src/App.jsx` (kick off auto-connect on mount); possibly
  `TelemetryControls.jsx` to show "auto" status and allow manual override.
- **Approach:**
  - On mount, connect to the relay (default `ws://localhost:20777`), trigger a
    `scan`. **Auto-pick only when exactly one PS5 is found (DECISION 4)**; if
    multiple candidates return, prompt the user to choose (don't guess). `setIPs`
    to the chosen one.
  - **"Session active" = `onTrack` AND moving (DECISION 5).** Use the existing
    `onTrack` flag the relay already emits (bit `0x01` of byte `0x8E`, parsed in
    `server/telemetry-server.js` — confirmed present, no parser change needed)
    combined with sustained speed > ~5 km/h. Menus can emit packets, so "any
    packet" is **not** enough.
  - **Auto-reconnect (DECISION 4):** on `ws.onclose`/`onerror`, retry with
    **exponential backoff 1s → 2s → 4s … capped ~15s**, retrying for the whole
    session, unless the user explicitly disconnected. Today `onclose` just sets
    `connected=false` — replace with a guarded reconnect loop and clean teardown in
    the effect cleanup.
  - Keep a manual override path (enter IP / pick from scan) for the non-default
    case.
- **Tests:** the WebSocket logic is browser-side and not in the node suite. Add
  any *pure* helper you extract (e.g. backoff schedule, "is this packet an active
  session?") to a node test. Manually verify reconnect by killing/restarting the
  relay. Keep `npm test` green.
- **Acceptance:** With the relay running and a PS5 streaming, a fresh launch
  connects and shows live data **without** the user typing an IP or pressing
  connect; killing and restarting the relay reconnects automatically; an explicit
  user disconnect stays disconnected.

### Task 3.2 — Package it

- **What to build:** Wrap the app as an **Electron** desktop app so a
  non-technical user installs and runs it with no Node/npm/terminal. Produce
  `docs/PACKAGING.md`.
- **Files changed:** Electron `main.js` (or `electron/main.js`), preload if
  needed, electron-builder config, `package.json` scripts, `docs/PACKAGING.md`.
  Avoid touching app logic.
- **Approach (Electron, DECISION 1):**
  - The Electron main process spawns `server/telemetry-server.js` as a child
    process (the relay runs **as-is** — that's the reason Electron was chosen) and
    loads the built Vite `dist/`.
  - Bundle with electron-builder for **Windows first** (DECISION 2); macOS later.
  - The relay's UDP 33739/33740 + WS 20777 must work from inside the packaged
    context; first launch will trigger the Windows Defender network prompt — pair
    it with the in-app explainer from Task 3.3's firewall note.
  - **Ship unsigned for the MVP (DECISION 3) — with a hard line.** Early league
    testers click through the SmartScreen "unknown publisher" warning (this hobby
    installs unsigned tools like SimHub, CrewChief, Hector all the time). Ship a
    short "click More info → Run anyway" guide in `PACKAGING.md`. **Hard line: buy
    a code-signing cert and sign before any *paid public launch*** — an unsigned
    binary behind the €9.99 paywall reads as sketchy and quietly kills conversion.
    Unsigned through validation; signed before charging strangers.
  - Note in `PACKAGING.md` where the **Salsa20 key** lives, since a GT7 update can
    change it and silently break a shipped binary.
- **Tests:** build the installer on Windows 11 (the dev environment) and
  smoke-launch it. Document the exact build command in `PACKAGING.md`. Existing
  `npm test` must still pass from source, and `npm run dev` + `npm run telemetry`
  must still work for development.
- **Acceptance:** A produced Windows installer launches on a clean machine, starts
  the relay itself, and shows the UI — no terminal, no `npm`. `docs/PACKAGING.md`
  reproduces the build and documents the unsigned-app warning.

### Task 3.3 — First-run onboarding

- **What to build:** A minimal first-run flow: **detect PS5 → go (DECISION 6:
  bare detect → go)**. No manual telemetry inputs (Phase 1 learns them); tagging
  car/track is optional.
- **Files changed:** `src/components/Onboarding.jsx` (new); `src/App.jsx` (show on
  first run, gate by a localStorage flag); minimal styles.
- **Approach:** On first launch (no saved state), show the **firewall explainer
  (DECISION 7)** — one line: "Windows will ask to allow network access — click
  Allow so we can read your PS5" — then let the standard Windows Defender prompt
  happen. Run the auto-scan, show the detected PS5, optionally let the user pick a
  car preset (from `CAR_PRESETS`) / name the track, then drop them into the
  full-screen "Now" view (Phase 2). Persist a "done" flag so it doesn't reappear.
  Everything beyond detect → go is skippable.
  - **i18n:** onboarding copy goes through the i18n layer (English primary).
- **Tests:** none required (UI). Lint + `npm test` green.
- **Acceptance:** A first-time user is walked from "nothing" to live strategy in a
  few clicks, with no telemetry numbers to type.

### Phase-3 acceptance (from the build plan)

A friend who has never seen the repo can install it, open it, and get a live
strategy during a race without touching a terminal.

## Resolved decisions (from `docs/DECISIONS.md`) — folded into the tasks above

1. **Distribution: CONFIRMED** Electron desktop app (reuses the Node relay
   directly; larger install/memory than Tauri accepted for MVP).
2. **Target OS:** Windows first; macOS later.
3. **Signing: CONFIRMED unsigned for MVP — hard line:** buy a cert and **sign
   before any paid public launch** (unsigned is fine through league validation).
4. **Auto-connect:** auto-pick only when exactly one PS5 is found; otherwise
   prompt. Reconnect with exponential backoff 1s→2s→4s… cap ~15s, all session.
5. **"Session active" = `onTrack` AND moving** (use the existing `onTrack` flag +
   speed > ~5 km/h; "any packet" is insufficient).
6. **Onboarding:** bare detect → go; car/track tagging optional.
7. **Firewall UX:** one-line in-app explainer, then the standard Windows prompt.

**SmartScreen audit (run early, before/alongside Phase 1):** a cheap test —
watch how testers handle the unsigned-app warning (on our build or a comparable
unsigned sim tool) to confirm the friction is click-through, not a wall, before
investing in packaging polish. See `docs/DECISIONS.md` "Sequencing".

### Still open — do NOT guess

- **Code-signing cert (pre-launch, NOT a build blocker):** buy + sign right before
  the paid public launch — not on the critical path for building the MVP.
- **3.5 (resolved by inspection):** the on-track flag **does** exist
  (`onTrack`, byte 0x8E bit 0x01) — no packet/parser work needed. A live log check
  can confirm behaviour, but don't block on it.

## Risks / things likely to go wrong

- **Bundling a UDP-binding Node server inside a desktop shell is fiddly** —
  port conflicts, firewall prompts, the sidecar not starting, path issues in the
  packaged context. Budget time for platform-specific debugging.
- **Auto-reconnect storms.** A naive reconnect loop can hammer the socket; use
  capped backoff and respect explicit user disconnect.
- **Auto-pick wrong PS5.** On a network with several PS5s the scan may grab the
  wrong one. Single-candidate-auto / multi-candidate-ask avoids surprise.
- **Signing / OS gatekeeper friction** can undermine the whole "non-technical
  friend installs it" goal even if the build works.
- **Salsa20 key drift** (a GT7 update) will break a shipped binary silently —
  note in `PACKAGING.md` where to update the key.
- **Don't regress the dev workflow.** `npm run dev` + `npm run telemetry` must
  still work from source after packaging is added.
