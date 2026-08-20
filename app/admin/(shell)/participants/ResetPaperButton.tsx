"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

import { resetPaperParticipationAction } from "./actions";
import { Button } from "@/components/ui/button";

export function ResetPaperButton({
  schoolId,
  schoolName,
  locked,
}: {
  schoolId: string;
  schoolName: string;
  /** A locked school is only reopened by this button, so say so. */
  locked?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleReset() {
    startTransition(async () => {
      const result = await resetPaperParticipationAction(schoolId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        locked
          ? `${schoolName} can edit its school paper again.`
          : `${schoolName} will be asked again.`
      );
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleReset}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
      {locked ? "Reopen" : "Reset answer"}
    </Button>
  );
}
