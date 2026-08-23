-- Press Link: the division-wide submissions lock returns, this time as a
-- reversible override switch rather than a state the schools carry.
--
-- 0010 dropped the original because it "froze every school at once, which is
-- not how the division office works". That is still true of the day-to-day
-- case, and the per-school lock still handles it. What the office also needs is
-- a deadline switch: at the close of registration every school stops writing at
-- once, and if the deadline is then extended, everything goes back to exactly
-- how it was.
--
-- That last sentence is the whole design. The obvious implementation — stamp
-- `submission_locked_at` on every school — cannot be undone, because it erases
-- the difference between a school that had locked itself (and must stay locked
-- when the deadline moves) and one that was still working (and must be let back
-- in). So the flag lives beside `schools`, never in it: **no statement in this
-- file writes to `schools`**, and neither does the RPC below. Turning the
-- switch off restores every school to whatever its own lock already said,
-- because its own lock was never touched.
--
-- Safe to re-run: every statement is guarded.

-- 1. The switch.
--
-- `app_settings` by its old name, with the singleton idiom from 0001 — one row,
-- `id = true`, a CHECK that no second row can exist. Two environments can reach
-- this migration from different places: one where 0010 dropped the table, and
-- one where 0010 never ran and the 0001 table is still standing with only the
-- flag column on it. `if not exists` on the table and on each added column, and
-- the drop-then-add idiom on each constraint, make the same file correct in
-- either. The constraints are re-asserted rather than trusted: a table that
-- survived from 0001 has the singleton check and a freshly created one has it,
-- but a half-applied earlier run of this file may not.
create table if not exists app_settings (
  id boolean primary key default true,
  submissions_locked boolean not null default false,
  constraint app_settings_singleton check (id)
);

alter table app_settings drop constraint if exists app_settings_singleton;
alter table app_settings add constraint app_settings_singleton check (id);

alter table app_settings add column if not exists submissions_locked_at timestamptz;
alter table app_settings add column if not exists submissions_locked_by uuid;

-- The foreign key is added as a named constraint rather than inline on the
-- column, so it is re-asserted on a re-run even when `add column if not exists`
-- has nothing left to do. The name is also the one Postgres would generate for
-- an inline `references`, so the drop catches it however it was created.
-- Provenance follows the `round1_closed_by` idiom from 0018: a uuid pointing at
-- auth.users, no cascade.
alter table app_settings drop constraint if exists app_settings_submissions_locked_by_fkey;
alter table app_settings add constraint app_settings_submissions_locked_by_fkey
  foreign key (submissions_locked_by) references auth.users(id);

-- A table that survived from 0001 can be holding submissions_locked = true with
-- no stamp to go with it, because the stamp columns did not exist then. That row
-- has to be given a stamp before the constraint that demands one, or the ALTER
-- below fails and takes the whole migration with it. `now()` because there is no
-- record anywhere of when it actually happened, and the alternative — clearing
-- the flag to satisfy the constraint — would silently unfreeze a division that
-- deliberately froze itself. A no-op on every environment where 0010 ran, and on
-- every environment where the flag is already off.
update app_settings
   set submissions_locked_at = now()
 where submissions_locked
   and submissions_locked_at is null;

-- A lock nobody can account for is a support call, so the flag and its stamp are
-- one fact rather than two: the constraint makes it impossible to freeze the
-- division without recording when. `submissions_locked_by` stays free to be null
-- while locked — a script or a migration flipping this carries no JWT to
-- attribute it to, and refusing that would be worse than recording it
-- unattributed.
alter table app_settings drop constraint if exists app_settings_lock_stamp_check;
alter table app_settings add constraint app_settings_lock_stamp_check
  check (
    (submissions_locked and submissions_locked_at is not null)
    or (not submissions_locked
        and submissions_locked_at is null
        and submissions_locked_by is null)
  );

-- Open is the state every environment is already in: nothing is frozen today by
-- a flag that does not exist yet, so seeding `false` makes this migration a
-- no-op for every row already on file, in every table. `do nothing` rather than
-- an upsert, because a table that survived from 0001 already holds its row and
-- this migration has no business overwriting the value it holds.
insert into app_settings (id, submissions_locked) values (true, false)
  on conflict (id) do nothing;

comment on table app_settings is
  'One row, id = true. Division-wide switches. Flip submissions_locked with admin_set_submissions_lock(boolean) rather than by hand — the guard triggers read this row on every school-side write.';

comment on column app_settings.submissions_locked is
  'True freezes every school-side write division-wide, on top of and independently of schools.submission_locked_at. Turning it off restores each school to whatever its own lock says; nothing that writes this column ever writes to schools.';

comment on column app_settings.submissions_locked_at is
  'When the division-wide lock went on; null exactly when it is off. Keeps its first value if the lock is re-applied, so it reads as "locked since", not "last touched".';

comment on column app_settings.submissions_locked_by is
  'The admin who turned the division-wide lock on. Null when it is off, and also null when a script or migration turned it on with no auth.uid() to attribute it to.';

-- 2. Who may read and write the switch.
--
-- Read is for authenticated callers only. 0001 used `using (true)` with no role
-- list, which let a signed-out visitor read it too; there is no signed-out page
-- that needs the flag, and every page that does is behind a login. Deliberately
-- **no insert and no delete policy**: the singleton is created here, and a
-- client that can delete the row is a client that can silence the lock.
alter table app_settings enable row level security;

drop policy if exists "public read app_settings" on app_settings;
drop policy if exists "authenticated read app_settings" on app_settings;
create policy "authenticated read app_settings" on app_settings for select
  to authenticated
  using (true);

drop policy if exists "admin write app_settings" on app_settings;
create policy "admin write app_settings" on app_settings for update
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

-- 3. Reading the switch from inside a trigger, without the possibility of
--    failing open.
--
-- A lock that fails open is worse than no lock: it reports "locked" on the admin
-- page while every school carries on writing, and nobody finds out until the
-- results are wrong. Three separate things could make this read come back with
-- nothing — RLS hiding the row from the caller, the singleton row deleted, a
-- search_path pointing at some other schema — and all three produce a null,
-- which `if flag then` reads as "not locked" and waves the write straight
-- through.
--
-- So: `security definer` with a pinned `search_path`, the RPC idiom from 0011,
-- which closes the first and third on their own — the function executes as its
-- owner, which owns app_settings and is therefore not subject to its policies
-- (there is no FORCE ROW LEVEL SECURITY here, and none is wanted). And then the
-- brace behind that belt, the one that still holds if the ownership ever
-- changes: a read that does not positively produce a boolean raises instead of
-- returning. There is no path out of this function that permits a write without
-- having read `false` out of the table first.
create or replace function submissions_locked_globally()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  flag boolean;
begin
  select submissions_locked into flag from app_settings where id;

  if not found or flag is null then
    raise exception 'submission lock state unavailable';
  end if;

  return flag;
end;
$fn$;

revoke all on function submissions_locked_globally() from public;
grant execute on function submissions_locked_globally() to authenticated;

comment on function submissions_locked_globally() is
  'True when the division-wide lock is on. Raises rather than returning false when the flag cannot be read, so the guard triggers cannot fail open.';

-- 4. The three guard functions, recreated.
--
-- 0011 wired seven row triggers to these three functions, because the seven
-- guarded tables reach their school by three different routes. Those triggers
-- are untouched and are not redefined here: `create or replace` swaps the body
-- underneath them, so all seven pick up the global check at once and no table is
-- ever unguarded.
--
-- Every existing condition survives, including `auth_user_id = auth.uid()`. That
-- clause is what lets an admin and the service role write a locked school's
-- rows, which `scripts/reset-submissions.sql`, the seeders and every admin
-- repair path depend on; the lockdown plan states it as a standing constraint.
-- So the global check goes *inside* that same ownership test rather than beside
-- it: a caller who does not own the row is held by neither lock, exactly as
-- today. The per-school `exists` is nested inside the ownership `exists` and is
-- otherwise unchanged — it already contained `auth_user_id = auth.uid()`, so it
-- can only be true when the outer test is, and nesting it changes no outcome.
-- Nesting also means an admin or service-role caller never evaluates the flag
-- read at all, so a broken settings row cannot block the very callers who would
-- have to repair it.
--
-- The global case is reported first, and with a different sentence. First,
-- because while the switch is on, an admin unlocking this one school changes
-- nothing, so "ask the division office to reopen your submission" — which is
-- what the per-school message leads the app to say — would be false advice.
-- Different, because `rpcMessage()` in app/entry/roster-actions.ts matches on
-- the text: 'submissions are locked division-wide' does not contain the
-- substring 'submission is locked', so neither message can be mistaken for the
-- other.

-- 4a. The tables that carry school_id directly: school_papers, participants,
--     coaches, entries.
create or replace function reject_locked_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.school_id;
  else
    target := new.school_id;
  end if;
  if exists (
    select 1 from schools
    where id = target
      and auth_user_id = auth.uid()
  ) then
    if submissions_locked_globally() then
      raise exception 'submissions are locked division-wide';
    end if;
    if exists (
      select 1 from schools
      where id = target
        and submission_locked_at is not null
        and auth_user_id = auth.uid()
    ) then
      raise exception 'submission is locked';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

-- 4b. paper_staff, which reaches its school through school_papers.
create or replace function reject_locked_paper_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    select school_id into target from school_papers where id = old.school_paper_id;
  else
    select school_id into target from school_papers where id = new.school_paper_id;
  end if;
  if exists (
    select 1 from schools
    where id = target
      and auth_user_id = auth.uid()
  ) then
    if submissions_locked_globally() then
      raise exception 'submissions are locked division-wide';
    end if;
    if exists (
      select 1 from schools
      where id = target
        and submission_locked_at is not null
        and auth_user_id = auth.uid()
    ) then
      raise exception 'submission is locked';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

-- 4c. entry_participants and entry_coaches, which reach their school through
--     entries.
create or replace function reject_locked_entry_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    select school_id into target from entries where id = old.entry_id;
  else
    select school_id into target from entries where id = new.entry_id;
  end if;
  if exists (
    select 1 from schools
    where id = target
      and auth_user_id = auth.uid()
  ) then
    if submissions_locked_globally() then
      raise exception 'submissions are locked division-wide';
    end if;
    if exists (
      select 1 from schools
      where id = target
        and submission_locked_at is not null
        and auth_user_id = auth.uid()
    ) then
      raise exception 'submission is locked';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

-- 5. Flipping the switch.
--
-- The admin check is repeated here even though the update policy in section 2
-- says the same thing, for the same reason `admin_unlock_submission` repeats it:
-- `security definer` runs as the owner, so RLS does not apply inside this
-- function and the policy is never consulted. This check is the only thing
-- standing between an authenticated school and the switch.
--
-- Idempotent by construction. Locking an already-locked division succeeds and
-- changes nothing: `coalesce` keeps the first stamp, so the column reads as
-- "locked since" and a second click cannot rewrite who locked it or when.
-- Unlocking an already-open division likewise succeeds. The insert branch is
-- reachable only if the singleton row has been deleted, in which case this RPC
-- puts it back — which matters, because while the row is gone every school-side
-- write raises 'submission lock state unavailable'.
--
-- The output columns are named after the table's columns, because that is the
-- shape the app already reads and renaming them would make the RPC and the
-- table disagree. `#variable_conflict use_column` is what makes that safe: a
-- plpgsql function body is not resolved against the catalog until it first runs,
-- so an identifier that could read as either the output variable or the column
-- would fail on the first admin click rather than at apply time. The directive
-- settles every such identifier on the column, which is what every reference
-- below wants. The two real variables, `locked` and `actor`, share a name with
-- no column of app_settings or admin_profiles, so nothing else is affected.
create or replace function admin_set_submissions_lock(locked boolean)
returns table (
  submissions_locked boolean,
  submissions_locked_at timestamptz,
  submissions_locked_by uuid
)
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  actor uuid := auth.uid();
begin
  if not exists (select 1 from admin_profiles where user_id = actor) then
    raise exception 'not authorized';
  end if;

  if locked is null then
    raise exception 'locked is required';
  end if;

  insert into app_settings as s (
    id, submissions_locked, submissions_locked_at, submissions_locked_by
  )
  values (
    true, locked,
    case when locked then now() end,
    case when locked then actor end
  )
  on conflict (id) do update
    set submissions_locked = locked,
        submissions_locked_at = case when locked then coalesce(s.submissions_locked_at, now()) end,
        submissions_locked_by = case when locked then coalesce(s.submissions_locked_by, actor) end;

  return query
    select s.submissions_locked, s.submissions_locked_at, s.submissions_locked_by
      from app_settings s
     where s.id;
end;
$fn$;

revoke all on function admin_set_submissions_lock(boolean) from public;
grant execute on function admin_set_submissions_lock(boolean) to authenticated;

comment on function admin_set_submissions_lock(boolean) is
  'Turns the division-wide submissions lock on or off and returns the resulting row. Admin only. Never touches schools.submission_locked_at, so unlocking restores every school to its own lock state.';
