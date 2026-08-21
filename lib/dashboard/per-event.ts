/**
 * The dashboard's per-event donut.
 *
 * Grouped by event *type* rather than by event: the division runs 56 events
 * across 16 types, and 56 slices is not a chart. Types with no entries are
 * dropped from the ring — an invisible zero-width arc is noise in the legend —
 * but `typesTotal` keeps the denominator on screen so the panel can say
 * "12 of 16 types".
 *
 * `share` is the exact fraction. Callers format it, and a rounded set of
 * percentages will not always total 100, so the panel shows shares beside
 * counts rather than claiming they add up.
 */
export interface EventTypeCount {
  typeId: string;
  typeName: string;
  entries: number;
}

export interface EventSlice {
  key: string;
  label: string;
  entries: number;
  share: number;
  colorVar: string;
  isOther: boolean;
}

export interface PerEventSummary {
  slices: EventSlice[];
  totalEntries: number;
  typesWithEntries: number;
  typesTotal: number;
  otherTypes: number;
}

const SLICE_TOKENS = [
  "--color-chart-1",
  "--color-chart-2",
  "--color-chart-3",
  "--color-chart-4",
  "--color-chart-5",
  "--color-chart-6",
  "--color-chart-7",
  "--color-chart-8",
];
const OTHER_TOKEN = "--color-chart-other";

export function summarisePerEvent(
  counts: EventTypeCount[],
  options: { topN: number; typesTotal: number }
): PerEventSummary {
  const entered = counts.filter((count) => count.entries > 0);
  const totalEntries = entered.reduce((sum, count) => sum + count.entries, 0);

  const ranked = [...entered].sort(
    (a, b) => b.entries - a.entries || a.typeName.localeCompare(b.typeName, "en")
  );

  const topN = Math.max(0, options.topN);
  const head = ranked.slice(0, topN);
  const tail = ranked.slice(topN);

  const share = (entries: number) => (totalEntries === 0 ? 0 : entries / totalEntries);

  const slices: EventSlice[] = head.map((count, index) => ({
    key: count.typeId,
    label: count.typeName,
    entries: count.entries,
    share: share(count.entries),
    // More types than tokens would wrap and repeat a colour; topN is 8 and there
    // are 8 tokens, so the modulo is a guard rather than a live code path.
    colorVar: SLICE_TOKENS[index % SLICE_TOKENS.length],
    isOther: false,
  }));

  if (tail.length > 0) {
    const otherEntries = tail.reduce((sum, count) => sum + count.entries, 0);
    slices.push({
      key: "other",
      label: "Other",
      entries: otherEntries,
      share: share(otherEntries),
      colorVar: OTHER_TOKEN,
      isOther: true,
    });
  }

  return {
    slices,
    totalEntries,
    typesWithEntries: entered.length,
    typesTotal: options.typesTotal,
    otherTypes: tail.length,
  };
}

/** One entry's event type, as the overall-data page selects them. */
export interface EventTypeRow {
  typeId: string;
  typeName: string;
}

/**
 * Rows to counts, for the surfaces that must narrow by district — which a `count`-only
 * grouped query cannot express, so they fetch one row per entry and fold here.
 *
 * Order is first-seen and deliberately not sorted: `summarisePerEvent` ranks, and two
 * functions ranking the same list is how two surfaces end up disagreeing about which
 * type is biggest.
 */
export function countByEventType(rows: EventTypeRow[]): EventTypeCount[] {
  const byType = new Map<string, EventTypeCount>();

  for (const row of rows) {
    const found = byType.get(row.typeId);
    if (found) {
      found.entries += 1;
    } else {
      byType.set(row.typeId, { typeId: row.typeId, typeName: row.typeName, entries: 1 });
    }
  }

  return [...byType.values()];
}
