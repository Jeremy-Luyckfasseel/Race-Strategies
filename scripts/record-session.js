/**
 * Session recorder (engine-validation, Task 1).
 *
 * A STANDALONE Node logger. It connects to the EXISTING relay's WebSocket
 * (ws://localhost:20777) — it does not touch the React app and does not rebuild
 * the UDP/Salsa20 pipeline. While a real GT7 session runs it records per-lap
 * ground truth to a timestamped JSON file in ./captures, flushing after every lap
 * so a crash mid-race never loses completed laps.
 *
 * Usage:
 *   node scripts/record-session.js [--ip 192.168.1.50] [--team Label]
 *                                  [--compound H] [--out ./captures] [--notes "..."]
 *
 *   --ip       PS5 IP/hostname. If given, the recorder tells the relay to track it
 *              (so it works WITHOUT the browser app open). Also locks recording to
 *              that car. If omitted, it locks onto the first car it sees and assumes
 *              another client (the app) has set the IPs.
 *   --compound starting tyre compound (H/M/S/IM/W). Default H.
 *
 * GT7 telemetry does NOT expose the tyre compound, so — exactly like the app's
 * one-tap confirm — YOU confirm it here by pressing a key:
 *      h Hard   m Medium   s Soft   i Intermediate   w Wet
 * Press the compound key at the start and again after each pit stop. Press q (or
 * Ctrl-C) to stop cleanly.
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const OPT = {
  url: arg('url', 'ws://localhost:20777'),
  ip: arg('ip', null),
  team: arg('team', null),
  compound: (arg('compound', 'H') || 'H').toUpperCase(),
  outDir: arg('out', path.join(process.cwd(), 'captures')),
  notes: arg('notes', ''),
};

const KEY_TO_COMPOUND = { h: 'H', m: 'M', s: 'S', i: 'IM', w: 'W' };

// ── capture state ───────────────────────────────────────────────────────────
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const outFile = path.join(OPT.outDir, `session-${stamp()}.json`);
const capture = {
  meta: {
    version: 1,
    tool: 'engine-validation recorder',
    startedAt: new Date().toISOString(),
    endedAt: null,
    team: OPT.team || OPT.ip || null,
    tankCapacityL: null,
    startCompound: OPT.compound,
    notes: OPT.notes,
  },
  laps: [],
  events: [],
};

// Per-lap accumulation
let lockedLabel = OPT.team || null; // which car we record
let currentCompound = OPT.compound;
let lastLap = null;
let lapStartFuel = null;
let stintStartLap = null;
let stint = 1;
let pendingOutLap = true; // first completed lap is an out-lap (joined mid-lap)
// flags/extremes seen during the in-progress lap
let sawPit = false;
let sawOffTrack = false;
let sawPaused = false;
let minSpeed = Infinity;
let maxSpeed = -Infinity;

function resetLapAccumulators() {
  sawPit = false;
  sawOffTrack = false;
  sawPaused = false;
  minSpeed = Infinity;
  maxSpeed = -Infinity;
}

// ── atomic, crash-safe flush ──────────────────────────────────────────────────
function flush() {
  fs.mkdirSync(OPT.outDir, { recursive: true });
  const tmp = `${outFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(capture, null, 2));
  fs.renameSync(tmp, outFile); // atomic on the same volume — file is always valid
}

function logEvent(type, extra = {}) {
  capture.events.push({ type, ts: new Date().toISOString(), ...extra });
}

// ── packet handling ───────────────────────────────────────────────────────────
function onPacket(pkt) {
  const label = pkt.ps5ip;
  if (lockedLabel == null) {
    lockedLabel = label; // lock onto the first car seen
    console.log(`▶ recording car: ${lockedLabel}`);
  }
  if (label !== lockedLabel) return; // ignore other cars (single-team)

  if (capture.meta.tankCapacityL == null && pkt.fuelCapacity > 0) {
    capture.meta.tankCapacityL = pkt.fuelCapacity;
  }

  // accumulate within the in-progress lap
  const spd = Number(pkt.speedKmh) || 0;
  if (spd < minSpeed) minSpeed = spd;
  if (spd > maxSpeed) maxSpeed = spd;
  if (pkt.pitDetected) sawPit = true;
  if (pkt.onTrack === false) sawOffTrack = true;
  if (pkt.paused) sawPaused = true;

  // pit events → stint boundary
  if (pkt.pitDetected) {
    logEvent('pitDetected', { lap: pkt.currentLap, compound: currentCompound });
    console.log(`\n⛽ PIT IN  (lap ${pkt.currentLap})`);
  }
  if (pkt.pitExit) {
    stint += 1;
    stintStartLap = pkt.currentLap;
    pendingOutLap = true;
    logEvent('pitExit', { lap: pkt.currentLap });
    console.log(`🏁 PIT OUT (lap ${pkt.currentLap}) — confirm the compound: h/m/s/i/w  (current: ${currentCompound})`);
  }

  const lap = Number(pkt.currentLap);
  if (!Number.isFinite(lap)) return;

  // init on first packet
  if (lastLap === null) {
    lastLap = lap;
    lapStartFuel = pkt.fuelLiters;
    stintStartLap = lap;
    resetLapAccumulators();
    return;
  }

  // lap boundary: currentLap incremented → the lap `lastLap` just completed
  if (lap !== lastLap) {
    const delta = lap - lastLap;
    const fuelEnd = pkt.fuelLiters;
    const lapTimeMs = Number(pkt.lastLapMs);
    const rec = {
      lap: lastLap,
      lapTimeMs: lapTimeMs > 0 ? lapTimeMs : null,
      lapTimeSec: lapTimeMs > 0 ? Math.round((lapTimeMs / 1000) * 1000) / 1000 : null,
      fuelStartL: lapStartFuel,
      fuelEndL: fuelEnd,
      fuelUsedL: lapStartFuel != null && fuelEnd != null ? Math.round((lapStartFuel - fuelEnd) * 100) / 100 : null,
      compound: currentCompound,
      stint,
      tireAge: lastLap - stintStartLap,
      tireWear: pkt.tireWear || null,
      tireRadius: pkt.tireRadius || null,
      minSpeedKmh: Number.isFinite(minSpeed) ? minSpeed : null,
      maxSpeedKmh: Number.isFinite(maxSpeed) ? maxSpeed : null,
      sawPit,
      sawOffTrack,
      sawPaused,
      outLap: pendingOutLap,
      lapJump: delta !== 1,
      tsEnd: new Date().toISOString(),
    };
    capture.laps.push(rec);
    flush(); // crash-safe: every completed lap is on disk

    const lt = rec.lapTimeSec != null ? `${rec.lapTimeSec.toFixed(3)}s` : '—';
    const fu = rec.fuelUsedL != null ? `${rec.fuelUsedL.toFixed(2)}L` : '—';
    console.log(`lap ${rec.lap} · ${lt} · fuel ${fu} · ${rec.compound} · age ${rec.tireAge}${rec.outLap ? ' · out-lap' : ''}`);

    // roll forward
    lastLap = lap;
    lapStartFuel = fuelEnd;
    pendingOutLap = false;
    resetLapAccumulators();
  }
}

// ── compound keypress (the standalone equivalent of the one-tap confirm) ───────
function setupKeys() {
  if (!process.stdin.isTTY) return; // non-interactive (e.g. piped) — skip
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key && key.ctrl && key.name === 'c') return stop();
    const k = (str || '').toLowerCase();
    if (k === 'q') return stop();
    if (KEY_TO_COMPOUND[k]) {
      currentCompound = KEY_TO_COMPOUND[k];
      logEvent('compoundConfirm', { lap: lastLap, compound: currentCompound });
      flush();
      console.log(`✓ compound set: ${currentCompound}`);
    }
  });
}

// ── connection (with simple reconnect so a relay restart doesn't end the run) ──
let ws = null;
let stopped = false;
function connect() {
  ws = new WebSocket(OPT.url);
  ws.on('open', () => {
    console.log(`connected to relay ${OPT.url}`);
    if (OPT.ip) ws.send(JSON.stringify({ type: 'setIPs', ips: [OPT.ip] }));
    console.log(`recording to ${outFile}`);
    console.log(`compound keys: h Hard · m Medium · s Soft · i Intermediate · w Wet · q quit\n`);
  });
  ws.on('message', (raw) => {
    try {
      const pkt = JSON.parse(raw);
      if (pkt && pkt.ps5ip) onPacket(pkt);
    } catch {
      /* ignore non-telemetry frames */
    }
  });
  ws.on('close', () => {
    if (stopped) return;
    console.warn('relay connection closed — retrying in 2s…');
    setTimeout(connect, 2000);
  });
  ws.on('error', (e) => console.warn('ws error:', e.message));
}

function stop() {
  if (stopped) return;
  stopped = true;
  capture.meta.endedAt = new Date().toISOString();
  logEvent('stop');
  try {
    flush();
  } catch (e) {
    console.error('final flush failed:', e.message);
  }
  console.log(`\n■ stopped. ${capture.laps.length} laps saved to ${outFile}`);
  try {
    ws && ws.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

logEvent('start', { compound: currentCompound });
setupKeys();
connect();
