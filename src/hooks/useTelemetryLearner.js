import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createLearner } from '../logic/telemetryLearner';
import { buildRecommendations, dismissSnapshot } from '../logic/recommendations';
import { LEARNER_KEY, restoreFor, writeFor } from '../logic/learnerStore';

/**
 * Runs the pure telemetry learner against the live packet stream for the selected
 * car and surfaces PROPOSE-AND-ACCEPT recommendations (Phase 1, Task 1.3).
 *
 * What it measures survives a reload. An eight-hour race is eight hours of
 * measurement and it used to live only in memory, so a refresh — or venue wifi
 * dropping a tab — started the session again from zero, hours in. The laps are
 * written to localStorage once per lap and restored when the same car is
 * selected again; see logic/learnerStore.js.
 *
 * It NEVER writes into `inputs`. It holds the learner's output separately and
 * returns recommendations; only the caller's explicit Accept (applyRecommendation)
 * moves a value into the active strategy (DECISION 7). Ignored recommendations are
 * remembered and don't re-nag until the measured value shifts materially.
 *
 * @param {object}   p
 * @param {string}   p.activeIp             selected car key (learner resets when this changes)
 * @param {object}   p.data                 latest telemetry packet for that car
 * @param {object}   p.inputs               active strategy inputs (source of truth, read-only here)
 * @param {string}   p.confirmedCompoundId  compound the user confirmed for the current stint
 * @param {string}   p.currentDriverId      driver named for the current stint (from the stint log)
 * @returns {{ estimates: object|null, recommendations: Array, ignore: (rec)=>void, clearDismiss: (rec)=>void }}
 */
export function useTelemetryLearner({ activeIp, data, inputs, confirmedCompoundId, currentDriverId }) {
  const [estimates, setEstimates] = useState(null);
  const [dismissed, setDismissed] = useState({});
  const lastLapRef = useRef(null);
  const ingestLearnerRef = useRef(null);

  // Per-compound tyre life from the active inputs (user-set — DECISION 3).
  const compoundLife = useMemo(() => {
    const m = {};
    for (const c of inputs.compounds || []) m[c.id] = { tireLife: Number(c.tireLife) || 0 };
    return m;
  }, [inputs.compounds]);

  // Create a fresh learner when the selected car changes, using the official
  // "adjust state during render" pattern (no effect) so that editing inputs
  // mid-session never wipes the accumulated laps. createLearner is a pure factory,
  // safe to call during render like a useState initialiser.
  const [car, setCar] = useState({ ip: null, learner: null });
  if (activeIp !== car.ip) {
    // Pick up where this car left off, if it has been seen before. A reload
    // mid-race must not cost the race's measurement; a car never seen restores
    // nothing and behaves exactly as a fresh learner.
    let restore = null;
    try {
      restore = restoreFor(globalThis.localStorage?.getItem(LEARNER_KEY), activeIp);
    } catch { /* storage unavailable — carry on without history */ }
    const fresh = activeIp
      ? createLearner({
          tankSize: Number(inputs.tankSize) || 0,
          compounds: compoundLife,
          compoundId: restore?.compoundId || confirmedCompoundId || undefined,
          driverId: restore?.driverId || undefined,
          restore,
        })
      : null;
    setCar({ ip: activeIp, learner: fresh });
    // Estimates come back on the next lap anyway, but a restored learner
    // already knows enough to answer now — waiting two minutes to show what is
    // already on disk would look exactly like the data having been lost.
    setEstimates(fresh && restore ? fresh.getEstimates() : null);
    setDismissed({});
  }
  const learner = car.learner;

  // Push the user-confirmed compound (and its latest tyre life) into the learner
  // for the current stint. The learner never guesses the compound.
  useEffect(() => {
    if (learner && confirmedCompoundId) {
      learner.setCompound(confirmedCompoundId, compoundLife[confirmedCompoundId]?.tireLife);
    }
  }, [learner, confirmedCompoundId, compoundLife]);

  // Same idea for who is driving: named by the human at the stop, never
  // guessed. Passing null is allowed and means "these laps belong to nobody in
  // particular" — they still count towards the car's global curves.
  useEffect(() => {
    if (learner) learner.setDriver(currentDriverId || null);
  }, [learner, currentDriverId]);

  // Ingest each live packet from the PS5 (external system) and recompute estimates
  // once per new lap. This is the canonical "subscribe to an external source and
  // setState on update" effect.
  useEffect(() => {
    if (!learner) return;
    if (ingestLearnerRef.current !== learner) {
      ingestLearnerRef.current = learner;
      lastLapRef.current = null; // fresh car → reset lap throttle
    }
    if (!data) return;
    learner.ingest(data);
    const lap = Number(data.currentLap);
    if (Number.isFinite(lap) && lap !== lastLapRef.current) {
      lastLapRef.current = lap;
      // Write before publishing, on the same once-a-lap edge — roughly every
      // two minutes, and never in the 20 Hz path. A storage failure (quota,
      // private window) must not take the race down with it: the learner keeps
      // running from memory and simply has nothing to restore from later.
      try {
        const store = globalThis.localStorage;
        if (store && activeIp) {
          store.setItem(LEARNER_KEY, writeFor(store.getItem(LEARNER_KEY), activeIp, learner.snapshot()));
        }
      } catch { /* out of quota or no storage — keep learning in memory */ }
      // This is the pattern the rule exists to protect: state synchronised
      // from an external system. `data` changes ~20x/sec, but this only fires
      // when the LAP number changes — roughly once every two minutes — so it
      // cannot cascade. Doing it "properly" would mean moving the learner
      // behind useSyncExternalStore, a far bigger change than it is worth.
      // (This carried an eslint-disable for react-hooks/set-state-in-effect
      // until the persist block above went in; the rule stops flagging an
      // effect whose body contains a try statement. The reasoning stands
      // whether or not the rule can currently see it — if a later edit brings
      // the warning back, it is the directive that is missing, not a bug.)
      setEstimates(learner.getEstimates());
    }
  }, [learner, data, activeIp]);

  const recommendations = useMemo(
    () => buildRecommendations(estimates, inputs, dismissed),
    [estimates, inputs, dismissed]
  );

  /**
   * Hand a range of already-measured laps to a driver.
   *
   * Recomputes immediately rather than waiting for the next lap: the correction
   * was made because the screen was wrong, and leaving it wrong for another two
   * minutes is the same bug with a timer on it.
   */
  const reassignDriver = useCallback((fromLap, toLap, driverId) => {
    if (!learner) return 0;
    const moved = learner.reassignDriver(fromLap, toLap, driverId);
    if (moved === 0) return 0;
    setEstimates(learner.getEstimates());
    // And write it, rather than waiting for the next lap edge ~2 minutes out.
    // The stint log saved its label synchronously; a reload in between would
    // show the corrected name in the Pilotes table with the laps still filed
    // under the old driver — exactly the disagreement this feature exists to
    // remove. Same try/catch as the lap-edge write: storage is best-effort.
    try {
      const store = globalThis.localStorage;
      if (store && activeIp) {
        store.setItem(LEARNER_KEY, writeFor(store.getItem(LEARNER_KEY), activeIp, learner.snapshot()));
      }
    } catch { /* out of quota or no storage — the correction still holds in memory */ }
    return moved;
  }, [learner, activeIp]);

  const ignore = useCallback((rec) => {
    setDismissed((prev) => ({ ...prev, [rec.key]: dismissSnapshot(rec) }));
  }, []);

  // After an Accept, drop any stale dismiss snapshot for that key.
  const clearDismiss = useCallback((rec) => {
    setDismissed((prev) => {
      if (!prev[rec.key]) return prev;
      const next = { ...prev };
      delete next[rec.key];
      return next;
    });
  }, []);

  return { estimates, recommendations, ignore, clearDismiss, reassignDriver };
}
