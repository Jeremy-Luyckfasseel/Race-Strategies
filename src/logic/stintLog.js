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

/**
 * Name a stint after the fact, by its index in history + current.
 *
 * The driver is named at the stop, and at three in the morning that tap gets
 * missed — leaving a whole stint filed under nobody, and its laps out of that
 * driver's totals for the rest of the race. There is no reason the log should
 * be write-once when the thing it records is a human memory.
 *
 * Index runs over the finished stints and then the running one, which is the
 * order the Pilotes table shows them in, so a row and an index mean the same
 * thing to a reader.
 *
 * @returns a NEW entry, or the same one if the index is out of range.
 */
export function assignDriverAt(entry, index, driverId) {
  if (!entry) return entry;
  const history = entry.history || [];
  const id = driverId || null;

  if (index >= 0 && index < history.length) {
    if (history[index].driverId === id) return entry;
    const next = history.slice();
    next[index] = { ...next[index], driverId: id };
    return { history: next, current: entry.current };
  }

  if (index === history.length && entry.current) {
    if (entry.current.driverId === id) return entry;
    return { history, current: { ...entry.current, driverId: id } };
  }

  return entry;
}

/**
 * The lap range a stint covers, for handing its measurements to a driver.
 *
 * A finished stint knows both ends. The running one has no end yet, so the
 * caller supplies the car's current lap — without it the range would be open
 * and would swallow laps that have not happened.
 *
 * EXCLUSIVE of the closing lap, which is not a detail. Both ends were inclusive
 * and adjacent stints share that lap: `closeStint` takes `endLap: currentLap`
 * on pit entry and `reopenStint` takes `startLap: currentLap` on pit exit, the
 * same game lap. So the pit lap belonged to both stints, and naming an old
 * stint moved a lap out of the one after it — and, because the learner sets
 * `currentDriverId` when the running stint's `startLap` falls inside the range,
 * correcting the stint that had just ended silently repointed every lap from
 * then on to that past driver.
 *
 * Exclusive is also simply what the learner records: a lap is filed when the
 * NEXT one starts (`lapNum = lastLapSeen`), so a stint opened on 45 and closed
 * on 73 owns lap records 45–72. A stint that closed on the lap it opened owns
 * no records at all, and says so with null rather than an inverted range.
 */
export function stintLapRange(entry, index, currentLap = null) {
  if (!entry) return null;
  const history = entry.history || [];
  const st = index < history.length ? history[index]
    : (index === history.length ? entry.current : null);
  if (!st || st.startLap == null) return null;
  const end = st.endLap ?? currentLap;
  if (end == null) return null;
  const toLap = end - 1;
  if (toLap < st.startLap) return null;
  return { fromLap: st.startLap, toLap };
}
