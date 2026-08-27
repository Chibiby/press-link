-- Two rules loosened to the same principle: nothing with ranks on file may be
-- changed underneath, and everything without them may be.
--
-- 0027 guarded the cut with "round 1 is locked" and 0029 gave the roster only a
-- soft `is_active` flag. Both drew the line in the wrong place for the division's
-- actual working: a panel gets shuffled and a cut gets argued over right up until
-- somebody ranks, and after that neither may move without an explicit reopen.
--
-- WHAT THIS CHANGES
--
--   1. admin_set_round2_cut now refuses on a *submitted round 1 sheet* rather than
--      on a locked round 1.
--   2. admin_delete_judge is new: a judge who never ranked anything can be removed
--      outright rather than only deactivated.
--
-- WHAT THIS DOES NOT TOUCH: no table, no policy, no column, no existing row. It
-- replaces one function and adds another.
--
-- Safe to re-run: both statements are `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. The cut, movable until it has been ranked against
-- ---------------------------------------------------------------------------
-- The cut decides how tall round 1's dropdown is, and therefore who can be scored
-- at all (N2). 0027 refused to move it once round 1 was locked, which is both too
-- late and too early.
--
-- TOO LATE, because locking is not the moment the cut starts to matter. Seat 1
-- submits, and only afterwards does an admin close the round; in that window 0027
-- would let the cut drop from 10 to 5 under a sheet that had already ranked ten
-- contestants. Those ranks are then above the cut the sheet is read under, which
-- is precisely the state `judging_write_sheet` refuses to *write* — reachable
-- only by moving the cut after the fact. That hole is closed here.
--
-- TOO EARLY, because "round 1 is locked" left no route back for an admin who
-- simply got the number wrong: the answer was to reopen the round, which discards
-- the qualifier list. That is still what has to happen, but it is now reached
-- through the sheet rather than being the first thing refused — reopen seat 1's
-- sheet (which reopening the round does anyway) and the cut moves again.
--
-- So the rule is one sentence: the cut is free until round 1's judge has
-- submitted, and after that it moves only by reopening their sheet.
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

-- ---------------------------------------------------------------------------
-- 2. Deleting a judge who never ranked anything
-- ---------------------------------------------------------------------------
-- 0018 chose `is_active` over deleting because a withdrawn judge's submitted
-- sheets still feed placements, and 0029 built the roster on that. That reasoning
-- holds for a judge who has judged. It does not hold for a typo, a duplicate, or
-- somebody who agreed in June and withdrew in July: deactivating those leaves the
-- roster carrying rows that were never anybody, and an admin reading it cannot
-- tell a retired judge from a mistake.
--
-- So the line is the ranks, not the seat. A judge with no submitted sheet has
-- contributed nothing any placement rests on, and everything hanging off them —
-- their seats, their unsubmitted sheets, the ranks on those sheets — goes with
-- them through 0018's `on delete cascade`. Their seats emptying is the point
-- rather than an obstacle: this is also how a panel gets someone replaced.
--
-- A submitted sheet is refused, and the message says which way out there is. The
-- ranks on it are what a placement was computed from, so discarding them silently
-- would move a standing with nothing on the event's page to say why.
--
-- The login is NOT deleted here. `auth.users` is not writable from SQL, so the
-- server action deletes it after this returns — the same split, in reverse, that
-- provisioning uses.
create or replace function admin_delete_judge(p_judge_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_auth uuid;
  v_submitted int;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select auth_user_id into v_auth from judges where id = p_judge_id;
  if not found then
    raise exception 'judge not found';
  end if;

  select count(*) into v_submitted
    from judge_sheets where judge_id = p_judge_id and submitted_at is not null;

  if v_submitted > 0 then
    raise exception
      'this judge has submitted % sheet(s), and placements rest on those ranks; reopen them first if they must go',
      v_submitted;
  end if;

  -- Assignments, sheets and the ranks beneath them all cascade from 0018.
  delete from judges where id = p_judge_id;

  -- Handed back so the caller knows which login to remove, if there was one.
  return v_auth;
end;
$fn$;

revoke all on function admin_delete_judge(uuid) from public;
grant execute on function admin_delete_judge(uuid) to authenticated;

comment on function admin_delete_judge(uuid) is
  'Removes a judge who has no submitted sheet, cascading their seats and drafts. Returns their auth_user_id so the caller can delete the login.';
