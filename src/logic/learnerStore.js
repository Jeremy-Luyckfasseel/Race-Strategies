/**
 * Keeping what the learner measured across a reload.
 *
 * An eight-hour race is eight hours of measurement, and all of it lived in one
 * closure in memory. A refresh, a dropped connection, a tab the browser decided
 * to reclaim — any of those and the session started again from zero, hours in,
 * with no way to get it back. On a pit wall running off patchy venue wifi that
 * is not an edge case.
 *
 * Only MEASURED laps are stored. The in-progress lap is not, so a restore costs
 * at most one lap, and nothing here is a fit or an estimate — those are
 * recomputed from the laps on demand, which means a change to the fitting code
 * takes effect on restored data too rather than resurrecting an old answer.
 *
 * Keyed by car, because the learner is per car: reloading with a different
 * console starred must not hand it the previous one's laps.
 *
 * Pure — the caller supplies the storage, so this is testable under plain node.
 */

export const LEARNER_KEY = 'gt7-learner';

/**
 * How many laps to keep per car. A 24-hour race at 90-second laps is 960, and
 * the whole point is not to throw measurement away, so this is a guard against
 * unbounded growth rather than a working limit — at ~120 bytes a lap, 2000 laps
 * is about 240 kB, well inside a 5 MB origin quota even with a full field.
 * Past it the OLDEST laps go: recent running describes the car as it is now.
 */
export const MAX_LAPS_PER_CAR = 2000;

/** Parse the whole store. Anything unreadable is treated as empty, never thrown. */
export function readStore(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The stored snapshot for one car, shaped for `createLearner({ restore })`.
 * Returns null when there is nothing usable — a caller must be able to treat
 * "no history" and "corrupt history" identically.
 */
export function restoreFor(raw, ip) {
  if (!ip) return null;
  const entry = readStore(raw)[ip];
  if (!entry || !Array.isArray(entry.laps) || entry.laps.length === 0) return null;
  // Guard the one field the rest of the pipeline cannot defend itself against:
  // a lap with no numeric stintAge silently becomes NaN in the curve fit.
  const laps = entry.laps.filter(
    (l) => l && Number.isFinite(l.stintAge) && Array.isArray(l.dirtyReasons),
  );
  if (laps.length === 0) return null;
  return {
    laps,
    stintStartLap: Number.isFinite(entry.stintStartLap) ? entry.stintStartLap : null,
    compoundId: entry.compoundId ?? null,
    driverId: entry.driverId ?? null,
  };
}

/**
 * Fold one car's snapshot into the store, returning the string to write.
 * Other cars' entries are preserved — the store outlives any one selection.
 */
export function writeFor(raw, ip, snapshot) {
  if (!ip || !snapshot || !Array.isArray(snapshot.laps)) return raw ?? null;
  const store = readStore(raw);
  store[ip] = {
    laps: snapshot.laps.slice(-MAX_LAPS_PER_CAR),
    stintStartLap: snapshot.stintStartLap ?? null,
    compoundId: snapshot.compoundId ?? null,
    driverId: snapshot.driverId ?? null,
    savedAt: Date.now(),
  };
  return JSON.stringify(store);
}
