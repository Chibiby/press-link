import { FileText, FilePen, Layers, Lock, MessageSquare, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { relativeTime, type ActivityItem, type ActivityKind } from "@/lib/dashboard/activity";
import {
  isSessionInProgress,
  untrackedDivider,
} from "@/lib/dashboard/activity-feed-view";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  // Stacked, because a session row is several actions folded into one line.
  session: Layers,
  entry: FileText,
  participant: Users,
  coach: UserRound,
  "paper-answer": MessageSquare,
  "submission-lock": Lock,
  "paper-update": FilePen,
};

/**
 * A server component, and it has to stay one.
 *
 * `relativeTime` and the divider label both run `Intl.DateTimeFormat` during
 * render. Node's ICU and the browser's disagree about the space before "PM", so
 * the same formatter run on both sides of a hydration boundary is a mismatch
 * nobody can see — which is why `SubmissionsLockDialog` takes its stamp
 * pre-formatted as a prop instead. Nothing here is interactive, both callers are
 * async server components, and a session's `In progress · since 2:14 PM` arrives
 * already formatted by `groupActivitySessions` on the server. If this ever needs
 * `"use client"`, the formatting moves out first.
 */
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

  // Null unless this list holds both logged rows and rows that predate the log,
  // so the feed a production database returns today — every row legacy, because
  // 0024/0025 are not applied — draws no divider at all.
  const divider = untrackedDivider(items);

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {items.map((item, index) => {
          const Icon = KIND_ICON[item.kind];
          // A session still being worked in. The wording is the pure function's;
          // this only decides that it gets marked.
          const live = isSessionInProgress(item);
          const body = (
            <>
              <span
                aria-hidden
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm text-foreground",
                    // A session row *is* its sentence — "… added 5 learners, 5
                    // coaches and entry for 6 events" — and clipping it hides the
                    // tally that is the whole row. The other kinds keep the
                    // single-line treatment they have today; their titles are a
                    // label and a name.
                    item.kind === "session" ? "text-pretty" : "truncate"
                  )}
                >
                  {item.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.meta ? (
                    <>
                      {live ? (
                        // Decoration only: "In progress" is in the meta text
                        // itself, so the state is never carried by colour alone.
                        <span
                          aria-hidden
                          className="mr-1.5 inline-block size-1.5 rounded-full bg-primary align-middle motion-safe:animate-pulse"
                        />
                      ) : null}
                      <span className={live ? "font-medium text-foreground" : undefined}>
                        {item.meta}
                      </span>
                      {" · "}
                    </>
                  ) : null}
                  {relativeTime(item.at, now)}
                </span>
              </span>
            </>
          );

          const row = (
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

          if (!divider || divider.index !== index) return row;

          return (
            <Fragment key={item.id}>
              {/* Design §4: what predates the log is shown ungrouped under a
                  visible divider, because a session cannot be inferred for it —
                  `school_papers.updated_at` is mutable and `lock_submission`
                  stamps a school's whole history in one instant. An `<li>`
                  because a `<ul>` may hold nothing else, and real text rather
                  than an `aria-hidden` rule, since the break is the point. */}
              <li className="flex items-center gap-2 pt-1">
                <span aria-hidden className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {divider.label}
                </span>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </li>
              {row}
            </Fragment>
          );
        })}
      </ul>
      {divider ? (
        <p className="text-xs text-muted-foreground">
          Rows under that line were recorded before the log existed, so they are listed one
          action at a time rather than grouped into a session.
        </p>
      ) : null}
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
