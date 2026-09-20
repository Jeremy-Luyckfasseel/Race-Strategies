/**
 * Something just went wrong. What does it cost, and what do you do about it?
 *
 * Deliberately not a "damage" button. Damage is one kind of thing that makes a
 * plan wrong; a spin, a penalty, a puncture, a door left open by contact and
 * whatever happens on the day that nobody thought of are others. They all lead
 * to the same two questions — how much is this costing me per lap, and do I
 * stop — so they share one control.
 *
 * This module answers only the first. The second belongs to pitNow.js, which
 * asks the engine rather than doing arithmetic; an earlier cost model lived
 * here and was deleted with the branch that superseded it, along with its
 * PIT_NOW constant — two modules exporting that name meant a wrong import
 * would have compiled, linted, and quietly mis-rendered the recommendation.
 *
 * Pure — no React, no clock.
 */

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
