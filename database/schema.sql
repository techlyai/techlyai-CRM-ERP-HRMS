-- Techly initial schema. Apply once to a NEW dedicated PostgreSQL database.
begin;
create schema if not exists private;
revoke all on schema private from public, techly_anon;
grant usage on schema private to techly_user, techly_service;

create table public.profiles (
 id uuid primary key references private.accounts(id), full_name text not null,
 phone text not null unique, role text not null check(role in ('super_admin','manager','employee')),
 department text, manager_id uuid references public.profiles(id), active boolean not null default true,
 must_change_password boolean not null default true, created_at timestamptz not null default now(),
 check(manager_id is null or manager_id<>id)
);
create table public.permission_grants (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id), role text,
 module text not null, action text not null check(action in ('view','create','edit','upload','approve','export','delete')),
 scope text not null check(scope in ('self','team','all','none')),
 check((user_id is null)<>(role is null)), unique nulls not distinct(user_id,role,module,action)
);
create index profiles_manager_idx on public.profiles(manager_id);
create table public.records (
 id uuid primary key default gen_random_uuid(), module text not null,
 title text not null check(length(title) between 1 and 200), status text not null,
 owner_id uuid not null references public.profiles(id), created_by uuid not null references public.profiles(id),
 data jsonb not null default '{}', version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(jsonb_typeof(data)='object'), check(length(data::text)<200000),
 check(module in ('clients','leads','renewals','projects','tasks','eod','employees','payroll','onboarding','attendance','corrections','leave','software','inventory','assets','maintenance','vendors','purchases','expenses','credit'))
);
create index records_module_owner_idx on public.records(module,owner_id,created_at desc);
create index records_data_idx on public.records using gin(data);
create index records_title_search_idx on public.records using gin(to_tsvector('simple',title));
create unique index attendance_person_day on public.records(owner_id,(data->>'date')) where module='attendance';
create unique index eod_person_day on public.records(owner_id,(data->>'report_date')) where module='eod' and status<>'Archived';
create unique index inventory_sku on public.records((data->>'sku')) where module='inventory';
create unique index employee_record_owner on public.records(owner_id) where module='employees';
create unique index employee_number_unique on public.records((data->>'employee_id')) where module='employees';
create table public.record_shares(record_id uuid references public.records(id),user_id uuid references public.profiles(id),primary key(record_id,user_id));
create table public.history (
 id bigint generated always as identity primary key, record_id uuid references public.records(id),
 actor_id uuid references public.profiles(id), action text not null, snapshot jsonb,
 created_at timestamptz not null default now()
);
create index history_record_created_idx on public.history(record_id,created_at desc);
create table public.questions (
 id uuid primary key default gen_random_uuid(),record_id uuid not null references public.records(id),
 author_id uuid not null references public.profiles(id), parent_id uuid references public.questions(id),
 body text not null check(length(body) between 1 and 20000), resolved boolean not null default false,
 read_by uuid[] not null default '{}', created_at timestamptz not null default now()
);
create index questions_record_created_idx on public.questions(record_id,created_at);
create table public.attachments (
 id uuid primary key default gen_random_uuid(),record_id uuid not null references public.records(id),
 uploaded_by uuid not null references public.profiles(id), path text not null unique,
 name text not null, mime text not null, size bigint not null check(size between 1 and 20971520),
 verified boolean not null default false, created_at timestamptz not null default now()
);
create index attachments_record_idx on public.attachments(record_id);
create table public.settings(id integer primary key check(id=1),data jsonb not null);
insert into public.settings values(1,'{"timezone":"Asia/Kolkata","working_days":[1,2,3,4,5,6],"office_start":"09:00","office_end":"18:00","grace_minutes":15,"half_day_hours":4,"attendance_reminder":"08:30","eod_reminder":"17:00","eod_deadline":"18:30","office_lat":null,"office_lng":null,"geofence_radius":200,"enforce_geofence":false,"holidays":[],"special_days":[],"renewal_days":30,"reminder_intervals":[15,7,3,1,0]}'::jsonb);
create table public.leave_policies (
 type text primary key, allocation numeric not null check(allocation>=0), accrual text not null check(accrual in ('annual','monthly','none')),
 carry_forward numeric not null default 0 check(carry_forward>=0), eligibility_days integer not null default 0 check(eligibility_days>=0), paid boolean not null default true
);
insert into public.leave_policies(type,allocation,accrual,paid) values
 ('Casual Leave',12,'annual',true),('Sick Leave',6,'annual',true),('Earned Leave',1,'monthly',true),('Optional Leave',2,'annual',true),('Unpaid Leave',0,'none',false),('Compensatory Off',0,'none',true);
create table public.leave_ledger (
 id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),
 type text not null references public.leave_policies(type),amount numeric not null,record_id uuid references public.records(id),
 event_key text not null unique,created_at timestamptz not null default now()
);
create index leave_ledger_user_type_idx on public.leave_ledger(user_id,type);
create table public.stock_movements (
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.records(id),
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('Purchase','Allocation','Return','Transfer','Damage','Disposal')),
 quantity integer not null check(quantity>0),employee_id uuid references public.profiles(id),location text,
 note text not null,source_id uuid references public.records(id),event_key text not null unique,created_at timestamptz not null default now()
);
create index stock_movements_item_employee_idx on public.stock_movements(item_id,employee_id);
create table public.payments (
 id uuid primary key default gen_random_uuid(),record_id uuid not null references public.records(id),
 actor_id uuid not null references public.profiles(id),amount numeric(14,2) not null check(amount>0),
 method text not null,reference text not null,event_key text not null unique,created_at timestamptz not null default now()
);
create index payments_record_idx on public.payments(record_id);
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id), data jsonb not null default '{"muted":false,"volume":0.5,"categories":{}}'
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),
 category text not null,title text not null,body text not null,record_id uuid references public.records(id),
 event_key text not null,read_at timestamptz,snoozed_until timestamptz,
 created_at timestamptz not null default now(),unique(user_id,event_key)
);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),endpoint text not null unique,keys jsonb not null);
create table private.push_outbox(id uuid primary key default gen_random_uuid(),notification_id uuid not null unique references public.notifications(id),attempts integer not null default 0,status text not null default 'pending',available_at timestamptz not null default now(),error text);
create table public.scheduler_runs(id bigint generated always as identity primary key,started_at timestamptz not null default now(),finished_at timestamptz,notification_count integer,error text);
create table private.login_attempts(key text primary key,attempts integer not null default 1,window_start timestamptz not null default now());

create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=private.current_user_id() and active and not must_change_password and role='super_admin');
$$;
create function private.permitted_for(uid uuid,m text,a text,owner uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; s text;
begin
 select * into p from public.profiles where id=uid;
 if p.id is null or not p.active or p.must_change_password then return false; end if;
 if p.role='super_admin' then return true; end if;
 if p.role='employee' and (m='onboarding' or (m in ('employees','payroll','attendance','leave','corrections') and owner is distinct from p.id)) then return false;end if;
 select scope into s from public.permission_grants where user_id=p.id and role is null and module=m and action=a;
 if s is null then select scope into s from public.permission_grants where user_id is null and role=p.role and module=m and action=a; end if;
 return coalesce(s='all' or (s='self' and owner=p.id) or (s='team' and (owner=p.id or exists(select 1 from public.profiles where id=owner and manager_id=p.id and active))),false);
end $$;
create function private.permitted(m text,a text,owner uuid) returns boolean language sql stable security definer set search_path='' as $$select private.permitted_for(private.current_user_id(),m,a,owner);$$;
create function private.visible(rid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.records r where r.id=rid and (private.permitted(r.module,'view',r.owner_id) or
 ((exists(select 1 from public.record_shares s where s.record_id=r.id and s.user_id=private.current_user_id()) or (r.module='projects' and r.data->'team' @> to_jsonb(private.current_user_id()::text))) and (r.module not in ('employees','payroll','attendance','leave','corrections','onboarding') or exists(select 1 from public.profiles where id=private.current_user_id() and role in ('manager','super_admin'))) and private.permitted(r.module,'view',private.current_user_id()))));
$$;

-- Employees receive their own operational records. Managers require explicit grants.
insert into public.permission_grants(role,module,action,scope)
 select 'employee',m,a,'self' from unnest(array['leads','tasks','eod','employees','attendance','corrections','leave','expenses','purchases','projects']) m
 cross join unnest(array['view','create','edit','upload','export']) a
 where not (m in ('employees','projects') and a in ('create','edit'));

create function private.notify(uid uuid,category text,title text,body text,rid uuid,event text) returns void language plpgsql security definer set search_path='' as $$
declare nid uuid; r public.records;
begin
 if uid is null then return; end if;
 if not exists(select 1 from public.profiles where id=uid and active) then return;end if;
 if rid is not null then
  select * into r from public.records where id=rid;
  if not private.permitted_for(uid,r.module,'view',r.owner_id) then return;end if;
 end if;
 insert into public.notifications(user_id,category,title,body,record_id,event_key) values(uid,category,title,body,rid,event)
 on conflict(user_id,event_key) do nothing returning id into nid;
 if nid is not null then insert into private.push_outbox(notification_id) values(nid); end if;
end $$;
create function private.notify_reviewers(r public.records,event text) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 for p in select * from public.profiles where active and id<>private.current_user_id() and (role='super_admin' or id=(select manager_id from public.profiles where id=r.owner_id)) loop
  perform private.notify(p.id,'approvals',r.title||' · '||r.status,'A record is ready for your review.',r.id,event);
 end loop;
end $$;
create function private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.history(record_id,actor_id,action,snapshot) values(new.id,private.current_user_id(),case when tg_op='INSERT' then 'Created' else 'Updated' end,to_jsonb(new));return new;
end $$;
create trigger records_audit after insert or update on public.records for each row execute function private.audit_record();

create function public.save_record(p_module text,p_title text,p_data jsonb,p_owner uuid,p_id uuid default null,p_version integer default null,p_status text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.records; initial text; actor uuid:=private.current_user_id();
begin
 if actor is null or not private.permitted(p_module,case when p_id is null then 'create' else 'edit' end,p_owner) then raise exception 'Permission denied' using errcode='42501'; end if;
 if p_module='attendance' then raise exception 'Use attendance clock actions'; end if;
 perform private.validate_record_data(p_module,p_data);
 if p_data ?| array['available','allocated','damaged','paid_amount','clock_in','clock_out','lat','lng','date','leave_days','snoozed_until','renewal_history','received_at'] and p_module not in ('corrections') then raise exception 'System fields cannot be edited'; end if;
 if p_module='corrections' and (p_data ?| array['available','allocated','damaged','paid_amount','lat','lng','date','leave_days','snoozed_until','renewal_history','received_at']) then raise exception 'Invalid correction';end if;
 initial:=case p_module when 'leads' then 'New Lead' when 'tasks' then 'To Do' when 'eod' then 'Draft' when 'leave' then 'Draft' when 'expenses' then 'Draft' when 'purchases' then 'Draft' when 'corrections' then 'Draft' when 'maintenance' then 'Draft' when 'onboarding' then 'Applied' when 'credit' then 'Open' when 'payroll' then 'Draft' else 'Active' end;
 if p_id is null then
  if p_module='leave' and (p_data->>'start_date')::date>(p_data->>'end_date')::date then raise exception 'Invalid leave dates';end if;
  if p_module='inventory' then p_data:=p_data||'{"available":0,"allocated":0,"damaged":0}';end if;
  insert into public.records(module,title,status,owner_id,created_by,data) values(p_module,p_title,initial,p_owner,actor,p_data) returning id into p_id;
 else
  select * into r from public.records where id=p_id for update;
  if r.id is null or r.module<>p_module or r.version is distinct from p_version then raise exception 'Record changed. Refresh and try again.';end if;
  if not private.permitted(r.module,'edit',r.owner_id) or (r.owner_id<>p_owner and not private.is_admin()) then raise exception 'Permission denied';end if;
  if r.module in ('eod','leave','expenses','purchases','maintenance','corrections','payroll') and r.status not in ('Draft','Clarification Required','Rejected') then raise exception 'Submitted records must be reviewed before editing';end if;
  if r.module='credit' and exists(select 1 from public.payments where record_id=r.id) and ((p_data->>'amount')::numeric is distinct from (r.data->>'amount')::numeric or p_data->>'vendor' is distinct from r.data->>'vendor' or p_data->>'purchase_id' is distinct from r.data->>'purchase_id' or p_data->>'credit_date' is distinct from r.data->>'credit_date') then raise exception 'Original credit amount, creditor, and purchase reference cannot change after payments';end if;
  if p_status is not null and p_status<>r.status then
   if not exists(select 1 from private.module_contracts c where c.module=p_module and (c.definition->'statuses') @> to_jsonb(p_status)) then raise exception 'Invalid status';end if;
   if r.module not in ('leads','tasks','projects','employees','onboarding','assets','inventory','vendors','clients') then raise exception 'Use workflow actions to change status';end if;
  end if;
  update public.records set title=p_title,owner_id=p_owner,data=p_data||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r.data) where key in ('available','allocated','damaged','paid_amount','snoozed_until','renewal_history','received_at')),status=coalesce(p_status,r.status),version=version+1,updated_at=now() where id=p_id;
 end if;
 return p_id;
end $$;

create function private.leave_days(d jsonb) returns numeric language plpgsql stable set search_path='' as $$
declare s jsonb; n numeric;
begin
 select data into s from public.settings where id=1;
 select count(*) into n from generate_series((d->>'start_date')::date,(d->>'end_date')::date,'1 day') day
 where coalesce((select (value->>'working')::boolean from jsonb_array_elements(s->'special_days') where value->>'date'=to_char(day,'YYYY-MM-DD') limit 1),((s->'working_days') @> to_jsonb(extract(dow from day)::integer) and not ((s->'holidays') @> to_jsonb(to_char(day,'YYYY-MM-DD')))));
 if d->>'duration'='Half Day' then if d->>'start_date'<>d->>'end_date' then raise exception 'Half-day leave must be a single day';end if;n:=n/2;end if;
 if n<=0 then raise exception 'Leave has no eligible working days';end if;return n;
end $$;
create function public.workflow(p_id uuid,p_action text,p_version integer,p_note text default '') returns void language plpgsql security definer set search_path='' as $$
declare r public.records; next_status text; n numeric; bal numeric; pol public.leave_policies; attendance public.records; asset public.records; office jsonb; corrected_in timestamptz; corrected_out timestamptz; corrected_hours numeric; corrected_status text;
begin
 select * into r from public.records where id=p_id for update;
 if r.id is null or r.version is distinct from p_version or not private.visible(p_id) then raise exception 'Record changed or unavailable';end if;
 if p_action in ('approve','reject','clarify','cancel_approve') then
  if not private.permitted(r.module,'approve',r.owner_id) or r.owner_id=private.current_user_id() then raise exception 'An independent authorized reviewer is required';end if;
  if r.status not in ('Submitted','Resubmitted','Clarification Required','Cancellation Requested') then raise exception 'Record is not awaiting review';end if;
  if p_action in ('reject','clarify') and length(trim(p_note))<1 then raise exception 'Give a reason or question';end if;
  next_status:=case p_action when 'approve' then 'Approved' when 'reject' then 'Rejected' when 'clarify' then 'Clarification Required' else 'Cancelled' end;
 elsif p_action='submit' then
  if not private.permitted(r.module,'edit',r.owner_id) or r.module not in ('eod','leave','expenses','purchases','corrections','maintenance','payroll') or r.status not in ('Draft','Clarification Required','Rejected') then raise exception 'Cannot submit';end if;
  next_status:=case when r.status in ('Clarification Required','Rejected') then 'Resubmitted' else 'Submitted' end;
 elsif p_action='cancel_request' and r.module='leave' and r.owner_id=private.current_user_id() and r.status='Approved' then next_status:='Cancellation Requested';
 else raise exception 'Invalid workflow action';end if;
 if r.status='Cancellation Requested' and p_action<>'cancel_approve' then raise exception 'Use cancellation approval';end if;
 if p_action='cancel_approve' and (r.module<>'leave' or r.status<>'Cancellation Requested') then raise exception 'Not a leave cancellation';end if;
 if r.module='leave' and p_action in ('submit','approve') then
  n:=private.leave_days(r.data);select * into pol from public.leave_policies where type=r.data->>'leave_type';
  if pol.type is null then raise exception 'Invalid leave type';end if;
  if exists(select 1 from public.profiles where id=r.owner_id and created_at::date+pol.eligibility_days>current_date) then raise exception 'Leave eligibility period not reached';end if;
  perform pg_advisory_xact_lock(hashtextextended(r.owner_id::text,0));
  if exists(select 1 from public.records x where x.module='leave' and x.owner_id=r.owner_id and x.id<>r.id and x.status in ('Submitted','Resubmitted','Approved','Cancellation Requested') and (x.data->>'start_date')::date<=(r.data->>'end_date')::date and (x.data->>'end_date')::date>=(r.data->>'start_date')::date) then raise exception 'Overlapping leave request';end if;
  if p_action='approve' and pol.paid then
   select coalesce(sum(amount),0) into bal from public.leave_ledger where user_id=r.owner_id and type=pol.type;
   if bal<n then raise exception 'Insufficient leave balance';end if;
   insert into public.leave_ledger(user_id,type,amount,record_id,event_key) values(r.owner_id,pol.type,-n,r.id,'leave:'||r.id) on conflict(event_key) do nothing;
  end if;
  r.data:=r.data||jsonb_build_object('leave_days',n);
 elsif r.module='leave' and p_action='cancel_approve' then
  insert into public.leave_ledger(user_id,type,amount,record_id,event_key)
  select user_id,type,-amount,record_id,'reverse:'||r.id from public.leave_ledger where event_key='leave:'||r.id on conflict(event_key) do nothing;
 elsif r.module='corrections' and p_action='approve' then
  select * into attendance from public.records where id=(r.data->>'attendance_id')::uuid and module='attendance' and owner_id=r.owner_id for update;
  if attendance.id is null then raise exception 'Attendance record not found';end if;
  if ((r.data->>'clock_in')::timestamptz at time zone (select data->>'timezone' from public.settings where id=1))::date<>(attendance.data->>'date')::date then raise exception 'Corrected clock-in must match the recorded working day';end if;
  if (r.data->>'clock_out')::timestamptz<(r.data->>'clock_in')::timestamptz then raise exception 'Invalid clock-out';end if;
  select data into office from public.settings where id=1;
  corrected_in:=(r.data->>'clock_in')::timestamptz;corrected_out:=coalesce(nullif(r.data->>'clock_out','')::timestamptz,(attendance.data->>'clock_out')::timestamptz);
  if corrected_out<corrected_in then raise exception 'Corrected clock-out precedes clock-in';end if;
  corrected_hours:=case when corrected_out is not null then round((extract(epoch from corrected_out-corrected_in)/3600)::numeric,2) else null end;
  corrected_status:=case when corrected_hours<(office->>'half_day_hours')::numeric then 'Half-Day' when attendance.status='Work From Home' then 'Work From Home' when (corrected_in at time zone(office->>'timezone'))::time>(office->>'office_start')::time+make_interval(mins=>(office->>'grace_minutes')::integer) then 'Late' else 'Present' end;
  update public.records set data=data||jsonb_build_object('clock_in',corrected_in,'clock_out',corrected_out,'hours',corrected_hours,'correction_id',r.id),status=corrected_status,version=version+1,updated_at=now() where id=attendance.id;
 elsif r.module='maintenance' and p_action='approve' then
  select * into asset from public.records where id=(r.data->>'asset_id')::uuid and module='assets' for update;
  if asset.id is null or not private.permitted('assets','edit',asset.owner_id) then raise exception 'Asset update permission is required';end if;
  update public.records set data=data||jsonb_build_object('last_service_date',r.data->>'service_date','next_service_date',r.data->>'next_service_date'),version=version+1,updated_at=now() where id=(r.data->>'asset_id')::uuid and module='assets';
  if not found then raise exception 'Asset not found';end if;
 end if;
 if r.module='expenses' and p_action='approve' then next_status:='Pending Payment';end if;
 update public.records set status=next_status,data=r.data,version=version+1,updated_at=now() where id=r.id;
 insert into public.history(record_id,actor_id,action,snapshot) values(r.id,private.current_user_id(),p_action,jsonb_build_object('note',p_note,'status',next_status));
 if p_action='clarify' then insert into public.questions(record_id,author_id,body) values(r.id,private.current_user_id(),p_note);end if;
 perform private.notify(r.owner_id,'approvals',r.title||' · '||next_status,p_note,r.id,'workflow:'||r.id||':'||(r.version+1));
 if p_action='submit' then r.status:=next_status;perform private.notify_reviewers(r,'review:'||r.id||':'||(r.version+1));end if;
end $$;

create function public.clock_attendance(p_action text,p_lat double precision default null,p_lng double precision default null,p_accuracy double precision default null,p_wfh boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare s jsonb; d date; r public.records; distance double precision; suspicious boolean:=false; weekday integer; st text;
begin
 p_wfh:=coalesce(p_wfh,false);
 if not private.permitted('attendance','view',private.current_user_id()) or not private.permitted('attendance',case when p_action='in' then 'create' else 'edit' end,private.current_user_id()) then raise exception 'Permission denied';end if;
 select data into s from public.settings where id=1;d:=(now() at time zone (s->>'timezone'))::date;weekday:=extract(dow from d);
 select * into r from public.records where module='attendance' and owner_id=private.current_user_id() and data->>'date'=d::text for update;
 if p_action='in' then
  if r.id is not null then raise exception 'Already clocked in';end if;
  if (p_lat is null)<>(p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 or p_accuracy<0 or p_accuracy::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid location';end if;
  if s->>'office_lat' is not null and p_lat is not null then
   distance:=6371000*2*asin(sqrt(least(1,
    power(sin(radians(p_lat-(s->>'office_lat')::float)/2),2)
    + cos(radians(p_lat))*cos(radians((s->>'office_lat')::float))
    * power(sin(radians(p_lng-(s->>'office_lng')::float)/2),2)
   )));
   suspicious:=distance>(s->>'geofence_radius')::float or coalesce(p_accuracy,9999)>(s->>'geofence_radius')::float;
  end if;
  if (s->>'enforce_geofence')::boolean and not p_wfh and (p_lat is null or distance is null or suspicious) then raise exception 'An accurate check-in inside the office geofence is required';end if;
  st:=case when p_wfh then 'Work From Home' when (now() at time zone(s->>'timezone'))::time>(s->>'office_start')::time+make_interval(mins=>(s->>'grace_minutes')::integer) then 'Late' else 'Present' end;
  insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · '||d,st,private.current_user_id(),private.current_user_id(),jsonb_build_object('date',d,'clock_in',now(),'lat',p_lat,'lng',p_lng,'accuracy',p_accuracy,'distance_m',distance,'flagged',suspicious,'location_source','device-reported; not tamper-proof')) returning id into r.id;
 elsif p_action='out' then
  if r.id is null or r.data->>'clock_in' is null or r.data->>'clock_out' is not null then raise exception 'No open attendance for today';end if;
  update public.records set data=data||jsonb_build_object('clock_out',now(),'hours',round((extract(epoch from now()-(data->>'clock_in')::timestamptz)/3600)::numeric,2)),status=case when extract(epoch from now()-(data->>'clock_in')::timestamptz)/3600<(s->>'half_day_hours')::numeric then 'Half-Day' else status end,version=version+1,updated_at=now() where id=r.id;
 else raise exception 'Invalid clock action';end if;
 return r.id;
end $$;

create function public.stock_transaction(p_item uuid,p_kind text,p_quantity integer,p_employee uuid,p_location text,p_note text,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare r public.records; available integer; allocated integer; damaged integer; person_stock integer;
begin
 select * into r from public.records where id=p_item and module='inventory' for update;
 if r.id is null or not private.permitted('inventory','edit',r.owner_id) or p_quantity<=0 or length(trim(p_note))=0 then raise exception 'Invalid or unauthorized stock transaction';end if;
 if exists(select 1 from public.stock_movements where event_key=p_key) then return;end if;
 available:=coalesce((r.data->>'available')::integer,0);allocated:=coalesce((r.data->>'allocated')::integer,0);damaged:=coalesce((r.data->>'damaged')::integer,0);
 if p_kind='Purchase' then available:=available+p_quantity;
 elsif p_kind='Allocation' then if p_employee is null then raise exception 'Choose an employee';end if;available:=available-p_quantity;allocated:=allocated+p_quantity;
 elsif p_kind='Return' then
  select coalesce(sum(case kind when 'Allocation' then quantity when 'Return' then -quantity else 0 end),0) into person_stock from public.stock_movements where item_id=p_item and employee_id=p_employee;
  if p_employee is null or person_stock<p_quantity then raise exception 'Return exceeds this employee allocation';end if;available:=available+p_quantity;allocated:=allocated-p_quantity;
 elsif p_kind='Damage' then available:=available-p_quantity;damaged:=damaged+p_quantity;
 elsif p_kind='Disposal' then damaged:=damaged-p_quantity;
 elsif p_kind='Transfer' then if length(trim(coalesce(p_location,'')))=0 or p_quantity<>available then raise exception 'Transfer the complete available stock to a destination';end if;r.data:=r.data||jsonb_build_object('location',p_location);
 else raise exception 'Invalid stock movement';end if;
 if available<0 or allocated<0 or damaged<0 then raise exception 'Stock cannot become negative';end if;
 insert into public.stock_movements(item_id,actor_id,kind,quantity,employee_id,location,note,event_key) values(p_item,private.current_user_id(),p_kind,p_quantity,p_employee,p_location,p_note,p_key);
 update public.records set data=r.data||jsonb_build_object('available',available,'allocated',allocated,'damaged',damaged),version=version+1,updated_at=now() where id=p_item;
end $$;

create function public.record_payment(p_id uuid,p_amount numeric,p_method text,p_reference text,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare r public.records; paid numeric; total numeric;
begin
 select * into r from public.records where id=p_id for update;
 if r.id is null or r.module not in ('expenses','purchases','credit','payroll') or not private.permitted(r.module,'approve',r.owner_id) then raise exception 'Permission denied';end if;
 if r.module='expenses' and r.owner_id=private.current_user_id() then raise exception 'Self reimbursement is not permitted';end if;
 if r.module='expenses' and r.data->>'purchase_id' is not null then raise exception 'Record this payment against the linked purchase';end if;
 if r.module='credit' and r.data->>'purchase_id' is not null then raise exception 'Record this payment against the linked purchase';end if;
 if exists(select 1 from public.payments where event_key=p_key) then return;end if;
 if r.status not in ('Approved','Pending Payment','Received','Open','Partially Paid') then raise exception 'Record is not payable';end if;
 total:=case when r.module='payroll' then (r.data->>'salary')::numeric+coalesce((r.data->>'allowances')::numeric,0)-coalesce((r.data->>'deductions')::numeric,0) else (r.data->>'amount')::numeric end;
 select coalesce(sum(amount),0) into paid from public.payments where record_id=r.id;
 if p_amount<=0 or round(p_amount,2)<>p_amount or paid+p_amount>total or length(trim(p_reference))=0 then raise exception 'Invalid payment amount or reference';end if;
 insert into public.payments(record_id,actor_id,amount,method,reference,event_key) values(r.id,private.current_user_id(),p_amount,p_method,p_reference,p_key);
 update public.records set data=data||jsonb_build_object('paid_amount',paid+p_amount,'payment_status',case when paid+p_amount=total then 'Paid' else 'Partially Paid' end),status=case when module='purchases' then status when paid+p_amount=total then 'Paid' when module='credit' then 'Partially Paid' else status end,version=version+1,updated_at=now() where id=r.id;
end $$;
create function public.receive_purchase(p_id uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.records; line jsonb; item public.records; expense uuid;
begin
 select * into r from public.records where id=p_id and module='purchases' for update;
 if r.id is null or not private.permitted('purchases','approve',r.owner_id) then raise exception 'Permission denied';end if;
 if r.status='Received' then return;end if;
 if r.status<>'Approved' or r.version is distinct from p_version then raise exception 'Purchase is not approved or has changed';end if;
 if jsonb_array_length(r.data->'lines')<1 then raise exception 'Add stock lines';end if;
 -- Lock all items in stable order to avoid cross-purchase deadlocks.
 perform 1 from public.records where id in(select (x->>'item_id')::uuid from jsonb_array_elements(r.data->'lines') x) order by id for update;
 for line in select * from jsonb_array_elements(r.data->'lines') loop
  select * into item from public.records where id=(line->>'item_id')::uuid and module='inventory';
  if item.id is null or not private.permitted('inventory','edit',item.owner_id) or (line->>'quantity')::integer<=0 then raise exception 'Invalid or unauthorized stock line';end if;
  perform public.stock_transaction(item.id,'Purchase',(line->>'quantity')::integer,null,null,'Purchase '||r.title,'purchase:'||r.id||':'||item.id);
 end loop;
 insert into public.records(module,title,status,owner_id,created_by,data) values('expenses','Purchase · '||r.title,'Approved',r.owner_id,private.current_user_id(),jsonb_build_object('expense_date',coalesce(r.data->>'purchase_date',current_date::text),'category','Hardware','amount',r.data->'amount','purchase_id',r.id,'vendor',r.data->>'vendor','purpose',r.data->>'purpose')) returning id into expense;
 update public.records set status='Received',data=data||jsonb_build_object('received_at',now(),'expense_id',expense),version=version+1,updated_at=now() where id=r.id;
end $$;

create function public.record_question(p_record uuid,p_body text,p_parent uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.records; q uuid; parent public.questions;
begin
 select * into r from public.records where id=p_record;
 if not private.visible(p_record) or (p_parent is null and not private.permitted(r.module,'approve',r.owner_id)) or (p_parent is not null and not private.permitted(r.module,'edit',r.owner_id) and not private.permitted(r.module,'approve',r.owner_id)) then raise exception 'Permission denied';end if;
 if p_parent is not null then select * into parent from public.questions where id=p_parent and record_id=p_record and parent_id is null;if parent.id is null then raise exception 'Invalid question thread';end if;end if;
 insert into public.questions(record_id,author_id,parent_id,body,read_by) values(p_record,private.current_user_id(),p_parent,p_body,array[private.current_user_id()]) returning id into q;
 perform private.notify(case when private.current_user_id()=r.owner_id then parent.author_id else r.owner_id end,'questions','New message · '||r.title,left(p_body,500),r.id,'message:'||q);
 return q;
end $$;
create function public.resolve_question(p_id uuid,p_resolved boolean) returns void language plpgsql security definer set search_path='' as $$
declare q public.questions; r public.records;
begin select * into q from public.questions where id=p_id and parent_id is null;select * into r from public.records where id=q.record_id;
 if not private.permitted(r.module,'approve',r.owner_id) then raise exception 'Permission denied';end if;
 update public.questions set resolved=p_resolved where id=p_id;
 insert into public.history(record_id,actor_id,action,snapshot) values(r.id,private.current_user_id(),case when p_resolved then 'Question resolved' else 'Question reopened' end,jsonb_build_object('question_id',p_id));end $$;

create function public.renew_record(p_id uuid,p_expiry date,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.records;
begin select * into r from public.records where id=p_id and module in ('renewals','software') for update;
 if r.id is null or not private.permitted(r.module,'edit',r.owner_id) or r.version is distinct from p_version or p_expiry<=(r.data->>'expiry_date')::date then raise exception 'Invalid renewal';end if;
 update public.records set data=data||jsonb_build_object('expiry_date',p_expiry,'start_date',r.data->>'expiry_date','snoozed_until',null,'renewal_history',coalesce(data->'renewal_history','[]')||jsonb_build_array(jsonb_build_object('old_expiry',data->>'expiry_date','new_expiry',p_expiry,'renewed_at',now(),'actor',private.current_user_id()))),status='Active',version=version+1,updated_at=now() where id=p_id;
end $$;
create function public.snooze_record(p_id uuid,p_until date) returns void language plpgsql security definer set search_path='' as $$
declare r public.records;
begin select * into r from public.records where id=p_id for update;if r.id is null or not private.permitted(r.module,'edit',r.owner_id) or p_until<=current_date then raise exception 'Invalid snooze';end if;
 update public.records set data=data||jsonb_build_object('snoozed_until',p_until),version=version+1,updated_at=now() where id=p_id;end $$;

-- RLS applies to every exposed table. Mutation functions above recheck access inside their transactions.
do $$declare t text;begin
 foreach t in array array['profiles','permission_grants','records','record_shares','history','questions','attachments','settings','leave_policies','leave_ledger','stock_movements','payments','notification_preferences','notifications','push_subscriptions','scheduler_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from techly_anon, techly_user',t);
  execute format('grant select on public.%I to techly_user',t);
 end loop;
end $$;
revoke all on all sequences in schema public from techly_anon,techly_user;
create policy profiles_read on public.profiles for select to techly_user using(id=private.current_user_id() or private.is_admin() or manager_id=private.current_user_id());
create policy grants_read on public.permission_grants for select to techly_user using(user_id=private.current_user_id() or private.is_admin() or role=(select p.role from public.profiles p where p.id=private.current_user_id()));
create policy records_read on public.records for select to techly_user using(private.visible(id));
create policy shares_read on public.record_shares for select to techly_user using(private.visible(record_id));
create policy history_read on public.history for select to techly_user using(private.is_admin() or private.visible(record_id));
create policy questions_read on public.questions for select to techly_user using(private.visible(record_id));
create policy attachments_read on public.attachments for select to techly_user using(private.visible(record_id));
create policy settings_read on public.settings for select to techly_user using(exists(select 1 from public.profiles where id=private.current_user_id() and active));
create policy leave_policy_read on public.leave_policies for select to techly_user using(exists(select 1 from public.profiles where id=private.current_user_id() and active));
create policy leave_ledger_read on public.leave_ledger for select to techly_user using(private.permitted('leave','view',user_id));
create policy stock_read on public.stock_movements for select to techly_user using(private.visible(item_id));
create policy payments_read on public.payments for select to techly_user using(private.visible(record_id));
create policy preferences_read on public.notification_preferences for select to techly_user using(user_id=private.current_user_id());
create policy notifications_read on public.notifications for select to techly_user using(user_id=private.current_user_id() and exists(select 1 from public.profiles where id=private.current_user_id() and active));
create policy subscriptions_read on public.push_subscriptions for select to techly_user using(user_id=private.current_user_id());
create policy scheduler_read on public.scheduler_runs for select to techly_user using(private.is_admin());

create function public.attach_file(p_record uuid,p_path text,p_name text,p_mime text,p_size bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.records; aid uuid;
begin select * into r from public.records where id=p_record;
 if not private.visible(p_record) or not private.permitted(r.module,'upload',r.owner_id) or p_path not like private.current_user_id()::text||'/'||p_record::text||'/%' then raise exception 'Permission denied';end if;
 if not exists(select 1 from private.stored_files where path=p_path and record_id=p_record and uploaded_by=private.current_user_id() and mime=p_mime and size=p_size) then raise exception 'Upload not found';end if;
 if p_mime not in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','audio/mpeg','audio/wav') then raise exception 'Unsupported file format';end if;
 insert into public.attachments(record_id,uploaded_by,path,name,mime,size) values(p_record,private.current_user_id(),p_path,p_name,p_mime,p_size) returning id into aid;
 insert into public.history(record_id,actor_id,action,snapshot) values(p_record,private.current_user_id(),'Attachment uploaded',jsonb_build_object('attachment_id',aid,'name',p_name));
 return aid;end $$;
create function public.update_preferences(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.profiles where id=private.current_user_id() and active) then raise exception 'Permission denied';end if;
 insert into public.notification_preferences(user_id,data) values(private.current_user_id(),p_data) on conflict(user_id) do update set data=excluded.data;end $$;
create function public.read_notifications(p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin update public.notifications set read_at=now() where id=any(p_ids) and user_id=private.current_user_id();end $$;
create function public.subscribe_push(p_endpoint text,p_keys jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not exists(select 1 from public.profiles where id=private.current_user_id() and active) then raise exception 'Permission denied';end if;
 if p_endpoint!~'^https://([a-zA-Z0-9-]+\.)*(push\.services\.mozilla\.com|fcm\.googleapis\.com|web\.push\.apple\.com|notify\.windows\.com)/' then raise exception 'Unsupported push endpoint';end if;
 insert into public.push_subscriptions(user_id,endpoint,keys) values(private.current_user_id(),p_endpoint,p_keys) on conflict(endpoint) do update set user_id=excluded.user_id,keys=excluded.keys;end $$;
create function public.update_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_data)<>'object' or not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then raise exception 'Invalid company timezone';end if;
 perform (p_data->>'office_start')::time;perform (p_data->>'office_end')::time;perform (p_data->>'attendance_reminder')::time;perform (p_data->>'eod_reminder')::time;perform (p_data->>'eod_deadline')::time;
 if (p_data->>'grace_minutes')::numeric not between 0 and 180 or (p_data->>'geofence_radius')::numeric not between 10 and 50000 or (p_data->>'renewal_days')::integer not between 1 and 365 then raise exception 'Invalid company policy';end if;
 update public.settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Company policy updated',p_data);
end $$;
create function public.set_permission(p_user uuid,p_role text,p_module text,p_action text,p_scope text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 insert into public.permission_grants(user_id,role,module,action,scope) values(p_user,p_role,p_module,p_action,p_scope) on conflict(user_id,role,module,action) do update set scope=excluded.scope;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Permission updated',jsonb_build_object('user_id',p_user,'role',p_role,'module',p_module,'action',p_action,'scope',p_scope));
end $$;
create function public.set_profile(p_id uuid,p_name text,p_department text,p_manager uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 perform pg_advisory_xact_lock(9282731);
 if exists(select 1 from public.profiles where id=p_id and role='super_admin' and active) and (p_role<>'super_admin' or not p_active) and (select count(*) from public.profiles where role='super_admin' and active)<2 then raise exception 'Keep at least one active Super Admin';end if;
 if p_id=p_manager then raise exception 'Manager cannot report to themselves';end if;
 if p_manager is not null and not exists(select 1 from public.profiles where id=p_manager and active and role in ('manager','super_admin')) then raise exception 'Select an active manager';end if;
 if exists(with recursive chain as (select id,manager_id,array[id] path from public.profiles where id=p_manager union all select p.id,p.manager_id,c.path||p.id from public.profiles p join chain c on c.manager_id=p.id where not p.id=any(c.path)) select 1 from chain where id=p_id) then raise exception 'Reporting relationships cannot form a cycle';end if;
 update public.profiles set full_name=p_name,department=p_department,manager_id=p_manager,role=p_role,active=p_active where id=p_id;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'User account updated',jsonb_build_object('user_id',p_id,'full_name',p_name,'department',p_department,'manager_id',p_manager,'role',p_role,'active',p_active));
end $$;

-- Service-only APIs for provisioning, rate limiting, and scheduler. Never grant these to techly_user.
create function public.login_rate_limit(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare a integer;
begin insert into private.login_attempts(key) values(p_key) on conflict(key) do update set attempts=case when private.login_attempts.window_start<now()-interval '15 minutes' then 1 else private.login_attempts.attempts+1 end,window_start=case when private.login_attempts.window_start<now()-interval '15 minutes' then now() else private.login_attempts.window_start end returning attempts into a;
 return a<=5;end $$;
create function public.clear_login_limits(p_keys text[]) returns void language sql security definer set search_path='' as $$delete from private.login_attempts where key=any(p_keys);$$;
create function public.finish_password_change(p_user uuid) returns void language sql security definer set search_path='' as $$ update public.profiles set must_change_password=false where id=p_user; $$;

-- Revoke default PUBLIC function execution, then explicitly grant required APIs.
revoke all on all functions in schema private from public, techly_anon, techly_user;
grant execute on function private.current_user_id(),private.is_admin(),private.permitted(text,text,uuid),private.visible(uuid) to techly_user;
revoke all on all functions in schema public from public, techly_anon, techly_user;
grant execute on function public.save_record(text,text,jsonb,uuid,uuid,integer,text),public.workflow(uuid,text,integer,text),public.clock_attendance(text,double precision,double precision,double precision,boolean),public.stock_transaction(uuid,text,integer,uuid,text,text,text),public.record_payment(uuid,numeric,text,text,text),public.receive_purchase(uuid,integer),public.record_question(uuid,text,uuid),public.resolve_question(uuid,boolean),public.renew_record(uuid,date,integer),public.snooze_record(uuid,date),public.attach_file(uuid,text,text,text,bigint),public.update_preferences(jsonb),public.read_notifications(uuid[]),public.subscribe_push(text,jsonb),public.update_settings(jsonb),public.set_permission(uuid,text,text,text,text),public.set_profile(uuid,text,text,uuid,text,boolean) to techly_user;
grant execute on function public.login_rate_limit(text),public.clear_login_limits(text[]),public.finish_password_change(uuid) to techly_service;
grant all on all tables in schema public to techly_service;
grant usage,select on all sequences in schema public to techly_service;
commit;
