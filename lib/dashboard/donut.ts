/**
 * Donut geometry for a stroked-circle ring.
 *
 * Each segment is one `<circle>` of shared centre and radius, revealed for part
 * of its circumference by `stroke-dasharray` and rotated into position by
 * `stroke-dashoffset`. The alternative — assembling annular-sector `<path>`
 * strings — needs trigonometry for the same result and is harder to check.
 *
 * ## SVG wrapper contract
 *
 * These numbers are not generic: they are computed for exactly one wrapper, and
 * they are only correct inside it. A renderer consuming this module must supply
 * it as written.
 *
 *   <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
 *     <g transform={`rotate(-90 ${center} ${center})`}>   // start at 12 o'clock
 *       {segments.map((s) => (
 *         <circle key={s.key} cx={center} cy={center} r={radius} fill="none"
 *                 stroke={`var(${s.colorVar})`} strokeWidth={thickness}
 *                 strokeDasharray={s.dashArray} strokeDashoffset={s.dashOffset}
 *                 strokeLinecap="butt" />
 *       ))}
 *     </g>
 *   </svg>
 *
 * Each clause carries weight:
 *
 * - **`viewBox="0 0 size size"`.** `center`, `radius` and every length here are
 *   user units in that square. A different viewBox rescales the ring and the
 *   `gap`/`minLength` pixel budgets stop meaning pixels.
 * - **`rotate(-90 center center)` on the group.** Offsets are measured from the
 *   circle's own start point, which SVG puts at three o'clock. The rotation is
 *   what makes slice one begin at twelve o'clock; without it the whole ring is
 *   a quarter-turn out.
 * - **`fill="none"` and `strokeWidth={thickness}`.** The band *is* the stroke.
 *   A fill would flood the hole, and any stroke width other than `thickness`
 *   breaks the `radius = (size - thickness) / 2` inset that keeps the band
 *   inside the viewBox.
 * - **`stroke={`var(${colorVar})`}`.** This module passes through CSS custom
 *   property *names* and never colour values; the token is resolved here, at
 *   render time, against `app/globals.css`.
 * - **`strokeLinecap="butt"`.** The default is already `butt`; state it anyway.
 *   `round` or `square` extend every dash by `thickness / 2` at each end — 13px
 *   per end at the production thickness — which swallows the 2px gaps whole and
 *   makes neighbouring slices overlap.
 * - **Segments rendered in array order.** SVG paints in document order, so a
 *   later segment covers an earlier one. The clamp below relies on that.
 *
 * Offsets are negative: `stroke-dashoffset` advances the dash pattern, so
 * pushing a slice further round the ring means offsetting backwards. The dash
 * pattern's period is the full circumference, so -c and (circumference - c)
 * render identically; the negative form keeps the first slice at a plain 0.
 *
 * ## Where the small-slice clamp overruns, and why it cannot run away
 *
 * `lengthPx` is clamped up to `minLength` so a one-entry slice still shows. A
 * clamped slice can therefore be drawn longer than the sector it owns, and the
 * summed arc lengths can exceed the circumference. Both happen; neither makes
 * the ring wrap, because `cursor` advances by the slice's true `span` and never
 * by `lengthPx`. Every slice's start angle stays exact, so error cannot
 * accumulate from one slice to the next — overrun is always local to one
 * boundary and always smaller than `minLength`.
 *
 * The exact bounds, on the production ring (size 220, thickness 26 → radius 97,
 * circumference 609.469) with the default `gap = 2`, `minLength = 2`:
 *
 * - The clamp engages at all when `span < gap + minLength = 4`, i.e. a share
 *   below 0.656%. For a one-entry slice that needs a division total of 153.
 * - A clamped slice crosses into its successor only when `span < minLength = 2`,
 *   i.e. a share below 0.328% — a one-entry slice at a total of 305 or more.
 *   The overhang is `minLength - span`, so strictly under 2px: 0.002px at 305
 *   entries, 0.48px at 400, 1.39px at 1000.
 * - The successor is painted after the tiny slice and is itself at least
 *   `minLength` long, so it covers that overhang completely. The visible cost is
 *   that the pair loses its 2px separator, not a misdrawn arc.
 * - The one artifact that is visible is the *last* slice's overhang, because
 *   nothing is painted after it: up to (again, strictly under) 2px of its colour
 *   lands on the first slice's leading edge at twelve o'clock. It requires the
 *   final slice to hold under 1/305 of the total.
 * - Summed `lengthPx` passes the circumference once `Σ excess > n · gap`, where
 *   `excess = max(0, minLength - (span - gap))` per slice. At most 4px of excess
 *   is available per clamped slice, so with the dashboard's nine slices at least
 *   five must be clamped; the reachable case is eight one-entry slices plus one
 *   large slice at a total above 348.27 — 609.498 drawn against 609.469 at a
 *   total of 349. It is a bookkeeping overrun only: the eight tiny arcs are
 *   overpainted by their neighbours, so it changes no start angle.
 *
 * The thresholds, stated as thresholds rather than as a snapshot — a division that keeps
 * entering will cross them, and a comment anchored to one day's total goes false without
 * anyone editing it:
 *
 * - Below 153 entries a one-entry slice spans more than `gap + minLength = 4`, so the
 *   clamp does not engage at all. At 130 entries such a slice spans 4.688px and draws
 *   2.688px.
 * - From 153 entries the clamp is live: the slice still draws `minLength`, but eats into
 *   its own separator. At 297 entries it spans 2.052px and draws the full 2px, so the
 *   gap either side is gone.
 * - From 305 entries a one-entry slice spans less than `minLength = 2` and the drawn arc
 *   overhangs into its successor — by `minLength - span`, strictly under 2px, and
 *   0.002px at the boundary.
 *
 * So whether anything is clamped today is a question about the current entry count, not
 * a property of this module. Every numeric threshold above is exact.
 *
 * The legend beside the ring carries the exact counts, which is where the
 * accuracy the clamp trades away is recovered.
 */
export interface DonutInput {
  key: string;
  value: number;
  colorVar: string;
}

export interface DonutSegment {
  key: string;
  colorVar: string;
  dashArray: string;
  dashOffset: number;
  lengthPx: number;
}

export interface DonutGeometry {
  size: number;
  center: number;
  radius: number;
  thickness: number;
  circumference: number;
  segments: DonutSegment[];
}

export function donutGeometry(
  values: DonutInput[],
  options: { size: number; thickness: number; gap?: number; minLength?: number }
): DonutGeometry {
  const { size, thickness } = options;
  const gap = options.gap ?? 2;
  const minLength = options.minLength ?? 2;

  // The stroke straddles the radius, so the ring's outer edge sits at
  // radius + thickness/2 — pull the radius in by half the thickness to keep the
  // whole band inside the viewBox.
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const drawable = values.filter((value) => value.value > 0);
  const total = drawable.reduce((sum, value) => sum + value.value, 0);

  // A single slice needs no separator: one notch in an otherwise closed ring
  // reads as a bug rather than as a gap between neighbours.
  const effectiveGap = drawable.length > 1 ? gap : 0;

  let cursor = 0;
  const segments = drawable.map((value) => {
    const span = (circumference * value.value) / total;
    const lengthPx = Math.max(minLength, span - effectiveGap);
    const segment: DonutSegment = {
      key: value.key,
      colorVar: value.colorVar,
      lengthPx,
      dashArray: `${lengthPx} ${circumference - lengthPx}`,
      dashOffset: cursor === 0 ? 0 : -cursor,
    };
    // Advance by the slice's true share, not by what was drawn, so the gap comes
    // out of this slice rather than pushing every later slice around the ring.
    cursor += span;
    return segment;
  });

  return { size, center, radius, thickness, circumference, segments };
}
