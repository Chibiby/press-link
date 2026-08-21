import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AuditLogsPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Audit Logs"
      summary="An attributable record of every administrative change: who, what, and when."
      requires={[
        "An audit table and the triggers that write to it. Nothing records administrative writes today.",
        "A decision about retention, since this would hold names of minors indefinitely.",
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What is recorded today</CardTitle>
          <CardDescription>
            Timestamps, not attribution — enough to see when something happened, never who
            did it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <code className="text-xs">entries.submitted_at</code>,{" "}
              <code className="text-xs">participants.created_at</code> and{" "}
              <code className="text-xs">coaches.created_at</code> — three of the six columns
              the dashboard&apos;s Recent activity panel already reads.
            </li>
            <li>
              <code className="text-xs">submission_locked_at</code> and the school-paper
              answer and update timestamps.
            </li>
          </ul>
        </CardContent>
      </Card>
    </SoonPage>
  );
}
