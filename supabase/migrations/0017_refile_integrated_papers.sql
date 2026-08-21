-- Integrated schools must re-file their school paper, one per level.
--
-- Run 0016 first: this depends on `schools.is_integrated` and on
-- `school_papers.level` existing.
--
-- A school paper filed before its school was known to be integrated covers
-- "the school", which for an integrated school is no longer a thing it can
-- file — it owes an elementary paper and a secondary paper, with different
-- names, advisers and section heads. There is no honest way to split one row
-- into two, and guessing which level an existing paper described would put a
-- wrong adviser against a real contest entry.
--
-- So the row is retired and the school files again.
--
-- WHAT THIS DOES NOT TOUCH: participants, coaches, entries, entry_participants,
-- entry_coaches, and every school that is not integrated. No statement below
-- names any of them. A school's roster and its event entries survive this
-- migration exactly as they were.

-- 1. Somewhere for the retired rows to go.
--
-- An archive table rather than an `invalidated_at` flag on `school_papers`,
-- because the flag would change the meaning of `school_papers(count)` in four
-- places that currently read it as "has this school filed anything" — and each
-- would have to learn to exclude invalidated rows or start lying. Moving the row
-- out keeps `school_papers` meaning exactly what it means today, so no existing
-- query changes.
--
-- `paper_staff` is inlined as jsonb rather than archived to a second table:
-- `paper_staff.school_paper_id` cascades on delete, so the staff would be
-- destroyed by step 3 otherwise, and a second archive table with its own FK to a
-- retired row is more machinery than a read-only record needs.
create table if not exists school_papers_archive (
  id uuid primary key,
  school_id uuid not null references schools(id),
  language text not null,
  level text not null,
  paper_name text not null,
  adviser_name text not null,
  adviser_gender text not null,
  principal_name text not null,
  submitted_at timestamptz,
  updated_at timestamptz not null,
  staff jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now(),
  archived_reason text not null
);

comment on table school_papers_archive is
  'School papers retired rather than deleted. Read-only history; nothing writes here except a migration.';

alter table school_papers_archive enable row level security;

-- The school may read its own retired paper, so the form can say what was on
-- file before and the school is not asked to reconstruct it from memory.
drop policy if exists "school read own archived papers" on school_papers_archive;
create policy "school read own archived papers" on school_papers_archive for select
  using (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read archived papers" on school_papers_archive;
create policy "admin read archived papers" on school_papers_archive for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

-- 2. Copy the affected rows out, with their staff.
--
-- Only rows that are BOTH on an integrated school AND level 'whole'. A school
-- that has already filed levelled papers is not touched, so this migration is
-- safe to re-run: the second run finds nothing to move.
insert into school_papers_archive (
  id, school_id, language, level, paper_name, adviser_name, adviser_gender,
  principal_name, submitted_at, updated_at, staff, archived_reason
)
select p.id, p.school_id, p.language, p.level, p.paper_name, p.adviser_name,
       p.adviser_gender, p.principal_name, p.submitted_at, p.updated_at,
       coalesce(
         (select jsonb_agg(jsonb_build_object('full_name', st.full_name, 'title', st.title)
                           order by st.title, st.full_name)
            from paper_staff st
           where st.school_paper_id = p.id),
         '[]'::jsonb
       ),
       'Integrated school: one paper per level is now required, so this paper must be re-filed.'
  from school_papers p
  join schools s on s.id = p.school_id
 where s.is_integrated
   and p.level = 'whole'
   and s.submission_locked_at is null
   and not exists (select 1 from school_papers_archive a where a.id = p.id);

-- 3. Remove them from the live table.
--
-- `paper_staff` rows cascade away with their paper; step 2 already captured them
-- as jsonb, so nothing is lost. After this the school's paper slots read empty
-- and the entry flow asks it to file again.
delete from school_papers p
 using schools s
 where s.id = p.school_id
   and s.is_integrated
   and p.level = 'whole'
   and s.submission_locked_at is null;

-- 4. Their contest answer is deliberately left alone.
--
-- `schools.paper_participation` records whether the school is entering the
-- school paper contest. That answer is still true — only the paper details need
-- re-filing — so resetting it to 'undecided' would ask a school to re-answer a
-- question it already answered, and would reset `paper_answered_at`, which the
-- dashboard's activity feed reads as a real event.

-- 5. Locked schools are deliberately skipped, and need a decision by hand.
--
-- A locked school cannot re-file: paperFlowState returns paperFormOpen:false for
-- it, so retiring its paper would leave it with nothing on file and no way to
-- put anything back. Worse, paperStatus reads "a locked school's answer is final
-- whatever its rows look like now" — written when a locked school always had a
-- paper — so it would go on reporting "Submitted to contest" with zero papers
-- on file. That is a false claim about the competition record, and no school
-- could correct it.
--
-- So this migration touches none of them. Find them with:
--
--   select s.name, s.submission_locked_at, count(p.id) as papers
--     from schools s join school_papers p on p.school_id = s.id
--    where s.is_integrated and p.level = 'whole'
--      and s.submission_locked_at is not null
--    group by s.name, s.submission_locked_at
--    order by s.name;
--
-- For each one: unlock it (admin_unlock_submission), let the school re-file its
-- two levels, then lock it again. Re-running this migration afterwards is safe
-- and will pick up any that were unlocked in the meantime.
