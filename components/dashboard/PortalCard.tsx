import type { ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface PortalAction {
  label: string;
  href: string;
  /**
   * Set for a route handler rather than a page. Renders a plain anchor, because
   * `next/link` prefetches on hover — and prefetching `/admin/export` would build an
   * entire spreadsheet server-side every time the pointer crossed the button.
   */
  external?: boolean;
}

export function PortalCard({
  title,
  description,
  soon = false,
  control,
  actions = [],
  requires = [],
}: {
  title: string;
  description: string;
  soon?: boolean;
  /** The Quick Access control. Render it already disabled when `soon`. */
  control?: ReactNode;
  actions?: PortalAction[];
  /** What has to exist before a `soon` card can work. Shown instead of actions. */
  requires?: string[];
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {soon ? (
          <CardAction>
            <Badge variant="secondary">Coming soon</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {control ? <div>{control}</div> : null}
        {soon ? (
          requires.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-foreground">Needs first</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {requires.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap gap-2">
            {actions.map((action, index) => (
              <Button
                key={action.href}
                asChild
                size="sm"
                variant={index === 0 ? "default" : "outline"}
              >
                {action.external ? (
                  <a href={action.href}>{action.label}</a>
                ) : (
                  <Link href={action.href}>{action.label}</Link>
                )}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
