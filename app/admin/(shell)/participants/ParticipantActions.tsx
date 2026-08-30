"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Eye, Gavel, Loader2, MoreHorizontal } from "lucide-react";

import { loadParticipantDetailAction, moveParticipantEventAction, type ParticipantDetail } from "./actions";
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
  const [open, setOpen] = useState<"view" | "move" | null>(null);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();

  const load = useCallback(
    (next: "view" | "move") => {
      setOpen(next);
      setLoadError(null);
      // Re-read on every open rather than caching the first one. Another admin may
      // have moved this contestant since; a stale entry list here would offer a move
      // out of an entry that no longer exists.
      startLoading(async () => {
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
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {open === "view" ? (
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
          number and their coach; only the event they compete in changes.
        </DialogDescription>
      </DialogHeader>

      <Pending isLoading={isLoading} loadError={loadError} />

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
            <p className="text-sm text-muted-foreground">
              Currently in{" "}
              <span className="font-medium text-foreground">
                {source
                  ? eventOptionLabel({
                      name: source.eventName,
                      level: source.level,
                      language: source.language,
                    })
                  : ""}
              </span>
              .
            </p>
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
                    {row.label}
                    {row.disabledReason ? ` — ${row.disabledReason}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
