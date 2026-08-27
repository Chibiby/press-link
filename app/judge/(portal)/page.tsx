import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Lock } from "lucide-react";

import { loadJudgeEvents } from "../judge-data";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUND_LABEL, ROUND_SCOPE } from "@/lib/judging/round";
import type { JudgeSheetAccess } from "@/lib/judging/types";

/**
 * The judge's own events.
 *
 * One card per seat, not per event: a judge holds exactly one seat on an event
 * and that seat decides which round they judge (N1), so "News Writing — Round 1"
 * is the whole of what they are being asked to do there. Showing both rounds
 * would offer a judge a round that is not theirs.
 *
 * Nothing here names a contestant, a school or another judge. The page reads the
 * judge's own assignments and sheets and the events catalog, and that is all it
 * has access to (non-negotiable 1).
 */

const ACCESS_BADGE: Record<JudgeSheetAccess, { label: string; variant: "default" | "secondary" | "outline" }> = {
  edit: { label: "Ready to rank", variant: "default" },
  view: { label: "Submitted", variant: "secondary" },
  unavailable: { label: "Not open", variant: "outline" },
};

const ACCESS_ICON = {
  edit: Clock,
  view: CheckCircle2,
  unavailable: Lock,
} as const;

export default async function JudgeEventsPage() {
  const { rows, error } = await loadJudgeEvents();

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Your events" subtitle="Your events could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load your events</AlertTitle>
          <AlertDescription>
            {error} This is not a report that you have no events assigned. Please try
            refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Your events"
        subtitle={
          rows.length === 0
            ? "You are not seated on any event yet."
            : `${rows.length} ${rows.length === 1 ? "event" : "events"} assigned to you.`
        }
        badge={rows.length > 0 ? String(rows.length) : undefined}
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing to rank yet. When the division seats you on an event, it appears here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {rows.map((row) => {
            const badge = ACCESS_BADGE[row.state.access];
            const Icon = ACCESS_ICON[row.state.access];
            const reachable = row.state.access !== "unavailable";

            return (
              <Card key={row.eventId}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">{row.typeNameEn}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {row.typeNameFil} &middot; {row.slotLabel}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>
                      <Icon className="size-3.5" />
                      {badge.label}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">Seat {row.seat}</Badge>
                    {row.round ? (
                      <>
                        <Badge variant="outline">{ROUND_LABEL[row.round]}</Badge>
                        <span className="text-muted-foreground">{ROUND_SCOPE[row.round]}</span>
                      </>
                    ) : (
                      // A seat outside 1-4 is a data fault, not a wider remit. Named
                      // rather than hidden, because the judge is the person who will
                      // notice they have been given nothing to do.
                      <span className="text-muted-foreground">
                        This seat does not sit on either round. Please tell the division
                        office.
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground">{row.state.reason}</p>

                  {reachable ? (
                    <Button asChild size="sm">
                      <Link href={`/judge/${row.eventId}`}>
                        {row.state.access === "edit" ? "Open sheet" : "View sheet"}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
