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
            There is no division-wide switch. A school locks its own submission; the
            division office cannot lock one, only reopen one. Unlocking on the school
            papers page and resetting a school&apos;s paper answer on the participants page
            both clear the lock, one school at a time — the only two writes this dashboard
            makes to division data.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/school-papers">Go to School Papers</Link>
          </Button>
        </CardContent>
      </Card>
    </SoonPage>
  );
}
