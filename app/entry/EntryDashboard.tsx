"use client";

import { useState } from "react";
import { Lock, Newspaper, Plus } from "lucide-react";

import { EntriesTable } from "./EntriesTable";
import { EntryWizard } from "./EntryWizard";
import { PaperGateDialog } from "./PaperGateDialog";
import { RosterPanel } from "./RosterPanel";
import { SchoolPaperDialog } from "./SchoolPaperDialog";
import type {
  EntryRow,
  RosterCoach,
  RosterParticipant,
  SchoolPaperRow,
} from "./types";
import {
  DECLINE_REASON_LABELS,
  type PaperDeclineReason,
  type PaperParticipation,
} from "@/lib/paper/gate";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { type UsageMap } from "@/lib/roster/limits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function EntryDashboard({
  entries,
  types,
  events,
  papers,
  participants,
  coaches,
  usage,
  participation,
  declineReason,
  askPaperQuestion,
  paperFormEnabled,
  locked,
}: {
  entries: EntryRow[];
  types: EventTypeRow[];
  events: EventRow[];
  papers: SchoolPaperRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  participation: PaperParticipation;
  declineReason: PaperDeclineReason | null;
  /** The school still owes an answer — see lib/paper/gate.ts. */
  askPaperQuestion: boolean;
  /** False once the school has firmly refused; only an admin can reopen it. */
  paperFormEnabled: boolean;
  locked: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  // null = follow the derived default; true/false = the user has taken over.
  const [paperOpenOverride, setPaperOpenOverride] = useState<boolean | null>(null);
  /** The answer given in this visit, so the gate does not re-ask immediately. */
  const [answeredThisVisit, setAnsweredThisVisit] = useState<"yes" | "no" | null>(null);

  const paperDeclined = !paperFormEnabled;
  const missingPapers = (["english", "filipino"] as const).filter(
    (lang) => !papers.some((p) => p.language === lang)
  );

  // `askPaperQuestion` stays true for a Yes school with nothing saved — that is
  // what brings the question back on the next visit. Without remembering the
  // answer given just now, re-answering Yes would simply re-open the question,
  // so the gate closes for the rest of this visit once it has been answered.
  const answered = answeredThisVisit ?? (askPaperQuestion ? null : participation);
  const gateOpen = askPaperQuestion && answeredThisVisit === null;

  // A school that means to submit lands straight in the form rather than having
  // to find the button. While it is open for that reason it cannot be
  // dismissed: saving is the way out.
  const paperRequired = paperFormEnabled && answered === "yes" && papers.length === 0;
  const paperOpen = paperOpenOverride ?? paperRequired;

  function openCreate() {
    setEditing(null);
    setWizardOpen(true);
  }

  function openEdit(entry: EntryRow) {
    setEditing(entry);
    setWizardOpen(true);
  }

  const canCreateEntry = !locked && participants.length > 0 && coaches.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <PaperGateDialog open={gateOpen} onAnswered={setAnsweredThisVisit} />

      {locked && (
        <Alert>
          <Lock />
          <AlertTitle>Submissions are closed</AlertTitle>
          <AlertDescription>
            Your entries are read-only. Contact the division office if you need a change.
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
            <p className="text-sm text-muted-foreground">
              Register everyone first — entries pick from this list.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={paperDeclined}
            onClick={() => setPaperOpenOverride(true)}
          >
            <Newspaper className="size-4" />
            School Paper
            {paperDeclined ? (
              <Badge variant="outline" className="ml-1">
                Not submitting
              </Badge>
            ) : (
              missingPapers.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning"
                >
                  {missingPapers.length} to fill
                </Badge>
              )
            )}
          </Button>
        </div>

        {paperDeclined && (
          <Alert>
            <Newspaper />
            <AlertTitle>School Paper closed</AlertTitle>
            <AlertDescription>
              {declineReason
                ? `You answered: ${DECLINE_REASON_LABELS[declineReason].toLowerCase()}.`
                : "You answered that your school is not submitting a paper."}{" "}
              The division office can reopen this for you.
            </AlertDescription>
          </Alert>
        )}

        <RosterPanel
          participants={participants}
          coaches={coaches}
          usage={usage}
          locked={locked}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
            <p className="text-sm text-muted-foreground">
              {canCreateEntry
                ? "Every contest your school is competing in."
                : "Add at least one participant and one coach before creating an entry."}
            </p>
          </div>
          <Button onClick={openCreate} disabled={!canCreateEntry}>
            <Plus className="size-4" />
            Create Entry
          </Button>
        </div>

        <EntriesTable
          entries={entries}
          locked={locked}
          onCreate={openCreate}
          onEdit={openEdit}
        />
      </section>

      <EntryWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        types={types}
        events={events}
        participants={participants}
        coaches={coaches}
        usage={usage}
        entries={entries}
        entry={editing}
      />

      <SchoolPaperDialog
        open={paperOpen}
        onOpenChange={setPaperOpenOverride}
        papers={papers}
        locked={locked || paperDeclined}
        required={paperRequired}
      />
    </div>
  );
}
