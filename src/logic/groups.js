/**
 * Team groups / races data model (session-import) — PURE JavaScript, node-testable.
 *
 * The local organisational layer for team race prep: a named **Group** (your team)
 * holds named **Races**, and each race holds the **driver sessions** shared for it
 * (one per driver, recorded at home). All pure transforms returning a NEW state —
 * persistence (localStorage) and the actual file sharing (a synced folder) live in
 * the hook / UI, not here, so this is fully unit-testable.
 *
 * State shape:
 *   {
 *     groups: [{ id, name, folderName?, races: [
 *       { id, name, folderName?, sessions: [{ id, driver, analysis }] }
 *     ]}],
 *     activeGroupId, activeRaceId
 *   }
 * `analysis` is the (slim) analyzeCapture() result for that driver's session.
 */

export function emptyGroupsState() {
  return { groups: [], activeGroupId: null, activeRaceId: null };
}

function nextId(prefix, items) {
  const ids = new Set(items.map((i) => i.id));
  let n = 1;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function getActiveGroup(state) {
  return state.groups.find((g) => g.id === state.activeGroupId) || null;
}
export function getActiveRace(state) {
  const g = getActiveGroup(state);
  return g ? g.races.find((r) => r.id === state.activeRaceId) || null : null;
}

export function createGroup(state, name) {
  const id = nextId('g', state.groups);
  const group = { id, name: name || 'Group', races: [] };
  return { ...state, groups: [...state.groups, group], activeGroupId: id, activeRaceId: null };
}

export function renameGroup(state, groupId, name) {
  return { ...state, groups: state.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) };
}

export function deleteGroup(state, groupId) {
  const groups = state.groups.filter((g) => g.id !== groupId);
  const wasActive = state.activeGroupId === groupId;
  const activeGroupId = wasActive ? groups[0]?.id ?? null : state.activeGroupId;
  const activeRaceId = wasActive ? groups[0]?.races[0]?.id ?? null : state.activeRaceId;
  return { ...state, groups, activeGroupId, activeRaceId };
}

export function setActiveGroup(state, groupId) {
  const g = state.groups.find((x) => x.id === groupId);
  return { ...state, activeGroupId: groupId, activeRaceId: g?.races[0]?.id ?? null };
}

export function addRace(state, groupId, name) {
  let raceId = null;
  const groups = state.groups.map((g) => {
    if (g.id !== groupId) return g;
    raceId = nextId('r', g.races);
    return { ...g, races: [...g.races, { id: raceId, name: name || 'Race', sessions: [] }] };
  });
  return { ...state, groups, activeGroupId: groupId, activeRaceId: raceId ?? state.activeRaceId };
}

export function renameRace(state, groupId, raceId, name) {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, races: g.races.map((r) => (r.id === raceId ? { ...r, name } : r)) } : g
    ),
  };
}

export function deleteRace(state, groupId, raceId) {
  const groups = state.groups.map((g) =>
    g.id === groupId ? { ...g, races: g.races.filter((r) => r.id !== raceId) } : g
  );
  const activeRaceId =
    state.activeRaceId === raceId ? groups.find((g) => g.id === groupId)?.races[0]?.id ?? null : state.activeRaceId;
  return { ...state, groups, activeRaceId };
}

export function setActiveRace(state, raceId) {
  return { ...state, activeRaceId: raceId };
}

/** Replace a race's driver sessions (e.g. after re-reading the shared folder). */
export function setRaceSessions(state, groupId, raceId, sessions) {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId
        ? { ...g, races: g.races.map((r) => (r.id === raceId ? { ...r, sessions } : r)) }
        : g
    ),
  };
}

/** Connect a group to a sync server: { serverUrl, code } (or null to disconnect). */
export function setGroupSync(state, groupId, sync) {
  return { ...state, groups: state.groups.map((g) => (g.id === groupId ? { ...g, sync } : g)) };
}

/** Remember which synced folder backs a race (display + re-pick convenience). */
export function setRaceFolder(state, groupId, raceId, folderName) {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId
        ? { ...g, races: g.races.map((r) => (r.id === raceId ? { ...r, folderName } : r)) }
        : g
    ),
  };
}
