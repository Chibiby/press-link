import {
  BackLinkSkeleton,
  CardSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/tabulators/[eventId]`: the back link, the event heading with its two
 * buttons, this event's four figures, and the results sheet itself.
 *
 * The unidentified-contestants alert the page can render above the tiles is not
 * drawn. It is a fault notice, and a skeleton in its place would promise every
 * event a problem it usually does not have.
 */
export default function EventSheetLoading() {
  return (
    <PageSkeleton label="Loading the results sheet">
      <BackLinkSkeleton />
      <HeadingSkeleton actions={2} />
      <StatRowSkeleton count={4} />
      <CardSkeleton>
        <TableSkeleton rows={8} columns={6} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
