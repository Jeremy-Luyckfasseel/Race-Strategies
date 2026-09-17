import { useEffect, useRef, useState, useCallback } from 'react';
import { emptyEntry, openStint, closeStint, recordLap, setCompound, assignDriver as assignDriverPure } from '../logic/stintLog';

const STORAGE_KEY = 'gt7-stint-log';

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(store)));
  } catch { /* ignore */ }
}

/**
 * React adapter over src/logic/stintLog.js: subscribes to live telemetry,
 * dedupes pit-entry/exit/lap-completion events per team (the relay marks
 * pitDetected/pitExit for a single packet, but a defensive per-lap key still
 * guards against a duplicate delivery — same pattern as useCompoundDetector),
 * and persists the resulting log to localStorage.
 *
 * A new stint opens on pit exit (driver pending until `assignDriver` is
 * called) and closes on the next pit entry; the very first stint of the race
 * opens on the first telemetry packet on track, defaulting to the first
 * configured driver (no pit to hang a prompt on yet).
 *
 * Returns:
 *   logs              Map<ip, { history: Stint[], current: Stint|null }>
 *   pendingDriverIps  Set<ip> — teams awaiting a driver pick for the new stint
 *   assignDriver(ip, driverId)
 *   resetAll()
 */
export function useStintLog(teams, teamCompounds, drivers) {
  const storeRef = useRef(loadStore());
  const [logs, setLogs] = useState(() => loadStore());

  const handledExitsRef = useRef(new Set());
  const handledPitsRef = useRef(new Set());
  const pendingRef = useRef(new Set());
  const [pendingDriverIps, setPendingDriverIps] = useState(new Set());
  const lastLapSeenRef = useRef(new Map());

  const getEntry = useCallback((ip) => storeRef.current.get(ip) ?? emptyEntry(), []);

  useEffect(() => {
    let changed = false;
    let pendingChanged = false;

    for (const [ip, data] of teams) {
      let entry = getEntry(ip);

      if (!entry.current && entry.history.length === 0 && data.onTrack && (data.currentLap ?? 0) > 0) {
        entry = openStint(entry, { driverId: drivers?.[0]?.id ?? null, compound: teamCompounds?.[ip] ?? null, startLap: data.currentLap });
        changed = true;
      }

      if (data.pitDetected) {
        const key = `${ip}-p${data.currentLap ?? 0}`;
        if (!handledPitsRef.current.has(key) && entry.current) {
          handledPitsRef.current.add(key);
          entry = closeStint(entry, { endLap: data.currentLap ?? entry.current.startLap });
          changed = true;
        }
      }

      if (data.pitExit) {
        const key = `${ip}-x${data.currentLap ?? 0}`;
        if (!handledExitsRef.current.has(key)) {
          handledExitsRef.current.add(key);
          entry = openStint(entry, { driverId: null, compound: teamCompounds?.[ip] ?? null, startLap: data.currentLap ?? 0 });
          pendingRef.current.add(ip);
          changed = true;
          pendingChanged = true;
        }
      }

      const beforeCompoundSync = entry;
      entry = setCompound(entry, teamCompounds?.[ip] ?? null);
      if (entry !== beforeCompoundSync) changed = true;

      if (entry.current && data.lastLapMs > 0) {
        const lastSeen = lastLapSeenRef.current.get(ip) ?? 0;
        if ((data.currentLap ?? 0) > lastSeen) {
          lastLapSeenRef.current.set(ip, data.currentLap);
          entry = recordLap(entry, data.lastLapMs);
          changed = true;
        }
      }

      storeRef.current.set(ip, entry);
    }

    if (changed) {
      saveStore(storeRef.current);
      setLogs(new Map(storeRef.current));
    }
    if (pendingChanged) setPendingDriverIps(new Set(pendingRef.current));
  }, [teams, teamCompounds, drivers, getEntry]);

  const assignDriver = useCallback((ip, driverId) => {
    storeRef.current.set(ip, assignDriverPure(getEntry(ip), driverId));
    pendingRef.current.delete(ip);
    setPendingDriverIps(new Set(pendingRef.current));
    saveStore(storeRef.current);
    setLogs(new Map(storeRef.current));
  }, [getEntry]);

  const resetAll = useCallback(() => {
    storeRef.current = new Map();
    pendingRef.current = new Set();
    handledExitsRef.current = new Set();
    handledPitsRef.current = new Set();
    lastLapSeenRef.current = new Map();
    setPendingDriverIps(new Set());
    saveStore(storeRef.current);
    setLogs(new Map(storeRef.current));
  }, []);

  return { logs, pendingDriverIps, assignDriver, resetAll };
}
