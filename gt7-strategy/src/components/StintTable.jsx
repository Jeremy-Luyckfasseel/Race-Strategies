/**
 * StintTable — renders each stint as a table row.
 */
export default function StintTable({ stints }) {
  if (!stints || stints.length === 0) return null;

  return (
    <div className="stint-table-wrapper">
      <h2 className="section-heading">Stint Plan</h2>
      <div className="table-scroll">
        <table className="stint-table">
          <thead>
            <tr>
              <th>Stint</th>
              <th>Start Lap</th>
              <th>End Lap</th>
              <th>Lap Count</th>
              <th>Pit Lap</th>
              <th>Fuel to Add (L)</th>
              <th>Tires Changed</th>
              <th>Compound</th>
            </tr>
          </thead>
          <tbody>
            {stints.map(stint => (
              <tr
                key={stint.stintNum}
                className={stint.warning ? 'row-warning' : ''}
                title={stint.warning || undefined}
              >
                <td className="stint-num">{stint.stintNum}</td>
                <td>{stint.startLap}</td>
                <td>{stint.endLap}</td>
                <td>{stint.lapsInStint}</td>
                <td>{stint.pitLap ?? <span className="finish-label">FINISH</span>}</td>
                <td>
                  {stint.pitLap !== null ? (
                    <span className={stint.fuelToAdd > 0 ? 'fuel-positive' : ''}>
                      {stint.fuelToAdd > 0 ? `+${stint.fuelToAdd.toFixed(1)}` : '—'}
                    </span>
                  ) : '—'}
                </td>
                <td>
                  <span className={`tire-badge ${stint.tiresChanged ? 'changed' : 'not-changed'}`}>
                    {stint.tiresChanged ? 'Yes' : 'No'}
                  </span>
                </td>
                <td>
                  <span className={`compound-tag compound-${stint.compound}`}>
                    {stint.compound}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="table-hint">⚠ Rows highlighted in red indicate fuel or tire warnings. Hover for details.</p>
    </div>
  );
}
