import { ArrowLeft, Info, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeading } from "@/components/admin/shell/PageHeading";
import { RankingSheetForm } from "@/components/judging/RankingSheetForm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUND_LABEL, ROUND_SCOPE } from "@/lib/judging/round";

import { loadSheetEntry } from "../../../../judging-data";
import { enterJudgeSheetAction } from "../../../actions";

/**
 * Encoding one judge's paper sheet (N9).
 *
 * The division judges on paper at the venue and encodes afterwards, so this is not a
 * repair path for a judge who could not sign in — it is how most sheets arrive. It
 * writes the same sheet the judge's own screen writes, through `admin_enter_sheet`,
 * which validates identically and differs only in whose id lands in `entered_by`.
 *
 * ## Why this is a page and not a dialog on the panel card
 *
 * Four seats' unit sets would have to ride into the browser with the panel card for a
 * dialog to open without a round trip, and a sheet is not a small object — it is
 * every contestant in the event. A page loads exactly the one sheet being typed, and
 * gets an address that can be left open on a second screen while somebody reads the
 * ranks out, which is the shape the work actually takes.
 *
 * ## What is not on this page
 *
 * No names. The sheet is codes and ranks, the same two columns the judge sees, and
 * the judge's own name is here only because an admin has to know whose paper they are
 * holding. The identified side of this event lives on the tabulators' pages and is
 * reached by a different loader entirely (non-negotiable 1).
 */
export default async function EnterSheetPage({
  params,
}: {
  params: Promise<{ eventId: string; judgeId: string }>;
}) {
  const { eventId, judgeId } = await params;
  const { entry, error } = await loadSheetEntry(eventId, judgeId);

  // A failed read must not render as a missing seat: `notFound()` here would tell an
  // admin the judge is not on this panel (non-negotiable 5).
  if (error) {
    return (
      <div className="space-y-6">
        <BackLink eventId={eventId} />
        <PageHeading title="Enter a sheet" subtitle="This sheet could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load this sheet</AlertTitle>
          <AlertDescription>
            {error} Nothing is shown — this is not a report that the seat is empty or
            that the event has no contestants. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!entry) notFound();

  return (
    <div className="space-y-6">
      <BackLink eventId={eventId} />

      <PageHeading
        title={`Seat ${entry.seat} · ${entry.judgeName}`}
        subtitle={`${entry.typeNameEn} · ${entry.slotLabel} · entering ${ROUND_LABEL[
          entry.round
        ].toLowerCase()} from paper`}
      />

      {entry.entry.canEnter ? null : (
        <Alert>
          <Lock className="size-4" />
          <AlertTitle>This sheet cannot be typed right now</AlertTitle>
          {/* The sentence is `sheetEntryState`'s, not this page's, so the obstacle an
              admin is told to clear is the one the database will also insist on. */}
          <AlertDescription>{entry.entry.reason}</AlertDescription>
        </Alert>
      )}

      {entry.entry.canEnter && entry.draft && Object.values(entry.draft).some((r) => r !== null) ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>This sheet was reopened</AlertTitle>
          <AlertDescription>
            The ranks below are what was filed before it was reopened, not a fresh
            sheet. Correct what is wrong and save; saving submits and locks it again.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ROUND_LABEL[entry.round]}</CardTitle>
          <CardDescription>
            {ROUND_SCOPE[entry.round]} {entry.spec.hint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entry.units.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {entry.round === 1
                ? "This event has no contestants on file yet, so there is nothing to rank."
                : "No qualifiers have been drawn for this event yet."}
            </p>
          ) : (
            <RankingSheetForm
              units={entry.units}
              spec={entry.spec}
              initialDraft={entry.draft}
              editable={entry.entry.canEnter}
              // Bound on the server, so the event and the judge this sheet belongs to
              // are fixed here rather than arriving from the form.
              onSubmit={enterJudgeSheetAction.bind(null, entry.eventId, entry.judgeId)}
              submitLabel="Save sheet"
              confirmTitle={`Save ${entry.judgeName}'s sheet?`}
              confirmLead={`This is recorded as ${entry.judgeName}'s ranks and locks immediately — the same as if they had submitted it themselves, except that it records you as the one who typed it. To change it afterwards you have to reopen the sheet.`}
              confirmAction="Save and lock"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink({ eventId }: { eventId: string }) {
  return (
    <Button asChild size="sm" variant="ghost" className="-ml-2">
      <Link href={`/admin/judges/${eventId}`}>
        <ArrowLeft />
        Back to the panel
      </Link>
    </Button>
  );
}
