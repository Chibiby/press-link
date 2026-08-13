import { Newspaper } from "lucide-react";

import { cn } from "@/lib/utils";

export function Wordmark({
  size = "sm",
  subtitle,
  className,
}: {
  size?: "sm" | "lg";
  subtitle?: string;
  className?: string;
}) {
  const lg = size === "lg";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm",
          lg ? "size-12" : "size-9"
        )}
      >
        <Newspaper className={lg ? "size-6" : "size-4.5"} />
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={cn(
            "font-semibold tracking-tight",
            lg ? "text-2xl" : "text-base"
          )}
        >
          Press Link
        </span>
        {subtitle ? (
          <span className={cn("text-muted-foreground", lg ? "text-sm" : "text-xs")}>
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}
