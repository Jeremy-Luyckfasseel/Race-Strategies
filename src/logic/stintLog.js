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
    },
  };
}

export function closeStint(entry, { endLap, now = Date.now() }) {
  if (!entry.current) return entry;
  const durationSecs = (now - entry.current.startTime) / 1000;
  const avgLapMs = entry.current.lapCount > 0 ? entry.current.lapMsSum / entry.current.lapCount : null;
  return {
    history: [...entry.history, { ...entry.current, endLap, durationSecs, avgLapMs }],
    current: null,
  };
}

export function recordLap(entry, lapMs) {
  if (!entry.current) return entry;
  const c = entry.current;
  return {
    history: entry.history,
    current: {
      ...c,
      lapMsSum: c.lapMsSum + lapMs,
      lapCount: c.lapCount + 1,
      bestLapMs: c.bestLapMs == null ? lapMs : Math.min(c.bestLapMs, lapMs),
      worstLapMs: c.worstLapMs == null ? lapMs : Math.max(c.worstLapMs, lapMs),
    },
  };
}

export function setCompound(entry, compound) {
  if (!entry.current || entry.current.compound != null || compound == null) return entry;
  return { history: entry.history, current: { ...entry.current, compound } };
}

export function assignDriver(entry, driverId) {
  if (!entry.current) return entry;
  return { history: entry.history, current: { ...entry.current, driverId } };
}
