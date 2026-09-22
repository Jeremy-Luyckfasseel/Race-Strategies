/**
 * "Who is getting in, on what, and how many litres."
 *
 * The arithmetic is covered in test_stint_fuel.js. What matters here is that
 * the two questions reach the screen, that the answer changes when you change
 * either of them, and that it says which burn rate it used — the same litres
 * measured from a driver's own laps and taken from a figure typed in last week
 * are not the same claim, and the difference is whether you check it.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_next_stint.js
 */

import { setupDom, render, click, $, $$, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: NextStintFuel } = await import('../src/components/NextStintFuel.jsx');
const React = (await import('react')).default;

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

const DRIVERS = [
  { id: 'easy', name: 'Ana' },
  { id: 'thirsty', name: 'Bo' },
];

const COMPOUNDS = [
  { id: 'H', tireLife: 40 },
  { id: 'M', tireLife: 25 },
  { id: 'S', tireLife: 12 },
  { id: 'IM', tireLife: 0 },
  { id: 'W', tireLife: 0 },
];

const FUEL_BY_DRIVER = {
  easy: { litersPerLap: 3.40, confident: true },
  thirsty: { litersPerLap: 3.90, confident: true },
};

const view = (over = {}) => render(React.createElement(NextStintFuel, {
  drivers: DRIVERS,
  compounds: COMPOUNDS,
  fuelByDriver: FUEL_BY_DRIVER,
  globalLitersPerLap: 3.60,
  tankSize: 100,
  lapsPerFullTank: 28,
  fuelRateLitersPerSec: 4,
  currentFuel: 0,
  currentLap: 40,
  plannedStintLaps: 20,
  lang: 'en',
  ...over,
}));

const pick = (v, label) => {
  const b = $$(v.container, '.ld-cp-btn').find((x) => x.textContent.trim() === label);
  if (!b) throw new Error('no button: ' + label);
  click(b);
};

const litres = (v) => {
  const n = $(v.container, '.ns-fuel');
  return n ? textOf(n) : null;
};

// ---------------------------------------------------------------------------

section('it asks the two things the plan did not know');
{
  const v = view();
  const txt = textOf($(v.container, '.ns-block'));
  assert('the block is there', $(v.container, '.ns-block') !== null);
  assert('it offers the drivers', /Ana/.test(txt) && /Bo/.test(txt), txt);
  assert('and the tyres, softest first',
    $$(v.container, '.ns-row')[1] &&
    $$($$(v.container, '.ns-row')[1], '.ld-cp-btn').map((b) => b.textContent.trim()).join() === 'S,M,H,IM,W',
    $$($$(v.container, '.ns-row')[1], '.ld-cp-btn').map((b) => b.textContent.trim()).join());
  v.unmount();
}

section('the answer follows who is getting in');
{
  // With nobody named it still answers, on the car's own measured burn — that
  // is more useful than a blank, and it says which it used.
  const v = view();
  const anon = litres(v);
  assert('it answers before anyone is named', anon !== null, String(anon));
  assert('and says the number came from the car',
    /car/i.test(textOf($(v.container, '.ns-answer'))), textOf($(v.container, '.ns-answer')));

  pick(v, 'Ana');
  const ana = litres(v);
  assert('naming the easy driver changes the litres', ana !== anon, `${anon} → ${ana}`);
  assert('and now says the number is theirs',
    /their own/i.test(textOf($(v.container, '.ns-answer'))), textOf($(v.container, '.ns-answer')));

  pick(v, 'Bo');
  const bo = litres(v);
  const n = (x) => Number((x || '').match(/([\d.]+)/)?.[1]);
  assert('the thirstier driver needs more for the same stint',
    n(bo) > n(ana), `${ana} vs ${bo}`);
  // 20 laps at 3.90 vs 3.40 is ten litres. Not a rounding artefact.
  assert('and it is a real difference, not a rounding artefact',
    n(bo) - n(ana) > 8, String(n(bo) - n(ana)));
  v.unmount();
}

section('the answer follows the tyre');
{
  const v = view({ plannedStintLaps: 30 });
  pick(v, 'Ana');
  const long = Number(litres(v).match(/([\d.]+)/)[1]);

  // A soft good for 12 laps caps the stint: fuelling for 30 on it buys nothing
  // but weight the car carries and never burns.
  pick(v, 'S');
  const short = Number(litres(v).match(/([\d.]+)/)[1]);
  assert('a short-lived tyre caps the fuel', short < long, `${long} → ${short}`);
  assert('to roughly what that tyre can do',
    Math.abs(short - (12 * 3.40 + 0.5)) < 0.1, String(short));
  v.unmount();
}

section('a tank is a tank');
{
  // 30 laps at 3.90 is 117 L into a 100 L tank. "Put in 117" is not an
  // instruction; saying it is brimmed and still will not reach is.
  const v = view({ plannedStintLaps: 30, currentLap: 40 });
  pick(v, 'Bo');
  pick(v, 'H');
  const txt = textOf($(v.container, '.ns-answer'));
  assert('it does not quote more than the tank holds',
    !/1[01]\d(\.\d)? L/.test(txt), txt);
  assert('it says to brim it', /brim/i.test(txt), txt);
  assert('and names the lap a full tank actually reaches',
    /lap \d+/.test(txt), txt);
  v.unmount();
}

section('it only subtracts fuel that is really aboard');
{
  const v = view({ currentFuel: 40 });
  pick(v, 'Ana');
  const withFuel = Number(litres(v).match(/([\d.]+)/)[1]);
  v.unmount();

  const empty = view({ currentFuel: 0 });
  pick(empty, 'Ana');
  const fromEmpty = Number(litres(empty).match(/([\d.]+)/)[1]);
  assert('what is already aboard is not poured in again',
    Math.abs(fromEmpty - withFuel - 40) < 0.05, `${fromEmpty} vs ${withFuel}`);
  empty.unmount();
}

section('it says nothing rather than guessing');
{
  const noDrivers = view({ drivers: [] });
  assert('no roster, no block', $(noDrivers.container, '.ns-block') === null);
  noDrivers.unmount();

  // Nothing measured at all still answers, from what was configured — and
  // labels it as such, so it is obvious the number has never been checked.
  const cold = view({ fuelByDriver: undefined, globalLitersPerLap: undefined });
  assert('with no telemetry it falls back to your setup', litres(cold) !== null);
  assert('and says so plainly',
    /configured/i.test(textOf($(cold.container, '.ns-answer'))),
    textOf($(cold.container, '.ns-answer')));
  cold.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
