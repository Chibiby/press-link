-- Press Link: a coach joins a team only when the team has none.
--
-- 0035 gave the move an optional coach and drew a distinction inside it: a coach
-- *carried* from the source entry joined a group entry only when that entry had no
-- coaches, while a coach the admin had *chosen* joined any group entry under its cap
-- of two. The reasoning was that choosing is deliberate and carrying is not.
--
-- That distinction does not survive contact with the form it was written for. The
-- dialog now defaults the select to whoever coaches the contestant today — which is
-- the right default, and it is the correction this migration follows — so every move
-- arrives carrying a chosen coach, and the "chosen" branch became the only branch.
-- The effect would have been to append a coach to a team's roster every time one
-- contestant was moved into it, which nobody asked for and no screen said would
-- happen.
--
-- So the rule loses its exception and gains its real justification: a team's coaches
-- are the team's to name, and a move adds one only when the entry would otherwise
-- have none — the one case where the alternative is an entry the school's own form
-- refuses. An individual entry is untouched by this: it pairs exactly one coach with
-- each contestant (0019), and that pairing is what the move sets.
--
-- WHAT THIS CHANGES: one branch of `admin_move_participant_event`. The signature,
-- every check, the rank discard, the activity row and the individual-entry pairing
-- are carried over from 0035 unchanged — the body is restated whole only because
-- `create or replace` cannot patch a fragment.
--
-- WHAT THIS DOES NOT TOUCH: no table, no column, no policy, no trigger, no row.
--
-- Safe to re-run: `create or replace`.

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

      -- A team's coaches are shared and unpaired, and they are the team's to name.
      -- So a coach joins a group entry only when it has none at all, which is the
      -- case where the alternative is an entry no form will accept. Whether the
      -- coach was carried or chosen makes no difference here: neither is a reason to
      -- grow a team's coach list as a side effect of moving one contestant into it.
      if v_to_coaches = 0 then
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
