/**
 * Tests for src/logic/teams.js — the multi-car display helpers: a stable
 * colour per team and staleness pruning for cars that stopped transmitting.
 *
 * The invariant that matters at a 10+ car LAN event: a car keeps the same
 * colour for the whole session, in both the leaderboard and the track map,
 * no matter how its race position moves or who drops out.
 *
 * Run with: node tests/test_teams.js
 */

import {
  TEAM_PALETTE,
  TEAM_STALE_MS,
  teamColor,
  withTeamOrder,
  isStalePacket,
  dropStaleTeams,
} from '../src/logic/teams.js';

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

section('TEAM_PALETTE — enough distinct colours for a full LAN field');
{
  assert('at least 16 colours', TEAM_PALETTE.length >= 16, `got ${TEAM_PALETTE.length}`);
  assert('every colour is unique', new Set(TEAM_PALETTE).size === TEAM_PALETTE.length);
  assert('all are hex colours', TEAM_PALETTE.every((c) => /^#[0-9A-F]{6}$/i.test(c)));
}

section('teamColor — stable, never undefined');
{
  assert('index 0 is the first colour', teamColor(0) === TEAM_PALETTE[0]);
  assert('index 9 (a 10-car field) is distinct from index 0', teamColor(9) !== teamColor(0));
  assert('the first 16 cars all get different colours',
    new Set(Array.from({ length: 16 }, (_, i) => teamColor(i))).size === 16);
  assert('wraps past the palette length', teamColor(TEAM_PALETTE.length) === TEAM_PALETTE[0]);

  // An unknown team (indexOf returned -1) must still render with a colour.
  assert('unknown team (-1) falls back rather than returning undefined', teamColor(-1) === TEAM_PALETTE[0]);
  assert('null falls back', teamColor(null) === TEAM_PALETTE[0]);
  assert('non-integer falls back', teamColor(1.5) === TEAM_PALETTE[0]);
}

section('withTeamOrder — append-only, stable references');
{
  const empty = [];
  const one = withTeamOrder(empty, '10.0.0.1');
  assert('appends a new team', one.length === 1 && one[0] === '10.0.0.1');
  assert('does not mutate the input', empty.length === 0);

  const again = withTeamOrder(one, '10.0.0.1');
  assert('re-seeing a team returns the same reference (no re-render)', again === one);

  const two = withTeamOrder(one, '10.0.0.2');
  assert('a second team is appended after the first', two[0] === '10.0.0.1' && two[1] === '10.0.0.2');
}

section('isStalePacket — only on a real timestamp');
{
  const now = 1_000_000;
  assert('fresh packet is not stale', isStalePacket({ ts: now - 1000 }, now) === false);
  assert('old packet is stale', isStalePacket({ ts: now - TEAM_STALE_MS - 1 }, now) === true);
  assert('exactly at the window is not yet stale', isStalePacket({ ts: now - TEAM_STALE_MS }, now) === false);
  assert('a packet with no ts is never stale', isStalePacket({}, now) === false);
  assert('null packet is never stale', isStalePacket(null, now) === false);
  assert('honours a custom window', isStalePacket({ ts: now - 500 }, now, 100) === true);
}

section('dropStaleTeams — prunes the dead, keeps references stable');
{
  const now = 1_000_000;
  const live = { ts: now - 500 };
  const dead = { ts: now - TEAM_STALE_MS - 1 };

  const allLive = new Map([['a', live], ['b', live]]);
  assert('returns the same Map when nothing is stale (no re-render)',
    dropStaleTeams(allLive, now) === allLive);

  const mixed = new Map([['a', live], ['b', dead], ['c', live]]);
  const pruned = dropStaleTeams(mixed, now);
  assert('drops only the stale car', pruned.size === 2 && !pruned.has('b'));
  assert('keeps the live cars', pruned.has('a') && pruned.has('c'));
  assert('does not mutate the input Map', mixed.size === 3);
}

section('colour survives pruning — the reason team order is append-only');
{
  // Three cars arrive; the middle one drops out. The third car must keep the
  // colour it had, or every remaining car would visibly change colour mid-race.
  let order = [];
  for (const ip of ['a', 'b', 'c']) order = withTeamOrder(order, ip);
  const colorCBefore = teamColor(order.indexOf('c'));

  const now = 1_000_000;
  const teams = new Map([
    ['a', { ts: now }],
    ['b', { ts: now - TEAM_STALE_MS - 1 }],
    ['c', { ts: now }],
  ]);
  const pruned = dropStaleTeams(teams, now);
  assert('car b is gone from the display', !pruned.has('b'));

  // Order is untouched by pruning — that is the whole point.
  const colorCAfter = teamColor(order.indexOf('c'));
  assert('car c keeps its colour after car b drops out', colorCAfter === colorCBefore);
  assert('car a keeps its colour too', teamColor(order.indexOf('a')) === TEAM_PALETTE[0]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
