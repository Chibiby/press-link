"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, TriangleAlert } from "lucide-react";

import { setSubmissionsLockAction } from "./submissions-lock-actions";
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
  describeUnknownLock,
  submissionsLockControl,
  type SubmissionsLock,
} from "@/lib/submissions/lock-state";

/**
 * The division-wide submissions switch, in the dashboard header.
 *
 * Freezing every school in the division at once is not a toggle, so it is a
 * confirmation, following `app/entry/LockSubmissionDialog.tsx`: the dialog names
 * what stops working rather than asking a general "are you sure?".
 *
 * It also names what does *not* happen, which is the part that is easy to get
 * wrong from the outside. The switch writes nothing to any school's own lock, so
 * turning it off returns every school to exactly the state it was in. An admin
 * who does not know that will not dare use it at a deadline, which is the only
 * moment it exists for.
 *
 * Every label, variant and heading comes from `submissionsLockControl()`, and so
 * does the number of buttons, so the three states cannot drift into looking
 * alike: a state that could not be read offers both the lock and the unlock,
 * because offering only one of them is a guess about which state the division is
 * in. The sentence explaining that state comes from `describeUnknownLock()` for
 * the same reason. The test for all of it is in
 * `lib/submissions/lock-state.test.ts`, since nothing in this repo renders a
 * component under test.
 *
 * `stamp` arrives pre-formatted from the page rather than being derived here: the
 * formatter is `Intl.DateTimeFormat`, and Node's ICU and the browser's disagree
 * about the space before "PM", which is a hydration mismatch nobody can see.
 */
export function SubmissionsLockDialog({
  lock,
  stamp,
}: {
  lock: SubmissionsLock;
  /** `describeLockStamp(lock)`, formatted on the server. Null unless the switch is on. */
  stamp: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which action is in flight, by the state it is sending. Null while idle. */
  const [sending, setSending] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();

  const control = submissionsLockControl(lock);
  const Icon = control.icon === "alert" ? TriangleAlert : Lock;

  function show(next: boolean) {
    setOpen(next);
    // A failure from the last attempt must not be the first thing the next one
    // shows.
    if (!next) {
      setError(null);
      setSending(null);
    }
  }

  function confirm(nextLocked: boolean) {
    setError(null);
    setSending(nextLocked);
    startTransition(async () => {
      const result = await setSubmissionsLockAction(nextLocked);
      if ("error" in result) {
        // Inline and persistent, not a toast: this is the only place the
        // database's own sentence is readable, and the reader may need to copy
        // it. The dialog stays open so it does not vanish with the surface.
        setError(result.error);
        setSending(null);
        return;
      }

      toast.success(
        result.locked
          ? "Submissions are locked division-wide."
          : "Submissions are open. Every school is back to its own lock.",
      );
      show(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={control.variant}
        className="shadow-sm"
        // The stamp is on the page itself, under the title; this repeats it where
        // a mouse already is.
        title={stamp ?? (lock.state === "unknown" ? lock.detail : undefined)}
        onClick={() => show(true)}
      >
        <Icon />
        {control.label}
      </Button>

      <AlertDialog open={open} onOpenChange={show}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{control.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                {lock.state === "unlocked" ? (
                  <>
                    <p>Every school in the division stops being able to save:</p>
                    <ul className="list-disc pl-5">
                      <li>school paper details and contest answers</li>
                      <li>participants and coaches</li>
                      <li>every entry</li>
                    </ul>
                    <p>
                      No school&apos;s own lock is touched, so turning this back off
                      returns every school to exactly where it was. You keep full
                      access to everything while it is on.
                    </p>
                  </>
                ) : null}

                {lock.state === "locked" ? (
                  <>
                    {stamp ? <p className="text-foreground">{stamp}</p> : null}
                    <p>
                      Every school that had not locked its own submission can save
                      again. Schools that locked themselves stay locked — this switch
                      never touched them.
                    </p>
                  </>
                ) : null}

                {lock.state === "unknown" ? (
                  <>
                    <p>
                      The division-wide switch could not be read, so this page cannot
                      tell you whether submissions are frozen.
                    </p>
                    <p className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-words">
                      {lock.detail}
                    </p>
                    <p>{describeUnknownLock(lock)}</p>
                  </>
                ) : null}
              </div>
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
            <AlertDialogCancel disabled={isPending}>
              {control.cancelLabel}
            </AlertDialogCancel>
            {control.actions.map((action) => (
              <AlertDialogAction
                key={action.label}
                variant={action.variant}
                // Both buttons go dead while either is in flight: they write the
                // same row, and the second click would race the first.
                disabled={isPending}
                onClick={(e) => {
                  // The dialog must survive a failure so the error above can be
                  // read, and Radix closes on click unless this is prevented.
                  e.preventDefault();
                  confirm(action.nextLocked);
                }}
              >
                {isPending && sending === action.nextLocked && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {action.label}
              </AlertDialogAction>
            ))}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
