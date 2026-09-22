/**
 * Recording the circuit, from every car at once.
 *
 * The existing track-map suite renders a map that was already built. This one
 * drives the recorder itself, which nothing covered — and which now has to cope
 * with a whole field writing into one shared grid.
 *
 * Two things matter and neither is visible in the output picture unless you go
 * looking: that two cars' traces are NOT welded into one line (they are drawn
 * as connected polylines, so a shared "last segment" would draw a stroke from
 * one car straight to the other), and that only MY car's pit entry is allowed
 * to clear MY tyre.
 *
 * Run with: node --import ./tests/helpers/register-jsx.mjs tests/test_ui_trackmap_record.js
 */

import { setupDom, render, stepFrames, act } from './helpers/dom.js';

await setupDom();

const { useTrackMap } = await import('../src/hooks/useTrackMap.js');
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

const MINE = '10.0.0.1';
const RIVAL = '10.0.0.2';

/** A car on track at racing speed, at this position. */
const car = (x, z, over = {}) => ({
  posX: x, posZ: z, onTrack: true, speedKmh: 150, currentLap: 3, ...over,
});

/**
 * Renders the hook and lets the test push a new field into it frame by frame.
 * The hook reads its inputs from an effect, so each feed is a real re-render.
 */
function harness(strategyIp, onPitEntry) {
  const box = { mapRef: null, view: null };
  function Probe({ teams }) {
    const { mapRef, resetMap } = useTrackMap(teams, strategyIp, onPitEntry);
    box.mapRef = mapRef;
    box.resetMap = resetMap;
    return null;
  }
  box.feed = (teams) => {
    act(() => { box.view.update(React.createElement(Probe, { teams })); });
    stepFrames(1);
  };
  box.view = render(React.createElement(Probe, { teams: new Map() }));
  return box;
}

// ────────────────────────────────────────────────────────────────────────────

section('one car lays down a line');
{
  localStorage.clear();
  const h = harness(MINE, () => {});
  for (let i = 0; i < 6; i++) h.feed(new Map([[MINE, car(i * 10, 0)]]));

  const m = h.mapRef.current;
  assert('cells were recorded', m.cells.size >= 5, `${m.cells.size} cells`);
  const drawn = m.segs.filter((s) => s.length > 1);
  assert('as one continuous segment', drawn.length === 1, `${drawn.length} segments`);
  assert('bounds cover the run', m.bounds && m.bounds.maxX >= 50, JSON.stringify(m.bounds));
  h.view.unmount();
}

section('a second car does not join the first one\'s line');
{
  localStorage.clear();
  const h = harness(MINE, () => {});
  // Two cars on parallel lines 40 m apart, recorded on the same frames.
  for (let i = 0; i < 6; i++) {
    h.feed(new Map([
      [MINE, car(i * 10, 0)],
      [RIVAL, car(i * 10, 40)],
    ]));
  }

  const m = h.mapRef.current;
  const drawn = m.segs.filter((s) => s.length > 1);
  assert('both cars contributed cells', m.cells.size >= 10, `${m.cells.size} cells`);
  assert('and each kept its own segment', drawn.length === 2, `${drawn.length} segments`);

  // The giveaway for welding: a segment whose points jump between the lanes.
  const mixed = drawn.some((seg) => {
    const zs = new Set(seg.map((p) => Math.round(p.z / 40)));
    return zs.size > 1;
  });
  assert('no segment strays between the two cars', !mixed);
  h.view.unmount();
}

section('cars on the same line cost nothing extra');
{
  localStorage.clear();
  const solo = harness(MINE, () => {});
  for (let i = 0; i < 6; i++) solo.feed(new Map([[MINE, car(i * 10, 0)]]));
  const soloCells = solo.mapRef.current.cells.size;
  solo.view.unmount();

  localStorage.clear();
  const pair = harness(MINE, () => {});
  for (let i = 0; i < 6; i++) {
    pair.feed(new Map([[MINE, car(i * 10, 0)], [RIVAL, car(i * 10, 0)]]));
  }
  const pairCells = pair.mapRef.current.cells.size;
  pair.view.unmount();

  assert('a second car on the identical line adds no cells',
    pairCells === soloCells, `${soloCells} alone vs ${pairCells} together`);
}

section('a car that goes away stops being tracked, but its line stays');
{
  localStorage.clear();
  const h = harness(MINE, () => {});
  for (let i = 0; i < 4; i++) {
    h.feed(new Map([[MINE, car(i * 10, 0)], [RIVAL, car(i * 10, 40)]]));
  }
  const before = h.mapRef.current.segs.filter((s) => s.length > 1).length;
  assert('two lines drawn', before === 2, String(before));

  // The rival disconnects.
  for (let i = 4; i < 7; i++) h.feed(new Map([[MINE, car(i * 10, 0)]]));
  const m = h.mapRef.current;
  assert('its recording state is dropped', !m.cars.has(RIVAL));
  assert('but its line is still on the map',
    m.segs.filter((s) => s.length > 1).length === 2);
  h.view.unmount();
}

section('only my own pit entry clears my tyre');
{
  localStorage.clear();
  let mineEntered = 0;
  const h = harness(MINE, () => { mineEntered += 1; });

  // Teach the map where the pit box is, then drive both cars into it.
  h.feed(new Map([[MINE, car(0, 0)]]));
  h.mapRef.current.pitLane = { pts: [], box: { x: 500, z: 500 } };

  h.feed(new Map([[RIVAL, car(500, 500, { speedKmh: 5 })]]));
  assert('a rival boxing does not touch my compound', mineEntered === 0, String(mineEntered));

  h.feed(new Map([[MINE, car(500, 500, { speedKmh: 5 })]]));
  assert('my own car boxing does', mineEntered === 1, String(mineEntered));

  // Still inside the zone on the next frame: an entry is an edge, not a state.
  h.feed(new Map([[MINE, car(501, 501, { speedKmh: 5 })]]));
  assert('and only once per entry', mineEntered === 1, String(mineEntered));
  h.view.unmount();
}

section('resetting clears the field, not just one car');
{
  localStorage.clear();
  const h = harness(MINE, () => {});
  for (let i = 0; i < 4; i++) {
    h.feed(new Map([[MINE, car(i * 10, 0)], [RIVAL, car(i * 10, 40)]]));
  }
  assert('something was recorded', h.mapRef.current.cells.size > 0);

  act(() => { h.resetMap(); });
  const m = h.mapRef.current;
  assert('cells are gone', m.cells.size === 0);
  assert('segments are gone', m.segs.length === 1 && m.segs[0].length === 0);
  assert('bounds are gone', m.bounds === null);
  assert('and no car keeps stale recording state', m.cars.size === 0);
  h.view.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
