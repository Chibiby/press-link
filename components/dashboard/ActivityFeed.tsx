import { FileText, FilePen, Lock, MessageSquare, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { relativeTime, type ActivityItem, type ActivityKind } from "@/lib/dashboard/activity";

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  entry: FileText,
  participant: Users,
  coach: UserRound,
  "paper-answer": MessageSquare,
  "submission-lock": Lock,
  "paper-update": FilePen,
};

export function ActivityFeed({
  items,
  now,
  truncated = false,
}: {
  items: ActivityItem[];
  now: Date;
  /**
   * `mergeActivityFeed`'s second return value. When true, rows were held back —
   * either by the merge slicing at its limit or by one of the six source queries
   * having sliced at its own — so this list must not be presented as the complete
   * history. False is the only condition under which it may be.
   */
  truncated?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((item) => {
          const Icon = KIND_ICON[item.kind];
          const body = (
            <>
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{item.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {item.meta ? `${item.meta} · ` : ""}
                  {relativeTime(item.at, now)}
                </span>
              </span>
            </>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-start gap-3 rounded-lg transition-colors hover:bg-muted/50"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {/* Never label a truncated list as complete. This states the fact and does not
          route: the "View all" affordance belongs to the panel header the caller owns,
          which is where Task 22 puts it once /admin/activity exists. Linking
          /admin/entries from here would break the count-matches-destination rule the
          attention list is built on: that page holds one of the six kinds. */}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the {items.length} most recent. Older activity is not listed.
        </p>
      ) : null}
    </div>
  );
}
