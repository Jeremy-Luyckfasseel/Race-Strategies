# PACKAGING.md — building the desktop app

> Phase 3, Task 3.2. How to turn this repo into a Windows desktop app a
> non-technical user can install and run with **no Node, npm, or terminal**.

## Distribution form — CONFIRMED: Electron (Task 3.0)

The app ships as an **Electron desktop app**, **Windows first** (macOS later).
Electron was chosen because it runs the **existing Node relay**
(`server/telemetry-server.js`) directly — UDP heartbeats + Salsa20 decode +
WebSocket — with no rewrite. The Electron main process spawns the relay as a
forked Node process and loads the built Vite UI; the two ship as one installer.

A hosted web version is **not** possible for the capture app: browsers can't open
the raw UDP sockets needed to read the PS5 (see `docs/DECISIONS.md` / Phase 4).

> **Product name is a placeholder.** `productName` / `appId` in `package.json`
> (`Race Strategies` / `com.placeholder.race-strategies`) are placeholders — pick
> the real name (see `docs/DECISIONS.md` "Product name") and swap both before any
> public launch.

## What's in the box

| Piece | Where |
|------|-------|
| Electron main process | `electron/main.cjs` (CommonJS — package is ESM) |
| electron-builder config | the `build` field in `package.json` |
| Built UI | `dist/` (from `npm run build`; Vite `base: './'` so assets load over `file://`) |
| Relay (run as-is) | `server/telemetry-server.js`, forked with `ELECTRON_RUN_AS_NODE=1` |

The relay and `ws` are kept **unpacked** from the asar (`asarUnpack` in the build
config) so the forked Node process can read the script and resolve `ws`.

## Build commands

```bash
npm install              # first time — pulls electron + electron-builder
npm run build            # produce dist/ (the UI)

npm run electron:build   # build dist/ then launch the app locally (no installer) — quickest sanity check
npm run pack             # build an UNPACKED app into release/ (fast, no installer) for a local smoke test
npm run dist             # build the Windows NSIS installer into release/
```

The installer lands in `release/` (git-ignored). Install it on a clean Windows 11
machine and confirm: it launches, starts the relay itself, and shows the UI — no
terminal, no `npm`.

### Develop against the live UI (hot reload)

```bash
npm run dev              # terminal 1 — Vite dev server on http://localhost:5173
# terminal 2 (PowerShell):
$env:VITE_DEV_SERVER_URL = "http://localhost:5173"; npx electron .
```

`electron/main.cjs` loads `VITE_DEV_SERVER_URL` when set and not packaged;
otherwise it loads `dist/index.html`.

## The dev workflow is unchanged

Packaging adds files but touches no app logic. From source, everything still works:

```bash
npm test                 # full node test suite
npm run dev              # Vite dev server
npm run telemetry        # run the relay standalone
```

## The two first-run pop-ups (do not conflate them)

A first launch on a fresh machine can show **two different** Windows prompts. They
have different causes and different fixes.

### 1. SmartScreen — "Windows protected your PC / unknown publisher"

- **Why:** the `.exe` is **not code-signed** by a trusted CA. We **ship unsigned
  for the MVP** by choice (`docs/DECISIONS.md` 3.3), so Windows shows the scary
  version. Click **More info → Run anyway**.
- **Confirmed non-blocking** for the free MVP audience — the GT7 sim community
  routinely clicks through this for unsigned tools (SimHub, CrewChief, Hector); see
  `docs/VALIDATION.md` 0.5.
- **Removing it (pre-paid-launch, the hard line):** buy a code-signing cert and
  sign **before charging strangers** — an unsigned binary behind the €9.99 paywall
  reads as sketchy and kills conversion. Nuance: an **OV** cert (~€100–400/yr) only
  *reduces* the warning (SmartScreen still warns until the app earns download
  reputation), whereas an **EV** cert (~€300–600/yr, hardware token) clears it
  **instantly** — so the pre-launch signing should likely be **EV**. NOT a build
  blocker for the MVP.

### 2. Windows Firewall — "allow network access"

- **Why:** the relay binds UDP sockets (33739/33740) and a WebSocket (20777); any
  networked app triggers this. **Signing does NOT remove it** — it fires for signed
  apps too.
- **What to do:** let the user click **Allow** (pair with the in-app firewall
  explainer from Task 3.3), or add a firewall rule at install time (needs admin
  elevation). Letting the prompt happen is the normal path. This one stays
  regardless of cert status.

## Ports used by the relay

- UDP **33740** — receive GT7 telemetry from the PS5
- UDP **33739** — send heartbeats to the PS5
- WebSocket **20777** — relay → browser/renderer

If a port is busy (another copy already running), the relay will fail to bind —
close the other instance.

## Salsa20 key — can break a shipped binary

GT7 telemetry is Salsa20-encrypted with a community-documented key, hard-coded in
`server/telemetry-server.js`. **A GT7 game update can change this key and silently
break decoding** in an already-shipped installer (the app will connect but show no
data). If telemetry goes blank after a GT7 patch, update the key in
`server/telemetry-server.js` and ship a new build. This is the single most likely
cause of a "stopped working" report.

## Notes / known rough edges (build is not yet run in CI)

- The electron-builder config bundles all production `dependencies`; only `ws` is
  needed at runtime by the relay (React/Recharts are already compiled into `dist/`).
  Harmless, but the install is larger than strictly necessary — prune later if size
  matters.
- The Windows installer build has **not** been produced/smoke-tested in this
  environment; run `npm run dist` on Windows 11 to verify, then update this note.
- macOS packaging (a `mac` target + notarization) is a later task.
