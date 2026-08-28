import {
  CardSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  StatRowSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/judges`: a heading with the Add judge and Export buttons, four stat
 * tiles, then two cards — the roster and the panels by event. The two tables
 * are drawn at different heights because they are: the roster is a handful of
 * judges, the panel index is every event in the catalog.
 */
export default function JudgesLoading() {
  return (
    <PageSkeleton label="Loading the judges portal">
      <HeadingSkeleton actions={2} />
      <StatRowSkeleton count={4} />
      <CardSkeleton>
        <TableSkeleton rows={4} columns={5} />
      </CardSkeleton>
      <CardSkeleton>
        <TableSkeleton rows={8} columns={6} />
      </CardSkeleton>
    </PageSkeleton>
  );
}
