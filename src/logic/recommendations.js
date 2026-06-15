/**
 * Propose-and-accept logic (Phase 1, Task 1.3) — PURE JavaScript, node-testable.
 *
 * This is the decision layer between the telemetry learner and the active strategy
 * inputs. It NEVER mutates inputs. It compares the learner's confident estimates
 * against the user's current (manual / last-accepted) inputs and produces
 * RECOMMENDATIONS — "measured X vs your Y, Accept / Ignore" — that the human
 * decides on (DECISION 7). The manual numbers stay the source of truth until the
 * human explicitly accepts a recommendation.
 *
 * Two gates keep it from nagging:
 *   1. Only surface when the estimate is CONFIDENT and MEANINGFULLY differs.
 *   2. Once a recommendation is ignored, don't re-surface it until the measured
 *      value has shifted MATERIALLY from what was on screen when it was dismissed.
 *
 * Kept pure (no React) so the "should we recommend this?" logic is unit-tested in
 * node; the React surface (the hook + cards) is a thin renderer over this.
 */

import { parseLapTime } from './strategy.js';

// ---------------------------------------------------------------------------
// Thresholds — named so they're easy to retune. "min*Diff" = how far the measured
// value must be from the active input before we bother proposing it. "reSurface*"
// = how far it must shift AFTER an ignore before we propose it again.
// ---------------------------------------------------------------------------

export const RECOMMEND_CONFIG = {
  minFuelLapsDiff: 0.5, // laps/tank
  minPenaltyDiff: 0.003, // s/L
  minLapTimeDiff: 0.1, // s, per curve point

  reSurfaceFuelLaps: 0.5, // laps/tank
  reSurfacePenalty: 0.003, // s/L
  reSurfaceLapTime: 0.15, // s, per curve point
};

const round1 = (x) => Math.round(x * 10) / 10;
const round3 = (x) => Math.round(x * 1000) / 1000;

/** How far a recommendation's measured value has moved from a prior snapshot. */
function measuredShift(rec, priorMeasured) {
  if (priorMeasured == null) return Infinity;
  if (rec.kind === 'compound') {
    const a = rec.measured.map(parseLapTime);
    const b = priorMeasured.map(parseLapTime);
    return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));
  }
  return Math.abs(rec.measured - priorMeasured);
}

/** Apply the ignore gate, then keep the recommendation. */
function consider(out, dismissed, rec) {
  const prior = dismissed[rec.key];
  if (prior && measuredShift(rec, prior.measured) < rec.reSurface) return; // still ignored
  out.push(rec);
}

/**
 * Build the list of recommendations to surface.
 *
 * @param {object} estimates  learner `getEstimates()` output
 * @param {object} inputs      the active strategy inputs (source of truth)
 * @param {Object<string,{measured:*}>} [dismissed]  per-key snapshot of what was
 *        on screen when the user last ignored that recommendation
 * @returns {Array<object>} recommendations (empty if nothing worth proposing)
 */
export function buildRecommendations(estimates, inputs, dismissed = {}) {
  if (!estimates || !inputs) return [];
  const out = [];

  // --- Fuel (laps per tank) ---
  const fuelTrust = estimates.trust && estimates.trust.fuel;
  if (fuelTrust && fuelTrust.confident && estimates.lapsPerFullTank != null) {
    const measured = round1(estimates.lapsPerFullTank);
    const current = Number(inputs.lapsPerFullTank);
    if (Number.isFinite(current) && Math.abs(measured - current) >= RECOMMEND_CONFIG.minFuelLapsDiff) {
      consider(out, dismissed, {
        key: 'lapsPerFullTank',
        kind: 'fuel',
        label: 'Laps per tank',
        current,
        measured,
        unit: 'laps',
        delta: Math.abs(measured - current),
        reSurface: RECOMMEND_CONFIG.reSurfaceFuelLaps,
        trust: fuelTrust,
      });
    }
  }

  // --- Fuel-weight penalty ---
  const penTrust = estimates.trust && estimates.trust.fuelWeightPenalty;
  if (penTrust && penTrust.confident && estimates.fuelWeightPenaltyPerLiter != null) {
    const measured = round3(estimates.fuelWeightPenaltyPerLiter);
    const current = Number(inputs.fuelWeightPenaltyPerLiter);
    if (Number.isFinite(current) && Math.abs(measured - current) >= RECOMMEND_CONFIG.minPenaltyDiff) {
      consider(out, dismissed, {
        key: 'fuelWeightPenaltyPerLiter',
        kind: 'penalty',
        label: 'Fuel-weight penalty',
        current,
        measured,
        unit: 's/L',
        delta: Math.abs(measured - current),
        reSurface: RECOMMEND_CONFIG.reSurfacePenalty,
        trust: penTrust,
      });
    }
  }

  // --- Per-compound lap-time curves (start / half / end together) ---
  for (const comp of inputs.compounds || []) {
    const learned = estimates.compounds && estimates.compounds[comp.id];
    if (!learned || !learned.confident || !learned.startLapTime) continue;
    const cur = [comp.startLapTime, comp.halfLapTime, comp.endLapTime];
    const mea = [learned.startLapTime, learned.halfLapTime, learned.endLapTime];
    const maxDiff = Math.max(...[0, 1, 2].map((i) => Math.abs(parseLapTime(cur[i]) - parseLapTime(mea[i]))));
    if (maxDiff >= RECOMMEND_CONFIG.minLapTimeDiff) {
      consider(out, dismissed, {
        key: `compound:${comp.id}`,
        kind: 'compound',
        compoundId: comp.id,
        label: `${comp.name || comp.id} lap times`,
        current: cur,
        measured: mea,
        unit: '',
        delta: maxDiff,
        reSurface: RECOMMEND_CONFIG.reSurfaceLapTime,
        trust: {
          sampleCount: learned.sampleCount,
          volatility: learned.volatility,
          confident: learned.confident,
          highlyVolatile: learned.highlyVolatile,
        },
      });
    }
  }

  return out;
}

/**
 * Apply an accepted recommendation to the inputs, returning a NEW inputs object
 * (never mutates). This is the ONLY path by which a learned value enters the
 * active strategy — and only on explicit Accept.
 */
export function applyRecommendation(inputs, rec) {
  if (!inputs || !rec) return inputs;
  switch (rec.kind) {
    case 'fuel':
      return { ...inputs, lapsPerFullTank: rec.measured };
    case 'penalty':
      return { ...inputs, fuelWeightPenaltyPerLiter: rec.measured };
    case 'compound':
      return {
        ...inputs,
        compounds: (inputs.compounds || []).map((c) =>
          c.id === rec.compoundId
            ? { ...c, startLapTime: rec.measured[0], halfLapTime: rec.measured[1], endLapTime: rec.measured[2] }
            : c
        ),
      };
    default:
      return inputs;
  }
}

/** The snapshot to record when a recommendation is ignored (so we can detect a later material shift). */
export function dismissSnapshot(rec) {
  return { measured: rec.measured };
}
