import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/dashboard/attention";

function Row({ item }: { item: AttentionItem }) {
  return (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums",
          item.tone === "warn"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary",
        )}
      >
        {item.count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{item.label}</span>
        <span className="block text-xs text-muted-foreground">{item.detail}</span>
      </span>
    </>
  );
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing needs attention right now.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.key}>
          {item.href ? (
            <Link
              href={item.href}
              className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <Row item={item} />
              <ArrowRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ) : (
            <div className="flex items-center gap-3 py-2.5">
              <Row item={item} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
