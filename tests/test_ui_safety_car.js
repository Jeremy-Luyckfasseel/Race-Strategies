/**
 * The safety car, on screen.
 *
 * The logic is covered in test_car_roles.js. What matters here is that the
 * board actually reflects it: the safety car out of the standings, the cars
 * behind it renumbered without a hole, its own row pinned below the field, and
 * the state of it — parked or deployed — readable at a glance.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_safety_car.js
 */

import { setupDom, render, click, $, $$, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: TelemetryLeaderboard } = await import('../src/components/TelemetryLeaderboard.jsx');
const { ROLE_SAFETY } = await import('../src/logic/carRoles.js');
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

const SC = '10.0.0.9';

const car = (racePos, over = {}) => ({
  racePos, currentLap: 20, onTrack: true, speedKmh: 180,
  lastLapMs: 90_500, bestLapMs: 90_000, fuelLiters: 50, fuelRatio: 0.5, ...over,
});

/** Four cars; the safety car is third on GT7's own numbering. */
const FIELD = new Map([
  ['10.0.0.1', car(1)],
  ['10.0.0.2', car(2)],
  [SC, car(3, { onTrack: false, speedKmh: 0, currentLap: 1 })],
  ['10.0.0.4', car(4)],
]);

function board(roles, teams = FIELD, onRoleChange = () => {}) {
  return render(React.createElement(TelemetryLeaderboard, {
    teams,
    teamOrder: [...teams.keys()],
    teamLabels: {},
    teamCompounds: {},
    pendingIps: new Set(),
    selectedIp: '',
    lapCrossings: new Map(),
    fuelUse: new Map(),
    carRoles: roles,
    onRoleChange,
    lang: 'en',
  }));
}

const positions = (root) => $$(root, '.lb-row:not(.lb-row-sc) .lb-pos').map(textOf);

// ────────────────────────────────────────────────────────────────────────────

section('with nothing marked, every car races');
{
  const v = board({});
  assert('four rows in the standings', $$(v.container, '.lb-row:not(.lb-row-sc)').length === 4);
  assert('no safety-car row', $(v.container, '.lb-row-sc') === null);
  assert('numbered one to four', positions(v.container).join(',') === '1,2,3,4',
    positions(v.container).join(','));
  v.unmount();
}

section('marked as the safety car');
{
  const v = board({ [SC]: ROLE_SAFETY });

  assert('it leaves the standings', $$(v.container, '.lb-row:not(.lb-row-sc)').length === 3);
  assert('and gets its own row below the field', $$(v.container, '.lb-row-sc').length === 1);

  // GT7 called them 1, 2, 4 with the safety car third. Without renumbering the
  // board would show a gap where it used to be.
  assert('the cars behind it close up rather than leaving a hole',
    positions(v.container).join(',') === '1,2,3', positions(v.container).join(','));

  assert('its row is badged', textOf($(v.container, '.lb-sc-badge')) === 'SC');
  assert('and says it is parked', /IN PITS/.test(textOf($(v.container, '.lb-sc-state'))),
    textOf($(v.container, '.lb-sc-state')));
  assert('without being counted as deployed',
    !$(v.container, '.lb-row-sc').className.includes('is-deployed'));
  v.unmount();
}

section('deployed');
{
  const out = new Map(FIELD);
  out.set(SC, car(3, { onTrack: true, speedKmh: 90 }));
  const v = board({ [SC]: ROLE_SAFETY }, out);

  assert('the row says so', /DEPLOYED/.test(textOf($(v.container, '.lb-sc-state'))),
    textOf($(v.container, '.lb-sc-state')));
  assert('and is marked out visually',
    $(v.container, '.lb-row-sc').className.includes('is-deployed'));
  assert('it still takes no position', positions(v.container).join(',') === '1,2,3');
  v.unmount();
}

section('marking and unmarking from the row');
{
  let roles = {};
  const v = board(roles, FIELD, (next) => { roles = next; });

  // Open the row's panel, then mark it.
  click($$(v.container, '.lb-row .lb-tyre')[2]);
  const scButton = $$(v.container, '.lb-role-btn').find((b) => /Safety car/.test(b.textContent));
  assert('the panel offers the role', !!scButton);
  click(scButton);
  assert('marking it reports the new roles', roles[SC] === ROLE_SAFETY, JSON.stringify(roles));

  v.update(React.createElement(TelemetryLeaderboard, {
    teams: FIELD, teamOrder: [...FIELD.keys()], teamLabels: {}, teamCompounds: {},
    pendingIps: new Set(), selectedIp: '', lapCrossings: new Map(), fuelUse: new Map(),
    carRoles: roles, onRoleChange: (next) => { roles = next; }, lang: 'en',
  }));
  assert('and it moves out of the field', $$(v.container, '.lb-row:not(.lb-row-sc)').length === 3);

  click($(v.container, '.lb-role-clear'));
  assert('clearing it puts it back in the race', roles[SC] === undefined, JSON.stringify(roles));
  v.unmount();
}

section('a safety car nobody marked changes nothing');
{
  const v = board({ '10.0.0.99': ROLE_SAFETY });
  assert('a role for a car that is not here is harmless',
    $$(v.container, '.lb-row:not(.lb-row-sc)').length === 4);
  assert('and draws no empty row', $(v.container, '.lb-row-sc') === null);
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
