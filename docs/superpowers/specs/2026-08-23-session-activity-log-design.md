# Session-based Activity Log — design

Date: 2026-08-23. Status: approved for implementation.

## Requirement

"for activity log, logged per session not per action, instead of school entered
learners logged 5 times, just 1 log of this school added 5 learners 5 coaches and
entry for 6 events, if login and logout another session is started to be recorded"

One aggregated row per session, phrased as a summary. Session = login → logout.
A new login starts a new recorded session.

## Starting facts (verified)

There is no event log in this schema. 22 migrations; zero activity/audit/session
tables. `lib/dashboard/activity.ts:1-13` says so in its own header: the feed is six
timestamp columns read newest-first and merged in JS — `entries.submitted_at`,
`participants.created_at`, `coaches.created_at`, `schools.paper_answered_at`,
`schools.submission_locked_at`, `school_papers.updated_at`.

All entry writes are direct PostgREST table calls (`app/entry/actions.ts`,
`app/entry/roster-actions.ts`). Only `set_paper_participation` and `lock_submission`
are RPCs.

`session_id` is a **required** claim in the bundled `@supabase/auth-js` types
(`RequiredClaims.session_id`, `dist/module/lib/types.d.ts:1660-1668`; `getClaims()`
doc example at `GoTrueClient.d.ts:2501`). **Not verified empirically** — no DB access
during design. This is the fact the design turns on.

## 1. Session identity — the JWT claim, read in Postgres, not in JS

Capture `(auth.jwt() ->> 'session_id')::uuid` inside `after` triggers on the written
tables. `SECURITY DEFINER` does not disturb `request.jwt.claims`, so it works inside
the two RPCs too.

Consequences: no cookie plumbing, no "start session" write, and **zero lines** in
`app/entry/actions.ts` or `app/entry/roster-actions.ts` — so this cannot conflict
with the global-lock guard work.

Rejected: own `activity_sessions` table with a minted id. Needs a write at both login
sites and threading through every action, and the id is lost the moment a write
happens outside those actions (seeders, admin scripts, SQL console).

**UNVERIFIED ASSUMPTION:** that `auth.jwt()` is populated in this project's Postgres
for these calls. Probe before shipping triggers, as an authenticated school client:

```sql
select auth.jwt() ->> 'session_id';
```

Fallback if it returns NULL: the column is nullable by design and NULL rows render
ungrouped (§4), so the feature degrades to today's behaviour instead of breaking.

## 2. Session end — derived, never written

A session exists only if it wrote something. Both involuntary sign-outs
(`app/admin/guard.ts:40`, `app/admin/login/actions.ts:28`) write nothing, so they
cannot produce a session row. No logout site is touched.

- `started_at` = min(at), `ended_at` = max(at) over the session's rows.
- A session is **closed** if a newer `session_id` exists for the same
  `actor_user_id`, or `now() - max(at) > 30 min`. Otherwise **open**: UI meta reads
  `In progress · since 2:14 PM`.
- Idle does not split a group. One `session_id` = one group even if the tab lives for
  days. Splitting long sessions into runs is the extension point; not built.

## 3. Table shape — one row per action, aggregate at read

```sql
create table activity_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  session_id uuid,                 -- null = JWT carried none; renders ungrouped
  actor_user_id uuid,
  school_id uuid references schools(id) on delete cascade,
  kind text not null,              -- check (kind in (...)) fixed vocabulary
  subject_id uuid,
  label text                       -- denormalised; the source row may be deleted
);
create index on activity_events (session_id, at);
create index on activity_events (school_id, at desc);
create index on activity_events (at desc);
alter table app_settings add column activity_log_started_at timestamptz not null default now();
```

Rejected: rolling counter / JSONB tally per session. One UPSERT per write, but it
ossifies the vocabulary and cannot render deletes or per-row detail.

Chosen: per-action rows. Read amplification, bounded by the index — and it puts the
tally in JS where it is testable.

RLS: enable; two `select` policies only —
`school_id in (select id from schools where auth_user_id = auth.uid())` and
`exists (select 1 from admin_profiles where user_id = auth.uid())`.
**No insert/update/delete policy exists**, so the log is unforgeable and unerasable
through the API. The triggers are `security definer` / `set search_path = public`
and bypass RLS.

## 4. Retroactive history — render ungrouped, do not infer

Pre-cutoff activity renders ungrouped under a visible
`Before session tracking (23 Aug 2026)` divider.

Inference is not merely imprecise, it is **unsound** here:

- `school_papers.updated_at` is mutable, so a 2026-07 row moves across any window
  boundary on its next edit.
- `lock_submission` stamps `submission_locked_at` plus every `entries.submitted_at`
  in one instant, so clustering collapses a school's whole history into one
  fabricated session.

## 5. The pure function — `lib/dashboard/activity-sessions.ts`

```ts
export interface SessionEvent { id: string; sessionId: string | null; at: string;
  schoolName: string; kind: ActivityEventKind; label: string | null; }
export interface SessionInput { events: SessionEvent[]; capped: Set<string>;
  legacy: ActivityItem[]; sessionsProbed: number; limit: number; now: Date;
  idleMinutes?: number; }
export function groupActivitySessions(input: SessionInput): ActivityFeed;
export function describeSession(counts: KindCounts, school: string, atLeast: boolean): string;
```

Each session becomes one `ActivityItem` with `id: "session:<uuid>"`, `at` = **latest**
event (earliest would bury active sessions), `title` from `describeSession`,
`href` = the single event's href when the session has one event, else `null` (no
session detail page exists). NULL-session and pre-cutoff rows keep their existing
`kind:rowid` ids.

Composition: build both lists, then call the existing
`mergeActivityFeed([sessionItems, legacyItems], limit)` **unchanged** — `session:`
never collides with `entry:`, so the total order and byte-identical renders survive.

Add `"session"` to `ActivityKind` and to `KIND_ICON` in
`components/dashboard/ActivityFeed.tsx:43`.

### Replacement for the old fetch invariant

The old rule was "fetch each source with the same limit you pass to the merge".
A limit now bounds **sessions**, not rows, so that rule no longer means what it did.

The new rule is: **never fetch a partial session.** A partial session silently renders
"added 3 learners" for a session that added 9 — the same class of bug the old rule
guarded against. So:

1. A `security definer` function `recent_activity_sessions(p_limit int)` returns the
   newest `limit + 1` session ids by `max(at)`.
2. Fetch **all** rows for the first `limit` ids. No per-source limit.
3. `truncated = sessionsProbed > limit || legacy source hit its own limit ||
   any session hit the per-session eventCap (500)`.
   A capped session sets `atLeast`, so `describeSession` says "5+ learners".

## 6. Tasks (none touch the contended files)

1. **Migration 0023** — table, indexes, RLS, `app_settings.activity_log_started_at`,
   `recent_activity_sessions`. Verify: `scripts/verify-schema.ts` extension; manual
   `select auth.jwt() ->> 'session_id'` probe.
2. **Migration 0024** — triggers on `participants`, `coaches`, `entries` (ins/del),
   `school_papers` (ins/upd), `schools` (paper answer, lock). Verify: insert then
   delete a participant as a school, expect two rows sharing one `session_id`.
3. **`lib/dashboard/activity-sessions.ts`** (pure). Tests: tally wording
   (singular/plural/zero), latest-`at` ordering, open vs superseded vs idle, NULL
   session ungrouped, `capped` → `atLeast`, `truncated` in all four causes,
   id-prefix disjointness with legacy ids.
4. **`lib/dashboard/activity-source.ts`** — add the session fetch, gate the six legacy
   sources to `at < activity_log_started_at`. Tests: existing `activity.test.ts`
   unchanged; new fetch-shape test.
5. **UI** — `"session"` kind + icon, `Before session tracking` divider, `In progress`
   meta.
6. **`app/admin/(shell)/audit-logs/page.tsx`** — replace `SoonPage`; its "nothing
   records attribution" copy is now false.

## Open questions

- **(a) Do admin writes get logged in v1?** Scoped out; `audit-logs` promises
  attribution, so likely a follow-up.
- **(b) Retention.** The page already flags that this stores minors' names
  indefinitely; `label` makes `activity_events` outlive deleted rows, so a purge
  policy is a decision, not a detail.
- **(c) Seeders** (`scripts/seed/`) run with the service key and no session claim, so
  seeded data logs with NULL `session_id` and renders ungrouped — acceptable, but
  confirm no importer rewrites `participants` wholesale, which would emit a spurious
  "added 400 learners" session.
