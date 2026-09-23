/**
 * Renders TelemetryLeaderboard for real and drives it the way a person would.
 *
 * Everything up to now proved the logic under the UI was right; this proves the
 * UI is actually wired to it — that the ★ really marks a team, that ✎ really
 * renames one, that a car's row colour really matches what the map will paint,
 * and that the gap column shows the new interval rather than the old nonsense.
 *
 * Run with: node tests/test_ui_leaderboard.js
 */

import { setupDom, render, click, doubleClick, typeAndKey, blur, $, $$, textOf } from './helpers/dom.js';

await setupDom();

const { default: TelemetryLeaderboard } = await import('../src/components/TelemetryLeaderboard.jsx');
const { teamColor } = await import('../src/logic/teams.js');
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

// ── A small field ───────────────────────────────────────────────────────────

const IPS = ['192.168.1.21', '192.168.1.22', '192.168.1.23', '192.168.1.24'];

const car = (over = {}) => ({
  currentLap: 10, speedKmh: 180, onTrack: true,
  fuelLiters: 40, fuelRatio: 0.4, lastLapMs: 121_000, bestLapMs: 119_500,
  racePos: 1, totalCars: 4, ...over,
});

const baseTeams = () => new Map([
  [IPS[0], car({ racePos: 1 })],
  [IPS[1], car({ racePos: 2, lastLapMs: 121_000 })],
  [IPS[2], car({ racePos: 3, onTrack: false })],
  [IPS[3], car({ racePos: 4, bestLapMs: 118_000 })],
]);

// Witnessed crossings: cars 2 s apart, all on the same lap.
const crossings = new Map(IPS.map((ip, i) => [
  ip, { lap: 10, crossedAt: 100_000 + i * 2000, witnessed: true },
]));

function mount(props = {}) {
  const calls = { setMyTeam: [], rename: [], select: [], compound: [] };
  const view = render(React.createElement(TelemetryLeaderboard, {
    teams: baseTeams(),
    teamOrder: [...IPS],
    teamLabels: {},
    teamCompounds: {},
    pendingIps: new Set(),
    selectedIp: '',
    lapCrossings: crossings,
    myTeamIp: '',
    onSelect: (ip) => calls.select.push(ip),
    onCompoundChange: (ip, c) => calls.compound.push([ip, c]),
    onSetMyTeam: (ip) => calls.setMyTeam.push(ip),
    onRenameTeam: (ip, name) => calls.rename.push([ip, name]),
    ...props,
  }));
  return { ...view, calls };
}

section('the field renders');
{
  const v = mount();
  const rows = $$(v.container, '.lb-row');
  assert('one row per car', rows.length === 4, `${rows.length}`);
  assert('an unnamed team falls back to its IP', textOf($(rows[0], '.lb-tname')) === IPS[0]);
  assert('a car in the pits is flagged BOX', $(rows[2], '.lb-box-pill') !== null);
  assert('a car on track is not', $(rows[0], '.lb-box-pill') === null);
  assert('the leader is labelled', textOf($(rows[0], '.lb-leader')) === 'LEADER');
  v.unmount();
}

section('team names — the thing that had no UI at all');
{
  const v = mount({ teamLabels: { [IPS[1]]: 'Scuderia Bob' } });
  const rows = $$(v.container, '.lb-row');
  assert('a named team shows its name', textOf($(rows[1], '.lb-tname')) === 'Scuderia Bob');

  // Rename via the pencil.
  click($(rows[0], '.lb-rename-btn'));
  const input = $(v.container, '.lb-tname-input');
  assert('the pencil opens an editable field', input !== null);
  typeAndKey(input, 'Night Shift Racing', 'Enter');
  assert('Enter commits the new name',
    JSON.stringify(v.calls.rename) === JSON.stringify([[IPS[0], 'Night Shift Racing']]),
    JSON.stringify(v.calls.rename));
  assert('and the field closes', $(v.container, '.lb-tname-input') === null);
  v.unmount();
}

section('rename — double-click, blur, escape, whitespace');
{
  const v = mount();
  const rows = () => $$(v.container, '.lb-row');

  doubleClick($(rows()[2], '.lb-tname'));
  assert('double-clicking the name also opens the editor', $(v.container, '.lb-tname-input') !== null);

  typeAndKey($(v.container, '.lb-tname-input'), 'Escaped');
  act_escape(v);
  assert('Escape abandons the edit without renaming', v.calls.rename.length === 0,
    JSON.stringify(v.calls.rename));
  assert('and closes the field', $(v.container, '.lb-tname-input') === null);

  click($(rows()[1], '.lb-rename-btn'));
  typeAndKey($(v.container, '.lb-tname-input'), '   Padded Name   ');
  blur($(v.container, '.lb-tname-input'));
  assert('blur commits too', v.calls.rename.length === 1);
  assert('and the name is trimmed', v.calls.rename[0][1] === 'Padded Name',
    JSON.stringify(v.calls.rename[0]));
  v.unmount();
}

function act_escape(v) {
  const input = $(v.container, '.lb-tname-input');
  typeAndKey(input, input.value, 'Escape');
}

section('my team — the ★');
{
  const v = mount();
  const rows = $$(v.container, '.lb-row');
  assert('every row offers the marker', $$(v.container, '.lb-mine-btn').length === 4);
  assert('nothing is marked to begin with', $$(v.container, '.lb-mine-btn.is-mine').length === 0);

  click($(rows[2], '.lb-mine-btn'));
  assert('clicking ★ nominates that car', JSON.stringify(v.calls.setMyTeam) === JSON.stringify([IPS[2]]));
  assert('and does NOT also select the row (the click stops there)',
    v.calls.select.length === 0, JSON.stringify(v.calls.select));
  v.unmount();
}

section('my team — how it looks once set');
{
  const v = mount({ myTeamIp: IPS[1] });
  const rows = $$(v.container, '.lb-row');
  assert('my row is highlighted', rows[1].className.includes('lb-row-mine'));
  assert('nobody else is', !rows[0].className.includes('lb-row-mine'));
  assert('my star is filled', $(rows[1], '.lb-mine-btn').className.includes('is-mine'));
  assert('my row is badged MOI', textOf($(rows[1], '.lb-mine-pill')) === 'MOI');
  assert('and no other row is', $$(v.container, '.lb-mine-pill').length === 1);
  v.unmount();
}

section('the name is actually legible, not squeezed to nothing');
{
  // Regression: the ★ and ✎ once squeezed .lb-tname to width 0 in the narrow
  // telemetry column, so every row showed a colour stripe and no name at all.
  // jsdom does no real layout, so this checks the structural causes rather
  // than pixels: the name must be present, carry its text, and not be the
  // element that gets dropped when space is tight.
  const v = mount({
    teamLabels: {
      [IPS[0]]: 'Night Shift Racing',
      [IPS[1]]: 'Écurie Bleu Nuit',
      [IPS[2]]: 'T',
    },
  });
  const names = $$(v.container, '.lb-tname').map((n) => n.textContent);
  assert('a long team name is rendered in full, not truncated in the DOM',
    names[0] === 'Night Shift Racing', JSON.stringify(names));
  assert('accents and spaces survive', names[1] === 'Écurie Bleu Nuit', names[1]);
  assert('a one-character name still renders', names[2] === 'T');

  // Every row must keep a name element even with star, badge and BOX pill.
  const mine = mount({
    myTeamIp: IPS[2],
    teamLabels: { [IPS[2]]: 'Night Shift Racing' },
  });
  const crowded = $$(mine.container, '.lb-row')[2];
  assert('the busiest row (★ + MOI + BOX) still carries its name',
    textOf($(crowded, '.lb-tname')) === 'Night Shift Racing',
    textOf($(crowded, '.lb-tname')));
  assert('and the badges that crowd it are all present',
    $(crowded, '.lb-mine-pill') !== null && $(crowded, '.lb-box-pill') !== null);
  mine.unmount();
  v.unmount();
}

section('the narrow column still shows the last lap and the fuel');
{
  // The narrow telemetry column has no room for the DERNIER / MEILLEUR / CARBU
  // columns, so those cells are hidden by CSS there and the two numbers worth
  // keeping ride under the team name instead. CSS cannot be asserted from
  // jsdom, but the markup it depends on can: if this line ever goes away, the
  // narrow column silently loses the lap time and the fuel reading entirely.
  const v = mount();
  const rows = $$(v.container, '.lb-row');
  assert('every row carries the meta line', $$(v.container, '.lb-meta').length === 4);
  assert('it holds the fuel bar', $($$(v.container, '.lb-meta')[0], '.lb-inline-fuel') !== null);
  assert('the last lap is there, formatted',
    textOf($(rows[0], '.lb-meta-lap')) === '2:01.000', textOf($(rows[0], '.lb-meta-lap')));
  assert('and the fuel in litres', textOf($(rows[0], '.lb-meta-fuel')) === '40L',
    textOf($(rows[0], '.lb-meta-fuel')));

  // Same numbers as the wide columns — one source, two placements.
  assert('it agrees with the DERNIER column',
    textOf($(rows[0], '.lb-meta-lap')) === textOf($(rows[0], '.lbc-last')));

  const blank = mount({
    teams: new Map([[IPS[0], car({ racePos: 1, lastLapMs: 0, fuelLiters: null })]]),
    teamOrder: [IPS[0]],
  });
  assert('a car with no lap yet shows a placeholder, not NaN',
    textOf($(blank.container, '.lb-meta-lap')) === '—',
    textOf($(blank.container, '.lb-meta-lap')));
  assert('and unknown fuel too', textOf($(blank.container, '.lb-meta-fuel')) === '—');
  blank.unmount();
  v.unmount();
}

section('colours match what the map will paint');
{
  const v = mount();
  const stripes = $$(v.container, '.lb-stripe');
  const shown = stripes.map((s) => s.style.background.trim().toLowerCase());
  const expected = IPS.map((ip, i) => teamColor(i).toLowerCase());

  assert('each row is coloured by first-seen order, matching teamColor',
    shown.every((c, i) => c === expected[i] || c === hexToRgb(expected[i])),
    `${JSON.stringify(shown)} vs ${JSON.stringify(expected)}`);
  assert('all four differ', new Set(shown).size === 4, JSON.stringify(shown));

  // Re-render with the running order reversed. Colour is keyed to teamOrder,
  // not position, so the same car must keep the same colour.
  const reordered = new Map([
    [IPS[3], car({ racePos: 1 })],
    [IPS[2], car({ racePos: 2, onTrack: false })],
    [IPS[1], car({ racePos: 3 })],
    [IPS[0], car({ racePos: 4 })],
  ]);
  v.update(React.createElement(TelemetryLeaderboard, {
    teams: reordered, teamOrder: [...IPS], teamLabels: {}, teamCompounds: {},
    pendingIps: new Set(), selectedIp: '', lapCrossings: crossings, myTeamIp: '',
    onSelect: () => {}, onCompoundChange: () => {}, onSetMyTeam: () => {}, onRenameTeam: () => {},
  }));

  const afterRows = $$(v.container, '.lb-row');
  const leaderNow = textOf($(afterRows[0], '.lb-tname'));
  assert('the order really did change', leaderNow === IPS[3], leaderNow);
  const leaderColour = $(afterRows[0], '.lb-stripe').style.background.trim().toLowerCase();
  const car3Colour = teamColor(3).toLowerCase();
  assert('a car that took the lead kept its own colour',
    leaderColour === car3Colour || leaderColour === hexToRgb(car3Colour),
    `${leaderColour} vs ${car3Colour}`);
  v.unmount();
}

function hexToRgb(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

section('the gap column shows a real interval');
{
  const v = mount();
  const gaps = $$(v.container, '.lb-row').map((r) => textOf($(r, '.lbc-gap')));
  assert('the leader says LEADER', gaps[0] === 'LEADER');
  assert('second is 2.0s back', gaps[1] === '+2.0s', gaps[1]);
  assert('third is 2.0s further back', gaps[2] === '+2.0s', gaps[2]);
  v.unmount();
}

section('the gap column stays silent when it cannot know');
{
  // Every car seen for the first time this instant — the mid-race-join case
  // that used to render a field of near-zero gaps.
  const firstSighting = new Map(IPS.map((ip) => [ip, { lap: 10, crossedAt: 500_000, witnessed: false }]));
  const v = mount({ lapCrossings: firstSighting });
  const gaps = $$(v.container, '.lb-row').map((r) => textOf($(r, '.lbc-gap')));
  assert('no fictitious dead heat is drawn', gaps.slice(1).every((g) => g === '—'),
    JSON.stringify(gaps));
  v.unmount();
}

section('lap times and the purple best');
{
  const v = mount();
  const rows = $$(v.container, '.lb-row');
  assert('last lap is formatted', textOf($(rows[0], '.lbc-last')) === '2:01.000',
    textOf($(rows[0], '.lbc-last')));
  const purple = $$(v.container, '.lb-purple');
  assert('exactly one car holds the overall best lap', purple.length === 1, `${purple.length}`);
  assert('and it is the car that actually set it',
    $(rows[3], '.lbc-best').className.includes('lb-purple'));
  v.unmount();
}

section('selection and the compound picker still work');
{
  const v = mount();
  const rows = $$(v.container, '.lb-row');
  click(rows[1]);
  assert('clicking a row selects that car', JSON.stringify(v.calls.select) === JSON.stringify([IPS[1]]));

  click($(rows[0], '.lb-tyre'));
  assert('the tyre button opens a picker', $(v.container, '.lb-picker') !== null);
  const soft = $$(v.container, '.lb-cp').find((b) => textOf($(b, '.lb-cp-letter')) === 'S');
  click(soft);
  assert('choosing a compound reports it',
    JSON.stringify(v.calls.compound) === JSON.stringify([[IPS[0], 'S']]),
    JSON.stringify(v.calls.compound));
  assert('and the picker closes', $(v.container, '.lb-picker') === null);
  v.unmount();
}

section('a pending compound confirmation is surfaced');
{
  const v = mount({ pendingIps: new Set([IPS[2]]) });
  const rows = $$(v.container, '.lb-row');
  assert('the waiting car\'s tyre button is flagged',
    $(rows[2], '.lb-tyre').className.includes('lb-tyre-pending'));
  assert('others are not', !$(rows[0], '.lb-tyre').className.includes('lb-tyre-pending'));
  v.unmount();
}

section('a twelve-car field renders without incident');
{
  const many = Array.from({ length: 12 }, (_, i) => `10.0.0.${i + 1}`);
  const teams = new Map(many.map((ip, i) => [ip, car({ racePos: i + 1 })]));
  const v = render(React.createElement(TelemetryLeaderboard, {
    teams, teamOrder: many, teamLabels: {}, teamCompounds: {},
    pendingIps: new Set(), selectedIp: '',
    lapCrossings: new Map(many.map((ip, i) => [ip, { lap: 9, crossedAt: i * 1000, witnessed: true }])),
    myTeamIp: many[5],
    onSelect: () => {}, onCompoundChange: () => {}, onSetMyTeam: () => {}, onRenameTeam: () => {},
  }));
  assert('twelve rows', $$(v.container, '.lb-row').length === 12);
  assert('twelve distinct colours',
    new Set($$(v.container, '.lb-stripe').map((s) => s.style.background)).size === 12);
  assert('exactly one MOI badge in the field', $$(v.container, '.lb-mine-pill').length === 1);
  v.unmount();
}

section('following the rivals I race');
{
  const toggled = [];
  // Rows are in race order; the row for a car is found by its name cell.
  const rowFor = (v, ip) => $$(v.container, '.lb-row').find((r) => r.textContent.includes(ip));

  const none = mount({ myTeamIp: IPS[0], followed: new Set(), onToggleFollow: (ip) => toggled.push(ip) });
  assert('every rival has a follow button', $$(none.container, '.lb-follow-btn').length === 3,
    String($$(none.container, '.lb-follow-btn').length));
  assert('but my own car does not', !rowFor(none, IPS[0]).querySelector('.lb-follow-btn'));
  assert('with nobody followed, nobody is dimmed', $$(none.container, '.lb-row-quiet').length === 0);
  click(rowFor(none, IPS[2]).querySelector('.lb-follow-btn'));
  assert('clicking it follows that car', toggled.join() === IPS[2], toggled.join());
  assert('without selecting the row', none.calls.select.length === 0, none.calls.select.join());
  none.unmount();

  const some = mount({ myTeamIp: IPS[0], followed: new Set([IPS[2]]), onToggleFollow: () => {} });
  assert('a followed car shows it', rowFor(some, IPS[2]).querySelector('.lb-follow-btn.is-on') !== null);
  assert('the cars not followed step back', $$(some.container, '.lb-row-quiet').length === 2,
    String($$(some.container, '.lb-row-quiet').length));
  assert('mine never does', !rowFor(some, IPS[0]).className.includes('lb-row-quiet'));
  some.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
