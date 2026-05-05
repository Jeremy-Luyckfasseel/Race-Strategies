import { formatLapTime } from "../logic/strategy";

export default function StintTable({ stints }) {
  if (!stints || stints.length === 0) return null;

  const multiDriver = new Set(stints.map((s) => s.driverId).filter(Boolean)).size > 1;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Plan de Relais</span>
      </div>
      <div className="table-scroll">
        <table className="stint-table" aria-label="Lap-by-stint breakdown">
          <thead>
            <tr>
              <th>#</th>
              {multiDriver && <th>Pilote</th>}
              <th>Début</th>
              <th>Fin</th>
              <th>Tours</th>
              <th>Tour Pit</th>
              <th>Carbu. Ajouté</th>
              <th>Pneus</th>
              <th>Composé</th>
              <th>Tour Moy.</th>
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
                      ? <span className="finish-label">Arrivée</span>
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
                        {stint.tiresChanged ? "Oui" : "Non"}
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
          Les lignes en rouge indiquent des alertes carburant ou pneus — survolez pour les détails.
        </p>
      )}
    </div>
  );
}
