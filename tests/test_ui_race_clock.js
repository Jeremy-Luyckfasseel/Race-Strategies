/**
 * Starting the race, from the UI.
 *
 * The lobby is open for hours before the race and all of that driving is
 * practice. What matters here is the boundary: before it is pressed nothing is
 * race data and the plan runs on the configured length; after it, the clock
 * drives the plan and everything describing the previous session is cleared —
 * while the circuit, the names, the roster and the setup survive.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_race_clock.js
 */

import { setupDom, render, click, act, $, $$, textOf } from './helpers/dom.js';

await setupDom();

globalThis.WebSocket = class {
  constructor() { this.readyState = 0; }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import('../src/App.jsx');
const { RACE_START_KEY } = await import('../src/logic/raceClock.js');
const { RACE_KEYS, SNAPSHOT_KEYS } = await import('../src/logic/racePersistence.js');
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

const startButton = (root) =>
  $$(root, 'button').find((b) => /Start race|D\u00e9marrer la course/.test(b.textContent));

function boot() {
  localStorage.setItem('gt7-onboarded', '1');
  return render(React.createElement(App));
}

/**
 * Confirmations are the app's own card now, not window.confirm, so they are
 * answered the way a person answers them: by clicking a button that is really
 * in the DOM. That also means the assertions below exercise the real path
 * rather than a stub that always said yes.
 */
const dialogCard = (root) => $(root, '.dlg-card');
const dialogText = (root) => (dialogCard(root) ? textOf(dialogCard(root)) : null);

async function answer(root, yes) {
  const card = dialogCard(root);
  if (!card) return false;
  click($(card, yes ? '.dlg-btn--go' : '.dlg-btn--cancel'));
  // The handler behind it is async (it awaits the dialog's promise).
  await act(async () => { await Promise.resolve(); });
  return true;
}

// ────────────────────────────────────────────────────────────────────────────

section('the start stamp is race data');
{
  assert('it is cleared when a new race is started', RACE_KEYS.includes(RACE_START_KEY));
  assert('and it travels in an exported snapshot', SNAPSHOT_KEYS.includes(RACE_START_KEY));
}

section('before the race is started');
{
  localStorage.clear();
  const v = boot();
  assert('the race view offers to start it', !!startButton(v.container));
  assert('and shows no clock', $(v.container, '.now-clock') === null);
  assert('nothing is stored', localStorage.getItem(RACE_START_KEY) === null);
  v.unmount();
}

section('starting it');
{
  localStorage.clear();
  localStorage.setItem('gt7-team-compounds', JSON.stringify({ '10.0.0.1': 'S' }));

  const v = boot();
  click(startButton(v.container));

  assert('it asks first, because it resets the stint log',
    dialogCard(v.container) !== null);
  assert('on the app\'s own card, not the browser\'s grey box',
    /Start the race|D\u00e9marrer la course/.test(dialogText(v.container)),
    dialogText(v.container));
  assert('and it says what the start will reset',
    /stint log|relais/i.test(dialogText(v.container)), dialogText(v.container));

  await answer(v.container, true);
  assert('the card goes once it is answered', dialogCard(v.container) === null);
  const stamp = Number(localStorage.getItem(RACE_START_KEY));
  assert('the start time is stored', Number.isFinite(stamp) && stamp > 0, String(stamp));
  assert('the clock replaces the start button', $(v.container, '.now-clock') !== null);
  assert('and the button is gone', !startButton(v.container));
  assert('the tyres every car was on in practice are cleared',
    localStorage.getItem('gt7-team-compounds') === '{}',
    localStorage.getItem('gt7-team-compounds'));

  const text = textOf($(v.container, '.now-clock'));
  assert('the clock shows a remaining time', /\d:\d\d:\d\d/.test(text), text);
  v.unmount();
}

section('declining leaves everything alone');
{
  localStorage.clear();
  const v = boot();
  click(startButton(v.container));
  await answer(v.container, false);
  assert('no race was started', localStorage.getItem(RACE_START_KEY) === null);
  assert('and the button is still there', !!startButton(v.container));
  v.unmount();
}

section('the card can be dismissed without touching a button');
{
  // Escape is what anyone reaches for, and it must mean no.
  localStorage.clear();
  const v = boot();
  click(startButton(v.container));
  assert('the card is up', dialogCard(v.container) !== null);

  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert('Escape closes it', dialogCard(v.container) === null);
  assert('and starts nothing', localStorage.getItem(RACE_START_KEY) === null);
  v.unmount();
}

section('the clock survives a reload');
{
  localStorage.clear();
  const first = boot();
  click(startButton(first.container));
  await answer(first.container, true);
  const stamp = localStorage.getItem(RACE_START_KEY);
  first.unmount();

  const second = boot();
  assert('it comes back running', $(second.container, '.now-clock') !== null);
  assert('from the same start time', localStorage.getItem(RACE_START_KEY) === stamp);
  second.unmount();
}

section('the clock counts down, and drives the plan');
{
  localStorage.clear();
  // An 8 h race that started 2 h ago: 6 h left, which is what the engine runs on.
  const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
  localStorage.setItem(RACE_START_KEY, String(twoHoursAgo));
  const v = boot();

  const clock = $(v.container, '.now-clock');
  assert('the clock is running', clock !== null);
  const text = textOf(clock);
  assert('remaining has counted down from eight hours', /5:59:|6:00:/.test(text), text);
  assert('and elapsed has counted up to two', /1:59:|2:00:/.test(text), text);

  // The strategy is built from the six hours left, not the eight configured.
  // The KPI strip lives on the Strategy tab, which is not the landing tab.
  await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
  click($$(v.container, '.tab-btn').find((b) => /Strategy|Stratégie/.test(b.textContent)));
  // The KPI value carries its unit in a nested span ("238laps").
  const laps = parseInt(textOf($(v.container, '.kpi-value')), 10);
  assert('a plan exists', Number.isFinite(laps) && laps > 0, String(laps));

  // An 8 h race at these defaults plans 238 laps; six hours is about a quarter
  // less. The point is that the clock, not the input field, set the length.
  assert('and it is sized to the six hours left, not the eight configured',
    laps > 150 && laps < 200, `${laps} laps`);
  v.unmount();
}

section('the Strategy tab says why its total is not the one you typed');
{
  // The tab read "6:57:42" for an 8 h race and looked broken. It was right —
  // the clock had been running an hour — but nothing said so, and a total
  // that does not match your input is a bug until something explains it.
  localStorage.clear();
  const v = boot();
  click($$(v.container, '.tab-btn').find((b) => /Strategy|Stratégie/.test(b.textContent)));
  assert('nothing to explain before the race is started',
    $(v.container, '.clock-banner') === null);

  click($$(v.container, '.tab-btn').find((b) => /Race|Course/.test(b.textContent)));
  click(startButton(v.container));
  await answer(v.container, true);
  click($$(v.container, '.tab-btn').find((b) => /Strategy|Stratégie/.test(b.textContent)));

  const banner = $(v.container, '.clock-banner');
  assert('once it is running the tab says the plan is for the remainder', banner !== null);
  assert('and names both the time left and the race you configured',
    /8h/.test(textOf($(v.container, '.clock-banner-time'))),
    textOf($(v.container, '.clock-banner-time')));

  // The way out is on the banner itself, not back on another tab.
  click($(v.container, '.clock-banner-clear'));
  await answer(v.container, true);
  assert('clearing the start from here removes the banner',
    $(v.container, '.clock-banner') === null);
  assert('and the stamp with it', localStorage.getItem(RACE_START_KEY) === null);
  v.unmount();
}

section('clearing the start');
{
  localStorage.clear();
  const v = boot();
  click(startButton(v.container));
  await answer(v.container, true);
  assert('running', $(v.container, '.now-clock') !== null);

  click($(v.container, '.now-clock-clear'));
  await answer(v.container, true);
  assert('the clock is gone', $(v.container, '.now-clock') === null);
  assert('the stamp is gone', localStorage.getItem(RACE_START_KEY) === null);
  assert('and it offers to start again', !!startButton(v.container));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
