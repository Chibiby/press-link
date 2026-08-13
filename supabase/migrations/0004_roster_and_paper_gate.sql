-- Press Link v3: the roster becomes the source of truth for people.
-- Entries stop storing names and reference participants/coaches by id.

-- 1. Division-wide participant numbering. 4 digits, never reused.
create sequence if not exists participant_number_seq
  start with 1 minvalue 1 maxvalue 9999;

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  participant_number int not null unique default nextval('participant_number_seq'),
  first_name text not null,
  middle_name text,
  last_name text not null,
  gender text not null check (gender in ('M', 'F')),
  created_at timestamptz not null default now()
);

create index if not exists participants_school_id_idx on participants (school_id);

create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  full_name text not null,
  gender text not null check (gender in ('M', 'F')),
  created_at timestamptz not null default now()
);

create index if not exists coaches_school_id_idx on coaches (school_id);

-- 2. Backfill the roster from whatever entries already exist, then swap the
--    name columns for foreign keys. Distinct on the full name so a pupil typed
--    into two entries becomes one roster row.
insert into participants (school_id, first_name, middle_name, last_name, gender)
select distinct on (e.school_id, ep.first_name, coalesce(ep.middle_name, ''), ep.last_name)
  e.school_id, ep.first_name, ep.middle_name, ep.last_name, ep.gender
from entry_participants ep
join entries e on e.id = ep.entry_id
where not exists (
  select 1 from participants p
  where p.school_id = e.school_id
    and p.first_name = ep.first_name
    and coalesce(p.middle_name, '') = coalesce(ep.middle_name, '')
    and p.last_name = ep.last_name
)
order by e.school_id, ep.first_name, coalesce(ep.middle_name, ''), ep.last_name;

insert into coaches (school_id, full_name, gender)
select distinct on (e.school_id, ec.full_name)
  e.school_id, ec.full_name, ec.gender
from entry_coaches ec
join entries e on e.id = ec.entry_id
where not exists (
  select 1 from coaches c
  where c.school_id = e.school_id and c.full_name = ec.full_name
)
order by e.school_id, ec.full_name;

alter table entry_participants
  add column if not exists participant_id uuid references participants(id) on delete cascade;
alter table entry_coaches
  add column if not exists coach_id uuid references coaches(id) on delete cascade;

update entry_participants ep
set participant_id = p.id
from entries e, participants p
where e.id = ep.entry_id
  and p.school_id = e.school_id
  and p.first_name = ep.first_name
  and coalesce(p.middle_name, '') = coalesce(ep.middle_name, '')
  and p.last_name = ep.last_name
  and ep.participant_id is null;

update entry_coaches ec
set coach_id = c.id
from entries e, coaches c
where e.id = ec.entry_id
  and c.school_id = e.school_id
  and c.full_name = ec.full_name
  and ec.coach_id is null;

-- Any row that still has no match had no resolvable person; there is nothing
-- to preserve in it.
delete from entry_participants where participant_id is null;
delete from entry_coaches where coach_id is null;

alter table entry_participants alter column participant_id set not null;
alter table entry_coaches alter column coach_id set not null;

alter table entry_participants drop column if exists first_name;
alter table entry_participants drop column if exists middle_name;
alter table entry_participants drop column if exists last_name;
alter table entry_participants drop column if exists gender;

alter table entry_coaches drop column if exists full_name;
alter table entry_coaches drop column if exists gender;

alter table entry_participants
  drop constraint if exists entry_participants_entry_participant_key;
alter table entry_participants
  add constraint entry_participants_entry_participant_key unique (entry_id, participant_id);

alter table entry_coaches
  drop constraint if exists entry_coaches_entry_coach_key;
alter table entry_coaches
  add constraint entry_coaches_entry_coach_key unique (entry_id, coach_id);

-- 3. Per-event participant counts. null max = unbounded.
alter table event_types add column if not exists min_participants int not null default 1;
alter table event_types add column if not exists max_participants int;

update event_types set min_participants = 1, max_participants = 3
  where category = 'individual';
update event_types set min_participants = 7, max_participants = 7
  where slug in (
    'radio-broadcasting-regular',
    'radio-broadcasting-spj',
    'collaborative-publishing',
    'tv-broadcasting-regular',
    'tv-broadcasting-spj'
  );
update event_types set min_participants = 2, max_participants = null
  where slug = 'online-publishing';

-- 4. School paper gate.
alter table schools add column if not exists paper_participation text not null default 'undecided';
alter table schools drop constraint if exists schools_paper_participation_check;
alter table schools add constraint schools_paper_participation_check
  check (paper_participation in ('undecided', 'yes', 'no'));

-- 5. RLS.
alter table participants enable row level security;
alter table coaches enable row level security;

drop policy if exists "school manage own participants" on participants;
create policy "school manage own participants" on participants for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read participants" on participants;
create policy "admin read participants" on participants for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

drop policy if exists "school manage own coaches" on coaches;
create policy "school manage own coaches" on coaches for all
  using (school_id in (select id from schools where auth_user_id = auth.uid()))
  with check (school_id in (select id from schools where auth_user_id = auth.uid()));

drop policy if exists "admin read coaches" on coaches;
create policy "admin read coaches" on coaches for select
  using (exists (select 1 from admin_profiles where user_id = auth.uid()));

-- 6. The paper answer is the only column a school may write on its own row,
--    so it goes through a definer function rather than an update policy.
create or replace function set_paper_participation(choice text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if choice not in ('yes', 'no') then
    raise exception 'invalid choice: %', choice;
  end if;
  update schools set paper_participation = choice where auth_user_id = auth.uid();
end;
$fn$;

revoke all on function set_paper_participation(text) from public;
grant execute on function set_paper_participation(text) to authenticated;

create or replace function admin_reset_paper_participation(target_school uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;
  update schools set paper_participation = 'undecided' where id = target_school;
end;
$fn$;

revoke all on function admin_reset_paper_participation(uuid) from public;
grant execute on function admin_reset_paper_participation(uuid) to authenticated;
