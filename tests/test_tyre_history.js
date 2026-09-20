/**
 * Reading the stint log back as tyre history.
 *
 * Run with: node tests/test_tyre_history.js
 */

import { tyreHistory, currentSetOutlook } from '../src/logic/tyreHistory.js';
import {
  emptyEntry, openStint, closeStint, recordLap, stintFalloffMs,
} from '../src/logic/stintLog.js';

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

/** Run a stint: open, drive `laps` clean laps at the given times, close. */
function runStint(entry, { compound, startLap, lapTimes }) {
  let e = openStint(entry, { compound, startLap, now: 0 });
  for (const ms of lapTimes) e = recordLap(e, ms);
  return closeStint(e, { endLap: startLap + lapTimes.length, now: lapTimes.length * 120_000 });
}

// ────────────────────────────────────────────────────────────────────────────

section('nothing recorded, nothing claimed');
{
  assert('no entry is an empty history', tyreHistory(null).size === 0);
  assert('an empty log too', tyreHistory(emptyEntry()).size === 0);
  assert('and no outlook', currentSetOutlook(emptyEntry(), 'H', 5) === null);
}

section('fall-off is measured from the ends of the stint');
{
  // Ten laps degrading from 2:00 to 2:03.
  const times = [120, 120.2, 120.4, 121, 121.4, 121.8, 122.4, 122.8, 123, 123.2]
    .map((s) => s * 1000);
  const e = runStint(emptyEntry(), { compound: 'H', startLap: 1, lapTimes: times });
  const stint = e.history[0];

  // opening = first three (120, 120.2, 120.4 → 120.2), closing = last three
  // (122.8, 123, 123.2 → 123.0). Fall-off ≈ 2.8 s.
  assert('it is the closing pace minus the opening pace',
    Math.abs(stint.falloffMs - 2_800) < 50, String(stint.falloffMs));

  // A short stint would use the same laps at both ends, so it says nothing.
  const short = runStint(emptyEntry(), { compound: 'H', startLap: 1, lapTimes: times.slice(0, 4) });
  assert('a stint too short to have two distinct ends reports nothing',
    short.history[0].falloffMs === null, String(short.history[0].falloffMs));
  assert('and the helper agrees', stintFalloffMs(short.history[0]) === null);
}

section('two stints on the same compound');
{
  const laps = (n, base) => Array.from({ length: n }, (_, i) => (base + i * 0.2) * 1000);
  let e = runStint(emptyEntry(), { compound: 'H', startLap: 1, lapTimes: laps(20, 120) });
  e = runStint(e, { compound: 'M', startLap: 21, lapTimes: laps(14, 118) });
  e = runStint(e, { compound: 'H', startLap: 35, lapTimes: laps(18, 120.5) });

  const h = tyreHistory(e).get('H');
  assert('both Hard stints are counted', h.completed === 2, String(h.completed));
  assert('with the laps each one gave', h.laps.join(',') === '20,18', h.laps.join(','));
  assert('and the total', h.totalLaps === 38, String(h.totalLaps));
  assert('the best lap across them', Math.abs(h.bestMs - 120_000) < 1, String(h.bestMs));
  assert('and a typical set length', h.typicalLaps === 19, String(h.typicalLaps));

  const m = tyreHistory(e).get('M');
  assert('the Medium stint is kept separate', m.completed === 1 && m.laps[0] === 14);
}

section('one odd stint does not become the expectation');
{
  const laps = (n) => Array.from({ length: n }, () => 120_000);
  let e = runStint(emptyEntry(), { compound: 'S', startLap: 1, lapTimes: laps(18) });
  // Cut short after three laps — a spin, a safety car, a red flag.
  e = runStint(e, { compound: 'S', startLap: 19, lapTimes: laps(3) });
  e = runStint(e, { compound: 'S', startLap: 22, lapTimes: laps(20) });

  const s = tyreHistory(e).get('S');
  assert('the median ignores the stint that was cut short',
    s.typicalLaps === 18, `${s.typicalLaps} from ${s.laps.join(',')}`);
}

section('the stint being driven right now');
{
  const laps = (n) => Array.from({ length: n }, () => 120_000);
  let e = runStint(emptyEntry(), { compound: 'H', startLap: 1, lapTimes: laps(20) });
  e = openStint(e, { compound: 'H', startLap: 21, now: 0 });
  for (const ms of laps(8)) e = recordLap(e, ms);

  const h = tyreHistory(e, 29).get('H');
  assert('it is counted as a stint', h.stints === 3 - 1, String(h.stints));
  assert('but not as a completed one', h.completed === 1, String(h.completed));
  assert('so it cannot drag down how long a set lasts',
    h.typicalLaps === 20, String(h.typicalLaps));
  assert('and its laps so far are reported', h.liveLaps === 8, String(h.liveLaps));

  const look = currentSetOutlook(e, 'H', 29);
  assert('the outlook knows what to expect', look.typicalLaps === 20);
  assert('how far in we are', look.lapsDone === 8);
  assert('and what is left', look.lapsLeft === 12, String(look.lapsLeft));
  assert('without claiming we are past it', look.beyondPrevious === false);
}

section('past what the last set managed');
{
  const laps = (n) => Array.from({ length: n }, () => 120_000);
  let e = runStint(emptyEntry(), { compound: 'M', startLap: 1, lapTimes: laps(12) });
  e = openStint(e, { compound: 'M', startLap: 13, now: 0 });

  const look = currentSetOutlook(e, 'M', 13 + 15);
  assert('it says so', look.beyondPrevious === true);
  assert('and stops at zero rather than going negative', look.lapsLeft === 0);
}

section('the first set of a compound predicts nothing');
{
  let e = openStint(emptyEntry(), { compound: 'W', startLap: 1, now: 0 });
  e = recordLap(e, 140_000);
  assert('no previous set, no outlook', currentSetOutlook(e, 'W', 4) === null);

  const w = tyreHistory(e, 4).get('W');
  assert('though the running stint is still visible', w.liveLaps === 3, String(w.liveLaps));
}

section('a stint with no compound set is not attributed to one');
{
  let e = openStint(emptyEntry(), { compound: null, startLap: 1, now: 0 });
  e = recordLap(e, 120_000);
  e = closeStint(e, { endLap: 10, now: 1 });
  assert('it is skipped rather than bucketed under undefined', tyreHistory(e).size === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
