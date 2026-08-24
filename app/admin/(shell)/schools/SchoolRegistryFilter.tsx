"use client";

import { Download, X } from "lucide-react";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
import { SCHOOL_STATUS_LABEL, type SchoolStatus } from "@/lib/dashboard/school-registry";

/**
 * "entered" ("Has entries") is the placeholder now — an unset `?status=` falls
 * back to it, per `schoolRegistryStatus()` — so it is not offered again as an
 * item. "all" is back in the list, explicit and selectable, because the whole
 * roll is no longer what a reader gets by leaving the dropdown alone.
 */
const STATUS_OPTIONS: SchoolStatus[] = [
  "all",
  "learners-no-entry",
  "no-data",
  "locked",
  "integrated",
];

/**
 * Every key that narrows the table, and the list the Clear button counts.
 *
 * `SEARCH_PARAM` is first because the box is first in the bar, and it is in here at
 * all for the same reason the other two are: a typed query is a filter, and one left
 * out of this list is a reader on a filtered table with no Clear button and no way
 * back. This replaces the `district || status` test the Clear button used to make,
 * which would have gone on ignoring the search box.
 */
const FILTER_KEYS = [SEARCH_PARAM, "district", "status"] as const;

export function SchoolRegistryFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  // The URL writing this bar used to do by hand now comes from the hook, which adds
  // the two things the search box needs and the dropdowns do not: the write is
  // debounced, and it replaces rather than pushes, so typing a school name is one
  // server render and one history entry instead of one per keystroke.
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(FILTER_KEYS);

  return (
    // The page wraps this and the table in a `group`, so this one attribute is all
    // the table needs to dim while the filtered render is in flight. Without it, a
    // search 250ms plus a server round trip away looks like a page that ignored the
    // typing.
    <Card data-pending={isPending ? "" : undefined}>
      <CardContent className="flex flex-wrap items-end gap-3">
        {/* Same `min-w-56` as the two dropdowns beside it, so all three controls are
            one row on a wide screen and stack cleanly on a narrow one. */}
        <div className="min-w-56">
          <FilterSearch label="Search" placeholder="School name or ID" {...search} />
        </div>

        <div className="min-w-56">
          <FilterSelect
            label="District"
            value={searchParams.get("district") ?? ANY}
            onChange={(value) => setParam("district", value)}
            placeholder="All districts"
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>

        <div className="min-w-56">
          <FilterSelect
            label="Status"
            value={searchParams.get("status") ?? ANY}
            onChange={(value) => setParam("status", value)}
            placeholder={SCHOOL_STATUS_LABEL.entered}
            options={STATUS_OPTIONS.map((value) => ({
              value,
              label: SCHOOL_STATUS_LABEL[value],
            }))}
          />
        </div>

        <div className="ml-auto flex items-end gap-2">
          {activeCount > 0 ? (
            // `clearAll`, not a bare push to the path: it also cancels a search write
            // that was still waiting and empties the box, which a push cannot do —
            // the URL would come back 250ms later carrying the query.
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            {/* Carries the whole query string, so the file matches the screen — the
                search included, now that `q` is one of these params. The route reads
                them through the same module this table is filtered by, and names the
                workbook "…-filtered-…" whenever any of them is set. A plain `<a>` and
                not a `Link`: this is a file download, not a client navigation. */}
            <a href={`/admin/schools/export?${searchParams.toString()}`}>
              <Download className="size-4" />
              Export to Excel
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
