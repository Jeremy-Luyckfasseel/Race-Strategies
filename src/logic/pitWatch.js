/**
 * Catching a followed rival's tyre while it can be seen.
 *
 * GT7 shows what a car is fitted with for a few seconds in the pit box and
 * then hides it for the whole stint, and the telemetry never says. So the
 * question has to be asked while the car is IN the pits, not after it has
 * left — and only for the cars I follow, or a 15-car field would ask all day.
 *
 * A car is watched from its pit entry until either I say what it went out on,
 * or it has run one lap after its pit exit. Then it is assumed to be on the
 * tyre it had before the stop — the most likely answer, and better than none.
 *
 * An answered stop stays answered until the car's NEXT pit entry. The entry
 * and exit flags ride on a car's latest packet until the next one replaces
 * it, so without that, a stop answered before the next packet arrived was
 * simply asked again.
 *
 * Pure: the caller keeps the state (a Map) and applies what comes back.
 */

/**
 * @typedef {{phase: 'in'|'out', prevCompound: string|null, exitLap: number|null, entryLap: number|null}
 *          | {phase: 'done', entryLap: number|null}} Watch
 */

/**
 * One step, for the packets now on screen.
 *
 * @param {Map<string, Watch>} state
 * @param {Map<string, object>} teams            latest packet per car
 * @param {object} p
 * @param {(ip: string) => boolean} p.isWatched  a car I follow
 * @param {(ip: string) => string|null} p.compoundOf  what it was on before the stop
 * @returns {{ state: Map, expired: Array<{ip: string, compound: string|null}>, changed: boolean }}
 */
export function stepPitWatch(state, teams, { isWatched, compoundOf }) {
  const next = new Map(state);
  const expired = [];
  let changed = false;

  // Unfollowed while being asked about: stop asking.
  for (const ip of state.keys()) {
    if (!isWatched(ip) || !teams.has(ip)) { next.delete(ip); changed = true; }
  }

  for (const [ip, d] of teams) {
    if (!d || !isWatched(ip)) continue;
    const w = next.get(ip);
    const lap = Number.isFinite(Number(d.currentLap)) ? Number(d.currentLap) : null;

    // Answered (or given up on): only a new stop starts a new question.
    if (w?.phase === 'done') {
      if (!(d.pitDetected && lap !== w.entryLap)) continue;
      next.set(ip, { phase: 'in', prevCompound: compoundOf(ip) ?? null, exitLap: null, entryLap: lap });
      changed = true;
      continue;
    }

    if (d.pitDetected && !w) {
      next.set(ip, { phase: 'in', prevCompound: compoundOf(ip) ?? null, exitLap: null, entryLap: lap });
      changed = true;
    } else if (d.pitExit && (!w || w.phase === 'in')) {
      // Its entry can be missed (a stop too short for the dwell); the exit is
      // still a stop, and still worth asking about.
      next.set(ip, {
        phase: 'out',
        prevCompound: w ? w.prevCompound : (compoundOf(ip) ?? null),
        exitLap: lap,
        entryLap: w ? w.entryLap : null,
      });
      changed = true;
    } else if (w && w.phase === 'out' && w.exitLap != null && lap != null && lap >= w.exitLap + 1) {
      expired.push({ ip, compound: w.prevCompound });
      next.set(ip, { phase: 'done', entryLap: w.entryLap });
      changed = true;
    }
  }

  return { state: changed ? next : state, expired, changed };
}

/** I said what it went out on, or dismissed the question. */
export function resolvePitWatch(state, ip) {
  const w = state.get(ip);
  if (!w || w.phase === 'done') return state;
  const next = new Map(state);
  next.set(ip, { phase: 'done', entryLap: w.entryLap ?? null });
  return next;
}

/** The questions actually open, for the screen. */
export function openPitAsks(state) {
  return [...state].filter(([, w]) => w.phase === 'in' || w.phase === 'out');
}
