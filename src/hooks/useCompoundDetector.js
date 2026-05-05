import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Fires a confirmation prompt (pendingIps) whenever a car exits the pit lane
 * with fresh tires. GT7 telemetry does not expose the tire compound ID, so
 * user input is the only reliable identification method.
 *
 * Returns:
 *   pendingIps           Set<ip>   — teams awaiting a compound confirmation click
 *   confirmCompound(ip, compound)  — call when the user picks a compound
 *   stopDetecting(ip)              — dismiss pending without setting a compound
 */
export function useCompoundDetector(teams) {
  const handledExitsRef = useRef(new Set()); // `${ip}-${lap}` dedup keys
  const pendingRef      = useRef(new Set());

  const [pendingIps, setPendingIps] = useState(new Set());

  useEffect(() => {
    let changed = false;
    for (const [ip, data] of teams) {
      if (!data.pitExit) continue;
      const key = `${ip}-${data.currentLap ?? 0}`;
      if (handledExitsRef.current.has(key)) continue;
      handledExitsRef.current.add(key);
      pendingRef.current.add(ip);
      changed = true;
    }
    if (changed) setPendingIps(new Set(pendingRef.current));
  }, [teams]);

  const confirmCompound = useCallback((ip) => {
    pendingRef.current.delete(ip);
    setPendingIps(new Set(pendingRef.current));
  }, []);

  const stopDetecting = useCallback((ip) => {
    pendingRef.current.delete(ip);
    setPendingIps(new Set(pendingRef.current));
  }, []);

  return { pendingIps, confirmCompound, stopDetecting };
}
