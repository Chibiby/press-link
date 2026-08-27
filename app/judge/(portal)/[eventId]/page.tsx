import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, Lock } from "lucide-react";

import { RankingSheetForm } from "@/components/judging/RankingSheetForm";
import { submitJudgeSheetAction } from "../../actions";
import { loadJudgeSheet } from "../../judge-data";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUND_LABEL, ROUND_SCOPE } from "@/lib/judging/round";
import { sheetEditable } from "@/lib/judging/sheet-state";

/**
 * One event's ranking sheet.
 *
 * The round is not a query parameter and not a choice: a judge's seat decides
 * which round they judge (N1), so this page renders the one sheet that is
 * theirs. Offering a round switcher would offer a judge a round they cannot
 * write to and would have to refuse.
 */
export default async function JudgeSheetPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const { sheet, error } = await loadJudgeSheet(eventId);

  // A failed read must not render as a missing event: `notFound()` here would
  // tell a judge the contest they were assigned to does not exist
  // (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeading title="Ranking sheet" subtitle="This sheet could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load this sheet</AlertTitle>
          <AlertDescription>
            {error} Nothing you have ranked has been lost. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Genuinely not this judge's event — no seat, or a seat on no round. 404 rather
  // than an explanation: a judge must not learn from a refusal whether an event
  // they are not seated on exists at all.
  if (!sheet) notFound();

  const editable = sheetEditable(sheet.state);

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeading
        title={sheet.typeNameEn}
        subtitle={`${sheet.typeNameFil} · ${sheet.slotLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Seat {sheet.seat}</Badge>
            <Badge variant="secondary">{ROUND_LABEL[sheet.round]}</Badge>
          </div>
        }
      />

      {!editable ? (
        <Alert>
          <Lock className="size-4" />
          <AlertTitle>This sheet is read-only</AlertTitle>
          <AlertDescription>{sheet.state.reason}</AlertDescription>
        </Alert>
      ) : null}

      {sheet.notice ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>About this field</AlertTitle>
          <AlertDescription>{sheet.notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ROUND_LABEL[sheet.round]}</CardTitle>
          <CardDescription>
            {ROUND_SCOPE[sheet.round]} {sheet.spec.hint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sheet.units.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {sheet.round === 1
                ? "This event has no contestants on file yet."
                : "No qualifiers have been drawn for this event yet."}
            </p>
          ) : (
            <RankingSheetForm
              units={sheet.units}
              spec={sheet.spec}
              initialDraft={sheet.draft}
              editable={editable}
              // Bound here rather than wrapped in a closure: a server action keeps
              // its identity across the boundary through `bind`, and the event id
              // is then fixed on the server instead of arriving from the form.
              onSubmit={submitJudgeSheetAction.bind(null, sheet.eventId)}
              submitLabel="Submit sheet"
              confirmTitle="Submit this sheet?"
              confirmLead="Submitting locks your sheet. You will not be able to change a rank afterwards — an administrator has to unlock it for you."
              confirmAction="Submit and lock"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild size="sm" variant="ghost" className="-ml-2">
      <Link href="/judge">
        <ArrowLeft />
        Your events
      </Link>
    </Button>
  );
}
