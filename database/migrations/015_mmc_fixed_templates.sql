-- Migration 015: the WhatsApp templates live in MSG91 under fixed names, so Settings no longer
-- edits template names or text. Only the payment reminder is approved so far; the other
-- messages stay off until their templates are approved and switched on in MMC → Settings.
begin;

update public.mmc_settings set data=jsonb_set(data,'{templates}',(
 select jsonb_object_agg(k, v||jsonb_build_object('whatsapp_language','en','enabled',k='reminder','whatsapp_template',case k
  when 'reminder' then 'mmc_payment_reminder'
  when 'due_today' then 'mmc_due_today'
  when 'overdue' then 'mmc_payment_overdue'
  when 'suspended' then 'mmc_site_suspended'
  when 'reactivated' then 'mmc_site_reactivated'
  when 'payment_received' then 'mmc_payment_received'
  else coalesce(v->>'whatsapp_template','') end))
 from jsonb_each(data->'templates') t(k,v))) where id=1;

-- A manual reminder falls back to the payment reminder when the more specific message
-- (due today / overdue) is switched off, so "Send reminder" always sends something.
create or replace function public.mmc_send_reminder(p_client uuid) returns integer language plpgsql security definer set search_path='' as $$
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
 if coalesce((private.mmc_settings()->'templates'->tpl->>'enabled')::boolean,false) is not true then tpl:='reminder'; end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC reminder sent',jsonb_build_object('client_id',p_client,'template',tpl));
 return private.mmc_queue(p_client,'manual',vars||jsonb_build_object('template',tpl),'mmc:manual:'||p_client||':'||extract(epoch from clock_timestamp())::bigint);
end $$;
commit;
