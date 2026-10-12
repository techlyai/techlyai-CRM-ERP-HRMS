begin;
create function public.dashboard_stats() returns jsonb language sql stable security invoker set search_path='' as $$
 with visible as (select * from public.records where status<>'Archived'),
 today as (select (now() at time zone (select data->>'timezone' from public.settings where id=1))::date d),
 counts as (select module,count(*) n from visible group by module),
 spend as (select coalesce(sum((data->>'amount')::numeric),0) n from visible,today where module='expenses' and status in ('Approved','Pending Payment','Paid') and (data->>'expense_date')::date>=date_trunc('month',today.d) and (data->>'expense_date')::date<=today.d),
 attendance as (select status,count(*) n from visible,today where module='attendance' and data->>'date'=today.d::text group by status),
 chart as (select to_char(d,'Mon') label,coalesce(sum((v.data->>'amount')::numeric),0) amount from generate_series(date_trunc('month',current_date)-interval '5 months',date_trunc('month',current_date),'1 month') d left join visible v on v.module='expenses' and v.status in ('Approved','Pending Payment','Paid') and date_trunc('month',(v.data->>'expense_date')::date)=d group by d order by d)
 select jsonb_build_object(
  'counts',coalesce((select jsonb_object_agg(module,n) from counts),'{}'),
  'employees',(select count(*) from public.profiles where active),
  'active_projects',(select count(*) from visible where module='projects' and status='Active'),
  'attendance',coalesce((select jsonb_object_agg(status,n) from attendance),'{}'),
  'expenses',(select n from spend),
  'pending',(select count(*) from visible where status in ('Submitted','Resubmitted','Cancellation Requested','Clarification Required')),
  'overdue_tasks',(select count(*) from visible,today where module='tasks' and status<>'Completed' and (data->>'due_date')::date<today.d),
  'renewals',(select count(*) from visible,today where module in ('renewals','software') and status not in ('Cancelled','On Hold') and (data->>'expiry_date')::date<=today.d+30),
  'expired',(select count(*) from visible,today where module in ('renewals','software') and status not in ('Cancelled','On Hold') and (data->>'expiry_date')::date<today.d),
  'low_stock',(select count(*) from visible where module='inventory' and (data->>'available')::numeric<=(data->>'minimum_stock')::numeric),
  'maintenance_due',(select count(*) from visible,today where module='assets' and status<>'Retired' and (data->>'next_service_date')::date<=today.d+7),
  'leave_pending',(select count(*) from visible where module='leave' and status in ('Submitted','Resubmitted','Cancellation Requested')),
  'claims_pending',(select count(*) from visible where module='expenses' and status in ('Submitted','Resubmitted')),
  'reports_pending',(select count(*) from visible where module='eod' and status in ('Submitted','Resubmitted')),
  'corrections_pending',(select count(*) from visible where module='corrections' and status in ('Submitted','Resubmitted')),
  'questions_pending',(select count(*) from public.questions where parent_id is null and not resolved),
  'outstanding',(select coalesce(sum(greatest((data->>'amount')::numeric-coalesce((data->>'paid_amount')::numeric,0),0)),0) from visible where module in ('credit','purchases') and status in ('Open','Partially Paid','Approved','Received') and not (module='credit' and data->>'purchase_id' is not null)),
  'conversion',(select case when count(*)=0 then 0 else round(count(*) filter(where status='Won')*100.0/count(*),1) end from visible where module='leads'),
  'missing_eod',(select count(*) from public.profiles p,today where p.active and private.permitted('eod','view',p.id) and not exists(select 1 from visible v where v.module='eod' and v.owner_id=p.id and v.data->>'report_date'=today.d::text and v.status<>'Draft')),
  'chart',coalesce((select jsonb_agg(to_jsonb(chart)) from chart),'[]')
 );
$$;
revoke all on function public.dashboard_stats() from public,techly_anon;
grant execute on function public.dashboard_stats() to techly_user;
commit;
