# Race-Strategies — Resolved Decisions (source of truth)

For Claude Code. These are the locked decisions for the MVP. Read this alongside `CLAUDE.md`, the build plan, and `docs/CURRENT_STATE.md` whenever generating or executing a phase. **Where an item is marked PENDING or (confirm), do NOT guess — ask the human before implementing that part.**

---

## Product scope (locked)

- **MVP = single-team / single-car / local, GT7 on PS5, with strategy inputs auto-derived from live telemetry.**
- **OUT of scope for now (future Phase 5 only — do not build):** distributed multi-car aggregation, cloud server for at-home leagues, the whole-field/organizer board, F1-game support.
- The single-team product must work with no servers and no cooperation from anyone else.

---

## Phase 1 — telemetry learner

1. **Fuel-weight effect:** linear, a single scalar (s/L). Do not model taper. Learn the scalar per track by regressing clean-lap time against fuel load within a stint. Seed at 0.03 s/L; plausible range ~0.02–0.05 (longer track → higher).
2. **Tyre-degradation shape:** keep the engine's existing 3-point **piecewise** model (start / half / end) — note it *bends* and can represent an accelerating drop-off, so it is **not** a flat linear approximation. Crucially, because `tireLife` is a user input (item 3), the model only ever covers the **usable window before the cliff** — the cliff lives beyond the lap count you run to, so the optimizer isn't built on a broken assumption. **One concession:** add a **conservative safety margin near `tireLife`** (the model under-warns at the very edge if a team stretches a stint to the limit) and note the cliff as a **known limitation**. The learner only *estimates* the three points from clean laps. Richer/non-linear curve stays **post-MVP**; do not extend the engine now.
3. **`tireLife`:** stays a **user input**. The learner fits the degradation curve only within it. (Future enhancement: learner *suggests* a tireLife — not MVP.)
4. **Degradation x-axis:** index by **lap-count-since-stint** (clean, deterministic). Use radius-derived tyre wear only as a secondary corroborating signal, never the primary axis.
5. **Signal robustness — which outputs need clean laps:**
   - **Fuel consumption is measured directly from tank deltas** (fuel used ÷ laps), **not** from lap times — so it is **traffic-proof** and stays accurate even in a chaotic stint. This is the load-bearing number ("fuel to the flag / when must I pit") and it does **not** require clean laps.
   - Only **two second-order refinements need clean laps:** the fuel-**weight** coefficient and the **degradation curve**. The learner is therefore *not* "blind in traffic" — its most important output is robust regardless.
   - **Seed from a practice/qualifying stint** so the learner is never starting cold (endurance teams practice).
   - **Accept clean laps even when non-consecutive.**
   - **Widen the confidence band in chaos** and surface a "highly volatile" indicator rather than hiding it.
   - **Lap-time cleaning (for the two refinements only):** discard out-lap, in-lap, first flying lap, paused laps, off-track/penalty laps. Outlier rule: drop laps slower than the stint's clean median by more than ~3% (traffic/mistakes) and any implausibly fast lap. Confidence: fuel-per-lap usable after ~3 laps (tank-delta); trust the degradation curve only after ~6–8 clean laps spanning enough of the stint. Traffic isn't reliably auto-detectable without opponent-proximity data — the median filter is the safety net.
6. **Tolerances** — keep in a **single config object with synthetic-test thresholds and live-trust thresholds clearly separated and commented**, so loosening live behaviour after seeing real noise never accidentally weakens the test thresholds (that separation is the whole safety of the "one-line change"). Synthetic-recovery tests (clean data, tight): ±0.05 L/lap, ±0.003 s/L, ±0.15 s/lap. Live-trust thresholds (noisy): ±0.1 L/lap, ±0.005 s/L, ±0.3 s/lap. **Tune after seeing real residuals** from actual stints.
7. **Override UX — PROPOSE & ACCEPT (revised; supersedes the earlier "silent auto-fill" call).** The **manual numbers stay the active strategy and the source of truth.** Telemetry **never silently overrides** anything. The learner runs in the background; when it is confident, it **surfaces a recommendation** — e.g. "measured 3.12 L/lap vs your 3.40 — Accept / Ignore" — and the human makes the call. This fixes both the black-box trust problem and the flicker problem in one move, and keeps the human's agency. Pair it with a **trust display** on every learned value: sample size + volatility / confidence band (incl. the "highly volatile" state). *(Why the change: silent auto-fill is a black box; under pressure teams distrust it and revert to their spreadsheet. Propose-and-accept is assist-not-automate.)*
8. **Fuel map:** do **not** force `fuelMap=1.0`. Learn `litersPerLap` at whatever map is actually running; keep `fuelMap` as a separate what-if lever. **PENDING:** check whether the GT7 packet exposes the current fuel map. If it does, read it; if not, the user declares it and the learner re-learns when it changes.

---

## Phase 2 — in-race loop

1. **Margin unit = laps of fuel.** Tight = projected to finish the stint with under ~1 lap of margin → "lift and coast." Surplus = over ~2 laps → "you can push." Calm, factual wording; not naggy. Thresholds tunable.
2. **Live plan source (aligned with propose-and-accept):** the **active strategy is computed from the accepted/manual inputs**, not silently from raw learner output. It recalculates when the user edits a field or **accepts** a learner recommendation; the learner's proposals surface alongside but don't auto-apply. Keep a "freeze plan" toggle so nothing shifts mid-corner. (This replaces the earlier "auto-recalc from learner inputs by default" — the learner proposes, the human accepts.)
3. **Pit-now trigger:** earliest-of (planned pit lap, fuel-exhaustion lap, tyre-wear threshold), with the reason shown ("box: fuel" / "box: tyres" / "box: plan").
4. **Audio callouts — CONFIRMED OUT of MVP.** Polish, not core value — it also drags in TTS, mute states, and language handling not needed yet. The visual "now" view + propose-and-accept *is* the product. Add later only if validation shows demand. (If ever added: default muted, opt-in, events = box-this-lap + fuel-target, language follows i18n.)
5. **Layout:** a dedicated full-screen race view, separate from the configuration tabs (must be glanceable on a second screen).

---

## Phase 3 — packaging & onboarding

1. **Distribution — CONFIRMED: Electron desktop app.** Reuses the existing Node relay directly (UDP + Salsa20 + WebSocket), bundling UI + relay into one installable app — no terminal, no npm for the user. (Tauri considered and deferred: it would force a Node sidecar or a Rust rewrite of the decode.) Accepted trade-off: larger install + more memory than Tauri — fine for MVP. **Note:** the red-team's "Electron penalty" was really about *unsigned* binaries (item 3), not the framework — Electron itself is the right call.
2. **Target OS:** Windows first; macOS later.
3. **Code signing — CONFIRMED: ship unsigned for MVP, with a hard line.** Early league testers click through the Windows SmartScreen "unknown publisher" warning (a short "click More info → Run anyway" guide is enough — this hobby installs unsigned tools like SimHub, CrewChief, Hector constantly). **The hard line:** the moment you move from a handful of friends to a **paid public launch, buy the cert.** An unsigned binary behind a €9.99 paywall reads as sketchy and quietly kills conversion. Unsigned through validation; **signed before you charge strangers** (see pre-launch checklist).
4. **Auto-connect:** auto-pick a PS5 only when exactly one is found; if multiple, prompt the user to choose. Reconnect with exponential backoff (1s → 2s → 4s … cap ~15s), retrying for the whole session.
5. **"Session active" = on track AND moving** (not just "any packet"; menus can emit packets). **RESOLVED by code inspection:** the GT7 packet **does** expose an on-track flag — `server/telemetry-server.js` already parses `onTrack` (byte `0x8E`, bit `0x01`) and broadcasts it. Use `onTrack` AND sustained speed > ~5 km/h. No parser change needed; a live log check can confirm behaviour but is not a blocker.
6. **Onboarding:** bare detect → go (the learner derives the model live, so no telemetry inputs are required up front). Tagging car/track is optional.
7. **Firewall UX:** show a one-line in-app explainer ("Windows will ask to allow network access — click Allow so we can read your PS5"), then let the standard Windows Defender prompt happen.

---

## Phase 4 — validation slice

- **Hosting:** Cloudflare Pages.
- **Landing page:** standalone (not an in-app route), English, built with i18n so French + Dutch are added later as strings files. Includes a **download button for the Windows desktop app.**
- **No web version of the capture app.** Browsers cannot open the raw UDP sockets needed to read the PS5, so the capture app must be the local desktop app. (A hosted *organizer/spectator* web board is possible only in the future v2, because it would receive data from a server, not a console.)
- **Fake-door offer to test (single, simple):** "Single-team live race strategy that learns your car automatically — **€9.99/season, up to 5 drivers**." Do **not** build the tiered/seat-scaling pricing or the league/host tier into the fake door — those are future models; validate the one simple offer first.
- **Email capture:** Tally form → Google Sheet.
- **Analytics:** Cloudflare Web Analytics (track visits + button clicks).
- **Privacy:** one consent line ("we'll only email you about this tool"), EU-friendly, data not shared.
- **Mock-race "accurate enough" bar:** predicted pit lap within ±1 lap of optimal; fuel prediction error under ~1 lap's worth by stint end; no accidental dry-running.

---

## Sequencing — validation moves ahead of Phase 1 (revised)

Two cheap experiments run **before / alongside Phase 1**, ahead of building the learner:

- **Concierge / Wizard-of-Oz trust test (do this FIRST — before writing learner code).** Sit in a team's Discord during a live race and **be the algorithm**: feed strategy calls by voice/text and watch whether they follow or override. For one evening and zero code this answers the make-or-break question both red-teams circle — **do teams want live automation, or just a better static planner (assist vs automate)?** If they keep overriding ("the data doesn't know I'm saving tyres behind this slow car"), you've learned the product must be **assist-not-automate** *before* spending build effort. This directly validates the propose-and-accept design.
- **SmartScreen audit (cheap, run early).** Watch how testers handle the unsigned-app warning (on our build or a comparable unsigned sim tool). Confirms the install friction is click-through, not a wall, before committing to packaging polish.

## Compound handling — MVP scope

- **Keep the unmissable one-tap pit-stop compound prompt as the MVP** (GT7 doesn't expose compound; the user confirms it after each stop — existing `useCompoundDetector` flow).
- The telemetry "did you pick the wrong compound?" validator is a **v1.5** nicety — it needs degradation footprints you won't have early, so **do not gate the MVP on it.**

## Internationalization

English is primary. Wire in lightweight i18n from the start so adding French and Dutch is just a strings file, not a rewrite.

---

## Product name

**PENDING — not chosen.** `Race-Strategies` is a placeholder repo name only; do not hardcode a brand string in a way that's hard to change later. Candidate directions (racer-resonant): **Undercut**, **Boxbox**, **Stint / Stintwise**, **Pitwall**, **Pitboard**. Before committing: check domain availability and trademarks, and avoid any F1/brand-owned terms.

---

## Status of previously-open items (now resolved)

- **1.8 — RESOLVED (by inspection):** GT7 packet does **not** expose fuel map (server parses only fuel ratio 0x44 + capacity 0x48). Fuel map is user-declared; learner re-learns `litersPerLap` on change.
- **3.5 — RESOLVED (by inspection):** on-track flag **exists** (`onTrack`, 0x8E bit 0x01, already broadcast). Use it.
- **2.4 — CONFIRMED:** audio callouts **OUT** of MVP.
- **3.1 — CONFIRMED:** Electron is the distribution form.
- **3.3 — CONFIRMED:** ship unsigned for MVP; sign before any paid public launch.
- **1.6 — CONFIRMED approach:** tolerances as a single config object (synthetic-test vs live-trust thresholds separated + commented); retune after the first real stints.

## Pre-launch checklist (NOT build blockers — neither is on the critical path; both happen right before public launch)

- **Product name** — final choice. Placeholder + one swappable constant for now. Shortlist: **Undercut / Boxbox / Stint(wise) / Pitwall / Pitboard**. Only gate: domain free + not trademarked, avoid F1/brand-owned terms. Pick it right before the landing page goes live.
- **Code-signing cert** — buy and sign **before** charging strangers (€9.99 paywall behind an unsigned binary kills conversion). Unsigned is fine through friends-and-league validation.
