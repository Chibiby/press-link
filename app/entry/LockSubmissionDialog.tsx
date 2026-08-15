"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";

import { lockSubmissionAction } from "./roster-actions";
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

/**
 * Locking is the one thing on this dashboard a school cannot undo for itself,
 * so the confirmation names every part of the submission it freezes rather than
 * asking a general "are you sure?".
 *
 * The button is always on the page, disabled until the school may actually use
 * it. A control that appears only once its preconditions are met leaves a school
 * hunting for a feature it was told exists; a disabled one that explains itself
 * tells it what is still missing.
 */
export function LockSubmissionDialog({
  canLock,
  locked,
}: {
  /** The school has answered the contest question and has at least one entry. */
  canLock: boolean;
  /** Already locked — the button stays, but only to report that state. */
  locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await lockSubmissionAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Your submission is locked.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={!canLock}
        title={
          locked
            ? "Only the division office can reopen your submission."
            : canLock
              ? undefined
              : "Create at least one entry before locking your submission."
        }
        onClick={() => setOpen(true)}
      >
        <Lock className="size-4" />
        {locked ? "Submission Locked" : "Lock Submission"}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock your entire submission?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>This makes everything below read-only:</p>
                <ul className="list-disc pl-5">
                  <li>your school paper details and contest answer</li>
                  <li>your participants and coaches</li>
                  <li>every entry you have created</li>
                </ul>
                <p>
                  You will still be able to see all of it, but you will not be able to
                  change anything. Only the division office can reopen your submission.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Lock submission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
