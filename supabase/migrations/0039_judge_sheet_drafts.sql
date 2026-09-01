-- Press Link: a judge can save a sheet without submitting it.
--
-- The division's rule is "once naka rank, i-lock", and 0027 built it the tightest
-- way it could: writing a sheet *is* submitting it, and `judge_sheets.submitted_at`
-- is the lock, so there is no second flag to fall out of step with the first. That
-- is still the rule. What it never allowed for is the hour before the verdict —
-- fifteen contestants read on paper, a rank typed for eight of them, and a judge who
-- wants to put the tablet down and come back. Today that judge must either hold the
-- whole sheet in their head or submit a verdict they are not finished with, and
-- unpicking the second needs an administrator.
--
-- WHAT THIS ADDS
--
--   1. `judge_save_draft`, which writes the ranks and does not stamp the
--      submission. Nothing else.
--
-- WHY IT NEEDS NO NEW COLUMN, AND NO NEW STATE
--
-- Ranks on file with `submitted_at` null is not a new state: it is exactly what an
-- admin leaves behind with `admin_unlock_judge_sheet`, and every surface already
-- reads it. `loadSheetEntry` calls that draft "what this judge already filed, which
-- is only ever non-empty on a sheet an admin has reopened"; `draftFromRanks` opens
-- the form on those ranks; `sheetEntryState` and `sheetEditable` already treat an
-- unsubmitted sheet as editable. All this function does is let the judge reach that
-- state themselves instead of asking an officer to put them in it.
--
-- So nothing downstream changes. A saved sheet is not submitted, is not locked, does
-- not close a round, is not read by the cut, and shows on the panel page exactly as
-- an unfinished sheet shows today.
--
-- WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
--
-- Every structural rule `judging_write_sheet` applies: the event is individual, the
-- caller holds the right seat for the round, the round is open, the results are not
-- published, the sheet is not already submitted, every key is a contestant in this
-- event, and every rank is a whole number inside the round's bounds.
--
-- It does **not** apply the completeness rules, and that is the point of a draft:
-- round 2 need not name every qualifier yet, and round 1 may be entirely blank. Those
-- two are checked when the sheet is submitted, by `judging_write_sheet`, which is
-- untouched by this migration and remains the only thing that can close a sheet.
--
-- WHAT IT CANNOT DO
--
-- It cannot submit, and it cannot un-submit. A sheet that has been submitted is
-- refused outright — reopening one is still `admin_unlock_judge_sheet` and still an
-- administrator's decision, because a judge who could reopen their own verdict is
-- the thing "once naka rank, i-lock" exists to prevent.
--
-- Safe to re-run: `create or replace`. It adds a function and touches no table, no
-- column, no policy, no trigger and no existing row.

create or replace function judge_save_draft(
  p_event_id uuid,
  p_round int,
  p_ranks jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_judge_id   uuid;
  v_category   text;
  v_seat       int;
  v_r1_locked  timestamptz;
  v_results    timestamptz;
  v_sheet_id   uuid;
  v_submitted  timestamptz;
  v_qcount     int;
  v_units      int;
  v_top        int;
  v_bad        int;
begin
  select id into v_judge_id
    from judges where auth_user_id = auth.uid() and is_active;

  -- An inactive judge is not a judge — the same rule app/judge/guard.ts applies at
  -- the page, restated where it cannot be bypassed.
  if v_judge_id is null then
    raise exception 'not authorized';
  end if;

  if p_round is null or p_round not in (1, 2) then
    raise exception 'invalid round';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  -- N1: seat 1 ranks round 1, seats 2 to 4 rank round 2.
  select a.seat into v_seat
    from judge_assignments a
   where a.event_id = p_event_id and a.judge_id = v_judge_id;

  if v_seat is null then
    raise exception 'judge not seated on this event';
  end if;
  if p_round = 1 and v_seat <> 1 then
    raise exception 'round 1 is seat 1 only';
  end if;
  if p_round = 2 and v_seat not in (2, 3, 4) then
    raise exception 'round 2 is seats 2 to 4 only';
  end if;

  select round1_locked_at, results_locked_at into v_r1_locked, v_results
    from event_rounds where event_id = p_event_id;

  if p_round = 1 and v_r1_locked is not null then
    raise exception 'round 1 is locked';
  end if;
  if p_round = 2 and v_r1_locked is null then
    raise exception 'round 1 is not locked';
  end if;
  if v_results is not null then
    raise exception 'results are locked';
  end if;

  insert into judge_sheets (event_id, judge_id, round)
       values (p_event_id, v_judge_id, p_round)
  on conflict (event_id, judge_id, round) do nothing;

  select id, submitted_at into v_sheet_id, v_submitted
    from judge_sheets
   where event_id = p_event_id and judge_id = v_judge_id and round = p_round;

  -- The one refusal that matters here. A submitted sheet is a verdict, and a judge
  -- who could write over their own verdict is what "once naka rank, i-lock" exists
  -- to prevent. Reopening it stays an administrator's act.
  if v_submitted is not null then
    raise exception 'sheet already submitted';
  end if;

  if p_ranks is null or jsonb_typeof(p_ranks) <> 'object' then
    raise exception 'ranks must be a json object';
  end if;

  select count(*) into v_bad
    from jsonb_each(p_ranks) e
   where jsonb_typeof(e.value) <> 'number'
      or (e.value #>> '{}') !~ '^[0-9]+$';
  if v_bad > 0 then
    raise exception 'every rank must be a whole number';
  end if;

  select count(*) into v_bad
    from jsonb_object_keys(p_ranks) k
   where not exists (
     select 1
       from entry_participants ep
       join entries en on en.id = ep.entry_id
      where ep.participant_id = k::uuid
        and en.event_id = p_event_id
   );
  if v_bad > 0 then
    raise exception 'ranks contain a unit that is not in this event';
  end if;

  if p_round = 1 then
    select count(*) into v_units
      from entry_participants ep
      join entries en on en.id = ep.entry_id
     where en.event_id = p_event_id;

    -- 0032's bound: the field, capped at the ceiling the dropdown is built to.
    v_top := least(v_units, 50);

    select count(*) into v_bad
      from jsonb_each_text(p_ranks) e
     where e.value::int < 1 or e.value::int > v_top;
    if v_bad > 0 then
      raise exception 'round 1 ranks must be between 1 and %', v_top;
    end if;
  else
    select count(*) into v_qcount
      from round2_qualifiers where event_id = p_event_id;

    if v_qcount = 0 then
      raise exception 'this event has no qualifiers';
    end if;

    -- Only qualifiers may be ranked, and only inside the field's size. What is NOT
    -- checked is that every qualifier is named: a half-finished round 2 sheet is
    -- the ordinary state of a draft, and `judging_write_sheet` is what insists on
    -- the whole panel when the sheet is finally submitted.
    select count(*) into v_bad
      from jsonb_object_keys(p_ranks) k
     where not exists (
       select 1 from round2_qualifiers q
        where q.event_id = p_event_id and q.participant_id = k::uuid
     );
    if v_bad > 0 then
      raise exception 'round 2 may rank only qualifiers';
    end if;

    select count(*) into v_bad
      from jsonb_each_text(p_ranks) e
     where e.value::int < 1 or e.value::int > v_qcount;
    if v_bad > 0 then
      raise exception 'round 2 ranks must be between 1 and the qualifier count';
    end if;
  end if;

  -- Replace rather than merge, exactly as a submission does: the sheet on the
  -- judge's screen is the whole truth of that sheet, and a rank cleared there must
  -- be cleared here.
  delete from judge_ranks where sheet_id = v_sheet_id;

  insert into judge_ranks (sheet_id, entry_id, participant_id, rank)
  select v_sheet_id, en.id, k::uuid, (p_ranks ->> k)::int
    from jsonb_object_keys(p_ranks) k
    join entry_participants ep on ep.participant_id = k::uuid
    join entries en on en.id = ep.entry_id and en.event_id = p_event_id;

  -- `entered_by` and `updated_at`, and pointedly not `submitted_at` or
  -- `submitted_by`. Those two are the lock, and this function is the one write in
  -- the system that touches a sheet without taking it.
  update judge_sheets
     set entered_by = auth.uid(),
         updated_at = now()
   where id = v_sheet_id;
end;
$fn$;

revoke all on function judge_save_draft(uuid, int, jsonb) from public;
grant execute on function judge_save_draft(uuid, int, jsonb) to authenticated;

comment on function judge_save_draft(uuid, int, jsonb) is
  'Saves a judge''s ranks without submitting the sheet, so a part-finished sheet survives being put down. Applies every structural rule judging_write_sheet applies — seat, round state, unit membership, rank bounds — but none of its completeness rules, since an unfinished sheet is what a draft is. Refuses a sheet that has already been submitted: reopening a verdict remains admin_unlock_judge_sheet. Never sets submitted_at.';
