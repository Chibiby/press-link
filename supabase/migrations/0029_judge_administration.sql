-- Judge administration: the four writes the roster needs.
--
-- 0018 created `judges`, and 0027 revoked insert, update and delete on it from
-- `authenticated`. That is why the admin console shipped with a disabled "Add
-- judge" button and no way to seat anybody: the table was ready and nothing was
-- allowed to write to it. 0027 made every *event* state change a security
-- definer RPC; this does the same for the roster itself, so that revoke stays
-- absolute and there is exactly one path to a judge row.
--
-- WHY NOT THE SERVICE ROLE. The service role bypasses row level security and is
-- the only way to create an `auth.users` row, so provisioning a judge's login
-- needs it. Creating the judge does not, and routing that through the service
-- role as well would put a second writer beside these functions carrying no
-- rule at all. The server action uses the service role for
-- `auth.admin.createUser` alone, then calls `admin_link_judge_login` to attach
-- the result — so the judges table itself is still only ever written here.
--
-- WHAT THIS DOES NOT TOUCH: no existing function is altered, no policy is added
-- or dropped, no row of any table is rewritten. It adds one partial unique
-- index and four functions.
--
-- Safe to re-run: every statement is `create or replace` or `if not exists`.

-- ---------------------------------------------------------------------------
-- 1. One judge per email address
-- ---------------------------------------------------------------------------
-- `judges.email` is nullable and stays nullable: a panel is drawn up in a
-- meeting and the logins are made later (0018). But an address that appears on
-- two judges cannot become an `auth.users` row twice. Without this index that
-- collision surfaces at provisioning time, days later, as a failure on
-- whichever judge happened to be second — by which point nobody remembers which
-- of the two the address belonged to. Entry is the only moment the admin still
-- knows.
create unique index if not exists judges_email_unique
  on judges (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- 2. Adding a judge
-- ---------------------------------------------------------------------------
-- The shape checks here are a backstop, not the rule: `lib/judges/judge-input.ts`
-- holds the validation the admin actually reads, with its own tests, because a
-- sentence an admin can act on cannot be assembled from a Postgres exception.
-- These exist so a caller that skips that module still cannot write a judge with
-- no name.
create or replace function admin_create_judge(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_email text,
  p_affiliation text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first text := nullif(btrim(p_first_name), '');
  v_last text := nullif(btrim(p_last_name), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_id uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if v_first is null or v_last is null then
    raise exception 'a judge needs a first name and a last name';
  end if;

  if v_email is not null and v_email not like '%_@_%.__%' then
    raise exception 'that does not look like an email address';
  end if;

  if v_email is not null and exists (
    select 1 from judges where lower(email) = v_email
  ) then
    raise exception 'another judge is already on file with that email address';
  end if;

  insert into judges (first_name, middle_name, last_name, email, affiliation)
       values (
         v_first,
         nullif(btrim(p_middle_name), ''),
         v_last,
         v_email,
         nullif(btrim(p_affiliation), '')
       )
    returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function admin_create_judge(text, text, text, text, text) from public;
grant execute on function admin_create_judge(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Editing a judge
-- ---------------------------------------------------------------------------
-- The email of a judge who already has a login is refused, and that is the one
-- rule in this file worth arguing about. `judges.email` is what the roster
-- displays; `auth.users.email` is what the judge types to sign in. Changing one
-- of the two leaves the console showing an address that cannot sign in, and this
-- function cannot write the other. So a linked judge's address is fixed here and
-- has to be changed where the login lives.
create or replace function admin_update_judge(
  p_judge_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_email text,
  p_affiliation text
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first text := nullif(btrim(p_first_name), '');
  v_last text := nullif(btrim(p_last_name), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_current text;
  v_auth uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  select lower(email), auth_user_id into v_current, v_auth
    from judges where id = p_judge_id;
  if not found then
    raise exception 'judge not found';
  end if;

  if v_first is null or v_last is null then
    raise exception 'a judge needs a first name and a last name';
  end if;

  if v_email is not null and v_email not like '%_@_%.__%' then
    raise exception 'that does not look like an email address';
  end if;

  if v_auth is not null and coalesce(v_email, '') <> coalesce(v_current, '') then
    raise exception 'this judge signs in with that email address; it cannot be changed here';
  end if;

  if v_email is not null and exists (
    select 1 from judges where lower(email) = v_email and id <> p_judge_id
  ) then
    raise exception 'another judge is already on file with that email address';
  end if;

  update judges
     set first_name = v_first,
         middle_name = nullif(btrim(p_middle_name), ''),
         last_name = v_last,
         email = v_email,
         affiliation = nullif(btrim(p_affiliation), '')
   where id = p_judge_id;
end;
$fn$;

revoke all on function admin_update_judge(uuid, text, text, text, text, text) from public;
grant execute on function admin_update_judge(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Taking a judge off the roster
-- ---------------------------------------------------------------------------
-- 0018 chose `is_active` over deleting because a withdrawn judge's submitted
-- sheets still feed placements. That is also why deactivating a *seated* judge is
-- refused: `admin_lock_results` requires three active judges in seats 2 to 4, so
-- clearing the flag on someone still holding a seat would quietly make the event
-- unpublishable, with nothing on the event's own page to say why. The admin
-- unseats them first, which is refused in turn while their sheet stands —
-- and a judge whose sheet stands is a judge whose placement counts, so their
-- staying on the roster is the correct outcome, not an obstruction.
--
-- Reactivating is unconditional: an inactive judge holds no seat by the rule
-- above, so there is nothing for it to contradict.
create or replace function admin_set_judge_active(p_judge_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_seats int;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if p_active is null then
    raise exception 'active must be true or false';
  end if;

  if not exists (select 1 from judges where id = p_judge_id) then
    raise exception 'judge not found';
  end if;

  if not p_active then
    select count(*) into v_seats from judge_assignments where judge_id = p_judge_id;
    if v_seats > 0 then
      raise exception 'this judge is seated on % event(s); unseat them there first', v_seats;
    end if;
  end if;

  update judges set is_active = p_active where id = p_judge_id;
end;
$fn$;

revoke all on function admin_set_judge_active(uuid, boolean) from public;
grant execute on function admin_set_judge_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Attaching a login
-- ---------------------------------------------------------------------------
-- Called after the server action has made the `auth.users` row with the service
-- role, which is the one thing SQL cannot do. Idempotent on the link it already
-- holds, so a retry after a lost response is not an error; any *other* login is
-- refused, because overwriting `auth_user_id` would strand an account that can
-- still authenticate but no longer resolves to a judge.
create or replace function admin_link_judge_login(p_judge_id uuid, p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing uuid;
begin
  if not exists (select 1 from admin_profiles where user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  if p_auth_user_id is null then
    raise exception 'no login given';
  end if;

  select auth_user_id into v_existing from judges where id = p_judge_id;
  if not found then
    raise exception 'judge not found';
  end if;

  if v_existing is not null then
    if v_existing = p_auth_user_id then
      return;
    end if;
    raise exception 'this judge already has a login';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'that login does not exist';
  end if;

  if exists (select 1 from judges where auth_user_id = p_auth_user_id) then
    raise exception 'that login already belongs to another judge';
  end if;

  update judges set auth_user_id = p_auth_user_id where id = p_judge_id;
end;
$fn$;

revoke all on function admin_link_judge_login(uuid, uuid) from public;
grant execute on function admin_link_judge_login(uuid, uuid) to authenticated;
