-- Press Link: the division office can add to a school's roster, and file an
-- entry, on that school's behalf.
--
-- 0037 enters one existing learner in one contest. It cannot help the school that
-- never got its people onto the roster at all — the one that missed the deadline,
-- or lost its login, or sent the list on paper. Until now the office's only answer
-- was to reopen that school and wait, which is the right tool for a school that can
-- still do the work and no use at all for one that cannot.
--
-- WHAT THIS ADDS
--
--   1. `admin_add_participant`
--   2. `admin_add_coach`
--   3. `admin_create_entry`
--
-- No table, no column, no policy, no trigger. As with 0034, the alternative was to
-- widen the admin policies on `participants`, `coaches`, `entries`,
-- `entry_participants` and `entry_coaches` from `select` to `for all`, which is five
-- tables of unaudited write access across the whole division in order to type in one
-- school's list. Three functions that each do one thing and check it themselves are
-- the narrower opening.
--
-- WHAT LOGS ITSELF
--
-- The first two need no logging of their own: 0025's triggers already stamp
-- `participant-added` and `coach-added` on insert, whoever inserts. `admin_create_entry`
-- writes one `participant-entered` row per contestant on top of the `entry-submitted`
-- its insert triggers, for 0037's reason — an entry row is keyed to the entry, and a
-- contestant's own history has to be able to answer "how did they end up in this".
--
-- WHY THE ENTRY IS ALL-OR-NOTHING
--
-- `admin_create_entry` files a *complete* entry: the contestants and their coaches,
-- checked against the event's minimum, its maximum, and 0019's rule that an
-- individual entry pairs exactly one coach with each contestant. It refuses to add
-- to an entry that already exists — that is `admin_assign_participant_event`, which
-- adds one contestant to a filed entry — so the two cannot both half-write the same
-- row. An entry that satisfies none of the school's own rules is worse than no
-- entry: it is one the school's form will refuse to edit, for a reason nobody typed.
--
-- WHAT IT DOES NOT DO
--
-- No paper gate. A school must answer the school-paper question before it may build
-- its own roster (0004), because that answer is the school's decision to make. It is
-- not a fact about the data, and an office typing in a list on the phone should not
-- be held behind a question it cannot answer for them.
--
-- Safe to re-run: all three are `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. A learner on a school's roster
-- ---------------------------------------------------------------------------
-- `participant_number` is left to the column default, which is the division-wide
-- sequence from 0004: the number has to be unique across the division and is the
-- one thing about a contestant a judge ever sees.
create or replace function admin_add_participant(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_gender text,
  p_middle_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from schools where id = p_school_id) then
    raise exception 'school not found';
  end if;

  -- Trimmed and checked here as well as in the action. A name that is only spaces
  -- passes a NOT NULL and is unreadable on every list it appears on afterwards.
  if coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'a first name and a last name are required';
  end if;

  if p_gender is null or p_gender not in ('M', 'F') then
    raise exception 'gender must be M or F';
  end if;

  insert into participants (school_id, first_name, middle_name, last_name, gender)
       values (
         p_school_id,
         btrim(p_first_name),
         nullif(btrim(coalesce(p_middle_name, '')), ''),
         btrim(p_last_name),
         p_gender
       )
    returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function admin_add_participant(uuid, text, text, text, text) from public;
grant execute on function admin_add_participant(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A coach on a school's roster
-- ---------------------------------------------------------------------------
create or replace function admin_add_coach(
  p_school_id uuid,
  p_first_name text,
  p_last_name text,
  p_gender text,
  p_middle_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if not exists (select 1 from schools where id = p_school_id) then
    raise exception 'school not found';
  end if;

  if coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'a first name and a last name are required';
  end if;

  if p_gender is null or p_gender not in ('M', 'F') then
    raise exception 'gender must be M or F';
  end if;

  insert into coaches (school_id, first_name, middle_name, last_name, gender)
       values (
         p_school_id,
         btrim(p_first_name),
         nullif(btrim(coalesce(p_middle_name, '')), ''),
         btrim(p_last_name),
         p_gender
       )
    returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function admin_add_coach(uuid, text, text, text, text) from public;
grant execute on function admin_add_coach(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A whole entry, filed for a school
-- ---------------------------------------------------------------------------
-- `p_coaches` is `[{"coachId": uuid, "participantId": uuid|null}]` — the same shape
-- the school's own form posts, because it encodes the same rule: an individual entry
-- pairs a coach with each contestant, a group entry's coaches are shared and paired
-- with nobody (0019).
create or replace function admin_create_entry(
  p_school_id uuid,
  p_event_id uuid,
  p_participants uuid[],
  p_coaches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category   text;
  v_min        int;
  v_max        int;
  v_event_name text;
  v_entry_id   uuid;
  v_count      int;
  v_bad        int;
  v_pid        uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select ev.category, et.min_participants, et.max_participants, ev.name
    into v_category, v_min, v_max, v_event_name
    from events ev
    join event_types et on et.id = ev.event_type_id
   where ev.id = p_event_id;

  if v_category is null then
    raise exception 'event not found';
  end if;

  if not exists (select 1 from schools where id = p_school_id) then
    raise exception 'school not found';
  end if;

  -- One entry per event per school, which is the school's own rule. Adding to an
  -- entry that exists is admin_assign_participant_event's job, and two functions
  -- that could both half-write the same row is how one of them leaves it invalid.
  if exists (select 1 from entries where school_id = p_school_id and event_id = p_event_id) then
    raise exception 'this school already has a % entry; add to it instead', v_event_name;
  end if;

  if p_participants is null or array_length(p_participants, 1) is null then
    raise exception 'an entry needs at least one contestant';
  end if;

  select count(*) into v_count from (select distinct unnest(p_participants)) d;
  if v_count <> array_length(p_participants, 1) then
    raise exception 'the same contestant cannot be added twice';
  end if;

  if v_count < v_min then
    raise exception '% needs at least % contestants', v_event_name, v_min;
  end if;
  if v_max is not null and v_count > v_max then
    raise exception '% allows at most % contestants', v_event_name, v_max;
  end if;

  -- Everyone named must be on this school's roster. This is what stops an entry
  -- being built out of another school's learners.
  select count(*) into v_bad
    from unnest(p_participants) k
   where not exists (
     select 1 from participants where id = k and school_id = p_school_id
   );
  if v_bad > 0 then
    raise exception 'a contestant is not on this school''s roster';
  end if;

  -- The participation caps, per contestant, over everything they already hold.
  select count(*) into v_bad
    from unnest(p_participants) k
   where (
     select count(*)
       from entry_participants ep
       join entries e on e.id = ep.entry_id
       join events ev on ev.id = e.event_id
      where ep.participant_id = k and ev.category = v_category
   ) >= case when v_category = 'individual' then 2 else 1 end;
  if v_bad > 0 then
    raise exception 'a contestant is already at the limit for % events', v_category;
  end if;

  if p_coaches is null or jsonb_typeof(p_coaches) <> 'array' or jsonb_array_length(p_coaches) < 1 then
    raise exception 'at least one coach is required';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_coaches) c
   where not exists (
     select 1 from coaches
      where id = (c ->> 'coachId')::uuid and school_id = p_school_id
   );
  if v_bad > 0 then
    raise exception 'a coach is not on this school''s roster';
  end if;

  if v_category = 'individual' then
    -- 0019: every contestant has a coach, and no contestant has two. Checked in both
    -- directions, because a missing pairing and a doubled one are different mistakes
    -- and a count alone would let them cancel out.
    select count(*) into v_bad
      from jsonb_array_elements(p_coaches) c
     where c ->> 'participantId' is null
        or not ((c ->> 'participantId')::uuid = any(p_participants));
    if v_bad > 0 then
      raise exception 'each coach must be matched to a contestant on this entry';
    end if;

    select count(*) into v_bad from (
      select c ->> 'participantId' as k
        from jsonb_array_elements(p_coaches) c
       group by 1 having count(*) > 1
    ) d;
    if v_bad > 0 then
      raise exception 'a contestant can have only one coach';
    end if;

    select count(*) into v_bad
      from unnest(p_participants) k
     where not exists (
       select 1 from jsonb_array_elements(p_coaches) c
        where (c ->> 'participantId')::uuid = k
     );
    if v_bad > 0 then
      raise exception 'choose a coach for every contestant';
    end if;
  else
    select count(*) into v_bad
      from jsonb_array_elements(p_coaches) c
     where c ->> 'participantId' is not null;
    if v_bad > 0 then
      raise exception 'a group entry''s coaches are shared by the team, not matched to one member';
    end if;

    if jsonb_array_length(p_coaches) > 2 then
      raise exception 'a group entry allows at most 2 coaches';
    end if;

    select count(*) into v_bad from (
      select c ->> 'coachId' as k
        from jsonb_array_elements(p_coaches) c
       group by 1 having count(*) > 1
    ) d;
    if v_bad > 0 then
      raise exception 'the same coach cannot be added twice';
    end if;
  end if;

  insert into entries (school_id, event_id) values (p_school_id, p_event_id)
  returning id into v_entry_id;

  insert into entry_participants (entry_id, participant_id)
  select v_entry_id, k from unnest(p_participants) k;

  insert into entry_coaches (entry_id, coach_id, participant_id)
  select v_entry_id, (c ->> 'coachId')::uuid, (c ->> 'participantId')::uuid
    from jsonb_array_elements(p_coaches) c;

  -- One row per contestant, beside the `entry-submitted` the insert above triggers.
  -- That row is keyed to the entry; these are keyed to the people, and a
  -- contestant's own history has to be able to answer how they ended up here.
  foreach v_pid in array p_participants loop
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
         values (
           activity_session_id(),
           auth.uid(),
           p_school_id,
           'participant-entered',
           v_pid,
           nullif(btrim(coalesce(v_event_name, '')), '')
         );
  end loop;

  return jsonb_build_object(
    'entryId', v_entry_id,
    'contestants', v_count
  );
end;
$fn$;

revoke all on function admin_create_entry(uuid, uuid, uuid[], jsonb) from public;
grant execute on function admin_create_entry(uuid, uuid, uuid[], jsonb) to authenticated;

comment on function admin_create_entry(uuid, uuid, uuid[], jsonb) is
  'Files one complete entry for a school: contestants and their coaches, checked against the event minimum and maximum, the participation caps, and 0019''s one-coach-per-contestant rule for an individual entry. Admin only. Refuses when the school already has an entry for that event — adding to one is admin_assign_participant_event. Writes one participant-entered activity row per contestant.';
