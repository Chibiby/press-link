import Image from "next/image";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The partner lockups shown along the bottom of both sign-in pages. Three come
 * from the DepEd LOGOS sheet (transparent) and one is the society lockup
 * (white background), so the whole strip sits on a single white panel to keep
 * them consistent in dark mode.
 */
const LOGOS = [
  { src: "/logo-deped-matatag.png", alt: "DepEd MATATAG", w: 256, h: 240 },
  { src: "/logo-bagong-pilipinas.png", alt: "Bagong Pilipinas", w: 258, h: 240 },
  {
    src: "/logo-deped-sarangani.png",
    alt: "Department of Education — Division of Sarangani",
    w: 241,
    h: 240,
  },
  {
    // The shield alone, not the wide lockup: at strip size the lockup's
    // three lines of small print turn to mush and its width breaks the rhythm.
    src: "/aspajccjsi-mark.png",
    alt: "Association of School Paper Advisers, Journalism Coaches, and Campus Journalists of Sarangani Inc.",
    w: 256,
    h: 256,
  },
];

/**
 * Shared frame for /login and /admin/login: the card is centred in the space
 * above the logo strip, so the strip never pushes it toward the top.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col bg-gradient-to-b from-primary/8 via-background to-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-radial-[60%_100%_at_50%_0%] from-primary/15 to-transparent"
      />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md">{children}</div>
      </div>

      <footer className="relative flex justify-center pb-8">
        <div className="flex max-w-full items-center gap-6 overflow-x-auto rounded-xl bg-white px-6 py-3 shadow-sm ring-1 ring-black/5 sm:gap-8">
          {LOGOS.map((logo) => (
            <Image
              key={logo.src}
              src={logo.src}
              alt={logo.alt}
              width={logo.w}
              height={logo.h}
              className="h-9 w-auto shrink-0 object-contain sm:h-11"
            />
          ))}
        </div>
      </footer>
    </main>
  );
}
