/**
 * Pit entry/exit detection from speed alone.
 *
 * GT7's UDP feed exposes no pit flag, so the relay infers one. The original
 * rule was "below 5 km/h after having been above 60" — which also fires for a
 * spin, a crash, an off-track stop or a rejoin. Each false positive is
 * expensive downstream: it clears the car's tyre compound, closes its stint in
 * the Pilotes log and (for my own car) pops a driver-confirmation prompt. In a
 * 10-car field someone spins fairly regularly.
 *
 * The fix is a dwell requirement: the car must stay stopped for `minStopMs`
 * before it counts as a pit stop. A GT7 stop is 25 s+ even for a splash of
 * fuel, while a spin is back under way in a few seconds, so the two separate
 * cleanly. Nothing fires until the car has been seen at racing speed at least
 * once, so a standing start is not mistaken for a stop.
 *
 * ponytail: still speed-only. A car parked on track with damage for longer
 * than the dwell reads as a pit stop, and a drive-through (no stop) reads as
 * no stop at all — correct for strategy, since neither changes tyres or fuel.
 * Corroborating with a fuel increase or a tyre-radius reset would close the
 * first gap; not worth it until it actually bites.
 *
 * Pure — no React, no node built-ins. `now` is injected so it is testable.
 */

/** A stop must last at least this long to count as a pit stop, not a spin. */
export const PIT_MIN_STOP_MS = 8000;
/** Above this, the car is considered to be racing again. */
export const PIT_RACING_KMH = 60;
/** Below this, the car is considered stopped. */
export const PIT_STOPPED_KMH = 5;

/**
 * Advance the per-car pit state machine by one telemetry packet.
 *
 * Phases: undefined/null (not yet seen racing) → 'running' → 'stopped'
 * → 'pitted' → 'running'. Speeds between the two thresholds (the pit-lane
 * crawl, or a slow corner) deliberately hold the current phase.
 *
 * @returns {{state: object|null, pitDetected: boolean, pitExit: boolean}}
 */
export function detectPitEdges(prev, speedKmh, now, {
  minStopMs = PIT_MIN_STOP_MS,
  racingKmh = PIT_RACING_KMH,
  stoppedKmh = PIT_STOPPED_KMH,
} = {}) {
  const spd = speedKmh ?? 0;

  if (spd > racingKmh) {
    return {
      state: { phase: 'running', since: now },
      pitDetected: false,
      // Only a confirmed stop produces an exit. A spin that never met the
      // dwell must not announce a pit exit and start a phantom stint.
      pitExit: prev?.phase === 'pitted',
    };
  }

  if (spd < stoppedKmh) {
    // 'running' is only ever reached by exceeding racingKmh, so a car sitting
    // on the grid before the start cannot reach 'stopped' and fire an entry.
    if (prev?.phase === 'running') {
      return { state: { phase: 'stopped', since: now }, pitDetected: false, pitExit: false };
    }
    if (prev?.phase === 'stopped' && now - prev.since >= minStopMs) {
      // Keep the original `since` so the phase reflects when the car actually
      // stopped, not when we became confident about it.
      return { state: { phase: 'pitted', since: prev.since }, pitDetected: true, pitExit: false };
    }
  }

  return { state: prev ?? null, pitDetected: false, pitExit: false };
}
