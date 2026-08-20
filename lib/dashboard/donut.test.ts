import { describe, expect, it } from "vitest";

import { donutGeometry, type DonutInput } from "./donut";

function slice(key: string, value: number): DonutInput {
  return { key, value, colorVar: `--color-chart-${key}` };
}

// size 200, thickness 20 -> radius 90, circumference 2π·90
const OPTS = { size: 200, thickness: 20 };
const CIRCUMFERENCE = 2 * Math.PI * 90;

describe("donutGeometry", () => {
  it("derives the ring from size and thickness", () => {
    const ring = donutGeometry([slice("1", 1)], OPTS);
    expect(ring.radius).toBeCloseTo(90);
    expect(ring.center).toBe(100);
    expect(ring.circumference).toBeCloseTo(CIRCUMFERENCE);
    expect(ring.thickness).toBe(20);
    expect(ring.size).toBe(200);
  });

  it("gives a lone slice the whole ring and no gap", () => {
    const ring = donutGeometry([slice("1", 7)], OPTS);
    expect(ring.segments).toHaveLength(1);
    expect(ring.segments[0].lengthPx).toBeCloseTo(CIRCUMFERENCE);
    expect(ring.segments[0].dashOffset).toBe(0);
  });

  it("splits two equal slices in half, less one gap each", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 5)], { ...OPTS, gap: 2 });
    const half = CIRCUMFERENCE / 2;
    expect(ring.segments[0].lengthPx).toBeCloseTo(half - 2);
    expect(ring.segments[1].lengthPx).toBeCloseTo(half - 2);
  });

  it("offsets each slice by the full span of the ones before it", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 3), slice("3", 2)], {
      ...OPTS,
      gap: 2,
    });
    expect(ring.segments[0].dashOffset).toBe(0);
    expect(ring.segments[1].dashOffset).toBeCloseTo(-CIRCUMFERENCE * 0.5);
    expect(ring.segments[2].dashOffset).toBeCloseTo(-CIRCUMFERENCE * 0.8);
  });

  it("keeps the gaps out of the total, so the arcs still fill the ring", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 3), slice("3", 2)], {
      ...OPTS,
      gap: 2,
    });
    const drawn = ring.segments.reduce((sum, s) => sum + s.lengthPx, 0);
    expect(drawn).toBeCloseTo(CIRCUMFERENCE - 3 * 2);
  });

  it("writes dashArray as the visible length then the remainder", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 5)], { ...OPTS, gap: 2 });
    const { lengthPx, dashArray } = ring.segments[0];
    expect(dashArray).toBe(`${lengthPx} ${CIRCUMFERENCE - lengthPx}`);
  });

  it("keeps a slice too small to draw visible", () => {
    // 1 of 400 on this ring is ~1.4px, and 1.4 - 2 would be negative.
    const ring = donutGeometry([slice("1", 399), slice("2", 1)], {
      ...OPTS,
      gap: 2,
      minLength: 2,
    });
    expect(ring.segments[1].lengthPx).toBe(2);
  });

  it("drops slices with no value", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 0)], OPTS);
    expect(ring.segments.map((s) => s.key)).toEqual(["1"]);
  });

  it("returns an empty ring when there is nothing to show", () => {
    const ring = donutGeometry([], OPTS);
    expect(ring.segments).toEqual([]);
    expect(ring.circumference).toBeCloseTo(CIRCUMFERENCE);
  });

  it("carries each slice's colour token through untouched", () => {
    const ring = donutGeometry([slice("1", 5), slice("other", 5)], OPTS);
    expect(ring.segments.map((s) => s.colorVar)).toEqual([
      "--color-chart-1",
      "--color-chart-other",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const values = [slice("1", 5), slice("2", 0)];
    donutGeometry(values, OPTS);
    expect(values).toHaveLength(2);
  });
});
