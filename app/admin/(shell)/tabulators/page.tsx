import { Download, ListChecks, Scissors, Trophy, Users } from "lucide-react";

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
 * Every figure here is read: the entries from `entries`, the qualifiers from
 * `round2_qualifiers` by way of each event's round-2 board, and the published count
 * from the results lock in `event_rounds`. A zero is a zero, not a table that is
 * missing.
 *
 * What is not built is the write half — the RPCs that close a round, draw the cut
 * and lock a result. Until they exist an event can be read all the way through and
 * still never leave "not started", and the disabled controls say which RPC is
 * missing rather than blaming the schema.
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
        <PageHeading title="Tabulators" subtitle="The judging data could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load the sheets</AlertTitle>
          <AlertDescription>
            {error} No sheets are shown — this is not a report that the division has no
            events or no results. Please try refreshing the page.
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
              title="Every event's sheet in one workbook — the codes joined back to names and schools, with each round's points and ranks."
            >
              <Download />
              Export to Excel
            </a>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={ListChecks}
          label="Events to tabulate"
          value={summary.events}
          subtitle="Every event in the catalog gets its own sheet."
        />
        <StatCard
          icon={Users}
          label="Contestants"
          value={summary.contestants}
          subtitle="Individuals competing across every event, counted from the entries their schools filed."
        />
        <StatCard
          icon={Scissors}
          label="Qualifiers drawn"
          value={summary.qualifiers}
          subtitle="Contestants through to round 2, across every event. A cut can only be drawn once round 1 is closed."
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
