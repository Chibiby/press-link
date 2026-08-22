import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * A stat tile whose icon is passed in rather than looked up.
 *
 * `KpiTile` is the original and stays the one the dashboard uses: its `KpiKey`
 * union is a closed set of six division-wide figures, and closing it is what
 * stops a seventh KPI appearing on the dashboard without a decision. Judging
 * figures — panels seated, sheets submitted, qualifiers drawn — are not in that
 * union and do not belong in it, so spec §6's escape hatch applies and this
 * takes a `LucideIcon` directly.
 *
 * The visual language is copied from `KpiTile` deliberately, down to the
 * `tabular-nums` and the icon chip, so a judging tile and a roster tile in the
 * same column read as the same kind of object.
 *
 * `subtitle` is required for the same reason it is required there: it is the line
 * that stops the headline lying. A `0` on this page means "the table does not
 * exist yet", which is a very different claim from "no judge has been added",
 * and the tile must say which.
 */
export function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  /**
   * Renders the figure in muted grey instead of full contrast. Used where the
   * number is structurally unavailable rather than measured — an unmeasured zero
   * in full black reads as a finding.
   */
  muted = false,
}: {
  label: string;
  value: number | string;
  subtitle: string;
  icon: LucideIcon;
  muted?: boolean;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            <p
              className={`mt-1 text-3xl leading-none font-semibold tabular-nums ${
                muted ? "text-muted-foreground/70" : "text-foreground"
              }`}
            >
              {typeof value === "number" ? value.toLocaleString("en-PH") : value}
            </p>
          </div>
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
