-- Press Link: a move names the coach, and says so on the record.
--
-- 0034 moved a contestant between events and carried whatever coach pairing the
-- source entry held. Two things were missing from it, and both are the same
-- omission seen from different ends: the admin could not say who coaches the
-- contestant in the contest they are being moved into, and nothing anywhere
-- recorded that the move happened at all.
--
-- The second is the more serious. `activity_events` (0024) is the division's
-- account of who changed what, and 0025's triggers cover a school's own writes to
-- participants, coaches, entries, papers and locks. A move writes none of those
-- except incidentally — the entry it creates and the entry it empties each fire
-- their own trigger — so the record would show an entry appearing and another
-- vanishing, with nothing to say they were the same contestant walking from one to
-- the other, and no row naming the correction as a correction. An admin write that
-- leaves no trace is the one kind of write an audit log must not miss.
--
-- WHAT THIS CHANGES
--
--   1. `activity_events_kind_check` gains `'participant-moved'`. 0024 anticipated
--      exactly this — "a later migration that has to widen the vocabulary has a
--      name it can rely on" — and this is the first one to use it.
--   2. `admin_move_participant_event` takes `p_coach_id` and writes the log row.
--
-- WHY THE OLD SIGNATURE IS DROPPED
--
-- Adding a parameter with a default creates an overload rather than replacing the
-- function, and PostgREST resolves an RPC by the argument names a request carries.
-- Two candidates differing only by an optional column is a call that resolves one
-- way today and the other way after a client changes. The four-argument form is
-- dropped so there is one function with one meaning.
--
-- WHY THE COACH IS OPTIONAL
--
-- Null means "carry whoever the source entry had", which is 0034's behaviour and
-- the right default: the coach who prepared this contestant is usually the coach
-- who still coaches them. A value means the admin chose from that school's own
-- roster, and it is checked against that school — a coach from another school on
-- an entry would be a worse mistake than the one being corrected.
--
-- Onto a group entry the two cases stay different on purpose. A carried coach is
-- added only to an entry that has none, because a team's coaches are the team's and
-- a move should not quietly append to them. A chosen coach is added whenever the
-- entry is under its cap of two, because choosing is not something that happens by
-- accident.
--
-- WHAT THIS DOES NOT TOUCH: no table, no policy, no trigger, no row. The move's
-- own rules — ownership, the participation caps, the destination maximum, the
-- source minimum, the rank discard and its confirmation — are carried over from
-- 0034 unchanged.
--
-- Safe to re-run: the constraint is dropped and re-added by name, the drop is
-- `if exists`, and the create is `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. One more thing the log can say
-- ---------------------------------------------------------------------------

alter table activity_events drop constraint if exists activity_events_kind_check;
alter table activity_events add constraint activity_events_kind_check
  check (kind in (
    'participant-added',
    'participant-removed',
    'participant-moved',
    'coach-added',
    'coach-removed',
    'entry-submitted',
    'entry-withdrawn',
    'paper-updated',
    'paper-answered',
    'submission-locked'
  ));

-- ---------------------------------------------------------------------------
-- 2. The move, with a coach and a record of itself
-- ---------------------------------------------------------------------------

drop function if exists admin_move_participant_event(uuid, uuid, uuid, boolean);

create or replace function admin_move_participant_event(
  p_participant_id uuid,
  p_from_entry_id uuid,
  p_to_event_id uuid,
  p_discard_ranks boolean default false,
  p_coach_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_school_id        uuid;
  v_from_event_id    uuid;
  v_from_category    text;
  v_from_min         int;
  v_from_name        text;
  v_to_category      text;
  v_to_max           int;
  v_to_name          text;
  v_to_entry_id      uuid;
  v_to_entry_created boolean := false;
  v_members          int;
  v_to_members       int;
  v_to_coaches       int;
  v_individual       int;
  v_group            int;
  v_coach_id         uuid;
  v_coach_chosen     boolean := p_coach_id is not null;
  v_coach_carried    boolean := false;
  v_ranks            int := 0;
  v_source_deleted   boolean := false;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  -- The source entry, locked for the length of this transaction. Two admins on the
  -- same contestant would otherwise both read a member count of one and both delete
  -- the entry the other is moving out of.
  select e.school_id, e.event_id, ev.category, et.min_participants, ev.name
    into v_school_id, v_from_event_id, v_from_category, v_from_min, v_from_name
    from entries e
    join events ev on ev.id = e.event_id
    join event_types et on et.id = ev.event_type_id
   where e.id = p_from_entry_id
     for update of e;

  if v_school_id is null then
    raise exception 'entry not found';
  end if;

  if not exists (
    select 1 from entry_participants
     where entry_id = p_from_entry_id and participant_id = p_participant_id
  ) then
    raise exception 'that contestant is not on this entry';
  end if;

  -- The contestant must belong to the school that filed the entry. Not a formality:
  -- it is what stops a move being used to walk somebody into another school's team.
  if not exists (
    select 1 from participants
     where id = p_participant_id and school_id = v_school_id
  ) then
    raise exception 'that contestant is not on this entry''s school roster';
  end if;

  -- The same rule for the coach, and for the same reason. A coach from another
  -- school on this entry would be a worse mistake than the one being corrected.
  if p_coach_id is not null and not exists (
    select 1 from coaches where id = p_coach_id and school_id = v_school_id
  ) then
    raise exception 'that coach is not on this school''s roster';
  end if;

  if p_to_event_id = v_from_event_id then
    raise exception 'that contestant is already in this event';
  end if;

  select ev.category, et.max_participants, ev.name
    into v_to_category, v_to_max, v_to_name
    from events ev
    join event_types et on et.id = ev.event_type_id
   where ev.id = p_to_event_id;

  if v_to_category is null then
    raise exception 'destination event not found';
  end if;

  -- The caps, counted over every other entry this contestant holds. The source is
  -- excluded because moving one of two individual entries does not make a third.
  select
    count(*) filter (where ev.category = 'individual'),
    count(*) filter (where ev.category = 'group')
    into v_individual, v_group
    from entry_participants ep
    join entries e on e.id = ep.entry_id
    join events ev on ev.id = e.event_id
   where ep.participant_id = p_participant_id
     and ep.entry_id <> p_from_entry_id;

  if v_to_category = 'individual' and v_individual >= 2 then
    raise exception 'that contestant is already in 2 individual events';
  end if;
  if v_to_category = 'group' and v_group >= 1 then
    raise exception 'that contestant is already in a group event';
  end if;

  select count(*) into v_members
    from entry_participants where entry_id = p_from_entry_id;

  -- Emptied is fine and the entry goes with them; short of the minimum is not.
  if v_members - 1 > 0 and v_members - 1 < v_from_min then
    raise exception '% needs at least % contestants and would be left with %',
      v_from_name, v_from_min, v_members - 1;
  end if;

  -- The destination entry, created if the school has none for that contest.
  select id into v_to_entry_id
    from entries
   where school_id = v_school_id and event_id = p_to_event_id
     for update;

  if v_to_entry_id is null then
    insert into entries (school_id, event_id) values (v_school_id, p_to_event_id)
    returning id into v_to_entry_id;
    v_to_entry_created := true;
  else
    if exists (
      select 1 from entry_participants
       where entry_id = v_to_entry_id and participant_id = p_participant_id
    ) then
      raise exception 'that contestant is already entered in the destination event';
    end if;

    select count(*) into v_to_members
      from entry_participants where entry_id = v_to_entry_id;

    if v_to_max is not null and v_to_members + 1 > v_to_max then
      raise exception 'the destination entry already holds its maximum of % contestants', v_to_max;
    end if;
  end if;

  -- Ranks cast on the field this move changes. Counted before anything is written,
  -- so the refusal below can name the number the caller is being asked about.
  select count(*) into v_ranks
    from judge_ranks r
    join judge_sheets s on s.id = r.sheet_id
   where s.event_id = v_from_event_id
     and r.participant_id = p_participant_id;

  if v_ranks > 0 and not p_discard_ranks then
    raise exception 'that contestant has % ranks on file in %; confirm the discard first',
      v_ranks, v_from_name;
  end if;

  if v_ranks > 0 then
    delete from judge_ranks r
     using judge_sheets s
     where r.sheet_id = s.id
       and s.event_id = v_from_event_id
       and r.participant_id = p_participant_id;

    -- A qualifier row drawn from a rank that no longer exists would keep a
    -- contestant on round 2's board for a contest they have left.
    delete from round2_qualifiers
     where event_id = v_from_event_id and participant_id = p_participant_id;
  end if;

  -- Whoever the admin named, or the coach the source entry paired with them.
  select coach_id into v_coach_id
    from entry_coaches
   where entry_id = p_from_entry_id and participant_id = p_participant_id
   limit 1;

  v_coach_id := coalesce(p_coach_id, v_coach_id);

  delete from entry_coaches
   where entry_id = p_from_entry_id and participant_id = p_participant_id;

  delete from entry_participants
   where entry_id = p_from_entry_id and participant_id = p_participant_id;

  if v_members - 1 = 0 then
    -- Nothing is left of it. entry_participants and entry_coaches cascade from
    -- entries (0001), so the delete below takes the shared coaches of an emptied
    -- group entry with it.
    delete from judge_ranks r
     using judge_sheets s
     where r.sheet_id = s.id
       and s.event_id = v_from_event_id
       and r.entry_id = p_from_entry_id;
    delete from round2_qualifiers
     where event_id = v_from_event_id and entry_id = p_from_entry_id;
    delete from entries where id = p_from_entry_id;
    v_source_deleted := true;
  end if;

  insert into entry_participants (entry_id, participant_id)
       values (v_to_entry_id, p_participant_id);

  if v_coach_id is not null then
    if v_to_category = 'individual' then
      -- One coach per contestant (0019). The delete covers a destination entry that
      -- somehow already pairs somebody with this contestant, so the insert cannot
      -- produce two.
      delete from entry_coaches
       where entry_id = v_to_entry_id and participant_id = p_participant_id;
      insert into entry_coaches (entry_id, coach_id, participant_id)
           values (v_to_entry_id, v_coach_id, p_participant_id);
      v_coach_carried := true;
    elsif not exists (
      select 1 from entry_coaches where entry_id = v_to_entry_id and coach_id = v_coach_id
    ) then
      select count(*) into v_to_coaches
        from entry_coaches where entry_id = v_to_entry_id;

      -- A team's coaches are shared and unpaired. A carried one joins only an entry
      -- with none at all; a chosen one joins any entry under the cap of two, because
      -- choosing is not something that happens by accident.
      if (v_coach_chosen and v_to_coaches < 2) or v_to_coaches = 0 then
        insert into entry_coaches (entry_id, coach_id, participant_id)
             values (v_to_entry_id, v_coach_id, null);
        v_coach_carried := true;
      end if;
    end if;
  end if;

  update entries set updated_at = now() where id in (v_to_entry_id, p_from_entry_id);

  -- The record. Written here rather than by a trigger because no table this touches
  -- knows the move happened: `entry_participants` has no trigger, and the two that
  -- do fire see an entry appearing and another emptying, which is the consequence
  -- and not the act. The label carries both events, so the row is legible with
  -- nothing joined to it — the same reason 0025 denormalises a learner's name.
  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
       values (
         activity_session_id(),
         auth.uid(),
         v_school_id,
         'participant-moved',
         p_participant_id,
         nullif(btrim(coalesce(v_from_name, 'an event')), '') || ' → ' ||
           nullif(btrim(coalesce(v_to_name, 'another event')), '')
       );

  -- Returned rather than raised: none of it is a failure, and all of it is something
  -- the admin has to be told happened.
  return jsonb_build_object(
    'toEntryId', v_to_entry_id,
    'destinationEntryCreated', v_to_entry_created,
    'sourceEntryDeleted', v_source_deleted,
    'coachCarried', v_coach_carried,
    'coachChosen', v_coach_chosen,
    'ranksDiscarded', v_ranks
  );
end;
$fn$;

revoke all on function admin_move_participant_event(uuid, uuid, uuid, boolean, uuid) from public;
grant execute on function admin_move_participant_event(uuid, uuid, uuid, boolean, uuid) to authenticated;

comment on function admin_move_participant_event(uuid, uuid, uuid, boolean, uuid) is
  'Moves one contestant from one entry to the school''s entry for another event, creating that entry if it does not exist and deleting the source entry when it empties. Admin only. Re-checks ownership, the participation caps, the destination maximum and the source minimum, and that any named coach is on the same school''s roster. Discards the contestant''s ranks and qualifier row in the source event, but only when p_discard_ranks is set. p_coach_id names the coach for the destination entry; null carries the source entry''s pairing. Writes one activity_events row of kind participant-moved.';
