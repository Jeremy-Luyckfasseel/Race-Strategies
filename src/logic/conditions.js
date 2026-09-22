/**
 * Dry or wet, and what it costs to change your mind.
 *
 * The engine plans a race under one set of conditions. That is the right model:
 * nobody knows when it will rain, and a plan built on a forecast is a plan
 * built on a guess. What is actually needed on the pit wall is the ability to
 * say "it is raining NOW" and get the rest of the race re-planned on wets from
 * where the car currently is — which the mid-race machinery already does.
 *
 * So conditions are a filter over which compounds the engine may choose, not a
 * new simulation. Nothing about the car changes because it started raining:
 * the tank is the same size, the pit crew is the same speed, the drivers are
 * the same drivers.
 *
 * Pure — no React.
 */

/** Compound ids that are wet-weather tyres. Fixed knowledge, not user input. */
export const WET_COMPOUND_IDS = new Set(['IM', 'W']);

export const CONDITIONS = ['dry', 'wet'];

export function isWetCompound(id) {
  return WET_COMPOUND_IDS.has(id);
}

/**
 * The compounds the engine may pick from under these conditions.
 *
 * A compound still has to be switched on (`tireLife > 0`) to be considered —
 * conditions narrow that set, they do not widen it. If the filter would leave
 * nothing to run on, it is ignored and everything active is returned instead:
 * refusing to produce a plan because the rain box is ticked and no wet tyre has
 * been set up is the least useful thing the app could do at that moment.
 */
export function compoundsFor(compounds, conditions) {
  const active = (compounds || []).filter((c) => Number(c.tireLife) > 0);
  if (conditions !== 'wet' && conditions !== 'dry') return active;

  const wanted = conditions === 'wet';
  const matching = active.filter((c) => isWetCompound(c.id) === wanted);
  return matching.length > 0 ? matching : active;
}

/** True when the filter above had to fall back — the UI should say so. */
export function conditionsUnavailable(compounds, conditions) {
  const active = (compounds || []).filter((c) => Number(c.tireLife) > 0);
  if (active.length === 0) return false;
  const wanted = conditions === 'wet';
  return !active.some((c) => isWetCompound(c.id) === wanted);
}

/**
 * How much you have to be losing, per lap, before stopping for the other tyre
 * pays for itself.
 *
 * This is the whole wet-weather decision and it needs nothing you do not
 * already know. A stop costs you `pitLossSecs`. You have `remainingLaps` left
 * to make it back. So the crossover is simply the stop divided by the laps —
 * above that per-lap loss, stopping wins; below it, staying out does.
 *
 * Returns null when there is nothing to decide (no laps left, or a free stop).
 */
export function crossoverSecsPerLap(pitLossSecs, remainingLaps) {
  const loss = Number(pitLossSecs);
  const laps = Math.floor(Number(remainingLaps));
  if (!(loss > 0) || !(laps > 0)) return null;
  return loss / laps;
}

/**
 * The cost of an unscheduled stop for tyres: the pit lane, plus the tyre
 * change. No fuel — a change of conditions does not make the car thirsty, and
 * assuming a splash would overstate the cost of reacting to rain.
 */
export function tyreOnlyPitLoss(inputs) {
  const base = Number(inputs?.pitBaseSecs) || 0;
  const tyres = Number(inputs?.tireChangeSecs) || 0;
  return base + tyres;
}
