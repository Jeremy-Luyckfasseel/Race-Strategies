import { formatLapTime } from "../logic/strategy";
import { DEFAULT_LANG, t, compoundName } from "../i18n/strings";

export default function StintTable({ stints, lang = DEFAULT_LANG }) {
  if (!stints || stints.length === 0) return null;

  const multiDriver = new Set(stints.map((s) => s.driverId).filter(Boolean)).size > 1;
  const warningOf = (s) => (s.warningCode ? t(s.warningCode, lang) : s.warning);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{t("st_title", lang)}</span>
      </div>
      <div className="table-scroll">
        <table className="stint-table" aria-label={t("aria_stint_breakdown", lang)}>
          <thead>
            <tr>
              <th>#</th>
              {multiDriver && <th>{t("st_driver", lang)}</th>}
              <th>{t("st_start", lang)}</th>
              <th>{t("st_end", lang)}</th>
              <th>{t("st_laps", lang)}</th>
              <th>{t("st_pit_lap", lang)}</th>
              <th>{t("st_fuel_added", lang)}</th>
              <th>{t("st_tyres", lang)}</th>
              <th>{t("st_compound", lang)}</th>
              <th>{t("st_avg_lap", lang)}</th>
              <th>{t("st_pit_secs", lang)}</th>
            </tr>
          </thead>
          <tbody>
            {stints.map((stint) => {
              const isLast = stint.pitLap === null;
              return (
                <tr
                  key={stint.stintNum}
                  className={stint.warning ? "row-warning" : ""}
                  title={warningOf(stint) || undefined}
                >
                  <td className="stint-num">{stint.stintNum}</td>
                  {multiDriver && <td className="driver-cell">{stint.driverName}</td>}
                  <td>{stint.startLap}</td>
                  <td>{stint.endLap}</td>
                  <td>{stint.lapsInStint}</td>
                  <td>
                    {isLast
                      ? <span className="finish-label">{t("st_finish", lang)}</span>
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
                        {stint.tiresChanged ? t("st_yes", lang) : t("st_no", lang)}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`compound-tag compound-${stint.compound}`}
                      title={compoundName(stint.compound, lang)}
                    >
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
          {t("st_note", lang)}
        </p>
      )}
    </div>
  );
}
