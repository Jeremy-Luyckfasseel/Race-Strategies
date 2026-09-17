<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0d1117,30:1c0d00,60:2e1a00,100:0d1117&amp;height=270&amp;text=GT7%20RACE%20STRATEGY&amp;desc=Fuel%20%E2%80%A2%20Tyres%20%E2%80%A2%20Pit%20Windows%20%E2%80%A2%20Live%20PS5%20Telemetry&amp;fontColor=FFD700&amp;fontSize=58&amp;fontAlignY=42&amp;descAlignY=64&amp;descSize=18&amp;descColor=c9a227&amp;animation=fadeIn" width="100%"/>

<br>

![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite_7-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript_ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![PlayStation](https://img.shields.io/badge/PS5_Telemetry-003087?style=for-the-badge&logo=playstation&logoColor=white)

<br>

> **Endurance race strategy calculator for Gran Turismo 7.**
> Enumerates every valid tyre-compound sequence, simulates each race lap‑by‑lap,
> and surfaces the plan that maximises your lap count — optionally driven by
> live PS5 telemetry for real-time mid-race recalculation.

<br>

![Tests](https://img.shields.io/badge/tests-1983%20assertions%20passing-FFD700?style=flat-square&logoColor=black)
![Engine](https://img.shields.io/badge/strategy%20engine-pure%20JS%20%C2%B7%20zero%20React-c9a227?style=flat-square)
![Patterns](https://img.shields.io/badge/compound%20patterns-~4%20000%20enumerated-c9a227?style=flat-square)

</div>

<br>

---

<a id="table-of-contents"></a>
<img src="https://capsule-render.vercel.app/api?type=rect&amp;color=0:0d1117,100:2e1a00&amp;height=40&amp;text=◈%20TABLE%20OF%20CONTENTS&amp;fontColor=FFD700&amp;fontSize=16&amp;fontAlign=14&amp;fontAlignY=62" width="100%"/>

<br>

- [Race Specifications](#race-specifications)
- [Under the Hood — Strategy Engine](#under-the-hood)
- [Pit Wall — Live PS5 Telemetry](#pit-wall)
- [Pole Position Setup](#pole-position-setup)
- [Pre-Race Briefing](#pre-race-briefing)
- [Quality Control — Tests](#quality-control)
- [Technical Regulations — Architecture](#technical-regulations)
- [Power Unit — Tech Stack](#power-unit)

<br><br>

<a id="race-specifications"></a>
<img src="https://capsule-render.vercel.app/api?type=soft&amp;color=0:2e1a00,100:0d1117&amp;height=50&amp;text=◈%20RACE%20SPECIFICATIONS&amp;fontColor=FFD700&amp;fontSize=18&amp;fontAlign=15&amp;fontAlignY=62" width="100%"/>

<br>

| Feature | What it means at race pace |
| :--- | :--- |
| **Full strategy enumeration** | Every valid pit + compound sequence tested — up to 5-element patterns, ~4 000 combinations for 5 compounds, each tried both as a repeating cycle (H,S → H,S,H,S…) and holding the last compound (H,S → H,S,S,S…). Covers single-compound, alternating, and "soft start then settle on a hard for the rest of the race" strategies alike. If spamming Softs beats running Hards, it finds that. |
| **Fuel weight model** | Corrects per-lap time for a progressively lighter car as fuel burns. Enter your times at full tank — the engine handles the conversion every lap. |
| **Exact fuel carry-over** | Leftover fuel from a stint is rolled into the next refuel calculation, so you never top up more than necessary. |
| **Pit window bands** | Visualised on the strategy timeline. Always see the absolute latest lap you can pit without running dry or destroying tyres. |
| **Multi-driver support** | Per-driver lap times per compound, configurable minimum drive time. Two stint-assignment strategies run per plan — one picks stint-by-stint by who owes the most, the other allocates the longest stints first — and the engine keeps whichever leaves every driver furthest from falling short. Works reliably with reasonable slack (minimums comfortably under an even split of the race); a minimum set right at the theoretical maximum a driver could get can still leave them a little short — that's the race's stint lengths not dividing evenly, not the assignment. |
| **Mid-race recalculation** | Enter current lap + fuel for an updated strategy on the fly. Connects directly to live PS5 telemetry for automatic updates. |
| **Live PS5 telemetry** | Full Télémétrie tab: dedicated live dashboard per team with speed, gear, RPM/throttle/brake bars, tyre temp + wear per corner, last/best lap times, and fuel level. |
| **Multi-team leaderboard** | All PS5s in the room on one sortable table — position, lap gap to leader, compound, fuel bar, and pit/on-track status. |
| **GPS track map** | SVG circuit drawn live from PS5 position data at 60 Hz. Pit lane auto-detected. All tracked cars shown as colour-coded dots. |
| **Compound tracking** | Pit exit detected from telemetry — app prompts to confirm which compound was fitted. Tracks each team's current tyre independently. |
| **LAN PS5 scan** | One click scans the local network for active GT7 PS5s and adds them automatically, with DNS hostname resolution. |
| **Print export** | Full stint plan printed via browser print dialog — hand it to your co-driver. |

<br><br>

<a id="under-the-hood"></a>
<img src="https://capsule-render.vercel.app/api?type=rect&amp;color=0:0d1117,100:1a3300&amp;height=40&amp;text=◈%20UNDER%20THE%20HOOD%20%E2%80%94%20STRATEGY%20ENGINE&amp;fontColor=FFD700&amp;fontSize=16&amp;fontAlign=19&amp;fontAlignY=62" width="100%"/>

<br>

`src/logic/strategy.js` is pure JavaScript with **zero React dependency** — it runs in the browser and directly in Node.js for testing. The entry point is `findBestStrategies(inputs)`.

```mermaid
flowchart LR
    subgraph IN["Input"]
        CAR["Car data\nfuel · tyres · drivers"]
        MID["Mid-race\ncurrentLap · currentFuel"]
    end

    subgraph CORE["Strategy Engine  —  src/logic/strategy.js"]
        direction TB
        PAT["1  Build + generate\n~4 000 compound patterns"]
        SIM["2  Simulate each plan\nlap-by-lap"]
        FILT["3  Filter + deduplicate"]
        SORT["4  Sort\nmax laps · min time"]
        PAT --> SIM --> FILT --> SORT
    end

    subgraph VIS["React UI"]
        KPI["KPI Strip"]
        CARDS["Strategy Cards"]
        CHART["Stint Timeline"]
        TABLE["Lap Table"]
    end

    CAR --> CORE
    MID --> CORE
    CORE --> KPI & CARDS & CHART & TABLE
```

<br>

Each simulated plan runs the following per lap:

| Step | What the engine computes |
| :--- | :--- |
| Tyre degradation | Piecewise curve: `start → half` over 0–50% tyre life, `half → end` over 50–100% |
| Fuel weight | `dynamicLapTime = base + (fuelNow − tankSize) × penalty` — car gets faster every lap as fuel burns |
| Fuel carry-over | Leftover fuel rolls into the next stint's refuel calculation |
| Tyre change decision | Forced when compound differs or the current set is at zero life; otherwise a real cost/benefit comparison (ageing tyres vs. fresh + pit cost) over the upcoming stint |
| Mandatory stop capping | Stint length shortened to guarantee the required number of pit stops |
| Multi-driver assignment | Two strategies tried per plan — pick stint-by-stint by who owes the most, or allocate the longest stints first — keeping whichever leaves every driver furthest from falling short |

<br>

<details>
<summary><b>Fuel-weight correction model</b></summary>
<br>

The user observes lap times at full tank. Because fuel weight slows the car, the engine first converts those observed times to **full-tank equivalents** by adding back the weight penalty that was already burned off:

```
t_fullTank(mid) = t_observed(mid) + (tankSize − fuelAtMid) × penalty
t_fullTank(end) = t_observed(end) + (tankSize − fuelAtEnd) × penalty
```

During simulation, each lap's time is adjusted for the actual live fuel level:

```
dynamicLapTime = baseLapTime + (fuelAtStartOfLap − tankSize) × penalty
```

At 0.03 s/L on a 100 L tank: **3 s difference** between a full tank and empty.

</details>

<details>
<summary><b>Tyre degradation model</b></summary>
<br>

Each compound has three user-supplied lap times: `startLapTime`, `halfLapTime`, `endLapTime`. The engine uses a **piecewise linear** curve:

| Phase | Tyre age | Interpolation |
| :--- | :--- | :--- |
| Fresh | 0 → 50% of tireLife | `start` → `half` |
| Worn | 50 → 100% of tireLife | `half` → `end` |

This captures the typical GT7 pattern where grip drops faster in the second half of a stint. Both fuel-weight correction and tyre degradation are applied simultaneously each lap.

</details>

<br><br>

<a id="pit-wall"></a>
<img src="https://capsule-render.vercel.app/api?type=soft&amp;color=0:0d1117,100:1a3300&amp;height=50&amp;text=◈%20PIT%20WALL%20%E2%80%94%20LIVE%20PS5%20TELEMETRY&amp;fontColor=FFD700&amp;fontSize=18&amp;fontAlign=18&amp;fontAlignY=62" width="100%"/>

<br>

GT7 streams live **Salsa20-encrypted UDP packets** from the PS5 to any machine on the same LAN. The relay server decrypts and forwards them to the browser in real time over WebSocket.

```mermaid
flowchart LR
    subgraph LAN["Local Network  —  same router / switch"]
        P1["PS5 #1\n192.168.x.1"]
        P2["PS5 #2\n192.168.x.2"]
        PN["PS5 #N\n..."]
    end

    subgraph RELAY["server/telemetry-server.js  —  Node.js"]
        HB["Heartbeat sender\nUDP :33739 · 100 ms"]
        UDP["UDP listener\n:33740"]
        DEC["Salsa20 decrypt"]
        WSS["WebSocket server\n:20777"]
    end

    subgraph APP["Browser  —  React  (Télémétrie tab)"]
        HOOK["useTelemetry hook\nteams Map — scan support"]
        DET["useCompoundDetector\npit exit → confirm prompt"]
        LB["TelemetryLeaderboard\npos · lap · gap · times · fuel"]
        DASH["LiveDashboard\nspeed · RPM · pedals · tyres · track map"]
        CTRL["TelemetryControls\nURL · IPs · LAN scan"]
        FILL["Auto-fill\ncurrentLap · currentFuel"]
    end

    HB -->|heartbeat| P1 & P2 & PN
    P1 & P2 & PN -->|encrypted UDP| UDP
    UDP --> DEC --> WSS
    WSS -->|WebSocket| HOOK
    HOOK --> DET & LB & DASH & CTRL & FILL
```

<br>

<details open>
<summary><b>Network requirements</b></summary>
<br>

| Requirement | Detail |
| :--- | :--- |
| **Same LAN** | PS5 and laptop on the same router or switch |
| **Laptop firewall** | Allow UDP inbound `:33740`, outbound `:33739` |
| **PS5** | Nothing to install — GT7 streams natively |
| **Wi-Fi vs wired** | Both work; wired is more reliable at events |
| **Online lobbies** | Telemetry is local — works in private online races regardless of session routing |

</details>

<br>

### Setup

**1. Start the relay server**

```bash
npm run telemetry
# or: node server/telemetry-server.js
```

**2. Open the app → Télémétrie tab**

Leave the server URL as `ws://localhost:20777`, click **Connecter**. Then add each PS5's IP manually — or click **⟳ Scanner Réseau** to auto-detect every active GT7 PS5 on the LAN.

> Find a PS5's IP: **Settings → Network → View Connection Status → IP Address**

**3. Track tyres**

After each pit stop the app detects the pit exit and shows a confirmation prompt. Click the compound the driver fitted (H / M / S / IM / W) to start tracking tyre wear for that team.

**4. Enable auto-fill (optional)**

Enable **Mid-Race Recalculation** in the sidebar, then click a team row in the leaderboard to pin it. Current lap and fuel update automatically every telemetry packet — strategy recalculates in real time.

> **All 10 PS5s in one room?** One laptop, one relay server instance. It handles all of them simultaneously.

<br><br>

<a id="pole-position-setup"></a>
<img src="https://capsule-render.vercel.app/api?type=rect&amp;color=0:1a3300,50:0d1117,100:1a3300&amp;height=40&amp;text=◈%20POLE%20POSITION%20SETUP&amp;fontColor=FFD700&amp;fontSize=16&amp;fontAlign=13&amp;fontAlignY=62" width="100%"/>

<br>

### Prerequisites

![Node.js](https://img.shields.io/badge/Node.js_18%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)

### Install & run

```bash
git clone https://github.com/Jeremy-Luyckfasseel/Race-Strategies.git
cd Race-Strategies
npm install
npm run dev        # → http://localhost:5173
```

### All commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Dev server at `http://localhost:5173` |
| `npm run build` | Production build → `/dist` |
| `npm run preview` | Preview the production build |
| `npm test` | Full test suite — 1 983 assertions |
| `npm run test:smoke` | Quick 1-hour race smoke test |
| `npm run telemetry` | Start the UDP → WebSocket relay server |

<br><br>

<a id="pre-race-briefing"></a>
<img src="https://capsule-render.vercel.app/api?type=soft&amp;color=0:0d1117,100:2e1a00&amp;height=50&amp;text=◈%20PRE-RACE%20BRIEFING&amp;fontColor=FFD700&amp;fontSize=18&amp;fontAlign=12&amp;fontAlignY=62" width="100%"/>

<br>

**Data to collect in GT7 before entering values into the calculator:**

| Input | How to measure in GT7 | Tip |
| :--- | :--- | :--- |
| `lapsPerFullTank` | Free practice, full tank, fuel map 1 — count laps until low-fuel warning | Repeat on the fuel map you will race on |
| `startLapTime` | Lap 1 on fresh tyres, tank topped all the way to full | Use a consistent pace, not your personal best |
| `halfLapTime` | Lap ≈ `tireLife / 2` on the **same uninterrupted stint** as `startLapTime` | Same fuel map, same pace style |
| `endLapTime` | Last safe lap on that **same stint** before pitting | When you'd normally box — not when the tyre explodes |
| `tireLife` | Free practice — push the set until handling degrades significantly | Count laps from new |
| `pitBaseSecs` | Time from pit entry to exit with no refuel and no tyre change | Measure from replay |
| `tireChangeSecs` | Extra time added when tyres are changed | `pitWithTyres − pitWithoutTyres` from replay |
| `fuelWeightPenalty` | Lap 1 time (full tank) vs final lap time (near empty) divided by litres burned | 0.030 s/L is a safe GT7 default |

> ⚠️ **`startLapTime` must be a genuine full-tank lap.** The engine assumes it and applies zero fuel-weight correction to it — every other number derives from that assumption, and a lap measured after a partial refuel will silently bias the whole strategy with no error or warning shown. This only applies to hand-typed compound times; the **recorded-session import** (Télémétrie → Team Panel) measures the fuel-weight penalty directly from your car's actual fuel telemetry and isn't affected by this.
>
> ⚠️ **Intermediate and Wet have no weather model behind them.** The engine has no way to know the track is wet — a compound is only ever as fast as the lap times *you* measure and type in for it, exactly like Hard/Medium/Soft. If you're prepping a wet-race strategy, go out in those conditions and measure IM/W the same way you would any dry compound; the app won't detect rain or switch compounds for you.

<br><br>

<a id="quality-control"></a>
<img src="https://capsule-render.vercel.app/api?type=rect&amp;color=0:0d1117,100:2e1a00&amp;height=40&amp;text=◈%20QUALITY%20CONTROL%20%E2%80%94%20TESTS&amp;fontColor=FFD700&amp;fontSize=16&amp;fontAlign=15&amp;fontAlignY=62" width="100%"/>

<br>

The strategy engine has no React dependency and runs directly in Node:

```bash
npm test              # 1 983 assertions across eleven suites
npm run test:smoke    # 1-hour race smoke test
```

343 of those are hand-written unit tests; the other 1 640 are bulk-generated invariant sweeps (structural checks — no overfill, no tyre overrun, ranking correctness — repeated across many randomised inputs). Counted together because they all assert something real, but worth knowing which is which:

| Suite | File | Tests | Covers |
| :--- | :--- | :---: | :--- |
| **Comprehensive** | `tests/test_comprehensive.js` | 124 | Helpers, degradation curve, fuel tracking, pit timing, tyre-change economics, mandatory compound filter, mid-race mode, fuel weight penalty |
| **Invariants** *(generated sweeps)* | `tests/test_invariants.js` | 1 640 | Structural invariants on every result, ranking correctness, multi-compound enumeration, multi-driver minimums, race time boundary, known-answer scenarios, bulk no-overfill / no-tyre-overrun sweeps |
| **Telemetry learner** | `tests/test_telemetry_learner.js` | 37 | Recovers a known fuel/lap, fuel-weight penalty, and degradation curve from synthetic live telemetry |
| **Recommendations** | `tests/test_recommendations.js` | 20 | Propose-and-accept rules for live-measured car-model updates |
| **Race state** | `tests/test_race_state.js` | 29 | Live next-action, stint countdown, fuel margin / lift-and-coast, pit-now trigger |
| **Connection** | `tests/test_connection.js` | 18 | Telemetry reconnect backoff, session-active detection, auto-connect IP pick |
| **Engine validation** | `tests/test_engine_validation.js` | 27 | The recorded-session measurement library recovers fuel/weight/degradation from a synthetic capture |
| **Session analysis** | `tests/test_session_analysis.js` | 42 | Recorded-session → strategy-input derivation, single- and multi-driver merge |
| **Groups** | `tests/test_groups.js` | 18 | Team Groups → Races → Sessions state (pure, local) |
| **Sync store** | `tests/test_sync_store.js` | 17 | Self-hosted sync server's filesystem store, path-traversal rejection |
| **Sync client** | `tests/test_sync_client.js` | 11 | syncClient ↔ sync-server round trip over real HTTP |

<br><br>

<a id="technical-regulations"></a>
<img src="https://capsule-render.vercel.app/api?type=soft&amp;color=0:2e1a00,100:0d1117&amp;height=50&amp;text=◈%20TECHNICAL%20REGULATIONS%20%E2%80%94%20ARCHITECTURE&amp;fontColor=FFD700&amp;fontSize=18&amp;fontAlign=22&amp;fontAlignY=62" width="100%"/>

<br>

```text
📦 Race-Strategies/
 ┣ 📂 src/
 ┃ ┣ 📂 components/
 ┃ ┃ ┣ 📄 InputPanel.jsx          sidebar form — car presets, compounds, drivers, telemetry
 ┃ ┃ ┣ 📄 ResultsSummary.jsx      KPI strip + top-6 strategy comparison cards
 ┃ ┃ ┣ 📄 StrategyTimeline.jsx    Recharts bar chart with pit-window bands
 ┃ ┃ ┣ 📄 StintTable.jsx          lap-by-lap stint detail table
 ┃ ┃ ┣ 📄 LiveDashboard.jsx       ⭐ single-team widget — speed/gear, RPM/pedals, tyre temps/wear, GPS track map
 ┃ ┃ ┣ 📄 TelemetryControls.jsx   connection panel — server URL, PS5 IPs, LAN scan
 ┃ ┃ ┗ 📄 TelemetryLeaderboard.jsx multi-team table — pos, lap gap, times, compound, fuel, status
 ┃ ┣ 📂 hooks/
 ┃ ┃ ┣ 📄 useStrategy.js          debounced wrapper around findBestStrategies() (600 ms)
 ┃ ┃ ┣ 📄 useTelemetry.js         WebSocket hook — multi-team Map, scan support
 ┃ ┃ ┗ 📄 useCompoundDetector.js  pit-exit detection → compound confirmation prompt
 ┃ ┣ 📂 logic/
 ┃ ┃ ┣ 📄 strategy.js             ⭐ pure-JS engine · zero React · testable with node
 ┃ ┃ ┗ 📄 compoundDetector.js     note: GT7 UDP has no compound ID — tracking is user-driven
 ┃ ┣ 📄 App.jsx                   root component — owns all state, two-tab UI
 ┃ ┗ 📄 index.css                 dark racing theme (gold #FFD700)
 ┣ 📂 server/
 ┃ ┗ 📄 telemetry-server.js       Node.js UDP relay — Salsa20 decrypt → WebSocket + LAN scan
 ┣ 📂 tests/
 ┃ ┣ 📄 test.js                   smoke test
 ┃ ┣ 📄 test_comprehensive.js     124 unit tests
 ┃ ┣ 📄 test_invariants.js        1 640 generated invariant sweeps
 ┃ ┗ 📄 (+ 9 more suites — see Quality Control ↑ for the full breakdown)
 ┗ 📄 package.json
```

<br>

State lives exclusively in `App.jsx` — no Redux, no Context. The app is split into two tabs: **Stratégie** (plan calculator) and **Télémétrie** (live PS5 data). The strategy engine is intentionally decoupled from React so it can be tested with plain `node` and stays portable to any environment.

<br><br>

<a id="power-unit"></a>
<img src="https://capsule-render.vercel.app/api?type=rect&amp;color=0:0d1117,50:1c0d00,100:0d1117&amp;height=40&amp;text=◈%20POWER%20UNIT%20%E2%80%94%20TECH%20STACK&amp;fontColor=FFD700&amp;fontSize=16&amp;fontAlign=14&amp;fontAlignY=62" width="100%"/>

<br>

<div align="center">

![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite_7-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Recharts](https://img.shields.io/badge/Recharts_3.7-22b04b?style=for-the-badge&logo=chartdotjs&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript_ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![ws](https://img.shields.io/badge/ws_8.18-010101?style=for-the-badge&logo=socket.io&logoColor=white)

</div>

<br><br>

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0d1117,35:2e1a00,65:1c0d00,100:0d1117&amp;height=150&amp;section=footer&amp;text=LIGHTS%20OUT.%20AND%20AWAY%20WE%20GO.&amp;fontColor=FFD700&amp;fontSize=26&amp;fontAlignY=65&amp;animation=fadeIn" width="100%"/>

</div>
