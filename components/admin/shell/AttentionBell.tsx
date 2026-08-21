"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The count is real — it is how many attention categories are non-empty (see
 * lib/dashboard/attention.ts). Alerting is not built, and the popover says so plainly
 * rather than offering a "mark all read" that would do nothing.
 */
export function AttentionBell({ count }: { count: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={
            count > 0 ? `Needs attention: ${count} categories` : "Nothing needs attention"
          }
        >
          <Bell className="size-4" />
          {count > 0 ? (
            <span className="absolute top-0.5 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Needs attention</PopoverTitle>
          <PopoverDescription>
            {count > 0
              ? `${count} ${count === 1 ? "category" : "categories"} need a look.`
              : "Nothing needs attention right now."}
          </PopoverDescription>
        </PopoverHeader>
        <p className="text-sm text-muted-foreground">
          Alerting itself is not built yet: nothing is sent anywhere and there is nothing to
          mark as read. The count is live, and the list behind it is on the dashboard.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link href="/admin#attention">Open the list</Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
