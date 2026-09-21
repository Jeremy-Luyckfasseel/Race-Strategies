/**
 * Notices for what you were not looking at.
 *
 * The app already worked out that a car had boxed or that a measurement
 * disagreed with the setup, and then put the answer in a panel and waited for
 * someone to look at it. On a screen this dense, "it is on the screen" is not
 * the same as "you saw it".
 *
 * What matters here is the behaviour that makes a notice trustworthy: it does
 * not stack duplicates of one event, my own car's stop does not time out, and
 * acting on it NAVIGATES rather than executing — a tyre picked by mis-tapping a
 * corner card is a wrong compound in the stint log for the rest of the stint.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_toasts.js
 */

import { setupDom, render, click, act, $, $$, textOf } from './helpers/dom.js';

await setupDom();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: Toasts } = await import('../src/components/Toasts.jsx');
const { useToasts, TOAST_MS } = await import('../src/hooks/useToasts.js');
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

/**
 * A harness that exposes the hook's own API, so these exercise the real
 * push/dismiss/expiry rather than a re-implementation of them.
 */
let api = null;
function Harness() {
  api = useToasts();
  return React.createElement(Toasts, { toasts: api.toasts, onDismiss: api.dismiss, lang: 'en' });
}

const boot = () => render(React.createElement(Harness));
const push = async (t) => { await act(async () => { api.push(t); }); };
const settle = async (ms = 0) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

// ---------------------------------------------------------------------------

section('nothing to say, nothing on screen');
{
  const v = boot();
  assert('no container until there is a notice', $(v.container, '.toasts') === null);
  v.unmount();
}

section('a car has boxed');
{
  const v = boot();
  await push({
    key: 'pit:10.0.0.4:22',
    kind: 'info',
    title: '127.0.0.4 has pitted',
    detail: 'Set what they came out on',
    action: { label: 'Open the car', run: () => {} },
  });

  assert('the notice is up', $(v.container, '.toast') !== null);
  assert('it names the car', /127\.0\.0\.4/.test(textOf($(v.container, '.toast'))));

  // The same edge arriving twice — a re-render, a second packet on the same
  // lap — must not stack two identical cards.
  await push({ key: 'pit:10.0.0.4:22', kind: 'info', title: '127.0.0.4 has pitted' });
  assert('the same stop does not stack', $$(v.container, '.toast').length === 1,
    String($$(v.container, '.toast').length));

  // A DIFFERENT stop by the same car is a different event.
  await push({ key: 'pit:10.0.0.4:48', kind: 'info', title: '127.0.0.4 has pitted' });
  assert('but their next stop is its own notice', $$(v.container, '.toast').length === 2);
  v.unmount();
}

section('acting on one takes you to the controls, it does not press them');
{
  const v = boot();
  let went = null;
  await push({
    key: 'pit:mine',
    kind: 'act',
    sticky: true,
    title: 'MCG has stopped',
    detail: 'Set the tyre and the driver',
    action: { label: 'Open the car', run: () => { went = 'MCG'; } },
  });

  // No compound buttons in the card: picking a tyre by mis-tapping a corner
  // notice writes a wrong compound into the stint log AND the learner for the
  // rest of that stint. The pickers live on the car's own dashboard.
  const card = $(v.container, '.toast');
  assert('the card carries one action, not a picker',
    $$(card, 'button').length === 2, String($$(card, 'button').length));

  click($(v.container, '.toast-go'));
  await settle();
  assert('it navigates', went === 'MCG', String(went));
  assert('and the notice goes with it', $(v.container, '.toast') === null);
  v.unmount();
}

section('the ones that need answering do not time out');
{
  const v = boot();
  await push({ key: 'rival', kind: 'info', title: 'A rival pitted' });
  await push({ key: 'mine', kind: 'act', sticky: true, title: 'My car stopped' });
  assert('both are up', $$(v.container, '.toast').length === 2);

  // Past the lifetime of a passing notice.
  await settle(TOAST_MS + 200);

  const left = $$(v.container, '.toast').map(textOf).join(' ');
  assert('the rival notice has expired', !/A rival pitted/.test(left), left);
  assert('mine is still there, because a tyre has to be recorded either way',
    /My car stopped/.test(left), left);
  assert('and it is marked as needing an answer',
    $(v.container, '.toast--act') !== null);

  click($(v.container, '.toast-close'));
  await settle();
  assert('dismissing it by hand works', $(v.container, '.toast') === null);
  v.unmount();
}

section('the stack does not become wallpaper');
{
  const v = boot();
  for (let i = 0; i < 9; i++) {
    await push({ key: `n${i}`, kind: 'info', title: `Notice ${i}` });
  }
  const cards = $$(v.container, '.toast');
  assert('it is capped', cards.length <= 4, String(cards.length));
  // Keeping the OLDEST would mean the newest event — the one you need — is the
  // one dropped.
  assert('and it keeps the newest', /Notice 8/.test(textOf(cards[cards.length - 1])),
    textOf(cards[cards.length - 1]));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
