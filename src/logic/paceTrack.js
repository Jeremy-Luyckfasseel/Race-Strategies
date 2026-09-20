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
    const times = rec ? [...rec.times, lastLapMs].slice(-PACE_WINDOW) : [];
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

/**
 * Representative pace from the most recent laps.
 *
 * The median, so one lap spent behind a backmarker does not become "the pace".
 * Null until there is something to be representative of.
 */
export function recentPace(rec, laps = STEP_SAMPLE) {
  if (!rec || rec.times.length === 0) return null;
  return median(rec.times.slice(-laps));
}

/**
 * Pace before a given point in this car's history, for comparing against what
 * came after. `beforeCount` is how many laps had been recorded when the
 * something-happened moment was marked.
 */
export function paceBefore(rec, beforeCount, laps = STEP_SAMPLE) {
  if (!rec || beforeCount <= 0) return null;
  const window = rec.times.slice(Math.max(0, beforeCount - laps), beforeCount);
  return window.length ? median(window) : null;
}

/**
 * Pace since that moment, skipping the lap the incident happened on.
 *
 * That lap holds the spin, the gravel and the recovery: a one-off cost, not
 * the rate the car will run at from here. Averaging it in would make a light
 * scrape look like a broken car and send someone into the pits for nothing.
 */
export function paceAfter(rec, beforeCount) {
  if (!rec) return null;
  const after = rec.times.slice(beforeCount + 1);
  return after.length ? median(after) : null;
}

/** What the incident lap itself cost, over and above the pace before it. */
export function incidentLapCostMs(rec, beforeCount) {
  if (!rec) return null;
  const lap = rec.times[beforeCount];
  const before = paceBefore(rec, beforeCount);
  if (lap == null || before == null) return null;
  return Math.max(0, lap - before);
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
 * @returns {{lostMs:number, fromLap:number}|null}
 */
export function detectPaceDrop(rec, thresholdMs = 1500) {
  if (!rec || rec.times.length < STEP_SAMPLE * 2) return null;
  const recent = median(rec.times.slice(-STEP_SAMPLE));
  const earlier = median(rec.times.slice(-STEP_SAMPLE * 2, -STEP_SAMPLE));
  if (recent == null || earlier == null) return null;

  // Sustained means every recent lap is slower, not merely that their median
  // is. A pit stop is a slow in-lap and a slow out-lap followed by a normal
  // one, and a median over three would still call that a step; gating on the
  // FASTEST of the recent laps lets the recovery disqualify it.
  const fastestRecent = Math.min(...rec.times.slice(-STEP_SAMPLE));
  if (fastestRecent - earlier < thresholdMs) return null;

  return { lostMs: recent - earlier, fromLap: rec.lap - STEP_SAMPLE };
}
