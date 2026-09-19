/**
 * The race clock: when the race started, and what the engine is fed because of it.
 *
 * Run with: node tests/test_race_clock.js
 */

import { raceProgress, applyRaceClock, formatClock } from '../src/logic/raceClock.js';

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

const T0 = 1_000_000_000_000;
const H = 3_600_000;

section('no race running');
{
  assert('null start is no clock', raceProgress(null, 8, T0) === null);
  assert('undefined start is no clock', raceProgress(undefined, 8, T0) === null);
  assert('a nonsense start is no clock', raceProgress(NaN, 8, T0) === null);
}

section('a running race');
{
  const p = raceProgress(T0, 8, T0 + 2 * H);
  assert('two hours elapsed', p.elapsedSecs === 7200, String(p.elapsedSecs));
  assert('six hours left', p.remainingSecs === 6 * 3600, String(p.remainingSecs));
  assert('not finished', p.finished === false);
  assert('the engine is told six hours, in whole minutes',
    p.remainingMins === 360, String(p.remainingMins));
}

section('the minute is the unit the engine sees');
{
  // Two moments 59 s apart inside the same minute must feed the engine the
  // same number, or the plan is recomputed every second for no reason.
  const a = raceProgress(T0, 8, T0 + 30_000);
  const b = raceProgress(T0, 8, T0 + 59_000);
  assert('a second apart changes nothing for the engine',
    a.remainingMins === b.remainingMins, `${a.remainingMins} vs ${b.remainingMins}`);

  const c = raceProgress(T0, 8, T0 + 61_000);
  assert('a minute later it does', c.remainingMins === a.remainingMins - 1,
    `${a.remainingMins} vs ${c.remainingMins}`);
}

section('the flag');
{
  const p = raceProgress(T0, 1, T0 + 2 * H);
  assert('past the end, nothing remains', p.remainingSecs === 0);
  assert('and it says so', p.finished === true);
  assert('elapsed keeps counting past the flag', p.elapsedSecs === 7200);
}

section('a clock that survived a reload, or a machine whose time moved');
{
  const p = raceProgress(T0, 8, T0 - 5000);
  assert('never reports negative elapsed', p.elapsedSecs === 0, String(p.elapsedSecs));
  assert('and never more than the race length',
    p.remainingSecs === 8 * 3600, String(p.remainingSecs));
}

section('what the engine actually runs on');
{
  const inputs = { raceDurationHours: 8, tankSize: 100 };

  assert('no race running leaves the inputs untouched, by identity',
    applyRaceClock(inputs, null) === inputs);

  const p = raceProgress(T0, 8, T0 + 2 * H);
  const eff = applyRaceClock(inputs, p);
  assert('a running race replaces the length with what is left',
    eff.raceDurationHours === 6, String(eff.raceDurationHours));
  assert('and changes nothing else', eff.tankSize === 100);
  assert('without mutating the original', inputs.raceDurationHours === 8);

  const over = raceProgress(T0, 1, T0 + 2 * H);
  assert('past the flag it stops overriding rather than asking for a zero-hour race',
    applyRaceClock(inputs, over) === inputs);
}

section('formatClock');
{
  assert('zero', formatClock(0) === '0:00:00', formatClock(0));
  assert('under a minute', formatClock(9) === '0:00:09', formatClock(9));
  assert('minutes and seconds', formatClock(605) === '0:10:05', formatClock(605));
  assert('hours', formatClock(7265) === '2:01:05', formatClock(7265));
  assert('long races keep counting in hours', formatClock(8 * 3600) === '8:00:00');
  assert('nonsense is an em dash', formatClock(NaN) === '—');
  assert('negative is an em dash', formatClock(-1) === '—');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
