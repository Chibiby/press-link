-- Press Link: the writers for activity_events — five AFTER triggers, one per
-- table the schools actually change.
--
-- Separate from 0024 so the table, its policies and its read function can be
-- applied and inspected before anything starts writing to it, and so this file
-- can be reverted on its own (`drop trigger`, section 5) without touching the
-- table or the feed's cutoff.
--
-- Depends on 0024: every function below inserts into activity_events, names one
-- of the nine values its check constraint allows, and calls
-- activity_session_id() from section 1.
--
-- Two properties hold for every trigger in this file, and both matter more than
-- anything it logs:
--
--   * It cannot make a school's write fail. These are AFTER triggers running in
--     the writer's transaction, so anything raised here rolls back the insert
--     that caused it. The proof is section 2 of 0024: every constraint on
--     activity_events is discharged by construction, and there is deliberately
--     no `exception when others` block anywhere in this file — swallowing errors
--     would give an audit log that can quietly lose rows, and would open a
--     subtransaction on every school-side write to do it.
--   * It never logs a write that did not happen. 0011 and 0022 put BEFORE
--     triggers on all of these tables that raise when the submission is locked,
--     per school or division-wide. A BEFORE trigger that raises means the AFTER
--     trigger never fires, so a refused write leaves nothing behind.
--
-- Not logged, on purpose: entry_participants and entry_coaches. The entry is the
-- action a school takes; the links are how it is stored. Logging them would turn
-- one six-event submission with four learners apiece into thirty lines and make
-- the session sentence unreadable. paper_staff is left out for the same reason —
-- every school paper save rewrites it as a delete followed by an insert (0022's
-- note), so it would log churn, not activity.

-- 1. Reading the session claim without ever raising.
--
-- `(auth.jwt() ->> 'session_id')::uuid` is what the design writes, and that cast
-- is the one input in this whole file that could throw: a claim present but not
-- in uuid form raises 22P02 invalid input syntax, which would abort a school's
-- insert. And the claim is the design's single unverified assumption — nobody has
-- yet seen what this project's Postgres actually puts there — so it is exactly
-- the input least safe to cast blindly.
--
-- So: test the format, then cast. Anything else — claim absent (service role,
-- migration, SQL editor), claim empty, claim in some other shape — becomes NULL,
-- which activity_events.session_id accepts and the read path renders ungrouped.
-- The pattern is the canonical hyphenated form, case-insensitive, which is what
-- GoTrue emits. Postgres would also accept braced and unhyphenated variants; not
-- matching those costs at most the grouping of a token shape this project does
-- not produce, and buys a parse that provably cannot fail.
--
-- auth.jwt() itself can only raise if request.jwt.claims holds malformed JSON, in
-- which case auth.uid() has already raised in the BEFORE guard from 0022 and the
-- write was failing before this file existed. That is not a new risk.
--
-- `revoke all` with no matching grant, unlike the RPCs in 0011 and 0022: nothing
-- outside these triggers has any reason to call this, and the triggers run as the
-- owner, which needs no grant of its own.
create or replace function activity_session_id()
returns uuid
language plpgsql
stable
set search_path = public
as $fn$
declare
  claim text := auth.jwt() ->> 'session_id';
begin
  if claim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return claim::uuid;
  end if;
  return null;
end;
$fn$;

revoke all on function activity_session_id() from public;

comment on function activity_session_id() is
  'The current auth session id from the JWT, or NULL when the claim is missing or not a canonical uuid. Never raises: it is called from AFTER triggers inside the caller''s own transaction, where an error would roll back the write being logged.';

-- 2. One shape, five times.
--
-- Every insert below is `insert into activity_events (...) select ... from schools
-- s where s.id = <row>.school_id`, never `insert ... values`. Three things follow
-- from that, and the first is the reason:
--
--   * The foreign key on activity_events.school_id cannot be violated, because a
--     row is produced only when the parent school is visible in this transaction.
--     That is not hypothetical: participants.school_id and coaches.school_id
--     cascade from schools (0004), so `delete from schools` deletes those rows and
--     fires these triggers *while the school row is already gone*. With `values`,
--     the audit insert would fail the FK check and abort the school delete. With
--     `select`, it inserts nothing — which is what the cascade would have done to
--     the row anyway.
--   * It costs one primary-key lookup on a small, hot table. The BEFORE guards
--     from 0022 already select from schools on every one of these same writes.
--   * If RLS ever did apply to these functions (it does not — `security definer`,
--     and the owner owns both tables), the select would come back empty and
--     logging would stop silently instead of breaking writes. Section 2 of 0024
--     records that as the accepted direction of failure.
--
-- The DELETE branches never mention `new` and the INSERT branches never mention
-- `old`, following 0008's discipline: the other one is unassigned, and coalesce
-- would evaluate both.
--
-- These are AFTER row triggers, so the return value is discarded; `null` says so
-- rather than implying otherwise.
--
-- `label` is the surnameFirst() format from lib/roster/names.ts — "Dela Cruz, Ana
-- Mercado", empty parts dropping out rather than leaving a dangling comma. It is
-- spelled here in concat_ws/nullif because the row is gone by the time anything
-- in JS could format it. The duplication is a display format, not an invariant,
-- and it is one-directional: this writes a snapshot, that formats live rows.
-- coaches.first_name and coaches.last_name both default to '' (0015), so the
-- outer nullif is what stops a nameless coach logging a label of ', '.

create or replace function log_participant_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
    select activity_session_id(), auth.uid(), s.id, 'participant-removed', old.id,
           nullif(concat_ws(', ',
             nullif(btrim(old.last_name), ''),
             nullif(concat_ws(' ',
               nullif(btrim(old.first_name), ''),
               nullif(btrim(old.middle_name), '')
             ), '')
           ), '')
      from schools s
     where s.id = old.school_id;
    return null;
  end if;

  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
  select activity_session_id(), auth.uid(), s.id, 'participant-added', new.id,
         nullif(concat_ws(', ',
           nullif(btrim(new.last_name), ''),
           nullif(concat_ws(' ',
             nullif(btrim(new.first_name), ''),
             nullif(btrim(new.middle_name), '')
           ), '')
         ), '')
    from schools s
   where s.id = new.school_id;
  return null;
end;
$fn$;

create or replace function log_coach_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
    select activity_session_id(), auth.uid(), s.id, 'coach-removed', old.id,
           nullif(concat_ws(', ',
             nullif(btrim(old.last_name), ''),
             nullif(concat_ws(' ',
               nullif(btrim(old.first_name), ''),
               nullif(btrim(old.middle_name), '')
             ), '')
           ), '')
      from schools s
     where s.id = old.school_id;
    return null;
  end if;

  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
  select activity_session_id(), auth.uid(), s.id, 'coach-added', new.id,
         nullif(concat_ws(', ',
           nullif(btrim(new.last_name), ''),
           nullif(concat_ws(' ',
             nullif(btrim(new.first_name), ''),
             nullif(btrim(new.middle_name), '')
           ), '')
         ), '')
    from schools s
   where s.id = new.school_id;
  return null;
end;
$fn$;

-- The entry's label is its event's name, matching what the legacy feed renders
-- ("Entry submitted — Editorial Writing, English"). LEFT JOIN, not JOIN: the join
-- to schools decides whether a row is logged at all, and folding a second table
-- into that decision would silently drop the log line if an event ever went
-- missing. A missing event name is a null label, which is allowed.
create or replace function log_entry_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'DELETE' then
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
    select activity_session_id(), auth.uid(), s.id, 'entry-withdrawn', old.id,
           nullif(btrim(ev.name), '')
      from schools s
      left join events ev on ev.id = old.event_id
     where s.id = old.school_id;
    return null;
  end if;

  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
  select activity_session_id(), auth.uid(), s.id, 'entry-submitted', new.id,
         nullif(btrim(ev.name), '')
    from schools s
    left join events ev on ev.id = new.event_id
   where s.id = new.school_id;
  return null;
end;
$fn$;

-- Insert and update both write 'paper-updated', deliberately: a reader does not
-- distinguish "created the paper record" from "edited it", and two kinds would
-- force the session sentence to say "added its school paper and updated its
-- school paper" for one sitting that did both. The legacy source this replaces is
-- driven by updated_at alone and makes the same conflation.
--
-- No WHEN clause filtering unchanged rows. The app bumps updated_at on every
-- save, so a genuinely empty update is not a shape this schema produces, and the
-- legacy feed already shows a no-edit save as activity — matching it keeps the
-- feed continuous across the cutoff.
create or replace function log_school_paper_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
  select activity_session_id(), auth.uid(), s.id, 'paper-updated', new.id,
         nullif(btrim(new.paper_name), '')
    from schools s
   where s.id = new.school_id;
  return null;
end;
$fn$;

-- schools carries no school_id column; it *is* the school, so `s.id = new.id`.
-- The insert...select is kept anyway rather than switched to `values`, so the
-- claim in section 2 of 0024 holds for every insert in this file without an
-- exception a reader has to remember.
--
-- Both conditions live in the body rather than in the trigger's WHEN clause,
-- which is where they would more usually go. A WHEN clause would have to be the
-- disjunction of the two ifs below, and then the same predicate exists in two
-- places that can drift apart — the body would still have to branch to know which
-- kind to write. schools is updated only by the four definer RPCs and by admin
-- repair scripts, so entering this function on an unrelated update costs nothing
-- worth that risk.
--
-- `paper_answered_at is not null and is distinct from old` rather than just
-- distinct: admin_reset_paper_participation clears the column, and a reset is not
-- a school answering the question. So a reset logs nothing, and the next real
-- answer logs normally. Same for the lock: null -> not null only, so re-stamping
-- an already-locked school (which lock_submission's `where submission_locked_at is
-- null` prevents anyway) cannot log twice, and admin_unlock_submission clearing it
-- logs nothing.
--
-- The answer itself goes in `label` because paper_participation is mutable and
-- this is then the only record of which way it went at the time. Admin actions —
-- unlock, reset — are out of scope for v1 (design open question (a)) and are the
-- reason this file logs no schools DELETE and no clearing update.
create or replace function log_school_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.paper_answered_at is not null
     and new.paper_answered_at is distinct from old.paper_answered_at then
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
    select activity_session_id(), auth.uid(), s.id, 'paper-answered', new.id,
           new.paper_participation
      from schools s
     where s.id = new.id;
  end if;

  if new.submission_locked_at is not null and old.submission_locked_at is null then
    insert into activity_events (session_id, actor_user_id, school_id, kind, subject_id, label)
    select activity_session_id(), auth.uid(), s.id, 'submission-locked', new.id, null::text
      from schools s
     where s.id = new.id;
  end if;

  return null;
end;
$fn$;

-- 3. Wiring, drop-then-create so the file is safe to re-run.
--
-- Names end in _activity_log, so they cannot collide with 0011's _locked_guard
-- triggers on the same five tables. Those are BEFORE and these are AFTER, so the
-- guard always decides first regardless of name ordering.
drop trigger if exists participants_activity_log on participants;
create trigger participants_activity_log
  after insert or delete on participants
  for each row execute function log_participant_activity();

drop trigger if exists coaches_activity_log on coaches;
create trigger coaches_activity_log
  after insert or delete on coaches
  for each row execute function log_coach_activity();

drop trigger if exists entries_activity_log on entries;
create trigger entries_activity_log
  after insert or delete on entries
  for each row execute function log_entry_activity();

drop trigger if exists school_papers_activity_log on school_papers;
create trigger school_papers_activity_log
  after insert or update on school_papers
  for each row execute function log_school_paper_activity();

drop trigger if exists schools_activity_log on schools;
create trigger schools_activity_log
  after update on schools
  for each row execute function log_school_activity();

-- 4. One consequence of this file that belongs on the record.
--
-- scripts/reset-submissions.sql deletes every entry, participant and coach in the
-- division inside one transaction. From now on that emits one 'entry-withdrawn',
-- 'participant-removed' or 'coach-removed' row per deleted row — thousands of
-- them, all with session_id NULL because the SQL editor carries no session claim,
-- and all newer than app_settings.activity_log_started_at, so all of them render
-- individually in the feed. A reset would leave the dashboard reading as a mass
-- deletion, which is technically true and completely useless.
--
-- That script is not edited here (this migration has no business rewriting an
-- operator tool, and doing so is not what it was asked for), so the fix is one
-- line for whoever next runs it: add
--
--   delete from activity_events;
--
-- inside its transaction, next to `alter sequence participant_number_seq restart`.
-- A reset means "as if none of this ever happened", and the log should say the
-- same thing. This is the wholesale-rewrite hazard design open question (c) asks
-- about; the seeders under scripts/seed/ are clear, as they touch only districts,
-- schools, events and admin_profiles, none of which these triggers watch.

-- 5. Verification, once 0024 and 0025 are both applied.
--
-- First the probe from section 10 of 0024, as an authenticated school client. If
-- it returns NULL, everything below still works — the two rows just carry a NULL
-- session_id and do not group, which is the designed fallback.
--
--   select auth.jwt() ->> 'session_id';
--
-- Then, as that same school, add a learner in the app and delete it again, and
-- read the log back:
--
--   select id, at, session_id, actor_user_id, kind, label
--     from activity_events
--    order by id desc
--    limit 10;
--
-- Expected: two rows, 'participant-added' then 'participant-removed', same
-- session_id, same actor_user_id, the learner's name in label on both — including
-- the removal, whose subject row no longer exists. Then check the read path is
-- scoped, as the same school:
--
--   select * from recent_activity_sessions(20);
--
-- Expected: only sessions that touched that school. Run it as a second school and
-- the first school's session id must not appear.
--
-- To undo this file: drop the five triggers above, then the five log_* functions,
-- then activity_session_id(). The table and its rows stay, and the feed keeps
-- rendering whatever was logged before the drop, because everything newer than
-- activity_log_started_at is read from activity_events and everything older from
-- the six legacy sources. Undoing 0024 as well means dropping activity_events,
-- recent_activity_sessions and app_settings.activity_log_started_at — in that
-- order, and only after the TypeScript that reads them is reverted.
