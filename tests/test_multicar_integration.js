/**
 * Integration test for the browser-side pipeline at LAN-event scale.
 *
 * Unit tests cover each helper in isolation; this drives a simulated 12-car
 * race through the same functions the app actually calls, in the same order
 * and at the same rates: packets buffered by `coalescePacket` as they arrive,
 * `applyFlush` folding them into state 20 times a second, then colours, gaps,
 * car identity and the stint log read off the result.
 *
 * `applyFlush` is the real function `useTelemetry` runs — not a copy — so a
 * change to the hot path either keeps this passing or breaks it.
 *
 * Run with: node tests/test_multicar_integration.js
 */

import { coalescePacket, applyFlush, teamColor, resolveActiveCars, TEAM_STALE_MS } from '../src/logic/teams.js';
import { lapInterval, formatInterval } from '../src/logic/gaps.js';
import { detectPitEdges } from '../src/logic/pitDetect.js';
import { emptyEntry, openStint, closeStint, reopenStint, recordLapIfClean, assignDriver } from '../src/logic/stintLog.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

const CAR_COUNT = 12;
const PACKET_HZ = 60;
const FLUSH_MS = 50;            // must match useTelemetry's FLUSH_MS
const LAP_MS = 120_000;

const ips = Array.from({ length: CAR_COUNT }, (_, i) => `192.168.1.${20 + i}`);

/**
 * Runs the real pipeline over a simulated race.
 * `script(car, tMs)` returns that car's telemetry for this instant.
 */
function runRace({ durationMs, script, staleMs = TEAM_STALE_MS }) {
  let state = { teams: new Map(), order: [], crossings: new Map() };
  let pending = new Map();
  const pitState = new Map();

  let packetCount = 0;
  let flushCount = 0;
  let teamsChangedCount = 0;
  const flushedEdges = [];       // pit edges that survived into state
  const snapshots = [];

  const packetInterval = 1000 / PACKET_HZ;
  let nextFlush = FLUSH_MS;

  for (let t = 0; t <= durationMs; t += packetInterval) {
    for (let i = 0; i < CAR_COUNT; i++) {
      const s = script(i, t);
      if (!s) continue;              // car not transmitting

      // The relay derives pit edges from speed before broadcasting.
      const r = detectPitEdges(pitState.get(ips[i]), s.speedKmh, t);
      pitState.set(ips[i], r.state);

      const pkt = {
        ps5ip: ips[i],
        ...s,
        ts: t,
        ...(r.pitDetected ? { pitDetected: true } : {}),
        ...(r.pitExit ? { pitExit: true } : {}),
      };
      packetCount++;
      // Exactly what useTelemetry's onmessage does.
      pending.set(pkt.ps5ip, coalescePacket(pending.get(pkt.ps5ip), pkt));
    }

    while (t >= nextFlush) {
      const before = state;
      state = applyFlush(before, pending, nextFlush, staleMs);
      pending.clear();
      flushCount++;
      if (state.teams !== before.teams) teamsChangedCount++;

      for (const [ip, p] of state.teams) {
        if (p.ts === nextFlush - FLUSH_MS || p.pitDetected || p.pitExit) {
          if (p.pitDetected) flushedEdges.push({ ip, edge: 'enter', at: nextFlush });
          if (p.pitExit) flushedEdges.push({ ip, edge: 'exit', at: nextFlush });
        }
      }
      snapshots.push({ at: nextFlush, state });
      nextFlush += FLUSH_MS;
    }
  }

  return { state, packetCount, flushCount, teamsChangedCount, flushedEdges, snapshots };
}

// A plain green-flag race: everyone circulating, staggered down the road.
const greenFlag = (i, t) => ({
  currentLap: 1 + Math.floor((t + i * 2000) / LAP_MS),
  speedKmh: 180,
  fuelLiters: 60 - (t / LAP_MS) * 3,
  onTrack: true,
  lastLapMs: LAP_MS + i * 250,
});

section('batching — render cost stops scaling with the field');
{
  const r = runRace({ durationMs: 10_000, script: greenFlag });
  assert(`ingested a full field's traffic (${r.packetCount} packets)`,
    r.packetCount > 6000, `${r.packetCount}`);
  assert('but produced one state change per flush at most',
    r.teamsChangedCount <= r.flushCount, `${r.teamsChangedCount} > ${r.flushCount}`);
  assert('roughly 20 state updates per second, not 720',
    r.teamsChangedCount <= 220, `${r.teamsChangedCount}`);
  const ratio = r.packetCount / r.teamsChangedCount;
  assert('a ~30x reduction in React work', ratio > 25, `ratio ${ratio.toFixed(1)}x`);
  console.log(`     (${r.packetCount} packets -> ${r.teamsChangedCount} state updates, ${ratio.toFixed(1)}x fewer)`);

  assert('every car is present', r.state.teams.size === CAR_COUNT, `${r.state.teams.size}`);
  assert('first-seen order covers the field', r.state.order.length === CAR_COUNT);
}

section('colours — distinct across the field and stable through a dropout');
{
  const before = runRace({ durationMs: 3000, script: greenFlag });
  const colours = before.state.order.map((ip) => teamColor(before.state.order.indexOf(ip)));
  assert('all twelve cars get different colours', new Set(colours).size === CAR_COUNT,
    `${new Set(colours).size} distinct`);

  // Car 4 goes quiet a third of the way in; the rest keep running long enough
  // for it to pass the staleness window.
  const RETIRED = 4;
  const withRetirement = runRace({
    durationMs: 40_000,
    script: (i, t) => (i === RETIRED && t > 5000 ? null : greenFlag(i, t)),
  });

  assert('the retired car is dropped from the display',
    !withRetirement.state.teams.has(ips[RETIRED]), 'still present');
  assert('the rest of the field remains', withRetirement.state.teams.size === CAR_COUNT - 1,
    `${withRetirement.state.teams.size}`);
  assert('but it keeps its slot in the order, so nobody is renumbered',
    withRetirement.state.order.length === CAR_COUNT);

  const survivorColour = (ip) => teamColor(withRetirement.state.order.indexOf(ip));
  const stable = ips
    .filter((ip, i) => i !== RETIRED)
    .every((ip) => survivorColour(ip) === teamColor(before.state.order.indexOf(ip)));
  assert('every surviving car kept exactly the colour it had', stable);
}

section('a pit stop inside the buffer — the edge must reach the UI');
{
  // Car 7 stops at 5 s, stays put well past the dwell, and rejoins. The
  // pitDetected packet lands mid-flush-window among ~3 others.
  const PITTER = 7;
  const r = runRace({
    durationMs: 30_000,
    script: (i, t) => {
      const base = greenFlag(i, t);
      if (i !== PITTER) return base;
      const stopped = t >= 5000 && t < 20_000;
      return { ...base, speedKmh: stopped ? 0 : 180, onTrack: !stopped };
    },
  });

  const mine = r.flushedEdges.filter((e) => e.ip === ips[PITTER]);
  const enters = mine.filter((e) => e.edge === 'enter');
  const exits = mine.filter((e) => e.edge === 'exit');
  assert('the pit entry survived buffering and reached state', enters.length >= 1,
    'edge was swallowed by the flush window');
  assert('so did the pit exit', exits.length >= 1, 'edge was swallowed by the flush window');
  assert('entry came before exit', enters[0].at < exits[0].at);
  assert('no other car produced an edge',
    r.flushedEdges.every((e) => e.ip === ips[PITTER]),
    JSON.stringify(r.flushedEdges.filter((e) => e.ip !== ips[PITTER])));
}

section('gaps — real intervals across the field');
{
  // A short lap so the field actually completes laps inside the run. Each car
  // crosses the line for real, which is what a second-level interval requires.
  // Lap and stagger chosen so cars 0-3 sit comfortably mid-lap together at the
  // end of the run, rather than straddling a lap boundary where the honest
  // answer would be "+1L" instead of an interval.
  const SHORT_LAP = 8000;
  const STAGGER = 800;
  const shortLapRace = (i, t) => ({
    currentLap: 1 + Math.floor((t + i * STAGGER) / SHORT_LAP),
    speedKmh: 180,
    onTrack: true,
    lastLapMs: SHORT_LAP,
  });

  const r = runRace({ durationMs: 28_000, script: shortLapRace });
  const { crossings } = r.state;

  assert('every car has a crossing on record', crossings.size === CAR_COUNT, `${crossings.size}`);
  assert('and they are real witnessed crossings by now',
    [...crossings.values()].every((c) => c.witnessed));

  // The stagger puts higher-numbered cars further down the road, so car i+1
  // leads car i and should be reported as the one ahead.
  const pairs = [[3, 2], [2, 1], [1, 0]];
  for (const [ahead, behind] of pairs) {
    const iv = lapInterval(crossings.get(ips[ahead]), crossings.get(ips[behind]));
    assert(`car ${ahead} leads car ${behind} by a concrete interval`, iv !== null, 'got nothing');
    assert(`  and it matches the ${STAGGER / 1000}s stagger`,
      iv?.secs != null && Math.abs(iv.secs - STAGGER / 1000) < 0.3, `got ${JSON.stringify(iv)}`);
  }

  // The crucial contrast with the old implementation: these cars all run
  // identical lap times, so subtracting last-lap times would report nothing
  // at all. The interval is real regardless of pace being equal.
  const sameLapTimes = new Set([...r.state.teams.values()].map((d) => d.lastLapMs));
  assert('the whole field is running identical lap times', sameLapTimes.size === 1);
  assert('yet real gaps are still reported (the old column showed nothing here)',
    formatInterval(lapInterval(crossings.get(ips[1]), crossings.get(ips[0]))) !== null);
}

section('car identity — inspecting a rival never moves my strategy');
{
  const r = runRace({ durationMs: 3000, script: greenFlag });
  const teamKeys = [...r.state.teams.keys()];
  const MINE = ips[3];
  const RIVAL = ips[9];

  const idle = resolveActiveCars({ myTeamIp: MINE, teamKeys });
  assert('my car drives the strategy', idle.strategyIp === MINE && idle.displayIp === MINE);

  const peeking = resolveActiveCars({ myTeamIp: MINE, selectedIp: RIVAL, teamKeys });
  assert('clicking a rival moves only the dashboard', peeking.displayIp === RIVAL);
  assert('my strategy stays on my car', peeking.strategyIp === MINE);

  const unmarked = resolveActiveCars({ teamKeys });
  assert('with twelve cars and none marked, nothing is guessed',
    unmarked.strategyIp === null && unmarked.displayIp === null);
}

section('stint log over a full pit cycle, driven by the flushed stream');
{
  const PITTER = 7;
  const r = runRace({
    durationMs: 30_000,
    script: (i, t) => {
      const base = greenFlag(i, t);
      if (i !== PITTER) return base;
      const stopped = t >= 5000 && t < 20_000;
      return { ...base, speedKmh: stopped ? 0 : 180, onTrack: !stopped };
    },
  });

  // Replay my car's flushed packets through the stint log the way the hook does.
  let entry = emptyEntry();
  let lastLapSeen = 0;
  let opened = false;
  for (const { at, state } of r.snapshots) {
    const d = state.teams.get(ips[PITTER]);
    if (!d) continue;

    if (!opened && d.onTrack && d.currentLap > 0) {
      entry = openStint(entry, { driverId: 'd1', compound: 'M', startLap: d.currentLap, now: at });
      opened = true;
    }
    if (d.pitDetected && entry.current) {
      entry = closeStint(entry, { endLap: d.currentLap, now: at });
    }
    if (d.pitExit) {
      entry = reopenStint(entry, { compound: 'S', startLap: d.currentLap, now: at });
      entry = assignDriver(entry, 'd2');
    }
    if (entry.current && d.lastLapMs > 0 && d.currentLap > lastLapSeen) {
      lastLapSeen = d.currentLap;
      entry = recordLapIfClean(entry, {
        lapMs: d.lastLapMs, currentLap: d.currentLap, paused: d.paused, onTrack: d.onTrack,
      });
    }
  }

  assert('the first stint was archived when the car pitted', entry.history.length === 1,
    `${entry.history.length} stints in history`);
  assert('it recorded who drove it', entry.history[0]?.driverId === 'd1');
  assert('and how long it lasted', entry.history[0]?.durationSecs > 0);
  assert('a fresh stint is open after the stop', entry.current !== null);
  assert('on the new compound', entry.current?.compound === 'S');
  assert('with the driver who took over', entry.current?.driverId === 'd2');
  assert('no per-lap array is ever retained',
    entry.history.every((s) => !('laps' in s)) && !('laps' in (entry.current ?? {})));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
