-- Press Link: "No" to the school paper question is no longer a single answer.
-- A school picks why, and the reason decides whether it keeps being asked and
-- whether its School Paper form stays open.
--
--   submit_later    -> asked again next visit, form open
--   no_paper_yet    -> settled, form open
--   will_not_submit -> settled, form closed until an admin resets the answer
--   other           -> same as above, with the school's own wording stored

alter table schools add column if not exists paper_decline_reason text;
alter table schools add column if not exists paper_decline_note text;

alter table schools drop constraint if exists schools_paper_decline_reason_check;
alter table schools add constraint schools_paper_decline_reason_check
  check (
    paper_decline_reason is null
    or paper_decline_reason in ('submit_later', 'no_paper_yet', 'will_not_submit', 'other')
  );

-- A reason only means anything alongside a No, and only "other" carries a note.
alter table schools drop constraint if exists schools_paper_decline_shape_check;
alter table schools add constraint schools_paper_decline_shape_check
  check (
    (paper_participation = 'no' or paper_decline_reason is null)
    and (paper_decline_reason = 'other' or paper_decline_note is null)
  );

-- The school still writes only its own answer, now with the reason attached.
-- Replacing the 1-argument version outright: leaving it callable would let a
-- school record a No with no reason and sit in the "ask again" state forever.
drop function if exists set_paper_participation(text);

create or replace function set_paper_participation(
  choice text,
  reason text default null,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  clean_note text := nullif(btrim(coalesce(note, '')), '');
begin
  if choice not in ('yes', 'no') then
    raise exception 'invalid choice: %', choice;
  end if;

  if choice = 'yes' then
    update schools
      set paper_participation = 'yes',
          paper_decline_reason = null,
          paper_decline_note = null
      where auth_user_id = auth.uid();
    return;
  end if;

  if reason is null
    or reason not in ('submit_later', 'no_paper_yet', 'will_not_submit', 'other') then
    raise exception 'invalid reason: %', reason;
  end if;
  if reason = 'other' and clean_note is null then
    raise exception 'a reason is required';
  end if;

  update schools
    set paper_participation = 'no',
        paper_decline_reason = reason,
        paper_decline_note = case when reason = 'other' then clean_note else null end
    where auth_user_id = auth.uid();
end;
$fn$;

revoke all on function set_paper_participation(text, text, text) from public;
grant execute on function set_paper_participation(text, text, text) to authenticated;

-- Resetting clears the reason too, so the school is asked from scratch.
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
        paper_decline_reason = null,
        paper_decline_note = null
    where id = target_school;
end;
$fn$;
