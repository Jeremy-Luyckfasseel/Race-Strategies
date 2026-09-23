/**
 * Catching a followed rival's tyre while it is visible, and what each car
 * still owes of the must-run tyres.
 *
 * Run with: node tests/test_pit_watch.js
 */

import { stepPitWatch, resolvePitWatch, openPitAsks } from '../src/logic/pitWatch.js';
import { tyresOwed } from '../src/logic/mandatoryTyres.js';

const asking = (s, ip) => openPitAsks(s).some(([k]) => k === ip);

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

const followed = new Set(['a']);
const opts = (compounds = { a: 'M', b: 'H' }) => ({
  isWatched: (ip) => followed.has(ip),
  compoundOf: (ip) => compounds[ip] ?? null,
});
const teams = (a, b = { currentLap: 10 }) => new Map([['a', a], ['b', b]]);

section('asked from the pit entry, only for cars I follow');
{
  let s = new Map();
  let r = stepPitWatch(s, teams({ currentLap: 10, pitDetected: true }, { currentLap: 10, pitDetected: true }), opts());
  assert('a followed car in the pits is asked about', r.state.get('a')?.phase === 'in', JSON.stringify([...r.state]));
  assert('one I do not follow is not', !r.state.has('b'));
  assert('it remembers what it was on before', r.state.get('a').prevCompound === 'M');
  s = r.state;

  // The flag stays up for a packet or two: asking once is enough.
  r = stepPitWatch(s, teams({ currentLap: 10, pitDetected: true }), opts());
  assert('a repeated entry flag does not restart it', r.changed === false);
}

section('still asked after the exit, for one lap');
{
  let s = stepPitWatch(new Map(), teams({ currentLap: 10, pitDetected: true }), opts()).state;
  s = stepPitWatch(s, teams({ currentLap: 11, pitExit: true }), opts()).state;
  assert('out of the pits, still asked', s.get('a')?.phase === 'out' && s.get('a').exitLap === 11,
    JSON.stringify([...s]));

  let r = stepPitWatch(s, teams({ currentLap: 11 }), opts());
  assert('during the out-lap, still asked', r.state.has('a') && r.expired.length === 0);

  r = stepPitWatch(s, teams({ currentLap: 12 }), opts());
  assert('a lap later, it stops asking', !asking(r.state, 'a'));
  assert('and puts it back on the tyre it had', r.expired.length === 1 && r.expired[0].compound === 'M',
    JSON.stringify(r.expired));
}

section('answered, dismissed, or unfollowed');
{
  const s = stepPitWatch(new Map(), teams({ currentLap: 10, pitDetected: true }), opts()).state;
  const answered = resolvePitWatch(s, 'a');
  assert('answering stops the question', !asking(answered, 'a'));
  // The entry flag rides on the car's latest packet until the next one: an
  // answer given before that packet arrives must not be asked again.
  const stale = stepPitWatch(answered, teams({ currentLap: 10, pitDetected: true }), opts());
  assert('the same stop is not asked again', !asking(stale.state, 'a'));
  const exitAfter = stepPitWatch(answered, teams({ currentLap: 11, pitExit: true }), opts());
  assert('nor at its exit', !asking(exitAfter.state, 'a'));
  const nextStop = stepPitWatch(answered, teams({ currentLap: 30, pitDetected: true }), opts());
  assert('but the next stop is', asking(nextStop.state, 'a'));

  followed.delete('a');
  const r = stepPitWatch(s, teams({ currentLap: 10 }), opts());
  assert('unfollowing mid-stop stops it too', !asking(r.state, 'a') && r.expired.length === 0);
  followed.add('a');
}

section('a missed entry is still a stop');
{
  const r = stepPitWatch(new Map(), teams({ currentLap: 11, pitExit: true }), opts());
  assert('asked from the exit instead', r.state.get('a')?.phase === 'out' && r.state.get('a').prevCompound === 'M');
}

section('what each car still owes of the must-run tyres');
{
  const run = (list, current = null) => ({ history: list.map((c) => ({ compound: c })), current: current && { compound: current } });
  const owed = tyresOwed(run(['M'], 'M'), ['M', 'H']);
  assert('mediums run, hards owed', owed.owed.join() === 'H' && owed.unknownStints === 0, JSON.stringify(owed));
  assert('both run, nothing owed', tyresOwed(run(['M'], 'H'), ['M', 'H']).owed.length === 0);
  const blind = tyresOwed(run([null], 'M'), ['M', 'H']);
  assert('a stint with no tyre set is counted as unknown', blind.owed.join() === 'H' && blind.unknownStints === 1,
    JSON.stringify(blind));
  assert('no must-run tyres in the rules, nothing to say', tyresOwed(run(['M']), []) === null);
  assert('a car with no stints yet, nothing to say', tyresOwed({ history: [], current: null }, ['H']) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
