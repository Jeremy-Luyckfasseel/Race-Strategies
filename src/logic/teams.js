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

import { trackFuelUse } from './rivalIntel.js';
import { trackLapTimes } from './paceTrack.js';
import { trackLapCrossings } from './gaps.js';

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
 * The identity a car is reported under — what everything downstream keys on:
 * its colour, its stint log, whether it is the starred team.
 *
 * Keying on the raw IP means a DHCP lease change makes a console look like a
 * brand-new car: new colour, empty stint log, ★ lost mid-race. A hostname
 * survives that, so one is preferred whenever we have it.
 *
 * Note what this deliberately does NOT do: change what the relay heartbeats.
 * Heartbeats keep going to the IP, which always works, because a hostname that
 * fails to forward-resolve would mean no telemetry at all. So the address is
 * used to reach the console and the hostname only to name it.
 *
 * @param registered   what the browser asked the relay to track (IP or hostname)
 * @param scannedHostname  hostname reverse-DNS found for this address, if any
 * @param sourceIp     the address the packet actually came from
 */
export function stableCarId(registered, scannedHostname, sourceIp) {
  // The user (or a previous scan) registered a real name — always honour it.
  if (registered && registered !== sourceIp) return registered;
  // Registered as a bare IP: upgrade to a hostname if the scan found one.
  if (scannedHostname) return scannedHostname;
  return sourceIp;
}

/**
 * One flush of the telemetry buffer: fold the packets that arrived since the
 * last flush into the visible state, note anyone who started a new lap, extend
 * the first-seen order, and drop cars that have gone quiet.
 *
 * Kept pure and out of the hook so the hot path is node-testable — this runs
 * 20 times a second with the whole field in it, and a test that reimplemented
 * it would be testing a lookalike rather than the real thing.
 *
 * Every field of the returned state reuses the incoming reference when nothing
 * about it changed, so callers can compare by identity and skip re-rendering.
 *
 * @param state {{teams: Map, order: string[], crossings: Map, fuel: Map, pace: Map}}
 * @param pending Map<ip, packet> — buffered arrivals, newest per car
 * @param now epoch ms, for staleness
 */
/** Drop entries for cars that are no longer present, by identity when unchanged. */
function pruneTo(map, teams) {
  if (!map || map.size === 0) return map;
  let next = null;
  for (const id of map.keys()) {
    if (teams.has(id)) continue;
    if (!next) next = new Map(map);
    next.delete(id);
  }
  return next || map;
}

export function applyFlush(state, pending, now, staleMs = TEAM_STALE_MS) {
  let { teams, order, crossings, fuel, pace } = state;

  if (pending.size > 0) {
    // Read crossings before merging, while each packet's own arrival stamp is
    // still distinguishable from the flush time.
    crossings = trackLapCrossings(crossings, pending);
    // Every car's fuel, which is what tells you when a rival must box.
    fuel = trackFuelUse(fuel || new Map(), pending);
    // A short window of completed laps, for measuring what an incident cost
    // and for spotting a rival who has quietly lost pace.
    pace = trackLapTimes(pace || new Map(), pending);

    teams = new Map(teams);
    for (const [ip, packet] of pending) {
      teams.set(ip, packet);
      order = withTeamOrder(order, ip);
    }
  }

  const before = teams;
  teams = dropStaleTeams(teams, now, staleMs);

  // Everything keyed by car has to be evicted with it. Keeping the fuel record
  // meant a console that quit to the lobby on 12 L and rejoined for the race on
  // a full tank read as 88 litres going in: the board announced a stop that
  // never happened, and committed the rival to a stint they were not on. The
  // stale burn window and lap times were just as wrong, measured against a
  // different session.
  if (teams !== before) {
    crossings = pruneTo(crossings, teams);
    fuel = pruneTo(fuel, teams);
    pace = pruneTo(pace, teams);
  }

  return { teams, order, crossings, fuel: fuel || new Map(), pace: pace || new Map() };
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

/**
 * Whether a car's stops should reach me — the pit toast and the flickering
 * "which tyre?" button.
 *
 * A 15-car field has a handful of cars I am actually racing; the rest are laps
 * up or down the road and their stops are noise. My own car always counts.
 * With no rivals followed, every car does, which is how it behaved before
 * there was a choice. Once any are followed, only those.
 *
 * @param {string} ip
 * @param {string|null} myIp
 * @param {Set<string>|null} followed
 */
export function isFollowed(ip, myIp, followed) {
  if (ip === myIp) return true;
  if (!followed || followed.size === 0) return true;
  return followed.has(ip);
}
