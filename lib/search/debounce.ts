/**
 * A one-timer debouncer, extracted so the part with the actual rules in it can be
 * tested. Nothing in this repo debounced anything before search-as-you-type, and
 * a hook cannot be exercised under `environment: "node"`, so the logic lives here
 * and `hooks/use-filter-params.ts` holds only the React wiring around it.
 *
 * Deliberately not generic over arguments: the caller passes a fresh closure each
 * time and the last one wins, which is exactly what a search box wants — it never
 * needs to replay a keystroke, only to act on the final state of the box.
 */
export interface Debouncer {
  /** Runs `run` after the delay, replacing whatever was already waiting. */
  schedule(run: () => void): void;
  /** Drops a waiting run. Safe to call when nothing is waiting. */
  cancel(): void;
  /** Whether a run is waiting. For tests and for "is a write still owed?". */
  isPending(): boolean;
}

export function createDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    schedule(run) {
      // Replace rather than queue. Two pending writes would mean two navigations
      // for one word typed, and the earlier one would land with a stale value.
      cancel();
      timer = setTimeout(() => {
        // Cleared before running, so a `cancel()` from inside `run` — or an
        // `isPending()` read during it — sees the truth.
        timer = null;
        run();
      }, delayMs);
    },
    cancel,
    isPending() {
      return timer !== null;
    },
  };
}
