"use client";

import type { EntryRow } from "./types";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One roster list inside the dialog. Participants keep the number a school wrote
 * on its own forms; coaches have none, so the column collapses for them.
 */
function PeopleList({
  heading,
  people,
  empty,
}: {
  heading: string;
  people: { id: string; full_name: string; number_label?: string }[];
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {heading}
        {people.length > 0 && ` (${people.length})`}
      </h3>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {people.map((person) => (
            <li key={person.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
              {person.number_label && (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {person.number_label}
                </span>
              )}
              <span className="min-w-0">{person.full_name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The whole of one entry, read-only.
 *
 * The table can only afford "Dela Cruz, Ana +6" in the width it has, so a group
 * of seven is unreadable from the row itself. This is the only way to see who is
 * actually on an entry — and the only one that keeps working after a submission
 * is locked, when Edit and Delete are both disabled and reading is all that is
 * left.
 *
 * Deliberately without actions of its own: Edit is a click away in the same menu
 * that opened this, and a second Edit button here would be a second answer to the
 * question of where entries are changed.
 */
export function EntryDetailsDialog({
  entry,
  onOpenChange,
}: {
  entry: EntryRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pe-6 text-left">{entry?.event_name}</DialogTitle>
          <DialogDescription className="text-left">
            {entry?.submitted_at
              ? `Submitted ${entry.submitted_label}`
              : "Not submitted yet."}
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1">
              <LevelBadge level={entry.level} />
              <LanguageBadge language={entry.language} />
              {/* The one fact the row does not show at all, and now the one a
                  school can filter the list by. */}
              <Badge variant="secondary">
                {entry.category === "group" ? "Group" : "Individual"}
              </Badge>
            </div>

            <PeopleList
              heading="Participants"
              people={entry.participants}
              empty="No participants on this entry."
            />
            <PeopleList
              heading="Coaches"
              people={entry.coaches}
              empty="No coach on this entry."
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
