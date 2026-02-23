/**
 * StintTable — renders each stint as a table row.
 * Last stint (pitLap === null) shows FINISH label and dashes for pit-related columns.
 * Rows with warnings get red highlighting.
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
              <th>Pit Time (s)</th>
            </tr>
          </thead>
          <tbody>
            {stints.map(stint => {
              const isLast = stint.pitLap === null;
              return (
                <tr
                  key={stint.stintNum}
                  className={stint.warning ? 'row-warning' : ''}
                  title={stint.warning || undefined}
                >
                  <td className="stint-num">{stint.stintNum}</td>
                  <td>{stint.startLap}</td>
                  <td>{stint.endLap}</td>
                  <td>{stint.lapsInStint}</td>
                  <td>{isLast ? <span className="finish-label">FINISH</span> : stint.pitLap}</td>
                  <td>
                    {isLast ? '—' : (
                      <span className={stint.fuelToAddLiters > 0 ? 'fuel-positive' : ''}>
                        {stint.fuelToAddLiters > 0 ? `+${stint.fuelToAddLiters.toFixed(1)}` : '—'}
                      </span>
                    )}
                  </td>
                  <td>
                    {isLast ? '—' : (
                      <span className={`tire-badge ${stint.tiresChanged ? 'changed' : 'not-changed'}`}>
                        {stint.tiresChanged ? 'Yes' : 'No'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`compound-tag compound-${stint.compound}`}>
                      {stint.compound}
                    </span>
                  </td>
                  <td>
                    {isLast ? '—' : (
                      <span>{stint.pitStopTimeSecs.toFixed(1)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-hint">⚠ Rows highlighted in red indicate fuel or tire warnings. Hover for details.</p>
    </div>
  );
}
