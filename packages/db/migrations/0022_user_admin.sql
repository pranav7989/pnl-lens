-- @file  packages/db/migrations/0022_user_admin.sql
-- @area  Database
-- @what  Admin user management: restrict / unrestrict (owner, admin) and delete (owner) as role-checked, audited functions; research consent invites sent by email.
--
-- Restricting sets users.status = 'blocked' (sign-in refused, every session ends at once via sessions_valid_after).
-- Deleting reuses delete_account() (0013): reports, trades and files removed, account anonymised, payments kept.
-- research_invites: the owner's "Request reports" email. Only the SHA-256 of the link token is stored; answering
-- appends a consents row (0011), so the research views (0014) and datasets (0021) follow it.

alter table public.users add column if not exists restricted_reason text check (restricted_reason is null or char_length(restricted_reason) <= 500);
alter table public.users add column if not exists restricted_at timestamptz;
alter table public.users add column if not exists restricted_by uuid references public.users(id) on delete set null;

create table if not exists public.research_invites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  sent_by      uuid references public.users(id) on delete set null,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  answered_at  timestamptz,
  answer       boolean,
  ip_hash      text
);
create index if not exists research_invites_user on public.research_invites (user_id, created_at desc);
revoke all on public.research_invites from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant select, insert on public.research_invites to lens_app;
    grant update (answered_at, answer, ip_hash) on public.research_invites to lens_app;
  end if;
end $$;

-- restrict / unrestrict: owner or admin; never yourself or an owner; an admin cannot restrict another admin
create or replace function public.admin_set_user_status(p_actor uuid, p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text; v_target users%rowtype;
begin
  select role into v_actor from users where id = p_actor and status = 'active';
  if v_actor is null or v_actor not in ('owner', 'admin') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_target from users where id = p_user and status <> 'deleted' for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_user = p_actor or v_target.role = 'owner' or (v_actor = 'admin' and v_target.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status = 'blocked' then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = 'P0001'; end if;
    update users set status = 'blocked', restricted_reason = btrim(p_reason), restricted_at = now(), restricted_by = p_actor,
           sessions_valid_after = now() where id = p_user;
    insert into audit_log (user_id, action, meta) values (p_user, 'user_restricted', jsonb_build_object('by', p_actor, 'reason', btrim(p_reason)));
  elsif p_status = 'active' then
    update users set status = 'active', restricted_reason = null, restricted_at = null, restricted_by = null where id = p_user;
    insert into audit_log (user_id, action, meta) values (p_user, 'user_unrestricted', jsonb_build_object('by', p_actor));
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
end $$;

-- delete: owner only; never yourself or another owner; a reason is required
create or replace function public.admin_delete_user(p_actor uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_target users%rowtype;
begin
  if not exists (select 1 from users where id = p_actor and role = 'owner' and status = 'active') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_target from users where id = p_user and status <> 'deleted';
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_user = p_actor or v_target.role = 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  insert into audit_log (user_id, action, meta) values (p_user, 'user_deleted_by_admin', jsonb_build_object('by', p_actor, 'reason', btrim(p_reason)));
  perform delete_account(p_user);
end $$;

revoke all on function public.admin_set_user_status(uuid, uuid, text, text), public.admin_delete_user(uuid, uuid, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'lens_app') then
    grant execute on function public.admin_set_user_status(uuid, uuid, text, text), public.admin_delete_user(uuid, uuid, text) to lens_app;
  end if;
end $$;
