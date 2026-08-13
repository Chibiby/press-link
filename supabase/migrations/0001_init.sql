create extension if not exists pgcrypto;

create table districts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  district_id uuid not null references districts(id),
  name text not null,
  school_id_number text not null unique,
  auth_user_id uuid unique references auth.users(id),
  created_at timestamptz not null default now()
);

create table admin_profiles (
  user_id uuid primary key references auth.users(id),
  full_name text not null
);

create table events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null check (category in ('individual', 'group')),
  level text not null check (level in ('elementary', 'secondary')),
  language text not null check (language in ('english', 'filipino')),
  name text not null,
  sort_order int not null
);

create table school_papers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  language text not null check (language in ('english', 'filipino')),
  paper_name text not null,
  adviser_name text not null,
  adviser_gender text not null check (adviser_gender in ('M', 'F')),
  principal_name text not null,
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (school_id, language)
);

create table paper_staff (
  id uuid primary key default gen_random_uuid(),
  school_paper_id uuid not null references school_papers(id) on delete cascade,
  full_name text not null,
  title text not null check (title in ('section_head', 'assistant_head'))
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  event_id uuid not null references events(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table entry_participants (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  first_name text not null,
  middle_name text,
  last_name text not null,
  gender text not null check (gender in ('M', 'F'))
);

create table entry_coaches (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  full_name text not null,
  gender text not null check (gender in ('M', 'F'))
);

create table app_settings (
  id boolean primary key default true,
  submissions_locked boolean not null default false,
  constraint app_settings_singleton check (id)
);

insert into app_settings (id, submissions_locked) values (true, false);

alter table districts enable row level security;
alter table schools enable row level security;
alter table admin_profiles enable row level security;
alter table events enable row level security;
alter table school_papers enable row level security;
alter table paper_staff enable row level security;
alter table entries enable row level security;
alter table entry_participants enable row level security;
alter table entry_coaches enable row level security;
alter table app_settings enable row level security;

create policy "public read districts" on districts for select using (true);
create policy "public read schools" on schools for select using (true);
create policy "public read events" on events for select using (true);
create policy "public read app_settings" on app_settings for select using (true);

create policy "self read admin_profiles" on admin_profiles for select using (user_id = auth.uid());

create policy "school manage own school_papers" on school_papers for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

create policy "admin read school_papers" on school_papers for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own paper_staff" on paper_staff for all
  using (school_paper_id in (
    select sp.id from school_papers sp
    join schools s on s.id = sp.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (school_paper_id in (
    select sp.id from school_papers sp
    join schools s on s.id = sp.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read paper_staff" on paper_staff for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entries" on entries for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

create policy "admin read entries" on entries for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entry_participants" on entry_participants for all
  using (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read entry_participants" on entry_participants for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "school manage own entry_coaches" on entry_coaches for all
  using (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ))
  with check (entry_id in (
    select e.id from entries e
    join schools s on s.id = e.school_id
    where s.auth_user_id = auth.uid()
  ));

create policy "admin read entry_coaches" on entry_coaches for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

create policy "admin write app_settings" on app_settings for update
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));
