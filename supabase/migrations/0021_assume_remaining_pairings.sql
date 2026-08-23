-- Assume a coach for every contestant an individual entry left uncoached.
--
-- Run 0019 and 0020 first. 0020 paired the entries where there was only one
-- answer — one coach on the entry, so no choice to make. This finishes the job
-- on the rest, where there were two or three coaches and the pairing is a
-- genuine guess.
--
-- The reason to guess is that the alternative is worse. An entry left unpaired
-- opens with empty coach fields, and the form now requires a coach for every
-- contestant, so the school cannot save the entry at all until it re-files the
-- pairing by hand. A guess costs a school one correction on an entry it was
-- going to review anyway; no guess costs every one of them a re-filing before
-- they can touch anything else. So each uncoached contestant is matched with a
-- coach the entry already names, and the school edits it if it is wrong.
--
-- HOW THE GUESS IS MADE. Nothing records the order a school picked its coaches
-- in — `entry_coaches` has no timestamp and its `id` is random — so position is
-- the only thing left, and it is taken in the order the school's own dashboard
-- shows these people: contestants by roster number, coaches by surname. The
-- coach list is cycled when it is shorter, so two coaches over three
-- contestants gives the first coach two of them. On the division's data when
-- this was written that is 61 contestants across 24 entries: six entries of
-- three coaches for three contestants, where the guess is a straight one-to-one
-- and stands a good chance of being right; thirteen of two coaches for two or
-- three; four that name one coach and are only here because they were filed
-- after 0020 ran; and one that names two coaches for a single contestant.
--
-- That last one cannot keep both. An individual entry holds one coach per
-- contestant, so the second name is not something the form can store or the
-- school can save — statement 2 drops it, and since the coach is still on the
-- school's roster, a school that finds the wrong one paired can swap it.
--
-- RE-RUNNABLE ON PURPOSE. Both statements match on the current state rather
-- than on a fixed list, so running this again pairs whatever has since gone
-- unpaired and touches nothing already settled. That matters because the form
-- that pairs on save is not deployed yet: every entry filed between now and
-- that deploy writes coaches with no contestant, exactly like the four above.
-- Run this once more after the deploy to sweep them up.
--
-- WHAT THIS DOES NOT TOUCH: participants, coaches, entries, entry_participants,
-- events, event_types, schools, school_papers. No person is added to an entry —
-- every pairing below draws from the coaches and contestants already on that
-- same entry. Group entries are excluded by the category filter, as in 0019 and
-- 0020: their coaches belong to the whole team, not to one member. An
-- individual entry with no contestants keeps its coaches untouched, and one
-- with no coaches keeps its contestants uncoached, there being nobody to pair
-- them with. Neither exists in the division's data; the guards are there so a
-- later run cannot strip an entry mid-edit.

-- 1. One coach per uncoached contestant, by position, cycling the coach list.
insert into entry_coaches (entry_id, coach_id, participant_id)
with pool as (
  -- The distinct people this entry names, paired or not, in surname order. A
  -- coach already matched to one contestant stays in the pool: on an individual
  -- entry one coach may cover several contestants, which is what dropping
  -- `unique (entry_id, coach_id)` in 0019 made room for.
  select links.entry_id,
         links.coach_id,
         row_number() over (
           partition by links.entry_id
           order by c.last_name, c.first_name, c.middle_name, c.id
         ) - 1 as slot,
         count(*) over (partition by links.entry_id) as pool_size
    from (select distinct ec.entry_id, ec.coach_id from entry_coaches ec) as links
    join coaches c on c.id = links.coach_id
    join entries e on e.id = links.entry_id
    join events ev on ev.id = e.event_id
   where ev.category = 'individual'
),
uncoached as (
  -- Numbered among themselves, so a partly paired entry spreads its pool over
  -- the contestants that still need someone instead of over all of them.
  select ep.entry_id,
         ep.participant_id,
         row_number() over (
           partition by ep.entry_id
           order by p.participant_number, p.id
         ) - 1 as slot
    from entry_participants ep
    join participants p on p.id = ep.participant_id
    join entries e on e.id = ep.entry_id
    join events ev on ev.id = e.event_id
   where ev.category = 'individual'
     and not exists (
       select 1
         from entry_coaches ec
        where ec.entry_id = ep.entry_id
          and ec.participant_id = ep.participant_id
     )
)
select uncoached.entry_id, pool.coach_id, uncoached.participant_id
  from uncoached
  join pool
    on pool.entry_id = uncoached.entry_id
   and pool.slot = uncoached.slot % pool.pool_size;

-- 2. Every coach on an individual entry is now matched to a contestant, so a
--    row that still names nobody is either a duplicate of a pairing written
--    above or a name the entry has no contestant left to hold. Both read as
--    "this entry is still pending" to the form, which is no longer true.
--    Guarded on the entry having a contestant at all: with nobody to pair with,
--    the unpaired row is the entry's only record of its coaches.
delete from entry_coaches ec
 where ec.participant_id is null
   and exists (
     select 1
       from entries e
       join events ev on ev.id = e.event_id
      where e.id = ec.entry_id
        and ev.category = 'individual'
   )
   and exists (
     select 1
       from entry_participants ep
      where ep.entry_id = ec.entry_id
   );
