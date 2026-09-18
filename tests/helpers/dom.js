/**
 * Minimal DOM harness so the React components can actually be rendered and
 * driven in these tests, rather than only their underlying logic.
 *
 * Deliberately small: jsdom plus React's own `act`, no testing-library, no
 * test runner. The existing suites' hand-rolled assert/section style carries
 * over unchanged so the whole `npm test` output reads the same way.
 *
 * requestAnimationFrame is replaced with a manually stepped clock. The track
 * map's car dots move on an rAF loop and interpolate against timestamps, so
 * stepping frames by hand is the only way to test that motion deterministically
 * instead of sleeping and hoping.
 */

import { JSDOM } from 'jsdom';
import { act } from 'react';

let rafQueue = [];
let frameNow = 0;
let createRoot = null;

/**
 * Install a DOM, a controllable rAF, and the globals React expects.
 *
 * Async because react-dom inspects the document the moment it is imported —
 * if it loads first it decides the environment has no native `input` event and
 * permanently switches on an IE-era polyfill that calls `attachEvent`. So the
 * DOM has to exist before react-dom is pulled in, which means importing it
 * here rather than at the top of this file.
 */
export async function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: false,
  });

  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  // Node 22 defines globalThis.navigator as a getter-only property, so it has
  // to be replaced rather than assigned.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator, configurable: true, writable: true,
  });
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.SVGElement = window.SVGElement;
  globalThis.Event = window.Event;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);

  // React probes `'oninput' in document` to decide whether the native input
  // event exists. jsdom's Document does not expose it, so declare it.
  if (!('oninput' in window.document)) window.document.oninput = null;

  // React 19 refuses to run act() without this.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  rafQueue = [];
  frameNow = 0;
  const raf = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  const caf = () => {};
  globalThis.requestAnimationFrame = raf;
  globalThis.cancelAnimationFrame = caf;
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;

  ({ createRoot } = await import('react-dom/client'));

  return dom;
}

/**
 * Advance the animation clock by `count` frames. Each frame drains the queued
 * callbacks; the loops under test re-register themselves, so this drives them
 * exactly as a browser would, but at a time of our choosing.
 */
export function stepFrames(count = 1, dtMs = 1000 / 60) {
  for (let i = 0; i < count; i++) {
    frameNow += dtMs;
    const due = rafQueue;
    rafQueue = [];
    // Wrapped in act: these loops call setState (the map rebuilds its path
    // that way), and React warns and defers the update otherwise.
    act(() => {
      for (const cb of due) {
        try { cb(frameNow); } catch { /* a throwing loop is the test's problem, not the harness's */ }
      }
    });
  }
}

/**
 * The per-car dot groups inside an SVG.
 *
 * Deliberately checks DIRECT children: the dots live in a container <g>, and a
 * plain descendant query matches that container too, silently inflating every
 * count by one.
 */
export function carGroups(root) {
  return [...root.querySelectorAll('g')].filter((g) =>
    [...g.children].some((c) => c.tagName.toLowerCase() === 'circle'));
}

/** Current value of the stepped animation clock. */
export function frameClock() {
  return frameNow;
}

/** Mount an element into a fresh container. */
export function render(element) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });

  return {
    container,
    /** Re-render with new props. */
    update(next) { act(() => { root.render(next); }); },
    unmount() {
      act(() => { root.unmount(); });
      container.remove();
    },
  };
}

/** Fire a click the way a user would, inside act so effects settle. */
export function click(el) {
  act(() => {
    el.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Fire a double-click. */
export function doubleClick(el) {
  act(() => {
    el.dispatchEvent(new globalThis.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

/** Type into an input and press a key (React reads .value off the node). */
export function typeAndKey(input, value, key) {
  act(() => {
    // React installs its own value setter; go through the prototype so the
    // change is visible to it.
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value',
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
  if (key) {
    act(() => {
      input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }
}

/**
 * Blur an input (commits an inline rename).
 *
 * React's onBlur is wired to the bubbling `focusout`, not `blur` — dispatching
 * the latter looks right and silently does nothing.
 */
export function blur(input) {
  act(() => {
    const FocusEventCtor = globalThis.window.FocusEvent || globalThis.Event;
    input.dispatchEvent(new FocusEventCtor('focusout', { bubbles: true }));
  });
}

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => [...root.querySelectorAll(sel)];
export const textOf = (el) => (el ? el.textContent.trim() : null);

export { act };
