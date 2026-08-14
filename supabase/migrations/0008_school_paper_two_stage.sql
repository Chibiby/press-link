-- Press Link: the school paper becomes a two-stage flow.
--
--   Stage 1. Fill the paper information for English, Filipino, or both. One
--            language is enough; every field defaults to N/A.
--   Stage 2. "Are you submitting this school paper to the school paper
--            contest?" Yes records a contest submission, No retains the
--            information only. Either answer opens the roster, and neither
--            signs the school out.
--
-- Both stages stay editable until the school locks its details in. The lock is
-- the only thing that freezes them, and only the division office can reopen it.

alter table schools add column if not exists paper_locked_at timestamptz;

-- A school that already answered under the old flow keeps its answer. Its
-- papers were frozen by the Yes itself, which no longer freezes anything, so
-- the equivalent state is a lock stamped at the moment of that answer.
update schools
  set paper_locked_at = coalesce(paper_answered_at, now())
  where paper_participation = 'yes' and paper_locked_at is null;

-- The question is meaningful as soon as one language exists, and a locked
-- school may not change its answer.
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

  if exists (select 1 from schools where id = target and paper_locked_at is not null) then
    raise exception 'school paper is locked';
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

-- Locking needs an answer on record, otherwise a school could freeze itself
-- half-way through the flow and never reach the question.
create or replace function lock_school_paper()
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

  update schools set paper_locked_at = now()
    where id = target and paper_locked_at is null;
end;
$fn$;

revoke all on function lock_school_paper() from public;
grant execute on function lock_school_paper() to authenticated;

-- The UI hides the forms once locked, but a hand-rolled request would sail
-- past that, so the table refuses the write itself.
create or replace function reject_locked_school_paper()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  target := coalesce(new.school_id, old.school_id);
  if exists (
    select 1 from schools
    where id = target
      and paper_locked_at is not null
      and auth_user_id = auth.uid()
  ) then
    raise exception 'school paper is locked';
  end if;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists school_papers_locked_guard on school_papers;
create trigger school_papers_locked_guard
  before insert or update or delete on school_papers
  for each row execute function reject_locked_school_paper();

create or replace function reject_locked_paper_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  select school_id into target from school_papers
    where id = coalesce(new.school_paper_id, old.school_paper_id);
  if exists (
    select 1 from schools
    where id = target
      and paper_locked_at is not null
      and auth_user_id = auth.uid()
  ) then
    raise exception 'school paper is locked';
  end if;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists paper_staff_locked_guard on paper_staff;
create trigger paper_staff_locked_guard
  before insert or update or delete on paper_staff
  for each row execute function reject_locked_paper_staff();

-- Resetting reopens everything: the answer, the timestamp and the lock.
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
        paper_locked_at = null
    where id = target_school;
end;
$fn$;
