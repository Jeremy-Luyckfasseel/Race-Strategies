# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GT7 (Gran Turismo 7) Endurance Race Strategy Calculator — a web app that enumerates all valid pit/tire combinations and finds optimal race strategies, accounting for fuel weight, tire compound degradation, and variable pit stop times.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:5173
npm run build     # Production build to /dist
npm run lint      # ESLint (flat config)
npm run preview   # Preview production build locally

node test.js                  # Run basic algorithm test (1-hour race)
node test_spam_softs.js       # 8-hour race soft-tire strategy test
node validate_scenario_A.js   # Detailed algorithm validation with trace output
```

Test scripts in the root are plain Node.js — no test runner. They import `findBestStrategies` directly from `src/logic/strategy.js` and log JSON output.

## Architecture

### Strict separation between logic and UI

The strategy engine (`src/logic/strategy.js`) is pure JavaScript with zero React dependency. This is intentional — it can be tested with `node` directly and keeps the algorithm portable.

The React integration layer is `src/hooks/useStrategy.js`, which wraps `findBestStrategies()` and exposes results to components.

### Data flow

```
App.jsx  (state: inputs, selectedIndex)
  └── InputPanel        → collects race/tire/pit parameters; reads/writes localStorage presets
  └── useStrategy hook  → calls findBestStrategies(inputs); returns sorted strategy array
  └── ResultsSummary    → renders top-6 strategy cards + KPI summary
  └── StrategyTimeline  → Recharts bar chart of stints per strategy
  └── StintTable        → lap-by-lap stint detail for the selected strategy
```

State lives only in `App.jsx` — no Redux, no Context.

### Strategy algorithm (`src/logic/strategy.js`)

- `findBestStrategies(inputs)` — entry point; enumerates all valid tire compound sequences up to `lookahead` stints (default 50) and returns the best strategies sorted by total time.
- `simulateStrategy(compoundSequence, inputs)` — lap-by-lap simulation for one compound sequence. Tracks fuel consumption, fuel-weight speed penalty (0.01 s/lap per liter), tire wear limits, and exact fuel carryover between stints.
- Pit stop time = `basePitTime + (tiresToChange ? tireChangeTime : 0) + refuelLiters / refuelRate`
- Mandatory minimum pit stops are enforced during enumeration.

### ESLint config note

The `no-unused-vars` rule ignores variables whose names start with an uppercase letter or underscore (pattern: `^[A-Z_]`). This is intentional to allow unused React import-style names.

## Key files

| File | Purpose |
|------|---------|
| `src/logic/strategy.js` | Pure-JS strategy engine (~560 lines) |
| `src/hooks/useStrategy.js` | React hook wrapping the engine |
| `src/App.jsx` | Root component; owns all state |
| `src/components/InputPanel.jsx` | Race parameters form + localStorage presets |
| `test.js` / `validate_scenario_A.js` | Algorithm smoke tests (run with node) |
