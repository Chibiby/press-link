import { Check, Circle, CircleDot, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Timeline, TimelineState } from "@/lib/dashboard/timeline";

const STATE_ICON: Record<TimelineState, LucideIcon> = {
  completed: Check,
  "in-progress": CircleDot,
  unknown: TriangleAlert,
  unavailable: Circle,
};

const STATE_CHIP: Record<TimelineState, string> = {
  completed: "bg-primary/10 text-primary",
  "in-progress": "bg-primary text-primary-foreground",
  // Warning, not destructive: a state that could not be read is not a closed
  // division, and the amber has to stop an admin reading past it as either.
  unknown: "bg-warning/15 text-warning-foreground dark:text-warning",
  unavailable: "bg-muted text-muted-foreground",
};

/** The dot beside the step. Muted for what has not started, amber for what could not be read. */
const STATE_MARK: Record<TimelineState, string> = {
  completed: "bg-primary/10 text-primary",
  "in-progress": "bg-primary/10 text-primary",
  unknown: "bg-warning/15 text-warning-foreground dark:text-warning",
  unavailable: "bg-muted text-muted-foreground",
};

export function SubmissionTimeline({ timeline }: { timeline: Timeline }) {
  return (
    <ol className="space-y-0">
      {timeline.steps.map((step, index) => {
        const Icon = STATE_ICON[step.state];
        const last = index === timeline.steps.length - 1;

        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  STATE_MARK[step.state],
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {last ? null : <span className="w-px flex-1 bg-border" />}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    step.state === "unavailable"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase",
                    STATE_CHIP[step.state],
                  )}
                >
                  {step.stateLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
