"use client";

import { useState } from "react";
import { Lock, Newspaper, Plus, Trophy, Users } from "lucide-react";

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

  const rosterCount = participants.length + coaches.length;

  return (
    <div className="flex flex-col gap-6">
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

      {/* Paper and lock state cover the whole submission rather than either
          list, so they sit above the split instead of inside the roster.

          State on the left, then the actions in the order they matter to a
          school: a rare answer change as a text link, the one-way lock as a
          ghost, and the paper it opens every visit as the only filled-in
          button. They used to be four pills of the same weight, which on a
          phone gave a new school nothing to look at first. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Badge
          variant={paperStatus === "submitted" ? "default" : "secondary"}
          className="gap-1"
        >
          {PAPER_STATUS_LABEL[paperStatus]}
        </Badge>
        {/* A locked school already has the alert above; a Locked badge and a
            dead Lock button next to it said the same thing two more times. */}
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {paperFlow.canAnswer && !paperFlow.askQuestion && (
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setGateOpenOverride(true)}
            >
              Change contest answer
            </Button>
          )}
          {!paperFlow.submissionLocked && (
            <LockSubmissionDialog canLock={paperFlow.canLock} />
          )}
          {/* Taller than the rest below sm: the one thing here worth a thumb. */}
          <Button
            variant="outline"
            className="h-9 sm:h-8"
            onClick={() => setPaperOpenOverride(true)}
          >
            <Newspaper className="size-4" />
            School Paper
          </Button>
        </div>
      </div>

      {/* Side by side once the screen is wide enough for both, and stacked
          below that — the roster first, the entries directly under it. Each
          list pages ten rows at a time, so the roster stays short enough for
          the entries to sit within reach of it instead of a screen further on.
          The subgrid keeps both headings and both lists on the same lines, and
          min-w-0 keeps a column from widening to its table’s min-content —
          without it the whole page scrolls sideways on a phone. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-8">
        <section className="flex min-w-0 flex-col gap-4 xl:row-span-2 xl:grid xl:grid-rows-subgrid">
          {/* The tile and the rule give each half of the page a head and a
              body; the roster's is muted and the entries' is tinted, because
              the roster is what you fill in and the entries are the point. */}
          <div className="flex flex-col gap-1 border-b pb-3">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Users className="size-4" />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
              <Badge variant="secondary">
                {rosterCount} {rosterCount === 1 ? "person" : "people"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Register everyone first — entries pick from this list.
            </p>
          </div>

          <div className="flex flex-col gap-4">
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
          </div>
        </section>

        {/* Hugs its content. Stretched to the roster height, a school with a
            handful of entries got a tall empty box under its last row. */}
        <section className="flex min-w-0 flex-col gap-4 xl:row-span-2 xl:grid xl:grid-rows-subgrid xl:items-start">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Trophy className="size-4" />
                </span>
                <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
                <Badge variant="secondary">
                  {entries.length} {entries.length === 1 ? "entry" : "entries"}
                </Badge>
              </div>
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
      </div>

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
