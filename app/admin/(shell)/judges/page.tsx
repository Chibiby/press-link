import { ClipboardList, Download, Gavel, Lock, Users } from "lucide-react";

import { EventPanelTable } from "@/components/admin/judging/EventPanelTable";
import { NO_JUDGES_ON_FILE } from "@/components/admin/judging/empty-states";
import { JudgeRosterTable } from "@/components/admin/judging/JudgeRosterTable";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { eventIndexSummary } from "@/lib/judging/event-index";

import { loadJudgingEventIndex, seatableEvents } from "../judging-data";
import { AddJudgeDialog, JudgeRowActions } from "./JudgeControls";

/**
 * The division's oversight of the judging panels.
 *
 * Every figure on this page is read from the database: the roster from `judges`, the
 * panels from `judge_assignments`, the sheet count from `judge_sheets` and each
 * event's status from the ranks those sheets hold. A zero here means the row is not
 * there — it is not a placeholder standing in for a table that is missing.
 *
 * The write half is here too, as of migrations 0027 and 0029: adding a judge,
 * correcting one, giving one a login and taking one off the roster. Each is a
 * `security definer` RPC that re-checks the whole rule server-side, so nothing on
 * this page is the authorisation boundary — what a refused write shows an admin is
 * the database's own sentence. Seating a panel is not offered here: a seat only
 * means something inside an event, so it lives on that event's page.
 *
 * Per spec §5 the judge-facing side of this feature lives at `/judge`, behind its
 * own login and its own guard. Nothing here reaches it; this is the admin console
 * view of the same panels.
 */
export default async function JudgesPage() {
  const index = await loadJudgingEventIndex();
  const { rows, judges, sheetsSubmitted, error } = index;

  // A failed query would leave `rows` empty, and an empty index renders as "no
  // events" with every figure at zero — which reads as a division that runs no
  // contests rather than a page that could not load. Shown as a failure
  // (non-negotiable 5), following the events page verbatim.
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Judges Portal" subtitle="The judging data could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load the panels</AlertTitle>
          <AlertDescription>
            {error} No panels are shown — this is not a report that the division has no
            events or no judges. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const summary = eventIndexSummary(rows);
  // Built once for the whole table rather than per row: every judge's picker offers
  // the same catalog, and the only per-judge part is which seat is theirs already.
  const seatable = seatableEvents(index);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Judges Portal"
        subtitle="Judging panels, per-event assignments, and how far each round has got."
        actions={
          <>
            <AddJudgeDialog />
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
                title="The judge roster and every event's panel, with each round's progress, as one workbook."
              >
                <Download />
                Export to Excel
              </a>
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Gavel}
          label="Judges"
          value={judges.length}
          subtitle="Everyone on the roster, active or not. One judge may sit on any number of panels."
        />
        <StatCard
          icon={Users}
          label="Events without a panel"
          value={summary.events - summary.withPanel}
          subtitle={`Out of ${summary.events} events in the catalog. No judge can rank an event until one is seated.`}
        />
        <StatCard
          icon={ClipboardList}
          label="Sheets submitted"
          value={sheetsSubmitted}
          subtitle="Across every event and both rounds. A submitted sheet is a locked sheet."
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
          {/* The roster-wide controls, offered here and on no other page: an event's
              panel card renders the same table with no actions at all, because
              deactivating a judge from inside one event would read as taking them off
              that event, which is a different act with a different button. */}
          <JudgeRosterTable
            rows={judges}
            emptyMessage={NO_JUDGES_ON_FILE}
            renderActions={(row) => <JudgeRowActions row={row} events={seatable} />}
          />
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
