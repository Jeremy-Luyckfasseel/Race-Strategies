/**
 * How much fuel to put in, for the stint that is about to start.
 *
 * The plan already carries a litres figure per stop, but it is computed for an
 * anonymous driver on the tyre the plan assumed. At the actual stop you know
 * two things the plan did not: who is getting in, and what you are fitting. A
 * driver on 3.40 L/lap gets 29 laps out of a 100 L tank; one on 3.65 gets 27.
 * Fuelled for the wrong one, the car either stops two laps early or carries
 * weight it never burns.
 *
 * Deliberately NOT done by re-running the engine per driver. Stint length is
 * decided by fuel range, and per-driver fuel would make fuel range depend on
 * who is driving — while the driver is chosen FROM the stint length. That
 * circularity is a rewrite of the ranking core, for a question that does not
 * need it: this one is asked once, at one stop, about one stint.
 *
 * What it will NOT do is tell you to short-fill into an extra stop. The length
 * of the stint comes in as a constraint from the plan; this only answers how
 * many litres that stint needs.
 *
 * Pure — no React, no clock.
 */

/** A litre of margin is a lap of walking. Enough to cover a safety car lap. */
export const FUEL_MARGIN_L = 0.5;

/**
 * Litres this driver burns a lap, falling back through what is actually known.
 *
 * Measured beats configured, and a driver with no measurement of their own
 * uses the car's — which is right, because it is the same car.
 *
 * @param {object} p
 * @param {string} [p.driverId]
 * @param {Object<string,{litersPerLap:number,confident:boolean}>} [p.fuelByDriver]
 *   the learner's per-driver fuel, keyed by driver id
 * @param {number} [p.globalLitersPerLap]  the car's own measured burn
 * @param {number} [p.tankSize]
 * @param {number} [p.lapsPerFullTank]     the configured figure, last resort
 * @returns {{litersPerLap:number, source:'driver'|'car'|'configured'}|null}
 */
export function burnRateFor({
  driverId, fuelByDriver, globalLitersPerLap, tankSize, lapsPerFullTank,
}) {
  const mine = driverId && fuelByDriver ? fuelByDriver[driverId] : null;
  if (mine && mine.confident && mine.litersPerLap > 0) {
    return { litersPerLap: mine.litersPerLap, source: 'driver' };
  }
  if (Number(globalLitersPerLap) > 0) {
    return { litersPerLap: Number(globalLitersPerLap), source: 'car' };
  }
  const tank = Number(tankSize);
  const lpt = Number(lapsPerFullTank);
  if (tank > 0 && lpt > 0) return { litersPerLap: tank / lpt, source: 'configured' };
  return null;
}

/**
 * The litres to put in at this stop.
 *
 * @param {object} p
 * @param {number} p.lapsInStint    how many laps this stint has to cover
 * @param {number} p.litersPerLap   what the driver going out burns
 * @param {number} p.tankSize
 * @param {number} [p.currentFuel]  what is already aboard; omit to quote the
 *   total the tank needs rather than the amount to add
 * @param {number} [p.fuelRateLitersPerSec]  to say what the fill costs
 * @returns {{needL:number, addL:number, capped:boolean, lapsCovered:number,
 *   secs:number|null}|null}
 */
export function stintFuel({
  lapsInStint, litersPerLap, tankSize, currentFuel = 0, fuelRateLitersPerSec,
}) {
  const laps = Number(lapsInStint);
  const lpl = Number(litersPerLap);
  const tank = Number(tankSize);
  if (!(laps > 0) || !(lpl > 0) || !(tank > 0)) return null;

  const wanted = laps * lpl + FUEL_MARGIN_L;
  // A tank cannot hold more than a tank. Saying "put in 112 L" is worse than
  // saying "brimmed, and it still will not reach".
  const needL = Math.min(wanted, tank);
  const capped = wanted > tank;

  const have = Math.max(0, Number(currentFuel) || 0);
  const addL = Math.max(0, needL - have);

  const rate = Number(fuelRateLitersPerSec);
  return {
    needL,
    addL,
    capped,
    // What a full tank would actually cover for this driver — the number that
    // says whether the stint is even possible on one tank.
    lapsCovered: Math.floor((tank - FUEL_MARGIN_L) / lpl),
    secs: rate > 0 ? addL / rate : null,
  };
}
