import { Award, FileText, Map, School, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { Kpi, KpiKey } from "@/lib/dashboard/kpis";

const KPI_ICON: Record<KpiKey, LucideIcon> = {
  schools: School,
  learners: Users,
  coaches: UserRound,
  entries: FileText,
  events: Award,
  districts: Map,
};

export function KpiTile({ kpi }: { kpi: Kpi }) {
  const Icon = KPI_ICON[kpi.key];

  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {kpi.label}
            </p>
            <p className="mt-1 text-3xl leading-none font-semibold text-foreground">
              {kpi.value.toLocaleString("en-PH")}
            </p>
          </div>
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
        </div>
        {/* The subtitle is what stops the headline lying: 332 school rows are not
            332 participating schools. Task 7 writes it; never drop it. */}
        <p className="mt-2 text-xs text-muted-foreground">{kpi.subtitle}</p>
      </CardContent>
    </Card>
  );
}
