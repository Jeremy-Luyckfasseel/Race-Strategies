/**
 * Recent lap times, per car.
 *
 * The stint log keeps aggregates on purpose — a sum, a count, a best and a
 * worst — so history stays a handful of rows rather than one per lap. That is
 * the right call for the log, and useless for the two questions here: what was
 * this car doing immediately before something happened to it, and has anyone
 * on the LAN suddenly and permanently lost pace.
 *
 * So a short rolling window of completed laps is kept alongside. Ten laps per
 * car, which is a few hundred bytes for a full grid and enough to see a step
 * change in pace against what came before it.
 *
 * Every entry carries the LAP NUMBER it belongs to. The first version stored
 * bare times and had callers index into them, which worked right up until the
 * window filled: after ten laps the array stops growing, every stored index
 * points at the wrong lap, and the incident measurement silently reports the
 * damaged laps as the pace before the damage — or, more often, nothing at all.
 * A lap number does not slide.
 *
 * Pure — no React.
 */

/** Laps of history per car. Long enough to see a step, short enough to forget. */
export const PACE_WINDOW = 10;

/** Laps either side of a step, when deciding whether pace really has dropped. */
const STEP_SAMPLE = 3;

/**
 * Fold freshly arrived packets (ip → packet) into per-car lap-time history.
 * A lap is recorded once, when the lap counter moves on.
 *
 * `lastLapMs` is the time of the lap that has just FINISHED, so it is filed
 * under the lap before the one the car has now started.
 *
 * Returns the same Map reference when nobody completed a lap, which is the
 * normal case at 20 flushes a second.
 */
export function trackLapTimes(prev, packets) {
  let next = prev;
  for (const [ip, packet] of packets) {
    const lap = Number(packet?.currentLap);
    const lastLapMs = Number(packet?.lastLapMs);
    if (!Number.isFinite(lap) || !(lastLapMs > 0)) continue;

    const rec = prev.get(ip);
    if (rec && rec.lap === lap) continue;

    if (next === prev) next = new Map(prev);
    // The first sighting tells us the lap number but the lap time belongs to a
    // lap we did not watch, so it is recorded from the next one on.
    const times = rec
      ? [...rec.times, { lap: lap - 1, ms: lastLapMs }].slice(-PACE_WINDOW)
      : [];
    next.set(ip, { lap, times });
  }
  return next;
}

/** Median of an array of numbers. Empty gives null. */
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const msOf = (entries) => median(entries.map((e) => e.ms));

/**
 * Representative pace from the most recent laps.
 *
 * The median, so one lap spent behind a backmarker does not become "the pace".
 * Null until there is something to be representative of.
 */
export function recentPace(rec, laps = STEP_SAMPLE) {
  if (!rec || rec.times.length === 0) return null;
  return msOf(rec.times.slice(-laps));
}

/**
 * Pace over the laps BEFORE the one an incident happened on.
 *
 * Keyed on the lap number the incident was marked at, not on how many laps had
 * been recorded — see the note at the top of this file.
 */
export function paceBefore(rec, incidentLap, laps = STEP_SAMPLE) {
  if (!rec || !Number.isFinite(incidentLap)) return null;
  const before = rec.times.filter((e) => e.lap < incidentLap).slice(-laps);
  return before.length ? msOf(before) : null;
}

/**
 * Pace since then, skipping the lap the incident happened on.
 *
 * That lap holds the spin, the gravel and the recovery: a one-off cost, not
 * the rate the car will run at from here. Averaging it in would make a light
 * scrape look like a broken car and send someone into the pits for nothing.
 */
export function paceAfter(rec, incidentLap) {
  if (!rec || !Number.isFinite(incidentLap)) return null;
  const after = rec.times.filter((e) => e.lap > incidentLap);
  return after.length ? msOf(after) : null;
}

/** What the incident lap itself cost, over and above the pace before it. */
export function incidentLapCostMs(rec, incidentLap) {
  if (!rec || !Number.isFinite(incidentLap)) return null;
  const lap = rec.times.find((e) => e.lap === incidentLap);
  const before = paceBefore(rec, incidentLap);
  if (!lap || before == null) return null;
  return Math.max(0, lap.ms - before);
}

/**
 * Has this car suddenly and permanently lost pace?
 *
 * A step, not a slope: tyres going off is gradual and shows up as a slope, so
 * comparing a block of recent laps against the block before them ignores it
 * while catching damage. Both blocks are medians, so one lap in traffic on
 * either side moves nothing.
 *
 * A pit stop produces a slow in-lap and a slow out-lap — two laps, which is
 * why three are required on each side before this says anything.
 *
 * Note for callers: a safety car slows the whole field at once and trips this
 * for every car. The caller knows whether one is deployed; this cannot.
 *
 * @returns {{lostMs:number, fromLap:number}|null}
 */
export function detectPaceDrop(rec, thresholdMs = 1500) {
  if (!rec || rec.times.length < STEP_SAMPLE * 2) return null;
  const recentEntries = rec.times.slice(-STEP_SAMPLE);
  const recent = msOf(recentEntries);
  const earlier = msOf(rec.times.slice(-STEP_SAMPLE * 2, -STEP_SAMPLE));
  if (recent == null || earlier == null) return null;

  // Sustained means every recent lap is slower, not merely that their median
  // is. A pit stop is a slow in-lap and a slow out-lap followed by a normal
  // one, and a median over three would still call that a step; gating on the
  // FASTEST of the recent laps lets the recovery disqualify it.
  const fastestRecent = Math.min(...recentEntries.map((e) => e.ms));
  if (fastestRecent - earlier < thresholdMs) return null;

  return { lostMs: recent - earlier, fromLap: recentEntries[0].lap };
}
