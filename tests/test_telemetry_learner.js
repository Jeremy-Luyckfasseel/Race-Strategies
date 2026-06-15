/**
 * Synthetic-telemetry tests for src/logic/telemetryLearner.js (Phase 1, Task 1.1).
 *
 * We generate telemetry frames from a KNOWN ground truth — a true litersPerLap, a
 * true fuel-weight penalty, and a true 3-point degradation curve — then assert the
 * learner recovers each within tolerance. A zero-noise case must recover exactly
 * (tight band); a noisy case is allowed the wider live-trust band.
 *
 * Identifiability: within a single monotone stint fuel and tyre-age are perfectly
 * collinear, so the fuel-weight penalty and the linear part of degradation cannot
 * be separated. The fix (DECISION 5) is to SEED from a practice stint at a
 * different fuel load — the session below is a practice stint + a race stint, and
 * one test proves the learner correctly refuses to identify the penalty from a
 * single stint alone.
 *
 * Run with: node tests/test_telemetry_learner.js
 */

import { createLearner } from '../src/logic/telemetryLearner.js';

// ===========================================================================
// TOLERANCES — two clearly-separated bands (DECISION 6). Loosening the
// live-trust band after seeing real noise must never weaken the synthetic-test
// band; that separation is the whole point. These are starting values (open
// item 1.6) — keep them as named constants so retuning is a one-line change.
// ===========================================================================

// Synthetic-recovery (clean data, TIGHT) — used by the zero-noise test.
const TOL_TIGHT = {
  litersPerLap: 0.05, // L/lap
  penalty: 0.003, // s/L
  lapTime: 0.15, // s/lap (each of start/half/end)
};

// Live-trust (noisy data, WIDER) — used by the noisy test. NEVER reuse these in
// the zero-noise assertions.
const TOL_LIVE = {
  litersPerLap: 0.1, // L/lap
  penalty: 0.005, // s/L
  lapTime: 0.3, // s/lap
};

// ===========================================================================
// Ground truth for the synthetic session.
// ===========================================================================

const TRUTH = {
  tankSize: 100,
  tireLife: 30, // breakpoint at age 15
  litersPerLap: 3.0,
  penalty: 0.03, // s/L — inside the plausible 0.02–0.05 range
  deg: { start: 120.0, half: 121.0, end: 123.0 }, // pure (fuel-removed) lap times, seconds
  compoundId: 'M',
};

/** Pure degradation curve D(age) — the engine's piecewise 3-point form. */
function trueDeg(age) {
  const half = TRUTH.tireLife / 2;
  if (age <= half) return TRUTH.deg.start + (age / half) * (TRUTH.deg.half - TRUTH.deg.start);
  let r = (age - half) / half;
  if (r > 1) r = 1;
  return TRUTH.deg.half + r * (TRUTH.deg.end - TRUTH.deg.half);
}

// Deterministic PRNG (mulberry32) so the noisy test is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frame(currentLap, fuelLiters, lastLapMs = null, extra = {}) {
  return {
    currentLap,
    fuelLiters,
    lastLapMs,
    onTrack: true,
    paused: false,
    ...extra,
  };
}

/**
 * Build a single stint's lap-complete frames (no init frame — the boundary frame
 * is supplied by the caller). Lap of 0-based age `a` has fuelStart = Fi - a·lpl.
 */
function stintFrames(startLapNumber, Fi, nLaps, lapNoise, fuelNoise) {
  const lpl = TRUTH.litersPerLap;
  const frames = [];
  for (let k = 1; k <= nLaps; k++) {
    const age = k - 1;
    const fuelStart = Fi - age * lpl;
    const lapSecs = trueDeg(age) + TRUTH.penalty * fuelStart + lapNoise();
    const fuelEnd = Fi - k * lpl + fuelNoise();
    frames.push(frame(startLapNumber + k, fuelEnd, lapSecs * 1000));
  }
  return frames;
}

/**
 * Full session: a practice/seed stint fuelled to 60 L, then a pit-exit boundary
 * (refuel to the 100 L tank), then a race stint. Two fuel ranges over overlapping
 * tyre ages → the penalty is identifiable.
 */
function buildSession({ noiseSeed = null } = {}) {
  const rng = noiseSeed == null ? null : mulberry32(noiseSeed);
  const lapNoise = rng ? () => (rng() - 0.5) * 0.2 : () => 0; // ±0.1 s lap-time noise
  const fuelNoise = rng ? () => (rng() - 0.5) * 0.1 : () => 0; // ±0.05 L tank jitter

  const frames = [];
  // Init frame for the seed stint (sets lap-start fuel / stint origin; not recorded).
  frames.push(frame(1, 60));
  frames.push(...stintFrames(1, 60, 16, lapNoise, fuelNoise)); // seed: ages 0..15, ends currentLap 17
  // Pit-exit boundary — refuel to full tank, tyre age resets.
  frames.push(frame(17, TRUTH.tankSize, null, { pitExit: true }));
  frames.push(...stintFrames(17, TRUTH.tankSize, 28, lapNoise, fuelNoise)); // race: ages 0..27
  return frames;
}

function makeLearner() {
  return createLearner({
    tankSize: TRUTH.tankSize,
    tireLife: TRUTH.tireLife,
    compoundId: TRUTH.compoundId,
  });
}

// --- Multi-compound ground truth (Task 1.2) ---------------------------------
// A second compound with its own life + degradation curve. Softer: starts faster
// but degrades harder than the medium.
const TRUTH_S = { compoundId: 'S', tireLife: 20, deg: { start: 118.0, half: 120.0, end: 124.0 } };

/** Generic pure degradation D(age) for any compound spec + life (engine piecewise form). */
function degAt(spec, life, age) {
  const half = life / 2;
  if (age <= half) return spec.start + (age / half) * (spec.half - spec.start);
  let r = (age - half) / half;
  if (r > 1) r = 1;
  return spec.half + r * (spec.end - spec.half);
}

/** Noise-free lap-complete frames for a stint on a given compound (no init/boundary frame). */
function genStint(startLapNumber, Fi, nLaps, spec, life) {
  const lpl = TRUTH.litersPerLap;
  const frames = [];
  for (let k = 1; k <= nLaps; k++) {
    const age = k - 1;
    const fuelStart = Fi - age * lpl;
    const lapSecs = degAt(spec, life, age) + TRUTH.penalty * fuelStart;
    frames.push(frame(startLapNumber + k, Fi - k * lpl, lapSecs * 1000));
  }
  return frames;
}

// ===========================================================================
// Test harness (same ✓/✗ style as the other suites).
// ===========================================================================

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertNear(label, actual, expected, tol) {
  const ok = actual != null && Math.abs(actual - expected) <= tol;
  assert(label, ok, `expected ≈${expected} (±${tol}), got ${actual}`);
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ===========================================================================
// Tests
// ===========================================================================

section('Zero-noise synthetic recovery (TIGHT band)');
{
  const learner = makeLearner();
  learner.ingestAll(buildSession({ noiseSeed: null }));
  const est = learner.getEstimates();
  const comp = est.compounds[TRUTH.compoundId];

  assertNear('litersPerLap recovered', est.litersPerLap, TRUTH.litersPerLap, TOL_TIGHT.litersPerLap);
  assertNear('lapsPerFullTank recovered', est.lapsPerFullTank, TRUTH.tankSize / TRUTH.litersPerLap, 1.0);
  assertNear('fuel-weight penalty recovered', est.fuelWeightPenaltyPerLiter, TRUTH.penalty, TOL_TIGHT.penalty);
  assertNear('deg start recovered', comp.deg.start, TRUTH.deg.start, TOL_TIGHT.lapTime);
  assertNear('deg half recovered', comp.deg.half, TRUTH.deg.half, TOL_TIGHT.lapTime);
  assertNear('deg end recovered', comp.deg.end, TRUTH.deg.end, TOL_TIGHT.lapTime);

  assert('fuel estimate is confident', est.trust.fuel.confident === true);
  assert('degradation estimate is confident', comp.confident === true);
  assert('learned penalty flagged in-range', est.trust.fuelWeightPenalty.inRange === true);
  assert('engine-ready lap-time strings emitted', typeof comp.startLapTime === 'string' && /\d:\d\d/.test(comp.startLapTime));
}

section('Engine round-trip — emitted observed times reconstruct the truth');
{
  // The engine treats startLapTime as a full-tank reference and adds burned fuel
  // weight back onto half/end. Re-derive its full-tank curve from our observed
  // strings and confirm it equals D(age) + penalty·tankSize (strategy.js:467-474).
  const learner = makeLearner();
  learner.ingestAll(buildSession({ noiseSeed: null }));
  const comp = learner.getEstimates().compounds[TRUTH.compoundId];
  const p = TRUTH.penalty;
  const { tankSize, tireLife, litersPerLap } = TRUTH;
  const lapsToMid = Math.min(tireLife / 2, tankSize / litersPerLap);
  const lapsToEnd = Math.min(tireLife, tankSize / litersPerLap);
  const fuelAtMid = Math.max(0, tankSize - lapsToMid * litersPerLap);
  const fuelAtEnd = Math.max(0, tankSize - lapsToEnd * litersPerLap);

  // observed.startSecs == D(0) + p·tank ; the engine leaves start uncorrected.
  const startFT = comp.deg.start + p * tankSize;
  const halfObs = comp.deg.half + p * fuelAtMid;
  const endObs = comp.deg.end + p * fuelAtEnd;
  const halfFT = halfObs + (tankSize - fuelAtMid) * p;
  const endFT = endObs + (tankSize - fuelAtEnd) * p;

  assertNear('full-tank ref @start = D(0)+p·tank', startFT, TRUTH.deg.start + p * tankSize, 1e-6);
  assertNear('full-tank ref @half = D(half)+p·tank', halfFT, TRUTH.deg.half + p * tankSize, 1e-6);
  assertNear('full-tank ref @end = D(end)+p·tank', endFT, TRUTH.deg.end + p * tankSize, 1e-6);
}

section('Noisy synthetic recovery (LIVE-TRUST band)');
{
  const learner = makeLearner();
  learner.ingestAll(buildSession({ noiseSeed: 12345 }));
  const est = learner.getEstimates();
  const comp = est.compounds[TRUTH.compoundId];

  assertNear('litersPerLap recovered (noisy)', est.litersPerLap, TRUTH.litersPerLap, TOL_LIVE.litersPerLap);
  assertNear('fuel-weight penalty recovered (noisy)', est.fuelWeightPenaltyPerLiter, TRUTH.penalty, TOL_LIVE.penalty);
  assertNear('deg start recovered (noisy)', comp.deg.start, TRUTH.deg.start, TOL_LIVE.lapTime);
  assertNear('deg half recovered (noisy)', comp.deg.half, TRUTH.deg.half, TOL_LIVE.lapTime);
  assertNear('deg end recovered (noisy)', comp.deg.end, TRUTH.deg.end, TOL_LIVE.lapTime);
}

section('Confidence gating — fuel before deg, nothing surfaced too early');
{
  const learner = makeLearner();
  const frames = buildSession({ noiseSeed: null });

  // Feed only the first 6 frames (init + 5 lap completions). Fuel/lap should be
  // usable (~3 laps); the degradation curve must NOT yet be confident.
  for (let i = 0; i < 6; i++) learner.ingest(frames[i]);
  const early = learner.getEstimates();
  assert('fuel confident after a few laps', early.trust.fuel.confident === true);
  assert('deg NOT confident early', early.compounds[TRUTH.compoundId].confident === false);

  // Feed the whole session — now degradation becomes confident.
  for (let i = 6; i < frames.length; i++) learner.ingest(frames[i]);
  const full = learner.getEstimates();
  assert('deg confident after full session', full.compounds[TRUTH.compoundId].confident === true);
}

section('Identifiability — a single stint must NOT identify the penalty');
{
  // Only the seed stint: one fuel range → fuel and tyre-age are collinear → the
  // penalty is unidentifiable. The learner must report this (not invent a value):
  // it falls back to the seed penalty and degradation stays not-confident.
  const learner = makeLearner();
  const frames = [];
  frames.push(frame(1, 60));
  frames.push(...stintFrames(1, 60, 16, () => 0, () => 0));
  learner.ingestAll(frames);
  const est = learner.getEstimates();
  const comp = est.compounds[TRUTH.compoundId];

  assert('single-stint fuel still recovered', Math.abs(est.litersPerLap - TRUTH.litersPerLap) <= TOL_TIGHT.litersPerLap);
  assert('single-stint penalty NOT identifiable', est.trust.fuelWeightPenalty.identifiable !== true);
  assert('single-stint degradation NOT confident', comp.confident === false);
}

section('Per-compound segmentation (Task 1.2) — two compounds, distinct curves');
{
  // Session: two stints on M (practice 60 L + race 100 L), then one stint on S.
  // Tyre age resets at each pit-exit; the compound is set via the confirm flow
  // (setCompound) — never guessed. The fuel-weight penalty is a single global
  // estimate shared across both compounds.
  const learner = createLearner({
    tankSize: TRUTH.tankSize,
    compounds: { M: { tireLife: TRUTH.tireLife }, S: { tireLife: TRUTH_S.tireLife } },
    compoundId: 'M',
  });

  learner.ingest(frame(1, 60)); // init seed stint
  learner.ingestAll(genStint(1, 60, 16, TRUTH.deg, TRUTH.tireLife)); // M practice, ends currentLap 17
  learner.ingest(frame(17, TRUTH.tankSize, null, { pitExit: true })); // boundary → age resets
  learner.ingestAll(genStint(17, TRUTH.tankSize, 28, TRUTH.deg, TRUTH.tireLife)); // M race, ends currentLap 45
  learner.ingest(frame(45, TRUTH.tankSize, null, { pitExit: true })); // boundary
  learner.setCompound('S'); // user confirms the new compound
  learner.ingestAll(genStint(45, TRUTH.tankSize, 18, TRUTH_S.deg, TRUTH_S.tireLife)); // S stint

  const est = learner.getEstimates();
  const M = est.compounds.M;
  const S = est.compounds.S;

  assert('both compounds learned', M != null && S != null);
  assertNear('M deg start', M.deg.start, TRUTH.deg.start, TOL_TIGHT.lapTime);
  assertNear('M deg half', M.deg.half, TRUTH.deg.half, TOL_TIGHT.lapTime);
  assertNear('M deg end', M.deg.end, TRUTH.deg.end, TOL_TIGHT.lapTime);
  assertNear('S deg start', S.deg.start, TRUTH_S.deg.start, TOL_TIGHT.lapTime);
  assertNear('S deg half', S.deg.half, TRUTH_S.deg.half, TOL_TIGHT.lapTime);
  assertNear('S deg end', S.deg.end, TRUTH_S.deg.end, TOL_TIGHT.lapTime);
  assertNear('global penalty recovered', est.fuelWeightPenaltyPerLiter, TRUTH.penalty, TOL_TIGHT.penalty);

  assert('curves are distinct (M.end ≠ S.end)', Math.abs(M.deg.end - S.deg.end) > 0.5);
  assert('both compounds confident', M.confident === true && S.confident === true);

  // Second stint on the SAME compound refines (accumulates), not resets: M's clean
  // sample count exceeds what a single stint could provide (~26 max here).
  assert('M accumulates across both stints', M.sampleCount > 28, `M.sampleCount=${M.sampleCount}`);

  // Tyre age reset at the boundary: the S stint has clean laps at low age.
  const sLaps = learner._laps.filter((l) => l.compoundId === 'S');
  assert('tyre age resets at pit-exit (S has age-0 lap)', sLaps.some((l) => l.stintAge === 0));
  assert('S stint ages stay within its life', Math.max(...sLaps.map((l) => l.stintAge)) < TRUTH_S.tireLife);
}

// ===========================================================================
// Summary
// ===========================================================================

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
