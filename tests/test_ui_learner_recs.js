/**
 * The telemetry learner's proposals: full cards on the Strategy tab, one row in
 * the car panel.
 *
 * The row exists because the cards were 135px for a single proposal and pushed
 * the car panel into a scroll. So what matters here is that the compact form
 * shows ONE proposal however many are waiting, says how many there are, still
 * carries the sample count you judge it by, and that both buttons act on the
 * proposal that is actually on screen.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_learner_recs.js
 */

import { setupDom, render, click, $, $$, textOf } from './helpers/dom.js';

await setupDom();

const { default: LearnerRecommendations } = await import('../src/components/LearnerRecommendations.jsx');
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

const REC = (key, over = {}) => ({
  key, kind: 'scalar', label: key, measured: 39.2, current: 29.4, unit: 'laps',
  trust: { sampleCount: 78, volatility: 0.4, highlyVolatile: false }, ...over,
});

const view = (recs, over = {}) => {
  const calls = { accept: [], ignore: [] };
  const v = render(React.createElement(LearnerRecommendations, {
    recommendations: recs,
    onAccept: (r) => calls.accept.push(r.key),
    onIgnore: (r) => calls.ignore.push(r.key),
    lang: 'en',
    ...over,
  }));
  return { v, calls };
};

section('the car panel gets one row, however many are waiting');
{
  const { v } = view([REC('fuel'), REC('penalty'), REC('deg')], { compact: true });
  assert('it is the compact form', $(v.container, '.learner-recs--compact') !== null);
  assert('with no cards in it', $$(v.container, '.rec-card').length === 0);
  assert('one proposal is shown', $$(v.container, '.rec-accept').length === 1);
  const txt = textOf(v.container);
  assert('it is the first one', /fuel/.test(txt) && !/penalty/.test(txt), txt);
  assert('it says how many are waiting', /1 of 3/.test(txt), txt);
  assert('and keeps the sample count you judge it by', /78 laps/.test(txt), txt);
  v.unmount();
}

section('a single proposal does not count itself');
{
  const { v } = view([REC('fuel')], { compact: true });
  assert('no "1 of 1"', !/of 1/.test(textOf(v.container)), textOf(v.container));
  v.unmount();
}

section('the buttons act on the proposal on screen');
{
  const { v, calls } = view([REC('fuel'), REC('penalty')], { compact: true });
  click($(v.container, '.rec-accept'));
  click($(v.container, '.rec-ignore'));
  assert('accept', calls.accept.join() === 'fuel', calls.accept.join());
  assert('ignore', calls.ignore.join() === 'fuel', calls.ignore.join());
  v.unmount();
}

section('a volatile number is still flagged on the row');
{
  const { v } = view([REC('fuel', { trust: { sampleCount: 5, volatility: 2, highlyVolatile: true } })], { compact: true });
  assert('the badge is there', $(v.container, '.rec-trust-badge') !== null);
  v.unmount();
}

section('the Strategy tab keeps the full cards');
{
  const { v } = view([REC('fuel'), REC('penalty')]);
  assert('one card each', $$(v.container, '.rec-card').length === 2);
  assert('not the compact row', $(v.container, '.learner-recs--compact') === null);
  v.unmount();
}

section('nothing to propose, nothing drawn');
{
  const { v } = view([], { compact: true });
  assert('empty', $(v.container, '.learner-recs') === null);
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
