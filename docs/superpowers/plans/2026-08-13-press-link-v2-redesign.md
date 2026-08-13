# Press Link v2 — Entry Restructure & UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/entry` from a single long form page into a dashboard whose "Create Entry" button opens a Category → Event → Level → Language wizard, and restyle the whole app with shadcn/ui on a Fresh Academic Teal theme with working light/dark modes.

**Spec:** `docs/superpowers/specs/2026-08-13-press-link-v2-design.md`
**Supersedes:** the entry-page and styling tasks of `docs/superpowers/plans/2026-08-13-press-link.md`. Auth, RLS, seeding and admin filter semantics from v1 are unchanged.

**Tech Stack (added in v2):** shadcn/ui (CLI-installed components into `components/ui/`), `next-themes`, `lucide-react`, `sonner`. Everything else as v1: Next.js 16.3.0 App Router, React 19.2.8, Tailwind v4, TypeScript, Supabase, Zod v4, Vitest.

## Global Constraints

- Everything from the v1 plan's Global Constraints still holds: Node runtime only (never `runtime = 'edge'`), Server Components read / Server Actions write, anon key in browser only, service-role key only in `scripts/`, RLS on every table, only District + School Name + School ID ever read from the source spreadsheet.
- **Migrations run through the IPv4 pooler.** The direct host (`db.<ref>.supabase.co`) is IPv6-only and unreachable from this machine, which is why v1 fell back to pasting SQL by hand. The Supavisor pooler (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.<ref>`) *is* reachable over IPv4, so `scripts/run-migration.ts` applies migration files directly:

  ```bash
  SUPABASE_DB_PASSWORD='...' npx tsx --env-file=.env.local scripts/run-migration.ts supabase/migrations/0002_event_types.sql
  ```

  The script probes pooler regions until one authenticates and wraps the file in a transaction. Verify afterwards with `npm run verify-event-types`.
- **Server Actions must declare explicit return types** — `Promise<{ error: string } | { success: true }>`. Inferring the type produces `string | undefined` at the call site and fails `tsc`.
- Tailwind v4 has no `tailwind.config.js` here. shadcn's Tailwind v4 mode writes tokens into `app/globals.css` via `@theme inline` and `:root` / `.dark` blocks — do not create a JS config.
- Dark mode switches from `prefers-color-scheme` to a **class strategy** (`next-themes` with `attribute="class"`), because the v1 media-query approach is exactly what produced the broken screenshots.
- `entries` and `school_papers` are **empty** in production, verified this session. The `event_types` migration therefore needs no data backfill for them — but re-verify before running the destructive part of Task 2.
- Pure logic (catalog builders, validation) gets Vitest tests. Page and flow correctness is verified by driving the real UI in a browser, per this project's convention.

---

### Task 1: shadcn/ui setup + Fresh Academic Teal theme + dark mode

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`, `package.json`, `components.json` (new)
- Create: `components/ui/*` (CLI-generated), `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `lib/utils.ts`

**Interfaces:**
- Produces: `cn()` from `@/lib/utils`, every shadcn primitive under `@/components/ui/*`, and a working `<ThemeToggle />`. Every later task consumes these.

- [x] **Step 1: Init shadcn**

Run:
```bash
npx shadcn@latest init -d -b neutral
```
Expected: `components.json` created, `lib/utils.ts` created with `cn()`, `class-variance-authority` + `clsx` + `tailwind-merge` + `lucide-react` installed, `app/globals.css` rewritten with shadcn's `:root` / `.dark` token blocks and `@theme inline` mapping.

If the CLI errors on Next 16 / React 19 peer deps, re-run with `--force`. Do not hand-write `components.json`.

- [x] **Step 2: Add the components**

Run:
```bash
npx shadcn@latest add button card dialog input label select table badge separator sonner radio-group alert dropdown-menu skeleton form textarea tooltip
```
Expected: files appear under `components/ui/`. `react-hook-form`, `@hookform/resolvers`, `zod`, `sonner`, `@radix-ui/*` get installed as needed.

- [x] **Step 3: Overwrite the palette with Fresh Academic Teal**

Edit `app/globals.css`, replacing shadcn's neutral `--primary` / `--accent` / `--background` / `--ring` values in **both** the `:root` and `.dark` blocks. Keep shadcn's variable *names* and its `oklch()`/hsl format convention — only the values change.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#FFFFFF` | `#0B1220` |
| `--foreground` | `#0F172A` | `#E2E8F0` |
| `--card` | `#FFFFFF` | `#111A2B` |
| `--muted` | `#F8FAFC` | `#111A2B` |
| `--primary` | `#0D9488` | `#2DD4BF` |
| `--primary-foreground` | `#FFFFFF` | `#04211D` |
| `--accent` | `#F59E0B` | `#FBBF24` |
| `--accent-foreground` | `#1C1400` | `#1C1400` |
| `--border` | `#E2E8F0` | `#1E293B` |
| `--ring` | `#0D9488` | `#2DD4BF` |

Also delete the leftover v1 `@media (prefers-color-scheme: dark)` block and the `body { font-family: Arial... }` rule — the font comes from the Geist variable already set on `<html>` in `layout.tsx`.

- [x] **Step 4: Wire next-themes**

Run `npm i next-themes`.

Create `components/theme-provider.tsx` as a `"use client"` re-export of `NextThemesProvider`.

Edit `app/layout.tsx`:
- add `suppressHydrationWarning` to `<html>`
- wrap `{children}` in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>`
- render `<Toaster />` from `@/components/ui/sonner` inside the provider
- set `className={"min-h-screen bg-background text-foreground antialiased"}` on `<body>`
- update `metadata` to `{ title: "Press Link", description: "DSPC entry management for Division of Sarangani" }`

Create `components/theme-toggle.tsx` — a `"use client"` `Button variant="ghost" size="icon"` toggling `light`/`dark` with `Sun`/`Moon` icons from lucide. Guard against hydration mismatch with a `mounted` state.

- [x] **Step 5: Verify**

Run: `npm run build` — expected: succeeds.
Run: `npm run dev`, open the printed port (read the log — port 3000 is occupied on this machine by an unrelated process), visit `/login`. Expected: page renders with the new tokens; toggling the OS theme no longer produces light controls on a dark background.

---

### Task 2: `event_types` data model

**Files:**
- Create: `supabase/migrations/0002_event_types.sql`, `supabase/migrations/0003_event_type_not_null.sql`
- Modify: `lib/events-catalog.ts`, `lib/events-catalog.test.ts`, `scripts/seed/events.ts`
- Create: `scripts/verify-event-types.ts`

**Interfaces:**
- Produces: `EVENT_TYPES: EventTypeSeed[]` (16 rows) and `EVENTS_CATALOG: EventSeed[]` (56 rows, each carrying `eventTypeSlug`), plus an `event_types` table and `events.event_type_id`. Task 5's wizard reads from these.

- [x] **Step 1: Restructure the catalog (TDD — test first)**

Edit `lib/events-catalog.test.ts` to assert, before touching the implementation:
- `EVENT_TYPES` has 16 entries: 10 `category: "individual"`, 6 `category: "group"`.
- Every `EVENT_TYPES` slug is unique; `sortOrder` values are unique.
- `EVENTS_CATALOG` has 56 entries; 38 individual, 18 group.
- **Every** code matches `/^[a-z0-9-]+-(elem|sec)-(eng|fil)$/` — this is the normalization fix; `online-publishing-eng` must become `online-publishing-sec-eng`.
- Every `EventSeed.eventTypeSlug` resolves to an `EVENT_TYPES` entry.
- `mojo`, `online-publishing`, `tv-broadcasting-regular`, `tv-broadcasting-spj` appear only with `level: "secondary"`.
- `EventSeed.name` equals the type's `nameFil` when `language === "filipino"`, `nameEn` otherwise.
- All codes are unique.

Run `npm test` — expected: **fails** (that is the point of this step).

- [x] **Step 2: Implement the restructure**

Rewrite `lib/events-catalog.ts`:

```ts
export type EventCategory = "individual" | "group";
export type EventLevel = "elementary" | "secondary";
export type EventLanguage = "english" | "filipino";

export interface EventTypeSeed {
  slug: string;
  category: EventCategory;
  nameEn: string;
  nameFil: string;
  /** levels this type is offered at */
  levels: readonly EventLevel[];
  sortOrder: number;
}

export interface EventSeed {
  code: string;
  eventTypeSlug: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  name: string;
  sortOrder: number;
}
```

Keep the existing display names verbatim from v1 (`Photojourn`, `Copy Editing & Headline Writing`, `Pagguhit ng Kartung Editoryal`, …) — they came from the source spreadsheet and must not drift. Group types and MOJO use the same string for `nameEn` and `nameFil`.

`EVENTS_CATALOG` becomes a single fold over `EVENT_TYPES × type.levels × languages`, which removes the special-case branch that caused the `{slug}-{lang}` inconsistency.

Run `npm test` — expected: passes.

- [x] **Step 3: Write migration 0002**

Create `supabase/migrations/0002_event_types.sql`:
- `create table event_types (id uuid pk default gen_random_uuid(), slug text unique not null, category text not null check (category in ('individual','group')), name_en text not null, name_fil text not null, sort_order int not null, created_at timestamptz default now())`
- `alter table event_types enable row level security;`
- `create policy "public read event_types" on event_types for select using (true);` — matches the `events` policy, since the wizard reads it from a logged-in school session.
- `alter table events add column if not exists event_type_id uuid references event_types(id);` — **nullable for now**, so the seed can backfill it.

Print the file and ask the user to run it in the Supabase SQL Editor. Wait for confirmation.

- [x] **Step 4: Update the seed**

Edit `scripts/seed/events.ts`:
1. Upsert `EVENT_TYPES` into `event_types` on conflict `slug`.
2. Read back `id, slug` to build a slug→id map.
3. Upsert `EVENTS_CATALOG` into `events` on conflict `code`, including `event_type_id`.
4. `delete from events where code not in (…all 56 codes)` — this is what removes the 6 stale `{slug}-{lang}` rows. Guard it: first `select count(*) from entries` and **abort with a clear error if it is not 0**, since deleting an event row with entries attached would either cascade or violate the FK.
5. Log final counts.

Keep the `isDirectRun` guard pattern already in the file — without it the script exits 0 having done nothing.

- [x] **Step 5: Run and verify the seed**

Run: `npm run seed` (or the events-only entry point).
Create `scripts/verify-event-types.ts` using `createAdminClient()` to assert: `event_types` count = 16, `events` count = 56, `events where event_type_id is null` = 0, and zero codes failing the `-(elem|sec)-(eng|fil)$` shape.
Run it. Expected: all assertions pass.

- [x] **Step 6: Write and apply migration 0003**

Create `supabase/migrations/0003_event_type_not_null.sql` with `alter table events alter column event_type_id set not null;`. Give it to the user to run. Re-run the verify script.

---

### Task 3: Login pages redesign

**Files:**
- Modify: `app/login/page.tsx`, `app/login/LoginForm.tsx`, `app/admin/login/page.tsx`, `app/admin/login/AdminLoginForm.tsx`, `app/page.tsx`
- Create: `components/brand/wordmark.tsx`

**Interfaces:**
- Consumes: Task 1 components. Produces: `<Wordmark />` used by login pages and both dashboard headers.

- [x] **Step 1: Wordmark**

Create `components/brand/wordmark.tsx` — a server component: a teal rounded-square icon tile (lucide `Newspaper`) beside "Press&nbsp;Link" in `font-semibold tracking-tight`, with a `size` prop (`sm` | `lg`) and an optional subtitle slot for "Division Schools Press Conference".

- [x] **Step 2: `/login`**

Rebuild as a centered `Card` on a subtle teal-tinted gradient background (`bg-gradient-to-b from-primary/5 to-background`), max-width ~`28rem`:
- `CardHeader`: `<Wordmark size="lg" />` + description
- `CardContent`: District `Select` (default "All districts"), School `Select` (filtered by district, `disabled` until schools load, searchable is out of scope — plain `Select` is fine), School ID `Input type="password"`
- `CardFooter`: full-width submit `Button` with a `Loader2` spinner while pending
- errors render in an `Alert variant="destructive"`, not raw text
- `<ThemeToggle />` pinned top-right of the page

**Keep the existing data logic unchanged** — the schools query must still select only `id, name, district_id`, never `school_id_number`.

- [x] **Step 3: `/admin/login`**

Same card shell, email + password `Input`s, and a muted "School sign-in →" link back to `/login`.

- [x] **Step 4: Verify in the browser**

Drive both pages: wrong school ID → destructive alert, correct → redirect to `/entry`; admin creds → `/admin`. Toggle dark mode on each. Expected: no console errors, no unstyled controls, no hydration warnings.

---

### Task 4: Entry dashboard shell + entries table

**Files:**
- Modify: `app/entry/page.tsx`, `app/entry/actions.ts`
- Create: `app/entry/EntriesTable.tsx`, `app/entry/EntryDashboard.tsx`, `app/entry/DashboardHeader.tsx`
- Delete (at the end of Task 6): `app/entry/EntryList.tsx`, `app/entry/SchoolPaperForm.tsx`

**Interfaces:**
- Produces: the dashboard layout with an action bar exposing `Create Entry`, `School Paper`, and per-row `Edit` / `Delete`. Tasks 5 and 6 mount their dialogs into it.

- [x] **Step 1: Server page**

`app/entry/page.tsx` stays a Server Component. It fetches, in parallel: the school (name + district name), `event_types`, `events`, this school's `entries` with nested participants/coaches and the joined event, the school's `school_papers`, and `app_settings.submissions_locked`. Pass everything down as props. Use `.overrideTypes<…>()` on the nested selects, as `app/admin/page.tsx` already does.

- [x] **Step 2: Header**

`DashboardHeader.tsx`: sticky top bar with `<Wordmark size="sm" />`, school name + district as muted text, a `Badge` with the entry count, `<ThemeToggle />`, and a sign-out `Button variant="ghost"` calling the existing `signOutAction`.

When `submissions_locked` is true, render an `Alert` under the header ("Submissions are closed…") and pass `locked` down so every mutating button is `disabled`.

- [x] **Step 3: Action bar + table**

`EntryDashboard.tsx` (`"use client"`) owns dialog open state. Action bar: `<Button>` **+ Create Entry** (primary), `<Button variant="outline">` **School Paper**, and — only if `school_papers` is missing for a language — an amber `Badge variant="outline"` nudge beside it.

`EntriesTable.tsx`: shadcn `Table` with columns Event · Level · Language · Participants · Coaches · Submitted · actions. Level and Language render as `Badge`s (teal for English, amber for Filipino; outline for Elementary, solid for Secondary). Participants shows the first name plus `+N` when it is a group entry. Submitted uses a stable `toLocaleDateString("en-PH", …)` format — compute it on the server and pass a preformatted string to avoid a hydration mismatch.

Actions column: `DropdownMenu` with **Edit** (opens the wizard prefilled at step 5) and **Delete** (opens an `AlertDialog` confirm, then calls the existing `deleteEntryAction`). Show `toast.success` / `toast.error` from sonner on the result.

Empty state: centered card with an icon, "No entries yet", and a **Create your first entry** button.

- [x] **Step 4: Verify**

Browser: sign in as a real school. Expected: header shows the right school and district, empty state renders, dark mode is coherent. With the admin lock toggled on, expected: the alert appears and both action-bar buttons are disabled.

---

### Task 5: Create Entry wizard

**Files:**
- Create: `app/entry/EntryWizard.tsx`, `app/entry/wizard-steps.ts`, `app/entry/wizard-steps.test.ts`
- Modify: `app/entry/actions.ts`

**Interfaces:**
- Consumes: `event_types` + `events` from Task 4's page, `saveEntryAction` from v1.
- Produces: the dialog that replaces `EntryList.tsx`'s inline form.

- [x] **Step 1: Step-derivation logic (TDD — test first)**

`wizard-steps.ts` holds **pure** functions over the fetched rows, so they are unit-testable without React:

```ts
export function typesForCategory(types: EventType[], category: EventCategory): EventType[];
export function levelsForType(events: Event[], typeId: string): EventLevel[];
export function languagesFor(events: Event[], typeId: string, level: EventLevel): EventLanguage[];
export function resolveEvent(events: Event[], typeId: string, level: EventLevel, language: EventLanguage): Event | undefined;
```

Write `wizard-steps.test.ts` first, against a fixture built from `EVENTS_CATALOG`:
- `typesForCategory(individual)` → 10, `(group)` → 6
- `levelsForType` for `news-writing` → both levels; for `mojo`, `online-publishing`, `tv-broadcasting-regular`, `tv-broadcasting-spj` → `["secondary"]` only
- `languagesFor` always → both
- `resolveEvent` returns exactly one row for every valid combination and `undefined` for `mojo` + `elementary`

Run `npm test` → fails → implement → passes.

- [x] **Step 2: The dialog**

`EntryWizard.tsx` (`"use client"`), a `Dialog` with a step indicator (numbered dots + labels, current step in primary, completed in muted). Local `step` state 1–5.

- Step 1 Category: two large selectable `Card`s (Individual / Group) with icon, name, and a one-line hint. Click selects and advances.
- Step 2 Event: a grid of selectable cards, one per `event_types` row for the chosen category, showing `nameEn` with `nameFil` beneath when they differ. Click advances.
- Step 3 Level: Elementary / Secondary cards, built from `levelsForType`. **If only one level is available, skip the step entirely** (auto-select and advance) — both when moving forward and when going back, so Back from step 4 on a Secondary-only event lands on step 2, not a dead step 3.
- Step 4 Language: English / Filipino cards from `languagesFor`.
- Step 5 Participants & Coaches: carries over v1's form fields. Participant rows = first / middle / last / gender `RadioGroup`. **Seed the row count from the resolved event's category — 1 for individual, 2 for group** (this was a real v1 bug: group forms opened with one row and could not validate). Add/Remove participant buttons, capped by the same rules `lib/validation/entry.ts` enforces. Coaches: 1–2 rows of complete name + gender.

A `Back` button on every step past the first; the primary button on step 5 is **Save entry**.

- [x] **Step 3: Submit**

Step 5's submit calls `saveEntryAction(entryId, input)` with the `event_id` from `resolveEvent`. Keep the action's explicit `Promise<{ error: string } | { success: true }>` return type. On success: close the dialog, `toast.success`, `router.refresh()`. On failure: keep the dialog open and show the message in an `Alert variant="destructive"` inside it.

Client-side, validate with the existing `lib/validation/entry.ts` schema before calling the action so the user gets field-level feedback; the action re-validates server-side regardless.

- [x] **Step 4: Edit mode**

`EntryWizard` accepts an optional `entry` prop. When present it opens at step 5 with everything prefilled and the event locked (shown as a read-only summary line with a "Change event" link that jumps back to step 1).

- [x] **Step 5: Verify in the browser**

Drive: individual entry end-to-end → appears in the table. Group entry → wizard opens step 5 with 2 participant rows → saves. A Secondary-only event → step 3 is skipped in both directions. Edit an entry, change a name, save → table updates. Delete → confirm → row disappears. Expected: all pass, no console errors.

---

### Task 6: School Paper dialog

**Files:**
- Create: `app/entry/SchoolPaperDialog.tsx`
- Modify: `app/entry/EntryDashboard.tsx`
- Delete: `app/entry/SchoolPaperForm.tsx`, `app/entry/EntryList.tsx`

**Interfaces:**
- Consumes: `saveSchoolPaperAction` from v1, unchanged.

- [x] **Step 1: The dialog**

`Dialog` with two `Tabs` — **English** and **Filipino** (add the `tabs` component if Task 1 skipped it). Each tab: paper name `Input`, adviser name `Input`, principal `Input`, and a repeatable staff list (name + role, minimum 2, matching `lib/validation/school-paper.ts`). A `Badge` on each tab shows "Complete" / "Incomplete".

Saving one language does not require the other; each tab has its own submit.

- [x] **Step 2: Delete the dead v1 components**

Remove `app/entry/SchoolPaperForm.tsx` and `app/entry/EntryList.tsx` and any remaining imports. Run `npm run build` — expected: clean, with no unused-import or missing-module errors.

- [x] **Step 3: Verify**

Browser: open the dialog, fill English only, save, reopen → values persisted, English tab reads "Complete", Filipino reads "Incomplete". Try saving with 1 staff member → validation error, no write.

---

### Task 7: Admin dashboard redesign

**Files:**
- Modify: `app/admin/page.tsx`, `app/admin/FilterBar.tsx`, `app/admin/LockToggle.tsx`

**Interfaces:**
- **Filter semantics do not change.** School and event stay filtered in the query; district, category and language stay filtered in JS after the fetch. URL query state is preserved exactly.

- [x] **Step 1: Shell + stats**

Reuse `DashboardHeader`'s look (wordmark, theme toggle, sign out). Add a row of four stat `Card`s: total entries, participating schools, individual entries, group entries — all derived from the already-fetched rows, no extra queries.

- [x] **Step 2: Filter bar**

Rebuild `FilterBar.tsx` with shadcn `Select`s in a `Card`, laid out `grid gap-3 sm:grid-cols-2 lg:grid-cols-5`, plus a **Clear filters** `Button variant="ghost"` that appears only when at least one filter is active. Keep the existing `router.push` query-string behaviour verbatim.

Add a **Level** select while here — v1 had district / school / event / category / language but no level, and level is now a first-class wizard step. Filter it in JS alongside district.

- [x] **Step 3: Table**

shadcn `Table`: School · District · Event · Level · Language · Participants · Coaches · Submitted. Same `Badge` conventions as the entry dashboard. Sticky header, horizontal scroll inside the card on narrow viewports. Empty state: "No entries match these filters."

- [x] **Step 4: Lock toggle**

`LockToggle.tsx` becomes a `Button` (destructive when unlocking-is-the-action, primary otherwise) wrapped in an `AlertDialog` confirmation that names the consequence: "Schools will no longer be able to create or edit entries." Toast the result.

- [x] **Step 5: Verify**

Browser as admin: create entries from two different schools first, then check each filter narrows correctly and the URL updates; Clear filters resets. Toggle the lock and confirm the school-side `/entry` page reflects it immediately. Expected: all pass.

---

### Task 8 *(optional)*: Export to Excel

**Files:**
- Create: `app/admin/export/route.ts`, `lib/export/entries-workbook.ts`, `lib/export/entries-workbook.test.ts`
- Modify: `app/admin/FilterBar.tsx`

- [x] **Step 1: Workbook builder (TDD)**

`lib/export/entries-workbook.ts` — a pure function from entry rows to a `xlsx` workbook (SheetJS is already a dependency from seeding). One row per participant, columns: School, District, Event, Level, Language, Participant Name, Gender, Coach(es), Submitted. Test it against fixtures: a group entry with 3 participants yields 3 rows carrying identical entry-level fields.

- [x] **Step 2: Route handler**

`app/admin/export/route.ts` — a Node-runtime `GET` that re-checks `admin_profiles` for the caller (a route handler is publicly reachable; do not rely on `proxy.ts` alone), applies the same filters from `searchParams`, and returns the workbook with `Content-Disposition: attachment; filename="press-link-entries-<date>.xlsx"`.

- [x] **Step 3: Button + verify**

Add **Export** `Button variant="outline"` to the filter bar, linking to `/admin/export?<current query string>` so the export honours the on-screen filters. Verify by downloading with a filter applied and opening the file.

---

## Post-implementation

- [x] `npm run build` and `npm test` both clean
- [x] `npx tsc --noEmit` clean
- [x] Commit, push to `main` on `github.com/Chibiby/press-link`
- [x] Deploy: `vercel --prod`, then re-verify `https://press-link-delta.vercel.app` — `/login`, a school sign-in, the wizard, and `/admin` — in a real browser, checking the page title rather than just the HTTP status (a 200 from Vercel's own SSO login page is a known false positive on this project)

---

## Execution notes (2026-08-13)

Things that differed from the plan as written:

- **shadcn CLI has changed.** `-b` is now the component library (`radix` | `base` | `aria`), not the base colour, and init requires a preset. The working command is
  `npx shadcn@latest init -b radix -p nova -y --css-variables --force`.
- **`--accent` stayed a quiet hover surface.** shadcn uses `--accent` for menu, table and item hover states, so painting it amber turned every hover orange. Amber moved to a dedicated `--warning` token used by badges and the "to fill" nudge.
- **Missing label associations were a real bug, not a test artifact.** The wizard's `Field`, the School Paper inputs and the admin filters all rendered a `<Label>` with no `htmlFor`, so screen readers (and `getByLabel`) could not connect them. Fixed by wrapping the control in the label (wizard) and by explicit `htmlFor`/`id` pairs (paper dialog, filters).
- **`@/` needed a Vitest alias.** `vitest.config.ts` gained a `resolve.alias` entry once tests started importing through the alias.
- **`xlsx` moved from devDependencies to dependencies** once `app/admin/export/route.ts` imported it at runtime.
- **Radix `Select` forbids an empty item value**, so the admin filters use an `__any__` sentinel that maps back to "remove this query param".

Verified end-to-end in Chromium against the live database, with zero console errors:
login (wrong and right password) · empty dashboard · individual entry (1 participant row) · secondary-only group event skipping the level step forward *and* backward · group entry opening with 2 participant rows · School Paper save and "Complete" badge · edit prefill and save · delete with confirm · admin district/school/event/category/level/language filters · Clear filters · filtered Excel export · lock toggle reflected on the school's `/entry` page.
