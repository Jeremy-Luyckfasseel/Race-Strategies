/**
 * Connection / auto-connect helpers (Phase 3, Task 3.1) — PURE JavaScript,
 * node-testable. The WebSocket wiring itself lives in the hook (browser-only); the
 * decisions that can flap or be gotten wrong — the reconnect backoff schedule,
 * whether a packet means a *live session*, and whether to auto-pick a PS5 — live
 * here so they are unit-tested.
 */

export const RECONNECT_CONFIG = {
  baseMs: 1000, // first retry after ~1s
  capMs: 15000, // backoff capped at ~15s (DECISION 4)
  sessionMinSpeedKmh: 5, // "session active" needs sustained speed over this (DECISION 5)
};

/**
 * Exponential backoff with a cap (DECISION 4): 1s → 2s → 4s → 8s → 15s (cap) …
 * @param {number} attempt  0-based retry attempt
 * @param {object} [cfg]
 * @returns {number} delay in ms
 */
export function backoffDelay(attempt, cfg = RECONNECT_CONFIG) {
  const a = Math.max(0, Math.floor(attempt));
  const raw = cfg.baseMs * 2 ** a;
  return Math.min(cfg.capMs, raw);
}

/**
 * Is this telemetry packet a *live race session*? (DECISION 5) — `onTrack` AND
 * moving. "Any packet" is not enough: GT7 emits packets in menus and while paused.
 * @param {object} packet
 * @param {object} [cfg]
 * @returns {boolean}
 */
export function isSessionActive(packet, cfg = RECONNECT_CONFIG) {
  if (!packet) return false;
  if (packet.onTrack !== true) return false;
  if (packet.paused === true) return false;
  return Number(packet.speedKmh) > cfg.sessionMinSpeedKmh;
}

/**
 * Auto-pick a PS5 from scan results ONLY when exactly one is found (DECISION 4);
 * otherwise return null so the UI prompts the user to choose (don't guess).
 * @param {Array<{ip:string}>} scanResults
 * @returns {string|null} the IP to connect to, or null
 */
export function pickAutoConnectIp(scanResults) {
  if (!Array.isArray(scanResults)) return null;
  const ips = scanResults.map((r) => r && r.ip).filter(Boolean);
  return ips.length === 1 ? ips[0] : null;
}
