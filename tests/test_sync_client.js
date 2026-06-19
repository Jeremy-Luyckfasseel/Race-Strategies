/**
 * End-to-end test for src/logic/syncClient.js against a REAL sync server
 * (server/sync-server.js) on an ephemeral port, with a throwaway data dir.
 * Exercises the full team flow: create group → ensure race (by name) → upload
 * per-driver → fetch. Run with: node tests/test_sync_client.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSyncServer } from '../server/sync-server.js';
import * as client from '../src/logic/syncClient.js';

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
const cap = (driver) => ({ meta: { tankCapacityL: 100, driver }, laps: [{ lap: 1, lapTimeSec: 120, fuelUsedL: 3, compound: 'M' }], events: [] });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt7synccli-'));
const server = createSyncServer({ dataDir: root });

(async () => {
  await new Promise((r) => server.listen(0, r));
  const baseUrl = `http://localhost:${server.address().port}`;

  console.log('\n── syncClient ↔ sync-server (real HTTP) ──');
  const g = await client.createGroup(baseUrl, 'Night Owls');
  assert('create group returns a join code', !!g.code);
  assert('get group by code', (await client.getGroup(baseUrl, g.code)).name === 'Night Owls');

  const race = await client.ensureRace(baseUrl, g.code, 'Spa 6h');
  assert('ensureRace creates a race', !!race.id);
  const again = await client.ensureRace(baseUrl, g.code, 'spa 6h');
  assert('ensureRace matches by name (case-insensitive)', again.id === race.id);

  await client.uploadSession(baseUrl, g.code, race.id, 'Alice', cap('Alice'));
  await client.uploadSession(baseUrl, g.code, race.id, 'Bob', cap('Bob'));
  let sessions = await client.fetchSessions(baseUrl, g.code, race.id);
  assert('fetch returns both drivers', sessions.length === 2);
  assert('capture round-trips over the wire', sessions.find((s) => s.driver === 'Alice').capture.laps.length === 1);

  await client.uploadSession(baseUrl, g.code, race.id, 'Alice', cap('Alice'));
  sessions = await client.fetchSessions(baseUrl, g.code, race.id);
  assert('re-upload overwrites (one per driver)', sessions.length === 2);

  let threw = false;
  try {
    await client.getGroup(baseUrl, 'nope-nope');
  } catch {
    threw = true;
  }
  assert('unknown code → client error', threw);

  server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
