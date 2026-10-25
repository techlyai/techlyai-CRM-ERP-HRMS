-- Migration 010: check-in on scheduler placeholder days.
--
-- After office hours the scheduler records Holiday, Leave or Absent for people without
-- attendance. Those rows have no check-in time, but clock_attendance treated any row for
-- the day as a check-in, so people working on a holiday or arriving late could not check
-- in. A check-in now fills the placeholder and keeps its status as scheduled_status.
begin;

create or replace function public.clock_attendance(p_action text,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_wfh boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.current_user_id(); s jsonb; d date; r public.records; g jsonb; st text; secs numeric; rec jsonb;
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
  -- A row without a check-in time is the scheduler's Holiday/Leave/Absent placeholder; checking in fills it.
  if r.id is not null and r.data->>'clock_in' is not null then raise exception 'You have already checked in today';end if;
  if p_wfh then
   if g->>'status'<>'no_office' and (g->>'require_inside')::boolean and not coalesce((g->>'allow_remote')::boolean,false) then
    raise exception 'Work from home check-in is not enabled for your account. Ask a Super Admin to allow it, or check in at %.',g->>'office_name';
   end if;
  elsif g->>'status'<>'no_office' and (g->>'require_inside')::boolean and not (g->>'verified')::boolean then
   raise exception '%',private.geofence_message(g,'check in');
  end if;
  st:=case when p_wfh then 'Work From Home' when (now() at time zone(s->>'timezone'))::time>(s->>'office_start')::time+make_interval(mins=>(s->>'grace_minutes')::integer) then 'Late' else 'Present' end;
  rec:=jsonb_build_object(
   'date',d,'clock_in',now(),'wfh',p_wfh,
   'lat',p_lat,'lng',p_lng,'accuracy',p_accuracy,'distance_m',g->'distance_m','verified',(g->>'verified')::boolean,'location_status',g->>'status',
   'location_id',g->>'location_id','office_name',g->>'office_name','radius_m',g->'radius_m',
   'flagged',not (g->>'verified')::boolean and not p_wfh,'location_source','device-reported; not tamper-proof');
  if r.id is null then
   insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · '||d,st,uid,uid,rec) returning id into r.id;
  else
   -- Keep what the scheduler had recorded (for example Holiday) for reporting.
   update public.records set status=st,data=r.data||rec||jsonb_build_object('scheduled_status',r.status),version=version+1,updated_at=now() where id=r.id;
  end if;
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

commit;
