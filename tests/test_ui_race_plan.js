/**
 * The plan the pit wall reads, mid-race.
 *
 * This file exists because of a bug that made the race screen useless from
 * about half distance in every race, and that nothing caught.
 *
 * Starting a race shortened `raceDurationHours` to the time remaining but left
 * mid-race mode off. The engine therefore planned the remaining four hours
 * *from lap 1, on a full tank, on fresh tyres* — a car that does not exist —
 * and numbered the stints 1..N of the remainder while every consumer compared
 * them against the car's absolute lap. `currentStint` found no match, fell
 * through to the last stint, and the Now view told the engineer "run to the
 * flag, no more stops" with a frozen zero-lap countdown, for hours.
 *
 * The assertions are therefore about what the engineer actually sees on the
 * screen with a car four hours into an eight-hour race, not about the shape of
 * an inputs object.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_race_plan.js
 */

import { setupDom, render, act, $, $$, textOf } from './helpers/dom.js';

await setupDom();

const sockets = [];
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  deliver(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
globalThis.WebSocket = FakeWebSocket;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import('../src/App.jsx');
const { RACE_START_KEY } = await import('../src/logic/raceClock.js');
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

const MY_IP = '192.168.1.50';

const packet = (over = {}) => ({
  ps5ip: MY_IP,
  currentLap: 158, totalLaps: 0, racePos: 1, totalCars: 4,
  speedKmh: 180, gear: 5, rpm: 7000, rpmLimiter: 8000, rpmWarning: 7500,
  throttle: 200, brake: 0,
  fuelLiters: 30, fuelRatio: 0.3,
  lastLapMs: 120_000, bestLapMs: 119_000,
  onTrack: true, paused: false,
  tireTemp: [85, 85, 87, 87], posX: 100, posZ: 50,
  ...over,
});

async function settle(ms = 200) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/**
 * Wait for the plan rather than for the clock.
 *
 * A flat `settle(900)` gives useStrategy's 600 ms debounce 300 ms of headroom,
 * and the search it then runs is a real one — 342 candidates over an eight-hour
 * race. Run on its own it always made it; run after the rest of the suite it
 * sometimes did not, and the failure looked exactly like the mid-race bug this
 * file exists to catch. Polling asserts the same thing without the race.
 */
async function settleUntil(ready, capMs = 8000) {
  const step = 150;
  for (let waited = 0; waited < capMs; waited += step) {
    await settle(step);
    if (ready()) return true;
  }
  return false;
}

/** An app four hours into an eight-hour race, with my car on lap 158. */
async function bootMidRace(over = {}) {
  localStorage.clear();
  localStorage.setItem('gt7-onboarded', '1');
  localStorage.setItem('gt7-lang', 'en');
  localStorage.setItem('gt7-my-team', MY_IP);
  localStorage.setItem(RACE_START_KEY, String(Date.now() - 4 * 3600 * 1000));

  const index = sockets.length;
  const view = render(React.createElement(App));
  await settle();
  const ws = sockets[index];
  await act(async () => { ws.deliver(packet(over)); });
  // The Now view has a plan when it stops saying it is waiting for one.
  await settleUntil(() => $(view.container, '.now-action-body') !== null);
  return view;
}

// ────────────────────────────────────────────────────────────────────────────

section('four hours into an eight-hour race, on lap 158');
{
  const v = await bootMidRace();
  const now = textOf($(v.container, '.now-view'));

  assert('the clock says four hours remain', /3:59:|4:00:/.test(now), now.slice(0, 120));

  // The bug: both of these were the symptom the engineer actually saw.
  assert('it does NOT claim the race is run to the flag',
    !/Run to the flag/i.test(now), now.slice(0, 240));
  const countdown = textOf($(v.container, '.now-countdown-num'));
  assert('and the stint countdown is not frozen at zero',
    countdown !== '0' && countdown !== '—', String(countdown));

  assert('a box lap is given', /Box lap/i.test(now), now.slice(0, 240));

  // The box lap has to be in the car's own coordinates, not the remainder's.
  const boxLap = Number((now.match(/Box lap (\d+)/) || [])[1]);
  assert('and it is ahead of the car, not a hundred laps behind it',
    Number.isFinite(boxLap) && boxLap > 158, String(boxLap));
  v.unmount();
}

section('the plan is built on the car that exists');
{
  // With 30 litres left the next stop must be soon. Planning from a full tank
  // — which is what mid-race mode being off produced — put it a whole stint
  // away, and that is the difference between making the finish and not.
  const v = await bootMidRace({ fuelLiters: 12, currentLap: 158 });
  const now = textOf($(v.container, '.now-view'));
  const boxLap = Number((now.match(/Box lap (\d+)/) || [])[1]);
  assert('twelve litres means a stop within a handful of laps',
    Number.isFinite(boxLap) && boxLap - 158 <= 8, `${boxLap} vs lap 158`);
  v.unmount();
}

section('before the race is started, nothing is assumed about the car');
{
  localStorage.clear();
  localStorage.setItem('gt7-onboarded', '1');
  localStorage.setItem('gt7-lang', 'en');
  localStorage.setItem('gt7-my-team', MY_IP);

  const index = sockets.length;
  const v = render(React.createElement(App));
  await settle();
  await act(async () => { sockets[index].deliver(packet()); });

  // No race started: the practice running around must not become the plan.
  const strategyTab = $$(v.container, '.tab-btn').find((b) => /Strategy|Strat/.test(b.textContent));
  await act(async () => { strategyTab.click(); });
  await settleUntil(() => $(v.container, '.kpi-value') !== null);
  const laps = parseInt(textOf($(v.container, '.kpi-value')), 10);
  assert('the plan is still the full configured race',
    Number.isFinite(laps) && laps > 200, String(laps));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
