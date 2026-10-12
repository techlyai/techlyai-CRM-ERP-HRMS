begin;
alter table private.stored_files add constraint stored_file_size_matches check(octet_length(content)=size);
alter table private.stored_files add constraint stored_file_record_fk foreign key(record_id) references public.records(id);
create table private.uploads (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 record_id uuid references public.records(id),
 path text not null unique,
 name text not null,
 mime text not null,
 size integer not null check(size between 1 and 20971520),
 sound boolean not null,
 expires_at timestamptz not null default now()+interval '1 hour'
);
create index uploads_expiry_idx on private.uploads(expires_at);
create index uploads_user_idx on private.uploads(user_id);
create table private.upload_parts (
 upload_id uuid not null references private.uploads(id) on delete cascade,
 part integer not null check(part between 0 and 6),
 content bytea not null check(octet_length(content) between 1 and 3145728),
 primary key(upload_id,part)
);
alter table private.uploads enable row level security;
alter table private.upload_parts enable row level security;
grant select,insert,update,delete on private.uploads,private.upload_parts to techly_service;
-- Required by policies and direct, scoped permission checks in the application.
grant execute on function private.current_user_id() to techly_user;
commit;
