"use client";

import { FilterSearch } from "@/components/admin/filter-search";
import { useFilterParams } from "@/hooks/use-filter-params";
import { SEARCH_PARAM } from "@/lib/search/filter-params";

/**
 * The one key that narrows this table.
 *
 * A list of one, and it still goes through `useFilterParams` rather than a
 * hand-rolled `router.replace`: the debounce, the replace-not-push, and the
 * "URL moved for some other reason, so reset the box" effect are the same three
 * things every other admin list needs, and the copy of them that drifts is the
 * copy that was written out by hand.
 */
const FILTER_KEYS = [SEARCH_PARAM] as const;

/**
 * The search box on /admin/districts.
 *
 * **Not wrapped in a `Card`, unlike `ParticipantFilterBar` and the other five
 * bars.** Those hold three to five controls, so the card is a panel with contents;
 * here it would be a panel around one input, stacked directly on top of the card
 * that holds the table, which reads as two panels for one list. The control itself
 * is the same `FilterSearch` those bars use, with the same label, the same
 * in-field clear button, the same 250ms debounce and the same pending dim, so
 * nothing a reader learned on another admin page works differently here.
 *
 * The one thing the bars have that this does not is the aggregate
 * `Clear {activeCount} filters` button. With a single filter it could only ever
 * read "Clear 1 filter", sitting beside a box that already carries an X for
 * exactly that — and the X is not a lesser version of it: `FilterSearch` calls
 * `search.onChange("")`, which replaces any waiting write and removes the param,
 * which is what `clearAll` does. Two controls for one job is the duplication the
 * dropdown rule warns about, one level up.
 */
export function DistrictSearch() {
  const { search, isPending } = useFilterParams(FILTER_KEYS);

  return (
    // The page wraps this and the table in a `group`, so this one attribute is all
    // the table needs to dim while the filtered render is in flight. Without it, a
    // search 250ms plus a server round trip away looks like a page that ignored
    // the typing.
    //
    // Capped rather than full-width: 23 district names are short, and an input
    // stretched across the page promises a longer query than it wants.
    <div data-pending={isPending ? "" : undefined} className="w-full sm:max-w-xs">
      <FilterSearch label="Search" placeholder="District name" {...search} />
    </div>
  );
}
