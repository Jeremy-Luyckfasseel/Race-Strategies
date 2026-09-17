import { useEffect, useRef, useState, useCallback } from 'react';
import { emptyEntry, openStint, closeStint, reopenStint, recordLapIfClean, setCompound, assignDriver as assignDriverPure } from '../logic/stintLog';

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
 * configured driver (no pit to hang a prompt on yet). Pit exit uses
 * `reopenStint`, which archives an already-open stint first if its closing
 * pit-entry packet was never seen, rather than losing it. Lap folding uses
 * `recordLapIfClean`, which skips the out-lap and any lap that was paused or
 * off track when it completed.
 *
 * `ownIp` is my car. Every car on the LAN gets a stint log (a rival's pit
 * history is useful intel), but only mine carries driver names and only mine
 * raises a driver prompt — otherwise a 10-car field would pop a confirmation
 * every time anyone pitted, and rivals' stints would be falsely labelled with
 * my drivers.
 *
 * Returns:
 *   logs              Map<ip, { history: Stint[], current: Stint|null }>
 *   pendingDriverIps  Set<ip> — teams awaiting a driver pick for the new stint
 *   assignDriver(ip, driverId)
 *   resetAll()
 */
export function useStintLog(teams, teamCompounds, drivers, ownIp = null) {
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

      // Only my own car has a driver roster — a rival's stints are logged for
      // their pit history, but naming one of my drivers on them would be a lie.
      const isOwn = ip === ownIp;

      if (!entry.current && entry.history.length === 0 && data.onTrack && (data.currentLap ?? 0) > 0) {
        entry = openStint(entry, {
          driverId: isOwn ? (drivers?.[0]?.id ?? null) : null,
          compound: teamCompounds?.[ip] ?? null,
          startLap: data.currentLap,
        });
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
          entry = reopenStint(entry, { compound: teamCompounds?.[ip] ?? null, startLap: data.currentLap ?? 0 });
          changed = true;
          // Never prompt for a rival's driver change — at a 10-car event that
          // would be a popup every time anyone in the field pitted.
          if (isOwn) {
            pendingRef.current.add(ip);
            pendingChanged = true;
          }
        }
      }

      const beforeCompoundSync = entry;
      entry = setCompound(entry, teamCompounds?.[ip] ?? null);
      if (entry !== beforeCompoundSync) changed = true;

      if (entry.current && data.lastLapMs > 0) {
        const lastSeen = lastLapSeenRef.current.get(ip) ?? 0;
        if ((data.currentLap ?? 0) > lastSeen) {
          lastLapSeenRef.current.set(ip, data.currentLap);
          const beforeLap = entry;
          entry = recordLapIfClean(entry, {
            lapMs: data.lastLapMs, currentLap: data.currentLap, paused: data.paused, onTrack: data.onTrack,
          });
          if (entry !== beforeLap) changed = true;
        }
      }

      storeRef.current.set(ip, entry);
    }

    if (changed) {
      saveStore(storeRef.current);
      setLogs(new Map(storeRef.current));
    }
    if (pendingChanged) setPendingDriverIps(new Set(pendingRef.current));
  }, [teams, teamCompounds, drivers, ownIp, getEntry]);

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
