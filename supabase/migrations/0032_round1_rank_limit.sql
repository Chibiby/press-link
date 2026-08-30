-- Press Link: round 1's ranks are bounded by the field, not by the cut.
--
-- 0027 bounded a round-1 rank at `events.round2_cut`, on the reasoning recorded in
-- its own comment: "the dropdown offers blank, 1 .. cut and nothing above the cut.
-- That bound is what makes 'scored' and 'qualified' the same set." Making those two
-- sets identical is exactly what turned out to be wrong.
--
-- They answer two different questions. How far down a field a judge is willing to
-- place is the judge's working. Who advances to round 2 is the division's rule, and
-- it is applied *to* that working — by `round1Qualifiers` in `lib/judging/cut.ts`,
-- which has always filtered `rank <= cut` and needed no change here. Conflating them
-- meant a judge under a cut of ten could not record an opinion about the eleventh
-- contestant at all: the dropdown had no such number, and this function refused it.
--
-- So a judge now ranks as far down as they mean to, and the cut still decides who
-- goes through. A sheet of fifteen under a cut of ten qualifies ten (or more, on a
-- tie at the line — that rule is unchanged) and leaves the rest scored, placed on
-- the judge's sheet, and eliminated.
--
-- WHAT THIS CHANGES
--
--   1. `judging_write_sheet`'s round-1 bound, and nothing else in it. A round-1
--      rank must now be between 1 and the number of contestants in the event,
--      capped at 50.
--
-- Why 50: it is `ROUND1_RANK_LIMIT` in `lib/judging/sheet-form.ts`, the ceiling the
-- dropdown is built to. A usability bound rather than a rule of the contest — a
-- select of several hundred rows is unusable on a phone, and no division event
-- fields anything near fifty — and it is repeated here because a maximum only the
-- client keeps is not a maximum (non-negotiable 2). If that constant moves, this
-- number moves with it.
--
-- Why the contestant count as well: a rank of 40 in a field of 12 places nobody, and
-- the client can never offer it. Bounding by the field is what makes a payload
-- carrying one a rejected payload rather than a stored one.
--
-- WHAT THIS DOES NOT TOUCH: no table, no column, no policy, no row, and no other
-- function. Round 2's bound, every authorisation check, the lock rules and the write
-- itself are carried over from 0027 unchanged — the whole body is restated only
-- because `create or replace` cannot patch a fragment.
--
-- NOT retroactive, and it does not need to be: every rank already on file was
-- written under the tighter bound, so all of them satisfy the looser one.
--
-- Safe to re-run: `create or replace`.

create or replace function judging_write_sheet(
  p_event_id uuid,
  p_round int,
  p_judge_id uuid,
  p_ranks jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
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
  if p_round is null or p_round not in (1, 2) then
    raise exception 'invalid round';
  end if;

  -- `round2_cut` is no longer read here. It is not this function's business: the cut
  -- selects qualifiers from a filed sheet, and has nothing to say about what may be
  -- written onto one.
  select category into v_category
    from events where id = p_event_id;

  if v_category is null then
    raise exception 'event not found';
  end if;

  -- Non-negotiable 6, checked before anything else so a group event cannot even
  -- cause a sheet row to be created below.
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  -- N1: seat 1 makes the cut, seats 2-4 place the winners, and because
  -- judge_assignments is unique on (judge_id, event_id) the same judge cannot
  -- hold both. An inactive judge is not seated.
  select a.seat into v_seat
    from judge_assignments a
    join judges j on j.id = a.judge_id
   where a.event_id = p_event_id
     and a.judge_id = p_judge_id
     and j.is_active;

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

  -- A locked round is read-only (N7). Correcting one is unlock -> edit -> re-lock.
  if p_round = 1 and v_r1_locked is not null then
    raise exception 'round 1 is locked';
  end if;

  -- Round 2 does not exist until the qualifier list does (N6).
  if p_round = 2 and v_r1_locked is null then
    raise exception 'round 1 is not locked';
  end if;

  if v_results is not null then
    raise exception 'results are locked';
  end if;

  insert into judge_sheets (event_id, judge_id, round)
       values (p_event_id, p_judge_id, p_round)
  on conflict (event_id, judge_id, round) do nothing;

  select id, submitted_at into v_sheet_id, v_submitted
    from judge_sheets
   where event_id = p_event_id and judge_id = p_judge_id and round = p_round;

  -- A judge cannot un-submit (N6). An admin clears this with
  -- admin_unlock_judge_sheet.
  if v_submitted is not null then
    raise exception 'sheet already submitted';
  end if;

  if p_ranks is null or jsonb_typeof(p_ranks) <> 'object' then
    raise exception 'ranks must be a json object';
  end if;

  -- The whole payload is rejected before any of it is written, so a half-valid
  -- sheet never lands.
  select count(*) into v_bad
    from jsonb_each(p_ranks) e
   where jsonb_typeof(e.value) <> 'number'
      or (e.value #>> '{}') !~ '^[0-9]+$';
  if v_bad > 0 then
    raise exception 'every rank must be a whole number';
  end if;

  -- Every key must be a contestant actually entered in this event. This is what
  -- stops one event's sheet carrying another event's unit.
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
    -- The field, which is what the dropdown is built from. Counted here rather than
    -- taken from the payload: a sheet ranking three of thirty must still be measured
    -- against thirty, or the bound would tighten as the judge eliminated more people.
    select count(*) into v_units
      from entry_participants ep
      join entries en on en.id = ep.entry_id
     where en.event_id = p_event_id;

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

    -- N5: every qualifier, once each, no blanks. Checked in both directions — a
    -- missing unit and a stray one are different mistakes, and a count alone
    -- would let them cancel out.
    select count(*) into v_bad
      from round2_qualifiers q
     where q.event_id = p_event_id
       and not jsonb_exists(p_ranks, q.participant_id::text);
    if v_bad > 0 then
      raise exception 'round 2 must rank every qualifier';
    end if;

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

  -- Replace rather than merge: the sheet on the judge's screen is the whole
  -- truth of that sheet, and a rank cleared there must be cleared here.
  delete from judge_ranks where sheet_id = v_sheet_id;

  insert into judge_ranks (sheet_id, entry_id, participant_id, rank)
  select v_sheet_id, en.id, k::uuid, (p_ranks ->> k)::int
    from jsonb_object_keys(p_ranks) k
    join entry_participants ep on ep.participant_id = k::uuid
    join entries en on en.id = ep.entry_id and en.event_id = p_event_id;

  -- Non-negotiable 7: who and when, for a submission as much as for a lock.
  update judge_sheets
     set submitted_at = now(),
         submitted_by = auth.uid(),
         entered_by   = auth.uid(),
         updated_at   = now()
   where id = v_sheet_id;
end;
$fn$;

revoke all on function judging_write_sheet(uuid, int, uuid, jsonb) from public;
grant execute on function judging_write_sheet(uuid, int, uuid, jsonb) to authenticated;
