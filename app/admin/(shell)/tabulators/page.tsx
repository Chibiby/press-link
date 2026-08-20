import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function TabulatorsPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Tabulators"
      summary="Score entry, per-event ranking, and the division's official results."
      requires={[
        "Scores to tabulate, which arrive with the judging system.",
        "A ranking and tie-break rule per event, agreed with the division office rather than invented here.",
        "A separate tabulator role. Today admin_profiles carries one flat role and everyone in it can do everything.",
      ]}
    />
  );
}
