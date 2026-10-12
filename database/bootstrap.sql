-- Run as the migration owner in a dedicated empty PostgreSQL 15+ database.
begin;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='techly_user') then create role techly_user nologin; end if;
 if not exists(select 1 from pg_roles where rolname='techly_service') then create role techly_service nologin bypassrls; end if;
 if not exists(select 1 from pg_roles where rolname='techly_anon') then create role techly_anon nologin; end if;
end $$;
revoke create on schema public from public;
grant usage on schema public to techly_user,techly_service;
create schema private;
revoke all on schema private from public;
grant usage on schema private to techly_user,techly_service;
create function private.current_user_id() returns uuid language sql stable set search_path='' as $$
 select nullif(current_setting('app.user_id',true),'')::uuid;
$$;
revoke all on function private.current_user_id() from public;
grant execute on function private.current_user_id() to techly_user,techly_service;
create table private.accounts (
 id uuid primary key default gen_random_uuid(),
 password_hash text not null,
 created_at timestamptz not null default now()
);
create table private.sessions (
 token_hash text primary key,
 user_id uuid not null references private.accounts(id) on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index sessions_user_idx on private.sessions(user_id);
create index sessions_expiry_idx on private.sessions(expires_at);
create table private.stored_files (
 path text primary key,
 uploaded_by uuid not null references private.accounts(id),
 record_id uuid,
 name text not null,
 mime text not null,
 size bigint not null check(size between 1 and 20971520),
 content bytea not null,
 created_at timestamptz not null default now()
);
alter table private.accounts enable row level security;
alter table private.sessions enable row level security;
alter table private.stored_files enable row level security;
grant select,insert,update,delete on private.accounts,private.sessions,private.stored_files to techly_service;
commit;
