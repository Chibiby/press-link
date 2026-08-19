# PressLink Division Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/admin` into a Division Admin overview dashboard inside a persistent sidebar shell that matches the reference comp, without a single write to the production database.

**Architecture:** A route group `app/admin/(shell)/` holds every admin page except `login`, so one sidebar + topbar layout applies without changing any URL. The four existing pages move into the group with only their own page chrome stripped; the entries table moves to `/admin/entries` and `/admin` becomes the new overview. Every number the overview renders is produced by a pure, unit-tested module under `lib/dashboard/` — components receive computed view models and do no arithmetic.

**Tech Stack:** Next.js 16.3.0 App Router · React server components · Supabase `@supabase/ssr` (SELECT only) · Tailwind v4 CSS-first tokens · shadcn/ui + radix-ui · lucide-react · vitest · hand-rolled SVG donut (no charting dependency)

**Spec:** `docs/superpowers/specs/2026-08-19-admin-dashboard-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

**Production safety — this database is live and holds real division data.**

- No migration file is added, edited, or run by any task in this plan. `supabase/migrations/` is not touched.
- Every query is `select` only. No `insert`, `update`, `upsert`, `delete`, writing `rpc`, or DDL of any kind.
- Do not touch the seven `*_locked_guard` triggers, nor `lock_submission`, `admin_unlock_submission`, `set_paper_participation`, `admin_reset_paper_participation`.
- Do not change the signature or behaviour of any existing server action in `app/admin/**/actions.ts`.
- Do not change the `/admin/export` contract: same query params (`school, event, district, category, level, language`), same select, same `buildEntriesWorkbook()` call, same `press-link-entries-${date}.xlsx` filename, same `Cache-Control: no-store`.
- Do not touch `app/admin/login/**` or the `proxy.ts` matcher.
- Coach names may legitimately be `''` — `supabase/migrations/0015_restore_coach_name_parts.sql` added `first_name`/`last_name` with `default ''`. Zero blank rows exist today, but the schema permits them: never assume a coach has a printable name.
- Never render the `events` embed as a flat object where the query returns an array, and never label a truncated list as complete.

**Data reality — the comp's numbers are not this division's numbers.** Measured 2026-08-19:

- 332 schools registered, 16 with entries, 22 with participants, 24 with `school_papers` rows.
- 383 participants, of which 114 are linked to no entry. 83 coaches, 17 unlinked.
- 130 entries. 23 districts registered, 10 with entries. 16 event types / 56 event slots, 12 contested.
- Every participation KPI carries a denominator: headline = engaged, subtitle = `of N registered`.
- Any panel that truncates says so and links to the full list. Totals are computed over the full set, not the visible rows.

**Code conventions.**

- Pure modules live in `lib/`, are React-free, and have a colocated `*.test.ts`. Components import them; they import nothing from `components/` or `app/`.
- Test command: `npx vitest run <path>`. Type check: `npx tsc --noEmit`.
- Tailwind v4 CSS-first: colours come from tokens in `app/globals.css`, never hard-coded hex.
- `searchParams` is a `Promise` in Next 16 and must be awaited.
- Imports from inside `app/admin/(shell)/` to files in `app/admin/` use the `@/app/admin/...` alias, never `../`.

## File Structure

**Created — pure logic (`lib/`), each with a colocated test:**

| File | Responsibility |
|---|---|
| `lib/admin/nav.ts` | The nav tree and active-path matching. No React, no routing imports. |
| `lib/dashboard/kpis.ts` | Turns raw counts into KPI tiles, each with a denominator subtitle. |
| `lib/dashboard/per-school.ts` | Ranks schools, truncates to a limit, and totals the full set. |
| `lib/dashboard/per-event.ts` | Top-N event types plus a folded `Other`, each assigned a colour token. |
| `lib/dashboard/donut.ts` | Geometry only: values in, stroked-arc lengths and offsets out. Knows nothing about events. |
| `lib/dashboard/attention.ts` | The "needs attention" list and the bell badge count. |
| `lib/dashboard/activity.ts` | Merges heterogeneous activity sources into one time-ordered feed. |
| `lib/dashboard/timeline.ts` | The submission-window progress steps. |

**Created — shell chrome (`components/admin/shell/`):**

| File | Responsibility |
|---|---|
| `components/admin/shell/Sidebar.tsx` | Client. Renders `ADMIN_NAV`, highlights the active item, disables `soon` items, and carries the DepEd lockup and version line at the bottom. |
| `components/admin/shell/Topbar.tsx` | Server. Wordmark, page title, theme toggle, sign-out, optional bell slot. |
| `components/admin/shell/PageHeading.tsx` | Server. The per-page title and subtitle block every `(shell)` page renders under the topbar. |
| `components/admin/shell/MobileNav.tsx` | Client. The same nav in a hand-rolled slide-over drawer for narrow screens. `components/ui/` has no `sheet.tsx`, and this plan adds no dependency to get one. |
| `components/admin/shell/AttentionBell.tsx` | Client. Presentational: takes a `count`, renders the badge and a popover that says alerting itself is not built. Added in Phase 2. |
| `components/admin/shell/UserChip.tsx` | Server. Presentational: takes a `name`, renders the account chip and the one role this system has. Added in Phase 2. |

**Created — dashboard panels (`components/dashboard/`):** `KpiTile.tsx`, `PerSchoolTable.tsx`, `EventDonut.tsx`, `AttentionList.tsx`, `ActivityFeed.tsx`, `SubmissionTimeline.tsx`, `PortalCard.tsx`, `RegistrationPortalCard.tsx`, `SoonPage.tsx`.

**Created — routes:** `app/admin/(shell)/layout.tsx`, `app/admin/(shell)/page.tsx` (the new overview) and `app/admin/(shell)/dashboard-data.ts` (the read-only fetch layer, colocated with the page it exists for; the layout also imports one loader from it, to feed the topbar bell and chip from the same cached queries), plus the pages Phases 3 and 4 add.

**Moved — unchanged apart from stripped chrome:** `app/admin/page.tsx` → `app/admin/(shell)/entries/page.tsx`; `participants/`, `coaches/`, `school-papers/` → the same paths under `(shell)/`.

**Modified in place:** `app/globals.css` (chart tokens only — the eight `--chart-*` slots are **replaced**, per Task 1, which proves by grep that nothing reads them yet; every brand token is untouched), `app/admin/FilterBar.tsx` (two hard-coded `/admin` pushes become `/admin/entries`).

**Untouched:** `app/admin/login/**`, `app/admin/export/route.ts`, `app/admin/guard.ts`, `app/admin/actions.ts`, every `**/actions.ts`, `proxy.ts`, `supabase/**`.

---

# Phase 1 — Shell and relocation

**This is the only phase that touches code already serving production traffic.** It adds no features. Its whole job is to move four working pages into a shell and leave them working.

**Phase 1 gate, verbatim from spec §10:** `/admin/entries`, `/admin/participants`, `/admin/coaches` and `/admin/school-papers` all load with filters, exports and server actions intact; `/admin/login` renders with no shell; `/admin/export` returns a byte-identical workbook. Nothing proceeds until this holds.

---

### Task 1: Chart colour tokens

The donut needs eight series colours a reader can tell apart, plus a neutral for the folded `Other` slice.

The repo has five, and they are not a categorical set. `--chart-1`, `--chart-3` and `--chart-4` are hues 184.7, 186.4 and 181.9 — the same teal three times over, separated only by lightness. `--chart-3` sits at chroma 0.096, under the 0.10 floor where a hue starts reading as gray, and `--chart-4` at L 0.777 is over the light mode's 0.77 band ceiling. That is a sequential teal ramp filed under a categorical name. As adjacent slices of one ring those three would be indistinguishable, and under protanopia or deuteranopia so would most of the rest.

So this task **replaces all eight slot values** with the validated categorical order from the `dataviz` skill's reference palette (`references/palette.md`) and adds the de-emphasis gray for `Other`.

Three things make that safe on a production system:

- Nothing reads these tokens. `grep -rn "chart-" --include="*.tsx" --include="*.ts" .` returns nothing outside `app/globals.css`, and no charting library is installed. Today they are dead values.
- The teal brand is untouched. It lives in `--primary`, `--sidebar-primary`, `--ring` and `--accent`, none of which this task opens. "Keep teal" governs the chrome; the ring needs colours that separate.
- The values are hex, copied byte-for-byte from the validated table rather than converted to `oklch` to match the rest of the file. A conversion would round, and the palette's guarantee attaches to the exact published values. Hex is valid in a custom property and Tailwind v4 resolves it the same way.

**Files:**
- Modify: `app/globals.css` — the `@theme inline` chart block at lines 20-25, the `:root` chart block at lines 80-84, the `.dark` chart block at lines 117-121
- Test: none — CSS has no unit test. Verified by the validator in Step 4 and by grep in Step 5.

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-chart-1` … `--color-chart-8` and `--color-chart-other`, usable as Tailwind colour utilities and as `var()` values in inline SVG `fill`.

- [ ] **Step 1: Expose the new tokens in `@theme inline`**

In `app/globals.css`, replace lines 20-25:

```css
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
```

with:

```css
  --color-sidebar: var(--sidebar);
  --color-chart-other: var(--chart-other);
  --color-chart-8: var(--chart-8);
  --color-chart-7: var(--chart-7);
  --color-chart-6: var(--chart-6);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
```

- [ ] **Step 2: Set the light values in `:root`**

Replace lines 80-84 of `app/globals.css`:

```css
  --chart-1: oklch(0.6 0.118 184.704);
  --chart-2: oklch(0.769 0.188 70.08);
  --chart-3: oklch(0.511 0.096 186.391);
  --chart-4: oklch(0.777 0.152 181.912);
  --chart-5: oklch(0.554 0.046 257.417);
```

with:

```css
  /* Categorical chart slots — the validated order from the dataviz reference
     palette. The order is the colourblind-safety mechanism, not a preference:
     each slot is chosen so neighbouring slices stay separable under simulated
     protanopia and deuteranopia. Re-ordering or re-stepping these invalidates
     that guarantee — re-run scripts/validate_palette.js if you touch them. */
  --chart-1: #2a78d6; /* blue */
  --chart-2: #eb6834; /* orange */
  --chart-3: #1baf7a; /* aqua */
  --chart-4: #eda100; /* yellow */
  --chart-5: #e87ba4; /* magenta */
  --chart-6: #008300; /* green */
  --chart-7: #4a3aa7; /* violet */
  --chart-8: #e34948; /* red */
  /* The de-emphasis fill for the folded "Other" slice. Deliberately not a
     categorical hue, and deliberately the same in both modes — it is the muted
     ink from the reference palette's chrome, which is mode-invariant, so `.dark`
     does not redefine it. */
  --chart-other: #898781;
```

- [ ] **Step 3: Set the dark values in `.dark`**

Replace lines 117-121 of `app/globals.css`:

```css
  --chart-1: oklch(0.777 0.152 181.912);
  --chart-2: oklch(0.828 0.189 84.429);
  --chart-3: oklch(0.6 0.118 184.704);
  --chart-4: oklch(0.9 0.08 182);
  --chart-5: oklch(0.704 0.04 256.788);
```

with:

```css
  /* The same eight hues stepped for the dark surface — a selected dark column,
     not an automatic lightening of the light one. --chart-other is inherited
     from :root by design. */
  --chart-1: #3987e5;
  --chart-2: #d95926;
  --chart-3: #199e70;
  --chart-4: #c98500;
  --chart-5: #d55181;
  --chart-6: #008300;
  --chart-7: #9085e9;
  --chart-8: #e66767;
```

- [ ] **Step 4: Validate the palette against this app's own surfaces**

The published palette is validated against the reference surfaces `#fcfcfb` and `#1a1a19`. This app renders charts on a card, which is `oklch(1 0 0)` in light mode and `oklch(0.222 0.028 264)` in dark. Lightness band, chroma floor and both ΔE checks compare marks with each other and are unaffected by the surface, but **contrast is not** — so it gets re-run here.

`validate_palette.js` takes hex, so convert the two card colours first. Write
`scratch/oklch2hex.mjs` (`scratch/` is not a real directory yet — create it, and delete it
when this task is done; do not commit it):

```js
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return "#" + lin
    .map((v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0");
    })
    .join("");
}
console.log("light card", oklchToHex(1, 0, 0));
console.log("dark card ", oklchToHex(0.222, 0.028, 264));
```

Run `node scratch/oklch2hex.mjs`, then feed each surface to the validator. `$DATAVIZ` is the `dataviz` skill's base directory. This block is bash, not PowerShell — the validator ships in a skill directory whose path is easiest to hold in a shell variable:

```bash
PALETTE_LIGHT="#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948"
PALETTE_DARK="#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9,#e66767"
node "$DATAVIZ/scripts/validate_palette.js" "$PALETTE_LIGHT" --mode light --surface "<light card hex>"
node "$DATAVIZ/scripts/validate_palette.js" "$PALETTE_DARK"  --mode dark  --surface "<dark card hex>"
```

Both runs must exit 0. Expected: lightness band, chroma floor, CVD separation and the normal-vision floor all PASS — worst adjacent CVD ΔE 9.1 light and 8.4 dark against a target of 8, worst adjacent normal-vision ΔE 19.6 and 19.3 against a floor of 15.

Contrast is expected to come back `relief` on light mode, naming magenta, yellow and aqua as sub-3:1 on a white card. That is a documented conditional, not a failure, and it carries an obligation: those slices must be labelled visibly rather than identified by colour alone. Task 14's legend prints every slice's name, count and share beside its swatch, which discharges it. If a run reports a hard **FAIL**, stop and raise it — do not re-step a value to make the check pass, because the palette's guarantee is attached to the published hexes.

Note what is *not* being claimed: the eight slots clear the gates on the **adjacent** pairlist, which is the right list for a ring where each slice touches exactly two others. The full eight do not clear an all-pairs comparison in any ordering. That is why the legend carries numbers — a reader comparing two slices on opposite sides of the ring reads the counts, not the hues.

- [ ] **Step 5: Verify every token is defined**

Run:

```bash
grep -c -- "--color-chart-" app/globals.css; grep -c -- "^  --chart-" app/globals.css
```

Expected: `9`, then `17` — nine theme mappings, nine values in `:root`, eight in `.dark` (`--chart-other` is inherited).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat(admin): use a validated categorical palette for chart slots"
```

---

### Task 2: The nav tree as a pure module

The sidebar must not own route knowledge — that makes active-state logic untestable. The tree and the matcher live in `lib/`, React-free, with icons as string keys the sidebar maps to components.

Every route the comp shows appears from the start, so the sidebar looks finished immediately. Items whose page does not exist yet carry `soon: true` and render disabled with a "Soon" chip. Later tasks clear exactly one flag each as their page lands — a nav item is never a link to a 404.

**Files:**
- Create: `lib/admin/nav.ts`
- Test: `lib/admin/nav.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type NavIcon =
    | "dashboard" | "entries" | "papers" | "participants" | "coaches"
    | "schools" | "districts" | "events" | "summary" | "overall" | "activity"
    | "judges" | "tabulators" | "users" | "settings" | "audit";
  export interface NavItem { label: string; href: string; icon: NavIcon; soon?: boolean }
  export interface NavGroup { label: string; items: NavItem[] }
  export const ADMIN_NAV: NavGroup[];
  export function isNavActive(pathname: string, href: string): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/admin/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ADMIN_NAV, isNavActive } from "./nav";

describe("isNavActive", () => {
  it("matches the dashboard root exactly", () => {
    expect(isNavActive("/admin", "/admin")).toBe(true);
  });

  it("does not light up the dashboard on a child route", () => {
    expect(isNavActive("/admin/entries", "/admin")).toBe(false);
  });

  it("matches a section on its own path", () => {
    expect(isNavActive("/admin/entries", "/admin/entries")).toBe(true);
  });

  it("matches a section on a nested path", () => {
    expect(isNavActive("/admin/entries/abc-123", "/admin/entries")).toBe(true);
  });

  it("does not match a sibling that shares a prefix", () => {
    expect(isNavActive("/admin/entries-archive", "/admin/entries")).toBe(false);
  });
});

describe("ADMIN_NAV", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items);

  it("starts with the dashboard", () => {
    expect(ADMIN_NAV[0]?.items[0]?.href).toBe("/admin");
  });

  it("has no duplicate hrefs", () => {
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it("gives every item a non-empty label and an /admin href", () => {
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.href.startsWith("/admin")).toBe(true);
    }
  });

  it("leaves live only the routes that exist after phase 1", () => {
    const live = items.filter((i) => !i.soon).map((i) => i.href).sort();
    expect(live).toEqual([
      "/admin",
      "/admin/coaches",
      "/admin/entries",
      "/admin/participants",
      "/admin/school-papers",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: FAIL — cannot resolve `./nav`.

- [ ] **Step 3: Write the module**

Create `lib/admin/nav.ts`:

```ts
/**
 * The admin sidebar's route tree. Kept free of React so the active-state rule
 * can be unit-tested, and so the sidebar holds no route knowledge of its own.
 *
 * `icon` is a string key the sidebar maps to a lucide component. `soon: true`
 * means the page does not exist yet: the sidebar renders it disabled with a
 * "Soon" chip rather than linking to a 404. Each later task that lands a page
 * clears exactly one flag.
 */
export type NavIcon =
  | "dashboard"
  | "entries"
  | "papers"
  | "participants"
  | "coaches"
  | "schools"
  | "districts"
  | "events"
  | "summary"
  | "overall"
  | "activity"
  | "judges"
  | "tabulators"
  | "users"
  | "settings"
  | "audit";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  soon?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/admin", icon: "dashboard" }],
  },
  {
    label: "Submissions",
    items: [
      { label: "Entries", href: "/admin/entries", icon: "entries" },
      { label: "School Papers", href: "/admin/school-papers", icon: "papers" },
    ],
  },
  {
    label: "Roster",
    items: [
      { label: "Participants", href: "/admin/participants", icon: "participants" },
      { label: "Coaches", href: "/admin/coaches", icon: "coaches" },
    ],
  },
  {
    label: "Reference",
    items: [
      { label: "Schools", href: "/admin/schools", icon: "schools", soon: true },
      { label: "Districts", href: "/admin/districts", icon: "districts", soon: true },
      { label: "Events", href: "/admin/events", icon: "events", soon: true },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "School Summary", href: "/admin/summary", icon: "summary", soon: true },
      { label: "Overall Data", href: "/admin/overall-data", icon: "overall", soon: true },
      { label: "Activity Log", href: "/admin/activity", icon: "activity", soon: true },
    ],
  },
  {
    label: "Adjudication",
    items: [
      { label: "Judges Portal", href: "/admin/judges", icon: "judges", soon: true },
      { label: "Tabulators", href: "/admin/tabulators", icon: "tabulators", soon: true },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users & Access", href: "/admin/users", icon: "users", soon: true },
      { label: "Settings", href: "/admin/settings", icon: "settings", soon: true },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: "audit", soon: true },
    ],
  },
];

/**
 * "/admin" is the dashboard itself, so it matches exactly — prefix matching
 * would light it up on every admin page. Every other item also claims its
 * children, but only on a full segment boundary, so "/admin/entries" does not
 * claim "/admin/entries-archive".
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/nav.ts lib/admin/nav.test.ts
git commit -m "feat(admin): add nav tree and active-path matching"
```

---

### Task 3: Shell chrome components

Four presentational pieces in four files, no data access. They compile and type-check on their own; Task 4 assembles them into a layout.

`PageHeading` exists because the layout cannot know which page rendered beneath it. The four pages being moved each pass a `title`, `subtitle` and `badge` to `DashboardHeader` today; that information must survive the move, so it becomes a heading inside the page content instead of chrome above it.

`AdminNav` lives in `Sidebar.tsx` and is exported, because `MobileNav` renders the identical list — one source of truth for the rendered nav, one for the tree (`lib/admin/nav.ts`). `SidebarFooter` is exported from the same file for the same reason: the comp's DepEd lockup and version line sit at the bottom of both the rail and the drawer.

**Files:**
- Create: `components/admin/shell/Sidebar.tsx` (exports `AdminNav`, `Sidebar`, `SidebarFooter`), `components/admin/shell/MobileNav.tsx`, `components/admin/shell/Topbar.tsx`, `components/admin/shell/PageHeading.tsx`
- Test: none — these are presentational and have no logic worth a unit test. The logic they would otherwise contain is in `lib/admin/nav.ts`, tested in Task 2. Verified by `npx tsc --noEmit` and by the Phase 1 gate.

**Interfaces:**
- Consumes: `ADMIN_NAV`, `isNavActive`, `NavIcon` from `@/lib/admin/nav` (Task 2); `Wordmark` from `@/components/brand/wordmark`; `ThemeToggle` from `@/components/theme-toggle`; `adminSignOutAction` from `@/app/admin/actions`; `cn` from `@/lib/utils`; `Badge`, `Button` from `@/components/ui/*`; `PanelLeftClose`, `PanelLeftOpen` from `lucide-react` (both present in the installed version); the three logo files already in `public/`, and `version` from `package.json`.
- Produces:
  ```ts
  export function AdminNav(props: {                                             // in Sidebar.tsx
    onNavigate?: () => void;
    collapsed?: boolean;      // rail only; the drawer leaves it false
  }): JSX.Element
  export function SidebarFooter(props: { collapsed?: boolean }): JSX.Element     // in Sidebar.tsx
  export function Sidebar(): JSX.Element              // owns the collapse state; no props
  export function MobileNav(): JSX.Element
  export function Topbar(props: { actions?: React.ReactNode }): JSX.Element
  export function PageHeading(props: {
    title: string;
    subtitle?: React.ReactNode;
    badge?: string;
    actions?: React.ReactNode;
  }): JSX.Element
  ```

- [ ] **Step 1: Write the sidebar and the shared nav list**

Create `components/admin/shell/Sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Calculator,
  CalendarDays,
  FileText,
  Gavel,
  LayoutDashboard,
  Map,
  Newspaper,
  School,
  ScrollText,
  Settings,
  ShieldCheck,
  Table2,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { ADMIN_NAV, isNavActive, type NavIcon } from "@/lib/admin/nav";
import { cn } from "@/lib/utils";

// lib/admin/nav.ts stays React-free, so it names icons as strings and this is
// where those names become components.
const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  entries: FileText,
  papers: Newspaper,
  participants: Users,
  coaches: UserCog,
  schools: School,
  districts: Map,
  events: CalendarDays,
  summary: Table2,
  overall: BarChart3,
  activity: Activity,
  judges: Gavel,
  tabulators: Calculator,
  users: ShieldCheck,
  settings: Settings,
  audit: ScrollText,
};

/**
 * The nav list itself, shared by the desktop rail and the mobile drawer.
 * `onNavigate` lets the drawer close itself on a link click; the rail passes
 * nothing. `collapsed` is the rail's icon-only mode — the drawer never sets it,
 * because a drawer that hid its own labels would be pointless.
 */
export function AdminNav({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex-1 overflow-y-auto pb-6", collapsed ? "px-1.5" : "px-2")}>
      {ADMIN_NAV.map((group) => (
        <div key={group.label} className="mb-4">
          {/* Collapsed, the group label has nowhere to go. A rule keeps the
              grouping visible without it. */}
          {collapsed ? (
            <div className="mx-2 mb-1 border-t border-sidebar-border" />
          ) : (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];

              // A page that does not exist yet is shown, but never linked.
              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled="true"
                      title={collapsed ? `${item.label} — coming soon` : undefined}
                      className={cn(
                        "flex cursor-not-allowed items-center gap-2.5 rounded-md py-2 text-sm text-sidebar-foreground/40",
                        collapsed ? "justify-center px-2" : "px-3"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {collapsed ? (
                        <span className="sr-only">{item.label} — coming soon</span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <span className="shrink-0 rounded border border-sidebar-border px-1 py-px text-[9px] font-medium uppercase tracking-wide">
                            Soon
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                );
              }

              const active = isNavActive(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors",
                      collapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-sidebar-primary/15 font-medium text-sidebar-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {collapsed ? (
                      <span className="sr-only">{item.label}</span>
                    ) : (
                      <span className="truncate">{item.label}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The comp's footer lockup, at the bottom of the rail and the drawer.
 *
 * Three logos, not the four `components/auth-shell.tsx` shows: the society mark is
 * dropped because a 256px rail cannot carry four and stay legible. The white panel is
 * copied from that file for the same reason it exists there — the DepEd art is
 * transparent, so on the dark sidebar it would render as black-on-black.
 *
 * The version is read from package.json at build time. It is 0.1.0, not the comp's
 * 1.0.0: the comp's number is decoration, this one is a fact.
 */
const LOCKUP = [
  { src: "/logo-deped-matatag.png", alt: "DepEd MATATAG", w: 256, h: 240 },
  {
    src: "/logo-deped-sarangani.png",
    alt: "Department of Education — Division of Sarangani",
    w: 241,
    h: 240,
  },
  { src: "/logo-bagong-pilipinas.png", alt: "Bagong Pilipinas", w: 258, h: 240 },
];

export function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  // A 4rem rail cannot carry three logos at a legible size. Collapsed, the lockup
  // drops out and only the version line stays — the logos are decoration, the
  // version is a fact someone may need to read out over the phone.
  return (
    <div className="mt-auto border-t border-sidebar-border px-3 py-3">
      {collapsed ? null : (
        <div className="flex items-center justify-center gap-3 rounded-lg bg-white px-3 py-2">
          {LOCKUP.map((logo) => (
            <Image
              key={logo.src}
              src={logo.src}
              alt={logo.alt}
              width={logo.w}
              height={logo.h}
              className="h-6 w-auto shrink-0 object-contain"
            />
          ))}
        </div>
      )}
      <p
        className={cn(
          "text-center text-[10px] text-sidebar-foreground/40",
          collapsed ? "" : "pt-2"
        )}
      >
        {collapsed ? APP_VERSION : `PressLink v${APP_VERSION}`}
      </p>
    </div>
  );
}

/** Where the collapse preference is remembered between visits. */
const COLLAPSE_KEY = "presslink.admin.sidebar-collapsed";

/**
 * The desktop rail. Hidden below `lg`, where MobileNav takes over.
 *
 * The comp's collapse control lives here (spec §3.3, "sidebar collapse state").
 * It starts expanded on every render and only then reads `localStorage`, rather
 * than reading it in the `useState` initialiser: the server has no
 * `localStorage`, so initialising from it would render a different tree on the
 * server than on the client and React would throw a hydration mismatch. The
 * cost is one frame of expanded rail for an admin who prefers it collapsed.
 * That is the right trade — a visible flicker beats a console error and a
 * client-side re-render of the whole shell.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggle() {
    setCollapsed((wasCollapsed) => {
      const next = !wasCollapsed;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 py-4",
          collapsed ? "justify-center px-2" : "px-4"
        )}
      >
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <Wordmark subtitle="Division Admin" />
          </div>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>
      <AdminNav collapsed={collapsed} />
      <SidebarFooter collapsed={collapsed} />
    </aside>
  );
}
```

`AdminNav`'s `<nav>` already carries `flex-1`, so `SidebarFooter`'s `mt-auto` pins it to the
bottom of both the rail and the drawer without either needing a spacer.

Add the imports this needs to the top of the same file, beside the others:

```tsx
import { useEffect, useState } from "react";
import Image from "next/image";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { version as APP_VERSION } from "@/package.json";
```

Both module specifiers resolve as written: `tsconfig.json` already sets
`"resolveJsonModule": true` and maps `"@/*"` to `"./*"`, so no compiler option changes for
this. `PanelLeftClose` and `PanelLeftOpen` both ship in the installed `lucide-react` — if
either is missing, use `ChevronsLeft` / `ChevronsRight` rather than adding a dependency.

This file already begins with `"use client"` — `AdminNav` needs `usePathname` — so the
`useState` and `useEffect` here add no new boundary.

- [ ] **Step 2: Write the mobile drawer**

Create `components/admin/shell/MobileNav.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

import { AdminNav, SidebarFooter } from "./Sidebar";

/**
 * Hand-rolled rather than shadcn's Sheet: the repo has no sheet component and
 * this needs no new dependency. Escape closes it, the backdrop closes it, and
 * a link click closes it via AdminNav's onNavigate.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex items-center justify-between gap-2 px-4 py-4">
              <Wordmark subtitle="Division Admin" />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <AdminNav onNavigate={() => setOpen(false)} />
            <SidebarFooter />
          </div>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 3: Write the top bar**

Create `components/admin/shell/Topbar.tsx`:

```tsx
import { LogOut } from "lucide-react";

import { adminSignOutAction } from "@/app/admin/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

import { MobileNav } from "./MobileNav";

/**
 * Division identity and session controls only. Per-page titles live in
 * <PageHeading> inside each page, because a layout cannot know which page
 * rendered beneath it.
 *
 * `actions` is a slot for right-aligned, page-independent controls — the layout
 * fills it with the attention bell in phase 2.
 */
export function Topbar({ actions }: { actions?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4">
      <MobileNav />
      {/* The wordmark is in the rail on desktop, so it only shows here on narrow screens. */}
      <div className="min-w-0 flex-1 lg:hidden">
        <Wordmark />
      </div>
      <div className="hidden flex-1 lg:block" />
      {actions}
      <ThemeToggle />
      <form action={adminSignOutAction}>
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </form>
    </header>
  );
}
```

- [ ] **Step 4: Write the page heading**

Create `components/admin/shell/PageHeading.tsx`:

```tsx
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
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Nothing imports these yet, so this only proves they compile.

- [ ] **Step 6: Commit**

```bash
git add components/admin/shell
git commit -m "feat(admin): add shell chrome — sidebar, mobile nav, topbar, page heading"
```

---

### Task 4: The shell layout, and entries moves to `/admin/entries`

The riskiest task in the plan: it relocates the page that admins use most. Everything below is a mechanical move plus deletions — no behaviour changes, no query changes, no new data.

Two things the entries page loses on purpose:

- **The three sibling buttons** (Participants, Coaches, School Papers) go. The sidebar provides all three, permanently, from every page.
- **The header badge** changed from `${schools} schools` to `${shown} of ${total} entries`. The division school count belongs on the dashboard, where Phase 2 gives it a denominator; on a filtered table the useful count is how much the filter kept.

`app/admin/FilterBar.tsx` deliberately stays where it is rather than moving next to its page. It is reached by alias, and the phase that touches production code should move as few files as it can.

**Files:**
- Create: `app/admin/(shell)/layout.tsx`, `app/admin/(shell)/page.tsx` (a redirect to `/admin/entries`, replaced by the overview in Task 15)
- Move: `app/admin/page.tsx` → `app/admin/(shell)/entries/page.tsx`, then modify it
- Modify: `app/admin/FilterBar.tsx:36-38` and `app/admin/FilterBar.tsx:99`
- Test: none — no pure logic is added. Verified by `npx tsc --noEmit` and by Task 6's gate.

**Interfaces:**
- Consumes: `Sidebar` from `@/components/admin/shell/Sidebar`, `Topbar` from `@/components/admin/shell/Topbar`, `PageHeading` from `@/components/admin/shell/PageHeading` (all Task 3).
- Produces: the `(shell)` route group and its layout, which every page in Tasks 5, 15, 16 and 17-20 renders inside. The layout applies no guard — pages keep calling `requireAdmin()` themselves.

- [ ] **Step 1: Create the layout**

Create `app/admin/(shell)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { Sidebar } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";

/**
 * The admin shell. It lives in a route group, so /admin/login — which sits
 * outside the group — renders without it. Route groups are not part of the URL,
 * so every existing admin path is unchanged.
 *
 * No guard here on purpose: every page still calls requireAdmin() itself, which
 * is what keeps pages and route handlers independently protected rather than
 * both leaning on one layout.
 */
export default function AdminShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 1b: Keep `/admin` working while the overview does not exist yet**

Moving the entries page leaves `/admin` with no page, and the sidebar's Dashboard item links straight to it. Create `app/admin/(shell)/page.tsx`:

```tsx
import { redirect } from "next/navigation";

/**
 * /admin has shown the entries table since this app shipped. Task 15 replaces
 * this file with the overview dashboard; until then, redirecting keeps the URL
 * behaving exactly as admins expect and keeps the sidebar's Dashboard link off
 * a 404.
 */
export default function AdminIndexPage() {
  redirect("/admin/entries");
}
```

This is real behaviour, not a stand-in: through all of Phase 1, an admin visiting `/admin` lands on the same table they land on today.

- [ ] **Step 2: Move the entries page with git so history follows it**

Run (bash):

```bash
mkdir -p 'app/admin/(shell)/entries'
git mv app/admin/page.tsx 'app/admin/(shell)/entries/page.tsx'
```

PowerShell equivalent for the first line: `New-Item -ItemType Directory -Force 'app/admin/(shell)/entries'`

Verify: `git status --short` shows `R  app/admin/page.tsx -> app/admin/(shell)/entries/page.tsx`.

- [ ] **Step 3: Fix the moved page's imports**

In `app/admin/(shell)/entries/page.tsx`, replace lines 1-7:

```tsx
import Link from "next/link";
import { Building2, FileText, Newspaper, User, UserCog, Users } from "lucide-react";

import { requireAdmin } from "./guard";
import { adminSignOutAction } from "./actions";
import { FilterBar } from "./FilterBar";
import { DashboardHeader } from "@/components/dashboard-header";
```

with:

```tsx
import { Building2, FileText, Newspaper, User, Users } from "lucide-react";

import { requireAdmin } from "@/app/admin/guard";
import { FilterBar } from "@/app/admin/FilterBar";
import { PageHeading } from "@/components/admin/shell/PageHeading";
```

`./guard` and `./FilterBar` would now resolve inside the route group, where neither file lives. `Link`, `UserCog`, `adminSignOutAction` and `DashboardHeader` are all dropped because the only things using them are being deleted in Step 5.

- [ ] **Step 4: Drop the now-unused Button import**

In the same file, delete this line:

```tsx
import { Button } from "@/components/ui/button";
```

The three sibling buttons were its only users.

- [ ] **Step 5: Replace the page chrome with a heading**

Replace this block (it currently begins at line 130 and ends with the closing `</div>` of the button row):

```tsx
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Division Admin"
        subtitle="All school submissions"
        badge={`${(paperSchools ?? []).length} schools`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
              <p className="text-sm text-muted-foreground">
                Every entry submitted across the division.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/participants">
                  <Users className="size-4" />
                  Participants
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/coaches">
                  <UserCog className="size-4" />
                  Coaches
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/school-papers">
                  <Newspaper className="size-4" />
                  School Papers
                </Link>
              </Button>
            </div>
          </div>
```

with:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Entries"
        subtitle="Every entry submitted across the division."
        badge={`${filteredEntries.length} of ${(rawEntries ?? []).length} entries`}
      />
```

- [ ] **Step 6: Close the element tree at the new depth**

The page lost two wrapper levels, so replace the tail:

```tsx
          )}
        </div>
      </main>
    </div>
  );
}
```

with:

```tsx
      )}
    </div>
  );
}
```

Then re-indent the body of the returned `<div>` by four spaces less. If the executor's editor cannot do that reliably, leave the indentation and let the next step's Prettier/ESLint pass settle it — indentation is not correctness here, but do not skip Step 8.

- [ ] **Step 7: Retarget the filter bar at its new URL**

In `app/admin/FilterBar.tsx`, replace lines 37-38:

```ts
    const qs = params.toString();
    router.push(qs ? `/admin?${qs}` : "/admin");
```

with:

```ts
    const qs = params.toString();
    router.push(qs ? `/admin/entries?${qs}` : "/admin/entries");
```

and replace line 99:

```tsx
      <Button variant="ghost" size="sm" onClick={() => router.push("/admin")}>
```

with:

```tsx
      <Button variant="ghost" size="sm" onClick={() => router.push("/admin/entries")}>
```

Leave line 106 alone — the export link is `` `/admin/export?${searchParams.toString()}` `` and that route has not moved.

- [ ] **Step 8: Type-check and lint**

Run:

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors. An unused-import error here means Step 3 or 4 was incomplete.

- [ ] **Step 9: Confirm no `/admin` link now points at the dashboard by accident**

Run:

```bash
grep -rn '"/admin"' app components | grep -v node_modules
```

Expected: hits only in `lib/admin/nav.ts` (the dashboard's own nav entry, which is a different file — so expect **no** hits in `app/` or `components/` at all) and in `app/admin/(shell)/participants|coaches|school-papers/page.tsx`, whose back-links Task 5 removes.

- [ ] **Step 10: Commit**

```bash
git add app/admin app/globals.css components lib
git commit -m "refactor(admin): add shell route group and move entries to /admin/entries"
```

---

### Task 5: Move participants, coaches and school papers into the shell

Three moves with the same shape. All three currently import `requireAdmin` from `"../guard"`, which would resolve to a non-existent `app/admin/(shell)/guard` after the move, and all three carry a "Back to entries" button the sidebar makes redundant. Each page's `<Button>` back-link is its file's only `<Button>` usage, so `Button`, `Link` and `ArrowLeft` all become unused imports in all three.

Two of them title their content block `<h2>Roster</h2>` — indistinguishable from each other once the `DashboardHeader` title above is gone. Both get their real name, with the header's subtitle folded into the heading's subtitle so no wording is lost.

`ResetPaperButton` and `UnlockSubmissionButton` are untouched. They call server actions that write, and this plan does not go near them.

**Files:**
- Move: `app/admin/participants/` → `app/admin/(shell)/participants/`; `app/admin/coaches/` → `app/admin/(shell)/coaches/`; `app/admin/school-papers/` → `app/admin/(shell)/school-papers/` (whole directories — each contains its own filter bar, action file and buttons)
- Modify after moving: `app/admin/(shell)/participants/page.tsx:1-8,83-108,180-185`, `app/admin/(shell)/coaches/page.tsx:1-14,64-88,138-143`, `app/admin/(shell)/school-papers/page.tsx:1-17,66-84,152-157`
- Test: none. Verified by `npx tsc --noEmit` and Task 6's gate.

**Interfaces:**
- Consumes: `PageHeading` from `@/components/admin/shell/PageHeading` (Task 3), the `(shell)` layout (Task 4).
- Produces: nothing new. The three URLs are byte-identical to before.

- [ ] **Step 1: Move all three directories with git**

Run (bash):

```bash
git mv app/admin/participants 'app/admin/(shell)/participants'
git mv app/admin/coaches 'app/admin/(shell)/coaches'
git mv app/admin/school-papers 'app/admin/(shell)/school-papers'
git status --short
```

Expected: nine `R` rename lines — three `page.tsx`, three filter bars, `participants/actions.ts`, `participants/ResetPaperButton.tsx`, `coaches/CoachFilterBar.tsx`, `school-papers/actions.ts`, `school-papers/UnlockSubmissionButton.tsx`. Nothing shows as deleted-and-added.

The filter bars, action files and buttons need no edits: each already imports by `@/` alias or by a sibling relative path that moved with it.

- [ ] **Step 2: Fix the coaches page imports**

In `app/admin/(shell)/coaches/page.tsx`, replace lines 1-14:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "../guard";
import { adminSignOutAction } from "../actions";
import { CoachFilterBar } from "./CoachFilterBar";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminCoachRows,
  filterCoachRows,
  type RawAdminCoach,
} from "@/lib/roster/admin-coach-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
```

with:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { CoachFilterBar } from "./CoachFilterBar";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminCoachRows,
  filterCoachRows,
  type RawAdminCoach,
} from "@/lib/roster/admin-coach-rows";
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 3: Replace the coaches page chrome**

In the same file, replace lines 64-88:

```tsx
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Coaches"
        subtitle="Every registered coach in the division"
        badge={`${rows.length} of ${allRows.length}`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
              <p className="text-sm text-muted-foreground">
                An asterisk marks a coach on more than one entry — {multiCount} shown.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>
```

with:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Coaches"
        badge={`${rows.length} of ${allRows.length}`}
        subtitle={
          <>
            Every registered coach in the division. An asterisk marks a coach on more than one
            entry — {multiCount} shown.
          </>
        }
      />
```

- [ ] **Step 4: Close the coaches page at the new depth**

Replace lines 138-143:

```tsx
          </div>
        </div>
      </main>
    </div>
  );
}
```

with:

```tsx
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Fix the participants page imports**

In `app/admin/(shell)/participants/page.tsx`, replace lines 1-8:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "../guard";
import { adminSignOutAction } from "../actions";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { DashboardHeader } from "@/components/dashboard-header";
```

with:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
```

Then delete this line further down the same import block:

```tsx
import { Button } from "@/components/ui/button";
```

- [ ] **Step 6: Replace the participants page chrome**

Replace lines 83-108:

```tsx
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="Participants"
        subtitle="Every registered contestant in the division"
        badge={`${rows.length} listed`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
              <p className="text-sm text-muted-foreground">
                An asterisk marks a participant competing in more than one event —{" "}
                {multiCount} shown.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>
```

with:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Participants"
        badge={`${rows.length} listed`}
        subtitle={
          <>
            Every registered contestant in the division. An asterisk marks a participant competing
            in more than one event — {multiCount} shown.
          </>
        }
      />
```

- [ ] **Step 7: Close the participants page at the new depth**

Replace lines 180-185:

```tsx
          </div>
        </div>
      </main>
    </div>
  );
}
```

with:

```tsx
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Fix the school papers page imports**

In `app/admin/(shell)/school-papers/page.tsx`, replace lines 1-17:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "../guard";
import { adminSignOutAction } from "../actions";
import { SchoolPaperFilterBar } from "./SchoolPaperFilterBar";
import { UnlockSubmissionButton } from "./UnlockSubmissionButton";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminSchoolPaperRows,
  filterSchoolPaperRows,
  type RawAdminSchoolPaper,
} from "@/lib/paper/admin-papers";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
```

with:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { SchoolPaperFilterBar } from "./SchoolPaperFilterBar";
import { UnlockSubmissionButton } from "./UnlockSubmissionButton";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import {
  toAdminSchoolPaperRows,
  filterSchoolPaperRows,
  type RawAdminSchoolPaper,
} from "@/lib/paper/admin-papers";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";
import { Badge } from "@/components/ui/badge";
```

- [ ] **Step 9: Replace the school papers page chrome**

This page has no content heading at all today — the `DashboardHeader` was carrying its whole title. Replace lines 66-84:

```tsx
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="School Papers"
        subtitle="Every school's submission on record"
        badge={`${rows.length} of ${allRows.length}`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>
```

with:

```tsx
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="School Papers"
        subtitle="Every school's submission on record"
        badge={`${rows.length} of ${allRows.length}`}
      />
```

- [ ] **Step 10: Close the school papers page at the new depth**

Replace lines 152-157:

```tsx
          </div>
        </div>
      </main>
    </div>
  );
}
```

with:

```tsx
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Type-check, lint, and prove nothing still reaches for the old paths**

Run:

```bash
npx tsc --noEmit && npm run lint
grep -rn 'from "\.\./guard"\|from "\.\./actions"\|dashboard-header\|"/admin"' app | grep -v node_modules
```

Expected: no type or lint errors, and the grep returns nothing under `app/`. `components/dashboard-header.tsx` itself stays on disk — `/school` and `/entry` still use it — but no admin page imports it any more.

- [ ] **Step 12: Commit**

```bash
git add app/admin
git commit -m "refactor(admin): move participants, coaches and school papers into the shell"
```

---

### Task 6: Phase 1 gate

Nothing in Phase 2 starts until this task passes. It writes no code; it proves that four production pages survived being moved. Every check is manual because what is being verified — that a live admin console still works — is not something a unit test observes.

If any check fails, fix it inside Phase 1 and re-run the whole list. Do not carry a failure forward.

**Files:**
- Create: none
- Modify: none
- Test: none — this is the phase's acceptance run.

**Interfaces:**
- Consumes: everything Tasks 1-5 produced.
- Produces: the go-ahead for Phase 2.

- [ ] **Step 1: Confirm the tree is where the plan says it is**

Run:

```bash
npx tsc --noEmit && npm run lint && npx vitest run
find app/admin -name '*.tsx' -o -name '*.ts' | sort
```

Expected: clean type-check, clean lint, all existing tests plus `lib/admin/nav.test.ts` passing. The `find` output lists `app/admin/FilterBar.tsx`, `actions.ts`, `guard.ts`, `export/route.ts`, `login/*`, and everything else under `app/admin/(shell)/`.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`

Expected: compiles with no errors. Leave it running for the remaining steps.

- [ ] **Step 3: Check the login page has no shell**

Visit `/admin/login` signed out.

Expected: the existing login form, centred, with **no sidebar and no top bar**. This is what the route group buys — confirm it directly rather than assuming.

- [ ] **Step 4: Sign in and check the redirect**

Sign in as a division admin, then visit `/admin`.

Expected: lands on `/admin/entries` showing the entries table inside the shell. Sidebar visible on the left with the seven groups; "Entries" highlighted; every `soon` item greyed with a "Soon" chip and not clickable.

- [ ] **Step 5: Exercise every filter on the entries page**

On `/admin/entries`, change each of the six selects in turn — district, school, event, category, level, language — then click Clear.

Expected: each change navigates to `/admin/entries?<params>` (check the address bar keeps `/entries`), the table narrows, and the heading badge updates to `N of M entries`. Clear returns to a bare `/admin/entries`.

- [ ] **Step 6: Confirm the export is unchanged**

With at least two filters applied, click Export.

Expected: a file named `press-link-entries-<today>.xlsx` downloads, and its rows match what the filtered table shows. Open it and confirm the sheet has the same columns as before this plan started — including coach and participant middle names and genders, which the screen does not show.

- [ ] **Step 7: Check the other three pages and their write actions**

Visit `/admin/participants`, `/admin/coaches`, `/admin/school-papers` in turn.

Expected for each: loads inside the shell, its sidebar item highlights, its own filter bar works, its heading shows the right title and count badge, and no "Back to entries" button remains.

Then, on a school you are willing to touch, confirm the two write paths still function: `Reset paper participation` on `/admin/participants` and `Unlock submission` on `/admin/school-papers`. These are the only writes anywhere near this plan and it changed neither — this step exists to prove that.

- [ ] **Step 8: Check the mobile drawer**

Narrow the window below 1024px.

Expected: the sidebar disappears, a hamburger appears in the top bar, tapping it opens a left drawer with the same nav, tapping a link navigates and closes the drawer, Escape closes it, and tapping the backdrop closes it.

The drawer never collapses: `MobileNav` renders `AdminNav` without `collapsed`, so every label shows. Confirm that — a drawer of unlabelled icons would mean the prop leaked across.

- [ ] **Step 8b: Check the sidebar collapse**

Back above 1024px, click the collapse button beside the wordmark.

Expected: the rail narrows to 4rem, the wordmark and every nav label disappear, the icons centre, the DepEd lockup drops out and the version line shows the bare number. Hovering an icon shows its label as a tooltip. Click the button again and everything comes back.

Then reload the page. Expected: it comes back collapsed — the preference is in `localStorage` under `presslink.admin.sidebar-collapsed`. **Watch the browser console on that reload: there must be no hydration warning.** One would mean the state was initialised from `localStorage` instead of in the `useEffect`.

Last, collapse the rail and click through all four moved pages. Expected: each still marks its own nav item active — collapse changes the padding and the label, never `isNavActive`.

- [ ] **Step 9: Check both themes**

Toggle light and dark.

Expected: sidebar, top bar and tables all readable in both. The active nav item is legible against the sidebar background in both.

- [ ] **Step 10: Record the gate result and commit**

Only if every step above passed:

```bash
git add -A
git commit -m "chore(admin): phase 1 gate passed — shell live, four pages relocated"
```

If any step failed, do not commit this. Fix and re-run from Step 1.

---

# Phase 2 — The overview dashboard

Every number the dashboard shows is computed by a pure module here first, tested against the real production shape, and only then rendered. Nothing in this phase writes to the database and nothing in it touches the four pages Phase 1 moved.

**Phase 2 gate:** `/admin` renders the overview with real division figures; every panel that truncates says so; `npx vitest run` is green; the four Phase 1 pages are untouched and still work.

---

### Task 7: KPI tiles

Six tiles, exactly as spec §5.1 specifies them. Each is a headline number plus a subtitle that stops the headline misleading: 332 rows in `schools` is not 332 participating schools, and 383 learners is not 383 competing learners.

**Files:**
- Create: `lib/dashboard/kpis.ts`
- Test: `lib/dashboard/kpis.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type KpiKey = "schools" | "learners" | "coaches" | "entries" | "events" | "districts";
  export interface Kpi { key: KpiKey; label: string; value: number; subtitle: string }
  export interface KpiInput {
    schoolsRegistered: number;
    schoolsWithEntries: number;
    participants: number;
    participantsWithoutEntry: number;
    coaches: number;
    coachesWithoutEntry: number;
    entries: number;
    entriesIndividual: number;
    entriesGroup: number;
    eventTypes: number;
    eventTypesContested: number;
    districtsRegistered: number;
    districtsWithEntries: number;
  }
  export function buildKpis(input: KpiInput): Kpi[];
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/kpis.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildKpis, type KpiInput } from "./kpis";

// The figures measured in production on 2026-08-19, so the test fails loudly if
// a subtitle ever starts reading as though the whole division had competed.
const LIVE: KpiInput = {
  schoolsRegistered: 332,
  schoolsWithEntries: 16,
  participants: 383,
  participantsWithoutEntry: 114,
  coaches: 83,
  coachesWithoutEntry: 17,
  entries: 130,
  entriesIndividual: 96,
  entriesGroup: 34,
  eventTypes: 16,
  eventTypesContested: 12,
  districtsRegistered: 23,
  districtsWithEntries: 10,
};

describe("buildKpis", () => {
  it("returns the six tiles in the order the comp lays them out", () => {
    expect(buildKpis(LIVE).map((k) => k.key)).toEqual([
      "schools",
      "learners",
      "coaches",
      "entries",
      "events",
      "districts",
    ]);
  });

  it("headlines participation, not registration, for schools", () => {
    const schools = buildKpis(LIVE).find((k) => k.key === "schools");
    expect(schools).toMatchObject({
      label: "Registered Schools",
      value: 16,
      subtitle: "of 332 registered",
    });
  });

  it("says how many learners have not entered rather than implying all have", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "learners")).toMatchObject({
      label: "Learners",
      value: 383,
      subtitle: "114 not yet entered",
    });
  });

  it("does the same for coaches", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "coaches")).toMatchObject({
      label: "Coaches",
      value: 83,
      subtitle: "17 not yet entered",
    });
  });

  it("splits entries by category in the subtitle", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "entries")).toMatchObject({
      label: "Total Entries",
      value: 130,
      subtitle: "96 individual / 34 group",
    });
  });

  it("headlines contested event types against the catalogue size", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "events")).toMatchObject({
      label: "Events",
      value: 12,
      subtitle: "of 16 types",
    });
  });

  it("headlines participating districts against the registered count", () => {
    expect(buildKpis(LIVE).find((k) => k.key === "districts")).toMatchObject({
      label: "Districts",
      value: 10,
      subtitle: "of 23 registered",
    });
  });

  it("survives an empty division without dividing by anything", () => {
    const empty: KpiInput = {
      schoolsRegistered: 0,
      schoolsWithEntries: 0,
      participants: 0,
      participantsWithoutEntry: 0,
      coaches: 0,
      coachesWithoutEntry: 0,
      entries: 0,
      entriesIndividual: 0,
      entriesGroup: 0,
      eventTypes: 0,
      eventTypesContested: 0,
      districtsRegistered: 0,
      districtsWithEntries: 0,
    };
    const tiles = buildKpis(empty);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((t) => t.value === 0)).toBe(true);
    expect(tiles.every((t) => t.subtitle.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/kpis.test.ts`
Expected: FAIL — cannot resolve `./kpis`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/kpis.ts`:

```ts
/**
 * The dashboard's six headline tiles.
 *
 * Every tile carries a subtitle, and that is the whole point of this module.
 * This division has 332 registered schools and 16 that have entered anything;
 * 383 learners on the roster and 114 of them on no entry at all. A tile showing
 * a bare count would read as a participation figure and be wrong by 20x.
 */
export type KpiKey = "schools" | "learners" | "coaches" | "entries" | "events" | "districts";

export interface Kpi {
  key: KpiKey;
  label: string;
  value: number;
  subtitle: string;
}

export interface KpiInput {
  schoolsRegistered: number;
  schoolsWithEntries: number;
  participants: number;
  participantsWithoutEntry: number;
  coaches: number;
  coachesWithoutEntry: number;
  entries: number;
  entriesIndividual: number;
  entriesGroup: number;
  eventTypes: number;
  eventTypesContested: number;
  districtsRegistered: number;
  districtsWithEntries: number;
}

export function buildKpis(input: KpiInput): Kpi[] {
  return [
    {
      key: "schools",
      label: "Registered Schools",
      value: input.schoolsWithEntries,
      subtitle: `of ${input.schoolsRegistered} registered`,
    },
    {
      key: "learners",
      label: "Learners",
      value: input.participants,
      subtitle: `${input.participantsWithoutEntry} not yet entered`,
    },
    {
      key: "coaches",
      label: "Coaches",
      value: input.coaches,
      subtitle: `${input.coachesWithoutEntry} not yet entered`,
    },
    {
      key: "entries",
      label: "Total Entries",
      value: input.entries,
      subtitle: `${input.entriesIndividual} individual / ${input.entriesGroup} group`,
    },
    {
      key: "events",
      label: "Events",
      value: input.eventTypesContested,
      subtitle: `of ${input.eventTypes} types`,
    },
    {
      key: "districts",
      label: "Districts",
      value: input.districtsWithEntries,
      subtitle: `of ${input.districtsRegistered} registered`,
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/kpis.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/kpis.ts lib/dashboard/kpis.test.ts
git commit -m "feat(dashboard): build the six KPI tiles with denominator subtitles"
```

---

### Task 8: Per-school rollup

The comp shows every school in one panel. Production has 332, so this panel shows the top 15 by entries — and must never let that truncation read as the whole division.

The totals row is summed over *every* school with activity, not over the 15 rendered. That is legitimate arithmetic rather than a shortcut: a school with no participants, coaches or entries contributes zero to all three columns, so summing the active set gives the same answer as summing all 332. The school *count* is different, though — 332 registered against roughly two dozen active — so both numbers are carried separately and the panel labels which is which.

**Files:**
- Create: `lib/dashboard/per-school.ts`
- Test: `lib/dashboard/per-school.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface SchoolRollupRow {
    schoolId: string;
    schoolName: string;
    districtName: string;
    learners: number;
    coaches: number;
    entries: number;
  }
  export interface PerSchoolTotals { learners: number; coaches: number; entries: number }
  export interface PerSchoolSummary {
    rows: SchoolRollupRow[];
    totals: PerSchoolTotals;
    activeSchools: number;
    registeredSchools: number;
    hiddenSchools: number;
  }
  export function summarisePerSchool(
    active: SchoolRollupRow[],
    options: { limit: number; registeredSchools: number }
  ): PerSchoolSummary;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/per-school.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { summarisePerSchool, type SchoolRollupRow } from "./per-school";

function row(
  schoolName: string,
  entries: number,
  learners: number,
  coaches = 1
): SchoolRollupRow {
  return {
    schoolId: schoolName.toLowerCase().replace(/\s+/g, "-"),
    schoolName,
    districtName: "District I",
    learners,
    coaches,
    entries,
  };
}

describe("summarisePerSchool", () => {
  it("ranks by entries descending", () => {
    const summary = summarisePerSchool(
      [row("Bravo NHS", 4, 10), row("Alfa NHS", 9, 20), row("Charlie NHS", 6, 15)],
      { limit: 15, registeredSchools: 332 }
    );
    expect(summary.rows.map((r) => r.schoolName)).toEqual([
      "Alfa NHS",
      "Charlie NHS",
      "Bravo NHS",
    ]);
  });

  it("breaks ties on learners, then on name", () => {
    const summary = summarisePerSchool(
      [row("Zulu NHS", 3, 5), row("Alfa NHS", 3, 5), row("Mike NHS", 3, 9)],
      { limit: 15, registeredSchools: 332 }
    );
    expect(summary.rows.map((r) => r.schoolName)).toEqual([
      "Mike NHS",
      "Alfa NHS",
      "Zulu NHS",
    ]);
  });

  it("truncates to the limit and says how many it hid", () => {
    const active = Array.from({ length: 22 }, (_, i) =>
      row(`School ${String(i).padStart(2, "0")}`, 22 - i, 1)
    );
    const summary = summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(summary.rows).toHaveLength(15);
    expect(summary.hiddenSchools).toBe(7);
    expect(summary.activeSchools).toBe(22);
    expect(summary.registeredSchools).toBe(332);
  });

  it("totals every active school, not just the visible ones", () => {
    const active = Array.from({ length: 22 }, () => row("School", 2, 3, 1));
    const summary = summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(summary.totals).toEqual({ learners: 66, coaches: 22, entries: 44 });
  });

  it("hides nothing when the active set fits", () => {
    const summary = summarisePerSchool([row("Alfa NHS", 1, 1)], {
      limit: 15,
      registeredSchools: 332,
    });
    expect(summary.rows).toHaveLength(1);
    expect(summary.hiddenSchools).toBe(0);
  });

  it("handles a division with no activity at all", () => {
    const summary = summarisePerSchool([], { limit: 15, registeredSchools: 332 });
    expect(summary.rows).toEqual([]);
    expect(summary.totals).toEqual({ learners: 0, coaches: 0, entries: 0 });
    expect(summary.activeSchools).toBe(0);
    expect(summary.hiddenSchools).toBe(0);
    expect(summary.registeredSchools).toBe(332);
  });

  it("does not reorder the caller's array", () => {
    const active = [row("Bravo NHS", 1, 1), row("Alfa NHS", 9, 1)];
    summarisePerSchool(active, { limit: 15, registeredSchools: 332 });
    expect(active.map((r) => r.schoolName)).toEqual(["Bravo NHS", "Alfa NHS"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/per-school.test.ts`
Expected: FAIL — cannot resolve `./per-school`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/per-school.ts`:

```ts
/**
 * The dashboard's per-school panel.
 *
 * `active` is every school with at least one participant, coach or entry —
 * roughly two dozen of the division's 332. The panel renders the top `limit` of
 * them, so three separate numbers matter and are kept separate:
 *
 * - `rows`          what is on screen
 * - `activeSchools` how many schools have any activity at all
 * - `registeredSchools` how many exist
 *
 * `totals` sums `active`, not `rows`. That is the division-wide figure despite
 * the input being filtered: a school with no participants, coaches or entries
 * contributes zero to all three columns, so the filtered sum equals the full
 * sum. The school count is the one figure this does not hold for, which is why
 * it is carried separately rather than derived.
 */
export interface SchoolRollupRow {
  schoolId: string;
  schoolName: string;
  districtName: string;
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerSchoolTotals {
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerSchoolSummary {
  rows: SchoolRollupRow[];
  totals: PerSchoolTotals;
  activeSchools: number;
  registeredSchools: number;
  hiddenSchools: number;
}

export function summarisePerSchool(
  active: SchoolRollupRow[],
  options: { limit: number; registeredSchools: number }
): PerSchoolSummary {
  const totals = active.reduce<PerSchoolTotals>(
    (acc, school) => ({
      learners: acc.learners + school.learners,
      coaches: acc.coaches + school.coaches,
      entries: acc.entries + school.entries,
    }),
    { learners: 0, coaches: 0, entries: 0 }
  );

  // Copy before sorting: this is a view model, and reordering the caller's array
  // would surprise anything that reads it afterwards.
  const ranked = [...active].sort(
    (a, b) =>
      b.entries - a.entries ||
      b.learners - a.learners ||
      a.schoolName.localeCompare(b.schoolName, "en")
  );

  const rows = ranked.slice(0, Math.max(0, options.limit));

  return {
    rows,
    totals,
    activeSchools: active.length,
    registeredSchools: options.registeredSchools,
    hiddenSchools: Math.max(0, active.length - rows.length),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/per-school.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/per-school.ts lib/dashboard/per-school.test.ts
git commit -m "feat(dashboard): rank schools and total the full active set"
```

---

### Task 9: Per-event slices

The comp's donut has one slice per event. Production has 56 events, which would be an unreadable ring, so the panel groups by the 16 *event types* instead and collapses everything past the top 8 into one "Other" slice. On today's data the top 8 hold 119 of 130 entries, so Other is a genuine remainder rather than a dumping ground.

This task produces only the numbers and the colour assignments. Task 10 turns them into arc geometry.

**Files:**
- Create: `lib/dashboard/per-event.ts`
- Test: `lib/dashboard/per-event.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface EventTypeCount { typeId: string; typeName: string; entries: number }
  export interface EventSlice {
    key: string;
    label: string;
    entries: number;
    share: number;      // 0..1
    colorVar: string;   // a CSS custom property name, e.g. "--color-chart-1"
    isOther: boolean;
  }
  export interface PerEventSummary {
    slices: EventSlice[];
    totalEntries: number;
    typesWithEntries: number;
    typesTotal: number;
    otherTypes: number;
  }
  export function summarisePerEvent(
    counts: EventTypeCount[],
    options: { topN: number; typesTotal: number }
  ): PerEventSummary;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/per-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { summarisePerEvent, type EventTypeCount } from "./per-event";

function type(typeName: string, entries: number): EventTypeCount {
  return { typeId: typeName.toLowerCase().replace(/\s+/g, "-"), typeName, entries };
}

describe("summarisePerEvent", () => {
  it("ranks by entries descending and shares sum to one", () => {
    const summary = summarisePerEvent(
      [type("Editorial Writing", 20), type("News Writing", 30), type("Photojournalism", 50)],
      { topN: 8, typesTotal: 16 }
    );
    expect(summary.slices.map((s) => s.label)).toEqual([
      "Photojournalism",
      "News Writing",
      "Editorial Writing",
    ]);
    expect(summary.totalEntries).toBe(100);
    expect(summary.slices.map((s) => s.share)).toEqual([0.5, 0.3, 0.2]);
  });

  it("drops event types nobody entered", () => {
    const summary = summarisePerEvent(
      [type("Radio Broadcasting", 4), type("Collaborative Publishing", 0)],
      { topN: 8, typesTotal: 16 }
    );
    expect(summary.slices.map((s) => s.label)).toEqual(["Radio Broadcasting"]);
    expect(summary.typesWithEntries).toBe(1);
    expect(summary.typesTotal).toBe(16);
  });

  it("collapses the tail past topN into one Other slice", () => {
    const counts = [
      ...Array.from({ length: 8 }, (_, i) => type(`Top ${i}`, 20 - i)),
      type("Tail A", 3),
      type("Tail B", 2),
      type("Tail C", 1),
    ];
    const summary = summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(summary.slices).toHaveLength(9);
    const other = summary.slices.at(-1)!;
    expect(other).toMatchObject({ label: "Other", entries: 6, isOther: true });
    expect(summary.otherTypes).toBe(3);
    expect(summary.totalEntries).toBe(136);
  });

  it("adds no Other slice when everything fits", () => {
    const summary = summarisePerEvent([type("Alfa", 2), type("Bravo", 1)], {
      topN: 8,
      typesTotal: 16,
    });
    expect(summary.slices.some((s) => s.isOther)).toBe(false);
    expect(summary.otherTypes).toBe(0);
  });

  it("cycles the chart tokens and gives Other its own", () => {
    const counts = Array.from({ length: 10 }, (_, i) => type(`Type ${i}`, 20 - i));
    const summary = summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(summary.slices.map((s) => s.colorVar)).toEqual([
      "--color-chart-1",
      "--color-chart-2",
      "--color-chart-3",
      "--color-chart-4",
      "--color-chart-5",
      "--color-chart-6",
      "--color-chart-7",
      "--color-chart-8",
      "--color-chart-other",
    ]);
  });

  it("breaks ties on name so the ring is stable between renders", () => {
    const summary = summarisePerEvent([type("Zulu", 5), type("Alfa", 5)], {
      topN: 8,
      typesTotal: 16,
    });
    expect(summary.slices.map((s) => s.label)).toEqual(["Alfa", "Zulu"]);
  });

  it("survives a division with no entries yet", () => {
    const summary = summarisePerEvent([type("Alfa", 0)], { topN: 8, typesTotal: 16 });
    expect(summary.slices).toEqual([]);
    expect(summary.totalEntries).toBe(0);
    expect(summary.typesWithEntries).toBe(0);
  });

  it("does not reorder the caller's array", () => {
    const counts = [type("Bravo", 1), type("Alfa", 9)];
    summarisePerEvent(counts, { topN: 8, typesTotal: 16 });
    expect(counts.map((c) => c.typeName)).toEqual(["Bravo", "Alfa"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/per-event.test.ts`
Expected: FAIL — cannot resolve `./per-event`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/per-event.ts`:

```ts
/**
 * The dashboard's per-event donut.
 *
 * Grouped by event *type* rather than by event: the division runs 56 events
 * across 16 types, and 56 slices is not a chart. Types with no entries are
 * dropped from the ring — an invisible zero-width arc is noise in the legend —
 * but `typesTotal` keeps the denominator on screen so the panel can say
 * "12 of 16 types".
 *
 * `share` is the exact fraction. Callers format it, and a rounded set of
 * percentages will not always total 100, so the panel shows shares beside
 * counts rather than claiming they add up.
 */
export interface EventTypeCount {
  typeId: string;
  typeName: string;
  entries: number;
}

export interface EventSlice {
  key: string;
  label: string;
  entries: number;
  share: number;
  colorVar: string;
  isOther: boolean;
}

export interface PerEventSummary {
  slices: EventSlice[];
  totalEntries: number;
  typesWithEntries: number;
  typesTotal: number;
  otherTypes: number;
}

const SLICE_TOKENS = [
  "--color-chart-1",
  "--color-chart-2",
  "--color-chart-3",
  "--color-chart-4",
  "--color-chart-5",
  "--color-chart-6",
  "--color-chart-7",
  "--color-chart-8",
];
const OTHER_TOKEN = "--color-chart-other";

export function summarisePerEvent(
  counts: EventTypeCount[],
  options: { topN: number; typesTotal: number }
): PerEventSummary {
  const entered = counts.filter((count) => count.entries > 0);
  const totalEntries = entered.reduce((sum, count) => sum + count.entries, 0);

  const ranked = [...entered].sort(
    (a, b) => b.entries - a.entries || a.typeName.localeCompare(b.typeName, "en")
  );

  const topN = Math.max(0, options.topN);
  const head = ranked.slice(0, topN);
  const tail = ranked.slice(topN);

  const share = (entries: number) => (totalEntries === 0 ? 0 : entries / totalEntries);

  const slices: EventSlice[] = head.map((count, index) => ({
    key: count.typeId,
    label: count.typeName,
    entries: count.entries,
    share: share(count.entries),
    // More types than tokens would wrap and repeat a colour; topN is 8 and there
    // are 8 tokens, so the modulo is a guard rather than a live code path.
    colorVar: SLICE_TOKENS[index % SLICE_TOKENS.length],
    isOther: false,
  }));

  if (tail.length > 0) {
    const otherEntries = tail.reduce((sum, count) => sum + count.entries, 0);
    slices.push({
      key: "other",
      label: "Other",
      entries: otherEntries,
      share: share(otherEntries),
      colorVar: OTHER_TOKEN,
      isOther: true,
    });
  }

  return {
    slices,
    totalEntries,
    typesWithEntries: entered.length,
    typesTotal: options.typesTotal,
    otherTypes: tail.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/per-event.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/per-event.ts lib/dashboard/per-event.test.ts
git commit -m "feat(dashboard): group entries by event type into donut slices"
```

---

### Task 10: Donut geometry

A ring drawn with stroked circles rather than arc paths. Each slice is one `<circle>` sharing a centre and radius, made visible for part of its circumference by `stroke-dasharray` and rotated into place by `stroke-dashoffset`. No trigonometry, no path-string assembly, no charting dependency — and each slice stays a real element, so it can carry its own `<title>` for a native hover tooltip.

This module knows only numbers. It never sees an event, and it does not decide colours — it passes through whatever token each value arrived with.

Two details are deliberate and pinned by tests:

- **The 2px gap between fills** is carved out of the end of each slice's own arc, so the ring still measures exactly one circumference and the gaps land between neighbours. A single-slice ring gets no gap: a lone notch in an otherwise complete circle reads as a rendering bug, not as a separator.
- **A slice too small to draw is drawn anyway**, clamped to `minLength`. A type with one entry out of a hundred and thirty computes to under two pixels, and `raw - gap` would take it to zero — a slice present in the legend and absent from the ring. Clamping costs a little accuracy on the smallest arcs; the legend carries the exact counts, so the arithmetic stays honest where it matters.

**Files:**
- Create: `lib/dashboard/donut.ts`
- Test: `lib/dashboard/donut.test.ts`

**Interfaces:**
- Consumes: nothing. Task 14 feeds it the `EventSlice[]` from Task 9, mapped to `{ key, value: entries, colorVar }`.
- Produces:
  ```ts
  export interface DonutInput { key: string; value: number; colorVar: string }
  export interface DonutSegment {
    key: string;
    colorVar: string;
    dashArray: string;   // ready for the stroke-dasharray attribute
    dashOffset: number;  // ready for stroke-dashoffset
    lengthPx: number;
  }
  export interface DonutGeometry {
    size: number;
    center: number;
    radius: number;
    thickness: number;
    circumference: number;
    segments: DonutSegment[];
  }
  export function donutGeometry(
    values: DonutInput[],
    options: { size: number; thickness: number; gap?: number; minLength?: number }
  ): DonutGeometry;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/donut.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { donutGeometry, type DonutInput } from "./donut";

function slice(key: string, value: number): DonutInput {
  return { key, value, colorVar: `--color-chart-${key}` };
}

// size 200, thickness 20 -> radius 90, circumference 2π·90
const OPTS = { size: 200, thickness: 20 };
const CIRCUMFERENCE = 2 * Math.PI * 90;

describe("donutGeometry", () => {
  it("derives the ring from size and thickness", () => {
    const ring = donutGeometry([slice("1", 1)], OPTS);
    expect(ring.radius).toBeCloseTo(90);
    expect(ring.center).toBe(100);
    expect(ring.circumference).toBeCloseTo(CIRCUMFERENCE);
    expect(ring.thickness).toBe(20);
    expect(ring.size).toBe(200);
  });

  it("gives a lone slice the whole ring and no gap", () => {
    const ring = donutGeometry([slice("1", 7)], OPTS);
    expect(ring.segments).toHaveLength(1);
    expect(ring.segments[0].lengthPx).toBeCloseTo(CIRCUMFERENCE);
    expect(ring.segments[0].dashOffset).toBe(0);
  });

  it("splits two equal slices in half, less one gap each", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 5)], { ...OPTS, gap: 2 });
    const half = CIRCUMFERENCE / 2;
    expect(ring.segments[0].lengthPx).toBeCloseTo(half - 2);
    expect(ring.segments[1].lengthPx).toBeCloseTo(half - 2);
  });

  it("offsets each slice by the full span of the ones before it", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 3), slice("3", 2)], {
      ...OPTS,
      gap: 2,
    });
    expect(ring.segments[0].dashOffset).toBe(0);
    expect(ring.segments[1].dashOffset).toBeCloseTo(-CIRCUMFERENCE * 0.5);
    expect(ring.segments[2].dashOffset).toBeCloseTo(-CIRCUMFERENCE * 0.8);
  });

  it("keeps the gaps out of the total, so the arcs still fill the ring", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 3), slice("3", 2)], {
      ...OPTS,
      gap: 2,
    });
    const drawn = ring.segments.reduce((sum, s) => sum + s.lengthPx, 0);
    expect(drawn).toBeCloseTo(CIRCUMFERENCE - 3 * 2);
  });

  it("writes dashArray as the visible length then the remainder", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 5)], { ...OPTS, gap: 2 });
    const { lengthPx, dashArray } = ring.segments[0];
    expect(dashArray).toBe(`${lengthPx} ${CIRCUMFERENCE - lengthPx}`);
  });

  it("keeps a slice too small to draw visible", () => {
    // 1 of 400 on this ring is ~1.4px, and 1.4 - 2 would be negative.
    const ring = donutGeometry([slice("1", 399), slice("2", 1)], {
      ...OPTS,
      gap: 2,
      minLength: 2,
    });
    expect(ring.segments[1].lengthPx).toBe(2);
  });

  it("drops slices with no value", () => {
    const ring = donutGeometry([slice("1", 5), slice("2", 0)], OPTS);
    expect(ring.segments.map((s) => s.key)).toEqual(["1"]);
  });

  it("returns an empty ring when there is nothing to show", () => {
    const ring = donutGeometry([], OPTS);
    expect(ring.segments).toEqual([]);
    expect(ring.circumference).toBeCloseTo(CIRCUMFERENCE);
  });

  it("carries each slice's colour token through untouched", () => {
    const ring = donutGeometry([slice("1", 5), slice("other", 5)], OPTS);
    expect(ring.segments.map((s) => s.colorVar)).toEqual([
      "--color-chart-1",
      "--color-chart-other",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const values = [slice("1", 5), slice("2", 0)];
    donutGeometry(values, OPTS);
    expect(values).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/donut.test.ts`
Expected: FAIL — cannot resolve `./donut`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/donut.ts`:

```ts
/**
 * Donut geometry for a stroked-circle ring.
 *
 * Each segment is one `<circle>` of shared centre and radius, revealed for part
 * of its circumference by `stroke-dasharray` and rotated into position by
 * `stroke-dashoffset`. The alternative — assembling annular-sector `<path>`
 * strings — needs trigonometry for the same result and is harder to check.
 *
 * The renderer supplies the wrapper:
 *
 *   <svg viewBox={`0 0 ${size} ${size}`}>
 *     <g transform={`rotate(-90 ${center} ${center})`}>   // start at 12 o'clock
 *       {segments.map((s) => (
 *         <circle key={s.key} cx={center} cy={center} r={radius} fill="none"
 *                 stroke={`var(${s.colorVar})`} strokeWidth={thickness}
 *                 strokeDasharray={s.dashArray} strokeDashoffset={s.dashOffset} />
 *       ))}
 *     </g>
 *   </svg>
 *
 * Offsets are negative: `stroke-dashoffset` advances the dash pattern, so
 * pushing a slice further round the ring means offsetting backwards. The dash
 * pattern's period is the full circumference, so -c and (circumference - c)
 * render identically; the negative form keeps the first slice at a plain 0.
 */
export interface DonutInput {
  key: string;
  value: number;
  colorVar: string;
}

export interface DonutSegment {
  key: string;
  colorVar: string;
  dashArray: string;
  dashOffset: number;
  lengthPx: number;
}

export interface DonutGeometry {
  size: number;
  center: number;
  radius: number;
  thickness: number;
  circumference: number;
  segments: DonutSegment[];
}

export function donutGeometry(
  values: DonutInput[],
  options: { size: number; thickness: number; gap?: number; minLength?: number }
): DonutGeometry {
  const { size, thickness } = options;
  const gap = options.gap ?? 2;
  const minLength = options.minLength ?? 2;

  // The stroke straddles the radius, so the ring's outer edge sits at
  // radius + thickness/2 — pull the radius in by half the thickness to keep the
  // whole band inside the viewBox.
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const drawable = values.filter((value) => value.value > 0);
  const total = drawable.reduce((sum, value) => sum + value.value, 0);

  // A single slice needs no separator: one notch in an otherwise closed ring
  // reads as a bug rather than as a gap between neighbours.
  const effectiveGap = drawable.length > 1 ? gap : 0;

  let cursor = 0;
  const segments = drawable.map((value) => {
    const span = (circumference * value.value) / total;
    const lengthPx = Math.max(minLength, span - effectiveGap);
    const segment: DonutSegment = {
      key: value.key,
      colorVar: value.colorVar,
      lengthPx,
      dashArray: `${lengthPx} ${circumference - lengthPx}`,
      dashOffset: cursor === 0 ? 0 : -cursor,
    };
    // Advance by the slice's true share, not by what was drawn, so the gap comes
    // out of this slice rather than pushing every later slice around the ring.
    cursor += span;
    return segment;
  });

  return { size, center, radius, thickness, circumference, segments };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/donut.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/donut.ts lib/dashboard/donut.test.ts
git commit -m "feat(dashboard): compute donut ring geometry from slice values"
```

---

### Task 11: Needs-attention items

Four gaps worth chasing, each one a count beside a link that filters a page down to exactly the rows the count came from. That coupling is the reason this is a module rather than four numbers inlined in the page: the count and the link have to describe the same condition, and the only way to keep them from drifting is to define them in one place and test them together.

Three of the four link somewhere that exists today:

| Item | Destination | Status |
|---|---|---|
| Learners with no entry | `/admin/participants?unassigned=1` | the filter is added in Step 1 below |
| Coaches with no entry | `/admin/coaches?unassigned=1` | already works — `filterCoachRows` has handled `unassigned` since the roster work |
| Schools that have not started their school paper | `/admin/school-papers?status=incomplete` | already works |
| Schools with learners but no entry | — | `/admin/schools` does not exist until Task 19; `href` is `null` and the row renders unlinked |

Two notes on the wording, because both were changed from the spec on purpose:

- The spec called the fourth item "schools still undecided on paper participation (308)". `paperStatus()` folds `undecided` together with "answered but nothing saved and not locked" into `incomplete`, labelled **Not started**. Counting `undecided` while linking to `?status=incomplete` would put a different number on the dashboard from the one on the page it opens. The count follows the filter instead.
- No item's label contains its own count, so nothing needs pluralising and the panel is free to render the number wherever it likes.

The order is fixed rather than sorted by size. A list that reshuffles as the counts move is hard to build a habit around, and these four have a natural priority: a registered learner who never got entered is the most retrievable loss; a school that has not started its paper is, for most of the division, simply the starting state.

**Files:**
- Modify: `app/admin/(shell)/participants/page.tsx:39-43` and its filter chain at lines 77-79
- Create: `lib/dashboard/attention.ts`
- Test: `lib/dashboard/attention.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type AttentionKey =
    | "learners-no-entry"
    | "schools-no-entry"
    | "coaches-no-entry"
    | "paper-not-started";
  export interface AttentionInput {
    learnersWithoutEntry: number;
    schoolsWithLearnersButNoEntry: number;
    coachesWithoutEntry: number;
    schoolsPaperNotStarted: number;
  }
  export interface AttentionItem {
    key: AttentionKey;
    label: string;
    detail: string;
    count: number;
    href: string | null;
    tone: "warn" | "info";
  }
  export function buildAttention(input: AttentionInput): AttentionItem[];
  export function attentionBadge(items: AttentionItem[]): number;
  ```

- [ ] **Step 1: Teach the participants page the `unassigned` filter**

The coaches page already reads `unassigned=1` as "no entry". Give the participants page the same parameter so its link has somewhere to land.

In `app/admin/(shell)/participants/page.tsx`, replace lines 39-43:

```tsx
interface SearchParams {
  district?: string;
  school?: string;
  multi?: string;
}
```

with:

```tsx
interface SearchParams {
  district?: string;
  school?: string;
  multi?: string;
  unassigned?: string;
}
```

Then extend the filter chain — replace:

```tsx
  if (params.multi === "1") rows = rows.filter((r) => r.isMultiEvent);
```

with:

```tsx
  if (params.multi === "1") rows = rows.filter((r) => r.isMultiEvent);
  // Same parameter and same meaning as /admin/coaches?unassigned=1: registered
  // but on no entry. An unrecognised value is no filter, matching the sibling
  // pages — a hand-edited URL should not show an empty table as if the division
  // had no learners.
  if (params.unassigned === "1") rows = rows.filter((r) => r.eventCount === 0);
```

`AdminParticipantRow.eventCount` already exists (`lib/roster/admin-rows.ts:38`), so this needs no query change and no new type.

- [ ] **Step 2: Write the failing test**

Create `lib/dashboard/attention.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { attentionBadge, buildAttention, type AttentionInput } from "./attention";

const FULL: AttentionInput = {
  learnersWithoutEntry: 114,
  schoolsWithLearnersButNoEntry: 6,
  coachesWithoutEntry: 17,
  schoolsPaperNotStarted: 308,
};

describe("buildAttention", () => {
  it("lists every non-zero category in priority order", () => {
    expect(buildAttention(FULL).map((i) => i.key)).toEqual([
      "learners-no-entry",
      "schools-no-entry",
      "coaches-no-entry",
      "paper-not-started",
    ]);
  });

  it("carries the counts through", () => {
    const byKey = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.count]));
    expect(byKey).toEqual({
      "learners-no-entry": 114,
      "schools-no-entry": 6,
      "coaches-no-entry": 17,
      "paper-not-started": 308,
    });
  });

  it("points each item at the filter that reproduces its count", () => {
    const byKey = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.href]));
    expect(byKey).toEqual({
      "learners-no-entry": "/admin/participants?unassigned=1",
      "schools-no-entry": null,
      "coaches-no-entry": "/admin/coaches?unassigned=1",
      "paper-not-started": "/admin/school-papers?status=incomplete",
    });
  });

  it("drops a category with nothing to chase", () => {
    const items = buildAttention({ ...FULL, coachesWithoutEntry: 0 });
    expect(items.map((i) => i.key)).not.toContain("coaches-no-entry");
    expect(items).toHaveLength(3);
  });

  it("returns nothing when the division is fully entered", () => {
    const items = buildAttention({
      learnersWithoutEntry: 0,
      schoolsWithLearnersButNoEntry: 0,
      coachesWithoutEntry: 0,
      schoolsPaperNotStarted: 0,
    });
    expect(items).toEqual([]);
  });

  it("keeps no count inside a label, so nothing needs pluralising", () => {
    for (const item of buildAttention(FULL)) {
      expect(item.label).not.toMatch(/\d/);
    }
  });

  it("treats an unstarted school paper as information, not a warning", () => {
    const tones = Object.fromEntries(buildAttention(FULL).map((i) => [i.key, i.tone]));
    expect(tones["paper-not-started"]).toBe("info");
    expect(tones["learners-no-entry"]).toBe("warn");
  });
});

describe("attentionBadge", () => {
  it("counts categories, not rows", () => {
    expect(attentionBadge(buildAttention(FULL))).toBe(4);
  });

  it("is zero when there is nothing to show", () => {
    expect(attentionBadge([])).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/attention.test.ts`
Expected: FAIL — cannot resolve `./attention`.

- [ ] **Step 4: Write the module**

Create `lib/dashboard/attention.ts`:

```ts
/**
 * The dashboard's "needs attention" list.
 *
 * Each item pairs a count with the link that filters a page down to the rows
 * that produced it. Defining both here is the point of the module: a count and a
 * link that describe slightly different conditions is a bug nobody notices until
 * someone follows the link and gets a different number.
 *
 * Order is fixed, not sorted by size — a list that reshuffles as the data moves
 * is hard to build a habit around.
 */
export type AttentionKey =
  | "learners-no-entry"
  | "schools-no-entry"
  | "coaches-no-entry"
  | "paper-not-started";

export interface AttentionInput {
  learnersWithoutEntry: number;
  schoolsWithLearnersButNoEntry: number;
  coachesWithoutEntry: number;
  schoolsPaperNotStarted: number;
}

export interface AttentionItem {
  key: AttentionKey;
  label: string;
  detail: string;
  count: number;
  href: string | null;
  tone: "warn" | "info";
}

export function buildAttention(input: AttentionInput): AttentionItem[] {
  const all: AttentionItem[] = [
    {
      key: "learners-no-entry",
      label: "Learners with no entry",
      detail: "Registered on a school roster but not entered in any event.",
      count: input.learnersWithoutEntry,
      href: "/admin/participants?unassigned=1",
      tone: "warn",
    },
    {
      key: "schools-no-entry",
      label: "Schools with learners but no entry",
      detail: "A roster was built and then nothing was submitted.",
      count: input.schoolsWithLearnersButNoEntry,
      // No destination yet: /admin/schools arrives with the detail pages. The
      // count is still worth showing, so the row renders unlinked until then.
      href: null,
      tone: "warn",
    },
    {
      key: "coaches-no-entry",
      label: "Coaches with no entry",
      detail: "Registered as a coach but not attached to an entry.",
      count: input.coachesWithoutEntry,
      href: "/admin/coaches?unassigned=1",
      tone: "warn",
    },
    {
      key: "paper-not-started",
      // Worded to match paperStatus()'s "Not started", which is what the linked
      // filter selects. The spec's "undecided" is narrower than ?status=incomplete
      // and would have put a different number here from the one on that page.
      label: "Schools that have not started their school paper",
      detail: "No answer on participation yet, or answered with nothing saved.",
      count: input.schoolsPaperNotStarted,
      href: "/admin/school-papers?status=incomplete",
      tone: "info",
    },
  ];

  return all.filter((item) => item.count > 0);
}

/** The bell's badge: how many categories need attention, not how many rows. */
export function attentionBadge(items: AttentionItem[]): number {
  return items.length;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/attention.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Check the new filter against production data**

Start the dev server and open `/admin/participants?unassigned=1`. The table must show fewer rows than `/admin/participants`, every visible row must have an unasterisked number, and removing the parameter must restore the full list. Then open `/admin/coaches?unassigned=1` and `/admin/school-papers?status=incomplete` and note the three counts — Task 15 will show them on the dashboard, and they have to agree.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/attention.ts lib/dashboard/attention.test.ts "app/admin/(shell)/participants/page.tsx"
git commit -m "feat(dashboard): pair attention counts with the filters that reproduce them"
```

---

### Task 12: Activity feed merge

The comp has a live activity stream. There is no event log in this database and adding one would mean a migration, so the feed is assembled from six timestamp columns the schema already keeps:

| Source | Column | Reads as |
|---|---|---|
| `entries` | `submitted_at` | an entry was submitted |
| `participants` | `created_at` | a learner was registered |
| `coaches` | `created_at` | a coach was registered |
| `schools` | `paper_answered_at` | a school answered on paper participation |
| `schools` | `submission_locked_at` | a school locked its submissions |
| `school_papers` | `updated_at` | a school paper was edited |

Six `order(column, { ascending: false }).limit(n)` queries, merged here.

**One invariant matters and is easy to get wrong: each source must be fetched with the same limit the merge is asked for.** Merging six lists each truncated at `n` yields the true newest `n` overall — anything a source dropped is older than that source's own `n`th row and so cannot place. Ask the merge for 50 while fetching 8 per source and the tail of the feed is quietly wrong. The dashboard fetches 8 and shows 5; `/admin/activity` fetches 50 and shows 50.

Timestamps are compared as instants rather than as strings. Postgres hands back a consistent format today, so a lexicographic sort would agree, but it agrees by luck — one differing UTC offset and a string sort silently reorders the feed.

**Files:**
- Create: `lib/dashboard/activity.ts`
- Test: `lib/dashboard/activity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ActivityKind =
    | "entry"
    | "participant"
    | "coach"
    | "paper-answer"
    | "submission-lock"
    | "paper-update";
  export interface ActivityItem {
    id: string;          // `${kind}:${row id}` — stable across renders
    kind: ActivityKind;
    at: string;          // ISO timestamp, as Supabase returns it
    title: string;
    meta: string | null;
    href: string | null;
  }
  export function mergeActivity(sources: ActivityItem[][], limit: number): ActivityItem[];
  export function relativeTime(at: string, now: Date): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/activity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mergeActivity, relativeTime, type ActivityItem } from "./activity";

function item(id: string, at: string, kind: ActivityItem["kind"] = "entry"): ActivityItem {
  return { id, kind, at, title: id, meta: null, href: null };
}

describe("mergeActivity", () => {
  it("interleaves the sources newest first", () => {
    const merged = mergeActivity(
      [
        [item("a", "2026-08-19T10:00:00+00:00"), item("b", "2026-08-17T10:00:00+00:00")],
        [item("c", "2026-08-18T10:00:00+00:00")],
      ],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("stops at the limit", () => {
    const merged = mergeActivity(
      [
        [item("a", "2026-08-19T10:00:00+00:00")],
        [item("b", "2026-08-18T10:00:00+00:00")],
        [item("c", "2026-08-17T10:00:00+00:00")],
      ],
      2
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("compares instants, not strings", () => {
    // 09:00+08:00 is 01:00Z — earlier than 02:00Z, though it sorts later as text.
    const merged = mergeActivity(
      [[item("manila", "2026-08-19T09:00:00+08:00")], [item("utc", "2026-08-19T02:00:00+00:00")]],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["utc", "manila"]);
  });

  it("drops rows whose timestamp is missing or unparseable", () => {
    const merged = mergeActivity(
      [[item("good", "2026-08-19T10:00:00+00:00"), item("blank", ""), item("junk", "soon")]],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["good"]);
  });

  it("breaks ties on id so the order is stable between renders", () => {
    const at = "2026-08-19T10:00:00+00:00";
    const merged = mergeActivity([[item("zulu", at)], [item("alfa", at)]], 10);
    expect(merged.map((i) => i.id)).toEqual(["alfa", "zulu"]);
  });

  it("handles no sources and empty sources", () => {
    expect(mergeActivity([], 10)).toEqual([]);
    expect(mergeActivity([[], []], 10)).toEqual([]);
  });

  it("does not mutate the caller's arrays", () => {
    const source = [item("b", "2026-08-17T10:00:00+00:00"), item("a", "2026-08-19T10:00:00+00:00")];
    mergeActivity([source], 10);
    expect(source.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-19T12:00:00+00:00");

  it("calls the last minute just now", () => {
    expect(relativeTime("2026-08-19T11:59:30+00:00", now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime("2026-08-19T11:45:00+00:00", now)).toBe("15m ago");
    expect(relativeTime("2026-08-19T09:00:00+00:00", now)).toBe("3h ago");
    expect(relativeTime("2026-08-17T12:00:00+00:00", now)).toBe("2d ago");
  });

  it("switches to a date once a week has passed", () => {
    expect(relativeTime("2026-07-04T12:00:00+00:00", now)).toBe("Jul 4");
  });

  it("does not invent a future", () => {
    // Clock skew between the database and the server should read as "just now",
    // never as "-3m ago".
    expect(relativeTime("2026-08-19T12:00:30+00:00", now)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/dashboard/activity.test.ts`
Expected: FAIL — cannot resolve `./activity`.

- [ ] **Step 3: Write the module**

Create `lib/dashboard/activity.ts`:

```ts
/**
 * The activity feed.
 *
 * There is no event log in this schema, so the feed is six timestamp columns
 * read newest-first and merged here: entries.submitted_at,
 * participants.created_at, coaches.created_at, schools.paper_answered_at,
 * schools.submission_locked_at and school_papers.updated_at.
 *
 * INVARIANT: fetch each source with the same limit you pass here. Six lists each
 * truncated at n merge to the true newest n, because anything a source dropped is
 * older than that source's own nth row. Ask for 50 while fetching 8 apiece and
 * the tail of the feed is wrong in a way nothing will flag.
 */
export type ActivityKind =
  | "entry"
  | "participant"
  | "coach"
  | "paper-answer"
  | "submission-lock"
  | "paper-update";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  title: string;
  meta: string | null;
  href: string | null;
}

const MONTH_DAY = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  // Pinned rather than left to the host: the division is in Manila, and an
  // unpinned formatter would render a different day depending on where the
  // server runs — which would also make the test for this flaky.
  timeZone: "Asia/Manila",
});

export function mergeActivity(sources: ActivityItem[][], limit: number): ActivityItem[] {
  return sources
    .flat()
    // Compared as instants: a lexicographic sort happens to agree with the format
    // Postgres returns today, and stops agreeing the moment an offset differs.
    .map((item) => ({ item, at: Date.parse(item.at) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => b.at - a.at || a.item.id.localeCompare(b.item.id, "en"))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}

/**
 * "3h ago" for the last week, a date beyond it. `now` is injected so this stays
 * pure and testable; the caller passes `new Date()`. These pages are dynamic —
 * they read cookies through the Supabase client — so every request re-renders and
 * the labels are current on arrival.
 */
export function relativeTime(at: string, now: Date): string {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return "";

  // Never render a negative age: a little clock skew between the database and the
  // server is normal and "-3m ago" is not a thing.
  const seconds = Math.max(0, (now.getTime() - then) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return MONTH_DAY.format(new Date(then));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/dashboard/activity.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/activity.ts lib/dashboard/activity.test.ts
git commit -m "feat(dashboard): merge six timestamp columns into one activity feed"
```

### Task 13: Competition timeline and status pill

The comp shows a five-step competition pipeline and a COMPETITION STATUS pill. Only step one is derivable from this database, and the pill's phase is the same fact — so **one function produces both**, and they cannot drift apart.

Read the spec's §5.6 note before starting. There is **no division-wide lock flag**. Migration `0010_drop_submissions_lock.sql` dropped the `app_settings` table and its `submissions_locked` column on 2026-08-14, replacing it with the per-school `schools.submission_locked_at` timestamp. Whether 0010 reached production is unknown — `0015_restore_coach_name_parts.sql` documents how a partial migration run left this database in a state its migration files did not describe — and it makes no difference: nothing has written that column since it was retired, so any surviving value is stale. **Do not query `app_settings`.** A query against a dropped relation fails the whole request, which is precisely how the coach-name damage surfaced to users as "Could not load entries".

Aggregating per-school locks has one trap, and the tests below pin it. A school can lock with zero entries — 3 schools are locked today and none of them holds an entry — so `schoolsLocked >= schoolsWithEntries` can be true while an active school is still accepting work. Comparing counts is therefore wrong. The signal is a direct one: **is any school that holds an entry still unlocked?**

**Files:**
- Create: `lib/dashboard/timeline.ts`
- Test: `lib/dashboard/timeline.test.ts`

**Interfaces:**
- Consumes: nothing. Pure module, numbers in.
- Produces:
  ```ts
  export type TimelineState = "completed" | "in-progress" | "unavailable";
  export type TimelineKey =
    | "registration"
    | "judging-1"
    | "judging-2"
    | "tabulation"
    | "results";
  export interface TimelineStep {
    key: TimelineKey;
    label: string;
    state: TimelineState;
    /** Display text for the state chip: "COMPLETED", "IN PROGRESS", "Not yet available". */
    stateLabel: string;
    detail: string;
  }
  export interface TimelineInput {
    /** Schools with `submission_locked_at` not null. */
    schoolsLocked: number;
    /** Schools holding at least one entry whose `submission_locked_at` is null. */
    schoolsOpenWithEntries: number;
    /** Total rows in `entries`. */
    entries: number;
  }
  export interface Timeline {
    steps: TimelineStep[];
    registrationClosed: boolean;
    /** The COMPETITION STATUS pill label. */
    statusPill: string;
  }
  export function buildTimeline(input: TimelineInput): Timeline;
  ```
- **Fetch note for Task 15.** Both school counts come off the query that already feeds the per-school rollup: add `submission_locked_at` to that `schools` select and derive the two numbers before calling `summarisePerSchool`. Do **not** add a field to `SchoolRollupRow` — that interface describes the table's columns, and the lock is not one of them. Do not issue a second round trip for this.

- [ ] **Step 1: Write the failing test**

Create `lib/dashboard/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildTimeline, type TimelineInput } from "./timeline";

function input(overrides: Partial<TimelineInput> = {}): TimelineInput {
  return { schoolsLocked: 0, schoolsOpenWithEntries: 0, entries: 0, ...overrides };
}

describe("buildTimeline", () => {
  it("returns the comp's five steps in a fixed order", () => {
    const { steps } = buildTimeline(input());
    expect(steps.map((s) => s.key)).toEqual([
      "registration",
      "judging-1",
      "judging-2",
      "tabulation",
      "results",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Registration",
      "Judging Round 1",
      "Judging Round 2",
      "Tabulation",
      "Final Results",
    ]);
  });

  it("keeps registration in progress while nothing is locked", () => {
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 0, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(steps[0].stateLabel).toBe("IN PROGRESS");
    expect(registrationClosed).toBe(false);
    expect(statusPill).toBe("Registration Open");
  });

  it("keeps registration in progress while any school holding an entry is unlocked", () => {
    const { steps, registrationClosed } = buildTimeline(
      input({ schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
  });

  // The trap: locked schools can outnumber active ones because a school may lock
  // with zero entries. A count comparison would call this closed. It is not.
  it("does not close registration just because locked outnumbers active", () => {
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 20, schoolsOpenWithEntries: 3, entries: 41 }),
    );
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
    expect(statusPill).toBe("Registration Open");
  });

  it("closes registration once no school holding an entry is unlocked", () => {
    const { steps, registrationClosed, statusPill } = buildTimeline(
      input({ schoolsLocked: 16, schoolsOpenWithEntries: 0, entries: 41 }),
    );
    expect(steps[0].state).toBe("completed");
    expect(steps[0].stateLabel).toBe("COMPLETED");
    expect(registrationClosed).toBe(true);
    expect(statusPill).toBe("Registration Closed");
  });

  // An empty database has nothing locked and nothing open. That is the start of
  // registration, not the end of it.
  it("treats a database with no locks at all as open", () => {
    const { steps, registrationClosed } = buildTimeline(input());
    expect(steps[0].state).toBe("in-progress");
    expect(registrationClosed).toBe(false);
  });

  it("reports locked schools and submitted entries in the registration detail", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 3, schoolsOpenWithEntries: 16, entries: 41 }),
    );
    expect(steps[0].detail).toBe("3 schools locked · 41 entries submitted");
  });

  it("uses singular nouns for counts of one", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 1, schoolsOpenWithEntries: 2, entries: 1 }),
    );
    expect(steps[0].detail).toBe("1 school locked · 1 entry submitted");
  });

  it("uses plural nouns for zero", () => {
    const { steps } = buildTimeline(input());
    expect(steps[0].detail).toBe("0 schools locked · 0 entries submitted");
  });

  it("marks the four later steps unavailable, never pending", () => {
    const { steps } = buildTimeline(
      input({ schoolsLocked: 16, schoolsOpenWithEntries: 0, entries: 41 }),
    );
    for (const step of steps.slice(1)) {
      expect(step.state).toBe("unavailable");
      expect(step.stateLabel).toBe("Not yet available");
    }
    expect(steps.map((s) => s.stateLabel)).not.toContain("PENDING");
  });

  it("says what each unavailable step is waiting for", () => {
    const { steps } = buildTimeline(input());
    for (const step of steps) {
      expect(step.detail.length).toBeGreaterThan(0);
    }
    expect(steps[1].detail).toContain("judge accounts");
    expect(steps[3].detail).toContain("scores");
  });

  // Closing registration must not imply the pipeline behind it has started.
  it("leaves the later steps unavailable regardless of registration state", () => {
    const open = buildTimeline(input({ schoolsOpenWithEntries: 16, entries: 41 }));
    const closed = buildTimeline(input({ schoolsLocked: 16, entries: 41 }));
    expect(open.steps.slice(1)).toEqual(closed.steps.slice(1));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npx vitest run lib/dashboard/timeline.test.ts
```

Expected: FAIL — `Failed to resolve import "./timeline"`.

- [ ] **Step 3: Write the implementation**

Create `lib/dashboard/timeline.ts`:

```ts
export type TimelineState = "completed" | "in-progress" | "unavailable";

export type TimelineKey =
  | "registration"
  | "judging-1"
  | "judging-2"
  | "tabulation"
  | "results";

export interface TimelineStep {
  key: TimelineKey;
  label: string;
  state: TimelineState;
  /** Display text for the state chip: "COMPLETED", "IN PROGRESS", "Not yet available". */
  stateLabel: string;
  detail: string;
}

export interface TimelineInput {
  /** Schools with `submission_locked_at` not null. */
  schoolsLocked: number;
  /** Schools holding at least one entry whose `submission_locked_at` is null. */
  schoolsOpenWithEntries: number;
  /** Total rows in `entries`. */
  entries: number;
}

export interface Timeline {
  steps: TimelineStep[];
  registrationClosed: boolean;
  /** The COMPETITION STATUS pill label. */
  statusPill: string;
}

/**
 * The four steps after registration. Each is rendered in the comp's position and
 * says what it is waiting for, rather than showing a `PENDING` chip that would
 * imply a judging pipeline exists. Nothing in this database scores an entry.
 */
const PENDING_STEPS: { key: TimelineKey; label: string; detail: string }[] = [
  {
    key: "judging-1",
    label: "Judging Round 1",
    detail: "Needs judge accounts and a scoring schema per event type.",
  },
  {
    key: "judging-2",
    label: "Judging Round 2",
    detail: "Opens once Round 1 scores are recorded.",
  },
  {
    key: "tabulation",
    label: "Tabulation",
    detail: "Needs Round 1 and Round 2 scores before it can rank anything.",
  },
  {
    key: "results",
    label: "Final Results",
    detail: "Publishes after tabulation is reviewed and certified.",
  },
];

const UNAVAILABLE_LABEL = "Not yet available";

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function buildTimeline(input: TimelineInput): Timeline {
  // Registration is closed only when locking has actually happened AND no school
  // holding an entry is still open. Comparing `schoolsLocked` against the number
  // of active schools would be wrong: a school can lock with zero entries, so
  // locked can exceed active while active schools are still submitting.
  const registrationClosed =
    input.schoolsLocked > 0 && input.schoolsOpenWithEntries === 0;

  const registration: TimelineStep = {
    key: "registration",
    label: "Registration",
    state: registrationClosed ? "completed" : "in-progress",
    stateLabel: registrationClosed ? "COMPLETED" : "IN PROGRESS",
    detail: `${count(input.schoolsLocked, "school", "schools")} locked · ${count(
      input.entries,
      "entry",
      "entries",
    )} submitted`,
  };

  return {
    steps: [
      registration,
      ...PENDING_STEPS.map((step) => ({
        ...step,
        state: "unavailable" as const,
        stateLabel: UNAVAILABLE_LABEL,
      })),
    ],
    registrationClosed,
    statusPill: registrationClosed ? "Registration Closed" : "Registration Open",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
npx vitest run lib/dashboard/timeline.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Confirm nothing in the tree reads the dropped table**

```powershell
npx tsc --noEmit
Select-String -Path lib,app,components -Include *.ts,*.tsx -Pattern "app_settings|submissions_locked" -Recurse
```

Expected: `tsc` clean, and the search returns **nothing**. A hit means some earlier task reintroduced a query against the relation migration `0010` dropped; fix it there before continuing.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/timeline.ts lib/dashboard/timeline.test.ts
git commit -m "feat(dashboard): derive the competition timeline from per-school locks"
```

---

### Task 14: Dashboard panel components

Seven presentational components, one per panel in the comp. Every one is a pure function of props supplied by Tasks 7–13 — no component fetches, computes a total, or decides a label. If you find yourself writing arithmetic in this task, the arithmetic belongs in one of those modules instead.

**There are no unit tests in this task, and that is deliberate.** This repo's vitest suite covers pure modules under `lib/` only; there is no React testing library installed and this plan does not add one. Everything worth asserting about these panels — ranking, totals, share arithmetic, slice folding, arc geometry, relative time, timeline state — is already pinned by the tests in Tasks 7–13. The gate here is `tsc --noEmit`, `npm run lint`, and Step 8's browser pass.

**Two rules from the `dataviz` method that this task must not quietly break:**

1. **Text wears text tokens, never the series colour.** Labels, counts and shares stay in `text-foreground` / `text-muted-foreground`. The colour lives in the swatch and the arc. Coloured text on a sub-3:1 slice colour would be unreadable on the light surface.
2. **The legend is always present, and it is also the table view.** It prints every slice's name, exact count and share. That is what discharges the contrast `relief` obligation recorded in Task 1 Step 4 for magenta, yellow and aqua on the light surface — three slice colours sit below 3:1 there, so the value must never be carried by colour alone. Do not "simplify" the legend into swatches-and-names.

**Recorded departure from the `dataviz` guidance.** That method caps an at-a-glance part-to-whole chart at **six** segments; this donut renders up to **nine** (eight event types plus Other), which is the scope decision taken during brainstorming. The mitigation is that the legend carries exact counts and shares, so close values are compared there rather than by eye on the ring, and the fixed slot order means a filter never repaints a surviving slice. `topN` stays a call-site argument in Task 9, so lowering it is a one-number change in `app/admin/(shell)/page.tsx` if the ring turns out to read poorly with real data.

**Files:**
- Create: `components\dashboard\KpiTile.tsx`
- Create: `components\dashboard\PerSchoolTable.tsx`
- Create: `components\dashboard\EventDonut.tsx`
- Create: `components\dashboard\AttentionList.tsx`
- Create: `components\dashboard\ActivityFeed.tsx`
- Create: `components\dashboard\SubmissionTimeline.tsx`
- Create: `components\dashboard\PortalCard.tsx`

**Interfaces:**
- Consumes: `Kpi`, `KpiKey` (Task 7); `PerSchoolSummary` (Task 8); `PerEventSummary` (Task 9); `donutGeometry` (Task 10); `AttentionItem` (Task 11); `ActivityItem`, `ActivityKind`, `relativeTime` (Task 12); `Timeline` (Task 13). UI primitives from `@/components/ui/{card,table,badge,button,separator}` and `cn` from `@/lib/utils` — all already in the repo.
- Produces:
  ```ts
  export function KpiTile(props: { kpi: Kpi }): React.JSX.Element;
  export function PerSchoolTable(props: { summary: PerSchoolSummary }): React.JSX.Element;
  export function EventDonut(props: { summary: PerEventSummary }): React.JSX.Element;   // client
  export function AttentionList(props: { items: AttentionItem[] }): React.JSX.Element;
  export function ActivityFeed(props: { items: ActivityItem[]; now: Date }): React.JSX.Element;
  export function SubmissionTimeline(props: { timeline: Timeline }): React.JSX.Element;
  export interface PortalAction { label: string; href: string; external?: boolean }
  export function PortalCard(props: {
    title: string;
    description: string;
    soon?: boolean;
    control?: React.ReactNode;
    actions?: PortalAction[];
    requires?: string[];
  }): React.JSX.Element;
  ```
- **`ActivityFeed` takes `now` as a prop rather than calling `new Date()` itself.** The page passes one `now` to every panel, so two rows rendered a millisecond apart cannot disagree about what "2 minutes ago" means, and the value is fixed for the whole response.

- [ ] **Step 1: Create the KPI tile**

Create `components\dashboard\KpiTile.tsx`:

```tsx
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
```

- [ ] **Step 2: Create the per-school table**

Create `components\dashboard\PerSchoolTable.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

export function PerSchoolTable({ summary }: { summary: PerSchoolSummary }) {
  if (summary.rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No school has an entry yet. Rows appear here as schools submit.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead>District</TableHead>
              <TableHead className="text-right">Learners</TableHead>
              <TableHead className="text-right">Coaches</TableHead>
              <TableHead className="text-right">Entries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.rows.map((row) => (
              <TableRow key={row.schoolId}>
                <TableCell className="font-medium text-foreground">
                  {row.schoolName}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.districtName || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.learners}</TableCell>
                <TableCell className="text-right tabular-nums">{row.coaches}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {row.entries}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            {/* Division-wide, not a sum of the visible rows — Task 8 totals every
                active school, including the ones the top-N cut off. */}
            <TableRow>
              <TableCell className="font-semibold text-foreground">
                Division total
              </TableCell>
              <TableCell className="text-muted-foreground">
                {summary.activeSchools} of {summary.registeredSchools} schools
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {summary.totals.learners}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {summary.totals.coaches}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {summary.totals.entries}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {summary.hiddenSchools > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing the top {summary.rows.length} by entries.{" "}
          {summary.hiddenSchools} more active{" "}
          {summary.hiddenSchools === 1 ? "school is" : "schools are"} counted in the
          division total but not listed.
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Create the event donut**

This is the only client component in the task; it owns the hover highlight. The ring and the legend cross-highlight, so pointing at either one lights up both.

Create `components\dashboard\EventDonut.tsx`:

```tsx
"use client";

import { useState } from "react";

import { donutGeometry } from "@/lib/dashboard/donut";
import type { PerEventSummary } from "@/lib/dashboard/per-event";

const SIZE = 220;
const THICKNESS = 26;

const SHARE = new Intl.NumberFormat("en-PH", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function EventDonut({ summary }: { summary: PerEventSummary }) {
  const [active, setActive] = useState<string | null>(null);

  if (summary.totalEntries === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No entries yet, so there is nothing to break down by event type.
      </p>
    );
  }

  const geometry = donutGeometry(
    summary.slices.map((slice) => ({
      key: slice.key,
      value: slice.entries,
      colorVar: slice.colorVar,
    })),
    { size: SIZE, thickness: THICKNESS },
  );

  return (
    <div
      className="flex flex-col items-center gap-6 lg:flex-row lg:items-start"
      onMouseLeave={() => setActive(null)}
    >
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Entries by event type: ${summary.totalEntries} entries across ${summary.typesWithEntries} event types. The table beside this chart lists every value.`}
        >
          {/* -90° puts the first slice at twelve o'clock. */}
          <g transform={`rotate(-90 ${geometry.center} ${geometry.center})`}>
            {/* Track, so the ring still reads as a ring when one slice holds
                everything and there is no gap to reveal the surface. */}
            <circle
              cx={geometry.center}
              cy={geometry.center}
              r={geometry.radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth={geometry.thickness}
            />
            {geometry.segments.map((segment) => (
              <circle
                key={segment.key}
                cx={geometry.center}
                cy={geometry.center}
                r={geometry.radius}
                fill="none"
                stroke={`var(${segment.colorVar})`}
                strokeWidth={geometry.thickness}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                opacity={active === null || active === segment.key ? 1 : 0.35}
                className="transition-opacity duration-150"
                onMouseEnter={() => setActive(segment.key)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl leading-none font-semibold text-foreground">
            {summary.totalEntries.toLocaleString("en-PH")}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">total entries</span>
        </div>
      </div>

      {/* Legend and table view in one: every slice, its exact count, its share. */}
      <div className="min-w-0 flex-1 space-y-2">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Entries by event type, with counts and shares.
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="py-1.5 text-left font-medium">
                Event type
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Entries
              </th>
              <th scope="col" className="py-1.5 text-right font-medium">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.slices.map((slice) => (
              <tr
                key={slice.key}
                onMouseEnter={() => setActive(slice.key)}
                className={active === slice.key ? "bg-muted/60" : undefined}
              >
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: `var(${slice.colorVar})` }}
                    />
                    <span className="text-foreground">{slice.label}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-foreground">
                  {slice.entries.toLocaleString("en-PH")}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {SHARE.format(slice.share)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          {summary.typesWithEntries} of {summary.typesTotal} event types have an entry.
          {summary.otherTypes > 0
            ? ` "Other" groups the ${summary.otherTypes} types with the fewest entries.`
            : ""}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the attention list**

Every row's count must equal the number of rows on the page its link opens — that coupling is why Task 11 exists. A row whose `href` is `null` renders as plain text rather than a link to a route that does not exist yet.

Create `components\dashboard\AttentionList.tsx`:

```tsx
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/dashboard/attention";

function Row({ item }: { item: AttentionItem }) {
  return (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums",
          item.tone === "warn"
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary",
        )}
      >
        {item.count}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{item.label}</span>
        <span className="block text-xs text-muted-foreground">{item.detail}</span>
      </span>
    </>
  );
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nothing needs attention right now.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.key}>
          {item.href ? (
            <Link
              href={item.href}
              className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/50"
            >
              <Row item={item} />
              <ArrowRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          ) : (
            <div className="flex items-center gap-3 py-2.5">
              <Row item={item} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Create the activity feed**

Create `components\dashboard\ActivityFeed.tsx`:

```tsx
import { FileText, FilePen, Lock, MessageSquare, UserRound, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { relativeTime, type ActivityItem, type ActivityKind } from "@/lib/dashboard/activity";

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  entry: FileText,
  participant: Users,
  coach: UserRound,
  "paper-answer": MessageSquare,
  "submission-lock": Lock,
  "paper-update": FilePen,
};

export function ActivityFeed({ items, now }: { items: ActivityItem[]; now: Date }) {
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind];
        const body = (
          <>
            <span
              aria-hidden
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{item.title}</span>
              <span className="block text-xs text-muted-foreground">
                {item.meta ? `${item.meta} · ` : ""}
                {relativeTime(item.at, now)}
              </span>
            </span>
          </>
        );

        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                className="flex items-start gap-3 rounded-lg transition-colors hover:bg-muted/50"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 6: Create the submission timeline**

Create `components\dashboard\SubmissionTimeline.tsx`:

```tsx
import { Check, Circle, CircleDot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Timeline, TimelineState } from "@/lib/dashboard/timeline";

const STATE_ICON: Record<TimelineState, LucideIcon> = {
  completed: Check,
  "in-progress": CircleDot,
  unavailable: Circle,
};

const STATE_CHIP: Record<TimelineState, string> = {
  completed: "bg-primary/10 text-primary",
  "in-progress": "bg-primary text-primary-foreground",
  unavailable: "bg-muted text-muted-foreground",
};

export function SubmissionTimeline({ timeline }: { timeline: Timeline }) {
  return (
    <ol className="space-y-0">
      {timeline.steps.map((step, index) => {
        const Icon = STATE_ICON[step.state];
        const last = index === timeline.steps.length - 1;

        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full",
                  step.state === "unavailable"
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {last ? null : <span className="w-px flex-1 bg-border" />}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    step.state === "unavailable"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase",
                    STATE_CHIP[step.state],
                  )}
                >
                  {step.stateLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 7: Create the portal card**

Create `components\dashboard\PortalCard.tsx`:

```tsx
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
```

- [ ] **Step 8: Type-check and lint**

```powershell
npx tsc --noEmit
npm run lint
```

Expected: both clean. Two failures are likely here and both are quick:

- **An icon name does not resolve.** `lucide-react` is on v1 in this repo; if any of `Award`, `Circle`, `CircleDot`, `Check`, `FilePen`, `FileText`, `Lock`, `Map`, `MessageSquare`, `School`, `UserRound`, `Users`, `ArrowRight` is missing, open `node_modules/lucide-react/dist/lucide-react.d.ts` and substitute the closest exported name. Do not delete the icon and leave the slot empty.
- **`react/no-unescaped-entities` on the donut footnote.** The `"Other"` quotes sit inside a template literal in a JS expression, not in JSX text, so this should not fire — if it does, switch the straight quotes to `&ldquo;`/`&rdquo;`.

Nothing in these files renders yet; the panels go on the page in Task 15.

- [ ] **Step 9: Commit**

```bash
git add components/dashboard
git commit -m "feat(dashboard): add the seven dashboard panel components"
```

---

### Task 15: The dashboard overview page and its read-only fetch layer

This is the task the whole plan has been building toward. Every derivation is already
written and unit-tested (Tasks 7-13) and every panel is already written (Task 14); this
task fetches production data, feeds it in, and lays the result out.

**Files:**
- Create: `app/admin/(shell)/dashboard-data.ts`
- Create: `components/dashboard/RegistrationPortalCard.tsx`
- Create: `components/admin/shell/AttentionBell.tsx`
- Create: `components/admin/shell/UserChip.tsx`
- Modify: `app/admin/(shell)/page.tsx` — the Task 4 redirect is replaced in full
- Modify: `app/admin/(shell)/layout.tsx` — fills `Topbar`'s `actions` slot
- Test: none new. Every number on this page comes out of a function that already has a
  test file; a test of the fetch layer would be a test of Supabase. The gate here is
  `npx tsc --noEmit`, `npm run lint`, and Step 8's read of the live page.

**Interfaces:**
- Consumes: `buildKpis` and `Kpi` from `@/lib/dashboard/kpis` (Task 7);
  `summarisePerSchool`, `SchoolRollupRow`, `PerSchoolSummary` from
  `@/lib/dashboard/per-school` (Task 8); `summarisePerEvent`, `EventTypeCount`,
  `PerEventSummary` from `@/lib/dashboard/per-event` (Task 9); `buildAttention`,
  `attentionBadge`, `AttentionInput`, `AttentionItem` from `@/lib/dashboard/attention`
  (Task 11); `mergeActivity`, `ActivityItem` from `@/lib/dashboard/activity` (Task 12);
  `buildTimeline`, `Timeline` from `@/lib/dashboard/timeline` (Task 13); the seven panels
  from `@/components/dashboard/*` (Task 14); `PageHeading` from
  `@/components/admin/shell/PageHeading` and `Topbar` from
  `@/components/admin/shell/Topbar` (Task 3); `requireAdmin` from `@/app/admin/guard`;
  `paperStatus` from `@/lib/paper/status`; `PaperParticipation` from `@/lib/paper/gate`;
  `LANGUAGE_LABEL`, `EventLevel`, `EventLanguage` from `@/lib/events-catalog`;
  `surnameFirst` from `@/lib/roster/names`; `formatParticipantNumber` from
  `@/lib/roster/limits`; `ANY` from `@/components/admin/filter-select`.
- Produces:
  ```ts
  // app/admin/(shell)/dashboard-data.ts
  export interface EventOption { id: string; label: string }
  export interface EventOptionGroup { typeId: string; typeName: string; options: EventOption[] }
  export interface ShellFacts { adminName: string; attentionBadge: number }
  export interface DashboardData {
    now: Date;
    adminName: string;
    kpis: Kpi[];
    perSchool: PerSchoolSummary;
    perEvent: PerEventSummary;
    attention: AttentionItem[];
    activity: ActivityItem[];
    timeline: Timeline;
    eventGroups: EventOptionGroup[];
  }
  // `getAdminClient`'s return type is inferred, not annotated — it is the Supabase
  // server client. Task 17 gives that type a name (`SupabaseServerClient`, exported
  // from `@/lib/supabase/server`) at the point where a signature first needs to spell
  // it out. Nothing in this task needs the name.
  export const getAdminClient: () => Promise<ReturnType<typeof createServerClient>>;
  export const loadShellFacts: () => Promise<ShellFacts>;
  export const loadDashboardData: () => Promise<DashboardData>;

  // components
  export function AttentionBell(props: { count: number }): React.JSX.Element;   // client
  export function UserChip(props: { name: string }): React.JSX.Element;
  export function RegistrationPortalCard(props: { groups: EventOptionGroup[] }): React.JSX.Element;   // client
  ```

**Three decisions a reviewer will want justified up front.**

1. **The guard lives in `getAdminClient()`, not in a bare `requireAdmin()` call at the
   top of the page.** Every other admin page opens with `const { supabase } = await
   requireAdmin()`. This page does not call Supabase directly at all — it calls
   `loadDashboardData()`, whose first await is `getAdminClient()`, which *is*
   `requireAdmin()`. The guard still runs before a single row is read and before
   anything renders. It is written this way because the shell's topbar needs the same
   session, and `cache()` around a **no-argument** function is what makes one guard
   check and one client serve both. Passing the client in as a parameter would defeat
   `cache()`: the layout and the page each build their own client, so the arguments
   would differ and nothing would be shared.
2. **The topbar's bell and user chip are fed by the layout, not by themselves.** Both are
   presentational and take props. The layout wraps one small async component around
   `loadShellFacts()` in `<Suspense>`, so the shell streams immediately and the badge
   arrives when it arrives. On `/admin` that fetch costs nothing extra: `cache()` has
   already resolved the same loaders for the page.
3. **All 332 schools are fetched and filtered in JavaScript.** PostgREST cannot filter or
   order on an embedded aggregate, so `participants(count) > 0` is not expressible as a
   query. One request for 332 narrow rows is cheaper than the alternatives and is the
   same shape the existing `/admin` page already uses for its paper tally.

- [ ] **Step 1: Write the fetch layer**

Create `app/admin/(shell)/dashboard-data.ts`:

```ts
import { cache } from "react";

import { requireAdmin } from "@/app/admin/guard";
import { mergeActivity, type ActivityItem } from "@/lib/dashboard/activity";
import {
  attentionBadge,
  buildAttention,
  type AttentionInput,
  type AttentionItem,
} from "@/lib/dashboard/attention";
import { buildKpis, type Kpi } from "@/lib/dashboard/kpis";
import {
  summarisePerEvent,
  type EventTypeCount,
  type PerEventSummary,
} from "@/lib/dashboard/per-event";
import {
  summarisePerSchool,
  type PerSchoolSummary,
  type SchoolRollupRow,
} from "@/lib/dashboard/per-school";
import { buildTimeline, type Timeline } from "@/lib/dashboard/timeline";
import {
  LANGUAGE_LABEL,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { paperStatus } from "@/lib/paper/status";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";

/** Rows on screen in the Per School Summary panel. The totals row still sums all of them. */
const PER_SCHOOL_LIMIT = 15;
/** Donut slices before the rest folds into "Other". */
const DONUT_TOP_N = 8;
/** Rows pulled from each activity source. Six sources, then merged and cut to ACTIVITY_SHOWN. */
const ACTIVITY_FETCH_LIMIT = 8;
/** Rows the feed shows. */
const ACTIVITY_SHOWN = 5;

/**
 * `lib/events-catalog.ts` exports `levelTag()` — "elem" / "sec", for building event
 * codes — but no prose label, so this file owns one. It is not exported: the catalog
 * stays the single source of truth for event data, and this is presentation.
 */
const LEVEL_LABEL: Record<EventLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

export interface EventOption {
  id: string;
  label: string;
}

export interface EventOptionGroup {
  typeId: string;
  typeName: string;
  options: EventOption[];
}

export interface ShellFacts {
  adminName: string;
  attentionBadge: number;
}

export interface DashboardData {
  /** One instant for the whole response, so no two panels disagree about "now". */
  now: Date;
  adminName: string;
  kpis: Kpi[];
  perSchool: PerSchoolSummary;
  perEvent: PerEventSummary;
  attention: AttentionItem[];
  activity: ActivityItem[];
  timeline: Timeline;
  eventGroups: EventOptionGroup[];
}

/**
 * The request's admin-guarded Supabase client.
 *
 * cache() is doing real work here: the dashboard page and the shell's topbar both need
 * this, and without it each would run its own auth round trip and its own
 * admin_profiles lookup. No arguments is deliberate — cache() keys on arguments, and a
 * client passed in as a parameter would be a different object in each caller.
 *
 * requireAdmin() redirects a non-admin to /admin/login, so every loader below is
 * unreachable without an admin session. RLS is still the thing that actually protects
 * the rows; this is the redirect, not the wall.
 */
export const getAdminClient = cache(async () => (await requireAdmin()).supabase);

/**
 * The signed-in admin's name for the topbar chip.
 *
 * No `.eq("user_id", …)`: the "self read admin_profiles" policy already restricts this
 * table to `user_id = auth.uid()`, so an unfiltered select returns exactly the caller's
 * own row. Skipping the filter also skips fetching the user id to filter by.
 */
export const loadAdminName = cache(async (): Promise<string> => {
  const supabase = await getAdminClient();
  const { data } = await supabase
    .from("admin_profiles")
    .select("full_name")
    .limit(1)
    .maybeSingle()
    .overrideTypes<{ full_name: string | null }>();

  return data?.full_name?.trim() || "Division Admin";
});

interface SchoolFactRow {
  id: string;
  name: string;
  district_id: string | null;
  paper_participation: PaperParticipation;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
  school_papers: { count: number }[];
}

interface SchoolFacts {
  /** Every school with at least one participant, coach or entry, ranked by the panel. */
  active: SchoolRollupRow[];
  registeredSchools: number;
  schoolsWithEntries: number;
  districtsRegistered: number;
  districtsWithEntries: number;
  schoolsLocked: number;
  schoolsOpenWithEntries: number;
  schoolsPaperNotStarted: number;
  schoolsWithLearnersButNoEntry: number;
}

/**
 * One query, nine facts. Each `(count)` is an embedded aggregate, which PostgREST
 * returns as a one-element array — the same shape `/admin` already unwraps for its
 * `school_papers(count)`.
 */
export const loadSchoolFacts = cache(async (): Promise<SchoolFacts> => {
  const supabase = await getAdminClient();
  const { data } = await supabase
    .from("schools")
    .select(
      "id, name, district_id, paper_participation, submission_locked_at, districts(name), participants(count), coaches(count), entries(count), school_papers(count)"
    )
    .order("name")
    .overrideTypes<SchoolFactRow[]>();

  const rows = (data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    paperCount: row.school_papers?.[0]?.count ?? 0,
    participation: row.paper_participation,
    lockedAt: row.submission_locked_at,
  }));

  const withEntries = rows.filter((row) => row.entries > 0);

  return {
    active: rows
      .filter((row) => row.learners > 0 || row.coaches > 0 || row.entries > 0)
      .map(({ schoolId, schoolName, districtName, learners, coaches, entries }) => ({
        schoolId,
        schoolName,
        districtName,
        learners,
        coaches,
        entries,
      })),
    registeredSchools: rows.length,
    schoolsWithEntries: withEntries.length,
    // A school with no district still counts as registered, so the id is only
    // deduplicated where it exists.
    districtsRegistered: new Set(rows.map((row) => row.districtId).filter(Boolean)).size,
    districtsWithEntries: new Set(withEntries.map((row) => row.districtId).filter(Boolean))
      .size,
    schoolsLocked: rows.filter((row) => row.lockedAt !== null).length,
    // The number buildTimeline() needs: a school still holding the door open on real
    // work. A locked school with no entries does not keep registration open, and an
    // unlocked school with no entries has nothing to submit.
    schoolsOpenWithEntries: rows.filter((row) => row.entries > 0 && row.lockedAt === null)
      .length,
    schoolsPaperNotStarted: rows.filter(
      (row) =>
        paperStatus({
          participation: row.participation,
          paperCount: row.paperCount,
          lockedAt: row.lockedAt,
        }) === "incomplete"
    ).length,
    schoolsWithLearnersButNoEntry: rows.filter((row) => row.learners > 0 && row.entries === 0)
      .length,
  };
});

interface RosterFacts {
  participants: number;
  participantsWithoutEntry: number;
  coaches: number;
  coachesWithoutEntry: number;
}

/**
 * "Without an entry" is a set difference, not a count: the link tables say who *is* in
 * an entry, so the answer is the roster total minus the distinct linked ids. Both link
 * tables are a few hundred rows, and both id columns are NOT NULL since migration 0004.
 */
export const loadRosterFacts = cache(async (): Promise<RosterFacts> => {
  const supabase = await getAdminClient();
  const [
    { count: participants },
    { data: participantLinks },
    { count: coaches },
    { data: coachLinks },
  ] = await Promise.all([
    supabase.from("participants").select("*", { count: "exact", head: true }),
    supabase
      .from("entry_participants")
      .select("participant_id")
      .overrideTypes<{ participant_id: string }[]>(),
    supabase.from("coaches").select("*", { count: "exact", head: true }),
    supabase.from("entry_coaches").select("coach_id").overrideTypes<{ coach_id: string }[]>(),
  ]);

  const participantsTotal = participants ?? 0;
  const coachesTotal = coaches ?? 0;
  const enteredParticipants = new Set((participantLinks ?? []).map((l) => l.participant_id));
  const enteredCoaches = new Set((coachLinks ?? []).map((l) => l.coach_id));

  return {
    participants: participantsTotal,
    // Clamped at zero: a link row surviving a deleted roster row would otherwise
    // produce a negative count on a KPI tile.
    participantsWithoutEntry: Math.max(0, participantsTotal - enteredParticipants.size),
    coaches: coachesTotal,
    coachesWithoutEntry: Math.max(0, coachesTotal - enteredCoaches.size),
  };
});

/**
 * The four counts behind the attention list and the topbar badge.
 *
 * It reads no rows of its own — both loaders it calls are cached, so on the dashboard
 * this is pure arithmetic over data the page already fetched.
 */
export const loadAttentionInput = cache(async (): Promise<AttentionInput> => {
  const [schools, roster] = await Promise.all([loadSchoolFacts(), loadRosterFacts()]);

  return {
    learnersWithoutEntry: roster.participantsWithoutEntry,
    schoolsWithLearnersButNoEntry: schools.schoolsWithLearnersButNoEntry,
    coachesWithoutEntry: roster.coachesWithoutEntry,
    schoolsPaperNotStarted: schools.schoolsPaperNotStarted,
  };
});

/** What the shell's topbar needs on every admin page. */
export const loadShellFacts = cache(async (): Promise<ShellFacts> => {
  const [adminName, attention] = await Promise.all([loadAdminName(), loadAttentionInput()]);

  return { adminName, attentionBadge: attentionBadge(buildAttention(attention)) };
});
```

- [ ] **Step 2: Finish the fetch layer — entries, events and the activity feed**

Still in `app/admin/(shell)/dashboard-data.ts`, below what you just wrote:

```ts
interface EntryFactRow {
  id: string;
  events: { category: "individual" | "group"; event_type_id: string } | null;
}

interface EntryFacts {
  entries: number;
  entriesIndividual: number;
  entriesGroup: number;
  /** event_type_id -> entry count. The donut's raw material. */
  byType: Map<string, number>;
}

/**
 * One query serving three panels: the Total Entries tile, its individual/group subtitle,
 * and every donut slice.
 *
 * `entries.event_id` is NOT NULL and `events.event_type_id` has been NOT NULL since
 * migration 0003, so `events` is never actually null here. The optional chaining is kept
 * anyway — it costs nothing and it means a row that somehow lacks a type is dropped from
 * the breakdown instead of crashing the page.
 */
export const loadEntryFacts = cache(async (): Promise<EntryFacts> => {
  const supabase = await getAdminClient();
  const { data } = await supabase
    .from("entries")
    .select("id, events(category, event_type_id)")
    .overrideTypes<EntryFactRow[]>();

  const rows = data ?? [];
  const byType = new Map<string, number>();
  for (const row of rows) {
    const typeId = row.events?.event_type_id;
    if (!typeId) continue;
    byType.set(typeId, (byType.get(typeId) ?? 0) + 1);
  }

  return {
    entries: rows.length,
    entriesIndividual: rows.filter((row) => row.events?.category === "individual").length,
    entriesGroup: rows.filter((row) => row.events?.category === "group").length,
    byType,
  };
});

interface EventTypeFactRow {
  id: string;
  name_en: string;
}

interface EventFactRow {
  id: string;
  name: string;
  level: EventLevel;
  language: EventLanguage;
  event_type_id: string;
}

interface EventFacts {
  counts: EventTypeCount[];
  typesTotal: number;
  typesContested: number;
  groups: EventOptionGroup[];
}

/**
 * The event catalog as the dashboard needs it: one count per type for the donut, and the
 * 56 individual events grouped by type for the Registration card's select.
 *
 * The grouping is not cosmetic. `events.name` carries only the event's name — the same
 * string for all four level/language variants of a type — so a flat list would show
 * "Editorial Writing" four times with no way to tell them apart.
 */
export const loadEventFacts = cache(async (): Promise<EventFacts> => {
  const supabase = await getAdminClient();
  const [{ data: types }, { data: events }, entryFacts] = await Promise.all([
    supabase
      .from("event_types")
      .select("id, name_en")
      .order("sort_order")
      .overrideTypes<EventTypeFactRow[]>(),
    supabase
      .from("events")
      .select("id, name, level, language, event_type_id")
      .order("sort_order")
      .overrideTypes<EventFactRow[]>(),
    loadEntryFacts(),
  ]);

  const typeRows = types ?? [];
  const eventRows = events ?? [];

  const counts: EventTypeCount[] = typeRows.map((type) => ({
    typeId: type.id,
    typeName: type.name_en,
    entries: entryFacts.byType.get(type.id) ?? 0,
  }));

  const groups: EventOptionGroup[] = typeRows
    .map((type) => ({
      typeId: type.id,
      typeName: type.name_en,
      options: eventRows
        .filter((event) => event.event_type_id === type.id)
        .map((event) => ({
          id: event.id,
          // The event name repeats inside its own group heading on purpose: Radix
          // renders the selected item's own text in the closed trigger, where
          // "Elementary · English" alone would not say which event was picked.
          label: `${event.name} · ${LEVEL_LABEL[event.level]} · ${LANGUAGE_LABEL[event.language]}`,
        })),
    }))
    // A type with no seeded events would otherwise render an empty group heading.
    .filter((group) => group.options.length > 0);

  return {
    counts,
    typesTotal: typeRows.length,
    typesContested: counts.filter((count) => count.entries > 0).length,
    groups,
  };
});

interface EntryActivityRow {
  id: string;
  submitted_at: string;
  school_id: string;
  schools: { name: string } | null;
  events: { name: string } | null;
}

interface ParticipantActivityRow {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  school_id: string;
  schools: { name: string } | null;
}

interface CoachActivityRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  created_at: string;
  schools: { name: string } | null;
}

interface PaperAnswerActivityRow {
  id: string;
  name: string;
  paper_participation: PaperParticipation;
  paper_answered_at: string;
}

interface LockActivityRow {
  id: string;
  name: string;
  submission_locked_at: string;
}

interface PaperUpdateActivityRow {
  id: string;
  paper_name: string | null;
  updated_at: string;
  schools: { name: string } | null;
}

const PARTICIPATION_LABEL: Record<PaperParticipation, string> = {
  yes: "Joining the school paper contest",
  no: "Not joining the school paper contest",
  undecided: "Answered, still undecided",
};

/**
 * Six sources, each already ordered newest-first and capped, merged by mergeActivity()
 * into one feed.
 *
 * On the four nullable timestamps, `.not(column, "is", null)` is load-bearing rather than
 * defensive: Postgres sorts NULLs first on a descending order, so without it a table full
 * of unanswered schools would fill the whole page of results with rows that have no
 * timestamp to show. `entries.submitted_at` is `not null` (0001_init.sql:56), so the guard
 * there changes nothing today and is kept only so all six queries read alike.
 */
export const loadActivity = cache(async (): Promise<ActivityItem[]> => {
  const supabase = await getAdminClient();
  const [entries, participants, coaches, answers, locks, papers] = await Promise.all([
    supabase
      .from("entries")
      .select("id, submitted_at, school_id, schools(name), events(name)")
      .not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<EntryActivityRow[]>(),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, created_at, school_id, schools(name)"
      )
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<ParticipantActivityRow[]>(),
    supabase
      .from("coaches")
      .select("id, first_name, middle_name, last_name, created_at, schools(name)")
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<CoachActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, paper_participation, paper_answered_at")
      .not("paper_answered_at", "is", null)
      .order("paper_answered_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<PaperAnswerActivityRow[]>(),
    supabase
      .from("schools")
      .select("id, name, submission_locked_at")
      .not("submission_locked_at", "is", null)
      .order("submission_locked_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<LockActivityRow[]>(),
    supabase
      .from("school_papers")
      .select("id, paper_name, updated_at, schools(name)")
      .order("updated_at", { ascending: false })
      .limit(ACTIVITY_FETCH_LIMIT)
      .overrideTypes<PaperUpdateActivityRow[]>(),
  ]);

  return mergeActivity(
    [
      (entries.data ?? []).map((row) => ({
        id: `entry:${row.id}`,
        kind: "entry" as const,
        at: row.submitted_at,
        title: `Entry submitted — ${row.events?.name ?? "event"}`,
        meta: row.schools?.name ?? null,
        href: `/admin/entries?school=${row.school_id}`,
      })),
      (participants.data ?? []).map((row) => ({
        id: `participant:${row.id}`,
        kind: "participant" as const,
        at: row.created_at,
        title: `Learner added — ${formatParticipantNumber(row.participant_number)} ${surnameFirst(row)}`,
        meta: row.schools?.name ?? null,
        href: `/admin/participants?school=${row.school_id}`,
      })),
      (coaches.data ?? []).map((row) => ({
        id: `coach:${row.id}`,
        kind: "coach" as const,
        at: row.created_at,
        title: `Coach added — ${surnameFirst(row)}`,
        meta: row.schools?.name ?? null,
        // /admin/coaches has no school filter to link into, so this lands on the
        // unfiltered list rather than on a parameter the page would ignore.
        href: "/admin/coaches",
      })),
      (answers.data ?? []).map((row) => ({
        id: `paper-answer:${row.id}`,
        kind: "paper-answer" as const,
        at: row.paper_answered_at,
        title: `${row.name} answered the school paper question`,
        meta: PARTICIPATION_LABEL[row.paper_participation],
        href: "/admin/school-papers",
      })),
      (locks.data ?? []).map((row) => ({
        id: `submission-lock:${row.id}`,
        kind: "submission-lock" as const,
        at: row.submission_locked_at,
        title: `${row.name} locked its submissions`,
        meta: "No further changes from the school",
        href: "/admin/school-papers",
      })),
      (papers.data ?? []).map((row) => ({
        id: `paper-update:${row.id}`,
        kind: "paper-update" as const,
        at: row.updated_at,
        title: `School paper updated — ${row.paper_name?.trim() || "untitled"}`,
        meta: row.schools?.name ?? null,
        href: "/admin/school-papers",
      })),
    ],
    ACTIVITY_SHOWN
  );
});

/** Everything the overview page renders, in one call. */
export const loadDashboardData = cache(async (): Promise<DashboardData> => {
  const [schools, roster, entryFacts, events, activity, attentionInput, adminName] =
    await Promise.all([
      loadSchoolFacts(),
      loadRosterFacts(),
      loadEntryFacts(),
      loadEventFacts(),
      loadActivity(),
      loadAttentionInput(),
      loadAdminName(),
    ]);

  return {
    now: new Date(),
    adminName,
    kpis: buildKpis({
      schoolsRegistered: schools.registeredSchools,
      schoolsWithEntries: schools.schoolsWithEntries,
      participants: roster.participants,
      participantsWithoutEntry: roster.participantsWithoutEntry,
      coaches: roster.coaches,
      coachesWithoutEntry: roster.coachesWithoutEntry,
      entries: entryFacts.entries,
      entriesIndividual: entryFacts.entriesIndividual,
      entriesGroup: entryFacts.entriesGroup,
      eventTypes: events.typesTotal,
      eventTypesContested: events.typesContested,
      districtsRegistered: schools.districtsRegistered,
      districtsWithEntries: schools.districtsWithEntries,
    }),
    perSchool: summarisePerSchool(schools.active, {
      limit: PER_SCHOOL_LIMIT,
      registeredSchools: schools.registeredSchools,
    }),
    perEvent: summarisePerEvent(events.counts, {
      topN: DONUT_TOP_N,
      typesTotal: events.typesTotal,
    }),
    attention: buildAttention(attentionInput),
    activity,
    timeline: buildTimeline({
      schoolsLocked: schools.schoolsLocked,
      schoolsOpenWithEntries: schools.schoolsOpenWithEntries,
      entries: entryFacts.entries,
    }),
    eventGroups: events.groups,
  };
});
```

- [ ] **Step 3: Typecheck the fetch layer before building anything on it**

Run: `npx tsc --noEmit`

Expected: the only errors are `Cannot find module` for the four component files this task
has not created yet. Every line of `dashboard-data.ts` must be clean. If a
`.overrideTypes<…>()` call errors, check that it is the **last** call in the chain —
`.order()` and `.limit()` return a fresh builder and drop the override.

- [ ] **Step 4: Write the Registration portal card**

This is the only portal card that needs state: the two buttons' hrefs depend on what the
select is showing, so the card is a client component. It reuses `ANY` from the existing
filter bar rather than inventing a second "no filter" sentinel — Radix forbids an empty
item value, and the two must agree.

Create `components/dashboard/RegistrationPortalCard.tsx`:

```tsx
"use client";

import { useId, useState } from "react";

// Type-only, so nothing from the server module reaches the client bundle: `import type`
// is erased at compile time.
import type { EventOptionGroup } from "@/app/admin/(shell)/dashboard-data";
import { ANY } from "@/components/admin/filter-select";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RegistrationPortalCard({ groups }: { groups: EventOptionGroup[] }) {
  const id = useId();
  const [eventId, setEventId] = useState(ANY);
  const query = eventId === ANY ? "" : `?event=${eventId}`;

  return (
    <PortalCard
      title="Registration"
      description="Every entry the division's schools have submitted, filterable by event."
      control={
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            Quick access
          </Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All events</SelectItem>
              {groups.map((group) => (
                <SelectGroup key={group.typeId}>
                  <SelectLabel>{group.typeName}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      actions={[
        { label: "Go to portal", href: `/admin/entries${query}` },
        // A plain anchor, not a Link: /admin/export is a route handler that builds a
        // spreadsheet, and Link would prefetch it on hover.
        { label: "Export", href: `/admin/export${query}`, external: true },
      ]}
    />
  );
}
```

- [ ] **Step 5: Write the topbar's bell and user chip**

Both are presentational. The layout fetches; these two render. That keeps the bell's count
and the dashboard's list reading from one cached loader, so they cannot disagree.

Create `components/admin/shell/AttentionBell.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The count is real — it is how many attention categories are non-empty (see
 * lib/dashboard/attention.ts). Alerting is not built, and the popover says so plainly
 * rather than offering a "mark all read" that would do nothing.
 */
export function AttentionBell({ count }: { count: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={
            count > 0 ? `Needs attention: ${count} categories` : "Nothing needs attention"
          }
        >
          <Bell className="size-4" />
          {count > 0 ? (
            <span className="absolute top-0.5 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Needs attention</PopoverTitle>
          <PopoverDescription>
            {count > 0
              ? `${count} ${count === 1 ? "category" : "categories"} need a look.`
              : "Nothing needs attention right now."}
          </PopoverDescription>
        </PopoverHeader>
        <p className="text-sm text-muted-foreground">
          Alerting itself is not built yet: nothing is sent anywhere and there is nothing to
          mark as read. The count is live, and the list behind it is on the dashboard.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3 w-full">
          <Link href="/admin#attention">Open the list</Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

Create `components/admin/shell/UserChip.tsx`:

```tsx
import { UserRound } from "lucide-react";

/**
 * The comp's account chip, with the role it actually has. `admin_profiles` carries one
 * flat role, so the comp's "Super Administrator" would be a tier this system does not
 * have — see §4.1 of the spec.
 */
export function UserChip({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 border-l pl-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <UserRound className="size-4" />
      </span>
      <div className="hidden min-w-0 leading-tight sm:block">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="text-[11px] text-muted-foreground">Division Admin</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Fill the topbar's actions slot from the layout**

Replace `app/admin/(shell)/layout.tsx` in full:

```tsx
import { Suspense, type ReactNode } from "react";

import { AttentionBell } from "@/components/admin/shell/AttentionBell";
import { Sidebar } from "@/components/admin/shell/Sidebar";
import { Topbar } from "@/components/admin/shell/Topbar";
import { UserChip } from "@/components/admin/shell/UserChip";

import { loadShellFacts } from "./dashboard-data";

/**
 * The bell and the chip in one async unit, wrapped in Suspense by the layout so the
 * shell and the page below it are not held back by this query. On /admin it costs
 * nothing: cache() has already resolved the same loaders for the page.
 */
async function ShellActions() {
  const { adminName, attentionBadge } = await loadShellFacts();

  return (
    <>
      <AttentionBell count={attentionBadge} />
      <UserChip name={adminName} />
    </>
  );
}

/**
 * The admin shell. It lives in a route group, so /admin/login — which sits outside the
 * group — renders without it. Route groups are not part of the URL, so every existing
 * admin path is unchanged.
 *
 * No guard here on purpose: every page still calls requireAdmin() itself, which is what
 * keeps pages and route handlers independently protected rather than both leaning on one
 * layout. ShellActions reaches it through getAdminClient(), so an expired session in the
 * chrome redirects exactly as it does in the page.
 */
export default function AdminShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          actions={
            <Suspense fallback={null}>
              <ShellActions />
            </Suspense>
          }
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write the dashboard page**

Task 4 left this file as a redirect to `/admin/entries`. Replace
`app/admin/(shell)/page.tsx` in full:

```tsx
import type { ReactNode } from "react";

import { PageHeading } from "@/components/admin/shell/PageHeading";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AttentionList } from "@/components/dashboard/AttentionList";
import { EventDonut } from "@/components/dashboard/EventDonut";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { PerSchoolTable } from "@/components/dashboard/PerSchoolTable";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { RegistrationPortalCard } from "@/components/dashboard/RegistrationPortalCard";
import { SubmissionTimeline } from "@/components/dashboard/SubmissionTimeline";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { loadDashboardData } from "./dashboard-data";

/**
 * The timezone is pinned: this runs on a server whose clock is UTC, and an
 * unpinned formatter would print yesterday's date to a division office that is
 * eight hours ahead.
 */
const AS_OF = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

/**
 * The comp's header line — spec §4 lists "SCHOOLS PRESS CONFERENCE 2026" as REAL, and
 * this is it. Static by design: nothing in the database names the competition or holds
 * its year, and adding a table for one string would be a schema change this plan does
 * not make. Edit this line next season.
 *
 * Stored in title case, not the comp's all-caps. The caps there are a type treatment,
 * not the string, and `PageHeading` renders its `title` as a `text-lg` h1 alongside
 * "Entries", "Schools" and "Districts" — shouting in one of six headings would read as
 * a mistake.
 */
const EVENT_TITLE = "Schools Press Conference 2026";

/**
 * The five data panels return bare markup — Task 14 gave a Card only to KpiTile and
 * PortalCard — so the page owns the card, the heading and the anchor around each one.
 * That is deliberate: it puts every panel title in one file, where they can be read as a
 * set, and it is what lets the "Needs attention" panel carry an id the topbar bell can
 * link to.
 *
 * `action` is unused on this page. Task 17 fills it on the per-school panel (an Excel
 * button) and Task 22 fills it on the activity panel (a "View all" link); leaving the
 * slot here means neither task has to reopen this helper.
 */
function Panel({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const data = await loadDashboardData();

  return (
    <div className="space-y-6">
      <PageHeading
        title={EVENT_TITLE}
        badge={data.timeline.statusPill}
        subtitle={`Welcome back, ${data.adminName}. Division-wide figures as of ${AS_OF.format(data.now)}.`}
        actions={
          <Button asChild size="sm" variant="outline">
            {/* A route handler, not a page. `next/link` would prefetch it on hover and
                build a whole spreadsheet to throw away. */}
            <a href="/admin/export">Export entries</a>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((kpi) => (
          <KpiTile key={kpi.key} kpi={kpi} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Registration by school"
          description="Learners, coaches and entries per school, the busiest first."
        >
          <PerSchoolTable summary={data.perSchool} />
        </Panel>
        <Panel
          title="Entries by event type"
          description="Where the division's entries are concentrated."
        >
          <EventDonut summary={data.perEvent} />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* The topbar bell links to /admin#attention, so this id is load-bearing. */}
        <Panel
          id="attention"
          title="Needs attention"
          description="Gaps a division admin can chase today."
        >
          <AttentionList items={data.attention} />
        </Panel>
        <Panel
          title="Recent activity"
          description="The newest changes the division's schools have made."
        >
          <ActivityFeed items={data.activity} now={data.now} />
        </Panel>
        <Panel
          title="Submission timeline"
          description="How far the division has got through registration."
        >
          <SubmissionTimeline timeline={data.timeline} />
        </Panel>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <RegistrationPortalCard groups={data.eventGroups} />
        <PortalCard
          title="School Paper"
          description="Which schools are joining the school paper contest, how far each has got, and what they have submitted."
          actions={[{ label: "Go to portal", href: "/admin/school-papers" }]}
        />
        <PortalCard
          title="Judges"
          description="Judging panels, per-event assignments, and the sheets judges score on."
          soon
          requires={[
            "A judges table — the database has no judge, no panel and no assignment.",
            "A scoring model, so an assigned judge has something to open.",
          ]}
        />
        <PortalCard
          title="Tabulators"
          description="Score entry and per-event ranking for the tabulation team."
          soon
          requires={[
            "Scores to tabulate, which arrive with judging.",
            "A ranking and tie-break rule per event, agreed with the division office.",
          ]}
        />
      </section>
    </div>
  );
}
```

**Three links this page deliberately does not render yet.** `ADMIN_NAV` (Task 2) marks
`/admin/summary`, `/admin/overall-data` and `/admin/activity` as `soon`, so none of them
resolves during this phase. Rendering a live button to any of them here would ship a 404
on the division's landing page. Each is wired by the task that creates the route:

| Missing link | Where it goes | Added by |
|---|---|---|
| "Export to Excel" on the per-school panel | `<Panel action=…>` on Registration by school | Task 17 |
| "View all" on the activity panel | `<Panel action=…>` on Recent activity | Task 22 |
| A per-school summary report | a fifth portal card, or a `PageHeading` action | Task 18 |

- [ ] **Step 8: Type-check, lint, and run the whole unit suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run lib/dashboard
```

Expected: all three clean. `tsc` is the one that matters most here — it is what proves the
nine loaders in `dashboard-data.ts` hand each panel exactly the shape Tasks 7-13 defined.
Two failures are plausible:

- **`Property 'x' does not exist on type 'never'`** inside a `.select()` result. A
  `.overrideTypes<…>()` that is not the last call in the chain is dropped silently; move
  it after every `.order()`, `.limit()` and `.eq()`.
- **`Type 'string' is not assignable to type 'EventLevel'`** on the `LEVEL_LABEL` lookup.
  `events.level` comes back as a plain string from PostgREST; the row interface in
  `loadEventFacts` is what narrows it, so check that interface rather than casting at the
  lookup.

- [ ] **Step 9: Read the page against production and reconcile the attention counts**

```powershell
npm run dev
```

Open `http://localhost:3000/admin` signed in as an admin, and check all six:

1. **The numbers agree with the pages they describe.** Task 11 Step 6 flagged three counts
   that must match a real page's row count, and this is where that is checked: click each
   attention row and confirm the destination lists exactly the number the row promised.
   `/admin/participants?school=…` and `/admin/entries?school=…` are the two that can drift,
   because a filter default on either page would change the count without changing the
   dashboard. If a number disagrees, the dashboard query is what changes — never the page.
2. **The bell badge equals the number of rows in the attention panel.** Both come from
   `buildAttention`, so a mismatch means the layout and the page resolved different
   `cache()` instances — check that every loader is no-argument.
3. **The donut adds up.** Its footnote's "N of M event types" and the legend's shares are
   derived independently of the ring; if the ring looks like a different distribution than
   the table beside it, `donutGeometry` is being handed a different array than the legend.
4. **Nothing says "Super Administrator" or invents a conference date.** The chip reads
   "Division Admin" and the subtitle's date is today's, formatted in Manila time.
5. **The comp's header block is all there.** "Schools Press Conference 2026" as the h1, the
   registration-status pill immediately beside it, the as-of line under it, and the export
   button on the right. Spec §4 marks that title REAL; it is the one string on this page
   that is hard-coded rather than queried, and spec §4 says why.
6. **The layout survives 1280px, 1024px and 390px.** The KPI row collapses 6 → 3 → 2 → 1,
   the two three-column rows stack, and no table pushes the page sideways — the per-school
   table scrolls inside its own `overflow-x-auto`.
7. **Both themes.** Toggle dark and light and confirm the donut's eight hues are the
   validated dark steps in dark mode, not the light ones (Task 1 defines both; the CSS
   custom properties do the switch).

Then read the terminal: **there must be no `500` and no PostgREST error in the dev log.**
A `42703 column … does not exist` here means a column name in `dashboard-data.ts` is wrong
— fix the query, and do not add a migration. This plan does not touch the database.

- [ ] **Step 10: Commit**

```bash
git add "app/admin/(shell)/dashboard-data.ts" "app/admin/(shell)/page.tsx" "app/admin/(shell)/layout.tsx" components/admin/shell/AttentionBell.tsx components/admin/shell/UserChip.tsx components/dashboard/RegistrationPortalCard.tsx
git commit -m "feat(admin): build the division dashboard overview on live data"
```

---

# Phase 3 — Soon pages

Five routes whose features do not exist. The point of building them is the sidebar: an
admin who clicks "Judges Portal" should land on a page that explains itself, not on a
disabled `<span>` that gives no reason and no way forward.

Nothing here reads data except the settings page's one real number.

---

### Task 16: The Soon page component and five stub routes

The nav currently renders these five as dimmed, unclickable text, because Phase 1 had no
page to send them to. This task gives them pages, so they need to become links — and they
must keep their "Soon" pill, because the feature is still not built. Those are two
different facts about a nav item, so this task adds a second flag rather than overloading
the first.

| Flag | Meaning | Rendered as |
|---|---|---|
| `soon: true` | No route exists. | Dimmed text, "Soon" pill, not clickable |
| `stub: true` | The route exists and says "Coming soon". | A normal link, "Soon" pill |

After this task the six `soon` items are exactly the Phase 4 pages, and Tasks 17-22 clear
that flag as each real page lands — one task per page, one flag per task. No commit in this
plan ever leaves a clickable nav item pointing at a route that does not exist.

**Files:**
- Modify: `lib/admin/nav.ts` (add `stub` to `NavItem`; five items change flag)
- Modify: `lib/admin/nav.test.ts` (two invariant tests)
- Modify: `components/admin/shell/Sidebar.tsx` (`AdminNav` grows one branch)
- Create: `components/dashboard/SoonPage.tsx`
- Create: `app/admin/(shell)/judges/page.tsx`, `app/admin/(shell)/tabulators/page.tsx`, `app/admin/(shell)/users/page.tsx`, `app/admin/(shell)/settings/page.tsx`, `app/admin/(shell)/audit-logs/page.tsx`

**Interfaces:**
- Consumes: `NavItem`, `ADMIN_NAV` (Task 2); `PageHeading` (Task 3); `requireAdmin` from `@/app/admin/guard`; `loadSchoolFacts` from `../dashboard-data` (Task 15) — the settings page only.
- Produces:
  ```ts
  export interface NavItem {
    label: string;
    href: string;
    icon: NavIcon;
    soon?: boolean;
    stub?: boolean;
  }
  export function SoonPage(props: {
    title: string;
    summary: string;
    requires: string[];
    children?: React.ReactNode;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing invariant tests**

Task 2 left a test in `lib/admin/nav.test.ts` called *"leaves live only the routes that exist
after phase 1"*, which pins `items.filter((i) => !i.soon)` to a hard-coded list of five
hrefs. **That test is about to become wrong, and not only for this task.** Moving five items
from `soon` to `stub` makes them pass `!i.soon`, so the list grows here — and it grows again
in each of Tasks 17 to 22 as their flags clear. A snapshot that six consecutive tasks have to
edit is a snapshot nobody will read by the third edit.

Replace it with the invariant it was reaching for. Delete that `it(...)` block and put this
in its place, at the top of the file:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
```

and in the body:

```ts
  /** `/admin/entries` -> `app/admin/(shell)/entries/page.tsx`; `/admin` -> the group root. */
  function pageFileFor(href: string): string {
    // path.join drops empty segments, so the root href resolves to the group's own page.
    const segment = href.replace(/^\/admin\/?/, "");
    return path.join(process.cwd(), "app", "admin", "(shell)", segment, "page.tsx");
  }

  it("links an item exactly when its route file exists", () => {
    // The promise this file exists to keep: `soon` means unlinked, and unlinked must mean
    // there is genuinely nothing to link to. Checking the filesystem rather than a list is
    // what lets every later task clear its flag without coming back to edit this test —
    // and what makes clearing a flag without shipping the page fail here instead of in
    // production as a 404 in the sidebar.
    for (const item of items) {
      expect({ href: item.href, hasPage: existsSync(pageFileFor(item.href)) }).toEqual({
        href: item.href,
        hasPage: !item.soon,
      });
    }
  });
```

The object-shaped assertion is deliberate: a bare boolean inside a loop fails with
`expected false to be true` and no clue which of eighteen items broke. Vitest runs with the
project root as `process.cwd()`, so the paths resolve without configuration.

Then append the two flag tests:

```ts
describe("stub and soon flags", () => {
  const items = ADMIN_NAV.flatMap((group) => group.items);

  it("never marks an item both soon and stub", () => {
    // `soon` means there is no route; `stub` means there is one. Both at once
    // would make AdminNav's rendering order the tie-breaker, which is a bug
    // waiting for whoever reorders those branches.
    expect(items.filter((item) => item.soon && item.stub)).toEqual([]);
  });

  it("marks exactly the five feature-less routes as stubs", () => {
    expect(items.filter((item) => item.stub).map((item) => item.href)).toEqual([
      "/admin/judges",
      "/admin/tabulators",
      "/admin/users",
      "/admin/settings",
      "/admin/audit-logs",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: two failures. *"links an item exactly when its route file exists"* fails on the
five stub hrefs — this step has not created their pages yet — and *"marks exactly the five
feature-less routes as stubs"* fails with an empty array received. A `stub` property that
TypeScript rejects outright is the same signal as the second failure.

Both clear in Step 6, once the five pages exist and the flags have moved. That ordering is
the point: the flag and the file land together or the suite is red.

- [ ] **Step 3: Add the flag and move the five items onto it**

In `lib/admin/nav.ts`, extend the interface:

```ts
export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** No route exists yet. Shown in the nav, never linked. */
  soon?: boolean;
  /**
   * The route exists but the feature does not: it renders a Soon page. Linked,
   * and still labelled, so the nav is honest in both directions.
   */
  stub?: boolean;
}
```

Then change `soon: true` to `stub: true` on exactly five items — the two in `Adjudication`
and the three in `System`:

```ts
  {
    label: "Adjudication",
    items: [
      { label: "Judges Portal", href: "/admin/judges", icon: "judges", stub: true },
      { label: "Tabulators", href: "/admin/tabulators", icon: "tabulators", stub: true },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Users & Access", href: "/admin/users", icon: "users", stub: true },
      { label: "Settings", href: "/admin/settings", icon: "settings", stub: true },
      { label: "Audit Logs", href: "/admin/audit-logs", icon: "audit", stub: true },
    ],
  },
```

Leave the `Reference` and `Reports` groups on `soon: true`. Tasks 17-22 clear those, one
page per task: Overall Data (17), School Summary (18), Schools (19), Districts (20),
Events (21), Activity Log (22).

- [ ] **Step 4: Run the tests to check what is left**

Run: `npx vitest run lib/admin/nav.test.ts`
Expected: *"marks exactly the five feature-less routes as stubs"* now PASSES; *"links an item
exactly when its route file exists"* still FAILS, naming the first of the five stub hrefs
whose `page.tsx` does not exist yet. Everything else passes — 10 tests, 1 failing.

Leave it red and carry on. Step 6 creates those five pages, and Step 7 is where the whole
file goes green. A red suite between two steps of one task is fine; a red suite at a commit
is not, and there is no commit until Step 8.

- [ ] **Step 5: Teach `AdminNav` to link a stub**

In `components/admin/shell/Sidebar.tsx`, the `soon` branch inside `AdminNav` already
renders the pill. Extract that pill so the two branches cannot drift apart, and add the
link branch. Replace the `if (item.soon)` block and the lines that follow it, up to and
including the `<Link>`'s closing tag, with:

```tsx
              // Two different facts: `soon` has no page to open, `stub` has a page
              // that explains itself. Both keep the label. Collapsed, both lose it
              // to a tooltip, so the pill has nothing to sit beside and drops out
              // with it — the icon plus "coming soon" in the tooltip carries it.
              const pill = collapsed ? null : (
                <span className="shrink-0 rounded border border-sidebar-border px-1 py-px text-[9px] font-medium uppercase tracking-wide">
                  Soon
                </span>
              );

              const label = collapsed ? (
                <span className="sr-only">{item.label} — coming soon</span>
              ) : (
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              );

              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled="true"
                      title={collapsed ? `${item.label} — coming soon` : undefined}
                      className={cn(
                        "flex cursor-not-allowed items-center gap-2.5 rounded-md py-2 text-sm text-sidebar-foreground/40",
                        collapsed ? "justify-center px-2" : "px-3"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {label}
                      {pill}
                    </span>
                  </li>
                );
              }

              const active = isNavActive(pathname, item.href);
              // A stub's tooltip says so; a finished page's is just its name.
              const hint = item.stub ? `${item.label} — coming soon` : item.label;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? hint : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors",
                      collapsed ? "justify-center px-2" : "px-3",
                      active
                        ? "bg-sidebar-primary/15 font-medium text-sidebar-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {collapsed ? (
                      <span className="sr-only">{hint}</span>
                    ) : (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    )}
                    {item.stub ? pill : null}
                  </Link>
                </li>
              );
```

The link's label span gains `min-w-0 flex-1` so the pill has somewhere to sit; without it
a long label pushes the pill off the rail.

- [ ] **Step 6: Write the Soon page component**

Create `components/dashboard/SoonPage.tsx`:

```tsx
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
```

- [ ] **Step 7: Write the four data-free stubs**

Each guards itself. A stub is still an admin page, and a signed-out visitor must not read
the roadmap for the division's judging system.

Create `app/admin/(shell)/judges/page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function JudgesPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Judges Portal"
      summary="Judging panels, per-event assignments, and the sheets judges score on."
      requires={[
        "A judges table. The database has no judge, no panel and no assignment — only schools, entries and the roster.",
        "A scoring model per event type: criteria, weights and a maximum, so a score means the same thing twice.",
        "Judge accounts, which are a second kind of login and a second set of row-level security policies.",
      ]}
    />
  );
}
```

Create `app/admin/(shell)/tabulators/page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function TabulatorsPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Tabulators"
      summary="Score entry, per-event ranking, and the division's official results."
      requires={[
        "Scores to tabulate, which arrive with the judging system.",
        "A ranking and tie-break rule per event, agreed with the division office rather than invented here.",
        "A separate tabulator role. Today admin_profiles carries one flat role and everyone in it can do everything.",
      ]}
    />
  );
}
```

Create `app/admin/(shell)/users/page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";

export default async function UsersPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Users & Access"
      summary="Who can sign in to the division console, and what each of them may do."
      requires={[
        "More than one role. admin_profiles has a single flat role, so there is nothing to grant or revoke yet.",
        "An invite and deactivation flow, which writes to auth users — out of scope for a read-only dashboard.",
        "An audit trail, so a permission change is attributable after the fact.",
      ]}
    />
  );
}
```

Create `app/admin/(shell)/audit-logs/page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AuditLogsPage() {
  await requireAdmin();

  return (
    <SoonPage
      title="Audit Logs"
      summary="An attributable record of every administrative change: who, what, and when."
      requires={[
        "An audit table and the triggers that write to it. Nothing records administrative writes today.",
        "A decision about retention, since this would hold names of minors indefinitely.",
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What is recorded today</CardTitle>
          <CardDescription>
            Timestamps, not attribution — enough to see when something happened, never who
            did it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <code className="text-xs">created_at</code> on schools, participants, coaches
              and entries — which the dashboard&apos;s Recent activity panel already reads.
            </li>
            <li>
              <code className="text-xs">submission_locked_at</code> and the school-paper
              answer and update timestamps.
            </li>
          </ul>
        </CardContent>
      </Card>
    </SoonPage>
  );
}
```

- [ ] **Step 8: Write the settings stub, with the one real number it can show**

Settings is the only stub that reads data. The spec asks it to surface the per-school
submission-lock tally, because that is the sole piece of division-wide configuration state
this database actually holds — and to say plainly that changing it happens per school, on
the school-papers page, because that is a write.

It reuses `loadSchoolFacts` rather than issuing its own count. That query is heavier than a
tally needs, but it guarantees this page and the dashboard's timeline can never disagree
about how many schools are locked, and settings is not a hot path. `requireAdmin()` is
still called directly, so this page is protected the same way as every other one, and
`cache()` means the extra call costs one `auth.getUser()`.

Create `app/admin/(shell)/settings/page.tsx`:

```tsx
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { SoonPage } from "@/components/dashboard/SoonPage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { loadSchoolFacts } from "../dashboard-data";

export default async function SettingsPage() {
  await requireAdmin();
  const facts = await loadSchoolFacts();

  return (
    <SoonPage
      title="Settings"
      summary="Division-wide configuration for the competition."
      requires={[
        "Somewhere to store a setting. The app_settings table was dropped in migration 0010, and restoring it is a schema change this work does not make.",
        "A decision about which settings are division-wide at all, given that the submission lock is deliberately per school.",
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submission lock</CardTitle>
          <CardDescription>
            Read-only. This is real state, shown here because it is the closest thing to a
            division-wide setting the database holds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">
              {facts.schoolsLocked}
            </span>{" "}
            <span className="text-muted-foreground">
              of {facts.registeredSchools} registered schools have locked their submission.
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            There is no division-wide switch. Locking and unlocking is done one school at a
            time from the school papers page — it is a write, and this dashboard does not
            make writes.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/school-papers">Go to School Papers</Link>
          </Button>
        </CardContent>
      </Card>
    </SoonPage>
  );
}
```

- [ ] **Step 9: Type-check, lint, and run the nav tests**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run lib/admin/nav.test.ts
```

Expected: all clean — including *"links an item exactly when its route file exists"*, which
Step 4 left red and Steps 7 and 8 have now satisfied by creating all five `page.tsx` files.
If it still fails, it is naming the stub whose page is missing or misnamed; the filename must
be exactly `page.tsx` under `app/admin/(shell)/<segment>/`.

`react/no-unescaped-entities` is the likely lint failure — the apostrophe in "dashboard's" is
already written as `&apos;`; check any prose you reworded.

- [ ] **Step 10: Click all five in the browser**

```powershell
npm run dev
```

With `npm run dev` running and signed in as an admin:

1. Every one of the five sidebar items is now **clickable** and still shows its "Soon"
   pill. The six under Reference and Reports are still dimmed and unclickable.
2. Each page renders a title, the badge, the summary, the "needs first" list, and a working
   "Back to the dashboard" button.
3. `/admin/settings` shows a lock tally whose second number matches the dashboard's
   per-school table footer ("N of 332 schools"), and whose first number matches the
   dashboard timeline's locked count.
4. Sign out, then visit `/admin/judges` directly: it redirects to `/admin/login`.
5. The active-state highlight lands on the item you clicked, and on nothing else.

- [ ] **Step 11: Commit**

```bash
git add lib/admin/nav.ts lib/admin/nav.test.ts components/admin/shell/Sidebar.tsx components/dashboard/SoonPage.tsx "app/admin/(shell)/judges" "app/admin/(shell)/tabulators" "app/admin/(shell)/users" "app/admin/(shell)/settings" "app/admin/(shell)/audit-logs"
git commit -m "feat(admin): add the five soon pages and link them from the nav"
```

---

# Phase 4 — Read-only detail pages

Six routes that turn the dashboard's summaries into the full views they promise. Every one
is a `SELECT` and a render; between them they clear the last six `soon` flags in the nav.

Order matters only in one place: Task 17 extracts the schools query into a module that
Tasks 18-20 do not need but the export route does, so it goes first.

---

### Task 17: Overall Data, and the Excel export the dashboard promises

The dashboard's per-school panel is truncated to fifteen rows and says so. This is the
untruncated view, plus the workbook the comp's "Export to Excel" button downloads.

Both read the same numbers as the dashboard, and this task makes that structural rather
than hopeful: the query moves into one module that the page, the dashboard and the route
handler all call. That matters because a route handler **cannot** use
`dashboard-data.ts` — `requireAdmin()` redirects, and a redirect answered to a click that
expected a spreadsheet returns a login page with a 200. `/admin/export/route.ts` already
solves this by checking admin inline and returning JSON 401/403; this route copies that,
and reads through the shared query so the two guards cannot diverge in what they fetch.

Spec §5.2 also names the page's entry point — a "View all N schools" link on the dashboard
panel — and asks for filters; the file map (spec line 129) asks for a per-event breakdown
beside the per-school one. All three are in this task, so the page ships whole.

The district filter narrows **both** tables. That costs one extra query — every entry's
district and event type, 130 rows today — but a page where one section obeys the filter and
the other quietly ignores it is worse than no filter at all.

**Files:**
- Create: `lib/dashboard/school-facts.ts`
- Create: `lib/export/overall-data-workbook.ts`
- Test: `lib/export/overall-data-workbook.test.ts`
- Create: `app/admin/(shell)/overall-data/page.tsx`
- Create: `app/admin/(shell)/overall-data/OverallDataFilter.tsx`
- Create: `app/admin/(shell)/overall-data/export/route.ts`
- Modify: `lib/dashboard/per-event.ts` (adds `countByEventType`)
- Test: `lib/dashboard/per-event.test.ts` (extends Task 9's file)
- Modify: `lib/dashboard/per-school.ts` (`SchoolRollupRow` gains `districtId`)
- Test: `lib/dashboard/per-school.test.ts` (fixtures gain the new field)
- Modify: `app/admin/(shell)/dashboard-data.ts` (`loadSchoolFacts` delegates to the new module)
- Modify: `lib/supabase/server.ts` (exports the client's type — one line, see Step 1)
- Modify: `app/admin/(shell)/page.tsx` (the per-school panel gets its two links)
- Modify: `lib/admin/nav.ts` (Overall Data stops being `soon`)

**Interfaces:**
- Consumes: `SchoolRollupRow`, `PerSchoolSummary`, `summarisePerSchool` (Task 8); `EventTypeCount`, `PerEventSummary`, `summarisePerEvent` (Task 9); `paperStatus` from `@/lib/paper/status` and `PaperParticipation` from `@/lib/paper/gate` (both existing, and both already imported this way by Task 15 — the two names live in different files); `PerSchoolTable` (Task 14); `PageHeading` (Task 3); `ANY`, `FilterSelect` from the existing `@/components/admin/filter-select`; `SupabaseServerClient` from `@/lib/supabase/server`.
- Produces:
  ```ts
  // lib/dashboard/school-facts.ts
  export interface SchoolFacts {
    active: SchoolRollupRow[];          // each row now carries districtId
    registeredSchools: number;
    registeredByDistrict: Record<string, number>;   // new in this task
    schoolsWithEntries: number;
    districtsRegistered: number;
    districtsWithEntries: number;
    schoolsLocked: number;
    schoolsOpenWithEntries: number;
    schoolsPaperNotStarted: number;
    schoolsWithLearnersButNoEntry: number;
  }
  export async function fetchSchoolFacts(supabase: SupabaseServerClient): Promise<SchoolFacts>;

  // lib/dashboard/per-event.ts — added beside Task 9's summarisePerEvent
  export interface EventTypeRow { typeId: string; typeName: string }
  export function countByEventType(rows: EventTypeRow[]): EventTypeCount[];

  // lib/export/overall-data-workbook.ts
  export interface OverallDataRow {
    School: string;
    District: string;
    Learners: number | string;
    Coaches: number | string;
    Entries: number | string;
  }
  export function toOverallDataRows(summary: PerSchoolSummary): OverallDataRow[];
  export function buildOverallDataWorkbook(summary: PerSchoolSummary): XLSX.WorkBook;

  // app/admin/(shell)/overall-data/OverallDataFilter.tsx
  export function OverallDataFilter(props: {
    districts: { id: string; name: string }[];
  }): React.JSX.Element;   // client
  ```

- [ ] **Step 1: Move the schools query into its own module, and let its rows be filtered**

First, one line in `lib/supabase/server.ts`. The file exports `createClient()` but not the
type it returns, and `app/admin/guard.ts` works around that with a private alias. Three
modules now need to name that type, so export it once, beside the function:

```ts
export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
```

Nothing else in that file changes, and `guard.ts` keeps its local alias — replacing it is a
tidy-up this plan does not need, and touching the guard is not worth a type rename.

Now cut the `SchoolFactRow` interface, the `SchoolFacts` interface and the whole body of
`loadSchoolFacts` out of `app/admin/(shell)/dashboard-data.ts` and into a new
`lib/dashboard/school-facts.ts`. The query itself does not change — only where it lives and
that it now takes its client as an argument instead of calling `getAdminClient()`.

The new file's exports:

```ts
import { paperStatus } from "@/lib/paper/status";
import type { PaperParticipation } from "@/lib/paper/gate";
import type { SchoolRollupRow } from "@/lib/dashboard/per-school";
import type { SupabaseServerClient } from "@/lib/supabase/server";

// …the SchoolFactRow interface, verbatim from dashboard-data.ts…

export interface SchoolFacts {
  // …verbatim from dashboard-data.ts, now exported…
}

/**
 * One query, nine facts. It takes the client rather than building one, because its two
 * callers guard differently: a page redirects to the login screen, a route handler must
 * answer 401 with JSON. Sharing the query and not the guard is the point of this module.
 */
export async function fetchSchoolFacts(
  supabase: SupabaseServerClient
): Promise<SchoolFacts> {
  // …the body of loadSchoolFacts, verbatim, minus its first line…
}
```

Then in `dashboard-data.ts`, `loadSchoolFacts` becomes three lines. It still needs the type
for its own return annotation, so the type comes back in as a type-only import — but it is
*not* re-exported. Nothing outside this file ever imported the name (the settings page from
Task 16 imports the function, `loadSchoolFacts`, not the type), and the new module is now the
one place it lives:

```ts
import { fetchSchoolFacts, type SchoolFacts } from "@/lib/dashboard/school-facts";

export const loadSchoolFacts = cache(async (): Promise<SchoolFacts> => {
  return fetchSchoolFacts(await getAdminClient());
});
```

Then make two additive changes, both of which the district filter needs and neither of which
alters an existing number.

**One: `active` keeps its district id.** The query already selects `district_id` and the
intermediate `rows` array already carries `districtId` — the mapping to `active` drops it on
the floor. Stop dropping it:

```ts
    active: rows
      .filter((row) => row.learners > 0 || row.coaches > 0 || row.entries > 0)
      .map(({ schoolId, schoolName, districtId, districtName, learners, coaches, entries }) => ({
        schoolId,
        schoolName,
        districtId,
        districtName,
        learners,
        coaches,
        entries,
      })),
```

Add the field to `SchoolRollupRow` in `lib/dashboard/per-school.ts`, between `schoolName`
and `districtName`:

```ts
export interface SchoolRollupRow {
  schoolId: string;
  schoolName: string;
  /** Needed by the overall-data filter; the table itself shows the name. */
  districtId: string;
  districtName: string;
  learners: number;
  coaches: number;
  entries: number;
}
```

Making it required means `lib/dashboard/per-school.test.ts` will not compile until its
fixtures carry it. That is the point — add `districtId` to each fixture school (any stable
string; the module never reads it) and change no assertions. `summarisePerSchool` copies
rows through untouched, so nothing in its logic responds to the new field.

**Two: a registered count per district.** A filtered table needs a filtered denominator, or
its footer reads "4 of 332 schools" while its totals cover four. Add one field to
`SchoolFacts` and one fold to build it, beside `registeredSchools`:

```ts
  /** School counts keyed by district id — registered, not active. Task 20's districts page reads this too. */
  registeredByDistrict: Record<string, number>;
```

```ts
    registeredSchools: rows.length,
    registeredByDistrict: rows.reduce<Record<string, number>>((acc, row) => {
      if (row.districtId) acc[row.districtId] = (acc[row.districtId] ?? 0) + 1;
      return acc;
    }, {}),
```

Now run `npx tsc --noEmit` and `npx vitest run lib/dashboard`. Both must be clean before
going further: apart from the two changes above this step is a pure move, so anything else
that breaks is a copy error, and it is far cheaper to find now than after three new files
sit on top of it.

- [ ] **Step 2: Write the failing per-event count test**

The dashboard's donut counts entries per type with a grouped select in `loadEventFacts`.
This page needs the same counts **narrowed by district**, which a `count`-only query cannot
express, so it fetches one row per entry and folds them in JS. The fold is pure logic and
belongs beside the function that consumes it.

Append to the existing `lib/dashboard/per-event.test.ts` (Task 9's file — keep its imports
and add `countByEventType` to them):

```ts
describe("countByEventType", () => {
  it("counts one row per entry into one row per type", () => {
    const counts = countByEventType([
      { typeId: "t1", typeName: "News Writing" },
      { typeId: "t2", typeName: "Editorial Writing" },
      { typeId: "t1", typeName: "News Writing" },
    ]);

    expect(counts).toEqual([
      { typeId: "t1", typeName: "News Writing", entries: 2 },
      { typeId: "t2", typeName: "Editorial Writing", entries: 1 },
    ]);
  });

  it("returns an empty list for no rows, not a zero-filled one", () => {
    // A district with no entries must produce an empty table, not sixteen zeroes.
    expect(countByEventType([])).toEqual([]);
  });

  it("keeps first-seen order, leaving the ranking to summarisePerEvent", () => {
    const counts = countByEventType([
      { typeId: "b", typeName: "Bravo" },
      { typeId: "a", typeName: "Alpha" },
      { typeId: "a", typeName: "Alpha" },
    ]);

    expect(counts.map((c) => c.typeId)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/dashboard/per-event.test.ts`
Expected: FAIL — `countByEventType is not exported by ./per-event`.

- [ ] **Step 4: Add the fold to `lib/dashboard/per-event.ts`**

Append below `summarisePerEvent`:

```ts
/** One entry's event type, as the overall-data page selects them. */
export interface EventTypeRow {
  typeId: string;
  typeName: string;
}

/**
 * Rows to counts. Order is first-seen and deliberately not sorted:
 * `summarisePerEvent` ranks, and two functions ranking the same list is how
 * two surfaces end up disagreeing about which type is biggest.
 */
export function countByEventType(rows: EventTypeRow[]): EventTypeCount[] {
  const byType = new Map<string, EventTypeCount>();

  for (const row of rows) {
    const found = byType.get(row.typeId);
    if (found) {
      found.entries += 1;
    } else {
      byType.set(row.typeId, { typeId: row.typeId, typeName: row.typeName, entries: 1 });
    }
  }

  return [...byType.values()];
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run lib/dashboard/per-event.test.ts`
Expected: PASS — 11 tests (Task 9's 8, plus these 3).

- [ ] **Step 6: Write the failing workbook test**

Create `lib/export/overall-data-workbook.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toOverallDataRows } from "./overall-data-workbook";
import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

const summary = (over: Partial<PerSchoolSummary> = {}): PerSchoolSummary => ({
  rows: [
    {
      schoolId: "a",
      schoolName: "Alabel National High School",
      districtName: "Alabel",
      learners: 12,
      coaches: 3,
      entries: 9,
    },
    {
      schoolId: "b",
      schoolName: "Malapatan Central",
      districtName: "Malapatan",
      learners: 4,
      coaches: 1,
      entries: 2,
    },
  ],
  totals: { learners: 40, coaches: 10, entries: 30 },
  activeSchools: 6,
  registeredSchools: 332,
  hiddenSchools: 4,
  ...over,
});

describe("toOverallDataRows", () => {
  it("keeps one row per school, in the order given", () => {
    const rows = toOverallDataRows(summary());

    expect(rows.slice(0, 2)).toEqual([
      {
        School: "Alabel National High School",
        District: "Alabel",
        Learners: 12,
        Coaches: 3,
        Entries: 9,
      },
      { School: "Malapatan Central", District: "Malapatan", Learners: 4, Coaches: 1, Entries: 2 },
    ]);
  });

  it("ends with the division-wide total, not the sum of the rows above it", () => {
    // The dashboard truncates; the totals never do. A reader who adds up the
    // visible column and gets a different number must be able to see why.
    const rows = toOverallDataRows(summary());

    expect(rows.at(-1)).toEqual({
      School: "DIVISION TOTAL",
      District: "6 of 332 schools",
      Learners: 40,
      Coaches: 10,
      Entries: 30,
    });
  });

  it("still emits the total row when no school has data", () => {
    const rows = toOverallDataRows(
      summary({
        rows: [],
        totals: { learners: 0, coaches: 0, entries: 0 },
        activeSchools: 0,
        hiddenSchools: 0,
      })
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].School).toBe("DIVISION TOTAL");
  });

  it("writes an empty district cell rather than the word undefined", () => {
    const rows = toOverallDataRows(
      summary({
        rows: [
          {
            schoolId: "a",
            schoolName: "Unassigned",
            districtName: "",
            learners: 0,
            coaches: 0,
            entries: 0,
          },
        ],
      })
    );

    expect(rows[0].District).toBe("");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run lib/export/overall-data-workbook.test.ts`
Expected: FAIL — `Failed to resolve import "./overall-data-workbook"`.

- [ ] **Step 8: Write the workbook builder**

Create `lib/export/overall-data-workbook.ts`:

```ts
import * as XLSX from "xlsx";

import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

export interface OverallDataRow {
  School: string;
  District: string;
  Learners: number | string;
  Coaches: number | string;
  Entries: number | string;
}

/**
 * One row per school, then the division total — the same two-part shape as the
 * dashboard table, so a printed sheet and the screen can be read side by side.
 *
 * The total is `summary.totals`, which Task 8 computes over every active school
 * including the ones a top-N cut. That is deliberate, and the District cell on
 * that row says so in words, because a spreadsheet has no footnote.
 */
export function toOverallDataRows(summary: PerSchoolSummary): OverallDataRow[] {
  const rows: OverallDataRow[] = summary.rows.map((row) => ({
    School: row.schoolName,
    District: row.districtName,
    Learners: row.learners,
    Coaches: row.coaches,
    Entries: row.entries,
  }));

  rows.push({
    School: "DIVISION TOTAL",
    District: `${summary.activeSchools} of ${summary.registeredSchools} schools`,
    Learners: summary.totals.learners,
    Coaches: summary.totals.coaches,
    Entries: summary.totals.entries,
  });

  return rows;
}

export function buildOverallDataWorkbook(summary: PerSchoolSummary): XLSX.WorkBook {
  const sheet = XLSX.utils.json_to_sheet(toOverallDataRows(summary), {
    header: ["School", "District", "Learners", "Coaches", "Entries"],
  });
  sheet["!cols"] = [40, 24, 12, 12, 12].map((wch) => ({ wch }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Overall Data");
  return book;
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run lib/export/overall-data-workbook.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 10: Write the district filter**

One dropdown, wired to the URL the way `entries/FilterBar.tsx` already is, so the two pages
behave identically and the export link inherits whatever is selected. It reuses the existing
`FilterSelect` rather than growing a second dropdown style.

Create `app/admin/(shell)/overall-data/OverallDataFilter.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function OverallDataFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const district = searchParams.get("district");

  function setDistrict(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set("district", value);
    } else {
      params.delete("district");
    }
    const qs = params.toString();
    router.push(qs ? `/admin/overall-data?${qs}` : "/admin/overall-data");
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <FilterSelect
            label="District"
            value={district ?? ANY}
            onChange={setDistrict}
            placeholder="All districts"
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>

        {district ? (
          <Button variant="ghost" size="sm" onClick={() => setDistrict(ANY)}>
            <X className="size-4" />
            Clear filter
          </Button>
        ) : null}

        <Button asChild variant="outline" size="sm" className="ml-auto">
          {/* A route handler, and it carries the filter, so the file matches the screen.
              A plain anchor: next/link would build a workbook on hover. */}
          <a href={`/admin/overall-data/export?${searchParams.toString()}`}>
            <Download className="size-4" />
            Export to Excel
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 11: Write the export route**

Create `app/admin/(shell)/overall-data/export/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";

import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { buildOverallDataWorkbook } from "@/lib/export/overall-data-workbook";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  // Inline, not requireAdmin(): a route handler that redirects answers a download
  // click with a login page and a 200. Same shape as app/admin/export/route.ts,
  // deliberately — see that file's comment.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const district = request.nextUrl.searchParams.get("district");
  const facts = await fetchSchoolFacts(supabase);
  const active = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  // No row limit: this is the full view the dashboard's truncated panel links to.
  // The denominator narrows with the filter so the sheet's total row cannot claim
  // a division-wide population for a single district's numbers.
  const summary = summarisePerSchool(active, {
    limit: active.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  const book = buildOverallDataWorkbook(summary);
  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="press-link-overall-data-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
```

`summarisePerSchool` with `limit: active.length` returns `hiddenSchools: 0`, so the one
tested function serves both the truncated panel and the complete sheet. Do not add a second
code path for "no limit".

The sheet carries only the per-school table, not the per-event breakdown. That is the spec's
scope for this route ("xlsx of the per-school summary", spec line 130) and it keeps the file
importable into a spreadsheet as a single rectangular range.

- [ ] **Step 12: Write the page**

Four small queries, run together: the school rollup, the district list for the dropdown, one
row per entry carrying its district and event type, and the event-type total for the "N of
16" line. Today that is 332 + 23 + 130 + 0 rows.

Create `app/admin/(shell)/overall-data/page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { PerSchoolTable } from "@/components/dashboard/PerSchoolTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { countByEventType, summarisePerEvent } from "@/lib/dashboard/per-event";
import { summarisePerSchool } from "@/lib/dashboard/per-school";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";

import { OverallDataFilter } from "./OverallDataFilter";

const SHARE = new Intl.NumberFormat("en-PH", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** One entry, reduced to the two columns this page groups by. */
interface EntryTypeRow {
  id: string;
  schools: { district_id: string } | null;
  events: { event_type_id: string; event_types: { name_en: string } | null } | null;
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function OverallDataPage({
  searchParams,
}: {
  // Next 16: a Promise, and awaiting it is what makes this page dynamic — which is
  // also why the client filter needs no Suspense boundary around useSearchParams.
  searchParams: Promise<{ district?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const { district } = await searchParams;

  const [facts, districtResult, entryResult, typeCount] = await Promise.all([
    fetchSchoolFacts(supabase),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    supabase
      .from("entries")
      .select("id, schools(district_id), events(event_type_id, event_types(name_en))")
      .overrideTypes<EntryTypeRow[]>(),
    supabase.from("event_types").select("*", { count: "exact", head: true }),
  ]);

  const districts = districtResult.data ?? [];
  const districtName = district
    ? (districts.find((row) => row.id === district)?.name ?? "Unknown district")
    : null;

  const activeSchools = district
    ? facts.active.filter((school) => school.districtId === district)
    : facts.active;

  const perSchool = summarisePerSchool(activeSchools, {
    limit: activeSchools.length,
    registeredSchools: district
      ? (facts.registeredByDistrict[district] ?? 0)
      : facts.registeredSchools,
  });

  const typeRows = (entryResult.data ?? [])
    .filter((row) => (district ? row.schools?.district_id === district : true))
    .map((row) => ({
      typeId: row.events?.event_type_id ?? "",
      typeName: row.events?.event_types?.name_en ?? "Unknown type",
    }))
    .filter((row) => row.typeId !== "");

  const perEvent = summarisePerEvent(countByEventType(typeRows), {
    // Every contested type gets its own row here — the top-8-plus-Other fold is a
    // donut-legibility concession, and a table has no such limit.
    topN: Number.MAX_SAFE_INTEGER,
    typesTotal: typeCount.count ?? 0,
  });

  const withoutData = perSchool.registeredSchools - perSchool.activeSchools;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Overall Data"
        badge={districtName ?? undefined}
        subtitle={
          districtName
            ? `Every school in ${districtName} that has registered a learner, a coach or an entry, and the events they entered.`
            : "Every school that has registered a learner, a coach or an entry, and the events they entered. Nothing on this page is truncated."
        }
      />

      <OverallDataFilter districts={districts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schools with data</CardTitle>
          <CardDescription>
            {perSchool.activeSchools === 0
              ? "No school in this selection has registered anything yet."
              : `All ${perSchool.activeSchools}, biggest first.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PerSchoolTable summary={perSchool} />
          {withoutData > 0 ? (
            <p className="text-xs text-muted-foreground">
              {withoutData} of the {perSchool.registeredSchools} registered schools have no
              learners, coaches or entries yet, so they have no row above. They are still
              counted in the division total&apos;s denominator.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries by event type</CardTitle>
          <CardDescription>
            {perEvent.typesWithEntries} of {perEvent.typesTotal} event types have at least
            one entry. The dashboard donut shows the top eight of these and folds the rest
            into &ldquo;Other&rdquo;; this table folds nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {perEvent.slices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No entries in this selection yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              {/* No colour swatches in this table, on purpose: summarisePerEvent
                  assigns eight chart tokens by rank and wraps past the eighth, so
                  beyond the donut's top eight a swatch would repeat a hue and
                  imply two types are the same series. The donut's legend is where
                  colour carries meaning; here the numbers do. */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event type</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perEvent.slices.map((slice) => (
                    <TableRow key={slice.key}>
                      <TableCell className="font-medium text-foreground">
                        {slice.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {slice.entries}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {SHARE.format(slice.share)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold text-foreground">Total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {perEvent.totalEntries}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {SHARE.format(perEvent.totalEntries === 0 ? 0 : 1)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

Two things to leave alone:

`topN: Number.MAX_SAFE_INTEGER` is how a table asks `summarisePerEvent` for everything.
`slice(0, topN)` on an array shorter than the limit returns the whole array, so no Other
slice is produced and `otherTypes` is 0 — the same tested function, no second code path.

**A link this page deliberately does not render yet.** The natural destination for the
"schools with no data" paragraph is `/admin/schools`, the full registry including the schools
with nothing on them. That route is still `soon` — Task 19 creates it, and adds the link
here.

- [ ] **Step 13: Clear the nav flag and wire the dashboard's two links**

In `lib/admin/nav.ts`, drop `soon: true` from the Overall Data item only:

```ts
      { label: "Overall Data", href: "/admin/overall-data", icon: "overall" },
```

In `app/admin/(shell)/page.tsx`, give the per-school panel the two links spec §5.2 and the
comp's toolbar ask for. The `action` slot Task 15 reserved is already there:

```tsx
        <Panel
          className="lg:col-span-2"
          title="Registration by school"
          description="Learners, coaches and entries per school, the busiest first."
          action={
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin/overall-data">
                  View all {data.perSchool.activeSchools} schools
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                {/* A route handler, so a plain anchor — next/link would build a
                    workbook on every hover. */}
                <a href="/admin/overall-data/export">Export to Excel</a>
              </Button>
            </div>
          }
        >
          <PerSchoolTable summary={data.perSchool} />
        </Panel>
```

Add `import Link from "next/link";` to that page if Task 15 left it out.

Two deliberate wordings here. The link counts **active** schools, not the 332 registered ones
the spec's draft label used: `/admin/overall-data` lists schools that have data, so "View all
332 schools" would promise 332 rows and deliver twenty-odd. The number the reader can verify
is the one to print. And the export covers every active school rather than the fifteen on
screen — which is what the panel is truncated *for*; `PerSchoolTable`'s own footnote already
tells the reader the screen is the short version.

- [ ] **Step 14: Verify**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run lib/export lib/dashboard
```

Then with `npm run dev` running, signed in as an admin:

1. `/admin/overall-data` lists more schools than the dashboard's fifteen, and its per-school
   footer row matches the dashboard's footer row exactly — same three totals, same
   "N of 332".
2. The per-event table's **Total** equals the number in the middle of the dashboard donut,
   and its row count equals the donut's `typesWithEntries`. Those two panels count the same
   entries by two different routes, so a mismatch is a real bug, not a rounding artefact.
3. Pick a district in the filter. The URL gains `?district=<uuid>`, the heading gains the
   district's name as a badge, **both** tables shrink, and the per-school footer's
   denominator becomes that district's registered count rather than 332.
4. "Export to Excel" downloads `press-link-overall-data-<today>.xlsx`. Open it: the row count
   is the number of schools listed plus one, and the last row reads DIVISION TOTAL with the
   same three numbers as the screen.
5. Export again with a district selected — the file has only that district's schools, and its
   total row's District cell reads "N of M schools" with the district's own denominator.
6. Clear the filter: the URL drops back to `/admin/overall-data` with no query string.
7. The dashboard's per-school panel now shows both buttons. "View all N schools" navigates;
   "Export to Excel" downloads the same file as step 4.
8. Hover the Export button and watch the terminal: **no request is made**. A
   `GET /admin/overall-data/export` appearing on hover means it was rendered through
   `next/link`.
9. Sign out and request `/admin/overall-data/export` directly: JSON
   `{"error":"Not authenticated"}` with status 401, not a redirect to the login page and not
   an empty file.
10. `/admin/export` still downloads the entries workbook unchanged — this task must not have
    touched it.
11. The sidebar's Overall Data item no longer shows a "Soon" pill and highlights as active
    while the page is open.

- [ ] **Step 15: Commit**

```bash
git add lib/dashboard/school-facts.ts lib/dashboard/per-school.ts lib/dashboard/per-school.test.ts lib/dashboard/per-event.ts lib/dashboard/per-event.test.ts lib/export/overall-data-workbook.ts lib/export/overall-data-workbook.test.ts "app/admin/(shell)/overall-data" "app/admin/(shell)/dashboard-data.ts" "app/admin/(shell)/page.tsx" lib/admin/nav.ts
git commit -m "feat(admin): add the overall data page, its district filter and its Excel export"
```

---

### Task 18: Summary of Registration — one school's entry, in full

The dashboard's per-school table answers *how many*. This page answers *which*: for one
school, every event it entered, every learner named in each entry, every coach behind them,
and what its school paper amounts to. It is the sheet a division officer prints when a
school telephones to ask what is on record for them.

Spec line 131 names the page and §5.7 (spec line 363) routes a portal card to it. Neither
dictates its contents, so this task fixes them: a picker when no school is chosen, and the
school's registration sheet when one is.

**Two numbers here look like duplicates of the per-school table's and are not.**
`participants(count)` on `schools` is the school's whole *roster*; this page counts only the
learners who actually appear in an entry. A school with 24 learners on its roster and 18
entered has six sitting out, and that gap is the most useful thing an officer can learn from
this page. So the sheet prints both, as "18 of 24" — never one number pretending to be the
other.

**Files:**
- Create: `lib\dashboard\registration-summary.ts`
- Create: `lib\dashboard\registration-summary.test.ts`
- Create: `app\admin\(shell)\summary\page.tsx`
- Create: `components\dashboard\SummaryPortalCard.tsx`
- Modify: `app/admin/(shell)/dashboard-data.ts` — `DashboardData` gains `schoolOptions`
- Modify: `app/admin/(shell)/page.tsx` — the second portal card becomes this page's
- Modify: `lib/admin/nav.ts` — clear `soon` on the School Summary item
- Test: `lib\dashboard\registration-summary.test.ts`. The page itself has no test, for the
  same reason Task 15's has none: every derived number comes out of the tested module, and a
  test of the queries would be a test of Supabase.

**Interfaces:**
- Consumes: `fetchSchoolFacts` from `@/lib/dashboard/school-facts` (Task 17); `PageHeading`
  (Task 3); `PortalCard`, `PortalAction` (Task 14); `requireAdmin` from `@/app/admin/guard`,
  `ANY` from `@/components/admin/filter-select`, `surnameFirst` from `@/lib/roster/names`,
  `LevelBadge` and `LanguageBadge` from `@/components/entry-badges`, `paperStatus` and
  `PAPER_STATUS_LABEL` from `@/lib/paper/status`, `PaperParticipation` from
  `@/lib/paper/gate`, and `LANGUAGE_LABEL`, `EventCategory`, `EventLevel`, `EventLanguage`
  from `@/lib/events-catalog` — all existing files, unchanged by this task.
- Produces:
  ```ts
  // lib/dashboard/registration-summary.ts
  export interface RegistrationPerson { id: string; name: string; number: number | null }
  export interface RegistrationEntry {
    entryId: string;
    eventId: string;
    eventName: string;
    category: EventCategory;
    level: EventLevel;
    language: EventLanguage;
    sortOrder: number;
    submittedAt: string;
    participants: RegistrationPerson[];
    coaches: RegistrationPerson[];
  }
  export interface RegistrationSummary {
    entries: RegistrationEntry[];
    entryCount: number;
    learnersEntered: number;
    coachesEntered: number;
  }
  export function summariseRegistration(entries: RegistrationEntry[]): RegistrationSummary;

  // app/admin/(shell)/dashboard-data.ts
  export interface SchoolOption { id: string; label: string }
  // DashboardData gains: schoolOptions: SchoolOption[]

  // components/dashboard/SummaryPortalCard.tsx
  export function SummaryPortalCard(props: { schools: SchoolOption[] }): React.JSX.Element;  // client
  ```

**One component this task deliberately does not reuse.** `app/entry/EntriesTable.tsx`
renders almost exactly this data for a school's own user — but it is `"use client"` and
wired to `deleteEntryAction`. An admin page that imported it would ship delete buttons into
a read-only dashboard. The presentation is written fresh here; the one thing genuinely
shared is the name format, `surnameFirst`, so the two surfaces cannot disagree about it.

- [ ] **Step 1: Write the failing test**

Create `lib\dashboard\registration-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { summariseRegistration, type RegistrationEntry } from "./registration-summary";

function person(id: string, number: number | null = null) {
  return { id, name: id, number };
}

function entry(over: Partial<RegistrationEntry> = {}): RegistrationEntry {
  return {
    entryId: "entry-1",
    eventId: "event-1",
    eventName: "News Writing",
    category: "individual",
    level: "secondary",
    language: "english",
    sortOrder: 1,
    submittedAt: "2026-08-01T02:00:00+00:00",
    participants: [person("p1", 101)],
    coaches: [person("c1")],
    ...over,
  };
}

describe("summariseRegistration", () => {
  it("orders by the catalog's sort order, not by submission time", () => {
    const summary = summariseRegistration([
      entry({
        entryId: "b",
        eventName: "Photojournalism",
        sortOrder: 9,
        submittedAt: "2026-07-01T02:00:00+00:00",
      }),
      entry({
        entryId: "a",
        eventName: "News Writing",
        sortOrder: 2,
        submittedAt: "2026-08-01T02:00:00+00:00",
      }),
    ]);
    expect(summary.entries.map((row) => row.eventName)).toEqual([
      "News Writing",
      "Photojournalism",
    ]);
  });

  it("counts a learner entered in two events once", () => {
    const summary = summariseRegistration([
      entry({ entryId: "a", participants: [person("p1", 101), person("p2", 102)] }),
      entry({ entryId: "b", sortOrder: 2, participants: [person("p1", 101)] }),
    ]);
    expect(summary.entryCount).toBe(2);
    expect(summary.learnersEntered).toBe(2);
  });

  it("counts coaches distinctly too", () => {
    const summary = summariseRegistration([
      entry({ entryId: "a", coaches: [person("c1")] }),
      entry({ entryId: "b", sortOrder: 2, coaches: [person("c1"), person("c2")] }),
    ]);
    expect(summary.coachesEntered).toBe(2);
  });

  it("does not reorder its input, and reports zeros for a school with no entries", () => {
    const rows = [entry({ entryId: "b", sortOrder: 9 }), entry({ entryId: "a", sortOrder: 1 })];
    summariseRegistration(rows);
    expect(rows.map((row) => row.entryId)).toEqual(["b", "a"]);

    expect(summariseRegistration([])).toEqual({
      entries: [],
      entryCount: 0,
      learnersEntered: 0,
      coachesEntered: 0,
    });
  });
});
```

The second test is the one that earns this module its existence. `entries.length` counts
entries; summing `participants.length` counts a learner once *per event they compete in*.
Neither is "how many learners are entered", which is what the sheet claims — so the count
that ships is the one with a test proving a repeat learner is counted once.

The fourth test's first half guards a real hazard: the array handed to this function is the
Supabase result the page also reads, and a sort in place would silently reorder it under the
caller.

- [ ] **Step 2: Run the test and watch it fail**

```powershell
npx vitest run lib/dashboard/registration-summary.test.ts
```

Expected: FAIL — `Failed to resolve import "./registration-summary"`. If it fails any other
way, the test file itself is wrong; fix that before writing the module.

- [ ] **Step 3: Write the module**

Create `lib\dashboard\registration-summary.ts`:

```ts
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

/** A learner or a coach as this page prints them: already formatted, never re-derived. */
export interface RegistrationPerson {
  id: string;
  /** Surname-first, from `surnameFirst`. Built on the server so no two rows can disagree. */
  name: string;
  /** `participants.participant_number`, the division-wide learner id. Coaches have none. */
  number: number | null;
}

/** One entry a school has on record, with the people named in it. */
export interface RegistrationEntry {
  entryId: string;
  eventId: string;
  eventName: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  /** `events.sort_order` — the catalog's own ordering, which this module sorts by. */
  sortOrder: number;
  submittedAt: string;
  participants: RegistrationPerson[];
  coaches: RegistrationPerson[];
}

export interface RegistrationSummary {
  /** Catalog order, so the sheet reads the way the events list does. */
  entries: RegistrationEntry[];
  entryCount: number;
  /** Distinct learners named across every entry. A learner in two events counts once. */
  learnersEntered: number;
  /** Distinct coaches, likewise. */
  coachesEntered: number;
}

/**
 * Orders one school's entries and counts the people in them.
 *
 * The counting is why this is a module and not three lines in the page. `entries.length`
 * counts entries, and summing `participants.length` counts a learner once per event they
 * compete in — neither answers "how many learners are entered", which is what the sheet
 * claims. Distinct ids are the only honest answer, and they have a test.
 *
 * Ordering is `events.sort_order`, the catalog's own sequence, with the event name and then
 * the entry id as tie-breaks so the order is total and two renders of the same rows cannot
 * differ. In practice the first key decides it: `entries_school_event_unique`
 * (migration 0005) means one school never holds two entries in one event.
 */
export function summariseRegistration(entries: RegistrationEntry[]): RegistrationSummary {
  const learners = new Set<string>();
  const coaches = new Set<string>();

  for (const entry of entries) {
    for (const person of entry.participants) learners.add(person.id);
    for (const coach of entry.coaches) coaches.add(coach.id);
  }

  return {
    // A copy, not `entries.sort()`: the caller's array is the query result, and a pure
    // function does not reorder its input out from under whoever else reads it.
    entries: [...entries].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.eventName.localeCompare(b.eventName) ||
        a.entryId.localeCompare(b.entryId)
    ),
    entryCount: entries.length,
    learnersEntered: learners.size,
    coachesEntered: coaches.size,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```powershell
npx vitest run lib/dashboard/registration-summary.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit the module**

```bash
git add lib/dashboard/registration-summary.ts lib/dashboard/registration-summary.test.ts
git commit -m "feat(dashboard): summarise one school's registration"
```

- [ ] **Step 6: Write the page**

Two modes in one file, chosen by whether `?school=` is present. With no school, one query
(the same rollup the dashboard runs) renders a picker. With a school, three narrow queries
render its sheet. No mode fetches what the other needs.

Create `app\admin\(shell)\summary\page.tsx`:

```tsx
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { LanguageBadge, LevelBadge } from "@/components/entry-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  summariseRegistration,
  type RegistrationEntry,
} from "@/lib/dashboard/registration-summary";
import { fetchSchoolFacts } from "@/lib/dashboard/school-facts";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import type { PaperParticipation } from "@/lib/paper/gate";
import { PAPER_STATUS_LABEL, paperStatus } from "@/lib/paper/status";
import { surnameFirst } from "@/lib/roster/names";

/**
 * Manila time, explicitly. The division reads its own clock, and a server in another
 * zone must not shift a submission onto the previous day. Same reason
 * `lib/dashboard/activity.ts` pins its formatter.
 */
const DATE_TIME = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

interface SchoolHeadRow {
  id: string;
  name: string;
  school_id_number: string;
  paper_participation: PaperParticipation;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  school_papers: { count: number }[];
}

interface EntryDetailRow {
  id: string;
  submitted_at: string;
  events: {
    id: string;
    name: string;
    category: EventCategory;
    level: EventLevel;
    language: EventLanguage;
    sort_order: number;
  } | null;
  entry_participants: {
    participants: {
      id: string;
      participant_number: number;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
  entry_coaches: {
    coaches: {
      id: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
    } | null;
  }[];
}

interface PaperDetailRow {
  language: EventLanguage;
  paper_name: string;
  adviser_name: string;
  principal_name: string;
  submitted_at: string | null;
}

/** One labelled figure in the "On record" strip. */
function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export default async function AdminSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  // No school chosen: the picker. One query — the same rollup the dashboard reads.
  if (!params.school) {
    const facts = await fetchSchoolFacts(supabase);
    const silent = facts.registeredSchools - facts.active.length;

    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Summary of Registration"
          subtitle="One school's entries, learners and coaches, on one page."
          badge={`${facts.active.length} schools with data`}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pick a school</CardTitle>
            <CardDescription>
              Every school that has registered a learner, a coach or an entry.
              {silent > 0
                ? ` ${silent} more are on the division list with nothing on record yet.`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">Learners</TableHead>
                  <TableHead className="text-right">Coaches</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {facts.active.map((school) => (
                  <TableRow key={school.schoolId}>
                    <TableCell className="font-medium">{school.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {school.districtName || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {school.learners}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{school.coaches}</TableCell>
                    <TableCell className="text-right tabular-nums">{school.entries}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/summary?school=${school.schoolId}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [{ data: school }, { data: rawEntries }, { data: papers }] = await Promise.all([
    supabase
      .from("schools")
      .select(
        "id, name, school_id_number, paper_participation, submission_locked_at, districts(name), participants(count), coaches(count), school_papers(count)"
      )
      .eq("id", params.school)
      .maybeSingle()
      .overrideTypes<SchoolHeadRow>(),
    supabase
      .from("entries")
      .select(
        "id, submitted_at, events(id, name, category, level, language, sort_order), entry_participants(participants(id, participant_number, first_name, middle_name, last_name)), entry_coaches(coaches(id, first_name, middle_name, last_name))"
      )
      .eq("school_id", params.school)
      .overrideTypes<EntryDetailRow[]>(),
    supabase
      .from("school_papers")
      .select("language, paper_name, adviser_name, principal_name, submitted_at")
      .eq("school_id", params.school)
      .order("language")
      .overrideTypes<PaperDetailRow[]>(),
  ]);

  // Covers both ways this can miss: no such school, and a `?school=` that is not a uuid at
  // all — PostgREST rejects that one as 22P02 and returns null data, not a thrown error.
  if (!school) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Summary of Registration"
          subtitle="No school matches that link."
        />
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              The school id in the address is not one this account can read. It may have
              been mistyped, or the school may since have been removed.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-4">
              <Link href="/admin/summary">Back to the school list</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const entries: RegistrationEntry[] = (rawEntries ?? []).flatMap((row) =>
    // An entry whose event row did not come back has nothing to name it. That is a broken
    // foreign key, not a layout decision, so it is dropped rather than printed blank.
    row.events
      ? [
          {
            entryId: row.id,
            eventId: row.events.id,
            eventName: row.events.name,
            category: row.events.category,
            level: row.events.level,
            language: row.events.language,
            sortOrder: row.events.sort_order,
            submittedAt: row.submitted_at,
            participants: row.entry_participants
              .map((link) => link.participants)
              .filter((person): person is NonNullable<typeof person> => person !== null)
              .map((person) => ({
                id: person.id,
                name: surnameFirst(person),
                number: person.participant_number,
              })),
            coaches: row.entry_coaches
              .map((link) => link.coaches)
              .filter((coach): coach is NonNullable<typeof coach> => coach !== null)
              .map((coach) => ({ id: coach.id, name: surnameFirst(coach), number: null })),
          },
        ]
      : []
  );

  const summary = summariseRegistration(entries);
  const rosterLearners = school.participants?.[0]?.count ?? 0;
  const rosterCoaches = school.coaches?.[0]?.count ?? 0;
  const locked = school.submission_locked_at !== null;
  const status = paperStatus({
    participation: school.paper_participation,
    paperCount: school.school_papers?.[0]?.count ?? 0,
    lockedAt: school.submission_locked_at,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Summary of Registration"
        subtitle={school.name}
        badge={school.school_id_number}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/summary">All schools</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">On record</CardTitle>
          <CardDescription>
            {school.districts?.name
              ? `${school.districts.name} district`
              : "No district on file"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Entries"
            value={`${summary.entryCount}`}
            note="One per event — a school cannot enter an event twice"
          />
          {/* "of" here is the roster, not the division. The two counts differ on purpose:
              the left is learners named in an entry, the right is everyone the school has
              registered. The gap is who is sitting out. */}
          <Fact
            label="Learners entered"
            value={`${summary.learnersEntered} of ${rosterLearners}`}
            note="Of the learners on this school's roster"
          />
          <Fact
            label="Coaches entered"
            value={`${summary.coachesEntered} of ${rosterCoaches}`}
            note="Of the coaches on this school's roster"
          />
          <Fact
            label="Registration"
            value={locked ? "Closed" : "Open"}
            note={
              locked && school.submission_locked_at
                ? `Locked ${DATE_TIME.format(new Date(school.submission_locked_at))}`
                : "Still accepting changes"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">School paper</CardTitle>
          <CardDescription>{PAPER_STATUS_LABEL[status]}</CardDescription>
        </CardHeader>
        <CardContent>
          {(papers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing on file. The school paper contest is answered per school on{" "}
              <Link href="/admin/school-papers" className="underline underline-offset-4">
                School Papers
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Language</TableHead>
                  <TableHead>Paper</TableHead>
                  <TableHead>Adviser</TableHead>
                  <TableHead>Principal</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(papers ?? []).map((paper) => (
                  <TableRow key={paper.language}>
                    <TableCell>{LANGUAGE_LABEL[paper.language]}</TableCell>
                    <TableCell className="font-medium">{paper.paper_name}</TableCell>
                    <TableCell>{paper.adviser_name}</TableCell>
                    <TableCell>{paper.principal_name}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {paper.submitted_at
                        ? DATE_TIME.format(new Date(paper.submitted_at))
                        : "Saved, not submitted"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries</CardTitle>
          <CardDescription>
            In the catalog&apos;s order. The number beside a learner is their division-wide
            participant id.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This school has a roster but no entries yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Learners</TableHead>
                  <TableHead>Coaches</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.entries.map((entry) => (
                  <TableRow key={entry.entryId} className="align-top">
                    <TableCell>
                      <p className="font-medium">{entry.eventName}</p>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <LevelBadge level={entry.level} />
                        <LanguageBadge language={entry.language} />
                        <Badge variant="secondary">
                          {entry.category === "group" ? "Group" : "Individual"}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-0.5">
                        {entry.participants.map((person) => (
                          <li key={person.id}>
                            {person.name}
                            {person.number === null ? null : (
                              <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                                #{person.number}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-0.5">
                        {entry.coaches.map((coach) => (
                          <li key={coach.id}>{coach.name}</li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {DATE_TIME.format(new Date(entry.submittedAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

Three things in that file are load-bearing and easy to break:

1. **`.overrideTypes<SchoolHeadRow>()` comes after `.maybeSingle()`, and nothing after it.**
   `maybeSingle()` returns a builder, so the override still applies — but `.order()` or
   `.limit()` placed after it would return a fresh builder and silently drop the type.
2. **`surnameFirst(person)` is passed a variable, not an object literal.** The row carries
   `id` and `participant_number` beyond `NameParts`; TypeScript allows the extra properties
   on a variable and rejects them on a fresh literal. Do not "tidy" it into an inline object.
3. **`maybeSingle()`, not `single()`.** `single()` treats "no rows" as an error, which would
   turn a mistyped link into a thrown page instead of the notice above.

- [ ] **Step 7: Type-check the page**

```powershell
npx tsc --noEmit
```

Expected: clean. Two plausible failures:

- **`Property 'name' does not exist` on the district embed.** A one-to-one embed types as an
  object or `null`; if the generated types disagree, the `.overrideTypes<SchoolHeadRow>()`
  call has been displaced from the end of the chain.
- **`Type 'string' is not assignable to type 'EventLanguage'`** on `paper.language`. The
  `school_papers.language` check constraint is `('english', 'filipino')`, the same union, so
  this only fires if `PaperDetailRow` was mistyped.

- [ ] **Step 8: Add the school list to the fetch layer**

The portal card's select needs every school with data, and the dashboard already fetches
exactly that. Add the option type beside `EventOption` in
`app/admin/(shell)/dashboard-data.ts`:

```ts
export interface SchoolOption {
  id: string;
  label: string;
}
```

Add the field to `DashboardData`, after `perSchool`:

```ts
  schoolOptions: SchoolOption[];
```

And fill it in `loadDashboardData`'s returned object, directly after the `perSchool` entry:

```ts
    // Every school with data, untruncated — the portal card's select is a dropdown, not a
    // panel, so PER_SCHOOL_LIMIT does not apply to it. Already name-ordered: loadSchoolFacts
    // orders its query by name.
    schoolOptions: schools.active.map((school) => ({
      id: school.schoolId,
      label: school.schoolName,
    })),
```

The local variable is `schools`, not `facts` — that is what `Promise.all` destructures
`loadSchoolFacts()` into in this function.

- [ ] **Step 9: Write the Summary portal card**

Like the Registration card, this one holds state because its button's href depends on the
select, so it is a client component. Unlike that card the list is flat: 20-odd schools need
no grouping, and `ANY` means "no school yet", which routes to the picker rather than to a
sheet for nobody.

Create `components\dashboard\SummaryPortalCard.tsx`:

```tsx
"use client";

import { useId, useState } from "react";

// Type-only, so nothing from the server module reaches the client bundle.
import type { SchoolOption } from "@/app/admin/(shell)/dashboard-data";
import { ANY } from "@/components/admin/filter-select";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SummaryPortalCard({ schools }: { schools: SchoolOption[] }) {
  const id = useId();
  const [schoolId, setSchoolId] = useState(ANY);

  return (
    <PortalCard
      title="Summary of Registration"
      description="One school's entries, the learners in each and the coaches behind them, on a single page."
      control={
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            Quick access
          </Label>
          <Select value={schoolId} onValueChange={setSchoolId}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="All schools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All schools</SelectItem>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      actions={[
        {
          label: "Go to portal",
          href: schoolId === ANY ? "/admin/summary" : `/admin/summary?school=${schoolId}`,
        },
      ]}
    />
  );
}
```

`ANY` is `"__any__"`, not `""`, because Radix Select rejects an empty item value. Reuse the
constant; do not invent a second sentinel.

- [ ] **Step 10: Put the card on the dashboard**

Spec line 230 and §5.7 both give the second slot of the 2x2 grid to Summary of Registration.
Task 15 filled that slot with a School Paper card, because `/admin/summary` was still
`soon` and a live button would have shipped a 404. It is not `soon` any more.

In `app/admin/(shell)/page.tsx`, import the new card beside the Registration one:

```tsx
import { SummaryPortalCard } from "@/components/dashboard/SummaryPortalCard";
```

and replace the School Paper card:

```tsx
        <PortalCard
          title="School Paper"
          description="Which schools are joining the school paper contest, how far each has got, and what they have submitted."
          actions={[{ label: "Go to portal", href: "/admin/school-papers" }]}
        />
```

with:

```tsx
        <SummaryPortalCard schools={data.schoolOptions} />
```

**Nothing is lost by that swap, and this is worth being sure of before making it.** School
Papers keeps its permanent sidebar entry under Submissions, the attention list already
surfaces the schools that have not started a paper, and the new summary page links to
`/admin/school-papers` from its own paper card. The dashboard grid stays at four cards, which
is what the comp shows and what spec line 358 says. A fifth card would leave a hole in a
two-column grid to duplicate a link that is one click away in the sidebar.

- [ ] **Step 11: Clear the nav flag**

In `lib/admin/nav.ts`, drop `soon: true` from the School Summary item only:

```ts
      { label: "School Summary", href: "/admin/summary", icon: "summary" },
```

The sidebar label stays "School Summary" while the page title and the portal card read
"Summary of Registration". That is deliberate: the sidebar is a narrow column of short
labels, and the spec's full name is carried where there is room for it. Do not rename the nav
item — `lib/admin/nav.test.ts` asserts on the tree.

- [ ] **Step 12: Type-check, lint, and run the suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean, with `lib/dashboard/registration-summary.test.ts` reporting 4 passed and
no previously-passing test newly failing. The likely lint failure is
`react/no-unescaped-entities` on prose apostrophes — "catalog&apos;s" is already escaped in
the code above; check anything you reworded. `"One school's entries…"` inside the card's
`description` is a JS string, not JSX text, so it does not need escaping.

- [ ] **Step 13: Click through it**

```powershell
npm run dev
```

Signed in as an admin:

1. `/admin/summary` lists the schools that have data, name-ordered, with a count badge and —
   if any registered school has nothing on record — the "N more are on the division list"
   sentence. The numbers in its Learners / Coaches / Entries columns match the same school's
   row on `/admin/overall-data`.
2. Click **Open** on a school with entries. The heading shows the school name and its
   `school_id_number` as the badge.
3. **Cross-check the two learner counts.** "Learners entered" must read `N of M` with
   `M` equal to that school's Learners column on the picker, and `N` less than or equal
   to `M`. `N > M` is a real bug: it means a learner from another school's roster is
   attached to this school's entry.
4. Count the distinct learner names down the Learners column by hand for a school with a
   repeat learner across two events. The hand count must equal `N`. This is the one number
   on the page that no other page shows, so it gets checked by eye once.
5. The Entries table is in catalog order — the same order the events appear in on
   `/admin/entries`, not submission order.
6. Every learner shows a `#number`; no row shows a bare `#`.
7. Open a school with a submitted paper: the School paper card shows its language, name,
   adviser, principal and a Manila-time timestamp. Open one that answered "no" or has not
   answered: the card shows the status line and the "Nothing on file" sentence with a working
   link to `/admin/school-papers`.
8. Open a **locked** school: Registration reads "Closed" with its lock timestamp. An unlocked
   one reads "Open" / "Still accepting changes".
9. Open a school that has a roster but no entries (the picker's `active` list includes
   these — Entries column 0). The page renders its facts and the "roster but no entries yet"
   sentence, not an empty table with headers.
10. Visit `/admin/summary?school=not-a-uuid` and `/admin/summary?school=` followed by a
    random uuid. Both show the "No school matches that link" card with a working way back —
    neither throws, and neither renders a blank sheet.
11. On `/admin`, the second portal card now reads **Summary of Registration**, its select
    lists every school with data, "Go to portal" with nothing selected lands on the picker,
    and with a school selected lands on that school's sheet.
12. The sidebar's School Summary item no longer shows a "Soon" pill and highlights as active
    while the page is open.
13. `/admin/school-papers` still works and still shows its unlock button — this task must not
    have touched it.

- [ ] **Step 14: Commit**

```bash
git add "app/admin/(shell)/summary" "app/admin/(shell)/dashboard-data.ts" "app/admin/(shell)/page.tsx" components/dashboard/SummaryPortalCard.tsx lib/admin/nav.ts
git commit -m "feat(admin): add the per-school Summary of Registration page"
```

---

### Task 19: Schools — the full registry, silent schools included

`/admin/overall-data` lists the schools that have *data*. This page lists them **all** — every
school on the division roll, including the ones that have registered nothing. That difference
is the whole point of the page: the dashboard can tell an officer that six schools built a
roster and then submitted nothing, but only this page can tell them *which six*.

It is also the destination two earlier tasks deliberately left dangling: the attention row
"Schools with learners but no entry" (Task 11, `href: null`) and the overall-data page's
"schools with no data" sentence (Task 17, unlinked). This task fills both.

**The one number that must not drift.** `lib/dashboard/attention.test.ts` has a test called
*"points each item at the filter that reproduces its count"*. Honouring it means this page's
`?status=learners-no-entry` filter has to select exactly the set
`schoolsWithLearnersButNoEntry` counts — `learners > 0 && entries === 0`, not
`learners > 0 && coaches > 0 && entries === 0`, and not "no data at all". So the predicate
lives in a tested module with the count's definition quoted beside it, rather than inline in
a page nobody re-reads.

**Files:**
- Create: `lib\dashboard\school-registry.ts`
- Create: `lib\dashboard\school-registry.test.ts`
- Create: `app\admin\(shell)\schools\page.tsx`
- Create: `app\admin\(shell)\schools\SchoolRegistryFilter.tsx`
- Modify: `lib/dashboard/attention.ts` — the `schools-no-entry` href stops being `null`
- Modify: `lib/dashboard/attention.test.ts` — the href assertion follows it
- Modify: `app/admin/(shell)/overall-data/page.tsx` — link the "no data" sentence
- Modify: `lib/admin/nav.ts` — clear `soon` on the Schools item
- Test: `lib\dashboard\school-registry.test.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/app/admin/guard`; `PageHeading` (Task 3); `ANY` and
  `FilterSelect` from `@/components/admin/filter-select` (existing); the shadcn `Badge`,
  `Button`, `Card`, `Table` primitives.
- Produces:
  ```ts
  // lib/dashboard/school-registry.ts
  export type SchoolStatus = "all" | "learners-no-entry" | "no-data" | "entered" | "locked";
  export const SCHOOL_STATUS_LABEL: Record<SchoolStatus, string>;
  export function isSchoolStatus(value: string | undefined): value is SchoolStatus;
  export interface RegistryRow {
    schoolId: string;
    schoolName: string;
    schoolIdNumber: string;
    districtId: string;
    districtName: string;
    learners: number;
    coaches: number;
    entries: number;
    lockedAt: string | null;
  }
  export interface RegistrySummary {
    rows: RegistryRow[];
    shown: number;
    registered: number;
    totals: { learners: number; coaches: number; entries: number };
  }
  export function summariseRegistry(
    rows: RegistryRow[],
    options: { status: SchoolStatus; districtId: string | null }
  ): RegistrySummary;
  ```

**Six columns, and why there is no seventh.** School (with its `school_id_number` beneath),
District, Learners, Coaches, Entries, Status. No paper column: `paperStatus` needs
`paper_participation` and a paper count, `/admin/school-papers` already presents both with
the unlock control beside them, and a seventh column at 332 rows costs more than a duplicated
link is worth. The row's action goes to Task 18's summary sheet instead, which makes this page
the index into it.

- [ ] **Step 1: Write the failing test**

Create `lib\dashboard\school-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isSchoolStatus, summariseRegistry, type RegistryRow } from "./school-registry";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    schoolId: "s1",
    schoolName: "Alabel National High School",
    schoolIdNumber: "300001",
    districtId: "d1",
    districtName: "Alabel",
    learners: 12,
    coaches: 3,
    entries: 9,
    lockedAt: null,
    ...over,
  };
}

const ALL = [
  row({ schoolId: "entered", learners: 12, coaches: 3, entries: 9 }),
  row({ schoolId: "roster-only", learners: 8, coaches: 2, entries: 0 }),
  row({ schoolId: "coach-only", learners: 0, coaches: 1, entries: 0 }),
  row({ schoolId: "silent", learners: 0, coaches: 0, entries: 0 }),
  row({ schoolId: "locked", entries: 4, lockedAt: "2026-08-10T02:00:00+00:00" }),
];

describe("summariseRegistry", () => {
  it("shows every school when nothing is filtered", () => {
    const summary = summariseRegistry(ALL, { status: "all", districtId: null });
    expect(summary.shown).toBe(5);
    expect(summary.registered).toBe(5);
  });

  it("selects learners-no-entry with the same predicate the attention count uses", () => {
    // schoolsWithLearnersButNoEntry is `learners > 0 && entries === 0`. "coach-only" has
    // no learners, so it is NOT in this set — and if this test ever goes green with it
    // included, the dashboard row will link to a longer list than its own badge claims.
    const summary = summariseRegistry(ALL, {
      status: "learners-no-entry",
      districtId: null,
    });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["roster-only"]);
  });

  it("selects no-data as nothing at all on record", () => {
    const summary = summariseRegistry(ALL, { status: "no-data", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["silent"]);
  });

  it("totals the rows it shows, not the rows it hides", () => {
    const summary = summariseRegistry(ALL, { status: "entered", districtId: null });
    expect(summary.rows.map((r) => r.schoolId)).toEqual(["entered", "locked"]);
    expect(summary.totals).toEqual({ learners: 24, coaches: 6, entries: 13 });
  });

  it("keeps registered as the district's total, so the footer reads N of M", () => {
    const mixed = [
      row({ schoolId: "a", districtId: "d1", entries: 2 }),
      row({ schoolId: "b", districtId: "d1", learners: 5, entries: 0 }),
      row({ schoolId: "c", districtId: "d2", entries: 7 }),
    ];
    const summary = summariseRegistry(mixed, {
      status: "learners-no-entry",
      districtId: "d1",
    });
    expect(summary.shown).toBe(1);
    // Two schools in d1, one of them matching — not 1 of 3, and not 1 of 1.
    expect(summary.registered).toBe(2);
  });

  it("leaves the query's name order alone", () => {
    const rows = [row({ schoolId: "z", schoolName: "Zamora" }), row({ schoolId: "a", schoolName: "Alabel" })];
    const summary = summariseRegistry(rows, { status: "all", districtId: null });
    expect(summary.rows.map((r) => r.schoolName)).toEqual(["Zamora", "Alabel"]);
  });
});

describe("isSchoolStatus", () => {
  it("accepts the five real values", () => {
    for (const value of ["all", "learners-no-entry", "no-data", "entered", "locked"]) {
      expect(isSchoolStatus(value)).toBe(true);
    }
  });

  it("rejects junk and undefined, so a bad URL falls back to all", () => {
    expect(isSchoolStatus("locked;drop")).toBe(false);
    expect(isSchoolStatus(undefined)).toBe(false);
  });
});
```

The fifth test is the subtle one. A filtered table needs a filtered denominator — the same
reasoning that put `registeredByDistrict` in Task 17 — but the *status* filter must not move
it, or the footer stops answering "how much of the district is this?" and starts answering
"how many rows are on screen?", which the table already shows.

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run lib/dashboard/school-registry.test.ts
```

Expected: FAIL — `Failed to resolve import "./school-registry"`.

- [ ] **Step 3: Write the module**

Create `lib\dashboard\school-registry.ts`:

```ts
/**
 * The five ways an officer asks "which schools?". Kept as a closed union rather than a
 * free-text query param so a mistyped URL cannot produce a table nobody can explain.
 */
export type SchoolStatus = "all" | "learners-no-entry" | "no-data" | "entered" | "locked";

const STATUSES: SchoolStatus[] = ["all", "learners-no-entry", "no-data", "entered", "locked"];

export const SCHOOL_STATUS_LABEL: Record<SchoolStatus, string> = {
  all: "All schools",
  "learners-no-entry": "Has learners, no entry",
  "no-data": "Nothing on record",
  entered: "Has entries",
  locked: "Submission locked",
};

export function isSchoolStatus(value: string | undefined): value is SchoolStatus {
  return value !== undefined && (STATUSES as string[]).includes(value);
}

/** One school as the registry table prints it. */
export interface RegistryRow {
  schoolId: string;
  schoolName: string;
  /** `schools.school_id_number` — the division's own identifier, unique and text. */
  schoolIdNumber: string;
  districtId: string;
  districtName: string;
  learners: number;
  coaches: number;
  entries: number;
  lockedAt: string | null;
}

export interface RegistrySummary {
  rows: RegistryRow[];
  /** Rows after both filters — what the table shows. */
  shown: number;
  /** Rows after the district filter only — the honest denominator for "N of M". */
  registered: number;
  /** Column sums over the shown rows. */
  totals: { learners: number; coaches: number; entries: number };
}

function matches(row: RegistryRow, status: SchoolStatus): boolean {
  switch (status) {
    case "all":
      return true;
    // Identical to `schoolsWithLearnersButNoEntry` in lib/dashboard/school-facts.ts:
    // `rows.filter((row) => row.learners > 0 && row.entries === 0)`. The dashboard's
    // attention row links here with this status, and its badge is that count — so the
    // two predicates are one predicate or the page contradicts the dashboard.
    case "learners-no-entry":
      return row.learners > 0 && row.entries === 0;
    case "no-data":
      return row.learners === 0 && row.coaches === 0 && row.entries === 0;
    case "entered":
      return row.entries > 0;
    case "locked":
      return row.lockedAt !== null;
  }
}

/**
 * Filters the registry and sums what survives.
 *
 * The two filters are deliberately asymmetric. District narrows the *population*, so it
 * moves `registered`; status narrows the *view*, so it does not. That is what lets the
 * footer say "6 of 18 schools in Alabel" — a sentence neither number alone can make.
 *
 * Order is never touched: the query orders by name, and a module that re-sorted would give
 * this page a different sequence from every other school list in the admin area.
 */
export function summariseRegistry(
  rows: RegistryRow[],
  options: { status: SchoolStatus; districtId: string | null }
): RegistrySummary {
  const inDistrict = options.districtId
    ? rows.filter((row) => row.districtId === options.districtId)
    : rows;

  const shown = inDistrict.filter((row) => matches(row, options.status));

  return {
    rows: shown,
    shown: shown.length,
    registered: inDistrict.length,
    totals: {
      learners: shown.reduce((sum, row) => sum + row.learners, 0),
      coaches: shown.reduce((sum, row) => sum + row.coaches, 0),
      entries: shown.reduce((sum, row) => sum + row.entries, 0),
    },
  };
}
```

The `switch` has no `default`. That is on purpose: with the union as the parameter type,
TypeScript proves the five cases are exhaustive, and adding a sixth status later fails to
compile until this function handles it. A `default: return true` would silently show
everything instead.

- [ ] **Step 4: Run it to verify it passes**

```powershell
npx vitest run lib/dashboard/school-registry.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit the module**

```bash
git add lib/dashboard/school-registry.ts lib/dashboard/school-registry.test.ts
git commit -m "feat(dashboard): filter and total the school registry"
```

- [ ] **Step 6: Write the filter bar**

Same shape as `OverallDataFilter` — two dropdowns wired to the URL, a clear button, no
export. Reusing `FilterSelect` keeps every admin filter bar looking like the same control.

Create `app\admin\(shell)\schools\SchoolRegistryFilter.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SCHOOL_STATUS_LABEL, type SchoolStatus } from "@/lib/dashboard/school-registry";

/** "all" is the placeholder, so it is not offered again as an item. */
const STATUS_OPTIONS: SchoolStatus[] = ["learners-no-entry", "no-data", "entered", "locked"];

export function SchoolRegistryFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const district = searchParams.get("district");
  const status = searchParams.get("status");

  function replace(key: "district" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/schools?${qs}` : "/admin/schools");
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <FilterSelect
            label="District"
            value={district ?? ANY}
            onChange={(value) => replace("district", value)}
            placeholder="All districts"
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>

        <div className="min-w-56">
          <FilterSelect
            label="Status"
            value={status ?? ANY}
            onChange={(value) => replace("status", value)}
            placeholder={SCHOOL_STATUS_LABEL.all}
            options={STATUS_OPTIONS.map((value) => ({
              value,
              label: SCHOOL_STATUS_LABEL[value],
            }))}
          />
        </div>

        {district || status ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/schools")}
          >
            <X className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

**Why this page has no export button.** `/admin/overall-data/export` already ships the same
six columns for every school that has data, filtered by the same district param. The rows
this page adds are the ones whose counts are all zero — a workbook that differed only by rows
saying nothing. An officer who needs "the schools that have not started" wants the filtered
screen, and that prints.

- [ ] **Step 7: Write the page**

Create `app\admin\(shell)\schools\page.tsx`:

```tsx
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  isSchoolStatus,
  summariseRegistry,
  SCHOOL_STATUS_LABEL,
  type RegistryRow,
} from "@/lib/dashboard/school-registry";

import { SchoolRegistryFilter } from "./SchoolRegistryFilter";

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

interface RegistrySchoolRow {
  id: string;
  name: string;
  school_id_number: string;
  district_id: string;
  submission_locked_at: string | null;
  districts: { name: string } | null;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function AdminSchoolsPage({
  searchParams,
}: {
  // Next 16: a Promise. Awaiting it makes the page dynamic, which is also why the client
  // filter's useSearchParams needs no Suspense boundary — same as /admin/overall-data.
  searchParams: Promise<{ district?: string; status?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  const [schoolResult, districtResult] = await Promise.all([
    supabase
      .from("schools")
      .select(
        "id, name, school_id_number, district_id, submission_locked_at, districts(name), participants(count), coaches(count), entries(count)"
      )
      .order("name")
      .overrideTypes<RegistrySchoolRow[]>(),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
  ]);

  const districts = districtResult.data ?? [];

  const rows: RegistryRow[] = (schoolResult.data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: row.school_id_number,
    districtId: row.district_id,
    districtName: row.districts?.name ?? "",
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    lockedAt: row.submission_locked_at,
  }));

  // A junk ?status= falls back to "all" rather than showing an empty table.
  const status = isSchoolStatus(params.status) ? params.status : "all";
  const districtId = params.district ?? null;
  const summary = summariseRegistry(rows, { status, districtId });

  const districtName = districtId
    ? (districts.find((row) => row.id === districtId)?.name ?? "Unknown district")
    : null;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Schools"
        badge={districtName ?? undefined}
        subtitle={
          <>
            {summary.shown} of {summary.registered}{" "}
            {districtName ? `schools in ${districtName}` : "schools on the division roll"}
            {status === "all" ? "" : ` — ${SCHOOL_STATUS_LABEL[status].toLowerCase()}`}.
          </>
        }
      />

      <SchoolRegistryFilter districts={districts} />

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>District</TableHead>
                <TableHead className="text-right">Learners</TableHead>
                <TableHead className="text-right">Coaches</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No school matches this filter.
                  </TableCell>
                </TableRow>
              ) : (
                summary.rows.map((row) => (
                  <TableRow key={row.schoolId}>
                    <TableCell>
                      <p className="font-medium">{row.schoolName}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {row.schoolIdNumber}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.districtName || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.learners}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.coaches}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                    <TableCell>
                      {/* Three states, in the order an officer cares about them: nothing
                          started, submission closed, still open. */}
                      {row.learners === 0 && row.coaches === 0 && row.entries === 0 ? (
                        <Badge variant="outline">Nothing on record</Badge>
                      ) : row.lockedAt ? (
                        <Badge variant="secondary">
                          Locked {DATE.format(new Date(row.lockedAt))}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Open</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/summary?school=${row.schoolId}`}>Summary</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {summary.rows.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>
                    {summary.shown} {summary.shown === 1 ? "school" : "schools"} shown
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.learners}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.coaches}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {summary.totals.entries}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

If `TableFooter` is not exported from `components/ui/table.tsx` in this install of shadcn,
do not add it — replace the `<TableFooter>` block with a `<p className="mt-4 text-sm
text-muted-foreground">` carrying the same three totals as a sentence. The totals matter;
the element they sit in does not.

- [ ] **Step 8: Point the attention row at its filter**

In `lib/dashboard/attention.ts`, the `schools-no-entry` item loses its `null` and the comment
that explained it:

```ts
    {
      key: "schools-no-entry",
      label: "Schools with learners but no entry",
      detail: "A roster was built and then nothing was submitted.",
      count: input.schoolsWithLearnersButNoEntry,
      href: "/admin/schools?status=learners-no-entry",
      tone: "warn",
    },
```

And in `lib/dashboard/attention.test.ts`, the href assertion follows:

```ts
      "schools-no-entry": "/admin/schools?status=learners-no-entry",
```

That test is named *"points each item at the filter that reproduces its count"*, and it now
means it literally: `summariseRegistry`'s `learners-no-entry` branch and
`schoolsWithLearnersButNoEntry` are the same predicate, each with its own test.

- [ ] **Step 9: Link the overall-data sentence**

Task 17 left the "schools with no data" paragraph unlinked because this route did not exist.
In `app/admin/(shell)/overall-data/page.tsx`, find the paragraph that reads `withoutData` and
wrap the count in a link to the filter that lists them:

```tsx
              <Link
                href={`/admin/schools?status=no-data${district ? `&district=${district}` : ""}`}
                className="underline underline-offset-4"
              >
                {withoutData} more
              </Link>
```

Carry the district through, so following the link from a filtered table lands on a filtered
list rather than silently widening to all 23 districts. Add `import Link from "next/link";`
at the top of that file if it is not already there — Task 17's version may not import it.

- [ ] **Step 10: Clear the nav flag**

In `lib/admin/nav.ts`, drop `soon: true` from the Schools item only:

```ts
      { label: "Schools", href: "/admin/schools", icon: "schools" },
```

Districts and Events stay `soon: true` — Tasks 20 and 21 clear those.

- [ ] **Step 11: Type-check, lint, and run the suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean. `lib/dashboard/school-registry.test.ts` reports 8 passed and
`lib/dashboard/attention.test.ts` still passes with its edited href. If attention still fails,
the string in the test and the string in the module differ — they must match character for
character, `?status=learners-no-entry` included.

- [ ] **Step 12: Click through it**

```powershell
npm run dev
```

Signed in as an admin:

1. `/admin/schools` lists **every** school, name-ordered — including rows whose Learners,
   Coaches and Entries are all 0 and whose Status reads "Nothing on record". The subtitle
   reads "332 of 332 schools on the division roll." (or whatever the real total is), and the
   footer's three totals equal the division totals on `/admin/overall-data`.
2. **The number that matters.** On `/admin`, note the badge on "Schools with learners but no
   entry", then click the row. It lands on `/admin/schools?status=learners-no-entry`, and the
   subtitle's first number equals that badge exactly. If it does not, the two predicates have
   drifted — fix the module, not the page.
3. Pick a district. The subtitle becomes "N of M schools in <district>", `M` is that
   district's school count and not 332, and the totals shrink to match the visible rows.
4. Combine both filters. Clearing with the X returns to the unfiltered list and the URL
   goes back to bare `/admin/schools`.
5. Choose **Nothing on record**: every row shows three zeroes. Choose **Has entries**: no
   row shows 0 in Entries. Choose **Submission locked**: every row carries a Locked badge
   with a Manila-time date.
6. Visit `/admin/schools?status=nonsense`. The full list renders, unfiltered — no crash, no
   empty table.
7. Click **Summary** on any row: it opens that school's sheet from Task 18, with the school
   name in the heading.
8. On `/admin/overall-data`, the "N more" in the schools-with-no-data sentence is now a link.
   Follow it with a district selected — the destination keeps that district.
9. The sidebar's Schools item no longer shows a "Soon" pill and highlights while the page is
   open. Districts and Events still show theirs.

- [ ] **Step 13: Commit**

```bash
git add "app/admin/(shell)/schools" "app/admin/(shell)/overall-data/page.tsx" lib/dashboard/attention.ts lib/dashboard/attention.test.ts lib/admin/nav.ts
git commit -m "feat(admin): add the school registry with district and status filters"
```

---

### Task 20: Districts — 23 rollups, read-only

Spec line 133: *"23 districts with rollups, read-only"*. One row per district, each carrying
how many schools it holds, how many of those have anything on record, how many have entered,
and the three column totals. It is the level between the division KPI ("10 of 23 districts")
and the per-school table — the view that answers *which ten*.

**A row count that is allowed to exceed a KPI.** `SchoolFacts.districtsRegistered` counts
distinct district ids **among schools**, so a district holding no school at all is not in it.
This page reads the `districts` table instead, so such a district still gets a row — of
zeroes. That is the correct behaviour for a reference page: a district that exists and is
empty is a fact worth showing, and hiding it would make the page disagree with the filter
dropdown on `/admin/schools`, which is also built from the `districts` table.

**Files:**
- Create: `lib\dashboard\per-district.ts`
- Create: `lib\dashboard\per-district.test.ts`
- Create: `app\admin\(shell)\districts\page.tsx`
- Modify: `lib/admin/nav.ts` — clear `soon` on the Districts item
- Test: `lib\dashboard\per-district.test.ts`

**Interfaces:**
- Consumes: `RegistryRow` from `@/lib/dashboard/school-registry` (Task 19) — the same row
  shape, from the same query, so the two pages cannot disagree about a school's counts;
  `requireAdmin`, `PageHeading`, and the shadcn `Card` / `Table` / `Button` primitives.
- Produces:
  ```ts
  // lib/dashboard/per-district.ts
  export interface DistrictRollup {
    districtId: string;
    districtName: string;
    schools: number;
    schoolsWithData: number;
    schoolsWithEntries: number;
    learners: number;
    coaches: number;
    entries: number;
  }
  export interface PerDistrictSummary {
    rows: DistrictRollup[];
    districtsWithEntries: number;
    totals: {
      schools: number;
      schoolsWithData: number;
      schoolsWithEntries: number;
      learners: number;
      coaches: number;
      entries: number;
    };
  }
  export function summarisePerDistrict(
    districts: { id: string; name: string }[],
    rows: RegistryRow[]
  ): PerDistrictSummary;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib\dashboard\per-district.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { summarisePerDistrict } from "./per-district";
import type { RegistryRow } from "./school-registry";

function school(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    schoolId: "s1",
    schoolName: "A School",
    schoolIdNumber: "300001",
    districtId: "d1",
    districtName: "Alabel",
    learners: 0,
    coaches: 0,
    entries: 0,
    lockedAt: null,
    ...over,
  };
}

const DISTRICTS = [
  { id: "d1", name: "Alabel" },
  { id: "d2", name: "Malapatan" },
  { id: "d3", name: "Maasim" },
];

const SCHOOLS = [
  school({ schoolId: "a", districtId: "d1", learners: 12, coaches: 3, entries: 9 }),
  school({ schoolId: "b", districtId: "d1", learners: 8, coaches: 2, entries: 0 }),
  school({ schoolId: "c", districtId: "d1" }),
  school({ schoolId: "d", districtId: "d2", learners: 4, coaches: 1, entries: 2 }),
];

describe("summarisePerDistrict", () => {
  it("gives a district with no schools a row of zeroes rather than no row", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows).toHaveLength(3);

    const maasim = summary.rows.find((row) => row.districtId === "d3");
    expect(maasim).toEqual({
      districtId: "d3",
      districtName: "Maasim",
      schools: 0,
      schoolsWithData: 0,
      schoolsWithEntries: 0,
      learners: 0,
      coaches: 0,
      entries: 0,
    });
  });

  it("rolls a district's schools up into one row", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows[0]).toEqual({
      districtId: "d1",
      districtName: "Alabel",
      schools: 3,
      // "c" has nothing at all, so it counts as a school and nothing else.
      schoolsWithData: 2,
      schoolsWithEntries: 1,
      learners: 20,
      coaches: 5,
      entries: 9,
    });
  });

  it("counts districts with entries the way the dashboard KPI does", () => {
    // SchoolFacts.districtsWithEntries is the distinct district ids of schools with
    // entries > 0. Two districts here hold an entered school; the third does not.
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.districtsWithEntries).toBe(2);
  });

  it("totals every column across the districts it shows", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.totals).toEqual({
      schools: 4,
      schoolsWithData: 3,
      schoolsWithEntries: 2,
      learners: 24,
      coaches: 6,
      entries: 11,
    });
  });

  it("keeps the districts list's order, which the query has already sorted by name", () => {
    const summary = summarisePerDistrict(DISTRICTS, SCHOOLS);
    expect(summary.rows.map((row) => row.districtName)).toEqual([
      "Alabel",
      "Malapatan",
      "Maasim",
    ]);
  });

  it("ignores a school whose district is not in the list", () => {
    // schools.district_id is `not null references districts(id)`, so this cannot happen
    // in production. The assertion is here so that if it ever does, the page shows a
    // smaller number rather than crashing on an undefined rollup.
    const summary = summarisePerDistrict(DISTRICTS, [
      ...SCHOOLS,
      school({ schoolId: "orphan", districtId: "gone", entries: 99 }),
    ]);
    expect(summary.totals.entries).toBe(11);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run lib/dashboard/per-district.test.ts
```

Expected: FAIL — `Failed to resolve import "./per-district"`.

- [ ] **Step 3: Write the module**

Create `lib\dashboard\per-district.ts`:

```ts
import type { RegistryRow } from "./school-registry";

/** One district's schools, added up. */
export interface DistrictRollup {
  districtId: string;
  districtName: string;
  /** Schools on the division roll in this district, whether or not they have data. */
  schools: number;
  /** Schools with at least one learner, coach or entry — the same test `active` uses. */
  schoolsWithData: number;
  schoolsWithEntries: number;
  learners: number;
  coaches: number;
  entries: number;
}

export interface PerDistrictSummary {
  rows: DistrictRollup[];
  /**
   * Districts holding at least one school with an entry. Equal to
   * `SchoolFacts.districtsWithEntries`, which is the dashboard KPI's numerator — the two
   * are computed from the same query, and the test above pins them together.
   */
  districtsWithEntries: number;
  totals: {
    schools: number;
    schoolsWithData: number;
    schoolsWithEntries: number;
    learners: number;
    coaches: number;
    entries: number;
  };
}

/**
 * Folds school rows into one rollup per district.
 *
 * `districts` drives the output, not `rows`: a district with no schools must still get a
 * row, and the order must match the `districts` query's name ordering so this table and the
 * filter dropdown on /admin/schools read in the same sequence.
 *
 * A school whose district id is not in `districts` is skipped. The foreign key makes that
 * impossible in production; skipping rather than creating a phantom district row means a
 * broken key shows up as a total that is too small, which is visible, instead of a row
 * labelled "undefined", which is not.
 */
export function summarisePerDistrict(
  districts: { id: string; name: string }[],
  rows: RegistryRow[]
): PerDistrictSummary {
  const byId = new Map<string, DistrictRollup>(
    districts.map((district) => [
      district.id,
      {
        districtId: district.id,
        districtName: district.name,
        schools: 0,
        schoolsWithData: 0,
        schoolsWithEntries: 0,
        learners: 0,
        coaches: 0,
        entries: 0,
      },
    ])
  );

  for (const row of rows) {
    const rollup = byId.get(row.districtId);
    if (!rollup) continue;

    rollup.schools += 1;
    if (row.learners > 0 || row.coaches > 0 || row.entries > 0) rollup.schoolsWithData += 1;
    if (row.entries > 0) rollup.schoolsWithEntries += 1;
    rollup.learners += row.learners;
    rollup.coaches += row.coaches;
    rollup.entries += row.entries;
  }

  const result = [...byId.values()];

  return {
    rows: result,
    districtsWithEntries: result.filter((row) => row.schoolsWithEntries > 0).length,
    totals: {
      schools: result.reduce((sum, row) => sum + row.schools, 0),
      schoolsWithData: result.reduce((sum, row) => sum + row.schoolsWithData, 0),
      schoolsWithEntries: result.reduce((sum, row) => sum + row.schoolsWithEntries, 0),
      learners: result.reduce((sum, row) => sum + row.learners, 0),
      coaches: result.reduce((sum, row) => sum + row.coaches, 0),
      entries: result.reduce((sum, row) => sum + row.entries, 0),
    },
  };
}
```

A `Map` built from `districts` and then mutated in one pass is deliberate over grouping the
rows and joining afterwards: the map's keys *are* the output rows, so an empty district cannot
fall out of the result by construction rather than by a later merge step remembering to put it
back.

- [ ] **Step 4: Run it to verify it passes**

```powershell
npx vitest run lib/dashboard/per-district.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit the module**

```bash
git add lib/dashboard/per-district.ts lib/dashboard/per-district.test.ts
git commit -m "feat(dashboard): roll school counts up by district"
```

- [ ] **Step 6: Write the page**

No filter bar — 23 rows need no narrowing, and the district *is* the row. Each row links into
`/admin/schools?district=…`, which is the drill-down.

Create `app\admin\(shell)\districts\page.tsx`:

```tsx
import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { summarisePerDistrict } from "@/lib/dashboard/per-district";
import type { RegistryRow } from "@/lib/dashboard/school-registry";

/** The same select the registry runs, minus the columns a rollup cannot use. */
interface DistrictSchoolRow {
  id: string;
  name: string;
  district_id: string;
  participants: { count: number }[];
  coaches: { count: number }[];
  entries: { count: number }[];
}

interface DistrictRow {
  id: string;
  name: string;
}

export default async function AdminDistrictsPage() {
  const { supabase } = await requireAdmin();

  const [districtResult, schoolResult] = await Promise.all([
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    supabase
      .from("schools")
      .select("id, name, district_id, participants(count), coaches(count), entries(count)")
      .overrideTypes<DistrictSchoolRow[]>(),
  ]);

  // RegistryRow's other three fields are not read by summarisePerDistrict, but filling them
  // honestly beats casting: the type is shared with /admin/schools, and a lie here would be
  // a lie there the first time someone reuses this mapping.
  const rows: RegistryRow[] = (schoolResult.data ?? []).map((row) => ({
    schoolId: row.id,
    schoolName: row.name,
    schoolIdNumber: "",
    districtId: row.district_id,
    districtName: "",
    learners: row.participants?.[0]?.count ?? 0,
    coaches: row.coaches?.[0]?.count ?? 0,
    entries: row.entries?.[0]?.count ?? 0,
    lockedAt: null,
  }));

  const summary = summarisePerDistrict(districtResult.data ?? [], rows);

  // Name order is what the table shows, so the leader is named here instead of re-sorting
  // the table — two orderings of the same rows is how two readings of "the top district"
  // get into one page.
  const leader = [...summary.rows].sort(
    (a, b) => b.entries - a.entries || a.districtName.localeCompare(b.districtName)
  )[0];

  return (
    <div className="space-y-6">
      <PageHeading
        title="Districts"
        badge={`${summary.districtsWithEntries} of ${summary.rows.length} entered`}
        subtitle={
          leader && leader.entries > 0
            ? `${summary.rows.length} districts on the division roll. ${leader.districtName} leads with ${leader.entries} entries.`
            : `${summary.rows.length} districts on the division roll. No entries yet.`
        }
      />

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>District</TableHead>
                <TableHead className="text-right">Schools</TableHead>
                <TableHead className="text-right">With data</TableHead>
                <TableHead className="text-right">Entered</TableHead>
                <TableHead className="text-right">Learners</TableHead>
                <TableHead className="text-right">Coaches</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.rows.map((row) => (
                <TableRow key={row.districtId}>
                  <TableCell className="font-medium">{row.districtName}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.schools}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.schoolsWithData}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.schoolsWithEntries}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.learners}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.coaches}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.entries}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/admin/schools?district=${row.districtId}`}>Schools</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Division</TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.schools}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.schoolsWithData}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.schoolsWithEntries}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.learners}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.coaches}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {summary.totals.entries}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

`schoolIdNumber: ""`, `districtName: ""` and `lockedAt: null` are the three fields
`summarisePerDistrict` never reads. If that feels wasteful, the alternative is a narrower
input type for this module — but then the two pages stop sharing `RegistryRow`, and the
guarantee that both compute a school's counts identically goes with it. Three empty strings
are cheaper than that.

- [ ] **Step 7: Clear the nav flag**

In `lib/admin/nav.ts`, drop `soon: true` from the Districts item only:

```ts
      { label: "Districts", href: "/admin/districts", icon: "districts" },
```

- [ ] **Step 8: Type-check, lint, and run the suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean, `lib/dashboard/per-district.test.ts` reporting 6 passed.

- [ ] **Step 9: Click through it**

```powershell
npm run dev
```

Signed in as an admin:

1. `/admin/districts` shows one row per district, name-ordered, 23 rows against production.
2. **The badge must match the dashboard.** Its "N of 23 entered" is the same N as the
   Districts KPI on `/admin`. If they differ, `summarisePerDistrict` and
   `SchoolFacts.districtsWithEntries` have drifted — they read the same query, so the cause
   is in one of the two folds, not in the data.
3. The Division footer row's Schools total equals the total on `/admin/schools` (332 in
   production), and its Learners / Coaches / Entries equal the division totals on
   `/admin/overall-data`.
4. Every row's **With data** is less than or equal to its Schools, and **Entered** is less
   than or equal to **With data**. A row breaking either is a real bug.
5. A district with no schools, if production has one, shows a row of zeroes — not a missing
   row, and not `undefined` anywhere.
6. Click **Schools** on any row: `/admin/schools` opens with that district selected in the
   filter, and its subtitle's M equals this row's Schools count.
7. The subtitle names the leading district, and that district has the largest Entries number
   in the table.
8. The sidebar's Districts item no longer shows a "Soon" pill. Events still shows its.

- [ ] **Step 10: Commit**

```bash
git add "app/admin/(shell)/districts" lib/admin/nav.ts
git commit -m "feat(admin): add the district rollup page"
```

---

### Task 21: Events — 16 types as a level-by-language matrix

Spec line 134: *"56 events / 16 types, read-only"*. Spec line 449 is blunter: **"Never render
`events` as a flat list. 56 rows; group by type, level and language."**

So the page is a matrix, not a list. Sixteen rows — one per event type — and four count
columns: elementary English, elementary Filipino, secondary English, secondary Filipino. That
is 16 rows carrying all 56 events, it shows at a glance which slots a type is even offered at
(MOJO and the TV contests are secondary-only), and it puts the two numbers an officer checks
an entry against — the minimum and maximum team size — beside the counts.

**The cell that says "—" is doing work.** A type offered only at secondary has no elementary
event row at all, and printing `0` there would read as "nobody entered" when the truth is "no
such contest exists". Those two facts look identical in a table of numbers and must not.

**Files:**
- Create: `lib\dashboard\event-matrix.ts`
- Create: `lib\dashboard\event-matrix.test.ts`
- Create: `app\admin\(shell)\events\page.tsx`
- Modify: `lib/admin/nav.ts` — clear `soon` on the Events item
- Test: `lib\dashboard\event-matrix.test.ts`

**Interfaces:**
- Consumes: `EventCategory`, `EventLevel`, `EventLanguage` from `@/lib/events-catalog`;
  `requireAdmin`, `PageHeading`, and the shadcn `Badge` / `Card` / `Table` primitives.
- Produces:
  ```ts
  // lib/dashboard/event-matrix.ts
  export type EventSlotKey =
    | "elementary-english" | "elementary-filipino"
    | "secondary-english" | "secondary-filipino";
  export const EVENT_SLOTS: readonly {
    key: EventSlotKey; level: EventLevel; language: EventLanguage; label: string;
  }[];
  export function slotKey(level: EventLevel, language: EventLanguage): EventSlotKey;
  export function teamSize(row: { minParticipants: number; maxParticipants: number | null }): string;
  export interface EventMatrixInput {
    eventId: string;
    typeId: string;
    typeNameEn: string;
    typeNameFil: string;
    category: EventCategory;
    minParticipants: number;
    maxParticipants: number | null;
    sortOrder: number;
    level: EventLevel;
    language: EventLanguage;
    entries: number;
  }
  export interface EventMatrixRow {
    typeId: string;
    typeNameEn: string;
    typeNameFil: string;
    category: EventCategory;
    minParticipants: number;
    maxParticipants: number | null;
    sortOrder: number;
    slots: Record<EventSlotKey, { eventId: string; entries: number } | null>;
    offered: number;
    entries: number;
  }
  export interface EventMatrix {
    individual: EventMatrixRow[];
    group: EventMatrixRow[];
    typesTotal: number;
    typesWithEntries: number;
    eventsTotal: number;
    entriesTotal: number;
  }
  export function buildEventMatrix(rows: EventMatrixInput[]): EventMatrix;
  ```

- [ ] **Step 1: Write the failing test**

Create `lib\dashboard\event-matrix.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildEventMatrix,
  slotKey,
  teamSize,
  type EventMatrixInput,
} from "./event-matrix";

function slot(over: Partial<EventMatrixInput> = {}): EventMatrixInput {
  return {
    eventId: "e1",
    typeId: "news",
    typeNameEn: "News Writing",
    typeNameFil: "Pagsulat ng Balita",
    category: "individual",
    minParticipants: 1,
    maxParticipants: 3,
    sortOrder: 1,
    level: "elementary",
    language: "english",
    entries: 0,
    ...over,
  };
}

/** News Writing at all four slots, MOJO at secondary only, one group type. */
const ROWS: EventMatrixInput[] = [
  slot({ eventId: "n-ee", level: "elementary", language: "english", entries: 4 }),
  slot({ eventId: "n-ef", level: "elementary", language: "filipino", entries: 2 }),
  slot({ eventId: "n-se", level: "secondary", language: "english", entries: 5 }),
  slot({ eventId: "n-sf", level: "secondary", language: "filipino", entries: 1 }),
  slot({
    eventId: "m-se",
    typeId: "mojo",
    typeNameEn: "MOJO",
    typeNameFil: "MOJO",
    sortOrder: 10,
    level: "secondary",
    language: "english",
    entries: 0,
  }),
  slot({
    eventId: "m-sf",
    typeId: "mojo",
    typeNameEn: "MOJO",
    typeNameFil: "MOJO",
    sortOrder: 10,
    level: "secondary",
    language: "filipino",
    entries: 0,
  }),
  slot({
    eventId: "r-se",
    typeId: "radio",
    typeNameEn: "Radio Broadcasting",
    typeNameFil: "Radio Broadcasting",
    category: "group",
    minParticipants: 7,
    maxParticipants: 7,
    sortOrder: 11,
    level: "secondary",
    language: "english",
    entries: 3,
  }),
];

describe("buildEventMatrix", () => {
  it("splits types by category and keeps each in event_types sort order", () => {
    const matrix = buildEventMatrix([...ROWS].reverse());
    expect(matrix.individual.map((row) => row.typeId)).toEqual(["news", "mojo"]);
    expect(matrix.group.map((row) => row.typeId)).toEqual(["radio"]);
  });

  it("fills the four slots and counts how many are offered", () => {
    const matrix = buildEventMatrix(ROWS);
    const news = matrix.individual[0];
    expect(news.offered).toBe(4);
    expect(news.slots["elementary-english"]).toEqual({ eventId: "n-ee", entries: 4 });
    expect(news.entries).toBe(12);
  });

  it("leaves a slot null when no such contest exists, so the page can print a dash", () => {
    // MOJO is secondary-only. `0` here would read as "nobody entered"; null reads as
    // "there is nothing to enter", and those are different facts.
    const matrix = buildEventMatrix(ROWS);
    const mojo = matrix.individual[1];
    expect(mojo.slots["elementary-english"]).toBeNull();
    expect(mojo.slots["elementary-filipino"]).toBeNull();
    expect(mojo.slots["secondary-english"]).toEqual({ eventId: "m-se", entries: 0 });
    expect(mojo.offered).toBe(2);
  });

  it("counts contested types the way the dashboard KPI does", () => {
    // The Events KPI is "types with >= 1 entry of N types". MOJO has two events and no
    // entries, so it is offered but not contested.
    const matrix = buildEventMatrix(ROWS);
    expect(matrix.typesTotal).toBe(3);
    expect(matrix.typesWithEntries).toBe(2);
    expect(matrix.eventsTotal).toBe(7);
    expect(matrix.entriesTotal).toBe(15);
  });

  it("reports zeros for an empty catalog rather than throwing", () => {
    expect(buildEventMatrix([])).toEqual({
      individual: [],
      group: [],
      typesTotal: 0,
      typesWithEntries: 0,
      eventsTotal: 0,
      entriesTotal: 0,
    });
  });
});

describe("slotKey", () => {
  it("builds the four keys", () => {
    expect(slotKey("elementary", "english")).toBe("elementary-english");
    expect(slotKey("secondary", "filipino")).toBe("secondary-filipino");
  });
});

describe("teamSize", () => {
  it("prints a fixed size once, not as a range", () => {
    expect(teamSize({ minParticipants: 7, maxParticipants: 7 })).toBe("7");
  });

  it("prints a range with an en dash", () => {
    expect(teamSize({ minParticipants: 1, maxParticipants: 3 })).toBe("1–3");
  });

  it("prints an open upper bound in words", () => {
    // Online Publishing is min 2, max null in the catalog.
    expect(teamSize({ minParticipants: 2, maxParticipants: null })).toBe("2 or more");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
npx vitest run lib/dashboard/event-matrix.test.ts
```

Expected: FAIL — `Failed to resolve import "./event-matrix"`.

- [ ] **Step 3: Write the module**

Create `lib\dashboard\event-matrix.ts`:

```ts
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

export type EventSlotKey =
  | "elementary-english"
  | "elementary-filipino"
  | "secondary-english"
  | "secondary-filipino";

/**
 * The four columns, in the order the page prints them — and the single source of that
 * order. The page maps this array for its header row *and* for each body row's cells, so a
 * header cannot drift out of alignment with the numbers under it.
 */
export const EVENT_SLOTS = [
  { key: "elementary-english", level: "elementary", language: "english", label: "Elem · Eng" },
  { key: "elementary-filipino", level: "elementary", language: "filipino", label: "Elem · Fil" },
  { key: "secondary-english", level: "secondary", language: "english", label: "Sec · Eng" },
  { key: "secondary-filipino", level: "secondary", language: "filipino", label: "Sec · Fil" },
] as const satisfies readonly {
  key: EventSlotKey;
  level: EventLevel;
  language: EventLanguage;
  label: string;
}[];

export function slotKey(level: EventLevel, language: EventLanguage): EventSlotKey {
  return `${level}-${language}`;
}

/**
 * How a type's participant limits read in one cell.
 *
 * Three shapes, because the catalog has three: a fixed team (7), a range (1–3), and an open
 * upper bound (Online Publishing, min 2 and max null). "7–7" and "2–∞" are both worse than
 * a sentence, and this is the only place that decision is made.
 */
export function teamSize(row: {
  minParticipants: number;
  maxParticipants: number | null;
}): string {
  if (row.maxParticipants === null) return `${row.minParticipants} or more`;
  if (row.maxParticipants === row.minParticipants) return `${row.minParticipants}`;
  return `${row.minParticipants}–${row.maxParticipants}`;
}

/** One concrete event — a type at a level in a language — with its entry count. */
export interface EventMatrixInput {
  eventId: string;
  typeId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  minParticipants: number;
  maxParticipants: number | null;
  /** `event_types.sort_order`, which is the order the whole admin area lists types in. */
  sortOrder: number;
  level: EventLevel;
  language: EventLanguage;
  entries: number;
}

export interface EventMatrixRow {
  typeId: string;
  typeNameEn: string;
  typeNameFil: string;
  category: EventCategory;
  minParticipants: number;
  maxParticipants: number | null;
  sortOrder: number;
  /** `null` where the contest is not offered at all — never a zero standing in for absence. */
  slots: Record<EventSlotKey, { eventId: string; entries: number } | null>;
  /** How many of the four slots exist. 4 for a both-levels type, 2 for a secondary-only one. */
  offered: number;
  entries: number;
}

export interface EventMatrix {
  individual: EventMatrixRow[];
  group: EventMatrixRow[];
  typesTotal: number;
  /** Types with at least one entry — the numerator of the dashboard's Events KPI. */
  typesWithEntries: number;
  eventsTotal: number;
  entriesTotal: number;
}

function emptySlots(): EventMatrixRow["slots"] {
  return {
    "elementary-english": null,
    "elementary-filipino": null,
    "secondary-english": null,
    "secondary-filipino": null,
  };
}

/**
 * Folds 56 event rows into 16 type rows.
 *
 * Ordering is `event_types.sort_order`, so this page lists types in the same sequence as the
 * entry wizard and the events catalog. The rows arrive in whatever order PostgREST returns
 * them, which is why the sort happens here rather than being assumed.
 */
export function buildEventMatrix(rows: EventMatrixInput[]): EventMatrix {
  const byType = new Map<string, EventMatrixRow>();

  for (const row of rows) {
    let type = byType.get(row.typeId);
    if (!type) {
      type = {
        typeId: row.typeId,
        typeNameEn: row.typeNameEn,
        typeNameFil: row.typeNameFil,
        category: row.category,
        minParticipants: row.minParticipants,
        maxParticipants: row.maxParticipants,
        sortOrder: row.sortOrder,
        slots: emptySlots(),
        offered: 0,
        entries: 0,
      };
      byType.set(row.typeId, type);
    }

    type.slots[slotKey(row.level, row.language)] = {
      eventId: row.eventId,
      entries: row.entries,
    };
    type.offered += 1;
    type.entries += row.entries;
  }

  const all = [...byType.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.typeNameEn.localeCompare(b.typeNameEn)
  );

  return {
    individual: all.filter((row) => row.category === "individual"),
    group: all.filter((row) => row.category === "group"),
    typesTotal: all.length,
    typesWithEntries: all.filter((row) => row.entries > 0).length,
    eventsTotal: rows.length,
    entriesTotal: rows.reduce((sum, row) => sum + row.entries, 0),
  };
}
```

`as const satisfies` on `EVENT_SLOTS` is what makes `EVENT_SLOTS[n].key` a literal
`EventSlotKey` rather than a widened `string`, so indexing `row.slots[slot.key]` type-checks
without a cast — while `satisfies` still errors if a label or level is mistyped. Do not
replace it with a plain type annotation; that widens the keys and the page stops compiling.

- [ ] **Step 4: Run it to verify it passes**

```powershell
npx vitest run lib/dashboard/event-matrix.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit the module**

```bash
git add lib/dashboard/event-matrix.ts lib/dashboard/event-matrix.test.ts
git commit -m "feat(dashboard): fold the event catalog into a type-by-slot matrix"
```

- [ ] **Step 6: Write the page**

One query. `entries(count)` on `events` is an embedded aggregate, the same shape the other
pages unwrap, so 56 events and their entry counts arrive together.

Create `app\admin\(shell)\events\page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildEventMatrix,
  EVENT_SLOTS,
  teamSize,
  type EventMatrixInput,
  type EventMatrixRow,
} from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

interface CatalogEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  event_types: {
    id: string;
    name_en: string;
    name_fil: string;
    category: EventCategory;
    min_participants: number;
    max_participants: number | null;
    sort_order: number;
  } | null;
  entries: { count: number }[];
}

/** One category's block. Both blocks are the same table, so it is written once. */
function MatrixTable({ rows }: { rows: EventMatrixRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event type</TableHead>
          <TableHead className="whitespace-nowrap">Team size</TableHead>
          {EVENT_SLOTS.map((slot) => (
            <TableHead key={slot.key} className="whitespace-nowrap text-right">
              {slot.label}
            </TableHead>
          ))}
          <TableHead className="text-right">Entries</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.typeId}>
            <TableCell>
              <p className="font-medium">{row.typeNameEn}</p>
              {/* Group contests and MOJO carry identical English and Filipino names in the
                  source workbook, so the second line is suppressed rather than repeated. */}
              {row.typeNameFil === row.typeNameEn ? null : (
                <p className="text-xs text-muted-foreground">{row.typeNameFil}</p>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
              {teamSize(row)}
            </TableCell>
            {EVENT_SLOTS.map((slot) => {
              const cell = row.slots[slot.key];
              return (
                <TableCell key={slot.key} className="text-right tabular-nums">
                  {cell === null ? (
                    <span
                      className="text-muted-foreground"
                      title="Not offered at this level"
                      aria-label="Not offered at this level"
                    >
                      —
                    </span>
                  ) : (
                    cell.entries
                  )}
                </TableCell>
              );
            })}
            <TableCell className="text-right font-medium tabular-nums">
              {row.entries === 0 ? (
                <Badge variant="outline">None yet</Badge>
              ) : (
                row.entries
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AdminEventsPage() {
  const { supabase } = await requireAdmin();

  const { data } = await supabase
    .from("events")
    .select(
      "id, level, language, event_types(id, name_en, name_fil, category, min_participants, max_participants, sort_order), entries(count)"
    )
    .overrideTypes<CatalogEventRow[]>();

  const rows: EventMatrixInput[] = (data ?? []).flatMap((row) =>
    // events.event_type_id is NOT NULL since migration 0003, so a null type here is a
    // broken key rather than an unclassified event — dropped, not printed unlabelled.
    row.event_types
      ? [
          {
            eventId: row.id,
            typeId: row.event_types.id,
            typeNameEn: row.event_types.name_en,
            typeNameFil: row.event_types.name_fil,
            category: row.event_types.category,
            minParticipants: row.event_types.min_participants,
            maxParticipants: row.event_types.max_participants,
            sortOrder: row.event_types.sort_order,
            level: row.level,
            language: row.language,
            entries: row.entries?.[0]?.count ?? 0,
          },
        ]
      : []
  );

  const matrix = buildEventMatrix(rows);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Events"
        badge={`${matrix.typesWithEntries} of ${matrix.typesTotal} contested`}
        subtitle={`${matrix.eventsTotal} events across ${matrix.typesTotal} contest types, carrying ${matrix.entriesTotal} entries. A dash means the contest is not offered at that level.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Individual</CardTitle>
          <CardDescription>
            {matrix.individual.length} types. One learner competes, with up to two reserves on
            the entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={matrix.individual} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Group</CardTitle>
          <CardDescription>
            {matrix.group.length} types. A whole team enters together.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={matrix.group} />
        </CardContent>
      </Card>
    </div>
  );
}
```

Two notes for whoever reads this file next:

- **The `Team size` numbers come from the database, not from `lib/events-catalog.ts`.**
  `event_types.min_participants` and `max_participants` were added by migration 0004 and the
  catalog is the *seed* for them. Reading the seed instead would show what the limits were
  meant to be rather than what they are.
- **There is no district filter here.** Events are division-wide; the same 56 contests are
  offered to every school. Entry counts *by district* are what `/admin/overall-data`'s
  per-event table already does, with a district filter on it.

- [ ] **Step 7: Clear the nav flag**

In `lib/admin/nav.ts`, drop `soon: true` from the Events item — the last one in the
`Reference` group:

```ts
      { label: "Events", href: "/admin/events", icon: "events" },
```

- [ ] **Step 8: Type-check, lint, and run the suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean, `lib/dashboard/event-matrix.test.ts` reporting 9 passed.

If `tsc` reports `Type 'string' is not assignable to type 'EventSlotKey'` inside
`MatrixTable`, the `as const satisfies` on `EVENT_SLOTS` has been changed to a plain
annotation. Restore it — see the note in Step 3.

- [ ] **Step 9: Click through it**

```powershell
npm run dev
```

Signed in as an admin:

1. `/admin/events` shows two cards. Against production: 10 individual types and 6 group
   types, 16 rows in total, and the subtitle reads "56 events across 16 contest types".
2. **The badge must match the dashboard.** Its "N of 16 contested" is the same N as the
   Events KPI on `/admin`.
3. **The dash test.** MOJO's two elementary cells read "—"; its two secondary cells read a
   number (0 or more). The three TV and Online Publishing rows do the same. No row shows a
   dash and a number in the same level.
4. Every row shows a team size: `1–3` for the individual types, `7` for the radio, TV and
   collaborative contests, and `2 or more` for Online Publishing.
5. The four slot columns of any row sum to its Entries figure. Add up the Entries column
   across both cards: it equals the entries KPI on `/admin`.
6. A type nobody has entered shows the "None yet" badge in Entries rather than a bare 0.
7. Types read in catalog order — News Writing first, MOJO last among individual; the radio
   contests first among group — the same order the entry wizard offers them in.
8. Filipino second lines appear under the individual type names and are absent from the group
   rows, whose English and Filipino names are identical in the source workbook.
9. The sidebar's Events item no longer shows a "Soon" pill, and the whole **Reference** group
   is now free of them.

- [ ] **Step 10: Commit**

```bash
git add "app/admin/(shell)/events" lib/admin/nav.ts
git commit -m "feat(admin): add the event catalog matrix"
```

---

### Task 22: Activity Log — the whole feed, not the newest five

Spec line 135: *"full activity feed"*. Spec §5.5 sets the sizes: *"sliced to 5 for the
dashboard and 50 for `/admin/activity`."*

The merge already exists (Task 12) and so do its six queries (Task 15) — but they are
trapped inside `loadActivity`, a no-argument cached loader hard-wired to fetch 8 rows per
source. This page needs 50. Copying the six queries and their six mappers into the page
would be about 130 duplicated lines whose two copies would drift on the first schema change,
so this task lifts them into a module both call sites share, exactly as Task 17 did with the
schools query.

**The invariant from Task 12 gets enforced by construction here.** It reads: *"fetch each
source with the same limit you pass to the merge."* Rather than restate that warning at a
second call site, `fetchActivity(supabase, limit)` uses its one `limit` for both the six
`.limit()` calls and the merge. A caller cannot get the pairing wrong because a caller no
longer supplies the pairing.

**Files:**
- Create: `lib\dashboard\activity-source.ts`
- Create: `app\admin\(shell)\activity\page.tsx`
- Modify: `app/admin/(shell)/dashboard-data.ts` (`loadActivity` delegates; six interfaces and
  the mappers move out)
- Modify: `app/admin/(shell)/page.tsx` (the activity panel gets its "View all" action)
- Modify: `lib/admin/nav.ts` — clear `soon` on the Activity Log item

No new test file. This task moves tested code and adds a page; `lib/dashboard/activity.test.ts`
already covers the merge and the relative-time formatter, and the six queries are the same
six queries. Re-running the suite after the move is the check that matters.

**Interfaces:**
- Consumes: `ActivityItem`, `ActivityKind`, `mergeActivity`, `relativeTime` from
  `@/lib/dashboard/activity` (Task 12); `ActivityFeed` (Task 14); `SupabaseServerClient` from
  `@/lib/supabase/server` (exported in Task 17 Step 1); `PaperParticipation` from
  `@/lib/paper/gate`, `formatParticipantNumber` from `@/lib/roster/limits`, `surnameFirst`
  from `@/lib/roster/names` — all three already imported by `dashboard-data.ts` and moving
  with the code that uses them.
- Produces:
  ```ts
  // lib/dashboard/activity-source.ts
  export function fetchActivity(
    supabase: SupabaseServerClient,
    limit: number
  ): Promise<ActivityItem[]>;
  ```

- [ ] **Step 1: Move the six queries into their own module**

Create `lib\dashboard\activity-source.ts` and move into it, unchanged, everything in
`app/admin/(shell)/dashboard-data.ts` that only the feed uses:

- the six row interfaces — `EntryActivityRow`, `ParticipantActivityRow`,
  `CoachActivityRow`, `PaperAnswerActivityRow`, `LockActivityRow`, `PaperUpdateActivityRow`
- the `PARTICIPATION_LABEL` map
- the whole body of `loadActivity` — the `Promise.all` of six queries and the
  `mergeActivity([...])` call with its six mappers

The bodies are moved verbatim. Exactly four things change, and they are the whole diff:

```ts
import {
  mergeActivity,
  type ActivityItem,
} from "@/lib/dashboard/activity";
import type { PaperParticipation } from "@/lib/paper/gate";
import { formatParticipantNumber } from "@/lib/roster/limits";
import { surnameFirst } from "@/lib/roster/names";
import type { SupabaseServerClient } from "@/lib/supabase/server";

// …the six *ActivityRow interfaces, verbatim from dashboard-data.ts…
// …PARTICIPATION_LABEL, verbatim from dashboard-data.ts…

/**
 * Six timestamp columns, one feed. Takes its client rather than building one, because the
 * dashboard and the activity page guard identically but *size* differently.
 *
 * `limit` is used twice on purpose — once for each source's `.limit()` and once for the
 * merge. Task 12's invariant is that those two numbers must match; giving the function one
 * number instead of two is how that stops being something a caller can get wrong.
 */
export async function fetchActivity(
  supabase: SupabaseServerClient,
  limit: number
): Promise<ActivityItem[]> {
  const [entries, participants, coaches, answers, locks, papers] = await Promise.all([
    // …the six queries, verbatim, with every `.limit(ACTIVITY_FETCH_LIMIT)` now `.limit(limit)`…
  ]);

  return mergeActivity(
    [
      // …the six mappers, verbatim…
    ],
    limit
  );
}
```

1. `const supabase = await getAdminClient();` is gone — the client is the first parameter.
2. `.limit(ACTIVITY_FETCH_LIMIT)` becomes `.limit(limit)` in all six queries.
3. The merge's second argument becomes `limit`, not `ACTIVITY_SHOWN`. **This is a real
   change, not a rename:** the merge now returns up to `limit` items and the *caller* decides
   how many to show. It is why `loadActivity` grows a `.slice()` in Step 2.
4. `cache()` does not come along. Caching belongs to the no-argument loader that wraps this,
   not to a function whose result depends on an argument.

Delete those symbols from `dashboard-data.ts`. Its `import { mergeActivity, type ActivityItem }`,
`PaperParticipation`, `formatParticipantNumber` and `surnameFirst` imports may now be unused
there — `npm run lint` in Step 5 will name each one it has to drop. `ActivityItem` stays: the
`DashboardData` interface still declares an `activity: ActivityItem[]` field.

- [ ] **Step 2: Point `loadActivity` at it**

In `app/admin/(shell)/dashboard-data.ts`, `loadActivity` becomes four lines:

```ts
import { fetchActivity } from "@/lib/dashboard/activity-source";

/**
 * The dashboard's slice of the feed. Fetches 8 per source so the newest 5 overall are
 * certain to be among them, then shows 5 — see /admin/activity for the whole thing.
 */
export const loadActivity = cache(async (): Promise<ActivityItem[]> => {
  const items = await fetchActivity(await getAdminClient(), ACTIVITY_FETCH_LIMIT);
  return items.slice(0, ACTIVITY_SHOWN);
});
```

Both constants keep their current values and their comments: `ACTIVITY_FETCH_LIMIT = 8`,
`ACTIVITY_SHOWN = 5`. Slicing a correctly-ordered list to a shorter prefix is always safe,
which is what makes fetch-8-show-5 legitimate while fetch-8-merge-50 would not be.

- [ ] **Step 3: Verify the move changed no behaviour**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: clean, and the same test count as before this task — no test was added or removed.
Then, with `npm run dev` running, load `/admin` and confirm the Recent activity panel still
shows the same five rows in the same order as it did before the move. A move that changes
what is on screen was not a move.

- [ ] **Step 4: Commit the extraction on its own**

```bash
git add lib/dashboard/activity-source.ts "app/admin/(shell)/dashboard-data.ts" lib/supabase/server.ts
git commit -m "refactor(dashboard): share the activity queries between call sites"
```

Committing the pure move before the new page means `git log -p` shows one commit that must
not change behaviour and one that adds a screen — and if the dashboard's feed does change,
`git revert` on a single commit says so.

- [ ] **Step 5: Write the page**

Create `app\admin\(shell)\activity\page.tsx`:

```tsx
import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchActivity } from "@/lib/dashboard/activity-source";

/**
 * 50 per source, so the merged feed is the true newest 50 in the division.
 *
 * Not paginated. Six sources with six different cursors is a real design problem and the
 * feed is not the tool for "everything a school ever did" — /admin/overall-data,
 * /admin/summary and the roster pages each answer that for their own slice, completely and
 * with filters. What this page is for is "what changed lately", and 50 rows covers that.
 */
const ACTIVITY_LIMIT = 50;

/** Grouping label for a row's day, in Manila — the division's clock. */
const DAY_LABEL = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export default async function AdminActivityPage() {
  const { supabase } = await requireAdmin();
  const items = await fetchActivity(supabase, ACTIVITY_LIMIT);

  // One `now` for the whole response, as on the dashboard: two rows rendered a millisecond
  // apart must not disagree about what "2m ago" means.
  const now = new Date();

  // Group by Manila day, preserving the merge's newest-first order. A plain object would
  // reorder date-like keys in some engines; a Map preserves insertion order by spec.
  const days = new Map<string, typeof items>();
  for (const item of items) {
    const day = DAY_LABEL.format(new Date(item.at));
    const bucket = days.get(day);
    if (bucket) bucket.push(item);
    else days.set(day, [item]);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Activity Log"
        badge={items.length === 0 ? "Quiet" : `Newest ${items.length}`}
        subtitle="Entries, learners, coaches, school-paper answers, paper edits and submission locks — newest first, division-wide."
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing has happened yet. Rows appear here as schools build their rosters and
            submit entries.
          </CardContent>
        </Card>
      ) : (
        [...days].map(([day, dayItems]) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-base">{day}</CardTitle>
              <CardDescription>
                {dayItems.length === 1 ? "1 change" : `${dayItems.length} changes`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed items={dayItems} now={now} />
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        Assembled from the timestamps the database already keeps. There is no separate audit
        log, so this shows when a record was created or last changed — not who changed it, and
        not what it said before.
      </p>
    </div>
  );
}
```

That closing paragraph is not decoration. A screen headed "Activity Log" invites the reading
that it is an audit trail, and someone will eventually ask it who deleted a learner. It
cannot answer that, and saying so on the page is cheaper than the conversation.

`ActivityFeed` is reused rather than reimplemented, which is what keeps a row's icon,
title, meta line and link identical to the dashboard's. It renders its own "No activity
recorded yet." for an empty list; here the page catches empty first, because a day-grouped
layout with nothing to group needs a card of its own, not an empty one.

- [ ] **Step 6: Fill the "View all" slot on the dashboard**

Task 15 left `Panel`'s `action` prop unused and said this task would fill it. In
`app/admin/(shell)/page.tsx`, add the action to the Recent activity panel:

```tsx
        <Panel
          title="Recent activity"
          description="The newest changes the division's schools have made."
          action={
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/activity">View all</Link>
            </Button>
          }
        >
          <ActivityFeed items={data.activity} now={data.now} />
        </Panel>
```

`Button` and `Link` are already imported in that file — Task 17 added them for the
per-school panel's two links. If `tsc` says otherwise, add:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
```

- [ ] **Step 7: Clear the nav flag**

In `lib/admin/nav.ts`, drop `soon: true` from the Activity Log item:

```ts
      { label: "Activity Log", href: "/admin/activity", icon: "activity" },
```

This is the last `soon` flag in the file — after this task no item carries one. Five items
still show a "Soon" pill, but they carry `stub: true` from Task 16 and are real links to
pages that explain themselves. That is the finished state, not an oversight.

Task 16's filesystem test covers this without an edit: it asserts an item is linked exactly
when its `page.tsx` exists, so clearing this flag passes only because Step 5 created
`app/admin/(shell)/activity/page.tsx`.

- [ ] **Step 8: Type-check, lint, and run the suite**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
```

Expected: all clean.

- [ ] **Step 9: Click through it**

```powershell
npm run dev
```

Signed in as an admin:

1. `/admin/activity` shows day-grouped cards, newest day first, and within a day newest
   first. The badge reads "Newest 50" against production data.
2. **The overlap test.** The five rows on the dashboard's Recent activity panel are the
   first five rows here, in the same order, with the same titles. If they differ, the fetch
   and merge limits have come apart — read Step 1's point 3 again.
3. Each day's card counts its own rows: the subtitle numbers sum to the badge.
4. All six kinds appear with distinct icons — entry, learner, coach, paper answer, paper
   update, submission lock — and each row's second line reads "School name · 3h ago" or a
   date beyond a week.
5. Clicking an entry row lands on `/admin/entries?school=…` filtered to that school;
   a learner row lands on `/admin/participants?school=…`; a coach row lands on
   `/admin/coaches` unfiltered, which is deliberate — that page has no school filter.
6. Rows older than a week show a "Mon D" date rather than a growing hour count.
7. **The sidebar's final state.** Activity Log no longer shows a "Soon" pill. Every item in
   **Reference** and **Reports** is now a plain link. The five items in **Adjudication** and
   **System** still show a "Soon" pill and are clickable — that is `stub: true`, and it is
   correct. Nothing in the sidebar is dimmed or unclickable any more.
8. The dashboard's Recent activity panel now has a "View all" button in its header that
   lands here.

- [ ] **Step 10: Commit**

```bash
git add "app/admin/(shell)/activity" "app/admin/(shell)/page.tsx" lib/admin/nav.ts
git commit -m "feat(admin): add the full activity log page"
```

---

# Phase 5 — Verification

One task, no new code. Twenty-two tasks each proved their own piece; this phase proves the
whole, and proves the safety claims with the same rigour as the feature claims.

**Phase 5 gate, from spec §10:** `npx vitest run`, `npm run lint` and `npm run build` are all
clean, and the manual pass in spec §8 is complete and recorded. Nothing merges until this
holds.

---

### Task 23: Prove it, against the production database

Everything up to here was verified one task at a time. This task verifies the whole thing
at once, and — because the database is live and full — it verifies the *safety* claims as
carefully as the feature claims. Spec §9 lists nine hard constraints; six of them are
provable from the diff alone, and this task proves them rather than asserting them.

There is no new code in this task. If a check fails, the fix belongs to the task that
introduced the problem, and the failure gets recorded here.

**Files:**
- Create: `docs/superpowers/plans/2026-08-19-admin-dashboard-verification.md` (the filled-in
  record — the only artefact this task produces)

Nothing else is created or modified. A verification task that edits application code is no
longer a verification task.

**Interfaces:** none. This task consumes the finished app.

- [ ] **Step 1: The automated gates**

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

All four must be clean. `npm run build` is the one that has not run since Task 1 — it
type-checks in production mode and, critically, it is where a page that reads `searchParams`
without awaiting it, or a client component importing a server-only module, finally fails.

Record the vitest total. Every module Phase 2 built has a colocated test, and spec §8's table
names eight of them:

| Test file | Spec §8 line |
|---|---|
| `lib/dashboard/kpis.test.ts` | denominators, zero rows, engagement vs registration |
| `lib/dashboard/per-school.test.ts` | rollup, sort, top-15 slice, division-wide TOTAL |
| `lib/dashboard/per-event.test.ts` | grouping to types, zero-entry exclusion, top-8 + Other |
| `lib/dashboard/donut.test.ts` | arc geometry, single slice, empty set, rounding |
| `lib/dashboard/activity.test.ts` | merge order, label shape, null timestamps |
| `lib/dashboard/timeline.test.ts` | open vs locked, Soon steps |
| `lib/dashboard/attention.test.ts` | each attention count, all-clear state |
| `lib/admin/nav.test.ts` | active-path matching, including nested routes |

Confirm all eight ran. Tasks 17-21 added four more — `overall-data-workbook`,
`registration-summary`, `school-registry`, `per-district`, `event-matrix` — which are beyond
what §8 required and need no entry in that table.

- [ ] **Step 2: The five edge cases spec §8 names**

Spec §8: *"Edge cases drawn from real data that the tests must cover: an empty result set, a
school with participants but zero entries, an event type with zero entries, a blank coach
name, and `submitted_at` being null."*

Four are unit-tested; the fifth is not, and this step is where that is recorded honestly
rather than quietly.

```powershell
npx vitest run --reporter=verbose 2>&1 | Select-String -Pattern "empty|zero|blank|null"
```

Check each case has a test whose name covers it:

1. **Empty result set** — `kpis`, `per-school`, `per-event`, `donut`, `activity`,
   `event-matrix` and `per-district` each have one.
2. **Participants but zero entries** — `attention.test.ts`, and again in
   `school-registry.test.ts` as the `learners-no-entry` filter.
3. **Event type with zero entries** — `per-event.test.ts` (excluded from the donut) and
   `event-matrix.test.ts` (present in the table, "None yet" in its Entries cell). Both
   behaviours are correct and they differ by panel; confirm both tests exist.
4. **`submitted_at` null** — `activity.test.ts` drops unparseable timestamps.
5. **Blank coach name** — **no unit test covers this.** `surnameFirst()` is existing,
   already-tested code and this plan added no formatter, so there is nothing new to test.
   What this plan added is *display*: a blank name renders as an empty string inside
   "Coach added — ", which reads as a dangling em dash. Zero rows are blank today
   (spec §9.7), so this cannot be observed against production. Record it as a known gap
   with its exact consequence, and do not invent a passing test for it.

Write the result of each into the verification record, including item 5's gap verbatim.

- [ ] **Step 3: Prove the six diff-provable safety constraints**

```bash
git diff main --stat
git diff main --name-only -- supabase/
git log main..HEAD --oneline
```

Then, against the full diff:

| Spec §9 | Claim | How this proves it |
|---|---|---|
| 1 | No migration | `git diff main --name-only -- supabase/` prints **nothing** |
| 2 | Read-only | see the grep below |
| 4 | Action signatures unchanged | `app/admin/actions.ts` and the school-papers / participants action files are absent from `--name-only` |
| 5 | `/admin/export` untouched | `app/admin/export/route.ts` is absent from `--name-only` |
| 6 | Login and proxy untouched | `app/admin/login/**` and `proxy.ts` are absent from `--name-only` |
| 3 | Lock machinery untouched | follows from 1: those objects exist only in migrations |

For constraint 2, every new query must be a `SELECT`. Supabase spells writes as four method
names, so grep the added lines for them:

```bash
git diff main -U0 -- "*.ts" "*.tsx" | grep "^+" | grep -nE "\.(insert|update|upsert|delete)\(|\.rpc\(|\"use server\"|'use server'"
```

Expected: **no output.** Any hit is a violation and stops the release.

`.rpc(` is in that pattern because an RPC can write even though it reads like a call, and
`"use server"` is there because a new server action is a new write path whether or not it
writes today.

The `--name-only` absences are worth reading twice. Six of the nine constraints are satisfied
by *files this plan never opened*, which is why they were provable from the start; the plan's
design put the new code in new files precisely so this table could be short.

- [ ] **Step 4: The two constraints only a human can check**

Constraints 8 and 9 are about what a page *shows*, so they need eyes.

**§9.8 — never render `events` as a flat list.** Open `/admin/events`. It must show 16 rows
in two grouped cards, never 56. Also check the two other places events surface: the donut on
`/admin` groups to types with a top-8 + Other fold, and `/admin/overall-data`'s per-event
table groups to types. None of the three lists 56 rows.

**§9.9 — never label a truncated list as complete.** Every top-N panel states its cutoff and
links to the full view. Check each:

| Panel | Cutoff shown | Links to |
|---|---|---|
| `/admin` Per School Summary | "Top 15 of N active" | `/admin/overall-data` |
| `/admin` Entries by event type | "8 shown, rest in Other" | `/admin/overall-data` |
| `/admin` Recent activity | 5 rows | `/admin/activity` ("View all", Task 22) |
| `/admin/overall-data` per-school | not truncated — states its full count | — |
| `/admin/activity` | "Newest 50" | nothing; the badge says what it is |

The last row is the one to look at hardest: `/admin/activity` is truncated and links nowhere,
which is legal only because its badge names the cutoff instead of implying completeness. If
it reads "Activity Log" with no qualifier, that is a §9.9 violation — fix the badge.

- [ ] **Step 5: The regression pass spec §8 requires**

Spec §8: *"all four moved pages load at their original URLs with filters and exports intact;
`/admin/login` renders with no shell; sign-out works; the theme toggle persists;
`/admin/export` returns the same workbook."*

The route group is where this could have gone wrong — `(shell)` is not part of the URL, but
that is a claim about Next's routing that has to be observed, not trusted.

Items 1-9 are §8's list. Item 10 is not: it is the sidebar collapse, which spec §3.3 and §4
both call REAL and which no other task exercises against the finished fifteen-item nav.

```powershell
npm run dev
```

1. **`/admin/entries`** — loads inside the shell. Its filters still work; change one and the
   URL updates and the list narrows. Its export still downloads.
2. **`/admin/participants`** — same three checks.
3. **`/admin/coaches`** — same three checks.
4. **`/admin/school-papers`** — same three checks.
5. **`/admin/export`** — hit it directly. Same filename, same headers, same sheet names and
   column order as before this plan. Compare against a workbook downloaded from `main` if one
   is not to hand; a changed filename breaks whatever the division already does with it.
6. **`/admin/login`** — signed out, this renders with **no sidebar and no topbar**. It sits
   outside the route group, and this is the check that proves the group's boundary is where
   the plan says.
7. **Sign out** — from the user chip in the topbar. It ends the session and lands on
   `/admin/login`. Then visit `/admin` directly: it redirects back to the login page.
8. **Theme toggle** — flip it, hard-reload, and confirm the choice survives. Then flip to
   dark and walk every new page: the eight chart hues, the KPI tiles, the tables and the
   "Soon" pills all remain legible. Dark mode was validated numerically in Task 1 Step 4;
   this is the look-at-it pass that step's own note asks for.
9. **A non-admin** — if a school account is available, sign in as one and visit `/admin`.
   It signs the session out and redirects. This exercises `requireAdmin`, which the plan
   never modified but every new page depends on.
10. **The collapsed rail, across the finished nav.** Collapse the sidebar and walk all
    fifteen items. Every one is an icon with a tooltip; the five stubs say "— coming soon"
    in theirs; the active item is still highlighted on each page. Reload once collapsed and
    confirm the console is clean — a hydration warning here is the `localStorage` read
    having crept back into `useState`. Task 6 Step 8b checked this against five pages; this
    is the same check against all fifteen.

- [ ] **Step 6: Read the numbers against each other**

Each panel was reconciled against production in its own task. This step checks the panels
agree with *each other*, which no single task could.

With the dashboard and the four reference pages open:

1. **Entries.** The Entries KPI on `/admin` = the Entries total on `/admin/overall-data`
   (unfiltered) = the sum of the Entries column on `/admin/events` = the Entries total on
   `/admin/districts` = the Entries total on `/admin/schools` (unfiltered).
2. **Learners and coaches.** The two roster KPIs equal the corresponding totals on
   `/admin/schools`, `/admin/districts` and `/admin/overall-data`.
3. **Contested event types.** The Events KPI's numerator = the badge on `/admin/events` =
   the donut's `typesWithEntries`.
4. **Schools with entries.** The Schools KPI = the row count under
   `/admin/schools?status=entered` = `schoolsWithEntries` in the districts rollup.
5. **The attention list's click-throughs.** Every item's count equals the number of rows the
   page it links to actually shows. Task 19 made this a stated invariant for
   `schools-no-entry`; check the others the same way.
6. **Districts.** `/admin/districts` may show **more** rows than the dashboard's
   "districts registered" figure. That is correct and documented in Task 20: the page counts
   rows in `districts`, the KPI counts distinct district ids *among schools*. If they are
   equal, every district has at least one school — also fine. What would be wrong is the page
   showing fewer.

A mismatch anywhere in 1-5 is a bug in the panel that disagrees with the other three, not a
rounding artefact. Record the actual numbers, not "matched".

- [ ] **Step 7: Write the verification record**

Create `docs/superpowers/plans/2026-08-19-admin-dashboard-verification.md` with the results —
the real numbers, the real command output, and any gap found. Use this skeleton and fill
every field; a field left as a dash is a check that did not run, and should say so:

```markdown
# Admin Dashboard — Verification Record

Run on: <date>  ·  Commit: <sha>  ·  Against: production database

## Automated
- `npx tsc --noEmit`: <clean / errors>
- `npm run lint`: <clean / errors>
- `npx vitest run`: <N passed, M files>
- `npm run build`: <clean / errors>

## Spec §8 edge cases
1. Empty result set: <test names>
2. Participants, zero entries: <test names>
3. Event type, zero entries: <test names>
4. `submitted_at` null: <test names>
5. Blank coach name: NOT UNIT TESTED — <the consequence, verbatim from Step 2>

## Spec §9 safety
| # | Constraint | Evidence |
|---|---|---|
| 1 | No migration | `git diff main --name-only -- supabase/`: <output> |
| 2 | Read-only | write-method grep: <output> |
| 3 | Lock machinery untouched | follows from 1 |
| 4 | Action signatures | <files absent from diff> |
| 5 | `/admin/export` contract | <absent from diff; workbook compared: yes/no> |
| 6 | Login and proxy | <absent from diff> |
| 7 | Blank coach names tolerated | <renders as: …> |
| 8 | Events never flat | `/admin/events`: <16 rows / …> |
| 9 | Truncation always labelled | <each panel> |

## Regression pass
<the ten items from Step 5, each pass or fail>

## Cross-panel reconciliation
| Figure | Dashboard | Overall Data | Schools | Districts | Events |
|---|---|---|---|---|---|
| Entries | | | | | |
| Learners | | | | | |
| Coaches | | | | | |
| Contested types | | | | | |

## Known gaps
<anything found and not fixed, with why>
```

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-08-19-admin-dashboard-verification.md
git commit -m "docs: record the admin dashboard verification pass"
```

- [ ] **Step 9: Stop and report before merging**

Do not merge on the strength of a green suite. Report to the user:

1. The four automated gates and the vitest count.
2. Any Step 6 mismatch, with both numbers.
3. The blank-coach-name gap from Step 2, item 5.
4. Whether `/admin/export`'s workbook was compared against `main` or only inspected.
5. Anything in the verification record still holding a dash.

Merging is the user's call. The database is live and full, and the last five commits touched
every screen a division officer uses.

---
