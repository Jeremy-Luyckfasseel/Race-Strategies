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
// Per-driver curves
//
// Two drivers on the same tyre differ by more than most of what else is
// measured in this file, and the engine already lets a driver override the
// global compound times. The only thing missing was knowing who drove each
// lap. These assert the split is real: each driver's curve comes from their
// own laps, and neither is the average of the two.
// ===========================================================================

// Ana is quick and easy on the tyre; Bo is slower and chews it.
const DRIVER_A = { start: 119.0, half: 120.0, end: 121.5 };
const DRIVER_B = { start: 122.0, half: 124.0, end: 127.5 };

/** Noise-free lap frames for one driver's stint on the medium. */
function stintFor(startLapNumber, Fi, nLaps, spec) {
  return genStint(startLapNumber, Fi, nLaps, spec, TRUTH.tireLife);
}

section('naming a stint after the fact moves its measurements');
{
  // The tap that names the driver at the stop is the one most likely to be
  // missed. Correcting it later has to move the LAPS, not just the label —
  // otherwise that driver's pace and fuel stay exactly as wrong as before
  // while the Pilotes table claims they have been fixed.
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });

  // Ana's stint is recorded properly.
  L.setDriver('ana');
  L.ingest(frame(1, 60));
  L.ingestAll(stintFor(1, 60, 16, DRIVER_A));
  L.ingest(frame(17, TRUTH.tankSize, null, { pitExit: true }));
  L.ingestAll(stintFor(17, TRUTH.tankSize, 28, DRIVER_A));

  // Bo gets in, and nobody taps the picker. Bo's laps land under nobody.
  L.ingest(frame(45, TRUTH.tankSize, null, { pitExit: true }));
  L.setDriver(null);
  L.ingestAll(stintFor(45, TRUTH.tankSize, 28, DRIVER_B));

  const before = L.getEstimates();
  assert('the unnamed stint belongs to no driver',
    before.byDriver.bo === undefined, JSON.stringify(Object.keys(before.byDriver)));
  assert('and its laps are sitting unattributed',
    L._laps.filter((l) => l.driverId === null).length === 28,
    String(L._laps.filter((l) => l.driverId === null).length));

  // The engineer notices and fixes it on the Pilotes tab. The range comes from
  // the stint log, which records the game's lap at pit exit and pit entry — so
  // it is derived here rather than hardcoded, because a lap is recorded when
  // the NEXT one starts and encoding that off-by-one as if it were a spec is
  // how a fixture starts lying.
  const orphaned = L._laps.filter((l) => l.driverId === null).map((l) => l.lapNum);
  const moved = L.reassignDriver(Math.min(...orphaned), Math.max(...orphaned), 'bo');
  assert('every lap of that stint moves', moved === orphaned.length, `${moved} of ${orphaned.length}`);
  assert('and none are left unattributed',
    L._laps.filter((l) => l.driverId === null).length === 0);

  const after = L.getEstimates();
  assert('Bo now has a curve at all', !!after.byDriver.bo);
  assert('and it is the pace BO actually drove, not the car average',
    Math.abs(after.byDriver.bo.M.deg.end - DRIVER_B.end) < TOL_TIGHT.lapTime,
    JSON.stringify(after.byDriver.bo.M.deg));
  assert('Ana is untouched by it',
    Math.abs(after.byDriver.ana.M.deg.end - before.byDriver.ana.M.deg.end) < 1e-9);

  // And the fuel followed the laps, which is the half that is easy to forget.
  assert('Bo also has a measured burn rate now',
    after.fuelByDriver.bo && after.fuelByDriver.bo.litersPerLap > 0,
    JSON.stringify(after.fuelByDriver.bo));
  assert('and it is the real burn, not zero or a guess',
    Math.abs(after.fuelByDriver.bo.litersPerLap - TRUTH.litersPerLap) < 0.05,
    String(after.fuelByDriver.bo?.litersPerLap));

  // Nonsense ranges move nothing rather than throwing.
  assert('a backwards range moves nothing', L.reassignDriver(80, 10, 'ana') === 0);
  assert('and a range with no laps in it moves nothing',
    L.reassignDriver(500, 600, 'ana') === 0);
}

section('fuel is measured per driver, not just pooled');
{
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });
  L.setDriver('ana');
  L.ingest(frame(1, TRUTH.tankSize));
  L.ingestAll(stintFor(1, TRUTH.tankSize, 20, DRIVER_A));

  const e = L.getEstimates();
  assert('the car still has one overall burn rate', e.litersPerLap > 0);
  assert('and the driver has their own', e.fuelByDriver.ana.litersPerLap > 0);
  assert('measured from the same tank deltas',
    Math.abs(e.fuelByDriver.ana.litersPerLap - TRUTH.litersPerLap) < 0.05,
    String(e.fuelByDriver.ana.litersPerLap));
  assert('a driver nobody has seen has no figure', e.fuelByDriver.bo === undefined);
}

section('who drove the lap');
{
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });

  // Two laps before anyone is named at the wheel.
  L.ingest(frame(1, 60));
  L.ingestAll(genStint(1, 60, 2, DRIVER_A, TRUTH.tireLife));
  L.setDriver('ana');
  L.ingestAll(genStint(3, 60 - 2 * TRUTH.litersPerLap, 4, DRIVER_A, TRUTH.tireLife));

  const named = L._laps.filter((l) => l.driverId === 'ana');
  const unnamed = L._laps.filter((l) => l.driverId === null);
  assert('laps driven before a driver was named are not back-dated to them',
    unnamed.length === 2, `${unnamed.length} unattributed`);
  assert('and the laps after it are theirs', named.length === 4, `${named.length} attributed`);
  assert('unattributed laps still count for the car',
    L.getEstimates().compounds.M.sampleCount >= 4);
}

section('two drivers, one compound');
{
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });

  // Ana: a light-fuel seed stint then a full-tank one. Two fuel ranges over
  // overlapping tyre ages is what makes the (global) penalty identifiable.
  L.setDriver('ana');
  L.ingest(frame(1, 60));
  L.ingestAll(genStint(1, 60, 16, DRIVER_A, TRUTH.tireLife));
  L.ingest(frame(17, TRUTH.tankSize, null, { pitExit: true }));
  L.ingestAll(genStint(17, TRUTH.tankSize, 28, DRIVER_A, TRUTH.tireLife));

  // Bo takes over at the next stop, same tyre, same car.
  L.ingest(frame(45, TRUTH.tankSize, null, { pitExit: true }));
  L.setDriver('bo');
  L.ingestAll(genStint(45, TRUTH.tankSize, 28, DRIVER_B, TRUTH.tireLife));

  const e = L.getEstimates();
  const A = e.byDriver.ana.M;
  const B = e.byDriver.bo.M;

  assert('each driver gets their own curve', !!A && !!B);
  assert('both are confident after a full stint each',
    A.confident === true && B.confident === true,
    `ana=${A.sampleCount} laps, bo=${B.sampleCount} laps`);

  // The point of the whole feature: the numbers are the drivers', not the car's.
  assert("Ana's curve recovers Ana's pace",
    Math.abs(A.deg.start - DRIVER_A.start) < TOL_TIGHT.lapTime
    && Math.abs(A.deg.end - DRIVER_A.end) < TOL_TIGHT.lapTime,
    JSON.stringify(A.deg));
  assert("Bo's curve recovers Bo's pace",
    Math.abs(B.deg.start - DRIVER_B.start) < TOL_TIGHT.lapTime
    && Math.abs(B.deg.end - DRIVER_B.end) < TOL_TIGHT.lapTime,
    JSON.stringify(B.deg));

  // If either had been fitted over the whole car's laps they would both land
  // near the middle, which is exactly the answer that helps nobody.
  const mid = (DRIVER_A.end + DRIVER_B.end) / 2;
  assert('neither is the average of the two',
    Math.abs(A.deg.end - mid) > 1 && Math.abs(B.deg.end - mid) > 1,
    `A.end=${A.deg.end.toFixed(2)} B.end=${B.deg.end.toFixed(2)} mid=${mid}`);

  assert('a driver is separated by more than the tolerance that measures them',
    B.deg.end - A.deg.end > 4, `${(B.deg.end - A.deg.end).toFixed(2)}s apart`);

  // The car's own curve still exists and still uses everything.
  assert('the global compound curve still sees every lap',
    e.compounds.M.sampleCount > A.sampleCount && e.compounds.M.sampleCount > B.sampleCount,
    `global=${e.compounds.M.sampleCount} ana=${A.sampleCount} bo=${B.sampleCount}`);
}

section('a driver who has barely driven proposes nothing');
{
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });
  L.setDriver('ana');
  L.ingest(frame(1, 60));
  L.ingestAll(genStint(1, 60, 16, DRIVER_A, TRUTH.tireLife));
  L.ingest(frame(17, TRUTH.tankSize, null, { pitExit: true }));
  L.ingestAll(genStint(17, TRUTH.tankSize, 28, DRIVER_A, TRUTH.tireLife));

  // Bo does three laps and hands back — nowhere near a curve.
  L.ingest(frame(45, TRUTH.tankSize, null, { pitExit: true }));
  L.setDriver('bo');
  L.ingestAll(genStint(45, TRUTH.tankSize, 3, DRIVER_B, TRUTH.tireLife));

  const e = L.getEstimates();
  assert('the driver with a full stint is confident', e.byDriver.ana.M.confident === true);
  assert('the one with three laps is not', e.byDriver.bo.M.confident === false,
    `${e.byDriver.bo.M.sampleCount} laps`);
}

// ===========================================================================
// Summary
// ===========================================================================

section('correcting a PAST stint does not repoint the driver on track');
{
  // reassignDriver sets currentDriverId when the running stint's start lap falls
  // inside the range, so the laps still arriving go to the corrected driver. That
  // is right for the stint being driven and wrong for any earlier one — and the
  // two used to be indistinguishable, because adjacent stints shared the pit lap
  // (closeStint takes endLap: currentLap, reopenStint takes startLap: currentLap).
  // Correcting the stint that had just ended matched, and every lap from then on
  // was filed under that past driver. stintLapRange is exclusive of the closing
  // lap now, which is also simply what the learner records.
  const L = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });

  // Ana drives the first stint without being named.
  L.ingest(frame(1, TRUTH.tankSize));
  L.setDriver(null);
  L.ingestAll(stintFor(1, TRUTH.tankSize, 19, DRIVER_A));

  // Bo gets in at lap 20 and IS named.
  L.ingest(frame(20, TRUTH.tankSize, null, { pitExit: true }));
  L.setDriver('bo');
  L.ingestAll(stintFor(20, TRUTH.tankSize, 13, DRIVER_B));

  const boLapsBefore = L._laps.filter((l) => l.driverId === 'bo').length;
  assert('Bo has laps of his own before the correction', boLapsBefore > 0, String(boLapsBefore));

  // The engineer names the FIRST stint on the Pilotes tab. Its range is
  // [startLap, endLap - 1] = [1, 19] — the pit lap 20 is Bo's, not Ana's.
  const moved = L.reassignDriver(1, 19, 'ana');
  assert('Ana takes the laps of the stint she drove', moved > 0, String(moved));

  assert('and none of Bo’s laps moved with them',
    L._laps.filter((l) => l.driverId === 'bo').length === boLapsBefore,
    `${boLapsBefore} -> ${L._laps.filter((l) => l.driverId === 'bo').length}`);

  // The laps that arrive AFTER the correction must still be Bo's: he is the one
  // driving. This is the assertion the bug failed.
  L.ingestAll(stintFor(33, TRUTH.tankSize / 2, 4, DRIVER_B));
  const tail = L._laps.filter((l) => l.lapNum >= 33);
  assert('the car on track is still Bo after the correction',
    tail.length > 0 && tail.every((l) => l.driverId === 'bo'),
    JSON.stringify(tail.map((l) => [l.lapNum, l.driverId])));

  // And naming the stint that IS running still carries forward, which is the
  // behaviour the guard has to preserve rather than remove.
  const M = createLearner({ tankSize: TRUTH.tankSize, tireLife: TRUTH.tireLife, compoundId: 'M' });
  M.ingest(frame(1, TRUTH.tankSize));
  M.setDriver(null);
  M.ingestAll(stintFor(1, TRUTH.tankSize, 10, DRIVER_A));
  M.reassignDriver(1, 10, 'ana');
  M.ingestAll(stintFor(11, TRUTH.tankSize / 2, 3, DRIVER_A));
  assert('naming the running stint does carry forward',
    M._laps.filter((l) => l.lapNum >= 11).every((l) => l.driverId === 'ana'),
    JSON.stringify(M._laps.filter((l) => l.lapNum >= 11).map((l) => [l.lapNum, l.driverId])));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
