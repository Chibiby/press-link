-- The anonymity boundary: how a judge learns which contestants to rank.
--
-- Implements the two judge-facing read RPCs section 4 of
-- docs/superpowers/specs/2026-08-27-judges-portal-two-stage-ranking-design.md
-- carries forward from the 2026-08-21 contract. 0018 created the judging tables
-- and named `judge_round2_units` in a comment; neither function was ever
-- written, so the judge portal had no way to render a sheet.
--
-- WHY ONLY TWO OF THE FOUR. The 2026-08-21 contract also lists `judge_my_events`
-- and `judge_my_sheets`. Both are plain selects that 0018's row level security
-- already answers correctly: `judge_assignments_self_select`,
-- `judge_sheets_self_select` and `judge_ranks_self_select` scope those tables to
-- the signed-in judge's own rows, and `events`/`event_types` are publicly
-- readable. Wrapping them in security-definer functions would put a second
-- authorisation rule beside the policy and give the two somewhere to disagree.
-- The two functions below exist because RLS *cannot* answer them: building a
-- code requires reading `participants`, and a judge has no select on that table
-- and must never have one (non-negotiable 1).
--
-- WHAT THIS DOES NOT TOUCH: no table gains, loses or changes a column; no row of
-- any table is written, deleted or rewritten. No policy is added or dropped.
-- This migration creates two read-only functions and nothing else.
--
-- Safe to re-run: both statements are `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. Who may ask
-- ---------------------------------------------------------------------------

-- An assigned active judge, or an admin. Shared by both functions below so the
-- two cannot drift into different answers about who may read an event's codes.
--
-- Not granted to anyone: it is a security-definer implementation detail, reached
-- only through the two functions that follow.
--
-- An admin is allowed because /admin/judges/[eventId] renders the same anonymous
-- board an admin has to review before locking, and because the N9 admin entry
-- path types into the same sheet. An admin can already read every identity
-- directly, so this grants them nothing new.
create or replace function judging_may_read_units(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (select 1 from admin_profiles where user_id = auth.uid())
      or exists (
        select 1
          from judge_assignments a
          join judges j on j.id = a.judge_id
         where a.event_id = p_event_id
           and j.auth_user_id = auth.uid()
           and j.is_active
      );
$fn$;

revoke all on function judging_may_read_units(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Round 1's unit set: every contestant in the event
-- ---------------------------------------------------------------------------

-- Codes and nothing else. This is the one place a contest code is computed in
-- SQL, and it must agree with `formatContestCode` and `unitKeyOf` in
-- lib/judging/codes.ts, which say so in their own doc comments: four digits,
-- zero-padded, and the unit key is the participant id for an individual event
-- and the entry id for a group one. If the padding ever changes it changes in
-- both engines in the same commit, or the judge portal and the tabulators' sheet
-- will disagree about which contestant is which.
--
-- A unit whose number is null is a data fault rather than a contestant with no
-- number — both columns are `not null` — and it is raised rather than skipped.
-- A skipped row is a contestant silently missing from a judge's sheet, and a
-- board short one contestant reads as finished when it is not. This mirrors what
-- app/admin/(shell)/judging-data.ts already refuses to render over.
create or replace function judge_event_units(p_event_id uuid)
returns table (unit_key text, code text, entry_id uuid, participant_id uuid)
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_category text;
  v_uncoded  int;
begin
  if not judging_may_read_units(p_event_id) then
    raise exception 'not authorized';
  end if;

  select e.category into v_category from events e where e.id = p_event_id;

  if v_category is null then
    raise exception 'event not found';
  end if;

  if v_category = 'group' then
    -- Untouched by this feature (non-negotiable 6), and answered here only so a
    -- caller that asks gets the group event's real unit set rather than an empty
    -- one it would read as "no contestants".
    select count(*) into v_uncoded
      from entries en
     where en.event_id = p_event_id and en.entry_number is null;

    if v_uncoded > 0 then
      raise exception 'entry number missing on % row(s); this event cannot be coded', v_uncoded;
    end if;

    return query
      select en.id::text,
             lpad(en.entry_number::text, 4, '0'),
             en.id,
             null::uuid
        from entries en
       where en.event_id = p_event_id
       order by 2;
    return;
  end if;

  select count(*) into v_uncoded
    from entries en
    join entry_participants ep on ep.entry_id = en.id
    join participants p on p.id = ep.participant_id
   where en.event_id = p_event_id and p.participant_number is null;

  if v_uncoded > 0 then
    raise exception 'participant number missing on % row(s); this event cannot be coded', v_uncoded;
  end if;

  return query
    select p.id::text,
           lpad(p.participant_number::text, 4, '0'),
           en.id,
           p.id
      from entries en
      join entry_participants ep on ep.entry_id = en.id
      join participants p on p.id = ep.participant_id
     where en.event_id = p_event_id
     order by 2;
end;
$fn$;

revoke all on function judge_event_units(uuid) from public;
grant execute on function judge_event_units(uuid) to authenticated;

comment on function judge_event_units(uuid) is
  'Every unit in an event, as codes only. The anonymity boundary (non-negotiable 1): a judge reaches contest codes through this and through nothing else, because building one requires reading participants and a judge has no select on that table.';

-- ---------------------------------------------------------------------------
-- 3. Round 2's unit set: the qualifiers, and only once round 1 is locked
-- ---------------------------------------------------------------------------

-- Ordered by code, never by round 1 standing. The order a judge sees must not
-- tell them who is currently winning before they place round 2 — that is the
-- same reason `round2_qualifiers` carries the round 1 working but this function
-- does not return it.
--
-- Empty until `round1_locked_at` is set. The qualifier rows are written by
-- admin_lock_round1 in the same statement that stamps the lock, so this check is
-- belt and braces rather than the only guard — and it is the cheaper thing to
-- reason about at the page, which can say "round 2 has not opened" without
-- having to distinguish an empty list from an absent one.
create or replace function judge_round2_units(p_event_id uuid)
returns table (unit_key text, code text, entry_id uuid, participant_id uuid)
language plpgsql
security definer
set search_path = public
stable
as $fn$
begin
  if not judging_may_read_units(p_event_id) then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from event_rounds r
     where r.event_id = p_event_id and r.round1_locked_at is not null
  ) then
    return;
  end if;

  return query
    select coalesce(q.participant_id::text, q.entry_id::text),
           coalesce(
             lpad(p.participant_number::text, 4, '0'),
             lpad(en.entry_number::text, 4, '0')
           ),
           q.entry_id,
           q.participant_id
      from round2_qualifiers q
      join entries en on en.id = q.entry_id
      left join participants p on p.id = q.participant_id
     where q.event_id = p_event_id
     order by 2;
end;
$fn$;

revoke all on function judge_round2_units(uuid) from public;
grant execute on function judge_round2_units(uuid) to authenticated;

comment on function judge_round2_units(uuid) is
  'The qualifiers as codes only, ordered by code and empty until round 1 is locked. Never ordered by round 1 standing: the order a judge sees must not tell them who is winning before they place round 2.';
