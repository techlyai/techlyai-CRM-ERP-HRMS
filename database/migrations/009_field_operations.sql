-- Migration 009: field operations — field employee assignments, tracked field sessions,
-- visits, GPS photos with geofence verification, and field reports with review history.
--
-- Tracking is session based: points are accepted only for the employee's own active
-- session, inside its scheduled window. Coordinates and capture times come from the
-- employee's device and are stored as reported, never as proven facts. Team Leaders are
-- an assignment on each field employee, not a role; they see nothing unless they also
-- hold the matching field permission.
begin;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
create table public.field_policy (id integer primary key check(id=1), data jsonb not null check(jsonb_typeof(data)='object'));
insert into public.field_policy values(1,'{"retention_days":365,"time_skew_minutes":10,
 "notify":{"session_start":true,"photo":false,"photo_failed":true,"gps_unavailable":true,"report":true,"reply":true,"decision":true}}'::jsonb);

-- Customer or work sites a field employee is expected to visit.
create table public.field_sites (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 160),
 customer text not null default '' check(length(customer)<=200),
 address text not null default '' check(length(address)<=500),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 radius_m integer not null check(radius_m between 10 and 50000),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id),
 updated_by uuid references public.profiles(id)
);
create unique index field_sites_name_unique on public.field_sites(lower(trim(name)));

create table public.field_assignments (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 enabled boolean not null default true,
 team_leader_id uuid references public.profiles(id),
 reporting_admin_id uuid references public.profiles(id),
 schedule_days integer[] not null default '{1,2,3,4,5,6}' check(schedule_days <@ '{0,1,2,3,4,5,6}'::integer[] and cardinality(schedule_days)>0),
 schedule_start time not null default '08:00',
 schedule_end time not null default '20:00',
 interval_seconds integer not null default 300 check(interval_seconds between 60 and 3600),
 photo_upload boolean not null default true,
 -- When false, photos must be taken with the camera during an active session.
 gallery_allowed boolean not null default false,
 geofence_required boolean not null default true,
 default_radius_m integer not null default 150 check(default_radius_m between 10 and 50000),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),
 check(schedule_end>schedule_start),
 check(team_leader_id is distinct from user_id),
 check(reporting_admin_id is distinct from user_id)
);
create index field_assignments_tl_idx on public.field_assignments(team_leader_id);
create index field_assignments_admin_idx on public.field_assignments(reporting_admin_id);
create table public.field_assignment_sites (
 user_id uuid not null references public.field_assignments(user_id) on delete cascade,
 site_id uuid not null references public.field_sites(id),
 primary key(user_id,site_id)
);
-- Extra people allowed to see one employee's field records (they also need field.view).
create table public.field_viewers (
 user_id uuid not null references public.field_assignments(user_id) on delete cascade,
 viewer_id uuid not null references public.profiles(id) on delete cascade,
 primary key(user_id,viewer_id),
 check(user_id<>viewer_id)
);

-- ---------------------------------------------------------------------------
-- Activity
-- ---------------------------------------------------------------------------
create table public.field_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 attendance_id uuid references public.records(id),
 status text not null default 'active' check(status in ('active','ended')),
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 end_reason text check(end_reason in ('employee','checkout','schedule','admin')),
 -- Points are not accepted after this time.
 window_end timestamptz not null,
 interval_seconds integer not null,
 point_count integer not null default 0,
 distance_m double precision not null default 0,
 last_lat double precision, last_lng double precision, last_accuracy double precision, last_point_at timestamptz,
 check((status='active')=(ended_at is null))
);
create unique index field_sessions_one_active on public.field_sessions(user_id) where status='active';
create index field_sessions_user_started on public.field_sessions(user_id,started_at desc);

create table public.field_points (
 id bigint generated always as identity primary key,
 session_id uuid not null references public.field_sessions(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 -- Generated on the device; makes retried uploads idempotent.
 client_id uuid not null,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 accuracy_m double precision not null check(accuracy_m>=0),
 captured_at timestamptz not null,
 received_at timestamptz not null default now(),
 source text not null check(source in ('start','track','visit','photo','end')),
 unique(session_id,client_id)
);
create index field_points_session_time on public.field_points(session_id,captured_at);

create table public.field_reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id),
 session_id uuid references public.field_sessions(id),
 report_date date not null,
 title text not null check(length(trim(title)) between 1 and 200),
 work_completed text not null default '' check(length(work_completed)<=20000),
 customer text not null default '' check(length(customer)<=200),
 project_id uuid references public.records(id),
 issues text not null default '' check(length(issues)<=10000),
 next_steps text not null default '' check(length(next_steps)<=10000),
 eod_record_id uuid references public.records(id),
 status text not null default 'Draft' check(status in ('Draft','Submitted','Clarification Required','Resubmitted','Escalated','Approved','Rejected')),
 version integer not null default 1,
 submitted_at timestamptz,
 decided_by uuid references public.profiles(id),
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index field_reports_user_date on public.field_reports(user_id,report_date desc);

create table public.field_visits (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.field_sessions(id),
 user_id uuid not null references public.profiles(id),
 site_id uuid references public.field_sites(id),
 report_id uuid references public.field_reports(id) on delete set null,
 title text not null check(length(trim(title)) between 1 and 200),
 purpose text not null default '' check(length(purpose)<=1000),
 customer text not null default '' check(length(customer)<=200),
 project_id uuid references public.records(id),
 description text not null default '' check(length(description)<=5000),
 notes text not null default '' check(length(notes)<=2000),
 expected_label text, expected_lat double precision, expected_lng double precision, expected_radius_m integer,
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 start_lat double precision, start_lng double precision, start_accuracy double precision, start_distance_m double precision,
 start_status text not null check(start_status in ('verified','outside','gps_unavailable','inaccurate','manual_review')),
 end_lat double precision, end_lng double precision, end_accuracy double precision, end_distance_m double precision,
 end_status text check(end_status in ('verified','outside','gps_unavailable','inaccurate','manual_review'))
);
create index field_visits_session on public.field_visits(session_id,started_at);
create index field_visits_user on public.field_visits(user_id,started_at desc);

create table public.field_photos (
 id uuid primary key default gen_random_uuid(),
 client_key uuid not null unique,
 user_id uuid not null references public.profiles(id),
 session_id uuid not null references public.field_sessions(id),
 visit_id uuid references public.field_visits(id) on delete set null,
 report_id uuid references public.field_reports(id) on delete set null,
 source text not null check(source in ('camera','gallery')),
 -- Private storage reference; null until the upload completes.
 file_path text unique references private.stored_files(path),
 file_name text not null check(length(file_name) between 1 and 255),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
 size bigint not null check(size between 1 and 20971520),
 file_uploaded_at timestamptz,
 title text not null default '' check(length(title)<=200),
 purpose text not null default '' check(length(purpose)<=1000),
 customer text not null default '' check(length(customer)<=200),
 description text not null default '' check(length(description)<=5000),
 notes text not null default '' check(length(notes)<=2000),
 project_id uuid references public.records(id),
 -- Reported by the device.
 latitude double precision, longitude double precision, accuracy_m double precision, captured_at timestamptz,
 -- Server time the photo was registered.
 uploaded_at timestamptz not null default now(),
 expected_label text, expected_lat double precision, expected_lng double precision, expected_radius_m integer,
 distance_m double precision,
 verification text not null check(verification in ('verified','outside','pending','gps_unavailable','inaccurate','manual_review')),
 checks jsonb not null default '{}',
 review_status text not null default 'pending' check(review_status in ('pending','approved','rejected','clarification')),
 reviewer_id uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_notes text not null default '' check(length(review_notes)<=2000),
 location_purged_at timestamptz,
 check((latitude is null)=(longitude is null))
);
create index field_photos_user on public.field_photos(user_id,uploaded_at desc);
create index field_photos_session on public.field_photos(session_id);
create index field_photos_review on public.field_photos(review_status,verification);

create table public.field_report_files (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.field_reports(id) on delete cascade,
 path text not null unique references private.stored_files(path),
 name text not null, mime text not null, size bigint not null,
 uploaded_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index field_report_files_report on public.field_report_files(report_id);

-- Review history and question/answer threads for reports and photos.
create table public.field_events (
 id bigint generated always as identity primary key,
 report_id uuid references public.field_reports(id) on delete cascade,
 photo_id uuid references public.field_photos(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 action text not null,
 body text not null default '' check(length(body)<=5000),
 created_at timestamptz not null default now(),
 check(report_id is not null or photo_id is not null)
);
create index field_events_report on public.field_events(report_id,id);
create index field_events_photo on public.field_events(photo_id,id);

create table public.field_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id),
 action text not null,
 user_id uuid references public.profiles(id) on delete set null,
 site_id uuid references public.field_sites(id),
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index field_audit_created on public.field_audit(created_at desc);

-- Uploads can target a field photo or a field report.
alter table private.uploads add column if not exists field_target uuid;
alter table private.uploads drop constraint if exists uploads_kind_check;
alter table private.uploads add constraint uploads_kind_check check(kind in ('general','joining','field_photo','field_report'));

-- ---------------------------------------------------------------------------
-- Permissions (catalogue-backed; nothing granted by default)
-- ---------------------------------------------------------------------------
insert into public.permission_definitions(module,action,module_label,module_group,label,description,scoped,sensitive,sort) values
 ('field','view','Field operations & GPS tracking','People','View field sessions, routes, visits and GPS photos','Reaches people you are Team Leader, Reporting Admin or authorized viewer for, plus your scope (Team, Department, All).',true,true,3601),
 ('field','review','Field operations & GPS tracking','People','Review GPS photos and ask questions','Approve or reject photos, request clarification or more photos.',true,true,3602),
 ('field','approve','Field operations & GPS tracking','People','Approve, reject or escalate field reports','',true,false,3603),
 ('field','export','Field operations & GPS tracking','People','Export field records','',true,true,3604),
 ('field','manage','Field operations & GPS tracking','People','Configure field tracking, sites and policies','Turn tracking on or off per employee, assign Team Leaders, viewers, schedules and sites.',false,true,3605);

-- ---------------------------------------------------------------------------
-- Authorization
-- ---------------------------------------------------------------------------
create function private.field_related(viewer uuid,emp uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.field_assignments a where a.user_id=emp and (a.team_leader_id=viewer or a.reporting_admin_id=viewer))
  or exists(select 1 from public.field_viewers v where v.user_id=emp and v.viewer_id=viewer);
$$;
-- Own records: view only. Others: Super Admin, or the permission at any scope plus an
-- assignment relationship, or a Team/Department/All scope that reaches the person.
create function private.field_allowed(viewer uuid,emp uuid,act text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; s text;
begin
 select * into p from public.profiles where id=viewer;
 if p.id is null or not p.active or p.must_change_password or emp is null then return false; end if;
 if viewer=emp then return act='view'; end if;
 if p.role='super_admin' then return true; end if;
 s:=private.scope_for(viewer,'field',act);
 if s='none' then return false; end if;
 return private.field_related(viewer,emp) or (s in ('team','department','all') and private.permitted_for(viewer,'field',act,emp));
end $$;
create function private.field_can(emp uuid,act text) returns boolean language sql stable security definer set search_path='' as $$
 select private.field_allowed(private.current_user_id(),emp,act);
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.field_tz() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select data->>'timezone' from public.settings where id=1),'Asia/Kolkata');
$$;
create function private.field_valid_position(lat double precision,lng double precision,acc double precision) returns boolean language sql immutable set search_path='' as $$
 select (lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180 and acc is not null and acc>=0 and acc<1e6);
$$;
-- Geofence result for a reported position against an expected point.
create function private.field_check(lat double precision,lng double precision,acc double precision,elat double precision,elng double precision,radius integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare d double precision;
begin
 if lat is null then return jsonb_build_object('status','gps_unavailable'); end if;
 if elat is null then return jsonb_build_object('status','manual_review','reason','no_expected_location'); end if;
 d:=round(private.distance_m(lat,lng,elat,elng)::numeric,1);
 if acc is null or acc>radius then return jsonb_build_object('status','inaccurate','distance_m',d); end if;
 if d>radius then return jsonb_build_object('status','outside','distance_m',d); end if;
 return jsonb_build_object('status','verified','distance_m',d);
end $$;

-- In-app notifications to an employee's reviewers (Team Leader and/or Reporting Admin).
-- Bodies never contain coordinates; reviewers open Orbit to see location details.
create function private.field_notify(emp uuid,who text,kind text,title text,body text,link text,priority text,event text) returns void language plpgsql security definer set search_path='' as $$
declare a public.field_assignments; pol jsonb; r uuid; sent integer:=0;
begin
 select data->'notify' into pol from public.field_policy where id=1;
 if kind is not null and coalesce((pol->>kind)::boolean,true) is not true then return; end if;
 select * into a from public.field_assignments where user_id=emp;
 if who='owner' then
  perform private.notify(emp,'field',title,body,null,event,priority,link,'{}'::jsonb); return;
 end if;
 for r in select x from unnest(case who when 'tl' then array[a.team_leader_id] when 'admin' then array[a.reporting_admin_id] else array[a.team_leader_id,a.reporting_admin_id] end) x where x is not null loop
  if private.field_allowed(r,emp,'view') then
   perform private.notify(r,'field',title,body,null,event||':'||r,priority,link,'{}'::jsonb); sent:=sent+1;
  end if;
 end loop;
 -- Nobody assigned (or nobody permitted): tell the Super Admins so nothing is lost.
 if sent=0 and who<>'owner' then
  for r in select id from public.profiles where role='super_admin' and active loop
   perform private.notify(r,'field',title,body,null,event||':'||r,priority,link,'{}'::jsonb);
  end loop;
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- Configuration RPCs (field.manage; Super Admin by default)
-- ---------------------------------------------------------------------------
create function public.field_save_assignment(p_user uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); t public.profiles; old public.field_assignments; n public.field_assignments; tl public.profiles; adm public.profiles; v uuid; s uuid;
 old_sites uuid[]; old_viewers uuid[];
begin
 if not private.has_feature('field','manage') then raise exception 'Only a Super Admin or someone granted field tracking management can change field assignments';end if;
 select * into t from public.profiles where id=p_user;
 if t.id is null then raise exception 'User not found';end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid assignment';end if;
 if nullif(p_data->>'team_leader_id','') is not null then
  select * into tl from public.profiles where id=(p_data->>'team_leader_id')::uuid and active;
  if tl.id is null or tl.id=p_user then raise exception 'Choose an active Team Leader other than the employee';end if;
 end if;
 if nullif(p_data->>'reporting_admin_id','') is not null then
  select * into adm from public.profiles where id=(p_data->>'reporting_admin_id')::uuid and active;
  if adm.id is null or adm.id=p_user or adm.role not in ('manager','super_admin') then raise exception 'The Reporting Admin must be an active Admin or Super Admin';end if;
 end if;
 select * into old from public.field_assignments where user_id=p_user for update;
 select coalesce(array_agg(site_id order by site_id),'{}') into old_sites from public.field_assignment_sites where user_id=p_user;
 select coalesce(array_agg(viewer_id order by viewer_id),'{}') into old_viewers from public.field_viewers where user_id=p_user;
 insert into public.field_assignments as f(user_id,enabled,team_leader_id,reporting_admin_id,schedule_days,schedule_start,schedule_end,interval_seconds,photo_upload,gallery_allowed,geofence_required,default_radius_m,updated_at,updated_by)
 values(p_user,coalesce((p_data->>'enabled')::boolean,true),tl.id,adm.id,
  coalesce((select array_agg(x::integer order by x::integer) from jsonb_array_elements_text(p_data->'schedule_days') x),'{1,2,3,4,5,6}'),
  coalesce((p_data->>'schedule_start')::time,'08:00'),coalesce((p_data->>'schedule_end')::time,'20:00'),
  coalesce((p_data->>'interval_seconds')::integer,300),coalesce((p_data->>'photo_upload')::boolean,true),coalesce((p_data->>'gallery_allowed')::boolean,false),
  coalesce((p_data->>'geofence_required')::boolean,true),coalesce((p_data->>'default_radius_m')::integer,150),now(),uid)
 on conflict(user_id) do update set enabled=excluded.enabled,team_leader_id=excluded.team_leader_id,reporting_admin_id=excluded.reporting_admin_id,
  schedule_days=excluded.schedule_days,schedule_start=excluded.schedule_start,schedule_end=excluded.schedule_end,interval_seconds=excluded.interval_seconds,
  photo_upload=excluded.photo_upload,gallery_allowed=excluded.gallery_allowed,geofence_required=excluded.geofence_required,default_radius_m=excluded.default_radius_m,
  updated_at=now(),updated_by=uid
 returning * into n;
 if p_data ? 'site_ids' then
  delete from public.field_assignment_sites where user_id=p_user;
  for s in select x::uuid from jsonb_array_elements_text(p_data->'site_ids') x loop
   if not exists(select 1 from public.field_sites where id=s and active) then raise exception 'Choose active field sites';end if;
   insert into public.field_assignment_sites values(p_user,s) on conflict do nothing;
  end loop;
 end if;
 if p_data ? 'viewer_ids' then
  delete from public.field_viewers where user_id=p_user;
  for v in select x::uuid from jsonb_array_elements_text(p_data->'viewer_ids') x loop
   if v=p_user or not exists(select 1 from public.profiles where id=v and active) then raise exception 'Authorized viewers must be active people other than the employee';end if;
   insert into public.field_viewers values(p_user,v) on conflict do nothing;
  end loop;
 end if;
 -- Turning tracking off stops any running session immediately.
 if not n.enabled then
  update public.field_sessions set status='ended',ended_at=now(),end_reason='admin' where user_id=p_user and status='active';
 end if;
 insert into public.field_audit(actor_id,action,user_id,details) values(uid,
  case when old.user_id is null then 'Field tracking assigned' when old.enabled and not n.enabled then 'Field tracking disabled' when not old.enabled and n.enabled then 'Field tracking enabled' else 'Field assignment changed' end,
  p_user,jsonb_build_object('before',case when old.user_id is null then null else to_jsonb(old)-'updated_at'-'updated_by'-'user_id'||jsonb_build_object('site_ids',old_sites,'viewer_ids',old_viewers) end,
   'after',to_jsonb(n)-'updated_at'-'updated_by'-'user_id'||jsonb_build_object(
    'site_ids',(select coalesce(array_agg(site_id order by site_id),'{}') from public.field_assignment_sites where user_id=p_user),
    'viewer_ids',(select coalesce(array_agg(viewer_id order by viewer_id),'{}') from public.field_viewers where user_id=p_user))));
end $$;

create function public.field_save_site(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); old public.field_sites; n public.field_sites;
begin
 if not private.has_feature('field','manage') then raise exception 'Only a Super Admin or someone granted field tracking management can change field sites';end if;
 if jsonb_typeof(p_data)<>'object' or length(trim(coalesce(p_data->>'name','')))=0 then raise exception 'Give the site a name';end if;
 if jsonb_typeof(p_data->'latitude')<>'number' or (p_data->>'latitude')::float not between -90 and 90 then raise exception 'Latitude must be a number between -90 and 90';end if;
 if jsonb_typeof(p_data->'longitude')<>'number' or (p_data->>'longitude')::float not between -180 and 180 then raise exception 'Longitude must be a number between -180 and 180';end if;
 if jsonb_typeof(p_data->'radius_m')<>'number' or (p_data->>'radius_m')::numeric not between 10 and 50000 then raise exception 'Geofence radius must be between 10 and 50,000 metres';end if;
 if exists(select 1 from public.field_sites where lower(trim(name))=lower(trim(p_data->>'name')) and id is distinct from p_id) then raise exception 'A site with this name already exists';end if;
 if p_id is null then
  insert into public.field_sites(name,customer,address,latitude,longitude,radius_m,active,created_by,updated_by)
  values(trim(p_data->>'name'),trim(coalesce(p_data->>'customer','')),trim(coalesce(p_data->>'address','')),(p_data->>'latitude')::float,(p_data->>'longitude')::float,
   round((p_data->>'radius_m')::numeric)::integer,coalesce((p_data->>'active')::boolean,true),uid,uid) returning * into n;
 else
  select * into old from public.field_sites where id=p_id for update;
  if old.id is null then raise exception 'Site not found';end if;
  update public.field_sites set name=trim(p_data->>'name'),customer=trim(coalesce(p_data->>'customer','')),address=trim(coalesce(p_data->>'address','')),
   latitude=(p_data->>'latitude')::float,longitude=(p_data->>'longitude')::float,radius_m=round((p_data->>'radius_m')::numeric)::integer,
   active=coalesce((p_data->>'active')::boolean,true),updated_at=now(),updated_by=uid where id=p_id returning * into n;
 end if;
 insert into public.field_audit(actor_id,action,site_id,details) values(uid,case when old.id is null then 'Site created' else 'Site updated' end,n.id,
  jsonb_build_object('before',case when old.id is null then null else to_jsonb(old)-'created_at'-'updated_at'-'created_by'-'updated_by' end,'after',to_jsonb(n)-'created_at'-'updated_at'-'created_by'-'updated_by'));
 return n.id;
end $$;

create function public.field_save_policy(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare old jsonb;
begin
 if not private.has_feature('field','manage') then raise exception 'Only a Super Admin or someone granted field tracking management can change field policies';end if;
 if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'notify')<>'object'
  or (p_data->>'retention_days')::integer not between 30 and 3650 or (p_data->>'time_skew_minutes')::integer not between 1 and 1440 then raise exception 'Invalid field policy';end if;
 select data into old from public.field_policy where id=1 for update;
 update public.field_policy set data=jsonb_build_object('retention_days',(p_data->>'retention_days')::integer,'time_skew_minutes',(p_data->>'time_skew_minutes')::integer,
  'notify',(select coalesce(jsonb_object_agg(k,coalesce((p_data->'notify'->>k)::boolean,false)),'{}') from unnest(array['session_start','photo','photo_failed','gps_unavailable','report','reply','decision']) k)) where id=1;
 insert into public.field_audit(actor_id,action,details) values(private.current_user_id(),'Field policy updated',jsonb_build_object('before',old,'after',(select data from public.field_policy where id=1)));
end $$;

-- ---------------------------------------------------------------------------
-- Sessions and tracking (employee's own, server-enforced)
-- ---------------------------------------------------------------------------
create function private.field_add_point(s public.field_sessions,p_client uuid,lat double precision,lng double precision,acc double precision,p_at timestamptz,src text) returns boolean language plpgsql security definer set search_path='' as $$
declare new_id bigint; step double precision:=0;
begin
 if lat is null then return false; end if;
 insert into public.field_points(session_id,user_id,client_id,latitude,longitude,accuracy_m,captured_at,source)
 values(s.id,s.user_id,p_client,lat,lng,acc,p_at,src) on conflict(session_id,client_id) do nothing returning field_points.id into new_id;
 if new_id is null then return false; end if;
 -- Route length only grows with reasonably accurate, newer points.
 if s.last_lat is not null and acc<=100 and coalesce(s.last_accuracy,1e9)<=100 and p_at>=coalesce(s.last_point_at,p_at) then
  step:=private.distance_m(s.last_lat,s.last_lng,lat,lng);
 end if;
 update public.field_sessions set point_count=point_count+1,distance_m=distance_m+step,
  last_lat=case when p_at>=coalesce(last_point_at,p_at) then lat else last_lat end,last_lng=case when p_at>=coalesce(last_point_at,p_at) then lng else last_lng end,
  last_accuracy=case when p_at>=coalesce(last_point_at,p_at) then acc else last_accuracy end,last_point_at=greatest(coalesce(last_point_at,p_at),p_at)
 where id=s.id;
 return true;
end $$;

-- Ends sessions whose scheduled window has passed. Called lazily and by the scheduler.
create function public.field_close_expired() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.field_sessions set status='ended',ended_at=window_end,end_reason='schedule' where status='active' and window_end<=now();
 get diagnostics n=row_count; return n;
end $$;

create function public.field_start_session(p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_client uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); a public.field_assignments; tz text:=private.field_tz(); lnow timestamp; att public.records; s public.field_sessions; nm text;
begin
 select * into a from public.field_assignments where user_id=uid and enabled;
 if a.user_id is null then raise exception 'Field tracking is not enabled for your account';end if;
 if not private.field_valid_position(p_lat,p_lng,p_accuracy) then raise exception 'Invalid location';end if;
 perform public.field_close_expired();
 lnow:=now() at time zone tz;
 if not (extract(dow from lnow)::integer = any(a.schedule_days)) or lnow::time<a.schedule_start or lnow::time>=a.schedule_end then
  raise exception 'Field sessions can be started between % and % on your scheduled days',to_char(a.schedule_start,'HH24:MI'),to_char(a.schedule_end,'HH24:MI');
 end if;
 select * into att from public.records where module='attendance' and owner_id=uid and data->>'date'=lnow::date::text;
 if att.id is null or att.data->>'clock_in' is null then raise exception 'Check in for attendance before starting a field session';end if;
 if att.data->>'clock_out' is not null then raise exception 'You have already checked out today';end if;
 perform pg_advisory_xact_lock(hashtextextended('field:'||uid,0));
 if exists(select 1 from public.field_sessions where user_id=uid and status='active') then raise exception 'A field session is already running';end if;
 insert into public.field_sessions(user_id,attendance_id,window_end,interval_seconds)
 values(uid,att.id,(lnow::date+a.schedule_end) at time zone tz,a.interval_seconds) returning * into s;
 perform private.field_add_point(s,coalesce(p_client,gen_random_uuid()),p_lat,p_lng,p_accuracy,now(),'start');
 select full_name into nm from public.profiles where id=uid;
 perform private.field_notify(uid,'tl','session_start','Field session started · '||nm,nm||' started a field session.','/field/tracking?user='||uid,'Low','field-session:'||s.id);
 return s.id;
end $$;

-- Accepts a batch of tracked points. Points must fall inside the session window; points
-- captured while the session was running are still accepted after it ends (offline backlog),
-- but nothing captured after the end is stored.
create function public.field_record_points(p_session uuid,p_points jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); s public.field_sessions; p jsonb; cap timestamptz; acc double precision; lat double precision; lng double precision; cid uuid;
 accepted integer:=0; skipped integer:=0; last_at timestamptz;
begin
 perform public.field_close_expired();
 select * into s from public.field_sessions where id=p_session and user_id=uid for update;
 if s.id is null then raise exception 'Field session not found';end if;
 if jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)>200 then raise exception 'Send at most 200 points at a time';end if;
 for p in select * from jsonb_array_elements(p_points) loop
  begin
   cap:=(p->>'captured_at')::timestamptz; lat:=(p->>'lat')::float; lng:=(p->>'lng')::float; acc:=(p->>'accuracy')::float; cid:=(p->>'client_id')::uuid;
  exception when others then skipped:=skipped+1; continue;
  end;
  if cap is null or cid is null or lat is null or lng is null or not private.field_valid_position(lat,lng,acc)
   or cap<s.started_at-interval '1 minute' or cap>now()+interval '2 minutes' or cap>coalesce(s.ended_at,s.window_end)
   or coalesce(p->>'source','track') not in ('track','visit','photo') then skipped:=skipped+1; continue; end if;
  -- Throttle: tracked points closer together than a quarter of the interval add nothing.
  select max(captured_at) into last_at from public.field_points where session_id=s.id and source='track' and captured_at between cap-make_interval(secs=>s.interval_seconds/4.0) and cap+make_interval(secs=>s.interval_seconds/4.0) and client_id<>cid;
  if coalesce(p->>'source','track')='track' and last_at is not null then skipped:=skipped+1; continue; end if;
  if private.field_add_point(s,cid,lat,lng,acc,cap,coalesce(p->>'source','track')) then accepted:=accepted+1; else skipped:=skipped+1; end if;
  select * into s from public.field_sessions where id=s.id;
 end loop;
 return jsonb_build_object('accepted',accepted,'skipped',skipped,'active',s.status='active','window_end',s.window_end);
end $$;

create function public.field_end_session(p_session uuid,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_client uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); s public.field_sessions;
begin
 if not private.field_valid_position(p_lat,p_lng,p_accuracy) then raise exception 'Invalid location';end if;
 select * into s from public.field_sessions where id=p_session and user_id=uid for update;
 if s.id is null then raise exception 'Field session not found';end if;
 if s.status<>'active' then raise exception 'This field session has already ended';end if;
 perform private.field_add_point(s,coalesce(p_client,gen_random_uuid()),p_lat,p_lng,p_accuracy,now(),'end');
 update public.field_visits set ended_at=now(),end_status='manual_review' where session_id=s.id and ended_at is null;
 update public.field_sessions set status='ended',ended_at=now(),end_reason='employee' where id=s.id;
end $$;

-- Attendance check-out ends any running field session.
create function private.field_end_on_checkout() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Only today's check-out; a correction to an earlier day must not end today's session.
 if new.module='attendance' and old.data->>'clock_out' is null and new.data->>'clock_out' is not null
  and new.data->>'date'=(now() at time zone private.field_tz())::date::text then
  update public.field_visits set ended_at=now(),end_status='manual_review' where user_id=new.owner_id and ended_at is null and session_id in (select id from public.field_sessions where user_id=new.owner_id and status='active');
  update public.field_sessions set status='ended',ended_at=now(),end_reason='checkout' where user_id=new.owner_id and status='active';
 end if;
 return new;
end $$;
create trigger attendance_ends_field_session after update on public.records for each row when (new.module='attendance') execute function private.field_end_on_checkout();

-- ---------------------------------------------------------------------------
-- Visits and photos
-- ---------------------------------------------------------------------------
-- The expected location for a visit or photo: an explicit site the employee may use.
create function private.field_site_for(uid uuid,p_site uuid) returns public.field_sites language plpgsql stable security definer set search_path='' as $$
declare s public.field_sites;
begin
 if p_site is null then return null; end if;
 select f.* into s from public.field_sites f where f.id=p_site and f.active
  and (exists(select 1 from public.field_assignment_sites x where x.user_id=uid and x.site_id=f.id) or not exists(select 1 from public.field_assignment_sites x where x.user_id=uid));
 if s.id is null then raise exception 'Choose one of your assigned field sites';end if;
 return s;
end $$;

create function public.field_start_visit(p_session uuid,p_data jsonb,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_client uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); s public.field_sessions; site public.field_sites; chk jsonb; v uuid; a public.field_assignments; elat double precision; elng double precision; rad integer; lbl text;
begin
 if not private.field_valid_position(p_lat,p_lng,p_accuracy) then raise exception 'Invalid location';end if;
 perform public.field_close_expired();
 select * into s from public.field_sessions where id=p_session and user_id=uid and status='active' for update;
 if s.id is null then raise exception 'Start a field session before recording a visit';end if;
 if exists(select 1 from public.field_visits where session_id=s.id and ended_at is null) then raise exception 'End your current visit before starting another';end if;
 if jsonb_typeof(p_data)<>'object' or length(trim(coalesce(p_data->>'title','')))=0 then raise exception 'Give the visit a title';end if;
 select * into a from public.field_assignments where user_id=uid;
 site:=private.field_site_for(uid,nullif(p_data->>'site_id','')::uuid);
 if site.id is not null then elat:=site.latitude; elng:=site.longitude; rad:=site.radius_m; lbl:=site.name; end if;
 if nullif(p_data->>'project_id','') is not null and not exists(select 1 from public.records where id=(p_data->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Project not found';end if;
 chk:=private.field_check(p_lat,p_lng,p_accuracy,elat,elng,coalesce(rad,a.default_radius_m));
 insert into public.field_visits(session_id,user_id,site_id,title,purpose,customer,project_id,description,notes,expected_label,expected_lat,expected_lng,expected_radius_m,
  start_lat,start_lng,start_accuracy,start_distance_m,start_status)
 values(s.id,uid,site.id,trim(p_data->>'title'),coalesce(p_data->>'purpose',''),coalesce(nullif(p_data->>'customer',''),site.customer,''),nullif(p_data->>'project_id','')::uuid,
  coalesce(p_data->>'description',''),coalesce(p_data->>'notes',''),lbl,elat,elng,rad,p_lat,p_lng,p_accuracy,(chk->>'distance_m')::float,chk->>'status') returning id into v;
 perform private.field_add_point(s,coalesce(p_client,gen_random_uuid()),p_lat,p_lng,p_accuracy,now(),'visit');
 return v;
end $$;

create function public.field_end_visit(p_visit uuid,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_client uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); v public.field_visits; s public.field_sessions; chk jsonb; a public.field_assignments;
begin
 if not private.field_valid_position(p_lat,p_lng,p_accuracy) then raise exception 'Invalid location';end if;
 select * into v from public.field_visits where id=p_visit and user_id=uid for update;
 if v.id is null then raise exception 'Visit not found';end if;
 if v.ended_at is not null then raise exception 'This visit has already ended';end if;
 select * into a from public.field_assignments where user_id=uid;
 chk:=private.field_check(p_lat,p_lng,p_accuracy,v.expected_lat,v.expected_lng,coalesce(v.expected_radius_m,a.default_radius_m));
 update public.field_visits set ended_at=now(),end_lat=p_lat,end_lng=p_lng,end_accuracy=p_accuracy,end_distance_m=(chk->>'distance_m')::float,end_status=chk->>'status' where id=v.id;
 select * into s from public.field_sessions where id=v.session_id and status='active';
 if s.id is not null then perform private.field_add_point(s,coalesce(p_client,gen_random_uuid()),p_lat,p_lng,p_accuracy,now(),'visit'); end if;
end $$;

-- Registers a photo and its reported location; the file itself is uploaded next.
-- Retrying with the same client_key returns the existing photo.
create function public.field_create_photo(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); a public.field_assignments; s public.field_sessions; v public.field_visits; site public.field_sites; ph public.field_photos;
 lat double precision; lng double precision; acc double precision; cap timestamptz; chk jsonb; checks jsonb:='{}'; st text; src text;
 elat double precision; elng double precision; rad integer; lbl text; skew integer; nm text;
begin
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid photo';end if;
 select * into ph from public.field_photos where client_key=(p_data->>'client_key')::uuid;
 if ph.id is not null then
  if ph.user_id<>uid then raise exception 'Invalid photo';end if;
  return to_jsonb(ph);
 end if;
 select * into a from public.field_assignments where user_id=uid and enabled;
 if a.user_id is null or not a.photo_upload then raise exception 'GPS photo upload is not enabled for your account';end if;
 src:=p_data->>'source';
 if src not in ('camera','gallery') then raise exception 'Invalid photo source';end if;
 if src='gallery' and not a.gallery_allowed then raise exception 'Your field policy requires taking photos with the camera during an active session';end if;
 perform public.field_close_expired();
 select * into s from public.field_sessions where id=(p_data->>'session_id')::uuid and user_id=uid and status='active';
 if s.id is null then raise exception 'Start a field session before adding photos';end if;
 if nullif(p_data->>'visit_id','') is not null then
  select * into v from public.field_visits where id=(p_data->>'visit_id')::uuid and session_id=s.id;
  if v.id is null then raise exception 'Visit not found in this session';end if;
 end if;
 if (p_data->>'mime') not in ('image/jpeg','image/png','image/webp') or (p_data->>'size')::bigint not between 1 and 20971520 then raise exception 'Use a JPG, PNG or WebP photo up to 20 MB';end if;
 lat:=(p_data->>'lat')::float; lng:=(p_data->>'lng')::float; acc:=(p_data->>'accuracy')::float;
 if not private.field_valid_position(lat,lng,case when lat is null then null else acc end) then raise exception 'Invalid location';end if;
 cap:=nullif(p_data->>'captured_at','')::timestamptz;
 -- Expected location: the visit's site, else an explicitly chosen site, else the nearest assigned site.
 if v.expected_lat is not null then elat:=v.expected_lat; elng:=v.expected_lng; rad:=v.expected_radius_m; lbl:=v.expected_label;
 else
  site:=private.field_site_for(uid,nullif(p_data->>'site_id','')::uuid);
  if site.id is null and lat is not null then
   select f.* into site from public.field_sites f join public.field_assignment_sites x on x.site_id=f.id and x.user_id=uid where f.active order by private.distance_m(lat,lng,f.latitude,f.longitude) limit 1;
  end if;
  if site.id is not null then elat:=site.latitude; elng:=site.longitude; rad:=site.radius_m; lbl:=site.name; end if;
 end if;
 chk:=private.field_check(lat,lng,acc,elat,elng,coalesce(rad,a.default_radius_m));
 st:=chk->>'status';
 if chk ? 'reason' then checks:=checks||jsonb_build_object('no_expected_location',true); end if;
 -- A gallery image inside the geofence still proves nothing about where it was taken.
 if src='gallery' then checks:=checks||'{"gallery_image":true}'; if st='verified' then st:='manual_review'; end if; end if;
 select coalesce((data->>'time_skew_minutes')::integer,10) into skew from public.field_policy where id=1;
 if cap is null or abs(extract(epoch from now()-cap))>skew*60 then
  checks:=checks||jsonb_build_object('time_skew_seconds',case when cap is null then null else round(extract(epoch from now()-cap)) end);
  if st='verified' then st:='manual_review'; end if;
 end if;
 if nullif(p_data->>'project_id','') is not null and not exists(select 1 from public.records where id=(p_data->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Project not found';end if;
 insert into public.field_photos(client_key,user_id,session_id,visit_id,source,file_name,mime,size,title,purpose,customer,description,notes,project_id,
  latitude,longitude,accuracy_m,captured_at,expected_label,expected_lat,expected_lng,expected_radius_m,distance_m,verification,checks)
 values((p_data->>'client_key')::uuid,uid,s.id,v.id,src,left(coalesce(p_data->>'file_name','photo.jpg'),255),p_data->>'mime',(p_data->>'size')::bigint,
  left(coalesce(p_data->>'title',''),200),left(coalesce(p_data->>'purpose',''),1000),left(coalesce(p_data->>'customer',v.customer,''),200),left(coalesce(p_data->>'description',''),5000),left(coalesce(p_data->>'notes',''),2000),
  nullif(p_data->>'project_id','')::uuid,lat,lng,case when lat is null then null else acc end,cap,lbl,elat,elng,case when elat is null then null else coalesce(rad,a.default_radius_m) end,(chk->>'distance_m')::float,st,checks)
 returning * into ph;
 if src='camera' and lat is not null then perform private.field_add_point(s,ph.client_key,lat,lng,acc,coalesce(least(greatest(cap,s.started_at),now()),now()),'photo'); end if;
 select full_name into nm from public.profiles where id=uid;
 perform private.field_notify(uid,'both','photo','New GPS photo · '||nm,nm||' added a field photo'||coalesce(' at '||lbl,'')||'.','/field/photos?photo='||ph.id,'Low','field-photo:'||ph.id);
 if st in ('outside','inaccurate') then
  perform private.field_notify(uid,'both','photo_failed','GPS photo needs review · '||nm,'A field photo from '||nm||' did not match the expected location'||coalesce(' ('||lbl||')','')||'. Open Orbit to review it.','/field/review?photo='||ph.id,'High','field-photo-failed:'||ph.id);
 elsif st='gps_unavailable' then
  perform private.field_notify(uid,'both','gps_unavailable','GPS unavailable on a field photo · '||nm,'A field photo from '||nm||' has no location. Open Orbit to review it.','/field/review?photo='||ph.id,'High','field-photo-gps:'||ph.id);
 end if;
 return to_jsonb(ph);
end $$;

-- Upload authorization and linking, used by the storage layer.
create function public.field_upload_allowed(p_kind text,p_target uuid,p_mime text,p_size bigint) returns boolean language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=private.current_user_id();
begin
 if p_kind='field_photo' then
  return exists(select 1 from public.field_photos where id=p_target and user_id=uid and file_path is null and mime=p_mime and size=p_size);
 elsif p_kind='field_report' then
  return exists(select 1 from public.field_reports where id=p_target and user_id=uid and status in ('Draft','Clarification Required','Rejected'));
 end if;
 return false;
end $$;
create function public.field_attach_upload(p_kind text,p_target uuid,p_path text,p_name text,p_mime text,p_size bigint) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id();
begin
 if not public.field_upload_allowed(p_kind,p_target,p_mime,p_size) then raise exception 'Upload target unavailable';end if;
 if not exists(select 1 from private.stored_files where path=p_path and uploaded_by=uid) then raise exception 'File unavailable';end if;
 if p_kind='field_photo' then
  update public.field_photos set file_path=p_path,file_uploaded_at=now() where id=p_target;
 else
  insert into public.field_report_files(report_id,path,name,mime,size,uploaded_by) values(p_target,p_path,p_name,p_mime,p_size,uid);
  insert into public.field_events(report_id,actor_id,action,body) values(p_target,uid,'attachment',p_name);
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- Photo review
-- ---------------------------------------------------------------------------
create function public.field_review_photo(p_id uuid,p_action text,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); ph public.field_photos; st text; nm text;
begin
 select * into ph from public.field_photos where id=p_id for update;
 if ph.id is null or not private.field_can(ph.user_id,'review') then raise exception 'You do not have permission to review this photo';end if;
 if p_action not in ('approve','reject','clarify') then raise exception 'Invalid review action';end if;
 if p_action in ('reject','clarify') and length(trim(coalesce(p_note,'')))=0 then raise exception 'Give a reason or question';end if;
 st:=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'clarification' end;
 update public.field_photos set review_status=st,reviewer_id=uid,reviewed_at=now(),review_notes=left(coalesce(p_note,''),2000) where id=p_id;
 insert into public.field_events(photo_id,actor_id,action,body) values(p_id,uid,'photo_'||p_action,coalesce(p_note,''));
 select full_name into nm from public.profiles where id=uid;
 perform private.field_notify(ph.user_id,'owner','decision',case p_action when 'approve' then 'Field photo approved' when 'reject' then 'Field photo rejected' else 'Question about your field photo' end,
  coalesce(nm,'A reviewer')||case p_action when 'clarify' then ' asked: '||left(p_note,300) when 'reject' then ' rejected a photo: '||left(p_note,300) else ' approved your photo.' end,'/field/photos?photo='||p_id,
  case when p_action='approve' then 'Low' else 'High' end,'field-photo-review:'||p_id||':'||(select count(*) from public.field_events where photo_id=p_id));
end $$;
create function public.field_reply_photo(p_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); ph public.field_photos; nm text;
begin
 select * into ph from public.field_photos where id=p_id for update;
 if ph.id is null or ph.user_id<>uid then raise exception 'Photo not found';end if;
 if length(trim(coalesce(p_body,'')))=0 then raise exception 'Write a reply';end if;
 insert into public.field_events(photo_id,actor_id,action,body) values(p_id,uid,'reply',left(p_body,5000));
 if ph.review_status='clarification' then update public.field_photos set review_status='pending' where id=p_id; end if;
 select full_name into nm from public.profiles where id=uid;
 perform private.field_notify(uid,'both','reply','Reply about a field photo · '||nm,nm||' replied to a question about a field photo.','/field/photos?photo='||p_id,'Medium','field-photo-reply:'||p_id||':'||(select count(*) from public.field_events where photo_id=p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Field reports
-- ---------------------------------------------------------------------------
create function public.field_save_report(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); r public.field_reports; x uuid;
begin
 if not exists(select 1 from public.field_assignments where user_id=uid) then raise exception 'Field reports are available to field employees';end if;
 if jsonb_typeof(p_data)<>'object' or length(trim(coalesce(p_data->>'title','')))=0 then raise exception 'Give the report a title';end if;
 if nullif(p_data->>'session_id','') is not null and not exists(select 1 from public.field_sessions where id=(p_data->>'session_id')::uuid and user_id=uid) then raise exception 'Field session not found';end if;
 if nullif(p_data->>'eod_record_id','') is not null and not exists(select 1 from public.records where id=(p_data->>'eod_record_id')::uuid and module='eod' and owner_id=uid) then raise exception 'Daily report not found';end if;
 if nullif(p_data->>'project_id','') is not null and not exists(select 1 from public.records where id=(p_data->>'project_id')::uuid and module='projects' and private.visible(id)) then raise exception 'Project not found';end if;
 if p_id is null then
  insert into public.field_reports(user_id,session_id,report_date,title,work_completed,customer,project_id,issues,next_steps,eod_record_id)
  values(uid,nullif(p_data->>'session_id','')::uuid,coalesce((p_data->>'report_date')::date,(now() at time zone private.field_tz())::date),trim(p_data->>'title'),
   coalesce(p_data->>'work_completed',''),coalesce(p_data->>'customer',''),nullif(p_data->>'project_id','')::uuid,coalesce(p_data->>'issues',''),coalesce(p_data->>'next_steps',''),nullif(p_data->>'eod_record_id','')::uuid)
  returning * into r;
  insert into public.field_events(report_id,actor_id,action) values(r.id,uid,'created');
 else
  select * into r from public.field_reports where id=p_id and user_id=uid for update;
  if r.id is null then raise exception 'Report not found';end if;
  if r.status not in ('Draft','Clarification Required','Rejected') then raise exception 'Submitted reports cannot be edited while under review';end if;
  if (p_data->>'version')::integer is distinct from r.version then raise exception 'This report changed in another window. Reload and try again.';end if;
  update public.field_reports set session_id=nullif(p_data->>'session_id','')::uuid,report_date=coalesce((p_data->>'report_date')::date,report_date),title=trim(p_data->>'title'),
   work_completed=coalesce(p_data->>'work_completed',''),customer=coalesce(p_data->>'customer',''),project_id=nullif(p_data->>'project_id','')::uuid,
   issues=coalesce(p_data->>'issues',''),next_steps=coalesce(p_data->>'next_steps',''),eod_record_id=nullif(p_data->>'eod_record_id','')::uuid,
   version=version+1,updated_at=now() where id=r.id returning * into r;
 end if;
 -- Linked photos and visits (own only).
 if p_data ? 'photo_ids' then
  update public.field_photos set report_id=null where report_id=r.id and not (id::text in (select jsonb_array_elements_text(p_data->'photo_ids')));
  for x in select v::uuid from jsonb_array_elements_text(p_data->'photo_ids') v loop
   update public.field_photos set report_id=r.id where id=x and user_id=uid;
   if not found then raise exception 'Photo not found';end if;
  end loop;
 end if;
 if p_data ? 'visit_ids' then
  update public.field_visits set report_id=null where report_id=r.id and not (id::text in (select jsonb_array_elements_text(p_data->'visit_ids')));
  for x in select v::uuid from jsonb_array_elements_text(p_data->'visit_ids') v loop
   update public.field_visits set report_id=r.id where id=x and user_id=uid;
   if not found then raise exception 'Visit not found';end if;
  end loop;
 end if;
 return r.id;
end $$;

create function public.field_report_action(p_id uuid,p_action text,p_version integer,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); r public.field_reports; nxt text; nm text; owner_name text; link text;
begin
 select * into r from public.field_reports where id=p_id for update;
 if r.id is null or not private.field_can(r.user_id,'view') then raise exception 'Report not found';end if;
 if r.version is distinct from p_version then raise exception 'This report changed in another window. Reload and try again.';end if;
 select full_name into nm from public.profiles where id=uid;
 select full_name into owner_name from public.profiles where id=r.user_id;
 link:='/field/reports/'||r.id;
 if p_action='submit' then
  if r.user_id<>uid or r.status not in ('Draft','Clarification Required','Rejected') then raise exception 'This report cannot be submitted now';end if;
  nxt:=case when r.status='Draft' then 'Submitted' else 'Resubmitted' end;
 elsif p_action='reply' then
  if r.user_id<>uid then raise exception 'Only the employee can reply';end if;
  if length(trim(coalesce(p_note,'')))=0 then raise exception 'Write a reply';end if;
  nxt:=case when r.status='Clarification Required' then 'Resubmitted' else r.status end;
 elsif p_action='question' then
  if r.user_id=uid or not private.field_can(r.user_id,'review') then raise exception 'You do not have permission to question this report';end if;
  if r.status not in ('Submitted','Resubmitted','Escalated') then raise exception 'Only reports under review can be questioned';end if;
  if length(trim(coalesce(p_note,'')))=0 then raise exception 'Write your question';end if;
  nxt:='Clarification Required';
 elsif p_action='escalate' then
  if r.user_id=uid or not (private.field_can(r.user_id,'review') or private.field_can(r.user_id,'approve')) then raise exception 'You do not have permission to escalate this report';end if;
  if r.status not in ('Submitted','Resubmitted') then raise exception 'Only reports under review can be escalated';end if;
  nxt:='Escalated';
 elsif p_action in ('approve','reject') then
  if r.user_id=uid or not private.field_can(r.user_id,'approve') then raise exception 'An independent authorized reviewer is required';end if;
  if r.status not in ('Submitted','Resubmitted','Escalated') then raise exception 'This report is not awaiting a decision';end if;
  if p_action='reject' and length(trim(coalesce(p_note,'')))=0 then raise exception 'Give a reason for rejecting';end if;
  nxt:=case p_action when 'approve' then 'Approved' else 'Rejected' end;
 else raise exception 'Invalid report action';
 end if;
 update public.field_reports set status=nxt,version=version+1,updated_at=now(),
  submitted_at=case when p_action='submit' then now() else submitted_at end,
  decided_by=case when p_action in ('approve','reject') then uid else decided_by end,decided_at=case when p_action in ('approve','reject') then now() else decided_at end
 where id=r.id;
 insert into public.field_events(report_id,actor_id,action,body) values(r.id,uid,p_action,left(coalesce(p_note,''),5000));
 if p_action='submit' then
  perform private.field_notify(r.user_id,'tl','report','Field report submitted · '||owner_name,owner_name||' submitted "'||r.title||'" for '||r.report_date||'.',link,'High','field-report:'||r.id||':'||(r.version+1));
 elsif p_action='reply' then
  perform private.field_notify(r.user_id,'both','reply','Reply on a field report · '||owner_name,owner_name||' replied on "'||r.title||'".',link,'Medium','field-report-reply:'||r.id||':'||(r.version+1));
 elsif p_action='escalate' then
  perform private.field_notify(r.user_id,'admin','report','Field report escalated · '||owner_name,coalesce(nm,'A Team Leader')||' escalated "'||r.title||'" for your review.',link,'High','field-report-escalate:'||r.id||':'||(r.version+1));
 else
  perform private.field_notify(r.user_id,'owner','decision',case p_action when 'question' then 'Question on your field report' when 'approve' then 'Field report approved' else 'Field report rejected' end,
   coalesce(nm,'A reviewer')||case p_action when 'question' then ' asked: '||left(p_note,300) when 'approve' then ' approved "'||r.title||'".' else ' rejected "'||r.title||'": '||left(p_note,300) end,
   link,case when p_action='approve' then 'Medium' else 'High' end,'field-report-decision:'||r.id||':'||(r.version+1));
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------
-- One row per field employee the viewer may see, for one day. The last position is only
-- marked live while a session is running.
create function public.field_overview(p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); tz text:=private.field_tz();
begin
 if uid is null then raise exception 'Permission denied';end if;
 return coalesce((select jsonb_agg(v order by v->>'name') from (
  select jsonb_build_object(
   'user_id',p.id,'name',p.full_name,'employee_id',p.employee_id,'department',p.department,'enabled',a.enabled,
   'team_leader',(select jsonb_build_object('id',t.id,'name',t.full_name) from public.profiles t where t.id=a.team_leader_id),
   'reporting_admin',(select jsonb_build_object('id',t.id,'name',t.full_name) from public.profiles t where t.id=a.reporting_admin_id),
   'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,'end_reason',s.end_reason,
      'point_count',s.point_count,'distance_m',round(s.distance_m::numeric),'last_lat',s.last_lat,'last_lng',s.last_lng,'last_accuracy',s.last_accuracy,'last_point_at',s.last_point_at) order by s.started_at),'[]')
     from public.field_sessions s where s.user_id=p.id and (s.started_at at time zone tz)::date=p_date),
   'visits',(select count(*) from public.field_visits x where x.user_id=p.id and (x.started_at at time zone tz)::date=p_date),
   'photos',(select count(*) from public.field_photos x where x.user_id=p.id and (x.uploaded_at at time zone tz)::date=p_date),
   'failures',(select count(*) from public.field_photos x where x.user_id=p.id and (x.uploaded_at at time zone tz)::date=p_date and x.verification in ('outside','inaccurate','gps_unavailable')),
   'pending_photos',(select count(*) from public.field_photos x where x.user_id=p.id and x.review_status in ('pending','clarification') and x.verification<>'verified'),
   'pending_reports',(select count(*) from public.field_reports x where x.user_id=p.id and x.status in ('Submitted','Resubmitted','Escalated'))
  ) v
  from public.field_assignments a join public.profiles p on p.id=a.user_id
  where p.active and private.field_allowed(uid,p.id,'view')) t),'[]'::jsonb);
end $$;

-- Retention: tracked points are deleted and exact photo/visit coordinates cleared after the
-- configured number of days. Distances, verification results and files remain.
create function public.field_purge() returns integer language plpgsql security definer set search_path='' as $$
declare days integer; n integer; cutoff timestamptz;
begin
 select coalesce((data->>'retention_days')::integer,365) into days from public.field_policy where id=1;
 cutoff:=now()-make_interval(days=>days);
 delete from public.field_points where captured_at<cutoff;
 get diagnostics n=row_count;
 update public.field_photos set latitude=null,longitude=null,location_purged_at=now() where uploaded_at<cutoff and latitude is not null;
 update public.field_visits set start_lat=null,start_lng=null,end_lat=null,end_lng=null where started_at<cutoff and (start_lat is not null or end_lat is not null);
 update public.field_sessions set last_lat=null,last_lng=null where started_at<cutoff and last_lat is not null;
 return n;
end $$;

-- ---------------------------------------------------------------------------
-- Access policies
-- ---------------------------------------------------------------------------
alter table public.field_policy enable row level security;
alter table public.field_sites enable row level security;
alter table public.field_assignments enable row level security;
alter table public.field_assignment_sites enable row level security;
alter table public.field_viewers enable row level security;
alter table public.field_sessions enable row level security;
alter table public.field_points enable row level security;
alter table public.field_reports enable row level security;
alter table public.field_visits enable row level security;
alter table public.field_photos enable row level security;
alter table public.field_report_files enable row level security;
alter table public.field_events enable row level security;
alter table public.field_audit enable row level security;
create policy field_policy_read on public.field_policy for select to techly_user using(true);
create policy field_sites_read on public.field_sites for select to techly_user using(
 private.has_feature('field','manage') or private.has_feature('field','view')
 or exists(select 1 from public.field_assignments a where a.user_id=private.current_user_id()));
create policy field_assignments_read on public.field_assignments for select to techly_user using(private.has_feature('field','manage') or private.field_can(user_id,'view'));
create policy field_assignment_sites_read on public.field_assignment_sites for select to techly_user using(private.has_feature('field','manage') or private.field_can(user_id,'view'));
create policy field_viewers_read on public.field_viewers for select to techly_user using(private.has_feature('field','manage') or private.field_can(user_id,'view'));
create policy field_sessions_read on public.field_sessions for select to techly_user using(private.field_can(user_id,'view'));
create policy field_points_read on public.field_points for select to techly_user using(private.field_can(user_id,'view'));
create policy field_reports_read on public.field_reports for select to techly_user using(private.field_can(user_id,'view'));
create policy field_visits_read on public.field_visits for select to techly_user using(private.field_can(user_id,'view'));
create policy field_photos_read on public.field_photos for select to techly_user using(private.field_can(user_id,'view'));
create policy field_report_files_read on public.field_report_files for select to techly_user using(exists(select 1 from public.field_reports r where r.id=report_id and private.field_can(r.user_id,'view')));
create policy field_events_read on public.field_events for select to techly_user using(
 exists(select 1 from public.field_reports r where r.id=report_id and private.field_can(r.user_id,'view'))
 or exists(select 1 from public.field_photos f where f.id=photo_id and private.field_can(f.user_id,'view')));
create policy field_audit_read on public.field_audit for select to techly_user using(private.has_feature('field','manage') or private.has_feature('audit','view'));
-- Directory details (name, employee ID, department) for field pages. Team Leaders may be
-- Employees who cannot read other profiles; this exposes nothing beyond these columns.
create view public.field_people with (security_barrier) as
 select p.id,p.full_name,p.employee_id,p.department,p.role,p.active from public.profiles p
 where private.has_feature('field','view') or private.has_feature('field','manage')
  or exists(select 1 from public.field_assignments a where a.user_id=private.current_user_id());
grant select on public.field_people to techly_user;
grant select on public.field_policy,public.field_sites,public.field_assignments,public.field_assignment_sites,public.field_viewers,public.field_sessions,public.field_points,
 public.field_reports,public.field_visits,public.field_photos,public.field_report_files,public.field_events,public.field_audit to techly_user;
grant select,insert,update,delete on public.field_policy,public.field_sites,public.field_assignments,public.field_assignment_sites,public.field_viewers,public.field_sessions,public.field_points,
 public.field_reports,public.field_visits,public.field_photos,public.field_report_files,public.field_events,public.field_audit to techly_service;

revoke all on function private.field_related(uuid,uuid),private.field_allowed(uuid,uuid,text),private.field_tz(),private.field_valid_position(double precision,double precision,double precision),
 private.field_check(double precision,double precision,double precision,double precision,double precision,integer),private.field_notify(uuid,text,text,text,text,text,text,text),
 private.field_add_point(public.field_sessions,uuid,double precision,double precision,double precision,timestamptz,text),private.field_end_on_checkout(),private.field_site_for(uuid,uuid),
 public.field_save_assignment(uuid,jsonb),public.field_save_site(uuid,jsonb),public.field_save_policy(jsonb),public.field_close_expired(),
 public.field_start_session(double precision,double precision,double precision,uuid),public.field_record_points(uuid,jsonb),
 public.field_end_session(uuid,double precision,double precision,double precision,uuid),
 public.field_start_visit(uuid,jsonb,double precision,double precision,double precision,uuid),public.field_end_visit(uuid,double precision,double precision,double precision,uuid),
 public.field_create_photo(jsonb),public.field_upload_allowed(text,uuid,text,bigint),public.field_attach_upload(text,uuid,text,text,text,bigint),
 public.field_review_photo(uuid,text,text),public.field_reply_photo(uuid,text),public.field_save_report(uuid,jsonb),public.field_report_action(uuid,text,integer,text),
 public.field_overview(date),public.field_purge()
 from public,techly_anon,techly_user,techly_service;
-- Used inside row level security policies.
grant execute on function private.field_can(uuid,text) to techly_user;
grant execute on function public.field_save_assignment(uuid,jsonb),public.field_save_site(uuid,jsonb),public.field_save_policy(jsonb),
 public.field_start_session(double precision,double precision,double precision,uuid),public.field_record_points(uuid,jsonb),
 public.field_end_session(uuid,double precision,double precision,double precision,uuid),
 public.field_start_visit(uuid,jsonb,double precision,double precision,double precision,uuid),public.field_end_visit(uuid,double precision,double precision,double precision,uuid),
 public.field_create_photo(jsonb),public.field_upload_allowed(text,uuid,text,bigint),public.field_attach_upload(text,uuid,text,text,text,bigint),
 public.field_review_photo(uuid,text,text),public.field_reply_photo(uuid,text),public.field_save_report(uuid,jsonb),public.field_report_action(uuid,text,integer,text),
 public.field_overview(date) to techly_user;
grant execute on function public.field_close_expired(),public.field_purge() to techly_service;
commit;
