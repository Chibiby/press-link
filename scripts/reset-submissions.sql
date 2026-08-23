-- DESTRUCTIVE. Wipes every school's submitted data for a fresh start and
-- restarts participant numbering at 0001.
--
-- Deletes: entries (and their participant/coach links), the roster of
--          participants and coaches, every school paper, and the activity log
--          (0024's activity_events) — including the removal rows this script's
--          own deletes write into it.
-- Keeps:   districts, schools and their logins, and the events / event_types
--          catalog.
--
-- Run in the Supabase SQL Editor. Everything is inside one transaction, so a
-- failure part-way leaves the data untouched.

begin;

-- Unlock first. A locked school's rows are refused by the guard triggers on
-- every table below, so nothing may be deleted until the flags are down. This
-- also puts every school back at stage 1, which is what a reset means.
--
-- Run as the service role in the SQL editor, `auth.uid()` is null and the
-- guards do not fire at all — but the ordering must not depend on who happens
-- to be running the script.
update schools
  set paper_participation = 'undecided',
      paper_answered_at = null,
      submission_locked_at = null;

-- The division-wide switch comes down for the same reason and in the same
-- breath. It is a second, independent lock — the guard triggers refuse a write
-- while it is on no matter what the school's own flag says — so clearing only
-- the per-school flags above would leave every delete below still refused. All
-- three columns are cleared together because the flag and its stamp are one
-- fact: `app_settings_lock_stamp_check` rejects an open lock that still carries
-- a timestamp.
--
-- Guarded on the table's existence, because 0022 is what creates app_settings and
-- 0022 is not applied yet. Unguarded, this raises `relation "app_settings" does
-- not exist` on any database still living with 0010's drop — and since everything
-- here is one transaction, that rolls back the unlock above it and stops every
-- delete below, so the reset reports one line of error and changes nothing. The
-- table's absence is not a failure to report: no table, no division-wide switch,
-- nothing to bring down. plpgsql plans a statement only when control reaches it,
-- so the update inside this branch is never resolved against a database that has
-- no such table. Idiom from 0011.
do $switch$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'app_settings'
  ) then
    update app_settings
      set submissions_locked = false,
          submissions_locked_at = null,
          submissions_locked_by = null;
  end if;
end
$switch$;

-- Link tables next. Both cascade from `entries`, but deleting them explicitly
-- keeps this readable and safe to re-run.
delete from entry_participants;
delete from entry_coaches;
delete from entries;

-- Paper staff cascades from school_papers; same reasoning as above.
delete from paper_staff;
delete from school_papers;

-- The roster. Nothing references these any more now that entries are gone.
delete from participants;
delete from coaches;

-- The activity log goes too, and going last is load-bearing. 0025 puts an AFTER
-- DELETE trigger on entries, participants and coaches, so every delete above has
-- already written its own 'entry-withdrawn' / 'participant-removed' /
-- 'coach-removed' row — thousands of them, each with a null session_id because the
-- SQL editor carries no session claim, and each newer than
-- app_settings.activity_log_started_at, so each renders individually. Left in
-- place they make the dashboard read as a mass deletion of the whole division.
-- Clearing the log before the deletes would just be refilled by them. Section 4
-- of 0025 asks for exactly this line: a reset means "as if none of this ever
-- happened", and the log should say the same.
--
-- Nothing else in this script logs anything. `update schools` above does fire
-- 0025's schools trigger, but both of that function's conditions require a
-- non-null new value and this script sets both columns to null, so it writes no
-- row.
--
-- Guarded like the switch above, and for the same reason: 0024 creates this table
-- and is not applied yet, so an unguarded delete would abort the entire reset on
-- every database that exists today.
do $log$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'activity_events'
  ) then
    delete from activity_events;
  end if;
end
$log$;

-- Division-wide numbering starts over, so the next participant registered
-- gets 0001.
alter sequence participant_number_seq restart with 1;

commit;

-- Expect four zeroes, a next number of 1, and the division-wide lock down.
--
-- Deliberately not guarded, unlike the two statements above: this runs after
-- `commit;`, so where 0022 has not been applied the last column raises and the
-- reset has already succeeded anyway. Drop that column and re-run to read the
-- counts.
select
  (select count(*) from entries) as entries,
  (select count(*) from participants) as participants,
  (select count(*) from coaches) as coaches,
  (select count(*) from school_papers) as school_papers,
  (select last_value from participant_number_seq) as next_participant_number,
  (select submissions_locked from app_settings) as submissions_locked;
