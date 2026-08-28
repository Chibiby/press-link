-- Press Link: one school let back in, on the parts the office actually
-- reopened, for a fixed number of minutes, without lifting the deadline off the
-- division.
--
-- 0022's switch is all-or-nothing by design: at the close of registration all
-- 336 schools stop writing at once, and that is what it is for. What it never
-- covered is the phone call five minutes later — one school, one wrong entry,
-- half an hour to fix it — and both of the tools that exist answer a different
-- question. `admin_set_submissions_lock(false)` reopens everybody.
-- `admin_unlock_submission` clears that school's own `submission_locked_at`
-- while the division-wide flag goes on refusing every write on top of it.
--
-- So a third thing, narrower than both: a grant that says *this school, these
-- parts, until this time*. Design:
-- docs/superpowers/specs/2026-08-28-revision-grants-design.md.
--
-- WHAT THIS CHANGES
--
--   1. `revision_grants`, a new table beside `schools`, with one partial unique
--      index, two read policies, and no write policy for anyone.
--   2. `revision_allows(target, surface)`, which reads that table the way a
--      trigger has to be able to read it.
--   3. 0022's three guard functions and 0023's `set_paper_participation`, each
--      re-created with its two lock checks wrapped in that read. The bodies are
--      otherwise reproduced verbatim, `auth_user_id = auth.uid()` included.
--   4. `admin_grant_revision` and `admin_revoke_revision`, the only two things
--      that ever write the new table.
--
-- WHAT THIS DOES NOT TOUCH
--
--   * `schools`. Not one statement in this file writes it, and neither RPC does
--     either. That is 0022's discipline, kept for 0022's reason: a grant that
--     cleared `submission_locked_at` could not put it back, so the school that
--     had locked itself and the school that was still working would become the
--     same row, with nothing left to tell them apart. A grant beats the school's
--     own lock as well as the division's, and that lock takes effect again the
--     instant the grant ends, because nothing ever touched it.
--   * `app_settings`. The division-wide flag stays exactly as it is; a grant is
--     read *past* it on the write path, never applied over it.
--   * 0011's seven row triggers. They are not redefined here. `create or
--     replace` swaps the three function bodies underneath them, so all seven
--     pick the grant up in the same instant and no table is left unguarded
--     mid-migration.
--   * `activity_events`. Granting and revoking are not logged: 0024's
--     `activity_events_kind_check` would have to be widened, and the design
--     leaves that out.
--
-- No job, no timer. `expires_at > now()` is evaluated inside the guard on every
-- school-side write, so the lock comes back by arithmetic. A cron or a browser
-- countdown could only ever be late; a comparison cannot be.
--
-- Safe to re-run: every statement is guarded. And nothing here is ever applied
-- to another table, so deleting every row in `revision_grants` returns the
-- division to precisely the state it is in with this feature absent.

-- 1. The table.
--
-- A grant is only ever inserted, or stamped `revoked_at` — never edited in
-- place. That is what makes the table its own record of what was reopened, for
-- whom, by whom and until when.
--
-- Scope is three surfaces rather than per-entry. `paper`, `roster` and `entries`
-- are already the seam this schema has: the seven guarded tables reach their
-- school by three routes through three guard functions, so a surface-scoped
-- grant costs one condition per function and no new join anywhere. Per-entry
-- grants were considered and rejected — they need a join table, they push an
-- `entry_id` lookup into `reject_locked_entry_link()`, and the office's actual
-- request is "let them fix their entries", not "let them fix entry #4".
create table if not exists revision_grants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  allow_paper boolean not null default true,
  allow_roster boolean not null default true,
  allow_entries boolean not null default true,
  constraint revision_grants_window check (expires_at > granted_at),
  constraint revision_grants_scope check (allow_paper or allow_roster or allow_entries)
);

-- Every column is re-asserted, for 0022's reason: `create table if not exists`
-- adds nothing to a table that already stands, so on a database where an earlier
-- run of this file got part-way, the create above is a no-op and every statement
-- below rests on columns nobody has checked for. On a table this file created,
-- all eight are no-ops.
--
-- `expires_at` is the one that can fail rather than no-op, and deliberately so:
-- `not null` with no default cannot be added to a table that already holds rows,
-- so a half-made `revision_grants` with grants in it stops this migration with a
-- message naming the column, instead of leaving a definer RPC to fail on an
-- admin's first click.
alter table revision_grants add column if not exists school_id uuid not null;
alter table revision_grants add column if not exists granted_at timestamptz not null default now();
alter table revision_grants add column if not exists granted_by uuid;
alter table revision_grants add column if not exists expires_at timestamptz not null;
alter table revision_grants add column if not exists revoked_at timestamptz;
alter table revision_grants add column if not exists allow_paper boolean not null default true;
alter table revision_grants add column if not exists allow_roster boolean not null default true;
alter table revision_grants add column if not exists allow_entries boolean not null default true;

-- Both foreign keys and both checks are (re-)asserted by name with the
-- drop-then-add idiom from 0022, so this file is correct against a table left
-- behind by an earlier run of it, and so a later migration has names it can rely
-- on. Each name is also the one Postgres would generate for the equivalent
-- inline clause, so the drop catches the constraint however it was created.
--
-- `on delete cascade` on `school_id`, because a grant against a deleted school
-- is not a fact worth keeping. `granted_by` gets no cascade, following
-- `app_settings.submissions_locked_by` and `events.round1_closed_by` before it.
alter table revision_grants drop constraint if exists revision_grants_school_id_fkey;
alter table revision_grants add constraint revision_grants_school_id_fkey
  foreign key (school_id) references schools(id) on delete cascade;

alter table revision_grants drop constraint if exists revision_grants_granted_by_fkey;
alter table revision_grants add constraint revision_grants_granted_by_fkey
  foreign key (granted_by) references auth.users(id);

-- A window that closes before it opens permits nothing while looking, on the
-- admin page, exactly like one that permits something. `>` rather than `>=`:
-- `expires_at = granted_at` is a grant with no duration, and section 6 tests
-- `expires_at > now()`, so the two agree about the boundary.
alter table revision_grants drop constraint if exists revision_grants_window;
alter table revision_grants add constraint revision_grants_window
  check (expires_at > granted_at);

-- The same argument for the scope. A row with all three surfaces false reopens
-- nothing and renders on the admin page as a live revision window, which is the
-- worst of both: the office believes it has helped and the school still cannot
-- write. `admin_grant_revision` refuses one with a sentence a human can read
-- (section 9); this makes it unrepresentable even by hand.
alter table revision_grants drop constraint if exists revision_grants_scope;
alter table revision_grants add constraint revision_grants_scope
  check (allow_paper or allow_roster or allow_entries);

-- 2. One live grant per school — and the only index this file adds.
--
-- `revoked_at is null` is what "live" means, so the uniqueness is partial: a
-- school may accumulate any number of revoked grants and at most one current
-- one. Changing a grant is therefore a revoke-and-insert inside
-- `admin_grant_revision` rather than an update, which is what keeps the history
-- of what was granted when.
--
-- The index is the real guard rather than a formality. Two admins double-clicking
-- Allow revision on the same school is the race it exists for: neither
-- transaction can see the other's uncommitted row, so both pass the "revoke
-- anything live" step, and the second insert blocks on this index and then fails
-- with a unique violation — which the action turns into "another administrator
-- just granted revision to this school" instead of leaving two live grants on
-- file for `revision_allows` to choose between.
--
-- It is also the read path's index, which is why this file adds no other.
-- `revision_allows()` runs on every school-side write and asks exactly
-- `where school_id = $1 and revoked_at is null`; a partial unique index on
-- `(school_id)` where `revoked_at is null` answers that from one entry per live
-- grant — at most 336 of them in this division, and none for the revoked rows
-- that will eventually outnumber them. An index on `expires_at`, or on
-- `(school_id, revoked_at)`, would tax every insert here to serve a query nobody
-- makes: the row is found by school, and the window is then tested on that one
-- row.
create unique index if not exists revision_grants_one_live
  on revision_grants (school_id) where revoked_at is null;

-- 3. What the columns mean, in the database, for whoever reads the schema
--    instead of this file.
comment on table revision_grants is
  'Time-limited, surface-scoped permission for one school to keep writing while the division-wide lock (0022) is on. Read by revision_allows() on every school-side write; written only by admin_grant_revision() and admin_revoke_revision(), which are the reason there is no insert, update or delete policy here. Rows are never edited except to stamp revoked_at and never deleted, so this table is the record of what was reopened for whom. Nothing in it is ever copied onto schools: delete every row and the division is back to how it behaves with the feature absent.';

comment on column revision_grants.school_id is
  'The school being let back in. ON DELETE CASCADE, because a grant against a deleted school is not a fact worth keeping. At most one row per school may be live at a time — see the partial unique index revision_grants_one_live.';

comment on column revision_grants.granted_at is
  'When the office granted it. Never rewritten: a change of mind is a revoke and a new row, so this reads as "granted at", not "last touched".';

comment on column revision_grants.granted_by is
  'The admin who granted it. Nullable for app_settings.submissions_locked_by''s reason: a script or a migration carries no auth.uid(), and recording a grant unattributed beats refusing to record it.';

comment on column revision_grants.expires_at is
  'When the window closes. Compared against now() inside revision_allows() on every guarded write, so the lock returns by arithmetic rather than by a job that has to fire on time. The test is strictly greater-than, so expires_at = now() is expired, not live — and the browser countdown at /entry only calls router.refresh() at zero, because a client with a skewed clock must never be the thing that decides a window is open.';

comment on column revision_grants.revoked_at is
  'When the office withdrew this grant, or null while it stands. Stamped by admin_revoke_revision(), and by admin_grant_revision() on the row it replaces. Never cleared: a revoked grant is history, and re-granting inserts a new row.';

comment on column revision_grants.allow_paper is
  'True when this grant reopens the school paper surface: school_papers, paper_staff, and the contest answer written by set_paper_participation(). Read as revision_allows(school, ''paper'').';

comment on column revision_grants.allow_roster is
  'True when this grant reopens the roster: participants and coaches. Read as revision_allows(school, ''roster'').';

comment on column revision_grants.allow_entries is
  'True when this grant reopens entries: entries, entry_participants and entry_coaches. Read as revision_allows(school, ''entries'').';

-- One residual, stated rather than hidden. `granted_by` has a real foreign key
-- to auth.users with no cascade, which is what the design specifies and what
-- `app_settings.submissions_locked_by` already does — but it is the opposite of
-- the call 0024 made for `activity_events.actor_user_id`, which carries no FK
-- precisely so audit rows cannot block the deletion of the login they describe.
-- Here they can: rows are never pruned, so once an admin has granted a revision,
-- deleting that admin's auth.users row is refused until the grants naming them
-- are cleared, and the check is a sequential scan because no index covers this
-- column. Both costs are trivial at this table's size and neither is silent, so
-- the FK stays for the referential integrity it buys. If removing an admin login
-- ever becomes routine, the forward migration is `on delete set null` — not this
-- file's decision to make.

-- 4. Who may read a grant.
--
-- Admins read every row, because the admin page lists them. A school reads only
-- its own, so the /entry banner can name what was reopened without telling that
-- school which other schools were granted anything — the office reopening one
-- school after a phone call is not division-wide news.
--
-- Deliberately **no insert, update or delete policy**, for any role. The two
-- RPCs in sections 9 and 10 own every write to this table, and both are
-- `security definer`, so they need no policy of their own. A policy that does not
-- exist permits nothing, which is what makes "a school cannot grant itself a
-- revision window" true here.
--
-- Both are scoped `to authenticated` explicitly, which is 0022's lesson: 0001
-- wrote `using (true)` with no role list on app_settings and so handed the row to
-- signed-out visitors as well. Nothing signed out has any business reading which
-- schools the office is helping.
alter table revision_grants enable row level security;

drop policy if exists "admin read revision_grants" on revision_grants;
create policy "admin read revision_grants" on revision_grants for select
  to authenticated
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists "school read own revision_grants" on revision_grants;
create policy "school read own revision_grants" on revision_grants for select
  to authenticated
  using (school_id in (select id from schools where auth_user_id = auth.uid()));

-- 5. And the grants under those policies, following section 2 of 0022 and
--    section 8 of 0024.
--
-- RLS sits on top of table privileges, so the policies above are not enough on
-- their own: without a grant the /entry banner and the admin page get
-- "permission denied for table revision_grants" however permissive the policy is.
--
-- And Supabase's default privileges on schema `public` hand every new table to
-- `anon` and `authenticated` with insert, update and delete included. The absent
-- policies already refuse all three — but of the two layers, the one that must
-- not depend on somebody's restraint is this one: a school that could insert here
-- would grant itself a revision window and write straight through a division-wide
-- deadline, and a school that could update here would extend its own window, or
-- clear the `revoked_at` the office just stamped. "Only the office grants
-- revision" should not rest on the continued absence of a policy someone adds in
-- haste while building the admin page, so it is made true at the privilege layer
-- too, where a policy cannot reopen it.
--
-- `update` is revoked here, unlike on app_settings. There, 0022 had to keep it,
-- because "admin write app_settings" is an update policy and RLS can only narrow
-- a privilege, never widen one. Here no policy needs it: every write goes through
-- a definer function, which runs as the owner and needs no grant at all.
--
-- `anon` keeps nothing, select included. Every reader is a signed-in school or a
-- signed-in admin.
grant select on revision_grants to authenticated;
revoke insert, update, delete, truncate on revision_grants from anon, authenticated;
revoke select on revision_grants from anon;

-- 6. Reading a grant from inside a trigger, without the possibility of failing
--    open.
--
-- This is the deliberate mirror image of `submissions_locked_globally()`, and the
-- asymmetry is the point. That function *raises* rather than returning false,
-- because a lock that fails open reports "locked" on the admin page while every
-- school carries on writing. This one *returns false* rather than raising,
-- because a grant that fails open is the same bug wearing the other hat: a
-- missing row, a revoked row, an unrecognised surface or a null read as "go
-- ahead" would let a school write through a deadline the office never lifted.
-- Both functions fail towards the lock. There is no path out of this one that
-- permits a write without having positively read `true` out of the column
-- matching the surface, on a row that is neither revoked nor expired.
--
-- `security definer` with a pinned `search_path`, the 0011 idiom, so the policies
-- in section 4 cannot hide the row from a trigger — the school's own policy would
-- in fact match, but the guards must also work for a caller whose school row is
-- not visible, and depending on RLS to answer a security question is what section
-- 3 of 0022 argued against.
--
-- `stable`, not `volatile`, so Postgres may evaluate it once per row per
-- statement; `now()` is the transaction timestamp either way, so a multi-row
-- write is judged against one instant rather than drifting mid-statement.
--
-- The `case` has no `else`, which is what makes an unrecognised surface false:
-- it evaluates to null, `coalesce` turns that into false, and the same null
-- arrives for "no live row" and for a null column. One expression, four ways of
-- saying no. `into` without `strict` cannot raise on a second row either, and
-- `revision_grants_one_live` means there cannot be one.
create or replace function revision_allows(target uuid, surface text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  allowed boolean;
begin
  select case surface
           when 'paper' then g.allow_paper
           when 'roster' then g.allow_roster
           when 'entries' then g.allow_entries
         end
    into allowed
    from revision_grants g
   where g.school_id = target
     and g.revoked_at is null
     and g.expires_at > now();

  return coalesce(allowed, false);
end;
$fn$;

-- Execute goes to `authenticated` and to nothing else, following 0022. The seven
-- triggers and the two RPCs do not need it — they are definer functions running
-- as the owner — so the grant exists for the server actions that have to ask the
-- same question the trigger is about to ask. It is a boolean oracle over a uuid a
-- caller would have to already know, which is a smaller disclosure than the row
-- itself and strictly less than the /entry page shows the school anyway.
revoke all on function revision_allows(uuid, text) from public;
grant execute on function revision_allows(uuid, text) to authenticated;

comment on function revision_allows(uuid, text) is
  'True when the school has a live, unexpired revision grant covering that surface — one of ''paper'', ''roster'', ''entries''. Everything else is false: no grant, a revoked or expired one, a surface it does not cover, an unrecognised surface name, a null. The mirror image of submissions_locked_globally(), which raises rather than returning false: a lock must not fail open, and neither must a grant.';

-- 7. The three guard functions, re-created.
--
-- 0011 wired seven row triggers to these three functions, because the seven
-- guarded tables reach their school by three different routes. **The triggers
-- themselves are not redefined here.** `create or replace` swaps the body
-- underneath them, so all seven pick the grant up at once and no table is ever
-- unguarded — the same property 0022 relied on, and the reason this file can add
-- a condition to every school-side write without naming a single trigger.
--
-- Every existing condition survives, `auth_user_id = auth.uid()` included. That
-- clause is what lets an admin and the service role write a locked school's rows,
-- which `scripts/reset-submissions.sql`, the seeders and every admin repair path
-- depend on, and the lockdown plan states it as a standing constraint.
--
-- The one change is a wrapper. It goes **inside** the ownership `exists`, exactly
-- where 0022's flag read already sat, so a caller who does not own the row is
-- held by neither lock and now evaluates neither the flag nor the grant. The
-- nesting is what keeps a school's grant from being consulted on an admin's
-- write, and keeps a broken `revision_grants` — dropped, renamed, ownership
-- changed — from blocking the very callers who would repair it:
--
--   if not revision_allows(target, <surface>) then
--     <0022's two lock checks, verbatim>
--   end if;
--
-- Read it as: the two locks still hold, unless the office has said otherwise
-- about this school and this surface. Both sentences below are byte-for-byte
-- 0022's, because `rpcMessage()` in app/entry/roster-actions.ts and
-- `classifySubmissionLockError()` in lib/submissions/lock-errors.ts both match on
-- the text — and 'submissions are locked division-wide' does not contain the
-- substring 'submission is locked', which is what keeps the division-wide case
-- from being reported as the per-school one.

-- 7a. The four tables that carry school_id directly: school_papers,
--     participants, coaches, entries.
--
-- One function, four tables, three surfaces — so this is the only one of the
-- three that has to work out which surface it is guarding, and `tg_table_name` is
-- the one thing a trigger function always knows about itself.
--
-- The `else` branch is load-bearing rather than defensive padding. If this
-- function is ever attached to a fifth table — or if one of the four is renamed
-- and this file is not — the surface must be a value `revision_allows` answers
-- false to, so that the unknown table falls through to the two locks instead of
-- being waved past them by a grant that never mentioned it. `'unrecognised'`
-- matches none of the three `when` arms in section 6, and section 6 has no `else`
-- of its own, so it returns false. The alternative — defaulting to `'entries'`,
-- or to the first surface — would silently hand a new table the widest grant any
-- school happens to hold.
create or replace function reject_locked_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
  surface text;
begin
  if tg_op = 'DELETE' then
    target := old.school_id;
  else
    target := new.school_id;
  end if;
  surface := case tg_table_name
               when 'school_papers' then 'paper'
               when 'participants' then 'roster'
               when 'coaches' then 'roster'
               when 'entries' then 'entries'
               else 'unrecognised'
             end;
  if exists (
    select 1 from schools
    where id = target
      and auth_user_id = auth.uid()
  ) then
    if not revision_allows(target, surface) then
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
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

comment on function reject_locked_submission() is
  'BEFORE guard for school_papers, participants, coaches and entries (0011''s four direct triggers). Refuses a school''s own write while the division-wide lock or its own lock is on, unless revision_allows() covers the surface that table belongs to — paper for school_papers, roster for participants and coaches, entries for entries. A table it does not recognise gets a surface no grant can match, so it stays locked.';

-- 7b. paper_staff, which reaches its school through school_papers.
--
-- Fixed surface `'paper'`: the staff list is part of the school paper, and an
-- office that reopened the paper meant the adviser and the staff on it. A grant
-- scoped to roster or entries alone leaves this table frozen, which is the
-- distinction the three surfaces exist to draw.
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
    if not revision_allows(target, 'paper') then
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
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

comment on function reject_locked_paper_staff() is
  'BEFORE guard for paper_staff, which reaches its school through school_papers. Same rule as reject_locked_submission(), at the fixed surface ''paper'': the staff list is part of the school paper, so a paper grant covers it and a roster- or entries-only grant does not.';

-- 7c. entry_participants and entry_coaches, which reach their school through
--     entries.
--
-- Fixed surface `'entries'`. These two tables are who is *in* an entry, so they
-- follow the entry rather than the roster: reopening entries has to let a school
-- correct the contestant on one, and reopening only the roster must not, or "fix
-- your learner's name" would quietly become "swap who is competing".
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
    if not revision_allows(target, 'entries') then
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
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

comment on function reject_locked_entry_link() is
  'BEFORE guard for entry_participants and entry_coaches, which reach their school through entries. Same rule as reject_locked_submission(), at the fixed surface ''entries'': who is in an entry follows the entry, not the roster, so a roster-only grant leaves these two tables frozen.';

-- 8. `set_paper_participation`, re-created — the one guarded write path that is
--    not a trigger.
--
-- 0023 exists because `schools` carries no guard trigger and never will: a
-- trigger there would fire on `admin_unlock_submission`,
-- `admin_reset_paper_participation` and `scripts/reset-submissions.sql`, and each
-- would then need an exemption carved back out of it. So the contest answer is
-- guarded in the single function a school can actually reach, and the grant has to
-- reach it for exactly the reason the division-wide flag did — otherwise a school
-- granted its paper back could edit the paper but not answer the question about
-- it.
--
-- 0023's body is reproduced verbatim, and that includes the absence of an
-- ownership gate, which is deliberate and must be preserved. Unlike the trigger
-- functions, this one already resolves its target by `auth.uid()` and raises
-- `school not found` several lines above: an admin, or a service-role caller whose
-- `auth.uid()` is null, has therefore already been turned away and never
-- evaluates the flag or the grant. That is the same property 0022 and section 7
-- get from nesting, arrived at differently, and it is why no
-- `auth_user_id = auth.uid()` test is added here. The office override remains
-- `admin_reset_paper_participation`, untouched by this file.
--
-- Surface `'paper'`, matching `paper_staff` in 7b: the answer belongs to the
-- school paper. Note where the wrapper stops — the `save your school paper
-- information first` check stays outside it, because a grant reopens a locked
-- surface, it does not excuse a school from the gate every school passes through.
create or replace function set_paper_participation(choice text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  if choice not in ('yes', 'no') then
    raise exception 'invalid choice: %', choice;
  end if;

  select id into target from schools where auth_user_id = auth.uid();
  if target is null then
    raise exception 'school not found';
  end if;

  if not revision_allows(target, 'paper') then
    if submissions_locked_globally() then
      raise exception 'submissions are locked division-wide';
    end if;

    if exists (select 1 from schools where id = target and submission_locked_at is not null) then
      raise exception 'submission is locked';
    end if;
  end if;

  if (select count(*) from school_papers where school_id = target) < 1 then
    raise exception 'save your school paper information first';
  end if;

  update schools
    set paper_participation = choice,
        paper_answered_at = now()
    where id = target;
end;
$fn$;

revoke all on function set_paper_participation(text) from public;
grant execute on function set_paper_participation(text) to authenticated;

comment on function set_paper_participation(text) is
  'A school''s own answer to the school paper contest question, the only school-side write that is not covered by a trigger. Refused while the division-wide lock (0022) or the school''s own lock is on, unless the school holds a live revision grant covering ''paper''. Resolves its school by auth.uid(), so an admin or the service role is turned away with ''school not found'' before any lock is consulted; the office override is admin_reset_paper_participation.';

-- 9. Granting.
--
-- The admin check is repeated inside the function even though there is no write
-- policy on the table at all, for the reason 0022 section 5 gives: `security
-- definer` runs as the owner, so RLS does not apply inside here and no policy is
-- ever consulted. This one `exists` is the only thing standing between an
-- authenticated school and a revision window of its own choosing, so it is the
-- first statement in the body and everything else follows it.
--
-- PARAMETER NAMES, because they are load-bearing and they are not what the design
-- document wrote. `returns table` makes each output column a parameter too, and
-- Postgres refuses a function that uses one name twice — so `allow_paper` cannot
-- be both the argument and the column it sets. The output keeps the table's names,
-- because that is the shape the /entry page already reads straight off the table
-- through RLS, and one TypeScript type should serve both; the inputs therefore
-- take the `p_` prefix used since 0027. `target_school` needs no prefix, keeps
-- 0004's name, and does not collide with the output column `school_id`. PostgREST
-- calls RPCs by argument name, so the action must send exactly:
-- `{ target_school, p_allow_paper, p_allow_roster, p_allow_entries, p_minutes }`.
--
-- `#variable_conflict use_column` for 0022's reason, and here it is not optional:
-- nine output parameters share their names with nine columns of the table this
-- body reads and writes, and a plpgsql body is not resolved against the catalog
-- until it first runs, so an unresolved `revoked_at` would fail on an admin's
-- first click rather than at apply time. The directive settles every such
-- identifier on the column, which is what every reference below wants; the four
-- real variables carry `v_` and share a name with nothing.
--
-- The clamp is in the database as well as in the action because a Server Action is
-- a public POST endpoint: anything the browser sends can be replaced, so the RPC
-- is the last line rather than a second opinion. `coalesce` first, so a missing
-- duration becomes the 30 minutes the modal offers instead of a null that would
-- make `expires_at` null and abort on `not null`. And the lower bound of 1 is what
-- makes `revision_grants_window` unfalsifiable: `granted_at` defaults to `now()`
-- and `expires_at` is computed from `now()` in the same statement, so both read
-- the one transaction timestamp and the window is always at least a minute wide.
--
-- Change is revoke-and-insert rather than update, so the row an admin granted at
-- 3:49 stays on file when they extend it at 4:05. Two admins racing is section 2's
-- unique violation, which the action reports rather than swallowing.
create or replace function admin_grant_revision(
  target_school uuid,
  p_allow_paper boolean,
  p_allow_roster boolean,
  p_allow_entries boolean,
  p_minutes int
)
returns table (
  id uuid,
  school_id uuid,
  granted_at timestamptz,
  granted_by uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  allow_paper boolean,
  allow_roster boolean,
  allow_entries boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_actor uuid := auth.uid();
  v_paper boolean := coalesce(p_allow_paper, false);
  v_roster boolean := coalesce(p_allow_roster, false);
  v_entries boolean := coalesce(p_allow_entries, false);
  v_minutes int := greatest(1, least(1440, coalesce(p_minutes, 30)));
  v_id uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = v_actor) then
    raise exception 'not authorized';
  end if;

  -- Before anything is written, and separately from the foreign key, which would
  -- report the same mistake as 23503 with a constraint name in it. A stale admin
  -- page pointed at a school that has since been removed should read as a
  -- sentence.
  if target_school is null or not exists (select 1 from schools where id = target_school) then
    raise exception 'school not found';
  end if;

  -- revision_grants_scope would refuse this too, but as a check violation naming
  -- a constraint. The office needs to be told what to do instead.
  if not (v_paper or v_roster or v_entries) then
    raise exception 'choose at least one part to reopen';
  end if;

  -- The row this one replaces is revoked, not overwritten: what was granted at
  -- 3:49 and what was granted at 4:05 are two facts. Also what clears the way for
  -- revision_grants_one_live below.
  update revision_grants
     set revoked_at = now()
   where school_id = target_school
     and revoked_at is null;

  insert into revision_grants (
    school_id, granted_by, expires_at, allow_paper, allow_roster, allow_entries
  )
  values (
    target_school, v_actor, now() + (v_minutes * interval '1 minute'),
    v_paper, v_roster, v_entries
  )
  returning revision_grants.id into v_id;

  return query
    select g.id, g.school_id, g.granted_at, g.granted_by, g.expires_at,
           g.revoked_at, g.allow_paper, g.allow_roster, g.allow_entries
      from revision_grants g
     where g.id = v_id;
end;
$fn$;

revoke all on function admin_grant_revision(uuid, boolean, boolean, boolean, int) from public;
grant execute on function admin_grant_revision(uuid, boolean, boolean, boolean, int) to authenticated;

comment on function admin_grant_revision(uuid, boolean, boolean, boolean, int) is
  'Grants one school a time-limited revision window over the surfaces named, revoking whatever live grant it already had, and returns the resulting row. Admin only — the check is inside the function because RLS does not apply to a definer function. p_minutes is clamped to 1..1440 (default 30) here as well as in the action, because a Server Action is a public POST endpoint. Never touches schools or app_settings: both locks are left exactly as they were and take effect again when the window closes.';

-- 10. Revoking.
--
-- The same admin check, for the same reason: definer, so no policy is consulted,
-- and this `exists` is the whole authorisation.
--
-- Idempotent by construction, and that is a requirement rather than a nicety. The
-- admin page is a server-rendered list that can be seconds out of date: the grant
-- may have expired on its own, or another admin may have revoked it, between the
-- render and the click. `where revoked_at is null` matches nothing in that case,
-- the statement affects zero rows, and the function returns — because an error
-- there would be an error the admin can do nothing about, on a page whose only
-- remedy is the refresh that was going to happen anyway. Revoking twice is not a
-- mistake worth reporting; the end state is identical either way.
--
-- `returns void` rather than the row count for the same reason. A count invites
-- the caller to treat 0 as failure, which is precisely the behaviour the paragraph
-- above rules out, and there is nothing else the action would do with the number:
-- it revalidates the page and the page re-reads the table.
--
-- Expired grants are deliberately left unstamped. `revoked_at` means the office
-- withdrew this, and `expires_at` in the past means it ran its course; collapsing
-- the two would lose the difference, and `revision_allows` already refuses both.
create or replace function admin_revoke_revision(target_school uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  update revision_grants
     set revoked_at = now()
   where school_id = target_school
     and revoked_at is null;
end;
$fn$;

revoke all on function admin_revoke_revision(uuid) from public;
grant execute on function admin_revoke_revision(uuid) to authenticated;

comment on function admin_revoke_revision(uuid) is
  'Withdraws a school''s live revision grant, closing the window early. Admin only. Idempotent: a school with no live grant — expired, already revoked, never granted — succeeds and changes nothing, so a stale admin page cannot produce an error the admin can do nothing about. Never touches schools or app_settings; the school returns to whatever its own lock and the division-wide lock already said.';
