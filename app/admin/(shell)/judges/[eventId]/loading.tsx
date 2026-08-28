import {
  BackLinkSkeleton,
  CardSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/admin/judges/[eventId]`: the back link, the event heading with its results
 * sheet button, the judging-status card, the panel card, and one board table
 * per round.
 *
 * No stat row — this page has none, and inheriting the index's four tiles is
 * exactly the wrong-layout flash a per-route fallback exists to prevent. The
 * status card's three-column `dl` is drawn as its own row of short bars rather
 * than as a table, because that is what it is.
 */
export default function EventPanelLoading() {
  return (
    <PageSkeleton label="Loading the event panel">
      <BackLinkSkeleton />
      <HeadingSkeleton actions={1} />
      <CardSkeleton>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
          {/* The round controls and the paragraph that explains them, both part
              of this card's height. Left out, the panel below would sit two
              rows too high and jump on arrival. */}
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-32" />
            ))}
          </div>
          <Skeleton className="h-3 w-full max-w-3xl" />
        </div>
      </CardSkeleton>
      <CardSkeleton>
        <TableSkeleton rows={4} columns={4} />
      </CardSkeleton>
      <CardSkeleton>
        <TableSkeleton rows={5} columns={5} />
      </CardSkeleton>
      <CardSkeleton>
        <TableSkeleton rows={5} columns={5} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
