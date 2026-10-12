begin;
create function public.purchase_catalog() returns table(id uuid,title text,module text) language sql stable security definer set search_path='' as $$
 select r.id,r.title,r.module from public.records r where r.module='inventory' and r.status='Active' and private.permitted('purchases','create',private.current_user_id()) order by title limit 500;
$$;
create function public.set_renewal_status(p_id uuid,p_status text,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.records;
begin select * into r from public.records where id=p_id and module in ('renewals','software') for update;
 if r.id is null or not private.permitted(r.module,'edit',r.owner_id) or r.version is distinct from p_version or p_status not in ('On Hold','Cancelled','Active') then raise exception 'Permission denied or invalid renewal status';end if;
 update public.records set status=p_status,version=version+1,updated_at=now() where id=p_id;
end $$;
create function public.set_leave_policy(p_type text,p_allocation numeric,p_accrual text,p_carry numeric,p_eligibility integer,p_paid boolean) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() or p_allocation<0 or p_carry<0 or p_eligibility<0 then raise exception 'Permission denied or invalid policy';end if;
 insert into public.leave_policies(type,allocation,accrual,carry_forward,eligibility_days,paid) values(p_type,p_allocation,p_accrual,p_carry,p_eligibility,p_paid) on conflict(type) do update set allocation=excluded.allocation,accrual=excluded.accrual,carry_forward=excluded.carry_forward,eligibility_days=excluded.eligibility_days,paid=excluded.paid;
end $$;
create function public.import_leads(p_items jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin if not private.permitted('leads','create',private.current_user_id()) or jsonb_array_length(p_items)>500 then raise exception 'Permission denied or import too large';end if;
 for item in select * from jsonb_array_elements(p_items) loop perform public.save_record('leads',item->>'title',item->'data',private.current_user_id());end loop;
end $$;
create function public.verify_document(p_id uuid,p_verified boolean) returns void language plpgsql security definer set search_path='' as $$
declare a public.attachments; r public.records;
begin select * into a from public.attachments where id=p_id;select * into r from public.records where id=a.record_id;
 if not private.permitted(r.module,'approve',r.owner_id) or a.uploaded_by=private.current_user_id() then raise exception 'Independent reviewer required';end if;
 update public.attachments set verified=p_verified where id=p_id;
 insert into public.history(record_id,actor_id,action,snapshot) values(r.id,private.current_user_id(),case when p_verified then 'Document verified' else 'Document verification revoked' end,jsonb_build_object('attachment_id',a.id));end $$;
create function public.read_questions(p_record uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not private.visible(p_record) then raise exception 'Permission denied';end if;update public.questions set read_by=array_append(read_by,private.current_user_id()) where record_id=p_record and not private.current_user_id()=any(read_by);end $$;
create function public.grant_leave(p_user uuid,p_type text,p_amount numeric,p_reason text,p_key text) returns void language plpgsql security definer set search_path='' as $$
begin if not private.is_admin() or p_amount<=0 or p_amount>365 or length(trim(p_reason))=0 then raise exception 'Permission denied or invalid grant';end if;
 insert into public.leave_ledger(user_id,type,amount,event_key) values(p_user,p_type,p_amount,'manual:'||p_key) on conflict(event_key) do nothing;
 if not found then return;end if;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'Manual leave grant',jsonb_build_object('user_id',p_user,'type',p_type,'amount',p_amount,'reason',p_reason));end $$;
revoke all on function public.purchase_catalog(),public.set_renewal_status(uuid,text,integer),public.set_leave_policy(text,numeric,text,numeric,integer,boolean),public.import_leads(jsonb),public.verify_document(uuid,boolean),public.read_questions(uuid),public.grant_leave(uuid,text,numeric,text,text) from public,techly_anon,techly_user;
grant execute on function public.purchase_catalog(),public.set_renewal_status(uuid,text,integer),public.set_leave_policy(text,numeric,text,numeric,integer,boolean),public.import_leads(jsonb),public.verify_document(uuid,boolean),public.read_questions(uuid),public.grant_leave(uuid,text,numeric,text,text) to techly_user;
commit;
