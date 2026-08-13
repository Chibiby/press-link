"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";

import { setSubmissionsLockedAction } from "./actions";
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

export function LockToggle({ locked }: { locked: boolean }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await setSubmissionsLockedAction(!locked);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(locked ? "Submissions reopened." : "Submissions locked.");
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        variant={locked ? "default" : "destructive"}
        onClick={() => setOpen(true)}
        disabled={isPending}
      >
        {locked ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
        {locked ? "Reopen submissions" : "Lock submissions"}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locked ? "Reopen submissions?" : "Lock submissions?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {locked
                ? "Schools will be able to create, edit and delete entries again."
                : "Schools will no longer be able to create or edit entries. Existing entries stay visible to them."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                confirm();
              }}
            >
              {locked ? "Reopen" : "Lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
