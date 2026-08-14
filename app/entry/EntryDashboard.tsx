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
import type { PaperFlowState } from "@/lib/paper/gate";
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
  paperFlow,
  locked,
}: {
  entries: EntryRow[];
  types: EventTypeRow[];
  events: EventRow[];
  papers: SchoolPaperRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  /** Where the school stands on its school paper — see lib/paper/gate.ts. */
  paperFlow: PaperFlowState;
  locked: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  // null = follow the derived default; true/false = the user has taken over.
  const [paperOpenOverride, setPaperOpenOverride] = useState<boolean | null>(null);

  // The form is forced open while anything is still owed; only then can the
  // school choose to open it itself.
  const paperOpen = paperFlow.paperFormOpen || (paperOpenOverride ?? false);

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
      <PaperGateDialog open={paperFlow.askQuestion} />

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
          <Button variant="outline" onClick={() => setPaperOpenOverride(true)}>
            <Newspaper className="size-4" />
            School Paper
            {paperFlow.paperFormLocked ? (
              <Badge variant="secondary" className="ml-1">
                Submitted
              </Badge>
            ) : (
              paperFlow.missingLanguages.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning"
                >
                  {paperFlow.missingLanguages.length} to fill
                </Badge>
              )
            )}
          </Button>
        </div>

        {!paperFlow.rosterEnabled && (
          <Alert>
            <Newspaper />
            <AlertTitle>Finish your School Paper first</AlertTitle>
            <AlertDescription>
              {paperFlow.phase === "refill"
                ? "You answered that you are not submitting a school paper entry. Save both languages once more — N/A is accepted — and the roster opens."
                : "Fill in the English and Filipino school paper. Participants and coaches open once both are saved."}
            </AlertDescription>
          </Alert>
        )}

        <RosterPanel
          participants={participants}
          coaches={coaches}
          usage={usage}
          locked={locked || !paperFlow.rosterEnabled}
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
        locked={locked || paperFlow.paperFormLocked}
        required={paperFlow.paperFormOpen}
        allowNotApplicable={paperFlow.allowNotApplicable}
      />
    </div>
  );
}
