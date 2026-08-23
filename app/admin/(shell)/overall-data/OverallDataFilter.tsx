"use client";

import { Download, X } from "lucide-react";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams } from "@/hooks/use-filter-params";
import { OVERALL_DATA_PATH } from "@/lib/admin/overall-data-filters";
import { SEARCH_PARAM, filterHref } from "@/lib/search/filter-params";

/**
 * Every key that narrows this page, and the list the Clear button counts.
 *
 * `SEARCH_PARAM` is first because the box is first in the grid, and it is in here
 * at all for the reason `hooks/use-filter-params.ts` gives: a filter left out of
 * this list is a reader looking at a narrowed panel with no Clear button and no
 * way back.
 *
 * The two do not narrow the same amount of the page, and that asymmetry is the
 * point of this page's wiring: `district` re-scopes everything, including the
 * division totals and the event-type table, while `q` narrows only the list of
 * schools. Both still belong here — both are filters a reader has to be able to
 * drop — and the page is where the difference is enforced.
 */
const FILTER_KEYS = [SEARCH_PARAM, "district"] as const;

export function OverallDataFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  // The URL writing this bar used to do by hand now comes from the hook, which
  // adds the two things the search box needs and the dropdown does not: the write
  // is debounced, and it replaces rather than pushes, so typing a school name is
  // one server render and one history entry instead of one per keystroke.
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(FILTER_KEYS);

  return (
    // The page wraps this and the school list in a `group`, so this one attribute
    // is all that list needs to dim while the filtered render is in flight.
    // Without it, a search 250ms plus a server round trip away looks like a page
    // that ignored the typing.
    <Card data-pending={isPending ? "" : undefined}>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSearch label="Search" placeholder="School name" {...search} />
        <FilterSelect
          label="District"
          value={searchParams.get("district") ?? ANY}
          onChange={(v) => setParam("district", v)}
          placeholder="All districts"
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
        />

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          {activeCount > 0 ? (
            // `clearAll`, not a bare push to the path: it also cancels a search
            // write that was still waiting and empties the box, which a push
            // cannot do — the URL would come back 250ms later carrying the query.
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          ) : null}

          <Button asChild variant="outline" size="sm" className="ml-auto">
            {/* A route handler, and it carries the whole query string, so the file
                matches the screen — the search included, which is the only way a
                downloaded workbook and the panel above it can agree. It follows the
                URL rather than the box on purpose: while a debounced keystroke is
                still in flight the screen is showing the old query too, and the
                export should be of what is on screen. A plain anchor, because
                next/link would build a workbook on hover. */}
            <a href={filterHref(`${OVERALL_DATA_PATH}/export`, searchParams.toString())}>
              <Download className="size-4" />
              Export to Excel
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
