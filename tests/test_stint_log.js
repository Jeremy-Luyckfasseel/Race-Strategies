/**
 * Tests for the pure stint-log state machine in src/logic/stintLog.js — the
 * "Drivers" tab's bookkeeping: stint open/close, per-lap average/best/worst
 * folding, compound sync, and driver (re)assignment.
 *
 * Run with: node tests/test_stint_log.js
 */

import { emptyEntry, openStint, closeStint, reopenStint, recordLap, recordLapIfClean, setCompound, assignDriver, assignDriverAt, stintLapRange } from '../src/logic/stintLog.js';

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

section('reopenStint — defends against a missed pitDetected packet');
{
  // Normal case: current stint already closed, reopenStint behaves like openStint.
  let entry = closeStint(openStint(emptyEntry(), { driverId: 'd1', compound: 'H', startLap: 1, now: 0 }), { endLap: 20, now: 20000 });
  entry = reopenStint(entry, { compound: 'S', startLap: 20, now: 20000 });
  assert('normal reopen keeps prior history and opens a fresh stint', entry.history.length === 1 && entry.current.compound === 'S' && entry.current.driverId === null);

  // Defensive case: pitDetected was never seen, so `current` is still open when pitExit fires.
  let missed = openStint(emptyEntry(), { driverId: 'd1', compound: 'H', startLap: 1, now: 0 });
  missed = recordLap(missed, 120000);
  missed = reopenStint(missed, { compound: 'M', startLap: 25, now: 25000 });
  assert('the stint that never got a pitDetected is archived, not lost', missed.history.length === 1, `got ${missed.history.length}`);
  assert('archived stint keeps its driver and lap data', missed.history[0].driverId === 'd1' && missed.history[0].lapCount === 1);
  assert('archived stint is closed at this pit exit\'s lap', missed.history[0].endLap === 25);
  assert('a fresh stint is opened for the new compound', missed.current.compound === 'M' && missed.current.driverId === null);
}

section('recordLapIfClean — excludes the out-lap and paused/off-track laps');
{
  let entry = openStint(emptyEntry(), { startLap: 10, now: 0 });

  entry = recordLapIfClean(entry, { lapMs: 999000, currentLap: 11 });
  assert('the out-lap (startLap + 1) is skipped', entry.current.lapCount === 0, `got ${entry.current.lapCount}`);

  entry = recordLapIfClean(entry, { lapMs: 999000, currentLap: 12, paused: true });
  assert('a lap that was paused when it completed is skipped', entry.current.lapCount === 0);

  entry = recordLapIfClean(entry, { lapMs: 999000, currentLap: 12, onTrack: false });
  assert('a lap that was off track when it completed is skipped', entry.current.lapCount === 0);

  entry = recordLapIfClean(entry, { lapMs: 100000, currentLap: 12 });
  assert('a normal, clean lap is recorded', entry.current.lapCount === 1 && entry.current.lapMsSum === 100000);

  const noStint = emptyEntry();
  assert('no-op with no active stint', recordLapIfClean(noStint, { lapMs: 100000, currentLap: 1 }) === noStint);
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

section('stintLapRange — the laps a stint owns, exclusive of its closing lap');
{
  // Adjacent stints SHARE the pit lap: closeStint takes endLap: currentLap on
  // pit entry and reopenStint takes startLap: currentLap on pit exit, the same
  // game lap. With both ends inclusive that lap belonged to two stints at once.
  let e = openStint(emptyEntry(), { compound: 'M', startLap: 1, startTime: 0, driverId: 'd1' });
  e = closeStint(e, { endLap: 20 });
  e = reopenStint(e, { compound: 'S', startLap: 20, startTime: 1000 });

  const first = stintLapRange(e, 0);
  const second = stintLapRange(e, 1, 33);

  assert('the finished stint starts where it opened', first.fromLap === 1, JSON.stringify(first));
  assert('and ends the lap BEFORE it closed', first.toLap === 19, JSON.stringify(first));
  assert('the running stint starts on the pit lap', second.fromLap === 20, JSON.stringify(second));
  assert('and ends the lap before the one in progress', second.toLap === 32, JSON.stringify(second));
  assert('so the two do not overlap', first.toLap < second.fromLap,
    `${first.toLap} vs ${second.fromLap}`);

  // This is what the overlap cost: the learner sets currentDriverId when the
  // RUNNING stint's startLap falls inside a reassigned range. Stint 0's range
  // used to end on 20, which is stint 1's startLap, so correcting the stint
  // that had just ended silently repointed every lap from then on.
  assert('correcting the old stint cannot claim the running one is startLap',
    !(second.fromLap >= first.fromLap && second.fromLap <= first.toLap));

  // A stint that closed on the lap it opened recorded nothing: the learner
  // files a lap when the NEXT one starts.
  let z = openStint(emptyEntry(), { compound: 'M', startLap: 7, startTime: 0 });
  z = closeStint(z, { endLap: 7 });
  assert('a stint with no completed lap has no range', stintLapRange(z, 0) === null);

  assert('no entry, no range', stintLapRange(null, 0) === null);
  assert('an index past the end has no range', stintLapRange(e, 9, 33) === null);
  // The running stint has no end of its own, so without the car's lap the range
  // would be open and would swallow laps that have not happened.
  assert('the running stint needs the current lap', stintLapRange(e, 1) === null);
}

section('assignDriverAt — naming a stint after the fact');
{
  let e = openStint(emptyEntry(), { compound: 'M', startLap: 1, startTime: 0, driverId: null });
  e = closeStint(e, { endLap: 20 });
  // reopenStint always opens with driverId: null — the driver is named by the
  // human at the stop, never carried over from the stint before.
  e = reopenStint(e, { compound: 'S', startLap: 20, startTime: 1000 });
  e = assignDriver(e, 'd2');

  const named = assignDriverAt(e, 0, 'd1');
  assert('the finished stint takes the name', named.history[0].driverId === 'd1');
  assert('and the running one is untouched', named.current.driverId === 'd2');

  const runner = assignDriverAt(e, 1, 'd3');
  assert('the running stint can be named too', runner.current.driverId === 'd3');
  assert('without touching the finished one', runner.history[0].driverId === null);

  assert('naming it what it already is changes nothing',
    assignDriverAt(named, 0, 'd1') === named);
  assert('an index past the end changes nothing', assignDriverAt(e, 9, 'd1') === e);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
