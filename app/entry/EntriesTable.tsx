"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { deleteEntryAction } from "./actions";
import type { EntryRow } from "./types";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function participantSummary(entry: EntryRow): string {
  const [first, ...rest] = entry.participants;
  if (!first) return "—";
  return rest.length > 0 ? `${first.full_name} +${rest.length}` : first.full_name;
}

export function EntriesTable({
  entries,
  onCreate,
  onEdit,
  locked,
}: {
  entries: EntryRow[];
  onCreate: () => void;
  onEdit: (entry: EntryRow) => void;
  locked: boolean;
}) {
  const router = useRouter();
  const [pendingDelete, setPendingDelete] = useState<EntryRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    startTransition(async () => {
      const result = await deleteEntryAction(target.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Entry deleted.");
        router.refresh();
      }
      setPendingDelete(null);
    });
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <FilePlus2 className="size-5" />
        </span>
        <div>
          <p className="font-medium">No entries yet</p>
          <p className="text-sm text-muted-foreground">
            Add the contests your school is joining.
          </p>
        </div>
        <Button onClick={onCreate} disabled={locked}>
          Create your first entry
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Language</TableHead>
              <TableHead>Participants</TableHead>
              <TableHead>Coaches</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.event_name}</TableCell>
                <TableCell>
                  <LevelBadge level={entry.level} />
                </TableCell>
                <TableCell>
                  <LanguageBadge language={entry.language} />
                </TableCell>
                <TableCell>{participantSummary(entry)}</TableCell>
                <TableCell>
                  {entry.coaches.map((c) => c.full_name).join(", ") || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.submitted_label}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Entry actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={locked} onClick={() => onEdit(entry)}>
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={locked}
                        onClick={() => setPendingDelete(entry)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.event_name} will be removed along with its participants and
              coaches. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
