"use client";

import { useState } from "react";

import { donutGeometry } from "@/lib/dashboard/donut";
import type { PerEventSummary } from "@/lib/dashboard/per-event";

const SIZE = 220;
const THICKNESS = 26;

const SHARE = new Intl.NumberFormat("en-PH", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function EventDonut({ summary }: { summary: PerEventSummary }) {
  const [active, setActive] = useState<string | null>(null);

  if (summary.totalEntries === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No entries yet, so there is nothing to break down by event type.
      </p>
    );
  }

  // A slice key that is no longer in `summary.slices` would match no segment, so every
  // segment would dim at once and the ring would read as disabled. Unreachable while
  // nothing re-renders this donut with a different dataset mid-hover, but it becomes
  // reachable the moment a filter is added, so the stale key is resolved to "nothing
  // hovered" rather than left to dim the whole ring.
  const activeSlice =
    active !== null && summary.slices.some((slice) => slice.key === active) ? active : null;

  const geometry = donutGeometry(
    summary.slices.map((slice) => ({
      key: slice.key,
      value: slice.entries,
      colorVar: slice.colorVar,
    })),
    { size: SIZE, thickness: THICKNESS },
  );

  return (
    <div
      className="flex flex-col items-center gap-6 lg:flex-row lg:items-start"
      onMouseLeave={() => setActive(null)}
    >
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Entries by event type: ${summary.totalEntries} entries across ${summary.typesWithEntries} event types. The table beside this chart lists every value.`}
        >
          {/* -90° puts the first slice at twelve o'clock. */}
          <g transform={`rotate(-90 ${geometry.center} ${geometry.center})`}>
            {/* Track, so the ring still reads as a ring when one slice holds
                everything and there is no gap to reveal the surface. */}
            <circle
              cx={geometry.center}
              cy={geometry.center}
              r={geometry.radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth={geometry.thickness}
            />
            {/* Painted in array order, and that is load-bearing: donut.ts clamps a
                tiny slice up to minLength, so it can overhang its successor by
                strictly under 2px. SVG paints in document order, so the successor —
                itself at least minLength long — overpaints that overhang. Reordering
                or sorting this map would expose it. */}
            {geometry.segments.map((segment) => (
              <circle
                key={segment.key}
                cx={geometry.center}
                cy={geometry.center}
                r={geometry.radius}
                fill="none"
                stroke={`var(${segment.colorVar})`}
                strokeWidth={geometry.thickness}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                opacity={activeSlice === null || activeSlice === segment.key ? 1 : 0.35}
                className="transition-opacity duration-150"
                onMouseEnter={() => setActive(segment.key)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl leading-none font-semibold text-foreground">
            {summary.totalEntries.toLocaleString("en-PH")}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">total entries</span>
        </div>
      </div>

      {/* Legend and table view in one: every slice, its exact count, its share.
          Three slice colours sit below 3:1 on the light surface, so the label and
          the count here are what carry identity — never the colour alone. */}
      <div className="min-w-0 flex-1 space-y-2">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Entries by event type, with counts and shares.
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-1.5 text-left font-medium">
                Event type
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Entries
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.slices.map((slice) => (
              <tr
                key={slice.key}
                onMouseEnter={() => setActive(slice.key)}
                className={activeSlice === slice.key ? "bg-muted/60" : undefined}
              >
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: `var(${slice.colorVar})` }}
                    />
                    <span className="text-foreground">{slice.label}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-foreground">
                  {slice.entries.toLocaleString("en-PH")}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {SHARE.format(slice.share)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          {summary.typesWithEntries} of {summary.typesTotal} event types have an entry.
          {summary.otherTypes > 0
            ? ` "Other" groups the ${summary.otherTypes} types with the fewest entries.`
            : ""}
        </p>
      </div>
    </div>
  );
}
