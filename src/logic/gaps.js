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
    // The first time a car is seen we learn only which lap it is on, not when
    // it began that lap — it could be anywhere from the first corner to the
    // last. Stamping "now" and treating that as a crossing made every car look
    // simultaneous, so a field spread over half a minute read as dead level
    // until the next lap. Mark that first sighting provisional; only a lap
    // change we actually witnessed is a real crossing.
    // The crossing before this one is kept because an interval across the
    // start/finish line needs it: see lapInterval.
    next.set(ip, {
      lap,
      crossedAt: packet.ts,
      prevCrossedAt: rec && rec.witnessed ? rec.crossedAt : null,
      witnessed: rec != null,
      // How long this car's last completed lap took, which is what makes a
      // gap between crossings estimable at all. See lapProgress.
      lapMs: Number(packet.lastLapMs) > 0 ? Number(packet.lastLapMs) : (rec ? rec.lapMs : null),
    });
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

  // A one-lap difference is ambiguous, and it happens to every pair on every
  // single lap: the moment the car in front crosses the line it is on a new
  // lap while the car three seconds behind it is still on the old one. Reading
  // the counter alone, that close fight reports as "+1L" once a lap, which is
  // both wrong and the flicker you see.
  //
  // Measuring from the leader's PREVIOUS crossing resolves it, because that is
  // the lap both cars were on: three seconds behind gives three seconds. A car
  // genuinely a lap down gives roughly a whole lap, so the leader's own last
  // lap time is the discriminator — no track knowledge needed.
  if (lapDiff === 1) {
    if (ahead.prevCrossedAt == null || !behind.witnessed) {
      // We cannot yet tell three seconds from a whole lap, so we say nothing.
      // Falling through to "+1L" here is what put a lapped marker on the car
      // you are actually racing for the first laps of every race — before the
      // leader has two crossings to measure a lap duration from, EVERY pair
      // looks like this for the part of the lap between their line and yours.
      return null;
    }
    const lapDurationMs = ahead.crossedAt - ahead.prevCrossedAt;
    const secs = (behind.crossedAt - ahead.prevCrossedAt) / 1000;
    if (secs >= 0 && secs * 1000 < lapDurationMs) return { secs };
    return { laps: 1 };
  }

  // Beyond one lap the counter is trustworthy on its own.
  if (lapDiff > 0) return { laps: lapDiff };
  // The caller ranks the rows; if the car we were told is behind is actually
  // on a later lap, the ranking disagrees with the timing and we say nothing
  // rather than render a negative gap.
  if (lapDiff < 0) return null;

  // A second-level interval is only meaningful between two crossings we
  // actually saw happen. Until then we say nothing rather than report the
  // near-zero gap that comparing two first-sightings would produce.
  if (!ahead.witnessed || !behind.witnessed) return null;

  const secs = (behind.crossedAt - ahead.crossedAt) / 1000;
  return secs >= 0 ? { secs } : null;
}

/**
 * How many laps a car is up or down on mine, or null when we are on the same
 * lap and are therefore racing each other.
 *
 * On the track map every dot looks the same, so a car you are about to lap is
 * indistinguishable from one you are fighting — and they call for opposite
 * things. This is what makes them different at a glance.
 *
 * Judged on TRACK POSITION when both cars can be placed, because that is what
 * "a lap down" physically means — a whole lap of road between us.
 *
 * It used to go through `lapInterval`, whose ±1 test asks whether the car
 * behind crossed the line within the window of the car ahead's last lap. That
 * is right for a gap and wrong for this: a car that has just STOPPED IN THE
 * PITS crosses late enough to fall outside the window without being lapped at
 * all, so the map flashed "-1L" on it for a few seconds and then took it back.
 * Track position has no such edge — a car that pitted is a third of a lap
 * behind, not a lap.
 *
 * Falls back to `lapInterval` while a car cannot be placed yet (no lap time
 * seen), which is still better than subtracting the raw counters: those differ
 * by one for every pair in the field between one car's crossing and the next.
 *
 * @param {number} [now]  wall-clock ms; without it, only the fallback applies
 * @returns {number|null} positive if they are ahead by whole laps, negative if
 *   they are down on me, null if we are on the same lap (or it cannot be told)
 */
export function lapsOnMe(mine, theirs, now = null) {
  if (!mine || !theirs) return null;

  if (now != null) {
    const myPos = lapProgress(mine, now);
    const theirPos = lapProgress(theirs, now);
    if (myPos != null && theirPos != null) {
      const delta = theirPos - myPos;
      // Under a full lap of road between us is the same lap, however the two
      // counters happen to read at this instant.
      return Math.abs(delta) < 1 ? null : Math.trunc(delta);
    }
  }

  const up = lapInterval(theirs, mine);
  if (up && up.laps) return up.laps;
  const down = lapInterval(mine, theirs);
  if (down && down.laps) return -down.laps;
  return null;
}

/** Render an interval for the leaderboard. Null becomes an em dash. */
export function formatInterval(interval) {
  if (!interval) return null;
  if (interval.laps) return `+${interval.laps}L`;
  return `+${interval.secs.toFixed(1)}s`;
}


/**
 * How far around the lap a car is, as `lap + fraction`.
 *
 * GT7 gives one timing loop — the start/finish line — so a gap measured from
 * crossings alone is exact once a lap and frozen in between. A rival closing
 * on you shows nothing for ninety seconds, which is not a gap, it is a
 * scoreboard.
 *
 * Between crossings the position is therefore interpolated from how long the
 * car has been on this lap against how long its last one took. That is what a
 * timing screen does with sparse loop data, and it has the same property: exact
 * at the line, an estimate in between, and self-correcting every lap.
 *
 * The fraction is clamped to 1. A car having a slower lap than its last would
 * otherwise run past the line before it reached it and appear to lap itself.
 */
export function lapProgress(rec, now) {
  if (!rec || !rec.witnessed) return null;
  if (!rec.lapMs || rec.lapMs <= 0) return null;
  const frac = Math.min(1, Math.max(0, (now - rec.crossedAt) / rec.lapMs));
  return rec.lap + frac;
}

/**
 * The interval between two cars right now, rather than at their last crossings.
 *
 * Falls back to `lapInterval` whenever a car cannot be placed on its lap yet —
 * the opening laps, or a car that has only just been seen — so this is strictly
 * more information, never less.
 *
 * A car sitting in the pits keeps accumulating elapsed time without covering
 * ground, so its interpolated position runs ahead of where it really is. The
 * caller knows who is boxed (`onTrack`) and passes `behindStopped` to hold the
 * estimate at the line instead of inventing progress it has not made.
 */
export function liveInterval(ahead, behind, now, behindStopped = false, aheadStopped = false) {
  if (!ahead || !behind) return null;
  // Either car being stationary breaks the interpolation, not just the one
  // behind: a car in the pits is not covering ground, so crediting it with lap
  // progress invents a gap. Falling back measures one instead — it is still
  // frozen for the duration of the stop, because a stopped car genuinely is
  // not moving, but it is frozen at a number that was true.
  if (behindStopped || aheadStopped) return lapInterval(ahead, behind);

  const a = lapProgress(ahead, now);
  const b = lapProgress(behind, now);
  if (a == null || b == null) return lapInterval(ahead, behind);

  const diff = a - b;
  // The caller ranks the rows. If the car we were told is behind is in front,
  // say nothing rather than render a negative gap.
  if (diff < 0) return null;
  if (diff >= 1) return { laps: Math.floor(diff) };

  return { secs: (diff * ahead.lapMs) / 1000, live: true };
}
