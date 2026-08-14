# Two-Stage School Paper Flow — Spec

**Date:** 2026-08-14
**Replaces:** the single-question flow shipped in `66c1cb7`, `59fe2f3`, `85d7b89`.

## Problem

Today a school that signs in is trapped: it must fill **both** the English and
Filipino school paper, and then answering "No" to one question signs it out and
keeps its roster shut forever until the division office resets it. Schools that
publish in only one language, or that are not entering the school paper
contest, cannot get past the gate at all.

## The new flow

After a school signs in, it works through two required stages before the roster
(participants and coaches) opens.

### Stage 1 — School paper information

- The school fills in its school paper details for **English**, **Filipino**, or
  **both**. Neither language is individually required.
- Every text field is **pre-filled with `N/A`** so a school with nothing to
  report can save immediately.
- Stage 1 is complete once **at least one language** has been saved.
- Until one language is saved, the School Paper dialog is forced open and cannot
  be dismissed (Escape, overlay click and the close button are all off).

### Stage 2 — The contest question

Once stage 1 is complete, the school is asked exactly one question:

> **Are you submitting this school paper to the school paper contest?**

- **Yes** — the information is recorded as a contest submission.
- **No** — the information is retained and saved, and nothing is submitted to
  the contest.

Neither answer signs the school out. **Both answers open the roster.** The
question is only forced once; afterwards the school may change its answer from
the dashboard at any time, until it locks its details.

### Editing and locking

- School paper information and the contest answer stay **editable at any time**
  after stage 2.
- The School Paper dialog carries a **"Lock in details"** button with a
  confirmation step. Locking freezes the paper information *and* the contest
  answer.
- A locked school cannot edit either. Only the division office can reopen it,
  via the existing **Reset answer** control on `/admin/participants`, which now
  also clears the lock.
- The lock is enforced in the database, not only in the UI: a locked school's
  writes to `school_papers`, `paper_staff` and `set_paper_participation` are
  refused.

### Status labels

Three states, shown wherever a school's paper standing appears:

| State | When | Label |
|---|---|---|
| `incomplete` | no language saved yet | **Not started** |
| `saved` | ≥1 language saved, answered No | **Info saved only** |
| `submitted` | ≥1 language saved, answered Yes | **Submitted to contest** |

A school between stage 1 and stage 2 (saved, `undecided`) is `incomplete`.
Locked schools show the same label plus a **Locked** marker.

Labels appear on:

1. `/entry` — the school's own dashboard, beside the School Paper button.
2. `/admin/participants` — replacing the current "Submitting / Not submitting"
   text in the *School paper* column.
3. `/admin` — as summary tiles counting schools per state.

## Explicitly out of scope

Nothing else changes. The entry wizard, participant numbering, per-event limits,
the export workbook, login, and the submissions lock all stay exactly as they
are.

## Data model changes

- `schools.paper_locked_at timestamptz` — null until the school locks in.
- `schools.paper_participation` keeps its `undecided | yes | no` values, but
  `no` now means *"saved, not entering the contest"* rather than *"declined,
  stay signed out"*.
- Because those two meanings are incompatible, the migration does not carry old
  `no` rows forward: it resets them to `undecided` with a null
  `paper_answered_at`, so the school is asked the new question once. Under the
  old rules such a school was going to be re-asked at its next sign-in anyway,
  so nothing it actually decided is lost.
- Old `yes` rows keep their answer and gain a `paper_locked_at` stamped at
  `paper_answered_at`, since the old Yes froze the papers and the lock is now
  the only thing that does.
- Both rewrites run only on the migration's first application (guarded on
  `paper_locked_at` not yet existing), so a re-run cannot re-freeze a school the
  division office reopened, nor wipe a `no` given under the new flow.
- `set_paper_participation(choice)` requires **≥1** saved language (was 2) and
  refuses when `paper_locked_at` is set.
- New `lock_school_paper()` definer RPC for the school.
- `admin_reset_paper_participation(uuid)` also clears `paper_locked_at`.
