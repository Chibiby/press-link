"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LockOpen, MoreHorizontal } from "lucide-react";

import { unlockSubmissionAction } from "./actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SchoolPaperActionsMenu({
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="School paper actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isPending} onClick={handleUnlock}>
          <LockOpen className="size-4" />
          Unlock
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
