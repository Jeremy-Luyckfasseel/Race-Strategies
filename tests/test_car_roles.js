/**
 * Car roles: keeping the safety car out of the race it is not in.
 *
 * Run with: node tests/test_car_roles.js
 */

import {
  ROLE_SAFETY, roleOf, isSafetyCar, toggleSafetyCar, splitByRole,
  safetyCarDeployed, fieldSlowdown, pitLossUnderSafetyCar,
} from '../src/logic/carRoles.js';

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

const SC = '10.0.0.9';
const rows = (...ips) => ips.map((ip) => ({ ip, d: {} }));

// ────────────────────────────────────────────────────────────────────────────

section('a car is a competitor unless someone says otherwise');
{
  assert('unmarked is a competitor', roleOf({}, 'a') === 'competitor');
  assert('no roles at all is still a competitor', roleOf(null, 'a') === 'competitor');
  assert('marked is the safety car', isSafetyCar({ [SC]: ROLE_SAFETY }, SC));
  assert('and rubbish in the map is not', roleOf({ a: 'marshal' }, 'a') === 'competitor');
}

section('marking and unmarking');
{
  const once = toggleSafetyCar({}, SC);
  assert('marks it', isSafetyCar(once, SC));
  const twice = toggleSafetyCar(once, SC);
  assert('and unmarks it', !isSafetyCar(twice, SC));
  assert('without leaving the key behind', !(SC in twice));
  assert('the original is untouched', isSafetyCar(once, SC));
}

section('the standings count competitors only');
{
  const { competitors, safety } = splitByRole(rows('a', 'b', SC, 'c'), { [SC]: ROLE_SAFETY });

  assert('the safety car is out of the race', competitors.length === 3);
  assert('and kept aside rather than dropped', safety.length === 1 && safety[0].ip === SC);
  assert('the order of the rest is preserved',
    competitors.map((r) => r.ip).join(',') === 'a,b,c');
  assert('and they are renumbered without a hole in the middle',
    competitors.map((r) => r.position).join(',') === '1,2,3',
    competitors.map((r) => r.position).join(','));
}

section('with no safety car marked, nothing changes but the numbering');
{
  const { competitors, safety } = splitByRole(rows('a', 'b', 'c'), {});
  assert('everyone races', competitors.length === 3 && safety.length === 0);
  assert('numbered in order', competitors.map((r) => r.position).join(',') === '1,2,3');
}

section('deployment is leaving the pit lane');
{
  const roles = { [SC]: ROLE_SAFETY };
  const field = (scState) => new Map([
    ['a', { onTrack: true, speedKmh: 180 }],
    [SC, scState],
  ]);

  assert('parked in the pits is not deployed',
    safetyCarDeployed(field({ onTrack: false, speedKmh: 0 }), roles) === null);
  assert('nor is crawling around the garage',
    safetyCarDeployed(field({ onTrack: false, speedKmh: 30 }), roles) === null);
  assert('nor is sitting on track at a standstill',
    safetyCarDeployed(field({ onTrack: true, speedKmh: 0 }), roles) === null);
  assert('but out and running is',
    safetyCarDeployed(field({ onTrack: true, speedKmh: 80 }), roles) === SC);

  assert('a fast competitor is never mistaken for it',
    safetyCarDeployed(new Map([['a', { onTrack: true, speedKmh: 200 }]]), roles) === null);
  assert('and an empty field is not a deployment',
    safetyCarDeployed(new Map(), roles) === null);
}

section('how slow the field is running');
{
  const roles = { [SC]: ROLE_SAFETY };

  // Green flag: everyone near their best.
  const green = new Map([
    ['a', { lastLapMs: 90_500, bestLapMs: 90_000 }],
    ['b', { lastLapMs: 91_000, bestLapMs: 90_000 }],
    ['c', { lastLapMs: 90_200, bestLapMs: 90_000 }],
  ]);
  const g = fieldSlowdown(green, roles);
  assert('barely above one under green', g > 1 && g < 1.02, String(g));

  // Safety car: everyone slow at once.
  const slowed = new Map([
    ['a', { lastLapMs: 135_000, bestLapMs: 90_000 }],
    ['b', { lastLapMs: 133_000, bestLapMs: 90_000 }],
    ['c', { lastLapMs: 136_000, bestLapMs: 90_000 }],
    [SC, { lastLapMs: 140_000, bestLapMs: 140_000 }],
  ]);
  const s = fieldSlowdown(slowed, roles);
  assert('about fifty per cent slower under the safety car',
    Math.abs(s - 1.5) < 0.05, String(s));

  // One car having a shocker must not look like a safety car.
  const oneBad = new Map([
    ['a', { lastLapMs: 90_200, bestLapMs: 90_000 }],
    ['b', { lastLapMs: 150_000, bestLapMs: 90_000 }],
    ['c', { lastLapMs: 90_400, bestLapMs: 90_000 }],
  ]);
  assert('the median ignores it', fieldSlowdown(oneBad, roles) < 1.02,
    String(fieldSlowdown(oneBad, roles)));

  assert('one car is not a field', fieldSlowdown(new Map([['a', { lastLapMs: 9, bestLapMs: 9 }]]), roles) === null);
  assert('and cars with no lap yet say nothing',
    fieldSlowdown(new Map([['a', {}], ['b', {}]]), roles) === null);
}

section('what a stop costs while the field is slowed');
{
  // A 52 s green-flag loss, with the field running 50% slower.
  assert('the stop is worth about a third less',
    Math.abs(pitLossUnderSafetyCar(52, 1.5) - 34.67) < 0.1,
    String(pitLossUnderSafetyCar(52, 1.5)));
  assert('a barely-slowed field is not a discount',
    pitLossUnderSafetyCar(52, 1.02) === null);
  assert('nor is no slowdown figure at all',
    pitLossUnderSafetyCar(52, null) === null);
  assert('and a free stop is not a discount', pitLossUnderSafetyCar(0, 1.5) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
