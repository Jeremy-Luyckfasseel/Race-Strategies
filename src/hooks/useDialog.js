import { useCallback, useRef, useState } from 'react';

/**
 * The app's own confirm/alert, in place of the browser's.
 *
 * `window.confirm` draws a grey box in the operating system's font with the
 * page's origin printed above it. On a dark pit-wall screen it is the only
 * thing in the app that does not look like the app, and — worse for this app
 * specifically — a modal dialog BLOCKS THE MAIN THREAD while it is open. The
 * relay is pushing packets at 20 Hz behind it, so every second somebody leaves
 * "Start the race now?" on screen is a second of telemetry queueing up.
 *
 * `ask` resolves true/false, `tell` resolves when acknowledged — so call sites
 * read the same as the `window.*` they replace, with an `await`.
 *
 * One dialog at a time, which is all a confirm ever needs; a second call while
 * one is open resolves the first as cancelled rather than losing its promise.
 */
export function useDialog() {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const open = useCallback((kind, opts) => new Promise((resolve) => {
    // Never strand a pending promise: a caller awaiting the old dialog would
    // hang forever, and with it whatever it was guarding.
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    setDialog({ kind, ...opts });
  }), []);

  /** Confirm. Resolves true only on an explicit yes. */
  const ask = useCallback((opts) => open('confirm', opts), [open]);

  /** Acknowledge-only. Resolves true when dismissed. */
  const tell = useCallback((opts) => open('alert', opts), [open]);

  const close = useCallback((ok) => {
    setDialog(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(ok);
  }, []);

  return { dialog, ask, tell, close };
}
