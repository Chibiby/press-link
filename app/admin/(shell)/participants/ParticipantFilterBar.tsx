"use client";

import { Asterisk, UserMinus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";

interface Option {
  id: string;
  name: string;
}

/**
 * Every key that narrows the table, and the list the Clear button counts.
 *
 * `unassigned` is in here because the dashboard's "Learners with no entry" row links
 * straight to `?unassigned=1`. Leaving it out meant arriving from that link with no
 * other filter set gave `activeCount === 0`, so Clear never rendered — a reader saw a
 * heavily filtered table with nothing on screen saying it was filtered and no route
 * back. `/admin/coaches` has always had this right; this is the same list.
 *
 * `SEARCH_PARAM` is in here for exactly that reason and no other: a typed query is a
 * filter, and one left out of this list is a filtered table with no way back.
 */
const FILTER_KEYS = [SEARCH_PARAM, "district", "school", "multi", "unassigned"] as const;

export function ParticipantFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
}) {
  // The URL writing this bar used to do by hand now comes from the hook, which
  // adds the two things the search box needs and the dropdowns do not: the write
  // is debounced, and it replaces rather than pushes, so typing "cruz" is one
  // server render and one history entry instead of four of each.
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(FILTER_KEYS);

  const multiOnly = searchParams.get("multi") === "1";
  const unassignedOnly = searchParams.get("unassigned") === "1";

  return (
    // The page wraps this and the table in a `group`, so this one attribute is
    // all the table needs to dim while the filtered render is in flight. Without
    // it, a search 250ms plus a server round trip away looks like a page that
    // ignored the typing.
    <Card data-pending={isPending ? "" : undefined}>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSearch
          label="Search"
          placeholder="Name, school or number"
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

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            // The two toggles are mutually exclusive — "in more than one event" and
            // "in no event" cannot both hold — so switching one on clears the other
            // in the same navigation rather than leaving a stale, contradictory
            // param in the URL.
            onClick={() => setParam("multi", multiOnly ? null : "1", ["unassigned"])}
          >
            <Asterisk className="size-4" />
            Multi-event only
          </Button>
          <Button
            type="button"
            variant={unassignedOnly ? "default" : "outline"}
            aria-pressed={unassignedOnly}
            onClick={() => setParam("unassigned", unassignedOnly ? null : "1", ["multi"])}
          >
            <UserMinus className="size-4" />
            Unassigned only
          </Button>
          {activeCount > 0 && (
            // `clearAll`, not a bare push to the path: it also cancels a search
            // write that was still waiting and empties the box, which a push
            // cannot do — the URL would come back 250ms later carrying the query.
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
