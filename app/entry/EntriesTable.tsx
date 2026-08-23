"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePlus2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { deleteEntryAction } from "./actions";
import {
  ANY,
  filterEntries,
  type CategoryFilter,
  type LanguageFilter,
  type LevelFilter,
} from "./list-filters";
import { ListPager, useListPage } from "./ListPager";
import { ListToolbar } from "./ListToolbar";
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

/**
 * One name plus a count, not the whole list. The table sits in half the page
 * beside the roster, and a group event's five names would set the row height
 * for every other row.
 */
function nameSummary(people: { full_name: string }[]): string {
  const [first, ...rest] = people;
  if (!first) return "—";
  return rest.length > 0 ? `${first.full_name} +${rest.length}` : first.full_name;
}

/** The row menu rides along the right edge so it is always reachable. */
const ACTION_CELL =
  "sticky right-0 w-12 border-l bg-background group-hover/row:bg-muted/50 group-has-aria-expanded/row:bg-muted/50";

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
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>(ANY);
  const [language, setLanguage] = useState<LanguageFilter>(ANY);
  const [category, setCategory] = useState<CategoryFilter>(ANY);

  // The whole list is already on the client, so narrowing it is a render away —
  // no search params, no round trip.
  const shown = useMemo(
    () => filterEntries(entries, { query, level, language, category }),
    [entries, query, level, language, category]
  );
  const { rows, topRef, reset, pager } = useListPage(shown);

  function clearFilters() {
    setQuery("");
    setLevel(ANY);
    setLanguage(ANY);
    setCategory(ANY);
    reset();
  }

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
      <div ref={topRef} className="flex scroll-mt-28 flex-col gap-3">
        <ListToolbar
          searchPlaceholder="Search event, participant, or coach"
          query={query}
          onQueryChange={(value) => {
            // A new search re-numbers the pages under it, so page 4 of the
            // old list is not a place to stay.
            setQuery(value);
            reset();
          }}
          filters={[
            {
              value: level,
              onChange: (value) => {
                setLevel(value as LevelFilter);
                reset();
              },
              placeholder: "All levels",
              options: [
                { value: "elementary", label: "Elementary" },
                { value: "secondary", label: "Secondary" },
              ],
              ariaLabel: "Filter entries by level",
            },
            {
              value: language,
              onChange: (value) => {
                setLanguage(value as LanguageFilter);
                reset();
              },
              placeholder: "All languages",
              options: [
                { value: "english", label: "English" },
                { value: "filipino", label: "Filipino" },
              ],
              ariaLabel: "Filter entries by language",
            },
            {
              value: category,
              onChange: (value) => {
                setCategory(value as CategoryFilter);
                reset();
              },
              // Last of the three, so it takes the whole second row on a phone
              // and leaves the pair a school already knows where it was.
              placeholder: "All types",
              options: [
                { value: "individual", label: "Individual" },
                { value: "group", label: "Group" },
              ],
              ariaLabel: "Filter entries by type",
            },
          ]}
          shown={shown.length}
          total={entries.length}
          onClear={clearFilters}
        />

        {shown.length === 0 ? (
          // Quieter than "No entries yet" on purpose: the school has entries,
          // it just cannot see them from here.
          <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
            No entries match {query.trim() ? `“${query.trim()}”` : "these filters"}.{" "}
            <Button variant="link" className="h-auto p-0" onClick={clearFilters}>
              Clear
            </Button>
          </p>
        ) : (
          <Table containerClassName="rounded-xl border">
            {/* Below sm every column but the event folds into it, so a lone "Event"
                header would under-describe the cell. The section heading labels the
                list there. */}
            <TableHeader className="hidden sm:table-header-group">
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="hidden sm:table-cell">Participants</TableHead>
                <TableHead className="hidden sm:table-cell">Coaches</TableHead>
                <TableHead className="hidden w-24 sm:table-cell">Submitted</TableHead>
                <TableHead className={ACTION_CELL} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.id} className="group/row">
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{entry.event_name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <LevelBadge level={entry.level} />
                      <LanguageBadge language={entry.language} />
                    </span>
                    {/* Too narrow for their own columns, the three on the right fold
                        in here, so a phone reads down the list instead of sideways. */}
                    <span className="mt-1.5 flex flex-col gap-0.5 text-xs font-normal text-muted-foreground sm:hidden">
                      <span>{nameSummary(entry.participants)}</span>
                      <span>Coach {nameSummary(entry.coaches)}</span>
                      {entry.submitted_at && (
                        <span>Submitted {entry.submitted_label}</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal sm:table-cell">
                    {nameSummary(entry.participants)}
                  </TableCell>
                  <TableCell className="hidden whitespace-normal sm:table-cell">
                    {nameSummary(entry.coaches)}
                  </TableCell>
                  <TableCell className="hidden text-xs whitespace-normal text-muted-foreground sm:table-cell">
                    {entry.submitted_label}
                  </TableCell>
                  <TableCell className={ACTION_CELL}>
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
        )}

        <ListPager {...pager} label="Entries" />
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
