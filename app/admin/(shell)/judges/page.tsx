import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function JudgesPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Judges Portal"
      summary="Judging panels, per-event assignments, and the sheets judges score on."
      requires={[
        "A judges table. The database has no judge, no panel and no assignment — only schools, entries and the roster.",
        "A scoring model per event type: criteria, weights and a maximum, so a score means the same thing twice.",
        "Judge accounts, which are a second kind of login and a second set of row-level security policies.",
      ]}
    />
  );
}
