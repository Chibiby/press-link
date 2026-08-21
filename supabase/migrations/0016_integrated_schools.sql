-- Integrated schools publish two school papers per language, one for each level.
--
-- An integrated school runs elementary and secondary under one roof and one
-- school id, so a single paper row per language cannot represent it: the
-- elementary paper and the secondary paper have different names, different
-- advisers and different section heads. Every other school keeps exactly the
-- shape it has today.

-- 1. Which schools are integrated.
--
-- Derived from the name because that is the only signal the division roll
-- carries — there is no level column on `schools` and no separate register of
-- integrated schools. Word-boundary match, not a bare substring: `%integrated%`
-- would also catch a hypothetical "Reintegrated" and there is no reason to
-- accept that risk for the same cost. `\y` is Postgres's word boundary.
--
-- This is a stored column rather than a view or an expression so the division
-- office can correct it: a school the name test misses, or wrongly catches, is
-- one UPDATE away from right. `lib/schools/integrated.ts` holds the identical
-- rule for the application, and its test pins the two together.
alter table schools add column if not exists is_integrated boolean not null default false;

update schools
   set is_integrated = true
 where name ~* '\yintegrated\y'
   and is_integrated = false;

comment on column schools.is_integrated is
  'True when the school runs both elementary and secondary. Seeded from a word-boundary match on the name; correctable by hand.';

-- 2. Which level a school paper covers.
--
-- 'whole' is the default and means what every existing row already means: the
-- school publishes one paper per language covering the school. Backfilling to
-- it is what makes this migration a no-op for the 300-odd non-integrated
-- schools and for every paper already on file.
--
-- Integrated schools use 'elementary' and 'secondary' instead. The pairing —
-- integrated schools never hold a 'whole' row, others never hold a levelled one
-- — is enforced in the application rather than by a trigger. A CHECK cannot see
-- across to `schools.is_integrated`, and adding a cross-table trigger to a live
-- competition database is more risk than the invariant is worth mid-season.
alter table school_papers add column if not exists level text not null default 'whole';

alter table school_papers drop constraint if exists school_papers_level_check;
alter table school_papers add constraint school_papers_level_check
  check (level in ('whole', 'elementary', 'secondary'));

comment on column school_papers.level is
  'whole = one paper for the school (non-integrated). elementary/secondary = an integrated school''s two papers per language.';

-- 3. One paper per school per language per level.
--
-- The old constraint was (school_id, language), which is exactly what stops an
-- integrated school holding both an elementary and a secondary English paper.
-- Dropped by name and by the name Postgres would have generated in 0001, since
-- the two can differ across environments.
alter table school_papers drop constraint if exists school_papers_school_id_language_key;
alter table school_papers drop constraint if exists school_papers_school_id_language_level_key;
alter table school_papers add constraint school_papers_school_id_language_level_key
  unique (school_id, language, level);
