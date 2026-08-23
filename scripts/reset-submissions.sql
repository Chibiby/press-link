-- DESTRUCTIVE. Wipes every school's submitted data for a fresh start and
-- restarts participant numbering at 0001.
--
-- Deletes: entries (and their participant/coach links), the roster of
--          participants and coaches, and every school paper.
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
update app_settings
  set submissions_locked = false,
      submissions_locked_at = null,
      submissions_locked_by = null;

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

-- Division-wide numbering starts over, so the next participant registered
-- gets 0001.
alter sequence participant_number_seq restart with 1;

commit;

-- Expect four zeroes, a next number of 1, and the division-wide lock down.
select
  (select count(*) from entries) as entries,
  (select count(*) from participants) as participants,
  (select count(*) from coaches) as coaches,
  (select count(*) from school_papers) as school_papers,
  (select last_value from participant_number_seq) as next_participant_number,
  (select submissions_locked from app_settings) as submissions_locked;
