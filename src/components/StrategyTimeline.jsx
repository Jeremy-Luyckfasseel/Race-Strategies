import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';

// Color map for tire compounds
const COMPOUND_COLORS = {
  H: '#5b9bd5',
  M: '#ed7d31',
  S: '#ff0000',
  IM: '#92d050',
  W: '#4ea6dc',
};

const DEFAULT_COLOR = '#aaaaaa';

function getCompoundColor(compoundId) {
  return COMPOUND_COLORS[compoundId] || DEFAULT_COLOR;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const stint = payload[0]?.payload;
  if (!stint) return null;
  return (
    <div className="timeline-tooltip">
      <div className="tt-title">Stint {stint.stintNum}</div>
      <div>Laps: {stint.startLap} – {stint.endLap}</div>
      <div>Count: {stint.lapsInStint} laps</div>
      <div>Compound: {stint.compoundName}</div>
      {stint.fuelToAddLiters > 0 && <div>Fuel added: +{stint.fuelToAddLiters.toFixed(1)} L</div>}
      {stint.tiresChanged && <div>🔄 Tires changed</div>}
      {stint.pitStopTimeSecs > 0 && <div>Pit time: {stint.pitStopTimeSecs.toFixed(1)}s</div>}
      {stint.warning && <div className="tt-warning">⚠ {stint.warning}</div>}
    </div>
  );
}

/**
 * Filter pit lap labels to avoid overlap: if two pit laps are within 5 laps
 * of each other, only show every other label.
 */
function filterPitLabels(pitLaps) {
  if (pitLaps.length <= 1) return pitLaps.map(lap => ({ lap, showLabel: true }));

  const result = [];
  let lastShown = -Infinity;

  for (let i = 0; i < pitLaps.length; i++) {
    const lap = pitLaps[i];
    const showLabel = (lap - lastShown) >= 5;
    result.push({ lap, showLabel });
    if (showLabel) lastShown = lap;
  }

  return result;
}

export default function StrategyTimeline({ stints, totalLaps }) {
  if (!stints || stints.length === 0) return null;

  // Transform stints into Recharts horizontal bar data
  const data = stints.map(s => ({
    ...s,
    offset: s.startLap - 1,
    width: s.lapsInStint,
    name: `S${s.stintNum}`,
  }));

  // Pit stop lap markers with overlap filtering
  const rawPitLaps = stints.filter(s => s.pitLap !== null).map(s => s.pitLap);
  const pitLabels = filterPitLabels(rawPitLaps);

  // Dynamic chart height for many stints
  const chartHeight = Math.max(120, stints.length * 52 + 40);

  // Filter legend to only show compounds that appear in the stints array
  const usedCompounds = new Set(stints.map(s => s.compound));

  return (
    <div className="timeline-wrapper">
      <h2 className="section-heading">Strategy Timeline</h2>
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
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 10, right: 40, bottom: 10, left: 50 }}
          barCategoryGap="30%"
        >
          <CartesianGrid horizontal={false} stroke="#333" />
          <XAxis
            type="number"
            domain={[0, totalLaps]}
            tickCount={Math.min(totalLaps, 10) + 1}
            tickFormatter={v => `L${v}`}
            tick={{ fill: '#aaa', fontSize: 11 }}
            axisLine={{ stroke: '#444' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={44}
            tick={{ fill: '#ccc', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />

          {/* Transparent offset bar to shift the visible bar right */}
          <Bar dataKey="offset" stackId="a" fill="transparent" />

          {/* Actual stint bar */}
          <Bar dataKey="width" stackId="a" name="Stint" radius={[3, 3, 3, 3]}>
            {data.map((entry) => (
              <Cell
                key={`cell-${entry.stintNum}`}
                fill={getCompoundColor(entry.compound)}
                opacity={entry.warning ? 0.5 : 1}
                stroke={entry.warning ? '#ff4444' : 'none'}
                strokeWidth={entry.warning ? 2 : 0}
              />
            ))}
          </Bar>

          {/* Pit stop markers with overlap-aware labels */}
          {pitLabels.map(({ lap, showLabel }) => (
            <ReferenceLine
              key={lap}
              x={lap}
              stroke="#FFD700"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={showLabel
                ? { value: `P${lap}`, position: 'top', fill: '#FFD700', fontSize: 9 }
                : undefined
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <p className="timeline-hint">
        Gold dashed lines = pit stops · Red outline = warning
      </p>
    </div>
  );
}
