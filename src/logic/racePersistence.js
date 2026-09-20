/**
 * What a race is made of on disk, and how to carry it somewhere else.
 *
 * Everything the app remembers already lives in localStorage, which is the
 * right store for this: the whole payload is a few tens of KB (the track map
 * is self-bounding — points are only appended when a new 3 m grid cell is
 * discovered, so it converges to the circuit's area rather than growing with
 * race length), and synchronous writes mean data is durable the instant it is
 * written, with no transaction to lose in a crash. An embedded database would
 * add async complexity and a dependency to store less than a floppy disk.
 *
 * What localStorage does not survive is the browser profile being cleared, a
 * different machine, or a laptop dying mid-event — hence export/import.
 *
 * Pure: the caller supplies read/write functions, so this is node-testable and
 * never touches a global.
 */

import { RACE_START_KEY } from './raceClock.js';

export const SNAPSHOT_SCHEMA = 1;
const APP_ID = 'race-strategies';

/** Strategy inputs — the race setup that was previously never persisted. */
export const INPUTS_KEY = 'gt7-inputs';

/**
 * Keys that belong to *this race* and are cleared when starting a new one.
 *
 * The recorded track map is deliberately NOT here: it describes the circuit,
 * not the race, so running a second race at the same track should not force a
 * re-trace. It has its own reset button on the map itself.
 */
export const RACE_KEYS = [
  INPUTS_KEY,
  RACE_START_KEY,
  'gt7-team-labels',
  'gt7-team-compounds',
  'gt7-my-team',
  'gt7-stint-log',
  // Which car is the safety car. Without this a restored snapshot ranks a
  // parked car back into the standings and the gap chain.
  'gt7-car-roles',
];

/**
 * Keys written into an exported snapshot. A snapshot is meant to restore a
 * session completely, so it also carries the circuit map and the PS5
 * addresses. Car presets and the onboarding flag are app preferences rather
 * than race state and stay out.
 */
export const SNAPSHOT_KEYS = [...RACE_KEYS, 'gt7_track_map_v1', 'gt7-ps5-ips'];

/**
 * Build a snapshot from storage. `readKey` returns the raw stored string (or
 * null). Values are kept as raw strings: they were written as JSON by their
 * owners and re-parsing here would only risk mangling them.
 */
export function buildSnapshot(readKey, now = new Date()) {
  const data = {};
  for (const key of SNAPSHOT_KEYS) {
    const raw = readKey(key);
    if (raw != null) data[key] = raw;
  }
  return { app: APP_ID, schema: SNAPSHOT_SCHEMA, savedAt: now.toISOString(), data };
}

/**
 * Check a parsed snapshot before letting it overwrite a live race.
 * @returns {{ok: true}|{ok: false, reason: string}}
 */
export function validateSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return { ok: false, reason: 'not a snapshot file' };
  if (snap.app !== APP_ID) return { ok: false, reason: 'this file is from a different app' };
  if (typeof snap.schema !== 'number') return { ok: false, reason: 'missing schema version' };
  if (snap.schema > SNAPSHOT_SCHEMA) {
    return { ok: false, reason: `saved by a newer version (schema ${snap.schema})` };
  }
  if (!snap.data || typeof snap.data !== 'object') return { ok: false, reason: 'no data in the file' };
  const known = Object.keys(snap.data).filter((k) => SNAPSHOT_KEYS.includes(k));
  if (known.length === 0) return { ok: false, reason: 'nothing recognisable to restore' };
  return { ok: true };
}

/**
 * Apply a validated snapshot. Only known keys are written, so a tampered or
 * hand-edited file cannot inject arbitrary storage entries.
 * @returns {string[]} the keys actually restored
 */
export function applySnapshot(snap, writeKey) {
  const restored = [];
  for (const key of SNAPSHOT_KEYS) {
    const raw = snap.data?.[key];
    if (typeof raw !== 'string') continue;
    writeKey(key, raw);
    restored.push(key);
  }
  return restored;
}

/** Clear this race, leaving the circuit map and app preferences alone. */
export function clearRace(removeKey) {
  for (const key of RACE_KEYS) removeKey(key);
  return [...RACE_KEYS];
}

/**
 * Restore strategy inputs, merged over the current defaults so a stored setup
 * from an older build gains any field added since instead of arriving with it
 * undefined. Anything unparseable is ignored rather than thrown.
 */
export function loadInputs(raw, defaults) {
  if (!raw) return defaults;
  let stored;
  try { stored = JSON.parse(raw); } catch { return defaults; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
  // A setup with no compound table is not a setup; fall back rather than
  // hand the engine something it cannot run.
  if (!Array.isArray(stored.compounds) || stored.compounds.length === 0) return defaults;
  return { ...defaults, ...stored };
}

/** Filename for an exported snapshot, stamped so successive saves don't collide. */
export function snapshotFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `race-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}.json`;
}
