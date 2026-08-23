import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncer } from "./debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncer", () => {
  it("waits the delay out before running", () => {
    const run = vi.fn();
    createDebouncer(250).schedule(run);

    vi.advanceTimersByTime(249);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps only the last of a run of calls", () => {
    // Someone typing "cruz" gets one URL write, carrying "cruz" — not four
    // writes, and not "c".
    const debouncer = createDebouncer(250);
    const calls: string[] = [];

    for (const value of ["c", "cr", "cru", "cruz"]) {
      debouncer.schedule(() => calls.push(value));
      vi.advanceTimersByTime(50);
    }

    expect(calls).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(calls).toEqual(["cruz"]);
  });

  it("runs again after a pause, which is what a second search is", () => {
    const debouncer = createDebouncer(250);
    const run = vi.fn();

    debouncer.schedule(run);
    vi.advanceTimersByTime(250);
    debouncer.schedule(run);
    vi.advanceTimersByTime(250);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops a waiting run when cancelled", () => {
    // This is the unmount case: a filter bar that has left the page must not
    // navigate 250ms later.
    const debouncer = createDebouncer(250);
    const run = vi.fn();

    debouncer.schedule(run);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });

  it("survives a cancel with nothing waiting, and a second cancel", () => {
    const debouncer = createDebouncer(250);
    const run = vi.fn();

    expect(() => debouncer.cancel()).not.toThrow();
    debouncer.schedule(run);
    debouncer.cancel();
    expect(() => debouncer.cancel()).not.toThrow();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });

  it("can be scheduled again after being cancelled", () => {
    const debouncer = createDebouncer(250);
    const run = vi.fn();

    debouncer.schedule(run);
    debouncer.cancel();
    debouncer.schedule(run);
    vi.advanceTimersByTime(250);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports whether a write is still owed", () => {
    const debouncer = createDebouncer(250);

    expect(debouncer.isPending()).toBe(false);
    debouncer.schedule(() => {});
    expect(debouncer.isPending()).toBe(true);
    vi.advanceTimersByTime(250);
    expect(debouncer.isPending()).toBe(false);
  });

  it("is no longer pending by the time the run itself looks", () => {
    const debouncer = createDebouncer(250);
    let pendingDuringRun: boolean | null = null;

    debouncer.schedule(() => {
      pendingDuringRun = debouncer.isPending();
    });
    vi.advanceTimersByTime(250);

    expect(pendingDuringRun).toBe(false);
  });
});
