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
  coalescePacket,
  resolveActiveCars,
  stableCarId,
 isFollowed, } from '../src/logic/teams.js';

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

section('resolveActiveCars — inspecting a rival must not repoint my strategy');
{
  const field = ['a', 'b', 'c'];

  const mine = resolveActiveCars({ myTeamIp: 'b', teamKeys: field });
  assert('my team drives the strategy', mine.strategyIp === 'b');
  assert('and is shown by default', mine.displayIp === 'b');

  // The whole point: clicking a rival to inspect them must leave the strategy alone.
  const peeking = resolveActiveCars({ myTeamIp: 'b', selectedIp: 'c', teamKeys: field });
  assert('inspecting a rival changes only the displayed car', peeking.displayIp === 'c');
  assert('my strategy still points at my own car', peeking.strategyIp === 'b');

  // A single car needs no ceremony.
  const solo = resolveActiveCars({ teamKeys: ['only'] });
  assert('a lone car is assumed to be mine', solo.strategyIp === 'only' && solo.displayIp === 'only');

  // DECISION 4 — never auto-pick among several.
  const crowd = resolveActiveCars({ teamKeys: field });
  assert('a full field with no team marked picks nothing', crowd.strategyIp === null && crowd.displayIp === null);
  assert('but an explicit click still shows that car',
    resolveActiveCars({ selectedIp: 'a', teamKeys: field }).displayIp === 'a');

  // My car being off or in the garage does not make it stop being mine.
  const offline = resolveActiveCars({ myTeamIp: 'gone', teamKeys: field });
  assert('a team marked mine stays mine while not transmitting', offline.strategyIp === 'gone');

  assert('no teams at all resolves to nothing',
    resolveActiveCars({}).strategyIp === null);
}

section('stableCarId — a DHCP lease change must not create a new car');
{
  const IP = '192.168.1.44';

  // Nothing known but the address.
  assert('falls back to the address when that is all there is',
    stableCarId(undefined, undefined, IP) === IP);

  // The scan found a name for a console the user registered by bare IP. This
  // is the case that matters: auto-detect registers addresses, so without
  // this the identity moves the moment DHCP hands out a different one.
  assert('a scanned hostname is preferred over a bare address',
    stableCarId(IP, 'PS5-642', IP) === 'PS5-642');

  // Same console, new address after a lease change — same identity.
  assert('so the same console keeps its identity on a new address',
    stableCarId('10.0.0.9', 'PS5-642', '10.0.0.9') === 'PS5-642');

  // An explicitly registered name always wins; the user said what to call it.
  assert('an explicitly registered name is honoured',
    stableCarId('Night Shift', 'PS5-642', IP) === 'Night Shift');
  assert('even with no scan result', stableCarId('Night Shift', undefined, IP) === 'Night Shift');

  assert('an address registered with no hostname anywhere stays the address',
    stableCarId(IP, null, IP) === IP);
}

section('coalescePacket — a pit edge must survive the flush window');
{
  // The relay sets pitDetected/pitExit on exactly ONE packet. At ~60 Hz several
  // packets land inside one 50 ms flush window, so overwriting outright would
  // throw the edge away — no compound clear, no driver prompt, no stint break.
  const entry = { ps5ip: 'a', speedKmh: 3, pitDetected: true, ts: 1 };
  const after = { ps5ip: 'a', speedKmh: 4, ts: 2 };
  const merged = coalescePacket(entry, after);
  assert('pitDetected is carried forward onto the newer packet', merged.pitDetected === true);
  assert('the newer packet\'s own values still win', merged.speedKmh === 4 && merged.ts === 2);
  assert('the earlier packet is not mutated', after.pitDetected === undefined);

  const exit = { ps5ip: 'a', speedKmh: 70, pitExit: true, ts: 1 };
  assert('pitExit is carried forward too',
    coalescePacket(exit, { ps5ip: 'a', speedKmh: 80, ts: 2 }).pitExit === true);

  // Three packets in one window, the edge on the first — the realistic case.
  let buffered = { ps5ip: 'a', pitExit: true, speedKmh: 61, ts: 1 };
  buffered = coalescePacket(buffered, { ps5ip: 'a', speedKmh: 70, ts: 2 });
  buffered = coalescePacket(buffered, { ps5ip: 'a', speedKmh: 82, ts: 3 });
  assert('edge survives three coalesces in one window', buffered.pitExit === true);
  assert('and still reports the newest speed', buffered.speedKmh === 82);

  assert('first packet for a car passes straight through',
    coalescePacket(undefined, after) === after);
  assert('no edge flags means no needless copy',
    coalescePacket({ ps5ip: 'a', ts: 1 }, after) === after);
  assert('an edge on the newer packet is kept',
    coalescePacket({ ps5ip: 'a', ts: 1 }, { ps5ip: 'a', pitDetected: true, ts: 2 }).pitDetected === true);
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

section('whose stops reach me');
{
  const none = new Set();
  assert('with nobody followed, every rival does', isFollowed('b', 'a', none) && isFollowed('c', 'a', null));
  const two = new Set(['b', 'c']);
  assert('once some are followed, those do', isFollowed('b', 'a', two) && isFollowed('c', 'a', two));
  assert('and the rest do not', !isFollowed('d', 'a', two));
  assert('my own car always does, followed or not', isFollowed('a', 'a', two));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
