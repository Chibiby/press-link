import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function MasterlistPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Masterlist"
      summary="One consolidated master list of the division's records, across every school."
      requires={[
        "A decision about what one row is. Participants, coaches, entries and school papers each have their own natural row, and a single list has to pick one or nest the rest.",
        "An export shape of its own. lib/export builds one workbook per surface it serves, and a division-wide list is not one of them.",
      ]}
    />
  );
}
