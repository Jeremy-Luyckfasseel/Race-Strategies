import { formatLapTime } from "../logic/strategy";

export default function StintTable({ stints }) {
  if (!stints || stints.length === 0) return null;

  const multiDriver = new Set(stints.map((s) => s.driverId).filter(Boolean)).size > 1;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Stint Plan</span>
      </div>
      <div className="table-scroll">
        <table className="stint-table" aria-label="Lap-by-stint breakdown">
          <thead>
            <tr>
              <th>#</th>
              {multiDriver && <th>Driver</th>}
              <th>Start</th>
              <th>End</th>
              <th>Laps</th>
              <th>Pit Lap</th>
              <th>Fuel Add</th>
              <th>Tyres</th>
              <th>Compound</th>
              <th>Avg Lap</th>
              <th>Pit (s)</th>
            </tr>
          </thead>
          <tbody>
            {stints.map((stint) => {
              const isLast = stint.pitLap === null;
              return (
                <tr
                  key={stint.stintNum}
                  className={stint.warning ? "row-warning" : ""}
                  title={stint.warning || undefined}
                >
                  <td className="stint-num">{stint.stintNum}</td>
                  {multiDriver && <td className="driver-cell">{stint.driverName}</td>}
                  <td>{stint.startLap}</td>
                  <td>{stint.endLap}</td>
                  <td>{stint.lapsInStint}</td>
                  <td>
                    {isLast
                      ? <span className="finish-label">Finish</span>
                      : stint.pitLap}
                  </td>
                  <td>
                    {isLast ? "—" : (
                      <span className={stint.fuelToAddLiters > 0 ? "fuel-positive" : ""}>
                        {stint.fuelToAddLiters > 0 ? `+${stint.fuelToAddLiters.toFixed(1)} L` : "—"}
                      </span>
                    )}
                  </td>
                  <td>
                    {isLast ? "—" : (
                      <span className={`tire-badge ${stint.tiresChanged ? "changed" : "not-changed"}`}>
                        {stint.tiresChanged ? "Yes" : "No"}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`compound-tag compound-${stint.compound}`}>
                      {stint.compound}
                    </span>
                  </td>
                  <td className="avg-lap-cell">
                    {stint.avgLapTimeSecs ? formatLapTime(stint.avgLapTimeSecs) : "—"}
                  </td>
                  <td className="pit-time-cell">
                    {isLast ? "—" : stint.pitStopTimeSecs.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {stints.some((s) => s.warning) && (
        <p className="field-note" style={{ marginTop: 10, textAlign: "right" }}>
          Rows highlighted in red indicate fuel or tyre warnings — hover for details.
        </p>
      )}
    </div>
  );
}
