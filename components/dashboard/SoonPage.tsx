import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Every unbuilt page renders through here, so they cannot drift into five
 * different tones of "not ready".
 *
 * What this deliberately does not have: a table of example rows, a disabled
 * form, or a progress bar. Each of those reads as a shipped feature having a
 * bad day, and an admin would file it as a bug. `requires` is the honest
 * version — it says what is missing, so nobody has to guess whether the page
 * is broken or unwritten.
 */
export function SoonPage({
  title,
  summary,
  requires,
  children,
}: {
  title: string;
  summary: string;
  /** What must exist before this page can do anything. Never empty. */
  requires: string[];
  /** Real, readable state to show alongside — the settings page uses this. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeading title={title} badge="Coming soon" subtitle={summary} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What has to exist first</CardTitle>
            <CardDescription>
              Nothing on this page is hidden behind a setting — the data it would read is
              not in the database yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {requires.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to the dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>

        {children}
      </div>
    </div>
  );
}
