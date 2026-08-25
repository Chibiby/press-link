-- Which level a *non-integrated* school teaches.
--
-- `is_integrated` (0016) tells us a school runs both levels under one roof;
-- for everyone else, `schools` has never recorded which single level that is.
-- The school-papers redesign needs to render that without re-deriving it from
-- the name on every request, so it gets a stored column, seeded the same way
-- `is_integrated` was: from the name, because that is the only signal the
-- division roll carries.

-- 1. The column. Nullable, deliberately: a name that doesn't clearly say
-- "elementary" or "secondary" must stay unclassified rather than guessed, the
-- same way a wrong guess on `is_integrated` would have been worse than a
-- stored `false`. A NULL here still satisfies the CHECK below — only a
-- non-null value is constrained to the two known levels.
alter table schools add column if not exists level text;

alter table schools drop constraint if exists schools_level_check;
alter table schools add constraint schools_level_check
  check (level in ('elementary', 'secondary'));

-- 2. Backfill, restricted to non-integrated schools.
--
-- Integrated schools are excluded on purpose: they teach both levels, so no
-- single value of `level` describes them, and their `school_papers.level`
-- (0016) already carries the per-paper level instead. Leaving `schools.level`
-- NULL for them is the correct, permanent answer, not a placeholder.
--
-- The keyword match mirrors 0016's word-boundary style (`~*` with `\y`,
-- Postgres's word boundary) and checks elementary first, so a name that
-- somehow matches both patterns is classified as elementary — the same
-- conservative bias 0016 uses for `is_integrated` itself, applied here
-- because a wrong "secondary" is no safer to guess than a wrong "elementary".
--
-- Anything that matches neither pattern is left NULL rather than guessed;
-- that is a feature of this backfill, not a gap to close later.
update schools
   set level = 'elementary'
 where is_integrated = false
   and level is distinct from 'elementary'
   and name ~* '\yelementary\y';

update schools
   set level = 'secondary'
 where is_integrated = false
   and level is distinct from 'secondary'
   and level is distinct from 'elementary' -- elementary already won above; don't reopen it
   and (
     name ~* '\y(national high school|high school)\y'
     or name ~* '\y(nhs|hs)\y$'
   );

comment on column schools.level is
  'elementary/secondary for a non-integrated school, seeded from a word-boundary match on the name; correctable by hand. Always NULL for an integrated school (schools.is_integrated), which files its level per school_papers row instead, and NULL for any school whose name does not clearly say either.';
