/**
 * What survives a dropout, and what does not.
 *
 * Three different things get called "losing the connection" and they behave
 * differently, so each is exercised separately:
 *
 *   1. the PS5 stops sending (console asleep, GT7 back at the menu, its wifi)
 *   2. the relay dies or is restarted (the browser's socket drops)
 *   3. the browser tab is reloaded (every bit of React state is gone)
 *
 * Run with: node tests/test_ui_reconnect.js
 */

import { setupDom, render, click, act, $, $$ } from './helpers/dom.js';

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
  /** Simulate the relay going away underneath us. */
  drop() { this.readyState = 3; this.onclose?.(); }
  deliver(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import('../src/App.jsx');
const { TEAM_STALE_MS } = await import('../src/logic/teams.js');
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

const IPS = ['192.168.1.50', '192.168.1.51', '192.168.1.52'];

const packet = (ip, i, over = {}) => ({
  ps5ip: ip, currentLap: 6, totalLaps: 40, racePos: i + 1, totalCars: 3,
  speedKmh: 175, gear: 4, rpm: 7000, rpmLimiter: 8000, rpmWarning: 7500,
  throttle: 200, brake: 0, fuelLiters: 44, fuelRatio: 0.44,
  lastLapMs: 120_000, bestLapMs: 119_000, onTrack: true, paused: false,
  tireWear: [95, 95, 94, 94], tireTemp: [85, 85, 87, 87],
  posX: 100 + i * 20, posZ: 40, ...over,
});

const settle = async (ms = 140) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

const tabButton = (c, label) => $$(c, '.tab-btn').find((b) => b.textContent.includes(label));

/** Mount the app WITHOUT clearing storage, so a "reload" can be simulated. */
async function mountApp() {
  const index = sockets.length;
  const view = render(React.createElement(App));
  await settle(40);
  const relay = () => sockets[index];
  const send = async (ips = IPS, over = () => ({})) => {
    await act(async () => { ips.forEach((ip, i) => relay().deliver(packet(ip, i, over(i)))); });
    await settle();
  };
  return { ...view, relay, send };
}

function freshStorage() {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('gt7-onboarded', '1');
  // A configured session: the PS5 addresses are what the app re-registers with
  // the relay after a reconnect, so a test without them is not the real case.
  globalThis.localStorage.setItem('gt7-ps5-ips', JSON.stringify(IPS));
}

section('1. the PS5 goes quiet — the relay and browser stay up');
{
  freshStorage();
  const v = await mountApp();
  await v.send();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  assert('all three cars are listed', $$(v.container, '.lb-row').length === 3);

  const colourOf = (i) => $$(v.container, '.lb-stripe')[i].style.background;
  const firstColours = [0, 1, 2].map(colourOf);

  // Only two keep talking. The third is simply absent from later packets —
  // there is no "goodbye" message; silence is the only signal.
  await v.send([IPS[0], IPS[1]]);
  assert('a silent car is still shown well inside the staleness window',
    $$(v.container, '.lb-row').length === 3, 'dropped too eagerly');
  assert(`(it is only dropped after ${TEAM_STALE_MS / 1000}s of silence)`, TEAM_STALE_MS === 20_000);

  // It comes back — no user action, the relay never stopped heartbeating it.
  await v.send();
  assert('it reappears on its own when the console resumes',
    $$(v.container, '.lb-row').length === 3);
  assert('and it still has exactly the colour it had before',
    JSON.stringify([0, 1, 2].map(colourOf)) === JSON.stringify(firstColours),
    'the field was recoloured');
  v.unmount();
}

section('2. the relay drops — the browser reconnects by itself');
{
  freshStorage();
  const v = await mountApp();
  await v.send();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  const before = sockets.length;

  assert('the app told the relay which PS5s to track',
    v.relay().sent.some((m) => m.type === 'setIPs'), JSON.stringify(v.relay().sent));

  await act(async () => { v.relay().drop(); });
  await settle(60);
  assert('the live badge goes back to offline',
    /Hors Ligne/i.test(v.container.textContent), 'still claims to be live');

  // First retry is ~1s (backoff 1s -> 2s -> 4s ... capped 15s).
  await settle(1400);
  assert('a new socket is opened without anyone clicking anything',
    sockets.length > before, `${sockets.length} vs ${before}`);

  const revived = sockets[sockets.length - 1];
  assert('and it re-registers the PS5 list on its own',
    revived.sent.some((m) => m.type === 'setIPs'), JSON.stringify(revived.sent));

  await act(async () => { IPS.forEach((ip, i) => revived.deliver(packet(ip, i))); });
  await settle();
  assert('data flows again through the new socket',
    $$(v.container, '.lb-row').length === 3, `${$$(v.container, '.lb-row').length} rows`);
  v.unmount();
}

section('3. the browser is reloaded — what comes back');
{
  freshStorage();
  const first = await mountApp();
  await first.send();
  click(tabButton(first.container, 'Course'));
  await settle(30);

  // Name a team, claim one, and set a tyre — the things worth not losing.
  click($($$(first.container, '.lb-row')[1], '.lb-mine-btn'));
  await settle(30);
  click($($$(first.container, '.lb-row')[0], '.lb-rename-btn'));
  await act(async () => {
    const input = $(first.container, '.lb-tname-input');
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Night Shift');
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await settle(30);

  click($($$(first.container, '.lb-row')[1], '.lb-tyre'));
  await settle(20);
  const medium = $$(first.container, '.lb-cp').find((b) => $(b, '.lb-cp-letter')?.textContent === 'M');
  click(medium);
  await settle(30);

  first.unmount();   // ← the reload

  const second = await mountApp();
  await second.send();
  click(tabButton(second.container, 'Course'));
  await settle(30);

  assert('my team is still marked', $$(second.container, '.lb-mine-pill').length === 1);
  assert('the team name came back',
    $$(second.container, '.lb-tname').some((n) => n.textContent.trim() === 'Night Shift'),
    JSON.stringify($$(second.container, '.lb-tname').map((n) => n.textContent.trim())));
  assert('the tyre came back',
    $$(second.container, '.lb-tyre').some((b) => b.textContent.trim() === 'M'),
    JSON.stringify($$(second.container, '.lb-tyre').map((b) => b.textContent.trim())));

  click(tabButton(second.container, 'Pilotes'));
  await settle(30);
  assert('the stint log survived the reload', $(second.container, '.stint-table') !== null);
  second.unmount();
}

section('4. a tyre cleared by a pit stop must not come back after a reload');
{
  freshStorage();
  const first = await mountApp();
  await first.send();
  click(tabButton(first.container, 'Course'));
  await settle(30);

  click($($$(first.container, '.lb-row')[0], '.lb-tyre'));
  await settle(20);
  click($$(first.container, '.lb-cp').find((b) => $(b, '.lb-cp-letter')?.textContent === 'S'));
  await settle(30);
  assert('the car is on softs',
    $$(first.container, '.lb-tyre').some((b) => b.textContent.trim() === 'S'));

  // It pits — the app clears the compound because the tyres may have changed.
  await act(async () => { first.relay().deliver(packet(IPS[0], 0, { pitDetected: true, speedKmh: 0 })); });
  await settle();
  assert('the compound is cleared on screen',
    $$(first.container, '.lb-tyre')[0].textContent.trim() === '?',
    $$(first.container, '.lb-tyre')[0].textContent.trim());

  first.unmount();   // ← reload while the car is in the pits

  const second = await mountApp();
  await second.send();
  click(tabButton(second.container, 'Course'));
  await settle(30);
  assert('and it stays cleared after a reload, rather than resurrecting the old tyre',
    $$(second.container, '.lb-tyre')[0].textContent.trim() === '?',
    $$(second.container, '.lb-tyre')[0].textContent.trim());
  second.unmount();
}

section('5. the app survives a reload with an empty race');
{
  freshStorage();
  const first = await mountApp();
  await first.send();
  first.unmount();

  const second = await mountApp();
  click(tabButton(second.container, 'Stratégie'));
  await settle(30);
  assert('the app comes back up on the strategy tab',
    $(second.container, '.tab-content') !== null);
  second.unmount();
}

section('6. the strategy setup survives a reload');
{
  freshStorage();
  const first = await mountApp();

  // Change the race length the way a person would, then let the debounced
  // write land.
  const duration = $(first.container, '#raceDuration');
  assert('the race-length field is on screen', duration !== null);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value').set;
    setter.call(duration, '3.5');
    duration.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
  await settle(600);   // past the 400 ms debounce

  const saved = globalThis.localStorage.getItem('gt7-inputs');
  assert('the setup is written to disk', saved !== null);
  assert('carrying the value that was typed',
    saved && JSON.parse(saved).raceDurationHours === 3.5, String(saved).slice(0, 80));

  first.unmount();   // ← the reload

  const second = await mountApp();
  assert('and it is still there afterwards',
    $(second.container, '#raceDuration')?.value === '3.5',
    $(second.container, '#raceDuration')?.value);
  second.unmount();
}

section('7. a corrupt saved setup falls back instead of breaking the app');
{
  freshStorage();
  globalThis.localStorage.setItem('gt7-inputs', '{ this is not json');
  const v = await mountApp();
  assert('the app still starts', $(v.container, '#raceDuration') !== null);
  assert('on the default race length',
    $(v.container, '#raceDuration')?.value === '8', $(v.container, '#raceDuration')?.value);
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
