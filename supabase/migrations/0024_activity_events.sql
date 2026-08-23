-- Press Link: the activity feed gets a real log, one row per action, grouped
-- into sessions when it is read.
--
-- Until now there was none. lib/dashboard/activity.ts says so in its own header:
-- the feed is six timestamp columns read newest-first and merged in JS. Six
-- columns cannot answer "what did this school do in one sitting", because none of
-- them records who was signed in, two of them are mutable
-- (school_papers.updated_at moves on every edit) and one of them is written in
-- bulk (lock_submission stamps every entries.submitted_at in a single instant).
-- So a school that filed five learners, five coaches and six entries in one
-- evening reads as sixteen unrelated lines today.
--
-- Design: docs/superpowers/specs/2026-08-23-session-activity-log-design.md.
-- This file is that design's section 3: the table, its indexes, its policies,
-- the cutoff column, and the one function the read path needs. It writes nothing
-- into the log — 0025 adds the triggers that do. The two files ship together;
-- applying this one alone leaves an empty table and a feed that behaves exactly
-- as it does today, which is a safe place to stop.

-- 1. The table.
--
-- One row per action, aggregated at read time. The rejected alternative was a
-- rolling counter or a JSONB tally per session: one UPSERT per write instead of
-- an INSERT, but it ossifies the vocabulary in the schema and cannot render a
-- delete or any per-row detail. Per-action rows cost read amplification, bounded
-- by the indexes below, and they put the tally in JS where it is testable.
--
-- Every column but `kind` is nullable, and that is deliberate rather than lazy.
-- See section 2: an audit row that fails a constraint aborts the user's write,
-- because these are AFTER triggers inside the writer's transaction. A school
-- losing a learner because a log row would not fit is a worse outcome than a
-- missing log line, so the shape is chosen to make that impossible.
--
-- `bigint generated always as identity` rather than a uuid: this table is
-- append-only and is read in timestamp order, so there is nothing to gain from a
-- random key and 8 bytes to gain per row and per index entry over 16. `generated
-- always` also means no trigger can supply an id even by mistake.
create table if not exists activity_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  session_id uuid,
  actor_user_id uuid,
  school_id uuid references schools(id) on delete cascade,
  kind text not null,
  subject_id uuid,
  label text
);

-- Both constraints are (re-)asserted by name with the drop-then-add idiom from
-- 0022, so this file is correct against a table left behind by an earlier draft
-- of it, and so a later migration that has to widen the vocabulary — logging
-- admin writes is design open question (a) — has a name it can rely on. Each name
-- is also the one Postgres generates for the equivalent inline clause, so the
-- drop catches the constraint however it was created.
alter table activity_events drop constraint if exists activity_events_kind_check;
alter table activity_events add constraint activity_events_kind_check
  check (kind in (
    'participant-added',
    'participant-removed',
    'coach-added',
    'coach-removed',
    'entry-submitted',
    'entry-withdrawn',
    'paper-updated',
    'paper-answered',
    'submission-locked'
  ));

alter table activity_events drop constraint if exists activity_events_school_id_fkey;
alter table activity_events add constraint activity_events_school_id_fkey
  foreign key (school_id) references schools(id) on delete cascade;

-- 2. Why no trigger in 0025 can make a school's write fail.
--
-- The choice being made here, explicitly: the triggers are *incapable of
-- failing*, rather than wrapped in `exception when others then null`. Swallowing
-- would give an audit log that can silently drop entries — which undercuts the
-- only reason to keep one — and would open a subtransaction on every single
-- school-side write to do it. So there is no exception block anywhere in 0025,
-- and instead every constraint on this table is discharged by construction.
--
-- The inventory, so the claim is checkable rather than asserted:
--
--   activity_events_pkey (id)      — no trigger names `id`; the identity
--                                    sequence supplies it and cannot collide.
--   at not null default now()      — no trigger names `at`; now() is never null
--                                    inside a transaction.
--   kind not null                  — every insert passes a string literal.
--   activity_events_kind_check     — those literals are the nine values listed
--                                    above, spelled out at each call site. No
--                                    path lets `kind` come from row data, so no
--                                    row a school can type can violate it.
--   activity_events_school_id_fkey — every insert in 0025 is
--                                    `insert ... select ... from schools s
--                                     where s.id = <row>.school_id`, so a row is
--                                    produced only when the parent school is
--                                    visible in this transaction. When it is not,
--                                    zero rows are inserted and there is no key
--                                    to check. This is what keeps the DELETE
--                                    branches safe while `delete from schools`
--                                    is cascading through participants and
--                                    coaches: the audit insert would otherwise
--                                    reference a school the same transaction has
--                                    already removed, and abort the delete.
--   (no other unique index)        — nothing here is unique but `id`, so
--                                    repeated session ids, repeated subjects and
--                                    a great many NULL session ids are all
--                                    ordinary rows. See section 10.
--
-- The remaining inputs: `session_id` is the file's only cast, and 0025 guards it
-- with a format test before casting, so a claim that is missing, empty or not a
-- canonical uuid becomes NULL instead of `22P02 invalid input syntax for type
-- uuid`. `actor_user_id` is auth.uid(), which 0011's BEFORE guards already
-- evaluate on every one of these writes, so it introduces no new failure. `label`
-- is built from concat_ws/nullif/btrim, none of which can raise, and it is
-- nullable, so a name that reduces to nothing is simply absent.
--
-- One residual, stated rather than hidden: the trigger functions are
-- `security definer` and their owner owns this table, which is what lets them
-- insert past RLS. If that ownership ever diverged, the `select ... from schools`
-- above would return no rows and logging would stop silently. That is the same
-- tradeoff pointed the same way — the failure lands on "no log line", never on
-- "the school's write was refused".

-- 3. Indexes — three, for three reads, plus one caveat.
--
-- (session_id, at) serves the read path's second step: having probed the newest
-- session ids, it fetches every row for them with `where session_id in (...)`.
-- It also serves `where session_id is null order by at desc`, the ungrouped rows,
-- because a btree stores and orders NULLs.
--
-- (school_id, at desc) serves the school-scoped policy in section 7 and the
-- school branch of recent_activity_sessions, both of which filter on school_id
-- and want the newest first.
--
-- (at desc) is the honest one: nothing queries it *today*. The whole-table
-- newest-first read belongs to the admin audit-logs page, which is task 6 of the
-- design and is not built yet; the session probe below cannot use it, because
-- grouping by session_id to find each max(at) has to aggregate regardless. It is
-- created because section 3 of the design specifies it and because this table is
-- append-only — no updates, and deletes only by school cascade — so a third
-- btree taxes an insert and nothing else. If task 6 does not land, drop it.
create index if not exists activity_events_session_id_at_idx
  on activity_events (session_id, at);
create index if not exists activity_events_school_id_at_idx
  on activity_events (school_id, at desc);
create index if not exists activity_events_at_idx
  on activity_events (at desc);

-- 4. What the columns mean, in the database, for whoever reads the schema
--    instead of this file.
comment on table activity_events is
  'Append-only action log, one row per write, grouped into login sessions at read time by lib/dashboard/activity-sessions.ts. Written only by the security definer triggers in 0025_activity_triggers.sql: there is deliberately no insert, update or delete policy, so the log cannot be forged or erased through the API.';

comment on column activity_events.session_id is
  'The auth session the write happened in, read from auth.jwt() ->> ''session_id'' at write time. NULL means the caller carried no such claim — a seeder, a migration, an admin script, the SQL console — and those rows render individually instead of being grouped. Nullable by design and never part of a unique constraint: NULLs compare as distinct, so a unique index here would be no protection anyway, and every one of these rows is a legitimate separate action.';

comment on column activity_events.actor_user_id is
  'auth.uid() at write time; NULL for anything running without a JWT. Deliberately no foreign key to auth.users: the log has to outlive a deleted login, and an FK here would let audit rows block the deletion of the user they describe.';

comment on column activity_events.school_id is
  'The school whose data changed. ON DELETE CASCADE, so deleting a school erases its history with it — see section 5 of 0024. NULL is reserved for a future division-level event with no school; such a row is visible to admins only, because the school policy cannot match a NULL.';

comment on column activity_events.kind is
  'Fixed vocabulary, checked by activity_events_kind_check and mirrored exactly by ActivityEventKind in lib/dashboard/activity-sessions.ts. Adding a value means a migration and a change there; the two lists are the same list in two places, and lib/dashboard/activity-sessions.test.ts is what pins them together.';

comment on column activity_events.subject_id is
  'The id of the row that changed: a participant, coach, entry, school_paper, or the school itself. No foreign key on purpose — for a removal the row it names is already gone, which is the point of recording it.';

comment on column activity_events.label is
  'Denormalised name of the subject at the time of the write: "Dela Cruz, Ana Mercado" for a person, the event name for an entry, the paper name for a school paper, the answer given for paper-answered. Stored rather than joined because the source row may since have been deleted, and because paper names and answers are mutable — a join would rewrite history on the next edit.';

-- 5. The cascade, chosen rather than inherited.
--
-- `on delete cascade` is what the design specifies and it is what is implemented,
-- but it sits uneasily beside `label`, which exists precisely so the log outlives
-- deleted rows. Deleting a school therefore erases the record that it ever did
-- anything, which is the one deletion an audit log would most want to survive.
--
-- Accepted for two reasons, both narrow. Nothing in the application or in
-- scripts/ deletes a school — grep for it: entries.school_id and
-- school_papers.school_id have no cascade of their own (0001), so such a delete
-- fails today unless a human clears those first. And in this division a school
-- row is removed to undo a data-entry mistake, not to prune history, so cascading
-- is closer to the intent than orphaning would be.
--
-- If retention becomes a policy rather than an accident — design open question
-- (b), which notes this table stores minors' names indefinitely — the right move
-- is a forward migration to `on delete set null` plus a denormalised
-- `school_label`, matching what `label` already does for people. Not this file's
-- decision to make.

-- 6. The cutoff.
--
-- Everything already in the six legacy sources predates session tracking, and no
-- session can be inferred for it: school_papers.updated_at is mutable, so a July
-- row moves across any window boundary on its next edit, and lock_submission
-- writes a school's whole history in one instant, so clustering by time would
-- fabricate one enormous session out of it. The read path therefore gates the six
-- legacy sources to `at < activity_log_started_at` and renders them ungrouped
-- under a visible divider.
--
-- `default now()` is the value that makes this a no-op for every row already on
-- file: at the instant this applies, the log is empty and everything that ever
-- happened is before the cutoff, which is exactly today's feed. now() is STABLE,
-- so the singleton row gets one evaluated timestamp — and app_settings holds one
-- row by construction anyway (0022's app_settings_singleton), so the per-row
-- evaluation caveat 0018 ran into with a volatile default cannot arise here.
alter table app_settings add column if not exists activity_log_started_at timestamptz not null default now();

comment on column app_settings.activity_log_started_at is
  'When activity_events started recording. The activity feed reads the six legacy timestamp sources only for rows older than this and activity_events only for rows newer, so no action is counted twice. Moving this value backwards would double-count; moving it forwards hides real log rows. It is set once, by 0024.';

-- 7. Who may read the log.
--
-- Two select policies and nothing else. No insert, no update and no delete
-- policy exists anywhere, for any role, which is what makes the log unforgeable
-- and unerasable through PostgREST while the definer triggers in 0025 still
-- write it. A client that can insert here can invent history; a client that can
-- delete here can remove the evidence of its own writes.
--
-- Both are scoped `to authenticated` explicitly, which is 0022's lesson: 0001
-- wrote `using (true)` with no role list on app_settings and so handed the row to
-- signed-out visitors as well. Nothing signed out has any business reading who
-- registered which minor and when.
alter table activity_events enable row level security;

drop policy if exists "school read own activity_events" on activity_events;
create policy "school read own activity_events" on activity_events for select
  to authenticated
  using (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read activity_events" on activity_events;
create policy "admin read activity_events" on activity_events for select
  to authenticated
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

-- 8. Grants, following 0018 section 10 exactly.
--
-- RLS sits on top of table grants, so the policies above are not enough on their
-- own: without a grant the dashboard gets "permission denied for table
-- activity_events" however permissive the policy is.
--
-- And Supabase's default privileges on schema `public` hand every new table to
-- `anon` and `authenticated` with insert, update and delete included. RLS already
-- refuses all three, because a policy that does not exist permits nothing — but
-- "the log cannot be forged" should not rest on the continued absence of a policy
-- somebody might add in haste. Revoking makes it true at two layers. The triggers
-- in 0025 are unaffected: `security definer` runs as the owner, which needs no
-- grant.
--
-- `anon` loses select too. Every reader here is a signed-in school or a signed-in
-- admin, and this table is a list of which minors were registered by whom and
-- when.
grant select on activity_events to authenticated;
revoke insert, update, delete, truncate on activity_events from anon, authenticated;
revoke select on activity_events from anon;

-- 9. The session probe.
--
-- The read path's rule is "never fetch a partial session": a session whose rows
-- were cut off by a limit renders "added 3 learners" for a sitting that added
-- nine, silently. So the limit bounds *sessions*, not rows — this function names
-- the newest sessions, and the caller then fetches all of their rows.
--
-- SECURITY. This is `security definer`, so RLS does not apply inside it and the
-- two policies above are never consulted. Without the scoping repeated here by
-- hand, any authenticated school could read the session ids and activity times of
-- every other school in the division. So the policies are re-implemented, clause
-- for clause:
--
--   * an admin (a row in admin_profiles for auth.uid()) sees every session;
--   * any other authenticated caller sees only sessions that touched a school it
--     owns (`schools.auth_user_id = auth.uid()`), and max(at) is computed over
--     that school's rows alone — aggregating over rows the caller cannot read
--     would leak other schools' activity through the ordering even if the ids
--     themselves were filtered afterwards;
--   * a caller who is neither — including an anonymous one, where auth.uid() is
--     NULL and matches no admin and no school — gets zero rows, which is what the
--     policies would have produced. Nothing raises: an empty feed is the correct
--     answer to "show me what I may see", and the `revoke all` below already
--     keeps `anon` from calling it at all.
--
-- `session_id is not null` is not an optimisation, it is the contract. NULL is
-- not a session; treating it as one would hand the caller a single pseudo-session
-- containing every seeder and script write ever made. If the JWT claim turns out
-- never to be populated — the design's one unverified assumption, section 1 —
-- then every row has a NULL session_id, this function correctly returns no rows,
-- the caller groups nothing, and the feed degrades to exactly today's behaviour.
--
-- It returns limit + 1 rows on purpose: seeing one more session than it can
-- render is how the caller knows the feed is truncated without fetching that
-- session's rows. `coalesce` is load-bearing — `limit null` in Postgres means no
-- limit, so a null argument would otherwise return every session in the division.
-- There is deliberately no upper clamp: a clamp would cap the returned count
-- below the caller's limit, and the caller reads "fewer rows than my limit" as
-- "nothing was held back", so a clamp would turn a truncated feed into one that
-- claims to be complete. The scan is the same size either way, since finding each
-- session's max(at) has to aggregate the whole visible set.
--
-- Ordering is total: max(at) descending, then session_id. Two sessions can share
-- a last instant, and an unstable order across the limit boundary would make
-- *which* session gets dropped vary between two renders of the same data — the
-- same invariant mergeActivityFeed() keeps on the other side of the wire.
--
-- `#variable_conflict use_column` for 0022's reason: a plpgsql body is not
-- resolved against the catalog until it first runs, so an identifier that could
-- read as either an output variable or a column would fail on the first call
-- rather than at apply time. Every reference below is table-qualified already;
-- the directive is the brace behind that belt. `probe` shares its name with no
-- column, so it still resolves to the variable.
create or replace function recent_activity_sessions(p_limit int)
returns table (session_id uuid, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  probe int := greatest(coalesce(p_limit, 0), 0) + 1;
begin
  if exists (select 1 from admin_profiles ap where ap.user_id = auth.uid()) then
    return query
      select e.session_id, max(e.at) as last_at
        from activity_events e
       where e.session_id is not null
       group by e.session_id
       order by max(e.at) desc, e.session_id
       limit probe;
    return;
  end if;

  return query
    select e.session_id, max(e.at) as last_at
      from activity_events e
     where e.session_id is not null
       and e.school_id in (select s.id from schools s where s.auth_user_id = auth.uid())
     group by e.session_id
     order by max(e.at) desc, e.session_id
     limit probe;
end;
$fn$;

revoke all on function recent_activity_sessions(int) from public;
grant execute on function recent_activity_sessions(int) to authenticated;

comment on function recent_activity_sessions(int) is
  'The newest p_limit + 1 activity session ids with their last event time, scoped the way the select policies on activity_events would scope them: every session for an admin, only its own school''s sessions for anyone else, nothing for an unrecognised or anonymous caller. The extra row is how the caller detects a truncated feed. Rows with a NULL session_id are excluded — they are not sessions.';

-- 10. Before 0025 goes anywhere near production, run this.
--
-- The whole design rests on one unverified fact: that auth.jwt() carries a
-- session_id claim in this project's Postgres. It is a required claim in the
-- bundled @supabase/auth-js types, and SECURITY DEFINER does not disturb
-- request.jwt.claims, so it should also hold inside the two existing RPCs. It has
-- not been observed. Run this in the SQL editor, or from the app, as an
-- authenticated *school* client — not the service role, which carries no session:
--
--   select auth.jwt() ->> 'session_id';
--
-- A canonical uuid means sessions group. NULL, or a value in any other format,
-- means every row logs with session_id NULL: nothing breaks, nothing groups, and
-- the feed reads exactly as it does today. That is the designed fallback, not a
-- failure, and it is why this column is nullable and carries no unique index.
