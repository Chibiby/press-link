"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Newspaper } from "lucide-react";

import { setPaperParticipationAction } from "./roster-actions";
import type { PaperParticipation } from "./types";
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
 * Stage 2, asked once the school has saved at least one language. While it has
 * never been answered it is `required`: `onOpenChange` is a no-op, so Escape
 * and the overlay cannot dismiss it. Afterwards the school can reopen it from
 * the dashboard to change its mind, until it locks its details in.
 */
export function PaperGateDialog({
  open,
  onOpenChange,
  required,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  required: boolean;
  current: PaperParticipation;
}) {
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
          ? "Your school paper has been entered in the contest."
          : "Your school paper information has been saved."
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={required ? () => {} : onOpenChange}>
      <DialogContent showCloseButton={!required} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            Are you submitting this school paper to the school paper contest?
          </DialogTitle>
          <DialogDescription>
            Yes enters the details you saved in the school paper contest. No keeps them on
            record for the division office without entering the contest. Either way, your
            participants and coaches will open, and you can change this answer until you lock
            your details in.
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
            Yes, submit to the contest
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={isPending}
            onClick={() => answer("no")}
          >
            No, just save our information
          </Button>
        </div>

        {current !== "undecided" && (
          <p className="text-center text-xs text-muted-foreground">
            Your current answer:{" "}
            {current === "yes" ? "submitting to the contest" : "saving the information only"}.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
