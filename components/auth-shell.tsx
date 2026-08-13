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

      {/* The full society lockup. It carries its own white background, so it
          gets a white panel rather than sitting straight on a dark page. */}
      <footer className="relative mt-10 flex justify-center">
        <span className="flex items-center rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-black/5">
          <Image
            src="/aspajccjsi-logo.png"
            alt="Association of School Paper Advisers, Journalism Coaches, and Campus Journalists of Sarangani Inc."
            width={915}
            height={484}
            className="w-[19rem] max-w-full object-contain sm:w-[23rem]"
          />
        </span>
      </footer>
    </main>
  );
}
