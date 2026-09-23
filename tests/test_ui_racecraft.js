/**
 * The racecraft block on the race strip.
 *
 * The arithmetic is covered in test_racecraft.js. What matters here is that
 * the three answers actually reach the screen, that each one appears only when
 * it has something to say, and — the part a unit test cannot see — that the
 * block disappears entirely rather than rendering an empty bar when there is
 * no field to race against.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_racecraft.js
 */

import { setupDom, render, $, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: NowView } = await import('../src/components/NowView.jsx');
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

const DATA = {
  currentLap: 20, fuelLiters: 50, onTrack: true, speedKmh: 180,
  lastLapMs: 90_000, bestLapMs: 89_500,
};

const view = (racecraft) => render(React.createElement(NowView, {
  data: DATA,
  strategy: null,
  planLabel: null,
  litersPerLap: 3,
  tireLife: 30,
  frozen: false,
  onToggleFreeze: () => {},
  label: 'MCG',
  clock: { elapsedSecs: 3600, remainingSecs: 3600, remainingMins: 60, finished: false },
  onStartRace: () => {},
  onClearRace: () => {},
  racecraft,
  lang: 'en',
}));

// ---------------------------------------------------------------------------

section('nothing to say, nothing on screen');
{
  const empty = view(null);
  assert('no block without a field', $(empty.container, '.now-rc') === null);
  empty.unmount();

  // The shape exists but every answer is null — a lone car on the LAN, or a
  // field nobody has been seen crossing the line yet. An empty bar with a
  // title and no content is worse than no bar.
  const blank = view({ position: null, undercut: null, traffic: null });
  assert('nor with a field that cannot answer anything',
    $(blank.container, '.now-rc') === null);
  blank.unmount();
}

section('where I would come out');
{
  const drop = view({
    position: {
      from: 2, to: 4, lost: 2, aheadAfter: ['a', 'b', 'c'],
      ahead: { ip: 'c', secs: 2.1, name: 'Bordeaux' }, behind: null,
    },
    undercut: null, traffic: null,
  });
  const txt = textOf($(drop.container, '.now-rc'));
  assert('the block is there', $(drop.container, '.now-rc') !== null);
  assert('it says where I go', /P2\s*→\s*P4/.test(txt), txt);
  assert('and who I come out behind', /Bordeaux/.test(txt), txt);
  assert('a place lost reads as a cost',
    $(drop.container, '.now-rc-item.is-cost') !== null);
  drop.unmount();

  // A stop that costs nothing is the more useful of the two answers, because
  // it is the one you would not have guessed.
  const free = view({
    position: {
      from: 2, to: 2, lost: 0, aheadAfter: ['a'],
      ahead: { ip: 'a', secs: 9.5, name: 'Lyon' }, behind: null,
    },
    undercut: null, traffic: null,
  });
  const freeTxt = textOf($(free.container, '.now-rc'));
  assert('keeping the place is said plainly', /P2/.test(freeTxt), freeTxt);
  assert('and is not dressed as a loss',
    $(free.container, '.now-rc-item.is-free') !== null);
  free.unmount();
}


section('rejoining into a fight, or into clean air');
{
  // The place is half the answer; who is either side of it is the other half.
  const fight = view({
    position: {
      from: 2, to: 4, lost: 2, aheadAfter: ['a', 'b', 'c'],
      ahead: { ip: 'a', secs: 0.4, name: 'Lyon' },
      behind: { ip: 'b', secs: 0.8, name: 'Nantes' },
    },
    undercut: null, traffic: null,
  });
  const txt = textOf($(fight.container, '.now-rc'));
  assert('both neighbours are named', /Lyon/.test(txt) && /Nantes/.test(txt), txt);
  assert('with the gap to each', /0\.4s/.test(txt) && /0\.8s/.test(txt), txt);
  fight.unmount();

  // Nobody behind is said, not implied by absence — in a ten-car field there
  // is no P11, and a blank there would read as "unknown".
  const last = view({
    position: {
      from: 2, to: 10, lost: 8, aheadAfter: ['a'],
      ahead: { ip: 'a', secs: 6.2, name: 'Lyon' },
      behind: null,
    },
    undercut: null, traffic: null,
  });
  const lastTxt = textOf($(last.container, '.now-rc'));
  assert('coming out last says so plainly', /nothing behind/i.test(lastTxt), lastTxt);
  assert('and still names what is in front', /Lyon.*6\.2s/.test(lastTxt), lastTxt);
  last.unmount();

  // Clean air is the answer that changes the call, so it is said outright.
  const clear = view({
    position: {
      from: 1, to: 1, lost: 0, aheadAfter: [],
      ahead: null, behind: { ip: 'b', secs: 30, name: 'Nantes' },
    },
    undercut: null, traffic: null,
  });
  assert('leading into clean air says clear air',
    /clear air/i.test(textOf($(clear.container, '.now-rc'))),
    textOf($(clear.container, '.now-rc')));
  clear.unmount();
}

section('the undercut');
{
  const works = view({
    position: null,
    undercut: { works: true, marginSecs: 0.9, gainSecs: 2.4, laps: 3, who: 'Lyon' },
    traffic: null,
  });
  const txt = textOf($(works.container, '.now-rc'));
  assert('it names the car', /Lyon/.test(txt), txt);
  assert('says it works', /works/i.test(txt), txt);
  assert('and by how much, over how many laps', /0\.9s.*3 laps/.test(txt), txt);
  // The one thing here you act on, so it is the only one with the accent.
  assert('it is the line that carries the accent',
    $(works.container, '.now-rc-item.is-good') !== null);
  works.unmount();

  const fails = view({
    position: null,
    undercut: { works: false, marginSecs: -1.6, gainSecs: 2.4, laps: 3, who: 'Lyon' },
    traffic: null,
  });
  const failTxt = textOf($(fails.container, '.now-rc'));
  assert('a failing undercut says so', /does not work/i.test(failTxt), failTxt);
  assert('and says how far short, without a minus sign',
    /short by 1\.6s/.test(failTxt), failTxt);
  assert('it is dimmed rather than highlighted',
    $(fails.container, '.now-rc-item.is-dim') !== null
    && $(fails.container, '.now-rc-item.is-good') === null);
  fails.unmount();
}

section('traffic ahead');
{
  const t = view({
    position: null, undercut: null,
    traffic: { ip: 'x', laps: 2.9, gapSecs: 8.7, closingSecsPerLap: 3, lapsDown: -2, who: 'Nantes' },
  });
  const txt = textOf($(t.container, '.now-rc'));
  assert('it names who and when', /Nantes.*3 laps/.test(txt), txt);
  assert('and what they are costing a lap', /3\.0s a lap/.test(txt), txt);
  t.unmount();
}

section('all three at once');
{
  const all = view({
    position: {
      from: 2, to: 3, lost: 1, aheadAfter: ['a', 'b'],
      ahead: { ip: 'a', secs: 1.2, name: 'Lyon' }, behind: null,
    },
    undercut: { works: true, marginSecs: 0.9, gainSecs: 2.4, laps: 3, who: 'Lyon' },
    traffic: { ip: 'x', laps: 2.9, gapSecs: 8.7, closingSecsPerLap: 3, lapsDown: -2, who: 'Nantes' },
  });
  const items = all.container.querySelectorAll('.now-rc-item');
  assert('three answers, three lines', items.length === 3, String(items.length));
  // They are one row of the strip, read left to right in the order the
  // decision is made: where I land, whether it wins me the place, what is
  // between me and the next lap.
  assert('in the order the call is made',
    /P2/.test(textOf(items[0])) && /Lyon/.test(textOf(items[1])) && /Nantes/.test(textOf(items[2])),
    [...items].map(textOf).join(' | '));
  all.unmount();
}

section('the tyre crossover shows its working');
{
  // It read "pays off above 0.3s/lap lost" with nothing to say where 0.3 came
  // from, and in the background's own colour. It is the tyre-only stop divided
  // by the laps left, so it says both.
  const v = render(React.createElement(NowView, {
    data: DATA, strategy: null, planLabel: null, litersPerLap: 3, tireLife: 30,
    frozen: false, onToggleFreeze: () => {}, label: 'MCG', lang: 'en',
    crossover: { perLap: 52 / 235, stopSecs: 52, laps: 235 },
  }));
  const txt = textOf($(v.container, '.now-crossover'));
  assert('the threshold, to two places when under a second', /0\.22s\/lap/.test(txt), txt);
  assert('the stop it is made of', /52s stop/.test(txt), txt);
  assert('and the laps it is spread over', /235 laps left/.test(txt), txt);
  v.unmount();

  const none = render(React.createElement(NowView, {
    data: DATA, strategy: null, planLabel: null, litersPerLap: 3, tireLife: 30,
    frozen: false, onToggleFreeze: () => {}, label: 'MCG', lang: 'en', crossover: null,
  }));
  assert('nothing to decide, no line', $(none.container, '.now-crossover') === null);
  none.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
