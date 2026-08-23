"use client";

import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";

/**
 * The one key that narrows both tables on this page. See
 * `../districts/DistrictSearch.tsx` for why a single-key list still goes through
 * `useFilterParams`.
 */
const FILTER_KEYS = [SEARCH_PARAM] as const;

/**
 * The search box on /admin/events.
 *
 * **Not wrapped in a `Card`, unlike `ParticipantFilterBar` and the other five
 * bars**, and for a sharper reason here than on /admin/districts: this page is
 * already two cards, and a third one above them holding a single input would read
 * as a section of the catalogue rather than as a control over it. The input is the
 * same `FilterSearch` those bars use — same label, same in-field clear button, same
 * 250ms debounce, same pending dim — so nothing a reader learned elsewhere in the
 * admin area behaves differently here. The aggregate `Clear {activeCount} filters`
 * button is the only omission; with one filter it duplicates the X already in the
 * box, and both do the same thing to the URL.
 *
 * One box drives both tables, which is the point: a query for "news" fills
 * Individual and empties Group, and each table says so in its own words rather
 * than the page pretending the catalogue only has one half.
 */
export function EventSearch() {
  const { search, isPending } = useFilterParams(FILTER_KEYS);

  return (
    // The page wraps this and both tables in a `group`, so this one attribute dims
    // them while the filtered render is in flight — otherwise a search 250ms plus
    // a server round trip away looks like a page that ignored the typing.
    <div data-pending={isPending ? "" : undefined} className="w-full sm:max-w-xs">
      <FilterSearch label="Search" placeholder="Contest name" {...search} />
    </div>
  );
}
