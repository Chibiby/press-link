import { Badge } from "@/components/ui/badge";

/**
 * The in-content title block. It carries what DashboardHeader used to carry per
 * page — title, subtitle and a count badge — now that the chrome above is
 * shared and page-agnostic.
 */
export function PageHeading({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
