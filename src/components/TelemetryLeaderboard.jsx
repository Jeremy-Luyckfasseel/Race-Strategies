import { useMemo, useState, useEffect, Fragment } from 'react';
import { teamColor } from '../logic/teams';
import { liveInterval, formatInterval } from '../logic/gaps';
import { rivalSummary } from '../logic/rivalIntel';
import { DEFAULT_LANG, t, compoundShort } from '../i18n/strings';

const COMPOUNDS = ['H', 'M', 'S', 'IM', 'W'];
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
  myTeamIp = '', onSetMyTeam, onRenameTeam, lapCrossings, fuelUse, lang = DEFAULT_LANG,
}) {
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

  const overallBestMs = useMemo(() => {
    let best = Infinity;
    for (const [, d] of teams) if (d.bestLapMs && d.bestLapMs < best) best = d.bestLapMs;
    return best === Infinity ? null : best;
  }, [teams]);

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
      {sorted.map(({ ip, d }, idx) => {
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
              lapCrossings?.get(sorted[idx - 1].ip),
              lapCrossings?.get(ip),
              now,
              !d.onTrack,
            );
        const gap        = formatInterval(interval);
        const isBestLap  = d.bestLapMs && d.bestLapMs === overallBestMs;
        const fuelPct    = Math.min(100, (d.fuelRatio ?? 0) * 100);
        const compound   = teamCompounds?.[ip] ?? null;
        const pending    = pendingIps?.has(ip) ?? false;
        const pickerOpen = pickerIp === ip;
        const pos        = d.racePos > 0 ? d.racePos : idx + 1;
        const isMine     = ip === myTeamIp;
        // Derived from their own fuel trace — no input from us, nothing assumed
        // about their car. Held back until a few clean laps have been seen.
        const intel      = rivalSummary(fuelUse?.get(ip));
        const boxLap     = intel && intel.confident ? intel.pitLap : null;
        const isEditing  = editingIp === ip;

        const posClass = pos === 1 ? ' lbp-gold' : pos === 2 ? ' lbp-silver' : pos === 3 ? ' lbp-bronze' : '';

        return (
          <Fragment key={ip}>
            <div
              className={`lb-row${isSelected ? ' lb-row-sel' : ''}${!d.onTrack ? ' lb-row-pit' : ''}${pickerOpen ? ' lb-row-expanded' : ''}${isMine ? ' lb-row-mine' : ''}`}
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
                    {boxLap != null && (
                      <span className="lb-meta-box">{t('lb_box_lap', lang, { lap: boxLap })}</span>
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
                    {t('lb_box_lap', lang, { lap: boxLap })}
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
                <span className="lb-picker-label">
                  {pending ? t('lb_tyres_changed', lang) : t('lb_compound', lang)}
                </span>
                <div className="lb-picker-grid">
                  {COMPOUNDS.map(id => (
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
    </div>
  );
}
