# Judges Portal — two-stage ranking per event

Status: authoritative for the judging feature. Where this file disagrees with
`2026-08-21-judging-and-tabulation-design.md`, **this file is right and that one is
superseded** — see §1. Where a task disagrees with this file, the task is a bug.

Written 2026-08-27. The decisions below were taken by the division office in the
brainstorming session of the same date and are recorded with their consequences so
no later task quietly re-decides one.

---

## 0. What this feature is

Per event, one ranking page. It shows three columns and nothing else:

| Code | Rank — Round 1 | Rank — Round 2 |
|---|---|---|

Round 1 is a **cut**: one judge scores the top *N* and leaves everyone else blank.
Round 2 is a **placement**: three judges each rank every qualifier, and their ranks
are summed. An admin reviews and locks each round; locking Round 1 is what opens
Round 2.

```
Event -> Round 1 (all participants, 1 judge)
      -> admin review -> LOCK
      -> qualifiers
      -> Round 2 (qualifiers only, 3 judges)
      -> admin review -> LOCK
```

**Individual events only.** `events.category = 'group'` is out of scope; group
events keep today's behaviour and get their own decision later.

---

## 1. What this supersedes

The 2026-08-21 contract assumed one symmetric panel model across both rounds. Three
of its decisions no longer hold.

- **D1 (a panel of judges, ranks summed, both rounds) — superseded by N1.** Round 1
  is a single judge. Only Round 2 sums.
- **D4 (round 2 alone decides the winners) — superseded by N4.** Round 1 rank now
  carries into the final placement.
- **Non-negotiable 6 (`totalRank` is informational) — withdrawn.** The sum of the
  rounds is now the deciding number. `TOTAL_RANK_NOTE` in
  `lib/judging/standings.ts` and every surface that prints it must be updated in
  the same change, not left contradicting itself.

D2 (judges have their own accounts) and D3 (per-event cut, ties at the line all
advance) stand unchanged.

---

## 2. Decisions

### N1 — Round 1 is one judge; Round 2 is exactly three, and not that one

Seat 1 judges Round 1 alone. Seats 2, 3 and 4 judge Round 2. The judge who made the
cut does not also place the winners.

Exactly three is enforced, not advisory: Round 2 cannot be locked unless three
judges are seated and all three have submitted.

### N2 — Round 1 ranks as far down as the judge means to, and blanks the rest

The judge is shown every participant's code and a rank dropdown offering
**blank, 1 … the size of the field**, capped at `ROUND1_RANK_LIMIT` (50). Blank is
a valid, final answer and means *eliminated*.

**Superseded, 2026-08-30.** As first built, the dropdown offered **blank, 1 … cut**,
where `cut` is `events.round2_cut`, and this section drew the consequence: "because
the dropdown cannot offer a rank above the cut, the qualifier set is exactly the set
of scored participants." That identity is what was wrong. How far down a field a
judge is willing to place is the judge's working; who advances is the division's
rule, applied *to* that working. Bounding the form by the cut meant a judge under a
cut of ten could not record an opinion about the eleventh contestant at all.

So the two are separated. The judge ranks as far as they mean to, and
`round1Qualifiers` applies `rank <= cut` to the filed sheet — the comparison was
always there, and it is now load-bearing rather than defensive. **The qualifier set
is the scored participants at or above the cut**; a sheet of fifteen under a cut of
ten sends ten through and leaves five scored, placed on the judge's sheet, and
eliminated. `judging_write_sheet` enforces the new bound in migration 0032.

The 50 is a usability ceiling, not a rule of the contest: no division event fields
anything near it, and a select of several hundred rows is unusable on a phone.

### N3 — Round 1 ranks may tie, and a tie can push the field past the cut

Two participants may share rank 10. Both advance, so a cut of 10 with a three-way
tie for 10th sends twelve to Round 2. This is D3 unchanged, and `qualifierNotice()`
already writes the sentence that explains it on screen.

**The judge's typed rank is the Round 1 rank, verbatim.** It is not re-ranked. If a
judge types 1, 2, 2, 3 then the ranks are 1, 2, 2, 3 — the competition-ranking
renumber to 1, 2, 2, 4 is *not* applied to Round 1. Round 1 selects a field; the
exact placements within it decide nothing on their own.

### N4 — The final placement is Round 1 rank plus Round 2 points

For a qualifier:

```
round2Points = sum of the three judges' Round 2 ranks
finalPoints  = round1Rank + round2Points
finalRank    = competition placement of finalPoints, ascending (1, 2, 2, 4)
```

A genuine tie on `finalPoints` shares the place and the next place is skipped.
There is no further tie-break.

Non-qualifiers were never scored, so they have no Round 1 rank and nothing to add.
They carry **no final rank at all** and are shown as eliminated in Round 1 — not
placed in a block beneath the qualifiers.

### N5 — Round 2 ranks every qualifier, with no blanks

Each of the three judges assigns every qualifier a rank from a dropdown offering
**1 … qualifierCount**. No blanks. Ties are allowed within a judge's own sheet.

An incomplete Round 2 board produces no ranking at all — the existing
non-negotiable 4 stands.

### N6 — Submitting and locking are two separate acts

```
judge: enter ranks -> SUBMIT   (sheet becomes read-only to that judge)
admin: review      -> LOCK     (round closes; the next round opens)
```

Both are recorded with who and when. A judge cannot un-submit; an admin unlocks.

### N7 — A locked round is read-only, and an admin may reopen it

Locking makes the rank fields read-only. Correcting a locked round is
`UNLOCK -> edit -> re-LOCK`, each step attributed and timestamped. Only an
`admin_profiles` holder may unlock.

Round 1 may be unlocked **while Round 2 is in progress** — this is the division's
"Round 1 stays editable after proceeding to Round 2". The consequence is handled
explicitly rather than left to chance: see N8.

### N8 — Unlocking Round 1 reopens Round 2

Because editing Round 1 can change who qualifies, `admin_unlock_round1` also clears
`submitted_at` on every Round 2 sheet for that event. On the subsequent re-lock the
qualifier list is recomputed:

- a unit that is no longer a qualifier has its Round 2 ranks deleted;
- a newly qualifying unit appears unranked, so Round 2 is incomplete again and must
  be re-submitted before it can be locked.

`admin_unlock_round1` is **refused while results are locked.** The admin unlocks the
results first, so no unlock can silently contradict a published standing.

### N9 — Two entry paths, one sheet

A judge enters ranks at `/judge/[eventId]`, seeing codes only. An admin may enter on
a judge's behalf at `/admin/judges/[eventId]`, seeing identities. Both write the same
`judge_sheets` row; `entered_by` records which human actually typed it, and it may
differ from `judge_id`.

---

## 3. The ranked unit

Unchanged from the 2026-08-21 contract §2, narrowed to individual events: the unit
is the **participant**, the code is `participants.participant_number` padded to 4
digits, and `unitKey` is the `participantId`. `lib/judging/codes.ts` already does all
of this and is not touched.

---

## 4. Schema — migration `0027_two_stage_ranking.sql`

House style of 0016/0017/0018: say why, not what; guard every statement so the file
is safe to re-run; touch no table this feature does not own. Nothing below drops
data.

```sql
-- Ties are now legal (N3, N5). This index forbade two units sharing a place on one
-- sheet, which was correct under the old symmetric model and is wrong now.
drop index if exists judge_ranks_place_key;

-- Who actually typed a sheet, and who submitted it (N6, N9). judge_id says whose
-- opinion it is; entered_by says whose hands it was. They differ when an admin
-- enters on a judge's behalf.
alter table judge_sheets add column if not exists submitted_by uuid references auth.users(id);
alter table judge_sheets add column if not exists entered_by   uuid references auth.users(id);

-- Round 1's lock is now a first-class, attributed act, separate from the close that
-- draws the qualifiers (N6). 0018 gave event_rounds round1_closed_at/by and
-- results_locked_at/by; round 1 needs its own lock pair, and round 2 reuses the
-- results pair.
alter table event_rounds add column if not exists round1_locked_at timestamptz;
alter table event_rounds add column if not exists round1_locked_by uuid references auth.users(id);
```

`events.round2_cut` (0018) is the cut and needs no change. `round2_qualifiers` and
its `unit_key` index need no change.

### RPCs

All `security definer`, `set search_path = public`, `revoke all ... from public`,
`grant execute ... to authenticated`. Every one re-checks authorisation
server-side; there remains **no client write policy on any judging table**
(non-negotiable 2).

Judge-facing — `judge_event_units`, `judge_round2_units`, `judge_my_sheets` and
`judge_my_events` are as specified on 2026-08-21 and unchanged.

- `judge_submit_sheet(p_event_id, p_round, p_ranks jsonb)` — rewritten for the
  asymmetry. Refuses unless the caller is the seated active judge for that round,
  the sheet is unsubmitted, and the round is open. Then:
  - **Round 1:** the caller must hold seat 1; every rank is between 1 and the
    event's cut; blanks are permitted and are simply absent from `p_ranks`.
  - **Round 2:** the caller must hold seat 2, 3 or 4; `round1_locked_at` must be
    set; the ranks must cover exactly the qualifier set, once each; every rank is
    between 1 and the qualifier count.
  - Ties are permitted in both rounds. Sets `submitted_at`, `submitted_by` and
    `entered_by`.
- `admin_enter_sheet(p_event_id, p_round, p_judge_id, p_ranks jsonb)` — the N9 admin
  path. Identical validation, writes `entered_by = auth.uid()`.

Admin-facing, each raising `not authorized` unless the caller is in
`admin_profiles`:

- `admin_set_round2_cut(p_event_id, p_cut)` — refused once Round 1 is locked.
- `admin_assign_judge` / `admin_unassign_judge` — enforce N1: seat 1 is the Round 1
  judge, seats 2–4 the Round 2 panel, no fifth seat.
- `admin_lock_round1(p_event_id, p_qualifiers jsonb)` — requires seat 1's sheet
  submitted. Writes `round2_qualifiers`, stamps `round1_locked_at/by`,
  `round1_closed_at/by` and `round2_cut_used`. The qualifier list is computed in
  TypeScript and passed in, so the rule has one implementation (non-negotiable 3).
- `admin_unlock_round1(p_event_id)` — N7 and N8. Refused while results are locked.
  Clears the lock, the qualifier list, and every Round 2 `submitted_at`.
- `admin_lock_results(p_event_id, p_standings jsonb)` — requires three seated Round 2
  judges, all submitted (N1, N5). Freezes `standings`.
- `admin_unlock_results(p_event_id)`.
- `admin_unlock_judge_sheet(p_event_id, p_judge_id, p_round)` — clears one sheet's
  submission so that judge can revise. Refused if the round is locked; the admin
  unlocks the round first.

---

## 5. `lib/judging` — what changes

Every module stays pure (no Supabase, no React) with a colocated `*.test.ts`.

**New — `cut.ts`.** Round 1's rule, which `consolidate.ts` cannot express because it
treats an unranked unit as an incomplete panel rather than as an elimination.

- `round1Board(units, ranks)` → rows carrying the single judge's typed rank verbatim
  (N3), and `null` for a blank.
- `round1Qualifiers(board, cut)` → the scored rows as `QualifierRow[]`, ordered by
  rank then code. Tests pin: blanks excluded; a tie at the cut line advances whole;
  a field smaller than the cut.

**Unchanged — `consolidate.ts`.** Used for Round 2 only, where all three judges rank
every qualifier and the board is therefore always complete. Its `complete` /
`missing` logic and its existing tests are correct as written and are not touched.

**Unchanged — `codes.ts`, `round.ts`, `event-index.ts`.**

**Changed — `standings.ts`.** `finalStandings` implements N4: qualifiers placed by
`competitionRank(round1Rank + round2Points)`, ties sharing a place; non-qualifiers
carry a null final rank rather than a block beneath the qualifiers. Delete
`TOTAL_RANK_NOTE` and the "informational" language throughout — the sum decides now.

**Changed — `qualifiers.ts`.** `selectQualifiers` currently reads a
`ConsolidatedBoard`; Round 1 no longer produces one. It moves into `cut.ts`.
`qualifierUnits` and `qualifierNotice` are unchanged and keep their tests.

**Changed — `sheet-state.ts`.** `judgeSheetState` gains the seat rule (seat 1 sees
only Round 1, seats 2–4 only Round 2) and reads `round1_locked_at` rather than
`round1_closed_at`. `eventJudgingStatus` gains no new status values; its Round 1
branch reads one judge rather than a panel.

**Changed — `types.ts`.** `StandingRow.totalRank` is renamed `finalPoints` and its
"informational" comment replaced, so no caller can keep treating it as decorative.

---

## 6. Routes

```
/judge/login                 judge sign-in (AuthShell, mirrors /admin/login)
/judge                       the judge's events, with per-round status
/judge/[eventId]             the ranking page: Code + rank dropdown
/admin/judges                panel oversight, per-event progress
/admin/judges/[eventId]      one event: both boards, admin entry, lock/unlock
```

- `app/judge/guard.ts` mirrors `app/admin/guard.ts`: `checkJudge()` reports,
  `requireJudge()` redirects, a signed-in non-judge is signed out as well as bounced,
  and an inactive judge is treated as not a judge.
- `proxy.ts` gains `/judge/:path*` and redirects an unauthenticated visitor to
  `/judge/login`, exactly as it does for `/entry`.
- `lib/admin/nav.ts`: clear `stub: true` from Judges Portal, updating its test in the
  same change.
- The existing disabled buttons on `/admin/judges` and `/admin/judges/[eventId]`
  become live, each wired to the RPC its tooltip already names.

---

## 7. Non-negotiables

1. A judge never receives a name, a school, a district or another judge's ranks. If a
   page needs a `select` on `participants` to render a judge's screen, the design is
   wrong.
2. Every write goes through an RPC that re-checks authorisation. No client write
   policy on any judging table.
3. The cut rule and the final-rank rule exist once, in `lib/judging`, with tests. Not
   in SQL. Not in a page.
4. An incomplete Round 2 panel produces no ranking — never a ranking over the judges
   who happened to have finished.
5. A failed query renders as a failure, never as an absence. Follow the `error`
   branch in `app/admin/(shell)/events/page.tsx` verbatim.
6. Group events are untouched. No statement in migration 0027 and no branch in
   `lib/judging` may change how a group event behaves today.
7. Every lock, unlock and submission records who and when.
