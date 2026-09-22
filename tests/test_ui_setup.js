/**
 * The two components on the Stratégie tab that nothing rendered in a test.
 *
 * The sidebar is where every lap time and tyre life is typed in, and the
 * comparison cards are what you read the answer off. Both changed in this
 * branch — the sidebar's prop contract and its tyre ordering, the cards' delta
 * badge — and neither had a rendered check, which is the same gap that let a
 * chart ship drawing nothing.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_setup.js
 */

import { setupDom, render, $, $$, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: InputPanel } = await import('../src/components/InputPanel.jsx');
const { default: ResultsSummary } = await import('../src/components/ResultsSummary.jsx');
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

// The stored order, which is NOT the order these should be shown in.
const COMPOUNDS = [
  { id: 'H',  name: 'Hard',   tireLife: 60, mandatory: false, startLapTime: '2:00', halfLapTime: '2:01', endLapTime: '2:03' },
  { id: 'M',  name: 'Medium', tireLife: 40, mandatory: false, startLapTime: '1:58', halfLapTime: '2:00', endLapTime: '2:03' },
  { id: 'S',  name: 'Soft',   tireLife: 25, mandatory: false, startLapTime: '1:56', halfLapTime: '1:59', endLapTime: '2:03' },
  { id: 'IM', name: 'Inter',  tireLife: 0,  mandatory: false, startLapTime: '2:05', halfLapTime: '2:07', endLapTime: '2:10' },
  { id: 'W',  name: 'Wet',    tireLife: 0,  mandatory: false, startLapTime: '2:10', halfLapTime: '2:13', endLapTime: '2:17' },
];

const INPUTS = {
  raceDurationHours: 8, tankSize: 100, lapsPerFullTank: 28, fuelMap: 1.0,
  pitBaseSecs: 25, tireChangeSecs: 27, fuelRateLitersPerSec: 4,
  fuelWeightPenaltyPerLiter: 0.03, mandatoryStops: 0, minDriverTimeSecs: 7200,
  conditions: 'dry', midRaceMode: false,
  currentLap: '', currentFuel: '', currentCompoundId: '', currentTireAgeLaps: '',
  drivers: [{ id: 'd1', name: 'Alice', compounds: {} }],
  compounds: COMPOUNDS,
};

const panel = (over = {}) => render(React.createElement(InputPanel, {
  inputs: { ...INPUTS, ...over.inputs },
  onChange: () => {}, onCalculate: () => {},
  liveDriven: false, lang: 'en',
  ...over.props,
}));

// ---------------------------------------------------------------------------

section('the sidebar shows tyres softest first');
{
  // The stored array is H, M, S, IM, W — the engine and the saved setup depend
  // on that order. What is RENDERED must not be: the leaderboard and the
  // pickers read softest-first, and two orders for the same five rows is how a
  // wrong tyre gets clicked at 3am.
  const v = panel();
  const tags = $$(v.container, '.compound-tag').map((n) => textOf(n));
  assert('the compound table is rendered at all', tags.length >= 5, JSON.stringify(tags));
  assert('and it reads S, M, H, then the wets',
    tags.slice(0, 5).join() === 'S,M,H,IM,W', tags.slice(0, 5).join());

  // And the stored order is untouched by rendering it.
  assert('without reordering what is stored',
    INPUTS.compounds.map((c) => c.id).join() === 'H,M,S,IM,W');
  v.unmount();
}

section('the wets can be given lap times before they are given a life');
{
  // Filtering this table by tireLife > 0 meant you could not enter a driver's
  // wet times until you had first given the wet tyre a life — in the rain that
  // is exactly the wrong order.
  const v = panel();
  const ids = $$(v.container, '.compound-tag').map((n) => textOf(n));
  assert('a compound with no life configured is still listed',
    ids.includes('W') && ids.includes('IM'), JSON.stringify(ids));
  v.unmount();
}

section('the race-length field says which length it means');
{
  // Typing the remainder by hand and having the clock subtract it are two
  // different things, and the label has to say which is happening — "time
  // remaining: 8" beside a banner reading "6:43 left of 8h" is a contradiction.
  const byHand = panel({ inputs: { midRaceMode: true }, props: { liveDriven: false } });
  const byHandLabel = textOf($(byHand.container, 'label[for="raceDuration"]'));
  assert('entered by hand, it is the time remaining',
    /remaining|left/i.test(byHandLabel), byHandLabel);
  byHand.unmount();

  const byClock = panel({ inputs: { midRaceMode: true }, props: { liveDriven: true } });
  const byClockLabel = textOf($(byClock.container, 'label[for="raceDuration"]'));
  assert('driven by the clock, it is the full race length',
    !/remaining/i.test(byClockLabel), byClockLabel);
  byClock.unmount();
}

section('the mandatory-stop column says what it is');
{
  // It was a bare ★, which says nothing about what ticking it does.
  const v = panel();
  const head = textOf($(v.container, '.compound-table-wrap thead')
    || $(v.container, 'thead'));
  assert('the column is labelled in words, not a glyph',
    /must use/i.test(head) && !/★/.test(head), head);
  v.unmount();
}

// ---------------------------------------------------------------------------

const strategy = (laps, secs, seq = ['H', 'M']) => ({
  label: seq.join(' → '),
  sequenceIds: seq,
  compoundIds: seq,
  strategy: {
    totalLaps: laps,
    estTotalRaceTimeSecs: secs,
    totalPitStops: 2,
    totalPitTimeSecs: 120,
    stints: [
      { stintNum: 1, compound: seq[0], lapsInStint: Math.round(laps / 2), startLap: 1, endLap: Math.round(laps / 2) },
      { stintNum: 2, compound: seq[1] ?? seq[0], lapsInStint: laps - Math.round(laps / 2), startLap: Math.round(laps / 2) + 1, endLap: laps },
    ],
    driverTotals: [],
  },
});

const cards = (ranked) => render(React.createElement(ResultsSummary, {
  ranked, best: ranked[0], selectedIndex: 0, onSelect: () => {}, lang: 'en',
}));

section('the comparison cards sign their own deltas');
{
  // The badge used to hardcode "+", so a deficit rounded to nothing printed
  // "+-0s" — a plus, a minus and a zero, all at once.
  const v = cards([
    strategy(240, 28_800),
    strategy(240, 28_800.02),           // the same, within rounding
    strategy(240, 28_812.4),            // twelve seconds off
    strategy(239, 28_790, ['M', 'S']),  // a lap down
    strategy(241, 28_795, ['S', 'H']),  // a lap up
  ]);

  const badges = $$(v.container, '.delta-badge').map((n) => textOf(n));
  assert('every alternative carries a delta', badges.length === 4, JSON.stringify(badges));
  assert('no badge ever prints a plus and a minus together',
    badges.every((b) => !/\+−/.test(b) && !/\+-/.test(b)), JSON.stringify(badges));
  assert('a dead heat is a bare zero, with no sign at all',
    badges[0] === '0.0s', badges[0]);
  assert('a slower plan is signed +', badges[1] === '+12.4s', badges[1]);
  assert('a plan a lap down is signed with a real minus',
    badges[2] === '−1 lap', badges[2]);
  assert('and one lap is "lap", not "laps"', /1 lap$/.test(badges[2]), badges[2]);
  assert('a plan a lap up is signed +', badges[3] === '+1 lap', badges[3]);
  v.unmount();
}

section('the best plan is not compared against itself');
{
  const v = cards([strategy(240, 28_800), strategy(239, 28_900)]);
  const first = $$(v.container, '.comparison-card')[0];
  assert('the leading card carries no delta badge',
    $(first, '.delta-badge') === null, textOf(first));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
