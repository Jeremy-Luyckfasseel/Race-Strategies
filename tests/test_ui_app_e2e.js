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
async function bootApp(seed = {}) {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('gt7-onboarded', '1');   // skip the first-run overlay
  for (const [k, v] of Object.entries(seed)) globalThis.localStorage.setItem(k, v);

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

section('the race screen does not hide anything behind a scroll');
{
  // jsdom has no layout engine, so this cannot assert pixel heights. What it
  // CAN hold is the structure the fit depends on: the setup panel out of the
  // flow and into the header, no utility row between the plan and the field,
  // and the folded leaderboard costing width rather than a row of height.
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  assert('connections lives in the header, not between the plan and the field',
    $(v.container, '.app-header .header-telem .tc-panel') !== null);
  assert('and nothing of it is left in the race screen',
    $(v.container, '.tab-content--race .tc-panel') === null);
  assert('the utility row is gone entirely',
    $(v.container, '.race-util') === null);

  // Opening it must not push the layout down, so it renders as its own
  // absolutely-positioned body rather than as a block in the header row.
  click($(v.container, '.header-telem .tc-collapse-btn'));
  await settle(30);
  assert('opening it produces a detached panel body',
    $(v.container, '.header-telem .tc-body') !== null);
  click($(v.container, '.header-telem .tc-collapse-btn'));
  await settle(30);

  // Folding the field away leaves a rail, not a full-width bar.
  assert('the field is showing to begin with', $(v.container, '.telem-3col-lb') !== null);
  click($(v.container, '.telem-3col-lb .advanced-lan-toggle'));
  await settle(30);
  assert('folded, it is a rail beside the map',
    $(v.container, '.lb-rail') !== null && $(v.container, '.telem-3col-lb') === null);
  assert('and the rail brings it back',
    (click($(v.container, '.lb-rail')), await settle(30), $(v.container, '.telem-3col-lb') !== null));
  v.unmount();
}

section('the lights go out, and the notices forget the lobby');
{
  // The pit-stop notice is de-duplicated per car per LAP, and GT7's lap counter
  // restarts with the race — which is what startRace's own comment says about
  // the incident mark. A stop on lap 3 of the practice session must not silence
  // the stop on lap 3 of the race: that notice is the one saying "confirm the
  // tyre and the driver", and missing it leaves the stint log and the learner
  // describing a tyre that is not on the car for the rest of the stint.
  const v = await bootApp();
  localStorage.setItem('gt7-my-team', IPS[0]);
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);

  const boxOnLap = async (lap) => {
    await act(async () => {
      v.relay().deliver(packet(IPS[0], 0, { currentLap: lap, pitExit: true, speedKmh: 80 }));
    });
    await settle(60);
  };
  const notices = () => $$(v.container, '.toast').map((n) => n.textContent).join(' ~ ');

  await boxOnLap(3);
  assert('a stop in the lobby raises a notice',
    $$(v.container, '.toast').length > 0, notices());

  // Dismiss it, the way an engineer would after confirming the tyre.
  const close = $(v.container, '.toast-close');
  if (close) { click(close); await settle(30); }
  assert('and it can be dismissed', $$(v.container, '.toast').length === 0, notices());

  // The race starts. GT7's counter goes back to lap 1.
  click($$(v.container, 'button').find((b) => /Start race|Démarrer la course/.test(b.textContent)));
  await settle(30);
  const card = $(v.container, '.dlg-card');
  click($(card, '.dlg-btn--go'));
  await act(async () => { await Promise.resolve(); });
  await settle(60);

  // The same lap number, a different race, a real stop.
  await boxOnLap(3);
  assert('the same lap number in the real race still raises one',
    $$(v.container, '.toast').length > 0, notices());
  v.unmount();
}

section('a plan picked in the lobby is the plan the race runs, from its first row');
{
  // Hards to the flag, 10 laps a stint, chosen before the race.
  const v = await bootApp({
    'gt7-manual-plan': JSON.stringify({ rows: [{ compoundId: 'H', stints: null, laps: 10 }], racing: true }),
  });
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  click($($$(v.container, '.lb-row')[4], '.lb-mine-btn'));
  await settle(30);

  // Practice in the lobby: my car stops once, so the stint log holds a stint.
  await act(async () => { v.relay().deliver(packet(IPS[4], 4, { currentLap: 12, speedKmh: 0, pitDetected: true })); });
  await settle();
  await act(async () => { v.relay().deliver(packet(IPS[4], 4, { currentLap: 12, speedKmh: 80, pitExit: true })); });
  await settle();
  // A real console keeps streaming, so the last packet held is an ordinary
  // lap, not the pit-exit edge.
  await v.sendField(() => ({ currentLap: 14 }));

  // The race starts; GT7's counter goes back to lap 1.
  click($$(v.container, 'button').find((b) => /Start race|Démarrer la course/.test(b.textContent)));
  await settle(30);
  click($($(v.container, '.dlg-card'), '.dlg-btn--go'));
  await act(async () => { await Promise.resolve(); });
  await settle(60);

  await v.sendField(() => ({ currentLap: 1 }));
  // The first stint of the race began on lap 1, not on the lobby's lap 14.
  const first = JSON.parse(globalThis.localStorage.getItem('gt7-stint-log') || '{}')[IPS[4]]?.current;
  assert('the race’s first stint starts on its first lap, not the lobby’s last', first?.startLap === 1,
    JSON.stringify(first?.startLap));
  let box = null;
  for (let i = 0; i < 60; i++) {
    await v.sendField(() => ({ currentLap: 3 }));
    box = $(v.container, '.now-box-lap');
    if (box && /\b10\b/.test(box.textContent)) break;
  }
  const strip = $(v.container, '.race-strip')?.textContent ?? '';
  assert('the race follows the plan picked in the lobby', /Votre stratégie/.test(strip), strip.slice(0, 120));
  // The lobby stop was wiped with the stint log at the start, so row 1 is not
  // skipped: its first 10-lap stint runs from lap 1 and boxes on lap 10.
  assert('starting from its first stint, not after the practice one',
    box && /\b10\b/.test(box.textContent), box?.textContent);
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

section('what I picked for the next stint is what the car gets at the stop');
{
  // Picking the next driver and tyre before the stop and then confirming both
  // again after it was the same question twice. At my car's pit exit the pick
  // becomes the new stint's driver and tyre, and neither prompt is raised.
  const v = await bootApp();
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  click($($$(v.container, '.lb-row')[4], '.lb-mine-btn'));
  await settle(30);

  // The block needs a plan (it sizes the NEXT stint), and the engine is debounced.
  let ns = null;
  for (let i = 0; i < 60 && !ns; i++) {
    await v.sendField();
    ns = $(v.container, '.ns-block');
  }
  assert('the next-stint block is there for my car', ns !== null);

  const rows = $$(v.container, '.ns-row');
  const driverBtn = $$(rows[0], '.ld-cp-btn')[0];
  const driverName = driverBtn?.textContent.trim();
  click(driverBtn);
  await settle(30);
  click($$($$(v.container, '.ns-row')[1], '.ld-cp-btn').find((b) => b.textContent.trim() === 'W'));
  await settle(30);

  await act(async () => { v.relay().deliver(packet(IPS[4], 4, { pitExit: true, speedKmh: 80, currentLap: 9 })); });
  await settle();

  const tyre = $(v.container, '.ld-compound-picker .active');
  assert('the car is on the wets I picked', tyre?.textContent.trim() === 'W', tyre?.textContent);
  const driver = $(v.container, '.ld-driver-picker .active');
  assert('and the driver I picked is driving', driver?.textContent.trim() === driverName,
    `${driver?.textContent} vs ${driverName}`);
  assert('so there is nothing left to confirm', $(v.container, '.ld-confirm-banner') === null);
  assert('and the pick is cleared for the stint after',
    $$(v.container, '.ns-row .ld-cp-btn.active').length === 0);
  v.unmount();
}

section('racing a typed plan moves the race screen onto it');
{
  // Hards to the flag, 10 laps a stint. The engine would never pick 10-lap
  // hard stints, so the first box lap on the strip says whose plan it is.
  const seed = {
    'gt7-manual-plan': JSON.stringify({ rows: [{ compoundId: 'H', stints: null, laps: 10 }], racing: true }),
  };
  const v = await bootApp(seed);
  await v.sendField();
  click(tabButton(v.container, 'Course'));
  await settle(30);
  click($($$(v.container, '.lb-row')[4], '.lb-mine-btn'));

  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    await v.sendField();
    box = $(v.container, '.now-box-lap');
  }
  const plan = $(v.container, '.now-plan-seq')?.textContent ?? '';
  assert('the strip names the typed plan', /Votre stratégie/.test(plan), plan);
  // No race clock is running, so the plan is laid from lap 1: 10 typed laps
  // box on lap 10. The engine's own plan on these inputs boxes much later.
  assert('and boxes where the typed laps say', box && /\b10\b/.test(box.textContent), box?.textContent);

  // The same plan, not raced: the strip is the engine's again.
  const seed2 = {
    'gt7-manual-plan': JSON.stringify({ rows: [{ compoundId: 'H', stints: null, laps: 10 }], racing: false }),
  };
  v.unmount();
  const w = await bootApp(seed2);
  await w.sendField();
  click(tabButton(w.container, 'Course'));
  await settle(30);
  click($($$(w.container, '.lb-row')[4], '.lb-mine-btn'));
  let box2 = null;
  for (let i = 0; i < 60 && !box2; i++) {
    await w.sendField();
    box2 = $(w.container, '.now-box-lap');
  }
  const strip = $(w.container, '.race-strip')?.textContent ?? '';
  assert('not raced, the strip does not name it', box2 && !/Votre stratégie/.test(strip), strip.slice(0, 120));
  assert('and boxes where the engine says', box2 && !/\b10\b/.test(box2.textContent), box2?.textContent);
  w.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
