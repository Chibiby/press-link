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
 * Blocks the dashboard until the school answers. There is no close affordance:
 * `onOpenChange` is a no-op, so Escape and the overlay cannot dismiss it.
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
          ? "Fill in your school paper details below."
          : "Recorded. The School Paper form stays closed until an admin reopens it."
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
            Is your school submitting a school paper?
          </DialogTitle>
          <DialogDescription>
            Answer once. Choosing No closes the School Paper form for your school until
            the division office reopens it — you can still register participants,
            coaches, and entries either way.
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
            Yes, we are submitting
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={isPending}
            onClick={() => answer("no")}
          >
            No, we are not
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
