"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, LockOpen } from "lucide-react";

import { provisionSchoolLoginAction, unlockSchoolAccountAction } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * The one live action a school row's Account or Submission cell can offer, as
 * a plain button rather than a dropdown: each cell has at most one action —
 * "provision a login" or "unlock" — so a button reads plainer here than a
 * menu that would always hold exactly one item. The Unlock control that used
 * to live in a 3-dot menu on /admin/school-papers moved here for the same
 * reason: account and lock actions both belong beside the account they act
 * on, not scattered across two admin pages.
 */
export function ProvisionLoginButton({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleProvision() {
    startTransition(async () => {
      const result = await provisionSchoolLoginAction(schoolId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`A login was created for ${schoolName}.`);
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleProvision}>
      <KeyRound className="size-4" />
      Provision login
    </Button>
  );
}

export function UnlockAccountButton({
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
      const result = await unlockSchoolAccountAction(schoolId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${schoolName} can edit its submission again.`);
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleUnlock}>
      <LockOpen className="size-4" />
      Unlock
    </Button>
  );
}
