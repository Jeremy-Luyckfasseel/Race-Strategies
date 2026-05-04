# GT7 Endurance Race Strategy Calculator

A fast, accurate web app for planning optimal pit strategies in **Gran Turismo 7** endurance races. Enter your car's fuel and tyre data, and the calculator enumerates every valid compound/stint combination to find the fastest race plan — accounting for fuel weight, tyre degradation, pit stop timing, and multi-driver minimum time requirements.

It also supports **live GT7 telemetry** from one or more PS5s on the same local network, so you can monitor all cars in real time during a race event.

---

## Features

- **Full strategy enumeration** — checks every valid pit/tyre combination up to 50 stints deep. Faster to spam Softs 20 times than run Hards? It finds that.
- **Fuel weight model** — the sim corrects lap times for a lighter car as fuel burns. Enter times from a full tank; the engine handles the rest.
- **Exact fuel carry-over** — leftover fuel from a stint is correctly rolled into the next, shortening refuel time.
- **Pit window bands** — visualised on the stint timeline so you always know the latest safe lap to pit.
- **Multi-driver support** — per-driver lap times per compound, configurable minimum drive time per driver, greedy assignment to meet minimums.
- **Mid-race recalculation** — enter your current lap and fuel to get an updated strategy on the fly.
- **Live GT7 telemetry** — connect to all PS5s in the room simultaneously. See every team's lap, fuel, speed, and last lap time in real time.
- **Strategy export** — print the full stint plan via the browser print dialog.

---

## Getting started

### Requirements

- [Node.js](https://nodejs.org/) 18 or newer

### Install

```bash
git clone https://github.com/Jeremy-Luyckfasseel/Race-Strategies.git
cd Race-Strategies
npm install
```

### Run the app

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

### Build for production

```bash
npm run build
```

Output goes to `/dist`.

---

## GT7 Live Telemetry

### How it works

GT7 streams live UDP telemetry from the PS5 to any machine on the same local network. The flow is:

1. A small relay server (`telemetry-server.js`) runs on your laptop.
2. The server sends a heartbeat packet to each PS5 every 100 ms on **port 33739**. This tells GT7 to start streaming.
3. GT7 responds by sending encrypted UDP packets to **port 33740** on your machine. The server decrypts them (Salsa20 cipher, community-documented key) and parses the data.
4. The parsed data is forwarded over WebSocket to the browser on **port 20777**.
5. The browser UI shows live cards for each PS5: current lap, fuel remaining, speed, last lap time, and pit/on-track status.

All of this is local network traffic — it does not touch Sony's servers and works regardless of what game mode the PS5 is in.

### Does it work in private online multiplayer?

**Yes.** GT7 sends telemetry locally from the PS5 to your machine, independent of how the online session is routed. Whether you are in single-player, a private lobby, or a Sport Mode custom race makes no difference — as long as the PS5 and the laptop are on the same LAN, telemetry works.

This means you can run **all 10 PS5s in the same room** (connected to the same router/switch), start one relay server on one laptop, and monitor every car simultaneously.

### Setup — step by step

**1. Start the relay server**

```bash
npm run telemetry
# or: node server/telemetry-server.js
```

No arguments needed. The server starts listening and waits for the browser to tell it which PS5s to track.

**2. Open the app and connect**

In the sidebar, scroll to **GT7 Live Telemetry**. You will see:

- A list of IP address fields — one row per PS5. Use **+ Add PS5** to add more rows.
- A server URL field (default `ws://localhost:20777` — leave it if the server is on the same machine).
- A **Connect** button.

Fill in the IP addresses, then click **Connect**. The browser sends the IP list to the relay server, which immediately starts heartbeating those addresses. PS5 cards appear in the UI as data arrives.

**3. Find a PS5's IP address**

On the PS5: **Settings → Network → View Connection Status → IP Address**

Write down each team's IP before the event starts. That takes about 30 seconds per team.

**4. Auto-fill mid-race data (optional)**

Enable **Mid-Race Recalculation** in the sidebar, then click a team's card in the telemetry section to select it. The app will automatically update *Current Lap* and *Fuel Remaining* from that team's live data every time a new packet arrives, so the strategy recalculates in real time.

### IP addresses vs PS5 console names

The relay server sends UDP packets to whatever address you type. Node.js will resolve hostnames using the system DNS resolver, which on most home networks includes **mDNS** — the `.local` protocol. So `PS5-Jeremy.local` *may* work if mDNS is available.

**However, use IP addresses for events.** Here is why:

- mDNS relies on multicast traffic. Managed switches and venue Wi-Fi often block it, so hostnames silently fail to resolve.
- The PS5's exact mDNS hostname may not match the console name you see on screen.
- IP addresses never depend on the network configuration.

If you want to verify that a hostname works on your network, open a terminal and run:

```
ping PS5-Jeremy.local
```

If it responds, the hostname will work in the app too. If it times out, use the IP.

### Network requirements

| Requirement | Detail |
|---|---|
| Same local network | PS5 and laptop must be on the same router/switch |
| Laptop firewall | Allow UDP inbound on port 33740 and outbound on 33739 |
| No extra hardware on PS5 | Nothing to install — GT7 streams telemetry natively |
| Router/switch | Basic home equipment works; managed switches may need multicast enabled for mDNS (but mDNS is optional — see above) |

---

## Testing

The strategy engine has no React dependency and can be tested directly with Node:

```bash
npm test                       # Full suite — 129 tests
npm run test:smoke             # Basic 1-hour race smoke test
```

---

## Architecture

```
App.jsx  (state: inputs, selectedIndex, telemSelectedIp)
  ├── InputPanel        — race parameters, tyre compounds, drivers, live telemetry UI
  ├── useStrategy       — debounced wrapper around findBestStrategies()
  ├── useTelemetry      — WebSocket connection to telemetry relay server
  ├── ResultsSummary    — KPI strip + strategy comparison cards
  ├── StrategyTimeline  — Recharts bar chart with pit window bands
  └── StintTable        — lap-by-lap stint detail

src/logic/strategy.js          — pure JS engine, no React dependency
server/telemetry-server.js     — Node.js UDP relay server (run separately)
```

---

## Tech stack

- React 19, Vite, Recharts
- Pure JS strategy engine (testable with `node`)
- Native browser WebSocket (no extra browser dependencies)
- `ws` package for the relay server WebSocket
