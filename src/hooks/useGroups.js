import { useState, useEffect, useCallback } from 'react';
import * as G from '../logic/groups';

/**
 * localStorage-backed team Groups → Races → sessions (session-import).
 *
 * Wraps the pure model in src/logic/groups.js and persists it locally so a team's
 * structure survives reloads. Only the structure + slim per-driver analyses are
 * stored (the raw lap arrays are stripped before storing); the shared folder is the
 * source of truth for the capture files themselves.
 */
const KEY = 'gt7_groups_v1';

export function useGroups() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : G.emptyGroupsState();
    } catch {
      return G.emptyGroupsState();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [state]);

  return {
    state,
    activeGroup: G.getActiveGroup(state),
    activeRace: G.getActiveRace(state),
    createGroup: useCallback((name) => setState((s) => G.createGroup(s, name)), []),
    renameGroup: useCallback((id, name) => setState((s) => G.renameGroup(s, id, name)), []),
    deleteGroup: useCallback((id) => setState((s) => G.deleteGroup(s, id)), []),
    setActiveGroup: useCallback((id) => setState((s) => G.setActiveGroup(s, id)), []),
    addRace: useCallback((gid, name) => setState((s) => G.addRace(s, gid, name)), []),
    renameRace: useCallback((gid, rid, name) => setState((s) => G.renameRace(s, gid, rid, name)), []),
    deleteRace: useCallback((gid, rid) => setState((s) => G.deleteRace(s, gid, rid)), []),
    setActiveRace: useCallback((rid) => setState((s) => G.setActiveRace(s, rid)), []),
    setRaceSessions: useCallback((gid, rid, sessions) => setState((s) => G.setRaceSessions(s, gid, rid, sessions)), []),
    setGroupSync: useCallback((gid, sync) => setState((s) => G.setGroupSync(s, gid, sync)), []),
    setRaceFolder: useCallback((gid, rid, folderName) => setState((s) => G.setRaceFolder(s, gid, rid, folderName)), []),
  };
}
