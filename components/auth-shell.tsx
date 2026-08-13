import Image from "next/image";

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

      {/* Only the coloured letters come from the source raster; the society's
          full name is set in real text so it stays legible and theme-aware. */}
      <footer className="relative mt-10 flex flex-col items-center gap-2">
        <span className="flex items-center rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-black/5">
          <Image
            src="/aspajccjsi-wordmark.png"
            alt="ASPAJCCJSI"
            width={400}
            height={267}
            style={{ height: "2.75rem", width: "auto" }}
            className="object-contain"
          />
        </span>
        <p className="max-w-xs text-center text-xs leading-relaxed text-muted-foreground">
          Association of School Paper Advisers, Journalism Coaches, and Campus
          Journalists of Sarangani Inc.
        </p>
        <p className="text-center text-xs text-muted-foreground">
          Division of Sarangani &middot; Schools Press Conference
        </p>
      </footer>
    </main>
  );
}
