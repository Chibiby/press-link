"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Newspaper } from "lucide-react";

import { signOutAction } from "./actions";
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
      if (choice === "no") {
        // Recorded, and that ends the session. signOutAction redirects to
        // /login itself, so there is nothing to refresh afterwards.
        await signOutAction();
        return;
      }
      toast.success("Your school paper entry has been submitted.");
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
            submits them as your entry and locks them from further edits. Answering No
            records that and signs you out — you will be asked again next time, and
            participants and coaches stay closed until you answer Yes.
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
            No — sign me out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
