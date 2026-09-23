/**
 * What my car is on, and who is driving it, when nobody has said.
 *
 * Nobody has to tap a tyre and a driver after every stop if the answer is
 * already known. It is known in this order:
 *
 *   tyre    what was picked for the next stint before the stop
 *           → else what the plan has for the stint now starting
 *   driver  what was picked for the next stint before the stop
 *           → else whoever drove the stint before (the same driver stays in)
 *
 * The plan is the one the race screen follows (the engine's, or a typed one).
 * Each answer says where it came from, so the screen can tell a picked tyre
 * from an assumed one.
 *
 * Pure: no React, no clock.
 */

import { currentStint } from './raceState.js';

/**
 * The plan's tyre for the stint that starts after a stop.
 *
 * A car leaves the pits on the lap after it came in, so the stint it just
 * ended is the one containing `exitLap - 1`, and the answer is the stint after
 * that. Mid-race the plan is laid from the car's lap, so its first stint is
 * the one just ended and the answer is its second. A stop the plan did not
 * have (after its last planned one) keeps the last planned tyre.
 */
export function planTyreAfterStop(strategy, exitLap) {
  if (!strategy?.stints?.length || !Number.isFinite(exitLap)) return null;
  const cs = currentStint(strategy, exitLap - 1);
  if (!cs) return null;
  return (strategy.stints[cs.index + 1] ?? cs.stint).compound ?? null;
}

/** The plan's tyre for the stint the car is on now. */
export function planTyreNow(strategy, lap) {
  const cs = currentStint(strategy, lap);
  return cs?.stint?.compound ?? null;
}

/**
 * Tyre and driver for the stint a stop has just opened.
 *
 * @param {object} p
 * @param {{driverId: string|null, compoundId: string|null}} [p.pick]  the next-stint picks
 * @param {object} [p.strategy]        the plan being raced
 * @param {number} p.exitLap           the car's lap at the pit exit
 * @param {string|null} [p.previousDriverId]  who drove the stint just ended
 * @returns {{compoundId: string|null, compoundFrom: 'pick'|'plan'|null,
 *            driverId: string|null, driverFrom: 'pick'|'same'|null}}
 */
export function stintAfterStop({ pick, strategy, exitLap, previousDriverId = null }) {
  let compoundId = pick?.compoundId ?? null;
  let compoundFrom = compoundId ? 'pick' : null;
  if (!compoundId) {
    compoundId = planTyreAfterStop(strategy, exitLap);
    compoundFrom = compoundId ? 'plan' : null;
  }

  let driverId = pick?.driverId ?? null;
  let driverFrom = driverId ? 'pick' : null;
  if (!driverId && previousDriverId) {
    driverId = previousDriverId;
    driverFrom = 'same';
  }

  return { compoundId, compoundFrom, driverId, driverFrom };
}
