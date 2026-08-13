import Image from "next/image";

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
      {/* The ASPAJCCJSI shield ships with a white background, so it sits on a
          white tile in both themes rather than bleeding into a dark surface. */}
      <span
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5",
          lg ? "size-14 p-1.5" : "size-10 p-1"
        )}
      >
        <Image
          src="/aspajccjsi-mark.png"
          alt="ASPAJCCJSI"
          width={256}
          height={256}
          priority={lg}
          className="size-full object-contain"
        />
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
