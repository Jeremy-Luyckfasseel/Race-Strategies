import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createLearner } from '../logic/telemetryLearner';
import { buildRecommendations, dismissSnapshot } from '../logic/recommendations';

/**
 * Runs the pure telemetry learner against the live packet stream for the selected
 * car and surfaces PROPOSE-AND-ACCEPT recommendations (Phase 1, Task 1.3).
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
 * @returns {{ estimates: object|null, recommendations: Array, ignore: (rec)=>void, clearDismiss: (rec)=>void }}
 */
export function useTelemetryLearner({ activeIp, data, inputs, confirmedCompoundId }) {
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
    setCar({
      ip: activeIp,
      learner: activeIp
        ? createLearner({
            tankSize: Number(inputs.tankSize) || 0,
            compounds: compoundLife,
            compoundId: confirmedCompoundId || undefined,
          })
        : null,
    });
    setEstimates(null);
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
      setEstimates(learner.getEstimates());
    }
  }, [learner, data]);

  const recommendations = useMemo(
    () => buildRecommendations(estimates, inputs, dismissed),
    [estimates, inputs, dismissed]
  );

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

  return { estimates, recommendations, ignore, clearDismiss };
}
