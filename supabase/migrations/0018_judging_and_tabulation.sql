-- Judging and tabulation — the tables a panel, a sheet and a rank live in.
--
-- Implements section 3 of docs/superpowers/specs/2026-08-21-judging-and-tabulation-design.md
-- with one deliberate omission: **none of the 13 RPCs are here.** The judges and
-- tabulators admin pages only read, and until the judge portal and the admin
-- actions are built there is nothing to call them. Shipping a security-definer
-- function before the code that uses it means shipping an attack surface with no
-- test exercising it, so they land with their callers instead.
--
-- The consequence, stated plainly: there are no write policies and no write
-- functions below, so **nothing can put a row in these tables yet**. That is
-- intended. The pages stop claiming a table is absent and start reporting a
-- genuinely empty one, which is a different and true statement.
--
-- WHAT THIS DOES NOT TOUCH: schools, participants, coaches, entry_participants,
-- entry_coaches, school_papers, school_papers_archive, districts, app_settings,
-- admin_profiles, event_types. No statement below writes to any of them. The two
-- existing tables that change — `events` and `entries` — gain one column each and
-- lose nothing; every existing row keeps every value it has today.
--
-- Safe to re-run: every statement is guarded.

-- 1. The per-event round 2 cut.
--
-- Per event, not one division-wide setting: the division agreed a default of 10
-- but a 4-entry event cannot cut to 10 and a 40-entry event may want to. Stored
-- with the event because that is the thing it is a property of.
--
-- The default is 10 and NOT NULL, so from here on every event has a real cut. The
-- pages have until now refused to print 10 for want of this column — showing the
-- default would have invented a decision nobody made. Once this migration runs
-- the 10 is a fact about the row, and printing it is reporting, not inventing.
alter table events add column if not exists round2_cut int not null default 10;

alter table events drop constraint if exists events_round2_cut_check;
alter table events add constraint events_round2_cut_check check (round2_cut >= 1);

comment on column events.round2_cut is
  'How many units advance to round 2. Default 10, per event, at least 1. Ties at the line all advance, so the qualifier list can be longer than this number.';

-- 2. An anonymous, stable code for a team entry.
--
-- A judge must never see a school. For an individual event the contestant already
-- carries `participants.participant_number`, but a group event's unit is the entry
-- itself and `entries` has no number — only a uuid, which is unreadable on paper,
-- and `school_id`, which is the one thing that must not reach a judge.
--
-- Four digits to match `formatContestCode` in lib/judging/codes.ts, which pads to
-- 4 because an individual contestant's badge reads `0042` and the same contestant
-- must not appear on a judge's sheet as `42`. maxvalue 9999 is that same limit
-- spelled in the sequence: a 10,000th entry should fail loudly here rather than
-- quietly produce a 5-digit code the paper forms cannot hold.
create sequence if not exists entry_number_seq start with 1 minvalue 1 maxvalue 9999;

-- Added nullable and backfilled in order, rather than the one-line
-- `add column ... default nextval(...)` the contract sketches. A volatile default
-- is evaluated per row when the column is added, which does number every existing
-- row — but in whatever order the rows physically sit in the heap. The numbers
-- would be arbitrary, and entry 0001 would not be the first entry filed. Ordering
-- the backfill by `submitted_at` makes the code mean something to a human reading
-- a printed sheet.
alter table entries add column if not exists entry_number int;

-- `id` breaks ties so the numbering is deterministic: two entries can share a
-- submitted_at, and without a tiebreak a re-run could number them differently.
--
-- This UPDATE passes the `entries_locked_guard` trigger. That trigger calls
-- public.reject_locked_submission, which raises only where the school's
-- `auth_user_id = auth.uid()`; a migration carries no JWT, so auth.uid() is null
-- and the comparison is never true. Verified against the deployed function, not
-- assumed.
update entries e
   set entry_number = s.n
  from (
    select id, row_number() over (order by submitted_at, id) as n
      from entries
     where entry_number is null
  ) s
 where e.id = s.id
   and e.entry_number is null;

-- Move the sequence past what the backfill used, so the first inserted entry does
-- not collide with a backfilled one. `false` means "this value is next", not
-- "this value is used".
select setval('entry_number_seq', coalesce((select max(entry_number) from entries), 0) + 1, false);

alter table entries alter column entry_number set default nextval('entry_number_seq');
alter table entries alter column entry_number set not null;

alter table entries drop constraint if exists entries_entry_number_key;
alter table entries add constraint entries_entry_number_key unique (entry_number);

comment on column entries.entry_number is
  'Anonymous 4-digit team code, shown to judges for group events. Seeded in submitted_at order; never reused. A judge must never be shown school_id.';

-- 3. The judges.
--
-- Name parts, not a full_name, matching `coaches` after 0015: the division sorts
-- by last name and addresses letters by first name, and splitting a joined string
-- back apart is guesswork with middle names in it.
--
-- `auth_user_id` is nullable so the division can enter a judge before that judge
-- has an account — the panel is drawn up in a meeting, the logins are made later.
-- It is unique so two judge rows cannot claim one login.
--
-- `is_active` rather than deleting: a judge who withdraws after ranking must keep
-- their submitted sheets, because a rank-sum computed from four judges cannot be
-- recomputed from three without changing every placement.
create table if not exists judges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text,
  affiliation text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table judges is
  'People who rank entries. Inactive rather than deleted, because a withdrawn judge''s submitted sheets still count toward every placement they produced.';

-- 4. Which judge sits on which event's panel.
--
-- `seat` numbers the panel so a printed sheet can say "Judge 2" without naming
-- anyone. Unique per event, so two judges cannot both be seat 2, and unique per
-- (judge, event) so one judge cannot be seated twice on the same panel and have
-- their ranks counted double.
create table if not exists judge_assignments (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  seat int not null check (seat >= 1),
  created_at timestamptz not null default now(),
  unique (judge_id, event_id),
  unique (event_id, seat)
);

comment on table judge_assignments is
  'A seat on an event''s panel. Seat numbers let a sheet identify a judge without naming one.';

-- 5. One judge's sheet for one round of one event.
--
-- `submitted_at` null means open, set means locked — submitting *is* locking, per
-- the division's "once naka rank, i-lock". One boolean fewer than a separate
-- `locked` flag, and it cannot disagree with itself.
create table if not exists judge_sheets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  judge_id uuid not null references judges(id) on delete cascade,
  round int not null check (round in (1, 2)),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (event_id, judge_id, round)
);

comment on column judge_sheets.submitted_at is
  'Null = open, set = locked. Submitting is locking; there is no separate flag to contradict.';

-- 6. The ranks on a sheet.
--
-- `participant_id` is null for a group event, where the team is the unit; it is set
-- for an individual event, where each of a school's up to three contestants is
-- ranked separately. `entry_id` alone cannot key this — it would collapse three
-- placements into one.
create table if not exists judge_ranks (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references judge_sheets(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  rank int not null check (rank >= 1)
);

-- One rank per unit per sheet. Postgres treats NULLs as distinct in a unique
-- constraint, so a plain `unique (sheet_id, entry_id, participant_id)` would let a
-- group entry be ranked twice on one sheet. The coalesce to a zero uuid closes
-- that: a null participant becomes one concrete value that collides with itself.
create unique index if not exists judge_ranks_unit_key on judge_ranks
  (sheet_id, entry_id, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- And no two units share a place on one sheet. A rank-sum only means anything if
-- each judge produced a strict order — two 3rd places and no 4th would make one
-- event's totals incomparable with every other event's.
create unique index if not exists judge_ranks_place_key on judge_ranks (sheet_id, rank);

comment on table judge_ranks is
  'One judge''s placement of one unit. Unique per unit per sheet, and no two units share a place.';

-- 7. Who advanced, decided once, in writing.
--
-- Materialised rather than derived on every read for two reasons. The qualifier
-- rule lives in one place — lib/judging, TypeScript — instead of being
-- re-implemented in SQL for the judge portal and drifting from it. And the judge
-- portal can be handed the qualifier codes without also being handed the round-1
-- standings, which would tell a judge who is currently winning before they rank
-- round 2.
--
-- `round1_points` and `round1_rank` are kept because they are the working that
-- produced the decision. A disputed placement is answerable from this table alone.
create table if not exists round2_qualifiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  round1_points int not null,
  round1_rank int not null,
  created_at timestamptz not null default now()
);

create unique index if not exists round2_qualifiers_unit_key on round2_qualifiers
  (event_id, entry_id, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table round2_qualifiers is
  'The units that advanced, with the points and rank that advanced them. Written once when round 1 closes.';

-- 8. When round 1 closed, and the cut that was in force when it did.
--
-- `round2_cut_used` is a copy, not a reference to events.round2_cut, and that
-- duplication is the point: if the cut is ever changed afterwards, this row still
-- says which number produced the qualifier list above it.
--
-- `standings` freezes the official result at lock. An entry withdrawn or deleted
-- after the results are published must not silently renumber a placement that has
-- already been read out.
create table if not exists event_rounds (
  event_id uuid primary key references events(id) on delete cascade,
  round1_closed_at timestamptz,
  round1_closed_by uuid references auth.users(id),
  round2_cut_used int,
  results_locked_at timestamptz,
  results_locked_by uuid references auth.users(id),
  standings jsonb
);

comment on column event_rounds.round2_cut_used is
  'The cut in force when round 1 closed. Deliberately a copy of events.round2_cut, so a later change to the cut cannot rewrite history.';

comment on column event_rounds.standings is
  'The official placements, frozen at results lock, so a later roster change cannot renumber a published result.';

-- 9. Row level security.
--
-- Every table gets RLS with no permissive fallback. Read policies only: there is
-- deliberately **no insert, update or delete policy on any table below**. Once the
-- RPCs land, every write goes through one of them, so validation cannot be
-- sidestepped by a client that talks to the table directly. Until then these
-- tables are readable and empty, which is exactly what the admin pages need.
--
-- Two shapes of reader. An admin sees everything. A judge sees only their own
-- rows, and only for events they are seated on — a judge must not be able to
-- learn who else is judging, or what another judge ranked.
alter table judges enable row level security;
alter table judge_assignments enable row level security;
alter table judge_sheets enable row level security;
alter table judge_ranks enable row level security;
alter table round2_qualifiers enable row level security;
alter table event_rounds enable row level security;

drop policy if exists judges_admin_select on judges;
create policy judges_admin_select on judges for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists judges_self_select on judges;
create policy judges_self_select on judges for select
  using (auth_user_id = auth.uid());

drop policy if exists judge_assignments_admin_select on judge_assignments;
create policy judge_assignments_admin_select on judge_assignments for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists judge_assignments_self_select on judge_assignments;
create policy judge_assignments_self_select on judge_assignments for select
  using (exists (
    select 1 from judges j
     where j.id = judge_assignments.judge_id
       and j.auth_user_id = auth.uid()
  ));

drop policy if exists judge_sheets_admin_select on judge_sheets;
create policy judge_sheets_admin_select on judge_sheets for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists judge_sheets_self_select on judge_sheets;
create policy judge_sheets_self_select on judge_sheets for select
  using (exists (
    select 1 from judges j
     where j.id = judge_sheets.judge_id
       and j.auth_user_id = auth.uid()
  ));

-- A rank belongs to a judge only through its sheet, so the ownership test walks
-- both hops. Without this join a judge could read every rank on the event.
drop policy if exists judge_ranks_admin_select on judge_ranks;
create policy judge_ranks_admin_select on judge_ranks for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists judge_ranks_self_select on judge_ranks;
create policy judge_ranks_self_select on judge_ranks for select
  using (exists (
    select 1
      from judge_sheets s
      join judges j on j.id = s.judge_id
     where s.id = judge_ranks.sheet_id
       and j.auth_user_id = auth.uid()
  ));

-- Qualifiers and round state are scoped to the events a judge is seated on, not to
-- a judge id, because these rows belong to the event rather than to any one judge.
--
-- Note what a judge can still not do with this: both tables carry
-- `participant_id`, and a judge has no select on `participants`, so the id joins to
-- nothing. Codes reach a judge only through `judge_round2_units`, which arrives
-- with the RPCs. Reading a raw uuid here tells a judge which unit advanced, never
-- who it is.
drop policy if exists round2_qualifiers_admin_select on round2_qualifiers;
create policy round2_qualifiers_admin_select on round2_qualifiers for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists round2_qualifiers_judge_select on round2_qualifiers;
create policy round2_qualifiers_judge_select on round2_qualifiers for select
  using (exists (
    select 1
      from judge_assignments a
      join judges j on j.id = a.judge_id
     where a.event_id = round2_qualifiers.event_id
       and j.auth_user_id = auth.uid()
       and j.is_active
  ));

drop policy if exists event_rounds_admin_select on event_rounds;
create policy event_rounds_admin_select on event_rounds for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists event_rounds_judge_select on event_rounds;
create policy event_rounds_judge_select on event_rounds for select
  using (exists (
    select 1
      from judge_assignments a
      join judges j on j.id = a.judge_id
     where a.event_id = event_rounds.event_id
       and j.auth_user_id = auth.uid()
       and j.is_active
  ));

-- 10. Grants.
--
-- RLS sits on top of table grants, so a policy alone is not enough — without a
-- grant the admin pages get "permission denied for table judges" no matter how
-- permissive the policy is. Select only, and only to `authenticated`: `anon` is
-- never a judge and never an admin, and neither role gets a write grant here.
grant select on judges to authenticated;
grant select on judge_assignments to authenticated;
grant select on judge_sheets to authenticated;
grant select on judge_ranks to authenticated;
grant select on round2_qualifiers to authenticated;
grant select on event_rounds to authenticated;

-- Supabase's default privileges grant every table in `public` to `anon` and
-- `authenticated`, insert and update and delete included. RLS already refuses those
-- writes, because a policy that does not exist permits nothing — but a future
-- permissive policy added in haste would then be the only thing standing between a
-- browser and a judge's rank. Revoking the grant makes "no client writes" true at
-- two layers instead of one.
--
-- This does not constrain the RPCs to come: they are `security definer` and run as
-- the owner, so they need no grant on the caller's behalf.
revoke insert, update, delete, truncate on judges from anon, authenticated;
revoke insert, update, delete, truncate on judge_assignments from anon, authenticated;
revoke insert, update, delete, truncate on judge_sheets from anon, authenticated;
revoke insert, update, delete, truncate on judge_ranks from anon, authenticated;
revoke insert, update, delete, truncate on round2_qualifiers from anon, authenticated;
revoke insert, update, delete, truncate on event_rounds from anon, authenticated;

-- `anon` has no reason to read any of this either. Every reader is a signed-in
-- admin or a signed-in judge.
revoke select on judges from anon;
revoke select on judge_assignments from anon;
revoke select on judge_sheets from anon;
revoke select on judge_ranks from anon;
revoke select on round2_qualifiers from anon;
revoke select on event_rounds from anon;
