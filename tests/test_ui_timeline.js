/**
 * The strategy timeline actually draws the stints.
 *
 * This exists because it didn't. The card was a Recharts vertical stacked bar
 * chart whose rectangles all came back with `width: 0` under Recharts 3, so it
 * rendered its axes, its grid, its pit lines and its tooltip — and not one
 * stint. Nothing failed, nothing logged, and no test looked at it.
 *
 * So the assertions here are deliberately about paint, not about props: a
 * segment per stint, each one positioned and sized by its share of the race,
 * a pit mark per stop, and a compound colour that follows the plan.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_timeline.js
 */

import { setupDom, render, $, $$, textOf } from './helpers/dom.js';

await setupDom();

const { default: StrategyTimeline } = await import('../src/components/StrategyTimeline.jsx');
const en = (await import('../src/i18n/en.js')).default;
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

const num = (el, prop) => parseFloat(el.style[prop]);

/** Three stints over 60 laps: 25 Soft, 25 Medium, 10 Soft, one of them warned. */
const STINTS = [
  {
    stintNum: 1, compound: 'S', compoundName: 'Soft', startLap: 1, endLap: 25, lapsInStint: 25,
    pitLap: 25, pitWindowLatestLap: 28, fuelToAddLiters: 40, tiresChanged: true,
    pitStopTimeSecs: 62, avgLapTimeSecs: 118, warning: null, warningCode: null,
  },
  {
    stintNum: 2, compound: 'M', compoundName: 'Medium', startLap: 26, endLap: 50, lapsInStint: 25,
    pitLap: 50, pitWindowLatestLap: null, fuelToAddLiters: 40, tiresChanged: true,
    pitStopTimeSecs: 62, avgLapTimeSecs: 119, warning: 'Not enough fuel for stint',
    warningCode: 'warn_not_enough_fuel',
  },
  {
    stintNum: 3, compound: 'S', compoundName: 'Soft', startLap: 51, endLap: 60, lapsInStint: 10,
    pitLap: null, pitWindowLatestLap: null, fuelToAddLiters: 0, tiresChanged: false,
    pitStopTimeSecs: 0, avgLapTimeSecs: 117, warning: null, warningCode: null,
  },
];

const TOTAL = 60;

// ────────────────────────────────────────────────────────────────────────────

section('the stints are on screen');
{
  const v = render(React.createElement(StrategyTimeline, { stints: STINTS, totalLaps: TOTAL, lang: 'en' }));
  const segs = $$(v.container, '.tl-seg');

  assert('one segment per stint', segs.length === 3, `got ${segs.length}`);
  assert('none of them is zero-width — the bug this file exists for',
    segs.every((s) => num(s, 'width') > 0),
    segs.map((s) => s.style.width).join(', '));

  // 25/60, 25/60, 10/60 of the bar, starting at 0, 25/60, 50/60.
  assert('each is as wide as its share of the race',
    Math.abs(num(segs[0], 'width') - 41.67) < 0.1 &&
    Math.abs(num(segs[2], 'width') - 16.67) < 0.1,
    segs.map((s) => s.style.width).join(', '));
  assert('and starts where the stint starts',
    Math.abs(num(segs[0], 'left') - 0) < 0.1 &&
    Math.abs(num(segs[1], 'left') - 41.67) < 0.1 &&
    Math.abs(num(segs[2], 'left') - 83.33) < 0.1,
    segs.map((s) => s.style.left).join(', '));
  assert('they run to the end of the race without a gap',
    Math.abs(num(segs[2], 'left') + num(segs[2], 'width') - 100) < 0.1);

  assert('each carries its compound colour', segs[0].className.includes('cmpd-fill-S') &&
    segs[1].className.includes('cmpd-fill-M'));
  assert('a warned stint is marked', segs[1].className.includes('tl-seg-warn'));
  assert('and an unwarned one is not', !segs[0].className.includes('tl-seg-warn'));

  v.unmount();
}

section('pit stops, windows and the ruler');
{
  const v = render(React.createElement(StrategyTimeline, { stints: STINTS, totalLaps: TOTAL, lang: 'en' }));

  const pits = $$(v.container, '.tl-pit');
  assert('a mark for each stop, and none for the final stint', pits.length === 2, `got ${pits.length}`);
  assert('placed at the pit lap', Math.abs(num(pits[0], 'left') - 41.67) < 0.1, pits[0].style.left);
  assert('labelled with the lap', $$(v.container, '.tl-pit-lap').map(textOf).join(',') === '25,50');

  const windows = $$(v.container, '.tl-window');
  assert('the one stint with slack gets a pit window', windows.length === 1);
  assert('spanning end-of-stint to the latest lap',
    Math.abs(num(windows[0], 'left') - 41.67) < 0.1 && Math.abs(num(windows[0], 'width') - 5) < 0.1,
    `${windows[0].style.left} + ${windows[0].style.width}`);

  const ticks = $$(v.container, '.tl-tick').map(textOf);
  assert('the ruler runs from 0 to the last lap',
    ticks[0] === '0' && ticks[ticks.length - 1] === String(TOTAL), ticks.join(','));
  assert('and stays sparse enough to read', ticks.length <= 5, ticks.join(','));

  v.unmount();
}

section('hovering a stint explains it');
{
  const v = render(React.createElement(StrategyTimeline, { stints: STINTS, totalLaps: TOTAL, lang: 'en' }));
  assert('nothing is shown until you point at something', $(v.container, '.tl-tooltip') === null);

  const { act } = await import('./helpers/dom.js');
  const seg = $$(v.container, '.tl-seg')[1];
  act(() => { seg.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })); });

  const tip = $(v.container, '.tl-tooltip');
  assert('the hovered stint gets a tooltip', tip !== null);
  if (tip) {
    const text = tip.textContent;
    assert('naming the stint and its compound', text.includes('Stint 2') && text.includes('Medium'), text);
    assert('with its lap range', text.includes('26') && text.includes('50'), text);
    assert('and its warning, translated from the code',
      text.includes(en.warn_not_enough_fuel), text);
  }
  v.unmount();
}

section('it refuses to draw nonsense');
{
  const empty = render(React.createElement(StrategyTimeline, { stints: [], totalLaps: TOTAL, lang: 'en' }));
  assert('no stints, no card', $(empty.container, '.tl-track') === null);
  empty.unmount();

  const noLaps = render(React.createElement(StrategyTimeline, { stints: STINTS, totalLaps: 0, lang: 'en' }));
  assert('no race length, no card — rather than dividing by zero',
    $(noLaps.container, '.tl-track') === null);
  noLaps.unmount();
}

section('it speaks the chosen language');
{
  const fr = (await import('../src/i18n/fr.js')).default;
  const v = render(React.createElement(StrategyTimeline, { stints: STINTS, totalLaps: TOTAL, lang: 'fr' }));
  const text = v.container.textContent;
  assert('the card title is French', text.includes(fr.tl_title), text.slice(0, 80));
  assert('and the legend uses French compound names', text.includes(fr.compound_S), text.slice(0, 120));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
