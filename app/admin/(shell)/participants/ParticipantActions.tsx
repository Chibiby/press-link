"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Eye,
  Gavel,
  History,
  Loader2,
  MoreHorizontal,
  School,
  TriangleAlert,
} from "lucide-react";

import {
  loadParticipantDetailAction,
  loadParticipantHistoryAction,
  moveParticipantEventAction,
  type ParticipantDetail,
  type ParticipantHistoryRow,
} from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  eventOptionLabel,
  moveConsequences,
  moveDestinations,
  slotLabel,
} from "@/lib/roster/participant-move";

/**
 * The row menu on /admin/participants: look at what a school entered a contestant
 * in, and move them when it is wrong.
 *
 * ## Why the detail is fetched when the menu opens
 *
 * The table is the division's whole roster — 2,273 learners, paged through in full
 * because the count in the heading has to be real. Joining every one of them to
 * their entries, teammates, coaches and the event catalog would multiply that read
 * to answer a question about the one row somebody clicked. So the menu carries an
 * id and nothing else, and `loadParticipantDetailAction` runs on open. It is one
 * participant, and only for a menu that was actually opened.
 *
 * ## Why moving is two clicks when it costs something
 *
 * A move can delete the entry it empties, and can discard a rank a judge has
 * already cast. Both are invisible from the row: the admin came to fix a contest
 * name and has no way of knowing an event has been judged. So the consequences are
 * printed first and the button changes to say what it is about to do. When there is
 * nothing to warn about — the ordinary case, a school that mis-filed a contestant
 * before judging began — it stays one click, because a confirmation nobody needs
 * teaches people to click through the ones they do.
 */
export function ParticipantActions({
  participantId,
  fullName,
}: {
  participantId: string;
  fullName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"view" | "move" | "history" | null>(null);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [history, setHistory] = useState<ParticipantHistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();

  const load = useCallback(
    (next: "view" | "move" | "history") => {
      setOpen(next);
      setLoadError(null);
      // Re-read on every open rather than caching the first one. Another admin may
      // have moved this contestant since; a stale entry list here would offer a move
      // out of an entry that no longer exists, and a stale history would be missing
      // the move that made it stale.
      startLoading(async () => {
        if (next === "history") {
          const result = await loadParticipantHistoryAction(participantId);
          if ("error" in result) {
            setHistory(null);
            setLoadError(result.error);
            return;
          }
          setHistory(result.rows);
          return;
        }
        const result = await loadParticipantDetailAction(participantId);
        if ("error" in result) {
          setDetail(null);
          setLoadError(result.error);
          return;
        }
        setDetail(result.detail);
      });
    },
    [participantId]
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8">
            <MoreHorizontal />
            <span className="sr-only">Actions for {fullName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => load("view")}>
            <Eye />
            View entries
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => load("move")}>
            <ArrowRightLeft />
            Move to another event
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => load("history")}>
            <History />
            View change history
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {/* Three rows, and the middle one is the only one that scrolls.
            `DialogContent` is a bare grid with no height cap of its own, so a move
            form — school, warning, three selects, a consequence list — grew taller
            than the viewport and pushed its own buttons off the bottom of the screen
            with no way to reach them. `minmax(0,1fr)` is what lets the middle row
            shrink below its content; `1fr` alone would not, and the overflow would go
            on escaping. */}
        <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-lg">
          {open === "history" ? (
            <HistoryBody
              fullName={fullName}
              rows={history}
              isLoading={isLoading}
              loadError={loadError}
            />
          ) : open === "view" ? (
            <ViewBody
              fullName={fullName}
              detail={detail}
              isLoading={isLoading}
              loadError={loadError}
            />
          ) : (
            <MoveBody
              participantId={participantId}
              fullName={fullName}
              detail={detail}
              isLoading={isLoading}
              loadError={loadError}
              onDone={() => {
                setOpen(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


/** The shared waiting and failure states, so neither dialog invents its own wording. */
function Pending({ isLoading, loadError }: { isLoading: boolean; loadError: string | null }) {
  if (loadError) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {loadError}
      </p>
    );
  }
  if (isLoading) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Reading this contestant&rsquo;s entries…
      </p>
    );
  }
  return null;
}

/**
 * What has been recorded against this contestant.
 *
 * Deliberately their own history and not their school's. `activity_events` stamps
 * a participant id on the kinds that are about a person; the entry rows a move also
 * writes are stamped with an entry id and belong to /admin/audit-logs, which is the
 * surface for the division's whole account of itself.
 */
function HistoryBody({
  fullName,
  rows,
  isLoading,
  loadError,
}: {
  fullName: string;
  rows: ParticipantHistoryRow[] | null;
  isLoading: boolean;
  loadError: string | null;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change history</DialogTitle>
        <DialogDescription>
          What has been recorded against {fullName}, newest first. Changes to their entries
          and their school&rsquo;s roster are on the action log.
        </DialogDescription>
      </DialogHeader>

      {/* The only part that scrolls. Header and footer stay put, so the buttons
          are always reachable however long the form or the list below grows. */}
      <div className="min-h-0 space-y-4 overflow-y-auto py-4">
        <Pending isLoading={isLoading} loadError={loadError} />

        {rows && rows.length === 0 ? (
          // Not "nothing ever happened": the log starts where migration 0024 installed
          // it, and a contestant registered before that has no rows rather than no
          // history. Saying which is the difference between a quiet record and a
          // missing one.
          <p className="py-2 text-sm text-muted-foreground">
            Nothing has been recorded against this contestant. The action log only covers
            changes made since it was installed, so anything earlier is not held here.
          </p>
        ) : null}

        {rows && rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{row.action}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{row.when}</span>
                </div>
                {row.detail ? (
                  <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <DialogFooter showCloseButton />
    </>
  );
}

function ViewBody({
  fullName,
  detail,
  isLoading,
  loadError,
}: {
  fullName: string;
  detail: ParticipantDetail | null;
  isLoading: boolean;
  loadError: string | null;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{fullName}</DialogTitle>
        <DialogDescription>
          {detail
            ? `No. ${detail.numberLabel} · ${detail.gender} · ${detail.schoolName}${
                detail.districtName ? ` · ${detail.districtName}` : ""
              }`
            : "What this contestant is entered in."}
        </DialogDescription>
      </DialogHeader>

      {/* The only part that scrolls. Header and footer stay put, so the buttons
          are always reachable however long the form or the list below grows. */}
      <div className="min-h-0 space-y-4 overflow-y-auto py-4">
        <Pending isLoading={isLoading} loadError={loadError} />

        {detail ? (
          detail.entries.length === 0 ? (
            // Not an error and not a blank panel: a learner on the roster with no entry
            // is an ordinary state, and it is one an admin may be checking for.
            <p className="py-2 text-sm text-muted-foreground">
              This contestant is on the roster but is not entered in any event.
            </p>
          ) : (
            <ul className="space-y-3">
              {detail.entries.map((entry) => (
                <li key={entry.entryId} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.eventName}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {slotLabel(entry.level, entry.language)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {entry.category}
                    </Badge>
                    {entry.judged && (
                      <Badge variant="outline" className="text-[10px]">
                        <Gavel className="size-3" />
                        Ranked
                      </Badge>
                    )}
                  </div>
                  <dl className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0">Coach</dt>
                      <dd>{entry.coachNames.length ? entry.coachNames.join("; ") : "None named"}</dd>
                    </div>
                    {entry.category === "group" && (
                      <div className="flex gap-2">
                        <dt className="w-20 shrink-0">Team</dt>
                        <dd>
                          {entry.teammates.length
                            ? entry.teammates.join("; ")
                            : "No other contestants on this entry"}
                        </dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <DialogFooter showCloseButton />
    </>
  );
}

function MoveBody({
  participantId,
  fullName,
  detail,
  isLoading,
  loadError,
  onDone,
}: {
  participantId: string;
  fullName: string;
  detail: ParticipantDetail | null;
  isLoading: boolean;
  loadError: string | null;
  onDone: () => void;
}) {
  const [fromEntryId, setFromEntryId] = useState<string>("");
  const [toEventId, setToEventId] = useState<string>("");
  // null means the admin has not touched the select, in which case the coach already
  // paired with this contestant on the entry they are leaving is the answer — see
  // `selectedCoachId`. Held as "untouched" rather than seeded with that id, because
  // the id is not known until the detail load lands and the source entry is settled.
  const [coachId, setCoachId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Memoised because it feeds the two useMemo hooks below: a fresh [] on every
  // render would recompute the destination list and the consequences on every
  // keystroke elsewhere in the dialog.
  const entries = useMemo(() => detail?.entries ?? [], [detail]);
  // A contestant in one event has nothing to choose, so the source is settled for
  // them rather than offered as a select of one.
  const source = entries.find((entry) => entry.entryId === fromEntryId) ?? (entries.length === 1 ? entries[0] : undefined);

  const destinations = useMemo(
    () => (detail && source ? moveDestinations(detail.events, entries, source.entryId) : []),
    [detail, entries, source]
  );

  const destination = destinations.find((row) => row.event.id === toEventId)?.event;

  /**
   * The coach the new entry will name: whoever the admin picked, or — until they
   * pick — the one already paired with this contestant on the entry they are
   * leaving. Exactly one, which is what an individual entry allows (0019).
   *
   * "" when there is neither, which is a group entry the contestant has no pairing
   * on, or a school with nobody on its coach roster. Radix reads "" as no selection
   * and shows the placeholder, which is the honest state: nobody is named yet.
   */
  const selectedCoachId = coachId ?? source?.coachId ?? "";

  const notes = useMemo(() => {
    if (!detail || !source || !destination) return [];
    return moveConsequences({
      source,
      destination,
      destinationEntryExists: detail.schoolEventIds.includes(destination.id),
      destinationJudged: detail.judgedEventIds.includes(destination.id),
      sourceMemberCount: source.teammates.length + 1,
      sourceMinParticipants: source.minParticipants,
    });
  }, [detail, source, destination]);

  function submit() {
    if (!source || !destination) return;
    if (notes.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await moveParticipantEventAction({
        participantId,
        fromEntryId: source.entryId,
        toEventId: destination.id,
        // Only ever true once the consequences above have been shown and clicked
        // through. The RPC refuses a silent discard without it.
        confirmDiscard: confirming,
        coachId: selectedCoachId || null,
      });
      if ("error" in result) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      toast.success(`${fullName} is now entered in ${destination.name}.`, {
        description: result.notes.length ? result.notes.join(" ") : undefined,
      });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move {fullName}</DialogTitle>
        <DialogDescription>
          For a contest a school filed under the wrong event. The contestant keeps their
          number; the event they compete in, and the coach who takes them there, change.
        </DialogDescription>
      </DialogHeader>

      {/* The only part that scrolls. Header and footer stay put, so the buttons
          are always reachable however long the form grows. */}
      <div className="min-h-0 space-y-4 overflow-y-auto py-4">
        <Pending isLoading={isLoading} loadError={loadError} />

        {detail ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <School className="size-4 shrink-0 text-muted-foreground" />
              {/* The school, said plainly and before anything is chosen. Every list below
                  is scoped to it — the coaches are its roster, the destination entry
                  would be its entry — and an admin working down a filtered table has no
                  other reminder of whose contestant this is. */}
              <span className="font-medium">{detail.schoolName || "School not recorded"}</span>
              {detail.districtName ? (
                <span className="text-muted-foreground">· {detail.districtName}</span>
              ) : null}
              <span className="text-muted-foreground">· No. {detail.numberLabel}</span>
            </div>
          </div>
        ) : null}

        {detail && entries.length > 0 ? (
          // Shown before the form and not after it. This is an administrative
          // correction to work a school filed and can no longer reach: the school will
          // not be asked, will not be told, and will find their entry changed the next
          // time they open it. That is the point of the feature and it is also the
          // thing an admin should have in mind while choosing.
          <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <TriangleAlert className="size-4 shrink-0 translate-y-0.5 text-amber-600 dark:text-amber-500" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">This changes a school&rsquo;s entry.</span>{" "}
              The school is not asked and is not notified, and the change is recorded against
              this contestant under your name. Where the school can still edit its own entries,
              ask them to correct it instead.
            </p>
          </div>
        ) : null}

        {detail && entries.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            This contestant is not entered in anything, so there is nothing to move. A school
            adds them to an event from its own entry form.
          </p>
        ) : null}

        {detail && entries.length > 0 ? (
          <div className="space-y-4">
            {entries.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="move-from">Move them out of</Label>
                <Select
                  value={source?.entryId ?? ""}
                  onValueChange={(value) => {
                    setFromEntryId(value);
                    setToEventId("");
                    // The coach too: "keep" means the pairing on the *source* entry, and
                    // a different source is a different pairing. Leaving a chosen coach
                    // selected across that change would carry one entry's answer onto
                    // another entry's question.
                    setCoachId(null);
                    setConfirming(false);
                  }}
                >
                  <SelectTrigger id="move-from" className="w-full">
                    <SelectValue placeholder="Which entry" />
                  </SelectTrigger>
                  <SelectContent>
                    {entries.map((entry) => (
                      <SelectItem key={entry.entryId} value={entry.entryId}>
                        {eventOptionLabel({
                          name: entry.eventName,
                          level: entry.level,
                          language: entry.language,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              // A field rather than a sentence, so the three rows of this form line up
              // and read as one thing: out of, into, with whom. A contestant in a single
              // event has nothing to choose here, and a select of one would invite them
              // to try.
              <div className="space-y-2">
                <Label>Move them out of</Label>
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {source
                    ? eventOptionLabel({
                        name: source.eventName,
                        level: source.level,
                        language: source.language,
                      })
                    : ""}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="move-to">Move them into</Label>
              <Select
                value={toEventId}
                onValueChange={(value) => {
                  setToEventId(value);
                  setConfirming(false);
                  setError(null);
                }}
                disabled={!source}
              >
                <SelectTrigger id="move-to" className="w-full">
                  <SelectValue placeholder="Choose an event" />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((row) => (
                    // Disabled rather than absent, with the obstacle named: an admin who
                    // cannot find an event learns nothing, and one who finds it greyed out
                    // with "Already entered in this event" learns what they came for.
                    <SelectItem
                      key={row.event.id}
                      value={row.event.id}
                      disabled={row.disabledReason !== null}
                    >
                      <span className="flex flex-col items-start gap-0.5">
                        <span>{row.label}</span>
                        {row.disabledReason ? (
                          // On its own line rather than appended with a dash. Sixty-odd
                          // options each carrying "News Writing · Elem · Eng — Already
                          // entered in this event" on one line is a list nobody scans;
                          // the contest name has to stay the thing the eye lands on.
                          <span className="text-xs">{row.disabledReason}</span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="move-coach">Coach</Label>
              <Select
                value={selectedCoachId}
                onValueChange={setCoachId}
                disabled={!source || detail.coaches.length === 0}
              >
                <SelectTrigger id="move-coach" className="w-full">
                  <SelectValue placeholder="Choose a coach" />
                </SelectTrigger>
                <SelectContent>
                  {/* This school's roster and no other. A coach from elsewhere on an
                      entry would be a worse mistake than the one being corrected, which
                      is why the RPC checks the school again. One choice, because a
                      contestant has one coach. */}
                  {detail.coaches.map((coach) => (
                    <SelectItem key={coach.id} value={coach.id}>
                      {coach.name}
                      {coach.id === source?.coachId ? " — coaches them now" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {detail.coaches.length === 0
                  ? "This school has nobody on its coach roster, so there is nobody to name."
                  : destination?.category === "group"
                    ? // A team's coaches are the team's. Said here because the select
                      // looks the same in both cases and the effect is not.
                      "A team shares its coaches, so this one is only added if that entry has none yet."
                    : source?.coachName
                      ? `One coach per contestant. ${source.coachName} coaches them in ${source.eventName}, and carries over unless you change this.`
                      : "One coach per contestant. Nobody is paired with them on their current entry, so choose who takes them."}
              </p>
            </div>

            {notes.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-sm font-medium">Before you move them</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

      </div>

      <DialogFooter>
        <Button variant="outline" disabled={isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={isPending || !source || !destination}
          variant={confirming ? "destructive" : "default"}
          onClick={submit}
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {confirming ? "Yes, move them anyway" : "Move contestant"}
        </Button>
      </DialogFooter>
    </>
  );
}
