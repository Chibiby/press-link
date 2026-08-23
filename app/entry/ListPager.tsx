"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  DEFAULT_PAGE_SIZE,
  GAP,
  PAGE_SIZES,
  clampPage,
  pageCount,
  pageSlice,
  pageSlots,
  rangeLabel,
} from "./pagination";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The page state for one list: which page, how many rows, and the slice to draw.
 *
 * Held here rather than in each of the three lists so participants, coaches and
 * entries page the same way and start at the same ten rows.
 */
export function useListPage<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const topRef = useRef<HTMLDivElement>(null);

  // Derived, not stored: a search that narrows the list to one page must not
  // leave a school stranded on page 5 looking at an empty table.
  const current = clampPage(page, items.length, size);
  const rows = useMemo(() => pageSlice(items, current, size), [items, current, size]);

  function goToPage(next: number) {
    setPage(next);
    const el = topRef.current;
    if (!el) return;
    // The pager sits under the last row, so on a phone a school taps it from the
    // foot of the list — and would then be reading the bottom of a page whose
    // first rows it never saw. Reel the list back only when it has already run
    // off the top of the screen; a tap with the list in view moves nothing.
    // `scroll-mt-28` on the element is the sticky-header allowance.
    const allowance = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (el.getBoundingClientRect().top < allowance) {
      el.scrollIntoView({ block: "start" });
    }
  }

  return {
    /** The rows for the page on screen. */
    rows,
    /** Put this on the wrapper that starts the list, for paging to scroll to. */
    topRef,
    /** Back to page 1 — after a filter changes, or a row is added. */
    reset: () => setPage(1),
    pager: {
      page: current,
      size,
      total: items.length,
      onPageChange: goToPage,
      onSizeChange: (next: number) => {
        // The rows a school was looking at are somewhere inside the first page
        // of any larger size, so page 1 is the honest place to land.
        setSize(next);
        setPage(1);
      },
    },
  };
}

export interface ListPagerProps {
  /** The page on screen, already clamped to the list. */
  page: number;
  size: number;
  /** Rows in the whole list — after any filter, before the page is cut. */
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
  /**
   * Capitalised plural — "Participants", "Entries". Three of these lists can be
   * on screen at once, so every control names the list it belongs to.
   */
  label: string;
}

/**
 * Page numbers under a list, with how many rows are on screen and a way to ask
 * for more.
 *
 * Nothing renders at all until there is more than one page's worth to show: a
 * school with six coaches has nothing to page and no reason to resize. Above
 * that the count and the size stay put, and the numbers appear once there is a
 * second page to reach — no controls that cannot do anything.
 */
export function ListPager({
  page,
  size,
  total,
  onPageChange,
  onSizeChange,
  label,
}: ListPagerProps) {
  if (total <= DEFAULT_PAGE_SIZE) return null;

  const last = pageCount(total, size);
  const noun = label.toLowerCase();

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {rangeLabel(page, total, size)}
        </span>
        <Select value={String(size)} onValueChange={(value) => onSizeChange(Number(value))}>
          {/* Matched to the filter dropdowns above the table: 36px on a phone,
              32px from sm up. The height comes from a `data-[size]` variant,
              which a plain `h-9` cannot outrank — hence the important flag. */}
          <SelectTrigger
            className="h-9! w-auto text-xs sm:h-8!"
            aria-label={`${label} per page`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {last > 1 && (
        // Five numbers plus Previous and Next is what a 320px row holds, which
        // is what `pageSlots` counts to. Centred on a phone, where the numbers
        // have the row to themselves; tucked to the end beside the count once
        // the two sit on one line.
        <div className="flex items-center justify-center gap-1 sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 sm:size-8"
            aria-label={`Previous page of ${noun}`}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>

          {pageSlots(page, last).map((slot, index) =>
            slot === GAP ? (
              <span
                // Two gaps can sit in one row, and neither is a page number.
                key={`gap-${index}`}
                aria-hidden
                className="w-4 text-center text-xs text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={slot}
                type="button"
                // The page you are on is the outlined one; the rest stay flat,
                // so the row reads as one current page among the others.
                variant={slot === page ? "outline" : "ghost"}
                size="icon"
                className="size-9 text-xs tabular-nums sm:size-8"
                aria-label={`${label} page ${slot}`}
                aria-current={slot === page ? "page" : undefined}
                onClick={() => onPageChange(slot)}
              >
                {slot}
              </Button>
            )
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 sm:size-8"
            aria-label={`Next page of ${noun}`}
            disabled={page >= last}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
