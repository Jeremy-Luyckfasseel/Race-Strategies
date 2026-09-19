/**
 * The language switch.
 *
 * The strings live in `src/i18n/`, but what matters is that flipping the header
 * toggle actually re-renders the tree in the other language and that the choice
 * survives a reload — the two things a strings file on its own does not buy you.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_i18n.js
 */

import { setupDom, render, click, $, $$, textOf } from './helpers/dom.js';

await setupDom();

globalThis.WebSocket = class {
  constructor() { this.readyState = 0; }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { default: App } = await import('../src/App.jsx');
const { LANG_KEY, t, compoundName, compoundSequence } = await import('../src/i18n/strings.js');
const { findBestStrategies, TIRE_COMPOUNDS } = await import('../src/logic/strategy.js');
const { buildRecommendations } = await import('../src/logic/recommendations.js');
const en = (await import('../src/i18n/en.js')).default;
const fr = (await import('../src/i18n/fr.js')).default;
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

const langButton = (root, label) =>
  $$(root, '.lang-btn').find((b) => textOf(b) === label);

// The onboarding overlay hides the header, so every case starts past it.
function boot() {
  localStorage.setItem('gt7-onboarded', '1');
  return render(React.createElement(App));
}

// ────────────────────────────────────────────────────────────────────────────

section('the strings tables line up');
{
  const missing = Object.keys(en).filter((k) => !(k in fr));
  assert('every English key has a French translation', missing.length === 0,
    missing.join(', '));

  const extra = Object.keys(fr).filter((k) => !(k in en));
  assert('and French adds no key English does not have', extra.length === 0,
    extra.join(', '));

  assert('a missing key falls back to English rather than showing the key',
    t('app_print', 'nl') === en.app_print);
}

section('the app starts in French');
{
  localStorage.clear();
  const v = boot();
  const tabs = $$(v.container, '.tab-btn').map(textOf);
  assert('the tabs are French', tabs.includes(fr.app_tab_strategy) && tabs.includes(fr.app_tab_drivers),
    tabs.join(' | '));
  assert('FR is the active switch', textOf($(v.container, '.lang-btn.lang-active')) === 'FR');
  v.unmount();
}

section('clicking EN switches the whole app');
{
  localStorage.clear();
  const v = boot();
  click(langButton(v.container, 'EN'));

  const tabs = $$(v.container, '.tab-btn').map(textOf);
  assert('the tabs are English', tabs.includes(en.app_tab_strategy) && tabs.includes(en.app_tab_drivers),
    tabs.join(' | '));
  assert('EN is now the active switch', textOf($(v.container, '.lang-btn.lang-active')) === 'EN');

  // The empty state lives on the Strategy tab, which is not the landing tab.
  click($$(v.container, '.tab-btn').find((b) => textOf(b) === en.app_tab_strategy));

  const text = v.container.textContent;
  assert('the header retitled', text.includes(en.app_subtitle));
  assert('the sidebar retitled', text.includes(en.ip_calculate));
  assert('the empty state retitled', text.includes(en.app_empty_title));
  assert('the footer retitled', text.includes(en.app_footer));
  assert('no French is left in the shell',
    !text.includes(fr.app_tab_drivers) && !text.includes(fr.ip_calculate),
    text.slice(0, 200));

  assert('and the document language followed', document.documentElement.lang === 'en');
  v.unmount();
}

section('the choice survives a reload');
{
  localStorage.clear();
  const first = boot();
  click(langButton(first.container, 'EN'));
  assert('the choice was written to storage', localStorage.getItem(LANG_KEY) === 'en');
  first.unmount();

  const second = boot();
  assert('the app comes back in English',
    $$(second.container, '.tab-btn').map(textOf).includes(en.app_tab_strategy));
  second.unmount();
}

section('a junk stored language falls back instead of breaking the app');
{
  localStorage.clear();
  localStorage.setItem(LANG_KEY, 'klingon');
  const v = boot();
  assert('the app still starts, in French',
    $$(v.container, '.tab-btn').map(textOf).includes(fr.app_tab_strategy));
  v.unmount();
}

section('strings that come out of the pure engine are translatable too');
{
  // The engine speaks in ids and keeps English text for logs and the other
  // suites; anything shown on screen has to have a key on both sides.
  for (const c of TIRE_COMPOUNDS) {
    assert(`compound ${c.id} has a name in both languages`,
      !!en[`compound_${c.id}`] && !!fr[`compound_${c.id}`]);
    assert(`compound ${c.id} has a short name in both languages`,
      !!en[`compound_short_${c.id}`] && !!fr[`compound_short_${c.id}`]);
  }
  assert('and the French name is actually different from the English one',
    compoundName('S', 'fr') !== compoundName('S', 'en'),
    `${compoundName('S', 'fr')} vs ${compoundName('S', 'en')}`);

  // Picked up mid-race on an almost-empty tank, so the first stint cannot be
  // fuelled and a warning is guaranteed rather than hoped for.
  const thirsty = findBestStrategies({
    raceDurationHours: 2,
    tankSize: 60,
    lapsPerFullTank: 20,
    fuelMap: 1,
    compounds: [{ id: 'M', name: 'Medium', tireLife: 40, startLapTime: '1:00', halfLapTime: '1:01', endLapTime: '1:02' }],
    pitBaseSecs: 25,
    tireChangeSecs: 27,
    fuelRateLitersPerSec: 4,
    fuelWeightPenaltyPerLiter: 0.03,
    drivers: [],
    minDriverTimeSecs: 0,
    mandatoryStops: 0,
    midRaceMode: true,
    currentLap: 10,
    currentFuel: 1,
    currentCompoundId: 'M',
    currentTireAgeLaps: 5,
  });
  const stints = (thirsty[0]?.strategy.stints) || [];
  assert('the engine still labels a plan in English for logs and tests',
    typeof thirsty[0]?.label === 'string' && thirsty[0].label.includes('Medium'),
    String(thirsty[0]?.label));
  assert('and carries the sequence as ids so the UI can translate it',
    Array.isArray(thirsty[0]?.sequenceIds) && thirsty[0].sequenceIds.length > 0);
  assert('which renders in French',
    compoundSequence(thirsty[0].sequenceIds, 'fr').includes('Medium'));

  const warned = stints.filter((st) => st.warning);
  assert('this plan really does warn (so the next check is not vacuous)', warned.length > 0);
  assert('every engine warning carries a key', warned.every((st) => st.warningCode),
    warned.map((st) => st.warning).join(' | '));
  assert('and the key renders in French, not the English original',
    t(warned[0].warningCode, 'fr') !== warned[0].warning);
  for (const code of ['warn_fuel_exceeds_tank', 'warn_not_enough_fuel']) {
    assert(`${code} is translated in both languages`, !!en[code] && !!fr[code]);
  }

  // Learner recommendations: the pure layer hands over a key, not prose.
  const recs = buildRecommendations(
    {
      lapsPerFullTank: 22,
      trust: { fuel: { confident: true, sampleCount: 30, volatility: 0.2 } },
      compounds: {},
    },
    { lapsPerFullTank: 28, compounds: [] },
  );
  assert('a recommendation carries a translatable key', recs.length > 0 && !!recs[0].labelKey,
    JSON.stringify(recs[0] || null));
  assert('which resolves differently per language',
    t(recs[0].labelKey, 'fr') !== t(recs[0].labelKey, 'en'));
}

section('the engine-sourced strings reach the screen in the chosen language');
{
  localStorage.clear();
  const v = boot();
  click(langButton(v.container, 'EN'));
  click($$(v.container, '.tab-btn').find((b) => textOf(b) === en.app_tab_strategy));
  assert('the compound table is in English', v.container.textContent.includes(en.compound_S));

  click(langButton(v.container, 'FR'));
  assert('and flips to French with the switch', v.container.textContent.includes(fr.compound_S));
  assert('the default driver name was seeded in French',
    $(v.container, '.driver-name-input')?.value === t('driver_n', 'fr', { n: 1 }),
    $(v.container, '.driver-name-input')?.value);
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
