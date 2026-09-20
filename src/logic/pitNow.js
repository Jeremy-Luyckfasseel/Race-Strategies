/**
 * Box now, or wait for the stop you were already making?
 *
 * The first version of this costed "pit now" as a whole extra stop, on the
 * reasoning that the scheduled stop still has to happen for fuel and tyres.
 * That is wrong often enough to matter, and an engineer spotted it
 * immediately: a stop is only an EXTRA stop if the race cannot absorb it. If
 * the plan was going to finish with tyre life or fuel range left on the table
 * — which it usually is, because the last stint rarely ends exactly as the
 * tyre does — then coming in early does not add a stop at all. It re-divides
 * the same number of stops across the remaining laps, and costs only the time
 * spent stationary.
 *
 * Whether the race can absorb it depends on fuel range, tyre life, mandatory
 * stops and how much time is left, which is precisely what the strategy engine
 * already works out. So it is asked, rather than approximated: build the two
 * futures, run each through the engine, and compare what they finish with.
 *
 * Neither scenario carries a pace penalty. Instead the time each option costs
 * is taken off the clock up front — the stop and the repair for coming in now,
 * the seconds bled until the scheduled stop for waiting. That keeps both runs
 * comparable, and means the answer is in the currency that decides a timed
 * race: laps completed.
 *
 * Pure — the engine is passed in, so this is testable without running it.
 */

/**
 * What an unscheduled stop actually costs, when you take the opportunity.
 *
 * Coming in for damage does not mean coming in for damage alone — the tyres go
 * on and the tank goes up while the car is already stationary, because it
 * would be daft not to. So the cost is the full service, not just the pit lane
 * and a set of tyres, and the fuel term depends on how empty the car is right
 * now: a stop on lap 3 costs far more in fuel time than one on lap 25.
 */
export function fullServiceLoss(inputs, currentFuel) {
  const base = Number(inputs?.pitBaseSecs) || 0;
  const tyres = Number(inputs?.tireChangeSecs) || 0;
  const tank = Number(inputs?.tankSize) || 0;
  const rate = Number(inputs?.fuelRateLitersPerSec) || 0;
  const have = Math.max(0, Number(currentFuel) || 0);
  const fuelSecs = rate > 0 ? Math.max(0, tank - have) / rate : 0;
  return base + tyres + fuelSecs;
}

export const PIT_NOW = 'pit_now';
export const WAIT = 'wait';

/**
 * The two futures, as engine inputs.
 *
 * @param inputs          the active inputs, with the race clock already applied
 *                        so `raceDurationHours` is the time REMAINING
 * @param currentLap      the lap the car is on
 * @param currentFuel     litres in the tank now
 * @param compoundId      what it is running
 * @param tyreAgeLaps     laps on the current set
 * @param lossPerLapSecs  what the incident is costing every lap
 * @param lapsToNextStop  laps until the next stop already in the plan, or null
 * @param lapsRemaining   laps left if nothing changes
 * @param pitLossSecs     an unscheduled stop: pit lane plus tyres
 * @param repairSecs      stationary time to put it right
 */
export function pitNowScenarios({
  inputs,
  currentLap,
  currentFuel,
  compoundId,
  tyreAgeLaps = 0,
  lossPerLapSecs,
  lapsToNextStop = null,
  lapsRemaining = 0,
  pitLossSecs = 0,
  repairSecs = 0,
}) {
  const loss = Math.max(0, Number(lossPerLapSecs) || 0);
  const pit = Math.max(0, Number(pitLossSecs) || 0);
  const repair = Math.max(0, Number(repairSecs) || 0);
  const remainingHours = Number(inputs?.raceDurationHours) || 0;
  if (remainingHours <= 0) return null;

  const hoursLostTo = (secs) => Math.max(0, remainingHours - secs / 3600);

  const mid = {
    ...inputs,
    midRaceMode: true,
    currentLap: Number(currentLap) || 0,
    currentCompoundId: compoundId || null,
  };

  // Come in. The car is repaired and on fresh tyres with a full tank, and the
  // stop plus the repair come straight off the clock.
  const pitNow = {
    ...mid,
    raceDurationHours: hoursLostTo(pit + repair),
    currentFuel: Number(inputs?.tankSize) || null,
    currentTireAgeLaps: 0,
  };

  // Stay out. The car keeps what it has and bleeds the loss until the stop it
  // was making anyway, where the repair is done for the price of the repair.
  // With no stop left in the plan, it bleeds to the flag and is never repaired.
  const bleedLaps = lapsToNextStop != null && Number.isFinite(lapsToNextStop)
    ? Math.max(0, Math.floor(lapsToNextStop))
    : Math.max(0, Math.floor(lapsRemaining));
  const repairedLater = lapsToNextStop != null && Number.isFinite(lapsToNextStop);

  const wait = {
    ...mid,
    raceDurationHours: hoursLostTo(loss * bleedLaps + (repairedLater ? repair : 0)),
    currentFuel: Number(currentFuel),
    currentTireAgeLaps: Math.max(0, Number(tyreAgeLaps) || 0),
  };

  return { pitNow, wait, bleedLaps, repairedLater };
}

/**
 * Which future finishes better.
 *
 * Laps first and time second, the same order the app ranks everything else by,
 * because in a timed race a lap is worth more than any number of seconds.
 *
 * A dead heat is reported as a dead heat rather than being broken arbitrarily:
 * "it makes no difference" is a real and useful answer on the pit wall, and
 * inventing a winner from a rounding difference is not.
 */
export function comparePitNow(pitNowResult, waitResult) {
  const lapsOf = (r) => r?.best?.strategy?.totalLaps ?? null;
  const timeOf = (r) => r?.best?.strategy?.estTotalRaceTimeSecs ?? null;

  const pitLaps = lapsOf(pitNowResult);
  const waitLaps = lapsOf(waitResult);
  if (pitLaps == null || waitLaps == null) return null;

  const lapsDelta = pitLaps - waitLaps;
  if (lapsDelta !== 0) {
    return {
      best: lapsDelta > 0 ? PIT_NOW : WAIT,
      pitLaps, waitLaps, lapsDelta, secsDelta: null, tied: false,
    };
  }

  const pitTime = timeOf(pitNowResult);
  const waitTime = timeOf(waitResult);
  const secsDelta = pitTime != null && waitTime != null ? waitTime - pitTime : null;

  // Under a second over hours of racing is noise, not a decision.
  if (secsDelta == null || Math.abs(secsDelta) < 1) {
    return { best: null, pitLaps, waitLaps, lapsDelta: 0, secsDelta, tied: true };
  }
  return {
    best: secsDelta > 0 ? PIT_NOW : WAIT,
    pitLaps, waitLaps, lapsDelta: 0, secsDelta, tied: false,
  };
}
