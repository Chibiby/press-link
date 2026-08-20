import { Check, Circle, CircleDot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Timeline, TimelineState } from "@/lib/dashboard/timeline";

const STATE_ICON: Record<TimelineState, LucideIcon> = {
  completed: Check,
  "in-progress": CircleDot,
  unavailable: Circle,
};

const STATE_CHIP: Record<TimelineState, string> = {
  completed: "bg-primary/10 text-primary",
  "in-progress": "bg-primary text-primary-foreground",
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
                  step.state === "unavailable"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary",
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
