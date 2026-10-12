-- Apply after schema/contracts. Scheduled functions require the server service role.
begin;
create function public.scheduler_tick() returns integer language plpgsql security definer set search_path='' as $$
declare s jsonb; local_now timestamp; d date; dow integer; working boolean; special jsonb; p public.profiles; r public.records; before_count integer; after_count integer; run_id bigint; days integer; manager uuid; pol public.leave_policies; prior numeric; target numeric;
begin
 if not pg_try_advisory_xact_lock(9282732) then return 0;end if;
 delete from private.sessions where expires_at<=now();
 delete from private.uploads where expires_at<=now();
 insert into public.scheduler_runs default values returning id into run_id;
 select data into s from public.settings where id=1;local_now:=now() at time zone(s->>'timezone');d:=local_now::date;dow:=extract(dow from d);
 working:=(s->'working_days') @> to_jsonb(dow) and not (s->'holidays') @> to_jsonb(d::text);
 select value into special from jsonb_array_elements(s->'special_days') where value->>'date'=d::text limit 1;
 if special is not null then working:=(special->>'working')::boolean;end if;
 select count(*) into before_count from public.notifications;
 for p in select * from public.profiles where active loop
  for pol in select * from public.leave_policies where paid and accrual<>'none' loop
   if pol.accrual='annual' then
    if not exists(select 1 from public.leave_ledger where event_key='annual:'||p.id||':'||pol.type||':'||extract(year from d)) then
     select coalesce(sum(amount),0) into prior from public.leave_ledger where user_id=p.id and type=pol.type;
     target:=pol.allocation+least(greatest(prior,0),pol.carry_forward);
     insert into public.leave_ledger(user_id,type,amount,event_key) values(p.id,pol.type,target-prior,'annual:'||p.id||':'||pol.type||':'||extract(year from d)) on conflict(event_key) do nothing;
    end if;
   else
    if not exists(select 1 from public.leave_ledger where event_key='rollover:'||p.id||':'||pol.type||':'||extract(year from d)) then
     select coalesce(sum(amount),0) into prior from public.leave_ledger where user_id=p.id and type=pol.type;
     insert into public.leave_ledger(user_id,type,amount,event_key) values(p.id,pol.type,least(greatest(prior,0),pol.carry_forward)-prior,'rollover:'||p.id||':'||pol.type||':'||extract(year from d)) on conflict(event_key) do nothing;
    end if;
    insert into public.leave_ledger(user_id,type,amount,event_key) values(p.id,pol.type,pol.allocation,'monthly:'||p.id||':'||pol.type||':'||to_char(d,'YYYY-MM')) on conflict(event_key) do nothing;
   end if;
  end loop;
  if working and not exists(select 1 from public.records where module='leave' and owner_id=p.id and status in ('Approved','Cancellation Requested') and (data->>'start_date')::date<=d and (data->>'end_date')::date>=d and data->>'duration'<>'Half Day') then
   if local_now::time>=coalesce(special->>'attendance_reminder',s->>'attendance_reminder')::time and not exists(select 1 from public.records where module='attendance' and owner_id=p.id and data->>'date'=d::text) then
    perform private.notify(p.id,'attendance','Time to clock in','Record your attendance for today.',null,'attendance:'||d);
   end if;
   if local_now::time>=coalesce(special->>'eod_reminder',s->>'eod_reminder')::time and not exists(select 1 from public.records where module='eod' and owner_id=p.id and data->>'report_date'=d::text and status in ('Submitted','Resubmitted','Approved','Clarification Required')) then
    perform private.notify(p.id,'eod','Your daily report is due','Share today’s progress and tomorrow’s plan.',null,'eod:'||d);
    if local_now::time>=(s->>'eod_deadline')::time then
     perform private.notify(p.id,'eod','Daily report deadline passed','Submit your daily report as soon as possible.',null,'eod-late:'||d);
     for manager in select id from public.profiles where active and (role='super_admin' or id=p.manager_id) loop perform private.notify(manager,'eod','Missing report · '||p.full_name,'The daily report has not been submitted.',null,'eod-escalation:'||p.id||':'||d);end loop;
    end if;
   end if;
  end if;
  if local_now::time>=(s->>'office_end')::time then
   insert into public.records(module,title,status,owner_id,created_by,data)
   select 'attendance','Attendance · '||d,
    case when exists(select 1 from public.records where module='leave' and owner_id=p.id and status in ('Approved','Cancellation Requested') and (data->>'start_date')::date<=d and (data->>'end_date')::date>=d) then 'Leave' when not working then 'Holiday' else 'Absent' end,
    p.id,p.id,jsonb_build_object('date',d,'source','scheduler')
   where not exists(select 1 from public.records where module='attendance' and owner_id=p.id and data->>'date'=d::text)
   on conflict do nothing;
  end if;
 end loop;
 for r in select * from public.records where module in ('renewals','software','leads','tasks','assets','credit','purchases') and status not in ('Completed','Cancelled','Lost','Won','Retired','Paid','On Hold','Archived','Inactive') loop
  if r.data->>'snoozed_until' is not null and (r.data->>'snoozed_until')::date>d then continue;end if;
  if r.module in ('renewals','software') and r.data->>'expiry_date' is not null then
   days:=(r.data->>'expiry_date')::date-d;
   update public.records set status=case when days<0 then 'Expired' when days<=coalesce((s->>'renewal_days')::integer,30) then 'Upcoming' else 'Active' end,version=version+1,updated_at=now()
   where id=r.id and status is distinct from (case when days<0 then 'Expired' when days<=coalesce((s->>'renewal_days')::integer,30) then 'Upcoming' else 'Active' end);
   if days<=coalesce((s->>'renewal_days')::integer,30) then
    perform private.notify(r.owner_id,'renewals',case when days<0 then 'Overdue renewal · ' else 'Upcoming renewal · ' end||r.title,'Expires on '||(r.data->>'expiry_date'),r.id,'renewal:'||r.id||':'||d);
    for manager in select id from public.profiles where active and (role='super_admin' or (days<0 and id=(select manager_id from public.profiles where id=r.owner_id))) loop
     perform private.notify(manager,'renewals','Renewal · '||r.title,'Expires on '||(r.data->>'expiry_date'),r.id,'renewal:'||r.id||':'||d);
    end loop;
    if (s->'reminder_intervals') @> to_jsonb(days) then perform private.notify(r.owner_id,'renewals',r.title||' · '||days||' days remaining','Priority renewal reminder.',r.id,'renewal-priority:'||r.id||':'||d);end if;
   end if;
  elsif r.module='leads' and r.data->>'follow_up_date' is not null and (r.data->>'follow_up_date')::date<=d then
   perform private.notify(r.owner_id,'followups','Follow-up · '||r.title,'Contact this lead and record the next action.',r.id,'followup:'||r.id||':'||d);
  elsif r.module='tasks' and r.data->>'due_date' is not null and (r.data->>'due_date')::date<=d then
   perform private.notify(r.owner_id,'tasks','Task due · '||r.title,'Update the task or complete the work.',r.id,'task:'||r.id||':'||d);
  elsif r.module='assets' and r.data->>'next_service_date' is not null and (r.data->>'next_service_date')::date<=d+7 then
   perform private.notify(r.owner_id,'maintenance','Maintenance · '||r.title,'Next service: '||(r.data->>'next_service_date'),r.id,'service:'||r.id||':'||d);
  elsif r.module in ('credit','purchases') and r.data->>'due_date' is not null and r.data->>'payment_status' is distinct from 'Paid' and (r.data->>'due_date')::date<=d+7 and (r.data->>'reminder_date' is null or (r.data->>'reminder_date')::date<=d) then
   for manager in select id from public.profiles where active and role='super_admin' loop perform private.notify(manager,'payments','Payment due · '||r.title,'Due on '||(r.data->>'due_date'),r.id,'payment:'||r.id||':'||d);end loop;
  end if;
 end loop;
 for r in select * from public.records where module='inventory' and (data->>'available')::integer<=(data->>'minimum_stock')::integer loop
  for manager in select id from public.profiles where active and role='super_admin' loop perform private.notify(manager,'stock','Low stock · '||r.title,'Available: '||(r.data->>'available'),r.id,'stock:'||r.id||':'||d);end loop;
 end loop;
 for r in select * from public.records where status in ('Submitted','Resubmitted','Cancellation Requested') and updated_at<now()-interval '1 day' loop perform private.notify_reviewers(r,'pending-review:'||r.id||':'||d);end loop;
 select count(*) into after_count from public.notifications;
 update public.scheduler_runs set finished_at=now(),notification_count=after_count-before_count where id=run_id;
 delete from private.login_attempts where window_start<now()-interval '1 day';
 update private.push_outbox set status='failed',error='Delivery lease expired after retry limit' where status='processing' and attempts>=5 and available_at<now();
 return after_count-before_count;
end $$;
create function public.claim_push_jobs(p_limit integer default 50) returns table(id uuid,notification jsonb,subscriptions jsonb,preferences jsonb) language sql security definer set search_path='' as $$
 with claim as (
  select o.id from private.push_outbox o where o.status in ('pending','processing') and o.available_at<=now() and o.attempts<5 order by o.available_at for update skip locked limit least(p_limit,100)
 ), jobs as (
  update private.push_outbox o set status='processing',available_at=now()+interval '5 minutes',attempts=attempts+1 where o.id in(select id from claim) returning o.id,o.notification_id
 ) select j.id,to_jsonb(n),coalesce((select jsonb_agg(to_jsonb(s)) from public.push_subscriptions s where s.user_id=n.user_id),'[]'),coalesce(p.data,'{}')
 from jobs j join public.notifications n on n.id=j.notification_id left join public.notification_preferences p on p.user_id=n.user_id;
$$;
create function public.finish_push_job(p_id uuid,p_ok boolean,p_error text default null) returns void language sql security definer set search_path='' as $$
 update private.push_outbox set status=case when p_ok and p_error in ('Muted by user','No subscribed devices') then 'skipped' when p_ok then 'sent' when attempts>=5 then 'failed' else 'pending' end,error=p_error,available_at=now()+interval '5 minutes' where id=p_id;
$$;
create function private.export_candidates(p_module text,p_from date,p_to date,p_status text,p_query text) returns setof public.records language sql stable set search_path='' as $$
 select r.* from public.records r cross join public.settings s
 where s.id=1 and r.module=p_module and r.status<>'Archived' and private.visible(r.id) and private.permitted(r.module,'export',r.owner_id)
 and (p_status is null or r.status=p_status) and (p_query is null or strpos(lower(r.title),lower(p_query))>0)
 and (p_from is null or (case r.module when 'attendance' then r.data->>'date' when 'eod' then r.data->>'report_date' when 'expenses' then r.data->>'expense_date' when 'leave' then r.data->>'start_date' when 'renewals' then r.data->>'expiry_date' when 'software' then r.data->>'expiry_date' when 'maintenance' then r.data->>'service_date' when 'credit' then r.data->>'credit_date' when 'tasks' then r.data->>'due_date' else (r.created_at at time zone(s.data->>'timezone'))::date::text end)::date>=p_from)
 and (p_to is null or (case r.module when 'attendance' then r.data->>'date' when 'eod' then r.data->>'report_date' when 'expenses' then r.data->>'expense_date' when 'leave' then r.data->>'start_date' when 'renewals' then r.data->>'expiry_date' when 'software' then r.data->>'expiry_date' when 'maintenance' then r.data->>'service_date' when 'credit' then r.data->>'credit_date' when 'tasks' then r.data->>'due_date' else (r.created_at at time zone(s.data->>'timezone'))::date::text end)::date<=p_to)
 order by r.created_at desc,r.id limit 10001;
$$;
create function public.export_records(p_module text,p_from date default null,p_to date default null,p_status text default null,p_query text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n integer; bytes bigint; result jsonb;
begin
 if p_from is not null and p_to is not null and p_to<p_from then raise exception 'Report end date precedes start date';end if;
 select count(*),coalesce(sum(octet_length(to_jsonb(r)::text)),0) into n,bytes from private.export_candidates(p_module,p_from,p_to,p_status,p_query) r;
 if n>10000 or bytes>3145728 then raise exception 'Report is too large. Choose a narrower export date range or refine search.';end if;
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('owner_name',(select full_name from public.profiles where id=r.owner_id))),'[]') into result from private.export_candidates(p_module,p_from,p_to,p_status,p_query) r;
 return result;
end $$;
revoke all on function private.export_candidates(text,date,date,text,text) from public,techly_anon,techly_user,techly_service;
create function public.delete_record(p_id uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.records;
begin select * into r from public.records where id=p_id for update;
 if r.id is null or not private.permitted(r.module,'delete',r.owner_id) or r.version is distinct from p_version then raise exception 'Permission denied or stale version';end if;
 if r.module in ('attendance','inventory','credit') or exists(select 1 from public.payments where record_id=r.id) or r.status not in ('Draft','New Lead','Planning','Applied','To Do','Inactive') then raise exception 'Audited or finalized records cannot be deleted. Archive the record instead.';end if;
 -- Soft deletion preserves all historical evidence.
 update public.records set status='Archived',version=version+1,updated_at=now() where id=p_id;
end $$;
create function public.share_record(p_record uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.records;
begin select * into r from public.records where id=p_record;
 if not private.is_admin() then raise exception 'Permission denied';end if;
 if r.module in ('employees','payroll','attendance','leave','corrections','onboarding') and p_user<>r.owner_id and exists(select 1 from public.profiles where id=p_user and role='employee') then raise exception 'Standard users can only access their own private HR and attendance records';end if;
 insert into public.record_shares(record_id,user_id) values(r.id,p_user) on conflict do nothing;end $$;
revoke all on function public.scheduler_tick(),public.claim_push_jobs(integer),public.finish_push_job(uuid,boolean,text),public.export_records(text,date,date,text,text),public.delete_record(uuid,integer),public.share_record(uuid,uuid) from public,techly_anon,techly_user;
grant execute on function public.scheduler_tick(),public.claim_push_jobs(integer),public.finish_push_job(uuid,boolean,text) to techly_service;
grant execute on function public.export_records(text,date,date,text,text),public.delete_record(uuid,integer),public.share_record(uuid,uuid) to techly_user;
alter table private.push_outbox enable row level security;
alter table private.login_attempts enable row level security;
commit;
