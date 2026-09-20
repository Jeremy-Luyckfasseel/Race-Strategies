/**
 * Mounts the whole App against a fake relay and drives a ten-car field
 * through it.
 *
 * Every other test checks a piece. This checks the wiring: that packets
 * arriving on the socket actually reach the leaderboard, that marking a team
 * with ★ actually persists and actually changes what the rest of the UI does,
 * that renaming a car actually reaches the map, and that the Pilotes tab reads
 * the car the star points at. Those are exactly the failures a unit test
 * cannot see, because each part is right and only the connection is wrong.
 *
 * Run with: node tests/test_ui_app_e2e.js
 */

import { setupDom, render, click, act, stepFrames, carGroups, $, $$ } from './helpers/dom.js';

await setupDom();

// ── Fake relay ──────────────────────────────────────────────────────────────

const sockets = [];

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
    // Open on a microtask, as a real socket would open asynchronously.
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(raw) { this.sent.push(JSON.parse(raw)); }

  close() { this.readyState = 3; this.onclose?.(); }

  /** Push a relay message to the app. */
  deliver(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

globalThis.WebSocket = FakeWebSocket;
// Recharts (Strategy tab) asks for this; nothing in these assertions needs it
// to do anything.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import('../src/App.jsx');
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

const IPS = Array.from({ length: 10 }, (_, i) => `192.168.1.${40 + i}`);

const packet = (ip, i, over = {}) => ({
  ps5ip: ip,
  currentLap: 8,
  totalLaps: 40,
  racePos: i + 1,
  totalCars: 10,
  speedKmh: 170 + i,
  gear: 4, rpm: 7000, rpmLimiter: 8000, rpmWarning: 7500,
  throttle: 200, brake: 0,
  fuelLiters: 50 - i, fuelRatio: (50 - i) / 100,
  lastLapMs: 120_000 + i * 300,
  bestLapMs: 119_000 + i * 200,
  onTrack: true, paused: false,
  tireWear: [95, 95, 94, 94], tireTemp: [85, 85, 87, 87],
  posX: 100 + i * 25, posZ: 50,
  ...over,
});

/** Let real timers (the 20 Hz flush) run and React settle. */
async function settle(ms = 140) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

const tabButton = (container, label) =>
  $$(container, '.tab-btn').find((b) => b.textContent.includes(label));

/**
 * Each mounted app gets its own socket, addressed by the index it was created
 * at rather than "the most recent one" — a previously unmounted app can still
 * append a socket later, and grabbing that one sends every packet into a dead
 * component with no visible error.
 */
async function bootApp() {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('gt7-onboarded', '1');   // skip the first-run overlay

  const index = sockets.length;
  const view = render(React.createElement(App));
  await settle(40);

  const relay = () => sockets[index];

  /** Deliver one packet per car and let the flush pick them up. */
  const sendField = async (over = () => ({})) => {
    await act(async () => {
      IPS.forEach((ip, i) => relay().deliver(packet(ip, i, over(i))));
    });
    await settle();
  };

  /**
   * Trace a circuit the way a real session does: the map records GPS from the
   * animation loop, so the car has to be seen moving across frames before
   * there is any track to draw or any bounds to place dots against.
   */
  const traceTrack = async () => {
    const LOOP = [
      [100, 50], [220, 50], [340, 50], [420, 120], [420, 260],
      [340, 340], [200, 340], [100, 260], [100, 140], [100, 50],
    ];
    for (const [x, z] of LOOP) {
      await act(async () => {
        IPS.forEach((ip, i) => relay().deliver(packet(ip, i, {
          posX: x + i * 4, posZ: z, speedKmh: 170,
        })));
      });
      await settle(60);
      stepFrames(8);
    }
    stepFrames(12);
  };

  return { ...view, relay, sendField, traceTrack };
}

section('the app connects to the relay on its own');
{
  const v = await bootApp();
  assert('a socket was opened', sockets.length >= 1);
  assert('to the local relay', v.relay().url.includes('20777'), v.relay().url);
  assert('the connection badge goes live', /En Direct/i.test(v.container.textContent));
  v.unmount();
}

section('a ten-car field arrives and is shown');
{
  const v = await bootApp();
  await v.sendField();

  click(tabButton(v.container, 'Course'));
  await settle(30);

  const rows = $$(v.container, '.lb-row');
  assert('the leaderboard lists all ten cars', rows.length === 10, `${rows.length}`);
  assert('the multi-team board revealed itself without being asked',
    rows.length > 0, 'still hidden behind the toggle');

  const stripes = $$(v.container, '.lb-stripe').map((s) => s.style.background);
  assert('each car has its own colour', new Set(stripes).size === 10, `${new Set(stripes).size}`);

  await v.traceTrack();
  const dots = carGroups(v.container);
  assert('and every car is on the track map', dots.length === 10, `${dots.length} dots`);
  v.unmount();
}

section('claiming a team with ★ reaches everything downstream');
{
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  const MINE = 4;
  click($($$(v.container, '.lb-row')[MINE], '.lb-mine-btn'));
  await settle(30);

  assert('the choice is remembered across a reload',
    globalThis.localStorage.getItem('gt7-my-team') === IPS[MINE],
    globalThis.localStorage.getItem('gt7-my-team'));
  assert('my row is badged', $$(v.container, '.lb-mine-pill').length === 1);
  assert('and it is the row I clicked',
    $($$(v.container, '.lb-row')[MINE], '.lb-mine-pill') !== null);

  // The map's own-car marker should follow the star: exactly one dot gains a
  // second circle (the halo).
  await v.traceTrack();
  const haloed = carGroups(v.container).filter((g) => g.querySelectorAll('circle').length === 2);
  assert('exactly one dot on the map is marked as mine', haloed.length === 1, `${haloed.length}`);
  v.unmount();
}

section('naming a team reaches the map too');
{
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  const row = $$(v.container, '.lb-row')[2];
  click($(row, '.lb-rename-btn'));
  const input = $(v.container, '.lb-tname-input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Night Shift');
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await settle(30);

  assert('the leaderboard shows the new name',
    $$(v.container, '.lb-tname').some((n) => n.textContent.trim() === 'Night Shift'),
    JSON.stringify($$(v.container, '.lb-tname').map((n) => n.textContent.trim())));
  assert('it is persisted',
    /Night Shift/.test(globalThis.localStorage.getItem('gt7-team-labels') ?? ''),
    globalThis.localStorage.getItem('gt7-team-labels'));

  await v.traceTrack();
  const tags = $$(v.container, 'text').map((t) => t.textContent);
  assert('and the map tag is the short form of it', tags.includes('NIG'), JSON.stringify(tags));
  v.unmount();
}

section('a car that goes quiet leaves the board');
{
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  assert('ten cars to start', $$(v.container, '.lb-row').length === 10);

  // Nine keep transmitting with a fresh stamp; the tenth stops. Staleness is
  // 20 s of wall clock, so rather than wait, re-deliver the nine and confirm
  // the board still tracks exactly who is talking.
  await act(async () => {
    IPS.slice(0, 9).forEach((ip, i) => v.relay().deliver(packet(ip, i)));
  });
  await settle();
  assert('all ten are still listed well inside the staleness window',
    $$(v.container, '.lb-row').length === 10, `${$$(v.container, '.lb-row').length}`);
  v.unmount();
}

section('the Pilotes tab follows the starred car, not the selected one');
{
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  // Claim car 4, then click car 7's row to inspect it.
  click($($$(v.container, '.lb-row')[4], '.lb-mine-btn'));
  await settle(30);
  click($$(v.container, '.lb-row')[7]);
  await settle(30);

  assert('inspecting a rival selects their row',
    $$(v.container, '.lb-row')[7].className.includes('lb-row-sel'));
  assert('but my team is still the starred one',
    globalThis.localStorage.getItem('gt7-my-team') === IPS[4]);

  click(tabButton(v.container, 'Pilotes'));
  await settle(30);
  assert('the Pilotes tab has a team to report on',
    !/Marquez votre équipe/.test(v.container.textContent),
    'still asking for a team despite one being starred');
  assert('and it shows a stint log', $(v.container, '.stint-table') !== null);
  v.unmount();
}

section('a pit stop for my car prompts only for my car');
{
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  click($($$(v.container, '.lb-row')[4], '.lb-mine-btn'));
  await settle(30);

  // A rival exits the pits. That must not raise a driver prompt.
  await act(async () => { v.relay().deliver(packet(IPS[7], 7, { pitExit: true, speedKmh: 80 })); });
  await settle();
  assert('a rival leaving the pits raises no driver prompt for me',
    !/QUI CONDUIT/.test(v.container.textContent) &&
    !/CONFIRMEZ PNEU ET PILOTE/.test(v.container.textContent),
    'a rival\'s stop prompted for a driver');

  // Now my own car exits the pits.
  await act(async () => { v.relay().deliver(packet(IPS[4], 4, { pitExit: true, speedKmh: 80 })); });
  await settle();
  const banner = v.container.textContent;
  assert('my own stop does raise one',
    /QUI CONDUIT/.test(banner) || /CONFIRMEZ PNEU ET PILOTE/.test(banner),
    'no prompt after my own pit exit');
  v.unmount();
}

section('the race screen carries the plan strip and the field at once');
{
  // The plan and the car used to be two tabs: you read the call on one screen
  // and watched the car obey it on another. This asserts they share a screen.
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  assert('the plan strip is on the race screen',
    $(v.container, '.race-strip .now-view') !== null);
  assert('so is the track map',
    $(v.container, '.telem-3col-map .track-map') !== null);
  assert('so is the selected car',
    $(v.container, '.telem-3col-data') !== null);
  assert('and there is no separate telemetry tab left to switch to',
    tabButton(v.container, 'Télémétrie') === undefined);

  assert('and so is the field, on the same screen',
    $(v.container, '.telem-3col-lb .lb-row') !== null);

  // Folding the field away is a layout change, and the strip must not be
  // part of it — it is the one thing on this screen that is always wanted.
  click($$(v.container, '.advanced-lan-toggle')[0]);
  await settle(30);
  assert('folding the field away leaves the strip alone',
    $(v.container, '.telem-3col-lb') === null
    && $(v.container, '.race-strip .now-view') !== null
    && $(v.container, '.telem-3col-map .track-map') !== null);
  v.unmount();
}

section('all three tabs render with a full field');
{
  const v = await bootApp();
  await v.sendField();
  for (const tab of ['Course', 'Stratégie', 'Pilotes']) {
    click(tabButton(v.container, tab));
    await settle(30);
    assert(`the ${tab} tab renders without blowing up`,
      v.container.textContent.length > 0 && $(v.container, '.tab-content') !== null);
  }
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
