import { useState, useEffect, useRef } from 'react';
import { DEFAULT_LANG, t, COMPOUND_ORDER } from '../i18n/strings';
import { rivalSummary, burnProgress } from '../logic/rivalIntel';
import { currentSetOutlook } from '../logic/tyreHistory';
import { PIT_NOW, WAIT } from '../logic/pitNow';

const CANVAS_W = 420, CANVAS_H = 190, PAD = 16;

// ── Pure helpers ────────────────────────────────────────────────────────────

function formatMs(ms) {
  if (!ms || ms <= 0) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Seconds as something read at a glance: "47s", "2m10". */
function formatGain(secs) {
  const s = Math.round(Math.abs(Number(secs) || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
}

function gearLabel(g) {
  if (g == null) return '—';
  if (g === 0)   return 'N';
  if (g === 15)  return 'R';
  return String(g);
}

/**
 * Tyre temperature, which GT7 actually reports — unlike the "wear" that used
 * to sit here, which was radius-derived and never verified to move (see
 * docs/DECISIONS.md item 4 and `npm run diag:tyres`).
 *
 * Bands are the usual slick working range: cold under ~70, happy 80-100,
 * going off past ~110.
 */
function tireTempColor(t) {
  if (t == null) return 'var(--text-muted)';
  if (t < 60) return '#5EAED8';   // stone cold
  if (t < 75) return '#7FD4E8';   // coming in
  if (t <= 105) return '#22CC6E'; // working range
  if (t <= 118) return '#F0C800'; // hot
  return '#E53535';               // overheating
}

/** Fraction of the configured tyre life used up, for the age bar. */
function tyreLifeColor(used) {
  if (used == null) return 'var(--text-muted)';
  if (used < 0.5) return '#22CC6E';
  if (used < 0.75) return '#F0C800';
  if (used < 1) return '#F08420';
  return '#E53535';
}

// ── Static sub-components ───────────────────────────────────────────────────

/**
 * How far through this set of tyres the car is, counted in laps since it left
 * the pits and measured against the tyre life configured for that compound.
 *
 * Modelled, not measured — GT7 reports no tyre wear — so it is labelled as an
 * estimate. That is the axis DECISIONS.md item 4 settled on: lap-count since
 * the stint began, which is exact, rather than a radius reading that never
 * moved.
 */
function TyreAge({ laps, life, outlook, lang }) {
  if (laps == null) return null;
  const known = life > 0;
  const used = known ? laps / life : null;
  const colour = tyreLifeColor(used);
  return (
    <div className="tw-age">
      {/* This said "TYRE LIFE / estimated", which pointed the word "estimated"
          at the one number here that is exact: laps since the car left the
          pits, counted, not modelled. What is a guess is the LIFE it is
          measured against — the figure you typed in the sidebar — so that is
          what is labelled now. Reading "estimated" over a counted lap made the
          whole block look untrustworthy. */}
      <span className="ld-section-label">
        {t('ld_tyre_life', lang)}{' '}
        <span className="ld-dim">
          {known ? t('ld_estimated', lang, { n: life }) : t('ld_no_life_set', lang)}
        </span>
      </span>
      <div className="tw-age-body">
        <span className="tw-age-val" style={{ color: colour }}>
          {laps}
          <span className="tw-age-unit">{t('ld_laps', lang)}</span>
        </span>
        {known && (
          <div className="tw-age-track">
            <div
              className="tw-age-fill"
              style={{ width: `${Math.min(100, used * 100)}%`, background: colour }}
            />
          </div>
        )}
      </div>

      {/* What previous sets of this compound actually gave, read back from the
          stint log. Silent until there is a finished set to compare against. */}
      {outlook && (
        <div className="tw-outlook">
          <span className="tw-outlook-main">
            {t('ld_typical', lang, { n: outlook.typicalLaps })}
          </span>
          <span className={`tw-outlook-left${outlook.beyondPrevious ? ' is-beyond' : ''}`}>
            {outlook.beyondPrevious
              ? t('ld_beyond', lang)
              : t('ld_set_left', lang, { n: outlook.lapsLeft })}
          </span>
          {outlook.falloffMs != null && (
            <span className="tw-outlook-dim">
              {t('ld_falloff', lang, { n: (outlook.falloffMs / 1000).toFixed(1) })}
            </span>
          )}
          <span className="tw-outlook-dim">
            {t('ld_prev_sets', lang)} {outlook.previousLaps.join(', ')}
          </span>
        </div>
      )}
    </div>
  );
}

function CarTopDown() {
  return (
    <svg viewBox="0 0 44 80" className="tw-car-svg" aria-hidden="true">
      <rect x="7" y="6" width="30" height="68" rx="10"
        fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <rect x="11" y="13" width="22" height="15" rx="3"
        fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <rect x="11" y="52" width="22" height="13" rx="3"
        fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <line x1="22" y1="30" x2="22" y2="50"
        stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="2 3" />
    </svg>
  );
}

function TireCorner({ temp, pos }) {
  const tc = tireTempColor(temp);
  const has = temp != null && Number.isFinite(temp);
  // Fill the bar across the band that matters on track (40-130 °C), so the
  // four corners can be compared at a glance for a hot side or a cold corner.
  const pct = has ? Math.max(0, Math.min(100, ((temp - 40) / 90) * 100)) : 0;
  return (
    <div className="tw-corner" style={{ borderColor: has ? tc : 'var(--rule)' }}>
      <span className="tw-pos">{pos}</span>
      <span className="tw-wear-big" style={{ color: has ? tc : 'var(--text-muted)' }}>
        {has ? temp.toFixed(0) : '—'}
        {has && <span className="tw-wear-unit">°C</span>}
      </span>
      <div className="tw-wear-track">
        <div className="tw-wear-fill" style={{ width: `${pct}%`, background: tc }} />
      </div>
    </div>
  );
}


const COMPOUND_CLS = { H: 'cp-hard', M: 'cp-med', S: 'cp-soft', IM: 'cp-inter', W: 'cp-wet' };

// ── TrackMap — SVG output, RAF recording loop ──────────────────────────────
//
// Architecture:
//   • Recording runs at 60Hz in an RAF loop — reads live.current, mutates map.current
//   • SVG path strings are rebuilt only when dirty (new track points) or lap changes
//   • Car dots use direct DOM mutation + lerp — no React state in the hot path

const EMPTY_MAP = { track: '', pit: '', pitBox: null, empty: true, ptCount: 0, hasPit: false };

// Order disconnected recorded segments by nearest-neighbour chaining so the
// track renders as one continuous line instead of many fragments.
function orderSegments(segs) {
  const valid = segs.filter(s => s.length > 0);
  if (valid.length === 0) return [];
  if (valid.length === 1) return [{ pts: valid[0], rev: false }];

  const used = new Array(valid.length).fill(false);
  const result = [];
  used[0] = true;
  result.push({ pts: valid[0], rev: false });

  while (result.length < valid.length) {
    const { pts, rev } = result[result.length - 1];
    const end = rev ? pts[0] : pts[pts.length - 1];
    let bestI = -1, bestD = Infinity, bestRev = false;

    for (let i = 0; i < valid.length; i++) {
      if (used[i]) continue;
      const s = valid[i];
      const ds = (end.x - s[0].x) ** 2 + (end.z - s[0].z) ** 2;
      const de = (end.x - s[s.length - 1].x) ** 2 + (end.z - s[s.length - 1].z) ** 2;
      if (ds < bestD) { bestD = ds; bestI = i; bestRev = false; }
      if (de < bestD) { bestD = de; bestI = i; bestRev = true;  }
    }
    if (bestI < 0) break;
    used[bestI] = true;
    result.push({ pts: valid[bestI], rev: bestRev });
  }
  return result;
}

// ── CarDots — 60Hz RAF loop, direct DOM mutation + lerp, no React re-renders ──
function CarDots({ live, map }) {
  const gRef = useRef(null);

  useEffect(() => {
    const NS = 'http://www.w3.org/2000/svg';
    // Per-car lerped positions: colorIdx → { cx, cy }
    const smoothed = new Map();

    // My car keeps its own team colour and is marked by a halo and a slightly
    // larger dot — not by a different colour, or it would stop matching its
    // leaderboard row. Cars in the pits stay on the map, dimmed, so you can
    // see who is boxed rather than having them blink out of existence.
    const mkDot = (isOwn, color, label, lapped) => {
      const g = document.createElementNS(NS, 'g');
      if (isOwn) {
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('r', '8');
        ring.setAttribute('fill', color);
        ring.setAttribute('fill-opacity', '0.22');
        ring.setAttribute('stroke', color);
        ring.setAttribute('stroke-opacity', '0.55');
        ring.setAttribute('stroke-width', '1');
        g.appendChild(ring);
      }

      const dot = document.createElementNS(NS, 'circle');
      // A car a lap or more away is not in your race this lap: smaller and
      // faded, so the dots that are still full weight are the ones to look at.
      dot.setAttribute('r', isOwn ? '4.5' : lapped ? '3' : '4');
      dot.setAttribute('fill', color);
      if (!isOwn) dot.setAttribute('fill-opacity', lapped ? '0.45' : '0.85');
      dot.setAttribute('stroke', 'rgba(0,0,0,0.55)');
      dot.setAttribute('stroke-width', '0.75');
      g.appendChild(dot);

      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('y', isOwn ? '-10' : '-7');
      txt.setAttribute('fill', color);
      if (lapped) txt.setAttribute('fill-opacity', '0.6');
      txt.setAttribute('font-size', isOwn ? '8.5' : lapped ? '6.5' : '7.5');
      txt.setAttribute('font-weight', isOwn ? '800' : '700');
      txt.setAttribute('font-family', 'Barlow Condensed, sans-serif');
      // Dark outline painted behind the glyphs so short tags stay readable
      // where a dozen cars pile up on the same corner.
      txt.setAttribute('stroke', 'rgba(0,0,0,0.75)');
      txt.setAttribute('stroke-width', '2');
      txt.setAttribute('paint-order', 'stroke');
      txt.textContent = label || '';
      g.appendChild(txt);

      return g;
    };

    let raf;
    const loop = (ts) => {
      const root = gRef.current;
      const { cars } = live.current;
      const m = map.current;
      if (root && m.bounds && cars?.length) {
        const { minX, maxX, minZ, maxZ } = m.bounds;
        const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
        const scale  = Math.min((CANVAS_W - PAD*2) / rangeX, (CANVAS_H - PAD*2) / rangeZ);
        const ox     = PAD + ((CANVAS_W - PAD*2) - rangeX * scale) / 2;
        const oz     = PAD + ((CANVAS_H - PAD*2) - rangeZ * scale) / 2;

        // Keep boxed cars on the map (dimmed) instead of dropping them — where
        // a rival is sitting in the pit lane is exactly what a pit wall wants.
        const active = cars.filter(c => c.posX != null);

        // Label boxes already drawn this frame. A tag that would land on top
        // of one is moved under its dot instead of over it, and only dropped
        // when both positions are taken — hiding first lost tags that had a
        // perfectly good spot free right below them.
        // ponytail: O(n^2) over the field; fine to ~30 cars, revisit past that.
        const placed = [];
        const LABEL_W = 15;   // half-width of a 2-3 character tag, px
        const LABEL_H = 9;    // line height, px

        // Cull smoothed entries for cars no longer active
        const activeIds = new Set(active.map(c => c.id));
        for (const id of smoothed.keys()) if (!activeIds.has(id)) smoothed.delete(id);

        // Sync DOM child count
        while (root.childElementCount < active.length)
          root.appendChild(document.createElementNS(NS, 'g'));
        while (root.childElementCount > active.length)
          root.removeChild(root.lastChild);

        active.forEach((c, i) => {
          const color = c.color;

          // Entity interpolation: maintain a small ring-buffer of (x, z, timestamp)
          // entries and render at (now - DELAY_MS). This gives two bracketing points
          // to interpolate between, so motion is always perfectly smooth with zero
          // backward corrections. If we've run past the buffer (packet drought), we
          // fall back to linear extrapolation from the last two points, capped to
          // EXTRAP_MS so the dot doesn't drift far from reality.
          //
          // DELAY_MS must stay comfortably above useTelemetry's FLUSH_MS (50 ms):
          // the gap between the two is the whole slack the loop has before a late
          // flush pushes it into extrapolating and then snapping back. Simulated at
          // 250 km/h, 80 ms held up at normal timing but extrapolated ~2% of frames
          // once flushes jittered by 30 ms; 130 ms holds at 0%. The cost is that the
          // dot sits ~9 m behind reality instead of ~5.6 m, which on this canvas is
          // well under one pixel. If FLUSH_MS ever changes, revisit this.
          const DELAY_MS  = 130;  // render this many ms behind the newest position
          const EXTRAP_MS = 120;  // max extrapolation past the newest buffer entry
          const BUF_MAX   = 24;   // ~1.2 s of history at the 20 Hz flush rate

          let s = smoothed.get(c.id);
          if (!s) {
            s = { buf: [{ x: c.posX, z: c.posZ, ts }], gpX: c.posX, gpZ: c.posZ };
            smoothed.set(c.id, s);
          } else {
            const prev = s.buf[s.buf.length - 1];
            if (prev.x !== c.posX || prev.z !== c.posZ) {
              s.buf.push({ x: c.posX, z: c.posZ, ts });
              if (s.buf.length > BUF_MAX) s.buf.shift();
            }
          }

          const renderTs = ts - DELAY_MS;
          const buf = s.buf;

          if (buf.length === 1 || renderTs <= buf[0].ts) {
            // Not enough history yet — show the only known position
            s.gpX = buf[0].x; s.gpZ = buf[0].z;
          } else if (renderTs >= buf[buf.length - 1].ts) {
            // Render time is past our newest sample — extrapolate from last two points
            const p0 = buf[buf.length - 2];
            const p1 = buf[buf.length - 1];
            const dt    = p1.ts - p0.ts;
            const since = renderTs - p1.ts;
            if (dt > 0 && dt < 300 && since < EXTRAP_MS) {
              const r = since / dt;
              s.gpX = p1.x + (p1.x - p0.x) * r;
              s.gpZ = p1.z + (p1.z - p0.z) * r;
            } else {
              s.gpX = p1.x; s.gpZ = p1.z;
            }
          } else {
            // Normal case: find the two buffer entries that bracket renderTs
            let lo = 0;
            for (let j = 1; j < buf.length - 1; j++) {
              if (buf[j].ts <= renderTs) lo = j; else break;
            }
            const p0 = buf[lo], p1 = buf[lo + 1];
            const frac = (renderTs - p0.ts) / (p1.ts - p0.ts);
            s.gpX = p0.x + (p1.x - p0.x) * frac;
            s.gpZ = p0.z + (p1.z - p0.z) * frac;
          }

          const scx = ox + (s.gpX - minX) * scale;
          const scy = oz + (s.gpZ - minZ) * scale;

          const child = root.children[i];

          // Rebuild inner elements only when what they draw actually changes —
          // which car this slot holds, whether it is mine, or its name after a
          // rename. Its colour is fixed for the session, so it is not a factor.
          const shape = `${c.id}|${c.isOwn ? 1 : 0}|${c.label}|${c.lapped ? 1 : 0}`;
          if (child._carShape !== shape) {
            child._carShape = shape;
            while (child.firstChild) child.removeChild(child.firstChild);
            const fresh = mkDot(c.isOwn, color, c.label, c.lapped);
            while (fresh.firstChild) child.appendChild(fresh.firstChild);
          }

          const tag = child.lastChild;
          if (tag) {
            const above = c.isOwn ? -10 : -7;
            const below = c.isOwn ? 15 : 13;
            const free = (dy) => !placed.some(
              (p) => Math.abs(p.x - scx) < LABEL_W && Math.abs(p.y - (scy + dy)) < LABEL_H,
            );
            // Mine is never dropped: it is the one tag that has to be there.
            const dy = free(above) ? above : free(below) ? below : (c.isOwn ? above : null);
            if (dy == null) {
              tag.setAttribute('opacity', '0');
            } else {
              placed.push({ x: scx, y: scy + dy });
              tag.setAttribute('y', String(dy));
              tag.setAttribute('opacity', '1');
            }
          }

          // Pit state flips often, so dim in place rather than rebuilding.
          child.setAttribute('opacity', c.onTrack ? '1' : '0.35');
          child.setAttribute('transform', `translate(${scx.toFixed(1)},${scy.toFixed(1)})`);
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []); // live/map are refs — stable, always current

  return <g ref={gRef} />;
}

// ── TrackMap — render-only; recording lives in useTrackMap (App level) ────────
export function TrackMap({ currentLap, cars, mapRef, onReset, lang = DEFAULT_LANG }) {
  const [mapState, setMapState] = useState(EMPTY_MAP);

  const live = useRef({});
  // Same reason as useTrackMap: the dot loop reads this every frame, so an
  // effect is soon enough, and assigning during render is not permitted.
  useEffect(() => { live.current = { cars, currentLap }; });

  useEffect(() => {
    const buildSVG = () => {
      const m    = mapRef.current;
      const pPts = m.pitLane?.pts ?? [];
      m.dirty    = false;

      const ptCount = m.segs.reduce((n, s) => n + s.length, 0);
      const hasPit  = !!m.pitLane;

      if (ptCount < 2) {
        setMapState(prev => (prev.empty && prev.ptCount === ptCount) ? prev : { ...EMPTY_MAP, ptCount, hasPit });
        return;
      }

      let { minX, maxX, minZ, maxZ } = m.bounds ?? { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const p of pPts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      if (m.pitLane?.box) {
        const p = m.pitLane.box;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
      m.bounds = { minX, maxX, minZ, maxZ };

      const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
      const scale  = Math.min((CANVAS_W - PAD*2) / rangeX, (CANVAS_H - PAD*2) / rangeZ);
      const ox     = PAD + ((CANVAS_W - PAD*2) - rangeX * scale) / 2;
      const oz     = PAD + ((CANVAS_H - PAD*2) - rangeZ * scale) / 2;
      const tx     = x => +(ox + (x - minX) * scale).toFixed(2);
      const tz     = z => +(oz + (z - minZ) * scale).toFixed(2);

      // Order and stitch all segments into one continuous track path.
      // Adjacent segment endpoints within 25 m are connected with L (line-to)
      // instead of M (move-to), eliminating gaps from tab-switches or freezes.
      const STITCH_SQ = 625; // 25 m in GPS space
      const ordered = orderSegments(m.segs);
      let trackD = '';
      let prevGpsX = null, prevGpsZ = null;

      for (const { pts, rev } of ordered) {
        const seq = rev ? [...pts].reverse() : pts;
        for (let j = 0; j < seq.length; j++) {
          const pt = seq[j];
          const cx = tx(pt.x), cy = tz(pt.z);
          if (j === 0) {
            const gapSq = prevGpsX !== null
              ? (pt.x - prevGpsX) ** 2 + (pt.z - prevGpsZ) ** 2
              : Infinity;
            trackD += gapSq <= STITCH_SQ ? `L${cx} ${cy}` : `M${cx} ${cy}`;
          } else {
            trackD += `L${cx} ${cy}`;
          }
        }
        if (seq.length > 0) {
          prevGpsX = seq[seq.length - 1].x;
          prevGpsZ = seq[seq.length - 1].z;
        }
      }

      let pit = '';
      if (pPts.length > 1) {
        pit = `M${tx(pPts[0].x)} ${tz(pPts[0].z)}` +
              pPts.slice(1).map(p => `L${tx(p.x)} ${tz(p.z)}`).join('');
      }

      const pitBox = m.pitLane?.box ? { x: tx(m.pitLane.box.x), y: tz(m.pitLane.box.z) } : null;
      setMapState({ track: trackD, pit, pitBox, empty: false, ptCount, hasPit });
    };

    let raf, lastBuildTs = 0, mountBuild = true;
    const loop = (ts) => {
      // Always build once on mount (shows data loaded from localStorage),
      // then only rebuild when the recording loop marks new cells as dirty.
      if ((mountBuild || mapRef.current.dirty) && ts - lastBuildTs > 100) {
        buildSVG();
        lastBuildTs = ts;
        mountBuild = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mapRef]);

  const handleReset = () => {
    onReset?.();
    setMapState(EMPTY_MAP);
  };

  const { track, pit, pitBox, empty, ptCount, hasPit } = mapState;

  return (
    <div className="track-map">
      <div className="track-map-header">
        <span className="ld-section-label">
          {t('ld_track_map', lang)}
          <span className="ld-dim">
            {ptCount < 2 ? t('ld_drive_to_trace', lang) : t('ld_pts', lang, { n: ptCount })}
          </span>
          {hasPit && <span className="ld-dim" style={{ marginLeft: 6 }}>· PIT ✓</span>}
        </span>
        {ptCount > 0 && (
          <button className="track-map-reset" onClick={handleReset}>{t('ld_reset', lang)}</button>
        )}
      </div>
      <div className="track-map-svg-wrap">
        <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} className="track-map-svg" xmlns="http://www.w3.org/2000/svg">
          {track && (
            <path d={track} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" />
          )}
          {pit && (
            <path d={pit} fill="none" stroke="rgba(255,200,0,0.50)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" />
          )}
          {pitBox && (
            <g>
              <circle cx={pitBox.x} cy={pitBox.y} r="9" fill="rgba(255,200,0,0.12)" stroke="rgba(255,200,0,0.55)" strokeWidth="1.5" />
              <text x={pitBox.x} y={pitBox.y} textAnchor="middle" dominantBaseline="middle"
                fill="rgba(255,200,0,0.85)" fontSize="8" fontWeight="700" fontFamily="Barlow Condensed, sans-serif">{t('ld_pit_marker', lang)}</text>
            </g>
          )}
          <CarDots live={live} map={mapRef} />
          {/* With cars already on screen the prompt moves out of the middle —
              it used to sit underneath the dots, with both unreadable. */}
          {empty && (
            <text
              x={CANVAS_W / 2}
              y={cars?.length ? CANVAS_H * 0.12 : CANVAS_H / 2}
              textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.15)" fontSize="13" fontWeight="600"
              fontFamily="Barlow Condensed, sans-serif">
              {t('ld_drive_a_lap', lang)}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

// ── LiveDashboard ───────────────────────────────────────────────────────────

export default function LiveDashboard({
  data, label, compound, pendingConfirmation, onCompoundChange,
  drivers, currentDriverId, pendingDriver, onDriverChange,
  tyreLaps = null, tyreLife = null, fuelRecord = null, stintEntry = null,
  incident = null, onIncident, onClearIncident, onIncidentLoss, onApplyPace, lang = DEFAULT_LANG,
}) {
  const [showVitals, setShowVitals] = useState(false);

  if (!data) return null;

  const rpmMax      = data.rpmLimiter > 1000 ? data.rpmLimiter : 9000;
  const rpmPct      = data.rpm != null ? Math.min(100, (data.rpm / rpmMax) * 100) : 0;
  const warnPct     = data.rpmWarning > 0 ? (data.rpmWarning / rpmMax) * 100 : 80;
  const rpmColor    = rpmPct >= warnPct ? (rpmPct >= 95 ? 'var(--danger)' : 'var(--warning)') : 'var(--success)';
  const throttlePct = Math.round(((data.throttle ?? 0) / 255) * 100);
  // What this car's own fuel trace says about when it has to come in. Works
  // for anyone on the LAN — it is their telemetry, not our setup.
  const intel = rivalSummary(fuelRecord);
  const measuring = intel ? null : burnProgress(fuelRecord);
  // Laps until this car has to come in, which is the number an engineer acts
  // on — "box on lap 74" needs arithmetic in your head at 3am.
  const boxInLaps = intel && intel.confident && intel.pitLap != null && data.currentLap != null
    ? Math.max(0, intel.pitLap - data.currentLap)
    : null;
  const setOutlook = currentSetOutlook(stintEntry, compound, data.currentLap);
  const brakePct    = Math.round(((data.brake    ?? 0) / 255) * 100);

  return (
    <div className="live-dashboard">
      <div className="ld-data-panel">

        <div className="ld-header">
          <span className="ld-team-label">{label}</span>
          <div className="ld-header-meta">
            {data.currentLap != null && (
              <span className="ld-meta-chip">
                <span className="ld-meta-k">{t('ld_lap', lang)}</span>
                <span className="ld-meta-v">
                  {data.currentLap}
                  {/* A timed endurance race has no lap total and GT7 reports
                      none, so there is usually nothing to put here. */}
                  {data.totalLaps > 0 && <span className="ld-dim">/{data.totalLaps}</span>}
                </span>
              </span>
            )}
            {data.racePos > 0 && (
              <span className="ld-meta-chip">
                <span className="ld-meta-k">{t('ld_pos', lang)}</span>
                <span className="ld-meta-v">
                  P{data.racePos}
                  {data.totalCars > 0 && <span className="ld-dim">/{data.totalCars}</span>}
                </span>
              </span>
            )}
            {onIncident && (
              incident ? (
                <button
                  className="ld-incident-btn is-active"
                  onClick={onClearIncident}
                  title={t('inc_clear', lang)}
                >
                  {t('inc_active', lang, { lap: incident.lap })}
                  <span className="ld-incident-x">×</span>
                </button>
              ) : (
                <button className="ld-incident-btn" onClick={onIncident} title={t('inc_title', lang)}>
                  {t('inc_button', lang)}
                </button>
              )
            )}
            {data.paused && <span className="ld-badge ld-badge-paused">{t('ld_paused', lang)}</span>}
            <span className={`ld-badge ${data.onTrack ? 'ld-badge-track' : 'ld-badge-pit'}`}>
              {data.onTrack ? t('ld_on_track', lang) : t('ld_in_pit', lang)}
            </span>
          </div>
        </div>

        <div className="ld-body">

          <div className="ld-col">
            <div className="ld-gear-speed">
              <div className="ld-gear-box">
                <span className="ld-gear">{gearLabel(data.gear)}</span>
                {data.suggestedGear > 0 && data.suggestedGear !== 15 && data.suggestedGear !== data.gear && (
                  <span className="ld-suggested">↑{data.suggestedGear}</span>
                )}
              </div>
              <div className="ld-speed-box">
                <span className="ld-speed-val">{data.speedKmh ?? 0}</span>
                <span className="ld-speed-unit">km/h</span>
              </div>
            </div>

            {data.rpm != null && (
              <div className="ld-bar-row">
                <span className="ld-bar-lbl">RPM</span>
                <div className="ld-bar-track">
                  <div className="ld-bar-fill" style={{ width: `${rpmPct}%`, background: rpmColor }} />
                  <div className="ld-rpm-warn-mark" style={{ left: `${warnPct}%` }} />
                </div>
                <span className="ld-bar-val">{data.rpm?.toLocaleString()}</span>
              </div>
            )}

            {(data.throttle != null || data.brake != null) && (
              <div className="ld-pedals">
                <div className="ld-bar-row">
                  <span className="ld-bar-lbl">{t('ld_throttle', lang)}</span>
                  <div className="ld-bar-track">
                    <div className="ld-bar-fill ld-gas" style={{ width: `${throttlePct}%` }} />
                  </div>
                  <span className="ld-bar-val">{throttlePct}%</span>
                </div>
                <div className="ld-bar-row">
                  <span className="ld-bar-lbl">{t('ld_brake', lang)}</span>
                  <div className="ld-bar-track">
                    <div className="ld-bar-fill ld-brk" style={{ width: `${brakePct}%` }} />
                  </div>
                  <span className="ld-bar-val">{brakePct}%</span>
                </div>
              </div>
            )}

            <div className="ld-bar-row ld-fuel-row">
              <span className="ld-bar-lbl">{t('ld_fuel', lang)}</span>
              <div className="ld-bar-track">
                <div className="ld-fuel-fill" style={{ width: `${Math.min(100, (data.fuelRatio ?? 0) * 100)}%` }} />
              </div>
              <span className="ld-bar-val">{data.fuelLiters?.toFixed(1)} L</span>
            </div>

            {/* Read off their own fuel trace: how long it lasts, and therefore
                the lap they are committed to boxing on. */}
            <div className="ld-fuel-intel">
              {intel && intel.confident ? (
                <>
                  {/* Range first, then the lap the TANK commits them to. That
                      second number is not the plan's box lap — the plan may
                      call them in earlier for tyres — so it says "dry", not
                      "box", or the two read as the same thing disagreeing.
                      The burn rate is the input to both rather than a decision
                      of its own, so it is the tooltip and not a third chip. */}
                  <span
                    className="ld-fi-laps"
                    title={t('ld_burn', lang, { n: intel.burnPerLap.toFixed(2) })}
                  >
                    {t('ld_fuel_laps', lang, { n: intel.fuelLapsLeft.toFixed(1) })}
                  </span>
                  {intel.pitLap != null && (
                    <span className="ld-fi-box">{t('ld_box_lap', lang, { lap: intel.pitLap })}</span>
                  )}
                </>
              ) : measuring ? (
                <span className="ld-fi-wait">
                  {t('ld_estimating', lang, { n: measuring.have, need: measuring.need })}
                </span>
              ) : null}
            </div>

            {/* What the incident actually cost: the one-off, the ongoing rate,
                and the three-way call that follows from them. */}
            {incident && (
              <div className="ld-incident">
                <div className="ld-inc-line">
                  {incident.oneOffSecs != null && (
                    <span className="ld-inc-once">
                      {t('inc_one_off', lang, { n: incident.oneOffSecs.toFixed(1) })}
                    </span>
                  )}
                  {incident.lossSecs != null ? (
                    <span className="ld-inc-rate">
                      {t('inc_per_lap', lang, { n: incident.lossSecs.toFixed(1) })}
                    </span>
                  ) : (
                    <span className="ld-inc-wait">{t('inc_measuring', lang)}</span>
                  )}
                  <label className="ld-inc-manual">
                    <input
                      type="number" min="0" step="0.1"
                      value={incident.manualSecs ?? ''}
                      placeholder={t('inc_manual_ph', lang)}
                      onChange={(e) => onIncidentLoss?.(e.target.value)}
                    />
                    {t('inc_manual', lang)}
                  </label>
                </div>

                {/* Both futures run through the real engine, so "does coming
                    in actually cost a stop" is answered rather than assumed. */}
                {incident.compare && (
                  <>
                    <div className="ld-inc-options">
                      <div className={`ld-inc-opt${incident.compare.best === PIT_NOW ? ' is-best' : ''}`}>
                        <span className="ld-inc-opt-k">{t('inc_box_now', lang)}</span>
                        <span className="ld-inc-opt-v">
                          {t('inc_laps', lang, { n: incident.compare.pitLaps })}
                        </span>
                      </div>
                      <div className={`ld-inc-opt${incident.compare.best === WAIT ? ' is-best' : ''}`}>
                        <span className="ld-inc-opt-k">
                          {incident.nextStopLap != null
                            ? t('inc_wait', lang, { lap: incident.nextStopLap })
                            : t('inc_wait_flag', lang)}
                        </span>
                        <span className="ld-inc-opt-v">
                          {t('inc_laps', lang, { n: incident.compare.waitLaps })}
                        </span>
                      </div>
                    </div>

                    <div className={`ld-inc-call ld-inc-call--${incident.compare.best ?? 'tied'}`}>
                      {incident.compare.tied
                        ? t('inc_tied', lang)
                        : (incident.compare.best === PIT_NOW
                          ? t('inc_box_now', lang)
                          : (incident.nextStopLap != null
                            ? t('inc_wait', lang, { lap: incident.nextStopLap })
                            : t('inc_wait_flag', lang)))}
                      {!incident.compare.tied && (
                        <span className="ld-inc-margin">
                          {t('inc_ahead_time', lang, {
                            n: formatGain(incident.compare.advantageSecs),
                          })}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Propose, never impose: the plan only moves on a click, the
                    same way the learner's numbers do. */}
                {incident.lossSecs != null && onApplyPace && (
                  <button
                    className={`ld-inc-apply${incident.applied ? ' is-applied' : ''}`}
                    onClick={() => onApplyPace(incident.applied ? 0 : incident.lossSecs, incident.nextStopLap)}
                  >
                    {incident.applied ? t('inc_applied', lang) : t('inc_apply', lang)}
                  </button>
                )}
              </div>
            )}

            {/* "+10.2 L → 2 laps" reads as "that fill buys two laps". It does
                not: the 2 is how long ago the stop was. Said in words, because
                an arrow between two numbers will always be read as a rate. */}
            {intel && intel.lastStopFuel != null && intel.lastStopStintLaps != null && (
              <div className="ld-fuel-intel ld-fuel-intel--dim">
                <span className="ld-fi-burn">{t('ld_last_stop', lang)}</span>
                <span className="ld-fi-laps">
                  {t('ld_took_on', lang, {
                    n: intel.lastStopFuel.toFixed(1),
                    laps: intel.lastStopStintLaps,
                  })}
                </span>
              </div>
            )}

            <button className="ld-vitals-toggle" onClick={() => setShowVitals(v => !v)}>
              {showVitals ? t('ld_hide_engine', lang) : t('ld_show_engine', lang)}
            </button>
            {showVitals && (
              <div className="ld-vitals-chips">
                {data.waterTemp != null && data.waterTemp !== 0 && (
                  <div className="ld-chip">
                    <span className="ld-chip-k">{t('ld_water', lang)}</span>
                    <span className="ld-chip-v"
                      style={{ color: data.waterTemp > 105 ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {data.waterTemp}°C
                    </span>
                  </div>
                )}
                {data.oilTemp != null && data.oilTemp !== 0 && (
                  <div className="ld-chip">
                    <span className="ld-chip-k">{t('ld_oil', lang)}</span>
                    <span className="ld-chip-v"
                      style={{ color: data.oilTemp > 135 ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {data.oilTemp}°C
                    </span>
                  </div>
                )}
                {data.boost != null && data.boost !== -1 && (
                  <div className="ld-chip">
                    <span className="ld-chip-k">{t('ld_boost', lang)}</span>
                    <span className="ld-chip-v">
                      {data.boost >= 0 ? '+' : ''}{data.boost?.toFixed(1)} bar
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ld-col">
            <div className="ld-times">
              <div className="ld-time-row">
                <span className="ld-time-lbl">{t('ld_last_lap', lang)}</span>
                <span className="ld-time-val ld-mono">{formatMs(data.lastLapMs)}</span>
              </div>
              <div className="ld-time-row">
                <span className="ld-time-lbl">{t('ld_best_lap', lang)}</span>
                <span className="ld-time-val ld-mono ld-gold">{formatMs(data.bestLapMs)}</span>
              </div>
              {/* Next to the lap times, because that is where the eye already
                  is when deciding whether this car is about to come in. */}
              {boxInLaps != null && (
                <div className="ld-time-row ld-box-row">
                  <span className="ld-time-lbl">{t('ld_box_in', lang)}</span>
                  <span className="ld-time-val ld-mono ld-box-val">
                    {t('ld_box_in_laps', lang, { n: boxInLaps })}
                    <span className="ld-dim"> {t('ld_box_on', lang, { lap: intel.pitLap })}</span>
                  </span>
                </div>
              )}
            </div>

            {(data.tireTemp || compound || drivers?.length) && (
              <div className="ld-tire-section">
                {(pendingConfirmation || pendingDriver) && (
                  <div className="ld-confirm-banner">
                    {pendingConfirmation && pendingDriver
                      ? t('ld_confirm_both', lang)
                      : pendingDriver
                      ? t('ld_confirm_driver', lang)
                      : t('ld_confirm_tyre', lang)}
                  </div>
                )}
                {drivers && drivers.length > 0 && (
                  <div className="ld-tire-section-header">
                    <span className="ld-section-label">{t('ld_driver', lang)}</span>
                    <div className={`ld-driver-picker${pendingDriver ? ' ld-compound-picker--pending' : ''}`}>
                      {drivers.map((d) => (
                        <button
                          key={d.id}
                          className={`ld-cp-btn${currentDriverId === d.id ? ' active' : ''}`}
                          onClick={() => onDriverChange?.(d.id)}
                        >
                          {d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="ld-tire-section-header">
                  <span className="ld-section-label">{t('ld_tyres', lang)}</span>
                  <div className={`ld-compound-picker${pendingConfirmation ? ' ld-compound-picker--pending' : !compound ? ' ld-compound-picker--alert' : ''}`}>
                    {COMPOUND_ORDER.map(id => (
                      <button
                        key={id}
                        className={`ld-cp-btn ${COMPOUND_CLS[id]}${compound === id ? ' active' : ''}`}
                        onClick={() => onCompoundChange?.(compound === id ? null : id)}
                      >
                        {id}
                      </button>
                    ))}
                  </div>
                </div>
                <TyreAge laps={tyreLaps} life={tyreLife} outlook={setOutlook} lang={lang} />

                <div className="tw-grid">
                  <div className="tw-cell tw-fl">
                    <TireCorner temp={data.tireTemp?.[0]} pos="FL" />
                  </div>
                  <div className="tw-center"><CarTopDown /></div>
                  <div className="tw-cell tw-fr">
                    <TireCorner temp={data.tireTemp?.[1]} pos="FR" />
                  </div>
                  <div className="tw-cell tw-rl">
                    <TireCorner temp={data.tireTemp?.[2]} pos="RL" />
                  </div>
                  <div className="tw-center-gap" />
                  <div className="tw-cell tw-rr">
                    <TireCorner temp={data.tireTemp?.[3]} pos="RR" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
