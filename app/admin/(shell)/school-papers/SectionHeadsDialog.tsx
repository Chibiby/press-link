"use client";

import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The trigger and its dialog together, self-contained — `page.tsx` is a
 * server component, so the open/closed state this needs has to live in a
 * client component of its own rather than being lifted onto the page.
 *
 * Only rendered for a school with more than 3 section heads; the cell shows
 * the rest inline when there are fewer, so this never has to handle "view
 * all" for a list short enough to already be on screen.
 */
export function SectionHeadsDialog({
  schoolName,
  sectionHeads,
}: {
  schoolName: string;
  sectionHeads: string[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="View all section heads">
          <MoreHorizontal />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="pe-6 text-left">Section heads — {schoolName}</DialogTitle>
        </DialogHeader>
        <ul className="flex flex-col divide-y rounded-lg border">
          {sectionHeads.map((name) => (
            <li key={name} className="px-3 py-2 text-sm">
              {name}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
