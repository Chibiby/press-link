import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The admin shell's loading vocabulary: the blocks every `loading.tsx` under
 * `app/admin/(shell)` is built from.
 *
 * These exist so a route's fallback can be the *shape* of that route rather
 * than a spinner. The shell layout renders the rail and the topbar, so a
 * `loading.tsx` inside the group only ever replaces `<main>` — which means the
 * fallback and the real page sit in the same box, and any disagreement between
 * them shows up as the page jumping when the data lands. Each block below is
 * therefore copied from the component it stands in for: `HeadingSkeleton` from
 * `PageHeading`, `StatRowSkeleton` from `StatCard`, `TableSkeleton` from
 * `components/ui/table.tsx`'s own paddings. Change one of those and its
 * skeleton is the thing to change with it.
 *
 * Nothing here takes data or renders text. A fallback that guessed at a title
 * would flash the wrong title.
 */

/**
 * The wrapper every admin fallback starts with.
 *
 * It carries the page's only accessible announcement. The bars inside are
 * decoration — a screen reader that walked them would hear nothing useful and
 * a lot of it — so they sit under one `aria-hidden` subtree and a single
 * `role="status"` with an `sr-only` sentence speaks for the whole screen. That
 * is one announcement per navigation instead of fifty empty boxes.
 *
 * `label` names what is loading rather than defaulting to "Loading": on a route
 * whose fallback is a four-tile stat row, "Loading the judges portal" is the
 * difference between knowing the click landed and guessing.
 */
export function PageSkeleton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-6">
        {children}
      </div>
    </div>
  );
}

/**
 * `PageHeading`'s title block: the same `flex-wrap ... justify-between gap-3`
 * row, a title bar at the h1's height, an optional subtitle line, and `actions`
 * buttons sized like `Button size="sm"` (h-8).
 *
 * The widths are guesses at a typical heading and always will be — the real
 * title is data. They are sized to the shorter end of what the admin pages
 * actually use, because a bar that is too long collapsing to a short title
 * reads as a mis-render, while a short bar growing does not.
 */
export function HeadingSkeleton({
  subtitle = true,
  actions = 0,
}: {
  subtitle?: boolean;
  actions?: number;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-5 w-44" />
        {subtitle ? <Skeleton className="h-4 w-72 max-w-full" /> : null}
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A back link above a heading, as `/admin/judges/[eventId]` and
 * `/admin/tabulators/[eventId]` both draw it — a ghost `Button size="sm"`
 * pulled left by `-ml-2`. Without it those two pages shift down by a row when
 * their data lands.
 */
export function BackLinkSkeleton() {
  return <Skeleton className="-ml-2 h-8 w-28" />;
}

/**
 * Tailwind compiles the classes it can see in the source, so a column count
 * cannot be interpolated into a grid class. The counts the admin pages actually
 * use each get a literal here, and `StatRowSkeleton` takes the union of the
 * keys — asking for a row of five is then a type error rather than a row that
 * silently renders as one column.
 */
const STAT_GRID = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  6: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
} as const;

/**
 * A row of stat tiles, laid out on the same grid the pages use and drawn from
 * `StatCard`'s internals: the uppercase label, the big `tabular-nums` figure,
 * the `size-9` icon chip, and the subtitle line under them. The dashboard's
 * `KpiTile` and the entries page's `Stat` are close enough to the same box that
 * this stands in for all three.
 */
export function StatRowSkeleton({ count = 4 }: { count?: keyof typeof STAT_GRID }) {
  return (
    <div className={cn("grid gap-3", STAT_GRID[count])}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl px-4 py-4 ring-1 ring-foreground/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
            <Skeleton className="size-9 shrink-0 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Cell widths cycle through this rather than filling each cell, so a skeleton
 * table reads as rows of varying content instead of a solid grey block. The
 * cycle is deliberately not random: a fallback must render identically on the
 * server and on the client, and `Math.random()` here would be a hydration
 * mismatch on every load.
 */
const CELL_WIDTHS = ["w-full", "w-3/5", "w-4/5", "w-1/2", "w-2/3"];

/**
 * A table block at `components/ui/table.tsx`'s own metrics — `h-10` header
 * cells, `p-2` body cells, a bottom border on every row but the last — inside
 * the bordered container the admin tables are wrapped in.
 *
 * It is divs, not a `<table>`. The markup is inside `PageSkeleton`'s
 * `aria-hidden` subtree, so a real table here would buy no semantics; it would
 * only invite a reader to treat the bars as a header row that names columns.
 *
 * `rows` defaults low on purpose. The fallback should suggest a table, not
 * predict how long it is: fifteen bars collapsing to three real rows is a
 * bigger jump than three growing to fifteen.
 */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl ring-1 ring-foreground/10", className)}>
      <div className="flex h-10 items-center gap-4 border-b px-2">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b px-2 py-3 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={cn("h-4", CELL_WIDTHS[(r + c) % CELL_WIDTHS.length])} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A `Card` with a title and description in its header — the wrapper most admin
 * tables sit in. It copies `Card`'s `ring-1 ring-foreground/10` and its
 * `--card-spacing` padding as literals rather than rendering a real `Card`,
 * because `Card`'s `has-data-[slot=...]` selectors key off children this has
 * none of, and a real one would quietly lay out differently.
 *
 * The header is optional in both of its parts: `header={false}` for the cards
 * that are a bare `CardContent` around a table, `description={false}` for the
 * ones that carry a title and nothing under it, and `action` for the ones whose
 * header ends in a button.
 */
export function CardSkeleton({
  header = true,
  description = true,
  action = false,
  children,
}: {
  header?: boolean;
  description?: boolean;
  action?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 ring-1 ring-foreground/10">
      {header ? (
        <div className="flex items-start justify-between gap-3 px-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            {description ? <Skeleton className="h-3 w-full max-w-2xl" /> : null}
          </div>
          {action ? <Skeleton className="h-8 w-28 shrink-0" /> : null}
        </div>
      ) : null}
      <div className="px-4">{children}</div>
    </div>
  );
}

/**
 * The filter row the list pages put between the heading and the table — a
 * search box and a few selects at `Input`/`SelectTrigger` height (h-9).
 *
 * It is drawn even though those bars are client components that would render
 * instantly: the filter bar is part of the page, so leaving it out would let
 * the table appear where the filters belong and then jump down a row when the
 * real page arrives.
 */
export function FilterBarSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 w-full max-w-xs" />
      {Array.from({ length: fields }, (_, i) => (
        <Skeleton key={i} className="h-9 w-40" />
      ))}
    </div>
  );
}
