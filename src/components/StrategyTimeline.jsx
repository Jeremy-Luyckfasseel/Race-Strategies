/**
 * The race, left to right, as one bar.
 *
 * This used to be a Recharts vertical stacked BarChart — one row per stint. It
 * rendered nothing: under Recharts 3 every bar rectangle came back with
 * `width: 0` because the value scale collapsed to a point, so the card was an
 * empty grid in production while the axes, grid and tooltip all still worked.
 * Recharts was in the bundle for this one chart.
 *
 * A stint plan is ten rectangles on a lap axis, so it is drawn directly here.
 * One continuous bar also reads the way an engineer thinks about the race
 * ("where am I in it") instead of ten disconnected rows, and it costs ~90px of
 * height rather than ~570px.
 *
 * Positions are percentages of the race length, so it is fluid with no
 * measurement, no ResizeObserver and no animation frame — which also means the
 * jsdom UI harness can assert on it.
 */

import { useState } from "react";
import { DEFAULT_LANG, t, compoundName } from "../i18n/strings";

const COMPOUND_IDS = ["H", "M", "S", "IM", "W"];

/** A segment narrower than this has no room for its label. */
const LABEL_MIN_PCT = 7;

function pct(n, total) {
  return total > 0 ? (n / total) * 100 : 0;
}

/**
 * Drop a pit label that would collide with the one before it. The marks stay —
 * only the number is hidden, so a busy race still shows every stop.
 */
function filterPitLabels(pitLaps, totalLaps) {
  const minGap = Math.max(1, totalLaps * 0.04);
  const result = [];
  let lastShown = -Infinity;
  for (const lap of pitLaps) {
    const show = lap - lastShown >= minGap;
    result.push({ lap, showLabel: show });
    if (show) lastShown = lap;
  }
  return result;
}

/**
 * Just the ends. The pit row above already labels every stop, and a second
 * row of interior numbers underneath it read as noise rather than a scale.
 */
function rulerTicks(totalLaps) {
  return totalLaps > 0 ? [...new Set([0, totalLaps])] : [];
}

function Tooltip({ stint, lang }) {
  return (
    <div className="timeline-tooltip tl-tooltip" role="tooltip">
      <div className="tt-title">
        {t("tl_stint", lang, { n: stint.stintNum })} — {compoundName(stint.compound, lang) || stint.compoundName}
      </div>
      <div>{t("tl_laps_range", lang, { from: stint.startLap, to: stint.endLap, n: stint.lapsInStint })}</div>
      {stint.fuelToAddLiters > 0 && <div>{t("tl_fuel_added", lang, { n: stint.fuelToAddLiters.toFixed(1) })}</div>}
      {stint.tiresChanged && <div>{t("tl_tyres_changed", lang)}</div>}
      {stint.pitStopTimeSecs > 0 && <div>{t("tl_pit_time", lang, { n: stint.pitStopTimeSecs.toFixed(1) })}</div>}
      {stint.pitWindowLatestLap && stint.pitWindowLatestLap > stint.endLap && (
        <div>{t("tl_window", lang, { lap: stint.pitWindowLatestLap })}</div>
      )}
      {stint.warning && (
        <div className="tt-warning">{stint.warningCode ? t(stint.warningCode, lang) : stint.warning}</div>
      )}
    </div>
  );
}

export default function StrategyTimeline({ stints, totalLaps, lang = DEFAULT_LANG }) {
  const [openIdx, setOpenIdx] = useState(null);

  if (!stints || stints.length === 0 || !(totalLaps > 0)) return null;

  const pitLabels = filterPitLabels(
    stints.filter((s) => s.pitLap !== null).map((s) => s.pitLap),
    totalLaps,
  );
  const usedCompounds = new Set(stints.map((s) => s.compound));
  const open = openIdx != null ? stints[openIdx] : null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("tl_title", lang)}</span>
        <div className="timeline-legend">
          {COMPOUND_IDS.filter((id) => usedCompounds.has(id)).map((id) => (
            <span key={id} className="legend-item">
              <span className={`legend-swatch cmpd-fill-${id}`} />
              {compoundName(id, lang)}
            </span>
          ))}
        </div>
      </div>

      <div className="tl-wrap">
        {/* The race. One segment per stint, sized by its share of the laps. */}
        <div className="tl-track" role="list" aria-label={t("tl_title", lang)}>
          {/* Pit windows sit under the segments: the slack after a stint ends. */}
          {stints
            .filter((s) => s.pitLap !== null && s.pitWindowLatestLap && s.pitWindowLatestLap > s.endLap)
            .map((s) => (
              <div
                key={`win-${s.stintNum}`}
                className="tl-window"
                style={{
                  left: `${pct(s.endLap, totalLaps)}%`,
                  width: `${pct(Math.min(s.pitWindowLatestLap, totalLaps) - s.endLap, totalLaps)}%`,
                }}
              />
            ))}

          {stints.map((s, i) => {
            const widthPct = pct(s.lapsInStint, totalLaps);
            return (
              <div
                key={s.stintNum}
                role="listitem"
                tabIndex={0}
                className={`tl-seg cmpd-fill-${s.compound}${s.warning ? " tl-seg-warn" : ""}${openIdx === i ? " tl-seg-open" : ""}`}
                style={{ left: `${pct(s.startLap - 1, totalLaps)}%`, width: `${widthPct}%` }}
                aria-label={t("tl_stint", lang, { n: s.stintNum }) + " — " + (compoundName(s.compound, lang) || s.compound)}
                onMouseEnter={() => setOpenIdx(i)}
                onMouseLeave={() => setOpenIdx((cur) => (cur === i ? null : cur))}
                onFocus={() => setOpenIdx(i)}
                onBlur={() => setOpenIdx((cur) => (cur === i ? null : cur))}
              >
                {widthPct >= LABEL_MIN_PCT && (
                  <span className="tl-seg-label">
                    <span className="tl-seg-num">S{s.stintNum}</span>
                    <span className="tl-seg-laps">{s.lapsInStint}</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Pit stops, on their own line so they never sit on top of a stint. */}
        <div className="tl-pits">
          {pitLabels.map(({ lap, showLabel }) => (
            <span key={lap} className="tl-pit" style={{ left: `${pct(lap, totalLaps)}%` }}>
              <span className="tl-pit-tick" />
              {showLabel && <span className="tl-pit-lap">{lap}</span>}
            </span>
          ))}
        </div>

        {/* Lap ruler. */}
        <div className="tl-ruler">
          {rulerTicks(totalLaps).map((lap) => (
            <span key={lap} className="tl-tick" style={{ left: `${pct(lap, totalLaps)}%` }}>
              {lap}
            </span>
          ))}
        </div>

        {open && (
          <div
            className="tl-tooltip-anchor"
            style={{ left: `${Math.min(88, Math.max(0, pct(open.startLap - 1, totalLaps)))}%` }}
          >
            <Tooltip stint={open} lang={lang} />
          </div>
        )}
      </div>

      <p className="timeline-hint">{t("tl_hint", lang)}</p>
    </div>
  );
}
