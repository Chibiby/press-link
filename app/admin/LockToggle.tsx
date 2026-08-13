"use client";

import { useTransition } from "react";
import { setSubmissionsLockedAction } from "./actions";

export function LockToggle({ locked }: { locked: boolean }) {
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setSubmissionsLockedAction(!locked);
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
        locked ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {isPending ? "Updating..." : locked ? "Unlock submissions" : "Lock submissions"}
    </button>
  );
}
