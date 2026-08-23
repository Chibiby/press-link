"use client";

import { Asterisk, UserMinus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";
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
  "gender",
  "multi",
  "unassigned",
  "event",
  "category",
  "level",
  "language",
] as const;

export function CoachFilterBar({
  districts,
  schools,
  events,
}: {
  districts: Option[];
  schools: Option[];
  events: Option[];
}) {
  // The URL writing this bar used to do by hand now comes from the hook, which adds
  // the two things the search box needs and the dropdowns do not: the write is
  // debounced, and it replaces rather than pushes, so typing "reyes" is one server
  // render and one history entry instead of five of each.
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(FILTER_KEYS);

  const multiOnly = searchParams.get("multi") === "1";
  const unassignedOnly = searchParams.get("unassigned") === "1";

  return (
    // The page wraps this and the table in a `group`, so this one attribute is all
    // the table needs to dim while the filtered render is in flight. Without it, a
    // search 250ms plus a server round trip away looks like a page that ignored the
    // typing.
    <Card data-pending={isPending ? "" : undefined}>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterSearch label="Search" placeholder="Name or school" {...search} />
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
          label="Gender"
          value={searchParams.get("gender") ?? ANY}
          onChange={(v) => setParam("gender", v)}
          placeholder="Male + Female"
          options={[
            { value: "M", label: "Male" },
            { value: "F", label: "Female" },
          ]}
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
          placeholder={`${LANGUAGE_LABEL.english} + ${LANGUAGE_LABEL.filipino}`}
          options={[
            { value: "english", label: LANGUAGE_LABEL.english },
            { value: "filipino", label: LANGUAGE_LABEL.filipino },
          ]}
        />

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            // The two toggles are mutually exclusive — "on more than one entry" and
            // "on no entry" cannot both hold — so switching one on clears the other
            // in the same navigation rather than leaving a stale, contradictory
            // param in the URL.
            onClick={() => setParam("multi", multiOnly ? null : "1", ["unassigned"])}
          >
            <Asterisk className="size-4" />
            Multi-entry only
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
