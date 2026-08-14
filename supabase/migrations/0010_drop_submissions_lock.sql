-- Press Link: the division-wide submissions lock is gone.
--
-- It froze every school at once, which is not how the division office works —
-- it deals with schools one at a time, and the per-school paper lock plus the
-- admin unlock now cover that. `app_settings` held nothing else, so the table
-- goes with the column.
--
-- APPLY THIS ONLY AFTER THE CODE THAT READS app_settings IS DEPLOYED. Dropping
-- it while the old code is live takes down every school and admin page.

drop policy if exists "public read app_settings" on app_settings;
drop table if exists app_settings;
