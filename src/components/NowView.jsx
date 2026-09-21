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
import { t, compoundName } from '../i18n/strings';
import { formatClock } from '../logic/raceClock';
import { CONDITIONS } from '../logic/conditions';

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Who you come out between, and by how much.
 *
 * Named cars with seconds either side, because "P6" alone does not distinguish
 * rejoining into clean air from rejoining into a fight. Says "nothing behind"
 * rather than inventing a car — in a ten-car field there is no P11.
 */
function neighbours(position, lang) {
  const { ahead, behind } = position;
  const s = (n) => n.toFixed(1);
  if (ahead && behind) {
    return t('rc_pos_between', lang, {
      ahead: ahead.name, aheadSecs: s(ahead.secs),
      behind: behind.name, behindSecs: s(behind.secs),
    });
  }
  if (ahead) return t('rc_pos_ahead_only', lang, { ahead: ahead.name, aheadSecs: s(ahead.secs) });
  if (behind) return t('rc_pos_behind_only', lang, { behind: behind.name, behindSecs: s(behind.secs) });
  return t('rc_pos_alone', lang);
}

function CompoundChip({ id, lang }) {
  if (!id) return null;
  return <span className={`now-compound compound-${id}`}>{compoundName(id, lang) || id}</span>;
}

export default function NowView({ data, strategy, planLabel, litersPerLap, tireLife, frozen, onToggleFreeze, label, needsTeam, onGoToTelemetry, clock, onStartRace, onClearRace, conditions = 'dry', onConditionsChange, conditionsWarning = null, crossoverSecs = null, scDeployed = false, scPitLoss = null, scGreenPitLoss = null, scSlowdown = null, racecraft = null, lang }) {
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

  // Only the warning is worth screen space. "On target" and "you can push" are
  // both "carry on", and a team that pushes flat out all race never acts on
  // either — a line that never changes what you do is noise on a pit wall.
  const showVerdict = verdict === 'lift';

  return (
    <div className="now-view">
      {/* Outside the header: in the strip this is the first cell of the grid,
          and inside the header it was a label wedged against three controls. */}
      <span className="now-car">{label || '—'}</span>

      <div className="now-header">

        {/* The lobby is open for hours before the race. Until the race is
            started nothing here is race data, and the plan runs on the
            configured length rather than a clock. */}
        {clock ? (
          <div className="now-clock" role="group" aria-label={t('now_remaining', lang)}>
            <span className="now-clock-block">
              <span className="now-clock-k">{t('now_remaining', lang)}</span>
              <span className={`now-clock-v${clock.finished ? ' is-over' : ''}`}>
                {clock.finished ? t('now_race_over', lang) : formatClock(clock.remainingSecs)}
              </span>
            </span>
            <span className="now-clock-block now-clock-block--dim">
              <span className="now-clock-k">{t('now_elapsed', lang)}</span>
              <span className="now-clock-v">{formatClock(clock.elapsedSecs)}</span>
            </span>
            <button className="now-clock-clear" onClick={onClearRace} title={t('now_clear_race', lang)}>×</button>
          </div>
        ) : (
          <button className="now-start" onClick={onStartRace}>{t('now_start_race', lang)}</button>
        )}

        {/* One switch, because the call is made lap by lap when it starts
            raining, not from a forecast typed in beforehand. */}
        <div className="cond-switch" role="group" title={t('cond_title', lang)}>
          {CONDITIONS.map((id) => (
            <button
              key={id}
              className={`cond-btn cond-${id}${conditions === id ? ' is-on' : ''}`}
              onClick={() => onConditionsChange?.(id)}
              aria-pressed={conditions === id}
            >
              {t(`cond_${id}`, lang)}
            </button>
          ))}
        </div>

        <button className={`now-freeze${frozen ? ' is-frozen' : ''}`} onClick={onToggleFreeze}>
          {frozen ? t('now_frozen', lang) : t('now_freeze', lang)}
        </button>
      </div>

      {/* The safety car is out. Everything else on this screen matters less
          than that, and than what it does to the cost of a stop. */}
      {scDeployed && (
        <div className="now-sc" role="alert">
          <span className="now-sc-title">{t('sc_deployed', lang)}</span>
          {scPitLoss != null && (
            <span className="now-sc-call">
              {t('sc_cheap_stop', lang, {
                n: scPitLoss.toFixed(0),
                green: Number(scGreenPitLoss).toFixed(0),
              })}
            </span>
          )}
          {scSlowdown != null && (
            <span className="now-sc-dim">
              {t('sc_field_slower', lang, { n: Math.round((scSlowdown - 1) * 100) })}
            </span>
          )}
        </div>
      )}

      {conditionsWarning && <div className="now-cond-warn">{t(conditionsWarning, lang)}</div>}

      {/* What a stop this lap does to the RACE, as opposed to to the plan. The
          plan is set by fuel and tyres, both counted in laps, so a scrap for
          position barely moves it — but where you come out, and whether the
          undercut lands, are decided by the same one stop. */}
      {racecraft && (racecraft.position || racecraft.undercut || racecraft.traffic) && (
        <div className="now-rc">
          <span className="now-rc-title">{t('rc_title', lang)}</span>

          {racecraft.position && (
            <span className={`now-rc-item${racecraft.position.lost > 0 ? ' is-cost' : ' is-free'}`}>
              {racecraft.position.lost > 0
                ? t('rc_pos_drop', lang, { from: racecraft.position.from, to: racecraft.position.to })
                : t('rc_pos_hold', lang, { n: racecraft.position.to })}
              {/* The place is only half the answer. Dropping to P6 into clean
                  air is a different race from dropping to P6 half a second off
                  the car in front, and the position number cannot tell them
                  apart — this is what says whether you rejoin into a fight. */}
              <span className="now-rc-dim"> {neighbours(racecraft.position, lang)}</span>
            </span>
          )}

          {racecraft.undercut && (
            <span className={`now-rc-item${racecraft.undercut.works ? ' is-good' : ' is-dim'}`}>
              {t(racecraft.undercut.works ? 'rc_uc_works' : 'rc_uc_fails', lang, { who: racecraft.undercut.who })}
              <span className="now-rc-dim">
                {' '}
                {racecraft.undercut.works
                  ? t('rc_uc_margin', lang, { n: racecraft.undercut.marginSecs.toFixed(1), laps: racecraft.undercut.laps })
                  : t('rc_uc_short', lang, { n: Math.abs(racecraft.undercut.marginSecs).toFixed(1) })}
              </span>
            </span>
          )}

          {racecraft.traffic && (
            <span className="now-rc-item is-warn">
              {/* Rounding put "in 0 laps" on a car half a lap up the road,
                  which reads as a bug rather than as "right now". */}
              {Math.round(racecraft.traffic.laps) < 1
                ? t('rc_traffic_now', lang, { who: racecraft.traffic.who })
                : t('rc_traffic', lang, {
                    who: racecraft.traffic.who,
                    n: Math.round(racecraft.traffic.laps),
                  })}
              <span className="now-rc-dim">
                {' '}
                {t('rc_traffic_cost', lang, { n: racecraft.traffic.closingSecsPerLap.toFixed(1) })}
              </span>
            </span>
          )}
        </div>
      )}

      {crossoverSecs != null && (
        <div className="now-crossover">
          {t('cond_crossover', lang, { n: crossoverSecs.toFixed(1) })}
        </div>
      )}

      {/* Said last, in the smallest type, under a number that looks live: the
          countdown is the plan's, not the car's. It belongs at the top — and
          it has to say which of the two problems this is, because "waiting for
          telemetry" under a full field of streaming cars is simply wrong. */}
      {!hasData && (
        <div className="now-waiting">
          <span>{t(needsTeam ? 'now_no_team' : 'now_waiting', lang)}</span>
          {/* The leaderboard is on this same screen now — it just starts
              folded away, so this opens it rather than changing tab. */}
          {needsTeam && onGoToTelemetry && (
            <button className="btn-secondary now-waiting-action" onClick={onGoToTelemetry}>
              {t('now_show_field', lang)}
            </button>
          )}
        </div>
      )}

      {!strategy ? (
        <div className="now-empty">{t('now_no_plan', lang)}</div>
      ) : (
        <>
          {/* Current plan headline */}
          <div className="now-plan">
            {cs && <span className="now-stint-label">{t('now_stint', lang, { n: cs.stint.stintNum })}</span>}
            {cs && <CompoundChip id={cs.stint.compound} lang={lang} />}
            {/* On a one-compound plan the sequence just repeats the chip. */}
            {planLabel && planLabel !== compoundName(cs?.stint?.compound, lang) && (
              <span className="now-plan-seq">{planLabel}</span>
            )}
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
                <span
                  className="now-box-lap"
                  title={box && !na.runToFlag
                    ? t('now_box_reason', lang, { reason: t(`reason_${box.reason}`, lang) })
                    : undefined}
                >
                  {t('now_box_lap', lang, { lap: na.pitLap })}
                </span>
                {na.fuelToAddLiters > 0 && (
                  <span className="now-fuel">{t('now_add_fuel', lang, { n: round1(na.fuelToAddLiters) })}</span>
                )}
                <span className="now-tyres">{na.tiresChanged ? t('now_change_tyres', lang) : t('now_keep_tyres', lang)}</span>
                {na.nextCompound && <CompoundChip id={na.nextCompound} lang={lang} />}
              </div>
            ) : (
              <div className="now-action-body now-run-to-flag">{t('now_run_to_flag', lang)}</div>
            )}
            {/* This used to be its own line reading "BOX: FUEL · 62" directly
                under "Box lap 62" — the same number twice, three lines apart,
                which is how a screen starts to feel like it is shouting. WHY
                the car is coming in is worth knowing and the lap is not worth
                repeating, so the reason is a tooltip on the lap itself. */}
          </div>

          {/* Shown only when the fuel will not reach the stop at this pace. */}
          {showVerdict && (
            <div className="now-verdict now-verdict--lift">
              <span className="now-verdict-text">{t('now_lift', lang)}</span>
              {margin != null && Number.isFinite(margin) && (
                <span className="now-verdict-margin">{t('now_margin', lang, { n: round1(margin) })}</span>
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
}
