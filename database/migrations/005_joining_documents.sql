-- Migration 005: employee joining documents and large-file storage.
--
-- Large files are stored as the 3 MiB pieces they were uploaded in, instead of
-- one bytea value. The server copies pieces inside PostgreSQL when an upload
-- finishes and streams them back on download, so file size is not limited by
-- application memory. Small files keep the existing single-value layout.
begin;

-- ---------------------------------------------------------------------------
-- Upload staging: allow any size and any number of pieces.
-- ---------------------------------------------------------------------------
alter table private.uploads alter column size type bigint;
alter table private.uploads drop constraint if exists uploads_size_check;
alter table private.uploads add constraint uploads_size_check check(size>=1);
alter table private.uploads add column if not exists kind text not null default 'general';
alter table private.uploads add constraint uploads_kind_check check(kind in ('general','joining'));
alter table private.upload_parts drop constraint if exists upload_parts_part_check;
alter table private.upload_parts add constraint upload_parts_part_check check(part>=0);

-- ---------------------------------------------------------------------------
-- Stored files: single value (small) or chunked (large).
-- ---------------------------------------------------------------------------
alter table private.stored_files add column if not exists chunked boolean not null default false;
alter table private.stored_files alter column content drop not null;
alter table private.stored_files drop constraint if exists stored_files_size_check;
alter table private.stored_files drop constraint if exists stored_file_size_matches;
alter table private.stored_files add constraint stored_files_size_check check(size>=1);
alter table private.stored_files add constraint stored_file_layout check(
 (not chunked and content is not null and octet_length(content)=size)
 or (chunked and content is null)
);
create table private.stored_file_chunks(
 path text not null references private.stored_files(path) on delete cascade,
 part integer not null check(part>=0),
 content bytea not null check(octet_length(content) between 1 and 3145728),
 primary key(path,part)
);
alter table private.stored_file_chunks enable row level security;
grant select,insert,update,delete on private.stored_file_chunks to techly_service;

-- ---------------------------------------------------------------------------
-- Attachments: any size, plus a document kind for joining documents.
-- ---------------------------------------------------------------------------
alter table public.attachments drop constraint if exists attachments_size_check;
alter table public.attachments add constraint attachments_size_check check(size>=1);
alter table public.attachments add column if not exists kind text not null default 'general';
alter table public.attachments add constraint attachments_kind_check check(kind in ('general','joining'));
create index if not exists attachments_record_kind_idx on public.attachments(record_id,kind,created_at desc);

drop function public.attach_file(uuid,text,text,text,bigint);
create function public.attach_file(p_record uuid,p_path text,p_name text,p_mime text,p_size bigint,p_kind text default 'general') returns uuid language plpgsql security definer set search_path='' as $$
declare r public.records; aid uuid;
begin select * into r from public.records where id=p_record;
 if not private.visible(p_record) or not private.permitted(r.module,'upload',r.owner_id) or p_path not like private.current_user_id()::text||'/'||p_record::text||'/%' then raise exception 'Permission denied';end if;
 if not exists(select 1 from private.stored_files where path=p_path and record_id=p_record and uploaded_by=private.current_user_id() and mime=p_mime and size=p_size) then raise exception 'Upload not found';end if;
 if p_mime not in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','audio/mpeg','audio/wav') then raise exception 'Unsupported file format';end if;
 if p_kind not in ('general','joining') then raise exception 'Invalid document type';end if;
 if p_kind='joining' and (r.module<>'employees' or p_mime<>'application/pdf') then raise exception 'Joining documents must be a single PDF on an employee record';end if;
 insert into public.attachments(record_id,uploaded_by,path,name,mime,size,kind) values(p_record,private.current_user_id(),p_path,p_name,p_mime,p_size,p_kind) returning id into aid;
 insert into public.history(record_id,actor_id,action,snapshot) values(p_record,private.current_user_id(),case when p_kind='joining' then 'Joining documents uploaded' else 'Attachment uploaded' end,jsonb_build_object('attachment_id',aid,'name',p_name,'size',p_size));
 return aid;end $$;
revoke all on function public.attach_file(uuid,text,text,text,bigint,text) from public,techly_anon;
grant execute on function public.attach_file(uuid,text,text,text,bigint,text) to techly_user;

-- ---------------------------------------------------------------------------
-- Employee contract: record which documents the joining PDF contains.
-- ---------------------------------------------------------------------------
update private.module_contracts
 set definition=jsonb_set(definition,'{fields}',(definition->'fields')||'[{"key":"joining_documents","label":"Documents included in the joining PDF","type":"json","required":false}]'::jsonb)
 where module='employees' and not exists(select 1 from jsonb_array_elements(definition->'fields') f where f->>'key'='joining_documents');
update private.module_contracts
 set definition=jsonb_set(definition,'{fields}',(select jsonb_agg(case when f->>'key'='checklist' then f||'{"label":"Joining notes"}'::jsonb else f end order by ord) from jsonb_array_elements(definition->'fields') with ordinality t(f,ord)))
 where module='employees';

commit;
