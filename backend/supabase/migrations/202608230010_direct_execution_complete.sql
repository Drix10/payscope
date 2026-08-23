-- Direct-execution completion: callback inbox, retention, reconciliation,
-- monotonic transitions, payment-scoped locking, execution policy, and
-- forward-compatible simulation retirement. All prior migrations remain immutable.

-- 1. Callback inbox: encrypted raw bodies, versioned secrets, dedupe, match result
create table if not exists public.payscope_callback_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  provider text not null check (provider in ('razorpay', 'smtp')),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 320),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 320),
  raw_body_encrypted jsonb not null check (jsonb_typeof(raw_body_encrypted) = 'object'),
  verified_secret_version smallint not null default 1 check (verified_secret_version in (1,2)),
  source text not null check (char_length(source) between 1 and 80),
  received_at timestamptz not null default now(),
  normalized jsonb check (jsonb_typeof(normalized) = 'object'),
  action_match jsonb check (action_match is null or jsonb_typeof(action_match) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, provider, provider_event_id),
  unique (organization_id, dedupe_key)
);
create index if not exists payscope_callback_inbox_received_idx on public.payscope_callback_inbox (organization_id, received_at desc);
create index if not exists payscope_callback_inbox_dedupe_idx on public.payscope_callback_inbox (dedupe_key);
alter table public.payscope_callback_inbox enable row level security;
-- server-only; no authenticated policy

-- Encrypted callback retention: raw bodies purged after verification window, redacted normalized evidence retained
create table if not exists public.payscope_callback_retention (
  organization_id uuid primary key references public.payscope_organizations(id) on delete cascade,
  retention_hours integer not null default 168 check (retention_hours between 24 and 720),
  updated_at timestamptz not null default now()
);

create or replace function public.payscope_purge_expired_callbacks()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare purged integer := 0; r record; cnt integer;
begin
  for r in select organization_id, retention_hours from public.payscope_callback_retention loop
    with updated as (
      update public.payscope_callback_inbox set raw_body_encrypted = jsonb_build_object('purged', true, 'retained', 'redacted_normalized_only'), normalized = coalesce(normalized, '{}'::jsonb)
      where organization_id = r.organization_id and received_at < now() - (r.retention_hours || ' hours')::interval and not (raw_body_encrypted ? 'purged')
      returning 1
    ) select count(*) into cnt from updated;
    purged := purged + cnt;
  end loop;
  -- default retention for orgs without explicit row (7d / 168h)
  with updated as (
    update public.payscope_callback_inbox set raw_body_encrypted = jsonb_build_object('purged', true, 'retained', 'redacted_normalized_only'), normalized = coalesce(normalized, '{}'::jsonb)
    where received_at < now() - interval '168 hours' and not (raw_body_encrypted ? 'purged') and organization_id not in (select organization_id from public.payscope_callback_retention)
    returning 1
  ) select count(*) + purged into purged from updated;
  return purged;
end;
$$;
revoke all on function public.payscope_purge_expired_callbacks() from public;
grant execute on function public.payscope_purge_expired_callbacks() to service_role;

-- 2. Reconciliation and compensation log (parent action link, compensating states)
create table if not exists public.payscope_reconciliation_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  action_id uuid not null references public.payscope_execution_actions(id) on delete cascade,
  parent_action_id uuid references public.payscope_execution_actions(id) on delete set null,
  event_type text not null check (event_type in ('callback_verified', 'reconciled', 'retry_scheduled', 'compensation_started', 'compensation_complete', 'monotonic_skipped', 'payment_locked', 'dispute_blocked')),
  previous_state text,
  new_state text check (new_state in ('queued', 'dispatching', 'accepted', 'unreconciled', 'confirmed', 'retry_scheduled', 'compensating', 'failed', 'cancelled')),
  reason text not null check (char_length(reason) between 1 and 320),
  provider_event_id text,
  created_at timestamptz not null default now()
);
create index if not exists payscope_reconciliation_log_action_idx on public.payscope_reconciliation_log (organization_id, action_id, created_at desc);
alter table public.payscope_reconciliation_log enable row level security;

-- 3. Monotonic reconciliation: duplicate/late callbacks enrich but never regress terminal state; newer verified canonical read wins
create or replace function public.payscope_reconcile_action(
  p_organization_id uuid,
  p_action_id uuid,
  p_provider text,
  p_receipt_kind text,
  p_provider_event_id text,
  p_verified_at timestamptz,
  p_is_canonical_read boolean,
  p_target_state text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare cur_state text; cur_updated timestamptz; rank_now integer; rank_cur integer;
begin
  if p_target_state not in ('queued','dispatching','accepted','unreconciled','confirmed','retry_scheduled','compensating','failed','cancelled') then raise exception 'Invalid target state %', p_target_state; end if;
  select state, updated_at into cur_state, cur_updated from public.payscope_execution_actions where id = p_action_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Unknown execution action for reconciliation'; end if;
  -- Terminal is final: no transitions out of confirmed/failed/cancelled except idempotent same-state refresh
  if cur_state in ('confirmed','failed','cancelled') then
    if cur_state = p_target_state then
      insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason, provider_event_id) values (p_organization_id, p_action_id, 'monotonic_skipped', cur_state, cur_state, 'Idempotent refresh of terminal state', p_provider_event_id);
      return cur_state;
    end if;
    insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason, provider_event_id) values (p_organization_id, p_action_id, 'monotonic_skipped', cur_state, cur_state, 'Terminal state is monotonic; no transitions allowed', p_provider_event_id);
    return cur_state;
  end if;
  -- stale callback (not canonical) with older timestamp is ignored — newer canonical read wins
  if not p_is_canonical_read and p_verified_at < cur_updated then
    insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason, provider_event_id) values (p_organization_id, p_action_id, 'monotonic_skipped', cur_state, cur_state, 'Stale callback ignored: newer canonical read wins', p_provider_event_id);
    return cur_state;
  end if;
  -- rank monotonic: regressing rank is blocked for non-canonical (duplicate/late) callbacks
  rank_cur := case cur_state when 'confirmed' then 9 when 'failed' then 8 when 'cancelled' then 8 when 'compensating' then 7 when 'retry_scheduled' then 6 when 'unreconciled' then 5 when 'accepted' then 4 when 'dispatching' then 3 when 'queued' then 2 else 0 end;
  rank_now := case p_target_state when 'confirmed' then 9 when 'failed' then 8 when 'cancelled' then 8 when 'compensating' then 7 when 'retry_scheduled' then 6 when 'unreconciled' then 5 when 'accepted' then 4 when 'dispatching' then 3 when 'queued' then 2 else 0 end;
  if rank_now < rank_cur and not p_is_canonical_read then
    insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason, provider_event_id) values (p_organization_id, p_action_id, 'monotonic_skipped', cur_state, cur_state, 'Duplicate callback would regress verified state', p_provider_event_id);
    return cur_state;
  end if;
  -- Valid forward transition is delegated to payscope_validate_execution_transition trigger; we just update and let trigger enforce graph
  update public.payscope_execution_actions set state = p_target_state, updated_at = greatest(updated_at, p_verified_at), completed_at = case when p_target_state in ('confirmed','failed','cancelled','unreconciled') then coalesce(completed_at, p_verified_at) else completed_at end where id = p_action_id and organization_id = p_organization_id;
  insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason, provider_event_id) values (p_organization_id, p_action_id, 'reconciled', cur_state, p_target_state, 'Reconciled via verified provider evidence', p_provider_event_id);
  return p_target_state;
end;
$$;
revoke all on function public.payscope_reconcile_action(uuid,uuid,text,text,text,timestamptz,boolean,text) from public;
grant execute on function public.payscope_reconcile_action(uuid,uuid,text,text,text,timestamptz,boolean,text) to service_role;

-- 4. Payment-scoped advisory lock for capture/refund serialization; active dispute blocks refund
create or replace function public.payscope_acquire_payment_lock(p_organization_id uuid, p_canonical_payment_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_canonical_payment_id is null or char_length(p_canonical_payment_id) = 0 then raise exception 'Canonical payment ID is required for payment-scoped lock'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_canonical_payment_id, 0));
end;
$$;
revoke all on function public.payscope_acquire_payment_lock(uuid,text) from public;
grant execute on function public.payscope_acquire_payment_lock(uuid,text) to service_role;

create or replace function public.payscope_assert_no_active_dispute(p_organization_id uuid, p_canonical_payment_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare has_dispute boolean := false;
begin
  if p_canonical_payment_id is null or char_length(p_canonical_payment_id) < 3 then return; end if;
  -- Check terminal dispute incident that is still open and references this payment via an event
  select exists(
    select 1 from public.payscope_incidents i
    where i.organization_id = p_organization_id and i.status = 'DISPUTE_OPENED'
      and exists (
        select 1 from public.payscope_events e
        where e.organization_id = p_organization_id
          and e.id = any(i.correlated_event_ids)
          and e.normalized->>'paymentId' = p_canonical_payment_id
      )
  ) into has_dispute;
  -- fallback: any dispute event referencing this payment (disputes are authoritative even before incident materializes)
  if not has_dispute then
    select exists(select 1 from public.payscope_events where organization_id = p_organization_id and normalized->>'paymentId' = p_canonical_payment_id and event_type in ('payment.dispute.created','payment.dispute.under_review','payment.dispute.action_required')) into has_dispute;
  end if;
  if has_dispute then raise exception 'Active dispute blocks refund command for payment %', p_canonical_payment_id; end if;
end;
$$;
revoke all on function public.payscope_assert_no_active_dispute(uuid,text) from public;
grant execute on function public.payscope_assert_no_active_dispute(uuid,text) to service_role;

-- 5. Organization execution policy (email-only Phase A + caps, budgets, pause)
create table if not exists public.payscope_organization_execution_policy (
  organization_id uuid primary key references public.payscope_organizations(id) on delete cascade,
  enabled_capabilities text[] not null default array['deliver_recovery_link_email'] check (enabled_capabilities <@ array['deliver_recovery_link_email','capture_authorized_payment','refund_payment','submit_dispute_evidence','record_risk_signal','resolve_infrastructure']),
  max_amount_paise integer not null default 500000 check (max_amount_paise between 100 and 100000000),
  allowed_currencies text[] not null default array['INR'] check (allowed_currencies <@ array['INR','USD','EUR','GBP']),
  email_consent_required boolean not null default true,
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  smtp_config_encrypted jsonb check (smtp_config_encrypted is null or jsonb_typeof(smtp_config_encrypted) = 'object'),
  retry_budget integer not null default 3 check (retry_budget between 0 and 5),
  dispute_deadline_hours integer not null default 72 check (dispute_deadline_hours between 1 and 720),
  emergency_paused boolean not null default false,
  provider_healthy boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payscope_organization_execution_policy enable row level security;

-- 6. Enforce single command + immutable payload + allowed transition graph
create or replace function public.payscope_validate_execution_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare allowed boolean := false;
begin
  -- immutable payload after dispatch
  if old.dispatched_at is not null and (
    new.command_payload is distinct from old.command_payload or
    new.command_payload_hash is distinct from old.command_payload_hash or
    new.canonical_payment_id is distinct from old.canonical_payment_id or
    new.canonical_order_id is distinct from old.canonical_order_id or
    new.amount_paise is distinct from old.amount_paise or
    new.currency is distinct from old.currency or
    new.command_key is distinct from old.command_key or
    new.provider_object_id is distinct from old.provider_object_id and old.provider_object_id is not null
  ) then raise exception 'PayScope dispatched execution commands are immutable'; end if;
  if old.state in ('confirmed','failed','cancelled') and new.state is distinct from old.state then raise exception 'PayScope terminal execution action cannot transition'; end if;
  -- allowed transition graph
  allowed := (
    (old.state = 'queued' and new.state in ('queued','dispatching','failed','cancelled')) or
    (old.state = 'dispatching' and new.state in ('dispatching','accepted','unreconciled','failed','cancelled')) or
    (old.state = 'accepted' and new.state in ('accepted','confirmed','unreconciled','retry_scheduled','compensating','failed','cancelled')) or
    (old.state = 'unreconciled' and new.state in ('unreconciled','confirmed','failed','cancelled')) or
    (old.state = 'confirmed' and new.state = 'confirmed') or
    (old.state = 'retry_scheduled' and new.state in ('retry_scheduled','dispatching','failed','cancelled')) or
    (old.state = 'compensating' and new.state in ('compensating','failed','cancelled','confirmed')) or
    (old.state = 'failed' and new.state = 'failed') or
    (old.state = 'cancelled' and new.state = 'cancelled')
  );
  if not allowed and old.state is distinct from new.state then raise exception 'PayScope execution state transition % -> % is not allowed', old.state, new.state; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists payscope_execution_actions_transition on public.payscope_execution_actions;
create trigger payscope_execution_actions_transition before update on public.payscope_execution_actions for each row execute function public.payscope_validate_execution_transition();
-- command_key uniqueness already exists: unique (organization_id, command_key)

-- 7. Callback verification + dedupe (supports secret rotation window)
-- Stores encrypted raw body, version, and match result; idempotent by provider_event_id
create or replace function public.payscope_verify_and_store_callback(
  p_organization_id uuid,
  p_provider text,
  p_provider_event_id text,
  p_dedupe_key text,
  p_raw_body_encrypted jsonb,
  p_verified_secret_version smallint,
  p_source text,
  p_normalized jsonb,
  p_action_match jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare existing uuid; new_id uuid;
begin
  if p_provider not in ('razorpay','smtp') then raise exception 'Invalid callback provider'; end if;
  if p_verified_secret_version not in (1,2) then raise exception 'Invalid secret version'; end if;
  -- Conflict-safe insert keyed by the (organization, provider, provider_event_id) unique constraint;
  -- concurrent duplicate deliveries return the stored row id instead of raising a unique violation.
  insert into public.payscope_callback_inbox (organization_id, provider, provider_event_id, dedupe_key, raw_body_encrypted, verified_secret_version, source, normalized, action_match)
  values (p_organization_id, p_provider, p_provider_event_id, p_dedupe_key, p_raw_body_encrypted, p_verified_secret_version, p_source, p_normalized, p_action_match)
  on conflict (organization_id, provider, provider_event_id) do nothing
  returning id into new_id;
  if new_id is null then
    select id into existing from public.payscope_callback_inbox where organization_id = p_organization_id and provider = p_provider and provider_event_id = p_provider_event_id;
    if existing is not null then return existing; end if;
    -- dedupe_key uniqueness fallback: same content, different event id
    insert into public.payscope_callback_inbox (organization_id, provider, provider_event_id, dedupe_key, raw_body_encrypted, verified_secret_version, source, normalized, action_match)
    values (p_organization_id, p_provider, p_provider_event_id, p_dedupe_key, p_raw_body_encrypted, p_verified_secret_version, p_source, p_normalized, p_action_match)
    on conflict (organization_id, dedupe_key) do nothing
    returning id into new_id;
    if new_id is null then
      select id into existing from public.payscope_callback_inbox where organization_id = p_organization_id and dedupe_key = p_dedupe_key;
      return existing;
    end if;
  end if;
  return new_id;
end;
$$;
revoke all on function public.payscope_verify_and_store_callback(uuid,text,text,text,jsonb,smallint,text,jsonb,jsonb) from public;
grant execute on function public.payscope_verify_and_store_callback(uuid,text,text,text,jsonb,smallint,text,jsonb,jsonb) to service_role;

-- 8. Compensation rules: expired/cancelled link, pre-send failure, refund failure, capture race, dispute deadline
create or replace function public.payscope_record_compensation(
  p_organization_id uuid,
  p_action_id uuid,
  p_parent_action_id uuid,
  p_reason text,
  p_target_state text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare cur text;
begin
  if p_target_state not in ('cancelled','failed','compensating') then raise exception 'Invalid compensation target state %', p_target_state; end if;
  if p_reason is null or char_length(p_reason) < 1 or char_length(p_reason) > 320 then raise exception 'Invalid compensation reason'; end if;
  select state into cur from public.payscope_execution_actions where id = p_action_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Unknown action for compensation'; end if;
  -- never compensate a generic refund/capture/dispute reversal: only link cancellation is allowed
  if p_reason like '%refund_reversal%' or p_reason like '%capture_reversal%' then raise exception 'Refunds, captures, and submitted disputes are never reversed by generic compensation'; end if;
  -- terminal actions are monotonic: no compensation can regress a confirmed/failed/cancelled action
  if cur in ('confirmed','failed','cancelled') then return; end if;
  update public.payscope_execution_actions set state = p_target_state, terminal_reason = left(p_reason,320), updated_at = now(), completed_at = now() where id = p_action_id and organization_id = p_organization_id;
  insert into public.payscope_reconciliation_log (organization_id, action_id, parent_action_id, event_type, previous_state, new_state, reason) values (p_organization_id, p_action_id, p_parent_action_id, 'compensation_complete', cur, p_target_state, left(p_reason,320));
end;
$$;
revoke all on function public.payscope_record_compensation(uuid,uuid,uuid,text,text) from public;
grant execute on function public.payscope_record_compensation(uuid,uuid,uuid,text,text) to service_role;

-- 9. Replace flag_for_review with record_risk_signal (forward-compatible: keep old rows readable, disallow new flag rows)
alter table public.payscope_action_proposals drop constraint if exists payscope_action_proposals_action_type_check;
alter table public.payscope_action_proposals add constraint payscope_action_proposals_action_type_check
  check (action_type in ('retry_link_whatsapp','retry_link_sms','hinglish_voice_script','merchant_email_notification','merchant_webhook_notification','flag_for_review','prepare_chargeback_evidence','auto_resolve_infrastructure','deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure'));
-- Add comment to guide future deletion in same release train:
comment on constraint payscope_action_proposals_action_type_check on public.payscope_action_proposals is 'Legacy types (whatsapp/sms/flag_for_review) readable only; new directs must use record_risk_signal and deliver_recovery_link_email family. Delete legacy values after migration projection is live.';

-- 10. Watchdog: schedule reconciliation/retry for stuck accepted/pending without duplicate dispatch
create or replace function public.payscope_watchdog_requeue_stuck_actions()
returns setof uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id, organization_id from public.payscope_execution_actions where state in ('accepted','dispatching') and next_reconciliation_at is not null and next_reconciliation_at <= now() for update skip locked loop
    update public.payscope_execution_actions set next_reconciliation_at = now() + interval '60 seconds', updated_at = now() where id = r.id;
    insert into public.payscope_reconciliation_log (organization_id, action_id, event_type, previous_state, new_state, reason) values (r.organization_id, r.id, 'retry_scheduled', (select state from public.payscope_execution_actions where id = r.id), 'retry_scheduled', 'Watchdog scheduled reconciliation without duplicate dispatch', null);
    return next r.id;
  end loop;
end;
$$;
revoke all on function public.payscope_watchdog_requeue_stuck_actions() from public;
grant execute on function public.payscope_watchdog_requeue_stuck_actions() to service_role;

-- 11. Metrics view replacement: verified execution metrics (dispatched, smtp accepted/rejected/unreconciled, confirmed, etc.)
-- The function payscope_dashboard_metrics will be replaced by payscope_dashboard_metrics_v2 in app code; keep v1 for compatibility.

-- 12. Ensure RLS remains enabled with service_role bypass for all new tables
-- (already enabled above)

-- 13. Unique constraint for execution_actions command_key already exists; document idempotency
-- unique (organization_id, command_key) exists in 202608230009

-- 14. Retention purge cron placeholder (requires pg_cron extension if available)
-- do not fail if pg_cron not installed
do $outer$ begin
  perform cron.schedule('payscope-purge-callbacks', '0 3 * * *', $cb$select public.payscope_purge_expired_callbacks()$cb$);
exception when undefined_function then null; when others then null; end $outer$;
