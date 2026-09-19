/**
 * Renders the Pilotes tab and the LiveDashboard's pit-stop confirmation for
 * real, checking the UI reflects the rules the logic enforces:
 *
 *  - a driver's total counts the stint they are in the middle of
 *  - the "minimum not met" flag tracks that total
 *  - my drivers are never offered on a rival's dashboard
 *  - the confirmation banner says which of the two answers is still wanted
 *
 * Run with: node tests/test_ui_drivers.js
 */

import { setupDom, render, click, act, $, $$, textOf } from './helpers/dom.js';

await setupDom();

const { default: DriversTab } = await import('../src/components/DriversTab.jsx');
const { default: LiveDashboard } = await import('../src/components/LiveDashboard.jsx');
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

const MY_IP = '192.168.1.30';
const DRIVERS = [
  { id: 'd1', name: 'Alice', compounds: {} },
  { id: 'd2', name: 'Bob', compounds: {} },
];

const stint = (over = {}) => ({
  driverId: 'd1', compound: 'M', startLap: 1, startTime: 0,
  lapMsSum: 0, lapCount: 0, bestLapMs: null, worstLapMs: null, ...over,
});

function logWith(history, current) {
  return new Map([[MY_IP, { history, current }]]);
}

section('no team marked yet');
{
  const v = render(React.createElement(DriversTab, {
    logs: new Map(), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: null, onReset: () => {},
  }));
  assert('the tab explains how to claim a team',
    /★/.test(v.container.textContent) && /Télémétrie/.test(v.container.textContent),
    v.container.textContent.slice(0, 140));
  assert('no stint table is drawn', $(v.container, '.stint-table') === null);
  assert('and offers no Reset, because there is nothing to reset',
    !$$(v.container, 'button').some((b) => /Réinitialiser|Reset/.test(b.textContent)));
  v.unmount();
}

section('the empty state can take you there');
{
  let went = 0;
  const v = render(React.createElement(DriversTab, {
    logs: new Map(), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: null, onReset: () => {}, onGoToTelemetry: () => { went += 1; },
  }));
  const btn = $$(v.container, 'button').find((b) => /Télémétrie/.test(b.textContent));
  assert('a button goes to the telemetry tab', !!btn, v.container.textContent.slice(0, 120));
  if (btn) {
    click(btn);
    assert('and clicking it asks the app to switch', went === 1);
  }
  v.unmount();
}

section('a completed stint');
{
  const history = [{
    ...stint(), endLap: 20, durationSecs: 1800,
    avgLapMs: 120_000, bestLapMs: 118_500, worstLapMs: 124_000, lapCount: 19, lapMsSum: 19 * 120_000,
  }];
  const v = render(React.createElement(DriversTab, {
    logs: logWith(history, null), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: MY_IP, onReset: () => {},
  }));

  const rows = $$(v.container, '.stint-table tbody tr');
  assert('the stint is listed', rows.length === 1, `${rows.length}`);
  const cells = $$(rows[0], 'td').map((c) => c.textContent.trim());
  assert('it names the driver', cells[1] === 'Alice', JSON.stringify(cells));
  assert('it shows the compound', cells[2] === 'M', JSON.stringify(cells));
  assert('it shows the lap range', cells[3] === '1–20', JSON.stringify(cells));
  assert('it shows the duration', cells[4] === '30m00s', JSON.stringify(cells));
  assert('it shows the average lap', cells[5] === '2:00.000', JSON.stringify(cells));
  assert('it shows the best lap', cells[6] === '1:58.500', JSON.stringify(cells));
  assert('it shows the worst lap', cells[7] === '2:04.000', JSON.stringify(cells));
  v.unmount();
}

section('driver totals and the minimum-drive-time flag');
{
  // Alice has done 30 min against a 1 h minimum; Bob has done nothing.
  const history = [{ ...stint(), endLap: 20, durationSecs: 1800, avgLapMs: 120_000 }];
  const v = render(React.createElement(DriversTab, {
    logs: logWith(history, null), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: MY_IP, onReset: () => {},
  }));

  const chips = $$(v.container, '.driver-chip');
  assert('one chip per driver', chips.length === 2, `${chips.length}`);
  assert('Alice\'s total is shown', textOf($(chips[0], '.driver-chip-time')) === '0h 30m',
    textOf($(chips[0], '.driver-chip-time')));
  assert('both are flagged short of the minimum',
    $$(v.container, '.driver-chip-warn').length === 2);

  // Now Alice is past the minimum and Bob still is not.
  const long = [{ ...stint(), endLap: 60, durationSecs: 4000, avgLapMs: 120_000 }];
  v.update(React.createElement(DriversTab, {
    logs: logWith(long, null), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: MY_IP, onReset: () => {},
  }));
  const after = $$(v.container, '.driver-chip');
  assert('Alice is no longer flagged', !after[0].className.includes('driver-chip-warn'));
  assert('Bob still is', after[1].className.includes('driver-chip-warn'));
  assert('only one warning remains', $$(v.container, '.driver-chip-warn').length === 1);
  v.unmount();
}

section('the stint in progress');
{
  const history = [{ ...stint(), endLap: 20, durationSecs: 1800, avgLapMs: 120_000 }];
  const current = stint({ driverId: 'd2', compound: 'S', startLap: 21, startTime: Date.now() - 600_000,
    lapCount: 5, lapMsSum: 5 * 119_000, bestLapMs: 118_000, worstLapMs: 120_000 });

  const v = render(React.createElement(DriversTab, {
    logs: logWith(history, current), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: MY_IP, onReset: () => {},
  }));

  const rows = $$(v.container, '.stint-table tbody tr');
  assert('the live stint is listed alongside the finished one', rows.length === 2, `${rows.length}`);
  assert('and is marked as running', /en cours/.test(rows[1].textContent), rows[1].textContent);
  const cells = $$(rows[1], 'td').map((c) => c.textContent.trim());
  assert('its driver is the one who took over', cells[1] === 'Bob', JSON.stringify(cells));
  assert('its lap range is open-ended', cells[3] === '21+', JSON.stringify(cells));
  assert('it already reports an average from the laps run', cells[5] === '1:59.000', JSON.stringify(cells));

  // The ticking clock has to run before the live duration can be known.
  assert('duration starts blank rather than guessing', cells[4] === '—', cells[4]);
  v.unmount();
}

section('the live stint counts toward its driver\'s total once the clock ticks');
{
  const current = stint({ driverId: 'd2', startLap: 1, startTime: Date.now() - 1_200_000 });
  const v = render(React.createElement(DriversTab, {
    logs: logWith([], current), drivers: DRIVERS, minDriverTimeSecs: 3600,
    activeIp: MY_IP, onReset: () => {},
  }));

  const before = textOf($($$(v.container, '.driver-chip')[1], '.driver-chip-time'));
  assert('Bob reads zero before the first tick', before === '0h 00m', before);

  // DriversTab refreshes on a 1 s interval; advance real timers once.
  await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });

  const after = textOf($($$(v.container, '.driver-chip')[1], '.driver-chip-time'));
  assert('after a tick his 20-minute stint is counted', after === '0h 20m', after);
  v.unmount();
}

section('resetting the log');
{
  let resets = 0;
  const v = render(React.createElement(DriversTab, {
    logs: logWith([{ ...stint(), endLap: 9, durationSecs: 600, avgLapMs: 120_000 }], null),
    drivers: DRIVERS, minDriverTimeSecs: 3600, activeIp: MY_IP,
    onReset: () => { resets += 1; },
  }));
  const btn = $$(v.container, 'button').find((b) => /Réinitialiser/.test(b.textContent));
  assert('a reset control is offered', btn != null);
  click(btn);
  assert('and it fires', resets === 1, `${resets}`);
  v.unmount();
}

// ── LiveDashboard: the pit-stop confirmation ────────────────────────────────

const telemetry = (over = {}) => ({
  currentLap: 12, totalLaps: 40, racePos: 3, totalCars: 10,
  speedKmh: 180, gear: 4, rpm: 7000, rpmLimiter: 8000, rpmWarning: 7500,
  throttle: 200, brake: 0, fuelLiters: 42, fuelRatio: 0.42,
  lastLapMs: 120_500, bestLapMs: 119_000, onTrack: true, paused: false,
  tireWear: [96, 95, 93, 92], tireTemp: [85, 86, 88, 89],
  posX: 10, posZ: 20, ...over,
});

function dash(props = {}) {
  const picks = [];
  const view = render(React.createElement(LiveDashboard, {
    data: telemetry(), label: 'T1 · Night Shift', compound: 'M',
    pendingConfirmation: false, pendingDriver: false,
    onCompoundChange: () => {}, onPitEntry: () => {},
    drivers: DRIVERS, currentDriverId: 'd1',
    onDriverChange: (id) => picks.push(id),
    ...props,
  }));
  return { ...view, picks };
}

section('the driver picker belongs to my car only');
{
  const mine = dash();
  const names = $$(mine.container, '.ld-driver-picker .ld-cp-btn').map((b) => b.textContent.trim());
  assert('my drivers are offered on my own dashboard',
    JSON.stringify(names) === JSON.stringify(['Alice', 'Bob']), JSON.stringify(names));
  assert('the current driver is shown as active',
    $(mine.container, '.ld-driver-picker .ld-cp-btn.active')?.textContent.trim() === 'Alice');
  mine.unmount();

  // App passes drivers: null when the dashboard is showing someone else's car.
  const rival = dash({ drivers: null, currentDriverId: null });
  assert('a rival\'s dashboard offers no drivers at all',
    $(rival.container, '.ld-driver-picker') === null);
  assert('but still shows their tyres', $(rival.container, '.ld-compound-picker') !== null);
  rival.unmount();
}

section('picking a driver');
{
  const v = dash({ pendingDriver: true });
  const bob = $$(v.container, '.ld-driver-picker .ld-cp-btn').find((b) => b.textContent.trim() === 'Bob');
  click(bob);
  assert('the choice is reported', JSON.stringify(v.picks) === JSON.stringify(['d2']),
    JSON.stringify(v.picks));
  v.unmount();
}

section('the tyre panel reports what GT7 actually sends');
{
  // The per-corner readout used to be a wear percentage derived from tyre
  // radius — docs flagged it unproven and track testing said it does not move.
  // It now shows temperature, which the packet really carries.
  const v = dash({ tyreLaps: 8, tyreLife: 25 });
  const corners = $$(v.container, '.tw-corner');
  assert('all four corners are shown', corners.length === 4, `${corners.length}`);

  const readouts = corners.map((c) => textOf($(c, '.tw-wear-big')));
  assert('each reports a temperature in °C',
    readouts.every((r) => /^\d+°C$/.test(r)), JSON.stringify(readouts));
  assert('the values are the ones from the packet',
    readouts[0] === '85°C' && readouts[3] === '89°C', JSON.stringify(readouts));
  assert('no corner claims a wear percentage any more',
    !readouts.some((r) => r.includes('%')), JSON.stringify(readouts));
  v.unmount();
}

section('tyre life is counted in laps, and labelled as an estimate');
{
  const v = dash({ tyreLaps: 8, tyreLife: 25 });
  const age = $(v.container, '.tw-age');
  assert('the age block is shown', age !== null);
  assert('it reads laps used against the configured life',
    /8\s*\/\s*25/.test(textOf(age)), textOf(age));
  assert('in laps, not percent', /tours/i.test(textOf(age)) && !/%/.test(textOf(age)), textOf(age));
  assert('and says plainly that it is an estimate',
    /estim/i.test(textOf(age)), textOf(age));

  const fill = $(v.container, '.tw-age-fill');
  assert('the bar is filled to the fraction used',
    fill.style.width === `${(8 / 25) * 100}%`, fill.style.width);
  v.unmount();
}

section('tyre life degrades visibly and never overflows');
{
  const fresh = dash({ tyreLaps: 1, tyreLife: 25 });
  const freshColour = $(fresh.container, '.tw-age-fill').style.background;
  fresh.unmount();

  const worn = dash({ tyreLaps: 24, tyreLife: 25 });
  const wornColour = $(worn.container, '.tw-age-fill').style.background;
  assert('a worn set is coloured differently from a fresh one', freshColour !== wornColour,
    `${freshColour} vs ${wornColour}`);
  worn.unmount();

  const over = dash({ tyreLaps: 40, tyreLife: 25 });
  assert('running past the configured life caps the bar at full',
    $(over.container, '.tw-age-fill').style.width === '100%',
    $(over.container, '.tw-age-fill').style.width);
  assert('and still reports the true lap count', /40\s*\/\s*25/.test(textOf($(over.container, '.tw-age'))));
  over.unmount();
}

section('tyre life stays quiet when it cannot be known');
{
  const noStint = dash({ tyreLaps: null, tyreLife: 25 });
  assert('nothing is claimed before a stint is open',
    $(noStint.container, '.tw-age') === null);
  noStint.unmount();

  // A compound with no configured life (IM/W default to 0) still reports the
  // laps run — that part is a fact — but draws no progress bar.
  const noLife = dash({ tyreLaps: 6, tyreLife: null });
  assert('laps on the set are still reported', /6/.test(textOf($(noLife.container, '.tw-age'))));
  assert('but no bar is drawn against an unknown life',
    $(noLife.container, '.tw-age-fill') === null);
  noLife.unmount();
}

section('the confirmation banner asks for exactly what is missing');
{
  const both = dash({ pendingConfirmation: true, pendingDriver: true });
  assert('after a stop it asks for tyre and driver together',
    /CONFIRMEZ PNEU ET PILOTE/.test(textOf($(both.container, '.ld-confirm-banner'))),
    textOf($(both.container, '.ld-confirm-banner')));
  both.unmount();

  const driverOnly = dash({ pendingConfirmation: false, pendingDriver: true });
  assert('driver alone asks who is driving',
    /QUI CONDUIT/.test(textOf($(driverOnly.container, '.ld-confirm-banner'))),
    textOf($(driverOnly.container, '.ld-confirm-banner')));
  driverOnly.unmount();

  const tyreOnly = dash({ pendingConfirmation: true, pendingDriver: false });
  assert('tyre alone asks for the compound',
    /CONFIRMEZ LE COMPOSÉ/.test(textOf($(tyreOnly.container, '.ld-confirm-banner'))),
    textOf($(tyreOnly.container, '.ld-confirm-banner')));
  tyreOnly.unmount();

  const settled = dash();
  assert('and nothing nags once both are known',
    $(settled.container, '.ld-confirm-banner') === null);
  settled.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
