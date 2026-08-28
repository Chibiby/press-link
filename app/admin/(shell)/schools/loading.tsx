import {
  CardSkeleton,
  FilterBarSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/schools`: heading, the district and status filter bar, and the
 * registry table inside a card — the page wraps this table in a `Card`, unlike
 * entries and participants which use a bare bordered box, so the fallback does
 * too.
 */
export default function SchoolsLoading() {
  return (
    <PageSkeleton label="Loading the school registry">
      <HeadingSkeleton />
      <FilterBarSkeleton fields={2} />
      <CardSkeleton header={false}>
        <TableSkeleton rows={10} columns={6} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
