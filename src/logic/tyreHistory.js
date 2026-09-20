/**
 * What a set of tyres actually gave you, last time.
 *
 * The stint log already records, for every car on the LAN, which compound ran,
 * how many laps it lasted, and what the pace did across it. None of that was
 * ever read back. So the second time a car goes onto Hards nobody can see that
 * the first set did twenty laps and fell off two seconds — which is exactly the
 * number you want on the pit wall when deciding whether to stretch a stint.
 *
 * This is a read over the log, not a new recording: turn it on mid-race and the
 * history is already there.
 *
 * Pure — no React. Takes a stint-log entry (`{history, current}`) and gives
 * back per-compound summaries.
 */

/** The in-progress stint, shaped like a finished one so both can be folded. */
function asStint(current) {
  if (!current) return null;
  return {
    ...current,
    endLap: null,
    avgLapMs: current.lapCount > 0 ? current.lapMsSum / current.lapCount : null,
    live: true,
  };
}

/** Laps a stint covered. Uses the lap counter, not the clean-lap count. */
function lapsOf(stint, currentLap) {
  if (stint.endLap != null) return Math.max(0, stint.endLap - stint.startLap);
  if (currentLap != null) return Math.max(0, currentLap - stint.startLap);
  return stint.lapCount ?? 0;
}

/**
 * Per-compound history for one car.
 *
 * @param entry       a stint-log entry: { history, current }
 * @param currentLap  the car's lap right now, so the running stint can be sized
 * @returns Map<compoundId, {
 *            stints, completed, laps[], totalLaps, bestMs, avgMs,
 *            falloffMs, typicalLaps, liveLaps
 *          }>
 */
export function tyreHistory(entry, currentLap = null) {
  const out = new Map();
  if (!entry) return out;

  const all = [...(entry.history || [])];
  const live = asStint(entry.current);
  if (live) all.push(live);

  for (const stint of all) {
    if (!stint.compound) continue;
    const rec = out.get(stint.compound) || {
      stints: 0, completed: 0, laps: [], totalLaps: 0,
      bestMs: null, avgMs: null, falloffMs: null, typicalLaps: null, liveLaps: null,
      _avgSum: 0, _avgCount: 0, _falloffs: [],
    };

    const laps = lapsOf(stint, currentLap);
    rec.stints += 1;

    if (stint.live) {
      rec.liveLaps = laps;
    } else {
      // Only finished stints say anything about how long a set LASTS. The one
      // running now is still being driven and would drag the figure down.
      rec.completed += 1;
      rec.laps.push(laps);
      rec.totalLaps += laps;
      if (stint.falloffMs != null) rec._falloffs.push(stint.falloffMs);
    }

    if (stint.bestLapMs != null) {
      rec.bestMs = rec.bestMs == null ? stint.bestLapMs : Math.min(rec.bestMs, stint.bestLapMs);
    }
    if (stint.avgLapMs != null) {
      rec._avgSum += stint.avgLapMs;
      rec._avgCount += 1;
    }

    out.set(stint.compound, rec);
  }

  for (const rec of out.values()) {
    rec.avgMs = rec._avgCount > 0 ? rec._avgSum / rec._avgCount : null;
    rec.falloffMs = rec._falloffs.length
      ? rec._falloffs.reduce((a, b) => a + b, 0) / rec._falloffs.length
      : null;
    // What to expect from the next set: the median of what previous sets gave,
    // so one stint cut short by a safety car or a spin does not become the
    // number the next stint is planned against.
    rec.typicalLaps = medianLaps(rec.laps);
    delete rec._avgSum;
    delete rec._avgCount;
    delete rec._falloffs;
  }

  return out;
}

function medianLaps(laps) {
  if (!laps.length) return null;
  const s = [...laps].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * What this car has learned about the compound it is on right now: how long
 * previous sets lasted, and how many laps that leaves.
 *
 * Returns null when this is the first set of that compound — there is nothing
 * to compare against, and guessing would be worse than saying nothing.
 */
export function currentSetOutlook(entry, compound, currentLap) {
  if (!compound) return null;
  const rec = tyreHistory(entry, currentLap).get(compound);
  if (!rec || rec.completed === 0 || rec.typicalLaps == null) return null;

  const done = rec.liveLaps ?? 0;
  return {
    typicalLaps: rec.typicalLaps,
    previousLaps: rec.laps,
    lapsDone: done,
    lapsLeft: Math.max(0, rec.typicalLaps - done),
    falloffMs: rec.falloffMs,
    // Past what previous sets managed. Not a failure — a set can go longer —
    // but the point at which the number stops being a prediction.
    beyondPrevious: done > rec.typicalLaps,
  };
}
