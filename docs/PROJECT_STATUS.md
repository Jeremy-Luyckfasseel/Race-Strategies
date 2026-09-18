# Race-Strategies — Master Status & Checklist

One place to see everything: what's built, what's left, what's deferred, and what you can stop worrying about. Tick items as you go.

---

## Where you are right now (the honest one-liner)

You have a **working strategy engine and a working live-telemetry pipeline**, wrapped in a **developer-grade shell** (clone the repo, run a server, type in numbers by hand). It's a strong prototype — not yet a shippable or validated product. The hard, invisible part is done; the visible product part isn't.

## The mental model that removes the overwhelm

**The MVP is a LOCAL DESKTOP APP.** It runs on the user's machine, reads their PS5 on their own network, and computes strategy locally. Because of that:

- **No login system needed** — paying = a license key (handled by Gumroad / Lemon Squeezy), not accounts you build.
- **No server database needed** — strategy is computed live in memory; saving a session is just a local file.
- **No web app needed** — a browser can't read the PS5's telemetry, so the tool is a download. Only the marketing page is on the web (no login).

Login, cloud database, and web app all belong to the deferred **v2**, not now.

---

## ✅ DONE (the hard 60–70%)

- [x] Strategy engine — enumerates ~4,000 compound/pit patterns, simulates lap-by-lap, picks max-laps plan (pure JS, zero React)
- [x] Fuel-weight model + exact fuel carry-over
- [x] Piecewise tyre-degradation model
- [x] Multi-driver stint assignment with minimum drive-time guarantee
- [x] Mid-race recalculation
- [x] Live PS5 telemetry decode — Salsa20 UDP → WebSocket relay
- [x] LAN scan to auto-find PS5s
- [x] Live single-team dashboard (speed, RPM, pedals, tyre temp/wear, GPS track map)
- [x] Multi-team leaderboard (built for the deferred whole-field case)
- [x] Compound-confirm-on-pit prompt
- [x] Auto-fill of current lap + fuel from telemetry
- [x] Test suite — 1,715 assertions on the engine
- [x] `CLAUDE.md`, README, and the planning docs (build plan, DECISIONS, kill-the-idea brief)

---

## 🔨 TO DO — MVP (the validated single-team product)

### Do first (before building more)
- [ ] **10-minute log check:** open a telemetry capture — does the GT7 packet include the current **fuel map**? Is there an **on-track / in-race flag**? (Unblocks the learner and the "session active" logic.)
- [ ] **Validation test (the cheap one that decides everything):** sit in a team's Discord during a live race and *be the algorithm* — feed them strategy calls by voice/text. Do they follow, or override? This tells you whether teams want live automation *before* you build it.

### Phase 1 — Telemetry learner (the differentiator)
- [ ] Measure fuel-per-lap directly from tank deltas (traffic-proof)
- [ ] Learn the fuel-weight coefficient and degradation curve from clean laps
- [ ] Seed from a practice stint so it's never "blind" at the start
- [ ] **Propose-and-accept** UX — telemetry never silently overrides; it surfaces "measured X vs your Y — accept / ignore"
- [ ] Trust display — sample size + "volatile data" indicator
- [ ] Keep the one-tap compound prompt

### Phase 2 — In-race "Now" view
- [ ] A glanceable second-screen view: current plan, next action (pit lap, fuel to add), stint countdown, lift-and-coast / push prompt
- [ ] Live recalc from the learner, debounced, with a "freeze plan" toggle
- [ ] Make single-team the default; tuck the multi-team board into an "advanced" area

### Phase 3 — Packaging & onboarding (turn it into a product)
- [ ] Bundle UI + relay into one **Electron desktop app** (no terminal, no npm for the user)
- [ ] Auto-connect: find the PS5, detect session start, hold the connection with auto-reconnect
- [ ] First-run onboarding: detect → go (no manual inputs, since the learner derives them)
- [ ] **Local persistence** — save presets and sessions to a local file (this is your "database" for the MVP)
- [ ] Lightweight i18n scaffolding (English base; French + Dutch later as strings files)

### Phase 4 — Validation slice
- [ ] Standalone landing page (Cloudflare Pages, English) with a **download** button
- [ ] Fake-door "€9.99/season, up to 5 drivers" button
- [ ] Email capture (Tally → Google Sheet) + Cloudflare Web Analytics
- [ ] Run a real mock endurance race to check the learner stays accurate live

---

## 💳 TO DO — when you start charging (light, not scary)

- [ ] Sell via **Gumroad / Lemon Squeezy** — they handle payment and issue license keys
- [ ] App checks the license key on launch (this is the *only* "auth" the MVP needs — not a login system)
- [ ] Buy a **code-signing certificate** before charging strangers (so the installer doesn't trigger scary warnings)
- [ ] Choose the **product name** (kept in one swappable constant; check domain + trademark)

---

## 🌐 LATER — v2 (this is where login, database, and web live)

Explicitly **deferred**. Do not build these until the MVP is validated.

- [ ] Distributed multi-car server for at-home leagues (each driver runs an agent → central server)
- [ ] Cloud telemetry **database** (history, cross-session, multi-user)
- [ ] **User accounts / login** (needed once there's a real web app and cloud features)
- [ ] **Web** organizer / spectator whole-field board
- [ ] Cross-device sync
- [ ] F1-game support (richer telemetry, includes tyre compound)

---

## ❌ NOT NEEDED for the MVP — stop worrying about these

- **Login / user accounts** — it's a local desktop tool; paying = a license key, not an account.
- **Server / cloud database** — strategy is computed live in memory; saving = a local file.
- **A web version of the tool** — impossible (browsers can't read PS5 UDP); only the marketing page is on the web.
- **Cloud sync** — single device, local storage is enough.

---

## 👉 Your next three actions, in order

1. **The 10-minute log check** (fuel map + on-track flag) — closes two open decisions.
2. **The validation test** — be the algorithm in a team's Discord during a race.
3. **Start Phase 0 in Claude Code** (read the repo, write CURRENT_STATE + backlog), then begin Phase 1 (the learner).

Everything else can wait its turn. You're not behind — the hardest part is already behind you.