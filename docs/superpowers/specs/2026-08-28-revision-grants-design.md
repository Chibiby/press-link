# Revision grants: reopening one school inside a division-wide lock

**Status:** approved 2026-08-28. Implemented by migration 0031.

## The problem

The division-wide lock from migration 0022 is all-or-nothing. At a deadline the
office freezes all 336 schools at once, which is what it is for. What happens
next is not covered: a school phones in, something is wrong with one entry, and
the office wants to let *that school* fix *that part* for half an hour without
lifting the deadline off the division.

Today the only tool is `admin_set_submissions_lock(false)`, which reopens
everybody. The per-school `admin_unlock_submission` does not help either: it
clears `schools.submission_locked_at`, and the division-wide flag is still on
top of it refusing every write.

So the office needs a third thing, narrower than both: a **grant** that says
*this school, these parts, until this time*.

## Shape of the answer

A grant is a row beside `schools`, never a value in it. That is the same
discipline 0022 set for the division-wide flag, and for the same reason: when the
grant ends, both locks have to be exactly as they were. Writing anything into
`schools.submission_locked_at` — or clearing it — would destroy the difference
between a school that had locked itself and one that had not, and there is no way
to reconstruct it afterwards.

Three consequences follow, and they are the whole design:

1. **Expiry is a column, not a job.** `expires_at` is compared against `now()`
   inside the guard on every write. There is no cron, no scheduled function and
   no client timer that has to fire for the lock to come back. A scheduled job
   could only ever be late; a comparison cannot be.
2. **The grant is read, never applied.** Nothing copies a grant onto a school.
   Deleting every row in `revision_grants` returns the division to exactly the
   state it is in with the feature absent.
3. **It fails closed.** `submissions_locked_globally()` raises rather than
   returning false, because a lock that fails open is worse than no lock.
   `revision_allows()` is the mirror image: it returns false on anything it
   cannot positively read, because a *grant* that fails open is the same bug
   wearing the other hat.

## Decisions taken, and the alternatives rejected

**Scope is three surfaces, not per-entry.** `paper`, `roster`, `entries` — all
three granted by default. They were chosen because they are already the seam the
schema has: the seven guarded tables reach a school by three routes and are
covered by three guard functions, so a surface-scoped grant is one condition per
function. Per-entry grants were considered and rejected: they need a join table,
they push an `entry_id` lookup into `reject_locked_entry_link()`, and the office's
actual request is "let them fix their entries", not "let them fix entry #4".

**A grant beats the school's own lock as well as the division's.** A grant is the
office saying go ahead; being told "also press Unlock on that row" is a second
step with no meaning behind it. The school's own `submission_locked_at` is left
on file untouched and takes effect again the moment the grant expires.

**One live grant per school, enforced by a partial unique index.** `Change` is
therefore a revoke-and-insert inside one RPC rather than an update, which keeps
the audit trail of what was granted when. The index is the real guard: two admins
double-clicking is the race it exists for, and the second one gets a unique
violation the action turns into "another administrator just granted revision to
this school".

**An empty grant is refused, not stored.** A row with all three surfaces false
permits nothing while looking, on the admin page, exactly like one that permits
something. A CHECK constraint makes it unrepresentable.

## Schema (migration 0031)

```sql
create table revision_grants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  allow_paper boolean not null default true,
  allow_roster boolean not null default true,
  allow_entries boolean not null default true,
  constraint revision_grants_window check (expires_at > granted_at),
  constraint revision_grants_scope check (allow_paper or allow_roster or allow_entries)
);

create unique index revision_grants_one_live
  on revision_grants (school_id) where revoked_at is null;
```

`granted_by` is nullable for the reason `app_settings.submissions_locked_by` is:
a script or a migration carries no `auth.uid()`, and recording a grant
unattributed beats refusing to record it.

`on delete cascade` on `school_id`, because a grant against a deleted school is
not a fact worth keeping.

### Policies

Admins read every row. A school reads **only its own**, so the `/entry` banner can
name what was reopened without exposing which other schools were granted
anything. No insert, update or delete policy exists for anyone — the two RPCs own
every write — and insert/delete/truncate are revoked at the privilege layer too,
following 0022 section 2, so a policy added in haste cannot reopen it.

### Reading a grant from inside a trigger

```sql
create or replace function revision_allows(target uuid, surface text)
returns boolean
language plpgsql stable security definer set search_path = public
```

`security definer` with a pinned `search_path`, the 0011 idiom, so RLS cannot hide
the row from the trigger. Returns true only when a row for `target` has
`revoked_at is null`, `expires_at > now()`, and the column matching `surface` set.
Every other outcome — no row, an unrecognised surface, a null — returns false.

## Enforcement

The three 0022 guard functions keep their bodies verbatim; the lock checks are
wrapped:

```sql
if not revision_allows(target, surface) then
  if submissions_locked_globally() then
    raise exception 'submissions are locked division-wide';
  end if;
  if exists (
    select 1 from schools
     where id = target and submission_locked_at is not null
       and auth_user_id = auth.uid()
  ) then
    raise exception 'submission is locked';
  end if;
end if;
```

The wrapper sits **inside** 0022's ownership test, exactly where the flag read
already sat. That preserves the standing constraint the lockdown plan states: a
caller who does not own the row — an admin, the service role,
`scripts/reset-submissions.sql` — is held by neither lock and now evaluates
neither the flag nor the grant.

`surface` per function:

| function | tables | surface |
| --- | --- | --- |
| `reject_locked_submission` | `school_papers` | `paper` |
| | `participants`, `coaches` | `roster` |
| | `entries` | `entries` |
| `reject_locked_paper_staff` | `paper_staff` | `paper` |
| `reject_locked_entry_link` | `entry_participants`, `entry_coaches` | `entries` |

`reject_locked_submission` covers four tables through one function, so it reads
`tg_table_name` to choose. The other two are fixed strings.

`set_paper_participation` from 0023 gets the same wrapper at `paper`. It is the
only school-reachable write path that is not a trigger, which is why 0023 exists
at all; the grant has to reach it for the same reason the flag did.

**The seven triggers themselves are not redefined.** `create or replace` swaps
the bodies underneath them, so all seven pick the grant up at once and no table is
ever left unguarded mid-migration.

## The two RPCs

`admin_grant_revision(target_school uuid, p_allow_paper boolean, p_allow_roster
boolean, p_allow_entries boolean, p_minutes int)` — re-checks `admin_profiles` itself
(RLS does not apply inside a definer function, so the policies are never
consulted), revokes any live grant for the school, inserts the new one, returns
it. `minutes` is clamped to 1–1440 in the database as well as in the action,
because a Server Action is a public POST endpoint and the RPC is the last line.

The four `p_` prefixes are not cosmetic. `returns table` makes each output column
a parameter of the function too, so a bare `allow_paper` would be ambiguous
between the argument and the column it is inserted into. These are the names
PostgREST posts, so the Server Action has to spell them this way.

`admin_revoke_revision(target_school uuid)` — stamps `revoked_at` on the live
grant. Idempotent: revoking a school with no live grant succeeds and changes
nothing, so a stale page cannot produce an error the admin can do nothing about.

## Admin UI — `/admin/users`

The Submission cell gains its third state, and the control appears only while the
division-wide lock is on — outside a division-wide freeze there is nothing for a
grant to override that `Unlock` does not already handle.

```
Alabel Integrated SPED Center   [Locked]  Since Aug 23, 3:49 PM   [Unlock] [Allow revision]
Kiangkos ES    [Revision until 4:19 PM]  paper · roster · entries  [Change] [Revoke]
Banlibato Integrated School     [Closed]                          [Allow revision]
```

**Closed** replaces Open/Locked when the lock is on and the school filed nothing
at all: zero entries, zero `school_papers` rows, and `paper_participation` still
`undecided`. All three, because a school that saved paper details but never
answered the contest question has started, and "Closed" would misreport it as a
school the deadline passed by. Two embedded PostgREST counts join the existing
paged select rather than adding a round trip.

The modal asks the two questions and nothing else: three checkboxes, all
pre-checked, and a duration defaulting to 30 minutes (15m / 30m / 1h / 2h / 4h /
24h).

`expires_at` is formatted on the server with the pinned `Asia/Manila` formatter
and handed down as a string, for the reason written into `lock-state.ts`: Node's
ICU and the browser's disagree about the space before "PM", and that is a
hydration mismatch nobody can see.

## School UI — `/entry`

`entrySubmissionLock()` returns three read-only decisions instead of one —
`paper`, `roster`, `entries` — because a grant scoped to entries alone must leave
the roster frozen. The five existing call sites in `EntryDashboard.tsx` map onto
them with no new plumbing: `paperRequired`, `gateRequired` and
`SchoolPaperDialog` read `paper`; `RosterPanel` reads `roster`; `canCreateEntry`
and `EntriesTable` read `entries`.

Precedence gains a fourth rule ahead of the existing three: **a live grant is
announced first.** Of the four states it is the only one the school can act on,
and it is time-limited, so burying it under "submissions are closed
division-wide" would waste the window. Surfaces the grant does not cover keep
their existing frozen notes, so a partial grant reads as a partial grant.

The modal fires once per grant — acknowledged by grant `id` in `localStorage`, so
a refresh does not re-nag but a *new* grant does — then collapses to a persistent
banner with a live countdown.

The countdown ticks client-side from the server-sent `expires_at`, and at zero it
calls `router.refresh()` rather than deciding anything. The database is what
refuses writes; a browser with a skewed clock must never be the thing that claims
a window is open.

## Testing

Logic lives in pure modules, as `lock-state.ts` and `school-lock.ts` already do,
because nothing in this repo renders a component under test.

- `lib/submissions/revision-grant.ts` — grant shape, `activeGrant(row, now)`,
  scope labels, `remainingLabel`, `validateGrantInput`, duration presets.
- `revision-grant.test.ts` — the expiry boundary (`expires_at === now` is
  expired, not active), revoked-but-unexpired, a read that failed, every scope
  combination, minutes out of range in both directions.
- `school-lock.test.ts` extended — four precedence states across three surfaces,
  including the partial grant where one surface is open and two are frozen.

Trigger behaviour cannot be reached from vitest, so a script under `scripts/`
exercises the grant against a live database.

## Deliberately not built

Activity-log rows for grants (0025's `kind` CHECK would need widening),
notification by email or SMS, a bulk "allow revision to every school", and
per-entry granularity.
