-- Press Link: an admin moves one contestant from the event a school entered them
-- in to the event they belong in.
--
-- The mistake is a school's: a learner filed under News Writing who was meant to be
-- in Editorial Writing. Until now the only fix was to reopen the school — lift the
-- division-wide lock for all 336 of them, or grant that one school a revision window
-- (0031) and wait for it to redo the entry itself. The grant is the right tool when a
-- school has several things to correct. It is far too heavy for one contestant in the
-- wrong contest, and it hands the correction back to the party that got it wrong.
--
-- So: one function, one contestant, one move.
--
-- WHAT THIS ADDS
--
--   1. `admin_move_participant_event`, and nothing else. No table, no column, no
--      policy, no trigger.
--
-- WHY A FUNCTION AND NOT A POLICY
--
-- 0001 gives admins `select` on entries and entry_participants and nothing more;
-- every write to those tables is a school's own, fenced by RLS and by 0011's lock
-- triggers. Widening that to `for all` would hand an admin session unaudited write
-- access to every entry in the division to fix a typo. A `security definer` function
-- is the narrow opening: it does this one thing, checks every rule itself, and the
-- policies stay exactly as they were.
--
-- The lock triggers need no exemption. `reject_locked_submission` and its siblings
-- fire only when `schools.auth_user_id = auth.uid()` — they refuse *a school's own*
-- write while it is locked, and have never had anything to say about an admin's.
--
-- WHAT IT REFUSES
--
--   * a caller who is not in admin_profiles
--   * an entry that is not this participant's, or a participant not in it
--   * a destination equal to the source, or one the school already entered this
--     contestant in
--   * a destination past the participation caps (2 individual, 1 group — the same
--     numbers as lib/roster/limits.ts, which is where a screen reads them from)
--   * a destination entry already at its event's maximum
--   * a source entry that would be left below its event's minimum but not emptied.
--     A team of seven dropping to six is a broken entry, and quietly leaving one is
--     worse than refusing: the school's own form would then refuse every later edit
--     for a reason nobody typed.
--
-- WHAT IT DISCARDS, AND WHY IT IS ASKED FIRST
--
-- If a judge has ranked in the source event, that rank was cast on a field this move
-- changes. The rank is deleted, along with any round-2 qualifier row drawn from it,
-- because a rank for a contestant no longer in the event would go on counting toward
-- a placement in a contest they are not in. That is destructive and cannot be undone
-- from the page, so it happens only when the caller passes `p_discard_ranks`, which
-- the dialog sets after printing what will be discarded. Without it the move is
-- refused, by design, and the refusal names the count.
--
-- WHAT IT CARRIES
--
-- The coach. On an individual entry every contestant has exactly one coach paired
-- with them (0019), so a move that left the pairing behind would produce a
-- destination entry the school's own form calls invalid. The pairing follows the
-- contestant. Onto a group entry it follows only as an unpaired coach, and only if
-- the destination has none — a team's coaches are shared, and are the receiving
-- school's to name.
--
-- Safe to re-run: `create or replace`.

create or replace function admin_move_participant_event(
  p_participant_id uuid,
  p_from_entry_id uuid,
  p_to_event_id uuid,
  p_discard_ranks boolean default false
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
  v_to_entry_id      uuid;
  v_to_entry_created boolean := false;
  v_members          int;
  v_to_members       int;
  v_individual       int;
  v_group            int;
  v_coach_id         uuid;
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

  if p_to_event_id = v_from_event_id then
    raise exception 'that contestant is already in this event';
  end if;

  select ev.category, et.max_participants
    into v_to_category, v_to_max
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

  -- The coach pairing follows the contestant off an individual entry.
  select coach_id into v_coach_id
    from entry_coaches
   where entry_id = p_from_entry_id and participant_id = p_participant_id
   limit 1;

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
      insert into entry_coaches (entry_id, coach_id, participant_id)
           values (v_to_entry_id, v_coach_id, p_participant_id);
      v_coach_carried := true;
    elsif not exists (select 1 from entry_coaches where entry_id = v_to_entry_id) then
      -- A team's coaches are shared and unpaired. One is carried only to keep a
      -- brand-new entry from having none at all; an entry that already names its
      -- coaches keeps them.
      insert into entry_coaches (entry_id, coach_id, participant_id)
           values (v_to_entry_id, v_coach_id, null);
      v_coach_carried := true;
    end if;
  end if;

  update entries set updated_at = now() where id in (v_to_entry_id, p_from_entry_id);

  -- Returned rather than raised: none of it is a failure, and all of it is something
  -- the admin has to be told happened.
  return jsonb_build_object(
    'toEntryId', v_to_entry_id,
    'destinationEntryCreated', v_to_entry_created,
    'sourceEntryDeleted', v_source_deleted,
    'coachCarried', v_coach_carried,
    'ranksDiscarded', v_ranks
  );
end;
$fn$;

revoke all on function admin_move_participant_event(uuid, uuid, uuid, boolean) from public;
grant execute on function admin_move_participant_event(uuid, uuid, uuid, boolean) to authenticated;

comment on function admin_move_participant_event(uuid, uuid, uuid, boolean) is
  'Moves one contestant from one entry to the school''s entry for another event, creating that entry if it does not exist and deleting the source entry when it empties. Admin only. Re-checks ownership, the participation caps, the destination maximum and the source minimum. Discards the contestant''s ranks and qualifier row in the source event, but only when p_discard_ranks is set — without it a move out of a ranked event is refused. Carries the coach pairing with the contestant.';
