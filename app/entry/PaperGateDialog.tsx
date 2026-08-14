"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Newspaper } from "lucide-react";

import { setPaperParticipationAction } from "./roster-actions";
import {
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  type PaperDeclineReason,
} from "@/lib/paper/gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** What each reason means for the school, shown under the dropdown. */
const REASON_CONSEQUENCES: Record<PaperDeclineReason, string> = {
  submit_later: "We will ask you again next time you sign in.",
  no_paper_yet: "We will stop asking. You can still fill in the form whenever you like.",
  will_not_submit:
    "This closes the School Paper form for your school. Only the division office can reopen it.",
  other:
    "This closes the School Paper form for your school. Only the division office can reopen it.",
};

/**
 * Blocks the dashboard until the school answers. There is no close affordance:
 * `onOpenChange` is a no-op, so Escape and the overlay cannot dismiss it.
 */
export function PaperGateDialog({
  open,
  onAnswered,
}: {
  open: boolean;
  /**
   * A Yes school with nothing saved is still owed the question on its next
   * visit, so the server keeps asking. This tells the dashboard the question
   * was answered just now, closing it for the rest of this visit.
   */
  onAnswered: (choice: "yes" | "no") => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** null while the school has not pressed No yet. */
  const [reason, setReason] = useState<PaperDeclineReason | null>(null);
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);

  function submit(answer: { choice: "yes" } | { choice: "no" }) {
    setError(null);
    const payload =
      answer.choice === "yes"
        ? { choice: "yes" as const }
        : { choice: "no" as const, reason, note };

    startTransition(async () => {
      const result = await setPaperParticipationAction(payload);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(
        answer.choice === "yes"
          ? "Fill in your school paper details below."
          : "Recorded. Thank you."
      );
      onAnswered(answer.choice);
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
            You can register participants, coaches, and entries either way — this only
            decides whether we keep the School Paper form open for you.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {declining ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="decline-reason">Why not?</Label>
              <Select
                value={reason ?? undefined}
                onValueChange={(value) => setReason(value as PaperDeclineReason)}
              >
                <SelectTrigger id="decline-reason" className="w-full">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {DECLINE_REASONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DECLINE_REASON_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reason && (
                <p className="text-xs text-muted-foreground">
                  {REASON_CONSEQUENCES[reason]}
                </p>
              )}
            </div>

            {reason === "other" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="decline-note">Please specify</Label>
                <Textarea
                  id="decline-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Tell the division office why"
                  rows={3}
                />
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                disabled={isPending}
                onClick={() => {
                  setDeclining(false);
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={isPending || !reason || (reason === "other" && !note.trim())}
                onClick={() => submit({ choice: "no" })}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={isPending}
              onClick={() => submit({ choice: "yes" })}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Yes, we are submitting
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={isPending}
              onClick={() => setDeclining(true)}
            >
              No, we are not
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
