-- Press Link: the lock a school applies to itself now covers its whole
-- submission, not just its school paper.
--
-- Locking freezes the paper, the contest answer, participants, coaches and
-- entries together — everything the school owns — and only the division office
-- can lift it. The column is renamed to say so, but additively: the running
-- deployment still selects paper_locked_at by name, so the old column stays
-- until 0012 drops it after this code ships.

alter table schools add column if not exists submission_locked_at timestamptz;

update schools
  set submission_locked_at = paper_locked_at
  where paper_locked_at is not null and submission_locked_at is null;

-- A lockdown needs something to lock down. The contest answer alone was enough
-- when this only froze the paper; an empty submission frozen by a mis-click is
-- a support call, so at least one entry is now required too.
create or replace function lock_submission()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  select id into target from schools
    where auth_user_id = auth.uid() and paper_participation <> 'undecided';
  if target is null then
    raise exception 'answer the school paper contest question first';
  end if;

  if not exists (select 1 from entries where school_id = target) then
    raise exception 'create at least one entry first';
  end if;

  update schools set submission_locked_at = now()
    where id = target and submission_locked_at is null;
end;
$fn$;

revoke all on function lock_submission() from public;
grant execute on function lock_submission() to authenticated;

create or replace function admin_unlock_submission(target_school uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  update schools set submission_locked_at = null where id = target_school;
end;
$fn$;

revoke all on function admin_unlock_submission(uuid) from public;
grant execute on function admin_unlock_submission(uuid) to authenticated;

-- The two answer-writing functions move to the new column. Their behaviour is
-- otherwise unchanged; only the flag they read and clear differs.
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

  if exists (select 1 from schools where id = target and submission_locked_at is not null) then
    raise exception 'submission is locked';
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
  update schools
    set paper_participation = 'undecided',
        paper_answered_at = null,
        submission_locked_at = null
    where id = target_school;
end;
$fn$;

-- Three guard functions, because the seven guarded tables reach their school by
-- three different routes. Each keeps the TG_OP branching from 0008: NEW is
-- unassigned on DELETE and OLD on INSERT, and coalesce would evaluate both.

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
      and submission_locked_at is not null
      and auth_user_id = auth.uid()
  ) then
    raise exception 'submission is locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

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
      and submission_locked_at is not null
      and auth_user_id = auth.uid()
  ) then
    raise exception 'submission is locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

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
      and submission_locked_at is not null
      and auth_user_id = auth.uid()
  ) then
    raise exception 'submission is locked';
  end if;
  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$fn$;

drop trigger if exists school_papers_locked_guard on school_papers;
create trigger school_papers_locked_guard
  before insert or update or delete on school_papers
  for each row execute function reject_locked_submission();

drop trigger if exists participants_locked_guard on participants;
create trigger participants_locked_guard
  before insert or update or delete on participants
  for each row execute function reject_locked_submission();

drop trigger if exists coaches_locked_guard on coaches;
create trigger coaches_locked_guard
  before insert or update or delete on coaches
  for each row execute function reject_locked_submission();

drop trigger if exists entries_locked_guard on entries;
create trigger entries_locked_guard
  before insert or update or delete on entries
  for each row execute function reject_locked_submission();

drop trigger if exists paper_staff_locked_guard on paper_staff;
create trigger paper_staff_locked_guard
  before insert or update or delete on paper_staff
  for each row execute function reject_locked_paper_staff();

drop trigger if exists entry_participants_locked_guard on entry_participants;
create trigger entry_participants_locked_guard
  before insert or update or delete on entry_participants
  for each row execute function reject_locked_entry_link();

drop trigger if exists entry_coaches_locked_guard on entry_coaches;
create trigger entry_coaches_locked_guard
  before insert or update or delete on entry_coaches
  for each row execute function reject_locked_entry_link();
