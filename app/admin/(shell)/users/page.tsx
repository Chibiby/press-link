import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function UsersPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Users & Access"
      summary="Who can sign in to the division console, and what each of them may do."
      requires={[
        "More than one role. admin_profiles has a single flat role, so there is nothing to grant or revoke yet.",
        "An invite and deactivation flow, which writes to auth users — out of scope for a read-only dashboard.",
        "An audit trail, so a permission change is attributable after the fact.",
      ]}
    />
  );
}
