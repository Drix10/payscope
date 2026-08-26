-- Recovery Outcome Ledger — durable learning dataset for merchant-specific recovery policy.
-- Every autonomous intervention becomes an experiment; reconciliation closes the loop.

create table if not exists public.payscope_recovery_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  action_id uuid unique references public.payscope_execution_actions(id) on delete set null,
  customer_hash text check (customer_hash is null or char_length(customer_hash)=64 and customer_hash ~ '^[a-f0-9]{64}$'),
  failure_category text not null check (failure_category in ('gateway_degraded','issuer_timeout','issuer_block','fraud_block','insufficient_funds','customer_drop','routing_suboptimal','subscription_lapse','unknown','customer_error','fraud_confirmed','fraud_suspected')),
  payment_method text not null default 'unknown' check (char_length(payment_method) between 1 and 80),
  amount_paise integer not null check (amount_paise between 100 and 100000000),
  currency text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  customer_segment text not null check (customer_segment in ('new','repeat','high','unknown')),
  strategy text not null check (strategy in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure','retry_subscription_charge','cancel_payment_link','fetch_payment_status')),
  policy_version text check (policy_version is null or char_length(policy_version) between 1 and 160),
  capability_version text check (capability_version is null or char_length(capability_version) between 1 and 160),
  send_at timestamptz not null default now(),
  channel text not null default 'email' check (channel in ('email')),
  risk_score numeric check (risk_score is null or (risk_score between 0 and 1)),
  confidence numeric check (confidence is null or (confidence between 0 and 1)),
  expected_recovery_paise integer check (expected_recovery_paise is null or expected_recovery_paise >= 0),
  considered_strategies jsonb not null default '[]'::jsonb check (jsonb_typeof(considered_strategies)='array' and jsonb_array_length(considered_strategies) <= 6),
  exploration boolean not null default false,
  outcome text not null default 'pending' check (outcome in ('pending','paid','expired','failed','cancelled')),
  actual_recovery_paise integer check (actual_recovery_paise is null or actual_recovery_paise >= 0),
  time_to_recovery_ms integer check (time_to_recovery_ms is null or time_to_recovery_ms >= 0),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payscope_recovery_outcomes_lookup on public.payscope_recovery_outcomes(organization_id, strategy, failure_category, customer_segment, created_at desc);
create index if not exists payscope_recovery_outcomes_customer on public.payscope_recovery_outcomes(organization_id, customer_hash, created_at desc);
create index if not exists payscope_recovery_outcomes_incident on public.payscope_recovery_outcomes(incident_id);
create index if not exists payscope_recovery_outcomes_action on public.payscope_recovery_outcomes(action_id) where action_id is not null;

alter table public.payscope_recovery_outcomes enable row level security;

-- Purge helper for retention (reuse existing pattern). Default 90 days; orgs may override via future retention table.
create or replace function public.payscope_purge_recovery_outcomes(p_retention_days integer default 90)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare purged integer;
begin
  if p_retention_days < 7 or p_retention_days > 365 then raise exception 'Retention must be 7..365 days'; end if;
  delete from public.payscope_recovery_outcomes where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics purged = row_count;
  return purged;
end;
$$;
revoke all on function public.payscope_purge_recovery_outcomes(integer) from public;
grant execute on function public.payscope_purge_recovery_outcomes(integer) to service_role;

-- Atomic enqueue + ledger: single transaction prevents orphan rows.
create or replace function public.payscope_enqueue_with_ledger(
  p_organization_id uuid,
  p_incident_id uuid,
  p_proposal_id uuid,
  p_command_key text,
  p_command_payload jsonb,
  p_command_payload_hash text,
  p_payment_id text,
  p_order_id text,
  p_amount_paise integer,
  p_currency text,
  p_customer_hash text,
  p_failure_category text,
  p_payment_method text,
  p_customer_segment text,
  p_strategy text,
  p_expected_recovery_paise integer,
  p_considered_strategies jsonb,
  p_exploration boolean,
  p_confidence numeric,
  p_risk_score numeric
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare action_id uuid;
begin
  -- Delegate to existing transactional enqueue (holds advisory lock, checks contact limits, etc.)
  select public.payscope_enqueue_recovery_email_action(
    p_organization_id, p_incident_id, p_proposal_id, p_command_key, p_command_payload, p_command_payload_hash, p_payment_id, p_order_id, p_amount_paise, p_currency
  ) into action_id;
  -- Idempotent ledger insert (unique action_id)
  insert into public.payscope_recovery_outcomes(
    organization_id, incident_id, action_id, customer_hash, failure_category, payment_method, amount_paise, currency, customer_segment, strategy, expected_recovery_paise, considered_strategies, exploration, confidence, risk_score, outcome
  ) values (
    p_organization_id, p_incident_id, action_id, nullif(p_customer_hash,''), p_failure_category, coalesce(nullif(p_payment_method,''),'unknown'), p_amount_paise, p_currency, p_customer_segment, p_strategy, p_expected_recovery_paise, coalesce(p_considered_strategies,'[]'::jsonb), coalesce(p_exploration,false), p_confidence, p_risk_score, 'pending'
  ) on conflict (action_id) do nothing;
  return action_id;
end;
$$;
revoke all on function public.payscope_enqueue_with_ledger(uuid,uuid,uuid,text,jsonb,text,text,text,integer,text,text,text,text,text,text,integer,jsonb,boolean,numeric,numeric) from public;
grant execute on function public.payscope_enqueue_with_ledger(uuid,uuid,uuid,text,jsonb,text,text,text,integer,text,text,text,text,text,text,integer,jsonb,boolean,numeric,numeric) to service_role;

-- Outcome reconciliation is updated by the existing reconcile paths; add a dedicated helper for idempotent close.
create or replace function public.payscope_record_recovery_outcome(
  p_organization_id uuid,
  p_action_id uuid,
  p_outcome text,
  p_actual_recovery_paise integer
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_outcome not in ('paid','expired','failed','cancelled') then raise exception 'Invalid recovery outcome %', p_outcome; end if;
  update public.payscope_recovery_outcomes
     set outcome = p_outcome,
         actual_recovery_paise = p_actual_recovery_paise,
         time_to_recovery_ms = case when send_at is not null then greatest(0, (extract(epoch from (now() - send_at))*1000)::integer) else null end,
         reconciled_at = now(),
         updated_at = now()
   where organization_id = p_organization_id and action_id = p_action_id and outcome = 'pending';
end;
$$;
revoke all on function public.payscope_record_recovery_outcome(uuid,uuid,text,integer) from public;
grant execute on function public.payscope_record_recovery_outcome(uuid,uuid,text,integer) to service_role;
