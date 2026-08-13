# Press Link v3 — Roster-First Entry & School Paper Gate

Supersedes §2 (entry flow) of `2026-08-13-press-link-v2-design.md`. The auth
model, RLS shape, school seeding, event catalog, and design system from v2 are
unchanged. Everything below is additive or replaces the participant/coach
half of the entry wizard.

## 1. Why

v2 types participant names straight into the entry wizard. That makes three
things impossible:

1. **No identity.** The same contestant typed into two entries is two
   unrelated rows, so nothing can enforce "a pupil may join at most two
   individual contests and one group contest."
2. **No participant number.** The division office numbers contestants
   0001, 0002, … Nothing in the app issues one.
3. **No school-paper opt-out.** Every school is silently expected to
   submit a paper; a school that isn't submitting one has no way to say so.

v3 makes the roster the primary object: a school registers its people
first, then builds entries by *selecting* from that roster.

## 2. School paper gate

On reaching `/entry`, a school whose `schools.paper_participation` is
`'undecided'` sees a blocking dialog: **"Is your school submitting a school
paper this year?"** — Yes / No. It cannot be dismissed.

- **Yes** → `paper_participation = 'yes'`, the School Paper dialog opens
  immediately for the school to fill in. Same form as v2 (English +
  Filipino tabs).
- **No** → `paper_participation = 'no'`. The School Paper section becomes
  read-only, labelled **"Not submitting — awaiting admin"**. The school
  proceeds to participants, coaches, and entries normally; nothing else is
  blocked.
- An admin can reset a school to `'undecided'` from `/admin/participants`,
  which re-opens the gate on that school's next visit. This is the only way
  back from `'no'`.

`paper_participation` is written through a `security definer` RPC so a
school cannot update any other column of its own `schools` row.

## 3. Roster

Two new school-owned tables. Both are managed on `/entry` before any entry
exists.

### `participants`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| school_id | uuid not null → schools(id) | |
| participant_number | int not null unique | division-wide, from a sequence |
| first_name | text not null | |
| middle_name | text | optional |
| last_name | text not null | |
| gender | text not null check ('M','F') | |

`participant_number` comes from `participant_number_seq` (start 1, maxvalue
9999). It is **unique across the whole division**, not per school — the
first participant registered anywhere is 0001, the next is 0002. The UI
always renders it zero-padded to four digits (`0007`). Numbers are never
reused; deleting a participant leaves a gap.

### `coaches`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| school_id | uuid not null → schools(id) | |
| full_name | text not null | complete name, one field |
| gender | text not null check ('M','F') | |

Coaches get no number.

## 4. Entries reference the roster

`entry_participants` and `entry_coaches` stop storing names. They become
join rows:

- `entry_participants (id, entry_id, participant_id)` — unique on
  `(entry_id, participant_id)`.
- `entry_coaches (id, entry_id, coach_id)` — unique on `(entry_id, coach_id)`.

Existing rows are backfilled into `participants` / `coaches` by name before
the name columns are dropped, so no production data is lost.

In the wizard's final step there are **no name inputs**. Participants and
coaches are chosen from dropdowns listing the school's roster. Anyone who
has hit their cap is rendered but `disabled`, with the reason shown
("2 individual events").

## 5. Participation caps

Counted across a participant's whole history, not per entry:

| Category | Cap |
|---|---|
| Individual | at most **2** individual entries |
| Group | at most **1** group entry |

A participant at the cap for the category being built is disabled in the
picker. The same participant may never appear twice in one entry.

Caps are enforced twice: in the picker (disabled options) and in
`saveEntryAction` (authoritative — the picker is a convenience). When
editing an existing entry, that entry's own rows are excluded from the
count so re-saving an unchanged entry never trips the cap.

## 6. Per-event participant and coach counts

`event_types` gains `min_participants` and `max_participants`
(`max_participants` null = unbounded).

| Event type | min | max |
|---|---|---|
| All 10 individual types | 1 | 3 |
| radio-broadcasting-regular | 7 | 7 |
| radio-broadcasting-spj | 7 | 7 |
| collaborative-publishing | 7 | 7 |
| tv-broadcasting-regular | 7 | 7 |
| tv-broadcasting-spj | 7 | 7 |
| online-publishing | 2 | — |

Individual events open with one participant slot and an **Add participant**
button that stops at 3.

Coach counts are derived, not stored:

| Category | Coaches allowed |
|---|---|
| Individual | 1 … *number of participants in this entry* (so a 2-participant entry allows at most 2 coaches) |
| Group | 1 … 2 |

Removing participants from an individual entry down below the coach count
trims the coach list to match.

## 7. Admin: participants view

New page `/admin/participants`, linked from the admin header.

Columns: No. · Participant · Gender · School · District · Events · Actions.

- **Events** is the count of entries the participant appears in.
- A participant in more than one event is prefixed with an **asterisk**
  (`*0007`) and their row is tinted, so a scan finds them without reading
  the count column.
- A **"Multi-event only"** toggle (`?multi=1`) filters the list to
  participants with `events > 1`.
- District and school filters reuse the v2 `FilterBar` semantics.
- Each school row carries a **Reset paper answer** action that sets that
  school's `paper_participation` back to `'undecided'`.

## 8. Out of scope

- Editing a participant's number, or reusing freed numbers.
- Merging duplicate participants.
- Bulk roster import.
- Changing the event catalog, auth, or the design system.
