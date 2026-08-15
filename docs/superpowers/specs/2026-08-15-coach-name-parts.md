# Coach Name Parts — Spec

**Date:** 2026-08-15

## Problem

Participants are registered as **first name, middle name, last name** and display
surname-first — "Dela Cruz, Ana M." Coaches, on the same Roster panel one tab
away, take a single "Complete name" field and display whatever the school typed.

The inconsistency is visible on one screen, and it costs the division office the
thing the participant fields were built for: names it can sort, match and print
in a consistent order. A school typing "Ana Dela Cruz" for a participant and
"Dela Cruz, Ana" for that person's coach produces two different orderings in the
same export.

## What this changes

Coaches become identical to participants, everywhere:

- **Input** — three fields: First name, Middle name (optional), Last name.
  Same labels, same order, same optionality as the Participants tab.
- **Display** — surname-first, built once on the server: `"Dela Cruz, Ana M."`
  wherever a coach's name appears: the roster table, the entries table, the entry
  wizard's coach picker, `/admin/coaches`, `/admin`, and the Excel export.
- **Sorting** — by the same derived name, so coaches and participants order
  alike.

Nothing else about coaches changes: gender stays, the per-school roster stays,
the entry links stay, and the submission lock keeps covering them.

## Existing data

The division office confirms **no school has registered a coach yet** on the live
database, so there is nothing to split and no lossy backfill to design.

The migration does not rely on that being true. It backfills any row it finds by
putting the whole existing string into **last name**, leaving first name empty —
a no-op when the table is empty, and a lossless, obviously-wrong-looking result
if it is not, which a school can correct in seconds. It never guesses at word
boundaries: a naive split turns "Juan Dela Cruz" into the surname "Cruz" with
"Dela" as a middle name, and does it silently.

## Data model changes

- `coaches` gains `first_name text not null`, `middle_name text`,
  `last_name text not null`, matching `participants` exactly.
- `coaches.full_name` becomes nullable, then is dropped by a later migration.

## Deployment

The same staging this project now uses for every rename, for the same reason —
dropping a column the running deployment still selects takes the site down:

1. **Apply `0013`** — adds the three columns, backfills, and makes `full_name`
   nullable so the new code can insert without it. The running code keeps
   reading `full_name` and keeps working.
2. **Deploy the code.** It reads and writes only the three parts.
3. **Apply `0014`** — drops `full_name`.

Between steps 1 and 2, a coach added by the old code writes only `full_name` and
would show blank once the new code is live. With no coaches yet and a
deploy-length window, that is acceptable.
