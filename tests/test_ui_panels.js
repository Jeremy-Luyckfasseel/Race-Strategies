/**
 * The four panels on the car dashboard that nothing was rendering in a test.
 *
 * Their logic is covered — test_incident.js, test_pit_now.js,
 * test_rival_intel.js, test_tyre_history.js all pass — but the logic being
 * right is not the failure mode this project has actually had. The Recharts
 * timeline computed every bar correctly and drew none of them, which is why
 * test_ui_timeline.js exists. These four are the same shape of risk: a
 * decision the engine got right, on a panel that may or may not be showing it.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_panels.js
 */

import { setupDom, render, $, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: LiveDashboard } = await import('../src/components/LiveDashboard.jsx');
const { PIT_NOW, WAIT } = await import('../src/logic/pitNow.js');
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

const telemetry = (over = {}) => ({
  currentLap: 40, fuelLiters: 48, fuelRatio: 0.48, speedKmh: 180, gear: 4,
  rpm: 7000, rpmLimiter: 8000, rpmWarning: 7500, throttle: 200, brake: 0,
  lastLapMs: 120_000, bestLapMs: 119_000, onTrack: true, paused: false,
  racePos: 2, totalCars: 10, tireTemp: [85, 85, 87, 87], posX: 10, posZ: 10,
  ...over,
});

const dash = (props = {}) => render(React.createElement(LiveDashboard, {
  data: telemetry(), label: 'T1 · MCG', compound: 'M',
  pendingConfirmation: false, pendingDriver: false,
  onCompoundChange: () => {}, onDriverChange: () => {},
  drivers: [{ id: 'd1', name: 'Alice' }], currentDriverId: 'd1',
  lang: 'en',
  ...props,
}));

/** A fuel trace the rival-intel module will call confident. */
const fuelRecord = (over = {}) => ({
  lastFuel: 48,
  lastLap: 40,
  burns: [3.4, 3.42, 3.38, 3.41],
  tankSeen: 100,
  lastStopFuel: 62.5,
  lastStopLap: 22,
  ...over,
});

// ---------------------------------------------------------------------------

section('fuel intel');
{
  const v = dash({ fuelRecord: fuelRecord() });
  const line = $(v.container, '.ld-fuel-intel');
  assert('the panel renders once a burn rate is known', line !== null);
  assert('it leads with how far the tank goes',
    /laps/.test(textOf(line)), textOf(line));

  // The burn rate is the INPUT to that range, not a decision of its own, so it
  // is the tooltip rather than a third chip competing for the eye.
  const laps = $(v.container, '.ld-fi-laps');
  assert('the burn rate is behind it, not beside it',
    /3\.4/.test(laps.getAttribute('title') || ''), String(laps.getAttribute('title')));

  // The fuel-limited box lap used to appear here AND in the row below it.
  const all = textOf($(v.container, '.ld-data-panel'));
  const boxLaps = all.match(/lap 7\d/g) || [];
  assert('the box lap is stated once on the panel, not twice',
    boxLaps.length <= 1, JSON.stringify(boxLaps));
  v.unmount();
}

section('fuel intel says nothing rather than guessing');
{
  // Fewer clean laps than the module needs: an endless "measuring" cannot be
  // told from one that will never finish, so it says how far it has got.
  const measuring = dash({ fuelRecord: fuelRecord({ burns: [3.4], lastStopFuel: null }) });
  const line = textOf($(measuring.container, '.ld-fuel-intel'));
  assert('while measuring it says how far it has got',
    /1 of 3/.test(line), line);
  measuring.unmount();

  // Nothing arriving at all is different from measuring: it must not sit on
  // "measuring…" forever for a car that sends no usable fuel.
  const silent = dash({ fuelRecord: fuelRecord({ lastFuel: null, burns: [] }) });
  assert('with no fuel arriving it says nothing at all',
    textOf($(silent.container, '.ld-fuel-intel') || { textContent: '' }).trim() === '');
  silent.unmount();

  const none = dash({ fuelRecord: null });
  assert('and a car with no trace at all is quiet too',
    ($(none.container, '.ld-fuel-intel')?.textContent ?? '').trim() === '');
  none.unmount();
}

section('the incident panel');
{
  // Not flagged: the controls belong to my car and must not offer themselves
  // on a rival's dashboard, where there is nothing to report and nothing to
  // decide.
  const rival = dash({ incident: null, onIncident: undefined });
  assert('a rival has no incident button', $(rival.container, '.ld-inc-btn') === null);
  rival.unmount();

  const flagged = dash({
    incident: {
      lap: 38,
      lossSecs: 1.8,
      oneOffSecs: 6.2,
      nextStopLap: 52,
      compare: {
        best: PIT_NOW, tied: false, pitLaps: 247, waitLaps: 246,
        lapsDelta: 1, secsDelta: null, advantageSecs: 47,
      },
    },
    onIncident: () => {},
    onClearIncident: () => {},
    onApplyPace: () => {},
  });
  const panel = $(flagged.container, '.ld-incident');
  assert('a flagged incident renders its panel', panel !== null);
  assert('it reports what it is costing per lap', /1\.8/.test(textOf(panel)), textOf(panel));
  // The lap it happened on is costed separately as a one-off: it holds the spin
  // and the recovery, and folding it into the per-lap rate would send a car in
  // for a scrape.
  assert('and the lap it happened on, separately', /6\.2/.test(textOf(panel)), textOf(panel));
  flagged.unmount();
}

section('box now or wait');
{
  const mk = (compare) => dash({
    incident: { lap: 38, lossSecs: 1.8, oneOffSecs: 6.2, nextStopLap: 52, compare },
    onIncident: () => {}, onClearIncident: () => {}, onApplyPace: () => {},
  });

  const comeIn = mk({
    best: PIT_NOW, tied: false, pitLaps: 247, waitLaps: 246,
    lapsDelta: 1, secsDelta: null, advantageSecs: 47,
  });
  const inTxt = textOf($(comeIn.container, '.ld-incident'));
  // The margin is reported in TIME: "247 laps vs 246" is true and unreadable.
  assert('coming in reports the advantage in seconds, not laps',
    /47s/.test(inTxt) && !/\+1 laps/.test(inTxt), inTxt);
  comeIn.unmount();

  const stayOut = mk({
    best: WAIT, tied: false, pitLaps: 246, waitLaps: 246,
    lapsDelta: 0, secsDelta: -12, advantageSecs: 12,
  });
  assert('staying out is a different verdict from coming in',
    textOf($(stayOut.container, '.ld-incident')) !== inTxt);
  stayOut.unmount();

  // A sub-second difference is a dead heat, and must not be broken arbitrarily
  // into a confident-looking call.
  const tied = mk({
    best: null, tied: true, pitLaps: 246, waitLaps: 246,
    lapsDelta: 0, secsDelta: 0.4, advantageSecs: 0,
  });
  const tiedTxt = textOf($(tied.container, '.ld-incident'));
  assert('a dead heat is reported as one, with no margin claimed',
    !/0\.4s better/.test(tiedTxt), tiedTxt);
  tied.unmount();
}

section('the tyre outlook');
{
  // Silent on a first set: there is no previous set to compare against, and
  // inventing an expectation from the stint being driven would drag it down.
  const first = dash({ tyreLaps: 6, tyreLife: 30, stintEntry: null });
  assert('nothing is claimed about a first set',
    $(first.container, '.tw-outlook') === null);
  assert('but the laps on it are still counted',
    /6/.test(textOf($(first.container, '.tw-age-val'))), textOf($(first.container, '.tw-age-val')));
  first.unmount();

  // With finished sets of the same compound behind it, the outlook appears.
  const withHistory = dash({
    tyreLaps: 6,
    tyreLife: 30,
    stintEntry: {
      current: { compound: 'M', startLap: 34, lapCount: 6, lapMsSum: 726_000 },
      history: [
        { compound: 'M', startLap: 1, endLap: 9, lapCount: 8, avgLapMs: 121_000, bestLapMs: 119_500 },
        { compound: 'M', startLap: 10, endLap: 19, lapCount: 9, avgLapMs: 121_400, bestLapMs: 119_800 },
      ],
    },
  });
  const outlook = $(withHistory.container, '.tw-outlook');
  assert('with finished sets behind it, it says what they gave', outlook !== null,
    textOf($(withHistory.container, '.tw-age')));
  if (outlook) {
    assert('and how many laps that leaves on this one',
      /\d/.test(textOf(outlook)), textOf(outlook));
  }
  withHistory.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
