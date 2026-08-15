# Per-School Submission Lockdown — Spec

**Date:** 2026-08-15
**Revises:** the school-paper lock from `2026-08-14-two-stage-school-paper.md` and the
admin page from `2026-08-14-admin-school-papers-and-coaches.md`.

## Problem

The lock a school applies to itself only freezes its school paper. Its roster
and entries stay editable, so "Lock in details" does not mean what a school
reads it to mean — there is no way for a school to declare its whole submission
final. And the control is buried inside the School Paper dialog, where a school
that wants to finalise everything would not think to look.

## What this changes

### 1. The lock covers the whole submission

Locking freezes **everything the school owns**: school paper details, the
contest answer, participants, coaches, and every entry. The school keeps full
read access — it can see its submission, just not change it.

Enforcement is at the database, not only in the UI: triggers reject writes from
the locked school on `school_papers`, `paper_staff`, `participants`, `coaches`,
`entries`, `entry_participants` and `entry_coaches`. As today, the triggers are
scoped to the acting school (`auth_user_id = auth.uid()`), so the division
office and the service role can still repair data.

### 2. The lock button moves

It leaves the School Paper dialog and sits **beside the School Paper button** on
the school's dashboard, where the submission as a whole is visible.

### 3. Locking requires at least one entry

The current rule — the contest question must be answered — is not enough for a
lockdown. A school must also have **at least one entry** before it can declare
itself finished, so nobody locks an empty submission by mis-click.

### 4. The confirmation names what is being frozen

A destructive-styled dialog, listing exactly what becomes read-only — school
paper, contest answer, participants, coaches, entries — and stating plainly that
only the division office can reopen it. One confirming click; no typed phrase.

### 5. The admin page manages locked submissions

`/admin/school-papers` already lists every school with a lock filter and an
Unlock action. Its meaning widens with the lock: the Unlock action now reopens
the school's **whole submission**, and the page's copy says so. The URL stays
the same so existing links keep working.

Unlock still lifts only the lock. The school's contest answer is untouched, and
it is not re-asked the question — that remains the separate "Reset answer"
control on `/admin/participants`.

## Naming

`schools.paper_locked_at` becomes `schools.submission_locked_at`, and the RPCs
follow:

| Before | After |
|---|---|
| `lock_school_paper()` | `lock_submission()` |
| `admin_unlock_school_paper(uuid)` | `admin_unlock_submission(uuid)` |

`PaperFlowState.paperFormLocked` becomes `submissionLocked` for the same reason.
Leaving the old names would have every future reader believe a paper-scoped flag
gates entries and roster.

## Explicitly out of scope

The two-stage paper flow itself (fill, then the contest question), participant
numbering, per-event limits, the export workbook, the coaches page, and login
all stay exactly as they are. `paper_participation` keeps its three values.

## Data model changes

- `schools.submission_locked_at` **added** and backfilled from
  `paper_locked_at`. The old column is left in place and dropped by a separate,
  later migration — see Deployment below.
- `lock_school_paper()` replaced by `lock_submission()`, which additionally
  refuses unless the school has at least one entry.
- `admin_unlock_school_paper(uuid)` replaced by `admin_unlock_submission(uuid)`.
- `set_paper_participation` and `admin_reset_paper_participation` updated to
  write the new column; their behaviour is otherwise unchanged.
- Lock-guard triggers extended from 2 tables to 7.

## Deployment

A straight `rename column` would break the running deployment the moment it ran,
because the live code selects `paper_locked_at` by name — the same failure this
project has already hit twice. So the change is staged instead:

1. **Apply `0011`** — adds and backfills `submission_locked_at`, installs the new
   RPCs and triggers, and leaves `paper_locked_at` untouched. The running code
   keeps reading the old column and keeps working.
2. **Deploy the code.** It reads and writes only `submission_locked_at`.
3. **Apply `0012`** — drops `paper_locked_at` and the two superseded RPCs.

Between steps 1 and 2 the old column stops being updated, so a lock applied in
that window would be invisible to the old code until the deploy lands. The
window is a deploy long and the consequence is a school briefly still able to
edit, which is why this is acceptable and an outage is not.

The same window runs in reverse for unlocks: `admin_reset_paper_participation`
now clears only `submission_locked_at`, so a school the office reopens in that
window still has `paper_locked_at` set and still looks locked to the old code
until the deploy lands — the same deploy-length window and the same acceptable
consequence, just the opposite direction.
