"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";

import { ANY } from "@/components/admin/filter-select";
import { createDebouncer } from "@/lib/search/debounce";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_PARAM,
  countActiveParams,
  filterHref,
  nextFilterQuery,
  searchParamValue,
} from "@/lib/search/filter-params";

/**
 * The search box's two props, shaped to spread straight into `FilterSearch`.
 * `value` is local state, so it is never behind what has been typed.
 */
export interface FilterSearchControl {
  value: string;
  onChange: (next: string) => void;
}

export interface FilterParams {
  /** The current params, read from the same place this hook writes them. */
  searchParams: ReadonlyURLSearchParams;
  /**
   * One control changed. `null` or `ANY` clears the key; `clearKeys` names the
   * params that cannot hold at the same time as this one and go in the same
   * navigation. Pushes, so each filter change is its own history entry.
   */
  setParam: (
    key: string,
    value: string | null,
    clearKeys?: readonly string[]
  ) => void;
  /** Spread into `FilterSearch`. Debounced, and replaces rather than pushes. */
  search: FilterSearchControl;
  /** Back to the unfiltered list, search box included. */
  clearAll: () => void;
  /** How many of the keys passed in are set — the "Clear N filters" number. */
  activeCount: number;
  /**
   * Whether a filter navigation is still being rendered on the server. Optional
   * to use; `data-pending={isPending ? "" : undefined}` on the bar lets the table
   * above dim through `group-has-data-pending:opacity-50` with no other wiring.
   */
  isPending: boolean;
}

/**
 * The one place an admin filter bar writes to the URL.
 *
 * Five bars had copied the same eleven lines, differing only in the path they
 * pushed to — `usePathname()` supplies that now. It also adds the two things a
 * free-text box needs and a dropdown does not: the URL write is debounced, and it
 * `replace`s instead of pushing, so a typed word is one server render and one
 * history entry rather than four of each. Selects are untouched: still `push`,
 * still immediate.
 *
 * Pass every key that narrows the table, **including `SEARCH_PARAM` if the bar
 * has a search box**. That list is what `activeCount` counts, and a key left out
 * of it is a reader looking at a filtered table with no Clear button and no way
 * back — the bug `ParticipantFilterBar` already had once with `unassigned`.
 *
 * Wire every bar the same way:
 *
 * ```tsx
 * "use client";
 *
 * import { X } from "lucide-react";
 *
 * import { Button } from "@/components/ui/button";
 * import { Card, CardContent } from "@/components/ui/card";
 * import { ANY, FilterSelect } from "@/components/admin/filter-select";
 * import { FilterSearch } from "@/components/admin/filter-search";
 * import { useFilterParams } from "@/hooks/use-filter-params";
 * import { SEARCH_PARAM } from "@/lib/search/filter-params";
 *
 * const FILTER_KEYS = [SEARCH_PARAM, "district", "school"] as const;
 *
 * export function ParticipantFilterBar({ districts }: { districts: Option[] }) {
 *   const { searchParams, setParam, search, clearAll, activeCount } =
 *     useFilterParams(FILTER_KEYS);
 *
 *   return (
 *     <Card>
 *       <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
 *         <FilterSearch
 *           label="Search"
 *           placeholder="Name or number"
 *           {...search}
 *         />
 *         <FilterSelect
 *           label="District"
 *           value={searchParams.get("district") ?? ANY}
 *           onChange={(v) => setParam("district", v)}
 *           placeholder="All districts"
 *           options={districts.map((d) => ({ value: d.id, label: d.name }))}
 *         />
 *         {activeCount > 0 && (
 *           <Button variant="ghost" size="sm" onClick={clearAll}>
 *             <X className="size-4" />
 *             Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
 *           </Button>
 *         )}
 *       </CardContent>
 *     </Card>
 *   );
 * }
 * ```
 *
 * `clearAll` replaces `router.push("/admin/participants")`: it also cancels a
 * search write that was still waiting and empties the box, which a bare push
 * cannot do — the URL would come back 250ms later carrying the query.
 *
 * `useSearchParams()` renders the component that calls it on the client up to the
 * nearest Suspense boundary. Every page these bars sit on is already dynamic, and
 * the bars already called it, so nothing changes; a new caller on a prerendered
 * route needs a `<Suspense>` around it.
 */
export function useFilterParams(filterKeys: readonly string[] = []): FilterParams {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query = searchParams.toString();
  const urlSearch = searchParams.get(SEARCH_PARAM) ?? "";

  // The visible box. Local, so a keystroke costs a re-render of this input and
  // nothing else — the URL, and the server render behind it, catch up later.
  const [searchText, setSearchText] = useState(urlSearch);

  // Built per render and only the first one kept. It holds a `setTimeout` handle
  // and starts nothing, so that costs an object; a lazily-filled ref would cost a
  // branch at every use for the same result.
  const debouncerRef = useRef(createDebouncer(SEARCH_DEBOUNCE_MS));
  // What this box last put in the URL, so the effect below can tell its own write
  // landing from someone else moving the URL.
  const writtenRef = useRef(urlSearch);
  // What a waiting write is going to put in the URL, so a select clicked in the
  // meantime can carry it along instead of racing it.
  const owedRef = useRef<string | null>(null);
  // Read by the debounced write when it finally fires, which is why it is a ref
  // and not a captured value: 250ms earlier is not when the URL to amend is known.
  const latestRef = useRef({ pathname, query });

  useEffect(() => {
    latestRef.current = { pathname, query };
  }, [pathname, query]);

  const navigate = useCallback(
    (nextQuery: string, history: "push" | "replace") => {
      const href = filterHref(latestRef.current.pathname, nextQuery);
      // These lists are async server components, so the navigation is a server
      // render. Running it in a transition is what makes that wait observable
      // instead of the page simply appearing to ignore the click.
      startTransition(() => {
        if (history === "replace") {
          router.replace(href);
        } else {
          router.push(href);
        }
      });
    },
    [router]
  );

  const setParam = useCallback(
    (key: string, value: string | null, clearKeys: readonly string[] = []) => {
      let next = nextFilterQuery(
        latestRef.current.query,
        key,
        // The sentinel exists because a Radix `SelectItem` cannot have an empty
        // value. It is a fact about a dropdown, so it stops here.
        value === ANY ? null : value,
        clearKeys
      );

      const owed = owedRef.current;
      if (owed !== null) {
        // A waiting search write was computed from the URL as it stood before
        // this click, so letting it fire would undo this select 250ms from now.
        // Fold it into this navigation rather than dropping it: the reader can
        // still see the query in the box, and it should mean something.
        debouncerRef.current.cancel();
        owedRef.current = null;
        const searchValue = searchParamValue(owed);
        writtenRef.current = searchValue ?? "";
        next = nextFilterQuery(next, SEARCH_PARAM, searchValue);
      }

      navigate(next, "push");
    },
    [navigate]
  );

  const onSearchChange = useCallback(
    (next: string) => {
      setSearchText(next);
      owedRef.current = next;

      debouncerRef.current.schedule(() => {
        owedRef.current = null;
        const value = searchParamValue(next);
        writtenRef.current = value ?? "";
        // `replace`, not `push`. "c", "cr", "cru", "cruz" as four history entries
        // turns Back into a way of un-typing instead of a way back to wherever
        // the reader came from.
        navigate(
          nextFilterQuery(latestRef.current.query, SEARCH_PARAM, value),
          "replace"
        );
      });
    },
    [navigate]
  );

  const clearAll = useCallback(() => {
    debouncerRef.current.cancel();
    owedRef.current = null;
    writtenRef.current = "";
    setSearchText("");
    navigate("", "push");
  }, [navigate]);

  useEffect(() => {
    if (urlSearch === writtenRef.current) return;
    // The URL moved for a reason that is not this box: Back, a link in from the
    // dashboard, or a Clear elsewhere on the page. The URL is the page's state,
    // so it wins over what is in the box, and any write still owed is stale.
    debouncerRef.current.cancel();
    owedRef.current = null;
    writtenRef.current = urlSearch;
    setSearchText(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    const debouncer = debouncerRef.current;
    // Leaving the page must not be followed 250ms later by a `replace` back onto
    // the URL that was left.
    return () => debouncer.cancel();
  }, []);

  return {
    searchParams,
    setParam,
    search: { value: searchText, onChange: onSearchChange },
    clearAll,
    activeCount: countActiveParams(searchParams, filterKeys),
    isPending,
  };
}
