# Integrated schools — rollout notes

Migration `0016_integrated_schools.sql` has **not been applied**. Read this before you run it.

## What it changes

| Object | Change | Risk |
|---|---|---|
| `schools.is_integrated` | new `boolean not null default false`, backfilled where the name matches `\yintegrated\y` | none — additive |
| `school_papers.level` | new `text not null default 'whole'` | none — every existing row means exactly "the school's one paper", which is what `whole` means |
| `school_papers` unique | `(school_id, language)` → `(school_id, language, level)` | **loosening**, so it cannot reject data that was previously valid |

The constraint change is in the safe direction: every row that satisfied the old constraint satisfies the new one, so the migration cannot fail on existing data.

## The one thing to decide before applying

**An integrated school that has already filed a paper will have that paper stranded.**

The backfill sets `is_integrated = true` from the name, and sets every existing paper to `level = 'whole'`. But an integrated school is supposed to hold `elementary`/`secondary` rows, so its old `whole` row now contradicts its school. `levelBelongsTo()` returns false for it, which means the application deliberately ignores it: the school sees four empty slots and its previously filed paper is not among them.

That behaviour is correct for a school reclassified *later*. It is wrong as a migration outcome, because the paper was filed in good faith under the old rules.

**Find out whether this affects anyone before applying.** Run this read-only query first:

```sql
select s.name,
       s.is_integrated,
       count(p.id)                              as papers_on_file,
       string_agg(p.language || '/' || p.level, ', ' order by p.language) as rows
  from schools s
  join school_papers p on p.school_id = s.id
 where s.name ~* '\yintegrated\y'
 group by s.name, s.is_integrated
 order by s.name;
```

- **No rows** — nothing is stranded. Apply the migration as written; there is nothing to decide.
- **Some rows** — pick one of these, and say which so the choice is on the record:

  1. **Assign the existing paper to a level.** One `UPDATE` per affected school, choosing elementary or secondary from what the paper actually is. Preserves the data and the school keeps editing it. Requires someone to look at each paper — there are unlikely to be many.
  2. **Leave them stranded and tell the schools to re-file.** Nothing is deleted; the rows stay in the table and can be read by hand or reassigned later. Cheapest, but a school that already did the work is asked to do it again.

  Option 1 is the right default when the count is small. Do not guess the level from the paper name.

## Applying it

The repo has no migration runner wired up — migrations in `supabase/migrations/` are applied through the Supabase SQL editor or CLI. Whichever you use, run the query above first.

The migration is idempotent (`add column if not exists`, `drop constraint if exists`), so a partial run can be repeated safely.

## What was deliberately not enforced in the database

An integrated school should hold only `elementary`/`secondary` rows, and every other school only `whole` rows. That pairing spans two tables, so a `CHECK` cannot express it — it would need a trigger. Adding a cross-table trigger to a live competition database mid-season is more risk than the invariant is worth, so the rule lives in `lib/paper/level.ts` (`levelBelongsTo`) and read paths ignore a row that contradicts its school rather than rendering a paper that should not exist.

If the competition ever runs quiet, a trigger is the durable fix.

## Verifying after you apply

```sql
-- how many schools were flagged
select count(*) from schools where is_integrated;

-- no school holds a row that contradicts it
select s.name, p.language, p.level
  from schools s join school_papers p on p.school_id = s.id
 where (s.is_integrated and p.level = 'whole')
    or (not s.is_integrated and p.level <> 'whole');
```

The second query should return **no rows** once any stranded papers from the decision above have been reassigned.

## Known gaps, named rather than left to be rediscovered

These came out of building the feature. None blocks the rollout; all three are real.

**1. A stale paper disappears with no warning.** If the office flips `is_integrated` to true on a school that has already filed a `whole` paper, `paperSlots` correctly refuses to count that row — so the paper vanishes from the admin table, from the status counts and from the language filter, with nothing on screen saying it exists. Deleting nothing is the right call; saying nothing is not. The "Verifying after you apply" query above is the manual detector. An admin-side surface for it would be better, and matters *more* precisely because the invariant is unenforced in the database.

**2. There is no way to ask "which integrated schools still owe a paper".** An integrated school that filed one of four papers reads `submitted`, because `paperStatus` has never been about completeness — it answers "did this school answer the contest question", and a non-integrated school with one of two languages has always read the same way. That is consistent and was deliberately left alone. But it means the obvious follow-up question is unaskable. `AdminSchoolPaperRow` already carries `completeLanguages`, so the cheapest fix is a `completeness=partial|complete` filter on `/admin/school-papers` — one dropdown, no overlap with the existing "Language on file (any level)" one.

**3. `integrated` is a member of `SchoolStatus`, which conflates two axes.** The other five values answer *how far has this school got*; this one answers *what kind of school is it*. Because they share one union they can never be combined, so "integrated schools that have not entered" cannot be expressed on `/admin/schools`. It was built this way because it is small and satisfies the request; the shape that lasts is a separate `?integrated=1` boolean alongside `status`. Worth changing before anyone builds a report on top of the current filter.

## What is not covered by tests

The pure logic is well covered — `levelsForSchool`, `levelBelongsTo`, `paperSlots`, the name rule, the registry filter and the admin row mapper all have tests, including stale-row cases.

What has **no** test, and cannot easily get one:

- **The migration itself.** Nothing in this repo runs SQL in CI, so the `\y` word-boundary regex, the constraint swap and the backfill are unverified against a real Postgres. The first run *is* the test — which is why the query in "The one thing to decide" should be run first, on a database you can afford to be surprised by.
- **The upsert conflict target.** `onConflict: "school_id,language,level"` must name the new constraint exactly. A mismatch does not fail at compile time; it fails at runtime the first time a school saves a paper.
- **Every screen.** No browser pass has been run on any of this.
