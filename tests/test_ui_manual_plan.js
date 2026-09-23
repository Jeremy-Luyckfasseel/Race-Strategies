/**
 * "Your own plan" on the Strategy tab: rows typed in, run through the engine.
 *
 * Rendered with a real engine result rather than a hand-built one, so what the
 * card says (laps, the comparison, the notes) is what the engine produced for
 * the rows on screen.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_manual_plan.js
 */

import { setupDom, render, click, $, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: ManualPlan } = await import('../src/components/ManualPlan.jsx');
const { findBestStrategies } = await import('../src/logic/strategy.js');
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

const INPUTS = {
  raceDurationHours: 2, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1,
  compounds: [
    { id: 'H', tireLife: 40, startLapTime: '1:32', halfLapTime: '1:33', endLapTime: '1:34.5' },
    { id: 'M', tireLife: 25, startLapTime: '1:31', halfLapTime: '1:32', endLapTime: '1:33.5' },
    { id: 'S', tireLife: 12, startLapTime: '1:30', halfLapTime: '1:31', endLapTime: '1:33' },
    { id: 'W', tireLife: 0, startLapTime: '1:50', halfLapTime: '1:51', endLapTime: '1:52' },
  ],
  pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4, mandatoryStops: 0,
  midRaceMode: false, fuelWeightPenaltyPerLiter: 0.03,
};
const BEST = findBestStrategies(INPUTS)[0];
const runRows = (rows) => findBestStrategies({ ...INPUTS, manualPlan: rows })[0] ?? null;

// Holds the rows the way App does, re-running the engine on every edit.
function Host({ initial, racingInit = false, spy }) {
  const [rows, setRows] = React.useState(initial);
  const [racing, setRacing] = React.useState(racingInit);
  spy.rows = rows;
  spy.racing = racing;
  return React.createElement(ManualPlan, {
    rows, onRows: setRows, result: rows.length ? runRows(rows) : null, best: BEST,
    racing, onRacing: setRacing, lang: 'en',
  });
}
const view = (initial, extra = {}) => {
  const spy = {};
  const v = render(React.createElement(Host, { initial, spy, ...extra }));
  return { v, spy };
};

section('an empty plan starts with one click');
{
  const { v, spy } = view([]);
  assert('no rows, no result', $(v.container, '.mp-result') === null);
  click($(v.container, '.mp-add'));
  assert('a row appears', spy.rows.length === 1, JSON.stringify(spy.rows));
  assert('running to the flag, laps left to the engine', spy.rows[0].stints === null && spy.rows[0].laps === null,
    JSON.stringify(spy.rows[0]));
  assert('and the plan is run at once', /laps/.test(textOf($(v.container, '.mp-total'))), textOf(v.container));
  v.unmount();
}

section('adding a row ends the previous one');
{
  const { v, spy } = view([{ compoundId: 'M', stints: null, laps: null }]);
  click($(v.container, '.mp-add'));
  assert('the old last row gets a count', spy.rows[0].stints === 1, JSON.stringify(spy.rows));
  assert('the new last row runs to the flag', spy.rows[1].stints === null, JSON.stringify(spy.rows));
  v.unmount();
}

section('the engine length is one click away');
{
  const { v, spy } = view([{ compoundId: 'M', stints: null, laps: null }]);
  const chip = $(v.container, '.mp-engine');
  assert('it shows what the engine would run', chip && /engine: \d+/.test(textOf(chip)), textOf(chip));
  const n = Number(textOf(chip).match(/\d+/)[0]);
  click(chip);
  assert('clicking it types that length', spy.rows[0].laps === n, JSON.stringify(spy.rows[0]));
  assert('and the chip goes, since it is now what you typed', $(v.container, '.mp-engine') === null);
  v.unmount();
}

section('it says how the plan compares with the engine');
{
  const { v } = view([{ compoundId: 'H', stints: null, laps: 10 }]);
  const txt = textOf($(v.container, '.mp-summary'));
  assert('laps and time', /\d+ laps · /.test(txt), txt);
  assert('against the engine best', /engine’s best/.test(txt), txt);
  v.unmount();
}

section('it says when the plan and the race do not line up');
{
  const { v: short } = view([{ compoundId: 'H', stints: 1, laps: null }]);
  assert('rows that run out before the flag', /carries on to the flag/.test(textOf(short.container)),
    textOf(short.container));
  short.unmount();

  const { v: cut } = view([{ compoundId: 'M', stints: 1, laps: 40 }, { compoundId: 'H', stints: null, laps: null }]);
  assert('laps the tyre cannot do', /40 laps asked/.test(textOf(cut.container)), textOf(cut.container));
  cut.unmount();

  const { v: bad } = view([{ compoundId: 'W', stints: null, laps: null }]);
  assert('a tyre with no life set', /No tyre life set/.test(textOf(bad.container)), textOf(bad.container));
  assert('and then no race button', $(bad.container, '.mp-race') === null);
  bad.unmount();
}

section('racing it, and handing back');
{
  const { v, spy } = view([{ compoundId: 'M', stints: null, laps: null }]);
  click($(v.container, '.mp-race'));
  assert('the race button makes it the plan raced', spy.racing === true);
  assert('it says so', $(v.container, '.mp-racing-pill') !== null);
  click($(v.container, '.mp-back'));
  assert('and back hands control to the engine', spy.racing === false);
  v.unmount();

  const { v: v2, spy: s2 } = view([{ compoundId: 'M', stints: null, laps: null }], { racingInit: true });
  click($(v2.container, '.mp-remove'));
  assert('removing the last row stops racing a plan that is gone', s2.racing === false && s2.rows.length === 0);
  v2.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
