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
 * It states which burn rate it used and where that came from, because "92 L"
 * from a driver's own 41 measured laps and the same number from the figure you
 * typed in last week are not the same claim, and the difference is whether you
 * check it.
 *
 * It quotes a TANK TARGET, not litres to add. It used to net the figure against
 * the fuel aboard right now — but "right now" is up to 25 laps before the stop
 * it is describing, and the car arrives near empty, which is why it is stopping.
 * Netting there made it read "nothing to add — it already has the range" just
 * after a stop, for a stint that would start on fumes. What is actually aboard
 * when the car arrives is the engine's to know, and the plan's "add N L" line
 * already says it; this answers the question the pit menu asks.
 */

import { useState } from 'react';
import { DEFAULT_LANG, t, COMPOUND_ORDER, compoundName } from '../i18n/strings';
import { burnRateFor, stintFuel } from '../logic/stintFuel';

const COMPOUND_CLS = { H: 'cp-hard', M: 'cp-med', S: 'cp-soft', IM: 'cp-inter', W: 'cp-wet' };

export default function NextStintFuel({
  drivers, compounds, fuelByDriver, globalLitersPerLap,
  tankSize, lapsPerFullTank, plannedStintLaps, lang = DEFAULT_LANG,
}) {
  const [driverId, setDriverId] = useState(null);
  const [compoundId, setCompoundId] = useState(null);

  // Nothing to ask if there is nobody to ask about.
  if (!drivers || drivers.length === 0) return null;

  // And nothing to answer if there is no next stop. On the final stint the plan
  // gives no stint length, and without this the block stayed silent only until
  // the first tyre tap — then confidently quoted litres for a stop that will
  // never happen.
  const planned = Number(plannedStintLaps);
  if (!(planned > 0)) return null;

  // Only tyres that are actually set up. Offering all five let you pick a wet
  // with `tireLife: 0`, which took the `active` class and moved nothing — a
  // button that looks like it worked and did not.
  const active = (compounds || []).filter((c) => Number(c.tireLife) > 0);
  const comp = active.find((c) => c.id === compoundId) ?? null;

  // How long the stint has to be. The tyre caps it when one is chosen, because
  // fuelling for 30 laps on a tyre good for 18 buys nothing but weight.
  const tyreLife = Number(comp?.tireLife) || 0;
  const laps = tyreLife > 0 ? Math.min(tyreLife, planned) : planned;

  const rate = burnRateFor({
    driverId, fuelByDriver, globalLitersPerLap, tankSize, lapsPerFullTank,
  });
  // No `currentFuel`: this is the tank target, so stintFuel quotes the total.
  const fuel = rate
    ? stintFuel({ lapsInStint: laps, litersPerLap: rate.litersPerLap, tankSize })
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
          {COMPOUND_ORDER.filter((id) => active.some((c) => c.id === id)).map((id) => (
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
            /* A tank is a tank. "112 L" is not an instruction; saying it is
               brimmed and still will not reach is. Said in LAPS, not as a race
               lap number: the old wording counted the tank's range from the
               current lap, while the tank it describes is filled at the next
               stop — short by however far away that stop is. */
            <span className="ns-fuel ns-fuel--capped">
              {t('ns_brimmed', lang, { covered: fuel.lapsCovered, needed: laps })}
            </span>
          ) : (
            <span className="ns-fuel">{t('ns_fuel', lang, { n: fuel.needL.toFixed(1) })}</span>
          )}

          {/* Where the number came from. The same litres measured from 41 of
              their own laps and taken from a figure typed in last week are not
              the same claim. The car's own rate only needs the "not measured
              for THEM" caveat when there is a them — with nobody named it is
              simply the rate, and the caveat was answering a question nobody
              had asked. */}
          <span className="ns-dim">
            {t(
              rate.source === 'car' && driverId ? 'ns_source_car_driver' : `ns_source_${rate.source}`,
              lang,
              { n: rate.litersPerLap.toFixed(2) },
            )}
          </span>
        </div>
      )}
    </div>
  );
}
