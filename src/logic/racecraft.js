/**
 * The three questions a race engineer asks about other cars.
 *
 * The planner answers "when do I stop and on what tyre" from fuel range and
 * tyre life, both counted in laps, so a scrap for position barely moves it.
 * What a scrap DOES change is where you come out relative to the car you are
 * scrapping with — and that is a different question, asked against one rival
 * rather than against the clock:
 *
 *   1. WHERE WOULD I COME OUT? If I box this lap, who am I behind when I
 *      rejoin? Answered by taking every car's position around the track,
 *      subtracting what a stop costs from mine, and re-sorting.
 *   2. DOES THE UNDERCUT WORK? I cannot pass on track, so I box first and try
 *      to pass in the pit lane. Worth it only if my fresh-tyre advantage over
 *      their remaining out-lap pace exceeds the gap.
 *   3. WHAT AM I ABOUT TO CATCH? A backmarker three laps down on the same
 *      piece of road costs time to clear, and that is a real reason to bring a
 *      stop forward — you lose the lap either way, so lose it in the pit lane.
 *
 * None of this tries to model the cost of DEFENDING or ATTACKING. There is no
 * data to calibrate it from and it would be a guess wearing a number's
 * clothes. What fighting really costs the plan is fuel, and the burn rate is
 * already measured from telemetry — so a hard opening hour moves the box lap
 * by itself, without anything here needing to know a fight happened.
 *
 * Pure — no React, no clock of its own; the caller passes `now`.
 */

import { lapProgress } from './gaps.js';

/**
 * A car's position in the race as one number: laps completed plus how far
 * round it is. Higher is further ahead. Null when it cannot be placed yet.
 */
function positionOf(crossings, ip, now) {
  return lapProgress(crossings.get?.(ip) ?? crossings[ip], now);
}

/**
 * Where I would rejoin if I came in this lap.
 *
 * A stop is a known number of seconds standing still, and while I am standing
 * still everyone else keeps driving. Converting that loss into a fraction of a
 * lap and subtracting it from my position gives where I slot back in — which
 * is the thing actually being decided, and is not obvious from a gap column:
 * losing 55 s in the pits when the two cars behind are 30 s and 50 s back is
 * two places, but when they are 60 s and 70 s back it is none.
 *
 * Cars that are in the pits themselves are still counted. They are on the same
 * lap of the same race and will rejoin; treating them as absent would promise
 * a position that is handed straight back.
 *
 * @param {Map} crossings       lap-crossing records, keyed by car
 * @param {string} myIp         my car
 * @param {number} pitLossSecs  seconds the stop costs, standing still
 * @param {number} now          wall-clock ms
 * @param {Iterable<string>} [only]  cars to consider (excludes e.g. a safety car)
 * @param {number} [basePos]    the position to report as "from" — pass GT7's own
 *   racePos, which is what the leaderboard shows. Without it this counts cars by
 *   interpolated track position, and the two can disagree by a place in a
 *   nose-to-tail field: the strip then said "P2 → P10" beside a board showing
 *   P1, which is two notions of position on one screen. The geometry is only
 *   trusted for the DELTA — who crosses me while I am stationary — which is the
 *   part GT7 cannot answer.
 * @returns {{from:number,to:number,lost:number,aheadAfter:string[]}|null}
 */
export function positionIfPitNow(crossings, myIp, pitLossSecs, now, only = null, basePos = null) {
  if (!crossings || !myIp || !(pitLossSecs > 0)) return null;
  const ips = [...(only ?? crossings.keys?.() ?? Object.keys(crossings))];
  const placed = [];
  for (const ip of ips) {
    const p = positionOf(crossings, ip, now);
    if (p != null) placed.push({ ip, pos: p });
  }
  const me = placed.find((c) => c.ip === myIp);
  if (!me || placed.length === 0) return null;

  // My own lap time is the only sensible ruler for "how much of a lap is 55
  // seconds" — a rival's would measure my loss in someone else's pace.
  const myLapMs = (crossings.get?.(myIp) ?? crossings[myIp])?.lapMs;
  if (!(myLapMs > 0)) return null;
  const lostLaps = (pitLossSecs * 1000) / myLapMs;

  const before = placed.filter((c) => c.pos > me.pos).length + 1;

  // Places lost is who was BEHIND me and ends up AHEAD of me — not the
  // difference between two counts. Counting cars ahead before and after mixes
  // two baselines, and once `from` is anchored to GT7's number below, that
  // mismatch escapes the field entirely: a ten-car race reported "P4 → P13".
  // Defined this way it is bounded by the cars behind me, as it must be.
  const passed = placed.filter(
    (c) => c.ip !== myIp && c.pos < me.pos && c.pos > me.pos - lostLaps,
  );
  const lost = passed.length;

  // Anchor to the authoritative position when we have one, so the strip and
  // the leaderboard never print different numbers for the same car.
  const from = Number.isFinite(basePos) && basePos > 0 ? basePos : before;

  return {
    from,
    to: Math.min(from + lost, placed.length),
    lost,
    // Named, because "P4" tells you the number and this tells you the problem.
    aheadAfter: placed
      .filter((c) => c.ip !== myIp && c.pos > me.pos - lostLaps)
      .sort((a, b) => b.pos - a.pos)
      .map((c) => c.ip),
  };
}

/** Seconds per lap a fresh set is worth over one already this many laps old. */
export function freshTyreGainSecs(compound, tyreAgeLaps) {
  if (!compound) return 0;
  const life = Number(compound.tireLife) || 0;
  const age = Math.max(0, Number(tyreAgeLaps) || 0);
  if (!(life > 0)) return 0;
  const start = Number(compound.startSecs);
  const end = Number(compound.endSecs);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  // Linear between the two ends of the tyre's own curve. The engine's piecewise
  // form is more exact, but this is answering "roughly how much quicker am I on
  // new ones", over three or four laps, against a gap measured to a tenth.
  return Math.max(0, (end - start) * Math.min(1, age / life));
}

/** Laps the undercut is judged over: while the fresh tyre's edge is biggest. */
export const UNDERCUT_LAPS = 3;

/**
 * Does boxing before a rival get me out ahead of them?
 *
 * The undercut is the answer to "I am quicker but I cannot pass". I box now,
 * they stay out. For the next few laps I am on new tyres and they are on old
 * ones, so I take time out of them — but I started those laps a whole pit stop
 * behind. It works when the tyre advantage over those laps beats what I gave
 * up by stopping first, which is the difference between the two stops, not the
 * whole stop: they have to stop too.
 *
 * Which is exactly why it is worth computing rather than eyeballing. The
 * intuition "a stop costs 55 s so I need to be 55 s ahead" is wrong — both
 * cars pay it.
 *
 * @param {object} p
 * @param {number} p.gapSecs        seconds I am behind them now (negative = ahead)
 * @param {number} p.myPitLossSecs  what my stop costs
 * @param {number} p.theirPitLossSecs  what theirs costs (usually the same)
 * @param {number} p.gainPerLapSecs fresh-tyre advantage per lap
 * @param {number} [p.laps]         laps before they stop too
 * @returns {{works:boolean, marginSecs:number, gainSecs:number, laps:number}|null}
 */
export function undercut({
  gapSecs, myPitLossSecs, theirPitLossSecs, gainPerLapSecs, laps = UNDERCUT_LAPS,
}) {
  const gap = Number(gapSecs);
  const mine = Number(myPitLossSecs);
  const theirs = Number.isFinite(Number(theirPitLossSecs)) ? Number(theirPitLossSecs) : mine;
  const perLap = Number(gainPerLapSecs);
  const n = Math.max(1, Math.round(Number(laps) || UNDERCUT_LAPS));
  if (![gap, mine, theirs, perLap].every(Number.isFinite)) return null;

  const gainSecs = perLap * n;
  // I pay my stop now; they pay theirs in `n` laps. The net cost of going
  // first is only the difference between the two — plus the gap I started with.
  const marginSecs = gainSecs - gap - (mine - theirs);
  return { works: marginSecs > 0, marginSecs, gainSecs, laps: n };
}

/** Closing faster than this per lap is worth calling; below it is noise. */
const CLOSING_NOISE_SECS = 0.15;

/**
 * How far ahead to look, in laps.
 *
 * Long enough to be a reason to move a stop — bringing one forward by two or
 * three laps is a normal call — and short enough that it is about to happen.
 * Beyond this the estimate is extrapolating a pace difference measured over
 * one lap across a quarter of a stint, which it cannot support.
 */
export const REACH_LAPS = 5;

/**
 * The car I am about to catch, and how long until I am on its bumper.
 *
 * Only cars a lap or more down — traffic. A car on my lap that I am closing on
 * is a position, not an obstacle, and telling an engineer they will "catch"
 * the car they are racing is noise.
 *
 * Closing rate comes from the two cars' lap times rather than from watching
 * the gap shrink: the gap is exact once a lap, so differencing it needs two
 * laps to say anything and three to be trusted, by which point you are there.
 *
 * @param {Map} crossings
 * @param {string} myIp
 * @param {number} now
 * @param {(ip:string)=>number|null} lapsDown  whole laps that car is down on me
 * @param {number} [reachLaps]  ignore traffic further off than this many laps
 * @returns {{ip:string, laps:number, gapSecs:number, closingSecsPerLap:number, lapsDown:number}|null}
 */
export function trafficAhead(crossings, myIp, now, lapsDown, reachLaps = REACH_LAPS) {
  if (!crossings || !myIp || typeof lapsDown !== 'function') return null;
  const mine = crossings.get?.(myIp) ?? crossings[myIp];
  const myPos = positionOf(crossings, myIp, now);
  if (myPos == null || !(mine?.lapMs > 0)) return null;

  let best = null;
  for (const ip of crossings.keys?.() ?? Object.keys(crossings)) {
    if (ip === myIp) continue;
    const down = lapsDown(ip);
    if (down == null || down >= 0) continue;   // same lap, or ahead of me

    const rec = crossings.get?.(ip) ?? crossings[ip];
    const pos = positionOf(crossings, ip, now);
    if (pos == null || !(rec?.lapMs > 0)) continue;

    // How far round the lap they are in FRONT of me, ignoring whole laps —
    // that is the road between us, which is what I have to close.
    const ahead = ((pos - myPos) % 1 + 1) % 1;
    const gapSecs = (ahead * mine.lapMs) / 1000;
    const closing = (rec.lapMs - mine.lapMs) / 1000;
    if (closing <= CLOSING_NOISE_SECS) continue;   // not actually catching them

    const lapsToCatch = gapSecs / closing;
    if (lapsToCatch > reachLaps) continue;

    if (!best || lapsToCatch < best.laps) {
      best = { ip, laps: lapsToCatch, gapSecs, closingSecsPerLap: closing, lapsDown: down };
    }
  }
  return best;
}
