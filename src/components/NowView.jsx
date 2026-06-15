/**
 * The in-race "Now" view (Phase 2, Task 2.1).
 *
 * A glanceable, full-screen race surface for the ENGINEER (not the driver — see
 * DECISIONS "Who the live view is for"): current plan, a big stint countdown, the
 * next action to relay (box lap + fuel + tyres), and a calm lift-and-coast / push
 * line with the pit reason. It is a DUMB renderer — every decision (when to warn,
 * which pit reason wins) comes from the pure helpers in src/logic/raceState.js.
 *
 * The plan it shows comes from the active strategy (accepted/manual inputs), never
 * silently from raw learner output (DECISION 2). A "freeze plan" toggle holds the
 * plan steady so nothing shifts mid-corner.
 */

import {
  currentStint,
  nextAction,
  fuelMarginLaps,
  liftAndCoastVerdict,
  fuelExhaustionLap,
  pitNowTrigger,
} from '../logic/raceState';
import { t } from '../i18n/strings';

const round1 = (x) => Math.round(x * 10) / 10;

function CompoundChip({ id, name }) {
  if (!id) return null;
  return <span className={`now-compound compound-${id}`}>{name || id}</span>;
}

export default function NowView({ data, strategy, planLabel, litersPerLap, tireLife, frozen, onToggleFreeze, label, lang }) {
  const hasData = !!data && Number.isFinite(Number(data.currentLap));
  const currentLap = hasData ? Number(data.currentLap) : strategy?.stints?.[0]?.startLap ?? null;

  const cs = strategy ? currentStint(strategy, currentLap) : null;
  const na = strategy ? nextAction(strategy, currentLap) : null;

  const fuelLiters = hasData ? Number(data.fuelLiters) : NaN;
  const margin = cs ? fuelMarginLaps(fuelLiters, litersPerLap, cs.lapsLeftInStint) : null;
  const verdict = liftAndCoastVerdict(margin);

  const dryLap = fuelExhaustionLap(currentLap, fuelLiters, litersPerLap);
  const tyreLap = tireLife && cs ? cs.stint.startLap + tireLife - 1 : null;
  const box = pitNowTrigger({ plannedPitLap: na?.pitLap, fuelExhaustionLap: dryLap, tyreWearLap: tyreLap });

  const verdictClass = verdict === 'lift' ? 'now-verdict--lift' : verdict === 'push' ? 'now-verdict--push' : 'now-verdict--ok';
  const verdictText = verdict === 'lift' ? t('now_lift', lang) : verdict === 'push' ? t('now_push', lang) : t('now_on_target', lang);

  return (
    <div className="now-view">
      <div className="now-header">
        <span className="now-car">{label || '—'}</span>
        <button className={`now-freeze${frozen ? ' is-frozen' : ''}`} onClick={onToggleFreeze}>
          {frozen ? t('now_frozen', lang) : t('now_freeze', lang)}
        </button>
      </div>

      {!strategy ? (
        <div className="now-empty">{t('now_no_plan', lang)}</div>
      ) : (
        <>
          {/* Current plan headline */}
          <div className="now-plan">
            {cs && <span className="now-stint-label">{t('now_stint', lang, { n: cs.stint.stintNum })}</span>}
            {cs && <CompoundChip id={cs.stint.compound} name={cs.stint.compoundName} />}
            {planLabel && <span className="now-plan-seq">{planLabel}</span>}
          </div>

          {/* Big stint countdown */}
          <div className="now-countdown">
            <div className="now-countdown-num">{cs ? cs.lapsLeftInStint : '—'}</div>
            <div className="now-countdown-label">{t('now_laps_left', lang)}</div>
          </div>

          {/* Next action to relay */}
          <div className="now-action">
            <div className="now-action-title">{t('now_next_action', lang)}</div>
            {na && !na.runToFlag ? (
              <div className="now-action-body">
                <span className="now-box-lap">{t('now_box_lap', lang, { lap: na.pitLap })}</span>
                {na.fuelToAddLiters > 0 && (
                  <span className="now-fuel">{t('now_add_fuel', lang, { n: round1(na.fuelToAddLiters) })}</span>
                )}
                <span className="now-tyres">{na.tiresChanged ? t('now_change_tyres', lang) : t('now_keep_tyres', lang)}</span>
                {na.nextCompound && <CompoundChip id={na.nextCompound} name={na.nextCompoundName} />}
              </div>
            ) : (
              <div className="now-action-body now-run-to-flag">{t('now_run_to_flag', lang)}</div>
            )}
            {box && !na?.runToFlag && (
              <div className={`now-box-reason now-box-reason--${box.reason}`}>
                {t('now_box_reason', lang, { reason: t(`reason_${box.reason}`, lang) })} · {box.lap}
              </div>
            )}
          </div>

          {/* Lift-and-coast / push */}
          <div className={`now-verdict ${verdictClass}`}>
            <span className="now-verdict-text">{verdictText}</span>
            {margin != null && Number.isFinite(margin) && (
              <span className="now-verdict-margin">{t('now_margin', lang, { n: round1(margin) })}</span>
            )}
          </div>

          {!hasData && <div className="now-waiting">{t('now_waiting', lang)}</div>}
        </>
      )}
    </div>
  );
}
