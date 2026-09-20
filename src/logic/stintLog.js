/**
 * Pure state machine behind the live "Drivers" tab: tracks who drove each
 * stint, how long it took, which tyre, and average/best/worst lap time.
 * Individual lap times are never retained — only the running sum/count
 * folded into the active stint, so history stays a handful of rows per
 * team, not one per lap.
 *
 * Zero React dependency; `src/hooks/useStintLog.js` wraps this with
 * telemetry subscription, per-lap dedup, and localStorage persistence.
 */

export function emptyEntry() {
  return { history: [], current: null };
}

export function openStint(entry, { driverId = null, compound = null, startLap, now = Date.now() }) {
  return {
    history: entry.history,
    current: {
      driverId, compound, startLap, startTime: now,
      lapMsSum: 0, lapCount: 0, bestLapMs: null, worstLapMs: null,
      // The first and last few clean laps of the stint, which is what makes
      // fall-off measurable. best-vs-worst cannot tell a degrading tyre from
      // one bad lap in traffic; opening pace against closing pace can.
      openingMs: [], closingMs: [],
    },
  };
}

/**
 * A pit exit always starts a fresh stint. Defensive: pitDetected is a
 * single-packet flag over UDP and can be dropped, so if the previous stint
 * is still open here (its closing pitDetected packet never arrived), archive
 * it first — using this pit's lap as its end — rather than letting `openStint`
 * silently overwrite and lose it.
 */
export function reopenStint(entry, { startLap, compound = null, now = Date.now() }) {
  const closed = entry.current ? closeStint(entry, { endLap: startLap, now }) : entry;
  return openStint(closed, { driverId: null, compound, startLap, now });
}

/**
 * Seconds the tyre gave up over the stint: closing pace minus opening pace.
 *
 * Null unless both ends are full and they do not overlap — on a five-lap stint
 * the same laps would appear at both ends and the answer would be zero by
 * construction, which is worse than no answer.
 */
export function stintFalloffMs(stint) {
  const open = stint?.openingMs ?? [];
  const close = stint?.closingMs ?? [];
  if (open.length < FALLOFF_SAMPLE || close.length < FALLOFF_SAMPLE) return null;
  if ((stint.lapCount ?? 0) < FALLOFF_SAMPLE * 2) return null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return mean(close) - mean(open);
}

export function closeStint(entry, { endLap, now = Date.now() }) {
  if (!entry.current) return entry;
  const durationSecs = (now - entry.current.startTime) / 1000;
  const avgLapMs = entry.current.lapCount > 0 ? entry.current.lapMsSum / entry.current.lapCount : null;
  const closed = { ...entry.current, endLap, durationSecs, avgLapMs };
  return {
    history: [...entry.history, { ...closed, falloffMs: stintFalloffMs(closed) }],
    current: null,
  };
}

/** How many laps at each end of a stint are averaged for the fall-off figure. */
export const FALLOFF_SAMPLE = 3;

export function recordLap(entry, lapMs) {
  if (!entry.current) return entry;
  const c = entry.current;
  const opening = c.openingMs ?? [];
  const closing = c.closingMs ?? [];
  return {
    history: entry.history,
    current: {
      ...c,
      lapMsSum: c.lapMsSum + lapMs,
      lapCount: c.lapCount + 1,
      bestLapMs: c.bestLapMs == null ? lapMs : Math.min(c.bestLapMs, lapMs),
      worstLapMs: c.worstLapMs == null ? lapMs : Math.max(c.worstLapMs, lapMs),
      openingMs: opening.length < FALLOFF_SAMPLE ? [...opening, lapMs] : opening,
      closingMs: [...closing, lapMs].slice(-FALLOFF_SAMPLE),
    },
  };
}

/**
 * Same as recordLap, but skips laps that would skew the stint's average/best/
 * worst: the out-lap (the first lap after this stint opened — cold tyres,
 * pit-lane speed limit) and any lap where the car was paused or off track
 * when it completed. Mirrors the docs/DECISIONS.md rule to discard out-lap /
 * in-lap / paused / off-track laps from lap-time metrics — telemetryLearner.js
 * applies the same policy more thoroughly (tracked across the whole lap, not
 * just at the completion packet).
 *
 * ponytail: point-in-time paused/onTrack check only — a lap that was paused
 * mid-lap but not at the instant it completed slips through. Upgrade to
 * telemetryLearner's per-lap dirtyReasons tracking if that shows up in
 * practice.
 */
export function recordLapIfClean(entry, { lapMs, currentLap, paused = false, onTrack = true }) {
  if (!entry.current) return entry;
  const isOutLap = currentLap === entry.current.startLap + 1;
  if (paused || onTrack === false || isOutLap) return entry;
  return recordLap(entry, lapMs);
}

export function setCompound(entry, compound) {
  if (!entry.current || entry.current.compound != null || compound == null) return entry;
  return { history: entry.history, current: { ...entry.current, compound } };
}

export function assignDriver(entry, driverId) {
  if (!entry.current) return entry;
  return { history: entry.history, current: { ...entry.current, driverId } };
}
