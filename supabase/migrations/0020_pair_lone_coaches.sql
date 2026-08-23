-- Pair the lone coach with every contestant, where there was only one answer.
--
-- Run 0019 first: this writes `entry_coaches.participant_id` and leans on the
-- partial unique index that holds one coach per contestant.
--
-- 0019 back-filled nothing, on the grounds that picking which of three coaches
-- belonged to which of three contestants would be a guess. That reasoning holds
-- wherever there is something to choose. It does not hold for an individual
-- entry carrying exactly one coach: whoever the school meant for each
-- contestant, it was that person, because there was nobody else on the entry.
-- Writing the pairing there is not an invention but the same fact, recorded
-- where the form can now read it.
--
-- This is most of the backlog. On the division's data when this was written,
-- 864 of the 884 individual entries named a single coach — a school with three
-- contestants in a contest almost always sends one coach with them. Those
-- schools now open an entry and find it already answered. The 20 that named two
-- or three coaches still start blank, because those are the entries where the
-- names actually differ and only the school knows which is which.
--
-- WHAT THIS DOES NOT TOUCH: participants, coaches, entries, entry_participants,
-- events, event_types, schools, school_papers. No coach is added to an entry
-- and none is dropped from one — every statement below moves an existing coach
-- onto the contestants already on that same entry. Group entries are excluded
-- by the category filter, as in 0019: their coaches belong to the whole team.
-- An individual entry with a coach and no contestants pairs nothing and keeps
-- its coach, since there is nobody to pair them with.
--
-- Both statements are idempotent — a second run matches nothing.

-- 1. The lone coach now coaches each of the entry's contestants. One coach
--    covering several contestants is several rows naming the same person, which
--    is what dropping `unique (entry_id, coach_id)` in 0019 made room for.
insert into entry_coaches (entry_id, coach_id, participant_id)
select target.entry_id, target.coach_id, ep.participant_id
  from (
    select ec.entry_id,
           -- Exactly one distinct id by the HAVING below, so which element is
           -- taken does not matter. `min(uuid)` is avoided on purpose.
           (array_agg(distinct ec.coach_id))[1] as coach_id
      from entry_coaches ec
      join entries e on e.id = ec.entry_id
      join events ev on ev.id = e.event_id
     where ev.category = 'individual'
     group by ec.entry_id
    having count(*) filter (where ec.participant_id is not null) = 0
       and count(distinct ec.coach_id) = 1
  ) as target
  join entry_participants ep on ep.entry_id = target.entry_id;

-- 2. Drop the row that named the coach without a contestant. It is kept only
--    while it is the entry's sole record of that person; once the same coach is
--    paired to someone on the same entry, the unpaired copy says nothing new,
--    and leaving it behind would keep the entry reading as pending forever.
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
       from entry_coaches paired
      where paired.entry_id = ec.entry_id
        and paired.coach_id = ec.coach_id
        and paired.participant_id is not null
   );
