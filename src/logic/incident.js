/**
 * Something just went wrong. What does it cost, and what do you do about it?
 *
 * Deliberately not a "damage" button. Damage is one kind of thing that makes a
 * plan wrong; a spin, a penalty, a puncture, a door left open by contact and
 * whatever happens on the day that nobody thought of are others. They all lead
 * to the same two questions — how much is this costing me per lap, and do I
 * stop — so they share one control.
 *
 * The decision itself is the same shape as the wet-tyre crossover: something
 * costs you time every lap, fixing it costs a lump sum, and the answer depends
 * on how much racing is left. What makes THIS one different, and what makes
 * "just pit immediately" usually wrong, is that a stop you were going to make
 * anyway is already paid for. Repairing at a scheduled stop costs only the
 * repair. Pitting now costs a whole extra stop on top.
 *
 * Pure — no React, no clock.
 */

/** Options, cheapest first is decided by the caller, not by their order here. */
export const CARRY = 'carry';
export const REPAIR_AT_STOP = 'repair_at_stop';
export const PIT_NOW = 'pit_now';

/**
 * Cost every option in seconds and name the cheapest.
 *
 * @param lossPerLapSecs   what the car is losing each lap in this state
 * @param lapsRemaining    laps left in the race
 * @param lapsToNextStop   laps until the next stop already in the plan, or null
 *                         when there is no further stop planned
 * @param pitLossSecs      what an unscheduled stop costs (pit lane + tyres)
 * @param repairSecs       stationary time to fix it, on top of a normal stop
 *
 * @returns {{options: Array<{id, secs, available}>, best: string, ...}|null}
 */
export function incidentDecision({
  lossPerLapSecs,
  lapsRemaining,
  lapsToNextStop = null,
  pitLossSecs = 0,
  repairSecs = 0,
}) {
  const loss = Number(lossPerLapSecs);
  const laps = Math.floor(Number(lapsRemaining));
  if (!(loss > 0) || !(laps > 0)) return null;

  const pit = Math.max(0, Number(pitLossSecs) || 0);
  const repair = Math.max(0, Number(repairSecs) || 0);

  // Do nothing: bleed the loss to the flag.
  const carrySecs = loss * laps;

  // Repair at a stop that was happening anyway. You carry the damage until you
  // get there, and then pay only for the repair — not for the stop.
  const hasStop = lapsToNextStop != null && Number.isFinite(lapsToNextStop)
    && lapsToNextStop >= 0 && lapsToNextStop <= laps;
  const atStopSecs = hasStop ? loss * Math.floor(lapsToNextStop) + repair : null;

  // Come in now. The scheduled stop still has to happen for fuel and tyres, so
  // this is an extra stop, not a rescheduled one.
  const nowSecs = pit + repair;

  const options = [
    { id: CARRY, secs: carrySecs, available: true },
    { id: REPAIR_AT_STOP, secs: atStopSecs, available: hasStop },
    { id: PIT_NOW, secs: nowSecs, available: true },
  ];

  const best = options
    .filter((o) => o.available)
    .reduce((a, b) => (b.secs < a.secs ? b : a));

  return {
    options,
    best: best.id,
    bestSecs: best.secs,
    // How much the recommendation beats the next-best by. A call worth half a
    // second is not a call, and the UI should be able to say so.
    marginSecs: marginOver(options, best),
    lossPerLapSecs: loss,
    lapsRemaining: laps,
  };
}

function marginOver(options, best) {
  const others = options.filter((o) => o.available && o.id !== best.id).map((o) => o.secs);
  if (!others.length) return null;
  return Math.min(...others) - best.secs;
}

/**
 * The per-lap loss, measured: pace since the incident against pace before it.
 *
 * Returns null until a lap has been completed AFTER the one the incident
 * happened on — that lap is the incident itself, not the state it left behind.
 * A measurement that arrives one lap later and is right beats one that arrives
 * immediately and sends the car into the pits for a scrape.
 */
export function measuredLossSecs(beforeMs, afterMs) {
  if (!(beforeMs > 0) || !(afterMs > 0)) return null;
  return (afterMs - beforeMs) / 1000;
}

/**
 * What the app should use as the loss: whatever the engineer typed, if they
 * typed something, otherwise what was measured.
 *
 * The override exists for the first lap after contact, when there is no
 * measurement yet but the driver on the radio already knows the wing is gone.
 */
export function effectiveLossSecs(manualSecs, measuredSecs) {
  const manual = Number(manualSecs);
  if (Number.isFinite(manual) && manual > 0) return manual;
  return measuredSecs != null && measuredSecs > 0 ? measuredSecs : null;
}
