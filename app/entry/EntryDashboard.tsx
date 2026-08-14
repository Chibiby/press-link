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
  PaperParticipation,
  RosterCoach,
  RosterParticipant,
  SchoolPaperRow,
} from "./types";
import type { PaperFlowState } from "@/lib/paper/gate";
import { PAPER_STATUS_LABEL, type PaperStatus } from "@/lib/paper/status";
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
  paperStatus,
  participation,
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
  /** The three-state label shared with the admin pages. */
  paperStatus: PaperStatus;
  participation: PaperParticipation;
  locked: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  // null = follow the derived default; true/false = the user has taken over.
  const [paperOpenOverride, setPaperOpenOverride] = useState<boolean | null>(null);
  const [gateOpenOverride, setGateOpenOverride] = useState(false);

  // Each dialog is forced open while its stage is unfinished; only then can the
  // school open it itself.
  const paperOpen = (paperFlow.paperFormOpen && !locked) || (paperOpenOverride ?? false);
  const gateOpen = paperFlow.askQuestion || gateOpenOverride;

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
      <PaperGateDialog
        open={gateOpen}
        onOpenChange={setGateOpenOverride}
        required={paperFlow.askQuestion}
        current={participation}
      />

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
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={paperStatus === "submitted" ? "default" : "secondary"}
              className="gap-1"
            >
              {PAPER_STATUS_LABEL[paperStatus]}
            </Badge>
            {paperFlow.paperFormLocked && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                Locked
              </Badge>
            )}
            {paperFlow.canAnswer && !paperFlow.askQuestion && !locked && (
              <Button variant="ghost" size="sm" onClick={() => setGateOpenOverride(true)}>
                Change contest answer
              </Button>
            )}
            <Button variant="outline" onClick={() => setPaperOpenOverride(true)}>
              <Newspaper className="size-4" />
              School Paper
            </Button>
          </div>
        </div>

        {!paperFlow.rosterEnabled && (
          <Alert>
            <Newspaper />
            <AlertTitle>Finish your School Paper first</AlertTitle>
            <AlertDescription>
              {paperFlow.phase === "question"
                ? "Answer whether this school paper goes to the contest. Participants and coaches open either way."
                : "Fill in your school paper — English, Filipino, or both. Participants and coaches open once at least one is saved and you have answered the contest question."}
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

      {/* A globally locked school cannot fill this form, so the stage-1 gate
          stands down: `paperOpen` stops forcing it open and `required` stops
          suppressing the close button. Restoring only the close button would
          not have been enough — the forced-open condition would have re-opened
          the dialog on the very next render. */}
      <SchoolPaperDialog
        open={paperOpen}
        onOpenChange={setPaperOpenOverride}
        papers={papers}
        locked={locked || paperFlow.paperFormLocked}
        required={paperFlow.paperFormOpen && !locked}
        canLock={paperFlow.canLock && !locked}
      />
    </div>
  );
}
