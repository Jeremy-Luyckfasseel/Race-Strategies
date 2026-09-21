/**
 * The three questions about other cars: where I rejoin, whether the undercut
 * works, and what traffic I am about to reach.
 *
 * Run with: node tests/test_racecraft.js
 */

import {
  positionIfPitNow, undercut, trafficAhead, freshTyreGainSecs, UNDERCUT_LAPS,
} from '../src/logic/racecraft.js';

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

function section(name) {
  console.log(`\n── ${name} ──`);
}

const LAP = 90_000;      // a 90-second lap
const NOW = 1_000_000;

/** A crossing record for a car that began its current lap `agoMs` ago. */
const rec = (lap, agoMs, lapMs = LAP) => ({
  lap, crossedAt: NOW - agoMs, prevCrossedAt: NOW - agoMs - lapMs, lapMs, witnessed: true,
});

// ---------------------------------------------------------------------------

section('where I would come out');
{
  // Four cars nose to tail on the same lap, ten seconds apart. I am second.
  const c = new Map([
    ['lead', rec(10, 40_000)],
    ['me', rec(10, 30_000)],
    ['p3', rec(10, 20_000)],
    ['p4', rec(10, 10_000)],
  ]);

  const cheap = positionIfPitNow(c, 'me', 5, NOW);
  assert('a five-second stop costs nothing', cheap.to === cheap.from, JSON.stringify(cheap));
  assert('and I was second to begin with', cheap.from === 2, String(cheap.from));

  // 25 s puts me behind the two cars that were 10 and 20 s back.
  const real = positionIfPitNow(c, 'me', 25, NOW);
  assert('a real stop drops me behind both cars behind me', real.to === 4, JSON.stringify(real));
  assert('which it reports as two places lost', real.lost === 2, String(real.lost));
  assert('and names who I come out behind',
    real.aheadAfter.length === 3 && real.aheadAfter[0] === 'lead',
    JSON.stringify(real.aheadAfter));

  // The point of computing it: the same 25 s costs nothing against a field
  // that is spread out, and a gap column does not tell you which you are in.
  const spread = new Map([
    ['lead', rec(10, 40_000)],
    ['me', rec(10, 10_000)],
    ['p3', rec(9, 5_000)],
  ]);
  assert('the same stop can cost nothing in a spread-out field',
    positionIfPitNow(spread, 'me', 25, NOW).lost === 0);

  assert('a car that cannot be placed yet says nothing',
    positionIfPitNow(new Map([['me', { lap: 3, witnessed: false }]]), 'me', 25, NOW) === null);
  assert('and so does a stop that costs nothing at all',
    positionIfPitNow(c, 'me', 0, NOW) === null);

  // A safety car is not in the race, and must not take a place off anyone.
  const withSC = new Map([...c, ['sc', rec(10, 35_000)]]);
  assert('cars excluded by the caller are not counted',
    positionIfPitNow(withSC, 'me', 25, NOW, ['lead', 'me', 'p3', 'p4']).to === 4);

  // GT7 classifies the field itself, and that is what the leaderboard prints.
  // Counting cars by interpolated track position can disagree with it by a
  // place in a nose-to-tail field — which put "P2 → P10" on the strip beside a
  // board reading P1. Given the real position, the geometry is trusted only
  // for the DELTA, which is the part GT7 cannot answer.
  const anchored = positionIfPitNow(c, 'me', 25, NOW, null, 1);
  assert('the reported position is the one GT7 gave', anchored.from === 1);
  assert('and the places lost are still measured from the road',
    anchored.lost === 2 && anchored.to === 3, JSON.stringify(anchored));
  assert('with no authoritative position it falls back to counting',
    positionIfPitNow(c, 'me', 25, NOW, null, null).from === 2);
  assert('and a nonsense position is not trusted either',
    positionIfPitNow(c, 'me', 25, NOW, null, 0).from === 2);

  // The failure that made the definition matter: anchoring `from` to GT7 while
  // measuring the delta as (cars ahead after − cars ahead before) mixes two
  // baselines, and a ten-car race reported "P4 → P13". Places lost is who
  // OVERTAKES me, which cannot exceed the number of cars behind me.
  const bigStop = positionIfPitNow(c, 'me', 600, NOW, null, 1);
  assert('a stop cannot drop me past the back of the field',
    bigStop.to <= 4, JSON.stringify(bigStop));
  assert('and cannot cost more places than there are cars behind me',
    bigStop.lost <= 2, String(bigStop.lost));
}

section('the undercut');
{
  // I am 1.5 s behind. Fresh tyres are worth 0.8 s a lap for three laps.
  const yes = undercut({ gapSecs: 1.5, myPitLossSecs: 55, theirPitLossSecs: 55, gainPerLapSecs: 0.8 });
  assert('2.4 s of tyre beats a 1.5 s gap', yes.works === true, JSON.stringify(yes));
  assert('by nine tenths', Math.abs(yes.marginSecs - 0.9) < 1e-9, String(yes.marginSecs));
  assert('over the default three laps', yes.laps === UNDERCUT_LAPS);

  const no = undercut({ gapSecs: 4, myPitLossSecs: 55, theirPitLossSecs: 55, gainPerLapSecs: 0.8 });
  assert('but not a four-second gap', no.works === false, JSON.stringify(no));

  // The intuition this exists to correct: a stop costs 55 s, so surely I need
  // to be 55 s clear? No — they have to stop too, so only the DIFFERENCE
  // between the two stops counts against me.
  assert('the whole pit loss is not what the undercut has to beat',
    undercut({ gapSecs: 1.5, myPitLossSecs: 55, theirPitLossSecs: 55, gainPerLapSecs: 0.8 }).works,
    'a 1.5 s gap must not need a 55 s advantage');

  // A slower stop than theirs is a real cost, and it is that difference.
  const slowStop = undercut({ gapSecs: 1.5, myPitLossSecs: 58, theirPitLossSecs: 55, gainPerLapSecs: 0.8 });
  assert('a three-second-slower stop costs exactly three seconds',
    Math.abs(slowStop.marginSecs - (yes.marginSecs - 3)) < 1e-9, String(slowStop.marginSecs));

  assert('being ahead already makes it easier',
    undercut({ gapSecs: -2, myPitLossSecs: 55, gainPerLapSecs: 0.2 }).works === true);
  assert('nonsense in, nothing out',
    undercut({ gapSecs: NaN, myPitLossSecs: 55, gainPerLapSecs: 0.8 }) === null);
}

section('what a fresh set is worth');
{
  const M = { tireLife: 30, startSecs: 120, endSecs: 126 };
  assert('nothing on a new tyre', freshTyreGainSecs(M, 0) === 0);
  assert('half the drop at half life', Math.abs(freshTyreGainSecs(M, 15) - 3) < 1e-9);
  assert('the whole drop at the end', Math.abs(freshTyreGainSecs(M, 30) - 6) < 1e-9);
  assert('and no more past it', Math.abs(freshTyreGainSecs(M, 60) - 6) < 1e-9);
  assert('a compound with no life says nothing',
    freshTyreGainSecs({ tireLife: 0, startSecs: 120, endSecs: 126 }, 10) === 0);
}

section('traffic ahead');
{
  // A backmarker two laps down, 9 seconds up the road, lapping 3 s slower.
  const c = new Map([
    ['me', rec(20, 0, LAP)],
    ['slow', rec(18, 9_000, LAP + 3_000)],
    ['rival', rec(20, 3_000, LAP)],
  ]);
  const down = (ip) => (ip === 'slow' ? -2 : null);

  const t = trafficAhead(c, 'me', NOW, down);
  assert('the backmarker is found', t && t.ip === 'slow', JSON.stringify(t));
  // Nine seconds of THEIR slower lap is 8.7 seconds of mine, and mine is the
  // right ruler: it is my pace that closes the gap.
  assert('the road between us, measured in my pace',
    Math.abs(t.gapSecs - 8.71) < 0.05, String(t.gapSecs));
  assert('closing at three seconds a lap', Math.abs(t.closingSecsPerLap - 3) < 0.01);
  assert('so about three laps to reach them', Math.abs(t.laps - 2.9) < 0.05, String(t.laps));

  // The car I am RACING is not traffic, however fast I am closing on it.
  const onlyRival = trafficAhead(c, 'me', NOW, (ip) => (ip === 'rival' ? null : null));
  assert('a car on my lap is never reported as traffic', onlyRival === null);

  // A backmarker going the same speed is never caught, so it is not a warning.
  const same = new Map([...c, ['slow', rec(18, 9_000, LAP)]]);
  assert('a backmarker I am not catching says nothing',
    trafficAhead(same, 'me', NOW, down) === null);

  // Nor is one so far off that the stop will happen first.
  const far = new Map([...c, ['slow', rec(18, 80_000, LAP + 200)]]);
  assert('nor one I will not reach for ages',
    trafficAhead(far, 'me', NOW, down) === null);

  // Two backmarkers: the one I reach FIRST is the one that matters.
  const two = new Map([
    ['me', rec(20, 0, LAP)],
    ['near', rec(18, 4_000, LAP + 4_000)],
    ['far', rec(17, 20_000, LAP + 4_000)],
  ]);
  const bothDown = (ip) => (ip === 'near' ? -2 : ip === 'far' ? -3 : null);
  assert('the nearest backmarker is the one reported',
    trafficAhead(two, 'me', NOW, bothDown).ip === 'near');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
