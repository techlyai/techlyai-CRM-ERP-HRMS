-- Migration 003: smart reminders, notification centre, employee chat,
-- automatic employee IDs and email delivery. Applied by scripts/setup-database.ts.
begin;

-- ---------------------------------------------------------------------------
-- Profiles: email address and mirrored employee ID
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists employee_id text;
create unique index if not exists profiles_email_unique on public.profiles(lower(email)) where email is not null;
create unique index if not exists profiles_employee_id_unique on public.profiles(employee_id) where employee_id is not null;

-- ---------------------------------------------------------------------------
-- Notifications: priority, deep link and structured metadata
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists priority text not null default 'Medium' check(priority in ('Low','Medium','High','Urgent'));
alter table public.notifications add column if not exists link text;
alter table public.notifications add column if not exists meta jsonb not null default '{}';
create index if not exists notifications_user_unread_idx on public.notifications(user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Company settings defaults for the new features
-- ---------------------------------------------------------------------------
update public.settings set data=data||jsonb_strip_nulls(jsonb_build_object(
 'reminder_yearly_advance_months',coalesce(data->'reminder_yearly_advance_months',to_jsonb(1)),
 'reminder_monthly_advance_days',coalesce(data->'reminder_monthly_advance_days',to_jsonb(14)),
 'reminder_repeat_daily',coalesce(data->'reminder_repeat_daily',to_jsonb(true)),
 'reminder_default_recurrence',coalesce(data->'reminder_default_recurrence',to_jsonb('none'::text)),
 'reminder_snooze_options',coalesce(data->'reminder_snooze_options','[10,30,60,1440,10080]'::jsonb),
 'reminder_escalate_days',coalesce(data->'reminder_escalate_days',to_jsonb(3)),
 'notification_channels',coalesce(data->'notification_channels','{"in_app":true,"sound":true,"push":true,"email":true}'::jsonb),
 'sounds',coalesce(data->'sounds','{"default":"builtin:chime","categories":{}}'::jsonb),
 'chat',coalesce(data->'chat','{"group_creation":"managers","direct_messages":"everyone","edit_minutes":15,"admin_review":false}'::jsonb)
)) where id=1;

-- ---------------------------------------------------------------------------
-- Email configuration, templates and delivery log
-- ---------------------------------------------------------------------------
create table public.email_settings(id integer primary key check(id=1),data jsonb not null);
insert into public.email_settings values(1,'{"provider":"resend","sender_name":"Techly","sender_email":"","company_name":"Techly","support_contact":"","retry_limit":5,"events":{"welcome":true,"employee_id":true,"reminders":true,"eod":true,"questions":true,"approvals":true,"renewals":true,"payments":true,"tasks":true,"chat":false},"templates":{}}'::jsonb);
create table public.email_log(
 id uuid primary key default gen_random_uuid(), event text not null, user_id uuid references public.profiles(id),
 recipient text not null, subject text not null, body text not null, record_id uuid references public.records(id),
 status text not null default 'queued' check(status in ('queued','accepted','failed','skipped')),
 provider text, provider_id text, error text, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), sent_at timestamptz, created_at timestamptz not null default now(),
 event_key text unique
);
create index email_log_status_idx on public.email_log(status,next_attempt_at);
create index email_log_user_idx on public.email_log(user_id,created_at desc);
create table private.invites(token_hash text primary key,user_id uuid not null references private.accounts(id) on delete cascade,expires_at timestamptz not null,used_at timestamptz,created_at timestamptz not null default now());
alter table private.invites enable row level security;
grant select,insert,update,delete on private.invites to techly_service;

create function private.render_template(tpl text, vars jsonb) returns text language sql immutable set search_path='' as $$
 select (select coalesce(string_agg(case when m[1] is not null then coalesce(vars->>m[1],'') else m[2] end,'' order by ord),'')
  from regexp_matches(tpl,'\{\{\s*([a-z_]+)\s*\}\}|([^{]+|\{)','g') with ordinality as t(m,ord));
$$;

create function private.queue_email(p_event text,p_user uuid,p_subject text,p_body text,p_record uuid,p_vars jsonb default '{}',p_key text default null) returns void language plpgsql security definer set search_path='' as $$
declare es jsonb; p public.profiles; tpl jsonb; subj text; bod text; vars jsonb; recipient text;
begin
 select data into es from public.email_settings where id=1;
 if es is null or coalesce((es->'events'->>p_event)::boolean,false) is not true then return; end if;
 if not coalesce(((select data from public.settings where id=1)->'notification_channels'->>'email')::boolean,true) then return; end if;
 if p_user is not null then select * into p from public.profiles where id=p_user and active; if p.id is null then return; end if; recipient:=p.email; end if;
 recipient:=coalesce(p_vars->>'recipient',recipient);
 if recipient is null or recipient='' then return; end if;
 vars:=jsonb_build_object('name',coalesce(p.full_name,''),'company',coalesce(es->>'company_name','Techly'),'subject',p_subject,'body',p_body,'support',coalesce(es->>'support_contact',''))||p_vars;
 tpl:=es->'templates'->p_event;
 subj:=case when tpl->>'subject' is not null and tpl->>'subject'<>'' then private.render_template(tpl->>'subject',vars) else p_subject end;
 bod:=case when tpl->>'body' is not null and tpl->>'body'<>'' then private.render_template(tpl->>'body',vars) else p_body end;
 insert into public.email_log(event,user_id,recipient,subject,body,record_id,event_key) values(p_event,p_user,recipient,subj,bod,p_record,p_key) on conflict(event_key) do nothing;
end $$;

create function public.claim_email_jobs(p_limit integer default 20) returns setof public.email_log language sql security definer set search_path='' as $$
 with claim as (select id from public.email_log where status='queued' and next_attempt_at<=now() order by created_at for update skip locked limit least(p_limit,50))
 update public.email_log e set attempts=attempts+1,next_attempt_at=now()+interval '10 minutes' where e.id in(select id from claim) returning e.*;
$$;
create function public.finish_email_job(p_id uuid,p_status text,p_provider text,p_provider_id text,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare lim integer; a integer;
begin
 select coalesce((data->>'retry_limit')::integer,5) into lim from public.email_settings where id=1;
 select attempts into a from public.email_log where id=p_id;
 update public.email_log set status=case when p_status='accepted' then 'accepted' when p_status='skipped' then 'skipped' when a>=lim then 'failed' else 'queued' end,
  provider=p_provider,provider_id=p_provider_id,error=p_error,sent_at=case when p_status='accepted' then now() else sent_at end,
  next_attempt_at=now()+make_interval(mins=>least(240,5*power(2,a))::integer) where id=p_id;
end $$;
create function public.update_email_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'events')<>'object' or jsonb_typeof(p_data->'templates')<>'object' then raise exception 'Invalid email settings';end if;
 if coalesce(p_data->>'sender_email','')<>'' and p_data->>'sender_email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid sender email';end if;
 update public.email_settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Email settings updated',p_data-'templates');
end $$;
create function public.retry_email(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 update public.email_log set status='queued',next_attempt_at=now(),attempts=0,error=null where id=p_id and status='failed';
end $$;
create function public.set_profile_email(p_id uuid,p_email text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() and p_id<>private.current_user_id() then raise exception 'Permission denied';end if;
 if p_email is not null and p_email<>'' and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address';end if;
 update public.profiles set email=nullif(lower(trim(p_email)),'') where id=p_id;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Email address updated',jsonb_build_object('user_id',p_id));
end $$;

-- ---------------------------------------------------------------------------
-- Notification helpers: richer notify, upsert variant for chat, email hook
-- ---------------------------------------------------------------------------
create function private.notify(uid uuid,category text,title text,body text,rid uuid,event text,priority text,link text,meta jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare nid uuid; r public.records; ch jsonb;
begin
 if uid is null then return; end if;
 if not exists(select 1 from public.profiles where id=uid and active) then return;end if;
 if rid is not null then
  select * into r from public.records where id=rid;
  if r.id is not null and not private.permitted_for(uid,r.module,'view',r.owner_id) then return;end if;
 end if;
 select data->'notification_channels' into ch from public.settings where id=1;
 insert into public.notifications(user_id,category,title,body,record_id,event_key,priority,link,meta) values(uid,category,title,body,rid,event,coalesce(priority,'Medium'),coalesce(link,case when r.id is not null then '/modules/'||r.module||'/'||r.id end),coalesce(meta,'{}'))
 on conflict(user_id,event_key) do nothing returning id into nid;
 if nid is not null then
  if coalesce((ch->>'push')::boolean,true) then insert into private.push_outbox(notification_id) values(nid); end if;
  perform private.queue_email(case when category like 'reminder-%' then 'reminders' else category end,uid,title,body,rid,jsonb_build_object('link',coalesce(link,case when r.id is not null then '/modules/'||r.module||'/'||r.id end,'/notifications'),'priority',coalesce(priority,'Medium')),'notification:'||nid);
 end if;
end $$;
create or replace function private.notify(uid uuid,category text,title text,body text,rid uuid,event text) returns void language sql security definer set search_path='' as $$
 select private.notify(uid,category,title,body,rid,event,'Medium',null,'{}'::jsonb);
$$;
-- Re-surfaces one live notification per conversation instead of one per message.
create function private.notify_upsert(uid uuid,category text,title text,body text,event text,priority text,link text,meta jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare nid uuid; ch jsonb;
begin
 if uid is null or not exists(select 1 from public.profiles where id=uid and active) then return;end if;
 select data->'notification_channels' into ch from public.settings where id=1;
 insert into public.notifications(user_id,category,title,body,event_key,priority,link,meta) values(uid,category,title,body,event,coalesce(priority,'Medium'),link,coalesce(meta,'{}'))
 on conflict(user_id,event_key) do update set title=excluded.title,body=excluded.body,read_at=null,created_at=now(),meta=excluded.meta returning id into nid;
 if coalesce((ch->>'push')::boolean,true) then
  insert into private.push_outbox(notification_id) values(nid) on conflict(notification_id) do update set status='pending',attempts=0,available_at=now(),error=null where private.push_outbox.status<>'processing';
 end if;
end $$;

-- Richer reviewer notifications for submissions (EOD reports name the employee and project).
create or replace function private.notify_reviewers(r public.records,event text) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; owner public.profiles; ttl text; bdy text; cat text; proj text; pr text;
begin
 select * into owner from public.profiles where id=r.owner_id;
 if r.module='eod' then
  select x.title into proj from public.records x where x.id=nullif(r.data->>'project_id','')::uuid;
  ttl:='New EOD report submitted · '||coalesce(owner.full_name,'Employee')||coalesce(' · '||proj,'');
  bdy:='Report for '||coalesce(r.data->>'report_date',r.title)||' is ready for review.';
  cat:='eod'; pr:='High';
 else
  ttl:=r.title||' · '||r.status; bdy:=coalesce(owner.full_name,'An employee')||' submitted a '||r.module||' record for your review.'; cat:='approvals'; pr:='Medium';
 end if;
 for p in select * from public.profiles where active and id<>private.current_user_id() and (role='super_admin' or id=owner.manager_id) loop
  perform private.notify(p.id,cat,ttl,bdy,r.id,event,pr,'/modules/'||r.module||'/'||r.id,jsonb_build_object('employee',owner.full_name,'project',proj,'module',r.module,'submitted_at',now()));
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Employee ID configuration and concurrency-safe sequences
-- ---------------------------------------------------------------------------
create table public.employee_id_settings(id integer primary key check(id=1),data jsonb not null);
insert into public.employee_id_settings values(1,'{"prefix":"TECH-EMP","include_department":false,"branch_code":"","include_year":false,"separator":"-","digits":3,"start":1,"scope":"global","reset":"never","allow_manual":true,"welcome_email":true}'::jsonb);
create table public.employee_id_sequences(key text primary key,next_value bigint not null,updated_at timestamptz not null default now());
create function private.department_code(dept text) returns text language sql immutable set search_path='' as $$
 select upper(left(regexp_replace(coalesce(dept,''),'[^A-Za-z]','','g'),3));
$$;
create function private.employee_sequence_key(cfg jsonb,dept text) returns text language sql immutable set search_path='' as $$
 select concat_ws(':',case when cfg->>'scope'='department' then private.department_code(dept) else 'global' end,case when cfg->>'reset'='yearly' then to_char(now(),'YYYY') else 'all' end);
$$;
create function private.format_employee_id(cfg jsonb,dept text,n bigint) returns text language plpgsql immutable set search_path='' as $$
declare parts text[]:=array[]::text[]; sep text:=coalesce(cfg->>'separator','-'); digits integer:=greatest(1,least(8,coalesce((cfg->>'digits')::integer,3)));
begin
 if coalesce(cfg->>'prefix','')<>'' then parts:=parts||(cfg->>'prefix'); end if;
 if coalesce((cfg->>'include_department')::boolean,false) and private.department_code(dept)<>'' then parts:=parts||private.department_code(dept); end if;
 if coalesce(cfg->>'branch_code','')<>'' then parts:=parts||(cfg->>'branch_code'); end if;
 if coalesce((cfg->>'include_year')::boolean,false) then parts:=parts||to_char(now(),'YYYY'); end if;
 parts:=parts||lpad(n::text,digits,'0');
 return array_to_string(parts,sep);
end $$;
create function public.employee_id_preview(p_department text default null) returns text language plpgsql stable security definer set search_path='' as $$
declare cfg jsonb; n bigint;
begin
 if not private.permitted('employees','create',private.current_user_id()) and not private.is_admin() then raise exception 'Permission denied';end if;
 select data into cfg from public.employee_id_settings where id=1;
 select next_value into n from public.employee_id_sequences where key=private.employee_sequence_key(cfg,p_department);
 return private.format_employee_id(cfg,p_department,coalesce(n,greatest(1,coalesce((cfg->>'start')::bigint,1))));
end $$;
create function private.next_employee_id(p_department text) returns text language plpgsql security definer set search_path='' as $$
declare cfg jsonb; k text; n bigint; candidate text; attempts integer:=0;
begin
 select data into cfg from public.employee_id_settings where id=1;
 k:=private.employee_sequence_key(cfg,p_department);
 insert into public.employee_id_sequences(key,next_value) values(k,greatest(1,coalesce((cfg->>'start')::bigint,1))) on conflict(key) do nothing;
 select next_value into n from public.employee_id_sequences where key=k for update;
 loop
  candidate:=private.format_employee_id(cfg,p_department,n);
  n:=n+1; attempts:=attempts+1;
  exit when not exists(select 1 from public.records where module='employees' and data->>'employee_id'=candidate) and not exists(select 1 from public.profiles where employee_id=candidate);
  if attempts>10000 then raise exception 'Employee ID sequence exhausted';end if;
 end loop;
 update public.employee_id_sequences set next_value=n,updated_at=now() where key=k;
 return candidate;
end $$;
create function public.update_employee_id_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 if jsonb_typeof(p_data)<>'object' or coalesce((p_data->>'digits')::integer,0) not between 1 and 8 or coalesce((p_data->>'start')::bigint,0)<1 or p_data->>'scope' not in ('global','department') or p_data->>'reset' not in ('never','yearly') or length(coalesce(p_data->>'separator',''))>3 or length(coalesce(p_data->>'prefix',''))>20 or length(coalesce(p_data->>'branch_code',''))>10 then raise exception 'Invalid employee ID format';end if;
 if coalesce(p_data->>'prefix','')||coalesce(p_data->>'branch_code','') !~ '^[A-Za-z0-9/_-]*$' then raise exception 'Use letters, numbers, / _ or - in codes';end if;
 update public.employee_id_settings set data=p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Employee ID format updated',p_data);
end $$;

-- save_record: generate employee IDs on the server, audit manual changes, mirror to the profile.
create or replace function public.save_record(p_module text,p_title text,p_data jsonb,p_owner uuid,p_id uuid default null,p_version integer default null,p_status text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.records; initial text; actor uuid:=private.current_user_id(); idcfg jsonb;
begin
 if actor is null or not private.permitted(p_module,case when p_id is null then 'create' else 'edit' end,p_owner) then raise exception 'Permission denied' using errcode='42501'; end if;
 if p_module='attendance' then raise exception 'Use attendance clock actions'; end if;
 if p_module='employees' and p_id is null then
  select data into idcfg from public.employee_id_settings where id=1;
  if coalesce(trim(p_data->>'employee_id'),'')='' then p_data:=p_data||jsonb_build_object('employee_id',private.next_employee_id(p_data->>'department'));
  elsif not private.is_admin() or not coalesce((idcfg->>'allow_manual')::boolean,true) then raise exception 'Employee IDs are generated automatically. Leave the field blank.';
  elsif exists(select 1 from public.profiles where employee_id=trim(p_data->>'employee_id')) then raise exception 'Employee ID already in use';
  end if;
 end if;
 perform private.validate_record_data(p_module,p_data);
 if p_data ?| array['available','allocated','damaged','paid_amount','clock_in','clock_out','lat','lng','date','leave_days','snoozed_until','renewal_history','received_at'] and p_module not in ('corrections') then raise exception 'System fields cannot be edited'; end if;
 if p_module='corrections' and (p_data ?| array['available','allocated','damaged','paid_amount','lat','lng','date','leave_days','snoozed_until','renewal_history','received_at']) then raise exception 'Invalid correction';end if;
 initial:=case p_module when 'leads' then 'New Lead' when 'tasks' then 'To Do' when 'eod' then 'Draft' when 'leave' then 'Draft' when 'expenses' then 'Draft' when 'purchases' then 'Draft' when 'corrections' then 'Draft' when 'maintenance' then 'Draft' when 'onboarding' then 'Applied' when 'credit' then 'Open' when 'payroll' then 'Draft' else 'Active' end;
 if p_id is null then
  if p_module='leave' and (p_data->>'start_date')::date>(p_data->>'end_date')::date then raise exception 'Invalid leave dates';end if;
  if p_module='inventory' then p_data:=p_data||'{"available":0,"allocated":0,"damaged":0}';end if;
  insert into public.records(module,title,status,owner_id,created_by,data) values(p_module,p_title,initial,p_owner,actor,p_data) returning id into p_id;
  if p_module='employees' then
   update public.profiles set employee_id=p_data->>'employee_id' where id=p_owner and employee_id is null;
   insert into public.history(record_id,actor_id,action,snapshot) values(p_id,actor,'Employee ID assigned',jsonb_build_object('employee_id',p_data->>'employee_id','generated',coalesce(trim(p_data->>'employee_id'),'')<>''));
   perform private.queue_email('employee_id',p_owner,'Your Techly employee ID','Your employee ID is '||(p_data->>'employee_id')||'. It appears on your profile, attendance and HR records.',p_id,jsonb_build_object('employee_id',p_data->>'employee_id'),'employee-id:'||p_id);
  end if;
 else
  select * into r from public.records where id=p_id for update;
  if r.id is null or r.module<>p_module or r.version is distinct from p_version then raise exception 'Record changed. Refresh and try again.';end if;
  if not private.permitted(r.module,'edit',r.owner_id) or (r.owner_id<>p_owner and not private.is_admin()) then raise exception 'Permission denied';end if;
  if r.module='employees' and p_data->>'employee_id' is distinct from r.data->>'employee_id' then
   if not private.is_admin() then raise exception 'Only an Admin can change an employee ID';end if;
   if coalesce(trim(p_data->>'employee_id'),'')='' then p_data:=p_data||jsonb_build_object('employee_id',r.data->>'employee_id');
   else
    if exists(select 1 from public.profiles where employee_id=trim(p_data->>'employee_id') and id<>r.owner_id) then raise exception 'Employee ID already in use';end if;
    insert into public.history(record_id,actor_id,action,snapshot) values(r.id,actor,'Employee ID changed',jsonb_build_object('from',r.data->>'employee_id','to',p_data->>'employee_id'));
    update public.profiles set employee_id=p_data->>'employee_id' where id=r.owner_id;
   end if;
  end if;
  if r.module in ('eod','leave','expenses','purchases','maintenance','corrections','payroll') and r.status not in ('Draft','Clarification Required','Rejected') then raise exception 'Submitted records must be reviewed before editing';end if;
  if r.module='credit' and exists(select 1 from public.payments where record_id=r.id) and ((p_data->>'amount')::numeric is distinct from (r.data->>'amount')::numeric or p_data->>'vendor' is distinct from r.data->>'vendor' or p_data->>'purchase_id' is distinct from r.data->>'purchase_id' or p_data->>'credit_date' is distinct from r.data->>'credit_date') then raise exception 'Original credit amount, creditor, and purchase reference cannot change after payments';end if;
  if p_status is not null and p_status<>r.status then
   if not exists(select 1 from private.module_contracts c where c.module=p_module and (c.definition->'statuses') @> to_jsonb(p_status)) then raise exception 'Invalid status';end if;
   if r.module not in ('leads','tasks','projects','employees','onboarding','assets','inventory','vendors','clients') then raise exception 'Use workflow actions to change status';end if;
  end if;
  update public.records set title=p_title,owner_id=p_owner,data=p_data||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r.data) where key in ('available','allocated','damaged','paid_amount','snoozed_until','renewal_history','received_at')),status=coalesce(p_status,r.status),version=version+1,updated_at=now() where id=p_id;
  if r.module='projects' and p_data->'team' is distinct from r.data->'team' then
   perform private.notify(m::uuid,'projects','Project update · '||p_title,'You were added to the project team.',p_id,'project-team:'||p_id||':'||m,'Medium','/modules/projects/'||p_id)
   from jsonb_array_elements_text(coalesce(p_data->'team','[]')) m where not coalesce(r.data->'team','[]') @> to_jsonb(m) and m<>actor::text;
  end if;
 end if;
 return p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create table public.reminders(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id), created_by uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 200), description text not null default '' check(length(description)<=5000),
 category text not null default 'General', priority text not null default 'Medium' check(priority in ('Low','Medium','High','Urgent')),
 recurrence text not null default 'none' check(recurrence in ('none','daily','weekly','monthly','yearly','custom')), custom_interval_days integer check(custom_interval_days is null or custom_interval_days between 1 and 3660),
 due_at timestamptz not null, anchor_day integer not null default 1, advance_amount integer not null default 0 check(advance_amount between 0 and 10000), advance_unit text not null default 'days' check(advance_unit in ('minutes','hours','days','weeks','months')),
 alert_at timestamptz not null, status text not null default 'Pending' check(status in ('Pending','Completed','Cancelled')),
 snoozed_until timestamptz, last_alert_at timestamptz, completed_at timestamptz, completed_count integer not null default 0,
 record_id uuid references public.records(id), version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index reminders_owner_idx on public.reminders(owner_id,status,due_at);
create index reminders_due_idx on public.reminders(alert_at) where status='Pending';
create table public.reminder_occurrences(
 id uuid primary key default gen_random_uuid(), reminder_id uuid not null references public.reminders(id) on delete cascade,
 due_at timestamptz not null, alert_at timestamptz not null, status text not null default 'scheduled' check(status in ('scheduled','alerted','completed','skipped')),
 alerted_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), unique(reminder_id,due_at)
);
create function private.reminder_alert_at(due timestamptz,recurrence text,adv integer,unit text) returns timestamptz language plpgsql stable set search_path='' as $$
declare s jsonb;
begin
 select data into s from public.settings where id=1;
 if adv>0 then
  return due - case unit when 'minutes' then make_interval(mins=>adv) when 'hours' then make_interval(hours=>adv) when 'days' then make_interval(days=>adv) when 'weeks' then make_interval(weeks=>adv) else make_interval(months=>adv) end;
 end if;
 if recurrence='yearly' then return due - make_interval(months=>coalesce((s->>'reminder_yearly_advance_months')::integer,1)); end if;
 if recurrence='monthly' then return due - make_interval(days=>coalesce((s->>'reminder_monthly_advance_days')::integer,14)); end if;
 return due;
end $$;
-- Next occurrence keeps the original day-of-month so 31st reminders do not drift after short months.
create function private.reminder_next_due(due timestamptz,recurrence text,custom_days integer,anchor integer,tz text) returns timestamptz language plpgsql immutable set search_path='' as $$
declare l timestamp; first_of_month timestamp; last_day integer; t time;
begin
 l:=due at time zone tz; t:=l::time;
 if recurrence='daily' then return (l+interval '1 day') at time zone tz; end if;
 if recurrence='weekly' then return (l+interval '7 days') at time zone tz; end if;
 if recurrence='custom' then return (l+make_interval(days=>greatest(1,coalesce(custom_days,1)))) at time zone tz; end if;
 if recurrence='monthly' then first_of_month:=date_trunc('month',l)+interval '1 month';
 elsif recurrence='yearly' then first_of_month:=date_trunc('month',l)+interval '1 year';
 else return null; end if;
 last_day:=extract(day from (first_of_month+interval '1 month'-interval '1 day'))::integer;
 return (first_of_month::date+(least(greatest(anchor,1),last_day)-1)+t) at time zone tz;
end $$;
create function public.save_reminder(p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); r public.reminders; rem_id uuid; owner uuid; due timestamptz; rec text; adv integer; unit text; custom integer; tz text; rid uuid;
begin
 if actor is null then raise exception 'Permission denied';end if;
 select s.data->>'timezone' into tz from public.settings s where s.id=1;
 owner:=coalesce(nullif(p_data->>'owner_id','')::uuid,actor);
 if owner<>actor and not private.is_admin() and not exists(select 1 from public.profiles where id=owner and manager_id=actor) then raise exception 'You can only assign reminders to your reporting team';end if;
 due:=(p_data->>'due_at')::timestamptz; rec:=coalesce(p_data->>'recurrence','none'); adv:=coalesce((p_data->>'advance_amount')::integer,0); unit:=coalesce(p_data->>'advance_unit','days'); custom:=nullif(p_data->>'custom_interval_days','')::integer;
 if due is null then raise exception 'Choose a date and time';end if;
 if rec='custom' and coalesce(custom,0)<1 then raise exception 'Enter the custom interval in days';end if;
 rid:=nullif(p_data->>'record_id','')::uuid;
 if rid is not null and not private.visible(rid) then raise exception 'Linked record is not accessible';end if;
 if p_data->>'id' is null or p_data->>'id'='' then
  insert into public.reminders(owner_id,created_by,title,description,category,priority,recurrence,custom_interval_days,due_at,anchor_day,advance_amount,advance_unit,alert_at,record_id)
  values(owner,actor,trim(p_data->>'title'),coalesce(p_data->>'description',''),coalesce(nullif(p_data->>'category',''),'General'),coalesce(nullif(p_data->>'priority',''),'Medium'),rec,custom,due,extract(day from due at time zone tz)::integer,adv,unit,private.reminder_alert_at(due,rec,adv,unit),rid) returning reminders.id into rem_id;
  insert into public.reminder_occurrences(reminder_id,due_at,alert_at) values(rem_id,due,private.reminder_alert_at(due,rec,adv,unit));
  insert into public.history(actor_id,action,snapshot) values(actor,'Reminder created',jsonb_build_object('reminder_id',rem_id,'title',p_data->>'title','due_at',due));
  if owner<>actor then perform private.notify(owner,'reminder-custom','Reminder assigned · '||trim(p_data->>'title'),'Due '||to_char(due at time zone tz,'DD Mon YYYY HH24:MI'),rid,'reminder-assigned:'||rem_id,coalesce(nullif(p_data->>'priority',''),'Medium'),'/reminders?id='||rem_id);end if;
 else
  rem_id:=(p_data->>'id')::uuid;
  select * into r from public.reminders where reminders.id=rem_id for update;
  if r.id is null or (r.owner_id<>actor and r.created_by<>actor and not private.is_admin()) then raise exception 'Reminder not found';end if;
  if r.version is distinct from (p_data->>'version')::integer then raise exception 'Reminder changed. Refresh and try again.';end if;
  update public.reminders set owner_id=owner,title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),category=coalesce(nullif(p_data->>'category',''),'General'),priority=coalesce(nullif(p_data->>'priority',''),'Medium'),recurrence=rec,custom_interval_days=custom,due_at=due,anchor_day=extract(day from due at time zone tz)::integer,advance_amount=adv,advance_unit=unit,alert_at=private.reminder_alert_at(due,rec,adv,unit),record_id=rid,snoozed_until=null,status=case when r.status='Cancelled' then 'Pending' else r.status end,version=version+1,updated_at=now() where reminders.id=rem_id;
  insert into public.reminder_occurrences(reminder_id,due_at,alert_at) values(rem_id,due,private.reminder_alert_at(due,rec,adv,unit)) on conflict(reminder_id,due_at) do update set alert_at=excluded.alert_at;
  insert into public.history(actor_id,action,snapshot) values(actor,'Reminder updated',jsonb_build_object('reminder_id',rem_id,'due_at',due));
 end if;
 return rem_id;
end $$;
create function public.reminder_action(p_id uuid,p_action text,p_until timestamptz default null,p_version integer default null) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.current_user_id(); r public.reminders; nxt timestamptz; tz text;
begin
 select * into r from public.reminders where id=p_id for update;
 if r.id is null or (r.owner_id<>actor and r.created_by<>actor and not private.is_admin()) then raise exception 'Reminder not found';end if;
 if p_version is not null and r.version<>p_version then raise exception 'Reminder changed. Refresh and try again.';end if;
 select data->>'timezone' into tz from public.settings where id=1;
 if p_action='complete' then
  update public.reminder_occurrences set status='completed',completed_at=now() where reminder_id=r.id and due_at=r.due_at;
  nxt:=private.reminder_next_due(r.due_at,r.recurrence,r.custom_interval_days,r.anchor_day,coalesce(tz,'UTC'));
  if nxt is null then update public.reminders set status='Completed',completed_at=now(),completed_count=completed_count+1,snoozed_until=null,version=version+1,updated_at=now() where id=r.id;
  else
   update public.reminders set due_at=nxt,alert_at=private.reminder_alert_at(nxt,r.recurrence,r.advance_amount,r.advance_unit),completed_count=completed_count+1,snoozed_until=null,last_alert_at=null,version=version+1,updated_at=now() where id=r.id;
   insert into public.reminder_occurrences(reminder_id,due_at,alert_at) values(r.id,nxt,private.reminder_alert_at(nxt,r.recurrence,r.advance_amount,r.advance_unit)) on conflict do nothing;
  end if;
 elsif p_action='cancel' then update public.reminders set status='Cancelled',snoozed_until=null,version=version+1,updated_at=now() where id=r.id;
  update public.reminder_occurrences set status='skipped' where reminder_id=r.id and status='scheduled';
 elsif p_action='reopen' then update public.reminders set status='Pending',completed_at=null,version=version+1,updated_at=now() where id=r.id;
  insert into public.reminder_occurrences(reminder_id,due_at,alert_at) values(r.id,r.due_at,r.alert_at) on conflict(reminder_id,due_at) do update set status='scheduled';
 elsif p_action='snooze' then
  if p_until is null or p_until<=now() then raise exception 'Choose a snooze time in the future';end if;
  update public.reminders set snoozed_until=p_until,version=version+1,updated_at=now() where id=r.id;
 elsif p_action='delete' then
  if r.owner_id<>actor and r.created_by<>actor and not private.is_admin() then raise exception 'Permission denied';end if;
  delete from public.reminders where id=r.id;
 else raise exception 'Invalid reminder action';end if;
 update public.notifications set read_at=coalesce(read_at,now()) where user_id=r.owner_id and event_key like 'reminder:'||r.id||':%' and p_action in ('complete','cancel','delete');
 insert into public.history(actor_id,action,snapshot) values(actor,'Reminder '||p_action,jsonb_build_object('reminder_id',r.id,'title',r.title,'until',p_until));
end $$;
-- Server-side reminder scheduling: runs from the cron tick, independent of any open browser.
create function public.reminders_tick() returns integer language plpgsql security definer set search_path='' as $$
declare s jsonb; r public.reminders; n integer:=0; today date; cat text; title text; body text; key text; tz text; esc integer; mgr uuid; overdue boolean;
begin
 if not pg_try_advisory_xact_lock(9282733) then return 0;end if;
 select data into s from public.settings where id=1; tz:=coalesce(s->>'timezone','UTC'); today:=(now() at time zone tz)::date; esc:=coalesce((s->>'reminder_escalate_days')::integer,0);
 for r in select * from public.reminders where status='Pending' and alert_at<=now() and coalesce(snoozed_until,'-infinity'::timestamptz)<=now() order by alert_at loop
  overdue:=r.due_at<now();
  cat:='reminder-'||case r.recurrence when 'yearly' then 'yearly' when 'monthly' then 'monthly' else 'custom' end;
  key:='reminder:'||r.id||':'||to_char(r.due_at at time zone tz,'YYYY-MM-DD')||':'||case when coalesce((s->>'reminder_repeat_daily')::boolean,true) then today::text else 'once' end||case when r.snoozed_until is not null and r.snoozed_until>r.alert_at then ':s'||to_char(r.snoozed_until,'YYYYMMDDHH24MI') else '' end;
  title:=case when overdue then 'Overdue · ' when r.due_at::date=today then 'Due today · ' else 'Reminder · ' end||r.title;
  body:=case when r.description<>'' then left(r.description,300)||' · ' else '' end||'Due '||to_char(r.due_at at time zone tz,'DD Mon YYYY HH24:MI')||case when r.recurrence<>'none' then ' · repeats '||r.recurrence else '' end;
  perform private.notify(r.owner_id,cat,title,body,r.record_id,key,case when overdue and r.priority in ('Low','Medium') then 'High' else r.priority end,'/reminders?id='||r.id,jsonb_build_object('reminder_id',r.id,'due_at',r.due_at,'recurrence',r.recurrence,'category',r.category,'overdue',overdue));
  if esc>0 and overdue and r.due_at<now()-make_interval(days=>esc) then
   for mgr in select id from public.profiles where active and id<>r.owner_id and (id=(select manager_id from public.profiles where id=r.owner_id) or (role='super_admin' and r.priority in ('High','Urgent'))) loop
    perform private.notify(mgr,'reminder-custom','Escalated reminder · '||r.title,(select full_name from public.profiles where id=r.owner_id)||' has an overdue reminder since '||to_char(r.due_at at time zone tz,'DD Mon YYYY'),r.record_id,'reminder-escalation:'||r.id||':'||today,'High','/reminders?id='||r.id);
   end loop;
  end if;
  update public.reminder_occurrences set status='alerted',alerted_at=coalesce(alerted_at,now()) where reminder_id=r.id and due_at=r.due_at and status='scheduled';
  update public.reminders set last_alert_at=now() where id=r.id;
  n:=n+1;
 end loop;
 return n;
end $$;

-- ---------------------------------------------------------------------------
-- Employee chat
-- ---------------------------------------------------------------------------
create table public.conversations(
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('direct','group')), name text check(name is null or length(name) between 1 and 120),
 department text, project_id uuid references public.records(id), official boolean not null default false, created_by uuid not null references public.profiles(id),
 direct_key text unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_message_at timestamptz
);
create table public.conversation_members(
 conversation_id uuid not null references public.conversations(id) on delete cascade, user_id uuid not null references public.profiles(id), role text not null default 'member' check(role in ('member','admin')),
 muted boolean not null default false, pinned boolean not null default false, last_read_at timestamptz not null default now(), joined_at timestamptz not null default now(), primary key(conversation_id,user_id)
);
create index conversation_members_user_idx on public.conversation_members(user_id);
create table public.messages(
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade, sender_id uuid not null references public.profiles(id),
 body text not null default '' check(length(body)<=10000), reply_to uuid references public.messages(id), attachment_path text, attachment_name text, attachment_mime text, attachment_size bigint,
 pinned boolean not null default false, edited_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(),
 check(body<>'' or attachment_path is not null or deleted_at is not null)
);
create index messages_conversation_idx on public.messages(conversation_id,created_at desc);
create index messages_search_idx on public.messages using gin(to_tsvector('simple',body));
create table public.message_reads(message_id uuid not null references public.messages(id) on delete cascade,user_id uuid not null references public.profiles(id),read_at timestamptz not null default now(),primary key(message_id,user_id));
create table public.presence(user_id uuid primary key references public.profiles(id),last_seen_at timestamptz not null default now(),typing_conversation uuid,typing_at timestamptz);
create table public.message_reports(id uuid primary key default gen_random_uuid(),message_id uuid not null references public.messages(id) on delete cascade,reporter_id uuid not null references public.profiles(id),reason text not null check(length(reason) between 1 and 1000),status text not null default 'open' check(status in ('open','dismissed','actioned')),created_at timestamptz not null default now());

create function private.is_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversation_members where conversation_id=cid and user_id=private.current_user_id());
$$;
create function private.chat_policy() returns jsonb language sql stable set search_path='' as $$ select coalesce(data->'chat','{}'::jsonb) from public.settings where id=1; $$;
-- Admin review is allowed only for official groups, or everywhere when the transparent company policy enables it.
create function private.can_review(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_admin() and exists(select 1 from public.conversations c where c.id=cid and (c.official or coalesce((private.chat_policy()->>'admin_review')::boolean,false)));
$$;
create function private.can_chat_with(target uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare me public.profiles; them public.profiles; pol text;
begin
 select * into me from public.profiles where id=private.current_user_id(); select * into them from public.profiles where id=target and active;
 if me.id is null or them.id is null or me.id=them.id then return false; end if;
 if me.role<>'employee' or them.role<>'employee' then return true; end if;
 pol:=coalesce(private.chat_policy()->>'direct_messages','everyone');
 return pol='everyone' or (pol='team' and (me.manager_id=them.manager_id or me.department is not distinct from them.department));
end $$;
create function public.start_direct_conversation(p_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=private.current_user_id(); k text; cid uuid;
begin
 if not private.can_chat_with(p_user) then raise exception 'Direct messages with this person are not permitted by company policy';end if;
 k:=least(me::text,p_user::text)||':'||greatest(me::text,p_user::text);
 select id into cid from public.conversations where direct_key=k;
 if cid is null then
  insert into public.conversations(kind,created_by,direct_key) values('direct',me,k) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,p_user);
 end if;
 return cid;
end $$;
create function public.create_group(p_name text,p_members uuid[],p_department text default null,p_project uuid default null,p_official boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare me public.profiles; cid uuid; pol text; m uuid;
begin
 select * into me from public.profiles where id=private.current_user_id();
 pol:=coalesce(private.chat_policy()->>'group_creation','managers');
 if not (me.role='super_admin' or (pol='managers' and me.role='manager') or pol='everyone') then raise exception 'Your role cannot create groups';end if;
 if p_official and me.role<>'super_admin' then raise exception 'Only Admins create official groups';end if;
 if p_project is not null and not private.visible(p_project) then raise exception 'Project not accessible';end if;
 insert into public.conversations(kind,name,department,project_id,official,created_by) values('group',trim(p_name),nullif(p_department,''),p_project,p_official,me.id) returning id into cid;
 insert into public.conversation_members(conversation_id,user_id,role) values(cid,me.id,'admin');
 foreach m in array coalesce(p_members,'{}') loop
  if m<>me.id and exists(select 1 from public.profiles where id=m and active) then insert into public.conversation_members(conversation_id,user_id) values(cid,m) on conflict do nothing; end if;
 end loop;
 if p_department is not null and p_department<>'' then insert into public.conversation_members(conversation_id,user_id) select cid,id from public.profiles where active and department=p_department on conflict do nothing; end if;
 if p_project is not null then insert into public.conversation_members(conversation_id,user_id) select cid,x::uuid from public.records r, jsonb_array_elements_text(coalesce(r.data->'team','[]')) x where r.id=p_project and exists(select 1 from public.profiles where id=x::uuid and active) on conflict do nothing;
  insert into public.conversation_members(conversation_id,user_id) select cid,owner_id from public.records where id=p_project on conflict do nothing; end if;
 insert into public.history(actor_id,action,snapshot) values(me.id,'Chat group created',jsonb_build_object('conversation_id',cid,'name',p_name,'official',p_official));
 return cid;
end $$;
create function public.update_group_members(p_conversation uuid,p_add uuid[],p_remove uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=private.current_user_id(); m uuid;
begin
 if not exists(select 1 from public.conversations c where c.id=p_conversation and c.kind='group') then raise exception 'Group not found';end if;
 if not private.is_admin() and not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=me and role='admin') then raise exception 'Only group admins manage members';end if;
 foreach m in array coalesce(p_add,'{}') loop insert into public.conversation_members(conversation_id,user_id) select p_conversation,m where exists(select 1 from public.profiles where id=m and active) on conflict do nothing; end loop;
 foreach m in array coalesce(p_remove,'{}') loop delete from public.conversation_members where conversation_id=p_conversation and user_id=m and user_id<>me; end loop;
 insert into public.history(actor_id,action,snapshot) values(me,'Chat group members updated',jsonb_build_object('conversation_id',p_conversation,'added',p_add,'removed',p_remove));
end $$;
create function public.send_message(p_conversation uuid,p_body text,p_reply_to uuid default null,p_attachment jsonb default null) returns uuid language plpgsql security definer set search_path='' as $$
declare me public.profiles; c public.conversations; mid uuid; m record; preview text;
begin
 select * into me from public.profiles where id=private.current_user_id() and active;
 if me.id is null or not private.is_member(p_conversation) then raise exception 'You are not part of this conversation';end if;
 select * into c from public.conversations where id=p_conversation;
 if p_reply_to is not null and not exists(select 1 from public.messages where id=p_reply_to and conversation_id=p_conversation) then raise exception 'Invalid reply target';end if;
 if p_attachment is not null and not exists(select 1 from private.stored_files f where f.path=p_attachment->>'path' and f.uploaded_by=me.id and f.path like me.id||'/chat/'||p_conversation||'/%') then raise exception 'Attachment not found';end if;
 if coalesce(trim(p_body),'')='' and p_attachment is null then raise exception 'Type a message or add a file';end if;
 insert into public.messages(conversation_id,sender_id,body,reply_to,attachment_path,attachment_name,attachment_mime,attachment_size)
 values(p_conversation,me.id,coalesce(trim(p_body),''),p_reply_to,p_attachment->>'path',p_attachment->>'name',p_attachment->>'mime',(p_attachment->>'size')::bigint) returning id into mid;
 update public.conversations set last_message_at=now(),updated_at=now() where id=p_conversation;
 update public.conversation_members set last_read_at=now() where conversation_id=p_conversation and user_id=me.id;
 insert into public.message_reads(message_id,user_id) values(mid,me.id);
 preview:=case when coalesce(trim(p_body),'')='' then 'Sent an attachment: '||coalesce(p_attachment->>'name','file') else left(trim(p_body),200) end;
 for m in select cm.user_id from public.conversation_members cm where cm.conversation_id=p_conversation and cm.user_id<>me.id and not cm.muted loop
  perform private.notify_upsert(m.user_id,'chat',case when c.kind='group' then me.full_name||' in '||coalesce(c.name,'group') else me.full_name end,preview,'chat:'||p_conversation,'Medium','/chat?c='||p_conversation,jsonb_build_object('conversation_id',p_conversation,'sender',me.full_name,'message_id',mid));
 end loop;
 return mid;
end $$;
create function public.edit_message(p_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; mins integer;
begin select * into m from public.messages where id=p_id for update;
 mins:=coalesce((private.chat_policy()->>'edit_minutes')::integer,15);
 if m.id is null or m.sender_id<>private.current_user_id() or m.deleted_at is not null then raise exception 'You can only edit your own messages';end if;
 if mins>=0 and m.created_at<now()-make_interval(mins=>mins) and not private.is_admin() then raise exception 'Editing window has closed';end if;
 if coalesce(trim(p_body),'')='' then raise exception 'Message cannot be empty';end if;
 update public.messages set body=trim(p_body),edited_at=now() where id=p_id;
end $$;
create function public.delete_message(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; is_group_admin boolean;
begin select * into m from public.messages where id=p_id for update;
 if m.id is null then raise exception 'Message not found';end if;
 is_group_admin:=exists(select 1 from public.conversation_members where conversation_id=m.conversation_id and user_id=private.current_user_id() and role='admin');
 if m.sender_id<>private.current_user_id() and not is_group_admin and not private.can_review(m.conversation_id) then raise exception 'Permission denied';end if;
 update public.messages set deleted_at=now(),body='',attachment_path=null,attachment_name=null,attachment_mime=null,attachment_size=null,pinned=false where id=p_id;
 if m.sender_id<>private.current_user_id() then insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Chat message removed',jsonb_build_object('message_id',p_id,'conversation_id',m.conversation_id)); end if;
end $$;
create function public.pin_message(p_id uuid,p_pinned boolean) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages;
begin select * into m from public.messages where id=p_id; if m.id is null or not private.is_member(m.conversation_id) then raise exception 'Permission denied';end if;
 update public.messages set pinned=p_pinned where id=p_id; end $$;
create function public.set_conversation_prefs(p_conversation uuid,p_muted boolean default null,p_pinned boolean default null) returns void language sql security definer set search_path='' as $$
 update public.conversation_members set muted=coalesce(p_muted,muted),pinned=coalesce(p_pinned,pinned) where conversation_id=p_conversation and user_id=private.current_user_id();
$$;
create function public.mark_conversation_read(p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.conversation_members set last_read_at=now() where conversation_id=p_conversation and user_id=private.current_user_id();
 insert into public.message_reads(message_id,user_id) select id,private.current_user_id() from public.messages where conversation_id=p_conversation and sender_id<>private.current_user_id() on conflict do nothing;
 update public.notifications set read_at=now() where user_id=private.current_user_id() and event_key='chat:'||p_conversation and read_at is null;
end $$;
create function public.heartbeat(p_typing uuid default null) returns void language sql security definer set search_path='' as $$
 insert into public.presence(user_id,last_seen_at,typing_conversation,typing_at) values(private.current_user_id(),now(),p_typing,case when p_typing is null then null else now() end)
 on conflict(user_id) do update set last_seen_at=now(),typing_conversation=excluded.typing_conversation,typing_at=excluded.typing_at;
$$;
create function public.report_message(p_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages; a uuid;
begin select * into m from public.messages where id=p_id; if m.id is null or not private.is_member(m.conversation_id) then raise exception 'Permission denied';end if;
 insert into public.message_reports(message_id,reporter_id,reason) values(p_id,private.current_user_id(),p_reason);
 for a in select id from public.profiles where active and role='super_admin' loop perform private.notify(a,'approvals','Chat message reported','A message was reported for review.',null,'report:'||p_id||':'||a,'High','/chat?c='||m.conversation_id); end loop;
end $$;
create function public.resolve_report(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() then raise exception 'Permission denied';end if;
 update public.message_reports set status=p_status where id=p_id and p_status in ('dismissed','actioned');
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Chat report '||p_status,jsonb_build_object('report_id',p_id)); end $$;
create function public.audit_conversation_access(p_conversation uuid) returns void language plpgsql security definer set search_path='' as $$
begin if private.is_member(p_conversation) then return; end if;
 if not private.can_review(p_conversation) then raise exception 'Permission denied';end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Admin reviewed conversation',jsonb_build_object('conversation_id',p_conversation)); end $$;
create function public.chat_overview() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'department',c.department,'project_id',c.project_id,'official',c.official,'last_message_at',c.last_message_at,'muted',cm.muted,'pinned',cm.pinned,'role',cm.role,
  'members',(select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'role',p.role,'online',coalesce(pr.last_seen_at>now()-interval '2 minutes',false))) from public.conversation_members x join public.profiles p on p.id=x.user_id left join public.presence pr on pr.user_id=p.id where x.conversation_id=c.id),
  'unread',(select count(*) from public.messages m where m.conversation_id=c.id and m.created_at>cm.last_read_at and m.sender_id<>private.current_user_id() and m.deleted_at is null),
  'last',(select jsonb_build_object('body',case when m.deleted_at is not null then 'Message removed' when m.body='' then 'Attachment' else left(m.body,80) end,'sender',p.full_name,'at',m.created_at) from public.messages m join public.profiles p on p.id=m.sender_id where m.conversation_id=c.id order by m.created_at desc limit 1)
 ) order by cm.pinned desc,c.last_message_at desc nulls last,c.created_at desc),'[]')
 from public.conversations c join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=private.current_user_id();
$$;

-- ---------------------------------------------------------------------------
-- Chat attachments: uploads may target a conversation instead of a record
-- ---------------------------------------------------------------------------
alter table private.uploads add column if not exists conversation_id uuid;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.reminders enable row level security;
alter table public.reminder_occurrences enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.presence enable row level security;
alter table public.message_reports enable row level security;
alter table public.email_settings enable row level security;
alter table public.email_log enable row level security;
alter table public.employee_id_settings enable row level security;
alter table public.employee_id_sequences enable row level security;
create policy reminders_read on public.reminders for select to techly_user using(owner_id=private.current_user_id() or created_by=private.current_user_id() or private.is_admin() or exists(select 1 from public.profiles p where p.id=owner_id and p.manager_id=private.current_user_id()));
create policy occurrences_read on public.reminder_occurrences for select to techly_user using(exists(select 1 from public.reminders r where r.id=reminder_id and (r.owner_id=private.current_user_id() or r.created_by=private.current_user_id() or private.is_admin())));
create policy conversations_read on public.conversations for select to techly_user using(private.is_member(id) or private.can_review(id));
create policy members_read on public.conversation_members for select to techly_user using(private.is_member(conversation_id) or private.can_review(conversation_id));
create policy messages_read on public.messages for select to techly_user using(private.is_member(conversation_id) or private.can_review(conversation_id));
create policy reads_read on public.message_reads for select to techly_user using(exists(select 1 from public.messages m where m.id=message_id and private.is_member(m.conversation_id)));
create policy presence_read on public.presence for select to techly_user using(exists(select 1 from public.profiles where id=private.current_user_id() and active));
create policy reports_read on public.message_reports for select to techly_user using(private.is_admin() or reporter_id=private.current_user_id());
create policy email_settings_read on public.email_settings for select to techly_user using(private.is_admin());
create policy email_log_read on public.email_log for select to techly_user using(private.is_admin() or user_id=private.current_user_id());
create policy employee_id_settings_read on public.employee_id_settings for select to techly_user using(exists(select 1 from public.profiles where id=private.current_user_id() and active and role<>'employee'));
create policy employee_id_sequences_read on public.employee_id_sequences for select to techly_user using(private.is_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select on public.reminders,public.reminder_occurrences,public.conversations,public.conversation_members,public.messages,public.message_reads,public.presence,public.message_reports,public.email_settings,public.email_log,public.employee_id_settings,public.employee_id_sequences to techly_user;
grant all on public.reminders,public.reminder_occurrences,public.conversations,public.conversation_members,public.messages,public.message_reads,public.presence,public.message_reports,public.email_settings,public.email_log,public.employee_id_settings,public.employee_id_sequences to techly_service;
revoke all on function private.render_template(text,jsonb),private.queue_email(text,uuid,text,text,uuid,jsonb,text),private.notify(uuid,text,text,text,uuid,text,text,text,jsonb),private.notify_upsert(uuid,text,text,text,text,text,text,jsonb),private.department_code(text),private.employee_sequence_key(jsonb,text),private.format_employee_id(jsonb,text,bigint),private.next_employee_id(text),private.reminder_alert_at(timestamptz,text,integer,text),private.reminder_next_due(timestamptz,text,integer,integer,text),private.chat_policy(),private.can_chat_with(uuid) from public,techly_anon,techly_user;
grant execute on function private.is_member(uuid),private.can_review(uuid) to techly_user;
revoke all on function public.claim_email_jobs(integer),public.finish_email_job(uuid,text,text,text,text),public.reminders_tick(),public.update_email_settings(jsonb),public.retry_email(uuid),public.set_profile_email(uuid,text),public.employee_id_preview(text),public.update_employee_id_settings(jsonb),public.save_reminder(jsonb),public.reminder_action(uuid,text,timestamptz,integer),public.start_direct_conversation(uuid),public.create_group(text,uuid[],text,uuid,boolean),public.update_group_members(uuid,uuid[],uuid[]),public.send_message(uuid,text,uuid,jsonb),public.edit_message(uuid,text),public.delete_message(uuid),public.pin_message(uuid,boolean),public.set_conversation_prefs(uuid,boolean,boolean),public.mark_conversation_read(uuid),public.heartbeat(uuid),public.report_message(uuid,text),public.resolve_report(uuid,text),public.audit_conversation_access(uuid),public.chat_overview() from public,techly_anon,techly_user,techly_service;
grant execute on function public.update_email_settings(jsonb),public.retry_email(uuid),public.set_profile_email(uuid,text),public.employee_id_preview(text),public.update_employee_id_settings(jsonb),public.save_reminder(jsonb),public.reminder_action(uuid,text,timestamptz,integer),public.start_direct_conversation(uuid),public.create_group(text,uuid[],text,uuid,boolean),public.update_group_members(uuid,uuid[],uuid[]),public.send_message(uuid,text,uuid,jsonb),public.edit_message(uuid,text),public.delete_message(uuid),public.pin_message(uuid,boolean),public.set_conversation_prefs(uuid,boolean,boolean),public.mark_conversation_read(uuid),public.heartbeat(uuid),public.report_message(uuid,text),public.resolve_report(uuid,text),public.audit_conversation_access(uuid),public.chat_overview() to techly_user;
grant execute on function public.claim_email_jobs(integer),public.finish_email_job(uuid,text,text,text,text),public.reminders_tick() to techly_service;
grant execute on function public.save_record(text,text,jsonb,uuid,uuid,integer,text) to techly_user;
commit;
