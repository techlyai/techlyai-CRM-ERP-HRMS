-- Migration 012: MMC key notes — keeps each client's full site key, encrypted, so it can be
-- copied again later from MMC → Notes. The application encrypts with AES-256-GCM using
-- CREDENTIALS_ENCRYPTION_KEY (src/lib/vault.ts); the database only ever sees ciphertext.
-- Lookups by /api/site-status still use the SHA-256 in private.mmc_site_keys.
begin;

create table private.mmc_key_vault (
 client_id uuid primary key references public.mmc_clients(id) on delete cascade,
 ciphertext text not null,
 iv text not null,
 tag text not null,
 key_id text not null,
 saved_at timestamptz not null default now()
);
alter table private.mmc_key_vault enable row level security;
alter table public.mmc_clients add column key_saved_at timestamptz;

-- Saves the sealed copy of a key just generated for this client.
create function public.mmc_save_key_note(p_client uuid,p_sealed jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to manage site keys'; end if;
 if not exists(select 1 from public.mmc_clients where id=p_client) then raise exception 'Client not found'; end if;
 if coalesce(p_sealed->>'ciphertext','')='' or coalesce(p_sealed->>'iv','')='' or coalesce(p_sealed->>'tag','')='' or coalesce(p_sealed->>'key_id','')='' then raise exception 'Invalid sealed key'; end if;
 insert into private.mmc_key_vault(client_id,ciphertext,iv,tag,key_id) values(p_client,p_sealed->>'ciphertext',p_sealed->>'iv',p_sealed->>'tag',p_sealed->>'key_id')
 on conflict(client_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,key_id=excluded.key_id,saved_at=now();
 update public.mmc_clients set key_saved_at=now() where id=p_client;
end $$;

-- Returns the sealed key for decryption on the server; every view is audited.
create function public.mmc_key_note(p_client uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.mmc_key_vault; n text;
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to view site keys'; end if;
 select * into v from private.mmc_key_vault where client_id=p_client;
 if v.client_id is null then raise exception 'No saved key for this client. Regenerate the key to save one.'; end if;
 select name into n from public.mmc_clients where id=p_client;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC site key viewed',jsonb_build_object('client_id',p_client,'name',n));
 return jsonb_build_object('ciphertext',v.ciphertext,'iv',v.iv,'tag',v.tag,'key_id',v.key_id);
end $$;

-- A rotated key invalidates the saved copy until the new one is saved.
create or replace function public.mmc_rotate_key(p_client uuid,p_hash text,p_prefix text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_feature('mmc','manage') then raise exception 'You do not have permission to manage site keys'; end if;
 if p_prefix !~ '^sk_live_[A-Za-z0-9_-]{4}$' then raise exception 'Invalid key prefix'; end if;
 if not exists(select 1 from public.mmc_clients where id=p_client) then raise exception 'Client not found'; end if;
 insert into private.mmc_site_keys(client_id,key_hash) values(p_client,p_hash)
 on conflict(client_id) do update set key_hash=excluded.key_hash,created_at=now();
 delete from private.mmc_key_vault where client_id=p_client;
 update public.mmc_clients set key_prefix=p_prefix,key_created_at=now(),key_saved_at=null where id=p_client;
 insert into public.history(actor_id,action,snapshot) values(private.current_user_id(),'MMC site key generated',jsonb_build_object('client_id',p_client,'prefix',p_prefix));
end $$;

grant select,insert,update,delete on private.mmc_key_vault to techly_service;
revoke all on function public.mmc_save_key_note(uuid,jsonb),public.mmc_key_note(uuid) from public,techly_anon,techly_user,techly_service;
grant execute on function public.mmc_save_key_note(uuid,jsonb),public.mmc_key_note(uuid) to techly_user;
commit;
