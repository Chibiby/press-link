-- Press Link: repairs a database that got 0014 without 0013.
--
-- scripts/run-migration.ts wraps a whole file in one transaction, so when 0013
-- failed part-way through (it took two follow-up fixes before it was correct)
-- its `add column` statements rolled back with the rest of the file. 0014 is a
-- single statement, so it committed. The production coaches table was left with
-- no name column at all: full_name dropped, first/middle/last never added.
--
-- The visible symptom is /admin — every page that embeds
-- `coaches(first_name, middle_name, last_name)` fails the whole query with
-- `42703 column coaches_2.first_name does not exist`, which the entries table
-- surfaces as "Could not load entries".
--
-- This restates 0013's column work without the full_name backfill, which cannot
-- run any more and has nothing to read: full_name is gone. Where 0013 did land
-- intact, every statement here is a no-op.

alter table coaches add column if not exists first_name text not null default '';
alter table coaches add column if not exists middle_name text;
alter table coaches add column if not exists last_name text not null default '';

-- 0013 added the columns nullable and tightened them afterwards, so a database
-- that ran 0013 before the not-null step landed still needs this.
update coaches set first_name = '' where first_name is null;
update coaches set last_name = '' where last_name is null;

alter table coaches alter column first_name set default '';
alter table coaches alter column last_name set default '';
alter table coaches alter column first_name set not null;
alter table coaches alter column last_name set not null;
