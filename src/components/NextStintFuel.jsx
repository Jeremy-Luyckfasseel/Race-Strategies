/**
 * How many litres for the stint about to start.
 *
 * The plan already carries a figure per stop, but it is computed for an
 * anonymous driver on the tyre the plan assumed. At the actual stop you know
 * two things the plan did not: who is getting in, and what you are fitting.
 *
 * So this asks those two, and answers in litres. It sits in the pit group of
 * the car panel, beside the pickers that record what actually happened — the
 * same two facts, one before the stop and one after.
 *
 * It states which burn rate it used and where that came from, because "put in
 * 92 L" from a driver's own 41 measured laps and the same number from the
 * figure you typed in last week are not the same claim, and the difference is
 * whether you check it.
 */

import { useState } from 'react';
import { DEFAULT_LANG, t, COMPOUND_ORDER, compoundName } from '../i18n/strings';
import { burnRateFor, stintFuel } from '../logic/stintFuel';

const COMPOUND_CLS = { H: 'cp-hard', M: 'cp-med', S: 'cp-soft', IM: 'cp-inter', W: 'cp-wet' };

export default function NextStintFuel({
  drivers, compounds, fuelByDriver, globalLitersPerLap,
  tankSize, lapsPerFullTank, fuelRateLitersPerSec,
  currentFuel, currentLap, plannedStintLaps, lang = DEFAULT_LANG,
}) {
  const [driverId, setDriverId] = useState(null);
  const [compoundId, setCompoundId] = useState(null);

  // Nothing to ask if there is nobody to ask about.
  if (!drivers || drivers.length === 0) return null;

  const comp = compounds?.find((c) => c.id === compoundId) ?? null;

  // How long the stint has to be. The tyre caps it when one is chosen, because
  // fuelling for 30 laps on a tyre good for 18 buys nothing but weight.
  const tyreLife = Number(comp?.tireLife) || 0;
  const laps = tyreLife > 0 && plannedStintLaps > 0
    ? Math.min(tyreLife, plannedStintLaps)
    : (tyreLife > 0 ? tyreLife : plannedStintLaps);

  const rate = burnRateFor({
    driverId, fuelByDriver, globalLitersPerLap, tankSize, lapsPerFullTank,
  });
  const fuel = rate && laps > 0
    ? stintFuel({
        lapsInStint: laps,
        litersPerLap: rate.litersPerLap,
        tankSize,
        currentFuel,
        fuelRateLitersPerSec,
      })
    : null;

  return (
    <div className="ns-block">
      <span className="ld-section-label">{t('ns_title', lang)}</span>

      <div className="ns-row">
        <span className="ns-k">{t('ns_who', lang)}</span>
        <div className="ns-picks">
          {drivers.map((d) => (
            <button
              key={d.id}
              className={`ld-cp-btn${driverId === d.id ? ' active' : ''}`}
              onClick={() => setDriverId(driverId === d.id ? null : d.id)}
            >
              {d.name}
            </button>
          ))}
        </div>
      </div>

      <div className="ns-row">
        <span className="ns-k">{t('ns_tyre', lang)}</span>
        <div className="ns-picks">
          {COMPOUND_ORDER.map((id) => (
            <button
              key={id}
              className={`ld-cp-btn ${COMPOUND_CLS[id]}${compoundId === id ? ' active' : ''}`}
              title={compoundName(id, lang)}
              onClick={() => setCompoundId(compoundId === id ? null : id)}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      {fuel && (
        <div className="ns-answer">
          {fuel.capped ? (
            /* A tank is a tank. "Put in 112 L" is not an instruction; saying it
               is brimmed and still will not reach is. */
            <span className="ns-fuel ns-fuel--capped">
              {t('ns_brimmed', lang, { lap: (Number(currentLap) || 0) + fuel.lapsCovered })}
            </span>
          ) : (
            <span className="ns-fuel">{t('ns_fuel', lang, { n: fuel.addL.toFixed(1) })}</span>
          )}

          {fuel.secs != null && !fuel.capped && (
            <span className="ns-dim">{t('ns_fuel_secs', lang, { n: fuel.secs.toFixed(0) })}</span>
          )}

          {/* Where the number came from. The same litres measured from 41 of
              their own laps and taken from a figure typed in last week are not
              the same claim. */}
          <span className="ns-dim">
            {t(`ns_source_${rate.source}`, lang, { n: rate.litersPerLap.toFixed(2) })}
          </span>
        </div>
      )}
    </div>
  );
}
