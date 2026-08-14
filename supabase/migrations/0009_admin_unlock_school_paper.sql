-- Press Link: the division office can lift a school paper lock without
-- unpicking the school's contest answer.
--
-- `admin_reset_paper_participation` already exists and clears both the lock and
-- the answer, so the school is asked the contest question afresh. That is the
-- right tool when a school answered by mistake. It is the wrong one when a
-- school simply locked too early and still means what it said, which is the
-- common case — hence a second, narrower verb.

create or replace function admin_unlock_school_paper(target_school uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  update schools set paper_locked_at = null where id = target_school;
end;
$fn$;

revoke all on function admin_unlock_school_paper(uuid) from public;
grant execute on function admin_unlock_school_paper(uuid) to authenticated;
