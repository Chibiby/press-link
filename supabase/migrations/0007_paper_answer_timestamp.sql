-- Press Link: the school paper question moves to the end of the flow.
--
-- A school now fills English and Filipino first, and only then answers "are
-- you submitting these as your school paper entry?". Yes locks the two papers.
-- No re-opens them, accepts N/A, and keeps participants and coaches shut until
-- both have been saved again — which needs the moment of the answer on record.
--
-- The decline reasons added in 0006 go with the question that carried them.

alter table schools drop constraint if exists schools_paper_decline_shape_check;
alter table schools drop constraint if exists schools_paper_decline_reason_check;
alter table schools drop column if exists paper_decline_reason;
alter table schools drop column if exists paper_decline_note;

alter table schools add column if not exists paper_answered_at timestamptz;

-- Schools that already answered under the old flow have no timestamp. Treat
-- the answer as given now: a Yes keeps its papers, and a No is asked to
-- re-save them, which is exactly the new rule.
update schools
  set paper_answered_at = now()
  where paper_participation <> 'undecided' and paper_answered_at is null;

drop function if exists set_paper_participation(text, text, text);

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

  -- The question is only meaningful once both papers exist; refusing here
  -- stops a crafted call from skipping the form and unlocking the roster.
  if (
    select count(distinct language) from school_papers
    where school_id in (select id from schools where auth_user_id = auth.uid())
  ) < 2 then
    raise exception 'both school papers must be saved first';
  end if;

  update schools
    set paper_participation = choice,
        paper_answered_at = now()
    where auth_user_id = auth.uid();
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
        paper_answered_at = null
    where id = target_school;
end;
$fn$;
