-- Press Link: an admin enters one contestant a school never entered.
--
-- 0034 moves a contestant between events. It cannot help the learner who is on the
-- roster and in nothing at all — the school closed before it filed, or filed the
-- other three and forgot this one. That correction has the same shape as a move
-- with no source: pick the contest, pick the coach, write the entry.
--
-- WHAT THIS ADDS
--
--   1. `'participant-entered'` in the kind vocabulary, for the same reason 0035
--      added `'participant-moved'`: an admin write that leaves no trace is the one
--      kind an audit log must not miss. Adding a contestant to a school's *existing*
--      entry touches no table 0025 watches, so without this the act would be
--      invisible.
--   2. `admin_assign_participant_event`.
--
-- WHY A TEAM CANNOT BE STARTED THIS WAY
--
-- Every group contest is a team of seven, bar Online Publishing at two or more. One
-- contestant cannot start one: the entry would sit below its own minimum from the
-- moment it was created, and every later edit the school made would be refused for
-- a reason nobody typed. So a group event is accepted only where the school already
-- holds that entry with room in it — genuinely "add one more to the team" — and
-- refused otherwise. Assembling a team is the school's work, and a function that let
-- an admin start one would be a second entry wizard rather than a correction.
--
-- An individual contest has a minimum of one, so it is created freely.
--
-- WHAT IT REFUSES
--
--   * a caller who is not in admin_profiles
--   * a contestant already entered in that event
--   * a destination past the participation caps (2 individual, 1 group)
--   * an entry already at its event's maximum
--   * starting an entry whose minimum is more than one
--   * a coach from another school
--
-- WHAT IT DOES NOT DO: it never discards a rank, because nothing is being taken out
-- of a field. A contestant added to an event a judge has already ranked simply
-- arrives unranked, and the screen says so before the click.
--
-- Safe to re-run: the constraint is dropped and re-added by name, and the function
-- is `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. One more thing the log can say
-- ---------------------------------------------------------------------------

alter table activity_events drop constraint if exists activity_events_kind_check;
alter table activity_events add constraint activity_events_kind_check
  check (kind in (
    'participant-added',
    'participant-removed',
    'participant-moved',
    'participant-entered',
    'coach-added',
    'coach-removed',
    'entry-submitted',
    'entry-withdrawn',
    'paper-updated',
    'paper-answered',
    'submission-locked'
  ));

-- ---------------------------------------------------------------------------
-- 2. The entry an admin files on a school's behalf
-- ---------------------------------------------------------------------------

create or replace function admin_assign_participant_event(
  p_participant_id uuid,
  p_event_id uuid,
  p_coach_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_school_id     uuid;
  v_category      text;
  v_min           int;
  v_max           int;
  v_event_name    text;
  v_entry_id      uuid;
  v_entry_created boolean := false;
  v_members       int;
  v_coaches       int;
  v_individual    int;
  v_group         int;
  v_coach_set     boolean := false;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select school_id into v_school_id from participants where id = p_participant_id;
  if v_school_id is null then
    raise exception 'contestant not found';
  end if;

  select ev.category, et.min_participants, et.max_participants, ev.name
    into v_category, v_min, v_max, v_event_name
    from events ev
    join event_types et on et.id = ev.event_type_id
   where ev.id = p_event_id;

  if v_category is null then
    raise exception 'event not found';
  end if;

  -- The same rule the move applies, and for the same reason: a coach from another
  -- school on this entry would be a worse mistake than the one being corrected.
  if p_coach_id is not null and not exists (
    select 1 from coaches where id = p_coach_id and school_id = v_school_id
  ) then
    raise exception 'that coach is not on this school''s roster';
  end if;

  -- The caps, over everything this contestant already holds. Nothing is being
  -- vacated here, so unlike a move there is no entry to exclude.
  select
    count(*) filter (where ev.category = 'individual'),
    count(*) filter (where ev.category = 'group')
    into v_individual, v_group
    from entry_participants ep
    join entries e on e.id = ep.entry_id
    join events ev on ev.id = e.event_id
   where ep.participant_id = p_participant_id;

  if v_category = 'individual' and v_individual >= 2 then
    raise exception 'that contestant is already in 2 individual events';
  end if;
  if v_category = 'group' and v_group >= 1 then
    raise exception 'that contestant is already in a group event';
  end if;

  select id into v_entry_id
    from entries
   where school_id = v_school_id and event_id = p_event_id
     for update;

  if v_entry_id is null then
    -- See the header: one contestant cannot open an entry that needs several.
    if v_min > 1 then
      raise exception '% needs at least % contestants, so this entry cannot be started with one; the school files it',
        v_event_name, v_min;
    end if;

    insert into entries (school_id, event_id) values (v_school_id, p_event_id)
    returning id into v_entry_id;
    v_entry_created := true;
  else
    if exists (
      select 1 from entry_participants
       where entry_id = v_entry_id and participant_id = p_participant_id
    ) then
      raise exception 'that contestant is already entered in this event';
    end if;

    select count(*) into v_members
      from entry_participants where entry_id = v_entry_id;

    if v_max is not null and v_members + 1 > v_max then
      raise exception 'that entry already holds its maximum of % contestants', v_max;
    end if;
  end if;

  insert into entry_participants (entry_id, participant_id)
       values (v_entry_id, p_participant_id);

  if p_coach_id is not null then
    if v_category = 'individual' then
      -- One coach per contestant (0019). The delete covers an entry that somehow
      -- already pairs somebody with them, so the insert cannot produce two.
      delete from entry_coaches
       where entry_id = v_entry_id and participant_id = p_participant_id;
      insert into entry_coaches (entry_id, coach_id, participant_id)
           values (v_entry_id, p_coach_id, p_participant_id);
      v_coach_set := true;
    elsif not exists (
      select 1 from entry_coaches where entry_id = v_entry_id and coach_id = p_coach_id
    ) then
      select count(*) into v_coaches
        from entry_coaches where entry_id = v_entry_id;

      -- 0036's rule, unchanged: a team's coaches are the team's, and one is added
      -- only where the entry would otherwise have none.
      if v_coaches = 0 then
        insert into entry_coaches (entry_id, coach_id, participant_id)
             values (v_entry_id, p_coach_id, null);
        v_coach_set := true;
      end if;
    end if;
  end if;

  update entries set updated_at = now() where id = v_entry_id;

  -- The record. A new entry also fires 0025's `entry-submitted` trigger, but adding
  -- a contestant to an entry that already exists touches nothing that is watched, so
  -- this row is the only trace either way — and it is the one keyed to the person.
  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
       values (
         activity_session_id(),
         auth.uid(),
         v_school_id,
         'participant-entered',
         p_participant_id,
         nullif(btrim(coalesce(v_event_name, '')), '')
       );

  return jsonb_build_object(
    'entryId', v_entry_id,
    'entryCreated', v_entry_created,
    'coachSet', v_coach_set
  );
end;
$fn$;

revoke all on function admin_assign_participant_event(uuid, uuid, uuid) from public;
grant execute on function admin_assign_participant_event(uuid, uuid, uuid) to authenticated;

comment on function admin_assign_participant_event(uuid, uuid, uuid) is
  'Enters one contestant in an event on their school''s behalf, creating the school''s entry when it has none. Admin only. Re-checks the participation caps, the entry maximum, and that any named coach is on the same school''s roster. Refuses to start an entry whose event needs more than one contestant — a team is the school''s to assemble. Writes one activity_events row of kind participant-entered.';
