-- Migration 007: username sign-in and safe development accounts.
--
-- Accounts may sign in with a username as well as a phone number. Accounts
-- created by the development seed are flagged weak_password; the server
-- refuses those sign-ins in production unless explicitly allowed, and the
-- flag clears as soon as the password is changed.
begin;

alter table public.profiles add column if not exists username text;
alter table public.profiles add constraint profiles_username_format check(username is null or username ~ '^[a-z][a-z0-9._-]{2,39}$');
create unique index if not exists profiles_username_unique on public.profiles(username) where username is not null;

alter table private.accounts add column if not exists weak_password boolean not null default false;
alter table private.accounts add column if not exists password_changed_at timestamptz;

-- Change a username (or remove it with null). Same reach rules as editing a profile.
create function public.set_profile_username(p_id uuid,p_username text) returns void language plpgsql security definer set search_path='' as $$
declare t public.profiles; u text:=nullif(lower(trim(coalesce(p_username,''))),'');
begin
 select * into t from public.profiles where id=p_id;
 if t.id is null then raise exception 'User not found';end if;
 if u is not distinct from t.username then return;end if;
 if not private.is_admin() then
  if not private.permitted('users','edit',p_id) then raise exception 'Permission denied';end if;
  if t.role='super_admin' then raise exception 'Only a Super Admin can change a Super Admin account';end if;
 end if;
 if u is not null and u !~ '^[a-z][a-z0-9._-]{2,39}$' then raise exception 'Usernames start with a letter and use 3–40 lowercase letters, numbers, dots, dashes or underscores';end if;
 if u is not null and exists(select 1 from public.profiles where username=u and id<>p_id) then raise exception 'That username is already taken';end if;
 update public.profiles set username=u where id=p_id;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Username updated',jsonb_build_object('user_id',p_id,'before',t.username,'after',u));
end $$;

-- Authorizes an administrator password reset; the server then stores the new hash.
create function public.authorize_password_reset(p_actor uuid,p_user uuid) returns void language plpgsql stable security definer set search_path='' as $$
declare a public.profiles; t public.profiles;
begin
 select * into a from public.profiles where id=p_actor and active and not must_change_password;
 select * into t from public.profiles where id=p_user;
 if a.id is null or t.id is null then raise exception 'Permission denied';end if;
 if p_actor=p_user then raise exception 'Use Change password for your own account';end if;
 if a.role='super_admin' then return; end if;
 if t.role='super_admin' then raise exception 'Only a Super Admin can reset a Super Admin password';end if;
 if not private.permitted_for(p_actor,'users','edit',p_user) then raise exception 'Permission denied';end if;
end $$;

revoke all on function public.set_profile_username(uuid,text),public.authorize_password_reset(uuid,uuid) from public,techly_anon,techly_user,techly_service;
grant execute on function public.set_profile_username(uuid,text) to techly_user;
grant execute on function public.authorize_password_reset(uuid,uuid) to techly_service;
-- The development seed assigns employee IDs to the accounts it creates.
grant execute on function private.next_employee_id(text) to techly_service;
commit;
