/**
 * Renders the real TrackMap and steps its animation loop frame by frame.
 *
 * This is the riskiest code in the UI to change blind: the car dots are built
 * with raw createElementNS and moved by writing transform attributes from
 * inside a requestAnimationFrame loop, entirely outside React's knowledge. A
 * mistake there produces no error and no failing logic test — the dots simply
 * stop being right, and you would only find out at an event.
 *
 * The harness replaces rAF with a hand-stepped clock, so the interpolation can
 * be driven deterministically rather than slept through.
 *
 * Run with: node tests/test_ui_trackmap.js
 */

import { setupDom, render, stepFrames, carGroups, $$ } from './helpers/dom.js';

await setupDom();

const { TrackMap } = await import('../src/components/LiveDashboard.jsx');
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

/** A recorded track: a closed square loop, as useTrackMap would have built it. */
function trackMapRef() {
  const pts = [];
  const SIDE = 400;
  for (let i = 0; i <= 40; i++) pts.push({ x: (SIDE * i) / 40, z: 0 });
  for (let i = 1; i <= 40; i++) pts.push({ x: SIDE, z: (SIDE * i) / 40 });
  for (let i = 1; i <= 40; i++) pts.push({ x: SIDE - (SIDE * i) / 40, z: SIDE });
  for (let i = 1; i <= 40; i++) pts.push({ x: 0, z: SIDE - (SIDE * i) / 40 });
  return {
    current: {
      segs: [pts],
      cells: new Map(),
      pitLane: null,
      bounds: { minX: 0, maxX: SIDE, minZ: 0, maxZ: SIDE },
      pathsLap: -1,
      dirty: true,
      lastPkt: null, lastRec: null, slowBuf: [], slowStart: null, inPit: false,
    },
  };
}

const mkCars = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({
    id: `10.0.0.${i + 1}`,
    label: `C${i + 1}`,
    posX: 20 + i * 15,
    posZ: 0,
    onTrack: true,
    isOwn: false,
    color: teamColor(i),
    ...over(i),
  }));

function mountMap(cars, mapRef = trackMapRef()) {
  const view = render(React.createElement(TrackMap, {
    currentLap: 5, cars, mapRef, onReset: () => {},
  }));
  // TrackMap throttles its path rebuild to once per 100 ms of animation clock,
  // so fewer than ~7 frames leaves the circuit undrawn.
  stepFrames(10);
  return { ...view, mapRef };
}

section('the circuit is drawn from recorded GPS');
{
  const v = mountMap(mkCars(3));
  const paths = $$(v.container, 'path');
  assert('a track path is rendered', paths.length >= 1, `${paths.length}`);
  const d = paths[0]?.getAttribute('d') ?? '';
  assert('the path has real geometry', d.length > 50 && d.startsWith('M'), d.slice(0, 40));
  assert('the "drive a lap" placeholder is gone', !/CONDUISEZ/.test(v.container.textContent));
  v.unmount();
}

section('every car in the field gets a dot');
{
  for (const n of [1, 5, 10, 14]) {
    const v = mountMap(mkCars(n));
    const dots = $$(v.container, 'circle');
    assert(`${n} cars produce at least ${n} dots`, dots.length >= n, `${dots.length} circles`);
    const labels = $$(v.container, 'text').map((t) => t.textContent);
    assert(`  and ${n} labels`, labels.filter((l) => /^C\d+$/.test(l)).length === n,
      JSON.stringify(labels));
    v.unmount();
  }
}

section('dots carry each car\'s own colour');
{
  const cars = mkCars(6);
  const v = mountMap(cars);
  const fills = $$(v.container, 'circle').map((c) => c.getAttribute('fill'));
  for (const c of cars) {
    assert(`car ${c.label} is painted ${c.color}`, fills.includes(c.color),
      JSON.stringify(fills));
  }
  assert('and the colours are all different', new Set(fills).size >= 6, JSON.stringify(fills));
  v.unmount();
}

section('my car is marked out without losing its identity');
{
  const cars = mkCars(4, (i) => (i === 2 ? { isOwn: true } : {}));
  const v = mountMap(cars);
  const mineColour = cars[2].color;

  const groups = carGroups(v.container);
  const mineGroup = groups.find((g) =>
    [...g.querySelectorAll('circle')].some((c) => c.getAttribute('fill') === mineColour));
  assert('my car is on the map', mineGroup != null);
  assert('and is drawn with a halo the others do not have',
    mineGroup.querySelectorAll('circle').length === 2,
    `${mineGroup?.querySelectorAll('circle').length} circles`);

  const others = groups.filter((g) => g !== mineGroup);
  assert('every other car is a single dot',
    others.every((g) => g.querySelectorAll('circle').length === 1));
  assert('my halo uses my own team colour, not a fixed blue',
    mineGroup.querySelector('circle').getAttribute('fill') === mineColour,
    mineGroup.querySelector('circle').getAttribute('fill'));
  v.unmount();
}

section('boxed cars stay visible, dimmed');
{
  const cars = mkCars(4, (i) => (i === 1 ? { onTrack: false } : {}));
  const v = mountMap(cars);
  const groups = carGroups(v.container);
  assert('the boxed car is still on the map', groups.length === 4, `${groups.length}`);

  const opacities = groups.map((g) => g.getAttribute('opacity'));
  assert('exactly one car is dimmed', opacities.filter((o) => o === '0.35').length === 1,
    JSON.stringify(opacities));
  assert('the rest are at full strength',
    opacities.filter((o) => o === '1').length === 3, JSON.stringify(opacities));
  v.unmount();
}

section('labels are readable at full-grid density');
{
  const cars = mkCars(12, () => ({ posX: 200, posZ: 200 }));   // all on the same spot
  const v = mountMap(cars);
  const texts = $$(v.container, 'text').filter((t) => /^C\d+$/.test(t.textContent));
  assert('twelve stacked cars still render twelve tags', texts.length === 12);
  assert('each tag is short', texts.every((t) => t.textContent.length <= 3),
    JSON.stringify(texts.map((t) => t.textContent)));
  assert('and is outlined so it reads over the track and other dots',
    texts.every((t) => t.getAttribute('paint-order') === 'stroke' && t.getAttribute('stroke')));
  v.unmount();
}

section('dots actually move, and smoothly');
{
  const cars = mkCars(1);
  const mapRef = trackMapRef();
  const view = render(React.createElement(TrackMap, {
    currentLap: 1, cars, mapRef, onReset: () => {},
  }));

  const posOf = () => {
    const g = carGroups(view.container)[0];
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g?.getAttribute('transform') ?? '');
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
  };

  stepFrames(10);
  const start = posOf();
  assert('the car is placed on the map', start !== null, 'no transform');

  // Walk the car along the top straight, updating props at 20 Hz (one state
  // update every ~3 frames) exactly as the flush does, while stepping frames
  // at 60 Hz. The dot should advance on frames in between, not jump every 3rd.
  const samples = [];
  for (let step = 1; step <= 12; step++) {
    view.update(React.createElement(TrackMap, {
      currentLap: 1,
      cars: [{ ...cars[0], posX: 20 + step * 12 }],
      mapRef,
      onReset: () => {},
    }));
    for (let f = 0; f < 3; f++) {
      stepFrames(1);
      const p = posOf();
      if (p) samples.push(p.x);
    }
  }

  const moved = samples[samples.length - 1] - samples[0];
  assert('the dot travelled across the map', moved > 5, `moved ${moved.toFixed(1)}px`);

  const deltas = [];
  for (let i = 1; i < samples.length; i++) deltas.push(samples[i] - samples[i - 1]);
  const movingFrames = deltas.filter((d) => Math.abs(d) > 0.001).length;
  assert('it advances on intermediate frames, not only when data arrives',
    movingFrames > deltas.length / 2, `${movingFrames}/${deltas.length} frames moved`);

  assert('and never jumps backwards', deltas.every((d) => d >= -0.01),
    JSON.stringify(deltas.map((d) => +d.toFixed(2))));

  const maxStep = Math.max(...deltas.map(Math.abs));
  const medianStep = [...deltas.map(Math.abs)].sort((x, y) => x - y)[Math.floor(deltas.length / 2)];
  assert('no single frame lurches far beyond the typical step',
    maxStep < medianStep * 6 + 1, `max ${maxStep.toFixed(2)} vs median ${medianStep.toFixed(2)}`);
  view.unmount();
}

section('a car leaving the field takes its dot with it');
{
  const cars = mkCars(4);
  const mapRef = trackMapRef();
  const view = render(React.createElement(TrackMap, {
    currentLap: 1, cars, mapRef, onReset: () => {},
  }));
  stepFrames(4);
  assert('four dots to begin with',
    carGroups(view.container).length === 4);

  view.update(React.createElement(TrackMap, {
    currentLap: 1, cars: cars.slice(0, 2), mapRef, onReset: () => {},
  }));
  stepFrames(4);
  assert('two remain after two retire',
    carGroups(view.container).length === 2);
  view.unmount();
}

section('an empty map says so instead of drawing nothing');
{
  const blank = {
    current: {
      segs: [[]], cells: new Map(), pitLane: null, bounds: null,
      pathsLap: -1, dirty: true, lastPkt: null, lastRec: null,
      slowBuf: [], slowStart: null, inPit: false,
    },
  };
  const v = render(React.createElement(TrackMap, {
    currentLap: 0, cars: mkCars(3), mapRef: blank, onReset: () => {},
  }));
  stepFrames(4);
  assert('the prompt to drive a lap is shown', /CONDUISEZ/.test(v.container.textContent));
  v.unmount();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
