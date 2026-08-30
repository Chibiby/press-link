-- Press Link: the round 2 cut defaults to 30, and cannot be set above 50.
--
-- 0018 set the column's default at 10 on the division's agreement at the time. The
-- division has since raised it to 30. It is still a per-event number and still
-- freely editable up to the ceiling — what changes is where an untouched event
-- starts, and how far an admin may take it.
--
-- WHAT THIS CHANGES
--
--   1. `events.round2_cut`'s default: 10 -> 30.
--   2. The check constraint: `>= 1` -> `between 1 and 50`, added NOT VALID.
--   3. `admin_set_round2_cut` refuses a cut above 50.
--   4. A backfill, narrowly scoped — see below.
--
-- WHY THE CEILING IS 50
--
-- It is `MAX_ROUND2_CUT` in `lib/judging/cut.ts`, which is `ROUND1_RANK_LIMIT` —
-- how far down the field round 1's dropdown goes since 0032. The two cannot be
-- separated: the qualifier list is drawn from what seat 1 typed, so a cut of sixty
-- would admit ten places nobody has any way to record. Enforced here as well as in
-- the action because the action is not the boundary (non-negotiable 2).
--
-- WHY THE CONSTRAINT IS NOT VALID
--
-- `not valid` binds every future write and leaves existing rows unchecked, which is
-- exactly the intent. A row already above 50 would be an event judged under a cut
-- that large, with a qualifier list drawn from it; failing this migration on such a
-- row would block the deploy, and clamping it would silently change who advanced.
-- Neither is right, so the past is left as it was found and only what happens next
-- is bounded. (Validate it later with `alter table events validate constraint
-- events_round2_cut_check` if the office confirms no such event exists.)
--
-- THE BACKFILL, AND WHY IT IS NARROW
--
-- A column default fires on insert, so raising it moves nothing already on file:
-- every event in the catalogue has a literal 10 stored in it, and without this the
-- change would be invisible to the whole division until somebody edited each event
-- by hand. So the 10s are moved to 30 — but only where 10 was never a decision:
--
--   * `round2_cut = 10` exactly. Any other number was typed by an admin.
--   * No submitted round-1 sheet. That is 0030's own line for when the cut stops
--     being movable, reused here rather than invented: a sheet has been filed
--     against this number and a rank may sit above the new one.
--   * Round 1 not locked. A locked round has a qualifier list drawn from its cut.
--
-- An event an admin deliberately set to 10 and has not yet judged is moved too, and
-- that is the one imprecision in this: nothing in the schema tells a chosen 10 from
-- an inherited one. The cost is a number an admin re-enters on an event nobody has
-- ranked yet; the alternative is leaving the division's whole catalogue on a default
-- it has replaced.
--
-- WHAT THIS DOES NOT TOUCH: no table, no other column, no policy, no judged event,
-- and no qualifier list. `judging_write_sheet` no longer reads the cut at all since
-- 0032, so nothing about what a judge may type moves with it.
--
-- Safe to re-run: the backfill is idempotent (the second run finds no untouched 10s
-- it has not already moved), and the rest is `create or replace` / `if exists`.

-- ---------------------------------------------------------------------------
-- 1. The default, the ceiling and the untouched rows
-- ---------------------------------------------------------------------------

alter table events alter column round2_cut set default 30;

alter table events drop constraint if exists events_round2_cut_check;
alter table events add constraint events_round2_cut_check
  check (round2_cut between 1 and 50) not valid;

comment on column events.round2_cut is
  'How many units advance to round 2. Default 30, per event, from 1 to 50 — the ceiling is ROUND1_RANK_LIMIT, as far down the field as round 1 can rank. Ties at the line all advance, so the qualifier list can be longer than this number.';

update events e
   set round2_cut = 30
 where e.round2_cut = 10
   and not exists (
     select 1
       from event_rounds r
      where r.event_id = e.id
        and r.round1_locked_at is not null
   )
   and not exists (
     select 1
       from judge_sheets s
       join judge_assignments a
         on a.event_id = s.event_id and a.judge_id = s.judge_id
      where s.event_id = e.id
        and s.round = 1
        and a.seat = 1
        and s.submitted_at is not null
   );

-- ---------------------------------------------------------------------------
-- 2. The setter, bounded above as well as below
-- ---------------------------------------------------------------------------
-- 0030's body, unchanged but for the upper bound. Restated whole because
-- `create or replace` cannot patch a fragment; every other rule in it — the admin
-- check, individual events only, and the freeze once seat 1 has submitted — is
-- carried over exactly.
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

  -- The ceiling. A cut above what round 1 can rank would admit places seat 1 has
  -- no way to type, and the qualifier list is drawn from seat 1's sheet.
  if p_cut > 50 then
    raise exception 'cut must be at most 50';
  end if;

  -- Seat 1's sheet, by seat number rather than by whoever happens to hold a round
  -- 1 sheet: an event seated 2, 3 and 4 with seat 1 vacant has no round 1 judge,
  -- and a stray round 1 sheet from a reseated judge must not freeze the cut.
  if exists (
    select 1
      from judge_sheets s
      join judge_assignments a
        on a.event_id = s.event_id and a.judge_id = s.judge_id
     where s.event_id = p_event_id
       and s.round = 1
       and a.seat = 1
       and s.submitted_at is not null
  ) then
    raise exception 'round 1 has been ranked against this cut; reopen that sheet first';
  end if;

  update events set round2_cut = p_cut where id = p_event_id;
end;
$fn$;

revoke all on function admin_set_round2_cut(uuid, int) from public;
grant execute on function admin_set_round2_cut(uuid, int) to authenticated;
