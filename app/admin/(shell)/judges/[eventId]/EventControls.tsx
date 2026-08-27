"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen, Scissors, Trophy, Undo2 } from "lucide-react";

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eventControl, type EventControlFacts } from "@/lib/judging/event-controls";

import {
  lockResultsAction,
  lockRound1Action,
  setRound2CutAction,
  unlockResultsAction,
  unlockRound1Action,
} from "../actions";

/**
 * The event's six state changes, as buttons.
 *
 * Which of them may be pressed is decided by `eventControls`, not here, and the
 * sentence on a disabled one is that module's — so the console's offer is tested
 * in `lib/judging/event-controls.test.ts` rather than being trusted to a reading
 * of this file. None of it is enforcement: every action calls a `security
 * definer` RPC that re-checks the whole rule server-side (non-negotiable 2), so
 * a button enabled wrongly is refused by the database and its sentence is what
 * this component shows.
 *
 * Each of the four consequential changes is a confirmation that names what it
 * does to the *other* round, following `SubmissionsLockDialog`. Reopening round 1
 * clearing every round 2 sheet is the one nobody guesses, and it is the only
 * reason these are dialogs rather than buttons.
 *
 * Failures land inline in the open dialog rather than in a toast: the database's
 * own sentence is the only account of a refusal anyone gets, and it must survive
 * long enough to be read and copied.
 */
export function EventControls({
  eventId,
  facts,
}: {
  eventId: string;
  /** The row's status, cut and kind — see `EventControlFacts`. */
  facts: EventControlFacts;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /** Which confirmation is open, if any. */
  const [open, setOpen] = useState<
    "lock-round1" | "unlock-round1" | "lock-results" | "unlock-results" | "set-cut" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [cut, setCut] = useState(String(facts.round2Cut ?? ""));

  function show(id: typeof open) {
    setOpen(id);
    // A failure from the last attempt must not be the first thing the next one shows.
    setError(null);
    if (id === "set-cut") setCut(String(facts.round2Cut ?? ""));
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

  const controls = [
    {
      id: "lock-round1" as const,
      label: "Close round 1",
      icon: Lock,
      variant: "default" as const,
      title: "Close round 1 and draw the qualifiers",
      body: `Round 1's ranks are frozen and the top ${
        facts.round2Cut ?? "—"
      } contestants become round 2's field. Seat 1's sheet stops being editable and seats 2 to 4 open. Nobody outside the cut carries a placement.`,
      confirm: "Close round 1",
      done: "Round 1 is closed and the qualifiers are drawn.",
      action: () => lockRound1Action(eventId),
      destructive: false,
    },
    {
      id: "unlock-round1" as const,
      label: "Reopen round 1",
      icon: Undo2,
      variant: "outline" as const,
      title: "Reopen round 1?",
      body: "Editing round 1 can change who qualifies, so every round 2 sheet already submitted is cleared and the qualifier list is discarded. Seat 1's sheet becomes editable again. This cannot be undone by closing round 1 again — those sheets have to be re-entered.",
      confirm: "Reopen round 1",
      done: "Round 1 is open again. Round 2 was cleared.",
      action: () => unlockRound1Action(eventId),
      destructive: true,
    },
    {
      id: "lock-results" as const,
      label: "Lock results",
      icon: Trophy,
      variant: "default" as const,
      title: "Publish this event's results",
      body: "The standings on this page are frozen exactly as they stand and become the event's official placements. Both rounds stop being editable.",
      confirm: "Publish results",
      done: "The results are published.",
      action: () => lockResultsAction(eventId),
      destructive: false,
    },
    {
      id: "unlock-results" as const,
      label: "Unlock results",
      icon: LockOpen,
      variant: "outline" as const,
      title: "Unpublish this event's results?",
      body: "The frozen standings are discarded and round 2 becomes editable again. The placements shown after this are recomputed from the sheets, so they can differ from what was published.",
      confirm: "Unlock results",
      done: "The results are unlocked.",
      action: () => unlockResultsAction(eventId),
      destructive: true,
    },
  ];

  const setCutControl = eventControl(facts, "set-cut");

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <Button
        size="sm"
        variant="outline"
        disabled={setCutControl.disabledReason !== null || isPending}
        title={setCutControl.disabledReason ?? "Set how many contestants reach round 2."}
        onClick={() => show("set-cut")}
      >
        <Scissors />
        Set round 2 cut
      </Button>

      {controls.map((control) => {
        const state = eventControl(facts, control.id);
        const Icon = control.icon;
        return (
          <Button
            key={control.id}
            size="sm"
            variant={control.variant}
            disabled={state.disabledReason !== null || isPending}
            title={state.disabledReason ?? control.title}
            onClick={() => show(control.id)}
          >
            <Icon />
            {control.label}
          </Button>
        );
      })}

      <Dialog open={open === "set-cut"} onOpenChange={(next) => show(next ? "set-cut" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Round 2 cut</DialogTitle>
            <DialogDescription>
              How many of round 1&rsquo;s contestants reach round 2. This is set per event —
              there is no division-wide default, and the value an untouched event starts on
              is not a decision anyone took. It cannot be changed once round 1 is closed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="round2-cut">Contestants reaching round 2</Label>
            <Input
              id="round2-cut"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              A tie at the cut line takes everyone tied on it, so the field can come out
              larger than this number.
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
              disabled={isPending || cut.trim() === ""}
              onClick={() =>
                run(
                  () => setRound2CutAction(eventId, Number(cut)),
                  `Round 2's cut is ${Number(cut)}.`,
                )
              }
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save cut
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {controls.map((control) => (
        <AlertDialog
          key={control.id}
          open={open === control.id}
          onOpenChange={(next) => show(next ? control.id : null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{control.title}</AlertDialogTitle>
              <AlertDialogDescription>{control.body}</AlertDialogDescription>
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
                variant={control.destructive ? "destructive" : "default"}
                disabled={isPending}
                onClick={(e) => {
                  // The dialog must survive a failure so the error above can be
                  // read, and Radix closes on click unless this is prevented.
                  e.preventDefault();
                  run(control.action, control.done);
                }}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {control.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ))}
    </div>
  );
}
