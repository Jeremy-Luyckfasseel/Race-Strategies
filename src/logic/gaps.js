/**
 * Leaderboard intervals.
 *
 * The old column subtracted the two cars' most recent LAP TIMES, which is a
 * pace difference, not a gap: two cars thirty seconds apart running identical
 * laps showed no gap at all, and a car that happened to post one slow lap
 * looked like it had dropped back by that much.
 *
 * GT7 gives no interval and no sector timing, so this measures the real thing
 * the only way the data allows: when each car last crossed the start/finish
 * line. If the car ahead started this lap at t=10.0 and the car behind started
 * it at t=12.5, the car behind is 2.5 s back. That is exactly how a timing
 * screen derives an interval from loop crossings, and it is correct at the
 * moment of crossing.
 *
 * ponytail: the number therefore refreshes once per lap per car, so a closing
 * or escaping rival shows up at their next crossing rather than continuously.
 * Resolving it live would mean projecting every car onto the recorded track
 * centreline to get a distance-along-lap — real work, and worth it only if
 * per-lap turns out to be too coarse in practice. Precision is bounded by the
 * telemetry flush interval (~50 ms), which is far finer than the 0.1 s shown.
 *
 * Pure — no React.
 */

/**
 * Record when each car most recently began a new lap, from a batch of freshly
 * arrived packets (keyed ip → packet). Uses each packet's own arrival stamp
 * rather than the time this ran, so buffering does not skew the result.
 *
 * Returns the same Map reference when nobody crossed the line, so callers can
 * skip a re-render — which is the normal case, since crossings are rare.
 */
export function trackLapCrossings(prev, packets) {
  let next = prev;
  for (const [ip, packet] of packets) {
    const lap = packet?.currentLap ?? 0;
    if (lap <= 0) continue;
    const rec = prev.get(ip);
    if (rec && rec.lap === lap) continue;
    if (next === prev) next = new Map(prev);
    next.set(ip, { lap, crossedAt: packet.ts });
  }
  return next;
}

/**
 * Interval between two cars from their last line crossings, where `ahead` is
 * the car in front. Returns `{ laps }` when they are not on the same lap,
 * `{ secs }` when they are, or null when it cannot be known yet (either car
 * has not completed a lap since the app started watching).
 */
export function lapInterval(ahead, behind) {
  if (!ahead || !behind) return null;

  const lapDiff = ahead.lap - behind.lap;
  if (lapDiff > 0) return { laps: lapDiff };
  // The caller ranks the rows; if the car we were told is behind is actually
  // on a later lap, the ranking disagrees with the timing and we say nothing
  // rather than render a negative gap.
  if (lapDiff < 0) return null;

  const secs = (behind.crossedAt - ahead.crossedAt) / 1000;
  return secs >= 0 ? { secs } : null;
}

/** Render an interval for the leaderboard. Null becomes an em dash. */
export function formatInterval(interval) {
  if (!interval) return null;
  if (interval.laps) return `+${interval.laps}L`;
  return `+${interval.secs.toFixed(1)}s`;
}
