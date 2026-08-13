# Press Link — Design Spec

## 1. Overview

Press Link is a web app for organizing school-level entries into a DepEd
Division Schools Press Conference (DSPC). Schools log in with a shared,
per-school credential and submit their School Paper info plus their
contestant/team entries for individual and group journalism events. A
division admin reviews, filters, and organizes all submissions across
districts, schools, and events.

**Reference data** (used for seeding, not committed to the repo as raw files):
- `ALABEL-1-DISTRICT_DSPC-2025.xlsx` — source of the event catalog and the
  real-world entry form fields (individual and group events, school paper
  fields).
- `List-of-School-Heads-as-of-July-6-2026-with-school-Address.xlsx` — source
  of District / School Name / School ID. Only these three columns are
  ingested; all other columns (school head name, phone, personal email, FB
  name, address) are ignored and the raw file is never committed to the repo
  or database.

## 2. Users & Roles

| Role | Identity | How they authenticate |
|---|---|---|
| School (data entry) | One shared account per school | Pick district (optional filter) → pick school → enter the school's DepEd School ID as the password |
| Admin | Division-level staff | Normal email + password |

There is no per-student or per-teacher login. Everyone at a school shares
the one school account.

## 3. Data Model

Postgres via Supabase. All tables live in the `public` schema unless noted.

### `districts`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| name | text unique not null | e.g. `"Alabel 1"` |

Seed values (trimmed, deduped from the school-heads file's District column):
`Alabel 1, Alabel 2, Alabel 3, Alabel 4, Glan 1, Glan 2, Glan 3, Glan 4,
Kiamba 1, Kiamba 2, Kiamba 3, Maasim 1, Maasim 2, Maasim 3, Maitum 1,
Maitum 2, Malapatan 1, Malapatan 2, Malapatan 3, Malungon 1, Malungon 2,
Malungon 3, Malungon 4` (23 districts). The source column has inconsistent
trailing whitespace (`"Alabel 2 "` vs `"Alabel 2"`) — the seed script must
`.trim()` before dedup/insert.

### `schools`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| district_id | uuid not null references districts(id) | |
| name | text not null | e.g. `"Alabel Integrated SPED Center"` |
| school_id_number | text unique not null | e.g. `"500282"` — the DepEd School ID, used as the login password |
| auth_user_id | uuid unique not null references auth.users(id) | the synthetic Supabase Auth user backing this school's session (see §4) |
| created_at | timestamptz not null default now() | |

~332 rows seeded from the school-heads file.

### `admin_profiles`
| column | type | notes |
|---|---|---|
| user_id | uuid pk references auth.users(id) | |
| full_name | text not null | |

Presence of a row = the user is an admin. No roles beyond "admin" for v1
(YAGNI — add a `role` column later if a second admin tier is ever needed).

### `events`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| code | text unique not null | stable slug, e.g. `news-writing-elem-eng` |
| category | text not null check (category in ('individual','group')) | |
| level | text not null check (level in ('elementary','secondary')) | |
| language | text not null check (language in ('english','filipino')) | |
| name | text not null | the event's display name **in its own language**, e.g. `"News Writing"` or `"Pagsulat ng Balita"` |
| sort_order | int not null | for stable list ordering in the UI |

Full seed catalog (56 rows), transcribed from the EVENTS sheet — code
pattern is `{slug}-{elem|sec}-{eng|fil}`:

**Individual — Elementary — English** (9): News Writing, Editorial Writing,
Column Writing, Feature Writing, Science & Technology Writing, Editorial
Cartooning, Photojourn, Sports Writing, Copy Editing & Headline Writing.

**Individual — Elementary — Filipino** (9): Pagsulat ng Balita, Pagsulat ng
Editoryal, Pagsulat ng Kolum, Pagsulat ng Lathalain, Pagsulat ng Agham at
Teknolohiya, Pagguhit ng Kartung Editoryal, Pagkuha ng Larawang
Pampahayagan, Pagsulat ng Isports, Pagwawasto at Pag-uulo ng Balita.

**Individual — Secondary — English** (10): the same 9 as Elementary-English
plus MOJO.

**Individual — Secondary — Filipino** (10): the same 9 as Elementary-Filipino
plus MOJO.

**Group — Elementary — English** (3): Radio Broadcasting and Scriptwriting
(Regular), Collaborative Publishing, Radio Broadcasting and Scriptwriting
(SPJ).

**Group — Elementary — Filipino** (3): same 3 names as Group-Elem-English
(the sheet gives identical labels for English and Filipino group events at
elementary level).

**Group — Secondary — English** (6): Radio Broadcasting and Scriptwriting
(Regular), Collaborative Publishing, Radio Broadcasting and Scriptwriting
(SPJ), Online Publishing, TV Broadcasting and Scriptwriting (Regular), TV
Broadcasting and Scriptwriting (SPJ).

**Group — Secondary — Filipino** (6): same 6 names as Group-Sec-English.

Total: 38 individual + 18 group = 56 events. This catalog is treated as
division-wide (confirmed with user) — every district uses the same event
list, so it is hardcoded in the seed script, not derived per-district.

### `school_papers`
One row per school **per language** (English and Filipino are tracked
separately; a school may have zero, one, or both).

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| school_id | uuid not null references schools(id) | |
| language | text not null check (language in ('english','filipino')) | |
| paper_name | text not null | |
| adviser_name | text not null | |
| adviser_gender | text not null check (adviser_gender in ('M','F')) | |
| principal_name | text not null | |
| submitted_at | timestamptz | null until first save; updated on every subsequent save |
| updated_at | timestamptz not null default now() | |

`unique (school_id, language)`.

### `paper_staff`
Section heads / assistant heads for a `school_papers` row. At least 2 per
`school_papers` row, enforced in the app layer (Server Action validation),
not a DB constraint (Postgres can't cheaply express "at least N related
rows" without a trigger, and the app is the only writer).

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| school_paper_id | uuid not null references school_papers(id) on delete cascade | |
| full_name | text not null | |
| title | text not null check (title in ('section_head','assistant_head')) | |

### `entries`
One row per contestant/team submitted for one event.

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| school_id | uuid not null references schools(id) | |
| event_id | uuid not null references events(id) | |
| submitted_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

No uniqueness constraint on `(school_id, event_id)` — a school could in
principle field two teams for the same group event; the UI doesn't need to
forbid it and the spreadsheet source doesn't either.

### `entry_participants`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| entry_id | uuid not null references entries(id) on delete cascade | |
| first_name | text not null | |
| middle_name | text | nullable — not everyone has one |
| last_name | text not null | |
| gender | text not null check (gender in ('M','F')) | |

Individual events: exactly 1 row. Group events: 2+ rows, no hard maximum
(the UI lets the school add/remove rows freely).

### `entry_coaches`
| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| entry_id | uuid not null references entries(id) on delete cascade | |
| full_name | text not null | |
| gender | text not null check (gender in ('M','F')) | |

1–2 rows per entry, enforced in the app layer (Server Action validation).

### `app_settings`
Single-row table for the admin "lock submissions" switch.

| column | type | notes |
|---|---|---|
| id | boolean pk default true check (id) | forces exactly one row |
| submissions_locked | boolean not null default false | |

## 4. Auth Model

**Schools** are backed by real Supabase Auth users, created once by the seed
script — not by hand-rolled sessions:

- For each school row, create a Supabase Auth user via the admin API with
  email `school-{school_id_number}@presslink.internal` and password =
  `school_id_number`. Store the returned `auth.users.id` in
  `schools.auth_user_id`.
- The login page never shows or asks for an email. It resolves the school's
  synthetic email server-side (Server Action reads `schools` by district +
  name selection, or by `school_id_number` if the UI keys off that) and
  calls `supabase.auth.signInWithPassword({ email, password: schoolId })`
  from a Server Action, then relies on Supabase's cookie-based session
  (`@supabase/ssr`) for subsequent requests.
- **RLS** on `schools`, `school_papers`, `paper_staff`, `entries`,
  `entry_participants`, `entry_coaches`: a school's session may only
  read/write rows where `school_id` resolves to
  `schools.id` for `schools.auth_user_id = auth.uid()`. Concretely, each
  table gets a policy like:
  ```sql
  using (
    school_id in (select id from schools where auth_user_id = auth.uid())
  )
  ```
  (For `schools` itself, the policy is `auth_user_id = auth.uid()` for
  row-level fields school users may read, e.g. their own name/district —
  they never need to see other schools.)
- Districts and the events catalog are public-read (needed to populate the
  login page's district/school pickers, and the entry page's event picker)
  — `select` allowed for `anon`/`authenticated`, no writes from the client.

**Admin** is a normal Supabase Auth user, gated by presence of a row in
`admin_profiles`. RLS on all tables also grants full read (and, where
needed, write to `app_settings`) when
`exists (select 1 from admin_profiles where user_id = auth.uid())`.

**Login page district filter** does not affect auth — it's purely a
client-side/query filter to shorten the school dropdown. Default is "ALL"
(no filter).

## 5. Application Pages & Flows

Built with Next.js App Router, Server Components for data fetching (SSR by
default), Server Actions for all writes. No client-side Supabase writes
using the anon key beyond `signInWithPassword` on the login form.

### `/login`
- Logo + "Press Link" heading.
- District `<select>` — options loaded server-side from `districts`,
  default "ALL".
- School `<select>` — options loaded server-side from `schools`, filtered
  client-side by the chosen district (no refetch needed — the full
  ~332-row list is small enough to send once and filter in the browser).
- School ID password field.
- On submit: Server Action calls `signInWithPassword` with the resolved
  synthetic email; on success, redirect to `/entry`; on failure, show
  "Incorrect School ID for the selected school."

### `/entry` (requires school session; redirect to `/login` if none)
- Header shows the logged-in school's name and district, plus a sign-out
  button.
- Two tabs: **School Paper — English** and **School Paper — Filipino**.
  Each tab is a form: paper name, adviser name, adviser gender, principal
  name, and a repeatable "section head / assistant head" list (min 2 rows,
  add/remove). Saves independently per language via a Server Action that
  upserts `school_papers` + replaces its `paper_staff` rows.
- **Entries** section: a list of this school's existing `entries` (event
  name, category, level, language, participant names, submitted_at), each
  with Edit/Delete — enabled only while `app_settings.submissions_locked`
  is false, otherwise read-only with a "Submissions are locked" banner.
- "Add entry" button opens a form: event picker (grouped by
  category/level/language, sourced from `events`), then:
  - Individual event selected → single participant fieldset (first/middle/
    last name, gender).
  - Group event selected → repeatable participant fieldset (min 2, add/
    remove).
  - Coach fieldset, repeatable, 1–2 rows (full name, gender).
  - Save via Server Action that inserts/updates `entries` +
    `entry_participants` + `entry_coaches` in one transaction (Postgres
    function or sequential inserts within a single Server Action — no
    partial-save states visible to the user).

### `/admin/login`
Standard email + password form against Supabase Auth; redirect to `/admin`
on success only if the signed-in user has an `admin_profiles` row (checked
server-side; otherwise sign out and show "Not an admin account").

### `/admin` (requires admin session)
- Filter bar: District, School, Event, Category (individual/group),
  Language (English/Filipino), Level (elementary/secondary) — all optional,
  combinable, reflected in the URL query string so filtered views are
  shareable/bookmarkable (Next.js `searchParams` on a Server Component,
  no client-side fetch needed).
- Table of entries matching the filters: School, District, Event, Category,
  Level, Language, Participant(s), Coach(es), Submitted At.
- A "Lock / unlock submissions" toggle that writes `app_settings` via a
  Server Action restricted to admins.
- A per-school summary view (paper info + staff + entry count) reachable
  from the main table — not a separate route, just an expandable row or
  a modal fed by data already on the page (avoid an extra round trip).

## 6. Non-Functional Requirements

- **SSR/Next.js**: use Server Components for all read paths (login option
  lists, entry list, admin table). Only the interactive bits (dynamic
  add/remove rows, district→school client filter) are Client Components.
  No `runtime = 'edge'` — default Node.js runtime (Fluid Compute) throughout.
- **Data access**: the browser only ever holds the Supabase anon key with
  RLS enforced. Server Actions use the anon key too (respecting the caller's
  session) — the service-role key is used **only** inside the seed script,
  run locally/CI, never bundled into the app.
- **Validation**: all "at least N rows" rules (2 paper staff, 1–2 coaches,
  2+ group participants) are enforced in Server Actions with Zod schemas
  before hitting the database, in addition to the UI preventing removal
  below the minimum.

## 7. Data Handling / PII Safeguards

- The two source `.xlsx` files stay outside the repo (e.g. referenced by
  absolute path from a local-only seed config, or copied into a
  git-ignored `seed-data/` folder). Only District, School Name, and School
  ID are read from the school-heads file; every other column (school head
  name, sex, contact number, personal email, FB name, address) is ignored
  by the parser and never touches the database.
- `.gitignore` excludes `seed-data/` and any `*.xlsx` at the repo root.

## 8. Deployment

Vercel (Next.js optimizations/SSR requirement + this environment's default
tooling), with Supabase provisioned as a Vercel Marketplace integration
rather than a standalone Supabase account, per the project's platform
conventions. Environment variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the last one
seed-script-only, never exposed to the client) are managed via `vercel env`.

## 9. Out of Scope (v1)

- Self-service school account creation/management by admin (schools are
  fully pre-seeded from the spreadsheet; admin doesn't add/edit schools
  through the UI).
- Exporting results (CSV/PDF) — not requested; add later if needed.
- Multi-tier admin roles — one `admin_profiles` role for now.
- Password reset flow for schools — if a School ID changes, an operator
  re-runs a small script against the Supabase Auth admin API.
