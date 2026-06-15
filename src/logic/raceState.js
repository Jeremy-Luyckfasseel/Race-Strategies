/**
 * Live race-state helpers (Phase 2, Task 2.1) — PURE JavaScript, node-testable.
 *
 * This is the "what do I do right now" decision logic for the in-race "Now" view.
 * The component is a dumb renderer; everything that decides *when to warn*, *how
 * many laps of fuel margin counts as tight*, and *which pit reason wins* lives
 * here so it can be unit-tested without a DOM (plan's pure/UI split).
 *
 * It consumes the engine's strategy output (CURRENT_STATE §3C — `strategy.stints`)
 * and live values (currentLap, fuelLiters, litersPerLap). It never recomputes the
 * strategy and never mutates anything.
 */

// ---------------------------------------------------------------------------
// Tunable thresholds — named so they're a one-line retune (DECISION 1).
// ---------------------------------------------------------------------------

export const RACE_STATE_CONFIG = {
  // Margin unit = laps of fuel (DECISION 1).
  liftAndCoastMarginLaps: 1.0, // projected stint-end margin BELOW this → "lift and coast"
  pushMarginLaps: 2.0, // projected margin ABOVE this → "you can push"

  // Median smoothing window for jittery live signals (fuelLiters / tireWear) so
  // the verdict doesn't flap frame to frame (Risks).
  smoothingWindow: 5,
};

// ---------------------------------------------------------------------------
// Small pure utilities.
// ---------------------------------------------------------------------------

/** Median of the most recent `n` readings — robust smoothing for jittery signals. */
export function medianRecent(readings, n = RACE_STATE_CONFIG.smoothingWindow) {
  if (!Array.isArray(readings) || readings.length === 0) return null;
  const recent = readings.slice(-n).filter((x) => Number.isFinite(x));
  if (recent.length === 0) return null;
  const s = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Stint / next-action derivation.
// ---------------------------------------------------------------------------

/**
 * Which stint is in progress at `currentLap`, and how many laps are left in it.
 * @param {object} strategy  the `.strategy` object (has `.stints`, `.totalLaps`)
 * @param {number} currentLap
 * @returns {{stint:object,index:number,lapsLeftInStint:number,isLastStint:boolean}|null}
 */
export function currentStint(strategy, currentLap) {
  const stints = strategy && strategy.stints;
  if (!stints || stints.length === 0 || !Number.isFinite(currentLap)) return null;

  let index = stints.findIndex((s) => currentLap >= s.startLap && currentLap <= s.endLap);
  if (index === -1) {
    // Before the first stint → stint 0; past the last → last stint.
    index = currentLap < stints[0].startLap ? 0 : stints.length - 1;
  }
  const stint = stints[index];
  return {
    stint,
    index,
    lapsLeftInStint: Math.max(0, stint.endLap - currentLap),
    isLastStint: index === stints.length - 1,
  };
}

/**
 * The next action the engineer must relay: pit lap, fuel to add, tyres yes/no, and
 * the compound being switched to. Null pit lap on the final stint (run to the flag).
 * @returns {object|null}
 */
export function nextAction(strategy, currentLap) {
  const cs = currentStint(strategy, currentLap);
  if (!cs) return null;
  const { stint, index, isLastStint } = cs;
  const nextStint = strategy.stints[index + 1] || null;

  if (isLastStint || stint.pitLap == null) {
    return {
      pitLap: null,
      pitWindowLatestLap: null,
      fuelToAddLiters: 0,
      tiresChanged: false,
      nextCompound: null,
      nextCompoundName: null,
      runToFlag: true,
    };
  }

  return {
    pitLap: stint.pitLap,
    pitWindowLatestLap: stint.pitWindowLatestLap ?? stint.pitLap,
    fuelToAddLiters: stint.fuelToAddLiters,
    tiresChanged: stint.tiresChanged,
    nextCompound: nextStint ? nextStint.compound : null,
    nextCompoundName: nextStint ? nextStint.compoundName : null,
    runToFlag: false,
  };
}

// ---------------------------------------------------------------------------
// Fuel margin + lift-and-coast verdict (DECISION 1).
// ---------------------------------------------------------------------------

/** The lap by which the tank runs dry from `currentLap` (last completable lap). */
export function fuelExhaustionLap(currentLap, fuelLiters, litersPerLap) {
  if (!litersPerLap || litersPerLap <= 0 || !Number.isFinite(fuelLiters) || !Number.isFinite(currentLap)) return null;
  return currentLap + Math.floor(fuelLiters / litersPerLap);
}

/**
 * Projected laps of fuel margin at the planned stint end = (laps of fuel on board)
 * − (laps still to run in this stint). Positive = surplus; negative = will run dry.
 */
export function fuelMarginLaps(fuelLiters, litersPerLap, lapsLeftInStint) {
  if (!litersPerLap || litersPerLap <= 0 || !Number.isFinite(fuelLiters) || !Number.isFinite(lapsLeftInStint)) return null;
  return fuelLiters / litersPerLap - lapsLeftInStint;
}

/**
 * Calm, factual lift-and-coast / push verdict from the fuel margin (DECISION 1).
 * @returns {'lift'|'push'|'ok'|'unknown'}
 */
export function liftAndCoastVerdict(marginLaps, cfg = RACE_STATE_CONFIG) {
  if (marginLaps == null || !Number.isFinite(marginLaps)) return 'unknown';
  if (marginLaps < cfg.liftAndCoastMarginLaps) return 'lift';
  if (marginLaps > cfg.pushMarginLaps) return 'push';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Pit-now trigger (DECISION 3) — earliest-of, with the reason shown.
// ---------------------------------------------------------------------------

/**
 * The lap to box on = the EARLIEST of (planned pit lap, fuel-exhaustion lap,
 * tyre-wear lap), with the reason that wins. Each candidate may be null. On a tie,
 * a safety reason (fuel, then tyres) beats the plan.
 *
 * @param {{plannedPitLap?:number, fuelExhaustionLap?:number, tyreWearLap?:number}} p
 * @returns {{lap:number, reason:'fuel'|'tyres'|'plan'}|null}
 */
export function pitNowTrigger({ plannedPitLap, fuelExhaustionLap, tyreWearLap } = {}) {
  // Lower priority number wins a tie (safety before plan).
  const candidates = [
    { lap: fuelExhaustionLap, reason: 'fuel', priority: 0 },
    { lap: tyreWearLap, reason: 'tyres', priority: 1 },
    { lap: plannedPitLap, reason: 'plan', priority: 2 },
  ].filter((c) => c.lap != null && Number.isFinite(c.lap));

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.lap - b.lap || a.priority - b.priority);
  return { lap: candidates[0].lap, reason: candidates[0].reason };
}
