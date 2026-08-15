-- Press Link: coaches are registered the way participants already are.
--
-- A single "Complete name" field left every school free to type "Ana Dela Cruz"
-- for a participant and "Dela Cruz, Ana" for that person's coach, which produced
-- two different orderings in the same export. The three parts fix the ordering
-- at the point of entry instead of guessing at it afterwards.
--
-- Additive on purpose: the running deployment still selects full_name by name,
-- so it stays (nullable) until 0014 drops it after this code ships.

alter table coaches add column if not exists first_name text default '';
alter table coaches add column if not exists middle_name text;
alter table coaches add column if not exists last_name text default '';

-- The division office reports no coaches registered yet, so this is expected to
-- touch nothing. It is written anyway, and deliberately does not guess at word
-- boundaries: splitting "Juan Dela Cruz" on spaces yields the surname "Cruz"
-- and a middle name of "Dela", silently. Putting the whole string in last_name
-- is lossless and visibly wrong, which a school can correct in seconds.
update coaches
  set last_name = coalesce(nullif(last_name, ''), full_name),
      first_name = coalesce(nullif(first_name, ''), '')
  where full_name is not null and coalesce(last_name, '') = '';

-- Any row that arrived without either name is not worth a not-null violation.
update coaches set first_name = '' where first_name is null;
update coaches set last_name = '' where last_name is null;

alter table coaches alter column first_name set not null;
alter table coaches alter column last_name set not null;

-- The new code inserts the three parts and never writes full_name, so the old
-- column cannot stay NOT NULL or every insert fails between this migration and
-- the deploy.
alter table coaches alter column full_name drop not null;
