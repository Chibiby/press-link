import {
  FilterBarSkeleton,
  HeadingSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/admin/shell/PageSkeleton";

/**
 * `/admin/participants`: heading, the district/school filter bar, and the
 * seven-column roster. No stat tiles — this page counts in its badge and its
 * subtitle instead, so the group default's bare table would sit a row too high.
 */
export default function ParticipantsLoading() {
  return (
    <PageSkeleton label="Loading the participant roster">
      <HeadingSkeleton />
      <FilterBarSkeleton fields={2} />
      <TableSkeleton rows={10} columns={7} />
    </PageSkeleton>
  );
}
