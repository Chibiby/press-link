-- Press Link: the last of the coaches' single-name field.
--
-- 0013 added first_name / middle_name / last_name alongside full_name so the
-- running deployment kept working while the new code shipped. That code is live
-- now, so the old column can go.
--
-- APPLY THIS ONLY AFTER THE CODE FROM THIS BRANCH IS DEPLOYED. Dropping the
-- column while the old code is live takes down /entry and the admin pages.

alter table coaches drop column if exists full_name;
