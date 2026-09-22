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
  // Softest first, and only the ones set up: IM and W are tireLife 0 here.
  assert('and the tyres, softest first',
    $$(v.container, '.ns-row')[1] &&
    $$($$(v.container, '.ns-row')[1], '.ld-cp-btn').map((b) => b.textContent.trim()).join() === 'S,M,H',
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
  const v = view({ plannedStintLaps: 25 });
  pick(v, 'Ana');
  const long = Number(litres(v).match(/([\d.]+)/)[1]);

  // A soft good for 12 laps caps the stint: fuelling for 25 on it buys nothing
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
  // 30 laps at 3.90 is 117 L into a 100 L tank. "117 L" is not an instruction;
  // saying it is brimmed and still will not reach is.
  const v = view({ plannedStintLaps: 30 });
  pick(v, 'Bo');
  pick(v, 'H');
  const txt = textOf($(v.container, '.ns-answer'));
  assert('it does not quote more than the tank holds',
    !/1[01]\d(\.\d)? L/.test(txt), txt);
  assert('it says to brim it', /brim/i.test(txt), txt);
  // In LAPS, and never as a race lap number. The lap it used to name was the
  // tank's range counted from the CURRENT lap, while the tank it describes is
  // filled at the next stop — short by however far away that stop is.
  assert('it says how far a full tank gets, in laps',
    /25 of the 30 laps/.test(txt), txt);
  assert('and never names a race lap', !/lap \d/i.test(txt), txt);
  v.unmount();
}

section('it quotes a tank target, not litres to add');
{
  // It used to net the figure against the fuel aboard right now. "Right now" is
  // up to 25 laps before the stop being described, and the car arrives near
  // empty — which is why it is stopping. Netting there read "nothing to add" a
  // lap after a stop, for a stint that would start on fumes.
  const v = view({ plannedStintLaps: 20 });
  pick(v, 'Ana');
  const n = Number(litres(v).match(/([\d.]+)/)[1]);
  assert('it is the whole stint, not the shortfall',
    Math.abs(n - (20 * 3.40 + 0.5)) < 0.05, String(n));
  assert('and it says it is a tank level', /tank to/i.test(litres(v)), litres(v));
  v.unmount();
}

section('only tyres that are set up, and only when there is a stop to fuel for');
{
  // IM and W are configured with tireLife: 0. Offering them let you pick one,
  // take the `active` class, and move nothing.
  const v = view();
  const labels = $$(v.container, '.ld-cp-btn').map((b) => b.textContent.trim());
  assert('a tyre with no life is not offered', !labels.includes('IM') && !labels.includes('W'),
    labels.join(','));
  assert('the ones that are set up still are',
    ['H', 'M', 'S'].every((id) => labels.includes(id)), labels.join(','));
  v.unmount();

  // On the final stint there is no next stop. It stayed silent — until the
  // first tyre tap, which made it quote litres for a stop that never comes.
  const last = view({ plannedStintLaps: null });
  assert('no next stop, no block', $(last.container, '.ns-block') === null);
  last.unmount();
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
