import {
  CardSkeleton,
  FilterBarSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/events`: heading, the search box, and the two category cards —
 * Individual and Group — each with its own export action and matrix table.
 * Two cards, because one would leave the page visibly growing a second.
 */
export default function EventsLoading() {
  return (
    <PageSkeleton label="Loading the contest catalog">
      <HeadingSkeleton />
      <FilterBarSkeleton fields={0} />
      <CardSkeleton action>
        <TableSkeleton rows={6} columns={6} />
      </CardSkeleton>
      <CardSkeleton action>
        <TableSkeleton rows={4} columns={6} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
