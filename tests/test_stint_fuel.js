/**
 * How much fuel to put in for the stint about to start.
 *
 * The plan's litres figure is computed for an anonymous driver on the tyre the
 * plan assumed. At the stop you know who is getting in and what you are
 * fitting, and those two facts move the number by a stop's worth over a long
 * race.
 *
 * Run with: node tests/test_stint_fuel.js
 */

import { burnRateFor, stintFuel, FUEL_MARGIN_L } from '../src/logic/stintFuel.js';

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

const FUEL_BY_DRIVER = {
  thirsty: { litersPerLap: 3.65, confident: true },
  easy: { litersPerLap: 3.40, confident: true },
  // Two laps in — a real figure, but not one to fuel a stint from.
  rookie: { litersPerLap: 4.90, confident: false },
};

// ---------------------------------------------------------------------------

section('whose burn rate to use');
{
  const base = { fuelByDriver: FUEL_BY_DRIVER, globalLitersPerLap: 3.50, tankSize: 100, lapsPerFullTank: 28 };

  assert('a driver with their own measurement uses it',
    burnRateFor({ ...base, driverId: 'thirsty' }).litersPerLap === 3.65);
  assert('and it is reported as theirs',
    burnRateFor({ ...base, driverId: 'thirsty' }).source === 'driver');

  // Not confident is not a measurement. Fuelling a stint from two laps is how
  // a car gets brimmed for a range it never needed.
  const shaky = burnRateFor({ ...base, driverId: 'rookie' });
  assert('an unconfident driver figure is not used', shaky.litersPerLap === 3.50, String(shaky.litersPerLap));
  assert('it falls back to the car, and says so', shaky.source === 'car');

  assert('a driver nobody has measured uses the car too',
    burnRateFor({ ...base, driverId: 'nobody' }).source === 'car');

  // With nothing measured at all, the configured figure is still an answer.
  const cfg = burnRateFor({ tankSize: 100, lapsPerFullTank: 25 });
  assert('with no telemetry it uses what you configured',
    Math.abs(cfg.litersPerLap - 4) < 1e-9 && cfg.source === 'configured', JSON.stringify(cfg));

  assert('and with nothing at all it says nothing', burnRateFor({}) === null);
}

section('the litres for this stint');
{
  const r = stintFuel({ lapsInStint: 20, litersPerLap: 3.4, tankSize: 100, currentFuel: 8, fuelRateLitersPerSec: 4 });
  assert('the tank needs the laps plus a margin',
    Math.abs(r.needL - (20 * 3.4 + FUEL_MARGIN_L)) < 1e-9, String(r.needL));
  assert('and you add only what is missing',
    Math.abs(r.addL - (20 * 3.4 + FUEL_MARGIN_L - 8)) < 1e-9, String(r.addL));
  assert('with the time that fill costs',
    Math.abs(r.secs - r.addL / 4) < 1e-9, String(r.secs));
  assert('it is not capped', r.capped === false);

  // The whole point: the same stint, a thirstier driver, more fuel.
  const easy = stintFuel({ lapsInStint: 25, litersPerLap: 3.40, tankSize: 100 });
  const thirsty = stintFuel({ lapsInStint: 25, litersPerLap: 3.65, tankSize: 100 });
  assert('a thirstier driver needs more for the same stint',
    thirsty.needL > easy.needL, `${easy.needL.toFixed(1)} vs ${thirsty.needL.toFixed(1)}`);
  assert('and the difference is real, not a rounding artefact',
    thirsty.needL - easy.needL > 6, (thirsty.needL - easy.needL).toFixed(1));
}

section('a tank is a tank');
{
  // 30 laps at 3.65 is 110 L. Quoting "put in 110" into a 100 L tank is worse
  // than saying it is brimmed and still will not reach.
  const over = stintFuel({ lapsInStint: 30, litersPerLap: 3.65, tankSize: 100 });
  assert('it never quotes more than the tank holds', over.needL === 100, String(over.needL));
  assert('and says it is capped', over.capped === true);
  assert('with what a full tank actually covers for this driver',
    over.lapsCovered === Math.floor((100 - FUEL_MARGIN_L) / 3.65), String(over.lapsCovered));

  // The same stint for the easier driver fits, and is not flagged.
  const fits = stintFuel({ lapsInStint: 27, litersPerLap: 3.40, tankSize: 100 });
  assert('a stint that fits is not flagged', fits.capped === false, String(fits.needL));
}

section('it never siphons, and never guesses');
{
  const brimmed = stintFuel({ lapsInStint: 5, litersPerLap: 3.4, tankSize: 100, currentFuel: 90 });
  assert('already carrying more than the stint needs means adding nothing',
    brimmed.addL === 0, String(brimmed.addL));
  assert('but the stint still has a requirement', brimmed.needL > 0);

  assert('no lap count, no answer', stintFuel({ litersPerLap: 3.4, tankSize: 100 }) === null);
  assert('no burn rate, no answer', stintFuel({ lapsInStint: 20, tankSize: 100 }) === null);
  assert('no tank, no answer', stintFuel({ lapsInStint: 20, litersPerLap: 3.4 }) === null);
  assert('and a zero-lap stint is not a stint',
    stintFuel({ lapsInStint: 0, litersPerLap: 3.4, tankSize: 100 }) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
