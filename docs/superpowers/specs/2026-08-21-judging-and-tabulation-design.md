# Judging and tabulation — design contract

Status: authoritative. Every task in this feature builds against this file. Where a
task disagrees with this document, this document is right and the task is a bug.

Written 2026-08-21. Decisions 1–4 were taken by the division office; they are
recorded here with their consequences so no later task quietly re-decides one.

---

## 0. What this feature is

Two portals over one ranking model.

- **Judges portal** (`/judge`, judges' own login). Per event, a judge sees only
  anonymous **codes** and gives each one a **rank**. Round 1 covers everyone.
  Round 2 covers qualifiers only. A submitted sheet locks.
- **Tabulators portal** (`/admin/tabulators`, division console). Per event, the
  full identified sheet: code, name, coach, school paper, school, district,
  round-1 rank, round-2 rank, total rank, final rank.

The anonymity boundary is the point of the split, and it is enforced in the
database, not in a page. A judge cannot read `participants`, `schools` or
`entries` — RLS already denies all three — so the judge portal is fed by
`security definer` functions that return codes and nothing else.

---

## 1. Decisions

### D1 — A panel of judges, ranks are summed

Each judge assigned to an event ranks independently. For a round, a unit's
**points** are the sum of the ranks the judges gave it, and the round's
**rank** is the placement of those points, ascending. One judge is the
degenerate case (sum of one), so nothing special-cases panel size.

### D2 — Judges have their own accounts

`/judge/login` → `/judge` (their events) → `/judge/[eventId]` (the sheet).
Admin oversight lives at `/admin/judges`: create a judge, assign them to
events, watch progress, unlock a sheet, close round 1.

### D3 — Round 2 cut is per event, default 10, ties at the line all advance

`events.round2_cut`. Qualifying is `round1Rank <= cut`. Because round 1 uses
competition ranking (1, 2, 2, 4), a three-way tie for 10th produces three rows
at rank 10 and all three pass `<= 10` — so a tie at the cut line advances
whole, and 12 contestants can qualify under a cut of 10. This is not a special
case in the code; it falls out of the rank function, and the test pins it.

### D4 — Round 2 alone decides the winners

Round 1 selects who advances and nothing more.

- **Final rank, qualifiers**: placement by round-2 points, ascending. A tie on
  round-2 points is broken by the better round-1 points. Two units identical on
  both genuinely tie and share the place.
- **Final rank, non-qualifiers**: they sit below every qualifier, ordered among
  themselves by round-1 points. Their block starts at `qualifierCount + 1`.
- **Total rank** is `round1Rank + round2Rank`. It is **informational** — the
  division asked for the column, and D4 means it does not decide anything. Every
  surface that prints it must say so. Do not sort by it, do not break ties with
  it, do not call it official.
- Each round also shows its **points** (the judges' ranks added) beside the
  round rank, so a tabulator can see how a placement was produced without
  reading the database.

---

## 2. The ranked unit

Per event, one row of the sheet is one **contest unit**:

| Event category | Unit | Code |
|---|---|---|
| `individual` | each participant on each entry | `participants.participant_number`, 4 digits |
| `group` | each entry (the team) | `entries.entry_number`, 4 digits |

An individual event carries up to three contestants per school and each is
ranked separately — this is why the unit is the participant and not the entry.
A group event ranks the team, so `participantId` is null.

`unitKey` is the string identity used everywhere: `participantId` when there is
one, otherwise `entryId`. It is what a judge's rank is keyed on, what the
qualifier set holds, and what joins the anonymous board to the identified one.

An event is wholly individual or wholly group, so one 4-digit code space per
event never mixes the two kinds and needs no prefix.

---

## 3. Schema — migration `0018_judging_and_tabulation.sql`

Follow the house style of 0016/0017: say why, not what; guard every statement so
the file is safe to re-run; never touch a table this feature does not own.

```sql
-- events: the per-event round 2 cut
alter table events add column if not exists round2_cut int not null default 10;
alter table events add constraint events_round2_cut_check check (round2_cut >= 1);

-- entries: an anonymous, stable team code
create sequence if not exists entry_number_seq start with 1 minvalue 1 maxvalue 9999;
alter table entries add column if not exists entry_number int unique default nextval('entry_number_seq');
-- backfill in submitted_at order, then set not null.
-- NOTE: the backfill UPDATE passes entries_locked_guard because that trigger only
-- raises when auth.uid() equals the school's auth_user_id; a migration has no uid.

create table if not exists judges (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  first_name text not null,
  middle_name text,
  last_name text not null,
  email text,
  affiliation text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists judge_assignments (
  id uuid primary key default gen_random_uuid(),
  judge_id uuid not null references judges(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  seat int not null check (seat >= 1),
  created_at timestamptz not null default now(),
  unique (judge_id, event_id),
  unique (event_id, seat)
);

create table if not exists judge_sheets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  judge_id uuid not null references judges(id) on delete cascade,
  round int not null check (round in (1, 2)),
  submitted_at timestamptz,             -- null = open, set = locked
  updated_at timestamptz not null default now(),
  unique (event_id, judge_id, round)
);

create table if not exists judge_ranks (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references judge_sheets(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  rank int not null check (rank >= 1)
);
-- one rank per unit per sheet. participant_id is null for group events and
-- Postgres treats NULLs as distinct in a unique constraint, so the key coalesces.
create unique index if not exists judge_ranks_unit_key on judge_ranks
  (sheet_id, entry_id, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- and no two units share a place on one sheet: a rank-sum only means something
-- if each judge produced a strict order.
create unique index if not exists judge_ranks_place_key on judge_ranks (sheet_id, rank);

-- Who advanced, decided once, in writing.
--
-- Materialised rather than derived on every read so that (a) the qualifier rule
-- lives in ONE place — lib/judging, TypeScript — instead of being re-implemented
-- in SQL for the judge portal, and (b) the judge portal can be handed the
-- qualifier codes without also being handed the round-1 standings, which would
-- bias round 2.
create table if not exists round2_qualifiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  round1_points int not null,
  round1_rank int not null,
  created_at timestamptz not null default now()
);
create unique index if not exists round2_qualifiers_unit_key on round2_qualifiers
  (event_id, entry_id, coalesce(participant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- When round 1 was closed for an event, and the cut that was in force.
create table if not exists event_rounds (
  event_id uuid primary key references events(id) on delete cascade,
  round1_closed_at timestamptz,
  round1_closed_by uuid references auth.users(id),
  round2_cut_used int,
  results_locked_at timestamptz,
  results_locked_by uuid references auth.users(id),
  -- The official standings, frozen at results lock. An entry deleted afterwards
  -- must not silently change a published placement.
  standings jsonb
);
```

### RPCs

All `security definer`, `set search_path = public`, `revoke all ... from public`,
`grant execute ... to authenticated`.

Judge-facing:

- `judge_event_units(p_event_id uuid)` → `setof (unit_key text, code text, entry_id uuid, participant_id uuid)`
  Authorised for an assigned active judge **or** an admin. Returns codes only —
  no names, no school. This is the anonymity boundary.
- `judge_round2_units(p_event_id uuid)` → same shape, restricted to
  `round2_qualifiers`, and empty until round 1 is closed. Ordered by code, never
  by round-1 standing.
- `judge_my_sheets(p_event_id uuid)` → `setof (round int, submitted_at timestamptz, unit_key text, rank int)`
  The caller's own sheets only. A judge never sees another judge's ranks.
- `judge_submit_sheet(p_event_id uuid, p_round int, p_ranks jsonb)` → `void`
  `p_ranks` is `[{"unit_key": "...", "rank": 1}, ...]`. Rejects unless: the
  caller is an assigned active judge; the sheet is not already submitted; the
  round is open (round 2 requires `round1_closed_at`); the ranks cover exactly
  the round's unit set, once each; the ranks are exactly `1..N` with no repeats.
  Writes the sheet and its ranks atomically and sets `submitted_at` — submitting
  **is** locking, per the division's "once naka rank, i-lock".
- `judge_my_events()` → `setof (event_id uuid, seat int)` for the signed-in judge.

Admin-facing (each re-checks `admin_profiles` and raises `not authorized`):

- `admin_set_round2_cut(p_event_id uuid, p_cut int)` — refused once round 1 is
  closed for that event; the cut that produced a qualifier list may not move
  under it.
- `admin_assign_judge(p_judge_id uuid, p_event_id uuid)` — allocates the next
  free seat. Refused once any sheet for that event is submitted: a panel that
  grows mid-event makes the earlier sums incomparable.
- `admin_unassign_judge(p_judge_id uuid, p_event_id uuid)` — refused if that
  judge has a submitted sheet for the event.
- `admin_unlock_judge_sheet(p_event_id uuid, p_judge_id uuid, p_round int)` —
  clears `submitted_at`. Refused once round 1 is closed (for round 1) or results
  are locked, so an unlock can never contradict a published qualifier list.
- `admin_close_round1(p_event_id uuid, p_cut_used int, p_qualifiers jsonb)` —
  requires every assigned judge to have a submitted round-1 sheet. Replaces
  `round2_qualifiers` for the event and stamps `round1_closed_at`. The qualifier
  list is computed in TypeScript by `lib/judging` and passed in, so the rule has
  exactly one implementation.
- `admin_reopen_round1(p_event_id uuid)` — clears the close and the qualifier
  list. Refused if any round-2 sheet is submitted or results are locked.
- `admin_lock_results(p_event_id uuid, p_standings jsonb)` — requires every
  assigned judge to have a submitted round-2 sheet. Freezes the snapshot.
- `admin_unlock_results(p_event_id uuid)`.

### RLS

- `judges`: a judge selects their own row (`auth_user_id = auth.uid()`); admin
  selects all. No client-side insert/update — judge creation runs through the
  service-role client in a server action.
- `judge_assignments`, `judge_sheets`, `judge_ranks`: the owning judge selects
  their own; admin selects all. **No client write policies at all** — every
  write goes through an RPC above, so validation cannot be skipped.
- `round2_qualifiers`, `event_rounds`: admin selects all; an assigned judge
  selects rows for their own events. Codes still only reach a judge through
  `judge_round2_units`, because these tables carry `participant_id` and a judge
  must not be able to join it to anything.
- Every table gets `enable row level security` and no permissive fallback.

---

## 4. `lib/judging` — the pure core

`lib/judging/types.ts` is the shared vocabulary; the modules below import from it
and add nothing to it. Every module is pure (no Supabase, no React) and ships a
colocated `*.test.ts` in the style of `lib/paper/level.test.ts`.

- **`round.ts`** — `ROUNDS`, `ROUND_LABEL`, `isJudgingRound`.
- **`codes.ts`** — `formatContestCode(n)` (4-digit pad, same convention as
  `formatParticipantNumber`), `unitKeyOf(entryId, participantId)`,
  `contestUnits(category, rawEntries)` → `ContestUnit[]` sorted by code.
- **`consolidate.ts`** — `competitionRank(points[])` → places with 1, 2, 2, 4
  behaviour; `consolidateRound(units, ranks, judgeIds)` → `ConsolidatedBoard`
  with per-unit `points`, `rank`, `ranksByJudge`, plus `complete` (every unit
  ranked by every judge) and `missing` (what is outstanding). An incomplete
  board reports `rank: null` on every row rather than ranking a partial panel.
- **`qualifiers.ts`** — `selectQualifiers(board, cut)` → the qualifying rows,
  documented as `rank <= cut` and tested for the tie-at-the-line case.
- **`standings.ts`** — `finalStandings({ round1, round2, qualifiers })` →
  `StandingRow[]` implementing D4 exactly: qualifier order by
  `(round2Points, round1Points)`, non-qualifier block offset by
  `qualifiers.length`, `totalRank = round1Rank + round2Rank` or null.
- **`sheet-state.ts`** — the state machine both portals read instead of
  re-deriving booleans: `judgeSheetState(...)` (may this judge open, edit or
  only view this round?) and `eventJudgingStatus(...)` (`not-started`,
  `round1-open`, `round1-awaiting-close`, `round2-open`,
  `round2-awaiting-lock`, `locked`), each returning a reason string a page can
  print verbatim.
- **`tabulation.ts`** — `toTabulationRows(...)`: joins `StandingRow` to identity
  (code, name surname-first, coaches, school paper, school, district) for the
  tabulators table. Includes `schoolPaperForEvent(papers, event, isIntegrated)`:
  an integrated school's paper is chosen by the event's level, everyone else's
  is the `whole` paper; language prefers the event's language and falls back to
  the other rather than printing nothing.

Names, formatting and ordering reuse `lib/roster/names.ts`,
`lib/roster/limits.ts` and `lib/paper/level.ts`. Do not re-implement any of them.

---

## 5. Routes

```
/judge/login                     judge sign-in (AuthShell, mirrors /admin/login)
/judge                           the judge's events, with per-round status
/judge/[eventId]                 the sheet: codes + rank, submit locks it
/admin/judges                    panel: judges, assignments, per-event progress,
                                 close round 1, unlock a sheet, set the cut
/admin/judges/[eventId]          one event's panel and consolidated boards
/admin/tabulators                per-event index with progress
/admin/tabulators/[eventId]      the full identified tabulation sheet
/admin/tabulators/[eventId]/export  xlsx, via lib/export (existing pattern)
```

- `app/judge/guard.ts` mirrors `app/admin/guard.ts`: `checkJudge()` reports,
  `requireJudge()` redirects, a signed-in non-judge is signed out as well as
  bounced. An inactive judge is treated as not a judge.
- `proxy.ts` gains `/judge/:path*` in its matcher and redirects an
  unauthenticated visitor to `/judge/login`, exactly as it does for `/entry`.
- `lib/admin/nav.ts`: clear `stub: true` from Judges Portal and Tabulators.
  Their tests must be updated in the same change, not left to fail.

---

## 6. Stat cards

`/admin/schools`, `/admin/coaches` and `/admin/participants` each gain a row of
stat cards above their table, built from the same query the table already runs —
no second round trip. Each figure is computed by a pure module in
`lib/dashboard/` with a test, and every card carries the one-line subtitle that
stops the headline lying (see the comment in `components/dashboard/KpiTile.tsx`).
Reuse `KpiTile`'s visual language; add a `StatCard` only if `KpiTile`'s fixed
`KpiKey` icon map genuinely cannot carry the new figures.

Figures, and what each must not claim:

- **Schools** — schools on the roll; schools with at least one entry; schools
  locked; schools that have filed a paper. "332 school rows are not 332
  participating schools."
- **Coaches** — coaches registered; coaches on at least one entry; coaches on
  none; average entries per active coach.
- **Participants** — participants registered; competing in more than one event;
  registered but on no entry; split by level or gender.

---

## 7. Non-negotiables

1. A judge never receives a name, a school, a district or another judge's ranks.
   If a page needs a `select` on `participants` to render a judge's screen, the
   design is wrong.
2. Every write in this feature goes through an RPC that re-checks authorisation.
   No client write policy on any new table.
3. The qualifier rule and the final-rank rule exist once, in `lib/judging`, with
   tests. Not in SQL. Not in a page.
4. An incomplete panel produces no ranking — never a ranking over the judges who
   happened to have finished.
5. A failed query is rendered as a failure, never as an absence. Follow the
   `error` branch in `app/admin/(shell)/events/page.tsx` verbatim.
6. `totalRank` is labelled informational wherever it appears.
