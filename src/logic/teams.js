/**
 * Multi-car display helpers: a stable colour per team, and staleness pruning
 * for cars that stopped sending telemetry.
 *
 * Why a shared module: the leaderboard and the track map previously each kept
 * their own 10-colour array and indexed them differently — the leaderboard by
 * live race position, the map by Map insertion order — so a car's colour on
 * one never matched the other and shifted every time it gained a place. Both
 * now colour by first-seen order through `teamColor`, so a car keeps one
 * colour for the whole session in both views.
 *
 * Zero React dependency.
 */

/**
 * 16 colours chosen to stay distinguishable from each other on the dark
 * theme. Beyond 16 cars they wrap and repeat — a real GT7 lobby caps out
 * well below that.
 */
export const TEAM_PALETTE = [
  '#E8002D', // red
  '#FF7A00', // orange
  '#FFD700', // gold
  '#C6FF00', // chartreuse
  '#39B54A', // green
  '#00E5A0', // spring
  '#00D2BE', // teal
  '#14BBCE', // cyan
  '#5EAED8', // sky
  '#0067FF', // blue
  '#7B5CFF', // indigo
  '#B14BFF', // purple
  '#FF6EC7', // pink
  '#F4A261', // sand
  '#B6BABD', // silver
  '#FFFFFF', // white
];

/** A car is dropped from the display if nothing arrives for this long. */
export const TEAM_STALE_MS = 20_000;

/**
 * Colour for a team, by its index in first-seen order. An unknown team
 * (index -1, i.e. not in the order list) falls back to the first colour
 * rather than returning undefined, so a dot or row never renders colourless.
 */
export function teamColor(orderIndex) {
  if (!Number.isInteger(orderIndex) || orderIndex < 0) return TEAM_PALETTE[0];
  return TEAM_PALETTE[orderIndex % TEAM_PALETTE.length];
}

/**
 * Append `ip` to the first-seen order if it isn't already there. Returns the
 * same array reference when nothing changed, so callers can skip a re-render.
 *
 * Order is append-only on purpose: pruning a car that went offline must not
 * renumber the cars still running, or every one of them would change colour.
 */
export function withTeamOrder(order, ip) {
  if (order.includes(ip)) return order;
  return [...order, ip];
}

/**
 * Once several cars are on screen, "the car I am looking at" and "the car my
 * strategy is about" stop being the same thing, so they are resolved
 * separately:
 *
 *   strategyIp — my own car. Owns the drivers, the stint log, the learner's
 *                recommendations and the mid-race auto-fill. Changing which
 *                row is highlighted must never repoint any of that at a rival.
 *   displayIp  — the car the dashboard widget is inspecting. Free to follow a
 *                click so you can look at anyone's telemetry.
 *
 * With no team marked as mine and several cars connected, both stay null
 * rather than guessing (DECISION 4: never auto-pick among several PS5s). A
 * team marked as mine stays mine even while it is not transmitting — that is
 * a car that is off or in the garage, not a car that stopped being mine.
 */
export function resolveActiveCars({ myTeamIp = null, selectedIp = null, teamKeys = [] } = {}) {
  const strategyIp = myTeamIp || (teamKeys.length === 1 ? teamKeys[0] : null);
  return { strategyIp, displayIp: selectedIp || strategyIp };
}

/**
 * Edge-triggered flags the relay sets on a single packet only (see the pit
 * detection block in server/telemetry-server.js). Everything else in a packet
 * is a level that the next packet restates, so a plain overwrite is fine.
 */
const EDGE_FLAGS = ['pitDetected', 'pitExit'];

/**
 * Merge a newly-arrived packet over the one already buffered for the same car.
 *
 * Packets are buffered between flushes, and at ~60 Hz several arrive inside one
 * flush window — so overwriting outright would drop any edge flag carried by
 * the packets in between, losing the pit stop entirely (no compound clear, no
 * driver prompt, no stint boundary). Edges are carried forward to the packet
 * that actually gets flushed; they are cleared as usual once it is consumed.
 */
export function coalescePacket(prev, next) {
  if (!prev) return next;
  let merged = next;
  for (const flag of EDGE_FLAGS) {
    if (prev[flag] && !next[flag]) {
      if (merged === next) merged = { ...next };
      merged[flag] = true;
    }
  }
  return merged;
}

/** True when this packet's timestamp is older than the staleness window. */
export function isStalePacket(packet, nowMs, staleMs = TEAM_STALE_MS) {
  if (!packet || typeof packet.ts !== 'number') return false;
  return nowMs - packet.ts > staleMs;
}

/**
 * Drop cars whose last packet is older than the staleness window. Returns the
 * same Map reference when nothing was stale, so callers can skip a re-render.
 */
export function dropStaleTeams(teams, nowMs, staleMs = TEAM_STALE_MS) {
  let stale = null;
  for (const [ip, packet] of teams) {
    if (isStalePacket(packet, nowMs, staleMs)) (stale ??= []).push(ip);
  }
  if (!stale) return teams;
  const next = new Map(teams);
  for (const ip of stale) next.delete(ip);
  return next;
}
