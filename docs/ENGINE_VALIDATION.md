# ENGINE_VALIDATION.md — does the engine match reality?

> Tooling to **measure** whether the strategy engine's predictions match what
> actually happens in a real GT7 race. This is measurement, not tuning: the
> comparison **reports** discrepancies; it never changes `strategy.js`. If the
> numbers diverge, that's a finding for you to act on — the model decision is
> yours.

There are two tools and one protocol:

1. **Recorder** (`npm run record`) — logs per-lap ground truth from a live session.
2. **Comparison** (`npm run validate <file>`) — derives the real-world inputs from a
   recording, feeds them to the engine, and prints a plain-language report.
3. **This protocol** — how to capture a session worth trusting.

---

## What you need running

The recorder reuses the **existing** telemetry relay (it does not rebuild the
UDP/Salsa20 decode). So, as for normal live use:

```bash
npm run telemetry          # terminal 1 — the relay (UDP → WebSocket on :20777)
```

Then either:

- **With the app open** (easiest): start the app as usual, make sure live data is
  flowing (you see telemetry), then just run the recorder — it listens to the same
  relay passively.
- **Recorder only** (no app): pass your PS5's IP so the recorder tells the relay
  which console to track:

```bash
npm run record -- --ip 192.168.1.50 --compound H --notes "Spa, GR.3, race pace"
```

(`192.168.1.50` = your PS5's IP: PS5 → Settings → Network → View Connection Status.)

---

## How to capture a GOOD validation session (in-game)

The quality of the verdict depends entirely on the quality of the run. Aim for:

1. **Race pace, not qualifying pace.** Drive how you'd actually race — consistent,
   not heroic one-lap efforts. Hot-lapping pace makes the degradation curve lie.
2. **At least one FULL stint** — run a set of tyres until they're **clearly worn**
   (lap times rising, not just a few laps). This is the only way to see whether the
   degradation curve — and any late "cliff" — matches the model.
3. **At least one pit stop**, and **confirm the compound** at the stop (see keys
   below). The comparison segments stints at the pit and learns each compound
   separately.
4. **If you can, do one low-traffic baseline run** (a clean stint with clear track).
   This second stint at a different fuel load is what lets the tool **separate the
   fuel-weight effect from degradation** — without it, those two are mathematically
   confounded and the report will say "fuel-weight not separable".
5. Keep it on-track. Off-tracks, spins, and pauses are auto-excluded as dirty laps,
   but the more clean laps the better.

A good first capture: a **baseline stint** + a **pit** + a **full race-pace stint
to worn tyres**. That exercises every metric.

---

## Running the recorder

```bash
npm run record -- --compound H            # start; H is the tyre you're on
```

While it runs it prints each completed lap. **GT7 does not send the tyre compound**,
so — exactly like the app's one-tap confirm — **you** confirm it by pressing a key:

| key | compound |
|-----|----------|
| `h` | Hard |
| `m` | Medium |
| `s` | Soft |
| `i` | Intermediate |
| `w` | Wet |
| `q` | stop and save |

Press the compound key **at the start** and **again after each pit stop** (the
recorder prints `PIT OUT … confirm the compound` to remind you). Press `q` (or
Ctrl-C) to stop. Every completed lap is flushed to disk immediately, so a crash
mid-race never loses laps.

Output: `captures/session-YYYYMMDD-HHMMSS.json`.

**Options:** `--ip <ps5>` (track a console without the app open + lock to that car),
`--team <label>`, `--compound <H|M|S|IM|W>` (starting tyre), `--out <dir>`,
`--notes "<text>"`.

---

## Running the comparison

```bash
npm run validate captures/session-YYYYMMDD-HHMMSS.json
```

Add `--out report.txt` to save the report, or `--json` to get the raw numbers.

### Reading the report

Five sections, each ending in a verdict:

1. **Fuel consumption** — measured L/lap from tank deltas (traffic-proof). The
   load-bearing "when must I pit" number.
2. **Fuel-weight effect** — the measured seconds-per-litre vs the engine's **0.03
   s/L** assumption, and whether lap time actually falls as fuel burns. Says
   **"not separable"** if the capture lacks the fuel variation to isolate it (do a
   baseline stint — point 4 above).
3. **Tyre degradation** — the measured start/half/end curve and the fit residual,
   per compound. **Explicitly flags a late "cliff"** where real degradation runs
   steeper than the piecewise model can represent (⚠ in the line).
4. **Strategy quality** — the plan the engine recommends from the measured data,
   and how its **predicted pit lap** and **total lap count** compare to what you
   actually did. (Note: if you ran a deliberately short baseline stint, the pit-lap
   line *will* diverge — the engine reports the fuel/tyre-optimal lap, which is
   later than an early baseline stop. That's expected, not an engine error.)
5. **Verdict summary** — one line per metric: `matches` / `diverges` /
   `not-separable` / `insufficient-data`.

Tolerances (what counts as "matches") live in `TOLERANCES` at the top of
`scripts/lib/validation.js` and mirror the Phase-1 live-trust bands and the
Phase-4 mock-race pass bar (pit lap ±1, fuel error <~1 lap). They're measurement
config — adjust them there, not in the engine.

---

## What the report might surface (so you know what to look for)

These are the discrepancies the design is built to catch. None of them are fixed
here — they're findings:

- **Fuel-weight ≠ 0.03 s/L.** Longer tracks should read higher (~0.02–0.05). If the
  measured slope is well outside that, the engine's single-scalar assumption is off
  for this car/track.
- **A degradation cliff.** The piecewise start/half/end model bends once at
  half-life; if real tyres "fall off" sharply near the end, the model under-warns.
  The report flags this explicitly — it's the most likely real divergence.
- **Degradation steeper (or flatter) than modelled** even without a hard cliff —
  shows up as a large fit residual.
- **Pit-lap / total-lap divergence** driven by any of the above, or by the driver
  not running to the optimal window.
- **"Not separable" fuel-weight** — not a divergence, a data gap: the capture had a
  single fuel range. Re-capture with a baseline stint.
- **Tyre-wear signal quality** — `tireWear` is radius-derived; the recording keeps
  it so you can later check whether it's stable enough to trust (the comparison
  uses lap-count-since-stint as the degradation axis, not wear).

If a metric diverges, the report tells you **by how much** and the likely reason.
What to change in the model (if anything) is your call.
