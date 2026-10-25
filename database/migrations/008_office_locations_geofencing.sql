-- Migration 008: office locations, per-person geofence assignments and GPS check-in/check-out.
--
-- Attendance stays in public.records (module 'attendance'), one row per person per day.
-- The server validates every check-in and check-out against the person's assigned office
-- using the stored coordinates and radius; browser-side checks are only for display.
-- Device GPS can be spoofed, so "verified" means "the device reported a position inside the
-- geofence", not proof of physical presence.
begin;

create table public.office_locations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 address text not null default '' check(length(address)<=500),
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 radius_m integer not null check(radius_m between 10 and 50000),
 -- When true, check-in is refused unless the reported position is verified inside the geofence.
 require_inside boolean not null default true,
 -- The office used for people without an explicit assignment.
 is_default boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id),
 updated_by uuid references public.profiles(id),
 check(active or not is_default)
);
create unique index office_locations_name_unique on public.office_locations(lower(trim(name)));
create unique index office_locations_single_default on public.office_locations(is_default) where is_default;

create table public.attendance_assignments (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 location_id uuid not null references public.office_locations(id),
 -- Optional per-person radius; null uses the office radius.
 radius_override_m integer check(radius_override_m between 10 and 50000),
 -- Allows "Work from home" check-ins outside the geofence for this person.
 allow_remote boolean not null default false,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id)
);
create index attendance_assignments_location_idx on public.attendance_assignments(location_id);

create table public.location_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id),
 action text not null,
 location_id uuid references public.office_locations(id),
 user_id uuid references public.profiles(id) on delete set null,
 before jsonb,
 after jsonb,
 created_at timestamptz not null default now()
);
create index location_audit_created_idx on public.location_audit(created_at desc);

-- Permissions. None are granted by default, so only Super Admins manage locations until
-- they explicitly delegate. Viewing attendance never implies managing geofences.
insert into public.permission_definitions(module,action,module_label,module_group,label,description,scoped,sensitive,sort) values
 ('locations','view','Office locations & geofencing','Administration','View office locations and assignments','Read-only list of offices, coordinates, radii and who is assigned where.',false,true,7301),
 ('locations','manage','Office locations & geofencing','Administration','Create and edit office locations and geofences','Change coordinates, radius, check-in rules and active status.',false,true,7302),
 ('locations','assign','Office locations & geofencing','Administration','Assign people to office locations','Includes per-person radius overrides and work-from-home allowance. Scope limits whose assignment can be changed.',true,true,7303),
 ('settings','location_retention','Settings','Administration','Attendance location retention','How long exact check-in coordinates are kept.',false,true,7107);

-- Admins record their own attendance and request corrections by default, like employees.
insert into public.permission_grants(role,module,action,scope)
 select 'manager',m,a,'self' from (values('attendance','view'),('attendance','create'),('attendance','edit'),('attendance','export'),
  ('corrections','view'),('corrections','create'),('corrections','edit')) v(m,a)
 on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Geofence evaluation (server side).
-- ---------------------------------------------------------------------------
create function private.distance_m(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision) returns double precision language sql immutable set search_path='' as $$
 select 6371000*2*asin(sqrt(least(1,
  power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2))));
$$;

-- The office a person is validated against: their active assignment, otherwise the default office.
create function private.attendance_office(uid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(
  (select jsonb_build_object('location_id',l.id,'name',l.name,'address',l.address,'latitude',l.latitude,'longitude',l.longitude,
     'radius_m',coalesce(a.radius_override_m,l.radius_m),'require_inside',l.require_inside,'allow_remote',a.allow_remote,'source','assigned')
   from public.attendance_assignments a join public.office_locations l on l.id=a.location_id where a.user_id=uid and l.active),
  (select jsonb_build_object('location_id',l.id,'name',l.name,'address',l.address,'latitude',l.latitude,'longitude',l.longitude,
     'radius_m',l.radius_m,'require_inside',l.require_inside,'allow_remote',false,'source','default')
   from public.office_locations l where l.is_default and l.active));
$$;

-- Result statuses: verified, outside, low_accuracy, no_location, no_office.
create function private.geofence_check(uid uuid,p_lat double precision,p_lng double precision,p_accuracy double precision) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o jsonb:=private.attendance_office(uid); dist double precision; st text; radius integer;
begin
 if o is null then return jsonb_build_object('status','no_office','verified',false); end if;
 radius:=(o->>'radius_m')::integer;
 if p_lat is not null then dist:=round(private.distance_m(p_lat,p_lng,(o->>'latitude')::float,(o->>'longitude')::float)::numeric,1); end if;
 st:=case when p_lat is null then 'no_location' when dist>radius then 'outside' when p_accuracy is null or p_accuracy>radius then 'low_accuracy' else 'verified' end;
 return jsonb_build_object('status',st,'verified',st='verified','distance_m',dist,'accuracy_m',p_accuracy,'location_id',o->>'location_id',
  'office_name',o->>'name','radius_m',radius,'require_inside',(o->>'require_inside')::boolean,'allow_remote',(o->>'allow_remote')::boolean);
end $$;

create function private.geofence_message(g jsonb,verb text) returns text language sql immutable set search_path='' as $$
 select case g->>'status'
  when 'no_location' then format('Location is required to %s at %s. Allow location access for this site and try again.',verb,g->>'office_name')
  when 'outside' then format('You are outside the authorized office location (%s from %s; allowed radius %s m). Please move inside the permitted area to %s.',case when (g->>'distance_m')::numeric>=1000 then round((g->>'distance_m')::numeric/1000,1)||' km' else round((g->>'distance_m')::numeric)||' m' end,g->>'office_name',g->>'radius_m',verb)
  when 'low_accuracy' then format('Your location is too imprecise to verify (±%s m; the %s geofence is %s m). Turn on precise location or move to an open area, then try again.',coalesce(round((g->>'accuracy_m')::numeric)::text,'unknown'),g->>'office_name',g->>'radius_m')
  else 'Location could not be verified.' end;
$$;

-- What the signed-in person sees on their attendance card: their office and, optionally,
-- a server-side check of a position they choose to share. Nothing is stored.
create function public.my_attendance_location(p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); o jsonb;
begin
 if uid is null or not private.permitted('attendance','view',uid) then raise exception 'Permission denied';end if;
 if (p_lat is null)<>(p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy<0 then raise exception 'Invalid location';end if;
 o:=private.attendance_office(uid);
 return jsonb_build_object('office',o,'check',case when p_lat is null then null else private.geofence_check(uid,p_lat,p_lng,p_accuracy) end);
end $$;

-- ---------------------------------------------------------------------------
-- Check-in / check-out.
-- ---------------------------------------------------------------------------
create or replace function public.clock_attendance(p_action text,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_wfh boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); s jsonb; d date; r public.records; g jsonb; st text; secs numeric;
begin
 p_wfh:=coalesce(p_wfh,false);
 if uid is null or p_action not in ('in','out') then raise exception 'Invalid clock action';end if;
 if not private.permitted('attendance','view',uid) or not private.permitted('attendance',case when p_action='in' then 'create' else 'edit' end,uid) then raise exception 'Permission denied';end if;
 if (p_lat is null)<>(p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy<0 or p_accuracy::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid location';end if;
 select data into s from public.settings where id=1;
 d:=(now() at time zone (s->>'timezone'))::date;
 -- Serialises double clicks and parallel requests from several devices.
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||uid,0));
 select * into r from public.records where module='attendance' and owner_id=uid and data->>'date'=d::text for update;
 g:=private.geofence_check(uid,p_lat,p_lng,p_accuracy);
 if p_action='in' then
  if r.id is not null then raise exception 'You have already checked in today';end if;
  if p_wfh then
   if g->>'status'<>'no_office' and (g->>'require_inside')::boolean and not coalesce((g->>'allow_remote')::boolean,false) then
    raise exception 'Work from home check-in is not enabled for your account. Ask a Super Admin to allow it, or check in at %.',g->>'office_name';
   end if;
  elsif g->>'status'<>'no_office' and (g->>'require_inside')::boolean and not (g->>'verified')::boolean then
   raise exception '%',private.geofence_message(g,'check in');
  end if;
  st:=case when p_wfh then 'Work From Home' when (now() at time zone(s->>'timezone'))::time>(s->>'office_start')::time+make_interval(mins=>(s->>'grace_minutes')::integer) then 'Late' else 'Present' end;
  insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · '||d,st,uid,uid,jsonb_build_object(
   'date',d,'clock_in',now(),'wfh',p_wfh,
   'lat',p_lat,'lng',p_lng,'accuracy',p_accuracy,'distance_m',g->'distance_m','verified',(g->>'verified')::boolean,'location_status',g->>'status',
   'location_id',g->>'location_id','office_name',g->>'office_name','radius_m',g->'radius_m',
   'flagged',not (g->>'verified')::boolean and not p_wfh,'location_source','device-reported; not tamper-proof')) returning id into r.id;
 else
  if r.id is null or r.data->>'clock_in' is null then raise exception 'You have not checked in today';end if;
  if r.data->>'clock_out' is not null then raise exception 'You have already checked out today';end if;
  -- Check-out is never blocked by the geofence, so leaving the office cannot create a missing
  -- check-out; the result is recorded for review instead.
  secs:=extract(epoch from now()-(r.data->>'clock_in')::timestamptz);
  update public.records set data=data||jsonb_build_object(
    'clock_out',now(),'hours',round((secs/3600)::numeric,2),
    'out_lat',p_lat,'out_lng',p_lng,'out_accuracy',p_accuracy,'out_distance_m',g->'distance_m','out_verified',(g->>'verified')::boolean,'out_location_status',g->>'status'),
   status=case when secs/3600<(s->>'half_day_hours')::numeric then 'Half-Day' else status end,version=version+1,updated_at=now()
  where id=r.id;
 end if;
 return r.id;
end $$;

-- Approved corrections change times; the first recorded values are kept on the record.
create function private.preserve_attendance_original() returns trigger language plpgsql set search_path='' as $$
begin
 if new.module='attendance' and new.data ? 'correction_id' and not (old.data ? 'original')
  and ((old.data->>'clock_in') is distinct from (new.data->>'clock_in') or (old.data->>'clock_out') is distinct from (new.data->>'clock_out')) then
  new.data:=new.data||jsonb_build_object('original',jsonb_build_object('clock_in',old.data->'clock_in','clock_out',old.data->'clock_out','hours',old.data->'hours','status',old.status));
 end if;
 return new;
end $$;
create trigger attendance_preserve_original before update on public.records for each row when (new.module='attendance') execute function private.preserve_attendance_original();

-- ---------------------------------------------------------------------------
-- Location administration.
-- ---------------------------------------------------------------------------
create function public.save_office_location(p_id uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); old public.office_locations; n public.office_locations;
begin
 if not private.has_feature('locations','manage') then raise exception 'Only a Super Admin or someone granted location management can change office locations';end if;
 if jsonb_typeof(p_data)<>'object' or length(trim(coalesce(p_data->>'name','')))=0 then raise exception 'Give the office a name';end if;
 if jsonb_typeof(p_data->'latitude')<>'number' or (p_data->>'latitude')::float not between -90 and 90 then raise exception 'Latitude must be a number between -90 and 90';end if;
 if jsonb_typeof(p_data->'longitude')<>'number' or (p_data->>'longitude')::float not between -180 and 180 then raise exception 'Longitude must be a number between -180 and 180';end if;
 if jsonb_typeof(p_data->'radius_m')<>'number' or (p_data->>'radius_m')::numeric not between 10 and 50000 or (p_data->>'radius_m')::numeric<>round((p_data->>'radius_m')::numeric) then raise exception 'Geofence radius must be a whole number of metres between 10 and 50,000';end if;
 if coalesce((p_data->>'is_default')::boolean,false) and not coalesce((p_data->>'active')::boolean,true) then raise exception 'The default office must be active';end if;
 if exists(select 1 from public.office_locations where lower(trim(name))=lower(trim(p_data->>'name')) and id is distinct from p_id) then raise exception 'An office with this name already exists';end if;
 if coalesce((p_data->>'is_default')::boolean,false) then update public.office_locations set is_default=false where is_default and id is distinct from p_id; end if;
 if p_id is null then
  insert into public.office_locations(name,address,latitude,longitude,radius_m,require_inside,is_default,active,created_by,updated_by)
  values(trim(p_data->>'name'),trim(coalesce(p_data->>'address','')),(p_data->>'latitude')::float,(p_data->>'longitude')::float,(p_data->>'radius_m')::integer,
   coalesce((p_data->>'require_inside')::boolean,true),coalesce((p_data->>'is_default')::boolean,false),coalesce((p_data->>'active')::boolean,true),uid,uid)
  returning * into n;
 else
  select * into old from public.office_locations where id=p_id for update;
  if old.id is null then raise exception 'Office location not found';end if;
  update public.office_locations set name=trim(p_data->>'name'),address=trim(coalesce(p_data->>'address','')),latitude=(p_data->>'latitude')::float,longitude=(p_data->>'longitude')::float,
   radius_m=(p_data->>'radius_m')::integer,require_inside=coalesce((p_data->>'require_inside')::boolean,true),is_default=coalesce((p_data->>'is_default')::boolean,false),
   active=coalesce((p_data->>'active')::boolean,true),updated_at=now(),updated_by=uid where id=p_id returning * into n;
 end if;
 insert into public.location_audit(actor_id,action,location_id,before,after)
 values(uid,case when old.id is null then 'Office created' when old.active and not n.active then 'Office deactivated' when not old.active and n.active then 'Office reactivated' else 'Office updated' end,
  n.id,case when old.id is null then null else to_jsonb(old)-'created_at'-'updated_at'-'created_by'-'updated_by' end,to_jsonb(n)-'created_at'-'updated_at'-'created_by'-'updated_by');
 return n.id;
end $$;

-- Assign (or clear, with p_location null) the office a person checks in against.
create function public.set_attendance_location(p_user uuid,p_location uuid,p_radius integer default null,p_allow_remote boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); t public.profiles; old public.attendance_assignments; n public.attendance_assignments;
begin
 select * into t from public.profiles where id=p_user;
 if t.id is null then raise exception 'User not found';end if;
 if not private.is_admin() then
  if not private.permitted('locations','assign',p_user) then raise exception 'You do not have permission to change attendance locations';end if;
  if t.role='super_admin' then raise exception 'Only a Super Admin can change a Super Admin''s attendance location';end if;
  if p_user=uid then raise exception 'Ask a Super Admin to change your own attendance location';end if;
 end if;
 if p_location is not null and not exists(select 1 from public.office_locations where id=p_location and active) then raise exception 'Choose an active office location';end if;
 if p_radius is not null and p_radius not between 10 and 50000 then raise exception 'Geofence radius must be between 10 and 50,000 metres';end if;
 select * into old from public.attendance_assignments where user_id=p_user for update;
 if p_location is null then
  delete from public.attendance_assignments where user_id=p_user;
 else
  insert into public.attendance_assignments(user_id,location_id,radius_override_m,allow_remote,updated_at,updated_by) values(p_user,p_location,p_radius,coalesce(p_allow_remote,false),now(),uid)
  on conflict(user_id) do update set location_id=excluded.location_id,radius_override_m=excluded.radius_override_m,allow_remote=excluded.allow_remote,updated_at=now(),updated_by=uid
  returning * into n;
 end if;
 if (case when old.user_id is null then null else to_jsonb(old)-'updated_at'-'updated_by' end) is distinct from (case when n.user_id is null then null else to_jsonb(n)-'updated_at'-'updated_by' end) then
  insert into public.location_audit(actor_id,action,location_id,user_id,before,after)
  values(uid,case when p_location is null then 'Assignment removed' when old.user_id is null then 'Person assigned' else 'Assignment changed' end,
   coalesce(n.location_id,old.location_id),p_user,case when old.user_id is null then null else to_jsonb(old)-'updated_at'-'updated_by'-'user_id' end,case when n.user_id is null then null else to_jsonb(n)-'updated_at'-'updated_by'-'user_id' end);
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting: one row per person the viewer may see, for one day.
-- ---------------------------------------------------------------------------
create function public.attendance_overview(p_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=private.current_user_id();
begin
 if uid is null or not private.permitted('attendance','view',uid) then raise exception 'Permission denied';end if;
 if p_date is null or p_date>current_date+1 then raise exception 'Choose a valid date';end if;
 return coalesce((select jsonb_agg(v order by v->>'name') from (
  select jsonb_build_object(
   'user_id',p.id,'name',p.full_name,'employee_id',p.employee_id,'department',p.department,'role',p.role,
   'office',(select o->>'name' from (select private.attendance_office(p.id) o) y),
   'office_id',(select o->>'location_id' from (select private.attendance_office(p.id) o) y),
   'record',case when a.id is null then null else jsonb_build_object('id',a.id,'status',a.status,'data',a.data-'original','original',a.data->'original','updated_at',a.updated_at) end,
   'correction',(select jsonb_build_object('id',c.id,'status',c.status) from public.records c where c.module='corrections' and c.owner_id=p.id and c.data->>'attendance_id'=a.id::text order by c.updated_at desc limit 1)
  ) as v
  from public.profiles p
  left join public.records a on a.module='attendance' and a.owner_id=p.id and a.data->>'date'=p_date::text
  where p.active and private.permitted('attendance','view',p.id)) t),'[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Retention: exact coordinates are cleared after the configured number of days.
-- Distance and verification results stay for reporting.
-- ---------------------------------------------------------------------------
create function public.purge_attendance_locations() returns integer language plpgsql security definer set search_path='' as $$
declare days integer; n integer;
begin
 select coalesce((data->>'location_retention_days')::integer,365) into days from public.settings where id=1;
 update public.records set data=data-'lat'-'lng'-'out_lat'-'out_lng'||jsonb_build_object('location_purged_at',now())
 where module='attendance' and (data ? 'lat' or data ? 'out_lat') and not data ? 'location_purged_at'
  and (data->>'date')::date<current_date-days;
 get diagnostics n=row_count;
 return n;
end $$;

-- Company settings: geofence keys now belong to location management, not company policy.
create or replace function public.update_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare cur jsonb; k text; grp text;
begin
 select data into cur from public.settings where id=1;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid settings';end if;
 for k in select key from jsonb_each(p_data) union select key from jsonb_each(cur) loop
  if (p_data->k) is distinct from (cur->k) then
   if k in ('office_lat','office_lng','geofence_radius','enforce_geofence') then raise exception 'Office coordinates and geofences are managed in Settings → Office locations';end if;
   grp:=case when k like 'reminder\_%' or k in ('notification_channels','sounds') then 'reminders' when k='chat' then 'chat' when k='location_retention_days' then 'location_retention' else 'company' end;
   if not private.has_feature('settings',grp) then raise exception 'You do not have permission to change % settings',replace(grp,'_',' ');end if;
  end if;
 end loop;
 if not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then raise exception 'Invalid company timezone';end if;
 perform (p_data->>'office_start')::time;perform (p_data->>'office_end')::time;perform (p_data->>'attendance_reminder')::time;perform (p_data->>'eod_reminder')::time;perform (p_data->>'eod_deadline')::time;
 if (p_data->>'grace_minutes')::numeric not between 0 and 180 or (p_data->>'renewal_days')::integer not between 1 and 365
  or coalesce((p_data->>'location_retention_days')::integer,365) not between 30 and 3650 then raise exception 'Invalid company policy';end if;
 update public.settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Company policy updated',p_data);
end $$;

-- The single company office from earlier versions becomes the default office location.
insert into public.office_locations(name,address,latitude,longitude,radius_m,require_inside,is_default,active)
select 'Main office','',(data->>'office_lat')::float,(data->>'office_lng')::float,greatest(10,least(50000,coalesce((data->>'geofence_radius')::integer,200))),coalesce((data->>'enforce_geofence')::boolean,false),true,true
from public.settings where id=1 and data->>'office_lat' is not null and data->>'office_lng' is not null;
update public.settings set data=data||'{"location_retention_days":365}'::jsonb where id=1 and not data ? 'location_retention_days';

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------
alter table public.office_locations enable row level security;
alter table public.attendance_assignments enable row level security;
alter table public.location_audit enable row level security;
create policy office_locations_read on public.office_locations for select to techly_user using(
 private.is_admin() or private.has_feature('locations','view') or private.has_feature('locations','manage') or private.has_feature('locations','assign')
 or id=(select location_id from public.attendance_assignments where user_id=private.current_user_id()) or (is_default and active));
create policy attendance_assignments_read on public.attendance_assignments for select to techly_user using(
 user_id=private.current_user_id() or private.is_admin() or private.has_feature('locations','view') or private.has_feature('locations','manage')
 or private.permitted('locations','assign',user_id));
create policy location_audit_read on public.location_audit for select to techly_user using(
 private.is_admin() or private.has_feature('locations','view') or private.has_feature('locations','manage') or private.has_feature('audit','view'));
grant select on public.office_locations,public.attendance_assignments,public.location_audit to techly_user;
grant select,insert,update,delete on public.office_locations,public.attendance_assignments,public.location_audit to techly_service;

revoke all on function private.distance_m(double precision,double precision,double precision,double precision),private.attendance_office(uuid),
 private.geofence_check(uuid,double precision,double precision,double precision),private.geofence_message(jsonb,text),private.preserve_attendance_original(),
 public.my_attendance_location(double precision,double precision,double precision),public.save_office_location(uuid,jsonb),
 public.set_attendance_location(uuid,uuid,integer,boolean),public.attendance_overview(date),public.purge_attendance_locations()
 from public,techly_anon,techly_user,techly_service;
grant execute on function public.my_attendance_location(double precision,double precision,double precision),public.save_office_location(uuid,jsonb),
 public.set_attendance_location(uuid,uuid,integer,boolean),public.attendance_overview(date) to techly_user;
grant execute on function public.purge_attendance_locations() to techly_service;
commit;
