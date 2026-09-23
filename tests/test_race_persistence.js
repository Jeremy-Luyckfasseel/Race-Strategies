/**
 * Tests for src/logic/racePersistence.js — keeping a race across a reload, and
 * carrying it off the machine.
 *
 * Run with: node tests/test_race_persistence.js
 */

import {
  SNAPSHOT_SCHEMA, INPUTS_KEY, RACE_KEYS, SNAPSHOT_KEYS,
  buildSnapshot, validateSnapshot, applySnapshot, clearRace,
  loadInputs, snapshotFilename,
} from '../src/logic/racePersistence.js';

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

/** A stand-in for localStorage. */
function fakeStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    read: (k) => (map.has(k) ? map.get(k) : null),
    write: (k, v) => map.set(k, v),
    remove: (k) => map.delete(k),
  };
}

const DEFAULTS = {
  raceDurationHours: 8,
  tankSize: 100,
  compounds: [{ id: 'H', name: 'Hard', tireLife: 60 }],
  drivers: [{ id: 'd1', name: 'Driver 1' }],
  minDriverTimeSecs: 7200,
};

section('what belongs to a race, and what does not');
{
  assert('the strategy setup is race data', RACE_KEYS.includes(INPUTS_KEY));
  assert('so are team names, tyres, my team and the stint log',
    ['gt7-team-labels', 'gt7-team-compounds', 'gt7-my-team', 'gt7-stint-log']
      .every((k) => RACE_KEYS.includes(k)));

  // The circuit outline describes the track, not the race — clearing it would
  // force a re-trace every time you run a second race at the same venue.
  assert('the recorded circuit is NOT wiped by a new race',
    !RACE_KEYS.includes('gt7_track_map_v1'));
  assert('but it IS carried in a snapshot, so a restore is complete',
    SNAPSHOT_KEYS.includes('gt7_track_map_v1'));
  assert('PS5 addresses travel with a snapshot too', SNAPSHOT_KEYS.includes('gt7-ps5-ips'));
  // Typed in before the race, and "New race" is how the lobby is cleared away
  // before it starts: wiping the plan there lost the plan for the race ahead.
  assert('a typed plan survives a new race', !RACE_KEYS.includes('gt7-manual-plan'));
  assert('and travels with a snapshot', SNAPSHOT_KEYS.includes('gt7-manual-plan'));
  assert('car presets are app preferences, not race data',
    !SNAPSHOT_KEYS.includes('gt7-presets') && !RACE_KEYS.includes('gt7-presets'));
}

section('building a snapshot');
{
  const store = fakeStore({
    [INPUTS_KEY]: '{"raceDurationHours":6}',
    'gt7-my-team': '192.168.1.44',
    'gt7-presets': '[{"name":"should not travel"}]',
  });
  const snap = buildSnapshot(store.read, new Date('2026-03-05T14:30:00Z'));

  assert('it is stamped with the app and schema',
    snap.app === 'race-strategies' && snap.schema === SNAPSHOT_SCHEMA);
  assert('and when it was taken', snap.savedAt === '2026-03-05T14:30:00.000Z');
  assert('it carries the keys that were present',
    snap.data[INPUTS_KEY] === '{"raceDurationHours":6}' && snap.data['gt7-my-team'] === '192.168.1.44');
  assert('absent keys are simply omitted', !('gt7-stint-log' in snap.data));
  assert('app preferences are left out', !('gt7-presets' in snap.data));
}

section('validating a snapshot before it overwrites a live race');
{
  const good = buildSnapshot(fakeStore({ [INPUTS_KEY]: '{"compounds":[]}' }).read);
  assert('a snapshot we wrote is accepted', validateSnapshot(good).ok);

  assert('null is rejected', validateSnapshot(null).ok === false);
  assert('a random object is rejected', validateSnapshot({ hello: 'world' }).ok === false);
  assert('another app\'s file is rejected',
    validateSnapshot({ app: 'something-else', schema: 1, data: {} }).ok === false);
  assert('a file from a NEWER version is refused rather than half-read',
    validateSnapshot({ app: 'race-strategies', schema: SNAPSHOT_SCHEMA + 1, data: { [INPUTS_KEY]: '{}' } }).ok === false);
  assert('an empty payload is rejected',
    validateSnapshot({ app: 'race-strategies', schema: 1, data: {} }).ok === false);
  assert('a payload with nothing recognisable is rejected',
    validateSnapshot({ app: 'race-strategies', schema: 1, data: { junk: 'x' } }).ok === false);

  const why = validateSnapshot({ app: 'nope', schema: 1, data: {} });
  assert('and the refusal explains itself', typeof why.reason === 'string' && why.reason.length > 0,
    JSON.stringify(why));
}

section('restoring');
{
  const source = fakeStore({
    [INPUTS_KEY]: '{"raceDurationHours":6,"compounds":[{"id":"H"}]}',
    'gt7-team-labels': '{"192.168.1.44":"Night Shift"}',
    'gt7_track_map_v1': '{"segs":[]}',
  });
  const snap = buildSnapshot(source.read);

  const target = fakeStore({ [INPUTS_KEY]: '{"raceDurationHours":24}' });
  const restored = applySnapshot(snap, target.write);

  assert('the stored keys are written', restored.length === 3, JSON.stringify(restored));
  assert('overwriting what was there', target.read(INPUTS_KEY) === source.read(INPUTS_KEY));
  assert('the circuit comes back too', target.read('gt7_track_map_v1') === '{"segs":[]}');

  // A hand-edited file must not be able to write wherever it likes.
  const tampered = { app: 'race-strategies', schema: 1, data: { 'evil-key': 'x', [INPUTS_KEY]: '{}' } };
  const clean = fakeStore();
  applySnapshot(tampered, clean.write);
  assert('an unknown key in the file is ignored', clean.read('evil-key') === null);
  assert('while the legitimate one is restored', clean.read(INPUTS_KEY) === '{}');

  const wrongType = { app: 'race-strategies', schema: 1, data: { [INPUTS_KEY]: { not: 'a string' } } };
  const t2 = fakeStore();
  assert('a non-string value is skipped rather than written',
    applySnapshot(wrongType, t2.write).length === 0);
}

section('starting a new race');
{
  const store = fakeStore({
    [INPUTS_KEY]: '{"a":1}',
    'gt7-my-team': '10.0.0.1',
    'gt7-stint-log': '{"x":1}',
    'gt7_track_map_v1': '{"segs":[1]}',
    'gt7-presets': '[{"name":"Gr3"}]',
    'gt7-ps5-ips': '["10.0.0.1"]',
  });
  clearRace(store.remove);

  assert('the setup is cleared', store.read(INPUTS_KEY) === null);
  assert('my team is cleared', store.read('gt7-my-team') === null);
  assert('the stint log is cleared', store.read('gt7-stint-log') === null);
  assert('the circuit map survives — same track, no need to re-trace',
    store.read('gt7_track_map_v1') === '{"segs":[1]}');
  assert('car presets survive', store.read('gt7-presets') === '[{"name":"Gr3"}]');
  assert('and so do the PS5 addresses', store.read('gt7-ps5-ips') === '["10.0.0.1"]');
}

section('loading the strategy setup back');
{
  assert('nothing stored falls back to defaults', loadInputs(null, DEFAULTS) === DEFAULTS);
  assert('unparseable JSON falls back', loadInputs('{not json', DEFAULTS) === DEFAULTS);
  assert('an array falls back', loadInputs('[1,2]', DEFAULTS) === DEFAULTS);
  assert('a setup with no compound table falls back rather than breaking the engine',
    loadInputs('{"raceDurationHours":4}', DEFAULTS) === DEFAULTS);
  assert('an empty compound table also falls back',
    loadInputs('{"compounds":[]}', DEFAULTS) === DEFAULTS);

  const stored = loadInputs(
    '{"raceDurationHours":4,"compounds":[{"id":"S","tireLife":20}]}', DEFAULTS);
  assert('a valid setup is restored', stored.raceDurationHours === 4);
  assert('its compound table wins over the default', stored.compounds[0].id === 'S');

  // A setup saved by an older build predates any field added since; merging
  // over the defaults means it gains them instead of arriving undefined.
  assert('fields the saved setup never knew about get their default',
    stored.minDriverTimeSecs === 7200, `${stored.minDriverTimeSecs}`);
  assert('and the defaults object is not mutated', DEFAULTS.raceDurationHours === 8);
}

section('snapshot filenames');
{
  const name = snapshotFilename(new Date('2026-03-05T09:07:00'));
  assert('stamped with the date and time', name === 'race-2026-03-05-0907.json', name);
  assert('and is a .json file', name.endsWith('.json'));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
