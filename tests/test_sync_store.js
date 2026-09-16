/**
 * Tests for server/sync-store.js — the filesystem store for the team sync server.
 * Uses a throwaway temp directory. Run with: node tests/test_sync_store.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGroup, getGroup, addRace, listRaces, putSession, listSessions } from '../server/sync-store.js';

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt7sync-'));
const cap = (driver) => ({ meta: { tankCapacityL: 100, driver }, laps: [{ lap: 1, lapTimeSec: 120, fuelUsedL: 3, compound: 'M' }], events: [] });

section('groups + races (multi-team isolation via join code)');
{
  const g = createGroup(root, 'Night Owls');
  assert('group created with a code', !!g.code && g.name === 'Night Owls');
  assert('group fetched by code', getGroup(root, g.code)?.name === 'Night Owls');
  assert('unknown code → null', getGroup(root, 'nope-nope') === null);
  assert('path-traversal code rejected', getGroup(root, '../../etc') === null);

  // A second team is a separate, isolated group.
  const g2 = createGroup(root, 'Day Trippers');
  assert('two independent groups', g2.code !== g.code && getGroup(root, g2.code).name === 'Day Trippers');

  const r = addRace(root, g.code, 'Spa 6h');
  assert('race created', !!r.id && r.name === 'Spa 6h');
  assert('race listed under its group', listRaces(root, g.code).some((x) => x.id === r.id));
  assert('other group has no races', listRaces(root, g2.code).length === 0);
  assert('addRace on bad code → null', addRace(root, 'bad', 'X') === null);
}

section('sessions — upload, overwrite per driver, list');
{
  const g = createGroup(root, 'T');
  const r = addRace(root, g.code, 'R');

  assert('upload Alice', putSession(root, g.code, r.id, 'Alice', cap('Alice'))?.driver === 'Alice');
  assert('upload Bob', !!putSession(root, g.code, r.id, 'Bob', cap('Bob')));
  let list = listSessions(root, g.code, r.id);
  assert('two sessions stored', list.length === 2);
  assert('captures round-trip', list.find((s) => s.driver === 'Alice').capture.laps.length === 1);

  // Re-uploading the same driver overwrites (one current session per driver).
  putSession(root, g.code, r.id, 'Alice', cap('Alice'));
  list = listSessions(root, g.code, r.id);
  assert('re-upload overwrites, not duplicates', list.length === 2);

  assert('reject empty capture', putSession(root, g.code, r.id, 'X', { laps: [] }) === null);
  assert('reject non-capture', putSession(root, g.code, r.id, 'X', { foo: 1 }) === null);
  assert('sessions on bad race → null', listSessions(root, g.code, 'nope') === null);
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
