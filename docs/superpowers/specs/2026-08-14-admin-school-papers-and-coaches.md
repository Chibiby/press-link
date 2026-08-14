# Admin School Papers & Coaches — Spec

**Date:** 2026-08-14
**Builds on:** the two-stage school paper flow (`2026-08-14-two-stage-school-paper.md`).

## Problem

Three gaps, all on the admin side.

1. **A locked school can become unreachable.** A school may answer the contest
   question and lock its details before registering anyone. The only Reopen
   control lives on `/admin/participants`, attached to a *participant row* — so
   a school with no participants appears in that table zero times and the
   division office cannot reach it at all. Today such a school can only
   unstick itself, by adding a participant.
2. **The global "Lock submissions" switch is the wrong tool.** It freezes every
   school at once and is not what the division office reaches for day to day.
   It is being removed.
3. **Coaches have no admin surface.** Participants have a division-wide table;
   coaches do not, so there is no way to answer "who is coaching what".

## What this builds

### 1. Remove the global submissions lock

`app_settings.submissions_locked`, the `LockToggle` control, the
`setSubmissionsLockedAction` server action, every `locked` check in the entry
and roster actions, and every "Submissions are closed" affordance in the UI all
go. Schools may edit their entries and roster for as long as the site is up;
the division office no longer has a division-wide freeze.

The `app_settings` table holds nothing else, so it is dropped with the column.

Two consequences worth stating, because they are the point rather than side
effects:

- The `locked` prop disappears from `EntryDashboard`, `RosterPanel`,
  `EntriesTable` and `SchoolPaperDialog`. `SchoolPaperDialog`'s `locked` becomes
  purely the *school paper* lock (`paperFlow.paperFormLocked`).
- The global-lock trap fixed in `5fbc376` stops existing: `paperOpen` reverts to
  `paperFlow.paperFormOpen`, since there is no longer a second lock to yield to.

**The per-school paper lock (`schools.paper_locked_at`) is unaffected.** It is a
different mechanism and stays exactly as it is.

### 2. `/admin/school-papers`

One row per school in the division — every school, whether or not it has
registered anyone. Columns: school, district, status, languages on file,
locked state, last answered.

Status uses the existing three labels: **Not started**, **Info saved only**,
**Submitted to contest**.

**Filters:** district, school, status (submitted to contest / info saved only /
not started), lock state (locked / unlocked), and language on file (has English
/ has Filipino).

**Unlock action**, on locked rows only: lifts `paper_locked_at` and **leaves the
contest answer standing**. The school can edit its information and change its
answer again; it is not re-asked the question. This is a new definer RPC,
distinct from the existing `admin_reset_paper_participation`, which clears the
answer as well and stays available on `/admin/participants`.

### 3. `/admin/coaches`

One row per coach: name, gender, school, district, and how many entries they
are attached to — mirroring `/admin/participants`, including the asterisk
convention for a coach on more than one entry.

**Filters:** district, school, gender, multi-entry only, unassigned only
(registered but on no entry), and the event dimensions — event, category, level,
language — matching the filters already on `/admin`.

### 4. Navigation

The admin dashboard header currently carries a Participants link and the lock
toggle. It becomes three links: **Participants**, **Coaches**, **School Papers**.

## Explicitly out of scope

The school-facing flow, the entry wizard, participant numbering, the export
workbook, and login all stay as they are. No new columns beyond what the unlock
RPC needs (none).

## Data model changes

- New `admin_unlock_school_paper(target_school uuid)` definer RPC: admin-only,
  sets `paper_locked_at = null` and touches nothing else.
- `app_settings` table dropped, with its RLS policy.

**Deployment order matters.** The `app_settings` drop must run *after* the code
that reads it is deployed, or every school and admin page throws. The unlock RPC
is additive and may be applied at any time.
