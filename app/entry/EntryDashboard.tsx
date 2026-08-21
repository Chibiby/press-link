"use client";

import { useState } from "react";
import { Lock, Newspaper, Plus } from "lucide-react";

import { EntriesTable } from "./EntriesTable";
import { EntryWizard } from "./EntryWizard";
import { LockSubmissionDialog } from "./LockSubmissionDialog";
import { PaperGateDialog } from "./PaperGateDialog";
import { RosterPanel } from "./RosterPanel";
import { SchoolPaperDialog } from "./SchoolPaperDialog";
import type {
  EntryRow,
  PaperParticipation,
  RosterCoach,
  RosterParticipant,
  ArchivedPaperRow,
  SchoolPaperRow,
} from "./types";
import type { PaperFlowState } from "@/lib/paper/gate";
import { PAPER_LEVEL_LABEL } from "@/lib/paper/level";
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
  archivedPapers,
  participants,
  coaches,
  usage,
  paperFlow,
  paperStatus,
  participation,
  isIntegrated,
}: {
  entries: EntryRow[];
  types: EventTypeRow[];
  events: EventRow[];
  papers: SchoolPaperRow[];
  archivedPapers: ArchivedPaperRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  /** Where the school stands on its school paper — see lib/paper/gate.ts. */
  paperFlow: PaperFlowState;
  /** The three-state label shared with the admin pages. */
  paperStatus: PaperStatus;
  participation: PaperParticipation;
  /** Integrated schools file two papers per language — see lib/paper/level.ts. */
  isIntegrated: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  // null = follow the derived default; true/false = the user has taken over.
  const [paperOpenOverride, setPaperOpenOverride] = useState<boolean | null>(null);
  const [gateOpenOverride, setGateOpenOverride] = useState(false);

  // Each dialog is forced open while its stage is unfinished; only then can the
  // school open it itself.
  const paperOpen = paperFlow.paperFormOpen || (paperOpenOverride ?? false);
  const gateOpen = paperFlow.askQuestion || gateOpenOverride;

  function openCreate() {
    setEditing(null);
    setWizardOpen(true);
  }

  function openEdit(entry: EntryRow) {
    setEditing(entry);
    setWizardOpen(true);
  }

  const canCreateEntry =
    !paperFlow.submissionLocked && participants.length > 0 && coaches.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <PaperGateDialog
        open={gateOpen}
        onOpenChange={setGateOpenOverride}
        required={paperFlow.askQuestion}
        current={participation}
      />

      {paperFlow.submissionLocked && (
        <Alert>
          <Lock />
          <AlertTitle>Your submission is locked</AlertTitle>
          <AlertDescription>
            Everything below is read-only. Contact the division office if you need a
            change.
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
            {paperFlow.submissionLocked && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                Locked
              </Badge>
            )}
            {paperFlow.canAnswer && !paperFlow.askQuestion && (
              <Button variant="ghost" size="sm" onClick={() => setGateOpenOverride(true)}>
                Change contest answer
              </Button>
            )}
            <LockSubmissionDialog
              canLock={paperFlow.canLock}
              locked={paperFlow.submissionLocked}
            />
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
                : paperFlow.missingLevels.length > 0 &&
                    !paperFlow.missingLevels.includes("whole")
                  ? `Your school files a separate elementary and secondary paper. Still to file: ${paperFlow.missingLevels
                      .map((level) => PAPER_LEVEL_LABEL[level])
                      .join(" and ")} — either language. Participants and coaches open once both are saved.`
                  : "Fill in your school paper — English, Filipino, or both. Participants and coaches open once at least one is saved and you have answered the contest question."}
            </AlertDescription>
          </Alert>
        )}

        <RosterPanel
          participants={participants}
          coaches={coaches}
          usage={usage}
          locked={paperFlow.submissionLocked || !paperFlow.rosterEnabled}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
            <p className="text-sm text-muted-foreground">
              {paperFlow.submissionLocked
                ? "Your submission is locked. Contact the division office if you need a change."
                : canCreateEntry
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
          onCreate={openCreate}
          onEdit={openEdit}
          locked={paperFlow.submissionLocked}
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
        archivedPapers={archivedPapers}
        locked={paperFlow.submissionLocked}
        required={paperFlow.paperFormOpen}
        isIntegrated={isIntegrated}
      />
    </div>
  );
}
