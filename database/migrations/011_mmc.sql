-- Migration 011: MMC — monthly maintenance charges and remote website ON/OFF control.
--
-- Each website client pays a fixed monthly charge. A due is generated on the client's
-- billing day, becomes Overdue after the grace period and, when auto-suspend is on, the
-- client's site is switched off until payment is recorded. Client websites ask
-- /api/site-status with a per-client site key; only the key's SHA-256 is stored.
-- SMS/WhatsApp messages are queued here and delivered by the cron route through MSG91,
-- so a failed message never blocks a toggle or a payment.
begin;

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
create table public.mmc_settings (id integer primary key check(id=1), data jsonb not null check(jsonb_typeof(data)='object'));
insert into public.mmc_settings values(1,$json${
 "auto_suspend_enabled":true,
 "auto_reactivate_enabled":true,
 "reminder_days_before":3,
 "overdue_repeat_days":2,
 "default_grace_days":5,
 "suspended_title":"Site Suspended",
 "suspended_message":"Site suspended due to pending maintenance payment. Please contact admin.",
 "contact":{"name":"","phone":"","email":"","whatsapp":""},
 "admin_push":{"overdue":true,"auto_suspend":true,"payment":true,"no_checkin":true,"message_failed":true},
 "templates":{
  "reminder":{"enabled":true,"text":"Hi {{client_name}}, your maintenance charge of Rs.{{amount}} for {{website}} is due on {{due_date}}.","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","amount","website","due_date"]},
  "due_today":{"enabled":true,"text":"Hi {{client_name}}, your maintenance charge of Rs.{{amount}} for {{website}} is due today ({{due_date}}).","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","amount","website","due_date"]},
  "overdue":{"enabled":true,"text":"Hi {{client_name}}, your maintenance charge of Rs.{{amount}} for {{website}} is {{days_overdue}} days overdue. Please pay to avoid suspension.","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","amount","website","days_overdue"]},
  "suspended":{"enabled":true,"text":"Hi {{client_name}}, {{website}} has been suspended due to a pending maintenance payment of Rs.{{amount}}. Please contact us.","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","website","amount"]},
  "reactivated":{"enabled":true,"text":"Hi {{client_name}}, {{website}} is active again. Thank you!","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","website"]},
  "payment_received":{"enabled":true,"text":"Hi {{client_name}}, we received Rs.{{amount}} for {{website}}. Receipt: {{receipt_link}}","sms_template_id":"","whatsapp_template":"","whatsapp_vars":["client_name","amount","website","receipt_link"]}
 }
}$json$::jsonb);

-- ---------------------------------------------------------------------------
-- Clients, keys, dues, payments
-- ---------------------------------------------------------------------------
create table public.mmc_clients (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 160),
 business_name text not null default '' check(length(business_name)<=200),
 phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 whatsapp text check(whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
 email text check(email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
 website_url text not null default '' check(length(website_url)<=500),
 allowed_domain text not null default '' check(allowed_domain ~ '^([a-z0-9-]+\.)*[a-z0-9-]*$' and length(allowed_domain)<=253),
 mmc_amount numeric(12,2) not null check(mmc_amount>=0),
 billing_day integer not null check(billing_day between 1 and 31),
 grace_days integer not null default 5 check(grace_days between 0 and 60),
 start_date date not null,
 notes text not null default '' check(length(notes)<=4000),
 channel text not null default 'whatsapp' check(channel in ('whatsapp','sms','both','none')),
 site_active boolean not null default true,
 auto_suspend boolean not null default true,
 suspend_reason text,
 key_prefix text,
 key_created_at timestamptz,
 last_checked_at timestamptz,
 last_check_origin text,
 crm_record_id uuid references public.records(id) on delete set null,
 row_version integer not null default 1,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index mmc_clients_name_idx on public.mmc_clients(lower(name));

-- Only the SHA-256 of each site key is kept; the key itself is shown once.
create table private.mmc_site_keys (
 client_id uuid primary key references public.mmc_clients(id) on delete cascade,
 key_hash text not null unique check(key_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
alter table private.mmc_site_keys enable row level security;

create table public.mmc_dues (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.mmc_clients(id) on delete cascade,
 period date not null check(extract(day from period)=1),
 due_date date not null,
 amount numeric(12,2) not null check(amount>=0),
 paid_amount numeric(12,2) not null default 0 check(paid_amount>=0),
 status text not null default 'Pending' check(status in ('Pending','Paid','Overdue')),
 overdue_since date,
 created_at timestamptz not null default now(),
 unique(client_id,period)
);
create index mmc_dues_status_idx on public.mmc_dues(status,due_date);

create sequence public.mmc_receipt_seq;
create table public.mmc_payments (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.mmc_clients(id) on delete cascade,
 amount numeric(12,2) not null check(amount>0),
 paid_on date not null,
 mode text not null check(mode in ('UPI','Cash','Bank','Other')),
 reference text not null default '' check(length(reference)<=120),
 note text not null default '' check(length(note)<=1000),
 receipt_no bigint not null default nextval('public.mmc_receipt_seq') unique,
 receipt_token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 event_key text not null unique,
 actor_id uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create index mmc_payments_client_idx on public.mmc_payments(client_id,paid_on);
create table public.mmc_allocations (
 payment_id uuid not null references public.mmc_payments(id) on delete cascade,
 due_id uuid not null references public.mmc_dues(id) on delete cascade,
 amount numeric(12,2) not null check(amount>0),
 primary key(payment_id,due_id)
);

-- Kept without foreign keys so the history survives client deletion.
create table public.mmc_site_logs (
 id bigint generated always as identity primary key,
 client_id uuid not null,
 client_name text not null,
 old_state boolean not null,
 new_state boolean not null,
 source text not null check(source in ('admin','auto')),
 actor_id uuid,
 reason text not null default '',
 created_at timestamptz not null default now()
);
create index mmc_site_logs_client_idx on public.mmc_site_logs(client_id,created_at desc);

create table public.mmc_messages (
 id uuid primary key default gen_random_uuid(),
 client_id uuid references public.mmc_clients(id) on delete set null,
 client_name text not null,
 event text not null check(event in ('reminder','due_today','overdue','suspended','reactivated','payment_received','manual')),
 channel text not null check(channel in ('sms','whatsapp')),
 recipient text not null,
 vars jsonb not null default '{}',
 status text not null default 'queued' check(status in ('queued','sending','sent','failed','skipped')),
 provider_id text,
 response text,
 error text,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 sent_at timestamptz,
 event_key text not null unique,
 created_at timestamptz not null default now()
);
create index mmc_messages_queue_idx on public.mmc_messages(status,next_attempt_at);
create index mmc_messages_client_idx on public.mmc_messages(client_id,created_at desc);

-- Generic fixed-window rate limiter for public API endpoints.
create table private.api_rate_limits (key text primary key, count integer not null default 1, window_start timestamptz not null default now());
alter table private.api_rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Permissions (catalogue-backed; nothing granted by default)
-- ---------------------------------------------------------------------------
insert into public.permission_definitions(module,action,module_label,module_group,label,description,scoped,sensitive,sort) values
 ('mmc','view','MMC (maintenance charges & sites)','Operations','View MMC clients, dues, payments and logs','',false,false,3701),
 ('mmc','manage','MMC (maintenance charges & sites)','Operations','Manage MMC clients, payments and site ON/OFF','Add and edit clients, record payments, switch sites on or off, regenerate site keys and send reminders.',false,true,3702),
 ('mmc','delete','MMC (maintenance charges & sites)','Operations','Delete MMC clients','Removes the client with its dues and payments. Site ON/OFF history is kept.',false,true,3703),
 ('mmc','settings','MMC (maintenance charges & sites)','Operations','Change MMC settings and message templates','',false,true,3704);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.mmc_today() returns date language sql stable security definer set search_path='' as $$
 select (now() at time zone coalesce((select data->>'timezone' from public.settings where id=1),'Asia/Kolkata'))::date;
$$;
-- The billing day clamped to the last day of the month (31 → 28/29/30 where needed).
create function private.mmc_due_date(p_period date,p_day integer) returns date language sql immutable set search_path='' as $$
 select p_period + (least(p_day, extract(day from (date_trunc('month',p_period)+interval '1 month - 1 day'))::integer)-1);
$$;
create function private.mmc_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select data from public.mmc_settings where id=1;
$$;
create function private.mmc_money(p numeric) returns text language sql immutable set search_path='' as $$
 select case when p=trunc(p) then trunc(p)::text else to_char(p,'FM999999990.00') end;
$$;

-- Queues one message per selected channel. Idempotent per event key.
create function private.mmc_queue(p_client uuid,p_event text,p_vars jsonb,p_key text) returns integer language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; s jsonb:=private.mmc_settings(); ch text; n integer:=0; v jsonb; tpl text;
begin
 select * into c from public.mmc_clients where id=p_client;
 if c.id is null or c.channel='none' then return 0; end if;
 tpl:=case when p_event='manual' then coalesce(p_vars->>'template','overdue') else p_event end;
 if coalesce((s->'templates'->tpl->>'enabled')::boolean,true) is not true then return 0; end if;
 v:=jsonb_build_object('client_name',c.name,'website',coalesce(nullif(c.website_url,''),c.business_name,c.name),'amount',private.mmc_money(c.mmc_amount),'template',tpl)||coalesce(p_vars,'{}');
 foreach ch in array case c.channel when 'both' then array['whatsapp','sms'] else array[c.channel] end loop
  insert into public.mmc_messages(client_id,client_name,event,channel,recipient,vars,event_key)
  values(c.id,c.name,p_event,ch,case when ch='whatsapp' then coalesce(c.whatsapp,c.phone) else c.phone end,v,p_key||':'||ch)
  on conflict(event_key) do nothing;
  if found then n:=n+1; end if;
 end loop;
 return n;
end $$;

-- In-app + push notification to everyone who can view MMC, when that admin event is enabled.
create function private.mmc_notify_admins(p_kind text,p_title text,p_body text,p_link text,p_key text) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 if coalesce((private.mmc_settings()->'admin_push'->>p_kind)::boolean,true) is not true then return; end if;
 for p in select * from public.profiles where active and (role='super_admin' or private.scope_for(id,'mmc','view')<>'none') loop
  perform private.notify(p.id,'mmc',p_title,p_body,null,p_key,case when p_kind in ('auto_suspend','message_failed','overdue') then 'High' else 'Medium' end,p_link,'{}'::jsonb);
 end loop;
end $$;

-- The single place a site's state changes: logs it and queues the client notice.
create function private.mmc_apply_site(p_client uuid,p_active boolean,p_source text,p_reason text) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; owed numeric;
begin
 select * into c from public.mmc_clients where id=p_client for update;
 if c.id is null then raise exception 'Client not found'; end if;
 if c.site_active=p_active then return false; end if;
 update public.mmc_clients set site_active=p_active,suspend_reason=case when p_active then null else nullif(trim(coalesce(p_reason,'')),'') end,updated_at=now() where id=c.id;
 insert into public.mmc_site_logs(client_id,client_name,old_state,new_state,source,actor_id,reason)
 values(c.id,c.name,c.site_active,p_active,p_source,case when p_source='admin' then private.current_user_id() end,coalesce(p_reason,''));
 select coalesce(sum(amount-paid_amount),0) into owed from public.mmc_dues where client_id=c.id and status<>'Paid';
 perform private.mmc_queue(c.id,case when p_active then 'reactivated' else 'suspended' end,
  jsonb_build_object('amount',private.mmc_money(greatest(owed,c.mmc_amount))),
  'mmc:site:'||c.id||':'||extract(epoch from clock_timestamp())::bigint||':'||p_active);
 if p_source='auto' and not p_active then
  perform private.mmc_notify_admins('auto_suspend','Site auto-suspended · '||c.name,coalesce(nullif(c.website_url,''),c.name)||' was switched off for non-payment.','/mmc/clients/'||c.id,'mmc-suspend:'||c.id||':'||private.mmc_today());
 end if;
 return true;
end $$;

-- Applies unallocated payment money to open dues, oldest first, then refreshes statuses.
create function private.mmc_allocate(p_client uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; pay record; due public.mmc_dues; left_amt numeric; take numeric; today date:=private.mmc_today(); g integer; became_overdue boolean; owed numeric;
begin
 select * into c from public.mmc_clients where id=p_client;
 g:=c.grace_days;
 for pay in select p.id,p.amount-coalesce((select sum(a.amount) from public.mmc_allocations a where a.payment_id=p.id),0) as remaining
   from public.mmc_payments p where p.client_id=p_client order by p.paid_on,p.created_at loop
  left_amt:=pay.remaining;
  continue when left_amt<=0;
  for due in select * from public.mmc_dues where client_id=p_client and paid_amount<amount order by period for update loop
   exit when left_amt<=0;
   take:=least(left_amt,due.amount-due.paid_amount);
   insert into public.mmc_allocations(payment_id,due_id,amount) values(pay.id,due.id,take)
    on conflict(payment_id,due_id) do update set amount=public.mmc_allocations.amount+excluded.amount;
   update public.mmc_dues set paid_amount=paid_amount+take where id=due.id;
   left_amt:=left_amt-take;
  end loop;
 end loop;
 became_overdue:=exists(select 1 from public.mmc_dues where client_id=p_client and status<>'Overdue' and paid_amount<amount and today>due_date+g);
 update public.mmc_dues set
  status=case when paid_amount>=amount then 'Paid' when today>due_date+g then 'Overdue' else 'Pending' end,
  overdue_since=case when paid_amount>=amount then null when today>due_date+g then coalesce(overdue_since,today) else null end
 where client_id=p_client;
 -- A client becoming overdue alerts the admins once that day, however many months are late.
 if became_overdue then
  select coalesce(sum(amount-paid_amount),0) into owed from public.mmc_dues where client_id=p_client and status<>'Paid';
  perform private.mmc_notify_admins('overdue','Client overdue · '||c.name,'Rs.'||private.mmc_money(owed)||' outstanding for '||coalesce(nullif(c.website_url,''),c.name)||'.','/mmc/clients/'||c.id,'mmc-overdue:'||c.id||':'||today);
 end if;
end $$;

-- Generates each missing due once its billing day arrives. Dues start from the later of the
-- start date and the day the client was added, so adding an existing client never creates
-- (and auto-suspends for) months that were billed before Orbit tracked them.
create function private.mmc_generate_dues(p_client uuid) returns integer language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; per date; today date:=private.mmc_today(); n integer:=0; first_day date;
begin
 select * into c from public.mmc_clients where id=p_client;
 first_day:=greatest(c.start_date,(c.created_at at time zone coalesce((select data->>'timezone' from public.settings where id=1),'Asia/Kolkata'))::date);
 per:=greatest(date_trunc('month',first_day)::date,(date_trunc('month',today)-interval '36 months')::date);
 while per<=date_trunc('month',today)::date loop
  if private.mmc_due_date(per,c.billing_day)<=today and private.mmc_due_date(per,c.billing_day)>=first_day then
   insert into public.mmc_dues(client_id,period,due_date,amount) values(c.id,per,private.mmc_due_date(per,c.billing_day),c.mmc_amount)
   on conflict(client_id,period) do nothing;
   if found then n:=n+1; end if;
  end if;
  per:=(per+interval '1 month')::date;
 end loop;
 return n;
end $$;

-- Auto-reactivates a site switched off by the system once nothing is overdue.
create function private.mmc_maybe_reactivate(p_client uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; last_source text;
begin
 select * into c from public.mmc_clients where id=p_client;
 if c.site_active or coalesce((private.mmc_settings()->>'auto_reactivate_enabled')::boolean,true) is not true then return; end if;
 if exists(select 1 from public.mmc_dues where client_id=c.id and status='Overdue') then return; end if;
 select source into last_source from public.mmc_site_logs where client_id=c.id order by id desc limit 1;
 if last_source='auto' then perform private.mmc_apply_site(c.id,true,'auto','Payment received'); end if;
end $$;

-- ---------------------------------------------------------------------------
-- User-facing workflow functions
-- ---------------------------------------------------------------------------
create function public.mmc_save_client(p_id uuid,p_data jsonb,p_version integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; nid uuid; d jsonb:=p_data;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to manage MMC clients'; end if;
 if p_id is null then
  insert into public.mmc_clients(name,business_name,phone,whatsapp,email,website_url,allowed_domain,mmc_amount,billing_day,grace_days,start_date,notes,channel,auto_suspend,site_active,crm_record_id,created_by)
  values(trim(d->>'name'),coalesce(d->>'business_name',''),d->>'phone',nullif(d->>'whatsapp',''),nullif(d->>'email',''),coalesce(d->>'website_url',''),lower(coalesce(d->>'allowed_domain','')),
   (d->>'mmc_amount')::numeric,(d->>'billing_day')::integer,coalesce((d->>'grace_days')::integer,5),(d->>'start_date')::date,coalesce(d->>'notes',''),
   coalesce(d->>'channel','whatsapp'),coalesce((d->>'auto_suspend')::boolean,true),coalesce((d->>'site_active')::boolean,true),nullif(d->>'crm_record_id','')::uuid,private.current_user_id())
  returning id into nid;
  insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC client created',jsonb_build_object('client_id',nid,'name',d->>'name'));
  return nid;
 end if;
 select * into c from public.mmc_clients where id=p_id for update;
 if c.id is null then raise exception 'Client not found'; end if;
 if c.row_version<>p_version then raise exception 'This client was changed by someone else. Reload and try again.'; end if;
 update public.mmc_clients set name=trim(d->>'name'),business_name=coalesce(d->>'business_name',''),phone=d->>'phone',whatsapp=nullif(d->>'whatsapp',''),email=nullif(d->>'email',''),
  website_url=coalesce(d->>'website_url',''),allowed_domain=lower(coalesce(d->>'allowed_domain','')),mmc_amount=(d->>'mmc_amount')::numeric,billing_day=(d->>'billing_day')::integer,
  grace_days=coalesce((d->>'grace_days')::integer,5),start_date=(d->>'start_date')::date,notes=coalesce(d->>'notes',''),channel=coalesce(d->>'channel','whatsapp'),
  auto_suspend=coalesce((d->>'auto_suspend')::boolean,true),crm_record_id=nullif(d->>'crm_record_id','')::uuid,row_version=row_version+1,updated_at=now()
 where id=c.id;
 -- Open dues follow the new amount; paid history is never rewritten.
 update public.mmc_dues set amount=(d->>'mmc_amount')::numeric where client_id=c.id and paid_amount=0 and status<>'Paid';
 perform private.mmc_allocate(c.id);
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC client updated',jsonb_build_object('client_id',c.id,'before',to_jsonb(c)-'row_version','after',d));
 return c.id;
end $$;

create function public.mmc_delete_client(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients;
begin
 if not private.has_feature('mmc','delete') then raise exception 'Only a Super Admin or someone granted MMC delete can delete clients'; end if;
 select * into c from public.mmc_clients where id=p_id;
 if c.id is null then raise exception 'Client not found'; end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC client deleted',jsonb_build_object('client',to_jsonb(c),
  'paid_total',(select coalesce(sum(amount),0) from public.mmc_payments where client_id=c.id)));
 delete from public.mmc_clients where id=c.id;
end $$;

create function public.mmc_set_site(p_client uuid,p_active boolean,p_reason text) returns boolean language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to switch client sites'; end if;
 changed:=private.mmc_apply_site(p_client,p_active,'admin',left(coalesce(p_reason,''),500));
 if changed then
  insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),case when p_active then 'MMC site switched ON' else 'MMC site switched OFF' end,
   jsonb_build_object('client_id',p_client,'reason',p_reason));
 end if;
 return changed;
end $$;

-- Stores a new key hash; the previous key stops working immediately.
create function public.mmc_rotate_key(p_client uuid,p_hash text,p_prefix text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to manage site keys'; end if;
 if p_prefix !~ '^sk_live_[A-Za-z0-9_-]{4}$' then raise exception 'Invalid key prefix'; end if;
 if not exists(select 1 from public.mmc_clients where id=p_client) then raise exception 'Client not found'; end if;
 insert into private.mmc_site_keys(client_id,key_hash) values(p_client,p_hash)
 on conflict(client_id) do update set key_hash=excluded.key_hash,created_at=now();
 update public.mmc_clients set key_prefix=p_prefix,key_created_at=now() where id=p_client;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC site key generated',jsonb_build_object('client_id',p_client,'prefix',p_prefix));
end $$;

create function public.mmc_record_payment(p_client uuid,p_amount numeric,p_paid_on date,p_mode text,p_reference text,p_note text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; pay public.mmc_payments;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to record MMC payments'; end if;
 select * into pay from public.mmc_payments where event_key=p_key;
 if pay.id is not null then return jsonb_build_object('id',pay.id,'receipt_no',pay.receipt_no,'duplicate',true); end if;
 select * into c from public.mmc_clients where id=p_client for update;
 if c.id is null then raise exception 'Client not found'; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Enter an amount greater than zero'; end if;
 if p_paid_on>private.mmc_today()+1 then raise exception 'Payment date cannot be in the future'; end if;
 insert into public.mmc_payments(client_id,amount,paid_on,mode,reference,note,event_key,actor_id)
 values(c.id,p_amount,p_paid_on,p_mode,coalesce(p_reference,''),coalesce(p_note,''),p_key,private.current_user_id()) returning * into pay;
 perform private.mmc_generate_dues(c.id);
 perform private.mmc_allocate(c.id);
 perform private.mmc_maybe_reactivate(c.id);
 perform private.mmc_queue(c.id,'payment_received',jsonb_build_object('amount',private.mmc_money(p_amount),'receipt_token',pay.receipt_token,'receipt_no',pay.receipt_no),'mmc:paid:'||pay.id);
 perform private.mmc_notify_admins('payment','Payment received · '||c.name,'Rs.'||private.mmc_money(p_amount)||' by '||p_mode||'.','/mmc/clients/'||c.id,'mmc-paid:'||pay.id);
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC payment recorded',jsonb_build_object('client_id',c.id,'payment_id',pay.id,'amount',p_amount,'mode',p_mode));
 return jsonb_build_object('id',pay.id,'receipt_no',pay.receipt_no,'duplicate',false);
end $$;

create function public.mmc_send_reminder(p_client uuid) returns integer language plpgsql security definer set search_path='' as $$
declare d public.mmc_dues; owed numeric; tpl text:='reminder'; vars jsonb;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to send reminders'; end if;
 select * into d from public.mmc_dues where client_id=p_client and status<>'Paid' order by period limit 1;
 select coalesce(sum(amount-paid_amount),0) into owed from public.mmc_dues where client_id=p_client and status<>'Paid';
 if d.id is not null then
  tpl:=case when d.status='Overdue' then 'overdue' when d.due_date=private.mmc_today() then 'due_today' else 'reminder' end;
  vars:=jsonb_build_object('amount',private.mmc_money(owed),'due_date',to_char(d.due_date,'DD Mon YYYY'),'days_overdue',greatest(private.mmc_today()-d.due_date,0)::text);
 else
  vars:=jsonb_build_object('due_date',to_char((select private.mmc_due_date((date_trunc('month',private.mmc_today())+interval '1 month')::date,billing_day) from public.mmc_clients where id=p_client),'DD Mon YYYY'),'days_overdue','0');
 end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC reminder sent',jsonb_build_object('client_id',p_client,'template',tpl));
 return private.mmc_queue(p_client,'manual',vars||jsonb_build_object('template',tpl),'mmc:manual:'||p_client||':'||extract(epoch from clock_timestamp())::bigint);
end $$;

create function public.mmc_retry_message(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to retry messages'; end if;
 update public.mmc_messages set status='queued',attempts=0,next_attempt_at=now(),error=null where id=p_id and status in ('failed','skipped');
end $$;

create function public.mmc_save_settings(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_feature('mmc','settings') then raise exception 'Only a Super Admin or someone granted MMC settings can change these settings'; end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'Invalid settings'; end if;
 update public.mmc_settings set data=data||p_data where id=1;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC settings updated',p_data-'templates');
end $$;

-- ---------------------------------------------------------------------------
-- Service-only: public status check, rate limiting, receipts, cron, message queue
-- ---------------------------------------------------------------------------
create function public.api_rate_limit(p_key text,p_limit integer,p_window_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into private.api_rate_limits(key) values(p_key) on conflict(key) do update set
  count=case when private.api_rate_limits.window_start<now()-make_interval(secs=>p_window_seconds) then 1 else private.api_rate_limits.count+1 end,
  window_start=case when private.api_rate_limits.window_start<now()-make_interval(secs=>p_window_seconds) then now() else private.api_rate_limits.window_start end
 returning count into n;
 return n<=p_limit;
end $$;

create function public.mmc_site_check(p_hash text,p_origin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; s jsonb:=private.mmc_settings();
begin
 select m.* into c from private.mmc_site_keys k join public.mmc_clients m on m.id=k.client_id where k.key_hash=p_hash;
 if c.id is null then return null; end if;
 if c.last_checked_at is null or c.last_checked_at<now()-interval '1 minute' then
  update public.mmc_clients set last_checked_at=now(),last_check_origin=left(p_origin,253) where id=c.id;
 end if;
 return jsonb_build_object('client_id',c.id,'active',c.site_active,'allowed_domain',c.allowed_domain,
  'message',case when c.site_active then '' else coalesce(s->>'suspended_message','Site suspended. Please contact admin.') end);
end $$;

create function public.mmc_receipt(p_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('payment',to_jsonb(p)-'event_key','client',jsonb_build_object('name',c.name,'business_name',c.business_name,'website_url',c.website_url,'phone',c.phone),
  'periods',(select coalesce(jsonb_agg(to_char(d.period,'Mon YYYY') order by d.period),'[]') from public.mmc_allocations a join public.mmc_dues d on d.id=a.due_id where a.payment_id=p.id),
  'contact',private.mmc_settings()->'contact')
 from public.mmc_payments p join public.mmc_clients c on c.id=p.client_id where p.receipt_token=p_token;
$$;

-- Runs every minute from the scheduler; every step is idempotent.
create function public.mmc_tick() returns integer language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; d public.mmc_dues; s jsonb:=private.mmc_settings(); today date:=private.mmc_today(); n integer:=0;
 before_days integer:=coalesce((s->>'reminder_days_before')::integer,3); repeat_days integer:=greatest(coalesce((s->>'overdue_repeat_days')::integer,2),1);
 nxt date; owed numeric;
begin
 if not pg_try_advisory_xact_lock(9282740) then return 0; end if;
 delete from private.api_rate_limits where window_start<now()-interval '1 hour';
 for c in select * from public.mmc_clients order by created_at loop
  n:=n+private.mmc_generate_dues(c.id);
  perform private.mmc_allocate(c.id);
  select coalesce(sum(amount-paid_amount),0) into owed from public.mmc_dues where client_id=c.id and status<>'Paid';
  -- Client messages: before due, on the due date, and every N days while overdue.
  nxt:=private.mmc_due_date(date_trunc('month',today+before_days)::date,c.billing_day);
  if nxt=today+before_days and nxt>=c.start_date and not exists(select 1 from public.mmc_dues where client_id=c.id and period=date_trunc('month',nxt)::date and status='Paid') then
   perform private.mmc_queue(c.id,'reminder',jsonb_build_object('amount',private.mmc_money(owed+c.mmc_amount),'due_date',to_char(nxt,'DD Mon YYYY')),'mmc:reminder:'||c.id||':'||nxt);
  end if;
  for d in select * from public.mmc_dues where client_id=c.id and due_date=today and status<>'Paid' loop
   perform private.mmc_queue(c.id,'due_today',jsonb_build_object('amount',private.mmc_money(owed),'due_date',to_char(d.due_date,'DD Mon YYYY')),'mmc:due:'||d.id);
  end loop;
  select * into d from public.mmc_dues where client_id=c.id and status='Overdue' order by period limit 1;
  if d.id is not null and (today-d.overdue_since)%repeat_days=0 then
   perform private.mmc_queue(c.id,'overdue',jsonb_build_object('amount',private.mmc_money(owed),'due_date',to_char(d.due_date,'DD Mon YYYY'),'days_overdue',(today-d.due_date)::text),'mmc:overdue:'||c.id||':'||today);
  end if;
  -- Auto-suspend / reactivate.
  if d.id is not null and c.site_active and c.auto_suspend and coalesce((s->>'auto_suspend_enabled')::boolean,true) then
   perform private.mmc_apply_site(c.id,false,'auto','Unpaid beyond '||c.grace_days||' day grace period');
  elsif d.id is null and not c.site_active then
   perform private.mmc_maybe_reactivate(c.id);
  end if;
  -- An installed snippet that stopped checking in for 24 hours.
  if c.last_checked_at is not null and c.last_checked_at<now()-interval '24 hours' then
   perform private.mmc_notify_admins('no_checkin','Site not checking in · '||c.name,'Last seen '||to_char(c.last_checked_at at time zone 'UTC','DD Mon YYYY HH24:MI')||' UTC.','/mmc/clients/'||c.id,'mmc-silent:'||c.id||':'||c.last_checked_at);
  end if;
 end loop;
 return n;
end $$;

create function public.claim_mmc_messages(p_limit integer) returns setof public.mmc_messages language sql security definer set search_path='' as $$
 update public.mmc_messages m set status='sending',attempts=attempts+1,next_attempt_at=now()+interval '10 minutes'
 where m.id in(select id from public.mmc_messages where (status='queued' or status='sending') and next_attempt_at<=now() and attempts<3
  order by next_attempt_at limit p_limit for update skip locked)
 returning m.*;
$$;

create function public.finish_mmc_message(p_id uuid,p_status text,p_provider_id text,p_response text,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare m public.mmc_messages;
begin
 select * into m from public.mmc_messages where id=p_id for update;
 if m.id is null then return; end if;
 if p_status='failed' and m.attempts<3 then
  update public.mmc_messages set status='queued',error=left(p_error,1000),response=left(p_response,2000),next_attempt_at=now()+make_interval(mins=>5*power(2,m.attempts-1)::integer) where id=m.id;
  return;
 end if;
 update public.mmc_messages set status=p_status,provider_id=p_provider_id,response=left(p_response,2000),error=left(p_error,1000),
  sent_at=case when p_status='sent' then now() end where id=m.id;
 if p_status='failed' then
  perform private.mmc_notify_admins('message_failed','Message failed · '||m.client_name,initcap(m.channel)||' '||replace(m.event,'_',' ')||' could not be delivered: '||left(coalesce(p_error,'unknown error'),120),'/mmc/notifications','mmc-msgfail:'||m.id);
 end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row security and grants
-- ---------------------------------------------------------------------------
alter table public.mmc_settings enable row level security;
alter table public.mmc_clients enable row level security;
alter table public.mmc_dues enable row level security;
alter table public.mmc_payments enable row level security;
alter table public.mmc_allocations enable row level security;
alter table public.mmc_site_logs enable row level security;
alter table public.mmc_messages enable row level security;
create policy mmc_settings_read on public.mmc_settings for select to techly_user using(private.has_feature('mmc','view') or private.has_feature('mmc','settings'));
create policy mmc_clients_read on public.mmc_clients for select to techly_user using(private.has_feature('mmc','view'));
create policy mmc_dues_read on public.mmc_dues for select to techly_user using(private.has_feature('mmc','view'));
create policy mmc_payments_read on public.mmc_payments for select to techly_user using(private.has_feature('mmc','view'));
create policy mmc_allocations_read on public.mmc_allocations for select to techly_user using(private.has_feature('mmc','view'));
create policy mmc_site_logs_read on public.mmc_site_logs for select to techly_user using(private.has_feature('mmc','view'));
create policy mmc_messages_read on public.mmc_messages for select to techly_user using(private.has_feature('mmc','view'));
grant select on public.mmc_settings,public.mmc_clients,public.mmc_dues,public.mmc_payments,public.mmc_allocations,public.mmc_site_logs,public.mmc_messages to techly_user;
grant select,insert,update,delete on public.mmc_settings,public.mmc_clients,public.mmc_dues,public.mmc_payments,public.mmc_allocations,public.mmc_site_logs,public.mmc_messages to techly_service;
grant select,insert,update,delete on private.mmc_site_keys,private.api_rate_limits to techly_service;
grant usage,select on sequence public.mmc_receipt_seq to techly_service;

revoke all on function private.mmc_today(),private.mmc_due_date(date,integer),private.mmc_settings(),private.mmc_money(numeric),private.mmc_queue(uuid,text,jsonb,text),
 private.mmc_notify_admins(text,text,text,text,text),private.mmc_apply_site(uuid,boolean,text,text),private.mmc_allocate(uuid),private.mmc_generate_dues(uuid),private.mmc_maybe_reactivate(uuid),
 public.mmc_save_client(uuid,jsonb,integer),public.mmc_delete_client(uuid),public.mmc_set_site(uuid,boolean,text),public.mmc_rotate_key(uuid,text,text),
 public.mmc_record_payment(uuid,numeric,date,text,text,text,text),public.mmc_send_reminder(uuid),public.mmc_retry_message(uuid),public.mmc_save_settings(jsonb),
 public.api_rate_limit(text,integer,integer),public.mmc_site_check(text,text),public.mmc_receipt(text),public.mmc_tick(),public.claim_mmc_messages(integer),
 public.finish_mmc_message(uuid,text,text,text,text) from public,techly_anon,techly_user,techly_service;
grant execute on function public.mmc_save_client(uuid,jsonb,integer),public.mmc_delete_client(uuid),public.mmc_set_site(uuid,boolean,text),public.mmc_rotate_key(uuid,text,text),
 public.mmc_record_payment(uuid,numeric,date,text,text,text,text),public.mmc_send_reminder(uuid),public.mmc_retry_message(uuid),public.mmc_save_settings(jsonb) to techly_user;
grant execute on function public.api_rate_limit(text,integer,integer),public.mmc_site_check(text,text),public.mmc_receipt(text),public.mmc_tick(),
 public.claim_mmc_messages(integer),public.finish_mmc_message(uuid,text,text,text,text) to techly_service;
commit;
