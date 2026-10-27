-- Migration 013: MMC UPI payment link. Each client gets a stable, unguessable pay link
-- (/pay/<token>) that shows what is owed with a UPI button and QR code. After paying, the
-- client submits the UPI transaction ID (UTR); an admin checks it against the bank and
-- approves it, which records the payment through mmc_record_payment (receipt, message,
-- auto-reactivation). Nothing is marked paid automatically from a client's claim.
begin;

alter table public.mmc_clients add column pay_token text unique not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');

create table public.mmc_payment_claims (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.mmc_clients(id) on delete cascade,
 amount numeric(12,2) not null check(amount>0),
 utr text not null check(utr ~ '^[A-Za-z0-9]{6,35}$'),
 note text not null default '' check(length(note)<=300),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 payment_id uuid references public.mmc_payments(id) on delete set null,
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 review_note text not null default '',
 created_at timestamptz not null default now(),
 unique(client_id,utr)
);
create index mmc_payment_claims_status_idx on public.mmc_payment_claims(status,created_at desc);

-- UPI payee (empty until set in MMC → Settings), admin alert for claims, and WhatsApp URL buttons.
update public.mmc_settings set data=data
 ||jsonb_build_object('upi',jsonb_build_object('vpa','','payee_name',''))
 ||jsonb_build_object('admin_push',coalesce(data->'admin_push','{}')||'{"claim":true}'::jsonb)
 where id=1;
update public.mmc_settings set data=jsonb_set(data,'{templates}',
 (select jsonb_object_agg(k,case when k in ('reminder','due_today','overdue','suspended') then v||'{"whatsapp_button":"pay_token"}'::jsonb
   when k='payment_received' then v||'{"whatsapp_button":"receipt_token","whatsapp_vars":["client_name","amount","website"],"text":"Hi {{client_name}}, we received Rs.{{amount}} for {{website}}. Thank you! Your receipt: {{receipt_link}}"}'::jsonb
   else v end) from jsonb_each(data->'templates') t(k,v)))
 where id=1;

-- Every queued message also carries the client's pay token for the link/button.
create or replace function private.mmc_queue(p_client uuid,p_event text,p_vars jsonb,p_key text) returns integer language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; s jsonb:=private.mmc_settings(); ch text; n integer:=0; v jsonb; tpl text;
begin
 select * into c from public.mmc_clients where id=p_client;
 if c.id is null or c.channel='none' then return 0; end if;
 tpl:=case when p_event='manual' then coalesce(p_vars->>'template','overdue') else p_event end;
 if coalesce((s->'templates'->tpl->>'enabled')::boolean,true) is not true then return 0; end if;
 v:=jsonb_build_object('client_name',c.name,'website',coalesce(nullif(c.website_url,''),c.business_name,c.name),'amount',private.mmc_money(c.mmc_amount),'template',tpl,'pay_token',c.pay_token)||coalesce(p_vars,'{}');
 foreach ch in array case c.channel when 'both' then array['whatsapp','sms'] else array[c.channel] end loop
  insert into public.mmc_messages(client_id,client_name,event,channel,recipient,vars,event_key)
  values(c.id,c.name,p_event,ch,case when ch='whatsapp' then coalesce(c.whatsapp,c.phone) else c.phone end,v,p_key||':'||ch)
  on conflict(event_key) do nothing;
  if found then n:=n+1; end if;
 end loop;
 return n;
end $$;

-- Public pay page data (service role only; looked up by the unguessable token).
create function public.mmc_pay_info(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.mmc_clients; s jsonb:=private.mmc_settings();
begin
 select * into c from public.mmc_clients where pay_token=p_token;
 if c.id is null then return null; end if;
 return jsonb_build_object(
  'client',jsonb_build_object('name',c.name,'business_name',c.business_name,'website_url',c.website_url,'mmc_amount',c.mmc_amount,'site_active',c.site_active),
  'owed',(select coalesce(sum(amount-paid_amount),0) from public.mmc_dues where client_id=c.id and status<>'Paid'),
  'credit',(select coalesce(sum(p.amount),0) from public.mmc_payments p where p.client_id=c.id)-(select coalesce(sum(a.amount),0) from public.mmc_allocations a join public.mmc_payments p on p.id=a.payment_id where p.client_id=c.id),
  'dues',(select coalesce(jsonb_agg(jsonb_build_object('month',to_char(period,'Mon YYYY'),'due_date',due_date,'balance',amount-paid_amount,'status',status) order by period),'[]') from public.mmc_dues where client_id=c.id and status<>'Paid'),
  'pending_claims',(select count(*) from public.mmc_payment_claims where client_id=c.id and status='pending'),
  'upi',coalesce(s->'upi','{}'),
  'contact',coalesce(s->'contact','{}'));
end $$;

create function public.mmc_submit_claim(p_token text,p_amount numeric,p_utr text,p_note text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.mmc_clients; cid uuid;
begin
 select * into c from public.mmc_clients where pay_token=p_token;
 if c.id is null then raise exception 'This payment link is not valid'; end if;
 if (select count(*) from public.mmc_payment_claims where client_id=c.id and status='pending')>=5 then raise exception 'Several payments are already waiting for confirmation. Please contact us.'; end if;
 insert into public.mmc_payment_claims(client_id,amount,utr,note) values(c.id,p_amount,upper(trim(p_utr)),left(coalesce(p_note,''),300))
 on conflict(client_id,utr) do nothing returning id into cid;
 if cid is null then raise exception 'This transaction ID was already submitted'; end if;
 perform private.mmc_notify_admins('claim','UPI payment to verify · '||c.name,'Rs.'||private.mmc_money(p_amount)||' · UTR '||upper(trim(p_utr))||'. Check your bank, then approve it.','/mmc/payments','mmc-claim:'||cid);
 return cid;
end $$;

-- Approve records the payment (receipt, message, reactivation); reject only closes the claim.
create function public.mmc_review_claim(p_id uuid,p_approve boolean,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare cl public.mmc_payment_claims; r jsonb;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to review payments'; end if;
 select * into cl from public.mmc_payment_claims where id=p_id for update;
 if cl.id is null then raise exception 'Claim not found'; end if;
 if cl.status<>'pending' then raise exception 'This claim was already %',cl.status; end if;
 if p_approve then
  r:=public.mmc_record_payment(cl.client_id,cl.amount,(cl.created_at at time zone coalesce((select data->>'timezone' from public.settings where id=1),'Asia/Kolkata'))::date,'UPI',cl.utr,coalesce(nullif(p_note,''),'UPI payment confirmed from client claim'),'mmc-claim:'||cl.id);
  update public.mmc_payment_claims set status='approved',payment_id=(r->>'id')::uuid,reviewed_by=private.current_user_id(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=cl.id;
 else
  update public.mmc_payment_claims set status='rejected',reviewed_by=private.current_user_id(),reviewed_at=now(),review_note=coalesce(p_note,'') where id=cl.id;
  insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC payment claim rejected',jsonb_build_object('claim_id',cl.id,'client_id',cl.client_id,'utr',cl.utr,'note',p_note));
 end if;
 return jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'payment',r);
end $$;

alter table public.mmc_payment_claims enable row level security;
create policy mmc_payment_claims_read on public.mmc_payment_claims for select to techly_user using(private.has_feature('mmc','view'));
grant select on public.mmc_payment_claims to techly_user;
grant select,insert,update,delete on public.mmc_payment_claims to techly_service;
revoke all on function public.mmc_pay_info(text),public.mmc_submit_claim(text,numeric,text,text),public.mmc_review_claim(uuid,boolean,text) from public,techly_anon,techly_user,techly_service;
grant execute on function public.mmc_pay_info(text),public.mmc_submit_claim(text,numeric,text,text) to techly_service;
grant execute on function public.mmc_review_claim(uuid,boolean,text) to techly_user;
commit;
