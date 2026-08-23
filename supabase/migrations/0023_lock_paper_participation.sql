-- Press Link: the division-wide lock reaches the contest answer too.
--
-- 0022 nested its global check inside 0011's three guard functions and so
-- covered all seven row triggers at once. `schools` carries no such trigger —
-- it has never needed one, because a school cannot write its own row directly:
-- RLS gives it select and nothing else, and every legitimate change goes
-- through a definer RPC. That left one gap, and only one.
-- `set_paper_participation` runs as its owner with the policies on `schools`
-- behind it, and it writes `paper_participation` knowing nothing about the
-- division-wide switch. So while the deadline lock was on, a school could still
-- change its answer to the school paper contest question — a write the lock
-- exists to refuse.
--
-- The check goes in the RPC rather than into an eighth trigger on `schools`.
-- A trigger there would fire on `admin_unlock_submission`,
-- `admin_reset_paper_participation` and `scripts/reset-submissions.sql` — every
-- path the office uses to repair or reset a submission — and each would then
-- need its own exemption carved back out of it. Guarding the single function a
-- school can actually reach is the smaller blast radius for the same invariant.
--
-- Nothing else changes: 0011's body is reproduced verbatim, and the only
-- addition is the check below.

-- No ownership gate here, unlike the guard functions in 0022. Those run under a
-- trigger, which cannot know whether the caller owns the row, so they test
-- `auth_user_id = auth.uid()` to keep admins and the service role writing. This
-- function already resolves its target that way and has done since 0004: it
-- selects the school by `auth.uid()` and raises `school not found` when there is
-- none. An admin, or a service-role caller whose `auth.uid()` is null, has
-- therefore already been turned away several lines above and never evaluates the
-- flag — so a broken settings row cannot block the callers who would have to
-- repair it, which is the same property 0022 got from nesting. The office
-- override remains `admin_reset_paper_participation`, untouched by this file.
--
-- The global case is tested before the per-school one, and carries 0022's
-- sentence character for character, because `rpcMessage()` in
-- app/entry/roster-actions.ts matches on the text. 'submissions are locked
-- division-wide' does not contain the substring 'submission is locked', so the
-- per-school branch that follows cannot swallow it and answer "ask the division
-- office to reopen it" — advice that is false while the switch is on, since
-- unlocking this one school would change nothing.
--
-- This file depends on 0022: `create or replace` here needs
-- `submissions_locked_globally()` to already exist, and 0022 is what creates it.
create or replace function set_paper_participation(choice text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid;
begin
  if choice not in ('yes', 'no') then
    raise exception 'invalid choice: %', choice;
  end if;

  select id into target from schools where auth_user_id = auth.uid();
  if target is null then
    raise exception 'school not found';
  end if;

  if submissions_locked_globally() then
    raise exception 'submissions are locked division-wide';
  end if;

  if exists (select 1 from schools where id = target and submission_locked_at is not null) then
    raise exception 'submission is locked';
  end if;

  if (select count(*) from school_papers where school_id = target) < 1 then
    raise exception 'save your school paper information first';
  end if;

  update schools
    set paper_participation = choice,
        paper_answered_at = now()
    where id = target;
end;
$fn$;

revoke all on function set_paper_participation(text) from public;
grant execute on function set_paper_participation(text) to authenticated;
