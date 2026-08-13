# Press Link v3 — Roster-First Entry & School Paper Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-typed participant/coach names in the entry wizard with a school-managed roster that issues division-wide 4-digit participant numbers, enforces per-participant event caps, and gates the school-paper form behind an explicit Yes/No answer.

**Architecture:** Two new school-owned tables (`participants`, `coaches`) become the source of truth for people; `entry_participants` / `entry_coaches` are rewritten as join rows holding only foreign keys. All counting rules (event caps, per-event participant minimums/maximums, derived coach limits) live in pure functions under `lib/` so they are unit-testable in Node and reusable by both the client picker and the authoritative server action. The school-paper Yes/No answer lives on `schools.paper_participation` and is written through `security definer` RPCs so a school cannot touch any other column of its own row.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres + RLS), Zod 4, shadcn/ui on Tailwind v4, Vitest 4, `pg` for migrations.

**Spec:** `docs/superpowers/specs/2026-08-13-press-link-v3-roster-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code — this Next.js version differs from training data (see `AGENTS.md`).
- Migrations are applied with `npx tsx --env-file=.env.local scripts/run-migration.ts <path>`; the runner wraps the whole file in one transaction, so the SQL must be idempotent-safe and must not contain its own `begin`/`commit`.
- Never run `supabase db reset` or drop tables — production holds live school data.
- `participant_number` is unique **division-wide** (not per school), sourced from `participant_number_seq`, rendered zero-padded to 4 digits.
- Individual entries: 1–3 participants. Group entries: 7 exactly for radio-broadcasting-regular, radio-broadcasting-spj, collaborative-publishing, tv-broadcasting-regular, tv-broadcasting-spj; 2-or-more for online-publishing.
- Participation caps: at most 2 individual entries and at most 1 group entry per participant.
- Coaches: individual entries allow 1…(participant count); group entries allow 1…2.
- Every commit message uses Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`).
- Tests run with `npm test` (Vitest, `environment: "node"`) — only pure modules get unit tests; UI tasks verify with `npx tsc --noEmit` and `npm run lint`.

---

### Task 1: Schema migration — roster tables, participant sequence, paper gate

**Files:**
- Create: `supabase/migrations/0004_roster_and_paper_gate.sql`
- Create: `scripts/verify-roster-schema.ts`
- Modify: `package.json` (add `verify-roster-schema` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: tables `participants(id uuid, school_id uuid, participant_number int, first_name text, middle_name text, last_name text, gender text)`, `coaches(id uuid, school_id uuid, full_name text, gender text)`; columns `entry_participants.participant_id uuid`, `entry_coaches.coach_id uuid`, `event_types.min_participants int`, `event_types.max_participants int`, `schools.paper_participation text`; RPCs `set_paper_participation(choice text)` and `admin_reset_paper_participation(target_school uuid)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_roster_and_paper_gate.sql`:

```sql
-- Press Link v3: the roster becomes the source of truth for people.
-- Entries stop storing names and reference participants/coaches by id.

-- 1. Division-wide participant numbering. 4 digits, never reused.
create sequence if not exists participant_number_seq
  start with 1 minvalue 1 maxvalue 9999;

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  participant_number int not null unique default nextval('participant_number_seq'),
  first_name text not null,
  middle_name text,
  last_name text not null,
  gender text not null check (gender in ('M', 'F')),
  created_at timestamptz not null default now()
);

create index if not exists participants_school_id_idx on participants (school_id);

create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  full_name text not null,
  gender text not null check (gender in ('M', 'F')),
  created_at timestamptz not null default now()
);

create index if not exists coaches_school_id_idx on coaches (school_id);

-- 2. Backfill the roster from whatever entries already exist, then swap the
--    name columns for foreign keys. Distinct on the full name so a pupil typed
--    into two entries becomes one roster row.
insert into participants (school_id, first_name, middle_name, last_name, gender)
select distinct e.school_id, ep.first_name, ep.middle_name, ep.last_name, ep.gender
from entry_participants ep
join entries e on e.id = ep.entry_id
where not exists (
  select 1 from participants p
  where p.school_id = e.school_id
    and p.first_name = ep.first_name
    and coalesce(p.middle_name, '') = coalesce(ep.middle_name, '')
    and p.last_name = ep.last_name
);

insert into coaches (school_id, full_name, gender)
select distinct e.school_id, ec.full_name, ec.gender
from entry_coaches ec
join entries e on e.id = ec.entry_id
where not exists (
  select 1 from coaches c
  where c.school_id = e.school_id and c.full_name = ec.full_name
);

alter table entry_participants
  add column if not exists participant_id uuid references participants(id) on delete cascade;
alter table entry_coaches
  add column if not exists coach_id uuid references coaches(id) on delete cascade;

update entry_participants ep
set participant_id = p.id
from entries e, participants p
where e.id = ep.entry_id
  and p.school_id = e.school_id
  and p.first_name = ep.first_name
  and coalesce(p.middle_name, '') = coalesce(ep.middle_name, '')
  and p.last_name = ep.last_name
  and ep.participant_id is null;

update entry_coaches ec
set coach_id = c.id
from entries e, coaches c
where e.id = ec.entry_id
  and c.school_id = e.school_id
  and c.full_name = ec.full_name
  and ec.coach_id is null;

-- Any row that still has no match had no resolvable person; there is nothing
-- to preserve in it.
delete from entry_participants where participant_id is null;
delete from entry_coaches where coach_id is null;

alter table entry_participants alter column participant_id set not null;
alter table entry_coaches alter column coach_id set not null;

alter table entry_participants drop column if exists first_name;
alter table entry_participants drop column if exists middle_name;
alter table entry_participants drop column if exists last_name;
alter table entry_participants drop column if exists gender;

alter table entry_coaches drop column if exists full_name;
alter table entry_coaches drop column if exists gender;

alter table entry_participants
  drop constraint if exists entry_participants_entry_participant_key;
alter table entry_participants
  add constraint entry_participants_entry_participant_key unique (entry_id, participant_id);

alter table entry_coaches
  drop constraint if exists entry_coaches_entry_coach_key;
alter table entry_coaches
  add constraint entry_coaches_entry_coach_key unique (entry_id, coach_id);

-- 3. Per-event participant counts. null max = unbounded.
alter table event_types add column if not exists min_participants int not null default 1;
alter table event_types add column if not exists max_participants int;

update event_types set min_participants = 1, max_participants = 3
  where category = 'individual';
update event_types set min_participants = 7, max_participants = 7
  where slug in (
    'radio-broadcasting-regular',
    'radio-broadcasting-spj',
    'collaborative-publishing',
    'tv-broadcasting-regular',
    'tv-broadcasting-spj'
  );
update event_types set min_participants = 2, max_participants = null
  where slug = 'online-publishing';

-- 4. School paper gate.
alter table schools add column if not exists paper_participation text not null default 'undecided';
alter table schools drop constraint if exists schools_paper_participation_check;
alter table schools add constraint schools_paper_participation_check
  check (paper_participation in ('undecided', 'yes', 'no'));

-- 5. RLS.
alter table participants enable row level security;
alter table coaches enable row level security;

drop policy if exists "school manage own participants" on participants;
create policy "school manage own participants" on participants for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read participants" on participants;
create policy "admin read participants" on participants for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists "school manage own coaches" on coaches;
create policy "school manage own coaches" on coaches for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read coaches" on coaches;
create policy "admin read coaches" on coaches for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

-- 6. The paper answer is the only column a school may write on its own row,
--    so it goes through a definer function rather than an update policy.
create or replace function set_paper_participation(choice text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if choice not in ('yes', 'no') then
    raise exception 'invalid choice: %', choice;
  end if;
  update schools set paper_participation = choice where auth_user_id = auth.uid();
end;
$fn$;

revoke all on function set_paper_participation(text) from public;
grant execute on function set_paper_participation(text) to authenticated;

create or replace function admin_reset_paper_participation(target_school uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  update schools set paper_participation = 'undecided' where id = target_school;
end;
$fn$;

revoke all on function admin_reset_paper_participation(uuid) from public;
grant execute on function admin_reset_paper_participation(uuid) to authenticated;
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify-roster-schema.ts`:

```ts
/**
 * Confirms 0004 landed: the roster tables exist, entries reference them by id,
 * and event_types carries the per-event participant counts.
 *
 *   npx tsx --env-file=.env.local scripts/verify-roster-schema.ts
 */
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const supabase = createAdminClient();
  const failures: string[] = [];

  const probes: { label: string; run: () => Promise<string | null> }[] = [
    {
      label: "participants table",
      run: async () => {
        const { error } = await supabase
          .from("participants")
          .select("id, school_id, participant_number, first_name, middle_name, last_name, gender")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "coaches table",
      run: async () => {
        const { error } = await supabase
          .from("coaches")
          .select("id, school_id, full_name, gender")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "entry_participants.participant_id",
      run: async () => {
        const { error } = await supabase
          .from("entry_participants")
          .select("id, entry_id, participant_id")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "entry_coaches.coach_id",
      run: async () => {
        const { error } = await supabase
          .from("entry_coaches")
          .select("id, entry_id, coach_id")
          .limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "schools.paper_participation",
      run: async () => {
        const { error } = await supabase.from("schools").select("id, paper_participation").limit(1);
        return error ? error.message : null;
      },
    },
    {
      label: "event_types participant counts",
      run: async () => {
        const { data, error } = await supabase
          .from("event_types")
          .select("slug, min_participants, max_participants");
        if (error) return error.message;
        const bySlug = new Map((data ?? []).map((r) => [r.slug as string, r]));
        const seven = [
          "radio-broadcasting-regular",
          "radio-broadcasting-spj",
          "collaborative-publishing",
          "tv-broadcasting-regular",
          "tv-broadcasting-spj",
        ];
        for (const slug of seven) {
          const row = bySlug.get(slug);
          if (!row) return `missing event type ${slug}`;
          if (row.min_participants !== 7 || row.max_participants !== 7) {
            return `${slug} should be 7/7, got ${row.min_participants}/${row.max_participants}`;
          }
        }
        const online = bySlug.get("online-publishing");
        if (!online || online.min_participants !== 2 || online.max_participants !== null) {
          return `online-publishing should be 2/null, got ${online?.min_participants}/${online?.max_participants}`;
        }
        return null;
      },
    },
  ];

  for (const probe of probes) {
    const failure = await probe.run();
    if (failure) {
      failures.push(`${probe.label}: ${failure}`);
      console.log(`FAIL  ${probe.label}`);
    } else {
      console.log(`ok    ${probe.label}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nRoster schema verified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json`, inside `"scripts"`, after the `"verify-event-types"` line, add:

```json
    "verify-roster-schema": "tsx --env-file=.env.local scripts/verify-roster-schema.ts"
```

- [ ] **Step 4: Run the verification before migrating — it must fail**

Run: `npm run verify-roster-schema`
Expected: FAIL — several `FAIL` lines (`participants table: ...could not find the table...`) and exit code 1.

- [ ] **Step 5: Apply the migration**

Run: `npx tsx --env-file=.env.local scripts/run-migration.ts supabase/migrations/0004_roster_and_paper_gate.sql`
Expected: `Connected via ...` then `Applied supabase/migrations/0004_roster_and_paper_gate.sql`.

- [ ] **Step 6: Run the verification again — it must pass**

Run: `npm run verify-roster-schema`
Expected: six `ok` lines and `Roster schema verified.`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_roster_and_paper_gate.sql scripts/verify-roster-schema.ts package.json
git commit -m "feat: add roster tables, participant numbering, and paper gate schema"
```

---

### Task 2: Event catalog carries participant counts

**Files:**
- Modify: `lib/events-catalog.ts`
- Modify: `lib/events-catalog.test.ts`
- Modify: `scripts/seed/events.ts:9-21`

**Interfaces:**
- Consumes: `event_types.min_participants` / `max_participants` from Task 1.
- Produces: `EventTypeSeed.minParticipants: number` and `EventTypeSeed.maxParticipants: number | null` on every entry of the exported `EVENT_TYPES` array; `seedEvents()` writes both columns.

- [ ] **Step 1: Write the failing test**

Append to `lib/events-catalog.test.ts`:

```ts
describe("participant counts", () => {
  it("allows 1 to 3 participants for every individual type", () => {
    for (const type of EVENT_TYPES.filter((t) => t.category === "individual")) {
      expect(type.minParticipants).toBe(1);
      expect(type.maxParticipants).toBe(3);
    }
  });

  it("requires exactly 7 for the five seven-member group contests", () => {
    const sevens = [
      "radio-broadcasting-regular",
      "radio-broadcasting-spj",
      "collaborative-publishing",
      "tv-broadcasting-regular",
      "tv-broadcasting-spj",
    ];
    for (const slug of sevens) {
      const type = EVENT_TYPES.find((t) => t.slug === slug);
      expect(type?.minParticipants).toBe(7);
      expect(type?.maxParticipants).toBe(7);
    }
  });

  it("leaves online publishing unbounded above 2", () => {
    const type = EVENT_TYPES.find((t) => t.slug === "online-publishing");
    expect(type?.minParticipants).toBe(2);
    expect(type?.maxParticipants).toBeNull();
  });
});
```

If `EVENT_TYPES` is not already imported at the top of that file, add it to the existing import from `./events-catalog`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/events-catalog.test.ts`
Expected: FAIL — `expected undefined to be 1`.

- [ ] **Step 3: Add the fields to the catalog**

In `lib/events-catalog.ts`, extend the interface (after `levels`):

```ts
export interface EventTypeSeed {
  slug: string;
  category: EventCategory;
  nameEn: string;
  nameFil: string;
  /** Levels this contest is actually offered at. */
  levels: readonly EventLevel[];
  /** Fewest participants a single entry may carry. */
  minParticipants: number;
  /** Most participants a single entry may carry; null means unbounded. */
  maxParticipants: number | null;
  sortOrder: number;
}
```

Then add `minParticipants` / `maxParticipants` to every row. Individual rows (sortOrder 1–10) each gain `minParticipants: 1, maxParticipants: 3`; the group rows become:

```ts
  { slug: "radio-broadcasting-regular", category: "group", nameEn: "Radio Broadcasting and Scriptwriting (Regular)", nameFil: "Radio Broadcasting and Scriptwriting (Regular)", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 11 },
  { slug: "collaborative-publishing", category: "group", nameEn: "Collaborative Publishing", nameFil: "Collaborative Publishing", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 12 },
  { slug: "radio-broadcasting-spj", category: "group", nameEn: "Radio Broadcasting and Scriptwriting (SPJ)", nameFil: "Radio Broadcasting and Scriptwriting (SPJ)", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 13 },
  { slug: "online-publishing", category: "group", nameEn: "Online Publishing", nameFil: "Online Publishing", levels: SECONDARY_ONLY, minParticipants: 2, maxParticipants: null, sortOrder: 14 },
  { slug: "tv-broadcasting-regular", category: "group", nameEn: "TV Broadcasting and Scriptwriting (Regular)", nameFil: "TV Broadcasting and Scriptwriting (Regular)", levels: SECONDARY_ONLY, minParticipants: 7, maxParticipants: 7, sortOrder: 15 },
  { slug: "tv-broadcasting-spj", category: "group", nameEn: "TV Broadcasting and Scriptwriting (SPJ)", nameFil: "TV Broadcasting and Scriptwriting (SPJ)", levels: SECONDARY_ONLY, minParticipants: 7, maxParticipants: 7, sortOrder: 16 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/events-catalog.test.ts`
Expected: PASS, including the pre-existing catalog tests.

- [ ] **Step 5: Seed the new columns**

In `scripts/seed/events.ts`, extend the `event_types` upsert payload (currently lines 10–16) to:

```ts
    EVENT_TYPES.map((t) => ({
      slug: t.slug,
      category: t.category,
      name_en: t.nameEn,
      name_fil: t.nameFil,
      min_participants: t.minParticipants,
      max_participants: t.maxParticipants,
      sort_order: t.sortOrder,
    })),
```

- [ ] **Step 6: Run the seed and re-verify the schema**

Run: `npm run seed:events && npm run verify-roster-schema`
Expected: `Seeded 16 event types and 56 events.` followed by `Roster schema verified.`

- [ ] **Step 7: Commit**

```bash
git add lib/events-catalog.ts lib/events-catalog.test.ts scripts/seed/events.ts
git commit -m "feat: give event types per-event participant counts"
```

---

### Task 3: Roster validation schemas

**Files:**
- Create: `lib/validation/roster.ts`
- Test: `lib/validation/roster.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `rosterParticipantSchema` (`{ firstName: string; middleName?: string; lastName: string; gender: "M" | "F" }`), `rosterCoachSchema` (`{ fullName: string; gender: "M" | "F" }`), `paperParticipationSchema` (`"yes" | "no"`), and the inferred types `RosterParticipantInput`, `RosterCoachInput`, `PaperParticipationInput`.

- [ ] **Step 1: Write the failing test**

Create `lib/validation/roster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  paperParticipationSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "./roster";

describe("rosterParticipantSchema", () => {
  it("accepts a participant without a middle name", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "Dela Cruz",
      gender: "F",
    });
    expect(result.success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "  Ana  ",
      lastName: "Dela Cruz",
      gender: "F",
    });
    expect(result.success && result.data.firstName).toBe("Ana");
  });

  it("rejects a blank last name", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "   ",
      gender: "F",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a gender outside M and F", () => {
    const result = rosterParticipantSchema.safeParse({
      firstName: "Ana",
      lastName: "Dela Cruz",
      gender: "X",
    });
    expect(result.success).toBe(false);
  });
});

describe("rosterCoachSchema", () => {
  it("accepts a complete name", () => {
    const result = rosterCoachSchema.safeParse({ fullName: "Mr. Reyes", gender: "M" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    const result = rosterCoachSchema.safeParse({ fullName: "", gender: "M" });
    expect(result.success).toBe(false);
  });
});

describe("paperParticipationSchema", () => {
  it("accepts yes and no", () => {
    expect(paperParticipationSchema.safeParse("yes").success).toBe(true);
    expect(paperParticipationSchema.safeParse("no").success).toBe(true);
  });

  it("rejects undecided — it is a state, not an answer", () => {
    expect(paperParticipationSchema.safeParse("undecided").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/validation/roster.test.ts`
Expected: FAIL — `Failed to resolve import "./roster"`.

- [ ] **Step 3: Write the schemas**

Create `lib/validation/roster.ts`:

```ts
import { z } from "zod";

export const rosterParticipantSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["M", "F"]),
});

export const rosterCoachSchema = z.object({
  fullName: z.string().trim().min(1, "Coach name is required"),
  gender: z.enum(["M", "F"]),
});

/**
 * Only an actual answer is writable. `undecided` is the state a school starts
 * in and the state an admin resets it to — never something the school submits.
 */
export const paperParticipationSchema = z.enum(["yes", "no"]);

export type RosterParticipantInput = z.infer<typeof rosterParticipantSchema>;
export type RosterCoachInput = z.infer<typeof rosterCoachSchema>;
export type PaperParticipationInput = z.infer<typeof paperParticipationSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/validation/roster.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/roster.ts lib/validation/roster.test.ts
git commit -m "feat: add roster participant and coach validation schemas"
```

---

### Task 4: Roster limit rules

**Files:**
- Create: `lib/roster/limits.ts`
- Test: `lib/roster/limits.test.ts`

**Interfaces:**
- Consumes: `EventCategory` from `lib/events-catalog.ts`.
- Produces:
  - `formatParticipantNumber(value: number): string` — `7` → `"0007"`.
  - `interface ParticipantUsage { individualCount: number; groupCount: number }`
  - `type UsageMap = Record<string, ParticipantUsage>` keyed by participant id.
  - `INDIVIDUAL_EVENT_CAP = 2`, `GROUP_EVENT_CAP = 1`.
  - `capReason(usage: ParticipantUsage | undefined, category: EventCategory): string | null` — a human-readable reason when the participant is at the cap, else `null`.
  - `maxCoachesFor(category: EventCategory, participantCount: number): number`
  - `validateEntryCounts(input: { category: EventCategory; participantIds: string[]; coachIds: string[]; minParticipants: number; maxParticipants: number | null }): string | null` — an error message or `null`.

- [ ] **Step 1: Write the failing test**

Create `lib/roster/limits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  capReason,
  formatParticipantNumber,
  maxCoachesFor,
  validateEntryCounts,
} from "./limits";

describe("formatParticipantNumber", () => {
  it("pads to four digits", () => {
    expect(formatParticipantNumber(1)).toBe("0001");
    expect(formatParticipantNumber(42)).toBe("0042");
    expect(formatParticipantNumber(9999)).toBe("9999");
  });
});

describe("capReason", () => {
  it("returns null for a participant with no history", () => {
    expect(capReason(undefined, "individual")).toBeNull();
    expect(capReason(undefined, "group")).toBeNull();
  });

  it("allows a second individual event but not a third", () => {
    expect(capReason({ individualCount: 1, groupCount: 0 }, "individual")).toBeNull();
    expect(capReason({ individualCount: 2, groupCount: 0 }, "individual")).toBe(
      "Already in 2 individual events"
    );
  });

  it("allows only one group event", () => {
    expect(capReason({ individualCount: 0, groupCount: 0 }, "group")).toBeNull();
    expect(capReason({ individualCount: 0, groupCount: 1 }, "group")).toBe(
      "Already in a group event"
    );
  });

  it("counts the two categories independently", () => {
    expect(capReason({ individualCount: 2, groupCount: 0 }, "group")).toBeNull();
    expect(capReason({ individualCount: 0, groupCount: 1 }, "individual")).toBeNull();
  });
});

describe("maxCoachesFor", () => {
  it("ties individual coaches to the participant count", () => {
    expect(maxCoachesFor("individual", 1)).toBe(1);
    expect(maxCoachesFor("individual", 2)).toBe(2);
    expect(maxCoachesFor("individual", 3)).toBe(3);
  });

  it("caps group coaches at 2 regardless of team size", () => {
    expect(maxCoachesFor("group", 7)).toBe(2);
    expect(maxCoachesFor("group", 2)).toBe(2);
  });
});

describe("validateEntryCounts", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it("accepts a 1-participant 1-coach individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBeNull();
  });

  it("rejects a 4th participant in an individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(4),
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("This event allows at most 3 participants");
  });

  it("rejects a 6-member team for a 7-member contest", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(6),
        coachIds: ["c1"],
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("This event requires at least 7 participants");
  });

  it("accepts an unbounded group above its minimum", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(9),
        coachIds: ["c1"],
        minParticipants: 2,
        maxParticipants: null,
      })
    ).toBeNull();
  });

  it("rejects 2 coaches on a 1-participant individual entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: ["c1", "c2"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("This entry allows at most 1 coach");
  });

  it("rejects 3 coaches on a group entry", () => {
    expect(
      validateEntryCounts({
        category: "group",
        participantIds: ids(7),
        coachIds: ["c1", "c2", "c3"],
        minParticipants: 7,
        maxParticipants: 7,
      })
    ).toBe("This entry allows at most 2 coaches");
  });

  it("rejects an entry with no coach", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ids(1),
        coachIds: [],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("At least 1 coach is required");
  });

  it("rejects the same participant twice in one entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ["p1", "p1"],
        coachIds: ["c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("The same participant cannot be added twice");
  });

  it("rejects the same coach twice in one entry", () => {
    expect(
      validateEntryCounts({
        category: "individual",
        participantIds: ["p1", "p2"],
        coachIds: ["c1", "c1"],
        minParticipants: 1,
        maxParticipants: 3,
      })
    ).toBe("The same coach cannot be added twice");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/roster/limits.test.ts`
Expected: FAIL — `Failed to resolve import "./limits"`.

- [ ] **Step 3: Write the implementation**

Create `lib/roster/limits.ts`:

```ts
import type { EventCategory } from "@/lib/events-catalog";

/** A participant may compete in at most this many individual contests. */
export const INDIVIDUAL_EVENT_CAP = 2;
/** ...and at most this many group contests. */
export const GROUP_EVENT_CAP = 1;

/** How many entries a participant already appears in, split by category. */
export interface ParticipantUsage {
  individualCount: number;
  groupCount: number;
}

/** Keyed by participant id. Absent means the participant has no entries yet. */
export type UsageMap = Record<string, ParticipantUsage>;

export function formatParticipantNumber(value: number): string {
  return String(value).padStart(4, "0");
}

/**
 * Why this participant cannot join another entry of `category`, or null when
 * they still can. The string is shown next to the disabled option.
 */
export function capReason(
  usage: ParticipantUsage | undefined,
  category: EventCategory
): string | null {
  if (!usage) return null;
  if (category === "individual") {
    return usage.individualCount >= INDIVIDUAL_EVENT_CAP
      ? `Already in ${INDIVIDUAL_EVENT_CAP} individual events`
      : null;
  }
  return usage.groupCount >= GROUP_EVENT_CAP ? "Already in a group event" : null;
}

/**
 * Individual entries get one coach per participant; group entries get two no
 * matter how large the team.
 */
export function maxCoachesFor(category: EventCategory, participantCount: number): number {
  return category === "individual" ? Math.max(participantCount, 1) : 2;
}

export function validateEntryCounts(input: {
  category: EventCategory;
  participantIds: string[];
  coachIds: string[];
  minParticipants: number;
  maxParticipants: number | null;
}): string | null {
  const { category, participantIds, coachIds, minParticipants, maxParticipants } = input;

  if (new Set(participantIds).size !== participantIds.length) {
    return "The same participant cannot be added twice";
  }
  if (new Set(coachIds).size !== coachIds.length) {
    return "The same coach cannot be added twice";
  }
  if (participantIds.length < minParticipants) {
    return `This event requires at least ${minParticipants} participant${
      minParticipants === 1 ? "" : "s"
    }`;
  }
  if (maxParticipants !== null && participantIds.length > maxParticipants) {
    return `This event allows at most ${maxParticipants} participant${
      maxParticipants === 1 ? "" : "s"
    }`;
  }
  if (coachIds.length < 1) {
    return "At least 1 coach is required";
  }
  const maxCoaches = maxCoachesFor(category, participantIds.length);
  if (coachIds.length > maxCoaches) {
    return `This entry allows at most ${maxCoaches} coach${maxCoaches === 1 ? "" : "es"}`;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/roster/limits.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/roster/limits.ts lib/roster/limits.test.ts
git commit -m "feat: add participant cap, coach limit, and entry count rules"
```

---

### Task 5: Entry schema becomes id-based

**Files:**
- Modify: `lib/validation/entry.ts` (full rewrite)
- Modify: `lib/validation/entry.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing from earlier tasks (count rules live in `lib/roster/limits.ts` and are applied by callers, not by this schema).
- Produces: `entrySchema` parsing `{ eventId: string; participantIds: string[]; coachIds: string[] }` where all values are uuids; `type EntryInput = z.infer<typeof entrySchema>`. The old `participantSchema` / `coachSchema` exports are removed.

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `lib/validation/entry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { entrySchema } from "./entry";

const EVENT = "123e4567-e89b-12d3-a456-426614174000";
const P1 = "223e4567-e89b-12d3-a456-426614174001";
const P2 = "323e4567-e89b-12d3-a456-426614174002";
const C1 = "423e4567-e89b-12d3-a456-426614174003";

describe("entrySchema", () => {
  it("accepts an entry referencing roster ids", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [P1, P2],
      coachIds: [C1],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry with no participants", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with no coaches", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: [P1],
      coachIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a typed name where an id belongs", () => {
    const result = entrySchema.safeParse({
      eventId: EVENT,
      participantIds: ["Ana Dela Cruz"],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid event id", () => {
    const result = entrySchema.safeParse({
      eventId: "news-writing",
      participantIds: [P1],
      coachIds: [C1],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/validation/entry.test.ts`
Expected: FAIL — the first test fails because the current schema requires `category` and object-shaped `participants`.

- [ ] **Step 3: Rewrite the schema**

Replace the entire contents of `lib/validation/entry.ts`:

```ts
import { z } from "zod";

/**
 * Shape only. Count rules (per-event minimums, coach limits, participation
 * caps) depend on database state, so they live in `lib/roster/limits.ts` and
 * `saveEntryAction` rather than here.
 */
export const entrySchema = z.object({
  eventId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1, "Pick at least 1 participant"),
  coachIds: z.array(z.string().uuid()).min(1, "Pick at least 1 coach"),
});

export type EntryInput = z.infer<typeof entrySchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/validation/entry.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

The app will not typecheck until Task 6 updates the callers; that is expected and the tests are green, so commit the schema on its own.

```bash
git add lib/validation/entry.ts lib/validation/entry.test.ts
git commit -m "refactor: make the entry schema reference roster ids"
```

---

### Task 6: Server actions — roster CRUD and the paper gate

**Files:**
- Create: `app/entry/roster-actions.ts`
- Modify: `app/entry/actions.ts:84-141` (`saveEntryAction`)

**Interfaces:**
- Consumes: `rosterParticipantSchema`, `rosterCoachSchema`, `paperParticipationSchema` (Task 3); `validateEntryCounts`, `type UsageMap`, `capReason` (Task 4); `entrySchema` (Task 5).
- Produces:
  - `addParticipantAction(input: unknown): Promise<{ error: string } | { success: true }>`
  - `deleteParticipantAction(participantId: string): Promise<{ error: string } | { success: true }>`
  - `addCoachAction(input: unknown): Promise<{ error: string } | { success: true }>`
  - `deleteCoachAction(coachId: string): Promise<{ error: string } | { success: true }>`
  - `setPaperParticipationAction(choice: unknown): Promise<{ error: string } | { success: true }>`
  - `saveEntryAction(entryId: string | null, input: unknown)` keeps its signature but now expects `EntryInput`.

- [ ] **Step 1: Write the roster actions**

Create `app/entry/roster-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  paperParticipationSchema,
  rosterCoachSchema,
  rosterParticipantSchema,
} from "@/lib/validation/roster";

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

async function assertUnlocked(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: settings } = await supabase
    .from("app_settings")
    .select("submissions_locked")
    .single();
  return settings?.submissions_locked ? "Submissions are locked." : null;
}

export async function addParticipantAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterParticipantSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  // participant_number comes from the division-wide sequence default.
  const { error } = await supabase.from("participants").insert({
    school_id: schoolId,
    first_name: parsed.data.firstName,
    middle_name: parsed.data.middleName || null,
    last_name: parsed.data.lastName,
    gender: parsed.data.gender,
  });
  if (error) return { error: "Could not add participant." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteParticipantAction(
  participantId: string
): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { count } = await supabase
    .from("entry_participants")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId);
  if (count && count > 0) {
    return { error: "Remove this participant from their entries first." };
  }

  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId)
    .eq("school_id", schoolId);
  if (error) return { error: "Could not delete participant." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function addCoachAction(
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = rosterCoachSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { error } = await supabase.from("coaches").insert({
    school_id: schoolId,
    full_name: parsed.data.fullName,
    gender: parsed.data.gender,
  });
  if (error) return { error: "Could not add coach." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function deleteCoachAction(
  coachId: string
): Promise<{ error: string } | { success: true }> {
  const { supabase, schoolId } = await getSchoolId();
  const locked = await assertUnlocked(supabase);
  if (locked) return { error: locked };

  const { count } = await supabase
    .from("entry_coaches")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", coachId);
  if (count && count > 0) {
    return { error: "Remove this coach from their entries first." };
  }

  const { error } = await supabase
    .from("coaches")
    .delete()
    .eq("id", coachId)
    .eq("school_id", schoolId);
  if (error) return { error: "Could not delete coach." };

  revalidatePath("/entry");
  return { success: true as const };
}

export async function setPaperParticipationAction(
  choice: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = paperParticipationSchema.safeParse(choice);
  if (!parsed.success) return { error: "Please answer Yes or No." };

  const supabase = await createClient();
  // Definer RPC: a school may write this column and nothing else on its row.
  const { error } = await supabase.rpc("set_paper_participation", { choice: parsed.data });
  if (error) return { error: "Could not save your answer." };

  revalidatePath("/entry");
  return { success: true as const };
}
```

- [ ] **Step 2: Rewrite `saveEntryAction`**

In `app/entry/actions.ts`, replace the whole `saveEntryAction` function (lines 84–141) with:

```ts
export async function saveEntryAction(
  entryId: string | null,
  input: unknown
): Promise<{ error: string } | { success: true }> {
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return { error: typeof message === "string" ? message : "Invalid input" };
  }
  const { supabase, schoolId } = await getSchoolId();
  const { data: settings } = await supabase.from("app_settings").select("submissions_locked").single();
  if (settings?.submissions_locked) {
    return { error: "Submissions are locked." };
  }

  const { participantIds, coachIds, eventId } = parsed.data;

  // Counts come from the database, never from the client.
  const { data: event } = await supabase
    .from("events")
    .select("id, category, event_types(min_participants, max_participants)")
    .eq("id", eventId)
    .single<{
      id: string;
      category: "individual" | "group";
      event_types: { min_participants: number; max_participants: number | null } | null;
    }>();
  if (!event || !event.event_types) return { error: "Unknown event." };

  const countError = validateEntryCounts({
    category: event.category,
    participantIds,
    coachIds,
    minParticipants: event.event_types.min_participants,
    maxParticipants: event.event_types.max_participants,
  });
  if (countError) return { error: countError };

  // Everyone referenced must belong to this school.
  const [{ data: ownedParticipants }, { data: ownedCoaches }] = await Promise.all([
    supabase.from("participants").select("id").eq("school_id", schoolId).in("id", participantIds),
    supabase.from("coaches").select("id").eq("school_id", schoolId).in("id", coachIds),
  ]);
  if ((ownedParticipants?.length ?? 0) !== participantIds.length) {
    return { error: "One of those participants is not on your roster." };
  }
  if ((ownedCoaches?.length ?? 0) !== coachIds.length) {
    return { error: "One of those coaches is not on your roster." };
  }

  // Participation caps, counted over every entry except the one being edited.
  const { data: usageRows } = await supabase
    .from("entry_participants")
    .select("participant_id, entry_id, entries(event_id, events(category))")
    .in("participant_id", participantIds)
    .overrideTypes<
      {
        participant_id: string;
        entry_id: string;
        entries: { event_id: string; events: { category: "individual" | "group" } | null } | null;
      }[]
    >();

  const usage: UsageMap = {};
  for (const row of usageRows ?? []) {
    if (entryId && row.entry_id === entryId) continue;
    const category = row.entries?.events?.category;
    if (!category) continue;
    const current = usage[row.participant_id] ?? { individualCount: 0, groupCount: 0 };
    if (category === "individual") current.individualCount += 1;
    else current.groupCount += 1;
    usage[row.participant_id] = current;
  }

  for (const participantId of participantIds) {
    const reason = capReason(usage[participantId], event.category);
    if (reason) {
      return { error: `A selected participant is unavailable: ${reason.toLowerCase()}.` };
    }
  }

  let id = entryId;
  if (id) {
    const { error } = await supabase
      .from("entries")
      .update({ event_id: eventId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("school_id", schoolId);
    if (error) return { error: "Could not update entry." };
    await supabase.from("entry_participants").delete().eq("entry_id", id);
    await supabase.from("entry_coaches").delete().eq("entry_id", id);
  } else {
    const { data: inserted, error } = await supabase
      .from("entries")
      .insert({ event_id: eventId, school_id: schoolId })
      .select("id")
      .single();
    if (error || !inserted) return { error: "Could not create entry." };
    id = inserted.id;
  }

  const { error: participantsError } = await supabase
    .from("entry_participants")
    .insert(participantIds.map((participantId) => ({ entry_id: id, participant_id: participantId })));
  if (participantsError) return { error: "Could not save participants." };

  const { error: coachesError } = await supabase
    .from("entry_coaches")
    .insert(coachIds.map((coachId) => ({ entry_id: id, coach_id: coachId })));
  if (coachesError) return { error: "Could not save coaches." };

  revalidatePath("/entry");
  return { success: true as const };
}
```

- [ ] **Step 3: Add the imports `saveEntryAction` now needs**

At the top of `app/entry/actions.ts`, below the existing `entrySchema` import, add:

```ts
import { capReason, validateEntryCounts, type UsageMap } from "@/lib/roster/limits";
```

- [ ] **Step 4: Typecheck the server layer**

Run: `npx tsc --noEmit`
Expected: errors **only** in `app/entry/EntryWizard.tsx` and `app/entry/page.tsx` (they still pass names). No errors in `app/entry/actions.ts` or `app/entry/roster-actions.ts`. Those two files are fixed in Tasks 7 and 9.

- [ ] **Step 5: Commit**

```bash
git add app/entry/roster-actions.ts app/entry/actions.ts
git commit -m "feat: add roster server actions and enforce entry caps server-side"
```

---

### Task 7: Entry page data loading

**Files:**
- Modify: `app/entry/types.ts` (full rewrite)
- Modify: `app/entry/page.tsx:19-120`

**Interfaces:**
- Consumes: `formatParticipantNumber`, `type UsageMap` (Task 4).
- Produces:
  - `interface RosterParticipant { id: string; participant_number: number; number_label: string; first_name: string; middle_name: string | null; last_name: string; gender: "M" | "F"; full_name: string }`
  - `interface RosterCoach { id: string; full_name: string; gender: "M" | "F" }`
  - `interface EntryRow { id; event_id; submitted_at; submitted_label; event_type_id; event_name; level; language; category: EventCategory; participants: RosterParticipant[]; coaches: RosterCoach[] }`
  - `type PaperParticipation = "undecided" | "yes" | "no"`
  - `EntryDashboard` receives new props `participants: RosterParticipant[]`, `coaches: RosterCoach[]`, `usage: UsageMap`, `paperParticipation: PaperParticipation`.

- [ ] **Step 1: Rewrite the types**

Replace the entire contents of `app/entry/types.ts`:

```ts
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

/** A person on the school's roster, ready to be picked into an entry. */
export interface RosterParticipant {
  id: string;
  participant_number: number;
  /** Zero-padded on the server so no component re-derives it. */
  number_label: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  /** "Dela Cruz, Ana M." — built once on the server. */
  full_name: string;
}

export interface RosterCoach {
  id: string;
  full_name: string;
  gender: "M" | "F";
}

export interface EntryRow {
  id: string;
  event_id: string;
  submitted_at: string;
  /** Preformatted on the server so the client never re-derives a locale string. */
  submitted_label: string;
  event_type_id: string;
  event_name: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  participants: RosterParticipant[];
  coaches: RosterCoach[];
}

export type PaperParticipation = "undecided" | "yes" | "no";

export interface PaperStaffRow {
  id: string;
  full_name: string;
  title: "section_head" | "assistant_head";
}

export interface SchoolPaperRow {
  id: string;
  language: EventLanguage;
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: PaperStaffRow[];
}
```

- [ ] **Step 2: Rewrite the page's data loading**

In `app/entry/page.tsx`, replace everything from the `interface RawEntry` declaration (line 19) through the closing `}` of the component with:

```tsx
interface RawParticipant {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
}

interface RawEntry {
  id: string;
  event_id: string;
  submitted_at: string;
  events: {
    name: string;
    category: EventCategory;
    level: EntryRow["level"];
    language: EntryRow["language"];
    event_type_id: string;
  } | null;
  entry_participants: { participants: RawParticipant | null }[];
  entry_coaches: { coaches: RosterCoach | null }[];
}

/** "Dela Cruz, Ana M." — surname first, the way the division office lists people. */
function toRosterParticipant(row: RawParticipant): RosterParticipant {
  const given = [row.first_name, row.middle_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    participant_number: row.participant_number,
    number_label: formatParticipantNumber(row.participant_number),
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    gender: row.gender,
    full_name: [row.last_name, given].filter(Boolean).join(", "),
  };
}

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
    .select("id, name, paper_participation, districts(name)")
    .eq("auth_user_id", user.id)
    .single<{
      id: string;
      name: string;
      paper_participation: PaperParticipation;
      districts: { name: string } | null;
    }>();

  if (!school) {
    redirect("/login");
  }

  const [
    { data: settings },
    { data: papers },
    { data: types },
    { data: events },
    { data: rawParticipants },
    { data: rawCoaches },
    { data: rawEntries },
  ] = await Promise.all([
    supabase.from("app_settings").select("submissions_locked").single(),
    supabase
      .from("school_papers")
      .select(
        "id, language, paper_name, adviser_name, adviser_gender, principal_name, paper_staff(id, full_name, title)"
      )
      .eq("school_id", school.id)
      .overrideTypes<SchoolPaperRow[]>(),
    supabase
      .from("event_types")
      .select("id, slug, category, name_en, name_fil, min_participants, max_participants, sort_order")
      .order("sort_order")
      .overrideTypes<EventTypeRow[]>(),
    supabase
      .from("events")
      .select("id, event_type_id, category, level, language, name, sort_order")
      .order("sort_order")
      .overrideTypes<EventRow[]>(),
    supabase
      .from("participants")
      .select("id, participant_number, first_name, middle_name, last_name, gender")
      .eq("school_id", school.id)
      .order("participant_number")
      .overrideTypes<RawParticipant[]>(),
    supabase
      .from("coaches")
      .select("id, full_name, gender")
      .eq("school_id", school.id)
      .order("full_name")
      .overrideTypes<RosterCoach[]>(),
    supabase
      .from("entries")
      .select(
        "id, event_id, submitted_at, events(name, category, level, language, event_type_id), entry_participants(participants(id, participant_number, first_name, middle_name, last_name, gender)), entry_coaches(coaches(id, full_name, gender))"
      )
      .eq("school_id", school.id)
      .order("submitted_at", { ascending: false })
      .overrideTypes<RawEntry[]>(),
  ]);

  const entries: EntryRow[] = (rawEntries ?? []).map((row) => ({
    id: row.id,
    event_id: row.event_id,
    submitted_at: row.submitted_at,
    submitted_label: row.submitted_at
      ? DATE_FORMAT.format(new Date(row.submitted_at))
      : "—",
    event_type_id: row.events?.event_type_id ?? "",
    event_name: row.events?.name ?? "Unknown event",
    category: row.events?.category ?? "individual",
    level: row.events?.level ?? "elementary",
    language: row.events?.language ?? "english",
    participants: row.entry_participants
      .map((link) => link.participants)
      .filter((p): p is RawParticipant => p !== null)
      .map(toRosterParticipant),
    coaches: row.entry_coaches
      .map((link) => link.coaches)
      .filter((c): c is RosterCoach => c !== null),
  }));

  // How many entries each participant already sits in, so the wizard can grey
  // out anyone at their cap without a second round trip.
  const usage: UsageMap = {};
  for (const entry of entries) {
    for (const participant of entry.participants) {
      const current = usage[participant.id] ?? { individualCount: 0, groupCount: 0 };
      if (entry.category === "individual") current.individualCount += 1;
      else current.groupCount += 1;
      usage[participant.id] = current;
    }
  }

  const locked = settings?.submissions_locked ?? false;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title={school.name}
        subtitle={school.districts?.name}
        badge={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        signOutAction={signOutAction}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <EntryDashboard
          entries={entries}
          types={types ?? []}
          events={events ?? []}
          papers={papers ?? []}
          participants={(rawParticipants ?? []).map(toRosterParticipant)}
          coaches={rawCoaches ?? []}
          usage={usage}
          paperParticipation={school.paper_participation}
          locked={locked}
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Fix the page's imports**

Replace the import block at the top of `app/entry/page.tsx` (lines 1–8) with:

```tsx
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { EntryDashboard } from "./EntryDashboard";
import type {
  EntryRow,
  PaperParticipation,
  RosterCoach,
  RosterParticipant,
  SchoolPaperRow,
} from "./types";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { formatParticipantNumber, type UsageMap } from "@/lib/roster/limits";
import type { EventCategory } from "@/lib/events-catalog";
import { DashboardHeader } from "@/components/dashboard-header";
```

- [ ] **Step 4: Extend `EventTypeRow` with the count columns**

In `app/entry/wizard-steps.ts`, add two fields to `EventTypeRow` (after `name_fil`):

```ts
  min_participants: number;
  max_participants: number | null;
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `app/entry/EntryDashboard.tsx` (missing props) and `app/entry/EntryWizard.tsx` (still uses name drafts). Nothing in `page.tsx`, `types.ts`, or `wizard-steps.ts`.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — `wizard-steps.test.ts` still green because the helper signatures are unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/entry/types.ts app/entry/page.tsx app/entry/wizard-steps.ts
git commit -m "feat: load the school roster and participation usage on the entry page"
```

---

### Task 8: Roster panel UI

**Files:**
- Create: `app/entry/RosterPanel.tsx`

**Interfaces:**
- Consumes: `RosterParticipant`, `RosterCoach` (Task 7); `addParticipantAction`, `deleteParticipantAction`, `addCoachAction`, `deleteCoachAction` (Task 6); `type UsageMap`, `INDIVIDUAL_EVENT_CAP` (Task 4).
- Produces: `export function RosterPanel({ participants, coaches, usage, locked }: { participants: RosterParticipant[]; coaches: RosterCoach[]; usage: UsageMap; locked: boolean })`.

- [ ] **Step 1: Write the component**

Create `app/entry/RosterPanel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  addCoachAction,
  addParticipantAction,
  deleteCoachAction,
  deleteParticipantAction,
} from "./roster-actions";
import type { RosterCoach, RosterParticipant } from "./types";
import { type UsageMap } from "@/lib/roster/limits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RosterPanel({
  participants,
  coaches,
  usage,
  locked,
}: {
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  locked: boolean;
}) {
  return (
    <Tabs defaultValue="participants">
      <TabsList className="w-full">
        <TabsTrigger value="participants" className="flex-1 gap-2">
          Participants
          <Badge variant="secondary" className="text-[10px]">
            {participants.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="coaches" className="flex-1 gap-2">
          Coaches
          <Badge variant="secondary" className="text-[10px]">
            {coaches.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="participants" className="pt-4">
        <ParticipantsTab participants={participants} usage={usage} locked={locked} />
      </TabsContent>
      <TabsContent value="coaches" className="pt-4">
        <CoachesTab coaches={coaches} locked={locked} />
      </TabsContent>
    </Tabs>
  );
}

function ParticipantsTab({
  participants,
  usage,
  locked,
}: {
  participants: RosterParticipant[];
  usage: UsageMap;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");

  function handleAdd() {
    startTransition(async () => {
      const result = await addParticipantAction({ firstName, middleName, lastName, gender });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFirstName("");
      setMiddleName("");
      setLastName("");
      setGender("M");
      toast.success("Participant added.");
      router.refresh();
    });
  }

  function handleDelete(participant: RosterParticipant) {
    startTransition(async () => {
      const result = await deleteParticipantAction(participant.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${participant.full_name} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-first-name">First name</Label>
          <Input
            id="roster-first-name"
            value={firstName}
            disabled={locked}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-middle-name">Middle name</Label>
          <Input
            id="roster-middle-name"
            value={middleName}
            disabled={locked}
            onChange={(e) => setMiddleName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-last-name">Last name</Label>
          <Input
            id="roster-last-name"
            value={lastName}
            disabled={locked}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Gender</Label>
          <RadioGroup
            value={gender}
            disabled={locked}
            onValueChange={(v) => setGender(v as "M" | "F")}
            className="flex h-9 items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id="roster-gender-m" />
              <Label htmlFor="roster-gender-m" className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id="roster-gender-f" />
              <Label htmlFor="roster-gender-f" className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full"
            disabled={locked || isPending}
            onClick={handleAdd}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add participant
          </Button>
        </div>
      </div>

      {participants.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No participants yet. Add your contestants here before creating entries.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead className="w-40">Events</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((participant) => {
                const entry = usage[participant.id];
                const individual = entry?.individualCount ?? 0;
                const group = entry?.groupCount ?? 0;
                return (
                  <TableRow key={participant.id}>
                    <TableCell className="font-mono tabular-nums">
                      {participant.number_label}
                    </TableCell>
                    <TableCell className="font-medium">{participant.full_name}</TableCell>
                    <TableCell>{participant.gender}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {individual + group === 0
                        ? "—"
                        : `${individual} individual · ${group} group`}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${participant.full_name}`}
                        disabled={locked || isPending}
                        onClick={() => handleDelete(participant)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CoachesTab({ coaches, locked }: { coaches: RosterCoach[]; locked: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");

  function handleAdd() {
    startTransition(async () => {
      const result = await addCoachAction({ fullName, gender });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFullName("");
      setGender("M");
      toast.success("Coach added.");
      router.refresh();
    });
  }

  function handleDelete(coach: RosterCoach) {
    startTransition(async () => {
      const result = await deleteCoachAction(coach.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${coach.full_name} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="roster-coach-name">Complete name</Label>
          <Input
            id="roster-coach-name"
            value={fullName}
            disabled={locked}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Gender</Label>
          <RadioGroup
            value={gender}
            disabled={locked}
            onValueChange={(v) => setGender(v as "M" | "F")}
            className="flex h-9 items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id="roster-coach-gender-m" />
              <Label htmlFor="roster-coach-gender-m" className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id="roster-coach-gender-f" />
              <Label htmlFor="roster-coach-gender-f" className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="sm:col-span-3">
          <Button type="button" disabled={locked || isPending} onClick={handleAdd}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add coach
          </Button>
        </div>
      </div>

      {coaches.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No coaches yet. Add them here so entries can select them.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coaches.map((coach) => (
                <TableRow key={coach.id}>
                  <TableCell className="font-medium">{coach.full_name}</TableCell>
                  <TableCell>{coach.gender}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${coach.full_name}`}
                      disabled={locked || isPending}
                      onClick={() => handleDelete(coach)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `RosterPanel.tsx`. The pre-existing `EntryDashboard.tsx` / `EntryWizard.tsx` errors remain until Tasks 9 and 10.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `app/entry/RosterPanel.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/entry/RosterPanel.tsx
git commit -m "feat: add the participant and coach roster panel"
```

---

### Task 9: Paper gate dialog and dashboard wiring

**Files:**
- Create: `app/entry/PaperGateDialog.tsx`
- Modify: `app/entry/EntryDashboard.tsx` (full rewrite)
- Modify: `app/entry/SchoolPaperDialog.tsx:71-117`

**Interfaces:**
- Consumes: `setPaperParticipationAction` (Task 6); `RosterParticipant`, `RosterCoach`, `PaperParticipation` (Task 7); `RosterPanel` (Task 8).
- Produces: `export function PaperGateDialog({ open }: { open: boolean })`; `EntryDashboard` accepting `{ entries, types, events, papers, participants, coaches, usage, paperParticipation, locked }`.

- [ ] **Step 1: Write the gate dialog**

Create `app/entry/PaperGateDialog.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Newspaper } from "lucide-react";

import { setPaperParticipationAction } from "./roster-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Blocks the dashboard until the school answers. There is no close affordance:
 * `onOpenChange` is a no-op, so Escape and the overlay cannot dismiss it.
 */
export function PaperGateDialog({ open }: { open: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(choice: "yes" | "no") {
    setError(null);
    startTransition(async () => {
      const result = await setPaperParticipationAction(choice);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(
        choice === "yes"
          ? "Fill in your school paper details below."
          : "Recorded. The School Paper form stays closed until an admin reopens it."
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            Is your school submitting a school paper?
          </DialogTitle>
          <DialogDescription>
            Answer once. Choosing No closes the School Paper form for your school until
            the division office reopens it — you can still register participants,
            coaches, and entries either way.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" disabled={isPending} onClick={() => answer("yes")}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Yes, we are submitting
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={isPending}
            onClick={() => answer("no")}
          >
            No, we are not
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

If `components/ui/dialog.tsx` has no `showCloseButton` prop on `DialogContent`, drop that prop and instead pass `className="sm:max-w-lg [&>button[type='button']:last-of-type]:hidden"` — check the file before writing.

- [ ] **Step 2: Rewrite the dashboard**

Replace the entire contents of `app/entry/EntryDashboard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Lock, Newspaper, Plus } from "lucide-react";

import { EntriesTable } from "./EntriesTable";
import { EntryWizard } from "./EntryWizard";
import { PaperGateDialog } from "./PaperGateDialog";
import { RosterPanel } from "./RosterPanel";
import { SchoolPaperDialog } from "./SchoolPaperDialog";
import type {
  EntryRow,
  PaperParticipation,
  RosterCoach,
  RosterParticipant,
  SchoolPaperRow,
} from "./types";
import type { EventRow, EventTypeRow } from "./wizard-steps";
import { type UsageMap } from "@/lib/roster/limits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function EntryDashboard({
  entries,
  types,
  events,
  papers,
  participants,
  coaches,
  usage,
  paperParticipation,
  locked,
}: {
  entries: EntryRow[];
  types: EventTypeRow[];
  events: EventRow[];
  papers: SchoolPaperRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  paperParticipation: PaperParticipation;
  locked: boolean;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [paperOpen, setPaperOpen] = useState(false);

  const paperDeclined = paperParticipation === "no";
  const missingPapers = (["english", "filipino"] as const).filter(
    (lang) => !papers.some((p) => p.language === lang)
  );

  // Answering Yes should land the school straight in the form it just agreed to
  // fill, without a second click.
  useEffect(() => {
    if (paperParticipation === "yes" && papers.length === 0) {
      setPaperOpen(true);
    }
  }, [paperParticipation, papers.length]);

  function openCreate() {
    setEditing(null);
    setWizardOpen(true);
  }

  function openEdit(entry: EntryRow) {
    setEditing(entry);
    setWizardOpen(true);
  }

  const canCreateEntry = !locked && participants.length > 0 && coaches.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <PaperGateDialog open={paperParticipation === "undecided"} />

      {locked && (
        <Alert>
          <Lock />
          <AlertTitle>Submissions are closed</AlertTitle>
          <AlertDescription>
            Your entries are read-only. Contact the division office if you need a change.
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
            <p className="text-sm text-muted-foreground">
              Register everyone first — entries pick from this list.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={paperDeclined}
            onClick={() => setPaperOpen(true)}
          >
            <Newspaper className="size-4" />
            School Paper
            {paperDeclined ? (
              <Badge variant="outline" className="ml-1">
                Not submitting
              </Badge>
            ) : (
              missingPapers.length > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning"
                >
                  {missingPapers.length} to fill
                </Badge>
              )
            )}
          </Button>
        </div>

        {paperDeclined && (
          <Alert>
            <Newspaper />
            <AlertTitle>School Paper closed</AlertTitle>
            <AlertDescription>
              You answered that your school is not submitting a paper. The division
              office can reopen this for you.
            </AlertDescription>
          </Alert>
        )}

        <RosterPanel
          participants={participants}
          coaches={coaches}
          usage={usage}
          locked={locked}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Entries</h2>
            <p className="text-sm text-muted-foreground">
              {canCreateEntry
                ? "Every contest your school is competing in."
                : "Add at least one participant and one coach before creating an entry."}
            </p>
          </div>
          <Button onClick={openCreate} disabled={!canCreateEntry}>
            <Plus className="size-4" />
            Create Entry
          </Button>
        </div>

        <EntriesTable
          entries={entries}
          locked={locked}
          onCreate={openCreate}
          onEdit={openEdit}
        />
      </section>

      <EntryWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        types={types}
        events={events}
        participants={participants}
        coaches={coaches}
        usage={usage}
        entry={editing}
      />

      <SchoolPaperDialog
        open={paperOpen}
        onOpenChange={setPaperOpen}
        papers={papers}
        locked={locked || paperDeclined}
      />
    </div>
  );
}
```

- [ ] **Step 3: Fix `EntriesTable` for roster-shaped rows**

In `app/entry/EntriesTable.tsx`, replace `participantSummary` (lines 37–42) with:

```tsx
function participantSummary(entry: EntryRow): string {
  const [first, ...rest] = entry.participants;
  if (!first) return "—";
  return rest.length > 0 ? `${first.full_name} +${rest.length}` : first.full_name;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors remain **only** in `app/entry/EntryWizard.tsx` (it does not yet accept `participants` / `coaches` / `usage`). Task 10 clears them.

- [ ] **Step 5: Commit**

```bash
git add app/entry/PaperGateDialog.tsx app/entry/EntryDashboard.tsx app/entry/EntriesTable.tsx
git commit -m "feat: gate the school paper form behind an explicit yes/no answer"
```

---

### Task 10: Wizard picks people instead of typing them

**Files:**
- Modify: `app/entry/EntryWizard.tsx:1-235` (state, save, and step 5)

**Interfaces:**
- Consumes: `RosterParticipant`, `RosterCoach` (Task 7); `capReason`, `maxCoachesFor`, `validateEntryCounts`, `type UsageMap` (Task 4); `entrySchema` (Task 5).
- Produces: `EntryWizard` accepting the extra props `participants: RosterParticipant[]`, `coaches: RosterCoach[]`, `usage: UsageMap`. Steps 1–4 are untouched.

- [ ] **Step 1: Replace the imports and drafts**

In `app/entry/EntryWizard.tsx`, replace lines 1–65 (through the `STEP_LABELS` declaration) with:

```tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Trash2, User, Users } from "lucide-react";

import { saveEntryAction } from "./actions";
import {
  languagesFor,
  levelsForType,
  resolveEvent,
  typeLabel,
  typesForCategory,
  type EventRow,
  type EventTypeRow,
} from "./wizard-steps";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";
import { entrySchema } from "@/lib/validation/entry";
import {
  capReason,
  maxCoachesFor,
  validateEntryCounts,
  type UsageMap,
} from "@/lib/roster/limits";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Radix Select forbids an empty item value, so this stands in for "unfilled". */
const UNSET = "__unset__";

const STEP_LABELS = ["Category", "Event", "Level", "Language", "Details"];
```

- [ ] **Step 2: Replace the component state and effects**

Replace the component signature and everything through the `chooseLanguage` function (originally lines 67–185) with:

```tsx
export function EntryWizard({
  open,
  onOpenChange,
  types,
  events,
  participants,
  coaches,
  usage,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: EventTypeRow[];
  events: EventRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  /** When present the wizard edits this entry instead of creating one. */
  entry?: EntryRow | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [level, setLevel] = useState<EventLevel | null>(null);
  const [language, setLanguage] = useState<EventLanguage | null>(null);
  /** One slot per picker row; UNSET means the row is still empty. */
  const [participantIds, setParticipantIds] = useState<string[]>([UNSET]);
  const [coachIds, setCoachIds] = useState<string[]>([UNSET]);
  const [error, setError] = useState<string | null>(null);

  // Reset (or prefill from `entry`) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (entry) {
      const type = types.find((t) => t.id === entry.event_type_id) ?? null;
      setCategory(type?.category ?? null);
      setTypeId(entry.event_type_id);
      setLevel(entry.level);
      setLanguage(entry.language);
      setParticipantIds(entry.participants.map((p) => p.id));
      setCoachIds(entry.coaches.length > 0 ? entry.coaches.map((c) => c.id) : [UNSET]);
      setStep(5);
    } else {
      setCategory(null);
      setTypeId(null);
      setLevel(null);
      setLanguage(null);
      setParticipantIds([UNSET]);
      setCoachIds([UNSET]);
      setStep(1);
    }
  }, [open, entry, types]);

  const availableTypes = useMemo(
    () => (category ? typesForCategory(types, category) : []),
    [types, category]
  );
  const availableLevels = useMemo(
    () => (typeId ? levelsForType(events, typeId) : []),
    [events, typeId]
  );
  const availableLanguages = useMemo(
    () => (typeId && level ? languagesFor(events, typeId, level) : []),
    [events, typeId, level]
  );
  const selectedType = types.find((t) => t.id === typeId) ?? null;
  const resolved =
    typeId && level && language ? resolveEvent(events, typeId, level, language) : undefined;

  const effectiveCategory: EventCategory = selectedType?.category ?? category ?? "individual";
  const minParticipants = selectedType?.min_participants ?? 1;
  const maxParticipants = selectedType?.max_participants ?? null;

  /** Ids this entry already holds, so a person cannot be picked into two rows. */
  const chosenParticipants = participantIds.filter((id) => id !== UNSET);
  const chosenCoaches = coachIds.filter((id) => id !== UNSET);
  const maxCoaches = maxCoachesFor(effectiveCategory, Math.max(chosenParticipants.length, 1));

  function chooseCategory(next: EventCategory) {
    setCategory(next);
    setTypeId(null);
    setLevel(null);
    setLanguage(null);
    setStep(2);
  }

  function chooseType(nextTypeId: string) {
    setTypeId(nextTypeId);
    setLanguage(null);
    const levels = levelsForType(events, nextTypeId);
    if (levels.length === 1) {
      // Secondary-only contests (MOJO, Online Publishing, both TV events) have
      // no real choice here — skip step 3 rather than showing a dead option.
      setLevel(levels[0]);
      setStep(4);
    } else {
      setLevel(null);
      setStep(3);
    }
  }

  function chooseLevel(next: EventLevel) {
    setLevel(next);
    setStep(4);
  }

  function chooseLanguage(next: EventLanguage) {
    setLanguage(next);
    // Open with exactly the rows the contest requires — a 7-member group event
    // should not make the user press Add six times.
    const required = types.find((t) => t.id === typeId)?.min_participants ?? 1;
    setParticipantIds((prev) => {
      const filled = prev.filter((id) => id !== UNSET);
      const rows = [...filled];
      while (rows.length < required) rows.push(UNSET);
      return rows.length === 0 ? [UNSET] : rows;
    });
    setStep(5);
  }
```

- [ ] **Step 3: Replace `handleSave`**

Replace `handleSave` (originally lines 199–234) with:

```tsx
  function handleSave() {
    setError(null);
    if (!resolved) {
      setError("Pick an event before saving.");
      return;
    }

    const input = {
      eventId: resolved.id,
      participantIds: chosenParticipants,
      coachIds: chosenCoaches,
    };

    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    const countError = validateEntryCounts({
      category: effectiveCategory,
      participantIds: chosenParticipants,
      coachIds: chosenCoaches,
      minParticipants,
      maxParticipants,
    });
    if (countError) {
      setError(countError);
      return;
    }

    startTransition(async () => {
      const result = await saveEntryAction(entry?.id ?? null, input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(entry ? "Entry updated." : "Entry added.");
      onOpenChange(false);
      router.refresh();
    });
  }
```

- [ ] **Step 4: Replace step 5's markup**

Replace the whole `{step === 5 && ( … )}` block (originally lines 320–495) with:

```tsx
        {step === 5 && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{resolved?.name ?? "—"}</span>
              <span className="text-muted-foreground">
                · {level === "secondary" ? "Secondary" : "Elementary"} ·{" "}
                {language === "filipino" ? "Filipino" : "English"}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setStep(1)}
              >
                Change event
              </Button>
            </div>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Participants{" "}
                  <span className="font-normal text-muted-foreground">
                    ({maxParticipants === null
                      ? `at least ${minParticipants}`
                      : minParticipants === maxParticipants
                        ? `exactly ${minParticipants}`
                        : `${minParticipants}–${maxParticipants}`}
                    )
                  </span>
                </h3>
                {(maxParticipants === null || participantIds.length < maxParticipants) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setParticipantIds((prev) => [...prev, UNSET])}
                  >
                    <Plus className="size-4" />
                    Add participant
                  </Button>
                )}
              </div>

              {participantIds.map((selected, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`participant-slot-${i}`}>
                    Participant {i + 1}
                  </Label>
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      setParticipantIds((prev) =>
                        prev.map((row, idx) => (idx === i ? value : row))
                      )
                    }
                  >
                    <SelectTrigger id={`participant-slot-${i}`} className="w-full">
                      <SelectValue placeholder={`Select participant ${i + 1}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Select participant {i + 1}</SelectItem>
                      {participants.map((participant) => {
                        const alreadyHere =
                          participant.id !== selected &&
                          chosenParticipants.includes(participant.id);
                        // Editing an entry must not count that entry against its
                        // own members, so anyone already on it stays selectable.
                        const onThisEntry = Boolean(
                          entry?.participants.some((p) => p.id === participant.id)
                        );
                        const reason = onThisEntry
                          ? null
                          : capReason(usage[participant.id], effectiveCategory);
                        const disabled = alreadyHere || reason !== null;
                        return (
                          <SelectItem
                            key={participant.id}
                            value={participant.id}
                            disabled={disabled}
                          >
                            {participant.number_label} · {participant.full_name}
                            {reason ? ` — ${reason}` : alreadyHere ? " — already added" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {participantIds.length > minParticipants && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove participant ${i + 1}`}
                      onClick={() =>
                        setParticipantIds((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </section>

            <Separator />

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Coaches{" "}
                  <span className="font-normal text-muted-foreground">
                    (1{maxCoaches > 1 ? `–${maxCoaches}` : ""})
                  </span>
                </h3>
                {coachIds.length < maxCoaches && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCoachIds((prev) => [...prev, UNSET])}
                  >
                    <Plus className="size-4" />
                    Add coach
                  </Button>
                )}
              </div>

              {coachIds.map((selected, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`coach-slot-${i}`}>
                    Coach {i + 1}
                  </Label>
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      setCoachIds((prev) => prev.map((row, idx) => (idx === i ? value : row)))
                    }
                  >
                    <SelectTrigger id={`coach-slot-${i}`} className="w-full">
                      <SelectValue placeholder={`Select coach ${i + 1}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Select coach {i + 1}</SelectItem>
                      {coaches.map((coach) => {
                        const alreadyHere =
                          coach.id !== selected && chosenCoaches.includes(coach.id);
                        return (
                          <SelectItem key={coach.id} value={coach.id} disabled={alreadyHere}>
                            {coach.full_name}
                            {alreadyHere ? " — already added" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {coachIds.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove coach ${i + 1}`}
                      onClick={() => setCoachIds((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
```

- [ ] **Step 5: Delete the now-unused helpers**

Remove the `Field` and `GenderPicker` function declarations at the bottom of the file (originally lines 598–640) and the `ParticipantDraft` / `CoachDraft` interfaces plus `emptyParticipant` / `emptyCoach` factories if any remnant survived Step 1. `StepIndicator`, `ChoiceGrid`, and `ChoiceCard` stay.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean, zero errors across the repo.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 8: Verify in the running app**

Run: `npm run dev`, sign in as a seeded school, then check in the browser:
1. The paper gate dialog appears and cannot be dismissed with Escape.
2. Answering **No** greys out the School Paper button and shows "Not submitting".
3. Add three participants — their numbers are consecutive and 4-digit.
4. Create two individual entries using participant 0001, then start a third: 0001 is greyed out with "Already in 2 individual events".
5. Pick Radio Broadcasting (Regular): the form opens with 7 participant slots and saving with 6 shows "This event requires at least 7 participants".
6. On a 1-participant individual entry, the "Add coach" button is absent; add a second participant and it appears.

- [ ] **Step 9: Commit**

```bash
git add app/entry/EntryWizard.tsx
git commit -m "feat: pick entry participants and coaches from the roster"
```

---

### Task 11: Export carries participant numbers

**Files:**
- Modify: `lib/export/entries-workbook.ts`
- Modify: `lib/export/entries-workbook.test.ts`
- Modify: `app/admin/export/route.ts:16-103`

**Interfaces:**
- Consumes: `formatParticipantNumber` (Task 4); the `entry_participants → participants` join shape (Task 1).
- Produces: `ExportEntry["participants"][number]` gains `participantNumber: number`; `ExportRow` gains a leading `"No."` column.

- [ ] **Step 1: Write the failing test**

Append to `lib/export/entries-workbook.test.ts`:

```ts
describe("participant numbers", () => {
  it("puts the zero-padded number in its own leading column", () => {
    const rows = toExportRows([
      {
        schoolName: "Bagumbayan ES",
        districtName: "District I",
        eventName: "News Writing",
        category: "individual",
        level: "elementary",
        language: "english",
        submittedAt: null,
        participants: [
          {
            participantNumber: 7,
            firstName: "Ana",
            middleName: null,
            lastName: "Dela Cruz",
            gender: "F",
          },
        ],
        coaches: [{ fullName: "Mr. Reyes", gender: "M" }],
      },
    ]);
    expect(rows[0]["No."]).toBe("0007");
    expect(rows[0].Participant).toBe("Dela Cruz, Ana");
  });
});
```

If the file's existing fixtures build `ExportEntry` objects without `participantNumber`, add `participantNumber: 1` to each of them so the file compiles.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/export/entries-workbook.test.ts`
Expected: FAIL — `expected undefined to be "0007"`.

- [ ] **Step 3: Update the workbook builder**

In `lib/export/entries-workbook.ts`:

Import the formatter at the top:

```ts
import { formatParticipantNumber } from "@/lib/roster/limits";
```

Add the field to the participant shape inside `ExportEntry`:

```ts
  participants: {
    participantNumber: number;
    firstName: string;
    middleName: string | null;
    lastName: string;
    gender: "M" | "F";
  }[];
```

Add the column to `ExportRow`, as the first key:

```ts
export interface ExportRow {
  "No.": string;
  School: string;
  District: string;
  Event: string;
  Category: string;
  Level: string;
  Language: string;
  Participant: string;
  Gender: string;
  Coaches: string;
  Submitted: string;
}
```

In `toExportRows`, the empty-participants branch becomes:

```ts
    if (entry.participants.length === 0) {
      rows.push({ ...base, "No.": "", Participant: "", Gender: "" });
      continue;
    }

    for (const participant of entry.participants) {
      rows.push({
        ...base,
        "No.": formatParticipantNumber(participant.participantNumber),
        Participant: fullName(participant),
        Gender: participant.gender,
      });
    }
```

In `buildEntriesWorkbook`, put `"No."` first in the `header` array and prepend `8` to the `!cols` width array:

```ts
    header: [
      "No.",
      "School",
      "District",
      "Event",
      "Category",
      "Level",
      "Language",
      "Participant",
      "Gender",
      "Coaches",
      "Submitted",
    ],
  });
  sheet["!cols"] = [8, 32, 22, 34, 12, 12, 10, 30, 8, 34, 20].map((wch) => ({ wch }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/export/entries-workbook.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the export route to read the join**

In `app/admin/export/route.ts`, replace the `EntryRow` interface (lines 16–33) with:

```ts
interface EntryRow {
  id: string;
  submitted_at: string | null;
  schools: { name: string; district_id: string; districts: { name: string } | null } | null;
  events: {
    name: string;
    category: "individual" | "group";
    level: EventLevel;
    language: EventLanguage;
  } | null;
  entry_participants: {
    participants: {
      participant_number: number;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      gender: "M" | "F";
    } | null;
  }[];
  entry_coaches: { coaches: { full_name: string; gender: "M" | "F" } | null }[];
}
```

Replace the `.select(...)` string (line 60) with:

```ts
      "id, submitted_at, schools(name, district_id, districts(name)), events(name, category, level, language), entry_participants(participants(participant_number, first_name, middle_name, last_name, gender)), entry_coaches(coaches(full_name, gender))"
```

Replace the `participants` and `coaches` mapping inside `exportEntries` (lines 96–102) with:

```ts
    participants: entry.entry_participants
      .map((link) => link.participants)
      .filter((p) => p !== null)
      .map((p) => ({
        participantNumber: p.participant_number,
        firstName: p.first_name,
        middleName: p.middle_name,
        lastName: p.last_name,
        gender: p.gender,
      })),
    coaches: entry.entry_coaches
      .map((link) => link.coaches)
      .filter((c) => c !== null)
      .map((c) => ({ fullName: c.full_name, gender: c.gender })),
```

- [ ] **Step 6: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/export/entries-workbook.ts lib/export/entries-workbook.test.ts app/admin/export/route.ts
git commit -m "feat: carry participant numbers into the Excel export"
```

---

### Task 12: Admin participants view

**Files:**
- Create: `lib/roster/admin-rows.ts`
- Test: `lib/roster/admin-rows.test.ts`
- Create: `app/admin/participants/page.tsx`
- Create: `app/admin/participants/ParticipantFilterBar.tsx`
- Create: `app/admin/participants/ResetPaperButton.tsx`
- Create: `app/admin/participants/actions.ts`
- Modify: `app/admin/page.tsx:115-127` (add a link to the new page)

**Interfaces:**
- Consumes: `formatParticipantNumber` (Task 4); the `participants` table and `admin_reset_paper_participation` RPC (Task 1).
- Produces:
  - `interface AdminParticipantRow { id: string; numberLabel: string; displayNumber: string; fullName: string; gender: "M" | "F"; schoolId: string; schoolName: string; districtId: string; districtName: string; eventCount: number; isMultiEvent: boolean; paperParticipation: string }`
  - `toAdminParticipantRows(raw: RawAdminParticipant[]): AdminParticipantRow[]`
  - `resetPaperParticipationAction(schoolId: string): Promise<{ error: string } | { success: true }>`

- [ ] **Step 1: Write the failing test**

Create `lib/roster/admin-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toAdminParticipantRows, type RawAdminParticipant } from "./admin-rows";

const raw = (overrides: Partial<RawAdminParticipant> = {}): RawAdminParticipant => ({
  id: "p1",
  participant_number: 7,
  first_name: "Ana",
  middle_name: null,
  last_name: "Dela Cruz",
  gender: "F",
  schools: {
    id: "s1",
    name: "Bagumbayan ES",
    district_id: "d1",
    paper_participation: "yes",
    districts: { name: "District I" },
  },
  entry_participants: [{ entry_id: "e1" }],
  ...overrides,
});

describe("toAdminParticipantRows", () => {
  it("pads the number and builds a surname-first name", () => {
    const [row] = toAdminParticipantRows([raw()]);
    expect(row.numberLabel).toBe("0007");
    expect(row.fullName).toBe("Dela Cruz, Ana");
  });

  it("leaves a single-event participant unmarked", () => {
    const [row] = toAdminParticipantRows([raw()]);
    expect(row.isMultiEvent).toBe(false);
    expect(row.displayNumber).toBe("0007");
    expect(row.eventCount).toBe(1);
  });

  it("asterisks a participant in more than one event", () => {
    const [row] = toAdminParticipantRows([
      raw({ entry_participants: [{ entry_id: "e1" }, { entry_id: "e2" }] }),
    ]);
    expect(row.isMultiEvent).toBe(true);
    expect(row.displayNumber).toBe("*0007");
    expect(row.eventCount).toBe(2);
  });

  it("keeps a participant with no entries at zero", () => {
    const [row] = toAdminParticipantRows([raw({ entry_participants: [] })]);
    expect(row.eventCount).toBe(0);
    expect(row.isMultiEvent).toBe(false);
  });

  it("includes the middle name when present", () => {
    const [row] = toAdminParticipantRows([raw({ middle_name: "Mercado" })]);
    expect(row.fullName).toBe("Dela Cruz, Ana Mercado");
  });

  it("sorts by participant number", () => {
    const rows = toAdminParticipantRows([
      raw({ id: "b", participant_number: 12 }),
      raw({ id: "a", participant_number: 3 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/roster/admin-rows.test.ts`
Expected: FAIL — `Failed to resolve import "./admin-rows"`.

- [ ] **Step 3: Write the row builder**

Create `lib/roster/admin-rows.ts`:

```ts
import { formatParticipantNumber } from "./limits";

/** A `participants` row joined to its school and entry links, as fetched by /admin/participants. */
export interface RawAdminParticipant {
  id: string;
  participant_number: number;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  schools: {
    id: string;
    name: string;
    district_id: string;
    paper_participation: string;
    districts: { name: string } | null;
  } | null;
  entry_participants: { entry_id: string }[];
}

export interface AdminParticipantRow {
  id: string;
  numberLabel: string;
  /** Asterisked when the participant sits in more than one event. */
  displayNumber: string;
  fullName: string;
  gender: "M" | "F";
  schoolId: string;
  schoolName: string;
  districtId: string;
  districtName: string;
  eventCount: number;
  isMultiEvent: boolean;
  paperParticipation: string;
}

export function toAdminParticipantRows(raw: RawAdminParticipant[]): AdminParticipantRow[] {
  return raw
    .map((row) => {
      const eventCount = row.entry_participants.length;
      const isMultiEvent = eventCount > 1;
      const numberLabel = formatParticipantNumber(row.participant_number);
      const given = [row.first_name, row.middle_name].filter(Boolean).join(" ");
      return {
        id: row.id,
        numberLabel,
        displayNumber: isMultiEvent ? `*${numberLabel}` : numberLabel,
        fullName: [row.last_name, given].filter(Boolean).join(", "),
        gender: row.gender,
        schoolId: row.schools?.id ?? "",
        schoolName: row.schools?.name ?? "",
        districtId: row.schools?.district_id ?? "",
        districtName: row.schools?.districts?.name ?? "",
        eventCount,
        isMultiEvent,
        paperParticipation: row.schools?.paper_participation ?? "undecided",
      };
    })
    .sort((a, b) => a.numberLabel.localeCompare(b.numberLabel));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/roster/admin-rows.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Write the admin action**

Create `app/admin/participants/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function resetPaperParticipationAction(
  schoolId: string
): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  // The RPC re-checks admin_profiles itself; this is a route-handler-style
  // guard so a non-admin gets a clean message instead of a raw RPC error.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("admin_reset_paper_participation", {
    target_school: schoolId,
  });
  if (error) return { error: "Could not reset that school's answer." };

  revalidatePath("/admin/participants");
  revalidatePath("/entry");
  return { success: true as const };
}
```

- [ ] **Step 6: Write the filter bar**

Create `app/admin/participants/ParticipantFilterBar.tsx`:

```tsx
"use client";

import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  id: string;
  name: string;
}

/** Radix Select forbids an empty item value, so "any" stands in for "no filter". */
const ANY = "__any__";

export function ParticipantFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const districtId = useId();
  const schoolId = useId();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/participants?${qs}` : "/admin/participants");
  }

  const multiOnly = searchParams.get("multi") === "1";
  const activeCount = ["district", "school", "multi"].filter((k) => searchParams.get(k)).length;

  return (
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={districtId} className="text-xs text-muted-foreground">
            District
          </Label>
          <Select
            value={searchParams.get("district") ?? ANY}
            onValueChange={(v) => setParam("district", v)}
          >
            <SelectTrigger id={districtId} className="w-full">
              <SelectValue placeholder="All districts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All districts</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={schoolId} className="text-xs text-muted-foreground">
            School
          </Label>
          <Select
            value={searchParams.get("school") ?? ANY}
            onValueChange={(v) => setParam("school", v)}
          >
            <SelectTrigger id={schoolId} className="w-full">
              <SelectValue placeholder="All schools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All schools</SelectItem>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            onClick={() => setParam("multi", multiOnly ? null : "1")}
          >
            <Asterisk className="size-4" />
            Multi-event only
          </Button>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/admin/participants")}
            >
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Write the page**

Create `app/admin/participants/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { adminSignOutAction } from "../actions";
import { ParticipantFilterBar } from "./ParticipantFilterBar";
import { ResetPaperButton } from "./ResetPaperButton";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminParticipantRows,
  type RawAdminParticipant,
} from "@/lib/roster/admin-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface SearchParams {
  district?: string;
  school?: string;
  multi?: string;
}

export default async function AdminParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .single();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login");
  }

  const [{ data: districts }, { data: schools }, { data: raw }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name, district_id").order("name"),
    supabase
      .from("participants")
      .select(
        "id, participant_number, first_name, middle_name, last_name, gender, schools(id, name, district_id, paper_participation, districts(name)), entry_participants(entry_id)"
      )
      .order("participant_number")
      .overrideTypes<RawAdminParticipant[]>(),
  ]);

  let rows = toAdminParticipantRows(raw ?? []);
  if (params.district) rows = rows.filter((r) => r.districtId === params.district);
  if (params.school) rows = rows.filter((r) => r.schoolId === params.school);
  if (params.multi === "1") rows = rows.filter((r) => r.isMultiEvent);

  const multiCount = rows.filter((r) => r.isMultiEvent).length;

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

          <ParticipantFilterBar districts={districts ?? []} schools={schools ?? []} />

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">No.</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead className="w-20">Gender</TableHead>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="w-20">Events</TableHead>
                  <TableHead className="w-44">School paper</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(row.isMultiEvent && "bg-accent/40")}>
                    <TableCell className="font-mono tabular-nums">
                      {row.displayNumber}
                    </TableCell>
                    <TableCell className="font-medium">{row.fullName}</TableCell>
                    <TableCell>{row.gender}</TableCell>
                    <TableCell>{row.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.eventCount}
                      {row.isMultiEvent && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          Multi
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.paperParticipation === "no" ? (
                        <ResetPaperButton schoolId={row.schoolId} schoolName={row.schoolName} />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {row.paperParticipation === "yes" ? "Submitting" : "Not answered"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No participants match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Write the reset button**

Create `app/admin/participants/ResetPaperButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";

import { resetPaperParticipationAction } from "./actions";
import { Button } from "@/components/ui/button";

export function ResetPaperButton({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleReset() {
    startTransition(async () => {
      const result = await resetPaperParticipationAction(schoolId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${schoolName} will be asked again.`);
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleReset}>
      {isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
      Reset answer
    </Button>
  );
}
```

Add the import to `app/admin/participants/page.tsx` — it is already listed in Step 7's import block.

- [ ] **Step 9: Link the page from the admin dashboard**

In `app/admin/page.tsx`, replace the `<LockToggle locked={locked} />` line (line 126) with:

```tsx
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/participants">
                  <Users className="size-4" />
                  Participants
                </Link>
              </Button>
              <LockToggle locked={locked} />
            </div>
```

Add `import Link from "next/link";` below the existing `import { redirect } from "next/navigation";`, and add `import { Button } from "@/components/ui/button";` next to the other `@/components/ui` imports. `Users` is already imported from `lucide-react` on line 2.

- [ ] **Step 10: Typecheck, lint, and test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all three clean.

- [ ] **Step 11: Verify in the running app**

Run: `npm run dev`, sign in at `/admin/login`, then:
1. Click **Participants** in the header row — the roster lists every school's contestants.
2. A participant in two events shows `*0007`, a tinted row, and a **Multi** badge.
3. Toggling **Multi-event only** narrows the list to exactly those rows.
4. A school that answered No shows **Reset answer**; clicking it and reloading that school's `/entry` re-shows the gate dialog.

- [ ] **Step 12: Commit**

```bash
git add lib/roster/admin-rows.ts lib/roster/admin-rows.test.ts app/admin/participants app/admin/page.tsx
git commit -m "feat: add the admin participants view with multi-event highlighting"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §2 Paper gate (dialog, Yes → form, No → locked) | 6 (action), 9 (dialog + dashboard) |
| §2 Admin reset to `undecided` | 1 (RPC), 12 (button) |
| §3 `participants` table + division-wide 4-digit numbers | 1, 4 (`formatParticipantNumber`), 8 (UI) |
| §3 `coaches` table | 1, 8 |
| §4 Entries reference roster ids; backfill | 1 (migration), 5 (schema), 6 (action), 7 (loading), 10 (wizard) |
| §5 Caps (2 individual, 1 group), disabled options, edit exclusion | 4 (`capReason`), 6 (server enforcement), 10 (disabled `SelectItem`s) |
| §6 Per-event min/max, individual 1–3 with Add button | 2 (catalog), 1 (columns), 10 (slots + Add) |
| §6 Coach limits derived from participant count | 4 (`maxCoachesFor`), 10 (Add-coach visibility) |
| §7 Admin participants list, asterisk, multi-event filter | 12 |
| Export keeps working with the new joins | 11 |

No gaps.

**Placeholder scan** — every code step carries complete code; no "TBD", no "handle edge cases", no "similar to Task N".

**Type consistency** — `RosterParticipant` / `RosterCoach` (Task 7) are the only participant and coach shapes used by Tasks 8, 9, and 10. `UsageMap` and `ParticipantUsage` (Task 4) are used identically in Tasks 6, 7, 8, 9, and 10. `validateEntryCounts` takes the same five-key object in Tasks 6 and 10. `entrySchema`'s `{ eventId, participantIds, coachIds }` (Task 5) is what Task 10 builds and Task 6 parses. `EventTypeRow` gains `min_participants` / `max_participants` in Task 7 Step 4, which Task 10 reads.
