"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";

interface Option {
  id: string;
  name: string;
}

/**
 * Every key that narrows the table, and the list the Clear button counts.
 *
 * `SEARCH_PARAM` is first because the box is first in the bar, and it is in here at
 * all for the same reason every other key is: a typed query is a filter, and one
 * left out of this list is a reader on a filtered table with no Clear button and no
 * way back.
 */
const FILTER_KEYS = [
  SEARCH_PARAM,
  "district",
  "school",
  "status",
  "lock",
  "language",
] as const;

export function SchoolPaperFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
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
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterSearch label="Search" placeholder="School name" {...search} />
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
          label="Status"
          value={searchParams.get("status") ?? ANY}
          onChange={(v) => setParam("status", v)}
          placeholder="All statuses"
          options={[
            { value: "submitted", label: PAPER_STATUS_LABEL.submitted },
            { value: "saved", label: PAPER_STATUS_LABEL.saved },
            { value: "incomplete", label: PAPER_STATUS_LABEL.incomplete },
          ]}
        />
        <FilterSelect
          label="Submission lock"
          value={searchParams.get("lock") ?? ANY}
          onChange={(v) => setParam("lock", v)}
          placeholder="Locked + unlocked"
          options={[
            { value: "locked", label: "Locked" },
            { value: "unlocked", label: "Unlocked" },
          ]}
        />
        {/*
          "any level" is in the label because the predicate is any-level: an
          integrated school that has filed only its elementary English paper
          matches "English". A plain "Language on file" would be read as "has
          its English paper(s), finished" by anyone who knows an integrated
          school owes two, and a filter whose name outruns its predicate is
          worse than a long name.
        */}
        <FilterSelect
          label="Language on file (any level)"
          value={searchParams.get("language") ?? ANY}
          onChange={(v) => setParam("language", v)}
          placeholder={`${LANGUAGE_LABEL.english} + ${LANGUAGE_LABEL.filipino}`}
          options={[
            { value: "english", label: LANGUAGE_LABEL.english },
            { value: "filipino", label: LANGUAGE_LABEL.filipino },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          {activeCount > 0 && (
            // `clearAll`, not a bare push to the path: it also cancels a search write
            // that was still waiting and empties the box, which a push cannot do —
            // the URL would come back 250ms later carrying the query.
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
