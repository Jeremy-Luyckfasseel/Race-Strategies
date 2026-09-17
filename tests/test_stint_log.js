/**
 * Tests for the pure stint-log state machine in src/logic/stintLog.js — the
 * "Drivers" tab's bookkeeping: stint open/close, per-lap average/best/worst
 * folding, compound sync, and driver (re)assignment.
 *
 * Run with: node tests/test_stint_log.js
 */

import { emptyEntry, openStint, closeStint, recordLap, setCompound, assignDriver } from '../src/logic/stintLog.js';

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

section('openStint / closeStint — stint boundaries');
{
  let entry = emptyEntry();
  assert('starts empty', entry.history.length === 0 && entry.current === null);

  entry = openStint(entry, { driverId: 'd1', compound: 'H', startLap: 1, now: 1000 });
  assert('open sets current', entry.current.driverId === 'd1' && entry.current.compound === 'H' && entry.current.startLap === 1);

  entry = recordLap(entry, 120000);
  entry = recordLap(entry, 118000);
  entry = closeStint(entry, { endLap: 10, now: 1000 + 240000 });
  assert('close moves current into history', entry.current === null && entry.history.length === 1);
  const st = entry.history[0];
  assert('duration derived from now - startTime', st.durationSecs === 240, `got ${st.durationSecs}`);
  assert('avg lap time is the mean of recorded laps', st.avgLapMs === 119000, `got ${st.avgLapMs}`);
  assert('endLap recorded', st.endLap === 10);
}

section('recordLap — best/worst tracking without keeping every lap');
{
  let entry = openStint(emptyEntry(), { startLap: 1, now: 0 });
  entry = recordLap(entry, 100000);
  entry = recordLap(entry, 95000);
  entry = recordLap(entry, 105000);
  assert('best is the minimum lap seen', entry.current.bestLapMs === 95000);
  assert('worst is the maximum lap seen', entry.current.worstLapMs === 105000);
  assert('lapCount tracks laps, not a stored array', entry.current.lapCount === 3);
  assert('no per-lap array is retained', !('laps' in entry.current));
}

section('closeStint — a stint with zero recorded laps has no average');
{
  let entry = openStint(emptyEntry(), { startLap: 1, now: 0 });
  entry = closeStint(entry, { endLap: 1, now: 5000 });
  assert('avgLapMs is null with no laps folded in', entry.history[0].avgLapMs === null);
}

section('setCompound — only fills in the compound once, never overwrites');
{
  let entry = openStint(emptyEntry(), { compound: null, startLap: 1, now: 0 });
  entry = setCompound(entry, 'M');
  assert('fills unknown compound', entry.current.compound === 'M');
  entry = setCompound(entry, 'S');
  assert('does not overwrite an already-known compound', entry.current.compound === 'M');
}

section('setCompound — no-op without an active stint');
{
  const entry = emptyEntry();
  assert('returns the same entry when there is no current stint', setCompound(entry, 'H') === entry);
}

section('assignDriver — sets driver on the active stint, no-op otherwise');
{
  let entry = openStint(emptyEntry(), { driverId: null, startLap: 1, now: 0 });
  entry = assignDriver(entry, 'd2');
  assert('assigns the chosen driver', entry.current.driverId === 'd2');

  const closed = emptyEntry();
  assert('no-op with no active stint', assignDriver(closed, 'd3') === closed);
}

section('mandatory-compound-style scenario — a full pit cycle preserves prior history');
{
  let entry = openStint(emptyEntry(), { driverId: 'd1', compound: 'H', startLap: 1, now: 0 });
  entry = recordLap(entry, 120000);
  entry = closeStint(entry, { endLap: 20, now: 20 * 120000 });
  entry = openStint(entry, { driverId: null, compound: null, startLap: 20, now: entry.history[0].durationSecs * 1000 });
  entry = assignDriver(entry, 'd2');
  entry = setCompound(entry, 'S');
  assert('prior stint stays in history across the new stint', entry.history.length === 1 && entry.history[0].driverId === 'd1');
  assert('new stint gets the newly assigned driver', entry.current.driverId === 'd2');
  assert('new stint gets the confirmed compound', entry.current.compound === 'S');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
