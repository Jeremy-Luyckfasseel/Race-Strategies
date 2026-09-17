/**
 * Tests for src/logic/pitDetect.js — the relay's speed-based pit detection.
 *
 * The case that drove this: the old rule ("below 5 km/h after having been
 * above 60") fired for any spin or off-track stop, and each false positive
 * cleared the car's compound, closed its stint in the Pilotes log and popped a
 * driver prompt. These tests pin down that a brief stop produces NO edges while
 * a real pit stop still produces exactly one entry and one exit.
 *
 * Run with: node tests/test_pit_detect.js
 */

import {
  detectPitEdges,
  PIT_MIN_STOP_MS,
  PIT_RACING_KMH,
  PIT_STOPPED_KMH,
} from '../src/logic/pitDetect.js';

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

/**
 * Feed a series of [speedKmh, atMs] samples through the machine and collect
 * every edge it emits, the way the relay does packet by packet.
 */
function run(samples, state = undefined) {
  const edges = [];
  for (const [spd, at] of samples) {
    const r = detectPitEdges(state, spd, at);
    state = r.state;
    if (r.pitDetected) edges.push({ edge: 'enter', at });
    if (r.pitExit) edges.push({ edge: 'exit', at });
  }
  return { edges, state };
}

section('a real pit stop — exactly one entry and one exit');
{
  const { edges } = run([
    [150, 0],           // racing
    [45, 1000],         // pit lane crawl — between the thresholds, holds
    [0, 2000],          // stopped at the box
    [0, 2000 + PIT_MIN_STOP_MS],   // still stopped, dwell met
    [0, 20000],         // service continues
    [45, 26000],        // pulling away, still under racing speed
    [120, 28000],       // back on track
  ]);
  assert('fires exactly two edges', edges.length === 2, JSON.stringify(edges));
  assert('entry first, then exit', edges[0]?.edge === 'enter' && edges[1]?.edge === 'exit');
  assert('entry fires once the dwell is met, not on the first slow packet',
    edges[0]?.at === 2000 + PIT_MIN_STOP_MS, `got ${edges[0]?.at}`);
  assert('exit fires when racing speed returns', edges[1]?.at === 28000);
}

section('a spin — the false positive this fix exists for');
{
  const { edges } = run([
    [150, 0],
    [0, 1000],          // spun to a halt
    [0, 3000],          // sitting there a couple of seconds
    [30, 4500],         // gathering it up
    [140, 6000],        // back up to speed
  ]);
  assert('a brief stop fires no edges at all', edges.length === 0, JSON.stringify(edges));
}

section('a long stop still counts — the accepted ceiling');
{
  // A car parked on track past the dwell is indistinguishable from a pit stop
  // on speed alone. Pinned so the tradeoff is explicit, not accidental.
  const { edges } = run([
    [150, 0],
    [0, 1000],
    [0, 1000 + PIT_MIN_STOP_MS],
    [150, 40000],
  ]);
  assert('a stop longer than the dwell reads as a pit stop', edges.length === 2);
}

section('standing start — must not read as a pit stop');
{
  // The car is stationary on the grid long before it has ever been seen
  // racing, which is exactly the dwell condition.
  const { edges } = run([
    [0, 0],
    [0, 5000],
    [0, 10000],
    [0, 30000],         // a long pre-race wait
    [80, 31000],        // lights out
  ]);
  assert('no edges before the car has ever been racing', edges.length === 0, JSON.stringify(edges));
}

section('entry fires once, not on every stopped packet');
{
  const samples = [[150, 0], [0, 1000]];
  for (let t = 1000 + PIT_MIN_STOP_MS; t <= 30000; t += 100) samples.push([0, t]);
  const { edges } = run(samples);
  assert('exactly one entry across a whole 30 s stop', edges.length === 1 && edges[0].edge === 'enter',
    JSON.stringify(edges));
}

section('exit fires once, not on every racing packet');
{
  const samples = [[150, 0], [0, 1000], [0, 1000 + PIT_MIN_STOP_MS]];
  for (let t = 30000; t <= 40000; t += 100) samples.push([150, t]);
  const { edges } = run(samples);
  const exits = edges.filter((e) => e.edge === 'exit');
  assert('exactly one exit however long the car races on', exits.length === 1);
}

section('two stops in one race');
{
  const { edges } = run([
    [150, 0],
    [0, 10_000], [0, 10_000 + PIT_MIN_STOP_MS], [150, 40_000],
    [0, 100_000], [0, 100_000 + PIT_MIN_STOP_MS], [150, 130_000],
  ]);
  assert('four edges in entry/exit order',
    edges.map((e) => e.edge).join(',') === 'enter,exit,enter,exit', JSON.stringify(edges));
}

section('thresholds and edge cases');
{
  assert('exactly at the dwell counts',
    detectPitEdges({ phase: 'stopped', since: 0 }, 0, PIT_MIN_STOP_MS).pitDetected === true);
  assert('one ms short does not',
    detectPitEdges({ phase: 'stopped', since: 0 }, 0, PIT_MIN_STOP_MS - 1).pitDetected === false);

  // Pit-lane crawl sits between the thresholds and must hold the phase.
  const held = detectPitEdges({ phase: 'pitted', since: 0 }, 45, 50_000);
  assert('crawling in the pit lane holds the pitted phase', held.state.phase === 'pitted');
  assert('and fires nothing', held.pitDetected === false && held.pitExit === false);

  assert('speed exactly at the racing threshold is not yet racing',
    detectPitEdges({ phase: 'pitted', since: 0 }, PIT_RACING_KMH, 1000).pitExit === false);
  assert('just above it is',
    detectPitEdges({ phase: 'pitted', since: 0 }, PIT_RACING_KMH + 1, 1000).pitExit === true);
  assert('speed exactly at the stopped threshold is not stopped',
    detectPitEdges({ phase: 'running', since: 0 }, PIT_STOPPED_KMH, 1000).state.phase === 'running');

  assert('a missing speed is treated as stopped',
    detectPitEdges({ phase: 'running', since: 0 }, null, 1000).state.phase === 'stopped');
  assert('no prior state fires nothing',
    detectPitEdges(undefined, 0, 1000).pitDetected === false);
  assert('and stays empty until the car races',
    detectPitEdges(undefined, 0, 1000).state === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
