-- Migration 002: client credentials vault.
-- Passwords are encrypted on the application server (AES-256-GCM, key outside the database).
-- The database stores only ciphertext, enforces access, keeps version history atomic and
-- writes an audit trail that never contains secrets.
begin;

create table public.client_credentials(
 id uuid primary key,
 client_id uuid not null references public.records(id),
 service_name text not null check(length(trim(service_name)) between 1 and 120),
 category text not null default 'Other' check(category in ('Website Admin','WordPress','Hosting','Domain Registrar','Business Email','Analytics','Social Media','CRM','Payment Gateway','Cloud','Other')),
 login_url text check(login_url is null or (length(login_url)<=2048 and login_url ~* '^https?://')),
 username text check(username is null or length(username)<=320),
 account_id text check(account_id is null or length(account_id)<=320),
 project_id uuid references public.records(id),
 purpose text not null default '' check(length(purpose)<=2000),
 notes text not null default '' check(length(notes)<=5000),
 current_version integer not null default 1 check(current_version>=1),
 password_changed_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),
 archived_at timestamptz,
 archived_by uuid references public.profiles(id),
 row_version integer not null default 1
);
create index client_credentials_client_idx on public.client_credentials(client_id,archived_at,service_name);
-- One active record per client, service and username prevents accidental duplicates.
create unique index client_credentials_unique_active on public.client_credentials(client_id,lower(service_name),lower(coalesce(username,''))) where archived_at is null;

create table private.credential_secrets(
 credential_id uuid not null references public.client_credentials(id) on delete cascade,
 version integer not null check(version>=1),
 ciphertext bytea not null,
 iv bytea not null check(length(iv)=12),
 tag bytea not null check(length(tag)=16),
 key_id text not null check(length(key_id) between 1 and 64),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.profiles(id),
 replaced_at timestamptz,
 replaced_by uuid references public.profiles(id),
 reason text not null default '' check(length(reason)<=500),
 primary key(credential_id,version)
);
alter table private.credential_secrets enable row level security;

-- Audit rows survive credential deletion, so they carry ids without foreign keys.
create table public.credential_audit(
 id bigint generated always as identity primary key,
 credential_id uuid not null,
 client_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('created','updated','password_changed','revealed','copied','history_viewed','history_revealed','history_copied','archived','restored','deleted','vault_unlocked')),
 version integer,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index credential_audit_credential_idx on public.credential_audit(credential_id,created_at desc);
create index credential_audit_actor_idx on public.credential_audit(actor_id,created_at desc);

create table private.vault_unlocks(user_id uuid primary key references public.profiles(id),expires_at timestamptz not null);
alter table private.vault_unlocks enable row level security;

-- ---------------------------------------------------------------------------
-- Access rules
-- Manage (list, add, edit, reveal/copy current): Edit permission on the client record.
-- History (reveal/copy previous passwords): Super Admin or Approve permission on clients,
-- plus a password re-confirmation within the last 10 minutes.
-- Delete: Super Admin only, archived credentials only.
-- ---------------------------------------------------------------------------
create function private.can_manage_credentials(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.records r where r.id=p_client and r.module='clients' and private.visible(r.id) and private.permitted('clients','edit',r.owner_id));
$$;
create function private.can_view_credential_history(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_manage_credentials(p_client) and (private.is_admin() or exists(select 1 from public.records r where r.id=p_client and private.permitted('clients','approve',r.owner_id)));
$$;
create function private.credential_audit_write(p_credential uuid,p_client uuid,p_action text,p_version integer,p_detail jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into public.credential_audit(credential_id,client_id,actor_id,action,version,detail) values(p_credential,p_client,private.current_user_id(),p_action,p_version,coalesce(p_detail,'{}'));
$$;
create function private.credential_clean(p_data jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid credential details';end if;
 if p_data ?| array['password','secret','ciphertext'] then raise exception 'Passwords are not accepted in credential details';end if;
 return p_data;
end $$;
create function private.decode_secret(p_secret jsonb,field text) returns bytea language plpgsql immutable set search_path='' as $$
begin
 if p_secret->>field is null then raise exception 'Encrypted password is incomplete';end if;
 return decode(p_secret->>field,'base64');
end $$;

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create function public.create_credential(p_id uuid,p_client uuid,p_data jsonb,p_secret jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); d jsonb:=private.credential_clean(p_data); client public.records;
begin
 if actor is null or not private.can_manage_credentials(p_client) then raise exception 'You do not have permission to manage credentials for this client';end if;
 select * into client from public.records where id=p_client;
 if client.status='Archived' then raise exception 'Archived clients are read-only';end if;
 if nullif(d->>'project_id','') is not null and not exists(select 1 from public.records where id=(d->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Select an accessible project';end if;
 if exists(select 1 from public.client_credentials c where c.client_id=p_client and c.archived_at is null and lower(c.service_name)=lower(trim(d->>'service_name')) and lower(coalesce(c.username,''))=lower(coalesce(nullif(trim(d->>'username'),''),''))) then
  raise exception 'A credential for this service and username already exists. Update its password instead.';
 end if;
 insert into public.client_credentials(id,client_id,service_name,category,login_url,username,account_id,project_id,purpose,notes,created_by,updated_by)
 values(p_id,p_client,trim(d->>'service_name'),coalesce(nullif(d->>'category',''),'Other'),nullif(trim(d->>'login_url'),''),nullif(trim(d->>'username'),''),nullif(trim(d->>'account_id'),''),nullif(d->>'project_id','')::uuid,coalesce(d->>'purpose',''),coalesce(d->>'notes',''),actor,actor);
 insert into private.credential_secrets(credential_id,version,ciphertext,iv,tag,key_id,created_by,reason)
 values(p_id,1,private.decode_secret(p_secret,'ciphertext'),private.decode_secret(p_secret,'iv'),private.decode_secret(p_secret,'tag'),p_secret->>'key_id',actor,'Initial password');
 perform private.credential_audit_write(p_id,p_client,'created',1,jsonb_build_object('service',trim(d->>'service_name')));
 return p_id;
end $$;

create function public.update_credential(p_id uuid,p_row_version integer,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); d jsonb:=private.credential_clean(p_data); c public.client_credentials; changed text[];
begin
 select * into c from public.client_credentials where id=p_id for update;
 if c.id is null or not private.can_manage_credentials(c.client_id) then raise exception 'Credential not found';end if;
 if c.archived_at is not null then raise exception 'Restore this credential before editing it';end if;
 if c.row_version<>p_row_version then raise exception 'This credential changed. Refresh and try again.';end if;
 if nullif(d->>'project_id','') is not null and not exists(select 1 from public.records where id=(d->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Select an accessible project';end if;
 select array_agg(k) into changed from unnest(array['service_name','category','login_url','username','account_id','project_id','purpose','notes']) k
  where coalesce(nullif(trim(d->>k),''),'') is distinct from coalesce(to_jsonb(c)->>k,'');
 update public.client_credentials set service_name=trim(d->>'service_name'),category=coalesce(nullif(d->>'category',''),'Other'),login_url=nullif(trim(d->>'login_url'),''),username=nullif(trim(d->>'username'),''),account_id=nullif(trim(d->>'account_id'),''),project_id=nullif(d->>'project_id','')::uuid,purpose=coalesce(d->>'purpose',''),notes=coalesce(d->>'notes',''),updated_at=now(),updated_by=actor,row_version=row_version+1 where id=p_id;
 perform private.credential_audit_write(p_id,c.client_id,'updated',c.current_version,jsonb_build_object('fields',coalesce(changed,'{}')));
exception when unique_violation then raise exception 'Another active credential already uses this service and username';
end $$;

-- Atomic: the previous version is closed and the new version inserted in one transaction.
create function public.change_credential_password(p_id uuid,p_row_version integer,p_new_version integer,p_secret jsonb,p_reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); c public.client_credentials;
begin
 select * into c from public.client_credentials where id=p_id for update;
 if c.id is null or not private.can_manage_credentials(c.client_id) then raise exception 'Credential not found';end if;
 if c.archived_at is not null then raise exception 'Restore this credential before changing its password';end if;
 if c.row_version<>p_row_version or p_new_version<>c.current_version+1 then raise exception 'This credential changed. Refresh and try again.';end if;
 update private.credential_secrets set replaced_at=now(),replaced_by=actor where credential_id=p_id and version=c.current_version;
 insert into private.credential_secrets(credential_id,version,ciphertext,iv,tag,key_id,created_by,reason)
 values(p_id,p_new_version,private.decode_secret(p_secret,'ciphertext'),private.decode_secret(p_secret,'iv'),private.decode_secret(p_secret,'tag'),p_secret->>'key_id',actor,left(coalesce(p_reason,''),500));
 update public.client_credentials set current_version=p_new_version,password_changed_at=now(),updated_at=now(),updated_by=actor,row_version=row_version+1 where id=p_id;
 perform private.credential_audit_write(p_id,c.client_id,'password_changed',p_new_version,jsonb_build_object('previous_version',c.current_version,'reason',left(coalesce(p_reason,''),500)));
end $$;

-- Returns ciphertext for decryption on the server; every call is audited and rate limited.
create function public.credential_secret(p_id uuid,p_version integer,p_purpose text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); c public.client_credentials; s private.credential_secrets; historical boolean; recent integer;
begin
 if p_purpose not in ('reveal','copy') then raise exception 'Invalid request';end if;
 select * into c from public.client_credentials where id=p_id;
 if c.id is null or not private.can_manage_credentials(c.client_id) then raise exception 'Credential not found';end if;
 historical:=p_version is not null and p_version<>c.current_version;
 if historical then
  if not private.can_view_credential_history(c.client_id) then raise exception 'Only authorized reviewers can open previous passwords';end if;
  if not exists(select 1 from private.vault_unlocks where user_id=actor and expires_at>now()) then raise exception 'Confirm your password to open previous passwords';end if;
 end if;
 select count(*) into recent from public.credential_audit where actor_id=actor and action in ('revealed','copied','history_revealed','history_copied') and created_at>now()-interval '1 minute';
 if recent>=30 then raise exception 'Too many password requests. Wait a minute and try again.';end if;
 select * into s from private.credential_secrets where credential_id=p_id and version=coalesce(p_version,c.current_version);
 if s.credential_id is null then raise exception 'Password version not found';end if;
 perform private.credential_audit_write(p_id,c.client_id,case when historical then 'history_' else '' end||case when p_purpose='reveal' then 'revealed' else 'copied' end,s.version);
 return jsonb_build_object('credential_id',p_id,'version',s.version,'key_id',s.key_id,'ciphertext',encode(s.ciphertext,'base64'),'iv',encode(s.iv,'base64'),'tag',encode(s.tag,'base64'));
end $$;

create function public.credential_versions(p_id uuid) returns table(version integer,created_at timestamptz,created_by text,replaced_at timestamptz,replaced_by text,reason text,is_current boolean) language plpgsql security definer set search_path='' as $$
declare c public.client_credentials;
begin
 select * into c from public.client_credentials where id=p_id;
 if c.id is null or not private.can_manage_credentials(c.client_id) then raise exception 'Credential not found';end if;
 perform private.credential_audit_write(p_id,c.client_id,'history_viewed',c.current_version);
 return query select s.version,s.created_at,coalesce(a.full_name,'Unknown'),s.replaced_at,b.full_name,s.reason,s.version=c.current_version
  from private.credential_secrets s left join public.profiles a on a.id=s.created_by left join public.profiles b on b.id=s.replaced_by
  where s.credential_id=p_id order by s.version desc;
end $$;

create function public.archive_credential(p_id uuid,p_archived boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); c public.client_credentials;
begin
 select * into c from public.client_credentials where id=p_id for update;
 if c.id is null or not private.can_manage_credentials(c.client_id) then raise exception 'Credential not found';end if;
 if p_archived and c.archived_at is null then
  update public.client_credentials set archived_at=now(),archived_by=actor,updated_at=now(),updated_by=actor,row_version=row_version+1 where id=p_id;
  perform private.credential_audit_write(p_id,c.client_id,'archived',c.current_version);
 elsif not p_archived and c.archived_at is not null then
  if exists(select 1 from public.client_credentials x where x.client_id=c.client_id and x.archived_at is null and x.id<>c.id and lower(x.service_name)=lower(c.service_name) and lower(coalesce(x.username,''))=lower(coalesce(c.username,''))) then raise exception 'An active credential with this service and username already exists';end if;
  update public.client_credentials set archived_at=null,archived_by=null,updated_at=now(),updated_by=actor,row_version=row_version+1 where id=p_id;
  perform private.credential_audit_write(p_id,c.client_id,'restored',c.current_version);
 end if;
end $$;

-- Permanent deletion: Super Admin only, archived first, reason required. Audit rows are kept.
create function public.delete_credential(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare c public.client_credentials;
begin
 select * into c from public.client_credentials where id=p_id for update;
 if c.id is null or not private.is_admin() or not private.can_manage_credentials(c.client_id) then raise exception 'Only a Super Admin can permanently delete credentials';end if;
 if c.archived_at is null then raise exception 'Archive the credential before deleting it';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Give a reason for deleting this credential';end if;
 perform private.credential_audit_write(p_id,c.client_id,'deleted',c.current_version,jsonb_build_object('service',c.service_name,'reason',left(trim(p_reason),500),'versions',(select count(*) from private.credential_secrets where credential_id=p_id)));
 delete from public.client_credentials where id=p_id;
end $$;

-- Called by the server only after it has verified the user's password.
create function public.unlock_credential_vault(p_user uuid,p_minutes integer default 10) returns timestamptz language plpgsql security definer set search_path='' as $$
declare e timestamptz:=now()+make_interval(mins=>least(greatest(p_minutes,1),30));
begin
 insert into private.vault_unlocks(user_id,expires_at) values(p_user,e) on conflict(user_id) do update set expires_at=excluded.expires_at;
 insert into public.credential_audit(credential_id,client_id,actor_id,action,detail) values('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000',p_user,'vault_unlocked',jsonb_build_object('minutes',least(greatest(p_minutes,1),30)));
 return e;
end $$;
create function public.vault_unlocked_until() returns timestamptz language sql stable security definer set search_path='' as $$
 select expires_at from private.vault_unlocks where user_id=private.current_user_id() and expires_at>now();
$$;

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------
alter table public.client_credentials enable row level security;
alter table public.credential_audit enable row level security;
create policy client_credentials_read on public.client_credentials for select to techly_user using(private.can_manage_credentials(client_id));
create policy credential_audit_read on public.credential_audit for select to techly_user using(private.is_admin() or (actor_id=private.current_user_id()) or private.can_view_credential_history(client_id));
grant select on public.client_credentials,public.credential_audit to techly_user;
grant all on public.client_credentials,public.credential_audit to techly_service;
grant select,insert,update,delete on private.credential_secrets,private.vault_unlocks to techly_service;
revoke all on function private.can_manage_credentials(uuid),private.can_view_credential_history(uuid),private.credential_audit_write(uuid,uuid,text,integer,jsonb),private.credential_clean(jsonb),private.decode_secret(jsonb,text) from public,techly_anon,techly_user;
grant execute on function private.can_manage_credentials(uuid),private.can_view_credential_history(uuid) to techly_user;
revoke all on function public.create_credential(uuid,uuid,jsonb,jsonb),public.update_credential(uuid,integer,jsonb),public.change_credential_password(uuid,integer,integer,jsonb,text),public.credential_secret(uuid,integer,text),public.credential_versions(uuid),public.archive_credential(uuid,boolean),public.delete_credential(uuid,text),public.unlock_credential_vault(uuid,integer),public.vault_unlocked_until() from public,techly_anon,techly_user,techly_service;
grant execute on function public.create_credential(uuid,uuid,jsonb,jsonb),public.update_credential(uuid,integer,jsonb),public.change_credential_password(uuid,integer,integer,jsonb,text),public.credential_secret(uuid,integer,text),public.credential_versions(uuid),public.archive_credential(uuid,boolean),public.delete_credential(uuid,text),public.vault_unlocked_until() to techly_user;
grant execute on function public.unlock_credential_vault(uuid,integer) to techly_service;
commit;
