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
}: {
  schoolId: string;
  schoolName: string;
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
      toast.success(`${schoolName} will be asked again.`);
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleReset}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
      Reset answer
    </Button>
  );
}
