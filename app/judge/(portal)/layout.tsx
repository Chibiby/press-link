import Link from "next/link";
import { LogOut } from "lucide-react";

import { judgeSignOutAction } from "../sign-out";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The judge portal's chrome, for the signed-in screens only.
 *
 * A route group rather than `app/judge/layout.tsx`, for the same reason
 * `app/admin/(shell)` is one: `/judge/login` is under `/judge` but must not
 * carry a sign-out button or a link back to a portal the visitor cannot reach.
 * The group draws the line without putting the sign-in page on a different URL.
 *
 * Deliberately thin otherwise: a judge has two screens — their events and one
 * sheet — so there is no nav tree to render and nothing to collapse. The "Judge"
 * badge earns its place by settling the one question the screens themselves
 * cannot: whether this is the judge's anonymous view or an admin's identified
 * one.
 */
export default function JudgePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/judge" className="min-w-0">
            <Wordmark subtitle="Judging" />
          </Link>

          <div className="flex items-center gap-2">
            <Badge variant="secondary">Judge</Badge>
            <ThemeToggle />
            <form action={judgeSignOutAction}>
              <Button type="submit" size="sm" variant="ghost">
                <LogOut className="size-4" />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
