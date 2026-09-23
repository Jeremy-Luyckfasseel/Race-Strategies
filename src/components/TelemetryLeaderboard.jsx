import { useMemo, useState, useEffect, Fragment } from 'react';
import { teamColor } from '../logic/teams';
import { liveInterval, formatInterval } from '../logic/gaps';
import { rivalSummary } from '../logic/rivalIntel';
import { splitByRole, isSafetyCar, toggleSafetyCar } from '../logic/carRoles';
import { detectPaceDrop } from '../logic/paceTrack';
import { DEFAULT_LANG, t, compoundShort, COMPOUND_ORDER } from '../i18n/strings';


const COMPOUND_COLOR = { H: '#5EAED8', M: '#F08420', S: '#E4002B', IM: '#22CC6E', W: '#14BBCE' };
const COMPOUND_BG    = {
  H:  'rgba(94,174,216,0.14)',
  M:  'rgba(240,132,32,0.14)',
  S:  'rgba(228,0,43,0.14)',
  IM: 'rgba(34,204,110,0.14)',
  W:  'rgba(20,187,206,0.14)',
};

function formatMs(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function hexRgb(hex) {
  return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`;
}

function fuelBarColor(pct) {
  if (pct > 50) return '#22CC6E';
  if (pct > 25) return '#F08420';
  return '#E4002B';
}

export default function TelemetryLeaderboard({
  teams, teamOrder = [], teamLabels, teamCompounds, pendingIps, selectedIp, onSelect, onCompoundChange,
  myTeamIp = '', onSetMyTeam, onRenameTeam, lapCrossings, fuelUse,
  carRoles = {}, onRoleChange, pace, scDeployed = false,
  followed = null, onToggleFollow, lang = DEFAULT_LANG,
}) {
  // Following someone quiets the rest: it only means something once one is picked.
  const anyFollowed = !!followed && followed.size > 0;
  const [pickerIp, setPickerIp] = useState(null);
  const [editingIp, setEditingIp] = useState(null);

  // The gap is interpolated between line crossings, so it needs a clock of its
  // own: without one it would only move when a packet happened to arrive AND
  // React happened to re-render. 250 ms is far finer than the 0.1 s shown and
  // costs nothing next to the telemetry flush. Date.now() is read here rather
  // than during render, which keeps the component pure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const commitRename = (ip, value) => {
    const name = value.trim();
    // An empty name clears the override and falls back to the IP, rather than
    // leaving a blank row you can no longer identify.
    onRenameTeam?.(ip, name);
    setEditingIp(null);
  };

  const sorted = useMemo(() => {
    const entries = [...teams.entries()].map(([ip, d]) => ({ ip, d }));
    entries.sort((a, b) => {
      if (a.d.racePos && b.d.racePos) return a.d.racePos - b.d.racePos;
      const lapDiff = (b.d.currentLap || 0) - (a.d.currentLap || 0);
      if (lapDiff !== 0) return lapDiff;
      if (a.d.bestLapMs && b.d.bestLapMs) return a.d.bestLapMs - b.d.bestLapMs;
      return 0;
    });
    return entries;
  }, [teams]);

  // The race is the competitors. The safety car is kept and shown, but never
  // ranked against people trying to win, and never in the gap chain — an
  // interval measured to a car parked in the pit lane is not an interval.
  const { competitors, safety } = useMemo(
    () => splitByRole(sorted, carRoles),
    [sorted, carRoles],
  );

  // The purple belongs to the race. A safety car on a hot lap is not in it.
  const overallBestMs = useMemo(() => {
    let best = Infinity;
    for (const { ip, d } of competitors) {
      if (d.bestLapMs && d.bestLapMs < best) best = d.bestLapMs;
      void ip;
    }
    return best === Infinity ? null : best;
  }, [competitors]);

  return (
    <div className={`lb-wrap${myTeamIp ? '' : ' lb-wrap--unclaimed'}`}>
      {/* Everything strategy-side hangs off which car is mine, and the star
          that sets it was invisible until you already knew it was there. */}
      {!myTeamIp && teams.size > 0 && (
        <div className="lb-claim-hint">
          <span className="lb-claim-hint-star">☆</span>
          {t('lb_claim_hint', lang)}
        </div>
      )}

      {/* ── Header ── */}
      <div className="lb-header">
        <div className="lb-hcol lb-hcol-pos">#</div>
        <div className="lb-hcol lb-hcol-team">{t('lb_team', lang)}</div>
        <div className="lb-hcol lb-hcol-gap">{t('lb_gap', lang)}</div>
        <div className="lb-hcol lb-hcol-last">{t('lb_last', lang)}</div>
        <div className="lb-hcol lb-hcol-best">{t('lb_best', lang)}</div>
        <div className="lb-hcol lb-hcol-tyre">{t('lb_tyre', lang)}</div>
        <div className="lb-hcol lb-hcol-fuel">{t('lb_fuel', lang)}</div>
      </div>

      {/* ── Rows ── */}
      {competitors.map(({ ip, d, position }, idx) => {
        // Coloured by first-seen order, never by race position — a car that
        // gains a place must not change colour, and the track map colours the
        // same way so a dot and its row always match.
        const color      = teamColor(teamOrder.indexOf(ip));
        const isSelected = ip === selectedIp;
        // Interval to the car in front, from their last line crossings.
        // Kept as the interval object, not just its text: a car a lap down is
        // not in the same fight as one 4s behind, and should not read alike.
        // Live rather than once-a-lap: see liveInterval. A boxed car is held at
        // its last crossing instead of being credited with progress it is not
        // making while stationary.
        const interval   = idx === 0
          ? null
          : liveInterval(
              lapCrossings?.get(competitors[idx - 1].ip),
              lapCrossings?.get(ip),
              now,
              !d.onTrack,
              !competitors[idx - 1].d.onTrack,
            );
        const gap        = formatInterval(interval);
        const isBestLap  = d.bestLapMs && d.bestLapMs === overallBestMs;
        const fuelPct    = Math.min(100, (d.fuelRatio ?? 0) * 100);
        const compound   = teamCompounds?.[ip] ?? null;
        const pending    = pendingIps?.has(ip) ?? false;
        const pickerOpen = pickerIp === ip;
        // Renumbered among competitors rather than taken from GT7, which
        // counts the safety car as an entrant. Parked in the pits it is
        // classified last and shifts nobody; deployed mid-pack it would push
        // every car behind it down a place.
        const pos        = position;
        const isMine     = ip === myTeamIp;
        // Derived from their own fuel trace — no input from us, nothing assumed
        // about their car. Held back until a few clean laps have been seen.
        const intel      = rivalSummary(fuelUse?.get(ip));
        const boxLap     = intel && intel.confident ? intel.pitLap : null;
        // Laps until they have to come in. The lap number alone makes you do
        // the subtraction; this is the number you actually act on.
        const boxIn      = boxLap != null && d.currentLap != null
          ? Math.max(0, boxLap - d.currentLap)
          : null;
        // A step down in pace that holds, with no stop to explain it. Free
        // intel: they will have to come in, and they are takeable now.
        // Under a safety car every car loses the same three seconds at the
        // same moment, which is a caution, not a field full of broken cars.
        const paceDrop   = d.onTrack && !scDeployed ? detectPaceDrop(pace?.get(ip)) : null;
        const isEditing  = editingIp === ip;
        const isFollowedCar = !!followed?.has(ip);
        // Once rivals are picked, the others step back so the ones I am racing
        // stand out. Mine never does.
        const isQuiet    = anyFollowed && !isFollowedCar && !isMine;

        const posClass = pos === 1 ? ' lbp-gold' : pos === 2 ? ' lbp-silver' : pos === 3 ? ' lbp-bronze' : '';

        return (
          <Fragment key={ip}>
            <div
              className={`lb-row${isSelected ? ' lb-row-sel' : ''}${!d.onTrack ? ' lb-row-pit' : ''}${pickerOpen ? ' lb-row-expanded' : ''}${isMine ? ' lb-row-mine' : ''}${isFollowedCar ? ' lb-row-followed' : ''}${isQuiet ? ' lb-row-quiet' : ''}`}
              style={{ '--tc': color, '--tcr': hexRgb(color) }}
              onClick={() => { setPickerIp(null); onSelect?.(isSelected ? '' : ip); }}
            >
              {/* Position */}
              <div className="lbc lbc-pos">
                <span className={`lb-pos${posClass}`}>{pos}</span>
              </div>

              {/* Team */}
              <div className="lbc lbc-team">
                <span className="lb-stripe" style={{ background: color }} />
                <div className="lb-team-inner">
                  <div className="lb-team-top">
                    <button
                      className={`lb-mine-btn${isMine ? ' is-mine' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onSetMyTeam?.(ip); }}
                      title={isMine ? t('lb_mine_unset', lang) : t('lb_mine_set', lang)}
                      aria-pressed={isMine}
                    >
                      {isMine ? '★' : '☆'}
                    </button>
                    {/* Follow a rival: its stops notify me and its tyre button
                        flickers. With none followed, every car does. */}
                    {!isMine && onToggleFollow && (
                      <button
                        className={`lb-follow-btn${isFollowedCar ? ' is-on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onToggleFollow(ip); }}
                        title={isFollowedCar ? t('lb_follow_unset', lang) : t('lb_follow_set', lang)}
                        aria-pressed={isFollowedCar}
                      >
                        {/* A bell: this is "tell me when they stop". Outlined
                            when off, filled when on. */}
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <path
                            d="M8 1.6a4 4 0 0 0-4 4v2.5L2.7 10.3a.6.6 0 0 0 .5.95h9.6a.6.6 0 0 0 .5-.95L12 8.1V5.6a4 4 0 0 0-4-4z"
                            fill={isFollowedCar ? 'currentColor' : 'none'}
                            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
                          />
                          <path d="M6.4 12.9a1.7 1.7 0 0 0 3.2 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                    {isEditing ? (
                      <input
                        className="lb-tname-input"
                        autoFocus
                        defaultValue={teamLabels[ip] || ''}
                        placeholder={ip}
                        maxLength={24}
                        spellCheck={false}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => commitRename(ip, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(ip, e.target.value);
                          if (e.key === 'Escape') setEditingIp(null);
                        }}
                      />
                    ) : (
                      <>
                        <span
                          className="lb-tname"
                          onDoubleClick={(e) => { e.stopPropagation(); setEditingIp(ip); }}
                          title={teamLabels[ip] ? `${teamLabels[ip]} · ${ip}` : ip}
                        >
                          {teamLabels[ip] || ip}
                        </span>
                        <button
                          className="lb-rename-btn"
                          onClick={(e) => { e.stopPropagation(); setEditingIp(ip); }}
                          title={t('lb_rename', lang)}
                        >
                          ✎
                        </button>
                      </>
                    )}
                    {paceDrop && (
                      <span
                        className="lb-damaged-pill"
                        title={t('lb_damaged_title', lang, {
                          n: (paceDrop.lostMs / 1000).toFixed(1), lap: paceDrop.fromLap,
                        })}
                      >
                        {t('lb_damaged', lang, { n: (paceDrop.lostMs / 1000).toFixed(1) })}
                      </span>
                    )}
                    {isMine && <span className="lb-mine-pill">{t('lb_me', lang)}</span>}
                    {!d.onTrack && <span className="lb-box-pill">{t('lb_box', lang)}</span>}
                  </div>
                  {/* Narrow column only: the DERNIER / MEILLEUR / CARBU columns
                      do not fit there, so the two numbers worth having follow
                      the name instead of costing another column. */}
                  <div className="lb-meta">
                    <div className="lb-inline-fuel">
                      <div
                        className="lb-inline-fuel-fill"
                        style={{ width: `${fuelPct}%`, background: fuelBarColor(fuelPct) }}
                      />
                    </div>
                    <span className="lb-meta-lap">{formatMs(d.lastLapMs)}</span>
                    <span className="lb-meta-fuel">
                      {d.fuelLiters != null ? `${d.fuelLiters.toFixed(0)}L` : '—'}
                    </span>
                    {boxIn != null && (
                      <span className="lb-meta-box" title={t('lb_box_lap', lang, { lap: boxLap })}>
                        {t('lb_box_in', lang, { n: boxIn })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Gap */}
              <div className="lbc lbc-gap">
                {idx === 0
                  ? <span className="lb-leader">{t('lb_leader', lang)}</span>
                  : gap
                    ? <span className={`lb-gap${interval?.laps ? " lb-gap-laps" : ""}`}>{gap}</span>
                    : <span className="lb-null">—</span>
                }
              </div>

              {/* Last lap */}
              <div className="lbc lbc-last lb-laptime">{formatMs(d.lastLapMs)}</div>

              {/* Best lap */}
              <div className={`lbc lbc-best lb-laptime${isBestLap ? ' lb-purple' : ''}`}>
                {isBestLap && <span className="lb-purple-dot" />}
                {formatMs(d.bestLapMs)}
              </div>

              {/* Tyre */}
              <div className="lbc lbc-tyre" onClick={e => e.stopPropagation()}>
                <button
                  className={`lb-tyre${compound ? ' lb-tyre-set' : ''}${pending ? ' lb-tyre-pending' : ''}${pickerOpen ? ' lb-tyre-open' : ''}`}
                  style={compound ? { '--cc': COMPOUND_COLOR[compound], '--ccbg': COMPOUND_BG[compound] } : {}}
                  onClick={() => setPickerIp(p => p === ip ? null : ip)}
                  title={compound ? compoundShort(compound, lang) : t('lb_pick_tyre', lang)}
                >
                  {compound ?? '?'}
                </button>
              </div>

              {/* Fuel */}
              <div className="lbc lbc-fuel">
                <div className="lb-fuel-bar">
                  <div
                    className="lb-fuel-fill"
                    style={{ width: `${fuelPct}%`, background: fuelBarColor(fuelPct) }}
                  />
                </div>
                <span className="lb-fuel-lbl">
                  {d.fuelLiters != null ? `${d.fuelLiters.toFixed(0)}L` : '—'}
                </span>
                {boxLap != null && (
                  <span
                    className="lb-box-lap"
                    title={t('lb_box_title', lang, {
                      lap: boxLap,
                      laps: intel.fuelLapsLeft.toFixed(1),
                      burn: intel.burnPerLap.toFixed(2),
                    })}
                  >
                    {t('lb_box_in', lang, { n: boxIn })}
                    <span className="lb-box-on"> {t('lb_box_lap', lang, { lap: boxLap })}</span>
                  </span>
                )}
              </div>
            </div>

            {/* ── Compound picker ── */}
            {pickerOpen && (
              <div
                className="lb-picker"
                style={{ '--tc': color }}
                onClick={e => e.stopPropagation()}
              >
                {/* The role has to be settable from here, because a car you
                    have not marked yet still looks like any other row. */}
                <div className="lb-role-row">
                  <span className="lb-picker-label">{t('lb_role', lang)}</span>
                  <button
                    className={`lb-role-btn${!isSafetyCar(carRoles, ip) ? ' is-on' : ''}`}
                    onClick={() => { if (isSafetyCar(carRoles, ip)) onRoleChange?.(toggleSafetyCar(carRoles, ip)); }}
                  >
                    {t('lb_role_competitor', lang)}
                  </button>
                  <button
                    className={`lb-role-btn lb-role-sc${isSafetyCar(carRoles, ip) ? ' is-on' : ''}`}
                    onClick={() => { if (!isSafetyCar(carRoles, ip)) onRoleChange?.(toggleSafetyCar(carRoles, ip)); }}
                  >
                    {t('lb_role_safety', lang)}
                  </button>
                </div>

                <span className="lb-picker-label">
                  {pending ? t('lb_tyres_changed', lang) : t('lb_compound', lang)}
                </span>
                <div className="lb-picker-grid">
                  {COMPOUND_ORDER.map(id => (
                    <button
                      key={id}
                      className={`lb-cp${compound === id ? ' active' : ''}`}
                      style={{ '--cc': COMPOUND_COLOR[id], '--ccbg': COMPOUND_BG[id] }}
                      onClick={() => {
                        onCompoundChange?.(ip, compound === id ? null : id);
                        setPickerIp(null);
                      }}
                    >
                      <span className="lb-cp-letter">{id}</span>
                      <span className="lb-cp-name">{compoundShort(id, lang)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Fragment>
        );
      })}

      {/* Below the race, not in it. Kept visible because the moment this moves
          is one of the most valuable things on the screen. */}
      {safety.map(({ ip, d }) => {
        const out = !!d.onTrack && (d.speedKmh ?? 0) >= 20;
        return (
          <div
            key={ip}
            className={`lb-row lb-row-sc${out ? ' is-deployed' : ''}`}
            onClick={() => { setPickerIp((prev) => (prev === ip ? null : ip)); onSelect?.(ip); }}
          >
            <div className="lbc lbc-pos"><span className="lb-sc-badge">{t('lb_sc_badge', lang)}</span></div>
            <div className="lbc lbc-team">
              <div className="lb-team-inner">
                <div className="lb-team-top">
                  <button
                    className="lb-role-clear"
                    onClick={(e) => { e.stopPropagation(); onRoleChange?.(toggleSafetyCar(carRoles, ip)); }}
                    title={t('lb_role_competitor', lang)}
                  >
                    ×
                  </button>
                  <span className="lb-tname">{teamLabels[ip] || ip}</span>
                </div>
              </div>
            </div>
            <div className="lbc lbc-gap">
              <span className={`lb-sc-state${out ? ' is-deployed' : ''}`}>
                {out ? t('lb_sc_deployed', lang) : t('lb_sc_in_pits', lang)}
              </span>
            </div>
            <div className="lbc lbc-tyre" />
          </div>
        );
      })}
    </div>
  );
}
