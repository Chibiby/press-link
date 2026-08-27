-- Two-stage ranking per event: a one-judge cut, then a three-judge placement.
--
-- Implements section 4 of
-- docs/superpowers/specs/2026-08-27-judges-portal-two-stage-ranking-design.md,
-- which supersedes the symmetric-panel contract 0018 was built against.
--
-- INDIVIDUAL EVENTS ONLY. Every function below refuses an event whose
-- `events.category` is not 'individual' (non-negotiable 6). Group events keep
-- exactly today's behaviour, which — since 0018 deliberately shipped no write
-- path — is "these tables are empty and nothing can write to them".
--
-- WHAT THIS DOES NOT TOUCH: schools, participants, coaches, entries,
-- entry_participants, entry_coaches, school_papers, districts, app_settings,
-- event_types. No statement writes to any of them. `events` gains no column;
-- `judge_sheets` and `event_rounds` gain columns and lose none. No existing row
-- of any table is deleted or rewritten by this migration.
--
-- Safe to re-run: every statement is guarded.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- Ties are now legal in both rounds (N3, N5). This index forbade two units
-- sharing a place on one sheet, which was correct under the old symmetric model
-- — a rank-sum over judges who each produced a strict order — and is wrong now
-- that a judge may deliberately type 1, 2, 2, 3.
--
-- `judge_ranks_unit_key` is untouched: one rank per unit per sheet is still an
-- invariant, and it is the backstop that stops a malformed payload ranking one
-- contestant twice.
drop index if exists judge_ranks_place_key;

comment on table judge_ranks is
  'One judge''s placement of one unit. Unique per unit per sheet. Two units MAY share a place: round 1 records the judge''s typed rank verbatim (N3) and round 2 allows ties within a judge''s own sheet (N5).';

-- Who actually typed a sheet, and who submitted it (N6, N9). `judge_id` says
-- whose opinion it is; `entered_by` says whose hands it was. They differ when an
-- admin enters on a judge's behalf at /admin/judges/[eventId].
alter table judge_sheets add column if not exists submitted_by uuid references auth.users(id);
alter table judge_sheets add column if not exists entered_by   uuid references auth.users(id);

comment on column judge_sheets.submitted_by is
  'The auth user who performed the submit. Kept separate from entered_by because submitting and entering are separate acts (N6) and only one of them is ever a judge''s own.';
comment on column judge_sheets.entered_by is
  'The auth user who typed the ranks. Differs from judge_id when an admin enters on the judge''s behalf (N9). Never write this over judge_id: whose opinion it is and whose hands it was are different facts.';

-- Round 1's lock is now a first-class, attributed act, separate from the close
-- that draws the qualifier list (N6). 0018 gave event_rounds
-- round1_closed_at/by and results_locked_at/by; round 1 needs its own lock pair,
-- and round 2 reuses the results pair.
alter table event_rounds add column if not exists round1_locked_at timestamptz;
alter table event_rounds add column if not exists round1_locked_by uuid references auth.users(id);

comment on column event_rounds.round1_locked_at is
  'Set = round 1 is read-only and round 2 is open (N6, N7). This, not round1_closed_at, is what the judge portal and lib/judging/sheet-state.ts read. An admin may clear it while round 2 is in progress; see admin_unlock_round1 (N8).';

-- ---------------------------------------------------------------------------
-- 2. The shared write path for a sheet
-- ---------------------------------------------------------------------------

-- `judge_submit_sheet` and `admin_enter_sheet` differ only in who may call them
-- and how the judge is identified. The validation is identical (N9, "two entry
-- paths, one sheet"), so it lives once here rather than twice below, where the
-- two copies would drift.
--
-- Not granted to anyone. It is a security-definer implementation detail reached
-- only through its two callers, each of which has already established who the
-- caller is.
--
-- p_ranks is a jsonb object keyed by `unitKey`, which for an individual event is
-- the participant id: {"<participant uuid>": 3, ...}. A blank is simply an
-- absent key (N2). Encoding a blank as an explicit null would give the payload
-- two ways to say "eliminated", and a client that picked the wrong one would be
-- rejected for the wrong reason.
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
  v_cut        int;
  v_seat       int;
  v_r1_locked  timestamptz;
  v_results    timestamptz;
  v_sheet_id   uuid;
  v_submitted  timestamptz;
  v_qcount     int;
  v_bad        int;
begin
  if p_round is null or p_round not in (1, 2) then
    raise exception 'invalid round';
  end if;

  select category, round2_cut into v_category, v_cut
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
    -- N2: the dropdown offers blank, 1 .. cut and nothing above the cut. That
    -- bound is what makes "scored" and "qualified" the same set, so it is
    -- enforced here rather than trusted to the client.
    select count(*) into v_bad
      from jsonb_each_text(p_ranks) e
     where e.value::int < 1 or e.value::int > v_cut;
    if v_bad > 0 then
      raise exception 'round 1 ranks must be between 1 and the cut';
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

-- ---------------------------------------------------------------------------
-- 3. Writing a sheet: the two entry paths
-- ---------------------------------------------------------------------------

-- The judge's own path. The judge id is looked up from the JWT rather than
-- accepted as an argument, so a judge cannot submit as a colleague.
create or replace function judge_submit_sheet(
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
  v_judge_id uuid;
begin
  select id into v_judge_id
    from judges where auth_user_id = auth.uid() and is_active;

  -- An inactive judge is not a judge — the same rule app/judge/guard.ts applies
  -- at the page, restated where it cannot be bypassed.
  if v_judge_id is null then
    raise exception 'not authorized';
  end if;

  perform judging_write_sheet(p_event_id, p_round, v_judge_id, p_ranks);
end;
$fn$;

revoke all on function judge_submit_sheet(uuid, int, jsonb) from public;
grant execute on function judge_submit_sheet(uuid, int, jsonb) to authenticated;

-- The N9 admin path: same sheet, same validation, different hands. `entered_by`
-- lands as the admin's user id inside judging_write_sheet, which is the whole
-- reason that column exists.
create or replace function admin_enter_sheet(
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
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  perform judging_write_sheet(p_event_id, p_round, p_judge_id, p_ranks);
end;
$fn$;

revoke all on function admin_enter_sheet(uuid, int, uuid, jsonb) from public;
grant execute on function admin_enter_sheet(uuid, int, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admin: the cut and the panel
-- ---------------------------------------------------------------------------

-- The cut decides how tall round 1's dropdown is, and therefore who can be
-- scored at all (N2). Moving it after the qualifier list exists would leave
-- round2_cut_used disagreeing with the list it produced, so it is refused once
-- round 1 is locked.
create or replace function admin_set_round2_cut(p_event_id uuid, p_cut int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  if p_cut is null or p_cut < 1 then
    raise exception 'cut must be at least 1';
  end if;

  if exists (
    select 1 from event_rounds
     where event_id = p_event_id and round1_locked_at is not null
  ) then
    raise exception 'round 1 is locked';
  end if;

  update events set round2_cut = p_cut where id = p_event_id;
end;
$fn$;

revoke all on function admin_set_round2_cut(uuid, int) from public;
grant execute on function admin_set_round2_cut(uuid, int) to authenticated;

-- N1 as a rule, not a convention: seat 1 is the round 1 judge, seats 2, 3 and 4
-- are the round 2 panel, and there is no fifth seat. The unique
-- (judge_id, event_id) from 0018 is what stops the judge who made the cut also
-- placing the winners; the explicit error below only says so in words, rather
-- than surfacing a constraint name to an admin.
create or replace function admin_assign_judge(p_event_id uuid, p_judge_id uuid, p_seat int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  if p_seat is null or p_seat not in (1, 2, 3, 4) then
    raise exception 'seat must be 1, 2, 3 or 4';
  end if;

  if not exists (select 1 from judges where id = p_judge_id and is_active) then
    raise exception 'judge not found or inactive';
  end if;

  if exists (
    select 1 from judge_assignments
     where event_id = p_event_id and judge_id = p_judge_id and seat <> p_seat
  ) then
    raise exception 'judge already seated on this event';
  end if;

  -- Reseating an occupied seat is the normal way an admin corrects a panel, so
  -- it replaces rather than raising. The displaced judge's sheets survive —
  -- judge_sheets keys on judge_id, not on the assignment — and stay visible to
  -- the admin, who can clear them deliberately.
  delete from judge_assignments where event_id = p_event_id and seat = p_seat;

  insert into judge_assignments (event_id, judge_id, seat)
       values (p_event_id, p_judge_id, p_seat);
end;
$fn$;

revoke all on function admin_assign_judge(uuid, uuid, int) from public;
grant execute on function admin_assign_judge(uuid, uuid, int) to authenticated;

-- Refused while that seat holds a submitted sheet. An empty seat whose ranks are
-- still on file is the one state that could feed a placement from a judge who is
-- no longer on the panel. The admin unlocks the sheet first, which is an
-- attributed act, rather than having this function silently discard ranks.
create or replace function admin_unassign_judge(p_event_id uuid, p_seat int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
  v_judge_id uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  select judge_id into v_judge_id
    from judge_assignments where event_id = p_event_id and seat = p_seat;

  -- An empty seat is already the requested state, not an error.
  if v_judge_id is null then
    return;
  end if;

  if exists (
    select 1 from judge_sheets
     where event_id = p_event_id and judge_id = v_judge_id and submitted_at is not null
  ) then
    raise exception 'this judge has a submitted sheet; unlock it first';
  end if;

  delete from judge_assignments where event_id = p_event_id and seat = p_seat;
end;
$fn$;

revoke all on function admin_unassign_judge(uuid, int) from public;
grant execute on function admin_unassign_judge(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin: the round 1 lock
-- ---------------------------------------------------------------------------

-- The qualifier list arrives already computed, from `round1Qualifiers` in
-- lib/judging/cut.ts (non-negotiable 3). This function does not decide who
-- advances and must never learn how — it checks that what it was handed is
-- well-formed and drawn from seat 1's sheet, then writes it down.
--
-- p_qualifiers is a jsonb array of QualifierRow, as in lib/judging/types.ts:
--   [{"participantId": "...", "round1Points": 3, "round1Rank": 3}, ...]
-- `entryId` is present in the TypeScript type and deliberately ignored here: the
-- entry a participant belongs to is a fact this database already holds, and
-- taking the client's word for it would let a payload file a rank against the
-- wrong entry.
create or replace function admin_lock_round1(p_event_id uuid, p_qualifiers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
  v_cut      int;
  v_sheet_id uuid;
  v_bad      int;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category, round2_cut into v_category, v_cut from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  if exists (
    select 1 from event_rounds
     where event_id = p_event_id and results_locked_at is not null
  ) then
    raise exception 'results are locked';
  end if;

  if exists (
    select 1 from event_rounds
     where event_id = p_event_id and round1_locked_at is not null
  ) then
    raise exception 'round 1 is already locked';
  end if;

  -- N1: one judge, and the lock cannot precede their submission.
  select s.id into v_sheet_id
    from judge_assignments a
    join judge_sheets s
      on s.event_id = a.event_id and s.judge_id = a.judge_id and s.round = 1
   where a.event_id = p_event_id
     and a.seat = 1
     and s.submitted_at is not null;

  if v_sheet_id is null then
    raise exception 'the round 1 judge has not submitted';
  end if;

  if p_qualifiers is null or jsonb_typeof(p_qualifiers) <> 'array' then
    raise exception 'qualifiers must be a json array';
  end if;

  -- Containment, not equality. Asserting that this list *is* the scored set
  -- would be re-implementing N2's cut rule in SQL, which non-negotiable 3
  -- forbids. Asserting that every row in it was in fact scored by seat 1 is a
  -- different and purely defensive claim, and it is the one that catches a
  -- malformed or forged payload.
  select count(*) into v_bad
    from jsonb_array_elements(p_qualifiers) q
   where q ->> 'participantId' is null
      or not exists (
        select 1 from judge_ranks r
         where r.sheet_id = v_sheet_id
           and r.participant_id = (q ->> 'participantId')::uuid
      );
  if v_bad > 0 then
    raise exception 'a qualifier was not scored in round 1';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(p_qualifiers) q
   where coalesce((q ->> 'round1Rank')::int, 0) < 1
      or coalesce((q ->> 'round1Points')::int, 0) < 1;
  if v_bad > 0 then
    raise exception 'every qualifier needs a round 1 rank and points';
  end if;

  select count(*) into v_bad from (
    select q ->> 'participantId' as k
      from jsonb_array_elements(p_qualifiers) q
     group by 1 having count(*) > 1
  ) d;
  if v_bad > 0 then
    raise exception 'a unit appears twice in the qualifier list';
  end if;

  -- Rewritten wholesale. On a re-lock after admin_unlock_round1 any previous
  -- list is stale by definition (N8).
  delete from round2_qualifiers where event_id = p_event_id;

  insert into round2_qualifiers (event_id, entry_id, participant_id, round1_points, round1_rank)
  select p_event_id,
         en.id,
         (q ->> 'participantId')::uuid,
         (q ->> 'round1Points')::int,
         (q ->> 'round1Rank')::int
    from jsonb_array_elements(p_qualifiers) q
    join entry_participants ep on ep.participant_id = (q ->> 'participantId')::uuid
    join entries en on en.id = ep.entry_id and en.event_id = p_event_id;

  -- N8, second half: a unit that is no longer a qualifier keeps no round 2
  -- ranks. Leaving them would let a stale rank re-enter a total if that unit
  -- qualified again on a later re-lock.
  delete from judge_ranks r
   using judge_sheets s
   where r.sheet_id = s.id
     and s.event_id = p_event_id
     and s.round = 2
     and not exists (
       select 1 from round2_qualifiers q
        where q.event_id = p_event_id and q.participant_id = r.participant_id
     );

  insert into event_rounds (event_id) values (p_event_id)
  on conflict (event_id) do nothing;

  -- round1_closed_at/by is 0018's column and still means "the qualifier list was
  -- drawn"; round1_locked_at/by is N6's separate, first-class lock. They are
  -- stamped together because this single act does both.
  update event_rounds
     set round1_locked_at = now(),
         round1_locked_by = auth.uid(),
         round1_closed_at = now(),
         round1_closed_by = auth.uid(),
         round2_cut_used  = v_cut
   where event_id = p_event_id;
end;
$fn$;

revoke all on function admin_lock_round1(uuid, jsonb) from public;
grant execute on function admin_lock_round1(uuid, jsonb) to authenticated;

-- N7 and N8. Round 1 may be reopened while round 2 is in progress, so this also
-- reopens round 2: editing round 1 can change who qualifies, and a round 2 sheet
-- submitted against the old qualifier list is no longer an answer to the
-- question being asked.
--
-- Refused while the results are locked, so no unlock can silently contradict a
-- published standing. The admin unlocks the results first, and that is recorded.
create or replace function admin_unlock_round1(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  if exists (
    select 1 from event_rounds
     where event_id = p_event_id and results_locked_at is not null
  ) then
    raise exception 'results are locked; unlock the results first';
  end if;

  -- The qualifier list goes with the lock that drew it, and so does the cut that
  -- produced the list: round2_cut_used exists to say which number produced the
  -- rows above it, and with those rows gone it would refer to nothing. The next
  -- lock stamps a fresh copy from events.round2_cut.
  delete from round2_qualifiers where event_id = p_event_id;

  update event_rounds
     set round1_locked_at = null,
         round1_locked_by = null,
         round1_closed_at = null,
         round1_closed_by = null,
         round2_cut_used  = null
   where event_id = p_event_id;

  -- Round 2's ranks are kept; only the submissions are cleared. A judge whose
  -- qualifier set comes back unchanged re-submits the same board in one click,
  -- and admin_lock_round1 deletes the ranks of anyone who dropped out.
  update judge_sheets
     set submitted_at = null,
         submitted_by = null,
         updated_at   = now()
   where event_id = p_event_id and round = 2 and submitted_at is not null;
end;
$fn$;

revoke all on function admin_unlock_round1(uuid) from public;
grant execute on function admin_unlock_round1(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin: the results lock
-- ---------------------------------------------------------------------------

-- The standings arrive already computed, from `finalStandings` in
-- lib/judging/standings.ts (non-negotiable 3). N4's arithmetic — round 1 rank
-- plus round 2 points, competition-ranked — is not repeated here and must not
-- be: two implementations of a placement rule is how a published result and a
-- screen come to disagree.
--
-- Exactly three seated round 2 judges, all submitted (N1, N5). Non-negotiable 4
-- says an incomplete panel produces no ranking; this is where that is
-- unarguable.
create or replace function admin_lock_results(p_event_id uuid, p_standings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category  text;
  v_seated    int;
  v_submitted int;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  if not exists (
    select 1 from event_rounds
     where event_id = p_event_id and round1_locked_at is not null
  ) then
    raise exception 'round 1 is not locked';
  end if;

  if exists (
    select 1 from event_rounds
     where event_id = p_event_id and results_locked_at is not null
  ) then
    raise exception 'results are already locked';
  end if;

  select count(*) into v_seated
    from judge_assignments a
    join judges j on j.id = a.judge_id
   where a.event_id = p_event_id and a.seat in (2, 3, 4) and j.is_active;

  if v_seated <> 3 then
    raise exception 'round 2 needs exactly three seated judges';
  end if;

  select count(*) into v_submitted
    from judge_assignments a
    join judge_sheets s
      on s.event_id = a.event_id and s.judge_id = a.judge_id and s.round = 2
   where a.event_id = p_event_id
     and a.seat in (2, 3, 4)
     and s.submitted_at is not null;

  if v_submitted <> 3 then
    raise exception 'all three round 2 judges must have submitted';
  end if;

  if p_standings is null or jsonb_typeof(p_standings) <> 'array' then
    raise exception 'standings must be a json array';
  end if;

  insert into event_rounds (event_id) values (p_event_id)
  on conflict (event_id) do nothing;

  update event_rounds
     set results_locked_at = now(),
         results_locked_by = auth.uid(),
         standings         = p_standings
   where event_id = p_event_id;
end;
$fn$;

revoke all on function admin_lock_results(uuid, jsonb) from public;
grant execute on function admin_lock_results(uuid, jsonb) to authenticated;

-- Clears the freeze as well as the stamp. A frozen `standings` that outlived its
-- lock would still read as official to any surface that only checks the column
-- is non-null, and being the official one is the entire reason the column exists.
create or replace function admin_unlock_results(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category text;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select category into v_category from events where id = p_event_id;
  if v_category is null then
    raise exception 'event not found';
  end if;
  if v_category <> 'individual' then
    raise exception 'individual events only';
  end if;

  update event_rounds
     set results_locked_at = null,
         results_locked_by = null,
         standings         = null
   where event_id = p_event_id;
end;
$fn$;

revoke all on function admin_unlock_results(uuid) from public;
grant execute on function admin_unlock_results(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Admin: reopening one judge's sheet
-- ---------------------------------------------------------------------------

-- A judge cannot un-submit (N6); this is how one gets a second chance. Narrow on
-- purpose: it clears the submission and nothing else, so the judge reopens the
-- board they already typed rather than an empty one.
--
-- Refused while the round is locked. Reopening one sheet inside a locked round
-- would let a rank move underneath a qualifier list or a published standing
-- without either being reopened; the admin unlocks the round first.
create or replace function admin_unlock_judge_sheet(p_event_id uuid, p_judge_id uuid, p_round int)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_category  text;
  v_r1_locked timestamptz;
  v_results   timestamptz;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
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

  select round1_locked_at, results_locked_at into v_r1_locked, v_results
    from event_rounds where event_id = p_event_id;

  if p_round = 1 and v_r1_locked is not null then
    raise exception 'round 1 is locked; unlock the round first';
  end if;

  if v_results is not null then
    raise exception 'results are locked; unlock the results first';
  end if;

  update judge_sheets
     set submitted_at = null,
         submitted_by = null,
         updated_at   = now()
   where event_id = p_event_id and judge_id = p_judge_id and round = p_round;
end;
$fn$;

revoke all on function admin_unlock_judge_sheet(uuid, uuid, int) from public;
grant execute on function admin_unlock_judge_sheet(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Still no client write policy
-- ---------------------------------------------------------------------------

-- Non-negotiable 2, restated as a statement rather than as a comment. 0018
-- revoked these already; repeating the revoke costs nothing and means this file
-- cannot land on a database where a permissive grant has crept in since.
revoke insert, update, delete, truncate on judges from anon, authenticated;
revoke insert, update, delete, truncate on judge_assignments from anon, authenticated;
revoke insert, update, delete, truncate on judge_sheets from anon, authenticated;
revoke insert, update, delete, truncate on judge_ranks from anon, authenticated;
revoke insert, update, delete, truncate on round2_qualifiers from anon, authenticated;
revoke insert, update, delete, truncate on event_rounds from anon, authenticated;
