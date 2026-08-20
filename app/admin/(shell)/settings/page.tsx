import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Settings"
      summary="Division-wide configuration for the competition."
      requires={[
        "Somewhere to store a setting. The app_settings table was dropped in migration 0010, and restoring it is a schema change this work does not make.",
        "A decision about which settings are division-wide at all, given that the submission lock is deliberately per school.",
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submission lock</CardTitle>
          <CardDescription>
            The one piece of state that behaves like a division-wide setting — and it is
            not one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            There is no division-wide switch. Locking and unlocking is done one school at a
            time from the school papers page — it is a write, and this dashboard does not
            make writes. That page is also where the current per-school lock state is read,
            so this one does not restate a tally it cannot keep in step.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/school-papers">Go to School Papers</Link>
          </Button>
        </CardContent>
      </Card>
    </SoonPage>
  );
}
