# Press Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Press Link, a Next.js + Supabase web app where schools log in with a shared school-ID password to submit School Paper info and DSPC event entries, and division admins review/filter all submissions.

**Architecture:** Next.js App Router with Server Components for all reads and Server Actions for all writes (no client-side database calls beyond the login form's `signInWithPassword`). Supabase Postgres holds the data; RLS policies scope every school-owned table to that school's Supabase Auth session, using a synthetic Auth user created per school during seeding (no hand-rolled session/JWT code). Admin is a normal Supabase Auth account gated by an `admin_profiles` table.

**Tech Stack:** Next.js (App Router, latest stable via `create-next-app@latest`), TypeScript, Tailwind CSS, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Zod, `xlsx` (seed-time only), Vitest, `tsx`, npm.

**Spec:** `docs/superpowers/specs/2026-08-13-press-link-design.md`

## Global Constraints

- Default Next.js Node.js runtime everywhere — never set `export const runtime = 'edge'`.
- Server Components handle all data reads; Server Actions handle all writes; the browser only ever holds the Supabase **anon** key.
- `SUPABASE_SERVICE_ROLE_KEY` is used **only** inside `scripts/seed/*` and `scripts/verify-schema.ts`, never imported from anything under `app/` or `lib/supabase/server.ts` / `client.ts`.
- Every table gets Row Level Security enabled; no table is left with RLS off.
- Only District, School Name, and School ID are ever read from the school-heads spreadsheet — no other column is parsed or stored. The two source `.xlsx` files are never committed to the repo.
- No experimental Next.js cache directives (`use cache`, PPR) — every page here is per-session/dynamic data, so there's nothing worth caching; keep default SSR.
- Package manager is npm. Test runner is Vitest, used for pure-logic units (validation schemas, data transforms, the events catalog) — page/flow correctness is verified by hand in the browser per step, per this project's UI-testing convention.
- Node 20.6+ (`--env-file`) is required to run the seed/verify scripts as written; this machine has Node v22, which satisfies that.

---

### Task 1: Project scaffold

**Files:**
- Create: entire Next.js project at repo root (`package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.eslintrc`/`eslint.config.*`, `postcss.config.*`)
- Create: `.env.local.example`
- Modify: `.gitignore`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: a working `npm run dev` / `npm run build` / `npm run test` toolchain that every later task builds on. Import alias `@/*` → repo root.

- [ ] **Step 1: Scaffold Next.js non-interactively**

Run:
```bash
npx create-next-app@latest . --typescript --eslint --tailwind --app --no-src-dir --import-alias "@/*" --no-turbopack
```
Expected: command completes without prompting (all flags supplied), `package.json`, `app/`, `tsconfig.json` now exist alongside the pre-existing `docs/` and `.git/`.

- [ ] **Step 2: Verify the scaffold runs**

Run: `npm run build`
Expected: build succeeds (default Next.js starter page compiles).

- [ ] **Step 3: Add project dependencies**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D xlsx tsx vitest
```

- [ ] **Step 4: Add Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Add npm scripts**

Edit `package.json` `"scripts"` to:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "seed": "tsx --env-file=.env.local scripts/seed/index.ts",
  "verify-schema": "tsx --env-file=.env.local scripts/verify-schema.ts"
}
```

- [ ] **Step 6: Verify the empty test suite runs**

Run: `npm run test`
Expected: Vitest reports "No test files found" without erroring (no test files exist yet — that's expected at this step).

- [ ] **Step 7: Add environment example and gitignore entries**

Create `.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_FULL_NAME=
SCHOOL_HEADS_XLSX_PATH=
```

Append to `.gitignore` (create-next-app already ignores `node_modules`, `.next`, `.env*.local`):
```
seed-data/
*.xlsx
```

- [ ] **Step 8: Set the page title**

Edit `app/layout.tsx` metadata to:
```ts
export const metadata: Metadata = {
  title: "Press Link",
  description: "Division Schools Press Conference entry portal",
};
```
(Keep the rest of the generated `layout.tsx` as-is — root `<html>`/`<body>` structure, font setup.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js project with Supabase/Zod/Vitest tooling"
```

---

### Task 2: Provision Supabase project and apply schema/RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `scripts/verify-schema.ts`
- Create: `lib/supabase/admin.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createAdminClient()` from `lib/supabase/admin.ts` — a service-role Supabase client, used by every seed/verify script in later tasks. Produces the full schema (`districts`, `schools`, `admin_profiles`, `events`, `school_papers`, `paper_staff`, `entries`, `entry_participants`, `entry_coaches`, `app_settings`) with RLS enabled, which every later task's queries depend on.

**This task requires you (the user) to provision the actual Supabase project — an agent cannot sign up for a hosted service on your behalf.** Docker isn't available on this machine, so this plan targets a real hosted Supabase project instead of the local CLI dev stack (`supabase start`).

- [ ] **Step 1: Create the Supabase project**

Go to https://supabase.com/dashboard, create a new project (or provision one via the Vercel Marketplace Supabase integration if you've already linked this repo to a Vercel project — either path gives you the same three values below). Note the project's:
- Project URL (Project Settings → API) → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`

- [ ] **Step 2: Fill in local env vars**

Copy `.env.local.example` to `.env.local` and fill in the three Supabase values from Step 1 (leave `ADMIN_*` and `SCHOOL_HEADS_XLSX_PATH` for later tasks).

- [ ] **Step 3: Write the schema + RLS migration**

Create `supabase/migrations/0001_init.sql`:
```sql
create extension if not exists pgcrypto;

create table districts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references districts(id),
  name text not null,
  school_id_number text not null unique,
  auth_user_id uuid unique references auth.users(id),
  created_at timestamptz not null default now()
);

create table admin_profiles (
  user_id uuid primary key references auth.users(id),
  full_name text not null
);

create table events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null check (category in ('individual', 'group')),
  level text not null check (level in ('elementary', 'secondary')),
  language text not null check (language in ('english', 'filipino')),
  name text not null,
  sort_order int not null
);

create table school_papers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  language text not null check (language in ('english', 'filipino')),
  paper_name text not null,
  adviser_name text not null,
  adviser_gender text not null check (adviser_gender in ('M', 'F')),
  principal_name text not null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (school_id, language)
);

create table paper_staff (
  id uuid primary key default gen_random_uuid(),
  school_paper_id uuid not null references school_papers(id) on delete cascade,
  full_name text not null,
  title text not null check (title in ('section_head', 'assistant_head'))
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  event_id uuid not null references events(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table entry_participants (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  first_name text not null,
  middle_name text,
  last_name text not null,
  gender text not null check (gender in ('M', 'F'))
);

create table entry_coaches (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  full_name text not null,
  gender text not null check (gender in ('M', 'F'))
);

create table app_settings (
  id boolean primary key default true,
  submissions_locked boolean not null default false,
  constraint app_settings_singleton check (id)
);

insert into app_settings (id, submissions_locked) values (true, false);

alter table districts enable row level security;
alter table schools enable row level security;
alter table admin_profiles enable row level security;
alter table events enable row level security;
alter table school_papers enable row level security;
alter table paper_staff enable row level security;
alter table entries enable row level security;
alter table entry_participants enable row level security;
alter table entry_coaches enable row level security;
alter table app_settings enable row level security;

create policy "public read districts" on districts for select using (true);
create policy "public read schools" on schools for select using (true);
create policy "public read events" on events for select using (true);
create policy "public read app_settings" on app_settings for select using (true);

create policy "self read admin_profiles" on admin_profiles for select using (user_id = auth.uid());

create policy "school manage own school_papers" on school_papers for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

create policy "admin read school_papers" on school_papers for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own paper_staff" on paper_staff for all
  using (school_paper_id in (
    select sp.id from school_papers sp
    join schools s on s.id = sp.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (school_paper_id in (
    select sp.id from school_papers sp
    join schools s on s.id = sp.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read paper_staff" on paper_staff for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entries" on entries for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

create policy "admin read entries" on entries for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entry_participants" on entry_participants for all
  using (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read entry_participants" on entry_participants for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entry_coaches" on entry_coaches for all
  using (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read entry_coaches" on entry_coaches for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "admin write app_settings" on app_settings for update
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));
```

- [ ] **Step 4: Apply the migration**

Open the Supabase dashboard → SQL Editor → paste the full contents of `supabase/migrations/0001_init.sql` → Run.
Expected: "Success. No rows returned." and the Table Editor now lists all 10 tables.

- [ ] **Step 5: Add the admin Supabase client**

Create `lib/supabase/admin.ts`:
```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 6: Write the schema smoke-test script**

Create `scripts/verify-schema.ts`:
```ts
import { createAdminClient } from "../lib/supabase/admin";

const TABLES = [
  "districts",
  "schools",
  "admin_profiles",
  "events",
  "school_papers",
  "paper_staff",
  "entries",
  "entry_participants",
  "entry_coaches",
  "app_settings",
];

async function main() {
  const supabase = createAdminClient();
  for (const table of TABLES) {
    const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) {
      throw new Error(`Table check failed for "${table}": ${error.message}`);
    }
    console.log(`OK: ${table}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Note: this proves every table exists and is queryable via the service-role client, which bypasses RLS — it does **not** prove the RLS policies themselves are correct. Policy correctness gets exercised for real once the login/entry flows are manually tested in the browser (Task 8 onward).

- [ ] **Step 7: Run the smoke test**

Run: `npm run verify-schema`
Expected: `OK: districts` through `OK: app_settings`, ten lines, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0001_init.sql scripts/verify-schema.ts lib/supabase/admin.ts .gitignore
git commit -m "Add Press Link schema, RLS policies, and a schema smoke test"
```
(`.env.local` is already gitignored by the Next.js scaffold — confirm with `git status` that it is not staged.)

---

### Task 3: Supabase server/browser clients and session middleware

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/client.ts`
- Create: `middleware.ts`

**Interfaces:**
- Consumes: none beyond env vars from Task 2.
- Produces: `createClient()` (async) from `lib/supabase/server.ts` — the RLS-respecting client every Server Component/Server Action uses from here on. `createClient()` from `lib/supabase/client.ts` for the one Client Component that needs it (none currently do directly — the login form goes through a Server Action instead, so this export exists for completeness/future use but isn't wired into a page in this plan).

- [ ] **Step 1: Add the server client**

Create `lib/supabase/server.ts`:
```ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render — middleware refreshes the session instead.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 2: Add the browser client**

Create `lib/supabase/client.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Add session-refresh + route-guard middleware**

Create `middleware.ts` at the repo root:
```ts
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin") && path !== "/admin/login";
  const isEntryRoute = path.startsWith("/entry");

  if (!user && (isAdminRoute || isEntryRoute)) {
    const loginPath = isAdminRoute ? "/admin/login" : "/login";
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/entry/:path*", "/admin/:path*"],
};
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: succeeds (no route uses these clients yet, but TypeScript must resolve the new files cleanly).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/server.ts lib/supabase/client.ts middleware.ts
git commit -m "Add Supabase server/browser clients and auth middleware"
```

---

### Task 4: Auth email resolver and validation schemas

**Files:**
- Create: `lib/auth/resolve-school-email.ts`
- Test: `lib/auth/resolve-school-email.test.ts`
- Create: `lib/validation/school-paper.ts`
- Test: `lib/validation/school-paper.test.ts`
- Create: `lib/validation/entry.ts`
- Test: `lib/validation/entry.test.ts`

**Interfaces:**
- Produces: `resolveSchoolEmail(schoolIdNumber: string): string`, `schoolPaperSchema: ZodSchema` + `SchoolPaperInput` type, `entrySchema: ZodSchema` + `EntryInput` type. Every seed script and Server Action from Task 6 onward imports these.

- [ ] **Step 1: Write the failing test for the email resolver**

Create `lib/auth/resolve-school-email.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveSchoolEmail } from "./resolve-school-email";

describe("resolveSchoolEmail", () => {
  it("builds a synthetic email from a school id number", () => {
    expect(resolveSchoolEmail("500282")).toBe("school-500282@presslink.internal");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- resolve-school-email`
Expected: FAIL — `resolve-school-email.ts` does not exist yet.

- [ ] **Step 3: Implement the resolver**

Create `lib/auth/resolve-school-email.ts`:
```ts
export function resolveSchoolEmail(schoolIdNumber: string): string {
  return `school-${schoolIdNumber}@presslink.internal`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test -- resolve-school-email`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the school paper schema**

Create `lib/validation/school-paper.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { schoolPaperSchema } from "./school-paper";

const validInput = {
  language: "english" as const,
  paperName: "The Beacon",
  adviserName: "Juan Dela Cruz",
  adviserGender: "M" as const,
  principalName: "Maria Santos",
  staff: [
    { fullName: "Ana Reyes", title: "section_head" as const },
    { fullName: "Ben Cruz", title: "assistant_head" as const },
  ],
};

describe("schoolPaperSchema", () => {
  it("accepts valid input with 2 staff", () => {
    expect(schoolPaperSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects fewer than 2 staff", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, staff: [validInput.staff[0]] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty paper name", () => {
    const result = schoolPaperSchema.safeParse({ ...validInput, paperName: "  " });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm run test -- school-paper`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the school paper schema**

Create `lib/validation/school-paper.ts`:
```ts
import { z } from "zod";

export const paperStaffSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  title: z.enum(["section_head", "assistant_head"]),
});

export const schoolPaperSchema = z.object({
  language: z.enum(["english", "filipino"]),
  paperName: z.string().trim().min(1, "School paper name is required"),
  adviserName: z.string().trim().min(1, "Adviser name is required"),
  adviserGender: z.enum(["M", "F"]),
  principalName: z.string().trim().min(1, "Principal name is required"),
  staff: z.array(paperStaffSchema).min(2, "At least 2 section/assistant heads are required"),
});

export type SchoolPaperInput = z.infer<typeof schoolPaperSchema>;
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `npm run test -- school-paper`
Expected: PASS, 3 tests.

- [ ] **Step 9: Write the failing tests for the entry schema**

Create `lib/validation/entry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { entrySchema } from "./entry";

const baseCoach = { fullName: "Coach One", gender: "M" as const };
const participant = (n: string) => ({ firstName: n, lastName: "Dela Cruz", gender: "F" as const });

describe("entrySchema", () => {
  it("accepts an individual entry with exactly 1 participant", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an individual entry with 2 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana"), participant("Ben")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a group entry with fewer than 2 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "group",
      participants: [participant("Ana")],
      coaches: [baseCoach],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a group entry with 5 participants", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "group",
      participants: ["Ana", "Ben", "Cathy", "Dan", "Eve"].map(participant),
      coaches: [baseCoach],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 2 coaches", () => {
    const result = entrySchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      category: "individual",
      participants: [participant("Ana")],
      coaches: [baseCoach, baseCoach, baseCoach],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 10: Run it and confirm it fails**

Run: `npm run test -- entry`
Expected: FAIL — module not found.

- [ ] **Step 11: Implement the entry schema**

Create `lib/validation/entry.ts`:
```ts
import { z } from "zod";

export const participantSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["M", "F"]),
});

export const coachSchema = z.object({
  fullName: z.string().trim().min(1, "Coach name is required"),
  gender: z.enum(["M", "F"]),
});

export const entrySchema = z
  .object({
    eventId: z.string().uuid(),
    category: z.enum(["individual", "group"]),
    participants: z.array(participantSchema),
    coaches: z.array(coachSchema).min(1, "At least 1 coach is required").max(2, "At most 2 coaches are allowed"),
  })
  .superRefine((data, ctx) => {
    const min = data.category === "individual" ? 1 : 2;
    const max = data.category === "individual" ? 1 : Infinity;
    if (data.participants.length < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message:
          data.category === "individual"
            ? "Individual events require exactly 1 participant"
            : "Group events require at least 2 participants",
      });
    }
    if (data.participants.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Individual events require exactly 1 participant",
      });
    }
  });

export type EntryInput = z.infer<typeof entrySchema>;
```

- [ ] **Step 12: Run it and confirm it passes**

Run: `npm run test -- entry`
Expected: PASS, 5 tests.

- [ ] **Step 13: Run the full suite**

Run: `npm run test`
Expected: all tests across the project pass (email resolver + school paper + entry = 9 tests).

- [ ] **Step 14: Commit**

```bash
git add lib/auth lib/validation
git commit -m "Add school email resolver and Zod validation schemas"
```

---

### Task 5: Events catalog and seed script

**Files:**
- Create: `lib/events-catalog.ts`
- Test: `lib/events-catalog.test.ts`
- Create: `scripts/seed/events.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `lib/supabase/admin.ts` (Task 2).
- Produces: `EVENTS_CATALOG: EventSeed[]` (56 entries) from `lib/events-catalog.ts`, and `seedEvents(): Promise<void>` from `scripts/seed/events.ts`, called by `scripts/seed/index.ts` in Task 8. `EventSeed` has shape `{ code, category, level, language, name, sortOrder }`.

The event catalog below is transcribed from the `EVENTS` sheet of `ALABEL-1-DISTRICT_DSPC-2025.xlsx`: 9 individual events × {elementary, secondary} × {english, filipino}, plus MOJO for secondary only (38 individual events total); 3 group events × {elementary, secondary} × {english, filipino}, plus 3 more group events for secondary only (18 group events total) = 56 events.

- [ ] **Step 1: Write the failing test for the catalog**

Create `lib/events-catalog.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { EVENTS_CATALOG } from "./events-catalog";

describe("EVENTS_CATALOG", () => {
  it("has exactly 56 events", () => {
    expect(EVENTS_CATALOG.length).toBe(56);
  });

  it("has 38 individual and 18 group events", () => {
    expect(EVENTS_CATALOG.filter((e) => e.category === "individual").length).toBe(38);
    expect(EVENTS_CATALOG.filter((e) => e.category === "group").length).toBe(18);
  });

  it("has unique codes", () => {
    const codes = EVENTS_CATALOG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only offers MOJO at the secondary level", () => {
    const mojo = EVENTS_CATALOG.filter((e) => e.name === "MOJO");
    expect(mojo.every((e) => e.level === "secondary")).toBe(true);
    expect(mojo.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- events-catalog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalog**

Create `lib/events-catalog.ts`:
```ts
export type EventCategory = "individual" | "group";
export type EventLevel = "elementary" | "secondary";
export type EventLanguage = "english" | "filipino";

export interface EventSeed {
  code: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  name: string;
  sortOrder: number;
}

const INDIVIDUAL_EVENTS: { slug: string; nameEn: string; nameFil: string }[] = [
  { slug: "news-writing", nameEn: "News Writing", nameFil: "Pagsulat ng Balita" },
  { slug: "editorial-writing", nameEn: "Editorial Writing", nameFil: "Pagsulat ng Editoryal" },
  { slug: "column-writing", nameEn: "Column Writing", nameFil: "Pagsulat ng Kolum" },
  { slug: "feature-writing", nameEn: "Feature Writing", nameFil: "Pagsulat ng Lathalain" },
  { slug: "sci-tech-writing", nameEn: "Science & Technology Writing", nameFil: "Pagsulat ng Agham at Teknolohiya" },
  { slug: "editorial-cartooning", nameEn: "Editorial Cartooning", nameFil: "Pagguhit ng Kartung Editoryal" },
  { slug: "photojournalism", nameEn: "Photojourn", nameFil: "Pagkuha ng Larawang Pampahayagan" },
  { slug: "sports-writing", nameEn: "Sports Writing", nameFil: "Pagsulat ng Isports" },
  { slug: "copy-editing", nameEn: "Copy Editing & Headline Writing", nameFil: "Pagwawasto at Pag-uulo ng Balita" },
];

const GROUP_EVENTS_ALL_LEVELS: { slug: string; name: string }[] = [
  { slug: "radio-broadcasting-regular", name: "Radio Broadcasting and Scriptwriting (Regular)" },
  { slug: "collaborative-publishing", name: "Collaborative Publishing" },
  { slug: "radio-broadcasting-spj", name: "Radio Broadcasting and Scriptwriting (SPJ)" },
];

const GROUP_EVENTS_SECONDARY_ONLY: { slug: string; name: string }[] = [
  { slug: "online-publishing", name: "Online Publishing" },
  { slug: "tv-broadcasting-regular", name: "TV Broadcasting and Scriptwriting (Regular)" },
  { slug: "tv-broadcasting-spj", name: "TV Broadcasting and Scriptwriting (SPJ)" },
];

function levelTag(level: EventLevel): "elem" | "sec" {
  return level === "elementary" ? "elem" : "sec";
}

function langTag(language: EventLanguage): "eng" | "fil" {
  return language === "english" ? "eng" : "fil";
}

function buildIndividualEvents(): EventSeed[] {
  const events: EventSeed[] = [];
  let sortOrder = 1;

  for (const level of ["elementary", "secondary"] as const) {
    for (const language of ["english", "filipino"] as const) {
      for (const ev of INDIVIDUAL_EVENTS) {
        events.push({
          code: `${ev.slug}-${levelTag(level)}-${langTag(language)}`,
          category: "individual",
          level,
          language,
          name: language === "english" ? ev.nameEn : ev.nameFil,
          sortOrder: sortOrder++,
        });
      }
      if (level === "secondary") {
        events.push({
          code: `mojo-sec-${langTag(language)}`,
          category: "individual",
          level: "secondary",
          language,
          name: "MOJO",
          sortOrder: sortOrder++,
        });
      }
    }
  }

  return events;
}

function buildGroupEvents(): EventSeed[] {
  const events: EventSeed[] = [];
  let sortOrder = 1;

  for (const level of ["elementary", "secondary"] as const) {
    for (const language of ["english", "filipino"] as const) {
      for (const ev of GROUP_EVENTS_ALL_LEVELS) {
        events.push({
          code: `${ev.slug}-${levelTag(level)}-${langTag(language)}`,
          category: "group",
          level,
          language,
          name: ev.name,
          sortOrder: sortOrder++,
        });
      }
      if (level === "secondary") {
        for (const ev of GROUP_EVENTS_SECONDARY_ONLY) {
          events.push({
            code: `${ev.slug}-${langTag(language)}`,
            category: "group",
            level: "secondary",
            language,
            name: ev.name,
            sortOrder: sortOrder++,
          });
        }
      }
    }
  }

  return events;
}

export const EVENTS_CATALOG: EventSeed[] = [...buildIndividualEvents(), ...buildGroupEvents()];
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test -- events-catalog`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the seed script**

Create `scripts/seed/events.ts`:
```ts
import { createAdminClient } from "../../lib/supabase/admin";
import { EVENTS_CATALOG } from "../../lib/events-catalog";

export async function seedEvents() {
  const supabase = createAdminClient();
  const { error } = await supabase.from("events").upsert(
    EVENTS_CATALOG.map((e) => ({
      code: e.code,
      category: e.category,
      level: e.level,
      language: e.language,
      name: e.name,
      sort_order: e.sortOrder,
    })),
    { onConflict: "code" }
  );
  if (error) {
    throw new Error(`Failed to seed events: ${error.message}`);
  }
  console.log(`Seeded ${EVENTS_CATALOG.length} events.`);
}
```

- [ ] **Step 6: Run the seed script directly and verify**

Run: `npx tsx --env-file=.env.local scripts/seed/events.ts`
Expected: `Seeded 56 events.` Then confirm in the Supabase dashboard Table Editor that `events` has 56 rows.

- [ ] **Step 7: Commit**

```bash
git add lib/events-catalog.ts lib/events-catalog.test.ts scripts/seed/events.ts
git commit -m "Add the 56-event DSPC catalog and its seed script"
```

---

### Task 6: Districts/Schools transform and seed script

**Files:**
- Create: `scripts/seed/districts-schools.transform.ts`
- Test: `scripts/seed/districts-schools.transform.test.ts`
- Create: `scripts/seed/districts-schools.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `lib/supabase/admin.ts` (Task 2).
- Produces: `transformSchoolRows(rows: RawSchoolRow[]): TransformResult` (pure function) and `seedDistrictsAndSchools(): Promise<void>`, called by `scripts/seed/index.ts` in Task 8.

The source file's header row is row 2 (`NO., SCHOOL ID , SCHOOL NAME, DISTRICT, ...`), with data starting row 3. Column B (index 1) is School ID, column C (index 2) is School Name, column D (index 3) is District. Some rows are section-banner rows (e.g. `"ALABEL 1 DISTRICT"` in the School Name column, no School ID) that must be skipped, and district names have inconsistent trailing whitespace that must be trimmed before dedup.

- [ ] **Step 1: Write the failing tests for the transform**

Create `scripts/seed/districts-schools.transform.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { transformSchoolRows, type RawSchoolRow } from "./districts-schools.transform";

describe("transformSchoolRows", () => {
  it("normalizes valid rows and dedupes/trims districts", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "500282", schoolName: "Alabel Integrated SPED Center", district: "Alabel 1" },
      { schoolId: "500289", schoolName: "Banlibato Integrated School", district: "Alabel 1 " },
      { schoolId: 130425, schoolName: "Famorcan ES", district: " Alabel 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.districtNames).toEqual(["Alabel 1"]);
    expect(result.schools).toHaveLength(3);
    expect(result.schools[0]).toEqual({
      schoolIdNumber: "500282",
      schoolName: "Alabel Integrated SPED Center",
      districtName: "Alabel 1",
    });
  });

  it("skips section-banner rows with no school id", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: undefined, schoolName: "ALABEL 1 DISTRICT", district: undefined },
      { schoolId: "500282", schoolName: "Alabel Integrated SPED Center", district: "Alabel 1" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(1);
    expect(result.districtNames).toEqual(["Alabel 1"]);
  });

  it("skips rows missing a school name or district", () => {
    const rows: RawSchoolRow[] = [
      { schoolId: "999999", schoolName: "", district: "Alabel 1" },
      { schoolId: "999998", schoolName: "No District School", district: "" },
    ];

    const result = transformSchoolRows(rows);

    expect(result.schools).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm run test -- districts-schools.transform`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transform**

Create `scripts/seed/districts-schools.transform.ts`:
```ts
export interface RawSchoolRow {
  schoolId: string | number | undefined;
  schoolName: string | undefined;
  district: string | undefined;
}

export interface NormalizedSchool {
  schoolIdNumber: string;
  schoolName: string;
  districtName: string;
}

export interface TransformResult {
  districtNames: string[];
  schools: NormalizedSchool[];
}

export function transformSchoolRows(rows: RawSchoolRow[]): TransformResult {
  const schools: NormalizedSchool[] = [];
  const districtSet = new Set<string>();

  for (const row of rows) {
    const schoolIdNumber = String(row.schoolId ?? "").trim();
    const schoolName = String(row.schoolName ?? "").trim();
    const districtName = String(row.district ?? "").trim();

    if (!schoolIdNumber || !schoolName || !districtName) {
      continue;
    }

    districtSet.add(districtName);
    schools.push({ schoolIdNumber, schoolName, districtName });
  }

  return {
    districtNames: Array.from(districtSet).sort(),
    schools,
  };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm run test -- districts-schools.transform`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the seed script that reads the real spreadsheet**

Create `scripts/seed/districts-schools.ts`:
```ts
import * as XLSX from "xlsx";
import { createAdminClient } from "../../lib/supabase/admin";
import { transformSchoolRows, type RawSchoolRow } from "./districts-schools.transform";

export async function seedDistrictsAndSchools() {
  const filePath = process.env.SCHOOL_HEADS_XLSX_PATH;
  if (!filePath) {
    throw new Error("SCHOOL_HEADS_XLSX_PATH is not set");
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Row 0 is the checklist title, row 1 is the real header row; data starts at row 2.
  const rows: RawSchoolRow[] = rawRows.slice(2).map((row) => ({
    schoolId: row[1] as string | number | undefined,
    schoolName: row[2] as string | undefined,
    district: row[3] as string | undefined,
  }));

  const { districtNames, schools } = transformSchoolRows(rows);

  const supabase = createAdminClient();

  const { data: insertedDistricts, error: districtError } = await supabase
    .from("districts")
    .upsert(
      districtNames.map((name) => ({ name })),
      { onConflict: "name" }
    )
    .select("id, name");

  if (districtError || !insertedDistricts) {
    throw new Error(`Failed to seed districts: ${districtError?.message}`);
  }

  const districtIdByName = new Map(insertedDistricts.map((d) => [d.name, d.id]));

  const { error: schoolError } = await supabase.from("schools").upsert(
    schools.map((s) => ({
      name: s.schoolName,
      school_id_number: s.schoolIdNumber,
      district_id: districtIdByName.get(s.districtName),
    })),
    { onConflict: "school_id_number" }
  );

  if (schoolError) {
    throw new Error(`Failed to seed schools: ${schoolError.message}`);
  }

  console.log(`Seeded ${districtNames.length} districts and ${schools.length} schools.`);
}
```

- [ ] **Step 6: Point the seed script at the real file and run it**

Add to `.env.local`:
```
SCHOOL_HEADS_XLSX_PATH=C:\Users\PC5\Downloads\List-of-School-Heads-as-of-July-6-2026-with-school-Address.xlsx
```
Run: `npx tsx --env-file=.env.local scripts/seed/districts-schools.ts`
Expected: `Seeded 23 districts and 332 schools.` (or close to those counts — the exact figures depend on the live file). Spot-check in the Supabase Table Editor that a `schools` row like `Alabel Integrated SPED Center` has `school_id_number = "500282"` and its `district_id` resolves to a `districts` row named `Alabel 1`.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed/districts-schools.transform.ts scripts/seed/districts-schools.transform.test.ts scripts/seed/districts-schools.ts
git commit -m "Add districts/schools transform and seed script"
```
(`.env.local` stays untracked — confirm with `git status`.)

---

### Task 7: Auth-user and admin seeding

**Files:**
- Create: `scripts/seed/auth-users.ts`
- Create: `scripts/seed/admin.ts`
- Create: `scripts/seed/index.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Task 2), `resolveSchoolEmail` (Task 4), `seedEvents` (Task 5), `seedDistrictsAndSchools` (Task 6).
- Produces: `seedSchoolAuthUsers(): Promise<void>`, `seedAdminUser(): Promise<void>`, and the orchestrating `scripts/seed/index.ts` entry point run via `npm run seed`. After this task, every school has a working login and one admin account exists.

- [ ] **Step 1: Write the school auth-user seeding script**

Create `scripts/seed/auth-users.ts`:
```ts
import { createAdminClient } from "../../lib/supabase/admin";
import { resolveSchoolEmail } from "../../lib/auth/resolve-school-email";

export async function seedSchoolAuthUsers() {
  const supabase = createAdminClient();

  const { data: schools, error } = await supabase
    .from("schools")
    .select("id, school_id_number, auth_user_id")
    .is("auth_user_id", null);

  if (error) {
    throw new Error(`Failed to load schools: ${error.message}`);
  }

  for (const school of schools ?? []) {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: resolveSchoolEmail(school.school_id_number),
      password: school.school_id_number,
      email_confirm: true,
    });

    if (createError || !created.user) {
      throw new Error(`Failed to create auth user for school ${school.id}: ${createError?.message}`);
    }

    const { error: updateError } = await supabase
      .from("schools")
      .update({ auth_user_id: created.user.id })
      .eq("id", school.id);

    if (updateError) {
      throw new Error(`Failed to link auth user for school ${school.id}: ${updateError.message}`);
    }
  }

  console.log(`Created auth users for ${schools?.length ?? 0} schools.`);
}
```

- [ ] **Step 2: Write the admin seeding script**

Create `scripts/seed/admin.ts`:
```ts
import { createAdminClient } from "../../lib/supabase/admin";

export async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME ?? "Division Admin";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  }

  const supabase = createAdminClient();

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !created.user) {
    throw new Error(`Failed to create admin user: ${error?.message}`);
  }

  const { error: profileError } = await supabase
    .from("admin_profiles")
    .insert({ user_id: created.user.id, full_name: fullName });

  if (profileError) {
    throw new Error(`Failed to create admin profile: ${profileError.message}`);
  }

  console.log(`Created admin user ${email}.`);
}
```

- [ ] **Step 3: Write the orchestrating seed entry point**

Create `scripts/seed/index.ts`:
```ts
import { seedEvents } from "./events";
import { seedDistrictsAndSchools } from "./districts-schools";
import { seedSchoolAuthUsers } from "./auth-users";
import { seedAdminUser } from "./admin";

async function main() {
  await seedEvents();
  await seedDistrictsAndSchools();
  await seedSchoolAuthUsers();
  await seedAdminUser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Set admin credentials and run the full seed**

Add to `.env.local`:
```
ADMIN_EMAIL=admin@presslink.local
ADMIN_PASSWORD=choose-a-strong-password-here
ADMIN_FULL_NAME=Division Admin
```
Run: `npm run seed`
Expected: `Seeded 56 events.`, `Seeded 23 districts and 332 schools.`, `Created auth users for 332 schools.`, `Created admin user admin@presslink.local.` — in that order, exit code 0. (If you already ran the Task 5/6 scripts individually, `seedEvents`/`seedDistrictsAndSchools` will just upsert the same rows again — safe to re-run.)

- [ ] **Step 5: Spot-check in the dashboard**

In Supabase dashboard → Authentication → Users, confirm there are 333 users total (332 schools + 1 admin), with school emails like `school-500282@presslink.internal`.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed/auth-users.ts scripts/seed/admin.ts scripts/seed/index.ts
git commit -m "Add auth-user and admin seeding, wire up npm run seed"
```

---

### Task 8: Login page

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/LoginForm.tsx`
- Create: `app/login/actions.ts`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server.ts` (Task 3), `resolveSchoolEmail` from `lib/auth/resolve-school-email.ts` (Task 4).
- Produces: the `/login` route. `loginAction(formData: FormData): Promise<{ error: string } | void>`, reused conceptually (not literally imported) by the admin login pattern in Task 11.

- [ ] **Step 1: Write the Server Action**

Create `app/login/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveSchoolEmail } from "@/lib/auth/resolve-school-email";

export async function loginAction(formData: FormData): Promise<{ error: string } | void> {
  const schoolId = String(formData.get("schoolId") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!schoolId || !password) {
    return { error: "Please select a school and enter the School ID." };
  }

  const supabase = await createClient();

  const { data: school } = await supabase
    .from("schools")
    .select("id, school_id_number")
    .eq("id", schoolId)
    .single();

  if (!school) {
    return { error: "School not found." };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: resolveSchoolEmail(school.school_id_number),
    password,
  });

  if (error) {
    return { error: "Incorrect School ID for the selected school." };
  }

  redirect("/entry");
}
```

- [ ] **Step 2: Write the login form Client Component**

Create `app/login/LoginForm.tsx`:
```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { loginAction } from "./actions";

interface District {
  id: string;
  name: string;
}

interface School {
  id: string;
  name: string;
  district_id: string;
}

export function LoginForm({ districts, schools }: { districts: District[]; schools: School[] }) {
  const [districtId, setDistrictId] = useState("ALL");
  const [schoolId, setSchoolId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredSchools = useMemo(
    () => (districtId === "ALL" ? schools : schools.filter((s) => s.district_id === districtId)),
    [districtId, schools]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">District</span>
        <select
          name="districtId"
          value={districtId}
          onChange={(e) => {
            setDistrictId(e.target.value);
            setSchoolId("");
          }}
          className="rounded border px-3 py-2"
        >
          <option value="ALL">ALL</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">School</span>
        <select
          name="schoolId"
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className="rounded border px-3 py-2"
          required
        >
          <option value="" disabled>
            Select your school
          </option>
          {filteredSchools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">School ID (password)</span>
        <input type="password" name="password" className="rounded border px-3 py-2" required />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the login page**

Create `app/login/page.tsx`:
```tsx
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();

  const [{ data: districts }, { data: schools }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Press Link</h1>
        <p className="text-sm text-gray-500">Division Schools Press Conference entry portal</p>
      </div>
      <LoginForm districts={districts ?? []} schools={schools ?? []} />
    </main>
  );
}
```

- [ ] **Step 4: Redirect the root page to /login**

Edit `app/page.tsx` to:
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/login");
}
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`. Confirm it redirects to `/login`, shows "Press Link", the District dropdown defaults to "ALL" and lists all seeded districts, and the School dropdown narrows correctly when you pick a district. Pick a real school (e.g. Alabel Integrated SPED Center) and its School ID (`500282`) as the password — confirm it redirects to `/entry` (a 404 or error page is fine for now; the route doesn't exist until Task 9 — the point of this check is that login itself succeeds and redirects). Then try a wrong password and confirm "Incorrect School ID for the selected school." appears without redirecting.

- [ ] **Step 6: Commit**

```bash
git add app/login app/page.tsx
git commit -m "Add the Press Link login page"
```

---

### Task 9: Entry page shell and School Paper form

**Files:**
- Create: `app/entry/page.tsx`
- Create: `app/entry/SchoolPaperForm.tsx`
- Create: `app/entry/actions.ts`

**Interfaces:**
- Consumes: `createClient` (Task 3), `schoolPaperSchema` (Task 4).
- Produces: the `/entry` route (guarded by middleware from Task 3, plus an explicit in-page check). `signOutAction()` and `saveSchoolPaperAction(input: unknown): Promise<{ error: string } | { success: true }>`, both consumed by Task 10's entry list (which shares this same `app/entry/actions.ts` file — `saveEntryAction` and `deleteEntryAction` get added there in Task 10).

- [ ] **Step 1: Write the shared entry Server Actions file (sign-out + school paper save)**

Create `app/entry/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { schoolPaperSchema } from "@/lib/validation/school-paper";

async function getSchoolId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: school } = await supabase
    .from("schools")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (!school) throw new Error("School not found");

  return { supabase, schoolId: school.id as string };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function saveSchoolPaperAction(input: unknown) {
  const parsed = schoolPaperSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  const { data: paper, error: upsertError } = await supabase
    .from("school_papers")
    .upsert(
      {
        school_id: schoolId,
        language: parsed.data.language,
        paper_name: parsed.data.paperName,
        adviser_name: parsed.data.adviserName,
        adviser_gender: parsed.data.adviserGender,
        principal_name: parsed.data.principalName,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "school_id,language" }
    )
    .select("id")
    .single();

  if (upsertError || !paper) {
    return { error: "Could not save school paper." };
  }

  await supabase.from("paper_staff").delete().eq("school_paper_id", paper.id);
  const { error: staffError } = await supabase.from("paper_staff").insert(
    parsed.data.staff.map((s) => ({
      school_paper_id: paper.id,
      full_name: s.fullName,
      title: s.title,
    }))
  );
  if (staffError) {
    return { error: "Could not save section heads." };
  }

  revalidatePath("/entry");
  return { success: true as const };
}
```

- [ ] **Step 2: Write the School Paper form Client Component**

Create `app/entry/SchoolPaperForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { saveSchoolPaperAction } from "./actions";

interface Staff {
  full_name: string;
  title: "section_head" | "assistant_head";
}

export interface ExistingPaper {
  id: string;
  language: "english" | "filipino";
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: Staff[];
}

export function SchoolPaperForm({
  language,
  existing,
  locked,
}: {
  language: "english" | "filipino";
  existing: ExistingPaper | null;
  locked: boolean;
}) {
  const [paperName, setPaperName] = useState(existing?.paper_name ?? "");
  const [adviserName, setAdviserName] = useState(existing?.adviser_name ?? "");
  const [adviserGender, setAdviserGender] = useState<"M" | "F">(existing?.adviser_gender ?? "M");
  const [principalName, setPrincipalName] = useState(existing?.principal_name ?? "");
  const [staff, setStaff] = useState<{ fullName: string; title: "section_head" | "assistant_head" }[]>(
    existing?.paper_staff.length
      ? existing.paper_staff.map((s) => ({ fullName: s.full_name, title: s.title }))
      : [
          { fullName: "", title: "section_head" },
          { fullName: "", title: "section_head" },
        ]
  );
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateStaff(index: number, patch: Partial<{ fullName: string; title: "section_head" | "assistant_head" }>) {
    setStaff((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStaff() {
    setStaff((prev) => [...prev, { fullName: "", title: "section_head" }]);
  }

  function removeStaff(index: number) {
    setStaff((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveSchoolPaperAction({
        language,
        paperName,
        adviserName,
        adviserGender,
        principalName,
        staff,
      });
      if (result && "error" in result) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: "Saved." });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4">
      <h3 className="font-semibold capitalize">{language}</h3>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Name of School Paper</span>
        <input
          value={paperName}
          onChange={(e) => setPaperName(e.target.value)}
          disabled={locked}
          required
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">School Paper Adviser</span>
        <div className="flex gap-2">
          <input
            value={adviserName}
            onChange={(e) => setAdviserName(e.target.value)}
            disabled={locked}
            required
            className="flex-1 rounded border px-3 py-2"
          />
          <select
            value={adviserGender}
            onChange={(e) => setAdviserGender(e.target.value as "M" | "F")}
            disabled={locked}
            className="rounded border px-3 py-2"
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">School Principal</span>
        <input
          value={principalName}
          onChange={(e) => setPrincipalName(e.target.value)}
          disabled={locked}
          required
          className="rounded border px-3 py-2"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Section Heads / Assistant Heads (at least 2)</span>
        {staff.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={s.fullName}
              onChange={(e) => updateStaff(i, { fullName: e.target.value })}
              disabled={locked}
              required
              placeholder="Full name"
              className="flex-1 rounded border px-3 py-2"
            />
            <select
              value={s.title}
              onChange={(e) => updateStaff(i, { title: e.target.value as "section_head" | "assistant_head" })}
              disabled={locked}
              className="rounded border px-3 py-2"
            >
              <option value="section_head">Section Head</option>
              <option value="assistant_head">Assistant Head</option>
            </select>
            <button
              type="button"
              onClick={() => removeStaff(i)}
              disabled={locked || staff.length <= 2}
              className="text-sm text-red-600 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addStaff} disabled={locked} className="self-start text-sm text-blue-600">
          + Add staff member
        </button>
      </div>

      {message && (
        <p className={message.type === "error" ? "text-sm text-red-600" : "text-sm text-green-600"}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={locked || isPending}
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the entry page shell**

Create `app/entry/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SchoolPaperForm, type ExistingPaper } from "./SchoolPaperForm";
import { signOutAction } from "./actions";

export default async function EntryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: school } = await supabase
    .from("schools")
    .select("id, name, districts(name)")
    .eq("auth_user_id", user.id)
    .single<{ id: string; name: string; districts: { name: string } | null }>();

  if (!school) {
    redirect("/login");
  }

  const [{ data: settings }, { data: papers }] = await Promise.all([
    supabase.from("app_settings").select("submissions_locked").single(),
    supabase
      .from("school_papers")
      .select(
        "id, language, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
      )
      .eq("school_id", school.id),
  ]);

  const locked = settings?.submissions_locked ?? false;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{school.name}</h1>
          <p className="text-sm text-gray-500">{school.districts?.name}</p>
        </div>
        <form action={signOutAction}>
          <button className="text-sm text-blue-600 underline">Sign out</button>
        </form>
      </div>

      {locked && (
        <p className="mb-6 rounded bg-yellow-100 px-3 py-2 text-sm text-yellow-800">
          Submissions are locked. Entries are read-only.
        </p>
      )}

      <section className="mb-10 flex flex-col gap-6">
        <h2 className="text-xl font-semibold">School Paper</h2>
        <SchoolPaperForm
          language="english"
          existing={(papers?.find((p) => p.language === "english") as unknown as ExistingPaper) ?? null}
          locked={locked}
        />
        <SchoolPaperForm
          language="filipino"
          existing={(papers?.find((p) => p.language === "filipino") as unknown as ExistingPaper) ?? null}
          locked={locked}
        />
      </section>

      {/* Event entries section added in Task 10 */}
    </main>
  );
}
```

- [ ] **Step 4: Manually verify in the browser**

With `npm run dev` running, sign in at `/login` with a real school + its School ID. Confirm `/entry` shows the school's name and district, a working "Sign out" link (redirects to `/login`), and two School Paper forms (English/Filipino) each pre-populated with 2 empty "Section Head" rows. Fill one out (paper name, adviser, principal, 2 staff names) and click Save — confirm "Saved." appears. Reload the page and confirm the values persisted (proves the RLS `school manage own school_papers` policy actually lets this school read/write its own row). Open a second private/incognito browser window, log in as a *different* school, and confirm its School Paper forms are blank (proves RLS isolates schools from each other, not just from the UI).

- [ ] **Step 5: Commit**

```bash
git add app/entry
git commit -m "Add entry page shell with School Paper form"
```

---

### Task 10: Event entries — list, add, edit, delete

**Files:**
- Create: `app/entry/EntryList.tsx`
- Modify: `app/entry/actions.ts` (add `saveEntryAction`, `deleteEntryAction`)
- Modify: `app/entry/page.tsx` (render the entries section)

**Interfaces:**
- Consumes: `entrySchema` (Task 4), `createClient` (Task 3), the `getSchoolId()` helper already in `app/entry/actions.ts` (Task 9).
- Produces: `saveEntryAction(entryId: string | null, input: unknown): Promise<{ error: string } | { success: true }>`, `deleteEntryAction(entryId: string): Promise<{ error: string } | { success: true }>`.

- [ ] **Step 1: Add entry Server Actions**

Edit `app/entry/actions.ts`: add `import { entrySchema } from "@/lib/validation/entry";` alongside the file's existing imports at the top (next to the `schoolPaperSchema` import from Task 9), then append these two functions to the end of the file:
```ts
export async function saveEntryAction(entryId: string | null, input: unknown) {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  let id = entryId;
  if (id) {
    const { error } = await supabase
      .from("entries")
      .update({ event_id: parsed.data.eventId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId);
    if (error) return { error: "Could not update entry." };
    await supabase.from("entry_participants").delete().eq("entry_id", id);
    await supabase.from("entry_coaches").delete().eq("entry_id", id);
  } else {
    const { data: inserted, error } = await supabase
      .from("entries")
      .insert({ event_id: parsed.data.eventId, school_id: schoolId })
      .select("id")
      .single();
    if (error || !inserted) return { error: "Could not create entry." };
    id = inserted.id;
  }

  const { error: participantsError } = await supabase.from("entry_participants").insert(
    parsed.data.participants.map((p) => ({
      entry_id: id,
      first_name: p.firstName,
      middle_name: p.middleName || null,
      last_name: p.lastName,
      gender: p.gender,
    }))
  );
  if (participantsError) return { error: "Could not save participants." };

  const { error: coachesError } = await supabase.from("entry_coaches").insert(
    parsed.data.coaches.map((c) => ({
      entry_id: id,
      full_name: c.fullName,
      gender: c.gender,
    }))
  );
  if (coachesError) return { error: "Could not save coaches." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteEntryAction(entryId: string) {
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }
  const { error } = await supabase.from("entries").delete().eq("id", entryId).eq("school_id", schoolId);
  if (error) return { error: "Could not delete entry." };
  revalidatePath("/entry");
  return { success: true as const };
}
```

- [ ] **Step 2: Write the EntryList Client Component**

Create `app/entry/EntryList.tsx`:
```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteEntryAction, saveEntryAction } from "./actions";

interface EventOption {
  id: string;
  category: "individual" | "group";
  level: "elementary" | "secondary";
  language: "english" | "filipino";
  name: string;
}

interface Participant {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
}

interface Coach {
  full_name: string;
  gender: "M" | "F";
}

export interface Entry {
  id: string;
  submitted_at: string;
  events: { name: string } | null;
  entry_participants: Participant[];
  entry_coaches: Coach[];
}

type DraftParticipant = { firstName: string; middleName: string; lastName: string; gender: "M" | "F" };
type DraftCoach = { fullName: string; gender: "M" | "F" };

function emptyParticipant(): DraftParticipant {
  return { firstName: "", middleName: "", lastName: "", gender: "M" };
}

function emptyCoach(): DraftCoach {
  return { fullName: "", gender: "M" };
}

export function EntryList({
  entries,
  events,
  locked,
}: {
  entries: Entry[];
  events: EventOption[];
  locked: boolean;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [eventId, setEventId] = useState("");
  const [participants, setParticipants] = useState<DraftParticipant[]>([emptyParticipant()]);
  const [coaches, setCoaches] = useState<DraftCoach[]>([emptyCoach()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groupedEvents = useMemo(() => {
    const groups: Record<string, EventOption[]> = {};
    for (const ev of events) {
      const key = `${ev.category} / ${ev.level} / ${ev.language}`;
      (groups[key] ??= []).push(ev);
    }
    return groups;
  }, [events]);

  const selectedEvent = events.find((e) => e.id === eventId);
  const isGroup = selectedEvent?.category === "group";

  function startNew() {
    setEditingId("new");
    setEventId("");
    setParticipants([emptyParticipant()]);
    setCoaches([emptyCoach()]);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const category = selectedEvent?.category ?? "individual";
    startTransition(async () => {
      const result = await saveEntryAction(editingId === "new" ? null : editingId, {
        eventId,
        category,
        participants,
        coaches,
      });
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteEntryAction(id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Event</th>
            <th className="py-2">Participant(s)</th>
            <th className="py-2">Coach(es)</th>
            <th className="py-2">Submitted</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2">{entry.events?.name}</td>
              <td className="py-2">
                {entry.entry_participants.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}
              </td>
              <td className="py-2">{entry.entry_coaches.map((c) => c.full_name).join(", ")}</td>
              <td className="py-2">{new Date(entry.submitted_at).toLocaleString()}</td>
              <td className="py-2 text-right">
                <button onClick={() => handleDelete(entry.id)} disabled={locked} className="text-red-600 disabled:opacity-30">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-500">
                No entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!locked && editingId === null && (
        <button onClick={startNew} className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          + Add Entry
        </button>
      )}

      {editingId !== null && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Event</span>
            <select
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              required
              className="rounded border px-3 py-2"
            >
              <option value="" disabled>
                Select an event
              </option>
              {Object.entries(groupedEvents).map(([group, evs]) => (
                <optgroup key={group} label={group}>
                  {evs.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{isGroup ? "Participants (at least 2)" : "Participant"}</span>
            {participants.map((p, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  value={p.firstName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, firstName: e.target.value } : x)))
                  }
                  placeholder="First name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <input
                  value={p.middleName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, middleName: e.target.value } : x)))
                  }
                  placeholder="Middle name"
                  className="flex-1 rounded border px-3 py-2"
                />
                <input
                  value={p.lastName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, lastName: e.target.value } : x)))
                  }
                  placeholder="Last name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <select
                  value={p.gender}
                  onChange={(e) =>
                    setParticipants((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, gender: e.target.value as "M" | "F" } : x))
                    )
                  }
                  className="rounded border px-3 py-2"
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
                {isGroup && (
                  <button
                    type="button"
                    onClick={() =>
                      setParticipants((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))
                    }
                    disabled={participants.length <= 2}
                    className="text-sm text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {isGroup && (
              <button
                type="button"
                onClick={() => setParticipants((prev) => [...prev, emptyParticipant()])}
                className="self-start text-sm text-blue-600"
              >
                + Add participant
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Coach(es) (1-2)</span>
            {coaches.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={c.fullName}
                  onChange={(e) =>
                    setCoaches((prev) => prev.map((x, idx) => (idx === i ? { ...x, fullName: e.target.value } : x)))
                  }
                  placeholder="Coach full name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <select
                  value={c.gender}
                  onChange={(e) =>
                    setCoaches((prev) => prev.map((x, idx) => (idx === i ? { ...x, gender: e.target.value as "M" | "F" } : x)))
                  }
                  className="rounded border px-3 py-2"
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
                {coaches.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCoaches((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {coaches.length < 2 && (
              <button
                type="button"
                onClick={() => setCoaches((prev) => [...prev, emptyCoach()])}
                className="self-start text-sm text-blue-600"
              >
                + Add coach
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isPending ? "Saving..." : "Save Entry"}
            </button>
            <button type="button" onClick={cancel} className="rounded border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the entries section into the entry page**

Edit `app/entry/page.tsx`: add the imports and the query, and replace the `{/* Event entries section added in Task 10 */}` comment.

Add to the imports at the top:
```tsx
import { EntryList, type Entry } from "./EntryList";
```

Add to the `Promise.all` array (alongside `settings` and `papers`), and rename the destructure to include the new results:
```tsx
const [{ data: settings }, { data: papers }, { data: events }, { data: entries }] = await Promise.all([
  supabase.from("app_settings").select("submissions_locked").single(),
  supabase
    .from("school_papers")
    .select(
      "id, language, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
    )
    .eq("school_id", school.id),
  supabase.from("events").select("id, category, level, language, name").order("sort_order"),
  supabase
    .from("entries")
    .select(
      "id, submitted_at, events(name), entry_participants(first_name, middle_name, last_name, gender), entry_coaches(full_name, gender)"
    )
    .eq("school_id", school.id)
    .order("submitted_at", { ascending: false }),
]);
```

Replace the `{/* Event entries section added in Task 10 */}` comment with:
```tsx
<section>
  <h2 className="mb-4 text-xl font-semibold">Event Entries</h2>
  <EntryList entries={(entries as unknown as Entry[]) ?? []} events={events ?? []} locked={locked} />
</section>
```

- [ ] **Step 4: Manually verify in the browser**

With a school signed in at `/entry`: click "+ Add Entry", pick an individual event (e.g. News Writing / individual / elementary / english), fill in one participant + one coach, save — confirm it appears in the table with the right name/coach/timestamp. Click "+ Add Entry" again, pick a group event (e.g. Collaborative Publishing), confirm the form starts with 2 participant rows and "+ Add participant" works; try to remove down to 1 and confirm the Remove button disables at 2. Save it, confirm it lists correctly. Delete one entry and confirm it disappears. Finally, in the Supabase dashboard, manually set `app_settings.submissions_locked = true`, reload `/entry`, and confirm the lock banner shows, "+ Add Entry" and "Delete" are gone/disabled, and the School Paper Save buttons are disabled too. Set it back to `false` afterward.

- [ ] **Step 5: Run the full test suite once more**

Run: `npm run test`
Expected: all prior unit tests still pass (this task added no new pure-logic units, so the count is unchanged from Task 5's total).

- [ ] **Step 6: Commit**

```bash
git add app/entry
git commit -m "Add event entry list with add/edit/delete"
```

---

### Task 11: Admin login

**Files:**
- Create: `app/admin/login/page.tsx`
- Create: `app/admin/login/AdminLoginForm.tsx`
- Create: `app/admin/login/actions.ts`

**Interfaces:**
- Consumes: `createClient` (Task 3).
- Produces: the `/admin/login` route and `adminLoginAction(formData: FormData): Promise<{ error: string } | void>`.

- [ ] **Step 1: Write the admin login Server Action**

Create `app/admin/login/actions.ts`:
```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function adminLoginAction(formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return { error: "This account is not an admin account." };
  }

  redirect("/admin");
}
```

- [ ] **Step 2: Write the admin login form**

Create `app/admin/login/AdminLoginForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { adminLoginAction } from "./actions";

export function AdminLoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await adminLoginAction(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <input type="email" name="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Password</span>
        <input type="password" name="password" required className="rounded border px-3 py-2" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the admin login page**

Create `app/admin/login/page.tsx`:
```tsx
import { AdminLoginForm } from "./AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-2xl font-bold">Press Link Admin</h1>
      <AdminLoginForm />
    </main>
  );
}
```

- [ ] **Step 4: Manually verify in the browser**

Go to `/admin/login`, sign in with the `ADMIN_EMAIL`/`ADMIN_PASSWORD` from Task 7 — confirm it redirects to `/admin` (a 404 is fine for now, that route is built in Task 12; the point is the sign-in + admin check succeed and the redirect fires). Then try a school's synthetic credentials (`school-500282@presslink.internal` / `500282`) — confirm "This account is not an admin account." appears (proves the `admin_profiles` gate works, not just Supabase Auth's own success/failure).

- [ ] **Step 5: Commit**

```bash
git add app/admin/login
git commit -m "Add admin login page"
```

---

### Task 12: Admin dashboard

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/FilterBar.tsx`
- Create: `app/admin/LockToggle.tsx`
- Create: `app/admin/actions.ts`

**Interfaces:**
- Consumes: `createClient` (Task 3).
- Produces: the `/admin` route — the final route in this plan.

- [ ] **Step 1: Write the lock-toggle Server Action**

Create `app/admin/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setSubmissionsLockedAction(locked: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("app_settings").update({ submissions_locked: locked }).eq("id", true);
  if (error) {
    return { error: "Could not update lock state." };
  }
  revalidatePath("/admin");
  return { success: true as const };
}
```

- [ ] **Step 2: Write the LockToggle Client Component**

Create `app/admin/LockToggle.tsx`:
```tsx
"use client";

import { useTransition } from "react";
import { setSubmissionsLockedAction } from "./actions";

export function LockToggle({ locked }: { locked: boolean }) {
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setSubmissionsLockedAction(!locked);
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
        locked ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {isPending ? "Updating..." : locked ? "Unlock submissions" : "Lock submissions"}
    </button>
  );
}
```

- [ ] **Step 3: Write the FilterBar Client Component**

Create `app/admin/FilterBar.tsx`:
```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Option {
  id: string;
  name: string;
}

export function FilterBar({ districts, schools, events }: { districts: Option[]; schools: Option[]; events: Option[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <select
        defaultValue={searchParams.get("district") ?? ""}
        onChange={(e) => setParam("district", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All districts</option>
        {districts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("school") ?? ""}
        onChange={(e) => setParam("school", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All schools</option>
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("event") ?? ""}
        onChange={(e) => setParam("event", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All events</option>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("category") ?? ""}
        onChange={(e) => setParam("category", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">Individual + Group</option>
        <option value="individual">Individual</option>
        <option value="group">Group</option>
      </select>

      <select
        defaultValue={searchParams.get("language") ?? ""}
        onChange={(e) => setParam("language", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">English + Filipino</option>
        <option value="english">English</option>
        <option value="filipino">Filipino</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Write the admin dashboard page**

Create `app/admin/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FilterBar } from "./FilterBar";
import { LockToggle } from "./LockToggle";

interface SearchParams {
  district?: string;
  school?: string;
  event?: string;
  category?: string;
  language?: string;
}

interface EntryRow {
  id: string;
  submitted_at: string;
  schools: { name: string; district_id: string; districts: { name: string } | null } | null;
  events: { name: string; category: string; level: string; language: string } | null;
  entry_participants: { first_name: string; last_name: string }[];
  entry_coaches: { full_name: string }[];
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase.from("admin_profiles").select("user_id").eq("user_id", user.id).single();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  const [{ data: districts }, { data: schools }, { data: events }, { data: settings }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase.from("events").select("id, name").order("sort_order"),
    supabase.from("app_settings").select("submissions_locked").single(),
  ]);

  let query = supabase
    .from("entries")
    .select(
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(first_name, last_name), entry_coaches(full_name)"
    )
    .order("submitted_at", { ascending: false });

  if (params.school) query = query.eq("school_id", params.school);
  if (params.event) query = query.eq("event_id", params.event);

  const { data: rawEntries } = await query.overrideTypes<EntryRow[]>();

  const filteredEntries = (rawEntries ?? []).filter((entry) => {
    if (params.district && entry.schools?.district_id !== params.district) return false;
    if (params.category && entry.events?.category !== params.category) return false;
    if (params.language && entry.events?.language !== params.language) return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Press Link Admin</h1>
        <LockToggle locked={settings?.submissions_locked ?? false} />
      </div>

      <FilterBar districts={districts ?? []} schools={schools ?? []} events={events ?? []} />

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">School</th>
            <th className="py-2">District</th>
            <th className="py-2">Event</th>
            <th className="py-2">Category</th>
            <th className="py-2">Level</th>
            <th className="py-2">Language</th>
            <th className="py-2">Participant(s)</th>
            <th className="py-2">Coach(es)</th>
            <th className="py-2">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {filteredEntries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2">{entry.schools?.name}</td>
              <td className="py-2">{entry.schools?.districts?.name}</td>
              <td className="py-2">{entry.events?.name}</td>
              <td className="py-2">{entry.events?.category}</td>
              <td className="py-2">{entry.events?.level}</td>
              <td className="py-2">{entry.events?.language}</td>
              <td className="py-2">
                {entry.entry_participants.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}
              </td>
              <td className="py-2">{entry.entry_coaches.map((c) => c.full_name).join(", ")}</td>
              <td className="py-2">{new Date(entry.submitted_at).toLocaleString()}</td>
            </tr>
          ))}
          {filteredEntries.length === 0 && (
            <tr>
              <td colSpan={9} className="py-4 text-center text-gray-500">
                No entries match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 5: Manually verify in the browser**

Signed in as admin at `/admin`: confirm the table lists every entry created across Tasks 9-10 testing, with correct School/District/Event/Category/Level/Language/Participants/Coaches/Submitted columns. Use each filter (district, school, event, category, language) one at a time and confirm the table narrows correctly and the URL's query string updates (e.g. `/admin?district=...&category=individual`); confirm combining two filters (district + category) narrows further. Click "Lock submissions", confirm the button flips to "Unlock submissions" (green) and reload `/entry` as a school to confirm the lock banner now shows there too (cross-checks Task 10's lock enforcement against this toggle). Click "Unlock submissions" to restore the default state.

- [ ] **Step 6: Commit**

```bash
git add app/admin
git commit -m "Add admin dashboard with filters and submissions lock toggle"
```

---

### Task 13: Deploy to Vercel

**Files:**
- Create: `vercel.json` or `vercel.ts` (only if a rewrite/header/cron rule is actually needed — this project needs none, so skip creating one unless Step 1 surfaces a reason to)

**Interfaces:**
- Consumes: everything built in Tasks 1-12.
- Produces: a live production URL running Press Link against the same Supabase project (or a separate production Supabase project — your call in Step 1).

- [ ] **Step 1: Decide on project separation**

Decide whether production uses the same Supabase project you seeded in Tasks 2/6/7, or a fresh one. For a one-off school event with ~332 known schools, reusing the same project (already seeded) is simplest and avoids re-running the seed scripts — recommended unless you specifically want a clean prod/dev split.

- [ ] **Step 2: Push the repo to GitHub (or your Git host of choice)**

This plan's tasks have been committing locally throughout; push the branch now so Vercel can import it:
```bash
git remote add origin <your-repo-url>
git push -u origin master
```
(Confirm the remote URL with the user before running this — pushing is the first action in this plan that touches shared/external state.)

- [ ] **Step 3: Import the project in Vercel**

In the Vercel dashboard, "Add New… → Project", import the pushed repository. Vercel auto-detects Next.js — accept the defaults (build command `next build`, output handled automatically).

- [ ] **Step 4: Set production environment variables**

In the Vercel project's Settings → Environment Variables, add for the Production environment:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```
(Same three values used in `.env.local`. `SUPABASE_SERVICE_ROLE_KEY` is only needed here if you intend to re-run seed scripts against production from a CI job — the deployed Next.js app itself never imports `lib/supabase/admin.ts`, so it's safe to omit if you'd rather run seeding manually from your machine against this same project, as done in Tasks 5-7.)

- [ ] **Step 5: Deploy and smoke-test production**

Trigger the deploy (automatic on import, or `vercel --prod` from the CLI if installed). Once live, repeat the manual verification from Task 8 Step 5 (login) and Task 12 Step 5 (admin dashboard) against the production URL instead of `localhost:3000`.

- [ ] **Step 6: Commit any deployment-related file changes**

If Step 1-5 required no repo changes (expected — Vercel project settings live outside the repo), there's nothing to commit. If you did add a `vercel.ts`/`vercel.json` for a specific rule, commit it:
```bash
git add vercel.ts
git commit -m "Add Vercel configuration"
```
