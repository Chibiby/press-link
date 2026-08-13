import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared frame for /login and /admin/login: centered card on a teal-tinted
 * wash, with the theme toggle pinned out of the way.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-primary/8 via-background to-background px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-radial-[60%_100%_at_50%_0%] from-primary/15 to-transparent"
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="relative w-full max-w-md">{children}</div>
      <p className="relative mt-8 text-center text-xs text-muted-foreground">
        Division of Sarangani &middot; Schools Press Conference
      </p>
    </main>
  );
}
