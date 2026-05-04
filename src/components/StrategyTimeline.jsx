import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, ReferenceArea,
} from "recharts";

const COMPOUND_COLORS = {
  H:  "#4A9EDE",
  M:  "#F08420",
  S:  "#E53535",
  IM: "#22CC6E",
  W:  "#14BBCE",
};

const DEFAULT_COLOR = "#666";

function getColor(id) {
  return COMPOUND_COLORS[id] || DEFAULT_COLOR;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const s = payload[0]?.payload;
  if (!s) return null;
  return (
    <div className="timeline-tooltip">
      <div className="tt-title">Stint {s.stintNum} — {s.compoundName}</div>
      <div>Laps {s.startLap}–{s.endLap}&nbsp;({s.lapsInStint} laps)</div>
      {s.fuelToAddLiters > 0 && <div>Fuel added: +{s.fuelToAddLiters.toFixed(1)} L</div>}
      {s.tiresChanged && <div>Tyres changed</div>}
      {s.pitStopTimeSecs > 0 && <div>Pit time: {s.pitStopTimeSecs.toFixed(1)} s</div>}
      {s.pitWindowLatestLap && s.pitWindowLatestLap > s.endLap && (
        <div>Window: pit by L{s.pitWindowLatestLap}</div>
      )}
      {s.warning && <div className="tt-warning">{s.warning}</div>}
    </div>
  );
}

function filterPitLabels(pitLaps) {
  if (pitLaps.length <= 1) return pitLaps.map((lap) => ({ lap, showLabel: true }));
  const result = [];
  let lastShown = -Infinity;
  for (const lap of pitLaps) {
    const show = lap - lastShown >= 5;
    result.push({ lap, showLabel: show });
    if (show) lastShown = lap;
  }
  return result;
}

export default function StrategyTimeline({ stints, totalLaps }) {
  if (!stints || stints.length === 0) return null;

  const data = stints.map((s) => ({
    ...s,
    offset: s.startLap - 1,
    width: s.lapsInStint,
    name: `S${s.stintNum}`,
  }));

  const pitLabels = filterPitLabels(
    stints.filter((s) => s.pitLap !== null).map((s) => s.pitLap)
  );

  const chartHeight = Math.max(130, stints.length * 52 + 48);
  const usedCompounds = new Set(stints.map((s) => s.compound));

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Strategy Timeline</span>
        <div className="timeline-legend">
          {Object.entries(COMPOUND_COLORS)
            .filter(([id]) => usedCompounds.has(id))
            .map(([id, color]) => (
              <span key={id} className="legend-item">
                <span className="legend-swatch" style={{ background: color }} />
                {id}
              </span>
            ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 48, bottom: 4, left: 40 }}
          barCategoryGap="30%"
        >
          <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.03)" />
          <XAxis
            type="number"
            domain={[0, totalLaps]}
            tickCount={Math.min(totalLaps, 12) + 1}
            tickFormatter={(v) => `L${v}`}
            tick={{ fill: "#555", fontSize: 9, fontFamily: "var(--font-mono, monospace)" }}
            axisLine={{ stroke: "#222" }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={34}
            tick={{ fill: "#555", fontSize: 10, fontFamily: "var(--font-mono, monospace)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.025)" }} />

          {/* Invisible offset bar to position each stint */}
          <Bar dataKey="offset" stackId="a" fill="transparent" />

          {/* Visible stint bars */}
          <Bar dataKey="width" stackId="a" name="Stint" radius={[2, 2, 2, 2]}>
            {data.map((entry) => (
              <Cell
                key={`cell-${entry.stintNum}`}
                fill={getColor(entry.compound)}
                opacity={entry.warning ? 0.4 : 0.85}
                stroke={entry.warning ? "#E53535" : "none"}
                strokeWidth={entry.warning ? 1.5 : 0}
              />
            ))}
          </Bar>

          {/* Pit stop reference lines */}
          {pitLabels.map(({ lap, showLabel }) => (
            <ReferenceLine
              key={lap}
              x={lap}
              stroke="rgba(255,255,255,0.35)"
              strokeDasharray="2 3"
              strokeWidth={1}
              label={showLabel
                ? { value: `P${lap}`, position: "top", fill: "rgba(255,255,255,0.4)", fontSize: 8, fontFamily: "monospace" }
                : undefined}
            />
          ))}

          {/* Pit window shading */}
          {stints
            .filter((s) => s.pitLap !== null && s.pitWindowLatestLap && s.pitWindowLatestLap > s.endLap)
            .map((s) => (
              <ReferenceArea
                key={`win-${s.stintNum}`}
                x1={s.endLap}
                x2={Math.min(s.pitWindowLatestLap, totalLaps)}
                fill="rgba(255,255,255,0.03)"
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="2 4"
                strokeWidth={1}
              />
            ))}
        </BarChart>
      </ResponsiveContainer>

      <p className="timeline-hint">
        Dashed lines = pit stops · Shaded area = pit window · Red outline = warning
      </p>
    </div>
  );
}
