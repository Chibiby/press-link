"use client";

import { X } from "lucide-react";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { FilterSearch } from "@/components/admin/filter-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";

/**
 * Every key that narrows the table, and the list the Clear button counts.
 * `SEARCH_PARAM` is in here for the same reason it is in every other bar: a
 * typed query is a filter, and one left out of this list is a reader on a
 * filtered table with no Clear button and no way back.
 */
const FILTER_KEYS = [SEARCH_PARAM, "district"] as const;

export function UserAccountsFilterBar({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const { searchParams, setParam, search, clearAll, activeCount, isPending } =
    useFilterParams(FILTER_KEYS);

  return (
    // The page wraps this and the table in a `group`, so this one attribute is
    // all the table needs to dim while the filtered render is in flight.
    <Card data-pending={isPending ? "" : undefined}>
      <CardContent className="flex flex-wrap items-end gap-3">
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

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll} className="ml-auto">
            <X className="size-4" />
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
