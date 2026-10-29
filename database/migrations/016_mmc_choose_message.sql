-- Migration 016: the Remind button lets the admin pick which message to send (payment
-- reminder, due today, overdue, suspended, reactivated or thank you). A message can only be
-- sent once it is switched on in MMC → Settings, i.e. after its MSG91 template is approved.
begin;

create function public.mmc_send_message(p_client uuid,p_template text) returns integer language plpgsql security definer set search_path='' as $$
declare d public.mmc_dues; pay public.mmc_payments; owed numeric; vars jsonb:='{}';
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to send messages'; end if;
 if p_template not in ('reminder','due_today','overdue','suspended','reactivated','payment_received') then raise exception 'Unknown message'; end if;
 if not exists(select 1 from public.mmc_clients where id=p_client) then raise exception 'Client not found'; end if;
 if coalesce((private.mmc_settings()->'templates'->p_template->>'enabled')::boolean,false) is not true then
  raise exception 'This message is switched off. Turn it on in MMC → Settings once its WhatsApp template is approved.';
 end if;
 if p_template='payment_received' then
  select * into pay from public.mmc_payments where client_id=p_client order by paid_on desc,receipt_no desc limit 1;
  if pay.id is null then raise exception 'No payment recorded for this client yet'; end if;
  vars:=jsonb_build_object('amount',private.mmc_money(pay.amount),'receipt_token',pay.receipt_token,'receipt_no',pay.receipt_no);
 else
  select * into d from public.mmc_dues where client_id=p_client and status<>'Paid' order by period limit 1;
  select coalesce(sum(amount-paid_amount),0) into owed from public.mmc_dues where client_id=p_client and status<>'Paid';
  vars:=jsonb_build_object('amount',private.mmc_money(owed),'due_date',coalesce(to_char(d.due_date,'DD Mon YYYY'),''),'days_overdue',greatest(private.mmc_today()-coalesce(d.due_date,private.mmc_today()),0)::text);
 end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC message sent',jsonb_build_object('client_id',p_client,'template',p_template));
 return private.mmc_queue(p_client,'manual',vars||jsonb_build_object('template',p_template),'mmc:manual:'||p_client||':'||extract(epoch from clock_timestamp())::bigint);
end $$;

revoke all on function public.mmc_send_message(uuid,text) from public,techly_anon,techly_user,techly_service;
grant execute on function public.mmc_send_message(uuid,text) to techly_user;
commit;
