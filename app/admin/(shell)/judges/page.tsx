import { ClipboardList, Download, Gavel, Lock, Users } from "lucide-react";

import { EventPanelTable } from "@/components/admin/judging/EventPanelTable";
import { JudgeRosterTable } from "@/components/admin/judging/JudgeRosterTable";
import {
  JudgingPreviewNotice,
  JUDGING_NOT_INSTALLED,
} from "@/components/admin/judging/JudgingPreviewNotice";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { eventIndexSummary } from "@/lib/judging/event-index";

import { loadJudgingEventIndex } from "../judging-data";

/**
 * The division's oversight of the judging panels.
 *
 * This page is a **layout preview**: the judging tables do not exist yet, so the
 * roster is empty and every panel is unseated. What is real is the event list and
 * the entry counts, and what is computed is each event's status — the same status
 * function the finished page will call, given a genuinely empty panel. See
 * `JudgingPreviewNotice`, which says all of that on screen rather than leaving an
 * admin to work out whether the page is broken or unbuilt.
 *
 * Per spec §5 the judge-facing side of this feature lives at `/judge`, behind its
 * own login and its own guard. Nothing here reaches it; this is the admin console
 * view of the same panels.
 */
export default async function JudgesPage() {
  const { rows, error } = await loadJudgingEventIndex();

  // A failed query would leave `rows` empty, and an empty index renders as "no
  // events" with every figure at zero — which reads as a division that runs no
  // contests rather than a page that could not load. Shown as a failure
  // (non-negotiable 5), following the events page verbatim.
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading
          title="Judges Portal"
          subtitle="The contest catalog could not be loaded."
        />
        <Alert variant="destructive">
          <AlertTitle>Could not load events</AlertTitle>
          <AlertDescription>
            The contest catalog could not be loaded, so no panels are shown — this is not
            a report that the division has no events. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const summary = eventIndexSummary(rows);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Judges Portal"
        badge="Layout preview"
        subtitle="Judging panels, per-event assignments, and how far each round has got."
        actions={
          <>
            <Button
              size="sm"
              disabled
              title="Creating a judge needs the judges table, which migration 0018 adds."
            >
              <Gavel />
              Add judge
            </Button>
            <Button asChild size="sm" variant="outline">
              {/* A route handler, so a plain anchor: next/link would prefetch, and
                  prefetching this URL builds a workbook on every hover. The
                  dashboard's export anchor is written the same way.

                  The lint rule reads `export` as a value filling the `[eventId]`
                  page beside it. Next resolves a static segment before a dynamic
                  one, so the URL reaches the route handler — `next build` lists
                  /admin/judges/export and /admin/judges/[eventId] separately. The
                  dashboard's anchor escapes the rule only because overall-data has
                  no dynamic child. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/admin/judges/export"
                title="The event list with each panel's status. Judges, sheets and ranks arrive with migration 0018, and the workbook says so in every cell that would need them."
              >
                <Download />
                Export to Excel
              </a>
            </Button>
          </>
        }
      />

      <JudgingPreviewNotice />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Gavel}
          label="Judges"
          value={0}
          muted
          subtitle="The judges table does not exist yet, so no judge can be counted — this is not an empty roster."
        />
        <StatCard
          icon={Users}
          label="Events without a panel"
          value={summary.events - summary.withPanel}
          subtitle={`All ${summary.events} events in the catalog. Assigning a judge needs judge_assignments.`}
        />
        <StatCard
          icon={ClipboardList}
          label="Sheets submitted"
          value={0}
          muted
          subtitle="judge_sheets does not exist yet. A submitted sheet is a locked sheet."
        />
        <StatCard
          icon={Lock}
          label="Rounds awaiting close"
          value={summary.awaitingAction}
          subtitle="A round can only be closed once every assigned judge has ranked it."
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Judges on file</CardTitle>
          <CardDescription>
            Each judge signs in at <code className="font-mono text-xs">/judge/login</code> and
            sees only the events they are assigned to, by anonymous code. A judge is never
            shown a name, a school or a district.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JudgeRosterTable rows={[]} emptyMessage={JUDGING_NOT_INSTALLED} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Panels by event</CardTitle>
          <CardDescription>
            Every event in the catalog, the panel seated on it, and how far each round has
            got. Each judge ranks independently and the ranks are summed, so one judge is
            simply a sum of one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EventPanelTable
            rows={rows}
            emptyMessage="No events are in the catalog, so there is nothing to judge."
          />
        </CardContent>
      </Card>
    </div>
  );
}
