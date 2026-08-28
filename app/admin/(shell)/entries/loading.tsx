import {
  FilterBarSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/entries`: two stat rows, not one — four entry figures and three
 * school-paper figures, on their own grids, exactly as the page stacks them.
 * Then the district/school/event filter bar and the eight-column table.
 */
export default function EntriesLoading() {
  return (
    <PageSkeleton label="Loading the entries">
      <HeadingSkeleton />
      <StatRowSkeleton count={4} />
      <StatRowSkeleton count={3} />
      <FilterBarSkeleton fields={3} />
      <TableSkeleton rows={8} columns={8} />
    </PageSkeleton>
  );
}
