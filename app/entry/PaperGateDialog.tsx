"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Newspaper } from "lucide-react";

import { setPaperParticipationAction } from "./roster-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Asked once, after both school papers are filled in. There is no close
 * affordance: `onOpenChange` is a no-op, so Escape and the overlay cannot
 * dismiss it, and the roster stays shut until it is answered.
 */
export function PaperGateDialog({ open }: { open: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(choice: "yes" | "no") {
    setError(null);
    startTransition(async () => {
      const result = await setPaperParticipationAction(choice);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(
        choice === "yes"
          ? "Your school paper entry is locked in."
          : "Please review your school paper details — N/A is accepted."
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            Are you submitting these as your school paper entry?
          </DialogTitle>
          <DialogDescription>
            You have filled in the English and Filipino school paper. Answering Yes
            submits them and locks them from further edits. Answering No re-opens the
            form so you can replace anything that does not apply with N/A.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" disabled={isPending} onClick={() => answer("yes")}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Yes, submit these
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={isPending}
            onClick={() => answer("no")}
          >
            No, we are not submitting
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
