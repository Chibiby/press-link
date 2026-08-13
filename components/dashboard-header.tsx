import { LogOut } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function DashboardHeader({
  title,
  subtitle,
  badge,
  signOutAction,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Wordmark />
        <div className="hidden h-8 w-px bg-border sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        <ThemeToggle />
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
