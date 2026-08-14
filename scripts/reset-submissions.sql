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

-- Link tables first. Both cascade from `entries`, but deleting them explicitly
-- keeps this readable and safe to re-run.
delete from entry_participants;
delete from entry_coaches;
delete from entries;

-- The lock guard would refuse these deletes for any school that locked in, so
-- the flags are cleared before the rows go. This also puts every school back at
-- stage 1, which is what a reset means.
update schools
  set paper_participation = 'undecided',
      paper_answered_at = null,
      paper_locked_at = null;

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

-- Expect four zeroes and a next number of 1.
select
  (select count(*) from entries) as entries,
  (select count(*) from participants) as participants,
  (select count(*) from coaches) as coaches,
  (select count(*) from school_papers) as school_papers,
  (select last_value from participant_number_seq) as next_participant_number;
