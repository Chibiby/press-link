-- Pair each contestant with their coach, on individual entries.
--
-- Run 0004 first: this depends on `entry_coaches.coach_id` and on
-- `entry_participants (entry_id, participant_id)` being unique.
--
-- An individual contest is prepared one contestant at a time — a school names
-- who competes and, in the same breath, who coaches them. The form has always
-- read that way; the database has not. `entry_participants` and `entry_coaches`
-- were independent link tables, so an entry named a set of contestants and a
-- set of coaches with nothing tying one to the other. Three contestants and
-- three coaches on one entry was three unanswered questions.
--
-- So `entry_coaches` gains the contestant the coach is for.
--
-- NOTHING IS BACK-FILLED. Guessing which of three coaches belonged to which of
-- three contestants would print a wrong name on a certificate, and the row
-- order in a link table is not evidence. Entries filed before this migration
-- keep `participant_id IS NULL`, which the school resolves by re-opening the
-- entry and choosing again — the same reasoning as 0017, where a paper that
-- could not be split honestly was re-filed rather than guessed.
--
-- WHAT THIS DOES NOT TOUCH: participants, coaches, entries,
-- entry_participants, events, event_types, schools, school_papers, and every
-- row already in entry_coaches. No statement below deletes or updates a single
-- row. Group entries are unaffected by design: their coaches are shared by the
-- whole team, so pairing them off would be a fiction, and they keep
-- `participant_id IS NULL` for good.

-- 1. The contestant this coach is for.
--
-- Nullable, and that is the whole design. NULL is not "missing data to be
-- cleaned up later" — it is a state with two honest meanings:
--
--   * on a group entry: unpaired by nature, permanently;
--   * on an individual entry: filed before pairing existed, and pending.
--
-- The two are told apart by the entry's event category, so no flag column is
-- needed. What makes that unambiguous is a rule the app now enforces: an
-- individual entry saved from here on pairs every coach it names. A NULL on an
-- individual entry can therefore only be a row this migration left alone.
alter table entry_coaches
  add column if not exists participant_id uuid;

-- 2. The contestant must be on this very entry.
--
-- A composite foreign key rather than a plain reference to `participants`:
-- pointing at `participants(id)` would allow a coach to be paired with someone
-- who is not competing in this event, or is on another school's roster.
-- `(entry_id, participant_id)` can only name a contestant already on this
-- entry, which is also what makes the pairing safe under row-level security —
-- `entry_id` is already scoped to the school's own entries, so there is nothing
-- left to forge.
--
-- The default MATCH SIMPLE is doing real work here: when any referencing
-- column is NULL the constraint is satisfied without a lookup, so a NULL
-- `participant_id` skips the check entirely. That is precisely what "unpaired"
-- has to mean, and it is why the existing rows survive a migration that adds a
-- foreign key.
--
-- ON DELETE CASCADE because a coach paired with a contestant who is no longer
-- competing is not a record worth keeping. The alternative, refusing the
-- delete, would leave the division office unable to remove a contestant from an
-- entry without first hunting down a link row it never sees.
alter table entry_coaches
  drop constraint if exists entry_coaches_participant_on_entry;
alter table entry_coaches
  add constraint entry_coaches_participant_on_entry
  foreign key (entry_id, participant_id)
  references entry_participants (entry_id, participant_id)
  on delete cascade;

-- 3. One coach may cover several contestants on the same entry.
--
-- `unique (entry_id, coach_id)` said the opposite: it read as "a coach appears
-- once per entry", which was a fair rule while coaches were an unordered set.
-- Now that a row means "this coach, for this contestant", a small school
-- sending three contestants under one coach needs three rows naming that coach,
-- and the old constraint would reject the second.
alter table entry_coaches
  drop constraint if exists entry_coaches_entry_coach_key;

-- 4. What replaces it: two rules, one per kind of row.
--
-- Postgres cannot hold two different uniqueness rules on one pair of columns,
-- but it can hold one rule per subset of the rows — which is what a partial
-- unique index is for.
--
-- A contestant has at most one coach. This is the pairing itself: the reason
-- the form no longer offers "add another coach" under a contestant, restated
-- somewhere a forged request cannot get past.
create unique index if not exists entry_coaches_one_coach_per_contestant
  on entry_coaches (entry_id, participant_id)
  where participant_id is not null;

-- An unpaired coach still appears once per entry — the old constraint, kept
-- exactly where it still makes sense: a group entry's two coaches, and the
-- pending rows above. Every row that exists today satisfies this, because every
-- row that exists today satisfied the constraint dropped in 3.
create unique index if not exists entry_coaches_unpaired_coach_once
  on entry_coaches (entry_id, coach_id)
  where participant_id is null;

-- 5. What the app still owes, and why it is not here.
--
-- Two rules cannot be expressed as a table constraint, because both need to
-- know the entry's event category — a join to `entries` and `events`, which a
-- CHECK cannot do:
--
--   * a group entry's coaches must stay unpaired;
--   * an individual entry's coaches must all be paired.
--
-- `validateEntryCounts` in lib/roster/limits.ts enforces both on every save,
-- next to the per-event participant minimums it already enforces for the same
-- reason. A trigger could reach the join, but it would be the only rule of this
-- kind living in the database while its siblings live in one function, and a
-- school would meet it as a Postgres error rather than a sentence.
