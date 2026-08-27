"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserMinus, UserPlus } from "lucide-react";

import type { JudgeRosterRow } from "@/components/admin/judging/JudgeRosterTable";
import type { PanelSeat } from "@/app/admin/(shell)/judging-data";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROUND1_SEAT } from "@/lib/judging/sheet-state";

import { assignJudgeAction, unassignJudgeAction } from "../actions";

/**
 * One event's four seats, and the two writes that change who is on them.
 *
 * ## Why all four seats are drawn, empty ones included
 *
 * The question this card answers is not "who is judging this event" — the boards
 * below already say that — but "which seat still needs somebody". A list of the
 * judges seated cannot answer it: an event seated 1, 2 and 4 renders as three rows
 * either way, and only naming the seat says that the gap is seat 3. That is also
 * why the rows come from `PANEL_SEATS` rather than from the assignments.
 *
 * ## What the seat numbers mean
 *
 * N1: seat 1 ranks round 1 alone and makes the cut; seats 2, 3 and 4 rank round 2
 * and place the winners; there is no fifth seat. One judge cannot hold two seats on
 * one event — 0018's unique `(judge_id, event_id)` is what stops the judge who made
 * the cut also placing the winners — so a judge already seated here is left out of
 * the other seats' pickers rather than offered and then refused.
 *
 * ## What this decides
 *
 * Nothing. Both writes are `security definer` RPCs from 0027 that re-check the whole
 * rule server-side (non-negotiable 2): that the caller is an admin, that the event is
 * individual, that the seat is one of the four, that the judge is active, and — for
 * emptying a seat — that its judge has no submitted sheet. A control this page offers
 * wrongly is refused there, and the refusal's own sentence is what the admin reads.
 */
export function PanelSeating({
  eventId,
  seats,
  roster,
  individual,
}: {
  eventId: string;
  /** All four seats in seat order, vacant ones included. */
  seats: PanelSeat[];
  /** Every judge on file. Filtered to the seatable ones per seat, below. */
  roster: JudgeRosterRow[];
  /**
   * Whether the two-stage rounds apply. A group event is ranked on one board and
   * has no seats to fill (non-negotiable 6), and the RPCs refuse it outright.
   */
  individual: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /** Which seat's dialog is open, and which of the two it is. */
  const [open, setOpen] = useState<{ seat: number; kind: "fill" | "empty" } | null>(null);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** Everybody holding a seat on this event, whichever seat it is. */
  const seatedHere = useMemo(
    () => new Set(seats.flatMap((seat) => (seat.judge ? [seat.judge.id] : []))),
    [seats]
  );

  function show(next: { seat: number; kind: "fill" | "empty" } | null) {
    setOpen(next);
    // Neither the last attempt's refusal nor the last seat's choice may still be
    // sitting there when the next dialog opens.
    setError(null);
    setChosen("");
  }

  function run(action: () => Promise<{ error: string } | void>, done: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      toast.success(done);
      show(null);
      router.refresh();
    });
  }

  if (!individual) {
    return (
      <p className="text-sm text-muted-foreground">
        This is a group event. It is ranked on one board rather than in two rounds, so
        it has no numbered seats to fill.
      </p>
    );
  }

  const seatBeingFilled = open?.kind === "fill" ? open.seat : null;
  // A judge already on this panel is left out — except from their own seat's picker,
  // where leaving them out would make the list look as though they were unavailable.
  const eligible = roster.filter(
    (judge) =>
      judge.isActive &&
      (!seatedHere.has(judge.id) ||
        seats.find((seat) => seat.seat === seatBeingFilled)?.judge?.id === judge.id)
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Seat</TableHead>
              <TableHead>Ranks</TableHead>
              <TableHead>Judge</TableHead>
              <TableHead>Affiliation</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {seats.map(({ seat, judge }) => (
              <TableRow key={seat}>
                <TableCell className="font-medium tabular-nums">{seat}</TableCell>
                <TableCell className="text-muted-foreground">
                  {seat === ROUND1_SEAT ? "Round 1" : "Round 2"}
                </TableCell>
                <TableCell className="font-medium">
                  {judge ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {judge.name}
                      {/* Only the absence is badged. A judge who can sign in is the
                          expected case and needs no mark; one who cannot is why an
                          admin would come to this card and find nothing filed. */}
                      {judge.hasLogin ? null : (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title="This judge has no login yet, so they cannot sign in to rank this event. Give them one from the roster."
                        >
                          No login yet
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Vacant</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {judge?.affiliation ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => show({ seat, kind: "fill" })}
                    >
                      <UserPlus />
                      {judge ? "Change" : "Seat a judge"}
                    </Button>
                    {judge ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => show({ seat, kind: "empty" })}
                      >
                        <UserMinus />
                        Empty
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Seat 1 ranks round 1 on its own and its ranks make the cut. Seats 2, 3 and 4
        rank round 2 and place the winners, and one judge cannot hold two seats here —
        the judge who made the cut does not also place the winners.
      </p>

      <Dialog
        open={open?.kind === "fill"}
        onOpenChange={(next) => show(next && open ? open : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seat {open?.seat} on this event</DialogTitle>
            <DialogDescription>
              {open?.seat === ROUND1_SEAT
                ? "This judge ranks round 1 alone, and their ranks are what draws the field for round 2."
                : "This judge ranks round 2. The three round 2 seats rank independently and their ranks are added, so a low total is a good total."}{" "}
              Seating somebody on a seat that is already taken replaces who is on it.
              The judge who leaves keeps any sheet they have already filed — it stays
              on this event until an admin clears it deliberately.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Select value={chosen} onValueChange={setChosen} disabled={isPending}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a judge" />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((judge) => (
                  <SelectItem key={judge.id} value={judge.id}>
                    {judge.name}
                    {judge.affiliation ? ` · ${judge.affiliation}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              {eligible.length === 0
                ? "Nobody is available for this seat. An inactive judge cannot be seated, and neither can one already sitting on another seat here."
                : "Only active judges appear, and only those not already seated on this event. A judge with no login yet can be seated — they simply cannot sign in to rank until one is made."}
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" disabled={isPending} onClick={() => show(null)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || chosen === ""}
              onClick={() => {
                if (!open) return;
                const judge = eligible.find((candidate) => candidate.id === chosen);
                run(
                  () => assignJudgeAction(eventId, chosen, open.seat),
                  `${judge?.name ?? "That judge"} is on seat ${open.seat}.`
                );
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Seat judge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={open?.kind === "empty"}
        onOpenChange={(next) => show(next && open ? open : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty seat {open?.seat}?</AlertDialogTitle>
            <AlertDialogDescription>
              The judge comes off this event&rsquo;s panel and stops seeing it when they
              sign in. They stay on the division roster. This is refused while they have
              a sheet submitted on this event — an empty seat whose ranks are still on
              file is the one state that could place a contestant on the opinion of
              somebody no longer on the panel, so that sheet is unlocked first, as its
              own act.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                // The dialog has to survive a failure so the refusal above can be
                // read, and Radix closes on click unless this is prevented.
                event.preventDefault();
                if (!open) return;
                run(
                  () => unassignJudgeAction(eventId, open.seat),
                  `Seat ${open.seat} is empty.`
                );
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Empty seat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
