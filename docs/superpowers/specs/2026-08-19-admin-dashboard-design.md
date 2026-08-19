# Division Admin Dashboard — Design

**Date:** 2026-08-19
**Status:** Approved, ready for implementation planning
**Scope:** Replace the bare `/admin` entries table with a shell-and-dashboard admin
surface, modelled on the supplied reference comp, over the existing production database
without schema change.

---

## 1. Context

`/admin` is currently a single page: a header, eight stat cards, a filter bar and an
entries table. The three sibling pages (`participants`, `coaches`, `school-papers`) each
repeat the same `DashboardHeader` + `min-h-screen` + `max-w-6xl` scaffold. There is no
persistent navigation; moving between admin pages means using in-page buttons.

The reference comp asks for a persistent sidebar shell, a dashboard overview with KPI
tiles, a per-school summary, a per-event donut, a competition timeline, four portal cards
and a recent-activity feed.

**The system is in production with live data.** The design is therefore constrained to
additive, read-only work.

### 1.1 Live data as of 2026-08-19

Measured directly against production in a read-only session:

| Table | Rows |
|---|---|
| `schools` | 332 (all have logins) |
| `districts` | 23 |
| `participants` | 383 |
| `coaches` | 83 |
| `entries` | 130 |
| `entry_participants` | 269 |
| `entry_coaches` | 133 |
| `events` | 56 (38 individual, 18 group) |
| `event_types` | 16 |
| `school_papers` | 29 (15 English, 14 Filipino — all submitted) |
| `paper_staff` | 58 |
| `admin_profiles` | 1 |

Engagement, which differs sharply from registration:

- 16 schools have at least one entry; 22 have participants; 24 have a school paper.
- 10 of 23 districts have any entry.
- 114 of 383 participants (30%) are not linked to any entry.
- 17 of 83 coaches are not linked to any entry.
- 12 of 16 event types have at least one entry.
- 3 schools have `submission_locked_at` set; no school with an entry is locked, so
  registration is open everywhere it matters.
- **There is no division-wide lock flag.** Migration `0010_drop_submissions_lock.sql`
  drops `app_settings` and its `submissions_locked` column; the spec it implements records
  "Nothing reads `app_settings` after this task." The lock is per-school
  (`schools.submission_locked_at`, written by the `lock_submission` and
  `admin_unlock_submission` RPCs). Whether 0010 reached production is unknown — the same
  partial-migration hazard documented in `0015_restore_coach_name_parts.sql` applies — and
  it does not matter: if the table survives, nothing has written it since 2026-08-14, so
  its value is stale either way. **Do not query `app_settings`.**
- `paper_participation`: 8 `yes`, 16 `no`, 308 `undecided`.
- `coaches.first_name` / `last_name` are blank in 0 rows.

Entry distribution by event type, highest first: feature-writing 22, editorial-cartooning
18, copy-editing 18, news-writing 14, sports-writing 14, editorial-writing 11,
column-writing 11, photojournalism 11, sci-tech-writing 6, mojo 2,
radio-broadcasting-spj 2, radio-broadcasting-regular 1. Four group types have zero
entries: collaborative-publishing, online-publishing, tv-broadcasting-regular,
tv-broadcasting-spj.

**The comp's numbers (13 schools, 118 learners, 13 coaches, 115 entries, 7 events, 3
districts) do not match production.** The comp was drawn against a pilot subset.
This design keeps the comp's *layout* and replaces its *numbers and semantics* with the
real ones. Where the real data shape breaks the comp's layout, this document says so and
states the substitution.

### 1.2 Two unresolved data questions

Recorded, not resolved, and explicitly **not** something the dashboard will paper over:

1. 24 schools have `school_papers` rows but only 8 carry
   `paper_participation = 'yes'`. A plausible cause is
   `admin_reset_paper_participation` having been used after papers were created, but
   this is unverified. The dashboard displays paper count and participation split as
   **separate** figures and derives no combined "papers" KPI from them.
2. 114 participants exist with no entry link. This may be normal mid-registration state
   or abandoned data entry. The dashboard surfaces it as an attention item rather than
   assuming which.

---

## 2. Non-goals

- No database migration. No schema, RPC, trigger, policy or seed change of any kind.
- No new write path. Every page added here is `SELECT`-only.
- No change to `/admin/login`, `proxy.ts`, `app/admin/guard.ts`, `app/admin/actions.ts`,
  or the `/admin/export` response contract.
- No role hierarchy. `admin_profiles` has one flat role and this design does not invent
  tiers.
- No charting dependency.
- No judging, tabulation, scoring or results data. None exists.

---

## 3. Architecture

### 3.1 Shell via route group

`/admin/login` renders full-screen and must not receive the sidebar. A layout at
`app/admin/layout.tsx` would wrap it, and layouts cannot opt out. Next 16's documented
answer is a route group: *"To opt specific routes into a layout, create a new route group
and move the routes that share the same layout into the group. The routes outside of the
group will not share the layout."* Route groups do not appear in the URL.

```
app/admin/
  guard.ts                       UNCHANGED
  actions.ts                     UNCHANGED
  login/                         UNCHANGED — outside the group, no shell
  export/route.ts                UNCHANGED
  (shell)/
    layout.tsx                   NEW    sidebar + topbar + DepEd footer
    page.tsx                     NEW    Dashboard Overview           -> /admin
    entries/page.tsx             MOVED  from app/admin/page.tsx      -> /admin/entries
    entries/FilterBar.tsx        MOVED  from app/admin/FilterBar.tsx
    participants/                MOVED  URL unchanged
    coaches/                     MOVED  URL unchanged
    school-papers/               MOVED  URL unchanged
    overall-data/page.tsx        NEW    full per-school + per-event breakdown
    overall-data/export/route.ts NEW    xlsx of the per-school summary
    summary/page.tsx             NEW    Summary of Registration
    schools/page.tsx             NEW    all 332 schools, read-only
    districts/page.tsx           NEW    23 districts with rollups, read-only
    events/page.tsx              NEW    56 events / 16 types, read-only
    activity/page.tsx            NEW    full activity feed
    judges/page.tsx              NEW    Soon
    tabulators/page.tsx          NEW    Soon
    users/page.tsx               NEW    Soon
    settings/page.tsx            NEW    Soon
    audit-logs/page.tsx          NEW    Soon
```

`proxy.ts`'s matcher is `/admin/:path*`, which already covers every new route. No proxy
change.

### 3.2 Moving the four existing pages

Each moved page:

1. loses its `<DashboardHeader ... />`;
2. loses its `<div className="flex min-h-screen flex-col">` and
   `<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">` wrappers, which the
   shell now owns;
3. keeps its queries, its `searchParams` contract, its server actions and its URL
   verbatim.

`app/admin/page.tsx` becomes `app/admin/(shell)/entries/page.tsx`. Its imports change
from relative (`./guard`, `./actions`, `./FilterBar`) to the `@/` alias where they now
point outside the group — `tsconfig.json` maps `@/*` to `./*`, so `@/app/admin/guard`
resolves.

`FilterBar.tsx` hardcodes `/admin` in two places: the push in the filter-change handler
and the push in the clear handler. Both become `/admin/entries`. This is the only edit to
moved logic.

### 3.3 Shell components

Under `components/admin/shell/`:

| File | Kind | Responsibility |
|---|---|---|
| `Sidebar.tsx` | client | Exports three: `AdminNav` (nav render, `usePathname` active state, Soon chips), `Sidebar` (the desktop rail — owns the collapse state and its `localStorage` preference), `SidebarFooter` (the three real logos + version) |
| `MobileNav.tsx` | client | The drawer below `lg`; renders the same `AdminNav` |
| `Topbar.tsx` | server | Wordmark on narrow screens, an `actions` slot, theme toggle, sign out |
| `PageHeading.tsx` | server | Per-page title, status badge, subtitle, actions |
| `AttentionBell.tsx` | client | Attention popover |
| `UserChip.tsx` | server | Admin name and role label |
| `soon-page.tsx` | server | Shared scaffold for the five Soon pages |

Three of these are one file rather than the several a first sketch would give them.
`AdminNav`, `Sidebar` and `SidebarFooter` share a file because the rail and the drawer render
the identical nav and the identical footer lockup; splitting them would create two imports
whose only job is to stay in sync. The event title and status pill are *not* in the topbar:
a layout cannot know which page rendered beneath it, so they belong to `PageHeading`, which
each page fills in.

The nav tree itself and its active-path matching live in `lib/admin/nav.ts` — a pure,
tested module, consistent with the repo's convention of colocating tests beside pure `lib`
code. The sidebar consumes it and holds no route knowledge of its own.

Nav structure. The comp shows two groups; this is seven, because the comp's sidebar does not
carry the four pages that already exist and must keep working (§3.2). Fifteen items in two
groups would be a wall; the grouping is what makes it scannable.

- **Overview** — Dashboard
- **Submissions** — Entries, School Papers
- **Roster** — Participants, Coaches
- **Reference** — Schools, Districts, Events
- **Reports** — School Summary, Overall Data, Activity Log
- **Adjudication** — Judges Portal *(Soon)*, Tabulators *(Soon)*
- **System** — Users & Access *(Soon)*, Settings *(Soon)*, Audit Logs *(Soon)*
- Footer — DepEd lockup + version. The comp's **Export All Reports** sits in the dashboard's
  own heading instead, relabelled per §4.1: it exports entries, and only the dashboard's
  export is division-wide.

An item is one of three things, and the distinction is load-bearing: a plain link, a `stub`
(the page exists and explains itself — clickable, with a "Soon" pill), or `soon` (no route
yet — shown, never linked). Nothing is ever a dead link.

### 3.4 Theme

The admin shell is dark-first without overriding the user's choice. A small client
component reads next-themes' stored preference on mount; if none has ever been stored, it
sets `dark` once. An explicit choice always wins, and the toggle in the user menu keeps
working. `app/layout.tsx`'s `defaultTheme="light"` is untouched, so the school-facing app
is unaffected.

---

## 4. Comp element mapping

Every element in the reference, with its verdict. Nothing renders a number it cannot
source.

| Comp element | Verdict | Source |
|---|---|---|
| Sidebar nav + active state + collapse | REAL | `usePathname` |
| Export All Reports | REAL, **relabelled** | existing `/admin/export`; the button reads "Export entries" — §4.1 |
| DepEd footer lockup | REAL | `logo-deped-matatag.png`, `logo-deped-sarangani.png`, `logo-bagong-pilipinas.png` |
| Wordmark + "Division Admin" | REAL | `components/brand/wordmark.tsx` |
| KPI Schools | REAL, re-framed | 16 with entries **of 332 registered** |
| KPI Learners | REAL | 383 participants |
| KPI Coaches | REAL | 83 coaches |
| KPI Total Entries | REAL | 130 entries |
| KPI Events | REAL, re-framed | 12 contested **of 16 types** |
| KPI Districts | REAL, re-framed | 10 active **of 23 registered** |
| Per School Summary table | REAL, **top 15 + division-wide TOTAL** | §5.2 |
| Export to Excel | REAL | new `overall-data/export` route |
| Per Event donut + legend + centre total | REAL | top 8 event types + Other; §5.3 |
| COMPETITION STATUS pill | REAL, **retitled** | per-school `schools.submission_locked_at` -> "Registration Open" / "Registration Closed"; §5.6 owns the derivation so the pill and the timeline cannot disagree. *Not* "Judging in Progress" — no judging data exists |
| "SCHOOLS PRESS CONFERENCE 2026" + date | REAL | static title; live `Intl.DateTimeFormat("en-PH")` |
| User chip | REAL name, **honest role** | `admin_profiles.full_name`; role reads "Division Admin", not "Super Administrator" |
| Recent Activity + View All | REAL, derived | §5.5 |
| Timeline step 1 (Registration) | REAL, derived | §5.6 |
| Timeline steps 2-5 (Judging R1/R2, Tabulation, Final Results) | **SOON** | rendered in place, dimmed, "Not yet available" |
| Portal card: Registration | REAL | -> `/admin/entries`, working event select + export |
| Portal card: Summary of Registration | REAL | -> `/admin/summary` |
| Portal card: Judges | **SOON** | disabled select, Soon badge, card states what it needs |
| Portal card: Tabulators | **SOON** | as above |
| Notification bell + badge | **SOON popover, real count** | badge counts real attention items (§5.4); popover explains that alerting itself is coming. No invented number |
| Footer version | REAL | `0.1.0` from `package.json`, not the comp's `1.0.0` |

### 4.1 Named substitutions

Four comp labels are replaced because the data cannot honestly support them:

1. **"Judging in Progress (Round 1)" -> "Registration Open" / "Registration Closed."**
   Derived by aggregating the per-school `schools.submission_locked_at`: closed only once
   every school holding an entry is locked. A manually-set phase label, or a restored
   division-wide flag, would require a schema change and is out of scope.
2. **"Super Administrator" -> "Division Admin."** `admin_profiles` has one flat role.
3. **Event names.** The comp's "Copyreading" and "Broadcasting" do not exist. The
   catalog's names are used: "Copy Editing & Headline Writing", "Radio Broadcasting",
   "Photojourn", "Science & Technology Writing", and so on, from
   `lib/events-catalog.ts`.
4. **"Export All Reports" -> "Export entries."** The button points at the existing
   `/admin/export`, which builds one workbook of entries. It is not all reports — the
   per-school and per-district reports are separate exports on their own pages — and a
   button promising more than it delivers is the one kind of label this design will not
   ship. The route itself is untouched.

### 4.2 Renamed nav items

§4.1 lists labels the data cannot support. These four are a different thing: the data is
fine, the comp's word is simply the wrong one for where it sits.

1. **"Registration" -> "Entries."** The page it opens is `/admin/entries` and every row in
   it is an entry. "Registration" is the *act*; the nav names *things*, like every other
   item in the list.
2. **"Users & Roles" -> "Users & Access."** `admin_profiles` has one flat role (§4.1 item 2),
   so a page called "Roles" would promise a concept the schema does not have. "Access" is
   what the page will actually govern: who may sign in.
3. **"Tabulators Portal" -> "Tabulators"**, and the matching card likewise. Its neighbour
   already reads "Judges Portal" in the nav because that is the portal's own name; the
   tabulation side has no such name, and "Portal" twice in a two-item group reads as
   boilerplate.
4. **"Summary of Registration" -> "School Summary" *in the nav only*.** The page keeps the
   full title, and so does its portal card. Fifteen nav items in a 16rem rail cannot each
   carry four words; the nav label says which summary, and the page says the rest.

Nothing else in the comp is renamed. Where a label survives, it survives verbatim.

---

## 5. Dashboard panels

All derivations live in pure modules under `lib/dashboard/`, each with a colocated vitest
file, matching the repo's existing `lib/**/*.test.ts` convention. Pages fetch, hand off to
a pure function, and render.

### 5.1 KPI tiles — `lib/dashboard/kpis.ts`

Six tiles in the comp's 6-up grid. Each is a headline number plus a denominator subtitle,
because a bare count of a 332-row `schools` table misleads:

| Tile | Headline | Subtitle |
|---|---|---|
| Registered Schools | schools with >= 1 entry | `of N registered` |
| Learners | participants | `N not yet entered` |
| Coaches | coaches | `N not yet entered` |
| Total Entries | entries | `N individual / N group` |
| Events | event types with >= 1 entry | `of N types` |
| Districts | districts with >= 1 entry | `of N registered` |

Plain totals use `select("*", { count: "exact", head: true })` so no rows cross the wire.
Engagement counts that a single count cannot express are derived from one grouped select
over `entries` joined to `schools` and `events`, then folded in JS.

### 5.2 Per School Summary — `lib/dashboard/per-school.ts`

The comp shows every school. Production has 332, which no dashboard panel can hold.

- Query only schools with at least one participant, coach or entry. Measured today: 22
  schools have participants and 16 have entries, so this set is roughly two dozen rows.
  The exact figure is computed at render time, never hardcoded.
- Sort by entries descending; render the **top 15**.
- The **TOTAL row sums all 332 schools**, not the 15 rendered. The panel labels this
  explicitly so a truncated view is never mistaken for the whole division.
- A "View all 332 schools ->" link goes to `/admin/overall-data`, which renders the full
  set with filters and its own Excel export.

Columns follow the comp: School, District, Learners, Coaches, Total. Fetched with an
embedded aggregate select over `schools` using `participants(count)`, `coaches(count)`
and `entries(count)`, unwrapping Supabase's `{count}[]` arrays the way
`app/admin/participants/page.tsx` already does for `school_papers(count)`.

### 5.3 Per Event donut — `lib/dashboard/per-event.ts` + `lib/dashboard/donut.ts`

Entries group to `event_types`, not `events`: 56 event rows produce an unreadable legend
while 16 types produce the comp's short one.

- Types with zero entries are excluded — 4 today.
- Top 8 by entry count render as individual slices; the remainder collapses into
  **Other**. Today that is 119 of 130 entries in the top 8 (92%) and 11 in Other.
- The centre label shows total entries, as in the comp.
- The legend lists each slice with its count and share.

`donut.ts` holds the arc geometry — a pure function from `{value, colorToken}[]` to SVG
path strings — and is unit tested independently of React. The chart is hand-rolled SVG:
the repo has no charting dependency and one donut does not justify adding one. The
`dataviz` skill is to be loaded before this module is written.

### 5.4 Needs attention — `lib/dashboard/attention.ts`

Replaces the comp's invented bell badge with real, actionable counts:

- participants registered with no entry — 114 today;
- coaches registered with no entry — 17;
- schools with participants but no entry;
- schools still `undecided` on paper participation — 308.

Each links into the relevant existing page filtered to that condition. The bell badge
shows how many of these categories are non-zero.

### 5.5 Recent Activity — `lib/dashboard/activity.ts`

No schema change needed: six timestamp columns already exist. Six small
`order(..., { ascending: false }).limit(8)` queries, merged and re-sorted by one pure
function, then sliced to 5 for the dashboard and 50 for `/admin/activity`.

| Source | Renders as |
|---|---|
| `entries.submitted_at` | entry submitted — school, event |
| `participants.created_at` | learner registered — number, name |
| `coaches.created_at` | coach added — school |
| `schools.paper_answered_at` | paper question answered |
| `schools.submission_locked_at` | submission locked |
| `school_papers.updated_at` | paper details updated |

`participants.participant_number` makes the comp's `PL-ED-115` style identifier
genuinely reproducible.

Live data spans 2026-08-17 to 2026-08-19, so the feed is populated.

### 5.6 Timeline — `lib/dashboard/timeline.ts`

Five steps, as in the comp. Only the first is derivable.

- **Registration** — aggregated from per-school locks, since no division-wide flag exists.
  `COMPLETED` only when at least one school is locked and **no school holding an entry is
  still unlocked**; `IN PROGRESS` otherwise. Counting locked schools alone is not enough: a
  school may lock with zero entries, so `locked >= active` can hold while an active school
  is still open. The sub-line reports schools locked and entries submitted. The same
  function returns the COMPETITION STATUS pill's label, so the two cannot disagree.
- **Judging Round 1**, **Judging Round 2**, **Tabulation**, **Final Results** — rendered
  in the comp's positions, dimmed, each labelled "Not yet available" with one line on what
  it will need. They are not shown as `PENDING`, which would imply a pipeline that exists.

### 5.7 Portal cards

Four cards in the comp's 2x2 grid. Each has a Quick Access select and two actions.

- **Registration** — event select populated from the catalog **grouped by type, level and
  language**; a flat 56-item list is unusable. "Go to Portal" -> `/admin/entries` carrying
  the selected event as `?event=`; "Export" -> `/admin/export` with the same query.
- **Summary of Registration** -> `/admin/summary`.
- **Judges** and **Tabulators** — Soon. Select disabled, badge shown, body states what the
  feature will do and what data it needs first. Titled without the comp's "Portal" suffix
  (§4.2); the card *is* the portal entrance, so the word adds nothing.

---

## 6. Soon pages

Five routes exist and are navigable so the sidebar has no dead links: `judges`,
`tabulators`, `users`, `settings`, `audit-logs`.

Each renders through `soon-page.tsx`: the page title, a "Coming soon" badge, a short
statement of what the page will do, a bulleted list of what must exist first (for judges:
an event-scoped scoring schema, judge accounts, criteria per event type), and a link back
to the dashboard. No fake tables, no placeholder rows, no disabled forms that imply a
shipped feature.

`settings` additionally shows the one real, division-wide piece of configuration state that
can be read — the per-school submission-lock tally from §5.6 — as read-only text, and notes
that locking and unlocking is done per school from the school-papers page, since it is a
write and out of scope. It does **not** offer a division-wide toggle: that flag was dropped
in migration `0010` and restoring it is a schema change.

---

## 7. Design tokens

`app/globals.css` already defines all eight `--sidebar-*` tokens and `--chart-1` through
`--chart-5` in both `:root` and `.dark`, and maps them in `@theme inline`. The shell
therefore needs no new surface tokens.

The donut needs nine slices. The existing `--chart-1` … `--chart-5` cannot supply the first
five: three of them are near-identical teals, one falls under the chroma floor and one sits
above the lightness band, so a ring built from them is unreadable — and unreadable for
colourblind readers in particular. The `dataviz` validator (`scripts/validate_palette.js`)
reports this as a hard fail, not a matter of taste.

So the nine chart slots are **replaced** with a validated categorical palette:

- redefine `--chart-1` … `--chart-5` and add `--chart-6`, `--chart-7`, `--chart-8` and
  `--chart-other` in `:root`;
- do the same in `.dark`, with that mode's own validated steps — not an automatic lightening
  of the light values;
- map all nine in `@theme inline`.

**This is the one exception to "no existing token is redefined", and it is safe for a
specific, checkable reason:** nothing in the application reads `--chart-*` today. They ship
with the shadcn theme and no component has ever used them. The implementation task proves
this by grep before touching the file, and stops if the grep finds a consumer.

Every other token is untouched. Timeline and status states reuse `--primary`, `--warning` and
`--muted-foreground`; the teal brand tokens — `--primary`, `--sidebar-*`, `--accent`, `--ring`
— keep their exact current values, so the four existing admin pages and the whole
school-facing app are visually unaffected.

---

## 8. Testing

TDD, colocated, matching the existing convention.

| Module | Covers |
|---|---|
| `lib/dashboard/kpis.test.ts` | denominators, zero rows, engagement vs registration |
| `lib/dashboard/per-school.test.ts` | rollup, sort, top-15 slice, division-wide TOTAL |
| `lib/dashboard/per-event.test.ts` | grouping to types, zero-entry exclusion, top-8 + Other |
| `lib/dashboard/donut.test.ts` | arc geometry, single slice, empty set, rounding |
| `lib/dashboard/activity.test.ts` | merge order, label shape, null timestamps |
| `lib/dashboard/timeline.test.ts` | open vs locked, Soon steps |
| `lib/dashboard/attention.test.ts` | each attention count, all-clear state |
| `lib/admin/nav.test.ts` | active-path matching, including nested routes |

Edge cases drawn from real data that the tests must cover: an empty result set, a school
with participants but zero entries, an event type with zero entries, a blank coach name,
and `submitted_at` being null.

Manual verification after implementation: all four moved pages load at their original URLs
with filters and exports intact; `/admin/login` renders with no shell; sign-out works; the
theme toggle persists; `/admin/export` returns the same workbook.

---

## 9. Production safety

Hard constraints. Violating any of these risks live data.

1. **No migration.** No file is added to `supabase/migrations/`.
2. **Read-only.** Every new query is a `SELECT`. No new server action, RPC or mutation.
3. **Do not touch the lock machinery** from `0011_submission_lockdown.sql`: the seven
   `*_locked_guard` triggers, `reject_locked_submission`, `reject_locked_paper_staff`,
   `reject_locked_entry_link`, `lock_submission`, `admin_unlock_submission`,
   `set_paper_participation`, `admin_reset_paper_participation`.
4. **Do not change signatures** of `adminSignOutAction`, the school-papers actions or the
   participants actions.
5. **Do not change** the `/admin/export` query params, filename or headers.
6. **Do not touch** `app/admin/login/**` or `proxy.ts`'s matcher.
7. **Tolerate blank coach names.** `coaches.first_name` / `last_name` default to `''`
   after `0015_restore_coach_name_parts.sql`. Zero rows are blank today, but the schema
   permits it; render through the existing `surnameFirst()` and handle empty output.
8. **Never render `events` as a flat list.** 56 rows; group by type, level and language.
9. **Never label a truncated list as complete.** Any top-N panel states its cutoff and
   links to the full view.

---

## 10. Implementation phasing

This is a large surface. It is built in five phases, each independently verifiable, so a
regression in the existing pages is caught before new pages accumulate on top of it. Phase
1 is the only phase that touches code already in production; it must be proven before
anything else starts.

**Phase 1 — Shell and relocation.** Route group, `layout.tsx`, the shell components,
`lib/admin/nav.ts` and its test, additive token block. Move the four existing pages, strip
their headers and wrappers, retarget `FilterBar`. **Gate:** `/admin/entries`,
`/admin/participants`, `/admin/coaches` and `/admin/school-papers` all load with filters,
exports and server actions intact; `/admin/login` renders with no shell; `/admin/export`
returns a byte-identical workbook. Nothing proceeds until this holds.

**Phase 2 — Dashboard Overview.** The `lib/dashboard/` pure modules and their tests
first, then `(shell)/page.tsx`: KPI tiles, per-school summary, donut, timeline, portal
cards, activity feed.

**Phase 3 — Soon pages.** `soon-page.tsx` and the five stubs, so the sidebar has no dead
links.

**Phase 4 — Read-only detail pages.** `overall-data` (plus its export route), `summary`,
`schools`, `districts`, `events`, `activity`.

**Phase 5 — Verification.** Full `npm test`, `npm run lint`, `npm run build`, and the
manual pass in §8.

---

## 11. Open items

- The `paper_participation` vs `school_papers` discrepancy (§1.2) is surfaced, not
  resolved. If it proves to be a bug, fixing it is a separate task with its own design.
- A manually-settable competition phase would let the status pill read "Judging in
  Progress" as the comp shows. That needs one additive column and is deliberately
  deferred rather than smuggled in.
