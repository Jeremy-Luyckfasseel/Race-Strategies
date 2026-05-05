import { useMemo, useState, Fragment } from 'react';

const TEAM_COLORS = [
  '#E8002D', '#FF8000', '#00D2BE', '#0067FF', '#39B54A',
  '#DC0000', '#B6BABD', '#005AFF', '#FFD700', '#FFFFFF',
];

const COMPOUNDS = ['H', 'M', 'S', 'IM', 'W'];
const COMPOUND_COLOR = { H: '#5EAED8', M: '#F08420', S: '#E4002B', IM: '#22CC6E', W: '#14BBCE' };
const COMPOUND_BG    = {
  H:  'rgba(94,174,216,0.14)',
  M:  'rgba(240,132,32,0.14)',
  S:  'rgba(228,0,43,0.14)',
  IM: 'rgba(34,204,110,0.14)',
  W:  'rgba(20,187,206,0.14)',
};
const COMPOUND_LABEL = { H: 'HARD', M: 'MEDIUM', S: 'SOFT', IM: 'INTER', W: 'WET' };

function formatMs(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function formatGap(ahead, behind) {
  if (!ahead || !behind) return null;
  const lapDiff = (ahead.currentLap || 0) - (behind.currentLap || 0);
  if (lapDiff > 0) return `+${lapDiff}L`;
  if (ahead.lastLapMs && behind.lastLapMs) {
    const ms = behind.lastLapMs - ahead.lastLapMs;
    if (ms > 0) return `+${(ms / 1000).toFixed(1)}s`;
  }
  return null;
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
  teams, teamLabels, teamCompounds, pendingIps, selectedIp, onSelect, onCompoundChange,
}) {
  const [pickerIp, setPickerIp] = useState(null);

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
    <div className="lb-wrap">

      {/* ── Header ── */}
      <div className="lb-header">
        <div className="lb-hcol lb-hcol-pos">#</div>
        <div className="lb-hcol lb-hcol-team">ÉQUIPE</div>
        <div className="lb-hcol lb-hcol-gap">ÉCART</div>
        <div className="lb-hcol lb-hcol-last">DERNIER</div>
        <div className="lb-hcol lb-hcol-best">MEILLEUR</div>
        <div className="lb-hcol lb-hcol-tyre">PNEU</div>
        <div className="lb-hcol lb-hcol-fuel">CARBU</div>
      </div>

      {/* ── Rows ── */}
      {sorted.map(({ ip, d }, idx) => {
        const color      = TEAM_COLORS[idx % TEAM_COLORS.length];
        const isSelected = ip === selectedIp;
        const gap        = idx === 0 ? null : formatGap(sorted[idx - 1].d, d);
        const isBestLap  = d.bestLapMs && d.bestLapMs === overallBestMs;
        const fuelPct    = Math.min(100, (d.fuelRatio ?? 0) * 100);
        const compound   = teamCompounds?.[ip] ?? null;
        const pending    = pendingIps?.has(ip) ?? false;
        const pickerOpen = pickerIp === ip;
        const pos        = d.racePos > 0 ? d.racePos : idx + 1;

        const posClass = pos === 1 ? ' lbp-gold' : pos === 2 ? ' lbp-silver' : pos === 3 ? ' lbp-bronze' : '';

        return (
          <Fragment key={ip}>
            <div
              className={`lb-row${isSelected ? ' lb-row-sel' : ''}${!d.onTrack ? ' lb-row-pit' : ''}${pickerOpen ? ' lb-row-expanded' : ''}`}
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
                    <span className="lb-tname">{teamLabels[ip] || ip}</span>
                    {!d.onTrack && <span className="lb-box-pill">BOX</span>}
                  </div>
                  <div className="lb-inline-fuel">
                    <div
                      className="lb-inline-fuel-fill"
                      style={{ width: `${fuelPct}%`, background: fuelBarColor(fuelPct) }}
                    />
                  </div>
                </div>
              </div>

              {/* Gap */}
              <div className="lbc lbc-gap">
                {idx === 0
                  ? <span className="lb-leader">LEADER</span>
                  : gap
                    ? <span className="lb-gap">{gap}</span>
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
                  title={compound ? COMPOUND_LABEL[compound] : 'Choisir un pneu'}
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
                  {pending ? '● PNEUS CHANGÉS' : 'COMPOSÉ'}
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
                      <span className="lb-cp-name">{COMPOUND_LABEL[id]}</span>
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
