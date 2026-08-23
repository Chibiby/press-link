import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  auditLogState,
  auditRangeLabel,
  buildAuditRows,
  type AuditEventRow,
  type AuditLogState,
  type AuditRow,
} from "@/lib/admin/audit-log";
import type { SupabaseServerClient } from "@/lib/supabase/server";

/**
 * The unaggregated action log.
 *
 * WHY THIS IS NOT A REDIRECT TO /admin/activity. The two pages read the same
 * table and answer different questions. `/admin/activity` groups a login-to-logout
 * sitting into one sentence — "Bagong Silang ES added 5 learners, 5 coaches and
 * entry for 6 events" — which was the requirement, and it merges in the six legacy
 * timestamp columns so the history before the log still shows. Grouping throws away
 * exactly what an audit read needs: *which* learner, at *which* minute, under
 * *which* session id. This page is those rows, one per write, newest first,
 * division-wide. Migration 0024 §3 says the same from the other side, creating the
 * `activity_events (at desc)` index for "the whole-table newest-first read [that]
 * belongs to the admin audit-logs page".
 *
 * WHY NOT PER-ACTOR. It was the other candidate and the columns cannot serve it.
 * `actor_user_id` deliberately carries no foreign key to `auth.users` (0024 §4), and
 * PostgREST does not expose that schema, so an actor column would be a page of bare
 * uuids and an actor *grouping* would be a page of bare uuid headings. The school
 * name is the only human identity `activity_events` can be joined to, and it is
 * already a column below.
 *
 * WHY IT CANNOT 500. This branch deploys on push and migrations 0024/0025 are not
 * applied, so `activity_events` does not exist in production: every select against
 * it comes back `PGRST205`. `auditLogState` reads that as `absent` and the page says
 * so in plain words. Anything it does not recognise is `failed` and is printed —
 * never swallowed into an empty table that looks like a quiet division.
 */

/**
 * Newest 100, unpaged.
 *
 * Not `fetchAll`: that exists for reads whose *correctness* depends on
 * completeness — a roster count, a judging board — and this page makes no claim
 * about a total it has not seen, because the exact count rides along on the same
 * request and `auditRangeLabel` states it. Paging an append-only log is a real
 * feature (a cursor on `(at, id)`); it is not this task, and 100 rows is what fits
 * a read.
 */
const AUDIT_LIMIT = 100;

interface AuditLoad {
  state: AuditLogState;
  rows: AuditRow[];
  /** PostgREST's exact count of the whole table, null when it did not come back. */
  total: number | null;
  /** The failure to show a reader, when there is one. */
  message: string | null;
}

async function loadAuditLog(supabase: SupabaseServerClient): Promise<AuditLoad> {
  try {
    const { data, error, count } = await supabase
      .from("activity_events")
      // `at desc, id desc` and not `at` alone: 0025 stamps a whole locking action
      // in one instant, so ties are ordinary here and an unstable order would
      // shuffle which of them the limit drops between two loads.
      .select("id, at, session_id, school_id, kind, label, school:schools(name)", {
        count: "exact",
      })
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(AUDIT_LIMIT)
      .overrideTypes<AuditEventRow[]>();

    const state = auditLogState(error);
    return {
      state,
      rows: state === "ok" ? buildAuditRows(data ?? []) : [],
      total: count ?? null,
      message: state === "failed" ? (error?.message ?? null) : null,
    };
  } catch (cause) {
    // A transport failure throws rather than returning an error object, and an
    // uncaught throw is a 500 on the one page whose job is to report state.
    return {
      state: "failed",
      rows: [],
      total: null,
      message: cause instanceof Error ? cause.message : "The action log could not be read.",
    };
  }
}

/** The badge, which must never say "Quiet" about a log that could not be read. */
function badgeFor(load: AuditLoad): string {
  if (load.state === "absent") return "Not recording";
  if (load.state === "failed") return "Unavailable";
  return load.rows.length === 0 ? "Quiet" : `Newest ${load.rows.length}`;
}

export default async function AuditLogsPage() {
  const { supabase } = await requireAdmin();
  const load = await loadAuditLog(supabase);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Audit Logs"
        badge={badgeFor(load)}
        subtitle="Every recorded write, one row per action — the detail the activity log folds into a sentence."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/activity">
              Grouped by session
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />

      {load.state === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>The action log could not be read</AlertTitle>
          <AlertDescription>
            {/* Printed, not summarised. An audit page that hides its own failure
                behind an empty table reads as a division that did nothing. */}
            {load.message ?? "The database returned an error without a message."}
          </AlertDescription>
        </Alert>
      ) : null}

      {load.state === "absent" ? (
        <Alert>
          <Clock />
          <AlertTitle>Nothing is being recorded yet</AlertTitle>
          <AlertDescription>
            The <code className="text-xs">activity_events</code> table is not on this
            database. It arrives with{" "}
            <code className="text-xs">0024_activity_events.sql</code> and the triggers in{" "}
            <code className="text-xs">0025_activity_triggers.sql</code>; until both are
            applied, no write is logged and this page has nothing to show. The activity log
            still works — it reads the six timestamp columns the schema already keeps.
          </AlertDescription>
        </Alert>
      ) : null}

      {load.state === "ok" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recorded actions</CardTitle>
            <CardDescription>{auditRangeLabel(load.rows.length, load.total)}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* `Table` brings its own `overflow-x-auto` container, so five columns
                scroll inside the card on a phone and the page body never moves
                sideways. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {load.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="block tabular-nums">{row.time}</span>
                      <span className="block text-xs text-muted-foreground">{row.day}</span>
                    </TableCell>
                    <TableCell className="font-medium">{row.school}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    {/* Words, not a dash: a screen reader reads an em dash as
                        nothing at all, and "no detail" is a fact about the row. */}
                    <TableCell className="text-muted-foreground">
                      {row.detail ?? <span className="text-xs">No detail recorded</span>}
                    </TableCell>
                    <TableCell>
                      {row.session ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {row.session}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No session</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {load.rows.length === 0 && (
                  <TableRow>
                    {/* `whitespace-normal` because `TableCell` sets nowrap in its
                        base, and this sentence has to wrap on a phone. */}
                    <TableCell colSpan={5} className="py-10 text-center whitespace-normal">
                      <p className="mx-auto max-w-[60ch] text-sm text-balance text-muted-foreground">
                        The log is recording, but nothing has been written since it started.
                        Rows appear here as schools add learners, register coaches and submit
                        entries.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What this log does not answer</CardTitle>
          <CardDescription>
            So nothing here is read as a complete record of who changed what.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="font-medium text-foreground">Administrative changes.</strong>{" "}
              The triggers sit on the tables schools write — learners, coaches, entries,
              school papers. An admin unlocking a submission or editing an event leaves no row
              here.
            </li>
            <li>
              <strong className="font-medium text-foreground">Names of people.</strong> Each
              row stores the signed-in user id, but nothing maps a uuid to a name yet, so the
              actor shown is the school whose data changed.
            </li>
            <li>
              <strong className="font-medium text-foreground">
                What a record said before.
              </strong>{" "}
              Detail is the subject&apos;s name as it stood at the time of the write, kept so a
              deleted learner still reads as a name. It is not a before-and-after of the row.
            </li>
            <li>
              <strong className="font-medium text-foreground">Retention.</strong> Nothing
              purges this table, and it holds the names of minors indefinitely. That is a
              decision still to be made, not a setting on this page.
            </li>
            <li>
              A row marked <span className="whitespace-nowrap">No session</span> was written
              without a signed-in session — a seeder, an admin script, the SQL console — so it
              cannot be grouped with anything, here or on the activity log.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
