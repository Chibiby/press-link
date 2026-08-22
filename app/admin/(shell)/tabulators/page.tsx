import { Download, ListChecks, Scissors, Trophy, Users } from "lucide-react";

import { JudgingPreviewNotice } from "@/components/admin/judging/JudgingPreviewNotice";
import { TabulationIndexTable } from "@/components/admin/judging/TabulationIndexTable";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { eventIndexSummary } from "@/lib/judging/event-index";

import { loadJudgingEventIndex } from "../judging-data";

/**
 * Where the division reads the results.
 *
 * A **layout preview**, for the same reason `/admin/judges` is one: the tables that
 * hold ranks arrive with migration 0018. The event list and the entry counts are
 * real, and each event's status is computed by the shared state machine — see
 * `JudgingPreviewNotice`.
 *
 * The tabulators' side is the only place the anonymous codes are joined back to
 * names, schools and districts (non-negotiable 1). Nothing a judge can reach links
 * here, and the join itself lives in `lib/judging/tabulation`.
 */
export default async function TabulatorsPage() {
  const { rows, error } = await loadJudgingEventIndex();

  // Reported, not swallowed: an empty index would render "0 events" and read as a
  // division that runs no contests rather than a page that could not load
  // (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading
          title="Tabulators"
          subtitle="The contest catalog could not be loaded."
        />
        <Alert variant="destructive">
          <AlertTitle>Could not load events</AlertTitle>
          <AlertDescription>
            The contest catalog could not be loaded, so no sheets are shown — this is not
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
        title="Tabulators"
        badge="Layout preview"
        subtitle="Per-event results sheets, with the codes joined back to names and schools."
        actions={
          <Button asChild size="sm" variant="outline">
            {/* A route handler, so a plain anchor: next/link would prefetch, and
                prefetching this URL builds a workbook on every hover.

                The lint rule reads `export` as a value filling the `[eventId]` page
                beside it — see the same disable on /admin/judges. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/admin/tabulators/export"
              title="The event list with each event's status. Qualifiers and locked results arrive with migration 0018, and the workbook says so in every cell that would need them."
            >
              <Download />
              Export to Excel
            </a>
          </Button>
        }
      />

      <JudgingPreviewNotice />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ListChecks}
          label="Events to tabulate"
          value={summary.events}
          subtitle="Every event in the catalog gets its own sheet. None has been ranked yet."
        />
        <StatCard
          icon={Users}
          label="Entries on file"
          value={summary.entries}
          subtitle="Real, from the entries table. Individual events rank each participant separately, so contestants outnumber entries."
        />
        <StatCard
          icon={Scissors}
          label="Qualifiers drawn"
          value={0}
          muted
          subtitle="round2_qualifiers does not exist yet, so no round-1 cut has been taken."
        />
        <StatCard
          icon={Trophy}
          label="Sheets published"
          value={summary.locked}
          subtitle="A sheet is published once its results are locked. Round 2 alone decides the winners."
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sheets by event</CardTitle>
          <CardDescription>
            Open an event to see its full sheet. Round 1 takes the field down to the cut;
            round 2 alone decides the winners, so a contestant&rsquo;s total rank across both
            rounds is informational and labelled as such wherever it appears.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TabulationIndexTable
            rows={rows}
            emptyMessage="No events are in the catalog, so there is nothing to tabulate."
          />
        </CardContent>
      </Card>
    </div>
  );
}
