/**
 * Tyre-radius diagnostic.
 *
 * The relay derives a "tyre wear %" as current radius / largest radius seen.
 * docs/CURRENT_STATE.md has long flagged that as unproven, and track testing
 * says it does not work — the suspicion being that GT7 reports a fixed spec
 * radius that never moves, which would make the percentage exactly 100 for
 * ever.
 *
 * This settles it with the hardware rather than by argument. Drive a stint
 * with the relay running, then read the summary: if the spread per corner is
 * ~0, the radius carries no wear signal and nothing can be derived from it.
 * If it moves consistently as the tyres go off, it is worth revisiting.
 *
 * Usage:
 *   1) npm run telemetry      (in one terminal)
 *   2) npm run diag:tyres     (in another, while you drive)
 *      Ctrl-C when the stint is done to print the verdict.
 */

import { WebSocket } from 'ws';

const URL = process.argv[2] || 'ws://localhost:20777';
const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const PRINT_EVERY_MS = 2000;

const stats = new Map(); // ps5ip -> { min[], max[], samples, firstLap, lastLap }
let lastPrint = 0;
let total = 0;

function track(ip, radii, lap) {
  let s = stats.get(ip);
  if (!s) {
    s = { min: [...radii], max: [...radii], samples: 0, firstLap: lap, lastLap: lap };
    stats.set(ip, s);
  }
  radii.forEach((r, i) => {
    if (r < s.min[i]) s.min[i] = r;
    if (r > s.max[i]) s.max[i] = r;
  });
  s.samples += 1;
  s.lastLap = lap;
}

const fmt = (n, d = 4) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(d));

console.log(`Connecting to ${URL} …`);
console.log('Drive a stint. Ctrl-C when done.\n');

const ws = new WebSocket(URL);

ws.on('open', () => console.log('Connected. Waiting for telemetry…\n'));

ws.on('error', (err) => {
  console.error(`\nCould not reach the relay at ${URL} — is \`npm run telemetry\` running?`);
  console.error(`  ${err.message}`);
  process.exit(1);
});

ws.on('message', (raw) => {
  let pkt;
  try { pkt = JSON.parse(raw.toString()); } catch { return; }
  if (!pkt?.ps5ip || !Array.isArray(pkt.tireRadius)) return;

  total += 1;
  track(pkt.ps5ip, pkt.tireRadius, pkt.currentLap);

  const now = Date.now();
  if (now - lastPrint < PRINT_EVERY_MS) return;
  lastPrint = now;

  const radii = pkt.tireRadius.map((r) => fmt(r)).join('  ');
  const wear = (pkt.tireWear ?? []).map((w) => (w == null ? '—' : w.toFixed(1))).join('  ');
  console.log(
    `lap ${String(pkt.currentLap ?? '?').padStart(3)} · ${String(pkt.speedKmh ?? 0).padStart(3)} km/h` +
    ` | radius ${radii} | derived wear% ${wear}`,
  );
});

function report() {
  console.log('\n──────────────── verdict ────────────────');
  if (stats.size === 0) {
    console.log('No telemetry received. Is GT7 running and the PS5 IP configured?');
    return;
  }
  console.log(`${total} packets seen across ${stats.size} car(s).`);
  for (const [ip, s] of stats) {
    console.log(`\n${ip} — ${s.samples} samples, laps ${s.firstLap}→${s.lastLap}`);
    let moved = false;
    CORNERS.forEach((c, i) => {
      const spread = s.max[i] - s.min[i];
      if (spread > 0.0005) moved = true;    // 0.5 mm — beyond rounding noise
      console.log(
        `  ${c}  min ${fmt(s.min[i])}  max ${fmt(s.max[i])}` +
        `  spread ${fmt(spread)} m`,
      );
    });
    console.log(
      moved
        ? '  → radius DOES move. Worth re-examining whether it tracks wear.'
        : '  → radius is effectively constant. It carries no wear signal,\n' +
          '     so any percentage derived from it is meaningless.',
    );
  }
  console.log('\nTyre life in the app is modelled from laps-on-set, not from this.');
}

process.on('SIGINT', () => { report(); process.exit(0); });
