"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LockOpen } from "lucide-react";

import { unlockSubmissionAction } from "./actions";
import { Button } from "@/components/ui/button";

export function UnlockSubmissionButton({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleUnlock() {
    startTransition(async () => {
      const result = await unlockSubmissionAction(schoolId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${schoolName} can edit its submission again.`);
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleUnlock}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <LockOpen className="size-4" />}
      Unlock
    </Button>
  );
}
