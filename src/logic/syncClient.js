/**
 * Sync client (session-import) — talks to the optional team sync server
 * (server/sync-server.js). Isomorphic: uses the global `fetch` available in both
 * Node 18+ (the recorder) and the browser (the app), so there's ONE client for
 * both sides. Pure data in/out; never throws on a non-OK status without context.
 *
 * A team shares a GROUP join code; races are matched within a group by NAME, so
 * the recorder (`--race "Spa 6h"`) and the app (a local race called "Spa 6h") line
 * up on the same remote race without exchanging ids.
 */

const base = (url) => String(url || '').replace(/\/+$/, '');

async function req(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`sync ${res.status}`);
  return res.json();
}
function post(url, body) {
  return req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function createGroup(server, name) {
  return post(`${base(server)}/api/groups`, { name });
}
export function getGroup(server, code) {
  return req(`${base(server)}/api/groups/${encodeURIComponent(code)}`);
}
export function listRaces(server, code) {
  return req(`${base(server)}/api/groups/${encodeURIComponent(code)}/races`);
}
export function createRace(server, code, name) {
  return post(`${base(server)}/api/groups/${encodeURIComponent(code)}/races`, { name });
}

/** Find a race by name within the group (case-insensitive), or create it. */
export async function ensureRace(server, code, name) {
  const races = await listRaces(server, code);
  const found = races.find((r) => r.name.toLowerCase() === String(name).toLowerCase());
  return found || createRace(server, code, name);
}

export function uploadSession(server, code, raceId, driver, capture) {
  return post(`${base(server)}/api/groups/${encodeURIComponent(code)}/races/${encodeURIComponent(raceId)}/sessions`, { driver, capture });
}
export function fetchSessions(server, code, raceId) {
  return req(`${base(server)}/api/groups/${encodeURIComponent(code)}/races/${encodeURIComponent(raceId)}/sessions`);
}
