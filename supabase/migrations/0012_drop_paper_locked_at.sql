-- Press Link: the last of the paper-scoped lock.
--
-- 0011 added submission_locked_at alongside paper_locked_at so the running
-- deployment kept working while the new code shipped. That code is live now, so
-- the old column and the two functions it belonged to can go.
--
-- APPLY THIS ONLY AFTER THE CODE FROM THIS BRANCH IS DEPLOYED. Dropping the
-- column while the old code is live takes down /entry and the admin pages.

drop function if exists lock_school_paper();
drop function if exists admin_unlock_school_paper(uuid);
drop function if exists reject_locked_school_paper();

alter table schools drop column if exists paper_locked_at;
