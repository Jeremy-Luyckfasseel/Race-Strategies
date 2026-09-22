import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Things that happened while you were looking somewhere else.
 *
 * The app already worked out that a rival had boxed, or that the measured fuel
 * range disagreed with the plan — and then put the answer in a panel, waiting
 * for someone to look at it. On a screen this dense, "it is on the screen" is
 * not the same as "you saw it": the recommendation card is above the fold on
 * one tab, the pit prompt is inside a column of the car panel.
 *
 * A toast is the notice, not the place the work happens. Acting on one takes
 * you to where the control already lives (the compound and driver pickers on
 * that car's dashboard) rather than duplicating those controls into a corner
 * of the screen where a mis-tap costs you a stint's worth of wrong data.
 *
 * Deliberately NOT a queue of everything: only what is still true and still
 * actionable. A pit notice that has been answered is gone, not archived.
 */

/** How long a notice stays up on its own. Long enough to read twice. */
export const TOAST_MS = 12_000;

/** Above this the stack is scrolling wallpaper rather than a notice. */
const MAX_TOASTS = 4;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  /**
   * Raise a notice. `key` makes it idempotent: the same event arriving twice
   * (a re-render, a second packet on the same edge) must not stack two
   * identical cards, and a fresher version of the same event replaces the old
   * one rather than queueing behind it.
   */
  const push = useCallback((toast) => {
    const id = toast.key ?? `t${Date.now()}${Math.random()}`;
    // Drop any countdown the previous copy was running. The effect below only
    // starts a timer for an id that has none, so without this a refreshed
    // toast kept the ORIGINAL copy's timer and vanished on its schedule — new
    // information on screen for whatever was left of the old window, which is
    // the opposite of what a refresh is for.
    const running = timers.current.get(id);
    if (running) {
      clearTimeout(running);
      timers.current.delete(id);
    }
    setToasts((prev) => {
      const without = prev.filter((x) => x.id !== id);
      return [...without, { ...toast, id }].slice(-MAX_TOASTS);
    });
  }, []);

  // One timer per live toast, cleared on unmount. A toast that is replaced by a
  // fresher copy of itself gets a fresh countdown because `push` clears the old
  // timer first; this loop then sees an id with none and starts one.
  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      // Sticky ones wait for an answer: a pit stop needs a tyre either way.
      if (toast.sticky) continue;
      timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), TOAST_MS));
    }
    for (const [id, timer] of timers.current) {
      if (!toasts.some((x) => x.id === id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [toasts, dismiss]);

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}
