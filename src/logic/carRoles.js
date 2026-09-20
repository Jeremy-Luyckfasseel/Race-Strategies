/**
 * Not every car on the LAN is racing.
 *
 * At an organised event one PS5 is the safety car. It sits in the pit lane for
 * most of the race, is deployed when it is needed, and goes back. Treated as an
 * entrant it does real damage: it takes a place in the standings, it sits in
 * the middle of the gap chain so the interval printed against the car behind it
 * is measured to a stationary car, it collects a stint log and driver prompts
 * nobody wants, and its fuel gets read as if it were racing.
 *
 * So a car has a role. Everything that means "how is this race going" counts
 * competitors only; the safety car is kept, shown, and watched — because the
 * moment it moves is one of the most valuable pieces of information in the
 * race — but it is not ranked against people who are trying to win.
 *
 * Pure — no React.
 */

export const ROLE_COMPETITOR = 'competitor';
export const ROLE_SAFETY = 'safety';

/** The role of a car, defaulting to competitor for anything unmarked. */
export function roleOf(roles, id) {
  return roles?.[id] === ROLE_SAFETY ? ROLE_SAFETY : ROLE_COMPETITOR;
}

export function isSafetyCar(roles, id) {
  return roleOf(roles, id) === ROLE_SAFETY;
}

/** Toggle a car between competitor and safety car, returning a new map. */
export function toggleSafetyCar(roles, id) {
  const next = { ...(roles || {}) };
  if (next[id] === ROLE_SAFETY) delete next[id];
  else next[id] = ROLE_SAFETY;
  return next;
}

/**
 * Split a ranked list of `{ip, d}` rows into the race and everything else.
 *
 * Competitors keep the order they were given and keep GT7's own race position,
 * adjusted only for safety cars classified ahead of them: parked in the pits
 * one is classified last and shifts nobody, but deployed mid-pack it would
 * push every car behind it down a place, and a standings board that is wrong
 * exactly when the safety car is out is wrong at the worst possible moment.
 */
export function splitByRole(rows, roles) {
  const competitors = [];
  const safety = [];
  for (const row of rows || []) {
    if (isSafetyCar(roles, row.ip)) safety.push(row);
    else competitors.push(row);
  }

  // GT7's own position is the truth and the only thing that knows about cars
  // we are not receiving packets from. Renumbering 1..n over the tracked cars
  // instead threw that away: a single connected console always read P1, and a
  // quarter of a twelve-car lobby read P1-P4 for cars actually running P3, P6,
  // P9 and P11.
  //
  // The safety car is the one real adjustment. Only ones currently classified
  // are subtracted, which self-answers whether GT7 counts it as an entrant at
  // all: if it is not in the classification there is nothing to subtract, and
  // nobody's position jumps when it goes stale and drops off the board.
  const scPositions = safety
    .map((r) => Number(r.d?.racePos))
    .filter((n) => Number.isFinite(n) && n > 0);

  const positioned = competitors.map((row, i) => {
    const raw = Number(row.d?.racePos);
    if (!Number.isFinite(raw) || raw <= 0) {
      // The relay already normalises an absent position to null, so this is
      // practice, a lobby or a replay — order of arrival is all there is.
      return { ...row, position: i + 1 };
    }
    const ahead = scPositions.filter((p) => p < raw).length;
    return { ...row, position: raw - ahead };
  });

  return { competitors: positioned, safety };
}

/**
 * Is the safety car out?
 *
 * It lives in the pit lane, so leaving it is the signal — and `onTrack` is
 * exactly that flag. Speed is required as well because a car being pushed
 * around the garage, or one whose position flickers at the pit exit, is not a
 * deployment. Deliberately not a dwell timer: being a lap late to notice the
 * safety car is worse than being a second early.
 */
export function safetyCarDeployed(teams, roles, minSpeedKmh = 20) {
  for (const [ip, packet] of teams || []) {
    if (!isSafetyCar(roles, ip)) continue;
    if (packet?.onTrack && (packet.speedKmh ?? 0) >= minSpeedKmh) return ip;
  }
  return null;
}

/**
 * How much slower the field is running than its own green-flag pace.
 *
 * Measured rather than assumed: compare each competitor's latest lap against
 * the best lap it has set. Under a safety car everyone is slow at once, which
 * is what makes this trustworthy — one car having a bad lap moves the median
 * not at all.
 *
 * Returns a ratio (1.4 = laps are taking 40% longer), or null when there is not
 * enough to compare. This is what makes a stop cheap under a safety car: the
 * pit lane costs what it always costs, while a lap on track suddenly costs far
 * more, so the stop is a smaller fraction of the lap it is taken out of.
 */
export function fieldSlowdown(teams, roles) {
  const ratios = [];
  for (const [ip, d] of teams || []) {
    if (isSafetyCar(roles, ip)) continue;
    const last = Number(d?.lastLapMs);
    const best = Number(d?.bestLapMs);
    if (!(last > 0) || !(best > 0)) continue;
    ratios.push(last / best);
  }
  if (ratios.length < 2) return null;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

/**
 * What a pit stop actually costs while the field is slowed.
 *
 * The stop itself does not get shorter — the crew work at the same speed. What
 * changes is the race going on without you: everyone else is covering ground
 * more slowly, so you lose less of it. The track time you give up scales down
 * by the slowdown; the stationary time does not.
 *
 * Returns null unless the field is meaningfully slowed, so this never quietly
 * reports a discount that is not there.
 */
export function pitLossUnderSafetyCar(greenPitLossSecs, slowdown) {
  const loss = Number(greenPitLossSecs);
  if (!(loss > 0) || !(slowdown > 1.05)) return null;
  return loss / slowdown;
}
