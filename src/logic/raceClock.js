/**
 * When the race actually started, and what follows from that.
 *
 * A lobby opens hours before the race. People practise, the track map fills in,
 * the learner watches fuel burn and tyre wear — all of which is wanted. What is
 * not wanted is for any of that running-around to count as the race: the stint
 * log, the driver totals and the remaining-time the plan is built from all have
 * to begin at the moment the lights go out, not at the moment the app connected.
 *
 * So the race has an explicit start stamp. Everything time-based is derived
 * from it rather than typed in and re-typed as the race goes on.
 *
 * Pure — no React, no Date.now(). The caller passes `now`, which is what makes
 * this testable and keeps the component a renderer.
 */

/** Storage key for the race start stamp (epoch ms). */
export const RACE_START_KEY = 'gt7-race-start';

/**
 * Where the race has got to.
 *
 * @param {number|null} startedAt   epoch ms the race started, or null
 * @param {number|string} durationHours  the configured race length
 * @param {number} now              epoch ms
 * @returns {{elapsedSecs:number, remainingSecs:number, durationSecs:number,
 *            finished:boolean, remainingMins:number}|null} null when no race is running
 */
export function raceProgress(startedAt, durationHours, now) {
  if (!startedAt || !Number.isFinite(startedAt)) return null;

  const durationSecs = Math.max(0, (Number(durationHours) || 0) * 3600);
  // A clock that has been carried across a reload, or a machine whose time
  // moved, must not produce a negative elapsed and a race longer than it is.
  const elapsedSecs = Math.max(0, (now - startedAt) / 1000);
  const remainingSecs = Math.max(0, durationSecs - elapsedSecs);

  return {
    elapsedSecs,
    remainingSecs,
    durationSecs,
    finished: durationSecs > 0 && remainingSecs <= 0,
    // What the engine is fed. Quantised to the minute so a plan is recomputed
    // once a minute rather than once a second: the strategy search is a few
    // hundred simulations, and nothing in a pit plan moves on a one-second
    // boundary anyway.
    remainingMins: Math.ceil(remainingSecs / 60),
  };
}

/**
 * The inputs the engine should actually run on. While a race is running the
 * configured length is replaced by what is left of it, so the plan follows the
 * clock instead of a number someone has to keep retyping.
 *
 * Returns the SAME object when no race is running, so callers can memoise on
 * identity and not recompute.
 */
export function applyRaceClock(inputs, progress) {
  if (!progress) return inputs;
  // Past the flag the answer is not "plan a fresh eight-hour race", which is
  // what returning the untouched inputs did — the Strategy tab produced a
  // brand-new multi-stop plan while the clock beside it read RACE OVER. The
  // engine refuses a zero-length race, so the floor is a minute: a plan for
  // what is left of a race that is over, which is the honest answer.
  const mins = Math.max(1, progress.remainingMins);
  return { ...inputs, raceDurationHours: mins / 60 };
}

/** `h:mm:ss`, for a clock that is read at a glance rather than parsed. */
export function formatClock(secs) {
  if (!Number.isFinite(secs) || secs < 0) return '—';
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
