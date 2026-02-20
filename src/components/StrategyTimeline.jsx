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
  RH:  '#5b9bd5',
  RM:  '#ed7d31',
  RS:  '#ff0000',
  RSS: '#c00000',
  IM:  '#92d050',
  WW:  '#4ea6dc',
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
      {stint.fuelToAdd > 0 && <div>Fuel added: +{stint.fuelToAdd.toFixed(1)} L</div>}
      {stint.tiresChanged && <div>🔄 Tires changed</div>}
      {stint.warning && <div className="tt-warning">⚠ {stint.warning}</div>}
    </div>
  );
}

export default function StrategyTimeline({ stints, totalLaps }) {
  if (!stints || stints.length === 0) return null;

  // Transform stints into Recharts horizontal bar data
  // Each stint: { stintNum, start, width, ... }
  const data = stints.map(s => ({
    ...s,
    // recharts stacked: offset = startLap - 1, width = lapsInStint
    offset: s.startLap - 1,
    width: s.lapsInStint,
    name: `S${s.stintNum}`,
  }));

  // Pit stop lap markers
  const pitLaps = stints.filter(s => s.pitLap !== null).map(s => s.pitLap);

  return (
    <div className="timeline-wrapper">
      <h2 className="section-heading">Strategy Timeline</h2>
      <div className="timeline-legend">
        {Object.entries(COMPOUND_COLORS).map(([id, color]) => (
          <span key={id} className="legend-item">
            <span className="legend-swatch" style={{ background: color }} />
            {id}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={Math.max(120, stints.length * 52 + 40)}>
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

          {/* Pit stop markers */}
          {pitLaps.map(lap => (
            <ReferenceLine
              key={lap}
              x={lap}
              stroke="#FFD700"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{ value: `P${lap}`, position: 'top', fill: '#FFD700', fontSize: 9 }}
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
