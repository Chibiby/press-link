"use client";

import { Search, X } from "lucide-react";

import { ANY } from "./list-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The base trigger renders its value as a flex box, which quietly defeats the
 * `line-clamp-1` sitting right beside it — line clamping needs `-webkit-box`.
 * A long label then hard-clips mid-word. Two dropdowns fill a 320px row almost
 * exactly, so "All languages" cannot avoid being cut there; this at least makes
 * it read as truncation. Scoped here rather than fixed in the shared Select,
 * which every admin filter bar also uses.
 */
const TRUNCATE_VALUE =
  "[&_[data-slot=select-value]]:block! [&_[data-slot=select-value]]:truncate";

export interface ToolbarFilter {
  value: string;
  onChange: (value: string) => void;
  /**
   * The widest option, named for what it includes rather than for the absence
   * of a filter. It doubles as the first item, the way the admin filter bar
   * does it, so the dropdown needs no visible label of its own.
   */
  placeholder: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
}

/**
 * The one search-and-filter row the three lists share, so none of them invents
 * its own.
 *
 * Two rows at most on a phone — search, then the dropdowns with the count and
 * Clear on their trailing edge — because the participants tab already stacks a
 * whole add form above its list, and every extra row of chrome pushes the rows
 * further down the screen. From `sm` up it collapses to one row.
 *
 * Nothing here mutates the submission, so it stays usable while a submission is
 * locked: reading a locked entry list is exactly when you want to search it.
 */
export function ListToolbar({
  searchPlaceholder,
  query,
  onQueryChange,
  filters,
  shown,
  total,
  onClear,
}: {
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  filters: ToolbarFilter[];
  shown: number;
  total: number;
  onClear: () => void;
}) {
  // Driven by the controls, not by `shown < total`: a query that happens to
  // match every row still needs a visible way back to the full list.
  const narrowing =
    query.trim() !== "" || filters.some((filter) => filter.value !== ANY);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          // These lists are Filipino surnames, which autocorrect fights.
          type="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // A phone gets 36px: it matches the add form's inputs right above
          // it and is a kinder thumb target. From sm up the row is unchanged.
          className="h-9 pl-8 sm:h-8"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {(filters.length > 0 || narrowing) && (
        <div className="flex min-w-0 items-center gap-2">
          {filters.length > 0 && (
            <div
              className={cn(
                "grid min-w-0 flex-1 gap-2 sm:flex sm:flex-none",
                filters.length > 1 ? "grid-cols-2" : "grid-cols-1"
              )}
            >
              {filters.map((filter) => (
                <Select
                  key={filter.ariaLabel}
                  value={filter.value}
                  onValueChange={filter.onChange}
                >
                  {/* The trigger is `w-fit` and 32px by default: on a phone
                      that leaves two dropdowns ragged in their grid cells and
                      shorter than the search box. Its height comes from a
                      `data-[size]` variant, which a plain `h-9` cannot
                      outrank — hence the important modifier. */}
                  <SelectTrigger
                    className={cn(
                      "h-9! w-full min-w-0 sm:h-8! sm:w-auto",
                      TRUNCATE_VALUE
                    )}
                    aria-label={filter.ariaLabel}
                  >
                    <SelectValue placeholder={filter.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{filter.placeholder}</SelectItem>
                    {filter.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
          )}

          {narrowing && (
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {/* At 320px the count cannot share the row with two dropdowns and
                  Clear, and Clear is the half you can act on. */}
              <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                {shown} of {total}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                // Left at 28px it was the smallest target on the phone row.
                className="h-9 sm:h-7"
                onClick={onClear}
              >
                <X className="size-4" />
                Clear
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
