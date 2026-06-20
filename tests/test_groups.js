/**
 * Tests for src/logic/groups.js — the pure team Groups → Races → sessions model.
 * Run with: node tests/test_groups.js
 */

import {
  emptyGroupsState,
  createGroup,
  renameGroup,
  deleteGroup,
  setActiveGroup,
  addRace,
  renameRace,
  deleteRace,
  setActiveRace,
  setRaceSessions,
  setRaceFolder,
  setGroupSync,
  getActiveGroup,
  getActiveRace,
} from '../src/logic/groups.js';

let passed = 0;
let failed = 0;
function assert(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}
function section(n) {
  console.log(`\n── ${n} ──`);
}

section('groups + races CRUD (pure, deterministic ids)');
{
  let s = emptyGroupsState();
  assert('starts empty', s.groups.length === 0 && s.activeGroupId === null);

  s = createGroup(s, 'Night Owls');
  assert('group created + active', s.groups.length === 1 && getActiveGroup(s).name === 'Night Owls');
  const gid = s.activeGroupId;
  assert('deterministic group id', gid === 'g1');

  s = addRace(s, gid, 'Spa 6h');
  s = addRace(s, gid, 'Le Mans');
  assert('two races added', getActiveGroup(s).races.length === 2);
  assert('race ids deterministic', getActiveGroup(s).races.map((r) => r.id).join() === 'r1,r2');
  assert('latest race is active', getActiveRace(s).name === 'Le Mans');

  s = setActiveRace(s, 'r1');
  assert('switch active race', getActiveRace(s).name === 'Spa 6h');

  s = renameRace(s, gid, 'r1', 'Spa 6 Hours');
  assert('race renamed', getActiveRace(s).name === 'Spa 6 Hours');

  s = renameGroup(s, gid, 'The Night Owls');
  assert('group renamed', getActiveGroup(s).name === 'The Night Owls');
}

section('sessions + folder on a race');
{
  let s = createGroup(emptyGroupsState(), 'T');
  const gid = s.activeGroupId;
  s = addRace(s, gid, 'R');
  const rid = s.activeRaceId;

  const sessions = [
    { id: 's1', driver: 'Alice', analysis: { fuel: { value: 3 } } },
    { id: 's2', driver: 'Bob', analysis: { fuel: { value: 3.1 } } },
  ];
  s = setRaceSessions(s, gid, rid, sessions);
  assert('sessions stored on race', getActiveRace(s).sessions.length === 2);
  assert('driver names kept', getActiveRace(s).sessions.map((x) => x.driver).join() === 'Alice,Bob');

  s = setRaceFolder(s, gid, rid, 'Dropbox/TeamT/RaceR');
  assert('folder name remembered', getActiveRace(s).folderName === 'Dropbox/TeamT/RaceR');

  s = setGroupSync(s, gid, { serverUrl: 'https://sync.example', code: 'AbC123' });
  assert('group sync connection stored', getActiveGroup(s).sync.code === 'AbC123');

  // Replacing sessions (e.g. re-reading the folder) overwrites cleanly.
  s = setRaceSessions(s, gid, rid, [sessions[0]]);
  assert('sessions replaced', getActiveRace(s).sessions.length === 1);
}

section('deletion keeps active pointers valid');
{
  let s = createGroup(emptyGroupsState(), 'A');
  s = createGroup(s, 'B'); // active = B (g2)
  const a = s.groups[0].id;
  s = addRace(s, a, 'A-race');
  s = setActiveGroup(s, a); // active group A, its race active
  s = addRace(s, a, 'A-race2');
  assert('active race set when switching group', getActiveRace(s) != null);

  s = deleteRace(s, a, s.activeRaceId);
  assert('after deleting active race, a valid race remains active', getActiveRace(s) != null);

  s = deleteGroup(s, a);
  assert('after deleting active group, falls back to another', getActiveGroup(s) != null && getActiveGroup(s).name === 'B');

  s = deleteGroup(s, s.activeGroupId);
  assert('deleting last group → none active', s.groups.length === 0 && s.activeGroupId === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
