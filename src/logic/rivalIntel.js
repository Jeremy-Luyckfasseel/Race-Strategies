/**
 * What the other cars are about to do.
 *
 * GT7 sends `fuelLiters` for EVERY car on the relay, not just yours, which is
 * the most under-used number in the whole feed. Watch it across a lap and you
 * have that car's burn rate; divide what is left by it and you have the lap
 * they must come in on. Knowing a rival is committed to boxing in three laps —
 * before they know you know — is most of what strategy in an endurance race is.
 *
 * Everything here is derived from the packet stream alone. Nothing is asked of
 * the user and nothing is assumed about their car: no tank size, no fuel map,
 * no compound. A car that refuels tells you how much it took on, and therefore
 * how long its next stint is, without anyone typing anything.
 *
 * Pure — no React, no clock of its own. Packet timestamps are the only time.
 */

/** Burns older than this are no longer this stint's; keep the window short. */
const BURN_WINDOW = 5;

/** Litres. Below this a change is sensor noise, not fuel being used or added. */
const NOISE_L = 0.05;

/** Litres. A rise smaller than this is not a refuel. */
const MIN_REFUEL_L = 1.0;

export function emptyFuelRecord() {
  return {
    lap: null,
    lastFuel: null,
    fuelAtLapStart: null,
    burns: [],
    refuelling: 0,
    dirtyLap: false, // fuel went IN during this lap, so its burn means nothing
    lastStop: null,  // { lap, fuelAdded }
  };
}

/**
 * Fold a batch of freshly arrived packets (ip → packet) into per-car fuel
 * history. Returns the same Map reference when nothing meaningful changed, so
 * callers can skip a re-render.
 */
export function trackFuelUse(prev, packets) {
  let next = prev;
  const edit = (ip, rec) => {
    if (next === prev) next = new Map(prev);
    next.set(ip, rec);
  };

  for (const [ip, packet] of packets) {
    // Number(null) is 0, not NaN. Letting a missing reading through as an
    // empty tank would have this predicting that the car boxes immediately —
    // confidently, and on nothing.
    const raw = packet == null ? null : packet.fuelLiters;
    if (raw == null) continue;
    const fuel = Number(raw);
    const lap = Number(packet.currentLap);
    if (!Number.isFinite(fuel) || fuel < 0) continue;

    const rec = prev.get(ip) || emptyFuelRecord();
    const delta = rec.lastFuel == null ? 0 : fuel - rec.lastFuel;

    // Rising fuel means the hose is in. Accumulate rather than treating each
    // packet as its own stop: a refuel arrives as dozens of small increases.
    let refuelling = rec.refuelling;
    let lastStop = rec.lastStop;
    let dirtyLap = rec.dirtyLap;
    if (delta > NOISE_L) {
      refuelling += delta;
      dirtyLap = true;
    } else if (refuelling > 0 && delta < -NOISE_L) {
      // Burning again: the stop is over, so bank what went in.
      if (refuelling >= MIN_REFUEL_L) {
        lastStop = { lap: rec.lap ?? lap, fuelAdded: refuelling };
      }
      refuelling = 0;
    }

    let { burns, fuelAtLapStart } = rec;
    const lapChanged = Number.isFinite(lap) && rec.lap != null && lap !== rec.lap;

    if (lapChanged) {
      // A lap's burn is only usable if the car ran the whole lap on its own
      // fuel. A lap with the hose in tells you nothing about consumption.
      if (fuelAtLapStart != null && !dirtyLap) {
        const used = fuelAtLapStart - fuel;
        if (used > NOISE_L) {
          burns = [...burns, used].slice(-BURN_WINDOW);
        }
      }
      fuelAtLapStart = fuel;
      dirtyLap = false;
    } else if (fuelAtLapStart == null) {
      fuelAtLapStart = fuel;
    }

    // A stop resets the stint: burns measured on the old fuel load still apply
    // (consumption does not change), so they are deliberately kept.
    edit(ip, {
      lap: Number.isFinite(lap) ? lap : rec.lap,
      lastFuel: fuel,
      fuelAtLapStart,
      burns,
      refuelling,
      dirtyLap,
      lastStop,
    });
  }

  return next;
}

/**
 * Litres per lap, as the median of the recent window.
 *
 * The median rather than the mean on purpose: one lift-and-coast lap, one
 * safety car lap or one lap with a long off would drag an average somewhere
 * the car has never been, and the number is used to tell someone when to box.
 */
export function burnPerLap(rec) {
  if (!rec || rec.burns.length === 0) return null;
  const s = [...rec.burns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return median > 0 ? median : null;
}

/** How many more laps this car can run on what is in the tank. */
export function fuelLapsLeft(rec) {
  const burn = burnPerLap(rec);
  if (burn == null || rec.lastFuel == null) return null;
  return rec.lastFuel / burn;
}

/**
 * The last lap this car can complete before it runs dry — so, the lap it has
 * to be in the pits by. Deliberately the floor: finishing a lap on fumes is
 * not a plan, and rounding up would have you expect a stop that never comes.
 */
export function predictedPitLap(rec) {
  const left = fuelLapsLeft(rec);
  if (left == null || rec.lap == null) return null;
  return rec.lap + Math.floor(left);
}

/**
 * How long their next stint is, from what they actually took on at the last
 * stop. This is the one that gives away a whole strategy: a small splash means
 * they are two-stopping from here, a full tank means they are not stopping again.
 */
export function stintLapsFromLastStop(rec) {
  if (!rec || !rec.lastStop) return null;
  const burn = burnPerLap(rec);
  if (burn == null) return null;
  return Math.floor(rec.lastStop.fuelAdded / burn);
}

/** Everything worth showing about one car, or null when nothing is known yet. */
export function rivalSummary(rec) {
  if (!rec) return null;
  const burn = burnPerLap(rec);
  if (burn == null) return null;
  return {
    burnPerLap: burn,
    fuelLapsLeft: fuelLapsLeft(rec),
    pitLap: predictedPitLap(rec),
    lastStopFuel: rec.lastStop ? rec.lastStop.fuelAdded : null,
    lastStopStintLaps: stintLapsFromLastStop(rec),
    confident: rec.burns.length >= 3,
  };
}
