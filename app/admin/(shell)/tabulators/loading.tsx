import {
  CardSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/tabulators`: a heading with the workbook export, four stat tiles, and
 * one card holding the sheets-by-event index. The index is every event in the
 * catalog, so its table is drawn taller than the four-row default.
 */
export default function TabulatorsLoading() {
  return (
    <PageSkeleton label="Loading the tabulators portal">
      <HeadingSkeleton actions={1} />
      <StatRowSkeleton count={4} />
      <CardSkeleton>
        <TableSkeleton rows={8} columns={6} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
