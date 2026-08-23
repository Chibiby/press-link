# Global submission lock + session activity log — rollout notes

Migrations `0022`–`0025` have **not been applied**. Read this before you run them.

Apply **exactly these four, in this order**. Do not run "all migrations": `0001_init.sql`
uses bare `create table`, so it errors on a live database, and
`0010_drop_submissions_lock.sql` ends in `drop table if exists app_settings`. Run 0010
after 0022 has recreated that table and `submissions_locked_globally()` raises on every
school-side write — a division-wide submission outage, from a migration that looks like
cleanup.

The four below are all written to be re-runnable (`create table if not exists`,
`create or replace function`, `drop trigger if exists` before each `create trigger`,
`insert … on conflict`, `add column if not exists`). Re-running any one of them is safe.
Order still matters: 0024 does `alter table app_settings add column activity_log_started_at`,
so it needs 0022's table.

## What they change

| Migration | Change | Risk |
|---|---|---|
| `0022_global_submissions_lock` | recreates `app_settings` (singleton `id = true`), adds `submissions_locked` / `_at` / `_by`, seeds one row with `submissions_locked = false`, RLS + read/write policies, `submissions_locked_globally()`, `admin_set_submissions_lock(boolean)`, and **`create or replace` on the three guard functions** `reject_locked_submission`, `reject_locked_paper_staff`, `reject_locked_entry_link` | **high** — those three back all seven row triggers from 0011, so the body of every school-side write guard changes at once |
| `0023_lock_paper_participation` | `create or replace set_paper_participation(text)` — adds the division-wide check 0022 could not reach through a trigger | low — one RPC, body otherwise reproduced verbatim from 0011 |
| `0024_activity_events` | new `activity_events` table + kind check + FK + three indexes + RLS (two `select` policies, no insert/update/delete), `app_settings.activity_log_started_at`, `recent_activity_sessions(int)` | low — additive, no triggers, nothing reads it until code ships |
| `0025_activity_triggers` | `activity_session_id()` + five log functions, and **`after` triggers on `participants`, `coaches`, `entries` (insert/delete), `school_papers` (insert/update), `schools` (update)** | **high** — every school-side write path. A log function that raises aborts the write that fired it |

## The one thing to know before applying

**0022 seeds a row that the guards then require.** `submissions_locked_globally()` is
deliberately written to raise, not return false, when it cannot read the flag:

```sql
select submissions_locked into flag from app_settings where id;
if not found or flag is null then
  raise exception 'submission lock state unavailable';
end if;
```

Its own comment says why — "so the guard triggers cannot fail open." The consequence is
that **a missing or NULL singleton row blocks every school-side write division-wide.**
0022's `insert … on conflict` handles this, and the `app_settings_lock_stamp_check`
constraint keeps the flag and its timestamp consistent. Verify it anyway at step 1; it is
the one outcome that takes the division down.

## Step 0 — read-only. Run this first; it decides everything below

Nothing in the repo records which migrations are applied. This is the only way to know.

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('app_settings', 'activity_events');

select routine_name from information_schema.routines
 where routine_schema = 'public'
   and routine_name in ('submissions_locked_globally', 'admin_set_submissions_lock',
                        'set_paper_participation', 'recent_activity_sessions',
                        'activity_session_id');

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'app_settings' order by column_name;

select c.relname as table, t.tgname as trigger
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and t.tgname like '%\_activity\_log';
```

Skip any migration whose objects are already present and correct.

## Step 1 — `0022_global_submissions_lock.sql`

Then, before doing anything else:

```sql
select id, submissions_locked, submissions_locked_at from app_settings;  -- exactly one row, locked = false
select submissions_locked_globally();                                    -- false, and must not raise
```

**If that raises, or returns no row, stop and fix it before any school writes again.**
Repair is `insert into app_settings (id, submissions_locked) values (true, false) on
conflict (id) do update set submissions_locked = false;`.

## Step 2 — `0023_lock_paper_participation.sql`

## Step 3 — `0024_activity_events.sql`

```sql
select count(*) from activity_events;              -- 0
select activity_log_started_at from app_settings;  -- a timestamp, defaults to now()
select * from recent_activity_sessions(5);         -- empty, and must not raise
```

`activity_log_started_at` is the cutoff: the feed reads the six legacy timestamp columns
only for rows older than it, and everything newer comes from `activity_events`. It
defaults to `now()`, so apply this at the moment you intend the changeover.

## Step 4 — `0025_activity_triggers.sql`

This is the risky one. Immediately after, have **one** school add **one** participant
through the app, then:

```sql
select id, at, session_id, kind, label from activity_events order by at desc limit 5;
```

- **A row appears** → the triggers work.
- **`session_id` is non-null** → the JWT claim is populated and sessions group. This is the
  assumption the whole design rests on, and this query is the first empirical test of it.
- **`session_id` is null** → grouping degrades to ungrouped rows, which is the documented
  fallback in `docs/superpowers/specs/2026-08-23-session-activity-log-design.md`. The
  feature is inert, nothing is broken.
- **The participant fails to save** → back out step 4 alone, immediately:

```sql
drop trigger if exists participants_activity_log on participants;
drop trigger if exists coaches_activity_log on coaches;
drop trigger if exists entries_activity_log on entries;
drop trigger if exists school_papers_activity_log on school_papers;
drop trigger if exists schools_activity_log on schools;
```

That restores write behaviour exactly, and leaves 0024's table in place.

## How to run them

Use the Supabase dashboard SQL editor, one file per run, in order. There is no
`supabase/config.toml` in this repo, so the project is not linked for CLI use.

**Do not reach for `supabase db push` here.** It replays whatever
`supabase_migrations.schema_migrations` does not list, and this project's earlier
migrations were not applied through the CLI — so that table is likely absent or empty and
`db push` would start at `0001_init.sql`. It fails loudly rather than doing damage, but it
does not do the job.

## Rollback

There are no down-migrations in `supabase/migrations/`.

- **0025** backs out cleanly with the five `drop trigger` statements above.
- **0024** can be dropped (`drop table activity_events;`) only before the log matters;
  afterwards it destroys the log.
- **0022 and 0023 cannot be backed out by dropping objects**, because the deployed code
  reads them. Backing those out means reverting the application code first — dropping
  `app_settings` while the code expects it reproduces exactly the failure that
  `0010`'s header warns about.

## Still open, independent of these four

- **Retention.** `activity_events.label` is denormalised so a row survives the record it
  describes. That means minors' names outlive their deleted rows, indefinitely. A purge
  policy is a decision, not a detail.
- **Admin writes are not logged.** Only school-side paths carry triggers, so
  `/admin/audit-logs` attributes school activity and nothing else in v1.
- **Seeders bypass this.** `scripts/seed/` runs with the service role and carries no
  session claim, so seeded rows log with `session_id = null` and render ungrouped.
