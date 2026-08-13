"use client";

import { useState } from "react";
import { Lock, Newspaper, Plus } from "lucide-react";

import { EntriesTable } from "./EntriesTable";
import { EntryWizard } from "./EntryWizard";
import { SchoolPaperDialog } from "./SchoolPaperDialog";
import type { EntryRow, SchoolPaperRow } from "./types";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function EntryDashboard({
  entries,
  types,
  events,
  papers,
  locked,
}: {
  entries: EntryRow[];
  types: EventTypeRow[];
  events: EventRow[];
  papers: SchoolPaperRow[];
  locked: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);

  const missingPapers = (["english", "filipino"] as const).filter(
    (lang) => !papers.some((p) => p.language === lang)
  );

  function openCreate() {
    setEditing(null);
    setWizardOpen(true);
  }

  function openEdit(entry: EntryRow) {
    setEditing(entry);
    setWizardOpen(true);
  }

  return (
    <div className="flex flex-col gap-6">
      {locked && (
        <Alert>
          <Lock />
          <AlertTitle>Submissions are closed</AlertTitle>
          <AlertDescription>
            Your entries are read-only. Contact the division office if you need a change.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
          <p className="text-sm text-muted-foreground">
            Every contest your school is competing in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPaperOpen(true)}>
            <Newspaper className="size-4" />
            School Paper
            {missingPapers.length > 0 && (
              <Badge
                variant="outline"
                className="ml-1 border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning"
              >
                {missingPapers.length} to fill
              </Badge>
            )}
          </Button>
          <Button onClick={openCreate} disabled={locked}>
            <Plus className="size-4" />
            Create Entry
          </Button>
        </div>
      </div>

      <EntriesTable
        entries={entries}
        locked={locked}
        onCreate={openCreate}
        onEdit={openEdit}
      />

      <EntryWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        types={types}
        events={events}
        entry={editing}
      />

      <SchoolPaperDialog
        open={paperOpen}
        onOpenChange={setPaperOpen}
        papers={papers}
        locked={locked}
      />
    </div>
  );
}
