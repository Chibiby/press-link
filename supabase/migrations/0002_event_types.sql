-- Press Link v2: normalize events behind a language-neutral event_types table.
-- The entry wizard picks Category -> Event type -> Level -> Language, which
-- needs a single row per contest rather than one row per language.

create table if not exists event_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  category text not null check (category in ('individual', 'group')),
  name_en text not null,
  name_fil text not null,
  sort_order int not null,
  created_at timestamptz not null default now()
);

alter table event_types enable row level security;

-- Same visibility as `events`: read by any visitor, written only by the
-- service-role seed script (which bypasses RLS).
drop policy if exists "public read event_types" on event_types;
create policy "public read event_types" on event_types
  for select using (true);

-- Nullable for now so the seed can backfill it; 0003 makes it NOT NULL.
alter table events add column if not exists event_type_id uuid references event_types(id);

create index if not exists events_event_type_id_idx on events (event_type_id);
