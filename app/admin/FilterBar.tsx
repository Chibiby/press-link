"use client";

import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { ENTRY_FILTER_KEYS } from "@/lib/entries/admin-entry-filters";

interface Option {
  id: string;
  name: string;
}

export function FilterBar({
  districts,
  schools,
  events,
}: {
  districts: Option[];
  schools: Option[];
  events: Option[];
}) {
  // The URL writing this bar used to do by hand now comes from the hook, which
  // adds the two things the search box needs and the dropdowns do not: the write
  // is debounced, and it replaces rather than pushes, so typing "cruz" is one
  // server render and one history entry instead of four of each.
  //
  // `ENTRY_FILTER_KEYS` comes from the same module that filters the rows, so the
  // "Clear N filters" count and the filter itself cannot disagree about which
  // params narrow this page — a key missing from that list is a reader on a
  // filtered table with no Clear button and no way back. `SEARCH_PARAM` is first
  // in it, because a typed query is a filter.
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(ENTRY_FILTER_KEYS);

  return (
    // The page wraps this and the table in a `group`, so this one attribute is
    // all the table needs to dim while the filtered render is in flight. Without
    // it, a search 250ms plus a server round trip away looks like a page that
    // ignored the typing.
    <Card data-pending={isPending ? "" : undefined}>
      {/* Seven controls in six columns, exactly as `CoachFilterBar` sits: the six
          dropdowns keep the widths they had, and the new box takes the first cell
          rather than every control shrinking to make room for it. */}
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterSearch
          label="Search"
          // Names the two columns it actually reads. Every other column on this
          // table has a dropdown of its own in this same card.
          placeholder="Contestant or coach"
          {...search}
        />
        <FilterSelect
          label="District"
          value={searchParams.get("district") ?? ANY}
          onChange={(v) => setParam("district", v)}
          placeholder="All districts"
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
        />
        <FilterSelect
          label="School"
          value={searchParams.get("school") ?? ANY}
          onChange={(v) => setParam("school", v)}
          placeholder="All schools"
          options={schools.map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterSelect
          label="Event"
          value={searchParams.get("event") ?? ANY}
          onChange={(v) => setParam("event", v)}
          placeholder="All events"
          options={events.map((e) => ({ value: e.id, label: e.name }))}
        />
        <FilterSelect
          label="Category"
          value={searchParams.get("category") ?? ANY}
          onChange={(v) => setParam("category", v)}
          placeholder="Individual + Group"
          options={[
            { value: "individual", label: "Individual" },
            { value: "group", label: "Group" },
          ]}
        />
        <FilterSelect
          label="Level"
          value={searchParams.get("level") ?? ANY}
          onChange={(v) => setParam("level", v)}
          placeholder="Elem + Secondary"
          options={[
            { value: "elementary", label: "Elementary" },
            { value: "secondary", label: "Secondary" },
          ]}
        />
        <FilterSelect
          label="Language"
          value={searchParams.get("language") ?? ANY}
          onChange={(v) => setParam("language", v)}
          placeholder="English + Filipino"
          options={[
            { value: "english", label: "English" },
            { value: "filipino", label: "Filipino" },
          ]}
        />

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          {activeCount > 0 && (
            // `clearAll`, not a bare push to the path: it also cancels a search
            // write that was still waiting and empties the box, which a push
            // cannot do — the URL would come back 250ms later carrying the query.
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="ml-auto">
            {/* Carries the whole query string, so the file matches the screen —
                the search included, now that `q` is one of these params. The
                route reads them through the same module this table is filtered
                by, and names the workbook "…-filtered-…" whenever any of them is
                set. A plain `<a>` and not a `Link`: this is a file download, not
                a client navigation. */}
            <a href={`/admin/export?${searchParams.toString()}`}>
              <Download className="size-4" />
              Export to Excel
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
